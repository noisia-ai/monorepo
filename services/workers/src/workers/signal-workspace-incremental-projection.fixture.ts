import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,
  buildSignalWorkspaceInterpretationBatchV1, validateSignalWorkspaceInterpretationResultV1,
  signalWorkspaceInterpretationReferenceIdV1, mergeSignalWorkspaceTopicMaterializationV1,
  parseSignalWorkspaceIncrementalOutputV1, resolveSignalWorkspaceIncrementalBindingsV1,
  signalWorkspaceEmbeddingDigestV1 as digest, type SignalWorkspaceIncrementalRootV1 as Root,
  type SignalWorkspaceIncrementalProjectionProposalV1 as Proposal,
  type SignalWorkspaceIncrementalProjectionTopicV1 as Topic,
  type SignalWorkspaceInterpretationClusterV1 as Cluster,
} from "@noisia/query-engine";
import type {
  SignalWorkspaceIncrementalProjectionDerivationV1 as Derivation,
  SignalWorkspaceIncrementalProjectionProposalRefV1 as ProposalRef,
  SignalWorkspaceIncrementalProjectionResultV1 as Result,
  SignalWorkspaceEngineArtifactV1 as Artifact,
} from "@noisia/db";
import { signalWorkspaceIncrementalDerivationJobV1 as run,
  type WorkspaceIncrementalDerivationStoresV1 as Stores } from "./signal-workspace-incremental-derivation";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const fixtureRoot = resolve(import.meta.dirname, "../../../../.data/workspace-incremental-2026-09-09/pytest-final/incremental-real0");
export const available = existsSync(join(fixtureRoot, "empty-output/manifest.json"));
export const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const sha = (body: string | Buffer) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
export const jsonl = (body: Buffer) => body.toString().split("\n").filter(Boolean).map(line => JSON.parse(line));
const numericNames = ["manifest.json", "roots.jsonl", "population.jsonl", "memberships.jsonl", "pending-cohort.jsonl", "model-components.json"];
type Options = NonNullable<Parameters<typeof run>[1]>;
type Summary = Parameters<Stores["finish"]>[0]["summary"];

/** Existing, already-computed numerical bytes; editorial packets below are
 * explicitly synthetic strict-schema fixtures, not real provider receipts.
 * This suite executes the real file validator and binding resolver, never a
 * model, provider, database, or queue connection. */
export async function fixture(wave: 2 | 3 | 4 = 2, interpreted = true) {
  const scratch = await mkdtemp(join(tmpdir(), "noisia-incremental-derivation-"));
  const directory = join(fixtureRoot, wave === 4 ? "empty-output" : `output${wave}`);
  const inputDirectory = join(fixtureRoot, wave === 4 ? "empty-input" : `input${wave}`);
  const manifest = parseSignalWorkspaceIncrementalOutputV1(await json(join(directory, "manifest.json")));
  const input = await json(join(inputDirectory, "manifest.json"));
  const objects = new Map<string, Buffer>();
  const prefix = (owner: string) => `workspace-engine/${manifest.workspace_id}/${owner}/`;
  const refs: Derivation["artifacts"] = [];
  for (const [index, name] of numericNames.entries()) {
    const body = await readFile(join(directory, name));
    const storage_key = `${prefix(manifest.execution_id)}${name}.${sha(body).slice(7)}.parts.json`;
    objects.set(storage_key, body);
    refs.push({ artifact_id: id(100 + index), owner_execution_id: manifest.execution_id, artifact_key: name,
      storage_key, sha256: sha(body), size_bytes: body.length,
      media_type: name.endsWith(".jsonl") ? "application/x-ndjson" : "application/json", metadata: {} });
  }
  const roots: Root[] = jsonl(objects.get(refs[1]!.storage_key)!).map(({ unit_keys: _units, state: _state, discovery_pending: _pending, ...root }) => root);
  const topics: Topic[] = [], packets: Proposal[] = [], proposals: ProposalRef[] = [];
  if (interpreted) for (const component of manifest.components) for (const unit of component.units) {
    const index = packets.length, owner = component.model_origin.execution_id;
    const context = { workspace_id: manifest.workspace_id, execution_id: owner,
      context_digest: manifest.compatibility.context_digest, data: { fixture: "Synthetic editorial evidence; no provider was called." } };
    const text = `Ejemplo editorial sintético 🌞 ${index}`;
    const fragment = { root_id: id(10000 + index), chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text) };
    const citation = signalWorkspaceInterpretationReferenceIdV1(fragment);
    const cluster: Cluster = { cluster_id: unit.unit_key, lane: component.lane,
      cluster_digest: sha(`synthetic complete cluster evidence:${unit.unit_key}`), root_count: 1, chunk_count: 1,
      terms: ["experiencia"], representatives: [{ ...fragment, ref_id: citation, text, strength: 0.9, selection_reason: "high_affiliation" }] };
    const result = { cluster_id: unit.unit_key, cluster_digest: cluster.cluster_digest, status: "coherent" as const,
      name: `Tema sintético ${index}`, definition: `Experiencias descritas en el ejemplo sintético ${index}.`,
      inclusion: [{ text: "Experiencias citadas", citations: [citation] }], exclusion: [], citations: [citation] };
    const batch = buildSignalWorkspaceInterpretationBatchV1(context, [cluster], SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1);
    assert.deepEqual(validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: [result] }), [result]);
    const body = JSON.stringify({ contract_version: "workspace-engine-interpretation-result-v1", execution_id: owner,
      context, clusters: [cluster], interpretations: [result] });
    const packet: Proposal = { artifact_id: id(1000 + index), owner_execution_id: owner, artifact_sha256: sha(body), body,
      call_id: id(2000 + index), request_digest: batch.request_digest,
      call_configuration: SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1, context_digest: context.context_digest };
    packets.push(packet);
    const { body: _body, ...metadata } = packet;
    const storage_key = `${prefix(owner)}synthetic-proposal-${index}.${sha(body).slice(7)}.parts.json`;
    objects.set(storage_key, Buffer.from(body));
    proposals.push({ ...metadata, artifact_key: `synthetic-proposal-${index}.json`, storage_key,
      sha256: sha(body), size_bytes: Buffer.byteLength(body), media_type: "application/json", metadata: {} });
    const definition = mergeSignalWorkspaceTopicMaterializationV1({ prior: [], interpretations: [{ result, artifact_id: packet.artifact_id }],
      execution_id: owner, now: "2026-09-09T00:00:00.000Z", locale: "es-MX" }).definitions[0]!;
    topics.push({ taxonomy_term_id: id(3000 + index), definition });
  }
  topics.sort((a, b) => a.definition.term_key < b.definition.term_key ? -1 : 1);
  proposals.sort((a, b) => a.artifact_id < b.artifact_id ? -1 : 1);
  const resolved = resolveSignalWorkspaceIncrementalBindingsV1({ workspace_id: manifest.workspace_id, components: manifest.components, topics, proposals: packets });
  const scope = { execution_id: manifest.execution_id, workspace_id: manifest.workspace_id, actor_user_id: id(3), worker_job_id: "synthetic-durable-derivation" };
  const d: Derivation = { ...scope, input_digest: sha("server input"), derivation_digest: sha(`synthetic derivation:${wave}:${interpreted}`),
    snapshot: { contract_version: "workspace-topic-engine-v1", workspace_id: scope.workspace_id, taxonomy_profile_id: id(4),
      preparation_run_id: input.preparation_run_id, embedding_run_id: input.embedding_run_id, input_revision: String(input.input_revision),
      embedding_profile: { ...SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, config_digest: manifest.compatibility.embedding_config_digest },
      context_digest: input.context_digest, catalog_digest: input.catalog_digest, prototype_plan_digest: sha("prototype plan"),
      expected_roots: manifest.counts.roots, expected_chunks: manifest.counts.occurrences, expected_guides: input.guides.rows,
      parent_execution_id: id(5), context_refs: [], engine_config: input.config, claude_cap_micro_usd: 0 },
    numeric_checkpoint: { contract_version: "workspace-incremental-numeric-checkpoint-v1", checkpoint_digest: sha("numeric checkpoint"),
      descriptor_digest: sha("descriptor"), input_artifact_id: id(10), output_index_artifact_id: id(11), output_artifact_id: refs[0]!.artifact_id,
      model_bank_artifact_id: id(12), model_version_id: id(13), population_digest: manifest.population_digest,
      roots: manifest.counts.roots, occurrences: manifest.counts.occurrences, components: manifest.components.length,
      component_digest: digest([...manifest.components].sort((a, b) => a.component_key < b.component_key ? -1 : 1)
        .map(component => [component.component_key, component.lane, component.model_origin, component.units.length, digest(component.units)])),
      model_bank_bytes: manifest.counts.model_bank_bytes,
      discovery_status: manifest.discovery_status, relations_status: manifest.relations_status, history_artifact_id: id(14), numeric_complete: true, analysis_complete: false },
    catalog_profile_id: id(4), identity: { contract_version: "signal-workspace-classification-v1", workspace_id: scope.workspace_id,
      engine_key: "workspace-incremental-cluster-projection", engine_version: 1, engine_artifact_digest: sha("bank"),
      embedding_config_digest: manifest.compatibility.embedding_config_digest, catalog_digest: input.catalog_digest,
      compiler_digest: sha("compiler"), context_digest: input.context_digest, decision_policy_digest: sha("projection policy") },
    correction_digest: sha("correction epoch"), editorial_cut_digest: resolved.editorial_cut_digest, artifacts: refs, completed_projection: null };
  const immutableBefore = digest({ snapshot: d.snapshot, checkpoint: d.numeric_checkpoint, artifacts: refs });
  const originalObjects = new Map([...objects].map(([key, body]) => [key, sha(body)]));
  const events: string[] = [], failures: string[] = [], uploads: Artifact[] = [];
  const durableBindings = new Map<string, Parameters<Stores["bindings"]>[0]["bindings"][number]>();
  const expectedUnits = manifest.components.flatMap(component => component.units.map(unit => ({ component_key: component.component_key, ...unit })));
  const durableUnits = new Map<string, typeof expectedUnits[number]>();
  const counts = { get: 0, put: 0, roots: 0, root_items: 0, topics: 0, proposals: 0, units: 0, bindings: 0, finish: 0, generation: 0, completeDispatch: 0 };
  let unitAckLost = false, bindingAckLost = false, finishAckLost = false, outbox = "dispatched", lastArtifact: Artifact | null = null, summary: Summary | null = null;
  const guard = (args: typeof scope) => { for (const key of Object.keys(scope) as Array<keyof typeof scope>) assert.equal(args[key], scope[key]); };
  const readGuard = (args: typeof scope & { derivation_digest: string }) => { guard(args); assert.equal(args.derivation_digest, d.derivation_digest); };
  const storage: WorkspaceEngineStorageV1 = {
    async get(args) { counts.get++; events.push(`get:${basename(args.destination)}`);
      assert.equal(args.workspace_id, scope.workspace_id); assert.ok(args.stored.storage_key.startsWith(prefix(args.execution_id)));
      const body = objects.get(args.stored.storage_key);
      if (!body || sha(body) !== args.stored.sha256 || body.length !== args.stored.size_bytes) throw new Error("workspace_engine_storage_verification_failed");
      await writeFile(args.destination, body, { flag: "wx" }); },
    async put(args) { counts.put++; events.push("put:bindings");
      assert.equal(args.workspace_id, scope.workspace_id); assert.equal(args.execution_id, scope.execution_id);
      const body = await readFile(args.file); assert.equal(sha(body), args.sha256); assert.equal(body.length, args.size_bytes);
      const storage_key = `${prefix(scope.execution_id)}${basename(args.file)}.${args.sha256.slice(7)}.parts.json`;
      const old = objects.get(storage_key); if (old) assert.deepEqual(body, old); objects.set(storage_key, body);
      return { storage_key, sha256: args.sha256, size_bytes: body.length, media_type: args.media_type }; }
  };
  function saveArtifact(artifact: Artifact, value: Summary) {
    assert.equal(artifact.artifact_key, `incremental-bindings-${d.derivation_digest.slice(7)}.jsonl`);
    assert.equal(artifact.artifact_type, "engine_output");
    assert.deepEqual(jsonl(objects.get(artifact.storage_key)!), resolved.bindings);
    assert.equal(value.binding_digest, resolved.binding_digest); assert.equal(value.editorial_cut_digest, resolved.editorial_cut_digest);
    if (lastArtifact) assert.deepEqual(artifact, lastArtifact); if (summary) assert.deepEqual(value, summary);
    lastArtifact = structuredClone(artifact); summary = structuredClone(value); uploads.push(structuredClone(artifact));
  }
  const stores: Stores = {
    read: async args => { guard(args); events.push("read"); return structuredClone(d); },
    heartbeat: async args => { guard(args); },
    roots: async args => { readGuard(args); counts.roots++; assert.equal(args.limit, 128);
      const all = roots.filter(root => !args.after_root_id || root.root_id > args.after_root_id), items = all.slice(0, 128);
      counts.root_items += items.length; events.push(`roots:${items.length}`);
      return { items, next_cursor: items.at(-1)?.root_id ?? null, done: all.length <= 128 }; },
    topics: async args => { readGuard(args); counts.topics++; assert.equal(args.limit, 128);
      const all = topics.filter(topic => !args.after_term_key || topic.definition.term_key > args.after_term_key), items = all.slice(0, 128);
      return { items, next_cursor: items.at(-1)?.definition.term_key ?? null, done: all.length <= 128 }; },
    proposals: async args => { readGuard(args); counts.proposals++; assert.equal(args.limit, 32);
      const all = proposals.filter(proposal => !args.after_artifact_id || proposal.artifact_id > args.after_artifact_id), items = all.slice(0, 32);
      return { items, next_cursor: items.at(-1)?.artifact_id ?? null, done: all.length <= 32 }; },
    units: async args => { readGuard(args); counts.units++; events.push("units:durable");
      assert.ok(args.units.length > 0 && args.units.length <= 128); assert.equal("artifact" in args, false);
      assert.equal(counts.root_items % Math.max(1, roots.length), 0);
      for (const unit of args.units) {
        assert.deepEqual(unit, expectedUnits.find(row => row.unit_key === unit.unit_key));
        const prior = durableUnits.get(unit.unit_key); if (prior) assert.deepEqual(unit, prior);
        durableUnits.set(unit.unit_key, structuredClone(unit));
      }
      if (unitAckLost) { unitAckLost = false; throw Object.assign(new Error("Synthetic lost COMMIT ACK after unit census"), { code: "ECONNRESET" }); }
    },
    bindings: async args => { readGuard(args); counts.bindings++; events.push("bindings:durable"); assert.ok(args.bindings.length <= 128);
      assert.equal(durableUnits.size, expectedUnits.length);
      assert.equal(counts.root_items % Math.max(1, roots.length), 0, "every attempt validates the full current root population first");
      saveArtifact(args.artifact, args.summary);
      const items = args.bindings.map(binding => { const prior = durableBindings.get(binding.unit_key);
        if (prior) assert.deepEqual(binding, prior); durableBindings.set(binding.unit_key, structuredClone(binding));
        return { artifact_id: id(4000 + resolved.bindings.findIndex(row => row.unit_key === binding.unit_key)), replayed: Boolean(prior) }; });
      if (bindingAckLost) { bindingAckLost = false; throw Object.assign(new Error("Synthetic lost COMMIT ACK after binding rows"), { code: "ECONNRESET" }); } return { items }; },
    finish: async args => { readGuard(args); counts.finish++; events.push("finish:durable"); saveArtifact(args.artifact, args.summary);
      assert.equal(durableBindings.size, resolved.bindings.length); assert.equal(durableUnits.size, expectedUnits.length);
      if (!d.completed_projection) { counts.generation++; d.completed_projection = { binding_artifact_id: id(6000), projection_execution_id: id(6001), generation_id: id(6002), replayed: false }; }
      outbox = "completed";
      const result: Result = structuredClone(d.completed_projection); d.completed_projection.replayed = true;
      if (finishAckLost) { finishAckLost = false; throw Object.assign(new Error("Synthetic lost COMMIT ACK after complete"), { code: "ECONNRESET" }); } return result; },
    completeDispatch: async args => { readGuard(args); counts.completeDispatch++; outbox = "completed"; },
    fail: async args => { guard(args); failures.push(args.error_code); if (outbox !== "completed") outbox = "failed"; }
  };
  const options: Options = { database: {} as Options["database"], stores, storage, scratch_root: scratch };
  const job = { id: scope.worker_job_id, data: { execution_id: scope.execution_id, workspace_id: scope.workspace_id, actor_user_id: scope.actor_user_id }, updateProgress: async () => undefined };
  const invoke = (override: Options = {}) => {
    if (outbox === "failed") {
      assert.equal(failures.at(-1), "workspace_incremental_projection_transport_unavailable", "only an explicit transient failure permits automatic redispatch");
      outbox = "dispatched";
    }
    return run(job, { ...options, ...override });
  };
  const assertNumericUnchanged = () => { assert.equal(digest({ snapshot: d.snapshot, checkpoint: d.numeric_checkpoint, artifacts: refs }), immutableBefore);
    for (const [key, hash] of originalObjects) assert.equal(sha(objects.get(key)!), hash); };
  return { invoke, stores, storage, d, roots, proposals, packets, topics, refs, objects, counts, events, failures, uploads, resolved, manifest, scratch, inputDirectory,
    durableBindings, durableUnits, get summary() { return summary; }, get artifact() { return lastArtifact; }, get outbox() { return outbox; },
    loseUnitAck: () => { unitAckLost = true; },
    loseBindingAck: () => { bindingAckLost = true; }, loseFinishAck: () => { finishAckLost = true; }, assertNumericUnchanged,
    cleanup: () => rm(scratch, { recursive: true, force: true }) };
}
