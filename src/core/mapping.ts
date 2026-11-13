import {findProtectedNumericSpans,isChineseIdNumber,isChineseMobileNumber,isUnifiedSocialCreditCode} from "./numbers";
import type {Categories,EntityMapping} from "./types";

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
function addMapping(real:string,token:string,mapping:EntityMapping,used:Set<string>):void {
  if(mapping.realToPlaceholder[real])return;
  let unique=token,suffix=0;
  while(used.has(unique)) {
    suffix++;
    unique=token.endsWith("]") ? token.slice(0,-1)+"-"+suffix+"]" : token+"-"+suffix;
  }
  used.add(unique);
  mapping.placeholderToReal[unique]=real;
  mapping.realToPlaceholder[real]=unique;
}

/** Allocate collision-aware masks for one numeric identifier family. */
function addMaskedNumbers(
  values:string[],kind:"ID"|"USCC"|"PHONE",mapping:EntityMapping,used:Set<string>
):void {
  const unique=[...new Set(values)].filter(value=>!mapping.realToPlaceholder[value]);
  const prefixLength=kind==="ID"?6:kind==="USCC"?8:7;
  const groups=new Map<string,string[]>();
  for(const value of unique) {
    const prefix=value.slice(0,prefixLength);
    const group=groups.get(prefix) ?? [];
    group.push(value);groups.set(prefix,group);
  }
  const candidates=unique.map(real=>{
    const prefix=real.slice(0,prefixLength);
    const collision=(groups.get(prefix)?.length ?? 0)>1;
    let base:string;
    if(kind==="ID")
      base=prefix+"*".repeat(collision?11:12)+(collision?real.slice(-1).toUpperCase():"");
    else if(kind==="USCC")
      base=prefix+"*".repeat(collision?9:10)+(collision?real.slice(-1).toUpperCase():"");
    else
      base=prefix+"****";
    return {real,base};
  });
  const baseGroups=new Map<string,typeof candidates>();
  for(const candidate of candidates) {
    const group=baseGroups.get(candidate.base) ?? [];
    group.push(candidate);baseGroups.set(candidate.base,group);
  }
  for(const candidate of candidates) {
    const collisionGroup=baseGroups.get(candidate.base) ?? [];
    const index=collisionGroup.findIndex(item=>item.real===candidate.real);
    const requested=collisionGroup.length>1
      ? candidate.base+"-"+(index+1)
      : candidate.base;
    addMapping(candidate.real,requested,mapping,used);
  }
}

/** Human-readable and reversible mapping for names, organisations and Chinese identifiers. */
export function makeMapping(categories:Categories,reservedTokens:ReadonlySet<string>=new Set()):EntityMapping {
  const mapping:EntityMapping={
    placeholderToReal:Object.create(null),
    realToPlaceholder:Object.create(null)
  };
  const used=new Set(reservedTokens);
  for(const kind of ["PER","ORG"] as const) {
    for(const real of categories[kind]) {
      if(mapping.realToPlaceholder[real])continue;
      addMapping(real,chineseLabel(real,kind),mapping,used);
    }
  }

  // Only recognized Chinese IDs, mainland mobile numbers and unified social
  // credit codes are masked. Generic contract numbers, case numbers and other
  // identifiers are intentionally unchanged, even if a model extracted them.
  const idValues=[...(categories.ID ?? []),...categories.NUM.filter(isChineseIdNumber)];
  const phoneValues=[...(categories.PHONE ?? []),...categories.NUM.filter(isChineseMobileNumber)];
  const usccValues=[...(categories.USCC ?? []),
    ...categories.NUM.filter(v=>isUnifiedSocialCreditCode(v) && !isChineseIdNumber(v))];

  addMaskedNumbers(idValues,"ID",mapping,used);
  addMaskedNumbers(usccValues,"USCC",mapping,used);
  addMaskedNumbers(phoneValues,"PHONE",mapping,used);
  return mapping;
}

/** One-pass longest-match replacement; dates and money spans remain untouched. */
export function anonymizeText(text:string,mapping:EntityMapping):string {
  const terms=Object.keys(mapping.realToPlaceholder).sort((a,b)=>b.length-a.length || a.localeCompare(b));
  if(!terms.length)return text;
  const escaped=terms.map(value=>value.replace(/[|\\{}()[\]^$+*?.]/g,"\\$&"));
  const pattern=new RegExp(escaped.join("|"),"g");
  const replace=(fragment:string)=>fragment.replace(pattern,found=>mapping.realToPlaceholder[found]);
  const protectedSpans=findProtectedNumericSpans(text);
  if(!protectedSpans.length)return replace(text);
  let result="",cursor=0;
  for(const span of protectedSpans) {
    result+=replace(text.slice(cursor,span.start));
    result+=text.slice(span.start,span.end);
    cursor=span.end;
  }
  return result+replace(text.slice(cursor));
}


/** Reverse the exact map in one pass, preferring the longest placeholder.
 * Numeric masks are bounded by digits so a mask cannot match inside a longer number.
 */
export function restoreText(
  text:string,placeholderToReal:Readonly<Record<string,string>>
):string {
  const tokens=Object.keys(placeholderToReal)
    .filter(token=>token.length>0)
    .sort((a,b)=>b.length-a.length || a.localeCompare(b));
  if(!tokens.length)return text;
  const alternatives=tokens.map(token=>{
    const escaped=token.replace(/[|\\{}()[\]^$+*?.-]/g,"\\$&");
    return /^\d+\*+[0-9A-Z]?(-\d+)?$/i.test(token)
      ? "(?<![0-9])"+escaped+"(?![0-9])"
      : escaped;
  });
  const pattern=new RegExp(alternatives.join("|"),"g");
  return text.replace(pattern,token=>placeholderToReal[token]);
}
