import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Job } from "bullmq";

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:55432/noisia_migration_smoke";
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

process.env.DATABASE_URL ||= process.env.NOISIA_SIGNAL_PULSE_SMOKE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
process.env.DATABASE_SSL ||= "false";
process.env.REDIS_URL ||= process.env.NOISIA_SIGNAL_PULSE_SMOKE_REDIS_URL ?? DEFAULT_REDIS_URL;
process.env.NOISIA_ENGINE_INLINE_SMOKE = "true";

type Row = Record<string, unknown>;
type StepName =
  | "sp_readiness"
  | "sp_periods"
  | "sp_cluster"
  | "sp_name_signals"
  | "sp_metrics"
  | "sp_interpret"
  | "sp_moves"
  | "sp_charts"
  | "sp_gates";
type SmokeIds = {
  analysisId: string;
  brandId: string;
  corpusId: string;
  dataSourceId: string;
  userId: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const dbRoot = join(repoRoot, "infrastructure", "db");
const composeFile = join(repoRoot, "infrastructure", "docker", "docker-compose.yml");

function requireLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  if (LOCAL_HOSTS.has(parsed.hostname) || process.env.NOISIA_SIGNAL_PULSE_SMOKE_ALLOW_REMOTE === "true") return;
  throw new Error(
    [
      "Refusing Signal Pulse smoke against a non-local database.",
      `Host: ${parsed.hostname}`,
      "Set NOISIA_SIGNAL_PULSE_SMOKE_ALLOW_REMOTE=true only for an isolated throwaway database."
    ].join(" ")
  );
}

function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function waitForDatabase(databaseUrl: string) {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 60_000) {
    const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolveWait) => setTimeout(resolveWait, 750));
    }
  }
  throw new Error(`Local smoke database did not become ready within 60s: ${String(lastError)}`);
}

async function prepareLocalInfra() {
  requireLocalDatabase(process.env.DATABASE_URL ?? "");
  if (process.env.NOISIA_SIGNAL_PULSE_SMOKE_SKIP_DOCKER !== "true") {
    try {
      await run("docker", ["compose", "-f", composeFile, "--profile", "migration-smoke", "up", "-d", "postgres-smoke", "redis"], {
        cwd: repoRoot
      });
    } catch (error) {
      throw new Error(
        [
          "Could not start the disposable Signal Pulse smoke services.",
          "Start Docker Desktop, or provide local Postgres/Redis and set NOISIA_SIGNAL_PULSE_SMOKE_SKIP_DOCKER=true.",
          String(error)
        ].join(" ")
      );
    }
  }
  await waitForDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  await run("pnpm", ["exec", "tsx", "scripts/smoke-migrations.ts"], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_SSL: "false",
      NOISIA_DB_SMOKE_RESET_SCHEMA: "true"
    }
  });
}

let clientQueryChain = Promise.resolve();

async function q<T extends Row = Row>(client: pg.Client, sql: string, params: unknown[] = []) {
  const query = clientQueryChain.then(() => client.query<T>(sql, params));
  clientQueryChain = query.then(() => undefined, () => undefined);
  return query;
}

async function one<T extends Row = Row>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await q<T>(client, sql, params);
  const row = result.rows[0];
  if (!row) throw new Error(`Expected one row for SQL: ${sql.slice(0, 120)}`);
  return row;
}

function buildMentionRows() {
  const rows: Array<{ date: string; platform: string; text: string; sentiment: number; engagement: number }> = [];
  const platforms = ["TikTok", "Instagram", "YouTube", "Reviews", "X"];
  for (let month = 0; month < 12; month += 1) {
    const date = new Date(Date.UTC(2025, month, 8));
    const iso = date.toISOString().slice(0, 10);
    const platform = platforms[month % platforms.length] ?? "TikTok";
    rows.push({
      date: iso,
      platform,
      sentiment: 0.42,
      engagement: 120 + month * 9,
      text: `La comunidad repite que Aurora Snack gana cuando el ritual crujiente se siente ligero, compartible y perfecto para una tarde con amigos.`
    });
    rows.push({
      date: iso,
      platform: platforms[(month + 1) % platforms.length] ?? "Instagram",
      sentiment: 0.28,
      engagement: 86 + month * 7,
      text: `El ritual crujiente aparece en comentarios sobre lunch, series y antojo sin culpa; la gente pide porciones pequenas y sabor intenso.`
    });
    rows.push({
      date: iso,
      platform: platforms[(month + 2) % platforms.length] ?? "YouTube",
      sentiment: -0.31,
      engagement: 74 + month * 5,
      text: `La barrera mas repetida es precio y bolsa pequena: si el snack cuesta mas, necesitan prueba clara de ingredientes reales.`
    });
    rows.push({
      date: iso,
      platform: platforms[(month + 3) % platforms.length] ?? "Reviews",
      sentiment: -0.18,
      engagement: 64 + month * 4,
      text: `Tambien aparece duda por ingredientes y ultraprocesado; quieren entender que tiene el snack antes de comprar otra bolsa.`
    });
  }
  return rows;
}

async function seedSignalPulseCorpus(client: pg.Client) {
  await client.query("BEGIN");
  try {
    const organization = await one<{ id: string }>(
      client,
      `INSERT INTO organizations (slug, legal_name, display_name, status)
       VALUES ('signal-pulse-smoke-org', 'Signal Pulse Smoke Org', 'Signal Pulse Smoke Org', 'active')
       RETURNING id::text`
    );
    const user = await one<{ id: string }>(
      client,
      `INSERT INTO users (email, full_name, user_type, primary_role, organization_id, status)
       VALUES ('signal-pulse-smoke@noisia.local', 'Signal Pulse Smoke', 'internal', 'admin', $1, 'active')
       RETURNING id::text`,
      [organization.id]
    );
    const methodology = await one<{ id: string; version: string }>(
      client,
      `INSERT INTO methodologies (slug, name, version, status, manifest_yaml, default_blocks, scrollytelling_template, ai_prompts, quality_gates)
       VALUES ('signal-pulse', 'Signal Pulse', '0.1', 'beta', $1::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)
       ON CONFLICT (slug, version)
       DO UPDATE SET status = EXCLUDED.status, manifest_yaml = EXCLUDED.manifest_yaml, updated_at = NOW()
       RETURNING id::text, version`,
      [JSON.stringify({ slug: "signal-pulse", smoke: true })]
    );
    const brand = await one<{ id: string }>(
      client,
      `INSERT INTO brands (organization_id, slug, name, display_name, industry, countries, status)
       VALUES ($1, 'aurora-snack-smoke', 'Aurora Snack Smoke', 'Aurora Snack', 'Food & Beverage', ARRAY['MX']::char(2)[], 'active')
       RETURNING id::text`,
      [organization.id]
    );
    const corpus = await one<{ id: string }>(
      client,
      `INSERT INTO study_corpora (
         name, brand_id, methodology_id, methodology_version_at_creation,
         business_question, decision_to_inform, audience_segment, geo_focus,
         target_window_months, context_form, analysis_plan, status,
         current_pipeline_version, insights_manager_user_id, corpus_first_approved_at
       )
       VALUES (
         'Aurora Snack - Signal Pulse Smoke', $1, $2, $3,
         '¿Qué señales mensuales debería activar Marketing para crecer sin prometer de más?',
         'Priorizar claims, pauta y contenidos del siguiente mes.',
         'Compradores de snacks en Mexico', ARRAY['MX']::char(2)[],
         12, '{}'::jsonb, $4::jsonb, 'approved', 'signal_pulse_smoke_v1', $5, NOW()
       )
       RETURNING id::text`,
      [
        brand.id,
        methodology.id,
        methodology.version,
        JSON.stringify({
          version: 1,
          primary_methodology_slug: "signal-pulse",
          selected_lenses: ["signal-pulse"],
          lens_configs: { "signal-pulse": { runtime: "signal_pulse_pipeline" } },
          composer_modules: ["signal_pulse"],
          budget_cap_usd: 5,
          marketing_brief: {
            objectives: "Decidir territorios de contenido y pauta para el siguiente mes.",
            active_campaigns: ["Ritual crujiente"],
            allowed_claims: ["ingredientes reales", "antojo ligero"],
            prohibited_claims: ["salud clinica", "bajar de peso"]
          }
        }),
        user.id
      ]
    );
    const iteration = await one<{ id: string }>(
      client,
      `INSERT INTO query_iterations (study_corpus_id, iteration_number, query_text, mentions_returned, insights_manager_decision, decision_at)
       VALUES ($1, 1, 'Aurora Snack ritual crujiente ingredientes precio', 48, 'approved', NOW())
       RETURNING id::text`,
      [corpus.id]
    );
    const queryPack = await one<{ id: string }>(
      client,
      `INSERT INTO query_packs (
         study_corpus_id, query_iteration_id, lens_slug, signal_intent, scope, objective,
         query_text, query_components, seeds, evaluation, status, mentions_returned,
         quality_score, density_score, noise_score, cost_budget, created_by_user_id,
         evaluated_at, approved_at
       )
       VALUES ($1, $2, 'signal-pulse', 'marketing_signals', 'brand',
         'Capturar señales mensuales accionables para marketing.',
         'Aurora Snack ritual crujiente ingredientes precio',
         '{}'::jsonb, '{}'::jsonb, '{"smoke":true}'::jsonb, 'approved', 48,
         88, 0.72, 0.08, '{"estimated_usd":0}'::jsonb, $3, NOW(), NOW()
       )
       RETURNING id::text`,
      [corpus.id, iteration.id, user.id]
    );
    const batch = await one<{ id: string }>(
      client,
      `INSERT INTO import_batches (
         study_corpus_id, source_system, source_file_name, source_file_hash,
         imported_by_user_id, record_count, included_count, excluded_count,
         duplicate_count, status
       )
       VALUES ($1, 'signal_pulse_smoke', 'signal-pulse-smoke.csv', $2, $3, 48, 48, 0, 0, 'completed')
       RETURNING id::text`,
      [corpus.id, hash(`batch:${corpus.id}`), user.id]
    );

    const mentions = buildMentionRows();
    for (const [index, mention] of mentions.entries()) {
      const mentionRow = await one<{ id: string }>(
        client,
        `INSERT INTO mentions (
           study_corpus_id, external_id, source_system, source_file_id, text_hash,
           text_raw, text_clean, text_snippet, text_length, language,
           published_at, platform, resolved_platform, country, engagement,
           sentiment_source, sentiment_score, quality_score, inclusion_status, raw_metadata
         )
         VALUES ($1, $2, 'signal_pulse_smoke', $3, $4, $5, $5, $6, $7, 'es',
           $8::date, $9, $9, 'MX', $10::jsonb, 'provider_or_llm_proxy', $11,
           92, 'included', $12::jsonb)
         RETURNING id::text`,
        [
          corpus.id,
          `sp-smoke-${index}`,
          batch.id,
          hash(`${corpus.id}:${mention.text}:${mention.date}:${index}`),
          mention.text,
          mention.text.slice(0, 220),
          mention.text.length,
          mention.date,
          mention.platform,
          JSON.stringify({ total: mention.engagement }),
          mention.sentiment,
          JSON.stringify({ smoke: true })
        ]
      );
      await q(
        client,
        `INSERT INTO mention_query_sources (
           mention_id, study_corpus_id, query_pack_id, query_iteration_id, import_batch_id,
           lens_slug, signal_intent, scope, match_quality, match_reason, metadata
         )
         VALUES ($1, $2, $3, $4, $5, 'signal-pulse', 'marketing_signals', 'brand', 0.94, 'signal_pulse_smoke', '{"smoke":true}'::jsonb)`,
        [mentionRow.id, corpus.id, queryPack.id, iteration.id, batch.id]
      );
    }

    const dataSource = await one<{ id: string }>(
      client,
      `INSERT INTO data_sources (
         study_corpus_id, organization_id, brand_id, source_type, provider,
         connection_method, name, mapping, mapping_version, role, status, visibility
       )
       VALUES ($1, $2, $3, 'performance', 'meta', 'file_upload', 'Meta smoke performance',
         '{"record_date":"date"}'::jsonb, 1, '{"feeds":["paid_organic","chart_aggregates"]}'::jsonb, 'active', 'internal')
       RETURNING id::text`,
      [corpus.id, organization.id, brand.id]
    );
    const coverageStart = "2025-01-12";
    const coverageEnd = "2025-12-12";
    for (let month = 0; month < 12; month += 1) {
      const date = new Date(Date.UTC(2025, month, 12)).toISOString().slice(0, 10);
      await q(
        client,
        `INSERT INTO performance_records (
           study_corpus_id, data_source_id, external_id, entity_kind, entity_name,
           platform, channel, objective, record_date, granularity,
           spend, impressions, reach, clicks, engagement, conversions,
           ctr, cpm, cpc, creative_text, metrics, raw_metadata
         )
         VALUES ($1, $2, $3, 'campaign', 'Ritual crujiente always-on',
           'meta', 'paid', 'consideration', $4::date, 'day',
           $5, $6, $7, $8, $9, $10, $11, $12, $13,
           'Ritual crujiente con ingredientes reales', $14::jsonb, '{"smoke":true}'::jsonb)`,
        [
          corpus.id,
          dataSource.id,
          `meta-campaign-${month}`,
          date,
          900 + month * 35,
          48_000 + month * 1300,
          36_000 + month * 900,
          1_200 + month * 60,
          2_400 + month * 80,
          32 + month,
          0.025 + month * 0.0004,
          18.5,
          0.72,
          JSON.stringify({ spend: 900 + month * 35, clicks: 1_200 + month * 60 })
        ]
      );
    }
    await q(
      client,
      `INSERT INTO source_sync_runs (
         data_source_id, status, records_total, records_valid, records_duplicate,
         records_failed, coverage_start, coverage_end, finished_at
       )
       VALUES ($1, 'completed', 12, 12, 0, 0, $2::date, $3::date, NOW())`,
      [dataSource.id, coverageStart, coverageEnd]
    );

    const analysis = await one<{ id: string }>(
      client,
      `INSERT INTO engine_analyses (
         study_corpus_id, methodology_slug, methodology_version, pipeline_version,
         status, current_step, business_question, params, meta_json, executed_by_user_id
       )
       VALUES ($1, 'signal-pulse', '0.1', 'signal_pulse_smoke_v1',
         'queued', 'sp_readiness', $2, '{"budget_cap_usd":5,"window_months":12}'::jsonb,
         '{"smoke":true}'::jsonb, $3)
       RETURNING id::text`,
      [corpus.id, "¿Qué señales mensuales debería activar Marketing para crecer sin prometer de más?", user.id]
    );

    await client.query("COMMIT");
    return { analysisId: analysis.id, brandId: brand.id, corpusId: corpus.id, dataSourceId: dataSource.id, userId: user.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function mockJob(engineAnalysisId: string, pipelineStepId: string): Job<{ engineAnalysisId: string; pipelineStepId: string }> {
  return {
    data: { engineAnalysisId, pipelineStepId },
    updateProgress: async () => undefined
  } as unknown as Job<{ engineAnalysisId: string; pipelineStepId: string }>;
}

async function nextStep(client: pg.Client, engineAnalysisId: string, step: StepName) {
  const row = await one<{ id: string }>(
    client,
    `SELECT id::text
     FROM engine_pipeline_steps
     WHERE engine_analysis_id = $1
       AND step = $2
       AND status = 'queued'
     ORDER BY created_at DESC
     LIMIT 1`,
    [engineAnalysisId, step]
  );
  return row.id;
}

async function runSignalPulsePipeline(client: pg.Client, engineAnalysisId: string) {
  const {
    signalPulseReadinessJob,
    signalPulsePeriodsJob,
    signalPulseClusterJob,
    signalPulseNameSignalsJob,
    signalPulseMetricsJob,
    signalPulseInterpretJob,
    signalPulseMovesJob,
    signalPulseChartsJob,
    signalPulseGatesJob
  } = await import("../src/workers/signal-pulse-steps.js");

  const first = await one<{ id: string }>(
    client,
    `INSERT INTO engine_pipeline_steps (engine_analysis_id, step, status, attempt)
     VALUES ($1, 'sp_readiness', 'queued', 1)
     RETURNING id::text`,
    [engineAnalysisId]
  );
  await signalPulseReadinessJob(mockJob(engineAnalysisId, first.id));
  await signalPulsePeriodsJob(mockJob(engineAnalysisId, await nextStep(client, engineAnalysisId, "sp_periods")));
  await signalPulseClusterJob(mockJob(engineAnalysisId, await nextStep(client, engineAnalysisId, "sp_cluster")));
  await signalPulseNameSignalsJob(mockJob(engineAnalysisId, await nextStep(client, engineAnalysisId, "sp_name_signals")));
  await signalPulseMetricsJob(mockJob(engineAnalysisId, await nextStep(client, engineAnalysisId, "sp_metrics")));
  await signalPulseInterpretJob(mockJob(engineAnalysisId, await nextStep(client, engineAnalysisId, "sp_interpret")));
  await signalPulseMovesJob(mockJob(engineAnalysisId, await nextStep(client, engineAnalysisId, "sp_moves")));
  await signalPulseChartsJob(mockJob(engineAnalysisId, await nextStep(client, engineAnalysisId, "sp_charts")));
  await signalPulseGatesJob(mockJob(engineAnalysisId, await nextStep(client, engineAnalysisId, "sp_gates")));
}

async function publishSignalPulseSmokeOutput(client: pg.Client, ids: SmokeIds) {
  const payload = await buildSmokePublishedPayload(client, ids);
  const output = await one<{ id: string }>(
    client,
    `
      INSERT INTO published_outputs (
        engine_analysis_id, study_corpus_id, brand_id, methodology_slug,
        kind, output_type, status, title, headline, summary, manifest, payload,
        visibility_config, version, created_by_user_id, published_by_user_id, published_at
      )
      VALUES (
        $1, $2, $3, 'signal-pulse',
        'signal_pulse', 'signal_pulse_dashboard', 'published',
        'Aurora Snack - Signal Pulse Smoke',
        'Signal Pulse smoke listo para lectura local.',
        'Reporte tactico mensual generado desde smoke local con fuentes, evidencia, moves y quality gates.',
        $4::jsonb, $5::jsonb, '{"client_default":true,"internal_quality":true}'::jsonb,
        1, $6, $6, NOW()
      )
      ON CONFLICT (engine_analysis_id, output_type)
        WHERE engine_analysis_id IS NOT NULL
      DO UPDATE SET
        status = EXCLUDED.status,
        title = EXCLUDED.title,
        headline = EXCLUDED.headline,
        summary = EXCLUDED.summary,
        manifest = EXCLUDED.manifest,
        payload = EXCLUDED.payload,
        published_by_user_id = EXCLUDED.published_by_user_id,
        published_at = NOW(),
        archived_at = NULL,
        updated_at = NOW()
      RETURNING id::text
    `,
    [
      ids.analysisId,
      ids.corpusId,
      ids.brandId,
      JSON.stringify({
        kind: "signal_pulse",
        version: 1,
        modules: ["overview", "signals", "marketing_moves", "evidence", "sources", "quality_settings"],
        smoke: true
      }),
      JSON.stringify(payload),
      ids.userId
    ]
  );
  await q(
    client,
    `UPDATE signal_observations
     SET published_output_id = $1
     WHERE engine_analysis_id = $2
       AND published_output_id IS NULL`,
    [output.id, ids.analysisId]
  );
  return output.id;
}

async function buildSmokePublishedPayload(client: pg.Client, ids: SmokeIds) {
  const [analysis, corpus, periods, signals, moves, charts, evidence, sources, performance, cost] = await Promise.all([
    q(client, `SELECT id::text, meta_json FROM engine_analyses WHERE id = $1`, [ids.analysisId]),
    q(client, `SELECT id::text, name, business_question FROM study_corpora WHERE id = $1`, [ids.corpusId]),
    q(
      client,
      `SELECT id::text, label, period_start::text, period_end::text, coverage, comparable, confidence, known_gaps
       FROM report_periods
       WHERE study_corpus_id = $1 AND granularity = 'month'
       ORDER BY period_start`,
      [ids.corpusId]
    ),
    q(
      client,
      `
        WITH latest AS (
          SELECT DISTINCT ON (spm.canonical_signal_id) spm.*
          FROM signal_period_metrics spm
          JOIN report_periods rp ON rp.id = spm.period_id
          WHERE spm.study_corpus_id = $1
          ORDER BY spm.canonical_signal_id, rp.period_start DESC
        )
        SELECT
          cs.id::text AS id,
          cs.canonical_title AS title,
          cs.description,
          cs.signal_type,
          cs.dimensions,
          latest.volume,
          latest.impact_v1::text AS impact_v1,
          latest.sentiment_score::text AS sentiment_score,
          latest.polarity_bucket,
          latest.dominant_emotion,
          latest.source_mix,
          latest.evidence_count,
          latest.confidence,
          latest.delta_prev::text AS delta_prev,
          latest.lifecycle_state
        FROM canonical_signals cs
        JOIN latest ON latest.canonical_signal_id = cs.id
        WHERE cs.study_corpus_id = $1
          AND cs.methodology_slug = 'signal-pulse'
          AND cs.status <> 'archived'
        ORDER BY COALESCE(latest.impact_v1, 0) DESC, latest.volume DESC
        LIMIT 80
      `,
      [ids.corpusId]
    ),
    q(
      client,
      `SELECT id::text, move_type, action_text, signal_refs::text[], evidence_refs, owner_suggestion,
              timing, measurement_suggestion, no_go_notes, confidence, status, position
       FROM marketing_moves
       WHERE study_corpus_id = $1 AND engine_analysis_id = $2
       ORDER BY position NULLS LAST, created_at`,
      [ids.corpusId, ids.analysisId]
    ),
    q(
      client,
      `SELECT chart_key, payload, algo_version, computed_at::text
       FROM chart_aggregates
       WHERE study_corpus_id = $1
       ORDER BY chart_key`,
      [ids.corpusId]
    ),
    q(
      client,
      `
        SELECT
          so.canonical_signal_id::text AS signal_id,
          soe.id::text AS evidence_id,
          soe.mention_id::text,
          soe.quote,
          soe.evidence_role,
          soe.is_protagonist,
          m.resolved_platform AS platform,
          m.published_at::text,
          m.url
        FROM signal_observations so
        JOIN signal_observation_evidence soe ON soe.signal_observation_id = so.id
        LEFT JOIN mentions m ON m.id = soe.mention_id
        WHERE so.study_corpus_id = $1
          AND so.engine_analysis_id = $2
        ORDER BY so.rank NULLS LAST, soe.is_protagonist DESC, soe.position ASC
        LIMIT 240
      `,
      [ids.corpusId, ids.analysisId]
    ),
    q(
      client,
      `
        SELECT
          ds.id::text,
          ds.source_type,
          ds.provider,
          ds.connection_method,
          ds.name,
          ds.status,
          ds.visibility,
          ds.mapping_version,
          ds.role,
          latest_sync.status AS sync_status,
          latest_sync.records_total,
          latest_sync.records_valid,
          latest_sync.records_duplicate,
          latest_sync.records_failed,
          latest_sync.coverage_start::text,
          latest_sync.coverage_end::text,
          latest_sync.finished_at::text
        FROM data_sources ds
        LEFT JOIN LATERAL (
          SELECT ssr.*
          FROM source_sync_runs ssr
          WHERE ssr.data_source_id = ds.id
          ORDER BY ssr.created_at DESC
          LIMIT 1
        ) latest_sync ON true
        WHERE ds.study_corpus_id = $1
        ORDER BY ds.source_type, ds.created_at
      `,
      [ids.corpusId]
    ),
    q(
      client,
      `
        WITH period_performance AS (
          SELECT
            rp.id::text AS period_id,
            rp.label,
            rp.period_start::text,
            rp.period_end::text,
            COALESCE(SUM(pr.spend), 0)::float AS spend,
            COALESCE(SUM(pr.impressions), 0)::bigint AS impressions,
            COALESCE(SUM(pr.reach), 0)::bigint AS reach,
            COALESCE(SUM(pr.clicks), 0)::bigint AS clicks,
            COALESCE(SUM(pr.video_views), 0)::bigint AS video_views,
            COALESCE(SUM(pr.engagement), 0)::bigint AS engagement,
            COALESCE(SUM(pr.conversions), 0)::float AS conversions,
            COUNT(DISTINCT pr.external_id)::int AS entities,
            COUNT(pr.id)::int AS records
          FROM report_periods rp
          LEFT JOIN performance_records pr
            ON pr.study_corpus_id = rp.study_corpus_id
           AND pr.record_date >= rp.period_start
           AND pr.record_date <= rp.period_end
          WHERE rp.study_corpus_id = $1
            AND rp.granularity = 'month'
          GROUP BY rp.id, rp.label, rp.period_start, rp.period_end
          ORDER BY rp.period_start
        ),
        campaign_rows AS (
          SELECT
            pr.external_id,
            COALESCE(pr.entity_name, pr.external_id) AS entity_name,
            pr.entity_kind,
            pr.platform,
            pr.channel,
            COALESCE(SUM(pr.spend), 0)::float AS spend,
            COALESCE(SUM(pr.impressions), 0)::bigint AS impressions,
            COALESCE(SUM(pr.clicks), 0)::bigint AS clicks,
            COALESCE(SUM(pr.engagement), 0)::bigint AS engagement,
            MIN(pr.record_date)::text AS first_seen,
            MAX(pr.record_date)::text AS last_seen,
            COUNT(*)::int AS records
          FROM performance_records pr
          WHERE pr.study_corpus_id = $1
          GROUP BY pr.external_id, pr.entity_name, pr.entity_kind, pr.platform, pr.channel
          ORDER BY COALESCE(SUM(pr.spend), 0) DESC, COALESCE(SUM(pr.impressions), 0) DESC
          LIMIT 40
        ),
        creative_rows AS (
          SELECT
            pr.creative_text,
            pr.platform,
            pr.channel,
            COALESCE(SUM(pr.spend), 0)::float AS spend,
            COALESCE(SUM(pr.impressions), 0)::bigint AS impressions,
            COALESCE(SUM(pr.clicks), 0)::bigint AS clicks,
            COALESCE(SUM(pr.engagement), 0)::bigint AS engagement,
            COUNT(*)::int AS records
          FROM performance_records pr
          WHERE pr.study_corpus_id = $1
            AND NULLIF(trim(pr.creative_text), '') IS NOT NULL
          GROUP BY pr.creative_text, pr.platform, pr.channel
          ORDER BY COALESCE(SUM(pr.impressions), 0) DESC, COALESCE(SUM(pr.engagement), 0) DESC
          LIMIT 30
        )
        SELECT jsonb_build_object(
          'periods', COALESCE((SELECT jsonb_agg(period_performance) FROM period_performance), '[]'::jsonb),
          'campaigns', COALESCE((SELECT jsonb_agg(campaign_rows) FROM campaign_rows), '[]'::jsonb),
          'creatives', COALESCE((SELECT jsonb_agg(creative_rows) FROM creative_rows), '[]'::jsonb)
        ) AS payload
      `,
      [ids.corpusId]
    ),
    q(
      client,
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS estimated_cost_usd
       FROM engine_cost_events
       WHERE engine_analysis_id = $1
         AND provider <> 'system'`,
      [ids.analysisId]
    )
  ]);
  const topSignal = signals.rows[0] ?? {};
  const topMove = moves.rows[0] ?? {};
  const meta = (analysis.rows[0]?.meta_json ?? {}) as Record<string, unknown>;
  const signalPulseMeta = (meta.signal_pulse ?? {}) as Record<string, unknown>;
  const interpretation = (signalPulseMeta.interpretation ?? {}) as Record<string, unknown>;
  const readiness = (signalPulseMeta.readiness ?? {}) as Record<string, unknown>;
  return {
    kind: "signal_pulse",
    version: 1,
    report: {
      corpus_id: ids.corpusId,
      brand_id: ids.brandId,
      title: corpus.rows[0]?.name ?? "Signal Pulse Smoke",
      business_question: corpus.rows[0]?.business_question ?? "",
      generated_from_engine_analysis_id: ids.analysisId
    },
    executive_read: {
      headline: String(interpretation.headline ?? (topSignal.title ? `${String(topSignal.title)} concentra la prioridad del corte.` : "Todavía no hay señales suficientes.")),
      body: String(interpretation.body ?? (topSignal.volume ? `Tiene ${Number(topSignal.volume)} menciones en el periodo más reciente y confianza ${String(topSignal.confidence ?? "baja")}.` : "Amplía cobertura antes de mover marketing.")),
      action: String(interpretation.action ?? topMove.action_text ?? "Revisar señales con mayor impacto antes de mover presupuesto.")
    },
    periods: periods.rows,
    signals: signals.rows,
    marketing_moves: moves.rows,
    chart_refs: Object.fromEntries(charts.rows.map((row) => [String(row.chart_key), row.payload])),
    evidence: evidence.rows,
    sources: sources.rows,
    performance: performance.rows[0]?.payload ?? { periods: [], campaigns: [], creatives: [] },
    quality_gates: Array.isArray(meta.quality_gates) ? meta.quality_gates : [],
    cost: {
      estimated_cost_usd: Number(cost.rows[0]?.estimated_cost_usd ?? 0),
      budget_cap_usd: Number(readiness.budget_cap_usd ?? 0)
    },
    limitations: Array.isArray(meta.quality_gates)
      ? (meta.quality_gates as Array<Record<string, unknown>>).filter((gate) => gate.passed !== true).map((gate) => String(gate.detail ?? gate.id)).slice(0, 8)
      : []
  };
}

async function verifySignalPulseSmoke(client: pg.Client, ids: SmokeIds & { outputId: string }) {
  const result = await one<{
    analysis_status: string;
    current_step: string;
    completed_steps: number;
    signals: number;
    periods: number;
    metrics: number;
    moves: number;
    charts: number;
    evidence: number;
    performance_records: number;
    data_sources: number;
    sync_runs: number;
    published_outputs: number;
    output_observations: number;
    payload_sources: number;
    payload_signals: number;
    payload_moves: number;
    payload_charts: number;
    payload_evidence: number;
    payload_performance_periods: number;
    payload_performance_campaigns: number;
    payload_performance_creatives: number;
    failed_gates: number;
  }>(
    client,
    `
      SELECT
        (SELECT status FROM engine_analyses WHERE id = $1) AS analysis_status,
        (SELECT current_step FROM engine_analyses WHERE id = $1) AS current_step,
        (
          SELECT COUNT(*)::int
          FROM engine_pipeline_steps
          WHERE engine_analysis_id = $1
            AND step = ANY(ARRAY['sp_readiness','sp_periods','sp_cluster','sp_name_signals','sp_metrics','sp_interpret','sp_moves','sp_charts','sp_gates'])
            AND status = 'completed'
        ) AS completed_steps,
        (SELECT COUNT(*)::int FROM canonical_signals WHERE study_corpus_id = $2 AND methodology_slug = 'signal-pulse') AS signals,
        (SELECT COUNT(*)::int FROM report_periods WHERE study_corpus_id = $2) AS periods,
        (SELECT COUNT(*)::int FROM signal_period_metrics WHERE study_corpus_id = $2) AS metrics,
        (SELECT COUNT(*)::int FROM marketing_moves WHERE study_corpus_id = $2 AND engine_analysis_id = $1) AS moves,
        (SELECT COUNT(*)::int FROM chart_aggregates WHERE study_corpus_id = $2) AS charts,
        (
          SELECT COUNT(*)::int
          FROM signal_observation_evidence soe
          JOIN signal_observations so ON so.id = soe.signal_observation_id
          WHERE so.study_corpus_id = $2 AND so.engine_analysis_id = $1
        ) AS evidence,
        (SELECT COUNT(*)::int FROM performance_records WHERE study_corpus_id = $2) AS performance_records,
        (SELECT COUNT(*)::int FROM data_sources WHERE study_corpus_id = $2) AS data_sources,
        (
          SELECT COUNT(*)::int
          FROM source_sync_runs ssr
          JOIN data_sources ds ON ds.id = ssr.data_source_id
          WHERE ds.study_corpus_id = $2 AND ssr.status = 'completed'
        ) AS sync_runs,
        (SELECT COUNT(*)::int FROM published_outputs WHERE id = $3 AND kind = 'signal_pulse' AND output_type = 'signal_pulse_dashboard' AND status = 'published') AS published_outputs,
        (SELECT COUNT(*)::int FROM signal_observations WHERE engine_analysis_id = $1 AND published_output_id = $3) AS output_observations,
        (SELECT jsonb_array_length(COALESCE(payload->'sources', '[]'::jsonb))::int FROM published_outputs WHERE id = $3) AS payload_sources,
        (SELECT jsonb_array_length(COALESCE(payload->'signals', '[]'::jsonb))::int FROM published_outputs WHERE id = $3) AS payload_signals,
        (SELECT jsonb_array_length(COALESCE(payload->'marketing_moves', '[]'::jsonb))::int FROM published_outputs WHERE id = $3) AS payload_moves,
        (
          SELECT COUNT(*)::int
          FROM published_outputs po,
               LATERAL jsonb_object_keys(COALESCE(po.payload->'chart_refs', '{}'::jsonb)) AS chart_key
          WHERE po.id = $3
        ) AS payload_charts,
        (SELECT jsonb_array_length(COALESCE(payload->'evidence', '[]'::jsonb))::int FROM published_outputs WHERE id = $3) AS payload_evidence,
        (SELECT jsonb_array_length(COALESCE(payload->'performance'->'periods', '[]'::jsonb))::int FROM published_outputs WHERE id = $3) AS payload_performance_periods,
        (SELECT jsonb_array_length(COALESCE(payload->'performance'->'campaigns', '[]'::jsonb))::int FROM published_outputs WHERE id = $3) AS payload_performance_campaigns,
        (SELECT jsonb_array_length(COALESCE(payload->'performance'->'creatives', '[]'::jsonb))::int FROM published_outputs WHERE id = $3) AS payload_performance_creatives,
        (
          SELECT COUNT(*)::int
          FROM engine_analyses ea,
               LATERAL jsonb_to_recordset(COALESCE(ea.meta_json->'quality_gates', '[]'::jsonb)) AS gate(id text, passed boolean, detail text)
          WHERE ea.id = $1 AND gate.passed = false
        ) AS failed_gates
    `,
    [ids.analysisId, ids.corpusId, ids.outputId]
  );

  const failures = [
    result.analysis_status !== "needs_review" ? `analysis_status=${result.analysis_status}` : null,
    result.current_step !== "sp_gates" ? `current_step=${result.current_step}` : null,
    result.completed_steps !== 9 ? `completed_steps=${result.completed_steps}` : null,
    result.signals < 3 ? `signals=${result.signals}` : null,
    result.periods < 12 ? `periods=${result.periods}` : null,
    result.metrics <= 0 ? `metrics=${result.metrics}` : null,
    result.moves <= 0 ? `moves=${result.moves}` : null,
    result.charts < 4 ? `charts=${result.charts}` : null,
    result.evidence <= 0 ? `evidence=${result.evidence}` : null,
    result.performance_records < 12 ? `performance_records=${result.performance_records}` : null,
    result.data_sources <= 0 ? `data_sources=${result.data_sources}` : null,
    result.sync_runs <= 0 ? `sync_runs=${result.sync_runs}` : null,
    result.published_outputs !== 1 ? `published_outputs=${result.published_outputs}` : null,
    result.output_observations <= 0 ? `output_observations=${result.output_observations}` : null,
    result.payload_sources <= 0 ? `payload_sources=${result.payload_sources}` : null,
    result.payload_signals < 3 ? `payload_signals=${result.payload_signals}` : null,
    result.payload_moves <= 0 ? `payload_moves=${result.payload_moves}` : null,
    result.payload_charts < 4 ? `payload_charts=${result.payload_charts}` : null,
    result.payload_evidence <= 0 ? `payload_evidence=${result.payload_evidence}` : null,
    result.payload_performance_periods < 12 ? `payload_performance_periods=${result.payload_performance_periods}` : null,
    result.payload_performance_campaigns <= 0 ? `payload_performance_campaigns=${result.payload_performance_campaigns}` : null,
    result.payload_performance_creatives <= 0 ? `payload_performance_creatives=${result.payload_performance_creatives}` : null,
    result.failed_gates > 0 ? `failed_gates=${result.failed_gates}` : null
  ].filter(Boolean);

  if (failures.length > 0) {
    throw new Error(`Signal Pulse smoke failed: ${failures.join(", ")}`);
  }
  return result;
}

async function main() {
  await prepareLocalInfra();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await client.connect();
  try {
    const ids = await seedSignalPulseCorpus(client);
    await runSignalPulsePipeline(client, ids.analysisId);
    const outputId = await publishSignalPulseSmokeOutput(client, ids);
    const verification = await verifySignalPulseSmoke(client, { ...ids, outputId });
    console.log(JSON.stringify({ ok: true, ...ids, outputId, pulsePath: `/pulse/${outputId}`, verification }, null, 2));
  } finally {
    await client.end();
    const { pool } = await import("../src/db/client.js");
    await pool.end().catch(() => undefined);
    const { redisConnection } = await import("../src/queues/query-engine.js");
    await redisConnection.quit().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
