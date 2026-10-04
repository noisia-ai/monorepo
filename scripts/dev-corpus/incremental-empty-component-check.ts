/** Real failed evidence recovery, with existing immutable files, inside a physical rollback.
 * No Worker, storage writes, numeric fit, queue transport or provider is invoked. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {SignalWorkspaceEngineDatabaseV1} from '../../infrastructure/db/signal-workspace-engine';
type Pool=SignalWorkspaceEngineDatabaseV1 & {end():Promise<void>};
import {main,openDatabase} from './guard.mjs';
import * as preparation from '../../infrastructure/db/signal-workspace-incremental-editorial-preparation';
import type {SignalWorkspaceIncrementalEditorialEvidenceArgsV1} from '../../infrastructure/db/signal-workspace-incremental-editorial';

type Fixture=Pick<SignalWorkspaceIncrementalEditorialEvidenceArgsV1,'evidence'|'stored'> & {
 numeric_execution_id:string;original_idempotency_key?:string;
};
await main(async()=>{
 if(!process.argv.includes('--rollback-check'))throw Error('mfp_rollback_check_required');
 const file=process.argv.find(arg=>arg.startsWith('--fixture='))?.slice('--fixture='.length);
 if(!file)throw Error('mfp_evidence_fixture_required');
 const f=JSON.parse(await readFile(file,'utf8')) as Fixture;
 assert.equal(f.evidence?.contract_version,'workspace-incremental-editorial-evidence-stream-v1','mfp_evidence_fixture_invalid');
 assert.ok(Array.isArray(f.evidence.numeric_component_order)&&f.evidence.numeric_component_order.length>0,'mfp_evidence_fixture_invalid');
 assert.ok(f.evidence.census&&Array.isArray(f.evidence.units)&&f.stored?.storage_key,'mfp_evidence_fixture_invalid');
 const identity=JSON.parse(await readFile(process.env.NOISIA_MFP_IDENTITY_FILE??'.data/dev-corpus/identity.json','utf8')) as {workspace_id:string;internal_user_id:string};
 const pool:Pool=await openDatabase(),raw=await pool.connect();let active=false,serial=0,phase='preflight';
 const flag=process.env.NOISIA_MENTION_FACETS_ENABLED,stack:string[]=[];
 const report=(value:string)=>{phase=value;console.log(JSON.stringify({phase}));};
 const query=async(sql:string,params?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const key=`evidence_${++serial}`;stack.push(key);return raw.query(`SAVEPOINT ${key}`);}
  if(sql==='COMMIT')return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==='ROLLBACK'){const key=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${key}`);return raw.query(`RELEASE SAVEPOINT ${key}`);}
  return raw.query(sql,params);
 };
 const database={query:query as Pool['query'],connect:async()=>Object.assign(Object.create(raw),{query,release(){}}) as typeof raw};
 const scope={database,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,numeric_execution_id:f.numeric_execution_id};
 const census=async()=>(await raw.query(`SELECT
  (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM signal_topic_catalog_executions x WHERE workspace_id=$1) engines,
  (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM analysis_artifacts x WHERE workspace_id=$1) artifacts,
  (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY execution_id,dispatch_kind),'[]') FROM signal_topic_classification_outbox x WHERE workspace_id=$1) dispatches,
  (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM signal_classification_operations x WHERE workspace_id=$1) operations,
  (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM engine_cost_events x WHERE workspace_id=$1) calls`,[scope.workspace_id])).rows[0];
 const outbox=async()=>(await raw.query(`SELECT to_jsonb(d) body FROM signal_topic_classification_outbox d
  WHERE execution_id=$1 AND dispatch_kind='incremental_editorial_evidence'`,[f.numeric_execution_id])).rows[0]?.body;
 const deny=async(work:()=>Promise<unknown>,pattern:RegExp)=>{await raw.query('SAVEPOINT deny');try{await assert.rejects(work,pattern);}finally{await raw.query('ROLLBACK TO SAVEPOINT deny');await raw.query('RELEASE SAVEPOINT deny');}};
 try{
  process.env.NOISIA_MENTION_FACETS_ENABLED='true';const before=await census(),original=await outbox();
  assert.equal(original?.status,'failed');assert.equal(original.error_code,'workspace_incremental_editorial_evidence_invalid');
  assert.equal(f.evidence.numeric_execution_id,f.numeric_execution_id);
  await raw.query('BEGIN');active=true;await raw.query("SET LOCAL statement_timeout='90s'");
  const validation=async(params:unknown[])=>(await raw.query('SELECT workspace_incremental_editorial_validation_v1($1::uuid,$2::jsonb,$3::jsonb) digest',params)).rows[0].digest;
  const values=[f.numeric_execution_id,JSON.stringify(f.evidence.census),JSON.stringify(f.evidence.numeric_component_order)];
  const oldValue=await validation(values);
  const nonempty=(await raw.query(`SELECT metadata->>'component_key' key FROM analysis_artifacts WHERE engine_execution_id=$1
   AND metadata->>'contract_version'='workspace-incremental-component-v1' AND (metadata->>'unit_count')::bigint>0 ORDER BY metadata->>'component_key'`,[f.numeric_execution_id])).rows.map(row=>row.key);
  assert.ok(nonempty.length);assert.ok(nonempty.length<f.evidence.numeric_component_order.length);
  const controlValues=[f.numeric_execution_id,values[1],JSON.stringify(nonempty)];
  const oldControl=await validation(controlValues);
  report('candidate_0242');await raw.query(await readFile(new URL('../../infrastructure/db/migrations/0242_signal_workspace_incremental_empty_component.sql',import.meta.url),'utf8'));
  const checkpoint=(await raw.query("SELECT result_summary->'numeric_checkpoint' checkpoint FROM signal_topic_catalog_executions WHERE id=$1",[f.numeric_execution_id])).rows[0].checkpoint;
  assert.notEqual(oldValue,checkpoint.validation_digest);
  assert.equal(await validation(values),checkpoint.validation_digest);assert.equal(await validation(controlValues),oldControl);
  assert.equal((await raw.query('SELECT workspace_incremental_editorial_empty_component_v1($1) valid',[f.numeric_execution_id])).rows[0].valid,true);
  report('explicit_repair_available');const state=await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope);
  assert.ok(state?.is_current);assert.equal(state.can_prepare,true);assert.equal(state.has_pending_work,false);assert.equal(state.preparation?.status,'failed');
  const request={...scope,expected_source_digest:state.source_digest,idempotency_key:randomUUID()};
  if(f.original_idempotency_key){const replay=await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,idempotency_key:f.original_idempotency_key});assert.equal(replay.replayed,true);assert.deepEqual(await outbox(),original);}
  report('negative_condition_and_authority');
  // Same error without the SQL condition must remain terminal. Only this predicate is simulated.
  const noEmptyDatabase={...database,connect:async()=>{const c=await database.connect();return Object.assign(Object.create(c),{query:async(sql:string,params?:unknown[])=>sql.includes('SELECT workspace_incremental_editorial_empty_component_v1')?{rows:[{valid:false}]}:c.query(sql,params),release(){}}) as typeof raw;}};
  assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1({...scope,database:noEmptyDatabase}))?.can_prepare,false);
  await deny(()=>preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,database:noEmptyDatabase}),/retry_unavailable/u);
  await deny(()=>preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1({...request,expected_source_digest:`sha256:${'0'.repeat(64)}`}),/source_stale/u);
  await raw.query('SAVEPOINT revoked');await raw.query("UPDATE users SET status='inactive' WHERE id=$1",[scope.actor_user_id]);
  await deny(()=>preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1(request),/forbidden/u);
  await raw.query('ROLLBACK TO SAVEPOINT revoked');await raw.query('RELEASE SAVEPOINT revoked');
  await raw.query('SAVEPOINT stale');await raw.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1 AND status<>'archived'",[scope.workspace_id]);
  assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope))?.can_prepare,false);
  await deny(()=>preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1(request),/source_stale/u);
  await raw.query('ROLLBACK TO SAVEPOINT stale');await raw.query('RELEASE SAVEPOINT stale');
  assert.deepEqual(await outbox(),original);
  report('same_job_recovery');const accepted=await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1(request);
  assert.equal(accepted.replayed,false);assert.equal(accepted.receipt.worker_job_id,original.worker_job_id);assert.equal(accepted.receipt.charge_micro_usd,0);
  assert.notEqual(accepted.receipt.operation_id,original.preparation_operation_id);
  const pending=await outbox();assert.equal(pending.status,'pending');assert.equal(pending.attempt_count,0);
  assert.equal((await preparation.requestSignalWorkspaceIncrementalEditorialPreparationV1(request)).replayed,true);assert.deepEqual(await outbox(),pending);
  await raw.query(`UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=clock_timestamp()
   WHERE execution_id=$1 AND dispatch_kind='incremental_editorial_evidence'`,[f.numeric_execution_id]);
  const claim=await preparation.claimSignalWorkspaceIncrementalEditorialPreparationV1({...scope,worker_job_id:accepted.receipt.worker_job_id});
  assert.equal(claim.completed,false);if(claim.completed)throw Error('mfp_unexpected_completed');
  report('publish_existing_evidence');const completed=await preparation.completeSignalWorkspaceIncrementalEditorialPreparationV1({database,lease:claim.lease,evidence:f.evidence,stored:f.stored});
  assert.equal((await preparation.loadSignalWorkspaceIncrementalEditorialPreparationV1(scope))?.preparation?.status,'ready');
  assert.equal((await raw.query('SELECT workspace_incremental_editorial_plan_valid_v1($1) valid',[completed.artifact_id])).rows[0].valid,true);
  assert.equal((await preparation.completeSignalWorkspaceIncrementalEditorialPreparationV1({database,lease:claim.lease,evidence:f.evidence,stored:f.stored})).replayed,true);
  const after=await census();assert.deepEqual(after.engines,before.engines);assert.deepEqual(after.calls,before.calls);
  await raw.query('ROLLBACK');active=false;assert.deepEqual(await census(),before);report('physical_rollback_census_pass');
  console.log(JSON.stringify({status:'passed',provider_calls:0,storage_writes:0,fit_runs:0,units:f.evidence.units.length,targets:f.evidence.stream.rows,checkpoint_unchanged:true,negative_condition:'simulated false predicate; all remaining SQL real'}));
 }catch(error){const e=error as Error&{code?:string};console.error(JSON.stringify({phase,name:e.name,code:e.code,message:e instanceof TypeError?'type_error':/^[a-z_]+$/u.test(e.message)?e.message:undefined,frame:e.stack?.split('\n').find(line=>line.includes('incremental-empty-component-check'))?.trim()}));throw error;}
 finally{if(active)await raw.query('ROLLBACK');raw.release();await pool.end();if(flag===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=flag;}
});
