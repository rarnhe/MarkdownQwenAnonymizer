import {test} from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {MarkdownDirectoryAnonymizer,getMappingPath} from "../src/core/processor";
import {createNodeFilePort} from "../src/adapters/node-fs";
import type {EntityExtractor} from "../src/core/types";

test("Node processes a single Markdown file, sibling JSON, and restores without LLM",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"node-anonymizer-file-"));
  try{
    const input=path.join(tmp,"contract.md"),plain="姓名：李明\n机构：深圳星辰科技有限公司\n手机：13800138000";
    await fs.writeFile(input,plain);
    await fs.writeFile(path.join(tmp,"untouched.txt"),plain);
    assert.equal(getMappingPath(input,false),path.join(tmp,"contract.json"));
    assert.equal(getMappingPath(path.join(tmp,"cases"),true),path.join(tmp,"cases.json"));
    let calls=0;
    const model:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){calls++;return {
        persons:["李明"],organizations:["深圳星辰科技有限公司"],
        id_cards:[],codes:["13800138000"]
      };}
    };
    const job=new MarkdownDirectoryAnonymizer(input,model,createNodeFilePort());
    const one=await job.process();
    assert.equal(one.action,"anonymized");
    assert.equal(one.fileCount,1);
    assert.equal(one.mapPath,path.join(tmp,"contract.json"));
    assert.equal(calls,1);
    assert.equal(await fs.readFile(input,"utf8"),"姓名：「李*」\n机构：「深圳星*司」\n手机：「1380013****」");
    const restored=await job.process();
    assert.equal(restored.action,"restored");
    assert.equal(calls,1);
    assert.equal(await fs.readFile(input,"utf8"),plain);
    await assert.rejects(fs.stat(one.mapPath),/ENOENT/);
    assert.equal(await fs.readFile(path.join(tmp,"untouched.txt"),"utf8"),plain);
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("single input rejects non-Markdown and existing invalid sibling JSON without overwriting it",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"node-anonymizer-invalid-"));
  try{
    const input=path.join(tmp,"doc.md");
    await fs.writeFile(input,"姓名：李明");
    const json=path.join(tmp,"doc.json");
    await fs.writeFile(json,"{}oops");
    const model:EntityExtractor={
      async verifyCotBudgetControl(){throw Error("No LLM expected");},
      async extractEntitiesFromChunk(){throw Error("No LLM expected");}
    };
    await assert.rejects(()=>new MarkdownDirectoryAnonymizer(input,model,createNodeFilePort()).process(),/Invalid mapping JSON/);
    assert.equal(await fs.readFile(input,"utf8"),"姓名：李明");
    assert.equal(await fs.readFile(json,"utf8"),"{}oops");
    const txt=path.join(tmp,"doc.txt");
    await fs.writeFile(txt,"hello");
    await assert.rejects(()=>new MarkdownDirectoryAnonymizer(txt,model,createNodeFilePort()).process(),/Single-file input must be/);
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
