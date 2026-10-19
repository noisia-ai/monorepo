import {
  SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
  normalizeSignalFilterV1,
  type SignalDimensionV1,
  type SignalFilterV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import { resolveOperationalWorkspacePopulation } from "@/lib/data-os/signal-operational-read-scope";
import { loadSignalTopicsNarrativesModuleShadowV1 } from "@/lib/data-os/signal-topics-narratives-serving";
import {
  loadSignalMentionsModuleShadowV1,
  type SignalServingQueryable
} from "@/lib/data-os/signal-workspace-serving";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import { loadSignalBrandMonitoringModuleShadowV1 } from "@/lib/signal-v2/brand-monitoring";

export { resolveOperationalWorkspacePopulation };

export async function loadWorkspacePopulationShadowComparison(
  workspace: ResolvedSignalWorkspace
) {
  const population = await resolveOperationalWorkspacePopulation(workspace.id);
  const legacyCorpus = workspace.corpora.find((corpus) => corpus.role === "operational")
    ?? workspace.corpora.find((corpus) => corpus.role === "legacy")
    ?? null;
  const [workspaceCounts, populationCounts, legacyCounts] = await Promise.all([
    pool.query<{
      scope: string;
      accepted: number;
      excluded: number;
      mention_pending: number;
      attribution_pending: number;
      attribution_rejected: number;
      canonical_records: number;
      quality_lt_5: number;
      period_start: string | null;
      period_end: string | null;
    }>(`
      WITH canonical_mentions AS (
        SELECT mention.*
        FROM mentions mention
        WHERE mention.workspace_id = $1::uuid
          AND mention.canonical_mention_id = mention.id
      ), scoped AS (
        SELECT
          mention.id,
          mention.inclusion_status,
          mention.quality_score,
          mention.published_at,
          COALESCE(attribution.scope, 'unattributed') AS scope,
          attribution.review_status
        FROM canonical_mentions mention
        LEFT JOIN signal_mention_attributions attribution
          ON attribution.mention_id = mention.id
         AND attribution.workspace_id = mention.workspace_id
      )
      SELECT
        scope,
        count(DISTINCT id) FILTER (WHERE inclusion_status = 'included')::int AS accepted,
        count(DISTINCT id) FILTER (WHERE inclusion_status = 'excluded')::int AS excluded,
        count(DISTINCT id) FILTER (WHERE inclusion_status = 'pending')::int AS mention_pending,
        count(DISTINCT id) FILTER (WHERE review_status = 'pending')::int AS attribution_pending,
        count(DISTINCT id) FILTER (WHERE review_status = 'rejected')::int AS attribution_rejected,
        count(DISTINCT id)::int AS canonical_records,
        count(DISTINCT id) FILTER (WHERE COALESCE(quality_score, 0) < 5)::int AS quality_lt_5,
        min((published_at AT TIME ZONE $2)::date)::text AS period_start,
        max((published_at AT TIME ZONE $2)::date)::text AS period_end
      FROM scoped
      GROUP BY scope
      ORDER BY scope
    `, [workspace.id, workspace.timezone]),
    pool.query<{ included: number; earliest: string | null; latest: string | null }>(`
      SELECT
        count(*)::int AS included,
        min((mention.published_at AT TIME ZONE $3)::date)::text AS earliest,
        max((mention.published_at AT TIME ZONE $3)::date)::text AS latest
      FROM signal_population_memberships membership
      JOIN mentions mention
        ON mention.id = membership.mention_id
       AND mention.workspace_id = membership.workspace_id
       AND mention.canonical_mention_id = mention.id
      WHERE membership.population_id = $1::uuid
        AND membership.workspace_id = $2::uuid
        AND membership.membership_status = 'included'
        AND membership.removed_at IS NULL
    `, [population.id, workspace.id, workspace.timezone]),
    legacyCorpus
      ? pool.query<{
          accepted_rows: number;
          distinct_mentions: number;
          canonical_records: number;
          missing_from_governed: number;
          additional_in_governed: number;
          period_start: string | null;
          period_end: string | null;
        }>(`
          WITH legacy_rows AS (
            SELECT mention.id, mention.canonical_mention_id, mention.published_at
            FROM mentions mention
            JOIN import_batches batch ON batch.id = mention.source_file_id
            WHERE mention.study_corpus_id = $1::uuid
              AND mention.inclusion_status = 'included'
              AND (
                batch.mention_type = 'brand'
                OR batch.entity_kind = 'primary_brand'
              )
          ), legacy_canonical AS (
            SELECT DISTINCT COALESCE(canonical_mention_id, id) AS mention_id
            FROM legacy_rows
          ), governed AS (
            SELECT membership.mention_id
            FROM signal_population_memberships membership
            WHERE membership.population_id = $2::uuid
              AND membership.workspace_id = $3::uuid
              AND membership.membership_status = 'included'
              AND membership.removed_at IS NULL
          )
          SELECT
            (SELECT count(*)::int FROM legacy_rows) AS accepted_rows,
            (SELECT count(DISTINCT id)::int FROM legacy_rows) AS distinct_mentions,
            (SELECT count(*)::int FROM legacy_canonical) AS canonical_records,
            (SELECT count(*)::int FROM legacy_canonical legacy
              WHERE NOT EXISTS (
                SELECT 1 FROM governed WHERE governed.mention_id = legacy.mention_id
              )) AS missing_from_governed,
            (SELECT count(*)::int FROM governed
              WHERE NOT EXISTS (
                SELECT 1 FROM legacy_canonical legacy
                WHERE legacy.mention_id = governed.mention_id
              )) AS additional_in_governed,
            (SELECT min((published_at AT TIME ZONE $4)::date)::text FROM legacy_rows)
              AS period_start,
            (SELECT max((published_at AT TIME ZONE $4)::date)::text FROM legacy_rows)
              AS period_end
        `, [legacyCorpus.id, population.id, workspace.id, workspace.timezone])
      : Promise.resolve({ rows: [] as Array<{
          accepted_rows: number;
          distinct_mentions: number;
          canonical_records: number;
          missing_from_governed: number;
          additional_in_governed: number;
          period_start: string | null;
          period_end: string | null;
        }> })
  ]);
  const governed = populationCounts.rows[0] ?? { included: 0, earliest: null, latest: null };
  const legacy = legacyCounts.rows[0] ?? {
    accepted_rows: 0,
    distinct_mentions: 0,
    canonical_records: 0,
    missing_from_governed: 0,
    additional_in_governed: 0,
    period_start: null,
    period_end: null
  };
  const legacyReconciled = Boolean(legacyCorpus)
    && legacy.missing_from_governed === 0
    && legacy.additional_in_governed === 0;
  const shadowFilter = moduleShadowFilter(workspace, governed, legacy);
  const [moduleReaders, governedContract, legacyDifferences] = legacyCorpus
    ? await Promise.all([
        Promise.all([
          loadSignalBrandMonitoringModuleShadowV1({
            workspace,
            populationId: population.id,
            filter: shadowFilter
          }),
          loadSignalMentionsModuleShadowV1({
            workspace,
            populationId: population.id,
            filter: shadowFilter,
            isInternalUser: true
          }),
          loadSignalTopicsNarrativesModuleShadowV1({
            workspace,
            populationId: population.id,
            filter: shadowFilter
          })
        ]),
        loadGovernedPopulationContract({
          workspace,
          populationId: population.id,
          filter: shadowFilter
        }),
        loadLegacyDifferenceExplanation({
          workspace,
          legacyCorpusId: legacyCorpus.id,
          populationId: population.id,
          filter: shadowFilter
        })
      ])
    : [null, null, null] as const;
  const governedModuleChecks = moduleReaders && governedContract
    ? {
        brand_monitoring: moduleReaders[0].governed.row_denominator === governedContract.filtered_count
          && moduleReaders[0].governed.canonical_ids_hash === governedContract.canonical_ids_hash
          && moduleReaders[0].governed.period_start === governedContract.period_start
          && moduleReaders[0].governed.period_end === governedContract.period_end
          && moduleReaders[0].governed.series_hash === governedContract.series_hash,
        mentions: moduleReaders[1].governed.total_count === governedContract.filtered_count
          && moduleReaders[1].governed.canonical_ids_hash === governedContract.canonical_ids_hash
          && moduleReaders[1].governed.period_start === governedContract.period_start
          && moduleReaders[1].governed.period_end === governedContract.period_end
          && moduleReaders[1].governed.cursor_valid,
        topics_narratives: moduleReaders[2].governed.row_denominator === governedContract.filtered_count
          && moduleReaders[2].governed.canonical_ids_hash === governedContract.canonical_ids_hash
          && moduleReaders[2].governed.period_start === governedContract.period_start
          && moduleReaders[2].governed.period_end === governedContract.period_end
          && moduleReaders[2].governed.topic_result_count === governedContract.topic_result_count
          && moduleReaders[2].governed.topic_results_hash === governedContract.topic_results_hash
          && moduleReaders[2].governed.narrative_result_count === governedContract.narrative_result_count
          && moduleReaders[2].governed.narrative_results_hash === governedContract.narrative_results_hash
          && moduleReaders[2].governed.resolved_alias_assignment_count
            === governedContract.resolved_alias_assignment_count
      }
    : null;
  const governedCorrect = Boolean(
    governedContract
    && governedContract.primary_brand_contract
    && governedContract.contract_violation_count === 0
    && governedModuleChecks
    && Object.values(governedModuleChecks).every(Boolean)
  );
  const zeroUnexplainedDifferences = Boolean(
    legacyDifferences && legacyDifferences.unexplained_count === 0
  );
  const moduleGatePassed = governedCorrect && zeroUnexplainedDifferences;
  const parityWithLegacy = Boolean(
    moduleReaders?.every((reader) => reader.reconciled)
  );
  return {
    contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
    mode: "shadow" as const,
    workspace_id: workspace.id,
    population: {
      id: population.id,
      key: population.population_key,
      version: population.version,
      definition_hash: population.definition_hash,
      acceptance_status: population.acceptance_status,
      allowed_scopes: population.allowed_scopes,
      included: governed.included,
      period_start: governed.earliest,
      period_end: governed.latest
    },
    workspace_by_scope: workspaceCounts.rows,
    legacy_operational_corpus: legacyCorpus ? {
      id: legacyCorpus.id,
      accepted_rows: legacy.accepted_rows,
      distinct_mentions: legacy.distinct_mentions,
      canonical_records: legacy.canonical_records,
      duplicate_rows: Math.max(0, legacy.accepted_rows - legacy.canonical_records),
      missing_from_governed: legacy.missing_from_governed,
      additional_in_governed: legacy.additional_in_governed,
      period_start: legacy.period_start,
      period_end: legacy.period_end
    } : null,
    comparison: {
      comparison_kind: "population_membership" as const,
      canonical_delta: governed.included - legacy.canonical_records,
      missing_from_governed: legacy.missing_from_governed,
      additional_in_governed: legacy.additional_in_governed,
      reconciled: legacyReconciled,
      state: legacyCorpus
        ? (legacyReconciled ? "exact" : "diverged")
        : "no_legacy_baseline",
      dimensions: ["scope", "quality", "period", "dedup"]
    },
    module_serving_shadow: moduleReaders ? {
      state: parityWithLegacy
        ? "exact" as const
        : moduleGatePassed
          ? "correct_with_explained_legacy_differences" as const
          : "blocked" as const,
      reconciliation_basis: "governed_contract_with_explained_legacy_differences" as const,
      reconciled: moduleGatePassed,
      gate_passed: moduleGatePassed,
      parity_with_legacy: parityWithLegacy,
      governed_correct: governedCorrect,
      zero_unexplained_differences: zeroUnexplainedDifferences,
      governed_contract: governedContract,
      legacy_differences: legacyDifferences,
      governed_module_checks: governedModuleChecks,
      filter: shadowFilter,
      brand_monitoring: moduleReaders[0],
      mentions: moduleReaders[1],
      topics_narratives: moduleReaders[2]
    } : {
      state: "no_legacy_baseline" as const,
      reconciliation_basis: "governed_contract_with_explained_legacy_differences" as const,
      reconciled: false,
      gate_passed: false,
      parity_with_legacy: false,
      governed_correct: false,
      zero_unexplained_differences: false,
      governed_contract: null,
      legacy_differences: null,
      governed_module_checks: null,
      filter: shadowFilter,
      brand_monitoring: null,
      mentions: null,
      topics_narratives: null
    }
  };
}

export async function loadGovernedPopulationContract(args: {
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: ReturnType<typeof normalizeSignalFilterV1>;
  queryable?: SignalServingQueryable;
}) {
  const independentFilter = independentGovernedFilterSql(args.filter, args.workspace.id, [
    args.populationId,
    args.workspace.id,
    args.workspace.timezone,
    args.filter.date_range.start,
    args.filter.date_range.end
  ]);
  const result = await (args.queryable ?? pool).query<{
    primary_brand_contract: boolean;
    active_memberships: number;
    contract_violation_count: number;
    filtered_count: number;
    canonical_ids_hash: string;
    period_start: string | null;
    period_end: string | null;
    series_hash: string;
    filled_series_hash: string;
    conversation_series_hash: string;
    sentiment_counts: Record<string, number>;
    platform_counts: Record<string, number>;
    emotion_counts: Record<string, number>;
    topic_counts: Record<string, number>;
    narrative_counts: Record<string, number>;
    first_mention_id: string | null;
    first_page_last_id: string | null;
    next_page_first_id: string | null;
    topic_result_count: number;
    topic_results_hash: string;
    narrative_result_count: number;
    narrative_results_hash: string;
    resolved_alias_assignment_count: number;
  }>(`
    WITH definition AS (
      SELECT definition.*, workspace.brand_id
      FROM signal_population_definitions definition
      JOIN signal_workspaces workspace ON workspace.id = definition.workspace_id
      WHERE definition.id = $1::uuid AND definition.workspace_id = $2::uuid
    ), active_memberships AS (
      SELECT mention.*, definition.allowed_scopes,
        definition.acceptance_status, definition.min_quality_score,
        definition.period_start, definition.period_end, definition.brand_id
      FROM signal_population_memberships membership
      JOIN definition ON true
      JOIN mentions mention
        ON mention.id = membership.mention_id
       AND mention.workspace_id = membership.workspace_id
      WHERE membership.population_id = $1::uuid
        AND membership.workspace_id = $2::uuid
        AND membership.membership_status = 'included'
        AND membership.removed_at IS NULL
    ), filtered AS (
      SELECT mention.*,
        (mention.published_at AT TIME ZONE $3)::date AS local_date,
        date_trunc('${args.filter.granularity}', mention.published_at AT TIME ZONE $3)::date
          AS period_bucket
      FROM active_memberships mention
      WHERE (mention.published_at AT TIME ZONE $3)::date >= $4::date
        AND (mention.published_at AT TIME ZONE $3)::date <= $5::date
        AND mention.canonical_mention_id = mention.id
        ${independentFilter.conditions.length
          ? `AND ${independentFilter.conditions.join("\n        AND ")}`
          : ""}
    ), periods AS (
      SELECT generate_series(
        '${periodBucketStart(args.filter.date_range.start, args.filter.granularity)}'::date,
        '${periodBucketStart(args.filter.date_range.end, args.filter.granularity)}'::date,
        interval '${args.filter.granularity === "day" ? "1 day" : args.filter.granularity === "week" ? "1 week" : "1 month"}'
      )::date AS period_start
    ), series AS (
      SELECT periods.period_start, count(filtered.id)::int AS mentions
      FROM periods
      LEFT JOIN filtered ON filtered.period_bucket = periods.period_start
      GROUP BY periods.period_start
    ), nonempty_series AS (
      SELECT period_bucket AS period_start, count(*)::int AS mentions
      FROM filtered GROUP BY period_bucket
    ), conversation_rows AS (
      SELECT period_bucket,
        count(*)::int AS mentions,
        count(DISTINCT COALESCE(NULLIF(raw_metadata->'row'->>'thread id', ''), id::text))::int
          AS conversations,
        count(*) FILTER (WHERE lower(COALESCE(NULLIF(content_type, ''),
          NULLIF(raw_metadata->'row'->>'specific type', ''), 'unknown')) <> 'comment')::int
          AS root_posts,
        count(*) FILTER (WHERE lower(COALESCE(NULLIF(content_type, ''),
          NULLIF(raw_metadata->'row'->>'specific type', ''), 'unknown')) = 'comment')::int
          AS comments,
        count(*) FILTER (WHERE sentiment_score > 0.2)::int AS positive,
        count(*) FILTER (WHERE sentiment_score BETWEEN -0.2 AND 0.2)::int AS neutral,
        count(*) FILTER (WHERE sentiment_score < -0.2)::int AS negative,
        count(*) FILTER (WHERE sentiment_score IS NOT NULL)::int AS classified
      FROM filtered GROUP BY period_bucket
    ), conversation_series AS (
      SELECT periods.period_start,
        COALESCE(rows.mentions, 0)::int AS mentions,
        COALESCE(rows.conversations, 0)::int AS conversations,
        COALESCE(rows.root_posts, 0)::int AS root_posts,
        COALESCE(rows.comments, 0)::int AS comments,
        COALESCE(rows.positive, 0)::int AS positive,
        COALESCE(rows.neutral, 0)::int AS neutral,
        COALESCE(rows.negative, 0)::int AS negative,
        COALESCE(rows.classified, 0)::int AS classified
      FROM periods LEFT JOIN conversation_rows rows
        ON rows.period_bucket = periods.period_start
    ), sentiment_buckets AS (
      SELECT CASE WHEN sentiment_score > 0.2 THEN 'positive'
        WHEN sentiment_score < -0.2 THEN 'negative' ELSE 'neutral' END AS key,
        count(*)::int AS mentions
      FROM filtered WHERE sentiment_score IS NOT NULL GROUP BY key
    ), platform_buckets AS (
      SELECT lower(COALESCE(resolved_platform, platform)) AS key, count(*)::int AS mentions
      FROM filtered WHERE COALESCE(resolved_platform, platform) IS NOT NULL GROUP BY key
    ), approved_assignment_links AS (
      SELECT filtered.id AS canonical_id, profile.kind, term.term_key,
        tagged_mention.id <> filtered.id AS resolved_from_alias
      FROM filtered
      JOIN record_tags tag
        ON tag.subject_type = 'mention'
       AND tag.review_status = 'approved'
      JOIN mentions tagged_mention
        ON tagged_mention.id = tag.subject_id
       AND tagged_mention.canonical_mention_id = filtered.id
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
       AND profile.model_version_id = tag.model_version_id
       AND profile.workspace_id = $2::uuid
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
    ), taxonomy_buckets AS (
      SELECT kind, term_key AS key, count(*)::int AS mentions
      FROM approved_results WHERE kind IN ('topic', 'narrative')
      GROUP BY kind, term_key
    ), emotion_buckets AS (
      SELECT lower(COALESCE(tag.value, term.label)) AS key,
        count(DISTINCT filtered.id)::int AS mentions
      FROM filtered
      JOIN mentions tagged_mention ON tagged_mention.canonical_mention_id = filtered.id
      JOIN record_tags tag ON tag.subject_type = 'mention'
        AND tag.subject_id = tagged_mention.id AND tag.review_status = 'approved'
      JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
      JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id AND taxonomy.status = 'active'
      WHERE lower(taxonomy.taxonomy_key) LIKE '%emotion%'
      GROUP BY lower(COALESCE(tag.value, term.label))
    )
    SELECT
      COALESCE((SELECT acceptance_status = 'included'
        AND allowed_scopes = ARRAY['primary_brand']::text[] FROM definition), false)
        AS primary_brand_contract,
      (SELECT count(*)::int FROM active_memberships) AS active_memberships,
      (SELECT count(*)::int FROM active_memberships mention
        WHERE mention.canonical_mention_id <> mention.id
          OR mention.inclusion_status <> mention.acceptance_status
          OR (mention.min_quality_score IS NOT NULL
            AND COALESCE(mention.quality_score, 0) < mention.min_quality_score)
          OR (mention.period_start IS NOT NULL
            AND mention.published_at::date < mention.period_start)
          OR (mention.period_end IS NOT NULL
            AND mention.published_at::date > mention.period_end)
          OR NOT EXISTS (
            SELECT 1 FROM signal_mention_attributions attribution
            WHERE attribution.workspace_id = mention.workspace_id
              AND attribution.mention_id = mention.id
              AND attribution.attribution_basis = 'mention_semantic'
              AND attribution.is_current
              AND attribution.review_status = 'approved'
              AND attribution.eligibility_status = 'eligible'
              AND attribution.scope = 'primary_brand'
              AND attribution.entity_type = 'brand'
              AND attribution.entity_id = mention.brand_id
          )) AS contract_violation_count,
      (SELECT count(*)::int FROM filtered) AS filtered_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(id::text, ',' ORDER BY id::text) FROM filtered
      ), ''), 'UTF8')), 'hex') AS canonical_ids_hash,
      (SELECT min(local_date)::text FROM filtered) AS period_start,
      (SELECT max(local_date)::text FROM filtered) AS period_end,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(period_start::text || ':' || mentions::text, ',' ORDER BY period_start)
        FROM nonempty_series
      ), ''), 'UTF8')), 'hex') AS series_hash,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(period_start::text || ':' || mentions::text, ',' ORDER BY period_start)
        FROM series
      ), ''), 'UTF8')), 'hex') AS filled_series_hash,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(period_start::text || ':' || mentions::text || ':'
          || conversations::text || ':' || root_posts::text || ':' || comments::text || ':'
          || positive::text || ':' || neutral::text || ':' || negative::text || ':'
          || classified::text, ',' ORDER BY period_start)
        FROM conversation_series
      ), ''), 'UTF8')), 'hex') AS conversation_series_hash,
      COALESCE((SELECT jsonb_object_agg(key, mentions ORDER BY key) FROM sentiment_buckets), '{}')
        AS sentiment_counts,
      COALESCE((SELECT jsonb_object_agg(key, mentions ORDER BY key) FROM platform_buckets), '{}')
        AS platform_counts,
      COALESCE((SELECT jsonb_object_agg(key, mentions ORDER BY key) FROM emotion_buckets), '{}')
        AS emotion_counts,
      COALESCE((SELECT jsonb_object_agg(key, mentions ORDER BY key)
        FROM taxonomy_buckets WHERE kind = 'topic'), '{}') AS topic_counts,
      COALESCE((SELECT jsonb_object_agg(key, mentions ORDER BY key)
        FROM taxonomy_buckets WHERE kind = 'narrative'), '{}') AS narrative_counts,
      (SELECT id::text FROM filtered ORDER BY published_at DESC, id DESC LIMIT 1)
        AS first_mention_id,
      (SELECT id::text FROM filtered ORDER BY published_at DESC, id DESC OFFSET 99 LIMIT 1)
        AS first_page_last_id,
      (SELECT id::text FROM filtered ORDER BY published_at DESC, id DESC OFFSET 100 LIMIT 1)
        AS next_page_first_id,
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
  `, independentFilter.params);
  return result.rows[0]!;
}

export async function loadLegacyDifferenceExplanation(args: {
  workspace: ResolvedSignalWorkspace;
  legacyCorpusId: string;
  populationId: string;
  filter: ReturnType<typeof normalizeSignalFilterV1>;
  queryable?: SignalServingQueryable;
  baseline?: "legacy_corpus" | "operational_v1";
}) {
  const result = await (args.queryable ?? pool).query<{
    legacy_only_count: number;
    governed_only_count: number;
    explained_legacy_count: number;
    unexplained_count: number;
    legacy_only_by_scope: Record<string, number>;
    legacy_only_by_reason: Record<string, number>;
    governed_only_by_reason: Record<string, number>;
  }>(`
    WITH definition AS (
      SELECT definition.*, workspace.brand_id
      FROM signal_population_definitions definition
      JOIN signal_workspaces workspace ON workspace.id = definition.workspace_id
      WHERE definition.id = $2::uuid AND definition.workspace_id = $3::uuid
    ), legacy AS (
      SELECT DISTINCT COALESCE(mention.canonical_mention_id, mention.id) AS mention_id
      FROM mentions mention
      WHERE $7 = 'legacy_corpus'
        AND mention.study_corpus_id = $1::uuid
        AND mention.inclusion_status = 'included'
        AND (mention.published_at AT TIME ZONE $4)::date >= $5::date
        AND (mention.published_at AT TIME ZONE $4)::date <= $6::date
      UNION
      SELECT membership.mention_id
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions current_definition
        ON current_definition.id = pointer.population_id
       AND current_definition.workspace_id = pointer.workspace_id
      JOIN signal_population_memberships membership
        ON membership.population_id = current_definition.id
       AND membership.workspace_id = current_definition.workspace_id
      JOIN mentions mention ON mention.id = membership.mention_id
      WHERE $7 = 'operational_v1'
        AND pointer.workspace_id = $3::uuid
        AND pointer.purpose = 'operational'
        AND current_definition.status = 'active'
        AND COALESCE(current_definition.definition->>'contract_version', '')
          <> 'signal-operational-primary-brand-semantic-v2'
        AND membership.membership_status = 'included'
        AND membership.removed_at IS NULL
        AND (mention.published_at AT TIME ZONE $4)::date >= $5::date
        AND (mention.published_at AT TIME ZONE $4)::date <= $6::date
    ), governed AS (
      SELECT membership.mention_id
      FROM signal_population_memberships membership
      JOIN mentions mention
        ON mention.id = membership.mention_id
       AND mention.workspace_id = membership.workspace_id
      WHERE membership.population_id = $2::uuid
        AND membership.workspace_id = $3::uuid
        AND membership.membership_status = 'included'
        AND membership.removed_at IS NULL
        AND (mention.published_at AT TIME ZONE $4)::date >= $5::date
        AND (mention.published_at AT TIME ZONE $4)::date <= $6::date
    ), legacy_only AS (
      SELECT legacy.mention_id FROM legacy
      WHERE NOT EXISTS (
        SELECT 1 FROM governed WHERE governed.mention_id = legacy.mention_id
      )
    ), governed_only AS (
      SELECT governed.mention_id FROM governed
      WHERE NOT EXISTS (
        SELECT 1 FROM legacy WHERE legacy.mention_id = governed.mention_id
      )
    ), classified AS (
      SELECT legacy_only.mention_id,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM signal_population_policy_compilations compilation
            JOIN signal_data_governance_evaluation_items item
              ON item.evaluation_id = compilation.governance_evaluation_id
             AND item.workspace_id = compilation.workspace_id
             AND item.mention_id = legacy_only.mention_id
            WHERE compilation.workspace_id = mention.workspace_id
              AND compilation.population_id = $2::uuid
              AND compilation.is_current
              AND item.decision = 'blocked'
              AND item.reason_code <> 'policy_eligible'
          ) THEN (
            SELECT item.reason_code
            FROM signal_population_policy_compilations compilation
            JOIN signal_data_governance_evaluation_items item
              ON item.evaluation_id = compilation.governance_evaluation_id
             AND item.workspace_id = compilation.workspace_id
             AND item.mention_id = legacy_only.mention_id
            WHERE compilation.workspace_id = mention.workspace_id
              AND compilation.population_id = $2::uuid
              AND compilation.is_current
              AND item.decision = 'blocked'
              AND item.reason_code <> 'policy_eligible'
            ORDER BY item.reason_code
            LIMIT 1
          )
          WHEN mention.canonical_mention_id = mention.id
            AND mention.inclusion_status = definition.acceptance_status
            AND (definition.min_quality_score IS NULL
              OR COALESCE(mention.quality_score, -1) >= definition.min_quality_score)
            AND (definition.period_start IS NULL
              OR (mention.published_at AT TIME ZONE $4)::date >= definition.period_start)
            AND (definition.period_end IS NULL
              OR (mention.published_at AT TIME ZONE $4)::date <= definition.period_end)
            AND EXISTS (
              SELECT 1 FROM signal_mention_attributions assertion
              WHERE assertion.workspace_id = mention.workspace_id
                AND assertion.mention_id = mention.id
                AND assertion.attribution_basis = 'mention_semantic'
                AND assertion.is_current
                AND assertion.review_status = 'approved'
                AND assertion.eligibility_status = 'eligible'
                AND assertion.scope = 'primary_brand'
                AND assertion.entity_type = 'brand'
                AND assertion.entity_id = definition.brand_id
            ) THEN 'unexplained_policy_eligible_missing_membership'
          WHEN mention.inclusion_status <> definition.acceptance_status
            THEN 'acceptance_not_included'
          WHEN definition.min_quality_score IS NOT NULL
            AND COALESCE(mention.quality_score, -1) < definition.min_quality_score
            THEN 'quality_not_eligible'
          WHEN (definition.period_start IS NOT NULL
              AND (mention.published_at AT TIME ZONE $4)::date < definition.period_start)
            OR (definition.period_end IS NOT NULL
              AND (mention.published_at AT TIME ZONE $4)::date > definition.period_end)
            THEN 'period_not_eligible'
          WHEN EXISTS (
            SELECT 1 FROM signal_mention_attributions assertion
            WHERE assertion.workspace_id = mention.workspace_id
              AND assertion.mention_id = mention.id
              AND assertion.attribution_basis = 'mention_semantic'
              AND assertion.is_current
              AND assertion.scope = 'primary_brand'
              AND assertion.entity_type = 'brand'
              AND assertion.entity_id = definition.brand_id
              AND assertion.review_status = 'rejected'
          ) THEN 'semantic_primary_rejected'
          WHEN EXISTS (
            SELECT 1 FROM signal_mention_attributions assertion
            WHERE assertion.workspace_id = mention.workspace_id
              AND assertion.mention_id = mention.id
              AND assertion.attribution_basis = 'mention_semantic'
              AND assertion.is_current
              AND assertion.scope = 'primary_brand'
              AND assertion.entity_type = 'brand'
              AND assertion.entity_id = definition.brand_id
          ) THEN 'semantic_primary_not_eligible'
          WHEN EXISTS (
            SELECT 1 FROM signal_mention_attributions assertion
            WHERE assertion.workspace_id = mention.workspace_id
              AND assertion.mention_id = mention.id
              AND assertion.attribution_basis = 'mention_semantic'
              AND assertion.is_current
              AND assertion.scope = 'competitor'
          ) THEN 'semantic_scope_competitor'
          WHEN EXISTS (
            SELECT 1 FROM signal_mention_attributions assertion
            WHERE assertion.workspace_id = mention.workspace_id
              AND assertion.mention_id = mention.id
              AND assertion.attribution_basis = 'mention_semantic'
              AND assertion.is_current
              AND assertion.scope = 'category'
          ) THEN 'semantic_scope_category'
          WHEN EXISTS (
            SELECT 1 FROM signal_mention_attributions assertion
            WHERE assertion.workspace_id = mention.workspace_id
              AND assertion.mention_id = mention.id
              AND assertion.attribution_basis = 'mention_semantic'
              AND assertion.is_current
              AND assertion.scope = 'reference'
          ) THEN 'semantic_scope_reference'
          WHEN EXISTS (
            SELECT 1 FROM signal_mention_attributions assertion
            WHERE assertion.workspace_id = mention.workspace_id
              AND assertion.mention_id = mention.id
              AND assertion.attribution_basis = 'mention_semantic'
              AND assertion.is_current
              AND assertion.scope = 'unattributed'
          ) THEN 'semantic_scope_unattributed'
          ELSE 'semantic_missing_or_unreviewed'
        END AS reason
      FROM legacy_only
      JOIN mentions mention ON mention.id = legacy_only.mention_id
      JOIN definition ON true
    ), reason_counts AS (
      SELECT reason, count(*)::int AS records
      FROM classified GROUP BY reason
    ), scope_counts AS (
      SELECT COALESCE(attribution.scope, 'unattributed') AS scope,
        count(DISTINCT legacy_only.mention_id)::int AS records
      FROM legacy_only
      LEFT JOIN signal_mention_attributions attribution
       ON attribution.workspace_id = $3::uuid
       AND attribution.mention_id = legacy_only.mention_id
       AND attribution.attribution_basis = 'mention_semantic'
       AND attribution.is_current
      GROUP BY COALESCE(attribution.scope, 'unattributed')
    )
    SELECT
      (SELECT count(*)::int FROM legacy_only) AS legacy_only_count,
      (SELECT count(*)::int FROM governed_only) AS governed_only_count,
      (SELECT count(*)::int FROM classified
        WHERE reason <> 'unexplained_policy_eligible_missing_membership')
        AS explained_legacy_count,
      (SELECT count(*)::int FROM classified
        WHERE reason = 'unexplained_policy_eligible_missing_membership')
        AS unexplained_count,
      COALESCE((SELECT jsonb_object_agg(scope, records ORDER BY scope) FROM scope_counts), '{}')
        AS legacy_only_by_scope,
      COALESCE((SELECT jsonb_object_agg(reason, records ORDER BY reason) FROM reason_counts), '{}')
        AS legacy_only_by_reason,
      CASE WHEN (SELECT count(*) FROM governed_only) = 0 THEN '{}'::jsonb
        ELSE jsonb_build_object(
          'semantic_primary_brand_not_in_legacy',
          (SELECT count(*)::int FROM governed_only)
        ) END AS governed_only_by_reason
  `, [
    args.legacyCorpusId,
    args.populationId,
    args.workspace.id,
    args.workspace.timezone,
    args.filter.date_range.start,
    args.filter.date_range.end,
    args.baseline ?? "legacy_corpus"
  ]);
  return {
    ...result.rows[0]!
  };
}

export async function loadGovernedMentionPageBaseline(args: {
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  limit: number;
  offset: number;
  sort: {
    field: "published" | "platform" | "conversation_role" | "engagement";
    direction: "asc" | "desc";
  };
  cursor?: { occurred_at: string; subject_id: string } | null;
}) {
  const independentFilter = independentGovernedFilterSql(args.filter, args.workspace.id, [
    args.populationId,
    args.workspace.id,
    args.workspace.timezone,
    args.filter.date_range.start,
    args.filter.date_range.end
  ]);
  const params = independentFilter.params;
  const direction = args.sort.direction === "asc" ? "ASC" : "DESC";
  const interactions = ["likes", "comments", "shares", "reposts", "saves"]
    .map((key) => `CASE WHEN COALESCE(mention.engagement->>'${key}', '')
      ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN (mention.engagement->>'${key}')::numeric ELSE 0 END`)
    .join(" + ");
  const orderBy = args.sort.field === "platform"
    ? `lower(COALESCE(mention.resolved_platform, mention.platform, '')) ${direction},
      mention.published_at DESC, mention.id DESC`
    : args.sort.field === "conversation_role"
      ? `CASE WHEN lower(COALESCE(NULLIF(mention.content_type, ''),
          NULLIF(mention.raw_metadata->'row'->>'specific type', ''), 'unknown')) = 'comment'
          THEN 'comment' ELSE 'root_post' END ${direction}, mention.published_at DESC, mention.id DESC`
      : args.sort.field === "engagement"
        ? `(${interactions}) ${direction}, mention.published_at DESC, mention.id DESC`
        : `mention.published_at ${direction}, mention.id ${direction}`;
  let cursorSql = "";
  if (args.cursor) {
    params.push(args.cursor.occurred_at, args.cursor.subject_id);
    cursorSql = `AND (mention.published_at, mention.id) <
      ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(args.limit + 1, args.offset);
  const result = await pool.query<{ id: string; total_count: number }>(`
    SELECT mention.id::text AS id, count(*) OVER()::int AS total_count
    FROM signal_population_memberships membership
    JOIN mentions mention ON mention.id = membership.mention_id
      AND mention.workspace_id = membership.workspace_id
      AND mention.canonical_mention_id = mention.id
    WHERE membership.population_id = $1::uuid
      AND membership.workspace_id = $2::uuid
      AND membership.membership_status = 'included'
      AND membership.removed_at IS NULL
      AND (mention.published_at AT TIME ZONE $3)::date >= $4::date
      AND (mention.published_at AT TIME ZONE $3)::date <= $5::date
      ${independentFilter.conditions.length
        ? `AND ${independentFilter.conditions.join("\n      AND ")}`
        : ""}
      ${cursorSql}
    ORDER BY ${orderBy}
    LIMIT $${params.length - 1}::int OFFSET $${params.length}::int
  `, params);
  return {
    total_count: result.rows[0]?.total_count ?? 0,
    ids: result.rows.slice(0, args.limit).map((row) => row.id),
    has_next: result.rows.length > args.limit
  };
}

function moduleShadowFilter(
  workspace: ResolvedSignalWorkspace,
  governed: { earliest: string | null; latest: string | null },
  legacy: { period_start: string | null; period_end: string | null }
) {
  const today = new Date().toISOString().slice(0, 10);
  const starts = [governed.earliest, legacy.period_start]
    .filter((value): value is string => Boolean(value))
    .sort();
  const ends = [governed.latest, legacy.period_end]
    .filter((value): value is string => Boolean(value))
    .sort();
  return normalizeSignalFilterV1({
    date_range: {
      start: starts.at(0) ?? today,
      end: ends.at(-1) ?? today
    },
    timezone: workspace.timezone,
    granularity: "day",
    dimensions: {}
  });
}

function independentGovernedFilterSql(
  filter: SignalFilterV1,
  workspaceId: string,
  initialParams: unknown[]
) {
  const params = [...initialParams];
  const conditions: string[] = [];
  const parameter = (value: unknown, cast = "") => {
    params.push(value);
    return `$${params.length}${cast}`;
  };
  const search = filter.search_query ?? filter.text_search;
  if (search) {
    const fullText = parameter(search);
    const like = parameter(`%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
    conditions.push(`(
      to_tsvector('simple', concat_ws(' ', COALESCE(mention.title, ''),
        COALESCE(mention.text_clean, ''), COALESCE(mention.text_snippet, '')))
        @@ websearch_to_tsquery('simple', ${fullText})
      OR concat_ws(' ', NULLIF(mention.title, ''), NULLIF(mention.text_clean, ''),
        NULLIF(mention.text_snippet, '')) ILIKE ${like} ESCAPE '\\'
    )`);
  }
  for (const [dimension, values] of Object.entries(filter.dimensions) as Array<[SignalDimensionV1, string[]]>) {
    if (!values.length) continue;
    const expected = parameter(values, "::text[]");
    const simple: Partial<Record<SignalDimensionV1, string>> = {
      platform: "lower(COALESCE(mention.resolved_platform, mention.platform))",
      source_type: "lower(mention.source_system)",
      country: "lower(mention.country)",
      language: "lower(mention.language)",
      content_format: `lower(COALESCE(NULLIF(mention.content_type, ''),
        NULLIF(mention.raw_metadata->'row'->>'specific type', ''), 'unknown'))`,
      conversation_role: `CASE WHEN lower(COALESCE(NULLIF(mention.content_type, ''),
        NULLIF(mention.raw_metadata->'row'->>'specific type', ''), 'unknown')) = 'comment'
        THEN 'comment' ELSE 'root_post' END`,
      product: "lower(mention.batch_entity_label)",
      sentiment_polarity: `CASE WHEN mention.sentiment_score > 0.2 THEN 'positive'
        WHEN mention.sentiment_score < -0.2 THEN 'negative'
        WHEN mention.sentiment_score IS NULL THEN NULL ELSE 'neutral' END`
    };
    if (simple[dimension]) {
      conditions.push(`${simple[dimension]} = ANY(${expected})`);
      continue;
    }
    if (dimension === "corpus_scope") {
      throw new Error("governed_primary_population_does_not_accept_corpus_scope_filter");
    }
    if (dimension === "entity") {
      conditions.push(`EXISTS (
        SELECT 1 FROM record_entity_links relation
        JOIN mentions attributed_mention ON attributed_mention.id = relation.subject_id
          AND attributed_mention.workspace_id = mention.workspace_id
          AND attributed_mention.canonical_mention_id = mention.id
        JOIN intelligence_entities entity ON entity.id = relation.entity_id
          AND entity.status = 'active'
        WHERE relation.subject_type = 'mention'
          AND lower(entity.canonical_name) = ANY(${expected})
      )`);
      continue;
    }
    if (dimension === "topic" || dimension === "narrative") {
      const workspace = parameter(workspaceId, "::uuid");
      conditions.push(`EXISTS (
        SELECT 1 FROM record_tags tag
        JOIN mentions tagged_mention ON tagged_mention.id = tag.subject_id
          AND tagged_mention.workspace_id = mention.workspace_id
          AND tagged_mention.canonical_mention_id = mention.id
        JOIN signal_taxonomy_profiles profile ON profile.id = tag.signal_taxonomy_profile_id
          AND profile.model_version_id = tag.model_version_id
          AND profile.workspace_id = ${workspace} AND profile.kind = '${dimension}'
          AND profile.status = 'active'
        JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id
          AND term.taxonomy_id = profile.taxonomy_id AND term.status = 'active'
        WHERE tag.subject_type = 'mention' AND tag.review_status = 'approved'
          AND (lower(term.term_key) = ANY(${expected})
            OR lower(COALESCE(tag.value, term.label)) = ANY(${expected}))
      )`);
      continue;
    }
    const taxonomyDimensions = new Set<SignalDimensionV1>([
      "taxonomy", "trigger", "barrier", "emotion"
    ]);
    if (taxonomyDimensions.has(dimension)) {
      conditions.push(`EXISTS (
        SELECT 1 FROM record_tags tag
        JOIN mentions tagged_mention ON tagged_mention.id = tag.subject_id
          AND tagged_mention.workspace_id = mention.workspace_id
          AND tagged_mention.canonical_mention_id = mention.id
        JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
        JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id AND taxonomy.status = 'active'
        WHERE tag.subject_type = 'mention' AND tag.review_status = 'approved'
          AND (lower(term.term_key) = ANY(${expected})
            OR lower(COALESCE(tag.value, term.label)) = ANY(${expected}))
          ${dimension === "taxonomy" ? "" : `AND lower(taxonomy.taxonomy_key) LIKE '%${dimension}%'`}
      )`);
      continue;
    }
    if (dimension === "tb_polarity" || dimension === "tb_layer" || dimension === "observed_signal") {
      const codingValue = dimension === "tb_polarity"
        ? "lower(coding.item->>'polarity')"
        : dimension === "tb_layer"
          ? "lower(coding.item->>'layer')"
          : "lower(observed.value)";
      const observedJoin = dimension === "observed_signal"
        ? "CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(coding.item->'emergent_tags', '[]'::jsonb)) observed(value)"
        : "";
      conditions.push(`EXISTS (
        SELECT 1 FROM record_feature_values feature
        JOIN mentions coding_mention ON coding_mention.id = feature.subject_id
          AND coding_mention.workspace_id = mention.workspace_id
          AND coding_mention.canonical_mention_id = mention.id
        JOIN tb_analyses analysis ON analysis.id = feature.tb_analysis_id
          AND analysis.study_corpus_id = coding_mention.study_corpus_id
          AND analysis.status IN ('approved_by_im', 'approved_by_kam')
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(feature.feature_value->'codings', '[]'::jsonb)) coding(item)
        ${observedJoin}
        WHERE feature.subject_type = 'mention' AND feature.feature_key = 'tb_coding'
          AND ${codingValue} = ANY(${expected})
      )`);
      continue;
    }
    const featureKey = dimension === "campaign" ? "campaign" : dimension;
    conditions.push(`EXISTS (
      SELECT 1 FROM record_feature_values feature
      JOIN mentions feature_mention ON feature_mention.id = feature.subject_id
        AND feature_mention.workspace_id = mention.workspace_id
        AND feature_mention.canonical_mention_id = mention.id
      WHERE feature.subject_type = 'mention' AND feature.feature_key = '${featureKey}'
        AND lower(trim(both '"' from feature.feature_value::text)) = ANY(${expected})
    )`);
  }
  return { conditions, params };
}

function periodBucketStart(date: string, granularity: SignalFilterV1["granularity"]) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (granularity === "week") {
    const day = value.getUTCDay();
    value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  } else if (granularity === "month") {
    value.setUTCDate(1);
  }
  return value.toISOString().slice(0, 10);
}
