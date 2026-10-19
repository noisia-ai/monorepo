import { defineEngineMethodologySpec } from "./shared";

export const evidenceConfidenceLayer = defineEngineMethodologySpec({
  slug: "evidence-confidence-layer",
  unitKind: "confidence_audit",
  requiresCompetitors: false,
  minMentionsPerEntity: 1,
  dimensionSchema: {
    volume: { type: "number" },
    source_diversity: { type: "number" },
    consistency: { type: "number" },
    recency: { type: "number" },
    citation_quality: { type: "number" }
  },
  clientPromise: "Hacer visible por que cada finding/chart merece alta, media o baja confianza.",
  codingInstruction: "Audita solo calidad de evidencia cuando venga de source chunks; los factores numericos finales son deterministas.",
  charts: ["confidence_badge", "bar_ranking", "evidence_list"],
  qualityGates: ["traceability", "confidence_calibrated", "limitations_section"]
});
