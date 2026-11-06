import {rows,loadDocument} from '../../shared/qa-cloud.js?v=85';
const $=id=>document.getElementById(id),query=new URLSearchParams(location.search);let book;
function render(reset=false){const sheet=$('singleSheet').value,items=book[sheet]||[],sections=AIBIComparison.sections(items,{processTemplate:query.get('template')||''}).filter(s=>s.header||s.rows.length),select=$('singleProcess'),previous=reset?'':select.value;
 select.replaceChildren(new Option('전체 공정',''),...sections.map((s,i)=>new Option(s.title,String(i))));select.value=previous;if(select.selectedIndex<0)select.value='';
 $('singleBody').innerHTML=sections.filter((s,i)=>!select.value||String(i)===select.value).map(s=>`<article class="single-process-card"><h3>${escapeHTML(s.title)}</h3>${blockTable({sheet,before:s,beforeLayout:items.layout,changes:[]},'before')}</article>`).join('')||'<p>표시할 내용이 없습니다.</p>';
 $('viewStatus').textContent=`${sections.filter(s=>s.header).length}개 공정 · ${sheet}`;
}
$('singleSheet').onchange=()=>render(true);$('singleProcess').onchange=()=>render();
try{const id=query.get('id');if(!id)throw Error('선택한 문서가 없습니다. 비교 페이지에서 문서를 선택하세요.');const record=(await rows('aibiDocuments')).find(r=>r.id===id);if(!record)throw Error('이 문서를 찾을 수 없습니다. 삭제되었거나 다른 DB에 저장된 문서일 수 있습니다.');book=await loadDocument(record);const title=[record.kind,record.number,`(${record.revision})`,record.nickname].filter(Boolean).join(' ');document.title=title;$('singleTitle').textContent=title;$('singleSheet').replaceChildren(...Object.keys(book).map(n=>new Option(n,n)));$('singleSheet').disabled=false;$('singleProcess').disabled=false;render(true);}catch(e){$('viewStatus').textContent='문서 조회 실패: '+e.message;}
