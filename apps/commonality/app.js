import * as C from '../../shared/equipment-core.js?v=120';
import * as Store from '../../shared/equipment-store.js?v=118';
import {loadYields} from './yield-sources.js?v=118';
const $=id=>document.getElementById(id),esc=Store.esc,fmt=v=>v==null?'—':typeof v==='number'?v.toLocaleString(undefined,{maximumFractionDigits:4}):String(v);let equipment=[],joined=[],charts=[],busy=false;
const table=(headers,rows)=>'<div class="wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(fmt(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const timestamp=r=>Date.parse((r.time||r.date).replace(' ','T')+((r.time||r.date).length===10?'T00:00:00':'')+'+09:00');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('to').value=today;const start=new Date(today+'T12:00:00');start.setMonth(start.getMonth()-2);$('from').value=C.day(start.toISOString());
function options(id,values,all){const el=$(id),old=el.value;el.replaceChildren();for(const value of [...(all?['']:[]),...new Set(values.filter(Boolean).sort())]){const o=document.createElement('option');o.value=value;o.textContent=value||all;el.append(o);}if([...el.options].some(o=>o.value===old))el.value=old;}
function chooseFilters(){ options('metric',joined.map(r=>r.metric)); }
function render(){charts.forEach(c=>c.destroy());charts=[];const c=$('customer').value.toUpperCase().trim(),p=$('process').value.trim(),m=$('machine').value.toUpperCase().trim(),q=C.norm($('query').value);
renderLots(c,p,m,q);
const host=$('trends');host.replaceChildren();if(!p&&!m){host.innerHTML='<p class="empty">공정 또는 장비를 선택하면 장비별 · 고객별 수율을 표시합니다.</p>';return;}if($('from').value>$('to').value){host.textContent='From은 To보다 늦을 수 없습니다.';return;}
const equipmentIndex=new Map(C.latest(equipment).map(e=>[identity(e.customer,e.lot,e.process),e]));
const timed=joined.flatMap(y=>{
 const matched=y.equipmentLots.map(l=>windows.get(identity(y.customer,l,y.process))).filter(w=>w?.start);
 if(!matched.length)return [y];
 return matched.map(w=>({...y,lot:w.lot,time:w.start.replaceAll('/','-'),date:w.start.slice(0,10).replaceAll('/','-'),dateBasis:'공정 In',machines:equipmentIndex.get(w.id)?.machines||y.machines}));
});
const pool=timed.filter(r=>(!c||r.customer===c)&&(!p||r.process===p)&&r.metric===$('metric').value&&r.date>=$('from').value&&r.date<=$('to').value&&(!q||C.norm(r.device+' '+r.lot).includes(q))&&($('shared').checked||!r.shared));const panels=new Map();for(const r of pool){if(m&&!r.machines.includes(m))continue;const k=JSON.stringify([r.customer,r.device,r.process,r.metric]);if(!panels.has(k))panels.set(k,[]);panels.get(k).push(r);}for(const rs of panels.values()){const first=rs[0],panel=document.createElement('article');panel.className='pair';panel.innerHTML='<div><h2>'+esc([first.customer,first.device,'공정 '+first.process,first.metric].join(' · '))+'</h2><div class="chart"><canvas></canvas></div><div class="stats"></div></div><div class="details"><h2>Lot 상세</h2><div class="actions"><button>전체 보기</button><span class="muted"></span></div><div class="lots"></div></div>';host.append(panel);const draw=list=>{panel.querySelector('.details span').textContent=list.length+' Lot';panel.querySelector('.lots').innerHTML=table(['일시 / 기준','Lot','사용 장비','Yield %','In Qty','Out Qty','장비 보고일','연결'],[...list].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>[(r.time||r.date)+' · '+(r.dateBasis||'보고일'),r.lot,r.machines.join(' · '),r.yield,r.input,r.output,r.equipmentDate,r.shared?'복수 장비':'단일 장비']));};draw(rs);const points=new Set();panel.querySelector('button').onclick=()=>{points.clear();draw(rs);};
const machines=[...new Set(rs.flatMap(r=>r.machines))].filter(x=>!m||m===x).sort(),dates=[...new Set(rs.map(r=>r.time||r.date))].sort(),palette=['#159ee3','#16b6c7','#79b4e1','#73c9bc','#91a7cf','#d1a3b4'];const datasets=machines.map((machine,i)=>({label:machine,data:rs.filter(r=>r.machines.includes(machine)).sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({x:timestamp(r),y:r.yield,record:r})),showLine:true,spanGaps:false,tension:0,borderWidth:1.5,pointRadius:4,backgroundColor:palette[i%palette.length],borderColor:palette[i%palette.length]}));charts.push(new Chart(panel.querySelector('canvas'),{type:'scatter',data:{datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,onClick:(event,hits)=>{if(hits.length){const hit=hits[0],point=datasets[hit.datasetIndex].data[hit.index];const pointKey=(d,m)=>JSON.stringify([d,m]),order=dates.flatMap(d=>machines.filter(machine=>rs.some(r=>(r.time||r.date)===d&&r.machines.includes(machine))).map(machine=>pointKey(d,machine)));togglePick(points,pointKey(point.record.time||point.record.date,datasets[hit.datasetIndex].label),order,event.native||event);draw(points.size?rs.filter(r=>r.machines.some(machine=>points.has(pointKey(r.time||r.date,machine)))):rs);}},plugins:{legend:{position:'bottom'},tooltip:{callbacks:{title:items=>items.map(i=>i.raw.record.time||i.raw.record.date).join(''),label:ctx=>ctx.dataset.label+' · '+ctx.raw.record.lot+' · '+fmt(ctx.raw.y)+'%'}}},scales:{x:{min:Math.min(...rs.map(timestamp))-3600000,max:Math.max(...rs.map(timestamp))+3600000,title:{display:true,text:first.dateBasis||'수율 보고일'},ticks:{maxTicksLimit:6,callback:v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)),maxRotation:30}},y:{min:Math.max(0,Math.min(99.7,...rs.map(r=>r.yield))-.1),max:100,title:{display:true,text:'Yield %'}}}}}));
const stats=machines.map(machine=>{const group=rs.filter(r=>r.machines.includes(machine)),target=$('target').value===''?null:Number($('target').value),t=C.ttest([...new Map(group.map(r=>[r.id,r.yield])).values()],target);return [machine,t.n,t.mean,t.sd,t.t,printP(t.p),t.reason||pVerdict(t.p)];});panel.querySelector('.stats').innerHTML=table(['Machine','n Lot','평균 %','1σ Deviation','t','Prob t (양측)','판정 (p < 0.05)'],stats);}
if(!panels.size)host.innerHTML='<p class="empty">조건에 맞는 수율 연결이 없습니다. 고객별 Yield 보고서를 먼저 가져오거나 조회 기간 / 복수 장비 포함 조건을 확인하세요.</p>';}
let recordsReady=false;
async function search(windowOnly){
 if(busy)return;
 busy=true;
 try{
  await ensureCycle();
  if(!recordsReady){
   $('status').textContent='장비 및 수율 이력 조회 중…';
   const [e,y]=await Promise.all([Store.load(true),loadYields()]);
   equipment=e.records;joined=C.join(equipment,y.records);
   chooseFilters();prepareRows();recordsReady=true;
   $('status').textContent=[e.error,...y.errors].filter(Boolean).join(' / ');
  }
  if(windowOnly){pageIndex=0;pickedLots.clear();pickedWeeks.clear();renderWindow();}
  else render();
 }catch(e){$('status').textContent='조회 실패 · '+e.message;}finally{busy=false;}
}
async function ingest(file){
 await ensureCycle();
 if(busy)throw Error('조회 중입니다. 잠시 후 다시 시도하세요.');
 busy=true;
 try{
  if(/^ASSY_CT_START_/i.test(file.name))await importCycle(file);else await Store.ingest(file);
  recordsReady=false;lookupData=null;
  $('status').textContent='가져오기 완료 · 검색하면 반영됩니다.';
 }finally{busy=false;}
}
$('file').onchange=async e=>{for(const f of e.target.files)try{await ingest(f);}catch(err){$('status').textContent='가져오기 실패: '+err.message;}e.target.value='';};$('drop').ondragover=e=>e.preventDefault();$('drop').ondrop=async e=>{e.preventDefault();for(const f of e.dataTransfer.files)try{await ingest(f);}catch(err){$('status').textContent='가져오기 실패: '+err.message;}};$('reload').onclick=()=>{recordsReady=false;lookupData=null;$('status').textContent='다음 검색에서 최신 이력을 조회합니다.';};document.querySelector('.upload-button').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file').click();}};const operationPairs = 'S01:D/B N11:AIN 2:W/I 14:LMN 3:B/G 8:L/G 10:D/S 20:2ND 438:SAU 80:SPP 25:CCM 441:C/A 451:DFX 67:PB2 94:PSU 95:U/F 96:UFC 60:3RD 66:A/M 87:PS3 100:M/D 105:PMC 202:LM2 140:SDA 141:SDC 203:LMK 495:PCI 503:LSC 500:SBM 510:SGN 512:ICO 290:EVI S31:S31'.split(' ').map(v=>v.split(':'));
const names=Object.fromEntries(operationPairs), codes=Object.fromEntries(operationPairs.map(([a,b])=>[b,a]));
const code=v=>String(v).replace(/^0+(?=\d)/,'');
const processLabel=v=>[v,names[code(v)]].filter(Boolean).join(' · ');
const identity=(c,l,p)=>JSON.stringify([C.customer(c),String(l).toUpperCase().trim().replace(/\s+/g,' '),code(p)]);
let db,windows=new Map(),visible=[],savedRows=[],selection=new Set(),yieldByKey=new Map();
const headers=['Customer','Process','Machine','Lot','Device','Bump Yield %','Assy Yield %','FT Yield %','In','Out','Window (h)'];
const values=r=>[r.customer,processLabel(r.process),r.machines.join(', '),r.lot,r.device,...['Bump','Assy','FT'].map(k=>r.yields[k]),r.start,r.end,r.hours];
function requestResult(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function writeRecords(store,rows){
 const tx=db.transaction(store,'readwrite');const done=new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});for(const row of rows)tx.objectStore(store).put(row);await done;
}
let cycleReady,lookupData;
function ensureCycle(){return cycleReady||=initCycle().catch(error=>{cycleReady=null;throw error;});}
async function lookup(prefix){
 try{
  await ensureCycle();
  lookupData||=Store.load().then(e=>[...new Map([...windows.values(),...C.latest(e.records)].map(r=>[JSON.stringify([r.customer,r.process,r.machines]),r])).values()]).catch(err=>{lookupData=null;throw err;});
  const records=await lookupData;
  const term=id=>$(prefix+id).value.trim().toUpperCase();
  const customers=records.filter(r=>r.customer.includes(term('customer')));
  const processes=customers.filter(r=>processLabel(r.process).toUpperCase().includes(term('process')));
  presentList(prefix+'customer',customers.map(r=>r.customer));
  presentList(prefix+'process',processes.map(r=>String(r.process)));
  presentList(prefix+'machine',processes.flatMap(r=>r.machines||[]).filter(m=>m.includes(term('machine'))));
 }catch(err){$('status').textContent=err.message;}
}
async function initCycle(){
 const open=indexedDB.open('QACommonalityCycle',1);open.onupgradeneeded=()=>{for(const name of ['windows','searches'])open.result.createObjectStore(name,{keyPath:'id'});};
 db=await requestResult(open);
 for(const r of await requestResult(db.transaction('windows').objectStore('windows').getAll()))windows.set(r.id,r);
 savedRows=await requestResult(db.transaction('searches').objectStore('searches').getAll());listSaved();
}
async function importCycle(file){
 const [head,...lines]=C.csv((await file.text()).replace(/^\uFEFF/,''));if(!head.includes('LOT_ID')||!head.includes('CUST_ID')||!head.includes('C/A_IN_TIME'))throw Error('Cycle time CSV 열을 확인하세요.');
 const incoming=new Map(),rev=file.name.match(/START_(\d+)/i)?.[1]||'';
 for(const line of lines){
  const data=Object.fromEntries(head.map((key,i)=>[key,line[i]?.trim()||'']));
  for(const key of head.filter(k=>k.endsWith('_IN_TIME'))){
   const op=key.slice(0,-8),process=codes[op]||op,start=data[key],end=data[op+'_OUT_TIME'];if(!start&&!end)continue;
   const ms=v=>Date.parse(v.replaceAll('/','-').replace(' ','T')+'+09:00');
   const hours=(ms(end)-ms(start))/3600000,id=identity(data.CUST_ID,data.LOT_ID,process),old=incoming.get(id)||windows.get(id);if(old?.rev>rev)continue;
   incoming.set(id,{id,rev,customer:C.customer(data.CUST_ID),lot:data.LOT_ID,device:data.CUST_DEVICE,process,start,end,hours:Number.isFinite(hours)&&hours>=0?hours:null});
  }
 }
 await writeRecords('windows',incoming.values());for(const [id,r] of incoming)windows.set(id,r);
}
function listSaved(){
 const items=[...savedRows].reverse(),host=$('savedList');
 host.innerHTML=table(['조회 이름','저장 시각','Lot 행','작업'],items.map(s=>[s.name,new Date(s.id).toLocaleString(),s.rows.length,'']));
 host.querySelectorAll('tbody tr').forEach((row,i)=>{
  const item=items[i],cell=row.lastElementChild;
  for(const label of ['조회','삭제']){
   const button=document.createElement('button');button.textContent=label;cell.append(button);
   button.onclick=async()=>{if(label==='조회'){$('snapshot').innerHTML='<h3>'+esc(item.name)+'</h3>'+table(headers,item.rows);return;}
    if(!confirm(item.name+' 조회 결과를 삭제할까요?'))return;
    const tx=db.transaction('searches','readwrite');tx.objectStore('searches').delete(item.id);
    tx.oncomplete=()=>{savedRows=savedRows.filter(s=>s.id!==item.id);$('snapshot').replaceChildren();listSaved();};
   };
  }
 });
}
function presentList(id,items){const list=$(id+'List');list.replaceChildren(...[...new Set(items)].sort().map(v=>new Option(v,v)));}
function prepareRows(){
 const rows=new Map([...windows].map(([key,v])=>[key,{...v,machines:[],yields:{}}]));
 for(const r of C.latest(equipment)){const key=identity(r.customer,r.lot,r.process),w=rows.get(key);rows.set(key,{...r,...w,id:key,yields:{},machines:r.machines});}
 for(const y of joined)for(const lot of y.equipmentLots){const r=rows.get(identity(y.customer,lot,y.process));if(r){r.device||=y.device;if(['Bump','Assy','FT'].includes(y.metric)){r.yields[y.metric]=y.yield;(r.sources??={})[y.metric]=y.id;};}}
 windowSource=[...rows.values()];
}
function renderLots(c,p,m,q){
 const all=windowSource,byCustomer=all.filter(r=>r.customer.includes(c)),byProcess=byCustomer.filter(r=>processLabel(r.process).toUpperCase().includes(p.toUpperCase()));
 presentList('customer',byCustomer.map(r=>r.customer));presentList('process',byProcess.map(r=>String(r.process)));presentList('machine',byProcess.flatMap(r=>r.machines).filter(v=>v.includes(m)));
 visible=byProcess.filter(r=>(!m||r.machines.some(v=>v.includes(m)))&&(!q||C.norm(r.lot+' '+(r.device||'')).includes(q)));
 const shown=new Set(visible.map(r=>r.id));selection=new Set([...selection].filter(id=>shown.has(id)));
 $('equipment').innerHTML=table(headers,visible.map(values));
 const trs=$('equipment').querySelectorAll('tbody tr');
 trs.forEach((tr,i)=>{const id=visible[i].id;const paint=()=>{tr.style.background=selection.has(id)?'#d8ebff':'';tr.setAttribute('aria-selected',String(selection.has(id)));};paint();tr.onclick=e=>{togglePick(selection,id,visible.map(r=>r.id),e);trs.forEach((t,j)=>{const active=selection.has(visible[j].id);t.style.background=active?'#d8ebff':'';t.setAttribute('aria-selected',String(active));});compare();};});
 compare();
}
function compare(){
 const selected=visible.filter(r=>selection.has(r.id));if(!selected.length){$('comparison').replaceChildren();return;}
 const result=[];for(const stage of ['Bump','Assy','FT']){
  const sets=new Map();for(const r of selected){if(!Number.isFinite(r.yields[stage]))continue;for(const m of r.machines){if(!sets.has(m))sets.set(m,new Map());sets.get(m).set(r.sources?.[stage]||identity(r.customer,r.lot,''),r.yields[stage]);}}
  const groups=[...sets];for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   const [ma,a]=groups[i],[mb,b]=groups[j],aa=C.describe([...a].filter(([k])=>!b.has(k)).map(v=>v[1])),bb=C.describe([...b].filter(([k])=>!a.has(k)).map(v=>v[1]));
   const x=aa.sd**2/aa.n,y=bb.sd**2/bb.n,df=(x+y)**2/(x*x/(aa.n-1)+y*y/(bb.n-1)),t=(aa.mean-bb.mean)/Math.sqrt(x+y);
   const p=aa.n>1&&bb.n>1&&Number.isFinite(df)?C.beta(df/(df+t*t),df/2,.5):null;
   result.push([stage,ma,mb,aa.n,bb.n,aa.sd,bb.sd,printP(p),pVerdict(p)]);
  }
 }
 $('comparison').innerHTML='<h3>선택 '+selected.length+'행 · 장비 간 비교</h3>'+(result.length?table(['Yield','장비 A','장비 B','Lot A','Lot B','σ A (%p)','σ B (%p)','Welch p (양측)','판정 (p < 0.05)'],result):'<p>수율이 있는 서로 다른 장비의 Lot을 Ctrl로 선택하세요.</p>')+'<small>두 장비가 함께 사용된 Lot은 해당 쌍의 독립 표본에서 제외합니다.</small>';
}
let windowSource=[], windowCharts=[], pageIndex=0;
const pickedLots=new Set(), pickedWeeks=new Set();
function pVerdict(p){
 if(!Number.isFinite(p))return '계산 불가';
 return p<0.05?'유의차 있음':'유의차 미검출';
}
function printP(p){return Number.isFinite(p)?(p<0.0001?'<0.0001':p.toFixed(4)):'—';}
const anchors=new WeakMap();
function togglePick(set,key,order,event){
 const anchor=anchors.get(set);
 const start=set.has(anchor)?order.indexOf(anchor):-1,end=order.indexOf(key);
 if(event.shiftKey && start>=0 && end>=0){
  if(!event.ctrlKey && !event.metaKey)for(const item of order)set.delete(item);
  for(const item of order.slice(Math.min(start,end),Math.max(start,end)+1))set.add(item);
  return;
 }
 if(set.has(key)){set.delete(key);anchors.delete(set);return;}
 if(!event.ctrlKey && !event.metaKey)set.clear();
 set.add(key);anchors.set(set,key);
}
function weekLabel(start){
 const end=new Date(start+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+6);
 return start.slice(5).replace('-','/')+'–'+end.toISOString().slice(5,10).replace('-','/');
}
// Student prediction residual for an independent Lot against its remaining peers.
function rankLongLots(rows){
 const {n,mean,sd}=C.describe(rows.map(r=>r.hours));
 return rows.map(row=>{
  const delta=row.hours-mean;
  const peerMean=n>1?mean-delta/(n-1):null;
  let p=null;
  if(n>=3&&sd>0){
   const total=(n-1)*sd**2;
   let ss=total-delta**2*n/(n-1);
   if(ss<=total*1e-12){
    const peers=rows.filter(other=>other!==row);
    ss=(C.describe(peers.map(other=>other.hours)).sd**2)*(n-2);
   }
   if(ss>0){
    const df=n-2,t=(row.hours-peerMean)/Math.sqrt(ss/df*(1+1/(n-1)));
    const tail=C.beta(df/(df+t*t),df/2,.5)/2;
    p=Math.min(1,n*(t>=0?tail:1-tail));
   }
  }
  return {row,peerMean,p};
 }).sort((a,b)=>b.row.hours-a.row.hours);
}
function renderWindow(){
 const term=id=>$('w'+id).value.trim().toUpperCase();
 const customer=term('customer'),process=term('process'),machine=term('machine'),lot=term('query');
 const first=windowSource.filter(r=>Number.isFinite(r.hours)&&r.customer.includes(customer)),second=first.filter(r=>processLabel(r.process).toUpperCase().includes(process));
 presentList('wcustomer',first.map(r=>r.customer));presentList('wprocess',second.map(r=>String(r.process)));presentList('wmachine',second.flatMap(r=>r.machines).filter(m=>m.includes(machine)));
 const peers=second.filter(r=>(!machine||r.machines.some(m=>m.includes(machine)))&&r.end.slice(0,10).replaceAll('/','-')>=$('wfrom').value&&r.end.slice(0,10).replaceAll('/','-')<=$('wto').value);
 const rows=peers.filter(r=>C.norm(r.lot).includes(C.norm(lot)));
 const keys=new Set(rows.map(r=>r.id));for(const id of pickedLots)if(!keys.has(id))pickedLots.delete(id);
 const host=$('wrows'),size=80;
 pageIndex=Math.min(pageIndex,Math.max(0,Math.ceil(rows.length/size)-1));
 const part=rows.slice(pageIndex*size,(pageIndex+1)*size);
 host.innerHTML='<div class="actions"><button data-prev>이전</button><span>'+ (pageIndex+1)+' / '+Math.max(1,Math.ceil(rows.length/size))+' · '+rows.length+'행</span><button data-next>다음</button><button data-clear>선택 해제</button></div>'+table(['고객','공정','장비','Lot','In','Out','Window (h)'],part.map(r=>[r.customer,processLabel(r.process),r.machines.join(', '),r.lot,r.start,r.end,r.hours]));
 const prev=host.querySelector('[data-prev]'),next=host.querySelector('[data-next]');prev.disabled=!pageIndex;next.disabled=(pageIndex+1)*size>=rows.length;
 prev.onclick=()=>{pageIndex--;renderWindow();};next.onclick=()=>{pageIndex++;renderWindow();};host.querySelector('[data-clear]').onclick=()=>{pickedLots.clear();pickedWeeks.clear();renderWindow();};
 host.querySelectorAll('tbody tr').forEach((tr,i)=>{const key=part[i].id;tr.classList.toggle('picked',pickedLots.has(key));tr.onclick=e=>{togglePick(pickedLots,key,rows.map(r=>r.id),e);renderWindow();};});
 drawWindowStats(peers,pickedLots.size?pickedLots:keys);
}
function drawWindowStats(rows,display){
 windowCharts.forEach(c=>c.destroy());windowCharts=[];
 const panels=new Map(),host=$('windowStats');host.replaceChildren();
 for(const row of rows){
  const d=new Date(row.end.slice(0,10).replaceAll('/','-')+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const week=d.toISOString().slice(0,10);
  for(const cust of [row.customer]){
   const name=processLabel(code(row.process))+' · '+cust;
   if(!panels.has(name))panels.set(name,new Map());
   const weeks=panels.get(name);if(!weeks.has(week))weeks.set(week,[]);weeks.get(week).push(row);
  }
 }
 if(!panels.size){host.textContent='조건에 맞는 완료 공정이 없습니다.';return;}
 for(const [name,weeks] of [...panels].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}))){
  if(![...weeks.values()].some(group=>group.some(row=>display.has(row.id))))continue;
  const dates=[...weeks.keys()].sort(),key=w=>JSON.stringify([name,w]),usl=Number($('usl').value),target=$('hoursTarget').value;
  const stats=dates.map(w=>{const a=weeks.get(w).map(r=>r.hours),s=C.ttest(a,target===''?null:Number(target));return {w,...s,min:Math.min(...a),max:Math.max(...a),ppu:usl>0&&s.sd?(usl-s.mean)/(3*s.sd):null};});
  const panel=document.createElement('article');panel.className='window-panel';
  panel.innerHTML='<h3>'+esc(name)+'</h3><div class="window-pair"><div class="chart"><canvas></canvas></div><div><h4>장시간 Lot · 보정 p &lt; 0.05</h4><div class="wp"></div></div></div><div class="weekly"></div>';
  host.append(panel);
  function showLots(){
   const selected=dates.filter(w=>pickedWeeks.has(key(w)));
   const period=selected.length?selected:dates;
   const group=period.flatMap(w=>weeks.get(w));
   const ranked=rankLongLots(group).filter(item=>display.has(item.row.id));
   const detail=panel.querySelector('.wp');
   const caption=document.createElement('p');
   caption.textContent=period.map(weekLabel).join(', ')+' · 비교 '+group.length+' Lot';
   const list=document.createElement('div');
   const more=document.createElement('button');
   more.textContent='더 보기';
   let count=0;
   function page(){
    count+=80;
    list.innerHTML=table(['Lot','Out','Q time h','다른 Lot 평균 h','차이 h','보정 p','판정'],ranked.slice(0,count).map(({row,peerMean,p})=>[row.lot,row.end,row.hours,peerMean,peerMean==null?null:row.hours-peerMean,printP(p),p==null?'계산 불가':p<.05?'장시간 후보':'미검출']));
    more.hidden=count>=ranked.length;
   }
   more.onclick=page;detail.replaceChildren(caption,list,more);page();
  }
  showLots();
  const datasets=['min','max','mean','sd'].map((k,i)=>({label:['Min','Max','Avg','Dev'][i],data:stats.map(s=>s[k]),borderColor:['#6588ab','#db9666','#1479bf','#25a699'][i],pointRadius:3,borderWidth:2}));
  if(usl>0)datasets.push({label:'Ppu',yAxisID:'ppu',data:stats.map(s=>s.ppu),borderColor:'#9467bd'});
  const pick=(i,e)=>{togglePick(pickedWeeks,key(dates[i]),dates.map(key),e);panel.querySelectorAll(".weekly tbody tr").forEach((tr,j)=>tr.classList.toggle("picked",pickedWeeks.has(key(dates[j]))));showLots();};
  windowCharts.push(new Chart(panel.querySelector('canvas'),{type:'line',data:{labels:dates,datasets},options:{animation:false,maintainAspectRatio:false,onClick:(e,hits)=>{if(hits.length)pick(hits[0].index,e.native||e);},scales:{y:{title:{display:true,text:'시간 (h)'}},...(usl>0?{ppu:{position:'right',grid:{drawOnChartArea:false}}}:{})}}}));
  panel.querySelector('.weekly').innerHTML=table(['주 시작','Lot 수','Min h','Max h','Avg h','Dev h','목표 평균 대비 p','판정 (p < 0.05)','Ppu'],stats.map(s=>[s.w,s.n,s.min,s.max,s.mean,s.sd,printP(s.p),pVerdict(s.p),s.ppu]));
  panel.querySelectorAll('.weekly tbody tr').forEach((tr,i)=>{tr.classList.toggle('picked',pickedWeeks.has(key(dates[i])));tr.onclick=e=>pick(i,e);});
 }
}
function clearResults(windowOnly){
 const ids=windowOnly?['wrows','windowStats']:['equipment','comparison','trends','snapshot'];
 for(const id of ids)$(id).replaceChildren();
 if(windowOnly){windowCharts.forEach(c=>c.destroy());windowCharts=[];pickedLots.clear();pickedWeeks.clear();}
 else{charts.forEach(c=>c.destroy());charts=[];visible=[];selection.clear();}
}
for(const prefix of ['','w']){
 const isWindow=prefix==='w';
 const perform=()=>search(isWindow);
 $(isWindow?'windowSearch':'lotSearch').onclick=perform;
 const fields=isWindow?['wcustomer','wprocess','wmachine','wquery','wfrom','wto','usl','hoursTarget']:['customer','process','machine','query','metric','from','to','target','shared'];
 for(const id of fields){
  const field=$(id);
  field.addEventListener('input',()=>clearResults(isWindow));
  field.addEventListener('keydown',event=>{if(event.key==='Enter')queueMicrotask(()=>{if(!event.defaultPrevented)perform();});});
 }
 for(const id of ['customer','process','machine']){
  const field=$(prefix+id);
  for(const event of ['focus','input'])field.addEventListener(event,()=>lookup(prefix));
 }
 $(isWindow?'wreset':'resetSearch').onclick=()=>{
  for(const id of ['customer','process','machine','query'])$(prefix+id).value='';
  if(isWindow){$('usl').value='';$('hoursTarget').value='';$('wfrom').value=firstWeek.toISOString().slice(0,10);$('wto').value=today;}
  clearResults(isWindow);
 };
}
const firstWeek=new Date(today+'T00:00:00Z');
firstWeek.setUTCDate(firstWeek.getUTCDate()-(firstWeek.getUTCDay()+6)%7-14);
$('wfrom').value=firstWeek.toISOString().slice(0,10);$('wto').value=today;
$('saveSearch').onclick=async()=>{
 const rows=selection.size?visible.filter(r=>selection.has(r.id)):visible;if(!rows.length)return;
 const unique=xs=>[...new Set(xs)].sort().join(' ');
 const name=[unique(rows.map(r=>r.customer)),unique(rows.map(r=>processLabel(r.process))),unique(rows.flatMap(r=>r.machines))].filter(Boolean).join(' / ');
 const item={id:new Date().toISOString(),name,rows:rows.map(values)};await writeRecords('searches',[item]);savedRows.push(item);listSaved();
};
$('savedList').parentElement.addEventListener('toggle',event=>{if(event.currentTarget.open)ensureCycle().catch(e=>{$('savedList').textContent=e.message;});});
QAAutoMail.startMany(['mclist','cycle'].map(group=>({group,label:group==='cycle'?'Cycle time':'MC List',ready:()=>!busy,importer:ingest})),{label:'Commonality 자동 가져오기'});
