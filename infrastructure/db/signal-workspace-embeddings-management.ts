import { randomUUID } from "node:crypto";
import { assertSignalWorkspaceEmbeddingProfileV1, quoteSignalWorkspaceEmbeddingCostV1,
  signalWorkspaceEmbeddingDigestV1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  type SignalWorkspaceEmbeddingProfileV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { SignalWorkspaceEmbeddingsError, type SignalWorkspaceEmbeddingsDatabaseV1,
  type SignalWorkspaceEmbeddingsQueryableV1, type SignalWorkspaceEmbeddingRunV1,
  type SignalWorkspaceEmbeddingCountsV1, type SignalWorkspaceEmbeddingsQuoteV1,
  type SignalWorkspaceEmbeddingsStatusV1 } from "./signal-workspace-embeddings";

const fail = (code: string, status = 409): never => { throw new SignalWorkspaceEmbeddingsError(code, status); };
const integer = (value: unknown): number => {
  const number = Number(value);
  if ((typeof value !== "number" && typeof value !== "string") || !Number.isSafeInteger(number) || number < 0) {
    return fail("workspace_embedding_invalid_count", 503);
  }
  return number;
};
const timestamp = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)) {
    return fail("workspace_embedding_invalid_timestamp", 503);
  }
  return value;
};
const countKeys: Array<keyof SignalWorkspaceEmbeddingCountsV1> = ["eligible_roots", "completed_roots", "partial_roots", "pending_roots",
  "total_chunk_references", "processed_chunk_references", "total_asset_chunks", "processed_asset_chunks", "cache_hits", "embedded_unique_chunks"];
const retryableErrors = new Set(["workspace_embedding_worker_failed", "workspace_embedding_queue_unavailable", "workspace_embedding_definitely_not_sent"]);
function runView(row: Record<string, unknown> | null): SignalWorkspaceEmbeddingRunV1 | null {
  if (!row) return null;
  if (!row.counts || typeof row.counts !== "object" || Array.isArray(row.counts)) return fail("workspace_embedding_invalid_count", 503);
  const counts = Object.fromEntries(countKeys.map(key => [key, integer((row.counts as Record<string, unknown>)[key])])) as SignalWorkspaceEmbeddingCountsV1;
  if (counts.completed_roots + counts.partial_roots + counts.pending_roots !== counts.eligible_roots
    || counts.processed_chunk_references > counts.total_chunk_references || counts.processed_asset_chunks > counts.total_asset_chunks
    || row.status === "completed" && (counts.completed_roots !== counts.eligible_roots
      || counts.processed_chunk_references !== counts.total_chunk_references || counts.processed_asset_chunks !== counts.total_asset_chunks)) {
    return fail("workspace_embedding_invalid_count", 503);
  }
  return { id: String(row.id), preparation_run_id: String(row.preparation_run_id), input_revision: integer(row.input_revision),
    status: row.status as SignalWorkspaceEmbeddingRunV1["status"], counts,
    hard_cap_micro_usd: integer(row.hard_cap_micro_usd), estimated_upper_micro_usd: integer(row.estimated_upper_micro_usd),
    reserved_micro_usd: integer(row.reserved_micro_usd), settled_micro_usd: integer(row.settled_micro_usd),
    unknown_reserved_micro_usd: integer(row.unknown_reserved_micro_usd), observed_exception_micro_usd: integer(row.observed_exception_micro_usd),
    error_code: row.error_code === null ? null : String(row.error_code),
    retryable: row.status === "failed" && retryableErrors.has(String(row.error_code)),
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
    completed_at: row.completed_at === null ? null : timestamp(row.completed_at) };
}

/** Constant-size status projection. No raw text, provider receipts, request keys or actor IDs leave this reader. */
export async function loadSignalWorkspaceEmbeddingsStoreV1(args: {
  queryable: SignalWorkspaceEmbeddingsQueryableV1; workspace_id: string;
  actor_user_id?: string; idempotency_key?: string;
}): Promise<SignalWorkspaceEmbeddingsStatusV1> {
  const result = await args.queryable.query<{
    observed_at: string; active_run: Record<string, unknown> | null; latest_run: Record<string, unknown> | null;
    latest_completed: Record<string, unknown> | null; request_run: Record<string, unknown> | null; is_current: boolean;
  }>(`WITH recent AS MATERIALIZED (
    SELECT run.id,run.preparation_run_id,run.input_revision,run.status,run.counts,run.error_code,
      run.hard_cap_micro_usd,run.estimated_upper_micro_usd,run.reserved_micro_usd,run.settled_micro_usd,
      run.unknown_reserved_micro_usd,run.observed_exception_micro_usd,run.policy_valid_until,run.config_digest,
      ($3::text IS NOT NULL AND run.request_keys->$3->>'actor_user_id'=$4) requested,
      to_char(run.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
      to_char(run.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') updated_at,
      to_char(run.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') completed_at
    FROM signal_workspace_embedding_runs run WHERE run.workspace_id=$1::uuid AND run.id IN (
      (SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT 1),
      (SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND config_digest=$2 AND status IN('queued','running') LIMIT 1),
      (SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND config_digest=$2 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1),
      (SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND $3::text IS NOT NULL
        AND request_keys->$3->>'actor_user_id'=$4 ORDER BY created_at DESC,id DESC LIMIT 1)
    )
  ), completed AS (SELECT * FROM recent WHERE status='completed' AND config_digest=$2 ORDER BY completed_at DESC,id DESC LIMIT 1)
  SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at,
    (SELECT to_jsonb(r) FROM recent r WHERE status IN('queued','running') AND config_digest=$2 LIMIT 1) active_run,
    (SELECT to_jsonb(r) FROM recent r ORDER BY created_at DESC,id DESC LIMIT 1) latest_run,
    (SELECT to_jsonb(r) FROM completed r) latest_completed,
    (SELECT to_jsonb(r) FROM recent r WHERE requested LIMIT 1) request_run,
    COALESCE((SELECT input_revision=state.input_revision AND (policy_valid_until IS NULL OR policy_valid_until>statement_timestamp()) FROM completed),false) is_current
  FROM signal_workspaces workspace LEFT JOIN signal_corpus_preparation_input_state state ON state.workspace_id=workspace.id
  WHERE workspace.id=$1::uuid`, [args.workspace_id, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest,
    args.idempotency_key ?? null, args.actor_user_id ?? null]);
  const row = result.rows[0];
  if (!row) return fail("workspace_embedding_workspace_unavailable", 404);
  return { contract_version: "signal-workspace-embeddings-v1", workspace_id: args.workspace_id,
    observed_at: timestamp(row.observed_at), active_run: runView(row.active_run), latest_run: runView(row.latest_run),
    latest_completed: runView(row.latest_completed), request_run: runView(row.request_run), is_current: row.is_current };
}

async function authorize(queryable: SignalWorkspaceEmbeddingsQueryableV1, workspace: string, actor: string, execute: boolean) {
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable, workspace_id: workspace, actor_user_id: actor });
  if (!capabilities.can_view || execute && !capabilities.can_execute_topics) return fail("workspace_embedding_forbidden", 403);
}

async function quote(queryable: SignalWorkspaceEmbeddingsQueryableV1, workspace: string,
  profile: SignalWorkspaceEmbeddingProfileV1, actor: string): Promise<SignalWorkspaceEmbeddingsQuoteV1> {
  assertSignalWorkspaceEmbeddingProfileV1(profile);
  // One MVCC statement: current revision, immutable manifest and cache coverage agree.
  // Partially cached assets use their whole byte length as a conservative bound;
  // no full corpus text is transferred to Node or sampled to derive the quote.
  const result = await queryable.query<Record<string, unknown>>(`WITH prepared AS MATERIALIZED (
    SELECT run.* FROM signal_corpus_preparation_runs run JOIN signal_corpus_preparation_input_state state USING(workspace_id)
    WHERE run.workspace_id=$1::uuid AND run.status='completed' AND run.input_revision=state.input_revision
      AND run.chunk_policy_version=$2 AND (run.policy_valid_until IS NULL OR run.policy_valid_until>statement_timestamp())
    ORDER BY run.completed_at DESC,run.id DESC LIMIT 1
  ), assets AS MATERIALIZED (
    SELECT item.asset_sha256,count(*) root_count FROM signal_corpus_preparation_items item JOIN prepared ON prepared.id=item.run_id
      WHERE item.disposition='eligible' GROUP BY item.asset_sha256
  ), sizes AS MATERIALIZED (
    SELECT assets.asset_sha256,assets.root_count,min(octet_length(text.full_text))::bigint full_text_bytes,
      count(*) chunk_count,count(cache.chunk_sha256) cached_count
    FROM assets JOIN signal_corpus_text_assets text ON text.workspace_id=$1::uuid AND text.text_sha256=assets.asset_sha256 AND text.chunk_policy_version=$2
    CROSS JOIN LATERAL jsonb_array_elements(text.chunks->'chunks') chunk
    LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$1::uuid AND cache.config_digest=$3 AND cache.chunk_sha256=chunk->>'sha256'
    GROUP BY assets.asset_sha256,assets.root_count
  ) SELECT prepared.id preparation_run_id,prepared.input_revision,
    to_char(prepared.policy_valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') policy_valid_until,
    to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at,
    COALESCE((SELECT sum(root_count) FROM sizes),0)::text eligible_roots,
    COALESCE((SELECT sum(root_count*chunk_count) FROM sizes),0)::text total_chunk_references,
    COALESCE((SELECT sum(chunk_count) FROM sizes),0)::text total_asset_chunks,
    COALESCE((SELECT sum(cached_count) FROM sizes),0)::text cached_asset_chunks,
    COALESCE((SELECT sum(full_text_bytes) FILTER(WHERE chunk_count>cached_count) FROM sizes),0)::text full_text_bytes
   ,(SELECT run.id FROM signal_workspace_embedding_runs run WHERE run.workspace_id=$1::uuid
      AND run.preparation_run_id=prepared.id AND run.input_revision=prepared.input_revision AND run.config_digest=$3
      AND run.actor_user_id=$4::uuid AND run.status='failed'
      AND run.error_code IN('workspace_embedding_worker_failed','workspace_embedding_queue_unavailable','workspace_embedding_definitely_not_sent')
      ORDER BY run.created_at DESC,run.id DESC LIMIT 1) resume_run_id,
    (SELECT run.hard_cap_micro_usd FROM signal_workspace_embedding_runs run WHERE run.workspace_id=$1::uuid
      AND run.preparation_run_id=prepared.id AND run.input_revision=prepared.input_revision AND run.config_digest=$3
      AND run.actor_user_id=$4::uuid AND run.status='failed'
      AND run.error_code IN('workspace_embedding_worker_failed','workspace_embedding_queue_unavailable','workspace_embedding_definitely_not_sent')
      ORDER BY run.created_at DESC,run.id DESC LIMIT 1) required_cap_micro_usd
  FROM prepared`, [workspace, profile.chunk_policy_version, profile.config_digest, actor]);
  const row = result.rows[0];
  if (!row) return fail("workspace_embedding_preparation_required");
  const eligible_roots = integer(row.eligible_roots), total_chunk_references = integer(row.total_chunk_references),
    total_asset_chunks = integer(row.total_asset_chunks), cached_asset_chunks = integer(row.cached_asset_chunks),
    full_text_bytes = integer(row.full_text_bytes), missing_asset_chunks = total_asset_chunks - cached_asset_chunks;
  if (!eligible_roots || !total_asset_chunks) return fail("workspace_embedding_empty_corpus");
  const cost = quoteSignalWorkspaceEmbeddingCostV1({ input_bytes: full_text_bytes, chunk_count: missing_asset_chunks });
  const sealed = { contract_version: "signal-workspace-embeddings-quote-v1" as const, workspace_id: workspace,
    preparation_run_id: String(row.preparation_run_id), input_revision: integer(row.input_revision), profile,
    eligible_roots, total_chunk_references, total_asset_chunks, cached_asset_chunks, missing_asset_chunks,
    full_text_bytes, tokens_upper: cost.token_upper_bound, estimated_upper_micro_usd: cost.estimated_max_cost_micro_usd,
    resume_run_id: row.resume_run_id === null ? null : String(row.resume_run_id),
    required_cap_micro_usd: row.required_cap_micro_usd === null ? null : integer(row.required_cap_micro_usd),
    policy_valid_until: row.policy_valid_until === null ? null : timestamp(row.policy_valid_until) };
  return { ...sealed, quote_digest: signalWorkspaceEmbeddingDigestV1(sealed), observed_at: timestamp(row.observed_at) };
}

export async function quoteSignalWorkspaceEmbeddingsStoreV1(args: {
  database: SignalWorkspaceEmbeddingsDatabaseV1; workspace_id: string; actor_user_id: string; profile: SignalWorkspaceEmbeddingProfileV1;
}) {
  await authorize(args.database, args.workspace_id, args.actor_user_id, false);
  return quote(args.database, args.workspace_id, args.profile, args.actor_user_id);
}

/** Durable intent only. The Worker owns provider transport and per-batch reservations. */
export async function requestSignalWorkspaceEmbeddingsStoreV1(args: {
  database: SignalWorkspaceEmbeddingsDatabaseV1; workspace_id: string; actor_user_id: string; idempotency_key: string;
  preparation_run_id: string; quote_digest: string; hard_cap_micro_usd: number; profile: SignalWorkspaceEmbeddingProfileV1;
}): Promise<{ run_id: string; replayed: boolean }> {
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)) return fail("workspace_embedding_idempotency_key_required", 400);
  if (!Number.isSafeInteger(args.hard_cap_micro_usd) || args.hard_cap_micro_usd < 0) return fail("workspace_embedding_budget_invalid", 422);
  assertSignalWorkspaceEmbeddingProfileV1(args.profile);
  const requestDigest = signalWorkspaceEmbeddingDigestV1({ preparation_run_id: args.preparation_run_id,
    quote_digest: args.quote_digest, hard_cap_micro_usd: args.hard_cap_micro_usd, profile: args.profile });
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    await authorize(client, args.workspace_id, args.actor_user_id, true);
    // Serialize only requests, not the input-state row held by import/rights writers.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`workspace-embedding-request:${args.workspace_id}`]);
    const replay = (await client.query<{ id: string; actor: string; digest: string }>(`SELECT id,
      request_keys->$2->>'actor_user_id' actor,request_keys->$2->>'request_digest' digest
      FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND request_keys ? $2 LIMIT 1`, [args.workspace_id, args.idempotency_key])).rows[0];
    if (replay) {
      if (replay.actor !== args.actor_user_id || replay.digest !== requestDigest) return fail("workspace_embedding_idempotency_conflict");
      await client.query("COMMIT"); return { run_id: replay.id, replayed: true };
    }
    const current = await quote(client, args.workspace_id, args.profile, args.actor_user_id);
    if (current.preparation_run_id !== args.preparation_run_id || current.quote_digest !== args.quote_digest) return fail("workspace_embedding_quote_changed");
    if (!current.resume_run_id && args.hard_cap_micro_usd < current.estimated_upper_micro_usd) return fail("workspace_embedding_budget_below_quote", 422);
    const active = (await client.query<{ id: string }>(`SELECT id FROM signal_workspace_embedding_runs
      WHERE workspace_id=$1::uuid AND config_digest=$2 AND status IN('queued','running') LIMIT 1`,
    [args.workspace_id, args.profile.config_digest])).rows[0];
    if (active) return fail("workspace_embedding_already_running");
    const unknown = (await client.query(`SELECT 1 FROM signal_workspace_embedding_calls
      WHERE workspace_id=$1::uuid AND config_digest=$2 AND status IN('in_flight','outcome_unknown') LIMIT 1`,
    [args.workspace_id, args.profile.config_digest])).rows.length > 0;
    if (unknown) return fail("workspace_embedding_outcome_unknown");
    if (current.resume_run_id) {
      if (args.hard_cap_micro_usd !== current.required_cap_micro_usd) return fail("workspace_embedding_resume_budget_changed", 422);
      const resumed = await client.query(`UPDATE signal_workspace_embedding_runs SET status='queued',error_code=NULL,completed_at=NULL,
        request_keys=request_keys||$2::jsonb,dispatch_generation=dispatch_generation+1,
        worker_job_id='workspace-embeddings-'||id::text||'-'||(dispatch_generation+1)::text,
        dispatch_status='pending',dispatch_token=NULL,dispatch_expires_at=NULL,dispatch_attempts=0,
        available_at=clock_timestamp(),execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp()
        WHERE id=$1::uuid AND status='failed' RETURNING id`, [current.resume_run_id,
        JSON.stringify({ [args.idempotency_key]: { actor_user_id: args.actor_user_id, request_digest: requestDigest } })]);
      if (!resumed.rows.length) return fail("workspace_embedding_quote_changed");
      await client.query("COMMIT"); return { run_id: current.resume_run_id, replayed: false };
    }
    const runId = randomUUID();
    const counts: SignalWorkspaceEmbeddingCountsV1 = { eligible_roots: current.eligible_roots,
      completed_roots: 0, partial_roots: 0, pending_roots: current.eligible_roots,
      total_chunk_references: current.total_chunk_references, processed_chunk_references: 0,
      total_asset_chunks: current.total_asset_chunks, processed_asset_chunks: 0, cache_hits: 0, embedded_unique_chunks: 0 };
    await client.query(`INSERT INTO signal_workspace_embedding_runs(id,workspace_id,preparation_run_id,actor_user_id,input_revision,
      policy_valid_until,profile,config_digest,quote_digest,request_keys,hard_cap_micro_usd,estimated_upper_micro_usd,counts,worker_job_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::timestamptz,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14)`,
    [runId, args.workspace_id, current.preparation_run_id, args.actor_user_id, current.input_revision, current.policy_valid_until,
      JSON.stringify(args.profile), args.profile.config_digest, current.quote_digest,
      JSON.stringify({ [args.idempotency_key]: { actor_user_id: args.actor_user_id, request_digest: requestDigest } }),
      args.hard_cap_micro_usd, current.estimated_upper_micro_usd, JSON.stringify(counts), `workspace-embeddings-${runId}-1`]);
    await client.query("COMMIT"); return { run_id: runId, replayed: false };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
