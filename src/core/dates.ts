/** Recognised dates remain literal, even when a model extracted their digits as a code. */
export interface DateSpan {start:number;end:number;}
function validDay(year:number,month:number,day:number):boolean {
  if(month<1 || month>12 || day<1 || day>31)return false;
  const max=new Date(Date.UTC(year,month,0)).getUTCDate();
  return day<=max;
}
export function findDateSpans(text:string):DateSpan[] {
  // Fully formed Chinese year/month/day and dotted, slashed, hyphenated dates.
  // Boundaries avoid treating a digit sequence embedded in an identifier as a date.
  const chinese=/(?<![A-Za-z0-9])((?:18|19|20|21)\d{2})年(?:([0-9]{1,2})月(?:([0-9]{1,2})日)?)?(?![A-Za-z0-9])/g;
  const numeric=/(?<![A-Za-z0-9])((?:18|19|20|21)\d{2})([./-])([0-9]{1,2})\2([0-9]{1,2})(?![A-Za-z0-9])/g;
  const spans:DateSpan[]=[];
  for(const match of text.matchAll(chinese)) {
    const year=Number(match[1]),month=match[2]===undefined ? undefined:Number(match[2]);
    const day=match[3]===undefined ? undefined:Number(match[3]);
    if(month!==undefined && (month<1 || month>12))continue;
    if(month!==undefined && day!==undefined && !validDay(year,month,day))continue;
    spans.push({start:match.index,end:match.index+match[0].length});
  }
  for(const match of text.matchAll(numeric)) {
    if(!validDay(Number(match[1]),Number(match[3]),Number(match[4])))continue;
    spans.push({start:match.index,end:match.index+match[0].length});
  }
  spans.sort((a,b)=>a.start-b.start || b.end-a.end);
  // Merge any overlapping protected date matches.
  const merged:DateSpan[]=[];
  for(const span of spans) {
    const last=merged[merged.length-1];
    if(last && span.start<=last.end)last.end=Math.max(last.end,span.end);
    else merged.push({...span});
  }
  return merged;
}
export function isDateOnlyToken(text:string):boolean {
  const trimmed=text.trim();
  return findDateSpans(trimmed).some(span=>span.start===0 && span.end===trimmed.length);
}
