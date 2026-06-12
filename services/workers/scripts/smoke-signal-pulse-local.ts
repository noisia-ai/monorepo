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
type StepName = "sp_readiness" | "sp_periods" | "sp_cluster" | "sp_name_signals" | "sp_metrics";

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

async function q<T extends Row = Row>(client: pg.Client, sql: string, params: unknown[] = []) {
  return client.query<T>(sql, params);
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
         'Que senales mensuales deberia activar marketing para crecer sin prometer de mas?',
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
         'Capturar senales mensuales accionables para marketing.',
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
      [corpus.id, "Que senales mensuales deberia activar marketing para crecer sin prometer de mas?", user.id]
    );

    await client.query("COMMIT");
    return { analysisId: analysis.id, corpusId: corpus.id };
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
    signalPulseMetricsJob
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
}

async function verifySignalPulseSmoke(client: pg.Client, ids: { analysisId: string; corpusId: string }) {
  const result = await one<{
    analysis_status: string;
    signals: number;
    periods: number;
    metrics: number;
    moves: number;
    charts: number;
    evidence: number;
    performance_records: number;
    failed_gates: number;
  }>(
    client,
    `
      SELECT
        (SELECT status FROM engine_analyses WHERE id = $1) AS analysis_status,
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
        (
          SELECT COUNT(*)::int
          FROM engine_analyses ea,
               LATERAL jsonb_to_recordset(COALESCE(ea.meta_json->'quality_gates', '[]'::jsonb)) AS gate(id text, passed boolean, detail text)
          WHERE ea.id = $1 AND gate.passed = false
        ) AS failed_gates
    `,
    [ids.analysisId, ids.corpusId]
  );

  const failures = [
    result.analysis_status !== "needs_review" ? `analysis_status=${result.analysis_status}` : null,
    result.signals < 3 ? `signals=${result.signals}` : null,
    result.periods < 12 ? `periods=${result.periods}` : null,
    result.metrics <= 0 ? `metrics=${result.metrics}` : null,
    result.moves <= 0 ? `moves=${result.moves}` : null,
    result.charts < 4 ? `charts=${result.charts}` : null,
    result.evidence <= 0 ? `evidence=${result.evidence}` : null,
    result.performance_records < 12 ? `performance_records=${result.performance_records}` : null,
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
    const verification = await verifySignalPulseSmoke(client, ids);
    console.log(JSON.stringify({ ok: true, ...ids, verification }, null, 2));
  } finally {
    await client.end();
    const { pool } = await import("../src/db/client.js");
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
