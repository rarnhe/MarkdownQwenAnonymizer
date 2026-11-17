import {sha256} from "./sha256";
import {createChunks,MAX_CHUNK_CHARS,CHUNK_OVERLAP_CHARS} from "./chunks";
import {ENTITY_GBNF_GRAMMAR} from "./grammar";
import type {ExtractedEntities} from "./types";
export const EXTRACTION_VERSION="legal-entities-v2";
export function validEntities(value:unknown):value is ExtractedEntities {
  return !!value && typeof value==="object" && !Array.isArray(value) &&
    ["persons","organizations","id_cards","codes"].every(k=>
      Array.isArray((value as any)[k])&&(value as any)[k].every((v:unknown)=>typeof v==="string"));
}
export interface Progress {
  version:1; fingerprint:string; config:string; totalChunks:number;
  results:Record<string,ExtractedEntities>;
}
export function progressConfig(model:string):string {
  return sha256(JSON.stringify({model,version:EXTRACTION_VERSION,grammar:ENTITY_GBNF_GRAMMAR,
    maxChunkChars:MAX_CHUNK_CHARS,overlap:CHUNK_OVERLAP_CHARS,maxTokens:2048}));
}
export function loadProgress(raw:string|null,fingerprint:string,config:string,totalChunks:number):Progress {
  if(raw!==null) {
    let value:any;
    try{value=JSON.parse(raw);}catch{throw new Error("Invalid progress JSON; preserve it for inspection or remove it to restart");}
    if(value?.version!==1||value.fingerprint!==fingerprint||value.config!==config||value.totalChunks!==totalChunks)
      throw new Error("Progress does not match input/model/config; remove the progress file to restart");
    if(!value.results||typeof value.results!=="object"||Array.isArray(value.results)||
      !Object.entries(value.results).every(([key,v])=>/^[a-f0-9]{64}$/.test(key)&&validEntities(v)))
      throw new Error("Invalid progress results");
    return value;
  }
  return {version:1,fingerprint,config,totalChunks,results:Object.create(null)};
}
/** No raw model response or document content in errors/logs. */
export function recoverable(error:unknown):boolean {
  const name=(error as any)?.name, message=String((error as any)?.message||error);
  return name==="TimeoutError"||name==="AbortError"||error instanceof SyntaxError||
    /finish_reason=length|Invalid extracted field|No JSON|Expected JSON|HTTP (429|5\d\d)|curl failed \(28\)/.test(message);
}
export function splitRetry(text:string,depth:number):string[]|null {
  if(depth>=3||text.length<=750)return null;
  return createChunks(text,Math.ceil(text.length/2)+25,50);
}
export function mergeEntities(parts:ExtractedEntities[]):ExtractedEntities {
  const result:ExtractedEntities={persons:[],organizations:[],id_cards:[],codes:[]};
  for(const k of ["persons","organizations","id_cards","codes"] as const)
    result[k]=Array.from(new Set(parts.flatMap(p=>p[k])));
  return result;
}
