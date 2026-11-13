import {test} from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {findDateSpans,isDateOnlyToken} from "../src/core/dates";
import {findMoneySpans,isMoneyOnlyToken,isChineseIdNumber,isChineseMobileNumber,isUnifiedSocialCreditCode,isUsSocialSecurityNumber} from "../src/core/numbers";
import {anonymizeText,makeMapping,restoreText} from "../src/core/mapping";
import {GlobalEntityStore} from "../src/core/store";
import {MarkdownDirectoryAnonymizer} from "../src/core/processor";
import {createNodeFilePort} from "../src/adapters/node-fs";
import type {Categories,EntityExtractor} from "../src/core/types";

function categories(PER:string[]=[],ORG:string[]=[],NUM:string[]=[]):Categories {
  return {PER,ORG,NUM};
}

test("three-character name reveals first and last; same-surname two-character names add stars",()=>{
  const map=makeMapping(categories(["许惠茹","何然","何瑞"]));
  assert.equal(map.realToPlaceholder["许惠茹"],"[许*茹]");
  assert.equal(map.realToPlaceholder["何然"],"[何*]");
  assert.equal(map.realToPlaceholder["何瑞"],"[何**]");
  assert.equal(map.placeholderToReal["[何**]"],"何瑞");
  const source="许惠茹会见何然。何瑞也在场。何然再次出现。";
  const masked=anonymizeText(source,map);
  assert.equal(masked,"[许*茹]会见[何*]。[何**]也在场。[何*]再次出现。");
  const restored=restoreText(masked,map.placeholderToReal);
  assert.equal(restored,source);
});

test("same-surname masks follow first mention: 贺然 -> [贺*], 贺柜 -> [贺**]",()=>{
  const map=makeMapping(categories(["贺柜","贺然"]),new Set(),["贺然，贺柜，贺然。"]);
  assert.equal(map.realToPlaceholder["贺然"],"[贺*]");
  assert.equal(map.realToPlaceholder["贺柜"],"[贺**]");
  const input="贺然与贺柜签署，贺然复核。";
  assert.equal(restoreText(anonymizeText(input,map),map.placeholderToReal),input);
});

test("restoreText reverses longest tokens in one pass and bounds numeric masks",()=>{
  const map:Record<string,string>={
    "[腾*司]":"腾讯公司",
    "[深圳腾*司]":"深圳腾讯计算机有限公司",
    "[429114************]":"429114199001010018",
    "[1348579****]":"13485791234"
  };
  const masked="甲[深圳腾*司]乙[腾*司]丙；身份证[429114************]，手机[1348579****]。";
  assert.equal(restoreText(masked,map),
    "甲深圳腾讯计算机有限公司乙腾讯公司丙；身份证429114199001010018，手机13485791234。");
  assert.equal(restoreText("编号1429114************9",map),"编号1429114************9",
    "unbracketed or partial numeric mask must not be restored");
  assert.equal(restoreText("编号[429114************]",map),"编号429114199001010018");
  assert.equal(restoreText("编号[429114************]9",map),"编号4291141990010100189");
});

test("short forms after 下简称 / 以下简称 are extracted even when a small LLM misses them",()=>{
  const store=new GlobalEntityStore();
  store.applyRegexFallback("深圳腾讯计算机有限公司（下简称腾讯公司），以下简称“阿里公司”；简称：测试研究所。");
  const names=store.exportSortedCategories().ORG;
  assert.ok(names.includes("腾讯公司"));
  assert.ok(names.includes("阿里公司"));
  assert.ok(names.includes("测试研究所"));
});

test("ignore Shenzhen locality and disambiguate company full name versus short name",()=>{
  const map=makeMapping(categories([],["深圳腾讯计算机有限公司","腾讯公司"]));
  assert.equal(map.realToPlaceholder["深圳腾讯计算机有限公司"],"[深圳腾*司]");
  assert.equal(map.realToPlaceholder["腾讯公司"],"[腾*司]");
  const source="深圳腾讯计算机有限公司（下简称腾讯公司）与腾讯公司签署文件。";
  const masked=anonymizeText(source,map);
  assert.equal(masked,"[深圳腾*司]（下简称[腾*司]）与[腾*司]签署文件。");
  assert.equal(map.placeholderToReal["[腾*司]"],"腾讯公司");
});
test("recognized administrative prefixes are stripped only at the start",()=>{
  const map=makeMapping(categories([],[
    "广东省深圳市腾讯计算机有限公司",
    "深圳腾讯计算机有限公司",
    "深圳市华星律师事务所",
    "海南省某某集团"
  ]));
  assert.equal(map.realToPlaceholder["广东省深圳市腾讯计算机有限公司"],"[深圳腾*司]");
  assert.equal(map.realToPlaceholder["深圳腾讯计算机有限公司"],"[深圳腾**司]");
  assert.equal(map.realToPlaceholder["深圳市华星律师事务所"],"[深圳华*所]");
  assert.equal(map.realToPlaceholder["海南省某某集团"],"[某*团]");
});
test("preserve original literal brackets by reserving tokens before allocating",()=>{
  const map=makeMapping(categories(["何然","何瑞"]),new Set(["[何*]"]));
  assert.equal(map.realToPlaceholder["何然"],"[何**]");
  assert.equal(map.realToPlaceholder["何瑞"],"[何***]");
  assert.equal(anonymizeText("[何*] 是已存在内容；何然与何瑞",map),"[何*] 是已存在内容；[何**]与[何***]");
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
  assert.deepEqual(extracted,[],"non-identity codes and numbers are ignored");
  const map=makeMapping(categories([],[],extracted));
  const original="2025年签订，出生于1970年1月1日，归档于2026.09.08。编号2025，合同HT-2025-007。";
  const anonymized=anonymizeText(original,map);
  for(const date of ["2025年","1970年1月1日","2026.09.08"])
    assert.ok(anonymized.includes(date),"date changed: "+date);
  assert.ok(anonymized.includes("编号2025"));
  assert.ok(anonymized.includes("合同HT-2025-007"));
  assert.doesNotMatch(anonymized,/\[NUM_\d+\]/);

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
    if(result.action!=="anonymized")throw new Error("Expected anonymization");
    assert.equal(result.fileCount,2);
    assert.equal(result.chunkCount,1,"short files must share one extraction chunk");
    assert.equal(await fs.readFile(path.join(source,".gitignore"),"utf8"),".anonymize-map.json\n");
    const a=await fs.readFile(path.join(result.outputDir,"one.md"),"utf8");
    const b=await fs.readFile(path.join(result.outputDir,"nested","two.markdown"),"utf8");
    const mapping=JSON.parse(await fs.readFile(path.join(source,".anonymize-map.json"),"utf8")) as Record<string,string>;
    assert.equal(a,"[许*茹]、[何*]、[何**]。[深圳腾*司]。2025年，1970年1月1日。\n");
    assert.equal(b,"下简称[腾*司]；[何**]。2026.09.08。编号：HT-2025-007。\n");
    assert.equal(mapping["[何**]"],"何瑞");
    assert.equal(mapping["[腾*司]"],"腾讯公司");
    assert.ok(!Object.values(mapping).includes("2025年"));
    assert.ok(!Object.values(mapping).includes("2026.09.08"));
    assert.ok(!Object.values(mapping).includes("HT-2025-007"));
    assert.equal(result.outputDir,source);
  } finally {await fs.rm(tmp,{recursive:true,force:true});}
});


test("Chinese ID, mobile and unified social credit code receive format-preserving masks",()=>{
  const id="429114199001010018";
  const phone="13485791234";
  const uscc="91440300MA5F6WXY12";
  assert.ok(isChineseIdNumber(id));
  assert.ok(isChineseMobileNumber(phone));
  assert.ok(isUnifiedSocialCreditCode(uscc));
  const ignored=makeMapping(categories([],[],["60000万元","3000元","123-45-6789"]));
  assert.deepEqual(Object.keys(ignored.realToPlaceholder),[]);
  const map=makeMapping(categories([],[],[id,phone,uscc,"HT-2026-0001"]));
  assert.equal(map.realToPlaceholder[id],"[429114************]");
  assert.equal(map.realToPlaceholder[phone],"[1348579****]");
  assert.equal(map.realToPlaceholder[uscc],"[91440300**********]");
  assert.equal(map.realToPlaceholder["HT-2026-0001"],undefined);
  assert.equal(map.placeholderToReal["[429114************]"],id);
  assert.equal(restoreText(anonymizeText([id,phone,uscc].join(" "),map),map.placeholderToReal),[id,phone,uscc].join(" "));
});
test("same-area ID and same-prefix USCC reveal only the final check character on collision",()=>{
  const ids=["429114199001010018","429114199001010026"];
  const codes=["91440300MA5F6WXY12","91440300MA5F6WXY13"];
  const phones=["13485791234","13485795678"];
  const map=makeMapping(categories([],[],[...ids,...codes,...phones]));
  assert.equal(map.realToPlaceholder[ids[0]],"[429114***********8]");
  assert.equal(map.realToPlaceholder[ids[1]],"[429114***********6]");
  assert.equal(map.realToPlaceholder[codes[0]],"[91440300*********2]");
  assert.equal(map.realToPlaceholder[codes[1]],"[91440300*********3]");
  assert.equal(map.realToPlaceholder[phones[0]],"[1348579****]");
  assert.equal(map.realToPlaceholder[phones[1]],"[1348579*****]");
  assert.equal(new Set(Object.values(map.realToPlaceholder)).size,Object.keys(map.realToPlaceholder).length);
  for(const [masked,real] of Object.entries(map.placeholderToReal))
    assert.equal(map.realToPlaceholder[real],masked);
});
test("US SSN and monetary amounts are ignored even when returned by the model",()=>{
  const source="金额：60000万元、3000元、人民币5000元；SSN：123-45-6789；合同编号：HT-2026-0001。";
  const spans=findMoneySpans(source);
  assert.deepEqual(spans.map(span=>source.slice(span.start,span.end)),["60000万元","3000元","人民币5000元"]);
  for(const amount of ["60000万元","3000元","人民币5000元"])assert.ok(isMoneyOnlyToken(amount));
  assert.ok(isUsSocialSecurityNumber("123-45-6789"));

  const store=new GlobalEntityStore();
  store.applyRegexFallback(source);
  store.addEntities({codes:["60000万元","3000元","人民币5000元","60000","3000","5000","123-45-6789","HT-2026-0001"]});
  const data=store.exportSortedCategories();
  assert.deepEqual(data.NUM,[]);
  assert.ok(!JSON.stringify(data).includes("123-45-6789"));

  const map=makeMapping(categories([],[],data.NUM));
  const anonymized=anonymizeText(source,map);
  assert.ok(anonymized.includes("60000万元"));
  assert.ok(anonymized.includes("3000元"));
  assert.ok(anonymized.includes("人民币5000元"));
  assert.ok(anonymized.includes("123-45-6789"));
  assert.ok(anonymized.includes("HT-2026-0001"));
  assert.doesNotMatch(anonymized,/\[NUM_\d+\]/);
});
