import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
  buildSignalTopicEmbeddingInputsV1,
  chunkForEmbedding,
  estimateSignalTopicEmbeddingCostMicroUsdV1,
  getEmbeddingModel,
  getEmbeddingProvider,
  hashEmbeddingChunk,
  signalTopicDefinitionDigestV1,
  signalTopicDefinitionSchemaV1,
  signalTopicTermKeyV1,
  type AdoptSignalTopicCandidateInputV1,
  type CreateSignalTopicInputV1,
  type SignalTopicDefinitionV1,
  type SignalTopicReadinessV1,
  type SignalTopicScopeV1,
  type UpdateSignalTopicInputV1
} from "@noisia/query-engine";
import { insertSignalTaxonomyDraftCoreV1 } from "./signal-taxonomy-profile";
import { loadSignalSemanticResolutionGovernedContextV1 } from "./signal-semantic-resolution";
import { loadSignalTopicEvaluationV2CandidateDetail } from "./signal-topic-evaluation-v2";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";

export class SignalTopicCatalogError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code);
  }
}

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type CatalogProfileRow = {
  id: string;
  taxonomy_id: string;
  version: number;
  status: "draft" | "activating" | "active" | "retired";
  context_hash: string;
  created_at: string;
  updated_at: string;
};
type CatalogTermRow = {
  id: string;
  term_key: string;
  label: string;
  description: string;
  metadata: unknown;
  status: string;
};

export type SignalTopicCatalogTopicStoreV1 = SignalTopicDefinitionV1 & {
  taxonomy_term_id: string;
  status: "draft" | "searching" | "ready" | "updating" | "in_signal" | "archived" | "failed";
  counts: { relevant: number; doubt: number; excluded: number };
};

export type SignalTopicCatalogExecutionStoreV1 = {
  id: string;
  intent: "search" | "publish";
  publish_when_ready: boolean;
  status: "queued" | "running" | "ready" | "completed" | "failed";
  progress: number;
  denominator: number;
  embedding_model: string | null;
  embedding_cost_estimate_micro_usd: number | null;
  embedding_cost_cap_micro_usd: number | null;
  embedding_pricing_version: string | null;
  error_code: string | null;
  result_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SignalTopicCatalogStoreV1 = {
  contract_version: typeof SIGNAL_TOPIC_CATALOG_CONTRACT_V1;
  workspace_id: string;
  profile: CatalogProfileRow | null;
  active_profile_id: string | null;
  topics: SignalTopicCatalogTopicStoreV1[];
  execution: SignalTopicCatalogExecutionStoreV1 | null;
  search_execution_id: string | null;
  search_is_current: boolean;
  embedding_preflight: SignalTopicEmbeddingPreflightStoreV1;
  readiness: SignalTopicReadinessV1;
};

export type SignalTopicEmbeddingPreflightStoreV1 = {
  status: "ready" | "blocked";
  embedding_model: string | null;
  missing_inputs: number;
  estimated_micro_usd: number;
  pricing_version: string | null;
  requires_paid_call: boolean;
  error_code: string | null;
};

export type SignalTopicInheritedContextStoreV1 = {
  context_digest: string;
  embedding_text: string;
  negative_embedding_text: string;
  embedding_contexts: Record<"primary_brand" | "competitor" | "category", {
    context_digest: string;
    positive_text: string;
    negative_text: string;
  }>;
  context_refs: Array<{
    source_type: "brand_os_objective" | "brand_os_brief" | "brand_os_audience" | "knowledge_assertion"
      | "semantic_context_element";
    source_id: string;
    version: string;
    content_hash: string;
  }>;
  locale: { primary_locale: string | null; languages: string[]; markets: string[]; timezone: string | null };
};

export async function loadSignalTopicInheritedContextStoreV1(args: {
  queryable: Queryable;
  workspace_id: string;
  complete_context?: boolean;
}): Promise<SignalTopicInheritedContextStoreV1> {
  const governed = await loadSignalSemanticResolutionGovernedContextV1(args.queryable, args.workspace_id,
    { complete_brand_context: args.complete_context });
  const contextRows = <T>(rows: T[], limit: number) => args.complete_context ? rows : rows.slice(0, limit);
  const contextText = (text: string) => args.complete_context ? text : text.slice(0, 4_000);
  const acquisition = (await args.queryable.query<{ acquisition_brief: unknown; timezone: string | null }>(`
    SELECT plan.acquisition_brief,workspace.timezone
    FROM signal_workspaces workspace
    LEFT JOIN LATERAL(
      SELECT acquisition_brief FROM signal_acquisition_plans
      WHERE workspace_id=workspace.id AND acquisition_brief IS NOT NULL
        AND status IN('current','draft')
      ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END,plan_version DESC LIMIT 1
    ) plan ON true
    WHERE workspace.id=$1::uuid
  `, [args.workspace_id])).rows[0];
  const brief = objectValue(acquisition?.acquisition_brief);
  const languages = Array.from(new Set(stringArray(brief.languages))).sort();
  const markets = Array.from(new Set(stringArray(brief.countries).length
    ? stringArray(brief.countries) : governed.workspace.countries)).sort();
  const primaryLocale = typeof brief.primary_locale === "string" && brief.primary_locale.trim()
    ? brief.primary_locale.trim() : languages[0] ?? null;
  const contextItems = (await args.queryable.query<SignalTopicInheritedContextStoreV1["context_refs"][number] & {
    content: string;
  }>(`
    WITH active_profile AS(
      SELECT profile.id,profile.version FROM brand_os_profiles profile
      JOIN signal_workspaces workspace ON workspace.brand_id=profile.brand_id
      WHERE workspace.id=$1::uuid AND profile.status='active'
      ORDER BY profile.version DESC,profile.created_at DESC LIMIT 1
    ), context_items AS(
      SELECT 'brand_os_objective'::text source_type,objective.id::text source_id,
        'brand-os:'||profile.version::text version,
        concat_ws(' — ',objective.name,objective.description) content
      FROM brand_os_objectives objective JOIN active_profile profile ON profile.id=objective.brand_os_profile_id
      WHERE objective.status='active'
      UNION ALL
      SELECT 'brand_os_brief',brief.id::text,'updated:'||brief.updated_at::text,
        concat_ws(' — ',brief.title,brief.summary)
      FROM brand_os_briefs brief JOIN active_profile profile ON profile.id=brief.brand_os_profile_id
      WHERE brief.status='active'
      UNION ALL
      SELECT 'brand_os_audience',audience.id::text,'created:'||audience.created_at::text,
        concat_ws(' — ',audience.name,audience.description)
      FROM brand_os_audiences audience JOIN active_profile profile ON profile.id=audience.brand_os_profile_id
      WHERE audience.status='active'
      UNION ALL
      SELECT 'knowledge_assertion',assertion.id::text,'updated:'||assertion.updated_at::text,
        assertion.assertion_text
      FROM knowledge_assertions assertion
      JOIN brand_knowledge_sources source ON source.id=assertion.knowledge_source_id
      JOIN signal_workspaces workspace ON workspace.brand_id=source.brand_id
      WHERE workspace.id=$1::uuid AND assertion.status='active'
    ) SELECT source_type,source_id,version,content,
      'sha256:'||encode(digest(content,'sha256'),'hex') content_hash
    FROM context_items WHERE btrim(content)<>'' ORDER BY source_type,source_id,version
  `, [args.workspace_id])).rows;
  const refs = contextItems.map((item) => ({ source_type: item.source_type, source_id: item.source_id,
    version: item.version, content_hash: item.content_hash }));
  const semanticRows = (await args.queryable.query<{
    generation_id: string; generation_key: string; generation_version: number; generation_status: string;
    pack_digest: string | null; draft_digest: string; element_id: string | null; element_key: string | null;
    element_version: number | null; element_kind: string | null; display_text: string | null;
    scope: string | null;
    canonical_key: string | null; relation_kind: string | null; relation_target_key: string | null;
    element_digest: string | null;
  }>(`
    WITH generation AS(
      SELECT generation.* FROM signal_semantic_context_generations generation
      WHERE generation.workspace_id=$1::uuid
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
          WHERE successor.workspace_id=generation.workspace_id
            AND successor.supersedes_generation_id=generation.id)
      ORDER BY generation.generation_version DESC LIMIT 1
    )
    SELECT generation.id::text generation_id,generation.generation_key,
      generation.generation_version,generation.status generation_status,generation.pack_digest,
      generation.draft_digest,element.id::text element_id,element.element_key,
      element.element_version,element.element_kind,element.display_text,element.canonical_key,
      element.scope,element.relation_kind,element.relation_target_key,element.element_digest
    FROM generation LEFT JOIN signal_semantic_context_element_versions element
      ON element.generation_id=generation.id AND element.workspace_id=generation.workspace_id
      AND element.disposition='approved' AND element.lifecycle_state='active'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)
    ORDER BY element.element_key
  `, [args.workspace_id])).rows;
  const semanticGeneration = semanticRows[0] ? {
    id: semanticRows[0].generation_id,
    key: semanticRows[0].generation_key,
    version: Number(semanticRows[0].generation_version),
    status: semanticRows[0].generation_status,
    digest: semanticRows[0].pack_digest ?? semanticRows[0].draft_digest
  } : null;
  const semanticElements = semanticRows.flatMap((row) => row.element_id && row.element_key
    && row.element_kind && row.display_text && row.element_digest ? [{
      id: row.element_id,
      key: row.element_key,
      version: Number(row.element_version),
      kind: row.element_kind,
      display_text: row.display_text,
      canonical_key: row.canonical_key,
      scope: row.scope,
      relation_kind: row.relation_kind,
      relation_target_key: row.relation_target_key,
      digest: row.element_digest
    }] : []);
  const negativeKinds = new Set(["exclusion", "homonym", "ambiguous_term", "abstention_rule",
    "negative_anchor", "boundary_anchor"]);
  const positiveSemanticElements = semanticElements.filter((item) => !negativeKinds.has(item.kind));
  const negativeSemanticElements = semanticElements.filter((item) => negativeKinds.has(item.kind));
  const semanticRefs: SignalTopicInheritedContextStoreV1["context_refs"] = semanticElements.map((item) => ({
    source_type: "semantic_context_element",
    source_id: item.id,
    version: `semantic-context:${semanticGeneration?.key ?? "unknown"}:${item.version}`,
    content_hash: item.digest
  }));
  const identities = governed.identities.map((item) => ({ ...item, aliases: [...item.aliases].sort() }))
    .sort((left, right) => `${left.scope}:${left.entity_id}`.localeCompare(`${right.scope}:${right.entity_id}`));
  const brandContext = [...governed.brand_context]
    .sort((left, right) => `${left.kind}:${left.title}`.localeCompare(`${right.kind}:${right.title}`));
  const brand = { ...governed.workspace, brand_handles: [...governed.workspace.brand_handles].sort(),
    countries: [...governed.workspace.countries].sort() };
  const context = {
    brand,
    identities,
    brand_context: brandContext,
    context_refs: refs,
    semantic_context: { generation: semanticGeneration, elements: semanticElements },
    locale: { primary_locale: primaryLocale, languages, markets,
      timezone: acquisition?.timezone ?? null }
  };
  const commonLines = [
    brand.brand_name,
    brand.description,
    brand.industry,
    brand.industry_sub,
    markets.length ? `Markets: ${markets.join(", ")}` : "",
    languages.length ? `Languages: ${languages.join(", ")}` : "",
    ...contextRows(brandContext, 16).map((item) => `${item.title}: ${item.content}`),
    ...contextRows(contextItems, 64).map((item) => `${item.source_type}: ${item.content}`)
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const embeddingContexts = Object.fromEntries((["primary_brand", "competitor", "category"] as const)
    .map((scope) => {
      const scopedIdentities = identities.filter((item) => item.scope === scope);
      const scopedPositive = positiveSemanticElements.filter((item) =>
        !item.scope || item.scope === "workspace" || item.scope === scope);
      const scopedNegative = negativeSemanticElements.filter((item) =>
        !item.scope || item.scope === "workspace" || item.scope === scope);
      const scopedContext = {
        scope,
        identities: scopedIdentities,
        semantic_generation: semanticGeneration,
        positive_elements: scopedPositive,
        negative_elements: scopedNegative,
        locale: context.locale,
        brand_digest: sha256(stableJson({ brand, brand_context: brandContext })),
        context_refs_digest: sha256(stableJson(refs))
      };
      return [scope, {
        context_digest: sha256(stableJson(scopedContext)),
        positive_text: contextText([
          ...commonLines,
          ...scopedIdentities.map((item) =>
            `${scope} identity: ${item.entity_label}; aliases: ${item.aliases.join(", ")}`),
          ...contextRows(scopedPositive, 80).map((item) =>
            `Brand ${item.kind}: ${item.display_text}${item.relation_target_key
              ? ` (${item.relation_kind ?? "related"}: ${item.relation_target_key})` : ""}`)
        ].join("\n")),
        negative_text: contextText(contextRows(scopedNegative, 80)
          .map((item) => `Brand ${item.kind}: ${item.display_text}`).join("\n"))
      }];
    })) as SignalTopicInheritedContextStoreV1["embedding_contexts"];
  return {
    context_digest: sha256(stableJson(context)),
    embedding_text: embeddingContexts.primary_brand.positive_text,
    negative_embedding_text: embeddingContexts.primary_brand.negative_text,
    embedding_contexts: embeddingContexts,
    context_refs: [...refs, ...semanticRefs].sort((left, right) =>
      `${left.source_type}:${left.source_id}:${left.version}`
        .localeCompare(`${right.source_type}:${right.source_id}:${right.version}`)),
    locale: { primary_locale: primaryLocale, languages, markets, timezone: acquisition?.timezone ?? null }
  };
}

export async function loadSignalTopicClassificationContextStoreV1(args: {
  queryable: Queryable;
  workspace_id: string;
  taxonomy_profile_id: string;
}) {
  const inherited = await loadSignalTopicInheritedContextStoreV1({
    queryable: args.queryable,
    workspace_id: args.workspace_id
  });
  const definitions = (await loadProfileTerms(args.queryable, args.taxonomy_profile_id))
    .map(readDefinition);
  return {
    ...inherited,
    definition_digest: classificationDefinitionDigest(definitions, inherited.context_digest)
  };
}

export async function loadSignalTopicEmbeddingPreflightStoreV1(args: {
  queryable: Queryable;
  workspace_id: string;
  taxonomy_profile_id: string;
}) : Promise<SignalTopicEmbeddingPreflightStoreV1> {
  try {
    const [population, context, terms] = await Promise.all([
      resolveTopicPopulation(args.queryable, args.workspace_id, args.taxonomy_profile_id),
      loadSignalTopicClassificationContextStoreV1(args),
      loadProfileTerms(args.queryable, args.taxonomy_profile_id)
    ]);
    const topics = terms.map(readDefinition).filter((topic) => topic.lifecycle !== "archived");
    if (population.denominator === 0 || topics.length === 0) return {
      status: "ready", embedding_model: null, missing_inputs: 0, estimated_micro_usd: 0,
      pricing_version: null, requires_paid_call: false, error_code: null
    };
    const expected = population.roots.map((root) => {
      const chunk = chunkForEmbedding(root.text_clean, { maxChars: 900, overlapChars: 0 })[0];
      if (!chunk) throw new SignalTopicCatalogError("topic_mention_text_unavailable", 409);
      return { mention_id: root.id, chunk_hash: hashEmbeddingChunk(chunk) };
    });
    const model = (await args.queryable.query<{ embedding_model: string }>(`
      SELECT embedding.embedding_model
      FROM semantic_embeddings embedding
      JOIN jsonb_to_recordset($2::jsonb) expected(mention_id uuid,chunk_hash text)
        ON expected.mention_id=embedding.mention_id AND expected.chunk_hash=embedding.chunk_hash
      WHERE embedding.scope_type='mention' AND embedding.study_corpus_id=$1::uuid
        AND embedding.chunk_index=0
      GROUP BY embedding.embedding_model HAVING count(DISTINCT embedding.mention_id)=$3
      ORDER BY max(embedding.created_at) DESC,embedding.embedding_model LIMIT 1
    `, [population.study_corpus_id, JSON.stringify(expected), population.denominator])).rows[0]?.embedding_model;
    if (!model) throw new SignalTopicCatalogError("topic_mention_embeddings_incomplete", 409);
    const inputs = topics.flatMap((topic) => {
      const built = buildSignalTopicEmbeddingInputsV1(topic, context.embedding_contexts[topic.scope]);
      return [built.positive, ...(built.negative ? [built.negative] : [])];
    });
    const cached = new Set((await args.queryable.query<{ definition_digest: string }>(`
      SELECT definition_digest FROM signal_topic_definition_embeddings
      WHERE workspace_id=$1::uuid AND embedding_model=$2 AND definition_digest=ANY($3::text[])
    `, [args.workspace_id, model, inputs.map((item) => item.digest)])).rows
      .map((row) => row.definition_digest));
    const missing = inputs.filter((item) => !cached.has(item.digest));
    if (missing.length === 0) return {
      status: "ready", embedding_model: model, missing_inputs: 0, estimated_micro_usd: 0,
      pricing_version: null, requires_paid_call: false, error_code: null
    };
    const provider = getEmbeddingProvider();
    if (!provider || getEmbeddingModel(provider) !== model) {
      throw new SignalTopicCatalogError("topic_definition_embedding_unavailable", 409);
    }
    const estimate = estimateSignalTopicEmbeddingCostMicroUsdV1({
      provider, model, texts: missing.map((item) => item.text)
    });
    return { status: "ready", embedding_model: model, missing_inputs: missing.length,
      estimated_micro_usd: estimate.estimated_micro_usd, pricing_version: estimate.pricing_version,
      requires_paid_call: true, error_code: null };
  } catch (error) {
    return { status: "blocked", embedding_model: null, missing_inputs: 0, estimated_micro_usd: 0,
      pricing_version: null, requires_paid_call: false,
      error_code: error instanceof Error ? error.message : "topic_embedding_preflight_failed" };
  }
}

export async function loadLegacySignalTopicDiscoveryCandidatesStoreV1(args: {
  queryable: Queryable;
  workspace_id: string;
}) {
  const rows = (await args.queryable.query<{
    profile_id: string;
    context_hash: string;
    candidate_key: string;
    title: string;
    description: string;
    metadata: unknown;
    evidence_count: number;
  }>(`
    WITH source_profile AS(
      SELECT id,taxonomy_id,context_hash
      FROM signal_taxonomy_profiles
      WHERE workspace_id=$1::uuid AND kind='topic'
        AND status IN('active','retired')
        AND COALESCE(metadata->>'contract_version','')<>'signal-topic-catalog-v1'
      ORDER BY version DESC LIMIT 1
    )
    SELECT profile.id::text profile_id,profile.context_hash,term.term_key candidate_key,
      term.label title,COALESCE(term.description,'') description,term.metadata,
      count(DISTINCT tag.subject_id)::int evidence_count
    FROM source_profile profile
    JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
    LEFT JOIN record_tags tag ON tag.signal_taxonomy_profile_id=profile.id
      AND tag.taxonomy_term_id=term.id AND tag.subject_type='mention'
    GROUP BY profile.id,profile.context_hash,term.id
    ORDER BY term.sort_order,term.term_key
    LIMIT 50
  `, [args.workspace_id])).rows;
  const profile = rows[0];
  return {
    run_key: profile ? `taxonomy-profile:${profile.profile_id}` : null,
    items: rows.map((row) => {
      const metadata = objectValue(row.metadata);
      return {
        candidate_key: row.candidate_key,
        title: row.title,
        description: row.description,
        inclusion: stringArray(metadata.examples),
        exclusion: stringArray(metadata.exclusions),
        evidence_count: Number(row.evidence_count),
        origin: "historical_taxonomy" as const,
        scope: readCandidateScope(metadata.scope),
        review_state: "historical"
      };
    })
  };
}

export async function loadSignalTopicCatalogStoreV1(args: {
  queryable: Queryable;
  workspace_id: string;
}): Promise<SignalTopicCatalogStoreV1> {
  const [profile, imports] = await Promise.all([
    loadLatestProfile(args.queryable, args.workspace_id),
    loadTopicImportReadiness(args.queryable, args.workspace_id)
  ]);
  const active = (await args.queryable.query<{ id: string }>(`
    SELECT id::text FROM signal_taxonomy_profiles
    WHERE workspace_id=$1::uuid AND kind='topic' AND status='active'
      AND metadata->>'contract_version'='signal-topic-catalog-v1'
    ORDER BY version DESC LIMIT 1
  `, [args.workspace_id])).rows[0]?.id ?? null;
  if (!profile) return {
    contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
    workspace_id: args.workspace_id,
    profile: null,
    active_profile_id: active,
    topics: [],
    execution: null,
    search_execution_id: null,
    search_is_current: false,
    readiness: topicReadiness(imports, 0, null),
    embedding_preflight: { status: "ready", embedding_model: null, missing_inputs: 0,
      estimated_micro_usd: 0, pricing_version: null, requires_paid_call: false, error_code: null }
  };
  const [terms, execution, counts, search, embeddingPreflight] = await Promise.all([
    loadProfileTerms(args.queryable, profile.id),
    loadLatestExecution(args.queryable, profile.id),
    loadLatestCounts(args.queryable, profile.id),
    loadLatestReadySearch(args.queryable, args.workspace_id, profile.id),
    imports.canonical_mentions === 0 || !imports.operational_corpus_id
      ? Promise.resolve<SignalTopicEmbeddingPreflightStoreV1>({ status: "blocked", embedding_model: null,
          missing_inputs: 0, estimated_micro_usd: 0, pricing_version: null, requires_paid_call: false,
          error_code: "topic_mentions_required" })
      : loadSignalTopicEmbeddingPreflightStoreV1({ queryable: args.queryable,
          workspace_id: args.workspace_id, taxonomy_profile_id: profile.id })
  ]);
  return {
    contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
    workspace_id: args.workspace_id,
    profile,
    active_profile_id: active,
    execution,
    search_execution_id: search.id,
    search_is_current: search.is_current,
    embedding_preflight: embeddingPreflight,
    readiness: topicReadiness(imports, terms.filter((term) => term.status !== "archived").length,
      embeddingPreflight.error_code),
    topics: terms.map((term) => ({
      ...readDefinition(term),
      taxonomy_term_id: term.id,
      status: topicStatus(profile, term, execution, active, search.is_current, search.published),
      counts: counts.get(term.term_key) ?? { relevant: 0, doubt: 0, excluded: 0 }
    }))
  };
}

async function loadTopicImportReadiness(queryable: Queryable, workspaceId: string) {
  const corpora = (await queryable.query<{ id: string; canonical_mentions: number; imported_mentions: number }>(`
    SELECT membership.study_corpus_id::text id,
      (SELECT count(*)::int FROM mentions mention
        WHERE mention.study_corpus_id=membership.study_corpus_id) imported_mentions,
      (SELECT count(*)::int FROM mentions mention
        WHERE mention.study_corpus_id=membership.study_corpus_id
          AND mention.canonical_mention_id=mention.id) canonical_mentions
    FROM signal_workspace_corpora membership
    WHERE membership.workspace_id=$1::uuid AND membership.role='operational'
      AND membership.valid_to IS NULL
    ORDER BY membership.study_corpus_id
  `, [workspaceId])).rows;
  const importedMentions = corpora.reduce((sum, row) => sum + Number(row.imported_mentions), 0);
  // Receiving a file and preparing its operational corpus are separate stages.
  // An accepted upload must not send the operator back to upload it again.
  const hasReceivedImport = importedMentions > 0 || Boolean((await queryable.query<{ has_received_import: boolean }>(`
    SELECT EXISTS(SELECT 1 FROM import_batches batch
      WHERE batch.workspace_id=$1::uuid AND batch.status='completed'
        AND batch.record_count>0) has_received_import
  `, [workspaceId])).rows[0]?.has_received_import);
  return { operational_corpus_id: corpora.length === 1 ? corpora[0]!.id : null,
    canonical_mentions: corpora.reduce((sum, row) => sum + Number(row.canonical_mentions), 0),
    imported_mentions: importedMentions,
    has_received_import: hasReceivedImport,
    ambiguous: corpora.length > 1 };
}

function topicReadiness(imports: Awaited<ReturnType<typeof loadTopicImportReadiness>>,
  topicCount: number, preparationError: string | null): SignalTopicReadinessV1 {
  const counts = { operational_corpus_id: imports.operational_corpus_id,
    canonical_mentions: imports.canonical_mentions };
  if (imports.ambiguous) return { ...counts, state: "needs_preparation",
    next_action: "prepare_mentions", reason_code: "topic_operational_corpus_ambiguous" };
  if (!imports.has_received_import) return { ...counts, state: "awaiting_import",
    next_action: "import_mentions", reason_code: null };
  if (imports.imported_mentions === 0) return { ...counts, state: "needs_preparation",
    next_action: "prepare_mentions", reason_code: "topic_operational_preparation_required" };
  if (imports.canonical_mentions === 0) return { ...counts, state: "needs_preparation",
    next_action: "prepare_mentions", reason_code: "topic_canonicalization_required" };
  if (topicCount === 0) return { ...counts, state: "awaiting_topics",
    next_action: "define_topics", reason_code: null };
  if (preparationError) return { ...counts, state: "needs_preparation",
    next_action: "prepare_mentions", reason_code: preparationError };
  return { ...counts, state: "ready", next_action: "search_topics", reason_code: null };
}

export async function createSignalTopicStoreV1(args: {
  pool: Pool;
  workspace_id: string;
  actor_user_id: string;
  idempotency_key: string;
  input: CreateSignalTopicInputV1;
}) {
  return mutateCatalog(args, { action: "create", payload: args.input }, ({ definitions, now }) => {
    const termKey = uniqueSignalTopicTermKey(args.input.label, definitions);
    const semantic = {
      term_key: termKey,
      label: args.input.label,
      definition: args.input.definition,
      scope: args.input.scope,
      inclusion: args.input.inclusion,
      exclusion: args.input.exclusion,
      positive_examples: args.input.positive_examples,
      negative_examples: args.input.negative_examples,
      lifecycle: "draft" as const,
      origin: "manual" as const,
      source: null
    };
    definitions.push(signalTopicDefinitionSchemaV1.parse({
      ...semantic,
      definition_revision: 1,
      definition_digest: signalTopicDefinitionDigestV1(semantic),
      created_at: now,
      updated_at: now
    }));
    return { term_key: termKey, semantic_changed: true };
  });
}

export async function adoptSignalTopicCandidateStoreV1(args: {
  pool: Pool;
  workspace_id: string;
  actor_user_id: string;
  idempotency_key: string;
  input: AdoptSignalTopicCandidateInputV1;
}) {
  await assertActor(args.pool, args.workspace_id, args.actor_user_id, "can_adopt_topics");
  const existing = await findTopicBySource(args.pool, args.workspace_id, args.input.run_key, args.input.candidate_key);
  if (existing) return { ...(await loadSignalTopicCatalogStoreV1({ queryable: args.pool,
    workspace_id: args.workspace_id })), term_key: existing, reused: true };
  const candidate = await loadAdoptionCandidate(args);
  const result = await mutateCatalog(args, { action: "adopt", payload: args.input }, ({ definitions, now }) => {
    const duplicate = definitions.find((item) => item.source?.run_key === args.input.run_key
      && item.source.candidate_key === args.input.candidate_key);
    if (duplicate) return { term_key: duplicate.term_key, semantic_changed: false };
    const termKey = uniqueSignalTopicTermKey(candidate.title, definitions);
    const semantic = {
      term_key: termKey,
      label: candidate.title,
      definition: candidate.description,
      scope: args.input.scope ?? candidate.scope ?? requireCandidateScope(),
      inclusion: stringArray(candidate.inclusion),
      exclusion: stringArray(candidate.exclusion),
      positive_examples: candidate.positive_examples,
      negative_examples: candidate.negative_examples,
      lifecycle: "draft" as const,
      origin: candidate.origin,
      source: {
        run_key: args.input.run_key,
        candidate_key: args.input.candidate_key,
        candidate_digest: candidate.candidate_digest
      }
    };
    const parsed = signalTopicDefinitionSchemaV1.safeParse({
      ...semantic,
      definition_revision: 1,
      definition_digest: signalTopicDefinitionDigestV1(semantic),
      created_at: now,
      updated_at: now
    });
    if (!parsed.success) throw new SignalTopicCatalogError("topic_candidate_definition_invalid", 422);
    definitions.push(parsed.data);
    return { term_key: termKey, semantic_changed: true };
  });
  return { ...result, reused: false };
}

async function loadAdoptionCandidate(args: {
  pool: Pool;
  workspace_id: string;
  actor_user_id: string;
  input: AdoptSignalTopicCandidateInputV1;
}) {
  const legacyProfileId = args.input.run_key.startsWith("taxonomy-profile:")
    ? args.input.run_key.slice("taxonomy-profile:".length)
    : null;
  if (legacyProfileId) {
    const row = (await args.pool.query<{
      title: string; description: string; metadata: unknown; context_hash: string;
    }>(`
      SELECT term.label title,COALESCE(term.description,'') description,term.metadata,
        profile.context_hash
      FROM signal_taxonomy_profiles profile
      JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
      WHERE profile.id=$1::uuid AND profile.workspace_id=$2::uuid AND profile.kind='topic'
        AND COALESCE(profile.metadata->>'contract_version','')<>'signal-topic-catalog-v1'
        AND term.term_key=$3
    `, [legacyProfileId, args.workspace_id, args.input.candidate_key])).rows[0];
    if (!row) throw new SignalTopicCatalogError("topic_candidate_not_found", 404);
    const metadata = objectValue(row.metadata);
    return {
      title: row.title,
      description: row.description,
      inclusion: [] as string[],
      exclusion: stringArray(metadata.exclusions),
      positive_examples: stringArray(metadata.examples),
      negative_examples: [] as string[],
      candidate_digest: sha256(stableJson({ profile_id: legacyProfileId,
        context_hash: row.context_hash, candidate_key: args.input.candidate_key, metadata })),
      origin: "historical_taxonomy" as const,
      scope: readCandidateScope(metadata.scope)
    };
  }
  const detail = await loadSignalTopicEvaluationV2CandidateDetail({
    queryable: args.pool,
    workspace_id: args.workspace_id,
    actor: { id: args.actor_user_id, user_type: "noisia_internal" },
    run_key: args.input.run_key,
    candidate_key: args.input.candidate_key
  });
  return {
    title: detail.candidate.title,
    description: detail.candidate.description,
    inclusion: stringArray(detail.candidate.inclusion),
    exclusion: stringArray(detail.candidate.exclusion),
    positive_examples: [] as string[],
    negative_examples: [] as string[],
    candidate_digest: detail.candidate.candidate_digest,
    origin: "evidence_candidate" as const,
    scope: readCandidateScope(objectValue(detail.candidate.base_model_payload).scope)
  };
}

function readCandidateScope(value: unknown): SignalTopicScopeV1 | null {
  return value === "primary_brand" || value === "competitor" || value === "category" ? value : null;
}

function requireCandidateScope(): never {
  throw new SignalTopicCatalogError("topic_candidate_scope_required", 422);
}

export async function updateSignalTopicStoreV1(args: {
  pool: Pool;
  workspace_id: string;
  actor_user_id: string;
  idempotency_key: string;
  term_key: string;
  input: UpdateSignalTopicInputV1;
}) {
  return mutateCatalog(args, { action: "update", payload: { term_key: args.term_key, ...args.input } }, ({ definitions, now }) => {
    const index = definitions.findIndex((item) => item.term_key === args.term_key);
    const current = definitions[index];
    if (!current) throw new SignalTopicCatalogError("topic_not_found", 404);
    if (current.definition_revision !== args.input.expected_definition_revision) {
      throw new SignalTopicCatalogError("topic_revision_conflict", 409);
    }
    const nextBase = { ...current, ...args.input, updated_at: now };
    delete (nextBase as Partial<UpdateSignalTopicInputV1>).expected_definition_revision;
    const nextSemantic = {
      term_key: current.term_key,
      label: nextBase.label,
      definition: nextBase.definition,
      scope: nextBase.scope,
      inclusion: nextBase.inclusion,
      exclusion: nextBase.exclusion,
      positive_examples: nextBase.positive_examples,
      negative_examples: nextBase.negative_examples,
      lifecycle: nextBase.lifecycle,
      origin: nextBase.origin,
      source: nextBase.source
    };
    const digest = signalTopicDefinitionDigestV1(nextSemantic);
    const semanticChanged = digest !== current.definition_digest;
    definitions[index] = signalTopicDefinitionSchemaV1.parse({
      ...nextSemantic,
      definition_revision: current.definition_revision + (semanticChanged ? 1 : 0),
      definition_digest: digest,
      created_at: current.created_at,
      updated_at: now
    });
    return { term_key: current.term_key, semantic_changed: semanticChanged };
  });
}

export async function setSignalTopicLifecycleStoreV1(args: {
  pool: Pool;
  workspace_id: string;
  actor_user_id: string;
  idempotency_key: string;
  term_key: string;
  lifecycle: "draft" | "archived";
}) {
  return mutateCatalog(args, { action: args.lifecycle === "archived" ? "archive" : "restore",
    payload: { term_key: args.term_key, lifecycle: args.lifecycle } }, ({ definitions, now }) => {
    const index = definitions.findIndex((item) => item.term_key === args.term_key);
    const current = definitions[index];
    if (!current) throw new SignalTopicCatalogError("topic_not_found", 404);
    if (current.lifecycle === args.lifecycle) return { term_key: current.term_key, semantic_changed: false };
    const semantic = { ...current, lifecycle: args.lifecycle };
    const digest = signalTopicDefinitionDigestV1(semantic);
    definitions[index] = signalTopicDefinitionSchemaV1.parse({ ...current, lifecycle: args.lifecycle,
      definition_revision: current.definition_revision + 1, definition_digest: digest, updated_at: now });
    return { term_key: current.term_key, semantic_changed: true };
  });
}

export async function createSignalTopicCatalogExecutionStoreV1(args: {
  pool: Pool;
  workspace_id: string;
  actor_user_id: string;
  intent: "search" | "publish";
  publish_when_ready?: boolean;
  embedding_cost_cap_micro_usd?: number;
  idempotency_key: string;
}) {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    await assertActor(client, args.workspace_id, args.actor_user_id, "can_execute_topics");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`signal-taxonomy:${args.workspace_id}:topic`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`topic-execution:${args.workspace_id}`]);
    const existing = (await client.query<{
      id: string; actor_user_id: string; input_contract: string; intent: "search" | "publish"; publish_when_ready: boolean;
      embedding_cost_cap_micro_usd: number | null;
    }>(`
      SELECT id::text,actor_user_id::text,input_contract,intent,publish_when_ready,embedding_cost_cap_micro_usd
      FROM signal_topic_catalog_executions
      WHERE workspace_id=$1::uuid AND idempotency_key=$2
    `, [args.workspace_id, args.idempotency_key])).rows[0];
    if (existing) {
      const existingCap = existing.embedding_cost_cap_micro_usd === null ? null
        : Number(existing.embedding_cost_cap_micro_usd);
      const capConflict = existingCap !== null
        && existingCap !== (args.embedding_cost_cap_micro_usd ?? null);
      if (existing.input_contract !== "legacy-topic-catalog-v1" || existing.actor_user_id !== args.actor_user_id
        || existing.intent !== args.intent
        || existing.publish_when_ready !== (args.intent === "search" && args.publish_when_ready === true)
        || capConflict) {
        throw new SignalTopicCatalogError("topic_execution_idempotency_conflict", 409);
      }
      await client.query("COMMIT");
      return loadExecutionById(args.pool, existing.id);
    }
    let profile = await loadLatestProfile(client, args.workspace_id);
    if (!profile) throw new SignalTopicCatalogError("topic_catalog_empty", 409);
    let definitionContext = await loadSignalTopicClassificationContextStoreV1({ queryable: client,
      workspace_id: args.workspace_id, taxonomy_profile_id: profile.id });
    let population = await resolveTopicPopulation(client, args.workspace_id, profile.id);
    const priorGeneration = args.intent === "search" && profile.status === "active"
      ? (await client.query<{ study_corpus_id: string }>(`
          SELECT study_corpus_id::text FROM signal_classification_generations
          WHERE workspace_id=$1::uuid AND taxonomy_profile_id=$2::uuid
            AND generation_key='topic-catalog-v1' AND status='ready'
          ORDER BY generation_version DESC,id DESC LIMIT 1
        `, [args.workspace_id, profile.id])).rows[0] : undefined;
    if (args.intent === "search"
      && (definitionContext.definition_digest !== profile.context_hash
        || (profile.status === "active" && priorGeneration
          && priorGeneration.study_corpus_id !== population.study_corpus_id))) {
      const definitions = (await loadProfileTerms(client, profile.id)).map(readDefinition);
      if (profile.status !== "active") {
        await client.query("UPDATE signal_taxonomy_profiles SET status='retired',updated_at=now() WHERE id=$1::uuid",
          [profile.id]);
        await client.query("UPDATE taxonomies SET status='retired' WHERE id=$1::uuid", [profile.taxonomy_id]);
      }
      await insertTopicCatalogDraft(client, args.workspace_id, definitions,
        definitionContext.definition_digest, definitionContext);
      profile = await loadLatestProfile(client, args.workspace_id);
      if (!profile || profile.status !== "draft") {
        throw new SignalTopicCatalogError("topic_context_successor_not_created", 500);
      }
      definitionContext = await loadSignalTopicClassificationContextStoreV1({ queryable: client,
        workspace_id: args.workspace_id, taxonomy_profile_id: profile.id });
      population = await resolveTopicPopulation(client, args.workspace_id, profile.id);
    }
    if ((args.intent === "publish" || args.publish_when_ready === true)
      && (await loadProfileTerms(client, profile.id)).map(readDefinition)
        .some((topic) => topic.lifecycle !== "archived" && topic.scope !== "primary_brand")) {
      throw new SignalTopicCatalogError("topic_signal_scope_unsupported", 422);
    }
    const definitionDigest = definitionContext.definition_digest;
    let embeddingEstimateMicroUsd: number | null = null;
    let embeddingCapMicroUsd: number | null = null;
    let embeddingPricingVersion: string | null = null;
    let sourceExecutionId: string | null = null;
    if (args.intent === "search") {
      if (profile.status === "draft") {
        await client.query("SELECT (prepare_signal_topic_catalog_profile_v1($1::uuid,$2::uuid)).id",
          [profile.id, args.actor_user_id]);
        profile.status = "activating";
      }
      if (profile.status !== "activating" && profile.status !== "active")
        throw new SignalTopicCatalogError("topic_catalog_requires_edit_before_search", 409);
      const embeddingPreflight = await loadSignalTopicEmbeddingPreflightStoreV1({ queryable: client,
        workspace_id: args.workspace_id, taxonomy_profile_id: profile.id });
      if (embeddingPreflight.status !== "ready") {
        throw new SignalTopicCatalogError(embeddingPreflight.error_code ?? "topic_embedding_preflight_failed", 409);
      }
      embeddingEstimateMicroUsd = embeddingPreflight.estimated_micro_usd;
      embeddingPricingVersion = embeddingPreflight.pricing_version;
      if (embeddingPreflight.requires_paid_call) {
        const cap = args.embedding_cost_cap_micro_usd;
        if (!cap) throw new SignalTopicCatalogError("topic_embedding_cost_confirmation_required", 409);
        if (cap < embeddingPreflight.estimated_micro_usd) {
          throw new SignalTopicCatalogError("topic_embedding_hard_cap_exceeded", 409);
        }
        embeddingCapMicroUsd = cap;
      }
    } else {
      const source = (await client.query<{ id: string; study_corpus_id: string; population_digest: string;
        watermark_digest: string; identity_catalog_digest: string; definition_digest: string; denominator: number }>(`
        SELECT id::text,study_corpus_id::text,population_digest,watermark_digest,
          identity_catalog_digest,definition_digest,denominator
        FROM signal_topic_catalog_executions
        WHERE workspace_id=$1::uuid AND taxonomy_profile_id=$2::uuid
          AND input_contract='legacy-topic-catalog-v1'
          AND intent='search' AND status='ready'
          AND result_summary->>'correction_digest'=
            signal_topic_membership_override_digest_v1(workspace_id,taxonomy_profile_id)
        ORDER BY completed_at DESC,id DESC LIMIT 1
      `, [args.workspace_id, profile.id])).rows[0];
      if (!source || (profile.status !== "activating" && profile.status !== "active")
        || source.study_corpus_id !== population.study_corpus_id
        || source.population_digest !== population.population_digest
        || source.watermark_digest !== population.watermark_digest
        || source.identity_catalog_digest !== population.identity_catalog_digest
        || source.definition_digest !== definitionDigest
        || Number(source.denominator) !== population.denominator) {
        throw new SignalTopicCatalogError("topic_search_result_not_ready", 409);
      }
      sourceExecutionId = source.id;
    }
    const requestDigest = sha256(stableJson({
      contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
      intent: args.intent,
      workspace_id: args.workspace_id,
      profile_id: profile.id,
      source_execution_id: sourceExecutionId,
      publish_when_ready: args.intent === "search" && args.publish_when_ready === true,
      population_digest: population.population_digest,
      definition_digest: definitionDigest,
      embedding_cost_estimate_micro_usd: embeddingEstimateMicroUsd,
      embedding_cost_cap_micro_usd: embeddingCapMicroUsd,
      embedding_pricing_version: embeddingPricingVersion
    }));
    const row = (await client.query<{ id: string }>(`
      INSERT INTO signal_topic_catalog_executions(workspace_id,taxonomy_profile_id,study_corpus_id,
        actor_user_id,intent,source_execution_id,idempotency_key,request_digest,population_digest,
        watermark_digest,identity_catalog_digest,definition_digest,denominator,publish_when_ready,
        embedding_cost_estimate_micro_usd,embedding_cost_cap_micro_usd,embedding_pricing_version)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id::text
    `, [args.workspace_id, profile.id, population.study_corpus_id, args.actor_user_id, args.intent,
      sourceExecutionId, args.idempotency_key, requestDigest, population.population_digest,
      population.watermark_digest, population.identity_catalog_digest, definitionDigest,
      population.denominator, args.intent === "search" && args.publish_when_ready === true,
      embeddingEstimateMicroUsd, embeddingCapMicroUsd, embeddingPricingVersion])).rows[0];
    if (!row) throw new SignalTopicCatalogError("topic_execution_not_created", 500);
    await client.query(`
      INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id)
      VALUES($1::uuid,$2::uuid,$3)
    `, [row.id, args.workspace_id, `signal-topic-classification-${row.id}`]);
    await client.query("COMMIT");
    return loadExecutionById(args.pool, row.id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function correctSignalTopicMembershipStoreV1(args: {
  pool: Pool;
  workspace_id: string;
  actor_user_id: string;
  execution_id: string;
  term_key: string;
  canonical_root_id: string;
  disposition: "belongs" | "excluded";
  expected_definition_revision: number;
  idempotency_key: string;
}) {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    await assertActor(client, args.workspace_id, args.actor_user_id, "can_execute_topics");
    const requestDigest = sha256(stableJson({
      execution_id: args.execution_id,
      term_key: args.term_key,
      canonical_root_id: args.canonical_root_id,
      disposition: args.disposition,
      definition_revision: args.expected_definition_revision
    }));
    const replay = (await client.query<{
      actor_user_id: string;
      execution_id: string;
      term_key: string;
      canonical_root_id: string;
      disposition: "belongs" | "excluded";
      definition_revision: number;
      request_digest: string;
    }>(`
      SELECT actor_user_id::text,execution_id::text,term_key,canonical_root_id::text,
        disposition,definition_revision,request_digest
      FROM signal_topic_membership_operations
      WHERE workspace_id=$1::uuid AND idempotency_key=$2
    `, [args.workspace_id, args.idempotency_key])).rows[0];
    if (replay) {
      if (replay.actor_user_id !== args.actor_user_id
        || replay.execution_id !== args.execution_id
        || replay.term_key !== args.term_key
        || replay.canonical_root_id !== args.canonical_root_id
        || replay.disposition !== args.disposition
        || replay.definition_revision !== args.expected_definition_revision
        || replay.request_digest !== requestDigest) {
        throw new SignalTopicCatalogError("topic_correction_idempotency_conflict", 409);
      }
      await client.query("COMMIT");
      const profile = (await client.query<{ active: boolean }>(`
        SELECT profile.status='active' active FROM signal_topic_catalog_executions execution
        JOIN signal_taxonomy_profiles profile ON profile.id=execution.taxonomy_profile_id
        WHERE execution.id=$1::uuid AND execution.workspace_id=$2::uuid AND execution.input_contract='legacy-topic-catalog-v1'
      `, [args.execution_id, args.workspace_id])).rows[0];
      return { contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1, term_key: args.term_key,
        canonical_root_id: args.canonical_root_id, disposition: args.disposition,
        profile_was_active: profile?.active === true };
    }
    const anchor = (await client.query<{ definition_revision: number; taxonomy_profile_id: string;
      profile_status: CatalogProfileRow["status"] }>(`
      SELECT (term.metadata->'topic'->>'definition_revision')::int definition_revision,
        execution.taxonomy_profile_id::text,profile.status profile_status
      FROM signal_topic_classification_suggestions suggestion
      JOIN signal_topic_catalog_executions execution ON execution.id=suggestion.execution_id
      JOIN signal_taxonomy_profiles profile ON profile.id=execution.taxonomy_profile_id
      JOIN taxonomy_terms term ON term.id=suggestion.taxonomy_term_id
      WHERE suggestion.execution_id=$1::uuid AND suggestion.workspace_id=$2::uuid
        AND suggestion.canonical_root_id=$3::uuid AND suggestion.term_key=$4
        AND execution.status='ready' AND execution.input_contract='legacy-topic-catalog-v1'
    `, [args.execution_id, args.workspace_id, args.canonical_root_id, args.term_key])).rows[0];
    if (!anchor) throw new SignalTopicCatalogError("topic_result_not_found", 404);
    if (anchor.definition_revision !== args.expected_definition_revision) {
      throw new SignalTopicCatalogError("topic_revision_conflict", 409);
    }
    const busy = (await client.query<{ busy: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions
        WHERE taxonomy_profile_id=$1::uuid AND status IN('queued','running')) busy
    `, [anchor.taxonomy_profile_id])).rows[0]?.busy;
    if (busy) throw new SignalTopicCatalogError("topic_catalog_busy", 409);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`${args.workspace_id}:topic-catalog-publish`]);
    await client.query(`
      INSERT INTO signal_topic_membership_overrides(workspace_id,term_key,canonical_root_id,
        disposition,definition_revision,actor_user_id)
      VALUES($1::uuid,$2,$3::uuid,$4,$5,$6::uuid)
      ON CONFLICT(workspace_id,term_key,canonical_root_id) DO UPDATE SET
        disposition=EXCLUDED.disposition,definition_revision=EXCLUDED.definition_revision,
        actor_user_id=EXCLUDED.actor_user_id,updated_at=now()
    `, [args.workspace_id, args.term_key, args.canonical_root_id, args.disposition,
      args.expected_definition_revision, args.actor_user_id]);
    await client.query(`
      INSERT INTO signal_topic_membership_operations(workspace_id,actor_user_id,execution_id,
        term_key,canonical_root_id,disposition,definition_revision,idempotency_key,request_digest)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$8,$9)
    `, [args.workspace_id, args.actor_user_id, args.execution_id, args.term_key,
      args.canonical_root_id, args.disposition, args.expected_definition_revision,
      args.idempotency_key, requestDigest]);
    await client.query("COMMIT");
    return { contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1, term_key: args.term_key,
      canonical_root_id: args.canonical_root_id, disposition: args.disposition,
      profile_was_active: anchor.profile_status === "active" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function loadSignalTopicExecutionResultsStoreV1(args: {
  queryable: Queryable;
  workspace_id: string;
  execution_id: string;
  term_key?: string | null;
  state?: "relevant" | "doubt" | "excluded" | null;
  limit?: number;
}) {
  const limit = Math.min(Math.max(args.limit ?? 40, 1), 100);
  const result = await args.queryable.query<{
    canonical_root_id: string; text: string; platform: string; published_at: string;
    term_key: string; term_label: string; disposition: "relevant" | "doubt" | "excluded" | "none";
    method: string; semantic_score: string | null; lexical_match: boolean; excluded_by_rule: boolean;
    correction: "belongs" | "excluded" | null; correction_updated_at: string | null;
    definition_revision: number;
  }>(`
    WITH effective AS(
      SELECT suggestion.*,CASE override.disposition WHEN 'belongs' THEN 'relevant'
        WHEN 'excluded' THEN 'excluded' ELSE suggestion.disposition END effective_disposition,
        override.disposition correction,override.updated_at::text correction_updated_at
      FROM signal_topic_classification_suggestions suggestion
      JOIN taxonomy_terms term ON term.id=suggestion.taxonomy_term_id
      LEFT JOIN signal_topic_membership_overrides override ON override.workspace_id=suggestion.workspace_id
        AND override.term_key=suggestion.term_key AND override.canonical_root_id=suggestion.canonical_root_id
        AND override.definition_revision=(term.metadata->'topic'->>'definition_revision')::int
      WHERE suggestion.execution_id=$1::uuid AND suggestion.workspace_id=$2::uuid
    )
    SELECT suggestion.canonical_root_id::text,mention.text_clean text,mention.platform,
      mention.published_at::text,suggestion.term_key,term.label term_label,
      suggestion.effective_disposition disposition,
      suggestion.method,suggestion.semantic_score::text,suggestion.lexical_match,
      suggestion.excluded_by_rule,suggestion.correction,suggestion.correction_updated_at,
      (term.metadata->'topic'->>'definition_revision')::int definition_revision
    FROM effective suggestion
    JOIN signal_topic_catalog_executions execution ON execution.id=suggestion.execution_id
    JOIN mentions mention ON mention.id=suggestion.canonical_root_id
    JOIN taxonomy_terms term ON term.id=suggestion.taxonomy_term_id
    WHERE execution.status='ready' AND execution.input_contract='legacy-topic-catalog-v1'
      AND ($3::text IS NULL OR suggestion.term_key=$3)
      AND ($4::text IS NULL OR suggestion.effective_disposition=$4)
      AND suggestion.effective_disposition<>'none'
    ORDER BY CASE suggestion.effective_disposition WHEN 'relevant' THEN 0 WHEN 'doubt' THEN 1 ELSE 2 END,
      suggestion.semantic_score DESC NULLS LAST,suggestion.canonical_root_id
    LIMIT $5
  `, [args.execution_id, args.workspace_id, args.term_key ?? null, args.state ?? null, limit]);
  return {
    contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
    execution_id: args.execution_id,
    items: result.rows.map((row) => ({ ...row,
      semantic_score: row.semantic_score === null ? null : Number(row.semantic_score) }))
  };
}

async function mutateCatalog<T extends { term_key: string; semantic_changed: boolean }>(args: {
  pool: Pool;
  workspace_id: string;
  actor_user_id: string;
  idempotency_key: string;
}, operation: { action: "create" | "adopt" | "update" | "archive" | "restore"; payload: unknown },
mutate: (state: { definitions: SignalTopicDefinitionV1[]; now: string }) => T) {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    await assertActor(client, args.workspace_id, args.actor_user_id);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`signal-taxonomy:${args.workspace_id}:topic`]);
    const operationDigest = sha256(stableJson({ action: operation.action, payload: operation.payload }));
    const replay = (await client.query<{ actor_user_id: string; action: string; request_digest: string;
      result_term_key: string; result_summary: unknown }>(`
      SELECT actor_user_id::text,action,request_digest,result_term_key,result_summary
      FROM signal_topic_catalog_operations WHERE workspace_id=$1::uuid AND idempotency_key=$2
    `, [args.workspace_id, args.idempotency_key])).rows[0];
    if (replay) {
      if (replay.actor_user_id !== args.actor_user_id || replay.action !== operation.action
        || replay.request_digest !== operationDigest) {
        throw new SignalTopicCatalogError("topic_catalog_idempotency_conflict", 409);
      }
      const summary = objectValue(replay.result_summary);
      await client.query("COMMIT");
      return { ...(await loadSignalTopicCatalogStoreV1({ queryable: args.pool,
        workspace_id: args.workspace_id })), term_key: replay.result_term_key,
        semantic_changed: summary.semantic_changed === true,
        prior_profile_status: typeof summary.prior_profile_status === "string"
          ? summary.prior_profile_status : null,
        prior_had_ready_search: summary.prior_had_ready_search === true,
        reused_search_execution_id: typeof summary.reused_search_execution_id === "string"
          ? summary.reused_search_execution_id : null, replayed: true };
    }
    const prior = await loadLatestProfile(client, args.workspace_id);
    if (prior && (await client.query<{ busy: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions
        WHERE taxonomy_profile_id=$1::uuid AND status IN ('queued','running')) busy
    `, [prior.id])).rows[0]?.busy) throw new SignalTopicCatalogError("topic_catalog_busy", 409);
    const definitions = prior ? (await loadProfileTerms(client, prior.id)).map(readDefinition) : [];
    const priorHadReadySearch = prior ? Boolean((await client.query<{ available: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions
        WHERE taxonomy_profile_id=$1::uuid AND intent='search' AND status='ready'
          AND input_contract='legacy-topic-catalog-v1') available
    `, [prior.id])).rows[0]?.available) : false;
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client,
      workspace_id: args.workspace_id, actor_user_id: args.actor_user_id });
    if (!capabilities.can_execute_topics && (priorHadReadySearch || (await client.query<{ active: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM signal_taxonomy_profiles
        WHERE workspace_id=$1::uuid AND kind='topic' AND status='active'
          AND metadata->>'contract_version'='signal-topic-catalog-v1') active
    `, [args.workspace_id])).rows[0]?.active)) {
      throw new SignalTopicCatalogError("topic_processing_permissions_required", 403);
    }
    const outcome = mutate({ definitions, now: new Date().toISOString() });
    const inherited = await loadSignalTopicInheritedContextStoreV1({ queryable: client,
      workspace_id: args.workspace_id });
    const contextHash = classificationDefinitionDigest(definitions, inherited.context_digest);
    if (prior && prior.status !== "active") {
      await client.query(`UPDATE signal_taxonomy_profiles SET status='retired',updated_at=now()
        WHERE id=$1::uuid`, [prior.id]);
      await client.query("UPDATE taxonomies SET status='retired' WHERE id=$1::uuid", [prior.taxonomy_id]);
    }
    const inserted = await insertTopicCatalogDraft(client, args.workspace_id, definitions,
      contextHash, inherited);
    let reusedSearchExecutionId: string | null = null;
    if (!outcome.semantic_changed && prior) {
      reusedSearchExecutionId = await cloneReadySearchExecution(client, {
        workspace_id: args.workspace_id,
        actor_user_id: args.actor_user_id,
        prior_profile_id: prior.id,
        next_profile_id: inserted.profileId,
        next_taxonomy_id: inserted.taxonomyId,
        definition_digest: contextHash
      });
    }
    await client.query(`
      INSERT INTO signal_topic_catalog_operations(workspace_id,actor_user_id,action,idempotency_key,
        request_digest,result_profile_id,result_term_key,result_summary)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,$8::jsonb)
    `, [args.workspace_id, args.actor_user_id, operation.action, args.idempotency_key,
      operationDigest, inserted.profileId, outcome.term_key, JSON.stringify({
        semantic_changed: outcome.semantic_changed,
        prior_profile_status: prior?.status ?? null,
        prior_had_ready_search: priorHadReadySearch,
        reused_search_execution_id: reusedSearchExecutionId
      })]);
    await client.query("COMMIT");
    return { ...(await loadSignalTopicCatalogStoreV1({ queryable: args.pool,
      workspace_id: args.workspace_id })), term_key: outcome.term_key,
      semantic_changed: outcome.semantic_changed, reused_search_execution_id: reusedSearchExecutionId,
      prior_profile_status: prior?.status ?? null, prior_had_ready_search: priorHadReadySearch,
      replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function insertTopicCatalogDraft(client: PoolClient, workspaceId: string,
  definitions: SignalTopicDefinitionV1[], contextHash: string,
  inherited: SignalTopicInheritedContextStoreV1) {
  return insertSignalTaxonomyDraftCoreV1({
    client,
    workspace_id: workspaceId,
    kind: "topic",
    context_hash: contextHash,
    terms: definitions.map((topic) => ({
      term_key: topic.term_key,
      label: topic.label,
      definition: topic.definition,
      metadata: { contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1, topic },
      status: topic.lifecycle === "archived" ? "archived" : "candidate"
    })),
    rules: { contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
      topics: definitions.map(definitionSemanticPayload) },
    rule_set_metadata: { contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1, context_hash: contextHash },
    provider: "operator",
    model_version: "hybrid-v1",
    prompt_hash: sha256("signal-topic-catalog-no-provider-v1"),
    model_metadata: { contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
      classification_contract: "signal-topic-hybrid-classifier-v1" },
    profile_metadata: { contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
      catalog_definition_digest: contextHash,
      inherited_context_digest: inherited.context_digest,
      locale: inherited.locale },
    context_refs: inherited.context_refs
  });
}

async function cloneReadySearchExecution(client: PoolClient, args: {
  workspace_id: string; actor_user_id: string; prior_profile_id: string; next_profile_id: string;
  next_taxonomy_id: string; definition_digest: string;
}) {
  const source = (await client.query<{ id: string; study_corpus_id: string; population_digest: string;
    watermark_digest: string; identity_catalog_digest: string; denominator: number;
    embedding_model: string | null; result_summary: unknown }>(`
    SELECT id::text,study_corpus_id::text,population_digest,watermark_digest,
      identity_catalog_digest,denominator,embedding_model,result_summary
    FROM signal_topic_catalog_executions
    WHERE taxonomy_profile_id=$1::uuid AND intent='search' AND status='ready'
      AND input_contract='legacy-topic-catalog-v1'
      AND definition_digest=$2
      AND watermark_digest=signal_classification_watermark_digest_v1(workspace_id,study_corpus_id)
      AND result_summary->>'correction_digest'=
        signal_topic_membership_override_digest_v1(workspace_id,taxonomy_profile_id)
    ORDER BY completed_at DESC,id DESC LIMIT 1
  `, [args.prior_profile_id, args.definition_digest])).rows[0];
  if (!source) return null;
  await client.query("SELECT (prepare_signal_topic_catalog_profile_v1($1::uuid,$2::uuid)).id",
    [args.next_profile_id, args.actor_user_id]);
  const requestDigest = sha256(stableJson({ source_execution_id: source.id,
    next_profile_id: args.next_profile_id, definition_digest: args.definition_digest }));
  const next = (await client.query<{ id: string }>(`
    INSERT INTO signal_topic_catalog_executions(workspace_id,taxonomy_profile_id,study_corpus_id,
      actor_user_id,intent,idempotency_key,request_digest,status,progress,population_digest,
      watermark_digest,identity_catalog_digest,definition_digest,denominator,embedding_model,
      result_summary,started_at,completed_at)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'search',$5,$6,'ready',100,$7,$8,$9,$10,$11,$12,$13::jsonb,now(),now())
    RETURNING id::text
  `, [args.workspace_id, args.next_profile_id, source.study_corpus_id, args.actor_user_id,
    `topic-search-clone:${source.id}:${args.next_profile_id}`, requestDigest, source.population_digest,
    source.watermark_digest, source.identity_catalog_digest, args.definition_digest, source.denominator,
    source.embedding_model, JSON.stringify(source.result_summary ?? {})])).rows[0];
  if (!next) return null;
  await client.query(`
    INSERT INTO signal_topic_classification_items(execution_id,workspace_id,canonical_root_id,
      resolution_state,best_score,technical_error_code,item_digest)
    SELECT $1::uuid,workspace_id,canonical_root_id,resolution_state,best_score,technical_error_code,item_digest
    FROM signal_topic_classification_items WHERE execution_id=$2::uuid
  `, [next.id, source.id]);
  await client.query(`
    INSERT INTO signal_topic_classification_suggestions(execution_id,workspace_id,canonical_root_id,
      taxonomy_term_id,term_key,disposition,method,semantic_score,lexical_match,excluded_by_rule,
      negative_semantic_score,excluded_by_negative,evidence_digest,lineage_digest)
    SELECT $1::uuid,suggestion.workspace_id,suggestion.canonical_root_id,next_term.id,
      suggestion.term_key,suggestion.disposition,suggestion.method,suggestion.semantic_score,
      suggestion.lexical_match,suggestion.excluded_by_rule,suggestion.negative_semantic_score,
      suggestion.excluded_by_negative,suggestion.evidence_digest,suggestion.lineage_digest
    FROM signal_topic_classification_suggestions suggestion
    JOIN taxonomy_terms next_term ON next_term.taxonomy_id=$3::uuid
      AND next_term.term_key=suggestion.term_key
    WHERE suggestion.execution_id=$2::uuid
  `, [next.id, source.id, args.next_taxonomy_id]);
  return next.id;
}

async function resolveTopicPopulation(client: Queryable, workspaceId: string, profileId: string) {
  const corpus = (await client.query<{ id: string }>(`
    SELECT membership.study_corpus_id::text id FROM signal_workspace_corpora membership
    WHERE membership.workspace_id=$1::uuid AND membership.role='operational' AND membership.valid_to IS NULL
    ORDER BY membership.valid_from DESC LIMIT 1
  `, [workspaceId])).rows[0];
  if (!corpus) throw new SignalTopicCatalogError("topic_population_not_available", 409);
  const watermark = (await client.query<{ digest: string | null }>(`
    SELECT signal_classification_watermark_digest_v1($1::uuid,$2::uuid) digest
  `, [workspaceId, corpus.id])).rows[0]?.digest;
  if (!watermark) throw new SignalTopicCatalogError("topic_population_watermark_missing", 409);
  const roots = (await client.query<{ id: string; scopes: string[]; text_clean: string }>(`
    WITH topic_scopes AS(
      SELECT DISTINCT COALESCE(term.metadata->'topic'->>'scope','primary_brand') scope
      FROM signal_taxonomy_profiles profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
      WHERE profile.id=$2::uuid AND term.status<>'archived'
    ), eligible AS(
      SELECT membership.mention_id id,'primary_brand'::text scope
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_memberships membership ON membership.population_id=pointer.population_id
        AND membership.workspace_id=pointer.workspace_id
      WHERE pointer.workspace_id=$1::uuid AND pointer.purpose='operational'
        AND membership.membership_status='included' AND membership.removed_at IS NULL
        AND EXISTS(SELECT 1 FROM topic_scopes WHERE scope='primary_brand')
      UNION
      SELECT attribution.mention_id,attribution.scope
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id=$1::uuid AND attribution.is_current=true
        AND attribution.review_status='approved' AND attribution.eligibility_status='eligible'
        AND attribution.scope IN(SELECT scope FROM topic_scopes WHERE scope IN('competitor','category'))
    ) SELECT mention.id::text id,mention.text_clean,
      array_agg(DISTINCT eligible.scope ORDER BY eligible.scope) scopes FROM eligible
      JOIN mentions mention ON mention.id=eligible.id AND mention.workspace_id=$1::uuid
        AND mention.study_corpus_id=$3::uuid AND mention.canonical_mention_id=mention.id
    GROUP BY mention.id ORDER BY mention.id
  `, [workspaceId, profileId, corpus.id])).rows;
  const ids = roots.map((row) => row.id);
  const identityDigest = sha256(ids.join("|"));
  return { study_corpus_id: corpus.id, denominator: ids.length,
    identity_catalog_digest: identityDigest, watermark_digest: watermark,
    population_digest: sha256(stableJson({ workspace_id: workspaceId,
      study_corpus_id: corpus.id, roots: roots.map((row) => ({ id: row.id, scopes: row.scopes })) })),
    roots };
}

async function loadLatestProfile(queryable: Queryable, workspaceId: string): Promise<CatalogProfileRow | null> {
  return (await queryable.query<CatalogProfileRow>(`
    SELECT id::text,taxonomy_id::text,version,status,context_hash,created_at::text,updated_at::text
    FROM signal_taxonomy_profiles WHERE workspace_id=$1::uuid AND kind='topic'
      AND status IN('draft','activating','active')
      AND metadata->>'contract_version'='signal-topic-catalog-v1'
    ORDER BY version DESC LIMIT 1
  `, [workspaceId])).rows[0] ?? null;
}

async function loadProfileTerms(queryable: Queryable, profileId: string) {
  return (await queryable.query<CatalogTermRow>(`
    SELECT term.id::text,term.term_key,term.label,COALESCE(term.description,'') description,
      term.metadata,term.status FROM signal_taxonomy_profiles profile
    JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
    WHERE profile.id=$1::uuid ORDER BY term.sort_order,term.term_key
  `, [profileId])).rows;
}

async function loadLatestExecution(queryable: Queryable, profileId: string): Promise<SignalTopicCatalogExecutionStoreV1 | null> {
  const row = (await queryable.query<SignalTopicCatalogExecutionStoreV1>(`
    SELECT id::text,intent,status,progress,denominator,embedding_model,
      publish_when_ready,
      embedding_cost_estimate_micro_usd,embedding_cost_cap_micro_usd,embedding_pricing_version,
      error_code,result_summary,
      created_at::text,updated_at::text FROM signal_topic_catalog_executions
    WHERE taxonomy_profile_id=$1::uuid AND input_contract='legacy-topic-catalog-v1' ORDER BY created_at DESC,id DESC LIMIT 1
  `, [profileId])).rows[0];
  return row ? { ...row, denominator: Number(row.denominator), progress: Number(row.progress),
    embedding_cost_estimate_micro_usd: row.embedding_cost_estimate_micro_usd === null ? null
      : Number(row.embedding_cost_estimate_micro_usd),
    embedding_cost_cap_micro_usd: row.embedding_cost_cap_micro_usd === null ? null
      : Number(row.embedding_cost_cap_micro_usd) } : null;
}

async function loadExecutionById(queryable: Queryable, executionId: string) {
  const row = (await queryable.query<SignalTopicCatalogExecutionStoreV1>(`
    SELECT id::text,intent,status,progress,denominator,embedding_model,
      publish_when_ready,
      embedding_cost_estimate_micro_usd,embedding_cost_cap_micro_usd,embedding_pricing_version,
      error_code,result_summary,
      created_at::text,updated_at::text FROM signal_topic_catalog_executions
    WHERE id=$1::uuid AND input_contract='legacy-topic-catalog-v1'
  `, [executionId])).rows[0];
  if (!row) throw new SignalTopicCatalogError("topic_execution_not_found", 404);
  return { ...row, denominator: Number(row.denominator), progress: Number(row.progress),
    embedding_cost_estimate_micro_usd: row.embedding_cost_estimate_micro_usd === null ? null
      : Number(row.embedding_cost_estimate_micro_usd),
    embedding_cost_cap_micro_usd: row.embedding_cost_cap_micro_usd === null ? null
      : Number(row.embedding_cost_cap_micro_usd) };
}

async function loadLatestCounts(queryable: Queryable, profileId: string) {
  const rows = (await queryable.query<{ term_key: string; relevant: number; doubt: number; excluded: number }>(`
    WITH latest AS(SELECT id FROM signal_topic_catalog_executions
      WHERE taxonomy_profile_id=$1::uuid AND intent='search' AND status='ready' AND input_contract='legacy-topic-catalog-v1'
      ORDER BY completed_at DESC,id DESC LIMIT 1)
    SELECT suggestion.term_key,
      count(*) FILTER(WHERE CASE override.disposition WHEN 'belongs' THEN 'relevant'
        WHEN 'excluded' THEN 'excluded' ELSE suggestion.disposition END='relevant')::int relevant,
      count(*) FILTER(WHERE CASE override.disposition WHEN 'belongs' THEN 'relevant'
        WHEN 'excluded' THEN 'excluded' ELSE suggestion.disposition END='doubt')::int doubt,
      count(*) FILTER(WHERE CASE override.disposition WHEN 'belongs' THEN 'relevant'
        WHEN 'excluded' THEN 'excluded' ELSE suggestion.disposition END='excluded')::int excluded
    FROM signal_topic_classification_suggestions suggestion JOIN latest ON latest.id=suggestion.execution_id
    JOIN taxonomy_terms term ON term.id=suggestion.taxonomy_term_id
    LEFT JOIN signal_topic_membership_overrides override ON override.workspace_id=suggestion.workspace_id
      AND override.term_key=suggestion.term_key AND override.canonical_root_id=suggestion.canonical_root_id
      AND override.definition_revision=(term.metadata->'topic'->>'definition_revision')::int
    GROUP BY suggestion.term_key
  `, [profileId])).rows;
  return new Map(rows.map((row) => [row.term_key,
    { relevant: Number(row.relevant), doubt: Number(row.doubt), excluded: Number(row.excluded) }]));
}

async function loadLatestReadySearch(queryable: Queryable, workspaceId: string, profileId: string) {
  const source = (await queryable.query<{ id: string; study_corpus_id: string; population_digest: string;
    watermark_digest: string; identity_catalog_digest: string; definition_digest: string; denominator: number;
    correction_is_current: boolean; published: boolean }>(`
    SELECT id::text,study_corpus_id::text,population_digest,watermark_digest,
      identity_catalog_digest,definition_digest,denominator,
      result_summary->>'correction_digest'=
        signal_topic_membership_override_digest_v1(workspace_id,taxonomy_profile_id) correction_is_current,
      EXISTS(SELECT 1 FROM signal_topic_catalog_executions publication
        WHERE publication.source_execution_id=signal_topic_catalog_executions.id
          AND publication.intent='publish' AND publication.status='completed') published
    FROM signal_topic_catalog_executions
    WHERE taxonomy_profile_id=$1::uuid AND intent='search' AND status='ready' AND input_contract='legacy-topic-catalog-v1'
    ORDER BY completed_at DESC,id DESC LIMIT 1
  `, [profileId])).rows[0];
  if (!source) return { id: null, is_current: false, published: false };
  try {
    const [population, context] = await Promise.all([
      resolveTopicPopulation(queryable, workspaceId, profileId),
      loadSignalTopicClassificationContextStoreV1({ queryable, workspace_id: workspaceId,
        taxonomy_profile_id: profileId })
    ]);
    return { id: source.id, published: source.published, is_current: source.correction_is_current
      && source.study_corpus_id === population.study_corpus_id
      && source.population_digest === population.population_digest
      && source.watermark_digest === population.watermark_digest
      && source.identity_catalog_digest === population.identity_catalog_digest
      && source.definition_digest === context.definition_digest
      && Number(source.denominator) === population.denominator };
  } catch {
    return { id: source.id, is_current: false, published: source.published };
  }
}

async function findTopicBySource(queryable: Queryable, workspaceId: string, runKey: string, candidateKey: string) {
  return (await queryable.query<{ term_key: string }>(`
    SELECT term.term_key FROM signal_taxonomy_profiles profile
    JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
    WHERE profile.workspace_id=$1::uuid AND profile.kind='topic'
      AND term.metadata->'topic'->'source'->>'run_key'=$2
      AND term.metadata->'topic'->'source'->>'candidate_key'=$3
    ORDER BY profile.version DESC LIMIT 1
  `, [workspaceId, runKey, candidateKey])).rows[0]?.term_key ?? null;
}

async function assertActor(queryable: Queryable, workspaceId: string, actorUserId: string,
  capability: "can_edit_topics" | "can_execute_topics" | "can_adopt_topics" = "can_edit_topics") {
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable,
    workspace_id: workspaceId, actor_user_id: actorUserId });
  if (!capabilities[capability]) throw new SignalTopicCatalogError("topic_catalog_forbidden", 403);
}

function readDefinition(term: CatalogTermRow): SignalTopicDefinitionV1 {
  const record = objectValue(term.metadata);
  const stored = objectValue(record.topic);
  return signalTopicDefinitionSchemaV1.parse({
    ...stored,
    term_key: term.term_key,
    label: term.label,
    definition: term.description,
    lifecycle: term.status === "archived" ? "archived" : stored.lifecycle ?? "draft"
  });
}

function topicStatus(profile: CatalogProfileRow, term: CatalogTermRow,
  execution: SignalTopicCatalogExecutionStoreV1 | null, activeProfileId: string | null,
  searchIsCurrent: boolean, searchPublished = false) {
  if (term.status === "archived") {
    const replacementPending = activeProfileId !== null && activeProfileId !== profile.id;
    if (replacementPending && (!execution || execution.status === "failed")) return "failed" as const;
    if (replacementPending && execution && ["queued", "running"].includes(execution.status)) {
      return "updating" as const;
    }
    return "archived" as const;
  }
  if (execution?.status === "failed") return "failed" as const;
  if (execution?.intent === "search" && ["queued", "running"].includes(execution.status)) {
    return activeProfileId ? "updating" as const : "searching" as const;
  }
  if (execution?.intent === "publish" && ["queued", "running"].includes(execution.status)) return "updating" as const;
  if (activeProfileId === profile.id && execution?.intent === "publish" && execution.status === "completed") return "in_signal" as const;
  if (execution?.intent === "search" && execution.status === "ready" && searchIsCurrent && !searchPublished) return "ready" as const;
  if (profile.status === "active" && activeProfileId === profile.id) return "in_signal" as const;
  return "draft" as const;
}

function definitionSemanticPayload(topic: SignalTopicDefinitionV1) {
  return { term_key: topic.term_key, definition_digest: topic.definition_digest,
    definition_revision: topic.definition_revision, lifecycle: topic.lifecycle };
}
function classificationDefinitionDigest(definitions: SignalTopicDefinitionV1[], inheritedContextDigest: string) {
  return sha256(stableJson({ definitions: definitions.map(definitionSemanticPayload),
    inherited_context_digest: inheritedContextDigest }));
}
function uniqueSignalTopicTermKey(label: string, definitions: SignalTopicDefinitionV1[]) {
  const base = signalTopicTermKeyV1(label);
  const used = new Set(definitions.map((item) => item.term_key));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = `_${suffix}`;
    const prefix = base.slice(0, 80 - suffixText.length).replace(/_+$/gu, "");
    const candidate = `${prefix}${suffixText}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new SignalTopicCatalogError("topic_catalog_limit_exceeded", 409);
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
