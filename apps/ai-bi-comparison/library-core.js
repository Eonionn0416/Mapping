(function(root){
 const norm=v=>String(v??'').trim().toUpperCase();
 const devices=r=>Array.isArray(r.devices)?r.devices:String(r.device||'').split(/[,;\r\n]+/).filter(Boolean);
 const api={matches:(r,f)=> (!f.customer||norm(r.customer)===norm(f.customer))&&(!f.device||devices(r).some(d=>norm(d).includes(norm(f.device))))&&(!f.nickname||norm(r.nickname).includes(norm(f.nickname)))&&(!f.document||norm([r.kind,r.number,r.revision,r.file].join(' ')).includes(norm(f.document))),
 label:r=>{const d=devices(r),short=d.slice(0,2).join(', ')+(d.length>2?' +'+(d.length-2):'');return [r.nickname||short||'Device 미확인',r.nickname?short:'',r.customer,`${r.kind} ${r.number} (${r.revision})`,String(r.updatedAtText||'').slice(0,10),String(r.id||'').slice(0,6)].filter(Boolean).join(' · ');}};
 root.AIBILibrary=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
