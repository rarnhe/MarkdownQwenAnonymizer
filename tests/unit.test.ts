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
test("longest-match single-pass mapping is reversible",()=>{
  const mapping=makeMapping({PER:["李明"],ORG:["深圳星辰科技有限公司","星辰科技"],NUM:["110101199001012345","HT-2026-0001"]});
  const rendered=anonymizeText("李明，深圳星辰科技有限公司，110101199001012345，HT-2026-0001",mapping);
  assert.match(rendered,/\[李\*\]/);
  assert.match(rendered,/\[星\*司\]/);
  assert.ok(rendered.includes("110101************"));
  assert.ok(rendered.includes("HT-2026-0001"));
  assert.doesNotMatch(rendered,/\[NUM_\d+\]/);
  assert.ok(!Object.values(mapping.placeholderToReal).includes("HT-2026-0001"));
  assert.ok(!rendered.includes("星辰科技"));
  assert.equal(mapping.placeholderToReal["[李*]"],"李明");
});
test("in-place recursive overwrite retains filenames, creates one root map and rejects rerun",async()=>{
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
    assert.equal(first.outputDir,source);
    assert.equal(first.mapPath,path.join(source,"anonymize-map.json"));
    assert.ok(calls===first.chunkCount && calls>=2);
    const map=JSON.parse(await fs.readFile(first.mapPath,"utf8"));
    assert.equal(map["[李*]"],"李明");
    assert.ok(Object.values(map).includes("13800138000"));
    assert.ok(Object.values(map).includes("91350211M000100Y43"));
    assert.ok(!Object.values(map).includes("HT-2026-0001"));
    for(const file of ["case.md","nested/reference.markdown"]) {
      const output=await fs.readFile(path.join(source,file),"utf8");
      for(const sensitive of ["李明","深圳星辰科技有限公司","110101199001012345","13800138000"])
        assert.ok(!output.includes(sensitive),"leaked token in "+file+": "+sensitive);
      assert.ok(output.includes("110101************"));
      assert.ok(output.includes("1380013****"));
      assert.ok(output.includes("91350211**********"));
      assert.ok(output.includes("HT-2026-0001"),"generic codes must remain unchanged");
      assert.doesNotMatch(output,/\[NUM_\d+\]/);
      assert.match(output,/\[李\*\]/);
      assert.match(output,/\[星\*司\]/);
    }
    const mainOutput=await fs.readFile(path.join(source,"case.md"),"utf8");
    assert.ok(mainOutput.includes("123-45-6789"));
    assert.ok(mainOutput.includes("60000万元"));
    assert.ok(mainOutput.includes("2025年"));
    assert.ok(!await exists(path.join(tmp,"cases_脱敏后")));
    assert.ok(!await exists(path.join(source,".anonymize_map.json")));
    assert.deepEqual((await fs.readdir(source)).sort(),["anonymize-map.json","case.md","nested"].sort());
    assert.deepEqual(await fs.readdir(path.join(source,"nested")),["reference.markdown"]);
    if(process.platform!=="win32")
      assert.equal((await fs.stat(first.mapPath)).mode & 0o777,0o600);
    const previous=await fs.readFile(path.join(source,"case.md"),"utf8");
    await assert.rejects(()=>job.process(),/Existing anonymize-map\.json/);
    assert.equal(await fs.readFile(path.join(source,"case.md"),"utf8"),previous);
  }finally {await fs.rm(tmp,{force:true,recursive:true});}
});

async function exists(p:string):Promise<boolean> {
  try {await fs.stat(p);return true;}catch(e) {
    if((e as NodeJS.ErrnoException).code==="ENOENT")return false;
    throw e;
  }
}

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
    await assert.rejects(()=>new MarkdownDirectoryAnonymizer(source,broken,createNodeFilePort()).process(),/bad JSON/);
    assert.equal(await fs.readFile(path.join(source,"case.md"),"utf8"),text);
    assert.ok(!await exists(path.join(source,"anonymize-map.json")));
    assert.deepEqual(await fs.readdir(source),["case.md"]);
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
    assert.ok(!await exists(path.join(source,"anonymize-map.json")));
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
