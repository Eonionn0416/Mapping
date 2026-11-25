const style=document.createElement('style');
style.textContent='table tr[data-pick]{cursor:pointer}table tr[data-pick]:hover,table tr[data-pick].picked{outline:2px solid #193f60;outline-offset:-2px}table tr[data-pick].picked{background:#e5f1fc;font-weight:700}';
document.head.append(style);
function update(set,items,item,anchor,event){
 const multi=event.ctrlKey||event.metaKey,was=set.has(item);
 if(!multi)set.clear();
 if(event.shiftKey&&items.includes(anchor)){
  const a=items.indexOf(anchor),b=items.indexOf(item);
  items.slice(Math.min(a,b),Math.max(a,b)+1).forEach(x=>set.add(x));
 }else if(was)set.delete(item);else set.add(item);
}
export function pickTable(table){
 const rows=[...table.rows].filter(r=>r.querySelector('td')),selected=new Set();
 table.tabIndex=0;let anchor;
 function paint(){for(const r of rows){r.classList.toggle('picked',selected.has(r));r.setAttribute('aria-selected',selected.has(r))}}
 rows.forEach(r=>{r.dataset.pick='';r.onclick=e=>{update(selected,rows,r,anchor,e);if(!e.shiftKey)anchor=r;table.focus({preventScroll:true});paint()}});
 table.onkeydown=e=>{if(e.key==='Escape'){selected.clear();anchor=null}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){rows.forEach(r=>selected.add(r))}else return;e.preventDefault();e.stopPropagation();paint()};
}
export function pickChart(chart,show){
 const selected=new Set();let anchor;
 const order=chart.data.labels.flatMap((_,i)=>chart.data.datasets.map((d,j)=>d.data[i]!=null&&d.data[i]!==0?i+':'+j:null).filter(Boolean));
 const canvas=chart.canvas;canvas.tabIndex=0;
 for(const d of chart.data.datasets){d.hoverBorderWidth=3;d.hoverBorderColor='#163d5c'}
 const plugin={id:'selectedMarks',afterDatasetsDraw(c){const ctx=c.ctx;ctx.save();ctx.strokeStyle='#163d5c';ctx.lineWidth=3;
 for(const key of selected){const [i,j]=key.split(':').map(Number),p=c.getDatasetMeta(j).data[i];if(!p)continue;
 if(p.width!=null)ctx.strokeRect(p.x-p.width/2,Math.min(p.base,p.y),p.width,Math.abs(p.base-p.y));else{ctx.beginPath();ctx.arc(p.x,p.y,6,0,2*Math.PI);ctx.stroke()}}
 ctx.restore()}};
 chart.config._config.plugins ||= [];
 chart.config.plugins.push(plugin);
 function paint(){show([...selected].map(s=>s.split(':').map(Number)));chart.draw()}
 chart.options.onClick=(e,h)=>{if(!h.length)return;const key=h[0].index+':'+h[0].datasetIndex;update(selected,order,key,anchor,e.native||e);if(!e.native?.shiftKey)anchor=key;canvas.focus({preventScroll:true});paint()};
 canvas.onkeydown=e=>{if(e.key==='Escape'){selected.clear();anchor=null}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){order.forEach(k=>selected.add(k))}else return;e.preventDefault();e.stopPropagation();paint()};
 chart.update('none');
}
