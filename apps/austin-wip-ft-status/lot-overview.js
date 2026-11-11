const AustinLotOverview=(()=>{
 const norm=x=>String(x??'').trim().toUpperCase().replace(/\s+/g,''),ids=r=>[r.lot,r.mark,r.assyLot].map(norm).filter(x=>x&&!['-','N/A','NA','NONE'].includes(x));
 function deviceMatch(value,query){const v=norm(value),q=norm(query).split('-')[0];return !!q&&(v===q||v.startsWith(q+'-'));}
 function link(snaps,query,to,device=''){const aliases=new Set([norm(query)]),rows=snaps.filter(s=>s.date<=to).flatMap(s=>s.rows).filter(r=>!device||r.device===device);let changed=true;while(changed){changed=false;for(const r of rows)if(ids(r).some(id=>aliases.has(id)))for(const id of ids(r))if(!aliases.has(id)){aliases.add(id);changed=true;}}return {aliases,match:r=>(!device||r.device===device)&&ids(r).some(id=>aliases.has(id))};}
 return {link,deviceMatch};
})();
let lotOverviewQuery='',overviewDeviceQuery='';
function renderLotOverview(){
 columns=['공정','Device','Lot','구분','일자','Qty','단위'];shown=[];const to=$('to').value,from=$('from').value;
 $('note').textContent='Lot · Marking/Run · Assy Lot 전체 번호로 연결합니다. 입고/불출은 보고서 관측 기준이며 Plan Out date는 실제 이탈일이 아닙니다.';
 if(!lotOverviewQuery&&!overviewDeviceQuery){metric([]);$('content').innerHTML='<section class="panel empty">Lot 또는 Device를 입력하고 조회하세요.</section>';return;}
 const linked=AustinLotOverview.link(snapshots,lotOverviewQuery,to,overviewDeviceQuery?'':$('device').value),match=overviewDeviceQuery?r=>AustinLotOverview.deviceMatch(r.device,overviewDeviceQuery)&&(!lotOverviewQuery||linked.match(r)):linked.match,within=d=>d&&d>=from&&d<=to,parts=[];let found=0;
 function panel(name,body){parts.push(`<section class="panel lot-overview-card"><h2>${esc(name)}</h2>${body||'<p class="empty">연결된 기록이 없습니다.</p>'}</section>`);}
 const chip=C.latest(snapshots,'chip',to),chipRows=(chip?.rows||[]).filter(match);found+=chipRows.length;
 const bins=new Map();for(const r of chipRows)bins.set('Bin '+r.bin,(bins.get('Bin '+r.bin)||0)+r.qty);const pareto=[...bins].sort((a,b)=>b[1]-a[1]),total=pareto.reduce((n,x)=>n+x[1],0);let sum=0;
 panel('Chip Bank · Defect Pareto',chipRows.length?`<p>재고 보고일 ${esc(chip.date)}</p>${chart(pareto.map(x=>x[0]),[{name:'Defect Qty',values:pareto.map(x=>x[1])}],{line:pareto.map(x=>(sum+=x[1])/total*100),lineLabel:'누적',percent:true,fit:true,fitWidth:700})}${table(['Device','Lot','Marking','Bin','Qty'],chipRows.map(r=>[r.device,r.lot,r.mark,r.bin,r.qty]))}`:'');
 for(const section of ['bumpBank','bump','bumpYield','bank','assy','assyYield','test','ftYield']){
 const title={bumpBank:'Bump Bank',bump:'Bump WIP',bumpYield:'Bump Yield',bank:'Bank',assy:'Assy WIP',assyYield:'Assy Yield',test:'Test WIP',ftYield:'FT Yield'}[section];
 if(section==='bank'||section==='bumpBank'){
  const d=C.bank(snapshots,section,to),lots=d.lots.filter(match),keys=new Set(lots.map(r=>r.id)),events=d.events.filter(e=>keys.has(e.id)&&within(e.date));found+=lots.length;
  const rr=lots.flatMap(r=>[...(r.received&&within(r.received)?[[r.device,r.lot,'입고일 (원본)',r.received,null,null]]:[]),...(r.active?[[r.device,r.lot,'현재 재고',d.latest,r.wafer,r.die]]:[])]).concat(events.map(e=>[e.device,e.lot,e.kind,e.date,e.kind==='기초재고'?e.openingWafer:e.waferIn||-e.waferOut,e.kind==='기초재고'?e.openingDie:e.dieIn||-e.dieOut]));rr.sort((a,b)=>String(b[3]).localeCompare(String(a[3])));shown.push(...rr.map(r=>[title,r[0],r[1],r[2],r[3],r[4],'Wafer']));
  panel(title+' · Wafer 입고 / 불출 / 현재고',lots.length?`<p>기준 보고일 ${esc(d.latest)} · 현재 ${fmt(lots.reduce((n,r)=>n+r.wafer,0))} Wafer</p>${table(['Device','Lot','구분','일자','Wafer Qty (+입고 / −불출)','Die Qty'],rr)}`:'');continue;
 }
 if(['bump','assy','test'].includes(section)){
  const d=C.wip(snapshots,section,to),lots=d.lots.filter(match),keys=new Set(lots.map(r=>r.id)),events=d.events.filter(e=>keys.has(e.id)&&within(e.date));found+=lots.length;
  const rr=lots.flatMap(r=>[...(within(r.inDate||r.firstSeen)?[[r.device,r.lot,r.mark,r.inDate?'투입':'최초 관측 (투입일 미확인)',r.inDate||r.firstSeen,r.input]]:[]),...(r.active?[[r.device,r.lot,r.mark,'현재 WIP',d.latest,r.qty]]:[])]).concat(events.map(e=>{const r=lots.find(r=>r.id===e.id);return [r.device,r.lot,r.mark,e.kind,e.date,e.qty];})).sort((a,b)=>String(b[4]).localeCompare(String(a[4])));shown.push(...rr.map(r=>[title,r[0],r[1],r[3],r[4],r[5],'Unit']));
  panel(title+' · 투입 / 이탈 / 현재고',lots.length?`<p>기준 보고일 ${esc(d.latest)} · 현재 ${fmt(lots.reduce((n,r)=>n+r.qty,0))} Unit</p>${table(['Device','Lot','Run/Marking','구분','일자','Qty'],rr)}<details><summary>현재 공정 / 계획 출고일</summary>${table(['Device','Lot','Run','현재 공정 / Qty','Plan Out date'],lots.map(r=>[r.device,r.lot,r.mark,Object.entries(r.process||{}).filter(([,q])=>q>0).map(([p,q])=>p+': '+q).join(', '),r.outDate]))}</details>`:'');continue;
 }
 const rr=C.yieldRows(snapshots,section,to).filter(match).filter(r=>within(r.date));found+=rr.length;let body='';
 for(const device of [...new Set(rr.map(r=>r.device))]){const source=rr.filter(r=>r.device===device),daily=C.aggregate(source,section,'daily'),input=source.reduce((n,r)=>n+r.input,0),weighted=daily.reduce((n,r)=>n+r.weightedYield,0),defects=new Map();for(const r of source)for(const [name,q]of Object.entries(r.defects||{}))defects.set(name,(defects.get(name)||0)+q);const top=[...defects].filter(([,q])=>q>0).sort((a,b)=>b[1]-a[1]).slice(0,5),totalDefect=[...defects.values()].reduce((n,q)=>n+q,0);let running=0;
 body+=`<h3>${esc(device)} · Yield ${input?fmt(weighted/input*100)+'%':'—'}</h3>${chart(daily.map(r=>r.label),[{name:'In Qty',values:daily.map(r=>r.input)}],{line:daily.map(r=>r.yield),lineLabel:'Yield',percent:true,fit:true,fitWidth:700})}`;
 if(section!=='ftYield')body+=`<h3>Top 5 Defect · DPPM</h3>${chart(top.map(x=>x[0]),[{name:'DPPM',values:top.map(x=>input?x[1]/input*1e6:null)}],{line:top.map(x=>totalDefect?(running+=x[1])/totalDefect*100:null),lineLabel:'누적',percent:true,fit:true,fitWidth:700})}`;
 body+=table(['일자','Lot','Run/Assy Lot','In Qty','Out Qty','Yield (%)'],source.map(r=>[r.date,r.lot,r.mark,r.input,r.output,r.input?(section==='bumpYield'?r.yieldValue:r.output/r.input)*100:null]));shown.push(...source.map(r=>[title,r.device,r.lot,'수율 투입',r.date,r.input,'Unit']));
 }
 panel(title,body);
 }
 panel('Top 7 Defect','<p>Top 7 원본은 BDR 전체 Device 주간 합계입니다. Lot / Device별 구분이 없어 개별 조회 결과로 표시하지 않습니다.</p>');
 metric([['검색 Lot',lotOverviewQuery||'—'],['검색 Device',overviewDeviceQuery||'—'],['연결 식별자',linked.aliases.size],['연결 기록',found]]);$('content').innerHTML='<div class="lot-overview-grid">'+parts.join('')+'</div>';
}
