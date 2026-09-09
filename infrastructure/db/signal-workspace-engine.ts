import type { Pool, PoolClient } from "pg";
import { buildSignalWorkspaceIncrementalDescriptorWithClientV1, readSignalWorkspaceNumericRecoveryWithQueryableV1, type SignalWorkspaceIncrementalDescriptorV1 } from "./signal-workspace-engine-incremental";
import { createHash, randomUUID } from "node:crypto";
import { assertSignalWorkspaceEmbeddingProfileV1, signalWorkspaceEmbeddingDigestV1,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1, parseSignalWorkspaceInterpretationConfigurationV1, type SignalWorkspaceEmbeddingProfileV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { ensureSignalTopicCatalogStoreV1, loadSignalTopicInheritedContextStoreV1 } from "./signal-topic-catalog";
import { loadSignalWorkspaceTopicPrototypePlanV1, loadSignalWorkspaceAutonomousContextInputsV1 } from "./signal-workspace-topic-prototype-inputs";
import { loadSignalWorkspaceTopicInputSnapshotWithQueryableV1 } from "./signal-workspace-topic-computation";
import type { SignalWorkspaceEngineInterpretationConfigurationV1 } from "./signal-workspace-engine-interpretation";
import { requestSignalWorkspaceTopicProjectionWithClientV1 } from "./signal-workspace-topic-projection";

export const SIGNAL_WORKSPACE_ENGINE_RETRYABLE_ERRORS_V1 = [
  "workspace_engine_worker_failed", "workspace_engine_process_failed", "workspace_engine_queue_unavailable",
  "workspace_engine_interpretation_receipt_recovery_required",
  "workspace_engine_storage_transport_failed", "workspace_engine_storage_unavailable", "topic_queue_unavailable"
] as const;
export const isSignalWorkspaceEngineRetryableErrorV1 = (code: string | null,
  evidence?: { storage_recovery_eligible?: boolean; interpretation_evidence_recovery_eligible?: boolean; editorial_repair_recovery_eligible?: boolean; transport_recovery_eligible?: boolean }) =>
  (SIGNAL_WORKSPACE_ENGINE_RETRYABLE_ERRORS_V1 as readonly string[]).includes(code ?? "")
  || code === "workspace_engine_storage_verification_failed" && evidence?.storage_recovery_eligible === true
  || code === "workspace_engine_interpretation_cluster_invalid" && evidence?.interpretation_evidence_recovery_eligible === true
  || code === "workspace_engine_interpretation_output_invalid" && evidence?.editorial_repair_recovery_eligible === true
  || code === "workspace_engine_interpretation_transport_terminal_confirmed" && evidence?.transport_recovery_eligible === true;
export type SignalWorkspaceEngineDatabaseV1 = Pick<Pool, "query" | "connect">;
export class SignalWorkspaceEngineError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalWorkspaceEngineError"; }
}
export type SignalWorkspaceEngineCursorV1 = { root_id: string; chunk_index: number };
export type SignalWorkspaceEngineGuideCursorV1 = { guide_key: string; input_digest: string };
export type SignalWorkspaceEngineAnalysisConfigV1 = {
  call_configuration: SignalWorkspaceEngineInterpretationConfigurationV1;
  budget_timezone: string; daily_cap_micro_usd: number;
};
export type SignalWorkspaceEngineUnitManifestV1 = { unit_count: number; unit_digest: string };
export type SignalWorkspaceEngineFitCheckpointV1 = {
  checkpoint_digest: string; model_version_id: string | null; model_artifact_id: string | null; output_artifact_id: string;
  result_kind: "computational_grouping" | "insufficient_population";
  interpretation_manifest: SignalWorkspaceEngineUnitManifestV1;
};
export type SignalWorkspaceEngineSnapshotV1 = {
  contract_version: "workspace-topic-engine-v1"; workspace_id: string; taxonomy_profile_id: string;
  preparation_run_id: string; embedding_run_id: string; input_revision: string;
  embedding_profile: SignalWorkspaceEmbeddingProfileV1; context_digest: string; catalog_digest: string;
  prototype_plan_digest: string; expected_roots: number; expected_chunks: number; expected_guides: number;
  parent_execution_id: string | null; context_refs: unknown[]; engine_config: Record<string,unknown>; claude_cap_micro_usd: number;
  interpretation_config?: SignalWorkspaceEngineAnalysisConfigV1;
  numeric_descriptor?: SignalWorkspaceIncrementalDescriptorV1;
};
export type SignalWorkspaceEngineInterpretationRevisionV1 = {
  contract_version: "workspace-engine-interpretation-revision-v1"; revision_digest: string;
  execution_id: string; workspace_id: string; actor_user_id: string; input_digest: string;
  source_call_id: string; source_request_digest: string; source_response_sha256: string; source_configuration_digest: string;
  configuration: SignalWorkspaceEngineAnalysisConfigV1; fit_checkpoint_digest: string;
  retained_unit_manifest: SignalWorkspaceEngineUnitManifestV1; budget_date: string; admission_not_after: string; authorized_at: string;
};
export type SignalWorkspaceEngineInterpretationCheckpointV1 = {
  artifact_id: string; artifact_key: string; storage_key: string; sha256: string; size_bytes: number; media_type: string;
  unit_keys: string[]; call_id: string; call_configuration: SignalWorkspaceEngineInterpretationConfigurationV1; interpretation_revision_digest: string | null;
};
export type SignalWorkspaceEngineLeaseV1 = {
  execution_id: string; workspace_id: string; execution_token: string; input_digest: string;
  snapshot: SignalWorkspaceEngineSnapshotV1;
  effective_interpretation_config?: SignalWorkspaceEngineAnalysisConfigV1; interpretation_revision_digest?: string | null;
};
export type SignalWorkspaceEngineChunkV1 = {
  root_id: string; root_fingerprint: string; asset_sha256: string; expected_root_chunks: number;
  chunk_index: number; start: number; end: number; chunk_sha256: string; text: string; vector: number[];
};
export type SignalWorkspaceEngineGuideV1 = {
  guide_key: string; role: "topic_positive" | "topic_negative" | "scope_positive" | "scope_negative";
  input_digest: string; text_sha256: string; vector: number[];
};
export type SignalWorkspaceEngineChunkPageV1 = {
  items: SignalWorkspaceEngineChunkV1[]; next_cursor: SignalWorkspaceEngineCursorV1 | null; done: boolean;
};
export type SignalWorkspaceEngineGuidePageV1 = {
  items: SignalWorkspaceEngineGuideV1[]; next_cursor: SignalWorkspaceEngineGuideCursorV1 | null; done: boolean;
};
export type SignalWorkspaceEngineArtifactV1 = {
  artifact_key: string; artifact_type: "engine_model" | "engine_output" | "engine_proposals";
  title: string; storage_key: string; sha256: string; size_bytes: number;
  media_type: string; metadata: Record<string, unknown>;
};
export type SignalWorkspaceEngineStatusV1 = {
  observed_at: string; workspace_id: string; latest_run: null | {
    execution_id: string; status: "queued" | "running" | "ready" | "failed";
    phase: "queued" | "exporting" | "fitting" | "persisting" | "interpreting" | "materializing" | "complete" | "failed";
    progress: number; expected_roots: number; expected_chunks: number; expected_guides: number;
    processed_roots: number; processed_chunks: number; error_code: string | null; is_current: boolean;
    model_version_id: string | null; artifact_count: number; claude_cap_micro_usd: number; result_kind: "computational_grouping" | "insufficient_population" | null;
    materialization_progress?:import('./signal-workspace-engine-progress').SignalWorkspaceEngineProgressCheckpointV1|null;
    materialization_pending?:boolean;materialization_error_code?:string|null;materialization_retry_available?:boolean;
    fit_completed: boolean; expected_interpretation_units: number; interpreted_units: number; materialized_topics: number;
    storage_recovery_eligible?: boolean;
    interpretation_evidence_recovery_eligible?: boolean;
    editorial_repair_recovery_eligible?: boolean; transport_recovery_eligible?: boolean;
  }; latest_complete_execution_id: string | null; latest_complete: SignalWorkspaceEngineStatusV1["latest_run"];
};
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceEngineError(code, status); };
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const natural = (value: unknown): number => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) return fail("workspace_engine_count_invalid", 503); return n; };
const limitOf = (value?: number) => { const n = value ?? 128; if (!Number.isInteger(n) || n < 1 || n > 128) return fail("workspace_engine_page_invalid", 422); return n; };
// An explicit retry may rerun numerical fit after repairing storage only before
// any durable fit/model/provider evidence exists. Every upload/hash is verified
// again; a verification error never enters the unconditional retry allowlist.
const storageRecoveryPredicate = `execution.status='failed' AND execution.error_code='workspace_engine_storage_verification_failed'
 AND NOT (execution.result_summary ? 'fit_checkpoint') AND NOT (execution.result_summary ? 'analysis_checkpoint')
 AND execution.result_summary->>'model_version_id' IS NULL
 AND NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id)
 AND NOT EXISTS(SELECT 1 FROM tagging_model_versions model WHERE model.configuration->>'execution_id'=execution.id::text)
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events call WHERE call.catalog_execution_id=execution.id)`;
// This checkpoint is the already-uploaded numerical output, before model
// registration or interpretation. Every bundle reference must have its exact
// immutable, workspace-scoped DB receipt. Object bytes are verified on download.
const outputBundlePredicate = `EXISTS(SELECT 1 FROM analysis_artifacts manifest
 CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(manifest.metadata->'bundle')='array'
   THEN manifest.metadata->'bundle' ELSE '[]'::jsonb END entries) bundle
 WHERE manifest.engine_execution_id=execution.id AND manifest.workspace_id=execution.workspace_id
 AND manifest.artifact_type='engine_output' AND manifest.artifact_key='manifest.json'
 AND jsonb_array_length(bundle.entries) BETWEEN 5 AND 34
 AND (SELECT count(DISTINCT entry->>'name') FROM jsonb_array_elements(bundle.entries) entry)=jsonb_array_length(bundle.entries)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['manifest.json','model-manifest.json','clusters.open.json','assignments.open.jsonl','roots.jsonl']) required(name)
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle.entries) entry WHERE entry->>'name'=required.name))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle.entries) entry WHERE NOT EXISTS(
   SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id
    AND artifact.workspace_id=execution.workspace_id AND artifact.artifact_key=entry->>'name'
    AND artifact.artifact_type=CASE WHEN entry->>'name'='model-manifest.json' OR entry->>'name' LIKE '%.joblib' THEN 'engine_model' ELSE 'engine_output' END
    AND artifact.content->>'contract_version'='workspace-engine-private-artifact-v1'
    AND artifact.content-'contract_version'=entry-'name'))
 AND (SELECT count(*) FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id
   AND artifact.artifact_type IN('engine_output','engine_model'))=jsonb_array_length(bundle.entries))`;
const interpretationEvidenceRecoveryPredicate = `execution.status='failed'
 AND execution.error_code='workspace_engine_interpretation_cluster_invalid'
 AND execution.input_snapshot ? 'interpretation_config'
 AND NOT (execution.result_summary ? 'fit_checkpoint') AND NOT (execution.result_summary ? 'analysis_checkpoint')
 AND execution.result_summary->>'model_version_id' IS NULL
 AND NOT EXISTS(SELECT 1 FROM tagging_model_versions model WHERE model.configuration->>'execution_id'=execution.id::text)
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events call WHERE call.catalog_execution_id=execution.id)
 AND NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id
   AND artifact.artifact_type NOT IN('engine_output','engine_model'))
 AND (${outputBundlePredicate})`;
// Recover only a known, metered invalid editorial response. An existing repair
// attempt is replayed under its own deterministic request key; it cannot create
// another logical repair. Unknown sends remain blocked across the execution.
const editorialRepairRecoveryPredicate = `execution.status='failed'
 AND execution.error_code='workspace_engine_interpretation_output_invalid'
 AND execution.input_snapshot ? 'interpretation_config' AND execution.result_summary ? 'fit_checkpoint'
 AND NOT (execution.result_summary ? 'analysis_checkpoint')
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events uncertain WHERE uncertain.catalog_execution_id=execution.id
   AND (uncertain.call_state IN('in_flight','outcome_unknown') OR uncertain.call_state='response_persisted'
     AND NOT COALESCE((uncertain.metadata->>'response_complete')::boolean,true)))
 AND EXISTS(SELECT 1 FROM engine_cost_events latest JOIN engine_cost_events source
   ON source.id::text=lower(COALESCE(latest.metadata->'editorial_repair'->>'source_call_id',latest.id::text))
   WHERE latest.id=(SELECT last_call.id FROM engine_cost_events last_call WHERE last_call.catalog_execution_id=execution.id
     ORDER BY last_call.created_at DESC,last_call.id DESC LIMIT 1)
   AND source.workspace_contract='workspace-engine-interpretation-v1' AND source.workspace_id=execution.workspace_id
   AND source.catalog_execution_id=execution.id AND source.actor_user_id=execution.actor_user_id
   AND source.call_state='settled' AND source.response_storage_key IS NOT NULL AND source.response_http_status=200
   AND COALESCE((source.metadata->>'response_complete')::boolean,true) AND NOT (source.metadata ? 'editorial_repair')
   AND source.call_configuration=workspace_engine_interpretation_configuration_v1(execution.id,source.metadata->>'interpretation_revision_digest')
   AND NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id AND artifact.metadata->>'call_id'=source.id::text))
 AND (${outputBundlePredicate})`;
const transportRecoveryPredicate = `execution.status='failed'
 AND execution.error_code='workspace_engine_interpretation_transport_terminal_confirmed'
 AND execution.input_snapshot ? 'interpretation_config' AND execution.result_summary ? 'fit_checkpoint'
 AND NOT (execution.result_summary ? 'analysis_checkpoint')
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events uncertain WHERE uncertain.catalog_execution_id=execution.id
   AND uncertain.call_state IN('in_flight','outcome_unknown'))
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events exhausted WHERE exhausted.catalog_execution_id=execution.id
   AND exhausted.call_state='terminal_confirmed' GROUP BY exhausted.request_digest HAVING count(*)>1)
 AND EXISTS(SELECT 1 FROM engine_cost_events terminal WHERE terminal.catalog_execution_id=execution.id
   AND terminal.call_state='terminal_confirmed' AND terminal.metadata ? 'provider_terminal_receipt'
   AND (SELECT count(*) FROM engine_cost_events sibling WHERE sibling.catalog_execution_id=execution.id
     AND sibling.request_digest=terminal.request_digest AND sibling.call_state='terminal_confirmed')=1)
 AND (${outputBundlePredicate})`;
async function transaction<T>(database: SignalWorkspaceEngineDatabaseV1, work: (client: PoolClient) => Promise<T>, repeatableRead = false): Promise<T> {
  const client = await database.connect();
  try { await client.query(repeatableRead ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN"); await client.query("SET LOCAL search_path=public,extensions,pg_temp"); await client.query("SET LOCAL TIME ZONE 'UTC'");
    const result = await work(client); await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}
async function authorize(client: PoolClient, workspace_id: string, actor_user_id: string, execute = true) {
  const capability = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id, actor_user_id });
  if (!(execute ? capability.can_execute_topics : capability.can_view)) return fail("workspace_engine_forbidden", 403);
}
async function completeDispatch(client: PoolClient, execution_id: string) {
  await client.query(`UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),
    lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE dispatch_kind='execution' AND execution_id=$1::uuid`,[execution_id]);
}
type Run = { interpretation_revision: SignalWorkspaceEngineInterpretationRevisionV1 | null; id: string; workspace_id: string; actor_user_id: string; status: string; input_digest: string;
  input_snapshot: SignalWorkspaceEngineSnapshotV1 & { guides: Array<Omit<SignalWorkspaceEngineGuideV1, "vector">> };
  execution_token: string | null; lease_live: boolean; revision_live: boolean; policy_live: boolean;
  result_summary: Record<string, unknown>; error_code: string | null; processed_roots: number; processed_chunks: string };
async function lockedRun(client: PoolClient, id: string): Promise<Run> {
  const scope = (await client.query<{workspace_id:string}>("SELECT workspace_id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND input_contract='workspace-topic-engine-v1'", [id])).rows[0];
  if (!scope) return fail("workspace_engine_not_found", 404);
  await client.query("SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE", [scope.workspace_id]);
  const row = (await client.query<Run>(`SELECT execution.id,execution.workspace_id,execution.actor_user_id,execution.status,execution.input_digest,
    execution.input_snapshot-'guides' input_snapshot,execution.execution_token,execution.execution_expires_at>clock_timestamp() lease_live,
    state.input_revision=execution.input_revision revision_live,
    (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp()) policy_live,
    execution.result_summary,execution.interpretation_revision,execution.error_code,execution.processed_roots,execution.processed_chunks::text
    FROM signal_topic_catalog_executions execution JOIN signal_corpus_preparation_input_state state USING(workspace_id)
    WHERE execution.id=$1::uuid AND execution.input_contract='workspace-topic-engine-v1' FOR UPDATE OF execution`, [id])).rows[0];
  if (!row) return fail("workspace_engine_not_found", 404); return row;
}
async function current(client: PoolClient, run: Run, full: boolean) {
  if (!run.revision_live || !run.policy_live) return fail("workspace_engine_inputs_stale");
  if (full) {
    const identity = await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id});
    if (identity.context_digest !== run.input_snapshot.context_digest || identity.catalog_digest !== run.input_snapshot.catalog_digest) return fail("workspace_engine_inputs_stale");
    if(run.input_snapshot.numeric_descriptor&&(await client.query<{valid:boolean}>(
      'SELECT signal_workspace_incremental_execution_current_v1($1::uuid) valid',[run.id])).rows[0]?.valid!==true)
      return fail('workspace_engine_incremental_parent_invalid');
  }
}
async function requireLease(client: PoolClient, lease: SignalWorkspaceEngineLeaseV1, full = false) {
  const run = await lockedRun(client, lease.execution_id);
  if (run.workspace_id !== lease.workspace_id || run.input_digest !== lease.input_digest || run.execution_token !== lease.execution_token
    || run.status !== "running" || !run.lease_live) return fail("workspace_engine_lease_conflict");
  await authorize(client, run.workspace_id, run.actor_user_id); await current(client, run, full); return run;
}
/** Internal composition points preserve the existing transaction and lease authority. */
export const withSignalWorkspaceEngineTransactionV1 = transaction;
export async function withSignalWorkspaceEngineLeaseV1<T>(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;full?:boolean},
 work:(client:PoolClient,run:Run)=>Promise<T>):Promise<T>{
 return transaction(args.database,async client=>work(client,await requireLease(client,args.lease,args.full??false)));
}
const leaseView = (run: Run, token: string): SignalWorkspaceEngineLeaseV1 => ({execution_id:run.id,workspace_id:run.workspace_id,
  execution_token:token,input_digest:run.input_digest,snapshot:publicSnapshot(run.input_snapshot),
  effective_interpretation_config:run.interpretation_revision?.configuration??run.input_snapshot.interpretation_config,
  interpretation_revision_digest:run.interpretation_revision?.revision_digest??null});
function publicSnapshot(snapshot: Run["input_snapshot"]): SignalWorkspaceEngineSnapshotV1 { const {guides:_guides,...rest}=snapshot; return rest; }
async function buildInput(client: Pick<PoolClient,'query'>, workspace: string, actor: string) {
  const interestOptions={input_interests_only:true};
  const plan = await loadSignalWorkspaceTopicPrototypePlanV1({queryable:client,workspace_id:workspace,actor_user_id:actor,...interestOptions});
  const source = await loadSignalWorkspaceTopicInputSnapshotWithQueryableV1({queryable:client,workspace_id:workspace,actor_user_id:actor,allow_empty:true,...interestOptions});
  const guides: Array<Omit<SignalWorkspaceEngineGuideV1,"vector">> = [
    ...source.input.topics.flatMap(topic=>topic.compiled.inputs.filter(input=>input.role==='topic_positive'||input.role==='topic_negative')
      .map(input=>({guide_key:`topic:${topic.definition.term_key}`,role:input.role,input_digest:input.input_digest,text_sha256:input.text_sha256}))),
    ...(plan.context_inputs ?? [])
  ].sort((a,b)=>a.guide_key<b.guide_key?-1:a.guide_key>b.guide_key?1:a.input_digest<b.input_digest?-1:1);
  const catalog_digest = signalWorkspaceEmbeddingDigestV1(source.input.topics.map(topic=>({term_key:topic.definition.term_key,
    definition_digest:topic.definition.definition_digest,compiler_digest:topic.compiled.compiler_digest})));
  const context=await loadSignalTopicInheritedContextStoreV1({queryable:client,workspace_id:workspace,complete_context:true});
  return {plan,guides,catalog_digest,context_digest:plan.context_digest,context_refs:context.context_refs};
}
export async function loadSignalWorkspaceEngineInputIdentityV1(args:{queryable:Pick<PoolClient,'query'>;workspace_id:string;actor_user_id:string}) {
  const input=await buildInput(args.queryable,args.workspace_id,args.actor_user_id);
  return {context_digest:input.context_digest,catalog_digest:input.catalog_digest};
}
export async function readSignalWorkspaceEngineInterpretationContextV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1}) {
  return transaction(args.database,async client=>{const run=await requireLease(client,args.lease,true);
    const brand_os=await loadSignalTopicInheritedContextStoreV1({queryable:client,workspace_id:run.workspace_id,complete_context:true});
    const source=await loadSignalWorkspaceTopicInputSnapshotWithQueryableV1({queryable:client,workspace_id:run.workspace_id,
      actor_user_id:run.actor_user_id,allow_empty:true,input_interests_only:true});
    return{actor_user_id:run.actor_user_id,context:{workspace_id:run.workspace_id,execution_id:run.id,
      context_digest:run.input_snapshot.context_digest,data:{brand_os,interests:source.input.topics.map(topic=>topic.definition)}}};
  });
}
/** Cheap-to-transport preflight; inputs are compiled once, never a root×interest array. */
export async function loadSignalWorkspaceEnginePreflightV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string}) {
  return transaction(args.database,async client=>{await authorize(client,args.workspace_id,args.actor_user_id,false);
    let context_digest:string,catalog_digest:string,guides:Array<Omit<SignalWorkspaceEngineGuideV1,'vector'>>,total_interests:number;
    try{const input=await buildInput(client,args.workspace_id,args.actor_user_id);context_digest=input.context_digest;catalog_digest=input.catalog_digest;guides=input.guides;total_interests=input.plan.topics.length;}
    catch(error){if(!(error instanceof Error)||error.message!=='workspace_topic_catalog_required')throw error;
      const input=await loadSignalWorkspaceAutonomousContextInputsV1({queryable:client,workspace_id:args.workspace_id});
      context_digest=input.context.context_digest;catalog_digest=signalWorkspaceEmbeddingDigestV1([]);guides=input.context_inputs;total_interests=0;}
    const embedded=(await client.query<{id:string}>(`SELECT run.id FROM signal_workspace_embedding_runs run
      JOIN signal_corpus_preparation_input_state state USING(workspace_id)
      WHERE run.workspace_id=$1::uuid AND run.input_contract='corpus' AND run.status='completed'
       AND run.input_revision=state.input_revision AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())
      ORDER BY run.completed_at DESC,run.id DESC LIMIT 1`,[args.workspace_id])).rows[0];
    const missing = await missingGuides(client,args.workspace_id,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest,guides);
    return {embedding_run_id:embedded?.id??null,expected_context_digest:context_digest,expected_catalog_digest:catalog_digest,
      expected_guides:guides.length,missing_guides:missing,total_interests};
  });
}
async function missingGuides(client:PoolClient,workspace:string,config:string,guides:Array<Omit<SignalWorkspaceEngineGuideV1,"vector">>) {
  return natural((await client.query<{missing:string}>(`SELECT count(*)::text missing FROM jsonb_to_recordset($3::jsonb) guide(input_digest text,text_sha256 text)
   LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$1::uuid AND cache.config_digest=$2 AND cache.chunk_sha256=guide.text_sha256
   WHERE cache.chunk_sha256 IS NULL`,[workspace,config,JSON.stringify(guides)])).rows[0]!.missing);
}
export async function beginSignalWorkspaceEngineV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;
  idempotency_key:string;embedding_run_id:string;expected_context_digest:string;expected_catalog_digest:string;
  claude_cap_micro_usd:number;engine_config:Record<string,unknown>;parent_execution_id?:string|null;
  interpretation_config?:SignalWorkspaceEngineAnalysisConfigV1;
  incremental_options?:{close_requested:boolean;parent_execution_id?:string;
    automatic_admission?:import('./signal-workspace-numeric-producer').SignalWorkspaceNumericAdmissionV1}}):Promise<{execution_id:string;replayed:boolean}> {
  if(args.incremental_options&&(args.claude_cap_micro_usd!==0||args.interpretation_config))return fail('workspace_engine_incremental_numeric_only',422);
  if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)||!digestPattern.test(args.expected_context_digest)||!digestPattern.test(args.expected_catalog_digest)
    ||!Number.isSafeInteger(args.claude_cap_micro_usd)||args.claude_cap_micro_usd<0||Buffer.byteLength(JSON.stringify(args.engine_config),'utf8')>65536)
    return fail("workspace_engine_request_invalid",422);
  if(args.interpretation_config){const c=args.interpretation_config,p=c.call_configuration;
    if(args.claude_cap_micro_usd<=0||!p||p.provider!=='anthropic'||!p.model||p.model.length>120||!p.pricing_version
      ||!digestPattern.test(p.prompt_digest)||!digestPattern.test(p.schema_digest)||!Number.isSafeInteger(c.daily_cap_micro_usd)||c.daily_cap_micro_usd<=0
      ||![p.input_micro_usd_per_million_tokens,p.output_micro_usd_per_million_tokens,p.cache_read_micro_usd_per_million_tokens,p.cache_creation_micro_usd_per_million_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)
      ||typeof c.budget_timezone!=='string'||c.budget_timezone.length>100||Buffer.byteLength(JSON.stringify(c),'utf8')>16384)return fail('workspace_engine_interpretation_config_invalid',422);
  }
  const requestDigest=signalWorkspaceEmbeddingDigestV1({embedding_run_id:args.embedding_run_id,context_digest:args.expected_context_digest,
    catalog_digest:args.expected_catalog_digest,claude_cap_micro_usd:args.claude_cap_micro_usd,engine_config:args.engine_config,
    ...(args.interpretation_config?{interpretation_config:args.interpretation_config}:{}),
    ...(args.incremental_options?{numeric_policy:'workspace-frozen-model-cohort-v1',close_requested:args.incremental_options.close_requested}:{}),
    ...(args.incremental_options?.automatic_admission?{automatic_admission:args.incremental_options.automatic_admission}:{}),
    parent_selection:args.incremental_options?(args.incremental_options.parent_execution_id??'latest-compatible-numeric-v1'):
      args.parent_execution_id===undefined?"latest-compatible-complete-v1":args.parent_execution_id});
  return transaction(args.database,async client=>{
    await authorize(client,args.workspace_id,args.actor_user_id);
    if(args.interpretation_config&&!(await client.query('SELECT name FROM pg_timezone_names WHERE name=$1',[args.interpretation_config.budget_timezone])).rows[0])return fail('workspace_engine_interpretation_config_invalid',422);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-taxonomy:${args.workspace_id}:topic`]);
    const prior=(await client.query<{id:string;actor_user_id:string;request_digest:string;input_contract:string}>(
      "SELECT id,actor_user_id,request_digest,input_contract FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND (idempotency_key=$2 OR engine_request_keys ? $2)",[args.workspace_id,args.idempotency_key])).rows[0];
    if(prior){if(prior.actor_user_id!==args.actor_user_id||prior.request_digest!==requestDigest||prior.input_contract!=='workspace-topic-engine-v1')return fail('workspace_engine_idempotency_conflict');
      return{execution_id:prior.id,replayed:true};}
    await ensureSignalTopicCatalogStoreV1({client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id});
    await client.query("SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE",[args.workspace_id]);
    const embedded=(await client.query<{id:string;preparation_run_id:string;input_revision:string;profile:SignalWorkspaceEmbeddingProfileV1;
      policy_valid_until:string|null;counts:{eligible_roots:number;completed_roots:number;total_chunk_references:number;processed_chunk_references:number}}>(`
      SELECT run.id,run.preparation_run_id,run.input_revision::text,run.profile,run.counts,
        to_char(run.policy_valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') policy_valid_until
      FROM signal_workspace_embedding_runs run JOIN signal_corpus_preparation_input_state state USING(workspace_id)
      JOIN signal_corpus_preparation_runs prep ON prep.id=run.preparation_run_id AND prep.workspace_id=run.workspace_id
      WHERE run.id=$1::uuid AND run.workspace_id=$2::uuid AND run.input_contract='corpus' AND run.status='completed' AND prep.status='completed'
       AND run.input_revision=state.input_revision AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())`,[args.embedding_run_id,args.workspace_id])).rows[0];
    if(!embedded)return fail('workspace_engine_complete_embeddings_required');assertSignalWorkspaceEmbeddingProfileV1(embedded.profile);
    if(args.incremental_options?.automatic_admission)
      await (await import('./signal-workspace-numeric-producer')).assertSignalWorkspaceNumericAdmissionWithClientV1({queryable:client,
        workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,input_revision:embedded.input_revision,
        admission:args.incremental_options.automatic_admission});
    if(embedded.counts.eligible_roots!==embedded.counts.completed_roots||embedded.counts.total_chunk_references!==embedded.counts.processed_chunk_references)
      return fail('workspace_engine_corpus_embeddings_incomplete');
    const input=await buildInput(client,args.workspace_id,args.actor_user_id);
    if(input.context_digest!==args.expected_context_digest||input.catalog_digest!==args.expected_catalog_digest)return fail('workspace_engine_inputs_stale');
    if(await missingGuides(client,args.workspace_id,embedded.profile.config_digest,input.guides))return fail('workspace_engine_guides_required');
    const missing=natural((await client.query<{missing:string}>(`SELECT count(*)::text missing FROM signal_corpus_preparation_items item
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') chunk
      LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=item.workspace_id AND cache.config_digest=$3 AND cache.chunk_sha256=chunk->>'sha256'
      WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.disposition='eligible' AND cache.chunk_sha256 IS NULL`,
      [embedded.preparation_run_id,args.workspace_id,embedded.profile.config_digest])).rows[0]!.missing);
    if(missing)return fail('workspace_engine_corpus_embeddings_incomplete');
    const numericDescriptor=args.incremental_options?await buildSignalWorkspaceIncrementalDescriptorWithClientV1({queryable:client,
      workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,embedding_config_digest:embedded.profile.config_digest,
      context_digest:input.context_digest,catalog_digest:input.catalog_digest,engine_config:args.engine_config,guides:input.guides,
      ...args.incremental_options}):undefined;
    const parentId=numericDescriptor?numericDescriptor.parent.execution_id:args.parent_execution_id===undefined?(await client.query<{id:string}>(`SELECT prior.id FROM signal_topic_catalog_executions prior
      WHERE prior.workspace_id=$1::uuid AND prior.input_contract='workspace-topic-engine-v1' AND prior.status='ready'
       AND prior.embedding_config_digest=$2 AND prior.input_snapshot->>'context_digest'=$3
       AND prior.result_summary->>'model_version_id' IS NOT NULL
       AND (prior.policy_valid_until IS NULL OR prior.policy_valid_until>clock_timestamp())
       AND NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_items old
        LEFT JOIN signal_corpus_preparation_items current ON current.run_id=$4::uuid AND current.workspace_id=old.workspace_id
         AND current.root_id=old.root_id AND current.disposition='eligible' AND current.fingerprint=old.fingerprint
        WHERE old.run_id=prior.preparation_run_id AND old.workspace_id=prior.workspace_id AND old.disposition='eligible' AND current.root_id IS NULL)
      ORDER BY prior.completed_at DESC,prior.id DESC LIMIT 1`,[args.workspace_id,embedded.profile.config_digest,input.context_digest,embedded.preparation_run_id])).rows[0]?.id??null:args.parent_execution_id;
    if(!numericDescriptor&&args.parent_execution_id&&!((await client.query(`SELECT id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid
      AND input_contract='workspace-topic-engine-v1' AND status='ready' AND embedding_config_digest=$3`,[args.parent_execution_id,args.workspace_id,embedded.profile.config_digest])).rows[0]))return fail('workspace_engine_parent_invalid');
    if((await client.query(`SELECT id FROM signal_topic_catalog_executions WHERE taxonomy_profile_id=$1::uuid AND status IN('queued','running')
      AND ($2::uuid IS NULL OR id<>$2::uuid)`,[input.plan.taxonomy_profile_id,numericDescriptor?.parent.execution_id??null])).rows[0])return fail('workspace_engine_execution_active');
    const snapshot={contract_version:'workspace-topic-engine-v1',workspace_id:args.workspace_id,taxonomy_profile_id:input.plan.taxonomy_profile_id,
      preparation_run_id:embedded.preparation_run_id,embedding_run_id:embedded.id,input_revision:embedded.input_revision,embedding_profile:embedded.profile,
      context_digest:input.context_digest,catalog_digest:input.catalog_digest,prototype_plan_digest:input.plan.plan_digest,
      expected_roots:embedded.counts.eligible_roots,expected_chunks:embedded.counts.total_chunk_references,expected_guides:input.guides.length,
      parent_execution_id:parentId,context_refs:input.context_refs,guides:input.guides,engine_config:args.engine_config,claude_cap_micro_usd:args.claude_cap_micro_usd,
      ...(args.interpretation_config?{interpretation_config:args.interpretation_config}:{}),...(numericDescriptor?{numeric_descriptor:numericDescriptor}:{})};
    const id=randomUUID();
    await client.query(`INSERT INTO signal_topic_catalog_executions(id,workspace_id,taxonomy_profile_id,actor_user_id,intent,idempotency_key,request_digest,
      population_digest,watermark_digest,identity_catalog_digest,definition_digest,denominator,embedding_model,input_contract,
      embedding_run_id,preparation_run_id,input_revision,embedding_config_digest,input_snapshot,input_digest,policy_valid_until,expected_chunks,result_summary,engine_request_keys,created_at,updated_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'search',$5,$6,$7,NULL,$8,$8,$9,$10,'workspace-topic-engine-v1',
      $11::uuid,$12::uuid,$13::bigint,$14,$15::jsonb,'sha256:'||encode(sha256(convert_to(($15::jsonb)::text,'UTF8')),'hex'),$16::timestamptz,$17,'{"phase":"queued"}'::jsonb,jsonb_build_object($5::text,jsonb_build_object('actor_user_id',$4::text,'request_digest',$6::text)),clock_timestamp(),clock_timestamp())`,
      [id,args.workspace_id,input.plan.taxonomy_profile_id,args.actor_user_id,args.idempotency_key,requestDigest,
        signalWorkspaceEmbeddingDigestV1({preparation_run_id:embedded.preparation_run_id,input_revision:embedded.input_revision}),input.catalog_digest,
        snapshot.expected_roots,embedded.profile.model,embedded.id,embedded.preparation_run_id,embedded.input_revision,embedded.profile.config_digest,JSON.stringify(snapshot),embedded.policy_valid_until,snapshot.expected_chunks]);
    await client.query("INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id) VALUES($1::uuid,$2::uuid,$3)",
      [id,args.workspace_id,`workspace-engine-${id}-1`]);
    return {execution_id:id,replayed:false};
  });
}
export async function claimSignalWorkspaceEngineV1(args:{database:SignalWorkspaceEngineDatabaseV1;execution_id:string;worker_job_id:string}):Promise<SignalWorkspaceEngineLeaseV1|null>{
  return transaction(args.database,async client=>{const run=await lockedRun(client,args.execution_id);
    if(run.status==='ready')return null;
    if(run.status==='running'&&run.lease_live)return null;
    if(run.status!=='queued'&&run.status!=='running')return null;
    try{await authorize(client,run.workspace_id,run.actor_user_id);await current(client,run,true);}
    catch(error){const code=error instanceof Error?error.message:'';
      if(!['workspace_engine_forbidden','workspace_engine_inputs_stale','workspace_engine_incremental_parent_invalid','workspace_topic_catalog_required','workspace_topic_catalog_empty'].includes(code))throw error;
      await client.query(`UPDATE signal_topic_catalog_executions SET status='failed',error_code=$2,result_summary=result_summary||'{"phase":"failed"}'::jsonb,
        execution_token=NULL,execution_expires_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,
        [run.id,code==='workspace_engine_forbidden'||code==='workspace_engine_incremental_parent_invalid'?code:'workspace_engine_inputs_stale']);
      await completeDispatch(client,run.id);
      return null;
    }
    const token=randomUUID();await client.query(`UPDATE signal_topic_catalog_executions SET status='running',execution_token=$2::uuid,
      execution_expires_at=clock_timestamp()+interval '180 seconds',heartbeat_at=clock_timestamp(),started_at=COALESCE(started_at,clock_timestamp()),
      result_summary=result_summary||jsonb_build_object('phase',CASE WHEN result_summary ? 'fit_checkpoint' THEN CASE WHEN COALESCE((result_summary->>'interpreted_units')::bigint,0)= (result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::bigint THEN 'materializing' ELSE 'interpreting' END ELSE 'exporting' END,'worker_job_id',$3::text),updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,token,args.worker_job_id]);
    await client.query(`UPDATE signal_topic_classification_outbox SET status='dispatched',completed_at=NULL,
      lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE dispatch_kind='execution' AND execution_id=$1::uuid`,[run.id]);
    return leaseView(run,token);
  });
}
export async function readSignalWorkspaceEngineChunksV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  after:SignalWorkspaceEngineCursorV1|null;limit?:number}):Promise<SignalWorkspaceEngineChunkPageV1>{
  const limit=limitOf(args.limit);if(args.after&&(!Number.isSafeInteger(args.after.chunk_index)||args.after.chunk_index<0))return fail('workspace_engine_cursor_invalid',422);
  return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);const snapshot=run.input_snapshot;
    const rows=(await client.query<Omit<SignalWorkspaceEngineChunkV1,'vector'>&{vector:string|null}>(`WITH roots AS MATERIALIZED (
      SELECT item.root_id,item.fingerprint,item.asset_sha256,item.chunk_policy_version FROM signal_corpus_preparation_items item
      WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.disposition='eligible'
       AND ($3::uuid IS NULL OR item.root_id>=$3::uuid) ORDER BY item.root_id
       -- The inclusive cursor root may have no remaining chunks. Preserve one
       -- extra root so a page of single-chunk mentions still has an EOF sentinel.
       LIMIT ($5::int + CASE WHEN $3::uuid IS NULL THEN 0 ELSE 1 END)
     ), chunk_page AS MATERIALIZED (
      SELECT root.*, (chunk.ordinality-1)::int chunk_index,(chunk.value->>'start')::int start,(chunk.value->>'end')::int "end",
       chunk.value->>'sha256' chunk_sha256,jsonb_array_length(asset.chunks->'chunks') expected_root_chunks
      FROM roots root JOIN signal_corpus_text_assets asset ON asset.workspace_id=$2::uuid AND asset.text_sha256=root.asset_sha256
       AND asset.chunk_policy_version=root.chunk_policy_version
      CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') WITH ORDINALITY chunk
      WHERE ($3::uuid IS NULL OR root.root_id>$3::uuid OR chunk.ordinality-1>$4::int)
      ORDER BY root.root_id,chunk.ordinality LIMIT $5
     ) SELECT page.root_id,page.fingerprint root_fingerprint,page.asset_sha256,page.expected_root_chunks,
       page.chunk_index,page.start,page."end",page.chunk_sha256,
       signal_topic_utf16_fragment_v1(asset.full_text,page.start,page."end") text,cache.embedding::text vector
      FROM chunk_page page JOIN signal_corpus_text_assets asset ON asset.workspace_id=$2::uuid
       AND asset.text_sha256=page.asset_sha256 AND asset.chunk_policy_version=page.chunk_policy_version
      LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$2::uuid AND cache.config_digest=$6 AND cache.chunk_sha256=page.chunk_sha256
      ORDER BY page.root_id,page.chunk_index`,[snapshot.preparation_run_id,run.workspace_id,args.after?.root_id??null,args.after?.chunk_index??-1,limit+1,snapshot.embedding_profile.config_digest])).rows;
    const items=rows.slice(0,limit).map(row=>{if(sha(row.text)!==row.chunk_sha256)return fail('workspace_engine_fragment_invalid');
      return {...row,vector:vectorOf(row.vector)};});const last=items.at(-1);
    return{items,next_cursor:last?{root_id:last.root_id,chunk_index:last.chunk_index}:args.after,done:rows.length<=limit};
  });
}
function vectorOf(raw:string|null):number[]{if(raw===null)return fail('workspace_engine_cache_missing');const vector=JSON.parse(raw) as number[];
  if(!Array.isArray(vector)||vector.length!==1024||vector.some(n=>typeof n!=='number'||!Number.isFinite(n)))return fail('workspace_engine_vector_invalid');return vector;}
export async function readSignalWorkspaceEngineGuidesV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  after:SignalWorkspaceEngineGuideCursorV1|null;limit?:number}):Promise<SignalWorkspaceEngineGuidePageV1>{
  const limit=limitOf(args.limit);return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);
    const rows=(await client.query<Omit<SignalWorkspaceEngineGuideV1,'vector'>&{vector:string|null}>(`SELECT guide.*,cache.embedding::text vector
      FROM signal_topic_catalog_executions execution CROSS JOIN LATERAL jsonb_to_recordset(execution.input_snapshot->'guides')
       guide(guide_key text,role text,input_digest text,text_sha256 text)
      LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=execution.workspace_id
       AND cache.config_digest=execution.embedding_config_digest AND cache.chunk_sha256=guide.text_sha256
      WHERE execution.id=$1::uuid AND ($2::text IS NULL OR (guide.guide_key COLLATE "C",guide.input_digest COLLATE "C")>($2 COLLATE "C",$3 COLLATE "C"))
      ORDER BY guide.guide_key COLLATE "C",guide.input_digest COLLATE "C" LIMIT $4`,[run.id,args.after?.guide_key??null,args.after?.input_digest??null,limit+1])).rows;
    const items=rows.slice(0,limit).map(row=>({...row,vector:vectorOf(row.vector)}));const last=items.at(-1);
    return{items,next_cursor:last?{guide_key:last.guide_key,input_digest:last.input_digest}:args.after,done:rows.length<=limit};
  });
}
export async function heartbeatSignalWorkspaceEngineV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  phase?:'exporting'|'fitting'|'persisting'|'interpreting'|'materializing';exported?:{roots:number;chunks:number;guides:number;stream_digest:string}}):Promise<void>{
  return transaction(args.database,async client=>{const run=await requireLease(client,args.lease);
    if(args.exported&&(args.exported.roots!==run.input_snapshot.expected_roots||args.exported.chunks!==run.input_snapshot.expected_chunks
      ||args.exported.guides!==run.input_snapshot.expected_guides||!digestPattern.test(args.exported.stream_digest)))return fail('workspace_engine_export_incomplete');
    await client.query(`UPDATE signal_topic_catalog_executions SET execution_expires_at=clock_timestamp()+interval '180 seconds',
      heartbeat_at=clock_timestamp(),updated_at=clock_timestamp(),result_summary=result_summary||$2::jsonb,
      processed_roots=CASE WHEN $3::boolean THEN denominator ELSE processed_roots END,
      processed_chunks=CASE WHEN $3::boolean THEN expected_chunks ELSE processed_chunks END,
      progress=CASE WHEN $3::boolean THEN 30 ELSE progress END WHERE id=$1::uuid`,[run.id,JSON.stringify({...(args.phase?{phase:args.phase}:{}),...(args.exported?{export_receipt:args.exported}:{})}),Boolean(args.exported)]);
  });
}
export async function persistSignalWorkspaceEngineArtifactV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  artifact:SignalWorkspaceEngineArtifactV1}):Promise<{artifact_id:string;replayed:boolean}>{
  return transaction(args.database,async client=>persistSignalWorkspaceEngineArtifactWithClientV1(client,await requireLease(client,args.lease,true),args.artifact));
}
export async function persistSignalWorkspaceEngineArtifactWithClientV1(client:PoolClient,run:Pick<Run,'id'|'workspace_id'|'input_digest'>,a:SignalWorkspaceEngineArtifactV1):Promise<{artifact_id:string;replayed:boolean}>{
  const prefix=`workspace-engine/${run.workspace_id}/${run.id}/`;
  if(!/^[A-Za-z0-9._:-]{1,120}$/u.test(a.artifact_key)||!a.storage_key.startsWith(prefix)||!a.storage_key.slice(prefix.length)
    ||a.storage_key.includes('..')||!digestPattern.test(a.sha256)||!Number.isSafeInteger(a.size_bytes)||a.size_bytes<0
    ||Buffer.byteLength(JSON.stringify(a.metadata),'utf8')>32768||a.title.length>240||a.media_type.length>120)return fail('workspace_engine_artifact_invalid',422);
    const content={contract_version:'workspace-engine-private-artifact-v1',storage_key:a.storage_key,sha256:a.sha256,size_bytes:a.size_bytes,media_type:a.media_type};
    const existing=(await client.query<{id:string;content:unknown;metadata:unknown;artifact_type:string}>(
      "SELECT id,content,metadata,artifact_type FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND artifact_key=$2",[run.id,a.artifact_key])).rows[0];
    if(existing){if(signalWorkspaceEmbeddingDigestV1(existing.content)!==signalWorkspaceEmbeddingDigestV1(content)
      ||signalWorkspaceEmbeddingDigestV1(existing.metadata)!==signalWorkspaceEmbeddingDigestV1(a.metadata)||existing.artifact_type!==a.artifact_type)return fail('workspace_engine_artifact_conflict');
      return{artifact_id:existing.id,replayed:true};}
    const row=(await client.query<{id:string}>(`INSERT INTO analysis_artifacts(workspace_id,workspace_artifact_kind,discovery_run_digest,workspace_authority_digest,
      artifact_key,artifact_type,title,content,metadata,review_status,engine_execution_id)
      VALUES($1::uuid,'topic_discovery',$2,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'draft',$8::uuid) RETURNING id`,
      [run.workspace_id,sha(`${run.input_digest}:${run.id}`),a.artifact_key,a.artifact_type,a.title,JSON.stringify(content),JSON.stringify(a.metadata),run.id])).rows[0]!;
    return{artifact_id:row.id,replayed:false};
}
export type SignalWorkspaceEngineFitArgsV1 = {database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  model_artifact_id:string|null;output_artifact_id:string;result_kind:"computational_grouping"|"insufficient_population";coverage:{roots:number;chunks:number;guides:number};
  model_configuration:Record<string,unknown>;runtime_kind:string;artifact_format:string;license_key:string|null};
export async function finishSignalWorkspaceEngineFitV1(args:SignalWorkspaceEngineFitArgsV1):Promise<{execution_id:string;model_version_id:string|null}>{
  return transaction(args.database,async client=>{
    const run=await requireLease(client,args.lease,true);
    if(run.input_snapshot.interpretation_config)return fail('workspace_engine_analysis_incomplete');
    const fitted=await recordFit(client,run,args);
    await client.query(`UPDATE signal_topic_catalog_executions SET status='ready',progress=100,result_summary=$2::jsonb,
      execution_token=NULL,execution_expires_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,
      [run.id,JSON.stringify({...run.result_summary,...fitted,phase:'complete',semantic_approval:'none'})]);
    await completeDispatch(client,run.id);return{execution_id:run.id,model_version_id:fitted.model_version_id};
  });
}
async function recordFit(client:PoolClient,run:Run,args:SignalWorkspaceEngineFitArgsV1){
    if(args.coverage.roots!==run.input_snapshot.expected_roots||args.coverage.chunks!==run.input_snapshot.expected_chunks
      ||args.coverage.guides!==run.input_snapshot.expected_guides||run.processed_roots!==args.coverage.roots||natural(run.processed_chunks)!==args.coverage.chunks
      ||!run.result_summary.export_receipt)return fail('workspace_engine_coverage_incomplete');
    const artifacts=(await client.query<{id:string;artifact_type:string;content:{sha256:string};metadata:Record<string,unknown>}>(
      "SELECT id,artifact_type,content,metadata FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND id=ANY($2::uuid[])",[run.id,[args.model_artifact_id,args.output_artifact_id]])).rows;
    const model=artifacts.find(a=>a.id===args.model_artifact_id&&a.artifact_type==='engine_model');
    const output=artifacts.find(a=>a.id===args.output_artifact_id&&a.artifact_type==='engine_output');
    if(!output || (args.result_kind==='computational_grouping'&&!model)
      ||(args.result_kind==='insufficient_population'&&args.model_artifact_id!==null))return fail('workspace_engine_artifacts_incomplete');
    let model_version_id:string|null=null;
    if(model){
    const configuration={...args.model_configuration,contract_version:'workspace-topic-engine-v1',execution_id:run.id,
      input_digest:run.input_digest,model_artifact_id:model.id,output_artifact_id:output.id,approval_policy:'none'};
    if(Buffer.byteLength(JSON.stringify(configuration),'utf8')>60000)return fail('workspace_engine_model_configuration_invalid',422);
    const request=signalWorkspaceEmbeddingDigestV1({configuration,artifact:model.content.sha256});
    const registered=(await client.query<{model_version_id:string}>(`SELECT model_version_id FROM register_signal_tagging_model_v1(
      $1::uuid,$2::uuid,$3,$4,'workspace-python',NULL,$5,$6,$7,$8::jsonb,$9,$10,NULL,$11,$12,NULL,$13::uuid,$14,$14)`,
      [run.workspace_id,run.input_snapshot.taxonomy_profile_id,`workspace-engine:${run.workspace_id}`,run.id,model.content.sha256,
        args.runtime_kind,args.artifact_format,JSON.stringify(configuration),signalWorkspaceEmbeddingDigestV1(configuration),run.input_digest,
        args.license_key,signalWorkspaceEmbeddingDigestV1({model:model.content.sha256,output:output.content.sha256,input:run.input_digest}),run.actor_user_id,request])).rows[0]!;
      model_version_id=registered.model_version_id;
    }
    return{model_version_id,model_artifact_id:args.model_artifact_id,output_artifact_id:output.id,
      coverage:args.coverage,result_kind:args.result_kind};
}
export async function checkpointSignalWorkspaceEngineFitV1(args:SignalWorkspaceEngineFitArgsV1&{
  interpretation_manifest:SignalWorkspaceEngineUnitManifestV1}):Promise<SignalWorkspaceEngineFitCheckpointV1>{
  const manifest=args.interpretation_manifest;
  if(!Number.isSafeInteger(manifest.unit_count)||manifest.unit_count<0||!digestPattern.test(manifest.unit_digest)
    ||manifest.unit_count===0&&manifest.unit_digest!==sha(''))return fail('workspace_engine_interpretation_manifest_invalid',422);
  const {database:_database,lease:_lease,...request}=args,checkpoint_digest=signalWorkspaceEmbeddingDigestV1(request);
  return transaction(args.database,async client=>{const run=await requireLease(client,args.lease,true);
    if(!run.input_snapshot.interpretation_config)return fail('workspace_engine_interpretation_not_requested');
    const prior=run.result_summary.fit_checkpoint as SignalWorkspaceEngineFitCheckpointV1|undefined;
    if(prior){if(prior.checkpoint_digest!==checkpoint_digest)return fail('workspace_engine_fit_checkpoint_conflict');return prior;}
    const fitted=await recordFit(client,run,args);
    const checkpoint={checkpoint_digest,model_version_id:fitted.model_version_id,model_artifact_id:fitted.model_artifact_id,
      output_artifact_id:fitted.output_artifact_id,result_kind:fitted.result_kind,interpretation_manifest:manifest};
    await client.query(`UPDATE signal_topic_catalog_executions SET result_summary=$2::jsonb,progress=55,updated_at=clock_timestamp() WHERE id=$1::uuid`,
      [run.id,JSON.stringify({...run.result_summary,...fitted,fit_checkpoint:checkpoint,phase:manifest.unit_count?'interpreting':'materializing',
        interpreted_units:0,materialized_topics:0,semantic_approval:'none'})]);
    return checkpoint;
  });
}
export async function readSignalWorkspaceEngineFitCheckpointV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1}):Promise<SignalWorkspaceEngineFitCheckpointV1|null>{
  return transaction(args.database,async client=>(await requireLease(client,args.lease,true)).result_summary.fit_checkpoint as SignalWorkspaceEngineFitCheckpointV1??null);
}
async function interpretationCoverage(client:PoolClient,run:Run):Promise<SignalWorkspaceEngineUnitManifestV1>{
  const row=(await client.query<{unit_count:string;unique_count:string;unit_digest:string}>(`SELECT count(*)::text unit_count,count(DISTINCT unit.key)::text unique_count,
    'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(unit.key)::text||E'\\n','' ORDER BY unit.key COLLATE "C"),''),'UTF8')),'hex') unit_digest
    FROM analysis_artifacts artifact CROSS JOIN LATERAL jsonb_array_elements_text(artifact.metadata->'unit_keys') unit(key)
    WHERE artifact.workspace_id=$1::uuid AND artifact.engine_execution_id=$2::uuid AND artifact.artifact_type='engine_proposals'
      AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'`,[run.workspace_id,run.id])).rows[0]!;
  if(row.unit_count!==row.unique_count)return fail('workspace_engine_interpretation_duplicate_unit');
  return{unit_count:natural(row.unit_count),unit_digest:row.unit_digest};
}
export async function checkpointSignalWorkspaceEngineInterpretationV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  call_id:string;artifact:SignalWorkspaceEngineArtifactV1;unit_keys:string[]}):Promise<{artifact_id:string;replayed:boolean;interpreted_units:number}>{
  if(args.artifact.artifact_type!=='engine_proposals'||!args.unit_keys.length||args.unit_keys.length>128
    ||args.unit_keys.some(key=>!/^[A-Za-z0-9:._-]{1,200}$/u.test(key))||new Set(args.unit_keys).size!==args.unit_keys.length)
    return fail('workspace_engine_interpretation_units_invalid',422);
  return transaction(args.database,async client=>{const run=await requireLease(client,args.lease,true),config=run.input_snapshot.interpretation_config;
    const fit=run.result_summary.fit_checkpoint as SignalWorkspaceEngineFitCheckpointV1|undefined;
    if(!fit||!config)return fail('workspace_engine_fit_checkpoint_required');
    const call=(await client.query<{response_sha256:string;call_configuration:unknown;call_state:string;authorized_configuration:unknown}>(`SELECT response_sha256,call_configuration,call_state,workspace_engine_interpretation_configuration_v1(catalog_execution_id,metadata->>'interpretation_revision_digest') authorized_configuration
      FROM engine_cost_events WHERE id=$1::uuid AND workspace_id=$2::uuid AND catalog_execution_id=$3::uuid
       AND workspace_contract='workspace-engine-interpretation-v1'`,[args.call_id,run.workspace_id,run.id])).rows[0];
    if(!call||call.call_state!=='settled'||!call.response_sha256
      ||signalWorkspaceEmbeddingDigestV1(call.call_configuration)!==signalWorkspaceEmbeddingDigestV1(call.authorized_configuration))return fail('workspace_engine_interpretation_receipt_required');
    const artifact={...args.artifact,metadata:{...args.artifact.metadata,contract_version:'workspace-engine-interpretation-checkpoint-v1',
      execution_id:run.id,fit_checkpoint_digest:fit.checkpoint_digest,call_id:args.call_id,response_sha256:call.response_sha256,unit_keys:[...args.unit_keys].sort()}};
    const saved=await persistSignalWorkspaceEngineArtifactWithClientV1(client,run,artifact),coverage=await interpretationCoverage(client,run),expected=fit.interpretation_manifest;
    if(coverage.unit_count>expected.unit_count||coverage.unit_count===expected.unit_count&&coverage.unit_digest!==expected.unit_digest)
      return fail('workspace_engine_interpretation_coverage_invalid');
    await client.query(`UPDATE signal_topic_catalog_executions SET result_summary=result_summary||$2::jsonb,progress=$3,updated_at=clock_timestamp() WHERE id=$1::uuid`,
      [run.id,JSON.stringify({interpreted_units:coverage.unit_count,phase:coverage.unit_count===expected.unit_count?'materializing':'interpreting'}),
        expected.unit_count?55+Math.floor(30*coverage.unit_count/expected.unit_count):85]);
    return{...saved,interpreted_units:coverage.unit_count};
  });
}
export async function completeSignalWorkspaceEngineAnalysisV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  materialization_artifact_id:string}):Promise<{execution_id:string;model_version_id:string|null;output_catalog_profile_id:string;topic_count:number}>{
  return transaction(args.database,async client=>{
    // Match catalog/projection lock order before requireLease locks input state.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`signal-taxonomy:${args.lease.workspace_id}:topic`]);
    const run=await requireLease(client,args.lease,true);
    const fit=run.result_summary.fit_checkpoint as SignalWorkspaceEngineFitCheckpointV1|undefined;
    if(!run.input_snapshot.interpretation_config||!fit)return fail('workspace_engine_fit_checkpoint_required');
    const coverage=await interpretationCoverage(client,run);
    if(coverage.unit_count!==fit.interpretation_manifest.unit_count||coverage.unit_digest!==fit.interpretation_manifest.unit_digest)return fail('workspace_engine_analysis_incomplete');
    const pending=(await client.query(`SELECT id FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND workspace_id=$2::uuid
      AND workspace_contract='workspace-engine-interpretation-v1' AND call_state IN('reserved','in_flight','response_persisted','outcome_unknown') LIMIT 1`,[run.id,run.workspace_id])).rows[0];
    if(pending)return fail('workspace_engine_interpretation_receipt_unresolved');
    const materialization=(await client.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM analysis_artifacts WHERE id=$1::uuid
      AND workspace_id=$2::uuid AND engine_execution_id=$3::uuid AND artifact_type='engine_proposals' AND artifact_key='materialization.json'`,
      [args.materialization_artifact_id,run.workspace_id,run.id])).rows[0]?.metadata;
    if(!materialization||materialization.contract_version!=='workspace-topic-materialization-v1'||materialization.execution_id!==run.id
      ||materialization.interpretation_units_digest!==coverage.unit_digest||!digestPattern.test(String(materialization.mapping_digest)))return fail('workspace_engine_materialization_required');
    const profile=(await client.query<{version:number;topic_count:string;metadata:Record<string,unknown>}>(`SELECT profile.version,profile.metadata,
      (SELECT count(*)::text FROM taxonomy_terms term WHERE term.taxonomy_id=profile.taxonomy_id AND term.metadata->'topic'->>'lifecycle'<>'archived') topic_count
      FROM signal_taxonomy_profiles profile WHERE profile.id=$1::uuid AND profile.workspace_id=$2::uuid AND profile.kind='topic'
        AND profile.status IN('draft','activating','active')`,[materialization.output_catalog_profile_id,run.workspace_id])).rows[0];
    if(!profile||profile.version!==materialization.output_catalog_revision||natural(profile.topic_count)!==materialization.topic_count
      ||profile.metadata.source_engine_execution_id!==run.id||profile.metadata.source_interpretation_units_digest!==coverage.unit_digest
      ||profile.metadata.source_mapping_digest!==materialization.mapping_digest)return fail('workspace_engine_materialization_invalid');
    const result={...run.result_summary,phase:'complete',interpreted_units:coverage.unit_count,materialized_topics:natural(profile.topic_count),
      analysis_checkpoint:{materialization_artifact_id:args.materialization_artifact_id,output_catalog_profile_id:materialization.output_catalog_profile_id,
        output_catalog_revision:profile.version,interpretation_units_digest:coverage.unit_digest,mapping_digest:materialization.mapping_digest},semantic_approval:'none'};
    await client.query(`UPDATE signal_topic_catalog_executions SET status='ready',progress=100,result_summary=$2::jsonb,execution_token=NULL,
      execution_expires_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,JSON.stringify(result)]);
    await completeDispatch(client,run.id);
    // Persist the next computational step with the completed analysis. If this
    // transaction is retried or its ACK is lost, the same durable outbox survives;
    // a completed engine job never depends on an ephemeral post-commit enqueue.
    await requestSignalWorkspaceTopicProjectionWithClientV1(client, { workspace_id: run.workspace_id,
      actor_user_id: run.actor_user_id, engine_execution_id: run.id,
      idempotency_key: `workspace-projection:${run.id}` });
    return{execution_id:run.id,model_version_id:fit.model_version_id,output_catalog_profile_id:String(materialization.output_catalog_profile_id),topic_count:natural(profile.topic_count)};
  });
}
export async function failSignalWorkspaceEngineV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;error_code:string}):Promise<void>{
  const code=/^workspace_engine_[a-z_]{1,90}$/u.test(args.error_code)?args.error_code:'workspace_engine_worker_failed';
  return transaction(args.database,async client=>{const run=await lockedRun(client,args.lease.execution_id);
    if(run.workspace_id!==args.lease.workspace_id||run.input_digest!==args.lease.input_digest||run.execution_token!==args.lease.execution_token||run.status!=='running')return;
    await client.query(`UPDATE signal_topic_catalog_executions SET status='failed',error_code=$2,result_summary=result_summary||'{"phase":"failed"}'::jsonb,
      execution_token=NULL,execution_expires_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,code]);
    await completeDispatch(client,run.id);
  });
}
export async function retrySignalWorkspaceEngineV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string;idempotency_key:string;numeric_only?:true}):Promise<{execution_id:string;replayed:boolean}>{
  if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))return fail('workspace_engine_request_invalid',422);
  const executionId=args.numeric_only?args.execution_id.toLowerCase():args.execution_id;
  return transaction(args.database,async client=>{await authorize(client,args.workspace_id,args.actor_user_id);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-taxonomy:${args.workspace_id}:topic`]);
    const retryDigest=signalWorkspaceEmbeddingDigestV1({action:args.numeric_only?'retry_numeric':'retry',execution_id:executionId});
    const prior=(await client.query<{id:string;alias:{actor_user_id:string;request_digest:string}|null}>("SELECT id,engine_request_keys->$2 alias FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND (idempotency_key=$2 OR engine_request_keys ? $2)",[args.workspace_id,args.idempotency_key])).rows[0];
    if(prior&&(prior.id!==executionId||prior.alias?.actor_user_id!==args.actor_user_id||prior.alias?.request_digest!==retryDigest))return fail('workspace_engine_idempotency_conflict');
    const run=await lockedRun(client,executionId);
    if(run.workspace_id!==args.workspace_id||run.actor_user_id!==args.actor_user_id)return fail('workspace_engine_forbidden',403);
    if(Boolean(run.input_snapshot.numeric_descriptor)!==Boolean(args.numeric_only))return fail('workspace_engine_incremental_retry_unavailable');
    // A retry key records one accepted dispatch, even if that attempt later
    // fails or its inputs become stale. Replaying it cannot enqueue again.
    if(args.numeric_only&&prior)return{execution_id:run.id,replayed:true};
    await current(client,run,true);
    const numericRecovery=args.numeric_only?await readSignalWorkspaceNumericRecoveryWithQueryableV1({queryable:client,
      workspace_id:run.workspace_id,actor_user_id:args.actor_user_id,execution_id:run.id}):null;
    if(args.numeric_only&&(!numericRecovery?.valid||run.status==='failed'&&!numericRecovery.retry_available))return fail('workspace_engine_incremental_retry_unavailable');
    const alias={actor_user_id:args.actor_user_id,request_digest:args.numeric_only?retryDigest:signalWorkspaceEmbeddingDigestV1({action:'retry',execution_id:run.id})};
    if(!prior)await client.query("UPDATE signal_topic_catalog_executions SET engine_request_keys=engine_request_keys||jsonb_build_object($2::text,$3::jsonb) WHERE id=$1::uuid",[run.id,args.idempotency_key,JSON.stringify(alias)]);
    if(run.status==='ready'||run.status==='queued'||run.status==='running')return{execution_id:run.id,replayed:true};
    const storageRecovery=run.error_code==='workspace_engine_storage_verification_failed'
      && (await client.query<{eligible:boolean}>(`SELECT (${storageRecoveryPredicate}) eligible
        FROM signal_topic_catalog_executions execution WHERE execution.id=$1::uuid`,[run.id])).rows[0]?.eligible===true;
    const evidenceRecovery=run.error_code==='workspace_engine_interpretation_cluster_invalid'
      && (await client.query<{eligible:boolean}>(`SELECT (${interpretationEvidenceRecoveryPredicate}) eligible
        FROM signal_topic_catalog_executions execution WHERE execution.id=$1::uuid`,[run.id])).rows[0]?.eligible===true;
    const editorialRecovery=run.error_code==='workspace_engine_interpretation_output_invalid'
      && (await client.query<{eligible:boolean}>(`SELECT (${editorialRepairRecoveryPredicate}) eligible
        FROM signal_topic_catalog_executions execution WHERE execution.id=$1::uuid`,[run.id])).rows[0]?.eligible===true;
    const transportRecovery=run.error_code==='workspace_engine_interpretation_transport_terminal_confirmed'
      && (await client.query<{eligible:boolean}>(`SELECT (${transportRecoveryPredicate}) eligible
        FROM signal_topic_catalog_executions execution WHERE execution.id=$1::uuid`,[run.id])).rows[0]?.eligible===true;
    if(run.status!=='failed'||!(args.numeric_only?numericRecovery?.retry_available:isSignalWorkspaceEngineRetryableErrorV1(run.error_code,{storage_recovery_eligible:storageRecovery,
      interpretation_evidence_recovery_eligible:evidenceRecovery,editorial_repair_recovery_eligible:editorialRecovery,transport_recovery_eligible:transportRecovery})))return fail('workspace_engine_retry_unavailable');
    const generation=(await client.query<{dispatch_generation:number}>(`UPDATE signal_topic_catalog_executions SET status='queued',error_code=NULL,completed_at=NULL,
      execution_token=NULL,execution_expires_at=NULL,dispatch_generation=dispatch_generation+1,
      result_summary=result_summary||'{"phase":"queued"}'::jsonb||$2::jsonb,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING dispatch_generation`,
      [run.id,JSON.stringify(evidenceRecovery||editorialRecovery||transportRecovery?{interpretation_evidence_checkpoint_required:true}:{})])).rows[0]!.dispatch_generation;
    await client.query(`UPDATE signal_topic_classification_outbox SET status='pending',worker_job_id=$2,attempt_count=0,available_at=clock_timestamp(),
      completed_at=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE dispatch_kind='execution' AND execution_id=$1::uuid`,
      [run.id,`workspace-engine-${run.id}-${generation}`]);
    return{execution_id:run.id,replayed:false};
  });
}
export async function loadSignalWorkspaceEngineStatusV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;
  idempotency_key?:string}):Promise<SignalWorkspaceEngineStatusV1 & {request_run:SignalWorkspaceEngineStatusV1['latest_run']}>{
  return transaction(args.database,async client=>{
    const observed=(await client.query<{observed_at:string}>(`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at`)).rows[0]!.observed_at;
    await authorize(client,args.workspace_id,args.actor_user_id,false);
    const callerCanExecute=(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id})).can_execute_topics;
    const rows=(await client.query<{id:string;status:'queued'|'running'|'ready'|'failed';progress:number;denominator:number;expected_chunks:string;
      processed_roots:number;processed_chunks:string;error_code:string|null;result_summary:Record<string,unknown>;input_snapshot:Run['input_snapshot'];progress_dispatch:{status:string;worker_job_id:string;attempt_count:number;error_code:string|null}|null;progress_coverage:SignalWorkspaceEngineUnitManifestV1;latest_catalog_profile_id:string|null;latest_materialization_progress:import('./signal-workspace-engine-progress').SignalWorkspaceEngineProgressCheckpointV1|null;
      progress_owner:boolean;revision_live:boolean;policy_live:boolean;artifact_count:string;is_latest:boolean;is_request:boolean;actor_user_id:string;storage_recovery_eligible:boolean;interpretation_evidence_recovery_eligible:boolean;editorial_repair_recovery_eligible:boolean;transport_recovery_eligible:boolean}>(`
      WITH selected AS MATERIALIZED (
       (SELECT id,true is_latest,false is_request FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-engine-v1' AND NOT input_snapshot ? 'numeric_descriptor' ORDER BY created_at DESC,id DESC LIMIT 1)
       UNION ALL (SELECT id,false,true FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-engine-v1' AND NOT input_snapshot ? 'numeric_descriptor'
        AND (idempotency_key=$3 OR engine_request_keys ? $3) AND actor_user_id=$2::uuid)
       UNION ALL (SELECT id,false,false FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-engine-v1' AND NOT input_snapshot ? 'numeric_descriptor'
        AND status='ready' ORDER BY completed_at DESC,id DESC LIMIT 1)
      ) SELECT execution.id,execution.status,execution.progress,execution.denominator,execution.expected_chunks::text,
        execution.processed_roots,execution.processed_chunks::text,execution.error_code,execution.result_summary,execution.input_snapshot-'guides' input_snapshot,execution.actor_user_id,
        execution.input_revision=state.input_revision revision_live,(execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp()) policy_live,
        (SELECT count(*)::text FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id) artifact_count,
        (SELECT jsonb_build_object('status',dispatch.status,'worker_job_id',dispatch.worker_job_id,'attempt_count',dispatch.attempt_count,'error_code',dispatch.error_code)
          FROM signal_topic_classification_outbox dispatch WHERE dispatch.execution_id=execution.id AND dispatch.dispatch_kind='engine_progress') progress_dispatch,
        (SELECT jsonb_build_object('unit_count',coverage.unit_count,'unit_digest',coverage.unit_digest)
          FROM signal_workspace_engine_interpretation_coverage_v1(execution.id) coverage) progress_coverage,
        (SELECT profile.id FROM signal_taxonomy_profiles profile WHERE profile.workspace_id=execution.workspace_id AND profile.kind='topic'
         AND profile.status IN('draft','activating','active') AND profile.metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY profile.version DESC LIMIT 1) latest_catalog_profile_id,
        (SELECT jsonb_build_object('artifact_id',artifact.id,'output_catalog_profile_id',artifact.metadata->>'output_catalog_profile_id',
          'mapping_digest',artifact.metadata->>'mapping_digest','interpreted_unit_count',(artifact.metadata->>'interpreted_unit_count')::bigint,
          'expected_interpretation_unit_count',(artifact.metadata->>'expected_interpretation_unit_count')::bigint,
          'interpretation_complete',(artifact.metadata->>'interpretation_complete')::boolean,'topic_count',(artifact.metadata->>'topic_count')::int,
          'discovered_topic_count',(artifact.metadata->>'discovered_topic_count')::int,'projection_execution_id',projection.id,'generation_id',projection.generation_id)
         FROM analysis_artifacts artifact JOIN signal_topic_catalog_executions projection ON projection.workspace_id=artifact.workspace_id
          AND projection.input_snapshot->'source_projection'->>'materialization_artifact_id'=artifact.id::text
         WHERE artifact.engine_execution_id=execution.id AND artifact.metadata->>'contract_version'='workspace-topic-materialization-progress-v1'
         ORDER BY (artifact.metadata->>'output_catalog_revision')::int DESC,artifact.id DESC LIMIT 1) latest_materialization_progress,
        (${signalWorkspaceEngineProgressOwnerPredicateV1}) progress_owner,
        (${storageRecoveryPredicate}) storage_recovery_eligible,
        (${interpretationEvidenceRecoveryPredicate}) interpretation_evidence_recovery_eligible,
        (${editorialRepairRecoveryPredicate}) editorial_repair_recovery_eligible,
        (${transportRecoveryPredicate}) transport_recovery_eligible,selected.is_latest,selected.is_request
        FROM selected JOIN signal_topic_catalog_executions execution USING(id) JOIN signal_corpus_preparation_input_state state USING(workspace_id)`,
      [args.workspace_id,args.actor_user_id,args.idempotency_key??null])).rows;
    let inputIdentity:{context_digest:string;catalog_digest:string}|null=null;
    if(rows.length){try{inputIdentity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id});}
      catch(error){if(!(error instanceof Error)||!['workspace_topic_catalog_required','workspace_topic_catalog_empty'].includes(error.message))throw error;}}
    const view=async(row:typeof rows[number]):Promise<NonNullable<SignalWorkspaceEngineStatusV1['latest_run']>>=>{
      const actorCanExecute=(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:row.actor_user_id})).can_execute_topics;
      const isCurrent=row.revision_live&&row.policy_live&&inputIdentity?.context_digest===row.input_snapshot.context_digest&&inputIdentity?.catalog_digest===row.input_snapshot.catalog_digest&&actorCanExecute;
      const progressCheckpoint=row.latest_materialization_progress;
      const fullProfile=(row.result_summary.analysis_checkpoint as {output_catalog_profile_id?:string}|undefined)?.output_catalog_profile_id;
      const confirmedProfile=fullProfile===row.latest_catalog_profile_id || progressCheckpoint?.output_catalog_profile_id===row.latest_catalog_profile_id
        &&progressCheckpoint.interpreted_unit_count===row.progress_coverage.unit_count;
      const needsProgress=row.progress_owner&&isCurrent&&!!row.result_summary.fit_checkpoint&&row.progress_coverage.unit_count>0&&['running','failed','ready'].includes(row.status)&&!confirmedProfile;
      const dispatch=row.progress_dispatch,currentDispatch=dispatch?.worker_job_id===`workspace-progress-${row.id}-${row.latest_catalog_profile_id}-${row.progress_coverage.unit_digest.slice(7)}`;
      const exhausted=currentDispatch&&!!dispatch&&dispatch.attempt_count>=8&&['failed','dead_letter','pending','dispatching'].includes(dispatch.status);
      const materializationError=needsProgress&&currentDispatch&&dispatch&&['failed','dead_letter'].includes(dispatch.status)
        ? (exhausted?'workspace_engine_progress_dispatch_exhausted':dispatch.error_code??'workspace_engine_progress_failed') : null;
      return{execution_id:row.id,status:row.status,phase:row.result_summary.phase as NonNullable<SignalWorkspaceEngineStatusV1['latest_run']>['phase'],
        progress:row.progress,expected_roots:natural(row.denominator),expected_chunks:natural(row.expected_chunks),expected_guides:row.input_snapshot.expected_guides,
        processed_roots:natural(row.processed_roots),processed_chunks:natural(row.processed_chunks),error_code:row.error_code,
        is_current:isCurrent,
        model_version_id:typeof row.result_summary.model_version_id==='string'?row.result_summary.model_version_id:null,artifact_count:natural(row.artifact_count),
        storage_recovery_eligible:row.storage_recovery_eligible,
        interpretation_evidence_recovery_eligible:row.interpretation_evidence_recovery_eligible,
        editorial_repair_recovery_eligible:row.editorial_repair_recovery_eligible,
        transport_recovery_eligible:row.transport_recovery_eligible,
        materialization_progress:progressCheckpoint,
        materialization_pending:needsProgress&&!exhausted,
        materialization_error_code:materializationError,
        materialization_retry_available:Boolean(needsProgress&&exhausted&&currentDispatch&&dispatch&&['failed','dead_letter'].includes(dispatch.status)&&callerCanExecute&&row.actor_user_id===args.actor_user_id),
        fit_completed:!!row.result_summary.fit_checkpoint,
        expected_interpretation_units:natural((row.result_summary.fit_checkpoint as SignalWorkspaceEngineFitCheckpointV1|undefined)?.interpretation_manifest.unit_count??0),
        interpreted_units:natural(row.result_summary.interpreted_units??0),materialized_topics:natural(progressCheckpoint?.output_catalog_profile_id===row.latest_catalog_profile_id?progressCheckpoint.topic_count:row.result_summary.materialized_topics??0),
        claude_cap_micro_usd:natural(row.input_snapshot.claude_cap_micro_usd),result_kind:(row.result_summary.result_kind??null) as 'computational_grouping'|'insufficient_population'|null};
    };
    const latest=rows.find(row=>row.is_latest),request=rows.find(row=>row.is_request);
    const completed=(await client.query<{id:string}>(`SELECT id FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid
      AND input_contract='workspace-topic-engine-v1' AND NOT input_snapshot ? 'numeric_descriptor'
      AND status='ready' ORDER BY completed_at DESC,id DESC LIMIT 1`,[args.workspace_id])).rows[0];
    return{workspace_id:args.workspace_id,observed_at:observed,latest_run:latest?await view(latest):null,request_run:request?await view(request):null,
      latest_complete_execution_id:completed?.id??null,latest_complete:rows.find(row=>row.id===completed?.id)?await view(rows.find(row=>row.id===completed?.id)!):null};
  },true);
}
/** Private server-side artifact references only. This is not a signed/public URL reader. */
export async function readSignalWorkspaceEngineArtifactsV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;
  execution_id:string;after_artifact_key?:string;limit?:number}){
  const limit=limitOf(args.limit);return transaction(args.database,async client=>{await authorize(client,args.workspace_id,args.actor_user_id);
    const run=await lockedRun(client,args.execution_id);if(run.workspace_id!==args.workspace_id)return fail('workspace_engine_not_found',404);
    await current(client,run,true);
    const rows=(await client.query<{artifact_id:string;artifact_key:string;artifact_type:string;content:Record<string,unknown>;metadata:Record<string,unknown>}>(`
      SELECT id artifact_id,artifact_key,artifact_type,content,metadata FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND workspace_id=$2::uuid
      AND ($3::text IS NULL OR artifact_key COLLATE "C">$3 COLLATE "C") ORDER BY artifact_key COLLATE "C" LIMIT $4`,
      [run.id,args.workspace_id,args.after_artifact_key??null,limit+1])).rows;const items=rows.slice(0,limit);
    return{items,done:rows.length<=limit,next_cursor:items.at(-1)?.artifact_key??args.after_artifact_key??null};
  });
}
/** A newer accepted import may advance the revision without withdrawing any input
 * used to fit the parent. Permit model reuse only when the new, rights-checked
 * preparation retains every parent root with the same exact input fingerprint.
 * Text/rights/context changes require a fresh fit; they never authorize stale bytes. */
export async function readSignalWorkspaceEngineParentArtifactsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  after_artifact_key?:string;limit?:number}):Promise<{available:boolean;reason:'no_parent'|'parent_inputs_changed'|null;
   items:Array<{artifact_id:string;artifact_key:string;artifact_type:string;content:Record<string,unknown>;metadata:Record<string,unknown>}>;
   done:boolean;next_cursor:string|null}>{
  const limit=limitOf(args.limit);return transaction(args.database,async client=>{const run=await requireLease(client,args.lease,true);
    const parent=run.input_snapshot.parent_execution_id;if(!parent)return{available:false,reason:'no_parent',items:[],done:true,next_cursor:null};
    const allowed=(await client.query<{valid:boolean}>(`SELECT parent.status='ready' AND parent.embedding_config_digest=$4
      AND parent.input_snapshot->>'context_digest'=$5
      AND (parent.policy_valid_until IS NULL OR parent.policy_valid_until>clock_timestamp())
      AND NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_items prior
        LEFT JOIN signal_corpus_preparation_items current ON current.run_id=$3::uuid AND current.workspace_id=prior.workspace_id
         AND current.root_id=prior.root_id AND current.disposition='eligible' AND current.fingerprint=prior.fingerprint
        WHERE prior.run_id=parent.preparation_run_id AND prior.workspace_id=parent.workspace_id
         AND prior.disposition='eligible' AND current.root_id IS NULL) valid
      FROM signal_topic_catalog_executions parent WHERE parent.id=$1::uuid AND parent.workspace_id=$2::uuid AND parent.input_contract='workspace-topic-engine-v1'`,
      [parent,run.workspace_id,run.input_snapshot.preparation_run_id,run.input_snapshot.embedding_profile.config_digest,run.input_snapshot.context_digest])).rows[0]?.valid;
    if(!allowed)return{available:false,reason:'parent_inputs_changed',items:[],done:true,next_cursor:null};
    const rows=(await client.query<{artifact_id:string;artifact_key:string;artifact_type:string;content:Record<string,unknown>;metadata:Record<string,unknown>}>(`
      SELECT id artifact_id,artifact_key,artifact_type,content,metadata FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND workspace_id=$2::uuid
      AND ($3::text IS NULL OR artifact_key COLLATE "C">$3 COLLATE "C") ORDER BY artifact_key COLLATE "C" LIMIT $4`,
      [parent,run.workspace_id,args.after_artifact_key??null,limit+1])).rows;const items=rows.slice(0,limit);
    return{available:true,reason:null,items,done:rows.length<=limit,next_cursor:items.at(-1)?.artifact_key??args.after_artifact_key??null};
  });
}
/** First durable output manifest is the recovery checkpoint. All bytes in its
 * private bundle must already have been uploaded and verified by the caller. */
export async function readSignalWorkspaceEngineCheckpointV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1}):Promise<{
  artifact_id:string;artifact_key:string;content:Record<string,unknown>;metadata:Record<string,unknown>;
}|null>{
  return transaction(args.database,async client=>{const run=await requireLease(client,args.lease,true);
    if(run.result_summary.interpretation_evidence_checkpoint_required===true
      && (await client.query<{valid:boolean}>(`SELECT (${outputBundlePredicate}) valid
        FROM signal_topic_catalog_executions execution WHERE execution.id=$1::uuid`,[run.id])).rows[0]?.valid!==true)
      return fail('workspace_engine_checkpoint_invalid');
    return(await client.query<{artifact_id:string;artifact_key:string;content:Record<string,unknown>;metadata:Record<string,unknown>}>(`
      SELECT id artifact_id,artifact_key,content,metadata FROM analysis_artifacts WHERE engine_execution_id=$1::uuid
       AND workspace_id=$2::uuid AND artifact_type='engine_output' AND artifact_key='manifest.json' LIMIT 1`,[run.id,run.workspace_id])).rows[0]??null;
  });
}

/** Read immutable completed editorial units; object SHA and packet validation
 * remain mandatory before their bytes can be used by the Worker/materializer. */
export async function readSignalWorkspaceEngineInterpretationCheckpointsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 after_artifact_id?:string|null;limit?:number}):Promise<{items:SignalWorkspaceEngineInterpretationCheckpointV1[];next_artifact_id:string|null;done:boolean}>{
 const limit=args.limit??32;if(!Number.isInteger(limit)||limit<1||limit>32)return fail('workspace_engine_page_invalid',422);
 return transaction(args.database,async client=>{const run=await requireLease(client,args.lease,true);
  if(!run.result_summary.fit_checkpoint)return fail('workspace_engine_fit_checkpoint_required');
  const rows=(await client.query<{artifact_id:string;artifact_key:string;content:{storage_key:string;sha256:string;size_bytes:number;media_type:string};
   unit_keys:string[];call_id:string;call_configuration:SignalWorkspaceEngineInterpretationConfigurationV1;interpretation_revision_digest:string|null;valid:boolean}>(`
   SELECT artifact.id artifact_id,artifact.artifact_key,artifact.content,artifact.metadata->'unit_keys' unit_keys,
    call.id call_id,call.call_configuration,call.metadata->>'interpretation_revision_digest' interpretation_revision_digest,
    COALESCE(call.call_state='settled' AND call.response_sha256=artifact.metadata->>'response_sha256'
     AND call.actor_user_id=$3::uuid AND call.call_configuration=workspace_engine_interpretation_configuration_v1(call.catalog_execution_id,call.metadata->>'interpretation_revision_digest')
     AND artifact.metadata->>'fit_checkpoint_digest'=$4,false) valid
   FROM analysis_artifacts artifact LEFT JOIN engine_cost_events call ON call.id=(artifact.metadata->>'call_id')::uuid
    AND call.catalog_execution_id=artifact.engine_execution_id AND call.workspace_id=artifact.workspace_id
   WHERE artifact.workspace_id=$1::uuid AND artifact.engine_execution_id=$2::uuid AND artifact.artifact_type='engine_proposals'
    AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
    AND ($5::uuid IS NULL OR artifact.id>$5::uuid) ORDER BY artifact.id LIMIT $6`,
   [run.workspace_id,run.id,run.actor_user_id,(run.result_summary.fit_checkpoint as SignalWorkspaceEngineFitCheckpointV1).checkpoint_digest,args.after_artifact_id??null,limit+1])).rows;
  if(rows.some(row=>!row.valid))return fail('workspace_engine_interpretation_receipt_required');
  const page=rows.slice(0,limit),items=page.map(row=>({artifact_id:row.artifact_id,artifact_key:row.artifact_key,...row.content,
   unit_keys:row.unit_keys,call_id:row.call_id,call_configuration:row.call_configuration,interpretation_revision_digest:row.interpretation_revision_digest}));
  return{items,next_artifact_id:items.at(-1)?.artifact_id??null,done:rows.length<=limit};
 });
}
/** Explicit, bounded model rollover. The original request and all metered calls
 * remain immutable; this action cannot create a new execution or release cost. */
export async function reviseSignalWorkspaceEngineInterpretationV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;
 execution_id:string;idempotency_key:string;source_call_id:string;configuration:SignalWorkspaceEngineAnalysisConfigV1;admission_not_after:string}):Promise<{execution_id:string;revision_digest:string;replayed:boolean}>{
 if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(args.admission_not_after))return fail('workspace_engine_revision_invalid',422);
 const profile=parseSignalWorkspaceInterpretationConfigurationV1(args.configuration.call_configuration);
 if(signalWorkspaceEmbeddingDigestV1(profile)!==signalWorkspaceEmbeddingDigestV1(SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1))return fail('workspace_engine_revision_model_invalid',422);
 const requestDigest=signalWorkspaceEmbeddingDigestV1({action:'revise_interpretation',execution_id:args.execution_id,source_call_id:args.source_call_id,
  configuration:args.configuration,admission_not_after:args.admission_not_after});
 return transaction(args.database,async client=>{await authorize(client,args.workspace_id,args.actor_user_id);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-interpretation-budget:${args.actor_user_id}`]);
  const run=await lockedRun(client,args.execution_id);if(run.workspace_id!==args.workspace_id||run.actor_user_id!==args.actor_user_id)return fail('workspace_engine_forbidden',403);
  await current(client,run,true);
  const prior=(await client.query<{id:string;alias:{actor_user_id:string;request_digest:string}|null}>(`SELECT id,engine_request_keys->$2 alias
   FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND (idempotency_key=$2 OR engine_request_keys ? $2)`,[args.workspace_id,args.idempotency_key])).rows[0];
  if(prior&&(prior.id!==run.id||prior.alias?.actor_user_id!==args.actor_user_id||prior.alias?.request_digest!==requestDigest))return fail('workspace_engine_idempotency_conflict');
  if(run.interpretation_revision){const r=run.interpretation_revision;
   if(r.source_call_id!==args.source_call_id||r.admission_not_after!==args.admission_not_after||signalWorkspaceEmbeddingDigestV1(r.configuration)!==signalWorkspaceEmbeddingDigestV1(args.configuration))return fail('workspace_engine_revision_exhausted');
   if(!prior)await client.query("UPDATE signal_topic_catalog_executions SET engine_request_keys=engine_request_keys||jsonb_build_object($2::text,$3::jsonb) WHERE id=$1::uuid",[run.id,args.idempotency_key,JSON.stringify({actor_user_id:args.actor_user_id,request_digest:requestDigest})]);
   return{execution_id:run.id,revision_digest:r.revision_digest,replayed:true};
  }
  if(run.status!=='failed'||run.error_code!=='workspace_engine_interpretation_repair_invalid')return fail('workspace_engine_revision_unavailable');
  const fit=run.result_summary.fit_checkpoint as SignalWorkspaceEngineFitCheckpointV1|undefined;if(!fit)return fail('workspace_engine_fit_checkpoint_required');
  const source=(await client.query<{request_digest:string;response_sha256:string;call_configuration:unknown;budget_date:string}>(`SELECT request_digest,response_sha256,call_configuration,budget_date::text
   FROM engine_cost_events WHERE id=$1::uuid AND workspace_id=$2::uuid AND catalog_execution_id=$3::uuid AND actor_user_id=$4::uuid FOR UPDATE`,
   [args.source_call_id,run.workspace_id,run.id,run.actor_user_id])).rows[0];if(!source)return fail('workspace_engine_revision_source_invalid');
  const retained=await interpretationCoverage(client,run),clock=(await client.query<{now:string}>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`)).rows[0]!.now;
  const body={contract_version:'workspace-engine-interpretation-revision-v1' as const,execution_id:run.id,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id,input_digest:run.input_digest,
   source_call_id:args.source_call_id,source_request_digest:source.request_digest,source_response_sha256:source.response_sha256,
   source_configuration_digest:signalWorkspaceEmbeddingDigestV1(source.call_configuration),configuration:args.configuration,
   fit_checkpoint_digest:fit.checkpoint_digest,retained_unit_manifest:retained,budget_date:source.budget_date,admission_not_after:args.admission_not_after,authorized_at:clock};
  const revision={...body,revision_digest:signalWorkspaceEmbeddingDigestV1(body)};
  const updated=(await client.query<{dispatch_generation:number}>(`UPDATE signal_topic_catalog_executions SET interpretation_revision=$2::jsonb,
   status='queued',error_code=NULL,completed_at=NULL,execution_token=NULL,execution_expires_at=NULL,dispatch_generation=dispatch_generation+1,
   engine_request_keys=engine_request_keys||jsonb_build_object($3::text,$4::jsonb),
   result_summary=result_summary||'{"phase":"queued","interpretation_evidence_checkpoint_required":true}'::jsonb,updated_at=clock_timestamp()
   WHERE id=$1::uuid RETURNING dispatch_generation`,[run.id,JSON.stringify(revision),args.idempotency_key,JSON.stringify({actor_user_id:args.actor_user_id,request_digest:requestDigest})])).rows[0]!;
  await client.query(`UPDATE signal_topic_classification_outbox SET status='pending',worker_job_id=$2,attempt_count=0,available_at=clock_timestamp(),
   completed_at=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE dispatch_kind='execution' AND execution_id=$1::uuid`,[run.id,`workspace-engine-${run.id}-${updated.dispatch_generation}`]);
  return{execution_id:run.id,revision_digest:revision.revision_digest,replayed:false};
 });
}

/** One paid-evidence owner per workspace prevents two historical engines from
 * repeatedly replacing each other's derived catalog after an operator edit. */
export const signalWorkspaceEngineProgressOwnerPredicateV1=`NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions newer
 WHERE newer.workspace_id=execution.workspace_id AND newer.input_contract='workspace-topic-engine-v1'
 AND newer.status IN('running','failed','ready') AND newer.result_summary ? 'fit_checkpoint'
 AND (newer.created_at,newer.id)>(execution.created_at,execution.id)
 AND EXISTS(SELECT 1 FROM analysis_artifacts paid WHERE paid.engine_execution_id=newer.id
  AND paid.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'))`;

/** Current authority for a provider-free derivation. It cannot renew or borrow
 * the editorial execution token, change its status, or authorize a paid call. */
export async function loadSignalWorkspaceEngineProgressInputWithClientV1(client:PoolClient,scope:{execution_id:string;workspace_id:string;actor_user_id:string}) {
 const run=await lockedRun(client,scope.execution_id);
 if(run.workspace_id!==scope.workspace_id||run.actor_user_id!==scope.actor_user_id)return fail('workspace_engine_progress_forbidden',403);
 await authorize(client,scope.workspace_id,scope.actor_user_id);await current(client,run,true);
 const fit=run.result_summary.fit_checkpoint as SignalWorkspaceEngineFitCheckpointV1|undefined;
 if(!fit||!run.input_snapshot.interpretation_config||!['running','failed','ready'].includes(run.status))return fail('workspace_engine_fit_checkpoint_required');
 const owner=(await client.query<{owner:boolean}>(`SELECT (${signalWorkspaceEngineProgressOwnerPredicateV1}) owner FROM signal_topic_catalog_executions execution WHERE execution.id=$1::uuid`,[run.id])).rows[0]?.owner;
 if(!owner)return fail('workspace_engine_progress_superseded');
 const coverage=await interpretationCoverage(client,run);
 if(coverage.unit_count>fit.interpretation_manifest.unit_count)return fail('workspace_engine_proposal_coverage_invalid');
 return{run,snapshot:publicSnapshot(run.input_snapshot),fit,coverage};
}
export async function persistSignalWorkspaceEngineProgressArtifactWithClientV1(client:PoolClient,
 scope:{execution_id:string;workspace_id:string;actor_user_id:string},artifact:SignalWorkspaceEngineArtifactV1){
 const {run}=await loadSignalWorkspaceEngineProgressInputWithClientV1(client,scope);
 if(artifact.metadata.contract_version!=='workspace-topic-materialization-progress-v1'||artifact.artifact_type!=='engine_proposals')return fail('workspace_engine_artifact_invalid',422);
 return persistSignalWorkspaceEngineArtifactWithClientV1(client,run,artifact);
}
