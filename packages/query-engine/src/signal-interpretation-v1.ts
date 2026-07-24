import { createHash } from "node:crypto";

import {
  SIGNAL_BACKEND_CONTRACT_VERSION,
  SignalBackendContractError,
  normalizeSignalFilterV1,
  signalFiltersHashV1,
  type SignalFilterV1
} from "./signal-backend-v1";
import { SIGNAL_METRIC_CATALOG_V1 } from "./signal-metric-catalog-v1";

export const SIGNAL_INTERPRETATION_CONTRACT_VERSION = "signal-interpretation-v1" as const;
export const SIGNAL_INTERPRETATION_JOB_NAME = "signal.metric-interpretation.v1" as const;
export const SIGNAL_INTERPRETATION_PROMPT_VERSION = "signal-metric-interpretation-v2" as const;
export const SIGNAL_INTERPRETATION_MAX_ATTEMPTS = 3;
export const SIGNAL_INTERPRETATION_TIMEOUT_MS = 45_000;

export type SignalInterpretationClaimKindV1 =
  | "fact"
  | "hypothesis"
  | "causal_claim"
  | "recommendation";

export type SignalMetricPacketRowV1 = {
  materialization_id: string;
  materialization_key: string;
  metric_key: string;
  metric_version: number;
  period_start: string;
  period_end: string;
  value: number | null;
  denominator: number | null;
  sample_size: number;
  materialization_state: "fresh" | "stale" | "pending" | "partial" | "not_available";
  quality_state: "pass" | "partial" | "failed" | "unknown";
  data_watermark_hash: string;
};

export type SignalMetricPacketV1 = {
  contract_version: typeof SIGNAL_INTERPRETATION_CONTRACT_VERSION;
  backend_contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  workspace_id: string;
  study_corpus_id: string;
  metric_group_key: string;
  metric_group_version: number;
  filter: SignalFilterV1;
  filters_hash: string;
  data_watermark_hash: string;
  data_scope: {
    study_corpus_id: string;
    period_start: string;
    period_end: string;
    materialization_ids: string[];
    metric_keys: string[];
  };
  rows: SignalMetricPacketRowV1[];
};

export type SignalInterpretationNumericRefV1 = {
  materialization_id: string;
  field: "value" | "denominator" | "sample_size";
  value: number;
};

export type SignalInterpretationClaimV1 = {
  kind: SignalInterpretationClaimKindV1;
  text: string;
  numeric_refs: SignalInterpretationNumericRefV1[];
  evidence_refs: string[];
  uncertainty: string | null;
};

export type SignalMetricInterpretationV1 = {
  contract_version: typeof SIGNAL_INTERPRETATION_CONTRACT_VERSION;
  summary: string;
  claims: SignalInterpretationClaimV1[];
  limitations: string[];
  review_status: "auto_published" | "needs_review";
};

export type SignalInterpretationJobDataV1 = {
  contract_version: typeof SIGNAL_INTERPRETATION_CONTRACT_VERSION;
  workspace_id: string;
  study_corpus_id: string;
  metric_group_key: string;
  metric_group_version: number;
  filter: SignalFilterV1;
  filters_hash: string;
  data_watermark_hash: string;
  prompt_version: string;
  model_version: string;
  budget_cap_usd: number;
  idempotency_key: string;
};

export function buildSignalMetricPacketV1(input: {
  workspace_id: string;
  study_corpus_id: string;
  metric_group_key: string;
  metric_group_version?: number;
  filter: unknown;
  data_watermark_hash: string;
  rows: SignalMetricPacketRowV1[];
}): SignalMetricPacketV1 {
  const group = SIGNAL_METRIC_CATALOG_V1.find((candidate) => candidate.key === input.metric_group_key);
  if (!group) {
    throw new SignalBackendContractError("not_available", "Signal metric group is not available.", {
      metric_group_key: input.metric_group_key
    });
  }
  const filter = normalizeSignalFilterV1(input.filter);
  const filtersHash = signalFiltersHashV1(filter);
  const metricKeys = new Set(group.metrics.map((metric) => metric.key));
  const rows = [...input.rows]
    .filter((row) => metricKeys.has(row.metric_key))
    .sort((left, right) => [
      left.period_start.localeCompare(right.period_start),
      left.metric_key.localeCompare(right.metric_key),
      left.materialization_id.localeCompare(right.materialization_id)
    ].find((value) => value !== 0) ?? 0);
  if (rows.length === 0) {
    throw new SignalBackendContractError("not_available", "Canonical metric materializations are not available.", {
      metric_group_key: input.metric_group_key,
      filters_hash: filtersHash
    });
  }
  if (rows.some((row) => row.data_watermark_hash !== input.data_watermark_hash)) {
    throw new SignalBackendContractError("stale", "Metric packet contains incompatible watermarks.", {
      metric_group_key: input.metric_group_key,
      filters_hash: filtersHash
    });
  }
  return {
    contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
    backend_contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    workspace_id: input.workspace_id,
    study_corpus_id: input.study_corpus_id,
    metric_group_key: group.key,
    metric_group_version: input.metric_group_version ?? 1,
    filter,
    filters_hash: filtersHash,
    data_watermark_hash: input.data_watermark_hash,
    data_scope: {
      study_corpus_id: input.study_corpus_id,
      period_start: rows[0]!.period_start,
      period_end: rows.at(-1)!.period_end,
      materialization_ids: rows.map((row) => row.materialization_id),
      metric_keys: Array.from(new Set(rows.map((row) => row.metric_key))).sort()
    },
    rows
  };
}

export function signalMetricPacketHashV1(packet: SignalMetricPacketV1) {
  return `sha256:${createHash("sha256").update(canonicalJson(packet)).digest("hex")}`;
}

export function signalInterpretationIdempotencyKeyV1(input: {
  workspace_id: string;
  metric_group_key: string;
  metric_group_version: number;
  filters_hash: string;
  data_watermark_hash: string;
  prompt_version: string;
  model_version: string;
}) {
  return `signal-interpretation:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
}

export function validateSignalMetricInterpretationV1(
  input: SignalMetricInterpretationV1,
  packet: SignalMetricPacketV1
): SignalMetricInterpretationV1 {
  if (input.contract_version !== SIGNAL_INTERPRETATION_CONTRACT_VERSION) {
    throw invalidInterpretation("Unsupported interpretation contract version.");
  }
  if (extractNumbers(input.summary).length > 0) {
    throw invalidInterpretation(
      "Interpretation summaries must stay qualitative because the contract has no summary-level numeric refs."
    );
  }
  const available = new Map<string, SignalMetricPacketRowV1>(
    packet.rows.map((row) => [row.materialization_id, row])
  );
  const claims = input.claims.map((claim, index) => {
    if (!["fact", "hypothesis", "causal_claim", "recommendation"].includes(claim.kind)) {
      throw invalidInterpretation("Unknown interpretation claim kind.", { claim_index: index });
    }
    if (!claim.text.trim()) throw invalidInterpretation("Interpretation claims require text.", { claim_index: index });
    const refs = claim.numeric_refs.map((ref) => {
      const row = available.get(ref.materialization_id);
      const actual = row?.[ref.field];
      if (!row || actual == null || Number(actual) !== Number(ref.value)) {
        throw invalidInterpretation("A cited number does not exist exactly in the canonical metric packet.", {
          claim_index: index,
          materialization_id: ref.materialization_id,
          field: ref.field
        });
      }
      return { ...ref, value: Number(ref.value) };
    });
    for (const evidenceRef of claim.evidence_refs) {
      if (!available.has(evidenceRef)) {
        throw invalidInterpretation("A claim references evidence outside the canonical metric packet.", {
          claim_index: index,
          evidence_ref: evidenceRef
        });
      }
    }
    const citedValues = new Set(refs.map((ref) => normalizedNumber(ref.value)));
    for (const number of extractNumbers(claim.text)) {
      if (!citedValues.has(normalizedNumber(number))) {
        throw invalidInterpretation("Every number written in a claim must have an exact numeric_ref.", {
          claim_index: index,
          value: number
        });
      }
    }
    if ((claim.kind === "hypothesis" || claim.kind === "causal_claim") && !claim.uncertainty?.trim()) {
      throw invalidInterpretation("Hypotheses and causal claims require explicit uncertainty.", {
        claim_index: index
      });
    }
    return {
      ...claim,
      text: claim.text.trim(),
      numeric_refs: refs,
      evidence_refs: Array.from(new Set(claim.evidence_refs)).sort(),
      uncertainty: claim.uncertainty?.trim() || null
    };
  });
  const needsReview = claims.some((claim) =>
    claim.kind === "causal_claim" || claim.kind === "recommendation" || claim.kind === "hypothesis"
  );
  if (input.review_status !== (needsReview ? "needs_review" : "auto_published")) {
    throw invalidInterpretation("Interpretation review status is incompatible with its claim kinds.");
  }
  return {
    contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
    summary: input.summary.trim(),
    claims,
    limitations: input.limitations.map((value) => value.trim()).filter(Boolean),
    review_status: input.review_status
  };
}

export function buildDeterministicSignalInterpretationFallbackV1(
  packet: SignalMetricPacketV1,
  reason: string
): SignalMetricInterpretationV1 {
  const visible = packet.rows.filter((row) =>
    row.materialization_state === "fresh" && row.quality_state === "pass" && row.value != null
  );
  if (visible.length === 0) {
    return {
      contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
      summary: "No hay materializaciones canónicas frescas y aprobadas para interpretar.",
      claims: [],
      limitations: [reason],
      review_status: "auto_published"
    };
  }
  const latest = visible.at(-1)!;
  return validateSignalMetricInterpretationV1({
    contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
    summary: "Lectura descriptiva determinística basada exclusivamente en la materialización canónica más reciente.",
    claims: [{
      kind: "fact",
      text: `El valor materializado más reciente es ${latest.value}.`,
      numeric_refs: [{
        materialization_id: latest.materialization_id,
        field: "value",
        value: latest.value!
      }],
      evidence_refs: [latest.materialization_id],
      uncertainty: null
    }],
    limitations: [reason, "No se infiere causalidad ni se calcula una métrica nueva."],
    review_status: "auto_published"
  }, packet);
}

export function assertSignalInterpretationScopeV1(input: {
  expected_filters_hash: string;
  expected_data_watermark_hash: string;
  packet: SignalMetricPacketV1;
}) {
  if (input.packet.filters_hash !== input.expected_filters_hash) {
    throw new SignalBackendContractError("stale", "Interpretation filter scope is stale.");
  }
  if (input.packet.data_watermark_hash !== input.expected_data_watermark_hash) {
    throw new SignalBackendContractError("stale", "Interpretation watermark scope is stale.");
  }
}

function invalidInterpretation(message: string, details: Record<string, unknown> = {}) {
  return new SignalBackendContractError("partial", message, {
    reason: "invalid_metric_interpretation",
    ...details
  });
}

function extractNumbers(text: string) {
  return Array.from(text.matchAll(/(?<![\p{L}\d_-])-?\d+(?:\.\d+)?(?![\p{L}\d_-])/gu), (match) => Number(match[0]))
    .filter(Number.isFinite);
}

function normalizedNumber(value: number) {
  return Number(value).toString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
