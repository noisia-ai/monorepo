import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { reserveSignalTopicEditorialCallV1, markSentSignalTopicEditorialCallV1, persistSignalTopicEditorialResponseV1,
  settleSignalTopicEditorialCallV1, SIGNAL_TOPIC_EDITORIAL_EXECUTION_CONFIGURATION_V1, type SignalTopicEditorialLeaseV1 } from '../signal-topic-consolidation-editorial';
const sql=readFileSync(new URL('./0176_signal_topic_consolidation_editorial.sql',import.meta.url),'utf8');
const lease: SignalTopicEditorialLeaseV1={execution_id:'00000000-0000-4000-8000-000000000001',execution_token:'00000000-0000-4000-8000-000000000002',
  workspace_id:'00000000-0000-4000-8000-000000000003',actor_user_id:'00000000-0000-4000-8000-000000000004',numeric_run_id:'00000000-0000-4000-8000-000000000005',
  source_execution_id:'00000000-0000-4000-8000-000000000006',worker_job_id:'private-fixture'};
test('forward-only 0178 uses the exact current Query Engine Sonnet request configuration',()=>{
 const current=readFileSync(new URL('./0178_signal_topic_editorial_catalog_contract.sql',import.meta.url),'utf8');
 const literal=current.match(/SELECT '(\{"contract_version":"signal-topic-editorial-execution-config-v1".*?\})'::jsonb/u)?.[1];
 assert.ok(literal);assert.deepEqual(JSON.parse(literal),SIGNAL_TOPIC_EDITORIAL_EXECUTION_CONFIGURATION_V1);
 assert.match(current,/topic_editorial_contract_upgrade_requires_empty_ledger/u);
 assert.match(current,/hard_cap_micro_usd BETWEEN 1 AND 30000000/u);
 assert.match(current,/max_execution_micro_usd BETWEEN 1 AND 30000000/u);
 assert.match(current,/cap:=least\(a\.max_execution_micro_usd,30000000\)/u);
 assert.match(current,/NEW\.execution_cap_micro_usd NOT BETWEEN 1 AND 30000000/u);
});
test('provider disabled is the default and rejects before even connecting or reserving',async()=>{
 let connections=0;const database={connect:async()=>{connections++;throw Error('unexpected database');}};
 await assert.rejects(reserveSignalTopicEditorialCallV1({database,lease,request_digest:'sha256:'+'a'.repeat(64)}),/topic_editorial_provider_disabled/u);
 await assert.rejects(markSentSignalTopicEditorialCallV1({database,lease,call_id:lease.execution_id,attempt_token:lease.execution_token}),/topic_editorial_provider_disabled/u);
 assert.equal(connections,0);
});
test('paid persistence and settlement have distinct short transactions and release before caller transport can continue',async()=>{
 const trace:string[]=[];let open=0;
 const database={connect:async()=>{
  open++;trace.push('connect');return {query:async(text:string)=>{trace.push(text.startsWith('SELECT')?'statement':text);return {rows:[{value:{status:'settled',replayed:false}}]};},
   release:()=>{open--;trace.push('release');}} as unknown as PoolClient;
 }} satisfies Pick<Pool,'connect'>;
 await persistSignalTopicEditorialResponseV1({database,call_id:lease.execution_id,attempt_token:lease.execution_token,response_body_private:'{}',response_storage_key:'private/test'});
 assert.equal(open,0);trace.push('caller-outside-transaction');
 await settleSignalTopicEditorialCallV1({database,call_id:lease.execution_id,attempt_token:lease.execution_token});assert.equal(open,0);
 assert.deepEqual(trace.filter(item=>['connect','COMMIT','release','caller-outside-transaction'].includes(item)),
  ['connect','COMMIT','release','caller-outside-transaction','connect','COMMIT','release']);
});
test('failed persistence rolls back/releases and does not automatically retry a paid operation',async()=>{
 let statements=0,released=0;const commands:string[]=[];
 const database={connect:async()=>({query:async(text:string)=>{commands.push(text);if(text.startsWith('SELECT')){statements++;throw Error('socket failure');}return{rows:[]};},
  release:()=>{released++;}} as unknown as PoolClient)};
 await assert.rejects(persistSignalTopicEditorialResponseV1({database,call_id:lease.execution_id,attempt_token:lease.execution_token,response_body_private:'{}',response_storage_key:'private/test'}),/socket failure/u);
 assert.equal(statements,1);assert.equal(released,1);assert.ok(commands.includes('ROLLBACK'));
});
test('numeric read-only lease does not lock actor; writes retain the full existing scope',()=>{
 const helper=sql.split('CREATE FUNCTION assert_signal_topic_consolidation_worker_lease_v1')[1]!.split('END;$$;')[0]!;
 assert.match(helper,/FOR SHARE/u);assert.match(helper,/source_binding/u);assert.doesNotMatch(helper,/lock_actor/u);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION assert_signal_topic_consolidation_worker_scope_v1/u);
 assert.match(sql,/'assert_signal_topic_consolidation_worker_lease_v1'/u);assert.match(sql,/REVOKE ALL ON FUNCTION/u);
 assert.match(sql,/ARRAY\['anon','authenticated'\]/u);
});
test('new ledger owner does not mix historic cost events or mutate serving/catalog selections',()=>{
 assert.doesNotMatch(sql,/(?:INSERT INTO|UPDATE|DELETE FROM) (?:engine_cost_events|signal_topic_definitions|signal_topic_selections|taxonomy_profiles)/u);
 assert.match(sql,/topic_editorial_admission_complete AFTER INSERT ON signal_processing_admissions\s+DEFERRABLE INITIALLY DEFERRED/u);
 assert.match(sql,/UNIQUE\(numeric_run_id\)|numeric_run_id uuid NOT NULL UNIQUE/u);
 assert.match(sql,/status<>'definitely_not_sent'/u);assert.match(sql,/processing_org_exposure_pre0176_v1/u);
});
