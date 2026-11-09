const norm=v=>String(v??'').trim().toUpperCase().replace(/\s+/g,'');
const valid=v=>v&&!['-','NA','N/A','NONE'].includes(v);
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const pct=(a,b)=>a!==null&&b>0?a/b*100:null;
export function selectLot(data,query){
 const q=norm(query);if(!valid(q))return {assy:[],os:[],bin:[]};
 // Match the requested lot directly. Shared MO/batch IDs must never expand the result to sibling lots.
 const match=(r,fields)=>fields.some(k=>norm(r[k])===q);
 return {assy:data.assy.filter(r=>match(r,['sckInputLotNo','ftLotNo'])),os:data.os.filter(r=>match(r,['lotId'])),bin:data.bin.filter(r=>match(r,['lotId','custRunId']))};
}
export function pareto(rows){
 const totals=new Map();let input=0;
 for(const r of rows){const n=number(r.inQty);if(!(n>0))continue;input+=n;for(let i=1;i<=5;i++){const name=String(r['top'+i]||'').trim(),qty=number(r['qty'+i]);if(name&&qty>0)totals.set(name,(totals.get(name)||0)+qty);}}
 const all=[...totals].sort((a,b)=>b[1]-a[1]),total=all.reduce((n,r)=>n+r[1],0);let cumulative=0;
 return all.slice(0,5).map(([name,qty])=>({name,qty,ppm:qty/input*1e6,cumulative:(cumulative+=qty)/total*100}));
}
export function paretoConfig(rows){return {data:{labels:rows.map(r=>r.name),datasets:[{type:'bar',label:'DPPM',data:rows.map(r=>r.ppm),yAxisID:'ppm',backgroundColor:'#1397e5'},{type:'line',label:'누적 % (보고된 Defect 기준)',data:rows.map(r=>r.cumulative),yAxisID:'percent',borderColor:'#13b8ca',backgroundColor:'#13b8ca',tension:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{ppm:{beginAtZero:true,position:'left',title:{display:true,text:'DPPM'}},percent:{beginAtZero:true,max:100,position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'누적 %'}}}}};}
export function lotMetrics(data){
 const assy=data.assy.map(r=>({date:r.sod,lot:r.sckInputLotNo,input:number(r.inQty),output:number(r.outQty)??number(r.shipQtyK),yield:number(r.assyYield)}));
 const os=data.os.map(r=>({date:r.inputDate||r.inputTime,lot:r.lotId,yield:pct(number(r.testQty)!==null&&number(r.totalOsRej)!==null?r.testQty-r.totalOsRej:null,number(r.testQty)),open:pct(number(r.openQty),number(r.testQty)),short:pct(number(r.shortQty),number(r.testQty))}));
 const bin=data.bin.map(r=>{const fail=['bin2','bin3','bin4','bin5','bin6','bin36'].map(k=>number(r[k]));return {date:r.ftInDate||r.reportDate||r.reportMonth,lot:r.lotId,input:number(r.inQty),yield:pct(number(r.outQty),number(r.inQty)),ft:pct(fail.every(v=>v!==null)?fail.reduce((a,b)=>a+b,0):null,number(r.inQty)),bin4:pct(number(r.bin4),number(r.inQty))};});
 return {assy,os,bin};
}
export function mountLotOverview({getData,defectRows,defectConfig,styleChart,escapeHtml}){
 const input=document.getElementById('mtkLotQuery'),host=document.getElementById('mtkLotCards'),message=document.getElementById('mtkLotMessage');let query='',charts=[];
 const fmt=v=>v===null||v===undefined||v===''?'—':typeof v==='number'?v.toLocaleString(undefined,{maximumFractionDigits:4}):String(v);
 function card(title,rows,cols,series){const section=document.createElement('article');section.className='chart-card';host.append(section);const sorted=[...rows].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
 section.innerHTML='<h3>'+escapeHtml(title)+'</h3>'+(rows.length?'<div style="height:280px;position:relative"><canvas></canvas></div><div style="overflow:auto;max-height:280px;margin-top:16px"><table><thead><tr>'+cols.map(c=>'<th>'+escapeHtml(c[1])+'</th>').join('')+'</tr></thead><tbody>'+[...sorted].reverse().map(r=>'<tr>'+cols.map(c=>'<td>'+escapeHtml(fmt(r[c[0]]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p>일치하는 Lot 기록이 없습니다.</p>');
 if(!rows.length)return;const config={data:{labels:sorted.map(r=>String(r.date||'')+' · '+(r.lot||'')),datasets:series.map(([key,label,qty],i)=>({type:qty?'bar':'line',label,data:sorted.map(r=>r[key]),yAxisID:qty?'qtyAxis':'rateAxis',borderColor:['#1397e5','#13b8ca','#8a18c5','#d72baf'][i],backgroundColor:['#1397e5','#13b8ca','#8a18c5','#d72baf'][i],spanGaps:false,tension:0}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{qtyAxis:{display:series.some(s=>s[2]),position:'left',beginAtZero:true,title:{display:true,text:'Qty'}},rateAxis:{position:'right',beginAtZero:true,title:{display:true,text:'%'},grid:{drawOnChartArea:false}}}}};charts.push(new Chart(section.querySelector('canvas'),styleChart(config)));}
 function render(){charts.forEach(c=>c.destroy());charts=[];host.innerHTML='';if(!query){message.textContent='Lot No를 입력하고 조회하세요.';return;}const selected=selectLot(getData(),query),m=lotMetrics(selected);message.textContent=query+' · 검색 Lot 일치 기록 · Assy '+m.assy.length+' / OS '+m.os.length+' / FT '+m.bin.length;
 card('Assy · In / Out / Yield',m.assy,[['date','SOD'],['lot','Lot'],['input','In Qty'],['output','Out Qty'],['yield','Yield %']],[['input','In Qty',true],['output','Out Qty',true],['yield','Yield %',false]]);
 const d=pareto(selected.assy),box=document.createElement('article');box.className='chart-card';box.innerHTML='<h3>Defect · Top 5 Pareto / DPPM</h3>'+(d.length?'<div style="height:280px;position:relative"><canvas></canvas></div>':'<p>일치하는 Defect 기록이 없습니다.</p>');host.append(box);if(d.length)charts.push(new Chart(box.querySelector('canvas'),styleChart(paretoConfig(d))));
 card('Assy OS · 검색 Lot',m.os,[['date','Date'],['lot','Lot'],['yield','Yield %'],['open','Open %'],['short','Short %']],[['yield','Yield %',false],['open','Open %',false],['short','Short %',false]]);
 card('FT BIN · FT rate / BIN4 rate',m.bin,[['date','Date'],['lot','Lot'],['input','In Qty'],['yield','Yield %'],['ft','FT rate %'],['bin4','BIN4 rate %']],[['input','In Qty',true],['yield','Yield %',false],['ft','FT rate %',false],['bin4','BIN4 rate %',false]]);
 }
 window.addEventListener('mtk-trend-tab',e=>{if(e.detail==='lot')requestAnimationFrame(()=>charts.forEach(c=>{c.resize();c.update('none');}));});
 document.getElementById('mtkLotSearch').onclick=()=>{query=input.value.trim();render();};input.addEventListener('keydown',e=>{if(e.key==='Enter'){query=input.value.trim();render();}});render();return render;
}
