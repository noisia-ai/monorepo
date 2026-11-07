import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {SIGNAL_WORKSPACE_INTERPRETATION_LEGACY_OPUS_CONFIGURATION_V1 as opus,SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as sonnet,SIGNAL_WORKSPACE_INTERPRETATION_REPAIR_PROTOCOL_DIGEST_V1} from '@noisia/query-engine';
import * as engine from '../signal-workspace-engine';
import * as money from '../signal-workspace-engine-interpretation';
import * as admission from '../signal-workspace-interpretation-admission';
import {signalMfpLegacyWorkspaceFixtureV1} from './signal-mfp-legacy-workspace.synthetic.fixture';
const sha=(s:string)=>`sha256:${createHash('sha256').update(s).digest('hex')}`;
async function fixture(){
 const seeded=await signalMfpLegacyWorkspaceFixtureV1();
 const {database,query,workspace_id,actor_user_id,embedding_run_id,cleanup,catalog}=seeded;
 await catalog();
 const access={database,workspace_id,actor_user_id};
 const begin=async(parent_execution_id?:string,claude_cap_micro_usd=0)=>{const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(access);
  return engine.beginSignalWorkspaceEngineV1({...access,embedding_run_id,idempotency_key:randomUUID(),expected_catalog_digest:preflight.expected_catalog_digest,
   expected_context_digest:preflight.expected_context_digest,engine_config:{contract_version:'local-engine-fixture-v1'},claude_cap_micro_usd,parent_execution_id});};
 return{query,database,access,workspace_id,actor_user_id,embedding_run_id,begin,cleanup};
}
async function dailyExposure(f:Awaited<ReturnType<typeof fixture>>){
 const row=(await f.query(`SELECT total_micro_usd FROM signal_processing_org_exposure_v1(
  (SELECT organization_id FROM signal_workspaces WHERE id=$1::uuid),(clock_timestamp() AT TIME ZONE 'UTC')::date,'UTC')`,[f.workspace_id])).rows[0];
 return Number(row?.total_micro_usd??0);
}
test('temporal interpretation grants preserve historical evidence, costs, replay and deterministic send authority',{skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:180000},async()=>{
 const f=await fixture();try{
  const dailyCap=await dailyExposure(f)+10_000;
  const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(f.access);
  const begun=await engine.beginSignalWorkspaceEngineV1({...f.access,idempotency_key:randomUUID(),embedding_run_id:f.embedding_run_id,
   expected_context_digest:preflight.expected_context_digest,expected_catalog_digest:preflight.expected_catalog_digest,engine_config:{fixture:'admission-only'},claude_cap_micro_usd:10000,
   interpretation_config:{call_configuration:opus,budget_timezone:'UTC',daily_cap_micro_usd:dailyCap}});
  const scope={...f.access,...begun};
  const claim=async()=>{const value=await engine.claimSignalWorkspaceEngineV1({database:f.database,...begun,worker_job_id:'local-admission-fixture'});assert.ok(value);return value;};
  let lease=await claim();
  const coverage={roots:lease.snapshot.expected_roots,chunks:lease.snapshot.expected_chunks,guides:lease.snapshot.expected_guides};
  await engine.heartbeatSignalWorkspaceEngineV1({database:f.database,lease,phase:'persisting',exported:{...coverage,stream_digest:sha('fixture')}});
  const bundle=['manifest.json','model-manifest.json','model.open.joblib','clusters.open.json','assignments.open.jsonl','roots.jsonl'].map(name=>({name,
   storage_key:`workspace-engine/${f.workspace_id}/${begun.execution_id}/${name}`,sha256:sha(name),size_bytes:10,media_type:'application/octet-stream'}));
  const ids=new Map<string,string>();for(const ref of bundle)ids.set(ref.name,(await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:{
   artifact_key:ref.name,artifact_type:ref.name==='model-manifest.json'||ref.name.endsWith('.joblib')?'engine_model':'engine_output',title:'Local admission fixture',...ref,
   metadata:{filename:ref.name,...ref.name==='manifest.json'?{bundle}:{}}}})).artifact_id);
  await engine.checkpointSignalWorkspaceEngineFitV1({database:f.database,lease,coverage,model_artifact_id:ids.get('model-manifest.json')!,output_artifact_id:ids.get('manifest.json')!,
   result_kind:'computational_grouping',model_configuration:{fixture:true},runtime_kind:'python',artifact_format:'joblib',license_key:null,
   interpretation_manifest:{unit_count:2,unit_digest:sha('"open:a"\n"open:b"\n')}});
  const token=(call:money.SignalWorkspaceEngineInterpretationCallV1)=>({database:f.database,call_id:call.call_id,attempt_token:call.attempt_token,execution_token:lease.execution_token});
  const reserve=(key:string,configuration:typeof opus|typeof sonnet=opus,extra:Partial<Parameters<typeof money.reserveSignalWorkspaceEngineInterpretationV1>[0]>={})=>money.reserveSignalWorkspaceEngineInterpretationV1({...scope,
   idempotency_key:key,request_digest:sha(key),configuration,reserved_micro_usd:1000,budget_timezone:'UTC',daily_cap_micro_usd:dailyCap,execution_token:lease.execution_token,...extra});
  const settle=async(call:money.SignalWorkspaceEngineInterpretationCallV1)=>{await money.markSignalWorkspaceEngineInterpretationSentV1(token(call));
   await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token(call),response:{storage_key:`workspace-engine/${f.workspace_id}/${begun.execution_id}/raw-${call.call_id}`,
    sha256:sha(call.call_id),size_bytes:10,http_status:200,provider_request_id:null}});
   return money.settleSignalWorkspaceEngineInterpretationV1({...token(call),usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}});};
  // Metered mock receipts only; no provider is constructed or called.
  const original=await settle(await reserve('local-original-invalid'));
  const repair=await settle(await reserve('local-repair-invalid',opus,{editorial_repair:{contract_version:'workspace-editorial-repair-v1',diagnostic:'output_invalid',
   source_call_id:original.call_id,source_request_digest:original.request_digest,source_response_sha256:original.response!.sha256,protocol_digest:SIGNAL_WORKSPACE_INTERPRETATION_REPAIR_PROTOCOL_DIGEST_V1}}));
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease,error_code:'workspace_engine_interpretation_repair_invalid'});
  const deadline=new Date(Date.now()+1100).toISOString();
  const revision=await engine.reviseSignalWorkspaceEngineInterpretationV1({...scope,idempotency_key:randomUUID(),source_call_id:repair.call_id,
   configuration:{call_configuration:sonnet,budget_timezone:'UTC',daily_cap_micro_usd:dailyCap},admission_not_after:deadline});
  lease=await claim();
  const unsent=await reserve('local-sonnet-never-sent',sonnet,{interpretation_revision_digest:revision.revision_digest});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(deadline)-Date.now())+40));
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease,error_code:'workspace_engine_worker_failed'});
  await f.query("UPDATE users SET primary_role='noisia_admin' WHERE id=$1::uuid",[f.actor_user_id]);
  const before=(await f.query('SELECT input_snapshot,interpretation_revision FROM signal_topic_catalog_executions WHERE id=$1::uuid',[begun.execution_id])).rows;
  const costs=(await f.query('SELECT * FROM engine_cost_events WHERE id=ANY($1::uuid[]) ORDER BY id',[[original.call_id,repair.call_id]])).rows;
  const artifacts=(await f.query('SELECT * FROM analysis_artifacts WHERE engine_execution_id=$1::uuid ORDER BY id',[begun.execution_id])).rows;
  const view=await admission.loadSignalWorkspaceInterpretationAdmissionV1(scope);assert.equal(view?.can_authorize,true);assert.equal(view?.requires_authorization,true);
  const input={...scope,idempotency_key:randomUUID(),expected_admission_operation_id:null,grant_cap_micro_usd:3000,admission_not_after:view!.maximum_admission_not_after};
  await assert.rejects(admission.authorizeSignalWorkspaceInterpretationAdmissionV1({...input,grant_cap_micro_usd:10001}),/cap_or_deadline_invalid/u);
  const save=async(work:()=>Promise<void>)=>{await f.query('SAVEPOINT negative_admission');try{await work();}finally{await f.query('ROLLBACK TO SAVEPOINT negative_admission');await f.query('RELEASE SAVEPOINT negative_admission');}};
  await save(async()=>{
   await f.query("UPDATE users SET primary_role='analyst' WHERE id=$1::uuid",[f.actor_user_id]);
   const limited=await admission.loadSignalWorkspaceInterpretationAdmissionV1(scope);assert.equal(limited?.can_authorize,false);assert.equal(limited?.requires_authorization,true);
   await assert.rejects(admission.authorizeSignalWorkspaceInterpretationAdmissionV1(input),/admission_forbidden/u);
  });
  await save(async()=>{
   await f.query("UPDATE signal_topic_catalog_executions SET error_code='workspace_engine_storage_verification_failed' WHERE id=$1::uuid",[begun.execution_id]);
   assert.equal((await admission.loadSignalWorkspaceInterpretationAdmissionV1(scope))?.can_authorize,false);
  });
  await save(async()=>{
   await f.query("DELETE FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[begun.execution_id]);
   await assert.rejects(admission.authorizeSignalWorkspaceInterpretationAdmissionV1(input),/admission_dispatch_unavailable/u);
   assert.equal((await admission.loadSignalWorkspaceInterpretationAdmissionV1({...scope,idempotency_key:input.idempotency_key}))?.request,null);
   assert.equal((await f.query('SELECT call_state FROM engine_cost_events WHERE id=$1::uuid',[unsent.call_id])).rows[0]!.call_state,'reserved');
  });
  await save(async()=>{
   const expires=new Date(Date.now()+900).toISOString();
   const short=await admission.authorizeSignalWorkspaceInterpretationAdmissionV1({...input,idempotency_key:randomUUID(),admission_not_after:expires});
   const savedLease=lease;lease=await claim();
   const waiting=await reserve('local-expiring-grant',sonnet,{interpretation_revision_digest:revision.revision_digest,admission_operation_id:short.receipt.operation_id});
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expires)-Date.now())+30));
   await assert.rejects(money.markSignalWorkspaceEngineInterpretationSentV1(token(waiting)),e=>e instanceof money.SignalWorkspaceEngineInterpretationError&&e.code==='workspace_engine_interpretation_daily_authority_expired');
   assert.equal((await f.query('SELECT call_state FROM engine_cost_events WHERE id=$1::uuid',[waiting.call_id])).rows[0]!.call_state,'reserved');
   lease=savedLease;
  });
  // Deterministic same-key arrival between first lookup and budget lock. Both
  // operations use real stores/SQL in nested savepoints; no parallel connection
  // can see this outer-rollback fixture's uncommitted source.
  let entered=false,lost=false;let accepted:admission.SignalWorkspaceInterpretationAdmissionResultV1|undefined;
  const race=Object.assign(Object.create(f.database) as Pool,{connect:async()=>{
   const client=await f.database.connect(),proxy=Object.create(client) as PoolClient;
   proxy.query=(async(sql:string,values?:unknown[])=>{
    if(lost&&sql==='ROLLBACK')return{rows:[],rowCount:0};
    if(!entered&&sql.includes('pg_advisory_xact_lock')&&String(values?.[0]).startsWith('workspace-interpretation-budget:')){
     entered=true;accepted=await admission.authorizeSignalWorkspaceInterpretationAdmissionV1(input);
    }
    const result=await client.query(sql,values);
    if(sql==='COMMIT'&&entered&&!lost){lost=true;throw Object.assign(new Error('grant COMMIT ACK lost'),{code:'ECONNRESET'});}
    return result;
   }) as PoolClient['query'];proxy.release=()=>{};return proxy;
  }});
  await assert.rejects(admission.authorizeSignalWorkspaceInterpretationAdmissionV1({...input,database:race}),/grant COMMIT ACK lost/u);
  assert.ok(accepted);assert.equal(lost,true);
  const raced=await admission.authorizeSignalWorkspaceInterpretationAdmissionV1(input);
  assert.equal(raced.replayed,true);assert.equal(raced.receipt.operation_id,accepted.receipt.operation_id);
  const grant=accepted;

  assert.equal(grant.execution_id,begun.execution_id);assert.equal((await admission.authorizeSignalWorkspaceInterpretationAdmissionV1(input)).replayed,true);
  assert.equal((await admission.loadSignalWorkspaceInterpretationAdmissionV1({...f.access,idempotency_key:input.idempotency_key}))?.request?.receipt.operation_id,grant.receipt.operation_id);
  await assert.rejects(admission.authorizeSignalWorkspaceInterpretationAdmissionV1({...input,idempotency_key:randomUUID()}),/admission_changed/u);
  lease=await claim();assert.equal(lease.interpretation_admission?.operation_id,grant.receipt.operation_id);
  const prior=await reserve('local-sonnet-never-sent',sonnet,{interpretation_revision_digest:revision.revision_digest,admission_operation_id:grant.receipt.operation_id});
  assert.equal(prior.call_id,unsent.call_id);assert.equal(prior.state,'definitely_not_sent');assert.equal(prior.admission,null);
  await save(async()=>{
   const spent=await reserve('local-spend-grant',sonnet,{reserved_micro_usd:3000,interpretation_revision_digest:revision.revision_digest,admission_operation_id:grant.receipt.operation_id});
   await money.markSignalWorkspaceEngineInterpretationSentV1(token(spent));
   await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token(spent),response:{storage_key:`workspace-engine/${f.workspace_id}/${begun.execution_id}/grant-spent`,sha256:sha('spent'),size_bytes:5,http_status:200,provider_request_id:null}});
   await money.settleSignalWorkspaceEngineInterpretationV1({...token(spent),usage:{input_tokens:1000,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
   await engine.failSignalWorkspaceEngineV1({database:f.database,lease,error_code:'workspace_engine_interpretation_admission_cap_exceeded'});
   assert.equal((await admission.loadSignalWorkspaceInterpretationAdmissionV1(scope))?.can_authorize,true);
   const additional=await admission.authorizeSignalWorkspaceInterpretationAdmissionV1({...input,idempotency_key:randomUUID(),expected_admission_operation_id:grant.receipt.operation_id,grant_cap_micro_usd:4000});
   assert.equal(additional.receipt.run_cap_micro_usd,10000);assert.equal(additional.receipt.daily_cap_micro_usd,dailyCap);
  });
  await assert.rejects(reserve('local-wrong-grant',sonnet,{interpretation_revision_digest:revision.revision_digest,admission_operation_id:randomUUID()}),e=>e instanceof money.SignalWorkspaceEngineInterpretationError&&e.code==='workspace_engine_interpretation_admission_changed');
  const pending=await reserve('local-sonnet-successor',sonnet,{request_digest:unsent.request_digest,retry_of_call_id:unsent.call_id,
   interpretation_revision_digest:revision.revision_digest,admission_operation_id:grant.receipt.operation_id});
  assert.equal(pending.admission?.admission_not_after,input.admission_not_after);
  await reserve('local-grant-second',sonnet,{interpretation_revision_digest:revision.revision_digest,admission_operation_id:grant.receipt.operation_id});
  await assert.rejects(reserve('local-grant-overflow',sonnet,{reserved_micro_usd:1001,interpretation_revision_digest:revision.revision_digest,admission_operation_id:grant.receipt.operation_id}),/admission_cap_exceeded/u);
  await save(async()=>{await assert.rejects(f.query("UPDATE signal_classification_operations SET result=result||'{\"grant_cap_micro_usd\":999999}'::jsonb WHERE id=$1::uuid",[grant.receipt.operation_id]),/mutation is forbidden/u);});
  await save(async()=>{await assert.rejects(f.query("UPDATE engine_cost_events SET metadata=jsonb_set(metadata,'{interpretation_admission,grant_digest}',to_jsonb($2::text)) WHERE id=$1::uuid",[pending.call_id,sha('forged')]),/admission is immutable/u);});
  await money.markSignalWorkspaceEngineInterpretationSentV1(token(pending));
  // Revocation is allowed even when input is stale and a send is in flight.
  await f.query('SAVEPOINT stale_revoke');
  await f.query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[f.workspace_id]);
  const revoked=await admission.revokeSignalWorkspaceInterpretationAdmissionV1({...scope,idempotency_key:randomUUID(),expected_admission_operation_id:grant.receipt.operation_id});
  assert.equal(revoked.receipt.action,'revoke_interpretation');
  await f.query('ROLLBACK TO SAVEPOINT stale_revoke');await f.query('RELEASE SAVEPOINT stale_revoke');
  const revokeInput={...scope,idempotency_key:randomUUID(),expected_admission_operation_id:grant.receipt.operation_id};
  const revoke=await admission.revokeSignalWorkspaceInterpretationAdmissionV1(revokeInput);assert.equal((await admission.revokeSignalWorkspaceInterpretationAdmissionV1(revokeInput)).replayed,true);
  const typed=(e:unknown)=>e instanceof money.SignalWorkspaceEngineInterpretationError&&e.code==='workspace_engine_interpretation_admission_revoked'&&e.status===409;
  await assert.rejects(reserve('local-after-revoke',sonnet,{interpretation_revision_digest:revision.revision_digest,admission_operation_id:grant.receipt.operation_id}),typed);
  await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token(pending),response:{storage_key:`workspace-engine/${f.workspace_id}/${begun.execution_id}/response-after-revoke`,sha256:sha('response'),size_bytes:8,http_status:200,provider_request_id:null}});
  await money.settleSignalWorkspaceEngineInterpretationV1({...token(pending),usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
  assert.equal((await reserve('local-sonnet-successor',sonnet,{request_digest:unsent.request_digest,retry_of_call_id:unsent.call_id,
   interpretation_revision_digest:revision.revision_digest,admission_operation_id:revoke.receipt.operation_id})).state,'settled');
  assert.deepEqual((await f.query('SELECT input_snapshot,interpretation_revision FROM signal_topic_catalog_executions WHERE id=$1::uuid',[begun.execution_id])).rows,before);
  assert.deepEqual((await f.query('SELECT * FROM engine_cost_events WHERE id=ANY($1::uuid[]) ORDER BY id',[[original.call_id,repair.call_id]])).rows,costs);
  assert.deepEqual((await f.query('SELECT * FROM analysis_artifacts WHERE engine_execution_id=$1::uuid ORDER BY id',[begun.execution_id])).rows,artifacts);
 }finally{await f.cleanup();}
});
