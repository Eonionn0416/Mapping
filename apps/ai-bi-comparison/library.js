const $=id=>document.getElementById(id),C=QACatalog,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cloud,records=[];
const L=window.AIBILibrary;
const label=L.label;
async function api(){return cloud||(cloud=await import('../../shared/qa-cloud.js?v=85'));}
function status(s){$('dbStatus').textContent=s;}
const groupsBySide={Before:[],After:[]},activeGroup={Before:'',After:''},searched={Before:false,After:false},submitted={Before:{},After:{}};
function filters(side){return Object.fromEntries(['customer','device','nickname','document'].map(f=>[f,$(f+side).value.trim()]));}
function renderSide(side){
 $('customerOptions'+side).innerHTML=[...new Set(records.map(r=>r.customer).filter(Boolean))].sort().map(c=>`<option value="${esc(c)}"></option>`).join('');
 const old=$('db'+side).value;$('db'+side).innerHTML='<option value=""></option>'+records.map(r=>`<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('');$('db'+side).value=old;
 if(!searched[side]){$('documents'+side).textContent='검색 조건을 입력한 뒤 검색을 누르세요.';$('revisions'+side).replaceChildren();detail(side);return;}
 const groups=L.groups(records,submitted[side]);groupsBySide[side]=groups;
 $('documents'+side).innerHTML=groups.length?'<table><thead><tr><th>AI/BI No</th><th>Nickname</th></tr></thead><tbody>'+groups.map((g,i)=>{const newest=[...g.items].sort((a,b)=>C.compareRev(b.revision,a.revision)||String(b.updatedAtText).localeCompare(String(a.updatedAtText)))[0];return `<tr data-group="${i}" class="${g.key===activeGroup[side]?'selected':''}"><td><button type="button" class="document-link" data-group="${i}">${esc([newest.kind,newest.number].filter(Boolean).join(' '))}</button></td><td>${esc(newest.nickname||'—')}</td></tr>`;}).join('')+'</tbody></table>':'검색 결과가 없습니다.';
 if(activeGroup[side]&&!groups.some(g=>g.key===activeGroup[side])){activeGroup[side]='';$('db'+side).value='';}
 renderRevisions(side);detail(side);
}
function renderRevisions(side){const g=groupsBySide[side].find(g=>g.key===activeGroup[side]);if(!g){$('revisions'+side).textContent='문서를 누르면 Revision 목록이 표시됩니다.';return;}
 const items=[...g.items].sort((a,b)=>C.compareRev(b.revision,a.revision)||String(b.updatedAtText).localeCompare(String(a.updatedAtText)));
 $('revisions'+side).innerHTML='<h3>Revision 선택</h3><table><thead><tr><th>Revision</th><th>저장일 / 파일</th></tr></thead><tbody>'+items.map(r=>`<tr data-revision="${esc(r.id)}" class="${r.id===$('db'+side).value?'selected':''}"><td><button type="button" class="document-link" data-revision="${esc(r.id)}" aria-pressed="${r.id===$('db'+side).value}">Rev ${esc(r.revision)}</button></td><td>${esc(String(r.updatedAtText||'').slice(0,10))}<small>${esc(r.file||'')}</small></td></tr>`).join('')+'</tbody></table>';
}
function detail(side){const r=records.find(r=>r.id===$('db'+side).value);$('detail'+side).textContent=r?'선택: '+label(r):'Revision을 선택하세요.';}
function renderList(){renderSide('Before');renderSide('After');$('libraryList').textContent=records.length+'개 저장 문서 · 검색 → 문서 → Revision 순서로 선택하세요.';}
function selectRecord(side,r){if(!r)return;searched[side]=true;activeGroup[side]=L.groupKey(r);$('db'+side).value=r.id;renderSide(side);}
async function refresh(){try{
 const service=await api();records=(await service.rows('aibiDocuments')).sort((a,b)=>a.number.localeCompare(b.number)||C.compareRev(a.revision,b.revision)||String(a.updatedAtText).localeCompare(String(b.updatedAtText)));
 let failed=0;for(let i=0;i<records.length;i++)if((records[i].metadataVersion||0)<2){status(`기존 문서 Nickname / Device 갱신 중 (${i+1}/${records.length})`);try{records[i]=await service.refreshDocumentMetadata(records[i],await service.loadDocument(records[i]));}catch(e){failed++;console.warn('AI/BI metadata update failed',records[i].number,e.message);}}
 renderList();status(`Firestore DB ${records.length}개 문서를 불러왔습니다.`+(failed?` ${failed}개 문서의 Nickname / Device 갱신 실패 · 새로고침으로 재시도하세요.`:''));return true;
 }catch(e){status('Firestore DB 연결 실패: '+e.message);return false;}}
const selected=()=>records.find(r=>r.id===($('dbAfter').value||$('dbBefore').value));
async function compare(a,b){if(!a||!b)throw Error('비교할 두 문서를 선택하세요.');if(a.id===b.id)throw Error('서로 다른 문서를 선택하세요.');status('DB 문서를 불러와 비교합니다.');const [left,right]=await Promise.all([(await api()).loadDocument(a),(await api()).loadDocument(b)]);await window.AIBIWorkspace.use('base',a,left);await window.AIBIWorkspace.use('rev',b,right);$('compare').click();status(`${label(a)} → ${label(b)} · 아래 비교 결과를 확인하세요.`);}
$('refreshDB').onclick=refresh;
for(const side of ['Before','After']){
 $('search'+side).onclick=()=>{searched[side]=true;submitted[side]=filters(side);activeGroup[side]='';$('db'+side).value='';renderSide(side);};
 for(const field of ['customer','device','nickname','document'])$(field+side).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('search'+side).click();}});
 $('documents'+side).onclick=e=>{const button=e.target.closest('[data-group]');if(!button)return;activeGroup[side]=groupsBySide[side][Number(button.dataset.group)].key;$('db'+side).value='';renderSide(side);};
 $('revisions'+side).onclick=e=>{const button=e.target.closest('[data-revision]');if(!button)return;$('db'+side).value=button.dataset.revision;renderRevisions(side);detail(side);};
 $('clear'+side).onclick=()=>{for(const field of ['customer','device','nickname','document'])$(field+side).value='';searched[side]=false;activeGroup[side]='';$('db'+side).value='';renderSide(side);};
}
let singleBook=null;
function renderSingle(reset=false){
 const sheet=$('singleSheet').value,rows=singleBook?.[sheet]||[];
 const sections=window.AIBIComparison.sections(rows,{processTemplate:$('processTemplate')?.value.trim()||''}).filter(s=>s.header||s.rows.length);
 const select=$('singleProcess'),old=reset?'':select.value;
 select.innerHTML='<option value="">전체 공정</option>'+sections.map((s,i)=>`<option value="${i}">${esc(s.title)}</option>`).join('');select.value=old;
 if(select.selectedIndex<0)select.value='';
 $('singleBody').innerHTML=sections.filter((s,i)=>!select.value||String(i)===select.value).map(section=>`<article class="single-process-card"><h3>${esc(section.title)}</h3>${window.blockTable({sheet,before:section,beforeLayout:rows.layout,changes:[]},'before')}</article>`).join('')||'<p>표시할 내용이 없습니다.</p>';
}
$('singleProcess').onchange=()=>renderSingle();
$('singleSheet').onchange=()=>renderSingle(true);$('closeSingle').onclick=()=>{$('singleDocument').hidden=true;};
$('viewBefore').onclick=async()=>{const r=records.find(r=>r.id===$('dbBefore').value);if(!r){status('비교 원본의 문서와 Revision을 선택하세요.');return;}const btn=$('viewBefore');btn.disabled=true;try{status('원본 문서를 불러오는 중입니다.');singleBook=await(await api()).loadDocument(r);$('singleTitle').textContent=label(r);$('singleSheet').innerHTML=Object.keys(singleBook).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');renderSingle(true);$('singleDocument').hidden=false;$('singleDocument').scrollIntoView({behavior:'smooth',block:'start'});status('선택한 원본 문서를 조회했습니다.');}catch(e){status('문서 조회 실패: '+e.message);}finally{btn.disabled=false;}};
$('compareDB').onclick=()=>compare(records.find(r=>r.id===$('dbBefore').value),records.find(r=>r.id===$('dbAfter').value)).catch(e=>status(e.message));$('previousDB').onclick=async()=>{try{const r=selected();if(!r)throw Error('문서를 선택하세요.');const p=C.previous(records,r);if(!p){status('이 문서보다 이전 Revision이 DB에 없습니다.');return;}await compare(p,r);}catch(e){status(e.message);}};
(async()=>{if(!await refresh())return;const ai=new URLSearchParams(location.search).get('ai');if(!ai)return;$('documentAfter').value=C.revisionInfo(ai).number;searched.After=true;submitted.After=filters('After');renderList();const info=C.revisionInfo(ai),found=records.filter(r=>C.norm(r.number)===C.norm(info.number)&&(!info.revision||C.norm(r.revision)===C.norm(info.revision)));if(!found.length){status('REL에 지정된 AI/BI가 DB에 없습니다: '+ai);return;}found.sort((a,b)=>C.compareRev(b.revision,a.revision)||String(b.updatedAtText).localeCompare(String(a.updatedAtText)));const r=found[0];selectRecord('After',r);const p=C.previous(records,r);if(p){selectRecord('Before',p);await compare(p,r);}else status('연결된 문서를 선택했습니다. 이전 Revision은 아직 DB에 없습니다.');})().catch(e=>status(e.message));

let autoSaveChain=Promise.resolve();
async function saveDocuments(docs){
 const uploaded=docs.filter(d=>!d.savedMeta);if(!uploaded.length)return;
 const prepared=uploaded.map(d=>({...d,meta:{...C.identify(d.book),file:d.file}}));
 for(const d of prepared)if(!d.meta.number||!d.meta.revision||d.meta.ambiguous||!d.meta.devices.length)throw Error(d.file+': 문서 내부 AI/BI No, 괄호 안 영문 Revision, Device를 확인할 수 없습니다.');
 $('savePreview').innerHTML='<div class="source-table-wrap"><table><thead><tr><th>첨부 파일</th><th>문서 내부 AI/BI No</th><th>Revision</th><th>Customer</th><th>Nickname</th><th>Device</th></tr></thead><tbody>'+prepared.map(d=>`<tr><td>${esc(d.file)}</td><td>${esc(d.meta.number)}</td><td>${esc(d.meta.revision)}</td><td>${esc(d.meta.customer)}</td><td>${esc(d.meta.nickname)}</td><td>${esc(d.meta.devices.join(', '))}</td></tr>`).join('')+'</tbody></table></div>';
 for(const d of prepared){status('자동 저장 중: '+d.meta.number+' ('+d.meta.revision+')');await (await api()).saveDocument(d.meta,d.book);}
 await refresh();status(prepared.length+'개 문서를 내부 AI/BI No · Revision · Customer · Device 기준으로 자동 저장했습니다.');
}
function scheduleAutoSave(){const selected=window.AIBIWorkspace.selected();autoSaveChain=autoSaveChain.catch(()=>{}).then(async()=>saveDocuments(await selected)).catch(e=>status('자동 저장 실패: '+e.message+' · 다시 저장 버튼으로 재시도할 수 있습니다.'));return autoSaveChain;}
window.addEventListener('aibi-files-ready',scheduleAutoSave);$('prepareSave').onclick=scheduleAutoSave;$('compare').addEventListener('click',scheduleAutoSave);
