import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as configuration,
  signalWorkspaceEmbeddingDigestV1 as digest, signalWorkspaceInterpretationReferenceIdV1,
  signalWorkspaceInterpretationUniverseDigestV1, signalWorkspaceInterpretationCostV1,
  type SignalWorkspaceInterpretationClusterV1,
} from "@noisia/query-engine";
import {
  SignalWorkspaceEngineInterpretationError,
  type SignalWorkspaceIncrementalEditorialLeaseV1, type SignalWorkspaceIncrementalEditorialCheckpointV1,
  type SignalWorkspaceEngineInterpretationCallV1,
} from "@noisia/db";
import { sendWorkspaceInterpretationV1 } from "../providers/workspace-interpretation";
import { runWorkspaceIncrementalEditorialConsumerV1 as consume, type WorkspaceIncrementalEditorialConsumerOptionsV1 as Options } from "./signal-workspace-incremental-editorial-consumer";
import type { WorkspaceIncrementalEditorialBatchPlanV1 as Plan } from "./signal-workspace-incremental-editorial-batches";
import type { WorkspaceIncrementalEditorialEvidenceDescriptorV1 as Descriptor } from "./signal-workspace-incremental-editorial-evidence";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (body: Uint8Array | string) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
type Stores = NonNullable<Options["stores"]>;
type BatchStores = NonNullable<Options["batch_stores"]>;
type Stored = Parameters<Stores["persistPlan"]>[0]["stored"];

async function scenario(count = 9) {
  const directory = await mkdtemp(join(tmpdir(), "noisia-editorial-consumer-test-"));
  const files = new Map<string, Buffer>(), events: string[] = [], failures: string[] = [];
  const context = { workspace_id: id(1), execution_id: id(2), context_digest: digest("context"), data: { interests: [] } };
  const units: Descriptor["units"] = [], clusters: SignalWorkspaceInterpretationClusterV1[] = [];
  for (let index = 0; index < count; index++) {
    const unit_key = `open:unit_${String(index).padStart(6, "0")}`, text = `Conversación ${index} sobre la atención recibida.`;
    const ref = { root_id: id(1000 + index), chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text) };
    units.push({ unit_key, component_key: sha("component"), local_label: index,
      birth_membership_digest: sha(`birth${index}`), model_origin: { execution_id: id(3), model_artifact_sha256: sha("model") },
      lane: "open", status: "evidence_ready", root_count: 3, chunk_count: 3, cluster_digest: sha(`cluster${index}`) });
    clusters.push({ cluster_id: unit_key, cluster_digest: sha(`cluster${index}`), lane: "open", root_count: 3, chunk_count: 3,
      terms: ["atención"], representatives: [{ ...ref, ref_id: signalWorkspaceInterpretationReferenceIdV1(ref), text,
        strength: 0.8, selection_reason: "high_affiliation" }] });
  }
  const evidence = clusters.map((cluster, index) => JSON.stringify({ contract_version: "workspace-incremental-editorial-evidence-unit-v1",
    unit: units[index], cluster }) + "\n").join("");
  const base: Omit<Descriptor, "evidence_digest"> = { contract_version: "workspace-incremental-editorial-evidence-stream-v1",
    numeric_execution_id: id(4), numeric_checkpoint_digest: sha("checkpoint"), numeric_manifest_sha256: sha("manifest"),
    population_digest: sha("population"), representative_selection_policy: "distinct-roots-affiliation-boundary-v1",
    census: { roots: count * 3, chunks: count * 3, memberships: count * 3, pending_roots: count * 3, pending_occurrences: count * 3,
      expected_unit_count: count, expected_unit_digest: signalWorkspaceInterpretationUniverseDigestV1(units.map(unit => unit.unit_key)), population_digest: sha("population") },
    numeric_component_order: [sha("component")], origins: [{ execution_id: id(3), manifest_sha256: sha("birth"), candidate_sha256: sha("candidate") }],
    units, target_unit_digest: signalWorkspaceInterpretationUniverseDigestV1(units.map(unit => unit.unit_key)),
    target_binding_digest: digest(units.map(({ component_key, local_label, unit_key, birth_membership_digest, model_origin }) =>
      ({ component_key, unit: { local_label, unit_key, birth_membership_digest }, model_origin }))),
    stream: { contract_version: "workspace-incremental-editorial-evidence-jsonl-v1", rows: count, bytes: Buffer.byteLength(evidence), sha256: sha(evidence) } };
  const descriptor = { ...base, evidence_digest: digest(base) };
  const lease: SignalWorkspaceIncrementalEditorialLeaseV1 = {
    execution_id: id(2), workspace_id: id(1), actor_user_id: id(5), worker_job_id: "local-editorial-1", execution_token: id(6), input_digest: sha("input"),
    config: { call_configuration: configuration, budget_timezone: "UTC", daily_cap_micro_usd: 10_000_000 },
    numeric_execution_id: id(4), numeric_checkpoint_digest: base.numeric_checkpoint_digest, evidence_plan_artifact_id: id(7),
    evidence_digest: descriptor.evidence_digest, target_unit_digest: base.target_unit_digest, target_binding_digest: base.target_binding_digest, target_units: count,
    interpretation_admission: { contract_version: "workspace-incremental-editorial-admission-v1", operation_id: id(8),
      execution_id: id(2), workspace_id: id(1), action: "authorize_interpretation", grant_digest: sha("grant"), prior_admission_operation_id: null,
      authorized_by_user_id: id(5), budget_actor_user_id: id(5), input_digest: sha("input"), numeric_execution_id: id(4),
      numeric_checkpoint_digest: base.numeric_checkpoint_digest, target_unit_digest: base.target_unit_digest, target_binding_digest: base.target_binding_digest,
      evidence_plan_artifact_id: id(7), configuration_digest: digest(configuration), budget_timezone: "UTC", budget_date: "2026-09-09",
      authorized_at: "2026-09-09T00:00:00.000Z", admission_not_after: "2026-09-10T00:00:00.000Z",
      grant_cap_micro_usd: 5_000_000, run_cap_micro_usd: 5_000_000, daily_cap_micro_usd: 10_000_000 },
  };
  const evidenceStored = { storage_key: `workspace-engine/${id(1)}/${id(4)}/evidence`, sha256: sha(evidence), size_bytes: Buffer.byteLength(evidence), media_type: "application/x-ndjson" };
  files.set(evidenceStored.storage_key, Buffer.from(evidence));
  let plan: Plan | null = null, planStored: Stored | null = null, ready = false;
  const checkpoints: SignalWorkspaceIncrementalEditorialCheckpointV1[] = [], calls = new Map<string, SignalWorkspaceEngineInterpretationCallV1>();
  const byId = new Map<string, SignalWorkspaceEngineInterpretationCallV1>(), repairRequests = new Set<string>();
  const flags = { planAck: false, checkpointAck: false, finishAck: false, stopAfterPlan: false, stopBeforeCheckpoint: false,
    responseAck: false, responseAckConfirmed: true, settlementAck: false, invalidBase: false, invalidRepair: false, unknown: false,
    stopBeforeRepair: false, reserveError: "", heartbeatError: false, heartbeatWhileSend: false, storageError: "", failCheckpointAfter: -1,
    heartbeatFailsAfterReserve: false, responseReadError: false };
  let sends = 0, settled = 0, heartbeatCount = 0, unitReads = 0, evidenceReads = 0, planWrites = 0;
  const callFor = (callId: string) => { const value = byId.get(callId); assert.ok(value); return value; };
  const stores: Stores = {
    claim: async args => {
      assert.equal(args.execution_id, lease.execution_id); assert.equal(args.worker_job_id, lease.worker_job_id);
      events.push("claim"); return ready ? { completed: true, execution_id: lease.execution_id, worker_job_id: lease.worker_job_id } : structuredClone(lease);
    },
    heartbeat: async () => { heartbeatCount++; if (flags.heartbeatError) throw new Error("workspace_incremental_editorial_lease_conflict"); return { heartbeat: true }; },
    context: async () => {
      const { units: _units, ...header } = descriptor; void _units;
      return { context, lease: structuredClone(lease), evidence: { artifact_id: lease.evidence_plan_artifact_id, descriptor: header, stored: evidenceStored } };
    },
    units: async args => { unitReads++; return units.filter(unit => args.after_unit_key === undefined || unit.unit_key > args.after_unit_key).slice(0, args.limit); },
    plan: async () => {
      if (!plan || !planStored) return null;
      if (flags.stopAfterPlan) throw new Error("workspace_incremental_editorial_transport_unavailable");
      const { requests: _requests, ...header } = structuredClone(plan); void _requests;
      return { artifact_id: id(9), plan: header, stored: planStored };
    },
    requests: async args => plan!.requests.filter(request => request.index > (args.after_index ?? -1)).slice(0, args.limit)
      .map(request => ({ artifact_id: id(10000 + request.index), request: structuredClone(request), stored: planStored! })),
    checkpoints: async args => structuredClone(checkpoints.filter(item => args.after_artifact_id === undefined || item.artifact_id > args.after_artifact_id)
      .sort((a, b) => a.artifact_id.localeCompare(b.artifact_id)).slice(0, args.limit)),
    persistPlan: async args => {
      events.push("plan"); planWrites++; assert.equal(args.stored.sha256, args.plan.stream.sha256);
      plan = structuredClone(args.plan); planStored = args.stored;
      if (flags.planAck) { flags.planAck = false; throw new Error("lost plan COMMIT ACK"); }
      return { artifact_id: id(9), plan_digest: plan.plan_digest, replayed: false };
    },
    repair: async args => {
      events.push("repair-plan"); assert.equal(args.batch.editorial_repair?.source_request_digest, args.original.request_digest);
      repairRequests.add(args.batch.request_digest);
      if (flags.stopBeforeRepair) { flags.stopBeforeRepair = false; throw new Error("workspace_incremental_editorial_transport_unavailable"); }
      return { artifact_id: id(11), replayed: false };
    },
    checkpoint: async args => {
      assert.equal(callFor(args.call_id).state, "settled");
      if (flags.stopBeforeCheckpoint) { flags.stopBeforeCheckpoint = false; throw new Error("workspace_incremental_editorial_transport_unavailable"); }
      if (flags.failCheckpointAfter === checkpoints.length) { flags.failCheckpointAfter = -1; throw new Error("workspace_incremental_editorial_transport_unavailable"); }
      const previous = checkpoints.find(item => item.call_id === args.call_id);
      const item = { artifact_id: previous?.artifact_id ?? id(20000 + checkpoints.length), artifact_key: `editorial-checkpoint-${args.call_id}`,
        stored: args.stored, call_id: args.call_id, request_digest: args.batch.request_digest,
        unit_keys: args.batch.clusters.map(cluster => cluster.cluster_id), response_sha256: args.response_sha256 };
      if (previous) assert.deepEqual(previous, item); else checkpoints.push(item);
      const packet = files.get(args.stored.storage_key)!;
      assert.notEqual(packet.at(-1), 10, "Checkpoint body has no newline");
      assert.equal(JSON.parse(packet.toString()).contract_version, "workspace-incremental-editorial-result-v1");
      events.push("checkpoint");
      if (flags.checkpointAck) { flags.checkpointAck = false; throw new Error("lost checkpoint COMMIT ACK"); }
      return { artifact_id: item.artifact_id, replayed: Boolean(previous) };
    },
    finish: async () => {
      assert.equal(checkpoints.length, plan!.batches); assert.equal(checkpoints.flatMap(item => item.unit_keys).length, count);
      const replayed = ready; ready = true; events.push("finish");
      if (flags.finishAck) { flags.finishAck = false; throw new Error("lost finish COMMIT ACK"); }
      return { execution_id: lease.execution_id, ready: true, replayed };
    },
    fail: async args => { failures.push(args.error_code); return { failed: true }; },
  };
  const batchStores: BatchStores = {
    reserve: async args => {
      assert.ok(plan); assert.equal(args.execution_id, lease.execution_id); assert.notEqual(args.execution_id, lease.numeric_execution_id);
      assert.equal(args.actor_user_id, lease.actor_user_id); assert.equal(args.admission_operation_id, lease.interpretation_admission.operation_id);
      assert.deepEqual(args.configuration, configuration); assert.equal(args.daily_cap_micro_usd, lease.config.daily_cap_micro_usd);
      events.push("reserve");
      if (flags.reserveError) throw new SignalWorkspaceEngineInterpretationError(flags.reserveError, 409);
      if (args.editorial_repair) assert.ok(repairRequests.has(args.request_digest), "Repair must be durable before reserve/send");
      const previous = calls.get(args.idempotency_key);
      if (previous) { assert.equal(previous.request_digest, args.request_digest); return structuredClone(previous); }
      const call: SignalWorkspaceEngineInterpretationCallV1 = { call_id: id(30000 + calls.size), execution_id: lease.execution_id, workspace_id: lease.workspace_id,
        attempt_token: id(40000 + calls.size), retry_of_call_id: args.retry_of_call_id ?? null, editorial_repair: args.editorial_repair ?? null,
        state: "reserved", request_digest: args.request_digest, reserved_micro_usd: args.reserved_micro_usd, settled_micro_usd: null,
        response: null, interpretation_revision_digest: null, admission: { operation_id: lease.interpretation_admission.operation_id,
          grant_digest: lease.interpretation_admission.grant_digest, admission_not_after: lease.interpretation_admission.admission_not_after } };
      calls.set(args.idempotency_key, call); byId.set(call.call_id, call);
      if (flags.heartbeatFailsAfterReserve) flags.heartbeatError = true;
      return structuredClone(call);
    },
    sent: async args => { const call = callFor(args.call_id); const send_authorized = call.state === "reserved";
      if (send_authorized) call.state = "in_flight"; return { call, send_authorized }; },
    response: async args => {
      const call = callFor(args.call_id); call.response = { ...args.response, complete: args.response.complete === true }; call.state = "response_persisted"; events.push("response");
      if (flags.responseAck) { flags.responseAck = false; throw new Error("lost raw receipt COMMIT ACK"); }
      return structuredClone(call);
    },
    settle: async args => {
      const call = callFor(args.call_id); assert.ok(call.response?.complete);
      if (call.state !== "settled") { call.settled_micro_usd = signalWorkspaceInterpretationCostV1(args.usage, configuration); settled += call.settled_micro_usd; }
      call.state = "settled";
      if (flags.settlementAck) { flags.settlementAck = false; throw new Error("lost settlement ACK"); }
      return structuredClone(call);
    },
    fail: async args => {
      const call = callFor(args.call_id);
      if (call.state === "response_persisted" && flags.responseAckConfirmed
        && args.error_code === "workspace_engine_interpretation_receipt_persistence_unknown") return structuredClone(call);
      if (call.state !== "settled") call.state = args.outcome;
      return structuredClone(call);
    },
  };
  const storage: NonNullable<Options["storage"]> = {
    put: async args => {
      if (flags.storageError) throw new Error(flags.storageError);
      const bytes = await readFile(args.file); assert.equal(sha(bytes), args.sha256); assert.equal(bytes.length, args.size_bytes);
      const storage_key = `workspace-engine/${args.workspace_id}/${args.execution_id}/${args.sha256.slice(7)}`;
      if (files.has(storage_key)) assert.deepEqual(files.get(storage_key), bytes);
      files.set(storage_key, bytes); return { storage_key, sha256: args.sha256, size_bytes: bytes.length, media_type: args.media_type };
    },
    get: async args => {
      assert.ok(args.stored.storage_key.startsWith(`workspace-engine/${args.workspace_id}/${args.execution_id}/`));
      if (flags.responseReadError && args.destination.includes("/response-")) throw new Error("workspace_engine_storage_unavailable");
      if (args.execution_id === lease.numeric_execution_id) evidenceReads++;
      const bytes = files.get(args.stored.storage_key); assert.ok(bytes); await writeFile(args.destination, bytes, { flag: "wx" });
    },
  };
  const send: NonNullable<Options["send"]> = async args => sendWorkspaceInterpretationV1({ ...args,
    // A fixed clock belongs only to this local transport fixture, never product.
    now_milliseconds: () => Date.parse("2026-09-09T12:00:00.000Z"), fetch_impl: async () => {
      sends++; events.push(args.batch.editorial_repair ? "send-repair" : "send");
      if (flags.heartbeatWhileSend) { flags.heartbeatError = true; await new Promise(resolve => setTimeout(resolve, 15500)); }
      if (flags.unknown) throw new Error("local simulated socket disconnect");
      const invalid = args.batch.editorial_repair ? flags.invalidRepair : flags.invalidBase;
      const output = { interpretations: args.batch.clusters.map(cluster => ({ cluster_id: cluster.cluster_id, cluster_digest: cluster.cluster_digest,
        status: "coherent", name: "Atención recibida", definition: "Conversaciones que describen la atención recibida.", inclusion: [], exclusion: [],
        citations: [invalid ? "x" : "r1"] })) };
      return new Response(JSON.stringify({ model: args.batch.configuration.model, type: "message", role: "assistant", stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(output) }] }), { status: 200 });
    } });
  const options: Options = { database: {} as Options["database"], execution_id: lease.execution_id, worker_job_id: lease.worker_job_id,
    stores, batch_stores: batchStores, storage, storage_root: directory, send, api_key: "local_fake_key_not_a_credential", provider_enabled: true };
  return { run: () => consume(options), options, lease, descriptor, files, evidenceStored, flags, stores, checkpoints, calls, events, failures,
    state: () => ({ sends, settled, ready, plan, planStored, planWrites, unitReads, evidenceReads, heartbeatCount }),
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("native consumer persists the complete request plan, then every exact checkpoint; ready ACK does zero IO", async () => {
  const s = await scenario(9);
  try {
    assert.equal((await s.run()).completed, true);
    const first = s.state(); assert.equal(first.plan!.units, 9); assert.equal(first.sends, first.plan!.batches);
    assert.ok(s.events.indexOf("plan") < s.events.indexOf("reserve")); assert.equal(first.planWrites, 1);
    assert.equal(s.checkpoints.flatMap(item => item.unit_keys).length, 9);
    const before = { ...first }; s.options.storage = undefined; // No config or storage needed after the durable ready ACK.
    assert.deepEqual(await s.run(), { execution_id: s.lease.execution_id, completed: true, replayed: true });
    assert.deepEqual(s.state(), before); assert.deepEqual(s.failures, []);
  } finally { await s.cleanup(); }
});

test("lost plan/checkpoint/finish acknowledgements are confirmed without regrouping or extra sends", async t => {
  for (const kind of ["planAck", "checkpointAck", "finishAck"] as const) await t.test(kind, async () => {
    const s = await scenario();
    try { s.flags[kind] = true; assert.equal((await s.run()).completed, true);
      assert.equal(s.state().sends, s.state().plan!.batches); assert.equal(s.state().planWrites, 1); assert.deepEqual(s.failures, []);
    } finally { await s.cleanup(); }
  });
});

test("a persisted plan restores exact requests after restart, without reading evidence or staging again", async () => {
  const s = await scenario();
  try {
    s.flags.stopAfterPlan = true; await assert.rejects(s.run(), /transport_unavailable/u); assert.equal(s.state().sends, 0);
    const original = structuredClone(s.state().plan), reads = s.state().evidenceReads;
    s.flags.stopAfterPlan = false; assert.equal((await s.run()).completed, true);
    assert.deepEqual(s.state().plan, original); assert.equal(s.state().planWrites, 1); assert.equal(s.state().evidenceReads, reads);
  } finally { await s.cleanup(); }
});

test("settled raw outputs replay with provider disabled, preserving settled cost and same request", async t => {
  for (const kind of ["stopBeforeCheckpoint", "settlementAck"] as const) await t.test(kind, async () => {
    const s = await scenario(1);
    try {
      s.flags[kind] = true; await assert.rejects(s.run()); const first = s.state(); assert.equal(first.sends, 1);
      s.options.provider_enabled = false; assert.equal((await s.run()).completed, true);
      assert.equal(s.state().sends, 1); assert.equal(s.state().settled, first.settled); assert.equal(s.calls.size, 1);
    } finally { await s.cleanup(); }
  });
});

test("partial delivery skips certified units and replays the next paid receipt before sending only the remaining batch", async () => {
  const s = await scenario();
  try {
    s.flags.failCheckpointAfter = 1;
    await assert.rejects(s.run(), /transport_unavailable/u);
    assert.equal(s.checkpoints.length, 1); assert.equal(s.state().sends, 2);
    const firstCheckpoint = structuredClone(s.checkpoints[0]), firstPlan = structuredClone(s.state().plan);
    const reservations = s.events.filter(event => event === "reserve").length;
    await s.run();
    assert.deepEqual(s.state().plan, firstPlan); assert.deepEqual(s.checkpoints[0], firstCheckpoint);
    assert.equal(s.state().sends, 3); assert.equal(s.calls.size, 3);
    assert.equal(s.events.filter(event => event === "reserve").length - reservations, 2,
      "The certified first batch must not even reserve/replay again");
  } finally { await s.cleanup(); }
});

test("a revoke between claim/context preserves paid checkpoints without permitting a new send", async () => {
  const s = await scenario();
  try {
    await s.run(); const reservations = s.events.filter(event => event === "reserve").length, before = s.state();
    s.stores.claim = async () => structuredClone(s.lease);
    const original = s.stores.context;
    s.stores.context = async args => { const result = await original(args);
      result.lease.interpretation_admission = { ...result.lease.interpretation_admission,
        action: "revoke_interpretation", operation_id: id(777), grant_digest: sha("revoked") };
      return result;
    };
    s.options.provider_enabled = false;
    assert.equal((await s.run()).completed, true);
    assert.equal(s.state().sends, before.sends); assert.equal(s.state().settled, before.settled);
    assert.equal(s.events.filter(event => event === "reserve").length, reservations);
  } finally { await s.cleanup(); }
});

test("temporary storage failure reading a paid raw receipt remains recoverable with provider disabled", async () => {
  const s = await scenario(1);
  try {
    s.flags.stopBeforeCheckpoint = true; await assert.rejects(s.run());
    const paid = s.state().settled; s.options.provider_enabled = false; s.flags.responseReadError = true;
    await assert.rejects(s.run(), { message: "workspace_incremental_editorial_transport_unavailable" });
    assert.equal([...s.calls.values()][0]!.state, "settled"); assert.equal(s.state().sends, 1);
    s.flags.responseReadError = false; await s.run();
    assert.equal(s.state().sends, 1); assert.equal(s.calls.size, 1); assert.equal(s.state().settled, paid);
  } finally { await s.cleanup(); }
});

test("raw receipt ACK uncertainty is safe transport only with DB-confirmed complete response", async t => {
  for (const confirmed of [true, false]) await t.test(String(confirmed), async () => {
    const s = await scenario(1);
    try {
      s.flags.responseAck = true; s.flags.responseAckConfirmed = confirmed; await assert.rejects(s.run());
      assert.equal(s.failures.at(-1), confirmed ? "workspace_incremental_editorial_transport_unavailable" : "workspace_engine_interpretation_receipt_persistence_unknown");
      s.options.provider_enabled = false;
      if (confirmed) assert.equal((await s.run()).completed, true);
      else await assert.rejects(s.run(), /outcome_unknown/u);
      assert.equal(s.state().sends, 1); assert.equal(s.calls.size, 1);
    } finally { await s.cleanup(); }
  });
});

test("unknown send outcome stays unknown and never repairs, resends or finishes", async () => {
  const s = await scenario();
  try {
    s.flags.unknown = true; await assert.rejects(s.run()); await assert.rejects(s.run(), /outcome_unknown/u);
    assert.equal(s.state().sends, 1); assert.equal(s.calls.size, 1); assert.equal(s.checkpoints.length, 0);
    assert.equal(s.events.includes("repair-plan"), false); assert.equal(s.state().ready, false);
    assert.ok(s.failures.every(code => code !== "workspace_incremental_editorial_transport_unavailable"));
  } finally { await s.cleanup(); }
});

test("a generic batch failure cannot be promoted to safe transport merely by its storage-looking message", async () => {
  const s = await scenario(1);
  try {
    s.options.send = async () => { throw new Error("workspace_engine_storage_transport_failed"); };
    await assert.rejects(s.run());
    assert.equal(s.failures.at(-1), "workspace_incremental_editorial_worker_failed");
    assert.equal([...s.calls.values()][0]!.state, "outcome_unknown");
  } finally { await s.cleanup(); }
});

test("exactly one editorial repair is durable before reserve/send and its checkpoint is canonical", async () => {
  const s = await scenario(1);
  try {
    s.flags.invalidBase = true; assert.equal((await s.run()).completed, true);
    assert.equal(s.state().sends, 2); assert.equal(s.calls.size, 2);
    assert.ok(s.events.indexOf("repair-plan") < s.events.indexOf("send-repair"));
    const packet = JSON.parse(s.files.get(s.checkpoints[0]!.stored.storage_key)!.toString());
    assert.equal(packet.editorial_repair.contract_version, "workspace-editorial-repair-v1");
    assert.equal(packet.editorial_repair.diagnostic, "output_invalid"); assert.match(packet.interpretations[0].citations[0], /^sha256:/u);
  } finally { await s.cleanup(); }
});

test("a failed repair seal exits before its send; restart reuses base receipt and same repair", async () => {
  const s = await scenario(1);
  try {
    s.flags.invalidBase = true; s.flags.stopBeforeRepair = true; await assert.rejects(s.run(), /transport_unavailable/u);
    assert.equal(s.state().sends, 1); const baseCost = s.state().settled;
    assert.equal((await s.run()).completed, true); assert.equal(s.state().sends, 2); assert.equal(s.calls.size, 2);
    assert.equal(s.state().settled, baseCost * 2);
  } finally { await s.cleanup(); }
});

test("a second invalid result cannot recursively repair on restart", async () => {
  const s = await scenario(1);
  try {
    s.flags.invalidBase = true; s.flags.invalidRepair = true;
    await assert.rejects(s.run(), /repair_invalid/u); await assert.rejects(s.run(), /repair_invalid/u);
    assert.equal(s.state().sends, 2); assert.equal(s.calls.size, 2); assert.equal(s.checkpoints.length, 0);
  } finally { await s.cleanup(); }
});

test("all checkpoint bytes/citations are checked before any remaining request is reserved", async t => {
  for (const kind of ["bytes", "citation", "duplicate", "foreign_units"] as const) await t.test(kind, async () => {
    const s = await scenario();
    try {
      await s.run(); const before = s.state().sends;
      // Simulate a reclaimed nonterminal delivery with a valid partial checkpoint set.
      s.stores.claim = async () => structuredClone(s.lease);
      s.checkpoints.splice(1);
      const cp = s.checkpoints[0]!;
      if (kind === "bytes") s.files.set(cp.stored.storage_key, Buffer.from("bad"));
      if (kind === "citation") {
        const packet = JSON.parse(s.files.get(cp.stored.storage_key)!.toString()); packet.interpretations[0].citations = [sha("invented")];
        const bytes = Buffer.from(JSON.stringify(packet)); s.files.set(cp.stored.storage_key, bytes);
        cp.stored.sha256 = sha(bytes); cp.stored.size_bytes = bytes.length;
      }
      if (kind === "duplicate") s.checkpoints.push({ ...structuredClone(cp), artifact_id: id(99999) });
      if (kind === "foreign_units") cp.unit_keys[0] = "open:foreign";
      await assert.rejects(s.run(), /checkpoint_invalid/u); assert.equal(s.state().sends, before);
    } finally { await s.cleanup(); }
  });
});

test("corrupt final evidence prevents the first plan write and reserve", async () => {
  const s = await scenario();
  try {
    s.files.set(s.evidenceStored.storage_key, Buffer.from("corrupt last line\n"));
    await assert.rejects(s.run(), /batches_source_changed/u); assert.equal(s.state().planWrites, 0); assert.equal(s.calls.size, 0);
  } finally { await s.cleanup(); }
});

test("changed final durable request prevents any new reservation", async () => {
  const s = await scenario();
  try {
    s.flags.stopAfterPlan = true; await assert.rejects(s.run()); s.flags.stopAfterPlan = false;
    s.state().plan!.requests.at(-1)!.reserved_micro_usd++;
    await assert.rejects(s.run(), /batches_plan_invalid/u); assert.equal(s.calls.size, 0);
  } finally { await s.cleanup(); }
});

test("paging covers 513 units/129 requests without truncating the final batch", async () => {
  const s = await scenario(513);
  try {
    await s.run(); assert.equal(s.state().unitReads, 5); assert.equal(s.state().plan!.requests.length, 129);
    assert.equal(s.checkpoints.flatMap(item => item.unit_keys).length, 513); assert.equal(s.state().sends, 129);
    // A recovered lease may have every checkpoint yet have lost the final ACK.
    // Read both checkpoint pages and verify all bodies without reserving again.
    const reservations = s.events.filter(event => event === "reserve").length;
    s.stores.claim = async () => structuredClone(s.lease); s.options.provider_enabled = false;
    await s.run(); assert.equal(s.state().sends, 129);
    assert.equal(s.events.filter(event => event === "reserve").length, reservations);
  } finally { await s.cleanup(); }
});

test("current server authority rejects reserve without sending or recreating admission", async () => {
  const s = await scenario();
  try {
    s.flags.reserveError = "workspace_engine_interpretation_daily_authority_expired";
    await assert.rejects(s.run(), /daily_authority_expired/u); assert.equal(s.state().sends, 0); assert.equal(s.calls.size, 0);
    assert.equal(s.failures.at(-1), s.flags.reserveError);
  } finally { await s.cleanup(); }
});

test("empty evidence and mismatched execution ownership fail before storage admission or reserve", async t => {
  for (const kind of ["empty", "numeric_owner", "context", "grant_configuration"] as const) await t.test(kind, async () => {
    const s = await scenario(kind === "empty" ? 0 : 1);
    try {
      if (kind === "numeric_owner") s.lease.numeric_execution_id = s.lease.execution_id;
      if (kind === "context") {
        const original = s.stores.context;
        s.stores.context = async args => { const result = await original(args); result.context.execution_id = id(999); return result; };
      }
      if (kind === "grant_configuration") s.lease.config.call_configuration = { ...configuration, model: "claude-opus-5" };
      await assert.rejects(s.run(), /workspace_incremental_editorial_/u);
      assert.equal(s.state().sends, 0); assert.equal(s.calls.size, 0); assert.equal(s.state().planWrites, 0);
    } finally { await s.cleanup(); }
  });
});

test("storage transport is recoverable but arbitrary storage errors are not safe send evidence", async t => {
  for (const code of ["workspace_engine_storage_transport_failed", "workspace_engine_storage_verification_failed", "arbitrary socket message"]) await t.test(code, async () => {
    const s = await scenario();
    try {
      s.flags.storageError = code; await assert.rejects(s.run()); assert.equal(s.state().sends, 0);
      assert.equal(s.failures.at(-1), code === "workspace_engine_storage_transport_failed"
        ? "workspace_incremental_editorial_transport_unavailable" : "workspace_incremental_editorial_worker_failed");
    } finally { await s.cleanup(); }
  });
});

test("heartbeat continues during a pending send; lost lease preserves its receipt but stops the next batch", { timeout: 25000 }, async () => {
  const s = await scenario();
  try {
    s.flags.heartbeatWhileSend = true; await assert.rejects(s.run(), /lease_conflict/u);
    assert.ok(s.state().heartbeatCount > 1); assert.equal(s.state().sends, 1); assert.ok(s.state().settled > 0);
    assert.equal(s.checkpoints.length, 0); assert.equal(s.state().ready, false);
  } finally { await s.cleanup(); }
});

test("heartbeat failure while reservation waits cannot enter send/CAS afterward", async () => {
  const s = await scenario(1);
  try {
    s.flags.heartbeatFailsAfterReserve = true;
    await assert.rejects(s.run(), { message: "workspace_incremental_editorial_worker_failed" });
    assert.equal(s.state().sends, 0); assert.equal(s.state().ready, false);
    assert.equal([...s.calls.values()][0]!.state, "outcome_unknown", "No optimistic release or retry after lease uncertainty");
  } finally { await s.cleanup(); }
});

test("private errors from claim or an active delivery never escape into the job failure message", async t => {
  for (const phase of ["claim", "delivery"] as const) await t.test(phase, async () => {
    const s = await scenario(1);
    try {
      const privateMessage = "postgres detail: /private/actor/example confidential-content";
      if (phase === "claim") s.stores.claim = async () => { throw new Error(privateMessage); };
      else s.flags.storageError = privateMessage;
      await assert.rejects(s.run(), { message: "workspace_incremental_editorial_worker_failed" });
      assert.equal(s.state().sends, 0); assert.equal(s.failures.includes(privateMessage), false);
    } finally { await s.cleanup(); }
  });
});
