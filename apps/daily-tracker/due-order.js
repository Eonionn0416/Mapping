(function(root){
function key(value,today){const text=String(value||'').trim(),m=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);if(!m)return [2,Infinity];const date=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));if(date.getFullYear()!=+m[1]||date.getMonth()!=+m[2]-1||date.getDate()!=+m[3])return [2,Infinity];const t=new Date(today.getFullYear(),today.getMonth(),today.getDate());return [date<t?0:1,date.getTime()];}
function compare(a,b,today=new Date()){const x=key(a.dueDate,today),y=key(b.dueDate,today);return x[0]-y[0]||(x[1]===y[1]?0:x[1]-y[1]);}
function groups(groups,today=new Date()){return groups.map(g=>({...g,ongoing:[...g.ongoing].sort((a,b)=>compare(a,b,today)),other:[...g.other].sort((a,b)=>compare(a,b,today))})).sort((a,b)=>compare(a.ongoing[0]||a.other[0]||{},b.ongoing[0]||b.other[0]||{},today));}
function active(input,today=new Date()){const result=[];for(const priority of [0,1,2]){const part=input.map(g=>({...g,ongoing:g.ongoing.filter(r=>key(r.dueDate,today)[0]===priority),done:[]})).filter(g=>g.ongoing.length).sort((a,b)=>compare(a.ongoing[0],b.ongoing[0],today));result.push(...part);}return result;}
root.DailyDueOrder={compare,groups,active};if(typeof module!=='undefined')module.exports=root.DailyDueOrder;
})(globalThis);
