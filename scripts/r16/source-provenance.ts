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

function gitBuffer(repo: string, args: string[], input?: Buffer): Buffer {
  return execFileSync("git", args, { cwd: repo, input, encoding: null, maxBuffer: 128 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"] });
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

/** Builds the expected manifest from immutable Git objects, never from the checkout being measured. */
export function captureR16ExpectedGitProvenanceV1(repo: string, expectedCommit: string) {
  if (!/^[a-f0-9]{40}$/u.test(expectedCommit)) throw new Error("r16_source_expected_commit_invalid");
  const head_sha = git(repo, ["rev-parse", "--verify", `${expectedCommit}^{commit}`]);
  if (head_sha !== expectedCommit) throw new Error("r16_source_expected_commit_mismatch");
  const tree = gitBuffer(repo, ["ls-tree", "-r", "-z", "--full-tree", head_sha, "--", ...sourcePathspecs]);
  const files = tree.toString("utf8").split("\0").filter(Boolean).flatMap(record => {
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("r16_source_git_tree_entry_invalid");
    const [mode, type, oid] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (type !== "blob" || !oid || !sourceExtensions.has(path.slice(path.lastIndexOf(".")))) return [];
    if (mode !== "100644" && mode !== "100755") throw new Error("r16_source_git_tree_mode_invalid");
    return [{ mode, oid, path }];
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!files.length) throw new Error("r16_source_manifest_empty");

  const objects = gitBuffer(repo, ["cat-file", "--batch"], Buffer.from(files.map(file => file.oid).join("\n") + "\n"));
  const manifest: Array<readonly [string, string]> = [];
  let offset = 0;
  for (const file of files) {
    const headerEnd = objects.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error("r16_source_git_object_header_invalid");
    const [oid, type, sizeText] = objects.subarray(offset, headerEnd).toString("ascii").split(" ");
    const size = Number(sizeText);
    if (oid !== file.oid || type !== "blob" || !Number.isSafeInteger(size) || size < 0) {
      throw new Error("r16_source_git_object_header_invalid");
    }
    const start = headerEnd + 1, end = start + size;
    if (end >= objects.length || objects[end] !== 0x0a) throw new Error("r16_source_git_object_body_invalid");
    manifest.push([file.path, sha256(objects.subarray(start, end))]);
    offset = end + 1;
  }
  const source_tree_sha256 = sha256(JSON.stringify(manifest));
  return { head_sha, source_tree_sha256, tree_status_sha256: sha256(""), file_count: files.length,
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
