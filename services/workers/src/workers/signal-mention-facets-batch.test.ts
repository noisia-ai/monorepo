import test from "node:test";
import assert from "node:assert/strict";
import {
  runMentionFacetsTickV1,
  facetCallProposalV1,
} from "./signal-mention-facets-batch";
import type {
  LabelingCallV1,
  LabelingRunV1,
  SignalLabelingStoreV1,
} from "@noisia/db";
import {
  entityContextDigestV1,
  facetLabelerIdentityV1,
  facetLabelerIdentityLegacyV1,
  type FacetResult,
} from "@noisia/query-engine";
import { AnthropicBatchTransportError, type AnthropicBatchPage } from "../providers/anthropic-message-batches";
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
    kind: "facets",
    context,
    entity_context_digest: entityContextDigestV1(context),
    identity: facetLabelerIdentityLegacyV1(),
    labeler_digest: "labeler",
    lease_token: "lease",
    cursor_root_id: null,
    cap_micro_usd: null,
    processing_admission_id: "admission",
    status: "running",
    entity_context_version_no: 1,
  } as LabelingRunV1;
  const inputs = [0, 1].map((i) => ({
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
  let calls: LabelingCallV1[] = [],
    submitted = 0;
  const labels: FacetResult[] = [],
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
            created_at: new Date(),
            updated_at: new Date(),
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
    async recoverUnknownBatch(_r, c, id) {
      c.forEach((x) => { x.status = "submitted"; x.provider_batch_id = id; });
    },
    async releaseUnknown(_r, c, reason) {
      c.forEach((x) => { x.status = "failed"; x.results_applied = true; });
      if(reason==="unresolvable_after_window"||reason==="unresolvable_timestamp")run.error_code=`labeling_${reason}`;
    },
    async clearUnknownFailure() { if(run.error_code==="labeling_outcome_unknown")run.error_code = null; },
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
      return run.error_code ? "failed" : labels.length === inputs.length
        ? "completed"
        : calls.some((c) => c.status === "unknown")
          ? "failed"
          : "running";
    },
  } as SignalLabelingStoreV1;
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
    created_at: new Date().toISOString(),
    results_url: null,
  };
  const provider = {
    async create() {
      submitted++;
      return state;
    },
    async get() {
      return state;
    },
    async cancel() {
      return state;
    },
    async list(): Promise<AnthropicBatchPage> { return {data:[],has_more:false,last_id:null}; },
    async *results() {
      for (const call of calls.filter((c) => c.status === "submitted")) {
        const facets = {
          entities: dim([
            { entity_id: "a", kind: "primary_brand", salience: "main" },
          ]),
          unrelated_reason: null,
          voice: dim("individual"),
          act: dim("opinion"),
          spam_or_bot: dim(false),
          language: dim("es"),
          asunto: dim(null),
        };
        const message = {
          stop_reason: "end_turn",
          content: [
            { type: "thinking", thinking: "" },
            {
              type: "text",
              text: JSON.stringify({
                roots:
                  run.identity.params.request_format !== undefined
                    ? Object.fromEntries(
                        call.inputs.map((_, ordinal) => [
                          `r${ordinal}`,
                          facets,
                        ]),
                      )
                    : call.inputs.map((_, root_ordinal) => ({
                        root_ordinal,
                        facets,
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
      await runMentionFacetsTickV1({
        run_id: h.run.id,
        store: h.store,
        provider: h.provider,
      })
    ).status,
    "completed",
  );
  assert.deepEqual(h.events, ["raw", "settle", "apply"]);
  await runMentionFacetsTickV1({
    run_id: h.run.id,
    store: h.store,
    provider: h.provider,
  });
  assert.equal(h.submitted(), 1);
  assert.equal(h.labels.length, 2);
});
test("ambiguous POST is never replayed blindly", async () => {
  const h = harness();
  h.provider.create = async () => {
    throw new AnthropicBatchTransportError("transport", "submission_unknown");
  };
  await assert.rejects(
    runMentionFacetsTickV1({
      run_id: h.run.id,
      store: h.store,
      provider: h.provider,
    }),
  );
  assert.equal(h.calls()[0]?.status, "unknown");
  assert.equal(
    (
      await runMentionFacetsTickV1({
        run_id: h.run.id,
        store: h.store,
        provider: h.provider,
      })
    ).status,
    "failed",
  );
  assert.equal(h.labels.length, 0);
});
test("lost batch ID is found by custom_id and its receipt settles without another POST", async () => {
  const h = harness();
  const originalCreate = h.provider.create;
  h.provider.create = async () => {
    throw new AnthropicBatchTransportError("transport", "submission_unknown");
  };
  await assert.rejects(runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider}));
  assert.equal(h.calls()[0]?.status, "unknown");
  h.provider.create = originalCreate;
  const originalResults = h.provider.results;
  h.provider.results = async function* () {
    const unknown = h.calls().filter((call) => call.status === "unknown");
    unknown.forEach((call) => {call.status="submitted";});
    const items = [];
    for await (const item of originalResults()) items.push(item);
    unknown.forEach((call) => {call.status="unknown";});
    yield* items;
  };
  h.provider.list = async () => ({
    data: [{...await h.provider.get(), created_at:new Date().toISOString()}],
    has_more:false, last_id:null,
  });
  assert.equal((await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider})).status,"completed");
  assert.equal(h.submitted(),0,"recovery must never submit again");
  assert.equal(h.calls()[0]?.status,"settled");
  assert.equal(h.labels.length,2);
});
test("a mature unknown call is explicitly released only after a complete empty provider scan", async () => {
  const h = harness();
  await h.store.reserve(h.run,[facetCallProposalV1(h.run,[h.inputs[0]!])]);
  const call = h.calls()[0]!;
  call.status="unknown";
  call.created_at=new Date(Date.now()-26*60*60*1000);
  call.updated_at=call.created_at;
  await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(call.status,"failed");
  assert.equal(call.results_applied,true);
  assert.equal(h.run.error_code,null);
  assert.equal(h.submitted(),0);
});
test("an old reservation with a recent unknown outcome retains its exposure", async () => {
  const h=harness();
  await h.store.reserve(h.run,[facetCallProposalV1(h.run,[h.inputs[0]!])]);
  const call=h.calls()[0]!;
  call.status="unknown";
  call.created_at=new Date(Date.now()-26*60*60*1000);
  call.updated_at=new Date();
  await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(call.status,"unknown");
  assert.equal(h.run.error_code,"labeling_outcome_unknown");
  assert.equal(h.submitted(),0);
});
test("a receipt outside the provider window terminates without another provider scan",async()=>{
  const h=harness();
  await h.store.reserve(h.run,[facetCallProposalV1(h.run,[h.inputs[0]!])]);
  const call=h.calls()[0]!;
  call.status="unknown";
  call.provider_batch_id="expired-batch";
  call.created_at=new Date(Date.now()-30*24*60*60*1000);
  call.updated_at=new Date();
  h.provider.get=async()=>{throw new Error("expired batch must not be fetched");};
  h.provider.list=async()=>{throw new Error("expired ledger must not be scanned");};
  assert.equal((await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider})).status,"failed");
  assert.equal(call.status,"failed");
  assert.equal(call.results_applied,true);
  assert.equal(h.run.error_code,"labeling_unresolvable_after_window");
});
test("incomplete scans retain recoverable uncertainty but expire without a perpetual drainer",async()=>{
  const h=harness();
  await h.store.reserve(h.run,[facetCallProposalV1(h.run,[h.inputs[0]!])]);
  const call=h.calls()[0]!;
  call.status="unknown";
  call.created_at=new Date(Date.now()-28*24*60*60*1000);
  call.updated_at=new Date();
  let pages=0;
  h.provider.list=async()=>({data:[],has_more:true,last_id:`page-${++pages}`});
  await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(pages,100);
  assert.equal(call.status,"unknown","incomplete evidence must retain exposure inside the window");
  call.created_at=new Date(Date.now()-30*24*60*60*1000);
  h.provider.list=async()=>{throw new Error("expired uncertainty must not rescan");};
  await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(call.status,"failed");
  assert.equal(h.run.error_code,"labeling_unresolvable_after_window");
});
test("invalid call timestamps use the run clock for a bounded terminal decision",async()=>{
  const h=harness();
  await h.store.reserve(h.run,[facetCallProposalV1(h.run,[h.inputs[0]!])]);
  const call=h.calls()[0]!;
  call.status="unknown";
  call.created_at=new Date(NaN);
  call.updated_at=new Date(NaN);
  h.run.created_at=new Date(Date.now()-30*24*60*60*1000);
  h.provider.list=async()=>{throw new Error("expired uncertainty must not rescan");};
  await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(call.status,"failed");
  assert.equal(h.run.error_code,"labeling_unresolvable_after_window");
});
test("missing call and run clocks terminate as unresolvable timestamp",async()=>{
  const h=harness();
  await h.store.reserve(h.run,[facetCallProposalV1(h.run,[h.inputs[0]!])]);
  const call=h.calls()[0]!;
  call.status="unknown";
  call.created_at=new Date(NaN);
  call.updated_at=new Date(NaN);
  h.provider.list=async()=>{throw new Error("unbounded uncertainty must not spin");};
  await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(call.status,"failed");
  assert.equal(h.run.error_code,"labeling_unresolvable_timestamp");
});
test("a group refusal splits until only the responsible facet root is refused", async () => {
  const h = harness(), originalResults = h.provider.results;
  h.provider.results = async function* () {
    for await (const result of originalResults()) {
      const call = h.calls().find((candidate) => candidate.custom_id === result.item.custom_id)!;
      if (call.inputs.some((input) => input.root_id === "1")) {
        result.item.result.message.stop_reason = "refusal";
      }
      yield { ...result, rawText: JSON.stringify(result.item) };
    }
  };
  await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.equal(h.labels.length,0,"the group refusal is not assigned to either root");
  assert.equal(h.calls().length,3,"two distinct child requests are reserved");
  await runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider});
  assert.deepEqual(h.labels.map((label) => [label.root_id,label.status]),[["0","labeled"],["1","refused"]]);
  assert.equal(h.submitted(),2);
});
test("custom identity is deterministic but split attempts are distinct", () => {
  const h = harness(),
    a = facetCallProposalV1(h.run, h.inputs),
    b = facetCallProposalV1(h.run, h.inputs);
  assert.equal(a.custom_id, b.custom_id);
  assert.match(a.custom_id, /^mf1_[a-f0-9]{60}$/u);
  assert.notEqual(
    a.custom_id,
    facetCallProposalV1(h.run, h.inputs.slice(0, 1), 1, a.custom_id).custom_id,
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
    runMentionFacetsTickV1({
      run_id: h.run.id,
      store: h.store,
      provider: h.provider,
    }),
    /labeling_context_changed/u,
  );
  await runMentionFacetsTickV1({
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
        result.status === "error" &&
        result.error_code === "retry_requires_authority",
    ),
  );
  assert.ok(h.calls().every((call) => call.results_applied));
});
test("one unknown call does not block reconciliation of a separate durable response", async () => {
  const h = harness();
  await h.store.reserve(
    h.run,
    h.inputs.map((input) => facetCallProposalV1(h.run, [input])),
  );
  const [uncertain, known] = h.calls();
  uncertain!.status = "unknown";
  known!.status = "submitted";
  known!.provider_batch_id = "msgbatch_test";
  await runMentionFacetsTickV1({
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

test("corrupt stored receipt makes the facets run fail explicitly before provider work",async()=>{
  const h=harness();
  h.store.calls=async()=>{throw new Error("labeling_raw_receipt_invalid");};
  await assert.rejects(runMentionFacetsTickV1({run_id:h.run.id,store:h.store,provider:h.provider}),/labeling_raw_receipt_invalid/u);
  assert.equal(h.run.error_code,"labeling_raw_receipt_invalid");
  assert.equal(h.submitted(),0);
});

test("the persisted labeler identity controls semantic request parameters", () => {
  const h = harness();
  h.run.identity = {
    ...h.run.identity,
    params: {
      thinking: { type: "between_tools" },
      effort: "medium",
      max_tokens: 8192,
    },
  };
  const request = facetCallProposalV1(h.run, h.inputs).request;
  assert.equal(request.model, h.run.identity.model);
  assert.deepEqual(request.thinking, h.run.identity.params.thinking);
  assert.equal((request.output_config as { effort: string }).effort, "medium");
  assert.equal(request.max_tokens, 8192);
  h.run.identity.params.effort = "max";
  assert.throws(
    () => facetCallProposalV1(h.run, h.inputs),
    /facet_thinking_effort_unsupported/u,
  );
});

test("unknown entity recovery after authority loss applies technical results without new children", async () => {
  const h = harness();
  const originalResults = h.provider.results;
  h.provider.results = async function* () {
    for await (const result of originalResults()) {
      const block = result.item.result.message.content.find(
        (item) => item.type === "text",
      )!;
      const roots = JSON.parse(block.text!).roots;
      for (const root of roots)
        root.facets.entities.value[0].entity_id = "absent-entity";
      block.text = JSON.stringify({ roots });
      yield { ...result, rawText: JSON.stringify(result.item) };
    }
  };
  const reserve = h.store.reserve;
  let childReservations = 0;
  h.store.reserve = async (run, proposals, advance) => {
    if (advance === false) {
      childReservations++;
      throw new Error("labeling_forbidden");
    }
    return reserve(run, proposals, advance);
  };
  await assert.rejects(
    runMentionFacetsTickV1({
      run_id: h.run.id,
      store: h.store,
      provider: h.provider,
    }),
    /labeling_forbidden/u,
  );
  await runMentionFacetsTickV1({
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
        result.status === "error" && result.error_code === "unknown_entity_id",
    ),
  );
});

test("required ordinal grammar flows through persisted request and worker parser", async () => {
  const h = harness();
  h.run.identity = facetLabelerIdentityV1();
  for (let i = 2; i < 25; i++)
    h.inputs.push({
      ...h.inputs[0]!,
      root_id: String(i),
      input_digest: `d${i}`,
    });
  const result = await runMentionFacetsTickV1({
    run_id: h.run.id,
    store: h.store,
    provider: h.provider,
  });
  assert.equal(result.status, "completed");
  assert.equal(h.labels.length, 25);
  assert.ok(h.calls().every((call) => call.inputs.length <= 8));
  assert.equal(h.calls().length, 4);
  assert.ok(h.labels.every((label) => label.status === "labeled"));
  assert.equal(h.submitted(), 1);
});
