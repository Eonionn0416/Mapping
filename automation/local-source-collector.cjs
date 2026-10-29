const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DEFAULT_BASE='C:/System project/QA System File uploader';
const DEFAULT_REL='C:/Users/seungeon.kim/OneDrive - 江苏长电科技股份有限公司/문서/SCK/[4] Reliability Schedule';
const DEFAULT_HOLD='C:/Users/seungeon.kim/Desktop/MNT Hold list.xlsx';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function selectLatest(names){const chosen=new Map();for(const name of names){const m=/^Rel test plan for\s+([A-Z]+)[ _-]?(\d{2})(\d{2})\.xls[xm]$/i.exec(name);if(!m||+m[3]<1||+m[3]>53)continue;const customer=m[1].toUpperCase(),period=+m[2]*100+(+m[3]);const old=chosen.get(customer);if(!old||period>old.period||period===old.period&&name.localeCompare(old.name)>0)chosen.set(customer,{customer,period,name});}return [...chosen.values()].sort((a,b)=>a.customer.localeCompare(b.customer));}
function writeAtomic(file,bytes,tempDir=path.dirname(file)){const temp=path.join(tempDir,path.basename(file)+'.'+crypto.randomUUID()+'.partial');try{fs.writeFileSync(temp,bytes);fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
function collect(options={}){const base=options.base||DEFAULT_BASE,rel=options.rel||DEFAULT_REL,hold=options.hold||DEFAULT_HOLD,manifestFile=path.join(base,'MTK Rel','local-source-manifest.json');fs.mkdirSync(base,{recursive:true});let previous={};try{previous=JSON.parse(fs.readFileSync(manifestFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const next={...previous},errors=[];
 function copy(source,folder,key){try{const before=fs.statSync(source),bytes=fs.readFileSync(source),after=fs.statSync(source);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==after.size)throw Error('파일 저장 중입니다. 다음 확인 때 다시 시도합니다.');const name=path.basename(source),digest=hash(bytes),dest=path.join(base,folder,name);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest)||hash(fs.readFileSync(dest))!==digest)writeAtomic(dest,bytes);const old=previous[key];const revision=old&&old.hash===digest&&old.name===name?old.revision:(old?.revision||0)+1;next[key]={name,hash:digest,revision,relative:folder+'/'+name,id:key+':'+revision+':'+digest,size:bytes.length};}catch(e){errors.push(key+': '+e.message);}}
 try{for(const x of selectLatest(fs.readdirSync(rel)))copy(path.join(rel,x.name),'MTK Rel','rel:'+x.customer);}catch(e){errors.push('REL: '+e.message);}
 copy(hold,'MNT Hold','hold');
 for(const folder of ['MTK Rel','MNT Hold'])fs.mkdirSync(path.join(base,folder),{recursive:true});
 if(JSON.stringify(next)!==JSON.stringify(previous))writeAtomic(manifestFile,JSON.stringify(next,null,2),path.join(base,'MTK Rel'));
 return {entries:next,errors};
}
module.exports={collect,selectLatest};
