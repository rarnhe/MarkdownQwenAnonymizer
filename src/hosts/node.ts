import {MarkdownDirectoryAnonymizer} from "../core/processor";
import {createNodeFilePort} from "../adapters/node-fs";
import {LlamaServerClient} from "../adapters/llama-server";

async function main():Promise<void> {
  const [input,...extra]=process.argv.slice(2);
  if(!input || extra.length) {
    console.error("Usage: npm run anonymize -- <markdown-directory>");
    process.exitCode=2;
    return;
  }
  try {
    const url=process.env.LLAMA_SERVER_URL || "http://127.0.0.1:9931";
    const job=new MarkdownDirectoryAnonymizer(input,new LlamaServerClient(url),createNodeFilePort());
    const result=await job.process();
    console.log(JSON.stringify(result,null,2));
    console.log("WARNING: source Markdown files were overwritten IN PLACE. anonymize-map.json contains plaintext identifiers: do not commit or share.");
  } catch(error) {
    console.error("Anonymization failed:",error);
    process.exitCode=1;
  }
}
void main();
