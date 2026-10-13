(function(root){
  const text=v=>v==null?'':String(v).replace(/\u00a0/g,' ').trim();
  const key=v=>text(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const lot=v=>text(v).toUpperCase().replace(/\s+/g,'');
  function disposition(v){
    const t=text(v).toLowerCase();
    if(!t)return '';
    if(/\b(do not|don't|not to|cannot|can't)\s+release\b/.test(t))return 'Hold';
    const h=/\bhold(?:ed)?\b/.test(t),r=/\breleas(?:e|ed)\b/.test(t);
    return h&&r?'Review':h?'Hold':r?'Released':'Review';
  }
  function replyDirectives(reply){return reply.flatMap(s=>text(s).split(/\r?\n/)).map(text).filter(s=>/^(release(?:[.!\s]*$|\s+to\s+(?:the\s+)?next\b)|hold[.!\s]*$|please\s+(release|hold)|only hold)/i.test(s));}
  const templateKey=s=>text(s).toLowerCase().replace(/\s+/g,' ').replace(/[.!]+$/,'');
  function mailDirectives(mail, knownLots, rules=[]){
    const lines=text(mail).split(/\r?\n/), results=[];
    for(const line of lines){
      if(/^(from:|sent:|subject:|发件人:|发送时间:|主题:|best regards|regards)/i.test(text(line)))break;
      const ids=[...new Set((line.match(/\b[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*\.[A-Z0-9]+\b/gi)||[]).map(lot))];
      if(!ids.length)continue;
      const pattern=templateKey(ids.reduce((v,id)=>v.replace(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'{LOT}'),line));
      const custom=rules.find(r=>templateKey(r.template)===pattern);
      let status='Review',basis='Unknown wording — verify a rule';
      if(custom){status=custom.status;basis='Verified template: '+custom.template;}
      else if(/^please\s+release\s+\{lot\}\s+to\s+(?:the\s+)?next(?:\s+(?:step|process))?$/.test(pattern)){status='Released';basis='Customer release to next';}
      else if(/^(?:please\s+)?(?:do not release|hold)\s+\{lot\}$/.test(pattern)){status='Hold';basis='Customer hold';}
      for(const id of ids)results.push({lot:id,status,sentence:text(line),basis,known:knownLots.map(lot).includes(id)});
    }
    return results;
  }
  function mailDecision(mail,id,rules=[]){
    const matches=mailDirectives(mail,[id],rules).filter(d=>d.lot===id);
    if(!matches.length)return null;
    if(new Set(matches.map(d=>d.status)).size>1)return {status:'Review',sentence:matches.map(d=>d.sentence).join('\n'),basis:'Conflicting customer instructions'};
    return matches[0];
  }
  function repairPending(e){
    if(!e.comment || e.basis==='Verified mail' || e.basis==='Verified mail template')return e;
    const d=mailDecision(e.comment,e.lot);
    if(d && (e.status!==d.status || e.disposition!==d.sentence))return {...e,status:d.status,disposition:d.sentence,basis:'Customer reply'};
    if(e.basis!=='Pending customer disposition'||text(e.disposition))return e;
    const directives=replyDirectives([e.comment]).filter(s=>!mailDirectives(s,[e.lot]).length);
    if(!directives.length)return e;
    return {...e,status:disposition(directives.join('\n')),disposition:directives.join('\n'),basis:'Customer reply'};
  }
  function parseSheet(rows,sheet,series,rules=[]){
    const number=Number((sheet.match(/(\d+)\s*$/)||[])[1]);
    if(!number)return {events:[],warnings:[sheet+': sheet name must end in a number.']};
    const headers=[];rows.forEach((r,i)=>{const k=r.map(key);const col=k.findIndex(x=>['lot','lotid','lotno','lotnumber'].includes(x));if(col>=0)headers.push({i,col,k,r});});
    if(!headers.length)return {events:[],warnings:[sheet+': no lot table found.']};
    // Only the top customer reply is eligible as a sheet-wide instruction.
    const lead=rows.slice(0,headers[0].i);let reply=[];
    for(const row of lead){const s=row.map(text).filter(Boolean).join(' ');if(/^(from:|sent:|subject:|发件人:|发送时间:|主题:|best regards|regards)/i.test(s))break;if(s)reply.push(s);}
    const directives=replyDirectives(reply).filter(s=>!mailDirectives(s,[],rules).length);
    const general=directives.length?disposition(directives.join('\n')):'';
    const events=[],summaries=new Map(),warnings=[];
    for(let hi=0;hi<headers.length;hi++){
      const hd=headers[hi],end=headers[hi+1]?.i??rows.length;
      const dc=hd.k.findIndex(x=>/disposition/.test(x)),cc=hd.k.findIndex(x=>/comment/.test(x));
      const isSummary=dc<0&&hd.k.some(x=>['good','fail','retest'].includes(x));
      let active=null;
      for(let ri=hd.i+1;ri<end;ri++){
        const row=rows[ri],id=lot(row[hd.col]);
        if(!id){if(active&&cc>=0&&text(row[cc]))active.reason+='\n'+text(row[cc]);continue;}
        if(!/^[A-Z0-9][A-Z0-9._\-/]*$/.test(id)||!/[0-9]/.test(id))continue;
        const fields={};hd.r.forEach((h,c)=>{if(text(h)&&text(row[c]))fields[text(h)]=row[c];});
        if(isSummary){if(!summaries.has(id))summaries.set(id,[]);summaries.get(id).push(fields);active=null;continue;}
        const raw=dc>=0?text(row[dc]):'';
        const decision=mailDecision(reply.join('\n'),id,rules);
        const status=decision?decision.status:raw?disposition(raw):(general||'Hold');
        active={id:JSON.stringify([series,sheet,ri+1,id]),series,sheet,comment:reply.join('\n'),sheetNumber:number,row:ri+1,lot:id,status,disposition:decision?decision.sentence:raw||directives.join('\n'),reason:cc>=0?text(row[cc]):reply.join('\n'),basis:decision?(decision.basis.startsWith('Verified template:')?'Verified mail template':'Customer reply'):raw?'Lot disposition':general?'Customer reply':'Pending customer disposition',fields,ft:[]};
        events.push(active);
      }
    }
    for(const e of events){e.ft=summaries.get(e.lot)||[];if(e.status==='Review')warnings.push(sheet+' row '+e.row+': ambiguous disposition for '+e.lot);}
    for(const [id,ft] of summaries){if(!events.some(e=>e.lot===id))events.push({id:JSON.stringify([series,sheet,'summary',id]),series,sheet,comment:reply.join('\n'),sheetNumber:number,row:0,lot:id,status:mailDecision(reply.join('\n'),id,rules)?.status||general||'Hold',disposition:mailDecision(reply.join('\n'),id,rules)?.sentence||directives.join('\n'),reason:reply.join('\n'),basis:general?'Customer reply':'Pending customer disposition',fields:{},ft});}
    return {events,warnings};
  }
  const uploadOrder=e=>Number.isFinite(e.uploadOrder)?e.uploadOrder:(Date.parse(e.importedAt||'')||0);
  const sourceKey=e=>JSON.stringify([e.series,e.file||'',e.sheet,e.row,e.lot]);
  function normalizeEvent(e){const repaired=repairPending(e),id=sourceKey(repaired);return repaired.id===id?repaired:{...repaired,id};}
  const compare=(a,b)=>uploadOrder(a)-uploadOrder(b)||a.sheetNumber-b.sheetNumber||a.row-b.row||a.id.localeCompare(b.id);
  function summarize(events){
    const groups=new Map();for(const e of events){if(!groups.has(e.lot))groups.set(e.lot,[]);groups.get(e.lot).push(e);}
    return [...groups].map(([lot,history])=>{history.sort(compare);const latest=history.at(-1);const fields={};let ft=[],reason='';for(const e of history){Object.assign(fields,e.fields);if(e.ft.length)ft=e.ft;if(e.reason)reason=e.reason;}const same=history.filter(e=>e.sheetNumber===latest.sheetNumber&&e.series===latest.series&&(e.file||'')===(latest.file||'')&&uploadOrder(e)===uploadOrder(latest));const conflict=new Set(same.map(e=>e.status)).size>1;return {lot,status:conflict?'Review':latest.status,latest,fields,ft,reason,history};}).sort((a,b)=>a.lot.localeCompare(b.lot));
  }
  const api={mailDirectives,mailDecision,parseSheet,summarize,disposition,lot,repairPending,normalizeEvent,sourceKey,uploadOrder};if(typeof module!=='undefined')module.exports=api;root.HoldCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);

