import {connection,hash} from './qa-cloud.js';
import {doc,collection,getDoc,getDocs,setDoc,runTransaction} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

export async function publish(kind,key,value,missingOnly=false){
 const db=await connection(), ref=doc(db,kind,await hash(key));
 const data=JSON.stringify(value),digest=await hash(data), existing=await getDoc(ref);
 if(existing.exists()&&(missingOnly||existing.data().digest===digest))return;
 const parts=Math.ceil(data.length/80000);
 for(let i=0;i<parts;i++){
  await setDoc(doc(ref,'parts',digest+'-'+i),{text:data.slice(i*80000,(i+1)*80000)});
 }
 await runTransaction(db,async tx=>{
  const current=await tx.get(ref);
  if(!missingOnly||!current.exists())tx.set(ref,{key,digest,parts});
 });
}
export async function history(kind){
 const db=await connection(), heads=await getDocs(collection(db,kind)), records=[];
 for(const head of heads.docs){
  const {digest,parts}=head.data();
  const slices=await Promise.all(Array.from({length:parts},(_,i)=>getDoc(doc(head.ref,'parts',digest+'-'+i))));
  const text=slices.map(s=>s.data().text).join('');
  if(await hash(text)!==digest)throw Error('보고서 무결성 확인 실패');
  records.push(JSON.parse(text));
 }
 return records;
}
