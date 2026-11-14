import {createCocoaFilePort,normalizeCocoaPath,cocoaParent,cocoaName,cocoaJoin} from "../adapters/cocoa-fs";
import {CocoaLlamaClient} from "../adapters/cocoa-llama";
import {sha256} from "../core/sha256";
import {loadProgress,progressConfig,recoverable,splitRetry,mergeEntities,validEntities} from "../core/recovery";
import type {ExtractedEntities} from "../core/types";
import {GlobalEntityStore} from "../core/store";
import {createDocumentChunks} from "../core/chunks";
import {makeMapping,anonymizeText,restoreText} from "../core/mapping";
import type {Categories,EntityMapping} from "../core/types";

declare const ObjC:any;
declare const $:any;
interface Document {file:string;original:string;mode:number;}
function fileList(folder:string,fs:ReturnType<typeof createCocoaFilePort>):string[] {
  const entries=fs.readdir(folder).sort((a,b)=>a.name.localeCompare(b.name));
  const files=entries.filter(x=>x.isFile&&/\.(md|markdown)$/i.test(x.name)).map(x=>cocoaJoin(folder,x.name));
  for(const entry of entries)
    if(entry.isDirectory && entry.name!==".git" && entry.name!=="node_modules")
      files.push(...fileList(cocoaJoin(folder,entry.name),fs));
  return files;
}
function mapFile(input:string,isDirectory:boolean):string {
  const basename=cocoaName(input);
  return cocoaJoin(cocoaParent(input),
    (isDirectory?basename:basename.replace(/\.(md|markdown)$/i,""))+".json");
}
function validMap(raw:string,path:string):Record<string,string> {
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch(e){throw new Error("Invalid mapping JSON "+path+": "+String(e));}
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))throw new Error("Invalid mapping JSON "+path);
  const mapping:Record<string,string>=Object.create(null);
  for(const [key,val] of Object.entries(parsed))
    if(key && typeof val==="string")mapping[key]=val;
    else throw new Error("Invalid mapping entry "+path);
  return mapping;
}
function transaction(
  files:Document[],replacement:string[],mapPath:string,restore:boolean,
  fs:ReturnType<typeof createCocoaFilePort>,newMap?:EntityMapping
):void {
  const id=Date.now()+"-"+Math.floor(Math.random()*100000000);
  const stages=files.map((doc,i)=>{
    const base=cocoaJoin(cocoaParent(doc.file),".anonymize-jxa-"+id+"-"+i);
    return {original:doc.file,pending:base+".new",backup:base+".bak",mode:doc.mode,plain:doc.original};
  });
  let mapCreated=false;
  const installed:typeof stages=[];
  try {
    for(let i=0;i<stages.length;i++) {
      const item=stages[i];
      fs.writeFile(item.pending,replacement[i],0o600,true);
      fs.chmod(item.pending,item.mode);
      fs.writeFile(item.backup,item.plain,0o600,true);
    }
    if(!restore) {
      fs.writeFile(mapPath,JSON.stringify(newMap!.placeholderToReal,null,2)+"\n",0o600,true);
      mapCreated=true;
    }
    for(const item of stages) {
      fs.rename(item.pending,item.original);
      installed.push(item);
    }
    if(restore)fs.unlink(mapPath);
  } catch(error) {
    const failed:string[]=[];
    for(const item of [...installed].reverse()) {
      try{fs.rename(item.backup,item.original);}catch(e){failed.push(String(e));}
    }
    // Foundation moveItem cannot overwrite in place. If a replacement failed
    // after removing the destination, recover that particular missing original
    // from its private backup as well (it is not yet in installed[]).
    for(const item of stages) {
      if(!fs.stat(item.original) && fs.stat(item.backup)) {
        try{fs.rename(item.backup,item.original);}
        catch(e){failed.push(item.original+": "+String(e));}
      }
    }
    if(mapCreated && !failed.length)try{fs.unlink(mapPath);}catch(e){failed.push(String(e));}
    for(const item of stages) {
      try{fs.unlink(item.pending);}catch(_e){}
      if(!failed.length)try{fs.unlink(item.backup);}catch(_e){}
    }
    throw new Error("JXA transaction aborted: "+String(error)+
      (failed.length?"; manual recovery required: "+failed.join("; "):""));
  }
  for(const item of stages)fs.unlink(item.backup);
}

/** Synchronous JXA entrypoint; only the final two build artifacts expose run(). */
export function run(argv:string[]=[]):string {
  if(argv.length!==1)throw new Error("Expected exactly one .md/.markdown file or folder");
  const fs=createCocoaFilePort();
  const input=normalizeCocoaPath(String(argv[0]));
  const state=fs.stat(input);
  if(!state || (!state.isDirectory&&!state.isFile))throw new Error("Input does not exist: "+input);
  const filenames=state.isDirectory?fileList(input,fs):
    /\.(md|markdown)$/i.test(input)?[input]:(()=>{throw new Error("Unsupported file type: "+input);})();
  if(!filenames.length)throw new Error("No Markdown files found");
  const mapPath=mapFile(input,state.isDirectory);
  const docs:Document[]=filenames.map(file=>{
    const info=fs.stat(file);
    if(!info?.isFile)throw new Error("Not a regular file: "+file);
    return {file,original:fs.readFile(file),mode:info.mode};
  });
  if(fs.stat(mapPath)) {
    const mapping=validMap(fs.readFile(mapPath),mapPath);
    transaction(docs,docs.map(d=>restoreText(d.original,mapping)),mapPath,true,fs);
    return JSON.stringify({action:"restored",outputDir:input,mapPath,fileCount:docs.length});
  }

  const store=new GlobalEntityStore();
  for(const doc of docs)store.applyRegexFallback(doc.original);
  const client=new CocoaLlamaClient();
  const chunks=createDocumentChunks(docs.map(d=>d.original));
  const progressPath=mapPath.replace(/\.json$/,".progress.json");
  const fingerprint=sha256(JSON.stringify(docs.map(d=>[d.file,sha256(d.original)])));
  const progress=loadProgress(fs.stat(progressPath)?fs.readFile(progressPath):null,
    fingerprint,progressConfig(client.cacheIdentity()),chunks.length);
  const persist=()=>{
    const temp=progressPath+"."+Date.now()+".new";
    try{fs.writeFile(temp,JSON.stringify(progress)+"\n",0o600,true);fs.rename(temp,progressPath);}
    finally{fs.unlink(temp);}
  };
  persist();
  const extract=(text:string,depth=0):ExtractedEntities=>{
    const key=sha256(text);
    if(progress.results[key])return progress.results[key];
    let result:ExtractedEntities;
    try {
      result=client.extractEntitiesFromChunk(text);
      if(!validEntities(result))throw new Error("Invalid extracted field");
    } catch(error) {
      const parts=recoverable(error)?splitRetry(text,depth):null;
      if(!parts)throw new Error("Extraction failed; progress retained; "+
        (recoverable(error)?"retry limit reached":"non-retryable transport/model error")+
        ((error as Error).message?.includes("finish_reason=length")?" (finish_reason=length)":""));
      console.log(`retry split depth=${depth+1} characters=${text.length}`);
      result=mergeEntities(parts.map(part=>extract(part,depth+1)));
    }
    progress.results[key]=result;persist();return result;
  };
  let chunkCount=0;
  for(const chunk of chunks) {
    const started=Date.now();
    console.log(`[${chunkCount+1}/${chunks.length}] extracting ${chunk.length} characters`);
    try{store.addEntities(extract(chunk));}
    catch(e){throw new Error(`Chunk ${chunkCount+1}/${chunks.length}: `+(e as Error).message);}
    chunkCount++;
    console.log(`[${chunkCount}/${chunks.length}] completed in ${((Date.now()-started)/1000).toFixed(1)}s`);
  }
  const categories:Categories=store.exportSortedCategories();
  const reserved=new Set<string>();
  for(const doc of docs)
    for(const match of doc.original.matchAll(/「[^」\r\n]{1,80}」/g))reserved.add(match[0]);
  const mapping=makeMapping(categories,reserved,docs.map(d=>d.original));
  for(const doc of docs)if(fs.readFile(doc.file)!==doc.original)
    throw new Error("Source changed during extraction; progress retained");
  transaction(docs,docs.map(d=>anonymizeText(d.original,mapping)),mapPath,false,fs,mapping);
  fs.unlink(progressPath);
  return JSON.stringify({
    action:"anonymized",outputDir:input,mapPath,fileCount:docs.length,chunkCount,
    counts:{PER:categories.PER.length,ORG:categories.ORG.length,
      NUM:(categories.ID?.length??0)+(categories.PHONE?.length??0)+(categories.USCC?.length??0)}
  });
}
