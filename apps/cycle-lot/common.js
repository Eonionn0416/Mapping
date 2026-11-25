import {load} from './data.js';
const tabs=document.querySelector('#trendTabs'),link=document.createElement('a');
link.textContent='SAN2';link.href='../cycle-lot/?san2';link.style.cssText='padding:12px;align-self:center';function add(){if(!tabs.contains(link))tabs.append(link)}new MutationObserver(add).observe(tabs,{childList:true});add();
const box=document.createElement('section');box.className='card';box.hidden=true;document.querySelector('#searchSheet').append(box);
let version=0;
document.querySelector('#resetSearch').addEventListener('click',()=>{version++;box.hidden=true});
document.querySelector('#lotSearch').addEventListener('click',async()=>{
 const id=++version,q=document.querySelector('#query').value.trim().toUpperCase();box.hidden=true;if(!q)return;
 const customer=document.querySelector('#customer').value.trim().toUpperCase();if(customer&&!['SAN','SAN2','ALL','전체 고객'].includes(customer))return;
 try{const rows=(await load(true)).filter(r=>[r.lot,r.wafer].some(v=>v.toUpperCase()===q));if(id!==version||!rows.length)return;
 box.hidden=false;box.innerHTML='<h3>SAN2 · ASSY/TEST 시작일 기준</h3><div class="wrap"><table></table></div>';
 const t=box.querySelector('table');for(const values of [['Lot','Device','공정 (SAN2)','ASSY/TEST 시작일','Window (days)'],...rows.map(r=>[r.lot,r.device,r.process.replaceAll('/','')+'2',r.start,r.ct])]){const tr=t.insertRow();for(const v of values)tr.insertCell().textContent=v}
 }catch(e){if(id===version){box.hidden=false;box.textContent='SAN2 조회 실패 · '+e.message}}
});
