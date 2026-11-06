(function(root){
 const norm=v=>String(v??'').trim().toUpperCase();
 const devices=r=>Array.isArray(r.devices)?r.devices:String(r.device||'').split(/[,;\r\n]+/).filter(Boolean);
 const api={matches:(r,f)=> (!f.customer||norm(r.customer).includes(norm(f.customer)))&&(!f.device||devices(r).some(d=>norm(d).includes(norm(f.device))))&&(!f.nickname||norm(r.nickname).includes(norm(f.nickname)))&&(!f.document||norm([r.kind,r.number,r.revision,r.file].join(' ')).includes(norm(f.document))),
 label:r=>{const d=devices(r),short=d.slice(0,2).join(', ')+(d.length>2?' +'+(d.length-2):'');return [`${r.kind} ${r.number} (${r.revision})`,r.nickname||short||'Device 미확인',r.nickname?short:'',r.customer,String(r.updatedAtText||'').slice(0,10),String(r.id||'').slice(0,6)].filter(Boolean).join(' · ');}};
 api.groupKey=r=>JSON.stringify([norm(r.customer),norm(r.kind),norm(r.number)]);
 api.groups=(records,filters)=>{const matches=new Set(records.filter(r=>api.matches(r,filters)).map(api.groupKey)),groups=new Map();for(const r of records){const key=api.groupKey(r);if(!matches.has(key))continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}return [...groups].map(([key,items])=>({key,items})).sort((a,b)=>norm(a.items[0].number).localeCompare(norm(b.items[0].number)));};
 root.AIBILibrary=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
