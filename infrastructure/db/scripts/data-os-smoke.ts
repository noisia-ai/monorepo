import pg from "pg";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getDatabaseSslConfig, requireSafeDatabaseWriteTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const IDS = {
  organization: "10000000-0000-4000-8000-000000000001",
  brand: "10000000-0000-4000-8000-000000000002",
  methodology: "10000000-0000-4000-8000-000000000003",
  corpus: "10000000-0000-4000-8000-000000000004",
  knowledgeSource: "10000000-0000-4000-8000-000000000005",
  dataSource: "10000000-0000-4000-8000-000000000006",
  sourceSyncRun: "10000000-0000-4000-8000-000000000007",
  importBatch: "10000000-0000-4000-8000-000000000008",
  mentionOne: "10000000-0000-4000-8000-000000000009",
  mentionTwo: "10000000-0000-4000-8000-000000000010",
  period: "10000000-0000-4000-8000-000000000011",
  canonicalSignal: "10000000-0000-4000-8000-000000000012",
  signalMetric: "10000000-0000-4000-8000-000000000013",
  chartAggregate: "10000000-0000-4000-8000-000000000014",
  performanceRecord: "10000000-0000-4000-8000-000000000015",
  engineAnalysis: "10000000-0000-4000-8000-000000000016",
  publishedOutput: "10000000-0000-4000-8000-000000000017"
};

type CountRow = { key: string; count: string };

function json(value: unknown) {
  return JSON.stringify(value);
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function run(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function q(client: pg.Client, sql: string, params: unknown[] = []) {
  return client.query(sql, params);
}

async function seedFixture(client: pg.Client) {
  const mentionOne =
    "Noisia Smoke funciona para Gen Z porque detecta frustracion con precio y soporte, pero tambien confianza cuando la activacion es clara.";
  const mentionTwo =
    "La audiencia de profesionales pide una experiencia movil simple: menos letra chica, mas datos reales y una promesa de valor facil de entender.";

  await q(client, "begin");
  try {
    await q(
      client,
      `
        INSERT INTO organizations (id, slug, legal_name, display_name, hq_country, industry_primary, status)
        VALUES ($1, 'noisia-data-os-smoke', 'Noisia Data OS Smoke', 'Data OS Smoke', 'MX', 'qa', 'active')
        ON CONFLICT (id) DO UPDATE SET
          legal_name = EXCLUDED.legal_name,
          display_name = EXCLUDED.display_name,
          status = EXCLUDED.status
      `,
      [IDS.organization]
    );

    await q(
      client,
      `
        INSERT INTO brands (
          id, organization_id, slug, name, display_name, industry, status,
          brand_seed_handles, description
        )
        VALUES (
          $1, $2, 'noisia-data-os-smoke-brand', 'Noisia Smoke Brand',
          'Noisia Smoke Brand', 'qa', 'active',
          ARRAY['Noisia Smoke Brand', '@noisia_smoke']::text[],
          'Fixture brand used by the Data OS local smoke test.'
        )
        ON CONFLICT (id) DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          name = EXCLUDED.name,
          display_name = EXCLUDED.display_name,
          status = EXCLUDED.status,
          brand_seed_handles = EXCLUDED.brand_seed_handles,
          description = EXCLUDED.description
      `,
      [IDS.brand, IDS.organization]
    );

    await q(
      client,
      `
        INSERT INTO methodologies (id, slug, name, version, status, manifest_yaml)
        VALUES ($1, 'signal-pulse', 'Signal Pulse', 'v1', 'active', '{}'::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          slug = EXCLUDED.slug,
          name = EXCLUDED.name,
          version = EXCLUDED.version,
          status = EXCLUDED.status,
          manifest_yaml = EXCLUDED.manifest_yaml
      `,
      [IDS.methodology]
    );

    await q(
      client,
      `
        INSERT INTO study_corpora (
          id, name, brand_id, methodology_id, methodology_version_at_creation,
          business_question, decision_to_inform, audience_segment, status,
          current_pipeline_version, corpus_first_approved_at, analysis_plan
        )
        VALUES (
          $1, 'Data OS Smoke Corpus', $2, $3, 'v1',
          'What should Noisia persist as first-class data instead of dead JSON?',
          'Validate the first productive Data OS cut before staging.',
          'Marketing and insights leads', 'ready',
          'data-os-smoke', now(),
          '{"version":1,"primary_methodology_slug":"signal-pulse","selected_lenses":["signal-pulse"],"lens_configs":{},"composer_modules":[]}'::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          brand_id = EXCLUDED.brand_id,
          methodology_id = EXCLUDED.methodology_id,
          methodology_version_at_creation = EXCLUDED.methodology_version_at_creation,
          business_question = EXCLUDED.business_question,
          decision_to_inform = EXCLUDED.decision_to_inform,
          audience_segment = EXCLUDED.audience_segment,
          status = EXCLUDED.status,
          current_pipeline_version = EXCLUDED.current_pipeline_version,
          analysis_plan = EXCLUDED.analysis_plan,
          updated_at = now()
      `,
      [IDS.corpus, IDS.brand, IDS.methodology]
    );

    await q(
      client,
      `
        INSERT INTO brand_knowledge_sources (
          id, organization_id, brand_id, study_corpus_id, source_kind, title,
          original_file_name, mime_type, file_hash, raw_text, extracted_payload, status
        )
        VALUES (
          $1, $2, $3, $4, 'brief', 'Data OS Smoke Brief',
          'data-os-smoke.md', 'text/markdown', $5, $6, $7::jsonb, 'processed'
        )
        ON CONFLICT (id) DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          brand_id = EXCLUDED.brand_id,
          study_corpus_id = EXCLUDED.study_corpus_id,
          raw_text = EXCLUDED.raw_text,
          extracted_payload = EXCLUDED.extracted_payload,
          status = EXCLUDED.status,
          updated_at = now()
      `,
      [
        IDS.knowledgeSource,
        IDS.organization,
        IDS.brand,
        IDS.corpus,
        hash("data-os-smoke-brief"),
        [
          "Brand OS smoke context for Noisia Data OS.",
          "The client needs source catalogues, normalized mentions, persistent tags and dashboard APIs.",
          "The knowledge base should become queryable data, not only prompt text."
        ].join("\n"),
        json({
          summary: "Noisia Data OS should preserve client knowledge, corpus records and dashboard data as reusable assets.",
          audience_clues: ["Marketing and insights leads"],
          brand_claims: ["Data should be queryable after Claude summarizes it"],
          potential_triggers: ["clarity", "trust", "speed"],
          potential_barriers: ["fragmented data", "dead JSON outputs"],
          limitations: ["Fixture data is synthetic and local-only"]
        })
      ]
    );

    await q(
      client,
      `
        INSERT INTO data_sources (
          id, study_corpus_id, organization_id, brand_id, source_type, provider,
          connection_method, name, mapping, role, status, visibility
        )
        VALUES (
          $1, $2, $3, $4, 'social_listening', 'fixture',
          'local_smoke', 'Data OS smoke social listening fixture',
          '{"external_id":"external_id","text":"text_clean"}'::jsonb,
          '{"primary":true}'::jsonb, 'active', 'internal'
        )
        ON CONFLICT (id) DO UPDATE SET
          study_corpus_id = EXCLUDED.study_corpus_id,
          organization_id = EXCLUDED.organization_id,
          brand_id = EXCLUDED.brand_id,
          status = EXCLUDED.status,
          mapping = EXCLUDED.mapping,
          updated_at = now()
      `,
      [IDS.dataSource, IDS.corpus, IDS.organization, IDS.brand]
    );

    await q(
      client,
      `
        INSERT INTO source_sync_runs (
          id, data_source_id, finished_at, status, records_total, records_valid,
          records_duplicate, records_failed, coverage_start, coverage_end
        )
        VALUES ($1, $2, now(), 'completed', 2, 2, 0, 0, '2026-06-01', '2026-06-30')
        ON CONFLICT (id) DO UPDATE SET
          finished_at = EXCLUDED.finished_at,
          status = EXCLUDED.status,
          records_total = EXCLUDED.records_total,
          records_valid = EXCLUDED.records_valid
      `,
      [IDS.sourceSyncRun, IDS.dataSource]
    );

    await q(
      client,
      `
        INSERT INTO import_batches (
          id, study_corpus_id, mention_type, entity_kind, entity_label,
          source_system, source_file_name, source_file_hash, record_count,
          included_count, excluded_count, duplicate_count, status
        )
        VALUES (
          $1, $2, 'brand', 'primary_brand', 'Noisia Smoke Brand',
          'fixture', 'data-os-smoke.csv', $3, 2, 2, 0, 0, 'completed'
        )
        ON CONFLICT (id) DO UPDATE SET
          record_count = EXCLUDED.record_count,
          included_count = EXCLUDED.included_count,
          excluded_count = EXCLUDED.excluded_count,
          duplicate_count = EXCLUDED.duplicate_count,
          status = EXCLUDED.status
      `,
      [IDS.importBatch, IDS.corpus, hash("data-os-smoke.csv")]
    );

    for (const [id, externalId, text, publishedAt, platform, sentimentScore] of [
      [IDS.mentionOne, "data-os-smoke-mention-1", mentionOne, "2026-06-10T12:00:00Z", "TikTok", 0.42],
      [IDS.mentionTwo, "data-os-smoke-mention-2", mentionTwo, "2026-06-18T12:00:00Z", "Reddit", 0.18]
    ] as const) {
      await q(
        client,
        `
          INSERT INTO mentions (
            id, study_corpus_id, external_id, source_system, source_file_id,
            text_hash, text_raw, text_clean, text_snippet, text_length, language,
            published_at, platform, resolved_platform, content_type, url, country,
            engagement, sentiment_source, sentiment_score, quality_score,
            inclusion_status, quality_flags, raw_metadata
          )
          VALUES (
            $1, $2, $3, 'fixture', $4,
            $5, $6, $6, left($6, 160), length($6), 'es',
            $7, $8, $8, 'post', 'https://example.invalid/data-os-smoke', 'MX',
            '{"likes":12,"comments":3}'::jsonb, 'fixture', $9, 90,
            'included', '[]'::jsonb, '{"fixture":true}'::jsonb
          )
          ON CONFLICT (id) DO UPDATE SET
            text_hash = EXCLUDED.text_hash,
            text_raw = EXCLUDED.text_raw,
            text_clean = EXCLUDED.text_clean,
            text_snippet = EXCLUDED.text_snippet,
            text_length = EXCLUDED.text_length,
            published_at = EXCLUDED.published_at,
            platform = EXCLUDED.platform,
            resolved_platform = EXCLUDED.resolved_platform,
            sentiment_score = EXCLUDED.sentiment_score,
            inclusion_status = EXCLUDED.inclusion_status,
            updated_at = now()
        `,
        [id, IDS.corpus, externalId, IDS.importBatch, hash(`${IDS.corpus}:${externalId}:${text}`), text, publishedAt, platform, sentimentScore]
      );
    }

    await q(
      client,
      `
        INSERT INTO report_periods (
          id, study_corpus_id, granularity, period_start, period_end, label,
          coverage, comparable, confidence
        )
        VALUES ($1, $2, 'month', '2026-06-01', '2026-06-30', 'June 2026', '{"mentions":2}'::jsonb, true, 'high')
        ON CONFLICT (id) DO UPDATE SET
          coverage = EXCLUDED.coverage,
          comparable = EXCLUDED.comparable,
          confidence = EXCLUDED.confidence,
          computed_at = now()
      `,
      [IDS.period, IDS.corpus]
    );

    await q(
      client,
      `
        INSERT INTO canonical_signals (
          id, organization_id, brand_id, study_corpus_id, methodology_slug,
          signal_type, canonical_title, semantic_key, description, dimensions,
          status, first_seen_at, last_seen_at
        )
        VALUES (
          $1, $2, $3, $4, 'signal-pulse',
          'opportunity', 'Dead JSON becomes living data',
          'dead_json_becomes_living_data',
          'Synthetic signal used to verify Data OS backfill and serving contracts.',
          '{"journey_stage":"consideration"}'::jsonb,
          'active', '2026-06-01', '2026-06-30'
        )
        ON CONFLICT (id) DO UPDATE SET
          description = EXCLUDED.description,
          dimensions = EXCLUDED.dimensions,
          status = EXCLUDED.status,
          updated_at = now()
      `,
      [IDS.canonicalSignal, IDS.organization, IDS.brand, IDS.corpus]
    );

    await q(
      client,
      `
        INSERT INTO signal_period_metrics (
          id, canonical_signal_id, period_id, study_corpus_id, volume,
          engagement, impact_v1, sentiment_score, polarity_bucket,
          dominant_emotion, source_mix, evidence_count, confidence, rank,
          lifecycle_state
        )
        VALUES (
          $1, $2, $3, $4, 2,
          15, 8.5, 0.31, 'positive',
          'trust', '{"TikTok":1,"Reddit":1}'::jsonb, 2, 'high', 1,
          'emerging'
        )
        ON CONFLICT ON CONSTRAINT uq_signal_period_metrics_signal_period DO UPDATE SET
          volume = EXCLUDED.volume,
          engagement = EXCLUDED.engagement,
          impact_v1 = EXCLUDED.impact_v1,
          sentiment_score = EXCLUDED.sentiment_score,
          lifecycle_state = EXCLUDED.lifecycle_state,
          computed_at = now()
      `,
      [IDS.signalMetric, IDS.canonicalSignal, IDS.period, IDS.corpus]
    );

    await q(
      client,
      `
        INSERT INTO chart_aggregates (id, study_corpus_id, chart_key, period_id, filters_hash, payload, algo_version)
        VALUES ($1, $2, 'signal_volume_by_platform', $3, 'default', '{"rows":[{"platform":"TikTok","volume":1},{"platform":"Reddit","volume":1}]}'::jsonb, 'data-os-smoke')
        ON CONFLICT ON CONSTRAINT uq_chart_aggregates_ref DO UPDATE SET
          payload = EXCLUDED.payload,
          algo_version = EXCLUDED.algo_version,
          computed_at = now()
      `,
      [IDS.chartAggregate, IDS.corpus, IDS.period]
    );

    await q(
      client,
      `
        INSERT INTO performance_records (
          id, study_corpus_id, data_source_id, external_id, entity_kind,
          entity_name, platform, channel, objective, record_date,
          granularity, spend, impressions, reach, clicks, engagement, metrics
        )
        VALUES (
          $1, $2, $3, 'data-os-smoke-campaign', 'campaign',
          'Data OS Smoke Campaign', 'Meta', 'paid', 'traffic', '2026-06-15',
          'day', 120.50, 10000, 7400, 360, 540,
          '{"ctr":0.036,"cpm":12.05}'::jsonb
        )
        ON CONFLICT ON CONSTRAINT uq_performance_records_grain DO UPDATE SET
          data_source_id = EXCLUDED.data_source_id,
          spend = EXCLUDED.spend,
          impressions = EXCLUDED.impressions,
          reach = EXCLUDED.reach,
          clicks = EXCLUDED.clicks,
          engagement = EXCLUDED.engagement,
          metrics = EXCLUDED.metrics
      `,
      [IDS.performanceRecord, IDS.corpus, IDS.dataSource]
    );

    await q(
      client,
      `
        INSERT INTO engine_analyses (
          id, study_corpus_id, methodology_slug, methodology_version,
          pipeline_version, status, current_step, business_question,
          params, meta_json, limitations, executed_at
        )
        VALUES (
          $1, $2, 'signal-pulse', 'v1',
          'data-os-smoke', 'completed', 'published',
          'What should Noisia persist as first-class data instead of dead JSON?',
          '{"fixture":true}'::jsonb, '{"source":"data-os-smoke"}'::jsonb,
          '[]'::jsonb, now()
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          current_step = EXCLUDED.current_step,
          meta_json = EXCLUDED.meta_json,
          updated_at = now()
      `,
      [IDS.engineAnalysis, IDS.corpus]
    );

    await q(
      client,
      `
        INSERT INTO published_outputs (
          id, engine_analysis_id, study_corpus_id, brand_id, methodology_slug,
          kind, output_type, status, title, headline, summary,
          manifest, payload, visibility_config, published_at
        )
        VALUES (
          $1, $2, $3, $4, 'signal-pulse',
          'signal_pulse', 'signal_pulse_dashboard', 'published',
          'Data OS Smoke Pulse', 'Dead JSON becomes living data',
          'Synthetic Signal Pulse output for Data OS smoke verification.',
          '{"version":1}'::jsonb,
          $5::jsonb,
          '{"paid_data_visible_to_clients":false}'::jsonb,
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          title = EXCLUDED.title,
          headline = EXCLUDED.headline,
          summary = EXCLUDED.summary,
          payload = EXCLUDED.payload,
          visibility_config = EXCLUDED.visibility_config,
          updated_at = now()
      `,
      [
        IDS.publishedOutput,
        IDS.engineAnalysis,
        IDS.corpus,
        IDS.brand,
        json({
          report: { title: "Data OS Smoke Pulse" },
          periods: [
            {
              id: IDS.period,
              label: "June 2026",
              period_start: "2026-06-01",
              period_end: "2026-06-30",
              comparable: true
            }
          ],
          signals: [
            {
              id: IDS.canonicalSignal,
              signal_type: "opportunity",
              canonical_title: "Dead JSON becomes living data",
              semantic_key: "dead_json_becomes_living_data",
              period_id: IDS.period,
              volume: 2,
              impact_v1: 8.5,
              sentiment_score: 0.31,
              lifecycle_state: "emerging",
              confidence: "high"
            }
          ],
          chart_refs: {
            signal_volume_by_platform: {
              rows: [
                { platform: "TikTok", volume: 1 },
                { platform: "Reddit", volume: 1 }
              ]
            }
          }
        })
      ]
    );

    await q(client, "commit");
  } catch (error) {
    await q(client, "rollback").catch(() => undefined);
    throw error;
  }
}

async function readCounts(client: pg.Client) {
  const result = await client.query<CountRow>(
    `
      SELECT 'brand_os_profiles' AS key, count(*)::text AS count
      FROM brand_os_profiles
      WHERE brand_id = $2
      UNION ALL
      SELECT 'brand_os_objectives', count(*)::text
      FROM brand_os_objectives boo
      JOIN brand_os_profiles bop ON bop.id = boo.brand_os_profile_id
      WHERE bop.brand_id = $2
      UNION ALL
      SELECT 'brand_os_audiences', count(*)::text
      FROM brand_os_audiences boa
      JOIN brand_os_profiles bop ON bop.id = boa.brand_os_profile_id
      WHERE bop.brand_id = $2
      UNION ALL
      SELECT 'brand_os_briefs', count(*)::text
      FROM brand_os_briefs bob
      JOIN brand_os_profiles bop ON bop.id = bob.brand_os_profile_id
      WHERE bob.study_corpus_id = $1
        AND bop.brand_id = $2
      UNION ALL
      SELECT 'brand_os_seed_terms', count(*)::text
      FROM brand_os_seed_terms bst
      JOIN brand_os_seed_sets bss ON bss.id = bst.seed_set_id
      JOIN brand_os_profiles bop ON bop.id = bss.brand_os_profile_id
      WHERE bop.brand_id = $2
      UNION ALL
      SELECT 'brand_os_links', count(*)::text
      FROM brand_os_links bol
      JOIN brand_os_profiles bop ON bop.id = bol.brand_os_profile_id
      WHERE bop.brand_id = $2
      UNION ALL
      SELECT 'knowledge_chunks', count(*)::text
      FROM knowledge_chunks kc
      JOIN brand_knowledge_sources bks ON bks.id = kc.knowledge_source_id
      WHERE bks.study_corpus_id = $1
      UNION ALL
      SELECT 'knowledge_assertions', count(*)::text
      FROM knowledge_assertions ka
      JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
      WHERE bks.study_corpus_id = $1
      UNION ALL
      SELECT 'knowledge_assertion_links', count(*)::text
      FROM knowledge_assertion_links kal
      JOIN knowledge_assertions ka ON ka.id = kal.knowledge_assertion_id
      JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
      WHERE bks.study_corpus_id = $1
      UNION ALL
      SELECT 'knowledge_usage_events', count(*)::text
      FROM knowledge_usage_events
      WHERE metadata->>'corpus_id' = ($1::uuid)::text
      UNION ALL
      SELECT 'taxonomies', count(*)::text FROM taxonomies WHERE status = 'active'
      UNION ALL
      SELECT 'taxonomy_terms', count(*)::text FROM taxonomy_terms WHERE status = 'active'
      UNION ALL
      SELECT 'data_assets', count(*)::text FROM data_assets WHERE study_corpus_id = $1
      UNION ALL
      SELECT 'data_asset_fields', count(*)::text
      FROM data_asset_fields daf
      JOIN data_assets da ON da.id = daf.data_asset_id
      WHERE da.study_corpus_id = $1
      UNION ALL
      SELECT 'data_assets_without_fields', count(*)::text
      FROM data_assets da
      WHERE da.study_corpus_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM data_asset_fields daf
          WHERE daf.data_asset_id = da.id
        )
      UNION ALL
      SELECT 'data_contracts', count(*)::text
      FROM data_contracts dc
      JOIN data_assets da ON da.id = dc.data_asset_id
      WHERE da.study_corpus_id = $1
      UNION ALL
      SELECT 'data_quality_results', count(*)::text
      FROM data_quality_results dqr
      JOIN data_assets da ON da.id = dqr.data_asset_id
      WHERE da.study_corpus_id = $1
      UNION ALL
      SELECT 'lineage_edges', count(*)::text
      FROM lineage_edges le
      JOIN data_assets da ON da.id = le.target_id
      WHERE da.study_corpus_id = $1
      UNION ALL
      SELECT 'lineage_data_source_to_asset', count(*)::text
      FROM lineage_edges le
      JOIN data_assets da ON da.id = le.target_id
      WHERE da.study_corpus_id = $1
        AND le.source_type = 'data_source'
        AND le.target_type = 'data_asset'
      UNION ALL
      SELECT 'lineage_import_batch_to_asset', count(*)::text
      FROM lineage_edges le
      JOIN data_assets da ON da.id = le.target_id
      WHERE da.study_corpus_id = $1
        AND le.source_type = 'import_batch'
        AND le.target_type = 'data_asset'
      UNION ALL
      SELECT 'lineage_knowledge_source_to_asset', count(*)::text
      FROM lineage_edges le
      JOIN data_assets da ON da.id = le.target_id
      WHERE da.study_corpus_id = $1
        AND le.source_type = 'brand_knowledge_source'
        AND le.target_type = 'data_asset'
      UNION ALL
      SELECT 'lineage_asset_to_asset', count(*)::text
      FROM lineage_edges le
      JOIN data_assets source_asset ON source_asset.id = le.source_id
      JOIN data_assets target_asset ON target_asset.id = le.target_id
      WHERE source_asset.study_corpus_id = $1
        AND target_asset.study_corpus_id = $1
        AND le.source_type = 'data_asset'
        AND le.target_type = 'data_asset'
      UNION ALL
      SELECT 'lineage_asset_to_dashboard_ref', count(*)::text
      FROM lineage_edges le
      JOIN dashboard_data_refs ddr ON ddr.id = le.target_id
      WHERE ddr.study_corpus_id = $1
        AND le.source_type = 'data_asset'
        AND le.target_type = 'dashboard_data_ref'
      UNION ALL
      SELECT 'lineage_dashboard_ref_to_output', count(*)::text
      FROM lineage_edges le
      JOIN dashboard_data_refs ddr ON ddr.id = le.source_id
      JOIN published_outputs po ON po.id = le.target_id
      WHERE ddr.study_corpus_id = $1
        AND po.study_corpus_id = $1
        AND le.source_type = 'dashboard_data_ref'
        AND le.target_type = 'published_output'
      UNION ALL
      SELECT 'intelligence_entities', count(*)::text
      FROM intelligence_entities
      WHERE brand_id = $2
      UNION ALL
      SELECT 'record_tags', count(*)::text
      FROM record_tags
      WHERE study_corpus_id = $1
      UNION ALL
      SELECT 'record_feature_values', count(*)::text
      FROM record_feature_values
      WHERE study_corpus_id = $1
      UNION ALL
      SELECT 'tagging_rule_sets', count(*)::text
      FROM tagging_rule_sets
      WHERE rule_set_key = 'data_os_cut_1_deterministic_mentions'
        AND version = 1
        AND status = 'active'
      UNION ALL
      SELECT 'tagging_model_versions_with_rule_set', count(*)::text
      FROM tagging_model_versions tmv
      JOIN tagging_rule_sets trs ON trs.id = tmv.tagging_rule_set_id
      WHERE tmv.model_key = 'data_os_backfill'
        AND tmv.version = 'v1'
        AND trs.rule_set_key = 'data_os_cut_1_deterministic_mentions'
        AND trs.version = 1
        AND trs.status = 'active'
      UNION ALL
      SELECT 'record_tags_trigger', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'trigger'
      UNION ALL
      SELECT 'record_tags_barrier', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'barrier'
      UNION ALL
      SELECT 'record_tags_journey_stage', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'journey_stage'
      UNION ALL
      SELECT 'record_tags_value_perception', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'value_perception'
      UNION ALL
      SELECT 'record_tags_audience', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'audience'
      UNION ALL
      SELECT 'record_tags_demographic', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'demographic'
      UNION ALL
      SELECT 'record_tags_sentiment_polarity', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'sentiment_polarity'
      UNION ALL
      SELECT 'record_tags_source_type', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'source_type'
      UNION ALL
      SELECT 'record_tags_content_format', count(*)::text
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1 AND rt.subject_type = 'mention' AND tx.taxonomy_key = 'content_format'
      UNION ALL
      SELECT 'metric_definitions', count(*)::text
      FROM metric_definitions
      WHERE metric_key IN ('signal_volume', 'signal_impact_v1', 'signal_sentiment_score', 'performance_engagement')
      UNION ALL
      SELECT 'semantic_models', count(*)::text
      FROM semantic_models
      WHERE model_key = 'signal_pulse_serving'
      UNION ALL
      SELECT 'dashboard_data_refs', count(*)::text
      FROM dashboard_data_refs
      WHERE study_corpus_id = $1
      UNION ALL
      SELECT 'dashboard_data_refs_with_source_id', count(*)::text
      FROM dashboard_data_refs
      WHERE study_corpus_id = $1
        AND source_id IS NOT NULL
    `,
    [IDS.corpus, IDS.brand]
  );

  return Object.fromEntries(result.rows.map((row) => [row.key, Number(row.count)]));
}

function assertMinimums(counts: Record<string, number>) {
  const minimums: Record<string, number> = {
    brand_os_profiles: 1,
    brand_os_objectives: 1,
    brand_os_audiences: 1,
    brand_os_briefs: 1,
    brand_os_seed_terms: 2,
    brand_os_links: 3,
    knowledge_chunks: 1,
    knowledge_assertions: 3,
    knowledge_assertion_links: 3,
    knowledge_usage_events: 3,
    taxonomies: 10,
    taxonomy_terms: 20,
    data_assets: 10,
    data_asset_fields: 50,
    data_contracts: 10,
    data_quality_results: 10,
    lineage_edges: 9,
    lineage_data_source_to_asset: 1,
    lineage_import_batch_to_asset: 1,
    lineage_knowledge_source_to_asset: 1,
    lineage_asset_to_asset: 3,
    lineage_asset_to_dashboard_ref: 4,
    lineage_dashboard_ref_to_output: 4,
    intelligence_entities: 2,
    tagging_rule_sets: 1,
    tagging_model_versions_with_rule_set: 1,
    record_tags: 10,
    record_feature_values: 2,
    record_tags_trigger: 1,
    record_tags_barrier: 1,
    record_tags_journey_stage: 1,
    record_tags_value_perception: 1,
    record_tags_audience: 1,
    record_tags_demographic: 1,
    record_tags_sentiment_polarity: 2,
    record_tags_source_type: 2,
    record_tags_content_format: 2,
    metric_definitions: 4,
    semantic_models: 1,
    dashboard_data_refs: 4,
    dashboard_data_refs_with_source_id: 4
  };

  const failures = Object.entries(minimums)
    .filter(([key, minimum]) => (counts[key] ?? 0) < minimum)
    .map(([key, minimum]) => ({ key, minimum, actual: counts[key] ?? 0 }));

  if ((counts.data_assets_without_fields ?? 0) > 0) {
    failures.push({
      key: "data_assets_without_fields",
      minimum: 0,
      actual: counts.data_assets_without_fields ?? 0
    });
  }

  if (failures.length > 0) {
    throw new Error(`Data OS smoke verification failed: ${JSON.stringify(failures)}`);
  }
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "data-os:smoke",
    allowRemoteEnv: "NOISIA_DATA_OS_SMOKE_ALLOW_REMOTE"
  });

  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    await seedFixture(client);
  } finally {
    await client.end();
  }

  await run("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-preflight.ts"], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NOISIA_DATA_OS_BACKFILL_CORPUS_ID: IDS.corpus,
      NOISIA_DATA_OS_SHADOW_OUTPUT_ID: IDS.publishedOutput,
      NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE:
        process.env.NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE ?? process.env.NOISIA_DATA_OS_SMOKE_ALLOW_REMOTE
    }
  });

  await run("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-backfill.ts"], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NOISIA_DATA_OS_BACKFILL_ENABLED: "true",
      NOISIA_DATA_OS_BACKFILL_CORPUS_ID: IDS.corpus,
      NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE:
        process.env.NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE ?? process.env.NOISIA_DATA_OS_SMOKE_ALLOW_REMOTE
    }
  });

  const verifyClient = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });
  await verifyClient.connect();
  try {
    const counts = await readCounts(verifyClient);
    assertMinimums(counts);
    console.log(JSON.stringify({ ok: true, corpus_id: IDS.corpus, counts }, null, 2));
  } finally {
    await verifyClient.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
