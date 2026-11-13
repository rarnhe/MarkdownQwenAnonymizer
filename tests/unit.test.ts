import {test} from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {createServer} from "node:http";
import {createNodeFilePort} from "../src/adapters/node-fs";
import {LlamaServerClient} from "../src/adapters/llama-server";
import {createChunks} from "../src/core/chunks";
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
  assert.ok(data.NUM.includes("HT-2026-0001"),"missing generic contract code");
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
test("longest-match single-pass mapping is reversible",()=>{
  const mapping=makeMapping({PER:["李明"],ORG:["深圳星辰科技有限公司","星辰科技"],NUM:["110101199001012345","HT-2026-0001"]});
  const rendered=anonymizeText("李明，深圳星辰科技有限公司，110101199001012345，HT-2026-0001",mapping);
  assert.match(rendered,/\[李\*\]/);
  assert.match(rendered,/\[星\*司\]/);
  assert.ok(rendered.includes("110101************"));
  assert.match(rendered,/\[NUM_001\]/);
  assert.ok(!rendered.includes("星辰科技"));
  assert.equal(mapping.placeholderToReal["[李*]"],"李明");
});
test("real recursive filesystem output retains tree, uses one global map, never overwrites",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-anon-test-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(path.join(source,"nested"),{recursive:true});
    await fs.copyFile("tests/fixtures/case.md",path.join(source,"case.md"));
    await fs.copyFile("tests/fixtures/nested/reference.markdown",path.join(source,"nested/reference.markdown"));
    let calls=0;
    const stub:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){calls++;return sample;}
    };
    const job=new MarkdownDirectoryAnonymizer(source,stub,createNodeFilePort());
    const first=await job.process();
    assert.equal(first.fileCount,2);
    assert.ok(calls===first.chunkCount && calls>=2);
    const map=JSON.parse(await fs.readFile(path.join(first.outputDir,".anonymize_map.json"),"utf8"));
    assert.equal(map["[李*]"],"李明");
    for(const file of ["case.md","nested/reference.markdown"]) {
      const output=await fs.readFile(path.join(first.outputDir,file),"utf8");
      for(const sensitive of ["李明","深圳星辰科技有限公司","110101199001012345","13800138000"])
        assert.ok(!output.includes(sensitive),"leaked token in "+file+": "+sensitive);
      assert.ok(output.includes("123-45-6789"),"US SSN should remain untouched");
      assert.ok(output.includes("110101************"));
      assert.ok(output.includes("1380013****"));
      assert.ok(output.includes("91350211**********"));
      assert.match(output,/\[李\*\]/);
      assert.match(output,/\[星\*司\]/);
    }
    if(process.platform!=="win32")
      assert.equal((await fs.stat(path.join(first.outputDir,".anonymize_map.json"))).mode & 0o777,0o600);
    const second=await job.process();
    assert.notEqual(first.outputDir,second.outputDir);
    assert.ok(second.outputDir.endsWith("_脱敏后 2"));
  }finally {await fs.rm(tmp,{force:true,recursive:true});}
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
test("server invalid JSON aborts instead of emitting unmasked output",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-anon-fail-"));
  try {
    const dir=path.join(tmp,"cases");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir,"a.md"),"姓名：李明");
    const broken:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){throw new Error("bad JSON");}
    };
    await assert.rejects(()=>new MarkdownDirectoryAnonymizer(dir,broken,createNodeFilePort()).process(),/bad JSON/);
    await assert.rejects(()=>fs.stat(dir+"_脱敏后"),/ENOENT/);
  }finally {await fs.rm(tmp,{force:true,recursive:true});}
});
