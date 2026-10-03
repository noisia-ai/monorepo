import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildSignalTopicEditorialScreeningPlanV2,
  buildSignalTopicEditorialGlobalShardsV2,
  buildSignalTopicEditorialGlobalRankingReviewV2,
  signalTopicEditorialDigestV1 as sha,
  type SignalTopicEditorialGlobalShardV2,
  type SignalTopicEditorialGlobalUnitV2,
  type SignalTopicEditorialGlobalMergeNodeV2,
} from "@noisia/query-engine";
import { createAnthropicMessageBatchesClient, type AnthropicBatchState } from "../providers/anthropic-message-batches";
import {
  runSignalTopicEditorialGlobalStageTickV2,
  signalTopicEditorialGlobalStageManifestDigestV2,
  type SignalTopicEditorialGlobalStageItemV2,
  type SignalTopicEditorialGlobalStageLeaseV2,
  type SignalTopicEditorialGlobalStageStoresV2,
} from "./signal-topic-editorial-global-stage-v2";

const uuid = (i: number) => "00000000-0000-4000-8000-" + String(i).padStart(12, "0");
function units(total = 2): SignalTopicEditorialGlobalUnitV2[] {
  const context = { brand_name: "Example", default_locale: "es-MX", summary: "Asistente doméstico con IA.",
    audiences: ["hogares"], categories: ["tecnología"], competitors: [], positive_anchors: ["automatización"],
    negative_anchors: [], abstention_anchors: [] };
  const groups = Array.from({ length: total }, (_, i) => {
    const text = "Mención sobre automatización doméstica " + i, root_id = uuid(i + 1);
    const chunk_sha256 = "sha256:" + createHash("sha256").update(text).digest("hex");
    const evidence = [{ ref_id: sha({ root_id, chunk_index: 0, start: 0, end: text.length, chunk_sha256 }),
      root_id, chunk_index: 0, start: 0, end: text.length, chunk_sha256, text, locale: "es-MX",
      platform: "reddit", occurred_at: "2026-09-26T00:00:00.000Z" }];
    const scope_counts = { brand: 1, competitor: 0, category: 0, unknown: 0 };
    const locale_counts = [{ key: "es-MX", count: 1 }], platform_counts = [{ key: "reddit", count: 1 }],
      month_counts = [{ key: "2026-09", count: 1 }], brand_affinity = { positive: [], negative: [], abstention: [] },
      neighbors: Array<{ group_key: string; similarity: number }> = [], metrics = { cohesion: null, outlier_ratio: null };
    const dossier = { contract_version: "signal-topic-group-dossier-v1", scope_counts, locale_counts, platform_counts,
      month_counts, brand_affinity, neighbors, metrics, evidence: evidence.map(({ text: _text, ...item }) => item) };
    return { group_key: "open:topic-" + i, lane: "open" as const, group_digest: sha(["group", i]),
      source_dossier_digest: sha(["source", i]), dossier_digest: sha(dossier), community_key: "community-a",
      root_count: 1, chunk_count: 1, terms: ["automatización"], scope_counts, locale_counts, platform_counts,
      month_counts, brand_affinity, neighbors, metrics, evidence };
  });
  const plan = buildSignalTopicEditorialScreeningPlanV2({ workspace_id: uuid(80001), run_id: uuid(80002),
    expected_group_count: total, source_context_digest: sha("source"), editorial_context_digest: sha(context), context, groups });
  return plan.requests.map(request => {
    const decision = { contract_version: "signal-topic-editorial-group-decision-v2" as const,
      request_digest: request.request_digest, group_key: request.receipt.group_key,
      group_digest: request.receipt.group_digest, dossier_digest: request.receipt.dossier_digest,
      identity: request.identity, disposition: "topic" as const,
      candidate: { candidate_key: "topic-v2-" + request.request_digest.slice(7, 31), label: "Tema",
        definition: "Tema confirmado por la evidencia.", locale: "es-MX" },
      confidence: 0.9, rationale: "La evidencia confirma el asunto.", cited_ref_ids: [request.source_group.evidence[0]!.ref_id],
      evidence_scope: "cited_evidence_only" as const };
    return { request, decision, technical_error_code: null };
  });
}
function successFor(shard: SignalTopicEditorialGlobalShardV2) {
  return { contract_version: "signal-topic-editorial-global-shard-result-v2", concepts: shard.groups.map(group => ({
    concept_key: "candidate-" + group.id, kind: "topic", label: "Tema " + group.id, definition: "Definición comprobable.",
    members: [{ group_key: group.group_key, cited_ref_ids: [group.evidence[0]!.ref_id], rationale: "La cita sustenta este grupo." }],
  })), noise: [], unresolved: [] };
}
function fixture(options: { count?: number; state?: SignalTopicEditorialGlobalStageLeaseV2["state"] } = {}) {
  const source = units(options.count ?? 2), shards = buildSignalTopicEditorialGlobalShardsV2({ units: source,
    expected_group_count: source.length, batch_size: 1 });
  const items: SignalTopicEditorialGlobalStageItemV2[] = shards.map((shard, index) => ({
    stage_id: uuid(90000), stage_kind: "shard", call_id: uuid(91000 + index), shard,
    provider_request: { custom_id: "shard_" + index, params: JSON.parse(shard.request_body!) as Record<string, unknown> as {
      model: string; max_tokens: number; [key: string]: unknown } },
  }));
  const base: SignalTopicEditorialGlobalStageLeaseV2 = { provider_batch_id: uuid(92000), lease_token: uuid(92001),
    manifest_digest: "", stage_kind: "shard", state: options.state ?? "prepared", provider_id: null, items };
  base.manifest_digest = signalTopicEditorialGlobalStageManifestDigestV2({ stage_kind: "shard", items });
  const ended: AnthropicBatchState = { id: "msgbatch_stage", processing_status: "ended", ended_at: "2026-09-26T00:00:00Z",
    results_url: null, request_counts: { processing: 0, succeeded: items.length, errored: 0, canceled: 0, expired: 0 } };
  const submitting: AnthropicBatchState = { ...ended, processing_status: "in_progress", ended_at: null,
    request_counts: { processing: items.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 } };
  const output = (options.count ?? 2) === 1
    ? [{ custom_id: "shard_0", result: { type: "succeeded", message: { stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(successFor(shards[0]!)) }] } } }]
    : items.map((item, index) => ({ custom_id: item.provider_request.custom_id, result: { type: "succeeded",
      message: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(successFor(shards[index]!)) }] } } }));
  const receipts = new Map<string, string>(), releases: Array<{ next_poll_at: string | null; error_code: string | null }> = [];
  let quarantined = false, finished = false, loseAttach = false, loseValidation = false;
  const stores: SignalTopicEditorialGlobalStageStoresV2 = {
    claimDue: async () => finished || quarantined ? null : structuredClone(base),
    markSubmitting: async () => { base.state = "submitting"; },
    attachProviderBatch: async (_lease, state) => { base.provider_id = state.id; base.state = state.processing_status;
      if (loseAttach) { loseAttach = false; throw new Error("database acknowledgement lost"); } },
    markSubmissionUncertain: async () => { base.state = "submission_unknown"; quarantined = true; },
    markSubmissionRejected: async () => { base.state = "prepared"; },
    recordPoll: async (_lease, state) => { base.state = state.processing_status; },
    persistRawReceipt: async (_lease, receipt) => {
      const prior = receipts.get(receipt.custom_id); if (prior) assert.equal(prior, receipt.raw_text);
      receipts.set(receipt.custom_id, receipt.raw_text);
      const item = base.items.find(value => value.provider_request.custom_id === receipt.custom_id)!; item.raw_sha256 = receipt.raw_sha256;
    },
    recordValidation: async (_lease, result) => {
      base.items.find(item => item.provider_request.custom_id === result.custom_id)!.validation = result.validation;
      if (loseValidation) { loseValidation = false; throw new Error("database acknowledgement lost"); }
    },
    finishImport: async (_lease, result) => { assert.equal(new Set(result.received_custom_ids).size, items.length); finished = true; },
    release: async (_lease, value) => { releases.push(value); },
  };
  let posts = 0, gets = 0, results = 0;
  const provider = createAnthropicMessageBatchesClient({ apiKey: "test-only", fetch: async (url, init) => {
    if (init?.method === "POST") { posts++; return Response.json(submitting); }
    if (String(url).endsWith("/results")) { results++; return new Response(output.map(item => JSON.stringify(item)).join("\n")); }
    gets++; return Response.json(ended);
  } });
  return { base, items, shards, output, stores, provider, receipts, releases,
    counts: () => ({ posts, gets, results, finished }),
    loseAttachAck: () => { loseAttach = true; }, loseValidationAck: () => { loseValidation = true; } };
}

test("submits then imports exact sealed stage requests and validates durable raw results", async () => {
  const f = fixture();
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2(f), "submitted");
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2(f), "imported");
  assert.equal(f.counts().posts, 1);
  assert.equal(f.receipts.size, 2);
  assert.equal(f.base.items.every(item => item.validation?.status === "accepted_shard"), true);
  assert.equal(f.releases.at(-1)?.next_poll_at, null);
});

test("lost provider response is quarantined and cannot trigger a second paid submission", async () => {
  const f = fixture(); let posts = 0;
  const provider = createAnthropicMessageBatchesClient({ apiKey: "test-only", fetch: async () => { posts++; throw new Error("lost"); } });
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2({ ...f, provider }), "submission_unknown");
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2({ ...f, provider }), "idle");
  assert.equal(posts, 1);
});

test("lost database ACKs after submit or validation resume from stored identity/receipt", async () => {
  for (const mode of ["attach", "validation"]) {
    const f = fixture();
    if (mode === "attach") f.loseAttachAck(); else f.loseValidationAck();
    assert.equal(await runSignalTopicEditorialGlobalStageTickV2(f), mode === "attach" ? "retry_read" : "submitted");
    if (mode === "validation") assert.equal(await runSignalTopicEditorialGlobalStageTickV2(f), "retry_read");
    assert.equal(await runSignalTopicEditorialGlobalStageTickV2(f), "imported");
    assert.equal(f.counts().posts, 1);
    assert.equal(f.receipts.size, 2);
  }
});

test("bounded import resumes with the same provider batch; malformed output is durable and distinct", async () => {
  const f = fixture();
  await runSignalTopicEditorialGlobalStageTickV2(f);
  f.output[0]!.result.message.content[0]!.text = "not JSON";
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2({ ...f, import_items_per_tick: 1 }), "waiting");
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2({ ...f, import_items_per_tick: 1 }), "imported");
  assert.equal(f.base.items[0]!.validation?.status, "invalid_output");
  assert.equal(f.base.items[1]!.validation?.status, "accepted_shard");
  assert.equal(f.counts().posts, 1);
  assert.equal(f.receipts.size, 2);
});

test("sealed-body drift and duplicate stage identities fail before provider submit", async () => {
  const f = fixture();
  f.items[0]!.provider_request.params.model = "changed-model";
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2(f), "retry_read");
  assert.equal(f.counts().posts, 0);
  const duplicate = fixture(), first = duplicate.items[0]!, second = duplicate.items[1]!;
  if (first.stage_kind !== "shard" || second.stage_kind !== "shard") assert.fail("fixture must contain shard requests");
  second.stage_id = first.stage_id; second.shard = first.shard;
  second.provider_request.params = structuredClone(first.provider_request.params);
  duplicate.base.manifest_digest = signalTopicEditorialGlobalStageManifestDigestV2({ stage_kind: "shard", items: duplicate.items });
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2(duplicate), "retry_read");
  assert.equal(duplicate.counts().posts, 0);
});

test("compact rank-only review runs through the same durable Batch state machine",async()=>{
  const source=units(1),shard=buildSignalTopicEditorialGlobalShardsV2({units:source,expected_group_count:1})[0]!,
    group=shard.groups[0]!;
  const concept:SignalTopicEditorialGlobalMergeNodeV2={concept_key:"topic-v2-survivor",kind:"topic",label:"Automatización del hogar",
    definition:"Conversaciones sobre rutinas y dispositivos conectados.",priority_rationale:null,priority_rank:null,
    source_concept_keys:["topic-v2-leaf"],members:[{group_key:group.group_key,cited_ref_ids:[group.evidence[0]!.ref_id],
      rationale:"La cita respalda el concepto.",community_key:group.community_key,neighbors:group.neighbors}]};
  const review=buildSignalTopicEditorialGlobalRankingReviewV2({snapshot_digest:shard.snapshot_digest,context:shard.context,concepts:[concept]});
  assert.equal(review.request_body.includes(group.evidence[0]!.text),false);
  const request={custom_id:"rank_global",params:JSON.parse(review.request_body) as {model:string;max_tokens:number;[key:string]:unknown}};
  const item:SignalTopicEditorialGlobalStageItemV2={stage_id:uuid(93000),stage_kind:"rank",call_id:uuid(93001),review,
    provider_request:request};
  const base:SignalTopicEditorialGlobalStageLeaseV2={provider_batch_id:uuid(93002),lease_token:uuid(93003),
    manifest_digest:signalTopicEditorialGlobalStageManifestDigestV2({stage_kind:"rank",items:[item]}),
    stage_kind:"rank",state:"prepared",provider_id:null,items:[item]};
  const state:AnthropicBatchState={id:"msgbatch_rank",processing_status:"ended",ended_at:"2026-09-26T00:00:00Z",
    results_url:null,request_counts:{processing:0,succeeded:1,errored:0,canceled:0,expired:0}};
  const value={contract_version:"signal-topic-editorial-global-ranking-result-v2",concepts:[{concept_key:concept.concept_key,
    priority_rationale:"Alta relevancia."}]};
  const raw=JSON.stringify({custom_id:request.custom_id,result:{type:"succeeded",message:{stop_reason:"end_turn",
    content:[{type:"text",text:JSON.stringify(value)}]}}});
  const store:SignalTopicEditorialGlobalStageStoresV2={
    claimDue:async()=>structuredClone(base),markSubmitting:async()=>{base.state="submitting";},
    attachProviderBatch:async(_lease,batch)=>{base.provider_id=batch.id;base.state=batch.processing_status;},
    markSubmissionUncertain:async()=>{},markSubmissionRejected:async()=>{},recordPoll:async()=>{},
    persistRawReceipt:async()=>{base.items[0]!.raw_sha256="sha256:"+createHash("sha256").update(raw).digest("hex");},
    recordValidation:async(_lease,result)=>{base.items[0]!.validation=result.validation;},
    finishImport:async()=>{},release:async()=>{},
  };
  const client=createAnthropicMessageBatchesClient({apiKey:"test-only",fetch:async(url,init)=>init?.method==="POST"
    ?Response.json({...state,processing_status:"in_progress",ended_at:null,request_counts:{processing:1,succeeded:0,errored:0,canceled:0,expired:0}})
    :String(url).endsWith("/results")?new Response(raw):Response.json(state)});
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2({stores:store,provider:client}),"submitted");
  assert.equal(await runSignalTopicEditorialGlobalStageTickV2({stores:store,provider:client}),"imported");
  assert.equal(base.items[0]!.validation?.status,"accepted_rank");
});
