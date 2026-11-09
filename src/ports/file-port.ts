/** File-system boundary, allowing a Node adapter and an in-memory test adapter. */
export interface FileEntry { name:string; isDirectory:boolean; isFile:boolean; }
export interface FilePort {
  stat(path:string):Promise<{isDirectory:boolean}>;
  readdir(path:string):Promise<FileEntry[]>;
  readFile(path:string,encoding:"utf8"):Promise<string>;
  mkdir(path:string,options?:{recursive?:boolean;mode?:number}):Promise<unknown>;
  writeFile(path:string,data:string,options?:{flag?:string;mode?:number}):Promise<void>;
}
