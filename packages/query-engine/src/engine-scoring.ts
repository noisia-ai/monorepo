import type { Confidence, Ownership } from "./engine";

export function roundPct(value: number) {
  return Math.round(value * 1000) / 10;
}

export function confidenceFromMentions(count: number): Confidence {
  if (count >= 100) return "alta";
  if (count >= 30) return "media";
  return "baja_direccional";
}

export function classifyOwnership(args: {
  total: number;
  brandMentions: number;
  competitorMentions: number;
  categoryMentions: number;
  dominantSharePct: number;
}): Ownership {
  if (args.total < 2 || args.dominantSharePct < 35) return "insufficient_evidence";
  if (safeShare(args.brandMentions, args.total) >= 0.55) return "brand_owned";
  if (safeShare(args.competitorMentions, args.total) >= 0.55) return "competitor_owned";
  if (safeShare(args.categoryMentions, args.total) >= 0.45) return "category_wide";
  return "shared";
}

export function differentiationIndex(shareEntity: number, shareMaxOther: number) {
  return Math.round((shareEntity - shareMaxOther) * 1000) / 1000;
}

export function evidenceConfidence(args: {
  volume: number;
  distinctSources: number;
  sentimentVariance: number;
  newestAgeMonths: number;
  hasProtagonistQuote: boolean;
}): { confidence: Confidence; factors: Record<"volume" | "source_diversity" | "consistency" | "recency" | "citation_quality", number> } {
  const volume = args.volume >= 100 ? 1 : args.volume >= 30 ? 0.6 : 0.3;
  const sourceDiversity = clamp01(args.distinctSources / 3);
  const consistency = clamp01(1 - args.sentimentVariance);
  const recency = args.newestAgeMonths <= 6 ? 1 : args.newestAgeMonths <= 9 ? 0.6 : 0.3;
  const citationQuality = args.hasProtagonistQuote ? 1 : 0.4;
  const score =
    0.3 * volume +
    0.25 * sourceDiversity +
    0.2 * consistency +
    0.15 * recency +
    0.1 * citationQuality;

  return {
    confidence: score >= 0.75 ? "alta" : score >= 0.5 ? "media" : "baja_direccional",
    factors: {
      volume,
      source_diversity: sourceDiversity,
      consistency,
      recency,
      citation_quality: citationQuality
    }
  };
}

function safeShare(count: number, total: number) {
  return total > 0 ? count / total : 0;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
