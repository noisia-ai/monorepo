import { createHash } from "node:crypto";

import { SignalBackendContractError } from "./signal-backend-v1";

export const SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION =
  "signal-monthly-insight-editorial-v1" as const;
export const SIGNAL_MONTHLY_INSIGHT_METRIC_GROUP_KEY =
  "brand_monitoring.monthly_insights" as const;
export const SIGNAL_MONTHLY_INSIGHT_JOB_NAME =
  "signal.monthly-insights.v1" as const;
export const SIGNAL_MONTHLY_INSIGHT_PROMPT_VERSION =
  "signal-monthly-insights-rag-v2" as const;
export const SIGNAL_MONTHLY_INSIGHT_MODEL_VERSION =
  "claude-sonnet-4-5" as const;
export const SIGNAL_MONTHLY_INSIGHT_TIMEOUT_MS = 120_000;
export const SIGNAL_MONTHLY_INSIGHT_MAX_BUDGET_USD = 16;

export type SignalMonthlyInsightEditorialItemV1 = {
  candidate_id: string;
  priority: number;
  short_title: string;
  explanation: string;
  why_it_matters: string;
  confidence: "high" | "medium" | "low";
  limitations: string[];
};

export type SignalMonthlyInsightEditorialV1 = {
  contract_version: typeof SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION;
  candidate_hash: string;
  summary: string;
  items: SignalMonthlyInsightEditorialItemV1[];
};

export type SignalMonthlyInsightCandidateV1 = {
  id: string;
  kind: string;
  tone: "positive" | "negative" | "neutral" | "attention";
  rank: number;
  metric: {
    current: number;
    previous: number | null;
    delta: number | null;
    delta_ratio: number | null;
    unit: "count" | "ratio";
  };
  chart: unknown;
  evidence: {
    mention_ids: string[];
    evidence_count: number;
  };
};

export type SignalMonthlyInsightPacketV1 = {
  contract_version: "signal-monthly-insight-packet-v1";
  workspace_id: string;
  study_corpus_id: string;
  organization_id: string | null;
  brand_id: string | null;
  timezone: string;
  window: { start: string; end: string; days: number };
  comparison_window: { start: string; end: string; days: number } | null;
  candidate_hash: string;
  context: {
    state: "ready" | "partial" | "not_available";
    objectives: number;
    briefs: number;
    audiences: number;
    approved_assertions: number;
  };
  candidates: SignalMonthlyInsightCandidateV1[];
};

export type SignalMonthlyInsightJobDataV1 = {
  contract_version: "signal-monthly-insight-job-v1";
  output_id: string;
  requested_by_user_id: string;
  packet: SignalMonthlyInsightPacketV1;
  filters_hash: string;
  data_watermark_hash: string;
  idempotency_key: string;
  budget_cap_usd: number;
  prompt_version: typeof SIGNAL_MONTHLY_INSIGHT_PROMPT_VERSION;
  model_version: string;
};

export function signalMonthlyInsightIdempotencyKeyV1(input: {
  workspace_id: string;
  study_corpus_id: string;
  filters_hash: string;
  data_watermark_hash: string;
  candidate_hash: string;
  prompt_version: string;
  model_version: string;
}) {
  return signalMonthlyInsightCandidateHashV1(input);
}

export function validateSignalMonthlyInsightJobDataV1(
  input: SignalMonthlyInsightJobDataV1
) {
  if (input.contract_version !== "signal-monthly-insight-job-v1") {
    throw invalid("Unsupported monthly insight job contract.");
  }
  if (!input.packet.window || input.packet.candidates.length < 1 || input.packet.candidates.length > 7) {
    throw invalid("Monthly insight job requires between one and seven candidates.");
  }
  if (
    !Number.isFinite(input.budget_cap_usd)
    || input.budget_cap_usd <= 0
    || input.budget_cap_usd > SIGNAL_MONTHLY_INSIGHT_MAX_BUDGET_USD
  ) {
    throw invalid("Monthly insight budget is outside the approved range.");
  }
  if (input.packet.candidate_hash !== signalMonthlyInsightCandidateHashV1({
    window: {
      start: input.packet.window.start,
      end: input.packet.window.end
    },
    comparison_window: input.packet.comparison_window
      ? {
          start: input.packet.comparison_window.start,
          end: input.packet.comparison_window.end
        }
      : null,
    context: input.packet.context,
    items: input.packet.candidates
  })) {
    throw invalid("Monthly insight candidate packet hash is invalid.");
  }
  return input;
}

export function signalMonthlyInsightCandidateHashV1(input: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
}

export function validateSignalMonthlyInsightEditorialV1(
  input: unknown,
  expected: {
    candidate_hash: string;
    candidate_ids: string[];
  }
): SignalMonthlyInsightEditorialV1 {
  if (!input || typeof input !== "object") throw invalid("Monthly insight editorial must be an object.");
  const value = input as Partial<SignalMonthlyInsightEditorialV1>;
  if (value.contract_version !== SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION) {
    throw invalid("Unsupported monthly insight editorial contract.");
  }
  if (value.candidate_hash !== expected.candidate_hash) {
    throw invalid("Monthly insight editorial is stale for the current candidate packet.");
  }
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 7) {
    throw invalid("Monthly insight editorial requires between one and seven items.");
  }
  const allowedIds = new Set(expected.candidate_ids);
  const seenIds = new Set<string>();
  const seenPriorities = new Set<number>();
  const items = value.items.map((item, index) => {
    if (!item || typeof item !== "object") throw invalid("Monthly insight editorial item is invalid.", { index });
    if (!allowedIds.has(item.candidate_id) || seenIds.has(item.candidate_id)) {
      throw invalid("Monthly insight editorial references an unknown or duplicate candidate.", {
        index,
        candidate_id: item.candidate_id
      });
    }
    if (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > value.items!.length) {
      throw invalid("Monthly insight priority is outside the editorial set.", { index });
    }
    if (seenPriorities.has(item.priority)) {
      throw invalid("Monthly insight priorities must be unique.", { index });
    }
    if (!["high", "medium", "low"].includes(item.confidence)) {
      throw invalid("Monthly insight confidence is invalid.", { index });
    }
    const shortTitle = qualitativeText(item.short_title, "short_title", index);
    const explanation = qualitativeText(item.explanation, "explanation", index);
    const whyItMatters = qualitativeText(item.why_it_matters, "why_it_matters", index);
    const limitations = Array.isArray(item.limitations)
      ? item.limitations.map((text) => qualitativeText(text, "limitations", index)).filter(Boolean)
      : [];
    seenIds.add(item.candidate_id);
    seenPriorities.add(item.priority);
    return {
      candidate_id: item.candidate_id,
      priority: item.priority,
      short_title: shortTitle,
      explanation,
      why_it_matters: whyItMatters,
      confidence: item.confidence,
      limitations
    };
  });
  return {
    contract_version: SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION,
    candidate_hash: expected.candidate_hash,
    summary: qualitativeText(value.summary, "summary"),
    items: items.sort((left, right) => left.priority - right.priority)
  };
}

function qualitativeText(value: unknown, field: string, index?: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid("Monthly insight editorial text is required.", { field, index });
  }
  const text = value.trim();
  if (/\d/u.test(text)) {
    throw invalid(
      "Claude editorial text must stay qualitative; numeric facts are rendered from the canonical candidate packet.",
      { field, index }
    );
  }
  return text;
}

function invalid(message: string, details: Record<string, unknown> = {}) {
  return new SignalBackendContractError("not_available", message, details);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
