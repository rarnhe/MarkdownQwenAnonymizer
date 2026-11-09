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
    for(const secret of ["李明","深圳星辰科技有限公司","110101199001012345","13800138000","123-45-6789"])
      assert.ok(!output.includes(secret),"Unmasked entity "+secret);
    for(const prefix of ["PER","ORG","NUM"])assert.ok(output.includes("["+prefix+"_"));
    const mapping=JSON.parse(await fs.readFile(path.join(result.outputDir,".anonymize_map.json"),"utf8")) as Record<string,string>;
    assert.ok(Object.values(mapping).includes("李明"));
    assert.ok(Object.values(mapping).includes("13800138000"));
    console.log("PASS REAL GGUF: one Markdown, categories PER/ORG/NUM and reversible mapping");
    console.log(JSON.stringify({files:result.fileCount,chunks:result.chunkCount,counts:result.counts}));
  }finally {await fs.rm(dir,{force:true,recursive:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
