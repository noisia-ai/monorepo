import { Agent } from "undici";
import { createServer } from "node:http";
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


test("global transport uses one dedicated dispatcher with ten-minute header/body limits until persistence", async () => {
  let agent: Agent | undefined, factories = 0, fetches = 0, persisted = false;
  const receipt = await sendMassLabelingConsolidationV1({ batch, api_key: "synthetic-key", enabled: true,
    authorize_send: async () => true,
    create_dispatcher: options => {
      factories++;
      assert.equal(options.headersTimeout, 600_000);
      assert.equal(options.bodyTimeout, 600_000);
      assert.equal(options.connectTimeout, 10_000);
      assert.equal(options.connections, 1);
      assert.equal(options.pipelining, 0);
      assert.equal(options.maxRedirections, 0);
      agent = new Agent(options);
      return agent;
    },
    fetch_impl: async (url, init) => {
      fetches++;
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(init?.body, batch.request_body);
      assert.equal(init?.redirect, "error");
      assert.equal((init as RequestInit & { dispatcher: Agent }).dispatcher, agent);
      assert.equal(agent!.destroyed, false);
      return new Response('{"synthetic":"complete"}', { status: 200 });
    },
    persist_receipt: async value => {
      assert.equal(agent!.destroyed, false);
      assert.equal(value.complete, true);
      persisted = true;
    },
  });
  assert.equal(receipt.complete, true);
  assert.equal(persisted, true);
  assert.equal(factories, 1);
  assert.equal(fetches, 1);
  assert.equal(agent!.destroyed, true);
});

test("global transport preserves partial bytes and closes its dedicated dispatcher after persisting", async () => {
  let agent: Agent | undefined;
  const receipt = await sendMassLabelingConsolidationV1({ batch, api_key: "synthetic-key", enabled: true,
    authorize_send: async () => true,
    create_dispatcher: options => { agent = new Agent(options); return agent; },
    fetch_impl: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from('{"partial":')); },
      pull(controller) { controller.error(new Error("synthetic_interrupted_body")); },
    })),
    persist_receipt: async value => {
      assert.equal(agent!.destroyed, false);
      assert.equal(value.complete, false);
      assert.equal(Buffer.from(value.bytes).toString(), '{"partial":');
    },
  });
  assert.equal(receipt.complete, false);
  assert.equal(agent!.destroyed, true);
});

test("global transport deadline, disconnect and redirects never cause a second local request", async () => {
  for (const scenario of ["deadline", "redirect", "disconnect"] as const) {
    let requests = 0, receipts = 0, agent: Agent | undefined;
    const server = createServer((_request, response) => {
      requests++;
      if (scenario === "redirect") { response.writeHead(302, { Location: "/alternate" }); response.end(); }
      if (scenario === "disconnect") response.destroy();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      await assert.rejects(sendMassLabelingConsolidationV1({ batch, api_key: "synthetic-key", enabled: true,
        authorize_send: async () => true, timeout_ms: scenario === "deadline" ? 750 : 3000,
        create_dispatcher: options => { agent = new Agent(options); return agent; },
        fetch_impl: async (_url, init) => fetch(`http://127.0.0.1:${address.port}/initial`, init),
        persist_receipt: async () => { receipts++; },
      }), error => error instanceof Error && "outcome" in error && error.outcome === "outcome_unknown");
      assert.equal(requests, 1);
      assert.equal(receipts, 0);
      assert.equal(agent!.destroyed, true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});

test("invalid global deadlines stop before send authorization or dispatcher creation", async () => {
  let authorizations = 0, dispatchers = 0, requests = 0;
  for (const timeout_ms of [0, -1, 600_001, Number.NaN]) {
    await assert.rejects(sendMassLabelingConsolidationV1({ batch, api_key: "synthetic-key", enabled: true, timeout_ms,
      authorize_send: async () => { authorizations++; return true; },
      create_dispatcher: options => { dispatchers++; return new Agent(options); },
      fetch_impl: async () => { requests++; return new Response("{}"); },
      persist_receipt: async () => { throw new Error("unexpected_receipt"); },
    }), error => error instanceof Error && "outcome" in error && error.outcome === "definitely_not_sent");
  }
  assert.equal(authorizations, 0);
  assert.equal(dispatchers, 0);
  assert.equal(requests, 0);
});
