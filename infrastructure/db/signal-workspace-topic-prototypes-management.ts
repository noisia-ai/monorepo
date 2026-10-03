import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { quoteSignalWorkspaceEmbeddingCostV1, signalWorkspaceEmbeddingDigestV1,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, type SignalWorkspaceTopicPrototypePlanV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { loadSignalWorkspaceTopicPrototypePlanV1, loadSignalWorkspaceAutonomousContextInputsV1 } from "./signal-workspace-topic-prototype-inputs";
import { ensureSignalTopicCatalogStoreV1, SignalTopicCatalogError } from "./signal-topic-catalog";
import { SignalWorkspaceTopicComputationError } from "./signal-workspace-topic-computation";
import { SignalWorkspaceEmbeddingsError, type SignalWorkspaceEmbeddingsDatabaseV1,
  type SignalWorkspaceEmbeddingsQueryableV1 } from "./signal-workspace-embeddings";
import type { SignalWorkspaceTopicPrototypeCountsV1, SignalWorkspaceTopicPrototypeRunV1,
  SignalWorkspaceTopicPrototypesQuoteV1, SignalWorkspaceTopicPrototypesStatusV1 } from "./signal-workspace-topic-prototypes-types";

type Access = { database: SignalWorkspaceEmbeddingsDatabaseV1; workspace_id: string; actor_user_id: string; brand_context_preparation_operation_id?: string };
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceEmbeddingsError(code, status); };
const integer = (value: unknown): number => {
  const n = Number(value);
  if ((typeof value !== "number" && typeof value !== "string") || !Number.isSafeInteger(n) || n < 0) return fail("workspace_embedding_invalid_count", 503);
  return n;
};
const timestamp = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)) return fail("workspace_embedding_invalid_timestamp", 503);
  return value;
};
const retryableErrors = new Set(["workspace_embedding_worker_failed", "workspace_embedding_queue_unavailable", "workspace_embedding_definitely_not_sent"]);
const countKeys: Array<keyof SignalWorkspaceTopicPrototypeCountsV1> = ["total_topics", "completed_topics", "partial_topics", "pending_topics",
  "total_input_references", "processed_input_references", "total_unique_inputs", "processed_unique_inputs", "cache_hits", "embedded_unique_inputs"];
async function transaction<T>(args: Access, execute: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await args.database.connect();
  try {
    await client.query(execute ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: args.workspace_id, actor_user_id: args.actor_user_id });
    if (!caps.can_view || execute && !caps.can_execute_topics) return fail("workspace_embedding_forbidden", 403);
    const result = await work(client); await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
function runView(row: Record<string, unknown> | null, planDigest: string | null): SignalWorkspaceTopicPrototypeRunV1 | null {
  if (!row) return null;
  if (!row.counts || typeof row.counts !== "object" || Array.isArray(row.counts)) return fail("workspace_embedding_invalid_count", 503);
  const counts = Object.fromEntries(countKeys.map(key => [key, integer((row.counts as Record<string, unknown>)[key])])) as SignalWorkspaceTopicPrototypeCountsV1;
  if (counts.completed_topics + counts.partial_topics + counts.pending_topics !== counts.total_topics
    || counts.processed_input_references > counts.total_input_references || counts.processed_unique_inputs > counts.total_unique_inputs
    || counts.cache_hits + counts.embedded_unique_inputs !== counts.processed_unique_inputs
    || row.status === "completed" && (counts.completed_topics !== counts.total_topics
      || counts.processed_input_references !== counts.total_input_references || counts.processed_unique_inputs !== counts.total_unique_inputs)) {
    return fail("workspace_embedding_invalid_count", 503);
  }
  return { id: String(row.id), plan_digest: String(row.topic_input_digest), status: row.status as SignalWorkspaceTopicPrototypeRunV1["status"], counts,
    hard_cap_micro_usd: integer(row.hard_cap_micro_usd), estimated_upper_micro_usd: integer(row.estimated_upper_micro_usd),
    reserved_micro_usd: integer(row.reserved_micro_usd), settled_micro_usd: integer(row.settled_micro_usd),
    unknown_reserved_micro_usd: integer(row.unknown_reserved_micro_usd), observed_exception_micro_usd: integer(row.observed_exception_micro_usd),
    error_code: row.error_code === null ? null : String(row.error_code),
    retryable: row.status === "failed" && retryableErrors.has(String(row.error_code)) && row.topic_input_digest === planDigest
      && integer(row.unknown_reserved_micro_usd) === 0 && integer(row.observed_exception_micro_usd) === 0,
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), completed_at: row.completed_at === null ? null : timestamp(row.completed_at) };
}

/** Explicit preparation intent may create the real empty catalog required by the
 * prototype ledger. Reads remain read-only; this does not enqueue or spend. */
export function initializeSignalWorkspaceTopicPrototypeCatalogV1(args: Access): Promise<{ taxonomy_profile_id: string; created: boolean }> {
  return transaction(args, true, client => ensureSignalTopicCatalogStoreV1({ client,
    workspace_id: args.workspace_id, actor_user_id: args.actor_user_id }));
}

/** Status projects bounded run metadata; source text, request keys and provider receipts stay server-side. */
export async function loadSignalWorkspaceTopicPrototypesV1(args: Access & { idempotency_key?: string }): Promise<SignalWorkspaceTopicPrototypesStatusV1> {
  return transaction(args, false, async client => {
    let plan: SignalWorkspaceTopicPrototypePlanV1 | null = null;
    let unavailable: SignalWorkspaceTopicPrototypesStatusV1["availability"] = "no_topics";
    try { plan = await loadSignalWorkspaceTopicPrototypePlanV1({ ...args, queryable: client }); }
    catch (error) {
      let cause = error;
      const noCatalog = error instanceof SignalWorkspaceTopicComputationError
        && ["workspace_topic_catalog_empty", "workspace_topic_catalog_required"].includes(error.code);
      if (noCatalog) {
        // A missing catalog is actionable only after semantic publication. Do
        // not invite initialization when it would immediately hit that fence.
        try { await loadSignalWorkspaceAutonomousContextInputsV1({ queryable: client, workspace_id: args.workspace_id }); }
        catch (contextError) { cause = contextError; }
      }
      if (cause instanceof SignalTopicCatalogError && cause.code === "brand_context_source_stale") unavailable = "context_stale";
      else if (cause instanceof SignalTopicCatalogError && cause.code === "brand_context_semantic_context_required") unavailable = "context_required";
      else if (!noCatalog || cause !== error) throw cause;
    }
    const row = (await client.query<{
      observed_at: string; active_run: Record<string, unknown> | null; latest_run: Record<string, unknown> | null;
      latest_completed: Record<string, unknown> | null; request_run: Record<string, unknown> | null;
      blocking_run_kind: "corpus" | "topic_prototypes" | null;
    }>(`WITH recent AS MATERIALIZED (
      SELECT run.id,run.topic_input_digest,run.status,run.counts,run.error_code,run.hard_cap_micro_usd,
        run.estimated_upper_micro_usd,run.reserved_micro_usd,run.settled_micro_usd,
        run.unknown_reserved_micro_usd,run.observed_exception_micro_usd,run.config_digest,
        ($3::text IS NOT NULL AND run.request_keys->$3->>'actor_user_id'=$4) requested,
        to_char(run.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
        to_char(run.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') updated_at,
        to_char(run.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') completed_at
      FROM signal_workspace_embedding_runs run WHERE workspace_id=$1::uuid AND input_contract='topic_prototypes' AND id IN (
        (SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND input_contract='topic_prototypes' ORDER BY created_at DESC,id DESC LIMIT 1),
        (SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND input_contract='topic_prototypes' AND config_digest=$2 AND status IN('queued','running') LIMIT 1),
        (SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND input_contract='topic_prototypes' AND config_digest=$2 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1),
        (SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND input_contract='topic_prototypes' AND $3::text IS NOT NULL
          AND request_keys->$3->>'actor_user_id'=$4 ORDER BY created_at DESC,id DESC LIMIT 1)
      )
    ) SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at,
      (SELECT to_jsonb(r) FROM recent r WHERE status IN('queued','running') AND config_digest=$2 LIMIT 1) active_run,
      (SELECT to_jsonb(r) FROM recent r ORDER BY created_at DESC,id DESC LIMIT 1) latest_run,
      (SELECT to_jsonb(r) FROM recent r WHERE status='completed' AND config_digest=$2 ORDER BY completed_at DESC,id DESC LIMIT 1) latest_completed,
      (SELECT to_jsonb(r) FROM recent r WHERE requested LIMIT 1) request_run,
      (SELECT input_contract FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND config_digest=$2 AND status IN('queued','running') LIMIT 1) blocking_run_kind`,
    [args.workspace_id, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest, args.idempotency_key ?? null, args.actor_user_id])).rows[0]!;
    const digest = plan?.plan_digest ?? null;
    const completed = runView(row.latest_completed, digest);
    return { contract_version: "signal-workspace-topic-prototypes-v1", workspace_id: args.workspace_id,
      observed_at: timestamp(row.observed_at), current_plan_digest: digest, availability: plan ? "available" : unavailable,
      active_run: runView(row.active_run, digest), latest_run: runView(row.latest_run, digest), latest_completed: completed,
      request_run: runView(row.request_run, digest), is_current: digest !== null && completed?.plan_digest === digest,
      blocking_run_kind: row.blocking_run_kind };
  });
}

/** A new preparation may renew an old Brand Context run, never adopt a legacy
 * run whose send path has no Brand Context admission fence. Parameters are SQL
 * placeholders supplied only by this module, not request values. */
function compatibleBrandContextOriginSql(operationParameter: string) {
  return `EXISTS(SELECT 1 FROM signal_governance_control_operations origin
    JOIN signal_governance_control_operations preparation ON preparation.id=${operationParameter}::uuid
    WHERE origin.id=run.brand_context_preparation_operation_id
      AND origin.action='prepare-brand-context' AND origin.status='completed'
      AND preparation.action='prepare-brand-context' AND preparation.status='completed'
      AND origin.workspace_id=run.workspace_id AND preparation.workspace_id=run.workspace_id
      AND origin.actor_user_id=run.actor_user_id AND preparation.actor_user_id=run.actor_user_id
      AND origin.brand_context_preparation->>'generation_id'=preparation.brand_context_preparation->>'generation_id'
      AND origin.brand_context_preparation->'admission'->>'configuration_digest'=preparation.brand_context_preparation->'admission'->>'configuration_digest'
      AND origin.brand_context_preparation->'admission'->>'semantic_cap_micro_usd'=preparation.brand_context_preparation->'admission'->>'semantic_cap_micro_usd'
      AND origin.brand_context_preparation->'admission'->>'prototype_cap_micro_usd'=preparation.brand_context_preparation->'admission'->>'prototype_cap_micro_usd'
      AND run.hard_cap_micro_usd=(origin.brand_context_preparation->'admission'->>'prototype_cap_micro_usd')::bigint)`;
}
async function requireCompatibleBrandContextOrigin(client: PoolClient, args: Access, runId: string) {
  if (!args.brand_context_preparation_operation_id) return;
  const row=(await client.query<{compatible:boolean}>(`SELECT ${compatibleBrandContextOriginSql('$3')} compatible
    FROM signal_workspace_embedding_runs run WHERE run.id=$1::uuid AND run.workspace_id=$2::uuid FOR UPDATE OF run`,
    [runId,args.workspace_id,args.brand_context_preparation_operation_id])).rows[0];
  if (!row?.compatible) return fail("workspace_embedding_preparation_origin_mismatch");
}
async function quote(queryable: SignalWorkspaceEmbeddingsQueryableV1, args: Access,
  plan: SignalWorkspaceTopicPrototypePlanV1): Promise<SignalWorkspaceTopicPrototypesQuoteV1> {
  const hashes = Object.keys(plan.texts);
  const cached = new Set((await queryable.query<{ chunk_sha256: string }>(`SELECT chunk_sha256 FROM signal_workspace_chunk_embeddings
    WHERE workspace_id=$1::uuid AND config_digest=$2 AND chunk_sha256=ANY($3::text[])`,
  [args.workspace_id, plan.embedding_profile.config_digest, hashes])).rows.map(row => row.chunk_sha256));
  const missing = hashes.filter(hash => !cached.has(hash));
  const runtime = (await queryable.query<{
    observed_at: string; resume_run_id: string | null; required_cap_micro_usd: string | null;
    blocking_run_kind: "corpus" | "topic_prototypes" | null; blocked_status: string | null; recoverable_input_keys: string[];
  }>(`WITH resumable AS MATERIALIZED (
    SELECT id,hard_cap_micro_usd FROM signal_workspace_embedding_runs run WHERE workspace_id=$1::uuid AND input_contract='topic_prototypes'
      AND config_digest=$2 AND topic_input_digest=$3 AND actor_user_id=$4::uuid AND status='failed'
      AND error_code=ANY($5::text[]) AND unknown_reserved_micro_usd=0 AND observed_exception_micro_usd=0
      ${args.brand_context_preparation_operation_id ? `AND ${compatibleBrandContextOriginSql('$7')}` : ''}
      ORDER BY created_at DESC,id DESC LIMIT 1
  ) SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at,
    (SELECT id FROM resumable) resume_run_id,(SELECT hard_cap_micro_usd::text FROM resumable) required_cap_micro_usd,
    (SELECT input_contract FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND config_digest=$2 AND status IN('queued','running') LIMIT 1) blocking_run_kind,
    (SELECT call.status FROM signal_workspace_embedding_calls call WHERE call.workspace_id=$1::uuid AND call.config_digest=$2
      AND call.status<>'definitely_not_sent' AND call.input_keys && $6::text[]
      AND call.run_id IS DISTINCT FROM (SELECT id FROM resumable)
      AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_runs active WHERE active.id=call.run_id AND active.status IN('queued','running'))
      ORDER BY CASE WHEN call.status IN('in_flight','outcome_unknown') THEN 0 WHEN call.status='settled' THEN 2 ELSE 1 END,
        call.reserved_at DESC LIMIT 1) blocked_status,
    ARRAY(SELECT DISTINCT unnest(call.input_keys) FROM signal_workspace_embedding_calls call
      WHERE call.run_id=(SELECT id FROM resumable) AND call.status IN('response_persisted','settled')
        AND call.response_body_private IS NOT NULL) recoverable_input_keys`,
  [args.workspace_id, plan.embedding_profile.config_digest, plan.plan_digest, args.actor_user_id, [...retryableErrors], missing,
    ...(args.brand_context_preparation_operation_id ? [args.brand_context_preparation_operation_id] : [])])).rows[0]!;
  const blockingError = runtime.blocked_status === null ? null : runtime.blocked_status === "settled"
    ? "workspace_embedding_prior_response_unusable" as const : ["in_flight", "outcome_unknown"].includes(runtime.blocked_status)
      ? "workspace_embedding_outcome_unknown" as const : "workspace_embedding_prior_run_unresolved" as const;
  const recoverable = new Set(runtime.recoverable_input_keys);
  const unsent = missing.filter(hash => !recoverable.has(hash));
  const inputBytes = unsent.reduce((sum, hash) => sum + Buffer.byteLength(plan.texts[hash]!, "utf8"), 0);
  const cost = quoteSignalWorkspaceEmbeddingCostV1({ input_bytes: inputBytes, chunk_count: unsent.length });
  const sealed = { contract_version: "signal-workspace-topic-prototypes-quote-v1" as const,
    workspace_id: args.workspace_id, plan_digest: plan.plan_digest, profile: plan.embedding_profile,
    total_topics: plan.topics.length, total_input_references: plan.topics.reduce((sum, topic) => sum + topic.input_digests.length, 0) + (plan.context_inputs?.length ?? 0),
    total_unique_inputs: hashes.length, cached_unique_inputs: cached.size, missing_unique_inputs: missing.length,
    recoverable_receipt_inputs: missing.length - unsent.length, requires_provider: unsent.length > 0,
    input_bytes: inputBytes, tokens_upper: cost.token_upper_bound, estimated_upper_micro_usd: cost.estimated_max_cost_micro_usd,
    resume_run_id: runtime.resume_run_id, required_cap_micro_usd: runtime.required_cap_micro_usd === null ? null : integer(runtime.required_cap_micro_usd),
    blocking_run_kind: runtime.blocking_run_kind, has_unknown_outcome: blockingError === "workspace_embedding_outcome_unknown",
    blocking_error_code: blockingError };
  return { ...sealed, quote_digest: signalWorkspaceEmbeddingDigestV1(sealed), observed_at: timestamp(runtime.observed_at) };
}
export async function quoteSignalWorkspaceTopicPrototypesWithQueryableV1(queryable:SignalWorkspaceEmbeddingsQueryableV1,args:Access){
  return quote(queryable,args,await loadSignalWorkspaceTopicPrototypePlanV1({...args,queryable}));
}
export function quoteSignalWorkspaceTopicPrototypesV1(args: Access): Promise<SignalWorkspaceTopicPrototypesQuoteV1> {
  return transaction(args, false, async client => quote(client, args, await loadSignalWorkspaceTopicPrototypePlanV1({ ...args, queryable: client })));
}

async function resume(client: PoolClient, runId: string, requestKeys: Record<string, unknown>) {
  const result = await client.query(`UPDATE signal_workspace_embedding_runs SET status='queued',error_code=NULL,completed_at=NULL,
    request_keys=request_keys||$2::jsonb,dispatch_generation=dispatch_generation+1,
    worker_job_id='workspace-embeddings-'||id::text||'-'||(dispatch_generation+1)::text,
    dispatch_status='pending',dispatch_token=NULL,dispatch_expires_at=NULL,dispatch_attempts=0,
    available_at=clock_timestamp(),execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp()
    WHERE id=$1::uuid AND status='failed' RETURNING id`, [runId, JSON.stringify(requestKeys)]);
  if (!result.rows.length) return fail("workspace_embedding_quote_changed");
}
/** Creates durable intent in the existing embedding queue; provider availability is server-owned. */
export type SignalWorkspaceTopicPrototypeRequestArgsV1 = Access & {
  idempotency_key: string; plan_digest: string; quote_digest: string; hard_cap_micro_usd: number;
  provider_available: boolean; max_run_cost_micro_usd: number; brand_context_preparation_operation_id?:string;
};
export function requestSignalWorkspaceTopicPrototypesV1(args:SignalWorkspaceTopicPrototypeRequestArgsV1):Promise<{run_id:string;replayed:boolean}>{
  return transaction(args,true,client=>requestSignalWorkspaceTopicPrototypesWithClientV1(client,args));
}
export async function requestSignalWorkspaceTopicPrototypesWithClientV1(client:PoolClient,args:SignalWorkspaceTopicPrototypeRequestArgsV1):Promise<{run_id:string;replayed:boolean}>{
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)) return fail("workspace_embedding_idempotency_key_required", 400);
  if (!Number.isSafeInteger(args.hard_cap_micro_usd) || args.hard_cap_micro_usd < 0) return fail("workspace_embedding_budget_invalid", 422);
  if (!Number.isSafeInteger(args.max_run_cost_micro_usd) || args.max_run_cost_micro_usd < 0) return fail("workspace_embedding_budget_configuration_invalid", 503);
  const digest = signalWorkspaceEmbeddingDigestV1({ input_contract: "topic_prototypes", plan_digest: args.plan_digest,
    quote_digest: args.quote_digest, hard_cap_micro_usd: args.hard_cap_micro_usd, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
    ...(args.brand_context_preparation_operation_id ? {brand_context_preparation_operation_id:args.brand_context_preparation_operation_id} : {}) });
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id});
  if(!caps.can_execute_topics)return fail("workspace_embedding_forbidden",403);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`workspace-embedding-request:${args.workspace_id}`]);
    const replay = (await client.query<{ id: string; actor: string; digest: string; status: string; error_code: string | null;
      topic_input_digest: string | null; unknown_reserved_micro_usd: string; observed_exception_micro_usd: string }>(`SELECT id,status,error_code,topic_input_digest,
      unknown_reserved_micro_usd::text,observed_exception_micro_usd::text,request_keys->$2->>'actor_user_id' actor,request_keys->$2->>'request_digest' digest
      FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND request_keys ? $2 LIMIT 1 FOR UPDATE`,
    [args.workspace_id, args.idempotency_key])).rows[0];
    if (replay && (replay.actor !== args.actor_user_id || replay.digest !== digest)) return fail("workspace_embedding_idempotency_conflict");
    if (replay) await requireCompatibleBrandContextOrigin(client,args,replay.id);
    if (replay && !(replay.status === "failed" && retryableErrors.has(replay.error_code ?? "")
      && integer(replay.unknown_reserved_micro_usd) === 0 && integer(replay.observed_exception_micro_usd) === 0)) {
      return { run_id: replay.id, replayed: true };
    }
    const plan = await loadSignalWorkspaceTopicPrototypePlanV1({ ...args, queryable: client });
    const current = await quote(client, args, plan);
    if (current.plan_digest !== args.plan_digest || !replay && current.quote_digest !== args.quote_digest) return fail("workspace_embedding_quote_changed");
    // Settling an already persisted receipt does not authorize another paid request.
    // Retain its original cap even if the configured cap has since been reduced.
    if (args.hard_cap_micro_usd > args.max_run_cost_micro_usd && (current.requires_provider || !current.resume_run_id)) {
      return fail("workspace_embedding_budget_exceeds_limit", 422);
    }
    if (current.blocking_run_kind) return fail("workspace_embedding_already_running");
    if (current.blocking_error_code) return fail(current.blocking_error_code);
    if (current.requires_provider && !args.provider_available) return fail("workspace_embedding_provider_unavailable", 503);
    const resumeId = replay?.id ?? current.resume_run_id;
    if (resumeId) {
      if (current.resume_run_id !== resumeId || args.hard_cap_micro_usd !== current.required_cap_micro_usd) return fail("workspace_embedding_resume_budget_changed", 422);
      await requireCompatibleBrandContextOrigin(client,args,resumeId);
      await resume(client, resumeId, { [args.idempotency_key]: { actor_user_id: args.actor_user_id, request_digest: digest } });
      return { run_id: resumeId, replayed: Boolean(replay) };
    }
    if (args.hard_cap_micro_usd < current.estimated_upper_micro_usd) return fail("workspace_embedding_budget_below_quote", 422);
    const runId = randomUUID();
    const counts: SignalWorkspaceTopicPrototypeCountsV1 = { total_topics: current.total_topics, completed_topics: 0,
      partial_topics: 0, pending_topics: current.total_topics, total_input_references: current.total_input_references,
      processed_input_references: 0, total_unique_inputs: current.total_unique_inputs, processed_unique_inputs: 0,
      cache_hits: 0, embedded_unique_inputs: 0 };
    await client.query(`INSERT INTO signal_workspace_embedding_runs(id,workspace_id,actor_user_id,input_contract,
      taxonomy_profile_id,topic_input_snapshot,topic_input_digest,profile,config_digest,quote_digest,request_keys,
      hard_cap_micro_usd,estimated_upper_micro_usd,counts,worker_job_id,brand_context_preparation_operation_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,'topic_prototypes',$4::uuid,$5::jsonb,$6,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15::uuid)`,
    [runId, args.workspace_id, args.actor_user_id, plan.taxonomy_profile_id, JSON.stringify(plan), plan.plan_digest,
      JSON.stringify(plan.embedding_profile), plan.embedding_profile.config_digest, current.quote_digest,
      JSON.stringify({ [args.idempotency_key]: { actor_user_id: args.actor_user_id, request_digest: digest } }),
      args.hard_cap_micro_usd, current.estimated_upper_micro_usd, JSON.stringify(counts), `workspace-embeddings-${runId}-1`,args.brand_context_preparation_operation_id??null]);
    return { run_id: runId, replayed: false };

}
