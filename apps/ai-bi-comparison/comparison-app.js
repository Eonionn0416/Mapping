'use strict';
const $=id=>document.getElementById(id);
let base=null,revisions=[],all=[],limit=250,generation=0;
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function invalidate(){generation++;all=[];$('results').hidden=true;}
function setFiles(kind,files){invalidate();if(kind==='base'){base=files[0]||null;$('baseName').textContent=base?.name||'선택한 파일 없음';}else{revisions=Array.from(files);$('revNames').textContent=revisions.map(f=>f.name).join(', ')||'선택한 파일 없음';}$('status').textContent='비교 실행을 눌러 주세요.';}
$('baseFile').addEventListener('change',e=>setFiles('base',e.target.files));
$('revFiles').addEventListener('change',e=>setFiles('rev',e.target.files));
$('whitespace').addEventListener('change',invalidate);
for(const [id,kind] of [['baseDrop','base'],['revDrop','rev']]){const el=$(id);el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drag');});el.addEventListener('dragleave',()=>el.classList.remove('drag'));el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drag');if(kind==='base'&&e.dataTransfer.files.length!==1){$('status').textContent='원본 파일은 하나만 놓아 주세요.';return;}setFiles(kind,e.dataTransfer.files);});}
async function read(file){
 if(!/\.(xlsx|xlsm|xls)$/i.test(file.name))throw new Error(`${file.name}: Excel 파일을 선택해 주세요.`);
 if(file.size>50*1024*1024)throw new Error(`${file.name}: 50MB 이하 파일을 사용해 주세요.`);
 const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellFormula:true});const book={};
 for(const name of wb.SheetNames){const sheet=wb.Sheets[name],rows=new Map();
  // Iterate actual cells, avoiding inflated worksheet ranges and merged blank cells.
  for(const [address,cell] of Object.entries(sheet)){if(address.startsWith('!')||!cell||(!cell.f&&cell.v==null))continue;
   const pos=XLSX.utils.decode_cell(address),v=cell.f?'='+cell.f:cell.t==='e'?cell.w||String(cell.v):String(cell.v??'');if(!v)continue;
   if(!rows.has(pos.r))rows.set(pos.r,{r:pos.r+1,cells:{}});rows.get(pos.r).cells[XLSX.utils.encode_col(pos.c)]=v;
  }
  book[name]=[...rows.values()].sort((a,b)=>a.r-b.r).map(row=>({...row,cells:Object.fromEntries(Object.entries(row.cells).sort((a,b)=>XLSX.utils.decode_col(a[0])-XLSX.utils.decode_col(b[0])))}));
 }return book;
}
$('compare').addEventListener('click',async()=>{
 if(!base||!revisions.length){$('status').textContent='원본 하나와 개정 파일을 선택해 주세요.';return;}
 if(typeof XLSX==='undefined'){$('status').textContent='Excel 읽기 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 새로고침해 주세요.';return;}
 const token=++generation,source=base,files=[...revisions],options={ignoreWhitespace:$('whitespace').checked};all=[];$('results').hidden=true;$('compare').disabled=true;$('status').textContent='파일을 읽고 비교하고 있습니다…';
 try{const original=await read(source),warnings=[];const results=[];
  for(const file of files){const revised=await read(file);await new Promise(resolve=>setTimeout(resolve,0));const result=AIBIComparison.compare(original,revised,options);results.push(...result.changes.map(c=>({...c,file:file.name,original:source.name})));warnings.push(...result.warnings.map(w=>`${file.name}: ${w}`));}
  if(token!==generation)return;all=results;limit=250;
  $('fileFilter').innerHTML='<option value="">전체</option>'+files.map(f=>`<option>${escapeHTML(f.name)}</option>`).join('');$('typeFilter').value='';$('search').value='';
  $('warnings').innerHTML=warnings.map(w=>`<p class="warning">${escapeHTML(w)}</p>`).join('');
  $('metrics').innerHTML=['전체','추가','변경','삭제','순서 변경'].map(t=>`<div class="metric">${t}<strong>${t==='전체'?all.length:all.filter(c=>c.type===t).length}</strong></div>`).join('');
  $('results').hidden=false;$('status').textContent=`${files.length}개 개정 파일 비교 완료. ${all.length}건의 차이를 찾았습니다. 전체 공정 추가·삭제는 각 1건으로 표시합니다.`;render();
 }catch(e){if(token===generation){all=[];$('status').textContent=`비교 실패: ${e.message}`;}}finally{$('compare').disabled=false;}
});
function valueHTML(value){const safe=escapeHTML(value||'—');return value.length>600?`<details><summary>${escapeHTML(value.slice(0,120))}… 전체 내용 보기</summary><pre>${safe}</pre></details>`:safe;}
function render(){const q=$('search').value.toLowerCase(),f=$('fileFilter').value,t=$('typeFilter').value;const filtered=all.filter(c=>(!f||c.file===f)&&(!t||c.type===t)&&(!q||Object.values(c).join(' ').toLowerCase().includes(q)));$('count').textContent=`${filtered.length}건 / 전체 ${all.length}건`;$('rows').innerHTML=filtered.slice(0,limit).map(c=>`<tr><td>${escapeHTML(c.file)}<br><small>${escapeHTML(c.sheet)}</small></td><td><span class="badge ${c.type==='추가'?'add':c.type==='삭제'?'delete':''}">${c.type}</span></td><td>${escapeHTML(c.process)}<br><small>${escapeHTML(c.item)}</small></td><td>${valueHTML(c.oldValue)}</td><td>${valueHTML(c.newValue)}</td><td>${escapeHTML(c.oldCell||'—')} → ${escapeHTML(c.newCell||'—')}</td></tr>`).join('')||'<tr><td colspan="6">표시할 차이가 없습니다.</td></tr>';$('more').hidden=filtered.length<=limit;}
for(const id of ['fileFilter','typeFilter','search'])$(id).addEventListener('input',()=>{limit=250;render();});$('more').addEventListener('click',()=>{limit+=250;render();});
$('reset').addEventListener('click',()=>{invalidate();base=null;revisions=[];$('baseFile').value='';$('revFiles').value='';$('baseName').textContent=$('revNames').textContent='선택한 파일 없음';$('status').textContent='원본과 개정 파일을 선택해 주세요.';});
$('export').addEventListener('click',()=>{
 const headers=['원본 파일','개정 파일','시트','구분','공정','항목','개정 전','개정 후','원본 셀','개정 셀'];
 const quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
 const csv='\ufeff'+[headers,...all.map(c=>[c.original,c.file,c.sheet,c.type,c.process,c.item,c.oldValue,c.newValue,c.oldCell,c.newCell])].map(r=>r.map(quote).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='AI_BI_Comparison.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
