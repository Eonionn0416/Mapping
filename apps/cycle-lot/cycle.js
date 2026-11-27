import {pickChart,pickTable} from '../../shared/trend-selection.js';
import {ingest,load} from './data.js';
const $=s=>document.querySelector(s),san=new URLSearchParams(location.search).has('san2');
let records=[],customer='All',plots=[];
$('h1').textContent=san?'SAN2 · 공정별 Window time':'Cycle Time Lot Trend Chart';
const colors=['#128ed0','#00aabb','#725cb6','#e08c36','#518868','#c25b8d'];
function details(host,rows){
 host.replaceChildren();const table=document.createElement('table');host.append(table);
 for(const values of [['고객','Lot','Device',san?'ASSY/TEST 시작일':'공정 In time','Qty','CT (days)'],...rows.map(r=>[r.customer,r.lot,r.device,r.start,r.qty,r.ct])]){
 const tr=table.insertRow();for(const v of values){const cell=document.createElement(tr.rowIndex?'td':'th');cell.textContent=v;tr.append(cell)}
 }
 pickTable(table);
}
const operationOrder = 'D/B AIN W/I LMN B/G L/G D/S 2ND SAU C/A DFX PB2 PSU U/F UFC 3RD A/M PS3 M/D PMC LMK PCL SBM SGN ICO EVI S31'.split(' ');
const operationCodes = 'S01 N11 2 14 3 8 10 20 438 441 451 67 94 95 96 60 66 87 100 105 203 495 500 510 512 290 S31'.split(' ');
function processRank(process) {
 const key = String(process).trim().toUpperCase().split(/\s+/)[0].replace(/^0+(?=\d)/,'');
 const rank = Math.max(operationOrder.indexOf(key), operationCodes.indexOf(key));
 return rank < 0 ? Infinity : rank;
}
function offsetDay(day, offset) {
 const date = new Date(day + 'T12:00:00Z');
 date.setUTCDate(date.getUTCDate() + offset);
 return date.toISOString().slice(0,10);
}
function render(){
 for(const plot of plots)plot.destroy();plots=[];$('#cards').replaceChildren();
 const groups=new Map(),q=$('#query').value.trim().toUpperCase();
 for(const r of records){if(customer!=='All'&&r.customer!==customer||r.date<$('#from').value||r.date>$('#to').value||![r.lot,r.device,r.wafer].some(x=>x.toUpperCase().includes(q)))continue;
 if(!groups.has(r.process))groups.set(r.process,[]);groups.get(r.process).push(r)}
 for(const [process,rows] of [...groups].sort(([a],[b]) => processRank(a)-processRank(b) || a.localeCompare(b))){
 const card=document.createElement('section');card.className='cycle-card';card.innerHTML='<h2></h2><div class="cycle-row"><div class="cycle-plot"><canvas></canvas></div><div class="cycle-scroll"></div></div>';card.querySelector('h2').textContent=process;$('#cards').append(card);
 const host=card.querySelector('.cycle-scroll'),dates=Array.from({length:10}, (_,i)=>offsetDay($('#from').value,i)),devices=[...new Set(rows.map(r=>r.device))].sort();
 details(host,rows);
 const byDay=new Map(dates.map(day=>[day,[]]));for(const r of rows){if(!byDay.has(r.date))byDay.set(r.date,[]);byDay.get(r.date).push(r)}
 if(san){
 const points=rows.map(r=>({x:Date.parse(r.date+'T00:00:00Z'),y:r.ct,row:r}));
 const formatDay=t=>new Date(t).toISOString().slice(0,10);
 plots.push(new Chart(card.querySelector('canvas'),{type:'scatter',data:{datasets:[{label:'Window time (days)',data:points,backgroundColor:colors[0]}]},options:{maintainAspectRatio:false,scales:{x:{type:'linear',title:{display:true,text:'ASSY/TEST 시작일'},ticks:{maxTicksLimit:5,callback:formatDay}},y:{beginAtZero:true,title:{display:true,text:'Window time (days)'}}},plugins:{tooltip:{callbacks:{label:c=>c.raw.row.lot+' · '+c.raw.y+' days'}}},onClick:(e,h)=>{if(!h.length)return;const point=points[h[0].index];details(host,points.filter(p=>p.x===point.x&&p.y===point.y).map(p=>p.row))}}}));
 continue;
 }
 const datasets=devices.map((device,i)=>({label:device,backgroundColor:colors[i%colors.length],data:dates.map(d=>byDay.get(d).filter(r=>r.device===device).reduce((s,r)=>s+Number(r.qty),0)),yAxisID:'y',stack:'Qty'}));
 datasets.push({type:'line',label:'평균 CT (days)',yAxisID:'ct',borderColor:'#15626c',backgroundColor:'#15626c',data:dates.map(d=>byDay.get(d).length ? byDay.get(d).reduce((s,r)=>s+r.ct,0)/byDay.get(d).length : null)});
 plots.push(new Chart(card.querySelector('canvas'),{type:'bar',data:{labels:dates,datasets},options:{maintainAspectRatio:false,scales:{x:{stacked:true,title:{display:true,text:san?'ASSY/TEST 시작일':'공정 투입일'}},y:{max:Math.max(...dates.map(d=>byDay.get(d).reduce((sum,r)=>sum+Number(r.qty),0))) || 1,display:!san,stacked:true,beginAtZero:true,title:{display:true,text:'Qty'}},ct:{max:Math.max(...datasets[datasets.length-1].data) || 1,position:'right',beginAtZero:true,title:{display:true,text:'CT (days)'},grid:{drawOnChartArea:false}}},onClick:(e,hits)=>{if(!hits.length)return;const h=hits[0],subset=byDay.get(dates[h.index]);details(host,h.datasetIndex===datasets.length-1?subset:subset.filter(r=>r.device===devices[h.datasetIndex]))}}}));
 const chart=plots.at(-1);chart.options.plugins.legend.display=false;pickChart(chart,keys=>details(host,keys.length?rows.filter(r=>keys.some(([i,j])=>r.date===dates[i]&&(j===devices.length||r.device===devices[j]))):rows));
 }
 if(!groups.size)$('#cards').textContent='해당 기간에 일치하는 공정 기록이 없습니다.';
}
async function refresh(){records=await load(san);const nav=$('nav');nav.replaceChildren();for(const c of ['All',...new Set(records.map(r=>r.customer))]){const b=document.createElement('button');b.textContent=c;b.setAttribute('aria-current',c===customer);b.onclick=()=>{customer=c;for(const t of nav.children)t.setAttribute('aria-current',t===b);render()};nav.append(b)}render();$('#state').textContent=records.length+'개 공정 기록'}
function fail(e){$('#state').textContent=e.message}
const now=new Date(),before=new Date(now);before.setDate(now.getDate()-(san?30:9));const iso=d=>d.toLocaleDateString('sv-SE');$('#to').value=iso(now);$('#from').value=iso(before);
if (!san) {
 for (const [field, other, step] of [['#from','#to',9],['#to','#from',-9]]) {
  $(field).required=true;
  $(field).addEventListener('change',()=>{if ($(field).value) $(other).value=offsetDay($(field).value,step)});
 }
}
$('form').onsubmit=e=>{e.preventDefault();render()};$('#refresh').onclick=()=>refresh().catch(fail);$('input[type=file]').onchange=async e=>{try{for(const f of e.target.files)await ingest(f);await refresh()}catch(err){fail(err)}};
QAAutoMail.start('sanct',()=>true,async(f,item)=>{await ingest(f,item);await refresh()},{label:'Cycle time 자동 가져오기'});refresh().catch(fail);
