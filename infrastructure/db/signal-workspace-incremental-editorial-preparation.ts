import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { signalWorkspaceEmbeddingDigestV1 as digest, type SignalWorkspaceIncrementalRootV1 } from '@noisia/query-engine';
import { SignalWorkspaceEngineError, loadSignalWorkspaceEngineInputIdentityV1, isSignalWorkspaceEngineSemanticAuthorityUnavailableV1,
  withSignalWorkspaceEngineTransactionV1 as tx, type SignalWorkspaceEngineDatabaseV1,
  type SignalWorkspaceEngineSnapshotV1 } from './signal-workspace-engine';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';
import type { SignalWorkspaceIncrementalArtifactRefV1, SignalWorkspaceIncrementalCheckpointV1 } from './signal-workspace-engine-incremental';
import { persistSignalWorkspaceIncrementalEditorialEvidenceWithClientV1,
  type SignalWorkspaceIncrementalEditorialEvidenceArgsV1 } from './signal-workspace-incremental-editorial';

export const SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1 = 'signal_workspace_incremental_editorial_evidence_v1';
const kind = 'incremental_editorial_evidence';
const transport = 'workspace_incremental_editorial_preparation_transport_unavailable';
const maximumAttempts = 8;
type Database = SignalWorkspaceEngineDatabaseV1;
type Queryable = Pick<PoolClient, 'query'>;
type Scope = { workspace_id: string; actor_user_id: string };
type Target = Scope & { numeric_execution_id: string };
type SourceSeal = { contract_version: 'workspace-incremental-editorial-preparation-source-v1'; numeric_execution_id: string;
  numeric_checkpoint_digest: string; input_revision: string; context_digest: string; catalog_digest: string;
  census_digest: string; history_cut_digest: string; units_digest: string; origins_digest: string };
export type SignalWorkspaceIncrementalEditorialPreparationReceiptV1 = {
  contract_version: 'workspace-incremental-editorial-preparation-request-v1'; operation_id: string;
  workspace_id: string; actor_user_id: string; numeric_execution_id: string;
  source_digest: string; source: SourceSeal; worker_job_id: string; requested_at: string; charge_micro_usd: 0;
};
export type SignalWorkspaceIncrementalEditorialPreparationV1 = {
  numeric_execution_id: string; numeric_checkpoint_digest: string; source_digest: string;
  is_current: boolean; can_prepare: boolean; blocked_reason: string | null; has_pending_work: boolean;
  preparation: { status: 'pending' | 'running' | 'ready' | 'failed'; attempt_count: number;
    error_code: string | null; plan_artifact_id: string | null } | null;
  request: { idempotency_key: string; receipt: SignalWorkspaceIncrementalEditorialPreparationReceiptV1 } | null;
};
export type SignalWorkspaceIncrementalEditorialPreparationRequestV1 = Target & { database: Database;
  expected_source_digest: string; idempotency_key: string };
/** This token owns only free preparation IO in the outbox, never an engine/provider lease. */
export type SignalWorkspaceIncrementalEditorialPreparationLeaseV1 = Target & { worker_job_id: string;
  source_digest: string; preparation_token: string };
export type SignalWorkspaceIncrementalEditorialPreparationOriginV1 =
  | { kind: 'full_fit'; model_origin: { execution_id: string; model_artifact_sha256: string } }
  | { kind: 'incremental'; execution_id: string; checkpoint: SignalWorkspaceIncrementalCheckpointV1;
      artifacts: SignalWorkspaceIncrementalArtifactRefV1[] };
export type SignalWorkspaceIncrementalEditorialPreparationContextV1 = {
  lease: SignalWorkspaceIncrementalEditorialPreparationLeaseV1; snapshot: SignalWorkspaceEngineSnapshotV1;
  checkpoint: SignalWorkspaceIncrementalCheckpointV1; artifacts: SignalWorkspaceIncrementalArtifactRefV1[];
};
export type SignalWorkspaceIncrementalEditorialPreparationFragmentV1 = {
  root_id: string; root_fingerprint: string; asset_sha256: string; chunk_index: number;
  start: number; end: number; chunk_sha256: string;
};
type Read = { database: Database; lease: SignalWorkspaceIncrementalEditorialPreparationLeaseV1 };
type Run = { id: string; actor_user_id: string; input_snapshot: SignalWorkspaceEngineSnapshotV1;
  checkpoint: SignalWorkspaceIncrementalCheckpointV1; seal: SourceSeal; valid: boolean };
type Dispatch = { status: string; worker_job_id: string; attempt_count: number; error_code: string | null;
  preparation_operation_id: string; preparation_plan_artifact_id: string | null;
  preparation_token: string | null; lease_live: boolean; receipt: SignalWorkspaceIncrementalEditorialPreparationReceiptV1 };
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceEngineError(`workspace_incremental_editorial_preparation_${code}`, status); };
const hash = /^sha256:[0-9a-f]{64}$/u;
function uuid(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) return fail('request_invalid', 422); return value.toLowerCase(); }
function canonical<T extends Target>(args: T): T { return { ...args, workspace_id: uuid(args.workspace_id), actor_user_id: uuid(args.actor_user_id), numeric_execution_id: uuid(args.numeric_execution_id) }; }
function key(value: string) { if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(value)) return fail('request_invalid', 422); return digest({ contract: 'workspace-incremental-editorial-preparation-key-v1', key: value }); }
function limitOf(value = 128) { if (!Number.isSafeInteger(value) || value < 1 || value > 128) return fail('page_invalid', 422); return value; }
const names = ['manifest.json', 'roots.jsonl', 'population.jsonl', 'memberships.jsonl', 'pending-cohort.jsonl', 'model-components.json'];
async function admin(c: Queryable, args: Scope) { if (!(await c.query<{ valid: boolean }>('SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid', [args.workspace_id, args.actor_user_id])).rows[0]?.valid) return fail('forbidden', 403); }
async function source(c: PoolClient, args: Target, historical = false): Promise<Run> {
  const run = (await c.query<Run>(`SELECT id,actor_user_id,input_snapshot-'guides' input_snapshot,result_summary->'numeric_checkpoint' checkpoint,
    workspace_incremental_editorial_preparation_source_v1(id) seal,workspace_incremental_editorial_source_v1(id) valid
    FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid
      AND input_contract='workspace-topic-engine-v1' AND input_snapshot ? 'numeric_descriptor' AND result_summary ? 'numeric_checkpoint'`, [args.numeric_execution_id, args.workspace_id])).rows[0];
  if (!run) return fail('not_found', 404);
  try { const identity = await loadSignalWorkspaceEngineInputIdentityV1({ queryable: c, ...args });
    run.valid &&= identity.context_digest === run.input_snapshot.context_digest && identity.catalog_digest === run.input_snapshot.catalog_digest;
  } catch(error) { if(historical && (isSignalWorkspaceEngineSemanticAuthorityUnavailableV1(error) || error instanceof SignalWorkspaceEngineError && [404,409].includes(error.status)
    || error instanceof Error && ['workspace_topic_catalog_required','workspace_topic_catalog_empty'].includes(error.message))) run.valid=false; else throw error; }
  return run;
}
async function dispatch(c: Queryable, args: Target, lock = false): Promise<Dispatch | null> {
  return (await c.query<Dispatch>(`SELECT d.status,d.worker_job_id,d.attempt_count,d.error_code,d.preparation_operation_id,d.preparation_plan_artifact_id,
    d.preparation_token,COALESCE(d.preparation_expires_at>clock_timestamp(),false) lease_live,o.result receipt
    FROM signal_topic_classification_outbox d JOIN signal_classification_operations o ON o.id=d.preparation_operation_id AND o.workspace_id=d.workspace_id
    WHERE d.execution_id=$1::uuid AND d.workspace_id=$2::uuid AND d.dispatch_kind=$3 ${lock ? 'FOR UPDATE OF d' : ''}`, [args.numeric_execution_id, args.workspace_id, kind])).rows[0] ?? null;
}
async function receipt(c: Queryable, args: Scope, value?: string) {
  if (value === undefined) return null;
  return (await c.query<{ request_digest: string; result: SignalWorkspaceIncrementalEditorialPreparationReceiptV1 }>(`SELECT request_digest,result FROM signal_classification_operations
    WHERE workspace_id=$1::uuid AND actor_user_id=$2::uuid AND idempotency_key=$3 AND operation_kind='prepare-incremental-editorial'`, [args.workspace_id, args.actor_user_id, key(value)])).rows[0] ?? null;
}
async function lockSource(c: Queryable, args: Target) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`signal-taxonomy:${args.workspace_id}:topic`]);
  await c.query('SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE', [args.workspace_id]);
}
function retryable(row: Dispatch) { return row.error_code === transport && ['failed', 'dead_letter'].includes(row.status); }

async function readTransaction<T>(database:Database,work:(c:PoolClient)=>Promise<T>):Promise<T>{
  const c=await database.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query('SET LOCAL search_path=public,extensions,pg_temp');const result=await work(c);await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK').catch(()=>undefined);throw error;}finally{c.release();}
}

/** Read only. An accepted key remains observable after the source becomes historical. */
export async function loadSignalWorkspaceIncrementalEditorialPreparationV1(args: Scope & { database: Database; numeric_execution_id?: string; idempotency_key?: string }): Promise<SignalWorkspaceIncrementalEditorialPreparationV1 | null> {
  return readTransaction(args.database, async c => {
    if (!(await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: c, ...args })).can_view) return fail('forbidden', 403);
    const accepted = await receipt(c, args, args.idempotency_key);
    const target = accepted?.result.numeric_execution_id ?? args.numeric_execution_id ?? (await c.query<{ id: string }>(`SELECT id FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid
      AND input_snapshot ? 'numeric_descriptor' AND result_summary ? 'numeric_checkpoint' ORDER BY created_at DESC,id DESC LIMIT 1`, [args.workspace_id])).rows[0]?.id;
    if (!target) return null;
    const scoped = canonical({ ...args, numeric_execution_id: target }), run = await source(c, scoped, true), row = await dispatch(c, scoped);
    const currentDigest = digest(run.seal), same = row?.receipt.source_digest === currentDigest;
    const active = same && (['pending', 'dispatching', 'dispatched'].includes(row.status) || row.status === 'failed' && retryable(row) && row.attempt_count < maximumAttempts);
    const authorized = (await c.query<{ valid: boolean }>('SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid', [args.workspace_id, args.actor_user_id])).rows[0]?.valid === true;
    const can = authorized && run.valid && !active && (!same || row.status !== 'completed' && retryable(row));
    return { numeric_execution_id: run.id, numeric_checkpoint_digest: run.checkpoint.checkpoint_digest, source_digest: currentDigest,
      is_current: run.valid, can_prepare: can, blocked_reason: !run.valid ? 'source_stale' : !authorized ? 'forbidden' : active ? 'preparation_pending' : same && row.status === 'completed' ? 'already_prepared' : same && !retryable(row) ? 'preparation_failed' : null,
      has_pending_work: run.valid && Boolean(active), preparation: same ? { status: row.status === 'completed' ? 'ready' : row.preparation_token && row.lease_live ? 'running' : active ? 'pending' : 'failed', attempt_count: row.attempt_count, error_code: row.error_code, plan_artifact_id: row.preparation_plan_artifact_id } : null,
      request: accepted && args.idempotency_key ? { idempotency_key: args.idempotency_key, receipt: accepted.result } : null };
  });
}

export async function requestSignalWorkspaceIncrementalEditorialPreparationV1(input: SignalWorkspaceIncrementalEditorialPreparationRequestV1) {
  const args = canonical(input); key(args.idempotency_key); if (!hash.test(args.expected_source_digest)) return fail('request_invalid', 422);
  const requestDigest = digest({ action: 'prepare_incremental_editorial', numeric_execution_id: args.numeric_execution_id, expected_source_digest: args.expected_source_digest });
  return tx(args.database, async c => {
    await admin(c, args); await lockSource(c, args);
    const prior = await receipt(c, args, args.idempotency_key);
    if (prior) { if (prior.request_digest !== requestDigest) return fail('idempotency_conflict'); return { receipt: prior.result, replayed: true }; }
    const run = await source(c, args); if (!run.valid || digest(run.seal) !== args.expected_source_digest) return fail('source_stale');
    const old = await dispatch(c, args, true), same = old?.receipt.source_digest === args.expected_source_digest;
    if (old?.preparation_token && old.lease_live && !same) return fail('preparation_busy');
    if (same && ['failed', 'dead_letter'].includes(old.status) && !retryable(old)) return fail('retry_unavailable');
    const worker_job_id = `workspace-incremental-editorial-evidence-${run.id}-${args.expected_source_digest.slice(7)}`;
    const accepted: SignalWorkspaceIncrementalEditorialPreparationReceiptV1 = { contract_version: 'workspace-incremental-editorial-preparation-request-v1',
      operation_id: randomUUID(), workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, numeric_execution_id: run.id,
      source_digest: args.expected_source_digest, source: run.seal, worker_job_id, charge_micro_usd: 0,
      requested_at: (await c.query<{ value: Date }>('SELECT clock_timestamp() value')).rows[0]!.value.toISOString() };
    await c.query(`INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,idempotency_key,request_digest,status,result,completed_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,'prepare-incremental-editorial',$4,$5,'completed',$6::jsonb,clock_timestamp())`, [accepted.operation_id, args.workspace_id, args.actor_user_id, key(args.idempotency_key), requestDigest, JSON.stringify(accepted)]);
    if (!same || ['failed', 'dead_letter'].includes(old.status)) {
      const changed = await c.query(`INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id,dispatch_kind,preparation_operation_id)
        VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid) ON CONFLICT(execution_id,dispatch_kind) DO UPDATE SET worker_job_id=EXCLUDED.worker_job_id,
        preparation_operation_id=EXCLUDED.preparation_operation_id,preparation_plan_artifact_id=NULL,preparation_token=NULL,preparation_expires_at=NULL,
        status='pending',attempt_count=0,available_at=clock_timestamp(),completed_at=NULL,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()`,
        [run.id,args.workspace_id,worker_job_id,kind,accepted.operation_id]);
      if (changed.rowCount !== 1) return fail('dispatch_unavailable');
    }
    return { receipt: accepted, replayed: false };
  });
}

async function leased(c: PoolClient, lease: SignalWorkspaceIncrementalEditorialPreparationLeaseV1, current = true) {
  await admin(c, lease);
  const row = await dispatch(c, lease);
  if (!row || row.worker_job_id !== lease.worker_job_id || row.receipt.actor_user_id !== lease.actor_user_id || row.receipt.source_digest !== lease.source_digest
    || row.preparation_token !== lease.preparation_token || !row.lease_live || !['dispatching','dispatched'].includes(row.status)) return fail('lease_conflict');
  const run = await source(c, lease); if (current && (!run.valid || digest(run.seal) !== lease.source_digest)) return fail('source_stale');
  return run;
}
async function artifacts(c: Queryable, workspace: string, owner: string, candidate = false) {
  const allowed = candidate ? [...names, 'candidate-groups.json'] : names;
  const rows = (await c.query<SignalWorkspaceIncrementalArtifactRefV1>(`SELECT id artifact_id,engine_execution_id owner_execution_id,artifact_key,
    content->>'storage_key' storage_key,content->>'sha256' sha256,(content->>'size_bytes')::bigint::float8 size_bytes,content->>'media_type' media_type,metadata
    FROM analysis_artifacts WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid AND artifact_key=ANY($3::text[]) ORDER BY artifact_key`, [workspace, owner, allowed])).rows;
  if (rows.length !== allowed.length || new Set(rows.map(row => row.artifact_key)).size !== allowed.length) return fail('artifacts_missing');
  return rows;
}
export async function claimSignalWorkspaceIncrementalEditorialPreparationV1(input: Target & { database: Database; worker_job_id: string }):Promise<{completed:true;artifact_id:string}|{completed:false;lease:SignalWorkspaceIncrementalEditorialPreparationLeaseV1}> {
  const args = canonical(input);
  return tx(args.database, async c => {
    await admin(c, args); const row = await dispatch(c, args, true);
    if (!row || row.worker_job_id !== args.worker_job_id || row.receipt.actor_user_id !== args.actor_user_id) return fail('job_invalid');
    if (row.status === 'completed' && row.preparation_plan_artifact_id) return { completed: true as const, artifact_id: row.preparation_plan_artifact_id };
    if (!['dispatching','dispatched'].includes(row.status) || row.preparation_token && row.lease_live) return fail('lease_conflict');
    const run = await source(c, args); if (!run.valid || digest(run.seal) !== row.receipt.source_digest) return fail('source_stale');
    const preparation_token = randomUUID();
    await c.query(`UPDATE signal_topic_classification_outbox SET preparation_token=$3::uuid,preparation_expires_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
      WHERE execution_id=$1::uuid AND dispatch_kind=$2`, [run.id,kind,preparation_token]);
    const {database:_database,...scope}=args;
    return { completed: false as const, lease: { ...scope, preparation_token, source_digest: row.receipt.source_digest } };
  });
}
export async function readSignalWorkspaceIncrementalEditorialPreparationContextV1(args: Read): Promise<SignalWorkspaceIncrementalEditorialPreparationContextV1> {
  return tx(args.database, async c => { const run = await leased(c,args.lease);
    return { lease: args.lease, snapshot: run.input_snapshot, checkpoint: run.checkpoint, artifacts: await artifacts(c,args.lease.workspace_id,run.id) }; });
}
export async function heartbeatSignalWorkspaceIncrementalEditorialPreparationV1(args: Read) {
  const changed = await args.database.query(`UPDATE signal_topic_classification_outbox SET preparation_expires_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
    WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind=$3 AND worker_job_id=$4 AND preparation_token=$5::uuid
    AND preparation_expires_at>clock_timestamp() AND status IN('dispatching','dispatched')`, [args.lease.numeric_execution_id,args.lease.workspace_id,kind,args.lease.worker_job_id,args.lease.preparation_token]);
  if(changed.rowCount!==1)return fail('lease_conflict');
}
export async function readSignalWorkspaceIncrementalEditorialPreparationOriginsV1(args: Read & { after_execution_id?: string; limit?: number }) {
  const limit=limitOf(args.limit); return tx(args.database,async c=>{const run=await leased(c,args.lease);
    const rows=(await c.query<{execution_id:string;numeric:boolean;checkpoint:SignalWorkspaceIncrementalCheckpointV1|null;models:Array<{execution_id:string;model_artifact_sha256:string}>}>(`SELECT origin.id execution_id,
      origin.input_snapshot ? 'numeric_descriptor' numeric,origin.result_summary->'numeric_checkpoint' checkpoint,
      jsonb_agg(DISTINCT component.metadata->'model_origin') models FROM analysis_artifacts component JOIN signal_topic_catalog_executions origin
      ON origin.id::text=component.metadata->'model_origin'->>'execution_id' AND origin.workspace_id=component.workspace_id
      WHERE component.workspace_id=$1::uuid AND component.engine_execution_id=$2::uuid AND component.metadata->>'contract_version'='workspace-incremental-component-v1'
      AND ($3::uuid IS NULL OR origin.id>$3::uuid) AND signal_workspace_incremental_parent_current_v1(origin.id,origin.workspace_id,$4::uuid)
      GROUP BY origin.id ORDER BY origin.id LIMIT $5`,[args.lease.workspace_id,run.id,args.after_execution_id?uuid(args.after_execution_id):null,run.actor_user_id,limit+1])).rows;
    const items:SignalWorkspaceIncrementalEditorialPreparationOriginV1[]=[];
    for(const row of rows.slice(0,limit)){if(row.numeric){if(!row.checkpoint)return fail('origin_invalid');items.push({kind:'incremental',execution_id:row.execution_id,checkpoint:row.checkpoint,artifacts:await artifacts(c,args.lease.workspace_id,row.execution_id,true)});}
      else for(const model_origin of row.models)items.push({kind:'full_fit',model_origin});}
    return{items,next_cursor:rows.slice(0,limit).at(-1)?.execution_id??null,done:rows.length<=limit};});
}
export async function readSignalWorkspaceIncrementalEditorialPreparationExclusionsV1(args: Read & { after_unit_key?: string; limit?: number }) {
  const limit=limitOf(args.limit);return tx(args.database,async c=>{await leased(c,args.lease);
    const rows=(await c.query<{unit_key:string;component_key:string;birth_membership_digest:string;reason:'already_interpreted'|'editorial_claimed'}>(`SELECT identity->'unit'->>'unit_key' unit_key,identity->>'component_key' component_key,
      identity->'unit'->>'birth_membership_digest' birth_membership_digest,CASE WHEN claimed_by IS NOT NULL THEN 'editorial_claimed' ELSE 'already_interpreted' END reason
      FROM workspace_incremental_editorial_units_v1($1::uuid) unit WHERE ($2::text IS NULL OR identity->'unit'->>'unit_key' COLLATE "C">$2 COLLATE "C")
      AND (claimed_by IS NOT NULL OR EXISTS(SELECT 1 FROM signal_workspace_incremental_projection_history_v1($1::uuid) history JOIN analysis_artifacts proposal ON proposal.id=history.artifact_id
       WHERE proposal.engine_execution_id::text=unit.identity->'model_origin'->>'execution_id' AND proposal.metadata->'unit_keys' ? (unit.identity->'unit'->>'unit_key')))
      ORDER BY identity->'unit'->>'unit_key' COLLATE "C" LIMIT $3`,[args.lease.numeric_execution_id,args.after_unit_key??null,limit+1])).rows;
    const items=rows.slice(0,limit);return{items,next_cursor:items.at(-1)?.unit_key??null,done:rows.length<=limit};});
}
export async function readSignalWorkspaceIncrementalEditorialPreparationRootsV1(args: Read & { after_root_id?: string; limit?: number }) {
  const limit=limitOf(args.limit);return tx(args.database,async c=>{const run=await leased(c,args.lease);
    const rows=(await c.query<SignalWorkspaceIncrementalRootV1>(`SELECT item.root_id,item.fingerprint root_fingerprint,item.asset_sha256,
      jsonb_array_length(asset.chunks->'chunks') expected_chunks,signal_workspace_classification_chunk_digest_v1(asset.chunks) chunk_coverage_digest,
      'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(jsonb_build_array(correction.term_key,correction.correction_operation_id,
       correction.disposition,correction.definition_revision,correction.definition_digest)::text,'' ORDER BY correction.term_key)
       FROM signal_topic_membership_overrides correction WHERE correction.workspace_id=item.workspace_id AND correction.canonical_root_id=item.root_id
        AND correction.origin_input_contract='workspace-topic-classification-v1' AND correction.root_fingerprint=item.fingerprint
        AND correction.context_digest=$4),''),'UTF8')),'hex') correction_digest
      FROM signal_corpus_preparation_items item JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.disposition='eligible' AND ($3::uuid IS NULL OR item.root_id>$3::uuid)
      ORDER BY item.root_id LIMIT $5`,[run.input_snapshot.preparation_run_id,args.lease.workspace_id,args.after_root_id?uuid(args.after_root_id):null,run.input_snapshot.context_digest,limit+1])).rows;
    const items=rows.slice(0,limit);return{items,next_cursor:items.at(-1)?.root_id??null,done:rows.length<=limit};});
}
export async function readSignalWorkspaceIncrementalEditorialPreparationFragmentsV1(args: Read & { references: readonly SignalWorkspaceIncrementalEditorialPreparationFragmentV1[] }) {
  limitOf(args.references.length);
  if(args.references.some(ref=>![ref.chunk_index,ref.start,ref.end].every(n=>Number.isSafeInteger(n)&&n>=0)||ref.end<=ref.start||ref.end-ref.start>1400||![ref.chunk_sha256,ref.root_fingerprint,ref.asset_sha256].every(h=>hash.test(h))))return fail('fragment_invalid',422);
  return tx(args.database,async c=>{const run=await leased(c,args.lease);
    const rows=(await c.query<SignalWorkspaceIncrementalEditorialPreparationFragmentV1 & {text:string}>(`WITH refs AS(SELECT * FROM jsonb_to_recordset($3::jsonb)
      AS x(root_id uuid,root_fingerprint text,asset_sha256 text,chunk_index integer,start integer,"end" integer,chunk_sha256 text))
      SELECT ref.*,signal_topic_utf16_fragment_v1(asset.full_text,ref.start,ref."end") text FROM refs ref
      JOIN signal_corpus_preparation_items item ON item.root_id=ref.root_id AND item.run_id=$1::uuid AND item.workspace_id=$2::uuid
       AND item.disposition='eligible' AND item.fingerprint=ref.root_fingerprint AND item.asset_sha256=ref.asset_sha256
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      WHERE 'sha256:'||encode(sha256(convert_to(asset.full_text,'UTF8')),'hex')=item.asset_sha256
       AND asset.chunks->'chunks'->ref.chunk_index->>'sha256'=ref.chunk_sha256
       AND (asset.chunks->'chunks'->ref.chunk_index->>'start')::int=ref.start AND (asset.chunks->'chunks'->ref.chunk_index->>'end')::int=ref."end"`,
      [run.input_snapshot.preparation_run_id,args.lease.workspace_id,JSON.stringify(args.references)])).rows;
    if(rows.length!==args.references.length)return fail('fragment_invalid');
    const byIdentity=new Map(rows.map(row=>{const {text:_text,...identity}=row;return [digest(identity),row];}));
    const result=args.references.map(ref=>{const row=byIdentity.get(digest(ref));if(!row||row.text.length!==ref.end-ref.start||`sha256:${createHash('sha256').update(row.text).digest('hex')}`!==ref.chunk_sha256)return fail('fragment_invalid');return row;});
    await leased(c,args.lease);return result;});
}
export async function completeSignalWorkspaceIncrementalEditorialPreparationV1(args: Read & Pick<SignalWorkspaceIncrementalEditorialEvidenceArgsV1,'evidence'|'stored'>) {
  return tx(args.database,async c=>{await admin(c,args.lease);await lockSource(c,args.lease);
    const old=await dispatch(c,args.lease,true);
    if(old?.worker_job_id===args.lease.worker_job_id&&old.receipt.actor_user_id===args.lease.actor_user_id&&old.status==='completed'&&old.preparation_plan_artifact_id)return{artifact_id:old.preparation_plan_artifact_id,replayed:true};
    await leased(c,args.lease);
    const result=await persistSignalWorkspaceIncrementalEditorialEvidenceWithClientV1(c,{...args.lease,database:args.database,evidence:args.evidence,stored:args.stored});
    const changed=await c.query(`UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),preparation_plan_artifact_id=$4::uuid,
      preparation_token=NULL,preparation_expires_at=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=clock_timestamp()
      WHERE execution_id=$1::uuid AND dispatch_kind=$2 AND preparation_token=$3::uuid AND preparation_expires_at>clock_timestamp()`,[args.lease.numeric_execution_id,kind,args.lease.preparation_token,result.artifact_id]);
    if(changed.rowCount!==1)return fail('lease_conflict');return result;});
}
export async function failSignalWorkspaceIncrementalEditorialPreparationV1(args: Read & { error_code: string }) {
  const code=/^workspace_(?:incremental_editorial_preparation|incremental_editorial_evidence|incremental_projection_files|engine_storage)_[a-z_]{1,100}$/u.test(args.error_code)?args.error_code:'workspace_incremental_editorial_preparation_failed';
  await args.database.query(`UPDATE signal_topic_classification_outbox SET status='failed',error_code=$6,preparation_token=NULL,preparation_expires_at=NULL,
    lease_token=NULL,lease_expires_at=NULL,available_at=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
    WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind=$3 AND worker_job_id=$4 AND preparation_token=$5::uuid AND status IN('dispatching','dispatched')`,
    [args.lease.numeric_execution_id,args.lease.workspace_id,kind,args.lease.worker_job_id,args.lease.preparation_token,code]);
}
/** A rejected claim can close only an unclaimed delivery. A lost claim ACK or
 * duplicate Worker retains the live IO token and is recovered by its expiry. */
export async function rejectSignalWorkspaceIncrementalEditorialPreparationDispatchV1(args: Target & { database:Database;worker_job_id:string;error_code:string }) {
  const code=/^workspace_incremental_editorial_preparation_[a-z_]{1,100}$/u.test(args.error_code)?args.error_code:'workspace_incremental_editorial_preparation_failed';
  await args.database.query(`UPDATE signal_topic_classification_outbox dispatch SET status='failed',error_code=$6,
    lease_token=NULL,lease_expires_at=NULL,available_at=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
    FROM signal_classification_operations operation WHERE operation.id=dispatch.preparation_operation_id
      AND operation.workspace_id=dispatch.workspace_id AND operation.actor_user_id=$5::uuid
      AND dispatch.execution_id=$1::uuid AND dispatch.workspace_id=$2::uuid AND dispatch.dispatch_kind=$3
      AND dispatch.worker_job_id=$4 AND dispatch.preparation_token IS NULL AND dispatch.status IN('dispatching','dispatched')`,
    [args.numeric_execution_id,args.workspace_id,kind,args.worker_job_id,args.actor_user_id,code]);
}
/** Crash recovery uses the durable IO lease. Semantic failures never auto-rearm. */
export async function recoverSignalWorkspaceIncrementalEditorialPreparationsV1(args: { database: Database }) {
  return args.database.query(`UPDATE signal_topic_classification_outbox SET status=CASE WHEN attempt_count>=8 THEN 'dead_letter' ELSE 'failed' END,
    error_code=$2,preparation_token=NULL,preparation_expires_at=NULL,lease_token=NULL,lease_expires_at=NULL,available_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE dispatch_kind=$1 AND status IN('dispatching','dispatched') AND
      ((preparation_token IS NOT NULL AND preparation_expires_at<=clock_timestamp()) OR
       (preparation_token IS NULL AND ((status='dispatched' AND updated_at<clock_timestamp()-interval '180 seconds') OR (status='dispatching' AND lease_expires_at<=clock_timestamp()))))`,[kind,transport]);
}
