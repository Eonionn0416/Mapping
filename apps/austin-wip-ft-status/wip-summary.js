(function(root){
'use strict';
// Separate movement rows from the latest inventory: quantities are not additive across statuses.
function rows(lots,inputs,exits){
 const byId=new Map(lots.map(l=>[l.id,l])),result=[];
 const add=(lot,status,date,qty,stamp='')=>result.push({id:lot.id,device:lot.device||'',status,lot:lot.lot||'',mark:lot.mark||'',date:date||'',qty,process:status==='현재 WIP'?{...(lot.process||{})}:{},stamp:stamp||date||''});
 for(const lot of inputs)add(lot,'투입',lot.inDate,lot.input);
 for(const event of exits){const lot=byId.get(event.id);if(lot)add(lot,'이탈',event.date,event.qty,event.stamp);}
 for(const lot of lots)if(lot.active&&lot.qty>0){const latest=lot.history?.at(-1);add(lot,'현재 WIP',latest?.date||lot.lastSeen,lot.qty,latest?.stamp);}
 return result.sort((a,b)=>b.date.localeCompare(a.date)||b.stamp.localeCompare(a.stamp)||a.device.localeCompare(b.device)||a.lot.localeCompare(b.lot)||a.status.localeCompare(b.status));
}
function selectedRows(lots,inputs,exits,selection){
 if(!selection.length)return rows(lots,inputs,exits);
 const result=[];
 for(const {date,kind} of selection){
  if(kind==='current'){
   const historical=lots.map(l=>{const h=(l.history||[]).filter(h=>h.date<=date).at(-1);return h?{...l,qty:h.qty,process:h.process,active:h.qty>0,lastSeen:date,history:[{...h,date}]}:null;}).filter(Boolean);
   result.push(...rows(historical,[],[]));
  }else result.push(...rows(lots,kind==='input'?inputs.filter(l=>l.inDate===date):[],kind==='out'?exits.filter(e=>e.date===date):[]).filter(r=>r.status!=='현재 WIP'));
 }
 const unique=new Map(result.map(r=>[JSON.stringify([r.id,r.status,r.date,r.stamp,r.qty]),r]));
 return [...unique.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.stamp.localeCompare(a.stamp)||a.lot.localeCompare(b.lot));
}
const api={rows,selectedRows};root.AustinWipSummary=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
