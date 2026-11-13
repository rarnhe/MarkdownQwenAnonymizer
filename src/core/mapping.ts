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

/** Strip leading administrative prefixes while remembering the most specific place.
 * City names appear in long organization masks; aliases remain city-free.
 */
function splitPlacePrefix(value:string):{place:string;core:string} {
  let core=value.trim(),place="";
  for(let i=0;i<2;i++) {
    const prefix=GEOGRAPHICAL_PREFIXES.find(p=>core.startsWith(p) && core.length>p.length+1);
    if(!prefix)break;
    core=core.slice(prefix.length).trimStart();
    place=prefix.replace(/(?:特别行政区|自治区|省|市)$/,"");
  }
  return {place,core};
}
function chineseLabel(real:string,kind:"PER"|"ORG"):string {
  const {place,core}=kind==="ORG" ? splitPlacePrefix(real) : {place:"",core:real.trim()};
  const chars=Array.from(core.replace(/\s+/g,""));
  if(chars.length<2)return kind==="PER"?"[人*]":"[机*]";
  // Only full, relatively long organization names retain the leading city.
  const city=kind==="ORG" && place && chars.length>=6 ? place : "";
  return "["+city+chars[0]+"*"+(chars.length===2?"":chars[chars.length-1])+"]";
}
/** Register one real value exactly once. Never rewrite a previously assigned mask.
 * On a collision, numeric IDs/credit codes reveal the final check character,
 * while names and remaining collisions are distinguished by additional stars.
 */
function addMapping(
  real:string,initialMask:string,mapping:EntityMapping,used:Set<string>,
  checkDigitMask?:string
):void {
  if(Object.hasOwn(mapping.realToPlaceholder,real))return;
  if(!initialMask.startsWith("[") || !initialMask.endsWith("]") || !initialMask.includes("*"))
    throw new Error("A reversible mask must be bracketed and contain a star");
  let mask=initialMask;
  if(used.has(mask) && checkDigitMask)mask=checkDigitMask;
  while(used.has(mask))mask=mask.replace(/\*+/,stars=>stars+"*");
  used.add(mask);
  mapping.placeholderToReal[mask]=real;
  mapping.realToPlaceholder[real]=mask;
}

/** Allocate numeric masks one real value at a time in first-mention order.
 * The first number uses a full masked suffix; only a NEW colliding value
 * reveals the last check character. If that still collides, add more stars.
 */
function addMaskedNumbers(
  values:string[],kind:"ID"|"USCC"|"PHONE",mapping:EntityMapping,used:Set<string>
):void {
  const prefixLength=kind==="ID"?6:kind==="USCC"?8:7;
  for(const real of values) {
    if(Object.hasOwn(mapping.realToPlaceholder,real))continue;
    const prefix=real.slice(0,prefixLength);
    const maskedCount=real.length-prefixLength;
    const initialMask="["+prefix+"*".repeat(maskedCount)+"]";
    const checkDigitMask=kind==="PHONE"?undefined
      :"["+prefix+"*".repeat(maskedCount-1)+real.slice(-1).toUpperCase()+"]";
    addMapping(real,initialMask,mapping,used,checkDigitMask);
  }
}

/** Human-readable and reversible mapping for names, organisations and Chinese identifiers. */
export function makeMapping(
  categories:Categories,
  reservedTokens:ReadonlySet<string>=new Set(),
  markdownDocuments:readonly string[]=[]
):EntityMapping {
  const mapping:EntityMapping={
    placeholderToReal:Object.create(null),
    realToPlaceholder:Object.create(null)
  };
  const used=new Set(reservedTokens);
  // The first visible mention gets the shortest available mask; duplicate originals reuse it.
  // This avoids depending on model output ordering or locale-specific sorting.
  const source=markdownDocuments.join("\n\n");
  const byAppearance=(values:string[]):string[]=> {
    if(!markdownDocuments.length)return values;
    return [...values].sort((a,b)=>{
      const ia=source.indexOf(a),ib=source.indexOf(b);
      return (ia<0?Infinity:ia)-(ib<0?Infinity:ib);
    });
  };
  for(const kind of ["PER","ORG"] as const) {
    for(const real of byAppearance(categories[kind])) {
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

  addMaskedNumbers(byAppearance(idValues),"ID",mapping,used);
  addMaskedNumbers(byAppearance(usccValues),"USCC",mapping,used);
  addMaskedNumbers(byAppearance(phoneValues),"PHONE",mapping,used);
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
 * Bracketed masks match exactly; legacy unbracketed numeric masks retain digit boundaries.
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
