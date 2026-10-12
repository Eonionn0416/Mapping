(function(root){
 const text=v=>v==null?'':String(v).replace(/\u00a0/g,' ').trim(),key=v=>text(v).toLowerCase().replace(/[^a-z0-9가-힣一-龥]/g,'');
 const priorities=['lotid','lotno','lot','montagelot','efinixlot','customerlotno','actuallassy lot'.replace(/ /g,''),'actualassylot','waferlotid','waferlot'];
 const qtyKeys=['qty','quantity','qty1','수량1','chipqty','totalicqty','進量'];
 function parse(rows,purpose,customer){
  const headers=[];rows.forEach((r,i)=>{const k=r.map(key),cols=k.map((x,c)=>({x,c})).filter(v=>priorities.includes(v.x));if(cols.length){cols.sort((a,b)=>priorities.indexOf(a.x)-priorities.indexOf(b.x));headers.push({i,r,k,col:cols[0].c});}});
  const records=[],warnings=[];if(!headers.length)warnings.push(purpose+': No recognized lot table; source sheet is retained for review.');
  for(let hi=0;hi<headers.length;hi++){const h=headers[hi],end=headers[hi+1]?.i??rows.length;let current=null;const find=aliases=>h.k.findIndex(v=>aliases.includes(v));let dc=find(['custdevice','device','deviceno','devicerev','product','productno','chipproductno','assyproductno','測試型號']);if(h.k.filter(x=>x==='device').length>1)dc=h.k.lastIndexOf('device');const qc=find(qtyKeys),sc=find(['status','lotstatus','reltest현황']),pc=find(['pkg','package','packagetype']),lc=find(['lead','leadcount']);
   for(let i=h.i+1;i<end;i++){const r=rows[i],raw=text(r[h.col]),lot=raw.toUpperCase().replace(/\s+/g,' ');if(!raw){if(current&&r.filter(v=>text(v)).length===1)current.notes.push(r.map(text).filter(Boolean).join(' '));continue;}
    if(!/^[A-Z0-9][A-Z0-9._/\- ]*$/.test(lot)||lot.length>80||(!/[0-9]/.test(lot)&&!(dc>=0&&/[0-9]/.test(text(r[dc]))&&qc>=0&&text(r[qc])!==''&&Number.isFinite(Number(text(r[qc]).replace(/,/g,''))))))continue;
    const fields={},seen={};r.forEach((v,c)=>{if(!text(v))return;let label=text(h.r[c])||'Column '+(c+1);seen[label]=(seen[label]||0)+1;if(seen[label]>1)label+=' ('+seen[label]+')';fields[label]=v;});
    const q=qc<0?'':text(r[qc]).replace(/,/g,''),qty=q!==''&&Number.isFinite(Number(q))?Number(q):null;
    current={customer,purpose,lot,device:dc>=0?text(r[dc]):'',qty,status:sc>=0?text(r[sc]):'',package:pc>=0?text(r[pc]):'',lead:lc>=0?text(r[lc]):'',fields,row:i+1,table:hi+1,lotType:/wafer/.test(h.k[h.col])?'Wafer':'Lot',notes:[]};records.push(current);
   }
  }
  if(!headers.length){rows.forEach((r,i)=>r.forEach(v=>{const m=text(v).match(/^Lot\s*:\s*([A-Z0-9._\-/]+)\s*$/i);if(m)records.push({customer,purpose,lot:m[1].toUpperCase(),device:'',qty:null,status:'',package:'',lead:'',fields:{Lot:m[1]},row:i+1,table:0,lotType:'Lot',notes:[]});}));if(records.length)warnings.splice(0,warnings.length);}
  if(headers.some(h=>h.r.some(v=>/정정|correction|corrected/i.test(text(v)))))warnings.push(purpose+': Source includes a corrected table. Check original and corrected device/substrate fields in Source details.');
  const nonTable=rows.map((r,i)=>({r,i})).filter(({r,i})=>!headers.some(h=>h.i===i)&&r.filter(v=>text(v)).length<=2).map(({r})=>r.map(text).filter(Boolean).join(' ')).filter(Boolean);
  return {customer,purpose,records,warnings,notes:nonTable.join('\n'),rows};
 }
 function summarize(sheets){const groups=[];for(const sheet of sheets){const lots=new Map();for(const r of sheet.records){const k=r.lotType+'|'+r.lot;if(!lots.has(k))lots.set(k,{...r,sources:[],notes:[]});const l=lots.get(k);for(const f of ['device','package','lead','status'])if(r[f])l[f]=r[f];if(r.qty!==null)l.qty=r.qty;l.sources.push(r);l.notes.push(...r.notes);}groups.push({...sheet,lots:[...lots.values()]});}return groups;}
 const api={parse,summarize};root.NpiCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
