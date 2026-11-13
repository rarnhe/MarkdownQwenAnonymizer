/** Integration test: real GGUF + local llama-server, never a mock. */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {MarkdownDirectoryAnonymizer} from "../src/core/processor";
import {createNodeFilePort} from "../src/adapters/node-fs";
import {LlamaServerClient} from "../src/adapters/llama-server";

async function main():Promise<void> {
  const url=process.env.LLAMA_SERVER_URL || "http://127.0.0.1:9931";
  const health=await fetch(url+"/health",{signal:AbortSignal.timeout(15000)});
  assert.ok(health.ok,"Real llama-server must be healthy");
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-qwen-live-"));
  try {
    const source=path.join(dir,"cases");
    await fs.mkdir(source);
    await fs.copyFile("tests/fixtures/case.md",path.join(source,"case.md"));
    const job=new MarkdownDirectoryAnonymizer(source,new LlamaServerClient(url),createNodeFilePort());
    const result=await job.process();
    assert.equal(result.fileCount,1);
    assert.equal(result.chunkCount,1);
    assert.ok(result.counts.PER>=1 && result.counts.ORG>=1 && result.counts.NUM>=3);
    const output=await fs.readFile(path.join(result.outputDir,"case.md"),"utf8");
    for(const secret of ["李明","深圳星辰科技有限公司","110101199001012345","13800138000","91350211M000100Y43"])
      assert.ok(!output.includes(secret),"Unmasked entity "+secret);
    assert.ok(output.includes("[李*]"),"Expected Chinese person mask");
    assert.ok(output.includes("110101************"),"Expected Chinese ID mask");
    assert.ok(output.includes("1380013****"),"Expected mobile mask");
    assert.ok(output.includes("91350211**********"),"Expected USCC mask");
    assert.ok(output.includes("123-45-6789"),"US SSN should remain untouched");
    assert.ok(output.includes("60000万元") && output.includes("3000元"),"Monetary amounts should remain untouched");
    assert.ok(output.includes("[星*司]"),"Expected Chinese organization mask");
    assert.match(output,/\[NUM_\d+\]/);
    for(const date of ["2025年","1970年1月1日","2026.09.08"])assert.ok(output.includes(date),"Date was modified: "+date);
    const mapping=JSON.parse(await fs.readFile(path.join(result.outputDir,".anonymize_map.json"),"utf8")) as Record<string,string>;
    assert.ok(Object.values(mapping).includes("李明"));
    assert.ok(Object.values(mapping).includes("13800138000"));
    assert.ok(Object.values(mapping).includes("110101199001012345"));
    assert.ok(Object.values(mapping).includes("91350211M000100Y43"));
    assert.ok(!Object.values(mapping).includes("123-45-6789"));
    console.log("PASS REAL GGUF: one Markdown, categories PER/ORG/NUM and reversible mapping");
    console.log(JSON.stringify({files:result.fileCount,chunks:result.chunkCount,counts:result.counts}));
  }finally {await fs.rm(dir,{force:true,recursive:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
