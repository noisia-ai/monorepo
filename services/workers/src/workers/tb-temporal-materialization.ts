import type { PoolClient } from "pg";

import {
  buildTbTemporalSemanticKeyV1,
  compareTbTemporalFindingV1,
  evaluateTbComparisonCompatibilityV1,
  matchTbTemporalFindingsV1,
  type TbRunScopeV1,
  type TbTemporalFindingV1
} from "@noisia/query-engine";

type RunScopeRow = {
  id: string;
  workspace_subject_key: string;
  study_corpus_id: string;
  corpus_revision: number | null;
  snapshot_id: string;
  snapshot_digest: string | null;
  snapshot_mention_count: number | null;
  period_start: string | null;
  period_end: string | null;
  methodology_slug: string | null;
  methodology_version: string;
  pipeline_version: string;
  prompt_version: string | null;
  model_version: string | null;
};

type FindingRow = {
  id: string;
  finding_id: string;
  polarity: "trigger" | "barrier" | "mixed";
  layer: string;
  nombre_comercial: string;
  frecuencia: number;
  intensidad_promedio: string | null;
  capacidad_predictiva: string | null;
  denominator: string;
  raw_data: unknown;
  evidence_count: number;
};

export type TbTemporalMaterializationResult = {
  metrics: number;
  comparisons: number;
  comparisonBaseAnalysisId: string | null;
  compatibilityState: "not_evaluated" | "compatible" | "incompatible";
  compatibilityReasons: string[];
};

export async function materializeTbTemporalAnalysis(
  client: PoolClient,
  tbAnalysisId: string
): Promise<TbTemporalMaterializationResult> {
  const currentRow = (await client.query<RunScopeRow>(RUN_SCOPE_SQL, [tbAnalysisId])).rows[0];
  if (!currentRow) throw new Error("tb_temporal_analysis_not_found");
  const currentScope = runScope(currentRow);

  const previousRows = (await client.query<RunScopeRow>(PREVIOUS_SCOPE_SQL, [tbAnalysisId])).rows;
  let comparisonBase: RunScopeRow | null = null;
  let compatibilityState: TbTemporalMaterializationResult["compatibilityState"] = "not_evaluated";
  let compatibilityReasons: string[] = [];
  for (const candidate of previousRows) {
    const compatibility = evaluateTbComparisonCompatibilityV1(currentScope, runScope(candidate));
    if (compatibility.compatible) {
      comparisonBase = candidate;
      compatibilityState = "compatible";
      compatibilityReasons = [];
      break;
    }
    if (compatibilityState === "not_evaluated") {
      compatibilityState = "incompatible";
      compatibilityReasons = compatibility.reasons;
    }
  }

  await client.query(`DELETE FROM tb_temporal_metrics WHERE tb_analysis_id = $1::uuid`, [tbAnalysisId]);
  await client.query(`DELETE FROM tb_finding_temporal_comparisons WHERE tb_analysis_id = $1::uuid`, [tbAnalysisId]);
  const metricResult = await client.query(MATERIALIZE_METRICS_SQL, [tbAnalysisId]);

  const currentFindings = await loadTemporalFindings(client, tbAnalysisId);
  const previousFindings = comparisonBase
    ? await loadTemporalFindings(client, comparisonBase.id)
    : [];
  const matches = matchTbTemporalFindingsV1(currentFindings, previousFindings);
  let comparisons = 0;
  for (const match of matches) {
    const comparison = compareTbTemporalFindingV1(match);
    const semanticKey = match.current?.semantic_key ?? match.previous?.semantic_key;
    if (!semanticKey) continue;
    await client.query(
      `INSERT INTO tb_finding_temporal_comparisons (
         tb_analysis_id, comparison_base_analysis_id,
         current_finding_id, previous_finding_id, semantic_key,
         movement, reason, current_values, previous_values, deltas,
         similarity, quality_state, quality_reasons
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
         $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
         $11, $12, $13::jsonb
       )
       ON CONFLICT (tb_analysis_id, semantic_key) DO UPDATE SET
         comparison_base_analysis_id = EXCLUDED.comparison_base_analysis_id,
         current_finding_id = EXCLUDED.current_finding_id,
         previous_finding_id = EXCLUDED.previous_finding_id,
         movement = EXCLUDED.movement,
         reason = EXCLUDED.reason,
         current_values = EXCLUDED.current_values,
         previous_values = EXCLUDED.previous_values,
         deltas = EXCLUDED.deltas,
         similarity = EXCLUDED.similarity,
         quality_state = EXCLUDED.quality_state,
         quality_reasons = EXCLUDED.quality_reasons,
         computed_at = NOW()`,
      [
        tbAnalysisId,
        comparisonBase?.id ?? null,
        match.current?.id ?? null,
        match.previous?.id ?? null,
        semanticKey,
        comparison.movement,
        comparison.reason,
        JSON.stringify(findingValues(match.current)),
        JSON.stringify(findingValues(match.previous)),
        JSON.stringify({
          current_share: comparison.current_share,
          previous_share: comparison.previous_share,
          share_delta: comparison.share_delta
        }),
        comparison.similarity,
        comparison.quality_state,
        JSON.stringify(comparison.quality_state === "pass" ? [] : [comparison.reason])
      ]
    );
    comparisons += 1;
  }

  await client.query(
    `UPDATE tb_analyses
     SET comparison_base_analysis_id = $2::uuid,
         comparison_compatibility_state = $3,
         comparison_compatibility = $4::jsonb,
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [
      tbAnalysisId,
      comparisonBase?.id ?? null,
      compatibilityState,
      JSON.stringify({
        contract_version: "tb-temporal-v1",
        compatible: compatibilityState === "compatible",
        reasons: compatibilityReasons,
        evaluated_at: new Date().toISOString()
      })
    ]
  );

  return {
    metrics: metricResult.rowCount ?? 0,
    comparisons,
    comparisonBaseAnalysisId: comparisonBase?.id ?? null,
    compatibilityState,
    compatibilityReasons
  };
}

const RUN_SCOPE_SQL = `
  SELECT
    analysis.id::text,
    CASE
      WHEN corpus.brand_id IS NOT NULL THEN 'brand:' || corpus.brand_id::text
      ELSE 'theme:' || corpus.theme_id::text
    END AS workspace_subject_key,
    analysis.study_corpus_id::text,
    analysis.corpus_revision,
    analysis.snapshot_id::text,
    analysis.snapshot_digest,
    analysis.snapshot_mention_count,
    analysis.period_start::text,
    analysis.period_end::text,
    analysis.methodology_slug,
    analysis.methodology_version,
    analysis.pipeline_version,
    analysis.prompt_version,
    analysis.model_version
  FROM tb_analyses analysis
  JOIN study_corpora corpus ON corpus.id = analysis.study_corpus_id
  WHERE analysis.id = $1::uuid
`;

const PREVIOUS_SCOPE_SQL = `
  WITH current_scope AS (
    SELECT
      current_analysis.id,
      current_analysis.period_start,
      current_corpus.brand_id,
      current_corpus.theme_id
    FROM tb_analyses current_analysis
    JOIN study_corpora current_corpus ON current_corpus.id = current_analysis.study_corpus_id
    WHERE current_analysis.id = $1::uuid
  )
  SELECT
    analysis.id::text,
    CASE
      WHEN corpus.brand_id IS NOT NULL THEN 'brand:' || corpus.brand_id::text
      ELSE 'theme:' || corpus.theme_id::text
    END AS workspace_subject_key,
    analysis.study_corpus_id::text,
    analysis.corpus_revision,
    analysis.snapshot_id::text,
    analysis.snapshot_digest,
    analysis.snapshot_mention_count,
    analysis.period_start::text,
    analysis.period_end::text,
    analysis.methodology_slug,
    analysis.methodology_version,
    analysis.pipeline_version,
    analysis.prompt_version,
    analysis.model_version
  FROM tb_analyses analysis
  JOIN study_corpora corpus ON corpus.id = analysis.study_corpus_id
  CROSS JOIN current_scope
  WHERE analysis.id <> current_scope.id
    AND analysis.status IN ('approved_by_im', 'approved_by_kam')
    AND analysis.scope_frozen_at IS NOT NULL
    AND (
      corpus.brand_id IS NOT DISTINCT FROM current_scope.brand_id
      AND corpus.theme_id IS NOT DISTINCT FROM current_scope.theme_id
    )
    AND analysis.period_end < current_scope.period_start
  ORDER BY analysis.period_end DESC, analysis.scope_frozen_at DESC, analysis.id
  LIMIT 12
`;

const MATERIALIZE_METRICS_SQL = `
  WITH analysis_scope AS (
    SELECT
      analysis.id AS tb_analysis_id,
      analysis.snapshot_id,
      analysis.corpus_revision,
      analysis.period_start,
      analysis.period_end
    FROM tb_analyses analysis
    WHERE analysis.id = $1::uuid
  ),
  base_mentions AS (
    SELECT
      analysis_scope.tb_analysis_id,
      analysis_scope.snapshot_id,
      analysis_scope.corpus_revision,
      analysis_scope.period_start,
      analysis_scope.period_end,
      snapshot_mention.mention_id,
      COALESCE(mention.resolved_platform, mention.platform) AS platform,
      COALESCE(batch.entity_kind, batch.mention_type, 'unknown') AS entity_type,
      COALESCE(batch.competitor_id::text, batch.corpus_entity_id::text, batch.entity_label) AS entity_key
    FROM analysis_scope
    JOIN corpus_snapshot_mentions snapshot_mention
      ON snapshot_mention.snapshot_id = analysis_scope.snapshot_id
    JOIN mentions mention ON mention.id = snapshot_mention.mention_id
    LEFT JOIN import_batches batch ON batch.id = mention.source_file_id
  ),
  denominators AS (
    SELECT
      tb_analysis_id,
      CASE
        WHEN GROUPING(platform) = 0 THEN 'platform'
        WHEN GROUPING(entity_type) = 0 THEN 'entity'
        ELSE 'default'
      END AS dimension_kind,
      CASE WHEN GROUPING(platform) = 0 THEN platform END AS platform,
      CASE WHEN GROUPING(entity_type) = 0 THEN entity_type END AS entity_type,
      CASE WHEN GROUPING(entity_key) = 0 THEN entity_key END AS entity_key,
      COUNT(DISTINCT mention_id)::integer AS denominator_count
    FROM base_mentions
    GROUP BY GROUPING SETS (
      (tb_analysis_id),
      (tb_analysis_id, platform),
      (tb_analysis_id, entity_type, entity_key)
    )
    HAVING
      GROUPING(platform) = 1
      OR platform IS NOT NULL
  ),
  scoped AS (
    SELECT
      base.tb_analysis_id,
      base.snapshot_id,
      base.corpus_revision,
      base.period_start,
      base.period_end,
      finding.id AS tb_finding_id,
      finding.finding_id AS finding_key,
      finding.polarity,
      finding.layer,
      finding.capacidad_predictiva,
      base.platform,
      base.entity_type,
      base.entity_key,
      coding.mention_id,
      coding.intensity_score
    FROM base_mentions base
    JOIN tb_findings finding ON finding.tb_analysis_id = base.tb_analysis_id
    JOIN tb_mention_codings coding
      ON coding.tb_analysis_id = base.tb_analysis_id
     AND coding.finding_id = finding.id
     AND coding.mention_id = base.mention_id
    WHERE coding.polarity <> 'irrelevant'
  ),
  grouped AS (
    SELECT
      tb_analysis_id,
      snapshot_id,
      corpus_revision,
      period_start,
      period_end,
      tb_finding_id,
      finding_key,
      polarity,
      layer,
      capacidad_predictiva,
      CASE
        WHEN GROUPING(platform) = 0 THEN 'platform'
        WHEN GROUPING(entity_type) = 0 THEN 'entity'
        ELSE 'default'
      END AS dimension_kind,
      CASE WHEN GROUPING(platform) = 0 THEN platform END AS platform,
      CASE WHEN GROUPING(entity_type) = 0 THEN entity_type END AS entity_type,
      CASE WHEN GROUPING(entity_key) = 0 THEN entity_key END AS entity_key,
      COUNT(DISTINCT mention_id)::integer AS mention_count,
      AVG(intensity_score)::numeric AS average_intensity
    FROM scoped
    GROUP BY GROUPING SETS (
      (
        tb_analysis_id, snapshot_id, corpus_revision, period_start, period_end,
        tb_finding_id, finding_key, polarity, layer,
        capacidad_predictiva
      ),
      (
        tb_analysis_id, snapshot_id, corpus_revision, period_start, period_end,
        tb_finding_id, finding_key, polarity, layer,
        capacidad_predictiva, platform
      ),
      (
        tb_analysis_id, snapshot_id, corpus_revision, period_start, period_end,
        tb_finding_id, finding_key, polarity, layer,
        capacidad_predictiva, entity_type, entity_key
      )
    )
    HAVING
      GROUPING(platform) = 1
      OR platform IS NOT NULL
  ),
  governed AS (
    SELECT grouped.*, denominators.denominator_count
    FROM grouped
    JOIN denominators
      ON denominators.tb_analysis_id = grouped.tb_analysis_id
     AND denominators.dimension_kind = grouped.dimension_kind
     AND denominators.platform IS NOT DISTINCT FROM grouped.platform
     AND denominators.entity_type IS NOT DISTINCT FROM grouped.entity_type
     AND denominators.entity_key IS NOT DISTINCT FROM grouped.entity_key
  ),
  expanded AS (
    SELECT governed.*, metric.metric_key
    FROM governed
    CROSS JOIN (
      VALUES
        ('finding.frequency'::text),
        ('finding.share'::text),
        ('finding.intensity'::text),
        ('finding.predictive_capacity'::text)
    ) metric(metric_key)
  )
  INSERT INTO tb_temporal_metrics (
    tb_analysis_id, tb_finding_id, materialization_key, metric_key, metric_version,
    period_start, period_end, platform, entity_type, entity_key,
    polarity, layer, finding_key, dimensions,
    value, denominator, sample_size, quality_state, quality_reasons,
    snapshot_id, corpus_revision, computed_at
  )
  SELECT
    tb_analysis_id,
    tb_finding_id,
    'tbm:v1:' || md5(concat_ws(
      '|', tb_analysis_id::text, metric_key, finding_key,
      dimension_kind,
      COALESCE(platform, ''), COALESCE(entity_type, ''), COALESCE(entity_key, '')
    )),
    metric_key,
    1,
    period_start,
    period_end,
    platform,
    entity_type,
    entity_key,
    polarity,
    layer,
    finding_key,
    jsonb_strip_nulls(jsonb_build_object(
      'grain', dimension_kind,
      'platform', platform,
      'entity_type', entity_type,
      'entity_key', entity_key,
      'polarity', polarity,
      'layer', layer,
      'finding', finding_key
    )),
    CASE metric_key
      WHEN 'finding.frequency' THEN mention_count::numeric
      WHEN 'finding.share' THEN
        CASE WHEN denominator_count > 0 THEN mention_count::numeric / denominator_count END
      WHEN 'finding.intensity' THEN average_intensity
      WHEN 'finding.predictive_capacity' THEN capacidad_predictiva
    END,
    CASE metric_key
      WHEN 'finding.share' THEN denominator_count::numeric
      ELSE mention_count::numeric
    END,
    mention_count,
    CASE
      WHEN metric_key = 'finding.predictive_capacity' AND capacidad_predictiva IS NULL THEN 'not_available'
      WHEN metric_key = 'finding.intensity' AND average_intensity IS NULL THEN 'not_available'
      WHEN mention_count < 3 THEN 'partial'
      ELSE 'pass'
    END,
    CASE
      WHEN metric_key = 'finding.predictive_capacity' AND capacidad_predictiva IS NULL
        THEN '["predictive_capacity_missing"]'::jsonb
      WHEN metric_key = 'finding.intensity' AND average_intensity IS NULL
        THEN '["intensity_missing"]'::jsonb
      WHEN mention_count < 3 THEN '["low_evidence_count"]'::jsonb
      ELSE '[]'::jsonb
    END,
    snapshot_id,
    corpus_revision,
    NOW()
  FROM expanded
  ON CONFLICT (materialization_key) DO UPDATE SET
    value = EXCLUDED.value,
    denominator = EXCLUDED.denominator,
    sample_size = EXCLUDED.sample_size,
    quality_state = EXCLUDED.quality_state,
    quality_reasons = EXCLUDED.quality_reasons,
    computed_at = EXCLUDED.computed_at
`;

async function loadTemporalFindings(
  client: PoolClient,
  tbAnalysisId: string
): Promise<TbTemporalFindingV1[]> {
  const result = await client.query<FindingRow>(
    `WITH canonical_metrics AS (
       SELECT
         metric.tb_finding_id,
         MAX(metric.value) FILTER (WHERE metric.metric_key = 'finding.frequency') AS frequency,
         MAX(metric.value) FILTER (WHERE metric.metric_key = 'finding.intensity') AS intensity,
         MAX(metric.value) FILTER (
           WHERE metric.metric_key = 'finding.predictive_capacity'
         ) AS predictive_capacity,
         MAX(metric.denominator) FILTER (WHERE metric.metric_key = 'finding.share') AS denominator
       FROM tb_temporal_metrics metric
       WHERE metric.tb_analysis_id = $1::uuid
         AND metric.dimensions ->> 'grain' = 'default'
       GROUP BY metric.tb_finding_id
     )
     SELECT
       finding.id::text,
       finding.finding_id,
       finding.polarity,
       finding.layer,
       finding.nombre_comercial,
       canonical.frequency::integer AS frecuencia,
       canonical.intensity::text AS intensidad_promedio,
       canonical.predictive_capacity::text AS capacidad_predictiva,
       canonical.denominator::text AS denominator,
       finding.raw_data,
       (
         SELECT COUNT(*)
         FROM (
           SELECT citation.mention_id::text AS evidence_id
           FROM tb_finding_citations citation
           WHERE citation.finding_id = finding.id
           UNION
           SELECT ref.reference_token
           FROM tb_finding_structured_evidence_refs ref
           WHERE ref.finding_id = finding.id
             AND ref.evidence_role = 'claim_specific'
         ) evidence
       )::integer AS evidence_count
     FROM tb_findings finding
     JOIN canonical_metrics canonical ON canonical.tb_finding_id = finding.id
     WHERE finding.tb_analysis_id = $1::uuid
     ORDER BY finding.finding_id`,
    [tbAnalysisId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    semantic_key: buildTbTemporalSemanticKeyV1({
      polarity: row.polarity,
      layer: row.layer,
      title: row.nombre_comercial,
      member_tags: memberTags(row.raw_data)
    }),
    title: row.nombre_comercial,
    polarity: row.polarity,
    layer: row.layer,
    frequency: Number(row.frecuencia),
    denominator: Number(row.denominator),
    intensity: numericOrNull(row.intensidad_promedio),
    predictive_capacity: numericOrNull(row.capacidad_predictiva),
    evidence_count: Number(row.evidence_count)
  }));
}

function runScope(row: RunScopeRow): TbRunScopeV1 {
  if (
    row.corpus_revision === null
    || row.snapshot_digest === null
    || row.snapshot_mention_count === null
    || row.period_start === null
    || row.period_end === null
    || row.methodology_slug !== "triggers-barriers"
    || row.prompt_version === null
    || row.model_version === null
  ) {
    throw new Error("tb_temporal_scope_incomplete");
  }
  return {
    contract_version: "tb-temporal-v1",
    workspace_subject_key: row.workspace_subject_key,
    corpus_id: row.study_corpus_id,
    corpus_revision: row.corpus_revision,
    snapshot_id: row.snapshot_id,
    snapshot_digest: row.snapshot_digest,
    snapshot_mention_count: row.snapshot_mention_count,
    period_start: row.period_start,
    period_end: row.period_end,
    methodology_slug: row.methodology_slug,
    methodology_version: row.methodology_version,
    pipeline_version: row.pipeline_version,
    prompt_version: row.prompt_version,
    model_version: row.model_version
  };
}

function findingValues(finding: TbTemporalFindingV1 | null) {
  return finding
    ? {
        finding_id: finding.id,
        semantic_key: finding.semantic_key,
        frequency: finding.frequency,
        denominator: finding.denominator,
        intensity: finding.intensity,
        predictive_capacity: finding.predictive_capacity,
        evidence_count: finding.evidence_count
      }
    : {};
}

function memberTags(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const tags = (value as { member_tags?: unknown }).member_tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
}

function numericOrNull(value: string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
