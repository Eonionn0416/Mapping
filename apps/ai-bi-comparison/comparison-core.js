(function (root) {
  'use strict';
  const text = v => v == null ? '' : String(v).replace(/\r\n?/g, '\n');
  const norm = (v, options = {}) => options.ignoreWhitespace ? text(v).replace(/\s+/g, ' ').trim() : text(v);
  const label = v => text(v).replace(/^\s*\d+\s*[.)]\s*/, '').trim().toLowerCase();
  function sections(rows) {
    const result = [{key: 'metadata', title: '문서 기본 정보', rows: [], header: null}];
    const counts = {};
    for (const row of rows) {
      const entry = Object.entries(row.cells).find(([,v]) => /^\s*\d+\s*\[[^\]]+\]\s*=/.test(text(v)));
      if (entry) {
        const m = text(entry[1]).match(/^\s*(\d+)\s*\[([^\]]+)\]/);
        const base = m[1] + '|' + m[2].trim().toUpperCase();
        counts[base] = (counts[base] || 0) + 1;
        result.push({key: base + '|' + counts[base], title: text(entry[1]), header: row, rows: []});
      } else result[result.length - 1].rows.push(row);
    }
    return result;
  }
  function similarity(a,b,options) {
    const cols = [...new Set([...Object.keys(a.cells), ...Object.keys(b.cells)])];
    let same = 0, labels = 0;
    for (const c of cols) {
      if (a.cells[c] != null && b.cells[c] != null) {
        if (norm(a.cells[c],options) === norm(b.cells[c],options)) same++;
        if (label(a.cells[c]) === label(b.cells[c])) labels++;
      }
    }
    if (same === cols.length) return 6;
    if (labels) return 2 + 2 * labels / cols.length;
    // A single continuation value may change completely. Keep its lane aligned.
    if (Object.keys(a.cells).join('|') === Object.keys(b.cells).join('|')) return .25;
    return -3;
  }
  function align(a,b,options) {
    // Bounded per-process alignment; never allocate a whole-workbook matrix.
    if ((a.length + 1) * (b.length + 1) > 4000000) throw new Error('한 공정/기본 정보가 너무 큽니다. 2,000행 이하 단위로 분리해 주세요.');
    const n=b.length+1, d=new Float64Array((a.length+1)*n), trace=new Uint8Array(d.length);
    for(let i=1;i<=a.length;i++){d[i*n]=-i;trace[i*n]=1;}
    for(let j=1;j<=b.length;j++){d[j]=-j;trace[j]=2;}
    for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
      const k=i*n+j, match=d[k-n-1]+similarity(a[i-1],b[j-1],options), del=d[k-n]-1, add=d[k-1]-1;
      d[k]=Math.max(match,del,add);trace[k]=d[k]===match?0:d[k]===del?1:2;
    }
    const pairs=[];let i=a.length,j=b.length;
    while(i||j){const t=trace[i*n+j];if(!t){pairs.push([a[--i],b[--j]]);}else if(t===1)pairs.push([a[--i],null]);else pairs.push([null,b[--j]]);}
    return pairs.reverse();
  }
  const headerKey = v => text(v).toUpperCase().replace(/[\s._:/-]/g,'');
  function documentInfo(book) {
    const ai=[], cp=[];
    const known=new Set(['AINO','AINUMBER','BINO','BINUMBER','AIBINO','CPBLNO','CPBLNUMBER','CUSTOMER','PACKAGE','LEAD','BODY','CUSTBONDINGNO','SCKBONDINGNO','ISSUEDATE','AUTOMOTIVETYPE']);
    for(const [sheet,rows] of Object.entries(book))for(let i=0;i<rows.length;i++)for(const [col,value] of Object.entries(rows[i].cells)){
      const key=headerKey(value);
      if(!['AINO','AINUMBER','BINO','BINUMBER','AIBINO','CPBLNO','CPBLNUMBER'].includes(key))continue;
      let v='';let cell='';const following=rows[i+1];
      if(following&&following.r===rows[i].r+1&&following.cells[col]!=null&&!known.has(headerKey(following.cells[col]))){v=text(following.cells[col]).trim();cell=col+following.r;}
      if(!v){const cols=Object.keys(rows[i].cells),next=cols[cols.indexOf(col)+1];if(next&&!known.has(headerKey(rows[i].cells[next]))){v=text(rows[i].cells[next]).trim();cell=next+rows[i].r;}}
      (key.startsWith('CP')?cp:ai).push({sheet,value:v,cell:cell||col+rows[i].r});
    }
    return {ai,cp};
  }
  function validate(before,after) {
    const original=documentInfo(before),revised=documentInfo(after),warnings=[],errors=[];
    const ids=info=>[...new Set(info.ai.map(x=>x.value).filter(Boolean))];
    const a=ids(original),b=ids(revised);
    for(const [name,info,list] of [['원본',original,a],['개정',revised,b]]){
      if(!info.ai.length||info.ai.some(x=>!x.value))warnings.push(`${name}: AI No 누락`);
      if(list.length>1)warnings.push(`${name}: 서로 다른 AI No가 여러 개 있습니다 (${list.join(', ')})`);
      if(!info.cp.length)warnings.push(`${name}: CP/BL No 누락 (항목 없음)`);
      for(const cp of info.cp)if(!cp.value||/^(?:none|n\/?a|null|-|—)$/i.test(cp.value))warnings.push(`${name} / ${cp.sheet}: CP/BL No 누락 (${cp.cell})`);
    }
    return {allowed:errors.length===0,errors,warnings,original,revised};
  }
  function compare(before,after,options={}) {
    const changes=[], warnings=[];
    const validation=validate(before,after);
    warnings.push(...validation.warnings);
    let sectionKey='';const groups=[];
    const emit=(type,sheet,process,item,oldValue,newValue,oldCell='',newCell='')=>changes.push({type,sheet,process,item,oldValue,newValue,oldCell,newCell,sectionKey});
    const rowText=r=>Object.entries(r.cells).map(([c,v])=>`${c}${r.r}: ${text(v)}`).join('\n');
    const sectionText=s=>[s.header,...s.rows].filter(Boolean).map(rowText).join('\n');
    for(const sheet of new Set([...Object.keys(before),...Object.keys(after)])) {
      if(!before[sheet]||!after[sheet]){sectionKey='whole-sheet';emit(before[sheet]?'삭제':'추가',sheet,'시트','전체 시트',before[sheet]?before[sheet].map(rowText).join('\n'):'',after[sheet]?after[sheet].map(rowText).join('\n'):'');groups.push({key:sectionKey,sheet,process:'전체 시트',before:before[sheet]?{rows:before[sheet]}:null,after:after[sheet]?{rows:after[sheet]}:null});continue;}
      const a=sections(before[sheet]),b=sections(after[sheet]);
      if(a.length===1 || b.length===1)warnings.push(`${sheet}: 공정 제목을 인식하지 못한 파일은 기본 정보의 행/셀 비교를 사용합니다.`);
      for(const list of [a,b]) if(list.some(s=>s.key!=='metadata'&&Number(s.key.split('|').pop())>1))warnings.push(`${sheet}: 같은 공정 코드가 반복됩니다. 등장 순서로 연결했으므로 해당 공정을 확인해 주세요.`);
      const am=new Map(a.map(s=>[s.key,s])),bm=new Map(b.map(s=>[s.key,s]));
      const commonA=a.filter(s=>s.key!=='metadata'&&bm.has(s.key)).map(s=>s.key);
      const commonB=b.filter(s=>s.key!=='metadata'&&am.has(s.key)).map(s=>s.key);
      if(commonA.join('\n')!==commonB.join('\n')){sectionKey='process-order';emit('순서 변경',sheet,'공정 순서','공통 공정의 순서',commonA.map(k=>am.get(k).title).join('\n'),commonB.map(k=>bm.get(k).title).join('\n'));groups.push({key:sectionKey,sheet,process:'공정 순서',before:{rows:commonA.map((k,i)=>({r:i+1,cells:{A:am.get(k).title}}))},after:{rows:commonB.map((k,i)=>({r:i+1,cells:{A:bm.get(k).title}}))}});}
      for(const key of new Set([...am.keys(),...bm.keys()])){
        sectionKey=key;
        const old=am.get(key),rev=bm.get(key),process=(old||rev).title;
        groups.push({key,sheet,process,before:old||null,after:rev||null});
        if(!old||!rev){emit(old?'삭제':'추가',sheet,process,'전체 공정',old?sectionText(old):'',rev?sectionText(rev):'',old?.header?`${Object.keys(old.header.cells)[0]}${old.header.r}`:'',rev?.header?`${Object.keys(rev.header.cells)[0]}${rev.header.r}`:'');continue;}
        if(old.header&&rev.header)for(const c of new Set([...Object.keys(old.header.cells),...Object.keys(rev.header.cells)])){
          const av=text(old.header.cells[c]),bv=text(rev.header.cells[c]);
          if(norm(av,options)!==norm(bv,options))emit(!av?'추가':!bv?'삭제':'변경',sheet,process,'공정 제목 / 헤더',av,bv,av?`${c}${old.header.r}`:'',bv?`${c}${rev.header.r}`:'');
        }
        let context={};
        for(const [ar,br] of align(old.rows,rev.rows,options)){
          for(const c of new Set([...Object.keys(ar?.cells||{}),...Object.keys(br?.cells||{})])){
            const av=text(ar?.cells[c]),bv=text(br?.cells[c]);
            if(norm(av,options)===norm(bv,options))continue;
            const source=ar||br,cols=Object.keys(source.cells),idx=cols.indexOf(c);
            const preceding=cols.slice(0,idx).reverse().find(col=>/^\s*\d+\s*[.)]/.test(text(source.cells[col])));
            const prior=key==='metadata'?old.rows.find(row=>row.r===source.r-1):null;
            const verticalLabel=prior&&prior.cells[c]&&['AINO','AINUMBER','BINO','BINUMBER','AIBINO','CPBLNO','CPBLNUMBER','CUSTOMER','PACKAGE','LEAD','BODY','CUSTBONDINGNO','SCKBONDINGNO','ISSUEDATE','AUTOMOTIVETYPE'].includes(headerKey(prior.cells[c]))?text(prior.cells[c]):'';
            const item=preceding?text(source.cells[preceding]):context[c]||verticalLabel||(key==='metadata'&&idx>0?text(source.cells[cols[idx-1]]):`${c}열`);
            emit(!av?'추가':!bv?'삭제':'변경',sheet,process,item,av,bv,ar&&av?`${c}${ar.r}`:'',br&&bv?`${c}${br.r}`:'');
          }
          const source=br||ar;let last='';
          for(const [c,v] of Object.entries(source.cells)){if(/^\s*\d+\s*[.)]/.test(text(v)))last=text(v);else if(last)context[c]=last;}
        }
      }
    }
    const changedGroups=groups.map(g=>({...g,changes:changes.filter(c=>c.sheet===g.sheet&&c.sectionKey===g.key)})).filter(g=>g.changes.length);
    return {changes,groups:changedGroups,warnings:[...new Set(warnings)],validation};
  }
  function summaryLine(change) {
    const c=change;
    if(c.item==='전체 공정')return `${c.process} ${c.type}!`;
    if(c.item==='전체 시트')return `${c.sheet} 시트 ${c.type}!`;
    const prefix=`${c.process} ${c.item}`;
    if(c.type==='변경'||c.type==='순서 변경')return `${prefix} "${c.oldValue}" 에서 "${c.newValue}" 으로 ${c.type}`;
    return `${prefix} "${c.type==='삭제'?c.oldValue:c.newValue}" ${c.type}!`;
  }
  function summarize(group) {
    return group.changes.filter(c=>{
      // A newly added/deleted field label and its value form one summary item.
      const v=c.type==='추가'?c.newValue:c.type==='삭제'?c.oldValue:'';
      return !(/^\s*\d+\s*[.)]/.test(v)&&group.changes.some(other=>other!==c&&other.type===c.type&&other.item===v));
    }).map(c=>({text:summaryLine(c),type:c.type,oldCell:c.oldCell,newCell:c.newCell}));
  }
  root.AIBIComparison={compare,sections,align,documentInfo,validate,summaryLine,summarize};
  if(typeof module!=='undefined')module.exports=root.AIBIComparison;
})(typeof globalThis!=='undefined'?globalThis:this);
