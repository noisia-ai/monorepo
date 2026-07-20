import type { PoolClient } from "pg";

import { pool } from "../db/client";
import {
  assessTbCodingBridgeQuality,
  type TbCodingBridgeCounts,
  type TbCodingBridgeQuality,
  type TbCodingBridgeStage
} from "./tb-data-os-bridge-quality";

export { assessTbCodingBridgeQuality } from "./tb-data-os-bridge-quality";

const TB_DATA_OS_CONTRACT = "tb_data_os_v1";
const TB_DATA_OS_RULE_SET_KEY = "tb_data_os_coding";
const TB_DATA_OS_MODEL_KEY = "tb_mention_coding";

type BridgeScopeRow = {
  study_corpus_id: string;
  brand_id: string | null;
  organization_id: string | null;
  pipeline_version: string;
  methodology_version: string;
};

type BridgeCountsRow = {
  codings: number | string;
  coded_mentions: number | string;
  non_irrelevant_mentions: number | string;
  ambiguous_mentions: number | string;
  missing_layer_mentions: number | string;
  missing_emergent_tag_mentions: number | string;
  unlinked_finding_mentions: number | string;
  record_tags: number | string;
  record_features: number | string;
  polarity_tagged_mentions: number | string;
  layer_tagged_mentions: number | string;
  emergent_candidate_tags: number | string;
  tag_lineage_edges: number | string;
  feature_lineage_edges: number | string;
  lineage_edges: number | string;
};

export type TbCodingBridgeResult = {
  contract: typeof TB_DATA_OS_CONTRACT;
  stage: TbCodingBridgeStage;
  tb_analysis_id: string;
  study_corpus_id: string;
  model_version_id: string;
  counts: TbCodingBridgeCounts;
  quality: TbCodingBridgeQuality;
};

/**
 * Materialize T&B's methodology-private coding table into the generic Data OS
 * tag/feature contract. The operation is analysis-scoped and idempotent.
 * Reviewed tags are never overwritten; only unreviewed rows from this exact
 * analysis are rebuilt.
 */
export async function materializeTbCodingDataOs(args: {
  tbAnalysisId: string;
  stage: TbCodingBridgeStage;
  model?: string;
}): Promise<TbCodingBridgeResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `tb-data-os:${args.tbAnalysisId}`
    ]);

    const scope = await loadBridgeScope(client, args.tbAnalysisId);
    const modelVersionId = await ensureCodingModelVersion(client, {
      scope,
      model: args.model
    });
    const terms = await loadRequiredTaxonomyTerms(client);

    await deleteRebuildableRows(client, args.tbAnalysisId);
    await insertFeatureValues(client, {
      tbAnalysisId: args.tbAnalysisId,
      scope,
      modelVersionId
    });
    await insertLayerTags(client, {
      tbAnalysisId: args.tbAnalysisId,
      scope,
      modelVersionId,
      layerTerms: terms.layers
    });
    await insertEmergentTags(client, {
      tbAnalysisId: args.tbAnalysisId,
      scope,
      modelVersionId,
      triggerTermId: terms.triggerEmergent,
      barrierTermId: terms.barrierEmergent
    });
    await insertLineage(client, args.tbAnalysisId);

    const counts = await loadBridgeCounts(client, args.tbAnalysisId);
    const quality = assessTbCodingBridgeQuality(counts, args.stage);
    const result: TbCodingBridgeResult = {
      contract: TB_DATA_OS_CONTRACT,
      stage: args.stage,
      tb_analysis_id: args.tbAnalysisId,
      study_corpus_id: scope.study_corpus_id,
      model_version_id: modelVersionId,
      counts,
      quality
    };

    await client.query(
      `UPDATE tb_analyses
       SET meta_json = jsonb_set(
             COALESCE(meta_json, '{}'::jsonb),
             '{data_os_coding_bridge}',
             $2::jsonb,
             true
           ),
           updated_at = now()
       WHERE id = $1::uuid`,
      [args.tbAnalysisId, JSON.stringify(result)]
    );

    await client.query("COMMIT");
    try {
      await pool.query("ANALYZE record_tags, record_feature_values");
    } catch (error) {
      console.warn("[tb-data-os] ANALYZE skipped after a successful materialization", {
        tbAnalysisId: args.tbAnalysisId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readTbCodingBridgeCounts(tbAnalysisId: string) {
  const client = await pool.connect();
  try {
    return await loadBridgeCounts(client, tbAnalysisId);
  } finally {
    client.release();
  }
}

async function loadBridgeScope(client: PoolClient, tbAnalysisId: string): Promise<BridgeScopeRow> {
  const result = await client.query<BridgeScopeRow>(
    `SELECT
       ta.study_corpus_id,
       sc.brand_id,
       COALESCE(b.organization_id, t.organization_id) AS organization_id,
       ta.pipeline_version,
       ta.methodology_version
     FROM tb_analyses ta
     JOIN study_corpora sc ON sc.id = ta.study_corpus_id
     LEFT JOIN brands b ON b.id = sc.brand_id
     LEFT JOIN themes t ON t.id = sc.theme_id
     WHERE ta.id = $1::uuid`,
    [tbAnalysisId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`tb_analyses ${tbAnalysisId} not found`);
  return row;
}

async function ensureCodingModelVersion(
  client: PoolClient,
  args: { scope: BridgeScopeRow; model?: string }
) {
  const ruleSetResult = await client.query<{ id: string }>(
    `INSERT INTO tagging_rule_sets (
       rule_set_key, version, methodology_slug, subject_type, scope, rules, status, metadata
     ) VALUES (
       $1, 1, 'triggers-barriers', 'mention', 'methodology', $2::jsonb, 'active', $3::jsonb
     )
     ON CONFLICT (rule_set_key, version) DO UPDATE SET
       rules = EXCLUDED.rules,
       status = 'active',
       metadata = tagging_rule_sets.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING id`,
    [
      TB_DATA_OS_RULE_SET_KEY,
      JSON.stringify({
        contract: TB_DATA_OS_CONTRACT,
        outputs: ["trigger", "barrier", "tb_layer", "tb_coding"],
        explicit_only: ["audience", "journey_stage", "demographic"],
        emergent_terms_are_candidates: true
      }),
      JSON.stringify({ contract: TB_DATA_OS_CONTRACT })
    ]
  );
  const ruleSetId = ruleSetResult.rows[0]?.id;
  if (!ruleSetId) throw new Error("Could not resolve T&B Data OS tagging rule set.");

  const version = `${args.scope.pipeline_version}:${args.scope.methodology_version}`;
  const modelResult = await client.query<{ id: string }>(
    `INSERT INTO tagging_model_versions (
       model_key, provider, version, methodology_slug, tagging_rule_set_id, metadata
     ) VALUES ($1, 'anthropic', $2, 'triggers-barriers', $3::uuid, $4::jsonb)
     ON CONFLICT (model_key, version) DO UPDATE SET
       tagging_rule_set_id = EXCLUDED.tagging_rule_set_id,
       metadata = tagging_model_versions.metadata || EXCLUDED.metadata
     RETURNING id`,
    [
      TB_DATA_OS_MODEL_KEY,
      version,
      ruleSetId,
      JSON.stringify({
        contract: TB_DATA_OS_CONTRACT,
        runtime_model: args.model ?? null,
        methodology_version: args.scope.methodology_version,
        pipeline_version: args.scope.pipeline_version
      })
    ]
  );
  const modelVersionId = modelResult.rows[0]?.id;
  if (!modelVersionId) throw new Error("Could not resolve T&B Data OS model version.");
  return modelVersionId;
}

async function loadRequiredTaxonomyTerms(client: PoolClient) {
  const result = await client.query<{ taxonomy_key: string; term_key: string; id: string }>(
    `SELECT t.taxonomy_key, tt.term_key, tt.id
     FROM taxonomies t
     JOIN taxonomy_terms tt ON tt.taxonomy_id = t.id
     WHERE t.taxonomy_key IN ('trigger', 'barrier', 'tb_layer')
       AND tt.status = 'active'
       AND (
         (t.taxonomy_key IN ('trigger', 'barrier') AND tt.term_key = 'emergent')
         OR (t.taxonomy_key = 'tb_layer' AND tt.term_key IN ('personal', 'psicologico', 'social', 'cultural'))
       )`
  );
  const byKey = new Map(result.rows.map((row) => [`${row.taxonomy_key}:${row.term_key}`, row.id]));
  const triggerEmergent = byKey.get("trigger:emergent");
  const barrierEmergent = byKey.get("barrier:emergent");
  const layers = new Map<string, string>();
  for (const layer of ["personal", "psicologico", "social", "cultural"]) {
    const id = byKey.get(`tb_layer:${layer}`);
    if (id) layers.set(layer, id);
  }
  if (!triggerEmergent || !barrierEmergent || layers.size !== 4) {
    throw new Error("Migration 0041 taxonomy catalog is incomplete; apply Data OS migrations before T&B.");
  }
  return { triggerEmergent, barrierEmergent, layers };
}

async function deleteRebuildableRows(client: PoolClient, tbAnalysisId: string) {
  await client.query(
    `DELETE FROM lineage_edges le
     USING record_tags rt
     WHERE le.target_type = 'record_tag'
       AND le.target_id = rt.id
       AND rt.tb_analysis_id = $1::uuid
       AND rt.review_status = 'unreviewed'`,
    [tbAnalysisId]
  );
  await client.query(
    `DELETE FROM lineage_edges le
     USING record_feature_values rfv
     WHERE le.target_type = 'record_feature_value'
       AND le.target_id = rfv.id
       AND rfv.tb_analysis_id = $1::uuid`,
    [tbAnalysisId]
  );
  await client.query(
    `DELETE FROM record_tags
     WHERE tb_analysis_id = $1::uuid AND review_status = 'unreviewed'`,
    [tbAnalysisId]
  );
  await client.query(
    `DELETE FROM record_feature_values WHERE tb_analysis_id = $1::uuid`,
    [tbAnalysisId]
  );
}

async function insertFeatureValues(
  client: PoolClient,
  args: { tbAnalysisId: string; scope: BridgeScopeRow; modelVersionId: string }
) {
  await client.query(
    `INSERT INTO record_feature_values (
       organization_id, brand_id, study_corpus_id, subject_type, subject_id,
       feature_key, feature_value, value_type, confidence, source, model_version_id, tb_analysis_id
     )
     SELECT
       $2::uuid,
       $3::uuid,
       $4::uuid,
       'mention',
       c.mention_id,
       'tb_coding',
       jsonb_build_object(
         'contract', $5::text,
         'tb_analysis_id', c.tb_analysis_id,
         'codings', jsonb_agg(jsonb_build_object(
           'tb_mention_coding_id', c.id,
           'finding_id', c.finding_id,
           'polarity', c.polarity,
           'layer', c.layer,
           'intensity_score', c.intensity_score,
           'emergent_tags', COALESCE(c.emergent_tags, ARRAY[]::text[]),
           'ambiguous', c.ambiguous
         ) ORDER BY c.id)
       ),
       'json',
       CASE
         WHEN bool_or(c.ambiguous) THEN 'low'
         WHEN bool_and(c.finding_id IS NOT NULL OR c.polarity = 'irrelevant') THEN 'medium'
         ELSE 'low'
       END,
       'tb_analysis:' || $1::text,
       $6::uuid,
       $1::uuid
     FROM tb_mention_codings c
     WHERE c.tb_analysis_id = $1::uuid
     GROUP BY c.mention_id, c.tb_analysis_id
     ON CONFLICT (subject_type, subject_id, feature_key, source) DO NOTHING`,
    [
      args.tbAnalysisId,
      args.scope.organization_id,
      args.scope.brand_id,
      args.scope.study_corpus_id,
      TB_DATA_OS_CONTRACT,
      args.modelVersionId
    ]
  );
}

async function insertLayerTags(
  client: PoolClient,
  args: {
    tbAnalysisId: string;
    scope: BridgeScopeRow;
    modelVersionId: string;
    layerTerms: Map<string, string>;
  }
) {
  for (const [layer, taxonomyTermId] of args.layerTerms) {
    await client.query(
      `INSERT INTO record_tags (
         organization_id, brand_id, study_corpus_id, subject_type, subject_id,
         taxonomy_term_id, value, score, confidence, evidence, source,
         model_version_id, tb_analysis_id, review_status
       )
       SELECT DISTINCT ON (c.mention_id)
         $2::uuid,
         $3::uuid,
         $4::uuid,
         'mention',
         c.mention_id,
         $5::uuid,
         c.layer,
         c.intensity_score,
         CASE WHEN c.ambiguous OR c.finding_id IS NULL THEN 'low' ELSE 'medium' END,
         jsonb_build_array(jsonb_build_object(
           'contract', $6::text,
           'tb_analysis_id', c.tb_analysis_id,
           'tb_mention_coding_id', c.id,
           'finding_id', c.finding_id,
           'polarity', c.polarity,
           'layer', c.layer,
           'ambiguous', c.ambiguous,
           'mention_excerpt', LEFT(COALESCE(m.text_clean, m.text_snippet, ''), 280)
         )),
         'tb_analysis:' || $1::text || ':layer',
         $7::uuid,
         $1::uuid,
         'unreviewed'
       FROM tb_mention_codings c
       JOIN mentions m ON m.id = c.mention_id
       WHERE c.tb_analysis_id = $1::uuid
         AND c.polarity <> 'irrelevant'
         AND c.layer = $8::text
       ORDER BY c.mention_id, c.created_at DESC, c.id DESC
       ON CONFLICT (subject_type, subject_id, taxonomy_term_id, source) DO NOTHING`,
      [
        args.tbAnalysisId,
        args.scope.organization_id,
        args.scope.brand_id,
        args.scope.study_corpus_id,
        taxonomyTermId,
        TB_DATA_OS_CONTRACT,
        args.modelVersionId,
        layer
      ]
    );
  }
}

async function insertEmergentTags(
  client: PoolClient,
  args: {
    tbAnalysisId: string;
    scope: BridgeScopeRow;
    modelVersionId: string;
    triggerTermId: string;
    barrierTermId: string;
  }
) {
  await client.query(
    `WITH candidates AS (
       SELECT DISTINCT ON (c.mention_id, candidate.taxonomy_key, lower(trim(tag.value)))
         c.id AS coding_id,
         c.mention_id,
         c.finding_id,
         c.polarity,
         c.layer,
         c.intensity_score,
         c.ambiguous,
         trim(tag.value) AS tag_value,
         lower(trim(tag.value)) AS normalized_tag,
         candidate.taxonomy_key,
         CASE WHEN candidate.taxonomy_key = 'trigger' THEN $5::uuid ELSE $6::uuid END AS taxonomy_term_id,
         LEFT(COALESCE(m.text_clean, m.text_snippet, ''), 280) AS mention_excerpt
       FROM tb_mention_codings c
       JOIN mentions m ON m.id = c.mention_id
       CROSS JOIN LATERAL unnest(COALESCE(c.emergent_tags, ARRAY[]::text[])) AS tag(value)
       CROSS JOIN LATERAL (
         SELECT 'trigger'::text AS taxonomy_key WHERE c.polarity IN ('trigger', 'mixed')
         UNION ALL
         SELECT 'barrier'::text AS taxonomy_key WHERE c.polarity IN ('barrier', 'mixed')
       ) candidate
       WHERE c.tb_analysis_id = $1::uuid
         AND c.polarity <> 'irrelevant'
         AND trim(tag.value) <> ''
         AND lower(trim(tag.value)) <> 'irrelevant'
       ORDER BY c.mention_id, candidate.taxonomy_key, lower(trim(tag.value)), c.created_at DESC, c.id DESC
     )
     INSERT INTO record_tags (
       organization_id, brand_id, study_corpus_id, subject_type, subject_id,
       taxonomy_term_id, value, score, confidence, evidence, source,
       model_version_id, tb_analysis_id, review_status
     )
     SELECT
       $2::uuid,
       $3::uuid,
       $4::uuid,
       'mention',
       candidate.mention_id,
       candidate.taxonomy_term_id,
       candidate.tag_value,
       candidate.intensity_score,
       CASE WHEN candidate.ambiguous OR candidate.finding_id IS NULL THEN 'low' ELSE 'medium' END,
       jsonb_build_array(jsonb_build_object(
         'contract', $7::text,
         'candidate', true,
         'taxonomy_key', candidate.taxonomy_key,
         'tb_analysis_id', $1::uuid,
         'tb_mention_coding_id', candidate.coding_id,
         'finding_id', candidate.finding_id,
         'polarity', candidate.polarity,
         'layer', candidate.layer,
         'ambiguous', candidate.ambiguous,
         'mention_excerpt', candidate.mention_excerpt
       )),
       'tb_analysis:' || $1::text || ':emergent:' || candidate.taxonomy_key || ':' || md5(candidate.normalized_tag),
       $8::uuid,
       $1::uuid,
       'unreviewed'
     FROM candidates candidate
     ON CONFLICT (subject_type, subject_id, taxonomy_term_id, source) DO NOTHING`,
    [
      args.tbAnalysisId,
      args.scope.organization_id,
      args.scope.brand_id,
      args.scope.study_corpus_id,
      args.triggerTermId,
      args.barrierTermId,
      TB_DATA_OS_CONTRACT,
      args.modelVersionId
    ]
  );
}

async function insertLineage(client: PoolClient, tbAnalysisId: string) {
  await client.query(
    `INSERT INTO lineage_edges (
       source_type, source_id, target_type, target_id, relation_type, metadata
     )
     SELECT
       'tb_mention_coding',
       (rt.evidence #>> '{0,tb_mention_coding_id}')::uuid,
       'record_tag',
       rt.id,
       'materializes_as',
       jsonb_build_object('contract', $2::text, 'tb_analysis_id', $1::uuid)
     FROM record_tags rt
     WHERE rt.tb_analysis_id = $1::uuid
       AND rt.evidence #>> '{0,tb_mention_coding_id}' IS NOT NULL
     ON CONFLICT (source_type, source_id, target_type, target_id, relation_type) DO UPDATE SET
       metadata = lineage_edges.metadata || EXCLUDED.metadata`,
    [tbAnalysisId, TB_DATA_OS_CONTRACT]
  );
  await client.query(
    `INSERT INTO lineage_edges (
       source_type, source_id, target_type, target_id, relation_type, metadata
     )
     SELECT
       'tb_mention_coding',
       c.id,
       'record_feature_value',
       rfv.id,
       'materializes_as',
       jsonb_build_object('contract', $2::text, 'tb_analysis_id', $1::uuid)
     FROM record_feature_values rfv
     JOIN tb_mention_codings c
       ON c.tb_analysis_id = rfv.tb_analysis_id AND c.mention_id = rfv.subject_id
     WHERE rfv.tb_analysis_id = $1::uuid AND rfv.feature_key = 'tb_coding'
     ON CONFLICT (source_type, source_id, target_type, target_id, relation_type) DO UPDATE SET
       metadata = lineage_edges.metadata || EXCLUDED.metadata`,
    [tbAnalysisId, TB_DATA_OS_CONTRACT]
  );
  await client.query(
    `INSERT INTO lineage_edges (
       source_type, source_id, target_type, target_id, relation_type, metadata
     )
     SELECT DISTINCT
       'tb_finding',
       c.finding_id,
       'record_tag',
       rt.id,
       'supports',
       jsonb_build_object('contract', $2::text, 'tb_analysis_id', $1::uuid)
     FROM record_tags rt
     JOIN tb_mention_codings c
       ON c.tb_analysis_id = rt.tb_analysis_id
      AND c.mention_id = rt.subject_id
      AND c.finding_id IS NOT NULL
     WHERE rt.tb_analysis_id = $1::uuid
     ON CONFLICT (source_type, source_id, target_type, target_id, relation_type) DO UPDATE SET
       metadata = lineage_edges.metadata || EXCLUDED.metadata`,
    [tbAnalysisId, TB_DATA_OS_CONTRACT]
  );
}

async function loadBridgeCounts(client: PoolClient, tbAnalysisId: string) {
  const result = await client.query<BridgeCountsRow>(
    `WITH coding_by_mention AS (
       SELECT
         mention_id,
         COUNT(*) AS codings,
         bool_or(polarity <> 'irrelevant') AS non_irrelevant,
         bool_or(ambiguous) AS ambiguous,
         bool_or(polarity <> 'irrelevant' AND layer IS NOT NULL) AS has_layer,
         bool_or(
           polarity <> 'irrelevant'
           AND EXISTS (
             SELECT 1
             FROM unnest(COALESCE(emergent_tags, ARRAY[]::text[])) AS emergent(tag)
             WHERE trim(emergent.tag) <> ''
               AND lower(trim(emergent.tag)) <> 'irrelevant'
           )
         ) AS has_emergent_tag,
         bool_or(polarity <> 'irrelevant' AND finding_id IS NOT NULL) AS has_finding
       FROM tb_mention_codings
       WHERE tb_analysis_id = $1::uuid
       GROUP BY mention_id
     ), coding AS (
       SELECT
         COALESCE(SUM(codings), 0) AS codings,
         COUNT(*) AS coded_mentions,
         COUNT(*) FILTER (WHERE non_irrelevant) AS non_irrelevant_mentions,
         COUNT(*) FILTER (WHERE ambiguous) AS ambiguous_mentions,
         COUNT(*) FILTER (WHERE non_irrelevant AND NOT has_layer) AS missing_layer_mentions,
         COUNT(*) FILTER (WHERE non_irrelevant AND NOT has_emergent_tag) AS missing_emergent_tag_mentions,
         COUNT(*) FILTER (WHERE non_irrelevant AND NOT has_finding) AS unlinked_finding_mentions
       FROM coding_by_mention
     ), tags AS (
       SELECT
         COUNT(*) AS record_tags,
         COUNT(DISTINCT rt.subject_id) FILTER (
           WHERE taxonomy.taxonomy_key IN ('trigger', 'barrier')
         ) AS polarity_tagged_mentions,
         COUNT(DISTINCT rt.subject_id) FILTER (
           WHERE taxonomy.taxonomy_key = 'tb_layer'
         ) AS layer_tagged_mentions,
         COUNT(*) FILTER (
           WHERE taxonomy.taxonomy_key IN ('trigger', 'barrier')
             AND rt.evidence @> '[{"candidate":true}]'::jsonb
         ) AS emergent_candidate_tags
       FROM record_tags rt
       JOIN taxonomy_terms term ON term.id = rt.taxonomy_term_id
       JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id
       WHERE rt.tb_analysis_id = $1::uuid
     ), features AS (
       SELECT COUNT(*) AS record_features
       FROM record_feature_values
       WHERE tb_analysis_id = $1::uuid AND feature_key = 'tb_coding'
     ), lineage AS (
       SELECT
         COUNT(*) FILTER (
           WHERE source_type = 'tb_mention_coding'
             AND target_type = 'record_tag'
             AND relation_type = 'materializes_as'
         ) AS tag_lineage_edges,
         COUNT(*) FILTER (
           WHERE source_type = 'tb_mention_coding'
             AND target_type = 'record_feature_value'
             AND relation_type = 'materializes_as'
         ) AS feature_lineage_edges,
         COUNT(*) AS lineage_edges
       FROM lineage_edges
       WHERE metadata @> jsonb_build_object('tb_analysis_id', $1::uuid)
     )
     SELECT * FROM coding CROSS JOIN tags CROSS JOIN features CROSS JOIN lineage`,
    [tbAnalysisId]
  );
  const row = result.rows[0];
  return {
    codings: numeric(row?.codings),
    coded_mentions: numeric(row?.coded_mentions),
    non_irrelevant_mentions: numeric(row?.non_irrelevant_mentions),
    ambiguous_mentions: numeric(row?.ambiguous_mentions),
    missing_layer_mentions: numeric(row?.missing_layer_mentions),
    missing_emergent_tag_mentions: numeric(row?.missing_emergent_tag_mentions),
    unlinked_finding_mentions: numeric(row?.unlinked_finding_mentions),
    record_tags: numeric(row?.record_tags),
    record_features: numeric(row?.record_features),
    polarity_tagged_mentions: numeric(row?.polarity_tagged_mentions),
    layer_tagged_mentions: numeric(row?.layer_tagged_mentions),
    emergent_candidate_tags: numeric(row?.emergent_candidate_tags),
    tag_lineage_edges: numeric(row?.tag_lineage_edges),
    feature_lineage_edges: numeric(row?.feature_lineage_edges),
    lineage_edges: numeric(row?.lineage_edges)
  };
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
