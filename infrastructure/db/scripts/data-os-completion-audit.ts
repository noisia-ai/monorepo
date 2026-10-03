import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

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
const RELEASE_TARGETS = new Set(["staging", "preview"]);
const REQUIRED_RELEASE_GATE_GATES = [
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
];

type RequirementCheck = {
  evidence: string;
  ok: boolean;
  requirement: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(filePath: string) {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function readJson(filePath: string) {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`${filePath} must contain a JSON object.`);
  return parsed;
}

function displayEvidenceDir(repoRoot: string, evidenceDir: string | null) {
  if (!evidenceDir) return null;
  const relativePath = relative(repoRoot, evidenceDir);
  if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return relativePath;
  }
  return "external_path_redacted";
}

function resolveEvidenceDir(repoRoot: string) {
  const explicit = process.argv[2] ?? process.env.NOISIA_DATA_OS_EVIDENCE_PACK_DIR;
  if (!explicit) return null;
  return resolve(repoRoot, explicit);
}

function assertPrSafe(label: string, contents: string) {
  if (UUID_PATTERN.test(contents)) throw new Error(`${label} must not include corpus, output, brand, tag or assertion UUID values.`);
  for (const item of SENSITIVE_ARTIFACT_PATTERNS) {
    if (item.pattern.test(contents)) throw new Error(`${label} must not include ${item.label}.`);
  }
}

function pushIfMissing(missing: string[], condition: boolean, label: string) {
  if (!condition) missing.push(label);
}

async function main() {
  const repoRoot = resolve(process.cwd(), "../..");
  const evidenceDir = resolveEvidenceDir(repoRoot);
  const missing: string[] = [];
  const notes: string[] = [];
  const requirementChecks: RequirementCheck[] = [];

  function checkRequirement(requirement: string, evidence: string, condition: boolean) {
    requirementChecks.push({ evidence, ok: condition, requirement });
    pushIfMissing(missing, condition, requirement);
  }

  if (!evidenceDir) {
    const report = {
      ok: true,
      ready_for_goal_completion: false,
      evidence_dir: null,
      missing_evidence: [
        "NOISIA_DATA_OS_EVIDENCE_PACK_DIR or explicit evidence pack path",
        "staging/preview release-gate.json with ready_for_production_review=true",
        "backend-ready-signal-v2.json with backend_ready_for_signal_v2=true"
      ],
      requirement_checks: [
        {
          evidence: "NOISIA_DATA_OS_EVIDENCE_PACK_DIR or explicit evidence pack path",
          ok: false,
          requirement: "staging/preview evidence pack selected"
        },
        {
          evidence: "release-gate.json",
          ok: false,
          requirement: "release-gate.ready_for_production_review=true"
        },
        {
          evidence: "backend-ready-signal-v2.json",
          ok: false,
          requirement: "backend-ready-signal-v2.backend_ready_for_signal_v2=true"
        }
      ],
      next_command: "corepack pnpm data-os:staging-check && corepack pnpm data-os:staging-shadow"
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const requiredFiles = [
    "evidence-pack-validation.json",
    "release-gate.json",
    "backend-ready-signal-v2.json",
    "evidence.md",
    "pr-summary.md"
  ];
  for (const file of requiredFiles) {
    checkRequirement(file, file, await fileExists(join(evidenceDir, file)));
  }

  const validation = missing.includes("evidence-pack-validation.json")
    ? null
    : await readJson(join(evidenceDir, "evidence-pack-validation.json"));
  const releaseGate = missing.includes("release-gate.json") ? null : await readJson(join(evidenceDir, "release-gate.json"));
  const backendReady = missing.includes("backend-ready-signal-v2.json")
    ? null
    : await readJson(join(evidenceDir, "backend-ready-signal-v2.json"));

  if (validation) {
    checkRequirement("evidence-pack-validation.ok=true", "evidence-pack-validation.json", validation.ok === true);
    checkRequirement(
      "evidence-pack-validation.ready_for_release_gate=true",
      "evidence-pack-validation.json",
      validation.ready_for_release_gate === true
    );
    checkRequirement(
      "remote_redacted database evidence",
      "evidence-pack-validation.json",
      validation.database_environment === "remote_redacted"
    );
    checkRequirement(
      "postgres_url database format evidence",
      "evidence-pack-validation.json",
      validation.database_format === "postgres_url"
    );
    checkRequirement(
      "staging_or_preview validation target",
      "evidence-pack-validation.json",
      RELEASE_TARGETS.has(String(validation.target ?? ""))
    );
    checkRequirement(
      "sha256 artifact manifest",
      "evidence-pack-validation.json",
      validation.artifact_manifest_algorithm === "sha256"
    );
  }

  if (releaseGate) {
    checkRequirement("release-gate.ok=true", "release-gate.json", releaseGate.ok === true);
    checkRequirement(
      "release-gate.ready_for_production_review=true",
      "release-gate.json",
      releaseGate.ready_for_production_review === true
    );
    checkRequirement(
      "release-gate remote_redacted database",
      "release-gate.json",
      releaseGate.database_environment === "remote_redacted"
    );
    checkRequirement(
      "release-gate postgres_url database format",
      "release-gate.json",
      releaseGate.database_format === "postgres_url"
    );
    checkRequirement(
      "staging_or_preview release target",
      "release-gate.json",
      RELEASE_TARGETS.has(String(releaseGate.target ?? ""))
    );
    const gates = Array.isArray(releaseGate.gates) ? releaseGate.gates : [];
    for (const gate of REQUIRED_RELEASE_GATE_GATES) {
      checkRequirement(`release-gate.${gate}`, "release-gate.json", gates.includes(gate));
    }
  }

  if (backendReady) {
    checkRequirement(
      "backend-ready-signal-v2.backend_ready_for_signal_v2=true",
      "backend-ready-signal-v2.json",
      backendReady.backend_ready_for_signal_v2 === true
    );
    checkRequirement(
      "backend-ready-signal-v2 identifiers redacted",
      "backend-ready-signal-v2.json",
      backendReady.identifiers_redacted === true
    );
    const llmSpend = Number(backendReady.llm_spend_usd);
    const llmBudget = Number(backendReady.llm_authorized_budget_usd);
    checkRequirement(
      "backend-ready-signal-v2 accounted LLM spend within authorized budget",
      "backend-ready-signal-v2.json",
      Number.isFinite(llmSpend)
      && Number.isFinite(llmBudget)
      && llmSpend >= 0
      && llmBudget >= 0
      && llmSpend <= llmBudget
    );
    checkRequirement(
      "backend-ready-signal-v2 clients not activated",
      "backend-ready-signal-v2.json",
      backendReady.client_activation === false
    );
  }

  if (!missing.includes("evidence.md")) {
    const evidenceMarkdown = await readFile(join(evidenceDir, "evidence.md"), "utf8");
    assertPrSafe("evidence.md", evidenceMarkdown);
    checkRequirement("evidence.md Architecture Decision", "evidence.md", evidenceMarkdown.includes("Architecture Decision"));
    checkRequirement("evidence.md Review Queue", "evidence.md", evidenceMarkdown.includes("Review Queue"));
  }

  if (!missing.includes("pr-summary.md")) {
    const prSummary = await readFile(join(evidenceDir, "pr-summary.md"), "utf8");
    assertPrSafe("pr-summary.md", prSummary);
    checkRequirement("pr-summary title", "pr-summary.md", prSummary.includes("# Noisia Data OS PR Summary"));
    checkRequirement(
      "pr-summary release gate line",
      "pr-summary.md",
      prSummary.includes("Release gate: ready_for_production_review=true")
    );
    checkRequirement(
      "pr-summary release gates checked",
      "pr-summary.md",
      prSummary.includes("Release gates checked:")
    );
    checkRequirement(
      "pr-summary local verifier gate",
      "pr-summary.md",
      prSummary.includes("local_data_os_verify_precheck")
    );
    checkRequirement(
      "pr-summary database format",
      "pr-summary.md",
      prSummary.includes("Database format: postgres_url")
    );
    checkRequirement(
      "pr-summary Signal V2 backend gate",
      "pr-summary.md",
      prSummary.includes("Backend Ready For Signal V2: true")
    );
  }

  if (missing.length > 0) {
    notes.push("Local checks may be green, but the Goal is not complete until this audit is green for a staging/preview pack.");
  }

  const report = {
    ok: true,
    ready_for_goal_completion: missing.length === 0,
    evidence_dir: displayEvidenceDir(repoRoot, evidenceDir),
    missing_evidence: missing,
    requirement_checks: requirementChecks,
    notes,
    pr_safe: true,
    sensitive_output_redacted: true,
    completion_source: "docs/product/26_NOISIA_DATA_OS_COMPLETION_AUDIT.md"
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
