(function(root){
'use strict';
const norm=v=>String(v??'').trim().replace(/\s+/g,' ').toUpperCase();
const key=(...v)=>JSON.stringify(v.map(norm));
const num=v=>{if(v==null||String(v).trim()==='')return 0;const n=Number(String(v).replace(/,/g,''));if(!Number.isFinite(n)||n<0)throw Error('수량 오류: '+v);return n;};
const iso=d=>d.toISOString().slice(0,10);
function date(v){if(v==null||String(v).trim()==='')return '';if(typeof v==='number')return iso(new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000));if(v instanceof Date)return iso(v);const m=String(v).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);if(!m)throw Error('날짜 형식 오류: '+v);const s=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;if(iso(new Date(s))!==s)throw Error('날짜 오류: '+v);return s;}
const addDays=(s,n)=>iso(new Date(new Date(s+'T00:00:00Z').getTime()+n*86400000));
function week(s,thu=false){let d=new Date(s+'T00:00:00Z');if(thu)d=new Date(addDays(s,(3-d.getUTCDay()+7)%7)+'T00:00:00Z');const end=iso(d);d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const year=d.getUTCFullYear(),w=Math.ceil((((d-new Date(Date.UTC(year,0,1)))/86400000)+1)/7);return {label:`${year}-WW${String(w).padStart(2,'0')}`,end:thu?end:addDays(s,(7-new Date(s+'T00:00:00Z').getUTCDay())%7),start:thu?addDays(end,-6):'',presentation:thu?addDays(end,6):''};}
const specs={DieBank:'bank',Bump_Bank:'bumpBank',Test_WIP:'test',Assy_WIP:'assy',Bump_WIP:'bump', 'Chip Bank':'chip'};
function parseWorkbook(w,X,name){
 const m=name.match(/_(20\d{6})(\d{2})?(?:\D|$)/);if(!m)throw Error('파일명에 보고일 YYYYMMDD가 필요합니다: '+name);
 const stamp=date(`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`)+(m[2]||'00');
 const result=[];
 for(const sheet of w.SheetNames){let type=specs[sheet];if(sheet==='Raw data')type=/BUMP_YIELD/i.test(name)?'bumpYield':/ASSY_YIELD/i.test(name)?'assyYield':/FT_YIELD/i.test(name)?'ftYield':null;if(!type)continue;
  const a=X.utils.sheet_to_json(w.Sheets[sheet],{header:1,defval:null});if(!a.length)throw Error(sheet+': 헤더가 없습니다.');
  const h=a[0].map(norm),ix=s=>h.indexOf(norm(s));
  let required=type==='chip'?['DEVICE','WAFER LOT','MARKING (RUN NO)','BIN NO','Bad Chip Qty']:type==='bank'||type==='bumpBank'?['CUSTOMER LOT','CUSTOMER DEVICE','WAFER QTY','DIE QTY','DATE RECEIVED']:type==='assyYield'?['Device','Close Date','ASSY lot#','Wafer Lot','ASSY_IN_QTY','ASSY_OUT_QTY','ASSY_DEFECT_QTY']:type==='bumpYield'?['Device','Close Date','Lot ID','Wafer ID','SUBLOT_ID','GROSS DIE','BUMP YIELD','BUMP_DEFECTS']:type==='ftYield'?['Device','Test in time','Test out Time','Factory Lot Number','Lot ID','Test in Qty.','Test out Qty.']:['DEVICE','WAFER LOT','QTY','INPUT DATE','OUTPUT DATE',...(type==='test'?['SCK MARKING BATCH (LOT NO)','REJECT QTY']:type==='assy'?['MARKING (RUN NO)','INPUT QTY']:[])];
  for(const col of required)if(ix(col)<0)throw Error(sheet+': 필수 열 누락 '+col);
  const start=type==='test'?ix('REJECT QTY')+1:ix('OUTPUT DATE')+1;
  const processes=['test','assy','bump'].includes(type)?h.slice(start).filter(Boolean):[];
  const rows=[],seen=new Map();
  for(let i=1;i<a.length;i++){const cells=a[i];if(!cells.some(v=>v!==null&&String(v).trim()!==''))continue;const v=s=>cells[ix(s)],q=s=>num(v(s)),d=s=>date(typeof v(s)==='number'&&w.Workbook?.WBProps?.date1904?v(s)+1462:v(s));
   const device=norm(v(type==='bank'||type==='bumpBank'?'CUSTOMER DEVICE':'DEVICE'));if(!device)throw Error(sheet+' 行 '+(i+1)+': Device 누락');
   let r={device,sourceRow:i+1};
   if(type==='bank'||type==='bumpBank'){Object.assign(r,{lot:norm(v('CUSTOMER LOT')),received:d('DATE RECEIVED'),wafer:q('WAFER QTY'),die:q('DIE QTY')});r.id=key(device,r.lot);}
   else if(type==='chip'){Object.assign(r,{lot:norm(v('WAFER LOT')),mark:norm(v('MARKING (RUN NO)')),bin:norm(v('BIN NO')).replace(/^BIN\s*/,''),qty:q('Bad Chip Qty')});r.id=key(device,r.lot,r.mark,r.bin);}
   else if(processes.length){Object.assign(r,{lot:norm(v('WAFER LOT')),mark:norm(v(type==='test'?'SCK MARKING BATCH (LOT NO)':'MARKING (RUN NO)')),qty:q('QTY'),input:ix('INPUT QTY')>=0?q('INPUT QTY'):null,inDate:d('INPUT DATE'),outDate:d('OUTPUT DATE'),received:d('DATE RECEIVED'),reject:ix('REJECT QTY')>=0?q('REJECT QTY'):null,process:Object.fromEntries(processes.map(p=>[p,q(p)]))});r.id=key(device,r.lot,r.mark);}
   else if(type==='assyYield'){Object.assign(r,{lot:norm(v('Wafer Lot')),mark:norm(v('ASSY lot#')),date:d('Close Date'),input:q('ASSY_IN_QTY'),output:q('ASSY_OUT_QTY'),reject:q('ASSY_DEFECT_QTY'),defects:Object.fromEntries(h.slice(ix('ASSY_DPPM')+1).filter(Boolean).map(p=>[p,q(p)]))});r.id=key(device,r.lot,r.mark,norm(v('Wafer ID#')));}
   else if(type==='bumpYield'){const input=q('GROSS DIE'),reject=q('BUMP_DEFECTS'),y=num(v('BUMP YIELD'));if(y>1)throw Error('BUMP YIELD는 0~1이어야 합니다.');Object.assign(r,{lot:norm(v('Lot ID')),mark:norm(v('SUBLOT_ID')),date:d('Close Date'),input,output:input-reject,reject,yieldValue:y,defects:Object.fromEntries(h.slice(ix('DEFECT_PPM')+1).filter(Boolean).map(p=>[p,q(p)]))});r.id=key(device,r.lot,r.mark,v('Wafer ID'));}
   else {Object.assign(r,{lot:norm(v('Lot ID')),mark:norm(v('Factory Lot Number')),date:d('Test in time'),outDate:d('Test out Time'),input:q('Test in Qty.'),output:q('Test out Qty.'),reject:q('Test in Qty.')-q('Test out Qty.'),defects:{}});r.id=key(device,r.lot,r.mark,r.date,v('Test Program'),v('Work Order'));}
   if(!r.lot)throw Error(sheet+' 行 '+(i+1)+': Lot 누락');
   if(type.endsWith('Yield')&&(!r.date||r.output<0||r.output>r.input))throw Error(sheet+' 行 '+(i+1)+': 수율 날짜/수량 오류');
   if(seen.has(r.id)){const old=seen.get(r.id),clean=x=>JSON.stringify({...x,sourceRow:0});if(clean(old)===clean(r))continue;throw Error(sheet+' 行 '+(i+1)+': 같은 Lot 식별자의 다른 행. 원본 분할 기준 확인 필요');}
   seen.set(r.id,r);rows.push(r);
  }
  result.push({id:key(type,stamp),type,stamp,date:stamp.slice(0,10),file:name,sheet,processes,rows});
 }
 if(!result.length)throw Error('지원하는 Austin 보고서 시트가 없습니다: '+name);return result;
}
function merge(existing,incoming){const map=new Map(existing.map(s=>[s.id,s]));for(const s of incoming)map.set(s.id,s);return [...map.values()].sort((a,b)=>a.stamp.localeCompare(b.stamp)||a.type.localeCompare(b.type));}
function bank(snaps,type,asOf){const ss=snaps.filter(s=>s.type===type&&s.date<=asOf).sort((a,b)=>a.stamp.localeCompare(b.stamp)),lots=new Map(),events=[];let prev=new Map();
 for(let i=0;i<ss.length;i++){const s=ss[i],cur=new Map(s.rows.map(r=>[r.id,r]));for(const id of new Set([...prev.keys(),...cur.keys()])){const p=prev.get(id),r=cur.get(id),base=r||p;let l=lots.get(id)||{...base,firstSeen:s.date,wafer:0,die:0,active:false,lastExit:'',events:[]};const dw=(r?.wafer||0)-(p?.wafer||0),dd=(r?.die||0)-(p?.die||0);if(dw||dd){const e={id,device:base.device,lot:base.lot,date:s.date,stamp:s.stamp,kind:i===0?'기초재고':dw<0||dd<0?'불출': '입고',waferIn:i?Math.max(0,dw):0,waferOut:i?Math.max(0,-dw):0,dieIn:i?Math.max(0,dd):0,dieOut:i?Math.max(0,-dd):0,openingWafer:i?0:dw,openingDie:i?0:dd};events.push(e);l.events.push(e);if(!r)l.lastExit=s.date;}
 Object.assign(l,r||{wafer:0,die:0},{active:!!r,lastSeen:s.date});lots.set(id,l);}prev=cur;}
 return {lots:[...lots.values()],events,latest:ss.at(-1)?.date||'',snapshots:ss};
}
function wip(snaps,type,asOf){const ss=snaps.filter(s=>s.type===type&&s.date<=asOf).sort((a,b)=>a.stamp.localeCompare(b.stamp)),lots=new Map(),events=[];let prev=new Map();
 for(const s of ss){const cur=new Map(s.rows.map(r=>[r.id,r]));for(const r of s.rows){let l=lots.get(r.id),p=prev.get(r.id);if(!l){l={...r,firstSeen:s.date,input:r.input??r.qty,inputEstimated:r.input===null,peaks:{},cumulative:{},history:[],exitDate:'',outQty:0};lots.set(r.id,l);}const before=p?.process||{};for(const [proc,n] of Object.entries(r.process)){l.peaks[proc]=Math.max(l.peaks[proc]||0,n);l.cumulative[proc]=(l.cumulative[proc]||0)+Math.max(0,n-(before[proc]||0));}
 if(p){const rejDelta=r.reject===null||p.reject===null?0:Math.max(0,r.reject-p.reject);const out=Math.max(0,p.qty-r.qty-rejDelta);if(out){l.outQty+=out;events.push({device:r.device,id:r.id,date:s.date,qty:out,kind:'WIP 감소 (출하 미확인)'});}}
 l.input=Math.max(l.input,r.input??r.qty);Object.assign(l,{qty:r.qty,process:r.process,reject:r.reject,inDate:r.inDate||l.inDate,outDate:r.outDate,active:true,lastSeen:s.date,exitDate:''});l.history.push({date:s.date,stamp:s.stamp,qty:r.qty,process:r.process,reject:r.reject,outDate:r.outDate});}
 for(const [id,p] of prev)if(!cur.has(id)){const l=lots.get(id);l.active=false;l.qty=0;l.process={};l.exitDate=s.date;l.outQty+=p.qty;events.push({device:p.device,id,date:s.date,qty:p.qty,kind:'WIP 이탈 (출하 미확인)'});l.history.push({date:s.date,stamp:s.stamp,qty:0,process:{},reject:p.reject,outDate:p.outDate});}prev=cur;}
 return {lots:[...lots.values()],events,latest:ss.at(-1)?.date||'',processes:[...new Set(ss.flatMap(s=>s.processes))]};}
function yieldRows(snaps,type,asOf){const map=new Map();for(const s of snaps.filter(s=>s.type===type&&s.date<=asOf).sort((a,b)=>a.stamp.localeCompare(b.stamp)))for(const r of s.rows)map.set(r.id,r);return [...map.values()];}
function aggregate(rows,type,mode){const map=new Map();for(const r of rows){const wi=week(r.date,type!=='ftYield'),k=mode==='daily'?r.date:wi.label;let g=map.get(k)||{label:k,...(mode==='daily'?{}:wi),input:0,output:0,reject:0,weightedYield:0,defects:{},count:0};g.input+=r.input;g.output+=r.output;g.reject+=r.reject;g.weightedYield+=(type==='bumpYield'?r.yieldValue:(r.input?r.output/r.input:0))*r.input;g.count++;for(const [d,n]of Object.entries(r.defects))g.defects[d]=(g.defects[d]||0)+n;map.set(k,g);}return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(g=>({...g,yield:g.input?g.weightedYield/g.input*100:null,dppm:g.input?g.reject/g.input*1e6:null}));}
function latest(snaps,type,asOf){return snaps.filter(s=>s.type===type&&s.date<=asOf).sort((a,b)=>a.stamp.localeCompare(b.stamp)).at(-1);}
function over3(inDate,today){if(!inDate)return false;const d=new Date(inDate+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+3);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return today>iso(d);}
const api={norm,key,num,date,iso,addDays,week,parseWorkbook,merge,bank,wip,yieldRows,aggregate,latest,over3};if(typeof module!=='undefined')module.exports=api;root.AustinCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
