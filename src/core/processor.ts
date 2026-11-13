import * as path from "node:path";
import {randomUUID} from "node:crypto";
import type {FilePort} from "../ports/file-port";
import type {EntityExtractor,EntityMapping} from "./types";
import {GlobalEntityStore} from "./store";
import {createDocumentChunks} from "./chunks";
import {makeMapping,anonymizeText,restoreText} from "./mapping";

export type AnonymizeResult =
  | {action:"restored";outputDir:string;mapPath:string;fileCount:number}
  | {action:"anonymized";outputDir:string;mapPath:string;fileCount:number;
     chunkCount:number;counts:{PER:number;ORG:number;NUM:number}};
interface StagedFile {original:string;pending:string;backup:string;content:string;mode:number;}

/** Maps are intentionally outside processed folders: folder /a/cases -> /a/cases.json.
 * Single Markdown /a/case.md -> /a/case.json (sibling of the file).
 */
export function getMappingPath(input:string,isDirectory:boolean):string {
  const absolute=path.resolve(input);
  const base=path.basename(absolute);
  return path.join(path.dirname(absolute),
    (isDirectory?base:base.replace(/\.(md|markdown)$/i,""))+".json");
}

export class MarkdownDirectoryAnonymizer {
  private readonly inputPath:string;
  constructor(input:string,private readonly client:EntityExtractor,private readonly fs:FilePort) {
    this.inputPath=path.resolve(input);
  }

  private async getAllMarkdownFiles(dir:string):Promise<string[]> {
    const entries=(await this.fs.readdir(dir)).sort((a,b)=>a.name.localeCompare(b.name));
    const files:string[]=[];
    for(const entry of entries)
      if(entry.isFile && /\.(md|markdown)$/i.test(entry.name))files.push(path.join(dir,entry.name));
    for(const entry of entries)
      if(entry.isDirectory && entry.name!==".git" && entry.name!=="node_modules")
        files.push(...await this.getAllMarkdownFiles(path.join(dir,entry.name)));
    return files;
  }

  private async listMarkdown(isDirectory:boolean):Promise<string[]> {
    if(!isDirectory) {
      if(!/\.(md|markdown)$/i.test(this.inputPath))
        throw new Error("Single-file input must be .md or .markdown");
      return [this.inputPath];
    }
    return this.getAllMarkdownFiles(this.inputPath);
  }

  private async readMap(mapPath:string):Promise<Record<string,string>|null> {
    let raw:string;
    try {raw=await this.fs.readFile(mapPath,"utf8");}
    catch(error) {
      if((error as NodeJS.ErrnoException).code==="ENOENT")return null;
      throw error;
    }
    let parsed:unknown;
    try {parsed=JSON.parse(raw);}
    catch(error) {throw new Error("Invalid mapping JSON "+mapPath+": "+String(error));}
    if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))
      throw new Error("Invalid mapping JSON "+mapPath+": expected a JSON object");
    const mapping:Record<string,string>=Object.create(null);
    for(const [token,real] of Object.entries(parsed)) {
      if(!token || typeof real!=="string")
        throw new Error("Invalid mapping JSON "+mapPath+": expected string values");
      mapping[token]=real;
    }
    return mapping;
  }

  async process():Promise<AnonymizeResult> {
    const isDirectory=(await this.fs.stat(this.inputPath)).isDirectory;
    const mapPath=getMappingPath(this.inputPath,isDirectory);
    const files=await this.listMarkdown(isDirectory);
    const existing=await this.readMap(mapPath);
    if(existing)return this.restoreMarkdown(files,mapPath,existing);
    return this.anonymizeMarkdown(files,mapPath);
  }

  private makeStages(contents:{filePath:string;content:string;mode:number}[],phase:string):StagedFile[] {
    const txid=randomUUID();
    return contents.map((file,i)=>{
      const dir=path.dirname(file.filePath),prefix=".anonymize-"+phase+"-"+txid+"-"+i;
      return {
        original:file.filePath,pending:path.join(dir,prefix+".new"),
        backup:path.join(dir,prefix+".bak"),content:file.content,mode:file.mode
      };
    });
  }

  private async stageFiles(stages:StagedFile[],prepared:string[]):Promise<void> {
    for(let i=0;i<stages.length;i++) {
      const item=stages[i];
      await this.fs.writeFile(item.pending,prepared[i],{flag:"wx",mode:0o600});
      await this.fs.chmod(item.pending,item.mode);
      await this.fs.writeFile(item.backup,item.content,{flag:"wx",mode:0o600});
    }
  }

  private async restoreMarkdown(
    files:string[],mapPath:string,mapping:Readonly<Record<string,string>>
  ):Promise<AnonymizeResult> {
    if(!files.length)throw new Error("Cannot restore: no Markdown found; map was retained");
    const contents=await Promise.all(files.map(async filePath=>({
      filePath,content:await this.fs.readFile(filePath,"utf8"),
      mode:(await this.fs.stat(filePath)).mode
    })));
    const staged=this.makeStages(contents,"restore");
    const prepared=contents.map(file=>restoreText(file.content,mapping));
    const installed:StagedFile[]=[];
    try {
      await this.stageFiles(staged,prepared);
      for(const item of staged) {
        await this.fs.rename(item.pending,item.original);
        installed.push(item);
      }
      // The map is removed only after all Markdown updates succeeded.
      await this.fs.unlink(mapPath);
    } catch(error) {
      const failed:string[]=[];
      for(const item of [...installed].reverse())
        try {await this.fs.rename(item.backup,item.original);}
        catch(e) {failed.push(item.original+": "+String(e));}
      await Promise.allSettled(staged.flatMap(item=>[item.pending,...(failed.length?[]:[item.backup])])
        .map(name=>this.fs.unlink(name)));
      throw new Error("Markdown restoration aborted: "+String(error)+
        (failed.length?"; manual recovery required: "+failed.join("; "):"; map retained"));
    }
    const cleanup=await Promise.allSettled(staged.map(item=>this.fs.unlink(item.backup)));
    if(cleanup.some(result=>result.status==="rejected"))
      throw new Error("Restored but some plaintext backups could not be deleted");
    return {action:"restored",outputDir:this.inputPath,mapPath,fileCount:files.length};
  }

  private async anonymizeMarkdown(files:string[],mapPath:string):Promise<AnonymizeResult> {
    if(!files.length)throw new Error("No .md or .markdown files found");
    const contents=await Promise.all(files.map(async filePath=>({
      filePath,content:await this.fs.readFile(filePath,"utf8"),
      mode:(await this.fs.stat(filePath)).mode
    })));
    const store=new GlobalEntityStore();
    const controllable=await this.client.verifyCotBudgetControl();
    let chunkCount=0;
    for(const file of contents)store.applyRegexFallback(file.content);
    for(const chunk of createDocumentChunks(contents.map(file=>file.content))) {
      store.addEntities(await this.client.extractEntitiesFromChunk(chunk,controllable));
      chunkCount++;
    }
    const categories=store.exportSortedCategories();
    const reserved=new Set<string>();
    for(const file of contents)
      for(const match of file.content.matchAll(/「[^」\r\n]{1,80}」/g))reserved.add(match[0]);
    const mapping:EntityMapping=makeMapping(categories,reserved,contents.map(file=>file.content));
    const staged=this.makeStages(contents,"apply");
    const prepared=contents.map(file=>anonymizeText(file.content,mapping));
    const installed:StagedFile[]=[];
    let mapCreated=false;
    try {
      await this.stageFiles(staged,prepared);
      await this.fs.writeFile(mapPath,JSON.stringify(mapping.placeholderToReal,null,2)+"\n",
        {flag:"wx",mode:0o600});
      mapCreated=true;
      for(const item of staged) {
        await this.fs.rename(item.pending,item.original);
        installed.push(item);
      }
    } catch(error) {
      const failed:string[]=[];
      for(const item of [...installed].reverse())
        try {await this.fs.rename(item.backup,item.original);}
        catch(e) {failed.push(item.original+": "+String(e));}
      if(mapCreated && !failed.length)
        try {await this.fs.unlink(mapPath);}
        catch(e) {failed.push("map removal: "+String(e));}
      await Promise.allSettled(staged.flatMap(item=>[item.pending,...(failed.length?[]:[item.backup])])
        .map(name=>this.fs.unlink(name)));
      throw new Error("In-place anonymization aborted: "+String(error)+
        (failed.length?"; manual recovery required: "+failed.join("; "):""));
    }
    const cleanup=await Promise.allSettled(staged.map(item=>this.fs.unlink(item.backup)));
    if(cleanup.some(result=>result.status==="rejected"))
      throw new Error("Anonymization succeeded but some plaintext backups could not be deleted");
    return {action:"anonymized",outputDir:this.inputPath,mapPath,fileCount:files.length,chunkCount,
      counts:{PER:categories.PER.length,ORG:categories.ORG.length,
        NUM:(categories.ID?.length??0)+(categories.PHONE?.length??0)+(categories.USCC?.length??0)}};
  }
}
