import type {Categories,EntityMapping} from "./types";
export function makeMapping(categories:Categories):EntityMapping {
  const mapping:EntityMapping={placeholderToReal:Object.create(null),realToPlaceholder:Object.create(null)};
  for(const prefix of ["PER","ORG","NUM"] as const) {
    for(const [index,real] of categories[prefix].entries()) {
      if(mapping.realToPlaceholder[real]) continue;
      const token="["+prefix+"_"+String(index+1).padStart(3,"0")+"]";
      mapping.placeholderToReal[token]=real;
      mapping.realToPlaceholder[real]=token;
    }
  }
  return mapping;
}
export function anonymizeText(text:string,mapping:EntityMapping):string {
  const terms=Object.keys(mapping.realToPlaceholder).sort((a,b)=>b.length-a.length || a.localeCompare(b));
  if(!terms.length) return text;
  const escaped=terms.map(value=>value.replace(/[|\\{}()[\]^$+*?.]/g,"\\$&"));
  const pattern=new RegExp(escaped.join("|"),"g");
  // Single-pass replacement avoids replacing parts of already created placeholders.
  return text.replace(pattern,match=>mapping.realToPlaceholder[match]);
}
