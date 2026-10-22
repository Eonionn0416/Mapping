(function(root){
'use strict';
const text=v=>String(v??'').replace(/\u00a0/g,' ').trim(),norm=v=>text(v).toUpperCase().replace(/\s+/g,''),key=v=>norm(v).replace(/[^A-Z0-9가-힣]/g,''),clone=v=>JSON.parse(JSON.stringify(v));
const TESTS=['Visual inspection','X-Ray','3D X-Ray','IV Curve Trace','P-Lap(SEM)','Decap(SEM)','X-section(SEM)','EDX','Die level IV'];
const lots=v=>[...new Set((text(v).match(/\b[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*\.\d+(?:\s*[A-Z](?![A-Z0-9]))?/gi)||[]).map(norm))];
const binKey=v=>{const m=norm(v).match(/^(?:HBIN|BIN|B)(\d+)$/);return m?'B'+Number(m[1]):norm(v)==='JAM'?'JAM':'';};
function excelDate(v,X){if(typeof v==='number'){const d=X.SSF.parse_date_code(v);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:'';}return text(v).slice(0,10);}
function read(w,X,file){
 const name=w.SheetNames.find(n=>!/예시|example/i.test(n)&&/FA|분석/i.test(n))||w.SheetNames[0],s=w.Sheets[name],rows=X.utils.sheet_to_json(s,{header:1,defval:'',blankrows:true}),v=a=>s[a]?.v??'',warnings=[];
 const fields={department:text(v('I3')),requester:text(v('I4')),sampleDate:excelDate(v('I6'),X),background:text(v('E10')),relCondition:text(v('E11')),failureOrigin:text(v('E14')),failMode:text(v('E15')),pinInformation:text(v('E16')),pcbVendor:text(v('E17')),shipping:text(v('E18')),failRate:text(v('E19')),processIssue:text(v('E26')),remark:text(v('E27'))};
 const record={schema:1,customer:text(v('E9')),devices:text(v('E12')).split(/[,;\r\n]+/).map(text).filter(Boolean),lots:lots(v('E13')),date:excelDate(v('I2'),X),sampleQtyText:text(v('I5')),mode:/\bNDFA\b/i.test(fields.remark)?'NDFA':/\bDFA\b/i.test(fields.remark)?'DFA':/\bNDFA\b/i.test(file)?'NDFA':/\bDFA\b/i.test(file)?'DFA':'',status:'Requested',fields,summaries:[],units:[],warnings,sourceFile:file,sourceSheet:name,sourceCells:Object.fromEntries(Object.entries(s).filter(([a,c])=>!a.startsWith('!')&&(c.v!==undefined||c.f)).map(([a,c])=>[a,c.f?'='+c.f:c.v]))};
 for(let r=0;r<rows.length;r++){
  const a=rows[r],k=a.map(key),lotCol=k.findIndex(x=>['LOTID','LOTNO','LOT','LOTNUMBER'].includes(x)),inputCol=k.findIndex(x=>['INQTY','QTYIN','RCVQTY','INPUTQTY'].includes(x));
  if(lotCol<0||inputCol<0)continue;
  for(let j=r+1;j<rows.length;j++){
   const b=rows[j],id=lots(b[lotCol])[0];if(!id){if(b.some(x=>text(x)))break;continue;}
   const result={device:'',lot:id,flow:'',retest:'',input:'',good:'',fail:'',yield:'',bins:{},extra:{}};
   a.forEach((h,c)=>{if(!text(h))return;const z=key(h),value=b[c]??'',bin=binKey(h);if(bin)result.bins[bin]=value;else if(['DEVICE','CUSTDEVICE','DEVICENO'].includes(z))result.device=text(value);else if(['FLOW','PROCESS','공정'].includes(z))result.flow=text(value);else if(z==='RETEST')result.retest=text(value);else if(c===inputCol)result.input=value;else if(z==='GOOD')result.good=value;else if(z==='FAIL')result.fail=value;else if(z==='YIELD')result.yield=value;else if(c!==lotCol)result.extra[text(h)]=value;});
   if(result.good===''&&result.bins.B1!==undefined)result.good=result.bins.B1;
   record.summaries.push(result);
  }
 }
 // Historical unit tables: keep pins and all existing analysis columns; never infer FA conclusions.
 for(let r=0;r<rows.length;r++){
  const a=rows[r],k=a.map(key),uc=k.indexOf('UNIT'),pc=k.indexOf('FAILPIN');if(pc<0)continue;
  if(uc>=0){for(let j=r+1;j<rows.length;j++){const b=rows[j],label=text(b[uc]);if(!/^UNIT\s*#?\s*\d+$/i.test(label)){if(label)break;continue;}const results={};a.forEach((h,c)=>{if(c!==uc&&c!==pc&&text(h)&&text(b[c]))results[text(h)]=text(b[c]);});record.units.push({id:'source-'+(j+1),sourceUnit:label,lot:record.lots.length===1?record.lots[0]:'',failPin:text(b[pc]),results});}}
  else {const lc=k.findIndex(x=>['LOT','LOTID','LOTNO'].includes(x)),qc=k.findIndex(x=>['수량','QTY','QUANTITY'].includes(x));if(lc<0)continue;
   for(let j=r+1;j<rows.length;j++){const b=rows[j],id=lots(b[lc])[0];if(!id){if(b.some((x,c)=>c<pc&&text(x)))break;continue;}const qty=Math.max(1,Number(b[qc])||1);for(let q=0;q<qty;q++)record.units.push({id:'source-'+(j+1)+'-'+q,sourceUnit:'UNIT#'+(q+1),lot:id,failPin:text(rows[j+q]?.[pc]).replace(/^\d+\.\s*/,''),results:{}});}
  }
 }
 if(w.Sheets['FA Unit Link']){const link=X.utils.sheet_to_json(w.Sheets['FA Unit Link'],{header:1,defval:''});for(const r of link.slice(1)){const u=record.units.find(u=>norm(u.sourceUnit)===norm(r[0]));if(!u)continue;u.lot=norm(r[1]);if(text(r[2]))u.mapping={historyId:text(r[3]),historyTitle:'저장된 Unit 연결',sourceIndex:Number(r[4])-1,lot:u.lot,unitId:text(r[2]),stripId:text(r[5]),x:r[6],y:r[7],waferId:text(r[8]),waferX:r[9],waferY:r[10]};}}
 record.embeddedMapping=[];
 for(let r=0;r<rows.length;r++){const k=rows[r].map(key),uc=k.indexOf('UNITID'),lc=k.indexOf('LOTID');if(uc<0||lc<0)continue;
  for(let j=r+1;j<rows.length;j++){const b=rows[j];if(!text(b[uc]))break;const raw={};rows[r].forEach((h,c)=>{if(text(h))raw[text(h)]=b[c]??'';});raw.__idx=record.embeddedMapping.length;record.embeddedMapping.push(raw);
   const seq=Number(b[rows[r].findIndex(v=>text(v)==='#')]);const u=record.units.find(u=>Number((u.sourceUnit.match(/\d+/)||[])[0])===seq);
   if(u&&text(raw['UNIT ID']))u.mapping={historyId:'embedded',historyTitle:'첨부 원본 2DID',sourceIndex:raw.__idx,lot:norm(raw['LOT ID']),unitId:text(raw['UNIT ID']),stripId:text(raw['STRIP ID']),x:raw.X??'',y:raw.Y??'',waferId:text(raw['WAFER ID']),waferX:raw['WAFER COL']??'',waferY:raw['WAFER ROW']??'',fail:Number(raw.Fail)||0};
  }
 }
 const requested=lots(fields.remark),sampleLots=[...new Set(record.units.map(u=>u.lot).filter(Boolean))],primary=record.lots.slice();
 if(requested.length)record.lots=requested;else if(sampleLots.length)record.lots=sampleLots;
 if(!record.lots.length)record.lots=[...new Set(record.summaries.map(s=>s.lot))];
 if(requested.length){if(primary.some(l=>!requested.includes(l)))warnings.push('본문 Lot과 Remark의 FA 대상 Lot이 다릅니다. Remark를 우선 적용했습니다.');record.units=record.units.filter(u=>!u.lot||requested.includes(u.lot));}
 if(record.lots.length===1)record.units.forEach(u=>{if(!u.lot)u.lot=record.lots[0];});
 const qty=Number((record.sampleQtyText.match(/\d+/)||[])[0]);if(qty&&record.units.length!==qty)warnings.push(`의뢰 수량 ${qty}개 / 대상 Unit 표 ${record.units.length}개: 원본 확인 필요`);
 const filenameQty=file.match(/(\d+)\s*ea/i);if(filenameQty&&qty&&Number(filenameQty[1])!==qty)warnings.push(`파일명 ${filenameQty[1]}ea / 문서 내부 ${qty}ea: 대상 Unit 확인 필요. 원본 표를 보존했습니다.`);
 const filenameDate=file.match(/(20\d{2})[_-](\d{2})[_-](\d{2})/);if(filenameDate&&record.date&&filenameDate.slice(1).join('-')!==record.date)warnings.push('파일명 날짜와 문서 내부 요청 일자가 다릅니다. 문서 내부 날짜를 저장했습니다.');
 if(!record.devices.length||!record.lots.length)throw Error(file+': Device / Lot을 찾지 못했습니다. 기본양식은 이력으로 등록하지 않습니다.');
 return record;
}
function orderedUnits(units){const historyOrder=[...new Set(units.filter(u=>u.mapping).map(u=>u.mapping.historyId))];return units.map((u,i)=>({...u,_order:i})).sort((a,b)=>{if(a.mapping&&b.mapping)return historyOrder.indexOf(a.mapping.historyId)-historyOrder.indexOf(b.mapping.historyId)||a.mapping.sourceIndex-b.mapping.sourceIndex;return a.mapping?-1:b.mapping?1:a._order-b._order;}).map(({_order,...u},i)=>({...u,number:i+1}));}
function mappings(rows,history,requestedLots,query=''){const wanted=requestedLots.map(norm),q=norm(query),seen=new Set();return rows.map((r,i)=>({historyId:history.id,historyTitle:history.title||history.id,sourceIndex:Number.isFinite(Number(r.__idx))?Number(r.__idx):i,lot:norm(r['LOT ID']),unitId:text(r['UNIT ID']),stripId:text(r['STRIP ID']),x:r.X??'',y:r.Y??'',waferId:text(r['WAFER ID']),waferX:r['WAFER COL']??'',waferY:r['WAFER ROW']??'',fail:Number(r.Fail)||0})).filter(r=>{const k=JSON.stringify([r.historyId,r.sourceIndex,r.unitId]);if(!r.unitId||seen.has(k))return false;seen.add(k);return wanted.includes(r.lot)&&(!q||norm(r.unitId).includes(q));}).sort((a,b)=>a.sourceIndex-b.sourceIndex);}
const bins=record=>[...new Set(record.summaries.flatMap(s=>Object.keys(s.bins||{})))].sort((a,b)=>(Number(a.slice(1))||Infinity)-(Number(b.slice(1))||Infinity));
const matches=(r,q)=>!q||norm([r.customer,r.devices.join(' '),r.lots.join(' '),r.sourceFile,r.mode,r.status,r.fields?.background].join(' ')).includes(norm(q));
const api={text,norm,key,lots,binKey,read,orderedUnits,mappings,bins,matches,TESTS,clone};root.FACore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
