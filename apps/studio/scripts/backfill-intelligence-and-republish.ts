import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import { brands, methodologies, publishedOutputs, studyCorpora, themes } from "@noisia/db";

type DbClient = typeof import("../src/lib/db").db;
type PgPool = typeof import("../src/lib/db").pool;
type QueueGetter = typeof import("../src/lib/queue/query-engine").getQueryEngineQueue;

let db: DbClient;
let pool: PgPool;
let getQueryEngineQueue: QueueGetter;
let getTbAnalysisForCorpus: typeof import("../src/lib/data/corpora").getTbAnalysisForCorpus;
let buildSignalPayload: typeof import("../src/lib/signal/build").buildSignalPayload;
let normalizeSignalManifest: typeof import("../src/lib/signal/build").normalizeSignalManifest;
let defaultSignalManifest: typeof import("../src/lib/signal/manifest").defaultSignalManifest;
let signalPayloadVersion = 3;

type CliOptions = {
  apply: boolean;
  republish: boolean;
  force: boolean;
  embeddings: boolean;
  limit: number;
  analysisId?: string;
  outputId?: string;
  analysisStatuses: string[];
  outputStatuses: string[];
};

type AnalysisRow = {
  id: string;
  study_corpus_id: string;
  meta_json: unknown;
  status: string;
};

type OutputRow = {
  id: string;
  tbAnalysisId: string;
  studyCorpusId: string;
  title: string;
  headline: string | null;
  summary: string | null;
  manifest: unknown;
  payload: unknown;
  version: number;
  status: string;
};

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  loadEnvFile(resolve(process.cwd(), ".env"));

  const dbModule = await import("../src/lib/db");
  const dataModule = await import("../src/lib/data/corpora");
  const signalBuildModule = await import("../src/lib/signal/build");
  const signalContractsModule = await import("../src/lib/signal/contracts");
  const signalManifestModule = await import("../src/lib/signal/manifest");
  const queueModule = await import("../src/lib/queue/query-engine");

  db = dbModule.db;
  pool = dbModule.pool;
  getTbAnalysisForCorpus = dataModule.getTbAnalysisForCorpus;
  buildSignalPayload = signalBuildModule.buildSignalPayload;
  normalizeSignalManifest = signalBuildModule.normalizeSignalManifest;
  defaultSignalManifest = signalManifestModule.defaultSignalManifest;
  signalPayloadVersion = signalContractsModule.SIGNAL_PAYLOAD_VERSION;
  getQueryEngineQueue = queueModule.getQueryEngineQueue;

  const options = parseArgs(process.argv.slice(2));
  const analyses = await loadAnalyses(options);

  let insights = 0;
  let openSignals = 0;
  let embeddingJobs = 0;

  for (const analysis of analyses) {
    const meta = recordValue(analysis.meta_json);
    if (options.apply && options.force) {
      await pool.query(`DELETE FROM tb_insights WHERE tb_analysis_id = $1`, [analysis.id]);
      await pool.query(`DELETE FROM tb_open_signals WHERE tb_analysis_id = $1`, [analysis.id]);
    }

    const openSignalItems = arrayRecords(meta.open_signals);
    const derivedOpenSignals = openSignalItems.length > 0
      ? openSignalItems
      : await deriveOpenSignalsFromCodings(analysis.id);

    const insightCount = await backfillInsights({
      apply: options.apply,
      tbAnalysisId: analysis.id,
      items: arrayRecords(meta.emerging_patterns)
    });
    const openSignalCount = await backfillOpenSignals({
      apply: options.apply,
      tbAnalysisId: analysis.id,
      items: derivedOpenSignals
    });
    insights += insightCount;
    openSignals += openSignalCount;

    if (options.embeddings && options.apply) {
      if (process.env.VOYAGE_API_KEY || process.env.OPENAI_API_KEY) {
        const queue = getQueryEngineQueue();
        await queue.add(
          "embed_corpus_semantics",
          { corpusId: analysis.study_corpus_id, mode: "all" },
          {
            jobId: `semantic-backfill-${analysis.study_corpus_id}-${Date.now()}`,
            attempts: 2,
            backoff: { type: "exponential", delay: 10000 },
            removeOnComplete: { age: 60 * 60 * 24, count: 200 },
            removeOnFail: { age: 60 * 60 * 24 * 7, count: 500 }
          }
        );
        embeddingJobs += 1;
      } else {
        console.warn(`[embeddings-skip] Embedding provider missing for analysis ${analysis.id}`);
      }
    }

    console.log(
      `${options.apply ? "[backfilled]" : "[dry-run]"} ${analysis.id} · insights=${insightCount} open_signals=${openSignalCount}`
    );
  }

  let republished = 0;
  if (options.republish) {
    republished = await republishOutputs(options, analyses.map((analysis) => analysis.id));
  }

  console.log(
    `${options.apply ? "Backfilled" : "Would backfill"} ${analyses.length} analyses: ${insights} insights, ${openSignals} open signals, ${embeddingJobs} embedding jobs, ${republished} republished outputs.`
  );
}

async function deriveOpenSignalsFromCodings(tbAnalysisId: string): Promise<Record<string, unknown>[]> {
  const result = await pool.query<{
    tag: string;
    mention_count: number;
    sample_quote: string | null;
    dominant_channel: string | null;
  }>(
    `
      WITH noisy_tags AS (
        SELECT
          lower(trim(tag)) AS tag,
          c.mention_id,
          CASE
            WHEN lower(COALESCE(m.raw_metadata #>> '{row,domain group}', '')) LIKE '%tiktok%'
              OR lower(COALESCE(m.raw_metadata #>> '{row,domain}', '')) LIKE '%tiktok%'
              OR lower(COALESCE(m.url, '')) LIKE '%tiktok%' THEN 'tiktok'
            WHEN lower(COALESCE(m.raw_metadata #>> '{row,domain group}', '')) LIKE '%instagram%'
              OR lower(COALESCE(m.raw_metadata #>> '{row,domain}', '')) LIKE '%instagram%'
              OR lower(COALESCE(m.url, '')) LIKE '%instagram%' THEN 'instagram'
            WHEN lower(COALESCE(m.raw_metadata #>> '{row,domain group}', '')) LIKE '%twitter%'
              OR lower(COALESCE(m.raw_metadata #>> '{row,domain group}', '')) = 'x'
              OR lower(COALESCE(m.raw_metadata #>> '{row,domain}', '')) LIKE '%twitter%'
              OR lower(COALESCE(m.raw_metadata #>> '{row,domain}', '')) LIKE '%x.com%'
              OR lower(COALESCE(m.url, '')) LIKE '%twitter.com%'
              OR lower(COALESCE(m.url, '')) LIKE '%x.com%' THEN 'x'
            WHEN lower(COALESCE(m.raw_metadata #>> '{row,domain group}', '')) LIKE '%youtube%'
              OR lower(COALESCE(m.raw_metadata #>> '{row,domain}', '')) LIKE '%youtube%'
              OR lower(COALESCE(m.url, '')) LIKE '%youtube%'
              OR lower(COALESCE(m.url, '')) LIKE '%youtu.be%' THEN 'youtube'
            ELSE m.platform
          END AS platform,
          m.text_clean
        FROM tb_mention_codings c
        JOIN mentions m ON m.id = c.mention_id
        CROSS JOIN LATERAL unnest(c.emergent_tags) AS tags(tag)
        WHERE c.tb_analysis_id = $1
          AND (c.finding_id IS NULL OR c.polarity = 'irrelevant' OR c.ambiguous = true)
          AND lower(trim(tag)) <> 'irrelevant'
          AND length(trim(tag)) > 2
      ),
      tag_counts AS (
        SELECT tag, COUNT(DISTINCT mention_id)::int AS mention_count, MIN(text_clean) AS sample_quote
        FROM noisy_tags
        GROUP BY tag
      ),
      channel_rank AS (
        SELECT tag, platform, COUNT(*)::int AS mentions,
               ROW_NUMBER() OVER (PARTITION BY tag ORDER BY COUNT(*) DESC) AS rn
        FROM noisy_tags
        GROUP BY tag, platform
      )
      SELECT
        t.tag,
        t.mention_count,
        t.sample_quote,
        c.platform AS dominant_channel
      FROM tag_counts t
      LEFT JOIN channel_rank c ON c.tag = t.tag AND c.rn = 1
      ORDER BY t.mention_count DESC
      LIMIT 8
    `,
    [tbAnalysisId]
  );

  return result.rows.map((row, index) => ({
    pattern_id: `OS-${String(index + 1).padStart(2, "0")}`,
    title: titleize(row.tag),
    pattern_type: "unexpected_insight",
    why_it_matters: `Aparece en ${row.mention_count} menciones que quedaron fuera o ambiguas en T&B; puede ser una señal adyacente para otra metodología.`,
    data_basis: ["corpus_sql", "noise_plus_signal"],
    evidence_count: row.mention_count,
    source_breakdown: row.dominant_channel ? [{ source: row.dominant_channel, count: row.mention_count }] : [],
    related_finding_ids: [],
    confidence: row.mention_count >= 30 ? "media" : "baja_direccional",
    evidence_quotes: row.sample_quote ? [row.sample_quote.slice(0, 260)] : []
  }));
}

async function loadAnalyses(options: CliOptions): Promise<AnalysisRow[]> {
  const params: unknown[] = [options.analysisStatuses, options.limit];
  const filters = [`status = ANY($1::text[])`];
  if (options.analysisId) {
    params.push(options.analysisId);
    filters.push(`id = $${params.length}::uuid`);
  }

  const result = await pool.query<AnalysisRow>(
    `
      SELECT id, study_corpus_id, meta_json, status
      FROM tb_analyses
      WHERE ${filters.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    params
  );
  return result.rows;
}

async function backfillInsights(args: { apply: boolean; tbAnalysisId: string; items: Record<string, unknown>[] }) {
  let count = 0;
  for (const [position, item] of args.items.entries()) {
    const patternId = stringValue(item.pattern_id) || `EP-${String(position + 1).padStart(2, "0")}`;
    const summary = stringValue(item.why_it_matters);
    if (!summary) continue;
    count += 1;
    if (!args.apply) continue;

    await pool.query(
      `INSERT INTO tb_insights (
         tb_analysis_id, insight_id, kind, title, summary, finding_ids, data_basis,
         source_breakdown, evidence_quotes, confidence, position
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       ON CONFLICT (tb_analysis_id, insight_id) DO UPDATE
       SET kind = EXCLUDED.kind,
           title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           finding_ids = EXCLUDED.finding_ids,
           data_basis = EXCLUDED.data_basis,
           source_breakdown = EXCLUDED.source_breakdown,
           evidence_quotes = EXCLUDED.evidence_quotes,
           confidence = EXCLUDED.confidence,
           position = EXCLUDED.position,
           updated_at = NOW()`,
      [
        args.tbAnalysisId,
        patternId,
        coerceInsightKind(item.pattern_type),
        stringValue(item.title) || "Pattern emergente",
        summary,
        stringArray(item.related_finding_ids),
        stringArray(item.data_basis),
        JSON.stringify(arrayRecords(item.source_breakdown)),
        stringArray(item.evidence_quotes),
        coerceConfidence(item.confidence),
        position
      ]
    );
  }
  return count;
}

async function backfillOpenSignals(args: { apply: boolean; tbAnalysisId: string; items: Record<string, unknown>[] }) {
  let count = 0;
  for (const [position, item] of args.items.entries()) {
    const signalId = stringValue(item.pattern_id) || `OS-${String(position + 1).padStart(2, "0")}`;
    const why = stringValue(item.why_it_matters);
    if (!why) continue;
    count += 1;
    if (!args.apply) continue;

    await pool.query(
      `INSERT INTO tb_open_signals (
         tb_analysis_id, signal_id, title, signal_type, why_it_matters, tags,
         evidence_count, source_breakdown, metrics, evidence_quotes, confidence, position
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)
       ON CONFLICT (tb_analysis_id, signal_id) DO UPDATE
       SET title = EXCLUDED.title,
           signal_type = EXCLUDED.signal_type,
           why_it_matters = EXCLUDED.why_it_matters,
           tags = EXCLUDED.tags,
           evidence_count = EXCLUDED.evidence_count,
           source_breakdown = EXCLUDED.source_breakdown,
           metrics = EXCLUDED.metrics,
           evidence_quotes = EXCLUDED.evidence_quotes,
           confidence = EXCLUDED.confidence,
           position = EXCLUDED.position,
           updated_at = NOW()`,
      [
        args.tbAnalysisId,
        signalId,
        stringValue(item.title) || "Señal abierta",
        coerceInsightKind(item.pattern_type),
        why,
        stringArray(item.data_basis),
        numberValue(item.evidence_count),
        JSON.stringify(arrayRecords(item.source_breakdown)),
        JSON.stringify({ related_finding_ids: stringArray(item.related_finding_ids) }),
        stringArray(item.evidence_quotes),
        coerceConfidence(item.confidence),
        position
      ]
    );
  }
  return count;
}

async function republishOutputs(options: CliOptions, analysisIds: string[]) {
  if (analysisIds.length === 0) return 0;
  const rows = await db
    .select({
      id: publishedOutputs.id,
      tbAnalysisId: publishedOutputs.tbAnalysisId,
      studyCorpusId: publishedOutputs.studyCorpusId,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      manifest: publishedOutputs.manifest,
      payload: publishedOutputs.payload,
      version: publishedOutputs.version,
      status: publishedOutputs.status
    })
    .from(publishedOutputs)
    .where(and(inArray(publishedOutputs.tbAnalysisId, analysisIds), inArray(publishedOutputs.status, options.outputStatuses)))
    .limit(options.limit);

  const outputs = rows.filter((row) => {
    if (options.outputId && row.id !== options.outputId) return false;
    const payload = row.payload && typeof row.payload === "object"
      ? row.payload as Record<string, unknown>
      : {};
    if (!options.force && row.version === signalPayloadVersion && payload.schema_version === signalPayloadVersion) return false;
    return true;
  }) as OutputRow[];

  let republished = 0;
  for (const output of outputs) {
    const corpus = await loadCorpusForBuild(output.studyCorpusId);
    if (!corpus) continue;
    const state = await getTbAnalysisForCorpus(corpus.id, output.tbAnalysisId, { includeAggregates: true });
    if (!state) continue;
    const manifest = normalizeSignalManifest({
      ...defaultSignalManifest,
      ...(output.manifest && typeof output.manifest === "object" ? output.manifest : {})
    });
    const payload = buildSignalPayload({
      state,
      corpus,
      manifest,
      headline: output.headline,
      summary: output.summary
    });

    if (options.apply) {
      await db
        .update(publishedOutputs)
        .set({
          manifest,
          payload,
          version: signalPayloadVersion,
          updatedAt: new Date()
        })
        .where(eq(publishedOutputs.id, output.id));
    }
    republished += 1;
    console.log(`${options.apply ? "[republished]" : "[dry-run republish]"} ${output.id} · ${output.title}`);
  }
  return republished;
}

async function loadCorpusForBuild(corpusId: string) {
  const [corpus] = await db
    .select({
      id: studyCorpora.id,
      brandName: brands.name,
      themeName: themes.name,
      methodologyName: methodologies.name,
      methodologySlug: methodologies.slug,
      businessQuestion: studyCorpora.businessQuestion,
      decisionToInform: studyCorpora.decisionToInform
    })
    .from(studyCorpora)
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, studyCorpora.brandId))
    .leftJoin(themes, eq(themes.id, studyCorpora.themeId))
    .where(eq(studyCorpora.id, corpusId))
    .limit(1);
  return corpus ?? null;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    republish: false,
    force: false,
    embeddings: false,
    limit: 100,
    analysisStatuses: ["approved_by_im", "approved_by_kam"],
    outputStatuses: ["published"]
  };

  for (const arg of args) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--republish") options.republish = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--embeddings") options.embeddings = true;
    else if (arg.startsWith("--limit=")) options.limit = positiveInt(arg.slice("--limit=".length), 100);
    else if (arg.startsWith("--analysis-id=")) options.analysisId = arg.slice("--analysis-id=".length);
    else if (arg.startsWith("--output-id=")) options.outputId = arg.slice("--output-id=".length);
    else if (arg.startsWith("--analysis-status=")) options.analysisStatuses = csv(arg.slice("--analysis-status=".length));
    else if (arg.startsWith("--output-status=")) options.outputStatuses = csv(arg.slice("--output-status=".length));
  }

  return options;
}

function coerceInsightKind(value: unknown) {
  const allowed = new Set([
    "source_pattern",
    "unexpected_insight",
    "language_code",
    "cx_signal",
    "product_signal",
    "content_signal",
    "hypothesis",
    "kb_confirmation",
    "kb_contradiction",
    "kb_nuance"
  ]);
  const kind = stringValue(value);
  return allowed.has(kind) ? kind : "unexpected_insight";
}

function coerceConfidence(value: unknown) {
  const confidence = stringValue(value);
  return confidence === "alta" || confidence === "media" || confidence === "baja_direccional"
    ? confidence
    : "media";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function titleize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end();
  });
