import assert from "node:assert/strict";
import test from "node:test";
import {
  massLabelingJevIdentityV1,
  entityContextDigestV1,
  labelerDigestV1,
  type MassLabelingInputV1,
  type MassLabelingResultV1,
} from "@noisia/query-engine";
import type { LabelingRunV1, LabelingCallV1 } from "@noisia/db";
import { processMassLabelingJevV1 } from "./signal-mass-labeling-jev";
import type { JevProviderV1, JevRequestV1 } from "../providers/typesafe-jev";

type Store = Parameters<typeof processMassLabelingJevV1>[0]["store"];
function fixture(count: number) {
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
  const identity = massLabelingJevIdentityV1();
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
