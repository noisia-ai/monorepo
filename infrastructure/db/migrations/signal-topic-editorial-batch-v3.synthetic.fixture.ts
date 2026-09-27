import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildSignalTopicEditorialBatchPlanFromPreparedInputV2} from '../../../packages/query-engine/src/signal-topic-consolidation-editorial-v2';
import {buildSignalTopicEditorialAdmissionHeaderV3} from '../../../packages/query-engine/src/signal-topic-editorial-admission-v3';
import {loadSignalTopicConsolidationEditorialInputV1} from '../signal-topic-consolidation-editorial-input';
import {quoteSignalTopicEditorialChunkedAdmissionV3,replaySignalTopicEditorialChunkedAdmissionV3,
 requestSignalTopicEditorialChunkedAdmissionV3} from '../signal-topic-editorial-admission-v3';
import {prepareAllSignalTopicEditorialBatchV2,signalTopicEditorialCanonicalBodyV2} from '../signal-topic-editorial-batch-v2';
import {seedSignalTopicEditorialRenewalSourceV1} from './signal-topic-editorial-renewal.synthetic.fixture';
import type {SyntheticTransactionV1} from './signal-client-workspace-entry.synthetic.fixture';

/** Run only in the guarded empty dev-test transaction; every fixture row and
 * reservation is physically rolled back by the runner. No provider transport. */
export async function exerciseSignalTopicEditorialBatchV3Synthetic(args:SyntheticTransactionV1){
 const {query,database}=args;
 const seed=await seedSignalTopicEditorialRenewalSourceV1(args);
 const source=await loadSignalTopicConsolidationEditorialInputV1(seed.scope);
 const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input:source,run_id:seed.scope.numeric_run_id});
 const header=buildSignalTopicEditorialAdmissionHeaderV3(plan);
 assert.equal(plan.expected_group_count,2);
 const {admission_digest,...unsigned}=header;
 assert.equal((await query('SELECT signal_topic_editorial_header_valid_v3($1::uuid,$2::jsonb,$3) value',
  [seed.scope.numeric_run_id,JSON.stringify(header),signalTopicEditorialCanonicalBodyV2(unsigned)])).rows[0]?.value,true);
 const first=plan.requests[0]!;
 const {request_digest,provider_request,...record}=first;
 const core=signalTopicEditorialCanonicalBodyV2({...record,params:provider_request.params});
 const params=JSON.stringify(provider_request.params);
 assert.equal((await query('SELECT signal_topic_editorial_request_valid_v3($1::uuid,$2::jsonb,$3::jsonb,$4,$5,0) value',
  [seed.scope.numeric_run_id,JSON.stringify(header),JSON.stringify(first),core,params])).rows[0]?.value,true);
 const tampered={...first,source_group:{...first.source_group,group_key:'foreign:cluster'}};
 assert.equal((await query('SELECT signal_topic_editorial_request_valid_v3($1::uuid,$2::jsonb,$3::jsonb,$4,$5,0) value',
  [seed.scope.numeric_run_id,JSON.stringify(header),JSON.stringify(tampered),core,params])).rows[0]?.value,false);
 const {organization_id,actor_user_id,workspace_id}=seed.identity;
 const policyId=randomUUID();
 await query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,valid_from,valid_until,
  budget_timezone,daily_cap_micro_usd,created_by_user_id)
  SELECT $1,$2,COALESCE(max(version),0)+1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',
   'America/Mexico_City',10000000000,$3 FROM signal_processing_policy_versions WHERE organization_id=$2`,
  [policyId,organization_id,actor_user_id]);
 await query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
  configuration_digest,max_execution_micro_usd,automatic_allowed)
  SELECT $1,'topic_consolidation','provider','anthropic','claude-sonnet-4-6',configuration,
   signal_semantic_context_digest_json_v2(configuration),1000000000,false
   FROM (SELECT signal_topic_editorial_configuration_v2() configuration) body`,[policyId]);
 await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE organization_id=$1 AND status='active'",[organization_id]);
 await query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policyId]);
 const deadline=Math.floor(Date.now()/1000)+1800;
 const quote=await quoteSignalTopicEditorialChunkedAdmissionV3({database,workspace_id,actor_user_id,plan,deadline});
 assert.equal(quote.status,'ready_to_authorize');assert.ok(quote.quote_reference);
 const key=`synthetic-v3-${randomUUID()}`;
 const admitted=await requestSignalTopicEditorialChunkedAdmissionV3({database,workspace_id,actor_user_id,plan,
  idempotency_key:key,quote_reference:quote.quote_reference!});
 assert.equal(admitted.expected_items,2);assert.equal(admitted.replayed,false);
 await query('SET CONSTRAINTS ALL IMMEDIATE');await query('SET CONSTRAINTS ALL DEFERRED');
 const replay=await replaySignalTopicEditorialChunkedAdmissionV3({database,workspace_id,actor_user_id,
  numeric_execution_id:seed.numeric_execution_id,idempotency_key:key,
  quote_reference:quote.quote_reference!,confirmed_cap_micro_usd:quote.maximum_micro_usd!});
 assert.equal(replay.execution_id,admitted.execution_id);assert.equal(replay.replayed,true);
 const rows=(await query('SELECT count(*)::integer n FROM signal_topic_editorial_requests WHERE execution_id=$1::uuid',
  [admitted.execution_id])).rows[0]?.n;
 assert.equal(rows,2);
 const manifest=await prepareAllSignalTopicEditorialBatchV2({database,execution_id:admitted.execution_id});
 assert.equal(manifest.provider_items,2);assert.ok(manifest.batch_id);
 return {contract_version:'signal-topic-editorial-batch-v3-synthetic-acceptance',groups:2,
  scenarios:['header_and_evidence','tamper_rejected','atomic_admission','same_key_replay','manifest_without_provider'],
  provider_transports:0};
}
