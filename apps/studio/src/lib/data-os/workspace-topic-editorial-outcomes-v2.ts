import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AtomicCensusReadError, loadWorkspaceTopicAtomicCensusPageV1 } from "./workspace-topic-atomic-census";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const censusPageSize = 20;
export const editorialOutcomePageLimitV2 = censusPageSize;

export type EditorialOutcomeCategoryV2 = "topic" | "narrative" | "noise" | "insufficient" | "technical" | "pending";
type Scope = { database?: Pick<Pool, "connect">; workspaceId: string; actorUserId: string; numericExecutionId: string;
  editorialExecutionId?: string; offset: number; limit: number };
type OutcomeRow = { group_key: string; editorial_execution_id: string | null; category: EditorialOutcomeCategoryV2; phase: "consolidated" | "screening" | "pending";
  label: string | null; definition: string | null; locale: string | null; rationale: string | null; confidence: number | null;
  source: string | null; decision_digest: string | null; evidence_refs: string[]; error_code: string | null;
  transport_state: string | null };
type CitationRow = { group_key: string; ref_id: string; root_id: string; chunk_sha256: string; fragment: string | null;
  platform: string | null; locale: string | null };

export class EditorialOutcomeReadError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

/** Reads only a bounded page. Final validated revision decisions take precedence;
 * otherwise the page may expose a persisted V2 screening receipt, clearly marked
 * as screening rather than as a consolidated catalog decision. */
export async function loadWorkspaceTopicEditorialOutcomesPageV2(args: Scope) {
  if (![args.workspaceId, args.actorUserId, args.numericExecutionId].every(value => uuid.test(value))
    || args.editorialExecutionId !== undefined && !uuid.test(args.editorialExecutionId)
    || !Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset > 9_980 || args.offset % censusPageSize !== 0
    || args.limit !== editorialOutcomePageLimitV2)
    throw new EditorialOutcomeReadError("topic_editorial_outcomes_request_invalid", 422);

  const database = args.database ?? (await import("@/lib/db")).pool;
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    // Load the page census and its decisions from one repeatable-read snapshot,
    // so the revision banner cannot race a just-validated catalog.
    const pageNumber = Math.floor(args.offset / censusPageSize) + 1;
    const withinPageOffset = args.offset % censusPageSize;
    const census = await loadWorkspaceTopicAtomicCensusPageV1({ queryable: client, workspaceId: args.workspaceId,
      actorUserId: args.actorUserId, numericExecutionId: args.numericExecutionId, page: pageNumber, query: "" });
    const groups = census.items.slice(withinPageOffset, withinPageOffset + args.limit);
    const ownerId = (await client.query<{ execution_id: string | null }>(`
      SELECT editorial.id::text execution_id
      FROM signal_topic_consolidation_executions numeric
      LEFT JOIN LATERAL (
        SELECT candidate.id FROM signal_topic_editorial_executions candidate
        WHERE candidate.workspace_id=numeric.workspace_id AND candidate.numeric_run_id=numeric.consolidation_run_id
          AND candidate.plan->>'contract_version'='signal-topic-editorial-screening-plan-v2'
        ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1
      ) editorial ON true
      WHERE numeric.workspace_id=$1::uuid AND numeric.id=$2::uuid AND numeric.status='ready'`,
    [args.workspaceId, args.numericExecutionId])).rows[0]?.execution_id ?? null;
    if (args.editorialExecutionId !== undefined && ownerId !== args.editorialExecutionId)
      throw new EditorialOutcomeReadError("topic_editorial_outcomes_execution_stale", 409);
    const keys = groups.map(group => group.group_key);
    const rows = (await client.query<OutcomeRow>(`
      WITH numeric AS (
        SELECT execution.consolidation_run_id run_id
        FROM signal_topic_consolidation_executions execution
        JOIN signal_topic_consolidation_runs run ON run.id=execution.consolidation_run_id
          AND run.workspace_id=execution.workspace_id
        WHERE execution.workspace_id=$1::uuid AND execution.id=$2::uuid AND execution.status='ready'
      ), latest_v2 AS (
        SELECT editorial.* FROM signal_topic_editorial_executions editorial,numeric
        WHERE editorial.workspace_id=$1::uuid AND editorial.numeric_run_id=numeric.run_id
          AND editorial.plan->>'contract_version'='signal-topic-editorial-screening-plan-v2'
        ORDER BY editorial.created_at DESC,editorial.id DESC LIMIT 1
      ), scope AS (
        SELECT group_row.id group_id,group_row.group_key,revision.id revision_id
        FROM numeric CROSS JOIN signal_topic_atomic_groups group_row
        LEFT JOIN LATERAL (
          SELECT revision.id FROM signal_topic_consolidation_revisions revision
          WHERE revision.workspace_id=$1::uuid AND revision.consolidation_run_id=numeric.run_id
            AND revision.status='validated'
          ORDER BY revision.revision DESC,revision.id DESC LIMIT 1
        ) revision ON true
        WHERE group_row.workspace_id=$1::uuid AND group_row.consolidation_run_id=numeric.run_id
          AND group_row.group_key=ANY($3::text[])
      ), screened AS (
        SELECT request_group.group_key,owner.id::text editorial_execution_id,reused.decision,
          item.validation,item.outcome,item.item_error,item.batch_state,item.batch_error,item.call_status,item.call_error
        FROM latest_v2 owner
        JOIN signal_topic_editorial_requests request_row ON request_row.execution_id=owner.id AND request_row.phase='screening'
        JOIN LATERAL (SELECT request_row.receipts->'request'->'receipt'->>'group_key' group_key,
          request_row.receipts->'request'->'receipt' request_receipt) request_group ON true
        LEFT JOIN signal_topic_editorial_reused_decisions_v2 reused
          ON reused.request_id=request_row.id AND reused.execution_id=owner.id
        LEFT JOIN LATERAL (
          SELECT batch_item.validation,batch_item.outcome,batch_item.error_code item_error,provider_batch.state batch_state,
            provider_batch.error_code batch_error,provider_call.status call_status,provider_call.error_code call_error
          FROM signal_topic_editorial_batch_items_v2 batch_item
          JOIN signal_topic_editorial_provider_batches_v2 provider_batch ON provider_batch.id=batch_item.batch_id
          JOIN signal_topic_editorial_calls provider_call ON provider_call.id=batch_item.call_id
          WHERE batch_item.request_id=request_row.id
          ORDER BY provider_batch.created_at DESC,provider_batch.id DESC LIMIT 1
        ) item ON true
        WHERE request_group.group_key=ANY($3::text[])
      )
      SELECT scope.group_key,
        CASE
          WHEN decision.disposition='topic' THEN 'topic'
          WHEN decision.disposition='narrative' THEN 'narrative'
          WHEN decision.disposition='noise' THEN 'noise'
          WHEN decision.disposition='unresolved' THEN 'insufficient'
          WHEN COALESCE(screened.decision->>'disposition',screened.validation->'decision'->>'disposition')='topic' THEN 'topic'
          WHEN COALESCE(screened.decision->>'disposition',screened.validation->'decision'->>'disposition')='narrative' THEN 'narrative'
          WHEN COALESCE(screened.decision->>'disposition',screened.validation->'decision'->>'disposition')='noise' THEN 'noise'
          WHEN COALESCE(screened.decision->>'disposition',screened.validation->'decision'->>'disposition')='unresolved' THEN 'insufficient'
          WHEN screened.validation IS NOT NULL AND screened.validation->>'status'<>'accepted'
            OR screened.outcome IN('errored','canceled','expired','submission_rejected')
            OR screened.batch_state='rejected'
            OR screened.call_status='settled' AND screened.validation IS NULL THEN 'technical'
          ELSE 'pending'
        END::text category,
        CASE WHEN decision.disposition IS NOT NULL THEN 'consolidated'
          WHEN screened.decision IS NOT NULL OR screened.validation->>'status'='accepted' THEN 'screening'
          WHEN screened.outcome IN('errored','canceled','expired','submission_rejected')
            OR screened.batch_state='rejected'
            OR screened.call_status='settled' AND screened.validation IS NULL THEN 'screening'
          ELSE 'pending' END::text phase,
        COALESCE(concept.label,screened.decision->'candidate'->>'label',screened.validation->'decision'->'candidate'->>'label) label,
        COALESCE(concept.definition,screened.decision->'candidate'->>'definition',screened.validation->'decision'->'candidate'->>'definition) definition,
        COALESCE(concept.locale,screened.decision->'candidate'->>'locale',screened.validation->'decision'->'candidate'->>'locale) locale,
        COALESCE(decision.rationale,screened.decision->>'rationale',screened.validation->'decision'->>'rationale') rationale,
        COALESCE(decision.confidence, NULLIF(screened.decision->>'confidence','')::double precision,
          NULLIF(screened.validation->'decision'->>'confidence','')::double precision) confidence,
        COALESCE(decision.source,CASE WHEN screened.decision IS NOT NULL THEN 'reused' WHEN screened.validation->>'status'='accepted' THEN 'model' END) source,
        decision.decision_digest,
        CASE WHEN decision.disposition IS NOT NULL THEN ARRAY[]::text[]
          ELSE COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(screened.decision->'cited_ref_ids',screened.validation->'decision'->'cited_ref_ids','[]'::jsonb)) LIMIT 10),'{}'::text[]) END evidence_refs,
        CASE WHEN screened.validation IS NOT NULL AND screened.validation->>'status'<>'accepted' THEN screened.validation->>'code'
          ELSE COALESCE(screened.item_error,screened.batch_error,screened.call_error) END error_code,
        CASE WHEN screened.decision IS NOT NULL THEN 'reused'
          WHEN screened.validation->>'status'='accepted' THEN 'accepted'
          WHEN screened.outcome IS NOT NULL THEN screened.outcome
          WHEN screened.call_status='outcome_unknown' THEN 'outcome_unknown'
          WHEN screened.call_status IS NOT NULL THEN screened.call_status
          WHEN screened.batch_state IS NOT NULL THEN screened.batch_state END transport_state
      FROM scope
      LEFT JOIN signal_topic_consolidation_decisions decision ON decision.revision_id=scope.revision_id
        AND decision.atomic_group_id=scope.group_id AND decision.workspace_id=$1::uuid
      LEFT JOIN signal_topic_editorial_concepts concept ON concept.id=decision.concept_id
        AND concept.revision_id=decision.revision_id AND concept.workspace_id=$1::uuid
      LEFT JOIN screened ON screened.group_key=scope.group_key
      ORDER BY scope.group_key COLLATE "C"`, [args.workspaceId, args.numericExecutionId, keys])).rows;
    const citationRequests = rows.flatMap(row => row.phase === "screening"
      ? [{ group_key: row.group_key, ref_ids: row.evidence_refs.slice(0, 2) }] : [])
      .filter(row => row.ref_ids.length > 0);
    const citations = citationRequests.length ? (await client.query<CitationRow>(`
      WITH numeric AS (
        SELECT execution.consolidation_run_id run_id FROM signal_topic_consolidation_executions execution
        WHERE execution.workspace_id=$1::uuid AND execution.id=$2::uuid AND execution.status='ready'
      ), requested AS (
        SELECT item.group_key,reference.ref_id
        FROM jsonb_to_recordset($3::jsonb) item(group_key text,ref_ids jsonb)
        CROSS JOIN LATERAL jsonb_array_elements_text(item.ref_ids) reference(ref_id)
      )
      SELECT requested.group_key,evidence.ref_id,evidence.canonical_root_id::text root_id,evidence.chunk_sha256,
        CASE WHEN asset.full_text IS NULL THEN NULL ELSE
          signal_topic_utf16_fragment_v1(asset.full_text,evidence.start_offset,evidence.end_offset) END fragment,
        evidence.platform,evidence.locale
      FROM requested CROSS JOIN numeric
      JOIN signal_topic_atomic_groups group_row ON group_row.workspace_id=$1::uuid
        AND group_row.consolidation_run_id=numeric.run_id AND group_row.group_key=requested.group_key
      JOIN signal_topic_atomic_group_evidence evidence ON evidence.workspace_id=$1::uuid
        AND evidence.consolidation_run_id=numeric.run_id AND evidence.atomic_group_id=group_row.id
        AND evidence.ref_id=requested.ref_id
      LEFT JOIN signal_topic_consolidation_runs run ON run.id=numeric.run_id AND run.workspace_id=$1::uuid
      LEFT JOIN signal_topic_catalog_executions execution ON execution.id=run.source_engine_execution_id
        AND execution.workspace_id=run.workspace_id
      LEFT JOIN signal_corpus_preparation_items item ON item.run_id=execution.preparation_run_id
        AND item.workspace_id=$1::uuid AND item.root_id=evidence.canonical_root_id AND item.disposition='eligible'
      LEFT JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
        AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
        AND (asset.chunks->'chunks'->evidence.chunk_index->>'start')::integer=evidence.start_offset
        AND (asset.chunks->'chunks'->evidence.chunk_index->>'end')::integer=evidence.end_offset
        AND asset.chunks->'chunks'->evidence.chunk_index->>'sha256'=evidence.chunk_sha256
      ORDER BY requested.group_key COLLATE "C",evidence.ref_id COLLATE "C"`,
    [args.workspaceId, args.numericExecutionId, JSON.stringify(citationRequests)])).rows : [];
    const citationsByGroup = new Map<string, Array<{ id: string; text: string | null;
      source: string | null; kind: "cited" }>>();
    for (const citation of citations) {
      const text = citation.fragment && `sha256:${createHash("sha256").update(citation.fragment, "utf8").digest("hex")}` === citation.chunk_sha256
        ? citation.fragment.slice(0, 360) : null;
      const list = citationsByGroup.get(citation.group_key) ?? [];
      if (list.length < 2) list.push({ id: citation.ref_id, text, source: citation.platform, kind: "cited" });
      citationsByGroup.set(citation.group_key, list);
    }
    await client.query("COMMIT");
    const byKey = new Map(rows.map(row => [row.group_key, row]));
    return {
      contract_version: "workspace-topic-editorial-outcomes-page-v2" as const,
      workspace_id: args.workspaceId, numeric_execution_id: args.numericExecutionId,
      execution_id: ownerId,
      total: census.total, offset: args.offset, limit: args.limit,
      revision_status: census.revision_status,
      items: groups.map(group => {
        const result = byKey.get(group.group_key);
        const category = result?.category ?? (group.disposition === "topic" ? "topic"
          : group.disposition === "narrative" ? "narrative" : group.disposition === "noise" ? "noise"
          : group.disposition === "unresolved" ? "insufficient" : "pending");
        const consolidated = result?.phase === "consolidated" || census.revision_status === "validated" && group.disposition !== null;
        const phase = consolidated ? "consolidated" : result?.phase ?? "pending";
        const evidence = citationsByGroup.get(group.group_key)
          ?? (phase === "consolidated" ? group.evidence.map(item => ({ id: item.root_id,
            text: item.text, source: item.platform, kind: "representative" as const })) : []);
        return { group_key: group.group_key, outcome: category, phase,
          decision: category === "pending" || category === "technical" ? null : {
            disposition: category === "insufficient" ? "unresolved" : category,
            label: result?.label ?? group.concept_label, definition: result?.definition ?? null, locale: result?.locale ?? null,
            rationale: result?.rationale ?? null, confidence: result?.confidence ?? null, source: result?.source ?? null,
            digest: result?.decision_digest ?? null, cited_evidence_refs: result?.evidence_refs.slice(0, 2) ?? [] },
          technical_error_code: category === "technical" ? result?.error_code ?? null : null,
          transport_state: result?.transport_state ?? null, evidence };
      }),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export { AtomicCensusReadError };
