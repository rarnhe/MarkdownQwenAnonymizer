import {ENTITY_GBNF_GRAMMAR} from "../core/grammar";
import type {EntityExtractor,ExtractedEntities} from "../core/types";

function parseEntities(content:unknown):ExtractedEntities {
  if(typeof content!=="string") throw new Error("No JSON content returned by llama-server");
  const parsed:unknown=JSON.parse(content);
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("Expected JSON object");
  const object=parsed as Record<string,unknown>;
  const result:ExtractedEntities={persons:[],organizations:[],id_cards:[],codes:[]};
  for(const key of ["persons","organizations","id_cards","codes"] as const) {
    if(!Array.isArray(object[key]) || !(object[key] as unknown[]).every(v=>typeof v==="string"))
      throw new Error("Invalid extracted field: "+key);
    result[key]=object[key] as string[];
  }
  return result;
}

/** HTTP adapter for llama.cpp's OpenAI-compatible /v1/chat/completions endpoint. */
export class LlamaServerClient implements EntityExtractor {
  constructor(private readonly baseUrl="http://127.0.0.1:9931") {}

  async verifyCotBudgetControl():Promise<boolean> {
    const payload={
      messages:[{role:"user",content:"1+1="}],max_tokens:24,temperature:0,
      stream:true,reasoning_budget:0,chat_template_kwargs:{enable_thinking:false}
    };
    try {
      const response=await fetch(this.baseUrl+"/v1/chat/completions",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)
      });
      if(!response.ok || !response.body) return false;
      const reader=response.body.getReader();
      const decoder=new TextDecoder();
      let buffered="",sawContent=false,sawDone=false,sawThinking=false;
      while(true) {
        const {done,value}=await reader.read();
        buffered+=decoder.decode(value || new Uint8Array(),{stream:!done});
        const lines=buffered.split("\n");
        buffered=done?"":lines.pop() || "";
        for(const line of lines) {
          if(!line.trimStart().startsWith("data:")) continue;
          const event=line.trimStart().slice(5).trim();
          if(event==="[DONE]") {sawDone=true;continue;}
          let data:any;
          try {data=JSON.parse(event);} catch {return false;}
          const delta=data.choices?.[0]?.delta || {};
          if(typeof delta.content==="string" && delta.content.trim()) sawContent=true;
          if(String(delta.reasoning_content || delta.thinking || "").trim() ||
             String(delta.content || "").includes("<think>")) sawThinking=true;
        }
        if(done) break;
      }
      return sawContent && sawDone && !sawThinking;
    } catch {return false;}
  }

  async extractEntitiesFromChunk(chunkText:string,isControllableCot:boolean):Promise<ExtractedEntities> {
    const prompt=[
      "你是一名专业的法律文档隐私审查助手。请仔细阅读文本，抽取人名、公司/机构名称、身份证号、合同/文件/案号/账号/手机号/社会安全号码等编号。",
      "只输出JSON，必须依次包含persons、organizations、id_cards、codes四个字符串数组，不允许解释、重复或者编造。手机号和美国SSN属于codes。",
      "【文本内容】\n"+chunkText
    ].join("\n");
    const base={
      messages:[{role:"user",content:prompt}],max_tokens:512,
      temperature:0,grammar:ENTITY_GBNF_GRAMMAR,stream:false
    };
    const send=(payload:Record<string,unknown>)=>fetch(this.baseUrl+"/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(300000)
    });
    const payload:Record<string,unknown>=isControllableCot
      ? {...base,reasoning_budget:0,chat_template_kwargs:{enable_thinking:false}}
      : base;
    let response=await send(payload);
    if(response.status===400 && isControllableCot) response=await send(base);
    if(!response.ok) throw new Error("llama-server HTTP "+response.status+": "+(await response.text()).slice(0,250));
    const data=await response.json() as {choices?:Array<{message?:{content?:string}}>} ;
    return parseEntities(data.choices?.[0]?.message?.content);
  }
}
