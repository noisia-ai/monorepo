import assert from "node:assert/strict";
import test from "node:test";
import {
  massLabelingJevIdentityV1,
  massLabelingJevIdentityV2,
  entityContextDigestV1,
  labelerDigestV1,
  type MassLabelingInputV1,
  type MassLabelingResultV1,
} from "@noisia/query-engine";
import type { LabelingRunV1, LabelingCallV1 } from "@noisia/db";
import { processMassLabelingJevV1, signalMassLabelingJevJobV1 } from "./signal-mass-labeling-jev";
import type { JevProviderV1, JevRequestV1 } from "../providers/typesafe-jev";

type Store = Parameters<typeof processMassLabelingJevV1>[0]["store"];
function fixture(count: number, product = false) {
  const context = {
    entities: [
      {
        entity_id: "category",
        kind: "category" as const,
        name: "cerveja",
        aliases: [],
        disambiguation: null,
      },
    ],
  };
  const identity = product ? massLabelingJevIdentityV2({ category: "tea", candidate_language: "original",
    interests: [{ key: "travel", name: "Travel", definition: "Travel and tourism" }] }) : massLabelingJevIdentityV1();
  const run: LabelingRunV1 = {
    id: "run",
    workspace_id: "workspace",
    actor_user_id: "actor",
    kind: "mass_labeling",
    identity,
    labeler_digest: labelerDigestV1(identity),
    entity_context_digest: entityContextDigestV1(context),
    entity_context_version_no: 1,
    context,
    lease_token: "lease",
    cursor_root_id: null,
    cap_micro_usd: "1000000",
    processing_admission_id: "admission",
    status: "running",
    error_code: null,
  };
  const calls: LabelingCallV1<MassLabelingInputV1>[] = [],
    results: MassLabelingResultV1[] = [],
    events: string[] = [];
  let selected = false;
  const store: Store = {
    async claim() {
      return run.status === "completed" ? null : run;
    },
    async release() {},
    async renew() {},
    async fail() {
      run.status = "failed";
    },
    async refresh() {
      return { status: run.status, error_code: run.error_code ?? null };
    },
    async calls() {
      return calls.filter((call) => !call.results_applied);
    },
    async inputs() {
      if (selected) return [];
      selected = true;
      return Array.from({ length: count }, (_, index) => ({
        root_id: `root-${index}`,
        input_digest: `input-${index}`,
        text: `Conversa sobre cerveja ${index}`,
        title: null,
        platform: null,
        content_type: null,
        author: null,
        published_at: "2026-01-01T00:00:00Z",
        language: "pt",
        map_id: "map",
        map_digest: "digest",
        chunk_index: 1,
        candidates: [
          {
            topic_key: "consumo",
            name: "Consumo",
            definition: "Motivos de consumo",
            similarity: 0.9,
          },
        ],
      }));
    },
    async reserve(_run, proposals) {
      const page = proposals.map((proposal, index) => ({
        ...proposal,
        id: `call-${index}`,
        status: "reserved" as const,
        raw_body: null,
        results_applied: false,
        provider_batch_id: null,
        retry_depth: 0,
      }));
      calls.push(...page);
      return page;
    },
    async markSubmitting(_run, page) {
      page.forEach((call) => {
        call.status = "submitting";
      });
    },
    async markSubmitted() {},
    async recoverUnknownBatch() {},
    async releaseUnknown() {},
    async clearUnknownFailure() {},
    async markFailed(_run, page, unknown) {
      page.forEach((call) => {
        call.status = unknown ? "unknown" : "failed";
      });
    },
    async persistRaw(_run, call, raw) {
      events.push(`raw:${call.id}`);
      call.raw_body = raw;
    },
    async persistRawPage() {
      throw new Error("mass raw must persist per response");
    },
    async settle(_run, call) {
      call.status = "settled";
    },
    async settlePage(_run, page) {
      events.push("settle");
      page.forEach((row) => {
        assert.ok(row.call.raw_body);
        row.call.status = "settled";
      });
    },
    async apply(_run, page) {
      events.push("apply");
      page.forEach((row) => {
        results.push(...row.results);
        row.call.results_applied = true;
      });
    },
    async finish() {
      const status = calls.some((call) => call.status === "unknown")
        ? ("failed" as const)
        : ("completed" as const);
      run.status = status;
      return status;
    },
  };
  let transports = 0;
  const response = (request: JevRequestV1) => ({
    body: JSON.stringify({
      model: request.model,
      usage: { input_tokens: 100, output_tokens: 0 },
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([key, question]) => [
          key,
          question.type === "noul"
            ? { type: "noul", noul: 0.8 }
            : {
                type: "choice",
                choice: Object.keys(question.criteria)[0]!,
                confidence: 0.8,
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map((choice, index, all) => [
                    choice,
                    index === 0 ? 0.8 : 0.2 / (all.length - 1),
                  ]),
                ),
              },
        ]),
      ),
    }),
    http_status: 200,
    latency_ms: 1,
  });
  const provider: JevProviderV1 = {
    async evaluate(request) {
      transports++;
      return response(request);
    },
  };
  return {
    run,
    calls,
    results,
    events,
    store,
    provider,
    response,
    transports: () => transports,
  };
}

test("mass classifier preserves probabilities and replays stored responses without a new send", async () => {
  const f = fixture(2);
  assert.equal(
    (
      await processMassLabelingJevV1({
        run_id: f.run.id,
        store: f.store,
        provider: f.provider,
      })
    ).status,
    "completed",
  );
  assert.equal(f.transports(), 2);
  assert.equal(f.results.length, 2);
  assert.deepEqual(f.results[0]?.probabilities?.topic_0, {
    type: "noul",
    noul: 0.8,
  });
  assert.ok(f.events.indexOf("apply") > f.events.indexOf("settle"));
  f.calls.forEach((call) => {
    call.results_applied = false;
  });
  f.run.status = "running";
  await processMassLabelingJevV1({
    run_id: f.run.id,
    store: f.store,
    provider: f.provider,
  });
  assert.equal(f.transports(), 2);
  assert.equal(f.results.length, 4);
});

test(
  "a completed response is durable while another request is still outstanding",
  { timeout: 10000 },
  async () => {
    const f = fixture(2);
    let releaseSecond!: () => void, firstStored!: () => void;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const stored = new Promise<void>((resolve) => {
      firstStored = resolve;
    });
    const persist = f.store.persistRaw;
    f.store.persistRaw = async (run, call, raw) => {
      await persist(run, call, raw);
      if (call.id === "call-0") firstStored();
    };
    let index = 0;
    const provider: JevProviderV1 = {
      async evaluate(request) {
        if (index++ === 1) await second;
        return f.response(request);
      },
    };
    const running = processMassLabelingJevV1({
      run_id: f.run.id,
      store: f.store,
      provider,
    });
    await stored;
    assert.ok(f.calls[0]?.raw_body);
    assert.equal(f.calls[1]?.raw_body, null);
    assert.equal(f.results.length, 0);
    releaseSecond();
    await running;
    assert.equal(f.results.length, 2);
  },
);

test("raw-only recovery never selects or reserves a new mention", async () => {
  const f = fixture(1);
  let inputs = 0,
    reservations = 0;
  f.store.inputs = async () => {
    inputs++;
    throw new Error("must_not_select");
  };
  f.store.reserve = async () => {
    reservations++;
    throw new Error("must_not_reserve");
  };
  const result = await processMassLabelingJevV1({
    run_id: f.run.id,
    store: f.store,
    provider: {
      evaluate: async () => {
        throw new Error("must_not_send");
      },
    },
    recovery_only: true,
  });
  assert.equal(result.status, "recovery_unavailable");
  assert.equal(inputs, 0);
  assert.equal(reservations, 0);
  assert.equal(f.transports(), 0);
});

test("product worker sends one durable request per root including interests and replays without spending", async () => {
  const f = fixture(2, true);
  await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider: f.provider });
  assert.equal(f.calls.length, 2);
  assert.equal(f.transports(), 2);
  for (const call of f.calls) {
    assert.equal(call.inputs.length, 1);
    assert.deepEqual(Object.keys((call.request as JevRequestV1).questions), ["promotion", "voice", "trigger_barrier", "topic_0", "interest_travel"]);
    assert.match(JSON.stringify((call.request as JevRequestV1).questions.trigger_barrier), /consume or buy tea/u);
  }
  assert.deepEqual(f.results[0]?.probabilities?.interest_travel, { type: "noul", noul: .8 });
  f.calls.forEach(call => { call.results_applied = false; }); f.run.status = "running";
  await processMassLabelingJevV1({ run_id: f.run.id, store: f.store, provider: f.provider });
  assert.equal(f.transports(), 2);
});

for (const denial of ["none", "kill_switch", "provider", "workspace"] as const) test(`the actual mass-labeling job preserves all gates with injected runtime dependencies (${denial})`, async () => {
  const f = fixture(1, true);
  const priorMass = process.env.NOISIA_MASS_LABELING_ENABLED, priorJev = process.env.NOISIA_JEV_PROVIDER_ENABLED;
  process.env.NOISIA_MASS_LABELING_ENABLED = denial === "kill_switch" ? "false" : "true";
  process.env.NOISIA_JEV_PROVIDER_ENABLED = "true";
  let preflights = 0;
  const query = async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("SELECT workspace_id FROM signal_labeling_runs")) { assert.deepEqual(params, [f.run.id]); return { rows: [{ workspace_id: f.run.workspace_id }] }; }
    if (sql.includes("FROM signal_workspace_features")) { assert.deepEqual(params, [f.run.workspace_id, "mass_labeling"]); return { rows: [{ enabled: denial !== "workspace" }] }; }
    if (sql.startsWith("SELECT run.workspace_id,run.actor_user_id")) return { rows: [] };
    throw new Error("unexpected_job_database_query");
  };
  const database = { query, async connect() { return { query, release() {} }; } } as unknown as NonNullable<Parameters<typeof signalMassLabelingJevJobV1>[1]>["database"];
  const fetchImpl: typeof fetch = async (input, init) => {
    preflights++;
    assert.equal(input, "https://api.typesafe.ai/v1/models"); assert.equal(init?.method, "GET");
    assert.deepEqual(init?.headers, { Authorization: "Bearer synthetic-not-a-secret" });
    return new Response("{}", { status: denial === "provider" ? 401 : 200 });
  };
  const invoke = () => signalMassLabelingJevJobV1({ data: { run_id: f.run.id } }, {
    database, store: f.store, provider: f.provider, provider_preflight: { api_key: "synthetic-not-a-secret", fetch_impl: fetchImpl },
  });
  try {
    if (denial === "none") { assert.equal((await invoke()).status, "completed"); assert.equal(f.transports(), 1); }
    else { await assert.rejects(invoke(), new RegExp(denial === "kill_switch" ? "provider_disabled" : denial === "provider" ? "provider_unavailable" : "not_enabled")); assert.equal(f.transports(), 0); }
    assert.equal(preflights, denial === "kill_switch" ? 0 : 1);
  } finally {
    if (priorMass === undefined) delete process.env.NOISIA_MASS_LABELING_ENABLED; else process.env.NOISIA_MASS_LABELING_ENABLED = priorMass;
    if (priorJev === undefined) delete process.env.NOISIA_JEV_PROVIDER_ENABLED; else process.env.NOISIA_JEV_PROVIDER_ENABLED = priorJev;
  }
});
