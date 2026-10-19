import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  buildSignalWorkspaceInterestDecisionRequestV1,
  signalTopicDefinitionSchemaV1, signalTopicGuidesDiscoveryV1,
  signalWorkspaceEmbeddingDigestV1,
  type SignalTopicDefinitionV1, type SignalWorkspaceTopicSearchEvidenceV1,
  type SignalWorkspaceInterestDecisionRequestV1
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { loadSignalWorkspaceTopicInputSnapshotWithQueryableV1 } from "./signal-workspace-topic-computation";

type Database = Pick<Pool, "connect">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const hash = /^sha256:[0-9a-f]{64}$/u;
const term = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceInterestDecisionSourceError(code, status); };

export class SignalWorkspaceInterestDecisionSourceError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalWorkspaceInterestDecisionSourceError"; }
}

export type SignalWorkspaceInterestDecisionChunkV1 = {
  chunk_index: number; start: number; end: number; chunk_sha256: string; text: string;
};
export type SignalWorkspaceInterestDecisionCandidateV1 = {
  semantic_score: number; negative_semantic_score: number | null;
  evidence_digest: string; evidence: SignalWorkspaceTopicSearchEvidenceV1;
};
export type SignalWorkspaceInterestDecisionRootV1 = {
  root_id: string; root_fingerprint: string; root_correction_digest: string;
  asset_sha256: string; full_text: string;
  chunks: SignalWorkspaceInterestDecisionChunkV1[];
  chunk_coverage_digest: string;
  suggestion: SignalWorkspaceInterestDecisionCandidateV1 | null;
  suggestion_state: "retained" | "not_retained";
};
export type SignalWorkspaceInterestDecisionSourcePageV1 = {
  contract_version: "workspace-interest-decision-source-v1";
  source: { workspace_id: string; execution_id: string; input_digest: string;
    input_revision: string; taxonomy_profile_id: string; preparation_run_id: string;
    embedding_run_id: string; embedding_config_digest: string; context_digest: string;
    definition_digest: string; correction_digest: string; current: true };
  interest: { taxonomy_term_id: string; definition: SignalTopicDefinitionV1; compiler_digest: string };
  roots: SignalWorkspaceInterestDecisionRootV1[];
  next_root_id: string | null;
  done: boolean;
};

/** The search score only orders work. Every source root, including a root with
 * no retained suggestion, enters the semantic decision request. */
export function buildSignalWorkspaceInterestDecisionRequestFromSourcePageV1(
  page: SignalWorkspaceInterestDecisionSourcePageV1, decision_policy_digest: string
): SignalWorkspaceInterestDecisionRequestV1 {
  if (!page.roots.length || page.source.current !== true) fail("workspace_interest_source_page_invalid", 422);
  const definition = page.interest.definition;
  return buildSignalWorkspaceInterestDecisionRequestV1({
    contract_version: "signal-workspace-interest-decision-v1",
    workspace_id: page.source.workspace_id,
    context_digest: page.source.context_digest,
    decision_policy_digest,
    interest: { taxonomy_term_id: page.interest.taxonomy_term_id,
      term_key: definition.term_key, definition_revision: definition.definition_revision,
      definition_digest: definition.definition_digest, definition: definition.definition,
      inclusion: definition.inclusion, exclusion: definition.exclusion },
    roots: page.roots.map(root => ({ root_id: root.root_id, fingerprint: root.root_fingerprint,
      correction_digest: root.root_correction_digest, asset_sha256: root.asset_sha256,
      chunks: root.chunks }))
  });
}

type Run = {
  id: string; workspace_id: string; taxonomy_profile_id: string; preparation_run_id: string;
  embedding_run_id: string; embedding_config_digest: string; input_digest: string;
  input_revision: string; current_revision: string; context_digest: string;
  definition_digest: string; correction_digest: string; input_snapshot: {
    contract_version: string; topics: Array<{ taxonomy_term_id: string; definition: unknown;
      compiled: { compiler_digest: string } }> };
  ready: boolean; preparation_ready: boolean; embedding_ready: boolean; policy_live: boolean;
};
type Row = {
  root_id: string; fingerprint: string; root_correction_digest: string;
  asset_sha256: string; full_text: string | null;
  chunks: { contract_version: string; text_sha256: string; offset_unit: string;
    chunks: Array<{ start: number; end: number; sha256: string }> } | null;
  item_evidence: Record<string, unknown>; item_state: string;
  rights_ok: boolean; text_current: boolean;
  suggestion_term_key: string | null; suggestion_taxonomy_term_id: string | null;
  semantic_score: string | null; negative_semantic_score: string | null;
  evidence_digest: string | null; suggestion_evidence: SignalWorkspaceTopicSearchEvidenceV1 | null;
};

export function verifySignalWorkspaceInterestDecisionRootV1(row: Row, source: Run,
  interest: SignalWorkspaceInterestDecisionSourcePageV1["interest"]): SignalWorkspaceInterestDecisionRootV1 {
  if (!uuid.test(row.root_id) || !hash.test(row.fingerprint) || !hash.test(row.root_correction_digest) || !hash.test(row.asset_sha256)
    || typeof row.full_text !== "string" || sha(row.full_text) !== row.asset_sha256
    || !row.chunks || row.chunks.contract_version !== "corpus-text-chunks-v1"
    || row.chunks.text_sha256 !== row.asset_sha256 || row.chunks.offset_unit !== "utf16"
    || !Array.isArray(row.chunks.chunks) || !row.chunks.chunks.length
    || !row.rights_ok || !row.text_current) return fail("workspace_interest_source_integrity_invalid", 409);
  const refs = row.chunks.chunks, chunks: SignalWorkspaceInterestDecisionChunkV1[] = [];
  const coverage = createHash("sha256");
  let offset = 0;
  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index]!;
    if (!Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end) || ref.start !== offset
      || ref.end <= ref.start || ref.end - ref.start > 1400 || !hash.test(ref.sha256)) {
      return fail("workspace_interest_source_chunks_invalid", 503);
    }
    const text = row.full_text.slice(ref.start, ref.end);
    if (sha(text) !== ref.sha256) return fail("workspace_interest_source_chunks_invalid", 503);
    chunks.push({ chunk_index: index, start: ref.start, end: ref.end, chunk_sha256: ref.sha256, text });
    coverage.update(JSON.stringify([index, ref.start, ref.end, ref.sha256]) + "\n");
    offset = ref.end;
  }
  if (offset !== row.full_text.length || !row.item_evidence || row.item_evidence.root_fingerprint !== row.fingerprint
    || row.item_evidence.asset_sha256 !== row.asset_sha256
    || row.item_evidence.processed_chunks !== chunks.length
    || !["doubt", "not_relevant"].includes(row.item_state)) return fail("workspace_interest_source_coverage_invalid", 503);
  const chunk_coverage_digest = `sha256:${coverage.digest("hex")}`;
  if (row.item_evidence.chunk_coverage_digest !== chunk_coverage_digest) return fail("workspace_interest_source_coverage_invalid", 503);
  let suggestion: SignalWorkspaceInterestDecisionCandidateV1 | null = null;
  if (row.suggestion_term_key !== null) {
    const evidence = row.suggestion_evidence;
    const best = evidence?.best_chunk;
    if (row.suggestion_term_key !== interest.definition.term_key
      || row.suggestion_taxonomy_term_id !== interest.taxonomy_term_id
      || row.item_state !== "doubt" || !evidence || !best
      || evidence.contract_version !== "signal-workspace-topic-search-v1"
      || evidence.quality !== "uncalibrated" || evidence.approval_policy !== "none"
      || evidence.asset_sha256 !== row.asset_sha256
      || evidence.embedding_config_digest !== source.embedding_config_digest
      || evidence.definition_digest !== interest.definition.definition_digest
      || evidence.compiler_digest !== interest.compiler_digest
      || evidence.evaluated_chunk_count !== chunks.length
      || evidence.evaluated_chunks_digest !== chunk_coverage_digest
      || !chunks.some(chunk => chunk.chunk_index === best.chunk_index && chunk.start === best.start
        && chunk.end === best.end && chunk.chunk_sha256 === best.chunk_sha256)
      || row.evidence_digest !== signalWorkspaceEmbeddingDigestV1(evidence)) {
      return fail("workspace_interest_source_suggestion_invalid", 503);
    }
    const semantic_score = Number(row.semantic_score);
    const negative_semantic_score = row.negative_semantic_score === null ? null : Number(row.negative_semantic_score);
    if (!Number.isFinite(semantic_score) || semantic_score !== evidence.positive_score
      || negative_semantic_score !== evidence.negative_score
      || evidence.ranking_score !== evidence.positive_score - Math.max(evidence.negative_score ?? 0, 0)) {
      return fail("workspace_interest_source_suggestion_invalid", 503);
    }
    suggestion = { semantic_score, negative_semantic_score,
      evidence_digest: row.evidence_digest!, evidence };
  }
  return { root_id: row.root_id, root_fingerprint: row.fingerprint,
    root_correction_digest: row.root_correction_digest, asset_sha256: row.asset_sha256,
    full_text: row.full_text, chunks, chunk_coverage_digest, suggestion,
    suggestion_state: suggestion ? "retained" : "not_retained" };
}

/** Read every eligible root, including roots whose interest suggestion was not retained. */
export async function readSignalWorkspaceInterestDecisionSourcePageV1(args: {
  database: Database; workspace_id: string; actor_user_id: string; execution_id: string;
  term_key: string; after_root_id?: string | null; limit?: number;
}): Promise<SignalWorkspaceInterestDecisionSourcePageV1> {
  const limit = args.limit ?? 32, after = args.after_root_id ?? null;
  if (![args.workspace_id, args.actor_user_id, args.execution_id].every(value => uuid.test(value))
    || after !== null && !uuid.test(after) || !term.test(args.term_key)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) fail("workspace_interest_source_request_invalid", 422);
  const client: PoolClient = await args.database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client,
      workspace_id: args.workspace_id, actor_user_id: args.actor_user_id });
    if (!caps.can_execute_topics) fail("workspace_interest_source_forbidden", 403);
    const run = (await client.query<Run>(`SELECT execution.id::text,execution.workspace_id::text,
      execution.taxonomy_profile_id::text,execution.preparation_run_id::text,execution.embedding_run_id::text,
      execution.embedding_config_digest,execution.input_digest,execution.input_revision::text,
      state.input_revision::text current_revision,execution.input_snapshot,
      execution.input_snapshot->>'context_digest' context_digest,
      execution.definition_digest,execution.input_snapshot->>'correction_digest' correction_digest,
      execution.status='ready' AND execution.processed_roots=execution.denominator
        AND execution.processed_chunks=execution.expected_chunks ready,
      preparation.status='completed' preparation_ready,embedding.status='completed' embedding_ready,
      (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp())
        AND (preparation.policy_valid_until IS NULL OR preparation.policy_valid_until>clock_timestamp())
        AND (embedding.policy_valid_until IS NULL OR embedding.policy_valid_until>clock_timestamp()) policy_live
      FROM signal_topic_catalog_executions execution
      JOIN signal_corpus_preparation_input_state state USING(workspace_id)
      JOIN signal_corpus_preparation_runs preparation ON preparation.id=execution.preparation_run_id
        AND preparation.workspace_id=execution.workspace_id
      JOIN signal_workspace_embedding_runs embedding ON embedding.id=execution.embedding_run_id
        AND embedding.workspace_id=execution.workspace_id AND embedding.input_contract='corpus'
      WHERE execution.id=$1::uuid AND execution.workspace_id=$2::uuid
        AND execution.input_contract='workspace-topic-computation-v1'`,
      [args.execution_id, args.workspace_id])).rows[0];
    if (!run) return fail("workspace_interest_source_not_found", 404);
    if (!run.ready || !run.preparation_ready || !run.embedding_ready || !run.policy_live
      || run.input_revision !== run.current_revision) fail("workspace_interest_source_stale");
    const snapshot = run.input_snapshot;
    if (snapshot?.contract_version !== "workspace-topic-computation-v1" || !Array.isArray(snapshot.topics))
      fail("workspace_interest_source_snapshot_invalid", 503);
    const selected = snapshot.topics.filter(topic => topic.definition &&
      (topic.definition as { term_key?: string }).term_key === args.term_key);
    if (selected.length !== 1 || !uuid.test(selected[0]!.taxonomy_term_id)
      || !hash.test(selected[0]!.compiled?.compiler_digest)) fail("workspace_interest_source_interest_not_found", 404);
    const definition = signalTopicDefinitionSchemaV1.parse(selected[0]!.definition);
    if (!signalTopicGuidesDiscoveryV1(definition)) fail("workspace_interest_source_interest_not_found", 404);
    const interest = { taxonomy_term_id: selected[0]!.taxonomy_term_id, definition,
      compiler_digest: selected[0]!.compiled.compiler_digest };
    const live = await loadSignalWorkspaceTopicInputSnapshotWithQueryableV1({ queryable: client,
      workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, input_interests_only: true });
    const liveInterest = live.input.topics.find(topic => topic.definition.term_key === args.term_key);
    if (live.profile_id !== run.taxonomy_profile_id || live.input.context_digest !== run.context_digest
      || live.input.definition_digest !== run.definition_digest
      || live.input.correction_digest !== run.correction_digest
      || liveInterest?.definition.definition_digest !== definition.definition_digest
      || liveInterest?.definition.definition_revision !== definition.definition_revision)
      fail("workspace_interest_source_stale");
    const rows = (await client.query<Row>(`WITH page AS MATERIALIZED (
        SELECT item.canonical_root_id root_id,item.computation_evidence item_evidence,item.resolution_state item_state
        FROM signal_topic_classification_items item
        WHERE item.workspace_id=$1::uuid AND item.execution_id=$2::uuid
          AND ($4::uuid IS NULL OR item.canonical_root_id>$4::uuid)
        ORDER BY item.canonical_root_id LIMIT $5
      ) SELECT page.root_id::text,prepared.fingerprint,prepared.asset_sha256,
        'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(
          jsonb_build_array(correction.term_key,correction.correction_operation_id,
            correction.disposition,correction.definition_revision,correction.definition_digest)::text,
          '' ORDER BY correction.term_key)
          FROM signal_topic_membership_overrides correction
          WHERE correction.workspace_id=$1::uuid AND correction.canonical_root_id=page.root_id
            AND correction.origin_input_contract='workspace-topic-classification-v1'
            AND correction.root_fingerprint=prepared.fingerprint
            AND correction.context_digest=$7
            AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution,
              jsonb_array_elements(execution.input_snapshot->'topics') topic
              WHERE execution.id=$2::uuid AND topic->'definition'->>'term_key'=correction.term_key
                AND topic->'definition'->>'definition_digest'=correction.definition_digest
                AND (topic->'definition'->>'definition_revision')::int=correction.definition_revision)),''),'UTF8')),'hex') root_correction_digest,
        asset.full_text,asset.chunks,page.item_evidence,page.item_state,
        mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id
          AND mention.text_clean_sha256=prepared.asset_sha256 text_current,
        EXISTS(SELECT 1 FROM signal_mention_import_memberships path
          JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=$1::uuid
          JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=$1::uuid
            AND batch.data_source_id=path.data_source_id AND batch.status='completed'
          JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1::uuid AND source.status='active'
          JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
            WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=batch.data_source_id
              AND candidate.status='active' AND candidate.effective_from<=now()
              AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
              AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
            ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
          JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id
            AND license.workspace_id=$1::uuid AND license.status='active' AND license.effective_from<=now()
            AND (license.effective_to IS NULL OR license.effective_to>now())
          JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
            AND retention.workspace_id=$1::uuid AND retention.status='active' AND retention.retention_state='allowed'
            AND retention.effective_from<=now() AND (retention.effective_to IS NULL OR retention.effective_to>now())
            AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
          WHERE path.workspace_id=$1::uuid AND origin.canonical_mention_id=page.root_id
            AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
              AND usage.licensing_policy_id=license.id AND usage.usage_purpose='llm-processing' AND usage.decision='allowed')
            AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
              AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-derived-metrics' AND usage.decision='allowed')
            AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
              AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-mention-list' AND usage.decision='allowed')
            AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
              AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-text-or-excerpt' AND usage.decision='allowed')) rights_ok,
        suggestion.term_key suggestion_term_key,suggestion.taxonomy_term_id::text suggestion_taxonomy_term_id,
        suggestion.semantic_score::text,suggestion.negative_semantic_score::text,
        suggestion.evidence_digest,suggestion.computation_evidence suggestion_evidence
      FROM page LEFT JOIN signal_corpus_preparation_items prepared ON prepared.run_id=$3::uuid
        AND prepared.workspace_id=$1::uuid AND prepared.root_id=page.root_id AND prepared.disposition='eligible'
      LEFT JOIN signal_corpus_text_assets asset ON asset.workspace_id=prepared.workspace_id
        AND asset.text_sha256=prepared.asset_sha256 AND asset.chunk_policy_version=prepared.chunk_policy_version
      LEFT JOIN mentions mention ON mention.id=page.root_id AND mention.workspace_id=$1::uuid
      LEFT JOIN signal_topic_classification_suggestions suggestion ON suggestion.execution_id=$2::uuid
        AND suggestion.workspace_id=$1::uuid AND suggestion.canonical_root_id=page.root_id
        AND suggestion.term_key=$6
      ORDER BY page.root_id`, [args.workspace_id, args.execution_id, run.preparation_run_id,
      after, limit + 1, args.term_key, run.context_digest])).rows;
    if (rows.length > limit + 1) fail("workspace_interest_source_page_invalid", 503);
    for (let index = 1; index < rows.length; index++) {
      if (rows[index - 1]!.root_id >= rows[index]!.root_id) return fail("workspace_interest_source_page_invalid", 503);
    }
    const roots = rows.slice(0, limit).map(row => verifySignalWorkspaceInterestDecisionRootV1(row, run, interest));
    if (rows.length > limit && !uuid.test(rows[limit]!.root_id)) fail("workspace_interest_source_page_invalid", 503);
    const next_root_id = rows.length > limit ? roots.at(-1)!.root_id : null;
    await client.query("COMMIT");
    return { contract_version: "workspace-interest-decision-source-v1", source: {
      workspace_id: run.workspace_id, execution_id: run.id, input_digest: run.input_digest,
      input_revision: run.input_revision, taxonomy_profile_id: run.taxonomy_profile_id,
      preparation_run_id: run.preparation_run_id, embedding_run_id: run.embedding_run_id,
      embedding_config_digest: run.embedding_config_digest, context_digest: run.context_digest,
      definition_digest: run.definition_digest, correction_digest: run.correction_digest, current: true
    }, interest, roots, next_root_id, done: next_root_id === null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
