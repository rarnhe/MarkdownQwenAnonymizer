import * as path from "node:path";
import type {FilePort} from "../ports/file-port";
import type {EntityExtractor,EntityMapping} from "./types";
import {GlobalEntityStore} from "./store";
import {createChunks} from "./chunks";
import {makeMapping,anonymizeText} from "./mapping";

export interface AnonymizeResult {
  outputDir:string;
  fileCount:number;
  chunkCount:number;
  counts:{PER:number;ORG:number;NUM:number};
}
export class MarkdownDirectoryAnonymizer {
  private readonly srcDirPath:string;
  constructor(dirPath:string,private readonly client:EntityExtractor,private readonly fs:FilePort) {
    this.srcDirPath=path.resolve(dirPath);
  }
  private async getAllMarkdownFiles(dir:string):Promise<string[]> {
    const entries=(await this.fs.readdir(dir)).sort((a,b)=>a.name.localeCompare(b.name));
    const files:string[]=[];
    for(const entry of entries) {
      if(entry.name.startsWith(".")) continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory && !entry.name.endsWith("_脱敏后"))
        files.push(...await this.getAllMarkdownFiles(full));
      else if(entry.isFile && /\.(md|markdown)$/i.test(entry.name)) files.push(full);
    }
    return files;
  }
  async process():Promise<AnonymizeResult> {
    if(!(await this.fs.stat(this.srcDirPath)).isDirectory) throw new Error("Expected a Markdown directory");
    const mdFiles=await this.getAllMarkdownFiles(this.srcDirPath);
    if(!mdFiles.length) throw new Error("No .md or .markdown files found");
    const contents=await Promise.all(mdFiles.map(async p=>({
      relativePath:path.relative(this.srcDirPath,p),content:await this.fs.readFile(p,"utf8")
    })));
    const store=new GlobalEntityStore();
    const controllable=await this.client.verifyCotBudgetControl();
    let chunkCount=0;
    // Finish *all* extractions before creating any output. Fail closed on server/JSON errors.
    for(const file of contents) {
      store.applyRegexFallback(file.content);
      for(const chunk of createChunks(file.content,20000,50)) {
        store.addEntities(await this.client.extractEntitiesFromChunk(chunk,controllable));
        chunkCount++;
      }
    }
    const categories=store.exportSortedCategories();
    const reserved=new Set<string>();
    for(const file of contents) {
      for(const match of file.content.matchAll(/\[[^\]\r\n]{1,80}\]/g))reserved.add(match[0]);
    }
    const mapping:EntityMapping=makeMapping(categories,reserved);
    const parent=path.dirname(this.srcDirPath);
    const stem=path.basename(this.srcDirPath)+"_脱敏后";
    let targetDirPath=path.join(parent,stem);
    for(let suffix=2;;suffix++) {
      try {await this.fs.mkdir(targetDirPath);break;}
      catch(error) {
        if((error as NodeJS.ErrnoException).code!=="EEXIST") throw error;
        targetDirPath=path.join(parent,stem+" "+suffix);
      }
    }
    await this.fs.writeFile(path.join(targetDirPath,".anonymize_map.json"),
      JSON.stringify(mapping.placeholderToReal,null,2)+"\n",{flag:"wx",mode:0o600});
    for(const file of contents) {
      const target=path.join(targetDirPath,file.relativePath);
      await this.fs.mkdir(path.dirname(target),{recursive:true});
      await this.fs.writeFile(target,anonymizeText(file.content,mapping),{flag:"wx"});
    }
    return {outputDir:targetDirPath,fileCount:contents.length,chunkCount,
      counts:{PER:categories.PER.length,ORG:categories.ORG.length,NUM:categories.NUM.length}};
  }
}
