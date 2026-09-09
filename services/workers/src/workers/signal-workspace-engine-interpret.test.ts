import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as config, signalWorkspaceInterpretationReferenceIdV1,
  SIGNAL_WORKSPACE_INTERPRETATION_LEGACY_OPUS_CONFIGURATION_V1 as legacyConfig, buildSignalWorkspaceInterpretationBatchV1,
  SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  signalWorkspaceInterpretationCostV1,
  type SignalWorkspaceInterpretationClusterV1, type SignalWorkspaceInterpretationConfigurationV1 } from "@noisia/query-engine";
import type { SignalWorkspaceEngineInterpretationCallV1, SignalWorkspaceEngineLeaseV1,
  SignalWorkspaceEngineInterpretationCheckpointV1 } from "@noisia/db";
import { SignalWorkspaceEngineInterpretationError } from "@noisia/db";
import { sendWorkspaceInterpretationV1 } from "../providers/workspace-interpretation";
import { interpretWorkspaceEngineV1 } from "./signal-workspace-engine-interpret";
import { executeWorkspaceInterpretationBatchV1 } from "./signal-workspace-interpretation-batch";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const cluster: SignalWorkspaceInterpretationClusterV1 = (() => {
  const text = "El cobro de la renta fue distinto al de la reserva.";
  const identity = { root_id: uuid(3), chunk_index: 0, start: 0, end: text.length, chunk_sha256: hash(text) };
  return { cluster_id: "open:cluster_one", cluster_digest: hash("all three roots"), lane: "open", root_count: 3, chunk_count: 3,
    terms: ["cobro", "reserva"], representatives: [{ ...identity, ref_id: signalWorkspaceInterpretationReferenceIdV1(identity),
      text, strength: 0.9, selection_reason: "high_affiliation" }] };
})();

async function scenario(configuration: SignalWorkspaceInterpretationConfigurationV1 = config) {
  type Args = Parameters<typeof interpretWorkspaceEngineV1>[0];
  const directory = await mkdtemp(join(tmpdir(), "noisia-interpretation-test-"));
  const files = new Map<string, Buffer>(); let call: SignalWorkspaceEngineInterpretationCallV1 | null = null;
  const calls = new Map<string, SignalWorkspaceEngineInterpretationCallV1>();
  const requestCalls = new Map<string, SignalWorkspaceEngineInterpretationCallV1>();
  const terminalReceipts = new Map<string, { provider_request_id: string; evidence_sha256: string }>();
  const reservations: Array<{ call_id: string; configuration: unknown; reserved_micro_usd: number; admission_operation_id?: string }> = [];
  let sends = 0, fitCount = 0, completed = 0, checkpointCount = 0, failAfterReceipt = false, outcomeUnknown = false;
  let failAfterCheckpoint = false, failAfterCatalog = false, materializationWrites = 0;
  let failResponseAcknowledgment = false;
  let repairOnlyCrash = false, unknownRepair = false, disableRepair = false, denyRepairCap = false;
  let failRepairReservationAck = false, failSettlementAck = false;
  let reserveFailure: string | null = null;
  let sendRejection: Error | null = null;
  let totalSettled = 0;
  const checkpointCallIds: string[] = [];
  const seenBatches: Array<Parameters<typeof sendWorkspaceInterpretationV1>[0]["batch"]> = [];
  const seenAuthorizations: Array<string | undefined> = [];
  let callAdmission: SignalWorkspaceEngineInterpretationCallV1["admission"] | undefined;
  let providerEnabled = true;
  let checkpointWritten = false, catalogWritten = false;
  let firstMaterializationArtifact: unknown = null;
  type ResponseMode = "valid" | "invalid" | "partial";
  let responseMode: ResponseMode = "valid", responseSaved = false;
  let repairMode: ResponseMode | null = null;
  const states: string[] = [];
  const lease: SignalWorkspaceEngineLeaseV1 = { execution_id: uuid(1), workspace_id: uuid(2), execution_token: uuid(4), input_digest: hash("snapshot"),
    snapshot: { contract_version: "workspace-topic-engine-v1", workspace_id: uuid(2), taxonomy_profile_id: uuid(20), preparation_run_id: uuid(21),
      embedding_run_id: uuid(22), input_revision: "1", embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
      context_digest: hash("context"), catalog_digest: hash("catalog"), prototype_plan_digest: hash("plan"),
      expected_roots: 3, expected_chunks: 3, expected_guides: 0, parent_execution_id: null, context_refs: [],
      engine_config: { ...SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 }, claude_cap_micro_usd: 30_000_000,
      interpretation_config: { call_configuration: configuration, daily_cap_micro_usd: 30_000_000, budget_timezone: "UTC" } } };
  const stores = {
    context: async () => ({ actor_user_id: uuid(5), context: { workspace_id: lease.workspace_id,
      execution_id: lease.execution_id, context_digest: hash("context"), data: { interests: [] } } }),
    fit: async () => { fitCount++; states.push("fit"); return {}; },
    checkpoints: async () => ({ items: [], next_artifact_id: null, done: true }),
    reserve: async (args: Parameters<NonNullable<Args["stores"]>["reserve"]>[0]) => {
      assert.equal(args.workspace_id, lease.workspace_id); assert.equal(args.execution_id, lease.execution_id);
      assert.equal(args.execution_token, lease.execution_token); assert.equal(args.actor_user_id, uuid(5));
      if (reserveFailure) throw new Error(reserveFailure);
      const existing = requestCalls.get(args.idempotency_key);
      if (existing) {
        assert.equal(existing.request_digest, args.request_digest);
        assert.deepEqual(existing.editorial_repair, args.editorial_repair ?? null);
        call = existing; return { ...call };
      }
      if (args.editorial_repair) {
        const source = calls.get(args.editorial_repair.source_call_id)!;
        assert.ok(source); assert.equal(source.state, "settled"); assert.equal(source.editorial_repair, null);
        assert.equal(source.response?.complete, true); assert.equal(source.response?.sha256, args.editorial_repair.source_response_sha256);
        assert.equal(source.request_digest, args.editorial_repair.source_request_digest);
        if (denyRepairCap) throw new Error("workspace_engine_interpretation_run_cap_exceeded");
        assert.ok(![...calls.values()].some(row => row.editorial_repair && !["definitely_not_sent", "terminal_confirmed"].includes(row.state)));
      }
      if (args.retry_of_call_id) {
        const previous = calls.get(args.retry_of_call_id)!;
        assert.ok(["definitely_not_sent", "terminal_confirmed"].includes(previous.state));
        assert.equal(previous.request_digest, args.request_digest); assert.deepEqual(previous.editorial_repair, args.editorial_repair ?? null);
        assert.equal(previous.reserved_micro_usd, args.reserved_micro_usd);
        if (previous.state === "terminal_confirmed") {
          assert.ok(terminalReceipts.has(previous.call_id)); assert.equal(previous.response, null);
          assert.equal(previous.settled_micro_usd, null);
          if ([...calls.values()].some(row => row.request_digest === args.request_digest && row.retry_of_call_id
            && calls.get(row.retry_of_call_id)?.state === "terminal_confirmed"))
            throw new Error("workspace_engine_interpretation_transport_retry_exhausted");
        }
        assert.ok(![...calls.values()].some(row => row.retry_of_call_id === previous.call_id));
      }
      call = { call_id: calls.size ? uuid(60 + calls.size) : uuid(6), execution_id: lease.execution_id, workspace_id: lease.workspace_id,
        attempt_token: uuid(70 + calls.size), retry_of_call_id: args.retry_of_call_id ?? null, editorial_repair: args.editorial_repair ?? null,
        state: "reserved", request_digest: args.request_digest, reserved_micro_usd: args.reserved_micro_usd,
        settled_micro_usd: null, response: null, interpretation_revision_digest: args.interpretation_revision_digest ?? null,
        admission: callAdmission === undefined ? lease.interpretation_admission ? {
          operation_id: lease.interpretation_admission.operation_id, grant_digest: lease.interpretation_admission.grant_digest,
          admission_not_after: lease.interpretation_admission.admission_not_after } : null : callAdmission };
      calls.set(call.call_id, call); requestCalls.set(args.idempotency_key, call);
      reservations.push({ call_id: call.call_id, configuration: args.configuration, reserved_micro_usd: args.reserved_micro_usd,
        ...(args.admission_operation_id ? { admission_operation_id: args.admission_operation_id } : {}) });
      if (args.editorial_repair && failRepairReservationAck) { failRepairReservationAck = false; throw new Error("workspace_engine_worker_failed"); }
      return { ...call };
    },
    sent: async () => { if (sendRejection) throw sendRejection;
      const allowed = call!.state === "reserved"; if (allowed) call!.state = "in_flight";
      states.push("sent"); return { call, send_authorized: allowed }; },
    response: async (args: { response: NonNullable<SignalWorkspaceEngineInterpretationCallV1["response"]> }) => {
      assert.equal(call!.state, "in_flight"); call!.response = args.response; call!.state = "response_persisted";
      responseSaved = true; states.push("response");
      if (failResponseAcknowledgment && (!repairOnlyCrash || call!.editorial_repair)) { failResponseAcknowledgment = false; throw new Error("simulated response COMMIT acknowledgment lost"); }
      return { ...call! };
    },
    settle: async () => {
      assert.ok(responseSaved, "Cost cannot settle before receipt");
      if (failAfterReceipt && (!repairOnlyCrash || call!.editorial_repair)) { failAfterReceipt = false; throw new Error("workspace_engine_worker_failed"); }
      const cost = signalWorkspaceInterpretationCostV1({ input_tokens: 100, output_tokens: 10,
        cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, configuration);
      if (call!.state !== "settled") totalSettled += cost;
      call!.state = "settled"; call!.settled_micro_usd = cost; states.push("settled");
      if (failSettlementAck) { failSettlementAck = false; throw new Error("workspace_engine_worker_failed"); }
      return { ...call! };
    },
    fail: async (args: { outcome: SignalWorkspaceEngineInterpretationCallV1["state"]; error_code: string }) => {
      // Mirror the narrow DB guard: only a confirmed complete persisted receipt
      // survives this exact transport persistence-acknowledgment uncertainty.
      if (call!.state === "response_persisted" && call!.response?.complete === true
        && args.error_code === "workspace_engine_interpretation_receipt_persistence_unknown") return { ...call! };
      if (call!.state !== "settled") call!.state = args.outcome; return { ...call! };
    },
    checkpoint: async (args: { call_id: string }) => { assert.equal(call!.state, "settled"); assert.equal(args.call_id, call!.call_id);
      checkpointCallIds.push(args.call_id);
      if (!checkpointWritten) { checkpointWritten = true; checkpointCount++; }
      states.push("checkpoint");
      if (failAfterCheckpoint) { failAfterCheckpoint = false; throw new Error("workspace_engine_worker_failed"); }
      return { artifact_id: uuid(8) }; },
    materialize: async (args: { proposals: AsyncIterable<{ artifact_id: string; body: string }> }) => {
      let count = 0; for await (const item of args.proposals) {
        assert.equal(item.artifact_id, uuid(8)); const body = JSON.parse(item.body);
        assert.equal(body.interpretations[0].cluster_id, cluster.cluster_id); count++;
        assert.deepEqual(body.editorial_repair ?? null, call!.editorial_repair);
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
  const execute = async (authorization_expires_at?: string, batchOnly=false) => {
    const run=batchOnly ? async (args:Args)=>{
      const context=await stores.context({database:args.database,lease});
      return executeWorkspaceInterpretationBatchV1({database:args.database,
        execution:{execution_id:lease.execution_id,workspace_id:lease.workspace_id,execution_token:lease.execution_token,
          interpretation_revision_digest:lease.interpretation_revision_digest,interpretation_admission:lease.interpretation_admission},
        actor_user_id:context.actor_user_id,config:lease.snapshot.interpretation_config!,
        batch:buildSignalWorkspaceInterpretationBatchV1(context.context,[cluster],configuration),
        directory:args.directory,storage:args.storage,stores,send:args.send,api_key:args.api_key,
        provider_enabled:args.provider_enabled,authorization_expires_at:args.authorization_expires_at});
    } : interpretWorkspaceEngineV1;
    const attempt = await mkdtemp(join(directory, "attempt-"));
    return run({ database: {} as Args["database"], lease, stores, directory: attempt,
      fit: { model_artifact_id: uuid(11), output_artifact_id: uuid(12), coverage: { roots: 3, chunks: 3, guides: 0 },
        model_configuration: {}, runtime_kind: "python", artifact_format: "workspace-model-bundle-v1", license_key: null,
        result_kind: "computational_grouping" }, clusters: [cluster], heartbeat: async () => undefined,
      api_key: "test_key_not_a_real_credential", provider_enabled: providerEnabled, authorization_expires_at,
      storage: {
        put: async args => { const bytes = await readFile(args.file); assert.equal(hash(bytes), args.sha256);
          const key = `workspace-engine/${lease.workspace_id}/${lease.execution_id}/${args.sha256.slice(7)}.parts.json`;
          if (files.has(key)) assert.deepEqual(files.get(key), bytes, "A replay may only store the same immutable bytes");
          files.set(key, bytes); return { storage_key: key, sha256: args.sha256, size_bytes: bytes.length, media_type: args.media_type }; },
        get: async args => { const bytes = files.get(args.stored.storage_key)!; assert.equal(hash(bytes), args.stored.sha256);
          await writeFile(args.destination, bytes, { flag: "wx" }); },
      },
      send: async args => { seenBatches.push(args.batch); seenAuthorizations.push(args.authorization_expires_at); return sendWorkspaceInterpretationV1({ ...args,
        provider_enabled: args.batch.editorial_repair && disableRepair ? false : args.provider_enabled, fetch_impl: async () => {
        sends++; if (outcomeUnknown || args.batch.editorial_repair && unknownRepair) throw new Error("simulated socket close");
        const mode = args.batch.editorial_repair ? repairMode ?? responseMode : responseMode;
        const output = { interpretations: [{ cluster_id: cluster.cluster_id, cluster_digest: cluster.cluster_digest,
          status: "coherent", name: "Diferencias entre reserva y cobro", definition: "Conversaciones sobre diferencias en el cobro de una reserva.",
          inclusion: [], exclusion: [], citations: [mode === "invalid" ? hash("invented citation") : "r1"] }] };
        const bytes = JSON.stringify({ model: args.batch.configuration.model, type: "message", role: "assistant", stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(output) }] });
        return new Response(bytes, { status: 200, headers: mode === "partial" ? { "content-length": String(bytes.length + 1) } : {} });
      } }); },
    });
  };
  return { execute, executeBatchOnly:(expires?:string)=>execute(expires,true), cleanup: () => rm(directory, { recursive: true, force: true }),
    admission: (receipt: SignalWorkspaceEngineLeaseV1["interpretation_admission"]) => { lease.interpretation_admission = receipt; },
    callAdmission: (receipt: SignalWorkspaceEngineInterpretationCallV1["admission"]) => { callAdmission = receipt; },
    providerEnabled: (value: boolean) => { providerEnabled = value; },
    seedHistoricalReceipt: async () => {
      assert.equal(configuration.model, "claude-opus-5"); assert.equal(calls.size, 0);
      const context = await stores.context({ database: {} as Args["database"], lease });
      const historical = buildSignalWorkspaceInterpretationBatchV1(context.context, [cluster], configuration);
      call = await stores.reserve({ database: {} as Args["database"], workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        actor_user_id: context.actor_user_id, execution_token: lease.execution_token, idempotency_key: historical.batch_key,
        request_digest: historical.request_digest, configuration, reserved_micro_usd: historical.reserved_micro_usd,
        daily_cap_micro_usd: 30_000_000, budget_timezone: "UTC" });
      const bytes = Buffer.from(JSON.stringify({ model: configuration.model, type: "message", role: "assistant", stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify({ interpretations: [{
          cluster_id: cluster.cluster_id, cluster_digest: cluster.cluster_digest, status: "coherent", name: "Cobros de la reserva",
          definition: "Diferencias entre el importe reservado y el cobrado.", inclusion: [], exclusion: [],
          citations: [cluster.representatives[0]!.ref_id] }] }) }] }));
      const key = `historical/${call.call_id}`; files.set(key, bytes);
      const persisted = calls.get(call.call_id)!;
      persisted.state = "settled"; persisted.settled_micro_usd = 750;
      persisted.response = { storage_key: key, sha256: hash(bytes), size_bytes: bytes.length, http_status: 200,
        provider_request_id: "req_historical", complete: true };
      responseSaved = true; totalSettled = 750;
      return { request_digest: historical.request_digest, body: historical.request_body };
    },
    get: () => ({ sends, fitCount, completed, checkpointCount, materializationWrites, storedObjects: files.size, call, states,
      calls: [...calls.values()], totalSettled, checkpointCallIds, seenBatches, seenAuthorizations, terminalReceipts, reservations,
      retainedExposure: [...calls.values()].reduce((sum, row) => sum + (row.state === "settled" ? row.settled_micro_usd!
        : row.state === "definitely_not_sent" ? 0 : row.reserved_micro_usd), 0) }),
    crashAfterReceipt: () => { failAfterReceipt = true; }, unknown: () => { outcomeUnknown = true; },
    loseResponseAcknowledgment: () => { failResponseAcknowledgment = true; },
    targetRepairCrash: () => { repairOnlyCrash = true; }, repairUnknown: (value = true) => { unknownRepair = value; },
    confirmTerminal: () => {
      assert.ok(call); assert.equal(call.state, "outcome_unknown"); assert.equal(call.response, null);
      assert.equal(call.settled_micro_usd, null);
      terminalReceipts.set(call.call_id, { provider_request_id: `req_terminal_${call.call_id}`, evidence_sha256: hash(`external terminal ${call.call_id}`) });
      call.state = "terminal_confirmed";
    },
    rejectReserve: (code: string) => { reserveFailure = code; },
    rejectSend: (error: Error) => { sendRejection = error; },
    repairDisabled: (value: boolean) => { disableRepair = value; }, repairCapBlocked: () => { denyRepairCap = true; },
    loseRepairReservationAcknowledgment: () => { failRepairReservationAck = true; },
    loseSettlementAcknowledgment: () => { failSettlementAck = true; },
    crashAfterCheckpoint: () => { failAfterCheckpoint = true; }, crashAfterCatalog: () => { failAfterCatalog = true; },
    mode: (mode: typeof responseMode) => { responseMode = mode; },
    repairMode: (mode: typeof responseMode) => { repairMode = mode; } };
}

test("standalone batch execution needs no fit snapshot or catalog actions and restores its paid receipt without another send", async()=>{
 const s=await scenario();try{
  await s.executeBatchOnly();const first=s.get();
  assert.equal(first.sends,1);assert.equal(first.call?.state,"settled");assert.equal(first.fitCount,0);
  assert.equal(first.checkpointCount,0);assert.equal(first.materializationWrites,0);assert.equal(first.completed,0);
  s.providerEnabled(false);await s.executeBatchOnly("2000-01-01T00:00:00.000Z");
  const replay=s.get();assert.equal(replay.sends,1);assert.equal(replay.calls.length,1);assert.equal(replay.totalSettled,first.totalSettled);
  assert.equal(replay.fitCount,0);assert.equal(replay.completed,0);
 }finally{await s.cleanup();}
});
test("standalone batch returns a metered invalid result without inventing a repair or topic",async()=>{
 const s=await scenario();try{
  s.mode("invalid");const result=await s.executeBatchOnly();
  assert.ok("response" in result);assert.equal(result.response.outcome,"known_response_invalid");
  const state=s.get();assert.equal(state.sends,1);assert.equal(state.calls.length,1);assert.equal(state.call?.state,"settled");
  assert.equal(state.call?.editorial_repair,null);assert.equal(state.fitCount,0);assert.equal(state.checkpointCount,0);assert.equal(state.completed,0);
 }finally{await s.cleanup();}
});
test("standalone batch preserves an unknown outcome and refuses another send",async()=>{
 const s=await scenario();try{
  s.unknown();await assert.rejects(s.executeBatchOnly(),/outcome_unknown/u);
  await assert.rejects(s.executeBatchOnly(),/outcome_unknown/u);
  assert.equal(s.get().sends,1);assert.equal(s.get().calls.length,1);assert.equal(s.get().fitCount,0);assert.equal(s.get().completed,0);
 }finally{await s.cleanup();}
});

test("a historical Opus lease consumes its sealed receipt at historical cost with no provider admission", async () => {
  const s = await scenario(legacyConfig); try {
    const historical = await s.seedHistoricalReceipt(); await s.execute();
    const result = s.get(); assert.equal(result.sends, 0); assert.equal(result.seenBatches.length, 0);
    assert.equal(result.states.includes("sent"), false); assert.equal(result.completed, 1);
    assert.equal(result.call?.request_digest, historical.request_digest); assert.equal(JSON.parse(historical.body).model, "claude-opus-5");
    assert.equal(result.totalSettled, 750); assert.equal(result.call?.settled_micro_usd, 750);
    assert.deepEqual(result.reservations[0]!.configuration, legacyConfig);
  } finally { await s.cleanup(); }
});
test("a historical Opus lease missing a receipt cannot create an authorized provider send", async () => {
  const s = await scenario(legacyConfig); try {
    await assert.rejects(s.execute(), /workspace_engine_interpretation_provider_model_disabled/u);
    assert.equal(s.get().sends, 0); assert.equal(s.get().states.includes("sent"), false);
    assert.equal(s.get().call?.state, "definitely_not_sent"); assert.equal(s.get().totalSettled, 0);
    assert.equal(s.get().completed, 0);
  } finally { await s.cleanup(); }
});

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
test("crash after durable response recovers after spending permission expires without another provider request", async () => {
  const s = await scenario(); try { s.crashAfterReceipt(); await assert.rejects(s.execute(), /workspace_engine_worker_failed/u);
    assert.equal(s.get().call?.state, "response_persisted"); assert.equal(s.get().completed, 0);
    const receipt = structuredClone(s.get().call!.response);
    await s.execute("2000-01-01T00:00:00.000Z");
    assert.equal(s.get().sends, 1); assert.equal(s.get().completed, 1);
    assert.equal(s.get().seenBatches.length, 1); assert.equal(s.get().reservations.length, 1);
    assert.equal(s.get().totalSettled, 450); assert.deepEqual(s.get().call!.response, receipt);
  } finally { await s.cleanup(); }
});
for (const reason of ["daily_authority_expired", "admission_revoked", "admission_changed"] as const)
test(`DB-proven ${reason} before send preserves its reason; ambiguous acknowledgments retain exposure`, async () => {
  const code = `workspace_engine_interpretation_${reason}`;
  for (const error of [new SignalWorkspaceEngineInterpretationError(code, 409), new SignalWorkspaceEngineInterpretationError(code, 503), new Error(code),
    Object.assign(new Error(code), { code, status: 409 }), Object.assign(new Error(code), { code: "23514" }), new Error("lost COMMIT acknowledgment")]) {
    const s = await scenario(); try {
      s.rejectSend(error);
      const proven = error instanceof SignalWorkspaceEngineInterpretationError && error.status === 409;
      await assert.rejects(s.execute(), { message: proven ? code : "workspace_engine_interpretation_send_authority_unknown" });
      const result = s.get();
      assert.equal(result.sends, 0); assert.equal(result.completed, 0); assert.equal(result.totalSettled, 0);
      assert.equal(result.call!.response, null); assert.equal(result.reservations.length, 1);
      assert.equal(result.call!.state, proven ? "definitely_not_sent" : "outcome_unknown");
      assert.equal(result.retainedExposure, proven ? 0 : result.call!.reserved_micro_usd);
    } finally { await s.cleanup(); }
  }
});
function admissionReceipt(n: number, deadline = "2099-01-01T06:00:00.000Z"): NonNullable<SignalWorkspaceEngineLeaseV1["interpretation_admission"]> {
  return { contract_version: "workspace-interpretation-admission-v1", operation_id: uuid(n), grant_digest: hash(`grant:${n}`),
    action: "authorize_interpretation", execution_id: uuid(1), workspace_id: uuid(2), authorized_by_user_id: uuid(50),
    budget_actor_user_id: uuid(5), prior_admission_operation_id: null, input_digest: hash("snapshot"),
    fit_checkpoint_digest: hash("fit"), interpretation_revision_digest: null, configuration_digest: hash("configuration"),
    budget_date: "2099-01-01", budget_timezone: "UTC", authorized_at: "2099-01-01T00:00:00.000Z", admission_not_after: deadline,
    grant_cap_micro_usd: 2_000_000, run_cap_micro_usd: 30_000_000, daily_cap_micro_usd: 30_000_000 };
}
test("renewed call uses its DB admission despite an expired legacy deadline and keeps the sealed request", async () => {
  const s = await scenario(); try {
    const grant = admissionReceipt(900); s.admission(grant);
    await s.execute("2000-01-01T00:00:00.000Z");
    const result = s.get(); assert.equal(result.sends, 1); assert.equal(result.completed, 1);
    assert.deepEqual(result.seenAuthorizations, [grant.admission_not_after]);
    assert.equal(result.reservations[0]!.admission_operation_id, grant.operation_id);
    assert.equal(result.call!.admission?.grant_digest, grant.grant_digest);
    assert.equal(result.seenBatches[0]!.configuration.model, "claude-sonnet-4-6");
    assert.equal(result.call!.request_digest, result.seenBatches[0]!.request_digest);
  } finally { await s.cleanup(); }
});
test("an old call cannot borrow the current lease deadline, and a grant cannot enable a disabled provider", async () => {
  for (const mode of ["old_call", "kill_switch"] as const) {
    const s = await scenario(); try {
      const grant = admissionReceipt(900); s.admission(grant);
      if (mode === "old_call") s.callAdmission({ operation_id: uuid(899), grant_digest: hash("old-grant"), admission_not_after: "2000-01-01T00:00:00.000Z" });
      else s.providerEnabled(false);
      await assert.rejects(s.execute(grant.admission_not_after), { message: mode === "old_call"
        ? "workspace_engine_interpretation_daily_authority_expired" : "workspace_engine_interpretation_provider_disabled" });
      const result = s.get(); assert.equal(result.sends, 0); assert.equal(result.totalSettled, 0);
      assert.equal(result.call!.state, "definitely_not_sent"); assert.ok(!result.states.includes("sent"));
    } finally { await s.cleanup(); }
  }
});
test("renewal or revocation after a durable response never reassigns its receipt or sends again", async () => {
  const s = await scenario(); try {
    const grant = admissionReceipt(900); s.admission(grant); s.crashAfterReceipt();
    await assert.rejects(s.execute("2000-01-01T00:00:00.000Z"), /workspace_engine_worker_failed/u);
    const original = structuredClone(s.get().call!);
    s.admission({ ...admissionReceipt(901), action: "revoke_interpretation", prior_admission_operation_id: grant.operation_id });
    s.providerEnabled(false); await s.execute("2000-01-01T00:00:00.000Z");
    const result = s.get(); assert.equal(result.sends, 1); assert.equal(result.completed, 1);
    assert.equal(result.reservations.length, 1); assert.equal(result.seenAuthorizations.length, 1);
    assert.deepEqual(result.call!.admission, original.admission); assert.deepEqual(result.call!.response, original.response);
    assert.equal(result.call!.request_digest, original.request_digest);
  } finally { await s.cleanup(); }
});
test("a proven unsent call keeps its old grant while its single successor uses the new permission", async () => {
  const s = await scenario(); try {
    const expired = admissionReceipt(900, "2000-01-01T00:00:00.000Z"); s.admission(expired);
    await assert.rejects(s.execute(), /daily_authority_expired/u);
    const old = structuredClone(s.get().call!); assert.equal(old.state, "definitely_not_sent");
    const renewed = { ...admissionReceipt(901), prior_admission_operation_id: expired.operation_id }; s.admission(renewed);
    await s.execute("2000-01-01T00:00:00.000Z");
    const result = s.get(); assert.equal(result.sends, 1); assert.equal(result.calls.length, 2);
    assert.deepEqual(result.calls[0], old); assert.equal(result.call!.retry_of_call_id, old.call_id);
    assert.equal(result.call!.admission?.operation_id, renewed.operation_id);
    assert.equal(result.call!.request_digest, old.request_digest);
    assert.deepEqual(result.reservations.map(item => item.admission_operation_id), [expired.operation_id, renewed.operation_id]);
    assert.equal(result.seenBatches[0]!.request_body, result.seenBatches[1]!.request_body);
    assert.equal(result.retainedExposure, result.totalSettled);
  } finally { await s.cleanup(); }
});
test("uncertain sent request never sends again or materializes", async () => {
  const s = await scenario(); try { s.unknown(); await assert.rejects(s.execute(), /outcome_unknown/u);
    await assert.rejects(s.execute(), /outcome_unknown/u); assert.equal(s.get().sends, 1);
    assert.equal(s.get().completed, 0); assert.equal(s.get().checkpointCount, 0);
  } finally { await s.cleanup(); }
});
test("a second invalid editorial response settles both calls and stops without another repair or fabricated results", async () => {
  const s = await scenario(); try { s.mode("invalid"); await assert.rejects(s.execute(), /repair_invalid/u);
    assert.equal(s.get().call?.state, "settled"); assert.equal(s.get().call?.settled_micro_usd, 450);
    assert.equal(s.get().totalSettled, 900); assert.equal(s.get().calls.length, 2);
    assert.equal(s.get().completed, 0); await assert.rejects(s.execute(), /repair_invalid/u); assert.equal(s.get().sends, 2);
    assert.equal(s.get().calls.length, 2); assert.equal(s.get().checkpointCount, 0);
  } finally { await s.cleanup(); }
});
test("partial raw response remains uncertain even when its bounded bytes parse as JSON", async () => {
  const s = await scenario(); try { s.mode("partial"); await assert.rejects(s.execute(), /outcome_unknown/u);
    assert.equal(s.get().call?.response?.complete, false); assert.equal(s.get().call?.state, "outcome_unknown");
    await assert.rejects(s.execute(), /outcome_unknown/u); assert.equal(s.get().sends, 1); assert.equal(s.get().completed, 0);
  } finally { await s.cleanup(); }
});

test("crash after interpretation checkpoint reuses the paid response after spending permission expires", async () => {
  const s = await scenario(); try {
    s.crashAfterCheckpoint(); await assert.rejects(s.execute(), /workspace_engine_worker_failed/u);
    assert.equal(s.get().call?.state, "settled"); assert.equal(s.get().checkpointCount, 1);
    assert.equal(s.get().materializationWrites, 0); assert.equal(s.get().completed, 0);
    const receipt = structuredClone(s.get().call!.response);
    await s.execute("2000-01-01T00:00:00.000Z"); const result = s.get();
    assert.equal(result.sends, 1); assert.equal(result.checkpointCount, 1); assert.equal(result.materializationWrites, 1);
    assert.equal(result.completed, 1); assert.equal(result.storedObjects, 3);
    assert.equal(result.seenBatches.length, 1); assert.equal(result.reservations.length, 1);
    assert.equal(result.totalSettled, 450); assert.deepEqual(result.call!.response, receipt);
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

test("one complete invalid response can have one metered repair preserving the full batch and original receipt", async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairMode("valid"); await s.execute(); const first = s.get();
    assert.equal(first.sends, 2); assert.equal(first.calls.length, 2); assert.equal(first.totalSettled, 900);
    assert.equal(first.completed, 1); assert.equal(first.checkpointCount, 1);
    const [original, repair] = first.calls, [batch, correction] = first.seenBatches;
    assert.equal(original!.state, "settled"); assert.equal(original!.editorial_repair, null);
    assert.equal(repair!.state, "settled"); assert.equal(repair!.editorial_repair?.source_call_id, original!.call_id);
    assert.equal(repair!.editorial_repair?.source_response_sha256, original!.response!.sha256);
    assert.notEqual(repair!.request_digest, original!.request_digest);
    assert.deepEqual(correction!.context, batch!.context); assert.deepEqual(correction!.clusters, batch!.clusters);
    assert.deepEqual(correction!.configuration, batch!.configuration);
    assert.deepEqual(first.checkpointCallIds, [repair!.call_id]);
    const originalReceipt = structuredClone(original!.response);
    await s.execute(); const replay = s.get();
    assert.equal(replay.sends, 2); assert.equal(replay.calls.length, 2); assert.equal(replay.totalSettled, 900);
    assert.equal(replay.materializationWrites, 1); assert.equal(replay.storedObjects, 4);
    assert.deepEqual(replay.calls[0]!.response, originalReceipt);
  } finally { await s.cleanup(); }
});

for (const stage of ["source_settlement_ack", "repair_reservation_ack", "repair_response_ack", "repair_settlement",
  "proposal_ack", "catalog_ack"] as const) test(`editorial repair recovers ${stage} using the same two receipts and reservations`, async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairMode("valid");
    if (stage === "source_settlement_ack") s.loseSettlementAcknowledgment();
    if (stage === "repair_reservation_ack") s.loseRepairReservationAcknowledgment();
    if (stage === "repair_response_ack") { s.targetRepairCrash(); s.loseResponseAcknowledgment(); }
    if (stage === "repair_settlement") { s.targetRepairCrash(); s.crashAfterReceipt(); }
    if (stage === "proposal_ack") s.crashAfterCheckpoint();
    if (stage === "catalog_ack") s.crashAfterCatalog();
    await assert.rejects(s.execute(), /workspace_engine_(worker_failed|interpretation_receipt_recovery_required)/u);
    assert.equal(s.get().completed, 0);
    if (stage === "repair_response_ack" || stage === "repair_settlement") s.repairDisabled(true);
    await s.execute(); const done = s.get();
    assert.equal(done.sends, 2); assert.equal(done.calls.length, 2); assert.equal(done.totalSettled, 900);
    assert.equal(done.completed, 1); assert.equal(done.checkpointCount, 1); assert.equal(done.materializationWrites, 1);
    assert.equal(done.checkpointCallIds.at(-1), done.calls[1]!.call_id);
  } finally { await s.cleanup(); }
});

test("an unknown repair never resends or creates a repair of the repair", async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairUnknown();
    await assert.rejects(s.execute(), /outcome_unknown/u);
    await assert.rejects(s.execute(), /outcome_unknown/u);
    assert.equal(s.get().sends, 2); assert.equal(s.get().calls.length, 2); assert.equal(s.get().totalSettled, 450);
    assert.equal(s.get().call?.state, "outcome_unknown"); assert.equal(s.get().completed, 0);
  } finally { await s.cleanup(); }
});

test("a cap rejection after settling the original response prevents all repair transport and does not release source cost", async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairMode("valid"); s.repairCapBlocked();
    await assert.rejects(s.execute(), /run_cap_exceeded/u);
    await assert.rejects(s.execute(), /run_cap_exceeded/u);
    assert.equal(s.get().sends, 1); assert.equal(s.get().calls.length, 1); assert.equal(s.get().totalSettled, 450);
    assert.equal(s.get().calls[0]!.state, "settled"); assert.equal(s.get().completed, 0);
  } finally { await s.cleanup(); }
});

test("a proven unsent repair uses a successor with the same editorial identity on explicit job recovery", async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairMode("valid"); s.repairDisabled(true);
    await assert.rejects(s.execute(), /provider_disabled/u);
    const before = s.get(); assert.equal(before.sends, 1); assert.equal(before.calls[1]!.state, "definitely_not_sent");
    s.repairDisabled(false); await s.execute(); const done = s.get();
    assert.equal(done.sends, 2); assert.equal(done.calls.length, 3); assert.equal(done.totalSettled, 900);
    assert.equal(done.calls[2]!.retry_of_call_id, before.calls[1]!.call_id);
    assert.deepEqual(done.calls[2]!.editorial_repair, before.calls[1]!.editorial_repair);
    assert.equal(done.calls[2]!.request_digest, before.calls[1]!.request_digest);
    await s.execute(); assert.equal(s.get().sends, 2); assert.equal(s.get().calls.length, 3);
  } finally { await s.cleanup(); }
});

test("a provider-confirmed terminal repair gets one transport successor preserving its logical request and retained exposure", async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairMode("valid"); s.repairUnknown();
    await assert.rejects(s.execute(), /outcome_unknown/u);
    const original = structuredClone(s.get().calls[0]); s.confirmTerminal();
    const terminal = structuredClone(s.get().calls[1]);
    const terminalEvidence = structuredClone(s.get().terminalReceipts.get(terminal!.call_id));
    const authorization = new Date(Date.now() + 3_600_000).toISOString();
    s.repairUnknown(false); await s.execute(authorization); const done = s.get();
    assert.equal(done.calls.length, 3); assert.equal(done.sends, 3); assert.equal(done.completed, 1);
    const successor = done.calls[2]!;
    assert.equal(successor.retry_of_call_id, terminal!.call_id); assert.equal(successor.request_digest, terminal!.request_digest);
    assert.deepEqual(successor.editorial_repair, terminal!.editorial_repair);
    assert.deepEqual(done.calls[0], original); assert.deepEqual(done.calls[1], terminal);
    assert.deepEqual(done.terminalReceipts.get(terminal!.call_id), terminalEvidence);
    assert.equal(done.totalSettled, 900); assert.equal(done.retainedExposure, 900 + terminal!.reserved_micro_usd);
    assert.deepEqual(done.reservations[2]!.configuration, done.reservations[1]!.configuration);
    assert.equal(done.reservations[2]!.reserved_micro_usd, done.reservations[1]!.reserved_micro_usd);
    assert.deepEqual(done.seenBatches[2], done.seenBatches[1]);
    assert.equal(done.seenAuthorizations[2], authorization);
    assert.deepEqual(done.checkpointCallIds, [successor.call_id]);
    s.repairDisabled(true); await s.execute(); const replay = s.get();
    assert.equal(replay.sends, 3); assert.equal(replay.calls.length, 3); assert.equal(replay.materializationWrites, 1);
    assert.equal(replay.retainedExposure, done.retainedExposure); assert.deepEqual(replay.calls[1], terminal);
  } finally { await s.cleanup(); }
});

for (const stage of ["reservation", "response"] as const) test(`a terminal successor recovers its lost ${stage} acknowledgment without a duplicate send`, async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairMode("valid"); s.repairUnknown();
    await assert.rejects(s.execute(), /outcome_unknown/u); s.confirmTerminal();
    s.repairUnknown(false);
    if (stage === "reservation") s.loseRepairReservationAcknowledgment();
    else { s.targetRepairCrash(); s.loseResponseAcknowledgment(); }
    await assert.rejects(s.execute(), /workspace_engine_(worker_failed|interpretation_receipt_recovery_required)/u);
    assert.equal(s.get().calls[2]!.state, stage === "response" ? "response_persisted" : "reserved");
    assert.equal(s.get().sends, stage === "response" ? 3 : 2);
    if (stage === "response") s.repairDisabled(true);
    await s.execute();
    assert.equal(s.get().sends, 3); assert.equal(s.get().calls.length, 3); assert.equal(s.get().completed, 1);
    assert.equal(s.get().calls[1]!.state, "terminal_confirmed"); assert.equal(s.get().calls[1]!.settled_micro_usd, null);
  } finally { await s.cleanup(); }
});

test("an invalid terminal successor exhausts the same editorial repair instead of creating another logical repair", async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairUnknown(); await assert.rejects(s.execute(), /outcome_unknown/u); s.confirmTerminal();
    const terminal = structuredClone(s.get().calls[1]); s.repairUnknown(false);
    await assert.rejects(s.execute(), /workspace_engine_interpretation_repair_invalid/u);
    await assert.rejects(s.execute(), /workspace_engine_interpretation_repair_invalid/u);
    assert.equal(s.get().sends, 3); assert.equal(s.get().calls.length, 3); assert.equal(s.get().checkpointCount, 0);
    assert.equal(s.get().calls[2]!.state, "settled"); assert.equal(s.get().totalSettled, 900);
    assert.equal(s.get().retainedExposure, 900 + terminal!.reserved_micro_usd);
    assert.deepEqual(s.get().calls[2]!.editorial_repair, terminal!.editorial_repair);
    assert.deepEqual(s.get().calls[1], terminal);
  } finally { await s.cleanup(); }
});

test("an unknown terminal successor cannot be resent or extended, even when a later external terminal receipt is supplied", async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairUnknown(); await assert.rejects(s.execute(), /outcome_unknown/u);
    s.confirmTerminal(); await assert.rejects(s.execute(), /outcome_unknown/u);
    const before = s.get(); assert.equal(before.sends, 3); assert.equal(before.calls.length, 3);
    assert.equal(before.calls[2]!.state, "outcome_unknown");
    await assert.rejects(s.execute(), /outcome_unknown/u);
    assert.equal(s.get().calls.length, 3); assert.equal(s.get().sends, 3);
    s.confirmTerminal(); await assert.rejects(s.execute(), /transport_retry_exhausted/u);
    assert.equal(s.get().calls.length, 3); assert.equal(s.get().sends, 3); assert.equal(s.get().checkpointCount, 0);
    assert.equal(s.get().totalSettled, 450); assert.equal(s.get().retainedExposure, before.retainedExposure);
  } finally { await s.cleanup(); }
});

test("a terminal successor cap rejection retains the confirmed-terminal reservation and the original settled cost", async () => {
  const s = await scenario(); try {
    s.mode("invalid"); s.repairUnknown(); await assert.rejects(s.execute(), /outcome_unknown/u); s.confirmTerminal();
    const before = structuredClone(s.get().calls); const exposure = s.get().retainedExposure;
    s.repairCapBlocked(); await assert.rejects(s.execute(), /run_cap_exceeded/u);
    await assert.rejects(s.execute(), /run_cap_exceeded/u);
    assert.deepEqual(s.get().calls, before); assert.equal(s.get().sends, 2); assert.equal(s.get().totalSettled, 450);
    assert.equal(s.get().retainedExposure, exposure); assert.equal(s.get().completed, 0);
  } finally { await s.cleanup(); }
});

test("terminal evidence never bypasses current actor, input or lease rejection", async () => {
  for (const code of ["workspace_engine_interpretation_forbidden", "workspace_engine_interpretation_inputs_stale",
    "workspace_engine_interpretation_lease_conflict"]) {
    const s = await scenario(); try {
      s.mode("invalid"); s.repairUnknown(); await assert.rejects(s.execute(), /outcome_unknown/u); s.confirmTerminal();
      const before = structuredClone(s.get().calls); s.rejectReserve(code);
      await assert.rejects(s.execute(), error => error instanceof Error && error.message === code);
      assert.deepEqual(s.get().calls, before); assert.equal(s.get().sends, 2); assert.equal(s.get().completed, 0);
    } finally { await s.cleanup(); }
  }
});

async function rolloverScenario() {
  type Args = Parameters<typeof interpretWorkspaceEngineV1>[0];
  const directory = await mkdtemp(join(tmpdir(), "noisia-sonnet-rollover-"));
  // This fixture supplies local ledger rows and private storage. Real Worker
  // batching, provider decoding, artifact verification and materializer input run.
  const context = { workspace_id: uuid(2), execution_id: uuid(1), context_digest: hash("context"), data: { interests: [] } };
  const groups = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(cluster), cluster_id: `open:unit_${i + 1}`,
    cluster_digest: hash(`membership ${i + 1}`) }));
  const oldBatch = buildSignalWorkspaceInterpretationBatchV1(context, groups.slice(0, 4), legacyConfig);
  const interpretation = (group: SignalWorkspaceInterpretationClusterV1, wire = false) => ({ cluster_id: group.cluster_id,
    cluster_digest: group.cluster_digest, status: "coherent", name: `Reserva ${group.cluster_id}`,
    definition: "Diferencias entre reserva y cobro.", inclusion: [], exclusion: [],
    citations: [wire ? "r1" : group.representatives[0]!.ref_id] });
  let oldPacket = { contract_version: "workspace-engine-interpretation-result-v1", execution_id: context.execution_id,
    context, clusters: oldBatch.clusters, interpretations: oldBatch.clusters.map(group => interpretation(group)) };
  const originalBytes = Buffer.from(JSON.stringify(oldPacket));
  const files = new Map<string, Buffer>([["historical-4-units", originalBytes]]);
  const checkpoints: SignalWorkspaceEngineInterpretationCheckpointV1[] = [{ artifact_id: uuid(80), artifact_key: `interpretation-${uuid(6)}.json`,
    storage_key: "historical-4-units", sha256: hash(originalBytes), size_bytes: originalBytes.length, media_type: "application/json",
    unit_keys: oldBatch.clusters.map(item => item.cluster_id), call_id: uuid(6), call_configuration: legacyConfig,
    interpretation_revision_digest: null }];
  const revision = hash("authorized rollover");
  const lease: SignalWorkspaceEngineLeaseV1 = { execution_id: context.execution_id, workspace_id: context.workspace_id,
    execution_token: uuid(4), input_digest: hash("snapshot"), interpretation_revision_digest: revision,
    effective_interpretation_config: { call_configuration: config, daily_cap_micro_usd: 30_000_000, budget_timezone: "UTC" },
    snapshot: { contract_version: "workspace-topic-engine-v1", workspace_id: context.workspace_id, taxonomy_profile_id: uuid(20),
      preparation_run_id: uuid(21), embedding_run_id: uuid(22), input_revision: "1", embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
      context_digest: context.context_digest, catalog_digest: hash("catalog"), prototype_plan_digest: hash("plan"), expected_roots: 3,
      expected_chunks: 3, expected_guides: 0, parent_execution_id: null, context_refs: [], engine_config: { ...SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 },
      claude_cap_micro_usd: 30_000_000, interpretation_config: { call_configuration: legacyConfig, daily_cap_micro_usd: 30_000_000, budget_timezone: "UTC" } } };
  let sends = 0, claims = 0, reserved = 0, newCost = 0, complete = 0, crash = false, readError: string | null = null;
  const pages: Array<string | null> = [], proposalBodies: string[] = [], sentUnits: string[][] = [];
  let call: SignalWorkspaceEngineInterpretationCallV1 | null = null;
  const stores = {
    context: async () => ({ actor_user_id: uuid(5), context }),
    fit: async () => ({}),
    checkpoints: async (args: { after_artifact_id?: string | null }) => {
      if (readError) throw new Error(readError);
      pages.push(args.after_artifact_id ?? null);
      const rows = checkpoints.filter(item => !args.after_artifact_id || item.artifact_id > args.after_artifact_id);
      return { items: rows.slice(0, 1), next_artifact_id: rows[0]?.artifact_id ?? null, done: rows.length <= 1 };
    },
    reserve: async (args: Parameters<NonNullable<Args["stores"]>["reserve"]>[0]) => {
      reserved++; assert.deepEqual(args.configuration, config); assert.equal(args.interpretation_revision_digest, revision);
      assert.equal(args.execution_id, lease.execution_id); assert.equal(args.execution_token, lease.execution_token);
      call = { call_id: uuid(90), execution_id: lease.execution_id, workspace_id: lease.workspace_id, attempt_token: uuid(91),
        retry_of_call_id: null, editorial_repair: null, state: "reserved", request_digest: args.request_digest,
        reserved_micro_usd: args.reserved_micro_usd, settled_micro_usd: null, response: null, interpretation_revision_digest: revision };
      return { ...call };
    },
    sent: async () => { claims++; assert.equal(call!.state, "reserved"); call!.state = "in_flight"; return { call, send_authorized: true }; },
    response: async (args: { response: NonNullable<SignalWorkspaceEngineInterpretationCallV1["response"]> }) => {
      call!.response = args.response; call!.state = "response_persisted"; return { ...call! };
    },
    settle: async () => { newCost += 450; call!.settled_micro_usd = 450; call!.state = "settled"; return { ...call! }; },
    fail: async () => { throw new Error("unexpected rollover failure"); },
    checkpoint: async (args: Parameters<NonNullable<Args["stores"]>["checkpoint"]>[0]) => {
      checkpoints.push({ ...args.artifact, artifact_id: uuid(100), call_id: call!.call_id, call_configuration: config,
        unit_keys: args.unit_keys, interpretation_revision_digest: revision });
      if (crash) { crash = false; throw new Error("lost checkpoint acknowledgment"); }
      return { artifact_id: uuid(100) };
    },
    materialize: async (args: { proposals: AsyncIterable<{ artifact_id: string; body: string }> }) => {
      const keys: string[] = []; proposalBodies.length = 0;
      for await (const source of args.proposals) {
        proposalBodies.push(source.body); const packet = JSON.parse(source.body);
        for (const item of packet.interpretations) { keys.push(item.cluster_id); assert.deepEqual(item.citations, [cluster.representatives[0]!.ref_id]); }
      }
      assert.deepEqual(keys.sort(), groups.map(item => item.cluster_id));
      assert.equal(new Set(keys).size, 6); assert.equal(proposalBodies[0], originalBytes.toString());
      return { contract_version: "workspace-topic-materialization-v1", execution_id: lease.execution_id, output_catalog_profile_id: uuid(9),
        output_catalog_revision: 2, interpretation_units_digest: hash("all six"), topic_count: 6, discovered_topic_count: 6,
        mapping_digest: hash("mapping"), mapping: [], replayed: false };
    },
    persist: async () => ({ artifact_id: uuid(101) }), complete: async () => { complete++; return { execution_id: lease.execution_id }; },
  } as unknown as NonNullable<Args["stores"]>;
  const execute = async () => interpretWorkspaceEngineV1({ database: {} as Args["database"], lease, stores,
    directory: await mkdtemp(join(directory, "attempt-")), clusters: groups, heartbeat: async () => undefined,
    fit: { model_artifact_id: uuid(11), output_artifact_id: uuid(12), coverage: { roots: 3, chunks: 3, guides: 0 },
      model_configuration: {}, runtime_kind: "python", artifact_format: "workspace-model-bundle-v1", license_key: null,
      result_kind: "computational_grouping" }, api_key: "test_only_not_a_real_api_key", provider_enabled: true,
    storage: { put: async args => { const bytes = await readFile(args.file); const key = args.sha256;
        files.set(key, bytes); return { storage_key: key, sha256: args.sha256, size_bytes: bytes.length, media_type: args.media_type }; },
      get: async args => { await writeFile(args.destination, files.get(args.stored.storage_key)!, { flag: "wx" }); } },
    send: args => sendWorkspaceInterpretationV1({ ...args, fetch_impl: (async (_url, init) => {
      sends++; sentUnits.push(args.batch.clusters.map(item => item.cluster_id));
      assert.equal(JSON.parse(init!.body as string).model, "claude-sonnet-4-6");
      return Response.json({ model: "claude-sonnet-4-6", type: "message", role: "assistant", stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify({
          interpretations: args.batch.clusters.map(group => interpretation(group, true)) }) }] });
    }) as typeof fetch }),
  });
  return { execute, get: () => ({ sends, claims, reserved, newCost, complete, pages, sentUnits, proposalBodies }),
    crashAfterCheckpoint: () => { crash = true; }, rejectReader: (code: string) => { readError = code; },
    tamper: (kind: string) => {
      const row = checkpoints[0]!;
      if (kind === "hash") { files.set(row.storage_key, Buffer.from(originalBytes.toString().replace("Reserva", "Alterar"))); return; }
      if (kind === "size") { row.size_bytes++; return; }
      if (kind === "units") { row.unit_keys = [groups[5]!.cluster_id]; return; }
      if (kind === "profile") { row.call_configuration = config; return; }
      if (kind === "revision") { row.interpretation_revision_digest = hash("unauthorized"); return; }
      if (kind === "duplicate") { checkpoints.push({ ...row, artifact_id: uuid(81) }); return; }
      oldPacket = structuredClone(oldPacket);
      if (kind === "context") oldPacket.context.context_digest = hash("another context");
      if (kind === "cluster") oldPacket.clusters[0]!.terms.push("unrelated evidence");
      if (kind === "citation") oldPacket.interpretations[0]!.citations = [hash("not in representative evidence")];
      if (kind === "alias") oldPacket.interpretations[0]!.citations = ["r1"];
      const bytes = Buffer.from(JSON.stringify(oldPacket)); files.set(row.storage_key, bytes); row.sha256 = hash(bytes); row.size_bytes = bytes.length;
    }, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
test("same execution keeps four historical Opus units and sends only two pending Sonnet units", async () => {
  const s = await rolloverScenario(); try {
    await s.execute(); const result = s.get();
    assert.deepEqual(result.sentUnits, [["open:unit_5", "open:unit_6"]]);
    assert.equal(result.sends, 1); assert.equal(result.claims, 1); assert.equal(result.reserved, 1);
    assert.equal(result.newCost, 450); assert.equal(result.complete, 1); assert.equal(result.proposalBodies.length, 2);
  } finally { await s.cleanup(); }
});
test("rollover resumes after a lost checkpoint acknowledgment without resending any of the six units", async () => {
  const s = await rolloverScenario(); try {
    s.crashAfterCheckpoint(); await assert.rejects(s.execute(), /lost checkpoint acknowledgment/u);
    assert.equal(s.get().complete, 0); await s.execute();
    assert.equal(s.get().sends, 1); assert.equal(s.get().reserved, 1); assert.equal(s.get().newCost, 450);
    assert.equal(s.get().complete, 1); assert.deepEqual(s.get().pages, [null, null, uuid(80)]);
  } finally { await s.cleanup(); }
});
for (const kind of ["hash", "size", "context", "cluster", "citation", "alias", "units", "duplicate", "profile", "revision"]) {
  test(`rollover rejects ${kind} checkpoint corruption before any reservation or provider admission`, async () => {
    const s = await rolloverScenario(); try {
      s.tamper(kind); await assert.rejects(s.execute(), /workspace_engine_interpretation_checkpoint_invalid/u);
      assert.equal(s.get().reserved, 0); assert.equal(s.get().claims, 0); assert.equal(s.get().sends, 0); assert.equal(s.get().complete, 0);
    } finally { await s.cleanup(); }
  });
}
test("checkpoint recovery cannot bypass a rejected lease or current context", async () => {
  for (const code of ["workspace_engine_lease_conflict", "workspace_engine_forbidden", "workspace_engine_inputs_stale"]) {
    const s = await rolloverScenario(); try {
      s.rejectReader(code); await assert.rejects(s.execute(), error => error instanceof Error && error.message === code);
      assert.equal(s.get().reserved, 0); assert.equal(s.get().sends, 0); assert.equal(s.get().complete, 0);
    } finally { await s.cleanup(); }
  }
});
