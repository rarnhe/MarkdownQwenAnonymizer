#!/usr/bin/env node
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const esbuild=require("esbuild");
const root=__dirname;
const outDir=path.join(root,"dist");
fs.mkdirSync(outDir,{recursive:true});
const common={
  entryPoints:[path.join(root,"src/hosts/jxa.ts")],
  bundle:true,platform:"neutral",format:"iife",globalName:"JxaAnonymizer",
  target:"es2020",logLevel:"info"
};
const cli=path.join(outDir,"anonymizer.osascript.js");
const automator=path.join(outDir,"anonymizer.automator.js");
esbuild.buildSync({...common,outfile:cli,
  banner:{js:"#!/usr/bin/osascript -l JavaScript"},
  footer:{js:"\nfunction run(argv) { return JxaAnonymizer.run(argv); }\n"}
});
fs.chmodSync(cli,0o755);
// Finder Quick Action: full engine code is generated at top level, before run().
const automatorFooter=[
  "function run(input, parameters) {",
  '  ObjC.import("Foundation");',
  "  if (!input || input.length !== 1) {",
  '    throw new Error("Select one Markdown file or one folder in Finder.");',
  "  }",
  "  var selected = input[0];",
  '  var raw = typeof selected === "string" ? selected : selected.toString();',
  "  var posixPath = ObjC.unwrap($.NSString.stringWithString(String(raw)).stringByStandardizingPath);",
  "  JSON.parse(JxaAnonymizer.run([posixPath]));",
  "  return input;",
  "}"
].join("\n");
esbuild.buildSync({...common,outfile:automator,
  footer:{js:"\n"+automatorFooter+"\n"}
});
console.log(JSON.stringify({
  artifacts:["dist/anonymizer.osascript.js","dist/anonymizer.automator.js"],
  bundleBytes:{osascript:fs.statSync(cli).size,automator:fs.statSync(automator).size},
  nodeRuntime:false
}));
