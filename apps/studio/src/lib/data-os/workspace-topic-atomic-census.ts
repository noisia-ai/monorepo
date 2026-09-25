import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "@noisia/db";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const pageSize = 20;
type Scope = { database?: Pick<Pool, "connect">; workspaceId: string; actorUserId: string; numericExecutionId: string;
  page: number; query: string };
type GroupRow = { id: string; group_key: string; lane: "open" | "guided"; root_count: number; chunk_count: number;
  terms: string[]; disposition: "topic" | "narrative" | "noise" | "unresolved" | null; concept_label: string | null };
export type AtomicCensusPageV1 = { contract_version: "workspace-topic-atomic-census-page-v1"; workspace_id: string;
  numeric_execution_id: string; total: number; matching: number; page: number; page_size: number;
  revision_status: "validated" | "pending"; items: Array<Omit<GroupRow, "id"> & {
    evidence: Array<{ root_id: string; text: string | null; platform: string | null; locale: string | null }> }> };

export class AtomicCensusReadError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

/** The numeric execution owns the run. No global/latest workspace fallback is allowed. */
export async function loadWorkspaceTopicAtomicCensusPageV1(args: Scope): Promise<AtomicCensusPageV1> {
  if (![args.workspaceId, args.actorUserId, args.numericExecutionId].every(value => uuid.test(value))
    || !Number.isSafeInteger(args.page) || args.page < 1 || args.page > 500
    || args.query.length > 100 || args.query.includes("\0"))
    throw new AtomicCensusReadError("topic_atomic_census_request_invalid", 422);
  const database = args.database ?? (await import("@/lib/db")).pool;
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: args.workspaceId,
      actor_user_id: args.actorUserId });
    if (!caps.can_view) throw new AtomicCensusReadError("topic_atomic_census_forbidden", 403);
    const run = (await client.query<{ id: string; expected_group_count: number; revision_id: string | null }>(`
      SELECT r.id,r.expected_group_count,revision.id revision_id
      FROM signal_topic_consolidation_executions execution
      JOIN signal_topic_consolidation_runs r ON r.id=execution.consolidation_run_id AND r.workspace_id=execution.workspace_id
      LEFT JOIN signal_topic_consolidation_revisions revision ON revision.consolidation_run_id=r.id
        AND revision.workspace_id=r.workspace_id AND revision.status='validated'
      WHERE execution.id=$2::uuid AND execution.workspace_id=$1::uuid AND execution.status='ready'
        AND r.status IN('ready_for_review','reviewing','validated','superseded')`,
    [args.workspaceId, args.numericExecutionId])).rows[0];
    if (!run) throw new AtomicCensusReadError("topic_atomic_census_unavailable", 404);
    const query = args.query.trim().toLocaleLowerCase();
    const count = (await client.query<{ count: number }>(`
      SELECT count(*)::integer count FROM signal_topic_atomic_groups g
      WHERE g.workspace_id=$1::uuid AND g.consolidation_run_id=$2::uuid
        AND ($3::text='' OR position($3 in lower(g.group_key||' '||array_to_string(g.terms,' ')))>0)`,
    [args.workspaceId, run.id, query])).rows[0]?.count ?? 0;
    const groups = (await client.query<GroupRow>(`
      SELECT g.id,g.group_key,g.lane,g.root_count,g.chunk_count,g.terms,
        decision.disposition,concept.label concept_label
      FROM signal_topic_atomic_groups g
      LEFT JOIN signal_topic_consolidation_decisions decision ON decision.atomic_group_id=g.id
        AND decision.workspace_id=g.workspace_id AND decision.revision_id=$4::uuid
      LEFT JOIN signal_topic_editorial_concepts concept ON concept.id=decision.concept_id
        AND concept.revision_id=decision.revision_id AND concept.workspace_id=g.workspace_id
      WHERE g.workspace_id=$1::uuid AND g.consolidation_run_id=$2::uuid
        AND ($3::text='' OR position($3 in lower(g.group_key||' '||array_to_string(g.terms,' ')))>0)
      ORDER BY g.group_key COLLATE "C" LIMIT ${pageSize} OFFSET $5::integer`,
    [args.workspaceId, run.id, query, run.revision_id, (args.page - 1) * pageSize])).rows;
    const ids = groups.map(group => group.id);
    // The sealed execution's preparation_run_id owns these text assets. The
    // existing UTF-16 SQL helper extracts exact offsets, so no full root text
    // crosses the DB boundary; each displayed group gets at most two citations.
    const evidence = ids.length ? (await client.query<{ atomic_group_id: string; canonical_root_id: string;
      chunk_sha256: string; fragment: string | null; platform: string | null; locale: string | null }>(`
      SELECT sample.atomic_group_id,sample.canonical_root_id,sample.chunk_sha256,
        CASE WHEN asset.full_text IS NULL THEN NULL ELSE
          signal_topic_utf16_fragment_v1(asset.full_text,sample.start_offset,sample.end_offset) END fragment,
        sample.platform,sample.locale
      FROM (
        SELECT e.*,row_number() OVER(PARTITION BY e.atomic_group_id ORDER BY e.evidence_ordinal) position
        FROM signal_topic_atomic_group_evidence e WHERE e.workspace_id=$1::uuid AND e.atomic_group_id=ANY($2::uuid[])
      ) sample
      JOIN signal_topic_consolidation_runs run ON run.id=sample.consolidation_run_id AND run.workspace_id=sample.workspace_id
      LEFT JOIN signal_topic_catalog_executions execution ON execution.id=run.source_engine_execution_id AND execution.workspace_id=run.workspace_id
      LEFT JOIN signal_corpus_preparation_items item ON item.run_id=execution.preparation_run_id
        AND item.workspace_id=sample.workspace_id AND item.root_id=sample.canonical_root_id AND item.disposition='eligible'
      LEFT JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256
        AND asset.chunk_policy_version=item.chunk_policy_version
        AND (asset.chunks->'chunks'->sample.chunk_index->>'start')::integer=sample.start_offset
        AND (asset.chunks->'chunks'->sample.chunk_index->>'end')::integer=sample.end_offset
        AND asset.chunks->'chunks'->sample.chunk_index->>'sha256'=sample.chunk_sha256
      WHERE sample.position<=2 ORDER BY sample.atomic_group_id,sample.position`,
    [args.workspaceId, ids])).rows : [];
    const byGroup = new Map<string, AtomicCensusPageV1["items"][number]["evidence"]>();
    for (const item of evidence) {
      const text = item.fragment && `sha256:${createHash("sha256").update(item.fragment, "utf8").digest("hex")}` === item.chunk_sha256
        ? item.fragment.slice(0, 360) : null;
      const list = byGroup.get(item.atomic_group_id) ?? [];
      list.push({ root_id: item.canonical_root_id, text, platform: item.platform, locale: item.locale });
      byGroup.set(item.atomic_group_id, list);
    }
    const withoutEvidence = ids.filter(id => !byGroup.has(id));
    if (withoutEvidence.length) {
      const roots = (await client.query<{ atomic_group_id: string; canonical_root_id: string }>(`
        SELECT g.id atomic_group_id,first_root.canonical_root_id
        FROM signal_topic_atomic_groups g
        JOIN LATERAL (
          SELECT member.canonical_root_id FROM signal_topic_atomic_group_roots member
          WHERE member.atomic_group_id=g.id AND member.workspace_id=g.workspace_id
          ORDER BY member.canonical_root_id LIMIT 1
        ) first_root ON true
        WHERE g.workspace_id=$1::uuid AND g.consolidation_run_id=$2::uuid AND g.id=ANY($3::uuid[])`,
      [args.workspaceId, run.id, withoutEvidence])).rows;
      for (const root of roots) byGroup.set(root.atomic_group_id,
        [{ root_id: root.canonical_root_id, text: null, platform: null, locale: null }]);
    }
    await client.query("COMMIT");
    return { contract_version: "workspace-topic-atomic-census-page-v1", workspace_id: args.workspaceId,
      numeric_execution_id: args.numericExecutionId, total: run.expected_group_count, matching: count,
      page: args.page, page_size: pageSize, revision_status: run.revision_id ? "validated" : "pending",
      items: groups.map(({ id, ...group }) => ({ ...group, evidence: byGroup.get(id) ?? [] })) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
