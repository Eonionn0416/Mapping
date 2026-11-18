(function(root){
const days=(start,end)=>start&&end?Math.max(0,Math.floor((Date.parse(end)-Date.parse(start))/86400000)):null;
function bank(lots,events,asOf){
 const map=new Map(lots.map(l=>[l.id,l])),result=[];
 const add=(l,status,date,wafer,die)=>result.push({device:l.device,lot:l.lot,date,received:l.received,lead:days(l.received,date),status,wafer,die});
 for(const l of lots)if(l.active&&(l.wafer||l.die))add(l,'현재',asOf,l.wafer,l.die);
 for(const e of events){const l=map.get(e.id);if(!l)continue;if(e.waferIn||e.dieIn)add(l,'입고',e.date,e.waferIn,e.dieIn);if(e.waferOut||e.dieOut)add(l,'불출',e.date,e.waferOut,e.dieOut);if(e.openingWafer||e.openingDie)add(l,'기초재고',e.date,e.openingWafer,e.openingDie);}
 return result.sort((a,b)=>b.date.localeCompare(a.date)||a.lot.localeCompare(b.lot));
}
function yieldLots(rows,type){const map=new Map();for(const r of rows){const key=JSON.stringify([r.device,r.lot,r.mark]);let g=map.get(key);if(!g){g={device:r.device,lot:r.lot,mark:r.mark,date:r.date,input:0,output:0,reject:0,weighted:0,defects:{},wafers:new Set(),waferUnknown:false};map.set(key,g);}g.date=g.date>r.date?g.date:r.date;g.input+=r.input||0;g.output+=r.output||0;g.reject+=r.reject||0;g.weighted+=(type==='bumpYield'?r.yieldValue:(r.input?r.output/r.input:0))*(r.input||0);if(r.waferId)g.wafers.add(String(r.waferId));else g.waferUnknown=true;for(const [d,q] of Object.entries(r.defects||{}))g.defects[d]=(g.defects[d]||0)+q;}
 return [...map.values()].map(g=>({...g,waferCount:g.waferUnknown?null:g.wafers.size,yield:g.input?g.weighted/g.input*100:null,ppm:g.input?g.reject/g.input*1e6:null})).sort((a,b)=>b.date.localeCompare(a.date)||a.lot.localeCompare(b.lot));}
root.AustinFanout={days,bank,yieldLots};if(typeof module!=='undefined')module.exports=root.AustinFanout;
})(globalThis);
