const $=id=>document.getElementById(id),C=QACatalog,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cloud,records=[];
const L=window.AIBILibrary;
const label=L.label;
async function api(){return cloud||(cloud=await import('../../shared/qa-cloud.js?v=85'));}
function status(s){$('dbStatus').textContent=s;}
const groupsBySide={Before:[],After:[]},activeGroup={Before:'',After:''},searched={Before:false,After:false},submitted={Before:{},After:{}};
function filters(side){return Object.fromEntries(['customer','device','nickname','document'].map(f=>[f,$(f+side).value.trim()]));}
function renderSide(side){

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
async function compare(a,b){if(!a||!b)throw Error('비교할 두 문서를 선택하세요.');if(a.id===b.id)throw Error('서로 다른 문서를 선택하세요.');status('DB 문서를 불러와 비교합니다.');const [left,right]=await Promise.all([(await api()).loadDocument(a),(await api()).loadDocument(b)]);await window.AIBIWorkspace.use('base',a,left);await window.AIBIWorkspace.use('rev',b,right);const result=await window.AIBIWorkspace.compare();if(!result?.compared)throw Error($('status').textContent||'비교를 완료하지 못했습니다.');status(`${label(a)} → ${label(b)} · 비교 완료${result.blocked?' · 실패 '+result.blocked+'개':''}`);$('results').scrollIntoView({behavior:'smooth',block:'start'});}
function initCustomerPicker(side){
 const input=$('customer'+side),box=$('customerOptions'+side);let options=[],active=-1;
 function close(){box.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
 function mark(){[...box.querySelectorAll('[role="option"]')].forEach((b,i)=>{b.setAttribute('aria-selected',String(i===active));if(i===active){input.setAttribute('aria-activedescendant',b.id);b.scrollIntoView({block:'nearest'});}});}
 function show(all){const q=all?'':input.value.trim().toUpperCase();options=['',...[...new Set(records.map(r=>String(r.customer||'').trim()).filter(Boolean))].sort()].filter(c=>!q||c.toUpperCase().startsWith(q));active=-1;box.innerHTML=options.map((c,i)=>`<button type="button" role="option" id="customer-${side}-${i}" aria-selected="false" data-customer-index="${i}">${esc(c||'전체 고객')}</button>`).join('')||'<span class="customer-empty">일치하는 고객 없음</span>';box.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');}
 function choose(i){input.value=options[i]||'';close();}
 input.addEventListener('focus',()=>show(true));input.addEventListener('click',()=>show(true));input.addEventListener('input',()=>show(false));
 input.addEventListener('keydown',e=>{if(e.key==='Escape'){close();e.stopImmediatePropagation();return;}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(box.hidden)show(true);if(options.length){active=(active+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;mark();}return;}if(e.key==='Enter'&&!box.hidden&&active>=0){e.preventDefault();e.stopImmediatePropagation();choose(active);}if(e.key==='Tab')close();});
 box.addEventListener('mousedown',e=>e.preventDefault());box.addEventListener('click',e=>{const b=e.target.closest('[data-customer-index]');if(b){e.preventDefault();choose(Number(b.dataset.customerIndex));}});
 document.addEventListener('click',e=>{if(!input.parentElement.contains(e.target))close();});
}
for(const side of ['Before','After'])initCustomerPicker(side);
let initialSearchAligned=false;
function searchSide(side){searched[side]=true;submitted[side]=filters(side);activeGroup[side]='';$('db'+side).value='';renderSide(side);}
$('refreshDB').onclick=refresh;
for(const side of ['Before','After']){
 $('search'+side).onclick=()=>{searchSide(side);if(side==='Before'&&(!initialSearchAligned||$('alignSearch').checked)){for(const field of ['customer','device','nickname','document'])$(field+'After').value=$(field+'Before').value;searchSide('After');initialSearchAligned=true;$('alignSearch').checked=false;}};
 for(const field of ['customer','device','nickname','document'])$(field+side).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('search'+side).click();}});
 $('documents'+side).onclick=e=>{const button=e.target.closest('[data-group]');if(!button)return;activeGroup[side]=groupsBySide[side][Number(button.dataset.group)].key;$('db'+side).value='';renderSide(side);};
 $('revisions'+side).onclick=e=>{const button=e.target.closest('[data-revision]');if(!button)return;$('db'+side).value=button.dataset.revision;renderRevisions(side);detail(side);};
 $('clear'+side).onclick=()=>{for(const field of ['customer','device','nickname','document'])$(field+side).value='';searched[side]=false;activeGroup[side]='';$('db'+side).value='';renderSide(side);};
}
const recentKey='aibi-view-history-v1',openViews=new Map();let recentViews=[];
try{const stored=JSON.parse(localStorage.getItem(recentKey)||'[]');if(Array.isArray(stored))recentViews=stored.filter((r,i,a)=>r&&typeof r.id==='string'&&a.findIndex(x=>x?.id===r.id)===i).slice(0,7);}catch{}
try{localStorage.setItem(recentKey,JSON.stringify(recentViews));}catch{}
function recentLabel(r){const text=String(r.number||'').trim().replace(/^(AI|BI)\s+/i,'');const parts=text.replace(/\([^)]*\)\s*$/,'').split('-');return [String(parts[0]||r.customer||'—').slice(0,3).toUpperCase(),String(parts[1]||'—').slice(0,5).toUpperCase(),'('+String(r.revision||text.match(/\(([^)]+)\)\s*$/)?.[1]||'—').replace(/[()]/g,'')+')'];}
function renderRecent(){const box=$('recentDocuments');box.innerHTML=recentViews.map((r,i)=>`<button type="button" class="recent-document" data-recent="${i}" title="${esc(label(r))}" aria-label="${esc(label(r))}">${recentLabel(r).map(t=>`<span>${esc(t)}</span>`).join('')}</button>`).join('')||'<span class="recent-empty">조회 이력 없음</span>';}

function openDocument(r){const url='document-view.html?'+new URLSearchParams({id:r.id,template:$('processTemplate')?.value.trim()||''});let win=openViews.get(r.id);try{if(win&&!win.closed){win.focus();}else{win=window.open(url,'aibi_doc_'+r.id.replace(/[^a-z0-9]/gi,'_'));if(!win){status('문서 창이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.');return false;}openViews.set(r.id,win);win.focus();}}catch{win=window.open(url,'_blank');if(!win)return false;openViews.set(r.id,win);}
 recentViews=[{id:r.id,number:r.number,kind:r.kind,nickname:r.nickname,revision:r.revision,customer:r.customer},...recentViews.filter(x=>x.id!==r.id)].slice(0,7);try{localStorage.setItem(recentKey,JSON.stringify(recentViews));}catch{}renderRecent();status('문서 조회 페이지를 열었습니다.');return true;}
$('recentDocuments').onclick=e=>{const b=e.target.closest('[data-recent]');if(b){const r=recentViews[Number(b.dataset.recent)];if(r)openDocument(r);}};
$('viewBefore').onclick=()=>{const chosen=[...new Map(['Before','After'].map(side=>records.find(r=>r.id===$('db'+side).value)).filter(Boolean).map(r=>[r.id,r])).values()];if(!chosen.length){status('조회할 문서와 Revision을 선택하세요.');return;}const blocked=chosen.filter(r=>!openDocument(r));if(!blocked.length){status(chosen.length+'개 문서 조회 페이지를 열었습니다.');return;}status('브라우저에서 일부 문서 창을 차단했습니다. 아래 문서 이름을 누르면 열립니다.');for(const r of blocked){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label(r);b.onclick=()=>openDocument(r);$('dbStatus').appendChild(b);}};renderRecent();
$('compareDB').onclick=()=>compare(records.find(r=>r.id===$('dbBefore').value),records.find(r=>r.id===$('dbAfter').value)).catch(e=>status(e.message));$('previousDB').onclick=async()=>{try{const r=selected();if(!r)throw Error('문서를 선택하세요.');const p=C.previous(records,r);if(!p){status('이 문서보다 이전 Revision이 DB에 없습니다.');return;}await compare(p,r);}catch(e){status(e.message);}};
function linkNumber(v){return C.norm(String(v||'').replace(/^(AI|BI)\s+/i,'').replace(/\s+/g,''));}
function linkedDocuments(value){return String(value).replace(/©/g,'(C)').replace(/®/g,'(R)').replace(/（/g,'(').replace(/）/g,')').split(/[,;\r\n]+/).map(v=>v.trim()).filter(Boolean);}
async function openRelDocument(ai){
 const info=C.revisionInfo(ai),kind=ai.match(/^(AI|BI)\s+/i)?.[1]?.toUpperCase();
 const found=records.filter(r=>linkNumber(r.number)===linkNumber(info.number)&&(!kind||r.kind===kind)&&(!info.revision||C.norm(r.revision)===C.norm(info.revision)));
 if(!found.length){status('REL에 지정된 AI/BI가 DB에 없습니다: '+ai);return;}
 found.sort((a,b)=>C.compareRev(b.revision,a.revision)||String(b.updatedAtText).localeCompare(String(a.updatedAtText)));
 const r=found[0],p=C.previous(records,r);
 for(const [side,record] of [['Before',p],['After',r]]){
  for(const field of ['customer','device','nickname','document'])$(field+side).value='';
  $('document'+side).value=r.number;submitted[side]=filters(side);searched[side]=true;activeGroup[side]='';$('db'+side).value='';renderSide(side);if(record)selectRecord(side,record);
 }
 initialSearchAligned=true;
 if(p)await compare(p,r);else status('연결 문서 Rev '+r.revision+' 선택 완료. 이전 Revision이 DB에 없어 자동 비교할 수 없습니다. 원본 문서 조회로 확인하세요.');
}
(async()=>{
 if(!await refresh())return;const ai=new URLSearchParams(location.search).get('ai');if(!ai)return;
 const choices=[...new Set(linkedDocuments(ai))];
 if(choices.length>1){const label=document.createElement('label');label.textContent='REL 연결 AI/BI ';const select=document.createElement('select');for(const value of choices){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}label.append(select);$('dbStatus').before(label);select.onchange=async()=>{select.disabled=true;try{await openRelDocument(select.value);}catch(e){status(e.message);}finally{select.disabled=false;}};}
 await openRelDocument(choices[0]);
})().catch(e=>status(e.message));
