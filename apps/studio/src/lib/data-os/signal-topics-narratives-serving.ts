import {
  SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
  SignalBackendContractError,
  buildSignalMentionPredicateV1,
  decodeSignalDrillDownCursorV1,
  encodeSignalDrillDownCursorV1,
  normalizeSignalFilterV1,
  normalizeSignalMetricQueryV1,
  signalFiltersHashV1,
  signalTaxonomyCoverageV1,
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
  type SignalTopicsNarrativesOverviewV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import {
  requireOperationalCorpus,
  type ResolvedSignalWorkspace
} from "@/lib/data-os/signal-workspace";

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
  filter: SignalFilterV1;
  comparisonRange?: { start: string; end: string } | null;
  isInternalUser: boolean;
}): Promise<SignalTopicsNarrativesOverviewV1> {
  const corpus = requireCorpus(args.workspace);
  assertClientSafeFilter(args.filter, args.isInternalUser);
  const currentPredicate = buildSignalMentionPredicateV1(
    args.filter,
    [corpus.id],
    args.workspace.id
  );
  const comparisonFilter = args.comparisonRange
    ? comparisonFilterV1(args.workspace, args.filter, args.comparisonRange)
    : null;
  const comparisonPredicate = comparisonFilter
    ? buildSignalMentionPredicateV1(
        comparisonFilter,
        [corpus.id],
        args.workspace.id
      )
    : null;
  const [profiles, currentRows, comparisonRows] = await Promise.all([
    loadActiveProfiles(args.workspace.id),
    loadMaterializationRows(
      args.workspace.id,
      corpus.id,
      currentPredicate.filters_hash,
      args.filter.granularity
    ),
    comparisonFilter
      ? loadMaterializationRows(
          args.workspace.id,
          corpus.id,
          comparisonPredicate!.filters_hash,
          comparisonFilter.granularity
        )
      : Promise.resolve([] as MaterializationRow[])
  ]);
  const profileKinds = new Set(profiles.map((profile) => profile.kind));
  const currentTopics = snapshotForKind(currentRows, "topic", profileKinds.has("topic"));
  const currentNarratives = snapshotForKind(
    currentRows,
    "narrative",
    profileKinds.has("narrative")
  );
  const comparisonTopics = comparisonFilter
    ? snapshotForKind(comparisonRows, "topic", profileKinds.has("topic"))
    : null;
  const comparisonNarratives = comparisonFilter
    ? snapshotForKind(comparisonRows, "narrative", profileKinds.has("narrative"))
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
    contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    corpus_id: corpus.id,
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
  };
}

export async function loadSignalTaxonomyTermDetailV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  comparisonRange?: { start: string; end: string } | null;
  kind: SignalTaxonomyKindV1;
  termKey: string;
  isInternalUser: boolean;
}): Promise<SignalTaxonomyTermDetailV1> {
  const termKey = signalTaxonomyTermKeyV1(args.termKey);
  const corpus = requireCorpus(args.workspace);
  const [overview, termDefinition, currentRows] = await Promise.all([
    loadSignalTopicsNarrativesOverviewV1(args),
    loadActiveTerm(args.workspace.id, args.kind, termKey),
    loadMaterializationRows(
      args.workspace.id,
      corpus.id,
      signalFiltersHashV1(args.filter),
      args.filter.granularity
    )
  ]);
  if (!termDefinition) {
    throw new SignalBackendContractError(
      "not_available",
      "The requested term is not active in this workspace profile.",
      { kind: args.kind, term_key: termKey }
    );
  }
  const section = args.kind === "topic" ? overview.topics : overview.narratives;
  const snapshot = snapshotForKind(currentRows, args.kind, true);
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
    corpus_id: overview.corpus_id,
    filters_hash: signalFiltersHashV1(args.filter),
    kind: args.kind,
    metric_key: metricKey(args.kind),
    term: {
      ...term,
      definition: termDefinition.definition,
      statement: termDefinition.statement
    },
    series: snapshot.termSeries.get(termKey)
      ?? section.series.map((point) => ({
        ...point,
        mention_count: 0,
        share_of_included: point.denominator > 0 ? 0 : null
      })),
    related_terms: related,
    coverage: section.coverage,
    state: section.state,
    limitations: section.coverage.limitations,
    links: {
      evidence: `${basePath}/evidence`,
      lineage: `${basePath}/lineage`
    }
  };
}

export async function loadSignalTaxonomyEvidenceV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  kind: SignalTaxonomyKindV1;
  termKey: string;
  cursor?: string | null;
  limit?: number;
  isInternalUser: boolean;
}): Promise<SignalTaxonomyEvidencePageV1> {
  const corpus = requireCorpus(args.workspace);
  assertClientSafeFilter(args.filter, args.isInternalUser);
  const termKey = signalTaxonomyTermKeyV1(args.termKey);
  const filter = filterForTerm(args.filter, args.kind, termKey);
  const filtersHash = signalFiltersHashV1(filter);
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
  const predicate = buildSignalMentionPredicateV1(
    filter,
    [corpus.id],
    args.workspace.id
  );
  const params = [...predicate.params, args.workspace.id, args.kind, termKey];
  const workspaceParameter = `$${params.length - 2}::uuid`;
  const kindParameter = `$${params.length - 1}`;
  const termParameter = `$${params.length}`;
  let cursorSql = "";
  if (decoded) {
    params.push(decoded.sort.occurred_at, decoded.sort.subject_id);
    cursorSql =
      `AND (occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  const limit = boundedLimit(args.limit);
  params.push(limit + 1);
  const result = await pool.query<{
    mention_id: string;
    occurred_at: Date;
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
    profile_id: string;
    import_batch_id: string | null;
    total_count: number;
  }>(`
    WITH scoped AS (
      SELECT m.id, m.published_at AS occurred_at,
        m.text_snippet, m.title, m.url,
        COALESCE(m.resolved_platform, m.platform) AS platform,
        m.language, m.country,
        tag.score::text, tag.confidence, tag.evidence,
        tag.model_version_id::text, profile.id::text AS profile_id,
        m.source_file_id::text AS import_batch_id
      FROM mentions m
      JOIN record_tags tag
        ON tag.subject_type = 'mention'
       AND tag.subject_id = m.id
       AND tag.review_status = 'approved'
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
       AND profile.workspace_id = ${workspaceParameter}
       AND profile.kind = ${kindParameter}
       AND profile.status = 'active'
      JOIN taxonomy_terms term
        ON term.id = tag.taxonomy_term_id
       AND term.taxonomy_id = profile.taxonomy_id
       AND term.term_key = ${termParameter}
       AND term.status = 'active'
      WHERE ${predicate.sql}
    )
    SELECT id::text AS mention_id, occurred_at,
      text_snippet, title, url, platform, language, country,
      score, confidence, evidence, model_version_id, profile_id,
      import_batch_id, (SELECT count(*)::int FROM scoped) AS total_count
    FROM scoped
    WHERE true ${cursorSql}
    ORDER BY occurred_at DESC, id DESC
    LIMIT $${params.length}::int
  `, params);
  const hasNext = result.rows.length > limit;
  const records = result.rows.slice(0, limit).map((row) => ({
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
  return {
    contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    corpus_id: corpus.id,
    filters_hash: filtersHash,
    kind: args.kind,
    term_key: termKey,
    records,
    page: {
      limit,
      total_count: Number(result.rows[0]?.total_count ?? 0),
      next_cursor: nextCursor
    }
  };
}

export async function loadSignalTaxonomyLineageV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  kind: SignalTaxonomyKindV1;
  termKey: string;
  isInternalUser: boolean;
}): Promise<SignalTaxonomyLineageV1> {
  const corpus = requireCorpus(args.workspace);
  assertClientSafeFilter(args.filter, args.isInternalUser);
  const termKey = signalTaxonomyTermKeyV1(args.termKey);
  const filter = filterForTerm(args.filter, args.kind, termKey);
  const filtersHash = signalFiltersHashV1(args.filter);
  const [profiles, term, materializations] = await Promise.all([
    loadActiveProfiles(args.workspace.id),
    loadActiveTerm(args.workspace.id, args.kind, termKey),
    loadMaterializationLineage(
      args.workspace.id,
      corpus.id,
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
  const predicate = buildSignalMentionPredicateV1(
    filter,
    [corpus.id],
    args.workspace.id
  );
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
    corpus_id: corpus.id,
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

async function loadMaterializationRows(
  workspaceId: string,
  corpusId: string,
  filtersHash: string,
  granularity: SignalFilterV1["granularity"]
) {
  const result = await pool.query<MaterializationRow>(`
    SELECT materialization_key, metric_key,
      period_start::text, period_end::text, typed_payload,
      CASE
        WHEN stale_after IS NOT NULL AND stale_after <= now() THEN 'stale'
        ELSE materialization_state
      END AS state,
      data_watermark_hash, computed_at
    FROM metric_materializations
    WHERE workspace_id = $1::uuid
      AND study_corpus_id = $2::uuid
      AND filters_hash = $3
      AND granularity = $4
      AND metric_version = 1
      AND metric_key IN ('topic.volume', 'narrative.volume')
      AND (cache_scope <> 'ad_hoc' OR expires_at > now())
    ORDER BY metric_key, period_start
  `, [workspaceId, corpusId, filtersHash, granularity]);
  return result.rows;
}

function snapshotForKind(
  rows: MaterializationRow[],
  kind: SignalTaxonomyKindV1,
  hasProfile: boolean
): Snapshot {
  const metric = metricKey(kind);
  const scoped = rows.filter((row) => row.metric_key === metric);
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
  const series = scoped.map((row) => {
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
  for (const term of byTerm.values()) {
    term.denominator = totals.included;
    term.share_of_included = totals.included > 0
      ? term.mention_count / totals.included
      : null;
    term.share_of_classified = totals.classified > 0
      ? term.mention_count / totals.classified
      : null;
    term.state = worstState(scoped.map((row) => row.state));
    termSeries.set(term.term_key, scoped.map((row) => {
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
    }));
  }
  const coverage = signalTaxonomyCoverageV1({
    included_mentions: totals.included,
    processed_mentions: totals.processed,
    classified_mentions: totals.classified,
    tag_assertions: totals.assertions,
    pending_mentions: totals.pending,
    rejected_mentions: totals.rejected
  });
  const state = !hasProfile || scoped.length === 0
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
  workspaceId: string,
  corpusId: string,
  filtersHash: string,
  metric: "topic.volume" | "narrative.volume"
) {
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
      AND study_corpus_id = $2::uuid
      AND filters_hash = $3
      AND metric_key = $4
      AND metric_version = 1
      AND (cache_scope <> 'ad_hoc' OR expires_at > now())
    ORDER BY period_start
  `, [workspaceId, corpusId, filtersHash, metric]);
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

const requireCorpus = requireOperationalCorpus;

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
