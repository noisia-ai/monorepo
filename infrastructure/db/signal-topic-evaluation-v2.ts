import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import {
  buildSignalTopicEvaluationExecutionFlightCardV2,
  parseSignalTopicEvidenceNavigationRequestV2,
  sanitizeSignalTopicEvidenceExcerptV2,
  SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION,
  SIGNAL_TOPIC_EVALUATION_V2_CONTRACT,
  signalTopicEvaluationDigestV2,
  signalTopicEvaluationFlightCardV2,
  signalTopicEvidenceNavigationResultV2,
  type SignalTopicEvidenceNavigationRequestV2,
  type SignalTopicEvidenceNavigationResultV2,
  type SignalTopicEvaluationFlightCardV2,
  type SignalTopicEvaluationTraceV2
} from "@noisia/query-engine";

type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
  rows: T[]; rowCount: number | null }> };
export type SignalTopicEvaluationActorV2 = { id: string; user_type: "noisia_internal" };

export class SignalTopicEvaluationV2Error extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

/**
 * This is deliberately supplied by a future, UAT-only Worker composition root rather than read
 * from process.env in the database package.  The database stores the selected immutable values,
 * never a credential.  The current gate does not construct this with a real credential.
 */
export type SignalTopicEvaluationV2ExecutionConfiguration = {
  enabled: boolean;
  runtime_profile: "uat";
  credential_configured: boolean;
  provider: "anthropic";
  model: string;
  pricing_version: string;
  input_micro_usd_per_token: number;
  output_micro_usd_per_token: number;
  flight_card: SignalTopicEvaluationFlightCardV2;
};

export type SignalTopicEvaluationV2ExecutionAuthority = {
  execution_authorization_id: string;
  run_id: string;
  run_key: string;
  snapshot_digest: string;
  flight_card: SignalTopicEvaluationFlightCardV2;
  reserved_micro_usd: number;
};

type SnapshotRow = { id: string; workspace_id: string; snapshot_key: string; snapshot_digest: string;
  rights_digest: string; cluster_count: number; membership_count: number;
  semantic_context_authority_digest: string };
type MemberRow = { member_ref: string; text_clean: string; language: string | null;
  market: string | null; scope: string | null; published_month: string; stratum: "central"|"edge"|"minority";
  source_record_digest: string; cluster_rank: number };

export async function loadSignalTopicEvaluationV2Preflight(args: { queryable: Queryable;
  workspace_id: string; actor: SignalTopicEvaluationActorV2 }) {
  assertActor(args.actor);
  const snapshot = await loadSnapshot(args.queryable, args.workspace_id, args.actor.id);
  return { ...signalTopicEvaluationFlightCardV2(), snapshot_key: snapshot.snapshot_key,
    snapshot_digest: snapshot.snapshot_digest, cluster_count: snapshot.cluster_count,
    membership_count: snapshot.membership_count,
    semantic_context_authority_digest: snapshot.semantic_context_authority_digest,
    historical_summary_evaluator_preserved: true as const,
    candidates_are_pending_only: true as const, topic_adoption: false as const,
    publication: false as const, serving: false as const };
}

/**
 * Creates the durable UAT-only authority and its planned run, but does not enqueue, call a
 * provider, or write candidates.  The worker must claim the exact authority later.  Keeping the
 * creation and reservation in one serializable transaction makes a confirmation auditable and
 * prevents the UI from turning a stale preflight into a different flight.
 */
export async function createSignalTopicEvaluationV2ExecutionAuthority(args: {
  pool: { connect(): Promise<PoolClient> };
  workspace_id: string;
  actor: SignalTopicEvaluationActorV2;
  idempotency_key: string;
  expected_snapshot_digest: string;
  confirmation: string;
  configuration: SignalTopicEvaluationV2ExecutionConfiguration;
}): Promise<SignalTopicEvaluationV2ExecutionAuthority> {
  assertActor(args.actor);
  assertExecutionConfiguration(args.configuration);
  if (args.confirmation !== SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION) {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_confirmation_required", 422);
  }
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)) {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_idempotency_invalid", 422);
  }
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`signal-topic-evaluation-v2:${args.workspace_id}`]);
    const duplicate = await client.query(`SELECT 1 FROM signal_topic_evaluation_v2_execution_authorizations
      WHERE workspace_id=$1::uuid AND idempotency_key=$2`, [args.workspace_id, args.idempotency_key]);
    if ((duplicate.rowCount ?? 0) > 0) {
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_idempotency_already_used", 409);
    }
    const snapshot = await loadSnapshot(client, args.workspace_id, args.actor.id);
    if (snapshot.snapshot_digest !== args.expected_snapshot_digest) {
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_snapshot_drift", 409);
    }
    const active = await client.query(`SELECT 1 FROM signal_topic_evaluation_v2_execution_authorizations
      WHERE workspace_id=$1::uuid AND snapshot_id=$2::uuid AND status IN('authorized','claimed')`,
    [args.workspace_id, snapshot.id]);
    if ((active.rowCount ?? 0) > 0) {
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_already_active", 409);
    }
    const card = parseExecutionFlightCard(args.configuration.flight_card);
    const reserved = reserveMicroUsd(card, args.configuration);
    const flightCardDigest = signalTopicEvaluationDigestV2(card);
    const authorizationKey = `topic-v2-auth-${signalTopicEvaluationDigestV2({ workspace_id: args.workspace_id,
      actor_id: args.actor.id, idempotency_key: args.idempotency_key, snapshot_digest: snapshot.snapshot_digest,
      flight_card_digest: flightCardDigest }).slice(7, 23)}`;
    const runKey = `topic-v2-run-${signalTopicEvaluationDigestV2({ authorization_key: authorizationKey,
      snapshot_digest: snapshot.snapshot_digest }).slice(7, 23)}`;
    const authorizationId = randomUUID(); const runId = randomUUID();
    await client.query(`INSERT INTO signal_topic_evaluation_v2_execution_authorizations(
      id,workspace_id,snapshot_id,requested_by_user_id,idempotency_key,authorization_key,confirmation,
      runtime_profile,provider,model,pricing_version,input_micro_usd_per_token,output_micro_usd_per_token,
      flight_card,flight_card_digest,reserved_micro_usd)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,'uat','anthropic',$8,$9,$10,$11,
        $12::jsonb,$13,$14)`, [authorizationId,args.workspace_id,snapshot.id,args.actor.id,args.idempotency_key,
      authorizationKey,args.confirmation,args.configuration.model,args.configuration.pricing_version,
      args.configuration.input_micro_usd_per_token,args.configuration.output_micro_usd_per_token,
      JSON.stringify(card),flightCardDigest,reserved]);
    await client.query(`INSERT INTO signal_topic_evaluation_v2_runs(
      id,workspace_id,snapshot_id,execution_authorization_id,requested_by_user_id,idempotency_key,run_key,
      confirmation,flight_card,flight_card_digest,provider_execution_enabled,reserved_micro_usd)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::jsonb,$10,true,$11)`,
    [runId,args.workspace_id,snapshot.id,authorizationId,args.actor.id,args.idempotency_key,runKey,
      args.confirmation,JSON.stringify(card),flightCardDigest,reserved]);
    await client.query("COMMIT");
    return { execution_authorization_id: authorizationId, run_id: runId, run_key: runKey,
      snapshot_digest: snapshot.snapshot_digest, flight_card: card, reserved_micro_usd: reserved };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw mapExecutionAuthorityConflict(error);
  } finally { client.release(); }
}

/** Claims an already authorized run immediately before its worker begins. No provider edge is
 * crossed here.  The worker must record every attempted provider turn before transport. */
export async function claimSignalTopicEvaluationV2ExecutionAuthority(args: {
  pool: { connect(): Promise<PoolClient> }; run_id: string;
}): Promise<{ workspace_id: string; requested_by_user_id: string; snapshot_id: string;
  snapshot_digest: string; execution_authorization_id: string; configuration: {
    model: string; input_micro_usd_per_token: number; output_micro_usd_per_token: number;
    flight_card: SignalTopicEvaluationFlightCardV2 } }> {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const selected = await client.query<ExecutionRunRow>(`SELECT run.id::text,run.workspace_id::text,
      run.snapshot_id::text,run.requested_by_user_id::text,run.execution_authorization_id::text,
      run.status,run.provider_call_count,run.provider_execution_enabled,run.flight_card,
      authority.status authority_status,authority.model,authority.input_micro_usd_per_token::text,
      authority.output_micro_usd_per_token::text,snapshot.snapshot_digest
      FROM signal_topic_evaluation_v2_runs run
      JOIN signal_topic_evaluation_v2_execution_authorizations authority ON authority.id=run.execution_authorization_id
      JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id
      WHERE run.id=$1::uuid FOR UPDATE OF run,authority`, [args.run_id]);
    const run = selected.rows[0];
    if (!run) throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_run_not_found", 404);
    if (run.status !== "planned" || run.authority_status !== "authorized" || !run.provider_execution_enabled
        || run.provider_call_count !== 0) {
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_run_not_executable", 409);
    }
    // Re-read authority through the regular loader before transport: a new semantic generation,
    // invalid actor, or unfrozen snapshot fails closed rather than running against stale context.
    const snapshot = await loadSnapshot(client, run.workspace_id, run.requested_by_user_id);
    if (snapshot.id !== run.snapshot_id || snapshot.snapshot_digest !== run.snapshot_digest) {
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_snapshot_drift", 409);
    }
    const card = parseExecutionFlightCard(run.flight_card);
    await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations SET status='claimed'
      WHERE id=$1::uuid AND status='authorized'`, [run.execution_authorization_id]);
    await client.query(`UPDATE signal_topic_evaluation_v2_runs SET status='in_progress'
      WHERE id=$1::uuid AND status='planned'`, [args.run_id]);
    await client.query("COMMIT");
    return { workspace_id: run.workspace_id, requested_by_user_id: run.requested_by_user_id,
      snapshot_id: run.snapshot_id, snapshot_digest: run.snapshot_digest,
      execution_authorization_id: run.execution_authorization_id, configuration: { model: run.model,
      input_micro_usd_per_token: parseSafeInteger(run.input_micro_usd_per_token),
      output_micro_usd_per_token: parseSafeInteger(run.output_micro_usd_per_token), flight_card: card } };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

/** Marks an individual provider turn as attempted before the transport edge. This is what makes
 * network and provider errors conservatively terminal/ambiguous instead of silently retryable. */
export async function recordSignalTopicEvaluationV2ProviderTurnAttempt(args: {
  pool: { connect(): Promise<PoolClient> }; run_id: string;
}) {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<{execution_authorization_id:string;provider_call_count:number;
      max_calls:number;status:string;authority_status:string}>(`SELECT run.execution_authorization_id::text,
      run.provider_call_count,COALESCE((run.flight_card->>'provider_calls_allowed')::int,0) max_calls,
      run.status,authority.status authority_status FROM signal_topic_evaluation_v2_runs run
      JOIN signal_topic_evaluation_v2_execution_authorizations authority ON authority.id=run.execution_authorization_id
      WHERE run.id=$1::uuid FOR UPDATE OF run,authority`, [args.run_id]);
    const run = selected.rows[0];
    if (!run || run.status !== "in_progress" || run.authority_status !== "claimed"
        || run.provider_call_count >= run.max_calls) {
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_provider_turn_not_permitted", 409);
    }
    await client.query(`UPDATE signal_topic_evaluation_v2_runs SET provider_call_count=provider_call_count+1
      WHERE id=$1::uuid`, [args.run_id]);
    await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations
      SET provider_call_count=provider_call_count+1 WHERE id=$1::uuid`, [run.execution_authorization_id]);
    await client.query("COMMIT");
    return { provider_call_count: run.provider_call_count + 1, max_provider_calls: run.max_calls };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function navigateSignalTopicEvaluationEvidenceV2(args: { queryable: Queryable;
  workspace_id: string; actor: SignalTopicEvaluationActorV2; request: unknown
}): Promise<SignalTopicEvidenceNavigationResultV2> {
  assertActor(args.actor);
  const request = parseSignalTopicEvidenceNavigationRequestV2(args.request);
  const snapshot = await loadSnapshot(args.queryable, args.workspace_id, args.actor.id);
  const result = await navigate(args.queryable, snapshot, request);
  const resultWithoutDigest = { contract_version: SIGNAL_TOPIC_EVALUATION_V2_CONTRACT,
    operation: request.operation, snapshot_digest: snapshot.snapshot_digest,
    evidence_refs: result.evidence_refs, next_cursor: result.next_cursor, data: result.data };
  return signalTopicEvidenceNavigationResultV2.parse({ ...resultWithoutDigest,
    result_digest: signalTopicEvaluationDigestV2(resultWithoutDigest) });
}

async function navigate(queryable: Queryable, snapshot: SnapshotRow,
  request: SignalTopicEvidenceNavigationRequestV2) {
  if (request.operation === "cluster_catalog") {
    const after = request.cursor ? decodeCursor(request.cursor, snapshot, "cluster_catalog", null) : null;
    const result = await queryable.query<{cluster_key:string;proposal_key:string|null;member_count:number;
      profile_digest:string}>(`SELECT cluster_key,proposal_key,member_count,profile_digest
      FROM signal_topic_evaluation_v2_clusters WHERE snapshot_id=$1::uuid AND ($2::text IS NULL OR cluster_key>$2)
      ORDER BY cluster_key LIMIT $3`, [snapshot.id, after?.value ?? null, request.limit + 1]);
    const rows = result.rows.slice(0, request.limit);
    return { evidence_refs: [], next_cursor: result.rows.length > request.limit
      ? encodeCursor(snapshot, "cluster_catalog", null, rows.at(-1)!.cluster_key) : null,
    data: { clusters: rows, total_clusters: snapshot.cluster_count } };
  }
  if (request.operation === "cluster_profile") {
    const cluster = await requireClusters(queryable, snapshot, [request.cluster_key]);
    return { evidence_refs: [], next_cursor: null, data: cluster[0] };
  }
  if (request.operation === "compare_clusters") {
    const clusters = await requireClusters(queryable, snapshot, request.cluster_keys);
    return { evidence_refs: [], next_cursor: null, data: { clusters } };
  }
  if (request.operation === "brand_os_context") {
    const context = await queryable.query<{element_key:string;element_kind:string;display_text:string;
      scope:string;locale:string|null;source_refs_digest:string;evidence_count:number}>(`SELECT element.element_key,
      element.element_kind,element.display_text,COALESCE(element.scope,'workspace') scope,element.locale,
      element.source_refs_digest,count(link.id)::int evidence_count
      FROM signal_topic_evaluation_v2_snapshots snapshot
      JOIN signal_semantic_context_element_versions element
        ON element.generation_id=snapshot.semantic_context_generation_id
      LEFT JOIN analysis_evidence_links link ON link.evidence_group_id=element.evidence_group_id
      WHERE snapshot.id=$1::uuid AND element.workspace_id=$2::uuid
        AND element.element_key=ANY($3::text[]) AND element.disposition='approved'
        AND element.lifecycle_state='active'
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
          WHERE successor.supersedes_element_id=element.id)
      GROUP BY element.id ORDER BY element.element_key`, [snapshot.id, snapshot.workspace_id,
      request.element_keys]);
    if (context.rows.length !== request.element_keys.length) {
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_context_authority_invalid", 409);
    }
    return { evidence_refs: [], next_cursor: null, data: { elements: context.rows.map((row) => ({ ...row,
      display_text: sanitizeSignalTopicEvidenceExcerptV2(row.display_text) })) } };
  }
  await requireClusters(queryable, snapshot, [request.cluster_key]);
  const filters = request.filters;
  const values: unknown[] = [snapshot.id, request.cluster_key, filters.language ?? null,
    filters.market ?? null, filters.scope ?? null, filters.month_from ?? null,
    filters.month_to ?? null, filters.query?.toLocaleLowerCase("und") ?? null];
  const where = `membership.snapshot_id=$1::uuid AND membership.cluster_key=$2
    AND ($3::text IS NULL OR membership.language=$3) AND ($4::text IS NULL OR $4=ANY(membership.markets))
    AND ($5::text IS NULL OR $5=ANY(membership.scopes)) AND ($6::text IS NULL OR membership.published_month>=$6)
    AND ($7::text IS NULL OR membership.published_month<=$7)
    AND ($8::text IS NULL OR position($8 in lower(mention.text_clean))>0)`;
  let rows: MemberRow[]; let nextCursor: string | null = null;
  if (request.operation === "representative_mentions") {
    const result = await queryable.query<MemberRow>(`WITH eligible AS(
      SELECT membership.*,mention.text_clean,row_number() OVER(PARTITION BY membership.stratum,
        COALESCE(membership.language,''),COALESCE(membership.market,''),COALESCE(membership.scope,''),
        membership.published_month ORDER BY membership.cluster_rank,membership.member_ref) diversity_rank
      FROM signal_topic_evaluation_v2_cluster_memberships membership
      JOIN mentions mention ON mention.id=membership.mention_id AND mention.workspace_id=membership.workspace_id
      WHERE ${where}), stratified AS(SELECT eligible.*,row_number() OVER(PARTITION BY stratum
        ORDER BY diversity_rank,COALESCE(language,''),COALESCE(market,''),COALESCE(scope,''),
          published_month,cluster_rank,member_ref) stratum_pick FROM eligible)
      SELECT member_ref,text_clean,language,market,scope,published_month,stratum,
      source_record_digest,cluster_rank FROM stratified ORDER BY stratum_pick,
      CASE stratum WHEN 'central' THEN 0 WHEN 'edge' THEN 1 ELSE 2 END,
      COALESCE(language,''),COALESCE(market,''),COALESCE(scope,''),published_month,cluster_rank,member_ref
      LIMIT $9`, [...values, request.limit]); rows = result.rows;
  } else {
    const decoded = request.cursor ? decodeCursor(request.cursor, snapshot, "search_cluster",
      signalTopicEvaluationDigestV2({ cluster_key: request.cluster_key, filters })) : null;
    const result = await queryable.query<MemberRow>(`SELECT membership.member_ref,mention.text_clean,
      membership.language,membership.market,membership.scope,membership.published_month,
      membership.stratum,membership.source_record_digest,membership.cluster_rank
      FROM signal_topic_evaluation_v2_cluster_memberships membership
      JOIN mentions mention ON mention.id=membership.mention_id AND mention.workspace_id=membership.workspace_id
      WHERE ${where} AND ($9::int IS NULL OR (membership.cluster_rank,membership.member_ref)>($9,$10))
      ORDER BY membership.cluster_rank,membership.member_ref LIMIT $11`, [...values,
      decoded?.rank ?? null, decoded?.value ?? null, request.limit + 1]);
    rows = result.rows.slice(0, request.limit);
    if (result.rows.length > request.limit) nextCursor = encodeCursor(snapshot, "search_cluster",
      signalTopicEvaluationDigestV2({ cluster_key: request.cluster_key, filters }), rows.at(-1)!.member_ref,
      rows.at(-1)!.cluster_rank);
  }
  const mentions = rows.map((row) => publicMention(snapshot, row));
  return { evidence_refs: mentions.map((item) => item.evidence_ref), next_cursor: nextCursor,
    data: { cluster_key: request.cluster_key, mentions,
      sampling_guarantee: request.operation === "representative_mentions"
        ? "deterministic_round_robin_across_observed_strata" : "stable_cluster_rank",
      sampling_limit: "Observed strata are round-robin covered when the requested limit is at least their count; language, market, scope and time diversity remains bounded by available metadata and the limit." } };
}

function publicMention(snapshot: SnapshotRow, row: MemberRow) {
  return { evidence_ref: signalTopicEvaluationDigestV2({ snapshot: snapshot.snapshot_digest,
      member_ref: row.member_ref, source: row.source_record_digest }),
    excerpt: sanitizeSignalTopicEvidenceExcerptV2(row.text_clean), language: row.language,
    market: row.market, scope: row.scope, month: row.published_month, stratum: row.stratum,
    source_digest: row.source_record_digest };
}

async function requireClusters(queryable: Queryable, snapshot: SnapshotRow, clusterKeys: string[]) {
  const result = await queryable.query<{cluster_key:string;proposal_key:string|null;member_count:number;
    profile:unknown;profile_digest:string}>(`SELECT cluster_key,proposal_key,member_count,profile,profile_digest
    FROM signal_topic_evaluation_v2_clusters WHERE snapshot_id=$1::uuid AND cluster_key=ANY($2::text[])
    ORDER BY cluster_key`, [snapshot.id, clusterKeys]);
  if (result.rows.length !== clusterKeys.length) {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_cluster_not_found", 404);
  }
  return result.rows;
}

async function loadSnapshot(queryable: Queryable, workspaceId: string, actorId: string) {
  const result = await queryable.query<SnapshotRow>(`SELECT snapshot.id::text,snapshot.workspace_id::text,
    snapshot.snapshot_key,snapshot.snapshot_digest,snapshot.rights_digest,snapshot.cluster_count,
    snapshot.membership_count,snapshot.semantic_context_authority_digest
    FROM signal_topic_evaluation_v2_snapshots snapshot
    JOIN signal_topic_discovery_review_packets packet ON packet.artifact_id=snapshot.packet_artifact_id
      AND packet.workspace_id=snapshot.workspace_id AND packet.packet_digest=snapshot.packet_digest
      AND packet.rights_digest=snapshot.rights_digest AND packet.proposal_count=115
      AND packet.modeling_denominator=21195
    JOIN signal_semantic_context_generations generation
      ON generation.id=snapshot.semantic_context_generation_id
      AND generation.workspace_id=snapshot.workspace_id AND generation.status='draft'
    WHERE snapshot.workspace_id=$1::uuid AND snapshot.state='frozen'
      AND signal_data_governance_actor_is_valid($1::uuid,$2::uuid)
      AND NOT EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets newer
        WHERE newer.workspace_id=packet.workspace_id AND newer.registered_at>packet.registered_at)
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
        WHERE successor.workspace_id=generation.workspace_id
          AND successor.supersedes_generation_id=generation.id)
      AND signal_topic_evaluation_v2_semantic_authority_digest_v1(generation.id)
        =snapshot.semantic_context_authority_digest
      AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_cluster_memberships membership
        JOIN mentions mention ON mention.id=membership.mention_id
        JOIN data_sources source ON source.id=mention.data_source_id
        WHERE membership.snapshot_id=snapshot.id AND (mention.workspace_id<>snapshot.workspace_id
          OR mention.inclusion_status<>'included' OR source.workspace_id<>snapshot.workspace_id
          OR source.status<>'active'))
    ORDER BY snapshot.created_at DESC LIMIT 1`, [workspaceId, actorId]);
  if (!result.rows[0]) throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_snapshot_unavailable", 409);
  return result.rows[0];
}

export async function persistOfflineSignalTopicEvaluationTraceV2(args:{client:PoolClient;run_id:string;
  workspace_id:string;snapshot_id:string;trace:SignalTopicEvaluationTraceV2}) {
  return persistSignalTopicEvaluationTraceV2({ ...args, provider_execution: false });
}

/** The provider worker calls this only after every model turn was durably marked attempted. */
export async function persistSignalTopicEvaluationProviderTraceV2(args:{client:PoolClient;run_id:string;
  workspace_id:string;snapshot_id:string;execution_authorization_id:string;trace:SignalTopicEvaluationTraceV2}) {
  return persistSignalTopicEvaluationTraceV2({ ...args, provider_execution: true });
}

async function persistSignalTopicEvaluationTraceV2(args:{client:PoolClient;run_id:string;
  workspace_id:string;snapshot_id:string;trace:SignalTopicEvaluationTraceV2;provider_execution:boolean;
  execution_authorization_id?:string}) {
  const run=(await args.client.query<{status:string;provider_execution_enabled:boolean;provider_call_count:number;
    execution_authorization_id:string|null;reserved_micro_usd:string}>(`SELECT status,provider_execution_enabled,
      provider_call_count,execution_authorization_id::text,reserved_micro_usd::text
      FROM signal_topic_evaluation_v2_runs WHERE id=$1::uuid AND workspace_id=$2::uuid FOR UPDATE`,
  [args.run_id,args.workspace_id])).rows[0];
  if(!run||run.status!=="in_progress"||run.provider_execution_enabled!==args.provider_execution
    ||(args.provider_execution&&run.execution_authorization_id!==args.execution_authorization_id)
    ||(!args.provider_execution&&run.execution_authorization_id!==null)
    ||run.provider_call_count!==args.trace.provider_calls){
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_trace_run_state_invalid",409);
  }
  if(args.trace.total_cost_micro_usd>parseSafeInteger(run.reserved_micro_usd)){
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_settlement_exceeds_reservation",422);
  }
  const snapshot=(await args.client.query<{snapshot_digest:string}>(`SELECT snapshot_digest FROM
    signal_topic_evaluation_v2_snapshots WHERE id=$1::uuid AND workspace_id=$2::uuid`,
  [args.snapshot_id,args.workspace_id])).rows[0];
  if(!snapshot)throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_snapshot_unavailable",409);
  const memberRows=(await args.client.query<{member_ref:string;source_record_digest:string}>(`SELECT
    member_ref,source_record_digest FROM signal_topic_evaluation_v2_cluster_memberships
    WHERE snapshot_id=$1::uuid`,[args.snapshot_id])).rows;
  const evidenceMembers=new Map(memberRows.map((member)=>[signalTopicEvaluationDigestV2({
    snapshot:snapshot.snapshot_digest,member_ref:member.member_ref,source:member.source_record_digest}),member.member_ref]));
  const evidenceRetrievals=new Map<string,string>();
  for (const retrieval of args.trace.retrievals) {
    const inserted = await args.client.query<{id:string}>(`INSERT INTO signal_topic_evaluation_v2_retrievals(
      run_id,workspace_id,retrieval_index,operation,tool_input_digest,result_digest,result_bytes)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) RETURNING id::text`, [args.run_id,args.workspace_id,
      retrieval.retrieval_index,args.trace.turns[retrieval.retrieval_index]!.tool_operation,
      retrieval.tool_input_digest,retrieval.result_digest,retrieval.result_bytes]);
    for (const evidenceRef of retrieval.evidence_refs) {
      const memberRef=evidenceMembers.get(evidenceRef);
      if (!memberRef) throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_trace_evidence_invalid",422);
      await args.client.query(`INSERT INTO signal_topic_evaluation_v2_retrieval_evidence(
        retrieval_id,snapshot_id,member_ref,evidence_ref) VALUES($1::uuid,$2::uuid,$3,$4)`,
      [inserted.rows[0]!.id,args.snapshot_id,memberRef,evidenceRef]);
      evidenceRetrievals.set(evidenceRef,inserted.rows[0]!.id);
    }
  }
  for(const turn of args.trace.turns)await args.client.query(`INSERT INTO signal_topic_evaluation_v2_model_turns(
    run_id,workspace_id,turn_index,turn_kind,input_digest,output_digest,input_tokens,output_tokens)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8)`,[args.run_id,args.workspace_id,turn.turn_index,
    turn.kind,turn.input_digest,turn.output_digest,turn.input_tokens,turn.output_tokens]);
  // Candidate payloads remain complete; the Top 10 is a separate projection.
  const candidateIds = new Map<string,string>();
  for (const item of args.trace.output.candidates) {
    const id=randomUUID(); candidateIds.set(item.candidate_key,id);
    const candidateDigest=signalTopicEvaluationDigestV2(item);
    await args.client.query(`INSERT INTO signal_topic_evaluation_v2_candidates(id,run_id,workspace_id,
      candidate_key,candidate_digest,source_cluster_keys) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::text[])`,
    [id,args.run_id,args.workspace_id,item.candidate_key,candidateDigest,item.source_cluster_keys]);
    await args.client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_revisions(candidate_id,
      run_id,workspace_id,revision,payload,payload_digest) VALUES($1::uuid,$2::uuid,$3::uuid,1,$4::jsonb,$5)`,
    [id,args.run_id,args.workspace_id,JSON.stringify(item),candidateDigest]);
    for(const evidenceRef of item.evidence_refs){const retrievalId=evidenceRetrievals.get(evidenceRef);
      if(!retrievalId)throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_candidate_evidence_invalid",422);
      await args.client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_evidence(candidate_id,
        retrieval_id,evidence_ref,explanation_digest) VALUES($1::uuid,$2::uuid,$3,$4)`,
      [id,retrievalId,evidenceRef,signalTopicEvaluationDigestV2(item.explanation)]);}
  }
  for (const ranked of args.trace.output.ranking) await args.client.query(`INSERT INTO
    signal_topic_evaluation_v2_rankings(run_id,candidate_id,rank,ranking_reason,ranking_digest)
    VALUES($1::uuid,$2::uuid,$3,$4,$5)`,[args.run_id,candidateIds.get(ranked.candidate_key),ranked.rank,
      ranked.ranking_reason,signalTopicEvaluationDigestV2(ranked)]);
  await args.client.query(`UPDATE signal_topic_evaluation_v2_runs SET status='completed',
    model_turn_count=$2,tool_call_count=$3,total_tool_result_bytes=$4,output_digest=$5,
    total_input_tokens=$6,total_output_tokens=$7,settled_micro_usd=$8,
    completed_at=clock_timestamp() WHERE id=$1::uuid AND workspace_id=$9::uuid AND status='in_progress'`,
  [args.run_id,args.trace.turns.length,args.trace.retrievals.length,args.trace.total_tool_result_bytes,
    signalTopicEvaluationDigestV2(args.trace.output),args.trace.total_input_tokens,
    args.trace.total_output_tokens,args.trace.total_cost_micro_usd,args.workspace_id]);
  if(args.provider_execution){
    await args.client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations
      SET status='completed',settled_micro_usd=$2,provider_call_count=$3,completed_at=clock_timestamp()
      WHERE id=$1::uuid AND status='claimed'`,[args.execution_authorization_id,
      args.trace.total_cost_micro_usd,args.trace.provider_calls]);
  }
}

/**
 * A provider boundary never retries automatically.  `outcome_unknown` deliberately retains the
 * full reservation because a remote endpoint may have accepted the last marked attempt.  A
 * proven pre-transport failure can settle only the already-observed usage from earlier turns.
 */
export async function settleSignalTopicEvaluationV2ExecutionFailure(args: {
  pool: { connect(): Promise<PoolClient> };
  run_id: string;
  outcome: "definitely_not_sent" | "ambiguous_after_send" | "known_response_invalid";
  error_code: string;
  provider_call_count: number;
  observed_input_tokens: number;
  observed_output_tokens: number;
  observed_cost_micro_usd: number;
}) {
  if (!/^[a-z0-9_]{1,120}$/u.test(args.error_code)
      || ![args.provider_call_count,args.observed_input_tokens,args.observed_output_tokens,
        args.observed_cost_micro_usd].every((value)=>Number.isSafeInteger(value)&&value>=0)) {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_failure_shape_invalid", 422);
  }
  const client=await args.pool.connect();
  try {
    await client.query("BEGIN");
    const run=(await client.query<{workspace_id:string;execution_authorization_id:string;reserved_micro_usd:string;
      provider_call_count:number;status:string;authority_status:string}>(`SELECT run.workspace_id::text,
      run.execution_authorization_id::text,run.reserved_micro_usd::text,run.provider_call_count,run.status,
      authority.status authority_status FROM signal_topic_evaluation_v2_runs run
      JOIN signal_topic_evaluation_v2_execution_authorizations authority ON authority.id=run.execution_authorization_id
      WHERE run.id=$1::uuid FOR UPDATE OF run,authority`,[args.run_id])).rows[0];
    if(!run||run.status!=="in_progress"||run.authority_status!=="claimed"
      ||run.provider_call_count!==args.provider_call_count){
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_failure_run_state_invalid",409);
    }
    if(args.observed_cost_micro_usd>parseSafeInteger(run.reserved_micro_usd)){
      throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_settlement_exceeds_reservation",422);
    }
    const ambiguous=args.outcome==="ambiguous_after_send";
    const status=ambiguous?"outcome_unknown":"failed";
    const settled=ambiguous?null:args.observed_cost_micro_usd;
    await client.query(`UPDATE signal_topic_evaluation_v2_runs SET status=$2,error_code=$3,
      total_input_tokens=$4,total_output_tokens=$5,settled_micro_usd=$6,completed_at=clock_timestamp()
      WHERE id=$1::uuid`,[args.run_id,status,args.error_code,args.observed_input_tokens,
      args.observed_output_tokens,settled]);
    await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations SET status=$2,error_code=$3,
      settled_micro_usd=$4,provider_call_count=$5,completed_at=clock_timestamp() WHERE id=$1::uuid`,
    [run.execution_authorization_id,status,args.error_code,settled,args.provider_call_count]);
    await client.query("COMMIT");
    return { status, settled_micro_usd:settled, provider_call_count:args.provider_call_count };
  } catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

function encodeCursor(snapshot:SnapshotRow,operation:string,filterDigest:string|null,value:string,rank?:number) {
  const payload={operation,filter_digest:filterDigest,value,rank:rank??null};
  return Buffer.from(JSON.stringify({payload,signature:signalTopicEvaluationDigestV2({payload,
    snapshot_digest:snapshot.snapshot_digest,rights_digest:snapshot.rights_digest})}),"utf8").toString("base64url");
}
function decodeCursor(cursor:string,snapshot:SnapshotRow,operation:string,filterDigest:string|null) {
  try { const decoded=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")) as {payload:{operation:string;
    filter_digest:string|null;value:string;rank:number|null};signature:string};
    const expected=signalTopicEvaluationDigestV2({payload:decoded.payload,snapshot_digest:snapshot.snapshot_digest,
      rights_digest:snapshot.rights_digest});
    if(decoded.signature!==expected||decoded.payload.operation!==operation
      ||decoded.payload.filter_digest!==filterDigest||typeof decoded.payload.value!=="string")throw new Error();
    return decoded.payload;
  } catch { throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_cursor_invalid",422); }
}
type ExecutionRunRow={id:string;workspace_id:string;snapshot_id:string;requested_by_user_id:string;
  execution_authorization_id:string;status:string;provider_call_count:number;provider_execution_enabled:boolean;
  flight_card:unknown;authority_status:string;model:string;input_micro_usd_per_token:string;
  output_micro_usd_per_token:string;snapshot_digest:string};

function assertExecutionConfiguration(configuration: SignalTopicEvaluationV2ExecutionConfiguration) {
  if (!configuration.enabled) throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_disabled", 403);
  if (configuration.runtime_profile !== "uat") {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_runtime_profile_invalid", 409);
  }
  if (configuration.provider !== "anthropic") {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_configuration_invalid", 422);
  }
  if (!configuration.credential_configured) {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_product_provider_unavailable", 409);
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,159}$/u.test(configuration.model)
      || !/^[a-z0-9][a-z0-9._:-]{2,159}$/u.test(configuration.pricing_version)
      || ![configuration.input_micro_usd_per_token, configuration.output_micro_usd_per_token]
        .every((value)=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000)) {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_configuration_invalid", 422);
  }
  const card=parseExecutionFlightCard(configuration.flight_card);
  if (!card.execution_enabled) {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_configuration_invalid", 422);
  }
}

function parseExecutionFlightCard(value: unknown): SignalTopicEvaluationFlightCardV2 {
  if (!value || typeof value !== "object") {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_flight_card_invalid", 422);
  }
  const card=value as Record<string,unknown>;
  if (card.contract_version!==SIGNAL_TOPIC_EVALUATION_V2_CONTRACT||card.execution_enabled!==true
      ||card.no_retry!==true||card.action_time_confirmation_required!==true
      ||card.preserve_complete_candidate_pool!==true||card.top_view_limit!==10) {
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_flight_card_invalid", 422);
  }
  try{return buildSignalTopicEvaluationExecutionFlightCardV2({
    provider_calls_allowed:asSafeCardInteger(card.provider_calls_allowed),
    max_model_turns:asSafeCardInteger(card.max_model_turns),max_tool_calls:asSafeCardInteger(card.max_tool_calls),
    max_tool_result_bytes:asSafeCardInteger(card.max_tool_result_bytes),
    max_total_tool_result_bytes:asSafeCardInteger(card.max_total_tool_result_bytes),
    max_total_input_tokens:asSafeCardInteger(card.max_total_input_tokens),
    max_total_output_tokens:asSafeCardInteger(card.max_total_output_tokens),
    hard_cap_micro_usd:asSafeCardInteger(card.hard_cap_micro_usd)
  });}catch(error){if(error instanceof SignalTopicEvaluationV2Error)throw error;
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_flight_card_invalid",422);}
}

function asSafeCardInteger(value:unknown){if(typeof value!=="number"||!Number.isSafeInteger(value)){
  throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_flight_card_invalid",422);
}return value;}
function parseSafeInteger(value:string){const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<0){
  throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_execution_state_invalid",500);
}return parsed;}
function reserveMicroUsd(card:SignalTopicEvaluationFlightCardV2,
  configuration:SignalTopicEvaluationV2ExecutionConfiguration){
  const input=Math.ceil(card.max_total_input_tokens*configuration.input_micro_usd_per_token);
  const output=Math.ceil(card.max_total_output_tokens*configuration.output_micro_usd_per_token);
  const total=input+output;
  if(!Number.isSafeInteger(total)||total<1||total>card.hard_cap_micro_usd){
    throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_hard_cap_insufficient",422);
  }return total;}
function mapExecutionAuthorityConflict(error:unknown){
  if(error instanceof SignalTopicEvaluationV2Error)return error;
  const pgError=error as {code?:unknown;constraint?:unknown};
  if(pgError.code!=="23505")return error;
  const constraint=typeof pgError.constraint==="string"?pgError.constraint:"";
  return new SignalTopicEvaluationV2Error(constraint.includes("idempotency")
    ?"topic_evaluation_v2_idempotency_already_used":"topic_evaluation_v2_execution_already_active",409);
}
function assertActor(actor:SignalTopicEvaluationActorV2){if(actor.user_type!=="noisia_internal"){
  throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_forbidden",403);}}
