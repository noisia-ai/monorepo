import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  mergeSignalWorkspaceTopicMaterializationV1, signalTopicDefinitionDigestV1, signalWorkspaceEmbeddingDigestV1,
  signalWorkspaceClassificationTopicSemanticsDigestV1,
  type SignalWorkspaceInterpretationV1, type SignalWorkspaceClassificationOutcomeV1,
  type SignalWorkspaceClassificationDecisionV1
} from "@noisia/query-engine";
import { signalWorkspaceTopicProjectionJobV1 as run, type WorkspaceTopicProjectionArtifactV1 as Artifact,
  type WorkspaceTopicProjectionStoresV1 as Stores } from "./signal-workspace-topic-projection";
import type { SignalWorkspaceClassificationLeaseV1 as Lease } from "./signal-workspace-classification";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const sha = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digest = signalWorkspaceEmbeddingDigestV1;
type Row = { ordinal: number; root_id: string; chunk_index: number; start: number; end: number; chunk_sha256: string;
  stable_cluster_id: string | null; local_label: number; strength: number };
const rowIdentity = (row: Pick<Row, "ordinal" | "root_id" | "chunk_index" | "start" | "end" | "chunk_sha256">) => ({ ordinal: row.ordinal, root_id: row.root_id, chunk_index: row.chunk_index,
  start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 });

async function fixture(options: { topic_count?: number; no_groups?: boolean; stale_topic?: boolean; insufficient?: boolean; archived?: boolean; partial?: boolean } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), "projection-test-"));
  const topicCount = options.topic_count ?? 67;
  const engine = id(900), execution = id(901), workspace = id(902), materializationId = id(903);
  const identity: Lease["identity"] = { contract_version: "signal-workspace-classification-v1", workspace_id: workspace,
    engine_key: "workspace-computed-cluster-projection", engine_version: 1, engine_artifact_digest: sha("model"),
    embedding_config_digest: sha("voyage fixture, no transport"), catalog_digest: sha("catalog"),
    compiler_digest: sha("compiler"), context_digest: sha("context"), decision_policy_digest: sha("policy") };
  const chunks = Array.from({ length: 2 }, (_, rootIndex) => Array.from({ length: rootIndex ? 1 : 133 }, (_, index) => {
    const text = `root${rootIndex} fragment ${index} 🌞 ${index === 132 ? "FINAL fragment evidence" : "content"}`.padEnd(1400, ".");
    return { chunk_index: index, start: index * 1400, end: (index + 1) * 1400, chunk_sha256: sha(text), text };
  }));
  const roots = chunks.map((items, index) => ({ root_id: id(index + 1), fingerprint: sha(`root${index}`),
    correction_digest: sha(`corrections${index}`), asset_sha256: sha(items.map(item => item.text).join("")),
    expected_chunks: items.length,
    chunk_coverage_digest: sha(items.map(item => JSON.stringify([item.chunk_index, item.start, item.end, item.chunk_sha256]) + "\n").join("")),
    reuse_item_id: null as string | null }));
  const assignments = Object.fromEntries((["open", "guided"] as const).map(lane => {
    let ordinal = 0;
    return [lane, chunks.flatMap((items, rootIndex) => items.map(item => {
      const local_label = rootIndex || options.no_groups ? -1 : item.chunk_index % (lane === "open" ? topicCount : 3);
      return { ...rowIdentity({ ...item, ordinal: ordinal++, root_id: id(rootIndex + 1) }),
        local_label, stable_cluster_id: local_label < 0 ? null : `group_${local_label}`, strength: local_label < 0 ? 0 : 0.8 };
    }))];
  })) as Record<"open" | "guided", Row[]>;
  const membership = new Map<string, Row[]>();
  for (const lane of ["open", "guided"] as const) for (const row of assignments[lane]) if (row.stable_cluster_id !== null) {
    const key = `${lane}:${row.stable_cluster_id}`; membership.set(key, [...(membership.get(key) ?? []), row]);
  }
  const interpretations: SignalWorkspaceInterpretationV1[] = [...membership].sort(([a], [b]) => a < b ? -1 : 1).map(([key, items]) => ({
    cluster_id: key, cluster_digest: sha(items.map(row => JSON.stringify(rowIdentity(row)) + "\n").join("")),
    status: options.insufficient ? "insufficient" : "coherent", name: options.insufficient ? null : `Topic ${key}`,
    definition: options.insufficient ? null : `Conversation for ${key}`, inclusion: [], exclusion: [],
    citations: options.insufficient ? [] : [sha(key)]
  }));
  const proposals = interpretations.map((result, index) => ({ result, artifact_id: id(2000 + Math.floor(index / 4)) }));
  const materialized = mergeSignalWorkspaceTopicMaterializationV1({ prior: [], interpretations: options.partial ? proposals.slice(0, 4) : proposals,
    execution_id: engine, now: "2026-09-08T00:00:00.000Z", locale: "es-MX" });
  if (options.stale_topic) {
    const item = materialized.definitions[0]!;
    item.definition = "A completely different operator definition"; item.definition_revision++;
    item.definition_digest = signalTopicDefinitionDigestV1(item);
    // Simulate the exact real pitfall: merge preserves edited definition and
    // writes ITS digest into the mapping, although the interpretation differs.
    materialized.mapping[0]!.definition_digest = item.definition_digest;
  }
  if (options.archived) {
    const item = materialized.definitions[0]!; item.lifecycle = "archived"; item.definition_revision++;
    item.definition_digest = signalTopicDefinitionDigestV1(item); materialized.mapping[0]!.definition_digest = item.definition_digest;
  }
  const topics = materialized.definitions.map((definition, index) => ({ taxonomy_term_id: id(3000 + index), definition,
    term_key: definition.term_key, definition_digest: definition.definition_digest, definition_revision: definition.definition_revision }))
    .sort((a, b) => a.term_key < b.term_key ? -1 : 1);
  const files = new Map<string, Buffer>(), refs = new Map<string, Artifact>();
  const put = (name: string, value: string, artifact_id: string, artifact_type = "engine_output") => {
    const bytes = Buffer.from(value); files.set(name, bytes);
    const ref: Artifact = { artifact_id, artifact_key: name, artifact_type, content: { storage_key: `workspace-engine/${workspace}/${engine}/${name}.${sha(bytes).slice(7)}.parts.json`,
      sha256: sha(bytes), size_bytes: bytes.length, media_type: "application/json" }, metadata: {} };
    refs.set(name, ref); return ref;
  };
  const rootsBody = () => roots.map(root => ({ root_id: root.root_id, root_fingerprint: root.fingerprint,
    chunk_count: root.expected_chunks, ...Object.fromEntries((["open", "guided"] as const).map(lane => [lane,
      [...new Set(assignments[lane].filter(row => row.root_id === root.root_id).flatMap(row => row.stable_cluster_id === null ? [] : [row.stable_cluster_id]))]])) }));
  put("roots.jsonl", rootsBody().map(row => JSON.stringify(row) + "\n").join(""), id(1000));
  put("assignments.open.jsonl", assignments.open.map(row => JSON.stringify(row) + "\n").join(""), id(1001));
  put("assignments.guided.jsonl", assignments.guided.map(row => JSON.stringify(row) + "\n").join(""), id(1002));
  const manifest = { contract_version: "workspace-topic-engine-output-v1", workspace_id: workspace,
    quality: "uncalibrated", approval_policy: "none", counts: { occurrences: 134, roots: 2 },
    lanes: (["open", "guided"] as const).map(lane => ({ lane, assignments_file: `assignments.${lane}.jsonl`,
      occurrences: 134, roots: 2, clusters: [...membership.keys()].filter(key => key.startsWith(`${lane}:`)).length,
      outlier_occurrences: assignments[lane].filter(row => row.stable_cluster_id === null).length })),
    artifacts: [...refs.values()].map(ref => ({ file: ref.artifact_key, sha256: ref.content.sha256, bytes: ref.content.size_bytes })) };
  put("manifest.json", JSON.stringify(manifest), id(1003));
  const unitDigest = (keys: string[]) => sha(keys.sort().map(key => JSON.stringify(key) + "\n").join(""));
  const coverage = options.partial ? { interpreted_unit_count: materialized.mapping.length,
    expected_unit_count: interpretations.length, unit_digest: unitDigest(materialized.mapping.map(row => row.unit_key)),
    expected_unit_digest: unitDigest(interpretations.map(row => row.cluster_id)), complete: false } : undefined;
  const materializationKey = coverage ? `materialization-progress-${id(777)}.json` : "materialization.json";
  put(materializationKey, JSON.stringify(coverage ? { ...materialized,
    contract_version: "workspace-topic-materialization-progress-v1", execution_id: engine,
    interpreted_unit_count: coverage.interpreted_unit_count, interpretation_units_digest: coverage.unit_digest,
    expected_interpretation_unit_count: coverage.expected_unit_count, expected_interpretation_units_digest: coverage.expected_unit_digest,
    interpretation_complete: coverage.complete, mapping_digest: digest(materialized.mapping) } : materialized), materializationId, "engine_proposals");
  const primary = [...refs.values()];
  const proposalRefs: Artifact[] = [];
  for (let index = 0; index < interpretations.length; index += 4) {
    const artifactId = id(2000 + index / 4);
    proposalRefs.push(put(`interpretation-${artifactId}.json`, JSON.stringify({ contract_version: "workspace-engine-interpretation-result-v1",
      execution_id: engine, interpretations: interpretations.slice(index, index + 4) }), artifactId, "engine_proposals"));
  }
  let cursor: string | null = null, finished = false, failCommit = false, forbidden = false, reuseRoot = false;
  let commits = 0, finishCalls = 0, storageReads = 0, corrections: SignalWorkspaceClassificationDecisionV1[] = [];
  const persisted = new Map<string, SignalWorkspaceClassificationOutcomeV1>(), failures: string[] = [], chunkReads: number[] = [];
  const lease = (): Lease => ({ execution_id: execution, workspace_id: workspace, execution_token: id(999), cursor_root_id: cursor,
    input_digest: sha("input"), identity });
  const guard = () => { if (forbidden) throw new Error("workspace_classification_forbidden"); };
  const stores: Stores<object> = {
    claim: async () => { guard(); return finished ? null : { lease: lease(), source: { engine_execution_id: engine,
      materialization_artifact_id: materializationId, mapping_digest: digest(materialized.mapping), model_artifact_id: id(1005), artifacts: primary, interpretation_coverage: coverage }, model_version_id: id(1006) }; },
    heartbeat: async () => { guard(); },
    readTopics: async ({ after_term_key, limit }) => { guard(); const remaining = topics.filter(item => after_term_key === null || item.term_key > after_term_key), items = remaining.slice(0, limit);
      return { items, next_term_key: items.at(-1)?.term_key ?? after_term_key, done: remaining.length <= limit }; },
    readProposals: async ({ after_artifact_id, limit }) => { guard(); const remaining = proposalRefs.filter(item => after_artifact_id === null || item.artifact_id > after_artifact_id), items = remaining.slice(0, limit);
      return { items, next_artifact_id: items.at(-1)?.artifact_id ?? after_artifact_id, done: remaining.length <= limit }; },
    readRoots: async ({ limit }) => { guard(); const remaining = roots.filter(root => cursor === null || root.root_id > cursor);
      return { items: remaining.slice(0, limit).map(root => ({ ...root, reuse_item_id: reuseRoot && root.root_id === roots[0]!.root_id ? id(10001) : null })), done: remaining.length <= limit }; },
    readChunks: async ({ root_id, after_chunk_index, limit }) => { guard(); const index = roots.findIndex(root => root.root_id === root_id), root = roots[index]!;
      const items = chunks[index]!.slice((after_chunk_index ?? -1) + 1, (after_chunk_index ?? -1) + 1 + limit); chunkReads.push(items.length);
      return { root_id, asset_sha256: root.asset_sha256, expected_chunks: root.expected_chunks, after_chunk_index, items,
        next_chunk_index: items.at(-1)?.chunk_index ?? after_chunk_index, done: items.at(-1)?.chunk_index === root.expected_chunks - 1 }; },
    readCorrections: async () => { guard(); return corrections; },
    copyRoot: async args => { guard(); cursor = args.root_id; return lease(); },
    commitRoot: async args => { guard(); commits++; persisted.set(args.outcome.root.root_id, args.outcome); cursor = args.outcome.root.root_id;
      if (failCommit) { failCommit = false; throw new Error("private ambiguous commit response"); } return lease(); },
    finish: async () => { guard(); finishCalls++; finished = true; return { status: "ready" }; },
    fail: async args => { failures.push(args.error_code); }
  };
  return { scratch, roots, chunks, assignments, topics, materialized, refs, files, manifest, persisted, failures, chunkReads, coverage, materializationKey,
    options: { database: {}, stores, scratch_root: scratch, storage: {
      put: async () => { throw new Error("Projection must never upload/recompute"); },
      get: async (args: { workspace_id: string; execution_id: string; stored: Artifact["content"]; destination: string }) => {
        assert.equal(args.workspace_id, workspace); assert.equal(args.execution_id, engine); storageReads++;
        const ref = [...refs.values()].find(item => item.content.storage_key === args.stored.storage_key)!;
        await writeFile(args.destination, files.get(ref.artifact_key)!, { flag: "wx" });
      }
    } }, job: { id: `workspace-classification-${execution}`, data: { execution_id: execution }, updateProgress: async () => undefined },
    counters: () => ({ commits, finishCalls, storageReads }),
    failAfterCommit: () => { failCommit = true; }, revoke: () => { forbidden = true; },
    useReuse: () => { reuseRoot = true; }, corrections: (value: SignalWorkspaceClassificationDecisionV1[]) => { corrections = value; },
    mutateArtifact: (name: string, body: string, reseal = false) => {
      files.set(name, Buffer.from(body)); if (reseal) {
        const ref = refs.get(name)!; ref.content.sha256 = sha(body); ref.content.size_bytes = Buffer.byteLength(body);
        ref.content.storage_key = `workspace-engine/${workspace}/${engine}/${name}.${sha(body).slice(7)}.parts.json`;
        const entry = manifest.artifacts.find(item => item.file === name);
        if (entry) { entry.sha256 = ref.content.sha256; entry.bytes = ref.content.size_bytes;
          const value = JSON.stringify(manifest), manifestRef = refs.get("manifest.json")!; files.set("manifest.json", Buffer.from(value));
          manifestRef.content.sha256 = sha(value); manifestRef.content.size_bytes = Buffer.byteLength(value); }
      }
    },
    close: async () => { assert.deepEqual(await readdir(scratch), [], "only the job's private scratch is removed"); await rm(scratch, { recursive: true }); }
  };
}

test("projects all 70 Topics over 133 fragments and both lanes, with outlier abstention and no approval", async () => {
  const f = await fixture(); try {
    assert.deepEqual(await run(f.job, f.options), { status: "ready" });
    const first = f.persisted.get(f.roots[0]!.root_id)!;
    assert.equal(first.decisions.length, 70); assert.equal(first.coverage.processed_chunks, 133);
    assert.deepEqual(f.chunkReads, [128, 5, 1]);
    assert.ok(first.decisions.every(item => item.disposition === "pending" && item.approval_policy_id === null && item.score === null));
    assert.equal(first.decisions.reduce((sum, item) => sum + item.membership_metadata!.matched_chunks, 0), 266);
    assert.equal(f.persisted.get(f.roots[1]!.root_id)!.resolution_state, "abstained");
    const before = f.counters(); assert.equal((await run(f.job, f.options) as { replayed: boolean }).replayed, true);
    assert.deepEqual(f.counters(), before, "completed replay never rereads storage or repeats membership writes");
  } finally { await f.close(); }
});
test("a persisted root with lost commit acknowledgement resumes its suffix without duplicate writes", async () => {
  const f = await fixture(); try {
    f.failAfterCommit(); await assert.rejects(run(f.job, f.options), /workspace_classification_worker_failed/);
    assert.equal(f.counters().commits, 1); await run(f.job, f.options);
    assert.equal(f.counters().commits, 2); assert.equal(f.counters().finishCalls, 1);
    assert.equal(f.persisted.size, 2); assert.deepEqual(f.chunkReads, [128, 5, 1]);
  } finally { await f.close(); }
});
test("the Topic and proposal readers paginate beyond 128 definitions and 32 artifact files", async () => {
  const f = await fixture({ topic_count: 133 }); try { await run(f.job, f.options);
    assert.equal(f.topics.length, 136); assert.equal(f.persisted.get(f.roots[0]!.root_id)!.decisions.length, 136);
    assert.equal([...f.refs.values()].filter(ref => ref.artifact_key.startsWith("interpretation-")).length, 34);
    const last = f.persisted.get(f.roots[0]!.root_id)!.decisions.find(item => item.membership_metadata?.unit_keys[0] === "open:group_132")!;
    const { text, ...fragment } = f.chunks[0]![132]!;
    assert.ok(text.includes("FINAL fragment evidence"));
    assert.deepEqual(last.membership_metadata!.evidence_fragment, fragment,
      "evidence is the actual final fragment that belongs, never the first 2000 characters of the document");
  } finally { await f.close(); }
});
test("all roots reconcile even when a previous complete root is copied without reading text again", async () => {
  const f = await fixture(); try { f.useReuse(); await run(f.job, f.options);
    assert.deepEqual(f.chunkReads, [1]); assert.equal(f.counters().commits, 1); assert.equal(f.counters().finishCalls, 1);
  } finally { await f.close(); }
});
test("copy reuse still checks the source root fingerprint and exact fragment coverage", async () => {
  for (const field of ["fingerprint", "chunk_coverage_digest"] as const) {
    const f = await fixture(); try { f.useReuse(); f.roots[0]![field] = sha("changed metadata");
      await assert.rejects(run(f.job, f.options), /workspace_classification_projection_integrity_invalid/);
      assert.deepEqual(f.chunkReads, []); assert.equal(f.counters().finishCalls, 0);
    } finally { await f.close(); }
  }
});
test("preserved edited semantics cannot inherit the old cluster even when materialization stores its new digest", async () => {
  const f = await fixture({ stale_topic: true }); try { await run(f.job, f.options);
    const result = f.persisted.get(f.roots[0]!.root_id)!;
    assert.equal(result.decisions.length, 69); assert.equal(result.has_unresolved_topics, true);
    assert.equal(result.reason_code, "computed_cluster_semantics_stale");
    assert.ok(!result.decisions.some(item => item.term_key === f.materialized.mapping[0]!.term_key));
  } finally { await f.close(); }
});
test("an exact human correction overrides the sparse computed decision without pretending numerical approval", async () => {
  const f = await fixture(); try {
    const item = f.topics[0]!;
    const correction: SignalWorkspaceClassificationDecisionV1 = { taxonomy_term_id: item.taxonomy_term_id, term_key: item.term_key,
      definition_digest: item.definition_digest, definition_revision: item.definition_revision, disposition: "rejected", resolution_method: "human",
      model_version_id: null, labeling_function_version_id: null, approval_policy_id: null, decided_by_user_id: id(888), correction_operation_id: id(889),
      score: null, evidence_digest: sha("correction evidence"), lineage_digest: sha("correction lineage") };
    f.corrections([correction]); await run(f.job, f.options);
    assert.deepEqual(f.persisted.get(f.roots[0]!.root_id)!.decisions.find(row => row.term_key === item.term_key), correction);
  } finally { await f.close(); }
});
test("archived Topics remain in the verified census but neither count nor create unresolved review work", async () => {
  const f = await fixture({ archived: true }); try { await run(f.job, f.options);
    const first = f.persisted.get(f.roots[0]!.root_id)!;
    assert.equal(first.decisions.length, 69); assert.equal(first.has_unresolved_topics, false);
    assert.equal(first.coverage.processed_chunks, 133);
    assert.ok(!first.decisions.some(item => item.term_key === f.materialized.mapping[0]!.term_key));
  } finally { await f.close(); }
});
test("all outliers and insufficient interpretations stay explicit, with no fabricated Topic meaning", async () => {
  for (const options of [{ no_groups: true }, { insufficient: true }]) {
    const f = await fixture(options); try { await run(f.job, f.options);
      const result = f.persisted.get(f.roots[0]!.root_id)!; assert.deepEqual(result.decisions, []);
      assert.equal(result.resolution_state, options.no_groups ? "abstained" : "pending");
    } finally { await f.close(); }
  }
});
test("byte mutation and fully resealed truncated/swap/census artifacts cannot finalize a partial population", async () => {
  for (const mode of ["bytes", "truncated", "swap", "membership", "root_fingerprint", "root_count", "unmapped"] as const) {
    const f = await fixture(); try {
      if (mode === "bytes") f.mutateArtifact("assignments.open.jsonl", "private corrupt content");
      else if (mode === "root_fingerprint" || mode === "root_count") {
        const rows = f.files.get("roots.jsonl")!.toString().trim().split("\n").map(line => JSON.parse(line));
        if (mode === "root_count") rows[0].chunk_count--;
        else rows[0].root_fingerprint = sha("different input");
        f.mutateArtifact("roots.jsonl", rows.map(row => JSON.stringify(row) + "\n").join(""), true);
      } else {
        const rows = structuredClone(f.assignments.open);
        if (mode === "truncated") rows.pop();
        if (mode === "swap") [rows[0], rows[1]] = [rows[1]!, rows[0]!];
        if (mode === "membership") rows[132]!.stable_cluster_id = "group_0";
        if (mode === "unmapped") rows[132]!.stable_cluster_id = "not_in_mapping";
        f.mutateArtifact("assignments.open.jsonl", rows.map(row => JSON.stringify(row) + "\n").join(""), true);
      }
      await assert.rejects(run(f.job, f.options), /workspace_classification_projection_integrity_invalid/, mode);
      assert.equal(f.counters().finishCalls, 0); assert.equal(f.counters().commits, 0);
    } finally { await f.close(); }
  }
});
test("revoked workspace authority never downloads artifacts, writes a root or exposes raw errors", async () => {
  const f = await fixture(); try { f.revoke(); await assert.rejects(run(f.job, f.options), /workspace_classification_forbidden/);
    assert.deepEqual(f.counters(), { commits: 0, finishCalls: 0, storageReads: 0 });
  } finally { await f.close(); }
});
test("meaning identity excludes presentation but includes scope, boundaries and examples", async () => {
  const f = await fixture(); try {
    const value = f.topics[0]!.definition, baseline = signalWorkspaceClassificationTopicSemanticsDigestV1(value);
    const renamed = { ...value, label: "Renamed" };
    assert.equal(signalWorkspaceClassificationTopicSemanticsDigestV1(renamed), baseline);
    for (const changed of [{ definition: "Different" }, { scope: "category" as const }, { inclusion: ["new boundary"] },
      { exclusion: ["new exclusion"] }, { positive_examples: ["new example"] }, { negative_examples: ["new negative"] }]) {
      assert.notEqual(signalWorkspaceClassificationTopicSemanticsDigestV1({ ...value, ...changed }), baseline);
    }
  } finally { await f.close(); }
});


test("partial interpretation projects every root and fragment while leaving uninterpreted groups unresolved", async () => {
  const f = await fixture({ partial: true }); try {
    await run(f.job, f.options);
    assert.deepEqual(f.chunkReads, [128, 5, 1]);
    const first = f.persisted.get(f.roots[0]!.root_id)!;
    assert.equal(first.decisions.length, 4);
    assert.equal(first.has_unresolved_topics, true);
    assert.equal(first.reason_code, "computed_cluster_interpretation_pending");
    assert.equal(first.coverage.processed_chunks, 133);
    assert.equal(f.persisted.get(f.roots[1]!.root_id)!.reason_code, "computed_cluster_outlier");
    assert.equal(f.persisted.size, 2);
    assert.ok(first.decisions.every(item => item.disposition === "pending"));
    assert.equal(f.counters().storageReads, 6, "later interpretation artifacts are paginated but do not enter this sealed projection");
  } finally { await f.close(); }
});

test("partial projections reject a forged unit universe, missing mapped evidence or inconsistent completeness", async () => {
  for (const mode of ["universe", "count", "complete", "mapped_proposal", "truncated"] as const) {
    const f = await fixture({ partial: true }); try {
      if (mode === "universe") f.coverage!.expected_unit_digest = sha("different unit universe");
      if (mode === "count") f.coverage!.expected_unit_count--;
      if (mode === "complete") f.coverage!.complete = true;
      if (mode === "mapped_proposal") {
        const name = [...f.refs.keys()].find(key => key.startsWith("interpretation-"))!;
        const value = JSON.parse(f.files.get(name)!.toString()); value.interpretations.pop();
        f.mutateArtifact(name, JSON.stringify(value), true);
      }
      if (mode === "truncated") f.mutateArtifact("assignments.guided.jsonl", f.assignments.guided.slice(0, -1).map(row => JSON.stringify(row) + "\n").join(""), true);
      await assert.rejects(run(f.job, f.options), /workspace_classification_projection_integrity_invalid/, mode);
      assert.equal(f.counters().commits, 0); assert.equal(f.counters().finishCalls, 0);
    } finally { await f.close(); }
  }
});
