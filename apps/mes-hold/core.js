export function episodes(events){
 const groups=new Map();
 for(const e of events){
 const key=JSON.stringify([e.customer.trim().toUpperCase(),e.lot.trim().replace(/\s+/g,' ').toUpperCase(),e.start]);
 const row=groups.get(key)||{};
 if(e.kind==='release'){if(!row.release||e.end>row.release.end)row.release=e}
 else row.hold=e;
 groups.set(key,row);
 }
 return [...groups.values()].map(({hold,release})=>({...release,...hold,end:release?.end||'',qty:hold?.qty==null||hold.qty===''?null:Number(String(hold.qty).replaceAll(',','')),reason:hold?.reason||'',code:hold?.code||''}));
}
export function dateOf(stamp){return stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8)}
export function age(r,date){return Math.floor((Date.parse(date)-Date.parse(dateOf(r.start)))/86400000)}
export function remaining(rows,date){return rows.filter(r=>dateOf(r.start)<=date&&(!r.end||dateOf(r.end)>date)).sort((a,b)=>a.start.localeCompare(b.start))}
export function summary(rows){
 const groups=new Map();
 for(const r of rows){const date=dateOf(r.start),key=JSON.stringify([date,r.customer]);if(!groups.has(key))groups.set(key,{date,customer:r.customer,rows:[]});groups.get(key).rows.push(r)}
 const qty=list=>list.some(r=>!Number.isFinite(r.qty))?'—':list.reduce((s,r)=>s+r.qty,0);
 const lots=list=>new Set(list.map(r=>r.lot)).size;
 return [...groups.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.customer.localeCompare(b.customer)).map(g=>{const released=g.rows.filter(r=>r.end),active=g.rows.filter(r=>!r.end);return [g.date,g.customer,lots(g.rows),qty(g.rows),lots(released),qty(released),lots(active),qty(active)]});
}
export function balances(rows, today) {
 const customers = new Map();
 const totals = new Map();
 const summaryRows = [];
 const qty = entries => entries.some(r => !Number.isFinite(r.qty)) ? '—' : entries.reduce((n,r) => n + r.qty, 0);
 const count = entries => new Set(entries.map(r => r.lot.trim().toUpperCase())).size;
 for (const r of rows) {
  if (!customers.has(r.customer)) customers.set(r.customer,new Map());
  const calendar = customers.get(r.customer);
  for (const [event, stamp] of [['holds',r.start],['releases',r.end]]) {
   if (!stamp) continue;
   const day = dateOf(stamp);
   if (day > today) continue;
   if (!calendar.has(day)) calendar.set(day,{holds:[],releases:[]});
   calendar.get(day)[event].push(r);
  }
 }
 for (const [customer,calendar] of customers) {
  const first = [...calendar.keys()].sort()[0];
  if (!first) continue;
  const active = new Set();
  for (let time = Date.parse(first); time <= Date.parse(today); time += 86400000) {
   const day = new Date(time).toISOString().slice(0,10);
   const {holds=[], releases=[]} = calendar.get(day) || {};
   const opening = count([...active]);
   for (const r of holds) active.add(r);
   for (const r of releases) active.delete(r);
   const closing = count([...active]);
   const total = totals.get(day) || {day, holds:0, releases:0, closing:0};
   total.holds += count(holds);
   total.releases += count(releases);
   total.closing += closing;
   totals.set(day,total);
   if (opening || holds.length || releases.length) summaryRows.push([day,customer,opening,count(holds),qty(holds),count(releases),qty(releases),closing,qty([...active])]);
  }
 }
 return {days:[...totals.values()].sort((a,b)=>a.day.localeCompare(b.day)),summaryRows:summaryRows.sort((a,b)=>b[0].localeCompare(a[0]) || a[1].localeCompare(b[1]))};
}
