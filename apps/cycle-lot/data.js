import {history,publish} from '../../shared/report-history.js';
const collection='qaSanCycleSnapshots';
const str=v=>String(v??'').trim();
function day(v){
 if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);return d?[d.y,d.m,d.d].map((s,i)=>String(s).padStart(i?2:4,'0')).join('-'):''}
 const m=str(v).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);return m?m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'):'';
}
export function parse(matrix,san){
 const at=matrix.findIndex(row=>row.some(c=>str(c)===(san?'SCK LOT ID':'OPER_IN_TIME')));
 if(at<0)throw Error('보고서 열을 확인하세요.');
 const keys=matrix[at].map(str),rows=[];
 for(const cells of matrix.slice(at+1)){
 const get=k=>cells[keys.indexOf(k)],lot=str(get(san?'SCK LOT ID':'LOT_ID')),start=get(san?'ASSY/TEST start date':'OPER_IN_TIME'),date=day(start);
 if(!lot||!date)continue;
 const base={lot,date,start:typeof start==='number'?date:str(start),customer:san?'SAN2':str(get('CUST_ID')),device:str(get(san?'PN':'CUST_DEVICE')),qty:str(get(san?'WO/RECEIVE QTY':'CUR_QTY')),wafer:str(get('WO/WAFER_LOT'))};
 function add(process,v){if(process&&str(v)!==''&&Number.isFinite(Number(v)))rows.push({...base,process,ct:Number(v)})}
 if(san){for(let i=keys.indexOf('STATUS')+1;i<keys.indexOf('Cycle_Time');i++)add(keys[i],cells[i])}
 else add(str(get('OPER')),get('CT(Days)'));
 }
 return rows;
}
export async function ingest(file,item){
 const san=/^Sandisk_Cycle_Time REPORT_/i.test(file.name);
 if(!san&&!/^Cycle_Time_Lot_/i.test(file.name))throw Error('Cycle time 보고서를 선택하세요.');
 const wb=san?XLSX.read(await file.arrayBuffer(),{type:'array'}):XLSX.read(await file.text(),{type:'string',raw:true});
 const sheet=san?wb.SheetNames.find(n=>n.trim().toUpperCase()==='CYCLE TIME REPORT'):wb.SheetNames[0];
 if(!sheet)throw Error('보고서 시트를 찾지 못했습니다.');
 const rows=parse(XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:''}),san);
 if(!rows.length)throw Error('저장할 공정 기록이 없습니다.');
 const received=item?.receivedAt||new Date(file.lastModified).toISOString(),stamp=file.name.match(/_(\d{8}|\d{4})(?=[ _.])/i)?.[1];
 if(!stamp)throw Error('파일명에서 보고일을 확인할 수 없습니다.');
 let year=Number(received.slice(0,4));if(stamp.length===4&&stamp.startsWith('12')&&received.slice(5,7)==='01')year--;
 const reportDay=stamp.length===8?stamp:String(year)+stamp;
 await publish(collection,(san?'SAN2':'CT')+reportDay,{san,reportDay,rows});
}
export async function load(san){
 const snapshots=(await history(collection)).filter(s=>s.san===san).sort((a,b)=>a.reportDay.localeCompare(b.reportDay));
 const records=new Map();for(const s of snapshots)for(const r of s.rows)records.set(JSON.stringify([r.customer,r.lot,r.process,r.start]),r);
 return [...records.values()];
}
