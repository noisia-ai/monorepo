import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {buildSignalTopicEditorialBatchPlanFromPreparedInputV2} from '@noisia/query-engine';
import * as numeric from '../signal-topic-consolidation';
import * as control from '../signal-topic-consolidation-control';
import * as editorial from '../signal-topic-editorial-admission-v3';
import {loadSignalTopicConsolidationEditorialInputV1} from '../signal-topic-consolidation-editorial-input';
import {prepareAllSignalTopicEditorialBatchV2} from '../signal-topic-editorial-batch-v2';

/** One explicitly synthetic numerical group over an existing eligible chunk.
 * Caller owns the verified connection and physical rollback. No fit or transport. */
export async function exerciseDiscoveryEditorialV1(args:{database:Pool;raw:PoolClient;workspace_id:string;actor_user_id:string;
  internal_user_id:string;organization_id:string;brand_id:string;source_execution_id:string;root_id:string}){
 const {database,raw,workspace_id,actor_user_id,source_execution_id}=args;
 const access={database,workspace_id,actor_user_id};
 const binding=(await raw.query('SELECT signal_topic_consolidation_source_binding_v1($1::uuid) value',[source_execution_id])).rows[0].value;
 assert.ok(binding,'synthetic fit must resolve through the real source guard');
 const status=await control.loadSignalTopicConsolidationStatusV1({...access,source_execution_id});
 assert.equal(status.status,'ready_to_prepare');assert.ok(status.quote_reference);
 const requested=await control.requestSignalTopicConsolidationV1({...access,source_execution_id,idempotency_key:randomUUID(),quote_reference:status.quote_reference});
 await raw.query('SET CONSTRAINTS ALL IMMEDIATE');await raw.query('SET CONSTRAINTS ALL DEFERRED');
 const dispatched=await control.claimSignalTopicConsolidationDispatchV1({database,worker_id:'synthetic-discovery-editorial',limit:1});
 assert.equal(dispatched.length,1);assert.equal(dispatched[0]!.execution_id,requested.execution_id);
 const lease=await control.claimSignalTopicConsolidationExecutionV1({database,...requested});
 assert.ok(lease&&!('completed' in lease));
 const chunk=(await raw.query(`SELECT item.root_id,asset.chunks->'chunks'->0 chunk FROM signal_topic_catalog_executions execution
  JOIN signal_corpus_preparation_items item ON item.run_id=execution.preparation_run_id AND item.workspace_id=execution.workspace_id
  JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
  WHERE execution.id=$1 AND item.root_id=$2 AND item.disposition='eligible'`,[source_execution_id,args.root_id])).rows[0];
 assert.ok(chunk);
 const metadata=(await numeric.loadSignalTopicConsolidationRootMetadataV1({queryable:database,workspace_id,root_ids:[args.root_id]}))[0]!;
 const digest=numeric.signalTopicConsolidationDigestV1;
 const locator={root_id:args.root_id,chunk_index:0,start:chunk.chunk.start,end:chunk.chunk.end,chunk_sha256:chunk.chunk.sha256};
 const dossier={contract_version:'signal-topic-group-dossier-v1',scope_counts:{brand:0,competitor:0,category:0,unknown:0,[metadata.scope]:1},
  locale_counts:metadata.locale?[{key:metadata.locale,count:1}]:[],platform_counts:metadata.platform?[{key:metadata.platform,count:1}]:[],
  month_counts:metadata.occurred_at?[{key:metadata.occurred_at.slice(0,7),count:1}]:[],brand_affinity:{positive:[],negative:[],abstention:[]},
  neighbors:[],metrics:{cohesion:null,outlier_ratio:null},evidence:[{...locator,ref_id:digest(locator),locale:metadata.locale,platform:metadata.platform,occurred_at:metadata.occurred_at}]};
 const configuration=(await raw.query('SELECT signal_topic_consolidation_numeric_configuration_v1() value')).rows[0].value;
 const group={group_key:'open:fixture',lane:'open',stable_cluster_id:'fixture',local_label:0,group_digest:digest(locator),root_count:1,chunk_count:1,
  terms:['Synthetic grouping only'],dossier,dossier_digest:digest(dossier),centroid:null,
  roots:[{root_id:args.root_id,chunk_count:1,strength:0.8,assignment_digest:digest(locator)}]};
 const census={contract_version:'signal-topic-consolidation-v1',workspace_id,source_execution_id,
  source_checkpoint_digest:binding.source_checkpoint_digest,output_artifact_id:binding.output_artifact_id,output_artifact_sha256:binding.output_artifact_sha256,
  model_artifact_id:binding.model_artifact_id,model_artifact_sha256:binding.model_artifact_sha256,context_digest:binding.context_digest,
  centroid_artifact_id:null,centroid_artifact_sha256:null,configuration,configuration_digest:digest(configuration),expected_group_count:1,groups:[group]};
 const result=await numeric.materializeSignalTopicAtomicCensusV1({database,actor_user_id,census,control_execution:lease});
 const members=[{group_key:group.group_key,rank:0,similarity:1}];
 await numeric.materializeSignalTopicCommunityPlanV1({...access,...result,source_execution_id,control_execution:lease,
  plan:{contract_version:'signal-topic-centroid-community-plan-v1',configuration_digest:digest(configuration),
   communities:[{community_key:'synthetic:fixture',community_digest:digest({members}),members}]}});
 assert.equal(await control.completeSignalTopicConsolidationExecutionV1({database,lease,consolidation_run_id:result.consolidation_run_id}),true);
 const source=await loadSignalTopicConsolidationEditorialInputV1({...access,numeric_run_id:result.consolidation_run_id});
 const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input:source,run_id:result.consolidation_run_id});
 const reject=async(work:()=>Promise<unknown>,pattern:RegExp)=>{await raw.query('SAVEPOINT editorial_negative');try{await assert.rejects(work,pattern);}
  finally{await raw.query('ROLLBACK TO SAVEPOINT editorial_negative');await raw.query('RELEASE SAVEPOINT editorial_negative');}};
 for(const [cap,daily] of [[null,null],['100000000',null],['1',null],[null,'1']] as const){
  await raw.query('SAVEPOINT editorial_scenario');
  const previous=(await raw.query("SELECT id,budget_timezone,valid_until::text FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'",[args.organization_id])).rows[0];
  assert.ok(previous);
  const policyId=randomUUID();
  await raw.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT $1,$2,COALESCE(max(version),0)+1,'draft',clock_timestamp()-interval '1 second',$5::timestamptz,$6,$3,$4
   FROM signal_processing_policy_versions WHERE organization_id=$2`,[policyId,args.organization_id,daily,args.internal_user_id,previous.valid_until,previous.budget_timezone]);
  await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action<>'topic_consolidation'`,[policyId,previous.id]);
  await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $1,'topic_consolidation','provider','anthropic','claude-sonnet-4-6',config,signal_semantic_context_digest_json_v2(config),$2,false
   FROM (SELECT signal_topic_editorial_configuration_v2() config) configuration`,[policyId,cap]);
  await raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE organization_id=$1 AND status='active'",[args.organization_id]);
  await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policyId]);
  const quote=await editorial.quoteSignalTopicEditorialChunkedAdmissionV3({...access,plan,deadline:Math.floor(Date.now()/1000)+1800});
  assert.equal(quote.status,'ready_to_authorize');assert.equal(quote.maximum_micro_usd,cap);assert.ok(quote.quote_reference);
  const request={...access,plan,idempotency_key:randomUUID(),quote_reference:quote.quote_reference};
  const admitted=await editorial.requestSignalTopicEditorialChunkedAdmissionV3(request);
  assert.equal((await editorial.requestSignalTopicEditorialChunkedAdmissionV3(request)).execution_id,admitted.execution_id);
  const receipt=(await raw.query(`SELECT e.hard_cap_micro_usd::text cap,a.actor_user_id,a.target_id,a.execution_cap_micro_usd::text admission_cap
   FROM signal_topic_editorial_executions e JOIN signal_processing_admissions a ON a.id=e.processing_admission_id WHERE e.id=$1`,[admitted.execution_id])).rows[0];
  assert.equal(receipt.cap,cap);assert.equal(receipt.admission_cap,cap);assert.equal(receipt.actor_user_id,actor_user_id);assert.equal(receipt.target_id,admitted.execution_id);
  await raw.query('SAVEPOINT editorial_revoke');
  await raw.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2',[actor_user_id,args.brand_id]);
  assert.equal((await editorial.quoteSignalTopicEditorialChunkedAdmissionV3({...access,plan,deadline:Math.floor(Date.now()/1000)+1800})).status,'access_required');
  await reject(()=>prepareAllSignalTopicEditorialBatchV2({database,execution_id:admitted.execution_id}),/forbidden|authorization|actor/);
  await raw.query('ROLLBACK TO SAVEPOINT editorial_revoke');await raw.query('RELEASE SAVEPOINT editorial_revoke');
  if(daily!==null||cap==='1')await reject(()=>prepareAllSignalTopicEditorialBatchV2({database,execution_id:admitted.execution_id}),/cap|budget/);
  else {
   const manifest=await prepareAllSignalTopicEditorialBatchV2({database,execution_id:admitted.execution_id});assert.equal(manifest.provider_items,1);
   const calls=(await raw.query('SELECT status,reserved_micro_usd::text reserved FROM signal_topic_editorial_calls WHERE execution_id=$1',[admitted.execution_id])).rows;
   assert.equal(calls.length,1);assert.equal(calls[0].status,'reserved');assert.ok(BigInt(calls[0].reserved)>0n);
  }
  await raw.query('SET CONSTRAINTS ALL IMMEDIATE');await raw.query('ROLLBACK TO SAVEPOINT editorial_scenario');await raw.query('RELEASE SAVEPOINT editorial_scenario');
 }
}
