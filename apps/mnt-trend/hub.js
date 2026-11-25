const $=s=>document.querySelector(s);
window.mntWorkers=new Map();
const frames={},tabs=['Lot 통합 조회','Weekly Trend','VM Yield','CPK Trend','PO History'];
let active=0,busy=false;
function selectTab(index){
 active=index;[...$('nav').children].forEach((b,i)=>b.setAttribute('aria-current',i===index));
 $('form').hidden=index!==0;$('#extra').hidden=index!==0;
 for(const [k,f] of Object.entries(frames))f.hidden=k!==(index<3?'yield':index===3?'cpk':'po');
 const doc=frames.yield?.contentDocument;
 doc?.getElementById(['lotTab','weeklyTab','vmTab'][index])?.click();
}
tabs.forEach((t,i)=>{const b=document.createElement('button');b.textContent=t;b.onclick=()=>selectTab(i);$('nav').append(b)});
for(const [key,path] of Object.entries({yield:'mnt-yield-trend',cpk:'mnt-cpk-trend',po:'mnt-po-history'})){
 const f=document.createElement('iframe');frames[key]=f;f.title=path;f.src='../'+path+'/?mntHub=1';
 f.onload=()=>{const d=f.contentDocument;const style=d.createElement('style');style.textContent='a[href*="customer-quality-trend"],main h1,#lotTab,#weeklyTab,#vmTab,#lotPanel #lot,#lotPanel #find{display:none!important}';d.head.append(style);selectTab(active)};
 $('#frames').append(f);
}
selectTab(0);
async function collect(){
 if(busy)return;busy=true;$('#check').disabled=true;const results=[];
 try{for(const key of ['mntyield','mntvm','mnt','mntpo','mclist']){
 const task=mntWorkers.get(key);if(!task?.ready()){results.push(key+' 준비 중');continue}
 $('#status').textContent=key+' 확인 중';await task.worker.tick();results.push(key+' '+task.worker.getStatus())
 }}finally{$('#status').textContent=results.join(' · ');busy=false;$('#check').disabled=false}
}
$('#check').onclick=collect;setTimeout(collect,4000);setInterval(collect,60000);
$('form').onsubmit=e=>{e.preventDefault();const q=$('form input').value.trim().toUpperCase();if(!q)return;
 const d=frames.yield.contentDocument;if(d.getElementById('lot')){d.getElementById('lot').value=q;d.getElementById('find').click()}
 const box=$('#extra');box.replaceChildren();for(const [key,title,headers] of [['po','PO',['Date','Device','Lot','Wafer Lot','WO','Qty']],['cpk','CPK',['Device','Item','CPK','PPK']]]){
 const h=document.createElement('h3');h.textContent=title;box.append(h);const rows=frames[key].contentWindow.mntFindLot?.(q);
 if(!rows?.length){box.append(document.createTextNode(rows?'일치하는 Lot 기록 없음':'보고서 불러오는 중'));continue}
 const table=document.createElement('table');for(const row of [headers,...rows]){const tr=table.insertRow();for(const value of row)tr.insertCell().textContent=value??'—'}box.append(table)
 }};
