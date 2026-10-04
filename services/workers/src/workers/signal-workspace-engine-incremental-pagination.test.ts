import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 as config, SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1 as policy,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile, signalWorkspaceIncrementalDigestV1 as digest } from "@noisia/query-engine";
import type { SignalWorkspaceEngineLeaseV1 as Lease, SignalWorkspaceIncrementalDescriptorV1 as Descriptor } from "@noisia/db";
import { runSignalWorkspaceIncrementalJobV1 as run, type WorkspaceIncrementalJobOptionsV1 as Options } from "./signal-workspace-engine-incremental";
import { spoolSignalWorkspaceEngineInputV1 } from "./signal-workspace-engine-files";

type Stores = NonNullable<Options["stores"]>;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
async function* pages<T>(rows: T[]) { yield rows; }

/** Runs the actual Worker through its durable input boundary. Parent bytes and
 * database/storage are synthetic; no Python, model inference or provider runs. */
async function pagination(total: number, oversized?: "chunks" | "roots") {
  const scratch = await mkdtemp(join(tmpdir(), "mfp-incremental-pages-"));
  const chunks = Array.from({ length: total }, (_, index) => {
    const text = `Pagination fixture ${index}`;
    return { root_id: id(index + 1), root_fingerprint: sha(`root:${index}`), asset_sha256: sha(text),
      expected_chunks: 1, chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text), text,
      vector: Array.from({ length: 1024 }, (_, i) => Number(i === 0)) };
  });
  const roots = chunks.map(row => ({ root_id: row.root_id, root_fingerprint: row.root_fingerprint, asset_sha256: row.asset_sha256,
    expected_chunks: 1, chunk_coverage_digest: sha(JSON.stringify([0, 0, row.end, row.chunk_sha256]) + "\n"), correction_digest: sha("") }));
  const seed = join(scratch, "seed");
  await spoolSignalWorkspaceEngineInputV1({ storage_root: scratch, directory: seed,
    snapshot: { workspace_id: id(900), input_revision: 1, preparation_run_id: id(901), embedding_run_id: id(902),
      embedding_config_digest: sha("embedding"), context_digest: sha("context"), catalog_digest: sha("catalog"),
      chunk_policy_version: "corpus-text-chunks-v1", roots: 1, chunks: 1, guides: 0, dimensions: 1024, config },
    chunks: pages(chunks.slice(0, 1)), guides: pages([]) });
  const objects = new Map<string, Buffer>([["population.jsonl", Buffer.alloc(0)], ["roots.jsonl", Buffer.alloc(0)],
    ["guides.jsonl", Buffer.alloc(0)], ["guide-vectors.npy", await readFile(join(seed, "guide-vectors.npy"))]]);
  const versions = { runtime: "pagination-contract-fixture" };
  const manifest = { contract_version: "workspace-topic-engine-output-v1", workspace_id: id(900), status: "insufficient_population",
    quality: "uncalibrated", approval_policy: "none", config, versions, counts: { roots: 0, occurrences: 0 }, lanes: [],
    input_identity: { embedding_config_digest: sha("embedding"), context_digest: sha("context"), catalog_digest: sha("catalog"), chunk_policy_version: "corpus-text-chunks-v1" },
    artifacts: [...objects].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: sha(bytes) })) };
  objects.set("manifest.json", Buffer.from(JSON.stringify(manifest) + "\n"));
  const body = { contract_version: "workspace-incremental-numeric-descriptor-v1" as const, mode: "frozen-model-delta" as const, policy_version: policy,
    parent: { execution_id: id(910), output_artifact_id: id(911), manifest_sha256: sha(objects.get("manifest.json")!), manifest_contract: "workspace-topic-engine-output-v1" as const,
      checkpoint_digest: sha("checkpoint"), model_version_id: id(912), model_bank_artifact_id: id(913) },
    compatibility: { embedding_config_digest: sha("embedding"), context_digest: sha("context"), input_interest_catalog_digest: sha("catalog"),
      chunk_policy_version: "corpus-text-chunks-v1" as const, fit_config_digest: digest(config), runtime_digest: digest(versions),
      guides_digest: digest({ rows: [], vectors: sha(objects.get("guide-vectors.npy")!) }) },
    discovery: { close_requested: false, residual_root_ids: roots.map(row => row.root_id) }, root_correction_epoch: sha("epoch"), editorial_cut: { unit_count: 0, unit_digest: sha("") } };
  const descriptor: Descriptor = { ...body, descriptor_digest: digest(body) };
  const lease: Lease = { execution_id: id(920), workspace_id: id(900), execution_token: id(921), input_digest: sha("input"),
    snapshot: { contract_version: "workspace-topic-engine-v1", workspace_id: id(900), taxonomy_profile_id: id(922), preparation_run_id: id(901), embedding_run_id: id(902),
      input_revision: "2", embedding_profile: { ...profile, config_digest: sha("embedding") }, context_digest: sha("context"), catalog_digest: sha("catalog"),
      prototype_plan_digest: sha("prototype"), expected_roots: total, expected_chunks: total, expected_guides: 0, parent_execution_id: id(910), context_refs: [],
      engine_config: config, claude_cap_micro_usd: 0, numeric_descriptor: descriptor,
      discovery_population: { root_ids: roots.map(row => row.root_id), eligible_relevant_roots: total, sample_cap: null, seed: "test", stratification: "utc_day_platform" } } };
  const observed = { chunks: [] as number[], roots: [] as number[], input: 0, process: 0 };
  // Only these stores are reachable before the deliberately stopped input boundary.
  const stores: Partial<Stores> = {
    checkpoint: async () => ({ input_artifact: null, output_index_artifact: null, numeric_checkpoint: null }), heartbeat: async () => undefined, fail: async () => undefined,
    parent: async () => ({ items: [...objects].map(([name, bytes], i) => ({ artifact_id: id(950+i), owner_execution_id: id(910), artifact_key: name,
      storage_key: name, sha256: sha(bytes), size_bytes: bytes.length, media_type: "application/octet-stream", metadata: {} })), next_cursor: null, done: true }),
    chunks: async args => { assert.equal(args.limit, 200); const remaining = chunks.filter(row => !args.after || row.root_id > args.after.root_id);
      const selected = remaining.slice(0, oversized === "chunks" ? 201 : args.limit); observed.chunks.push(selected.length);
      const items = selected.map(({ expected_chunks, ...row }) => ({ ...row, expected_root_chunks: expected_chunks }));
      return { items, next_cursor: items.length ? { root_id: items.at(-1)!.root_id, chunk_index: 0 } : args.after, done: remaining.length === items.length }; },
    guides: async () => ({ items: [], next_cursor: null, done: true }),
    roots: async args => { assert.equal(args.limit, 200); const remaining = roots.filter(row => !args.after_root_id || row.root_id > args.after_root_id);
      const items = remaining.slice(0, oversized === "roots" ? 201 : args.limit); observed.roots.push(items.length);
      return { items, next_cursor: items.at(-1)?.root_id ?? null, done: remaining.length === items.length }; },
    input: async args => { observed.input++; assert.equal(args.roots_count, total); assert.equal(args.chunks_count, total);
      const current = args.input_files.find(ref => ref.name === "current-roots.jsonl")!;
      const actual = objects.get(current.storage_key)!.toString().trim().split("\n").map(line => JSON.parse(line));
      assert.deepEqual(actual, roots); assert.deepEqual(args.input.discovery.residual_root_ids, roots.map(row => row.root_id));
      throw new Error("workspace_engine_pagination_boundary_reached"); }
  };
  try {
    await assert.rejects(run({ database: {} as Parameters<typeof run>[0]["database"], lease,
      job: { id: "pagination", data: { execution_id: lease.execution_id }, updateProgress: async () => undefined } }, {
      stores: stores as Stores, storage_root: scratch, process: async () => { observed.process++; assert.fail("Python forbidden"); },
      storage: { get: async args => { await writeFile(args.destination, objects.get(args.stored.storage_key)!); },
        put: async args => { const bytes = await readFile(args.file), key = `input/${basename(args.file)}`; objects.set(key, bytes);
          return { storage_key: key, sha256: sha(bytes), size_bytes: bytes.length, media_type: args.media_type }; } }
    }), oversized ? /workspace_engine_incremental_page_stalled/ : /workspace_engine_pagination_boundary_reached/);
    assert.equal(observed.input, oversized ? 0 : 1); assert.equal(observed.process, 0);
    assert.deepEqual(await readdir(scratch), ["seed"], "Worker removes its temporary attempt after the boundary");
    return observed;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

for (const total of [129, 201]) test(`MFP incremental Worker exports ${total} roots through real input preparation with pages of up to 200`, async () => {
  const result = await pagination(total), expected = total === 129 ? [129] : [200, 1];
  assert.deepEqual(result.chunks, expected); assert.deepEqual(result.roots, expected);
});
for (const oversized of ["chunks", "roots"] as const) test(`MFP incremental Worker rejects a ${oversized} page beyond its requested 200`, async () => {
  await pagination(201, oversized);
});
