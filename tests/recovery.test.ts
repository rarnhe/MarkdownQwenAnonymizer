import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {sha256} from "../src/core/sha256";
import {loadProgress,progressConfig} from "../src/core/recovery";
import {MarkdownDirectoryAnonymizer} from "../src/core/processor";
import {createNodeFilePort} from "../src/adapters/node-fs";
import type {EntityExtractor,ExtractedEntities} from "../src/core/types";
const entities:ExtractedEntities={persons:["李明"],organizations:[],codes:[],id_cards:[]};
test("portable UTF-8 SHA256 matches Node including surrogate replacement",()=>{
  for(const text of ["","abc","中文🙂","a".repeat(6000),"\ud800"])
    assert.equal(sha256(text),createHash("sha256").update(text).digest("hex"));
});
test("progress rejects changed inputs, model/config and malformed entities",()=>{
  const p=loadProgress(null,"input",progressConfig("model"),3);
  for(const [input,config] of [["changed",progressConfig("model")],["input",progressConfig("other")]])
    assert.throws(()=>loadProgress(JSON.stringify(p),input,config,3),/does not match/);
  p.results["a".repeat(64)]={} as ExtractedEntities;
  assert.throws(()=>loadProgress(JSON.stringify(p),"input",progressConfig("model"),3),/Invalid progress/);
});
test("416-file failure preserves originals, resumes completed chunks and restores exactly",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"recovery-"));
  try {
    const input=path.join(root,"cases");await fs.mkdir(input);
    const originals=Array.from({length:416},(_,i)=>`姓名：李明。文档${i}。`+"正文".repeat(10));
    for(let i=0;i<416;i++)await fs.writeFile(path.join(input,`${i}.md`),originals[i]);
    let calls=0,fail=true;
    const client:EntityExtractor={async verifyCotBudgetControl(){return false;},async extractEntitiesFromChunk(){
      calls++;if(fail&&calls===2)throw new Error("offline");return entities;
    }};
    const job=new MarkdownDirectoryAnonymizer(input,client,createNodeFilePort());
    await assert.rejects(job.process(),/Chunk 2/);
    const progress=input+".progress.json";
    assert.equal((await fs.stat(progress)).mode&0o777,0o600);
    assert.equal(Object.keys(JSON.parse(await fs.readFile(progress,"utf8")).results).length,1);
    for(let i=0;i<416;i++)assert.equal(await fs.readFile(path.join(input,`${i}.md`),"utf8"),originals[i]);
    await assert.rejects(fs.stat(input+".json"),/ENOENT/);
    fail=false;calls=0;
    const result=await job.process();assert.equal(result.action,"anonymized");
    if(result.action!=="anonymized")throw Error("wrong action");
    assert.equal(calls,result.chunkCount-1);
    await assert.rejects(fs.stat(progress),/ENOENT/);
    assert.equal((await job.process()).action,"restored");
    for(let i=0;i<416;i++)assert.equal(await fs.readFile(path.join(input,`${i}.md`),"utf8"),originals[i]);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
test("truncation splits with overlap and persists children; permanent truncation is bounded",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"split-"));
  try {
    const input=path.join(root,"case.md"),text="李明"+"文".repeat(5500);await fs.writeFile(input,text);
    const seen:string[]=[];
    const client:EntityExtractor={async verifyCotBudgetControl(){return false;},async extractEntitiesFromChunk(t){
      seen.push(t);if(t.length>3100)throw new Error("finish_reason=length");return entities;
    }};
    await new MarkdownDirectoryAnonymizer(input,client,createNodeFilePort()).process();
    assert.equal(seen.length,3);assert.equal(seen[1].slice(-50),seen[2].slice(0,50));
    assert.ok((await fs.readFile(input,"utf8")).startsWith("「李*」"));
    await new MarkdownDirectoryAnonymizer(input,client,createNodeFilePort()).process();
    let attempts=0;client.extractEntitiesFromChunk=async()=>{attempts++;throw new Error("finish_reason=length");};
    await assert.rejects(new MarkdownDirectoryAnonymizer(input,client,createNodeFilePort()).process(),/retry limit/);
    assert.ok(attempts<=4);assert.equal(await fs.readFile(input,"utf8"),text);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test("configured HTTP timeout aborts request and invalid timeouts are rejected",async()=>{
  const {createServer}=await import("node:http");
  const {LlamaServerClient}=await import("../src/adapters/llama-server");
  assert.throws(()=>new LlamaServerClient("http://127.0.0.1",0),/Invalid/);
  assert.throws(()=>new LlamaServerClient("http://127.0.0.1",NaN),/Invalid/);
  const server=createServer((_req,res)=>{const timer=setTimeout(()=>res.end("{}"),1000);res.on("close",()=>clearTimeout(timer));});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const addr=server.address();if(!addr||typeof addr==="string")throw Error("address");
    await assert.rejects(new LlamaServerClient(`http://127.0.0.1:${addr.port}`,20)
      .extractEntitiesFromChunk("synthetic",false),{name:"TimeoutError"});
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
