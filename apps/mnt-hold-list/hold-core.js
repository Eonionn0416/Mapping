(function(root){
  const text=v=>v==null?'':String(v).replace(/\u00a0/g,' ').trim();
  const key=v=>text(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const lot=v=>text(v).toUpperCase().replace(/\s+/g,'');
  const validLot=v=>/^[A-Z0-9][A-Z0-9._\-/]*$/.test(lot(v))&&/[0-9]/.test(lot(v));
  const templateKey=s=>text(s).toLowerCase().replace(/\s+/g,' ').replace(/[.!]+$/,'');
  function topReply(mail){const out=[];for(const line of text(mail).split(/\r?\n/)){const t=text(line);if(/^(from:|sent:|subject:|发件人:|发送时间:|主题:|best regards|regards|[-_]{3,}|on .+wrote:)/i.test(t))break;if(t)out.push(t);}return out;}
  function disposition(value){
    const t=templateKey(value).replace(/[,;]?\s*(?:thanks|thank you)$/,'').replace(/[.!]+$/,'');
    if(!t)return '';
    if(/\b(?:do not|don't|not to|cannot|can't)\s+release\b/.test(t))return 'Hold';
    if(/\b(?:if|unless|pending|subject to)\b/.test(t))return 'Review';
    if(/^release\s+and\s+hold\s+after\s+(?:ft|slt|tq|t\/q)\s*\d*$/i.test(t))return 'Released';
    const h=/\bhold(?:ed)?\b/.test(t),r=/\breleas(?:e|ed)\b/.test(t);
    if(h&&r)return 'Review';if(h)return 'Hold';if(r)return 'Released';
    if(/^(?:please\s+)?(?:flow|proceed|continue)\s+(?:to\s+)?(?:next(?:\s+(?:step|process))?|ft\d+|slt|t\/q)(?:\s+as\s+normal)?$/.test(t))return 'Released';
    return 'Review';
  }
  const actionLine=s=>/^(?:please\s+)?(?:release\b|hold\b|do not release\b|don't release\b|verify\b|flow\b|proceed\b|continue\b|only hold\b)/i.test(text(s));
  function ruleText(mail){const lines=topReply(mail),actions=lines.filter(actionLine);return (actions.length?actions:lines.filter(s=>!/^hi\b|^dear\b/i.test(s))).join('\n');}
  function resolveLot(id,knownLots){
    id=lot(id);const known=[...new Set(knownLots.map(lot))];if(known.includes(id))return {id,known:true};
    const aliases=/\.\d+$/.test(id)?known.filter(k=>k.startsWith(id)&&/^[A-Z]+$/.test(k.slice(id.length))):[];
    return aliases.length===1?{id:aliases[0],known:true,alias:id}:{id,known:false,ambiguous:aliases.length>1};
  }
  function mailDirectives(mail,knownLots,rules=[],scopeLots=[]){
    const results=[];
    for(const line of topReply(mail)){
      const ids=[...new Set((line.match(/\b[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*\.[A-Z0-9]+\b/gi)||[]).map(lot))];
      let pattern=line;for(const id of ids)pattern=pattern.replace(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'{LOT}');
      const custom=rules.find(r=>templateKey(r.template)===templateKey(pattern)||(!r.template.includes('{LOT}')&&templateKey(r.template)===templateKey(line)));
      if(!custom&&!actionLine(line))continue;
      // Named instructions target only their named lots; unnamed replies need an explicit sheet/user scope.
      const targets=ids.length?ids:scopeLots;if(!targets.length)continue;
      const status=custom?custom.status:disposition(line),basis=custom?'Verified template: '+custom.template:'Customer reply';
      for(const id of targets){const resolved=resolveLot(id,knownLots);results.push({lot:resolved.id,mentionedLot:lot(id),status:resolved.ambiguous?'Review':status,sentence:text(line),basis:resolved.ambiguous?'Ambiguous lot suffix — select the full lot':basis+(resolved.alias?' (matched '+resolved.alias+')':''),known:resolved.known});}
    }
    return results;
  }
  function mailDecision(mail,id,rules=[],knownLots=[id],scopeLots=knownLots){
    const matches=mailDirectives(mail,knownLots,rules,scopeLots).filter(d=>d.lot===lot(id));
    if(!matches.length)return null;
    if(new Set(matches.map(d=>d.status)).size>1)return {status:'Review',sentence:matches.map(d=>d.sentence).join('\n'),basis:'Conflicting customer instructions'};
    return matches[0];
  }
  function replyDirectives(reply){return topReply(reply.join('\n')).filter(actionLine);}
  function repairPending(e,rules=[],knownLots=[e.lot]){
    if(!e.comment||e.basis==='Verified mail'||e.basis==='Verified mail template')return e;
    const d=mailDecision(e.comment,e.lot,rules,knownLots,knownLots),raw=e.sourceDisposition??(e.basis==='Lot disposition'?e.disposition:'');
    const status=d?.status||(raw?disposition(raw):null),sentence=d?.sentence||raw;
    if(status&&(e.status!==status||e.disposition!==sentence))return {...e,status,disposition:sentence,basis:d?'Customer reply':'Lot disposition',sourceDisposition:raw};
    return e;
  }
  function repairEvents(events,rules=[]){
    const groups=new Map();for(const e of events){const k=JSON.stringify([e.series,e.file,e.sheet,uploadOrder(e)]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
    const out=[];for(const group of groups.values()){
      const known=group.map(e=>e.lot);out.push(...group.map(e=>normalizeEvent(repairPending(e,rules,known))));
      const first=group[0];if(!first.comment||first.basis==='Verified mail')continue;
      const directives=mailDirectives(first.comment,known,rules,[]),missing=[...new Set(directives.filter(d=>!d.known&&!/Ambiguous/.test(d.basis)).map(d=>d.lot))];
      for(const id of missing){const d=mailDecision(first.comment,id,rules,[...known,id],[]);out.push(normalizeEvent({...first,lot:id,row:0,fields:{},ft:[],status:d.status,disposition:d.sentence,basis:'Customer reply',sourceDisposition:''}));}
    }return out;
  }
  function parseSheet(rows,sheet,series,rules=[]){
    const number=Number((sheet.match(/(\d+)\s*$/)||[])[1]);
    if(!number)return {events:[],warnings:[sheet+': sheet name must end in a number.']};
    const headers=[];rows.forEach((r,i)=>{const k=r.map(key);const col=k.findIndex(x=>['lot','lotid','lotno','lotnumber'].includes(x));if(col>=0)headers.push({i,col,k,r});});
    if(!headers.length)return {events:[],warnings:[sheet+': no lot table found.']};
    // Only the top customer reply is eligible as a sheet-wide instruction.
    const lead=rows.slice(0,headers[0].i);let reply=[];
    for(const row of lead){const s=row.map(text).filter(Boolean).join(' ');if(/^(from:|sent:|subject:|发件人:|发送时间:|主题:|best regards|regards)/i.test(s))break;if(s)reply.push(s);}
    const scopedLots=[...new Set(headers.flatMap((hd,hi)=>rows.slice(hd.i+1,headers[hi+1]?.i??rows.length).map(r=>lot(r[hd.col])).filter(validLot)))];
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
        const decision=mailDecision(reply.join('\n'),id,rules,scopedLots,scopedLots);
        const status=decision?decision.status:raw?disposition(raw):'Hold';
        active={id:JSON.stringify([series,sheet,ri+1,id]),series,sheet,comment:reply.join('\n'),sheetNumber:number,row:ri+1,lot:id,status,disposition:decision?decision.sentence:raw||directives.join('\n'),reason:cc>=0?text(row[cc]):reply.join('\n'),basis:decision?'Customer reply':raw?'Lot disposition':'Pending customer disposition',sourceDisposition:raw,fields,ft:[]};
        events.push(active);
      }
    }
    for(const e of events){e.ft=summaries.get(e.lot)||[];if(e.status==='Review')warnings.push(sheet+' row '+e.row+': ambiguous disposition for '+e.lot);}
    for(const [id,ft] of summaries){if(!events.some(e=>e.lot===id))events.push({id:JSON.stringify([series,sheet,'summary',id]),series,sheet,comment:reply.join('\n'),sheetNumber:number,row:0,lot:id,status:mailDecision(reply.join('\n'),id,rules,scopedLots,scopedLots)?.status||general||'Hold',disposition:mailDecision(reply.join('\n'),id,rules,scopedLots,scopedLots)?.sentence||directives.join('\n'),reason:reply.join('\n'),basis:general?'Customer reply':'Pending customer disposition',fields:{},ft});}
    return {events:repairEvents(events,rules),warnings};
  }
  const uploadOrder=e=>Number.isFinite(e.uploadOrder)?e.uploadOrder:(Date.parse(e.importedAt||'')||0);
  const sourceKey=e=>JSON.stringify([e.series,e.file||'',e.sheet,e.row,e.lot]);
  function normalizeEvent(e){const id=sourceKey(e);return e.id===id?e:{...e,id};}
  const compare=(a,b)=>uploadOrder(a)-uploadOrder(b)||a.sheetNumber-b.sheetNumber||a.row-b.row||a.id.localeCompare(b.id);
  function summarize(events){
    const groups=new Map();for(const e of events){if(!groups.has(e.lot))groups.set(e.lot,[]);groups.get(e.lot).push(e);}
    return [...groups].map(([lot,history])=>{history.sort(compare);const latest=history.at(-1);const fields={};let ft=[],reason='';for(const e of history){Object.assign(fields,e.fields);if(e.ft.length)ft=e.ft;if(e.reason)reason=e.reason;}const same=history.filter(e=>e.sheetNumber===latest.sheetNumber&&e.series===latest.series&&(e.file||'')===(latest.file||'')&&uploadOrder(e)===uploadOrder(latest));const conflict=new Set(same.map(e=>e.status)).size>1;return {lot,status:conflict?'Review':latest.status,latest,fields,ft,reason,history};}).sort((a,b)=>a.lot.localeCompare(b.lot));
  }
  const api={topReply,ruleText,resolveLot,repairEvents,mailDirectives,mailDecision,parseSheet,summarize,disposition,lot,repairPending,normalizeEvent,sourceKey,uploadOrder};if(typeof module!=='undefined')module.exports=api;root.HoldCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);

