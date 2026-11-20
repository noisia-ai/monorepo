import assert from'node:assert/strict';
import test from'node:test';
import{randomUUID,createHash}from'node:crypto';
import{mkdtemp,writeFile,rm}from'node:fs/promises';
import{join}from'node:path';
import{tmpdir}from'node:os';
import{createWorkspaceEngineStorageV1}from'./signal-workspace-engine-storage';
import{createListeningDiscoveryNumericStorageV1}from'./signal-listening-discovery-numeric-storage';
const sha=(v:Buffer)=>'sha256:'+createHash('sha256').update(v).digest('hex');

test('numeric custody uses native private multipart upload/readback and survives replacement without local files',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'noisia-numeric-storage-test-')),objects=new Map<string,Buffer>();let writes=0;
 const storage=createWorkspaceEngineStorageV1({url:'http://127.0.0.1',service_role_key:'synthetic-test-only',bucket:'private-fixture',fetch:async(url,init)=>{
  const path=new URL(String(url)).pathname;if(path.includes('/bucket/'))return Response.json({id:'private-fixture',public:false});
  const key=path.replace('/object/authenticated/','/object/');if(init?.method==='POST'){writes++;if(objects.has(key))return new Response(null,{status:409});
   objects.set(key,Buffer.from(init.body as Uint8Array));return Response.json({});}
  const content=objects.get(key);return content?new Response(new Uint8Array(content)):new Response(null,{status:404});
 }});
 const scope={workspace_id:randomUUID(),execution_id:randomUUID()},checkpoint_id=randomUUID();
 try{
  for(const content of [Buffer.alloc(0),Buffer.from('binary-model-bytes-\0\xff')]){
   const name=content.length?'output/model.open.joblib':'input/guides.jsonl',file=join(directory,name.split('/')[1]!);await writeFile(file,content);
   const artifact={name,file,sha256:sha(content),size_bytes:content.length};
   const writer=createListeningDiscoveryNumericStorageV1({storage,scope,artifacts:[artifact]});
   const descriptor={...scope,checkpoint_id,name,sha256:artifact.sha256,size_bytes:artifact.size_bytes};
   const ref=writer.reference(descriptor),stored=await writer.store(descriptor);assert.equal(stored.storage_key,ref.storage_key);assert.equal(stored.verified,true);
   const recovery=createListeningDiscoveryNumericStorageV1({storage}),before=writes;await rm(file);
   assert.equal(await recovery.verify({...descriptor,...ref}),true);assert.equal(writes,before,'recovery reads custody without another upload or fit');
   assert.equal(await recovery.verify({...descriptor,...ref,workspace_id:randomUUID()}),false);
   await assert.rejects(recovery.store(descriptor),/local_artifact_unavailable/);
   assert.equal(await recovery.verify({...descriptor,storage_key:ref.storage_key,sha256:sha(Buffer.from('foreign'))}),false);
   const storedKey='/storage/v1/object/private-fixture/'+ref.storage_key,original=objects.get(storedKey)!;
   objects.set(storedKey,Buffer.from('corrupt envelope'));assert.equal(await recovery.verify({...descriptor,...ref}),false);objects.set(storedKey,original);
   objects.delete(storedKey);assert.equal(await recovery.verify({...descriptor,...ref}),false,'missing byte custody remains pending');
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('numeric artifact upload requires owner scope and refuses a foreign descriptor before any storage operation',async()=>{
 let operations=0;const storage={assertReady:async()=>{operations++;},put:async()=>{operations++;throw Error('no upload');},get:async()=>{operations++;}};
 const artifact={name:'numeric-manifest.json',file:'/private/not-read/numeric-manifest.json',sha256:sha(Buffer.from('{}')),size_bytes:2};
 assert.throws(()=>createListeningDiscoveryNumericStorageV1({storage,artifacts:[artifact]}),/scope_invalid/);
 const scope={workspace_id:randomUUID(),execution_id:randomUUID()},adapter=createListeningDiscoveryNumericStorageV1({storage,scope,artifacts:[artifact]});
 await assert.rejects(adapter.store({...scope,workspace_id:randomUUID(),checkpoint_id:randomUUID(),name:artifact.name,sha256:artifact.sha256,size_bytes:2}),/descriptor_invalid/);
 assert.equal(operations,0);
});

test('native storage bindings capture only the exact result owner and recover without recapturing local files',async()=>{
 const{createListeningDiscoveryNumericStorageBindingsV1}=await import('./signal-listening-discovery-numeric-storage');
 const{createHash}=await import('node:crypto');
 const storedBytes=new Map<string,Buffer>(),directory=await mkdtemp(join(tmpdir(),'noisia-stage-bindings-'));
 const storage=createWorkspaceEngineStorageV1({url:'http://127.0.0.1',service_role_key:'synthetic',bucket:'private-fixture',fetch:async(url,init)=>{
  const path=new URL(String(url)).pathname;if(path.includes('/bucket/'))return Response.json({id:'private-fixture',public:false});
  const key=path.replace('/object/authenticated/','/object/');if(init?.method==='POST'){storedBytes.set(key,Buffer.from(init.body as Uint8Array));return Response.json({});}
  const bytes=storedBytes.get(key);return bytes?new Response(new Uint8Array(bytes)):new Response(null,{status:404});
 }});
 try{
  const lease={workspace_id:randomUUID(),execution_id:randomUUID(),source_generation_id:randomUUID()}as import('./signal-listening-discovery-auto-loop').ListeningDiscoveryAdvanceLeaseV1;
  const file=join(directory,'numeric-manifest.json'),raw=Buffer.from('{}'),digest='sha256:'+createHash('sha256').update(raw).digest('hex');await writeFile(file,raw);
  const result={manifest:{workspace_id:lease.workspace_id,generation_id:lease.source_generation_id},artifacts:[{name:'numeric-manifest.json',file,sha256:digest,size_bytes:raw.length}]}as import('./signal-listening-orphan-regroup').ListeningOrphanNumericResultV1;
  const bindings=createListeningDiscoveryNumericStorageBindingsV1(storage);
  assert.throws(()=>bindings.numeric_storage_for_result({...lease,source_generation_id:randomUUID()},result),/result_scope_invalid/);
  const uploader=bindings.numeric_storage_for_result(lease,result),descriptor={workspace_id:lease.workspace_id,execution_id:lease.execution_id,checkpoint_id:randomUUID(),
   name:'numeric-manifest.json',sha256:digest,size_bytes:raw.length};
  const receipt=await uploader.store(descriptor);await rm(file);
  assert.equal(await bindings.numeric_storage.verify({...descriptor,storage_key:receipt.storage_key}),true);
  await assert.rejects(bindings.numeric_storage.store(descriptor),/local_artifact_unavailable/,'restart cannot upload from a nonexistent local result');
 }finally{await rm(directory,{recursive:true,force:true});}
});
