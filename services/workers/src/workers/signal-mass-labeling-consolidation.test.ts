import { WorkspaceInterpretationTransportErrorV1 } from "../providers/workspace-interpretation";
import { sendMassLabelingConsolidationV1 } from "../providers/mass-labeling-consolidation";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as configuration,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  signalWorkspaceMassLabelingConfigV1,
  buildMassLabelingConsolidationRequestV1,
} from "@noisia/query-engine";
import type {
  SignalWorkspaceEngineLeaseV1,
  SignalWorkspaceEngineInterpretationCallV1,
} from "@noisia/db";
import { consolidateMassLabelingGroupsV1 } from "./signal-mass-labeling-consolidation";

const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const sha = (body: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(body).digest("hex")}`;
async function fixture(valid = true, sourceStatus: "coherent" | "insufficient" = "coherent", groupCount = 1) {
  const directory = await mkdtemp(join(tmpdir(), "mass-global-test-"));
  const contextDigest = sha("context"),
    workspace = id(1),
    execution = id(2);
  const lease: SignalWorkspaceEngineLeaseV1 = {
    workspace_id: workspace,
    execution_id: execution,
    execution_token: id(3),
    input_digest: sha("input"),
    snapshot: {
      contract_version: "workspace-topic-engine-v1",
      workspace_id: workspace,
      taxonomy_profile_id: id(10),
      preparation_run_id: id(11),
      embedding_run_id: id(12),
      input_revision: "1",
      embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
      context_digest: contextDigest,
      catalog_digest: sha("catalog"),
      prototype_plan_digest: sha("plan"),
      expected_roots: 1,
      expected_chunks: 1,
      expected_guides: 1,
      parent_execution_id: null,
      context_refs: [],
      engine_config: signalWorkspaceMassLabelingConfigV1(1),
      claude_cap_micro_usd: 2_000_000,
      interpretation_config: {
        call_configuration: configuration,
        budget_timezone: "UTC",
        daily_cap_micro_usd: 2_000_000,
      },
    },
  };
  const groupIds = Array.from({ length: groupCount }, (_, index) => `guided:synthetic-${index}`);
  const clusters = groupIds.map(group_id => ({ cluster_id: group_id, cluster_digest: sha(group_id),
    representatives: [{ text: "PRIVATE SYNTHETIC MENTION MUST STAY OUT OF GLOBAL INPUT" }] }));
  const interpretations = clusters.map(cluster => ({ cluster_id: cluster.cluster_id, cluster_digest: cluster.cluster_digest,
    status: sourceStatus, name: sourceStatus === "insufficient" ? null : "Consumo",
    definition: sourceStatus === "insufficient" ? null : "Motivos de consumo." }));
  const packets = groupIds.map((_, index) => ({ artifact_id: index === 0 ? id(7) : id(700 + index),
    file: join(directory, `group-${index}.json`), body: JSON.stringify({
      contract_version: "workspace-engine-interpretation-result-v1", execution_id: execution,
      context: { workspace_id: workspace, context_digest: contextDigest },
      clusters: [clusters[index]], interpretations: [interpretations[index]],
    }) }));
  await Promise.all(packets.map(packet => writeFile(packet.file, packet.body)));
  const batch = buildMassLabelingConsolidationRequestV1({ workspace_id: workspace, source_engine_execution_id: execution,
    source_groups: interpretations.map((result, index) => ({ group_id: result.cluster_id, cluster_digest: result.cluster_digest,
      name: result.name, definition: result.definition, status: result.status, source_artifact_id: packets[index]!.artifact_id })) });
  const call: SignalWorkspaceEngineInterpretationCallV1 = {
    admission: null,
    call_id: id(4),
    execution_id: execution,
    workspace_id: workspace,
    attempt_token: id(5),
    retry_of_call_id: null,
    state: "reserved",
    reserved_micro_usd: batch.reserved_micro_usd,
    settled_micro_usd: null,
    request_digest: batch.request_digest,
    interpretation_revision_digest: null,
    editorial_repair: null,
    response: null,
  };
  let sends = 0, charges = 0, persisted = 0, createdSuccessors = 0;
  const calls = new Map([[call.call_id, call]]);
  const reservations: Array<Parameters<NonNullable<Parameters<typeof consolidateMassLabelingGroupsV1>[0]["stores"]>["reserve"]>[0]> = [];
  const sourceChecks: number[] = [];
  const getCall = (call_id: string) => { const found = calls.get(call_id); assert.ok(found); return found; };
  const files = new Map<string, Buffer>();
  const args: Parameters<typeof consolidateMassLabelingGroupsV1>[0] = {
    database: {} as never,
    lease,
    actor_user_id: id(6),
    proposals: packets.map(({ artifact_id, file }) => ({ artifact_id, file })),
    directory,
    expected_group_ids: groupIds,
    expected_cluster_digests: Object.fromEntries(clusters.map(cluster => [cluster.cluster_id, cluster.cluster_digest])),
    api_key: "synthetic-key",
    provider_enabled: true,
    storage: {
      async assertReady() {},
      async put(input) {
        const bytes = await readFile(input.file);
        assert.equal(sha(bytes), input.sha256);
        const key = `workspace-engine/${workspace}/${execution}/${basename(input.file)}`;
        files.set(key, bytes);
        return {
          storage_key: key,
          sha256: input.sha256,
          size_bytes: bytes.length,
          media_type: input.media_type,
        };
      },
      async get(input) {
        await writeFile(
          input.destination,
          files.get(input.stored.storage_key)!,
        );
      },
    },
    stores: {
      async verifySources(input) {
        assert.deepEqual(input.expected_group_ids, groupIds);
        assert.deepEqual(input.expected_cluster_digests, Object.fromEntries(clusters.map(cluster => [cluster.cluster_id, cluster.cluster_digest])));
        assert.deepEqual(input.source_checkpoints, packets.map(({ artifact_id, body }) => ({ artifact_id, body })));
        sourceChecks.push(input.source_checkpoints.length);
        const groups = input.source_checkpoints.flatMap(checkpoint => JSON.parse(checkpoint.body).interpretations.map(
          (result: Record<string, unknown>) => ({ group_id: result.cluster_id, cluster_digest: result.cluster_digest,
            name: result.name, definition: result.definition, status: result.status, source_artifact_id: checkpoint.artifact_id })));
        const batch = buildMassLabelingConsolidationRequestV1({
          workspace_id: workspace,
          source_engine_execution_id: execution,
          source_groups: groups,
        });
        return {
          source_groups: batch.source_groups,
          source_groups_digest: batch.source_groups_digest,
        };
      },
      async reserve(input) {
        reservations.push(input);
        assert.equal(input.request_digest, batch.request_digest);
        assert.equal(input.workspace_id, workspace);
        assert.equal(input.execution_id, execution);
        assert.equal(input.actor_user_id, id(6));
        assert.equal(input.execution_token, lease.execution_token);
        assert.deepEqual(input.configuration, batch.configuration);
        assert.equal(input.reserved_micro_usd, batch.reserved_micro_usd);
        assert.equal(input.mass_labeling_stage?.stage, "global-consolidation-v1");
        assert.equal(input.mass_labeling_stage?.source_groups_digest, batch.source_groups_digest);
        if (!input.retry_of_call_id) return call;
        assert.equal(input.retry_of_call_id, call.call_id);
        assert.equal(input.idempotency_key, `mass-map:${batch.request_digest.slice(7)}:retry:${call.call_id}`);
        if (!calls.has(id(40))) {
          createdSuccessors++;
          calls.set(id(40), { ...call, call_id: id(40), attempt_token: id(41), retry_of_call_id: call.call_id,
            state: "reserved", settled_micro_usd: null, response: null });
        }
        return getCall(id(40));
      },
      async sent(input) {
        const active = getCall(input.call_id);
        const allowed = active.state === "reserved";
        if (allowed) active.state = "in_flight";
        return { call: active, send_authorized: allowed };
      },
      async response(input) {
        const active = getCall(input.call_id);
        active.state = "response_persisted";
        active.response = { ...input.response, complete: input.response.complete ?? true };
        return active;
      },
      async settle(input) {
        const active = getCall(input.call_id);
        if (active.state !== "settled") charges++;
        active.state = "settled";
        active.settled_micro_usd = 1;
        return active;
      },
      async fail(input) {
        const active = getCall(input.call_id);
        active.state = input.outcome;
        return active;
      },
      async persist(input) {
        persisted++;
        assert.equal(
          input.artifact.metadata.response_sha256,
          getCall(String(input.artifact.metadata.call_id)).response?.sha256,
        );
        return { artifact_id: id(8), replayed: persisted > 1 };
      },
    },
    send: async (input) => {
      assert.equal(
        input.batch.request_body.includes("PRIVATE SYNTHETIC MENTION"),
        false,
      );
      if (!(await input.authorize_send()))
        throw new WorkspaceInterpretationTransportErrorV1("workspace_engine_mass_consolidation_send_not_authorized", "outcome_unknown");
      sends++;
      const raw = JSON.stringify({
        model: configuration.model,
        type: "message",
        role: "assistant",
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 80 },
        content: [
          {
            type: "text",
            text: JSON.stringify({
              topics: valid
                ? [
                    {
                      topic_key: "consumo",
                      name: "Consumo",
                      definition: "Motivos de consumo.",
                      group_ids: groupIds,
                    },
                  ]
                : [],
              excluded_groups: [],
            }),
          },
        ],
      });
      const receipt = {
        bytes: Buffer.from(raw),
        sha256: sha(raw),
        http_status: 200,
        provider_request_id: null,
        complete: true,
      };
      await input.persist_receipt(receipt);
      return receipt;
    },
  };
  return {
    args,
    call, batch, reservations, sourceChecks,
    successor: () => calls.get(id(40)), createdSuccessors: () => createdSuccessors,
    originalPacket: async () => JSON.stringify(await Promise.all(packets.map(packet => readFile(packet.file, "utf8")))),
    sends: () => sends,
    charges: () => charges,
    persisted: () => persisted,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("global consolidation replays its stored raw with one paid send and exact source summaries", async () => {
  const f = await fixture();
  try {
    const result = await consolidateMassLabelingGroupsV1(f.args);
    assert.equal(result.output.topics[0]?.name, "Consumo");
    await consolidateMassLabelingGroupsV1(f.args);
    assert.equal(f.sends(), 1);
    assert.equal(f.charges(), 1);
    assert.equal(f.persisted(), 2);
  } finally {
    await f.cleanup();
  }
});

test("an invalid global map retains and settles known usage and never resends on replay", async () => {
  const f = await fixture(false);
  try {
    await assert.rejects(
      consolidateMassLabelingGroupsV1(f.args),
      /contract_invalid/u,
    );
    assert.ok(f.call.response);
    await assert.rejects(
      consolidateMassLabelingGroupsV1(f.args),
      /contract_invalid/u,
    );
    assert.equal(f.sends(), 1);
    assert.equal(f.charges(), 1);
    assert.equal(f.persisted(), 0);
  } finally {
    await f.cleanup();
  }
});

test("unverified source lineage stops before reserving or sending global work", async () => {
  const f = await fixture();
  let reserves = 0;
  try {
    f.args.stores = {
      ...f.args.stores!,
      verifySources: async () => {
        throw new Error("source_lineage_invalid");
      },
      reserve: async () => {
        reserves++;
        return f.call;
      },
    };
    await assert.rejects(
      consolidateMassLabelingGroupsV1(f.args),
      /source_lineage_invalid/u,
    );
    assert.equal(reserves, 0);
    assert.equal(f.sends(), 0);
  } finally {
    await f.cleanup();
  }
});

test("failed send CAS preserves unknown exposure without fetching", async () => {
  const f = await fixture();
  let fetches = 0;
  try {
    f.args.stores = {
      ...f.args.stores!,
      sent: async () => {
        f.call.state = "in_flight";
        return { call: f.call, send_authorized: false };
      },
    };
    f.args.send = async (args) =>
      sendMassLabelingConsolidationV1({
        ...args,
        fetch_impl: async () => {
          fetches++;
          return new Response("{}");
        },
      });
    await assert.rejects(
      consolidateMassLabelingGroupsV1(f.args),
      /send_not_authorized/u,
    );
    assert.equal(fetches, 0);
    assert.equal(f.call.state, "in_flight");
    assert.equal(f.call.reserved_micro_usd, f.batch.reserved_micro_usd);
    assert.equal(f.charges(), 0);
  } finally {
    await f.cleanup();
  }
});

test("offline global recovery validates its existing receipt without a reservation or provider send", async () => {
  const f = await fixture();
  try {
    await consolidateMassLabelingGroupsV1(f.args);
    f.args.recovery_only = true;
    f.args.recovery_call = structuredClone(f.call);
    f.args.provider_enabled = false;
    f.args.stores = {
      ...f.args.stores!,
      reserve: async () => {
        throw new Error("offline_recovery_must_not_reserve");
      },
    };
    f.args.send = async () => {
      throw new Error("offline_recovery_must_not_send");
    };
    const recovered = await consolidateMassLabelingGroupsV1(f.args);
    assert.equal(recovered.output.topics[0]?.topic_key, "consumo");
    assert.equal(f.sends(), 1);
    assert.equal(f.charges(), 1);
    f.args.recovery_call.request_digest = sha("substituted request");
    await assert.rejects(consolidateMassLabelingGroupsV1(f.args), /mass_consolidation_invalid/u);
  } finally {
    await f.cleanup();
  }
});


test("a global response that includes an insufficient group keeps its settled raw and fails replay", async () => {
  const f = await fixture(true, "insufficient");
  try {
    await assert.rejects(consolidateMassLabelingGroupsV1(f.args), /mass_consolidation_contract_invalid/u);
    assert.equal(f.call.state, "settled");
    assert.ok(f.call.response?.complete);
    const receipt = structuredClone(f.call.response);
    await assert.rejects(consolidateMassLabelingGroupsV1(f.args), /mass_consolidation_contract_invalid/u);
    assert.deepEqual(f.call.response, receipt);
    assert.equal(f.sends(), 1);
    assert.equal(f.charges(), 1);
    assert.equal(f.persisted(), 0);
  } finally {
    await f.cleanup();
  }
});


test("one reconciled global successor preserves 144 checkpoints and replays without financing another call", async () => {
  const f = await fixture(true, "coherent", 144);
  f.call.state = "terminal_confirmed";
  f.call.settled_micro_usd = 1250;
  const parent = JSON.stringify(f.call), checkpoint = await f.originalPacket();
  try {
    for (let replay = 0; replay < 3; replay++) {
      const result = await consolidateMassLabelingGroupsV1(f.args);
      assert.equal(result.output.topics[0]!.group_ids.length, 144);
    }
    assert.equal(f.createdSuccessors(), 1);
    assert.equal(f.sends(), 1);
    assert.equal(f.charges(), 1);
    assert.equal(f.successor()!.retry_of_call_id, f.call.call_id);
    assert.equal(f.successor()!.request_digest, f.call.request_digest);
    assert.equal(f.successor()!.state, "settled");
    assert.equal(JSON.stringify(f.call), parent);
    assert.equal(f.call.response, null);
    assert.equal(await f.originalPacket(), checkpoint);
    assert.deepEqual(f.sourceChecks, [144, 144, 144]);
    const retryKeys = f.reservations.filter(input => input.retry_of_call_id).map(input => input.idempotency_key);
    assert.equal(new Set(retryKeys).size, 1);
    f.args.recovery_only = true;
    f.args.recovery_call = structuredClone(f.successor()!);
    f.args.stores = { ...f.args.stores!, reserve: async () => { throw Error("offline_must_not_reserve"); } };
    f.args.send = async () => { throw Error("offline_must_not_send"); };
    await consolidateMassLabelingGroupsV1(f.args);
    assert.equal(f.sends(), 1);
    assert.equal(f.charges(), 1);
    assert.equal(JSON.stringify(f.call), parent);
  } finally { await f.cleanup(); }
});

test("uncertain, unreconciled and offline global attempts cannot finance or send a successor", async () => {
  for (const state of ["outcome_unknown", "in_flight", "response_persisted", "definitely_not_sent", "terminal_confirmed"] as const) {
    const f = await fixture();
    f.call.state = state;
    const parent = JSON.stringify(f.call);
    try {
      await assert.rejects(consolidateMassLabelingGroupsV1(f.args), /receipt_recovery_required|retry_unavailable/u);
      assert.equal(f.createdSuccessors(), 0);
      assert.equal(f.sends(), 0);
      assert.equal(JSON.stringify(f.call), parent);
      const reservations = f.reservations.length;
      f.args.recovery_only = true;
      await assert.rejects(consolidateMassLabelingGroupsV1(f.args), /receipt_recovery_required/u);
      assert.equal(f.reservations.length, reservations);
    } finally { await f.cleanup(); }
  }
});

test("a failed global successor remains uncertain and cannot create a second successor", async () => {
  const f = await fixture(true, "coherent", 144);
  f.call.state = "terminal_confirmed";
  f.call.settled_micro_usd = 1250;
  const parent = JSON.stringify(f.call);
  let sends = 0;
  f.args.send = async input => {
    assert.equal(await input.authorize_send(), true);
    sends++;
    throw new WorkspaceInterpretationTransportErrorV1("workspace_engine_mass_consolidation_transport_failed", "outcome_unknown");
  };
  try {
    await assert.rejects(consolidateMassLabelingGroupsV1(f.args), /transport_failed/u);
    assert.equal(f.successor()!.state, "outcome_unknown");
    await assert.rejects(consolidateMassLabelingGroupsV1(f.args), /receipt_recovery_required/u);
    for (const state of ["terminal_confirmed", "definitely_not_sent"] as const) {
      f.successor()!.state = state;
      f.successor()!.settled_micro_usd = 400;
      await assert.rejects(consolidateMassLabelingGroupsV1(f.args), /transport_retry_exhausted/u);
    }
    assert.equal(sends, 1);
    assert.equal(f.createdSuccessors(), 1);
    assert.equal(f.charges(), 0);
    assert.equal(f.persisted(), 0);
    assert.equal(JSON.stringify(f.call), parent);
  } finally { await f.cleanup(); }
});

test("concurrent global successor invocations share one reservation and one send CAS", async () => {
  const f = await fixture(true, "coherent", 144);
  f.call.state = "terminal_confirmed";
  f.call.settled_micro_usd = 1250;
  const parent = JSON.stringify(f.call);
  try {
    const results = await Promise.allSettled([consolidateMassLabelingGroupsV1(f.args), consolidateMassLabelingGroupsV1(f.args)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal(f.createdSuccessors(), 1);
    assert.equal(f.sends(), 1);
    assert.equal(f.charges(), 1);
    assert.equal(f.successor()!.state, "settled");
    assert.equal(JSON.stringify(f.call), parent);
    assert.deepEqual(f.sourceChecks, [144, 144]);
  } finally { await f.cleanup(); }
});

test("a changed last checkpoint blocks global successor financing before reservation", async () => {
  const f = await fixture(true, "coherent", 144);
  f.call.state = "terminal_confirmed";
  f.call.settled_micro_usd = 1250;
  const parent = JSON.stringify(f.call);
  const last = f.args.proposals.at(-1)!;
  await writeFile(last.file, (await readFile(last.file, "utf8")) + " ");
  try {
    await assert.rejects(consolidateMassLabelingGroupsV1(f.args), error => error instanceof assert.AssertionError);
    assert.equal(f.reservations.length, 0);
    assert.equal(f.createdSuccessors(), 0);
    assert.equal(f.sends(), 0);
    assert.equal(JSON.stringify(f.call), parent);
  } finally { await f.cleanup(); }
});
