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
  "candidates.json",
  "staging-check.txt",
  "shadow-run.log",
  "analyze.json",
  "serving-smoke.json",
  "review-queue.json",
  "review-sample.json",
  "evidence.json",
  "evidence.md",
  "evidence-pack-validation.json"
];

const RELEASE_TARGETS = new Set(["staging", "preview"]);
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

function boolValue(record: JsonRecord, key: string) {
  return record[key] === true;
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

function resolveEvidenceDirReference(repoRoot: string, evidenceDirReference: string) {
  if (isAbsolute(evidenceDirReference)) return resolve(evidenceDirReference);
  return resolve(repoRoot, evidenceDirReference);
}

async function fileExists(filePath: string) {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

function readReadmeTarget(readme: string) {
  const match = readme.match(/^Target:\s*([a-z-]+)/m);
  return match?.[1] ?? null;
}

function isSchemaApplyRequested(readme: string) {
  return /^Schema apply requested:\s*true$/m.test(readme);
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

async function readArtifact(evidenceDir: string, file: string): Promise<EvidenceArtifact> {
  const contents = await readFile(join(evidenceDir, file));
  return {
    bytes: contents.byteLength,
    file,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

function parseArtifactManifest(validation: JsonRecord) {
  if (validation.artifact_manifest_algorithm !== "sha256") {
    fail("evidence-pack-validation.json artifact_manifest_algorithm must be sha256.");
  }
  const manifest = validation.artifact_manifest;
  if (!Array.isArray(manifest)) {
    fail("evidence-pack-validation.json artifact_manifest must be an array.");
  }
  const parsed = new Map<string, EvidenceArtifact>();
  for (const item of manifest) {
    if (!isRecord(item)) fail("evidence-pack-validation.json artifact_manifest entries must be objects.");
    const file = item.file;
    const bytes = item.bytes;
    const sha256 = item.sha256;
    if (typeof file !== "string" || !file) fail("evidence-pack-validation.json artifact_manifest entry missing file.");
    if (typeof bytes !== "number" || bytes < 0) {
      fail(`evidence-pack-validation.json artifact_manifest ${file} has invalid bytes.`);
    }
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
      fail(`evidence-pack-validation.json artifact_manifest ${file} has invalid sha256.`);
    }
    if (parsed.has(file)) fail(`evidence-pack-validation.json artifact_manifest duplicates ${file}.`);
    parsed.set(file, { bytes, file, sha256 });
  }
  return parsed;
}

async function validateArtifactManifest(evidenceDir: string, validation: JsonRecord, files: string[]) {
  const manifest = parseArtifactManifest(validation);
  for (const file of files) {
    const expected = manifest.get(file);
    if (!expected) fail(`evidence-pack-validation.json artifact_manifest missing ${file}.`);
    const actual = await readArtifact(evidenceDir, file);
    if (actual.bytes !== expected.bytes) {
      fail(`${file} byte length changed after evidence-pack-validation.json was generated.`);
    }
    if (actual.sha256 !== expected.sha256) {
      fail(`${file} checksum changed after evidence-pack-validation.json was generated.`);
    }
  }
}

function assertEmpty(label: string, value: unknown) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > 0) fail(`${label} must be empty: ${JSON.stringify(items)}`);
}

function requireTrue(record: JsonRecord, key: string) {
  if (!boolValue(record, key)) fail(`${key} must be true.`);
}

function requireMinimum(record: JsonRecord, key: string, minimum: number) {
  const value = record[key];
  const actual = typeof value === "number" ? value : Number(value ?? 0);
  if (actual < minimum) fail(`${key} expected >= ${minimum}, found ${actual}.`);
}

function requireEqual(record: JsonRecord, key: string, expected: number) {
  const value = record[key];
  const actual = typeof value === "number" ? value : Number(value ?? 0);
  if (actual !== expected) fail(`${key} expected ${expected}, found ${actual}.`);
}

function requireFlag(record: JsonRecord, key: string, expected: string) {
  if (record[key] !== expected) fail(`${key} expected ${expected}, found ${String(record[key] ?? "missing")}.`);
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
    fail(`staging-check.txt must include DATABASE_URL_FORMAT=postgres_url. Found: ${databaseFormat ?? "missing"}.`);
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
    fail(`staging-check.txt must include DATABASE_URL_ENVIRONMENT=remote_redacted or local_redacted. Found: ${databaseEnvironment ?? "missing"}.`);
  }
  const target = contents.match(/^NOISIA_REMOTE_DATABASE_TARGET=([a-z-]+)$/m)?.[1] ?? null;
  if (!target || !RELEASE_TARGETS.has(target)) {
    fail(`staging-check.txt must include a staging/preview target. Found: ${target ?? "missing"}.`);
  }
  if (databaseEnvironment !== "remote_redacted") {
    fail(`Release gate requires DATABASE_URL_ENVIRONMENT=remote_redacted for ${target}. Found: ${databaseEnvironment}.`);
  }
  return { databaseEnvironment, databaseFormat, target };
}

function validateReviewSample(report: JsonRecord, contents: string) {
  if (UUID_PATTERN.test(contents)) {
    fail("review-sample.json must not include corpus, tag or assertion UUID values.");
  }
  requireTrue(report, "ok");
  requireTrue(report, "ready_for_release_review_sample");
  const sample = report.human_review_sample;
  if (!isRecord(sample)) fail("review-sample.json human_review_sample must be an object.");
  const tag = sample.tag;
  if (!isRecord(tag)) fail("review-sample.json human_review_sample.tag must be an object.");
  requireTrue(tag, "review_event_created");
  requireMinimum(tag, "evidence_count", 1);
  const assertion = sample.assertion;
  if (!isRecord(assertion)) fail("review-sample.json human_review_sample.assertion must be an object.");
  requireTrue(assertion, "review_event_created");
  requireMinimum(assertion, "evidence_count", 1);
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
    fail("review-queue.json must be safe to attach as redacted release evidence.");
  }
  if (UUID_PATTERN.test(contents)) {
    fail("review-queue.json must not include corpus, tag or assertion UUID values.");
  }

  const summary = report.summary;
  if (!isRecord(summary)) fail("review-queue.json summary must be an object.");
  requireTrue(summary, "ready_for_human_review");
  requireTrue(summary, "required_before_client_visible");
  requireMinimum(summary, "record_tags_total", 1);
  requireMinimum(summary, "record_tags_with_evidence", Number(summary.record_tags_total ?? 0));
  requireMinimum(summary, "record_tag_taxonomies", 5);
  requireMinimum(summary, "knowledge_assertions_candidate", 1);
  requireMinimum(summary, "knowledge_assertions_with_evidence", Number(summary.knowledge_assertions_candidate ?? 0));

  const tags = report.tags;
  if (!Array.isArray(tags) || tags.length === 0) fail("review-queue.json must include redacted tag candidates.");
  for (const tag of tags) {
    if (!isRecord(tag)) fail("review-queue.json tag candidates must be objects.");
    if (tag.id !== "set_redacted") fail("review-queue.json tag IDs must be redacted.");
    requireMinimum(tag, "evidence_count", 1);
    if (typeof tag.taxonomy_key !== "string" || !tag.taxonomy_key) {
      fail("review-queue.json tag candidates must include taxonomy_key.");
    }
  }

  const assertions = report.assertions;
  if (!Array.isArray(assertions) || assertions.length === 0) {
    fail("review-queue.json must include redacted assertion candidates.");
  }
  for (const assertion of assertions) {
    if (!isRecord(assertion)) fail("review-queue.json assertion candidates must be objects.");
    if (assertion.id !== "set_redacted") fail("review-queue.json assertion IDs must be redacted.");
    requireMinimum(assertion, "evidence_count", 1);
    requireMinimum(assertion, "link_count", 1);
  }

  const suggestedExports = report.suggested_exports;
  if (!isRecord(suggestedExports)) fail("review-queue.json suggested_exports must be an object.");
  requireFlag(suggestedExports, "NOISIA_DATA_OS_REVIEW_TAG_ID", "<record_tag_id>");
  requireFlag(suggestedExports, "NOISIA_DATA_OS_REVIEW_ASSERTION_ID", "<knowledge_assertion_id>");
  requireFlag(suggestedExports, "NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED", "true");
  requireFlag(report, "next_command", "corepack pnpm data-os:staging-finalize");
}

async function main() {
  const repoRoot = resolve(process.cwd(), "../..");
  const evidenceDir = await resolveEvidenceDir();
  const readme = await readFile(join(evidenceDir, "README.md"), "utf8").catch(() =>
    fail("Missing release evidence artifact: README.md")
  );
  const schemaApplyRequested = isSchemaApplyRequested(readme);
  const requiredFiles = schemaApplyRequested ? [...REQUIRED_FILES, "apply-schema.log"] : REQUIRED_FILES;

  for (const file of requiredFiles) {
    await stat(join(evidenceDir, file)).catch(() => fail(`Missing release evidence artifact: ${file}`));
  }
  if (!schemaApplyRequested && (await fileExists(join(evidenceDir, "apply-schema.log")))) {
    fail("apply-schema.log requires README.md to include Schema apply requested: true.");
  }
  if (schemaApplyRequested && !readme.includes("## apply-schema.log")) {
    fail("README.md must include the apply-schema.log command when schema apply is requested.");
  }
  await validateNoDatabaseUrls(evidenceDir, requiredFiles);

  const target = readReadmeTarget(readme);
  if (!target || !RELEASE_TARGETS.has(target)) {
    fail(`Release gate requires evidence Target: staging or preview. Found: ${target ?? "missing"}.`);
  }
  if (readme.includes("Candidates skipped: true")) {
    fail("Release gate requires candidates.json from the selected staging/preview run.");
  }
  if (!readme.includes("must not be committed")) {
    fail("README.md must warn that evidence must not be committed.");
  }
  if (UUID_PATTERN.test(readme)) {
    fail("README.md must not include corpus or output UUID values.");
  }

  const stagingCheck = await readFile(join(evidenceDir, "staging-check.txt"), "utf8");
  const stagingCheckValidation = validateStagingCheck(stagingCheck);
  const stagingCheckTarget = stagingCheckValidation.target;
  if (stagingCheckTarget !== target) {
    fail(`staging-check.txt target (${stagingCheckTarget}) must match README target (${target}).`);
  }

  const validation = await readJson(join(evidenceDir, "evidence-pack-validation.json"));
  requireTrue(validation, "ok");
  requireTrue(validation, "ready_for_pr_review");
  requireTrue(validation, "ready_for_internal_shadow");
  requireTrue(validation, "ready_for_release_gate");
  if (validation.target !== target) {
    fail(`evidence-pack-validation.json target (${String(validation.target ?? "missing")}) must match README target (${target}).`);
  }
  if (validation.database_environment !== "remote_redacted") {
    fail("evidence-pack-validation.json database_environment must be remote_redacted.");
  }
  if (validation.database_format !== "postgres_url") {
    fail("evidence-pack-validation.json database_format must be postgres_url.");
  }
  if (resolveEvidenceDirReference(repoRoot, String(validation.evidence_dir ?? "")) !== evidenceDir) {
    fail("evidence-pack-validation.json evidence_dir must match the current evidence directory. Rerun data-os:validate-evidence-pack.");
  }
  if (validation.candidates_checked !== true) fail("evidence-pack-validation.json must confirm candidates_checked=true.");
  const validationCheckedFiles = validation.checked_files;
  if (!Array.isArray(validationCheckedFiles)) fail("evidence-pack-validation.json checked_files must be an array.");
  for (const file of requiredFiles.filter((name) => name !== "evidence-pack-validation.json")) {
    if (!validationCheckedFiles.includes(file)) {
      fail(`evidence-pack-validation.json checked_files missing ${file}.`);
    }
  }
  await validateArtifactManifest(
    evidenceDir,
    validation,
    requiredFiles.filter((name) => name !== "evidence-pack-validation.json")
  );

  const evidence = await readJson(join(evidenceDir, "evidence.json"));
  const evidenceMarkdown = await readFile(join(evidenceDir, "evidence.md"), "utf8");
  if (!evidenceMarkdown.includes("Identifiers: redacted for PR")) {
    fail("evidence.md must state identifiers are redacted for PR.");
  }
  if (UUID_PATTERN.test(evidenceMarkdown)) {
    fail("evidence.md must not include corpus or output UUID values.");
  }
  requireTrue(evidence, "ok");
  requireTrue(evidence, "ready_for_pr_review");
  requireTrue(evidence, "ready_for_internal_shadow");
  assertEmpty("evidence failures", evidence.failures);
  assertEmpty("evidence warnings", evidence.warnings);

  const architectureDecision = evidence.architecture_decision;
  if (!isRecord(architectureDecision)) fail("evidence.json architecture_decision must be an object.");
  requireFlag(architectureDecision, "benchmark_doc", "docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md");
  requireFlag(architectureDecision, "product_category", "customer_intelligence_lakehouse_cdp_like");
  requireFlag(architectureDecision, "primary_store_cut_1", "supabase_postgres_drizzle");
  requireFlag(architectureDecision, "cdp_boundary", "not_customer_360_identity_resolution_or_reverse_etl");
  requireFlag(
    architectureDecision,
    "serving_contract",
    "live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback"
  );
  const gates = evidence.gates;
  if (!isRecord(gates)) fail("evidence.json gates must be an object.");
  requireTrue(gates, "live_payload_parity");

  const counts = evidence.counts;
  if (!isRecord(counts)) fail("evidence.json counts must be an object.");
  requireMinimum(counts, "data_assets", 10);
  requireMinimum(counts, "data_asset_fields", 50);
  requireEqual(counts, "data_assets_without_fields", 0);
  requireMinimum(counts, "data_contracts", 10);
  requireMinimum(counts, "data_quality_results", 10);
  requireEqual(counts, "data_quality_failed", 0);
  requireMinimum(counts, "lineage_edges", 9);
  requireMinimum(counts, "source_lineage_edges", 1);
  requireMinimum(counts, "asset_lineage_edges", 1);
  requireMinimum(counts, "dashboard_lineage_edges", 4);
  requireMinimum(counts, "taxonomies", 10);
  requireMinimum(counts, "tagging_rule_sets", 1);
  requireMinimum(counts, "tagging_model_versions_with_rule_set", 1);
  requireMinimum(counts, "record_tags", 1);
  requireMinimum(counts, "record_tags_with_evidence", Number(counts.record_tags ?? 0));
  requireMinimum(counts, "record_tag_taxonomies", 5);
  requireMinimum(counts, "record_feature_values", 1);
  requireMinimum(counts, "brand_os_profiles", 1);
  requireMinimum(counts, "brand_os_objectives", 1);
  requireMinimum(counts, "brand_os_briefs", 1);
  requireMinimum(counts, "brand_os_links", 3);
  requireMinimum(counts, "knowledge_chunks", 1);
  requireMinimum(counts, "knowledge_assertions", 1);
  requireMinimum(counts, "knowledge_assertions_with_evidence", Number(counts.knowledge_assertions ?? 0));
  requireMinimum(counts, "knowledge_assertion_links", 3);
  requireMinimum(counts, "knowledge_usage_events", 3);
  if (Number(counts.dashboard_refs_with_source_id ?? 0) !== Number(counts.dashboard_refs ?? 0)) {
    fail("dashboard_refs_with_source_id must match dashboard_refs.");
  }

  const nextFlags = evidence.next_flags;
  if (!isRecord(nextFlags)) fail("evidence.json next_flags must be an object.");
  requireFlag(nextFlags, "NOISIA_DATA_OS_ENABLED", "true");
  requireFlag(nextFlags, "NOISIA_DATA_OS_SERVING_ENABLED", "true");
  requireFlag(nextFlags, "NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED", "true");
  requireFlag(nextFlags, "NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED", "false");
  requireFlag(nextFlags, "NOISIA_DATA_OS_SHADOW_MODE", "true");

  const rollbackFlags = evidence.rollback_flags;
  if (!isRecord(rollbackFlags)) fail("evidence.json rollback_flags must be an object.");
  requireFlag(rollbackFlags, "NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED", "false");
  requireFlag(rollbackFlags, "NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED", "false");
  requireFlag(rollbackFlags, "NOISIA_DATA_OS_SERVING_ENABLED", "false");
  requireFlag(rollbackFlags, "NOISIA_DATA_OS_ENABLED", "false");
  requireFlag(rollbackFlags, "NOISIA_DATA_OS_SHADOW_MODE", "true");

  const reviewQueue = evidence.review_queue;
  if (!isRecord(reviewQueue)) fail("evidence.json review_queue must be an object.");
  requireTrue(reviewQueue, "ready_for_human_review");
  requireTrue(reviewQueue, "required_before_client_visible");
  requireMinimum(reviewQueue, "record_tags_with_evidence", Number(reviewQueue.record_tags_total ?? 0));
  requireMinimum(reviewQueue, "record_tag_taxonomies", 5);
  requireMinimum(reviewQueue, "tag_review_events", 1);
  requireMinimum(reviewQueue, "knowledge_assertions_with_evidence", Number(reviewQueue.knowledge_assertions_total ?? 0));
  requireMinimum(reviewQueue, "knowledge_assertion_review_events", 1);

  const output = evidence.output;
  if (!isRecord(output)) fail("evidence.json output must be an object.");
  if (output.status !== "published") {
    fail(`Release gate requires a published Signal Pulse output. Found status: ${String(output.status ?? "missing")}.`);
  }

  const servingSmokeContents = await readFile(join(evidenceDir, "serving-smoke.json"), "utf8");
  if (UUID_PATTERN.test(servingSmokeContents)) {
    fail("serving-smoke.json must not include corpus or output UUID values.");
  }
  const servingSmoke = JSON.parse(servingSmokeContents) as unknown;
  if (!isRecord(servingSmoke)) fail("serving-smoke.json must contain a JSON object.");
  requireTrue(servingSmoke, "ok");
  if (servingSmoke.corpus_id !== "set_redacted") fail("serving-smoke.json must redact corpus_id.");
  if (servingSmoke.output_id !== "set_redacted") fail("serving-smoke.json must redact output_id.");
  if (servingSmoke.contains_sensitive_ids !== false) {
    fail("serving-smoke.json must not contain sensitive IDs.");
  }
  requireTrue(servingSmoke, "ready_for_serving_shadow");
  assertEmpty("serving smoke failures", servingSmoke.failures);
  const servingCounts = servingSmoke.counts;
  if (!isRecord(servingCounts)) fail("serving-smoke.json counts must be an object.");
  requireMinimum(servingCounts, "catalog_assets", 10);
  requireMinimum(servingCounts, "catalog_fields", 50);
  requireMinimum(servingCounts, "catalog_contracts", 10);
  requireMinimum(servingCounts, "catalog_quality_results", 10);
  requireEqual(servingCounts, "catalog_assets_without_fields", 0);
  requireEqual(servingCounts, "catalog_failed_quality", 0);
  requireMinimum(servingCounts, "lineage_edges", 9);
  requireMinimum(servingCounts, "brand_os_profiles", 1);
  requireMinimum(servingCounts, "brand_os_objectives", 1);
  requireMinimum(servingCounts, "brand_os_briefs", 1);
  requireMinimum(servingCounts, "brand_os_links", 3);
  requireMinimum(servingCounts, "knowledge_sources", 1);
  requireMinimum(servingCounts, "knowledge_chunks", 1);
  requireMinimum(servingCounts, "knowledge_assertions", 1);
  requireMinimum(servingCounts, "knowledge_assertion_links", 3);
  requireMinimum(servingCounts, "knowledge_usage_events", 3);
  requireMinimum(servingCounts, "review_queue_tags", 1);
  requireMinimum(servingCounts, "review_queue_tag_taxonomies", 5);
  requireMinimum(servingCounts, "review_queue_tag_review_events", 1);
  requireMinimum(servingCounts, "review_queue_tags_with_evidence", Number(servingCounts.tags ?? 0));
  requireMinimum(servingCounts, "review_queue_assertions", 1);
  requireMinimum(servingCounts, "review_queue_assertion_review_events", 1);
  requireMinimum(servingCounts, "review_queue_assertions_with_evidence", Number(servingCounts.knowledge_assertions ?? 0));
  requireTrue(servingCounts, "review_queue_ready_for_human_review");
  requireTrue(servingCounts, "review_queue_required_before_client_visible");
  requireMinimum(servingCounts, "payload_periods", 1);
  requireMinimum(servingCounts, "payload_signals", 1);
  requireMinimum(servingCounts, "payload_dashboard_refs", 1);
  requireMinimum(servingCounts, "live_payload_period_delta", 0);
  requireMinimum(servingCounts, "live_payload_signal_delta", 0);
  requireMinimum(servingCounts, "live_payload_dashboard_ref_delta", 0);
  if (servingCounts.live_behind_payload !== false) {
    fail("serving-smoke.json counts.live_behind_payload must be false.");
  }

  const livePayloadParity = servingSmoke.live_payload_parity;
  if (!isRecord(livePayloadParity)) fail("serving-smoke.json live_payload_parity must be an object.");
  if (livePayloadParity.live_behind_payload !== false) {
    fail("serving-smoke.json live_payload_parity.live_behind_payload must be false.");
  }

  const reviewSampleContents = await readFile(join(evidenceDir, "review-sample.json"), "utf8");
  const reviewSample = JSON.parse(reviewSampleContents) as unknown;
  if (!isRecord(reviewSample)) fail("review-sample.json must contain a JSON object.");
  validateReviewSample(reviewSample, reviewSampleContents);

  const reviewQueueContents = await readFile(join(evidenceDir, "review-queue.json"), "utf8");
  const reviewQueueArtifact = JSON.parse(reviewQueueContents) as unknown;
  if (!isRecord(reviewQueueArtifact)) fail("review-queue.json must contain a JSON object.");
  validateReviewQueue(reviewQueueArtifact, reviewQueueContents);

  const fallbackChecks = servingSmoke.fallback_checks;
  if (!isRecord(fallbackChecks)) fail("serving-smoke.json fallback_checks must be an object.");
  requireTrue(fallbackChecks, "data_os_disabled_ready");
  requireTrue(fallbackChecks, "signal_pulse_live_disabled_ready");
  requireEqual(fallbackChecks, "data_os_disabled_status", 503);
  requireEqual(fallbackChecks, "signal_pulse_live_disabled_status", 503);
  requireFlag(fallbackChecks, "data_os_disabled_fallback", "published_outputs.payload");
  requireFlag(fallbackChecks, "signal_pulse_live_disabled_fallback", "published_outputs.payload");

  const visibilityChecks = servingSmoke.visibility_checks;
  if (!isRecord(visibilityChecks)) fail("serving-smoke.json visibility_checks must be an object.");
  requireTrue(visibilityChecks, "client_source_health_hidden");
  requireTrue(visibilityChecks, "client_internal_dashboard_refs_hidden");
  requireTrue(visibilityChecks, "internal_source_health_visible");
  requireTrue(visibilityChecks, "internal_dashboard_refs_preserved");

  const analyze = await readJson(join(evidenceDir, "analyze.json"));
  requireTrue(analyze, "ok");
  if (analyze.operation !== "data-os:analyze") fail("analyze.json operation must be data-os:analyze.");
  requireTrue(analyze, "ready_for_serving_reads");
  requireMinimum(analyze, "tables_analyzed", 30);
  const analyzedTables = analyze.analyzed_tables;
  if (!Array.isArray(analyzedTables)) fail("analyze.json analyzed_tables must be an array.");
  for (const table of ["data_assets", "record_tags", "lineage_edges", "dashboard_data_refs", "mentions", "brand_os_briefs"]) {
    if (!analyzedTables.includes(table)) fail(`analyze.json missing analyzed table: ${table}.`);
  }

  const candidates = await readJson(join(evidenceDir, "candidates.json"));
  requireTrue(candidates, "ok");
  const recommended = candidates.recommended;
  if (!isRecord(recommended)) fail("candidates.json recommended candidate is required.");
  requireTrue(recommended, "ready_for_preflight");
  requireTrue(recommended, "ready_for_backfill");
  requireTrue(recommended, "ready_for_shadow_qa");
  assertEmpty("recommended candidate failures", recommended.failures);

  const shadowRun = await readFile(join(evidenceDir, "shadow-run.log"), "utf8");
  if (!LIVE_API_SHADOW_TRUE_PATTERN.test(shadowRun)) fail("shadow-run.log missing ready_for_live_api_shadow=true.");
  if (!LIVE_SWITCH_TRUE_PATTERN.test(shadowRun)) fail("shadow-run.log missing ready_for_live_switch=true.");
  if (!LIVE_RENDER_FLAG_FALSE_PATTERN.test(shadowRun)) {
    fail("shadow-run.log next_flags must keep NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false.");
  }

  const report = {
    ok: true,
    evidence_dir: displayEvidenceDir(repoRoot, evidenceDir),
    target,
    database_environment: stagingCheckValidation.databaseEnvironment,
    database_format: stagingCheckValidation.databaseFormat,
    output_status: output.status,
    candidates_checked: true,
    ready_for_production_review: true,
    gates: [
      "staging_or_preview_evidence",
      "evidence_pack_validation",
      "published_signal_pulse_output",
      "architecture_decision_confirmed",
      "data_catalog_quality_and_lineage",
      "brand_os_and_knowledge_catalogs",
      "brand_os_knowledge_links",
      "tag_assertion_review_queue_ready",
      "human_review_sample_complete",
      "tagging_rule_set_governance",
      "safe_next_and_rollback_flags",
      "live_render_flag_guarded",
      "disabled_api_payload_fallback",
      "post_backfill_analyze",
      "no_failures_or_warnings",
      "serving_shadow_ready",
      "candidate_ready",
      "shadow_run_ready",
      "local_data_os_verify_precheck",
      "database_format_postgres_url",
      "artifact_manifest_current"
    ],
    next_flags: evidence.next_flags ?? null,
    rollback_flags: evidence.rollback_flags ?? null,
    note: "This is a release review gate, not permission to bypass PR, CODEOWNERS or production change approval."
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
