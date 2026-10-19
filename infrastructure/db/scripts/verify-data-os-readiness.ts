import pg from "pg";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getDatabaseSslConfig, requireSafeDatabaseWriteTarget } from "../seeds/connection.js";

const execFileAsync = promisify(execFile);
const REQUIRED_MIGRATIONS = [
  "0035_data_os_foundation",
  "0036_data_os_observations",
  "0037_engine_validation_separation",
  "0038_query_validation_lineage",
  "0039_query_validation_imported_evidence",
  "0040_data_os_semantic_observation_contract",
  "0041_tb_data_os_coding_bridge",
  "0042_data_os_static_catalog_semantics",
  "0043_data_os_asset_records_metric_catalog",
  "0044_query_pack_entity_identity",
  "0045_signal_serving_entities",
  "0046_analysis_artifact_evidence_graph",
  "0047_signal_workspace_identity",
  "0048_signal_recurring_refresh",
  "0049_signal_metric_catalog_v1",
  "0050_signal_metric_materializations_v1",
  "0051_signal_backend_foundation_hardening",
  "0052_signal_metric_interpretations_v1",
  "0053_tb_structured_evidence_review",
  "0054_tb_temporal_strategic_releases",
  "0055_signal_v2_front_ready_indexes"
];
const DATA_OS_BASE_BRANCH = "codex/signal-pulse";
const DATA_OS_WORK_BRANCH = "codex/noisia-data-os-cut-1-wip";

const REQUIRED_TABLES = [
  "data_assets",
  "data_asset_fields",
  "data_contracts",
  "data_quality_rules",
  "data_quality_results",
  "brand_os_profiles",
  "brand_os_objectives",
  "brand_os_briefs",
  "brand_os_audiences",
  "brand_os_products",
  "brand_os_claims",
  "brand_os_campaigns",
  "brand_os_competitors",
  "brand_os_events",
  "brand_os_seed_sets",
  "brand_os_seed_terms",
  "brand_os_links",
  "knowledge_chunks",
  "knowledge_assertions",
  "knowledge_assertion_links",
  "knowledge_assertion_review_events",
  "knowledge_usage_events",
  "taxonomies",
  "taxonomy_terms",
  "taxonomy_term_edges",
  "methodology_taxonomy_bindings",
  "tagging_rule_sets",
  "tagging_model_versions",
  "intelligence_entities",
  "entity_aliases",
  "entity_links",
  "record_entity_links",
  "record_tags",
  "record_feature_values",
  "tag_review_events",
  "lineage_edges",
  "metric_definitions",
  "semantic_models",
  "metric_materializations",
  "dashboard_data_refs",
  "tb_strategic_opportunities",
  "tb_opportunity_findings",
  "tb_action_studio",
  "tb_action_findings",
  "analysis_artifacts",
  "analysis_evidence_groups",
  "analysis_evidence_links",
  "analysis_artifact_relations",
  "analysis_artifact_review_events",
  "published_output_artifacts",
  "signal_workspaces",
  "signal_workspace_corpora",
  "signal_refresh_policies",
  "signal_data_watermarks",
  "signal_refresh_runs",
  "signal_data_invalidations",
  "signal_interpretation_freshness",
  "metric_interpretation_runs",
  "metric_interpretations",
  "metric_interpretation_evidence",
  "tb_finding_structured_evidence_refs",
  "tb_temporal_metrics",
  "tb_finding_temporal_comparisons",
  "signal_workspace_releases",
  "signal_workspace_release_artifacts",
  "signal_workspace_current_releases"
];

const REQUIRED_ROUTES = [
  "apps/studio/src/app/api/data-os/corpora/[id]/brand-os/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/catalog/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/knowledge/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/lineage/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/readiness/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/review-queue/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/artifacts/[artifactId]/review/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/sources/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/source-health/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/taxonomies/route.ts",
  "apps/studio/src/app/api/data-os/corpora/[id]/tags/route.ts",
  "apps/studio/src/app/api/data-os/pulse/[outputId]/live/route.ts",
  "apps/studio/src/app/api/data-os/pulse/[outputId]/corpus/route.ts",
  "apps/studio/src/app/api/data-os/pulse/[outputId]/metrics/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/bootstrap/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/facets/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/metric-groups/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/series/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/breakdowns/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/comparison/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/mentions/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/lineage/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/interpretations/route.ts",
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/releases/route.ts"
];

const REQUIRED_CONTRACT_FILES = [
  "AGENTS.md",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  "scripts/data-os-local-smoke.sh",
  "scripts/data-os-staging-flight-card.example.sh",
  "scripts/data-os-staging-check.sh",
  "scripts/data-os-staging-finalize.sh",
  "scripts/data-os-staging-shadow.sh",
  "docs/AGENT_GUARDRAILS.md",
  "docs/adr/007-noisia-data-os-cut-1.md",
  "docs/adr/008-analysis-artifact-evidence-graph.md",
  "docs/adr/009-signal-always-on-strategic-dashboard.md",
  "docs/BRANCHES.md",
  "docs/product/04_DATABASE_SCHEMA.md",
  "docs/product/06_TECHNICAL_DECISIONS.md",
  "docs/product/08_API_CONTRACTS.md",
  "docs/product/22_NOISIA_DATA_OS_CUT_1.md",
  "docs/product/23_NOISIA_DATA_OS_STAGING_RUNBOOK.md",
  "docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md",
  "docs/product/25_NOISIA_DATA_OS_STAGING_HANDOFF.md",
  "docs/product/26_NOISIA_DATA_OS_COMPLETION_AUDIT.md",
  "docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md",
  "docs/product/32_SIGNAL_BACKEND_EXECUTION_ROADMAP.md",
  "infrastructure/db/seeds/connection.ts",
  "infrastructure/db/scripts/data-os-analyze.ts",
  "infrastructure/db/scripts/data-os-completion-audit.ts",
  "infrastructure/db/scripts/data-os-evidence.ts",
  "infrastructure/db/scripts/data-os-pr-summary.ts",
  "infrastructure/db/scripts/data-os-release-gate.ts",
  "infrastructure/db/scripts/data-os-review-queue.ts",
  "infrastructure/db/scripts/data-os-review-sample.ts",
  "infrastructure/db/scripts/signal-v2-backend-gate.ts",
  "infrastructure/db/scripts/signal-v2-explain.ts",
  "infrastructure/db/scripts/signal-v2-reconcile.ts",
  "infrastructure/db/scripts/validate-data-os-evidence-pack.ts",
  "infrastructure/db/scripts/validate-data-os-local-smoke.ts",
  "apps/studio/scripts/backfill-signal-serving.ts",
  "apps/studio/scripts/backfill-signal-v2.ts",
  "apps/studio/scripts/signal-v2-shadow.ts",
  "apps/studio/scripts/data-os-serving-smoke.ts",
  "apps/studio/src/app/api/corpora/[id]/tb-analysis/[analysisId]/signal-output/route.ts",
  "apps/studio/src/app/pulse/[outputId]/page.tsx",
  "apps/studio/src/lib/data-os/published-signal-overview.ts",
  "apps/studio/src/lib/data-os/analysis-artifact-graph.ts",
  "apps/studio/src/lib/data-os/signal-serving.ts",
  "apps/studio/src/lib/data-os/signal-workspace.ts",
  "apps/studio/src/lib/data-os/signal-workspace-context.ts",
  "apps/studio/src/lib/data-os/signal-workspace-home.ts",
  "apps/studio/src/lib/data-os/signal-workspace-serving.ts",
  "apps/studio/src/lib/data-os/signal-workspace-fixtures.ts",
  "apps/studio/src/lib/signal/semantics.ts",
  "apps/studio/src/app/api/data-os/_lib/load.ts",
  "apps/studio/src/lib/data-os/serving.ts",
  "apps/studio/src/lib/data-os/serving.test.ts",
  "apps/studio/src/lib/data-os/readiness.ts",
  "apps/studio/src/lib/data-os/readiness-state.ts",
  "apps/studio/src/lib/data-os/readiness.test.ts",
  "apps/studio/src/lib/data-os/output-refs.ts",
  "apps/studio/src/lib/data-os/signal-timeline.ts",
  "apps/studio/src/lib/data-os/signal-timeline-model.ts",
  "apps/studio/src/lib/data-os/signal-timeline.test.ts",
  "apps/studio/src/lib/queue/data-os.ts",
  "apps/studio/src/lib/queue/data-os.test.ts",
  "packages/query-engine/src/data-os.ts",
  "packages/query-engine/src/data-os.test.ts",
  "packages/query-engine/src/signal-backend-v1.ts",
  "packages/query-engine/src/signal-refresh-v1.ts",
  "packages/query-engine/src/signal-metric-catalog-v1.ts",
  "packages/query-engine/src/signal-materialization-v1.ts",
  "packages/query-engine/src/signal-workspace-home-v1.ts",
  "services/workers/src/queues/data-os.ts",
  "services/workers/scripts/reconcile-data-os-sources.ts",
  "services/workers/src/workers/data-os-shadow.ts",
  "services/workers/src/workers/data-os-shadow.test.ts",
  "services/workers/src/workers/signal-refresh.ts",
  "services/workers/src/workers/signal-refresh-runtime.ts",
  "services/workers/src/workers/signal-materialization.ts",
  "services/workers/src/workers/tb-signal-serving-persistence.ts",
  "services/workers/src/workers/tb-analysis-artifact-persistence.ts",
  "services/workers/src/workers/tb-step-6-synthesis.ts"
];

const REQUIRED_ROOT_SCRIPTS: Record<string, string> = {
  "db:apply:existing": "corepack pnpm --filter @noisia/db db:apply:existing",
  "data-os:analyze": "corepack pnpm --filter @noisia/db data-os:analyze",
  "data-os:backfill": "corepack pnpm --filter @noisia/db data-os:backfill",
  "data-os:candidates": "corepack pnpm --filter @noisia/db data-os:candidates",
  "data-os:completion-audit": "corepack pnpm --filter @noisia/db data-os:completion-audit",
  "data-os:evidence": "corepack pnpm --filter @noisia/db data-os:evidence",
  "data-os:local-smoke": "bash scripts/data-os-local-smoke.sh",
  "data-os:preflight": "corepack pnpm --filter @noisia/db data-os:preflight",
  "data-os:pr-summary": "corepack pnpm --filter @noisia/db data-os:pr-summary",
  "data-os:release-gate": "corepack pnpm --filter @noisia/db data-os:release-gate",
  "data-os:reconcile-sources": "corepack pnpm --filter @noisia/workers data-os:reconcile-sources",
  "data-os:review-queue": "corepack pnpm --filter @noisia/db data-os:review-queue",
  "data-os:review-sample": "corepack pnpm --filter @noisia/db data-os:review-sample",
  "data-os:shadow-qa": "corepack pnpm --filter @noisia/db data-os:shadow-qa",
  "data-os:shadow-run": "corepack pnpm --filter @noisia/db data-os:shadow-run",
  "data-os:serving-smoke": "corepack pnpm --filter @noisia/studio data-os:serving-smoke",
  "data-os:smoke": "corepack pnpm --filter @noisia/db data-os:smoke",
  "data-os:staging-check": "bash scripts/data-os-staging-check.sh",
  "data-os:staging-finalize": "bash scripts/data-os-staging-finalize.sh",
  "data-os:staging-shadow": "bash scripts/data-os-staging-shadow.sh",
  "data-os:validate-evidence-pack": "corepack pnpm --filter @noisia/db data-os:validate-evidence-pack",
  "data-os:validate-local-smoke": "corepack pnpm --filter @noisia/db data-os:validate-local-smoke",
  "data-os:verify": "corepack pnpm --filter @noisia/db data-os:verify",
  "signal:v2:reconcile": "corepack pnpm --filter @noisia/db signal:v2:reconcile",
  "signal:v2:explain": "corepack pnpm --filter @noisia/db signal:v2:explain",
  "signal:v2:backend-gate": "corepack pnpm --filter @noisia/db signal:v2:backend-gate"
};

const SAFE_DEFAULTS = [
  "NOISIA_SHOW_ENGINE_BETA_PANEL=false",
  "NOISIA_DATA_OS_ENABLED=false",
  "NOISIA_DATA_OS_BACKFILL_ENABLED=false",
  "NOISIA_DATA_OS_SERVING_ENABLED=false",
  "NOISIA_DATA_OS_TAGGING_ENABLED=false",
  "NOISIA_DATA_OS_SHADOW_MODE=true",
  "NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=false",
  "NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false",
  "NOISIA_DATA_OS_WORKER_ENABLED=false",
  "NOISIA_SIGNAL_REFRESH_SCHEDULER_ENABLED=false",
  "NOISIA_SIGNAL_WORKSPACE_API_ENABLED=false",
  "NOISIA_SIGNAL_AD_HOC_MATERIALIZATION_ENABLED=false",
  "NOISIA_DATA_OS_WORKER_RUNS_ENABLED=false",
  "NOISIA_DATA_OS_WORKER_REMOTE_APPROVED=false",
  "NOISIA_DATA_OS_WORKER_CONCURRENCY=1",
  "NOISIA_DATA_OS_QUEUE_NAME=",
  "NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_CANDIDATES_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_PREFLIGHT_STRICT=false",
  "NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_REVIEW_QUEUE_LIMIT=5",
  "NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=false",
  "NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=false",
  "NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=false",
  "NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL=false",
  "NOISIA_DATA_OS_RECONCILE_CORPUS_ID=",
  "NOISIA_DATA_OS_RECONCILE_APPROVED=false",
  "NOISIA_DATA_OS_RECONCILE_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_SHADOW_STRICT=false",
  "NOISIA_DATA_OS_SHADOW_RUN_ENABLED=false",
  "NOISIA_DATA_OS_SHADOW_RUN_STRICT=true",
  "NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_BACKFILL_CORPUS_ID=",
  "NOISIA_DATA_OS_SHADOW_OUTPUT_ID=",
  "NOISIA_SIGNAL_WORKSPACE_ID=",
  "NOISIA_SIGNAL_V2_BACKFILL_APPROVED=false",
  "NOISIA_SIGNAL_V2_BACKFILL_ALLOW_REMOTE=false",
  "NOISIA_SIGNAL_V2_RECONCILE_ALLOW_REMOTE=false",
  "NOISIA_SIGNAL_V2_EXPLAIN_ALLOW_REMOTE=false",
  "NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE=false",
  "NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED=false",
  "NOISIA_SIGNAL_V2_SHADOW_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID=",
  "NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID=",
  "NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=false",
  "NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA=false",
  "NOISIA_DATA_OS_STAGING_SHADOW_SKIP_CANDIDATES=false",
  "NOISIA_DATA_OS_EVIDENCE_PACK_DIR=",
  "NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR=",
  "NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=",
  "NOISIA_DATA_OS_SMOKE_ALLOW_REMOTE=false",
  "NOISIA_DATA_OS_VERIFY_DB=false",
  "NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE=false",
  "NOISIA_REMOTE_DATABASE_TARGET=",
  "NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=false"
];

function fail(message: string): never {
  throw new Error(message);
}

function assertEmpty(label: string, values: string[]) {
  if (values.length > 0) fail(`${label}: ${values.join(", ")}`);
}

async function gitOutput(repoRoot: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function verifyBranchLineage(repoRoot: string) {
  const currentBranch = await gitOutput(repoRoot, ["branch", "--show-current"]);
  const head = await gitOutput(repoRoot, ["rev-parse", "HEAD"]);
  const baseHead = await gitOutput(repoRoot, ["rev-parse", DATA_OS_BASE_BRANCH]);
  const remoteBaseHead = await gitOutput(repoRoot, ["rev-parse", `origin/${DATA_OS_BASE_BRANCH}`]);

  if (!head) {
    return {
      skipped: true,
      reason: "git HEAD unavailable",
      required_base_branch: DATA_OS_BASE_BRANCH
    };
  }

  if (!baseHead) {
    return {
      skipped: true,
      reason: `${DATA_OS_BASE_BRANCH} ref unavailable in this checkout`,
      current_branch: currentBranch || "detached",
      head,
      required_base_branch: DATA_OS_BASE_BRANCH
    };
  }

  const mergeBase = await gitOutput(repoRoot, ["merge-base", "HEAD", DATA_OS_BASE_BRANCH]);
  if (mergeBase !== baseHead) {
    fail(`Data OS branch must be based on ${DATA_OS_BASE_BRANCH}. Found merge-base ${mergeBase ?? "missing"}; expected ${baseHead}.`);
  }

  return {
    skipped: false,
    current_branch: currentBranch || "detached",
    head,
    required_base_branch: DATA_OS_BASE_BRANCH,
    base_head: baseHead,
    merge_base: mergeBase,
    remote_base_matches_local: remoteBaseHead ? remoteBaseHead === baseHead : null
  };
}

async function verifyMigrations(dbRoot: string) {
  const journal = JSON.parse(await readFile(join(dbRoot, "migrations", "meta", "_journal.json"), "utf8")) as {
    entries?: Array<{ tag?: string }>;
  };
  const journalTags = new Set((journal.entries ?? []).map((entry) => entry.tag).filter(Boolean));

  for (const tag of REQUIRED_MIGRATIONS) {
    await access(join(dbRoot, "migrations", `${tag}.sql`));
  }

  assertEmpty(
    "Missing Data OS journal entries",
    REQUIRED_MIGRATIONS.filter((tag) => !journalTags.has(tag))
  );
}

async function verifyRoutes(repoRoot: string) {
  for (const route of REQUIRED_ROUTES) {
    await access(join(repoRoot, route));
  }
}

async function verifyRootScripts(repoRoot: string) {
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  assertEmpty(
    "Missing root Data OS scripts",
    Object.entries(REQUIRED_ROOT_SCRIPTS)
      .filter(([name, command]) => pkg.scripts?.[name] !== command)
      .map(([name]) => name)
  );
}

async function verifyStudioScripts(repoRoot: string) {
  const pkg = JSON.parse(await readFile(join(repoRoot, "apps", "studio", "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  if (pkg.scripts?.["data-os:serving-smoke"] !== "../../infrastructure/db/node_modules/.bin/tsx scripts/data-os-serving-smoke.ts") {
    fail("Missing @noisia/studio data-os:serving-smoke script.");
  }
  if (pkg.scripts?.["signal:backfill-v2"] !== "../../infrastructure/db/node_modules/.bin/tsx scripts/backfill-signal-v2.ts") {
    fail("Missing @noisia/studio signal:backfill-v2 script.");
  }
  if (pkg.scripts?.["signal:v2:shadow"] !== "../../infrastructure/db/node_modules/.bin/tsx scripts/signal-v2-shadow.ts") {
    fail("Missing @noisia/studio signal:v2:shadow script.");
  }
}

async function verifyWorkerScripts(repoRoot: string) {
  const pkg = JSON.parse(await readFile(join(repoRoot, "services", "workers", "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  if (pkg.scripts?.["data-os:reconcile-sources"] !== "tsx scripts/reconcile-data-os-sources.ts") {
    fail("Missing @noisia/workers data-os:reconcile-sources script.");
  }
}

async function verifyScripts(dbRoot: string) {
  const pkg = JSON.parse(await readFile(join(dbRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  if (pkg.scripts?.["data-os:backfill"] !== "tsx scripts/data-os-backfill.ts") {
    fail("Missing @noisia/db data-os:backfill script.");
  }
  if (pkg.scripts?.["data-os:analyze"] !== "tsx scripts/data-os-analyze.ts") {
    fail("Missing @noisia/db data-os:analyze script.");
  }
  if (pkg.scripts?.["data-os:candidates"] !== "tsx scripts/data-os-candidates.ts") {
    fail("Missing @noisia/db data-os:candidates script.");
  }
  if (pkg.scripts?.["data-os:completion-audit"] !== "tsx scripts/data-os-completion-audit.ts") {
    fail("Missing @noisia/db data-os:completion-audit script.");
  }
  if (pkg.scripts?.["data-os:evidence"] !== "tsx scripts/data-os-evidence.ts") {
    fail("Missing @noisia/db data-os:evidence script.");
  }
  if (pkg.scripts?.["data-os:preflight"] !== "tsx scripts/data-os-preflight.ts") {
    fail("Missing @noisia/db data-os:preflight script.");
  }
  if (pkg.scripts?.["data-os:pr-summary"] !== "tsx scripts/data-os-pr-summary.ts") {
    fail("Missing @noisia/db data-os:pr-summary script.");
  }
  if (pkg.scripts?.["data-os:release-gate"] !== "tsx scripts/data-os-release-gate.ts") {
    fail("Missing @noisia/db data-os:release-gate script.");
  }
  if (pkg.scripts?.["data-os:review-queue"] !== "tsx scripts/data-os-review-queue.ts") {
    fail("Missing @noisia/db data-os:review-queue script.");
  }
  if (pkg.scripts?.["data-os:review-sample"] !== "tsx scripts/data-os-review-sample.ts") {
    fail("Missing @noisia/db data-os:review-sample script.");
  }
  if (pkg.scripts?.["data-os:shadow-qa"] !== "tsx scripts/data-os-shadow-qa.ts") {
    fail("Missing @noisia/db data-os:shadow-qa script.");
  }
  if (pkg.scripts?.["data-os:shadow-run"] !== "tsx scripts/data-os-shadow-run.ts") {
    fail("Missing @noisia/db data-os:shadow-run script.");
  }
  if (pkg.scripts?.["data-os:smoke"] !== "tsx scripts/data-os-smoke.ts") {
    fail("Missing @noisia/db data-os:smoke script.");
  }
  if (pkg.scripts?.["data-os:validate-evidence-pack"] !== "tsx scripts/validate-data-os-evidence-pack.ts") {
    fail("Missing @noisia/db data-os:validate-evidence-pack script.");
  }
  if (pkg.scripts?.["data-os:validate-local-smoke"] !== "tsx scripts/validate-data-os-local-smoke.ts") {
    fail("Missing @noisia/db data-os:validate-local-smoke script.");
  }
  if (pkg.scripts?.["data-os:verify"] !== "tsx scripts/verify-data-os-readiness.ts") {
    fail("Missing @noisia/db data-os:verify script.");
  }
}

async function verifySafeEnv(repoRoot: string) {
  const envExample = await readFile(join(repoRoot, "apps", "studio", ".env.example"), "utf8");
  assertEmpty(
    "Missing Data OS safe env defaults",
    SAFE_DEFAULTS.filter((line) => !envExample.includes(line))
  );
}

async function verifyImplementationContracts(repoRoot: string) {
  for (const file of REQUIRED_CONTRACT_FILES) {
    await access(join(repoRoot, file));
  }

  const adr = await readFile(join(repoRoot, "docs", "adr", "007-noisia-data-os-cut-1.md"), "utf8");
  const agents = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
  const gitignore = await readFile(join(repoRoot, ".gitignore"), "utf8");
  const ci = await readFile(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const codeowners = await readFile(join(repoRoot, ".github", "CODEOWNERS"), "utf8");
  const prTemplate = await readFile(join(repoRoot, ".github", "pull_request_template.md"), "utf8");
  const localSmoke = await readFile(join(repoRoot, "scripts", "data-os-local-smoke.sh"), "utf8");
  const stagingFlightCard = await readFile(join(repoRoot, "scripts", "data-os-staging-flight-card.example.sh"), "utf8");
  const stagingCheck = await readFile(join(repoRoot, "scripts", "data-os-staging-check.sh"), "utf8");
  const stagingFinalize = await readFile(join(repoRoot, "scripts", "data-os-staging-finalize.sh"), "utf8");
  const stagingShadow = await readFile(join(repoRoot, "scripts", "data-os-staging-shadow.sh"), "utf8");
  const guardrails = await readFile(join(repoRoot, "docs", "AGENT_GUARDRAILS.md"), "utf8");
  const branches = await readFile(join(repoRoot, "docs", "BRANCHES.md"), "utf8");
  const schemaDoc = await readFile(join(repoRoot, "docs", "product", "04_DATABASE_SCHEMA.md"), "utf8");
  const technicalDecisions = await readFile(join(repoRoot, "docs", "product", "06_TECHNICAL_DECISIONS.md"), "utf8");
  const apiContracts = await readFile(join(repoRoot, "docs", "product", "08_API_CONTRACTS.md"), "utf8");
  const spec = await readFile(join(repoRoot, "docs", "product", "22_NOISIA_DATA_OS_CUT_1.md"), "utf8");
  const runbook = await readFile(join(repoRoot, "docs", "product", "23_NOISIA_DATA_OS_STAGING_RUNBOOK.md"), "utf8");
  const benchmark = await readFile(join(repoRoot, "docs", "product", "24_NOISIA_DATA_OS_TECH_BENCHMARK.md"), "utf8");
  const handoff = await readFile(join(repoRoot, "docs", "product", "25_NOISIA_DATA_OS_STAGING_HANDOFF.md"), "utf8");
  const completionAuditDoc = await readFile(
    join(repoRoot, "docs", "product", "26_NOISIA_DATA_OS_COMPLETION_AUDIT.md"),
    "utf8"
  );
  const signalNorthStar = await readFile(
    join(repoRoot, "docs", "product", "31_SIGNAL_PRODUCT_NORTH_STAR.md"),
    "utf8"
  );
  const signalArchitectureAdr = await readFile(
    join(repoRoot, "docs", "adr", "009-signal-always-on-strategic-dashboard.md"),
    "utf8"
  );
  const signalBackendRoadmap = await readFile(
    join(repoRoot, "docs", "product", "32_SIGNAL_BACKEND_EXECUTION_ROADMAP.md"),
    "utf8"
  );
  const connection = await readFile(join(repoRoot, "infrastructure", "db", "seeds", "connection.ts"), "utf8");
  const analyze = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-analyze.ts"), "utf8");
  const backfill = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-backfill.ts"), "utf8");
  const completionAuditScript = await readFile(
    join(repoRoot, "infrastructure", "db", "scripts", "data-os-completion-audit.ts"),
    "utf8"
  );
  const evidence = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-evidence.ts"), "utf8");
  const prSummary = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-pr-summary.ts"), "utf8");
  const releaseGate = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-release-gate.ts"), "utf8");
  const reviewQueue = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-review-queue.ts"), "utf8");
  const reviewSample = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-review-sample.ts"), "utf8");
  const evidencePackValidator = await readFile(
    join(repoRoot, "infrastructure", "db", "scripts", "validate-data-os-evidence-pack.ts"),
    "utf8"
  );
  const localSmokeValidator = await readFile(
    join(repoRoot, "infrastructure", "db", "scripts", "validate-data-os-local-smoke.ts"),
    "utf8"
  );
  const shadowQa = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-shadow-qa.ts"), "utf8");
  const smoke = await readFile(join(repoRoot, "infrastructure", "db", "scripts", "data-os-smoke.ts"), "utf8");
  const servingSmoke = await readFile(join(repoRoot, "apps", "studio", "scripts", "data-os-serving-smoke.ts"), "utf8");
  const signalBackfill = await readFile(join(repoRoot, "apps", "studio", "scripts", "backfill-signal-serving.ts"), "utf8");
  const signalPublishRoute = await readFile(
    join(repoRoot, "apps", "studio", "src", "app", "api", "corpora", "[id]", "tb-analysis", "[analysisId]", "signal-output", "route.ts"),
    "utf8"
  );
  const signalOverview = await readFile(
    join(repoRoot, "apps", "studio", "src", "lib", "data-os", "published-signal-overview.ts"),
    "utf8"
  );
  const analysisArtifactGraph = await readFile(
    join(repoRoot, "apps", "studio", "src", "lib", "data-os", "analysis-artifact-graph.ts"),
    "utf8"
  );
  const signalReadiness = await readFile(
    join(repoRoot, "apps", "studio", "src", "lib", "data-os", "signal-serving.ts"),
    "utf8"
  );
  const signalSemantics = await readFile(
    join(repoRoot, "apps", "studio", "src", "lib", "signal", "semantics.ts"),
    "utf8"
  );
  const pulsePage = await readFile(join(repoRoot, "apps", "studio", "src", "app", "pulse", "[outputId]", "page.tsx"), "utf8");
  const loader = await readFile(join(repoRoot, "apps", "studio", "src", "app", "api", "data-os", "_lib", "load.ts"), "utf8");
  const pulseLiveRoute = await readFile(
    join(repoRoot, "apps", "studio", "src", "app", "api", "data-os", "pulse", "[outputId]", "live", "route.ts"),
    "utf8"
  );
  const pulseCorpusRoute = await readFile(
    join(repoRoot, "apps", "studio", "src", "app", "api", "data-os", "pulse", "[outputId]", "corpus", "route.ts"),
    "utf8"
  );
  const serving = await readFile(join(repoRoot, "apps", "studio", "src", "lib", "data-os", "serving.ts"), "utf8");
  const studioDataOsQueue = await readFile(join(repoRoot, "apps", "studio", "src", "lib", "queue", "data-os.ts"), "utf8");
  const studioDataOsQueueTest = await readFile(join(repoRoot, "apps", "studio", "src", "lib", "queue", "data-os.test.ts"), "utf8");
  const dataOsContract = await readFile(join(repoRoot, "packages", "query-engine", "src", "data-os.ts"), "utf8");
  const dataOsContractTest = await readFile(join(repoRoot, "packages", "query-engine", "src", "data-os.test.ts"), "utf8");
  const workerIndex = await readFile(join(repoRoot, "services", "workers", "src", "index.ts"), "utf8");
  const dataOsQueue = await readFile(join(repoRoot, "services", "workers", "src", "queues", "data-os.ts"), "utf8");
  const dataOsWorker = await readFile(join(repoRoot, "services", "workers", "src", "workers", "data-os-shadow.ts"), "utf8");
  const dataOsWorkerTest = await readFile(join(repoRoot, "services", "workers", "src", "workers", "data-os-shadow.test.ts"), "utf8");
  const tbSignalPersistence = await readFile(
    join(repoRoot, "services", "workers", "src", "workers", "tb-signal-serving-persistence.ts"),
    "utf8"
  );
  const tbArtifactPersistence = await readFile(
    join(repoRoot, "services", "workers", "src", "workers", "tb-analysis-artifact-persistence.ts"),
    "utf8"
  );
  const tbStep6 = await readFile(
    join(repoRoot, "services", "workers", "src", "workers", "tb-step-6-synthesis.ts"),
    "utf8"
  );
  const dataOsRouteContents = await Promise.all(
    REQUIRED_ROUTES.map(async (route) => ({
      route,
      contents: await readFile(join(repoRoot, route), "utf8")
    }))
  );
  const reviewQueueRoute = dataOsRouteContents.find(({ route }) => route.includes("/review-queue/"))?.contents ?? "";

  const missing: string[] = [];
  if (!agents.includes("DATA OS CUT 1 sobre SIGNAL PULSE")) missing.push("AGENTS Data OS priority");
  if (!agents.includes("docs/product/22_NOISIA_DATA_OS_CUT_1.md")) missing.push("AGENTS Data OS spec pointer");
  if (!agents.includes("docs/product/23_NOISIA_DATA_OS_STAGING_RUNBOOK.md")) missing.push("AGENTS Data OS runbook pointer");
  if (!agents.includes("docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md")) missing.push("AGENTS Data OS benchmark pointer");
  if (!agents.includes("docs/product/25_NOISIA_DATA_OS_STAGING_HANDOFF.md")) missing.push("AGENTS Data OS handoff pointer");
  if (!agents.includes("docs/product/26_NOISIA_DATA_OS_COMPLETION_AUDIT.md")) {
    missing.push("AGENTS Data OS completion audit pointer");
  }
  if (!agents.includes("docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md")) {
    missing.push("AGENTS Signal North Star pointer");
  }
  if (!agents.includes("docs/adr/009-signal-always-on-strategic-dashboard.md")) {
    missing.push("AGENTS Signal architecture ADR pointer");
  }
  if (!agents.includes("docs/product/32_SIGNAL_BACKEND_EXECUTION_ROADMAP.md")) {
    missing.push("AGENTS Signal backend roadmap pointer");
  }
  if (!signalNorthStar.includes("reportes casi always-on y reportes estratégicos")) {
    missing.push("Signal North Star two-speed product contract");
  }
  if (!signalNorthStar.includes("Claude no es la fuente de ningún número mostrado")) {
    missing.push("Signal North Star deterministic metrics contract");
  }
  if (!signalNorthStar.includes("una URL estable")) {
    missing.push("Signal North Star stable client URL contract");
  }
  if (!signalArchitectureAdr.includes("Signal becomes a stable client dashboard/workspace")) {
    missing.push("Signal ADR stable dashboard decision");
  }
  if (!signalArchitectureAdr.includes("Claude does not calculate dashboard numbers")) {
    missing.push("Signal ADR deterministic metrics decision");
  }
  if (!signalBackendRoadmap.includes("SB-01 · Signal Backend Contract V1")) {
    missing.push("Signal backend roadmap first task contract");
  }
  if (!signalBackendRoadmap.includes("SB-10 · Signal Backend Integration and Front-ready Gate")) {
    missing.push("Signal backend roadmap front-ready gate");
  }
  if (!signalBackendRoadmap.includes("No iniciar el rediseño frontend")) {
    missing.push("Signal backend roadmap frontend boundary");
  }
  if (!stagingFlightCard.includes("NOISIA_REMOTE_DATABASE_TARGET=staging")) {
    missing.push("staging flight card target placeholder");
  }
  if (!stagingFlightCard.includes('export DATABASE_URL="<staging_or_preview_database_url>"')) {
    missing.push("staging flight card database placeholder");
  }
  if (!stagingFlightCard.includes("NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=false")) {
    missing.push("staging flight card approval fail-closed default");
  }
  if (!stagingFlightCard.includes("corepack pnpm data-os:staging-check")) {
    missing.push("staging flight card precheck command");
  }
  if (!stagingFlightCard.includes("corepack pnpm data-os:staging-finalize")) {
    missing.push("staging flight card finalize command");
  }
  if (!stagingFlightCard.includes("ready_for_production_review: true")) {
    missing.push("staging flight card release gate criterion");
  }
  if (!runbook.includes("scripts/data-os-staging-flight-card.example.sh")) {
    missing.push("runbook staging flight card pointer");
  }
  if (!handoff.includes("scripts/data-os-staging-flight-card.example.sh")) {
    missing.push("handoff staging flight card pointer");
  }
  if (!benchmark.includes("Customer Intelligence Lakehouse con")) {
    missing.push("Data OS benchmark product category decision");
  }
  if (!benchmark.includes("CDP-like") || !benchmark.includes("Noisia No Es Un CDP Completo En Cut 1")) {
    missing.push("Data OS benchmark CDP boundary");
  }
  if (!benchmark.includes("data catalog / context graph") && !benchmark.includes("Data catalog / context graph")) {
    missing.push("Data OS benchmark data catalog comparison");
  }
  if (!benchmark.includes("OpenMetadata") || !benchmark.includes("DataHub")) {
    missing.push("Data OS benchmark metadata catalog sources");
  }
  if (!benchmark.includes("Segment") || !benchmark.includes("RudderStack")) {
    missing.push("Data OS benchmark CDP sources");
  }
  if (!benchmark.includes("dbt") || !benchmark.includes("semantic layer")) {
    missing.push("Data OS benchmark semantic layer source");
  }
  if (!benchmark.includes("Dagster") || !benchmark.includes("software-defined assets")) {
    missing.push("Data OS benchmark orchestration source");
  }
  if (!benchmark.includes("Iceberg") || !benchmark.includes("schema evolution")) {
    missing.push("Data OS benchmark lakehouse source");
  }
  if (!benchmark.includes("ClickHouse") || !benchmark.includes("materialized views")) {
    missing.push("Data OS benchmark serving analytics source");
  }
  if (!benchmark.includes("Upgrade por umbrales medibles")) {
    missing.push("Data OS benchmark measurable upgrade thresholds");
  }
  if (!benchmark.includes("Staging/preview shadow pack") || !benchmark.includes("ready_for_production_review: true")) {
    missing.push("Data OS benchmark production readiness gate");
  }
  if (!benchmark.includes('database_format: "postgres_url"') || !benchmark.includes("database_format_postgres_url")) {
    missing.push("Data OS benchmark database format release gate");
  }
  if (!benchmark.includes("El dashboard no se reimplementa hasta que las APIs vivas pasen shadow")) {
    missing.push("Data OS benchmark UX sequencing");
  }
  if (!benchmark.includes("customer_intelligence_lakehouse_cdp_like")) {
    missing.push("Data OS benchmark machine-readable product category");
  }
  if (!technicalDecisions.includes("24_NOISIA_DATA_OS_TECH_BENCHMARK.md")) {
    missing.push("technical decisions Data OS benchmark pointer");
  }
  if (!agents.includes("corepack pnpm data-os:staging-shadow")) {
    missing.push("AGENTS Data OS staging shadow gate");
  }
  if (!agents.includes("corepack pnpm --filter @noisia/studio build")) {
    missing.push("AGENTS Studio build gate");
  }
  if (!agents.includes("corepack pnpm data-os:staging-check")) {
    missing.push("AGENTS Data OS staging check gate");
  }
  if (!agents.includes("no imprime secretos ni IDs")) {
    missing.push("AGENTS staging check redaction note");
  }
  if (!agents.includes("shadow-run, analyze,\nserving-smoke y evidence")) {
    missing.push("AGENTS staging shadow evidence coverage");
  }
  if (!agents.includes("published_outputs.payload")) missing.push("AGENTS payload fallback guard");
  if (!agents.includes("Do not invent staging\nevidence from local runs")) {
    missing.push("AGENTS local evidence is not staging evidence guard");
  }
  if (!agents.includes("Local checks are necessary but not sufficient")) {
    missing.push("AGENTS completion requires staging evidence guard");
  }
  if (!agents.includes("docs/AGENT_GUARDRAILS.md")) missing.push("AGENTS guardrails pointer");
  if (!signalSemantics.includes('SIGNAL_SERVING_CONTRACT_VERSION = "signal-serving-v2"')) {
    missing.push("Signal serving v2 contract version");
  }
  if (!signalSemantics.includes('"analysis_actions"')) missing.push("Signal Action Studio required data ref");
  if (!signalOverview.includes("FROM tb_strategic_opportunities")) {
    missing.push("Signal canonical strategic opportunity reader");
  }
  if (!signalOverview.includes("FROM tb_action_studio")) missing.push("Signal canonical Action Studio reader");
  if (!signalReadiness.includes("synthesized_opportunities") || !signalReadiness.includes("synthesized_actions")) {
    missing.push("Signal synthesis persistence reconciliation");
  }
  if (!tbSignalPersistence.includes("INSERT INTO tb_strategic_opportunities")) {
    missing.push("Step 6 strategic opportunity persistence");
  }
  if (!tbSignalPersistence.includes("INSERT INTO tb_action_studio")) {
    missing.push("Step 6 Action Studio persistence");
  }
  if (!tbStep6.includes("FOR UPDATE") || !tbStep6.includes("assertTbAnalysisAcceptsSynthesisWrite")) {
    missing.push("Step 6 approved analysis immutability guard");
  }
  if (!tbStep6.includes("replaceTbAnalysisArtifactGraph")) {
    missing.push("Step 6 shared artifact graph persistence");
  }
  if (!tbArtifactPersistence.includes("INSERT INTO analysis_artifacts")) {
    missing.push("analysis artifact registry persistence");
  }
  if (!tbArtifactPersistence.includes("INSERT INTO analysis_evidence_links")) {
    missing.push("analysis evidence link persistence");
  }
  if (!tbArtifactPersistence.includes("'claim_specific', false")) {
    missing.push("structured context claim-specific boundary");
  }
  if (!tbArtifactPersistence.includes("tb_finding_structured_evidence_refs")) {
    missing.push("T&B exact structured evidence persistence");
  }
  if (!analysisArtifactGraph.includes("current.revision + 1")) {
    missing.push("analysis artifact immutable revision review writer");
  }
  if (!analysisArtifactGraph.includes("published_output_artifacts")) {
    missing.push("published output artifact snapshot contract");
  }
  if (!signalPublishRoute.includes("persistPublishedAnalysisArtifacts")) {
    missing.push("published Signal artifact snapshot persistence");
  }
  if (!signalPublishRoute.includes("published_output_immutable") || !signalPublishRoute.includes("setWhere")) {
    missing.push("published Signal immutable write guard");
  }
  if (!signalBackfill.includes("NOISIA_DATA_OS_SIGNAL_BACKFILL_ALLOW_REMOTE")) {
    missing.push("Signal serving backfill remote guard");
  }
  if (!signalBackfill.includes("payloadDigest") || !signalBackfill.includes("published_at")) {
    missing.push("Signal serving backfill payload preservation checks");
  }
  if (!apiContracts.includes("T&B Signal relational serving v2")) {
    missing.push("API contracts Signal serving v2 section");
  }
  if (!schemaDoc.includes("tb_strategic_opportunities") || !schemaDoc.includes("tb_action_studio")) {
    missing.push("database schema Signal serving entities");
  }
  if (!schemaDoc.includes("analysis_artifacts") || !schemaDoc.includes("analysis_evidence_links")) {
    missing.push("database schema analysis artifact graph");
  }
  if (!handoff.includes("signal:backfill-serving")) missing.push("staging handoff Signal serving backfill command");
  if (!gitignore.match(/^\.data$/m)) missing.push("gitignore local evidence data directory");
  if (!gitignore.match(/^\*\.log$/m)) missing.push("gitignore captured command logs");
  if (!gitignore.match(/^\.env\*$/m)) missing.push("gitignore all env files");
  if (!gitignore.match(/^!\.env\.example$/m)) missing.push("gitignore root env example exception");
  if (!gitignore.match(/^!\*\*\/\.env\.example$/m)) missing.push("gitignore nested env example exception");
  if (!ci.includes("Data OS readiness")) missing.push("CI Data OS readiness step");
  if (!ci.includes("Studio production build")) missing.push("CI Studio production build step");
  if (!ci.includes("pnpm --filter @noisia/studio build")) missing.push("CI Studio production build command");
  if (!ci.includes("pnpm data-os:verify")) missing.push("CI data-os verify command");
  if (!ci.includes("Data OS local smoke")) missing.push("CI Data OS local smoke step");
  if (!ci.includes("pnpm data-os:local-smoke")) missing.push("CI Data OS local smoke command");
  if (!ci.includes("pnpm data-os:validate-local-smoke")) missing.push("CI Data OS local smoke validation command");
  if (!ci.includes("node-version: 20")) missing.push("CI Node 20 runtime");
  if (!localSmoke.includes("corepack pnpm")) missing.push("local smoke pinned pnpm command");
  if (!localSmoke.includes("NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR")) {
    missing.push("local smoke evidence directory override");
  }
  if (!localSmoke.includes(".data/data-os-local-smoke")) missing.push("local smoke evidence data directory");
  if (!localSmoke.includes("run_capture migrations.log")) missing.push("local smoke migration artifact");
  if (!localSmoke.includes("run_capture smoke.log")) missing.push("local smoke Data OS smoke artifact");
  if (!localSmoke.includes("run_capture shadow-run.log")) missing.push("local smoke shadow-run artifact");
  if (!localSmoke.includes("run_capture analyze.json")) missing.push("local smoke analyze artifact");
  if (!localSmoke.includes("run_capture review-queue.json")) missing.push("local smoke review queue artifact");
  if (!localSmoke.includes("run_capture review-sample.json")) missing.push("local smoke review sample artifact");
  if (!localSmoke.includes("run_capture evidence.json")) missing.push("local smoke evidence artifact");
  if (!localSmoke.includes("run_capture serving-smoke.json")) missing.push("local smoke serving smoke artifact");
  if (!localSmoke.includes("run_capture local-smoke-validation.json")) {
    missing.push("local smoke validation artifact");
  }
  if (!localSmoke.includes("redacted_command_summary")) missing.push("local smoke redacted command summaries");
  if (!localSmoke.includes("corepack pnpm --filter @noisia/db db:smoke:local")) {
    missing.push("local smoke migration command");
  }
  if (!localSmoke.includes("corepack pnpm --filter @noisia/db data-os:smoke")) {
    missing.push("local smoke Data OS smoke command");
  }
  if (!localSmoke.includes("corepack pnpm --filter @noisia/db data-os:shadow-run")) {
    missing.push("local smoke shadow-run command");
  }
  if (!localSmoke.includes("corepack pnpm --filter @noisia/db data-os:analyze")) {
    missing.push("local smoke analyze command");
  }
  if (!localSmoke.includes("corepack pnpm --filter @noisia/db data-os:review-queue")) {
    missing.push("local smoke review queue command");
  }
  if (!localSmoke.includes("corepack pnpm --filter @noisia/db data-os:review-sample")) {
    missing.push("local smoke review sample command");
  }
  if (!localSmoke.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL=true")) {
    missing.push("local smoke review sample local auto-select");
  }
  if (!localSmoke.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true")) {
    missing.push("local smoke review sample approval");
  }
  if (!localSmoke.includes("corepack pnpm --filter @noisia/db data-os:evidence")) {
    missing.push("local smoke evidence command");
  }
  if (!localSmoke.includes("corepack pnpm --filter @noisia/studio data-os:serving-smoke")) {
    missing.push("local smoke serving smoke command");
  }
  if (!localSmoke.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false")) {
    missing.push("local smoke serving smoke live render kill switch");
  }
  if (!localSmoke.includes("corepack pnpm --filter @noisia/db data-os:validate-local-smoke")) {
    missing.push("local smoke validation command");
  }
  if (!localSmoke.includes("run_pnpm db:smoke:local:down")) missing.push("local smoke cleanup command");
  if (!localSmoke.includes("DATABASE_URL=\"$SMOKE_DATABASE_URL\"")) missing.push("local smoke forced local DATABASE_URL");
  if (!localSmokeValidator.includes("NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR")) {
    missing.push("local smoke validator evidence dir env");
  }
  if (!localSmokeValidator.includes("displayEvidenceDir")) {
    missing.push("local smoke validator repo-relative evidence path output");
  }
  if (!localSmokeValidator.includes(".data\", \"data-os-local-smoke")) {
    missing.push("local smoke validator default evidence root");
  }
  if (!localSmokeValidator.includes("ready_for_staging_preflight")) {
    missing.push("local smoke validator staging preflight output");
  }
  if (!localSmokeValidator.includes("ready_for_release_gate: false")) {
    missing.push("local smoke validator release gate separation");
  }
  if (!localSmokeValidator.includes("does not replace the staging/preview evidence pack")) {
    missing.push("local smoke validator staging replacement warning");
  }
  if (!localSmokeValidator.includes("README.md must not include corpus or output UUID values")) {
    missing.push("local smoke validator README UUID guard");
  }
  if (!localSmokeValidator.includes("serving-smoke.json must redact corpus_id")) {
    missing.push("local smoke validator serving smoke ID redaction gate");
  }
  if (!localSmokeValidator.includes("serving-smoke.json must not include corpus or output UUID values")) {
    missing.push("local smoke validator serving smoke UUID guard");
  }
  if (!localSmokeValidator.includes("evidence.json architecture_decision must be an object")) {
    missing.push("local smoke validator architecture decision object");
  }
  if (!localSmokeValidator.includes("evidence.json review_queue must be an object")) {
    missing.push("local smoke validator review queue object");
  }
  if (!localSmokeValidator.includes("review-queue.json")) {
    missing.push("local smoke validator review queue artifact");
  }
  if (!localSmokeValidator.includes("contains_sensitive_review_ids")) {
    missing.push("local smoke validator review queue ID redaction gate");
  }
  if (!localSmokeValidator.includes("contains_private_review_context")) {
    missing.push("local smoke validator review queue context redaction gate");
  }
  if (!localSmokeValidator.includes("NOISIA_DATA_OS_REVIEW_TAG_ID\", \"<record_tag_id>")) {
    missing.push("local smoke validator review queue suggested tag export");
  }
  if (!localSmokeValidator.includes("review-sample.json")) {
    missing.push("local smoke validator review sample artifact");
  }
  if (!localSmokeValidator.includes("auto_selected_local")) {
    missing.push("local smoke validator review sample local auto-select");
  }
  if (!localSmokeValidator.includes("tag_review_events")) {
    missing.push("local smoke validator tag review event count");
  }
  if (!localSmokeValidator.includes("knowledge_assertion_review_events")) {
    missing.push("local smoke validator assertion review event count");
  }
  if (!localSmokeValidator.includes("customer_intelligence_lakehouse_cdp_like")) {
    missing.push("local smoke validator product category decision");
  }
  if (!localSmokeValidator.includes("validateNoDatabaseUrls")) {
    missing.push("local smoke validator database URL scan");
  }
  if (!localSmokeValidator.includes("SENSITIVE_ARTIFACT_PATTERNS")) {
    missing.push("local smoke validator sensitive artifact scan");
  }
  if (!localSmokeValidator.includes("parseLastJsonObject")) {
    missing.push("local smoke validator captured JSON parser");
  }
  if (!localSmokeValidator.includes("parseCapturedJsonObjects")) {
    missing.push("local smoke validator captured JSON object scanner");
  }
  if (!localSmokeValidator.includes("data_assets_without_fields")) {
    missing.push("local smoke validator catalog fields gate");
  }
  if (!localSmokeValidator.includes("knowledge_assertion_links")) {
    missing.push("local smoke validator knowledge links gate");
  }
  if (!localSmokeValidator.includes("record_tags_demographic")) {
    missing.push("local smoke validator demographic tag gate");
  }
  if (!localSmokeValidator.includes("data_os_disabled_fallback")) {
    missing.push("local smoke validator fallback gate");
  }
  if (!localSmokeValidator.includes("visibility_checks")) {
    missing.push("local smoke validator visibility checks");
  }
  if (!localSmokeValidator.includes("client_source_health_hidden")) {
    missing.push("local smoke validator client source health visibility check");
  }
  if (!localSmokeValidator.includes("internal_dashboard_refs_preserved")) {
    missing.push("local smoke validator internal dashboard refs visibility check");
  }
  if (!localSmokeValidator.includes("review_queue_ready_for_human_review")) {
    missing.push("local smoke validator serving review queue readiness");
  }
  if (!localSmokeValidator.includes("review_queue_tags_with_evidence")) {
    missing.push("local smoke validator serving review queue tag evidence count");
  }
  if (!localSmokeValidator.includes("review_queue_assertions_with_evidence")) {
    missing.push("local smoke validator serving review queue assertion evidence count");
  }
  if (!stagingCheck.includes("Noisia Data OS staging environment check")) {
    missing.push("staging check title");
  }
  if (!stagingCheck.includes("corepack pnpm --silent data-os:verify")) {
    missing.push("staging check local Data OS verifier command");
  }
  if (!stagingCheck.includes("LOCAL_DATA_OS_VERIFY=passed")) {
    missing.push("staging check local verifier success marker");
  }
  if (!stagingCheck.includes("LOCAL_DATA_OS_VERIFY=failed")) {
    missing.push("staging check local verifier failure marker");
  }
  if (!stagingCheck.includes("Values are intentionally redacted")) {
    missing.push("staging check redaction notice");
  }
  if (!stagingCheck.includes("check_required DATABASE_URL")) missing.push("staging check DATABASE_URL redacted status");
  if (!stagingCheck.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("staging check confirms postgres DB URL format");
  }
  if (!stagingCheck.includes("DATABASE_URL_FORMAT=placeholder_refused")) {
    missing.push("staging check refuses placeholder DB URLs");
  }
  if (!stagingCheck.includes("DATABASE_URL_FORMAT=invalid_postgres_url")) {
    missing.push("staging check refuses non-postgres DB URLs");
  }
  if (!stagingCheck.includes("DATABASE_URL_ENVIRONMENT=production_like_refused")) {
    missing.push("staging check production-like URL refusal");
  }
  if (!stagingCheck.includes("NOISIA_REMOTE_DATABASE_TARGET")) missing.push("staging check remote target");
  if (!stagingCheck.includes("NOISIA_DATA_OS_BACKFILL_CORPUS_ID")) missing.push("staging check corpus id");
  if (!stagingCheck.includes("NOISIA_DATA_OS_SHADOW_OUTPUT_ID")) missing.push("staging check output id");
  if (!stagingCheck.includes("check_uuid_if_set")) missing.push("staging check UUID format helper");
  if (!stagingCheck.includes("NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT")) {
    missing.push("staging check corpus id UUID format gate");
  }
  if (!stagingCheck.includes("NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT")) {
    missing.push("staging check output id UUID format gate");
  }
  if (!stagingCheck.includes("NOISIA_DATA_OS_STAGING_SHADOW_APPROVED")) {
    missing.push("staging check approval guard");
  }
  if (!stagingCheck.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED")) {
    missing.push("staging check review sample approval status");
  }
  if (!stagingCheck.includes("NOISIA_DATA_OS_REVIEW_TAG_ID")) {
    missing.push("staging check review sample tag id precheck");
  }
  if (!stagingCheck.includes("NOISIA_DATA_OS_REVIEW_ASSERTION_ID")) {
    missing.push("staging check review sample assertion id precheck");
  }
  if (!stagingCheck.includes("check_review_action_if_set")) {
    missing.push("staging check review action validation helper");
  }
  if (!stagingCheck.includes("release_gate_artifact=will_write:release-gate.json")) {
    missing.push("staging check release gate artifact notice");
  }
  if (!stagingCheck.includes("ready_for_staging_shadow=true")) {
    missing.push("staging check readiness output");
  }
  if (!stagingCheck.includes("corepack pnpm data-os:staging-shadow")) {
    missing.push("staging check next command");
  }
  if (!stagingFinalize.includes("NOISIA_DATA_OS_STAGING_EVIDENCE_DIR")) {
    missing.push("staging finalize evidence directory guard");
  }
  if (!stagingFinalize.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED")) {
    missing.push("staging finalize human review approval guard");
  }
  if (!stagingFinalize.includes("NOISIA_DATA_OS_REVIEW_TAG_ID")) {
    missing.push("staging finalize tag id guard");
  }
  if (!stagingFinalize.includes("NOISIA_DATA_OS_REVIEW_ASSERTION_ID")) {
    missing.push("staging finalize assertion id guard");
  }
  if (!stagingFinalize.includes("run_capture staging-check.txt")) {
    missing.push("staging finalize refreshes staging check artifact");
  }
  if (!stagingFinalize.includes("run_capture review-queue.json")) {
    missing.push("staging finalize review queue artifact");
  }
  if (!stagingFinalize.includes("data-os:review-queue")) {
    missing.push("staging finalize review queue command");
  }
  if (!stagingFinalize.includes("NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true")) {
    missing.push("staging finalize review queue remote guard");
  }
  if (!stagingFinalize.includes("data-os:review-sample")) {
    missing.push("staging finalize review sample command");
  }
  if (!stagingFinalize.includes("NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=true")) {
    missing.push("staging finalize review sample remote guard");
  }
  if (!stagingFinalize.includes("data-os:serving-smoke")) {
    missing.push("staging finalize serving smoke refresh");
  }
  if (!stagingFinalize.includes("redacted_command_summary")) {
    missing.push("staging finalize redacted command summaries");
  }
  if (!stagingFinalize.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false")) {
    missing.push("staging finalize serving smoke live render kill switch");
  }
  if (!stagingFinalize.includes("data-os:validate-evidence-pack")) {
    missing.push("staging finalize evidence pack validation");
  }
  if (!stagingFinalize.includes("data-os:release-gate")) {
    missing.push("staging finalize release gate");
  }
  if (!stagingFinalize.includes("completion-audit.json")) {
    missing.push("staging finalize completion audit artifact");
  }
  if (!stagingFinalize.includes("data-os:completion-audit")) {
    missing.push("staging finalize completion audit command");
  }
  if (!stagingFinalize.includes("append_release_gate_summary\n\nrun_capture evidence-pack-validation.json")) {
    missing.push("staging finalize release gate summary before validation");
  }
  if (!stagingFinalize.includes("run_capture_without_summary release-gate.json")) {
    missing.push("staging finalize release gate without README mutation");
  }
  if (!stagingFinalize.includes("Corpus: set (redacted)") || !stagingFinalize.includes("Output: set (redacted)")) {
    missing.push("staging finalize console corpus/output redaction");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_STAGING_SHADOW_APPROVED")) {
    missing.push("staging shadow approval guard");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_STAGING_EVIDENCE_DIR")) {
    missing.push("staging shadow evidence directory override");
  }
  const stagingShadowPrecheckIndex = stagingShadow.indexOf("corepack pnpm --silent data-os:staging-check");
  const stagingShadowSchemaApplyIndex = stagingShadow.indexOf("@noisia/db db:apply:existing");
  const stagingShadowPairPreflightIndex = stagingShadow.indexOf("@noisia/db data-os:preflight");
  const stagingShadowEvidenceDirIndex = stagingShadow.indexOf("EVIDENCE_DIR=");
  if (
    stagingShadowPrecheckIndex < 0
    || stagingShadowEvidenceDirIndex < 0
    || stagingShadowPrecheckIndex > stagingShadowEvidenceDirIndex
  ) {
    missing.push("staging shadow prechecks before evidence directory");
  }
  if (
    stagingShadowPairPreflightIndex < 0
    || stagingShadowEvidenceDirIndex < 0
    || stagingShadowPairPreflightIndex > stagingShadowEvidenceDirIndex
  ) {
    missing.push("staging shadow pair preflight before evidence directory");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=true")) {
    missing.push("staging shadow pair preflight remote guard");
  }
  if (
    stagingShadowSchemaApplyIndex < 0
    || stagingShadowPairPreflightIndex < 0
    || stagingShadowSchemaApplyIndex > stagingShadowPairPreflightIndex
  ) {
    missing.push("staging shadow schema apply before pair preflight");
  }
  if (stagingShadowSchemaApplyIndex > stagingShadowEvidenceDirIndex) {
    missing.push("staging shadow schema apply before evidence directory");
  }
  if (!stagingShadow.includes("Schema apply failed before evidence package creation")) {
    missing.push("staging shadow schema apply failure guard");
  }
  if (!stagingShadow.includes("apply-schema.log")) {
    missing.push("staging shadow schema apply artifact");
  }
  if (!stagingShadow.includes("Signal Pulse output/corpus preflight failed before evidence package creation")) {
    missing.push("staging shadow pair preflight failure guard");
  }
  if (!stagingShadow.includes(".data/data-os-evidence")) {
    missing.push("staging shadow ignored evidence default directory");
  }
  if (!stagingShadow.includes("run_capture")) missing.push("staging shadow command capture helper");
  if (!stagingShadow.includes("redacted_command_summary")) missing.push("staging shadow redacted command summaries");
  if (!stagingShadow.includes("pnpm --silent")) missing.push("staging shadow silent artifact commands");
  if (!stagingShadow.includes("README.md")) missing.push("staging shadow evidence README");
  if (!stagingShadow.includes("staging-check.txt")) missing.push("staging shadow staging check artifact");
  if (!stagingShadow.includes("data-os:staging-check")) missing.push("staging shadow staging check command");
  if (!stagingShadow.includes("candidates.json")) missing.push("staging shadow candidates artifact");
  if (!stagingShadow.includes("shadow-run.log")) missing.push("staging shadow run artifact");
  if (!stagingShadow.includes("analyze.json")) missing.push("staging shadow analyze artifact");
  if (!stagingShadow.includes("serving-smoke.json")) missing.push("staging shadow serving smoke artifact");
  if (!stagingShadow.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false")) {
    missing.push("staging shadow serving smoke live render kill switch");
  }
  if (!stagingShadow.includes("review-queue.json")) missing.push("staging shadow review queue artifact");
  if (!stagingShadow.includes("NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true")) {
    missing.push("staging shadow review queue remote guard");
  }
  if (!stagingShadow.includes('! -f "$EVIDENCE_DIR/review-sample.json"')) {
    missing.push("staging shadow requires review sample artifact before final evidence");
  }
  if (!stagingShadow.includes("review-sample.json")) missing.push("staging shadow review sample artifact");
  if (!stagingShadow.includes("data-os:review-sample")) missing.push("staging shadow review sample command");
  if (!stagingShadow.includes("NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=true")) {
    missing.push("staging shadow review sample remote guard");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED")) {
    missing.push("staging shadow explicit review sample approval");
  }
  if (!stagingShadow.includes("Human review sample artifact is required before final Data OS evidence")) {
    missing.push("staging shadow review sample stop before evidence");
  }
  if (!stagingShadow.includes("corepack pnpm data-os:review-queue")) {
    missing.push("staging shadow review queue CLI pause hint");
  }
  if (!stagingShadow.includes("corepack pnpm data-os:staging-finalize")) {
    missing.push("staging shadow staging finalize pause hint");
  }
  if (!stagingShadow.includes("do not attach it to PR evidence")) {
    missing.push("staging shadow private review queue warning");
  }
  if (!stagingShadow.includes("evidence.json")) missing.push("staging shadow evidence JSON artifact");
  if (!stagingShadow.includes("evidence.md")) missing.push("staging shadow evidence markdown artifact");
  if (!stagingShadow.includes("evidence-pack-validation.json")) {
    missing.push("staging shadow evidence pack validation artifact");
  }
  if (!stagingShadow.includes("data-os:validate-evidence-pack")) {
    missing.push("staging shadow evidence pack validation command");
  }
  if (!stagingShadow.includes("release-gate.json")) {
    missing.push("staging shadow release gate artifact");
  }
  if (!stagingShadow.includes("data-os:release-gate")) {
    missing.push("staging shadow release gate command");
  }
  if (!stagingShadow.includes("pr-summary.md")) missing.push("staging shadow PR summary artifact");
  if (!stagingShadow.includes("data-os:pr-summary")) missing.push("staging shadow PR summary command");
  if (!stagingShadow.includes("completion-audit.json")) missing.push("staging shadow completion audit artifact");
  if (!stagingShadow.includes("data-os:completion-audit")) missing.push("staging shadow completion audit command");
  if (!stagingShadow.includes("append_release_gate_summary\n\nrun_capture evidence-pack-validation.json")) {
    missing.push("staging shadow release gate summary before validation");
  }
  if (!stagingShadow.includes("run_capture_without_summary release-gate.json")) {
    missing.push("staging shadow release gate without README mutation");
  }
  if (!stagingShadow.includes("Evidence package:")) missing.push("staging shadow evidence package pointer");
  if (!stagingShadow.includes("Corpus: set (redacted)") || !stagingShadow.includes("Output: set (redacted)")) {
    missing.push("staging shadow console corpus/output redaction");
  }
  if (!stagingShadow.includes("NOISIA_REMOTE_DATABASE_TARGET")) missing.push("staging shadow target guard");
  if (!stagingShadow.includes("NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA")) {
    missing.push("staging shadow optional schema apply guard");
  }
  if (!stagingShadow.includes("NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=true")) {
    missing.push("staging shadow schema apply remote guard");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_CANDIDATES_ALLOW_REMOTE=true")) {
    missing.push("staging shadow candidates remote guard");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_SHADOW_RUN_ENABLED=true")) {
    missing.push("staging shadow run enable guard");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE=true")) {
    missing.push("staging shadow analyze remote guard");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE=true")) {
    missing.push("staging shadow serving smoke remote guard");
  }
  if (!stagingShadow.includes("NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE=true")) {
    missing.push("staging shadow evidence remote guard");
  }
  if (!stagingShadow.includes("Data OS staging shadow completed.")) missing.push("staging shadow completion marker");
  if (!prTemplate.includes("Data OS evidence")) missing.push("PR template Data OS evidence section");
  if (!prTemplate.includes("corepack pnpm --filter @noisia/studio build")) {
    missing.push("PR template Studio build gate");
  }
  if (!prTemplate.includes("CI `Studio production build` passed")) {
    missing.push("PR template CI Studio build gate");
  }
  if (!prTemplate.includes("ready_for_pr_review: true")) missing.push("PR template PR evidence gate");
  if (!prTemplate.includes("customer_intelligence_lakehouse_cdp_like")) {
    missing.push("PR template architecture decision evidence");
  }
  if (!prTemplate.includes("corepack pnpm data-os:staging-shadow")) {
    missing.push("PR template staging shadow evidence pack gate");
  }
  if (!prTemplate.includes("corepack pnpm data-os:staging-check")) {
    missing.push("PR template staging check command");
  }
  if (!prTemplate.includes("DATABASE_URL_ENVIRONMENT=remote_redacted")) {
    missing.push("PR template staging remote database environment gate");
  }
  if (!prTemplate.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("PR template staging database format gate");
  }
  if (!prTemplate.includes("staging-check.txt")) {
    missing.push("PR template staging check artifact");
  }
  if (!prTemplate.includes("LOCAL_DATA_OS_VERIFY=passed")) {
    missing.push("PR template staging local verifier marker");
  }
  if (!prTemplate.includes("corepack pnpm data-os:validate-evidence-pack")) {
    missing.push("PR template evidence pack validation command");
  }
  if (!prTemplate.includes("pr-summary.md")) missing.push("PR template PR-safe summary artifact");
  if (!prTemplate.includes("corepack pnpm data-os:pr-summary")) missing.push("PR template PR-safe summary command");
  if (!prTemplate.includes("local_data_os_verify_precheck")) {
    missing.push("PR template local verifier summary gate");
  }
  if (!prTemplate.includes("Database format: postgres_url")) {
    missing.push("PR template PR summary database format gate");
  }
  if (!prTemplate.includes("completion-audit.json")) missing.push("PR template completion audit artifact");
  if (!prTemplate.includes("corepack pnpm data-os:completion-audit")) {
    missing.push("PR template completion audit command");
  }
  if (!prTemplate.includes("ready_for_goal_completion: true")) {
    missing.push("PR template completion audit gate");
  }
  if (!prTemplate.includes("database_format_postgres_url")) {
    missing.push("PR template completion audit database format gate");
  }
  if (!prTemplate.includes("do not paste raw `shadow-run.log` if it contains corpus/output UUIDs")) {
    missing.push("PR template raw shadow-run warning");
  }
  if (!prTemplate.includes("do not paste raw `analyze.json` if it contains corpus UUIDs")) {
    missing.push("PR template raw analyze warning");
  }
  if (!prTemplate.includes("do not paste raw `evidence.json` if it contains corpus/output/brand UUIDs")) {
    missing.push("PR template raw evidence JSON warning");
  }
  if (!prTemplate.includes("`evidence.md` pasted/summarized in the PR includes the architecture decision")) {
    missing.push("PR template evidence markdown architecture decision gate");
  }
  if (!prTemplate.includes("IDs redacted")) missing.push("PR template evidence markdown ID redaction gate");
  if (!prTemplate.includes("no DB URLs, API keys/tokens, or corpus/output UUIDs in `evidence.md`")) {
    missing.push("PR template sensitive artifact scan gate");
  }
  if (!prTemplate.includes("artifact_manifest_algorithm")) {
    missing.push("PR template artifact manifest checksum gate");
  }
  if (!prTemplate.includes("Evidence pack validates Data Catalog + lineage serving counts")) {
    missing.push("PR template Data Catalog lineage evidence gate");
  }
  if (!prTemplate.includes("Evidence pack validates Brand OS/Knowledge links")) {
    missing.push("PR template Brand OS Knowledge link evidence gate");
  }
  if (!prTemplate.includes("brand_os_briefs")) missing.push("PR template Brand OS brief evidence gate");
  if (!prTemplate.includes("Evidence pack includes redacted `review-queue.json` plus Data OS Review Queue gates")) {
    missing.push("PR template review queue evidence gate");
  }
  if (!prTemplate.includes("ready_for_human_review: true")) {
    missing.push("PR template review queue human review gate");
  }
  if (!prTemplate.includes("required_before_client_visible: true")) {
    missing.push("PR template review queue client-visible gate");
  }
  if (!prTemplate.includes("tag_review_events >= 1")) {
    missing.push("PR template tag review event gate");
  }
  if (!prTemplate.includes("knowledge_assertion_review_events >= 1")) {
    missing.push("PR template assertion review event gate");
  }
  if (!prTemplate.includes("review-sample.json")) missing.push("PR template review sample artifact");
  if (!prTemplate.includes("data-os:review-queue")) {
    missing.push("PR template review queue private output warning");
  }
  if (!prTemplate.includes("ready_for_release_review_sample: true")) {
    missing.push("PR template review sample readiness gate");
  }
  if (!prTemplate.includes("review_event_created: true")) {
    missing.push("PR template review sample event gate");
  }
  if (!prTemplate.includes("next_flags") || !prTemplate.includes("rollback_flags")) {
    missing.push("PR template safe next/rollback flags gate");
  }
  if (!prTemplate.includes("corepack pnpm data-os:release-gate")) {
    missing.push("PR template release gate command");
  }
  if (!prTemplate.includes("release-gate.json")) missing.push("PR template release gate artifact");
  if (!prTemplate.includes(".data/data-os-evidence")) missing.push("PR template evidence pack path");
  if (!prTemplate.includes("CI `Data OS local smoke` passed")) missing.push("PR template CI Data OS local smoke gate");
  if (!prTemplate.includes("data-os:validate-local-smoke")) missing.push("PR template local smoke validation gate");
  if (!prTemplate.includes("ready_for_staging_preflight: true")) {
    missing.push("PR template local smoke staging preflight readiness");
  }
  if (!prTemplate.includes("published_outputs.payload")) missing.push("PR template payload fallback");
  if (!codeowners.includes("/apps/studio/src/app/api/data-os/")) missing.push("CODEOWNERS Data OS API path");
  if (!codeowners.includes("/apps/studio/src/lib/data-os/")) missing.push("CODEOWNERS Data OS lib path");
  if (!codeowners.includes("/apps/studio/src/lib/queue/data-os.ts")) missing.push("CODEOWNERS Data OS queue path");
  if (!guardrails.includes("Data OS / Live Serving")) missing.push("guardrails Data OS section");
  if (!guardrails.includes("NOISIA_DATA_OS_ENABLED")) missing.push("guardrails Data OS flags");
  if (!guardrails.includes("NOISIA_DATA_OS_WORKER_RUNS_ENABLED")) missing.push("guardrails Data OS worker execution gate");
  if (!guardrails.includes("Remote worker approval is ignored")) {
    missing.push("guardrails Data OS worker remote target gate");
  }
  if (!guardrails.includes("NOISIA_REMOTE_DATABASE_TARGET=staging")) missing.push("guardrails remote target guard");
  if (!guardrails.includes("NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true")) {
    missing.push("guardrails staging shadow approval guard");
  }
  if (!guardrails.includes(".data/data-os-evidence")) missing.push("guardrails staging evidence pack path");
  if (!guardrails.includes("staging-check.txt")) missing.push("guardrails staging check artifact");
  if (!guardrails.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("guardrails staging check database format gate");
  }
  if (!guardrails.includes("database_format_postgres_url")) {
    missing.push("guardrails release database format gate");
  }
  if (!guardrails.includes("brand_os_briefs >= 1")) missing.push("guardrails Brand OS brief gate");
  if (!guardrails.includes("review-sample.json")) missing.push("guardrails human review sample artifact");
  if (!guardrails.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true")) {
    missing.push("guardrails human review sample approval guard");
  }
  if (!guardrails.includes("review tag/assertion ID format checks")) {
    missing.push("guardrails human review ID format gates");
  }
  if (!guardrails.includes("data-os:evidence")) missing.push("guardrails evidence gate");
  if (!guardrails.includes("data-os:release-gate")) missing.push("guardrails release gate");
  if (!guardrails.includes("disposable Postgres Data OS smoke path")) missing.push("guardrails CI local smoke gate");
  if (!guardrails.includes("published_outputs.payload")) missing.push("guardrails payload fallback");
  if (!adr.includes("rollback is logical")) missing.push("ADR logical rollback contract");
  if (!adr.includes("NOISIA_DATA_OS_WORKER_RUNS_ENABLED")) missing.push("ADR Data OS worker execution gate");
  if (!adr.includes("published_outputs.payload") || !adr.includes("fallback snapshot")) {
    missing.push("ADR payload fallback contract");
  }
  if (!branches.includes(`### \`${DATA_OS_WORK_BRANCH}\``)) missing.push("branches doc Data OS branch");
  if (!branches.includes("codex/signal-pulse")) missing.push("branches doc Signal Pulse base");
  if (!branches.includes("Fork point:")) missing.push("branches doc Data OS fork point");
  if (!branches.includes("e329136")) missing.push("branches doc Data OS fork commit");
  if (!branches.includes("Do not branch Data OS directly from `main`")) {
    missing.push("branches doc no direct main branch guard");
  }
  if (!completionAuditDoc.includes("fork point")) {
    missing.push("completion audit doc fork point requirement");
  }
  if (!completionAuditDoc.includes("Verificado por `git merge-base`")) {
    missing.push("completion audit doc branch lineage verification caveat");
  }
  if (!technicalDecisions.includes("codex/signal-pulse") && !spec.includes("codex/signal-pulse")) {
    missing.push("Data OS docs Signal Pulse base pointer");
  }
  if (!guardrails.includes("Never commit or push directly to `main`")) {
    missing.push("guardrails no main push rule");
  }
  if (!branches.includes("release-gate.json") || !branches.includes("ready_for_production_review: true")) {
    missing.push("branches doc release gate merge requirement");
  }
  if (!branches.includes('database_format: "postgres_url"')) {
    missing.push("branches doc database format release gate");
  }
  if (!branches.includes("database_format_postgres_url")) {
    missing.push("branches doc database format gate name");
  }
  if (!branches.includes("ready_for_live_api_shadow: true")) missing.push("branches doc live API shadow gate");
  if (!branches.includes("ready_for_serving_shadow: true")) missing.push("branches doc serving shadow gate");
  if (!technicalDecisions.includes("Data OS Cut 1, no CDP completo")) missing.push("technical decisions Data OS section");
  if (!technicalDecisions.includes("Customer Intelligence Lakehouse")) missing.push("technical decisions lakehouse framing");
  if (!technicalDecisions.includes("published_outputs.payload")) missing.push("technical decisions payload fallback");
  if (!technicalDecisions.includes("data-os:evidence")) missing.push("technical decisions evidence gate");
  if (!technicalDecisions.includes("data-os:release-gate")) missing.push("technical decisions release gate");
  if (!technicalDecisions.includes("database_format_postgres_url")) {
    missing.push("technical decisions database format release gate");
  }
  if (!schemaDoc.includes("Data OS Cut 1")) missing.push("database schema Data OS section");
  for (const table of [
    "data_assets",
    "data_contracts",
    "data_quality_results",
    "brand_os_profiles",
    "brand_os_briefs",
    "knowledge_assertions",
    "knowledge_assertion_review_events",
    "taxonomies",
    "tagging_rule_sets",
    "record_tags",
    "lineage_edges",
    "metric_definitions",
    "dashboard_data_refs",
    "signal_workspaces",
    "signal_workspace_corpora",
    "signal_refresh_policies",
    "signal_data_watermarks",
    "signal_refresh_runs",
    "signal_data_invalidations",
    "signal_interpretation_freshness",
    "metric_interpretation_runs",
    "metric_interpretations",
    "metric_interpretation_evidence",
    "tb_finding_structured_evidence_refs"
  ]) {
    if (!schemaDoc.includes(table)) missing.push(`database schema missing ${table}`);
  }
  if (!schemaDoc.includes("published_outputs.payload")) missing.push("database schema payload fallback");
  if (!schemaDoc.includes("database_format_postgres_url")) {
    missing.push("database schema database format release gate");
  }
  if (!schemaDoc.includes("data-os:evidence")) missing.push("database schema evidence gate");
  if (!schemaDoc.includes("data-os:release-gate")) missing.push("database schema release gate");
  if (!apiContracts.includes("Data OS serving endpoints")) missing.push("API contracts Data OS section");
  for (const endpoint of [
    "GET /api/data-os/corpora/:id/brand-os",
    "GET /api/data-os/corpora/:id/catalog",
    "GET /api/data-os/corpora/:id/knowledge",
    "GET /api/data-os/corpora/:id/lineage",
    "GET /api/data-os/corpora/:id/readiness",
    "GET /api/data-os/corpora/:id/review-queue",
    "POST /api/data-os/corpora/:id/review-queue",
    "GET /api/data-os/corpora/:id/artifacts/:artifactId/review",
    "POST /api/data-os/corpora/:id/artifacts/:artifactId/review",
    "GET /api/data-os/corpora/:id/sources",
    "GET /api/data-os/corpora/:id/source-health",
    "GET /api/data-os/corpora/:id/taxonomies",
    "GET /api/data-os/corpora/:id/tags",
    "GET /api/data-os/pulse/:outputId/live",
    "GET /api/data-os/pulse/:outputId/metrics",
    "GET /api/data-os/pulse/:outputId/corpus",
    "GET /api/data-os/signal/:workspaceId/bootstrap",
    "GET /api/data-os/signal/:workspaceId/facets",
    "GET /api/data-os/signal/:workspaceId/metric-groups",
    "GET /api/data-os/signal/:workspaceId/series",
    "GET /api/data-os/signal/:workspaceId/breakdowns",
    "GET /api/data-os/signal/:workspaceId/comparison",
    "GET /api/data-os/signal/:workspaceId/mentions",
    "GET /api/data-os/signal/:workspaceId/lineage",
    "GET /api/data-os/signal/:workspaceId/interpretations"
  ]) {
    if (!apiContracts.includes(endpoint)) missing.push(`API contracts missing ${endpoint}`);
  }
  if (!apiContracts.includes("NOISIA_DATA_OS_SERVING_ENABLED=true")) missing.push("API contracts serving flag");
  if (!apiContracts.includes("NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=true")) missing.push("API contracts Signal Pulse live flag");
  if (!apiContracts.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=true")) {
    missing.push("API contracts Signal Pulse live render flag");
  }
  if (!apiContracts.includes("NOISIA_SIGNAL_WORKSPACE_API_ENABLED=true")) {
    missing.push("API contracts Signal workspace API flag");
  }
  if (!apiContracts.includes("NOISIA_SIGNAL_AD_HOC_MATERIALIZATION_ENABLED")) {
    missing.push("API contracts Signal ad hoc materialization flag");
  }
  if (!apiContracts.includes("published_outputs.payload")) missing.push("API contracts payload fallback");
  if (!apiContracts.includes("canViewClientOutputs")) missing.push("API contracts Pulse output read auth");
  if (!apiContracts.includes("visibility_config")) missing.push("API contracts Pulse visibility guard");
  if (!apiContracts.includes("source_health")) missing.push("API contracts Pulse source health visibility");
  if (!apiContracts.includes("demographic")) missing.push("API contracts demographic corpus filter");
  if (!apiContracts.includes("tag_review_events")) missing.push("API contracts tag review audit trail");
  if (!apiContracts.includes("knowledge_assertion_review_events")) {
    missing.push("API contracts assertion review audit trail");
  }
  if (!apiContracts.includes("record_tags.review_status")) missing.push("API contracts review queue status write");
  if (!apiContracts.includes("knowledge_assertions.status")) {
    missing.push("API contracts assertion review status write");
  }
  if (!spec.includes("data-os:shadow-run")) missing.push("spec shadow-run rollout command");
  if (!spec.includes("data-os:local-smoke")) missing.push("spec local smoke command");
  if (!spec.includes("data-os:staging-shadow")) missing.push("spec staging shadow wrapper command");
  if (!spec.includes("data-os:staging-check")) missing.push("spec staging check command");
  if (!spec.includes("NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid")) {
    missing.push("spec staging check UUID format gate");
  }
  if (!spec.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("spec staging check database format gate");
  }
  if (!spec.includes("data-os:serving-smoke")) missing.push("spec serving smoke gate");
  if (!spec.includes("data-os:release-gate")) missing.push("spec release gate command");
  if (!spec.includes("release-gate.json")) missing.push("spec release gate artifact");
  if (!spec.includes("manifest SHA-256")) missing.push("spec release gate artifact checksum guard");
  if (!spec.includes("database_format_postgres_url")) {
    missing.push("spec release gate database format gate");
  }
  if (!spec.includes("DATABASE_URL_ENVIRONMENT=production_like_refused")) {
    missing.push("spec production-like URL refusal");
  }
  if (!spec.includes("no deja un evidence pack parcial")) {
    missing.push("spec staging precheck before evidence pack");
  }
  if (!spec.includes("NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=true")) {
    missing.push("spec staging pair preflight before evidence pack");
  }
  if (!spec.includes("aplica schema\nantes del preflight output/corpus")) {
    missing.push("spec staging schema apply before pair preflight");
  }
  if (!spec.includes("data_os_shadow_run")) missing.push("spec Data OS worker job contract");
  if (!spec.includes("NOISIA_DATA_OS_WORKER_RUNS_ENABLED")) missing.push("spec Data OS worker execution gate");
  if (!spec.includes("published_outputs.payload")) missing.push("spec payload fallback");
  if (!spec.includes("canViewClientOutputs")) missing.push("spec Pulse output read auth");
  if (!spec.includes("visibility_config")) missing.push("spec Pulse visibility guard");
  if (!spec.includes("source_health")) missing.push("spec Pulse source health visibility guard");
  if (!spec.includes("visibility_checks")) missing.push("spec serving smoke visibility checks");
  if (!spec.includes("brand_os_briefs")) missing.push("spec Brand OS brief catalog");
  if (!spec.includes("demographic")) missing.push("spec demographic taxonomy/filter");
  if (!spec.includes("tag_assertion_review_queue")) missing.push("spec review queue gate");
  if (!spec.includes("review_queue")) missing.push("spec review queue object");
  if (!spec.includes("ready_for_human_review: true")) missing.push("spec human review readiness");
  if (!spec.includes("required_before_client_visible: true")) {
    missing.push("spec client-visible review requirement");
  }
  if (!spec.includes("POST /api/data-os/corpora/:id/review-queue")) {
    missing.push("spec review queue mutation endpoint");
  }
  if (!spec.includes("tag_review_events")) missing.push("spec tag review audit trail");
  if (!spec.includes("knowledge_assertion_review_events")) missing.push("spec assertion review audit trail");
  if (!spec.includes("evidence.md` es el archivo listo para PR y debe\nmantener IDs redactados")) {
    missing.push("spec evidence markdown ID redaction");
  }
  if (!spec.includes("bloquea UUIDs reales en `evidence.md`")) {
    missing.push("spec evidence markdown UUID guard");
  }
  if (!runbook.includes("data-os:shadow-run")) missing.push("staging runbook shadow-run command");
  if (!runbook.includes("data-os:staging-shadow")) missing.push("staging runbook staging shadow wrapper");
  if (!runbook.includes("corepack pnpm --filter @noisia/studio build")) {
    missing.push("staging runbook Studio build gate");
  }
  if (!runbook.includes("`node:crypto`")) {
    missing.push("staging runbook node:crypto build regression gate");
  }
  if (!runbook.includes("data-os:staging-finalize")) missing.push("staging runbook staging finalize wrapper");
  if (!runbook.includes("data-os:staging-check")) missing.push("staging runbook staging check command");
  if (!runbook.includes("ready_for_staging_shadow=true")) missing.push("staging runbook staging check readiness");
  if (!runbook.includes("LOCAL_DATA_OS_VERIFY=passed")) {
    missing.push("staging runbook local verifier marker");
  }
  if (!runbook.includes("NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid")) {
    missing.push("staging runbook UUID format gate");
  }
  if (!runbook.includes("NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid")) {
    missing.push("staging runbook review sample tag id UUID gate");
  }
  if (!runbook.includes("NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid")) {
    missing.push("staging runbook review sample assertion id UUID gate");
  }
  if (!runbook.includes("NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true")) {
    missing.push("staging runbook approval guard");
  }
  if (!runbook.includes(".data/data-os-evidence")) missing.push("staging runbook evidence pack path");
  if (!runbook.includes("staging-check.txt")) missing.push("staging runbook staging check artifact");
  if (!runbook.includes("candidates.json")) missing.push("staging runbook candidates artifact");
  if (!runbook.includes("shadow-run.log")) missing.push("staging runbook shadow-run artifact");
  if (!runbook.includes("analyze.json")) missing.push("staging runbook analyze artifact");
  if (!runbook.includes("serving-smoke.json")) missing.push("staging runbook serving smoke artifact");
  if (!runbook.includes("brand_os_briefs >= 1")) {
    missing.push("staging runbook Brand OS brief gate");
  }
  if (!runbook.includes("review_queue_ready_for_human_review")) {
    missing.push("staging runbook serving smoke review queue readiness");
  }
  if (!runbook.includes("evidence.json")) missing.push("staging runbook evidence JSON artifact");
  if (!runbook.includes("evidence.md")) missing.push("staging runbook markdown evidence artifact");
  if (!runbook.includes("evidence.md`: evidencia lista para pegar en PR, con identificadores redactados")) {
    missing.push("staging runbook markdown evidence redaction");
  }
  if (!runbook.includes("no pegar crudos `shadow-run.log`, `analyze.json` ni `evidence.json`")) {
    missing.push("staging runbook raw machine artifact warning");
  }
  if (!runbook.includes("Puede contener\n  UUIDs reales de corpus/output/brand; se revisa dentro de `.data` y no se pega crudo")) {
    missing.push("staging runbook raw evidence JSON warning");
  }
  if (!runbook.includes("Architecture Decision")) {
    missing.push("staging runbook architecture decision evidence");
  }
  if (!runbook.includes("Review Queue")) {
    missing.push("staging runbook review queue evidence");
  }
  if (!runbook.includes("tag_assertion_review_queue")) {
    missing.push("staging runbook review queue gate");
  }
  if (!runbook.includes("ready_for_human_review: true")) {
    missing.push("staging runbook human review readiness");
  }
  if (!runbook.includes("required_before_client_visible: true")) {
    missing.push("staging runbook client-visible review requirement");
  }
  if (!runbook.includes("tag_review_events >= 1")) {
    missing.push("staging runbook tag review event gate");
  }
  if (!runbook.includes("knowledge_assertion_review_events >= 1")) {
    missing.push("staging runbook assertion review event gate");
  }
  if (!runbook.includes("corepack pnpm data-os:review-sample")) {
    missing.push("staging runbook human review sample command");
  }
  if (!runbook.includes("corepack pnpm data-os:review-queue")) {
    missing.push("staging runbook review queue CLI command");
  }
  if (!runbook.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true")) {
    missing.push("staging runbook explicit human review sample approval");
  }
  if (!runbook.includes("NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=true")) {
    missing.push("staging runbook review queue ID disclosure guard");
  }
  if (!runbook.includes("NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=true")) {
    missing.push("staging runbook review queue private context disclosure guard");
  }
  if (!reviewQueue.includes("requireSafeDatabaseReadTarget")) {
    missing.push("review queue CLI safe read target guard");
  }
  if (!reviewQueue.includes("NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE")) {
    missing.push("review queue CLI remote allow env");
  }
  if (!reviewQueue.includes("NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS")) {
    missing.push("review queue CLI ID disclosure flag");
  }
  if (!reviewQueue.includes("NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT")) {
    missing.push("review queue CLI context disclosure flag");
  }
  if (!reviewQueue.includes("do_not_commit_or_paste_when_sensitive")) {
    missing.push("review queue CLI sensitive output warning");
  }
  if (!reviewQueue.includes("suggested_exports")) {
    missing.push("review queue CLI suggested finalize exports");
  }
  if (!runbook.includes("NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=true")) {
    missing.push("staging runbook review sample remote guard");
  }
  if (!reviewSample.includes("requireSafeDatabaseWriteTarget")) {
    missing.push("review sample safe write target guard");
  }
  if (!reviewSample.includes("NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE")) {
    missing.push("review sample remote allow env");
  }
  if (!reviewSample.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED")) {
    missing.push("review sample explicit approval env");
  }
  if (!reviewSample.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL")) {
    missing.push("review sample local auto-select env");
  }
  if (!reviewSample.includes("isLocalDatabaseUrl")) {
    missing.push("review sample local auto-select database guard");
  }
  if (!reviewSample.includes("only allowed for local disposable databases")) {
    missing.push("review sample local auto-select remote refusal");
  }
  if (!reviewSample.includes("NOISIA_DATA_OS_REVIEW_TAG_ID")) {
    missing.push("review sample tag id env");
  }
  if (!reviewSample.includes("NOISIA_DATA_OS_REVIEW_ASSERTION_ID")) {
    missing.push("review sample assertion id env");
  }
  if (!reviewSample.includes("tag_review_events")) {
    missing.push("review sample tag review audit trail");
  }
  if (!reviewSample.includes("knowledge_assertion_review_events")) {
    missing.push("review sample assertion review audit trail");
  }
  if (!reviewSample.includes("set_redacted")) {
    missing.push("review sample redacted output");
  }
  if (!runbook.includes("customer_intelligence_lakehouse_cdp_like")) {
    missing.push("staging runbook product category evidence");
  }
  if (!runbook.includes("exige que `evidence.md` no contenga UUIDs reales")) {
    missing.push("staging runbook markdown UUID guard");
  }
  if (!runbook.includes("evidence-pack-validation.json")) {
    missing.push("staging runbook evidence pack validation artifact");
  }
  if (!runbook.includes("artifact_manifest_algorithm")) {
    missing.push("staging runbook artifact manifest checksum output");
  }
  if (!runbook.includes("manifest SHA-256")) {
    missing.push("staging runbook artifact checksum drift guard");
  }
  if (!runbook.includes("release-gate.json")) {
    missing.push("staging runbook release gate artifact");
  }
  if (!runbook.includes("pr-summary.md")) missing.push("staging runbook PR summary artifact");
  if (!runbook.includes("data-os:pr-summary")) missing.push("staging runbook PR summary command");
  if (!runbook.includes("completion-audit.json")) missing.push("staging runbook completion audit artifact");
  if (!runbook.includes("data-os:completion-audit")) missing.push("staging runbook completion audit command");
  if (!runbook.includes("ready_for_goal_completion: true")) {
    missing.push("staging runbook completion audit gate");
  }
  if (!runbook.includes("data-os:validate-evidence-pack")) {
    missing.push("staging runbook evidence pack validation command");
  }
  if (!runbook.includes("NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=true")) missing.push("staging runbook schema apply guard");
  if (!runbook.includes("NOISIA_REMOTE_DATABASE_TARGET=staging")) missing.push("staging runbook remote target guard");
  if (!runbook.includes("demographic")) missing.push("staging runbook demographic tag gate");
  if (!runbook.includes("ready_for_live_api_shadow: true")) missing.push("staging runbook live API shadow gate");
  if (!runbook.includes("NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=false")) missing.push("staging runbook rollback flags");
  if (!runbook.includes("published_outputs.payload")) missing.push("staging runbook payload fallback");
  if (!runbook.includes("visibility_checks")) missing.push("staging runbook visibility checks");
  if (!runbook.includes("POST /api/data-os/corpora/:id/review-queue")) {
    missing.push("staging runbook review queue mutation");
  }
  if (!prSummary.includes("PR summary must not include corpus, output, brand, tag or assertion UUID values")) {
    missing.push("PR summary UUID guard");
  }
  if (!prSummary.includes("PR summary must not include")) missing.push("PR summary sensitive artifact guard");
  if (!prSummary.includes("external_path_redacted")) missing.push("PR summary external path redaction");
  if (!prSummary.includes("## PR-Safe Evidence")) missing.push("PR summary evidence markdown section");
  if (!prSummary.includes("Release gates checked")) missing.push("PR summary release gate list");
  if (!prSummary.includes("local_data_os_verify_precheck")) {
    missing.push("PR summary local verifier release gate line");
  }
  if (!prSummary.includes("Database format:")) missing.push("PR summary database format line");
  if (!prSummary.includes("database_format")) missing.push("PR summary database format source");
  if (!prSummary.includes("database_format=postgres_url")) {
    missing.push("PR summary database format release guard");
  }
  if (!prSummary.includes("Do not paste raw `shadow-run.log`, `analyze.json` or `evidence.json`")) {
    missing.push("PR summary raw artifact warning");
  }
  if (!runbook.includes("data-os:serving-smoke")) missing.push("staging runbook serving smoke command");
  if (!runbook.includes("data-os:evidence")) missing.push("staging runbook PR evidence command");
  if (!runbook.includes("data-os:release-gate")) missing.push("staging runbook release gate command");
  if (!runbook.includes("DATABASE_URL_ENVIRONMENT=production_like_refused")) {
    missing.push("staging runbook production-like URL refusal");
  }
  if (!runbook.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("staging runbook postgres URL format requirement");
  }
  if (!runbook.includes("DATABASE_URL_FORMAT=placeholder_refused")) {
    missing.push("staging runbook placeholder URL refusal");
  }
  if (!runbook.includes("no deja un evidence pack parcial")) {
    missing.push("staging runbook precheck before evidence pack");
  }
  if (!runbook.includes("data-os:preflight")) {
    missing.push("staging runbook pair preflight before evidence pack");
  }
  if (!runbook.includes("aplica schema antes del preflight output/corpus")) {
    missing.push("staging runbook schema apply before pair preflight");
  }
  if (!runbook.includes("Camino Worker Opcional")) missing.push("staging runbook Data OS worker path");
  if (!runbook.includes("data_os_shadow_run")) missing.push("staging runbook Data OS worker job contract");
  if (!runbook.includes("sin ese target\npermitido")) missing.push("staging runbook worker remote target gate");
  if (!handoff.includes("corepack pnpm typecheck")) missing.push("staging handoff typecheck gate");
  if (!handoff.includes("corepack pnpm lint")) missing.push("staging handoff lint gate");
  if (!handoff.includes("corepack pnpm test")) missing.push("staging handoff test gate");
  if (!handoff.includes("corepack pnpm --filter @noisia/studio build")) {
    missing.push("staging handoff Studio build gate");
  }
  if (!handoff.includes("corepack pnpm data-os:verify")) missing.push("staging handoff verifier gate");
  if (!handoff.includes("export DATABASE_URL=<staging_or_preview_database_url>")) {
    missing.push("staging handoff database URL env");
  }
  if (!handoff.includes("export NOISIA_REMOTE_DATABASE_TARGET=staging")) {
    missing.push("staging handoff remote target env");
  }
  if (!handoff.includes("export NOISIA_DATA_OS_BACKFILL_CORPUS_ID=<study_corpus_uuid>")) {
    missing.push("staging handoff corpus env");
  }
  if (!handoff.includes("export NOISIA_DATA_OS_SHADOW_OUTPUT_ID=<published_signal_pulse_output_uuid>")) {
    missing.push("staging handoff output env");
  }
  if (!handoff.includes("export NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true")) {
    missing.push("staging handoff shadow approval env");
  }
  if (!handoff.includes("DATABASE_URL_ENVIRONMENT=remote_redacted")) {
    missing.push("staging handoff remote redacted gate");
  }
  if (!handoff.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("staging handoff postgres URL format requirement");
  }
  if (!handoff.includes("DATABASE_URL_FORMAT=placeholder_refused")) {
    missing.push("staging handoff placeholder URL refusal");
  }
  if (!handoff.includes("LOCAL_DATA_OS_VERIFY=passed")) {
    missing.push("staging handoff local verifier marker");
  }
  if (!handoff.includes("ready_for_staging_shadow=true")) {
    missing.push("staging handoff staging check readiness");
  }
  if (!handoff.includes("corepack pnpm data-os:staging-shadow")) {
    missing.push("staging handoff staging shadow command");
  }
  if (!handoff.includes("NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=true")) {
    missing.push("staging handoff private review queue ID disclosure");
  }
  if (!handoff.includes("NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=true")) {
    missing.push("staging handoff private review queue context disclosure");
  }
  if (!handoff.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true")) {
    missing.push("staging handoff human review approval");
  }
  if (!handoff.includes("corepack pnpm data-os:staging-finalize")) {
    missing.push("staging handoff finalize command");
  }
  if (!handoff.includes("release-gate.json")) missing.push("staging handoff release gate artifact");
  if (!handoff.includes("\"ready_for_production_review\": true")) {
    missing.push("staging handoff production review gate");
  }
  if (!handoff.includes("pr-summary.md")) missing.push("staging handoff PR summary artifact");
  if (!handoff.includes("completion-audit.json")) missing.push("staging handoff completion audit artifact");
  if (!handoff.includes("evidence.md")) missing.push("staging handoff PR-safe evidence artifact");
  if (!handoff.includes("No pegar")) missing.push("staging handoff sensitive artifact warning");
  if (!handoff.includes("UUIDs reales")) missing.push("staging handoff UUID paste warning");
  if (!handoff.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false")) {
    missing.push("staging handoff live render guarded flag");
  }
  if (!handoff.includes("NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=false")) {
    missing.push("staging handoff rollback live API flag");
  }
  if (!handoff.includes("NOISIA_DATA_OS_SHADOW_MODE=true")) {
    missing.push("staging handoff shadow mode flag");
  }
  if (!completionAuditDoc.includes("Noisia Data OS Completion Audit")) {
    missing.push("completion audit title");
  }
  if (!completionAuditDoc.includes("release-gate.json")) missing.push("completion audit release gate artifact");
  if (!completionAuditDoc.includes("\"ready_for_production_review\": true")) {
    missing.push("completion audit production review gate");
  }
  if (!completionAuditDoc.includes("Un smoke local o una DB `throwaway`")) {
    missing.push("completion audit local/throwaway insufficiency");
  }
  if (!completionAuditDoc.includes("Data Catalog vivo")) missing.push("completion audit Data Catalog requirement");
  if (!completionAuditDoc.includes("Brand OS catalogado")) missing.push("completion audit Brand OS requirement");
  if (!completionAuditDoc.includes("Knowledge Base como datos")) {
    missing.push("completion audit Knowledge Catalog requirement");
  }
  if (!completionAuditDoc.includes("Taxonomias y tags versionados")) {
    missing.push("completion audit taxonomy/tag requirement");
  }
  if (!completionAuditDoc.includes("Calidad y lineage")) missing.push("completion audit quality lineage requirement");
  if (!completionAuditDoc.includes("APIs de serving")) missing.push("completion audit serving API requirement");
  if (!completionAuditDoc.includes("Shadow mode seguro")) missing.push("completion audit shadow mode requirement");
  if (!completionAuditDoc.includes("Review humano antes de cliente")) {
    missing.push("completion audit human review requirement");
  }
  if (!completionAuditDoc.includes("corepack pnpm data-os:staging-shadow")) {
    missing.push("completion audit staging shadow command");
  }
  if (!completionAuditDoc.includes("corepack pnpm data-os:staging-finalize")) {
    missing.push("completion audit staging finalize command");
  }
  if (!completionAuditDoc.includes("data-os:completion-audit")) {
    missing.push("completion audit CLI self-reference");
  }
  if (!completionAuditDoc.includes("completion-audit.json")) {
    missing.push("completion audit artifact self-reference");
  }
  if (!completionAuditDoc.includes("DATABASE_URL_ENVIRONMENT=remote_redacted")) {
    missing.push("completion audit remote database evidence");
  }
  if (!completionAuditDoc.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("completion audit database format staging check evidence");
  }
  if (!completionAuditDoc.includes('database_format: "postgres_url"')) {
    missing.push("completion audit database format JSON evidence");
  }
  if (!completionAuditDoc.includes("database_format_postgres_url")) {
    missing.push("completion audit database format release gate");
  }
  if (!completionAuditDoc.includes("backend-ready-signal-v2.json")) {
    missing.push("completion audit Signal V2 backend gate artifact");
  }
  if (!completionAuditDoc.includes("ready_for_release_review_sample: true")) {
    missing.push("completion audit review sample gate");
  }
  if (!completionAuditDoc.includes("manifest SHA-256")) missing.push("completion audit checksum manifest");
  if (!completionAuditDoc.includes("No Cuenta Como Completo")) missing.push("completion audit non-completion section");
  if (!completionAuditDoc.includes("Live render encendido antes del gate")) {
    missing.push("completion audit live render no-go");
  }
  if (!handoff.includes("data-os:completion-audit")) missing.push("staging handoff completion audit command");
  if (!handoff.includes("\"ready_for_goal_completion\": true")) {
    missing.push("staging handoff goal completion audit gate");
  }
  if (!completionAuditDoc.includes("ready_for_goal_completion")) {
    missing.push("completion audit doc goal completion output");
  }
  if (!completionAuditDoc.includes("data-os:completion-audit")) {
    missing.push("completion audit doc command");
  }
  if (!completionAuditDoc.includes("\"ready_for_goal_completion\": true")) {
    missing.push("completion audit doc goal completion gate");
  }
  if (!completionAuditDoc.includes("requirement_checks")) {
    missing.push("completion audit doc requirement checks matrix");
  }
  if (!completionAuditDoc.includes("catalogo, Brand OS, Knowledge Base, taxonomias")) {
    missing.push("completion audit doc full gate coverage");
  }
  if (!completionAuditDoc.includes("verifier local")) {
    missing.push("completion audit doc local verifier gate coverage");
  }
  if (!completionAuditDoc.includes("formato Postgres")) {
    missing.push("completion audit doc database format gate coverage");
  }
  if (!completionAuditDoc.includes("NOISIA_DATA_OS_EVIDENCE_PACK_DIR")) {
    missing.push("completion audit doc evidence pack env");
  }
  if (!completionAuditDoc.includes("Un smoke local o una DB `throwaway`")) {
    missing.push("completion audit doc throwaway insufficiency");
  }
  if (!completionAuditDoc.includes("release-gate.json")) {
    missing.push("completion audit doc release gate artifact");
  }
  if (!completionAuditDoc.includes("\"ready_for_production_review\": true")) {
    missing.push("completion audit doc production review gate");
  }
  if (!completionAuditDoc.includes("pr-summary.md")) missing.push("completion audit doc PR summary artifact");
  if (!completionAuditDoc.includes("Database format: postgres_url")) {
    missing.push("completion audit doc PR summary database format line");
  }
  if (!completionAuditDoc.includes("evidence.md")) missing.push("completion audit doc evidence markdown artifact");
  if (!completionAuditDoc.includes("No Cuenta Como Completo")) missing.push("completion audit doc no-go section");
  if (!completionAuditDoc.includes("staging` o `preview`")) missing.push("completion audit doc staging/preview requirement");
  if (!completionAuditDoc.includes("Review humano antes de cliente")) missing.push("completion audit doc human review requirement");
  if (!completionAuditDoc.includes("Shadow mode seguro")) missing.push("completion audit doc shadow mode requirement");
  if (!completionAuditDoc.includes("APIs de serving")) missing.push("completion audit doc serving API requirement");
  if (!completionAuditDoc.includes("Data Catalog vivo")) missing.push("completion audit doc data catalog requirement");
  if (!completionAuditDoc.includes("Brand OS catalogado")) missing.push("completion audit doc Brand OS requirement");
  if (!completionAuditDoc.includes("Knowledge Base como datos")) {
    missing.push("completion audit doc Knowledge Catalog requirement");
  }
  if (!completionAuditDoc.includes("Calidad y lineage")) missing.push("completion audit doc quality lineage requirement");
  if (!completionAuditDoc.includes("Taxonomias y tags versionados")) {
    missing.push("completion audit doc taxonomy tag requirement");
  }
  if (!completionAuditScript.includes("Local checks may be green, but the Goal is not complete")) {
    missing.push("completion audit CLI local checks insufficient note");
  }
  if (!completionAuditScript.includes("external_path_redacted")) {
    missing.push("completion audit CLI external path redaction");
  }
  if (!completionAuditScript.includes("sensitive_output_redacted")) {
    missing.push("completion audit CLI sensitive output redaction flag");
  }
  if (!completionAuditScript.includes("pr_safe")) missing.push("completion audit CLI PR-safe flag");
  if (!completionAuditScript.includes("REQUIRED_RELEASE_GATE_GATES")) {
    missing.push("completion audit CLI full release gate list");
  }
  if (!completionAuditScript.includes("requirement_checks")) {
    missing.push("completion audit CLI requirement checks matrix");
  }
  if (!completionAuditScript.includes("data_catalog_quality_and_lineage")) {
    missing.push("completion audit CLI data catalog release gate check");
  }
  if (!completionAuditScript.includes("brand_os_and_knowledge_catalogs")) {
    missing.push("completion audit CLI Brand OS Knowledge release gate check");
  }
  if (!completionAuditScript.includes("serving_shadow_ready")) {
    missing.push("completion audit CLI serving shadow release gate check");
  }
  if (!completionAuditScript.includes("local_data_os_verify_precheck")) {
    missing.push("completion audit CLI local verifier release gate check");
  }
  if (!completionAuditScript.includes("database_format_postgres_url")) {
    missing.push("completion audit CLI database format release gate check");
  }
  if (!completionAuditScript.includes("postgres_url database format evidence")) {
    missing.push("completion audit CLI validation database format check");
  }
  if (!completionAuditScript.includes("release-gate postgres_url database format")) {
    missing.push("completion audit CLI release database format check");
  }
  if (!completionAuditScript.includes("release-gate.ready_for_production_review=true")) {
    missing.push("completion audit CLI release gate check");
  }
  if (!completionAuditScript.includes("backend-ready-signal-v2.backend_ready_for_signal_v2=true")) {
    missing.push("completion audit CLI Signal V2 backend gate check");
  }
  if (!completionAuditScript.includes("evidence.md Architecture Decision")) {
    missing.push("completion audit CLI architecture evidence check");
  }
  if (!completionAuditScript.includes("pr-summary release gate line")) {
    missing.push("completion audit CLI PR summary release line check");
  }
  if (!completionAuditScript.includes("pr-summary release gates checked")) {
    missing.push("completion audit CLI PR summary release gates list check");
  }
  if (!completionAuditScript.includes("pr-summary local verifier gate")) {
    missing.push("completion audit CLI PR summary local verifier check");
  }
  if (!completionAuditScript.includes("pr-summary database format")) {
    missing.push("completion audit CLI PR summary database format check");
  }
  if (!completionAuditScript.includes("pr-summary Signal V2 backend gate")) {
    missing.push("completion audit CLI PR summary Signal V2 gate check");
  }
  if (!prSummary.includes("Backend Ready For Signal V2")) {
    missing.push("PR summary Signal V2 backend gate line");
  }
  if (!branches.includes(DATA_OS_WORK_BRANCH)) {
    missing.push("branches doc Data OS branch");
  }
  if (!completionAuditDoc.includes("Partir de `codex/signal-pulse`")) {
    missing.push("completion audit doc Signal Pulse base requirement");
  }
  if (!String(verifyBranchLineage).includes("merge-base")) {
    missing.push("readiness verifier branch lineage merge-base check");
  }
  if (!String(verifyBranchLineage).includes("DATA_OS_BASE_BRANCH")) {
    missing.push("readiness verifier Signal Pulse base branch constant");
  }
  if (!connection.includes("NOISIA_REMOTE_DATABASE_TARGET")) missing.push("connection remote target guard");
  if (!connection.includes("ALLOWED_REMOTE_DATABASE_TARGETS")) missing.push("connection allowed remote targets");
  if (!connection.includes("databaseUrlLooksProductionLike")) missing.push("connection production-like URL detector");
  if (!connection.includes("production-like environment markers")) missing.push("connection production-like URL refusal");
  if (!connection.includes("DATABASE_URL is not production")) missing.push("connection production wording guard");
  if (!analyze.includes("NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE")) missing.push("analyze remote guard");
  if (!analyze.includes("ANALYZE")) missing.push("analyze SQL operation");
  if (!analyze.includes("ready_for_serving_reads")) missing.push("analyze readiness output");
  if (!analyze.includes("lineage_edges")) missing.push("analyze lineage table coverage");
  if (!analyze.includes("brand_os_briefs")) missing.push("analyze Brand OS brief table coverage");
  if (!backfill.includes("INSERT INTO brand_os_briefs")) missing.push("backfill Brand OS brief catalog");
  if (!backfill.includes("brand_os_briefs_seen")) missing.push("backfill Brand OS brief counters");
  if (!backfill.includes("INSERT INTO brand_os_links")) missing.push("backfill Brand OS Knowledge links");
  if (!backfill.includes("INSERT INTO knowledge_assertion_links")) {
    missing.push("backfill Knowledge assertion links");
  }
  if (!backfill.includes("INSERT INTO knowledge_usage_events")) missing.push("backfill Knowledge usage events");
  if (!backfill.includes("brand_os_links_seen")) missing.push("backfill Brand OS link counters");
  if (!backfill.includes("knowledge_assertion_links_seen")) missing.push("backfill Knowledge assertion link counters");
  if (!backfill.includes("knowledge_usage_events_seen")) missing.push("backfill Knowledge usage counters");
  if (!evidence.includes("NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE")) missing.push("evidence remote guard");
  if (!evidence.includes("ready_for_pr_review")) missing.push("evidence PR readiness output");
  if (!evidence.includes("corepack pnpm data-os:analyze")) missing.push("evidence required analyze attachment");
  if (!evidence.includes("tagging_rule_sets")) missing.push("evidence tagging rule set gate");
  if (!evidence.includes("tag_review_events")) missing.push("evidence tag review event count");
  if (!evidence.includes("knowledge_assertion_review_events")) missing.push("evidence assertion review event count");
  if (!evidence.includes("tagging_model_versions_with_rule_set")) missing.push("evidence tagging model rule-set link gate");
  if (!evidence.includes("brand_os_briefs")) missing.push("evidence Brand OS brief count");
  if (!evidence.includes("brand_os_links")) missing.push("evidence Brand OS link count");
  if (!evidence.includes("knowledge_assertion_links")) missing.push("evidence Knowledge assertion link count");
  if (!evidence.includes("knowledge_usage_events")) missing.push("evidence Knowledge usage count");
  if (!evidence.includes("knowledge_catalog_linked")) missing.push("evidence knowledge catalog linked gate");
  if (!evidence.includes("record_tags_demographic")) missing.push("evidence demographic tag count");
  if (!evidence.includes("data_assets_without_fields")) missing.push("evidence field coverage gate");
  if (!evidence.includes("payload_fallback_required")) missing.push("evidence payload fallback gate");
  if (!evidence.includes("live_payload_parity")) missing.push("evidence live payload parity gate");
  if (!evidence.includes("Live report periods are behind published payload")) {
    missing.push("evidence live payload period parity failure");
  }
  if (!evidence.includes("rollback_flags")) missing.push("evidence rollback flags");
  if (!evidence.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED")) {
    missing.push("evidence live render flag guard");
  }
  if (!evidence.includes("architecture_decision")) missing.push("evidence architecture decision object");
  if (!evidence.includes("customer_intelligence_lakehouse_cdp_like")) {
    missing.push("evidence product category decision");
  }
  if (!evidence.includes("not_customer_360_identity_resolution_or_reverse_etl")) {
    missing.push("evidence CDP boundary decision");
  }
  if (!evidence.includes("live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback")) {
    missing.push("evidence live serving fallback decision");
  }
  if (!evidence.includes("id redacted")) missing.push("evidence markdown ID redaction");
  if (!evidence.includes("Identifiers: redacted for PR")) missing.push("evidence markdown PR-safe identifier notice");
  if (!evidence.includes("## Architecture Decision")) missing.push("evidence markdown architecture decision section");
  if (!evidence.includes("review_queue")) missing.push("evidence review queue object");
  if (!evidence.includes("tag_assertion_review_queue")) missing.push("evidence review queue gate");
  if (!evidence.includes("record_tags_with_evidence")) missing.push("evidence record tags evidence count");
  if (!evidence.includes("record_tag_taxonomies")) missing.push("evidence tag taxonomy coverage count");
  if (!evidence.includes("knowledge_assertions_with_evidence")) {
    missing.push("evidence knowledge assertions evidence count");
  }
  if (!evidence.includes("ready_for_human_review")) missing.push("evidence human review readiness");
  if (!evidence.includes("required_before_client_visible")) {
    missing.push("evidence client-visible review requirement");
  }
  if (!evidence.includes("## Review Queue")) missing.push("evidence markdown review queue section");
  if (!releaseGate.includes("ready_for_production_review")) missing.push("release gate production readiness output");
  if (!releaseGate.includes("displayEvidenceDir")) missing.push("release gate repo-relative evidence path output");
  if (!releaseGate.includes("resolveEvidenceDirReference")) {
    missing.push("release gate repo-relative evidence dir validation");
  }
  if (!releaseGate.includes("staging-check.txt")) missing.push("release gate staging check artifact");
  if (!releaseGate.includes("staging-check.txt target")) missing.push("release gate staging check target match");
  if (!releaseGate.includes("ready_for_staging_shadow=true")) missing.push("release gate staging check readiness");
  if (!releaseGate.includes("LOCAL_DATA_OS_VERIFY=passed")) {
    missing.push("release gate staging local verifier marker");
  }
  if (!releaseGate.includes("must not include a database URL")) missing.push("release gate staging check redaction guard");
  if (!releaseGate.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("release gate staging DB URL format proof");
  }
  if (!releaseGate.includes("database_format")) {
    missing.push("release gate database format output");
  }
  if (!releaseGate.includes("README.md must not include corpus or output UUID values")) {
    missing.push("release gate README UUID scan");
  }
  if (!releaseGate.includes("serving-smoke.json must redact corpus_id")) {
    missing.push("release gate serving smoke ID redaction gate");
  }
  if (!releaseGate.includes("serving-smoke.json must not include corpus or output UUID values")) {
    missing.push("release gate serving smoke UUID guard");
  }
  if (!releaseGate.includes("NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid")) {
    missing.push("release gate staging check UUID format gate");
  }
  if (!releaseGate.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true for release evidence")) {
    missing.push("release gate staging check review approval gate");
  }
  if (!releaseGate.includes("NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid")) {
    missing.push("release gate staging check review tag id UUID gate");
  }
  if (!releaseGate.includes("NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid")) {
    missing.push("release gate staging check review assertion id UUID gate");
  }
  if (!releaseGate.includes("validateNoDatabaseUrls")) missing.push("release gate evidence artifact database URL scan");
  if (!releaseGate.includes("SENSITIVE_ARTIFACT_PATTERNS")) missing.push("release gate sensitive artifact scan");
  if (!releaseGate.includes("evidence.md must not include corpus or output UUID values")) {
    missing.push("release gate evidence markdown UUID scan");
  }
  if (!releaseGate.includes("evidence.md must state identifiers are redacted for PR")) {
    missing.push("release gate evidence markdown redaction notice");
  }
  if (!releaseGate.includes("DATABASE_URL_ENVIRONMENT=remote_redacted")) {
    missing.push("release gate remote database environment gate");
  }
  if (!releaseGate.includes("evidence-pack-validation.json database_environment must be remote_redacted")) {
    missing.push("release gate validator remote database environment check");
  }
  if (!releaseGate.includes("RELEASE_TARGETS")) missing.push("release gate staging/preview targets");
  if (!releaseGate.includes("published Signal Pulse output")) missing.push("release gate published output guard");
  if (!releaseGate.includes("architecture_decision_confirmed")) missing.push("release gate architecture decision gate");
  if (!releaseGate.includes("architecture_decision must be an object")) {
    missing.push("release gate architecture decision object");
  }
  if (!releaseGate.includes("customer_intelligence_lakehouse_cdp_like")) {
    missing.push("release gate product category decision");
  }
  if (!releaseGate.includes("data_catalog_quality_and_lineage")) missing.push("release gate Data Catalog quality lineage gate");
  if (!releaseGate.includes("brand_os_and_knowledge_catalogs")) missing.push("release gate Brand OS Knowledge gate");
  if (!releaseGate.includes("brand_os_briefs")) missing.push("release gate Brand OS brief count");
  if (!releaseGate.includes("catalog_assets")) missing.push("release gate serving catalog count gate");
  if (!releaseGate.includes("catalog_failed_quality")) missing.push("release gate serving catalog quality gate");
  if (!releaseGate.includes("tagging_rule_set_governance")) missing.push("release gate tagging governance gate");
  if (!releaseGate.includes("tag_assertion_review_queue_ready")) missing.push("release gate review queue gate");
  if (!releaseGate.includes("human_review_sample_complete")) missing.push("release gate human review sample gate");
  if (!releaseGate.includes("review-queue.json")) missing.push("release gate review queue artifact");
  if (!releaseGate.includes("validateReviewQueue")) missing.push("release gate review queue artifact validator");
  if (!releaseGate.includes("contains_sensitive_review_ids")) {
    missing.push("release gate review queue ID redaction guard");
  }
  if (!releaseGate.includes("contains_private_review_context")) {
    missing.push("release gate review queue context redaction guard");
  }
  if (!releaseGate.includes("review-queue.json must not include corpus, tag or assertion UUID values")) {
    missing.push("release gate review queue UUID guard");
  }
  if (!releaseGate.includes("review-sample.json")) missing.push("release gate review sample artifact");
  if (!releaseGate.includes("validateReviewSample")) missing.push("release gate review sample validator");
  if (!releaseGate.includes("ready_for_release_review_sample")) {
    missing.push("release gate review sample readiness check");
  }
  if (!releaseGate.includes("review-sample.json must not include corpus, tag or assertion UUID values")) {
    missing.push("release gate review sample UUID guard");
  }
  if (!releaseGate.includes("evidence.json review_queue must be an object")) {
    missing.push("release gate review queue object");
  }
  if (!releaseGate.includes("record_tags_with_evidence")) missing.push("release gate record tags evidence count");
  if (!releaseGate.includes("tag_review_events")) missing.push("release gate tag review event count");
  if (!releaseGate.includes("knowledge_assertions_with_evidence")) {
    missing.push("release gate knowledge assertions evidence count");
  }
  if (!releaseGate.includes("knowledge_assertion_review_events")) {
    missing.push("release gate assertion review event count");
  }
  if (!releaseGate.includes("review_queue_ready_for_human_review")) {
    missing.push("release gate serving review queue readiness");
  }
  if (!releaseGate.includes("review_queue_tags_with_evidence")) {
    missing.push("release gate serving review queue tag evidence count");
  }
  if (!releaseGate.includes("review_queue_tag_review_events")) {
    missing.push("release gate serving review queue tag review event count");
  }
  if (!releaseGate.includes("review_queue_assertions_with_evidence")) {
    missing.push("release gate serving review queue assertion evidence count");
  }
  if (!releaseGate.includes("review_queue_assertion_review_events")) {
    missing.push("release gate serving review queue assertion review event count");
  }
  if (!releaseGate.includes("live_payload_parity")) missing.push("release gate live payload parity gate");
  if (!releaseGate.includes("serving-smoke.json live_payload_parity.live_behind_payload must be false")) {
    missing.push("release gate serving smoke live payload parity check");
  }
  if (!releaseGate.includes("safe_next_and_rollback_flags")) missing.push("release gate safe flag gate");
  if (!releaseGate.includes("live_render_flag_guarded")) missing.push("release gate live render flag gate");
  if (!releaseGate.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED")) {
    missing.push("release gate live render rollback guard");
  }
  if (!releaseGate.includes("disabled_api_payload_fallback")) missing.push("release gate disabled API fallback gate");
  if (!releaseGate.includes("visibility_checks")) missing.push("release gate visibility checks");
  if (!releaseGate.includes("client_source_health_hidden")) missing.push("release gate client source health visibility check");
  if (!releaseGate.includes("internal_dashboard_refs_preserved")) {
    missing.push("release gate internal dashboard refs visibility check");
  }
  if (!releaseGate.includes("post_backfill_analyze")) missing.push("release gate post-backfill analyze gate");
  if (!releaseGate.includes("brand_os_knowledge_links")) missing.push("release gate Brand OS Knowledge links gate");
  if (!releaseGate.includes("analyze.json")) missing.push("release gate analyze artifact input");
  if (!releaseGate.includes("NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED")) missing.push("release gate rollback live flag check");
  if (!releaseGate.includes("tagging_model_versions_with_rule_set")) {
    missing.push("release gate tagging model rule-set link gate");
  }
  if (!releaseGate.includes("evidence-pack-validation.json")) missing.push("release gate evidence pack validation input");
  if (!releaseGate.includes("ready_for_release_gate")) missing.push("release gate validator release-readiness check");
  if (!releaseGate.includes("evidence-pack-validation.json target")) missing.push("release gate validator target match");
  if (!releaseGate.includes("evidence_dir must match")) missing.push("release gate validator evidence dir match");
  if (!releaseGate.includes("checked_files")) missing.push("release gate validator checked files audit");
  if (!releaseGate.includes("Schema apply requested")) missing.push("release gate schema apply README gate");
  if (!releaseGate.includes("apply-schema.log")) missing.push("release gate schema apply artifact gate");
  if (!releaseGate.includes("validateArtifactManifest")) missing.push("release gate artifact manifest verifier");
  if (!releaseGate.includes("artifact_manifest_current")) missing.push("release gate artifact manifest gate");
  if (!releaseGate.includes("local_data_os_verify_precheck")) {
    missing.push("release gate local verifier precheck gate");
  }
  if (!releaseGate.includes("checksum changed after evidence-pack-validation.json was generated")) {
    missing.push("release gate artifact checksum drift guard");
  }
  if (!evidencePackValidator.includes("NOISIA_DATA_OS_EVIDENCE_PACK_DIR")) {
    missing.push("evidence pack validator env path");
  }
  if (!evidencePackValidator.includes("displayEvidenceDir")) {
    missing.push("evidence pack validator repo-relative evidence path output");
  }
  if (!evidencePackValidator.includes("DATABASE_URL_ENVIRONMENT=remote_redacted")) {
    missing.push("evidence pack validator remote database environment gate");
  }
  if (!evidencePackValidator.includes("database_environment")) {
    missing.push("evidence pack validator database environment output");
  }
  if (!evidencePackValidator.includes("buildArtifactManifest")) {
    missing.push("evidence pack validator artifact manifest builder");
  }
  if (!evidencePackValidator.includes("artifact_manifest_algorithm")) {
    missing.push("evidence pack validator artifact manifest output");
  }
  if (!evidencePackValidator.includes("staging-check.txt")) {
    missing.push("evidence pack validator staging check artifact");
  }
  if (!evidencePackValidator.includes("staging-check.txt target")) {
    missing.push("evidence pack validator staging check target match");
  }
  if (!evidencePackValidator.includes("ready_for_release_gate")) {
    missing.push("evidence pack validator release gate readiness output");
  }
  if (!evidencePackValidator.includes("ready_for_staging_shadow=true")) {
    missing.push("evidence pack validator staging check readiness");
  }
  if (!evidencePackValidator.includes("LOCAL_DATA_OS_VERIFY=passed")) {
    missing.push("evidence pack validator staging local verifier marker");
  }
  if (!evidencePackValidator.includes("must not include a database URL")) {
    missing.push("evidence pack validator staging check redaction guard");
  }
  if (!evidencePackValidator.includes("DATABASE_URL_FORMAT=postgres_url")) {
    missing.push("evidence pack validator staging DB URL format proof");
  }
  if (!evidencePackValidator.includes("database_format")) {
    missing.push("evidence pack validator database format output");
  }
  if (!evidencePackValidator.includes("NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid")) {
    missing.push("evidence pack validator staging check UUID format gate");
  }
  if (!evidencePackValidator.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true for release evidence")) {
    missing.push("evidence pack validator staging check review approval gate");
  }
  if (!evidencePackValidator.includes("NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid")) {
    missing.push("evidence pack validator staging check review tag id UUID gate");
  }
  if (!evidencePackValidator.includes("NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid")) {
    missing.push("evidence pack validator staging check review assertion id UUID gate");
  }
  if (!evidencePackValidator.includes("Schema apply requested")) {
    missing.push("evidence pack validator schema apply README gate");
  }
  if (!evidencePackValidator.includes("apply-schema.log")) {
    missing.push("evidence pack validator schema apply artifact gate");
  }
  if (!evidencePackValidator.includes("validateNoDatabaseUrls")) {
    missing.push("evidence pack validator artifact database URL scan");
  }
  if (!evidencePackValidator.includes("SENSITIVE_ARTIFACT_PATTERNS")) {
    missing.push("evidence pack validator sensitive artifact scan");
  }
  if (!evidencePackValidator.includes("README.md must not include corpus or output UUID values")) {
    missing.push("evidence pack validator README UUID scan");
  }
  if (!evidencePackValidator.includes("serving-smoke.json must redact corpus_id")) {
    missing.push("evidence pack validator serving smoke ID redaction gate");
  }
  if (!evidencePackValidator.includes("serving-smoke.json must not include corpus or output UUID values")) {
    missing.push("evidence pack validator serving smoke UUID guard");
  }
  for (const artifact of [
    "signal-v2-backfill.json",
    "signal-v2-reconcile.json",
    "signal-v2-explain.json",
    "signal-v2-shadow.json",
    "backend-ready-signal-v2.json"
  ]) {
    if (!evidencePackValidator.includes(artifact)) {
      missing.push(`evidence pack validator ${artifact} gate`);
    }
  }
  if (!evidencePackValidator.includes("validateSignalV2Artifacts")) {
    missing.push("evidence pack validator Signal V2 runtime validator");
  }
  if (!evidencePackValidator.includes("evidence.md must not include corpus or output UUID values")) {
    missing.push("evidence pack validator markdown UUID scan");
  }
  if (!evidencePackValidator.includes("evidence.md must state identifiers are redacted for PR")) {
    missing.push("evidence pack validator markdown redaction notice");
  }
  if (!evidencePackValidator.includes("evidence.md must include the Data OS architecture decision")) {
    missing.push("evidence pack validator markdown architecture decision");
  }
  if (!evidencePackValidator.includes("evidence.json architecture_decision must be an object")) {
    missing.push("evidence pack validator architecture decision object");
  }
  if (!evidencePackValidator.includes("evidence.md must include the Data OS review queue")) {
    missing.push("evidence pack validator markdown review queue");
  }
  if (!evidencePackValidator.includes("evidence.json review_queue must be an object")) {
    missing.push("evidence pack validator review queue object");
  }
  if (!evidencePackValidator.includes("review-queue.json")) {
    missing.push("evidence pack validator review queue artifact");
  }
  if (!evidencePackValidator.includes("validateReviewQueue")) {
    missing.push("evidence pack validator review queue artifact validator");
  }
  if (!evidencePackValidator.includes("contains_sensitive_review_ids")) {
    missing.push("evidence pack validator review queue ID redaction guard");
  }
  if (!evidencePackValidator.includes("contains_private_review_context")) {
    missing.push("evidence pack validator review queue context redaction guard");
  }
  if (!evidencePackValidator.includes("review-queue.json must not include corpus, tag or assertion UUID values")) {
    missing.push("evidence pack validator review queue UUID guard");
  }
  if (!evidencePackValidator.includes("review-sample.json")) {
    missing.push("evidence pack validator review sample artifact");
  }
  if (!evidencePackValidator.includes("validateReviewSample")) {
    missing.push("evidence pack validator review sample validator");
  }
  if (!evidencePackValidator.includes("ready_for_release_review_sample")) {
    missing.push("evidence pack validator review sample readiness check");
  }
  if (!evidencePackValidator.includes("review-sample.json must not include corpus, tag or assertion UUID values")) {
    missing.push("evidence pack validator review sample UUID guard");
  }
  if (!evidencePackValidator.includes("customer_intelligence_lakehouse_cdp_like")) {
    missing.push("evidence pack validator product category decision");
  }
  if (!evidencePackValidator.includes("ready_for_pr_review")) missing.push("evidence pack validator PR readiness gate");
  if (!evidencePackValidator.includes("ready_for_serving_shadow")) {
    missing.push("evidence pack validator serving smoke gate");
  }
  if (!evidencePackValidator.includes("ready_for_live_api_shadow")) {
    missing.push("evidence pack validator shadow-run gate");
  }
  if (!evidencePackValidator.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED")) {
    missing.push("evidence pack validator live render flag guard");
  }
  if (!evidencePackValidator.includes("analyze.json")) {
    missing.push("evidence pack validator analyze artifact gate");
  }
  if (!evidencePackValidator.includes("ready_for_serving_reads")) {
    missing.push("evidence pack validator analyze readiness gate");
  }
  if (!evidencePackValidator.includes("fallback_checks")) {
    missing.push("evidence pack validator disabled API fallback checks");
  }
  if (!evidencePackValidator.includes("live_payload_parity")) {
    missing.push("evidence pack validator live payload parity checks");
  }
  if (!evidencePackValidator.includes("serving-smoke.json live_payload_parity.live_behind_payload must be false")) {
    missing.push("evidence pack validator serving smoke live payload parity check");
  }
  if (!evidencePackValidator.includes("visibility_checks")) {
    missing.push("evidence pack validator visibility checks");
  }
  if (!evidencePackValidator.includes("client_source_health_hidden")) {
    missing.push("evidence pack validator client source health visibility check");
  }
  if (!evidencePackValidator.includes("internal_dashboard_refs_preserved")) {
    missing.push("evidence pack validator internal dashboard refs visibility check");
  }
  if (!evidencePackValidator.includes("review_queue_ready_for_human_review")) {
    missing.push("evidence pack validator serving review queue readiness");
  }
  if (!evidencePackValidator.includes("review_queue_tags_with_evidence")) {
    missing.push("evidence pack validator serving review queue tag evidence count");
  }
  if (!evidencePackValidator.includes("review_queue_tag_review_events")) {
    missing.push("evidence pack validator serving review queue tag review event count");
  }
  if (!evidencePackValidator.includes("review_queue_assertions_with_evidence")) {
    missing.push("evidence pack validator serving review queue assertion evidence count");
  }
  if (!evidencePackValidator.includes("review_queue_assertion_review_events")) {
    missing.push("evidence pack validator serving review queue assertion review event count");
  }
  if (!evidencePackValidator.includes("catalog_assets")) {
    missing.push("evidence pack validator serving catalog assets gate");
  }
  if (!evidencePackValidator.includes("catalog_fields")) {
    missing.push("evidence pack validator serving catalog fields gate");
  }
  if (!evidencePackValidator.includes("catalog_failed_quality")) {
    missing.push("evidence pack validator serving catalog quality gate");
  }
  if (!evidencePackValidator.includes("NOISIA_DATA_OS_SHADOW_MODE")) {
    missing.push("evidence pack validator safe shadow flag gate");
  }
  if (!evidencePackValidator.includes("dashboard_refs_with_source_id")) {
    missing.push("evidence pack validator dashboard refs source gate");
  }
  if (!evidencePackValidator.includes("brand_os_briefs")) {
    missing.push("evidence pack validator Brand OS brief count");
  }
  if (!evidencePackValidator.includes("brand_os_links")) {
    missing.push("evidence pack validator Brand OS link count");
  }
  if (!evidencePackValidator.includes("knowledge_assertion_links")) {
    missing.push("evidence pack validator Knowledge assertion link count");
  }
  if (!evidencePackValidator.includes("knowledge_usage_events")) {
    missing.push("evidence pack validator Knowledge usage count");
  }
  if (!shadowQa.includes("brand_os_briefs")) missing.push("shadow QA Brand OS brief count");
  if (!shadowQa.includes("brand_os_links")) missing.push("shadow QA Brand OS link count");
  if (!shadowQa.includes("knowledge_assertion_links")) missing.push("shadow QA Knowledge assertion link count");
  if (!shadowQa.includes("knowledge_usage_events")) missing.push("shadow QA Knowledge usage count");
  if (!smoke.includes("brand_os_briefs")) missing.push("smoke Brand OS brief count");
  if (!smoke.includes("brand_os_links")) missing.push("smoke Brand OS link count");
  if (!smoke.includes("knowledge_assertion_links")) missing.push("smoke Knowledge assertion link count");
  if (!smoke.includes("knowledge_usage_events")) missing.push("smoke Knowledge usage count");
  if (!smoke.includes("record_tags_demographic")) missing.push("smoke demographic tag count");
  if (!backfill.includes("demographic")) missing.push("backfill demographic taxonomy/rules");
  if (!backfill.includes("tags_by_taxonomy")) missing.push("backfill taxonomy-grouped feature values");
  if (!servingSmoke.includes("NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE")) missing.push("serving smoke remote guard");
  if (!servingSmoke.includes("ready_for_serving_shadow")) missing.push("serving smoke readiness output");
  if (!servingSmoke.includes('corpus_id: "set_redacted"')) missing.push("serving smoke redacted corpus ID output");
  if (!servingSmoke.includes('output_id: "set_redacted"')) missing.push("serving smoke redacted output ID output");
  if (!servingSmoke.includes("contains_sensitive_ids: false")) missing.push("serving smoke sensitive ID flag");
  if (!servingSmoke.includes("getDataOsBrandOs")) missing.push("serving smoke Brand OS check");
  if (!servingSmoke.includes("getDataOsCatalog")) missing.push("serving smoke Data Catalog check");
  if (!servingSmoke.includes("getDataOsKnowledge")) missing.push("serving smoke Knowledge Catalog check");
  if (!servingSmoke.includes("getDataOsReviewQueue")) missing.push("serving smoke review queue check");
  if (!servingSmoke.includes("listDataOsLineage")) missing.push("serving smoke lineage check");
  if (!servingSmoke.includes("disabledDataOsResponse")) missing.push("serving smoke Data OS disabled fallback check");
  if (!servingSmoke.includes("loadPublishedPayloadCounts")) missing.push("serving smoke published payload count read");
  if (!servingSmoke.includes("live_payload_parity")) missing.push("serving smoke live payload parity output");
  if (!servingSmoke.includes("Signal Pulse live DB is behind published payload")) {
    missing.push("serving smoke live payload behind failure");
  }
  if (!servingSmoke.includes("disabledSignalPulseLiveResponse")) {
    missing.push("serving smoke Signal Pulse disabled fallback check");
  }
  if (!servingSmoke.includes("fallback_checks")) missing.push("serving smoke fallback checks output");
  if (!servingSmoke.includes("visibility_checks")) missing.push("serving smoke visibility checks output");
  if (!servingSmoke.includes("applyPulseLiveVisibility")) missing.push("serving smoke visibility sanitizer");
  if (!servingSmoke.includes("client_source_health_hidden")) {
    missing.push("serving smoke client source health visibility check");
  }
  if (!servingSmoke.includes("internal_dashboard_refs_preserved")) {
    missing.push("serving smoke internal dashboard refs visibility check");
  }
  if (!servingSmoke.includes("brand_os_profiles")) missing.push("serving smoke Brand OS counts");
  if (!servingSmoke.includes("brand_os_briefs")) missing.push("serving smoke Brand OS brief count");
  if (!servingSmoke.includes("brand_os_links")) missing.push("serving smoke Brand OS Knowledge link counts");
  if (!servingSmoke.includes("catalog_assets")) missing.push("serving smoke Data Catalog counts");
  if (!servingSmoke.includes("knowledge_assertions")) missing.push("serving smoke Knowledge assertion counts");
  if (!servingSmoke.includes("knowledge_assertion_links")) {
    missing.push("serving smoke Knowledge assertion link counts");
  }
  if (!servingSmoke.includes("knowledge_usage_events")) missing.push("serving smoke Knowledge usage counts");
  if (!servingSmoke.includes("review_queue_ready_for_human_review")) {
    missing.push("serving smoke review queue readiness count");
  }
  if (!servingSmoke.includes("review_queue_required_before_client_visible")) {
    missing.push("serving smoke review queue client-visible requirement");
  }
  if (!servingSmoke.includes("review_queue_tags_with_evidence")) {
    missing.push("serving smoke review queue tag evidence count");
  }
  if (!servingSmoke.includes("review_queue_tag_review_events")) {
    missing.push("serving smoke review queue tag review event count");
  }
  if (!servingSmoke.includes("review_queue_assertions_with_evidence")) {
    missing.push("serving smoke review queue assertion evidence count");
  }
  if (!servingSmoke.includes("review_queue_assertion_review_events")) {
    missing.push("serving smoke review queue assertion review event count");
  }
  if (!servingSmoke.includes("lineage_edges")) missing.push("serving smoke lineage counts");
  if (!servingSmoke.includes("source_health_assets_without_fields")) missing.push("serving smoke field coverage gate");
  if (!servingSmoke.includes("getPulseLiveData")) missing.push("serving smoke pulse live check");
  if (!servingSmoke.includes("listPulseLiveCorpus")) missing.push("serving smoke corpus check");
  if (!pulsePage.includes("PulseDataOsShadowBadge")) missing.push("Pulse page Data OS shadow badge");
  if (!pulsePage.includes("PulseDataOsOperationsPanel")) missing.push("Pulse page Data OS operations panel");
  if (!pulsePage.includes("getPulseLiveData")) missing.push("Pulse page live Data OS read");
  if (!pulsePage.includes("getDataOsReviewQueue")) missing.push("Pulse page Data OS review queue read");
  if (!pulsePage.includes("payloadCounts")) missing.push("Pulse page payload parity counts");
  if (!pulsePage.includes("buildPulseDataOsDrift")) missing.push("Pulse page live-vs-payload drift guard");
  if (!pulsePage.includes("liveBehindPayload")) missing.push("Pulse page live-behind-payload warning");
  if (!pulsePage.includes("Payload parity")) missing.push("Pulse page payload parity readiness metric");
  if (!pulsePage.includes("resolvePulseRenderData")) missing.push("Pulse page live render source resolver");
  if (!pulsePage.includes("buildPulseLiveRenderData")) missing.push("Pulse page live render adapter");
  if (!pulsePage.includes("data_os_live_shadow")) missing.push("Pulse page live render mode");
  if (!pulsePage.includes("payload_fallback")) missing.push("Pulse page payload fallback render mode");
  if (!pulsePage.includes("payloadLinkedSignals")) missing.push("Pulse page payload-linked evidence fallback");
  if (!pulsePage.includes("isSignalPulseLiveRenderEnabled")) missing.push("Pulse page live render flag helper");
  if (!pulsePage.includes("tagReviewEvents")) missing.push("Pulse page tag review event status");
  if (!pulsePage.includes("knowledgeAssertionReviewEvents")) {
    missing.push("Pulse page assertion review event status");
  }
  if (!pulsePage.includes("isDataOsServingEnabled")) missing.push("Pulse page Data OS serving flag");
  if (!loader.includes("canManageCorpus")) missing.push("Data OS authZ guard");
  if (!loader.includes("canViewClientOutputs")) missing.push("Pulse live output read authZ guard");
  if (!loader.includes("getAuthenticatedAppUser")) missing.push("Data OS authenticated user guard");
  if (!loader.includes("getCorpusForUser")) missing.push("Data OS corpus ownership guard");
  if (!loader.includes("getSignalOutputForUser")) missing.push("Data OS Pulse output ownership guard");
  if (!loader.includes("isDataOsServingEnabled")) missing.push("Data OS serving feature flag guard");
  if (!loader.includes("isSignalPulseLiveApiEnabled")) missing.push("Signal Pulse live feature flag guard");
  if (!loader.includes("disabledDataOsResponse")) missing.push("Data OS disabled fallback response");
  if (!loader.includes("disabledSignalPulseLiveResponse")) missing.push("Signal Pulse live disabled fallback response");
  if (!loader.includes("resolveSignalPulseVisibility")) missing.push("Pulse live visibility resolver");
  if (!loader.includes("requiredVisibility")) missing.push("Pulse live required visibility guard");
  if (!loader.includes("disabledSignalPulseLiveResponse")) missing.push("Signal Pulse live kill switch");
  if (!loader.includes("isSignalPulseOutput")) missing.push("Signal Pulse output guard");
  if (!reviewQueueRoute.includes("export async function POST")) missing.push("Data OS review queue POST handler");
  if (!reviewQueueRoute.includes("reviewDataOsTag")) {
    missing.push("Data OS review queue writes tag review events through serving layer");
  }
  if (!reviewQueueRoute.includes("reviewDataOsAssertion")) {
    missing.push("Data OS review queue writes assertion review events through serving layer");
  }
  if (!reviewQueueRoute.includes("validationError")) missing.push("Data OS review queue POST validation");
  for (const { route, contents } of dataOsRouteContents) {
    if (!contents.includes("export async function GET")) missing.push(`Data OS route GET handler: ${route}`);
    if (contents.includes("pool.query") || contents.includes("@/lib/db")) {
      missing.push(`Data OS route bypasses serving layer: ${route}`);
    }
    if (contents.includes("getAuthenticatedAppUser") || contents.includes("canManageCorpus") || contents.includes("canViewClientOutputs")) {
      missing.push(`Data OS route bypasses shared auth loader: ${route}`);
    }
    if (route.includes("/corpora/") && !contents.includes("loadDataOsCorpusContext")) {
      missing.push(`Data OS corpus route missing corpus loader: ${route}`);
    }
    if (route.includes("/pulse/") && !contents.includes("loadDataOsPulseContext")) {
      missing.push(`Data OS Pulse route missing Pulse loader: ${route}`);
    }
  }
  if (!pulseLiveRoute.includes("visibility: loaded.visibility")) missing.push("Pulse live route applies visibility");
  if (!pulseCorpusRoute.includes('requiredVisibility: "showCorpus"')) {
    missing.push("Pulse live corpus route requires corpus visibility");
  }
  if (!serving.includes("published_outputs.payload")) missing.push("serving fallback response");
  if (!serving.includes("applyPulseLiveVisibility")) missing.push("serving Pulse live visibility sanitizer");
  if (!serving.includes("hiddenLiveSection")) missing.push("serving Pulse live hidden section fallback");
  if (!serving.includes("dashboard_data_refs.filter(isClientVisibleDashboardRef)")) {
    missing.push("serving Pulse internal dashboard refs filter");
  }
  if (!serving.includes("brand_os_briefs")) missing.push("serving Brand OS brief endpoint data");
  if (!serving.includes("knowledge_assertion_links")) missing.push("serving Knowledge assertion link counts");
  if (!serving.includes("knowledge_usage_events")) missing.push("serving Knowledge usage counts");
  if (!apiContracts.includes("\"briefs\"")) missing.push("API contracts Brand OS briefs");
  if (!apiContracts.includes("\"briefs\": 1")) missing.push("API contracts Brand OS brief count");
  if (!serving.includes("getDataOsReviewQueue")) missing.push("serving review queue API");
  if (!serving.includes("ready_for_human_review")) missing.push("serving review queue readiness");
  if (!serving.includes("reviewDataOsTag")) missing.push("serving review queue mutation");
  if (!serving.includes("reviewDataOsAssertion")) missing.push("serving assertion review queue mutation");
  if (!serving.includes("tag_review_events")) missing.push("serving tag review audit trail");
  if (!serving.includes("knowledge_assertion_review_events")) missing.push("serving assertion review audit trail");
  if (!serving.includes("TAG_REVIEW_STATUS_BY_ACTION")) missing.push("serving review action status map");
  if (!serving.includes("ASSERTION_STATUS_BY_ACTION")) missing.push("serving assertion action status map");
  if (!serving.includes("optionalSearchParam")) missing.push("serving optional filter normalization");
  if (!serving.includes("demographic: optionalSearchParam")) missing.push("serving demographic filter normalization");
  if (!serving.includes("tx.taxonomy_key = 'demographic'")) missing.push("serving demographic corpus filter");
  if (!serving.includes("NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED")) missing.push("serving Signal Pulse flag");
  if (!serving.includes("NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED")) missing.push("serving Signal Pulse render flag");
  if (!serving.includes("isSignalPulseLiveRenderEnabled")) missing.push("serving Signal Pulse render flag helper");
  if (!serving.includes("period_id::text")) missing.push("serving metrics period filter avoids unsafe UUID casts");
  if (!serving.includes("canonical_signal_id::text")) missing.push("serving metrics signal filter avoids unsafe UUID casts");
  if (!studioDataOsQueue.includes("enqueueDataOsShadowRun")) missing.push("Studio Data OS queue enqueue helper");
  if (!studioDataOsQueue.includes("DATA_OS_SHADOW_RUN_JOB_NAME")) missing.push("Studio Data OS queue job contract");
  if (!studioDataOsQueue.includes("NOISIA_DATA_OS_QUEUE_NAME")) missing.push("Studio Data OS queue override");
  if (!studioDataOsQueueTest.includes("buildDataOsShadowRunJobOptions")) missing.push("Studio Data OS queue tests");
  if (!dataOsContract.includes("DATA_OS_QUEUE_NAME")) missing.push("Data OS queue name contract");
  if (!dataOsContract.includes("DATA_OS_SHADOW_RUN_JOB_NAME")) missing.push("Data OS job name contract");
  if (!dataOsContract.includes("DATA_OS_ALLOWED_REMOTE_TARGETS")) missing.push("Data OS allowed remote target contract");
  if (!dataOsContract.includes("isDataOsRemoteTargetAllowed")) missing.push("Data OS remote target helper");
  if (!dataOsContract.includes("NOISIA_DATA_OS_WORKER_RUNS_ENABLED")) missing.push("Data OS shared worker run flag");
  if (!dataOsContractTest.includes("flags default closed")) missing.push("Data OS shared worker flag tests");
  if (!dataOsContractTest.includes("NOISIA_REMOTE_DATABASE_TARGET: \"production\"")) {
    missing.push("Data OS shared worker rejects production target test");
  }
  if (!workerIndex.includes("startDataOsWorker")) missing.push("workers index Data OS worker registration");
  if (!workerIndex.includes("isDataOsWorkerEnabled")) missing.push("workers index Data OS start flag");
  if (!workerIndex.includes("data-os")) missing.push("workers index Data OS runtime label");
  if (!dataOsQueue.includes("DATA_OS_QUEUE_NAME")) missing.push("Data OS worker queue contract");
  if (!dataOsQueue.includes("DATA_OS_SHADOW_RUN_JOB_NAME")) missing.push("Data OS worker job routing");
  if (!dataOsWorker.includes("NOISIA_DATA_OS_WORKER_RUNS_ENABLED")) missing.push("Data OS worker execution gate");
  if (!dataOsWorker.includes("isDataOsWorkerRemoteApproved")) missing.push("Data OS worker remote approval gate");
  if (!dataOsWorker.includes("data-os:shadow-run")) missing.push("Data OS worker shadow-run step");
  if (!dataOsWorker.includes("data-os:analyze")) missing.push("Data OS worker analyze step");
  if (!dataOsWorker.includes("NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE")) {
    missing.push("Data OS worker analyze remote guard");
  }
  if (!dataOsWorker.includes("data-os:serving-smoke")) missing.push("Data OS worker serving-smoke step");
  if (!dataOsWorker.includes("data-os:review-queue")) missing.push("Data OS worker review queue step");
  if (!dataOsWorker.includes("NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE")) {
    missing.push("Data OS worker review queue remote guard");
  }
  if (!dataOsWorker.includes('NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS: "false"')) {
    missing.push("Data OS worker review queue ID redaction override");
  }
  if (!dataOsWorker.includes('NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT: "false"')) {
    missing.push("Data OS worker review queue context redaction override");
  }
  if (!dataOsWorker.includes("data-os:evidence")) missing.push("Data OS worker evidence step");
  if (!dataOsWorkerTest.includes("fail closed without the execution gate")) missing.push("Data OS worker fail-closed behavior test");
  if (!dataOsWorkerTest.includes("remote approval adds only the reviewed remote overrides")) {
    missing.push("Data OS worker remote override behavior test");
  }
  if (!dataOsWorkerTest.includes("focused serving smoke debugging")) {
    missing.push("Data OS worker review queue opt-out test");
  }
  if (!dataOsWorkerTest.includes("unscopedRemote.NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE")) {
    missing.push("Data OS worker unscoped remote approval test");
  }
  if (!spec.includes("GET /api/data-os/corpora/:id/brand-os")) missing.push("spec Brand OS endpoint");
  if (!spec.includes("GET /api/data-os/corpora/:id/catalog")) missing.push("spec Data Catalog endpoint");
  if (!spec.includes("GET /api/data-os/corpora/:id/knowledge")) missing.push("spec Knowledge endpoint");
  if (!spec.includes("GET /api/data-os/corpora/:id/lineage")) missing.push("spec lineage endpoint");

  assertEmpty("Missing Data OS implementation contracts", missing);
}

async function verifyDatabaseIfRequested() {
  if (process.env.NOISIA_DATA_OS_VERIFY_DB !== "true") {
    return { skipped: true };
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is required when NOISIA_DATA_OS_VERIFY_DB=true.");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "data-os:verify",
    allowRemoteEnv: "NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    const tables = await client.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [REQUIRED_TABLES]
    );
    const found = new Set(tables.rows.map((row) => row.table_name));
    assertEmpty(
      "Missing Data OS tables in DB",
      REQUIRED_TABLES.filter((table) => !found.has(table))
    );

    const corpusId = process.env.NOISIA_DATA_OS_VERIFY_CORPUS_ID?.trim();
    if (!corpusId) {
      return { skipped: false, tables: REQUIRED_TABLES.length, corpus: "not_checked" };
    }

    const counts = await client.query<{ key: string; count: string }>(
      `
        SELECT 'data_assets' AS key, count(*)::text AS count FROM data_assets WHERE study_corpus_id = $1
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
        WHERE le.target_type = 'data_asset'
          AND da.study_corpus_id = $1
        UNION ALL
        SELECT 'taxonomies', count(*)::text FROM taxonomies WHERE status = 'active'
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
        SELECT 'brand_os_links', count(*)::text
        FROM brand_os_links bol
        JOIN brand_os_profiles bop ON bop.id = bol.brand_os_profile_id
        JOIN study_corpora sc ON sc.id = $1
        WHERE (sc.brand_id IS NOT NULL AND bop.brand_id = sc.brand_id)
           OR (sc.theme_id IS NOT NULL AND bop.theme_id = sc.theme_id)
        UNION ALL
        SELECT 'brand_os_briefs', count(*)::text
        FROM brand_os_briefs bob
        JOIN brand_os_profiles bop ON bop.id = bob.brand_os_profile_id
        JOIN study_corpora sc ON sc.id = $1
        WHERE bob.study_corpus_id = sc.id
          AND (
            (sc.brand_id IS NOT NULL AND bop.brand_id = sc.brand_id)
            OR (sc.theme_id IS NOT NULL AND bop.theme_id = sc.theme_id)
          )
        UNION ALL
        SELECT 'knowledge_assertion_links', count(*)::text
        FROM knowledge_assertion_links kal
        JOIN knowledge_assertions ka ON ka.id = kal.knowledge_assertion_id
        JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
        JOIN study_corpora sc ON sc.id = $1
        WHERE bks.study_corpus_id = sc.id
           OR (sc.brand_id IS NOT NULL AND bks.brand_id = sc.brand_id AND bks.study_corpus_id IS NULL)
        UNION ALL
        SELECT 'knowledge_usage_events', count(*)::text
        FROM knowledge_usage_events
        WHERE metadata->>'corpus_id' = ($1::uuid)::text
      `,
      [corpusId]
    );
    const byKey = Object.fromEntries(counts.rows.map((row) => [row.key, Number(row.count)]));
    const missingBackfill = Object.entries(byKey)
      .filter(([, count]) => count <= 0)
      .map(([key]) => key);
    assertEmpty("Missing Data OS backfill counts", missingBackfill);

    return { skipped: false, tables: REQUIRED_TABLES.length, corpus: corpusId, counts: byKey };
  } finally {
    await client.end();
  }
}

async function main() {
  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = dirname(dirname(dbRoot));

  await verifyMigrations(dbRoot);
  await verifyRoutes(repoRoot);
  await verifyRootScripts(repoRoot);
  await verifyStudioScripts(repoRoot);
  await verifyWorkerScripts(repoRoot);
  await verifySafeEnv(repoRoot);
  await verifyScripts(dbRoot);
  await verifyImplementationContracts(repoRoot);
  const branch_lineage = await verifyBranchLineage(repoRoot);
  const database = await verifyDatabaseIfRequested();

  console.log(JSON.stringify({
    ok: true,
    checked: {
      migrations: REQUIRED_MIGRATIONS.length,
      routes: REQUIRED_ROUTES.length,
      tables: REQUIRED_TABLES.length,
      root_scripts: Object.keys(REQUIRED_ROOT_SCRIPTS).length,
      studio_scripts: 3,
      worker_scripts: 1,
      contracts: REQUIRED_CONTRACT_FILES.length,
      safe_defaults: SAFE_DEFAULTS.length,
      branch_lineage,
      database
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
