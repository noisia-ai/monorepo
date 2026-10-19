import { defineEngineMethodologySpec } from "./shared";

export const audienceSegmentLens = defineEngineMethodologySpec({
  slug: "audience-segment-lens",
  unitKind: "segment_signal",
  requiresCompetitors: false,
  minMentionsPerEntity: 80,
  dimensionSchema: {
    segment: { type: "text" },
    wrapped_methodology: { type: "text" },
    metric: { type: "text" },
    polarity: { type: "enum", values: ["positive", "negative", "neutral", "mixed"] as const }
  },
  clientPromise: "Ver como cambian los hallazgos por segmento/audiencia sin duplicar la metodologia base.",
  codingInstruction: "Detecta segmento y metrica envuelta. Si el segmento es inferido debilmente, marca ambiguous.",
  charts: ["heatmap", "stacked_share", "bar_ranking", "evidence_list"],
  qualityGates: ["segment_source_required", "segment_skew_calibrated", "no_sensitive_inference", "confidence_calibrated"]
});
