async function store(mode,run){
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('qa-mnt-yield-originals-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('files',{keyPath:'name'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',mode),q=run(tx.objectStore('files'));tx.oncomplete=()=>resolve(q.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export const keep=async file=>store('readwrite',s=>s.put({name:file.name,type:file.type,buffer:file.buffer||null}));
export const get=name=>store('readonly',s=>s.get(name));
export const list=()=>store('readonly',s=>s.getAllKeys());
export function download(name,buffer,type){const url=URL.createObjectURL(new Blob([buffer],{type:type||'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
