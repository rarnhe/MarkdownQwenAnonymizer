"use strict";
const http=require("node:http");
const data={
  persons:["李明","李鬼","李逵"],
  organizations:["深圳星辰科技有限公司","星辰公司"],
  id_cards:["110101199001012345","110101199001112345"],
  codes:["13800138000","91350211M000100Y43","91350211M002100Y48"]
};
const server=http.createServer(async(req,res)=>{
  if(req.url==="/health"){res.writeHead(200);res.end("ok");return;}
  if(req.method!=="POST" || req.url!=="/v1/chat/completions") {
    res.writeHead(404);res.end("not found");return;
  }
  let buffer="";
  for await(const chunk of req)buffer+=chunk.toString();
  try{
    const body=JSON.parse(buffer);
    if(!body.grammar?.includes("id_cards") || body.stream!==false || body.max_tokens!==2048)
      throw Error("Missing GBNF, max_tokens=2048 or invalid mode");
    res.setHeader("Content-Type","application/json");
    const truncated=String(body.messages?.[0]?.content||"").includes("FORCE_LENGTH_RESPONSE");
    res.end(JSON.stringify({choices:[{
      finish_reason:truncated?"length":"stop",
      message:{content:truncated?"{\\\"persons\\\":[\\\"李明":JSON.stringify(data)}
    }]}));
  }catch(e){res.writeHead(400);res.end(String(e));}
});
server.listen(9931,"127.0.0.1",()=>console.log("JXA STUB READY 9931"));
