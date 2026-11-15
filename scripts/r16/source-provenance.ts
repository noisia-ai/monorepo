import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePathspecs = ["infrastructure/db", "services/workers/src/providers", "services/workers/src/workers",
  "packages/query-engine/src", "scripts/r16", ".github/workflows/r16-h1-benchmark.yml"];
const sourceExtensions = new Set([".cjs", ".js", ".json", ".mjs", ".sh", ".sql", ".ts", ".tsx", ".yaml", ".yml"]);

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Hashes the exact source tree used by the local test run, including dirty and untracked source files. */
export async function captureR16SourceProvenanceV1(repo: string) {
  const tracked = git(repo, ["ls-files", "-z", "--", ...sourcePathspecs]).split("\0").filter(Boolean);
  const untracked = git(repo, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...sourcePathspecs])
    .split("\0").filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])].filter(path => sourceExtensions.has(path.slice(path.lastIndexOf(".")))).sort();
  if (!files.length) throw new Error("r16_source_manifest_empty");
  const manifest = [];
  for (const path of files) manifest.push([path, sha256(await readFile(resolve(repo, path)))] as const);
  const head_sha = git(repo, ["rev-parse", "HEAD"]);
  const source_tree_sha256 = sha256(JSON.stringify(manifest));
  const tree_status = git(repo, ["status", "--porcelain=v1", "--untracked-files=all", "--", ...sourcePathspecs]);
  const tree_status_sha256 = sha256(tree_status);
  return { head_sha, source_tree_sha256, tree_status_sha256, file_count: files.length,
    file_manifest: manifest.map(([path, digest]) => ({ path, sha256: digest })) };
}

export function r16PolicyConfigurationDigestV1(args: { action: string; configuration: unknown;
  configuration_digest: string; model: string; policy_daily_cap_micro_usd: number | string;
  policy_digest: string; policy_max_execution_micro_usd: number | string; policy_version_id: string; provider: string }): string {
  // Fingerprint the stable action/provider configuration. The native policy digest
  // is recorded separately because it includes per-clone policy-version metadata.
  return sha256(JSON.stringify({ action: args.action, configuration: args.configuration,
    configuration_digest: args.configuration_digest, model: args.model, provider: args.provider }));
}
