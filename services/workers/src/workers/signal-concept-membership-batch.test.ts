import test from "node:test";
import assert from "node:assert/strict";
import {
  runConceptMembershipTickV1,
  membershipCallProposalV1,
} from "./signal-concept-membership-batch";
import type {
  LabelingCallV1,
  MembershipRunV1,
  ConceptMembershipStoreV1,
} from "@noisia/db";
import {
  entityContextDigestV1,
  membershipLabelerIdentityV1,
  type MembershipResultV1,
  type MembershipInputV1,
} from "@noisia/query-engine";
import { AnthropicBatchTransportError, type AnthropicBatchRequest } from "../providers/anthropic-message-batches";
import { readMfpInFlightPages } from "./signal-labeling-parallelism";
const dim = <T>(value: T) => ({ value, confidence: "high", abstained: false });
function harness() {
  const context = {
    entities: [
      {
        entity_id: "a",
        kind: "primary_brand" as const,
        name: "Example brand",
        aliases: [],
        disambiguation: null,
      },
    ],
  };
  const run = {
    id: "run",
    workspace_id: "workspace",
    actor_user_id: "actor",
    kind: "membership",
    membership_snapshot: {
      preview: false,
      concepts: [
        {
          concept_key: "experience",
          label: "Experience",
          definition: "A documented experience",
          scope: "primary_brand",
          inclusion: [],
          exclusion: [],
          positive_examples: [],
          negative_examples: [],
          definition_digest: "sha256:" + "a".repeat(64),
        },
      ],
      sample_root_ids: null,
    },
    context,
    entity_context_digest: entityContextDigestV1(context),
    identity: membershipLabelerIdentityV1(),
    labeler_digest: "labeler",
    lease_token: "lease",
    cursor_root_id: null,
    cap_micro_usd: null,
    processing_admission_id: "admission",
    selection_complete: false,
    status: "running",
    entity_context_version_no: 1,
  } as MembershipRunV1;
  const inputs: MembershipInputV1[] = [0, 1].map((i) => ({
    root_fingerprint: `d${i}`,
    entity_context_digest: run.entity_context_digest,
    effective_entities_digest: "entities",
    entities: [{ entity_id: "a", kind: "primary_brand", salience: "main" }],
    voice: "individual",
    act: "experience",
    evaluated_concepts: run.membership_snapshot.concepts,
    root_id: String(i),
    input_digest: `d${i}`,
    text: "Example brand discussion",
    title: null,
    platform: null,
    content_type: null,
    author: null,
    published_at: "2026-01-01",
    language: "es",
  }));
  let calls: LabelingCallV1<MembershipInputV1>[] = [],
    submitted = 0;
  const labels: MembershipResultV1[] = [],
    events: string[] = [];
  const store = {
    async claim() {
      return run;
    },
    async release() {},
    async renew() {},
    async fail(_r, code) {
      run.error_code = code;
    },
    async inputs() {
      return run.cursor_root_id ? [] : inputs;
    },
    async reserve(_r, proposals, advance = true) {
      for (const p of proposals)
        if (!calls.some((c) => c.custom_id === p.custom_id))
          calls.push({
            ...p,
            id: p.custom_id,
            status: "reserved",
            raw_body: null,
            results_applied: false,
            provider_batch_id: null,
            retry_depth: p.retry_depth ?? 0,
          });
      if (advance) run.cursor_root_id = "1";
      return calls.filter((c) =>
        proposals.some((p) => p.custom_id === c.custom_id),
      );
    },
    async calls() {
      return calls;
    },
    async markSubmitting(_r, c) {
      c.forEach((x) => (x.status = "submitting"));
    },
    async markSubmitted(_r, c, b) {
      c.forEach((x) => {
        x.status = "submitted";
        x.provider_batch_id = b;
      });
    },
    async markFailed(_r, c, u) {
      c.forEach((x) => (x.status = u ? "unknown" : "failed"));
    },
    async persistRaw(_r, call, raw) {
      call.raw_body = raw;
      events.push("raw");
    },
    async settle(_r, call) {
      call.status = "settled";
      events.push("settle");
    },
    async persistRawPage(_r, p) {
      events.push("raw");
      p.forEach((x) => (x.call.raw_body = x.raw));
    },
    async settlePage(_r, p) {
      events.push("settle");
      p.forEach((x) => (x.call.status = "settled"));
    },
    async apply(_r, p) {
      events.push("apply");
      p.forEach((x) => {
        labels.push(...x.results);
        x.call.results_applied = true;
      });
    },
    async finish() {
      return labels.length === inputs.length
        ? "completed"
        : calls.some((c) => c.status === "unknown")
          ? "failed"
          : "running";
    },
  } as ConceptMembershipStoreV1;
  const state = {
    id: "msgbatch_test",
    processing_status: "ended" as const,
    request_counts: {
      processing: 0,
      succeeded: 1,
      errored: 0,
      canceled: 0,
      expired: 0,
    },
    ended_at: "now",
    results_url: null,
  };
  const provider = {
    async create(_requests?: readonly AnthropicBatchRequest[]) {
      submitted++;
      return state;
    },
    async get() {
      return state;
    },
    async cancel() {
      return state;
    },
    async *results() {
      for (const call of calls.filter((c) => c.status === "submitted")) {
        const message = {
          stop_reason: "end_turn",
          content: [
            { type: "thinking", thinking: "" },
            {
              type: "text",
              text: JSON.stringify({
                contract_version: "concept-membership-judge-v1",
                roots: call.inputs.map((_, root_ordinal) => ({
                  root_ordinal,
                  memberships: [
                    {
                      concept_key: "experience",
                      verdict: "belongs",
                      span_ids: [`r${root_ordinal}c0s0`],
                      rationale: "Documents the experience.",
                    },
                  ],
                })),
              }),
            },
          ],
          usage: { input_tokens: 200, output_tokens: 50 },
        };
        const item = {
          custom_id: call.custom_id,
          result: { type: "succeeded" as const, message },
        };
        yield { item, rawText: JSON.stringify(item) };
      }
    },
  };
  return {
    run,
    inputs,
    store,
    provider,
    events,
    labels,
    calls: () => calls,
    submitted: () => submitted,
  };
}
test("batch persists raw before settlement and labels; replay has zero new provider sends", async () => {
  const h = harness();
  assert.equal(
    (
      await runConceptMembershipTickV1({
        run_id: h.run.id,
        store: h.store,
        provider: h.provider,
      })
    ).status,
    "completed",
  );
  assert.deepEqual(h.events, ["raw", "settle", "apply"]);
  await runConceptMembershipTickV1({
    run_id: h.run.id,
    store: h.store,
    provider: h.provider,
  });
  assert.equal(h.submitted(), 1);
  assert.equal(h.labels.length, 2);
});
test("configurable in-flight pages submit multiple root pages in one provider batch", async () => {
  assert.equal(readMfpInFlightPages("4"), 4);
  assert.equal(readMfpInFlightPages("100"), 1);
  const previous = process.env.NOISIA_MFP_IN_FLIGHT_PAGES;
  process.env.NOISIA_MFP_IN_FLIGHT_PAGES = "2";
  try {
    const h = harness();
    const second = h.inputs.map((input, i) => ({...input, root_id:`next-${i}`, root_fingerprint:`next-${i}`}));
    let page = 0;
    h.store.inputs = async () => page === 0 ? h.inputs : page === 1 ? second : [];
    const reserve = h.store.reserve;
    h.store.reserve = async (run, proposals, advance) => {
      const calls = await reserve(run, proposals, advance);
      if (advance !== false) page++;
      return calls;
    };
    const create = h.provider.create;
    let requestCount = 0;
    h.provider.create = async (requests) => { requestCount = requests?.length ?? 0; return create(requests); };
    await runConceptMembershipTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
    assert.equal(page, 2);
    assert.equal(requestCount, 2);
    assert.equal(h.labels.length, 4);
  } finally {
    if (previous === undefined) delete process.env.NOISIA_MFP_IN_FLIGHT_PAGES;
    else process.env.NOISIA_MFP_IN_FLIGHT_PAGES = previous;
  }
});
test("one malformed membership is retried alone and its final error is not billed again", async () => {
  const h = harness();
  const originalResults = h.provider.results;
  h.provider.results = async function* () {
    for await (const result of originalResults()) {
      const call = h.calls().find((c) => c.custom_id === result.item.custom_id)!;
      const roots = call.inputs.map((_, root_ordinal) => ({
        root_ordinal,
        memberships: root_ordinal === 0 && call.inputs.length > 1 ? [] : [{
          concept_key:"experience",verdict:"insufficient",span_ids:[],rationale:"Missing evidence",
        }],
      }));
      result.item.result.message.content = [{type:"text",text:JSON.stringify({contract_version:"concept-membership-judge-v1",roots})}];
      yield {...result,rawText:JSON.stringify(result.item)};
    }
  };
  await runConceptMembershipTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(h.labels.length, 1);
  assert.equal(h.labels[0]?.verdict, "not_belongs");
  await runConceptMembershipTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(h.labels.length, 2);
  assert.equal(h.labels[1]?.error_code, "membership_item_schema_invalid");
  await runConceptMembershipTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(h.submitted(), 2);
});
test("ambiguous POST is never replayed blindly", async () => {
  const h = harness();
  h.provider.create = async () => {
    throw new AnthropicBatchTransportError("transport", "submission_unknown");
  };
  await assert.rejects(
    runConceptMembershipTickV1({
      run_id: h.run.id,
      store: h.store,
      provider: h.provider,
    }),
  );
  assert.equal(h.calls()[0]?.status, "unknown");
  assert.equal(
    (
      await runConceptMembershipTickV1({
        run_id: h.run.id,
        store: h.store,
        provider: h.provider,
      })
    ).status,
    "failed",
  );
  assert.equal(h.labels.length, 0);
});
test("custom identity is deterministic but split attempts are distinct", () => {
  const h = harness(),
    a = membershipCallProposalV1(h.run, h.inputs),
    b = membershipCallProposalV1(h.run, h.inputs);
  assert.equal(a.custom_id, b.custom_id);
  assert.match(a.custom_id, /^cm1_[a-f0-9]{60}$/u);
  assert.notEqual(
    a.custom_id,
    membershipCallProposalV1(h.run, h.inputs.slice(0, 1), 1, a.custom_id)
      .custom_id,
  );
});

test("authority loss during split reconciles durable raw without reserving new children", async () => {
  const h = harness();
  const originalResults = h.provider.results;
  h.provider.results = async function* () {
    for await (const result of originalResults()) {
      result.item.result.message.stop_reason = "max_tokens";
      yield { ...result, rawText: JSON.stringify(result.item) };
    }
  };
  const originalReserve = h.store.reserve;
  let childReservations = 0;
  h.store.reserve = async (run, proposals, advance) => {
    if (advance === false) {
      childReservations++;
      throw new Error("labeling_context_changed");
    }
    return originalReserve(run, proposals, advance);
  };
  await assert.rejects(
    runConceptMembershipTickV1({
      run_id: h.run.id,
      store: h.store,
      provider: h.provider,
    }),
    /labeling_context_changed/u,
  );
  await runConceptMembershipTickV1({
    run_id: h.run.id,
    store: h.store,
    provider: h.provider,
  });
  assert.equal(childReservations, 1);
  assert.equal(h.submitted(), 1);
  assert.equal(h.labels.length, 2);
  assert.ok(
    h.labels.every(
      (result) =>
        result.verdict === "error" &&
        result.error_code === "retry_requires_authority",
    ),
  );
  assert.ok(h.calls().every((call) => call.results_applied));
});
test("one unknown call does not block reconciliation of a separate durable response", async () => {
  const h = harness();
  await h.store.reserve(
    h.run,
    h.inputs.map((input) => membershipCallProposalV1(h.run, [input])),
  );
  const [uncertain, known] = h.calls();
  uncertain!.status = "unknown";
  known!.status = "submitted";
  known!.provider_batch_id = "msgbatch_test";
  await runConceptMembershipTickV1({
    run_id: h.run.id,
    store: h.store,
    provider: h.provider,
  });
  assert.equal(uncertain!.status, "unknown");
  assert.equal(known!.status, "settled");
  assert.equal(known!.results_applied, true);
  assert.equal(h.labels.length, 1);
  assert.equal(h.submitted(), 0);
});

test("missing ended-batch result preserves unknown exposure and emits no semantic negative", async () => {
  const h = harness();
  h.provider.results = async function* () {};
  const result = await runConceptMembershipTickV1({
    run_id: h.run.id,
    store: h.store,
    provider: h.provider,
  });
  assert.equal(h.calls()[0]?.status, "unknown");
  assert.ok(h.labels.every((r) => r.verdict === "error"));
  assert.equal(h.submitted(), 1);
});
test("max_tokens splits all roots, then only complete responses materialize decisions", async () => {
  const h = harness();
  const original = h.provider.results;
  h.provider.results = async function* () {
    for await (const r of original()) {
      if (
        h.calls().find((c) => c.custom_id === r.item.custom_id)!.inputs.length >
        1
      )
        r.item.result.message.stop_reason = "max_tokens";
      yield { ...r, rawText: JSON.stringify(r.item) };
    }
  };
  await runConceptMembershipTickV1({
    run_id: h.run.id,
    store: h.store,
    provider: h.provider,
  });
  assert.equal(h.labels.length, 0);
  await runConceptMembershipTickV1({
    run_id: h.run.id,
    store: h.store,
    provider: h.provider,
  });
  assert.equal(h.labels.length, 2);
  assert.ok(h.labels.every((r) => r.verdict === "belongs"));
});
