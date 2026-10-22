(function(root){
'use strict';
const text=v=>String(v??'').trim().replace(/\s+/g,' '),norm=v=>text(v).toUpperCase();
const customer=v=>({AST:'AUSTIN',BTDR:'AUSTIN',BDR:'AUSTIN',AUSTIN:'AUSTIN',MEDIATEK:'MTK',MONTAGE:'MNT',MONTAGES:'MNT'}[norm(v)]||norm(v));
const flatten=v=>Array.isArray(v)?v.flatMap(flatten):v==null?[]:[text(v)];
function revisionInfo(value){const s=text(value).replace(/\.(xlsx|xlsm|xls)$/i,''),m=s.match(/^(.*?)\s*\(\s*(?:REV(?:ISION)?[ .:_-]*)?([^()]+)\s*\)\s*$/i);return m?{number:text(m[1]),revision:norm(m[2])}:{number:s,revision:''};}
function identify(book){
 const candidates=[],devices=[],nicknames=[];
 const label=v=>norm(v).replace(/[\s.#:/]/g,'');
 const candidate=v=>{const s=String(v??'').replace(/\s+/g,'');const m=s.match(/^([A-Z0-9][A-Z0-9._/-]*)\(([A-Z]+)\)$/i);return m?{number:m[1].toUpperCase(),revision:m[2].toUpperCase()}:null;};
 const deviceList=v=>String(v??'').split(/[,;\r\n]+/).map(text).filter(v=>/^[A-Z0-9][A-Z0-9._ /+-]*$/i.test(v)&&!['DEVICE','DEVICE NO','N/A','NA','NONE','-'].includes(norm(v)));
 const colNumber=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
 for(const rows of Object.values(book)){const byRow=new Map(rows.map(r=>[r.r,r]));for(const r of rows){const cells=Object.entries(r.cells||{}).sort((a,b)=>colNumber(a[0])-colNumber(b[0]));for(let i=0;i<cells.length;i++){const [col,value]=cells[i],k=label(value),right=cells[i+1]?.[1],below=byRow.get(r.r+1)?.cells?.[col];
   if(['AINO','BINO','AIBINO','AINUMBER','BINUMBER'].includes(k)){for(const raw of [below,right]){const info=candidate(raw);if(info)candidates.push({...info,kind:k.startsWith('BI')?'BI':'AI'});}}
   if(k==='NICKNAME'){const value=text(right);if(value)nicknames.push(value);}
   if(['DEVICE','DEVICENO','DEVICENUMBER'].includes(k)){devices.push(...deviceList(right));if(!deviceList(right).length)devices.push(...deviceList(below));}
 }}}
 const unique=[...new Map(candidates.map(x=>[JSON.stringify(x),x])).values()],first=unique[0]||{number:'',revision:'',kind:'AI'};
 const list=[...new Set(devices.map(norm))],prefix=first.number.includes('-')?first.number.split('-')[0]:first.number.slice(0,3);
 return {...first,customer:prefix,devices:list,device:list.join(', '),ambiguous:unique.length>1,identitySource:'document',nickname:[...new Set(nicknames)].join(' / '),metadataVersion:2};
}
function revRank(v){const s=norm(v).replace(/^REV(?:ISION)?[ .:_-]*/,'');if(/^[A-Z]+$/.test(s))return [...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);if(/^\d+(?:\.\d+)*$/.test(s))return s.split('.').map(Number);return s;}
function compareRev(a,b){const x=revRank(a),y=revRank(b);if(typeof x==='number'&&typeof y==='number')return x-y;if(Array.isArray(x)&&Array.isArray(y)){for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}return 0;}return norm(a).localeCompare(norm(b),undefined,{numeric:true});}
function previous(records,r){return records.filter(x=>x.kind===r.kind&&norm(x.number)===norm(r.number)&&compareRev(x.revision,r.revision)<0).sort((a,b)=>compareRev(b.revision,a.revision)||String(b.updatedAtText).localeCompare(String(a.updatedAtText)))[0];}
function pack(book){return JSON.stringify(Object.entries(book).map(([name,rows])=>({name,rows,layout:rows.layout||{}})));}
function unpack(s){const book={};for(const x of JSON.parse(s)){if(!x.name||!Array.isArray(x.rows))throw Error('AI/BI 데이터 형식 오류');book[x.name]=x.rows;book[x.name].layout=x.layout;}return book;}
const lotValues=v=>Array.isArray(v)?v.flatMap(lotValues):v==null?[]:String(v).split(/[\r\n,;]+/).map(text).filter(Boolean);
function makeRow(source,id,data={}){return {source,id:String(id),customer:customer(data.customer),devices:[...new Set(lotValues(data.devices))],lots:[...new Set(lotValues(data.lots))],ai:text(data.ai),status:text(data.status),date:text(data.date),summary:text(data.summary),searchText:text(data.searchText),raw:data.raw||data};}
function identifierIn(s,q,partial=false){if(partial)return norm(s).includes(norm(q));const escaped=norm(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(^|[^A-Z0-9._-])'+escaped+'($|[^A-Z0-9._-])').test(norm(s));}
function matches(r,q){return (!q.customer||customer(r.customer)===customer(q.customer))&&(!q.device||r.devices.some(v=>norm(v).includes(norm(q.device))))&&(!q.lot||r.lots.some(v=>q.exactLot!==false?norm(v).replace(/\s+/g,'')===norm(q.lot).replace(/\s+/g,''):norm(v).replace(/\s+/g,'').includes(norm(q.lot).replace(/\s+/g,'')))||(r.source==='Daily Tracker'&&identifierIn(r.searchText,q.lot,q.exactLot===false)))&&(!q.ai||norm(r.ai).includes(norm(q.ai)));}
const field=(obj,names)=>{for(const [k,v]of Object.entries(obj||{}))if(names.includes(k.toLowerCase().replace(/[^a-z0-9]/g,'')))return v;return '';};
function issueRows(w,X,file){const out=[];for(const name of w.SheetNames){const rows=X.utils.sheet_to_json(w.Sheets[name],{header:1,defval:''});let header=-1,map={};for(let i=0;i<Math.min(rows.length,30);i++){map={};rows[i].forEach((v,c)=>{const k=norm(v).replace(/[^A-Z0-9]/g,'');if(['LOT','LOTNO','LOTID','LOTNUMBER'].includes(k))map.lot=c;if(['ISSUE','ISSUEDESCRIPTION','ISSUEDISCRIPTION','DESCRIPTION','ISSUESUMMARY','COMMENT'].includes(k))map.description=c;if(['CUSTOMER','CUST'].includes(k))map.customer=c;if(k==='NICKNAME'){const value=text(right);if(value)nicknames.push(value);}
   if(['DEVICE','DEVICENO','DEVICENUMBER'].includes(k))map.device=c;if(['AIBINO','AINO','BINO'].includes(k))map.ai=c;});if(map.lot!=null&&map.description!=null){header=i;break;}}
if(header<0)throw Error(name+': Lot No와 Issue Description 열을 찾지 못했습니다.');for(let i=header+1;i<rows.length;i++){const a=rows[i];if(!a.some(v=>text(v)))continue;const lot=text(a[map.lot]),description=text(a[map.description]);if(!lot||!description)throw Error(name+' '+(i+1)+'행: Lot / Issue Description 누락');out.push({id:JSON.stringify([customer(a[map.customer]),norm(a[map.device]),norm(lot),norm(a[map.ai]),description]),customer:customer(a[map.customer]),device:text(a[map.device]),lot,ai:text(a[map.ai]),description,file,sheet:name,row:i+1});}}return out;}
function issuesFor(r,issues){return issues.filter(i=>r.lots.some(l=>norm(l)===norm(i.lot))&&(!i.customer||!r.customer||customer(i.customer)===customer(r.customer))&&(!i.device||!r.devices.length||r.devices.some(d=>norm(d)===norm(i.device)))&&(!i.ai||!r.ai||norm(i.ai)===norm(r.ai)));}
const api={text,norm,customer,flatten,revisionInfo,identify,compareRev,previous,pack,unpack,makeRow,matches,field,issueRows,issuesFor};root.QACatalog=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

