import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const REQUIRED_FILES = [
  "README.md",
  "migrations.log",
  "smoke.log",
  "shadow-run.log",
  "analyze.json",
  "review-queue.json",
  "review-sample.json",
  "evidence.json",
  "serving-smoke.json"
];
const SENSITIVE_ARTIFACT_PATTERNS = [
  { label: "a database URL", pattern: /postgres(?:ql)?:\/\//i },
  { label: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { label: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: "GitHub token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}/ },
  {
    label: "secret environment value",
    pattern:
      /\b(?:OPENAI|ANTHROPIC|VOYAGE|KINDE|SUPABASE|UPSTASH|REDIS|JWT|COOKIE|SESSION)_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|URL)\s*=\s*(?!set\b|missing\b|unset\b|false\b|true\b|redacted\b|<)[^\s"'`]+/i
  }
];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boolValue(record: JsonRecord, key: string) {
  return record[key] === true;
}

function numberValue(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function arrayValue(record: JsonRecord, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function assertMin(counts: JsonRecord, key: string, minimum: number) {
  const actual = numberValue(counts, key);
  if (actual < minimum) fail(`${key} expected >= ${minimum}, found ${actual}.`);
}

function assertEqual(counts: JsonRecord, key: string, expected: number) {
  const actual = numberValue(counts, key);
  if (actual !== expected) fail(`${key} expected ${expected}, found ${actual}.`);
}

function assertTrue(record: JsonRecord, key: string) {
  if (record[key] !== true) fail(`${key} must be true.`);
}

function assertFlag(record: JsonRecord, key: string, expected: string) {
  if (record[key] !== expected) fail(`${key} expected ${expected}, found ${String(record[key] ?? "missing")}.`);
}

function assertEmpty(label: string, value: unknown) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > 0) fail(`${label} must be empty: ${JSON.stringify(items)}`);
}

async function latestEvidenceDir(repoRoot: string) {
  const evidenceRoot = join(repoRoot, ".data", "data-os-local-smoke");
  const entries = await readdir(evidenceRoot, { withFileTypes: true }).catch(() => []);
  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const fullPath = join(evidenceRoot, entry.name);
        const info = await stat(fullPath);
        return { fullPath, mtimeMs: info.mtimeMs };
      })
  );
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs[0]?.fullPath;
}

async function resolveEvidenceDir() {
  const repoRoot = resolve(process.cwd(), "../..");
  const explicit = process.argv[2] ?? process.env.NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR;
  if (explicit) return resolve(repoRoot, explicit);

  const latest = await latestEvidenceDir(repoRoot);
  if (latest) return latest;

  fail("Set NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR or pass a local smoke evidence directory path.");
}

function displayEvidenceDir(repoRoot: string, evidenceDir: string) {
  const relativePath = relative(repoRoot, evidenceDir);
  if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return relativePath;
  }
  return evidenceDir;
}

function parseCapturedJsonObjects(contents: string, fileName: string) {
  const objects: JsonRecord[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = contents.slice(start, index + 1);
        try {
          const parsed = JSON.parse(candidate) as unknown;
          if (isRecord(parsed)) objects.push(parsed);
        } catch {
          // Captured pnpm output can contain non-JSON braces; ignore those spans.
        }
        start = -1;
      }
    }
  }

  if (objects.length === 0) fail(`${fileName} must contain a JSON object.`);
  return objects;
}

function parseLastJsonObject(contents: string, fileName: string) {
  const objects = parseCapturedJsonObjects(contents, fileName);
  const last = objects.at(-1);
  if (!last) fail(`${fileName} must contain a JSON object.`);
  return last;
}

async function readCapturedJson(evidenceDir: string, fileName: string) {
  return parseLastJsonObject(await readFile(join(evidenceDir, fileName), "utf8"), fileName);
}

async function validateNoDatabaseUrls(evidenceDir: string) {
  for (const file of REQUIRED_FILES) {
    const contents = await readFile(join(evidenceDir, file), "utf8");
    for (const sensitive of SENSITIVE_ARTIFACT_PATTERNS) {
      if (sensitive.pattern.test(contents)) {
        fail(`${file} must not include ${sensitive.label}.`);
      }
    }
  }
}

function validateReadme(readme: string) {
  if (!readme.includes("Target: local disposable Postgres")) {
    fail("README.md must identify the target as local disposable Postgres.");
  }
  if (!readme.includes("does not replace the staging/preview evidence pack")) {
    fail("README.md must state local smoke does not replace staging/preview evidence.");
  }
  if (!readme.includes("must not be committed")) {
    fail("README.md must warn that local evidence must not be committed.");
  }
  if (UUID_PATTERN.test(readme)) {
    fail("README.md must not include corpus or output UUID values.");
  }
}

function validateMigrations(report: JsonRecord) {
  if (!boolValue(report, "ok")) fail("migrations.log ok must be true.");
  assertMin(report, "migrationsApplied", 36);
  assertMin(report, "requiredTables", 38);
  assertMin(report, "requiredIndexes", 26);
}

function validateSmokeLog(contents: string) {
  const objects = parseCapturedJsonObjects(contents, "smoke.log");
  const readiness = objects.find(
    (record) => boolValue(record, "ready_for_backfill") && boolValue(record, "ready_for_shadow_qa")
  );
  if (!readiness) fail("smoke.log missing ready_for_backfill and ready_for_shadow_qa.");

  const summary = objects.find((record) => isRecord(record.counts));
  if (!summary || !isRecord(summary.counts)) fail("smoke.log missing final counts summary.");
  const counts = summary.counts;
  assertMin(counts, "data_assets", 10);
  assertMin(counts, "data_asset_fields", 50);
  assertEqual(counts, "data_assets_without_fields", 0);
  assertMin(counts, "data_contracts", 10);
  assertMin(counts, "data_quality_results", 10);
  assertMin(counts, "brand_os_briefs", 1);
  assertMin(counts, "brand_os_links", 3);
  assertMin(counts, "knowledge_assertion_links", 3);
  assertMin(counts, "knowledge_usage_events", 3);
  assertMin(counts, "record_tags_trigger", 1);
  assertMin(counts, "record_tags_barrier", 1);
  assertMin(counts, "record_tags_journey_stage", 1);
  assertMin(counts, "record_tags_value_perception", 1);
  assertMin(counts, "record_tags_audience", 1);
  assertMin(counts, "record_tags_demographic", 1);
  assertMin(counts, "record_feature_values", 1);
  assertMin(counts, "tagging_rule_sets", 1);
  assertMin(counts, "tagging_model_versions_with_rule_set", 1);
  assertMin(counts, "lineage_data_source_to_asset", 1);
  assertMin(counts, "lineage_import_batch_to_asset", 1);
  assertMin(counts, "lineage_knowledge_source_to_asset", 1);
  assertMin(counts, "lineage_asset_to_dashboard_ref", 1);
  assertMin(counts, "lineage_dashboard_ref_to_output", 1);
  if (numberValue(counts, "dashboard_data_refs_with_source_id") !== numberValue(counts, "dashboard_data_refs")) {
    fail("smoke.log dashboard_data_refs_with_source_id must match dashboard_data_refs.");
  }
}

function validateShadowRun(contents: string) {
  const objects = parseCapturedJsonObjects(contents, "shadow-run.log");
  const preflight = objects.find(
    (record) => boolValue(record, "ready_for_backfill") && boolValue(record, "ready_for_shadow_qa")
  );
  if (!preflight) fail("shadow-run.log missing preflight readiness.");

  const shadowQa = objects.find(
    (record) => boolValue(record, "ready_for_shadow") && boolValue(record, "ready_for_live_switch")
  );
  if (!shadowQa) fail("shadow-run.log missing shadow QA readiness.");

  const runner = objects.find((record) => boolValue(record, "ready_for_live_api_shadow"));
  if (!runner) fail("shadow-run.log missing ready_for_live_api_shadow.");
  const nextFlags = runner.next_flags;
  if (!isRecord(nextFlags)) fail("shadow-run.log next_flags must be an object.");
  assertFlag(nextFlags, "NOISIA_DATA_OS_ENABLED", "true");
  assertFlag(nextFlags, "NOISIA_DATA_OS_SERVING_ENABLED", "true");
  assertFlag(nextFlags, "NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED", "true");
  assertFlag(nextFlags, "NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED", "false");
  assertFlag(nextFlags, "NOISIA_DATA_OS_SHADOW_MODE", "true");
}

function validateAnalyze(report: JsonRecord) {
  if (!boolValue(report, "ok")) fail("analyze.json ok must be true.");
  if (report.operation !== "data-os:analyze") fail("analyze.json operation must be data-os:analyze.");
  if (!boolValue(report, "ready_for_serving_reads")) fail("ready_for_serving_reads must be true.");
  assertMin(report, "tables_analyzed", 30);
  const analyzedTables = arrayValue(report, "analyzed_tables");
  for (const table of ["data_assets", "record_tags", "lineage_edges", "dashboard_data_refs", "mentions", "brand_os_briefs"]) {
    if (!analyzedTables.includes(table)) fail(`analyze.json missing analyzed table: ${table}.`);
  }
}

function validateReviewSample(report: JsonRecord, contents: string) {
  if (!boolValue(report, "ok")) fail("review-sample.json ok must be true.");
  if (!boolValue(report, "auto_selected_local")) fail("review-sample.json auto_selected_local must be true.");
  if (!boolValue(report, "ready_for_release_review_sample")) {
    fail("review-sample.json ready_for_release_review_sample must be true.");
  }
  if (UUID_PATTERN.test(contents)) {
    fail("review-sample.json must redact corpus, tag, assertion and reviewer UUIDs.");
  }

  const humanReviewSample = report.human_review_sample;
  if (!isRecord(humanReviewSample)) fail("review-sample.json human_review_sample must be an object.");
  const tag = humanReviewSample.tag;
  if (!isRecord(tag)) fail("review-sample.json human_review_sample.tag must be an object.");
  assertTrue(tag, "review_event_created");
  assertMin(tag, "evidence_count", 1);
  const assertion = humanReviewSample.assertion;
  if (!isRecord(assertion)) fail("review-sample.json human_review_sample.assertion must be an object.");
  assertTrue(assertion, "review_event_created");
  assertMin(assertion, "evidence_count", 1);

  const summaryAfter = report.summary_after;
  if (!isRecord(summaryAfter)) fail("review-sample.json summary_after must be an object.");
  assertMin(summaryAfter, "tag_review_events", 1);
  assertMin(summaryAfter, "knowledge_assertion_review_events", 1);
}

function validateReviewQueue(report: JsonRecord, contents: string) {
  if (!boolValue(report, "ok")) fail("review-queue.json ok must be true.");
  if (report.corpus_id !== "set_redacted") fail("review-queue.json must redact corpus_id.");
  if (report.contains_sensitive_review_ids !== false) {
    fail("review-queue.json must not contain sensitive review IDs by default.");
  }
  if (report.contains_private_review_context !== false) {
    fail("review-queue.json must not contain private review context by default.");
  }
  if (report.do_not_commit_or_paste_when_sensitive !== false) {
    fail("review-queue.json default local smoke output must be PR-safe/redacted.");
  }
  if (UUID_PATTERN.test(contents)) {
    fail("review-queue.json must redact corpus, tag and assertion UUIDs.");
  }

  const summary = report.summary;
  if (!isRecord(summary)) fail("review-queue.json summary must be an object.");
  assertTrue(summary, "ready_for_human_review");
  assertTrue(summary, "required_before_client_visible");
  assertMin(summary, "record_tags_total", 1);
  assertMin(summary, "record_tags_unreviewed", 1);
  assertMin(summary, "record_tags_with_evidence", numberValue(summary, "record_tags_total"));
  assertMin(summary, "record_tag_taxonomies", 5);
  assertMin(summary, "knowledge_assertions_candidate", 1);
  assertMin(summary, "knowledge_assertions_with_evidence", numberValue(summary, "knowledge_assertions_candidate"));

  const tags = arrayValue(report, "tags");
  if (tags.length === 0) fail("review-queue.json must include redacted tag candidates.");
  for (const tag of tags) {
    if (!isRecord(tag)) fail("review-queue.json tag candidates must be objects.");
    if (tag.id !== "set_redacted") fail("review-queue.json tag IDs must be redacted by default.");
    assertMin(tag, "evidence_count", 1);
    if (typeof tag.taxonomy_key !== "string" || !tag.taxonomy_key) {
      fail("review-queue.json tag candidates must include taxonomy_key.");
    }
  }

  const assertions = arrayValue(report, "assertions");
  if (assertions.length === 0) fail("review-queue.json must include redacted assertion candidates.");
  for (const assertion of assertions) {
    if (!isRecord(assertion)) fail("review-queue.json assertion candidates must be objects.");
    if (assertion.id !== "set_redacted") fail("review-queue.json assertion IDs must be redacted by default.");
    assertMin(assertion, "evidence_count", 1);
    assertMin(assertion, "link_count", 1);
  }

  const suggestedExports = report.suggested_exports;
  if (!isRecord(suggestedExports)) fail("review-queue.json suggested_exports must be an object.");
  assertFlag(suggestedExports, "NOISIA_DATA_OS_REVIEW_TAG_ID", "<record_tag_id>");
  assertFlag(suggestedExports, "NOISIA_DATA_OS_REVIEW_ASSERTION_ID", "<knowledge_assertion_id>");
  assertFlag(suggestedExports, "NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED", "true");
  assertFlag(report, "next_command", "corepack pnpm data-os:staging-finalize");
}

function validateEvidence(report: JsonRecord) {
  if (!boolValue(report, "ok")) fail("evidence.json ok must be true.");
  if (!boolValue(report, "ready_for_pr_review")) fail("ready_for_pr_review must be true.");
  if (!boolValue(report, "ready_for_internal_shadow")) fail("ready_for_internal_shadow must be true.");
  assertEmpty("evidence failures", report.failures);
  assertEmpty("evidence warnings", report.warnings);

  const architectureDecision = report.architecture_decision;
  if (!isRecord(architectureDecision)) fail("evidence.json architecture_decision must be an object.");
  assertFlag(architectureDecision, "benchmark_doc", "docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md");
  assertFlag(architectureDecision, "product_category", "customer_intelligence_lakehouse_cdp_like");
  assertFlag(architectureDecision, "primary_store_cut_1", "supabase_postgres_drizzle");
  assertFlag(architectureDecision, "cdp_boundary", "not_customer_360_identity_resolution_or_reverse_etl");
  assertFlag(
    architectureDecision,
    "serving_contract",
    "live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback"
  );

  const gates = report.gates;
  if (!isRecord(gates)) fail("evidence.json gates must be an object.");
  assertTrue(gates, "live_payload_parity");
  const failedGates = Object.entries(gates)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (failedGates.length > 0) fail(`Evidence gates failed: ${failedGates.join(", ")}`);

  const counts = report.counts;
  if (!isRecord(counts)) fail("evidence.json counts must be an object.");
  assertMin(counts, "data_assets", 10);
  assertMin(counts, "data_asset_fields", 50);
  assertEqual(counts, "data_assets_without_fields", 0);
  assertMin(counts, "data_contracts", 10);
  assertMin(counts, "data_quality_results", 10);
  assertEqual(counts, "data_quality_failed", 0);
  assertMin(counts, "lineage_edges", 9);
  assertMin(counts, "source_lineage_edges", 1);
  assertMin(counts, "asset_lineage_edges", 1);
  assertMin(counts, "dashboard_lineage_edges", 4);
  assertMin(counts, "taxonomies", 10);
  assertMin(counts, "tagging_rule_sets", 1);
  assertMin(counts, "tagging_model_versions_with_rule_set", 1);
  assertMin(counts, "record_tags", 1);
  assertMin(counts, "record_tags_with_evidence", numberValue(counts, "record_tags"));
  assertMin(counts, "record_tag_taxonomies", 5);
  assertMin(counts, "record_feature_values", 1);
  assertMin(counts, "brand_os_profiles", 1);
  assertMin(counts, "brand_os_objectives", 1);
  assertMin(counts, "brand_os_briefs", 1);
  assertMin(counts, "brand_os_links", 3);
  assertMin(counts, "knowledge_assertions_with_evidence", numberValue(counts, "knowledge_assertions"));
  assertMin(counts, "knowledge_assertion_links", 3);
  assertMin(counts, "knowledge_usage_events", 3);
  if (numberValue(counts, "dashboard_refs_with_source_id") !== numberValue(counts, "dashboard_refs")) {
    fail("dashboard_refs_with_source_id must match dashboard_refs.");
  }

  const reviewQueue = report.review_queue;
  if (!isRecord(reviewQueue)) fail("evidence.json review_queue must be an object.");
  assertTrue(reviewQueue, "ready_for_human_review");
  assertTrue(reviewQueue, "required_before_client_visible");
  assertMin(reviewQueue, "record_tags_with_evidence", numberValue(reviewQueue, "record_tags_total"));
  assertMin(reviewQueue, "record_tag_taxonomies", 5);
  assertMin(reviewQueue, "tag_review_events", 1);
  assertMin(reviewQueue, "knowledge_assertions_with_evidence", numberValue(reviewQueue, "knowledge_assertions_total"));
  assertMin(reviewQueue, "knowledge_assertion_review_events", 1);
}

function validateServingSmoke(report: JsonRecord, contents: string) {
  if (!boolValue(report, "ok")) fail("serving-smoke.json ok must be true.");
  if (report.corpus_id !== "set_redacted") fail("serving-smoke.json must redact corpus_id.");
  if (report.output_id !== "set_redacted") fail("serving-smoke.json must redact output_id.");
  if (report.contains_sensitive_ids !== false) fail("serving-smoke.json must not contain sensitive IDs.");
  if (UUID_PATTERN.test(contents)) fail("serving-smoke.json must not include corpus or output UUID values.");
  if (!boolValue(report, "ready_for_serving_shadow")) fail("ready_for_serving_shadow must be true.");
  assertEmpty("serving smoke failures", report.failures);

  const counts = report.counts;
  if (!isRecord(counts)) fail("serving-smoke.json counts must be an object.");
  assertMin(counts, "sources", 1);
  assertMin(counts, "source_health_assets", 1);
  assertMin(counts, "source_health_fields", 50);
  assertEqual(counts, "source_health_assets_without_fields", 0);
  assertEqual(counts, "source_health_failed", 0);
  assertMin(counts, "catalog_assets", 10);
  assertMin(counts, "catalog_fields", 50);
  assertMin(counts, "catalog_contracts", 10);
  assertMin(counts, "catalog_quality_results", 10);
  assertEqual(counts, "catalog_assets_without_fields", 0);
  assertEqual(counts, "catalog_failed_quality", 0);
  assertMin(counts, "lineage_edges", 9);
  assertMin(counts, "brand_os_profiles", 1);
  assertMin(counts, "brand_os_objectives", 1);
  assertMin(counts, "brand_os_briefs", 1);
  assertMin(counts, "brand_os_links", 3);
  assertMin(counts, "brand_os_seed_terms", 1);
  assertMin(counts, "knowledge_sources", 1);
  assertMin(counts, "knowledge_chunks", 1);
  assertMin(counts, "knowledge_assertions", 1);
  assertMin(counts, "knowledge_assertion_links", 3);
  assertMin(counts, "knowledge_usage_events", 3);
  assertMin(counts, "review_queue_tags", 1);
  assertMin(counts, "review_queue_tag_taxonomies", 5);
  assertMin(counts, "review_queue_tags_with_evidence", numberValue(counts, "tags"));
  assertMin(counts, "review_queue_tag_review_events", 1);
  assertMin(counts, "review_queue_assertions", 1);
  assertMin(counts, "review_queue_assertions_with_evidence", numberValue(counts, "knowledge_assertions"));
  assertMin(counts, "review_queue_assertion_review_events", 1);
  assertTrue(counts, "review_queue_ready_for_human_review");
  assertTrue(counts, "review_queue_required_before_client_visible");
  assertMin(counts, "taxonomies", 10);
  assertMin(counts, "tags", 1);
  assertMin(counts, "periods", 1);
  assertMin(counts, "signals", 1);
  assertMin(counts, "payload_periods", 1);
  assertMin(counts, "payload_signals", 1);
  assertMin(counts, "payload_dashboard_refs", 1);
  assertMin(counts, "live_payload_period_delta", 0);
  assertMin(counts, "live_payload_signal_delta", 0);
  assertMin(counts, "live_payload_dashboard_ref_delta", 0);
  if (counts.live_behind_payload !== false) fail("serving-smoke.json counts.live_behind_payload must be false.");
  assertMin(counts, "dashboard_data_refs", 1);

  const livePayloadParity = report.live_payload_parity;
  if (!isRecord(livePayloadParity)) fail("serving-smoke.json live_payload_parity must be an object.");
  if (livePayloadParity.live_behind_payload !== false) {
    fail("serving-smoke.json live_payload_parity.live_behind_payload must be false.");
  }

  const fallbackChecks = report.fallback_checks;
  if (!isRecord(fallbackChecks)) fail("serving-smoke.json fallback_checks must be an object.");
  assertTrue(fallbackChecks, "data_os_disabled_ready");
  assertTrue(fallbackChecks, "signal_pulse_live_disabled_ready");
  assertEqual(fallbackChecks, "data_os_disabled_status", 503);
  assertEqual(fallbackChecks, "signal_pulse_live_disabled_status", 503);
  assertFlag(fallbackChecks, "data_os_disabled_fallback", "published_outputs.payload");
  assertFlag(fallbackChecks, "signal_pulse_live_disabled_fallback", "published_outputs.payload");

  const visibilityChecks = report.visibility_checks;
  if (!isRecord(visibilityChecks)) fail("serving-smoke.json visibility_checks must be an object.");
  assertTrue(visibilityChecks, "client_source_health_hidden");
  assertTrue(visibilityChecks, "client_internal_dashboard_refs_hidden");
  assertTrue(visibilityChecks, "internal_source_health_visible");
  assertTrue(visibilityChecks, "internal_dashboard_refs_preserved");
}

async function main() {
  const repoRoot = resolve(process.cwd(), "../..");
  const evidenceDir = await resolveEvidenceDir();

  for (const file of REQUIRED_FILES) {
    await stat(join(evidenceDir, file)).catch(() => fail(`Missing local smoke artifact: ${file}`));
  }
  await validateNoDatabaseUrls(evidenceDir);

  validateReadme(await readFile(join(evidenceDir, "README.md"), "utf8"));
  validateMigrations(await readCapturedJson(evidenceDir, "migrations.log"));
  validateSmokeLog(await readFile(join(evidenceDir, "smoke.log"), "utf8"));
  validateShadowRun(await readFile(join(evidenceDir, "shadow-run.log"), "utf8"));
  validateAnalyze(await readCapturedJson(evidenceDir, "analyze.json"));
  const reviewQueueContents = await readFile(join(evidenceDir, "review-queue.json"), "utf8");
  validateReviewQueue(parseLastJsonObject(reviewQueueContents, "review-queue.json"), reviewQueueContents);
  const reviewSampleContents = await readFile(join(evidenceDir, "review-sample.json"), "utf8");
  validateReviewSample(parseLastJsonObject(reviewSampleContents, "review-sample.json"), reviewSampleContents);
  validateEvidence(await readCapturedJson(evidenceDir, "evidence.json"));
  const servingSmokeContents = await readFile(join(evidenceDir, "serving-smoke.json"), "utf8");
  validateServingSmoke(parseLastJsonObject(servingSmokeContents, "serving-smoke.json"), servingSmokeContents);

  const report = {
    ok: true,
    evidence_dir: displayEvidenceDir(repoRoot, evidenceDir),
    target: "local",
    checked_files: REQUIRED_FILES,
    ready_for_local_review: true,
    ready_for_staging_preflight: true,
    ready_for_release_gate: false,
    note: "Local smoke evidence is synthetic. Run data-os:staging-shadow and data-os:release-gate against staging/preview before production review."
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
