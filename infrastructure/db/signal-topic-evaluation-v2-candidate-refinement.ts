import { randomUUID } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT,
  SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS,
  parseSignalTopicCandidateRefinementNavigationRequestV1,
  parseSignalTopicCandidateRefinementProposalV1,
  parseSignalTopicCandidateRefinementSessionStartV1,
  signalTopicEvaluationDigestV2,
  type SignalTopicCandidateRefinementNavigationRequestV1,
  type SignalTopicCandidateRefinementProposalV1
} from "@noisia/query-engine";

import {
  SignalTopicEvaluationV2Error,
  navigateSignalTopicEvaluationEvidenceV2,
  type SignalTopicEvaluationActorV2
} from "./signal-topic-evaluation-v2";

type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
  rows: T[]; rowCount: number | null }> };
type TransactionClient = Queryable & { release(): void };

type CandidateSessionRow = {
  id: string;
  session_key: string;
  workspace_id: string;
  run_id: string;
  run_key: string;
  snapshot_id: string;
  candidate_id: string;
  base_model_revision_id: string;
  candidate_editorial_revision_id: string | null;
  candidate_key: string;
  actor_user_id: string;
  candidate_revision: number;
  candidate_version_digest: string;
  candidate_state_token: string;
  brand_os_authority_digest: string;
  source_cluster_keys: string[];
  start_input_digest: string;
  expires_at: string;
  session_digest: string;
  trace_count: number;
  title: string;
  description: string;
  inclusion: unknown;
  exclusion: unknown;
};

type CandidateForSessionRow = Omit<CandidateSessionRow, "id" | "session_key" | "actor_user_id" |
  "expires_at" | "session_digest" | "start_input_digest" | "trace_count">;

export type SignalTopicCandidateRefinementSessionV1 = {
  contract_version: typeof SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT;
  session_key: string;
  run_key: string;
  candidate_key: string;
  candidate_revision: number;
  expires_at: string;
  navigation_calls_remaining: number;
  provider_calls_allowed: 0;
  topic_adoption: false;
  publication: false;
  serving: false;
};

function assertActor(actor: SignalTopicEvaluationActorV2) {
  if (actor.user_type !== "noisia_internal" || !actor.id) {
    throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_forbidden", 403);
  }
}

/** Opens no provider edge. The session freezes one ordinary pending candidate as the sole
 * evidence-navigation authority for a later proposal-only refinement run. */
export async function createSignalTopicCandidateRefinementSessionV1(args: {
  pool: { connect(): Promise<TransactionClient> };
  workspace_id: string;
  actor: SignalTopicEvaluationActorV2;
  idempotency_key: string;
  input: unknown;
}): Promise<SignalTopicCandidateRefinementSessionV1> {
  assertActor(args.actor);
  const input = parseSignalTopicCandidateRefinementSessionStartV1(args.input);
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)) {
    throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_idempotency_invalid", 422);
  }
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`topic-candidate-refinement:${args.workspace_id}:${input.run_key}:${input.candidate_key}`]);
    const startInputDigest = await refinementStartInputDigest(client, input);
    const replay = (await client.query<CandidateSessionRow>(`${sessionSelectSql()}
      WHERE session.workspace_id=$1::uuid AND session.idempotency_key=$2`,
    [args.workspace_id, args.idempotency_key])).rows[0];
    if (replay) {
      if (replay.actor_user_id !== args.actor.id || replay.start_input_digest !== startInputDigest) {
        throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_idempotency_conflict", 409);
      }
      await client.query("COMMIT");
      return projectSession(replay);
    }
    const candidate = (await client.query<CandidateForSessionRow>(`${candidateSelectSql()}
      AND candidate.workspace_id=$1::uuid AND run.run_key=$2 AND candidate.candidate_key=$3`,
    [args.workspace_id, input.run_key, input.candidate_key])).rows[0];
    if (!candidate || candidate.candidate_revision !== input.expected_revision
        || candidate.candidate_state_token !== input.state_token) {
      throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_candidate_stale", 409);
    }
    const id = randomUUID();
    const sessionKey = `topic-refine-${signalTopicEvaluationDigestV2({ workspace_id: args.workspace_id,
      candidate_key: candidate.candidate_key, idempotency_key: args.idempotency_key,
      candidate_version_digest: candidate.candidate_version_digest }).slice(7, 23)}`;
    const inserted = (await client.query<{ session_digest: string; expires_at: string }>(`WITH seal AS (
        SELECT clock_timestamp() created_at
      ) INSERT INTO
      signal_topic_evaluation_v2_candidate_refinement_sessions(
        id,workspace_id,run_id,snapshot_id,candidate_id,base_model_revision_id,
        candidate_editorial_revision_id,candidate_revision,candidate_state_token,
        candidate_version_digest,brand_os_authority_digest,actor_user_id,source_cluster_keys,
        idempotency_key,start_input_digest,session_key,expires_at,session_digest,created_at
      ) SELECT
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,
        $12::uuid,$13::text[],$14,$15,$16,seal.created_at+interval '15 minutes',
        signal_topic_evaluation_v2_candidate_refinement_session_digest_v1(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,
          $12::uuid,$13::text[],$14,seal.created_at+interval '15 minutes'
        ),seal.created_at
      FROM seal RETURNING session_digest,expires_at::text`, [id, args.workspace_id, candidate.run_id, candidate.snapshot_id,
      candidate.candidate_id, candidate.base_model_revision_id, candidate.candidate_editorial_revision_id,
      candidate.candidate_revision, candidate.candidate_state_token, candidate.candidate_version_digest,
      candidate.brand_os_authority_digest, args.actor.id, candidate.source_cluster_keys,
      args.idempotency_key, startInputDigest, sessionKey])).rows[0];
    if (!inserted) throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_session_write_failed", 500);
    await client.query("COMMIT");
    return projectSession({ ...candidate, id, session_key: sessionKey, actor_user_id: args.actor.id,
      start_input_digest: startInputDigest, trace_count: 0, expires_at: inserted.expires_at,
      session_digest: inserted.session_digest });
  } catch (error) {
    await rollbackSafely(client);
    throw mapRefinementError(error);
  } finally { client.release(); }
}

/** Reads one sealed session, wraps the snapshot navigation primitives and records an append-only
 * trace. It is provider-neutral: callers receive a sanitized result but no model is constructed. */
export async function navigateSignalTopicCandidateRefinementV1(args: {
  pool: { connect(): Promise<TransactionClient> };
  workspace_id: string;
  actor: SignalTopicEvaluationActorV2;
  session_key: string;
  request: unknown;
  now?: Date;
}) {
  assertActor(args.actor);
  const request = parseSignalTopicCandidateRefinementNavigationRequestV1(args.request);
  const now = args.now ?? new Date();
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`topic-candidate-refinement-session:${args.workspace_id}:${args.session_key}`]);
    const session = await loadLockedSession(client, args.workspace_id, args.actor.id, args.session_key, now);
    const result = request.operation === "candidate_context"
      ? await candidateContextResult(client, session)
      : await refinementNavigationResult(client, session, request, now);
    const evidenceRefs = request.operation === "candidate_context" ? [] : [...result.evidence_refs].sort();
    const resultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (resultBytes > SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS.max_tool_result_bytes) {
      throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_result_too_large", 409);
    }
    const usedBytes = (await client.query<{ total_bytes: number }>(`SELECT
      COALESCE(sum(result_bytes),0)::int total_bytes
      FROM signal_topic_evaluation_v2_candidate_refinement_navigation_traces WHERE session_id=$1::uuid`,
    [session.id])).rows[0]?.total_bytes ?? 0;
    assertRefinementResultBudget(usedBytes, resultBytes);
    const previousTrace = (await client.query<{ trace_index: number }>(`SELECT trace_index
      FROM signal_topic_evaluation_v2_candidate_refinement_navigation_traces
      WHERE session_id=$1::uuid ORDER BY trace_index DESC LIMIT 1`, [session.id])).rows[0];
    const traceIndex = (previousTrace?.trace_index ?? -1) + 1;
    if (traceIndex >= SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS.max_navigation_calls) {
      throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_navigation_limit_reached", 409);
    }
    const traceRequest = request.operation === "brand_os_context"
      ? { operation: "brand_os_context" } : request;
    const cursor = request.operation === "search_cluster" ? request.cursor : null;
    const cursorDigest = cursor ? signalTopicEvaluationDigestV2({ cursor }) : null;
    const cursorContextDigest = cursor ? await refinementCursorContextDigest(client, session,
      request.operation === "search_cluster" ? request.cluster_key : "", request.operation === "search_cluster"
        ? request.filters : {}) : null;
    await client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_refinement_navigation_traces(
      id,session_id,workspace_id,run_id,snapshot_id,candidate_id,trace_index,operation,request,
      request_digest,result_digest,result_bytes,evidence_refs,cursor_digest,cursor_context_digest
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9::jsonb,$10,$11,$12,
      $13::text[],$14,$15)`, [randomUUID(), session.id, session.workspace_id, session.run_id,
      session.snapshot_id, session.candidate_id, traceIndex, request.operation, JSON.stringify(traceRequest),
      signalTopicEvaluationDigestV2(traceRequest), result.result_digest, resultBytes, evidenceRefs,
      cursorDigest, cursorContextDigest]);
    await client.query("COMMIT");
    return { contract_version: SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT,
      session_key: session.session_key, operation: request.operation, result, navigation_index: traceIndex,
      provider_calls_allowed: 0 as const, topic_adoption: false as const, publication: false as const,
      serving: false as const };
  } catch (error) {
    await rollbackSafely(client);
    throw mapRefinementError(error);
  } finally { client.release(); }
}

/** Appends a proposal only. It deliberately has no path to the candidate editorial tables. */
export async function appendSignalTopicCandidateRefinementProposalV1(args: {
  pool: { connect(): Promise<TransactionClient> };
  workspace_id: string;
  actor: SignalTopicEvaluationActorV2;
  session_key: string;
  idempotency_key: string;
  proposal: unknown;
  now?: Date;
}) {
  assertActor(args.actor);
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)) {
    throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_idempotency_invalid", 422);
  }
  const parsedProposal = parseSignalTopicCandidateRefinementProposalV1(args.proposal);
  const proposal = { ...parsedProposal,
    evidence_refs: [...parsedProposal.evidence_refs].sort(),
    related_candidate_keys: [...parsedProposal.related_candidate_keys].sort() };
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`topic-candidate-refinement-session:${args.workspace_id}:${args.session_key}`]);
    const session = await loadLockedSession(client, args.workspace_id, args.actor.id, args.session_key,
      args.now ?? new Date());
    const proposalDigest = await refinementProposalDigest(client, session, proposal);
    const replay = (await client.query<{ proposal_digest: string; idempotency_key: string }>(`SELECT
      proposal_digest,idempotency_key
      FROM signal_topic_evaluation_v2_candidate_refinement_proposals
      WHERE session_id=$1::uuid`, [session.id])).rows[0];
    if (replay) {
      if (replay.idempotency_key !== args.idempotency_key || replay.proposal_digest !== proposalDigest) {
        throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_proposal_already_exists", 409);
      }
      await client.query("COMMIT");
      return proposalResponse(session, replay.proposal_digest, true);
    }
    const traced = (await client.query<{ evidence_ref: string }>(`SELECT DISTINCT evidence_ref
      FROM signal_topic_evaluation_v2_candidate_refinement_navigation_traces trace
      CROSS JOIN LATERAL unnest(trace.evidence_refs) evidence_ref
      WHERE trace.session_id=$1::uuid`, [session.id])).rows.map((row) => row.evidence_ref);
    if (proposal.evidence_refs.some((ref) => !traced.includes(ref))) {
      throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_evidence_untraced", 409);
    }
    if (proposal.related_candidate_keys.includes(session.candidate_key)) {
      throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_related_self_invalid", 422);
    }
    if (proposal.related_candidate_keys.length) {
      const related = (await client.query<{ candidate_key: string }>(`SELECT candidate_key
        FROM signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid
          AND candidate_key=ANY($2::text[])`, [session.run_id, proposal.related_candidate_keys])).rows;
      if (related.length !== proposal.related_candidate_keys.length) {
        throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_related_candidate_invalid", 409);
      }
    }
    await client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_refinement_proposals(
      id,session_id,workspace_id,run_id,snapshot_id,candidate_id,display_name,description,evidence_refs,
      related_candidate_keys,recommendation,rationale,idempotency_key,proposal_digest
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9::text[],$10::text[],$11,$12,$13,$14)`,
    [randomUUID(), session.id, session.workspace_id, session.run_id, session.snapshot_id,
      session.candidate_id, proposal.display_name, proposal.description, proposal.evidence_refs,
      proposal.related_candidate_keys, proposal.recommendation, proposal.rationale, args.idempotency_key,
      proposalDigest]);
    await client.query("COMMIT");
    return proposalResponse(session, proposalDigest, false);
  } catch (error) {
    await rollbackSafely(client);
    throw mapRefinementError(error);
  } finally { client.release(); }
}

async function loadLockedSession(queryable: Queryable, workspaceId: string, actorId: string,
  sessionKey: string, now: Date): Promise<CandidateSessionRow> {
  const session = (await queryable.query<CandidateSessionRow>(`${sessionSelectSql()}
    WHERE session.workspace_id=$1::uuid AND session.actor_user_id=$2::uuid AND session.session_key=$3
    `, [workspaceId, actorId, sessionKey])).rows[0];
  if (!session) throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_session_not_found", 404);
  if (new Date(session.expires_at).getTime() <= now.getTime()) {
    throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_session_expired", 409);
  }
  const current = (await queryable.query<CandidateForSessionRow>(`${candidateSelectSql()}
    AND candidate.id=$1::uuid`, [session.candidate_id])).rows[0];
  if (!current || current.workspace_id !== session.workspace_id || current.run_id !== session.run_id
      || current.snapshot_id !== session.snapshot_id || current.candidate_revision !== session.candidate_revision
      || current.candidate_version_digest !== session.candidate_version_digest
      || current.candidate_state_token !== session.candidate_state_token
      || current.brand_os_authority_digest !== session.brand_os_authority_digest
      || JSON.stringify(current.source_cluster_keys) !== JSON.stringify(session.source_cluster_keys)) {
    throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_session_stale", 409);
  }
  return session;
}

async function candidateContextResult(queryable: Queryable, session: CandidateSessionRow) {
  const evidence = (await queryable.query<{ evidence_ref: string }>(`SELECT evidence_ref
    FROM signal_topic_evaluation_v2_candidate_evidence WHERE candidate_id=$1::uuid ORDER BY evidence_ref`,
  [session.candidate_id])).rows.map((row) => row.evidence_ref);
  const data = { candidate_key: session.candidate_key, revision: session.candidate_revision,
    state_token: session.candidate_state_token, title: session.title, description: session.description,
    inclusion: session.inclusion, exclusion: session.exclusion,
    source_cluster_keys: session.source_cluster_keys, evidence_refs: evidence };
  const resultWithoutDigest = { contract_version: SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT,
    operation: "candidate_context" as const, evidence_refs: evidence, next_cursor: null, data };
  return { ...resultWithoutDigest, result_digest: signalTopicEvaluationDigestV2(resultWithoutDigest) };
}

async function refinementNavigationResult(queryable: Queryable, session: CandidateSessionRow,
  request: Exclude<SignalTopicCandidateRefinementNavigationRequestV1, { operation: "candidate_context" }>,
  now: Date) {
  const mapped = await mapRefinementRequest(queryable, session, request, now);
  const result = await navigateSignalTopicEvaluationEvidenceV2({ queryable, workspace_id: session.workspace_id,
    actor: { id: session.actor_user_id, user_type: "noisia_internal" }, request: mapped.request });
  let nextCursor: string | null = null;
  if (result.operation === "search_cluster" && result.next_cursor) {
    if (!mapped.filter_digest) throw new SignalTopicEvaluationV2Error(
      "topic_candidate_refinement_cursor_state_invalid", 500);
    nextCursor = encodeRefinementCursor(session, mapped.filter_digest, result.next_cursor);
  }
  return { ...result, next_cursor: nextCursor };
}

async function mapRefinementRequest(queryable: Queryable, session: CandidateSessionRow,
  request: Exclude<SignalTopicCandidateRefinementNavigationRequestV1, { operation: "candidate_context" }>,
  now: Date) {
  const assertAllowed = (clusterKey: string) => {
    if (!session.source_cluster_keys.includes(clusterKey)) {
      throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_cluster_forbidden", 403);
    }
  };
  if (request.operation === "cluster_profile") {
    assertAllowed(request.cluster_key);
    return { request, filter_digest: null };
  }
  if (request.operation === "representative_mentions") {
    assertAllowed(request.cluster_key);
    return { request, filter_digest: signalTopicEvaluationDigestV2({ cluster_key: request.cluster_key,
      filters: request.filters }) };
  }
  if (request.operation === "compare_clusters") {
    request.cluster_keys.forEach(assertAllowed);
    return { request, filter_digest: null };
  }
  if (request.operation === "brand_os_context") {
    const rows = (await queryable.query<{ element_key: string }>(`SELECT element.element_key
      FROM signal_semantic_context_element_versions element
      JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=$1::uuid
      WHERE element.generation_id=snapshot.semantic_context_generation_id
        AND element.workspace_id=$2::uuid AND element.disposition='approved'
        AND element.lifecycle_state='active'
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
          WHERE successor.supersedes_element_id=element.id)
        AND position(lower(element.display_text) in lower($3))>0
      ORDER BY element.element_key LIMIT 40`, [session.snapshot_id, session.workspace_id,
      `${session.title}\n${session.description}\n${JSON.stringify(session.inclusion)}`])).rows;
    if (!rows.length) throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_brand_os_unavailable", 409);
    return { request: { operation: "brand_os_context" as const, element_keys: rows.map((row) => row.element_key) },
      filter_digest: null };
  }
  assertAllowed(request.cluster_key);
  const filterDigest = signalTopicEvaluationDigestV2({ cluster_key: request.cluster_key, filters: request.filters });
  const cursor = request.cursor ? decodeRefinementCursor(session, filterDigest, request.cursor, now) : null;
  return { request: { ...request, cursor }, filter_digest: filterDigest };
}

function encodeRefinementCursor(session: CandidateSessionRow, filterDigest: string, innerCursor: string) {
  const payload = { session_key: session.session_key, filter_digest: filterDigest, inner_cursor: innerCursor,
    expires_at: session.expires_at };
  // Do not base64-wrap the already base64-encoded cursor and duplicate all scope metadata.
  // The signature binds that metadata; compact only the existing signed inner JSON. This fits
  // the unchanged 512-character API/DB trace bound without weakening either cursor's scope.
  const compact = deflateRawSync(Buffer.from(innerCursor, "base64url")).toString("base64url");
  const signature = signalTopicEvaluationDigestV2({ payload, session_digest: session.session_digest }).slice(7);
  const cursor = `v2.${compact}.${signature}`;
  if (innerCursor.length > 512 || cursor.length > 512) {
    throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_cursor_invalid", 422);
  }
  return cursor;
}

function decodeRefinementCursor(session: CandidateSessionRow, filterDigest: string, value: string, now: Date) {
  try {
    if (value.startsWith("v2.")) {
      const parts = /^v2\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/u.exec(value);
      if (!parts || value.length > 512 || new Date(session.expires_at).getTime() <= now.getTime()) throw new Error();
      // A bounded inner cursor is at most 384 decoded bytes; never inflate unbounded input.
      const innerCursor = inflateRawSync(Buffer.from(parts[1]!, "base64url"),
        { maxOutputLength: 384 }).toString("base64url");
      const payload = { session_key: session.session_key, filter_digest: filterDigest,
        inner_cursor: innerCursor, expires_at: session.expires_at };
      const expected = signalTopicEvaluationDigestV2({ payload, session_digest: session.session_digest }).slice(7);
      if (parts[2] !== expected) throw new Error();
      return innerCursor;
    }
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { payload: {
      session_key: string; filter_digest: string; inner_cursor: string; expires_at: string }; signature: string };
    const expected = signalTopicEvaluationDigestV2({ payload: decoded.payload, session_digest: session.session_digest });
    if (decoded.signature !== expected || decoded.payload.session_key !== session.session_key
        || decoded.payload.filter_digest !== filterDigest || decoded.payload.expires_at !== session.expires_at
        || new Date(decoded.payload.expires_at).getTime() <= now.getTime()) throw new Error();
    return decoded.payload.inner_cursor;
  } catch { throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_cursor_invalid", 422); }
}

function assertRefinementResultBudget(usedBytes: number, nextResultBytes: number) {
  if (usedBytes+nextResultBytes>SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS.max_total_tool_result_bytes) {
    throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_total_result_limit_reached", 409);
  }
}

async function refinementStartInputDigest(queryable: Queryable, input: {
  run_key: string; candidate_key: string; expected_revision: number; state_token: string
}) {
  const row = (await queryable.query<{ digest: string }>(`SELECT
    signal_topic_evaluation_v2_candidate_refinement_start_input_digest_v1($1,$2,$3,$4) digest`,
  [input.run_key, input.candidate_key, input.expected_revision, input.state_token])).rows[0];
  if (!row?.digest) throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_start_digest_failed", 500);
  return row.digest;
}

async function refinementCursorContextDigest(queryable: Queryable, session: CandidateSessionRow,
  clusterKey: string, filters: unknown) {
  const row = (await queryable.query<{ digest: string }>(`SELECT
    signal_topic_evaluation_v2_candidate_refinement_cursor_context_digest_v1(
      $1,$2,$3::timestamptz,$4,$5::jsonb
    ) digest`, [session.session_digest, session.candidate_version_digest, session.expires_at,
    clusterKey, JSON.stringify(filters)])).rows[0];
  if (!row?.digest) throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_cursor_state_invalid", 500);
  return row.digest;
}

async function refinementProposalDigest(queryable: Queryable, session: CandidateSessionRow,
  proposal: SignalTopicCandidateRefinementProposalV1) {
  const row = (await queryable.query<{ digest: string }>(`SELECT
    signal_topic_evaluation_v2_candidate_refinement_proposal_digest_v1(
      $1::uuid,$2,$3,$4,$5::text[],$6::text[],$7,$8
    ) digest`, [session.id, session.session_digest, proposal.display_name, proposal.description,
    proposal.evidence_refs, proposal.related_candidate_keys, proposal.recommendation, proposal.rationale])).rows[0];
  if (!row?.digest) throw new SignalTopicEvaluationV2Error("topic_candidate_refinement_proposal_digest_failed", 500);
  return row.digest;
}

function candidateSelectSql() {
  return `SELECT candidate.id candidate_id,candidate.workspace_id,candidate.run_id,run.run_key,run.snapshot_id,
    candidate.candidate_key,base.id base_model_revision_id,editorial.id candidate_editorial_revision_id,
    COALESCE(editorial.revision,1)::int candidate_revision,
    COALESCE(editorial.version_digest,base.payload_digest) candidate_version_digest,
    signal_topic_evaluation_v2_candidate_state_token_v1(candidate.id,COALESCE(editorial.revision,1),
      COALESCE(editorial.version_digest,base.payload_digest)) candidate_state_token,
    snapshot.semantic_context_authority_digest brand_os_authority_digest,
    candidate.source_cluster_keys,
    COALESCE(editorial.title,base.payload->>'title') title,
    COALESCE(editorial.description,base.payload->>'description') description,
    COALESCE(editorial.inclusion,base.payload->'inclusion') inclusion,
    COALESCE(editorial.exclusion,base.payload->'exclusion') exclusion
    FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id AND run.status='completed'
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id
    JOIN signal_topic_evaluation_v2_candidate_revisions base
      ON base.candidate_id=candidate.id AND base.revision=1
    LEFT JOIN LATERAL(SELECT revision.*
      FROM signal_topic_evaluation_v2_candidate_editorial_revisions revision
      WHERE revision.candidate_id=candidate.id ORDER BY revision.revision DESC LIMIT 1) editorial ON true
    WHERE candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving`;
}

function sessionSelectSql() {
  return `SELECT session.id,session.session_key,session.workspace_id,session.run_id,run.run_key,
    session.snapshot_id,session.candidate_id,candidate.candidate_key,session.actor_user_id,
    session.base_model_revision_id,session.candidate_editorial_revision_id,session.candidate_revision,
    session.candidate_version_digest,session.candidate_state_token,
    session.brand_os_authority_digest,session.source_cluster_keys,session.start_input_digest,
    session.expires_at::text,
    session.session_digest,COALESCE(editorial.title,base.payload->>'title') title,
    COALESCE(editorial.description,base.payload->>'description') description,
    COALESCE(editorial.inclusion,base.payload->'inclusion') inclusion,
    COALESCE(editorial.exclusion,base.payload->'exclusion') exclusion,
    COALESCE((SELECT count(*)::int
      FROM signal_topic_evaluation_v2_candidate_refinement_navigation_traces trace
      WHERE trace.session_id=session.id),0)::int trace_count
    FROM signal_topic_evaluation_v2_candidate_refinement_sessions session
    JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=session.candidate_id
    JOIN signal_topic_evaluation_v2_runs run ON run.id=session.run_id
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=session.snapshot_id
    JOIN signal_topic_evaluation_v2_candidate_revisions base
      ON base.candidate_id=candidate.id AND base.revision=1
    LEFT JOIN LATERAL(SELECT revision.*
      FROM signal_topic_evaluation_v2_candidate_editorial_revisions revision
      WHERE revision.candidate_id=candidate.id ORDER BY revision.revision DESC LIMIT 1) editorial ON true`;
}

function projectSession(row: CandidateSessionRow): SignalTopicCandidateRefinementSessionV1 {
  return { contract_version: SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT, session_key: row.session_key,
    run_key: row.run_key, candidate_key: row.candidate_key, candidate_revision: row.candidate_revision,
    expires_at: new Date(row.expires_at).toISOString(),
    navigation_calls_remaining: Math.max(0,
      SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS.max_navigation_calls-row.trace_count),
    provider_calls_allowed: 0, topic_adoption: false, publication: false, serving: false };
}

export const signalTopicCandidateRefinementTestOnly = {
  assertRefinementResultBudget, encodeRefinementCursor, decodeRefinementCursor
};

function proposalResponse(session: CandidateSessionRow, proposalDigest: string, idempotentReplay: boolean) {
  return { contract_version: SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT, session_key: session.session_key,
    candidate_key: session.candidate_key, proposal_digest: proposalDigest, idempotent_replay: idempotentReplay,
    topic_adoption: false as const, publication: false as const, serving: false as const };
}

function mapRefinementError(error: unknown) {
  if (error instanceof SignalTopicEvaluationV2Error) return error;
  const pgError = error as { code?: unknown; constraint?: unknown };
  if (pgError.code === "40001" || pgError.code === "23505") {
    return new SignalTopicEvaluationV2Error("topic_candidate_refinement_stale", 409);
  }
  if (pgError.code === "23514" || pgError.code === "55000") {
    return new SignalTopicEvaluationV2Error("topic_candidate_refinement_rejected", 409);
  }
  return error;
}

async function rollbackSafely(client: TransactionClient) {
  try { await client.query("ROLLBACK"); } catch { /* preserve the original domain error */ }
}
