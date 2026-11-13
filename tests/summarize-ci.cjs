#!/usr/bin/env node
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const stages=[
  ["npm ci","STAGE_NPM","npm-ci.log"],
  ["TypeScript typecheck","STAGE_TYPECHECK","typecheck.log"],
  ["Anonymizer unit tests","STAGE_UNIT","unit.log"],
  ["Qwen GGUF download","STAGE_MODEL","download.log"],
  ["Real llama-server startup","STAGE_SERVER","server-ready.log"],
  ["Real Qwen GGUF integration","STAGE_LIVE","live.log"]
];
const lines=[
  "# MarkdownQwenAnonymizer 双轨测试报告","",
  "- CI 时间（UTC）: "+new Date().toISOString(),
  "- GitHub run: "+(process.env.GITHUB_RUN_ID || "local"),
  "- Commit SHA: "+(process.env.GITHUB_SHA || "local"),"",
  "## GitHub Actions 与 test_report.md 阶段结果","",
  "| 阶段 | 状态 | 日志 |","|---|---|---|"
];
for(const [name,env,log] of stages) {
  const status=(process.env[env] || "unknown").toUpperCase();
  lines.push("| "+name+" | **"+status+"** | tests/output/"+log+" |");
}
const failed=stages.filter(([,env])=>process.env[env]!=="success");
lines.push("","## 失败项","");
if(!failed.length)lines.push("- 无，所有必须阶段成功。");
for(const [name,,log] of failed) {
  lines.push("### "+name,"");
  const file=path.join(root,"tests/output",log);
  if(fs.existsSync(file)) {
    const tail=fs.readFileSync(file,"utf8").split(/\r?\n/).slice(-35).map(line=>line.slice(0,350));
    lines.push("~~~text",...tail,"~~~");
  } else lines.push("- 没有对应日志（阶段可能未启动）。");
  lines.push("");
}
lines.push("","## 模型与隐私说明","",
  "- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。",
  "- 不上传 GGUF 权重或含真实值的 anonymize-map.json。",
  "- 真实资料发布前仍必须人工核对遗漏实体。","");
fs.writeFileSync(path.join(root,"test_report.md"),lines.join("\n"),"utf8");
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join("\n"),"utf8");
console.log(lines.join("\n"));
