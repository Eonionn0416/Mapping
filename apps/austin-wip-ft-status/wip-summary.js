(function(root){
'use strict';
// Separate movement rows from the latest inventory: quantities are not additive across statuses.
function rows(lots,inputs,exits){
 const byId=new Map(lots.map(l=>[l.id,l])),result=[];
 const add=(lot,status,date,qty,stamp='')=>result.push({device:lot.device||'',status,lot:lot.lot||'',mark:lot.mark||'',date:date||'',qty,process:status==='현재 WIP'?{...(lot.process||{})}:{},stamp:stamp||date||''});
 for(const lot of inputs)add(lot,'투입',lot.inDate,lot.input);
 for(const event of exits){const lot=byId.get(event.id);if(lot)add(lot,'이탈',event.date,event.qty,event.stamp);}
 for(const lot of lots)if(lot.active&&lot.qty>0){const latest=lot.history?.at(-1);add(lot,'현재 WIP',latest?.date||lot.lastSeen,lot.qty,latest?.stamp);}
 return result.sort((a,b)=>b.date.localeCompare(a.date)||b.stamp.localeCompare(a.stamp)||a.device.localeCompare(b.device)||a.lot.localeCompare(b.lot)||a.status.localeCompare(b.status));
}
const api={rows};root.AustinWipSummary=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
