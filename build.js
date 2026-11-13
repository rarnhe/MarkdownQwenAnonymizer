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
// Finder Quick Action: script engine is initialized outside Automator's run().
esbuild.buildSync({...common,outfile:automator,
  footer:{js: