export const SIGNAL_TOPIC_EVALUATION_LAUNCH_CONFIRMATION =
  "RUN_ONE_TOPIC_EVALUATION" as const;

export type SignalTopicEvaluationFlightCardV1 = {
  contractVersion: "signal-topic-evaluation-preflight-v1";
  executionEnabled: boolean;
  executionConfigurationComplete: boolean;
  credentialConfigured: boolean;
  provider: "anthropic";
  model: string | null;
  pricingVersion: string | null;
  envelopeDigest: string;
  proposalCount: 115;
  oneCallMax: 1;
  retryAllowed: false;
  hardCapMicroUsd: string | null;
  estimatedMaxCostMicroUsd: string | null;
  successMinimumCandidates: 10;
  topicAdoption: false;
  publication: false;
  serving: false;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string" ? value : undefined;
}

export function projectSignalTopicEvaluationFlightCardV1(
  value: unknown
): SignalTopicEvaluationFlightCardV1 {
  if (!isObject(value)) throw new Error("topic_evaluation_preflight_invalid");
  const model = nullableString(value.model);
  const pricingVersion = nullableString(value.pricing_version);
  const hardCapMicroUsd = nullableString(value.hard_cap_micro_usd);
  const estimatedMaxCostMicroUsd = nullableString(value.estimated_max_cost_micro_usd);
  const envelopeDigest = typeof value.envelope_digest === "string" ? value.envelope_digest : "";
  if (
    value.contract_version !== "signal-topic-evaluation-preflight-v1"
    || typeof value.execution_enabled !== "boolean"
    || typeof value.execution_configuration_complete !== "boolean"
    || typeof value.credential_configured !== "boolean"
    || value.provider !== "anthropic"
    || model === undefined
    || pricingVersion === undefined
    || !/^sha256:[0-9a-f]{64}$/u.test(envelopeDigest)
    || value.proposal_count !== 115
    || value.one_call_max !== 1
    || value.retry_allowed !== false
    || hardCapMicroUsd === undefined
    || estimatedMaxCostMicroUsd === undefined
    || value.success_minimum_candidates !== 10
    || value.topic_adoption !== false
    || value.publication !== false
    || value.serving !== false
  ) {
    throw new Error("topic_evaluation_preflight_invalid");
  }
  return {
    contractVersion: value.contract_version,
    executionEnabled: value.execution_enabled,
    executionConfigurationComplete: value.execution_configuration_complete,
    credentialConfigured: value.credential_configured,
    provider: value.provider,
    model,
    pricingVersion,
    envelopeDigest,
    proposalCount: value.proposal_count,
    oneCallMax: value.one_call_max,
    retryAllowed: value.retry_allowed,
    hardCapMicroUsd,
    estimatedMaxCostMicroUsd,
    successMinimumCandidates: value.success_minimum_candidates,
    topicAdoption: value.topic_adoption,
    publication: value.publication,
    serving: value.serving
  };
}

export function canLaunchSignalTopicEvaluationV1(card: SignalTopicEvaluationFlightCardV1) {
  return card.executionEnabled
    && card.executionConfigurationComplete
    && card.credentialConfigured
    && Boolean(card.model)
    && Boolean(card.pricingVersion)
    && card.oneCallMax === 1
    && card.retryAllowed === false
    && card.hardCapMicroUsd !== null
    && /^[1-9][0-9]*$/u.test(card.hardCapMicroUsd)
    && card.estimatedMaxCostMicroUsd !== null
    && /^[0-9]+$/u.test(card.estimatedMaxCostMicroUsd)
    && BigInt(card.estimatedMaxCostMicroUsd) <= BigInt(card.hardCapMicroUsd)
    && card.topicAdoption === false
    && card.publication === false
    && card.serving === false;
}

export function createSignalTopicEvaluationIdempotencyKeyV1(
  randomUuid: () => string = () => crypto.randomUUID()
) {
  return `topic-evaluation:start:${randomUuid()}`;
}

export function buildSignalTopicEvaluationLaunchRequestV1(args: {
  acknowledged: boolean;
  card: SignalTopicEvaluationFlightCardV1;
  idempotencyKey: string;
}) {
  if (!args.acknowledged) throw new Error("topic_evaluation_cost_acknowledgement_required");
  if (!canLaunchSignalTopicEvaluationV1(args.card)) {
    throw new Error("topic_evaluation_preflight_not_ready");
  }
  if (!args.idempotencyKey.startsWith("topic-evaluation:start:")) {
    throw new Error("topic_evaluation_idempotency_key_invalid");
  }
  return {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey
    },
    body: {
      expected_envelope_digest: args.card.envelopeDigest,
      confirmation: SIGNAL_TOPIC_EVALUATION_LAUNCH_CONFIRMATION,
      hard_cap_micro_usd: args.card.hardCapMicroUsd!
    }
  } as const;
}

export function acquireSignalTopicEvaluationSubmissionLockV1(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function readSignalTopicEvaluationRunStatusV1(value: unknown): "queued" {
  if (!isObject(value) || value.status !== "queued") {
    throw new Error("topic_evaluation_run_status_invalid");
  }
  return value.status;
}
