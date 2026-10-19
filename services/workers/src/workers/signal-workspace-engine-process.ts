import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { signalWorkspaceEmbeddingDigestV1, type SignalWorkspaceEngineInputManifestV1 } from "@noisia/query-engine";
import { assertWorkspaceEngineDirectoryV1, hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";

export type WorkspaceEngineOutputV1 = {
  contract_version: "workspace-topic-engine-output-v1"; workspace_id: string;
  input_manifest_sha256: string; previous_manifest_sha256: string | null;
  input_identity: Record<string, unknown>; config: Record<string, unknown>;
  versions: Record<string, string>; status: "completed" | "insufficient_population";
  counts: { occurrences: number; roots: number; guides: number; common_unchanged_roots: number };
  lanes: Array<{ lane: "open" | "guided"; model_file: string | null; assignments_file: string;
    clusters_file: string; occurrences: number; roots: number; clusters: number }>;
  artifacts: Array<{ file: string; sha256: string; bytes: number }>;
  quality: "uncalibrated"; approval_policy: "none";
};
const fail = (code: string): never => { throw new Error(`workspace_engine_${code}`); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const namePattern = /^[a-z][a-z0-9_.-]{0,100}$/u;

/** Independently verify the subprocess output before storing any model authority. */
export async function validateWorkspaceEngineOutputV1(args: {
  directory: string; storage_root: string; input: SignalWorkspaceEngineInputManifestV1;
  input_manifest_sha256: string; previous_manifest_sha256?: string;
}): Promise<WorkspaceEngineOutputV1> {
  const directory = await assertWorkspaceEngineDirectoryV1(args.directory, args.storage_root);
  const receiptPath = join(directory, "manifest.json");
  const info = await lstat(receiptPath);
  if (!info.isFile() || info.size > 1024 * 1024) return fail("output_manifest_invalid");
  const raw: unknown = JSON.parse(await readFile(receiptPath, "utf8"));
  if (!object(raw) || raw.contract_version !== "workspace-topic-engine-output-v1" || raw.workspace_id !== args.input.workspace_id
    || raw.input_manifest_sha256 !== args.input_manifest_sha256 || raw.previous_manifest_sha256 !== (args.previous_manifest_sha256 ?? null)
    || raw.quality !== "uncalibrated" || raw.approval_policy !== "none"
    || !["completed", "insufficient_population"].includes(String(raw.status))
    || !object(raw.counts) || raw.counts.occurrences !== args.input.records.rows || raw.counts.roots !== args.input.records.roots
    || raw.counts.guides !== args.input.guides.rows || !object(raw.config)
    || signalWorkspaceEmbeddingDigestV1(raw.config) !== signalWorkspaceEmbeddingDigestV1(args.input.config)
    || !object(raw.versions) || !Array.isArray(raw.artifacts) || raw.artifacts.length > 32 || !Array.isArray(raw.lanes)) return fail("output_manifest_invalid");
  if (!object(raw.input_identity) || ["embedding_config_digest", "context_digest", "catalog_digest", "chunk_policy_version"]
    .some(key => (raw.input_identity as Record<string, unknown>)[key] !== args.input[key as keyof typeof args.input])) return fail("output_identity_invalid");
  const names = new Set<string>();
  for (const artifact of raw.artifacts) {
    if (!object(artifact) || typeof artifact.file !== "string" || !namePattern.test(artifact.file)
      || artifact.file.includes("..") || artifact.file === "manifest.json" || names.has(artifact.file)
      || !Number.isSafeInteger(artifact.bytes) || Number(artifact.bytes) < 0
      || typeof artifact.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(artifact.sha256)) return fail("output_artifact_invalid");
    names.add(artifact.file);
    const path = join(directory, artifact.file), stat = await lstat(path);
    if (!stat.isFile() || stat.size !== artifact.bytes || await hashWorkspaceEngineFileV1(path) !== artifact.sha256) return fail("output_artifact_invalid");
  }
  const lanes = new Set<string>();
  for (const lane of raw.lanes) {
    if (!object(lane) || !["open", "guided"].includes(String(lane.lane)) || lanes.has(String(lane.lane))
      || lane.occurrences !== args.input.records.rows || lane.roots !== args.input.records.roots
      || !Number.isSafeInteger(lane.clusters) || Number(lane.clusters) < 0
      || !names.has(String(lane.assignments_file)) || !names.has(String(lane.clusters_file))
      || (lane.model_file !== null && !names.has(String(lane.model_file)))) return fail("output_lane_invalid");
    lanes.add(String(lane.lane));
  }
  if (!lanes.has("open") || raw.lanes.length > 2 || !names.has("roots.jsonl") || !names.has("lineage.json")) return fail("output_coverage_invalid");
  return raw as WorkspaceEngineOutputV1;
}

/** No shell, provider secrets, DB credentials or untrusted log text cross into
 * the numerical subprocess. A failed lease heartbeat stops computation. */
export async function runWorkspaceEngineProcessV1(args: {
  python: string; module_root: string; storage_root: string; input_directory: string; output_directory: string;
  mode?: "full_fit" | "incremental_numeric";
  previous?: { directory: string; manifest_sha256: string };
  timeout_ms?: number; heartbeat?: () => Promise<void>;
}): Promise<void> {
  const mode = args.mode === undefined ? "full_fit" : args.mode;
  if (mode !== "full_fit" && mode !== "incremental_numeric") return fail("mode_invalid");
  if (mode === "incremental_numeric" && (!object(args.previous)
    || typeof args.previous.directory !== "string" || !isAbsolute(args.previous.directory)
    || typeof args.previous.manifest_sha256 !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(args.previous.manifest_sha256))) return fail("previous_invalid");
  if (!isAbsolute(args.python) || !isAbsolute(args.module_root)) return fail("runtime_path_invalid");
  // Preserve the venv executable spelling: resolving its symlink before spawn
  // would silently select the base interpreter without the installed runtime.
  await realpath(args.python);
  const python = args.python, moduleRoot = await realpath(args.module_root);
  const storageRoot = await realpath(args.storage_root);
  await assertWorkspaceEngineDirectoryV1(args.input_directory, storageRoot);
  const outputParent = await realpath(dirname(args.output_directory));
  const parentRelative = relative(storageRoot, outputParent);
  if (!isAbsolute(args.output_directory) || parentRelative.startsWith("..") || isAbsolute(parentRelative)
    || !namePattern.test(basename(args.output_directory))) return fail("storage_path_invalid");
  if (args.previous) {
    const previousDirectory = await assertWorkspaceEngineDirectoryV1(args.previous.directory, storageRoot);
    if (mode === "incremental_numeric" && !(await lstat(previousDirectory)).isDirectory()) return fail("previous_invalid");
  }
  const moduleName = mode === "incremental_numeric"
    ? "signal_semantic_lab.workspace_incremental_engine" : "signal_semantic_lab.workspace_engine";
  const argv = ["-m", moduleName, "--input-dir", args.input_directory,
    "--output-dir", args.output_directory, "--storage-root", storageRoot];
  if (args.previous) argv.push("--previous-dir", args.previous.directory, "--previous-manifest-sha256", args.previous.manifest_sha256);
  const timeout = args.timeout_ms ?? 60 * 60 * 1000;
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 12 * 60 * 60 * 1000) return fail("timeout_invalid");
  await args.heartbeat?.();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, argv, { cwd: moduleRoot, shell: false, env: {
      PATH: dirname(python), LANG: "C.UTF-8", PYTHONPATH: moduleRoot, PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1", NUMBA_NUM_THREADS: "1", OMP_NUM_THREADS: "1",
      OPENBLAS_NUM_THREADS: "1", MKL_NUM_THREADS: "1", TOKENIZERS_PARALLELISM: "false",
      HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1"
    }, stdio: ["ignore", "pipe", "pipe"] });
    let stopped = false, heartbeatPending = false, forced: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { if (stopped) return; stopped = true; child.kill("SIGTERM");
      forced = setTimeout(() => child.kill("SIGKILL"), 5000); forced.unref(); };
    const timer = setTimeout(stop, timeout);
    const heartbeat = setInterval(() => {
      if (heartbeatPending || stopped) return;
      heartbeatPending = true;
      Promise.resolve(args.heartbeat?.()).catch(stop).finally(() => { heartbeatPending = false; });
    }, 15000);
    // Consume both streams without retaining raw text or allowing pipe backpressure.
    child.stdout.resume(); child.stderr.resume();
    child.once("error", () => { stopped = true; });
    child.once("close", (code) => {
      clearTimeout(timer); clearInterval(heartbeat); if (forced) clearTimeout(forced);
      if (stopped || code !== 0) reject(new Error("workspace_engine_process_failed")); else resolve();
    });
  });
  await args.heartbeat?.();
}
