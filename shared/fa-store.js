(function(root){
'use strict';const KEY='qa-fa-history-v1',norm=v=>String(v??'').toUpperCase().replace(/\s+/g,''),copy=v=>JSON.parse(JSON.stringify(v));let versions=[];
function validate(v){if(!v?.id||!v.requestId||!v.record||v.record.schema!==1||!Array.isArray(v.record.lots)||!Array.isArray(v.record.units)||!Array.isArray(v.record.summaries))throw Error('FA 이력 형식 오류');return v;}
function reload(){const data=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(data))throw Error('FA 저장 형식 오류');versions=data.map(validate);return versions;}
function merge(incoming){const m=new Map(versions.map(v=>[v.id,v]));for(const v of incoming)m.set(validate(v).id,copy(v));const next=[...m.values()];localStorage.setItem(KEY,JSON.stringify(next));versions=next;return versions;}
function latest(){const m=new Map();for(const v of versions){const old=m.get(v.requestId);if(!old||String(v.savedAtText)>String(old.savedAtText)||(v.savedAtText===old.savedAtText&&v.revision>old.revision))m.set(v.requestId,v);}return [...m.values()].sort((a,b)=>String(b.record.date).localeCompare(String(a.record.date))||b.savedAtText.localeCompare(a.savedAtText));}
function forLot(lot,customer=''){return latest().filter(v=>(!customer||norm(v.record.customer)===norm(customer))&&v.record.lots.some(l=>norm(l)===norm(lot)));}
function init(seed=[]){reload();const added=seed.filter(s=>!versions.some(v=>v.id===s.id));if(added.length)merge(added);return latest();}
root.FAStore={KEY,init,reload,merge,latest,forLot,all:()=>copy(versions),validate};
if(typeof module!=='undefined')module.exports=root.FAStore;
})(typeof globalThis!=='undefined'?globalThis:this);
