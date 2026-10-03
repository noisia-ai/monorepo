import { defineEngineMethodologySpec } from "./shared";

export const sentimentAdvocacyProxy = defineEngineMethodologySpec({
  slug: "sentiment-advocacy-proxy",
  unitKind: "advocacy_signal",
  requiresCompetitors: true,
  minMentionsPerEntity: 120,
  dimensionSchema: {
    sentiment: { type: "enum", values: ["positive", "neutral", "negative"] as const },
    emotional_intensity: { type: "number" },
    theme: { type: "text" },
    advocacy_class: { type: "enum", values: ["promoter", "passive", "detractor"] as const }
  },
  clientPromise: "Construir proxy de advocacy/NPS desde corpus social: promotores, pasivos, detractores y drivers por entidad.",
  codingInstruction: "Clasifica sentimiento, intensidad, tema y clase de advocacy. No calcules NPS; SQL agregara el proxy.",
  charts: ["diverging_bar", "stacked_share", "timeline", "evidence_list"],
  qualityGates: ["sentiment_source_present", "driver_evidence_required", "no_survey_claim", "confidence_calibrated"]
});
