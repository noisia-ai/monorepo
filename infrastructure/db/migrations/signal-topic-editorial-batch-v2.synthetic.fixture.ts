import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {buildSignalTopicEditorialScreeningPlanV2,SIGNAL_TOPIC_EDITORIAL_CONFIGURATION_V2,
  classifySignalTopicEditorialMessageResultV2,type SignalTopicEditorialGroupRequestV2} from '../../../packages/query-engine/src/signal-topic-consolidation-editorial-v2';
import {validateSignalTopicEditorialScreeningOutputV1} from '../../../packages/query-engine/src/signal-topic-consolidation-editorial-v1';
import {reuseSignalTopicEditorialPaidGroupV2,type SignalTopicEditorialPaidSourceCallV2} from '../../../packages/query-engine/src/signal-topic-editorial-paid-reuse-v2';
import {loadSignalTopicConsolidationEditorialInputV1} from '../signal-topic-consolidation-editorial-input';
import {loadSignalTopicConsolidationEditorialStatusV1} from '../signal-topic-consolidation-editorial';
import {seedSignalTopicEditorialRenewalSourceV1} from './signal-topic-editorial-renewal.synthetic.fixture';
import type {SyntheticTransactionV1} from './signal-client-workspace-entry.synthetic.fixture';
import * as store from '../signal-topic-editorial-batch-v2';

const hash=(body:string)=>`sha256:${createHash('sha256').update(body).digest('hex')}`;
const providerReceipt=(id:string,count:number,status:'in_progress'|'ended')=>JSON.stringify({id,type:'message_batch',processing_status:status,
 request_counts:{processing:status==='ended'?0:count,succeeded:status==='ended'?count:0,errored:0,canceled:0,expired:0}});
function message(request:SignalTopicEditorialGroupRequestV2,invalidUsage=false){
 const output={contract_version:'signal-topic-editorial-group-output-v2',group_id:request.receipt.group_id.toUpperCase(),
  disposition:'Topic',candidate:{label:'Reparación de bicicletas sintéticas',definition:'Una definición íntegra. '.repeat(70),locale:request.receipt.expected_locale.toLowerCase()},
  confidence:0.8,rationale:'Evidencia ficticia para probar el almacenamiento sin truncar. '.repeat(70),
  cited_evidence_ids:[request.receipt.evidence[0]!.evidence_id.toUpperCase()]};
 return {id:'synthetic-message',type:'message',role:'assistant',model:'claude-sonnet-4-6',stop_reason:'end_turn',stop_sequence:null,
  content:[{type:'text',text:JSON.stringify(output)}],usage:{input_tokens:invalidUsage?'unavailable':101,output_tokens:51,
   cache_creation_input_tokens:0,cache_read_input_tokens:0}};
}

/** Executable positive fixture, not an independent runner or an acceptance claim.
 * Caller owns verified empty private target, schema prerequisites + local 0193,
 * physical READ COMMITTED transaction, nested savepoints and physical rollback.
 * No credentials, environment, network, provider, trigger bypass or model fit. */
export async function exerciseSignalTopicEditorialBatchV2Synthetic(args:SyntheticTransactionV1){
 const {query,database}=args;
 const beforeDefinitions=(await query(`SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) body FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN(
   'signal_topic_editorial_owner_guard_v1','signal_topic_editorial_call_guard_v1','signal_topic_editorial_state_guard_v1',
   'signal_topic_editorial_request_guard_v1','signal_processing_admission_guard_v1') ORDER BY 1`)).rows;
 const seed=await seedSignalTopicEditorialRenewalSourceV1(args);
 const source=await loadSignalTopicConsolidationEditorialInputV1(seed.scope);
 const plan=buildSignalTopicEditorialScreeningPlanV2({...source,run_id:seed.scope.numeric_run_id});
 assert.equal(plan.requests.length,2);
 const {plan_digest:_,...unsignedPlan}=plan;
 const planBody=store.signalTopicEditorialCanonicalBodyV2(unsignedPlan);
 if((await query('SELECT signal_topic_editorial_plan_valid_v2($1,$2::jsonb,$3) value',
  [seed.scope.numeric_run_id,JSON.stringify(plan),planBody])).rows[0]?.value!==true){
  // Report only named invariant failures. Never emit Brand OS, mentions or
  // provider payloads from the private rollback runner.
  const base=(await query(`SELECT
   r.id IS NOT NULL AS run_exists,
   signal_topic_editorial_source_v1($1) IS NOT NULL AS source_exists,
   ($2::jsonb->'identity'->>'source_context_digest')=r.context_digest AS source_context,
   ($2::jsonb-'plan_digest')=$3::jsonb AS canonical_body,
   ($2::jsonb->>'plan_digest')=signal_semantic_context_digest_v1($3) AS plan_digest,
   jsonb_array_length($2::jsonb->'requests')=r.expected_group_count AS group_count
   FROM signal_topic_consolidation_runs r WHERE r.id=$1`,
   [seed.scope.numeric_run_id,JSON.stringify(plan),planBody])).rows[0] as Record<string,boolean>|undefined;
  const badBase=Object.entries(base??{run_exists:false}).find(([,ok])=>ok!==true);
  if(badBase)throw Error(`topic_editorial_v2_fixture_${badBase[0]}_invalid`);
  for(const request of plan.requests){
   const check=(await query(`SELECT
    g.id IS NOT NULL AS group_exists,
    ($2::jsonb->'receipt'->>'group_digest')=g.group_digest AS group_digest,
    ($2::jsonb->'receipt'->>'source_dossier_digest')=g.dossier_digest AS dossier_digest,
    ($2::jsonb->'source_group'-ARRAY['group_key','lane','group_digest','source_dossier_digest','dossier_digest','community_key','root_count','chunk_count','terms','evidence'])
     =(g.dossier-ARRAY['contract_version','evidence']) AS dossier_fields,
    ($2::jsonb->'receipt'->>'expected_locale')=($2::jsonb->'source_context'->>'default_locale') AS locale,
    ($3::jsonb->'identity'->>'editorial_context_digest')=signal_topic_editorial_digest_json_v1($2::jsonb->'source_context') AS context_digest,
    ($2::jsonb->>'schema_digest')=signal_topic_editorial_digest_json_v1(signal_topic_editorial_output_schema_v2($2::jsonb->'receipt')) AS schema_digest,
    signal_semantic_context_digest_v1(to_json($2::jsonb->'provider_request'->'params'->>'system')::text)
     =signal_topic_editorial_configuration_v2()->>'prompt_digest' AS prompt_digest
    FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=$1 AND g.group_key=$2::jsonb->'receipt'->>'group_key'`,
    [seed.scope.numeric_run_id,JSON.stringify(request),JSON.stringify(plan)])).rows[0] as Record<string,boolean>|undefined;
   const bad=Object.entries(check??{group_exists:false}).find(([,ok])=>ok!==true);
   if(bad)throw Error(`topic_editorial_v2_fixture_${bad[0]}_invalid`);
  }
  throw Error('topic_editorial_v2_fixture_plan_invalid');
 }
 assert.deepEqual((await query('SELECT signal_topic_editorial_configuration_v2() value')).rows[0]!.value,SIGNAL_TOPIC_EDITORIAL_CONFIGURATION_V2);
 const {organization_id,actor_user_id,workspace_id}=seed.identity;
 const checked:string[]=[];
 let serial=0;
 async function denied(work:()=>Promise<unknown>,pattern:RegExp){
  const key=`batch_v2_denial_${++serial}`;await query(`SAVEPOINT ${key}`);
  try{await assert.rejects(work,pattern);}finally{await query(`ROLLBACK TO SAVEPOINT ${key}`);await query(`RELEASE SAVEPOINT ${key}`);}
 }
 async function scenario(name:string,work:()=>Promise<void>){
  const key=`batch_v2_scenario_${++serial}`;await query(`SAVEPOINT ${key}`);
  try{await work();await query('SET CONSTRAINTS ALL IMMEDIATE');await query('SET CONSTRAINTS ALL DEFERRED');checked.push(name);}
  finally{await query(`ROLLBACK TO SAVEPOINT ${key}`);await query(`RELEASE SAVEPOINT ${key}`);}
 }
 async function policy(version:1|2){
  const id=randomUUID();
  await query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT $1,$2,COALESCE(max(version),0)+1,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour',
    COALESCE((SELECT budget_timezone FROM signal_processing_policy_versions WHERE organization_id=$2 AND status<>'draft' ORDER BY version DESC LIMIT 1),'America/Mexico_City'),
    10000000000,$3
   FROM signal_processing_policy_versions WHERE organization_id=$2`,[id,organization_id,actor_user_id]);
  await query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $1,'topic_consolidation','provider','anthropic','claude-sonnet-4-6',configuration,signal_semantic_context_digest_json_v2(configuration),$2,false
   FROM (SELECT ${version===1?'signal_topic_editorial_configuration_v1':'signal_topic_editorial_configuration_v2'}() configuration) body`,[id,version===1?30000000:1000000000]);
  await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE organization_id=$1 AND status='active'",[organization_id]);
  await query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[id]);
  return id;
 }
 async function admission(previous_execution_id?:string){
  const policy_version_id=await policy(2);
  const inputs={database,workspace_id,actor_user_id,plan,idempotency_key:randomUUID(),policy_version_id,
   execution_cap_micro_usd:'1000000000',send_not_after:new Date(Date.now()+1_800_000).toISOString(),previous_execution_id};
  const result=await store.admitSignalTopicEditorialBatchV2(inputs);
  assert.equal(result.expected_items,2);assert.equal(result.replayed,false);
  await query('SET CONSTRAINTS ALL IMMEDIATE');await query('SET CONSTRAINTS ALL DEFERRED');
  assert.equal((await store.admitSignalTopicEditorialBatchV2(inputs)).replayed,true);
  return {...result,policy_version_id,inputs};
 }
 async function prepare(execution_id:string,requests=plan.requests){
  const input={database,execution_id,request_digests:requests.map(item=>item.request_digest),submission_key:randomUUID()};
  const batch=await store.prepareSignalTopicEditorialBatchV2(input);
  assert.equal((await store.prepareSignalTopicEditorialBatchV2(input)).batch_id,batch.batch_id);
  const lease=await store.claimDueSignalTopicEditorialBatchV2({database,batch_id:batch.batch_id});assert.ok(lease);
  return lease;
 }
 async function sendEnd(lease:store.SignalTopicEditorialBatchLeaseV2){
  await store.markSubmittingSignalTopicEditorialBatchV2({database,lease});
  const body=providerReceipt(`synthetic_${randomUUID()}`,lease.items.length,'in_progress');
  await store.attachProviderSignalTopicEditorialBatchV2({database,lease,receipt_body:body});
  assert.equal((await store.attachProviderSignalTopicEditorialBatchV2({database,lease,receipt_body:body})).replayed,true);
  await store.recordSignalTopicEditorialBatchPollV2({database,lease,receipt_body:providerReceipt(JSON.parse(body).id,lease.items.length,'ended'),next_poll_at:new Date().toISOString()});
 }
 async function persist(lease:store.SignalTopicEditorialBatchLeaseV2,index:number,invalidUsage=false,invalidOutput=false){
  const item=lease.items[index]!;const response=message(item.request,invalidUsage);
  if(invalidOutput)response.content[0]!.text='{"incomplete":true}';
  const raw_body=JSON.stringify({custom_id:item.custom_id,result:{type:'succeeded',message:response}});
  const input={database,lease,custom_id:item.custom_id,raw_body,storage_key:`synthetic/editorial-batch/${item.call_id}`};
  const result=await store.persistSignalTopicEditorialBatchItemV2(input);
  assert.equal((await store.persistSignalTopicEditorialBatchItemV2(input)).replayed,true);
  const validation=classifySignalTopicEditorialMessageResultV2(item.request,response);
  await store.recordSignalTopicEditorialBatchItemValidationV2({database,lease,custom_id:item.custom_id,validation});
  await denied(()=>store.persistSignalTopicEditorialBatchItemV2({...input,raw_body:raw_body+' '}),/receipt_immutable/);
  return {result,validation,raw_body};
 }
 await scenario('admission_replay_schema_scope_and_v1_isolation',async()=>{
  const admitted=await admission();
  const legacyStatus=await loadSignalTopicConsolidationEditorialStatusV1(seed.scope);
  assert.equal(legacyStatus.execution_id,null);assert.equal(legacyStatus.status,'not_requested');
  for(const request of plan.requests)assert.deepEqual((await query('SELECT signal_topic_editorial_output_schema_v2($1::jsonb) value',[JSON.stringify(request.receipt)])).rows[0]!.value,
   request.provider_request.params.output_config.format.schema);
  for(const change of ['missing_format','extra_tools']){
   const mutated=structuredClone(plan);const params=mutated.requests[0]!.provider_request.params as unknown as Record<string,unknown>;
   if(change==='missing_format')delete params.output_config;else params.tools=[];
   const {plan_digest:_,...core}=mutated;const body=store.signalTopicEditorialCanonicalBodyV2(core);mutated.plan_digest=hash(body);
   assert.equal((await query('SELECT signal_topic_editorial_plan_valid_v2($1,$2::jsonb,$3) value',[seed.scope.numeric_run_id,JSON.stringify(mutated),body])).rows[0]!.value,false);
  }
  await denied(()=>query("UPDATE signal_topic_editorial_executions SET status='running',execution_token=gen_random_uuid(),execution_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1",[admitted.execution_id]),/v2_owner_immutable/);
  const dispatch=(await query('SELECT claim_signal_topic_editorial_dispatch_v1(10) value')).rows[0]!.value;assert.deepEqual(dispatch,[]);
  assert.equal((await query('SELECT count(*)::int count FROM signal_topic_editorial_outbox WHERE execution_id=$1',[admitted.execution_id])).rows[0]!.count,0);
  await denied(()=>query('SELECT claim_signal_topic_editorial_execution_v1($1,$2,300)',[admitted.execution_id,`topic-editorial-${admitted.execution_id}-1`]),/v2_owner_immutable|unavailable|invalid/);
  await denied(()=>store.admitSignalTopicEditorialBatchV2({...admitted.inputs,execution_cap_micro_usd:'999999999'}),/idempotency_conflict/);
 });
 await scenario('long_prose_case_aliases_independent_items_and_exact_batch_price',async()=>{
  const admitted=await admission();const lease=await prepare(admitted.execution_id);await sendEnd(lease);
  const first=await persist(lease,0);assert.equal(first.result.settled_micro_usd,'534');assert.equal(first.result.usage_pending,false);
  assert.equal(first.validation.status,'accepted');
  if(first.validation.status==='accepted')assert.ok(Buffer.byteLength(first.validation.decision.rationale)>512);
  const second=await persist(lease,1,false,true);assert.equal(second.result.settled_micro_usd,'534');assert.equal(second.validation.status,'invalid_output');
  const finished=await store.finishSignalTopicEditorialBatchImportV2({database,lease});
  assert.deepEqual(finished,{state:'applied',accepted:1,failed:1,stage:'screening'});
  assert.equal((await query('SELECT sum(settled_micro_usd)::text total FROM signal_topic_editorial_calls WHERE execution_id=$1',[admitted.execution_id])).rows[0]!.total,'1068');
  assert.equal((await query('SELECT result_revision_id FROM signal_topic_editorial_executions WHERE id=$1',[admitted.execution_id])).rows[0]!.result_revision_id,null);
 });
 await scenario('lost_submission_ack_late_receipt_and_collect_after_revocation',async()=>{
  const admitted=await admission();let lease=await prepare(admitted.execution_id);await store.markSubmittingSignalTopicEditorialBatchV2({database,lease});
  await store.releaseSignalTopicEditorialBatchLeaseV2({database,lease,next_poll_at:null,submission_unknown:true,error_code:'topic_editorial_v2_submission_unknown'});
  assert.equal(await store.claimDueSignalTopicEditorialBatchV2({database,batch_id:lease.batch_id}),null);
  await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[admitted.policy_version_id]);
  await store.attachProviderSignalTopicEditorialBatchV2({database,lease,receipt_body:providerReceipt(`synthetic_${randomUUID()}`,2,'ended')});
  const collected=await store.claimDueSignalTopicEditorialBatchV2({database,batch_id:lease.batch_id});assert.ok(collected);lease=collected;
  await denied(()=>store.prepareSignalTopicEditorialBatchV2({database,execution_id:admitted.execution_id,request_digests:[plan.requests[0]!.request_digest],submission_key:randomUUID()}),/authority|expired|permission/);
  await persist(lease,0);await persist(lease,1);
  assert.equal((await store.finishSignalTopicEditorialBatchImportV2({database,lease})).stage,'review_pending');
  assert.equal((await query('SELECT count(*)::int count FROM signal_topic_editorial_calls WHERE execution_id=$1',[admitted.execution_id])).rows[0]!.count,2);
 });
 await scenario('unknown_usage_preserves_reservation_and_does_not_block_other_item',async()=>{
  const admitted=await admission();const lease=await prepare(admitted.execution_id);await sendEnd(lease);
  const first=await persist(lease,0,true);assert.equal(first.result.usage_pending,true);assert.equal(first.result.settled_micro_usd,null);
  await persist(lease,1);assert.equal((await store.finishSignalTopicEditorialBatchImportV2({database,lease})).stage,'screening');
  const call=(await query('SELECT status,reserved_micro_usd::text,settled_micro_usd FROM signal_topic_editorial_calls WHERE id=$1',[lease.items[0]!.call_id])).rows[0]!;
  assert.equal(call.status,'outcome_unknown');assert.equal(call.settled_micro_usd,null);assert.ok(BigInt(call.reserved_micro_usd as string)>0n);
 });
 await scenario('known_http_rejection_is_zero_settlement_and_manual_new_attempt',async()=>{
  const admitted=await admission();const lease=await prepare(admitted.execution_id);await store.markSubmittingSignalTopicEditorialBatchV2({database,lease});
  const rejected={database,lease,http_status:400,raw_body:'{"type":"error","error":{"type":"invalid_request_error"}}',complete:true,storage_key:`synthetic/http/${lease.batch_id}`};
  assert.equal((await store.rejectSignalTopicEditorialBatchSubmissionV2(rejected)).replayed,false);
  assert.equal((await store.rejectSignalTopicEditorialBatchSubmissionV2(rejected)).replayed,true);
  assert.equal((await query('SELECT sum(settled_micro_usd)::text total FROM signal_topic_editorial_calls WHERE execution_id=$1',[admitted.execution_id])).rows[0]!.total,'0');
  assert.equal(await store.claimDueSignalTopicEditorialBatchV2({database,batch_id:lease.batch_id}),null);
  const retry=await prepare(admitted.execution_id);assert.notEqual(retry.batch_id,lease.batch_id);
 });
 await scenario('paid_v1_checkpoint_reuse_does_not_create_v2_calls',async()=>{
  await policy(1);const legacy=source.plan;
  const quote=(await query('SELECT signal_topic_editorial_quote_v1($1,$2,$3,$4::jsonb,NULL) value',[workspace_id,actor_user_id,seed.scope.numeric_run_id,JSON.stringify(legacy)])).rows[0]!.value as {quote_reference:string};
  const owner=(await query('SELECT request_signal_topic_editorial_v1($1,$2,$3,$4::jsonb,$5,$6) value',[workspace_id,actor_user_id,seed.scope.numeric_run_id,JSON.stringify(legacy),randomUUID(),quote.quote_reference])).rows[0]!.value as {execution_id:string;worker_job_id:string};
  const dispatch=(await query('SELECT claim_signal_topic_editorial_dispatch_v1(1) value')).rows[0]!.value as Array<{dispatch_id:string;lease_token:string}>;
  await query('SELECT acknowledge_signal_topic_editorial_dispatch_v1($1,$2)',[dispatch[0]!.dispatch_id,dispatch[0]!.lease_token]);
  const lease=(await query('SELECT claim_signal_topic_editorial_execution_v1($1,$2,300) value',[owner.execution_id,owner.worker_job_id])).rows[0]!.value as {execution_token:string};
  const batch=legacy.batches[0]!;const reserved=(await query('SELECT reserve_signal_topic_editorial_call_v1($1,$2,$3,true) value',[owner.execution_id,lease.execution_token,batch.request_digest])).rows[0]!.value as {call_id:string;attempt_token:string};
  await query('SELECT mark_sent_signal_topic_editorial_call_v1($1,$2,$3,true)',[reserved.call_id,reserved.attempt_token,lease.execution_token]);
  const output=validateSignalTopicEditorialScreeningOutputV1(batch,{contract_version:'signal-topic-editorial-screening-output-v1',batch_index:0,
   decisions:batch.group_keys.map((group_key,index)=>({group_key,disposition:'topic',candidate:{candidate_key:`b0000-synthetic-${index}`,label:'Reparaciones sintéticas',definition:'Evidencia de reparación ficticia.',locale:legacy.default_locale},confidence:0.8,rationale:'La cita ficticia respalda la decisión.',cited_ref_ids:[batch.group_receipts[index]!.evidence_ref_ids[0]!]}))});
  const raw=JSON.stringify({id:'synthetic_v1',type:'message',role:'assistant',model:'claude-sonnet-4-6',stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:50,cache_creation_input_tokens:0,cache_read_input_tokens:0},content:[{type:'text',text:JSON.stringify(output)}]});
  await query('SELECT persist_signal_topic_editorial_receipt_v1($1,$2,$3,$4,$5,200,true,$6)',[reserved.call_id,reserved.attempt_token,batch.request_digest,raw,`synthetic/v1/${reserved.call_id}`,`synthetic:${reserved.call_id}`]);
  await query('SELECT settle_signal_topic_editorial_call_v1($1,$2)',[reserved.call_id,reserved.attempt_token]);
  const state={contract_version:'signal-topic-editorial-runner-v1',execution_key:owner.execution_id,plan_digest:legacy.plan_digest,phase:'global',screening_outputs:[output],global:null};
  const state_body=store.signalTopicEditorialCanonicalBodyV2(state),state_digest=hash(state_body);
  await query('UPDATE signal_topic_editorial_executions SET state_body=$2,state_digest=$3 WHERE id=$1',[owner.execution_id,state_body,state_digest]);
  await query('SELECT fail_signal_topic_editorial_execution_v1($1,$2,$3)',[owner.execution_id,lease.execution_token,'topic_editorial_synthetic_complete']);
  const retained=(await query('SELECT to_jsonb(c) value FROM signal_topic_editorial_calls c WHERE id=$1',[reserved.call_id])).rows[0]!.value;
  const admitted=await admission(owner.execution_id);
  const legacyStatus=await loadSignalTopicConsolidationEditorialStatusV1(seed.scope);
  assert.equal(legacyStatus.execution_id,owner.execution_id,'V1 reader must retain the historical owner when V2 is newer');
  assert.equal(legacyStatus.completed_screening_count,1);
  const source_call:SignalTopicEditorialPaidSourceCallV2={call_id:reserved.call_id,execution_id:owner.execution_id,workspace_id,run_id:seed.scope.numeric_run_id,status:'settled',response_http_status:200,response_complete:true,response_body_private:raw,response_sha256:hash(raw),response_output:output,
   request:{contract_version:'signal-topic-editorial-provider-request-v1',phase:'screening',idempotency_key:batch.batch_key,model:batch.model,request_digest:batch.request_digest,request_body:batch.request_body}};
  for(const request of plan.requests){
   const reuse=reuseSignalTopicEditorialPaidGroupV2({request,source_batch:batch,source_call,source:{kind:'historical_checkpoint',state_body,state_digest,source_plan_digest:legacy.plan_digest}});
   assert.equal(reuse.status,'reusable');if(reuse.status!=='reusable')throw Error('source_not_reusable');
   const input={database,execution_id:admitted.execution_id,request_digest:request.request_digest,reuse};
   assert.equal((await store.recordReusedSignalTopicEditorialDecisionV2(input)).replayed,false);
   assert.equal((await store.recordReusedSignalTopicEditorialDecisionV2(input)).replayed,true);
   await denied(()=>store.recordReusedSignalTopicEditorialDecisionV2({...input,reuse:{...reuse,decision:{...reuse.decision,rationale:'Tampered'}}}),/reuse_immutable/);
  }
  assert.equal((await query('SELECT count(*)::int count FROM signal_topic_editorial_calls WHERE execution_id=$1',[admitted.execution_id])).rows[0]!.count,0);
  await denied(()=>prepare(admitted.execution_id),/already_reused/);
  assert.deepEqual((await query('SELECT to_jsonb(c) value FROM signal_topic_editorial_calls c WHERE id=$1',[reserved.call_id])).rows[0]!.value,retained);
 });
 const afterDefinitions=(await query(`SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) body FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN(
   'signal_topic_editorial_owner_guard_v1','signal_topic_editorial_call_guard_v1','signal_topic_editorial_state_guard_v1',
   'signal_topic_editorial_request_guard_v1','signal_processing_admission_guard_v1') ORDER BY 1`)).rows;
 assert.deepEqual(afterDefinitions,beforeDefinitions);
 return {contract_version:'signal-topic-editorial-batch-v2-synthetic-acceptance',scenarios:checked,
  actual_provider_calls:0,fixture_root_count:3,fixture_group_count:2,materialization_tested:false,concurrency_tested:false,physical_rollback_owned_by_runner:true};
}
