import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  signalTopicDefinitionSchemaV1,
  type SignalTopicDefinitionV1,
  type SignalWorkspaceTopicsOverviewV1,
  type SignalWorkspaceTopicEvidencePageV1,
  type SignalWorkspaceClassificationIdentityV1
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { loadSignalWorkspaceClassificationInputV1, SignalWorkspaceClassificationError } from "./signal-workspace-classification";
import { loadSignalTopicWorkingProfileWithQueryableV1 } from "./signal-topic-catalog";

type Database = Pick<Pool, "connect">;
type Filters = { date_from?: string | null; date_to?: string | null };
type Args = Filters & { database: Database; workspace_id: string; actor_user_id: string; include_unselected?: boolean };
export type SignalWorkspaceMentionsArgsV1 = Omit<Args, "include_unselected"> & {
  search_query?: string | null; platforms?: string[]; sort_direction?: "asc" | "desc";
  cursor?: string | null; expected_scope_digest?: string | null; focus_mention_id?: string | null; limit?: number;
};
export type SignalWorkspaceMentionV1 = {
  mention_id: string; occurred_at: string | null; text_snippet: string; text_truncated: boolean;
  title: string | null; url: string | null; platform: string | null; language: string | null; country: string | null;
  content_type: string | null; engagement: Record<string, unknown>; thread_key: string;
  resolution_state: string; has_unresolved_topics: boolean;
};
export type SignalWorkspaceMentionsPageV1 = {
  contract_version: "signal-workspace-mentions-v1"; workspace_id: string; generation_id: string;
  source_engine_execution_id: string; is_current: true; is_processing: boolean; scope_digest: string;
  filters: { date_from: string | null; date_to: string | null; search_query: string | null; platforms: string[] };
  sort: { field: "published"; direction: "asc" | "desc" };
  available_dates: { date_from: string | null; date_to: string | null };
  available_platforms: string[];
  metric_denominator: number; evidence_visible_total: number; total_count: number;
  withheld_evidence_count: number; integrity_withheld_count: number;
  items: SignalWorkspaceMentionV1[]; focused_item?: SignalWorkspaceMentionV1 | null;
  page_offset: number; next_cursor: string | null;
};
type Selection = { revision: number; items: Record<string, { selected: boolean; definition_digest: string;
  definition_revision: number; generation_id: string }> };
type Generation = { id: string; taxonomy_profile_id: string; preparation_run_id: string;
  input_revision: string; current_revision: string; finalized_digest: string; policy_live: boolean;
  source_engine_execution_id: string; interpretation_coverage: unknown; identity: SignalWorkspaceClassificationIdentityV1;
  correction_digest: string; source_valid: boolean };
type Context = { generation: Generation | null; topics: SignalTopicDefinitionV1[]; selection: Selection;
  is_current: boolean; is_processing: boolean; filters: { date_from: string | null; date_to: string | null }; native: boolean };

export class SignalWorkspaceTopicsServingError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalWorkspaceTopicsServingError"; }
}
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceTopicsServingError(code, status); };
const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
function parseDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number(value.slice(0, 4)) < 1 || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) return fail("workspace_topics_date_invalid", 422);
  return value;
}
export function workspaceTopicsInterpretationCoverageV1(value: unknown): SignalWorkspaceTopicsOverviewV1["interpretation_coverage"] {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return fail("workspace_topics_interpretation_coverage_invalid", 503);
  const item = value as Record<string, unknown>;
  const done = item.interpreted_unit_count, total = item.expected_unit_count;
  if (typeof done !== "number" || typeof total !== "number" || !Number.isSafeInteger(done) || !Number.isSafeInteger(total)
    || done < 0 || total < done || typeof item.complete !== "boolean" || item.complete !== (done === total))
    return fail("workspace_topics_interpretation_coverage_invalid", 503);
  return { interpreted_unit_count: done, expected_unit_count: total, complete: item.complete };
}
async function transaction<T>(database: Database, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const value = await work(client); await client.query("COMMIT"); return value;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function mentionsTransaction<T>(database: Database, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    // One simple-query roundtrip installs the same transaction-local fences.
    // The statements remain server-ordered and any failure aborts this read.
    await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
      SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,extensions,pg_temp;
      SET LOCAL enable_nestloop=off; SET LOCAL jit=off`);
    const value = await work(client); await client.query("COMMIT"); return value;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function context(client: PoolClient, args: Args): Promise<Context> {
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
  if (!capabilities.can_view || args.include_unselected && !capabilities.can_edit_topics) return fail("workspace_topics_forbidden", 403);
  const filters = { date_from: parseDate(args.date_from), date_to: parseDate(args.date_to) };
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) return fail("workspace_topics_date_invalid", 422);
  const workspace = (await client.query<{ selection: Selection | null; native: boolean; is_processing: boolean }>(`SELECT topic_signal_selection selection,
    EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.workspace_id=workspace.id
      AND run.input_contract='workspace-topic-classification-v1' AND run.input_snapshot->'source_projection' IS NOT NULL
      AND run.status IN('queued','running')) is_processing,
    EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.workspace_id=workspace.id
      AND run.input_contract IN('workspace-topic-engine-v1','workspace-topic-classification-v1')) native
    FROM signal_workspaces workspace WHERE id=$1::uuid`, [args.workspace_id])).rows[0]!;
  const selection = workspace.selection ?? { revision: 0, items: {} };
  const generation = (await client.query<Generation>(`SELECT generation.id,generation.taxonomy_profile_id,generation.preparation_run_id,
    generation.input_revision::text,state.input_revision::text current_revision,generation.finalized_digest,
    (generation.policy_valid_until IS NULL OR generation.policy_valid_until>now()) policy_live,
    generation.input_snapshot->'source_projection'->>'engine_execution_id' source_engine_execution_id,
    generation.input_snapshot->'source_projection'->'interpretation_coverage' interpretation_coverage,
    generation.input_snapshot->'identity' identity,generation.input_snapshot->>'correction_digest' correction_digest,
    signal_workspace_projection_source_current_v1(generation) source_valid
    FROM signal_classification_generations generation JOIN signal_corpus_preparation_input_state state USING(workspace_id)
    JOIN signal_topic_catalog_executions execution ON execution.generation_id=generation.id AND execution.status='ready'
    WHERE generation.workspace_id=$1::uuid AND generation.input_contract='workspace-topic-classification-v1'
      AND generation.status='ready' AND generation.input_snapshot->'source_projection'->>'contract_version' IN('workspace-topic-projection-v1','workspace-topic-incremental-projection-v1')
      AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item WHERE item.generation_id=generation.id AND item.resolution_state='error')
    ORDER BY generation.generation_version DESC LIMIT 1`, [args.workspace_id])).rows[0] ?? null;
  const topicRows = (await client.query<{ definition: unknown }>(`SELECT term.metadata->'topic' definition
    FROM (SELECT taxonomy_id FROM signal_taxonomy_profiles WHERE workspace_id=$1::uuid AND kind='topic'
      AND metadata->>'contract_version'='signal-topic-catalog-v1'
      AND (($2::uuid IS NOT NULL AND id=$2::uuid) OR ($2::uuid IS NULL AND status IN('draft','activating','active')))
      ORDER BY version DESC LIMIT 1) profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
    ORDER BY term.term_key`, [args.workspace_id, generation?.taxonomy_profile_id ?? null])).rows;
  const workingProfile = generation
    ? await loadSignalTopicWorkingProfileWithQueryableV1({ queryable: client, workspace_id: args.workspace_id })
    : null;
  const workingTopicRows = workingProfile ? (await client.query<{ definition: unknown }>(`SELECT term.metadata->'topic' definition
    FROM signal_taxonomy_profiles profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
    WHERE profile.workspace_id=$1::uuid AND profile.id=$2::uuid AND profile.kind='topic'
      AND profile.metadata->>'contract_version'='signal-topic-catalog-v1'
    ORDER BY term.term_key`, [args.workspace_id, workingProfile.id])).rows : [];
  const workingTopics = new Map(workingTopicRows.map(row => {
    const topic = signalTopicDefinitionSchemaV1.parse(row.definition); return [topic.term_key, topic] as const;
  }));
  // A label is editorial presentation, excluded from the semantic digest. Let a
  // user rename a served Topic without discarding the computed memberships or
  // pretending that a semantic edit was classified. Keep the generation's
  // revision/digest as the membership identity.
  const topics = topicRows.map(row => signalTopicDefinitionSchemaV1.parse(row.definition)).map(topic => {
    const working = workingTopics.get(topic.term_key);
    return working && working.definition_digest === topic.definition_digest && working.lifecycle === topic.lifecycle
      ? { ...topic, label: working.label, updated_at: working.updated_at }
      : topic;
  }).filter(topic => topic.lifecycle !== "archived");
  let isCurrent = false;
  if (generation) {
    const input = await loadSignalWorkspaceClassificationInputV1({ queryable: client, ...args,
      taxonomy_profile_id: generation.taxonomy_profile_id }).catch(error => {
      if (error instanceof SignalWorkspaceClassificationError && error.code === "workspace_classification_catalog_unavailable") return null;
      throw error;
    });
    isCurrent = input !== null && generation.source_valid && generation.policy_live
      && generation.input_revision === generation.current_revision
      && generation.correction_digest === input.correction_digest
      && generation.identity.catalog_digest === input.catalog_digest && generation.identity.compiler_digest === input.compiler_digest
      && generation.identity.context_digest === input.context_digest && generation.identity.embedding_config_digest === input.embedding_config_digest;
  }
  return { generation, topics, selection, is_current: isCurrent, is_processing: workspace.is_processing, filters,
    native: workspace.native || topics.some(topic => topic.origin === "workspace_discovery") };
}

/** Mentions are a generation-wide corpus view and do not consume Topic labels,
 * working drafts, compiled guides or live Brand Context. Its currentness fence
 * is the sealed projection plus the corpus revision and policy already used by
 * the population query. Keeping this path separate avoids rebuilding unrelated
 * editorial input on every page while retaining workspace authorization. */
async function mentionsContext(client: PoolClient, args: Args): Promise<Pick<Context,
  "generation" | "is_current" | "is_processing" | "filters" | "native">> {
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
  if (!capabilities.can_view) return fail("workspace_topics_forbidden", 403);
  const filters = { date_from: parseDate(args.date_from), date_to: parseDate(args.date_to) };
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) return fail("workspace_topics_date_invalid", 422);
  const row = (await client.query<Generation & { native: boolean; is_processing: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.workspace_id=workspace.id
      AND run.input_contract IN('workspace-topic-engine-v1','workspace-topic-classification-v1')) native,
    EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.workspace_id=workspace.id
      AND run.input_contract='workspace-topic-classification-v1' AND run.input_snapshot->'source_projection' IS NOT NULL
      AND run.status IN('queued','running')) is_processing,
    generation.id,generation.taxonomy_profile_id,generation.preparation_run_id,
    generation.input_revision::text,state.input_revision::text current_revision,generation.finalized_digest,
    (generation.policy_valid_until IS NULL OR generation.policy_valid_until>now()) policy_live,
    generation.input_snapshot->'source_projection'->>'engine_execution_id' source_engine_execution_id,
    generation.input_snapshot->'source_projection'->'interpretation_coverage' interpretation_coverage,
    generation.input_snapshot->'identity' identity,generation.input_snapshot->>'correction_digest' correction_digest,
    signal_workspace_projection_source_current_v1(generation) source_valid
    FROM signal_workspaces workspace
    LEFT JOIN LATERAL (
      SELECT candidate.* FROM signal_classification_generations candidate
      JOIN signal_topic_catalog_executions execution ON execution.generation_id=candidate.id AND execution.status='ready'
      WHERE candidate.workspace_id=workspace.id AND candidate.input_contract='workspace-topic-classification-v1'
        AND candidate.status='ready'
        AND candidate.input_snapshot->'source_projection'->>'contract_version' IN('workspace-topic-projection-v1','workspace-topic-incremental-projection-v1')
        AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item
          WHERE item.generation_id=candidate.id AND item.resolution_state='error')
      ORDER BY candidate.generation_version DESC LIMIT 1
    ) generation ON true
    LEFT JOIN signal_corpus_preparation_input_state state ON state.workspace_id=workspace.id
    WHERE workspace.id=$1::uuid`, [args.workspace_id])).rows[0];
  const generation = row?.id ? row : null;
  return { generation, is_processing: row?.is_processing ?? false, native: row?.native ?? false, filters,
    is_current: Boolean(generation?.source_valid && generation.policy_live
      && generation.input_revision === generation.current_revision) };
}

/** Current rights use one complete provenance path, including import precedence.
 * Authorization to compute never substitutes for rights to display metrics/text. */
const populationSql = `WITH source_generation AS MATERIALIZED (
  SELECT generation.* FROM signal_classification_generations generation WHERE generation.id=$2::uuid
    AND generation.workspace_id=$1::uuid AND signal_workspace_projection_source_current_v1(generation)
), authorized_imports AS MATERIALIZED (
  SELECT batch.id,batch.data_source_id,
    EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-derived-metrics' AND usage.decision='allowed') metrics,
    (EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-mention-list' AND usage.decision='allowed')
     AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-text-or-excerpt' AND usage.decision='allowed')) evidence
  FROM import_batches batch JOIN data_sources source ON source.id=batch.data_source_id
    AND source.workspace_id=$1::uuid AND source.status='active'
  JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
    WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=batch.data_source_id
      AND candidate.status='active' AND candidate.effective_from<=now() AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
      AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
    ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
  JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=$1::uuid
    AND license.status='active' AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
  JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=$1::uuid
    AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
    AND (retention.effective_to IS NULL OR retention.effective_to>now())
    AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
  WHERE batch.workspace_id=$1::uuid AND batch.status='completed'
), root_rights AS MATERIALIZED (
  SELECT origin.canonical_mention_id root_id,bool_or(rights.metrics) metrics,bool_or(rights.metrics AND rights.evidence) evidence
  FROM authorized_imports rights JOIN signal_mention_import_memberships path ON path.import_batch_id=rights.id
    AND path.data_source_id=rights.data_source_id AND path.workspace_id=$1::uuid
  JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=$1::uuid
  GROUP BY origin.canonical_mention_id
), all_roots AS MATERIALIZED (
  SELECT item.canonical_root_id root_id,item.resolution_state,mention.published_at,
    COALESCE((item.outcome_metadata->>'has_unresolved_topics')::boolean,false) has_unresolved_topics,
    COALESCE(rights.metrics,false) AND mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id metrics,
    COALESCE(rights.evidence,false) AND mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id evidence
  FROM signal_classification_generation_items item JOIN mentions mention ON mention.id=item.canonical_root_id AND mention.workspace_id=$1::uuid
  LEFT JOIN root_rights rights ON rights.root_id=mention.id
  WHERE item.workspace_id=$1::uuid AND item.generation_id=$2::uuid
), period_roots AS MATERIALIZED (
  SELECT * FROM all_roots WHERE ($3::date IS NULL OR published_at>=$3::date)
    AND ($4::date IS NULL OR published_at<$4::date+interval '1 day')
), visible_terms AS MATERIALIZED (
  SELECT * FROM jsonb_to_recordset($5::jsonb) term(term_key text,definition_digest text,definition_revision int,visible boolean)
), all_memberships AS MATERIALIZED (
  SELECT DISTINCT ON(assignment.canonical_root_id,term.term_key) assignment.canonical_root_id root_id,term.term_key,visible.visible,
    CASE WHEN assignment.membership_basis='computed_cluster' THEN assignment.membership_metadata->'evidence_fragment' ELSE NULL END evidence_fragment
  FROM signal_classification_assignments assignment JOIN taxonomy_terms term ON term.id=assignment.taxonomy_term_id
  JOIN visible_terms visible ON visible.term_key=term.term_key AND visible.definition_digest=assignment.definition_digest
    AND visible.definition_revision=assignment.definition_revision
  JOIN source_generation generation ON generation.id=assignment.generation_id
  LEFT JOIN tagging_model_versions model ON model.id=assignment.model_version_id
  JOIN period_roots root ON root.root_id=assignment.canonical_root_id AND root.metrics
  WHERE assignment.workspace_id=$1::uuid AND assignment.generation_id=$2::uuid
    AND ((assignment.membership_basis='computed_cluster' AND assignment.resolution_method='model' AND assignment.disposition='pending'
        AND model.taxonomy_profile_id=generation.taxonomy_profile_id AND model.registry_contract_version='signal-tagging-model-registry-v1'
        AND model.artifact_digest=generation.input_snapshot->'identity'->>'engine_artifact_digest'
        AND model.configuration->'workspace_classification_identity'=generation.input_snapshot->'identity')
      OR (assignment.resolution_method='human' AND assignment.disposition='approved'
        AND signal_workspace_classification_assignment_current_v1(assignment,generation)))
    AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments correction WHERE correction.generation_id=assignment.generation_id
      AND correction.canonical_root_id=assignment.canonical_root_id AND correction.taxonomy_term_id=assignment.taxonomy_term_id
      AND correction.resolution_method='human' AND correction.disposition='rejected'
      AND signal_workspace_classification_assignment_current_v1(correction,generation))
  ORDER BY assignment.canonical_root_id,term.term_key,(assignment.resolution_method='human') DESC,assignment.created_at DESC,assignment.id DESC
), memberships AS MATERIALIZED (SELECT root_id,term_key,evidence_fragment FROM all_memberships WHERE visible),
root_membership AS MATERIALIZED (SELECT root_id,bool_or(visible) visible FROM all_memberships GROUP BY root_id),
population AS MATERIALIZED (
  SELECT root.*,COALESCE(member.visible,false) visible
  FROM period_roots root LEFT JOIN root_membership member USING(root_id)
)`;

function displayedTopics(ctx: Context, includeUnselected = false) {
  return ctx.topics.filter(topic => {
    const selected = ctx.selection.items[topic.term_key];
    return includeUnselected || selected?.selected && selected.definition_digest === topic.definition_digest;
  });
}
function populationParams(args: Args, ctx: Context) {
  const visible = new Set(displayedTopics(ctx, args.include_unselected).map(topic => topic.term_key));
  return [args.workspace_id, ctx.generation?.id ?? null, ctx.filters.date_from, ctx.filters.date_to,
    JSON.stringify(ctx.topics.map(topic => ({ term_key: topic.term_key, visible: visible.has(topic.term_key),
      definition_digest: topic.definition_digest, definition_revision: topic.definition_revision })))];
}
type Aggregate = { denominator: number; processed: number; assigned_unique: number; abstained: number; unresolved: number;
  withheld: number; rights_digest: string; date_from: string | null; date_to: string | null;
  counts: Array<{ term_key: string; mention_count: number }>; series: SignalWorkspaceTopicsOverviewV1["series"]; observed_at: string };
async function overview(client: PoolClient, args: Args, ctx: Context): Promise<SignalWorkspaceTopicsOverviewV1> {
  const summary = (await client.query<Aggregate>(`${populationSql}
    SELECT count(*) FILTER(WHERE root.metrics)::int denominator,count(*) FILTER(WHERE root.metrics)::int processed,
      count(*) FILTER(WHERE root.metrics AND root.visible)::int assigned_unique,
      count(*) FILTER(WHERE root.metrics AND root.resolution_state='abstained')::int abstained,
      count(*) FILTER(WHERE root.metrics AND root.has_unresolved_topics)::int unresolved,
      count(*) FILTER(WHERE NOT root.metrics)::int withheld,
      'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(jsonb_build_array(id,data_source_id,metrics,evidence)::text,
        '' ORDER BY id) FROM authorized_imports),''),'UTF8')),'hex') rights_digest,
      (SELECT to_char(min(published_at),'YYYY-MM-DD') FROM all_roots WHERE metrics) date_from,
      (SELECT to_char(max(published_at),'YYYY-MM-DD') FROM all_roots WHERE metrics) date_to,
      COALESCE((SELECT jsonb_agg(counts ORDER BY term_key) FROM (SELECT term_key,count(*)::int mention_count FROM memberships GROUP BY term_key) counts),'[]') counts,
      COALESCE((SELECT jsonb_agg(series ORDER BY date) FROM (SELECT to_char(published_at,'YYYY-MM-DD') date,count(*)::int mention_count,
        count(*) FILTER(WHERE visible)::int assigned_unique
        FROM population period WHERE metrics GROUP BY to_char(published_at,'YYYY-MM-DD')) series),'[]') series,
      to_char(statement_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at
    FROM population root`, populationParams(args, ctx))).rows[0]!;
  const counts = new Map(summary.counts.map(row => [row.term_key, row.mention_count]));
  const terms = displayedTopics(ctx, args.include_unselected).map(topic => ({ term_key: topic.term_key, label: topic.label,
    definition: topic.definition, definition_digest: topic.definition_digest, definition_revision: topic.definition_revision,
    selected: displayedTopics(ctx).some(selected => selected.term_key === topic.term_key),
    mention_count: counts.get(topic.term_key) ?? 0,
    share_of_corpus: summary.denominator ? (counts.get(topic.term_key) ?? 0) / summary.denominator : null,
    basis: "computed_cluster" as const }));
  return { contract_version: "signal-workspace-topics-serving-v1", source: "workspace_computed", workspace_id: args.workspace_id,
    corpus_id: null, scope: "all_conversations", generation_id: ctx.generation?.id ?? null,
    source_engine_execution_id: ctx.generation?.source_engine_execution_id ?? null, is_current: ctx.is_current, is_processing: ctx.is_processing,
    selection_revision: ctx.selection.revision, filters: ctx.filters,
    available_dates: { date_from: summary.date_from, date_to: summary.date_to },
    scope_digest: hash({ workspace: args.workspace_id, actor: args.actor_user_id, generation: ctx.generation?.finalized_digest,
      input_revision: ctx.generation?.current_revision, current: ctx.is_current, selection: ctx.selection,
      terms, filters: ctx.filters, rights: summary.rights_digest }), observed_at: summary.observed_at,
    denominator: summary.denominator, coverage: { processed: summary.processed, assigned_unique: summary.assigned_unique,
      abstained: summary.abstained, unresolved: summary.unresolved, withheld: summary.withheld },
    interpretation_coverage: workspaceTopicsInterpretationCoverageV1(ctx.generation?.interpretation_coverage),
    quality: "not_calibrated", terms, series: summary.series,
    limitations: ["computed_memberships_not_semantic_precision", "multilabel_counts_are_not_additive",
      ...(!ctx.generation ? ["classification_required"] : !ctx.is_current ? ["last_complete_generation_stale"] : []),
      ...(summary.withheld ? ["current_rights_withhold_mentions"] : [])] };
}

export async function loadSignalWorkspaceTopicsOverviewV1(args: Args): Promise<SignalWorkspaceTopicsOverviewV1 | null> {
  return transaction(args.database, async client => {
    const ctx = await context(client, args); return ctx.native ? overview(client, args, ctx) : null;
  });
}

export type SignalWorkspaceTopicDetailV1 = {
  contract_version: "signal-workspace-topic-detail-v1";
  workspace_id: string; generation_id: string; scope_digest: string; term_key: string;
  mention_count: number; undated_mentions: number;
  series: Array<{ date: string; mention_count: number }>;
  sentiment: { positive: number; neutral: number; negative: number; unclassified: number;
    meaning: "evidence_sentiment_not_topic_polarity" };
  related_topics: Array<{ term_key: string; label: string; shared_mentions: number }>;
  relationship_meaning: "cooccurrence_not_causality";
};

/** Uses the same selected, current, rights-filtered canonical roots as overview.
 * Counts are aggregate metrics, never extrapolated from the evidence page. */
export async function loadSignalWorkspaceTopicDetailV1(args: Omit<Args, "include_unselected"> & {
  term_key: string; expected_scope_digest: string;
}): Promise<SignalWorkspaceTopicDetailV1> {
  if (!args.term_key || args.term_key.length > 160 || !args.expected_scope_digest)
    return fail("workspace_topics_detail_request_invalid", 422);
  return transaction(args.database, async client => {
    const ctx = await context(client, args);
    if (!ctx.generation || !ctx.native || !displayedTopics(ctx).some(topic => topic.term_key === args.term_key))
      return fail("workspace_topics_topic_unavailable", 404);
    if (!ctx.is_current) return fail("workspace_topics_evidence_stale");
    const view = await overview(client, args, ctx);
    if (args.expected_scope_digest !== view.scope_digest) return fail("workspace_topics_scope_changed");
    const summary = (await client.query<{ mention_count: number; undated_mentions: number;
      positive: number; neutral: number; negative: number; unclassified: number;
      series: SignalWorkspaceTopicDetailV1["series"];
      related: Array<{ term_key: string; shared_mentions: number }> }>(`${populationSql},
      topic_roots AS MATERIALIZED (
        SELECT DISTINCT root.root_id,root.published_at,mention.sentiment_score
        FROM period_roots root JOIN memberships member ON member.root_id=root.root_id AND member.term_key=$6
        JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
        WHERE root.metrics
      )
      SELECT count(*)::int mention_count,count(*) FILTER(WHERE published_at IS NULL)::int undated_mentions,
        count(*) FILTER(WHERE sentiment_score > 0.2)::int positive,
        count(*) FILTER(WHERE sentiment_score BETWEEN -0.2 AND 0.2)::int neutral,
        count(*) FILTER(WHERE sentiment_score < -0.2)::int negative,
        count(*) FILTER(WHERE sentiment_score IS NULL)::int unclassified,
        COALESCE((SELECT jsonb_agg(point ORDER BY date) FROM (
          SELECT to_char(published_at,'YYYY-MM-DD') date,count(*)::int mention_count
          FROM topic_roots WHERE published_at IS NOT NULL GROUP BY to_char(published_at,'YYYY-MM-DD')
        ) point),'[]') series,
        COALESCE((SELECT jsonb_agg(relation ORDER BY shared_mentions DESC,term_key) FROM (
          SELECT member.term_key,count(DISTINCT root.root_id)::int shared_mentions
          FROM topic_roots root JOIN memberships member ON member.root_id=root.root_id
          WHERE member.term_key<>$6 GROUP BY member.term_key
          ORDER BY shared_mentions DESC,member.term_key LIMIT 20
        ) relation),'[]') related
      FROM topic_roots`, [...populationParams(args, ctx), args.term_key])).rows[0]!;
    const labels = new Map(view.terms.map(term => [term.term_key, term.label]));
    return { contract_version: "signal-workspace-topic-detail-v1", workspace_id: args.workspace_id,
      generation_id: ctx.generation.id, scope_digest: view.scope_digest, term_key: args.term_key,
      mention_count: summary.mention_count, undated_mentions: summary.undated_mentions, series: summary.series,
      sentiment: { positive: summary.positive, neutral: summary.neutral, negative: summary.negative,
        unclassified: summary.unclassified, meaning: "evidence_sentiment_not_topic_polarity" },
      related_topics: summary.related.flatMap(item => labels.has(item.term_key)
        ? [{ ...item, label: labels.get(item.term_key)! }] : []),
      relationship_meaning: "cooccurrence_not_causality" };
  });
}

/** Stable root UUID keyset. The cursor is only a locator, never authorization. */
export async function loadSignalWorkspaceTopicEvidenceV1(args: Omit<Args, "include_unselected"> & {
  term_key: string; cursor?: string | null; expected_scope_digest?: string | null; limit?: number;
}): Promise<SignalWorkspaceTopicEvidencePageV1> {
  const limit = args.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !args.term_key || args.term_key.length > 160) return fail("workspace_topics_evidence_request_invalid", 422);
  return transaction(args.database, async client => {
    const ctx = await context(client, args);
    if (!ctx.generation || !ctx.native || !displayedTopics(ctx).some(topic => topic.term_key === args.term_key)) return fail("workspace_topics_topic_unavailable", 404);
    if (!ctx.is_current) return fail("workspace_topics_evidence_stale");
    const view = await overview(client, args, ctx);
    if (args.expected_scope_digest && args.expected_scope_digest !== view.scope_digest) return fail("workspace_topics_scope_changed");
    let after: string | null = null;
    if (args.cursor) {
      try {
        if (args.cursor.length > 1024) return fail("workspace_topics_cursor_invalid", 422);
        const decoded = JSON.parse(Buffer.from(args.cursor, "base64url").toString("utf8")) as { root_id: string; scope: string; term: string };
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(decoded.root_id)
          || decoded.scope !== view.scope_digest || decoded.term !== args.term_key) return fail("workspace_topics_scope_changed");
        after = decoded.root_id;
      } catch (error) { if (error instanceof SignalWorkspaceTopicsServingError) throw error; return fail("workspace_topics_cursor_invalid", 422); }
    }
    const rows = (await client.query<SignalWorkspaceTopicEvidencePageV1["items"][number]>(`${populationSql}
      SELECT root.root_id mention_id,CASE WHEN member.evidence_fragment IS NOT NULL THEN signal_topic_utf16_fragment_v1(mention.text_clean,
        (member.evidence_fragment->>'start')::int,(member.evidence_fragment->>'end')::int) ELSE left(mention.text_clean,2000) END text,
        member.evidence_fragment,mention.platform,
        to_char(mention.published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at,mention.url
      FROM period_roots root JOIN memberships member ON member.root_id=root.root_id AND member.term_key=$6
      JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
      JOIN signal_classification_generations generation ON generation.id=$2::uuid
      JOIN signal_corpus_preparation_items prepared ON prepared.workspace_id=$1::uuid
        AND prepared.run_id=generation.preparation_run_id AND prepared.root_id=root.root_id
      WHERE root.evidence AND ($7::uuid IS NULL OR root.root_id>$7::uuid)
        AND prepared.asset_sha256=mention.text_clean_sha256
      ORDER BY root.root_id LIMIT $8`, [...populationParams(args, ctx), args.term_key, after, limit + 1])).rows;
    const items = rows.slice(0, limit);
    return { contract_version: "signal-workspace-topic-evidence-v1", workspace_id: args.workspace_id,
      generation_id: ctx.generation.id, term_key: args.term_key, scope_digest: view.scope_digest, items,
      next_cursor: rows.length > limit ? Buffer.from(JSON.stringify({ root_id: items.at(-1)!.mention_id,
        scope: view.scope_digest, term: args.term_key })).toString("base64url") : null };
  });
}

const mentionUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
type MentionsCursor = { version: 1; root_id: string; occurred_at: string | null; scope: string; offset: number };
function mentionsRequest(args: SignalWorkspaceMentionsArgsV1) {
  const limit = args.limit ?? 50, direction = args.sort_direction ?? "desc";
  if (!mentionUuid.test(args.workspace_id) || !mentionUuid.test(args.actor_user_id)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !["asc", "desc"].includes(direction)
    || args.search_query != null && (typeof args.search_query !== "string" || args.search_query.length > 300 || args.search_query.includes("\0"))
    || args.platforms !== undefined && (!Array.isArray(args.platforms) || args.platforms.length > 32
      || args.platforms.some(value => typeof value !== "string" || !value.trim() || value.length > 100 || value.includes("\0")))
    || args.focus_mention_id != null && (!mentionUuid.test(args.focus_mention_id) || args.cursor != null)
    || args.expected_scope_digest != null && !/^sha256:[a-f0-9]{64}$/u.test(args.expected_scope_digest))
    return fail("workspace_mentions_request_invalid", 422);
  const filters = { date_from: parseDate(args.date_from), date_to: parseDate(args.date_to),
    search_query: args.search_query?.trim() || null,
    platforms: [...new Set((args.platforms ?? []).map(value => value.trim().toLowerCase()))].sort() };
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) return fail("workspace_topics_date_invalid", 422);
  let cursor: MentionsCursor | null = null;
  if (args.cursor != null) {
    try {
      if (typeof args.cursor !== "string" || args.cursor.length > 2048 || !/^[a-zA-Z0-9_-]+$/u.test(args.cursor))
        return fail("workspace_mentions_cursor_invalid", 422);
      const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(args.cursor, "base64url")));
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return fail("workspace_mentions_cursor_invalid", 422);
      const row = decoded as MentionsCursor;
      if (Object.keys(row).sort().join(",") !== "occurred_at,offset,root_id,scope,version" || row.version !== 1
        || typeof row.root_id !== "string" || !mentionUuid.test(row.root_id)
        || typeof row.scope !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(row.scope)
        || !Number.isSafeInteger(row.offset) || row.offset < 0 || row.offset > Number.MAX_SAFE_INTEGER - limit
        || row.occurred_at !== null && (typeof row.occurred_at !== "string"
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(row.occurred_at)
          || !Number.isFinite(Date.parse(row.occurred_at))
          || new Date(row.occurred_at).toISOString().slice(0, 10) !== row.occurred_at.slice(0, 10))) return fail("workspace_mentions_cursor_invalid", 422);
      cursor = { ...row, root_id: row.root_id.toLowerCase() };
    } catch (error) { if (error instanceof SignalWorkspaceTopicsServingError) throw error; return fail("workspace_mentions_cursor_invalid", 422); }
  }
  return { limit, direction, filters, cursor, focus: args.focus_mention_id?.toLowerCase() ?? null };
}

/** A global generation population, independent of selected Topics. Text rights
 * and prepared SHA are checked before searching or returning canonical content.
 * Only root metadata is materialized; complete document bodies stay in Postgres. */
const mentionsPopulationSql = `${populationSql}, mention_roots AS MATERIALIZED (
  SELECT checked.*,hashtextextended(ROW(checked.root_id,checked.metrics,checked.evidence,
    checked.text_valid,extract(epoch FROM checked.published_at),checked.platform)::text,0::bigint) population_hash
  FROM (
    SELECT root.*,COALESCE(mention.resolved_platform,mention.platform) platform,
      CASE WHEN root.evidence THEN COALESCE(prepared.asset_sha256=mention.text_clean_sha256,false) ELSE false END text_valid
    FROM period_roots root JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
    JOIN source_generation generation ON true
    LEFT JOIN signal_corpus_preparation_items prepared ON prepared.workspace_id=$1::uuid
      AND prepared.run_id=generation.preparation_run_id AND prepared.root_id=root.root_id
  ) checked
), visible_mentions AS MATERIALIZED (
  SELECT root.* FROM mention_roots root WHERE root.metrics AND root.evidence AND root.text_valid
), filtered_mentions AS MATERIALIZED (
  SELECT root.* FROM visible_mentions root JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
  WHERE ($6::text IS NULL OR strpos(lower(mention.text_clean),lower($6::text))>0)
    AND (cardinality($7::text[])=0 OR lower(btrim(root.platform))=ANY($7::text[]))
)`;
type MentionsSummary = {
  metric_denominator: number; evidence_visible_total: number; total_count: number;
  withheld_evidence_count: number; integrity_withheld_count: number; rights_digest: string;
  population_fingerprint_xor: string; population_fingerprint_sum: string;
  date_from: string | null; date_to: string | null; available_platforms: string[]; cursor_exists: boolean; cursor_offset: number;
};

/** List or focus only roots in the same current native generation as Signal.
 * Cursor data locates a page; every request repeats scope and rights checks. */
export async function loadSignalWorkspaceMentionsV1(args: SignalWorkspaceMentionsArgsV1): Promise<SignalWorkspaceMentionsPageV1 | null> {
  const request = mentionsRequest(args);
  const access = { database: args.database, workspace_id: args.workspace_id.toLowerCase(), actor_user_id: args.actor_user_id.toLowerCase(),
    date_from: request.filters.date_from, date_to: request.filters.date_to };
  return mentionsTransaction(args.database, async client => {
    const ctx = await mentionsContext(client, access);
    if (!ctx.native) return null;
    if (!ctx.generation) return fail("workspace_mentions_generation_unavailable", 404);
    if (!ctx.is_current) return fail("workspace_mentions_stale");
    // The transaction wrapper disables nested loops and JIT before this query:
    // skewed workspace estimates otherwise choose a quadratic plan and compile it.
    // Empty visible_terms intentionally avoids every membership/selection join.
    const params = [access.workspace_id, ctx.generation.id, ctx.filters.date_from, ctx.filters.date_to, "[]",
      request.filters.search_query, request.filters.platforms];
    const direction = request.direction === "asc" ? "ASC" : "DESC", operator = request.direction === "asc" ? ">" : "<";
    const before = request.direction === "asc" ? "<" : ">";
    const result = await client.query<MentionsSummary & { item: SignalWorkspaceMentionV1 | null; focus_only: boolean | null }>(`${mentionsPopulationSql},
      summary AS MATERIALIZED (
      SELECT count(*) FILTER(WHERE root.metrics)::int metric_denominator,
        count(*) FILTER(WHERE root.metrics AND root.evidence AND root.text_valid)::int evidence_visible_total,
        (SELECT count(*)::int FROM filtered_mentions) total_count,
        count(*) FILTER(WHERE root.metrics AND NOT root.evidence)::int withheld_evidence_count,
        count(*) FILTER(WHERE root.metrics AND root.evidence AND NOT root.text_valid)::int integrity_withheld_count,
        'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(jsonb_build_array(id,data_source_id,metrics,evidence)::text,
          '' ORDER BY id) FROM authorized_imports),''),'UTF8')),'hex') rights_digest,
        COALESCE(bit_xor(root.population_hash),0)::text population_fingerprint_xor,
        COALESCE(sum(root.population_hash::numeric),0)::text population_fingerprint_sum,
        (SELECT to_char(min(published_at),'YYYY-MM-DD') FROM all_roots WHERE metrics) date_from,
        (SELECT to_char(max(published_at),'YYYY-MM-DD') FROM all_roots WHERE metrics) date_to,
        ARRAY(SELECT DISTINCT lower(btrim(platform)) FROM visible_mentions
          WHERE platform IS NOT NULL AND btrim(platform)<>'' ORDER BY 1) available_platforms,
        ($8::uuid IS NULL OR EXISTS(SELECT 1 FROM filtered_mentions cursor_root WHERE cursor_root.root_id=$8::uuid
          AND cursor_root.published_at IS NOT DISTINCT FROM $9::timestamptz)) cursor_exists,
        (SELECT count(*)::int FROM filtered_mentions prior WHERE $8::uuid IS NOT NULL AND
          (($9::timestamptz IS NULL AND (prior.published_at IS NOT NULL OR prior.root_id<=$8::uuid))
           OR ($9::timestamptz IS NOT NULL AND (prior.published_at ${before} $9::timestamptz
             OR (prior.published_at=$9::timestamptz AND prior.root_id<=$8::uuid))))) cursor_offset
      FROM mention_roots root
    ), page AS MATERIALIZED (
      SELECT root.* FROM filtered_mentions root
      WHERE ($8::uuid IS NULL OR ($9::timestamptz IS NULL AND root.published_at IS NULL AND root.root_id>$8::uuid)
        OR ($9::timestamptz IS NOT NULL AND (root.published_at IS NULL OR root.published_at ${operator} $9::timestamptz
          OR (root.published_at=$9::timestamptz AND root.root_id>$8::uuid))))
      ORDER BY root.published_at ${direction} NULLS LAST,root.root_id ASC LIMIT $11
    ), selected AS MATERIALIZED (
      SELECT root.*,false focus_only FROM page root
      UNION ALL
      SELECT root.*,true focus_only FROM filtered_mentions root
      WHERE $10::uuid IS NOT NULL AND root.root_id=$10::uuid
        AND NOT EXISTS(SELECT 1 FROM page listed WHERE listed.root_id=root.root_id)
    ) SELECT summary.*,
      CASE WHEN root.root_id IS NULL THEN NULL ELSE jsonb_build_object(
        'mention_id',root.root_id,'occurred_at',to_char(root.published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'text_snippet',left(mention.text_clean,2000),'text_truncated',char_length(mention.text_clean)>2000,
        'title',mention.title,'url',mention.url,'platform',root.platform,'language',mention.language,'country',mention.country,
        'content_type',mention.content_type,'engagement',CASE WHEN jsonb_typeof(mention.engagement)='object' THEN mention.engagement ELSE '{}'::jsonb END,
        'thread_key',COALESCE(NULLIF(mention.raw_metadata->'row'->>'thread id',''),mention.id::text),
        'resolution_state',root.resolution_state,'has_unresolved_topics',root.has_unresolved_topics) END item,
      root.focus_only
      FROM summary LEFT JOIN selected root ON true
      LEFT JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
      ORDER BY root.focus_only NULLS LAST,root.published_at ${direction} NULLS LAST,root.root_id ASC`,
      [...params, request.cursor?.root_id ?? null, request.cursor?.occurred_at ?? null, request.focus, request.limit + 1]);
    const summary = result.rows[0]!;
    const scope = hash({ contract_version: "signal-workspace-mentions-v1", workspace: access.workspace_id, actor: access.actor_user_id,
      generation: ctx.generation.id, finalized_digest: ctx.generation.finalized_digest, input_revision: ctx.generation.current_revision,
      rights: summary.rights_digest, population: {
        fingerprint: { xor: summary.population_fingerprint_xor, sum: summary.population_fingerprint_sum },
        metric_denominator: summary.metric_denominator, evidence_visible_total: summary.evidence_visible_total,
        withheld_evidence_count: summary.withheld_evidence_count, integrity_withheld_count: summary.integrity_withheld_count
      }, filters: request.filters, direction: request.direction });
    if (args.expected_scope_digest && args.expected_scope_digest !== scope || request.cursor && request.cursor.scope !== scope
      || !summary.cursor_exists || request.cursor && request.cursor.offset !== summary.cursor_offset) return fail("workspace_mentions_scope_changed");
    const rows = result.rows.flatMap(row => row.item ? [{ ...row.item, focus_only: Boolean(row.focus_only) }] : []);
    const listed = rows.filter(row => !row.focus_only);
    const focused = request.focus ? rows.find(row => row.mention_id.toLowerCase() === request.focus) : undefined;
    if (request.focus && !focused) return fail("workspace_mentions_mention_unavailable", 404);
    const clean = ({ focus_only: _focusOnly, ...row }: SignalWorkspaceMentionV1 & { focus_only: boolean }) => row;
    const items = listed.slice(0, request.limit).map(clean), focusedItem = focused ? clean(focused) : null;
    const offset = request.cursor?.offset ?? 0, last = items.at(-1);
    return { contract_version: "signal-workspace-mentions-v1", workspace_id: access.workspace_id, generation_id: ctx.generation.id,
      source_engine_execution_id: ctx.generation.source_engine_execution_id, is_current: true, is_processing: ctx.is_processing,
      scope_digest: scope, filters: request.filters, sort: { field: "published", direction: request.direction },
      available_dates: { date_from: summary.date_from, date_to: summary.date_to }, available_platforms: summary.available_platforms,
      metric_denominator: summary.metric_denominator,
      evidence_visible_total: summary.evidence_visible_total, total_count: summary.total_count,
      withheld_evidence_count: summary.withheld_evidence_count, integrity_withheld_count: summary.integrity_withheld_count,
      items, ...(request.focus ? { focused_item: focusedItem } : {}), page_offset: offset,
      next_cursor: listed.length > request.limit && last
        ? Buffer.from(JSON.stringify({ version: 1, root_id: last.mention_id, occurred_at: last.occurred_at,
          scope, offset: offset + items.length } satisfies MentionsCursor)).toString("base64url") : null };
  });
}
