type JsonObject = Record<string, unknown>;

export type SignalTopicEvaluationFullEvidenceStatusV2 = {
  authorityDigest: string;
  clusterCount: 116;
  hardCapMicroUsd: number;
  membershipCount: 21195;
  snapshotDigest: string;
  topViewLimit: 10;
};

const requiredKeys = [
  "action_time_confirmation_required",
  "candidates_are_pending_only",
  "cluster_count",
  "contract_version",
  "execution_enabled",
  "hard_cap_micro_usd",
  "historical_summary_evaluator_preserved",
  "max_model_turns",
  "max_tool_calls",
  "max_tool_result_bytes",
  "max_total_input_tokens",
  "max_total_output_tokens",
  "max_total_tool_result_bytes",
  "membership_count",
  "no_retry",
  "preserve_complete_candidate_pool",
  "provider_calls_allowed",
  "publication",
  "semantic_context_authority_digest",
  "serving",
  "snapshot_digest",
  "snapshot_key",
  "top_view_limit",
  "topic_adoption"
] as const;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIntegerWithin(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= minimum && value <= maximum;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function hasOnlyRequiredKeys(value: JsonObject) {
  const keys = Object.keys(value).sort();
  return keys.length === requiredKeys.length
    && keys.every((key, index) => key === requiredKeys[index]);
}

/**
 * Closed browser projection of the server-owned flight card. It retains aggregate and digest-safe
 * status only, so Brand OS never receives corpus text, artifact paths, mention IDs or authority.
 */
export function projectSignalTopicEvaluationFullEvidenceStatusV2(
  value: unknown
): SignalTopicEvaluationFullEvidenceStatusV2 {
  if (!isObject(value) || !hasOnlyRequiredKeys(value)
    || value.contract_version !== "signal-topic-evaluation-full-evidence-v2"
    || value.execution_enabled !== false
    || value.provider_calls_allowed !== 0
    || value.no_retry !== true
    || value.action_time_confirmation_required !== true
    || !isIntegerWithin(value.max_model_turns, 1, 12)
    || !isIntegerWithin(value.max_tool_calls, 1, 24)
    || !isIntegerWithin(value.max_tool_result_bytes, 1, 32_768)
    || !isIntegerWithin(value.max_total_tool_result_bytes, 1, 262_144)
    || !isIntegerWithin(value.max_total_input_tokens, 1, 450_000)
    || !isIntegerWithin(value.max_total_output_tokens, 1, 50_000)
    || !isIntegerWithin(value.hard_cap_micro_usd, 1, 20_000_000)
    || value.preserve_complete_candidate_pool !== true
    || value.top_view_limit !== 10
    || typeof value.snapshot_key !== "string" || value.snapshot_key.length < 1 || value.snapshot_key.length > 180
    || !isDigest(value.snapshot_digest)
    || value.cluster_count !== 116
    || value.membership_count !== 21_195
    || !isDigest(value.semantic_context_authority_digest)
    || value.historical_summary_evaluator_preserved !== true
    || value.candidates_are_pending_only !== true
    || value.topic_adoption !== false
    || value.publication !== false
    || value.serving !== false
  ) {
    throw new Error("topic_evaluation_full_evidence_status_invalid");
  }

  return {
    authorityDigest: value.semantic_context_authority_digest,
    clusterCount: value.cluster_count,
    hardCapMicroUsd: value.hard_cap_micro_usd,
    membershipCount: value.membership_count,
    snapshotDigest: value.snapshot_digest,
    topViewLimit: value.top_view_limit
  };
}

export function shortSignalTopicEvaluationDigestV2(value: string) {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}
