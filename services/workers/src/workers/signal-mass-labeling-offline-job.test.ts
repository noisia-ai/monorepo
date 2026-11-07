import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  SIGNAL_WORKSPACE_MASS_LABELING_INTERPRETATION_CONFIGURATION_V1,
  signalWorkspaceMassLabelingConfigV1,
} from "@noisia/query-engine";
import type { SignalWorkspaceEngineLeaseV1 } from "@noisia/db";
import { spoolSignalWorkspaceEngineInputV1 } from "./signal-workspace-engine-files";
import { signalWorkspaceEngineJobV1 } from "./signal-workspace-engine";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (bytes: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("default interpreter stays offline with a valid pilot bundle and enabled provider environment", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mass-offline-job-"));
  const oldKey = process.env.ANTHROPIC_API_KEY,
    oldFlag = process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED;
  process.env.ANTHROPIC_API_KEY = "synthetic-enabled-environment-key";
  process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED = "true";
  let fetches = 0,
    reservations = 0,
    numericalCalls = 0,
    paused = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetches++;
    throw Error("offline job reached provider");
  });
  try {
    const config = signalWorkspaceMassLabelingConfigV1(40);
    const lease: SignalWorkspaceEngineLeaseV1 = {
      execution_id: id(1),
      workspace_id: id(2),
      execution_token: id(3),
      input_digest: sha("input"),
      snapshot: {
        contract_version: "workspace-topic-engine-v1",
        workspace_id: id(2),
        taxonomy_profile_id: id(4),
        preparation_run_id: id(5),
        embedding_run_id: id(6),
        input_revision: "1",
        embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
        context_digest: sha("context"),
        catalog_digest: sha("catalog"),
        prototype_plan_digest: sha("guides"),
        expected_roots: 40,
        expected_chunks: 40,
        expected_guides: 0,
        parent_execution_id: null,
        context_refs: [],
        engine_config: config,
        claude_cap_micro_usd: 1_000_000,
        interpretation_config: {
          call_configuration:
            SIGNAL_WORKSPACE_MASS_LABELING_INTERPRETATION_CONFIGURATION_V1,
          budget_timezone: "UTC",
          daily_cap_micro_usd: 1_000_000,
        },
      },
    };
    const vector = Array.from({ length: 1024 }, (_, n) => (n === 0 ? 1 : 0));
    const chunks = Array.from({ length: 40 }, (_, n) => {
      const text = `Conversa sintética sobre cerveja ${n}`;
      return {
        root_id: id(100 + n),
        root_fingerprint: sha(`root${n}`),
        asset_sha256: sha(text),
        expected_root_chunks: 1,
        chunk_index: 0,
        start: 0,
        end: text.length,
        chunk_sha256: sha(text),
        text,
        vector,
      };
    });
    const inputDir = join(root, "sealed-input");
    const input = await spoolSignalWorkspaceEngineInputV1({
      storage_root: root,
      directory: inputDir,
      snapshot: {
        workspace_id: lease.workspace_id,
        input_revision: 1,
        preparation_run_id: lease.snapshot.preparation_run_id,
        embedding_run_id: lease.snapshot.embedding_run_id,
        embedding_config_digest: lease.snapshot.embedding_profile.config_digest,
        context_digest: lease.snapshot.context_digest,
        catalog_digest: lease.snapshot.catalog_digest,
        chunk_policy_version: "corpus-text-chunks-v1",
        roots: 40,
        chunks: 40,
        guides: 0,
        dimensions: 1024,
        config,
      },
      chunks: (async function* () {
        yield chunks.map((c) => ({ ...c, expected_chunks: 1 }));
      })(),
      guides: (async function* () {})(),
    });
    const manifestBytes = await readFile(join(inputDir, "manifest.json"));
    const source = (await readFile(join(inputDir, "chunks.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const assigned = source.map((row) => ({
      ordinal: row.ordinal,
      root_id: row.root_id,
      chunk_index: row.chunk_index,
      start: row.start,
      end: row.end,
      chunk_sha256: row.chunk_sha256,
      local_label: 0,
      stable_cluster_id: "synthetic",
      strength: 0.9,
    }));
    const representatives = [...assigned.slice(0, 29), assigned[39]!].map(
      (row, n) => ({
        ...row,
        selection_reason:
          n === 29 ? "low_affiliation_boundary" : "high_affiliation",
      }),
    );
    const bodies: Record<string, string> = {
      "assignments.open.jsonl": assigned
        .map((row) => JSON.stringify(row) + "\n")
        .join(""),
      "clusters.open.json": JSON.stringify([
        {
          stable_cluster_id: "synthetic",
          local_label: 0,
          lane: "open",
          root_count: 40,
          chunk_count: 40,
          terms: ["cerveja"],
          representative_selection_policy:
            "distinct-roots-affiliation-boundary-v1",
          representatives,
        },
      ]),
      "model.open.joblib": "synthetic model marker; never deserialize",
      "roots.jsonl": source
        .map((row) => JSON.stringify({ root_id: row.root_id }) + "\n")
        .join(""),
      "lineage.json": "[]",
    };
    const artifactFiles = Object.entries(bodies).map(([file, body]) => ({
      file,
      sha256: sha(body),
      bytes: Buffer.byteLength(body),
    }));
    const inputIdentity = {
      embedding_config_digest: input.embedding_config_digest,
      context_digest: input.context_digest,
      catalog_digest: input.catalog_digest,
      chunk_policy_version: input.chunk_policy_version,
    };
    const output = {
      contract_version: "workspace-topic-engine-output-v1",
      workspace_id: input.workspace_id,
      input_manifest_sha256: sha(manifestBytes),
      previous_manifest_sha256: null,
      input_identity: inputIdentity,
      config,
      versions: { fixture: "sealed bundle" },
      status: "completed",
      counts: {
        occurrences: 40,
        roots: 40,
        guides: 0,
        common_unchanged_roots: 0,
      },
      lanes: [
        {
          lane: "open",
          assignments_file: "assignments.open.jsonl",
          clusters_file: "clusters.open.json",
          model_file: "model.open.joblib",
          occurrences: 40,
          roots: 40,
          clusters: 1,
          outlier_occurrences: 0,
        },
      ],
      artifacts: artifactFiles,
      quality: "uncalibrated",
      approval_policy: "none",
    };
    bodies["manifest.json"] = JSON.stringify(output);
    bodies["model-manifest.json"] = JSON.stringify({
      contract_version: "workspace-model-bundle-v1",
      config,
      versions: output.versions,
      input_identity: inputIdentity,
      output_manifest_sha256: sha(bodies["manifest.json"]),
      models: artifactFiles.filter((f) => f.file.endsWith(".joblib")),
    });
    const objects = new Map<string, Buffer>();
    const bundle = Object.entries(bodies).map(([name, body]) => {
      const bytes = Buffer.from(body),
        storage_key = `fixture/${name}`;
      objects.set(storage_key, bytes);
      return {
        name,
        storage_key,
        sha256: sha(bytes),
        size_bytes: bytes.length,
        media_type: name.endsWith(".json")
          ? "application/json"
          : name.endsWith(".jsonl")
            ? "application/x-ndjson"
            : "application/octet-stream",
      };
    });
    const manifest = bundle.find((f) => f.name === "manifest.json")!;
    const checkpoint = {
      artifact_id: id(7),
      artifact_key: "manifest.json",
      content: { ...manifest },
      metadata: { bundle },
    };
    type Options = NonNullable<
      Parameters<typeof signalWorkspaceEngineJobV1>[1]
    >;
    const storage: WorkspaceEngineStorageV1 = {
      put: async () => {
        throw Error("offline recovery uploaded a new fit");
      },
      get: async (a) => {
        const bytes = objects.get(a.stored.storage_key)!;
        assert.equal(sha(bytes), a.stored.sha256);
        await writeFile(a.destination, bytes, { flag: "wx" });
      },
    };
    const monetary = async () => {
      reservations++;
      throw Error("offline recovery attempted a reservation");
    };
    const options: Options = {
      database: {} as Options["database"],
      storage,
      storage_root: root,
      mass_operator: { recovery_only: true },
      recovery_preflight: async () => ({ pilot: true }),
      process: async () => {
        numericalCalls++;
        throw Error("offline recovery refitted");
      },
      stores: {
        claim: async () => lease,
        chunks: async () => ({ items: chunks, next_cursor: null, done: true }),
        guides: async () => ({ items: [], next_cursor: null, done: true }),
        parent: async () => {
          throw Error("offline recovery loaded a parent");
        },
        heartbeat: async () => {},
        checkpoint: async () => checkpoint,
        persist: async (a) => ({
          artifact_id:
            a.artifact.artifact_key === "manifest.json" ? id(7) : id(8),
          replayed: true,
        }),
        finish: async () => {
          throw Error("offline recovery completed numeric run");
        },
        fail: async () => {},
      },
      interpretation_stores: {
        fit: async () => ({}) as never,
        context: async () => ({
          actor_user_id: id(9),
          context: {
            workspace_id: lease.workspace_id,
            execution_id: lease.execution_id,
            context_digest: lease.snapshot.context_digest,
            data: {
              brand_os: {
                context_digest: lease.snapshot.context_digest,
                seeds: [],
                locale: { primary_locale: "pt-BR" },
              },
              interests: [],
            },
          },
        }),
        checkpoints: async () => ({
          items: [],
          next_artifact_id: null,
          done: true,
        }),
        recoverable: async () => [],
        recoveryCalls: async () => [],
        registerUnits: async () => ({ replayed: false }),
        recoveryReview: async () => {
          throw Error("unexpected receipt review");
        },
        pauseRecovery: async (a) => {
          paused++;
          return {
            execution_id: lease.execution_id,
            status: "failed",
            recovery_status: a.reason,
            recovered_units: 0,
            pending_units: 1,
          };
        },
        exceptions: async () => [],
        reserve: monetary,
        sent: monetary,
        response: monetary,
        settle: monetary,
        fail: monetary,
        checkpoint: monetary,
        quarantine: monetary,
        materialize: monetary,
        persist: monetary,
        complete: monetary,
        completePartial: monetary,
      },
    };
    assert.equal(options.interpret, undefined);
    const progress: unknown[] = [];
    const result = await signalWorkspaceEngineJobV1(
      {
        id: "offline-default-interpreter",
        data: { execution_id: lease.execution_id },
        updateProgress: async (value) => {
          progress.push(value);
        },
      },
      options,
    );
    assert.ok("recovery_status" in result);
    assert.equal(result.recovery_status, "unprocessed_units_pending");
    assert.deepEqual(
      { fetches, reservations, numericalCalls, paused },
      { fetches: 0, reservations: 0, numericalCalls: 0, paused: 1 },
    );
    assert.equal(progress.includes(100), false);
  } finally {
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
    if (oldFlag === undefined)
      delete process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED;
    else process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED = oldFlag;
    await rm(root, { recursive: true, force: true });
  }
});
