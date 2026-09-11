import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {SignalTopicCatalogError} from './signal-topic-catalog';
import {loadSignalWorkspaceEngineStatusV1,loadSignalWorkspaceEnginePreflightV1} from './signal-workspace-engine';
import {loadSignalWorkspaceIncrementalEditorialAdmissionV1} from './signal-workspace-incremental-editorial';
import {loadSignalWorkspaceIncrementalEditorialPreparationV1,requestSignalWorkspaceIncrementalEditorialPreparationV1} from './signal-workspace-incremental-editorial-preparation';
import {loadSignalWorkspaceIncrementalEditorialStatusV1} from './signal-workspace-incremental-editorial-status';
import {readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1} from './signal-workspace-incremental-editorial-renewal';
import {loadSignalWorkspaceAnalysisUpdateV1} from './signal-workspace-incremental-projection';
import {loadSignalWorkspaceInterpretationAdmissionV1,authorizeSignalWorkspaceInterpretationAdmissionV1} from './signal-workspace-interpretation-admission';
import {loadSignalWorkspaceNumericReadinessV1,admitSignalWorkspaceNumericUpdateV1} from './signal-workspace-numeric-producer';

const workspace='10000000-0000-4000-8000-000000000001';
const actor='10000000-0000-4000-8000-000000000002';
const numeric='10000000-0000-4000-8000-000000000003';
const owner='10000000-0000-4000-8000-000000000004';
const operation='10000000-0000-4000-8000-000000000005';
const stamp='2026-09-11T12:00:00.000Z';
const sha=digest('sealed context');
const requestKey='historical-accepted-request';
const admission={execution_id:owner,numeric_execution_id:numeric,operation_id:operation,actor_user_id:actor,
  action:'authorize_interpretation',admission_not_after:'2026-09-12T12:00:00.000Z',grant_cap_micro_usd:900};
const retryReceipt={execution_id:owner,actor_user_id:actor,accepted_at:stamp,retry_count:1};
const sourceSeal={numeric_execution_id:numeric,history_cut_digest:sha};
const preparationReceipt={numeric_execution_id:numeric,actor_user_id:actor,operation_id:operation,
  source_digest:digest(sourceSeal),source:sourceSeal,charge_micro_usd:0};
const catalogReceipt={numeric_execution_id:numeric,output_catalog_profile_id:operation,topic_count:4};

/** Fault injection at the identity query boundary, with real public readers,
 * capability resolution and downstream receipt/cost projection. No DB or provider. */
function fixture(identityError:Error,denied=false){
  const queries:string[]=[];
  let identities=0,released=0;
  const client={release(){released++;},async query(sql:string,params:unknown[]=[]){
    queries.push(sql);
    assert.ok(!/\b(?:INSERT|UPDATE|DELETE)\s/iu.test(sql),'historical readers must not write');
    if(/^(?:BEGIN|SET|COMMIT|ROLLBACK)\b/u.test(sql)||sql.includes('pg_advisory_xact_lock')
      ||sql.startsWith('SELECT workspace_id FROM signal_corpus_preparation_input_state'))return{rows:[],rowCount:0};
    if(sql.includes('workspace.status workspace_status'))return{rows:[{workspace_status:'active',brand_status:'active',actor_status:denied?'inactive':'active',
      user_type:'noisia_internal',primary_role:'noisia_admin',same_organization:true,brand_access_level:null}]};
    if(sql.includes('SELECT id,taxonomy_id FROM signal_taxonomy_profiles')){identities++;throw identityError;}
    if(sql.includes('transaction_timestamp()'))return{rows:[{observed_at:stamp}]};
    if(sql.includes('SELECT input_revision::text'))return{rows:[{input_revision:'2'}]};
    if(sql.includes('SELECT id, actor_user_id, input_revision::text'))return{rows:[{id:owner,actor_user_id:actor,input_revision:'1',input_snapshot:{context_digest:sha,catalog_digest:sha}}]};
    if(sql.includes('SELECT id FROM signal_topic_catalog_executions')&&sql.includes('input_revision=$2::bigint'))return{rows:[]};
    if(sql.includes('SELECT id,status,')&&sql.includes('policy_current'))return{rows:[{id:operation,status:'completed',policy_current:true}]};
    if(sql.includes('signal_workspace_incremental_serving_current_v1'))return{rows:[{execution_id:numeric,status:'failed',phase:'numeric',progress:40,
      expected_roots:9,processed_roots:4,error_code:'workspace_engine_process_failed',input_revision:'2',desired_revision:'2',
      context_digest:sha,catalog_digest:sha,is_current:true,history_current:true}]};
    if(sql.includes('FROM signal_topic_catalog_operations'))return{rows:[{result_summary:catalogReceipt}]};
    if(sql.includes('SELECT id,engine_request_keys'))return{rows:[{id:numeric,alias:{actor_user_id:actor,request_digest:digest({action:'retry_numeric',execution_id:numeric})}}]};
    if(sql.includes('WITH runs AS('))return{rows:[{execution_id:owner,generation_id:operation,source_engine_execution_id:numeric,
      status:'ready',complete:true,source_current:true,identity:{},correction_digest:sha,generation_version:1,denominator:9,processed_roots:9}]};
    if(sql.includes('SELECT dispatch.status,dispatch.error_code'))return{rows:[{status:'failed',error_code:'workspace_incremental_projection_transport_unavailable',attempt_count:8,profile_current:true}]};
    if(sql.includes('FROM signal_classification_generations WHERE id='))return{rows:[{input_revision:'2',interpretation_coverage:{interpreted_units:4},discovery_coverage:null}]};
    if(sql.includes('workspace_interpretation_admission_eligible_v1'))return{rows:[{id:owner,actor_user_id:actor,input_digest:sha,
      input_snapshot:{context_digest:sha,catalog_digest:sha,claude_cap_micro_usd:900},config:{budget_timezone:'UTC',daily_cap_micro_usd:2000,call_configuration:{model:'claude-sonnet-4-6'}},
      eligible:true,requires_authorization:true,is_current:true,is_admin:true,receipt:admission}]};
    if(sql.startsWith('SELECT actor_user_id FROM signal_topic_catalog_executions'))return{rows:[{actor_user_id:actor}]};
    if(sql.includes('SELECT input_digest,input_snapshot,interpretation_revision,'))return{rows:[{input_digest:sha,input_snapshot:{claude_cap_micro_usd:900},interpretation_admission_operation_id:operation,receipt:admission}]};
    if(sql.includes('WITH selected AS MATERIALIZED'))return{rows:[{id:owner,actor_user_id:actor,status:'failed',progress:40,
      denominator:9,expected_chunks:'9',processed_roots:4,processed_chunks:'4',error_code:'workspace_engine_storage_unavailable',
      result_summary:{phase:'interpretation',interpreted_units:4},input_snapshot:{context_digest:sha,catalog_digest:sha,expected_guides:2,claude_cap_micro_usd:900},
      revision_live:true,policy_live:true,artifact_count:'2',is_latest:true,is_request:true,progress_owner:false,progress_coverage:{unit_count:4,unit_digest:sha},
      latest_catalog_profile_id:null,latest_materialization_progress:null,progress_dispatch:null}]};
    if(sql.includes('workspace_incremental_editorial_preparation_source_v1'))return{rows:[{id:numeric,actor_user_id:actor,
      input_snapshot:{context_digest:sha,catalog_digest:sha},checkpoint:{checkpoint_digest:sha},seal:sourceSeal,valid:true}]};
    if(sql.includes('workspace_incremental_editorial_policy_v1'))return{rows:[{id:numeric,actor_user_id:actor,
      input_snapshot:{context_digest:sha,catalog_digest:sha},checkpoint:{checkpoint_digest:sha},history:sha,census:sha,valid:true,
      targets:{expected_units:9,unique_units:9,target_units:5,legacy_units:0,claimed_units:4},
      policy:{budget_timezone:'UTC',daily_cap_micro_usd:2000}}]};
    if(sql.includes('workspace_incremental_editorial_execution_current_v1'))return{rows:[{id:owner,actor_user_id:actor,status:'failed',
      error_code:'workspace_incremental_editorial_transport_unavailable',current:true,expected_units:9,context_digest:sha,catalog_digest:sha,
      receipt:admission,request:retryReceipt,now:stamp}]};
    if(sql.includes('workspace_incremental_editorial_renewal_state_v1'))return{rows:[{state:{execution_id:owner,is_current:true,eligible:true,
      expected_admission_operation_id:operation,budget_actor_user_id:actor,budget_timezone:'UTC',budget_date:'2026-09-11',
      maximum_admission_not_after:'2026-09-12T00:00:00.000Z',run_cap_micro_usd:900,daily_cap_micro_usd:2000,
      confirmed_micro_usd:300,reserved_micro_usd:100,terminal_reserved_micro_usd:50,maximum_grant_micro_usd:500,context_digest:sha,catalog_digest:sha}}]};
    if(sql.includes('workspace_interpretation_admission_admin_v1'))return{rows:[{valid:true}]};
    if(sql.startsWith('SELECT request_digest,result FROM signal_classification_operations')){
      assert.equal(params[0],workspace);assert.equal(params[1],actor);
      return{rows:[{request_digest:sha,result:sql.includes('prepare-incremental-editorial')?preparationReceipt:admission}]};
    }
    if(sql.includes("result_summary->'editorial_retry_requests'"))return{rows:[{id:owner}]};
    if(sql.includes('d.preparation_operation_id'))return{rows:[{status:'completed',receipt:preparationReceipt,preparation_plan_artifact_id:operation,
      preparation_token:null,lease_live:false,worker_job_id:'sealed-job',attempt_count:1}]};
    if(sql.includes('SELECT worker_job_id,status FROM signal_topic_classification_outbox'))return{rows:[{worker_job_id:'sealed-job',status:'failed'}]};
    if(sql.includes('workspace_incremental_editorial_output_complete_v1'))return{rows:[{checkpoint_complete:false,interpreted:4,confirmed:'300',reserved:'100',terminal:'50'}]};
    if(sql.includes('COALESCE((result_summary'))return{rows:[{error_code:'workspace_incremental_editorial_transport_unavailable',retry_count:1,unknown:false,persisted_response:false,confirmed_terminal:false}]};
    if(sql.includes('FROM engine_cost_events'))return{rows:[{confirmed:'300',reserved:'100',terminal:'50',run_spent:'400',day_spent:'400',releasable_run:'0',releasable_day:'0'}]};
    if(sql.includes('clock_timestamp() AT TIME ZONE'))return{rows:[{now:stamp,date:'2026-09-11',maximum:'2026-09-12T00:00:00.000Z'}]};
    if(sql.includes('workspace_incremental_editorial_plan_valid_v1'))return{rows:[]};
    if(sql.includes('SELECT id execution_id,status'))return{rows:[{execution_id:owner,status:'failed',receipt:admission}]};
    if(sql.includes("AND status='ready' ORDER BY completed_at"))return{rows:[]};
    throw new Error(`Unexpected fixture query: ${sql.slice(0,100)}`);
  }};
  const database={connect:async()=>client,query:client.query} as unknown as Pool;
  return{database,client:client as unknown as PoolClient,queries,get identities(){return identities;},get released(){return released;}};
}
type Fixture=ReturnType<typeof fixture>;
const scope={workspace_id:workspace,actor_user_id:actor,idempotency_key:requestKey};
const readers=[
  {name:'incremental analysis update',async read(f:Fixture){const view=await loadSignalWorkspaceAnalysisUpdateV1({...scope,database:f.database});
    assert.deepEqual(view?.catalog_receipt,catalogReceipt);assert.equal(view?.request_numeric?.execution_id,numeric);
    assert.equal(view?.numeric.is_current,false);assert.equal(view?.numeric.retry_available,false);assert.equal(view?.delivery.retry_available,false);assert.equal(view?.has_pending_work,false);
    assert.equal(view?.projection?.generation_id,operation);assert.equal(view?.projection?.is_current,false);
    assert.equal(view?.serving?.generation_id,operation);assert.equal(view?.serving?.is_current,false);}},
  {name:'full-fit interpretation admission',async read(f:Fixture){const view=await loadSignalWorkspaceInterpretationAdmissionV1({...scope,database:f.database});
    assert.deepEqual(view?.current,admission);assert.deepEqual(view?.request?.receipt,admission);assert.equal(view?.confirmed_micro_usd,300);assert.equal(view?.reserved_micro_usd,100);
    assert.equal(view?.is_current,false);assert.equal(view?.can_authorize,false);assert.equal(view?.can_revoke,true);}},
  {name:'numeric readiness',async read(f:Fixture){const view=await loadSignalWorkspaceNumericReadinessV1({...scope,database:f.database});
    assert.equal(view.desired_revision,'2');assert.equal(view.embedding_run_id,operation);assert.equal(view.state,'blocked');assert.equal(view.has_pending_work,false);
    assert.ok(['brand_context_source_stale','brand_context_semantic_context_required'].includes(view.reason_code!));}},
  {name:'full-fit status',async read(f:Fixture){const view=await loadSignalWorkspaceEngineStatusV1({...scope,database:f.database});
    assert.equal(view.request_run?.execution_id,owner);assert.equal(view.request_run?.interpreted_units,4);assert.equal(view.request_run?.claude_cap_micro_usd,900);
    assert.equal(view.request_run?.is_current,false);assert.equal(view.request_run?.materialization_retry_available,false);}},
  {name:'free evidence preparation',async read(f:Fixture){const view=await loadSignalWorkspaceIncrementalEditorialPreparationV1({...scope,database:f.database});
    assert.deepEqual(view?.request?.receipt,preparationReceipt);assert.equal(view?.preparation?.status,'ready');
    assert.equal(view?.is_current,false);assert.equal(view?.can_prepare,false);assert.equal(view?.has_pending_work,false);}},
  {name:'editorial admission',async read(f:Fixture){const view=await loadSignalWorkspaceIncrementalEditorialAdmissionV1({...scope,database:f.database});
    assert.deepEqual(view?.request?.receipt,admission);assert.equal(view?.confirmed_micro_usd,300);assert.equal(view?.reserved_micro_usd,100);
    assert.equal(view?.is_current,false);assert.equal(view?.can_authorize,false);assert.equal(view?.operation?.can_revoke,true);}},
  {name:'editorial retry status',async read(f:Fixture){const view=await loadSignalWorkspaceIncrementalEditorialStatusV1({...scope,database:f.database});
    assert.deepEqual(view?.request?.receipt,retryReceipt);assert.deepEqual(view?.costs,{confirmed_micro_usd:300,reserved_micro_usd:100,terminal_reserved_micro_usd:50});
    assert.equal(view?.is_current,false);assert.equal(view?.can_retry,false);assert.equal(view?.renewal?.can_renew,false);}},
  {name:'editorial renewal',async read(f:Fixture){const view=await readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(f.client,{...scope,execution_id:owner});
    assert.equal(view?.expected_admission_operation_id,operation);assert.equal(view?.confirmed_micro_usd,300);assert.equal(view?.reserved_micro_usd,100);
    assert.equal(view?.is_current,false);assert.equal(view?.can_renew,false);assert.equal(view?.blocked_reason,'workspace_incremental_editorial_source_stale');}}
];
for(const code of ['brand_context_source_stale','brand_context_semantic_context_required']){
  for(const reader of readers)test(`${reader.name}: ${code} retains history and denies new work`,async()=>{
    const f=fixture(new SignalTopicCatalogError(code));await reader.read(f);assert.ok(f.identities>0);
    if(reader.name!=='editorial renewal'){assert.ok(f.queries.includes(reader.name==='numeric readiness'?'ROLLBACK':'COMMIT'));assert.equal(f.released,1);}
  });
  test(`preflight and new free preparation still reject ${code}`,async()=>{
    const error=new SignalTopicCatalogError(code);
    const preflight=fixture(error);await assert.rejects(loadSignalWorkspaceEnginePreflightV1({...scope,database:preflight.database}),value=>value===error);
    // An unaccepted key has no historical receipt, so source validation must still reject it.
    const next=fixture(error);const original=next.client.query.bind(next.client);
    next.client.query=((sql:string,params:unknown[])=>sql.startsWith('SELECT request_digest,result FROM signal_classification_operations')?Promise.resolve({rows:[]}):original(sql,params)) as typeof next.client.query;
    await assert.rejects(requestSignalWorkspaceIncrementalEditorialPreparationV1({...scope,database:next.database,numeric_execution_id:numeric,expected_source_digest:digest(sourceSeal)}),value=>value===error);
  });
  test(`numeric producer and fresh interpretation admission still reject ${code}`,async()=>{
    const error=new SignalTopicCatalogError(code);
    const producer=fixture(error);await assert.rejects(admitSignalWorkspaceNumericUpdateV1({database:producer.database,workspace_id:workspace}),value=>value===error);
    const fresh=fixture(error);const original=fresh.client.query.bind(fresh.client);
    fresh.client.query=((sql:string,params:unknown[])=>sql.startsWith('SELECT request_digest,result FROM signal_classification_operations')?Promise.resolve({rows:[]}):original(sql,params)) as typeof fresh.client.query;
    await assert.rejects(authorizeSignalWorkspaceInterpretationAdmissionV1({...scope,database:fresh.database,execution_id:owner,expected_admission_operation_id:operation,
      grant_cap_micro_usd:100,admission_not_after:'2026-09-12T00:00:00.000Z'}),value=>value===error);
  });
}
for(const reader of readers){
  test(`${reader.name}: unexpected, forbidden and service failures remain errors`,async()=>{
    for(const error of [new Error('brand_context_source_stale'),new SignalTopicCatalogError('other_catalog_error'),
      new SignalTopicCatalogError('brand_context_source_stale',403),new SignalTopicCatalogError('brand_context_semantic_context_required',503)]){
      const f=fixture(error);await assert.rejects(reader.read(f),value=>value===error);
      if(reader.name!=='editorial renewal'){assert.ok(f.queries.includes('ROLLBACK'));assert.equal(f.released,1);}
    }
  });
  test(`${reader.name}: revoked workspace read rights expose no receipt`,async()=>{
    const f=fixture(new SignalTopicCatalogError('brand_context_source_stale'),true);
    await assert.rejects(reader.read(f),{status:403});assert.equal(f.identities,0);
    assert.ok(!f.queries.some(sql=>sql.includes('FROM signal_classification_operations')));
  });
}
