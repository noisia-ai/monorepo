import assert from "node:assert/strict";
import test from "node:test";
import { buildMassLabelingConsolidationRequestV1 } from "@noisia/query-engine";
import {
  assertMassLabelingEditorialAccessV1,
  sendMassLabelingConsolidationV1,
} from "./mass-labeling-consolidation";

const batch = buildMassLabelingConsolidationRequestV1({
  workspace_id: "00000000-0000-4000-8000-000000000001",
  source_engine_execution_id: "00000000-0000-4000-8000-000000000002",
  source_groups: [
    {
      group_id: "guided:synthetic",
      cluster_digest: `sha256:${"a".repeat(64)}`,
      name: "Conversa",
      definition: "Resumo sintético",
      status: "coherent",
      source_artifact_id: "00000000-0000-4000-8000-000000000003",
    },
  ],
});

test("invalid Anthropic credentials stop the read-only preflight before admission", async () => {
  let requests = 0;
  await assert.rejects(
    assertMassLabelingEditorialAccessV1({
      api_key: "synthetic-key",
      enabled: true,
      fetch_impl: async (url, init) => {
        requests++;
        assert.equal(url, "https://api.anthropic.com/v1/models");
        assert.equal(init?.method, "GET");
        return new Response("{}", { status: 401 });
      },
    }),
    /not_sent/u,
  );
  assert.equal(requests, 1);
});

test("a denied lease sends nothing and a completed global response is persisted before parsing", async () => {
  let requests = 0,
    persisted = false;
  const fetch_impl: typeof fetch = async () => {
    requests++;
    return new Response('{"synthetic":"unvalidated body"}', { status: 200 });
  };
  await assert.rejects(
    sendMassLabelingConsolidationV1({
      batch,
      api_key: "synthetic-key",
      enabled: true,
      authorize_send: async () => false,
      persist_receipt: async () => {
        persisted = true;
      },
      fetch_impl,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "outcome" in error &&
      error.outcome === "outcome_unknown",
  );
  assert.equal(requests, 0);
  assert.equal(persisted, false);
  const receipt = await sendMassLabelingConsolidationV1({
    batch,
    api_key: "synthetic-key",
    enabled: true,
    authorize_send: async () => true,
    persist_receipt: async (value) => {
      assert.ok(value.bytes.length > 0);
      persisted = true;
    },
    fetch_impl,
  });
  assert.equal(requests, 1);
  assert.equal(persisted, true);
  assert.equal(receipt.complete, true);
});
