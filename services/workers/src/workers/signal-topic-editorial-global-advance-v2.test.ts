import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildSignalTopicEditorialScreeningPlanV2,
  signalTopicEditorialDigestV1 as sha,
  validateSignalTopicEditorialGroupOutputV2,
  validateSignalTopicEditorialGlobalMergeResultV2,
  validateSignalTopicEditorialGlobalRankingResultV2,
  validateSignalTopicEditorialGlobalShardResultV2,
  type SignalTopicEditorialGlobalUnitV2,
  type SignalTopicEditorialScreeningGroupV1,
} from "@noisia/query-engine";
import { planSignalTopicEditorialGlobalAdvanceV2,
  type SignalTopicEditorialGlobalStageObservationV2 } from "./signal-topic-editorial-global-advance-v2";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { brand_name: "Example", default_locale: "es-MX", summary: "Asistente doméstico con IA.",
  audiences: ["hogares"], categories: ["tecnología"], competitors: [], positive_anchors: ["automatización"],
  negative_anchors: [], abstention_anchors: [] };
function makeUnits(total: number): SignalTopicEditorialGlobalUnitV2[] {
  const groups: SignalTopicEditorialScreeningGroupV1[] = Array.from({ length: total }, (_, index) => {
    const text = `Mención sobre automatización doméstica ${index}`, root_id = id(index + 1),
      chunk_sha256 = "sha256:" + createHash("sha256").update(text).digest("hex");
    const evidence = [{ ref_id: sha({ root_id, chunk_index: 0, start: 0, end: text.length, chunk_sha256 }),
      root_id, chunk_index: 0, start: 0, end: text.length, chunk_sha256, text, locale: "es-MX",
      platform: "reddit", occurred_at: "2026-09-26T00:00:00Z" }];
    const scope_counts = { brand: 1, competitor: 0, category: 0, unknown: 0 },
      locale_counts = [{ key: "es-MX", count: 1 }], platform_counts = [{ key: "reddit", count: 1 }],
      month_counts = [{ key: "2026-09", count: 1 }], brand_affinity = { positive: [], negative: [], abstention: [] },
      neighbors: SignalTopicEditorialScreeningGroupV1["neighbors"] = [], metrics = { cohesion: null, outlier_ratio: null };
    const dossier = { contract_version: "signal-topic-group-dossier-v1", scope_counts, locale_counts, platform_counts,
      month_counts, brand_affinity, neighbors, metrics, evidence: evidence.map(({ text: _text, ...item }) => item) };
    return { group_key: `open:g-${index}`, lane: "open", group_digest: sha(["group", index]),
      source_dossier_digest: sha(["source-dossier", index]), dossier_digest: sha(dossier), community_key: "community",
      root_count: 1, chunk_count: 1, terms: ["home"], scope_counts, locale_counts, platform_counts, month_counts,
      brand_affinity, neighbors, metrics, evidence };
  });
  const plan = buildSignalTopicEditorialScreeningPlanV2({ workspace_id: id(80), run_id: id(81),
    expected_group_count: total, source_context_digest: sha("source"), editorial_context_digest: sha(context),
    context, groups });
  return plan.requests.map((request, index) => ({ request,
    decision: validateSignalTopicEditorialGroupOutputV2(request, {
      contract_version: "signal-topic-editorial-group-output-v2", group_id: request.receipt.group_id,
      disposition: "topic", candidate: { label: `Automatización ${index}`, definition: "Rutinas del hogar conectado", locale: "es-MX" },
      confidence: 0.8, rationale: "La cita habla del producto.",
      cited_evidence_ids: [request.receipt.evidence[0]!.evidence_id],
    }), technical_error_code: null }));
}

test("advance waits for exact accepted shards, then creates merge, then complete catalog", () => {
  const units = makeUnits(1), snapshot_digest = units[0]!.request.identity.snapshot_digest;
  const first = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest, requests: [] });
  assert.equal(first.action, "prepare");
  if (first.action !== "prepare") return;
  assert.equal(first.stage_kind, "shard");
  const shard = first.reviews[0]!;
  if (shard.contract_version !== "signal-topic-editorial-global-shard-v2") throw new Error("wrong shard");
  const group = shard.groups[0]!;
  const shardResult = validateSignalTopicEditorialGlobalShardResultV2({ shard, value: {
    contract_version: "signal-topic-editorial-global-shard-result-v2", concepts: [{ concept_key: "home", kind: "topic",
      label: "Automatización", definition: "Rutinas del hogar conectado", members: [{ group_key: group.group_key,
        cited_ref_ids: [group.evidence[0]!.ref_id], rationale: "Cita concreta del hogar conectado." }] }],
    noise: [], unresolved: [],
  } });
  const shardObservation: SignalTopicEditorialGlobalStageObservationV2 = { stage_kind: "shard", round: 0,
    batch_index: shard.batch_index, descriptor: shard, validation: { status: "accepted_shard", result: shardResult },
    call_status: "settled", batch_state: "imported", retryable_receipt_error: false };
  const second = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest, requests: [shardObservation] });
  assert.equal(second.action, "prepare");
  if (second.action !== "prepare") return;
  assert.equal(second.stage_kind, "merge");
  const review = second.reviews[0]!;
  if (review.contract_version !== "signal-topic-editorial-global-merge-review-v2") throw new Error("wrong merge");
  const mergeResult = validateSignalTopicEditorialGlobalMergeResultV2({ review, value: {
    contract_version: "signal-topic-editorial-global-merge-result-v2", concepts: [{ concept_key: "home",
      kind: "topic", label: "Automatización del hogar", definition: "Rutinas del hogar conectado",
      priority_rationale: "Relevante para la marca.", member_concept_keys: [review.nodes[0]!.concept_key] }],
  } });
  const mergeObservation: SignalTopicEditorialGlobalStageObservationV2 = { stage_kind: "merge", round: 1,
    batch_index: review.batch_index, descriptor: review, validation: { status: "accepted_merge", result: mergeResult },
    call_status: "settled", batch_state: "imported", retryable_receipt_error: false };
  const final = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest,
    requests: [shardObservation, mergeObservation] });
  assert.equal(final.action, "materialize");
  if (final.action === "materialize") {
    assert.equal(final.catalog.ready_to_materialize, true);
    assert.equal(final.catalog.group_evidence.length, 1);
    assert.equal(final.catalog.revision?.concepts.length, 1);
  }
});

test("terminal invalid stage blocks, while eligible grammar or citation retries wait", () => {
  const units = makeUnits(1), snapshot_digest = units[0]!.request.identity.snapshot_digest;
  const first = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest, requests: [] });
  if (first.action !== "prepare") throw new Error("expected shard");
  const shard = first.reviews[0]!;
  const failed: SignalTopicEditorialGlobalStageObservationV2 = { stage_kind: "shard", round: 0,
    batch_index: 0, descriptor: shard, validation: { status: "provider_error",
      code: "topic_editorial_global_stage_provider_errored" }, call_status: "settled", batch_state: "imported",
    retryable_receipt_error: false };
  const blocked = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest, requests: [failed] });
  assert.deepEqual(blocked, { action: "blocked", reason: "topic_editorial_global_stage_result_not_accepted" });
  const waiting = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest,
    requests: [{ ...failed, retryable_receipt_error: true }] });
  assert.deepEqual(waiting, { action: "waiting", reason: "topic_editorial_global_stage_receipt_retry_pending" });
  const citation = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest,
    requests: [{ ...failed, validation: { status: "invalid_output",
      code: "topic_editorial_global_shard_citation_invalid" }, retryable_receipt_error: true }] });
  assert.deepEqual(citation, { action: "waiting", reason: "topic_editorial_global_stage_receipt_retry_pending" });
  const rejected = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest, requests: [{ ...failed,
    validation: null, call_status: "definitely_not_sent", batch_state: "rejected", retryable_receipt_error: false }] });
  assert.deepEqual(rejected, { action: "blocked", reason: "topic_editorial_global_stage_submission_rejected" });
});

test("multiple merge lots without reduction require one compact global ranking pass", () => {
  const units = makeUnits(41), snapshot_digest = units[0]!.request.identity.snapshot_digest;
  const first = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest, requests: [] });
  assert.equal(first.action, "prepare");
  if (first.action !== "prepare") return;
  assert.equal(first.reviews.length, 2);
  const shardObservations: SignalTopicEditorialGlobalStageObservationV2[] = first.reviews.map(review => {
    if (review.contract_version !== "signal-topic-editorial-global-shard-v2") throw new Error("wrong shard");
    const result = validateSignalTopicEditorialGlobalShardResultV2({ shard: review, value: {
      contract_version: "signal-topic-editorial-global-shard-result-v2",
      concepts: review.groups.map(group => ({ concept_key: group.group_key, kind: "topic",
        label: `Tema ${group.id}`, definition: "Asunto específico.", members: [{ group_key: group.group_key,
          cited_ref_ids: [group.evidence[0]!.ref_id], rationale: "La cita respalda el tema." }] })),
      noise: [], unresolved: [],
    } });
    return { stage_kind: "shard", round: 0, batch_index: review.batch_index, descriptor: review,
      validation: { status: "accepted_shard", result }, call_status: "settled", batch_state: "imported",
      retryable_receipt_error: false };
  });
  const partial = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest,
    requests: shardObservations.slice(0, 1) });
  assert.equal(partial.action, "prepare");
  if (partial.action === "prepare") assert.equal(partial.stage_kind, "shard");
  const second = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest, requests: shardObservations });
  assert.equal(second.action, "prepare");
  if (second.action !== "prepare") return;
  assert.equal(second.stage_kind, "merge");
  assert.equal(second.reviews.length, 2);
  const mergeObservations: SignalTopicEditorialGlobalStageObservationV2[] = second.reviews.map(review => {
    if (review.contract_version !== "signal-topic-editorial-global-merge-review-v2") throw new Error("wrong merge");
    const result = validateSignalTopicEditorialGlobalMergeResultV2({ review, value: {
      contract_version: "signal-topic-editorial-global-merge-result-v2",
      concepts: review.nodes.map(node => ({ concept_key: node.concept_key, kind: node.kind,
        label: node.label, definition: node.definition, priority_rationale: "Tema relevante.",
        member_concept_keys: [node.concept_key] })),
    } });
    return { stage_kind: "merge", round: 1, batch_index: review.batch_index, descriptor: review,
      validation: { status: "accepted_merge", result }, call_status: "settled", batch_state: "imported",
      retryable_receipt_error: false };
  });
  const ranked = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest,
    requests: [...shardObservations, ...mergeObservations] });
  assert.equal(ranked.action, "prepare");
  if (ranked.action !== "prepare") return;
  assert.equal(ranked.stage_kind, "rank");
  assert.equal(ranked.reviews.length, 1);
  const rank = ranked.reviews[0]!;
  if (rank.contract_version !== "signal-topic-editorial-global-ranking-review-v2") throw new Error("wrong rank");
  assert.equal(rank.concept_count, 41);
  assert.equal(rank.request_body.includes("Mención sobre automatización"), false);
  const rankResult = validateSignalTopicEditorialGlobalRankingResultV2({ review: rank, value: {
    contract_version: "signal-topic-editorial-global-ranking-result-v2",
    concepts: rank.concept_keys.map(concept_key => ({ concept_key, priority_rationale: "Relevante para la marca." })),
  } });
  const rankObservation: SignalTopicEditorialGlobalStageObservationV2 = { stage_kind: "rank", round: 0,
    batch_index: 0, descriptor: rank, validation: { status: "accepted_rank", result: rankResult },
    call_status: "settled", batch_state: "imported", retryable_receipt_error: false };
  const final = planSignalTopicEditorialGlobalAdvanceV2({ units, snapshot_digest,
    requests: [...shardObservations, ...mergeObservations, rankObservation] });
  assert.equal(final.action, "materialize");
  if (final.action === "materialize") {
    assert.equal(final.catalog.group_evidence.length, 41);
    assert.equal(final.catalog.revision?.concepts.length, 41);
  }
});
