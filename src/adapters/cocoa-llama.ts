import {ENTITY_GBNF_GRAMMAR} from "../core/grammar";
import type {ExtractedEntities} from "../core/types";

declare const ObjC:any;
declare const $:any;
declare const Ref:any;
function ns(value:string):any{return $.NSString.stringWithString(value);}
function unwrap(value:any):string{return String(ObjC.unwrap(value));}

/** Foundation's synchronous HTTP bridge allows JXA to run without Node/fetch. */
export class CocoaLlamaClient {
  constructor(private readonly url:string="http://127.0.0.1:9931") {}

  extractEntitiesFromChunk(text:string):ExtractedEntities {
    ObjC.import("Foundation");
    const request=$.NSMutableURLRequest.requestWithURL($.NSURL.URLWithString(ns(this.url+"/v1/chat/completions")));
    request.setHTTPMethod(ns("POST"));
    request.setValueForHTTPHeaderField(ns("application/json"),ns("Content-Type"));
    request.setTimeoutInterval(180);
    const prompt=[
      "请提取中国法律文档的人名、机构名、身份证、手机号、统一社会信用代码。忽略其他编号、金额、日期及美国SSN。",
      "严格输出JSON，字段顺序：persons、organizations、id_cards、codes，值均为字符串数组。身份证放id_cards，手机和统一社会信用代码放codes。不要解释。",
      "【文本内容】\n"+text
    ].join("\n");
    const body=JSON.stringify({
      messages:[{role:"user",content:prompt}],max_tokens:192,temperature:0,
      grammar:ENTITY_GBNF_GRAMMAR,stream:false
    });
    request.setHTTPBody(ns(body).dataUsingEncoding($.NSUTF8StringEncoding));
    const response=Ref(),error=Ref();
    const data=$.NSURLConnection.sendSynchronousRequestReturningResponseError(request,response,error);
    if(!data)throw new Error("llama-server request failed: "+String(error[0]||"no data"));
    const responseObj=response[0];
    const status=responseObj?Number(responseObj.statusCode):200;
    const result=unwrap($.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding));
    if(status<200||status>=300)throw new Error("llama-server HTTP "+status+": "+result.slice(0,250));
    const decoded=JSON.parse(result);
    const content=decoded.choices?.[0]?.message?.content;
    if(typeof content!=="string")throw new Error("No JSON model response");
    const found=JSON.parse(content);
    for(const key of ["persons","organizations","id_cards","codes"]) {
      if(!Array.isArray(found[key]) || !found[key].every((v:unknown)=>typeof v==="string"))
        throw new Error("Invalid extracted field: "+key);
    }
    return found as ExtractedEntities;
  }
}
