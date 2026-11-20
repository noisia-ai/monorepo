import {createHash} from 'node:crypto';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildWorkspaceEngineStorageKeyV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';

type Descriptor={workspace_id:string;execution_id:string;step_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number};
const sha=(value:string|Buffer)=>'sha256:'+createHash('sha256').update(value).digest('hex');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u,hash=/^sha256:[a-f0-9]{64}$/u;
const validSize=(size:number)=>Number.isSafeInteger(size)&&size>0&&size<=8*1024*1024;
const fail=():never=>{throw Error('study_receipt_storage_invalid');};
/** Immutable private multipart custody for Study receipts. Recovery needs only
 * the native content address; transient local paths never enter the journal. */
export function createSignalStudyRawStorageV1(storage:WorkspaceEngineStorageV1){
 const reference=(d:Descriptor)=>{
  if(![d.workspace_id,d.execution_id,d.step_id].every(id=>uuid.test(id))||!hash.test(d.raw_sha256)
   ||d.name!=='study-'+d.raw_sha256.slice(7)+'.json'||!validSize(d.size_bytes))fail();
  return{storage_key:buildWorkspaceEngineStorageKeyV1(d.workspace_id,d.execution_id,d.name,d.raw_sha256)};
 };
 const load=async(d:{storage_key:string;sha256:string;size_bytes:number})=>{
  const match=/^workspace-engine\/([a-f0-9-]{36})\/([a-f0-9-]{36})\//u.exec(d.storage_key);
  if(!match||!uuid.test(match[1]!)||!uuid.test(match[2]!)||!hash.test(d.sha256)||!validSize(d.size_bytes)
   ||d.storage_key!==buildWorkspaceEngineStorageKeyV1(match[1]!,match[2]!,'study-'+d.sha256.slice(7)+'.json',d.sha256))return fail();
  const directory=await mkdtemp(join(tmpdir(),'noisia-study-readback-'));
  try{const destination=join(directory,'receipt.json');await storage.get({workspace_id:match[1]!,execution_id:match[2]!,
   stored:{...d,media_type:'application/json'},destination});const bytes=await readFile(destination);
   if(bytes.length!==d.size_bytes||sha(bytes)!==d.sha256)return fail();
   return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  }finally{await rm(directory,{recursive:true,force:true});}
 };
 return{reference,load,async store(d:Descriptor){
  const ref=reference(d);if(typeof d.raw_text!=='string'||Buffer.byteLength(d.raw_text)!==d.size_bytes||sha(d.raw_text)!==d.raw_sha256)fail();
  if(!storage.assertReady)throw Error('study_receipt_storage_preflight_required');await storage.assertReady();
  const directory=await mkdtemp(join(tmpdir(),'noisia-study-receipt-'));
  try{const file=join(directory,d.name),handle=await open(file,'wx',0o600);
   try{await handle.writeFile(d.raw_text);await handle.sync();}finally{await handle.close();}
   const stored=await storage.put({workspace_id:d.workspace_id,execution_id:d.execution_id,file,sha256:d.raw_sha256,size_bytes:d.size_bytes,media_type:'application/json'});
   if(stored.storage_key!==ref.storage_key||stored.sha256!==d.raw_sha256||stored.size_bytes!==d.size_bytes
    ||await load({storage_key:stored.storage_key,sha256:stored.sha256,size_bytes:stored.size_bytes})!==d.raw_text)fail();
   return{storage_key:stored.storage_key,sha256:stored.sha256,size_bytes:stored.size_bytes,verified:true as const};
  }finally{await rm(directory,{recursive:true,force:true});}
 }};
}
