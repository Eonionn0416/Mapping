import {pickChart,pickTable} from '../../shared/trend-selection.js';
import {publish,history} from '../../shared/report-history.js';
const $=s=>document.querySelector(s);
const qct=new URLSearchParams(location.search).get('report')==='qct';
const collection=qct?'qaQctLoss':'qaSanInventory';
let tab=qct?'qct':'sip',records=[],charts=[];
const names={sip:'SIP Inventory',pcb:'PCB Inventory',qct:'Device Trend',lot:'Lot Pareto'};
const elem=(tag,parent,value)=>{const el=document.createElement(tag);parent.append(el);if(value!=null)el.textContent=value;return el};
function table(parent,headers,rows){
 const wrap=elem('div',parent);wrap.className='scroll';const t=elem('table',wrap),head=elem('tr',elem('thead',t));
 headers.forEach(h=>elem('th',head,h));const body=elem('tbody',t);
 for(const row of rows){const tr=elem('tr',body);row.forEach(v=>elem('td',tr,v==null||v===''?'—':v))}
 pickTable(t);
}
const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
function parse(file,bytes){
 const kind=/^Sandisk Inventory Report/i.test(file.name)?'sip':/^SCK_SAN_PCB_INV_/i.test(file.name)?'pcb':/^QCT_Trigger_Limit_/i.test(file.name)?'qct':null;
 if(!kind||qct!==(kind==='qct'))throw Error('보고서 종류를 확인하세요.');
 const match=file.name.match(/(20\d{2})(\d{2})(\d{2})/);if(!match)throw Error('파일명에 보고일이 없습니다.');
 const wb=XLSX.read(bytes,{type:'array',cellDates:true,raw:true});
 const sheet=wb.Sheets[kind==='sip'?'Format for SIP':kind==='pcb'?'PCB':wb.SheetNames[0]];
 if(!sheet)throw Error('보고서 시트를 찾을 수 없습니다.');
 const data=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,blankrows:false});
 const first={sip:'TYPE',pcb:'Material No.',qct:'CUST ID'}[kind];
 const i=data.findIndex(r=>String(r[0]).trim()===first);if(i<0)throw Error('보고서 열을 찾을 수 없습니다.');
 const rows=data.slice(i+1).filter(r=>r[0]&&r[kind==='qct'?4:1]).map(r=>r.map(v=>v instanceof Date?iso(v):typeof v==='string'?v.trim():v));
 return {kind,date:match.slice(1).join('-'),rows,name:file.name};
}
async function ingest(file){
 const report=parse(file,await file.arrayBuffer());await publish(collection,report.kind+'-'+report.date,report);
 records=records.filter(r=>r.kind!==report.kind||r.date!==report.date).concat(report);render();
}
async function reload(){try{records=await history(collection);render();$('#status').textContent=records.length+'개 보고서'}catch(e){$('#status').textContent=e.message}}
const palette=['#1878b7','#16a5a5','#7970bd','#e59b43','#627d99','#b16b91','#53975c'];
function group(rows,key){const groups=new Map();for(const r of rows){const k=key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}return groups}
function card(title){const box=elem('section',$('#results'));box.className='panel';elem('h2',box,title);return box}
const quantityLabels={
 id:'inventoryQuantity',
 afterDatasetsDraw(chart){
  if(tab!=='sip')return;
  const ctx=chart.ctx;ctx.save();ctx.font='600 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  chart.data.datasets.forEach((ds,i)=>chart.getDatasetMeta(i).data.forEach((bar,j)=>{
   const label=Number(ds.data[j]).toLocaleString();
   if(!ds.data[j]||bar.width<ctx.measureText(label).width+4||Math.abs(bar.base-bar.y)<15)return;
   ctx.fillStyle='white';ctx.fillText(label,bar.x,(bar.base+bar.y)/2);
  }));ctx.restore();
 }
};
function plot(parent,labels,sets,choose,stack=true){
 const box=elem('div',parent);box.className='plot';const canvas=elem('canvas',box);
 charts.push(new Chart(canvas,{type:'bar',plugins:[quantityLabels],data:{labels,datasets:sets},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:true},onClick:(_,hits)=>{if(hits.length)choose(hits[0].index,hits[0].datasetIndex)},scales:{x:{stacked:stack},y:{stacked:stack,beginAtZero:true},...(sets.some(s=>s.yAxisID==='loss')?{loss:{position:'right',title:{display:true,text:tab==='lot'?'누적 (%)':'Yield Loss (%)'},grid:{drawOnChartArea:false}}}:{})}}}));
 pickChart(charts.at(-1),choose);
}
const sum=(rows,i)=>rows.reduce((a,r)=>a+(Number(r[i])||0),0);
function inventory(reports,query){
 const pcb=tab==='pcb', key=0,qty=pcb?6:6;
 const daily=reports.map(r=>({...r,rows:r.rows.filter(row=>!query||String(row[pcb?0:1]).toUpperCase().includes(query))}));
 const types=[...new Set(daily.flatMap(d=>d.rows.map(row=>row[key])))].sort();
 const box=card(pcb?'Material No · Available Qty':'Inventory Type · Unit Qty'),pair=elem('div',box);pair.className='pair';const left=elem('div',pair),right=elem('div',pair);
 function detail(index,type){if(index<0)return;const d=daily[index];elem('h3',right,d.date+' · '+(type||'전체'));table(right,pcb?['Material No','Description','Location','IQA Batch','Vendor Lot','Vendor','Available Qty','Blocked Qty','UoM','G/R','Mfg','Exp']:['Type','PN','Wafer Lot','WO/AI complete date','Aging days','Sandisk location','Unit Qty','SCK Oper','Detail DESC'],d.rows.filter(r=>!type||r[0]===type).map(r=>r.slice(0,pcb?12:9)))}
 plot(left,daily.map(d=>d.date),types.map((k,i)=>({label:k,backgroundColor:palette[i%palette.length],data:daily.map(d=>sum(d.rows.filter(r=>r[0]===k),qty))})),keys=>{right.replaceChildren();if(!keys.length)detail(daily.length-1);for(const [i,j] of keys)detail(i,types[j])});detail(daily.length-1);
 if(!pcb||!daily.length)return;
 const latest=daily.at(-1),limit=new Date(latest.date+'T12:00:00');const day=limit.getDate();limit.setDate(1);limit.setMonth(limit.getMonth()+6);const end=new Date(limit.getFullYear(),limit.getMonth()+1,0).getDate();limit.setDate(Math.min(day,end));
 const alert=[];for(const [material,rows] of group(latest.rows.filter(r=>Number(r[6])>0||Number(r[7])>0),r=>r[0])){
 const expiry=rows.map(r=>r[11]).filter(Boolean).sort().at(-1);if(expiry&&expiry<=iso(limit))alert.push([material,rows[0][1],[...new Set(rows.map(r=>r[3]))].join(', '),[...new Set(rows.map(r=>r[5]))].join(', '),sum(rows,6),sum(rows,7),expiry])}
 table(card('최종 만료일 6개월 이내 · '+latest.date),['Material No','Description','IQA Batch','Vendor','Available Qty','Blocked Qty','Latest expire date'],alert.sort((a,b)=>a[6].localeCompare(b[6])));
}
function defects(row){const out={};for(let i=10;i<row.length;i+=2)if(row[i])out[row[i]]=(out[row[i]]||0)+(Number(row[i+1])||0);return out}
function quality(reports,query){
 const unique=new Map();for(const report of reports)for(const r of report.rows)unique.set(JSON.stringify([r[0],r[3],r[4],r[8],r[9]]),r);
 const rows=[...unique.values()].filter(r=>tab==='lot'?String(r[4]).toUpperCase()===query:String(r[3]).toUpperCase().includes(query)).sort((a,b)=>String(a[8]).localeCompare(String(b[8])));
 if(!rows.length){elem('p',$('#results'),tab==='lot'&&!query?'Lot 번호를 입력하세요.':'조회 결과가 없습니다.');return}
 for(const [device,items] of group(rows,r=>r[3])){
 const pair=elem('div',card(device));pair.className='pair';const left=elem('div',pair),right=elem('div',pair);
 function detail(rs){right.replaceChildren();table(right,['Device','Lot','Schedule','Qty','Cum Yield Loss','Trans time','OPER','Defect / Qty'],rs.map(r=>[...r.slice(3,10),Object.entries(defects(r)).map(([k,v])=>k+' '+v).join(' / ')]))}
 if(tab==='lot'){const totals=new Map();for(const row of items)for(const [k,v] of Object.entries(defects(row)))totals.set(k,(totals.get(k)||0)+v);const sorted=[...totals].sort((a,b)=>b[1]-a[1]);let cum=0;const total=sorted.reduce((a,r)=>a+r[1],0);plot(left,sorted.map(r=>r[0]),[{label:'Defect Qty',data:sorted.map(r=>r[1]),backgroundColor:palette[0]},{type:'line',label:'누적 %',yAxisID:'loss',data:sorted.map(r=>total?100*(cum+=r[1])/total:null),borderColor:palette[1]}],keys=>detail(keys.length?items.filter(r=>keys.some(([i])=>sorted[i][0] in defects(r))):items),false)}
 else{const modes=[...new Set(items.flatMap(r=>Object.keys(defects(r))))];plot(left,items.map(r=>r[8]),[...modes.map((m,i)=>({label:m+' PPM',backgroundColor:palette[i%palette.length],data:items.map(r=>Number(r[6])>0?(defects(r)[m]||0)*1e6/Number(r[6]):null)})),{type:'line',label:'Cum Yield Loss %',yAxisID:'loss',borderColor:'#21566e',data:items.map(r=>parseFloat(r[7]))}],keys=>detail(keys.length?[...new Set(keys.map(([i])=>items[i]))]:items));if(items.some(r=>!(Number(r[6])>0)))elem('small',left,'Quantity가 없는 Lot은 PPM을 계산할 수 없습니다.')}
 detail(items);
 }}
function render(){charts.forEach(c=>c.destroy());charts=[];$('#results').replaceChildren();const query=$('#query').value.trim().toUpperCase();const reports=records.filter(r=>r.kind===(qct?'qct':tab)).sort((a,b)=>a.date.localeCompare(b.date));$('#searchLabel').textContent=tab==='lot'?'Lot':tab==='pcb'?'Material No':qct?'Device':'PN';qct?quality(reports,query):inventory(reports,query)}
$('h1').textContent=qct?'QCT Yield Loss':'Sandisk Inventory';for(const k of qct?['qct','lot']:['sip','pcb']){const b=elem('button',$('nav'),names[k]);b.setAttribute('aria-current',k===tab);b.onclick=()=>{tab=k;[...$('nav').children].forEach(x=>x.setAttribute('aria-current',x===b));$('#query').value='';render()}}
$('form').onsubmit=e=>{e.preventDefault();render()};$('#refresh').onclick=reload;$('#file').onchange=async e=>{try{for(const f of e.target.files)await ingest(f);$('#status').textContent='Firestore 저장 완료'}catch(err){$('#status').textContent=err.message}e.target.value=''};
await reload();QAAutoMail.startMany((qct?['qct']:['saninv','sanpcb']).map(group=>({group,label:group,ready:()=>true,importer:ingest})),{label:'보고서 자동 가져오기'});
