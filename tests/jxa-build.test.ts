import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import * as fs from "node:fs";
test("standalone JXA entrypoints compile to two valid JS files with only Cocoa host adapters",()=>{
  execFileSync(process.execPath,["build.js"],{stdio:"pipe"});
  const cli=fs.readFileSync("dist/anonymizer.osascript.js","utf8");
  const automator=fs.readFileSync("dist/anonymizer.automator.js","utf8");
  assert.match(cli,/^#!\/usr\/bin\/osascript -l JavaScript/);
  assert.match(cli,/function run\(argv\)/);
  assert.match(automator,/function run\(input, parameters\)/);
  assert.ok(automator.indexOf("var JxaAnonymizer")<automator.indexOf("function run(input, parameters)"));
  assert.ok(!cli.includes("node:fs"));
  assert.ok(!automator.includes("node:crypto"));
});
