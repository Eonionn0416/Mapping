(function (root) {
  'use strict';
  const text = v => v == null ? '' : String(v).replace(/\r\n?/g, '\n');
  const norm = (v, options = {}) => options.ignoreWhitespace ? text(v).replace(/\s+/g, ' ').trim() : text(v);
  const label = v => text(v).replace(/^\s*\d+\s*[.)]\s*/, '').trim().toLowerCase();
  function templatePattern(template) {
    if(!template)return null;
    if(!template.includes('{name}')||!(/\{(?:code|abbr)\}/.test(template)))throw Error('공정 형식에는 {name}과 {code} 또는 {abbr}를 넣어 주세요. 예: {code} [{abbr}] = {name}');
    const tokens=[];const parts=template.split(/(\{code\}|\{abbr\}|\{name\})/g);
    const pattern=parts.map(p=>{const token=p.match(/^\{(code|abbr|name)\}$/)?.[1];if(token){if(tokens.includes(token))throw Error('공정 형식의 각 항목은 한 번씩만 사용해 주세요.');tokens.push(token);return token==='code'?'([A-Z]*\\d+[A-Z]?)':'(.+?)';}return p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*');}).join('');
    return {regex:new RegExp('^\\s*'+pattern+'\\s*$','i'),tokens};
  }
  function processHeader(value,custom) {
    const s=text(value).normalize('NFKC').trim();let m;
    if(custom){m=s.match(custom.regex);if(!m)return null;return Object.fromEntries(custom.tokens.map((t,i)=>[t,m[i+1].trim()]));}
    m=s.match(/^(?:(?:AI|BI)\s+)?([A-Z]*\d+[A-Z]?)\s*\[([^\]]+)\]\s*(?:=|:|[-–—])\s*(\S.*)$/i);
    if(m)return {code:m[1],abbr:m[2],name:m[3]};
    m=s.match(/^(?:(?:AI|BI)\s+)?([A-Z]*\d{3,}[A-Z]?)\s*(?:=|:)\s*(\S.*)$/i);
    return m?{code:m[1],abbr:'',name:m[2]}:null;
  }
  function sections(rows,options={}) {
    const result = [{key: 'metadata', title: '문서 기본 정보', rows: [], header: null}];
    const counts = {},custom=templatePattern(options.processTemplate);
    for (const row of rows) {
      const values=Object.values(row.cells).filter(v=>text(v).trim());
      let title=values.find(v=>processHeader(v,custom));
      if(!title&&values.length>1&&values.length<=4&&processHeader(values.join(' '),custom))title=values.join(' ');
      const parsed=title?processHeader(title,custom):null;
      if (parsed) {
        const code=(parsed.code||'').trim().toUpperCase(),abbr=(parsed.abbr||'').trim().toUpperCase(),name=parsed.name.trim();
        const base = code + '|' + abbr;
        counts[base] = (counts[base] || 0) + 1;
        result.push({key: base + '|' + counts[base],code,abbr,name,title:text(title),header:row,rows:[]});
      } else result[result.length - 1].rows.push(row);
    }
    return result;
  }
  function matchProcesses(a,b,warnings,sheet){
    const left=new Set(a.filter(s=>s.header)),right=new Set(b.filter(s=>s.header));
    // Pair only reciprocal unique identifiers. Never resolve duplicates by row order.
    for(const by of [s=>s.code&&s.abbr?s.code+'|'+s.abbr:'',s=>s.code,s=>s.abbr,s=>s.name.toUpperCase().replace(/\s+/g,' ')]){
      for(const old of [...left]){const id=by(old);if(!id)continue;const matches=[...right].filter(s=>by(s)===id);if(matches.length!==1||[...left].filter(s=>by(s)===id).length!==1)continue;
        const rev=matches[0];rev.key=old.key;left.delete(old);right.delete(rev);
      }
    }
    for(const s of left)s.key='before:'+s.key;
    for(const s of right)s.key='after:'+s.key;
    for(const s of [...left,...right])if([...a,...b].filter(t=>t.header&&t.code===s.code&&t.abbr===s.abbr).length>2)s.review=true;
    if([...left,...right].some(s=>s.review))warnings.push(`${sheet}: 반복 공정을 하나로 특정할 수 없어 자동 연결하지 않았습니다. 추가·삭제 표시와 원본을 확인해 주세요.`);
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
    // Match an unambiguous renamed revision tab by its document number, not position.
    const identity=rows=>{const ids=documentInfo({sheet:rows}).ai.map(x=>{const id=x.value.toUpperCase().trim();return /(?:^|[-_\s])REV[.\s_-]*\d+/i.test(id)?id.replace(/(?:[-_\s])REV[.\s_-]*\d+.*$/i,''):id.split('-').length>=3?id.replace(/-\d{1,4}(?=\([^)]*\)$|$)/,''):id;});return [...new Set(ids.filter(Boolean))].sort().join('|');};
    const originalAfter=after,renamed={};after={...after};
    const missingBefore=Object.keys(before).filter(n=>!originalAfter[n]);
    const missingAfter=Object.keys(originalAfter).filter(n=>!before[n]);
    for(const name of missingBefore){const id=identity(before[name]);if(!id)continue;
      const matches=missingAfter.filter(n=>identity(originalAfter[n])===id);
      if(matches.length!==1||missingBefore.filter(n=>identity(before[n])===id).length!==1)continue;
      const other=matches[0];after[name]=originalAfter[other];delete after[other];renamed[name]=other;
      warnings.push(`시트 이름 변경: ${name} → ${other}. 동일 문서 번호의 개정본으로 비교합니다.`);
    }
    const validation=validate(before,after);
    warnings.push(...validation.warnings);
    let sectionKey='';const groups=[];
    const emit=(type,sheet,process,item,oldValue,newValue,oldCell='',newCell='')=>changes.push({type,sheet,process,item,oldValue,newValue,oldCell,newCell,sectionKey});
    const rowText=r=>Object.entries(r.cells).map(([c,v])=>`${c}${r.r}: ${text(v)}`).join('\n');
    const sectionText=s=>[s.header,...s.rows].filter(Boolean).map(rowText).join('\n');
    for(const sheet of new Set([...Object.keys(before),...Object.keys(after)])) {
      if(!before[sheet]||!after[sheet]){sectionKey='whole-sheet';emit(before[sheet]?'삭제':'추가',sheet,'시트','전체 시트',before[sheet]?before[sheet].map(rowText).join('\n'):'',after[sheet]?after[sheet].map(rowText).join('\n'):'');groups.push({key:sectionKey,sheet,process:'전체 시트',before:before[sheet]?{rows:before[sheet]}:null,after:after[sheet]?{rows:after[sheet]}:null});continue;}
      const a=sections(before[sheet],options),b=sections(after[sheet],options);
      if(a.length===1 || b.length===1){warnings.push(`${sheet}: 공정 제목 인식 부족 (원본 ${a.length-1}개 / 개정 ${b.length-1}개). 행/셀 비교 결과입니다. 공정 제목 형식을 지정한 뒤 다시 비교해 주세요.`);if(a.length===1)a[0].title='공정 미분류';if(b.length===1)b[0].title='공정 미분류';}
      matchProcesses(a,b,warnings,sheet);
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
    const allGroups=groups.map(g=>({...g,afterSheet:renamed[g.sheet]||g.sheet,changes:changes.filter(c=>c.sheet===g.sheet&&c.sectionKey===g.key)}));
    const processSummary=allGroups.filter(g=>g.key!=='process-order').map(g=>({sheet:g.sheet,afterSheet:g.afterSheet,key:g.key,before:g.before?.title||'',after:g.after?.title||'',state:g.before?.review||g.after?.review?'연결 확인':!g.before?'추가':!g.after?'삭제':g.changes.length?'변경':'동일',count:g.changes.length}));
    return {changes,groups:allGroups.filter(g=>g.changes.length),processSummary,warnings:[...new Set(warnings)],validation};
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
  root.AIBIComparison={compare,sections,processHeader,templatePattern,align,documentInfo,validate,summaryLine,summarize};
  if(typeof module!=='undefined')module.exports=root.AIBIComparison;
})(typeof globalThis!=='undefined'?globalThis:this);
