import {findDateSpans} from "./dates";

export interface NumericSpan {start:number;end:number;}

const MONEY_PATTERN=/(?<!\d)(?:(?:人民币|RMB)\s*(?:[¥￥]\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:亿元|万元|元|亿|万))?|[¥￥]\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:亿元|万元|元|亿|万))(?![\p{L}\d])/giu;

export function findMoneySpans(text:string):NumericSpan[] {
  const spans:NumericSpan[]=[];
  MONEY_PATTERN.lastIndex=0;
  for(const match of text.matchAll(MONEY_PATTERN))
    spans.push({start:match.index,end:match.index+match[0].length});
  return spans;
}

export function normalizeMoneyNumericValue(value:string):string {
  return value.trim()
    .replace(/^(?:(?:人民币|RMB)\s*)?[¥￥]?\s*/i,"")
    .replace(/\s*(?:亿元|万元|元|亿|万)$/,"")
    .replace(/[,\s]/g,"");
}

export function isMoneyOnlyToken(value:string):boolean {
  const text=value.trim();
  return findMoneySpans(text).some(span=>span.start===0 && span.end===text.length);
}

export function isUsSocialSecurityNumber(value:string):boolean {
  return /^\d{3}-\d{2}-\d{4}$/.test(value.trim());
}

export function isChineseIdNumber(value:string):boolean {
  const match=/^[1-9]\d{5}((?:18|19|20|21)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.exec(value.trim());
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  return day<=new Date(Date.UTC(year,month,0)).getUTCDate();
}

export function isChineseMobileNumber(value:string):boolean {
  return /^1[3-9]\d{9}$/.test(value.trim());
}

export function isUnifiedSocialCreditCode(value:string):boolean {
  return /^[0-9A-HJ-NP-QRTUWXY]{18}$/i.test(value.trim());
}

export function findProtectedNumericSpans(text:string):NumericSpan[] {
  const spans=[...findDateSpans(text),...findMoneySpans(text)]
    .sort((a,b)=>a.start-b.start || b.end-a.end);
  const merged:NumericSpan[]=[];
  for(const span of spans) {
    const last=merged[merged.length-1];
    if(last && span.start<=last.end)last.end=Math.max(last.end,span.end);
    else merged.push({...span});
  }
  return merged;
}
