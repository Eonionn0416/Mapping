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
const pool=timed.filter(r=>(!c||r.customer===c)&&(!p||r.process===p)&&r.metric===$('metric').value&&r.date>=$('from').value&&r.date<=$('to').value&&(!q||C.norm(r.device+' '+r.lot).includes(q))&&($('shared').checked||!r.shared));const panels=new Map();for(const r of pool){if(m&&!r.machines.includes(m))continue;const k=JSON.stringify([r.customer,r.device,r.process,r.metric]);if(!panels.has(k))panels.set(k,[]);panels.get(k).push(r);}for(const rs of panels.values()){const first=rs[0],panel=document.createElement('article');panel.className='pair';panel.innerHTML='<div><h2>'+esc([first.customer,first.device,'공정 '+first.process,first.metric].join(' · '))+'</h2><div class="chart"><canvas></canvas></div><div class="stats"></div></div><div class="details"><h2>Lot 상세</h2><div class="actions"><button>전체 보기</button><span class="muted"></span></div><div class="lots"></div></div>';host.append(panel);const draw=list=>{panel.querySelector('.details span').textContent=list.length+' Lot';panel.querySelector('.lots').innerHTML=table(['일시 / 기준','Lot','사용 장비','Yield %','In Qty','Out Qty','장비 보고일','연결'],[...list].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>[(r.time||r.date)+' · '+(r.dateBasis||'보고일'),r.lot,r.machines.join(' · '),r.yield,r.input,r.output,r.equipmentDate,r.shared?'복수 장비':'단일 장비']));};draw(rs);panel.querySelector('button').onclick=()=>draw(rs);
const machines=[...new Set(rs.flatMap(r=>r.machines))].filter(x=>!m||m===x).sort(),dates=[...new Set(rs.map(r=>r.time||r.date))].sort(),palette=['#159ee3','#16b6c7','#79b4e1','#73c9bc','#91a7cf','#d1a3b4'];const datasets=machines.map((machine,i)=>({label:machine,data:rs.filter(r=>r.machines.includes(machine)).sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({x:timestamp(r),y:r.yield,record:r})),showLine:true,spanGaps:false,tension:0,borderWidth:1.5,pointRadius:4,backgroundColor:palette[i%palette.length],borderColor:palette[i%palette.length]}));charts.push(new Chart(panel.querySelector('canvas'),{type:'scatter',data:{datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,onClick:(event,hits)=>{if(hits.length){const hit=hits[0],point=datasets[hit.datasetIndex].data[hit.index];draw(rs.filter(r=>(r.time||r.date)===(point.record.time||point.record.date)&&r.machines.includes(datasets[hit.datasetIndex].label)));}},plugins:{legend:{position:'bottom'},tooltip:{callbacks:{title:items=>items.map(i=>i.raw.record.time||i.raw.record.date).join(''),label:ctx=>ctx.dataset.label+' · '+ctx.raw.record.lot+' · '+fmt(ctx.raw.y)+'%'}}},scales:{x:{min:Math.min(...rs.map(timestamp))-3600000,max:Math.max(...rs.map(timestamp))+3600000,title:{display:true,text:first.dateBasis||'수율 보고일'},ticks:{maxTicksLimit:6,callback:v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)),maxRotation:30}},y:{min:Math.max(0,Math.min(99.7,...rs.map(r=>r.yield))-.1),max:100,title:{display:true,text:'Yield %'}}}}}));
const stats=machines.map(machine=>{const group=rs.filter(r=>r.machines.includes(machine)),target=$('target').value===''?null:Number($('target').value),t=C.ttest([...new Map(group.map(r=>[r.id,r.yield])).values()],target);return [machine,t.n,t.mean,t.sd,t.t,t.p,t.reason||(t.p<.05?'목표와 차이 감지':'차이 근거 부족')];});panel.querySelector('.stats').innerHTML=table(['Machine','n Lot','평균 %','1σ Deviation','t','Prob t (양측)','결과'],stats);}
if(!panels.size)host.innerHTML='<p class="empty">조건에 맞는 수율 연결이 없습니다. 고객별 Yield 보고서를 먼저 가져오거나 조회 기간 / 복수 장비 포함 조건을 확인하세요.</p>';}
async function reload(){if(busy)return;busy=true;$('status').textContent='장비 및 수율 이력 조회 중…';try{const [e,y]=await Promise.all([Store.load(true),loadYields()]);equipment=e.records;joined=C.join(equipment,y.records);chooseFilters();render();$('status').textContent=C.latest(equipment).length+'개 Lot·공정 / '+joined.length+'개 수율 연결'+([e.error,...y.errors].filter(Boolean).length?' · '+[e.error,...y.errors].filter(Boolean).join(' / '):'');}catch(e){$('status').textContent='조회 실패: '+e.message;}finally{busy=false;}}
async function ingest(file){if(/^ASSY_CT_START_/i.test(file.name)){await importCycle(file);render();return;}if(busy)throw Error('조회 중입니다. 잠시 후 다시 시도하세요.');busy=true;try{await Store.ingest(file);}finally{busy=false;}await reload();}
$('file').onchange=async e=>{for(const f of e.target.files)try{await ingest(f);}catch(err){$('status').textContent='가져오기 실패: '+err.message;}e.target.value='';};$('drop').ondragover=e=>e.preventDefault();$('drop').ondrop=async e=>{e.preventDefault();for(const f of e.dataTransfer.files)try{await ingest(f);}catch(err){$('status').textContent='가져오기 실패: '+err.message;}};$('reload').onclick=reload;for(const id of ['customer','process'])$(id).onchange=()=>{chooseFilters();render();};for(const id of ['machine','metric','from','to','query','target','shared'])$(id).onchange=()=>{if($('target').checkValidity())render();else $('target').reportValidity();};document.querySelector('.upload-button').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file').click();}};const operationPairs = 'S01:D/B N11:AIN 2:W/I 14:LMN 3:B/G 8:L/G 10:D/S 20:2ND 438:SAU 80:SPP 25:CCM 441:C/A 451:DFX 67:PB2 94:PSU 95:U/F 96:UFC 60:3RD 66:A/M 87:PS3 100:M/D 105:PMC 202:LM2 140:SDA 141:SDC 203:LMK 495:PCI 503:LSC 500:SBM 510:SGN 512:ICO 290:EVI S31:S31'.split(' ').map(v=>v.split(':'));
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
function listSaved(){const select=$('saved');select.replaceChildren(new Option('저장한 조회 결과',''));for(const s of [...savedRows].reverse())select.add(new Option(s.name,s.id));}
function presentList(id,items){const list=$(id+'List');list.replaceChildren(...[...new Set(items)].sort().map(v=>new Option(v,v)));}
function renderLots(c,p,m,q){
 const rows=new Map([...windows].map(([key,v])=>[key,{...v,machines:[],yields:{}}]));
 for(const r of C.latest(equipment)){const key=identity(r.customer,r.lot,r.process),w=rows.get(key);rows.set(key,{...r,...w,id:key,yields:{},machines:r.machines});}
 for(const y of joined)for(const lot of y.equipmentLots){const r=rows.get(identity(y.customer,lot,y.process));if(r){r.device||=y.device;if(['Bump','Assy','FT'].includes(y.metric)){r.yields[y.metric]=y.yield;(r.sources??={})[y.metric]=y.id;};}}
 const all=[...rows.values()],byCustomer=all.filter(r=>r.customer.includes(c)),byProcess=byCustomer.filter(r=>processLabel(r.process).toUpperCase().includes(p.toUpperCase()));
 presentList('customer',byCustomer.map(r=>r.customer));presentList('process',byProcess.map(r=>String(r.process)));presentList('machine',byProcess.flatMap(r=>r.machines).filter(v=>v.includes(m)));
 visible=byProcess.filter(r=>(!m||r.machines.some(v=>v.includes(m)))&&(!q||C.norm(r.lot+' '+(r.device||'')).includes(q)));
 const shown=new Set(visible.map(r=>r.id));selection=new Set([...selection].filter(id=>shown.has(id)));
 $('equipment').innerHTML=table(headers,visible.map(values));
 const trs=$('equipment').querySelectorAll('tbody tr');
 trs.forEach((tr,i)=>{const id=visible[i].id;const paint=()=>{tr.style.background=selection.has(id)?'#d8ebff':'';tr.setAttribute('aria-selected',String(selection.has(id)));};paint();tr.onclick=e=>{if(!e.shiftKey){selection.clear();trs.forEach(t=>{t.style.background='';t.setAttribute('aria-selected','false');});}if(selection.has(id))selection.delete(id);else selection.add(id);paint();compare();};});
 compare();windowReport(visible);
}
function compare(){
 const selected=visible.filter(r=>selection.has(r.id));if(!selected.length){$('comparison').replaceChildren();return;}
 const result=[];for(const stage of ['Bump','Assy','FT']){
  const sets=new Map();for(const r of selected){if(!Number.isFinite(r.yields[stage]))continue;for(const m of r.machines){if(!sets.has(m))sets.set(m,new Map());sets.get(m).set(r.sources?.[stage]||identity(r.customer,r.lot,''),r.yields[stage]);}}
  const groups=[...sets];for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   const [ma,a]=groups[i],[mb,b]=groups[j],aa=C.describe([...a].filter(([k])=>!b.has(k)).map(v=>v[1])),bb=C.describe([...b].filter(([k])=>!a.has(k)).map(v=>v[1]));
   const x=aa.sd**2/aa.n,y=bb.sd**2/bb.n,df=(x+y)**2/(x*x/(aa.n-1)+y*y/(bb.n-1)),t=(aa.mean-bb.mean)/Math.sqrt(x+y);
   result.push([stage,ma,mb,aa.n,bb.n,aa.sd,bb.sd,aa.n>1&&bb.n>1&&Number.isFinite(df)?C.beta(df/(df+t*t),df/2,.5):null]);
  }
 }
 $('comparison').innerHTML='<h3>선택 '+selected.length+'행 · 장비 간 비교</h3>'+(result.length?table(['Yield','장비 A','장비 B','Lot A','Lot B','σ A (%p)','σ B (%p)','Welch p (양측)'],result):'<p>수율이 있는 서로 다른 장비의 Lot을 Shift로 선택하세요.</p>')+'<small>두 장비가 함께 사용된 Lot은 해당 쌍의 독립 표본에서 제외합니다.</small>';
}
function windowReport(rows){
 const bins=new Map(),usl=Number($('usl').value),target=$('hoursTarget').value;
 for(const r of rows){if(!Number.isFinite(r.hours))continue;const date=r.end.slice(0,10).replaceAll('/','-');if(date<$('from').value||date>$('to').value)continue;
 const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const week=d.toISOString().slice(0,10);
 for(const customer of ['All',r.customer]){const k=JSON.stringify([customer,code(r.process),week]);if(!bins.has(k))bins.set(k,[]);bins.get(k).push(r.hours);}}
 const points=[];for(const [key,a] of [...bins].sort()){const [cust,op,week]=JSON.parse(key),s=C.ttest(a,target===''?null:Number(target));points.push([cust,processLabel(op),week,s.n,Math.min(...a),Math.max(...a),s.mean,s.sd,s.p,usl>0&&s.sd?(usl-s.mean)/(3*s.sd):null]);}
 const host=$('windowStats');host.innerHTML=table(['고객','공정','주 시작','n','Min h','Max h','Avg h','σ h','목표 대비 p','Ppu'],points);
 if(usl>0&&points.some(r=>r[9]!=null)){const box=document.createElement('div');box.className='chart';box.innerHTML='<canvas></canvas>';host.prepend(box);const weeks=[...new Set(points.map(r=>r[2]))].sort(),series=new Map();for(const r of points){const k=r[0]+' · '+r[1];if(!series.has(k))series.set(k,new Map());series.get(k).set(r[2],r[9]);}charts.push(new Chart(box.firstChild,{type:'line',data:{labels:weeks,datasets:[...series].map(([label,map])=>({label,data:weeks.map(w=>map.get(w)??null)})).concat([{label:'1.33',data:weeks.map(()=>1.33),borderDash:[5,4],pointRadius:0}])},options:{maintainAspectRatio:false,animation:false}}));}
}
for(const id of ['customer','process','machine','query','usl','hoursTarget'])$(id).oninput=()=>{ $('snapshot').replaceChildren();render();};
$('resetSearch').onclick=()=>{for(const id of ['customer','process','machine','query','saved'])$(id).value='';selection.clear();$('snapshot').replaceChildren();render();};
$('saveSearch').onclick=async()=>{const name=prompt('조회 결과 이름');if(!name?.trim())return;const item={id:new Date().toISOString(),name,rows:visible.map(values)};await writeRecords('searches',[item]);savedRows.push(item);listSaved();};
$('saved').onchange=()=>{const s=savedRows.find(r=>r.id===$('saved').value);$('snapshot').innerHTML=s?'<h3>'+esc(s.name)+' · 저장 당시 결과</h3>'+table(headers,s.rows):'';};

await initCycle();await reload();QAAutoMail.startMany(['mclist','cycle'].map(group=>({group,label:group==='cycle'?'Cycle time':'MC List',ready:()=>!busy,importer:ingest})),{label:'Commonality 자동 가져오기'});
