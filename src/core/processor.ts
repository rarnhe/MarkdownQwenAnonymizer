import * as path from "node:path";
import {randomUUID} from "node:crypto";
import type {FilePort} from "../ports/file-port";
import type {EntityExtractor,EntityMapping} from "./types";
import {GlobalEntityStore} from "./store";
import {createDocumentChunks} from "./chunks";
import {makeMapping,anonymizeText} from "./mapping";

const MAP_FILENAME="anonymize-map.json";
const IGNORE_FILENAME=".gitignore";
const IGNORE_RULE="anonymize-map.json";

/** Keep existing .gitignore patterns and its newline convention intact. */
function appendIgnoreRule(original:string):string {
  if(original.split(/\r?\n/).some(line=>line.trim()===IGNORE_RULE))return original;
  const newline=original.includes("\r\n")?"\r\n":"\n";
  return original+(original && !original.endsWith("\n")?newline:"")+IGNORE_RULE+newline;
}
export interface AnonymizeResult {
  /** Original directory, now updated in place (retained for CLI compatibility). */
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
  private async getAllMarkdownFiles(dir:string):Promise<string[]> {
    const entries=(await this.fs.readdir(dir)).sort((a,b)=>a.name.localeCompare(b.name));
    const files:string[]=[];
    for(const entry of entries) {
      if(entry.name.startsWith("."))continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory && !entry.name.endsWith("_脱敏后"))
        files.push(...await this.getAllMarkdownFiles(full));
      else if(entry.isFile && /\.(md|markdown)$/i.test(entry.name))files.push(full);
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
  private async ensureNoExistingMap(mapPath:string):Promise<void> {
    try {
      await this.fs.readFile(mapPath,"utf8");
      throw new Error("Existing "+MAP_FILENAME+" found. Restore originals and remove/move the mapping before another run.");
    } catch(error) {
      if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    }
  }
  async process():Promise<AnonymizeResult> {
    if(!(await this.fs.stat(this.srcDirPath)).isDirectory)throw new Error("Expected a Markdown directory");
    const mapPath=path.join(this.srcDirPath,MAP_FILENAME);
    // Never clobber a prior reversible dictionary or reprocess masked source.
    await this.ensureNoExistingMap(mapPath);
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

    // Finish all extractions before mutating source Markdown; fail closed on server errors.
    for(const file of contents)store.applyRegexFallback(file.content);
    // Chunk the combined directory text once, not one tiny chunk per file.
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
      // Write every replacement and an emergency plaintext rollback copy first.
      // Temporary files stay beside originals for same-filesystem atomic rename.
      for(let i=0;i<staged.length;i++) {
        const item=staged[i];
        tempPaths.push(item.pending);
        await this.fs.writeFile(item.pending,prepared[i],{flag:"wx",mode:0o600});
        await this.fs.chmod(item.pending,item.mode);
        tempPaths.push(item.backup);
        await this.fs.writeFile(item.backup,item.content,{flag:"wx",mode:0o600});
      }
      // Add the local ignore rule BEFORE writing plaintext identifiers.
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
      // The reversible map must exist before any source replacement happens.
      await this.fs.writeFile(mapPath,JSON.stringify(mapping.placeholderToReal,null,2)+"\n",
        {flag:"wx",mode:0o600});
      mapCreated=true;
      for(const item of staged) {
        await this.fs.rename(item.pending,item.original);
        installed.push(item);
      }
    } catch(error) {
      // A failed in-place operation must restore any source files already replaced.
      const restoreErrors:string[]=[];
      for(const item of [...installed].reverse()) {
        try {await this.fs.rename(item.backup,item.original);}
        catch(e) {restoreErrors.push(item.original+": "+String(e));}
      }
      // Restore an existing .gitignore, or remove the one created by this run.
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
      // Keep rollback backups and the map when restoration is incomplete.
      if(restoreErrors.length===0) {
        await Promise.allSettled(tempPaths.map(p=>this.fs.unlink(p)));
      } else {
        // Pending files can be discarded; original backups must remain available.
        await Promise.allSettled([...staged.map(item=>item.pending),ignorePending]
          .map(p=>this.fs.unlink(p)));
      }
      const details=restoreErrors.length ? "; manual recovery needed: "+restoreErrors.join("; ") : "";
      throw new Error("In-place anonymization aborted: "+String(error)+details);
    }
    // A successful transaction must not leave recoverable plaintext backups behind.
    const cleanupPaths=[
      ...staged.map(item=>item.backup),
      ...(ignoreNeedsUpdate && ignoreState.exists?[ignoreBackup]:[])
    ];
    const cleanup=await Promise.allSettled(cleanupPaths.map(p=>this.fs.unlink(p)));
    const failedCleanup=cleanup.flatMap((value,i)=>value.status==="rejected" ? [cleanupPaths[i]]:[]);
    if(failedCleanup.length)throw new Error("Anonymization succeeded but plaintext backups could not be removed: "+failedCleanup.join(", "));
    return {outputDir:this.srcDirPath,mapPath,fileCount:contents.length,chunkCount,
      counts:{PER:categories.PER.length,ORG:categories.ORG.length,
        NUM:(categories.ID?.length??0)+(categories.PHONE?.length??0)+(categories.USCC?.length??0)}};
  }
}
