import assert from 'node:assert/strict';
import test from 'node:test';
import {jevListeningSqlMetadataBytesV3,jevListeningPhaseFlushBytesV3,jevLegacyPhaseFlushBytesV3} from './signal-jev-phase-geometry-v3';
import {jevUsageV1} from './signal-jev-labeling-page';
import {createJevListeningMetadataScopeV3,createJevListeningMetadataReceiptV3} from './signal-jev-listening-metadata-v3';

const uuid='00000000-0000-4000-8000-000000000001',sha='sha256:'+'a'.repeat(64);
function call(keys=['q']){
 const questions=Object.fromEntries(keys.map(key=>[key,{type:'noul',instructions:'configured'}]));
 const input={root_id:uuid,input_digest:sha,question_keys:[...keys],question_digests:Object.fromEntries(keys.map(key=>[key,sha])),text:'state'};
 return{id:uuid,request:{model:'jev-1.13.0',state:'state',questions},inputs:[input],status:'submitting',raw_body:null as string|null,results_applied:false};
}
for(const q of [1,2,256])test(`Listening metadata bound accounts UUID/digest lineage and all ${q} maximum keys`,()=>{
 const keys=Array.from({length:q},(_,i)=>('q'+i).padEnd(64,'x')),c=call(keys),input=c.inputs[0]!;
 const metadata=jevListeningSqlMetadataBytesV3(q);
 const result={root_id:input.root_id,input_digest:input.input_digest,entity_context_digest:sha,status:'error',answers:{},question_digests:input.question_digests,error_code:'jev_response_invalid'};
 const replay=JSON.stringify({id:c.id,results:[result]});
 const answerMetadata=keys.reduce((n,key)=>n+Buffer.byteLength(JSON.stringify({root_id:uuid,input_digest:sha,question_key:key,question_digest:sha,answer:null,call_id:uuid}))-4+1,0);
 assert.ok(Buffer.byteLength(replay)+1<=metadata);assert.ok(answerMetadata<=metadata);
 assert.equal(metadata,Math.max(279,383+141*q,373*q,136));
});

test('Native-owned lineage sealing keeps the same mapper/store objects and leaves operational fields mutable',()=>{
 const c=call(),run={entity_context_digest:sha},scope=createJevListeningMetadataScopeV3(run);
 const originalInput=c.inputs[0],originalRequest=c.request;
 assert.equal(scope.sealNativeBeforeCommit(c),true);assert.equal(scope.takeQuestionSlots(c),1);
 assert.strictEqual(c.inputs[0],originalInput);assert.strictEqual(c.request,originalRequest);
 assert.throws(()=>{c.inputs[0]!.question_keys.push('new');},TypeError);
 assert.throws(()=>{c.inputs[0]!.question_digests.q='changed';},TypeError);
 assert.throws(()=>{c.inputs=[{...c.inputs[0]!,root_id:'changed'}];},TypeError);
 assert.throws(()=>{c.request.questions={};},TypeError);
 assert.throws(()=>{run.entity_context_digest='changed';},TypeError);
 c.status='settled';c.raw_body='exact raw';c.results_applied=true;
 assert.equal(c.status,'settled');assert.equal(c.raw_body,'exact raw');assert.equal(c.results_applied,true);
});

test('unsupported lineage falls back before any partial seal, getter or new rejection',()=>{
 const c=call(),run={entity_context_digest:sha},scope=createJevListeningMetadataScopeV3(run);let gets=0;
 Object.defineProperty(c.inputs[0]!,'input_digest',{get(){gets++;return sha;},enumerable:true,configurable:true});
 assert.equal(scope.sealNativeBeforeCommit(c),false);assert.equal(scope.takeQuestionSlots(c),undefined);
 assert.equal(gets,0);assert.equal(Object.isFrozen(c.inputs),false);assert.equal(Object.isFrozen(c.request),false);
 assert.equal(Object.getOwnPropertyDescriptor(run,'entity_context_digest')!.writable,true);
});

test('a malformed key and a non-Native clone do not inherit the successful seal',()=>{
 const c=call(),scope=createJevListeningMetadataScopeV3({entity_context_digest:sha});
 assert.equal(scope.sealNativeBeforeCommit(c),true);
 const clone=structuredClone(c);assert.equal(scope.takeQuestionSlots(clone),undefined);
 const unsupported=call(['q'+'x'.repeat(64)]);assert.equal(scope.sealNativeBeforeCommit(unsupported),false);
 assert.equal(Object.isFrozen(unsupported.inputs),false);
});

test('received metadata quote preserves 6B, escaping/1e20/extras and the unchanged Legacy terminal quote',()=>{
 const body='{ "answers":{"q":{"type":"noul","noul":1,"extra":[1e20,"é😀\\\"",{"kept":true}]}},"usage":{"input_tokens":1,"output_tokens":0,"nested":{"x":1e20}} }';
 const raw=Buffer.byteLength(JSON.stringify({body,http_status:200,latency_ms:1}));
 const normal=jevListeningPhaseFlushBytesV3(body,raw,1),legacy=jevLegacyPhaseFlushBytesV3(body,raw,1);
 assert.equal(legacy-normal,20*(1024+16384-jevListeningSqlMetadataBytesV3(1)));
 const terminal={id:uuid,results:[{root_id:uuid,input_digest:sha,entity_context_digest:sha,status:'error',answers:{},question_digests:{['q'.padEnd(64,'x')]:sha},error_code:'jev_response_unavailable'}]};
 const terminalBytes=Buffer.byteLength(JSON.stringify(terminal))+1; // per-call delimiter
 assert.equal(terminalBytes,528);assert.ok(terminalBytes>jevListeningSqlMetadataBytesV3(1));
 // The terminal API intentionally remains the original broad formula.
 assert.ok(jevLegacyPhaseFlushBytesV3('',1,1)>20*Buffer.byteLength(JSON.stringify(terminal)));
});


test('settlement metadata covers safe-integer cost, overwritten cache fields and every nested usage extra',()=>{
 const usage={input_tokens:1,output_tokens:0,cache_read_input_tokens:123,cache_creation:{existing:'retained only until existing overwrite'},extra:{nested:[1e20,'é😀',String.fromCharCode(0xd800)]}};
 const transformed=jevUsageV1(usage),json=JSON.stringify(transformed);
 const row=JSON.stringify({id:uuid,usage:transformed,cost:Number.MAX_SAFE_INTEGER,stop_reason:'jev_response_invalid',refusal_category:null});
 assert.equal(Buffer.byteLength(row)-Buffer.byteLength(json)+1,140);
 assert.ok(Buffer.byteLength(json)-Buffer.byteLength(JSON.stringify(usage))<=139);
 assert.deepEqual(Reflect.get(transformed,'extra'),usage.extra);assert.ok(140+139<=jevListeningSqlMetadataBytesV3(1));
});

test('normal metadata F remains inside the unchanged maximum for whitespace, numeric/Unicode/invalid bodies and all Q',()=>{
 const bodies=[' '.repeat(16384),'\u0000'.repeat(16384),'"\\'.repeat(8192),
  '{"x":['+Array.from({length:2000},()=>'1e20').join(',')+']}',JSON.stringify({nested:['é😀',String.fromCharCode(0xd800)]}),'{"x":"unterminated'];
 for(const body of bodies)for(const q of [1,2,256]){
  const raw=Buffer.byteLength(JSON.stringify({body,http_status:200,latency_ms:1}));
  assert.ok(Buffer.byteLength(body)<=16384);assert.ok(jevListeningPhaseFlushBytesV3(body,raw,q)<=jevLegacyPhaseFlushBytesV3(body,raw,q));
 }
});


test('whole Native cohort preflight leaves every object unchanged when any lineage lacks a premise',()=>{
 const run={entity_context_digest:sha},scope=createJevListeningMetadataScopeV3(run),first=call(),second=call(['q'+'x'.repeat(64)]),rows=[first,second];
 assert.equal(rows.every(row=>scope.canSealNativeBeforeCommit(row)),false);
 assert.equal(Object.isFrozen(first.inputs),false);assert.equal(Object.isFrozen(first.request),false);
 assert.equal(Object.isFrozen(second.inputs),false);assert.equal(scope.takeQuestionSlots(first),undefined);
 assert.equal(Object.getOwnPropertyDescriptor(run,'entity_context_digest')!.writable,true);
});


test('metadata receipt sums repeated cumulative metrics across contiguous windows and jobs without double counting',()=>{
 const receipt=createJevListeningMetadataReceiptV3(),metrics=(n:number,l:number,t:number)=>({response_metadata_native_rows:n,response_metadata_legacy_received_rows:l,response_metadata_legacy_terminal_rows:t});
 receipt.beginJob();receipt.observe(metrics(0,0,0));receipt.observe(metrics(2,1,0));receipt.observe(metrics(2,1,0));
 receipt.observe(metrics(0,0,0));receipt.observe(metrics(3,4,2));receipt.observe(metrics(3,4,2));
 receipt.beginJob();receipt.observe(metrics(0,0,0));receipt.observe(metrics(1,2,1));receipt.observe(metrics(1,2,1));
 const value=receipt.snapshot();assert.equal(value.native_received_rows,6);assert.equal(value.legacy_received_rows,7);assert.equal(value.legacy_terminal_rows,3);
 assert.equal(value.jobs,2);assert.equal(value.contiguous_window_resets,1);assert.equal(value.observed,true);assert.equal(value.complete_counters,true);
 assert.ok(Object.values(value).every(v=>typeof v==='number'||typeof v==='boolean'||v==='jev-listening-metadata-v3'),'no request IDs, RAW or params retained in receipt');
});

test('metadata receipt rejects ambiguous nonzero counter decreases and never infers reduced F from Legacy V3',()=>{
 const receipt=createJevListeningMetadataReceiptV3();receipt.beginJob();
 receipt.observe({response_metadata_native_rows:0,response_metadata_legacy_received_rows:3,response_metadata_legacy_terminal_rows:1});
 assert.equal(receipt.snapshot().complete_counters,true);assert.equal(receipt.snapshot().observed,false);
 receipt.observe({response_metadata_native_rows:0,response_metadata_legacy_received_rows:2,response_metadata_legacy_terminal_rows:1});
 assert.equal(receipt.snapshot().invalid_samples,1);assert.equal(receipt.snapshot().complete_counters,false);
 receipt.observe({});assert.equal(receipt.snapshot().missing_samples,1);assert.equal(receipt.snapshot().observed,false);
});
