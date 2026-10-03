import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const REQUIRED_MIGRATIONS = [
  "0025_engine_methodologies",
  "0026_live_intelligence_store",
  "0027_query_pack_provenance_backfill",
  "0028_signal_observation_run_uniqueness",
  "0029_engine_cost_ledger",
  "0030_monthly_cut_and_composer",
  "0031_study_analysis_plan",
  "0032_import_batch_query_pack_link",
  "0033_engine_run_mention_map",
  "0034_signal_pulse_foundation"
];

const REQUIRED_ENGINE_METHODOLOGIES = [
  "competitive-wave",
  "value-perception-matrix",
  "journey-friction-mapping",
  "cultural-codes-decoding",
  "influence-architecture",
  "decision-velocity",
  "sentiment-advocacy-proxy",
  "brand-positioning-map",
  "category-opportunity-map",
  "competitive-tb-matrix",
  "narrative-ownership",
  "white-space-analysis",
  "audience-segment-lens",
  "trust-risk-benchmark",
  "evidence-confidence-layer"
];

const REQUIRED_NON_ENGINE_BETA_METHODOLOGIES = [
  "signal-pulse"
];

const SAFE_DEFAULTS = [
  "NOISIA_ENGINE_RUNTIME_ENABLED=false",
  "NOISIA_ENGINE_LLM_ENABLED=false",
  "NOISIA_ENGINE_ALLOW_OPUS=false",
  "NOISIA_ENGINE_FIXTURE_CODING_ENABLED=false",
  "NOISIA_SIGNAL_CHAT_LLM_ENABLED=false",
  "NOISIA_SIGNAL_CHAT_ALLOW_OPUS=false",
  "NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=false",
  "NOISIA_DB_SEED_ALLOW_REMOTE=false"
];

type MethodologySeed = {
  slug?: unknown;
  status?: unknown;
};

function fail(message: string): never {
  throw new Error(message);
}

function assertEmpty(label: string, values: string[]) {
  if (values.length > 0) {
    fail(`${label}: ${values.join(", ")}`);
  }
}

async function verifyMigrations(dbRoot: string) {
  const migrationsDir = join(dbRoot, "migrations");
  const migrationFiles = await readdir(migrationsDir);
  const migrationTags = new Set(
    migrationFiles
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .map((file) => file.replace(/\.sql$/, ""))
  );

  const journal = JSON.parse(await readFile(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
    entries?: Array<{ tag?: string }>;
  };
  const journalTags = new Set((journal.entries ?? []).map((entry) => entry.tag).filter(Boolean));

  assertEmpty(
    "Missing migration files",
    REQUIRED_MIGRATIONS.filter((tag) => !migrationTags.has(tag))
  );
  assertEmpty(
    "Missing journal entries",
    REQUIRED_MIGRATIONS.filter((tag) => !journalTags.has(tag))
  );
}

async function verifyMethodologySeeds(repoRoot: string) {
  const seedsDir = join(repoRoot, "docs", "product", "10_methodology_seeds");
  const files = (await readdir(seedsDir)).filter((file) => file.endsWith(".yaml")).sort();
  const betaSeeds = new Map<string, string>();

  for (const file of files) {
    const parsed = YAML.parse(await readFile(join(seedsDir, file), "utf8")) as MethodologySeed;
    if (parsed?.status !== "beta" || typeof parsed.slug !== "string") continue;
    betaSeeds.set(parsed.slug, file);
  }

  assertEmpty(
    "Missing beta methodology seeds",
    REQUIRED_ENGINE_METHODOLOGIES.filter((slug) => !betaSeeds.has(slug))
  );
  assertEmpty(
    "Missing non-engine beta methodology seeds",
    REQUIRED_NON_ENGINE_BETA_METHODOLOGIES.filter((slug) => !betaSeeds.has(slug))
  );
  assertEmpty(
    "Unexpected beta methodology seeds",
    [...betaSeeds.keys()].filter((slug) => ![...REQUIRED_ENGINE_METHODOLOGIES, ...REQUIRED_NON_ENGINE_BETA_METHODOLOGIES].includes(slug))
  );
}

async function verifySafeDefaults(repoRoot: string) {
  const envExample = await readFile(join(repoRoot, "apps", "studio", ".env.example"), "utf8");
  assertEmpty(
    "Missing safe env defaults",
    SAFE_DEFAULTS.filter((line) => !envExample.includes(line))
  );
}

async function main() {
  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = dirname(dirname(dbRoot));

  await verifyMigrations(dbRoot);
  await verifyMethodologySeeds(repoRoot);
  await verifySafeDefaults(repoRoot);

  console.log(JSON.stringify({
    ok: true,
    checked: {
      migrations: REQUIRED_MIGRATIONS.length,
      beta_methodologies: REQUIRED_ENGINE_METHODOLOGIES.length,
      non_engine_beta_methodologies: REQUIRED_NON_ENGINE_BETA_METHODOLOGIES.length,
      safe_defaults: SAFE_DEFAULTS.length
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
