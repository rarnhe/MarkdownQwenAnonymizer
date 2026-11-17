import {ENTITY_GBNF_GRAMMAR} from "../core/grammar";
import type {ExtractedEntities} from "../core/types";

declare const ObjC:any;
declare const $:any;
function ns(value:string):any{return $.NSString.stringWithString(value);}
function unwrap(value:any):string{return String(ObjC.unwrap(value));}

/** Standalone macOS JXA HTTP transport.
 * JXA on current macOS does not expose NSMutableURLRequest reliably.
 * Use Foundation NSTask + built-in /usr/bin/curl with JSON sent through stdin:
 * no Node, no shell interpolation, and no plaintext request files.
 */
export class CocoaLlamaClient {
  constructor(private readonly url:string="http://127.0.0.1:9931") {}
  private timeoutSeconds():string {
    const env=$.NSProcessInfo.processInfo.environment;
    const raw=ObjC.unwrap(env.objectForKey("ANONYMIZER_TIMEOUT_MS"));
    const ms=raw==null?600000:Number(raw);
    if(!Number.isSafeInteger(ms)||ms<=0||ms>4294967295)throw new Error("Invalid ANONYMIZER_TIMEOUT_MS");
    return String(ms/1000);
  }

  extractEntitiesFromChunk(text:string):ExtractedEntities {
    ObjC.import("Foundation");
    const prompt=[
      "请提取中国法律文档的人名、机构名、身份证、手机号、统一社会信用代码。忽略其他编号、金额、日期及美国SSN。",
      "严格输出JSON，字段顺序：persons、organizations、id_cards、codes，值均为字符串数组。身份证放id_cards，手机和统一社会信用代码放codes。不要解释。",
      "【文本内容】\n"+text
    ].join("\n");
    const body=JSON.stringify({
      messages:[{role:"user",content:prompt}],max_tokens:2048,temperature:0,
      grammar:ENTITY_GBNF_GRAMMAR,stream:false
    });
    const result=this.request("/v1/chat/completions",body);
    const decoded=JSON.parse(result);
    const choice=decoded.choices?.[0];
    if(choice?.finish_reason==="length")
      throw new Error("llama-server entity extraction truncated (finish_reason=length; max_tokens=2048)");
    const content=choice?.message?.content;
    if(typeof content!=="string")throw new Error("No JSON model response");
    const found=JSON.parse(content);
    for(const key of ["persons","organizations","id_cards","codes"]) {
      if(!Array.isArray(found[key]) || !found[key].every((v:unknown)=>typeof v==="string"))
        throw new Error("Invalid extracted field: "+key);
    }
    return found as ExtractedEntities;
  }
  cacheIdentity():string {
    ObjC.import("Foundation");
    const models=JSON.parse(this.request("/v1/models"));
    if(!models.data?.[0]?.id)throw new Error("Cannot identify llama-server model");
    const revision=ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey("ANONYMIZER_MODEL_REVISION"));
    return this.url+":"+models.data[0].id+":"+(revision||"");
  }
  private request(endpoint:string,body?:string):string {
    ObjC.import("Foundation");
    const task=$.NSTask.alloc.init;
    const stdin=$.NSPipe.pipe,stdout=$.NSPipe.pipe,stderr=$.NSPipe.pipe;
    task.launchPath="/usr/bin/curl";
    task.arguments=[
      "--silent","--show-error","--write-out","\n%{http_code}","--max-time",this.timeoutSeconds(),
      "--request",body===undefined?"GET":"POST","--header","Content-Type: application/json",
      "--data-binary","@-",this.url+endpoint
    ];
    task.standardInput=stdin;
    task.standardOutput=stdout;
    task.standardError=stderr;
    task.launch;
    const writer=stdin.fileHandleForWriting;
    writer.writeData(ns(body||"").dataUsingEncoding($.NSUTF8StringEncoding));
    writer.closeFile;
    // Response is bounded by max_tokens=2048; reject truncated completions.
    const resultData=stdout.fileHandleForReading.readDataToEndOfFile;
    const errorData=stderr.fileHandleForReading.readDataToEndOfFile;
    task.waitUntilExit;
    const result=unwrap($.NSString.alloc.initWithDataEncoding(resultData,$.NSUTF8StringEncoding));
    const errorText=unwrap($.NSString.alloc.initWithDataEncoding(errorData,$.NSUTF8StringEncoding));
    if(Number(task.terminationStatus)!==0)
      throw new Error("llama-server curl failed ("+Number(task.terminationStatus)+")");
    const split=result.lastIndexOf("\n");
    const status=Number(result.slice(split+1));
    if(status<200||status>=300)throw new Error("llama-server HTTP "+status);
    return result.slice(0,split);
  }

}
