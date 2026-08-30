import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import {
  parseSignalTopicEvidenceNavigationRequestV2,
  sanitizeSignalTopicEvidenceExcerptV2,
  SIGNAL_TOPIC_EVALUATION_V2_CONTRACT,
  signalTopicEvaluationDigestV2,
  signalTopicEvaluationFlightCardV2,
  signalTopicEvidenceNavigationResultV2,
  type SignalTopicEvidenceNavigationRequestV2,
  type SignalTopicEvidenceNavigationResultV2,
  type SignalTopicEvaluationTraceV2
} from "@noisia/query-engine";

type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
  rows: T[]; rowCount: number | null }> };
export type SignalTopicEvaluationActorV2 = { id: string; user_type: "noisia_internal" };

export class SignalTopicEvaluationV2Error extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

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
function assertActor(actor:SignalTopicEvaluationActorV2){if(actor.user_type!=="noisia_internal"){
  throw new SignalTopicEvaluationV2Error("topic_evaluation_v2_forbidden",403);}}
