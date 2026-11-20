import * as C from './equipment-core.js?v=118';
import {connection,rows,hash} from './qa-cloud.js';
import {doc,writeBatch} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
let pending=null,cache=[];
function db(){return new Promise((ok,no)=>{const r=indexedDB.open('QAEquipment',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
async function local(incoming){const d=await db();try{return await new Promise((ok,no)=>{const t=d.transaction('records',incoming?'readwrite':'readonly'),s=t.objectStore('records');let out=[];if(incoming)for(const r of incoming)s.put({...r,key:JSON.stringify([r.id,r.date])});else {const q=s.getAll();q.onsuccess=()=>out=q.result;}t.oncomplete=()=>ok(out);t.onerror=()=>no(t.error);t.onabort=()=>no(t.error);});}finally{d.close();}}
export async function load(force=false){if(pending&&!force)return pending;pending=(async()=>{cache=C.merge(await local());try{cache=C.merge(cache,await rows('equipmentRecords'));await local(cache);return {records:cache,error:''};}catch(e){return {records:cache,error:'Firestore 조회 실패: '+e.message};}})();return pending;}
export async function ingest(file){const incoming=C.parse(await file.text(),file.name),all=C.merge(await local(),incoming);await local(all);cache=all;pending=null;const db=await connection();for(let i=0;i<incoming.length;i+=300){const b=writeBatch(db);for(const r of incoming.slice(i,i+300)){const saved=all.find(x=>x.id===r.id&&x.date===r.date);b.set(doc(db,'equipmentRecords',await hash(JSON.stringify([r.id,r.date]))),saved);}await b.commit();}window.dispatchEvent(new Event('qa-equipment-updated'));return incoming.length;}
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Commonality owns this database and its migrations.
function readCycleWindows() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('QACommonalityCycle');
    let missing = false;
    open.onupgradeneeded = () => {
      missing = true;
      open.transaction.abort();
    };
    open.onerror = () => missing ? resolve([]) : reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const read = db.transaction('windows').objectStore('windows').getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      } catch (error) {
        reject(error);
      } finally {
        db.close();
      }
    };
  });
}

const operations = new Map('S01:D/B N11:AIN 2:W/I 14:LMN 3:B/G 8:L/G 10:D/S 20:2ND 438:SAU 80:SPP 25:CCM 441:C/A 451:DFX 67:PB2 94:PSU 95:U/F 96:UFC 60:3RD 66:A/M 87:PS3 100:M/D 105:PMC 202:LM2 140:SDA 141:SDC 203:LMK 495:PCI 503:LSC 500:SBM 510:SGN 512:ICO 290:EVI S31:S31'.split(' ').map(pair => pair.split(':')));
const operationCodes = new Map([...operations].map(([code, name]) => [name, code]));
const processCode = value => operationCodes.get(C.norm(value)) || C.norm(value).replace(/^0+(?=\d)/, '');
const lotKey = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const parentLot = lot => lot.replace(/\s+\d{1,3}$/, '');
const windowKey = (lot, process) => JSON.stringify([lot, process]);

function neighborStats(group, time, hours) {
  if (!group?.length || !Number.isFinite(time) || !Number.isFinite(hours)) return null;
  function boundary(after) {
    let low = 0, high = group.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (group[mid].time < time || (after && group[mid].time === time)) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  const first = boundary(false), last = boundary(true);
  const before = group.slice(Math.max(0, first - 20), first);
  const after = group.slice(last, last + 20);
  const {mean, sd} = C.describe([...before, ...after].map(r => r.hours));
  const delta = mean === null ? null : hours - mean;
  return {before:before.length, after:after.length, mean, delta, z:sd > 0 ? delta / sd : null};
}

function lotWindows(customer, lots, equipment, cycles) {
  const wanted = new Set(lots.map(lotKey).filter(Boolean));
  const targetCustomer = C.customer(customer);
  const relevant = lot => wanted.has(lot) || wanted.has(parentLot(lot));
  const times = new Map(), tools = new Map(), groups = new Map(), display = new Map();
  for (const row of cycles) {
    if (C.customer(row.customer) !== targetCustomer) continue;
    const lot = lotKey(row.lot), process = processCode(row.process);
    const key = windowKey(lot, process), old = times.get(key);
    if (old && old.rev > row.rev) continue;
    const time = Date.parse(String(row.start || '').replaceAll('/', '-').replace(' ', 'T') + '+09:00');
    times.set(key, {...row, lot, process, time});
  }
  for (const row of C.latest(equipment)) {
    if (C.customer(row.customer) !== targetCustomer) continue;
    const lot = lotKey(row.lot), process = processCode(row.process), key = windowKey(lot, process);
    const old = tools.get(key);
    if (old && old.date > row.date) continue;
    const machines = old?.date === row.date ? [...old.machines, ...row.machines] : row.machines;
    tools.set(key, {...row, lot, process, machines:[...new Set(machines)].sort()});
  }
  for (const [key, row] of times) {
    if (Number.isFinite(row.time) && Number.isFinite(row.hours) && row.hours >= 0) {
      if (!groups.has(row.process)) groups.set(row.process, []);
      groups.get(row.process).push(row);
    }
    if (relevant(row.lot)) display.set(key, row);
  }
  const childrenByParent = new Map();
  for (const lot of wanted) {
    const parent = parentLot(lot);
    if (parent === lot) continue;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(lot);
  }
  for (const [key, row] of tools) {
    if (relevant(row.lot) && !display.has(key)) display.set(key, {lot:row.lot, process:row.process});
    // A split Lot can inherit equipment reported only against its parent.
    for (const child of childrenByParent.get(row.lot) || []) {
      const childKey = windowKey(child, row.process);
      if (!display.has(childKey)) display.set(childKey, {lot:child, process:row.process});
    }
  }
  for (const group of groups.values()) group.sort((a,b) => a.time - b.time || a.lot.localeCompare(b.lot));
  return [...display.values()].sort((a,b) => a.lot.localeCompare(b.lot) || (a.time || Infinity) - (b.time || Infinity) || a.process.localeCompare(b.process, 'en', {numeric:true})).map(row => {
    const machine = tools.get(windowKey(row.lot, row.process)) || tools.get(windowKey(parentLot(row.lot), row.process));
    return {...row, machine, stats:neighborStats(groups.get(row.process), row.time, row.hours)};
  });
}

export async function show(host, customer, lots) {
  const title = document.createElement('h3'), note = document.createElement('p');
  title.textContent = '공정별 사용 장비 · Window time';
  note.textContent = 'Lot 이력 조회 중…';
  host.replaceChildren(title, note);
  const token = Symbol();
  host._equipmentToken = token;
  const [equipment, cycles] = await Promise.allSettled([load(), readCycleWindows()]);
  if (host._equipmentToken !== token || !host.isConnected) return;
  const records = equipment.value?.records || [], windows = cycles.value || [];
  const matches = lotWindows(customer, lots, records, windows);
  const messages = [];
  if (equipment.status === 'rejected') messages.push('장비 이력 조회 실패');
  else if (equipment.value.error) messages.push(equipment.value.error);
  if (cycles.status === 'rejected') messages.push('Cycle time 이력 조회 실패');
  else if (!windows.length) messages.push('Commonality에서 Cycle time 보고서를 가져오면 Window time을 확인할 수 있습니다.');
  if (!matches.length) messages.push('검색한 Lot의 공정 이력이 없습니다.');
  else messages.unshift('같은 고객·공정의 In 시각 기준 직전·직후 각 최대 20 Lot과 비교합니다. 차이(+)는 비교 평균보다 오래 걸린 시간입니다.');
  note.textContent = messages.join(' ');
  if (!matches.length) return;
  const panel = document.createElement('div');
  panel.style.cssText = 'overflow:auto;max-height:400px;margin-top:12px';
  const headers = ['Lot','공정','사용 장비','장비 보고일','In','Out','Window (h)','직전 / 직후 Lot 수','비교 평균 (h)','평균과 차이 (h)','표준편차 단위 (σ)'];
  const number = (value, signed = false) => Number.isFinite(value) ? (signed && value > 0 ? '+' : '') + value.toLocaleString('ko-KR',{maximumFractionDigits:4}) : '—';
  const body = matches.map(row => {
    const {machine, stats} = row;
    let label = machine?.machines.join(' · ') || '—';
    if (machine && machine.lot !== row.lot) label += ' (모 Lot ' + machine.lot + ')';
    const cells = [row.lot, [row.process, operations.get(row.process)].filter(Boolean).join(' · '), label, machine?.date, row.start, row.end, number(row.hours), stats ? stats.before + ' / ' + stats.after : '—', number(stats?.mean), number(stats?.delta,true), number(stats?.z,true)];
    return '<tr>' + cells.map(value => '<td>' + esc(value || '—') + '</td>').join('') + '</tr>';
  });
  panel.innerHTML = '<table><thead><tr>' + headers.map(h => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + body.join('') + '</tbody></table>';
  host.append(panel);
}
