import type { Pool, PoolClient } from "pg";
import type {
  SignalWorkspaceClassificationIdentityV1, SignalWorkspaceClassificationRootIdentityV1,
  SignalWorkspaceClassificationOutcomeV1
} from "@noisia/query-engine";

export type SignalWorkspaceClassificationDatabaseV1 = Pick<Pool, "query" | "connect">;
export type SignalWorkspaceClassificationLeaseV1 = {
  execution_id: string; workspace_id: string; execution_token: string;
  cursor_root_id: string | null; input_digest: string;
  identity: SignalWorkspaceClassificationIdentityV1;
};
export type SignalWorkspaceClassificationRootV1 = SignalWorkspaceClassificationRootIdentityV1 & {
  asset_sha256: string; expected_chunks: number; chunk_coverage_digest: string; reuse_item_id: string | null;
};
export type SignalWorkspaceClassificationChunkPageV1 = {
  root_id: string; asset_sha256: string; expected_chunks: number; after_chunk_index: number | null;
  items: Array<{chunk_index: number; start: number; end: number; chunk_sha256: string; text: string}>;
  next_chunk_index: number | null; done: boolean;
};
export type SignalWorkspaceClassificationPageV1 = {
  items: Array<{root: SignalWorkspaceClassificationRootV1; corrections: SignalWorkspaceClassificationOutcomeV1["decisions"]}>;
  done: boolean;
};
export type SignalWorkspaceClassificationChunksCursorV1 = {root_id: string; chunk_index: number};
export type SignalWorkspaceClassificationChunksPageV1 = {
  items: Array<SignalWorkspaceClassificationChunkPageV1["items"][number] & {
    root_id: string; asset_sha256: string; expected_chunks: number;
  }>;
  next_cursor: SignalWorkspaceClassificationChunksCursorV1 | null;
  done: boolean;
};
export type SignalWorkspaceClassificationProjectionV1 = {
  contract_version: "workspace-topic-projection-v1";
  engine_execution_id: string; model_artifact_id: string | null; output_artifact_id: string;
  materialization_artifact_id: string; mapping_digest: string; policy_digest: string;
  model_version_id: string | null;
  interpretation_coverage?: {interpreted_unit_count:number;expected_unit_count:number;unit_digest:string;expected_unit_digest:string;complete:boolean};
};
export class SignalWorkspaceClassificationError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalWorkspaceClassificationError"; }
}

import { createHash, randomUUID } from "node:crypto";
import {
  signalWorkspaceClassificationIdentitySchemaV1, signalWorkspaceClassificationReuseKeyV1,
  parseSignalWorkspaceClassificationOutcomeV1, signalWorkspaceEmbeddingDigestV1,
  signalWorkspaceClassificationTopicSemanticsDigestV1,
  type SignalTopicDefinitionV1
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { loadSignalWorkspaceTopicInputSnapshotWithQueryableV1, SignalWorkspaceTopicComputationError } from "./signal-workspace-topic-computation";

const contract = "workspace-topic-classification-v1";
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceClassificationError(code, status); };
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const digest = signalWorkspaceEmbeddingDigestV1;
const limitValue = (value: number | undefined, cap: number) => {
  const n = value ?? cap; if (!Number.isSafeInteger(n) || n < 1 || n > cap) return fail("workspace_classification_page_invalid", 422); return n;
};
type Queryable = { query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{rows: Row[]}> };
type Topic = { taxonomy_term_id: string; definition: SignalTopicDefinitionV1; compiler_digest: string; projection_semantics_digest?:string };
type Snapshot = { contract_version: typeof contract; identity: SignalWorkspaceClassificationIdentityV1;
  context_digest: string; correction_digest: string; topics: Topic[]; source_projection?: SignalWorkspaceClassificationProjectionV1 };
async function tx<T>(database: SignalWorkspaceClassificationDatabaseV1, work: (client: PoolClient) => Promise<T>, readOnly = false) {
  const client = await database.connect();
  try { await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"); await client.query("SET LOCAL TIME ZONE 'UTC'"); await client.query("SET LOCAL search_path=public,extensions,pg_temp"); const value = await work(client); await client.query("COMMIT"); return value; }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}
async function authorize(queryable: Queryable, workspace_id: string, actor_user_id: string) {
  if (!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable, workspace_id, actor_user_id})).can_execute_topics) return fail("workspace_classification_forbidden", 403);
}
async function lockInputs(queryable: Queryable, workspace_id: string) {
  await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`signal-taxonomy:${workspace_id}:topic`]);
  await queryable.query("SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE", [workspace_id]);
}
async function correctionsDigest(queryable: Queryable, workspace: string) {
  return (await queryable.query<{digest: string}>(`SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
   jsonb_build_array(canonical_root_id,term_key,root_fingerprint,definition_digest,definition_revision,context_digest,correction_operation_id,disposition)::text,
   '' ORDER BY canonical_root_id,term_key),''),'UTF8')),'hex') digest FROM signal_topic_membership_overrides
   WHERE workspace_id=$1::uuid AND origin_input_contract='workspace-topic-classification-v1'`, [workspace])).rows[0]!.digest;
}
/** Semantic identities deliberately omit profile/term row IDs and ingestion run IDs. */
export async function loadSignalWorkspaceClassificationInputV1(args: {queryable: Queryable; workspace_id: string; actor_user_id: string}) {
  if (!(await loadSignalWorkspaceCapabilitiesStoreV1(args)).can_view) return fail("workspace_classification_forbidden",403);
  const built = await loadSignalWorkspaceTopicInputSnapshotWithQueryableV1({...args,allow_empty:true}).catch(error=>{
    if(error instanceof SignalWorkspaceTopicComputationError&&["workspace_topic_catalog_required","workspace_topic_catalog_empty"].includes(error.code))
      return fail("workspace_classification_catalog_unavailable");
    throw error;
  });
  const topics: Topic[] = built.input.topics.map(topic => ({taxonomy_term_id: topic.taxonomy_term_id,
    definition: topic.definition, compiler_digest: topic.compiled.compiler_digest,
    projection_semantics_digest:signalWorkspaceClassificationTopicSemanticsDigestV1(topic.definition)}));
  return {taxonomy_profile_id: built.profile_id, topics,
    embedding_config_digest: built.input.embedding_profile.config_digest, context_digest: built.input.context_digest,
    catalog_digest: digest(topics.map(topic => ({term_key: topic.definition.term_key,
      definition_digest: topic.definition.definition_digest, definition_revision: topic.definition.definition_revision}))),
    compiler_digest: digest(topics.map(topic => ({term_key: topic.definition.term_key, compiler_digest: topic.compiler_digest}))),
    correction_digest: await correctionsDigest(args.queryable, args.workspace_id)};
}
type Run = {
  id: string; workspace_id: string; actor_user_id: string; taxonomy_profile_id: string; generation_id: string;
  embedding_run_id: string; preparation_run_id: string; input_revision: string; input_digest: string;
  status: string; execution_token: string | null; execution_live: boolean; cursor_root_id: string | null;
  current_revision: string; policy_live: boolean; sources_complete: boolean; projection_current:boolean; identity: SignalWorkspaceClassificationIdentityV1;
  context_digest: string; correction_digest: string; denominator: number; expected_chunks: string; processed_roots: number;
  worker_job_id:string;
};
async function lockRun(client: PoolClient, id: string): Promise<Run> {
  const scope = (await client.query<{workspace_id: string}>("SELECT workspace_id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND input_contract=$2", [id, contract])).rows[0];
  if (!scope) return fail("workspace_classification_execution_not_found", 404);
  await lockInputs(client, scope.workspace_id);
  const run = (await client.query<Run>(`SELECT execution.id,execution.workspace_id,execution.actor_user_id,execution.taxonomy_profile_id,
   execution.generation_id,execution.embedding_run_id,execution.preparation_run_id,execution.input_revision::text,execution.input_digest,
   execution.status,execution.execution_token,execution.execution_expires_at>clock_timestamp() execution_live,execution.cursor_root_id,
   state.input_revision::text current_revision,(execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp()) policy_live,
   (embedding.input_contract='corpus' AND embedding.status='completed' AND prep.status='completed') sources_complete,
   (execution.input_snapshot->'source_projection' IS NULL OR (SELECT signal_workspace_projection_source_current_v1(generation)
    FROM signal_classification_generations generation WHERE generation.id=execution.generation_id)) projection_current,
   execution.input_snapshot->'identity' identity,execution.input_snapshot->>'context_digest' context_digest,
   execution.input_snapshot->>'correction_digest' correction_digest,execution.denominator,execution.expected_chunks::text,execution.processed_roots,
   COALESCE(outbox.worker_job_id,'workspace-classification-'||execution.id::text) worker_job_id
   FROM signal_topic_catalog_executions execution JOIN signal_corpus_preparation_input_state state USING(workspace_id)
   JOIN signal_workspace_embedding_runs embedding ON embedding.id=execution.embedding_run_id AND embedding.workspace_id=execution.workspace_id
   JOIN signal_corpus_preparation_runs prep ON prep.id=execution.preparation_run_id AND prep.workspace_id=execution.workspace_id
   LEFT JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id AND outbox.dispatch_kind='execution'
   WHERE execution.id=$1::uuid AND execution.input_contract=$2 FOR UPDATE OF execution`, [id, contract])).rows[0];
  if (!run) return fail("workspace_classification_execution_not_found", 404); return run;
}
function view(run: Run, token = run.execution_token!): SignalWorkspaceClassificationLeaseV1 {
  return {execution_id: run.id, workspace_id: run.workspace_id, execution_token: token, cursor_root_id: run.cursor_root_id,
    input_digest: run.input_digest, identity: run.identity};
}
async function current(client: PoolClient, run: Run, full = true) {
  await authorize(client, run.workspace_id, run.actor_user_id);
  if (run.current_revision !== run.input_revision || !run.policy_live || !run.sources_complete || !run.projection_current) return fail("workspace_classification_inputs_changed");
  if (!full) return;
  const latest = await loadSignalWorkspaceClassificationInputV1({queryable: client, workspace_id: run.workspace_id, actor_user_id: run.actor_user_id});
  if (latest.taxonomy_profile_id !== run.taxonomy_profile_id || latest.catalog_digest !== run.identity.catalog_digest
    || latest.compiler_digest !== run.identity.compiler_digest || latest.context_digest !== run.identity.context_digest
    || latest.embedding_config_digest !== run.identity.embedding_config_digest || latest.correction_digest !== run.correction_digest) return fail("workspace_classification_context_changed");
}
async function requireLease(client: PoolClient, lease: SignalWorkspaceClassificationLeaseV1, full = false) {
  const run = await lockRun(client, lease.execution_id);
  if (run.workspace_id !== lease.workspace_id || run.input_digest !== lease.input_digest || run.execution_token !== lease.execution_token
    || run.cursor_root_id !== lease.cursor_root_id || run.status !== "running" || !run.execution_live
    || digest(run.identity) !== digest(lease.identity)) return fail("workspace_classification_lease_lost");
  await current(client, run, full);
  await client.query("UPDATE signal_topic_catalog_executions SET execution_expires_at=clock_timestamp()+interval '120 seconds',heartbeat_at=clock_timestamp() WHERE id=$1::uuid", [run.id]);
  return run;
}
async function operation(client: PoolClient, run: Pick<Run,"workspace_id"|"actor_user_id">, kind: string, key: string, request: unknown) {
  const id = randomUUID(); await client.query(`INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,idempotency_key,request_digest)
   VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)`, [id, run.workspace_id, run.actor_user_id, kind, sha(key), digest(request)]); return id;
}
async function closeOperation(client: PoolClient, id: string, result: unknown) {
  await client.query(`INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,object_type,object_id,
   previous_state_digest,next_state_digest,event_digest)
   SELECT workspace_id,id,0,CASE operation_kind WHEN 'create-generation' THEN 'generation-created'
    WHEN 'append-results' THEN 'results-appended' ELSE 'generation-finalized' END,
    CASE operation_kind WHEN 'append-results' THEN 'generation-item' ELSE 'generation' END,
    COALESCE(($2::jsonb->>'generation_item_id')::uuid,($2::jsonb->>'generation_id')::uuid),NULL,$3,$4
   FROM signal_classification_operations WHERE id=$1::uuid`,[id,JSON.stringify(result),digest(result),sha(`${id}:0:${digest(result)}`)]);
  await client.query("UPDATE signal_classification_operations SET status='completed',result=$2::jsonb,completed_at=clock_timestamp() WHERE id=$1::uuid", [id, JSON.stringify(result)]);
}
export type BeginSignalWorkspaceClassificationV1 = {workspace_id:string;actor_user_id:string;idempotency_key:string;
  embedding_run_id:string;identity:SignalWorkspaceClassificationIdentityV1;source_projection?:SignalWorkspaceClassificationProjectionV1};
/** Existing low-level producer stays queue-free; the explicit projection request owns dispatch. */
export async function beginSignalWorkspaceClassificationV1(args: BeginSignalWorkspaceClassificationV1&{database:SignalWorkspaceClassificationDatabaseV1}) {
  return tx(args.database,client=>beginSignalWorkspaceClassificationWithClientV1(client,args));
}
export async function beginSignalWorkspaceClassificationWithClientV1(client:PoolClient,args:BeginSignalWorkspaceClassificationV1) {
  const identity = signalWorkspaceClassificationIdentitySchemaV1.parse(args.identity);
  if (identity.workspace_id !== args.workspace_id || !/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)) return fail("workspace_classification_request_invalid", 422);
  const requestDigest = digest({embedding_run_id: args.embedding_run_id, identity,...(args.source_projection?{source_projection:args.source_projection}:{})});
    await authorize(client, args.workspace_id, args.actor_user_id); await lockInputs(client, args.workspace_id);
    const prior = (await client.query<{id: string; generation_id: string; input_contract: string; actor_user_id: string; request_digest: string}>(
      "SELECT id,generation_id,input_contract,actor_user_id,request_digest FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND idempotency_key=$2", [args.workspace_id, args.idempotency_key])).rows[0];
    if (prior) {
      if (prior.input_contract !== contract || prior.actor_user_id !== args.actor_user_id || prior.request_digest !== requestDigest) return fail("workspace_classification_idempotency_conflict");
      return {execution_id: prior.id, generation_id: prior.generation_id, worker_job_id: `workspace-classification-${prior.id}`, replayed: true};
    }
    const inputs = await loadSignalWorkspaceClassificationInputV1({queryable: client, workspace_id: args.workspace_id, actor_user_id: args.actor_user_id});
    for (const key of ["catalog_digest","compiler_digest","context_digest","embedding_config_digest"] as const) {
      if (identity[key] !== inputs[key]) return fail("workspace_classification_identity_invalid");
    }
    const embedded = (await client.query<{id: string; preparation_run_id: string; input_revision: string; roots: number; chunks: string; policy_valid_until: string | null}>(`
     SELECT run.id,run.preparation_run_id,run.input_revision::text,(run.counts->>'eligible_roots')::int roots,
      run.counts->>'total_chunk_references' chunks,to_char(run.policy_valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') policy_valid_until
     FROM signal_workspace_embedding_runs run JOIN signal_corpus_preparation_input_state state USING(workspace_id)
     JOIN signal_corpus_preparation_runs prep ON prep.id=run.preparation_run_id AND prep.workspace_id=run.workspace_id
     WHERE run.id=$1::uuid AND run.workspace_id=$2::uuid AND run.input_contract='corpus' AND run.status='completed'
      AND prep.status='completed' AND run.input_revision=state.input_revision AND run.config_digest=$3
      AND run.counts->>'eligible_roots'=run.counts->>'completed_roots'
      AND run.counts->>'total_chunk_references'=run.counts->>'processed_chunk_references'
      AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())`, [args.embedding_run_id, args.workspace_id, identity.embedding_config_digest])).rows[0];
    if (!embedded) return fail("workspace_classification_complete_embeddings_required");
    if ((await client.query("SELECT id FROM signal_topic_catalog_executions WHERE taxonomy_profile_id=$1::uuid AND status IN('queued','running')", [inputs.taxonomy_profile_id])).rows.length) return fail("workspace_classification_execution_active");
    const snapshot: Snapshot = {contract_version: contract, identity, context_digest: inputs.context_digest, correction_digest: inputs.correction_digest, topics: inputs.topics,
      ...(args.source_projection?{source_projection:args.source_projection}:{})};
    const id = randomUUID(), generation = randomUUID();
    const op = await operation(client, args, "create-generation", `classification:${id}`, {requestDigest});
    const base = (await client.query<{id: string}>(`SELECT generation.id FROM signal_classification_generations generation
     WHERE generation.workspace_id=$1::uuid AND generation.input_contract=$2 AND generation.status='ready'
      AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items bad WHERE bad.generation_id=generation.id AND bad.resolution_state='error')
     ORDER BY generation.generation_version DESC LIMIT 1`, [args.workspace_id, contract])).rows[0]?.id ?? null;
    const population = digest({preparation_run_id: embedded.preparation_run_id, input_revision: embedded.input_revision, roots: embedded.roots, chunks: embedded.chunks});
    await client.query(`INSERT INTO signal_classification_generations(id,workspace_id,taxonomy_profile_id,generation_key,generation_version,
     study_corpus_id,input_population_digest,input_watermark_digest,identity_catalog_digest,denominator,operation_id,created_by_user_id,definition_digest,
     input_contract,preparation_run_id,embedding_run_id,input_revision,input_snapshot,input_digest,policy_valid_until,source_generation_id)
     VALUES($1::uuid,$2::uuid,$3::uuid,'workspace-native',COALESCE((SELECT max(generation_version)+1 FROM signal_classification_generations
      WHERE workspace_id=$2::uuid AND generation_key='workspace-native'),1),NULL,$4,NULL,$5,$6,$7::uuid,$8::uuid,$5,$9,$10::uuid,$11::uuid,$12,
      $13::jsonb,'sha256:'||encode(sha256(convert_to($13::jsonb::text,'UTF8')),'hex'),$14::timestamptz,$15::uuid)`,
    [generation,args.workspace_id,inputs.taxonomy_profile_id,population,identity.catalog_digest,embedded.roots,op,args.actor_user_id,contract,
      embedded.preparation_run_id,embedded.id,embedded.input_revision,JSON.stringify(snapshot),embedded.policy_valid_until,base]);
    await client.query(`INSERT INTO signal_topic_catalog_executions(id,workspace_id,taxonomy_profile_id,study_corpus_id,actor_user_id,intent,
     idempotency_key,request_digest,population_digest,watermark_digest,identity_catalog_digest,definition_digest,denominator,generation_id,
     input_contract,embedding_run_id,preparation_run_id,input_revision,embedding_config_digest,input_snapshot,input_digest,policy_valid_until,expected_chunks)
     SELECT $1::uuid,workspace_id,taxonomy_profile_id,NULL,created_by_user_id,'search',$2,$3,input_population_digest,NULL,identity_catalog_digest,
      definition_digest,denominator,id,input_contract,embedding_run_id,preparation_run_id,input_revision,$4,input_snapshot,input_digest,policy_valid_until,$5
     FROM signal_classification_generations WHERE id=$6::uuid`, [id,args.idempotency_key,requestDigest,identity.embedding_config_digest,embedded.chunks,generation]);
    await closeOperation(client, op, {generation_id: generation, execution_id: id});
    return {execution_id: id, generation_id: generation, worker_job_id: `workspace-classification-${id}`, replayed: false};
}
export async function claimSignalWorkspaceClassificationV1(args: {database: SignalWorkspaceClassificationDatabaseV1; execution_id: string; worker_job_id: string}) {
  return tx(args.database, async client => {
    const run = await lockRun(client, args.execution_id);
    if (args.worker_job_id !== run.worker_job_id || !["queued","running"].includes(run.status)
      || run.status === "running" && run.execution_live) return null;
    try { await current(client, run); }
    catch (error) { if (!(error instanceof SignalWorkspaceClassificationError)) throw error;
      await client.query("UPDATE signal_topic_catalog_executions SET status='failed',error_code=$2,execution_token=NULL,execution_expires_at=NULL,completed_at=clock_timestamp() WHERE id=$1::uuid", [run.id,error.code]);
      await completeProjectionDispatch(client,run.id);return null; }
    const token = randomUUID(); await client.query(`UPDATE signal_topic_catalog_executions SET status='running',execution_token=$2::uuid,
     execution_expires_at=clock_timestamp()+interval '120 seconds',started_at=COALESCE(started_at,clock_timestamp()),completed_at=NULL,
     error_code=NULL,heartbeat_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`, [run.id, token]);
    await client.query("UPDATE signal_topic_classification_outbox SET status='dispatched',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE dispatch_kind='execution' AND execution_id=$1::uuid",[run.id]);
    return view(run,token);
  });
}

async function roots(client: PoolClient, run: Run, limit: number, rootId?: string): Promise<SignalWorkspaceClassificationRootV1[]> {
  const rows = (await client.query<SignalWorkspaceClassificationRootV1>(`WITH selected AS MATERIALIZED (
   SELECT item.root_id,item.asset_sha256,item.fingerprint,item.chunk_policy_version FROM signal_corpus_preparation_items item
   WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.disposition='eligible'
    AND ($3::uuid IS NULL OR item.root_id>$3::uuid) AND ($4::uuid IS NULL OR item.root_id=$4::uuid) ORDER BY item.root_id LIMIT $5)
   SELECT selected.root_id,selected.asset_sha256,selected.fingerprint,jsonb_array_length(asset.chunks->'chunks') expected_chunks,
    signal_workspace_classification_chunk_digest_v1(asset.chunks) chunk_coverage_digest,
    'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(jsonb_build_array(correction.term_key,correction.correction_operation_id,
      correction.disposition,correction.definition_revision,correction.definition_digest)::text,'' ORDER BY correction.term_key)
     FROM signal_topic_membership_overrides correction
     WHERE correction.workspace_id=$2::uuid AND correction.canonical_root_id=selected.root_id
      AND correction.origin_input_contract='workspace-topic-classification-v1' AND correction.root_fingerprint=selected.fingerprint
      AND correction.context_digest=$6 AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution,
       jsonb_array_elements(execution.input_snapshot->'topics') topic WHERE execution.id=$7::uuid
        AND topic->'definition'->>'term_key'=correction.term_key AND topic->'definition'->>'definition_digest'=correction.definition_digest
        AND (topic->'definition'->>'definition_revision')::int=correction.definition_revision)),''),'UTF8')),'hex') correction_digest,
    NULL::uuid reuse_item_id
   FROM selected JOIN signal_corpus_text_assets asset ON asset.workspace_id=$2::uuid AND asset.text_sha256=selected.asset_sha256
    AND asset.chunk_policy_version=selected.chunk_policy_version ORDER BY selected.root_id`,
  [run.preparation_run_id,run.workspace_id,run.cursor_root_id,rootId??null,limit,run.context_digest,run.id])).rows;
  if (!rows.length) return rows;
  const keys = rows.map(root => ({root_id: root.root_id, reuse_key: signalWorkspaceClassificationReuseKeyV1(run.identity,
    {root_id: root.root_id, fingerprint: root.fingerprint, correction_digest: root.correction_digest})}));
  const reused = (await client.query<{root_id: string; item_id: string}>(`SELECT requested.root_id::text,prior.id item_id
   FROM jsonb_to_recordset($1::jsonb) requested(root_id uuid,reuse_key text)
   JOIN signal_classification_generations target ON target.id=$2::uuid
   JOIN LATERAL (SELECT item.id FROM signal_classification_generation_items item JOIN signal_classification_generations source ON source.id=item.generation_id
    WHERE item.canonical_root_id=requested.root_id AND item.reuse_key=requested.reuse_key AND item.resolution_state<>'error'
     AND source.workspace_id=target.workspace_id AND source.input_contract=$3 AND source.status='ready'
     AND source.input_snapshot->'source_projection' IS NOT DISTINCT FROM target.input_snapshot->'source_projection'
     AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items bad WHERE bad.generation_id=source.id AND bad.resolution_state='error')
     AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments assignment WHERE assignment.generation_item_id=item.id
      AND NOT signal_workspace_classification_assignment_current_v1(assignment,target))
    ORDER BY source.generation_version DESC LIMIT 1) prior ON true`, [JSON.stringify(keys),run.generation_id,contract])).rows;
  const ids = new Map(reused.map(row => [row.root_id,row.item_id]));
  return rows.map(root => ({...root,reuse_item_id: ids.get(root.root_id)??null}));
}
export async function readSignalWorkspaceClassificationRootPageV1(args: {database: SignalWorkspaceClassificationDatabaseV1; lease: SignalWorkspaceClassificationLeaseV1; limit?: number}) {
  return tx(args.database, async client => { const run = await requireLease(client,args.lease), limit = limitValue(args.limit,100);
    const page = await roots(client,run,limit+1); return {items: page.slice(0,limit),done: page.length<=limit}; });
}

const classificationPageBytes = 8 * 1024 * 1024;
async function pageCorrections(client: PoolClient, run: Run, items: SignalWorkspaceClassificationRootV1[]) {
  const result = new Map<string, SignalWorkspaceClassificationOutcomeV1["decisions"]>();
  if (!items.length) return result;
  // Bound rows before node-postgres hydrates them. jsonb text includes whitespace,
  // so its byte count plus root/envelope bytes conservatively bounds compact JSON.
  // A root's corrections are indivisible; omitted roots are never treated as empty.
  const rows = (await client.query<{root_id: string; decisions: SignalWorkspaceClassificationOutcomeV1["decisions"]}>(`
   WITH requested AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset($5::jsonb) requested(root_id uuid,fingerprint text,root_bytes integer)
   ), decisions AS MATERIALIZED (
   SELECT requested.root_id::text root_id,jsonb_build_object(
    'taxonomy_term_id',topic->>'taxonomy_term_id','term_key',correction.term_key,'definition_digest',correction.definition_digest,
    'definition_revision',correction.definition_revision,'disposition',CASE correction.disposition WHEN 'belongs' THEN 'approved' ELSE 'rejected' END,
    'resolution_method','human','model_version_id',NULL,'labeling_function_version_id',NULL,'approval_policy_id',NULL,
    'decided_by_user_id',operation.actor_user_id,'correction_operation_id',operation.id,'score',NULL,
    'evidence_digest',operation.request_digest,'lineage_digest',operation.request_digest) decision
   FROM requested
   JOIN signal_topic_membership_overrides correction ON correction.canonical_root_id=requested.root_id
    AND correction.workspace_id=$2::uuid AND correction.origin_input_contract=$4 AND correction.root_fingerprint=requested.fingerprint
    AND correction.context_digest=$3
   JOIN signal_topic_membership_operations operation ON operation.id=correction.correction_operation_id AND operation.workspace_id=$2::uuid
   JOIN signal_topic_catalog_executions execution ON execution.id=$1::uuid
   JOIN LATERAL jsonb_array_elements(execution.input_snapshot->'topics') topic ON topic->'definition'->>'term_key'=correction.term_key
    AND topic->'definition'->>'definition_digest'=correction.definition_digest
    AND (topic->'definition'->>'definition_revision')::int=correction.definition_revision

   ), sized AS (
    SELECT requested.root_id,requested.root_bytes+64+COALESCE(sum(octet_length(decision::text)+1),0) bytes
    FROM requested LEFT JOIN decisions ON decisions.root_id::uuid=requested.root_id
    GROUP BY requested.root_id,requested.root_bytes
   ), bounded AS (
    SELECT root_id,sum(bytes) OVER(ORDER BY root_id ROWS UNBOUNDED PRECEDING)+2 page_bytes FROM sized
   )
   SELECT bounded.root_id::text root_id,
    COALESCE(jsonb_agg(decisions.decision ORDER BY decisions.decision->>'term_key') FILTER(WHERE decisions.decision IS NOT NULL),'[]'::jsonb) decisions
   FROM bounded LEFT JOIN decisions ON decisions.root_id::uuid=bounded.root_id
   WHERE bounded.page_bytes<=$6 GROUP BY bounded.root_id ORDER BY bounded.root_id`,
  [run.id,run.workspace_id,run.context_digest,contract,JSON.stringify(items.map(root=>({root_id:root.root_id,
    fingerprint:root.fingerprint,root_bytes:Buffer.byteLength(JSON.stringify(root))}))),classificationPageBytes])).rows;
  for (const row of rows) result.set(row.root_id,row.decisions);
  return result;
}

/** A contiguous metadata/correction page. No cursor is advanced until commitPage. */
export async function readSignalWorkspaceClassificationPageV1(args: {database: SignalWorkspaceClassificationDatabaseV1;
  lease: SignalWorkspaceClassificationLeaseV1; limit?: number}): Promise<SignalWorkspaceClassificationPageV1> {
  const limit=limitValue(args.limit,128);
  return tx(args.database,async client=>{
    const run=await requireLease(client,args.lease),rows=await roots(client,run,limit+1);
    const candidates=rows.slice(0,limit),corrections=await pageCorrections(client,run,candidates);
    const items: SignalWorkspaceClassificationPageV1["items"]=[];let bytes=2;
    for (const root of candidates) {
      if (!corrections.has(root.root_id)) {
        if (!items.length) return fail("workspace_classification_page_capacity_exceeded",422);
        break;
      }
      const item={root,corrections:corrections.get(root.root_id)!},size=Buffer.byteLength(JSON.stringify(item))+1;
      if (bytes+size>classificationPageBytes) {
        if (!items.length) return fail("workspace_classification_page_capacity_exceeded",422);
        break;
      }
      items.push(item);bytes+=size;
    }
    return {items,done:rows.length===items.length};
  });
}

/** The selected roots must remain the next complete prefix of the durable cursor. */
export async function readSignalWorkspaceClassificationChunksPageV1(args: {database: SignalWorkspaceClassificationDatabaseV1;
  lease: SignalWorkspaceClassificationLeaseV1; root_ids: string[]; after: SignalWorkspaceClassificationChunksCursorV1|null;
  limit?: number}): Promise<SignalWorkspaceClassificationChunksPageV1> {
  const limit=limitValue(args.limit,128);
  if (!args.root_ids.length||args.root_ids.length>128||args.root_ids.some((id,index)=>
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id)||index>0&&id<=args.root_ids[index-1]!))
    return fail("workspace_classification_root_sequence_invalid",422);
  return tx(args.database,async client=>{
    const run=await requireLease(client,args.lease),expected=await roots(client,run,args.root_ids.length);
    if (expected.length!==args.root_ids.length||expected.some((root,index)=>root.root_id!==args.root_ids[index]))
      return fail("workspace_classification_root_sequence_invalid");
    if (args.after) {
      const root=expected.find(item=>item.root_id===args.after!.root_id);
      if (!root||!Number.isSafeInteger(args.after.chunk_index)||args.after.chunk_index<0||args.after.chunk_index>=root.expected_chunks)
        return fail("workspace_classification_chunk_cursor_invalid",422);
    }
    const rows=(await client.query<SignalWorkspaceClassificationChunksPageV1["items"][number]>(`
     SELECT item.root_id,item.asset_sha256,jsonb_array_length(asset.chunks->'chunks') expected_chunks,
      (chunk.ordinality-1)::int chunk_index,(chunk.value->>'start')::int start,(chunk.value->>'end')::int "end",
      chunk.value->>'sha256' chunk_sha256,signal_topic_utf16_fragment_v1(asset.full_text,(chunk.value->>'start')::int,(chunk.value->>'end')::int) text
     FROM signal_corpus_preparation_items item JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
      AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
     CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') WITH ORDINALITY chunk
     WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.disposition='eligible' AND item.root_id=ANY($3::uuid[])
      AND ($4::uuid IS NULL OR (item.root_id,chunk.ordinality-1)>($4::uuid,$5::int))
     ORDER BY item.root_id,chunk.ordinality LIMIT $6`,
    [run.preparation_run_id,run.workspace_id,args.root_ids,args.after?.root_id??null,args.after?.chunk_index??-1,limit+1])).rows;
    const items=rows.slice(0,limit);
    for (const chunk of items) if (sha(chunk.text)!==chunk.chunk_sha256||chunk.text.length!==chunk.end-chunk.start)
      return fail("workspace_classification_chunk_integrity_failed");
    const last=items.at(-1);
    return {items,next_cursor:last?{root_id:last.root_id,chunk_index:last.chunk_index}:args.after,done:rows.length<=limit};
  });
}
export async function readSignalWorkspaceClassificationChunkPageV1(args: {database: SignalWorkspaceClassificationDatabaseV1; lease: SignalWorkspaceClassificationLeaseV1;
  root_id: string; after_chunk_index: number|null; limit?: number}): Promise<SignalWorkspaceClassificationChunkPageV1> {
  const limit=limitValue(args.limit,128);
  if (args.after_chunk_index!==null && (!Number.isSafeInteger(args.after_chunk_index)||args.after_chunk_index<0)) return fail("workspace_classification_chunk_cursor_invalid",422);
  return tx(args.database, async client => {const run=await requireLease(client,args.lease),root=(await roots(client,run,1,args.root_id))[0];
    if (!root) return fail("workspace_classification_root_unavailable");
    const items=(await client.query<SignalWorkspaceClassificationChunkPageV1["items"][number]>(`SELECT (chunk.ordinality-1)::int chunk_index,
     (chunk.value->>'start')::int start,(chunk.value->>'end')::int "end",chunk.value->>'sha256' chunk_sha256,
     signal_topic_utf16_fragment_v1(asset.full_text,(chunk.value->>'start')::int,(chunk.value->>'end')::int) text
     FROM signal_corpus_preparation_items item JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
      AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
     CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') WITH ORDINALITY chunk
     WHERE item.run_id=$1::uuid AND item.root_id=$2::uuid AND item.workspace_id=$3::uuid
      AND chunk.ordinality-1>COALESCE($4::int,-1) ORDER BY chunk.ordinality LIMIT $5`,
    [run.preparation_run_id,args.root_id,run.workspace_id,args.after_chunk_index,limit])).rows;
    for (const chunk of items) if (sha(chunk.text)!==chunk.chunk_sha256 || chunk.text.length!==chunk.end-chunk.start) return fail("workspace_classification_chunk_integrity_failed");
    const next=items.at(-1)?.chunk_index??args.after_chunk_index;
    return {root_id:root.root_id,asset_sha256:root.asset_sha256,expected_chunks:root.expected_chunks,after_chunk_index:args.after_chunk_index,
      items,next_chunk_index:next,done:next!==null&&next+1===root.expected_chunks}; });
}
async function persistRoot(client: PoolClient, run: Run, root: SignalWorkspaceClassificationRootV1, raw: unknown,
  source?: {item_id:string; assignments:Map<string,string>}) {
  const outcome=parseSignalWorkspaceClassificationOutcomeV1({identity:run.identity,
    root:{root_id:root.root_id,fingerprint:root.fingerprint,correction_digest:root.correction_digest},outcome:raw});
  if (outcome.coverage.expected_chunks!==root.expected_chunks || outcome.coverage.chunk_coverage_digest!==root.chunk_coverage_digest) return fail("workspace_classification_chunk_coverage_incomplete");
  // A correction is independent of an engine error. It must never silently
  // disappear merely because the engine did not return it in its sparse output.
  const missing=(await client.query<{missing:boolean}>(`SELECT EXISTS(SELECT 1 FROM signal_topic_membership_overrides correction
   JOIN signal_topic_catalog_executions execution ON execution.id=$1::uuid
   JOIN LATERAL jsonb_array_elements(execution.input_snapshot->'topics') topic ON topic->'definition'->>'term_key'=correction.term_key
   WHERE correction.workspace_id=$2::uuid AND correction.canonical_root_id=$3::uuid AND correction.origin_input_contract=$4
    AND correction.root_fingerprint=$5 AND correction.context_digest=$6
    AND correction.definition_digest=topic->'definition'->>'definition_digest'
    AND correction.definition_revision=(topic->'definition'->>'definition_revision')::int
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($7::jsonb) decision(correction_operation_id uuid)
      WHERE decision.correction_operation_id=correction.correction_operation_id)) missing`,
  [run.id,run.workspace_id,root.root_id,contract,root.fingerprint,run.context_digest,JSON.stringify(outcome.decisions)])).rows[0]!.missing;
  if(missing)return fail("workspace_classification_correction_missing");
  outcome.decisions.sort((a,b)=>a.term_key<b.term_key?-1:a.term_key>b.term_key?1:0);
  const op=await operation(client,run,"append-results",`classification:${run.id}:${root.root_id}`,outcome);
  const item=randomUUID(),{decisions,...metadata}=outcome;
  const itemDigest=digest({...metadata,decisions:decisions.map(({taxonomy_term_id: _id,...decision})=>decision)});
  await client.query(`INSERT INTO signal_classification_generation_items(id,workspace_id,generation_id,canonical_root_id,resolution_state,
   technical_error_code,item_digest,root_fingerprint,correction_digest,reuse_key,outcome_metadata,source_generation_item_id)
   VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::uuid)`,
  [item,run.workspace_id,run.generation_id,root.root_id,outcome.resolution_state,outcome.technical_error_code,itemDigest,
    root.fingerprint,root.correction_digest,outcome.reuse_key,JSON.stringify(metadata),source?.item_id??null]);
  // The 8 MiB contract bounds transport, not membership count. All decisions
  // are inserted set-wise in this same transaction before advancing the cursor.
  const values=decisions.map(decision=>({...decision,source_assignment_id:source?.assignments.get(decision.term_key)??null}));
  if(values.length) await client.query(`INSERT INTO signal_classification_assignments(workspace_id,generation_id,generation_item_id,canonical_root_id,
   taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,labeling_function_version_id,model_version_id,approval_policy_id,
   decided_by_user_id,score,evidence_digest,lineage_digest,operation_id,source_assignment_id,correction_operation_id,definition_digest,definition_revision,membership_basis,membership_metadata)
   SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,row.taxonomy_term_id,row.resolution_method,row.disposition,row.labeling_function_version_id,
    row.model_version_id,row.approval_policy_id,row.decided_by_user_id,row.score,row.evidence_digest,row.lineage_digest,$6::uuid,row.source_assignment_id,
    row.correction_operation_id,row.definition_digest,row.definition_revision,COALESCE(row.membership_basis,'decision'),row.membership_metadata
   FROM jsonb_to_recordset($7::jsonb) row(taxonomy_term_id uuid,resolution_method text,disposition text,labeling_function_version_id uuid,
    model_version_id uuid,approval_policy_id uuid,decided_by_user_id uuid,score numeric,evidence_digest text,lineage_digest text,source_assignment_id uuid,
    correction_operation_id uuid,definition_digest text,definition_revision integer,membership_basis text,membership_metadata jsonb)`,
  [run.workspace_id,run.generation_id,item,root.root_id,run.taxonomy_profile_id,op,JSON.stringify(values)]);
  await client.query(`UPDATE signal_topic_catalog_executions SET cursor_root_id=$2::uuid,processed_roots=processed_roots+1,
   processed_chunks=processed_chunks+$3,progress=LEAST(99,((processed_roots+1)*100/GREATEST(denominator,1))),updated_at=clock_timestamp()
   WHERE id=$1::uuid`,[run.id,root.root_id,outcome.coverage.processed_chunks]);
  await closeOperation(client,op,{generation_item_id:item,root_id:root.root_id,decisions:decisions.length});
  return {...view(run),cursor_root_id:root.root_id};
}
export async function commitSignalWorkspaceClassificationRootV1(args:{database:SignalWorkspaceClassificationDatabaseV1;lease:SignalWorkspaceClassificationLeaseV1;outcome:SignalWorkspaceClassificationOutcomeV1}) {
  return tx(args.database,async client=>{const run=await requireLease(client,args.lease,true),root=(await roots(client,run,1))[0];
    if(!root||root.root_id!==args.outcome.root.root_id)return fail("workspace_classification_root_sequence_invalid");
    return persistRoot(client,run,root,args.outcome);});
}

/** One transaction and durable cursor CAS for a bounded prefix. Every assignment
 * still passes the existing per-row authority/evidence triggers. */
export async function commitSignalWorkspaceClassificationPageV1(args:{database:SignalWorkspaceClassificationDatabaseV1;
  lease:SignalWorkspaceClassificationLeaseV1;outcomes:SignalWorkspaceClassificationOutcomeV1[]}):Promise<SignalWorkspaceClassificationLeaseV1> {
  if (!args.outcomes.length||args.outcomes.length>128) return fail("workspace_classification_page_invalid",422);
  if (Buffer.byteLength(JSON.stringify(args.outcomes))>classificationPageBytes) return fail("workspace_classification_page_capacity_exceeded",422);
  return tx(args.database,async client=>{
    const run=await requireLease(client,args.lease,true),expected=await roots(client,run,args.outcomes.length);
    if (expected.length!==args.outcomes.length) return fail("workspace_classification_root_sequence_invalid");
    const corrections=await pageCorrections(client,run,expected);
    if (corrections.size!==expected.length) return fail("workspace_classification_page_capacity_exceeded",422);
    const entries=args.outcomes.map((raw,index)=>{
      const root=expected[index]!;
      if (raw.root.root_id!==root.root_id) return fail("workspace_classification_root_sequence_invalid");
      const outcome=parseSignalWorkspaceClassificationOutcomeV1({identity:run.identity,
        root:{root_id:root.root_id,fingerprint:root.fingerprint,correction_digest:root.correction_digest},outcome:raw});
      if (outcome.coverage.expected_chunks!==root.expected_chunks||outcome.coverage.chunk_coverage_digest!==root.chunk_coverage_digest)
        return fail("workspace_classification_chunk_coverage_incomplete");
      const provided=new Set(outcome.decisions.map(decision=>decision.correction_operation_id));
      if ((corrections.get(root.root_id)??[]).some(decision=>!provided.has(decision.correction_operation_id)))
        return fail("workspace_classification_correction_missing");
      outcome.decisions.sort((a,b)=>a.term_key<b.term_key?-1:a.term_key>b.term_key?1:0);
      const {decisions,...metadata}=outcome,operation_id=randomUUID(),item_id=randomUUID();
      const result={generation_item_id:item_id,root_id:root.root_id,decisions:decisions.length};
      const result_digest=digest(result);
      return {root_id:root.root_id,operation_id,item_id,request_key:sha(`classification:${run.id}:${root.root_id}`),
        request_digest:digest(outcome),item_digest:digest({...metadata,decisions:decisions.map(({taxonomy_term_id:_id,...decision})=>decision)}),
        root_fingerprint:root.fingerprint,correction_digest:root.correction_digest,reuse_key:outcome.reuse_key,
        resolution_state:outcome.resolution_state,technical_error_code:outcome.technical_error_code,metadata,decisions,
        result,result_digest,event_digest:sha(`${operation_id}:0:${result_digest}`)};
    });
    const payload=JSON.stringify(entries);
    await client.query(`INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,idempotency_key,request_digest)
     SELECT row.operation_id,$1::uuid,$2::uuid,'append-results',row.request_key,row.request_digest
     FROM jsonb_to_recordset($3::jsonb) row(operation_id uuid,request_key text,request_digest text)`,[run.workspace_id,run.actor_user_id,payload]);
    await client.query(`INSERT INTO signal_classification_generation_items(id,workspace_id,generation_id,canonical_root_id,resolution_state,
     technical_error_code,item_digest,root_fingerprint,correction_digest,reuse_key,outcome_metadata,source_generation_item_id)
     SELECT row.item_id,$1::uuid,$2::uuid,row.root_id,row.resolution_state,row.technical_error_code,row.item_digest,
      row.root_fingerprint,row.correction_digest,row.reuse_key,row.metadata,NULL
     FROM jsonb_to_recordset($3::jsonb) row(item_id uuid,root_id uuid,resolution_state text,technical_error_code text,item_digest text,
      root_fingerprint text,correction_digest text,reuse_key text,metadata jsonb)`,[run.workspace_id,run.generation_id,payload]);
    if (entries.some(entry=>entry.decisions.length)) await client.query(`
     INSERT INTO signal_classification_assignments(workspace_id,generation_id,generation_item_id,canonical_root_id,
      taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,labeling_function_version_id,model_version_id,approval_policy_id,
      decided_by_user_id,score,evidence_digest,lineage_digest,operation_id,source_assignment_id,correction_operation_id,
      definition_digest,definition_revision,membership_basis,membership_metadata)
     SELECT $1::uuid,$2::uuid,entry.item_id,entry.root_id,$3::uuid,decision.taxonomy_term_id,decision.resolution_method,
      decision.disposition,decision.labeling_function_version_id,decision.model_version_id,decision.approval_policy_id,
      decision.decided_by_user_id,decision.score,decision.evidence_digest,decision.lineage_digest,entry.operation_id,NULL,
      decision.correction_operation_id,decision.definition_digest,decision.definition_revision,COALESCE(decision.membership_basis,'decision'),decision.membership_metadata
     FROM jsonb_to_recordset($4::jsonb) entry(item_id uuid,root_id uuid,operation_id uuid,decisions jsonb)
     CROSS JOIN LATERAL jsonb_to_recordset(entry.decisions) decision(taxonomy_term_id uuid,resolution_method text,disposition text,
      labeling_function_version_id uuid,model_version_id uuid,approval_policy_id uuid,decided_by_user_id uuid,score numeric,
      evidence_digest text,lineage_digest text,correction_operation_id uuid,definition_digest text,definition_revision integer,
      membership_basis text,membership_metadata jsonb)`,[run.workspace_id,run.generation_id,run.taxonomy_profile_id,payload]);
    await client.query(`INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,object_type,object_id,
     previous_state_digest,next_state_digest,event_digest)
     SELECT $1::uuid,row.operation_id,0,'results-appended','generation-item',row.item_id,NULL,row.result_digest,row.event_digest
     FROM jsonb_to_recordset($2::jsonb) row(operation_id uuid,item_id uuid,result_digest text,event_digest text)`,[run.workspace_id,payload]);
    await client.query(`UPDATE signal_classification_operations operation SET status='completed',result=row.result,completed_at=clock_timestamp()
     FROM jsonb_to_recordset($2::jsonb) row(operation_id uuid,result jsonb) WHERE operation.id=row.operation_id AND operation.workspace_id=$1::uuid`,[run.workspace_id,payload]);
    const last=entries.at(-1)!;
    const saved=await client.query(`UPDATE signal_topic_catalog_executions SET cursor_root_id=$2::uuid,processed_roots=processed_roots+$3,
     processed_chunks=processed_chunks+$4,progress=LEAST(99,((processed_roots+$3)*100/GREATEST(denominator,1))),updated_at=clock_timestamp()
     WHERE id=$1::uuid AND cursor_root_id IS NOT DISTINCT FROM $5::uuid AND execution_token=$6::uuid AND status='running' RETURNING id`,
    [run.id,last.root_id,entries.length,entries.reduce((sum,entry)=>sum+entry.metadata.coverage.processed_chunks,0),args.lease.cursor_root_id,args.lease.execution_token]);
    if (saved.rows.length!==1) return fail("workspace_classification_lease_lost");
    return {...view(run),cursor_root_id:last.root_id};
  });
}
export async function copySignalWorkspaceClassificationRootV1(args:{database:SignalWorkspaceClassificationDatabaseV1;lease:SignalWorkspaceClassificationLeaseV1;root_id:string;source_item_id:string}) {
  return tx(args.database,async client=>{const run=await requireLease(client,args.lease,true),root=(await roots(client,run,1))[0];
    if(!root||root.root_id!==args.root_id||root.reuse_item_id!==args.source_item_id)return fail("workspace_classification_reuse_unavailable");
    const metadata=(await client.query<{outcome_metadata:Omit<SignalWorkspaceClassificationOutcomeV1,"decisions">}>(
      "SELECT outcome_metadata FROM signal_classification_generation_items WHERE id=$1::uuid AND workspace_id=$2::uuid",[args.source_item_id,run.workspace_id])).rows[0]!.outcome_metadata;
    const rows=(await client.query<{id:string;decision:SignalWorkspaceClassificationOutcomeV1["decisions"][number]}>(`SELECT assignment.id,
     jsonb_build_object('taxonomy_term_id',topic->>'taxonomy_term_id','term_key',term.term_key,'definition_revision',assignment.definition_revision,
      'definition_digest',assignment.definition_digest,'disposition',assignment.disposition,'resolution_method',assignment.resolution_method,
      'model_version_id',assignment.model_version_id,'labeling_function_version_id',assignment.labeling_function_version_id,'approval_policy_id',assignment.approval_policy_id,
      'decided_by_user_id',assignment.decided_by_user_id,'correction_operation_id',assignment.correction_operation_id,'score',assignment.score,
      'evidence_digest',assignment.evidence_digest,'lineage_digest',assignment.lineage_digest)
      ||CASE WHEN assignment.membership_basis='computed_cluster' THEN jsonb_build_object('membership_basis',assignment.membership_basis,'membership_metadata',assignment.membership_metadata) ELSE '{}'::jsonb END decision
     FROM signal_classification_assignments assignment JOIN taxonomy_terms term ON term.id=assignment.taxonomy_term_id
     JOIN signal_topic_catalog_executions execution ON execution.id=$2::uuid
     JOIN LATERAL jsonb_array_elements(execution.input_snapshot->'topics') topic ON topic->'definition'->>'term_key'=term.term_key
     WHERE assignment.generation_item_id=$1::uuid ORDER BY term.term_key`,[args.source_item_id,run.id])).rows;
    return persistRoot(client,run,root,{...metadata,decisions:rows.map(row=>row.decision)},
      {item_id:args.source_item_id,assignments:new Map(rows.map(row=>[row.decision.term_key,row.id]))});});
}
export async function finishSignalWorkspaceClassificationV1(args:{database:SignalWorkspaceClassificationDatabaseV1;lease:SignalWorkspaceClassificationLeaseV1}) {
  return tx(args.database,async client=>{const run=await requireLease(client,args.lease,true);
    const summary=(await client.query<{roots:number;errors:number;approved:number;pending:number;rejected:number;abstained:number;chunks:string;finalized_digest:string}>(`SELECT count(*)::int roots,
     count(*) FILTER(WHERE resolution_state='error')::int errors,count(*) FILTER(WHERE resolution_state='approved')::int approved,
     count(*) FILTER(WHERE resolution_state='pending')::int pending,count(*) FILTER(WHERE resolution_state='rejected')::int rejected,
     count(*) FILTER(WHERE resolution_state='abstained')::int abstained,COALESCE(sum((outcome_metadata->'coverage'->>'processed_chunks')::bigint),0)::text chunks,
     'sha256:'||encode(digest(convert_to(COALESCE(string_agg(item_digest,'' ORDER BY canonical_root_id),'empty'),'UTF8'),'sha256'),'hex') finalized_digest
     FROM signal_classification_generation_items WHERE generation_id=$1::uuid`,[run.generation_id])).rows[0]!;
    if(summary.roots!==run.denominator||run.processed_roots!==run.denominator||summary.errors===0&&summary.chunks!==run.expected_chunks)return fail("workspace_classification_coverage_incomplete");
    if((await client.query(`SELECT 1 FROM signal_classification_assignments assignment JOIN signal_classification_generations generation ON generation.id=assignment.generation_id
     WHERE generation.id=$1::uuid AND NOT signal_workspace_classification_assignment_current_v1(assignment,generation) LIMIT 1`,[run.generation_id])).rows.length)return fail("workspace_classification_decision_authority_changed");
    const op=await operation(client,run,"finalize-generation",`classification:${run.id}:finish`,summary);
    await client.query("UPDATE signal_classification_generations SET status='ready',finalized_digest=$2,finalized_at=clock_timestamp() WHERE id=$1::uuid",[run.generation_id,summary.finalized_digest]);
    await client.query(`UPDATE signal_topic_catalog_executions SET status='ready',progress=100,result_summary=$2::jsonb,
     completed_at=clock_timestamp(),execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,
    [run.id,JSON.stringify({...summary,complete_usable:summary.errors===0})]);
    await closeOperation(client,op,{generation_id:run.generation_id,...summary});
    await completeProjectionDispatch(client,run.id);
    return {generation_id:run.generation_id,execution_id:run.id,complete_usable:summary.errors===0,summary};});
}
/** Failure cleanup preserves a checkpoint even when its acknowledgement was lost. */
export async function failSignalWorkspaceClassificationV1(args:{database:SignalWorkspaceClassificationDatabaseV1;lease:SignalWorkspaceClassificationLeaseV1;error_code:string}) {
  const code=/^workspace_classification_[a-z_]{1,100}$/u.test(args.error_code)?args.error_code:"workspace_classification_worker_failed";
  await args.database.query(`WITH failed AS(UPDATE signal_topic_catalog_executions SET status='failed',error_code=$4,execution_token=NULL,execution_expires_at=NULL,
   completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid AND workspace_id=$2::uuid AND execution_token=$3::uuid
    AND input_contract='workspace-topic-classification-v1' AND status='running' RETURNING id)
   UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE dispatch_kind='execution' AND execution_id IN(SELECT id FROM failed)`,[args.lease.execution_id,args.lease.workspace_id,args.lease.execution_token,code]);
}
export async function retrySignalWorkspaceClassificationV1(args:{database:SignalWorkspaceClassificationDatabaseV1;execution_id:string;actor_user_id:string}) {
  return tx(args.database,async client=>{const run=await lockRun(client,args.execution_id);
    if(run.actor_user_id!==args.actor_user_id)return fail("workspace_classification_forbidden",403);await current(client,run);
    if(["queued","running","ready"].includes(run.status))return {execution_id:run.id,replayed:true};
    await client.query("UPDATE signal_topic_catalog_executions SET status='queued',error_code=NULL,completed_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid",[run.id]);
    await client.query("UPDATE signal_topic_classification_outbox SET status='pending',attempt_count=0,available_at=clock_timestamp(),completed_at=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=NULL WHERE dispatch_kind='execution' AND execution_id=$1::uuid",[run.id]);
    return {execution_id:run.id,replayed:false};});
}
async function completeProjectionDispatch(client:PoolClient,execution_id:string){
  await client.query("UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE dispatch_kind='execution' AND execution_id=$1::uuid",[execution_id]);
}
export async function heartbeatSignalWorkspaceClassificationV1(args:{database:SignalWorkspaceClassificationDatabaseV1;lease:SignalWorkspaceClassificationLeaseV1}){
  return tx(args.database,async client=>{await requireLease(client,args.lease,true);});
}
export async function readSignalWorkspaceClassificationCorrectionsV1(args:{database:SignalWorkspaceClassificationDatabaseV1;lease:SignalWorkspaceClassificationLeaseV1;root_id:string}){
  return tx(args.database,async client=>{const run=await requireLease(client,args.lease),root=(await roots(client,run,1,args.root_id))[0];
    if(!root)return fail('workspace_classification_root_unavailable');
    return (await client.query<{decision:SignalWorkspaceClassificationOutcomeV1['decisions'][number]}>(`SELECT jsonb_build_object(
      'taxonomy_term_id',topic->>'taxonomy_term_id','term_key',correction.term_key,'definition_digest',correction.definition_digest,'definition_revision',correction.definition_revision,
      'disposition',CASE correction.disposition WHEN 'belongs' THEN 'approved' ELSE 'rejected' END,'resolution_method','human',
      'model_version_id',NULL,'labeling_function_version_id',NULL,'approval_policy_id',NULL,'decided_by_user_id',operation.actor_user_id,
      'correction_operation_id',operation.id,'score',NULL,'evidence_digest',operation.request_digest,'lineage_digest',operation.request_digest) decision
     FROM signal_topic_membership_overrides correction JOIN signal_topic_membership_operations operation ON operation.id=correction.correction_operation_id
     JOIN signal_topic_catalog_executions execution ON execution.id=$1::uuid
     JOIN LATERAL jsonb_array_elements(execution.input_snapshot->'topics') topic ON topic->'definition'->>'term_key'=correction.term_key
     WHERE correction.workspace_id=$2::uuid AND correction.canonical_root_id=$3::uuid AND correction.origin_input_contract=$4
      AND correction.root_fingerprint=$5 AND correction.context_digest=$6 AND correction.definition_digest=topic->'definition'->>'definition_digest'
      AND correction.definition_revision=(topic->'definition'->>'definition_revision')::int ORDER BY correction.term_key`,
      [run.id,run.workspace_id,root.root_id,contract,root.fingerprint,run.context_digest])).rows.map(row=>row.decision);
  });
}
export async function loadSignalWorkspaceClassificationStatusV1(args:{database:SignalWorkspaceClassificationDatabaseV1;workspace_id:string;actor_user_id:string}) {
  return tx(args.database,async client=>{
    if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id})).can_view)return fail("workspace_classification_forbidden",403);
    const rows=(await client.query<{id:string;generation_id:string;status:string;result_summary:Record<string,unknown>;complete:boolean;
      sources_current:boolean;identity:SignalWorkspaceClassificationIdentityV1;correction_digest:string;taxonomy_profile_id:string}>(`WITH selected AS (
     SELECT execution.id,execution.generation_id,execution.status,execution.result_summary,generation.generation_version,
      generation.input_snapshot->'identity' identity,generation.input_snapshot->>'correction_digest' correction_digest,generation.taxonomy_profile_id,
      (generation.status='ready' AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item
       WHERE item.generation_id=generation.id AND item.resolution_state='error')) complete,
      (generation.input_revision=state.input_revision AND (generation.policy_valid_until IS NULL OR generation.policy_valid_until>now())
       AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments assignment WHERE assignment.generation_id=generation.id
        AND NOT signal_workspace_classification_assignment_current_v1(assignment,generation))) sources_current
     FROM signal_topic_catalog_executions execution JOIN signal_classification_generations generation ON generation.id=execution.generation_id
     JOIN signal_corpus_preparation_input_state state ON state.workspace_id=generation.workspace_id
     WHERE execution.workspace_id=$1::uuid AND execution.input_contract=$2)
     SELECT * FROM selected WHERE id=(SELECT id FROM selected ORDER BY generation_version DESC LIMIT 1)
       OR id=(SELECT id FROM selected WHERE complete ORDER BY generation_version DESC LIMIT 1)
     ORDER BY generation_version DESC`,[args.workspace_id,contract])).rows;
    let inputs:Awaited<ReturnType<typeof loadSignalWorkspaceClassificationInputV1>>|null=null;
    if(rows.length) inputs=await loadSignalWorkspaceClassificationInputV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id}).catch(error=>{
      if(error instanceof SignalWorkspaceClassificationError&&error.code==="workspace_classification_catalog_unavailable")return null;
      throw error;
    });
    const views=rows.map(row=>({id:row.id,generation_id:row.generation_id,status:row.status,result_summary:row.result_summary,
      complete:row.complete,is_current:row.complete&&row.sources_current&&inputs!==null
       &&row.correction_digest===inputs.correction_digest&&row.identity.catalog_digest===inputs.catalog_digest
       &&row.identity.context_digest===inputs.context_digest&&row.identity.compiler_digest===inputs.compiler_digest
       &&row.identity.embedding_config_digest===inputs.embedding_config_digest}));
    return {latest_run:views[0]??null,latest_complete:views.find(row=>row.complete)??null};
  },true);
}
