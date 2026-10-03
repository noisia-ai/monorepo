import { createHash } from "node:crypto";

import {
  SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
  SignalBackendContractError,
  buildSignalMentionReadPredicateV1,
  buildSignalPopulationMentionReadPredicateV1,
  decodeSignalDrillDownCursorV1,
  encodeSignalDrillDownCursorV1,
  normalizeSignalFilterV1,
  normalizeSignalMetricQueryV1,
  signalFiltersHashV1,
  signalServingScopeCursorIsolationHashV1,
  signalServingScopeEtagSeedV1,
  signalTaxonomyCoverageV1,
  splitSignalMaterializationDateRangeV1,
  type SignalEvidenceSentimentDominantV1,
  type SignalFilterV1,
  type SignalTaxonomyCooccurrenceV1,
  type SignalTaxonomyEvidencePageV1,
  type SignalTaxonomyKindV1,
  type SignalTaxonomyLineageV1,
  type SignalTaxonomyOverviewSectionV1,
  type SignalTaxonomyServingProfileV1,
  type SignalTaxonomyServingStateV1,
  type SignalTaxonomyTermDetailV1,
  type SignalTaxonomyTermMetricV1,
  type SignalServingScopeDescriptorV1,
  type SignalTopicsNarrativesOverviewV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import {
  buildSignalOperationalMentionReadPredicateV1,
  requireSignalOperationalReadScopeV1,
  resolveSignalOperationalReadScopeV1,
  type SignalOperationalReadScopeV1
} from "@/lib/data-os/signal-operational-read-scope";
import {
  type SignalClientEvidenceAccessV1,
  loadSignalServingMaterializationRowsV1,
  type SignalServingMaterializationRowV1,
  type SignalServingQueryable
} from "@/lib/data-os/signal-workspace-serving";

type JsonRecord = Record<string, unknown>;

type MaterializationRow = {
  materialization_key: string;
  metric_key: "topic.volume" | "narrative.volume";
  period_start: string;
  period_end: string;
  typed_payload: JsonRecord;
  state: SignalTaxonomyServingStateV1;
  data_watermark_hash: string;
  computed_at: Date;
};

type ProfileRow = {
  profile_id: string;
  taxonomy_id: string;
  rule_set_id: string;
  model_version_id: string;
  kind: SignalTaxonomyKindV1;
  version: number;
  context_hash: string;
  activated_at: Date | null;
  term_count: number;
};

type Snapshot = SignalTaxonomyOverviewSectionV1 & {
  byTerm: Map<string, SignalTaxonomyTermMetricV1>;
  termSeries: Map<string, SignalTaxonomyOverviewSectionV1["series"]>;
};

type TermOverviewSignals = Record<
  SignalTaxonomyKindV1,
  Map<string, {
    engagement_total: number;
    dominant_sentiment: SignalEvidenceSentimentDominantV1;
  }>
>;

const TERM_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

export function signalTaxonomyKindV1(input: string): SignalTaxonomyKindV1 {
  if (input !== "topic" && input !== "narrative") {
    throw new SignalBackendContractError(
      "invalid_filter",
      "kind must be topic or narrative.",
      { field: "kind" }
    );
  }
  return input;
}

export function signalTaxonomyTermKeyV1(input: string) {
  const value = input.normalize("NFC").trim().toLocaleLowerCase("en-US");
  if (!TERM_KEY_PATTERN.test(value)) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "termKey must be a canonical taxonomy term key.",
      { field: "termKey" }
    );
  }
  return value;
}

export function signalTaxonomyComparisonRangeV1(searchParams: URLSearchParams) {
  const start = searchParams.get("comparison_start")?.trim();
  const end = searchParams.get("comparison_end")?.trim();
  if (!start && !end) return null;
  if (!start || !end) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "comparison_start and comparison_end must be provided together.",
      { field: "comparison_date_range" }
    );
  }
  return { start, end };
}

export function aggregateSignalTaxonomyServingFixtureV1(args: {
  kind: SignalTaxonomyKindV1;
  current: Array<{
    period_start: string;
    period_end: string;
    typed_payload: JsonRecord;
    state: SignalTaxonomyServingStateV1;
  }>;
  comparison?: Array<{
    period_start: string;
    period_end: string;
    typed_payload: JsonRecord;
    state: SignalTaxonomyServingStateV1;
  }>;
}) {
  const rows = (values: typeof args.current): MaterializationRow[] =>
    values.map((row, index) => ({
      ...row,
      materialization_key: `fixture:${index}`,
      metric_key: metricKey(args.kind),
      data_watermark_hash: "sha256:fixture",
      computed_at: new Date("2026-01-01T00:00:00.000Z")
    }));
  const current = snapshotForKind(rows(args.current), args.kind, true);
  const comparison = args.comparison
    ? snapshotForKind(rows(args.comparison), args.kind, true)
    : null;
  return withoutIndex(withComparison(current, comparison));
}

export async function loadSignalTopicsNarrativesOverviewV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  comparisonRange?: { start: string; end: string } | null;
  isInternalUser: boolean;
}): Promise<SignalTopicsNarrativesOverviewV1> {
  return (await loadSignalTopicsNarrativesSnapshotV1(args)).overview;
}

export async function loadSignalTopicsNarrativesModuleShadowV1(args: {
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  queryable?: SignalServingQueryable;
}) {
  const corpus = (await resolveSignalOperationalReadScopeV1(args.workspace, {
    mode: "legacy",
    queryable: args.queryable
  })).legacyCorpus!;
  const legacy = await loadTopicsNarrativesShadowScope(
    args.workspace.id,
    buildSignalMentionReadPredicateV1(
      args.filter,
      [corpus.id],
      args.workspace.id
    ),
    args.queryable
  );
  const governed = await loadSignalTopicsNarrativesGovernedModuleProofV1(args);
  const reconciled = legacy.canonical_ids_hash === governed.canonical_ids_hash
    && legacy.row_denominator === governed.row_denominator
    && legacy.canonical_denominator === governed.canonical_denominator
    && legacy.period_start === governed.period_start
    && legacy.period_end === governed.period_end
    && legacy.topic_result_count === governed.topic_result_count
    && legacy.topic_results_hash === governed.topic_results_hash
    && legacy.narrative_result_count === governed.narrative_result_count
    && legacy.narrative_results_hash === governed.narrative_results_hash;
  return {
    reader: "loadSignalTopicsNarrativesOverviewV1:approved-assignment-adapter",
    legacy,
    governed,
    reconciled,
    state: reconciled ? "exact" as const : "diverged" as const
  };
}

/**
 * Executes only the population-owned Topics & Narratives reader proof. This is
 * the governed-view rehearsal boundary and never resolves a legacy corpus.
 */
export async function loadSignalTopicsNarrativesGovernedModuleProofV1(args: {
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  queryable?: SignalServingQueryable;
}) {
  return loadTopicsNarrativesShadowScope(
    args.workspace.id,
    buildSignalPopulationMentionReadPredicateV1(
      args.filter,
      args.populationId,
      args.workspace.id
    ),
    args.queryable
  );
}

async function loadTopicsNarrativesShadowScope(
  workspaceId: string,
  predicate: ReturnType<typeof buildSignalMentionReadPredicateV1>,
  queryable?: SignalServingQueryable
) {
  const params = [
    ...predicate.params,
    workspaceId,
    predicate.normalized_filter.timezone
  ];
  const workspaceParameter = `$${params.length - 1}`;
  const timezoneParameter = `$${params.length}`;
  const result = await (queryable ?? pool).query<{
    row_denominator: number;
    canonical_denominator: number;
    period_start: string | null;
    period_end: string | null;
    canonical_ids_hash: string;
    topic_result_count: number;
    topic_results_hash: string;
    narrative_result_count: number;
    narrative_results_hash: string;
    resolved_alias_assignment_count: number;
  }>(`
    WITH scoped AS (
      SELECT
        m.id,
        COALESCE(m.canonical_mention_id, m.id) AS canonical_id,
        (m.published_at AT TIME ZONE ${timezoneParameter})::date AS local_date
      FROM mentions m
      WHERE ${predicate.sql}
    ), canonical AS (
      SELECT DISTINCT canonical_id FROM scoped
    ), approved_assignment_links AS (
      SELECT
        scoped.canonical_id,
        profile.kind,
        term.term_key,
        tagged_mention.id <> scoped.canonical_id AS resolved_from_alias
      FROM scoped
      JOIN record_tags tag
        ON tag.subject_type = 'mention'
       AND tag.review_status = 'approved'
      JOIN mentions tagged_mention
        ON tagged_mention.id = tag.subject_id
       AND tagged_mention.canonical_mention_id = scoped.canonical_id
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
       AND profile.model_version_id = tag.model_version_id
       AND profile.workspace_id = ${workspaceParameter}::uuid
       AND profile.status = 'active'
      JOIN taxonomy_terms term
        ON term.id = tag.taxonomy_term_id
       AND term.taxonomy_id = profile.taxonomy_id
       AND term.status = 'active'
    ), approved_results AS (
      SELECT canonical_id, kind, term_key,
        bool_or(resolved_from_alias) AS resolved_from_alias
      FROM approved_assignment_links
      GROUP BY canonical_id, kind, term_key
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS row_denominator,
      (SELECT count(*)::int FROM canonical) AS canonical_denominator,
      (SELECT min(local_date)::text FROM scoped) AS period_start,
      (SELECT max(local_date)::text FROM scoped) AS period_end,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(canonical_id::text, ',' ORDER BY canonical_id::text)
        FROM canonical
      ), ''), 'UTF8')), 'hex') AS canonical_ids_hash,
      (SELECT count(*)::int FROM approved_results WHERE kind = 'topic')
        AS topic_result_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(canonical_id::text || ':' || term_key, ','
          ORDER BY canonical_id::text, term_key)
        FROM approved_results WHERE kind = 'topic'
      ), ''), 'UTF8')), 'hex') AS topic_results_hash,
      (SELECT count(*)::int FROM approved_results WHERE kind = 'narrative')
        AS narrative_result_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(canonical_id::text || ':' || term_key, ','
          ORDER BY canonical_id::text, term_key)
        FROM approved_results WHERE kind = 'narrative'
      ), ''), 'UTF8')), 'hex') AS narrative_results_hash,
      (SELECT count(*)::int FROM approved_results WHERE resolved_from_alias)
        AS resolved_alias_assignment_count
  `, params);
  return result.rows[0] ?? {
    row_denominator: 0,
    canonical_denominator: 0,
    period_start: null,
    period_end: null,
    canonical_ids_hash: "",
    topic_result_count: 0,
    topic_results_hash: "",
    narrative_result_count: 0,
    narrative_results_hash: "",
    resolved_alias_assignment_count: 0
  };
}

async function loadSignalTopicsNarrativesSnapshotV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  comparisonRange?: { start: string; end: string } | null;
  isInternalUser: boolean;
}) {
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  assertClientSafeFilter(args.filter, args.isInternalUser);
  const currentPredicate = buildSignalOperationalMentionReadPredicateV1(readScope, args.filter);
  const comparisonFilter = args.comparisonRange
    ? comparisonFilterV1(args.workspace, args.filter, args.comparisonRange)
    : null;
  const comparisonPredicate = comparisonFilter
    ? buildSignalOperationalMentionReadPredicateV1(readScope, comparisonFilter)
    : null;
  // Term detail reuses this snapshot. Keep the remote Postgres reads
  // sequential so the Studio pool is not exhausted by one interaction.
  const profiles = await loadActiveProfiles(args.workspace.id);
  const currentRows = await loadTaxonomyMaterializationRows(
    args.workspace,
    args.filter,
    readScope
  );
  const termSignals = await loadTermOverviewSignals(
    args.workspace.id,
    currentPredicate,
    readScope
  );
  const comparisonRows = comparisonFilter
    ? await loadTaxonomyMaterializationRows(args.workspace, comparisonFilter, readScope)
    : [];
  const profileKinds = new Set(profiles.map((profile) => profile.kind));
  const currentCoverageRows = needsCoverageFallback(currentRows, profileKinds)
    ? await loadOperationalCoverageRows(args.workspace, args.filter, readScope)
    : [];
  const comparisonCoverageRows = comparisonFilter
    && needsCoverageFallback(comparisonRows, profileKinds)
    ? await loadOperationalCoverageRows(args.workspace, comparisonFilter, readScope)
    : [];
  const currentTopics = withOverviewSignals(
    snapshotForKind(currentRows, "topic", profileKinds.has("topic"), currentCoverageRows),
    termSignals.topic
  );
  const currentNarratives = withOverviewSignals(
    snapshotForKind(currentRows, "narrative", profileKinds.has("narrative"), currentCoverageRows),
    termSignals.narrative
  );
  const comparisonTopics = comparisonFilter
    ? snapshotForKind(comparisonRows, "topic", profileKinds.has("topic"), comparisonCoverageRows)
    : null;
  const comparisonNarratives = comparisonFilter
    ? snapshotForKind(comparisonRows, "narrative", profileKinds.has("narrative"), comparisonCoverageRows)
    : null;
  const topics = withComparison(currentTopics, comparisonTopics);
  const narratives = withComparison(currentNarratives, comparisonNarratives);
  const limitations = Array.from(new Set([
    ...topics.coverage.limitations,
    ...narratives.coverage.limitations,
    ...(profileKinds.has("topic") ? [] : ["active_topic_profile_not_available"]),
    ...(profileKinds.has("narrative") ? [] : ["active_narrative_profile_not_available"]),
    ...(comparisonFilter && comparisonRows.length === 0
      ? ["comparison_materialization_not_available"]
      : []),
    ...(topics.state === "stale" ? ["topic_materialization_stale"] : []),
    ...(narratives.state === "stale"
      ? ["narrative_materialization_stale"]
      : [])
  ])).sort();

  return {
    overview: {
      contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
      workspace_id: args.workspace.id,
      read_scope: readScope.descriptor,
      corpus_id: readScope.legacyCorpus?.id ?? null,
      filters_hash: currentPredicate.filters_hash,
      comparison_filters_hash: comparisonPredicate?.filters_hash ?? null,
      profiles: profiles.map((profile) =>
        publicProfile(profile, args.isInternalUser)
      ),
      topics: withoutIndex(topics),
      narratives: withoutIndex(narratives),
      state: worstState([topics.state, narratives.state]),
      limitations,
      visibility: {
        internal: args.isInternalUser,
        classification_details: args.isInternalUser
      }
    } satisfies SignalTopicsNarrativesOverviewV1,
    currentRows
  };
}

export async function loadSignalTaxonomyTermDetailV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  comparisonRange?: { start: string; end: string } | null;
  kind: SignalTaxonomyKindV1;
  termKey: string;
  isInternalUser: boolean;
}): Promise<SignalTaxonomyTermDetailV1> {
  const termKey = signalTaxonomyTermKeyV1(args.termKey);
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  const snapshot = await loadSignalTopicsNarrativesSnapshotV1(args);
  const overview = snapshot.overview;
  // Keep remote Postgres reads sequential here. A single term interaction can
  // already trigger detail, evidence, and lineage requests from the client;
  // parallel reads inside detail unnecessarily contend for the small runtime
  // pool and can turn an otherwise valid term into a transient 503.
  const termDefinition = await loadActiveTerm(args.workspace.id, args.kind, termKey);
  if (!termDefinition) {
    throw new SignalBackendContractError(
      "not_available",
      "The requested term is not active in this workspace profile.",
      { kind: args.kind, term_key: termKey }
    );
  }
  const sentiment = await loadTermSentimentSummary(
    args.workspace,
    readScope,
    args.filter,
    args.kind,
    termKey
  );
  const section = args.kind === "topic" ? overview.topics : overview.narratives;
  const termSnapshot = snapshotForKind(snapshot.currentRows, args.kind, true);
  const term = section.terms.find((item) => item.term_key === termKey)
    ?? zeroTerm(termDefinition, section);
  const related = section.cooccurrences
    .filter((item) =>
      item.left_term_key === termKey || item.right_term_key === termKey
    )
    .map((item) => ({
      term_key: item.left_term_key === termKey
        ? item.right_term_key
        : item.left_term_key,
      mention_count: item.mention_count,
      meaning: item.meaning
    }))
    .sort((left, right) =>
      right.mention_count - left.mention_count
      || left.term_key.localeCompare(right.term_key)
    );
  const basePath = `/api/data-os/signal/${args.workspace.id}/topics-narratives/${args.kind}/${termKey}`;

  return {
    contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
      workspace_id: args.workspace.id,
      read_scope: overview.read_scope,
      corpus_id: overview.corpus_id,
    filters_hash: signalFiltersHashV1(args.filter),
    kind: args.kind,
    metric_key: metricKey(args.kind),
    term: {
      ...term,
      definition: termDefinition.definition,
      statement: termDefinition.statement
    },
    series: termSnapshot.termSeries.get(termKey)
      ?? section.series.map((point) => ({
        ...point,
        mention_count: 0,
        share_of_included: point.denominator > 0 ? 0 : null
      })),
    related_terms: related,
    sentiment,
    coverage: section.coverage,
    state: section.state,
    limitations: section.coverage.limitations,
    links: {
      evidence: `${basePath}/evidence`,
      lineage: `${basePath}/lineage`
    }
  };
}

export function signalTaxonomyEvidenceServingTokensV1(args: {
  servingScope: SignalServingScopeDescriptorV1;
  evidenceServingScope: SignalServingScopeDescriptorV1 | null;
  filter: SignalFilterV1;
  kind: SignalTaxonomyKindV1;
  termKey: string;
}) {
  const termKey = signalTaxonomyTermKeyV1(args.termKey);
  const filter = filterForTerm(args.filter, args.kind, termKey);
  const normalizedFiltersHash = signalFiltersHashV1(filter);
  const normalizedSortHash = sha256Value(JSON.stringify([
    "occurred_at",
    "desc",
    "subject_id",
    "desc",
    args.kind,
    termKey
  ]));
  const moduleCursor = signalServingScopeCursorIsolationHashV1({
    scope: args.servingScope,
    normalized_filters_hash: normalizedFiltersHash,
    normalized_sort_hash: normalizedSortHash
  });
  const evidenceCursor = args.evidenceServingScope
    ? signalServingScopeCursorIsolationHashV1({
        scope: args.evidenceServingScope,
        normalized_filters_hash: normalizedFiltersHash,
        normalized_sort_hash: normalizedSortHash
      })
    : sha256Value("mentions-capability-not-available:cursor");
  const moduleEtag = signalServingScopeEtagSeedV1({
    scope: args.servingScope,
    normalized_filters_hash: normalizedFiltersHash,
    normalized_sort_hash: normalizedSortHash
  });
  const evidenceEtag = args.evidenceServingScope
    ? signalServingScopeEtagSeedV1({
        scope: args.evidenceServingScope,
        normalized_filters_hash: normalizedFiltersHash,
        normalized_sort_hash: normalizedSortHash
      })
    : sha256Value("mentions-capability-not-available:etag");
  return {
    normalized_filters_hash: normalizedFiltersHash,
    normalized_sort_hash: normalizedSortHash,
    cursor_isolation_hash: sha256Value(`${moduleCursor}:${evidenceCursor}`),
    etag_seed: sha256Value(`${moduleEtag}:${evidenceEtag}`)
  };
}

export async function loadSignalTaxonomyEvidenceV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  evidenceReadScope?: SignalOperationalReadScopeV1 | null;
  servingScope?: SignalServingScopeDescriptorV1;
  evidenceServingScope?: SignalServingScopeDescriptorV1 | null;
  filter: SignalFilterV1;
  kind: SignalTaxonomyKindV1;
  termKey: string;
  cursor?: string | null;
  limit?: number;
  isInternalUser: boolean;
  queryable?: SignalServingQueryable;
}): Promise<SignalTaxonomyEvidencePageV1> {
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  const evidenceAccessRequested = Object.prototype.hasOwnProperty.call(
    args,
    "evidenceReadScope"
  );
  const evidenceReadScope = args.evidenceReadScope == null
    ? null
    : requireSignalOperationalReadScopeV1(args.workspace, args.evidenceReadScope);
  assertClientSafeFilter(args.filter, args.isInternalUser);
  const termKey = signalTaxonomyTermKeyV1(args.termKey);
  const filter = filterForTerm(args.filter, args.kind, termKey);
  if (args.servingScope) {
    if (args.servingScope.workspace_id !== args.workspace.id
      || args.servingScope.module_key !== "topics-narratives"
      || readScope.visibleSource !== "governed_population"
      || readScope.population?.id !== args.servingScope.population.population_id) {
      throw new SignalBackendContractError(
        "not_available",
        "Topics & Narratives serving scope and governed population do not match.",
        { reason: "taxonomy_serving_population_mismatch" }
      );
    }
    const hasEvidenceScope = evidenceReadScope != null
      || args.evidenceServingScope != null;
    if (!evidenceAccessRequested
      || (hasEvidenceScope && (!evidenceReadScope
        || !args.evidenceServingScope
        || args.evidenceServingScope.workspace_id !== args.workspace.id
        || args.evidenceServingScope.module_key !== "mentions"
        || evidenceReadScope.visibleSource !== "governed_population"
        || evidenceReadScope.population?.id
          !== args.evidenceServingScope.population.population_id))) {
      throw new SignalBackendContractError(
        "not_available",
        "Governed taxonomy evidence requires the exact Mentions capability scope.",
        { reason: "taxonomy_evidence_capability_scope_not_available" }
      );
    }
  }
  const servingTokens = args.servingScope
    ? signalTaxonomyEvidenceServingTokensV1({
        servingScope: args.servingScope,
        evidenceServingScope: args.evidenceServingScope ?? null,
        filter: args.filter,
        kind: args.kind,
        termKey
      })
    : null;
  const filtersHash = servingTokens?.cursor_isolation_hash
    ?? signalFiltersHashV1(filter);
  const metric = metricKey(args.kind);
  const decoded = args.cursor ? decodeSignalDrillDownCursorV1(args.cursor) : null;
  if (decoded && (
    decoded.metric_key !== metric
    || decoded.filters_hash !== filtersHash
  )) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "Evidence cursor does not match the active term/filter.",
      { field: "cursor" }
    );
  }
  const predicate = buildSignalOperationalMentionReadPredicateV1(readScope, filter);
  const metricPredicate = evidenceAccessRequested
    ? buildSignalOperationalMentionReadPredicateV1(readScope, args.filter)
    : null;
  const metricPredicateSql = metricPredicate
    ? rebasePredicateSql(metricPredicate.sql, predicate.params.length)
    : null;
  const params = [
    ...predicate.params,
    ...(metricPredicate?.params ?? []),
    args.workspace.id,
    args.kind,
    termKey
  ];
  const workspaceParameter = `$${params.length - 2}::uuid`;
  const kindParameter = `$${params.length - 1}`;
  const termParameter = `$${params.length}`;
  const taggedMentionJoin = readScope.visibleSource === "legacy_corpus"
    ? "tagged_mention.id = m.id"
    : `tagged_mention.workspace_id = m.workspace_id
       AND tagged_mention.canonical_mention_id = m.canonical_mention_id`;
  const evidencePredicate = evidenceReadScope
    ? buildSignalOperationalMentionReadPredicateV1(
        evidenceReadScope,
        args.filter
      )
    : null;
  const evidencePredicateSql = evidencePredicate
    ? rebasePredicateSql(
        evidencePredicate.sql.replace(/\bm\./gu, "evidence_mention."),
        params.length
      )
    : null;
  if (evidencePredicate) params.push(...evidencePredicate.params);
  let cursorSql = "";
  if (decoded) {
    params.push(decoded.sort.occurred_at, decoded.sort.subject_id);
    cursorSql =
      `AND (occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  const limit = boundedLimit(args.limit);
  params.push(limit + 1);
  const result = await (args.queryable ?? pool).query<{
    mention_id: string | null;
    occurred_at: Date | null;
    text_snippet: string | null;
    title: string | null;
    url: string | null;
    platform: string | null;
    language: string | null;
    country: string | null;
    score: string | null;
    confidence: string | null;
    evidence: JsonRecord;
    model_version_id: string | null;
    profile_id: string | null;
    import_batch_id: string | null;
    total_count: number;
    metric_denominator_count: number;
    evidence_constituent_count: number;
  }>(`
    WITH metric_roots AS (
      ${metricPredicateSql
        ? `SELECT DISTINCT COALESCE(m.canonical_mention_id, m.id) AS mention_id
           FROM mentions m
           WHERE ${metricPredicateSql}`
        : "SELECT NULL::uuid AS mention_id WHERE false"}
    ), constituents AS (
      SELECT DISTINCT ON (m.id)
        m.id, m.published_at AS occurred_at,
        m.text_snippet, m.title, m.url,
        COALESCE(m.resolved_platform, m.platform) AS platform,
        m.language, m.country,
        tag.score::text, tag.confidence, tag.evidence,
        tag.model_version_id::text, profile.id::text AS profile_id,
        m.source_file_id::text AS import_batch_id
      FROM mentions m
      JOIN record_tags tag
        ON tag.subject_type = 'mention'
       AND tag.review_status = 'approved'
      JOIN mentions tagged_mention
        ON tagged_mention.id = tag.subject_id
       AND ${taggedMentionJoin}
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
       AND profile.model_version_id = tag.model_version_id
       AND profile.workspace_id = ${workspaceParameter}
       AND profile.kind = ${kindParameter}
       AND profile.status = 'active'
      JOIN taxonomy_terms term
        ON term.id = tag.taxonomy_term_id
       AND term.taxonomy_id = profile.taxonomy_id
       AND term.term_key = ${termParameter}
       AND term.status = 'active'
      WHERE ${predicate.sql}
      ORDER BY m.id, tag.approved_at DESC NULLS LAST, tag.created_at DESC, tag.id DESC
    ), visible AS (
      SELECT constituent.*
      FROM constituents constituent
      ${evidenceAccessRequested && evidencePredicateSql
        ? "JOIN mentions evidence_mention ON evidence_mention.id = constituent.id"
        : ""}
      WHERE ${evidenceAccessRequested
        ? evidencePredicateSql
          ? evidencePredicateSql
          : "false"
        : "true"}
    ), counts AS (
      SELECT
        (SELECT count(*)::int FROM metric_roots) AS metric_denominator_count,
        (SELECT count(*)::int FROM constituents) AS evidence_constituent_count,
        (SELECT count(*)::int FROM visible) AS total_count
    )
    SELECT page.id::text AS mention_id, page.occurred_at,
      page.text_snippet, page.title, page.url, page.platform,
      page.language, page.country, page.score, page.confidence,
      page.evidence, page.model_version_id, page.profile_id,
      page.import_batch_id, counts.total_count,
      counts.metric_denominator_count, counts.evidence_constituent_count
    FROM counts
    LEFT JOIN LATERAL (
      SELECT * FROM visible
      WHERE true ${cursorSql}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${params.length}::int
    ) page ON true
    ORDER BY page.occurred_at DESC NULLS LAST, page.id DESC NULLS LAST
  `, params);
  const visibleRows = result.rows.filter((row): row is typeof row & {
    mention_id: string;
    occurred_at: Date;
    profile_id: string;
  } => Boolean(row.mention_id && row.occurred_at && row.profile_id));
  const hasNext = visibleRows.length > limit;
  const records = visibleRows.slice(0, limit).map((row) => ({
    mention_id: row.mention_id,
    occurred_at: row.occurred_at.toISOString(),
    text_snippet: row.text_snippet,
    title: row.title,
    url: row.url,
    platform: row.platform,
    language: row.language,
    country: row.country,
    evidence_quotes: evidenceQuotes(row.evidence),
    ...(args.isInternalUser ? {
      classification: {
        score: row.score == null ? null : Number(row.score),
        confidence: row.confidence,
        model_version_id: row.model_version_id,
        profile_id: row.profile_id,
        import_batch_id: row.import_batch_id,
        context_refs: Array.isArray(row.evidence.context_refs)
          ? row.evidence.context_refs
          : []
      }
    } : {})
  }));
  const last = records.at(-1);
  const nextCursor = hasNext && last
    ? encodeSignalDrillDownCursorV1({
        contract_version: "signal-backend-v1",
        metric_key: metric,
        filters_hash: filtersHash,
        direction: "next",
        sort: {
          occurred_at: last.occurred_at,
          subject_id: last.mention_id
        }
      })
    : null;
  const metricDenominatorCount = Number(
    result.rows[0]?.metric_denominator_count ?? 0
  );
  const evidenceConstituentCount = Number(
    result.rows[0]?.evidence_constituent_count ?? 0
  );
  const evidenceVisibleCount = Number(result.rows[0]?.total_count ?? 0);
  const evidenceAccess: SignalClientEvidenceAccessV1 | undefined = evidenceAccessRequested
    ? evidenceReadScope
      ? {
          state: "available",
          metric_denominator_count: metricDenominatorCount,
          evidence_constituent_count: evidenceConstituentCount,
          evidence_visible_count: evidenceVisibleCount,
          evidence_withheld_count: Math.max(
            0,
            evidenceConstituentCount - evidenceVisibleCount
          ),
          reason: null
        }
      : {
          state: "not_available",
          metric_denominator_count: metricDenominatorCount,
          evidence_constituent_count: evidenceConstituentCount,
          evidence_visible_count: null,
          evidence_withheld_count: null,
          reason: "mentions_capability_not_available"
        }
    : undefined;
  return {
    contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    read_scope: readScope.descriptor,
    corpus_id: readScope.legacyCorpus?.id ?? null,
    filters_hash: filtersHash,
    kind: args.kind,
    term_key: termKey,
    ...(evidenceAccess ? { evidence_access: evidenceAccess } : {}),
    records,
    page: {
      limit,
      total_count: evidenceVisibleCount,
      next_cursor: nextCursor
    }
  };
}

export async function loadSignalTaxonomyLineageV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  kind: SignalTaxonomyKindV1;
  termKey: string;
  isInternalUser: boolean;
}): Promise<SignalTaxonomyLineageV1> {
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  assertClientSafeFilter(args.filter, args.isInternalUser);
  const termKey = signalTaxonomyTermKeyV1(args.termKey);
  const filter = filterForTerm(args.filter, args.kind, termKey);
  const filtersHash = signalFiltersHashV1(args.filter);
  const [profiles, term, materializations] = await Promise.all([
    loadActiveProfiles(args.workspace.id),
    loadActiveTerm(args.workspace.id, args.kind, termKey),
    loadMaterializationLineage(
      args.workspace,
      readScope,
      filtersHash,
      metricKey(args.kind)
    )
  ]);
  const profile = profiles.find((item) => item.kind === args.kind);
  if (!profile || !term) {
    throw new SignalBackendContractError(
      "not_available",
      "The requested term is not active in this workspace profile.",
      { kind: args.kind, term_key: termKey }
    );
  }
  const predicate = buildSignalOperationalMentionReadPredicateV1(readScope, filter);
  const sources = await pool.query<{
    mention_count: number;
    import_batch_count: number;
    import_batch_ids: string[];
  }>(`
    SELECT count(DISTINCT m.id)::int AS mention_count,
      count(DISTINCT m.source_file_id)::int AS import_batch_count,
      COALESCE(
        array_agg(DISTINCT m.source_file_id::text)
          FILTER (WHERE m.source_file_id IS NOT NULL),
        ARRAY[]::text[]
      ) AS import_batch_ids
    FROM mentions m
    WHERE ${predicate.sql}
  `, predicate.params);
  const edges = args.isInternalUser
    ? await loadGovernedEdges([
        profile.profile_id,
        profile.taxonomy_id,
        profile.rule_set_id,
        profile.model_version_id,
        term.term_id
      ])
    : [];
  const source = sources.rows[0] ?? {
    mention_count: 0,
    import_batch_count: 0,
    import_batch_ids: []
  };
  return {
    contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    read_scope: readScope.descriptor,
    corpus_id: readScope.legacyCorpus?.id ?? null,
    filters_hash: filtersHash,
    kind: args.kind,
    term_key: termKey,
    profile: publicProfile(profile, args.isInternalUser),
    materializations,
    source_summary: {
      mention_count: Number(source.mention_count),
      import_batch_count: Number(source.import_batch_count)
    },
    ...(args.isInternalUser ? {
      governed_edges: edges,
      import_batch_ids: source.import_batch_ids
    } : {})
  };
}

function comparisonFilterV1(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  range: { start: string; end: string }
) {
  normalizeSignalMetricQueryV1({
    workspace: {
      organization_id: workspace.organizationId,
      workspace_id: workspace.id
    },
    metric_key: "topic.volume",
    metric_version: 1,
    filter,
    comparison_date_range: range
  });
  return normalizeSignalFilterV1({ ...filter, date_range: range });
}

async function loadActiveProfiles(workspaceId: string) {
  const result = await pool.query<ProfileRow>(`
    SELECT profile.id::text AS profile_id,
      profile.taxonomy_id::text, profile.rule_set_id::text,
      profile.model_version_id::text, profile.kind, profile.version,
      profile.context_hash, profile.approved_at AS activated_at,
      count(term.id)::int AS term_count
    FROM signal_taxonomy_profiles profile
    LEFT JOIN taxonomy_terms term
      ON term.taxonomy_id = profile.taxonomy_id
     AND term.status = 'active'
    WHERE profile.workspace_id = $1::uuid
      AND profile.status = 'active'
    GROUP BY profile.id
    ORDER BY profile.kind
  `, [workspaceId]);
  return result.rows;
}

async function loadActiveTerm(
  workspaceId: string,
  kind: SignalTaxonomyKindV1,
  termKey: string
) {
  const result = await pool.query<{
    term_id: string;
    term_key: string;
    label: string;
    definition: string | null;
    statement: string | null;
  }>(`
    SELECT term.id::text AS term_id, term.term_key, term.label,
      term.description AS definition,
      NULLIF(term.metadata->>'statement', '') AS statement
    FROM signal_taxonomy_profiles profile
    JOIN taxonomy_terms term
      ON term.taxonomy_id = profile.taxonomy_id
     AND term.status = 'active'
    WHERE profile.workspace_id = $1::uuid
      AND profile.kind = $2
      AND profile.status = 'active'
      AND term.term_key = $3
  `, [workspaceId, kind, termKey]);
  return result.rows[0] ?? null;
}

async function loadTaxonomyMaterializationRows(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  readScope?: SignalOperationalReadScopeV1
): Promise<MaterializationRow[]> {
  const windows = splitSignalMaterializationDateRangeV1(filter.date_range);
  const rows: SignalServingMaterializationRowV1[] = [];
  for (const dateRange of windows) {
    const windowFilter = {
      ...filter,
      date_range: dateRange
    };
    // Keep remote Postgres reads sequential. A full-coverage request may need
    // more than one bounded materialization window, but should not exhaust the
    // Studio pool or weaken the global 366-day contract.
    rows.push(...await loadSignalServingMaterializationRowsV1({
      workspace,
      readScope,
      filter: windowFilter,
      metricKey: "topic.volume"
    }));
    rows.push(...await loadSignalServingMaterializationRowsV1({
      workspace,
      readScope,
      filter: windowFilter,
      metricKey: "narrative.volume"
    }));
  }
  return rows
    .map((row, index) => taxonomyMaterializationRow(row, index));
}

async function loadOperationalCoverageRows(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  readScope: SignalOperationalReadScopeV1
): Promise<MaterializationRow[]> {
  const rows: MaterializationRow[] = [];
  for (const dateRange of splitSignalMaterializationDateRangeV1(filter.date_range)) {
    const coverageRows = await loadSignalServingMaterializationRowsV1({
      workspace,
      readScope,
      filter: { ...filter, date_range: dateRange },
      metricKey: "conversation.volume"
    });
    rows.push(...coverageRows.map((row, index) => ({
      materialization_key: `operational-coverage:${row.period_start}:${index}`,
      metric_key: "topic.volume" as const,
      period_start: row.period_start,
      period_end: row.period_end,
      typed_payload: {
        included_mentions: row.sample_size,
        processed_mentions: 0,
        classified_mentions: 0,
        tag_assertions: 0,
        pending_mentions: 0,
        rejected_mentions: 0,
        buckets: [],
        cooccurrences: []
      },
      state: "not_available" as const,
      data_watermark_hash: row.data_watermark_hash,
      computed_at: row.computed_at
    })));
  }
  return rows;
}

function needsCoverageFallback(rows: MaterializationRow[], profileKinds: Set<string>) {
  return !profileKinds.has("topic")
    || !profileKinds.has("narrative")
    || !rows.some((row) => row.metric_key === "topic.volume")
    || !rows.some((row) => row.metric_key === "narrative.volume");
}

function taxonomyMaterializationRow(
  row: SignalServingMaterializationRowV1,
  index: number
): MaterializationRow {
  return {
    materialization_key: `${row.metric_key}:${row.period_start}:${index}`,
    metric_key: row.metric_key as MaterializationRow["metric_key"],
    period_start: row.period_start,
    period_end: row.period_end,
    typed_payload: row.typed_payload,
    state: row.stale_after && row.stale_after <= new Date()
      ? "stale"
      : row.materialization_state,
    data_watermark_hash: row.data_watermark_hash,
    computed_at: row.computed_at
  };
}

async function loadTermOverviewSignals(
  workspaceId: string,
  predicate: ReturnType<typeof buildSignalMentionReadPredicateV1>,
  readScope: SignalOperationalReadScopeV1
): Promise<TermOverviewSignals> {
  const params = [...predicate.params, workspaceId];
  const workspaceParameter = `$${params.length}`;
  const taggedMentionJoin = readScope.visibleSource === "legacy_corpus"
    ? "tagged_mention.id = m.id"
    : `tagged_mention.workspace_id = m.workspace_id
       AND tagged_mention.canonical_mention_id = m.canonical_mention_id`;
  const result = await pool.query<{
    kind: SignalTaxonomyKindV1;
    term_key: string;
    engagement_total: string;
    positive_mentions: number;
    neutral_mentions: number;
    negative_mentions: number;
  }>(`
    WITH approved_term_mentions AS (
      SELECT DISTINCT
        m.id AS mention_id,
        profile.kind,
        term.term_key,
        m.sentiment_score,
        GREATEST(
          0,
          CASE
            WHEN COALESCE(
              m.engagement->>'engagement',
              m.engagement->>'interactions'
            ) ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
              THEN COALESCE(
                m.engagement->>'engagement',
                m.engagement->>'interactions'
              )::numeric
            ELSE
              COALESCE(
                CASE
                  WHEN m.engagement->>'likes' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
                    THEN (m.engagement->>'likes')::numeric
                END,
                0
              )
              + COALESCE(
                CASE
                  WHEN m.engagement->>'comments' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
                    THEN (m.engagement->>'comments')::numeric
                END,
                0
              )
              + COALESCE(
                CASE
                  WHEN m.engagement->>'shares' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
                    THEN (m.engagement->>'shares')::numeric
                END,
                0
              )
              + COALESCE(
                CASE
                  WHEN m.engagement->>'reposts' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
                    THEN (m.engagement->>'reposts')::numeric
                END,
                0
              )
              + COALESCE(
                CASE
                  WHEN m.engagement->>'saves' ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
                    THEN (m.engagement->>'saves')::numeric
                END,
                0
              )
          END
        ) AS engagement_value
      FROM mentions m
      JOIN record_tags tag
        ON tag.subject_type = 'mention'
       AND tag.review_status = 'approved'
      JOIN mentions tagged_mention
        ON tagged_mention.id = tag.subject_id
       AND ${taggedMentionJoin}
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
       AND profile.model_version_id = tag.model_version_id
       AND profile.workspace_id = ${workspaceParameter}::uuid
       AND profile.status = 'active'
      JOIN taxonomy_terms term
        ON term.id = tag.taxonomy_term_id
       AND term.taxonomy_id = profile.taxonomy_id
       AND term.status = 'active'
      WHERE ${predicate.sql}
    )
    SELECT
      kind,
      term_key,
      COALESCE(sum(engagement_value), 0)::text AS engagement_total,
      count(DISTINCT mention_id) FILTER (
        WHERE sentiment_score > 0.2
      )::int AS positive_mentions,
      count(DISTINCT mention_id) FILTER (
        WHERE sentiment_score IS NOT NULL
          AND sentiment_score BETWEEN -0.2 AND 0.2
      )::int AS neutral_mentions,
      count(DISTINCT mention_id) FILTER (
        WHERE sentiment_score < -0.2
      )::int AS negative_mentions
    FROM approved_term_mentions
    GROUP BY kind, term_key
  `, params);
  const totals: TermOverviewSignals = {
    topic: new Map(),
    narrative: new Map()
  };
  for (const row of result.rows) {
    totals[row.kind].set(row.term_key, {
      engagement_total: Number(row.engagement_total) || 0,
      dominant_sentiment: signalDominantSentimentV1({
        positive: row.positive_mentions,
        neutral: row.neutral_mentions,
        negative: row.negative_mentions
      })
    });
  }
  return totals;
}

export function signalDominantSentimentV1(counts: {
  positive: number;
  neutral: number;
  negative: number;
}): SignalEvidenceSentimentDominantV1 {
  const values = [
    ["positive", counts.positive],
    ["neutral", counts.neutral],
    ["negative", counts.negative]
  ] as const;
  const maximum = Math.max(...values.map(([, value]) => value));
  const leaders = values.filter(([, value]) => value === maximum && value > 0);
  if (leaders.length === 0) return "not_available";
  if (leaders.length > 1) return "mixed";
  return leaders[0]![0];
}

async function loadTermSentimentSummary(
  workspace: ResolvedSignalWorkspace,
  readScope: SignalOperationalReadScopeV1,
  filter: SignalFilterV1,
  kind: SignalTaxonomyKindV1,
  termKey: string
) {
  const scopedFilter = filterForTerm(filter, kind, termKey);
  const predicate = buildSignalOperationalMentionReadPredicateV1(readScope, scopedFilter);
  const result = await pool.query<{
    total_mentions: number;
    positive_mentions: number;
    neutral_mentions: number;
    negative_mentions: number;
    unclassified_mentions: number;
  }>(`
    SELECT
      count(DISTINCT m.id)::int AS total_mentions,
      count(DISTINCT m.id) FILTER (WHERE m.sentiment_score > 0.2)::int AS positive_mentions,
      count(DISTINCT m.id) FILTER (
        WHERE m.sentiment_score IS NOT NULL
          AND m.sentiment_score BETWEEN -0.2 AND 0.2
      )::int AS neutral_mentions,
      count(DISTINCT m.id) FILTER (WHERE m.sentiment_score < -0.2)::int AS negative_mentions,
      count(DISTINCT m.id) FILTER (WHERE m.sentiment_score IS NULL)::int AS unclassified_mentions
    FROM mentions m
    WHERE ${predicate.sql}
  `, predicate.params);
  const row = result.rows[0] ?? {
    total_mentions: 0,
    positive_mentions: 0,
    neutral_mentions: 0,
    negative_mentions: 0,
    unclassified_mentions: 0
  };
  const classified = row.positive_mentions + row.neutral_mentions + row.negative_mentions;
  return {
    ...row,
    classified_mentions: classified,
    dominant: signalDominantSentimentV1({
      positive: row.positive_mentions,
      neutral: row.neutral_mentions,
      negative: row.negative_mentions
    }),
    meaning: "evidence_sentiment_not_term_polarity" as const
  };
}

function snapshotForKind(
  rows: MaterializationRow[],
  kind: SignalTaxonomyKindV1,
  hasProfile: boolean,
  coverageFallback: MaterializationRow[] = []
): Snapshot {
  const metric = metricKey(kind);
  const materialized = rows.filter((row) => row.metric_key === metric);
  const hasGovernedCoverage = hasProfile && materialized.some((row) =>
    Object.prototype.hasOwnProperty.call(row.typed_payload, "included_mentions")
  );
  const scoped = hasGovernedCoverage
    ? materialized
    : coverageFallback.map((row) => ({ ...row, metric_key: metric }));
  const totals = {
    included: 0,
    processed: 0,
    classified: 0,
    assertions: 0,
    pending: 0,
    rejected: 0
  };
  const byTerm = new Map<string, SignalTaxonomyTermMetricV1>();
  const termSeries = new Map<
    string,
    SignalTaxonomyOverviewSectionV1["series"]
  >();
  const cooccurrences = new Map<string, SignalTaxonomyCooccurrenceV1>();
  const rawSeries = scoped.map((row) => {
    const payload = row.typed_payload;
    const included = numeric(payload.included_mentions);
    totals.included += included;
    totals.processed += numeric(payload.processed_mentions);
    totals.classified += numeric(payload.classified_mentions);
    totals.assertions += numeric(payload.tag_assertions);
    totals.pending += numeric(payload.pending_mentions);
    totals.rejected += numeric(payload.rejected_mentions);
    for (const bucket of objectArray(payload.buckets)) {
      const termKey = text(bucket.key);
      if (!termKey) continue;
      const current = byTerm.get(termKey);
      const mentionCount = numeric(bucket.value);
      const denominator = numeric(bucket.denominator);
      byTerm.set(termKey, {
        term_key: termKey,
        label: text(bucket.label) ?? termKey,
        mention_count: (current?.mention_count ?? 0) + mentionCount,
        engagement_total: current?.engagement_total ?? 0,
        denominator: (current?.denominator ?? 0) + denominator,
        share_of_included: null,
        share_of_classified: null,
        comparison_mention_count: null,
        delta: null,
        comparison_share_of_included: null,
        share_delta: null,
        state: row.state
      });
      const points = termSeries.get(termKey) ?? [];
      points.push({
        period_start: row.period_start,
        period_end: row.period_end,
        mention_count: mentionCount,
        denominator,
        share_of_included: denominator > 0
          ? mentionCount / denominator
          : null,
        state: row.state
      });
      termSeries.set(termKey, points);
    }
    for (const item of objectArray(payload.cooccurrences)) {
      const left = text(item.left_term_key);
      const right = text(item.right_term_key);
      if (!left || !right) continue;
      const key = `${left}\u0000${right}`;
      const current = cooccurrences.get(key);
      cooccurrences.set(key, {
        left_term_key: left,
        right_term_key: right,
        mention_count: (current?.mention_count ?? 0)
          + numeric(item.mention_count),
        meaning: "cooccurrence_not_causality"
      });
    }
    return {
      period_start: row.period_start,
      period_end: row.period_end,
      mention_count: numeric(payload.classified_mentions),
      denominator: included,
      share_of_included: included > 0
        ? numeric(payload.classified_mentions) / included
        : null,
      state: row.state
    };
  });
  const series = combineTaxonomySeriesPoints(rawSeries);
  for (const term of byTerm.values()) {
    term.denominator = totals.included;
    term.share_of_included = totals.included > 0
      ? term.mention_count / totals.included
      : null;
    term.share_of_classified = totals.classified > 0
      ? term.mention_count / totals.classified
      : null;
    term.state = worstState(scoped.map((row) => row.state));
    termSeries.set(term.term_key, combineTaxonomySeriesPoints(scoped.map((row) => {
      const included = numeric(row.typed_payload.included_mentions);
      const bucket = objectArray(row.typed_payload.buckets)
        .find((item) => text(item.key) === term.term_key);
      const mentionCount = numeric(bucket?.value);
      return {
        period_start: row.period_start,
        period_end: row.period_end,
        mention_count: mentionCount,
        denominator: included,
        share_of_included: included > 0 ? mentionCount / included : null,
        state: row.state
      };
    })));
  }
  const coverage = signalTaxonomyCoverageV1({
    included_mentions: totals.included,
    processed_mentions: totals.processed,
    classified_mentions: totals.classified,
    tag_assertions: totals.assertions,
    pending_mentions: totals.pending,
    rejected_mentions: totals.rejected
  });
  const state = !hasGovernedCoverage
    ? "not_available"
    : worstState(scoped.map((row) => row.state));
  return {
    kind,
    metric_key: metric,
    state,
    coverage: { ...coverage, processed_mentions: totals.processed },
    terms: Array.from(byTerm.values()).sort((left, right) =>
      right.mention_count - left.mention_count
      || left.term_key.localeCompare(right.term_key)
    ),
    series,
    cooccurrences: Array.from(cooccurrences.values()).sort((left, right) =>
      right.mention_count - left.mention_count
      || left.left_term_key.localeCompare(right.left_term_key)
      || left.right_term_key.localeCompare(right.right_term_key)
    ),
    data_watermark_hashes: Array.from(
      new Set(scoped.map((row) => row.data_watermark_hash))
    ).sort(),
    computed_at: scoped.length
      ? new Date(Math.max(...scoped.map((row) => row.computed_at.getTime())))
          .toISOString()
      : null,
    byTerm,
    termSeries
  };
}

function combineTaxonomySeriesPoints(
  points: SignalTaxonomyOverviewSectionV1["series"]
): SignalTaxonomyOverviewSectionV1["series"] {
  const combined = new Map<
    string,
    SignalTaxonomyOverviewSectionV1["series"][number]
  >();
  for (const point of points) {
    const key = `${point.period_start}\u0000${point.period_end}`;
    const current = combined.get(key);
    if (!current) {
      combined.set(key, point);
      continue;
    }
    const mentionCount = current.mention_count + point.mention_count;
    const denominator = current.denominator + point.denominator;
    combined.set(key, {
      ...current,
      mention_count: mentionCount,
      denominator,
      share_of_included: denominator > 0 ? mentionCount / denominator : null,
      state: worstState([current.state, point.state])
    });
  }
  return Array.from(combined.values()).sort((left, right) =>
    left.period_start.localeCompare(right.period_start)
    || left.period_end.localeCompare(right.period_end)
  );
}

function withComparison(current: Snapshot, comparison: Snapshot | null): Snapshot {
  if (!comparison) return current;
  const keys = Array.from(new Set([
    ...current.terms.map((term) => term.term_key),
    ...comparison.terms.map((term) => term.term_key)
  ]));
  const terms = keys.map((termKey) => {
    const currentTerm = current.byTerm.get(termKey);
    const previous = comparison.byTerm.get(termKey);
    const currentMentionCount = currentTerm?.mention_count ?? 0;
    const currentShare = currentTerm?.share_of_included
      ?? (current.coverage.included_mentions > 0 ? 0 : null);
    const term = currentTerm ?? {
      term_key: termKey,
      label: previous?.label ?? termKey,
      mention_count: 0,
      engagement_total: 0,
      dominant_sentiment: "not_available" as const,
      denominator: current.coverage.included_mentions,
      share_of_included: currentShare,
      share_of_classified: current.coverage.classified_mentions > 0 ? 0 : null,
      comparison_mention_count: null,
      delta: null,
      comparison_share_of_included: null,
      share_delta: null,
      state: current.state
    };
    return {
      ...term,
      comparison_mention_count: previous?.mention_count ?? 0,
      delta: currentMentionCount - (previous?.mention_count ?? 0),
      comparison_share_of_included: previous?.share_of_included ?? 0,
      share_delta: currentShare == null
        ? null
        : currentShare - (previous?.share_of_included ?? 0)
    };
  }).sort((left, right) =>
    right.mention_count - left.mention_count
    || left.term_key.localeCompare(right.term_key)
  );
  return {
    ...current,
    terms,
    byTerm: new Map(terms.map((term) => [term.term_key, term]))
  };
}

function withOverviewSignals(
  snapshot: Snapshot,
  signalsByTerm: TermOverviewSignals[SignalTaxonomyKindV1]
): Snapshot {
  const terms = snapshot.terms.map((term) => {
    const signals = signalsByTerm.get(term.term_key);
    return {
      ...term,
      engagement_total: signals?.engagement_total ?? 0,
      dominant_sentiment: signals?.dominant_sentiment ?? "not_available"
    };
  });
  return {
    ...snapshot,
    terms,
    byTerm: new Map(terms.map((term) => [term.term_key, term]))
  };
}

function withoutIndex(snapshot: Snapshot): SignalTaxonomyOverviewSectionV1 {
  return {
    kind: snapshot.kind,
    metric_key: snapshot.metric_key,
    state: snapshot.state,
    coverage: snapshot.coverage,
    terms: snapshot.terms,
    series: snapshot.series,
    cooccurrences: snapshot.cooccurrences,
    data_watermark_hashes: snapshot.data_watermark_hashes,
    computed_at: snapshot.computed_at
  };
}

function zeroTerm(
  term: { term_key: string; label: string },
  section: SignalTaxonomyOverviewSectionV1
): SignalTaxonomyTermMetricV1 {
  return {
    term_key: term.term_key,
    label: term.label,
    mention_count: 0,
    engagement_total: 0,
    dominant_sentiment: "not_available",
    denominator: section.coverage.included_mentions,
    share_of_included: section.coverage.included_mentions > 0 ? 0 : null,
    share_of_classified: section.coverage.classified_mentions > 0 ? 0 : null,
    comparison_mention_count: null,
    delta: null,
    comparison_share_of_included: null,
    share_delta: null,
    state: section.state
  };
}

function filterForTerm(
  filter: SignalFilterV1,
  kind: SignalTaxonomyKindV1,
  termKey: string
) {
  return normalizeSignalFilterV1({
    ...filter,
    dimensions: {
      ...filter.dimensions,
      [kind]: [termKey]
    }
  });
}

function publicProfile(
  profile: ProfileRow,
  isInternalUser: boolean
): SignalTaxonomyServingProfileV1 {
  return {
    kind: profile.kind,
    version: profile.version,
    status: "active",
    activated_at: profile.activated_at?.toISOString() ?? null,
    term_count: Number(profile.term_count),
    ...(isInternalUser ? {
      profile_id: profile.profile_id,
      taxonomy_id: profile.taxonomy_id,
      rule_set_id: profile.rule_set_id,
      model_version_id: profile.model_version_id,
      context_hash: profile.context_hash
    } : {})
  };
}

async function loadMaterializationLineage(
  workspace: ResolvedSignalWorkspace,
  readScope: SignalOperationalReadScopeV1,
  filtersHash: string,
  metric: "topic.volume" | "narrative.volume"
) {
  const population = readScope.visibleSource === "governed_population"
    ? readScope.population
    : null;
  const scopeId = population?.id ?? readScope.legacyCorpus?.id;
  if (!scopeId) return [];
  const scopeSql = population
    ? `population_id = $2::uuid
      AND population_version = ${population.version}
      AND population_definition_hash = '${population.definition_hash.replaceAll("'", "''")}'`
    : "study_corpus_id = $2::uuid";
  const result = await pool.query<{
    materialization_key: string;
    data_watermark_hash: string;
    state: SignalTaxonomyServingStateV1;
    computed_at: Date;
  }>(`
    SELECT materialization_key, data_watermark_hash,
      CASE
        WHEN stale_after IS NOT NULL AND stale_after <= now() THEN 'stale'
        ELSE materialization_state
      END AS state,
      computed_at
    FROM metric_materializations
    WHERE workspace_id = $1::uuid
      AND ${scopeSql}
      AND filters_hash = $3
      AND metric_key = $4
      AND metric_version = 1
      AND (cache_scope <> 'ad_hoc' OR expires_at > now())
    ORDER BY period_start
  `, [workspace.id, scopeId, filtersHash, metric]);
  return result.rows.map((row) => ({
    ...row,
    computed_at: row.computed_at.toISOString()
  }));
}

async function loadGovernedEdges(ids: string[]) {
  const result = await pool.query<{
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    relation_type: string;
  }>(`
    SELECT source_type, source_id::text, target_type,
      target_id::text, relation_type
    FROM lineage_edges
    WHERE source_id = ANY($1::uuid[])
       OR target_id = ANY($1::uuid[])
    ORDER BY source_type, source_id, target_type, target_id, relation_type
    LIMIT 500
  `, [ids]);
  return result.rows;
}

function metricKey(kind: SignalTaxonomyKindV1) {
  return kind === "topic"
    ? "topic.volume" as const
    : "narrative.volume" as const;
}

function worstState(states: SignalTaxonomyServingStateV1[]) {
  if (states.length === 0 || states.every((state) => state === "not_available")) {
    return "not_available" as const;
  }
  if (states.includes("stale")) return "stale" as const;
  if (states.includes("partial")) return "partial" as const;
  if (states.includes("pending")) return "pending" as const;
  if (states.includes("not_available")) return "partial" as const;
  return "fresh" as const;
}


function assertClientSafeFilter(
  filter: SignalFilterV1,
  isInternalUser: boolean
) {
  if (!isInternalUser && filter.dimensions.source_type) {
    throw new SignalBackendContractError(
      "unsupported_dimension",
      "source_type is an internal Signal dimension.",
      { dimension: "source_type" }
    );
  }
}

function boundedLimit(input?: number) {
  const value = input ?? 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "limit must be between 1 and 100.",
      { field: "limit" }
    );
  }
  return value;
}

function objectArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function evidenceQuotes(evidence: JsonRecord) {
  return objectArray(evidence.quotes).flatMap((item) => {
    const quote = text(item.quote);
    if (!quote) return [];
    return [{
      quote,
      start: nullableInteger(item.start),
      end: nullableInteger(item.end)
    }];
  });
}

function rebasePredicateSql(sql: string, offset: number) {
  if (offset === 0) return sql;
  return sql.replace(/\$(\d+)/gu, (_match, rawIndex: string) => (
    `$${Number(rawIndex) + offset}`
  ));
}

function sha256Value(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function numeric(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nullableInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
