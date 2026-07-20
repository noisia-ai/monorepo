import { pool } from "@/lib/db";
import { SIGNAL_SERVING_CONTRACT_VERSION } from "@/lib/signal/semantics";

export type PublishedCorpusExplorerFilters = {
  q: string;
  platform: string;
  finding: string;
  tag: string;
  feature: string;
  entity: string;
  evidenceRole: "" | "protagonist" | "support" | "counter";
  dateFrom: string;
  dateTo: string;
  sort: "relevance" | "newest" | "oldest";
  page: number;
  limit: number;
};

type PublishedCorpusExplorerArgs = {
  snapshotId: string;
  analysisId: string;
  filters: PublishedCorpusExplorerFilters;
};

type SqlParts = {
  cte: string;
  where: string;
  values: unknown[];
};

function buildSqlParts(args: PublishedCorpusExplorerArgs): SqlParts {
  const values: unknown[] = [args.snapshotId, args.analysisId];
  const conditions: string[] = [];
  const addValue = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const { filters } = args;

  if (filters.q.trim()) {
    const param = addValue(`%${filters.q.trim()}%`);
    conditions.push(`(
      COALESCE(pm.text_clean, pm.text_raw, '') ILIKE ${param}
      OR COALESCE(pm.title, '') ILIKE ${param}
      OR COALESCE(pm.text_snippet, '') ILIKE ${param}
    )`);
  }
  if (filters.platform) {
    const param = addValue(filters.platform);
    conditions.push(`COALESCE(NULLIF(pm.resolved_platform, ''), NULLIF(pm.platform, ''), 'unknown') = ${param}`);
  }
  if (filters.finding) {
    const param = addValue(filters.finding);
    conditions.push(`EXISTS (
      SELECT 1
      FROM tb_mention_codings mc_filter
      JOIN tb_findings f_filter ON f_filter.id = mc_filter.finding_id
      WHERE mc_filter.tb_analysis_id = $2::uuid
        AND mc_filter.mention_id = pm.id
        AND (f_filter.finding_id = ${param} OR f_filter.id::text = ${param})
    )`);
  }
  if (filters.tag) {
    const param = addValue(filters.tag);
    conditions.push(`EXISTS (
      SELECT 1
      FROM record_tags rt_filter
      LEFT JOIN taxonomy_terms tt_filter ON tt_filter.id = rt_filter.taxonomy_term_id
      WHERE rt_filter.subject_type = 'mention'
        AND rt_filter.subject_id = pm.id::text
        AND rt_filter.tb_analysis_id = $2::uuid
        AND COALESCE(rt_filter.review_status, 'pending') <> 'rejected'
        AND (
          rt_filter.taxonomy_term_id::text = ${param}
          OR tt_filter.term_key = ${param}
          OR rt_filter.value = ${param}
        )
    )`);
  }
  if (filters.feature) {
    const param = addValue(filters.feature);
    conditions.push(`EXISTS (
      SELECT 1
      FROM record_feature_values rfv_filter
      WHERE rfv_filter.subject_type = 'mention'
        AND rfv_filter.subject_id = pm.id::text
        AND rfv_filter.tb_analysis_id = $2::uuid
        AND rfv_filter.feature_key = ${param}
    )`);
  }
  if (filters.entity) {
    const param = addValue(filters.entity);
    conditions.push(`EXISTS (
      SELECT 1
      FROM record_entity_links rel_filter
      WHERE rel_filter.subject_type = 'mention'
        AND rel_filter.subject_id = pm.id::text
        AND rel_filter.entity_id::text = ${param}
    )`);
  }
  if (filters.evidenceRole === "protagonist") {
    conditions.push(`EXISTS (
      SELECT 1
      FROM tb_finding_citations fc_filter
      JOIN tb_findings f_filter ON f_filter.id = fc_filter.finding_id
      WHERE f_filter.tb_analysis_id = $2::uuid
        AND fc_filter.mention_id = pm.id
        AND fc_filter.is_protagonist = true
    )`);
  } else if (filters.evidenceRole === "support") {
    conditions.push(`EXISTS (
      SELECT 1
      FROM tb_mention_codings mc_filter
      WHERE mc_filter.tb_analysis_id = $2::uuid
        AND mc_filter.mention_id = pm.id
    ) AND NOT EXISTS (
      SELECT 1
      FROM tb_finding_citations fc_filter
      JOIN tb_findings f_filter ON f_filter.id = fc_filter.finding_id
      WHERE f_filter.tb_analysis_id = $2::uuid
        AND fc_filter.mention_id = pm.id
        AND fc_filter.is_protagonist = true
    )`);
  } else if (filters.evidenceRole === "counter") {
    // T&B does not currently persist a governed counter-evidence role.
    conditions.push("FALSE");
  }
  if (filters.dateFrom) {
    const param = addValue(filters.dateFrom);
    conditions.push(`pm.published_at >= ${param}::timestamptz`);
  }
  if (filters.dateTo) {
    const param = addValue(filters.dateTo);
    conditions.push(`pm.published_at < (${param}::date + INTERVAL '1 day')`);
  }

  return {
    cte: `
      WITH published_mentions AS (
        SELECT m.*
        FROM corpus_snapshot_mentions csm
        JOIN mentions m ON m.id = csm.mention_id
        WHERE csm.snapshot_id = $1::uuid
      )
    `,
    where: conditions.length > 0 ? conditions.join(" AND ") : "TRUE",
    values
  };
}

export async function getPublishedCorpusExplorer(args: PublishedCorpusExplorerArgs) {
  const sql = buildSqlParts(args);
  const limitParam = `$${sql.values.length + 1}`;
  const offsetParam = `$${sql.values.length + 2}`;
  const rowValues = [
    ...sql.values,
    args.filters.limit,
    (args.filters.page - 1) * args.filters.limit
  ];
  const orderBy = args.filters.sort === "oldest"
    ? "fm.published_at ASC"
    : args.filters.sort === "newest"
      ? "fm.published_at DESC"
      : "COALESCE(primary_finding.intensity_score, 0) DESC, fm.published_at DESC";

  const [countResult, rowsResult, platformFacetResult, findingFacetResult, tagFacetResult, featureFacetResult, entityFacetResult] = await Promise.all([
    pool.query<{ total: number }>(
      `
        ${sql.cte}
        SELECT COUNT(*)::int AS total
        FROM published_mentions pm
        WHERE ${sql.where}
      `,
      sql.values
    ),
    pool.query(
      `
        ${sql.cte},
        filtered_mentions AS (
          SELECT pm.*
          FROM published_mentions pm
          WHERE ${sql.where}
        )
        SELECT
          fm.id AS "mentionId",
          'published_snapshot'::text AS "corpusScope",
          COALESCE(fm.text_clean, fm.text_raw, fm.text_snippet, '') AS text,
          fm.text_snippet AS "textSnippet",
          COALESCE(NULLIF(fm.resolved_platform, ''), NULLIF(fm.platform, ''), 'unknown') AS platform,
          fm.published_at::text AS "publishedAt",
          fm.sentiment_source AS "sentimentSource",
          fm.url,
          fm.content_type AS "contentType",
          fm.language,
          fm.country,
          primary_finding.finding_id AS "findingId",
          primary_finding.finding_name AS "findingName",
          primary_finding.layer AS "lensSlug",
          primary_finding.polarity AS "signalIntent",
          primary_finding.movilidad AS mobility,
          primary_finding.intensity_score AS "intensityScore",
          COALESCE(primary_finding.is_protagonist, false) AS "isProtagonist",
          CASE
            WHEN COALESCE(primary_finding.is_protagonist, false) THEN 'protagonist'
            WHEN primary_finding.finding_uuid IS NOT NULL THEN 'support'
            ELSE NULL
          END AS "evidenceRole",
          COALESCE(all_findings.items, '[]'::jsonb) AS findings,
          COALESCE(governed_tags.items, '[]'::jsonb) AS tags,
          COALESCE(governed_features.items, '[]'::jsonb) AS features,
          COALESCE(governed_entities.items, '[]'::jsonb) AS entities
        FROM filtered_mentions fm
        LEFT JOIN LATERAL (
          SELECT
            f.id AS finding_uuid,
            f.finding_id,
            f.nombre_comercial AS finding_name,
            f.layer,
            f.polarity,
            f.movilidad,
            mc.intensity_score,
            EXISTS (
              SELECT 1
              FROM tb_finding_citations fc
              WHERE fc.finding_id = f.id
                AND fc.mention_id = fm.id
                AND fc.is_protagonist = true
            ) AS is_protagonist
          FROM tb_mention_codings mc
          JOIN tb_findings f ON f.id = mc.finding_id
          WHERE mc.tb_analysis_id = $2::uuid
            AND mc.mention_id = fm.id
          ORDER BY
            EXISTS (
              SELECT 1
              FROM tb_finding_citations fc
              WHERE fc.finding_id = f.id
                AND fc.mention_id = fm.id
                AND fc.is_protagonist = true
            ) DESC,
            mc.intensity_score DESC NULLS LAST,
            f.finding_id
          LIMIT 1
        ) primary_finding ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', f.id,
              'findingId', f.finding_id,
              'name', f.nombre_comercial,
              'layer', f.layer,
              'polarity', f.polarity,
              'mobility', f.movilidad,
              'intensityScore', mc.intensity_score,
              'ambiguous', mc.ambiguous
            ) ORDER BY mc.intensity_score DESC NULLS LAST, f.finding_id
          ) AS items
          FROM tb_mention_codings mc
          JOIN tb_findings f ON f.id = mc.finding_id
          WHERE mc.tb_analysis_id = $2::uuid
            AND mc.mention_id = fm.id
        ) all_findings ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'taxonomyKey', tx.taxonomy_key,
              'termId', tt.id,
              'termKey', tt.term_key,
              'label', COALESCE(tt.label, rt.value),
              'value', rt.value,
              'score', rt.score,
              'confidence', rt.confidence,
              'reviewStatus', rt.review_status
            ) ORDER BY tx.taxonomy_key, tt.term_key, rt.value
          ) AS items
          FROM record_tags rt
          LEFT JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
          LEFT JOIN taxonomies tx ON tx.id = tt.taxonomy_id
          WHERE rt.subject_type = 'mention'
            AND rt.subject_id = fm.id::text
            AND rt.tb_analysis_id = $2::uuid
            AND COALESCE(rt.review_status, 'pending') <> 'rejected'
        ) governed_tags ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'key', rfv.feature_key,
              'value', rfv.feature_value,
              'valueType', rfv.value_type,
              'confidence', rfv.confidence
            ) ORDER BY rfv.feature_key
          ) AS items
          FROM record_feature_values rfv
          WHERE rfv.subject_type = 'mention'
            AND rfv.subject_id = fm.id::text
            AND rfv.tb_analysis_id = $2::uuid
        ) governed_features ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', ie.id,
              'type', ie.entity_type,
              'name', ie.canonical_name,
              'relationType', rel.relation_type,
              'confidence', rel.confidence
            ) ORDER BY ie.entity_type, ie.canonical_name
          ) AS items
          FROM record_entity_links rel
          JOIN intelligence_entities ie ON ie.id = rel.entity_id
          WHERE rel.subject_type = 'mention'
            AND rel.subject_id = fm.id::text
        ) governed_entities ON true
        ORDER BY ${orderBy}, fm.id
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      rowValues
    ),
    pool.query<{ platform: string; count: number }>(
      `
        ${sql.cte}
        SELECT
          COALESCE(NULLIF(pm.resolved_platform, ''), NULLIF(pm.platform, ''), 'unknown') AS platform,
          COUNT(*)::int AS count
        FROM published_mentions pm
        WHERE ${sql.where}
        GROUP BY 1
        ORDER BY count DESC, platform
        LIMIT 40
      `,
      sql.values
    ),
    pool.query<{ finding_id: string; finding_name: string; count: number }>(
      `
        ${sql.cte}
        SELECT f.finding_id, max(f.nombre_comercial) AS finding_name, COUNT(DISTINCT pm.id)::int AS count
        FROM published_mentions pm
        JOIN tb_mention_codings mc ON mc.mention_id = pm.id AND mc.tb_analysis_id = $2::uuid
        JOIN tb_findings f ON f.id = mc.finding_id
        WHERE ${sql.where}
        GROUP BY f.finding_id
        ORDER BY count DESC, f.finding_id
        LIMIT 160
      `,
      sql.values
    ),
    pool.query<{ id: string; taxonomy_key: string; term_key: string; label: string; count: number }>(
      `
        ${sql.cte}
        SELECT
          COALESCE(tt.id::text, rt.value) AS id,
          COALESCE(tx.taxonomy_key, 'uncatalogued') AS taxonomy_key,
          COALESCE(tt.term_key, rt.value) AS term_key,
          COALESCE(tt.label, rt.value) AS label,
          COUNT(DISTINCT pm.id)::int AS count
        FROM published_mentions pm
        JOIN record_tags rt
          ON rt.subject_type = 'mention'
          AND rt.subject_id = pm.id::text
          AND rt.tb_analysis_id = $2::uuid
          AND COALESCE(rt.review_status, 'pending') <> 'rejected'
        LEFT JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
        LEFT JOIN taxonomies tx ON tx.id = tt.taxonomy_id
        WHERE ${sql.where}
        GROUP BY 1, 2, 3, 4
        ORDER BY count DESC, label
        LIMIT 160
      `,
      sql.values
    ),
    pool.query<{ feature_key: string; count: number }>(
      `
        ${sql.cte}
        SELECT rfv.feature_key, COUNT(DISTINCT pm.id)::int AS count
        FROM published_mentions pm
        JOIN record_feature_values rfv
          ON rfv.subject_type = 'mention'
          AND rfv.subject_id = pm.id::text
          AND rfv.tb_analysis_id = $2::uuid
        WHERE ${sql.where}
        GROUP BY rfv.feature_key
        ORDER BY count DESC, rfv.feature_key
        LIMIT 120
      `,
      sql.values
    ),
    pool.query<{ entity_id: string; entity_label: string; entity_type: string; count: number }>(
      `
        ${sql.cte}
        SELECT
          ie.id::text AS entity_id,
          ie.canonical_name AS entity_label,
          ie.entity_type,
          COUNT(DISTINCT pm.id)::int AS count
        FROM published_mentions pm
        JOIN record_entity_links rel ON rel.subject_type = 'mention' AND rel.subject_id = pm.id::text
        JOIN intelligence_entities ie ON ie.id = rel.entity_id
        WHERE ${sql.where}
        GROUP BY 1, 2, 3
        ORDER BY count DESC, entity_label
        LIMIT 120
      `,
      sql.values
    )
  ]);

  return {
    total: countResult.rows[0]?.total ?? 0,
    page: args.filters.page,
    limit: args.filters.limit,
    rows: rowsResult.rows,
    facets: {
      platforms: platformFacetResult.rows,
      findings: findingFacetResult.rows,
      lenses: [],
      entities: entityFacetResult.rows,
      signals: [],
      tags: tagFacetResult.rows,
      features: featureFacetResult.rows
    },
    contract: {
      version: SIGNAL_SERVING_CONTRACT_VERSION,
      population: "published_snapshot",
      snapshot_id: args.snapshotId,
      analysis_id: args.analysisId,
      dimensions: ["platform", "finding", "tag", "feature", "entity", "evidence_role", "date"]
    },
    dataPolicy: {
      source: "relational_data_os",
      mutable_corpora: false,
      source_file_names_exposed: false,
      author_identifiers_exposed: false,
      raw_text_access: "authorized_output_viewers_only"
    }
  };
}
