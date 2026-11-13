import {test} from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {findDateSpans,isDateOnlyToken} from "../src/core/dates";
import {anonymizeText,makeMapping} from "../src/core/mapping";
import {GlobalEntityStore} from "../src/core/store";
import {MarkdownDirectoryAnonymizer} from "../src/core/processor";
import {createNodeFilePort} from "../src/adapters/node-fs";
import type {Categories,EntityExtractor} from "../src/core/types";

function categories(PER:string[]=[],ORG:string[]=[],NUM:string[]=[]):Categories {
  return {PER,ORG,NUM};
}

test("three-character name reveals first and last; two-character collision adds -1",()=>{
  const map=makeMapping(categories(["许惠茹","何然","何瑞"]));
  assert.equal(map.realToPlaceholder["许惠茹"],"[许*茹]");
  assert.equal(map.realToPlaceholder["何然"],"[何*]");
  assert.equal(map.realToPlaceholder["何瑞"],"[何*-1]");
  assert.equal(map.placeholderToReal["[何*-1]"],"何瑞");
  const source="许惠茹会见何然。何瑞也在场。何然再次出现。";
  const masked=anonymizeText(source,map);
  assert.equal(masked,"[许*茹]会见[何*]。[何*-1]也在场。[何*]再次出现。");
  const restored=masked.replace(/\[[^\]]+\]/g,token=>map.placeholderToReal[token] ?? token);
  assert.equal(restored,source);
});
test("ignore Shenzhen locality and disambiguate company full name versus short name",()=>{
  const map=makeMapping(categories([],["深圳腾讯计算机有限公司","腾讯公司"]));
  assert.equal(map.realToPlaceholder["深圳腾讯计算机有限公司"],"[腾*司]");
  assert.equal(map.realToPlaceholder["腾讯公司"],"[腾*司-1]");
  const source="深圳腾讯计算机有限公司（下简称腾讯公司）与腾讯公司签署文件。";
  const masked=anonymizeText(source,map);
  assert.equal(masked,"[腾*司]（下简称[腾*司-1]）与[腾*司-1]签署文件。");
  assert.equal(map.placeholderToReal["[腾*司-1]"],"腾讯公司");
});
test("recognized administrative prefixes are stripped only at the start",()=>{
  const map=makeMapping(categories([],[
    "广东省深圳市腾讯计算机有限公司",
    "深圳腾讯计算机有限公司",
    "深圳市华星律师事务所",
    "海南省某某集团"
  ]));
  assert.equal(map.realToPlaceholder["广东省深圳市腾讯计算机有限公司"],"[腾*司]");
  assert.equal(map.realToPlaceholder["深圳腾讯计算机有限公司"],"[腾*司-1]");
  assert.equal(map.realToPlaceholder["深圳市华星律师事务所"],"[华*所]");
  assert.equal(map.realToPlaceholder["海南省某某集团"],"[某*团]");
});
test("preserve original literal brackets by reserving tokens before allocating",()=>{
  const map=makeMapping(categories(["何然","何瑞"]),new Set(["[何*]"]));
  assert.equal(map.realToPlaceholder["何然"],"[何*-1]");
  assert.equal(map.realToPlaceholder["何瑞"],"[何*-2]");
  assert.equal(anonymizeText("[何*] 是已存在内容；何然与何瑞",map),"[何*] 是已存在内容；[何*-1]与[何*-2]");
});
test("date spans protect years, Chinese full dates and dotted/slashed/hyphenated dates",()=>{
  const text="2025年、1970年1月1日、2026.09.08、2026/9/8、2026-09-08";
  const spans=findDateSpans(text);
  assert.deepEqual(spans.map(s=>text.slice(s.start,s.end)),[
    "2025年","1970年1月1日","2026.09.08","2026/9/8","2026-09-08"
  ]);
  assert.ok(isDateOnlyToken(" 2026.09.08 "));
  assert.ok(!isDateOnlyToken("2026.13.40"));
  assert.ok(!isDateOnlyToken("HT-2026-09-08-X"));
});
test("LLM-extracted time strings are excluded and date spans protect year substrings",()=>{
  const store=new GlobalEntityStore();
  store.addEntities({id_cards:["1970年1月1日"],codes:[
    "2025年","2026.09.08","2025","HT-2025-007"
  ]});
  const extracted=store.exportSortedCategories().NUM;
  for(const value of ["2025年","1970年1月1日","2026.09.08"])
    assert.ok(!extracted.includes(value),"date was extracted: "+value);
  assert.ok(extracted.includes("2025"));
  const map=makeMapping(categories([],[],extracted));
  const original="2025年签订，出生于1970年1月1日，归档于2026.09.08。编号2025，合同HT-2025-007。";
  const anonymized=anonymizeText(original,map);
  for(const date of ["2025年","1970年1月1日","2026.09.08"])
    assert.ok(anonymized.includes(date),"date changed: "+date);
  assert.ok(anonymized.includes("编号[NUM_"));
  assert.ok(!anonymized.includes("合同HT-2025-007"));
});
test("recursive Markdown uses a single reversible dictionary and leaves dates intact",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"markdown-masking-"));
  try {
    const source=path.join(tmp,"cases");
    await fs.mkdir(path.join(source,"nested"),{recursive:true});
    const fileA="许惠茹、何然、何瑞。深圳腾讯计算机有限公司。2025年，1970年1月1日。\n";
    const fileB="下简称腾讯公司；何瑞。2026.09.08。编号：HT-2025-007。\n";
    await fs.writeFile(path.join(source,"one.md"),fileA);
    await fs.writeFile(path.join(source,"nested","two.markdown"),fileB);
    const stub:EntityExtractor={
      async verifyCotBudgetControl(){return false;},
      async extractEntitiesFromChunk(){return {
        persons:["许惠茹","何然","何瑞"],
        organizations:["深圳腾讯计算机有限公司","腾讯公司"],
        id_cards:[],codes:["2025年","2026.09.08","HT-2025-007"]
      };}
    };
    const job=new MarkdownDirectoryAnonymizer(source,stub,createNodeFilePort());
    const result=await job.process();
    assert.equal(result.fileCount,2);
    const a=await fs.readFile(path.join(result.outputDir,"one.md"),"utf8");
    const b=await fs.readFile(path.join(result.outputDir,"nested","two.markdown"),"utf8");
    const mapping=JSON.parse(await fs.readFile(path.join(result.outputDir,".anonymize_map.json"),"utf8")) as Record<string,string>;
    assert.equal(a,"[许*茹]、[何*]、[何*-1]。[腾*司]。2025年，1970年1月1日。\n");
    assert.equal(b,"下简称[腾*司-1]；[何*-1]。2026.09.08。编号：[NUM_001]。\n");
    assert.equal(mapping["[何*-1]"],"何瑞");
    assert.equal(mapping["[腾*司-1]"],"腾讯公司");
    assert.ok(!Object.values(mapping).includes("2025年"));
    assert.ok(!Object.values(mapping).includes("2026.09.08"));
  } finally {await fs.rm(tmp,{recursive:true,force:true});}
});
