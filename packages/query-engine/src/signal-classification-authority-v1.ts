import { createHash } from "node:crypto";

export const SIGNAL_CLASSIFICATION_AUTHORITY_CONTRACT_VERSION =
  "signal-classification-authority-v1" as const;

export const SIGNAL_CLASSIFICATION_RESOLUTION_METHODS = [
  "exact",
  "labeling_function",
  "model",
  "human"
] as const;
export type SignalClassificationResolutionMethodV1 =
  (typeof SIGNAL_CLASSIFICATION_RESOLUTION_METHODS)[number];

export const SIGNAL_CLASSIFICATION_DISPOSITIONS = [
  "approved",
  "pending",
  "rejected",
  "abstained"
] as const;
export type SignalClassificationDispositionV1 =
  (typeof SIGNAL_CLASSIFICATION_DISPOSITIONS)[number];

export type SignalClassificationAvailabilityV1 = "available" | "not_available";

export const SIGNAL_LABELING_FUNCTION_OWNER_KINDS = ["platform", "workspace"] as const;
export type SignalLabelingFunctionOwnerKindV1 =
  (typeof SIGNAL_LABELING_FUNCTION_OWNER_KINDS)[number];
export const SIGNAL_LABELING_FUNCTION_OUTCOMES = ["vote", "abstain"] as const;
export type SignalLabelingFunctionOutcomeV1 =
  (typeof SIGNAL_LABELING_FUNCTION_OUTCOMES)[number];

export type SignalLabelingFunctionContractV1 = {
  contract_version: "signal-labeling-function-v1";
  owner_kind: SignalLabelingFunctionOwnerKindV1;
  function_key: string;
  version: number;
  input_contract: { fields: string[] };
  output_contract: { outcomes: SignalLabelingFunctionOutcomeV1[] };
  definition_hash: string;
};

export type SignalClassificationCoverageDescriptorV1 = {
  contract_version: typeof SIGNAL_CLASSIFICATION_AUTHORITY_CONTRACT_VERSION;
  availability: SignalClassificationAvailabilityV1;
  generation: {
    key: string;
    version: number;
    definition_digest: string;
    population_digest: string;
    watermark_digest: string;
  } | null;
  denominator: number | null;
  resolved: number | null;
  approved: number | null;
  pending: number | null;
  rejected: number | null;
  abstained: number | null;
  error: number | null;
  coverage: number | null;
  limitations: string[];
};

export function buildSignalClassificationCoverageV1(input: {
  available: boolean;
  generation?: SignalClassificationCoverageDescriptorV1["generation"];
  denominator?: number;
  approved?: number;
  pending?: number;
  rejected?: number;
  abstained?: number;
  error?: number;
  limitations?: string[];
}): SignalClassificationCoverageDescriptorV1 {
  if (!input.available) {
    return {
      contract_version: SIGNAL_CLASSIFICATION_AUTHORITY_CONTRACT_VERSION,
      availability: "not_available",
      generation: null,
      denominator: null,
      resolved: null,
      approved: null,
      pending: null,
      rejected: null,
      abstained: null,
      error: null,
      coverage: null,
      limitations: unique(input.limitations?.length ? input.limitations : ["classification_generation_not_available"])
    };
  }

  const generation = input.generation ?? null;
  if (!generation) throw new Error("classification_generation_required");
  const denominator = nonnegativeInteger(input.denominator, "denominator");
  const approved = nonnegativeInteger(input.approved, "approved");
  const pending = nonnegativeInteger(input.pending, "pending");
  const rejected = nonnegativeInteger(input.rejected, "rejected");
  const abstained = nonnegativeInteger(input.abstained, "abstained");
  const error = nonnegativeInteger(input.error, "error");
  if (approved + pending + rejected + abstained + error !== denominator) {
    throw new Error("classification_denominator_does_not_reconcile");
  }
  const resolved = approved + pending + rejected + abstained;
  return {
    contract_version: SIGNAL_CLASSIFICATION_AUTHORITY_CONTRACT_VERSION,
    availability: "available",
    generation,
    denominator,
    resolved,
    approved,
    pending,
    rejected,
    abstained,
    error,
    coverage: denominator === 0 ? null : resolved / denominator,
    limitations: unique(input.limitations ?? [])
  };
}

export function signalClassificationAssignmentAuthorityV1(input: {
  method: SignalClassificationResolutionMethodV1;
  proposed_disposition: SignalClassificationDispositionV1;
  human_actor_present: boolean;
  approved_policy_present: boolean;
  approved_model_present?: boolean;
  score?: number | null;
  confidence?: string | null;
}): SignalClassificationDispositionV1 {
  if (input.proposed_disposition !== "approved") return input.proposed_disposition;
  if (input.method === "human") {
    if (!input.human_actor_present) throw new Error("classification_human_actor_required");
    return "approved";
  }
  if (!input.approved_policy_present) {
    // Score and confidence are deliberately ignored as decision authority.
    return "pending";
  }
  if (input.method === "model" && input.approved_model_present !== true) return "pending";
  return "approved";
}

export function normalizeSignalLabelingFunctionContractV1(
  input: unknown
): SignalLabelingFunctionContractV1 {
  const value = strictObject(input, [
    "contract_version", "owner_kind", "function_key", "version",
    "input_contract", "output_contract", "definition_hash"
  ], "labeling_function");
  if (value.contract_version !== "signal-labeling-function-v1") {
    throw new Error("classification_labeling_function_contract_version_invalid");
  }
  if (!SIGNAL_LABELING_FUNCTION_OWNER_KINDS.includes(
    value.owner_kind as SignalLabelingFunctionOwnerKindV1
  )) throw new Error("classification_labeling_function_owner_invalid");
  const functionKey = boundedKey(value.function_key, "function_key");
  const version = nonnegativeInteger(value.version as number | undefined, "labeling_function_version");
  if (version < 1) throw new Error("classification_labeling_function_version_invalid");
  const inputContract = strictObject(value.input_contract, ["fields"], "labeling_function_input");
  const outputContract = strictObject(value.output_contract, ["outcomes"], "labeling_function_output");
  const fields = uniqueStrings(inputContract.fields, "labeling_function_fields");
  const outcomes = uniqueStrings(outputContract.outcomes, "labeling_function_outcomes");
  if (fields.length === 0 || outcomes.length === 0 || !outcomes.includes("abstain")
    || outcomes.some((outcome) => !SIGNAL_LABELING_FUNCTION_OUTCOMES.includes(
      outcome as SignalLabelingFunctionOutcomeV1
    ))) throw new Error("classification_labeling_function_contract_invalid");
  const definitionHash = digest(value.definition_hash, "labeling_function_definition_hash");
  return {
    contract_version: "signal-labeling-function-v1",
    owner_kind: value.owner_kind as SignalLabelingFunctionOwnerKindV1,
    function_key: functionKey,
    version,
    input_contract: { fields },
    output_contract: { outcomes: outcomes as SignalLabelingFunctionOutcomeV1[] },
    definition_hash: definitionHash
  };
}

export function signalClassificationGenerationDigestV1(input: {
  workspace_key: string;
  taxonomy_profile_key: string;
  generation_key: string;
  generation_version: number;
  population_digest: string;
  watermark_digest: string;
  identity_catalog_digest: string;
  denominator: number;
}) {
  return sha256(canonicalJson({
    contract_version: SIGNAL_CLASSIFICATION_AUTHORITY_CONTRACT_VERSION,
    ...input
  }));
}

export function signalClassificationEvaluationMetricsV1(input: {
  denominator: number;
  approved: number;
  pending: number;
  rejected: number;
  abstained: number;
  error: number;
  comparable_gold?: {
    true_positive: number;
    false_positive: number;
    false_negative: number;
  } | null;
}) {
  const coverage = buildSignalClassificationCoverageV1({
    available: true,
    generation: {
      key: "evaluation",
      version: 1,
      definition_digest: sha256("evaluation-definition"),
      population_digest: sha256("evaluation-population"),
      watermark_digest: sha256("evaluation-watermark")
    },
    ...input
  });
  const gold = input.comparable_gold;
  if (!gold) return { ...coverage, precision: null, recall: null, f1: null };
  const tp = nonnegativeInteger(gold.true_positive, "true_positive");
  const fp = nonnegativeInteger(gold.false_positive, "false_positive");
  const fn = nonnegativeInteger(gold.false_negative, "false_negative");
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : (2 * precision * recall) / (precision + recall);
  return { ...coverage, precision, recall, f1 };
}

function nonnegativeInteger(value: number | undefined, field: string) {
  if (!Number.isInteger(value) || (value ?? -1) < 0) {
    throw new Error(`classification_${field}_invalid`);
  }
  return value as number;
}

function strictObject(input: unknown, allowed: string[], field: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`classification_${field}_invalid`);
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`classification_${field}_unknown_field`);
  }
  return value;
}

function boundedKey(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(value)) {
    throw new Error(`classification_${field}_invalid`);
  }
  return value;
}

function uniqueStrings(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`classification_${field}_invalid`);
  }
  return unique(value as string[]);
}

function digest(value: unknown, field: string) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`classification_${field}_invalid`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}
