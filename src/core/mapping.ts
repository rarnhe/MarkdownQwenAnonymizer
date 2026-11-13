import {findDateSpans,isDateOnlyToken} from "./dates";
import type {Categories,EntityMapping} from "./types";

/**
 * Common geographical prefixes only, longest first. This is intentionally an
 * explicit, conservative dictionary, not a rule that removes arbitrary first
 * two Chinese characters (which could be part of an organisation's name).
 */
const GEOGRAPHICAL_PREFIXES=[
  "新疆维吾尔自治区","广西壮族自治区","宁夏回族自治区",
  "内蒙古自治区","西藏自治区","香港特别行政区","澳门特别行政区",
  "北京市","天津市","上海市","重庆市",
  "广东省","浙江省","江苏省","福建省","山东省","河北省",
  "河南省","湖北省","湖南省","四川省","陕西省","山西省",
  "辽宁省","吉林省","黑龙江省","安徽省","江西省","海南省",
  "贵州省","云南省","甘肃省","青海省","台湾省",
  "深圳市","广州市","杭州市","南京市","武汉市","成都市",
  "苏州市","东莞市","佛山市","珠海市","厦门市","青岛市",
  "宁波市","长沙市","西安市","郑州市","合肥市","福州市",
  "深圳","广州","杭州","南京","武汉","成都","苏州","东莞",
  "佛山","珠海","厦门","青岛","宁波","长沙","西安","郑州",
  "合肥","福州","北京","天津","上海","重庆"
].sort((a,b)=>b.length-a.length);

function stripPlacePrefix(value:string):string {
  let result=value.trim();
  // Allow e.g. 广东省深圳市腾讯... or 深圳腾讯..., but stop after
  // removing a province and a city. No arbitrary substring removal.
  for(let i=0;i<2;i++) {
    const prefix=GEOGRAPHICAL_PREFIXES.find(p=>result.startsWith(p) && result.length>p.length+1);
    if(!prefix)break;
    result=result.slice(prefix.length).trimStart();
  }
  return result;
}
function chineseLabel(real:string,kind:"PER"|"ORG"):string {
  const clean=kind==="ORG" ? stripPlacePrefix(real):real.trim();
  const chars=Array.from(clean.replace(/\s+/g,""));
  if(chars.length<2) return kind==="PER" ? "[人*]" : "[机*]";
  const content=chars.length===2 ? chars[0]+"*" : chars[0]+"*"+chars[chars.length-1];
  return "["+content+"]";
}

/**
 * Mapping keys are human-readable, globally unique, and reversible. Two real
 * entities with the same visual abbreviation get -1, -2, ... deterministically.
 * reservedTokens prevents collision with already-literal bracket text in input.
 */
export function makeMapping(categories:Categories,reservedTokens:ReadonlySet<string>=new Set()):EntityMapping {
  const mapping:EntityMapping={
    placeholderToReal:Object.create(null),
    realToPlaceholder:Object.create(null)
  };
  const used=new Set(reservedTokens);
  let numericIndex=0;
  for(const kind of ["PER","ORG","NUM"] as const) {
    for(const real of categories[kind]) {
      if(mapping.realToPlaceholder[real])continue;
      if(kind==="NUM" && isDateOnlyToken(real))continue;
      const preferred=kind==="NUM"
        ? "[NUM_"+String(++numericIndex).padStart(3,"0")+"]"
        : chineseLabel(real,kind);
      let token=preferred;
      const root=preferred.slice(0,-1);
      let suffix=0;
      while(used.has(token))token=root+"-"+(++suffix)+"]";
      used.add(token);
      mapping.placeholderToReal[token]=real;
      mapping.realToPlaceholder[real]=token;
    }
  }
  return mapping;
}

/** One-pass longest-match replacement, with date spans excluded beforehand. */
export function anonymizeText(text:string,mapping:EntityMapping):string {
  const terms=Object.keys(mapping.realToPlaceholder).sort((a,b)=>b.length-a.length || a.localeCompare(b));
  if(!terms.length)return text;
  const escaped=terms.map(value=>value.replace(/[|\\{}()[\]^$+*?.]/g,"\\$&"));
  const pattern=new RegExp(escaped.join("|"),"g");
  const replace=(fragment:string)=>fragment.replace(pattern,found=>mapping.realToPlaceholder[found]);
  const protectedDates=findDateSpans(text);
  if(!protectedDates.length)return replace(text);
  let result="",cursor=0;
  for(const span of protectedDates) {
    result+=replace(text.slice(cursor,span.start));
    result+=text.slice(span.start,span.end);
    cursor=span.end;
  }
  return result+replace(text.slice(cursor));
}
