import {
  SIGNAL_METRIC_CATALOG_VERSION,
  SIGNAL_METRIC_CATALOG_V1,
  SIGNAL_METRIC_DEFINITIONS_V1,
  validateSignalMetricCatalogV1
} from "@noisia/query-engine";

import { pool } from "./client.js";

export async function seedSignalMetricCatalogV1() {
  validateSignalMetricCatalogV1();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let definitions = 0;
    for (const metric of SIGNAL_METRIC_DEFINITIONS_V1) {
      const result = await client.query(
        `
          INSERT INTO metric_definitions (
            metric_key, version, metric_group_key, name, description, grain, unit,
            definition, formula_hash, dimensions, visibility, owner_team, status
          ) VALUES (
            $1, $2, $3, $4, $5, 'period', $6, $7::jsonb, $8, $9::jsonb, $10,
            'signal-data', 'active'
          )
          ON CONFLICT (metric_key, version) DO UPDATE SET
            metric_group_key = EXCLUDED.metric_group_key,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            grain = EXCLUDED.grain,
            unit = EXCLUDED.unit,
            definition = EXCLUDED.definition,
            formula_hash = EXCLUDED.formula_hash,
            dimensions = EXCLUDED.dimensions,
            visibility = EXCLUDED.visibility,
            owner_team = EXCLUDED.owner_team,
            status = EXCLUDED.status,
            updated_at = now()
          RETURNING id
        `,
        [
          metric.key,
          metric.version,
          metric.group,
          metric.name,
          metric.description,
          metric.unit,
          JSON.stringify({
            contract_version: metric.contract_version,
            formula: metric.formula,
            denominator: metric.denominator,
            grains: metric.grains,
            null_semantics: metric.null_semantics,
            comparability: metric.comparability,
            quality_rules: metric.quality_rules,
            drill_down_subject: metric.drill_down_subject
          }),
          metric.formula_hash,
          JSON.stringify(metric.dimensions),
          metric.visibility
        ]
      );
      definitions += result.rowCount ?? 0;
    }

    const model = await client.query(
      `
        INSERT INTO semantic_models (
          model_key, name, entities, dimensions, measures, metadata, status
        ) VALUES (
          'signal_social_listening_v1',
          'Signal Social Listening V1',
          $1::jsonb,
          $2::jsonb,
          $3::jsonb,
          $4::jsonb,
          'active'
        )
        ON CONFLICT (model_key) DO UPDATE SET
          name = EXCLUDED.name,
          entities = EXCLUDED.entities,
          dimensions = EXCLUDED.dimensions,
          measures = EXCLUDED.measures,
          metadata = semantic_models.metadata || EXCLUDED.metadata,
          status = EXCLUDED.status
        RETURNING id
      `,
      [
        JSON.stringify(["signal_workspace", "study_corpus", "mention"]),
        JSON.stringify(Array.from(new Set(SIGNAL_METRIC_DEFINITIONS_V1.flatMap((metric) => metric.dimensions.map((dimension) => dimension.key))))),
        JSON.stringify(SIGNAL_METRIC_DEFINITIONS_V1.map((metric) => ({
          key: metric.key,
          version: metric.version,
          group: metric.group
        }))),
        JSON.stringify({
          contract_version: SIGNAL_METRIC_CATALOG_VERSION,
          groups: SIGNAL_METRIC_CATALOG_V1.map((group) => ({ key: group.key, name: group.name })),
          formula_versioning: "new_formula_requires_new_metric_version"
        })
      ]
    );
    await client.query("COMMIT");
    return { definitions, semantic_models: model.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
