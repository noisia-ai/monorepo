import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { eq, inArray } from "drizzle-orm";

import { brands, methodologies, publishedOutputs, studyCorpora, themes } from "@noisia/db";

type DbClient = typeof import("../src/lib/db").db;
type PgPool = typeof import("../src/lib/db").pool;

let db: DbClient;
let pool: PgPool;
let getTbAnalysisForCorpus: typeof import("../src/lib/data/corpora").getTbAnalysisForCorpus;
let buildSignalPayload: typeof import("../src/lib/signal/build").buildSignalPayload;
let normalizeSignalManifest: typeof import("../src/lib/signal/build").normalizeSignalManifest;
let defaultSignalManifest: typeof import("../src/lib/signal/manifest").defaultSignalManifest;
let signalPayloadVersion = 2;

type CliOptions = {
  apply: boolean;
  force: boolean;
  limit: number;
  outputId?: string;
  analysisId?: string;
  statuses: string[];
};

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  loadEnvFile(resolve(process.cwd(), ".env"));

  const dbModule = await import("../src/lib/db");
  const dataModule = await import("../src/lib/data/corpora");
  const signalBuildModule = await import("../src/lib/signal/build");
  const signalContractsModule = await import("../src/lib/signal/contracts");
  const signalManifestModule = await import("../src/lib/signal/manifest");

  db = dbModule.db;
  pool = dbModule.pool;
  getTbAnalysisForCorpus = dataModule.getTbAnalysisForCorpus;
  buildSignalPayload = signalBuildModule.buildSignalPayload;
  normalizeSignalManifest = signalBuildModule.normalizeSignalManifest;
  defaultSignalManifest = signalManifestModule.defaultSignalManifest;
  signalPayloadVersion = signalContractsModule.SIGNAL_PAYLOAD_VERSION;

  const options = parseArgs(process.argv.slice(2));
  const outputs = await loadCandidateOutputs(options);
  const candidates = outputs.filter((output) => {
    if (options.force) return true;
    const payload = output.payload && typeof output.payload === "object"
      ? output.payload as Record<string, unknown>
      : {};
    return output.version !== signalPayloadVersion || payload.schema_version !== signalPayloadVersion;
  });

  let regenerated = 0;
  for (const output of candidates) {
    const corpus = await loadCorpusForBuild(output.studyCorpusId);
    if (!corpus) {
      console.warn(`[skip] ${output.id} corpus not found (${output.studyCorpusId})`);
      continue;
    }

    const state = await getTbAnalysisForCorpus(corpus.id, output.tbAnalysisId, { includeAggregates: true });
    if (!state) {
      console.warn(`[skip] ${output.id} analysis not found (${output.tbAnalysisId})`);
      continue;
    }

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

    regenerated += 1;
    console.log(
      `${options.apply ? "[updated]" : "[dry-run]"} ${output.id} · ${output.title} · ${output.version} -> ${signalPayloadVersion}${options.force ? " · force" : ""}`
    );
  }

  console.log(
    `${options.apply ? "Republished" : "Would republish"} ${regenerated}/${outputs.length} loaded outputs to Signal payload v${signalPayloadVersion}.`
  );
}

async function loadCandidateOutputs(options: CliOptions) {
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
      status: publishedOutputs.status,
      updatedAt: publishedOutputs.updatedAt
    })
    .from(publishedOutputs)
    .where(inArray(publishedOutputs.status, options.statuses))
    .limit(options.limit);

  return rows.filter((row) => {
    if (options.outputId && row.id !== options.outputId) return false;
    if (options.analysisId && row.tbAnalysisId !== options.analysisId) return false;
    return true;
  });
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
    force: false,
    limit: 100,
    statuses: ["published", "draft"]
  };

  for (const arg of args) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--limit=")) options.limit = positiveInt(arg.slice("--limit=".length), 100);
    else if (arg.startsWith("--output-id=")) options.outputId = arg.slice("--output-id=".length);
    else if (arg.startsWith("--analysis-id=")) options.analysisId = arg.slice("--analysis-id=".length);
    else if (arg.startsWith("--status=")) {
      options.statuses = arg.slice("--status=".length).split(",").map((status) => status.trim()).filter(Boolean);
    }
  }

  return options;
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
