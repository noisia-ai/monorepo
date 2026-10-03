import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  loadSignalTopicConsolidationStatusV1, requestSignalTopicConsolidationV1,
  retrySignalTopicConsolidationV1, claimSignalTopicConsolidationDispatchV1,
  claimSignalTopicConsolidationExecutionV1, heartbeatSignalTopicConsolidationExecutionV1,
  completeSignalTopicConsolidationExecutionV1, recoverSignalTopicConsolidationExecutionsV1,
  SignalTopicConsolidationControlError,
} from '../signal-topic-consolidation-control';
import { SIGNAL_PROCESSING_ACTIONS_V1 } from '../signal-processing-policy';

const sql = readFileSync(new URL('./0175_signal_topic_consolidation_control.sql',import.meta.url),'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope = { workspace_id:id(1),actor_user_id:id(2) };
const quote = `v1.1789200000.${'a'.repeat(64)}`;
const authority = { workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'client',
  primary_role:'client_admin',same_organization:true,brand_access_level:'admin',organization_status:'active',brand_same_organization:true };
function database(reply: (query:string,params:unknown[])=>unknown) {
  const calls:Array<{query:string;params:unknown[]}> = [];let released=0;
  return {calls,get released(){return released;},connect:async()=>({
    query:async(query:string,params:unknown[]=[])=>{calls.push({query,params});
      if(query.startsWith('BEGIN')||query==='COMMIT'||query==='ROLLBACK'||query.startsWith('SET LOCAL'))return {rows:[]};
      if(query.includes('workspace.status workspace_status'))return {rows:[authority]};
      return {rows:[{value:reply(query,params)}]};},release(){released++;}
  })} as unknown as Parameters<typeof requestSignalTopicConsolidationV1>[0]['database'] & {
    calls:Array<{query:string;params:unknown[]}>;released:number;
  };
}
test('0175 separates a zero-cap numeric admission from the disabled paid action',()=>{
  assert.ok(SIGNAL_PROCESSING_ACTIONS_V1.includes('topic_consolidation_numeric'));
  assert.ok(SIGNAL_PROCESSING_ACTIONS_V1.includes('topic_consolidation'));
  assert.match(sql,/hard_cap_micro_usd bigint NOT NULL CHECK\(hard_cap_micro_usd=0\)/);
  assert.match(sql,/action<>'topic_consolidation_numeric' OR \(kind='free' AND automatic_allowed=false AND max_execution_micro_usd=0/);
  assert.match(sql,/NEW.action='topic_consolidation' THEN RAISE EXCEPTION 'topic_consolidation_provider_disabled'/);
  assert.match(sql,/NEW.action='topic_consolidation_numeric' AND \(NEW.execution_cap_micro_usd<>0 OR NEW.automatic OR NEW.provider IS NOT NULL OR NEW.model IS NOT NULL\)/);
  assert.doesNotMatch(sql,/INSERT INTO (?:engine_cost_events|signal_semantic_context_budget_reservations|signal_workspace_embedding_calls)/);
  const request=sql.slice(sql.indexOf('CREATE FUNCTION request_signal_topic_consolidation_v1'),sql.indexOf('-- Preserve every effective0157'));
  assert.match(request,/action='topic_consolidation_numeric'/);
  assert.match(request,/INSERT INTO signal_processing_admissions/);assert.match(request,/INSERT INTO signal_topic_consolidation_outbox/);
  assert.match(sql,/CREATE CONSTRAINT TRIGGER topic_consolidation_admission_complete[\s\S]*?DEFERRABLE INITIALLY DEFERRED/);
});
test('0175 preserves original admission branches and limits source and private execution scope',()=>{
  assert.match(sql,/PERFORM signal_brand_context_processing_lock_actor_v1\(NEW.workspace_id,NEW.actor_user_id\)/);
  assert.match(sql,/brand_context_prototype_receipt_required/);assert.match(sql,/brand_context_composed_receipt_required/);
  assert.match(sql,/signal_topic_consolidation_source_binding_v1\(e.source_engine_execution_id\) IS DISTINCT FROM e.source_binding/);
  assert.match(sql,/e.execution_token IS DISTINCT FROM target_token/);
  assert.match(sql,/e.workspace_id IS DISTINCT FROM target_workspace OR e.actor_user_id IS DISTINCT FROM target_actor/);
  assert.match(sql,/BETWEEN 1 AND 5000/);
  for(const table of ['executions','request_keys','outbox'])assert.match(sql,new RegExp(`ALTER TABLE signal_topic_consolidation_${table} ENABLE ROW LEVEL SECURITY`));
  for(const match of sql.matchAll(/CREATE FUNCTION (\w+)\(/gu))assert.ok(sql.includes(`${match[1]}(`)&&sql.slice(sql.indexOf('REVOKE ALL ON FUNCTION')).includes(match[1]!),match[1]);
});
test('completed intent replay precedes quote expiry and never creates another owner',()=>{
  const fn=sql.slice(sql.indexOf('CREATE FUNCTION request_signal_topic_consolidation_v1'),sql.indexOf('-- Preserve every effective0157'));
  assert.ok(fn.indexOf('RETURN prior.result')<fn.indexOf('quote:=signal_topic_consolidation_quote_v1'));
  assert.match(fn,/request_hash:=signal_semantic_context_digest_json_v2[\s\S]*?'quote_reference',expected_quote/);
  assert.match(sql,/CREATE UNIQUE INDEX uq_topic_consolidation_live_source ON signal_topic_consolidation_executions\(workspace_id,source_engine_execution_id\);/);
  const recovery=sql.slice(sql.indexOf('CREATE FUNCTION recover_signal_topic_consolidation_executions_v1'),sql.indexOf('CREATE FUNCTION assert_signal_topic_consolidation_worker_scope_v1'));
  assert.doesNotMatch(recovery,/signal_brand_context_processing_lock_actor|INSERT INTO signal_processing_admissions/);
  assert.match(recovery,/FOR UPDATE SKIP LOCKED/);assert.match(recovery,/e.dispatch_generation>=20/);
});
test('failed owners expose retry only to the same live actor and completion is source-bound',()=>{
  const status=sql.slice(sql.indexOf('CREATE FUNCTION signal_topic_consolidation_status_v1'),
    sql.indexOf('CREATE FUNCTION claim_signal_topic_consolidation_dispatch_v1'));
  assert.match(status,/can_request AND \(e\.id IS NULL AND state='ready_to_prepare' OR COALESCE\(retryable,false\)\)/);
  assert.match(status,/e\.actor_user_id=target_actor/);
  const completion=sql.slice(sql.indexOf('CREATE FUNCTION complete_signal_topic_consolidation_execution_v1'),
    sql.indexOf('CREATE FUNCTION fail_signal_topic_consolidation_execution_v1'));
  assert.match(completion,/source_engine_execution_id=e\.source_engine_execution_id/);
});
test('status is a read-only transaction and exposes only numeric zero-cost state',async()=>{
  const response={contract_version:'signal-topic-consolidation-status-v1',workspace_id:id(1),status:'policy_action_required',
    can_request:false,provider_execution_enabled:false,maximum_micro_usd:'0',confirmed_micro_usd:'0',reserved_micro_usd:'0',
    expected_group_count:1652,group_count:0,source_execution_id:id(3),quote_reference:null,quote_expires_at:null,execution:null};
  const db=database(query=>{assert.match(query,/signal_topic_consolidation_status_v1/);return response;});
  assert.deepEqual(await loadSignalTopicConsolidationStatusV1({database:db,...scope}),response);
  assert.equal(db.calls[0]!.query,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(db.calls.at(-1)!.query,'COMMIT');assert.equal(db.released,1);
  assert.equal('policy_version_id' in response,false);assert.equal('provider' in response,false);
});
test('request and retry delegate one sealed SQL transaction without monetary fields from the caller',async()=>{
  const receipt={execution_id:id(4),replayed:false,worker_job_id:`topic-consolidation-${id(4)}-1`};
  const db=database((query,params)=>{assert.match(query,/request_signal_topic_consolidation_v1/);
    assert.deepEqual(params,[id(1),id(2),id(3),'request-key-1',quote]);return receipt;});
  assert.deepEqual(await requestSignalTopicConsolidationV1({database:db,...scope,source_execution_id:id(3),idempotency_key:'request-key-1',quote_reference:quote}),receipt);
  assert.deepEqual(db.calls.map(c=>c.query.startsWith('SELECT')?'request':c.query),[
    'BEGIN ISOLATION LEVEL READ COMMITTED','SET LOCAL search_path=public,extensions,pg_temp','request','COMMIT']);
  const replayDb=database((query,params)=>{assert.match(query,/retry_signal_topic_consolidation_v1/);
    assert.deepEqual(params,[id(1),id(2),id(4),'retry-key-01']);return {...receipt,replayed:true};});
  assert.equal((await retrySignalTopicConsolidationV1({database:replayDb,...scope,execution_id:id(4),idempotency_key:'retry-key-01'})).replayed,true);
});
test('invalid quotes fail before DB, and deterministic DB rejection rolls back',async()=>{
  let connected=0;const none={connect:async()=>{connected++;throw Error('unreachable');}} as never;
  await assert.rejects(requestSignalTopicConsolidationV1({database:none,...scope,source_execution_id:id(3),idempotency_key:'request-key-1',quote_reference:'provider=anthropic'}),SignalTopicConsolidationControlError);
  assert.equal(connected,0);
  const db=database(()=>{throw Error('topic_consolidation_quote_stale');});
  await assert.rejects(requestSignalTopicConsolidationV1({database:db,...scope,source_execution_id:id(3),idempotency_key:'request-key-1',quote_reference:quote}),error=>error instanceof SignalTopicConsolidationControlError&&error.status===409);
  assert.equal(db.calls.at(-1)!.query,'ROLLBACK');assert.equal(db.released,1);
});
test('dispatch and leases preserve exact identifiers and recovery does not create an admission',async()=>{
  const lease={execution_id:id(4),workspace_id:id(1),actor_user_id:id(2),source_execution_id:id(3),execution_token:id(5),worker_job_id:`topic-consolidation-${id(4)}-1`};
  const db=database((query,params)=>{
    if(query.includes('claim_signal_topic_consolidation_dispatch')){assert.deepEqual(params,['worker-0001',10,30]);return [];}
    if(query.includes('claim_signal_topic_consolidation_execution'))return lease;
    if(query.includes('recover_signal_topic_consolidation'))return 1;
    assert.equal(params[0],id(4));assert.equal(params[1],id(5));return true;
  });
  assert.deepEqual(await claimSignalTopicConsolidationDispatchV1({database:db,worker_id:'worker-0001'}),[]);
  assert.deepEqual(await claimSignalTopicConsolidationExecutionV1({database:db,execution_id:id(4),worker_job_id:lease.worker_job_id}),lease);
  assert.equal(await heartbeatSignalTopicConsolidationExecutionV1({database:db,lease}),true);
  assert.equal(await completeSignalTopicConsolidationExecutionV1({database:db,lease,consolidation_run_id:id(6)}),true);
  assert.equal(await recoverSignalTopicConsolidationExecutionsV1({database:db}),1);
});
