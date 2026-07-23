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
const REQUIRED_PR_SUMMARY_RELEASE_GATES = ["local_data_os_verify_precheck"];

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(filePath: string) {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) fail(`${filePath} must contain a JSON object.`);
  return parsed;
}

async function fileExists(filePath: string) {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

function displayEvidenceDir(repoRoot: string, evidenceDir: string) {
  const relativePath = relative(repoRoot, evidenceDir);
  if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return relativePath;
  }
  return "external_path_redacted";
}

function readReadmeTarget(readme: string) {
  const match = readme.match(/^Target:\s*([a-z-]+)/m);
  return match?.[1] ?? "missing";
}

function sanitizeScalar(value: unknown) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "missing";
}

function assertPrSafe(contents: string) {
  if (UUID_PATTERN.test(contents)) fail("PR summary must not include corpus, output, brand, tag or assertion UUID values.");
  for (const item of SENSITIVE_ARTIFACT_PATTERNS) {
    if (item.pattern.test(contents)) fail(`PR summary must not include ${item.label}.`);
  }
}

async function main() {
  const repoRoot = resolve(process.cwd(), "../..");
  const explicit = process.argv[2] ?? process.env.NOISIA_DATA_OS_EVIDENCE_PACK_DIR;
  if (!explicit) fail("Set NOISIA_DATA_OS_EVIDENCE_PACK_DIR or pass an evidence pack directory path.");

  const evidenceDir = resolve(repoRoot, explicit);
  const readme = await readFile(join(evidenceDir, "README.md"), "utf8");
  const evidenceMarkdown = await readFile(join(evidenceDir, "evidence.md"), "utf8");
  const validation = await readJson(join(evidenceDir, "evidence-pack-validation.json"));
  const backendReady = await readJson(join(evidenceDir, "backend-ready-signal-v2.json"));
  const releaseGatePath = join(evidenceDir, "release-gate.json");
  const releaseGate = (await fileExists(releaseGatePath)) ? await readJson(releaseGatePath) : null;
  const artifactManifest = Array.isArray(validation.artifact_manifest) ? validation.artifact_manifest : [];
  const releaseGates = releaseGate && Array.isArray(releaseGate.gates)
    ? releaseGate.gates.map(String)
    : [];
  if (releaseGate?.ready_for_production_review === true) {
    if (validation.database_format !== "postgres_url") {
      fail("Validated staging evidence is missing database_format=postgres_url.");
    }
    if (releaseGate.database_format !== "postgres_url") {
      fail("Release gate is missing database_format=postgres_url.");
    }
    for (const gate of REQUIRED_PR_SUMMARY_RELEASE_GATES) {
      if (!releaseGates.includes(gate)) fail(`Release gate is missing required PR summary gate: ${gate}.`);
    }
    if (backendReady.backend_ready_for_signal_v2 !== true) {
      fail("PR summary requires backend_ready_for_signal_v2=true.");
    }
  }
  const releaseLine = releaseGate
    ? `Release gate: ready_for_production_review=${sanitizeScalar(releaseGate.ready_for_production_review)}`
    : "Release gate: not present for this target";
  const releaseGateLine = releaseGates.length > 0
    ? `Release gates checked: ${releaseGates.join(", ")}`
    : "Release gates checked: not present";

  const summary = [
    "# Noisia Data OS PR Summary",
    "",
    `Evidence pack: \`${displayEvidenceDir(repoRoot, evidenceDir)}\``,
    `Target: ${readReadmeTarget(readme)}`,
    `Database environment: ${sanitizeScalar(validation.database_environment)}`,
    `Database format: ${sanitizeScalar(validation.database_format)}`,
    `Candidates checked: ${sanitizeScalar(validation.candidates_checked)}`,
    `Validation: ready_for_release_gate=${sanitizeScalar(validation.ready_for_release_gate)}`,
    releaseLine,
    `Backend Ready For Signal V2: ${sanitizeScalar(backendReady.backend_ready_for_signal_v2)}`,
    `Artifacts checksummed: ${artifactManifest.length}`,
    `Artifact manifest algorithm: ${sanitizeScalar(validation.artifact_manifest_algorithm)}`,
    releaseGateLine,
    "",
    "## PR-Safe Evidence",
    "",
    evidenceMarkdown.trim(),
    "",
    "## Do Not Paste",
    "",
    "- Do not paste raw `shadow-run.log`, `analyze.json` or `evidence.json` if they contain UUIDs.",
    "- Keep raw machine artifacts inside `.data` for local audit and checksum verification.",
    ""
  ].join("\n");

  assertPrSafe(summary);
  console.log(summary);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
