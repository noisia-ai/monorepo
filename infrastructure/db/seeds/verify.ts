import { pool } from "./client.js";

async function main() {
  const counts = await pool.query(`
    select
      (select count(*)::int from organizations) as organizations,
      (select count(*)::int from brands) as brands,
      (select count(*)::int from methodologies) as methodologies,
      (select count(*)::int from methodologies where status = 'beta') as beta_methodologies,
      (select count(*)::int from brand_seeds) as brand_seeds,
      (select count(*)::int from study_corpora) as study_corpora,
      (select count(*)::int from competitors) as competitors,
      (select count(*)::int from memory_industry) as memory_industry,
      (select count(*)::int from query_iterations) as query_iterations
  `);

  const demo = await pool.query(
    `
      select b.slug as brand_slug, m.slug as methodology_slug, sc.status
      from study_corpora sc
      join brands b on b.id = sc.brand_id
      join methodologies m on m.id = sc.methodology_id
      where b.slug = $1
    `,
    ["seguros-el-potosi"]
  );

  const schema = await pool.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any($1::text[])
  `, [
    [
      "engine_analyses",
      "engine_findings",
      "engine_pipeline_steps",
      "engine_cost_events",
      "query_packs",
      "mention_query_sources",
      "canonical_signals",
      "signal_observations",
      "signal_observation_evidence"
    ]
  ]);
  const indexes = await pool.query(
    `
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname = any($1::text[])
    `,
    [[
      "uq_query_packs_iteration_lens_intent_scope",
      "uq_signal_observation_signal_tb_analysis",
      "uq_signal_observation_signal_engine_analysis",
      "idx_engine_cost_events_analysis"
    ]]
  );

  const requiredEngineMethodologies = [
    "competitive-tb-matrix",
    "narrative-ownership",
    "sentiment-advocacy-proxy",
    "trust-risk-benchmark",
    "value-perception-matrix",
    "journey-friction-mapping",
    "category-opportunity-map",
    "white-space-analysis",
    "brand-positioning-map",
    "cultural-codes-decoding",
    "competitive-wave",
    "audience-segment-lens",
    "influence-architecture",
    "decision-velocity",
    "evidence-confidence-layer"
  ];
  const requiredMethodologies = ["triggers-barriers", ...requiredEngineMethodologies];
  const methodologyRows = await pool.query(
    `select slug, status from methodologies where slug = any($1::text[])`,
    [requiredMethodologies]
  );
  const loadedMethodologies = new Set(methodologyRows.rows.map((row) => row.slug));
  const missingMethodologies = requiredMethodologies.filter((slug) => !loadedMethodologies.has(slug));
  const methodologyStatuses = new Map(methodologyRows.rows.map((row) => [row.slug, row.status]));
  const wrongStatusMethodologies = [
    ...(["triggers-barriers"].filter((slug) => methodologyStatuses.get(slug) !== "active").map((slug) => ({
      slug,
      expected: "active",
      actual: methodologyStatuses.get(slug) ?? null
    }))),
    ...(requiredEngineMethodologies
      .filter((slug) => methodologyStatuses.get(slug) !== "beta")
      .map((slug) => ({
        slug,
        expected: "beta",
        actual: methodologyStatuses.get(slug) ?? null
      })))
  ];
  const loadedTables = new Set(schema.rows.map((row) => row.table_name));
  const requiredTables = [
    "engine_analyses",
    "engine_findings",
    "engine_pipeline_steps",
    "engine_cost_events",
    "query_packs",
    "mention_query_sources",
    "canonical_signals",
    "signal_observations",
    "signal_observation_evidence"
  ];
  const missingTables = requiredTables.filter((table) => !loadedTables.has(table));
  const requiredIndexes = [
    "uq_query_packs_iteration_lens_intent_scope",
    "uq_signal_observation_signal_tb_analysis",
    "uq_signal_observation_signal_engine_analysis",
    "idx_engine_cost_events_analysis"
  ];
  const loadedIndexes = new Set(indexes.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((indexName) => !loadedIndexes.has(indexName));

  const payload = {
    ok:
      counts.rows[0]?.methodologies >= 6 &&
      counts.rows[0]?.beta_methodologies >= 10 &&
      counts.rows[0]?.brand_seeds >= 60 &&
      counts.rows[0]?.memory_industry >= 3 &&
      demo.rows.some((row) => row.methodology_slug === "triggers-barriers") &&
      missingMethodologies.length === 0 &&
      wrongStatusMethodologies.length === 0 &&
      missingTables.length === 0 &&
      missingIndexes.length === 0,
    counts: counts.rows[0],
    demo: demo.rows,
    engine_methodologies: {
      required: requiredEngineMethodologies.length,
      loaded: requiredEngineMethodologies.filter((slug) => loadedMethodologies.has(slug)).length,
      missing: requiredEngineMethodologies.filter((slug) => !loadedMethodologies.has(slug)),
      expected_status: "beta"
    },
    methodology_statuses: {
      required: requiredMethodologies.length,
      missing: missingMethodologies,
      wrong_status: wrongStatusMethodologies
    },
    live_intelligence_tables: {
      required: requiredTables.length,
      loaded: schema.rows.length,
      missing: missingTables
    },
    live_intelligence_indexes: {
      required: requiredIndexes.length,
      loaded: indexes.rows.length,
      missing: missingIndexes
    }
  };

  if (!payload.ok) {
    throw new Error(`DB verification failed: ${JSON.stringify(payload)}`);
  }

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
