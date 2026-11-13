import {MarkdownDirectoryAnonymizer} from "../core/processor";
import {createNodeFilePort} from "../adapters/node-fs";
import {LlamaServerClient} from "../adapters/llama-server";

async function main():Promise<void> {
  const [input,...extra]=process.argv.slice(2);
  if(!input || extra.length) {
    console.error("Usage: npx tsx ./src/hosts/node.ts <markdown-directory>");
    process.exitCode=2;
    return;
  }
  try {
    const url=process.env.LLAMA_SERVER_URL || "http://127.0.0.1:9931";
    const job=new MarkdownDirectoryAnonymizer(input,new LlamaServerClient(url),createNodeFilePort());
    const result=await job.process();
    console.log(JSON.stringify(result,null,2));
    if(result.action==="restored") {
      console.log("RESTORED: Markdown files were reversed using .anonymize-map.json; the mapping file was deleted. Run again to anonymize.");
    } else {
      console.log("WARNING: Markdown files were overwritten IN PLACE. Local .gitignore excludes .anonymize-map.json from normal git add; it contains plaintext identifiers. Never share or force-add it.");
    }
  } catch(error) {
    console.error("Markdown processing failed:",error);
    process.exitCode=1;
  }
}
void main();
