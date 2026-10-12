import { mtkYieldFirebaseConfig } from '../../shared/firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth,signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getFirestore,collection,getDocs,query,limit,doc,writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
const app=initializeApp(mtkYieldFirebaseConfig,'mnt-hold-list'),db=getFirestore(app),auth=getAuth(app),NAME='mntHoldLotEvents';let ready;
function connect(){return ready||(ready=signInAnonymously(auth).catch(e=>{ready=null;throw e;}));}
async function id(key){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function save(events){await connect();for(let i=0;i<events.length;i+=400){const batch=writeBatch(db);for(const e of events.slice(i,i+400))batch.set(doc(db,NAME,await id(e.id)),{event:JSON.stringify(e),lot:e.lot});await batch.commit();}}
export async function load(){await connect();const snap=await getDocs(collection(db,NAME));return snap.docs.map(d=>JSON.parse(d.data().event));}
export async function deleteAll(progress){await connect();let count=0;while(true){const snap=await getDocs(query(collection(db,NAME),limit(400)));if(snap.empty)break;const batch=writeBatch(db);snap.docs.forEach(d=>batch.delete(d.ref));await batch.commit();count+=snap.size;progress(count);}return count;}
