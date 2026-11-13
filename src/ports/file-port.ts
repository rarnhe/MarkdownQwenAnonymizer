/** Filesystem boundary; safe in-place writes use temporary siblings and renames. */
export interface FileEntry {name:string;isDirectory:boolean;isFile:boolean;}
export interface FilePort {
  stat(path:string):Promise<{isDirectory:boolean;mode:number}>;
  readdir(path:string):Promise<FileEntry[]>;
  readFile(path:string,encoding:"utf8"):Promise<string>;
  mkdir(path:string,options?:{recursive?:boolean;mode?:number}):Promise<unknown>;
  writeFile(path:string,data:string,options?:{flag?:string;mode?:number}):Promise<void>;
  chmod(path:string,mode:number):Promise<void>;
  rename(from:string,to:string):Promise<void>;
  unlink(path:string):Promise<void>;
}
