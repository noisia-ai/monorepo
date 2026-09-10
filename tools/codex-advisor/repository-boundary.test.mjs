import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolRoot, "../..");
const canonicalBoundaryPath = "tools/codex-advisor/credential-lane.mjs";
const advisorEnvironmentName = "NOISIA_CODEX_ADVISOR_ANTHROPIC_API_KEY";
const productEnvironmentName = "ANTHROPIC_API_KEY";
const standaloneProductEnvironmentName = new RegExp(
  `(?<![A-Z0-9_])${productEnvironmentName}(?![A-Z0-9_])`,
  "u"
);
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

function filesRecursively(directory) {
  return readdirSync(resolve(repositoryRoot, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${directory}/${entry.name}`;
      return entry.isDirectory() ? filesRecursively(relativePath) : [relativePath];
    });
}

function sourceFilesRecursively(directory) {
  return filesRecursively(directory).filter((file) => sourceExtensions.has(extname(file)));
}

function source(file) {
  return readFileSync(resolve(repositoryRoot, file), "utf8");
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  }).split("\0").filter(Boolean);
}

test("active Advisor source has no product credential literal or implicit environment loader", () => {
  const activeAdvisorSources = sourceFilesRecursively("tools/codex-advisor")
    .filter((file) => !file.endsWith(".test.mjs"));

  assert.ok(activeAdvisorSources.includes(canonicalBoundaryPath));
  for (const file of activeAdvisorSources) {
    const value = source(file);
    assert.doesNotMatch(value, standaloneProductEnvironmentName, file);
    assert.doesNotMatch(value, /(?:dotenv|process\.loadEnvFile|--env-file)/u, file);
    assert.doesNotMatch(value, /apps\/studio\/\.env\.local|services\/workers\/\.env/u, file);
    assert.doesNotMatch(value, /(?:readFile|readFileSync)\s*\(/u, file);
  }
});

test("future tracked Advisor runners must use the canonical development boundary", () => {
  const candidates = trackedFiles().filter((file) => {
    if (!sourceExtensions.has(extname(file))) return false;
    if (file.startsWith("apps/") || file.startsWith("services/")
        || file.startsWith("packages/") || file.startsWith("infrastructure/")) return false;
    if (file.endsWith(".test.mjs") || file === canonicalBoundaryPath) return false;
    const value = source(file);
    return /advisor/iu.test(file) || /claude-fable-5|api\.anthropic\.com\/v1\/messages/iu.test(value);
  });

  for (const file of candidates) {
    const value = source(file);
    assert.match(value, /codex-advisor\/credential-lane\.mjs|\.\/credential-lane\.mjs/u, file);
    assert.doesNotMatch(value, standaloneProductEnvironmentName, file);
    assert.doesNotMatch(value, /apps\/studio\/\.env\.local|services\/workers\/\.env/u, file);
  }
});

test("product code cannot reference the Advisor credential or development helper", () => {
  const productRoots = [
    "apps/studio/src",
    "apps/studio/scripts",
    "services/workers/src",
    "services/workers/scripts",
    "packages",
    "infrastructure"
  ];
  const productFiles = productRoots.flatMap(sourceFilesRecursively);

  for (const file of productFiles) {
    const value = source(file);
    assert.doesNotMatch(value, new RegExp(advisorEnvironmentName, "u"), file);
    assert.doesNotMatch(value, /tools\/codex-advisor|@noisia\/codex-advisor|credential-lane\.mjs/u, file);
  }
});

test("Studio browser and server bundles have no Advisor development dependency", () => {
  const studioSources = sourceFilesRecursively("apps/studio/src");
  for (const file of studioSources) {
    const value = source(file);
    assert.doesNotMatch(value, new RegExp(advisorEnvironmentName, "u"), file);
    assert.doesNotMatch(value, /codex-advisor|credential-lane\.mjs/u, file);
  }

  const workspace = readFileSync(resolve(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  assert.doesNotMatch(workspace, /tools\/\*|tools\/codex-advisor/u);
});

test("canonical boundary is config-only and contains no provider transport", () => {
  const value = source(canonicalBoundaryPath);
  assert.doesNotMatch(value, /fetch\s*\(|api\.anthropic\.com|@ai-sdk\/anthropic|@anthropic-ai/u);
  assert.match(value, /createTransport/u);
  assert.match(value, /advisor_product_credential_collision/u);
});
