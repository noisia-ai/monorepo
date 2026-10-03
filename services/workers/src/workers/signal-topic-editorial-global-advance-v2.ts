import {
  applySignalTopicEditorialGlobalRankingV2,
  buildSignalTopicEditorialGlobalCatalogInputV2,
  buildSignalTopicEditorialGlobalMergeReviewsV2,
  buildSignalTopicEditorialGlobalRankingReviewV2,
  buildSignalTopicEditorialGlobalShardsV2,
  composeSignalTopicEditorialGlobalShardOutcomesV2,
  summarizeSignalTopicEditorialGlobalMergeRoundV2,
  type SignalTopicEditorialGlobalMergeResultV2,
  type SignalTopicEditorialGlobalMergeReviewV2,
  type SignalTopicEditorialGlobalRankingResultV2,
  type SignalTopicEditorialGlobalRankingReviewV2,
  type SignalTopicEditorialGlobalShardResultV2,
  type SignalTopicEditorialGlobalShardV2,
  type SignalTopicEditorialGlobalUnitV2,
} from "@noisia/query-engine";
import type { SignalTopicEditorialGlobalStageValidationV2 } from "./signal-topic-editorial-global-stage-v2";

type Kind = "shard" | "merge" | "rank";
type Review = SignalTopicEditorialGlobalShardV2 | SignalTopicEditorialGlobalMergeReviewV2
  | SignalTopicEditorialGlobalRankingReviewV2;
export type SignalTopicEditorialGlobalStageObservationV2 = {
  stage_kind: Kind; round: number; batch_index: number; descriptor: Review;
  validation: SignalTopicEditorialGlobalStageValidationV2 | null;
  call_status: string | null; batch_state: string | null;
  retryable_receipt_error: boolean;
};
export type SignalTopicEditorialGlobalAdvancePlanV2 =
  | { action: "prepare"; stage_kind: Kind; round: number; reviews: Review[] }
  | { action: "waiting"; reason: string }
  | { action: "blocked"; reason: string }
  | { action: "materialize"; catalog: ReturnType<typeof buildSignalTopicEditorialGlobalCatalogInputV2> };

function inspect<T>(kind: Kind, round: number, reviews: Review[], requests: SignalTopicEditorialGlobalStageObservationV2[],
  status: SignalTopicEditorialGlobalStageValidationV2["status"]):
  { state: "missing"; reviews: Review[] } | { state: "waiting"; reason: string }
    | { state: "blocked"; reason: string }
    | { state: "ready"; results: Array<{ batch_index: number; result: T }> } {
  const matches = requests.filter(item => item.stage_kind === kind && item.round === round);
  const byIndex = new Map(matches.map(item => [item.batch_index, item]));
  const expectedIndexes = new Set(reviews.map(review => review.contract_version === "signal-topic-editorial-global-ranking-review-v2"
    ? 0 : review.batch_index));
  if (byIndex.size !== matches.length || matches.length > reviews.length
    || matches.some(item => !expectedIndexes.has(item.batch_index)))
    return { state: "blocked", reason: "topic_editorial_global_stage_request_coverage_invalid" };
  const missing: Review[] = [], results: Array<{ batch_index: number; result: T }> = [];
  let waiting = false;
  for (const review of reviews) {
    const index = review.contract_version === "signal-topic-editorial-global-ranking-review-v2" ? 0 : review.batch_index;
    const current = byIndex.get(index);
    if (!current) { missing.push(review); continue; }
    if (current.descriptor.contract_version !== review.contract_version
      || current.descriptor.request_digest !== review.request_digest
      || current.descriptor.input_digest !== review.input_digest
      || current.descriptor.request_body !== review.request_body)
      return { state: "blocked", reason: "topic_editorial_global_stage_request_drift" };
    const validation = current.validation;
    if (!validation) {
      if (current.batch_state === "rejected" || current.call_status === "definitely_not_sent")
        return { state: "blocked", reason: "topic_editorial_global_stage_submission_rejected" };
      waiting = true; continue;
    }
    if (current.batch_state !== "imported" || current.call_status !== "settled") {
      waiting = true; continue;
    }
    if (validation.status !== status || !("result" in validation)) {
      if (current.retryable_receipt_error)
        return { state: "waiting", reason: "topic_editorial_global_stage_receipt_retry_pending" };
      return { state: "blocked", reason: "topic_editorial_global_stage_result_not_accepted" };
    }
    results.push({ batch_index: index, result: validation.result as T });
  }
  if (missing.length) return { state: "missing", reviews: missing };
  if (waiting) return { state: "waiting", reason: "topic_editorial_global_stage_batch_pending" };
  return { state: "ready", results };
}

/** Recompute every proposed next request from the immutable screening census
 * and accepted stage receipts. No provider output can skip a prior round or
 * alter original group membership and citations. */
export function planSignalTopicEditorialGlobalAdvanceV2(args: {
  units: SignalTopicEditorialGlobalUnitV2[]; snapshot_digest: string;
  requests: SignalTopicEditorialGlobalStageObservationV2[]; revision?: number;
}): SignalTopicEditorialGlobalAdvancePlanV2 {
  const shards = buildSignalTopicEditorialGlobalShardsV2({ units: args.units,
    expected_group_count: args.units.length });
  if (shards.some(shard => shard.snapshot_digest !== args.snapshot_digest))
    return { action: "blocked", reason: "topic_editorial_global_stage_source_drift" };
  const providerShards = shards.filter(shard => shard.groups.length > 0);
  const first = inspect<SignalTopicEditorialGlobalShardResultV2>("shard", 0, providerShards,
    args.requests, "accepted_shard");
  if (first.state === "missing") return { action: "prepare", stage_kind: "shard", round: 0, reviews: first.reviews };
  if (first.state === "waiting") return { action: "waiting", reason: first.reason };
  if (first.state === "blocked") return { action: "blocked", reason: first.reason };
  const outcomes = composeSignalTopicEditorialGlobalShardOutcomesV2({ shards, results: first.results });
  let reviews = buildSignalTopicEditorialGlobalMergeReviewsV2({ shards, results: first.results, round: 1 });
  let root = [] as SignalTopicEditorialGlobalMergeResultV2["concepts"];
  let needsRank = false;
  for (let round = 1; reviews.length; round++) {
    const current = inspect<SignalTopicEditorialGlobalMergeResultV2>("merge", round, reviews,
      args.requests, "accepted_merge");
    if (current.state === "missing") return { action: "prepare", stage_kind: "merge", round, reviews: current.reviews };
    if (current.state === "waiting") return { action: "waiting", reason: current.reason };
    if (current.state === "blocked") return { action: "blocked", reason: current.reason };
    const summary = summarizeSignalTopicEditorialGlobalMergeRoundV2({ reviews, results: current.results });
    root = current.results.flatMap(item => item.result.concepts);
    if (summary.ranking_status === "global") break;
    if (!summary.next_round_allowed) { needsRank = true; break; }
    reviews = buildSignalTopicEditorialGlobalMergeReviewsV2({ prior_nodes: root,
      snapshot_digest: args.snapshot_digest, context: shards[0]!.context, round: round + 1 });
  }
  if (needsRank && root.length) {
    const generatedRank = buildSignalTopicEditorialGlobalRankingReviewV2({ snapshot_digest: args.snapshot_digest,
      context: shards[0]!.context, concepts: root });
    // A submitted request is immutable. Reuse its sealed descriptor when only
    // the prompt wording has evolved; the exact ranked input must still match.
    const priorRank = args.requests.find(item => item.stage_kind === "rank" && item.round === 0 && item.batch_index === 0);
    if (priorRank && (priorRank.descriptor.contract_version !== "signal-topic-editorial-global-ranking-review-v2"
      || priorRank.descriptor.input_body !== generatedRank.input_body
      || priorRank.descriptor.input_digest !== generatedRank.input_digest
      || priorRank.descriptor.snapshot_digest !== generatedRank.snapshot_digest))
      return { action: "blocked", reason: "topic_editorial_global_stage_request_drift" };
    const rank = (priorRank?.descriptor as SignalTopicEditorialGlobalRankingReviewV2 | undefined) ?? generatedRank;
    const ranked = inspect<SignalTopicEditorialGlobalRankingResultV2>("rank", 0, [rank],
      args.requests, "accepted_rank");
    if (ranked.state === "missing") return { action: "prepare", stage_kind: "rank", round: 0, reviews: ranked.reviews };
    if (ranked.state === "waiting") return { action: "waiting", reason: ranked.reason };
    if (ranked.state === "blocked") return { action: "blocked", reason: ranked.reason };
    root = applySignalTopicEditorialGlobalRankingV2({ concepts: root, review: rank,
      result: ranked.results[0]!.result });
  }
  const catalog = buildSignalTopicEditorialGlobalCatalogInputV2({ snapshot_digest: args.snapshot_digest,
    units: args.units, outcomes, root_concepts: root, revision: args.revision ?? 1 });
  if (!catalog.ready_to_materialize || !catalog.complete || !catalog.revision)
    return { action: "blocked", reason: "topic_editorial_global_catalog_incomplete" };
  return { action: "materialize", catalog };
}
