const escapeHTML=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
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
