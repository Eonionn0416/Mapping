(function(root){
 const normalize=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
 const field=(f,keys)=>Object.entries(f).find(([k])=>keys.includes(normalize(k)))?.[1]??'';
 const pct=v=>v===''||v==null?'—':typeof v==='number'?(v*100).toFixed(2)+'%':v;
 function testRows(l){return l.ft.length?l.ft:[l.fields];}
 function yieldValue(l){const f=testRows(l)[0];const supplied=field(f,['yield','finalyield','testyield']);if(supplied!=='')return pct(supplied);const good=field(f,['good','outqty']),input=field(f,['inqty','rcvqty']);return good!==''&&Number(input)>0?pct(Number(good)/Number(input)):pct(field(l.fields,['testyield','finalyield','yield']));}
 function triggered(l){const trigger=String(field(l.fields,['triggeredbinvf','triggerbinvf','triggeredbin','triggerbin'])||'');const bins=[...new Set([...trigger.matchAll(/\b(?:HB(?:IN)?|B(?:IN)?)\s*(\d+)\b/gi)].map(m=>Number(m[1])))];const rates=[];for(const f of testRows(l)){const input=field(f,['inqty','rcvqty']);for(const b of bins){const qty=field(f,['b'+b,'bin'+b,'hbin'+b]);rates.push({label:'B'+b,qty:qty===''?null:Number(qty),input:input===''?null:Number(input),rate:qty!==''&&Number(input)>0?Number(qty)/Number(input):null});}}return {trigger,rates};}
 const api={field,pct,testRows,yieldValue,triggered};root.HoldView=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
