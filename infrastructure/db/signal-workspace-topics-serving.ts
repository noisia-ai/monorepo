import { inspectFacetContextChangeV1 } from "./signal-mention-facets";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  signalTopicDefinitionSchemaV1,
  type SignalTopicDefinitionV1,
  type SignalWorkspaceTopicsOverviewV1,
  type SignalWorkspaceOverviewV1,
  type SignalWorkspaceImportedIdentityV1,
  type SignalWorkspaceTopicEvidencePageV1,
  type SignalWorkspaceClassificationIdentityV1
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { loadSignalWorkspaceClassificationInputV1, SignalWorkspaceClassificationError } from "./signal-workspace-classification";
import { loadSignalTopicWorkingProfileWithQueryableV1 } from "./signal-topic-catalog";
import { readSignalTopicConsolidationServingBindingV1, type SignalTopicConsolidationServingSnapshotV1 } from "./signal-topic-consolidation-activation";

type Database = Pick<Pool, "connect">;
type CivilFilters = { date_from: string | null; date_to: string | null; timezone: string };
type Filters = { date_from?: string | null; date_to?: string | null; timezone?: string };
type Args = Filters & { database: Database; workspace_id: string; actor_user_id: string; include_unselected?: boolean; imported_fallback?: boolean };
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
  filters: { date_from: string | null; date_to: string | null; timezone?: string; search_query: string | null; platforms: string[] };
  sort: { field: "published"; direction: "asc" | "desc" };
  available_dates: { date_from: string | null; date_to: string | null };
  available_platforms: string[];
  metric_denominator: number; evidence_visible_total: number; total_count: number;
  withheld_evidence_count: number; integrity_withheld_count: number;
  items: SignalWorkspaceMentionV1[]; focused_item?: SignalWorkspaceMentionV1 | null;
  page_offset: number; next_cursor: string | null;
};
/** Opt-in imported results leave the existing generation contract unchanged. */
export type SignalWorkspaceImportedMentionsPageV1 = Omit<SignalWorkspaceMentionsPageV1,
  "generation_id" | "source_engine_execution_id" | "items" | "focused_item"> & SignalWorkspaceImportedIdentityV1 & {
  items: SignalWorkspaceImportedMentionV1[]; focused_item?: SignalWorkspaceImportedMentionV1 | null;
};
export type SignalWorkspaceImportedMentionV1 = Omit<SignalWorkspaceMentionV1, "resolution_state" | "has_unresolved_topics"> & {
  resolution_state: null; has_unresolved_topics: null;
};
export type SignalWorkspaceMentionsResultV1 = SignalWorkspaceMentionsPageV1 | SignalWorkspaceImportedMentionsPageV1;
type ImportedPopulation = { receipt_digest: string; input_revision: string | null };
type Selection = { revision: number; items: Record<string, { selected: boolean; definition_digest: string;
  definition_revision: number; generation_id: string | null }> };
type Generation = { id: string; taxonomy_profile_id: string | null; preparation_run_id: string;
  input_revision: string; current_revision: string; finalized_digest: string; policy_live: boolean;
  source_engine_execution_id: string; interpretation_coverage: unknown; identity: SignalWorkspaceClassificationIdentityV1 | null;
  correction_digest: string; source_valid: boolean };
type CatalogTerm = SignalTopicDefinitionV1 & { kind: "topic" | "narrative" };
type DefinedInterest = { selection: SignalWorkspaceDefinedInterestOverlayV1; topic: CatalogTerm;
  generation_id: string; preparation_run_id: string; finalized_digest: string };
type Context = { generation: Generation | null; topics: CatalogTerm[]; selection: Selection;
  is_current: boolean; is_processing: boolean; filters: CivilFilters;
  native: boolean; consolidated: boolean; imported?: ImportedPopulation;
  defined_interests?: DefinedInterest[]; concept_membership?: boolean; membership_run_id?: string | null; membership_state_digest?: string };

/** A defined interest has its own durable selection, separate from SQL0181's
 * consolidated concepts. Currentness and authority are rechecked at read. */
export type SignalWorkspaceDefinedInterestOverlayV1 = {
  workspace_id: string; snapshot_id: string | null; generation_id: string; taxonomy_term_id: string;
  term_key: string; definition_digest: string; definition_revision: number;
  selected: true; selection_revision: number; selection_digest: string;
};
const overlayUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const overlayDigest = /^sha256:[0-9a-f]{64}$/u;
/** SQL fragment for a selected, finalized interest. The ordinary path uses
 * this only after reading the SQL0212 receipt and currentness fence. */
export function prepareSignalWorkspaceDefinedInterestOverlayV1(args: {
  selection: SignalWorkspaceDefinedInterestOverlayV1; workspace_id: string; snapshot_id: string | null;
  existing_term_keys: readonly string[];
}): { visible_term: Record<string, unknown>; population_sql: string } {
  const row = args.selection;
  if (!overlayUuid.test(args.workspace_id) || args.snapshot_id !== null && !overlayUuid.test(args.snapshot_id)
    || row.workspace_id !== args.workspace_id || row.snapshot_id !== null && row.snapshot_id !== args.snapshot_id
    || !overlayUuid.test(row.generation_id) || !overlayUuid.test(row.taxonomy_term_id)
    || !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(row.term_key) || args.existing_term_keys.includes(row.term_key)
    || !overlayDigest.test(row.definition_digest) || !overlayDigest.test(row.selection_digest)
    || !Number.isSafeInteger(row.definition_revision) || row.definition_revision < 1
    || !Number.isSafeInteger(row.selection_revision) || row.selection_revision < 1 || row.selected !== true)
    return fail("workspace_defined_interest_selection_invalid", 422);
  return { visible_term: { term_key: row.term_key, definition_digest: row.definition_digest,
    definition_revision: row.definition_revision, visible: true, interest_generation_id: row.generation_id,
    interest_taxonomy_term_id: row.taxonomy_term_id }, population_sql: populationSql(args.snapshot_id === null, true, args.snapshot_id !== null) };
}

export class SignalWorkspaceTopicsServingError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalWorkspaceTopicsServingError"; }
}
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceTopicsServingError(code, status); };
const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
function parseTimezone(value: string | null | undefined): string {
  const timezone = value?.trim() || "UTC";
  // Invalid legacy workspaces stay readable while new inputs are validated on
  // write. UTC is the explicit compatibility fallback for native date views.
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); return timezone; }
  catch { return "UTC"; }
}
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
    // The population joins have highly skewed workspace estimates. The default
    // nested-loop/JIT plan took 21-40s for Alexa+ Topics, detail and evidence;
    // the same read-only queries took 2-4s with these transaction-local settings.
    await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
      SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,extensions,pg_temp;
      SET LOCAL enable_nestloop=off; SET LOCAL jit=off`);
    const value = await work(client); await client.query("COMMIT"); return value;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
function consolidatedContext(snapshot: SignalTopicConsolidationServingSnapshotV1, filters: Context["filters"]): Context {
  const topics = snapshot.catalog.map(item => ({ ...signalTopicDefinitionSchemaV1.parse({ term_key: item.term_key,
    label: item.label, definition: item.definition, scope: "all_conversations", inclusion: [], exclusion: [],
    positive_examples: [], negative_examples: [], lifecycle: "draft", origin: "workspace_discovery", discovery_guidance: false,
    source: { run_key: `consolidation:${snapshot.revision_id}`, candidate_key: item.concept_id, candidate_digest: item.semantic_identity_digest },
    definition_revision: item.definition_revision, definition_digest: item.definition_digest, created_at: item.created_at, updated_at: item.updated_at }),
    kind: item.kind }));
  return { generation: { id: snapshot.id, taxonomy_profile_id: null, preparation_run_id: snapshot.preparation_run_id,
    input_revision: snapshot.input_revision, current_revision: snapshot.current_revision, finalized_digest: snapshot.snapshot_digest,
    policy_live: snapshot.source_valid, source_engine_execution_id: snapshot.source_engine_execution_id,
    interpretation_coverage: { interpreted_unit_count: snapshot.expected_group_count, expected_unit_count: snapshot.expected_group_count, complete: true },
    identity: null, correction_digest: snapshot.revision_digest, source_valid: snapshot.source_valid }, topics,
    selection: { revision: snapshot.binding.selection_revision, items: snapshot.binding.selection },
    is_current: snapshot.source_valid && snapshot.input_revision === snapshot.current_revision,
    is_processing: false, filters, native: true, consolidated: true };
}
/** Only absence of publication permits an imported fallback. A stale or otherwise
 * unavailable prior publication must keep its original failure semantics. The
 * caller resolves legacy serving before opting in; this is not a legacy resolver. */
async function importedPopulation(client: PoolClient, args: Args): Promise<ImportedPopulation | undefined> {
  if (!args.imported_fallback) return undefined;
  const row = (await client.query<ImportedPopulation>(`SELECT
    'sha256:'||encode(sha256(convert_to(string_agg(batch.id::text||':'||batch.data_source_id::text||':'||source.status,
      ',' ORDER BY batch.id),'UTF8')),'hex') receipt_digest,
    (SELECT input_revision::text FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid) input_revision
    FROM import_batches batch JOIN data_sources source ON source.id=batch.data_source_id
      AND source.workspace_id=$1::uuid
    WHERE batch.workspace_id=$1::uuid AND batch.status='completed'
      AND NOT EXISTS(SELECT 1 FROM signal_classification_generations prior WHERE prior.workspace_id=$1::uuid
        AND prior.status='ready' AND prior.input_snapshot->'source_projection' IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_bindings prior WHERE prior.workspace_id=$1::uuid)
    HAVING count(*)>0`, [args.workspace_id])).rows[0];
  return row ?? undefined;
}
type SelectedInterestRow = SignalWorkspaceDefinedInterestOverlayV1 & {
  current: boolean; topic_definition: unknown; preparation_run_id: string; finalized_digest: string;
  taxonomy_profile_id: string; identity: SignalWorkspaceClassificationIdentityV1 | null; correction_digest: string | null;
};
/** The selected receipt is historical; only a current approval with present
 * display rights and an unchanged semantic input may enter Signal. The SQL
 * predicate also fences revoked provenance, policy and current corpus roots. */
async function withDefinedInterests(client: PoolClient, args: Args, base: Context): Promise<Context> {
  if (!base.is_current || !base.generation && !base.imported) return base;
  const rows = (await client.query<SelectedInterestRow>(`SELECT selected.workspace_id,selected.snapshot_id,
    selected.generation_id,selected.taxonomy_term_id,selected.term_key,selected.definition_digest,
    selected.definition_revision,selected.selected,selected.selection_revision,selected.selection_digest,
    signal_defined_interest_selection_current_v1(selected.workspace_id,selected.term_key) current,
    term.metadata->'topic' topic_definition,generation.preparation_run_id,generation.finalized_digest,
    generation.taxonomy_profile_id,generation.input_snapshot->'identity' identity,
    generation.input_snapshot->>'correction_digest' correction_digest
    FROM signal_defined_interest_selections selected
    JOIN signal_classification_generations generation ON generation.id=selected.generation_id
      AND generation.workspace_id=selected.workspace_id
    JOIN taxonomy_terms term ON term.id=selected.taxonomy_term_id
    WHERE selected.workspace_id=$1::uuid AND selected.selected
    ORDER BY selected.term_key`, [args.workspace_id])).rows;
  if (!rows.length) return base;
  const snapshotId = base.consolidated ? base.generation?.id ?? null : null;
  const existing = new Set(base.topics.map(topic => topic.term_key));
  const interests: DefinedInterest[] = [];
  for (const row of rows) {
    if (!row.current || row.snapshot_id !== null && row.snapshot_id !== snapshotId || existing.has(row.term_key)
      || !row.identity || !row.correction_digest) continue;
    const parsed = signalTopicDefinitionSchemaV1.safeParse(row.topic_definition);
    if (!parsed.success || parsed.data.term_key !== row.term_key || parsed.data.definition_digest !== row.definition_digest
      || parsed.data.definition_revision !== row.definition_revision || parsed.data.lifecycle === "archived") continue;
    const input = await loadSignalWorkspaceClassificationInputV1({ queryable: client,
      workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, interest_term_key: row.term_key }).catch(error => {
      if (error instanceof SignalWorkspaceClassificationError && ["workspace_classification_catalog_unavailable",
        "workspace_classification_interest_unavailable"].includes(error.code)) return null;
      throw error;
    });
    if (!input || input.taxonomy_profile_id !== row.taxonomy_profile_id
      || input.correction_digest !== row.correction_digest
      || input.catalog_digest !== row.identity.catalog_digest || input.context_digest !== row.identity.context_digest
      || input.compiler_digest !== row.identity.compiler_digest
      || input.embedding_config_digest !== row.identity.embedding_config_digest) continue;
    const selection: SignalWorkspaceDefinedInterestOverlayV1 = { workspace_id: row.workspace_id,
      snapshot_id: row.snapshot_id, generation_id: row.generation_id, taxonomy_term_id: row.taxonomy_term_id,
      term_key: row.term_key, definition_digest: row.definition_digest, definition_revision: row.definition_revision,
      selected: true, selection_revision: row.selection_revision, selection_digest: row.selection_digest };
    prepareSignalWorkspaceDefinedInterestOverlayV1({ selection, workspace_id: args.workspace_id,
      snapshot_id: snapshotId, existing_term_keys: [...existing] });
    interests.push({ selection, topic: { ...parsed.data, kind: "topic" }, generation_id: row.generation_id,
      preparation_run_id: row.preparation_run_id, finalized_digest: row.finalized_digest });
    existing.add(row.term_key);
  }
  if (!interests.length) return base;
  const interestSelection = Object.fromEntries(interests.map(({ selection }) => [selection.term_key,
    { selected: true, definition_digest: selection.definition_digest,
      definition_revision: selection.definition_revision, generation_id: selection.generation_id }]));
  return { ...base, topics: [...base.topics, ...interests.map(item => item.topic)],
    selection: { ...base.selection, items: { ...base.selection.items, ...interestSelection } },
    defined_interests: interests, native: true };
}
/** MFP consumes current per-root decisions independently of frozen V2 generations. */
async function membershipContext(client: PoolClient, args: Args, filters: CivilFilters): Promise<Context> {
  const binding = await readSignalTopicConsolidationServingBindingV1(client, args.workspace_id);
  const base = binding?.snapshot?.source_valid && binding.snapshot.input_revision===binding.snapshot.current_revision ? consolidatedContext(binding.snapshot, filters) : null;
  const rows = (await client.query<{topic:unknown; selected:boolean; selection_revision:number; selection_digest:string|null}>(`
    SELECT c.topic,COALESCE(s.selected AND s.definition_digest=c.definition_digest,false) selected,
      COALESCE(s.selection_revision,0)::int selection_revision,s.selection_digest
    FROM signal_membership_concepts_v1 c LEFT JOIN signal_defined_interest_selections s ON s.workspace_id=c.workspace_id
      AND s.term_key=c.concept_key AND s.generation_id IS NULL WHERE c.workspace_id=$1 ORDER BY c.concept_key`,[args.workspace_id])).rows;
  const topics=rows.map(r=>({...signalTopicDefinitionSchemaV1.parse(r.topic),kind:"topic" as const}));
  const keys=new Set(topics.map(t=>t.term_key));
  const change=await inspectFacetContextChangeV1(client,args.workspace_id);
  const membershipState=(await client.query<{digest:string}>(`SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(jsonb_build_array(root_id,concept_key,root_fingerprint,definition_digest,labeler_digest,entity_context_digest,effective_entities_digest,verdict,source,call_id,updated_at)::text,'' ORDER BY root_id,concept_key),''),'UTF8')),'hex') digest FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1`,[args.workspace_id])).rows[0]!.digest;
  const state=(await client.query<{input_revision:string; run_id:string|null; processing:boolean}>(`
    SELECT s.input_revision::text,(SELECT id FROM signal_labeling_runs WHERE workspace_id=s.workspace_id AND kind='membership'
      AND NOT COALESCE((membership_snapshot->>'preview')::boolean,false) ORDER BY created_at DESC LIMIT 1) run_id,
    EXISTS(SELECT 1 FROM signal_labeling_runs WHERE workspace_id=s.workspace_id AND kind='membership' AND status IN('queued','running')) processing
    FROM signal_corpus_preparation_input_state s WHERE s.workspace_id=$1`,[args.workspace_id])).rows[0];
  const selected=Object.fromEntries(topics.map((t,i)=>[t.term_key,{selected:rows[i]!.selected,definition_digest:t.definition_digest,definition_revision:t.definition_revision,generation_id:null}]));
  return {generation:base?.generation??null,topics:[...(base?.topics.filter(t=>!keys.has(t.term_key))??[]),...topics],
    selection:{revision:Math.max(base?.selection.revision??0,...rows.map(r=>r.selection_revision)),items:{...base?.selection.items,...selected}},
    is_current:(!change.changed || change.affected.length===0),is_processing:state?.processing??false,filters,native:true,consolidated:!!base,
    ...(base?{}:{imported:{receipt_digest:hash({revision:state?.input_revision,selections:rows.map(r=>r.selection_digest)}),input_revision:state?.input_revision??null}}),
    concept_membership:true,membership_run_id:state?.run_id??null,membership_state_digest:hash({membershipState,context:change.digest})};
}
async function context(client: PoolClient, args: Args): Promise<Context> {
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
  if (!capabilities.can_view || args.include_unselected && !capabilities.can_edit_topics) return fail("workspace_topics_forbidden", 403);
  const filters = { date_from: parseDate(args.date_from), date_to: parseDate(args.date_to), timezone: parseTimezone(args.timezone) };
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) return fail("workspace_topics_date_invalid", 422);
  if (process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED === "true") return membershipContext(client,args,filters);
  const binding = await readSignalTopicConsolidationServingBindingV1(client, args.workspace_id);
  if (binding?.snapshot) return withDefinedInterests(client, args, consolidatedContext(binding.snapshot, filters));
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
      AND (NOT $3::boolean OR generation.id=$2::uuid)
    ORDER BY generation.generation_version DESC LIMIT 1`, [args.workspace_id, binding?.binding.legacy_generation_id ?? null, binding !== null])).rows[0] ?? null;
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
    return { ...(working && working.definition_digest === topic.definition_digest && working.lifecycle === topic.lifecycle
      ? { ...topic, label: working.label, updated_at: working.updated_at }
      : topic), kind: "topic" as const };
  }).filter(topic => topic.lifecycle !== "archived");
  let isCurrent = false;
  if (generation?.taxonomy_profile_id && generation.identity) {
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
  const imported = !generation && !binding ? await importedPopulation(client, args) : undefined;
  return withDefinedInterests(client, args, { generation, topics: imported ? [] : topics, selection: imported ? { revision: 0, items: {} } : selection,
    is_current: imported ? true : isCurrent, is_processing: workspace.is_processing, filters, imported,
    native: Boolean(imported) || workspace.native || topics.some(topic => topic.origin === "workspace_discovery"), consolidated: false });
}

/** Mentions are a generation-wide corpus view and do not consume Topic labels,
 * working drafts, compiled guides or live Brand Context. Its currentness fence
 * is the sealed projection plus the corpus revision and policy already used by
 * the population query. Keeping this path separate avoids rebuilding unrelated
 * editorial input on every page while retaining workspace authorization. */
async function mentionsContext(client: PoolClient, args: Args): Promise<Pick<Context,
  "generation" | "is_current" | "is_processing" | "filters" | "native" | "imported">> {
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
  if (!capabilities.can_view) return fail("workspace_topics_forbidden", 403);
  const filters = { date_from: parseDate(args.date_from), date_to: parseDate(args.date_to), timezone: parseTimezone(args.timezone) };
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) return fail("workspace_topics_date_invalid", 422);
  const binding = await readSignalTopicConsolidationServingBindingV1(client, args.workspace_id);
  if (binding?.snapshot) return consolidatedContext(binding.snapshot, filters);
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
        AND (NOT $3::boolean OR candidate.id=$2::uuid)
      ORDER BY candidate.generation_version DESC LIMIT 1
    ) generation ON true
    LEFT JOIN signal_corpus_preparation_input_state state ON state.workspace_id=workspace.id
    WHERE workspace.id=$1::uuid`, [args.workspace_id, binding?.binding.legacy_generation_id ?? null, binding !== null])).rows[0];
  const generation = row?.id ? row : null;
  const imported = !generation && !binding ? await importedPopulation(client, args) : undefined;
  return { generation, imported, is_processing: row?.is_processing ?? false, native: Boolean(imported) || (row?.native ?? false), filters,
    is_current: Boolean(imported) || Boolean(generation?.source_valid && generation.policy_live
      && generation.input_revision === generation.current_revision) };
}

/** Current rights use one complete provenance path, including import precedence.
 * Authorization to compute never substitutes for rights to display metrics/text. */
const populationSql = (imported = false, definedInterest = false, consolidated = false, membership = false) => `WITH source_generation AS MATERIALIZED (
  SELECT generation.id,generation.workspace_id,generation.preparation_run_id,generation.input_snapshot
    FROM signal_classification_generations generation WHERE generation.id=$2::uuid
    AND generation.workspace_id=$1::uuid AND signal_workspace_projection_source_current_v1(generation)
  UNION ALL
  SELECT snapshot.id,snapshot.workspace_id,snapshot.preparation_run_id,'{}'::jsonb
    FROM signal_topic_consolidation_snapshots snapshot WHERE snapshot.id=$2::uuid AND snapshot.workspace_id=$1::uuid
    AND signal_topic_consolidation_snapshot_current_v1(snapshot.id)
), received_imports AS MATERIALIZED (
  SELECT batch.id,batch.data_source_id FROM import_batches batch
  JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1::uuid AND source.status='active'
  WHERE batch.workspace_id=$1::uuid AND batch.status='completed'
), authorized_imports AS MATERIALIZED (
  SELECT batch.id,batch.data_source_id,
    EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-derived-metrics' AND usage.decision='allowed') metrics,
    (EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-mention-list' AND usage.decision='allowed')
     AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-text-or-excerpt' AND usage.decision='allowed')) evidence
  FROM received_imports batch
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
), root_rights AS MATERIALIZED (
  SELECT origin.canonical_mention_id root_id,bool_or(rights.metrics) metrics,bool_or(rights.metrics AND rights.evidence) evidence
  FROM authorized_imports rights JOIN signal_mention_import_memberships path ON path.import_batch_id=rights.id
    AND path.data_source_id=rights.data_source_id AND path.workspace_id=$1::uuid
  JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=$1::uuid
  GROUP BY origin.canonical_mention_id
), received_roots AS MATERIALIZED (
  SELECT DISTINCT origin.canonical_mention_id root_id
  FROM received_imports batch JOIN signal_mention_import_memberships path ON path.import_batch_id=batch.id
    AND path.data_source_id=batch.data_source_id AND path.workspace_id=$1::uuid
  JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=$1::uuid
), all_roots AS MATERIALIZED (
  ${imported ? `SELECT mention.id root_id,NULL::text resolution_state,mention.published_at,NULL::boolean has_unresolved_topics,
    COALESCE(rights.metrics,false) metrics,COALESCE(rights.evidence,false) evidence
  FROM received_roots received JOIN mentions mention ON mention.id=received.root_id AND mention.workspace_id=$1::uuid
    AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
  LEFT JOIN root_rights rights ON rights.root_id=mention.id` : `SELECT item.canonical_root_id root_id,item.resolution_state,mention.published_at,
    COALESCE((item.outcome_metadata->>'has_unresolved_topics')::boolean,false) has_unresolved_topics,
    COALESCE(rights.metrics,false) AND mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id metrics,
    COALESCE(rights.evidence,false) AND mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id evidence
  FROM signal_classification_generation_items item JOIN mentions mention ON mention.id=item.canonical_root_id AND mention.workspace_id=$1::uuid
  LEFT JOIN root_rights rights ON rights.root_id=mention.id
  WHERE item.workspace_id=$1::uuid AND item.generation_id=$2::uuid
  UNION ALL
  SELECT item.root_id,item.resolution_state,mention.published_at,item.has_unresolved_topics,
    COALESCE(rights.metrics,false) AND mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id,
    COALESCE(rights.evidence,false) AND mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id
  FROM signal_topic_consolidation_snapshot_roots_v1 item
  JOIN mentions mention ON mention.id=item.root_id AND mention.workspace_id=$1::uuid
  LEFT JOIN root_rights rights ON rights.root_id=item.root_id
  WHERE item.workspace_id=$1::uuid AND item.snapshot_id=$2::uuid`}
), period_roots AS MATERIALIZED (
  SELECT * FROM all_roots WHERE ($3::date IS NULL OR published_at>=($3::date::timestamp AT TIME ZONE $5::text))
    AND ($4::date IS NULL OR published_at<(($4::date+1)::timestamp AT TIME ZONE $5::text))
), visible_terms AS MATERIALIZED (
  SELECT * FROM jsonb_to_recordset($6::jsonb) term(term_key text,definition_digest text,definition_revision int,visible boolean${definedInterest ? ",interest_generation_id uuid,interest_taxonomy_term_id uuid" : ""})
), legacy_memberships AS MATERIALIZED (
  SELECT DISTINCT ON(assignment.canonical_root_id,term.term_key) assignment.canonical_root_id root_id,term.term_key,visible.visible,
    CASE WHEN assignment.membership_basis='computed_cluster' THEN assignment.membership_metadata->'evidence_fragment' ELSE NULL END evidence_fragment
  FROM signal_classification_assignments assignment JOIN taxonomy_terms term ON term.id=assignment.taxonomy_term_id
  JOIN visible_terms visible ON visible.term_key=term.term_key AND visible.definition_digest=assignment.definition_digest
    AND visible.definition_revision=assignment.definition_revision
  JOIN signal_classification_generations generation ON generation.id=assignment.generation_id
  JOIN source_generation serving_source ON serving_source.id=generation.id
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
), ${definedInterest ? `defined_interest_memberships AS MATERIALIZED (
  SELECT DISTINCT ON(assignment.canonical_root_id,visible.term_key)
    assignment.canonical_root_id root_id,visible.term_key,visible.visible,
    NULL::jsonb evidence_fragment
  FROM visible_terms visible
  JOIN signal_classification_generations interest ON interest.id=visible.interest_generation_id
    AND interest.workspace_id=$1::uuid AND interest.input_contract='workspace-topic-classification-v1'
    AND interest.input_snapshot->>'interest_term_key'=visible.term_key
    AND interest.status='ready' AND interest.finalized_digest IS NOT NULL
    AND (interest.policy_valid_until IS NULL OR interest.policy_valid_until>now())
    AND interest.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid)
    AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items failed
      WHERE failed.generation_id=interest.id AND failed.resolution_state='error')
  JOIN signal_topic_catalog_executions execution ON execution.generation_id=interest.id
    AND execution.workspace_id=$1::uuid AND execution.status='ready'
    AND execution.processed_roots=execution.denominator
  JOIN signal_corpus_preparation_runs preparation ON preparation.id=interest.preparation_run_id
    AND preparation.workspace_id=$1::uuid AND preparation.status='completed'
    AND (preparation.policy_valid_until IS NULL OR preparation.policy_valid_until>now())
  ${!consolidated ? "" : `JOIN signal_topic_consolidation_snapshots snapshot ON snapshot.id=$2::uuid AND snapshot.workspace_id=$1::uuid
    AND signal_topic_consolidation_snapshot_current_v1(snapshot.id)
    AND snapshot.input_revision=interest.input_revision`}
  JOIN signal_classification_assignments assignment ON assignment.generation_id=interest.id
    AND assignment.workspace_id=$1::uuid AND assignment.taxonomy_term_id=visible.interest_taxonomy_term_id
    AND assignment.definition_digest=visible.definition_digest
    AND assignment.definition_revision=visible.definition_revision AND assignment.disposition='approved'
    AND signal_workspace_classification_assignment_current_v1(assignment,interest)
  JOIN taxonomy_terms term ON term.id=assignment.taxonomy_term_id AND term.term_key=visible.term_key
  JOIN period_roots root ON root.root_id=assignment.canonical_root_id AND root.metrics
  WHERE visible.interest_generation_id IS NOT NULL AND visible.interest_taxonomy_term_id IS NOT NULL
    AND assignment.resolution_method IN('model','human')
    AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments correction
      WHERE correction.generation_id=interest.id AND correction.canonical_root_id=assignment.canonical_root_id
        AND correction.taxonomy_term_id=assignment.taxonomy_term_id AND correction.resolution_method='human'
        AND correction.disposition='rejected'
        AND signal_workspace_classification_assignment_current_v1(correction,interest))
  ORDER BY assignment.canonical_root_id,visible.term_key,
    (assignment.resolution_method='human') DESC,assignment.created_at DESC,assignment.id DESC
), ` : ""}all_memberships AS MATERIALIZED (
  SELECT * FROM legacy_memberships
  UNION ALL
  SELECT member.root_id,member.term_key,visible.visible,NULL::jsonb evidence_fragment
  FROM signal_topic_consolidation_snapshot_memberships_v1 member
  JOIN visible_terms visible ON visible.term_key=member.term_key AND visible.definition_digest=member.definition_digest
  JOIN source_generation generation ON generation.id=member.snapshot_id
  JOIN period_roots root ON root.root_id=member.root_id AND root.metrics
  WHERE member.snapshot_id=$2::uuid AND member.workspace_id=$1::uuid
  ${membership ? `AND NOT EXISTS(SELECT 1 FROM signal_membership_concepts_v1 adopted
    JOIN signal_topic_consolidation_revisions revision ON 'workspace-discovery:'||revision.id::text=adopted.topic#>>'{source,run_key}'
    JOIN signal_topic_consolidation_snapshots snapshot ON snapshot.id=member.snapshot_id AND snapshot.consolidation_run_id=revision.consolidation_run_id
    JOIN signal_topic_editorial_concepts concept ON concept.revision_id=snapshot.revision_id AND concept.concept_key=adopted.topic#>>'{source,candidate_key}'
    WHERE adopted.workspace_id=$1::uuid AND EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot.catalog) entry WHERE entry->>'term_key'=member.term_key AND entry->>'concept_id'=concept.id::text))` : ""}
  ${membership ? `UNION ALL SELECT current.root_id,current.concept_key,visible.visible,
    CASE WHEN jsonb_array_length(current.citations)>0 THEN jsonb_build_object('chunk_index',0,'start',(current.citations->0->>'quote_start')::int,'end',(current.citations->0->>'quote_end')::int,'chunk_sha256',current.citations->0->>'chunk_sha256') ELSE NULL::jsonb END evidence_fragment
    FROM signal_concept_memberships_current_v1 current JOIN visible_terms visible ON visible.term_key=current.concept_key AND visible.definition_digest=current.definition_digest
    JOIN period_roots root ON root.root_id=current.root_id AND root.metrics
    WHERE current.workspace_id=$1::uuid AND current.verdict='belongs'` : ""}
  ${definedInterest ? "UNION ALL SELECT root_id,term_key,visible,evidence_fragment FROM defined_interest_memberships" : ""}
), memberships AS MATERIALIZED (SELECT root_id,term_key,evidence_fragment FROM all_memberships WHERE visible),
root_membership AS MATERIALIZED (SELECT root_id,bool_or(visible) visible FROM all_memberships GROUP BY root_id),
population AS MATERIALIZED (
  SELECT root.*,COALESCE(member.visible,false) visible${membership ? ",facet.relevance,EXISTS(SELECT 1 FROM signal_concept_memberships_current_v1 m WHERE m.workspace_id=$1::uuid AND m.root_id=root.root_id AND m.verdict='belongs') has_concept" : ""}
  FROM period_roots root LEFT JOIN root_membership member USING(root_id)
  ${membership ? "LEFT JOIN signal_mention_facets_current_v1 facet ON facet.workspace_id=$1::uuid AND facet.root_id=root.root_id" : ""}
)`;

function displayedTopics(ctx: Context, includeUnselected = false) {
  return ctx.topics.filter(topic => {
    const selected = ctx.selection.items[topic.term_key];
    return includeUnselected || selected?.selected && selected.definition_digest === topic.definition_digest;
  });
}
function populationParams(args: Args, ctx: Context) {
  const visible = new Set(displayedTopics(ctx, args.include_unselected).map(topic => topic.term_key));
  const interests = new Map(ctx.defined_interests?.map(item => [item.topic.term_key, item]) ?? []);
  return [args.workspace_id, ctx.generation?.id ?? null, ctx.filters.date_from, ctx.filters.date_to, ctx.filters.timezone,
    JSON.stringify(ctx.topics.map(topic => ({ term_key: topic.term_key, visible: visible.has(topic.term_key),
      definition_digest: topic.definition_digest, definition_revision: topic.definition_revision,
      ...(interests.has(topic.term_key) ? { interest_generation_id: interests.get(topic.term_key)!.generation_id,
        interest_taxonomy_term_id: interests.get(topic.term_key)!.selection.taxonomy_term_id } : {}) })))];
}
type Aggregate = { denominator: number; processed: number; assigned_unique: number; abstained: number; noise: number; unresolved: number;
  unresolved_exclusive: number;
  interest_processed?: number;
  evidence_visible_total: number; withheld: number; rights_digest: string; date_from: string | null; date_to: string | null;
  counts: Array<{ term_key: string; mention_count: number }>; series: SignalWorkspaceTopicsOverviewV1["series"]; observed_at: string };
async function overview(client: PoolClient, args: Args, ctx: Context): Promise<SignalWorkspaceOverviewV1> {
  const interestOnly = Boolean(ctx.imported && ctx.defined_interests?.length);
  const params: unknown[] = populationParams(args, ctx);
  if (interestOnly) params.push(ctx.defined_interests!.map(item => item.generation_id));
  const summary = (await client.query<Aggregate>(`${populationSql(Boolean(ctx.imported),Boolean(ctx.defined_interests?.length),ctx.consolidated,ctx.concept_membership)}
    SELECT count(*) FILTER(WHERE root.metrics AND root.evidence)::int evidence_visible_total,
      count(*) FILTER(WHERE root.metrics)::int denominator,count(*) FILTER(WHERE root.metrics)::int processed,
      count(*) FILTER(WHERE root.metrics AND root.visible)::int assigned_unique,
      count(*) FILTER(WHERE root.metrics AND root.resolution_state='abstained')::int abstained,
      count(*) FILTER(WHERE root.metrics AND ${ctx.concept_membership ? "root.relevance='unrelated'" : "root.resolution_state='noise'"})::int noise,
      count(*) FILTER(WHERE root.metrics AND root.has_unresolved_topics)::int unresolved,
      count(*) FILTER(WHERE root.metrics AND ${ctx.concept_membership ? "root.relevance='relevant' AND NOT root.has_concept" : "root.resolution_state='unresolved'"})::int unresolved_exclusive,
      count(*) FILTER(WHERE NOT root.metrics)::int withheld,
      ${interestOnly ? `(SELECT count(DISTINCT item.canonical_root_id)::int
        FROM signal_classification_generation_items item JOIN period_roots checked ON checked.root_id=item.canonical_root_id AND checked.metrics
        WHERE item.workspace_id=$1::uuid AND item.generation_id=ANY($7::uuid[]) AND item.resolution_state<>'error') interest_processed,` : ""}
      'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(jsonb_build_array(id,data_source_id,metrics,evidence)::text,
        '' ORDER BY id) FROM authorized_imports),''),'UTF8')),'hex') rights_digest,
      (SELECT to_char((min(published_at) AT TIME ZONE $5::text)::date,'YYYY-MM-DD') FROM all_roots WHERE metrics) date_from,
      (SELECT to_char((max(published_at) AT TIME ZONE $5::text)::date,'YYYY-MM-DD') FROM all_roots WHERE metrics) date_to,
      COALESCE((SELECT jsonb_agg(counts ORDER BY term_key) FROM (SELECT term_key,count(*)::int mention_count FROM memberships GROUP BY term_key) counts),'[]') counts,
      COALESCE((SELECT jsonb_agg(series ORDER BY date) FROM (SELECT to_char((published_at AT TIME ZONE $5::text)::date,'YYYY-MM-DD') date,count(*)::int mention_count,
        count(*) FILTER(WHERE visible)::int assigned_unique
        FROM population period WHERE metrics GROUP BY (published_at AT TIME ZONE $5::text)::date) series),'[]') series,
      to_char(statement_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at
    FROM population root`, params)).rows[0]!;
  const counts = new Map(summary.counts.map(row => [row.term_key, row.mention_count]));
  const interestKeys = new Set(ctx.defined_interests?.map(item => item.topic.term_key) ?? []);
  const terms = displayedTopics(ctx, args.include_unselected).map(topic => ({ term_key: topic.term_key, kind: topic.kind, label: topic.label,
    definition: topic.definition, definition_digest: topic.definition_digest, definition_revision: topic.definition_revision,
    selected: displayedTopics(ctx).some(selected => selected.term_key === topic.term_key),
    mention_count: counts.get(topic.term_key) ?? 0,
    share_of_corpus: summary.denominator ? (counts.get(topic.term_key) ?? 0) / summary.denominator : null,
    basis: interestKeys.has(topic.term_key) ? "defined_interest" as const : "computed_cluster" as const,
    evidence_available: true,
    ...(interestKeys.has(topic.term_key) ? { interest_generation_id: ctx.defined_interests!.find(item => item.topic.term_key === topic.term_key)!.generation_id } : {}) }));
  const computed: SignalWorkspaceTopicsOverviewV1 = { contract_version: "signal-workspace-topics-serving-v1", source: "workspace_computed", workspace_id: args.workspace_id,
    corpus_id: null, scope: "all_conversations", generation_id: ctx.generation?.id ?? null,
    source_engine_execution_id: ctx.generation?.source_engine_execution_id ?? null, is_current: ctx.is_current, is_processing: ctx.is_processing,
    selection_revision: ctx.selection.revision, filters: ctx.filters,
    available_dates: { date_from: summary.date_from, date_to: summary.date_to },
    scope_digest: hash({ workspace: args.workspace_id, actor: args.actor_user_id, generation: ctx.generation?.finalized_digest,
      input_revision: ctx.generation?.current_revision, current: ctx.is_current, selection: ctx.selection,
      interest_receipts: ctx.defined_interests?.map(item => [item.selection.selection_digest,item.finalized_digest]) ?? [],
      ...(ctx.imported ? { imported: ctx.imported } : {}),
      terms, filters: ctx.filters, rights: summary.rights_digest, ...(ctx.concept_membership?{membership_state:ctx.membership_state_digest,membership_run:ctx.membership_run_id}:{}) }), observed_at: summary.observed_at,
    denominator: summary.denominator, coverage: { processed: summary.processed, assigned_unique: summary.assigned_unique,
      abstained: summary.abstained, noise: ctx.consolidated || ctx.concept_membership ? summary.noise : null,
      unresolved: ctx.consolidated || ctx.concept_membership ? summary.unresolved_exclusive : summary.unresolved, withheld: summary.withheld },
    interpretation_coverage: workspaceTopicsInterpretationCoverageV1(ctx.generation?.interpretation_coverage),
    quality: "not_calibrated", terms, series: summary.series,
    limitations: ["computed_memberships_not_semantic_precision", "multilabel_counts_are_not_additive",
      ...(!ctx.generation && !ctx.concept_membership ? ["classification_required"] : !ctx.is_current ? ["last_complete_generation_stale"] : []),
      ...(summary.withheld ? ["current_rights_withhold_mentions"] : [])] };
  if (interestOnly) {
    const selections = ctx.defined_interests!.map(item => ({ term_key: item.topic.term_key,
      selection_digest: item.selection.selection_digest, finalized_digest: item.finalized_digest }));
    const interestSelectionDigest = hash(selections);
    return { ...computed, source: "workspace_defined_interest", classification_state: "ready",
      generation_id: null, source_engine_execution_id: null, selection_revision: 0,
      interest_generation_ids: [...new Set(ctx.defined_interests!.map(item => item.generation_id))].sort(),
      interest_selection_digest: interestSelectionDigest, evidence_visible_total: summary.evidence_visible_total,
      terms: terms.map(term => ({ ...term, kind: "topic" as const, basis: "defined_interest" as const,
        interest_generation_id: term.interest_generation_id!, evidence_available: true })),
      coverage: { processed: summary.interest_processed ?? 0, assigned_unique: summary.assigned_unique,
        abstained: null, noise: null, unresolved: null, withheld: summary.withheld },
      limitations: ["interest_only_not_open_discovery", "computed_memberships_not_semantic_precision",
        "multilabel_counts_are_not_additive",
        ...(summary.withheld ? ["current_rights_withhold_mentions"] : [])] };
  }
  if (!ctx.imported || ctx.concept_membership) return computed;
  return { ...computed, source: "workspace_imported", classification_state: "pending", generation_id: null,
    source_engine_execution_id: null, quality: "not_analyzed", evidence_visible_total: summary.evidence_visible_total,
    series: computed.series.map(point => ({ ...point, assigned_unique: null })),
    coverage: { processed: null, assigned_unique: null, abstained: null, noise: null, unresolved: null, withheld: null },
    limitations: ["classification_required", "current_display_rights_only"] };
}

export function loadSignalWorkspaceTopicsOverviewV1(args: Args & { imported_fallback: true }): Promise<SignalWorkspaceOverviewV1 | null>;
export function loadSignalWorkspaceTopicsOverviewV1(args: Args & { imported_fallback?: false }): Promise<SignalWorkspaceTopicsOverviewV1 | null>;
export function loadSignalWorkspaceTopicsOverviewV1(args: Args): Promise<SignalWorkspaceOverviewV1 | null>;
export async function loadSignalWorkspaceTopicsOverviewV1(args: Args): Promise<SignalWorkspaceOverviewV1 | null> {
  return transaction(args.database, async client => {
    const ctx = await context(client, args); return ctx.native ? overview(client, args, ctx) : null;
  });
}

export type SignalWorkspaceTopicDetailV1 = {
  contract_version: "signal-workspace-topic-detail-v1";
  workspace_id: string; generation_id: string | null; scope_digest: string; kind: "topic" | "narrative"; term_key: string;
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
  term_key: string; kind?: "topic" | "narrative"; expected_scope_digest: string;
}): Promise<SignalWorkspaceTopicDetailV1> {
  const kind = args.kind ?? "topic";
  if (!args.term_key || args.term_key.length > 160 || !args.expected_scope_digest)
    return fail("workspace_topics_detail_request_invalid", 422);
  return transaction(args.database, async client => {
    const ctx = await context(client, args);
    const interest = ctx.defined_interests?.find(item => item.topic.term_key === args.term_key);
    if ((!ctx.generation && !interest && !ctx.concept_membership) || !ctx.native || !displayedTopics(ctx).some(topic => topic.term_key === args.term_key && topic.kind === kind))
      return fail("workspace_topics_topic_unavailable", 404);
    if (!ctx.is_current) return fail("workspace_topics_evidence_stale");
    const view = await overview(client, args, ctx);
    if (args.expected_scope_digest !== view.scope_digest) return fail("workspace_topics_scope_changed");
    const summary = (await client.query<{ mention_count: number; undated_mentions: number;
      positive: number; neutral: number; negative: number; unclassified: number;
      series: SignalWorkspaceTopicDetailV1["series"];
      related: Array<{ term_key: string; shared_mentions: number }> }>(`${populationSql(Boolean(ctx.imported),Boolean(ctx.defined_interests?.length),ctx.consolidated,ctx.concept_membership)},
      topic_roots AS MATERIALIZED (
        SELECT DISTINCT root.root_id,root.published_at,mention.sentiment_score
        FROM period_roots root JOIN memberships member ON member.root_id=root.root_id AND member.term_key=$7
        JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
        WHERE root.metrics
      )
      SELECT count(*)::int mention_count,count(*) FILTER(WHERE published_at IS NULL)::int undated_mentions,
        count(*) FILTER(WHERE sentiment_score > 0.2)::int positive,
        count(*) FILTER(WHERE sentiment_score BETWEEN -0.2 AND 0.2)::int neutral,
        count(*) FILTER(WHERE sentiment_score < -0.2)::int negative,
        count(*) FILTER(WHERE sentiment_score IS NULL)::int unclassified,
        COALESCE((SELECT jsonb_agg(point ORDER BY date) FROM (
          SELECT to_char((published_at AT TIME ZONE $5::text)::date,'YYYY-MM-DD') date,count(*)::int mention_count
          FROM topic_roots WHERE published_at IS NOT NULL GROUP BY (published_at AT TIME ZONE $5::text)::date
        ) point),'[]') series,
        COALESCE((SELECT jsonb_agg(relation ORDER BY shared_mentions DESC,term_key) FROM (
          SELECT member.term_key,count(DISTINCT root.root_id)::int shared_mentions
          FROM topic_roots root JOIN memberships member ON member.root_id=root.root_id
          WHERE member.term_key<>$7 GROUP BY member.term_key
          ORDER BY shared_mentions DESC,member.term_key LIMIT 20
        ) relation),'[]') related
      FROM topic_roots`, [...populationParams(args, ctx), args.term_key])).rows[0]!;
    const labels = new Map(view.terms.filter(term => term.kind === kind).map(term => [term.term_key, term.label]));
    return { contract_version: "signal-workspace-topic-detail-v1", workspace_id: args.workspace_id,
      generation_id: interest?.generation_id ?? ctx.generation?.id ?? null, scope_digest: view.scope_digest, kind, term_key: args.term_key,
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
  term_key: string; kind?: "topic" | "narrative"; cursor?: string | null; expected_scope_digest?: string | null; limit?: number;
}): Promise<SignalWorkspaceTopicEvidencePageV1> {
  const kind = args.kind ?? "topic";
  const limit = args.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !args.term_key || args.term_key.length > 160) return fail("workspace_topics_evidence_request_invalid", 422);
  return transaction(args.database, async client => {
    const ctx = await context(client, args);
    const interest = ctx.defined_interests?.find(item => item.topic.term_key === args.term_key);
    if ((!ctx.generation && !interest && !ctx.concept_membership) || !ctx.native || !displayedTopics(ctx).some(topic => topic.term_key === args.term_key && topic.kind === kind)) return fail("workspace_topics_topic_unavailable", 404);
    if (!ctx.is_current) return fail("workspace_topics_evidence_stale");
    const view = await overview(client, args, ctx);
    if (args.expected_scope_digest && args.expected_scope_digest !== view.scope_digest) return fail("workspace_topics_scope_changed");
    let after: string | null = null;
    if (args.cursor) {
      try {
        if (args.cursor.length > 1024) return fail("workspace_topics_cursor_invalid", 422);
        const decoded = JSON.parse(Buffer.from(args.cursor, "base64url").toString("utf8")) as { root_id: string; scope: string; term: string; kind?: "topic" | "narrative" };
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(decoded.root_id)
          || decoded.scope !== view.scope_digest || decoded.term !== args.term_key
          || (decoded.kind !== undefined && decoded.kind !== kind) || (kind === "narrative" && decoded.kind !== "narrative")) return fail("workspace_topics_scope_changed");
        after = decoded.root_id;
      } catch (error) { if (error instanceof SignalWorkspaceTopicsServingError) throw error; return fail("workspace_topics_cursor_invalid", 422); }
    }
    if (ctx.concept_membership) {
      const rows=(await client.query<SignalWorkspaceTopicEvidencePageV1["items"][number]>(`${populationSql(Boolean(ctx.imported),false,ctx.consolidated,true)}
        SELECT DISTINCT ON(root.root_id) root.root_id mention_id,
          mention.text_clean text,
          CASE WHEN member.evidence_fragment IS NOT NULL THEN signal_topic_utf16_fragment_v1(mention.text_clean,(member.evidence_fragment->>'start')::int,(member.evidence_fragment->>'end')::int) ELSE NULL END quote,
          member.evidence_fragment,mention.platform,to_char(mention.published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at,mention.url
        FROM period_roots root JOIN memberships member ON member.root_id=root.root_id AND member.term_key=$7
        JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
        WHERE root.evidence AND ($8::uuid IS NULL OR root.root_id>$8::uuid) ORDER BY root.root_id LIMIT $9`,[...populationParams(args,ctx),args.term_key,after,limit+1])).rows;
      const items=rows.slice(0,limit);
      return {contract_version:"signal-workspace-topic-evidence-v1",workspace_id:args.workspace_id,generation_id:ctx.generation?.id??null,kind,term_key:args.term_key,scope_digest:view.scope_digest,items,
        next_cursor:rows.length>limit?Buffer.from(JSON.stringify({root_id:items.at(-1)!.mention_id,scope:view.scope_digest,term:args.term_key,kind})).toString("base64url"):null};
    }
    if (interest) {
      const rows = (await client.query<SignalWorkspaceTopicEvidencePageV1["items"][number]>(`${populationSql(Boolean(ctx.imported),true,ctx.consolidated,ctx.concept_membership)}
        SELECT root.root_id mention_id,
          CASE WHEN assignment.resolution_method='human' THEN left(mention.text_clean,2000)
            ELSE cited.citation->>'quote' END text,NULL::jsonb evidence_fragment,
          mention.platform,to_char(mention.published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at,mention.url,
          CASE WHEN assignment.resolution_method='human' THEN 'human_correction' ELSE 'model_decision' END evidence_origin,
          CASE WHEN assignment.resolution_method='human' THEN NULL::jsonb ELSE jsonb_build_object(
            'role','supports','output_digest',decision.output_digest,
            'decision_digest',decision.decision_digest,'chunk_index',(cited.citation->>'chunk_index')::int,
            'quote_start',(cited.citation->>'quote_start')::int,'quote_end',(cited.citation->>'quote_end')::int,
            'chunk_sha256',cited.citation->>'chunk_sha256') END decision_citation
        FROM period_roots root
        JOIN memberships member ON member.root_id=root.root_id AND member.term_key=$7
        JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
          AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
        JOIN signal_classification_generations generation ON generation.id=$8::uuid
        JOIN LATERAL (SELECT assignment.* FROM signal_classification_assignments assignment
          WHERE assignment.workspace_id=$1::uuid AND assignment.generation_id=$8::uuid
            AND assignment.canonical_root_id=root.root_id AND assignment.taxonomy_term_id=$9::uuid
            AND assignment.disposition='approved' AND assignment.resolution_method IN('model','human')
            AND signal_workspace_classification_assignment_current_v1(assignment,generation)
            AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments correction
              WHERE correction.generation_id=assignment.generation_id
                AND correction.canonical_root_id=assignment.canonical_root_id
                AND correction.taxonomy_term_id=assignment.taxonomy_term_id
                AND correction.resolution_method='human' AND correction.disposition='rejected'
                AND signal_workspace_classification_assignment_current_v1(correction,generation))
          ORDER BY (assignment.resolution_method='human') DESC,assignment.created_at DESC,assignment.id DESC
          LIMIT 1) assignment ON true
        LEFT JOIN signal_interest_decision_root_evidence_v1 decision ON decision.id=assignment.interest_decision_evidence_id
          AND decision.owner_id IN (SELECT id FROM signal_interest_decision_owners_v1
            WHERE workspace_id=$1::uuid AND generation_id=$8::uuid AND status='completed')
          AND decision.root_id=root.root_id AND decision.term_key=$7 AND decision.verdict='belongs'
          AND decision.asset_sha256=mention.text_clean_sha256
          AND decision.output_digest=assignment.interest_output_digest
          AND decision.decision_digest=assignment.evidence_digest
        LEFT JOIN signal_interest_decision_calls_v1 receipt ON receipt.id=decision.call_id
          AND receipt.status='settled' AND receipt.validation_status='accepted'
          AND receipt.output_digest=decision.output_digest
        LEFT JOIN LATERAL (SELECT c.value citation FROM jsonb_array_elements(decision.citations) AS c(value)
          WHERE c.value->>'role'='supports' ORDER BY (c.value->>'chunk_index')::int,
            (c.value->>'quote_start')::int LIMIT 1) cited ON true
        WHERE root.evidence AND ($10::uuid IS NULL OR root.root_id>$10::uuid)
          AND (assignment.resolution_method='human' OR (receipt.id IS NOT NULL AND cited.citation IS NOT NULL))
        ORDER BY root.root_id LIMIT $11`, [...populationParams(args, ctx), args.term_key,
          interest.generation_id, interest.selection.taxonomy_term_id, after, limit + 1])).rows;
      const items = rows.slice(0, limit);
      return { contract_version: "signal-workspace-topic-evidence-v1", workspace_id: args.workspace_id,
        generation_id: interest.generation_id, kind, term_key: args.term_key, scope_digest: view.scope_digest, items,
        next_cursor: rows.length > limit ? Buffer.from(JSON.stringify({ root_id: items.at(-1)!.mention_id,
          scope: view.scope_digest, term: args.term_key, kind })).toString("base64url") : null };
    }
    const rows = (await client.query<SignalWorkspaceTopicEvidencePageV1["items"][number]>(`${populationSql(Boolean(ctx.imported),Boolean(ctx.defined_interests?.length),ctx.consolidated,ctx.concept_membership)}
      SELECT root.root_id mention_id,CASE WHEN member.evidence_fragment IS NOT NULL THEN signal_topic_utf16_fragment_v1(mention.text_clean,
        (member.evidence_fragment->>'start')::int,(member.evidence_fragment->>'end')::int) ELSE left(mention.text_clean,2000) END text,
        member.evidence_fragment,mention.platform,
        to_char(mention.published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at,mention.url
      FROM period_roots root JOIN memberships member ON member.root_id=root.root_id AND member.term_key=$7
      JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
      JOIN source_generation generation ON generation.id=$2::uuid
      JOIN signal_corpus_preparation_items prepared ON prepared.workspace_id=$1::uuid
        AND prepared.run_id=generation.preparation_run_id AND prepared.root_id=root.root_id
      WHERE root.evidence AND ($8::uuid IS NULL OR root.root_id>$8::uuid)
        AND prepared.asset_sha256=mention.text_clean_sha256
      ORDER BY root.root_id LIMIT $9`, [...populationParams(args, ctx), args.term_key, after, limit + 1])).rows;
    const items = rows.slice(0, limit);
    return { contract_version: "signal-workspace-topic-evidence-v1", workspace_id: args.workspace_id,
      generation_id: ctx.generation!.id, kind, term_key: args.term_key, scope_digest: view.scope_digest, items,
      next_cursor: rows.length > limit ? Buffer.from(JSON.stringify({ root_id: items.at(-1)!.mention_id,
        scope: view.scope_digest, term: args.term_key, kind })).toString("base64url") : null };
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
  const filters = { date_from: parseDate(args.date_from), date_to: parseDate(args.date_to), timezone: parseTimezone(args.timezone),
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

/** A global population, independent of selected Topics. Computed text requires
 * its prepared SHA. Imported text uses current canonical bytes protected by the
 * exact digest constraint installed in SQL0167–0169; no prepared artifact exists.
 * Text rights are checked before searching or returning canonical content.
 * Only root metadata is materialized; complete document bodies stay in Postgres. */
const mentionsPopulationSql = (imported = false) => `${populationSql(imported)}, mention_roots AS MATERIALIZED (
  SELECT checked.*,hashtextextended(ROW(checked.root_id,checked.metrics,checked.evidence,
    checked.text_valid,checked.text_digest,extract(epoch FROM checked.published_at),checked.platform)::text,0::bigint) population_hash
  FROM (
    SELECT root.*,COALESCE(mention.resolved_platform,mention.platform) platform,mention.text_clean_sha256 text_digest,
      CASE WHEN root.evidence THEN ${imported ? "mention.text_clean_sha256 IS NOT NULL" : "COALESCE(prepared.asset_sha256=mention.text_clean_sha256,false)"} ELSE false END text_valid
    FROM period_roots root JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
    ${imported ? "" : `JOIN source_generation generation ON true
    LEFT JOIN signal_corpus_preparation_items prepared ON prepared.workspace_id=$1::uuid
      AND prepared.run_id=generation.preparation_run_id AND prepared.root_id=root.root_id`}
  ) checked
), visible_mentions AS MATERIALIZED (
  SELECT root.* FROM mention_roots root WHERE root.metrics AND root.evidence AND root.text_valid
), filtered_mentions AS MATERIALIZED (
  SELECT root.* FROM visible_mentions root JOIN mentions mention ON mention.id=root.root_id AND mention.workspace_id=$1::uuid
  WHERE ($7::text IS NULL OR strpos(lower(mention.text_clean),lower($7::text))>0)
    AND (cardinality($8::text[])=0 OR lower(btrim(root.platform))=ANY($8::text[]))
)`;
type MentionsSummary = {
  metric_denominator: number; evidence_visible_total: number; total_count: number;
  withheld_evidence_count: number; integrity_withheld_count: number; rights_digest: string;
  population_fingerprint_xor: string; population_fingerprint_sum: string;
  date_from: string | null; date_to: string | null; available_platforms: string[]; cursor_exists: boolean; cursor_offset: number;
};

/** List or focus only roots in the same current native generation as Signal.
 * Cursor data locates a page; every request repeats scope and rights checks. */
export function loadSignalWorkspaceMentionsV1(args: SignalWorkspaceMentionsArgsV1 & { imported_fallback: true }): Promise<SignalWorkspaceMentionsResultV1 | null>;
export function loadSignalWorkspaceMentionsV1(args: SignalWorkspaceMentionsArgsV1 & { imported_fallback?: false }): Promise<SignalWorkspaceMentionsPageV1 | null>;
export function loadSignalWorkspaceMentionsV1(args: SignalWorkspaceMentionsArgsV1): Promise<SignalWorkspaceMentionsResultV1 | null>;
export async function loadSignalWorkspaceMentionsV1(args: SignalWorkspaceMentionsArgsV1): Promise<SignalWorkspaceMentionsResultV1 | null> {
  const request = mentionsRequest(args);
  const access = { database: args.database, workspace_id: args.workspace_id.toLowerCase(), actor_user_id: args.actor_user_id.toLowerCase(),
    date_from: request.filters.date_from, date_to: request.filters.date_to, timezone: request.filters.timezone,
    imported_fallback: args.imported_fallback };
  return transaction(args.database, async client => {
    const ctx = await mentionsContext(client, access);
    if (!ctx.native) return null;
    if (!ctx.generation && !ctx.imported) return fail("workspace_mentions_generation_unavailable", 404);
    if (!ctx.is_current) return fail("workspace_mentions_stale");
    // The transaction wrapper disables nested loops and JIT before this query:
    // skewed workspace estimates otherwise choose a quadratic plan and compile it.
    // Empty visible_terms intentionally avoids every membership/selection join.
    const params = [access.workspace_id, ctx.generation?.id ?? null, ctx.filters.date_from, ctx.filters.date_to, ctx.filters.timezone, "[]",
      request.filters.search_query, request.filters.platforms];
    const direction = request.direction === "asc" ? "ASC" : "DESC", operator = request.direction === "asc" ? ">" : "<";
    const before = request.direction === "asc" ? "<" : ">";
    const result = await client.query<MentionsSummary & { item: SignalWorkspaceMentionV1 | null; focus_only: boolean | null }>(`${mentionsPopulationSql(Boolean(ctx.imported))},
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
        (SELECT to_char((min(published_at) AT TIME ZONE $5::text)::date,'YYYY-MM-DD') FROM all_roots WHERE metrics) date_from,
        (SELECT to_char((max(published_at) AT TIME ZONE $5::text)::date,'YYYY-MM-DD') FROM all_roots WHERE metrics) date_to,
        ARRAY(SELECT DISTINCT lower(btrim(platform)) FROM visible_mentions
          WHERE platform IS NOT NULL AND btrim(platform)<>'' ORDER BY 1) available_platforms,
        ($9::uuid IS NULL OR EXISTS(SELECT 1 FROM filtered_mentions cursor_root WHERE cursor_root.root_id=$9::uuid
          AND cursor_root.published_at IS NOT DISTINCT FROM $10::timestamptz)) cursor_exists,
        (SELECT count(*)::int FROM filtered_mentions prior WHERE $9::uuid IS NOT NULL AND
          (($10::timestamptz IS NULL AND (prior.published_at IS NOT NULL OR prior.root_id<=$9::uuid))
           OR ($10::timestamptz IS NOT NULL AND (prior.published_at ${before} $10::timestamptz
             OR (prior.published_at=$10::timestamptz AND prior.root_id<=$9::uuid))))) cursor_offset
      FROM mention_roots root
    ), page AS MATERIALIZED (
      SELECT root.* FROM filtered_mentions root
      WHERE ($9::uuid IS NULL OR ($10::timestamptz IS NULL AND root.published_at IS NULL AND root.root_id>$9::uuid)
        OR ($10::timestamptz IS NOT NULL AND (root.published_at IS NULL OR root.published_at ${operator} $10::timestamptz
          OR (root.published_at=$10::timestamptz AND root.root_id>$9::uuid))))
      ORDER BY root.published_at ${direction} NULLS LAST,root.root_id ASC LIMIT $12
    ), selected AS MATERIALIZED (
      SELECT root.*,false focus_only FROM page root
      UNION ALL
      SELECT root.*,true focus_only FROM filtered_mentions root
      WHERE $11::uuid IS NOT NULL AND root.root_id=$11::uuid
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
      ...(ctx.generation ? { generation: ctx.generation.id, finalized_digest: ctx.generation.finalized_digest, input_revision: ctx.generation.current_revision }
        : { source: "workspace_imported", imported: ctx.imported }),
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
    const common = { contract_version: "signal-workspace-mentions-v1" as const, workspace_id: access.workspace_id,
      generation_id: ctx.generation?.id ?? null, source_engine_execution_id: ctx.generation?.source_engine_execution_id ?? null, is_current: true as const, is_processing: ctx.is_processing,
      scope_digest: scope, filters: request.filters, sort: { field: "published" as const, direction: request.direction },
      available_dates: { date_from: summary.date_from, date_to: summary.date_to }, available_platforms: summary.available_platforms,
      metric_denominator: summary.metric_denominator,
      evidence_visible_total: summary.evidence_visible_total, total_count: summary.total_count,
      withheld_evidence_count: summary.withheld_evidence_count, integrity_withheld_count: summary.integrity_withheld_count,
      page_offset: offset,
      next_cursor: listed.length > request.limit && last
        ? Buffer.from(JSON.stringify({ version: 1, root_id: last.mention_id, occurred_at: last.occurred_at,
          scope, offset: offset + items.length } satisfies MentionsCursor)).toString("base64url") : null };
    if (ctx.imported) {
      const pending = (item: SignalWorkspaceMentionV1): SignalWorkspaceImportedMentionV1 => ({ ...item, resolution_state: null, has_unresolved_topics: null });
      return { ...common, source: "workspace_imported", classification_state: "pending", generation_id: null,
        source_engine_execution_id: null, items: items.map(pending), ...(request.focus ? { focused_item: focusedItem ? pending(focusedItem) : null } : {}) };
    }
    return { ...common, items, ...(request.focus ? { focused_item: focusedItem } : {}),
      generation_id: ctx.generation!.id, source_engine_execution_id: ctx.generation!.source_engine_execution_id };
  });
}
