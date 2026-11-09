import * as fs from "node:fs/promises";
import type {FilePort} from "../ports/file-port";
/** Node host file system. Symlinks are never followed by directory traversal. */
export function createNodeFilePort():FilePort {
  return {
    async stat(p) {const s=await fs.stat(p);return {isDirectory:s.isDirectory()};},
    async readdir(p) {return (await fs.readdir(p,{withFileTypes:true})).map(e=>({
      name:e.name,isDirectory:e.isDirectory(),isFile:e.isFile()
    }));},
    readFile(p,encoding) {return fs.readFile(p,encoding);},
    mkdir(p,options) {return fs.mkdir(p,options);},
    writeFile(p,data,options) {return fs.writeFile(p,data,options);}
  };
}
