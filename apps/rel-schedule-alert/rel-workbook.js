/* Lossless OOXML update: unrelated workbook parts stay in the original ZIP.
   Browser DOM + bundled JSZip; no SheetJS re-export of customer workbooks. */
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DAY=86400000, EPOCH=Date.UTC(1899,11,30);
const text=v=>String(v??'').trim();
const key=v=>text(v).toLowerCase().replace(/[\s.'"`()\[\]#\-/\\:,]/g,'');
const children=(n,t)=>Array.from(n?.children||[]).filter(x=>x.localName===t);
const all=(n,t)=>Array.from(n.getElementsByTagNameNS('*',t));
const first=(n,t)=>all(n,t)[0];
const parse=s=>{const d=new DOMParser().parseFromString(s,'application/xml');if(first(d,'parsererror'))throw Error('Excel XML parsing failed');return d;};
const serialize=d=>new XMLSerializer().serializeToString(d);
const elem=(doc,name,attrs={})=>{const e=doc.createElementNS(NS,name);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));return e;};
export function column(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
function point(a){const m=a.replace(/\$/g,'').match(/^([A-Z]+)(\d+)$/);return m?{c:[...m[1]].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0),r:+m[2]}:null;}
function rect(a){const [x,y]=a.split(':');return {s:point(x),e:point(y||x)};}
export const dateSerial=iso=>Math.round((Date.parse(iso+'T00:00:00Z')-EPOCH)/DAY);
export const serialDate=n=>typeof n==='number'&&n>0?new Date(EPOCH+n*DAY).toISOString().slice(0,10):'';
export const seoulToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const done=v=>/^(done|completed?|finished|pass|완료)$/i.test(text(v));
const family=v=>/^pre[ -]?con|^msl/i.test(v)?'PRECON':/u\s*hast|unbiased/i.test(v)?'UHAST':/b\s*hast|biased/i.test(v)?'BHAST':/htst|storage|high temp/i.test(v)?'HTST':/thermal|\btct?\b/i.test(v)?'TC':key(v);
const isFT=v=>/^(FT(?:\b|\()|Function\s*Test|Final\s*Test)/i.test(v);
function customer(name){return (name.match(/\b(MNT|MTK|BDR)\d*/i)||[])[1]?.toUpperCase()||'OTHER';}

export async function readPlanWorkbook(buffer,fileName){
 const zip=await JSZip.loadAsync(buffer);
 const doc=async p=>parse(await zip.file(p).async('string'));
 const book=await doc('xl/workbook.xml'), rels=await doc('xl/_rels/workbook.xml.rels');
 const strings=zip.file('xl/sharedStrings.xml')?all(await doc('xl/sharedStrings.xml'),'si').map(s=>all(s,'t').map(t=>t.textContent).join('')):[];
 const styles=await doc('xl/styles.xml');
 const fills=children(first(styles,'fills'),'fill').map(f=>{const c=first(f,'fgColor');return c?.getAttribute('rgb')||({'6':'FFFFFF00'}[c?.getAttribute('indexed')]||'');});
 const xfs=children(first(styles,'cellXfs'),'xf');
 const yellow=id=>{const rgb=fills[+(xfs[id]?.getAttribute('fillId')||0)]?.slice(-6);if(!/^[0-9A-F]{6}$/i.test(rgb))return false;return parseInt(rgb.slice(0,2),16)>210&&parseInt(rgb.slice(2,4),16)>180&&parseInt(rgb.slice(4,6),16)<130;};
 const sheets=[];
 for(const sn of all(book,'sheet')){
  const id=sn.getAttributeNS(RNS,'id');const target=all(rels,'Relationship').find(x=>x.getAttribute('Id')===id)?.getAttribute('Target');
  if(!target)continue; const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
  const xml=await doc(path), cells=new Map();
  for(const c of all(xml,'c')){const a=c.getAttribute('r'),t=c.getAttribute('t'),v=first(c,'v')?.textContent;cells.set(a,{a,...point(a),node:c,f:first(c,'f')?.textContent||'',v:t==='s'?strings[+v]||'':t==='inlineStr'?all(c,'t').map(t=>t.textContent).join(''):t==='str'||t==='e'?v||'':v===undefined||v===''?'':Number(v),yellow:yellow(+(c.getAttribute('s')||0))});}
  // Excel stores many date chains as shared formulas. Expand them for calculation,
  // while retaining the original shared-formula XML for lossless export.
  const shared=new Map();for(const c of cells.values()){const f=first(c.node,'f');if(f?.getAttribute('t')==='shared'&&c.f)shared.set(f.getAttribute('si'),c);}
  for(const c of cells.values()){const f=first(c.node,'f');if(f?.getAttribute('t')==='shared'&&!c.f){const base=shared.get(f.getAttribute('si'));if(base)c.f=translateShared(base.f,c.r-base.r,c.c-base.c);}}
  const merges=all(xml,'mergeCell').map(m=>rect(m.getAttribute('ref')));
  const anchor=(r,c)=>{const m=merges.find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);return column(m?m.s.c:c)+(m?m.s.r:r);};
  const value=(r,c)=>cells.get(anchor(r,c))?.v??'';
  let header=null;
  const rows=[...new Set([...cells.values()].map(c=>c.r))].sort((a,b)=>a-b);
  for(const r of rows){const cs=[...cells.values()].filter(c=>c.r===r),map={};for(const c of cs){const k=key(c.v);if(['datein','dateout','status','delay','duration','relitem','cirteria','criteria','testitem','shipping','shipment','remark','failmode','condition'].includes(k))map[k]=c.c;}
   if(map.datein&&map.dateout){map.criteria=map.criteria||map.cirteria||map.testitem;map.relitem=map.relitem||map.criteria+1;map.shipping=map.shipping||map.shipment||map.remark;header={r,map};break;}}
  const s={name:sn.getAttribute('name'),path,xml,cells,merges,anchor,value,header,records:[],summary:[],reports:[],notes:[]};
  if(header){
   const rn=[...cells.values()].find(c=>c.r<header.r&&['rel','relno','relnumber'].includes(key(c.v)));
   s.relNo=rn?text(value(rn.r,rn.c+1)):'';
   let criteria='';const m=header.map;
   for(const r of rows.filter(r=>r>header.r)){
    const cv=text(value(r,m.criteria));if(cv)criteria=cv;
    const label=text(value(r,m.relitem));if(!label||/^(note|remark|summary|report)/i.test(label)||!criteria)continue;
    if(!cells.get(anchor(r,m.dateout))&&!cells.get(anchor(r,m.datein)))continue;
    const rec={sheetName:s.name,rowNumber:r,criteria,relItem:label,condition:m.condition?text(value(r,m.condition)):'',dueRef:anchor(r,m.dateout),inRef:anchor(r,m.datein),statusRef:m.status?anchor(r,m.status):'',delayRef:m.delay?anchor(r,m.delay):'',dateOut:serialDate(value(r,m.dateout)),dateIn:serialDate(value(r,m.datein)),status:m.status?text(value(r,m.status)):'',delay:m.delay?Number(value(r,m.delay))||0:0,yellow:m.shipping?!!cells.get(column(m.shipping)+r)?.yellow:false,family:family(criteria)};
    s.records.push(rec);
   }
   s.summary=summaryRecords(s.records);
   s.reports=reportRows(s,customer(fileName));
   const reportStart=[...cells.values()].find(c=>c.r<header.r&&key(c.v)==='report'&&key(value(c.r,c.c+1))==='duedate');
   s.start=reportStart?.r||header.r;
   if(reportStart){const rr=reportStart.r, cols={};for(const c of [...cells.values()].filter(c=>c.r===rr))if(['report','duedate','delay','sendtocust','approval'].includes(key(c.v)))cols[key(c.v)]=c.c;
    s.reportHeader={row:rr,cols};
    s.removedReports=[];
    if(customer(fileName)==='BDR')for(const c of cells.values())if(c.r>rr&&c.r<header.r&&['t1sanity','prempsit','t2sanity'].includes(key(c.v)))s.removedReports.push(c.r);
    s.reports=s.reports.filter(report=>{const c=[...cells.values()].find(c=>c.r>rr&&c.r<header.r&&key(c.v)===key(report.label));if(!c)return false;
      report.row=c.r;report.dueCell=anchor(c.r,cols.duedate);report.delayCell=cols.delay?anchor(c.r,cols.delay):'';
      report.sentCell=cols.sendtocust?anchor(c.r,cols.sendtocust):'';report.approvalCell=cols.approval?anchor(c.r,cols.approval):'';
      const dc=cells.get(report.dueCell);if(dc?.f){const refs=[...new Set((dc.f.match(/\$?[A-Z]+\$?\d+/g)||[]).map(a=>a.replace(/\$/g,'')))].filter(a=>point(a).r>header.r);if(refs.length){report.refs=refs;report.issue='';report.extra=/MAX\([^)]*\)\s*\+\s*7/i.test(dc.f)?7:0;}}
      report.sent=cells.get(report.sentCell)?.v??'';report.approval=cells.get(report.approvalCell)?.v??'';
      return true;
    });
   }
   // Existing Summary is authoritative. Resolve its source links without rebuilding its layout.
   const sh=[...cells.values()].find(c=>c.r<header.r&&['criteria','cirteria'].includes(key(c.v))&&key(value(c.r,c.c+1))==='relitem');
   if(sh){const cols={};for(const c of cells.values())if(c.r===sh.r)cols[key(c.v)]=c.c;
    s.summaryCells=[];const selected=[];
    for(const r of rows.filter(r=>r>sh.r&&r<header.r)){
      const dc=cols.duedate?cells.get(anchor(r,cols.duedate)):null;if(!dc)continue;
      const refs=(dc.f.match(/\$?[A-Z]+\$?\d+/g)||[]).map(a=>a.replace(/\$/g,''));
      const rec=s.records.find(x=>refs.includes(x.dueRef));if(!rec)continue;
      rec.summaryLabel=text(value(r,cols.relitem))||rec.relItem;selected.push(rec);
      s.summaryCells.push({record:rec,due:dc.a,status:cols.status?anchor(r,cols.status):'',delay:(cols.delay||cols.delary)?anchor(r,cols.delay||cols.delary):''});
    }
    s.summary=[...new Set(selected)];
   }
  }
  sheets.push(s);
 }
 return {zip,book,styles,sheets,fileName,customer:customer(fileName),date1904:first(book,'workbookPr')?.getAttribute('date1904')==='1'};
}

function summaryRecords(rows){
 // Yellow Shipping marks select checkpoints; resolve dates/status independently to merge anchors.
 const selected=rows.filter(r=>r.yellow);
 // Customer templates may omit yellow on the final FT. Include actual FT endpoints, no ET2 requirement.
 const blocks=ftBlocks(rows);
 for(const b of blocks){if(!selected.some(r=>b.rows.includes(r)))selected.push(b.rows.at(-1));}
 if(!rows.some(r=>r.yellow)){for(const r of rows)if(/sat|t-sam/i.test(r.relItem))selected.push(r);}
 const seen=new Set();return selected.sort((a,b)=>a.rowNumber-b.rowNumber).filter(r=>{const k=[r.criteria,r.dueRef,r.statusRef].join('|');if(seen.has(k))return false;seen.add(k);r.summaryLabel=rows.find(x=>x.rowNumber===point(r.dueRef).r)?.relItem||r.relItem;return true;});
}
export function ftBlocks(rows){
 const blocks=[];let current=null,readout=null,lastCriteria='';
 for(const r of rows){
  if(r.criteria!==lastCriteria){current=null;readout=null;lastCriteria=r.criteria;}
  if(!isFT(r.relItem)){current=null;const n=r.relItem.match(/(?:TC|HTST|[uUbB]?HAST)\s*(\d+)|^(\d+)\s*(?:cycles|hrs|hours)/i);if(n)readout=+(n[1]||n[2]);continue;}
  const n=r.relItem.match(/(?:\(|TC|HTST|HAST)\s*(\d+)/i);const number=n?+n[1]:readout;
  if(!current||current.criteria!==r.criteria||current.number!==number){current={criteria:r.criteria,family:r.family,number,rows:[]};blocks.push(current);}
  current.rows.push(r);
 }
 return blocks;
}
function reportRows(sheet,cust){
 const blocks=ftBlocks(sheet.records), groups=new Map();
 blocks.filter(b=>b.family!=='PRECON').forEach(b=>{if(!groups.has(b.criteria))groups.set(b.criteria,[]);groups.get(b.criteria).push(b);});
 const refs=bs=>[...new Set(bs.flatMap(b=>b.rows.map(r=>r.dueRef)))];
 const finals=[...groups.values()].map(bs=>bs.at(-1));
 const selected=[];const missing=[];
 for(const [criteria,bs] of groups){const f=bs[0].family;if(!(['TC','HTST',...(cust==='MTK'?['UHAST']:[])].includes(f)))continue;
  const target=cust==='MNT'?1000:cust==='MTK'?({TC:200,HTST:168,UHAST:96}[f]):null;
  const match=target?bs.find(b=>b.number===target):bs[0];
  if(match)selected.push(match);else if(cust==='MTK'){selected.push(bs[0]);sheet.notes.push(`${criteria}: Interim uses first actual readout (${bs[0].number??'FT'})`);}else missing.push(criteria+' 1000');
 }
 if(!selected.length&&!missing.length)missing.push('Interim FT readout');
 const sit=/\bSIT\b|\bT2\b/i.test(sheet.name);
 const row=(label,rs,extra=0,issue='')=>({label,refs:rs,extra,issue,sent:'',approval:''});
 const list=[row('Interim',refs(selected),0,missing.length?'Review: '+missing.join(', '):''),row('Full Qual Rel',refs(finals),0,finals.length?'':'Review: final FT readout')];
 if(cust==='MTK'){
  list.push(row('T1 sanity',refs(selected),0,list[0].issue));
  const finalRefs=sheet.records.map(r=>r.dueRef);
  list.push(row('Pre-MP SIT',sit?[...new Set(finalRefs)]:[],7,sit?'':'N/A'),row('T2 sanity',sit?[...new Set(finalRefs)]:[],7,sit?'':'N/A'));
  if(sit)for(const r of list.slice(0,3)){r.refs=[];r.issue='N/A';}
 }
 return list;
}

// Row insertion/replacement is performed on references, never by replacing arbitrary digit strings.
function shiftRef(ref,start,oldEnd,delta){return ref.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g,(a,c,d,r)=>+r>=oldEnd?c+d+(+r+delta):a);}
function translateShared(formula,dr,dc){
 return formula.split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2?part:part.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g,(a,ac,col,ar,row)=>{const c=point(col+row).c;return ac+column(c+(ac?0:dc))+ar+(+row+(ar?0:dr));})).join('');
}
function shiftFormula(f,own,target,start,end,delta){
 return f.split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2?part:part.replace(/(?:(?:'((?:[^']|'')+)'|([A-Za-z_\u0080-\uFFFF][\w.\u0080-\uFFFF]*))!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g,(full,quoted,plain,ref)=>{const sheet=quoted?quoted.replace(/''/g,"'"):plain;return (sheet?sheet===target:own===target)?full.slice(0,full.length-ref.length)+shiftRef(ref,start,end,delta):full;})).join('');
}
function setCell(s,a,value,style,formula){
 const p=point(a),data=first(s.xml,'sheetData');let row=children(data,'row').find(r=>+r.getAttribute('r')===p.r);
 if(!row){row=elem(s.xml,'row',{r:p.r});const after=children(data,'row').find(r=>+r.getAttribute('r')>p.r);data.insertBefore(row,after||null);}
 let c=children(row,'c').find(c=>c.getAttribute('r')===a);
 if(!c){c=elem(s.xml,'c',{r:a});const after=children(row,'c').find(c=>point(c.getAttribute('r')).c>p.c);row.insertBefore(c,after||null);}
 while(c.firstChild)c.removeChild(c.firstChild);c.removeAttribute('t');if(style!==undefined)c.setAttribute('s',style);
 if(formula){const f=elem(s.xml,'f');f.textContent=formula.replace(/^=/,'');c.appendChild(f);}
 if(typeof value==='number'){const v=elem(s.xml,'v');v.textContent=value;c.appendChild(v);}else if(formula){c.setAttribute('t','str');const v=elem(s.xml,'v');v.textContent=text(value);c.appendChild(v);}else{c.setAttribute('t','inlineStr');const is=elem(s.xml,'is'),t=elem(s.xml,'t');t.textContent=text(value);is.appendChild(t);c.appendChild(is);}
 return c;
}
function addStyles(pkg){
 const d=pkg.styles,fonts=first(d,'fonts'),fills=first(d,'fills'),borders=first(d,'borders'),xfs=first(d,'cellXfs');
 const add=(parent,e)=>{const id=parent.children.length;parent.appendChild(e);parent.setAttribute('count',parent.children.length);return id;};
 const font=elem(d,'font');font.appendChild(elem(d,'sz',{val:11}));font.appendChild(elem(d,'name',{val:'Arial'}));const fi=add(fonts,font);
 const bold=font.cloneNode(true);bold.appendChild(elem(d,'b'));bold.appendChild(elem(d,'color',{rgb:'FFFFFFFF'}));const bi=add(fonts,bold);
 const fill=elem(d,'fill'),pat=elem(d,'patternFill',{patternType:'solid'});pat.appendChild(elem(d,'fgColor',{rgb:'FF234566'}));pat.appendChild(elem(d,'bgColor',{indexed:64}));fill.appendChild(pat);const hi=add(fills,fill);
 const border=elem(d,'border');for(const side of ['left','right','top','bottom']){const e=elem(d,side,{style:'thin'});e.appendChild(elem(d,'color',{rgb:'FFD8E1EA'}));border.appendChild(e);}const bri=add(borders,border);
 const style=(numFmtId=0,head=false)=>{const xf=elem(d,'xf',{numFmtId,fontId:head?bi:fi,fillId:head?hi:0,borderId:bri,xfId:0,applyAlignment:1,applyFont:1,applyFill:1,applyBorder:1,applyNumberFormat:1});xf.appendChild(elem(d,'alignment',{vertical:'center',wrapText:1}));return add(xfs,xf);};
 return {body:style(),head:style(0,true),date:style(14),num:style(1)};
}
function maxDate(pkg,s,refs){const vs=refs.map(a=>numericValue(s,a));return vs.length&&vs.every(v=>typeof v==='number'&&v>0)?Math.max(...vs):'';}
// Source date chains use scalar cell addition/subtraction. Unsupported expressions retain Excel cache.
function numericValue(s,a,visiting=new Set()){
 a=a.replace(/\$/g,'');const c=s.cells.get(a);if(!c)return 0;if(!c.f)return typeof c.v==='number'?c.v:0;
 const cache=s._dateValues??=new Map();if(cache.has(a))return cache.get(a);
 if(visiting.has(a))return typeof c.v==='number'?c.v:0;
 if(!/^[\s+$A-Z0-9().\-]+$/.test(c.f))return c.v;
 visiting.add(a);let exp=c.f.replace(/\$?([A-Z]+)\$?(\d+)/g,(_,col,r)=>String(numericValue(s,col+r,visiting)));visiting.delete(a);
 if(!/^[\s+\-\d.()]+$/.test(exp))return c.v;
 let i=0;const sum=()=>{let total=0,sign=1;while(i<exp.length){if(/\s/.test(exp[i])){i++;continue;}if(exp[i]===')'){i++;break;}if(exp[i]==='+'){sign=1;i++;continue;}if(exp[i]==='-'){sign=-1;i++;continue;}let n;if(exp[i]==='('){i++;n=sum();}else{const m=exp.slice(i).match(/^\d+(?:\.\d+)?/);if(!m)return NaN;n=+m[0];i+=m[0].length;}total+=sign*n;sign=1;}return total;};const v=sum(),result=Number.isFinite(v)?v:c.v;cache.set(a,result);return result;
}
function dueFormula(refs,extra=0){const list=[...new Set(refs)].join(',');return list?`IF(COUNT(${list})=${new Set(refs).size},IF(MIN(${list})>0,MAX(${list})${extra?'+'+extra:''},""),"")`:'""';}

export async function upgradeWorkbook(buffer,fileName,options={}){
 const pkg=await readPlanWorkbook(buffer,fileName);if(pkg.date1904)throw Error('1904 date-system workbook requires conversion to 1900 date system first.');
 const today=options.today||seoulToday(),now=dateSerial(today),styles=options.rebuildLayout===true?addStyles(pkg):null,audit=[],tableSpecs=[];
 // Persist manual changes using stable source addresses BEFORE moving the table.
 for(const s of pkg.sheets){for(const change of (options.changes||[]).filter(c=>c.sheetName===s.name)){
  if(!s.header)continue;const rec=s.records.find(r=>r.dueRef===change.dueRef);if(!rec)throw Error(`${s.name}: source row changed; upload the current workbook again.`);
  if(change.newDate){const old=numericValue(s,rec.dueRef),delta=dateSerial(change.newDate)-old;if(delta>0){if(rec.delayRef){const c=s.cells.get(rec.delayRef);const v=(typeof c?.v==='number'?c.v:0)+delta;setCell(s,rec.delayRef,v);if(c){c.v=v;c.f='';}else s.cells.set(rec.delayRef,{a:rec.delayRef,v,f:''});}else{const c=s.cells.get(rec.dueRef);setCell(s,rec.dueRef,dateSerial(change.newDate));c.v=dateSerial(change.newDate);c.f='';}}}
  if(change.status&&rec.statusRef){setCell(s,rec.statusRef,change.status);s.cells.get(rec.statusRef).v=change.status;}
  s._dateValues?.clear();
 }
 // Refresh cached source date values for date chain changes, keeping formulas alive.
 for(const r of s.records)for(const a of [r.inRef,r.dueRef]){const c=s.cells.get(a);if(c?.f){const v=numericValue(s,a);if(typeof v==='number'){const n=first(c.node,'v');if(n)n.textContent=v;c.v=v;}}}
 }
 for(const s of pkg.sheets){if(!s.header){audit.push({sheet:s.name,skipped:'No schedule table; unchanged'});continue;}
  const overrides=options.reports?.[s.name]||{};for(const r of s.reports){const o=overrides[r.label];if(o){r.sent=o.sent||'';r.approval=o.approval||'';}}
  if(options.rebuildLayout!==true){
   // Write only managed values. Never resize, move or recreate the customer's tables.
   const cache=(a,v)=>{if(!a)return;const c=s.cells.get(a);if(!c)return;if(!c.f){if(c.v!==v)setCell(s,a,v);return;}let n=first(c.node,'v');if(!n){n=elem(s.xml,'v');c.node.appendChild(n);}n.textContent=v;c.node.removeAttribute('t');if(typeof v!=='number')c.node.setAttribute('t','str');};
   for(const row of s.removedReports||[]){
    const cols=s.reportHeader.cols;for(const col of Object.values(cols))if(col)setCell(s,s.anchor(row,col),'');
    const rn=children(first(s.xml,'sheetData'),'row').find(n=>+n.getAttribute('r')===row);
    const other=[...s.cells.values()].some(c=>c.r===row&&!Object.values(cols).includes(c.c)&&text(c.v));
    if(rn&&!other)rn.setAttribute('hidden','1');
   }
   for(const r of s.reports){
    const due=r.issue?'':maxDate(pkg,s,r.refs),v=due?due+r.extra:'';
    // Preserve user-authored formulas; newly calculated caches follow the customer readout rules.
    if(!r.issue)cache(r.dueCell,v);
    const sent=typeof r.sent==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.sent)?dateSerial(r.sent):r.sent;
    if(overrides[r.label]){if(r.sentCell)setCell(s,r.sentCell,sent);if(r.approvalCell)setCell(s,r.approvalCell,r.approval);}
    cache(r.delayCell,v?Math.max(0,(typeof sent==='number'?sent:now)-v):'');
   }
   for(const t of s.summaryCells||[]){const r=t.record,v=numericValue(s,r.dueRef),status=r.statusRef?s.cells.get(r.statusRef)?.v||'':'',delay=r.delayRef?Number(s.cells.get(r.delayRef)?.v)||0:0;
    cache(t.due,v||'');cache(t.status,status);cache(t.delay,v?Math.max(0,delay)+(done(status)?0:Math.max(0,now-v)):'');
   }
   const sent=r=>r&&(typeof r.sent==='number'||/^\d{4}-\d{2}-\d{2}$/.test(r.sent));
   const full=s.reports.find(r=>r.label==='Full Qual Rel'),interim=s.reports.find(r=>r.label==='Interim');
   if(sent(full)||sent(interim)){let pr=first(s.xml,'sheetPr');if(!pr){pr=elem(s.xml,'sheetPr');s.xml.documentElement.insertBefore(pr,s.xml.documentElement.firstChild);}let tab=first(pr,'tabColor');if(!tab){tab=elem(s.xml,'tabColor');pr.insertBefore(tab,pr.firstChild);}for(const a of [...tab.attributes])tab.removeAttribute(a.name);tab.setAttribute('rgb',sent(full)?'FF70AD47':'FFFFA500');}
   audit.push({sheet:s.name,header:s.header.r,layoutPreserved:true,removedReports:(s.removedReports||[]).length,summary:s.summary.length});
   continue;
  }
  const start=s.start,oldEnd=s.header.r,needed=s.reports.length+s.summary.length+6,delta=needed-(oldEnd-start),newHeader=oldEnd+delta;
  const move=a=>shiftRef(a,start,oldEnd,delta);
  // Retain notes and all populated metadata outside the existing report/summary block.
  const data=first(s.xml,'sheetData');for(const row of [...children(data,'row')]){const r=+row.getAttribute('r');if(r>=start&&r<oldEnd){row.remove();continue;}if(r>=oldEnd)row.setAttribute('r',r+delta);for(const c of children(row,'c'))c.setAttribute('r',move(c.getAttribute('r')));}
  for(const n of Array.from(s.xml.getElementsByTagName('*'))){for(const attr of ['ref','sqref','activeCell','topLeftCell'])if(n.hasAttribute(attr)){const v=n.getAttribute(attr);if(n.localName==='mergeCell'){const rr=rect(v);if(rr.s.r>=start&&rr.e.r<oldEnd){n.remove();continue;}}n.setAttribute(attr,move(v));}}
  const mc=first(s.xml,'mergeCells');if(mc)mc.setAttribute('count',children(mc,'mergeCell').length);
  for(const other of pkg.sheets)for(const f of all(other.xml,'f'))f.textContent=shiftFormula(f.textContent,other.name,s.name,start,oldEnd,delta);
  for(const n of all(pkg.book,'definedName'))n.textContent=shiftFormula(n.textContent,'',s.name,start,oldEnd,delta);
  // Preserve drawing anchors and notes attached to shifted rows.
  const relPath=s.path.replace('/worksheets/','/worksheets/_rels/')+'.rels';
  if(pkg.zip.file(relPath)){const relDoc=parse(await pkg.zip.file(relPath).async('string'));for(const rel of all(relDoc,'Relationship')){const target=rel.getAttribute('Target'),type=rel.getAttribute('Type');if(!/drawing|comments$/.test(type))continue;const p=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\.\//,'');if(!pkg.zip.file(p))continue;const d=parse(await pkg.zip.file(p).async('string'));if(/drawing$/.test(type)){for(const r of all(d,'row'))if(+r.textContent>=oldEnd-1)r.textContent=+r.textContent+delta;}else{for(const c of all(d,'comment'))c.setAttribute('ref',move(c.getAttribute('ref')));}pkg.zip.file(p,serialize(d));}}
  const spec={sheet:s.name,cells:[],start,end:newHeader-1};
  const put=(r,c,v,type='body',f='')=>{const a=column(c)+r;setCell(s,a,v,styles[type],f);spec.cells.push({a,v,type,f});};
  ['Report','Due date','Delay','Send to Cust','Approval'].forEach((v,i)=>put(start,2+i,v,'head'));
  s.reports.forEach((r,i)=>{const row=start+i+1,refs=r.refs.map(move);let value=r.issue?'':maxDate(pkg,s,r.refs);if(value)value+=r.extra;
   put(row,2,r.label);put(row,3,r.issue?r.issue:value,r.issue?'body':'date',r.issue?'':dueFormula(refs,r.extra));
   const sent=typeof r.sent==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.sent)?dateSerial(r.sent):r.sent;
   put(row,4,value?Math.max(0,(typeof sent==='number'?sent:now)-value):'','num',`IF(ISNUMBER(C${row}),MAX(0,IF(ISNUMBER(E${row}),E${row},TODAY())-C${row}),"")`);
   put(row,5,sent,'date');put(row,6,r.approval,'body');
  });
  const title=start+s.reports.length+2;put(title,2,'Summary','head');
  ['Criteria','Rel item','Due date','Status','Delay'].forEach((v,i)=>put(title+1,2+i,v,'head'));
  s.summary.forEach((r,i)=>{const row=title+2+i,v=numericValue(s,r.dueRef),status=r.statusRef?s.cells.get(r.statusRef)?.v||'':'',delay=r.delayRef?Number(s.cells.get(r.delayRef)?.v)||0:0;
   put(row,2,r.criteria);put(row,3,r.summaryLabel||r.relItem);put(row,4,v||'','date',`IF(${move(r.dueRef)}="","",${move(r.dueRef)})`);
   put(row,5,status,'body',r.statusRef?`IF(${move(r.statusRef)}="","",${move(r.statusRef)})`:'');
   const dr=r.delayRef?`MAX(0,N(${move(r.delayRef)}))`:'0';
   put(row,6,v?Math.max(0,delay)+(done(status)?0:Math.max(0,now-v)):'','num',`IF(ISNUMBER(D${row}),${dr}+IF(OR(E${row}="Done",E${row}="Completed",E${row}="Complete",E${row}="Pass",E${row}="완료"),0,MAX(0,TODAY()-D${row})),"")`);
  });
  for(const row of children(data,'row')){const r=+row.getAttribute('r');if(r>=start&&r<newHeader){row.setAttribute('ht',r===title?24:32);row.setAttribute('customHeight','1');}}
  // The original Criteria column is narrow (3.6 chars on legacy sheets).
  // Widen only the five report/summary columns so wrapped text and dates remain readable.
  let cols=first(s.xml,'cols');if(!cols){cols=elem(s.xml,'cols');s.xml.documentElement.insertBefore(cols,data);}
  const widths={2:31,3:26,4:17,5:20,6:19};
  const oldCols=children(cols,'col').map(c=>({node:c,min:+c.getAttribute('min'),max:+c.getAttribute('max')}));
  for(const c of [...children(cols,'col')])c.remove();
  for(const c of oldCols){for(const [lo,hi] of [[c.min,Math.min(c.max,1)],[Math.max(c.min,7),c.max]])if(lo<=hi){const n=c.node.cloneNode(true);n.setAttribute('min',lo);n.setAttribute('max',hi);cols.appendChild(n);}}
  for(const [col,width] of Object.entries(widths)){const old=oldCols.find(c=>+col>=c.min&&+col<=c.max);const n=old?old.node.cloneNode(true):elem(s.xml,'col');n.setAttribute('min',col);n.setAttribute('max',col);n.setAttribute('width',Math.max(width,+(old?.node.getAttribute('width')||0)));n.setAttribute('customWidth','1');cols.appendChild(n);}
  for(const n of children(cols,'col').sort((a,b)=>+a.getAttribute('min')-+b.getAttribute('min')))cols.appendChild(n);
  const m=s.header.map;if(m.shipping)setCell(s,column(m.shipping)+newHeader,'Shipping');
  if(!m.shipping&&!m.failmode){
    const last=Math.max(...[...s.cells.values()].filter(c=>c.r===oldEnd&&text(c.v)).map(c=>c.c));
    ['Shipping','Fail mode','Remark'].forEach((v,i)=>setCell(s,column(last+1+i)+newHeader,v,styles.head));
  }
  if(m.failmode){const dest=column(m.failmode+1)+newHeader;const existing=s.cells.get(column(m.failmode+1)+oldEnd);if(!existing||!text(existing.v)||['report','remark'].includes(key(existing.v)))setCell(s,dest,'Remark',styles.head);else s.notes.push('Remark column needs review: adjacent column already populated');
   for(const row of s.records){const addr=column(m.failmode+1)+(row.rowNumber+delta);if(!s.cells.get(column(m.failmode+1)+row.rowNumber))setCell(s,addr,'',styles.body);}}
  const full=s.reports.find(r=>r.label==='Full Qual Rel'),interim=s.reports.find(r=>r.label==='Interim');
  const sent=r=>r&&(typeof r.sent==='number'||/^\d{4}-\d{2}-\d{2}$/.test(r.sent));
  if(sent(full)||sent(interim)){let pr=first(s.xml,'sheetPr');if(!pr){pr=elem(s.xml,'sheetPr');s.xml.documentElement.insertBefore(pr,s.xml.documentElement.firstChild);}let tab=first(pr,'tabColor');if(!tab){tab=elem(s.xml,'tabColor');pr.insertBefore(tab,pr.firstChild);}for(const a of [...tab.attributes])tab.removeAttribute(a.name);tab.setAttribute('rgb',sent(full)?'FF70AD47':'FFFFA500');}
  tableSpecs.push(spec);audit.push({sheet:s.name,summary:s.summary.length,reports:s.reports.map(r=>({label:r.label,issue:r.issue,due:r.issue?'':serialDate((maxDate(pkg,s,r.refs)||0)+r.extra)})),header:newHeader,notes:s.notes});
 }
 let calc=first(pkg.book,'calcPr');if(!calc){calc=elem(pkg.book,'calcPr');pkg.book.documentElement.appendChild(calc);}calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');calc.setAttribute('calcMode','auto');
 pkg.zip.remove('xl/calcChain.xml');
 for(const path of ['xl/_rels/workbook.xml.rels','[Content_Types].xml']){const d=parse(await pkg.zip.file(path).async('string'));for(const n of Array.from(d.documentElement.children))if(/calcChain/.test(serialize(n)))n.remove();pkg.zip.file(path,serialize(d));}
 pkg.zip.file('xl/workbook.xml',serialize(pkg.book));pkg.zip.file('xl/styles.xml',serialize(pkg.styles));for(const s of pkg.sheets)pkg.zip.file(s.path,serialize(s.xml));
 return {buffer:await pkg.zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),audit,tableSpecs};
}
