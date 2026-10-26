(function(root){
'use strict';
async function normalize(buffer,X,Zip){
 const source=X.read(new Uint8Array(buffer),{type:'array',cellFormula:true}),clean=X.utils.book_new();
 for(const name of source.SheetNames){const sheet=source.Sheets[name],out={};let minR=Infinity,minC=Infinity,maxR=0,maxC=0;
  for(const [address,c] of Object.entries(sheet)){if(address.startsWith('!')||!c||(c.v==null&&!c.f))continue;const value=c.f?'='+c.f:String(c.w??c.v??'');if(value==='')continue;const p=X.utils.decode_cell(address);minR=Math.min(minR,p.r);minC=Math.min(minC,p.c);maxR=Math.max(maxR,p.r);maxC=Math.max(maxC,p.c);out[address]={t:'s',v:value,z:'@'};}
  if(minR!==Infinity)out['!ref']=X.utils.encode_range({s:{r:minR,c:minC},e:{r:maxR,c:maxC}});
  if(sheet['!merges'])out['!merges']=sheet['!merges'].map(m=>({s:{...m.s},e:{...m.e}}));
  X.utils.book_append_sheet(clean,out,name);
 }
 const zip=await Zip.loadAsync(X.write(clean,{type:'array',bookType:'xlsx',bookSST:true}));
 const path='xl/styles.xml',style=zip.file(path);if(!style)throw Error('텍스트 정리본의 서식 파일을 만들지 못했습니다.');
 const xml=(await style.async('string')).replace(/<font>.*?<\/font>/gs,'<font><sz val="11"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>');zip.file(path,xml);
 return zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'});
}
const api={normalize};root.AIBITextWorkbook=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
