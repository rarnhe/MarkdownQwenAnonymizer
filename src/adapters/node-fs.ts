import * as fs from "node:fs/promises";
import type {FilePort} from "../ports/file-port";
/** Node host filesystem. Recursive traversal does not follow directory symlinks. */
export function createNodeFilePort():FilePort {
  return {
    async stat(p) {const s=await fs.stat(p);return {isDirectory:s.isDirectory(),mode:s.mode & 0o777};},
    async readdir(p) {return (await fs.readdir(p,{withFileTypes:true})).map(e=>({
      name:e.name,isDirectory:e.isDirectory(),isFile:e.isFile()
    }));},
    readFile(p,encoding) {return fs.readFile(p,encoding);},
    mkdir(p,options) {return fs.mkdir(p,options);},
    writeFile(p,data,options) {return fs.writeFile(p,data,options);},
    chmod(p,mode) {return fs.chmod(p,mode);},
    rename(from,to) {return fs.rename(from,to);},
    unlink(p) {return fs.unlink(p);}
  };
}
