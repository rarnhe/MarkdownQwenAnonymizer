/** Character-based chunks with overlap, optionally ending at a newline. */
export function createChunks(text:string,maxChunkChars=20000,overlapChars=50):string[] {
  if(!Number.isInteger(maxChunkChars) || maxChunkChars<=1 ||
     !Number.isInteger(overlapChars) || overlapChars<0 || overlapChars>=maxChunkChars)
    throw new Error("Invalid chunk length or overlap");
  if(!text.length) return [];
  const chunks:string[]=[];
  let start=0;
  while(start<text.length) {
    let end=Math.min(start+maxChunkChars,text.length);
    if(end<text.length) {
      const newline=text.lastIndexOf("\n",end);
      if(newline>start+Math.floor(maxChunkChars/2)) end=newline+1;
    }
    chunks.push(text.slice(start,end));
    if(end===text.length) break;
    start=Math.max(start+1,end-overlapChars);
  }
  return chunks;
}
