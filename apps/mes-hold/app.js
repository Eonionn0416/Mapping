import {publish,history} from '../../shared/report-history.js';
import {episodes,summary,remaining,age,dateOf} from './core.js';
const $=s=>document.querySelector(s),collection='qaMesHoldEvents',today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
let all=[],chart,selected=null;
function table(host,headers,rows,styles=[]){
 const t=document.createElement('table'),h=t.createTHead().insertRow();
 for(const label of headers){const th=document.createElement('th');th.textContent=label;h.append(th)}
 const b=t.createTBody();rows.forEach((values,i)=>{const tr=b.insertRow();tr.className=styles[i]||'';for(const v of values)tr.insertCell().textContent=typeof v==='number'?v.toLocaleString():v||'—'});
 host.replaceChildren(t);if(!rows.length)host.append('해당 Lot 없음');
}
function detail(host,rows,date){
 table(host,['Customer','Lot','Device','공정','Hold date','경과일','Unit Qty','Hold 사유'],rows.map(r=>[r.customer,r.lot,r.device,r.operation,dateOf(r.start),age(r,date),r.qty,r.reason||r.code]),rows.map(r=>age(r,date)>30?'aged':''));
}
function render(){
 const customer=$('#customers').value,rows=all.filter(r=>!customer||customer===r.customer),now=today();
 table($('#summary'),['Hold date','Customer','Hold Lot','Hold Unit','Release Lot','Release Unit','미해제 Lot','미해제 Unit'],summary(rows));
 const active=remaining(rows,now);detail($('#aged'),active.filter(r=>age(r,now)>30),now);
 function show(){const d=selected?.day||now;$('#detailTitle').textContent=selected?d+' '+selected.type+' · 당일 마감 미해제 Lot':'현재 미해제 Lot';detail($('#detail'),remaining(rows,d),d)}
 show();chart?.destroy();
 const days=[...new Set(rows.flatMap(r=>[dateOf(r.start),...(r.end?[dateOf(r.end)]:[])]))].sort();
 const sets=['Hold','Release'].map((label,i)=>{const events=new Map();for(const r of rows){const stamp=i?r.end:r.start;if(!stamp)continue;const day=dateOf(stamp);if(!events.has(day))events.set(day,new Set());events.get(day).add(JSON.stringify([r.customer,r.lot]))}return {label,backgroundColor:i?'#0eaaa7':'#1677bf',data:days.map(d=>events.get(d)?.size||0)}});
 chart=new Chart($('canvas'),{type:'bar',data:{labels:days,datasets:sets},options:{maintainAspectRatio:false,scales:{y:{beginAtZero:true,title:{display:true,text:'Lot 수'},ticks:{precision:0}}},onClick:(e,h)=>{if(h.length){selected={day:days[h[0].index],type:sets[h[0].datasetIndex].label};show()}}}});
}
function update(events){
 all=episodes(events);const sel=$('#customers'),last=sel.value;sel.replaceChildren(new Option('전체 고객',''));for(const c of [...new Set(all.map(r=>r.customer))].sort())sel.add(new Option(c,c));sel.value=last;render();$('#status').textContent=all.length+'건의 Hold 이력';
}
let events=new Map();const eventKey=r=>JSON.stringify([r.customer,r.lot,r.start,r.kind]);
async function refresh(){const list=await history(collection);for(const r of list)events.set(eventKey(r),r);update([...events.values()])}
$('#customers').onchange=()=>{selected=null;render()};$('#reset').onclick=()=>{selected=null;render()};$('#reload').onclick=()=>refresh().catch(e=>$('#status').textContent=e.message);
let pending;QAAutoMail.start('meshold',()=>true,async f=>{const r=JSON.parse((await f.text()).replace(/^\uFEFF/,''));if(!r.lot||!r.customer||!/^\d{14}$/.test(r.start)||!['release','hold'].includes(r.kind))throw Error('메일 형식 확인 필요');await publish(collection,eventKey(r),r);events.set(eventKey(r),r);clearTimeout(pending);pending=setTimeout(()=>update([...events.values()]),400)},{label:'Hold / Release 메일 가져오기'});
refresh().catch(e=>$('#status').textContent=e.message);
