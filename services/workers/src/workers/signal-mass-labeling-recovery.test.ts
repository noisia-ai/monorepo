import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_MASS_LABELING_INTERPRETATION_CONFIGURATION_V1 as configuration,
  SIGNAL_WORKSPACE_ENGINE_CONFIG_V1,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  batchSignalWorkspaceInterpretationV1,
  buildSignalWorkspaceInterpretationRepairBatchV1,
  signalWorkspaceInterpretationReferenceIdV1,
  signalWorkspaceEmbeddingDigestV1,
  type SignalWorkspaceInterpretationClusterV1,
  type SignalWorkspaceInterpretationBatchV1,
} from "@noisia/query-engine";
import type {
  SignalWorkspaceEngineInterpretationCallV1,
  SignalWorkspaceEngineLeaseV1,
} from "@noisia/db";
import { interpretWorkspaceEngineV1 } from "./signal-workspace-engine-interpret";
import { sendWorkspaceInterpretationV1 } from "../providers/workspace-interpretation";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (text: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
type Args = Parameters<typeof interpretWorkspaceEngineV1>[0];
type Checkpoint = Awaited<
  ReturnType<NonNullable<Args["stores"]>["checkpoints"]>
>["items"][number];

function group(n: number): SignalWorkspaceInterpretationClusterV1 {
  return {
    cluster_id: `guided:${String(n).padStart(3, "0")}`,
    lane: "guided",
    cluster_digest: sha(`members${n}`),
    root_count: 40,
    chunk_count: 40,
    terms: ["cerveja"],
    representatives: Array.from({ length: 30 }, (_, r) => {
      const text = `Experiência de consumo ${n} ${r}`;
      const ref = {
        root_id: id(n * 100 + r),
        chunk_index: 0,
        start: 0,
        end: text.length,
        chunk_sha256: sha(text),
      };
      return {
        ...ref,
        ref_id: signalWorkspaceInterpretationReferenceIdV1(ref),
        text,
        strength: 0.9,
        selection_reason:
          r === 29 ? "low_affiliation_boundary" : "high_affiliation",
      };
    }),
  };
}
function raw(
  batch: SignalWorkspaceInterpretationBatchV1,
  missingTopReference = false,
) {
  const output = {
    interpretations: batch.clusters.map((g, n) => ({
      cluster_id: g.cluster_id,
      cluster_digest: g.cluster_digest,
      status: missingTopReference && n === 0 ? "mixed" : "coherent",
      name: "Experiências de consumo",
      definition: "Conversas sobre experiências de consumo.",
      citations:
        missingTopReference && n === 0
          ? []
          : g.representatives.map((_, r) => `r${r + 1}`),
      inclusion: [
        {
          text: "Experiências sustentadas pelos representantes",
          citations: g.representatives.map((_, r) => `r${r + 1}`),
        },
      ],
      exclusion: [],
    })),
  };
  return Buffer.from(
    JSON.stringify({
      id: "msg_synthetic",
      model: configuration.model,
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 10 },
      content: [{ type: "text", text: JSON.stringify(output) }],
    }),
  );
}

const cases: Array<{
  state?: SignalWorkspaceEngineInterpretationCallV1["state"];
  invalidRepair?: boolean;
  originalSuccessor?: boolean;
  operatorInsufficient?: "approved" | "wrong_hash" | "wrong_unit";
}> = [
  {},
  { state: "reserved" },
  { state: "definitely_not_sent" },
  { state: "terminal_confirmed" },
  { state: "outcome_unknown" },
  { state: "in_flight" },
  { invalidRepair: true },
  { originalSuccessor: true },
  { operatorInsufficient: "approved" },
  { operatorInsufficient: "wrong_hash" },
  { operatorInsufficient: "wrong_unit" },
];
for (const scenario of cases)
  test(`pilot recovery preserves original batches and handles repair ${scenario.state ?? scenario.operatorInsufficient ?? (scenario.invalidRepair ? "invalid" : scenario.originalSuccessor ? "original_successor" : "unrequested")}`, async () => {
    const groups = Array.from(
      { length: scenario.invalidRepair ? 16 : 12 },
      (_, n) => group(n + 1),
    );
    const context = {
      workspace_id: id(1),
      execution_id: id(2),
      context_digest: sha("context"),
      data: {
        interests: [],
        brand_os: {
          context_digest: sha("context"),
          seeds: [],
          locale: { primary_locale: "pt-BR" },
        },
      },
    };
    const plan = [
      ...batchSignalWorkspaceInterpretationV1(context, groups, configuration),
    ];
    assert.equal(plan.length, scenario.invalidRepair ? 4 : 3);
    const lease: SignalWorkspaceEngineLeaseV1 = {
      workspace_id: context.workspace_id,
      execution_id: context.execution_id,
      execution_token: id(3),
      input_digest: sha("snapshot"),
      snapshot: {
        contract_version: "workspace-topic-engine-v1",
        workspace_id: context.workspace_id,
        taxonomy_profile_id: id(4),
        preparation_run_id: id(5),
        embedding_run_id: id(6),
        input_revision: "1",
        embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
        context_digest: context.context_digest,
        catalog_digest: sha("catalog"),
        prototype_plan_digest: sha("guides"),
        expected_roots: groups.length * 40,
        expected_chunks: groups.length * 40,
        expected_guides: 0,
        parent_execution_id: null,
        context_refs: [],
        engine_config: {
          ...SIGNAL_WORKSPACE_ENGINE_CONFIG_V1,
          profile_version: "workspace-bertopic-mass-labeling-v3",
        },
        claude_cap_micro_usd: 10_000_000,
        interpretation_config: {
          call_configuration: configuration,
          budget_timezone: "UTC",
          daily_cap_micro_usd: 10_000_000,
        },
      },
    };
    const files = new Map<string, Buffer>(),
      calls = new Map<string, SignalWorkspaceEngineInterpretationCallV1>(),
      batches = new Map<string, SignalWorkspaceInterpretationBatchV1>();
    const requestKeys = new Map<string, string>();
    const quarantines = new Set<string>();
    const checkpointRows: Checkpoint[] = [],
      checkpointed = new Set<string>(),
      claims = new Map<string, string>(),
      reviews = new Set<string>();
    const reservations: string[] = [],
      sent: string[] = [],
      claimed: string[] = [],
      checkpointCalls: string[] = [];
    let next = 100,
      unresolvedException = true,
      completed = 0;
    const storeBytes = (bytes: Buffer) => {
      const storage_key = `fixture/${sha(bytes).slice(7)}`;
      files.set(storage_key, bytes);
      return {
        storage_key,
        sha256: sha(bytes),
        size_bytes: bytes.length,
        media_type: "application/json",
      };
    };
    function seed(
      batch: SignalWorkspaceInterpretationBatchV1,
      invalid = false,
      requestKey = batch.batch_key,
    ) {
      const call: SignalWorkspaceEngineInterpretationCallV1 = {
        call_id: id(next++),
        workspace_id: lease.workspace_id,
        execution_id: lease.execution_id,
        attempt_token: id(next++),
        retry_of_call_id: null,
        state: "settled",
        reserved_micro_usd: batch.reserved_micro_usd,
        settled_micro_usd: 450,
        request_digest: batch.request_digest,
        interpretation_revision_digest: null,
        editorial_repair: batch.editorial_repair ?? null,
        response: {
          ...storeBytes(raw(batch, invalid)),
          http_status: 200,
          provider_request_id: "req_synthetic",
          complete: true,
        },
      };
      calls.set(call.call_id, call);
      batches.set(call.call_id, batch);
      requestKeys.set(requestKey, call.call_id);
      return call;
    }
    const first = seed(plan[0]!);
    const firstRepair = seed(
      buildSignalWorkspaceInterpretationRepairBatchV1(plan[0]!, {
        source_call_id: first.call_id,
        source_response_sha256: first.response!.sha256,
        diagnostic: "output_invalid",
      }),
    );
    const second = seed(plan[1]!);
    seed(
      buildSignalWorkspaceInterpretationRepairBatchV1(plan[1]!, {
        source_call_id: second.call_id,
        source_response_sha256: second.response!.sha256,
        diagnostic: "output_invalid",
      }),
    );
    let last = seed(plan[2]!, true);
    const originalAncestor = last;
    if (scenario.originalSuccessor) {
      last = seed(
        plan[2]!,
        true,
        `${plan[2]!.batch_key}:retry:${originalAncestor.call_id}`,
      );
      last.retry_of_call_id = originalAncestor.call_id;
      originalAncestor.state = "terminal_confirmed";
      originalAncestor.response = null;
      originalAncestor.settled_micro_usd = null;
    }
    let existingRepair: SignalWorkspaceEngineInterpretationCallV1 | undefined;
    if (scenario.state) {
      const repair = buildSignalWorkspaceInterpretationRepairBatchV1(plan[2]!, {
        source_call_id: last.call_id,
        source_response_sha256: last.response!.sha256,
        diagnostic: "output_invalid",
      });
      existingRepair = seed(repair);
      existingRepair.state = scenario.state;
      existingRepair.response = null;
      existingRepair.settled_micro_usd = null;
    }
    if (scenario.operatorInsufficient) {
      existingRepair = seed(buildSignalWorkspaceInterpretationRepairBatchV1(plan[2]!, {
        source_call_id: last.call_id, source_response_sha256: last.response!.sha256, diagnostic: "output_invalid",
      }), true);
    }
    const initialCalls = calls.size;
    const initialLedger = JSON.stringify([...calls.values()]);
    const decision = scenario.operatorInsufficient ? {
      decision_id: id(800), workspace_id: lease.workspace_id, execution_id: lease.execution_id,
      exception_id: id(801), unit_key: groups[scenario.operatorInsufficient === "wrong_unit" ? 9 : 8]!.cluster_id,
      original_call_id: last.call_id, repair_call_id: existingRepair!.call_id,
      original_response_sha256: last.response!.sha256,
      repair_response_sha256: scenario.operatorInsufficient === "wrong_hash" ? sha("foreign") : existingRepair!.response!.sha256,
      input_digest: lease.input_digest, fit_checkpoint_digest: sha("fit"), reason: "missing_general_citations" as const,
      created_by_user_id: id(7), created_at: "2026-11-07T00:00:00.000Z",
    } : null;
    const storage: WorkspaceEngineStorageV1 = {
      put: async (a) => storeBytes(await readFile(a.file)),
      get: async (a) => {
        const bytes = files.get(a.stored.storage_key)!;
        assert.equal(sha(bytes), a.stored.sha256);
        await writeFile(a.destination, bytes, { flag: "wx" });
      },
    };
    async function checkpoint(
      call: SignalWorkspaceEngineInterpretationCallV1,
      body: string,
    ) {
      const batch = batches.get(call.call_id)!;
      const row = {
        ...storeBytes(Buffer.from(body)),
        artifact_id: id(next++),
        artifact_key: `interpretation-${call.call_id}.json`,
        call_id: call.call_id,
        request_digest: call.request_digest,
        call_configuration: configuration,
        unit_keys: batch.clusters.map((g) => g.cluster_id),
        interpretation_revision_digest: null,
        insufficiency_decision_id: JSON.parse(body).operator_insufficiency?.decision_id ?? null,
      };
      checkpointRows.push(row);
      for (const key of row.unit_keys) checkpointed.add(key);
      checkpointCalls.push(call.call_id);
      if (row.unit_keys.includes(groups[4]!.cluster_id))
        unresolvedException = false;
      return {
        artifact_id: row.artifact_id,
        replayed: false,
        interpreted_units: checkpointed.size,
      };
    }
    const decodedFirst = JSON.parse(
      raw(batches.get(firstRepair.call_id)!).toString(),
    ).content[0].text;
    const canonical = JSON.parse(decodedFirst);
    for (const result of canonical.interpretations) {
      const g = groups.find((g) => g.cluster_id === result.cluster_id)!;
      result.citations = g.representatives.map((r) => r.ref_id);
      result.inclusion[0].citations = result.citations;
    }
    await checkpoint(
      firstRepair,
      JSON.stringify({
        contract_version: "workspace-engine-interpretation-result-v1",
        execution_id: lease.execution_id,
        context,
        clusters: plan[0]!.clusters,
        interpretations: canonical.interpretations,
        editorial_repair: firstRepair.editorial_repair,
      }),
    );
    const stores: NonNullable<Args["stores"]> = {
      context: async () => ({ actor_user_id: id(7), context }),
      fit: async () => ({
        checkpoint_digest: sha("fit"),
        model_version_id: id(12),
        model_artifact_id: id(10),
        output_artifact_id: id(11),
        result_kind: "computational_grouping",
        interpretation_manifest: { unit_count: 12, unit_digest: sha("units") },
      }),
      checkpoints: async (a) => {
        const rows = checkpointRows
          .filter(
            (r) => !a.after_artifact_id || r.artifact_id > a.after_artifact_id,
          )
          .sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
        return {
          items: rows,
          next_artifact_id:
            rows.at(-1)?.artifact_id ?? a.after_artifact_id ?? null,
          done: true,
        };
      },
      recoverable: async () => [...calls.values()].map((c) => c.request_digest),
      exceptions: async () =>
        unresolvedException
          ? ([
              { unit_keys: plan[1]!.clusters.map((g) => g.cluster_id) },
            ] as never)
          : [],
      insufficiencyDecisions: async () => decision ? [decision] : [],
      recoveryCalls: async () =>
        [...calls.values()].map((c) => ({
          ...c,
          call_configuration: configuration,
          unit_keys: batches.get(c.call_id)!.clusters.map((g) => g.cluster_id),
          checkpointed_unit_keys: batches
            .get(c.call_id)!
            .clusters.map((g) => g.cluster_id)
            .filter((k) => checkpointed.has(k)),
          is_global_consolidation: false,
        })),
      registerUnits: async (a) => {
        assert.equal(a.request_digest, a.batch.request_digest);
        for (const key of a.unit_keys) {
          if (claims.has(key)) assert.equal(claims.get(key), a.request_digest);
          else claims.set(key, a.request_digest);
        }
        claimed.push(a.call_id);
        return { replayed: false };
      },
      recoveryReview: async (a) => {
        assert.equal(a.call_id, last.call_id);
        assert.equal(a.outcome, "needs_repair");
        reviews.add(a.call_id);
        return { replayed: false };
      },
      pauseRecovery: async (a) => ({
        execution_id: lease.execution_id,
        status: "failed",
        recovery_status: a.reason,
        recovered_units: checkpointed.size,
        pending_units: groups.length - checkpointed.size,
      }),
      reserve: async (a) => {
        reservations.push(a.request_digest);
        const old = calls.get(requestKeys.get(a.idempotency_key) ?? "");
        if (old) return old;
        assert.ok(a.editorial_repair);
        assert.equal(a.editorial_repair.source_call_id, last.call_id);
        assert.ok(reviews.has(last.call_id));
        const original = plan[2]!,
          batch = buildSignalWorkspaceInterpretationRepairBatchV1(
            original,
            a.editorial_repair,
          );
        const call = seed(batch, false, a.idempotency_key);
        call.retry_of_call_id = a.retry_of_call_id ?? null;
        if (a.retry_of_call_id)
          assert.ok(
            ["definitely_not_sent", "terminal_confirmed"].includes(
              calls.get(a.retry_of_call_id)!.state,
            ),
          );
        call.state = "reserved";
        call.response = null;
        call.settled_micro_usd = null;
        return call;
      },
      sent: async (a) => {
        const c = calls.get(a.call_id)!;
        assert.equal(c.state, "reserved");
        c.state = "in_flight";
        sent.push(c.call_id);
        return { call: c, send_authorized: true };
      },
      response: async (a) => {
        const c = calls.get(a.call_id)!;
        c.response = { ...a.response, complete: a.response.complete ?? true };
        c.state = "response_persisted";
        return c;
      },
      settle: async (a) => {
        const c = calls.get(a.call_id)!;
        assert.ok(c.response);
        c.state = "settled";
        c.settled_micro_usd = 450;
        return c;
      },
      fail: async () => {
        throw Error("unexpected ledger failure");
      },
      checkpoint: async (a) => {
        const c = calls.get(a.call_id)!;
        const body = files.get(a.artifact.storage_key)!.toString();
        if (a.insufficiency_decision_id) {
          assert.equal(a.insufficiency_packet, body);
          assert.equal(a.insufficiency_decision_id, decision!.decision_id);
          const packet = JSON.parse(body), selected = packet.interpretations.find((row: {cluster_id: string}) => row.cluster_id === decision!.unit_key);
          assert.deepEqual(selected, { cluster_id: decision!.unit_key, cluster_digest: groups[8]!.cluster_digest,
            status: "insufficient", name: null, definition: null, inclusion: [], exclusion: [], citations: [] });
          assert.equal(packet.operator_insufficiency.original_response, files.get(last.response!.storage_key)!.toString());
          assert.equal(packet.operator_insufficiency.repair_response, files.get(existingRepair!.response!.storage_key)!.toString());
        }
        return checkpoint(c, body);
      },
      quarantine: async (a) => {
        assert.ok(scenario.invalidRepair);
        const replayed = quarantines.has(a.repair_call_id);
        quarantines.add(a.repair_call_id);
        return { replayed } as never;
      },
      materialize: async (a) => {
        let n = 0;
        for await (const proposal of a.proposals) {
          n += JSON.parse(proposal.body).interpretations.length;
        }
        assert.equal(n, 12);
        return {
          contract_version: "workspace-topic-materialization-v1",
          execution_id: lease.execution_id,
          output_catalog_profile_id: id(8),
          output_catalog_revision: 1,
          topic_count: 12,
          discovered_topic_count: 12,
          mapping_digest: sha("mapping"),
          interpretation_units_digest: sha("units"),
          mapping: [],
          replayed: false,
        };
      },
      persist: async () => ({ artifact_id: id(9), replayed: false }),
      complete: async () => {
        completed++;
        return {
          execution_id: lease.execution_id,
          model_version_id: id(12),
          output_catalog_profile_id: id(8),
          topic_count: 12,
        };
      },
      completePartial: async () => {
        throw Error("unexpected partial completion");
      },
    };
    async function run(recovery_only: boolean) {
      const directory = await mkdtemp(join(tmpdir(), "pilot-replay-"));
      try {
        return await interpretWorkspaceEngineV1({
          database: {} as Args["database"],
          lease,
          fit: {
            model_artifact_id: id(10),
            output_artifact_id: id(11),
            coverage: {
              roots: groups.length * 40,
              chunks: groups.length * 40,
              guides: 0,
            },
            result_kind: "computational_grouping",
            model_configuration: {},
            runtime_kind: "python",
            artifact_format: "workspace-model-bundle-v1",
            license_key: null,
          },
          clusters: groups,
          directory,
          storage,
          heartbeat: async () => {},
          stores,
          recovery_only,
          provider_enabled: !recovery_only,
          send: async (a) =>
            sendWorkspaceInterpretationV1({
              ...a,
              api_key: "synthetic-key-for-unit-test",
              fetch_impl: async () =>
                new Response(raw(a.batch, scenario.invalidRepair), {
                  status: 200,
                }),
            }),
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    if (
      scenario.state === "outcome_unknown" ||
      scenario.state === "in_flight"
    ) {
      await assert.rejects(run(true), /outcome_unknown/u);
      await assert.rejects(run(false), /outcome_unknown/u);
      assert.equal(sent.length, 0);
      assert.equal(reservations.length, 0);
      assert.equal(calls.size, initialCalls);
      return;
    }
    if (scenario.operatorInsufficient) {
      if (scenario.operatorInsufficient !== "approved") {
        await assert.rejects(run(true), /insufficiency_decision_invalid/u);
        assert.equal(checkpointed.size, 8);
        assert.equal(JSON.stringify([...calls.values()]), initialLedger);
      } else {
        await run(true);
        assert.equal(checkpointed.size, 12);
        assert.equal(checkpointRows.filter(row => row.insufficiency_decision_id).length, 1);
        const firstPass = JSON.stringify(checkpointRows);
        await run(true);
        await run(false);
        assert.equal(JSON.stringify(checkpointRows), firstPass);
        assert.equal(JSON.stringify([...calls.values()]), initialLedger);
        const operatorRow = checkpointRows.find(row => row.insufficiency_decision_id)!;
        const operatorBody = JSON.parse(files.get(operatorRow.storage_key)!.toString());
        operatorBody.interpretations[1].definition += " changed";
        Object.assign(operatorRow, storeBytes(Buffer.from(JSON.stringify(operatorBody))));
        await assert.rejects(run(true), /checkpoint_invalid/u);
      }
      assert.equal(reservations.length, 0);
      assert.equal(sent.length, 0);
      assert.equal(calls.size, initialCalls);
      return;
    }
    const recovered = await run(true);
    assert.ok("recovery_status" in recovered);
    assert.equal(recovered.recovery_status, "bounded_repair_pending");
    assert.equal(checkpointed.size, 8);
    assert.equal(reservations.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(calls.size, initialCalls);
    assert.ok(checkpointCalls.includes(firstRepair.call_id));
    assert.ok(checkpointCalls.includes(second.call_id));
    assert.equal(checkpointCalls.includes(first.call_id), false);
    assert.equal(unresolvedException, false);
    assert.equal(claims.size, 12);
    await run(true);
    assert.equal(reservations.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(calls.size, initialCalls);
    if (scenario.invalidRepair) {
      await assert.rejects(
        run(false),
        /workspace_engine_interpretation_output_invalid/u,
      );
      assert.equal(sent.length, 1);
      assert.equal(calls.size, initialCalls + 1);
      assert.equal(checkpointed.size, 8);
      assert.equal(completed, 0);
      assert.equal(quarantines.size, 1);
      await assert.rejects(
        run(true),
        /workspace_engine_interpretation_output_invalid/u,
      );
      assert.equal(sent.length, 1);
      assert.equal(calls.size, initialCalls + 1);
      return;
    }
    await run(false);
    assert.equal(sent.length, 1);
    const successor =
      scenario.state === "terminal_confirmed" ||
      scenario.state === "definitely_not_sent";
    assert.equal(
      calls.size,
      initialCalls + (scenario.state ? (successor ? 1 : 0) : 1),
    );
    if (scenario.state === "reserved")
      assert.deepEqual(sent, [existingRepair!.call_id]);
    assert.equal(checkpointed.size, 12);
    assert.equal(completed, 1);
    assert.equal(calls.get(last.call_id)!.state, "settled");
    if (scenario.originalSuccessor)
      assert.equal(
        calls.get(originalAncestor.call_id)!.state,
        "terminal_confirmed",
      );
    assert.ok(
      [...calls.values()].filter(
        (c) => c.editorial_repair?.source_call_id === last.call_id,
      ).length === (successor ? 2 : 1),
    );
    assert.equal(claimed.filter((c) => c === last.call_id).length, 3);
  });
