/** Minimal real-GGUF E2E test: call the actual local llama-server, overwrite source
 * Markdown and verify the new reversible map. Comprehensive identifier,
 * dates, amounts and rollback cases live in the deterministic TS unit suite. */
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
    const original=[
      "姓名：李明",
      "公司：深圳星辰科技有限公司",
      "手机：13800138000",
      "合同编号：HT-2026-0001"
    ].join("\n")+"\n";
    await fs.writeFile(path.join(source,"case.md"),original);
    const job=new MarkdownDirectoryAnonymizer(source,new LlamaServerClient(url),createNodeFilePort());
    const result=await job.process();
    if(result.action!=="anonymized")throw new Error("Expected anonymization");
    assert.equal(result.fileCount,1);
    assert.equal(result.chunkCount,1);
    assert.ok(result.counts.PER>=1 && result.counts.ORG>=1 && result.counts.NUM>=1);
    assert.equal(result.outputDir,source);
    assert.equal(result.action,"anonymized");
    assert.equal(result.mapPath,path.join(source,".anonymize-map.json"));
    assert.equal(await fs.readFile(path.join(source,".gitignore"),"utf8"),".anonymize-map.json\n");
    const output=await fs.readFile(path.join(source,"case.md"),"utf8");
    assert.ok(output.includes("[李*]"),"Expected Chinese person mask");
    assert.ok(output.includes("[深圳星*司]"),"Expected city-aware Chinese organization mask");
    assert.ok(output.includes("[1380013****]"),"Expected bracketed mobile mask");
    assert.ok(output.includes("HT-2026-0001"),"Generic contract ID must remain unchanged");
    for(const raw of ["李明","深圳星辰科技有限公司","13800138000"])
      assert.ok(!output.includes(raw),"Unmasked entity "+raw);
    assert.doesNotMatch(output,/\[NUM_\d+\]/);
    const mapping=JSON.parse(await fs.readFile(result.mapPath,"utf8")) as Record<string,string>;
    for(const raw of ["李明","深圳星辰科技有限公司","13800138000"])
      assert.ok(Object.values(mapping).includes(raw),"Missing reversible original: "+raw);
    assert.ok(!Object.values(mapping).includes("HT-2026-0001"));
    assert.equal(mapping["[1380013****]"],"13800138000");
    const restored=await job.process();
    assert.equal(restored.action,"restored");
    assert.ok(!("counts" in restored) && !("chunkCount" in restored));
    assert.equal(await fs.readFile(path.join(source,"case.md"),"utf8"),original);
    await assert.rejects(()=>fs.stat(result.mapPath),/ENOENT/);
    await assert.rejects(()=>fs.stat(source+"_脱敏后"),/ENOENT/);
    console.log("PASS REAL GGUF: local inference, in-place Markdown overwrite, map and no generic NUM markers");
    console.log(JSON.stringify({files:result.fileCount,chunks:result.chunkCount,counts:result.counts}));
  } finally {await fs.rm(dir,{force:true,recursive:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
