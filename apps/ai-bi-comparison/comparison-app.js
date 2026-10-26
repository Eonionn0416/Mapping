'use strict';
const $=id=>document.getElementById(id);
let base=null,revisions=[],all=[],groups=[],summaryText='',limit=20,generation=0,reportMeta=null;
const snapshots=new WeakMap();
const readInfo=new WeakMap();
const APP_VERSION='54';
let diagnostics=[];
const selectionVersion={base:0,rev:0}, failedSelection={base:null,rev:null};
let pendingSelections=0;
function selectionReady(){return !pendingSelections&&!failedSelection.base&&!failedSelection.rev;}
function updateSelectionState(){$('compare').disabled=!selectionReady();}

function fileError(file,e){
 const message=`${file.name}: 브라우저가 파일 내용을 읽지 못했습니다 (${e.name||'Error'}). 파일의 내용을 읽는 단계에서 실패했습니다. ‘다시 읽기’로 새 파일 참조를 선택해 주세요. 서식·하이퍼링크 수정은 필요하지 않습니다. 계속 실패하면 오류 진단 TXT를 저장해 주세요.`;
 diagnostics.push({time:new Date().toISOString(),stage:'file-read',file:file.name,size:file.size,lastModified:file.lastModified,error:e.name,message:e.message,...readInfo.get(file)});
 return new Error(message);
}
function pickFresh(kind){
 const input=$(kind==='base'?'baseFile':'revFiles');
 // Reset only when opening a new chooser; active bytes are held separately.
 input.value='';input.click();
}
$('pickBase').onclick=()=>pickFresh('base');$('pickRev').onclick=()=>pickFresh('rev');
function readerBuffer(file){
 return new Promise((resolve,reject)=>{if(typeof FileReader==='undefined'){reject(new Error('FileReader unavailable'));return;}const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||new Error('FileReader failed'));reader.onabort=()=>reject(new DOMException('File read cancelled','AbortError'));reader.readAsArrayBuffer(file);});
}
function snapshot(file){
 if(file.savedBook)return Promise.resolve({buffer:new ArrayBuffer(0)});
 if(snapshots.has(file))return snapshots.get(file);
 const attempts=[];
 const pending=(async()=>{
  for(const [method,read] of [['arrayBuffer',()=>file.arrayBuffer()],['FileReader',()=>readerBuffer(file)]]){
   try{const buffer=await read();if(buffer==null||typeof buffer.byteLength!=='number'||buffer.byteLength!==file.size)throw Error('Incomplete file read');readInfo.set(file,{method,attempts,picker:'native-file-input-or-drop'});return {buffer};}
   catch(e){attempts.push({method,error:e.name,message:e.message});}
  }
  const last=attempts.at(-1),error=new Error(last.message);error.name=last.error;readInfo.set(file,{attempts});return {error};
 })();
 snapshots.set(file,pending);
 // Failed references must be retried; only successful bytes are retained.
 pending.then(result=>{if(result.error&&snapshots.get(file)===pending)snapshots.delete(file);});
 return pending;
}
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function invalidate(){generation++;all=[];groups=[];summaryText='';reportMeta=null;$('results').hidden=true;}
async function setFiles(kind,files){
 const selected=kind==='base'?Array.from(files).slice(0,1):Array.from(files);if(!selected.length)return;
 const ticket=++selectionVersion[kind];pendingSelections++;updateSelectionState();
 $('status').textContent=(kind==='base'?'원본':'개정')+' 파일을 메모리에 읽고 있습니다…';
 try{
  const stable=[];
  for(const file of selected){
   if(file.savedBook){stable.push(file);continue;}
   if(!/\.(xlsx|xlsm|xls)$/i.test(file.name)||file.size>50*1024*1024)throw Error('50MB 이하 Excel 파일을 선택하세요.');
   const data=await snapshot(file);if(data.error)throw fileError(file,data.error);
   // Detach from the OS file reference once bytes are successfully read.
   const clean=$('textOnly').checked;
   const buffer=clean?await AIBITextWorkbook.normalize(data.buffer,XLSX,JSZip):data.buffer;
   const memory=new File([buffer],file.name,{type:file.type,lastModified:file.lastModified});
   snapshots.set(memory,Promise.resolve({buffer}));readInfo.set(memory,{...readInfo.get(file),retainedInMemory:true,textOnly:clean});
   stable.push(memory);
  }
  if(ticket!==selectionVersion[kind])return;
  invalidate();failedSelection[kind]=null;
  if(kind==='base'){base=stable[0];$('baseName').textContent=base.name+' · 읽기 완료';}
  else{revisions=stable;$('revNames').textContent=revisions.map(f=>f.name).join(', ')+' · 읽기 완료';}
  $('status').textContent='파일 읽기 완료. 성공한 파일은 메모리에서 유지됩니다.';
  window.dispatchEvent(new CustomEvent('aibi-files-ready'));
 }catch(e){if(ticket!==selectionVersion[kind])return;failedSelection[kind]=selected;
  $('status').textContent=e.message+' 기존에 읽은 파일은 유지했습니다. 실패한 '+(kind==='base'?'원본':'개정')+'을 다시 선택해 주세요.';
 }finally{pendingSelections--;updateSelectionState();}
}
$('baseFile').addEventListener('change',e=>{const files=Array.from(e.target.files);return setFiles('base',files);});
$('revFiles').addEventListener('change',e=>{const files=Array.from(e.target.files);return setFiles('rev',files);});
$('retryRead').addEventListener('click',async()=>{
 const kind=failedSelection.base?'base':failedSelection.rev?'rev':!base?'base':!revisions.length?'rev':null;
 if(!kind){$('status').textContent='두 파일 모두 읽기 완료 상태입니다. 비교 실행을 누르세요. 파일이 변경되었다면 해당 파일을 새로 선택하세요.';return;}
 await pickFresh(kind);
});
$('whitespace').addEventListener('change',invalidate);
try{$('processTemplate').value=localStorage.getItem('ai-bi-process-template')||'';}catch(e){}
$('processTemplate').addEventListener('input',()=>{invalidate();try{localStorage.setItem('ai-bi-process-template',$('processTemplate').value.trim());}catch(e){}});
for(const [id,kind] of [['baseDrop','base'],['revDrop','rev']]){const el=$(id);el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drag');});el.addEventListener('dragleave',()=>el.classList.remove('drag'));el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drag');if(kind==='base'&&e.dataTransfer.files.length!==1){$('status').textContent='원본 파일은 하나만 놓아 주세요.';return;}setFiles(kind,e.dataTransfer.files);});}
async function read(file){
 if(file.savedBook)return file.savedBook;
 if(!/\.(xlsx|xlsm|xls)$/i.test(file.name))throw new Error(`${file.name}: Excel 파일을 선택해 주세요.`);
 if(file.size>50*1024*1024)throw new Error(`${file.name}: 50MB 이하 파일을 사용해 주세요.`);
 const data=await snapshot(file);if(data.error)throw fileError(file,data.error);
 const wb=XLSX.read(new Uint8Array(data.buffer),{type:'array',cellFormula:true});const book={};
 for(const name of wb.SheetNames){const sheet=wb.Sheets[name],rows=new Map();
  // Iterate actual cells, avoiding inflated worksheet ranges and merged blank cells.
  for(const [address,cell] of Object.entries(sheet)){if(address.startsWith('!')||!cell||(!cell.f&&cell.v==null))continue;
   const pos=XLSX.utils.decode_cell(address),v=cell.f?'='+cell.f:cell.t==='e'?cell.w||String(cell.v):String(cell.v??'');if(!v)continue;
   if(!rows.has(pos.r))rows.set(pos.r,{r:pos.r+1,cells:{}});rows.get(pos.r).cells[XLSX.utils.encode_col(pos.c)]=v;
  }
  book[name]=[...rows.values()].sort((a,b)=>a.r-b.r).map(row=>({...row,cells:Object.fromEntries(Object.entries(row.cells).sort((a,b)=>XLSX.utils.decode_col(a[0])-XLSX.utils.decode_col(b[0])))}));
   book[name].layout={merges:sheet['!merges']||[]};
 }return book;
}
$('compare').addEventListener('click',async()=>{
 if(!selectionReady()){$('status').textContent='실패한 파일을 다시 선택하거나 진행 중인 읽기가 끝날 때까지 기다려 주세요.';return;}
 if(!base||!revisions.length){$('status').textContent='원본 하나와 개정 파일을 선택해 주세요.';return;}
 if(typeof XLSX==='undefined'){$('status').textContent='Excel 읽기 파일을 불러오지 못했습니다. shared/vendor 폴더가 함께 설치되었는지 확인해 주세요.';return;}
 const token=++generation,source=base,files=[...revisions],options={ignoreWhitespace:$('whitespace').checked,processTemplate:$('processTemplate').value.trim()};all=[];groups=[];summaryText='';$('results').hidden=true;$('compare').disabled=true;$('status').textContent='파일을 읽고 비교하고 있습니다…';
 try{AIBIComparison.templatePattern(options.processTemplate);const original=await read(source),notices=[];const results=[],cards=[],completed=[],processSummary=[];let compared=0,blocked=0;
  for(const file of files){
   try{const revised=await read(file);await new Promise(resolve=>setTimeout(resolve,0));const result=AIBIComparison.compare(original,revised,options);
    notices.push(...result.warnings.map(w=>({message:`${file.name}: ${w}`,file:file.name,error:false,missingCp:w.includes('CP/BL No 누락')})));
    processSummary.push(...result.processSummary.map(p=>({...p,file:file.name})));compared++;completed.push(file.name);results.push(...result.changes.map(c=>({...c,file:file.name,original:source.name})));
    cards.push(...result.groups.map(g=>({...g,file:file.name,original:source.name,beforeLayout:original[g.sheet]?.layout,afterLayout:revised[g.afterSheet||g.sheet]?.layout})));
   }catch(e){blocked++;notices.push({message:`${file.name}: 비교 실패 — ${e.message}`,error:true});}
  }
  if(token!==generation)return;all=results;groups=cards;limit=20;reportMeta={original:source.name,completed,processSummary,processTemplate:options.processTemplate,failed:blocked,warnings:notices.map(n=>n.message),ignoreWhitespace:options.ignoreWhitespace,time:new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})};
  $('fileFilter').innerHTML='<option value="">전체</option>'+files.map(f=>`<option>${escapeHTML(f.name)}</option>`).join('');$('typeFilter').value='';$('search').value='';
  $('processOverview').innerHTML='<div class="source-table-wrap"><table><thead><tr><th>개정 파일 / 시트</th><th>원본 공정</th><th>개정 공정</th><th>결과</th><th>변경 수</th></tr></thead><tbody>'+processSummary.map(p=>`<tr><td>${escapeHTML(p.file)} · ${escapeHTML(p.sheet)}${p.afterSheet!==p.sheet?' → '+escapeHTML(p.afterSheet):''}</td><td>${escapeHTML(p.before||'—')}</td><td>${escapeHTML(p.after||'—')}</td><td>${escapeHTML(p.state)}</td><td>${p.count}</td></tr>`).join('')+'</tbody></table></div>';
  $('processFilter').innerHTML='<option value="">전체 공정</option>'+[...new Set(groups.map(g=>g.process))].map(p=>`<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join('');$('processFilter').value='';
  $('warnings').innerHTML=notices.map(w=>`<p class="warning ${w.missingCp?'missing-cp':w.error?'error':''}" role="${w.error||w.missingCp?'alert':'status'}">${escapeHTML(w.message)}</p>`).join('');
  $('metrics').innerHTML=['전체','추가','변경','삭제','순서 변경'].map(t=>`<div class="metric">${t}<strong>${t==='전체'?all.length:all.filter(c=>c.type===t).length}</strong></div>`).join('');
  $('export').disabled=!compared;$('reportExport').disabled=!compared;
  $('results').hidden=false;$('status').textContent=`비교 완료 ${compared}개 / 실패 ${blocked}개 · 차이가 있는 공정/표 ${groups.length}개 · 셀 및 공정 차이 ${all.length}건`;render();
 }catch(e){if(token===generation){all=[];groups=[];$('status').textContent=`비교 실패: ${e.message}`;}}finally{$('compare').disabled=false;}
});
function badge(type){return `<span class="badge ${type==='추가'?'add':type==='삭제'?'delete':''}">${escapeHTML(type)}</span>`;}
function blockTable(group,side){
 const section=group[side];if(!section)return `<div class="absent">${side==='after'?'삭제됨':'원본에 없음 · 추가된 공정/표'}</div>`;
 const rows=[section.header,...section.rows].filter(Boolean);
 if(!rows.length)return '<div class="absent">내용 없음</div>';
 const layout=group[side+'Layout'],isOrder=group.key==='process-order';
 const changed=new Map();const whole=group.changes.some(c=>c.item==='전체 공정'||c.item==='전체 시트');
 for(const change of group.changes){const address=side==='before'?change.oldCell:change.newCell;if(address)changed.set(address,change.type);}
 const colNumber=c=>{let n=0;for(const ch of c)n=n*26+ch.charCodeAt(0)-64;return n-1;};
 const colName=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
 const first=rows[0].r-1,last=rows[rows.length-1].r-1;
 let right=Math.max(...rows.flatMap(row=>Object.keys(row.cells).map(colNumber)));
 const merges=(isOrder?[]:layout?.merges||[]).filter(m=>m.s.r<=last&&m.e.r>=first&&m.s.c<=right);
 for(const merge of merges)right=Math.max(right,merge.e.c);
 const rowMap=new Map(rows.map(row=>[row.r,row]));
 const anchors=new Map(),covered=new Set();
 for(const m of merges){const top=Math.max(first,m.s.r),bottom=Math.min(last,m.e.r);anchors.set(`${top}:${m.s.c}`,{rowspan:bottom-top+1,colspan:m.e.c-m.s.c+1});for(let r=top;r<=bottom;r++)for(let c=m.s.c;c<=m.e.c;c++)if(r!==top||c!==m.s.c)covered.add(`${r}:${c}`);}
 let html='';
 for(let r=first;r<=last;r++){const row=rowMap.get(r+1);let cells='';
  if(section.header?.r===r+1&&Object.keys(row.cells).length===1){const [col,value]=Object.entries(row.cells)[0];const type=changed.get(col+(r+1));const mark=whole?(side==='after'?'added':'removed'):type?'changed':'';html+=`<tr><td class="process-title ${mark}" colspan="${right+1}" title="${escapeHTML(group.sheet+'!'+col+(r+1))}">${escapeHTML(value)}</td></tr>`;continue;}
  const labels=Object.entries(row?.cells||{}).filter(([,v])=>/^\s*\d+\s*[.)]/.test(v));
  const labelHighlights=new Set();for(const [address] of changed){const match=address.match(/^([A-Z]+)(\d+)$/);if(!match||Number(match[2])!==r+1)continue;const c=colNumber(match[1]);const preceding=labels.filter(([l])=>colNumber(l)<c).pop();if(preceding)labelHighlights.add(preceding[0]);}
  for(let c=0;c<=right;c++){if(covered.has(`${r}:${c}`))continue;const col=colName(c),address=col+(r+1),value=row?.cells[col]??'',merge=anchors.get(`${r}:${c}`);
   const type=changed.get(address)|| (labelHighlights.has(col)?'변경':'');
   const mark=whole?(side==='after'?'added':'removed'):type==='삭제'?'removed':type==='추가'?'added':type?'changed':'';
   const isHeader=section.header?.r===r+1,isLabel=/^\s*\d+\s*[.)]/.test(value);
   cells+=`<td class="${isHeader?'process-title':isLabel?'field-label':'field-value'} ${mark}" ${merge?`colspan="${merge.colspan}" rowspan="${merge.rowspan}"`:''} title="${escapeHTML(group.sheet+'!'+address)}">${escapeHTML(value)||'&nbsp;'}</td>`;
  }html+=`<tr>${cells}</tr>`;
 }
 return `<div class="source-table-wrap"><table class="source-table" style="--cols:${right+1}"><colgroup>${Array.from({length:right+1},()=>'<col>').join('')}</colgroup><tbody>${html}</tbody></table></div>`;
}
function render(){
 const q=$('search').value.toLowerCase(),f=$('fileFilter').value,t=$('typeFilter').value;
 const filtered=groups.filter(g=>(!$('processFilter').value||g.process===$('processFilter').value)&&(!f||g.file===f)&&(!t||g.changes.some(c=>c.type===t))&&(!q||[g.file,g.sheet,g.process,...g.changes.flatMap(c=>[c.item,c.oldValue,c.newValue])].join(' ').toLowerCase().includes(q)));
 const summaries=filtered.map(g=>({group:g,items:AIBIComparison.summarize(g).filter(c=>!t||c.type===t)})).filter(s=>s.items.length);
 const lines=summaries.flatMap(s=>[`[${s.group.file} / ${s.group.sheet}]`,...s.items.map(c=>c.text),'']);
 summaryText=lines.join('\n').trim();
 $('summaryCount').textContent=`Gap 요약 ${summaries.reduce((n,s)=>n+s.items.length,0)}건`;
 $('gapSummary').innerHTML=summaries.map(s=>`<div class="summary-group"><p class="summary-source">${escapeHTML(s.group.file)} · ${escapeHTML(s.group.sheet)}</p><ul>${s.items.map(c=>`<li>${badge(c.type)} <span>${escapeHTML(c.text)}</span></li>`).join('')}</ul></div>`).join('')||'<p class="empty">표시할 Gap 요약이 없습니다.</p>';
 $('summaryExport').disabled=!summaryText;
 $('count').textContent=`차이가 있는 공정/표 ${filtered.length}개 / 전체 ${groups.length}개`;
 $('rows').innerHTML=filtered.slice(0,limit).map(g=>`<article class="gap-card"><div class="gap-heading"><div><h3>${escapeHTML(g.process)}</h3><small>${escapeHTML(g.file)} · ${escapeHTML(g.sheet)}</small></div><div>${[...new Set(g.changes.map(c=>c.type))].map(badge).join(' ')} <small>${g.changes.length}건</small></div></div><div class="before-after"><section><div class="side-heading">Before <small>${escapeHTML(g.original)}</small></div>${blockTable(g,'before')}</section><section><div class="side-heading">After <small>${escapeHTML(g.file)}</small></div>${blockTable(g,'after')}</section></div><details class="cell-details"><summary>변경 항목 및 셀 위치 (${g.changes.length}건)</summary><ul>${g.changes.map(c=>`<li>${badge(c.type)} ${escapeHTML(c.item)} · ${escapeHTML(c.oldCell||'—')} → ${escapeHTML(c.newCell||'—')}</li>`).join('')}</ul></details></article>`).join('')||'<p class="empty">표시할 차이가 없습니다. 누락 및 파일 읽기 안내는 위에서 확인하세요.</p>';
 $('more').hidden=filtered.length<=limit;
}
for(const id of ['fileFilter','processFilter','typeFilter','search'])$(id).addEventListener('input',()=>{limit=20;render();});$('more').addEventListener('click',()=>{limit+=20;render();});
$('reset').addEventListener('click',()=>{invalidate();base=null;revisions=[];selectionVersion.base++;selectionVersion.rev++;failedSelection.base=failedSelection.rev=null;updateSelectionState();$('baseFile').value='';$('revFiles').value='';$('baseName').textContent=$('revNames').textContent='선택한 파일 없음';$('status').textContent='원본과 개정 파일을 선택해 주세요.';});
$('summaryExport').addEventListener('click',()=>{
 if(!summaryText)return;
 const url=URL.createObjectURL(new Blob(['\ufeff'+summaryText],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='AI_BI_Gap_Summary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('export').addEventListener('click',()=>{
 const headers=['원본 파일','개정 파일','시트','구분','공정','항목','개정 전','개정 후','원본 셀','개정 셀'];
 const quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
 const csv='\ufeff'+[headers,...all.map(c=>[c.original,c.file,c.sheet,c.type,c.process,c.item,c.oldValue,c.newValue,c.oldCell,c.newCell])].map(r=>r.map(quote).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='AI_BI_Comparison.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});


function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('reportExport').addEventListener('click',()=>{if(reportMeta)download('AI_BI_Comparison_Report.html',AIBIReport.create(reportMeta,all,groups,blockTable),'text/html;charset=utf-8');});
$('diagnosticExport').addEventListener('click',()=>download('AI_BI_Diagnostics.txt',JSON.stringify({version:APP_VERSION,time:new Date().toISOString(),browser:navigator.userAgent,page:location.origin+location.pathname,libraryLoaded:typeof XLSX!=='undefined',failedFiles:Object.fromEntries(Object.entries(failedSelection).map(([side,files])=>[side,(files||[]).map(f=>({name:f.name,size:f.size,read:readInfo.get(f)}))])),files:[base,...revisions].filter(Boolean).map(f=>({name:f.name,size:f.size,lastModified:f.lastModified,read:readInfo.get(f)})),status:$('status').textContent,errors:diagnostics},null,2),'text/plain;charset=utf-8'));

window.AIBIWorkspace={selected:async()=>Promise.all([base,...revisions].filter(Boolean).map(async f=>({file:f.name,book:await read(f),savedMeta:f.savedRecord}))),use:async(side,record,book)=>setFiles(side,[{name:record.number+' ('+record.revision+').xlsx',savedBook:book,savedRecord:record}])};


document.body.classList.toggle('text-only',$('textOnly').checked);
$('textOnly').onchange=()=>{document.body.classList.toggle('text-only',$('textOnly').checked);$('status').textContent='변경한 정리 설정은 다음에 첨부하는 파일부터 적용됩니다.';};
$('cleanDownload').onclick=async()=>{try{const files=[base,...revisions].filter(f=>f&&!f.savedBook);if(!files.length)throw Error('먼저 Excel 파일을 첨부하세요.');for(const f of files){const data=await snapshot(f);if(data.error)throw data.error;const buffer=await AIBITextWorkbook.normalize(data.buffer,XLSX,JSZip);download(f.name.replace(/\.(xlsx|xlsm|xls)$/i,'')+'_text.xlsx',buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}}catch(e){$('status').textContent=e.message;}};
