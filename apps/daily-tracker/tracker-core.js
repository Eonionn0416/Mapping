(function(root){
'use strict';const text=v=>String(v??'').trim().replace(/\s+/g,' '),norm=v=>text(v).toUpperCase(),key=v=>norm(v).replace(/[^A-Z0-9]/g,'');
const cust=v=>['BDR','AST','BTDR'].includes(norm(v))?'AUSTIN':norm(v);
const done=v=>/^(DONE|COMPLETE[D]?|CLOSED|FINISHED|완료|종료)$/i.test(text(v));
const ongoing=v=>/^(ON\s*GOING|IN\s*PROGRESS|진행\s*중|WIP)$/i.test(text(v));
function iso(v,date1904){if(typeof v==='number'&&v>10000&&v<100000)return new Date(Date.UTC(1899,11,30)+(Math.floor(v)+(date1904?1462:0))*86400000).toISOString().slice(0,10);return text(v);}
function parse(w,X){const records=[],sheets=[];for(const name of w.SheetNames){const sheet=w.Sheets[name],rows=X.utils.sheet_to_json(sheet,{header:1,defval:''}),hidden=Number(w.Workbook?.Sheets?.find(s=>s.name===name)?.Hidden||0)>0;let header=-1,map={},todo=false;
 for(let i=0;i<Math.min(35,rows.length);i++){const h=rows[i].map(key),idx=aliases=>h.findIndex(k=>aliases.includes(k));map={title:idx(['TITLE']),body:idx(['CURRENTSTATUS']),progress:idx(['PROGRESS']),customer:idx(['CUSTOMER']),device:idx(['DEVICE','DEIVCE','DEVICENO']),lot:idx(['LOT','LOTNO','LOTID']),ai:idx(['AINO','BINO','AIBINO']),no:idx(['NO','NUMBER']),criteria:idx(['CRITERIA']),start:idx(['STARTDATE','DATE']),due:idx(['DUEDATE']),owner:idx(['OWNER'])};
 if(map.body>=0&&map.title>=0&&(map.progress>=0||hidden)){header=i;break;}
 const item=idx(['ITEM']),status=idx(['STATUS']);if(item>=0&&status>=0&&map.customer>=0){header=i;todo=true;map.body=item;map.title=item;map.progress=status;break;}}
 if(header<0){sheets.push({name,hidden,kind:'reference',count:0});continue;}
 const merged=(r,c)=>{if(c<0)return '';const direct=rows[r]?.[c];if(direct!==''&&direct!=null)return direct;const m=(sheet['!merges']||[]).find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);return m?rows[m.s.r]?.[m.s.c]??'':'';};
 let title='',criterion='',device='',count=0;const seen=new Map();
 for(let i=header+1;i<rows.length;i++){const row=rows[i];if(!row.some(v=>text(v)))continue;const get=c=>c<0?'':merged(i,c),body=text(get(map.body));if(!body||key(body)==='CURRENTSTATUS'||key(body)==='ITEM')continue;
 if(text(get(map.title))){const next=text(get(map.title));if(next!==title){criterion='';device='';}title=next;}if(!title)title=name;
 if(text(get(map.criteria)))criterion=text(get(map.criteria));if(text(get(map.device)))device=text(get(map.device));
 const customer=cust(map.customer>=0?get(map.customer):name),progress=text(get(map.progress)),state=hidden||done(progress)?'Done':ongoing(progress)?'On going':'Other';
 const fields={};rows[header].forEach((v,c)=>{if(text(v)&&text(get(c)))fields[text(v)]=get(c);});
 const content=[title,body,device,...Object.values(fields)].join(' '),devices=[...new Set([...(device?device.split(/[,;\r\n]+/).map(text):[]),...(content.match(/\b(?:M\d{2}[A-Z0-9-]+|MT\d{4}[A-Z0-9-]*|BT\d{2}[A-Z0-9-]*|RCD\d{2}[A-Z0-9-]*)\b/g)||[])])],lots=[...new Set([text(get(map.lot)),...(content.match(/\b[A-Z]{1,5}[A-Z0-9]{3,}\.\d{1,3}\b/g)||[])].filter(Boolean))],ai=text(get(map.ai))||(content.match(/\b[A-Z]{3,}-[A-Z0-9]+(?:-[A-Z0-9]+)+\([A-Z]+\)/)||[])[0]||'';
 const no=text(get(map.no)),base=JSON.stringify([customer,name,title,no||body]),occurrence=(seen.get(base)||0)+1;seen.set(base,occurrence);
 records.push({id:base+'|'+occurrence,customer,sheet:name,title,criteria:criterion,no,body,owner:text(get(map.owner)),startDate:iso(get(map.start),w.Workbook?.WBProps?.date1904),dueDate:iso(get(map.due),w.Workbook?.WBProps?.date1904),progress,state,hidden,devices,lots,ai,sourceRow:i+1,fields});count++;}
 sheets.push({name,hidden,kind:todo?'todo':'tracker',count});
 }if(!records.length)throw Error('Title / Current status / Progress 또는 Customer / Item / Status 표가 없습니다.');return {schema:1,sheets,records};}
function groups(records,query={}){const result=new Map();for(const r of records){if(query.customer&&cust(query.customer)!==r.customer)continue;if(query.search&&!norm(JSON.stringify(r)).includes(norm(query.search)))continue;const k=JSON.stringify([r.customer,r.sheet,r.title]);if(!result.has(k))result.set(k,{key:k,customer:r.customer,sheet:r.sheet,title:r.title,ongoing:[],done:[],other:[]});const g=result.get(k);g[r.state==='Done'?'done':r.state==='On going'?'ongoing':'other'].push(r);}return [...result.values()];}
function changes(previous,current){const a=new Map((previous?.records||[]).map(r=>[r.id,r])),b=new Map(current.records.map(r=>[r.id,r])),result=[];for(const [id,r]of b){const p=a.get(id);if(!p)result.push({type:'추가',record:r});else if(JSON.stringify({...p,sourceRow:0})!==JSON.stringify({...r,sourceRow:0}))result.push({type:'변경',record:r,before:p});}for(const [id,r]of a)if(!b.has(id))result.push({type:'이번 Revision에서 제외',record:r});return result;}
const api={text,norm,cust,done,ongoing,parse,groups,changes};root.TrackerCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
