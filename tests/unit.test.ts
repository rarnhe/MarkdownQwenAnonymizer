import {test} from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {createServer} from "node:http";
import {createNodeFilePort} from "../src/adapters/node-fs";
import {LlamaServerClient} from "../src/adapters/llama-server";
import {createChunks,createDocumentChunks,MAX_CHUNK_CHARS,CHUNK_OVERLAP_CHARS} from "../src/core/chunks";
import {ENTITY_GBNF_GRAMMAR} from "../src/core/grammar";
import {makeMapping,anonymizeText} from "../src/core/mapping";
import {MarkdownDirectoryAnonymizer} from "../src/core/processor";
import {GlobalEntityStore} from "../src/core/store";
import type {EntityExtractor,ExtractedEntities} from "../src/core/types";

const sample:ExtractedEntities={
  persons:["李明"],organizations:["深圳星辰科技有限公司"],
  id_cards:["110101199001012345"],codes:["HT-2026-0001"]
};

test("GBNF requires all four JSON arrays",()=>{
  for(const field of ["persons","organizations","id_cards","codes"])
    assert.ok(ENTITY_GBNF_GRAMMAR.includes(field));
  assert.match(ENTITY_GBNF_GRAMMAR,/root ::=/);
});
test("contract attachment: star-only collisions, bracketed numeric masks and exact reverse on the next run",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-contract-fixture-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(path.join(source,"nested"),{recursive:true});
    const fixture=await fs.readFile("tests/fixtures/contract-attachment.md","utf8");
    const file=path.join(source,"nested","attachment.markdown");
    await fs.writeFile(file,fixture);
    const ordinary="姓名：李明；手机：13800138000；身份证：110101199001012345";
    await fs.writeFile(path.join(source,"unrelated.txt"),ordinary);
    let llmCalls=0;
    const stub:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){
        llmCalls++;
        return {
          persons:["李逵","李明","李鬼","李明","李逵"],
          organizations:["深圳星辰科技有限公司","星辰公司"],
          id_cards:["110101199001012345","110101199001112345"],
          codes:["13800138000","91350211M000100Y43","91350211M002100Y48","HT-2026-0001"]
        };
      }
    };
    const job=new MarkdownDirectoryAnonymizer(source,stub,createNodeFilePort());
    const first=await job.process();
    if(first.action!=="anonymized")throw new Error("Expected anonymized action");
    assert.equal(first.fileCount,1);
    assert.equal(first.chunkCount,1);
    assert.equal(first.counts.PER,3);
    assert.equal(first.counts.ORG,2);
    assert.equal(first.counts.NUM,5,"two IDs, two USCCs and one repeated phone");
    assert.equal(llmCalls,1);
    const masked=await fs.readFile(file,"utf8");
    const mapPath=path.join(tmp,"cases.json");
    const map=JSON.parse(await fs.readFile(mapPath,"utf8")) as Record<string,string>;
    assert.equal(map["「李*」"],"李明");
    assert.equal(map["「李**」"],"李鬼");
    assert.equal(map["「李***」"],"李逵");
    assert.equal(map["「深圳星*司」"],"深圳星辰科技有限公司");
    assert.equal(map["「星*司」"],"星辰公司");
    assert.equal(map["「1380013****」"],"13800138000");
    assert.equal(map["「110101************」"],"110101199001012345");
    assert.equal(map["「110101***********5」"],"110101199001112345");
    assert.equal(map["「91350211**********」"],"91350211M000100Y43");
    assert.equal(map["「91350211*********8」"],"91350211M002100Y48");
    assert.equal(Object.keys(map).length,10);
    assert.ok(Object.keys(map).every(token=>token.startsWith("「")&&token.endsWith("」")));
    assert.ok(Object.keys(map).every(token=>!/-\d+」$/.test(token)),"no -1 suffix in masks");
    assert.ok(masked.includes("姓名：「李*」"));
    assert.ok(masked.includes("姓名：「李**」"));
    assert.ok(masked.includes("姓名：「李***」"));
    assert.ok(masked.includes("机构：「深圳星*司」"));
    assert.ok(masked.includes("机构：「星*司」"));
    assert.ok(masked.includes("手机：「1380013****」 手机：「1380013****」"));
    assert.ok(masked.includes("身份证：「110101************」"));
    assert.ok(masked.includes("身份证：「110101***********5」"));
    assert.ok(masked.includes("统一社会信用代码：「91350211**********」"));
    assert.ok(masked.includes("统一社会信用代码：「91350211*********8」"));
    assert.ok(masked.includes("合同编号：HT-2026-0001"));
    assert.equal(await fs.readFile(path.join(source,"unrelated.txt"),"utf8"),ordinary);
    const second=await job.process();
    assert.equal(second.action,"restored");
    assert.ok(!("chunkCount" in second) && !("counts" in second));
    assert.equal(llmCalls,1,"restoration must not call the local model");
    assert.equal(await fs.readFile(file,"utf8"),fixture,"restoration must be byte-for-byte identical");
    assert.equal(await fs.readFile(path.join(source,"unrelated.txt"),"utf8"),ordinary);
    assert.ok(!await exists(mapPath));
  } finally {await fs.rm(tmp,{recursive:true,force:true});}
});

test("cross-chunk deduplication classifies Chinese ID, mobile, USCC and ignores US SSN",()=>{
  const store=new GlobalEntityStore();
  store.addEntities(sample);
  store.addEntities(sample);
  store.applyRegexFallback("姓名：李明\n公司：深圳星辰科技有限公司\n身份证：110101199001012345\n手机：13800138000\n社会安全号码：123-45-6789\n统一社会信用代码：91350211M000100Y43");
  const data=store.exportSortedCategories();
  assert.deepEqual(data.PER,["李明"]);
  assert.deepEqual(data.ORG,["深圳星辰科技有限公司"]);
  assert.ok(data.ID?.includes("110101199001012345"),"missing Chinese ID");
  assert.ok(data.PHONE?.includes("13800138000"),"missing mobile number");
  assert.ok(data.USCC?.includes("91350211M000100Y43"),"missing unified social credit code");
  assert.deepEqual(data.NUM,[],"generic identifiers should not be extracted");
  assert.ok(!JSON.stringify(data).includes("123-45-6789"),"US SSN must be ignored");
  assert.equal(new Set([...data.NUM,...(data.ID??[]),...(data.PHONE??[]),...(data.USCC??[])]).size,
    data.NUM.length+(data.ID?.length??0)+(data.PHONE?.length??0)+(data.USCC?.length??0));
});
test("overlap chunker makes forward progress and preserves boundaries",()=>{
  const text="first\n"+"a".repeat(300)+"\nlast";
  const chunks=createChunks(text,60,10);
  assert.ok(chunks.length>4);
  assert.ok(chunks.every(c=>c.length>0 && c.length<=60));
  assert.ok(chunks[0].startsWith("first"));
  assert.ok(chunks[chunks.length-1].endsWith("last"));
  assert.throws(()=>createChunks(text,10,10));
});

test("directory-wide grouping makes two short Markdown files exactly one chunk",()=>{
  const docs=["姓名：何然\n","公司：深圳腾讯计算机有限公司\n"];
  const grouped=createDocumentChunks(docs);
  assert.equal(grouped.length,1);
  assert.ok(grouped[0].includes(docs[0].trim()));
  assert.ok(grouped[0].includes(docs[1].trim()));
  assert.ok(grouped[0].includes("文档分隔"));
  assert.equal(createDocumentChunks(["",""]).length,0);
  assert.equal(MAX_CHUNK_CHARS,6000);
  assert.equal(CHUNK_OVERLAP_CHARS,50);
  const longChunks=createDocumentChunks(["A".repeat(6500),"B".repeat(100)]);
  assert.equal(longChunks.length,2,"default document chunking must split at 6000 chars");
  assert.ok(longChunks.every(chunk=>chunk.length<=6000),"each LLM chunk must stay within 6,000 characters");
  assert.equal(longChunks[0].slice(-50),longChunks[1].slice(0,50),
    "adjacent chunks must retain exactly 50 characters of overlap");
});

test("existing .gitignore stays untouched with sibling JSON",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-ignore-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source,"a.md"),"姓名：李明");
    const existing="custom.txt\r\n*.secret\r\n";
    await fs.writeFile(path.join(source,".gitignore"),existing);
    const stub:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){return sample;}
    };
    const job=new MarkdownDirectoryAnonymizer(source,stub,createNodeFilePort());
    const result=await job.process();
    if(result.action!=="anonymized")throw new Error("Expected anonymization");
    assert.equal(result.chunkCount,1);
    const ignore=await fs.readFile(path.join(source,".gitignore"),"utf8");
    assert.equal(ignore,existing);
    assert.ok(await exists(path.join(tmp,"cases.json")));
    assert.deepEqual((await fs.readdir(source)).sort(),[".gitignore","a.md"].sort());
  }finally {await fs.rm(tmp,{force:true,recursive:true});}
});

test("rollback preserves preexisting .gitignore on map write failure",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-ignore-rollback-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(source);
    const text="姓名：李明";
    const originalIgnore="cache/\nprivate.md\n";
    await fs.writeFile(path.join(source,"a.md"),text);
    await fs.writeFile(path.join(source,".gitignore"),originalIgnore);
    const port=createNodeFilePort();
    const injected:typeof port={
      ...port,
      async writeFile(filepath,data,options) {
        if(filepath===path.join(tmp,"cases.json"))throw new Error("simulated map write error");
        return port.writeFile(filepath,data,options);
      }
    };
    const stub:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){return sample;}
    };
    await assert.rejects(()=>new MarkdownDirectoryAnonymizer(source,stub,injected).process(),/simulated map write error/);
    assert.equal(await fs.readFile(path.join(source,".gitignore"),"utf8"),originalIgnore);
    assert.equal(await fs.readFile(path.join(source,"a.md"),"utf8"),text);
    assert.deepEqual((await fs.readdir(source)).sort(),[".gitignore","a.md"].sort());
  }finally {await fs.rm(tmp,{recursive:true,force:true});}
});

test("longest-match single-pass mapping is reversible",()=>{
  const mapping=makeMapping({PER:["李明"],ORG:["深圳星辰科技有限公司","星辰科技"],NUM:["110101199001012345","HT-2026-0001"]});
  const rendered=anonymizeText("李明，深圳星辰科技有限公司，110101199001012345，HT-2026-0001",mapping);
  assert.match(rendered,/\「李\*\」/);
  assert.match(rendered,/\「深圳星\*司\」/);
  assert.ok(rendered.includes("110101************"));
  assert.ok(rendered.includes("HT-2026-0001"));
  assert.doesNotMatch(rendered,/「NUM_\d+」/);
  assert.ok(!Object.values(mapping.placeholderToReal).includes("HT-2026-0001"));
  assert.ok(!rendered.includes("星辰科技"));
  assert.equal(mapping.placeholderToReal["「李*」"],"李明");
});
test("recursive anonymization then next run restores Markdown only and deletes hidden map",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-anon-test-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(path.join(source,"nested"),{recursive:true});
    await fs.mkdir(path.join(source,".private"),{recursive:true});
    const originalCase=await fs.readFile("tests/fixtures/case.md","utf8");
    const originalReference=await fs.readFile("tests/fixtures/nested/reference.markdown","utf8");
    const hiddenOriginal="李明、深圳星辰科技有限公司\n";
    const textOriginal="李明 「李*」 110101************";
    await fs.copyFile("tests/fixtures/case.md",path.join(source,"case.md"));
    await fs.copyFile("tests/fixtures/nested/reference.markdown",path.join(source,"nested/reference.markdown"));
    await fs.writeFile(path.join(source,".private/hidden.markdown"),hiddenOriginal);
    await fs.writeFile(path.join(source,"notes.txt"),textOriginal);
    let calls=0,verifyCalls=0;
    const stub:EntityExtractor={
      async verifyCotBudgetControl(){verifyCalls++;return false;},
      async extractEntitiesFromChunk(){calls++;return sample;}
    };
    const job=new MarkdownDirectoryAnonymizer(source,stub,createNodeFilePort());
    const first=await job.process();
    if(first.action!=="anonymized")throw new Error("Expected anonymization");
    assert.equal(first.fileCount,3);
    assert.equal(first.outputDir,source);
    assert.equal(first.mapPath,path.join(tmp,"cases.json"));
    assert.equal(first.chunkCount,1,"short Markdown files share one global chunk");
    assert.equal(calls,1,"only one local LLM extraction request");
    const map=JSON.parse(await fs.readFile(first.mapPath,"utf8"));
    assert.equal(map["「李*」"],"李明");
    assert.ok(Object.values(map).includes("13800138000"));
    assert.ok(Object.values(map).includes("91350211M000100Y43"));
    assert.ok(!Object.values(map).includes("HT-2026-0001"));
    for(const file of ["case.md","nested/reference.markdown",".private/hidden.markdown"]) {
      const output=await fs.readFile(path.join(source,file),"utf8");
      assert.ok(!output.includes("李明"),"person was not masked in "+file);
      assert.ok(output.includes("「李*」"),"person mask missing in "+file);
      if(file!==" .private/hidden.markdown".trim()) {
        assert.ok(output.includes("「110101************」"),"bracketed ID mask missing in "+file);
        assert.ok(output.includes("「1380013****」"),"bracketed phone mask missing in "+file);
        assert.ok(output.includes("「91350211**********」"),"bracketed USCC mask missing in "+file);
      }
    }
    assert.equal(await fs.readFile(path.join(source,"notes.txt"),"utf8"),textOriginal,
      "non-Markdown files must never be anonymized");
    assert.ok(await exists(path.join(tmp,"cases.json")));
    assert.deepEqual((await fs.readdir(source)).sort(),
      [".private","case.md","nested","notes.txt"].sort());
    assert.ok(!await exists(path.join(source,".gitignore")));
    assert.deepEqual((await fs.readdir(path.join(source,"nested"))),["reference.markdown"]);
    if(process.platform!=="win32")
      assert.equal((await fs.stat(first.mapPath)).mode & 0o777,0o600);

    const second=await job.process();
    assert.equal(second.action,"restored");
    assert.equal(second.fileCount,3);
    assert.ok(!("chunkCount" in second),"restore JSON must not contain chunkCount");
    assert.ok(!("counts" in second),"restore JSON must not contain counts");
    assert.equal(await fs.readFile(path.join(source,"case.md"),"utf8"),originalCase);
    assert.equal(await fs.readFile(path.join(source,"nested/reference.markdown"),"utf8"),originalReference);
    assert.equal(await fs.readFile(path.join(source,".private/hidden.markdown"),"utf8"),hiddenOriginal);
    assert.equal(await fs.readFile(path.join(source,"notes.txt"),"utf8"),textOriginal,
      "restoration must not touch non-Markdown files");
    assert.equal(JSON.stringify(second).includes('"counts"'),false);
    assert.equal(JSON.stringify(second).includes('"chunkCount"'),false);
    assert.ok(!await exists(first.mapPath),"hidden map must be deleted after successful restoration");
    assert.ok(!await exists(path.join(source,".gitignore")));
    assert.equal(calls,1,"restoration must not call the local model");
    assert.equal(verifyCalls,1,"restoration must not probe the LLM server");
    assert.ok(!await exists(path.join(tmp,"cases_脱敏后")));
  }finally {await fs.rm(tmp,{force:true,recursive:true});}
});

async function exists(p:string):Promise<boolean> {
  try {await fs.stat(p);return true;}catch(e) {
    if((e as NodeJS.ErrnoException).code==="ENOENT")return false;
    throw e;
  }
}


test("restoration failure rolls back masked Markdown and retains the map for retry",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-restore-rollback-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(source);
    const maskedA="「李*」 在第一份文档";
    const maskedB="「李*」 在第二份文档";
    await fs.writeFile(path.join(source,"a.md"),maskedA);
    await fs.writeFile(path.join(source,"b.markdown"),maskedB);
    const mapPath=path.join(tmp,"cases.json");
    await fs.writeFile(mapPath,JSON.stringify({"「李*」":"李明"}));
    const actual=createNodeFilePort();
    let failOnce=true;
    const port={
      ...actual,
      async rename(from:string,to:string) {
        if(failOnce && to===path.join(source,"b.markdown") && from.endsWith(".new")) {
          failOnce=false;
          throw new Error("simulated restore rename error");
        }
        return actual.rename(from,to);
      }
    };
    const neverCall:EntityExtractor={
      async verifyCotBudgetControl(){throw new Error("LLM must not be called during restore");},
      async extractEntitiesFromChunk(){throw new Error("LLM must not be called during restore");}
    };
    await assert.rejects(
      ()=>new MarkdownDirectoryAnonymizer(source,neverCall,port).process(),
      /simulated restore rename error/
    );
    assert.equal(await fs.readFile(path.join(source,"a.md"),"utf8"),maskedA);
    assert.equal(await fs.readFile(path.join(source,"b.markdown"),"utf8"),maskedB);
    assert.ok(await exists(mapPath),"map must remain available after rollback");
    const retry=await new MarkdownDirectoryAnonymizer(source,neverCall,actual).process();
    assert.equal(retry.action,"restored");
    assert.equal(await fs.readFile(path.join(source,"a.md"),"utf8"),"李明 在第一份文档");
    assert.equal(await fs.readFile(path.join(source,"b.markdown"),"utf8"),"李明 在第二份文档");
    assert.ok(!await exists(mapPath));
  }finally {await fs.rm(tmp,{recursive:true,force:true});}
});

test("invalid map is rejected without modifying Markdown",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-invalid-map-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(source);
    const original="「李*」";
    await fs.writeFile(path.join(source,"a.md"),original);
    await fs.writeFile(path.join(tmp,"cases.json"),"{invalid");
    const neverCall:EntityExtractor={
      async verifyCotBudgetControl(){throw new Error("LLM must not be called");},
      async extractEntitiesFromChunk(){throw new Error("LLM must not be called");}
    };
    await assert.rejects(
      ()=>new MarkdownDirectoryAnonymizer(source,neverCall,createNodeFilePort()).process(),
      /Invalid mapping JSON/
    );
    assert.equal(await fs.readFile(path.join(source,"a.md"),"utf8"),original);
    assert.ok(await exists(path.join(tmp,"cases.json")));
  }finally {await fs.rm(tmp,{recursive:true,force:true});}
});

test("failed extraction leaves source and map untouched",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-anon-fail-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(source);
    const text="姓名：李明\n合同编号：HT-2026-0001";
    await fs.writeFile(path.join(source,"case.md"),text);
    const broken:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){throw new Error("bad JSON");}
    };
    await assert.rejects(()=>new MarkdownDirectoryAnonymizer(source,broken,createNodeFilePort()).process(),/Extraction failed/);
    assert.equal(await fs.readFile(path.join(source,"case.md"),"utf8"),text);
    assert.ok(!await exists(path.join(tmp,"cases.json")));
    assert.deepEqual(await fs.readdir(source),["case.md"]);
    assert.ok(!await exists(path.join(source,".gitignore")));
  }finally {await fs.rm(tmp,{force:true,recursive:true});}
});

test("rename failure restores earlier originals and removes root map and plaintext backups",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-anon-rollback-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(source);
    const originalA="姓名：李明；手机：13800138000";
    const originalB="姓名：李明；身份证：110101199001012345";
    await fs.writeFile(path.join(source,"a.md"),originalA);
    await fs.writeFile(path.join(source,"b.md"),originalB);
    const client:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){return sample;}
    };
    const actual=createNodeFilePort();
    let failOnce=true;
    const port={
      ...actual,
      async rename(from:string,to:string) {
        if(failOnce && to===path.join(source,"b.md") && from.endsWith(".new")) {
          failOnce=false;
          throw new Error("simulated rename error");
        }
        return actual.rename(from,to);
      }
    };
    await assert.rejects(
      ()=>new MarkdownDirectoryAnonymizer(source,client,port).process(),
      /simulated rename error/
    );
    assert.equal(await fs.readFile(path.join(source,"a.md"),"utf8"),originalA);
    assert.equal(await fs.readFile(path.join(source,"b.md"),"utf8"),originalB);
    assert.deepEqual((await fs.readdir(source)).sort(),["a.md","b.md"]);
    assert.ok(!await exists(path.join(source,".gitignore")));
    assert.ok(!await exists(path.join(tmp,"cases.json")));
  } finally {await fs.rm(tmp,{force:true,recursive:true});}
});

test("server HTTP 400 when CoT arguments unsupported triggers retry without them",async()=>{
  let requests=0;
  const server=createServer(async(req,res)=>{
    const bytes:Uint8Array[]=[];
    for await(const part of req) bytes.push(part as Uint8Array);
    const body=JSON.parse(Buffer.concat(bytes).toString("utf8"));
    requests++;
    if(body.reasoning_budget===0) {res.writeHead(400);res.end("Unsupported");return;}
    assert.ok(body.grammar.includes("id_cards"));
    assert.equal(body.max_tokens,2048,"entity extraction must request 2048 output tokens");
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(sample)}}]}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const address=server.address();
    if(!address || typeof address==="string")throw new Error("No server address");
    const client=new LlamaServerClient("http://127.0.0.1:"+address.port);
    assert.deepEqual(await client.extractEntitiesFromChunk("example",true),sample);
    assert.equal(requests,2);
  }finally {await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});

test("entity extraction rejects finish_reason=length before parsing even syntactically valid JSON",async()=>{
  let calls=0;
  const server=createServer(async(req,res)=>{
    const parts:Uint8Array[]=[];
    for await(const chunk of req)parts.push(chunk as Uint8Array);
    const body=JSON.parse(Buffer.concat(parts).toString("utf8"));
    assert.equal(body.max_tokens,2048);
    assert.ok(body.grammar.includes("id_cards"));
    calls++;
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({
      choices:[{finish_reason:"length",message:{content:JSON.stringify(sample)}}]
    }));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const address=server.address();
    if(!address || typeof address==="string")throw new Error("No server address");
    const client=new LlamaServerClient("http://127.0.0.1:"+address.port);
    await assert.rejects(client.extractEntitiesFromChunk("姓名：李明",false),
      /finish_reason=length/);
    assert.equal(calls,1);
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});

