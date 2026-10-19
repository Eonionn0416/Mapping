// IndexedDB retains the original workbook across refreshes without localStorage size limits.
export async function fileCache(name,value,revision=''){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('rel-workbooks-v2',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',value?'readwrite':'readonly'),store=tx.objectStore('files');const r=value?store.put({buffer:value,revision},name):store.get(name);let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
