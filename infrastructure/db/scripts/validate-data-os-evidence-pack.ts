import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

type EvidenceArtifact = {
  bytes: number;
  file: string;
  sha256: string;
};

const REQUIRED_FILES = [
  "README.md",
  "staging-check.txt",
  "shadow-run.log",
  "analyze.json",
  "serving-smoke.json",
  "review-queue.json",
  "review-sample.json",
  "evidence.json",
  "evidence.md"
];

const EVIDENCE_TARGETS = new Set(["staging", "throwaway", "preview"]);
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
const LIVE_API_SHADOW_TRUE_PATTERN = /"ready_for_live_api_shadow"\s*:\s*true/;
const LIVE_SWITCH_TRUE_PATTERN = /"ready_for_live_switch"\s*:\s*true/;
const LIVE_RENDER_FLAG_FALSE_PATTERN = /"NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED"\s*:\s*"false"/;

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function boolValue(record: JsonRecord, key: string) {
  return record[key] === true;
}

function arrayValue(record: JsonRecord, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

async function readJson(filePath: string) {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) fail(`${filePath} must contain a JSON object.`);
  return parsed;
}

async function latestEvidenceDir(repoRoot: string) {
  const evidenceRoot = join(repoRoot, ".data", "data-os-evidence");
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
  const explicit = process.argv[2] ?? process.env.NOISIA_DATA_OS_EVIDENCE_PACK_DIR;
  if (explicit) return resolve(repoRoot, explicit);

  const latest = await latestEvidenceDir(repoRoot);
  if (latest) return latest;

  fail("Set NOISIA_DATA_OS_EVIDENCE_PACK_DIR or pass an evidence pack directory path.");
}

function displayEvidenceDir(repoRoot: string, evidenceDir: string) {
  const relativePath = relative(repoRoot, evidenceDir);
  if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return relativePath;
  }
  return evidenceDir;
}

function assertEmpty(label: string, value: unknown) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > 0) fail(`${label} must be empty: ${JSON.stringify(items)}`);
}

function assertMin(counts: JsonRecord, key: string, minimum: number) {
  const actual = numberValue(counts, key);
  if (actual < minimum) fail(`${key} expected >= ${minimum}, found ${actual}.`);
}

function assertEqual(counts: JsonRecord, key: string, expected: number) {
  const actual = numberValue(counts, key);
  if (actual !== expected) fail(`${key} expected ${expected}, found ${actual}.`);
}

function assertFlag(record: JsonRecord, key: string, expected: string) {
  if (record[key] !== expected) fail(`${key} expected ${expected}, found ${String(record[key] ?? "missing")}.`);
}

function assertTrue(record: JsonRecord, key: string) {
  if (record[key] !== true) fail(`${key} must be true.`);
}

function readReadmeTarget(readme: string) {
  const match = readme.match(/^Target:\s*([a-z-]+)/m);
  return match?.[1] ?? null;
}

async function validateNoDatabaseUrls(evidenceDir: string, files: string[]) {
  for (const file of files) {
    const contents = await readFile(join(evidenceDir, file), "utf8");
    for (const sensitive of SENSITIVE_ARTIFACT_PATTERNS) {
      if (sensitive.pattern.test(contents)) {
        fail(`${file} must not include ${sensitive.label}.`);
      }
    }
  }
}

async function buildArtifactManifest(evidenceDir: string, files: string[]): Promise<EvidenceArtifact[]> {
  const artifacts = await Promise.all(
    files.map(async (file) => {
      const contents = await readFile(join(evidenceDir, file));
      return {
        bytes: contents.byteLength,
        file,
        sha256: createHash("sha256").update(contents).digest("hex")
      };
    })
  );
  return artifacts.sort((a, b) => a.file.localeCompare(b.file));
}

async function fileExists(filePath: string) {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

function isSchemaApplyRequested(readme: string) {
  return /^Schema apply requested:\s*true$/m.test(readme);
}

type StagingCheckValidation = {
  databaseEnvironment: string;
  databaseFormat: string;
  target: string;
};

function validateStagingCheck(contents: string): StagingCheckValidation {
  if (!contents.includes("Values are intentionally redacted")) {
    fail("staging-check.txt must confirm values are redacted.");
  }
  if (!contents.includes("ready_for_staging_shadow=true")) {
    fail("staging-check.txt must include ready_for_staging_shadow=true.");
  }
  if (!contents.includes("LOCAL_DATA_OS_VERIFY=passed")) {
    fail("staging-check.txt must include LOCAL_DATA_OS_VERIFY=passed.");
  }
  if (/postgres(?:ql)?:\/\//i.test(contents)) {
    fail("staging-check.txt must not include a database URL.");
  }
  if (!contents.includes("DATABASE_URL_FORMAT=postgres_url")) {
    fail("staging-check.txt must include DATABASE_URL_FORMAT=postgres_url.");
  }
  const databaseFormat = contents.match(/^DATABASE_URL_FORMAT=([a-z_]+)$/m)?.[1] ?? null;
  if (databaseFormat !== "postgres_url") {
    fail(`staging-check.txt must include DATABASE_URL_FORMAT=postgres_url. Found ${databaseFormat ?? "missing"}.`);
  }
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(contents)) {
    fail("staging-check.txt must not include corpus or output UUID values.");
  }
  if (!contents.includes("NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid")) {
    fail("staging-check.txt must include NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid.");
  }
  if (!contents.includes("NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid")) {
    fail("staging-check.txt must include NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid.");
  }
  if (!contents.includes("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true")) {
    fail("staging-check.txt must include NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true for release evidence.");
  }
  if (!contents.includes("NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid")) {
    fail("staging-check.txt must include NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid.");
  }
  if (!contents.includes("NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid")) {
    fail("staging-check.txt must include NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid.");
  }
  const databaseEnvironment = contents.match(/^DATABASE_URL_ENVIRONMENT=([a-z_]+)$/m)?.[1] ?? null;
  if (!databaseEnvironment || !["remote_redacted", "local_redacted"].includes(databaseEnvironment)) {
    fail(`staging-check.txt must include DATABASE_URL_ENVIRONMENT=remote_redacted or local_redacted. Found ${databaseEnvironment ?? "missing"}.`);
  }
  const target = contents.match(/^NOISIA_REMOTE_DATABASE_TARGET=([a-z-]+)$/m)?.[1] ?? null;
  if (!target || !EVIDENCE_TARGETS.has(target)) {
    fail(`staging-check.txt must include a valid redacted target, found ${target ?? "missing"}.`);
  }
  if (["staging", "preview"].includes(target) && databaseEnvironment !== "remote_redacted") {
    fail(`${target} evidence must come from DATABASE_URL_ENVIRONMENT=remote_redacted, found ${databaseEnvironment}.`);
  }
  return { databaseEnvironment, databaseFormat, target };
}

function validateEvidence(report: JsonRecord) {
  if (!boolValue(report, "ok")) fail("evidence.json ok must be true.");
  if (!boolValue(report, "ready_for_pr_review")) fail("ready_for_pr_review must be true.");
  if (!boolValue(report, "ready_for_internal_shadow")) fail("ready_for_internal_shadow must be true.");
  assertEmpty("evidence failures", report.failures);

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
  assertMin(counts, "dashboard_refs", 1);
  if (numberValue(counts, "dashboard_refs_with_source_id") !== numberValue(counts, "dashboard_refs")) {
    fail("dashboard_refs_with_source_id must match dashboard_refs.");
  }

  const nextFlags = report.next_flags;
  if (!isRecord(nextFlags)) fail("evidence.json next_flags must be an object.");
  assertFlag(nextFlags, "NOISIA_DATA_OS_ENABLED", "true");
  assertFlag(nextFlags, "NOISIA_DATA_OS_SERVING_ENABLED", "true");
  assertFlag(nextFlags, "NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED", "true");
  assertFlag(nextFlags, "NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED", "false");
  assertFlag(nextFlags, "NOISIA_DATA_OS_SHADOW_MODE", "true");

  const rollbackFlags = report.rollback_flags;
  if (!isRecord(rollbackFlags)) fail("evidence.json rollback_flags must be an object.");
  assertFlag(rollbackFlags, "NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED", "false");
  assertFlag(rollbackFlags, "NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED", "false");
  assertFlag(rollbackFlags, "NOISIA_DATA_OS_SERVING_ENABLED", "false");
  assertFlag(rollbackFlags, "NOISIA_DATA_OS_ENABLED", "false");
  assertFlag(rollbackFlags, "NOISIA_DATA_OS_SHADOW_MODE", "true");

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
  assertMin(counts, "review_queue_tag_review_events", 1);
  assertMin(counts, "review_queue_tags_with_evidence", numberValue(counts, "tags"));
  assertMin(counts, "review_queue_assertions", 1);
  assertMin(counts, "review_queue_assertion_review_events", 1);
  assertMin(counts, "review_queue_assertions_with_evidence", numberValue(counts, "knowledge_assertions"));
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

function validateCandidates(report: JsonRecord) {
  if (!boolValue(report, "ok")) fail("candidates.json ok must be true.");
  const recommended = report.recommended;
  if (!isRecord(recommended)) fail("candidates.json recommended candidate is required.");
  if (!boolValue(recommended, "ready_for_preflight")) fail("recommended candidate must be ready_for_preflight.");
  if (!boolValue(recommended, "ready_for_backfill")) fail("recommended candidate must be ready_for_backfill.");
  if (!boolValue(recommended, "ready_for_shadow_qa")) fail("recommended candidate must be ready_for_shadow_qa.");
  assertEmpty("recommended candidate failures", recommended.failures);
}

function validateReviewSample(report: JsonRecord, contents: string) {
  if (UUID_PATTERN.test(contents)) {
    fail("review-sample.json must not include corpus, tag or assertion UUID values.");
  }
  if (!boolValue(report, "ok")) fail("review-sample.json ok must be true.");
  if (!boolValue(report, "ready_for_release_review_sample")) {
    fail("review-sample.json ready_for_release_review_sample must be true.");
  }
  const sample = report.human_review_sample;
  if (!isRecord(sample)) fail("review-sample.json human_review_sample must be an object.");
  const tag = sample.tag;
  if (!isRecord(tag)) fail("review-sample.json human_review_sample.tag must be an object.");
  if (!boolValue(tag, "review_event_created")) {
    fail("review-sample.json human_review_sample.tag.review_event_created must be true.");
  }
  assertMin(tag, "evidence_count", 1);
  const assertion = sample.assertion;
  if (!isRecord(assertion)) fail("review-sample.json human_review_sample.assertion must be an object.");
  if (!boolValue(assertion, "review_event_created")) {
    fail("review-sample.json human_review_sample.assertion.review_event_created must be true.");
  }
  assertMin(assertion, "evidence_count", 1);
}

function validateReviewQueue(report: JsonRecord, contents: string) {
  if (!boolValue(report, "ok")) fail("review-queue.json ok must be true.");
  if (report.corpus_id !== "set_redacted") fail("review-queue.json must redact corpus_id.");
  if (report.contains_sensitive_review_ids !== false) {
    fail("review-queue.json must not contain sensitive review IDs.");
  }
  if (report.contains_private_review_context !== false) {
    fail("review-queue.json must not contain private review context.");
  }
  if (report.do_not_commit_or_paste_when_sensitive !== false) {
    fail("review-queue.json must be safe to attach as redacted evidence.");
  }
  if (UUID_PATTERN.test(contents)) {
    fail("review-queue.json must not include corpus, tag or assertion UUID values.");
  }

  const summary = report.summary;
  if (!isRecord(summary)) fail("review-queue.json summary must be an object.");
  assertTrue(summary, "ready_for_human_review");
  assertTrue(summary, "required_before_client_visible");
  assertMin(summary, "record_tags_total", 1);
  assertMin(summary, "record_tags_with_evidence", numberValue(summary, "record_tags_total"));
  assertMin(summary, "record_tag_taxonomies", 5);
  assertMin(summary, "knowledge_assertions_candidate", 1);
  assertMin(summary, "knowledge_assertions_with_evidence", numberValue(summary, "knowledge_assertions_candidate"));

  const tags = arrayValue(report, "tags");
  if (tags.length === 0) fail("review-queue.json must include redacted tag candidates.");
  for (const tag of tags) {
    if (!isRecord(tag)) fail("review-queue.json tag candidates must be objects.");
    if (tag.id !== "set_redacted") fail("review-queue.json tag IDs must be redacted.");
    assertMin(tag, "evidence_count", 1);
    if (typeof tag.taxonomy_key !== "string" || !tag.taxonomy_key) {
      fail("review-queue.json tag candidates must include taxonomy_key.");
    }
  }

  const assertions = arrayValue(report, "assertions");
  if (assertions.length === 0) fail("review-queue.json must include redacted assertion candidates.");
  for (const assertion of assertions) {
    if (!isRecord(assertion)) fail("review-queue.json assertion candidates must be objects.");
    if (assertion.id !== "set_redacted") fail("review-queue.json assertion IDs must be redacted.");
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

async function main() {
  const repoRoot = resolve(process.cwd(), "../..");
  const evidenceDir = await resolveEvidenceDir();
  const readme = await readFile(join(evidenceDir, "README.md"), "utf8");
  const target = readReadmeTarget(readme);
  if (!target || !EVIDENCE_TARGETS.has(target)) {
    fail(`README.md must include Target: staging, throwaway or preview. Found: ${target ?? "missing"}.`);
  }
  const candidatesSkipped = readme.includes("Candidates skipped: true");
  const schemaApplyRequested = isSchemaApplyRequested(readme);
  const schemaFiles = schemaApplyRequested ? ["apply-schema.log"] : [];
  const requiredFiles = candidatesSkipped
    ? [...REQUIRED_FILES, ...schemaFiles]
    : [...REQUIRED_FILES, ...schemaFiles, "candidates.json"];

  for (const file of requiredFiles) {
    await stat(join(evidenceDir, file)).catch(() => fail(`Missing evidence artifact: ${file}`));
  }
  if (!schemaApplyRequested && (await fileExists(join(evidenceDir, "apply-schema.log")))) {
    fail("apply-schema.log requires README.md to include Schema apply requested: true.");
  }
  if (schemaApplyRequested && !readme.includes("## apply-schema.log")) {
    fail("README.md must include the apply-schema.log command when schema apply is requested.");
  }
  await validateNoDatabaseUrls(evidenceDir, requiredFiles);

  if (!readme.includes("must not be committed")) fail("README.md must warn that evidence must not be committed.");
  if (UUID_PATTERN.test(readme)) fail("README.md must not include corpus or output UUID values.");

  const stagingCheck = await readFile(join(evidenceDir, "staging-check.txt"), "utf8");
  const stagingCheckValidation = validateStagingCheck(stagingCheck);
  const stagingCheckTarget = stagingCheckValidation.target;
  if (stagingCheckTarget !== target) {
    fail(`staging-check.txt target (${stagingCheckTarget}) must match README target (${target}).`);
  }

  const shadowRun = await readFile(join(evidenceDir, "shadow-run.log"), "utf8");
  if (!LIVE_API_SHADOW_TRUE_PATTERN.test(shadowRun)) fail("shadow-run.log missing ready_for_live_api_shadow=true.");
  if (!LIVE_SWITCH_TRUE_PATTERN.test(shadowRun)) fail("shadow-run.log missing ready_for_live_switch=true.");
  if (!LIVE_RENDER_FLAG_FALSE_PATTERN.test(shadowRun)) {
    fail("shadow-run.log next_flags must keep NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false.");
  }

  const evidenceMarkdown = await readFile(join(evidenceDir, "evidence.md"), "utf8");
  if (!evidenceMarkdown.includes("Ready for PR review: true")) fail("evidence.md missing PR readiness.");
  if (!evidenceMarkdown.includes("Ready for internal shadow: true")) fail("evidence.md missing internal shadow readiness.");
  if (!evidenceMarkdown.includes("Identifiers: redacted for PR")) {
    fail("evidence.md must state identifiers are redacted for PR.");
  }
  if (!evidenceMarkdown.includes("## Architecture Decision")) {
    fail("evidence.md must include the Data OS architecture decision.");
  }
  if (!evidenceMarkdown.includes("customer_intelligence_lakehouse_cdp_like")) {
    fail("evidence.md must state the Data OS product category.");
  }
  if (!evidenceMarkdown.includes("not_customer_360_identity_resolution_or_reverse_etl")) {
    fail("evidence.md must state the CDP boundary.");
  }
  if (!evidenceMarkdown.includes("live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback")) {
    fail("evidence.md must state the live serving/fallback contract.");
  }
  if (!evidenceMarkdown.includes("## Review Queue")) {
    fail("evidence.md must include the Data OS review queue.");
  }
  if (!evidenceMarkdown.includes("Required before client-visible activation: true")) {
    fail("evidence.md must state human review is required before client-visible activation.");
  }
  if (UUID_PATTERN.test(evidenceMarkdown)) {
    fail("evidence.md must not include corpus or output UUID values.");
  }

  const evidence = await readJson(join(evidenceDir, "evidence.json"));
  validateEvidence(evidence);

  const analyze = await readJson(join(evidenceDir, "analyze.json"));
  validateAnalyze(analyze);

  const servingSmokeContents = await readFile(join(evidenceDir, "serving-smoke.json"), "utf8");
  const servingSmoke = JSON.parse(servingSmokeContents) as unknown;
  if (!isRecord(servingSmoke)) fail("serving-smoke.json must contain a JSON object.");
  validateServingSmoke(servingSmoke, servingSmokeContents);

  const reviewQueueContents = await readFile(join(evidenceDir, "review-queue.json"), "utf8");
  const reviewQueue = JSON.parse(reviewQueueContents) as unknown;
  if (!isRecord(reviewQueue)) fail("review-queue.json must contain a JSON object.");
  validateReviewQueue(reviewQueue, reviewQueueContents);

  const reviewSampleContents = await readFile(join(evidenceDir, "review-sample.json"), "utf8");
  const reviewSample = JSON.parse(reviewSampleContents) as unknown;
  if (!isRecord(reviewSample)) fail("review-sample.json must contain a JSON object.");
  validateReviewSample(reviewSample, reviewSampleContents);

  if (!candidatesSkipped) {
    const candidates = await readJson(join(evidenceDir, "candidates.json"));
    validateCandidates(candidates);
  }

  const report = {
    ok: true,
    evidence_dir: displayEvidenceDir(repoRoot, evidenceDir),
    target,
    database_environment: stagingCheckValidation.databaseEnvironment,
    database_format: stagingCheckValidation.databaseFormat,
    candidates_checked: !candidatesSkipped,
    checked_files: requiredFiles,
    artifact_manifest_algorithm: "sha256",
    artifact_manifest: await buildArtifactManifest(evidenceDir, requiredFiles),
    ready_for_release_gate:
      ["staging", "preview"].includes(target) &&
      stagingCheckValidation.databaseEnvironment === "remote_redacted" &&
      !candidatesSkipped,
    ready_for_pr_review: true,
    ready_for_internal_shadow: true
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
