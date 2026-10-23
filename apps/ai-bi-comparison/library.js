const $=id=>document.getElementById(id),C=QACatalog,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cloud,records=[];
const L=window.AIBILibrary;
const label=L.label;
async function api(){return cloud||(cloud=await import('../../shared/qa-cloud.js?v=36'));}
function status(s){$('dbStatus').textContent=s;}
function renderSide(side){
 const select=$('db'+side),old=select.value,customer=$('customer'+side),chosen=customer.value;
 customer.innerHTML='<option value="">전체 고객</option>'+[...new Set(records.map(r=>r.customer).filter(Boolean))].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');customer.value=chosen;
 const filters={customer:customer.value,device:$('device'+side).value,nickname:$('nickname'+side).value,document:$('document'+side).value};
 const filtered=records.filter(r=>L.matches(r,filters));
 select.innerHTML='<option value="">문서 선택 ('+filtered.length+'개)</option>'+filtered.map(r=>`<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('');
 if(filtered.some(r=>r.id===old))select.value=old;
 detail(side);
}
function detail(side){const r=records.find(r=>r.id===$('db'+side).value);$('detail'+side).textContent=r?[r.nickname||'Nickname 없음',r.customer,(r.devices||[r.device]).join(', '),`${r.kind} ${r.number} (${r.revision})`,r.file||''].filter(Boolean).join(' · '):'문서를 선택하세요.';}
function renderList(){renderSide('Before');renderSide('After');$('libraryList').textContent=records.length+'개 저장 문서 · 원본과 대상은 각각 검색합니다. 서로 다른 고객·문서번호 간 비교도 가능합니다.';}
async function refresh(){try{
 const service=await api();records=(await service.rows('aibiDocuments')).sort((a,b)=>a.number.localeCompare(b.number)||C.compareRev(a.revision,b.revision)||String(a.updatedAtText).localeCompare(String(b.updatedAtText)));
 let failed=0;for(let i=0;i<records.length;i++)if((records[i].metadataVersion||0)<2){status(`기존 문서 Nickname / Device 갱신 중 (${i+1}/${records.length})`);try{records[i]=await service.refreshDocumentMetadata(records[i],await service.loadDocument(records[i]));}catch(e){failed++;console.warn('AI/BI metadata update failed',records[i].number,e.message);}}
 renderList();status(`Firestore DB ${records.length}개 문서를 불러왔습니다.`+(failed?` ${failed}개 문서의 Nickname / Device 갱신 실패 · 새로고침으로 재시도하세요.`:''));return true;
 }catch(e){status('Firestore DB 연결 실패: '+e.message);return false;}}
const selected=()=>records.find(r=>r.id===($('dbAfter').value||$('dbBefore').value));
async function compare(a,b){if(!a||!b)throw Error('비교할 두 문서를 선택하세요.');if(a.id===b.id)throw Error('서로 다른 문서를 선택하세요.');status('DB 문서를 불러와 비교합니다.');const [left,right]=await Promise.all([(await api()).loadDocument(a),(await api()).loadDocument(b)]);await window.AIBIWorkspace.use('base',a,left);await window.AIBIWorkspace.use('rev',b,right);$('compare').click();status(`${label(a)} → ${label(b)} · 아래 비교 결과를 확인하세요.`);}
$('refreshDB').onclick=refresh;for(const side of ['Before','After']){for(const field of ['customer','device','nickname','document'])$(field+side).addEventListener(field==='customer'?'change':'input',()=>renderSide(side));$('db'+side).addEventListener('change',()=>detail(side));$('clear'+side).onclick=()=>{for(const field of ['customer','device','nickname','document'])$(field+side).value='';renderSide(side);};}$('compareDB').onclick=()=>compare(records.find(r=>r.id===$('dbBefore').value),records.find(r=>r.id===$('dbAfter').value)).catch(e=>status(e.message));$('previousDB').onclick=async()=>{try{const r=selected();if(!r)throw Error('문서를 선택하세요.');const p=C.previous(records,r);if(!p){status('이 문서보다 이전 Revision이 DB에 없습니다.');return;}await compare(p,r);}catch(e){status(e.message);}};
(async()=>{if(!await refresh())return;const ai=new URLSearchParams(location.search).get('ai');if(!ai)return;$('documentAfter').value=C.revisionInfo(ai).number;renderList();const info=C.revisionInfo(ai),found=records.filter(r=>C.norm(r.number)===C.norm(info.number)&&(!info.revision||C.norm(r.revision)===C.norm(info.revision)));if(!found.length){status('REL에 지정된 AI/BI가 DB에 없습니다: '+ai);return;}found.sort((a,b)=>C.compareRev(b.revision,a.revision)||String(b.updatedAtText).localeCompare(String(a.updatedAtText)));const r=found[0];$('dbAfter').value=r.id;detail('After');const p=C.previous(records,r);if(p){$('dbBefore').value=p.id;detail('Before');await compare(p,r);}else status('연결된 문서를 선택했습니다. 이전 Revision은 아직 DB에 없습니다.');})().catch(e=>status(e.message));

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
