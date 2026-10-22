(function(root){
const norm=v=>String(v??'').toUpperCase().replace(/\s+/g,''),num=v=>Number((String(v??'').match(/\d+/)||[])[0])||null;
function readReferences(w,X){const out=[];for(const name of w.SheetNames){const rows=X.utils.sheet_to_json(w.Sheets[name],{header:1,defval:''});const i=rows.findIndex(r=>r.some(v=>['#','NO#'].includes(norm(v)))&&r.some(v=>norm(v)==='UNITID'));if(i<0)continue;const h=rows[i].map(norm),n=h.findIndex(v=>['#','NO#'].includes(v)),l=h.indexOf('LOTID'),u=h.indexOf('UNITID');for(const r of rows.slice(i+1)){if(num(r[n])&&r[u]&&r[l])out.push({number:num(r[n]),lot:norm(r[l]),baseLot:norm(String(r[l]).replace(/\s+\d+$/,'')),unitId:String(r[u]).trim()});}}return out;}
function preview(record,rows,history){return record.units.map(u=>{const number=num(u.sourceUnit),base={id:u.id,sourceUnit:u.sourceUnit||'번호 미기재',failPin:u.failPin},lot=norm(u.lot);if(!number)return {...base,reason:'원본 Unit # 없음'};
 const explicit=(record.unitReferences||[]).filter(r=>r.number===number&&(norm(r.lot)===lot||norm(r.baseLot)===lot));
 const embedded=(record.embeddedMapping||[]).filter(r=>num(r['#']??r['No#'])===number&&norm(r['LOT ID'])===lot).map(r=>({unitId:r['UNIT ID'],lot:norm(r['LOT ID'])}));
 const known=(root.QAUnitNumbers||[]).filter(r=>r.number===number&&(norm(r.lot)===lot||norm(r.baseLot)===lot));
 const prior=u.mapping?.unitId?[{unitId:u.mapping.unitId,lot:u.mapping.lot}]:[];
 const refs=explicit.length?explicit:embedded.length?embedded:known.length?known:prior;
 const ids=[...new Set(refs.map(r=>norm(r.unitId)))];if(ids.length>1)return {...base,reason:'원본 # 중복: 확인 필요'};
 const found=rows.filter(r=>(ids.length?refs.some(ref=>norm(ref.lot)===norm(r['LOT ID']))&&norm(r['UNIT ID'])===ids[0]:norm(r['LOT ID'])===lot&&num(r['#']??r['No#'])===number));
 if(found.length!==1)return {...base,reason:found.length?'Mapping 중복: 확인 필요':ids.length?'해당 2DID가 선택 이력에 없음':'고유번호 정보 없음: 원본 # 확인 또는 위치 선택'};
 const r=found[0];if(!r['UNIT ID'])return {...base,reason:'2DID 없음'};
 return {...base,reason:'일치',mapping:{historyId:history.id,historyTitle:history.title,sourceNumber:number,sourceIndex:Number(r.__idx)||rows.indexOf(r),lot:norm(r['LOT ID']),unitId:String(r['UNIT ID']),stripId:r['STRIP ID']||'',x:r.X??'',y:r.Y??'',waferId:r['WAFER ID']||'',waferX:r['WAFER COL']??'',waferY:r['WAFER ROW']??'',fail:Number(r.Fail)||0}};
 });}
const api={readReferences,preview};root.FALink=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
