import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runWorkspaceEngineProcessV1 } from "./signal-workspace-engine-process";

type Args = Parameters<typeof runWorkspaceEngineProcessV1>[0];
const parentHash = `sha256:${"a".repeat(64)}`;
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "noisia-engine-process-")));
  const moduleRoot = join(directory, "modules"), storage = join(directory, "storage");
  const input = join(storage, "input"), previous = join(storage, "previous"), output = join(storage, "output");
  await mkdir(storage);
  await Promise.all([mkdir(moduleRoot), mkdir(input), mkdir(previous)]);
  const python = join(directory, "fake-python");
  // Real executable and pipes, isolated from Python packages/algorithms/providers.
  await writeFile(python, `#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
const input = argv[argv.indexOf("--input-dir") + 1];
const output = argv[argv.indexOf("--output-dir") + 1];
const behavior = JSON.parse(fs.readFileSync(input + "/behavior.json", "utf8"));
fs.writeFileSync(output + ".receipt.json", JSON.stringify({ argv, cwd: process.cwd(), pid: process.pid,
  envKeys: Object.keys(process.env).sort(), path: process.env.PATH, pythonpath: process.env.PYTHONPATH,
  offline: [process.env.HF_HUB_OFFLINE, process.env.TRANSFORMERS_OFFLINE],
  threads: [process.env.NUMBA_NUM_THREADS, process.env.OMP_NUM_THREADS, process.env.OPENBLAS_NUM_THREADS, process.env.MKL_NUM_THREADS] }));
if (behavior === "fail") {
  process.stdout.write("untrusted subprocess stdout"); process.stderr.write("untrusted subprocess stderr"); process.exit(17);
} else if (behavior === "wait") {
  process.on("SIGTERM", () => { fs.writeFileSync(output + ".stopped", "SIGTERM"); process.exit(0); });
  setInterval(() => {}, 1000);
}
`, { mode: 0o700 });
  await writeFile(join(input, "behavior.json"), JSON.stringify("success"));
  const args: Args = { python, module_root: moduleRoot, storage_root: storage,
    input_directory: input, output_directory: output, timeout_ms: 30000 };
  return { directory, args, previous: { directory: previous, manifest_sha256: parentHash },
    behavior: (value: string) => writeFile(join(input, "behavior.json"), JSON.stringify(value)),
    receipt: async () => JSON.parse(await readFile(`${output}.receipt.json`, "utf8")) as {
      argv: string[]; cwd: string; pid: number; envKeys: string[]; path: string; pythonpath: string;
      offline: string[]; threads: string[];
    },
    notSpawned: () => assert.rejects(readFile(`${output}.receipt.json`), { code: "ENOENT" }),
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("default and explicit full-fit preserve the exact module and optional previous arguments", async () => {
  const f = await fixture();
  try {
    let heartbeats = 0;
    await runWorkspaceEngineProcessV1({ ...f.args, heartbeat: async () => { heartbeats++; } });
    const expected = ["-m", "signal_semantic_lab.workspace_engine", "--input-dir", f.args.input_directory,
      "--output-dir", f.args.output_directory, "--storage-root", f.args.storage_root];
    assert.deepEqual((await f.receipt()).argv, expected);
    assert.equal(heartbeats, 2);
    await runWorkspaceEngineProcessV1({ ...f.args, mode: "full_fit", previous: f.previous });
    assert.deepEqual((await f.receipt()).argv, [...expected, "--previous-dir", f.previous.directory,
      "--previous-manifest-sha256", parentHash]);
  } finally { await f.cleanup(); }
});

test("incremental dispatch uses only the closed module, exact parent and isolated environment", async () => {
  const f = await fixture();
  const keys = ["ANTHROPIC_API_KEY", "VOYAGE_API_KEY", "DATABASE_URL", "NODE_OPTIONS", "NOISIA_PROCESS_TEST_SECRET"];
  const original = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = "local-test-value-must-not-reach-child";
    await runWorkspaceEngineProcessV1({ ...f.args, mode: "incremental_numeric", previous: f.previous });
    const receipt = await f.receipt();
    assert.deepEqual(receipt.argv, ["-m", "signal_semantic_lab.workspace_incremental_engine", "--input-dir", f.args.input_directory,
      "--output-dir", f.args.output_directory, "--storage-root", f.args.storage_root,
      "--previous-dir", f.previous.directory, "--previous-manifest-sha256", parentHash]);
    assert.equal(receipt.cwd, f.args.module_root);
    assert.equal(receipt.path, dirname(f.args.python));
    assert.equal(receipt.pythonpath, f.args.module_root);
    assert.deepEqual(receipt.offline, ["1", "1"]);
    assert.deepEqual(receipt.threads, ["1", "1", "1", "1"]);
    for (const key of keys) assert.equal(receipt.envKeys.includes(key), false, key);
  } finally {
    keys.forEach((key, index) => { if (original[index] === undefined) delete process.env[key]; else process.env[key] = original[index]; });
    await f.cleanup();
  }
});

test("unknown modes and absent or malformed incremental parent fail before heartbeat/spawn", async () => {
  const f = await fixture();
  try {
    let heartbeats = 0;
    const args = { ...f.args, heartbeat: async () => { heartbeats++; } };
    for (const mode of ["unexpected.module", "", null, false]) {
      await assert.rejects(runWorkspaceEngineProcessV1({ ...args, mode } as unknown as Args), /workspace_engine_mode_invalid/u);
    }
    for (const previous of [undefined, null, {}, { ...f.previous, manifest_sha256: "sha256:wrong" },
      { ...f.previous, manifest_sha256: `sha256:${"A".repeat(64)}` }, { ...f.previous, directory: "../previous" }]) {
      await assert.rejects(runWorkspaceEngineProcessV1({ ...args, mode: "incremental_numeric", previous } as unknown as Args),
        /workspace_engine_previous_invalid/u);
    }
    assert.equal(heartbeats, 0); await f.notSpawned();
  } finally { await f.cleanup(); }
});

test("incremental parent cannot escape storage or be a file", async () => {
  const f = await fixture();
  try {
    const escape = join(f.args.storage_root, "escape");
    await symlink(f.args.module_root, escape);
    await assert.rejects(runWorkspaceEngineProcessV1({ ...f.args, mode: "incremental_numeric",
      previous: { ...f.previous, directory: escape } }), /workspace_engine_storage_path_invalid/u);
    const file = join(f.args.storage_root, "not-directory"); await writeFile(file, "test");
    await assert.rejects(runWorkspaceEngineProcessV1({ ...f.args, mode: "incremental_numeric",
      previous: { ...f.previous, directory: file } }), /workspace_engine_previous_invalid/u);
    await f.notSpawned();
  } finally { await f.cleanup(); }
});

test("nonzero subprocess exit becomes the stable error without exposing its output", async () => {
  const f = await fixture();
  try {
    await f.behavior("fail");
    await assert.rejects(runWorkspaceEngineProcessV1({ ...f.args, mode: "incremental_numeric", previous: f.previous }),
      { message: "workspace_engine_process_failed" });
    assert.ok((await f.receipt()).pid > 0);
  } finally { await f.cleanup(); }
});

test("timeout stops a real child even when SIGTERM handler exits successfully", async () => {
  const f = await fixture();
  try {
    await f.behavior("wait");
    await assert.rejects(runWorkspaceEngineProcessV1({ ...f.args, mode: "incremental_numeric", previous: f.previous, timeout_ms: 1000 }),
      { message: "workspace_engine_process_failed" });
    assert.equal(await readFile(`${f.args.output_directory}.stopped`, "utf8"), "SIGTERM");
  } finally { await f.cleanup(); }
});

test("lost lease heartbeat stops the running incremental child instead of accepting its exit", { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    await f.behavior("wait"); let heartbeats = 0;
    await assert.rejects(runWorkspaceEngineProcessV1({ ...f.args, mode: "incremental_numeric", previous: f.previous,
      heartbeat: async () => { if (++heartbeats > 1) throw new Error("local lease lost"); } }),
    { message: "workspace_engine_process_failed" });
    assert.equal(heartbeats, 2);
    assert.equal(await readFile(`${f.args.output_directory}.stopped`, "utf8"), "SIGTERM");
  } finally { await f.cleanup(); }
});
