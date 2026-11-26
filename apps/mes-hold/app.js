import {pickChart,pickTable} from '../../shared/trend-selection.js';
import {publish,history} from '../../shared/report-history.js';
import {episodes,balances,remaining,age,dateOf} from './core.js';
const $=s=>document.querySelector(s),collection='qaMesHoldEvents',today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
let all=[],chart,selected=null;
function table(host,headers,rows,styles=[]){
 const t=document.createElement('table'),h=t.createTHead().insertRow();
 for(const label of headers){const th=document.createElement('th');th.textContent=label;h.append(th)}
 const b=t.createTBody();rows.forEach((values,i)=>{const tr=b.insertRow();tr.className=styles[i]||'';for(const v of values)tr.insertCell().textContent=typeof v==='number'?v.toLocaleString():v||'—'});
 host.replaceChildren(t);pickTable(t);if(!rows.length)host.append('해당 Lot 없음');
}
function detail(host,rows,date){
 table(host,['Customer','Lot','Device','공정','Hold date','경과일','Unit Qty','Hold 사유'],rows.map(r=>[r.customer,r.lot,r.device,r.operation,dateOf(r.start),age(r,date),r.qty,r.reason||r.code]),rows.map(r=>age(r,date)>30?'aged':''));
}
function render(){
 const customer=$('#customers').value,rows=all.filter(r=>!customer||customer===r.customer),now=today();
 const daily=balances(rows,now);
 table($('#summary'),['날짜','Customer','전일 이월 Lot','신규 Hold Lot','Hold Unit','당일 Release Lot','Release Unit','마감 미해제 Lot','미해제 Unit'],daily.summaryRows);
 const active=remaining(rows,now);detail($('#aged'),active.filter(r=>age(r,now)>30),now);
 function show(){const d=selected?.day||now;$('#detailTitle').textContent=selected?d+' '+selected.type+' · 당일 마감 미해제 Lot':'현재 미해제 Lot';detail($('#detail'),remaining(rows,d),d)}
 show();chart?.destroy();
 const days=daily.days.map(row=>row.day);
 const sets=[
  {label:'신규 Hold',key:'holds',backgroundColor:'#1677bf'},
  {label:'당일 Release',key:'releases',backgroundColor:'#0eaaa7'},
  {label:'마감 미해제',key:'closing',type:'line',borderColor:'#7743a6',backgroundColor:'#7743a6',order:-1}
 ].map(series=>({...series,data:daily.days.map(day=>day[series.key])}));
 chart=new Chart($('canvas'),{type:'bar',data:{labels:days,datasets:sets},options:{maintainAspectRatio:false,scales:{y:{beginAtZero:true,title:{display:true,text:'Lot 수'},ticks:{precision:0}}},onClick:(e,h)=>{if(h.length){selected={day:days[h[0].index],type:sets[h[0].datasetIndex].label};show()}}}});
 pickChart(chart,keys=>{
  if(!keys.length){selected=null;show();return}
  const dates=[...new Set(keys.map(([i])=>days[i]))].sort();
  const found=[...new Set(dates.flatMap(day=>remaining(rows,day)))];
  $('#detailTitle').textContent=dates.join(', ')+' · 당일 마감 미해제 Lot';
  detail($('#detail'),found,dates.at(-1));
 });
}
function update(events){
 all=episodes(events);const sel=$('#customers'),last=sel.value;sel.replaceChildren(new Option('전체 고객',''));for(const c of [...new Set(all.map(r=>r.customer))].sort())sel.add(new Option(c,c));sel.value=last;render();$('#status').textContent=all.length+'건의 Hold 이력';
}
let events=new Map();const eventKey=r=>JSON.stringify([r.customer,r.lot,r.start,r.kind]);
const cacheKey='snapshot:qaMesHoldEvents';
function cacheEvents(){return QAReportCache.write(cacheKey,[...events.values()]).catch(()=>{})}
const cacheReady=QAReportCache.read(cacheKey).then(saved=>{
 if(!Array.isArray(saved))return;
 for(const r of saved)events.set(eventKey(r),r);
 update([...events.values()]);
}).catch(()=>{});
async function refresh(){await cacheReady;const list=await history(collection);for(const r of list)events.set(eventKey(r),r);update([...events.values()]);await cacheEvents()} 
$('#customers').onchange=()=>{selected=null;render()};$('#reload').onclick=()=>refresh().catch(e=>$('#status').textContent=e.message);
let pending;QAAutoMail.start('meshold',()=>true,async f=>{const r=JSON.parse((await f.text()).replace(/^\uFEFF/,''));if(!r.lot||!r.customer||!/^\d{14}$/.test(r.start)||!['release','hold'].includes(r.kind))throw Error('메일 형식 확인 필요');await cacheReady;await publish(collection,eventKey(r),r);events.set(eventKey(r),r);clearTimeout(pending);pending=setTimeout(()=>{update([...events.values()]);cacheEvents()},400)},{label:'Hold / Release 메일 가져오기'});
refresh().catch(e=>$('#status').textContent=e.message);
