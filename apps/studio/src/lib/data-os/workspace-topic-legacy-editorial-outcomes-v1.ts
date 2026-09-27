import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  signalTopicEditorialDigestV1,
  signalTopicEditorialScreeningOutputSchemaV1,
  validateSignalTopicEditorialScreeningOutputV1,
  type SignalTopicEditorialScreeningBatchV1,
} from "@noisia/query-engine";
import { AtomicCensusReadError, loadWorkspaceTopicAtomicCensusPageV1 } from "./workspace-topic-atomic-census";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const pageSize = 20;
type Scope = { database?: Pick<Pool, "connect">; workspaceId: string; actorUserId: string; numericExecutionId: string;
  offset: number; limit: number };
type SavedOwner = { id: string; status: string; plan_digest: string; plan_valid: boolean; state_body: unknown; state_digest: string };
type SavedBatch = { batch_index: number; batch: unknown; output: unknown };
type CitationRow = { group_key: string; ref_id: string; chunk_sha256: string; fragment: string | null; platform: string | null };

export class LegacyEditorialOutcomeReadError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const fail = (code: string, status = 503): never => { throw new LegacyEditorialOutcomeReadError(code, status); };

function parseState(owner: SavedOwner, expectedBatchCount: number) {
  const value = owner.state_body;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("topic_editorial_legacy_state_invalid");
  const state = value as Record<string, unknown>;
  // PostgreSQL persists the canonical body and its digest in separate columns.
  // Rebuild the digest from that pair instead of expecting a field that is not stored in state_body.
  const expectedKeys = ["contract_version", "execution_key", "plan_digest", "phase", "screening_outputs", "global"];
  if (Object.keys(state).sort().join("|") !== expectedKeys.sort().join("|")
    || state.contract_version !== "signal-topic-editorial-runner-v1" || state.execution_key !== owner.id
    || state.plan_digest !== owner.plan_digest || !["screening", "global", "completed"].includes(String(state.phase))
    || !Array.isArray(state.screening_outputs) || typeof owner.state_digest !== "string")
    return fail("topic_editorial_legacy_state_invalid");
  if (signalTopicEditorialDigestV1(state) !== owner.state_digest) return fail("topic_editorial_legacy_state_invalid");
  const outputs = state.screening_outputs;
  const indexes: number[] = [];
  for (const raw of outputs) {
    const parsed = signalTopicEditorialScreeningOutputSchemaV1.safeParse(raw);
    if (!parsed.success || indexes.includes(parsed.data.batch_index)) return fail("topic_editorial_legacy_state_invalid");
    indexes.push(parsed.data.batch_index);
  }
  if (indexes.some((value, index) => index > 0 && value <= indexes[index - 1]!)
    || indexes.some(index => index >= expectedBatchCount)
    || outputs.length < expectedBatchCount && (state.phase !== "screening" || state.global !== null)
    || outputs.length === expectedBatchCount && state.global === null && state.phase !== "global"
    || state.global !== null && state.phase !== "completed")
    return fail("topic_editorial_legacy_state_invalid");
  return { state, outputs: outputs as Array<Record<string, unknown>> };
}

/** Read-only browser for legacy V1 screening receipts. It never treats screening as a final catalog. */
export async function loadWorkspaceTopicLegacyEditorialOutcomesPageV1(args: Scope) {
  if (![args.workspaceId, args.actorUserId, args.numericExecutionId].every(value => uuid.test(value))
    || !Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset > 9_980 || args.offset % pageSize !== 0
    || args.limit !== pageSize) throw new LegacyEditorialOutcomeReadError("topic_editorial_outcomes_request_invalid", 422);

  const database = args.database ?? (await import("@/lib/db")).pool;
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const pageNumber = Math.floor(args.offset / pageSize) + 1;
    const census = await loadWorkspaceTopicAtomicCensusPageV1({ queryable: client, workspaceId: args.workspaceId,
      actorUserId: args.actorUserId, numericExecutionId: args.numericExecutionId, page: pageNumber, query: "" });
    const groups = census.items.slice(args.offset % pageSize, args.offset % pageSize + args.limit);
    const owner = (await client.query<SavedOwner>(`
      WITH numeric AS (
        SELECT execution.consolidation_run_id run_id
        FROM signal_topic_consolidation_executions execution
        JOIN signal_topic_consolidation_runs run ON run.id=execution.consolidation_run_id AND run.workspace_id=execution.workspace_id
        WHERE execution.workspace_id=$1::uuid AND execution.id=$2::uuid AND execution.status='ready'
      )
      SELECT editorial.id::text id,editorial.status,editorial.plan_digest,
        signal_topic_editorial_plan_valid_v1(editorial.numeric_run_id,editorial.plan) plan_valid,
        editorial.state_body::jsonb state_body,editorial.state_digest
      FROM numeric JOIN LATERAL (
        SELECT candidate.* FROM signal_topic_editorial_executions candidate,numeric
        WHERE candidate.workspace_id=$1::uuid AND candidate.numeric_run_id=numeric.run_id
          AND candidate.plan->>'contract_version'='signal-topic-editorial-screening-plan-v1'
          AND candidate.state_body IS NOT NULL
          AND jsonb_array_length(candidate.state_body::jsonb->'screening_outputs')>0
        ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1
      ) editorial ON true`, [args.workspaceId, args.numericExecutionId])).rows[0] ?? null;

    const resultsByKey = new Map<string, { decision: Record<string, unknown>; evidenceRefs: string[] }>();
    let savedDecisionCount = 0, screeningBatchCount = 0, expectedBatchCount = 0;
    if (owner) {
      if (!owner.plan_valid) return fail("topic_editorial_legacy_plan_invalid");
      const planMetadata = (await client.query<{ expected_group_count: number; batch_count: number }>(`
        SELECT (editorial.plan->>'expected_group_count')::integer expected_group_count,
          jsonb_array_length(editorial.plan->'batches')::integer batch_count
        FROM signal_topic_editorial_executions editorial
        WHERE editorial.id=$1::uuid AND editorial.workspace_id=$2::uuid
          AND editorial.plan->>'contract_version'='signal-topic-editorial-screening-plan-v1'`, [owner.id, args.workspaceId])).rows[0];
      if (!planMetadata || planMetadata.expected_group_count !== census.total) return fail("topic_editorial_legacy_plan_stale");
      expectedBatchCount = planMetadata.batch_count;
      const parsedState = parseState(owner, expectedBatchCount);
      screeningBatchCount = parsedState.outputs.length;
      savedDecisionCount = parsedState.outputs.reduce((count, output) => {
        if (!Array.isArray(output.decisions)) return fail("topic_editorial_legacy_state_invalid");
        return count + output.decisions.length;
      }, 0);

      const keys = groups.map(group => group.group_key);
      const batches = keys.length ? (await client.query<SavedBatch>(`
        WITH editorial AS (
          SELECT plan,state_body::jsonb state_body,numeric_run_id
          FROM signal_topic_editorial_executions
          WHERE id=$1::uuid AND workspace_id=$2::uuid
            AND plan->>'contract_version'='signal-topic-editorial-screening-plan-v1'
        ), selected AS (
          SELECT batch.value batch,(batch.value->>'batch_index')::integer batch_index
          FROM editorial CROSS JOIN LATERAL jsonb_array_elements(editorial.plan->'batches') batch
          WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(batch.value->'group_keys') group_key
            WHERE group_key.value=ANY($3::text[]))
        )
        SELECT selected.batch_index,selected.batch,output.value output
        FROM selected CROSS JOIN editorial
        LEFT JOIN LATERAL jsonb_array_elements(editorial.state_body->'screening_outputs') output
          ON (output.value->>'batch_index')::integer=selected.batch_index
        ORDER BY selected.batch_index`, [owner.id, args.workspaceId, keys])).rows : [];
      const decisions = new Map<string, Record<string, unknown>>();
      for (const row of batches) {
        if (!row.output) continue;
        const validated = validateSignalTopicEditorialScreeningOutputV1(row.batch as SignalTopicEditorialScreeningBatchV1, row.output);
        for (const decision of validated.decisions) {
          if (decisions.has(decision.group_key)) return fail("topic_editorial_legacy_state_invalid");
          decisions.set(decision.group_key, decision as unknown as Record<string, unknown>);
        }
      }
      for (const group of groups) {
        const decision = decisions.get(group.group_key);
        if (decision) resultsByKey.set(group.group_key, { decision, evidenceRefs: Array.isArray(decision.cited_ref_ids)
          ? decision.cited_ref_ids.slice(0, 2) as string[] : [] });
      }
    }

    const citationRequests = [...resultsByKey].flatMap(([group_key, result]) => result.evidenceRefs.length
      ? [{ group_key, ref_ids: result.evidenceRefs }] : []);
    const citations = citationRequests.length ? (await client.query<CitationRow>(`
      WITH numeric AS (
        SELECT execution.consolidation_run_id run_id FROM signal_topic_consolidation_executions execution
        WHERE execution.workspace_id=$1::uuid AND execution.id=$2::uuid AND execution.status='ready'
      ), requested AS (
        SELECT item.group_key,reference.ref_id FROM jsonb_to_recordset($3::jsonb) item(group_key text,ref_ids jsonb)
        CROSS JOIN LATERAL jsonb_array_elements_text(item.ref_ids) reference(ref_id)
      )
      SELECT requested.group_key,evidence.ref_id,evidence.chunk_sha256,
        CASE WHEN asset.full_text IS NULL THEN NULL ELSE
          signal_topic_utf16_fragment_v1(asset.full_text,evidence.start_offset,evidence.end_offset) END fragment,
        evidence.platform
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
    const evidenceByGroup = new Map<string, Array<{ id: string; text: string | null; source: string | null; kind: "cited" }>>();
    for (const citation of citations) {
      const text = citation.fragment && `sha256:${createHash("sha256").update(citation.fragment, "utf8").digest("hex")}` === citation.chunk_sha256
        ? citation.fragment.slice(0, 360) : null;
      const list = evidenceByGroup.get(citation.group_key) ?? [];
      if (list.length < 2) list.push({ id: citation.ref_id, text, source: citation.platform, kind: "cited" });
      evidenceByGroup.set(citation.group_key, list);
    }
    await client.query("COMMIT");
    return {
      contract_version: "workspace-topic-legacy-editorial-outcomes-page-v1" as const,
      workspace_id: args.workspaceId, numeric_execution_id: args.numericExecutionId,
      execution_id: owner?.id ?? null, execution_status: owner?.status ?? null,
      expected_batch_count: expectedBatchCount, screening_batch_count: screeningBatchCount,
      saved_decision_count: savedDecisionCount, total: census.total, offset: args.offset, limit: args.limit,
      items: groups.map(group => {
        const result = resultsByKey.get(group.group_key);
        const decision = result?.decision;
        const disposition = decision?.disposition;
        const outcome = disposition === "topic" || disposition === "narrative" || disposition === "noise" ? disposition
          : disposition === "unresolved" ? "insufficient" : "pending";
        const refs = result?.evidenceRefs ?? [];
        return { group_key: group.group_key, outcome,
          phase: decision ? "screening" : "pending",
          decision: decision ? { disposition, label: typeof decision.candidate === "object" && decision.candidate
            ? (decision.candidate as Record<string, unknown>).label : null,
            definition: typeof decision.candidate === "object" && decision.candidate
              ? (decision.candidate as Record<string, unknown>).definition : null,
            locale: typeof decision.candidate === "object" && decision.candidate
              ? (decision.candidate as Record<string, unknown>).locale : null,
            rationale: typeof decision.rationale === "string" ? decision.rationale : null,
            confidence: typeof decision.confidence === "number" ? decision.confidence : null,
            source: "legacy_v1_screening", digest: null, cited_evidence_refs: refs } : null,
          technical_error_code: null, transport_state: null, evidence: evidenceByGroup.get(group.group_key) ?? [] };
      }),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof LegacyEditorialOutcomeReadError || error instanceof AtomicCensusReadError) throw error;
    throw new LegacyEditorialOutcomeReadError("topic_editorial_legacy_outcomes_unavailable", 503);
  } finally { client.release(); }
}
