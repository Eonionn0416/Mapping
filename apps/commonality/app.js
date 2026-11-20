import * as C from '../../shared/equipment-core.js?v=120';
import * as Store from '../../shared/equipment-store.js?v=118';
import {loadYields} from './yield-sources.js?v=125';
const $=id=>document.getElementById(id),esc=Store.esc,fmt=v=>v==null?'—':typeof v==='number'?v.toLocaleString(undefined,{maximumFractionDigits:4}):String(v);let equipment=[],yieldRecords=[],busy=false;
const table=(headers,rows)=>'<div class="wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(fmt(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
async function ingest(file){
 await ensureCycle();
 if(busy)throw Error('조회 중입니다. 잠시 후 다시 시도하세요.');
 busy=true;
 try{
  if(/^ASSY_CT_START_/i.test(file.name))await importCycle(file);else await Store.ingest(file);
  loaded=false;lookupData=null;
  $('status').textContent='가져오기 완료 · 검색하면 반영됩니다.';
 }finally{busy=false;}
}
$('file').onchange=async e=>{for(const f of e.target.files)try{await ingest(f);}catch(err){$('status').textContent='가져오기 실패: '+err.message;}e.target.value='';};$('drop').ondragover=e=>e.preventDefault();$('drop').ondrop=async e=>{e.preventDefault();for(const f of e.dataTransfer.files)try{await ingest(f);}catch(err){$('status').textContent='가져오기 실패: '+err.message;}};$('reload').onclick=()=>{loaded=false;lookupData=null;$('status').textContent='다음 검색에서 최신 이력을 조회합니다.';};document.querySelector('.upload-button').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file').click();}};const operationPairs = 'S01:D/B N11:AIN 2:W/I 14:LMN 3:B/G 8:L/G 10:D/S 20:2ND 438:SAU 80:SPP 25:CCM 441:C/A 451:DFX 67:PB2 94:PSU 95:U/F 96:UFC 60:3RD 66:A/M 87:PS3 100:M/D 105:PMC 202:LM2 140:SDA 141:SDC 203:LMK 495:PCI 503:LSC 500:SBM 510:SGN 512:ICO 290:EVI S31:S31'.split(' ').map(v=>v.split(':'));
const names=Object.fromEntries(operationPairs), codes=Object.fromEntries(operationPairs.map(([a,b])=>[b,a]));
const code=v=>String(v).replace(/^0+(?=\d)/,'');
const processLabel=v=>[v,names[code(v)]].filter(Boolean).join(' · ');
const identity=(c,l,p)=>JSON.stringify([C.customer(c),String(l).toUpperCase().trim().replace(/\s+/g,' '),code(p)]);
let db,windows=new Map(),visible=[],savedRows=[],selection=new Set();
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
 const [head,...lines]=C.csv((await file.text()).replace(/^\uFEFF/,''));if(!head.includes('LOT_ID')||!head.includes('CUST_ID')||!head.some(k=>k.endsWith('_IN_TIME')))throw Error('Cycle time CSV 열을 확인하세요.');
 const incoming=new Map(),rev=file.name.match(/START_(\d+)/i)?.[1]||'';
 for(const line of lines){
  const data=Object.fromEntries(head.map((key,i)=>[key,line[i]?.trim()||'']));
  for(const key of head.filter(k=>k.endsWith('_IN_TIME'))){
   const op=key.slice(0,-8),process=codes[op]||op,start=data[key],end=data[op+'_OUT_TIME'];if(!start&&!end)continue;
   const ms=v=>Date.parse(String(v||'').replaceAll('/','-').replace(' ','T')+'+09:00');
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
   button.onclick=async()=>{if(label==='조회'){$('snapshot').innerHTML='<h3>'+esc(item.name)+'</h3>'+table(item.headers||headers,item.rows);return;}
    if(!confirm(item.name+' 조회 결과를 삭제할까요?'))return;
    const tx=db.transaction('searches','readwrite');tx.objectStore('searches').delete(item.id);
    tx.oncomplete=()=>{savedRows=savedRows.filter(s=>s.id!==item.id);$('snapshot').replaceChildren();listSaved();};
   };
  }
 });
}
function presentList(id,items){const list=$(id+'List');list.replaceChildren(...[...new Set(items)].sort().map(v=>new Option(v,v)));}
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
function rankLots(rows,direction){
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
    const upper=t>=0?tail:1-tail;
    p=Math.min(1,n*(direction==="both"?2*tail:direction==="low"?(t<=0?tail:1-tail):upper));
   }
  }
  return {row,peerMean,p};
 }).sort((a,b)=>b.row.hours-a.row.hours);
}
let loaded=false, page=0, serial=0, population=[];
const stages=['Bump','Assy','FT'];
const outputHeaders=[...headers,'전체 고객 p','동일 고객 p','판정'];
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const start=new Date(today+'T00:00:00Z');
start.setUTCDate(start.getUTCDate()-14-(start.getUTCDay()+6)%7);
$('from').value=start.toISOString().slice(0,10);
$('to').value=today;

function add(map,key,value){
 if(!map.has(key))map.set(key,[]);
 map.get(key).push(value);
}
function reportIndex(){
 const index=new Map();
 for(const report of yieldRecords){
  if(!stages.includes(report.metric))continue;
  for(const alias of new Set([report.lot,...report.aliases||[]].map(C.norm).filter(Boolean))){
   add(index,JSON.stringify([report.customer,alias]),report);
  }
 }
 return index;
}
function stageYield(reports){
 if(!reports.length)return null;
 if(reports.length===1)return reports[0].yield;
 if(reports.some(r=>!(r.input>0)))return null;
 return reports.reduce((n,r)=>n+r.input*r.yield,0)/reports.reduce((n,r)=>n+r.input,0);
}
function buildResults(){
 const equipmentById=new Map(C.latest(equipment).map(r=>[identity(r.customer,r.lot,r.process),r]));
 const index=reportIndex(), groups=new Map();
 const term=id=>C.norm($(id).value);
 const machine=term('machine'),process=term('process'),customer=term('customer'),lot=term('query');
 for(const w of windows.values()){
  const day=C.day(w.end);
  if(!Number.isFinite(w.hours)||!day||day<$('from').value||day>$('to').value)continue;
  if(!C.norm(processLabel(w.process)).includes(process))continue;
  const machines=equipmentById.get(w.id)?.machines||[];
  const exposures=machine?machines.filter(m=>C.norm(m).includes(machine)):[''];
  const exact=index.get(JSON.stringify([w.customer,C.norm(w.lot)]))||[];
  // A split Lot may have only a parent-level yield. Keep its scope visible.
  const parent=index.get(JSON.stringify([w.customer,C.baseLot(w.lot)]))||[];
  const records=[...exact,...parent.filter(y=>!exact.some(r=>r.metric===y.metric)).map(y=>({...y,parent:true}))];
  const yields=Object.fromEntries(stages.map(stage=>[stage,stageYield(records.filter(r=>r.metric===stage))]));
  for(const unit of exposures){
   const row={...w,machines:unit?[unit]:machines,reports:records,yields,sourceId:w.id,id:JSON.stringify([w.id,unit])};
   add(groups,JSON.stringify([code(w.process),unit]),row);
  }
 }
 population=[];visible=[];
 const direction=$('direction').value;
 for(const group of groups.values()){
  const customers=new Map();
  for(const entry of rankLots(group,direction)){
   entry.row.all=entry;
   entry.row.cohort=group;
   add(customers,entry.row.customer,entry.row);
  }
  for(const rows of customers.values())for(const entry of rankLots(rows,direction)){
   const r=entry.row;r.own=entry;
   r.flag=[r.all,r.own].some(x=>Number.isFinite(x.p)&&x.p<.05);
   if(customer&&!C.norm(r.customer).includes(customer))continue;
   population.push(r);
   if(C.norm(r.lot+' '+(r.device||'')).includes(lot))visible.push(r);
  }
 }
 visible.sort((a,b)=>Number(b.flag)-Number(a.flag)||(Math.min(a.all.p??1,a.own.p??1)-Math.min(b.all.p??1,b.own.p??1))||b.hours-a.hours);
}
function verdict(r){
 const labels=[];
 for(const [name,result] of [['전체',r.all],['고객',r.own]]){
  if(result.p!=null&&result.p<.05)labels.push(name+' '+(r.hours>result.peerMean?'장시간':'단시간'));
 }
 return labels.join(' · ')||(r.all.p==null&&r.own.p==null?'계산 불가':'미검출');
}
function cells(r){return [...values(r),printP(r.all.p),printP(r.own.p),verdict(r)];}
function draw(){
 const host=$('equipment'),limit=100,part=visible.slice(page*limit,(page+1)*limit);
 $('count').textContent=visible.length+'행 · 유의 후보 '+visible.filter(r=>r.flag).length+'행';
 host.innerHTML=table(outputHeaders,part.map(cells));
 const trs=host.querySelectorAll('tbody tr');
 function paint(){trs.forEach((tr,i)=>{tr.classList.toggle('picked',selection.has(part[i].id));tr.setAttribute('aria-selected',selection.has(part[i].id));});}
 trs.forEach((tr,i)=>{
  const r=part[i];tr.tabIndex=0;tr.classList.toggle('flag',r.flag);
  const pick=e=>{togglePick(selection,r.id,visible.map(x=>x.id),e);paint();details();};
  tr.onclick=pick;tr.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();pick(e);}};
 });
 paint();
 if(visible.length>limit){
  const nav=document.createElement('div');nav.className='pagebar';
  for(const [label,step] of [['이전',-1],['다음',1]]){
   const b=document.createElement('button');b.textContent=label;b.disabled=step<0?page===0:(page+1)*limit>=visible.length;b.onclick=()=>{page+=step;draw();};nav.append(b);
  }
  nav.append((page+1)+' / '+Math.ceil(visible.length/limit));host.append(nav);
 }
}
function stageCards(rows){
 const reports=[...new Map(rows.flatMap(r=>r.reports).map(y=>[y.id,y])).values()];
 return '<div class="stages">'+stages.map(stage=>{
  const data=reports.filter(r=>r.metric===stage),qty=new Map();
  for(const r of data)for(const [mode,n] of Object.entries(r.defects||{}))if(n>0)qty.set(mode,(qty.get(mode)||0)+n);
  const pairs=[...qty].sort((a,b)=>b[1]-a[1]),total=pairs.reduce((n,p)=>n+p[1],0);
  let cumulative=0;
  const bars=pairs.map(([name,n])=>{cumulative+=n;return '<span>'+esc(name)+'</span><i style="width:'+100*n/pairs[0][1]+'%"></i><span>'+fmt(n)+' · '+(100*cumulative/total).toFixed(1)+'%</span>';}).join('');
  const y=stageYield(data);
  return '<section class="stage"><h3>'+stage+' Yield</h3><strong>'+(y==null?'—':fmt(y)+'%')+'</strong>'+ (data.some(y=>y.parent)?' · 모 Lot 수율 포함':'')+'<h4>Defect Pareto · Qty / 누적 %</h4>'+(bars?'<div class="pareto">'+bars+'</div>':'불량 모드별 수량 없음')+'</section>';
 }).join('')+'</div>';
}
function details(){
 const host=$('comparison'),selected=visible.filter(r=>selection.has(r.id));
 host.replaceChildren();if(!selected.length)return;
 host.innerHTML='<h3>선택 Lot 상세</h3>';
 const groups=new Map();
 for(const row of selected)add(groups,row.cohort,row);
 for(const [cohort,members] of groups){
  host.insertAdjacentHTML('beforeend',selectionPanel(cohort,members));
 }
 for(const r of new Map(selected.map(r=>[JSON.stringify([r.customer,r.lot]),r])).values()){
  host.insertAdjacentHTML('beforeend','<h4>'+esc(r.customer+' · '+r.lot)+'</h4>'+stageCards([r])+specDetails(r));
 }
 if(selected.length>1){
  const button=document.createElement('button');button.textContent='선택 그룹과 다른 Lot 비교';
  const body=document.createElement('div');host.append(button,body);
  button.onclick=()=>{
   const cohorts=new Map();
   for(const r of selected)add(cohorts,JSON.stringify([r.process,$('machine').value?r.machines[0]:'']),r);
   body.replaceChildren();
   for(const [key,group] of cohorts){
    const [process,m]=JSON.parse(key),ids=new Set(group.map(x=>x.sourceId));
    const others=population.filter(x=>x.process===process&&(!m||x.machines.includes(m))&&!ids.has(x.sourceId));
    body.insertAdjacentHTML('beforeend','<h3>'+esc(processLabel(process)+' '+m)+'</h3>');
    for(const [name,list] of [['선택 그룹',group],['다른 Lot',others]]){
     body.insertAdjacentHTML('beforeend','<h4>'+name+' · '+list.length+' Lot · 평균 Window '+fmt(C.describe(list.map(x=>x.hours)).mean)+' h</h4>'+stageCards(list));
    }
   }
  };
 }
}
async function search(){
 if(busy){$('status').textContent='데이터 처리 중입니다. 완료 후 검색하세요.';return;}
 if(!$('from').value||!$('to').value||$('from').value>$('to').value){$('count').textContent='조회 기간을 확인하세요.';return;}
 const token=++serial;busy=true;
 try{
  await ensureCycle();
  if(!loaded){
   const [e,y]=await Promise.all([Store.load(true),loadYields()]);
   equipment=e.records;yieldRecords=y.records;loaded=true;
   $('status').textContent=[e.error,...y.errors].filter(Boolean).join(' / ');
  }
  if(token!==serial)return;
  page=0;selection.clear();buildResults();draw();details();
 }catch(e){$('status').textContent='조회 실패 · '+e.message;}finally{busy=false;}
}
function clear(){
 serial++;visible=[];population=[];selection.clear();page=0;
 for(const id of ['count','equipment','comparison','snapshot'])$(id).replaceChildren();
}
$('lotSearch').onclick=search;
for(const id of ['customer','process','machine','query','from','to','direction']){
 $(id).addEventListener('input',clear);
 if(['customer','process','machine'].includes(id))for(const event of ['focus','input'])$(id).addEventListener(event,()=>lookup(''));
 $(id).addEventListener('keydown',e=>{if(e.key==='Enter')queueMicrotask(()=>{if(!e.defaultPrevented)search();});});
}
$('resetSearch').onclick=()=>{for(const id of ['customer','process','machine','query'])$(id).value='';$('direction').value='high';$('from').value=start.toISOString().slice(0,10);$('to').value=today;clear();};
$('saveSearch').onclick=async()=>{
 const rows=selection.size?visible.filter(r=>selection.has(r.id)):visible;if(!rows.length)return;
 const name=['customer','process','machine','query'].map(id=>$(id).value.trim()).filter(Boolean).join(' / ')||'전체 고객 · 전체 공정';
 const item={id:new Date().toISOString(),name,headers:outputHeaders,rows:rows.map(cells)};
 await writeRecords('searches',[item]);savedRows.push(item);listSaved();
};
$('savedList').parentElement.addEventListener('toggle',e=>{if(e.currentTarget.open)ensureCycle().catch(err=>{$('status').textContent=err.message;});});
QAAutoMail.startMany(['mclist','cycle'].map(group=>({group,label:group==='cycle'?'Cycle time':'MC List',ready:()=>!busy,importer:ingest})),{label:'Commonality 자동 가져오기'});
// The two Meaning columns are the authoritative event mapping for W-165.
const rules=[
 ['Wafer Taping out','14','start','Wafer Back Side Grinding in','3','start',24],
 ['Wafer Back Side Grinding in','3','start','Wafer mount out','3','end',8],
 ['Wafer mount out & De-Taping','3','start','UV Irradiation in','10','start',48],
 ['UV Irradiation out','10','end','Flip Chip bonding in','441','start',336],
 ['Cap Solder Paste Printing in','25','start','Flip Chip Reflow out','441','end',8],
 ['Flip Chip Reflow out','441','end','Flux Cleaning out','451','end',8],
 ['Pre-plasma Cleaning Before Underfill out','94','end','Underfill Dispensing in','95','start',3],
 ['Pre-plasma Cleaning Before Underfill out','94','end','Underfill Dispensing out','95','end',4],
 ['Pre-baking Before Underfill out','67','end','Underfill Dispensing in','95','start',12],
 ['Underfill Dispensing in','95','start','Underfill Curing in','96','start',4],
 ['Pre-plasma Cleaning Before Molding out','87','end','Molding in','100','start',8],
 ['Pre-baking Before Molding out',null,null,'Molding in','100','start',24],
 ['Molding out','100','end','Post Mold Cure in','105','start',24],
 ['Post Mold Cure out','105','end','Strip Pre-treatment (Reflow) out',null,null,48],
 ['OSP Substrate Pre-treatment (Flux Clean) out',null,null,'Ball Placement in',null,null,16]
];
function eventTime(value){
 return value?Date.parse(String(value).trim().replaceAll('/','-').replace(' ','T')+'+09:00'):NaN;
}
function specDetails(row){
 if(row.customer!=='MTK')return '';
 const meaning=(op,field)=>op?names[op]+' '+(field==='start'?'In':'Out'):null;
 const time=(op,field)=>op?windows.get(identity(row.customer,row.lot,op))?.[field]:null;
 const lines=rules.map(([startLabel,a,f,endLabel,b,g,limit])=>{
  const left=time(a,f),right=time(b,g),elapsed=(eventTime(right)-eventTime(left))/3600000;
  const valid=Number.isFinite(elapsed)&&elapsed>=0;
  let status='Meaning 미지정';
  if(a&&b)status=!Number.isFinite(elapsed)?'시각 미수집':elapsed<0?'시각 순서 확인':elapsed>limit?'상한 초과':'상한 이내';
  return [startLabel,meaning(a,f),endLabel,meaning(b,g),limit,left||null,right||null,valid?elapsed:null,status];
 });
 return '<details><summary>MTK W-165 · 구간별 Q time</summary>'+table(['시작 공정','Meaning','종료 공정','Meaning','상한 h','시작 시각','종료 시각','Q time h','Spec 판정'],lines)+'</details>';
}
function selectionStats(cohort,members){
 const ids=new Set(members.map(row=>row.sourceId));
 const customers=new Set(members.map(row=>row.customer));
 const remaining=cohort.filter(row=>!ids.has(row.sourceId));
 const summarize=rows=>C.describe(rows.map(row=>row.hours));
 return {
  selected:summarize(members),
  all:summarize(remaining),
  own:summarize(remaining.filter(row=>customers.has(row.customer))),
  customers:[...customers].sort()
 };
}

function selectionPanel(cohort,members){
 const stats=selectionStats(cohort,members),first=members[0];
 const process=processLabel(first.process),machine=$('machine').value?first.machines[0]:'';
 const ownLabel=stats.customers.length===1?'동일 고객':'선택 고객';
 const title=[process,machine,stats.customers.join(' · ')].filter(Boolean).join(' / ');
 const reports=[...new Map(members.flatMap(row=>row.reports).map(report=>[report.id,report])).values()];
 const records=members.map(r=>[r.customer,r.lot,r.start,r.hours,r.all.peerMean,r.own.peerMean,...stages.map(stage=>r.yields[stage])]);
 records.push([stats.customers.join(' · '),'선택 그룹 평균 ('+stats.selected.n+' Lot)','—',stats.selected.mean,stats.all.mean,stats.own.mean,
  ...stages.map(stage=>stageYield(reports.filter(report=>report.metric===stage)))]);
 return '<section class="window-selection"><h4>'+esc(title)+'</h4>'
  +table(['Customer','Lot','In time','Window h','전체 고객 비교 평균 h',ownLabel+' 비교 평균 h',...stages.map(x=>x+' %')],records)
  +windowPlot(members,stats,ownLabel)+'</section>';
}

function windowPlot(members,stats,ownLabel){
 const points=members.map(row=>({row,t:eventTime(row.start)})).filter(p=>Number.isFinite(p.t));
 if(!points.length)return '<p>In time 기록이 없습니다.</p>';
 const bounds={left:65,right:845,top:25,bottom:207};
 let low=Infinity,high=-Infinity,maxY=0;
 for(const {t,row} of points){low=Math.min(low,t);high=Math.max(high,t);maxY=Math.max(maxY,row.hours);}
 const padding=high===low?1800000:(high-low)*.05;
 const minTime=low-padding,maxTime=high+padding;
 const yMax=Math.max(.01,maxY,stats.all.mean||0,stats.own.mean||0)*1.1;
 const x=t=>bounds.left+(t-minTime)/(maxTime-minTime)*(bounds.right-bounds.left);
 const y=h=>bounds.bottom-h/yMax*(bounds.bottom-bounds.top);
 const tickTime=t=>new Date(t+9*3600000).toISOString().slice(5,16).replace('T',' ');
 const refs=[
  {label:'전체 고객',stat:stats.all,color:'#79539b',dash:'9 5'},
  {label:ownLabel,stat:stats.own,color:'#00796c',dash:'3 5'}
 ];
 let marks='';
 for(let i=0;i<=4;i++){
  const h=yMax*i/4,yy=y(h);
  marks+='<path d="M65 '+yy+' H845" stroke="#dde6ee"/><text x="56" y="'+(yy+4)+'" text-anchor="end">'+fmt(Number(h.toPrecision(3)))+'</text>';
 }
 const ticks=low===high?[low]:[low,(low+high)/2,high];
 for(const t of ticks)marks+='<text x="'+x(t)+'" y="228" text-anchor="middle">'+tickTime(t)+'</text>';
 for(const ref of refs)if(ref.stat.n)marks+='<path d="M65 '+y(ref.stat.mean)+' H845" fill="none" stroke="'+ref.color+'" stroke-width="2" stroke-dasharray="'+ref.dash+'"/>';
 for(const {row,t} of points){
  const long=result=>Number.isFinite(result.p)&&result.p<.05&&row.hours>result.peerMean;
  const own=long(row.own),all=long(row.all);
  const color=own?'#c02d36':all?'#d66a0a':'#156ebb';
  const stroke=own&&all?'#e47c15':'white';
  const status=[own?'동일 고객 장시간':'',all?'전체 고객 장시간':''].filter(Boolean).join(' · ')||'장시간 미검출 / 계산 불가';
  marks+='<circle cx="'+x(t)+'" cy="'+y(row.hours)+'" r="5" fill="'+color+'" stroke="'+stroke+'" stroke-width="'+(own&&all?2.5:1.5)+'"><title>'
   +esc(row.lot+' · '+row.start+' · '+fmt(row.hours)+' h · '+status+' · 전체 p '+printP(row.all.p)+' / 고객 p '+printP(row.own.p))+'</title></circle>';
 }
 const legend=refs.map(ref=>'<span><i style="color:'+ref.color+'"></i>'+ref.label+' 평균 '+fmt(ref.stat.mean)+' h ('+ref.stat.n+' Lot)</span>').join('');
 return '<figure class="window-plot"><figcaption>선택 Lot · In time별 Window time</figcaption><svg role="img" aria-label="선택한 Lot의 공정 투입 시각과 Window time, 선택 그룹을 제외한 비교 평균" viewBox="0 0 910 258" font-size="13" fill="#475b70"><text x="12" y="17">시간 (h)</text>'
  +marks+'<text x="455" y="249" text-anchor="middle">In time (KST)</text></svg><div class="window-key"><span><b style="color:#156ebb">●</b> 기타 선택 Lot</span><span><b style="color:#c02d36">●</b> 동일 고객 장시간</span><span><b style="color:#d66a0a">●</b> 전체 고객 장시간</span><span><b class="both-dot"></b> 두 기준 모두</span>'+legend+'</div><small>점선과 그룹 행의 비교 평균은 선택 Lot 전체를 제외합니다.</small></figure>';
}
