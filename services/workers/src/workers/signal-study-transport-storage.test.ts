import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAnthropicStudyProviderV1,STUDY_SONNET_RESPONSE_BYTES_V1} from '../providers/anthropic-study';
import {createSignalStudyRawStorageV1} from './signal-study-storage';
import {createWorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import {startR16HttpFilesystemStorageV1} from '../../../../scripts/r16/http-filesystem-storage';
const sha=(value:string|Buffer)=>'sha256:'+createHash('sha256').update(value).digest('hex');
const body=JSON.stringify({model:'claude-sonnet-4-6',max_tokens:32768,thinking:{type:'disabled'},
 system:'Synthetic Study protocol',messages:[{role:'user',content:'{}'}]});

test('Study sends its exact canonical body without stream through one scoped-key HTTP attempt',async()=>{
 let calls=0;const bytes=Buffer.from('{"usage":{"input_tokens":10,"output_tokens":2},"text":"ação"}');
 const provider=createAnthropicStudyProviderV1({apiKey:'synthetic-study-only',fetch:async(url,init)=>{
  calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(init?.body,body);
  assert.equal((init?.headers as Record<string,string>)['x-api-key'],'synthetic-study-only');
  assert.equal(init?.redirect,'error');return new Response(bytes,{status:200,headers:{'request-id':'synthetic-request'}});
 }});
 provider.assertReady(body);const receipt=await provider.generate(body,new AbortController().signal);
 assert.equal(calls,1);assert.equal(receipt.sha256,sha(bytes));assert.equal(receipt.body_bytes,bytes.length);
 assert.equal(receipt.body_base64,bytes.toString('base64'));assert.equal(receipt.complete,true);
 assert.equal(receipt.provider_request_id,'synthetic-request');
});
test('Study rejects missing credentials, other models, streaming or altered canonical token bounds before HTTP',()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw Error('no request expected');};
 assert.throws(()=>createAnthropicStudyProviderV1({apiKey:'',fetch:fetcher}).assertReady(body),/key_missing/u);
 const provider=createAnthropicStudyProviderV1({apiKey:'synthetic',fetch:fetcher});
 for(const change of [{model:'claude-opus-4-6'},{max_tokens:64000},{stream:true}])
  assert.throws(()=>provider.assertReady(JSON.stringify({...JSON.parse(body),...change})),/request_invalid/u);
 assert.equal(calls,0);
});
test('Study retains an observed HTTP 529 once and never retries or fabricates usage',async()=>{
 let calls=0;const bytes=Buffer.from('{"error":"overloaded"}');
 const provider=createAnthropicStudyProviderV1({apiKey:'synthetic',fetch:async()=>{calls++;return new Response(bytes,{status:529});}});
 const receipt=await provider.generate(body,new AbortController().signal);
 assert.equal(calls,1);assert.equal(receipt.http_status,529);assert.equal(receipt.body_base64,bytes.toString('base64'));
 assert.equal('usage'in receipt,false);
});
test('Study abort preserves the received byte prefix and status and cancels the reader',async()=>{
 const controller=new AbortController();let canceled=false,calls=0;
 const prefix=Buffer.from('{"partial":');
 const provider=createAnthropicStudyProviderV1({apiKey:'synthetic',fetch:async()=>{calls++;return new Response(new ReadableStream({
  start(stream){stream.enqueue(prefix);setTimeout(()=>controller.abort(),10);},cancel(){canceled=true;},
 }),{status:200});}});
 const receipt=await provider.generate(body,controller.signal);
 assert.equal(calls,1);assert.equal(receipt.complete,false);assert.equal(receipt.http_status,200);
 assert.equal(receipt.sha256,sha(prefix));assert.equal(canceled,true);
});
test('Study truncation keeps bounded exact bytes and a headerless transport failure stays ambiguous',async()=>{
 const bytes=Buffer.alloc(STUDY_SONNET_RESPONSE_BYTES_V1+10,65);
 const provider=createAnthropicStudyProviderV1({apiKey:'synthetic',fetch:async()=>new Response(bytes)});
 const receipt=await provider.generate(body,new AbortController().signal);
 assert.equal(receipt.complete,false);assert.equal(receipt.body_bytes,STUDY_SONNET_RESPONSE_BYTES_V1);
 assert.equal(receipt.sha256,sha(bytes.subarray(0,STUDY_SONNET_RESPONSE_BYTES_V1)));
 let calls=0;const broken=createAnthropicStudyProviderV1({apiKey:'synthetic',fetch:async()=>{calls++;throw Error('connection lost');}});
 await assert.rejects(broken.generate(body,new AbortController().signal),(error:unknown)=>
  Boolean(error&&typeof error==='object'&&'outcome'in error&&error.outcome==='outcome_unknown'));
 assert.equal(calls,1);
});
test('Study private receipt custody uploads, reads back and recovers through real HTTP Storage',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r16-study-transport-qa-')),server=await startR16HttpFilesystemStorageV1(directory);
 try{
  const storage=createWorkspaceEngineStorageV1({url:server.base_url,service_role_key:'synthetic-private-key',bucket:'study-private'});
  const raw=createSignalStudyRawStorageV1(storage),raw_text=JSON.stringify({contract_version:'signal-study-receipt-v1',body_base64:'e30=',complete:true});
  const raw_sha256=sha(raw_text),descriptor={workspace_id:randomUUID(),execution_id:randomUUID(),step_id:randomUUID(),
   name:'study-'+raw_sha256.slice(7)+'.json',raw_text,raw_sha256,size_bytes:Buffer.byteLength(raw_text)};
  const stored=await raw.store(descriptor);assert.equal(stored.verified,true);
  assert.equal(stored.storage_key,raw.reference(descriptor).storage_key);
  assert.equal(await createSignalStudyRawStorageV1(storage).load(stored),raw_text);
  await assert.rejects(raw.store({...descriptor,raw_text:'tampered'}),/storage_invalid/u);
  await assert.rejects(raw.load({...stored,sha256:sha('other')}),/storage_invalid/u);
  await assert.rejects(raw.load({...stored,size_bytes:stored.size_bytes+1}),/workspace_engine_storage_manifest_invalid/u);
  assert.throws(()=>raw.reference({...descriptor,name:'../receipt.json'}),/storage_invalid/u);
  assert.ok(server.metrics().object_puts>0);assert.ok(server.metrics().object_gets>0);
 }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
