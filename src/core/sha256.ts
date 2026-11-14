/** Portable SHA-256 over UTF-8, including JXA without TextEncoder. */
export function sha256(text:string):string {
  const bytes:number[]=[];
  for(const c of text) {
    let n=c.codePointAt(0)!;
    if(n>=0xd800&&n<=0xdfff)n=0xfffd;
    if(n<128)bytes.push(n);
    else if(n<2048)bytes.push(192|(n>>6),128|(n&63));
    else if(n<65536)bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));
    else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));
  }
  const bitLength=bytes.length*8;
  bytes.push(128);
  while(bytes.length%64!==56)bytes.push(0);
  for(let i=7;i>=0;i--)bytes.push(Math.floor(bitLength/2**(i*8))&255);
  const k:number[]=[],h:number[]=[];
  for(let n=2;k.length<64;n++) {
    let prime=true;
    for(let d=2;d*d<=n;d++)if(n%d===0){prime=false;break;}
    if(prime){if(h.length<8)h.push((Math.sqrt(n)%1*2**32)|0);k.push((Math.cbrt(n)%1*2**32)|0);}
  }
  const ro=(n:number,b:number)=>(n>>>b)|(n<<(32-b));
  for(let off=0;off<bytes.length;off+=64) {
    const w:number[]=[];
    for(let i=0;i<16;i++)w[i]=(bytes[off+i*4]<<24)|(bytes[off+i*4+1]<<16)|(bytes[off+i*4+2]<<8)|bytes[off+i*4+3];
    for(let i=16;i<64;i++) {
      const x=w[i-15],y=w[i-2];
      w[i]=(w[i-16]+(ro(x,7)^ro(x,18)^(x>>>3))+w[i-7]+(ro(y,17)^ro(y,19)^(y>>>10)))|0;
    }
    let [a,b,c,d,e,f,g,j]=h;
    for(let i=0;i<64;i++) {
      const t1=(j+(ro(e,6)^ro(e,11)^ro(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0;
      const t2=((ro(a,2)^ro(a,13)^ro(a,22))+((a&b)^(a&c)^(b&c)))|0;
      j=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }
    for(const [i,n] of [a,b,c,d,e,f,g,j].entries())h[i]=(h[i]+n)|0;
  }
  return h.map(n=>(n>>>0).toString(16).padStart(8,"0")).join("");
}
