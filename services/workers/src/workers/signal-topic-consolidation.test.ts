import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SignalTopicConsolidationSourceV1 } from "@noisia/db";
import { signalTopicConsolidationDigestV1 } from "@noisia/db";
import { buildSignalTopicAtomicCensusFromBundleV1, signalTopicConsolidationJobV1 } from "./signal-topic-consolidation";

const sha = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

async function fixture(groupCount: number) {
  const directory = await mkdtemp(join(tmpdir(), "signal-topic-consolidation-test-"));
  const populations: string[] = [], assignments: string[] = [], roots: string[] = [], clusters: unknown[] = [];
  for (let index = 0; index < groupCount; index++) {
    const root = uuid(index + 1), stable = uuid(index + groupCount + 1), chunk = sha(`chunk-${index}`);
    const identity = { ordinal: index, root_id: root, root_fingerprint: sha(`root-${index}`), expected_chunks: 1,
      chunk_index: 0, start: 0, end: 10, chunk_sha256: chunk };
    populations.push(JSON.stringify(identity));
    assignments.push(JSON.stringify({ ordinal: identity.ordinal, root_id: identity.root_id, chunk_index: identity.chunk_index,
      chunk_sha256: identity.chunk_sha256, start: identity.start, end: identity.end,
      local_label: index, stable_cluster_id: stable, strength: 0.75 }));
    roots.push(JSON.stringify({ root_id: root, root_fingerprint: identity.root_fingerprint, chunk_count: 1,
      open: [stable], guided: [] }));
    clusters.push({ stable_cluster_id: stable, local_label: index, lane: "open", root_count: 1, chunk_count: 1,
      terms: [`term-${index}`, ""], representative_selection_policy: "distinct-roots-affiliation-boundary-v1",
      representatives: [{ ordinal: index, root_id: root, chunk_index: 0, start: 0, end: 10,
        chunk_sha256: chunk, strength: 0.75, selection_reason: "high_affiliation" }] });
  }
  const files = new Map<string, string>([
    ["population.jsonl", `${populations.join("\n")}\n`], ["assignments.open.jsonl", `${assignments.join("\n")}\n`],
    ["roots.jsonl", `${roots.join("\n")}\n`], ["clusters.open.json", JSON.stringify(clusters)],
  ]);
  const context = sha("context");
  const artifacts = [...files].map(([file, body]) => ({ file, sha256: sha(body), bytes: Buffer.byteLength(body) }));
  const manifestBody = JSON.stringify({ contract_version: "workspace-topic-engine-output-v1", workspace_id: uuid(900_001),
    input_manifest_sha256: sha("input"), previous_manifest_sha256: null,
    input_identity: { embedding_config_digest: sha("embedding"), context_digest: context,
      catalog_digest: sha("catalog"), chunk_policy_version: "signal-chunks-v1" }, config: {}, versions: {}, status: "completed",
    counts: { occurrences: groupCount, roots: groupCount, guides: 0, common_unchanged_roots: 0 },
    lanes: [{ lane: "open", model_file: "model.open.joblib", assignments_file: "assignments.open.jsonl",
      clusters_file: "clusters.open.json", occurrences: groupCount, roots: groupCount, clusters: groupCount,
      outlier_occurrences: 0, guidance: null, fit_seconds: 1 }], artifacts, quality: "uncalibrated", approval_policy: "none" });
  files.set("manifest.json", manifestBody);
  for (const [name, body] of files) await writeFile(join(directory, name), body);
  const bundle = [...files].map(([name, body]) => ({ name, storage_key: `workspace-engine/${uuid(900_001)}/${uuid(900_002)}/${name}`,
    sha256: sha(body), size_bytes: Buffer.byteLength(body), media_type: name.endsWith("jsonl") ? "application/x-ndjson" : "application/json" }));
  bundle.push({ name: "model-manifest.json", storage_key: "unused", sha256: sha("model"), size_bytes: 5, media_type: "application/json" });
  const source: SignalTopicConsolidationSourceV1 = { workspace_id: uuid(900_001), source_execution_id: uuid(900_002),
    actor_user_id: uuid(900_003), embedding_run_id: uuid(900_006), embedding_config_digest: sha("embedding"),
    source_checkpoint_digest: sha("checkpoint"), context_digest: context,
    expected_group_count: groupCount, output_artifact_id: uuid(900_004), output_artifact_sha256: sha(manifestBody),
    model_artifact_id: uuid(900_005), model_artifact_sha256: sha("model"), bundle };
  return { directory, source };
}

test("builds the complete 1,652-group census without provider calls or fabricated centroids", async () => {
  const { directory, source } = await fixture(1_652);
  try {
    let metadataCalls = 0;
    const result = await buildSignalTopicAtomicCensusFromBundleV1({ directory, source, metadata: async roots => {
      metadataCalls++;
      return roots.map((root_id, index) => ({ root_id, scope: index % 3 === 0 ? "brand" as const : "competitor" as const,
        locale: "es", platform: "x", occurred_at: "2026-09-01T00:00:00.000Z" }));
    } });
    assert.equal(result.census.groups.length, 1_652);
    assert.equal(result.census.groups.filter(group => group.centroid === null).length, 1_652);
    assert.equal(result.census.groups.reduce((sum, group) => sum + group.root_count, 0), 1_652);
    assert.equal(result.community_status, "blocked_missing_group_centroids");
    assert.equal(metadataCalls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects a changed assignment even when the manifest receipt is unchanged", async () => {
  const { directory, source } = await fixture(2);
  try {
    await writeFile(join(directory, "assignments.open.jsonl"), "{}\n");
    await assert.rejects(buildSignalTopicAtomicCensusFromBundleV1({ directory, source, metadata: async () => [] }),
      /signal_topic_consolidation_artifact_receipt_mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("binds exact normalized centroids and produces a total kNN community partition", async () => {
  const { directory, source } = await fixture(2);
  try {
    const result = await buildSignalTopicAtomicCensusFromBundleV1({ directory, source,
      metadata: async roots => roots.map(root_id => ({ root_id, scope: "brand" as const, locale: "es",
        platform: "x", occurred_at: "2026-09-01T00:00:00.000Z" })),
      centroids: async memberships => {
        const keys = [...new Set(memberships.map(item => item.group_key))].sort();
        const first = Array.from({ length: 1024 }, (_, index) => index === 0 ? 1 : 0);
        const second = Array.from({ length: 1024 }, (_, index) => index === 0 ? 0.8 : index === 1 ? 0.6 : 0);
        return { artifact_id: uuid(910_001), artifact_sha256: sha("centroid-artifact"), centroids: [
          { group_key: keys[0]!, vector: first, centroid_digest: signalTopicConsolidationDigestV1(first),
            neighbors: [{ group_key: keys[1]!, similarity: 0.8 }] },
          { group_key: keys[1]!, vector: second, centroid_digest: signalTopicConsolidationDigestV1(second),
            neighbors: [{ group_key: keys[0]!, similarity: 0.8 }] },
        ] };
      } });
    assert.equal(result.community_status,"ready");
    assert.equal(result.census.groups.filter(group => group.centroid !== null).length,2);
    assert.equal(result.community_plan?.communities.length,1);
    assert.equal(result.community_plan?.communities[0]?.members.length,2);
  } finally { await rm(directory,{ recursive: true, force: true }); }
});

test("canonicalizes dossier neighbors by similarity before sealing their digest", async () => {
  const { directory, source } = await fixture(3);
  try {
    const result = await buildSignalTopicAtomicCensusFromBundleV1({ directory, source,
      metadata: async roots => roots.map(root_id => ({ root_id, scope: "brand" as const, locale: "es",
        platform: "x", occurred_at: "2026-09-01T00:00:00.000Z" })),
      centroids: async memberships => {
        const keys = [...new Set(memberships.map(item => item.group_key))].sort();
        return { artifact_id: uuid(910_001), artifact_sha256: sha("centroid-artifact"), centroids: keys.map((group_key,index) => {
          const vector = Array.from({ length: 1024 }, (_, dimension) => dimension === index ? 1 : 0);
          const others = keys.filter(key => key !== group_key);
          return { group_key, vector, centroid_digest: signalTopicConsolidationDigestV1(vector), neighbors: index === 0
            ? [{ group_key: others[0]!, similarity: 0.8 }, { group_key: others[1]!, similarity: 0.95 }]
            : others.map(key => ({ group_key: key, similarity: 0.8 })) };
        }) };
      } });
    assert.deepEqual(result.census.groups[0]?.dossier.neighbors.map(item => item.similarity),[0.95,0.8]);
    assert.equal(result.census.groups[0]?.dossier.metrics.cohesion,null);
    assert.deepEqual(result.census.groups[1]?.dossier.neighbors.map(item => item.group_key),
      [...(result.census.groups[1]?.dossier.neighbors.map(item => item.group_key) ?? [])].sort());
    assert.equal(result.census.groups[0]?.dossier_digest,
      signalTopicConsolidationDigestV1(result.census.groups[0]?.dossier));
  } finally { await rm(directory,{ recursive: true,force: true }); }
});

test("worker seals centroid artifact before materializing census and communities", async () => {
  const sourceFixture = await fixture(2), scratch = await mkdtemp(join(tmpdir(),"signal-topic-consolidation-worker-"));
  try {
    const progress: unknown[] = [], calls: string[] = [];
    const vector = Array.from({ length: 1024 },(_,index) => index === 0 ? 1 : 0);
    const keys = [uuid(3),uuid(4)].map(id => `open:${id}`).sort();
    const storage = {
      async get(args: { destination: string }) { await copyFile(join(sourceFixture.directory,args.destination.split("/").at(-1)!),args.destination); },
      async put(args: { file: string; sha256: string; size_bytes: number; media_type: string }) {
        assert.equal(sha(await readFile(args.file)),args.sha256); calls.push("put");
        return { storage_key: `workspace-engine/${sourceFixture.source.workspace_id}/${sourceFixture.source.source_execution_id}/derived`,
          sha256: args.sha256,size_bytes: args.size_bytes,media_type: args.media_type };
      },
    };
    const stores = {
      async source() { return sourceFixture.source; },
      async metadata(_database: unknown,_workspace: string,roots: readonly string[]) { return roots.map(root_id => ({ root_id,
        scope: "brand" as const,locale: "es",platform: "x",occurred_at: "2026-09-01T00:00:00.000Z" })); },
      async centroids() { return keys.map((group_key,index) => ({ group_key,vector,centroid_digest: signalTopicConsolidationDigestV1(vector),
        neighbors: [{ group_key: keys[1-index]!,similarity: 0.9 }] })); },
      async persistCentroids() { calls.push("persist-centroids"); return { artifact_id: uuid(910_001),replayed: false }; },
      async materialize() { calls.push("materialize-census"); return { consolidation_run_id: uuid(910_002),group_count: 2,
        root_count: 2,evidence_count: 2,replayed: false }; },
      async communities() { calls.push("materialize-communities"); return { consolidation_run_id: uuid(910_002),community_count: 1,
        member_count: 2,replayed: false }; },
    };
    const result = await signalTopicConsolidationJobV1({ id: "job-1",data: { source_execution_id: sourceFixture.source.source_execution_id },
      updateProgress: async value => { progress.push(value); } }, { database: {} as never,storage: storage as never,
      storage_root: scratch,stores: stores as never });
    assert.deepEqual(calls,["put","persist-centroids","materialize-census","materialize-communities"]);
    assert.equal(result.community_status,"ready"); assert.ok(progress.length >= 2);
  } finally { await rm(sourceFixture.directory,{ recursive: true,force: true }); await rm(scratch,{ recursive: true,force: true }); }
});

test("worker rejects an exact kNN census above its supported capacity before storage", async () => {
  const sourceFixture=await fixture(1);
  try {
    let storageReached = false;
    await assert.rejects(signalTopicConsolidationJobV1({ id: "job-cap",data: { source_execution_id: uuid(900_002) },
      updateProgress: async () => undefined }, { database: {} as never,stores: {
        async source() { return { ...sourceFixture.source, expected_group_count: 5_001 }; },
      } as never,storage: { async get() { storageReached = true; } } as never }), /exact_knn_capacity_exceeded/);
    assert.equal(storageReached,false);
  } finally { await rm(sourceFixture.directory,{ recursive: true,force: true }); }
});
