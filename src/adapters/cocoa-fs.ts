/** Synchronous Foundation filesystem adapter for the standalone JXA host.
 * It intentionally has no Node import and does not traverse directory links.
 */
declare const ObjC:any;
declare const $:any;

export interface CocoaEntry {name:string;isFile:boolean;isDirectory:boolean;}
export interface CocoaStat {isDirectory:boolean;isFile:boolean;mode:number;}
export interface CocoaFilePort {
  stat(path:string):CocoaStat|null;
  readdir(path:string):CocoaEntry[];
  readFile(path:string):string;
  writeFile(path:string,text:string,mode?:number,exclusive?:boolean):void;
  chmod(path:string,mode:number):void;
  rename(from:string,to:string):void;
  unlink(path:string):void;
}

function ns(value:string):any {return $.NSString.stringWithString(String(value));}
function unwrap(value:any):string{return String(ObjC.unwrap(value));}
function attributes(mode:number):any {
  return $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithUnsignedInt(mode&0o777),$.NSFilePosixPermissions);
}

export function createCocoaFilePort():CocoaFilePort {
  if(typeof ObjC==="undefined")throw new Error("JXA ObjC bridge is required");
  ObjC.import("Foundation");
  const manager=$.NSFileManager.defaultManager;
  function stat(path:string):CocoaStat|null {
    const raw=manager.attributesOfItemAtPathError(ns(path),null);
    if(!raw)return null;
    const attrs=ObjC.unwrap(raw);
    if(!attrs)return null;
    const type=attrs.NSFileType;
    const desc=type?String(ObjC.unwrap(type)):"";
    const isDirectory=desc===unwrap($.NSFileTypeDirectory);
    const isFile=desc===unwrap($.NSFileTypeRegular);
    const modeValue=attrs.NSFilePosixPermissions;
    return {isDirectory,isFile,mode:modeValue?Number(ObjC.unwrap(modeValue))&0o777:0o644};
  }
  return {
    stat,
    readdir(folder) {
      const names=manager.contentsOfDirectoryAtPathError(ns(folder),null);
      if(!names)throw new Error("Cannot list directory: "+folder);
      const values:unknown=ObjC.unwrap(names);
      if(!Array.isArray(values))throw new Error("Unexpected NSArray from Foundation");
      return values.map(item=>{
        const name=typeof item==="string"?item:unwrap(item);
        const s=stat(folder.replace(/\/+$/,"")+"/"+name);
        return {name,isFile:!!s?.isFile,isDirectory:!!s?.isDirectory};
      });
    },
    readFile(path) {
      const data=$.NSData.dataWithContentsOfFile(ns(path));
      if(!data)throw new Error("Cannot read file: "+path);
      const value=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding);
      if(!value)throw new Error("Not valid UTF-8: "+path);
      return unwrap(value);
    },
    writeFile(path,text,mode=0o600,exclusive=true) {
      if(exclusive && stat(path))throw new Error("File already exists: "+path);
      const bytes=ns(text).dataUsingEncoding($.NSUTF8StringEncoding);
      if(!manager.createFileAtPathContentsAttributes(ns(path),bytes,attributes(mode)))
        throw new Error("Cannot create file: "+path);
    },
    chmod(path,mode) {
      if(!manager.setAttributesOfItemAtPathError(attributes(mode),ns(path),null))
        throw new Error("Cannot chmod: "+path);
    },
    rename(from,to) {
      // Foundation moveItem does not replace an existing destination. A private
      // backup is maintained by the core so an interrupted replacement can roll back.
      if(stat(to) && !manager.removeItemAtPathError(ns(to),null))
        throw new Error("Cannot replace existing file: "+to);
      if(!manager.moveItemAtPathToPathError(ns(from),ns(to),null))
        throw new Error("Cannot rename "+from+" to "+to);
    },
    unlink(path) {
      if(stat(path) && !manager.removeItemAtPathError(ns(path),null))
        throw new Error("Cannot delete file: "+path);
    }
  };
}

/** Cocoa-normalized absolute paths are used by JXA; no Node path polyfill. */
export function normalizeCocoaPath(raw:string):string {
  ObjC.import("Foundation");
  return unwrap(ns(raw).stringByStandardizingPath);
}
export function cocoaParent(path:string):string {
  return unwrap(ns(path).stringByDeletingLastPathComponent);
}
export function cocoaName(path:string):string {
  return unwrap(ns(path).lastPathComponent);
}
export function cocoaJoin(parent:string,name:string):string {
  return (parent==="/"?"/":parent.replace(/\/+$/,"")+"/")+name;
}
