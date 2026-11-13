export interface ExtractedEntities {
  persons: string[];
  organizations: string[];
  id_cards: string[];
  codes: string[];
}
export interface EntityMapping {
  placeholderToReal: Record<string,string>;
  realToPlaceholder: Record<string,string>;
}
export interface EntityExtractor {
  verifyCotBudgetControl(): Promise<boolean>;
  extractEntitiesFromChunk(text: string, cotControllable: boolean): Promise<ExtractedEntities>;
}
export interface Categories {
  PER:string[];
  ORG:string[];
  NUM:string[];
  ID?:string[];
  PHONE?:string[];
  USCC?:string[];
}
