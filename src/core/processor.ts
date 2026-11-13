import * as path from "node:path";
import {randomUUID} from "node:crypto";
import type {FilePort} from "../ports/file-port";
import type {EntityExtractor,EntityMapping} from "./types";
import {GlobalEntityStore} from "./store";
import {createDocumentChunks} from "./chunks";
import {makeMapping,anonymizeText,restoreText} from "./mapping";

const MAP_FILENAME=".anonymize-map.json";
const IGNORE_FILENAME=".gitignore";
const IGNORE_RULE=MAP_FILENAME;

function appendIgnoreRule(original:string):string {
  if(original.split(/\r?\n/).some(line=>line.trim()===IGNORE_RULE))return original;
  const newline=original.includes("\r\n")?"\r\n":"\n";
  return original+(original && !original.endsWith("\n")?newline:"")+IGNORE_RULE+newline;
}
export interface AnonymizeResult {
  action:"anonymized"|"restored";
  outputDir:string;
  mapPath:string;
  fileCount:number;
  chunkCount:number;
  counts:{PER:number;ORG:number;NUM:number};
}
interface StagedFile {original:string;pending:string;backup:string;content:string;mode:number;}

export class MarkdownDirectoryAnonymizer {
  private readonly srcDirPath:string;
  constructor(dirPath:string,private readonly client:EntityExtractor,private readonly fs:FilePort) {
    this.srcDirPath=path.resolve(dirPath);
  }

  /** Recursively include Markdown only, including dotfiles; skip Git and dependency internals. */
  private async getAllMarkdownFiles(dir:string):Promise<string[]> {
    const entries=(await this.fs.readdir(dir)).sort((a,b)=>a.name.localeCompare(b.name));
    const files:string[]=[];
    for(const entry of entries) {
      if(entry.isDirectory) {
        if(entry.name===".git" || entry.name==="node_modules")continue;
        files.push(...await this.getAllMarkdownFiles(path.join(dir,entry.name)));
      } else if(entry.isFile && /\.(md|markdown)$/i.test(entry.name)) {
        files.push(path.join(dir,entry.name));
      }
    }
    return files;
  }

  private async getIgnoreState():Promise<{exists:boolean;original:string;updated:string;mode:number}> {
    const ignorePath=path.join(this.srcDirPath,IGNORE_FILENAME);
    try {
      const original=await this.fs.readFile(ignorePath,"utf8");
      return {exists:true,original,updated:appendIgnoreRule(original),
        mode:(await this.fs.stat(ignorePath)).mode};
    } catch(error) {
      if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
      return {exists:false,original:"",updated:IGNORE_RULE+"\n",mode:0o644};
    }
  }

  /** A present map means the previous run must be reversed before any new LLM inference. */
  private async readExistingMap(mapPath:string):Promise<Record<string,string>|null> {
    let raw:string;
    try {raw=await this.fs.readFile(mapPath,"utf8");}
    catch(error) {
      if((error as NodeJS.ErrnoException).code==="ENOENT")return null;
      throw error;
    }
    let parsed:unknown;
    try {parsed=JSON.parse(raw);}
    catch(error) {throw new Error("Invalid "+MAP_FILENAME+": "+String(error));}
    if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))
      throw new Error("Invalid "+MAP_FILENAME+": expected a JSON object");
    const mapping:Record<string,string>=Object.create(null);
    for(const [token,real] of Object.entries(parsed)) {
      if(!token || typeof real!=="string")
        throw new Error("Invalid "+MAP_FILENAME+": every entry must map a non-empty token to a string");
      mapping[token]=real;
    }
    return mapping;
  }

  async process():Promise<AnonymizeResult> {
    if(!(await this.fs.stat(this.srcDirPath)).isDirectory)throw new Error("Expected a Markdown directory");
    const mapPath=path.join(this.srcDirPath,MAP_FILENAME);
    const existingMap=await this.readExistingMap(mapPath);
    if(existingMap) return this.restoreMarkdown(mapPath,existingMap);
    return this.anonymizeMarkdown(mapPath);
  }

  /** Restore only .md/.markdown files. The map is deleted only after all replacements succeed. */
  private async restoreMarkdown(
    mapPath:string,placeholderToReal:Readonly<Record<string,string>>
  ):Promise<AnonymizeResult> {
    const mdFiles=await this.getAllMarkdownFiles(this.srcDirPath);
    if(!mdFiles.length)throw new Error("Cannot restore: no Markdown files found; "+MAP_FILENAME+" was retained");
    const contents=await Promise.all(mdFiles.map(async filePath=>({
      filePath,content:await this.fs.readFile(filePath,"utf8"),
      mode:(await this.fs.stat(filePath)).mode
    })));
    const txid=randomUUID();
    const staged:StagedFile[]=contents.map((file,i)=>{
      const dir=path.dirname(file.filePath);
      return {
        original:file.filePath,
        pending:path.join(dir,".anonymize-restore-"+txid+"-"+i+".new"),
        backup:path.join(dir,".anonymize-restore-"+txid+"-"+i+".bak"),
        content:file.content,
        mode:file.mode
      };
    });
    const prepared=contents.map(file=>restoreText(file.content,placeholderToReal));
    const tempPaths:string[]=[];
    const installed:StagedFile[]=[];
    try {
      for(let i=0;i<staged.length;i++) {
        const item=staged[i];
        tempPaths.push(item.pending);
        await this.fs.writeFile(item.pending,prepared[i],{flag:"wx",mode:0o600});
        await this.fs.chmod(item.pending,item.mode);
        tempPaths.push(item.backup);
        await this.fs.writeFile(item.backup,item.content,{flag:"wx",mode:0o600});
      }
      for(const item of staged) {
        await this.fs.rename(item.pending,item.original);
        installed.push(item);
      }
      // Keep the map until every Markdown replacement has succeeded.
      await this.fs.unlink(mapPath);
    } catch(error) {
      const rollbackErrors:string[]=[];
      for(const item of [...installed].reverse()) {
        try {await this.fs.rename(item.backup,item.original);}
        catch(e) {rollbackErrors.push(item.original+": "+String(e));}
      }
      if(rollbackErrors.length===0) {
        await Promise.allSettled(tempPaths.map(p=>this.fs.unlink(p)));
      } else {
        await Promise.allSettled(staged.map(item=>this.fs.unlink(item.pending)));
      }
      const details=rollbackErrors.length
        ? "; map retained; manual recovery needed: "+rollbackErrors.join("; ")
        : "; original masked Markdown and map retained";
      throw new Error("Markdown restoration aborted: "+String(error)+details);
    }
    const cleanup=await Promise.allSettled(staged.map(item=>this.fs.unlink(item.backup)));
    const failedCleanup=cleanup.flatMap((value,i)=>value.status==="rejected"?[staged[i].backup]:[]);
    if(failedCleanup.length)
      throw new Error("Markdown was restored and map removed, but temporary backups could not be deleted: "+failedCleanup.join(", "));
    return {action:"restored",outputDir:this.srcDirPath,mapPath,fileCount:contents.length,chunkCount:0,
      counts:{PER:0,ORG:0,NUM:0}};
  }

  private async anonymizeMarkdown(mapPath:string):Promise<AnonymizeResult> {
    const ignoreState=await this.getIgnoreState();
    const ignoreNeedsUpdate=ignoreState.updated!==ignoreState.original;
    const mdFiles=await this.getAllMarkdownFiles(this.srcDirPath);
    if(!mdFiles.length)throw new Error("No .md or .markdown files found");

    const contents=await Promise.all(mdFiles.map(async filePath=>({
      filePath,content:await this.fs.readFile(filePath,"utf8"),
      mode:(await this.fs.stat(filePath)).mode
    })));
    const store=new GlobalEntityStore();
    const controllable=await this.client.verifyCotBudgetControl();
    let chunkCount=0;
    for(const file of contents)store.applyRegexFallback(file.content);
    for(const chunk of createDocumentChunks(contents.map(file=>file.content),20000,50)) {
      store.addEntities(await this.client.extractEntitiesFromChunk(chunk,controllable));
      chunkCount++;
    }
    const categories=store.exportSortedCategories();
    const reserved=new Set<string>();
    for(const file of contents) {
      for(const match of file.content.matchAll(/\[[^\]\r\n]{1,80}\]/g))reserved.add(match[0]);
    }
    const mapping:EntityMapping=makeMapping(categories,reserved);
    const txid=randomUUID();
    const staged:StagedFile[]=contents.map((file,i)=>{
      const dir=path.dirname(file.filePath);
      return {
        original:file.filePath,
        pending:path.join(dir,".anonymize-"+txid+"-"+i+".new"),
        backup:path.join(dir,".anonymize-"+txid+"-"+i+".bak"),
        content:file.content,
        mode:file.mode
      };
    });
    const prepared=contents.map(file=>anonymizeText(file.content,mapping));
    const ignorePath=path.join(this.srcDirPath,IGNORE_FILENAME);
    const ignorePending=path.join(this.srcDirPath,".anonymize-"+txid+"-ignore.new");
    const ignoreBackup=path.join(this.srcDirPath,".anonymize-"+txid+"-ignore.bak");
    const tempPaths:string[]=[];
    let ignoreInstalled=false;
    let mapCreated=false;
    const installed:StagedFile[]=[];
    try {
      for(let i=0;i<staged.length;i++) {
        const item=staged[i];
        tempPaths.push(item.pending);
        await this.fs.writeFile(item.pending,prepared[i],{flag:"wx",mode:0o600});
        await this.fs.chmod(item.pending,item.mode);
        tempPaths.push(item.backup);
        await this.fs.writeFile(item.backup,item.content,{flag:"wx",mode:0o600});
      }
      if(ignoreNeedsUpdate) {
        tempPaths.push(ignorePending);
        await this.fs.writeFile(ignorePending,ignoreState.updated,{flag:"wx",mode:0o600});
        await this.fs.chmod(ignorePending,ignoreState.mode);
        if(ignoreState.exists) {
          tempPaths.push(ignoreBackup);
          await this.fs.writeFile(ignoreBackup,ignoreState.original,{flag:"wx",mode:0o600});
        }
        await this.fs.rename(ignorePending,ignorePath);
        ignoreInstalled=true;
      }
      await this.fs.writeFile(mapPath,JSON.stringify(mapping.placeholderToReal,null,2)+"\n",
        {flag:"wx",mode:0o600});
      mapCreated=true;
      for(const item of staged) {
        await this.fs.rename(item.pending,item.original);
        installed.push(item);
      }
    } catch(error) {
      const restoreErrors:string[]=[];
      for(const item of [...installed].reverse()) {
        try {await this.fs.rename(item.backup,item.original);}
        catch(e) {restoreErrors.push(item.original+": "+String(e));}
      }
      if(ignoreInstalled) {
        try {
          if(ignoreState.exists)await this.fs.rename(ignoreBackup,ignorePath);
          else await this.fs.unlink(ignorePath);
        } catch(e) {restoreErrors.push(ignorePath+": "+String(e));}
      }
      if(mapCreated && restoreErrors.length===0) {
        try {await this.fs.unlink(mapPath);}
        catch(e) {restoreErrors.push("mapping cleanup: "+String(e));}
      }
      if(restoreErrors.length===0) {
        await Promise.allSettled(tempPaths.map(p=>this.fs.unlink(p)));
      } else {
        await Promise.allSettled([...staged.map(item=>item.pending),ignorePending]
          .map(p=>this.fs.unlink(p)));
      }
      const details=restoreErrors.length ? "; manual recovery needed: "+restoreErrors.join("; ") : "";
      throw new Error("In-place anonymization aborted: "+String(error)+details);
    }
    const cleanupPaths=[
      ...staged.map(item=>item.backup),
      ...(ignoreNeedsUpdate && ignoreState.exists?[ignoreBackup]:[])
    ];
    const cleanup=await Promise.allSettled(cleanupPaths.map(p=>this.fs.unlink(p)));
    const failedCleanup=cleanup.flatMap((value,i)=>value.status==="rejected" ? [cleanupPaths[i]]:[]);
    if(failedCleanup.length)
      throw new Error("Anonymization succeeded but plaintext backups could not be removed: "+failedCleanup.join(", "));
    return {action:"anonymized",outputDir:this.srcDirPath,mapPath,fileCount:contents.length,chunkCount,
      counts:{PER:categories.PER.length,ORG:categories.ORG.length,
        NUM:(categories.ID?.length??0)+(categories.PHONE?.length??0)+(categories.USCC?.length??0)}};
  }
}
