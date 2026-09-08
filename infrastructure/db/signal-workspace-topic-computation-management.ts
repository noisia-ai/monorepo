import { createHash } from "node:crypto";
import {
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  type SignalWorkspaceTopicSearchEvidenceV1
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import {
  loadSignalWorkspaceTopicInputSnapshotV1,
  SignalWorkspaceTopicComputationError,
  type SignalWorkspaceTopicDatabaseV1,
  type SignalWorkspaceTopicQueryableV1
} from "./signal-workspace-topic-computation";

const fail = (code: string, status = 409): never => { throw new SignalWorkspaceTopicComputationError(code, status); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
function count(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return fail("workspace_topic_count_invalid", 503);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return fail("workspace_topic_count_invalid", 503);
  return number;
}
function time(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)) return value;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) return fail("workspace_topic_time_invalid", 503);
  return parsed.toISOString().replace(/Z$/u, "000Z");
}
export type SignalWorkspaceTopicComputationRunViewV1 = {
  id: string; status: "queued" | "running" | "ready" | "failed"; progress: number;
  denominator: number; processed_roots: number; expected_chunks: number; processed_chunks: number;
  evaluated_topic_pairs: number; retained_candidate_pairs: number; omitted_candidate_pairs: number;
  error_code: string | null; created_at: string; completed_at: string | null;
};
export type SignalWorkspaceTopicComputationStatusViewV1 = {
  contract_version: "signal-workspace-topic-search-v1"; mode: "workspace" | "legacy";
  workspace_id: string; can_execute: boolean; request_scope: string; observed_at: string;
  preflight: { state: "ready" | "missing_embeddings" | "missing_prototypes" | "needs_preparation" | "awaiting_import" | "awaiting_topics";
    embedding_run_id: string | null; missing_prototypes: number | null };
  active_run: SignalWorkspaceTopicComputationRunViewV1 | null;
  latest_run: SignalWorkspaceTopicComputationRunViewV1 | null;
  latest_ready: SignalWorkspaceTopicComputationRunViewV1 | null;
  request_run: SignalWorkspaceTopicComputationRunViewV1 | null; is_current: boolean;
};
type RunRow = Record<string, unknown> & { id: string; taxonomy_profile_id: string;
  input_revision: string; policy_live: boolean; context_digest: string; definition_digest: string };
function runView(row: RunRow | undefined): SignalWorkspaceTopicComputationRunViewV1 | null {
  if (!row) return null;
  if (!["queued", "running", "ready", "failed"].includes(String(row.status))) return fail("workspace_topic_state_invalid", 503);
  const summary = row.result_summary && typeof row.result_summary === "object" ? row.result_summary as Record<string, unknown> : {};
  const view = { id: row.id, status: row.status as SignalWorkspaceTopicComputationRunViewV1["status"],
    progress: count(row.progress), denominator: count(row.denominator), processed_roots: count(row.processed_roots),
    expected_chunks: count(row.expected_chunks), processed_chunks: count(row.processed_chunks),
    evaluated_topic_pairs: count(summary.evaluated_topic_count ?? 0),
    retained_candidate_pairs: count(summary.retained_candidate_count ?? 0),
    omitted_candidate_pairs: count(summary.omitted_candidate_count ?? 0),
    error_code: typeof row.error_code === "string" ? row.error_code : null,
    created_at: time(row.created_at), completed_at: row.completed_at ? time(row.completed_at) : null };
  if (view.progress > 100 || view.processed_roots > view.denominator || view.processed_chunks > view.expected_chunks
    || view.status === "ready" && (view.processed_roots !== view.denominator || view.processed_chunks !== view.expected_chunks)) {
    return fail("workspace_topic_count_invalid", 503);
  }
  return view;
}

/** A preparation snapshot selects the workspace path; SQL0132's seeded state alone does not. */
export async function isSignalWorkspaceTopicSearchModeV1(queryable: SignalWorkspaceTopicQueryableV1, workspaceId: string) {
  const row = (await queryable.query<{ workspace_mode: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM signal_corpus_preparation_runs WHERE workspace_id=$1::uuid)
    OR NOT EXISTS(SELECT 1 FROM signal_workspace_corpora WHERE workspace_id=$1::uuid AND role='operational' AND valid_to IS NULL) workspace_mode`, [workspaceId])).rows[0];
  return row?.workspace_mode === true;
}

async function access(queryable: SignalWorkspaceTopicQueryableV1, workspaceId: string, actorId: string) {
  const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable, workspace_id: workspaceId, actor_user_id: actorId });
  if (!caps.can_view) return fail("workspace_topic_forbidden", 403);
  return caps;
}

export async function loadSignalWorkspaceTopicComputationStatusV1(args: {
  database: SignalWorkspaceTopicDatabaseV1; workspace_id: string; actor_user_id: string; idempotency_key?: string;
}): Promise<SignalWorkspaceTopicComputationStatusViewV1> {
  const caps = await access(args.database, args.workspace_id, args.actor_user_id);
  const mode = await isSignalWorkspaceTopicSearchModeV1(args.database, args.workspace_id) ? "workspace" : "legacy";
  const state = (await args.database.query<{ input_revision: string | null; has_mentions: boolean;
    prepared: boolean; embedding_run_id: string | null; observed_at: string }>(`SELECT state.input_revision::text,
    EXISTS(SELECT 1 FROM mentions WHERE workspace_id=workspace.id LIMIT 1) has_mentions,
    EXISTS(SELECT 1 FROM signal_corpus_preparation_runs prep WHERE prep.workspace_id=workspace.id
      AND prep.status='completed' AND prep.input_revision=state.input_revision
      AND (prep.policy_valid_until IS NULL OR prep.policy_valid_until>clock_timestamp())) prepared,
    (SELECT run.id::text FROM signal_workspace_embedding_runs run WHERE run.workspace_id=workspace.id
      AND run.status='completed' AND run.input_revision=state.input_revision AND run.config_digest=$2
      AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())
      ORDER BY run.completed_at DESC,run.id DESC LIMIT 1) embedding_run_id,
      to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at
    FROM signal_workspaces workspace LEFT JOIN signal_corpus_preparation_input_state state ON state.workspace_id=workspace.id
    WHERE workspace.id=$1::uuid`, [args.workspace_id, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest])).rows[0];
  if (!state) return fail("workspace_topic_workspace_unavailable", 404);
  const rows = (await args.database.query<RunRow>(`WITH selected AS(
    (SELECT id FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-computation-v1' ORDER BY created_at DESC,id DESC LIMIT 1)
    UNION (SELECT id FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-computation-v1' AND status IN('queued','running') ORDER BY created_at DESC,id DESC LIMIT 1)
    UNION (SELECT id FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-computation-v1' AND status='ready' ORDER BY completed_at DESC,id DESC LIMIT 1)
    UNION (SELECT id FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-computation-v1'
      AND actor_user_id=$2::uuid AND idempotency_key=$3 LIMIT 1)
  ) SELECT run.id::text,run.taxonomy_profile_id::text,run.status,run.progress,run.denominator,run.processed_roots,
    run.expected_chunks::text,run.processed_chunks::text,run.result_summary,run.error_code,run.created_at,run.completed_at,
    run.input_revision::text,(run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp()) policy_live,
    run.input_snapshot->>'context_digest' context_digest,run.definition_digest,
    run.actor_user_id=$2::uuid AND run.idempotency_key=$3 requested
    FROM signal_topic_catalog_executions run JOIN selected USING(id) ORDER BY run.created_at DESC,run.id DESC`,
    [args.workspace_id, args.actor_user_id, args.idempotency_key ?? null])).rows;
  const ready = rows.filter(row => row.status === "ready").sort((a, b) => time(b.completed_at).localeCompare(time(a.completed_at)))[0];
  let isCurrent = Boolean(ready && ready.input_revision === state.input_revision && ready.policy_live);
  let preflight: SignalWorkspaceTopicComputationStatusViewV1["preflight"] = {
    state: !state.has_mentions ? "awaiting_import" : !state.prepared ? "needs_preparation" : "missing_embeddings",
    embedding_run_id: state.embedding_run_id, missing_prototypes: null
  };
  // Compilation is read-only. It is only needed after full document embeddings exist,
  // or to assess freshness of an earlier completed search. Never return its private text.
  if (mode === "workspace" && (state.embedding_run_id || isCurrent)) {
    try {
      const built = await loadSignalWorkspaceTopicInputSnapshotV1(args);
      isCurrent = isCurrent && ready?.taxonomy_profile_id === built.profile_id
        && ready.context_digest === built.input.context_digest && ready.definition_digest === built.input.definition_digest;
      if (state.embedding_run_id) {
        const inputs = built.input.topics.flatMap(topic => topic.compiled.inputs.map(input => ({ digest: input.input_digest, sha: input.text_sha256 })));
        const missing = count((await args.database.query<{ missing: string }>(`SELECT count(*)::text missing
          FROM jsonb_to_recordset($2::jsonb) expected(digest text,sha text)
          LEFT JOIN signal_topic_definition_embeddings cache ON cache.workspace_id=$1::uuid
            AND cache.definition_digest=expected.digest AND cache.input_text_sha256=expected.sha
            AND cache.embedding_config_digest=$3 AND cache.embedding_model=$4 AND cache.provider=$5
          WHERE cache.id IS NULL`, [args.workspace_id, JSON.stringify(inputs), SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest,
          SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.model, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.provider])).rows[0]!.missing);
        preflight = { state: missing ? "missing_prototypes" : "ready", missing_prototypes: missing, embedding_run_id: state.embedding_run_id };
      }
    } catch (error) {
      if (error instanceof SignalWorkspaceTopicComputationError && ["workspace_topic_catalog_empty", "workspace_topic_catalog_required"].includes(error.code)) {
        preflight = { ...preflight, state: "awaiting_topics" }; isCurrent = false;
      } else throw error;
    }
  }
  return { contract_version: "signal-workspace-topic-search-v1", mode, workspace_id: args.workspace_id,
    can_execute: caps.can_execute_topics, request_scope: hash(JSON.stringify(["workspace-topic-search-v1", args.workspace_id, args.actor_user_id])),
    observed_at: time(state.observed_at), preflight, active_run: runView(rows.find(row => row.status === "queued" || row.status === "running")),
    latest_run: runView(rows[0]), latest_ready: runView(ready), request_run: runView(rows.find(row => row.requested === true)), is_current: isCurrent };
}

export function decodeSignalWorkspaceTopicResultCursorV1(value?: string): { score: number; root_id: string } | null {
  if (value === undefined) return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) return fail("workspace_topic_cursor_invalid", 422);
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (Object.keys(parsed).sort().join(",") !== "root_id,score" || typeof parsed.score !== "number"
      || !Number.isFinite(parsed.score) || parsed.score < -2 || parsed.score > 1 || typeof parsed.root_id !== "string" || !uuid.test(parsed.root_id)) {
      return fail("workspace_topic_cursor_invalid", 422);
    }
    return { score: parsed.score, root_id: parsed.root_id };
  } catch { return fail("workspace_topic_cursor_invalid", 422); }
}

export async function loadSignalWorkspaceTopicComputationResultsV1(args: {
  database: SignalWorkspaceTopicDatabaseV1; workspace_id: string; actor_user_id: string;
  execution_id: string; term_key: string; cursor?: string;
}) {
  if (!uuid.test(args.execution_id) || !/^[a-z][a-z0-9_]{0,79}$/u.test(args.term_key)) return fail("workspace_topic_result_request_invalid", 422);
  const cursor = decodeSignalWorkspaceTopicResultCursorV1(args.cursor);
  await access(args.database, args.workspace_id, args.actor_user_id);
  const run = (await args.database.query<{ preparation_run_id: string; input_revision: string; policy_live: boolean; current_revision: string }>(`
    SELECT run.preparation_run_id::text,run.input_revision::text,state.input_revision::text current_revision,
      (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp()) policy_live
    FROM signal_topic_catalog_executions run JOIN signal_corpus_preparation_input_state state USING(workspace_id)
    WHERE run.id=$1::uuid AND run.workspace_id=$2::uuid AND run.input_contract='workspace-topic-computation-v1' AND run.status='ready'`,
    [args.execution_id, args.workspace_id])).rows[0];
  if (!run) return fail("workspace_topic_result_unavailable", 404);
  if (!run.policy_live || run.input_revision !== run.current_revision) return fail("workspace_topic_evidence_stale", 409);
  const rows = (await args.database.query<{ root_id: string; semantic_score: string; negative_semantic_score: string | null;
    ranking_score: number; evidence: SignalWorkspaceTopicSearchEvidenceV1; authorized_scope: boolean }>(`
    SELECT suggestion.canonical_root_id::text root_id,suggestion.semantic_score::text,suggestion.negative_semantic_score::text,
      (suggestion.computation_evidence->>'ranking_score')::double precision ranking_score,
      suggestion.computation_evidence evidence,(item.computation_evidence->>'semantic_scope_available')::boolean authorized_scope
    FROM signal_topic_classification_suggestions suggestion JOIN signal_topic_classification_items item
      ON item.execution_id=suggestion.execution_id AND item.canonical_root_id=suggestion.canonical_root_id AND item.workspace_id=suggestion.workspace_id
    WHERE suggestion.execution_id=$1::uuid AND suggestion.workspace_id=$2::uuid AND suggestion.term_key=$3
      AND ($4::double precision IS NULL OR (suggestion.computation_evidence->>'ranking_score')::double precision<$4
        OR ((suggestion.computation_evidence->>'ranking_score')::double precision=$4 AND suggestion.canonical_root_id>$5::uuid))
    ORDER BY (suggestion.computation_evidence->>'ranking_score')::double precision DESC,suggestion.canonical_root_id LIMIT 26`,
    [args.execution_id, args.workspace_id, args.term_key, cursor?.score ?? null, cursor?.root_id ?? null])).rows;
  const items = [];
  // Extract only the referenced fragment in SQL. Its helper converts UTF-16 offsets
  // exactly, including emoji, without transferring an arbitrarily large asset to Node.
  for (const row of rows.slice(0, 25)) {
    const best = row.evidence.best_chunk;
    if (!Number.isSafeInteger(best.start) || !Number.isSafeInteger(best.end) || best.start < 0 || best.end <= best.start
      || best.end - best.start > 1400) return fail("workspace_topic_evidence_invalid", 503);
    const asset = (await args.database.query<{ excerpt: string }>(`SELECT signal_topic_utf16_fragment_v1(asset.full_text,$6::int,$7::int) excerpt
      FROM signal_corpus_preparation_items item JOIN signal_corpus_text_assets asset
        ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      JOIN signal_corpus_preparation_input_state state ON state.workspace_id=item.workspace_id AND state.input_revision=$4::bigint
      JOIN signal_topic_catalog_executions execution ON execution.id=$5::uuid AND execution.workspace_id=item.workspace_id
      WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.root_id=$3::uuid AND item.disposition='eligible'
        AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp())`,
      [run.preparation_run_id, args.workspace_id, row.root_id, run.input_revision, args.execution_id, best.start, best.end])).rows[0];
    if (!asset) return fail("workspace_topic_evidence_stale", 409);
    const excerpt = asset.excerpt;
    if (hash(excerpt) !== best.chunk_sha256) return fail("workspace_topic_evidence_invalid", 503);
    items.push({ root_id: row.root_id, text_excerpt: excerpt, scope_status: row.authorized_scope ? "authorized" as const : "unknown" as const,
      semantic_score: Number(row.semantic_score), negative_semantic_score: row.negative_semantic_score === null ? null : Number(row.negative_semantic_score),
      ranking_score: row.ranking_score, evidence: row.evidence });
  }
  await access(args.database, args.workspace_id, args.actor_user_id);
  const stillCurrent = (await args.database.query<{ valid: boolean }>(`SELECT EXISTS(
    SELECT 1 FROM signal_topic_catalog_executions run JOIN signal_corpus_preparation_input_state state USING(workspace_id)
    WHERE run.id=$1::uuid AND run.workspace_id=$2::uuid AND run.status='ready'
      AND run.input_revision=state.input_revision AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())) valid`,
    [args.execution_id, args.workspace_id])).rows[0]?.valid;
  if (!stillCurrent) return fail("workspace_topic_evidence_stale", 409);
  const last = rows.length > 25 ? items.at(-1) : null;
  return { execution_id: args.execution_id, items,
    next_cursor: last ? Buffer.from(JSON.stringify({ score: last.ranking_score, root_id: last.root_id })).toString("base64url") : null };
}
