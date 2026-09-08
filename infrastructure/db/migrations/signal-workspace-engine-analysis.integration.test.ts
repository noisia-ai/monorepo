import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import type {Pool,PoolClient} from 'pg';
import {signalWorkspaceInterpretationReferenceIdV1,buildSignalWorkspaceInterpretationBatchV1,SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,
 type SignalTopicDefinitionV1,type SignalWorkspaceInterpretationClusterV1} from '@noisia/query-engine';
import * as engine from '../signal-workspace-engine';
import * as money from '../signal-workspace-engine-interpretation';
import {insertSignalTaxonomyDraftCoreV1} from '../signal-taxonomy-profile';
import {loadSignalTopicInheritedContextStoreV1,materializeSignalWorkspaceEngineTopicsV1} from '../signal-topic-catalog';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
const sha=(s:string)=>`sha256:${createHash('sha256').update(s,'utf8').digest('hex')}`;
const unitsDigest=(keys:string[])=>sha([...keys].sort().map(key=>JSON.stringify(key)+'\n').join(''));
async function fixture(){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const pool=new pg.Pool({connectionString:url.href,ssl:false,max:1}),client=await pool.connect();
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query('SET LOCAL search_path=public,extensions,pg_temp');
 const stack:string[]=[];let index=0;const query=async(sql:string,params?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const key=`analysis_${++index}`;stack.push(key);return client.query(`SAVEPOINT ${key}`);}
  if(sql==='COMMIT')return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==='ROLLBACK'){const key=stack.pop()!;await client.query(`ROLLBACK TO SAVEPOINT ${key}`);return client.query(`RELEASE SAVEPOINT ${key}`);}
  return client.query(sql,params);
 };
 const scoped=Object.create(client) as PoolClient;scoped.query=query as PoolClient['query'];scoped.release=()=>{};
 const database=Object.assign(Object.create(pool) as Pool,{query:query as Pool['query'],connect:async()=>scoped});
 const workspace_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_WORKSPACE_ID!,actor_user_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_ACTOR_ID!,embedding_run_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_EMBEDDING_ID!;
 assert.ok(workspace_id&&actor_user_id&&embedding_run_id);
 const context=await loadSignalTopicInheritedContextStoreV1({queryable:database,workspace_id,complete_context:true});
 const catalog=async(terms:SignalTopicDefinitionV1[]=[],metadata:Record<string,unknown>={})=>insertSignalTaxonomyDraftCoreV1({client:scoped,workspace_id,kind:'topic',context_hash:sha('local-analysis-catalog'),
  terms:terms.map(topic=>({term_key:topic.term_key,label:topic.label,definition:topic.definition,metadata:{topic}})),rules:{topics:terms},rule_set_metadata:{},provider:'operator',model_version:'local',
  prompt_hash:sha('local'),model_metadata:{},profile_metadata:{contract_version:'signal-topic-catalog-v1',...metadata},context_refs:context.context_refs});
 await catalog();
 const access={database,workspace_id,actor_user_id};
 const cleanup=async()=>{await client.query('ROLLBACK');client.release();await pool.end();};
 return{query,database,access,workspace_id,actor_user_id,embedding_run_id,catalog,cleanup};
}
test('one analysis keeps fit and metered interpretation recoverable, rejects partial completion and preserves semantic input identity across own outputs', {skip:!enabled,timeout:90_000},async()=>{
 const f=await fixture();try{
  const configuration:money.SignalWorkspaceEngineInterpretationConfigurationV1=SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1;
  const interpretation_config={call_configuration:configuration,budget_timezone:'America/Mexico_City',daily_cap_micro_usd:30_000_000};
  const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(f.access);assert.equal(preflight.missing_guides,0);
  const request={...f.access,embedding_run_id:f.embedding_run_id,idempotency_key:randomUUID(),expected_catalog_digest:preflight.expected_catalog_digest,
   expected_context_digest:preflight.expected_context_digest,engine_config:{fixture:'transition-only'},parent_execution_id:null,claude_cap_micro_usd:30_000_000,interpretation_config};
  const started=await engine.beginSignalWorkspaceEngineV1(request);assert.equal((await engine.beginSignalWorkspaceEngineV1(request)).execution_id,started.execution_id);
  await assert.rejects(engine.beginSignalWorkspaceEngineV1({...request,interpretation_config:{...interpretation_config,daily_cap_micro_usd:1}}),/idempotency_conflict/u);
  let lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-integrated-analysis'});assert.ok(lease);
  const reserve=(key:string,token=lease!.execution_token,config=configuration,request_digest=sha(key),reserved_micro_usd=1000)=>money.reserveSignalWorkspaceEngineInterpretationV1({...f.access,...started,idempotency_key:key,request_digest,configuration:config,
   reserved_micro_usd,budget_timezone:interpretation_config.budget_timezone,daily_cap_micro_usd:interpretation_config.daily_cap_micro_usd,execution_token:token});
  await assert.rejects(reserve(randomUUID()),/fit_required/u);
  const coverage={roots:lease.snapshot.expected_roots,chunks:lease.snapshot.expected_chunks,guides:lease.snapshot.expected_guides};
  // This tests the post-fit transaction seam; no numerical fit or provider is rerun.
  await engine.heartbeatSignalWorkspaceEngineV1({database:f.database,lease,exported:{...coverage,stream_digest:sha('verified local fixture export')},phase:'fitting'});
  const artifact=(key:string,type:engine.SignalWorkspaceEngineArtifactV1['artifact_type'],metadata:Record<string,unknown>={}):engine.SignalWorkspaceEngineArtifactV1=>({
   artifact_key:key,artifact_type:type,title:'Private local transition fixture',storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/${key}`,
   sha256:sha(key),size_bytes:10,media_type:'application/json',metadata});
  const model=await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:artifact('model.json','engine_model')});
  const output=await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:artifact('manifest.json','engine_output')});
  const fitArgs={database:f.database,lease,model_artifact_id:model.artifact_id,output_artifact_id:output.artifact_id,result_kind:'computational_grouping' as const,coverage,
   model_configuration:{fixture:true},runtime_kind:'python',artifact_format:'workspace-model-bundle-v1',license_key:'local-only'};
  await assert.rejects(engine.finishSignalWorkspaceEngineFitV1(fitArgs),/analysis_incomplete/u);
  const keys=['open:stable_one','guided:stable_two'],manifest={unit_count:2,unit_digest:unitsDigest(keys)};
  const fit=await engine.checkpointSignalWorkspaceEngineFitV1({...fitArgs,interpretation_manifest:manifest});
  assert.deepEqual(await engine.checkpointSignalWorkspaceEngineFitV1({...fitArgs,interpretation_manifest:manifest}),fit);
  const governed=await engine.readSignalWorkspaceEngineInterpretationContextV1({database:f.database,lease});
  assert.equal(governed.actor_user_id,f.actor_user_id);assert.equal(governed.context.context_digest,preflight.expected_context_digest);
  assert.deepEqual(governed.context.data.interests,[]);assert.ok(governed.context.data.brand_os);
  // A parseable body from an incomplete HTTP transport is durable evidence, never settled usage.
  await f.query('BEGIN');try{
   const partial=await reserve(randomUUID()),token={database:f.database,call_id:partial.call_id,attempt_token:partial.attempt_token};
   await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:lease.execution_token});
   const response={storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/partial.json`,sha256:sha('{"usage":{"input_tokens":1}}'),size_bytes:28,http_status:200,provider_request_id:null,complete:false};
   assert.equal((await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response})).response?.complete,false);
   assert.equal((await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response})).response?.complete,false);
   await assert.rejects(money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{...response,complete:true}}),/response_conflict/u);
   await assert.rejects(money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:1,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}}),/response_incomplete/u);
   assert.equal((await money.failSignalWorkspaceEngineInterpretationV1({...token,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_receipt_persistence_unknown'})).state,'outcome_unknown','partial receipts never gain the narrow complete-receipt recovery');
   const partialBudget=await money.loadSignalWorkspaceEngineInterpretationBudgetV1({...f.access,...started});
   assert.equal(partialBudget.confirmed_micro_usd,0);assert.equal(partialBudget.unknown_reserved_micro_usd,1000);
  }finally{await f.query('ROLLBACK');}
  const example=(await engine.readSignalWorkspaceEngineChunksV1({database:f.database,lease,after:null,limit:1})).items[0]!;
  const referenceIdentity={root_id:example.root_id,chunk_index:example.chunk_index,start:example.start,end:example.end,chunk_sha256:example.chunk_sha256};
  const ref_id=signalWorkspaceInterpretationReferenceIdV1(referenceIdentity);
  const packet=(key:string)=>{
   const cluster:SignalWorkspaceInterpretationClusterV1={cluster_id:key,lane:key.startsWith('open:')?'open':'guided',cluster_digest:sha(key),root_count:1,chunk_count:1,terms:['local evidence'],
    representatives:[{...referenceIdentity,ref_id,text:example.text,strength:0.8,selection_reason:'high_affiliation'}]};
   const batch=buildSignalWorkspaceInterpretationBatchV1(governed.context,[cluster]);
   return {batch,body:JSON.stringify({contract_version:'workspace-engine-interpretation-result-v1',execution_id:started.execution_id,context:batch.context,clusters:batch.clusters,interpretations:[{
    cluster_id:key,cluster_digest:cluster.cluster_digest,status:'coherent',name:'Local evidence',definition:'A local conversation supported by the referenced fragment.',
    inclusion:[{text:'The referenced conversation.',citations:[ref_id]}],exclusion:[],citations:[ref_id]}]})};
  };
  const firstPacket=packet(keys[0]!),secondPacket=packet(keys[1]!);
  const firstBody=firstPacket.body,secondBody=secondPacket.body;
  const proposalArtifact=(name:string,body:string)=>({...artifact(name,'engine_proposals'),sha256:sha(body),size_bytes:Buffer.byteLength(body)});
  assert.equal((await engine.loadSignalWorkspaceEngineStatusV1(f.access)).latest_run?.phase,'interpreting');
  await assert.rejects(reserve(randomUUID(),randomUUID()),/lease_conflict/u);
  await assert.rejects(reserve(randomUUID(),lease.execution_token,{...configuration,model:'other'}),/config_mismatch/u);
  const call=await reserve(randomUUID(),lease.execution_token,configuration,firstPacket.batch.request_digest,firstPacket.batch.reserved_micro_usd),callToken={database:f.database,call_id:call.call_id,attempt_token:call.attempt_token};
  assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({...callToken,execution_token:lease.execution_token})).send_authorized,true);
  await f.query("UPDATE signal_topic_catalog_executions SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[started.execution_id]);
  await money.persistSignalWorkspaceEngineInterpretationResponseV1({...callToken,response:{storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/raw-response.json`,sha256:sha('raw'),size_bytes:10,http_status:200,provider_request_id:'local'}});
  await f.query('BEGIN');try{
   assert.equal((await money.failSignalWorkspaceEngineInterpretationV1({...callToken,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_response_model_invalid'})).state,'outcome_unknown','a complete transport does not validate unknown model/usage');
  }finally{await f.query('ROLLBACK');}
  assert.equal((await money.failSignalWorkspaceEngineInterpretationV1({...callToken,outcome:'outcome_unknown',error_code:'workspace_engine_interpretation_receipt_persistence_unknown'})).state,'response_persisted','lost persistence ACK preserves a complete durable receipt');
  assert.equal(engine.isSignalWorkspaceEngineRetryableErrorV1('workspace_engine_interpretation_receipt_recovery_required'),true);
  await money.settleSignalWorkspaceEngineInterpretationV1({...callToken,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
  await assert.rejects(engine.checkpointSignalWorkspaceEngineInterpretationV1({database:f.database,lease,call_id:call.call_id,artifact:artifact('interpretation-1.json','engine_proposals'),unit_keys:[keys[0]!]}),/lease_conflict/u);
  lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...started,worker_job_id:'local-recovered-analysis'});assert.ok(lease);
  assert.deepEqual(await engine.readSignalWorkspaceEngineFitCheckpointV1({database:f.database,lease}),fit);
  const first={database:f.database,lease,call_id:call.call_id,artifact:proposalArtifact('interpretation-1.json',firstBody),unit_keys:[keys[0]!]};
  const firstCheckpoint=await engine.checkpointSignalWorkspaceEngineInterpretationV1(first);assert.equal(firstCheckpoint.interpreted_units,1);
  assert.equal((await engine.checkpointSignalWorkspaceEngineInterpretationV1(first)).replayed,true);
  await f.query('BEGIN');try{await assert.rejects(f.query("UPDATE analysis_artifacts SET metadata=metadata||'{\"unit_keys\":[\"open:tampered\"]}'::jsonb WHERE engine_execution_id=$1::uuid AND artifact_key='interpretation-1.json'",[started.execution_id]),/immutable/u);}finally{await f.query('ROLLBACK');}
  await assert.rejects(engine.checkpointSignalWorkspaceEngineInterpretationV1({...first,artifact:artifact('duplicate.json','engine_proposals')}),/duplicate/u);
  await assert.rejects(engine.completeSignalWorkspaceEngineAnalysisV1({database:f.database,lease,materialization_artifact_id:randomUUID()}),/analysis_incomplete/u);
  await f.query('BEGIN');try{await assert.rejects(f.query("UPDATE signal_topic_catalog_executions SET status='ready',completed_at=clock_timestamp(),execution_token=NULL,execution_expires_at=NULL WHERE id=$1::uuid",[started.execution_id]),/partial interpretation/u);}finally{await f.query('ROLLBACK');}
  // Same-run/config is not enough: the receipt must belong to the exact request packet.
  await f.query('BEGIN');try{
   const wrong=await engine.checkpointSignalWorkspaceEngineInterpretationV1({...first,artifact:proposalArtifact('interpretation-wrong.json',secondBody),unit_keys:[keys[1]!]});
   async function* wrongProposals(){yield{artifact_id:firstCheckpoint.artifact_id,body:firstBody};yield{artifact_id:wrong.artifact_id,body:secondBody};}
   await assert.rejects(materializeSignalWorkspaceEngineTopicsV1({database:f.database,lease,proposals:wrongProposals()}),/proposal_request_mismatch/u);
  }finally{await f.query('ROLLBACK');}
  const secondCall=await reserve(randomUUID(),lease.execution_token,configuration,secondPacket.batch.request_digest,secondPacket.batch.reserved_micro_usd);
  const secondToken={database:f.database,call_id:secondCall.call_id,attempt_token:secondCall.attempt_token};
  await money.markSignalWorkspaceEngineInterpretationSentV1({...secondToken,execution_token:lease.execution_token});
  await money.persistSignalWorkspaceEngineInterpretationResponseV1({...secondToken,response:{storage_key:`workspace-engine/${f.workspace_id}/${started.execution_id}/raw-response-2.json`,sha256:sha('raw2'),size_bytes:10,http_status:200,provider_request_id:'local2'}});
  await money.settleSignalWorkspaceEngineInterpretationV1({...secondToken,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
  const secondCheckpoint=await engine.checkpointSignalWorkspaceEngineInterpretationV1({...first,call_id:secondCall.call_id,artifact:proposalArtifact('interpretation-2.json',secondBody),unit_keys:[keys[1]!]});
  assert.equal(secondCheckpoint.interpreted_units,2);
  assert.equal((await engine.loadSignalWorkspaceEngineStatusV1(f.access)).latest_run?.phase,'materializing');
  async function* proposals(){yield{artifact_id:firstCheckpoint.artifact_id,body:firstBody};yield{artifact_id:secondCheckpoint.artifact_id,body:secondBody};}
  const materialization=await materializeSignalWorkspaceEngineTopicsV1({database:f.database,lease,proposals:proposals()});
  const replay=await materializeSignalWorkspaceEngineTopicsV1({database:f.database,lease,proposals:proposals()});
  assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:false},materialization,'lost writer response reuses the same complete catalog without erasing Topics');
  assert.equal(materialization.topic_count,2);assert.equal(materialization.discovered_topic_count,2);
  const identity=await engine.loadSignalWorkspaceEngineInputIdentityV1({queryable:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id});
  assert.deepEqual(identity,{context_digest:preflight.expected_context_digest,catalog_digest:preflight.expected_catalog_digest},'new output profile and discovered Topic do not alter the input-interest identity');
  await assert.rejects(engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:artifact('materialization.json','engine_proposals',{
   contract_version:'workspace-topic-materialization-v1',execution_id:started.execution_id,interpretation_units_digest:manifest.unit_digest,
   output_catalog_profile_id:materialization.output_catalog_profile_id,output_catalog_revision:materialization.output_catalog_revision,topic_count:2,mapping_digest:sha('other mapping')})}),/materialization is invalid/u);
  const materialized=await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:artifact('materialization.json','engine_proposals',{
   contract_version:'workspace-topic-materialization-v1',execution_id:started.execution_id,interpretation_units_digest:manifest.unit_digest,
   output_catalog_profile_id:materialization.output_catalog_profile_id,output_catalog_revision:materialization.output_catalog_revision,topic_count:materialization.topic_count,mapping_digest:materialization.mapping_digest})});
  const final=await engine.completeSignalWorkspaceEngineAnalysisV1({database:f.database,lease,materialization_artifact_id:materialized.artifact_id});
  assert.equal(final.topic_count,2);const status=await engine.loadSignalWorkspaceEngineStatusV1(f.access);
  assert.equal(status.latest_run?.status,'ready');assert.equal(status.latest_run?.is_current,true);assert.equal(status.latest_run?.interpreted_units,2);assert.equal(status.latest_run?.materialized_topics,2);
  assert.deepEqual((await f.query('SELECT status FROM signal_tagging_model_version_events WHERE model_version_id=$1::uuid',[fit.model_version_id])).rows,[{status:'draft'}]);
  const budget=await money.loadSignalWorkspaceEngineInterpretationBudgetV1({...f.access,...started});assert.equal(budget.confirmed_micro_usd,3500);assert.equal(budget.reserved_micro_usd,0);
 }finally{await f.cleanup();}
});
