import type {Categories,ExtractedEntities} from "./types";
import {isDateOnlyToken} from "./dates";
import {
  isChineseIdNumber,isChineseMobileNumber,isMoneyOnlyToken,
  isUnifiedSocialCreditCode,isUsSocialSecurityNumber,
  findMoneySpans,normalizeMoneyNumericValue
} from "./numbers";

/** One global dictionary for all Markdown files and overlapping chunks. */
export class GlobalEntityStore {
  private readonly persons = new Set<string>();
  private readonly organizations = new Set<string>();
  private readonly idCards = new Set<string>();
  private readonly phones = new Set<string>();
  private readonly unifiedSocialCreditCodes = new Set<string>();
  private readonly ignoredMoneyValues = new Set<string>();

  addEntities(entities: Partial<ExtractedEntities>): void {
    for(const value of entities.persons ?? []) this.add(value,this.persons);
    for(const value of entities.organizations ?? []) this.add(value,this.organizations);
    for(const value of entities.id_cards ?? []) this.addNumeric(value);
    for(const value of entities.codes ?? []) this.addNumeric(value);
  }

  private clean(value:unknown):string|undefined {
    if(typeof value!=="string")return undefined;
    const clean=value.trim().replace(/^["']|["']$/g,"");
    return clean.length>=2 && clean.length<=256 ? clean:undefined;
  }

  private add(value: unknown, destination: Set<string>): void {
    const clean=this.clean(value);
    if(clean)destination.add(clean);
  }

  private addNumeric(value:unknown):void {
    const clean=this.clean(value);
    if(!clean)return;
    if(isDateOnlyToken(clean) || isMoneyOnlyToken(clean) || isUsSocialSecurityNumber(clean))return;
    if(this.ignoredMoneyValues.has(normalizeMoneyNumericValue(clean)))return;

    // Classify specific Chinese identifiers before falling back to generic codes.
    if(isChineseIdNumber(clean)) this.idCards.add(clean);
    else if(isChineseMobileNumber(clean)) this.phones.add(clean);
    else if(isUnifiedSocialCreditCode(clean)) this.unifiedSocialCreditCodes.add(clean);
    // Generic contract numbers, case numbers and other codes are deliberately ignored.
  }

  /** Regex backstop for Chinese ID cards, mobile phones and unified credit codes. */
  applyRegexFallback(text: string): void {
    // Exclude amount values and their numeric cores from model output too
    // (e.g. a model returning "3000" for "3000元").
    for(const span of findMoneySpans(text)) {
      const raw=text.slice(span.start,span.end);
      this.ignoredMoneyValues.add(raw);
      this.ignoredMoneyValues.add(normalizeMoneyNumericValue(raw));
    }

    const idCards=/(?<!\d)[1-9]\d{5}(?:18|19|20|21)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;
    const uscc=/(?<![A-Z0-9])[0-9A-HJ-NP-QRTUWXY]{18}(?![A-Z0-9])/gi;
    const mobiles=/(?<!\d)1[3-9]\d{9}(?!\d)/g;
    for(const found of text.matchAll(idCards))this.addNumeric(found[0]);
    for(const found of text.matchAll(uscc))this.addNumeric(found[0]);
    for(const found of text.matchAll(mobiles))this.addNumeric(found[0]);

    // Explicitly labeled entities make the integration fixture deterministic even with a tiny model.
    const names=/(?:^|\n)\s*(?:姓名|人名|联系人)\s*[：:]\s*([^\s，,；;。]{2,30})/g;
    const orgs=/(?:^|\n)\s*(?:公司|公司名称|机构|组织|单位|企业名称)\s*[：:]\s*([^\s，,；;。]{2,100})/g;
    for(const found of text.matchAll(names)) this.add(found[1],this.persons);
    for(const found of text.matchAll(orgs)) this.add(found[1],this.organizations);
    // Deterministic alias backstop: 法律文档中的「以下简称腾讯公司」或「下简称腾讯公司」。
    const aliases=/(?:以下简称|下简称|简称)\s*[：:]?\s*["“‘「]?([一-鿿]{2,40}?(?:股份有限公司|有限责任公司|有限公司|公司|集团|事务所|研究所|研究院|协会|中心|银行))(?=[”"’」』）),，。；;\s]|$)/g;
    for(const found of text.matchAll(aliases)) this.add(found[1],this.organizations);
  }

  exportSortedCategories(): Categories {
    const sort=(set:Set<string>) => [...set].sort((a,b)=>b.length-a.length || a.localeCompare(b,"zh"));
    return {
      PER:sort(this.persons),ORG:sort(this.organizations),NUM:[],
      ID:sort(this.idCards),PHONE:sort(this.phones),USCC:sort(this.unifiedSocialCreditCodes)
    };
  }
}
