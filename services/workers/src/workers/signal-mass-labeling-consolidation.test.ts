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
async function fixture(valid = true, sourceStatus: "coherent" | "insufficient" = "coherent") {
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
  const group = "guided:synthetic",
    packet = join(directory, "group.json");
  await writeFile(
    packet,
    JSON.stringify({
      contract_version: "workspace-engine-interpretation-result-v1",
      execution_id: execution,
      context: { workspace_id: workspace, context_digest: contextDigest },
      clusters: [
        {
          cluster_id: group,
          cluster_digest: sha("cluster"),
          representatives: [
            { text: "PRIVATE SYNTHETIC MENTION MUST STAY OUT OF GLOBAL INPUT" },
          ],
        },
      ],
      interpretations: [
        {
          cluster_id: group,
          cluster_digest: sha("cluster"),
          status: sourceStatus,
          name: sourceStatus === "insufficient" ? null : "Consumo",
          definition: sourceStatus === "insufficient" ? null : "Motivos de consumo.",
        },
      ],
    }),
  );
  const call: SignalWorkspaceEngineInterpretationCallV1 = {
    admission: null,
    call_id: id(4),
    execution_id: execution,
    workspace_id: workspace,
    attempt_token: id(5),
    retry_of_call_id: null,
    state: "reserved",
    reserved_micro_usd: 1,
    settled_micro_usd: null,
    request_digest: sha("request"),
    interpretation_revision_digest: null,
    editorial_repair: null,
    response: null,
  };
  let sends = 0,
    charges = 0,
    persisted = 0;
  const files = new Map<string, Buffer>();
  const args: Parameters<typeof consolidateMassLabelingGroupsV1>[0] = {
    database: {} as never,
    lease,
    actor_user_id: id(6),
    proposals: [{ artifact_id: id(7), file: packet }],
    directory,
    expected_group_ids: [group],
    expected_cluster_digests: { [group]: sha("cluster") },
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
        assert.deepEqual(input.expected_group_ids, [group]);
        assert.deepEqual(input.expected_cluster_digests, {
          [group]: sha("cluster"),
        });
        const body = JSON.parse(input.source_checkpoints[0]!.body);
        const groups = body.interpretations.map(
          (result: Record<string, unknown>) => ({
            group_id: result.cluster_id,
            cluster_digest: result.cluster_digest,
            name: result.name,
            definition: result.definition,
            status: result.status,
            source_artifact_id: input.source_checkpoints[0]!.artifact_id,
          }),
        );
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
        call.request_digest = input.request_digest;
        assert.equal(
          input.mass_labeling_stage?.stage,
          "global-consolidation-v1",
        );
        return call;
      },
      async sent() {
        call.state = "in_flight";
        return { call, send_authorized: true };
      },
      async response(input) {
        call.state = "response_persisted";
        call.response = {
          ...input.response,
          complete: input.response.complete ?? true,
        };
        return call;
      },
      async settle() {
        if (call.state !== "settled") charges++;
        call.state = "settled";
        call.settled_micro_usd = 1;
        return call;
      },
      async fail(input) {
        call.state = input.outcome;
        return call;
      },
      async persist(input) {
        persisted++;
        assert.equal(
          input.artifact.metadata.response_sha256,
          call.response?.sha256,
        );
        return { artifact_id: id(8), replayed: persisted > 1 };
      },
    },
    send: async (input) => {
      sends++;
      assert.equal(
        input.batch.request_body.includes("PRIVATE SYNTHETIC MENTION"),
        false,
      );
      assert.equal(await input.authorize_send(), true);
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
                      group_ids: [group],
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
    call,
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
    assert.equal(f.call.reserved_micro_usd, 1);
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
