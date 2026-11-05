const norm=v=>String(v??'').trim().toUpperCase().replace(/\s+/g,'');
export const issueKey=i=>'lot:'+norm(i.lot);
const time=i=>Date.parse(i.updatedAtText||'')||Number(i.uploadedAt?.seconds||0)*1000||0;
export function latestIssues(items){const map=new Map();for(const i of items){if(!norm(i.lot))continue;const k=issueKey(i),old=map.get(k);if(!old||time(i)>=time(old))map.set(k,{...i,id:k});}return [...map.values()];}
export function replaceIssues(existing,incoming){const stamp=new Date().toISOString(),map=new Map(latestIssues(existing).map(i=>[issueKey(i),i]));for(const i of incoming)map.set(issueKey(i),{...i,id:issueKey(i),updatedAtText:stamp});return [...map.values()];}
