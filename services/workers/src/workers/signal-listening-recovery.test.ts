import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {LabelingCallV1} from '@noisia/db';
import type {SignalListeningInputV1} from '@noisia/query-engine';
import {selectSignalListeningRecoveryV1,createSignalListeningRecoveryProviderV1,listeningHasRawV1} from './signal-listening-recovery';
const execution={max_in_flight:64,flush_size:64,max_flushes:2,max_buffered_bytes:16*1024*1024,flush_interval_ms:5,window_size:200};
const row=(page:string,bytes:number)=>({id:randomUUID(),status:'unknown',results_applied:false,raw_body:null,has_raw:true,raw_page_id:page,raw_page_size_bytes:bytes,
 raw_size_bytes:100,request:{},inputs:[]}as unknown as LabelingCallV1<SignalListeningInputV1>);
test('recovery budgets one whole authenticated page and never mistakes metadata NULL for no receipt',()=>{
 const page=randomUUID(),calls=[row(page,1000),row(page,1000),row(randomUUID(),2000)];
 assert.equal(listeningHasRawV1(calls[0]!),true);
 const selected=selectSignalListeningRecoveryV1(calls,execution)!;
 assert.equal(selected.calls.length,2);assert.ok(selected.calls.every(call=>call.raw_page_id===page));assert.ok(selected.working_bytes<=execution.max_buffered_bytes);
 assert.equal(selected.execution.max_in_flight,1);
 selected.calls.forEach(call=>{call.results_applied=true;});
 const next=selectSignalListeningRecoveryV1(calls,execution)!;assert.equal(next.calls.length,1);assert.equal(next.page_bytes,2000);
 assert.notEqual(next.calls[0]!.raw_page_id,page,'subsequent passes advance whole pages rather than retaining a hidden tail');
 assert.throws(()=>selectSignalListeningRecoveryV1([row(page,32*1024*1024)],execution),/memory_budget_exceeded/,'a single small member cannot hide the full32MiB page decoding cost');
 assert.throws(()=>selectSignalListeningRecoveryV1([row(page,NaN)],execution),/raw_receipt_invalid/);
});
test('recovery observation has no evaluator and derives its feedback configuration only from verified usage',async()=>{
 const factories:Parameters<NonNullable<Parameters<typeof createSignalListeningRecoveryProviderV1>[0]['factory']>>[0][]=[],seen:number[]=[];let closes=0;
 const provider=createSignalListeningRecoveryProviderV1({execution,env:{NOISIA_TYPESAFE_ACCOUNT_ID:'synthetic'},factory:args=>{
  factories.push(args);return{evaluate:async()=>{throw Error('must never send');},observeUsage:async(_raw,tokens)=>{seen.push(tokens);},close:async()=>{closes++;}};
 }});
 const raw={body:'sealed',http_status:200,latency_ms:1,rate_reservation:{id:'receipt',estimated_input_tokens:100},rate_calibration:{labeler_digest:'sha256:'+'a'.repeat(64),input_bytes:500}};
 await assert.rejects(provider.evaluate({}as never),/recovery_only/);
 await provider.observeUsage!(raw,120);assert.deepEqual(seen,[120]);assert.equal(factories.length,1);
 const configured=JSON.parse(factories[0]!.env!.NOISIA_JEV_TOKEN_CALIBRATIONS_JSON!)[raw.rate_calibration.labeler_digest];
 assert.equal(configured.input_tokens_per_utf8_byte,120/500);assert.equal(configured.max_request_bytes,500);
 await provider.close!();assert.equal(closes,1);
});
