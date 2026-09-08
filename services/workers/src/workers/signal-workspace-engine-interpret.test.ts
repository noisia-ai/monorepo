import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as config, signalWorkspaceInterpretationReferenceIdV1,
  SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  type SignalWorkspaceInterpretationClusterV1 } from "@noisia/query-engine";
import type { SignalWorkspaceEngineInterpretationCallV1, SignalWorkspaceEngineLeaseV1 } from "@noisia/db";
import { sendWorkspaceInterpretationV1 } from "../providers/workspace-interpretation";
import { interpretWorkspaceEngineV1 } from "./signal-workspace-engine-interpret";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const cluster: SignalWorkspaceInterpretationClusterV1 = (() => {
  const text = "El cobro de la renta fue distinto al de la reserva.";
  const identity = { root_id: uuid(3), chunk_index: 0, start: 0, end: text.length, chunk_sha256: hash(text) };
  return { cluster_id: "open:cluster_one", cluster_digest: hash("all three roots"), lane: "open", root_count: 3, chunk_count: 3,
    terms: ["cobro", "reserva"], representatives: [{ ...identity, ref_id: signalWorkspaceInterpretationReferenceIdV1(identity),
      text, strength: 0.9, selection_reason: "high_affiliation" }] };
})();

async function scenario() {
  type Args = Parameters<typeof interpretWorkspaceEngineV1>[0];
  const directory = await mkdtemp(join(tmpdir(), "noisia-interpretation-test-"));
  const files = new Map<string, Buffer>(); let call: SignalWorkspaceEngineInterpretationCallV1 | null = null;
  let sends = 0, fitCount = 0, completed = 0, checkpointCount = 0, failAfterReceipt = false, outcomeUnknown = false;
  let failAfterCheckpoint = false, failAfterCatalog = false, materializationWrites = 0;
  let failResponseAcknowledgment = false;
  let checkpointWritten = false, catalogWritten = false;
  let firstMaterializationArtifact: unknown = null;
  let responseMode: "valid" | "invalid" | "partial" = "valid", responseSaved = false;
  const states: string[] = [];
  const lease: SignalWorkspaceEngineLeaseV1 = { execution_id: uuid(1), workspace_id: uuid(2), execution_token: uuid(4), input_digest: hash("snapshot"),
    snapshot: { contract_version: "workspace-topic-engine-v1", workspace_id: uuid(2), taxonomy_profile_id: uuid(20), preparation_run_id: uuid(21),
      embedding_run_id: uuid(22), input_revision: "1", embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
      context_digest: hash("context"), catalog_digest: hash("catalog"), prototype_plan_digest: hash("plan"),
      expected_roots: 3, expected_chunks: 3, expected_guides: 0, parent_execution_id: null, context_refs: [],
      engine_config: { ...SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 }, claude_cap_micro_usd: 30_000_000,
      interpretation_config: { call_configuration: config, daily_cap_micro_usd: 30_000_000, budget_timezone: "UTC" } } };
  const stores = {
    context: async () => ({ actor_user_id: uuid(5), context: { workspace_id: lease.workspace_id,
      execution_id: lease.execution_id, context_digest: hash("context"), data: { interests: [] } } }),
    fit: async () => { fitCount++; states.push("fit"); return {}; },
    reserve: async (args: { request_digest: string; reserved_micro_usd: number }) => {
      call ??= { call_id: uuid(6), execution_id: lease.execution_id, workspace_id: lease.workspace_id, attempt_token: uuid(7),
        retry_of_call_id: null, state: "reserved", request_digest: args.request_digest, reserved_micro_usd: args.reserved_micro_usd,
        settled_micro_usd: null, response: null }; return { ...call };
    },
    sent: async () => { const allowed = call!.state === "reserved"; if (allowed) call!.state = "in_flight";
      states.push("sent"); return { call, send_authorized: allowed }; },
    response: async (args: { response: NonNullable<SignalWorkspaceEngineInterpretationCallV1["response"]> }) => {
      assert.equal(call!.state, "in_flight"); call!.response = args.response; call!.state = "response_persisted";
      responseSaved = true; states.push("response");
      if (failResponseAcknowledgment) { failResponseAcknowledgment = false; throw new Error("simulated response COMMIT acknowledgment lost"); }
      return { ...call! };
    },
    settle: async () => {
      assert.ok(responseSaved, "Cost cannot settle before receipt");
      if (failAfterReceipt) { failAfterReceipt = false; throw new Error("workspace_engine_worker_failed"); }
      call!.state = "settled"; call!.settled_micro_usd = 750; states.push("settled"); return { ...call! };
    },
    fail: async (args: { outcome: SignalWorkspaceEngineInterpretationCallV1["state"]; error_code: string }) => {
      // Mirror the narrow DB guard: only a confirmed complete persisted receipt
      // survives this exact transport persistence-acknowledgment uncertainty.
      if (call!.state === "response_persisted" && call!.response?.complete === true
        && args.error_code === "workspace_engine_interpretation_receipt_persistence_unknown") return { ...call! };
      if (call!.state !== "settled") call!.state = args.outcome; return { ...call! };
    },
    checkpoint: async () => { assert.equal(call!.state, "settled");
      if (!checkpointWritten) { checkpointWritten = true; checkpointCount++; }
      states.push("checkpoint");
      if (failAfterCheckpoint) { failAfterCheckpoint = false; throw new Error("workspace_engine_worker_failed"); }
      return { artifact_id: uuid(8) }; },
    materialize: async (args: { proposals: AsyncIterable<{ artifact_id: string; body: string }> }) => {
      let count = 0; for await (const item of args.proposals) {
        assert.equal(item.artifact_id, uuid(8)); const body = JSON.parse(item.body);
        assert.equal(body.interpretations[0].cluster_id, cluster.cluster_id); count++;
      }
      assert.equal(count, 1); states.push("materialized"); const replayed = catalogWritten;
      if (!catalogWritten) { catalogWritten = true; materializationWrites++; }
      if (failAfterCatalog) { failAfterCatalog = false; throw new Error("workspace_engine_worker_failed"); }
      return { contract_version: "workspace-topic-materialization-v1", execution_id: lease.execution_id,
        output_catalog_profile_id: uuid(9), output_catalog_revision: 2, interpretation_units_digest: hash("units"),
        topic_count: 1, discovered_topic_count: 1, mapping_digest: hash("mapping"), mapping: [], replayed };
    },
    persist: async (args: { artifact: unknown }) => {
      if (firstMaterializationArtifact) assert.deepEqual(args.artifact, firstMaterializationArtifact);
      firstMaterializationArtifact ??= structuredClone(args.artifact);
      return { artifact_id: uuid(10) }; },
    complete: async () => { completed++; states.push("complete"); return { execution_id: lease.execution_id }; },
  } as unknown as NonNullable<Args["stores"]>;
  const execute = async () => {
    const attempt = await mkdtemp(join(directory, "attempt-"));
    return interpretWorkspaceEngineV1({ database: {} as Args["database"], lease, stores, directory: attempt,
      fit: { model_artifact_id: uuid(11), output_artifact_id: uuid(12), coverage: { roots: 3, chunks: 3, guides: 0 },
        model_configuration: {}, runtime_kind: "python", artifact_format: "workspace-model-bundle-v1", license_key: null,
        result_kind: "computational_grouping" }, clusters: [cluster], heartbeat: async () => undefined,
      api_key: "test_key_not_a_real_credential", provider_enabled: true,
      storage: {
        put: async args => { const bytes = await readFile(args.file); assert.equal(hash(bytes), args.sha256);
          const key = `workspace-engine/${lease.workspace_id}/${lease.execution_id}/${args.sha256.slice(7)}.parts.json`;
          if (files.has(key)) assert.deepEqual(files.get(key), bytes, "A replay may only store the same immutable bytes");
          files.set(key, bytes); return { storage_key: key, sha256: args.sha256, size_bytes: bytes.length, media_type: args.media_type }; },
        get: async args => { const bytes = files.get(args.stored.storage_key)!; assert.equal(hash(bytes), args.stored.sha256);
          await writeFile(args.destination, bytes, { flag: "wx" }); },
      },
      send: async args => sendWorkspaceInterpretationV1({ ...args, fetch_impl: async () => {
        sends++; if (outcomeUnknown) throw new Error("simulated socket close");
        const output = { interpretations: [{ cluster_id: cluster.cluster_id, cluster_digest: cluster.cluster_digest,
          status: "coherent", name: "Diferencias entre reserva y cobro", definition: "Conversaciones sobre diferencias en el cobro de una reserva.",
          inclusion: [], exclusion: [], citations: [responseMode === "invalid" ? hash("invented citation") : cluster.representatives[0]!.ref_id] }] };
        const bytes = JSON.stringify({ model: config.model, type: "message", role: "assistant", stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(output) }] });
        return new Response(bytes, { status: 200, headers: responseMode === "partial" ? { "content-length": String(bytes.length + 1) } : {} });
      } }),
    });
  };
  return { execute, cleanup: () => rm(directory, { recursive: true, force: true }),
    get: () => ({ sends, fitCount, completed, checkpointCount, materializationWrites, storedObjects: files.size, call, states }),
    crashAfterReceipt: () => { failAfterReceipt = true; }, unknown: () => { outcomeUnknown = true; },
    loseResponseAcknowledgment: () => { failResponseAcknowledgment = true; },
    crashAfterCheckpoint: () => { failAfterCheckpoint = true; }, crashAfterCatalog: () => { failAfterCatalog = true; },
    mode: (mode: typeof responseMode) => { responseMode = mode; } };
}

test("same execution persists paid interpretation before editable catalog completion", async () => {
  const s = await scenario(); try { await s.execute(); const result = s.get();
    assert.equal(result.sends, 1); assert.equal(result.completed, 1);
    assert.deepEqual(result.states, ["fit", "sent", "response", "settled", "checkpoint", "materialized", "complete"]);
    // An injected store replay changes replayed:false→true without changing the
    // immutable materialization artifact or creating a second catalog/provider call.
    await s.execute(); assert.equal(s.get().sends, 1); assert.equal(s.get().materializationWrites, 1);
    assert.equal(s.get().storedObjects, 3);
  } finally { await s.cleanup(); }
});
test("crash after durable response recovers without another provider request", async () => {
  const s = await scenario(); try { s.crashAfterReceipt(); await assert.rejects(s.execute(), /workspace_engine_worker_failed/u);
    assert.equal(s.get().call?.state, "response_persisted"); assert.equal(s.get().completed, 0);
    await s.execute(); assert.equal(s.get().sends, 1); assert.equal(s.get().completed, 1);
  } finally { await s.cleanup(); }
});
test("uncertain sent request never sends again or materializes", async () => {
  const s = await scenario(); try { s.unknown(); await assert.rejects(s.execute(), /outcome_unknown/u);
    await assert.rejects(s.execute(), /outcome_unknown/u); assert.equal(s.get().sends, 1);
    assert.equal(s.get().completed, 0); assert.equal(s.get().checkpointCount, 0);
  } finally { await s.cleanup(); }
});
test("invalid citations retain actual usage but cannot become editable results", async () => {
  const s = await scenario(); try { s.mode("invalid"); await assert.rejects(s.execute(), /output_invalid/u);
    assert.equal(s.get().call?.state, "settled"); assert.equal(s.get().call?.settled_micro_usd, 750);
    assert.equal(s.get().completed, 0); await assert.rejects(s.execute(), /output_invalid/u); assert.equal(s.get().sends, 1);
  } finally { await s.cleanup(); }
});
test("partial raw response remains uncertain even when its bounded bytes parse as JSON", async () => {
  const s = await scenario(); try { s.mode("partial"); await assert.rejects(s.execute(), /outcome_unknown/u);
    assert.equal(s.get().call?.response?.complete, false); assert.equal(s.get().call?.state, "outcome_unknown");
    await assert.rejects(s.execute(), /outcome_unknown/u); assert.equal(s.get().sends, 1); assert.equal(s.get().completed, 0);
  } finally { await s.cleanup(); }
});

test("crash after interpretation checkpoint reuses settled response and the same proposal without sending", async () => {
  const s = await scenario(); try {
    s.crashAfterCheckpoint(); await assert.rejects(s.execute(), /workspace_engine_worker_failed/u);
    assert.equal(s.get().call?.state, "settled"); assert.equal(s.get().checkpointCount, 1);
    assert.equal(s.get().materializationWrites, 0); assert.equal(s.get().completed, 0);
    await s.execute(); const result = s.get();
    assert.equal(result.sends, 1); assert.equal(result.checkpointCount, 1); assert.equal(result.materializationWrites, 1);
    assert.equal(result.completed, 1); assert.equal(result.storedObjects, 3);
  } finally { await s.cleanup(); }
});
test("crash after catalog commit recovers completion without another catalog, response or proposal", async () => {
  const s = await scenario(); try {
    s.crashAfterCatalog(); await assert.rejects(s.execute(), /workspace_engine_worker_failed/u);
    assert.equal(s.get().materializationWrites, 1); assert.equal(s.get().completed, 0);
    await s.execute(); const result = s.get();
    assert.equal(result.sends, 1); assert.equal(result.checkpointCount, 1); assert.equal(result.materializationWrites, 1);
    assert.equal(result.completed, 1); assert.equal(result.storedObjects, 3);
    // A further replay exercises the same immutable materialization bytes.
    await s.execute(); assert.equal(s.get().materializationWrites, 1); assert.equal(s.get().storedObjects, 3);
  } finally { await s.cleanup(); }
});

test("lost response COMMIT acknowledgment recovers the complete DB receipt without another send", async () => {
  const s = await scenario(); try {
    s.loseResponseAcknowledgment();
    await assert.rejects(s.execute(), /workspace_engine_interpretation_receipt_recovery_required/u);
    assert.equal(s.get().call?.state, "response_persisted"); assert.equal(s.get().call?.response?.complete, true);
    assert.equal(s.get().completed, 0); assert.equal(s.get().sends, 1);
    await s.execute(); assert.equal(s.get().sends, 1); assert.equal(s.get().completed, 1);
    assert.equal(s.get().call?.state, "settled");
  } finally { await s.cleanup(); }
});
test("lost acknowledgment for a partial receipt does not grant complete-receipt recovery", async () => {
  const s = await scenario(); try {
    s.mode("partial"); s.loseResponseAcknowledgment();
    await assert.rejects(s.execute(), /receipt_persistence_unknown/u);
    assert.equal(s.get().call?.state, "outcome_unknown"); assert.equal(s.get().call?.response?.complete, false);
    await assert.rejects(s.execute(), /outcome_unknown/u);
    assert.equal(s.get().sends, 1); assert.equal(s.get().completed, 0);
  } finally { await s.cleanup(); }
});
