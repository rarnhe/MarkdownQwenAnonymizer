/** Real macOS osascript binary smoke/integration: single file, recursive directory,
 * sibling mapping, exact restoration, Cocoa HTTP and Finder wrapper structure.
 * The stub HTTP server is launched in a separate process because execFileSync
 * blocks the parent Node event loop.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {execFileSync,spawn} from "node:child_process";

async function exists(file:string):Promise<boolean>{
  try{await fs.stat(file);return true;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return false;throw e;}
}
async function waitForStub():Promise<void>{
  for(let i=0;i<100;i++){
    try{if((await fetch("http://127.0.0.1:9931/health")).ok)return;}
    catch(_e){}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error("JXA test HTTP stub could not start");
}
function execute(file:string):Record<string,any> {
  // Explicitly execute the generated shebang deliverable itself, not TS or Node.
  const output=execFileSync(path.resolve("dist/anonymizer.osascript.js"),[file],{
    encoding:"utf8",timeout:90000
  });
  return JSON.parse(output.trim());
}

async function main():Promise<void>{
  if(process.platform!=="darwin")throw new Error("osascript integration requires macOS");
  const script=await fs.readFile("dist/anonymizer.osascript.js","utf8");
  const auto=await fs.readFile("dist/anonymizer.automator.js","utf8");
  assert.ok(script.startsWith("#!/usr/bin/osascript -l JavaScript"));
  assert.ok(script.includes("function run(argv)"));
  assert.ok(auto.includes("function run(input, parameters)"));
  assert.ok(auto.indexOf("var JxaAnonymizer")<auto.lastIndexOf("function run(input, parameters)"),
    "the Automator engine must be top level outside run()");
  assert.ok(!script.includes('require("node:'));
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"jxa-anonymizer-"));
  const server=spawn(process.execPath,[path.resolve("tests/jxa-stub-server.cjs")],{
    stdio:["ignore","pipe","pipe"]
  });
  let errors="";
  server.stderr.on("data",data=>{errors+=data.toString();});
  try{
    await waitForStub();
    const file=path.join(root,"contract.md");
    const content="姓名：李明\n机构：深圳星辰科技有限公司\n手机：13800138000\n合同编号：HT-2026-0001\n";
    await fs.writeFile(file,content);
    const one=execute(file);
    assert.equal(one.action,"anonymized");
    assert.equal(one.fileCount,1);
    assert.equal(one.mapPath,path.join(root,"contract.json"));
    assert.equal(await fs.readFile(file,"utf8"),
      "姓名：\u300c李*\u300d\n机构：\u300c深圳星*司\u300d\n手机：\u300c1380013****\u300d\n合同编号：HT-2026-0001\n");
    assert.ok(await exists(one.mapPath));
    assert.equal((await fs.stat(one.mapPath)).mode&0o777,0o600,"mapping file must be private");
    const two=execute(file);
    assert.equal(two.action,"restored");
    assert.equal(await fs.readFile(file,"utf8"),content);
    assert.ok(!await exists(one.mapPath));
    const folder=path.join(root,"cases");
    await fs.mkdir(path.join(folder,"nested"),{recursive:true});
    const a=path.join(folder,"first.md"),b=path.join(folder,"nested","second.markdown");
    const originalA="姓名：李明；姓名：李鬼；姓名：李逵。\n";
    const originalB="手机号：13800138000；身份证：110101199001012345；合同HT-2026-0001。\n";
    await fs.writeFile(a,originalA);
    await fs.writeFile(b,originalB);
    const directory=execute(folder);
    assert.equal(directory.action,"anonymized");
    assert.equal(directory.fileCount,2);
    assert.equal(directory.chunkCount,1);
    assert.equal(directory.mapPath,path.join(root,"cases.json"));
    const map=JSON.parse(await fs.readFile(directory.mapPath,"utf8"));
    assert.equal(map["「李*」"],"李明");
    assert.equal(map["「李**」"],"李鬼");
    assert.equal(map["「李***」"],"李逵");
    assert.ok((await fs.readFile(a,"utf8")).includes("「李***」"));
    assert.ok((await fs.readFile(b,"utf8")).includes("「110101************」"));
    assert.ok((await fs.readFile(b,"utf8")).includes("HT-2026-0001"));
    assert.ok(!await exists(path.join(folder,".gitignore")));
    assert.equal(execute(folder).action,"restored");
    assert.equal(await fs.readFile(a,"utf8"),originalA);
    assert.equal(await fs.readFile(b,"utf8"),originalB);
    assert.ok(!await exists(directory.mapPath));
    console.log("PASS JXA: executable osascript file + directory, Foundation HTTP, sibling map and exact restoration");
  }finally {
    server.kill("SIGTERM");
    await fs.rm(root,{recursive:true,force:true});
    if(server.exitCode && server.exitCode!==0)console.error("JXA stub stderr:",errors);
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
