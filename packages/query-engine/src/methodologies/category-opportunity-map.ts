import { defineEngineMethodologySpec } from "./shared";

export const categoryOpportunityMap = defineEngineMethodologySpec({
  slug: "category-opportunity-map",
  unitKind: "category_need",
  requiresCompetitors: true,
  minMentionsPerEntity: 100,
  dimensionSchema: {
    need: { type: "text" },
    demand_strength: { type: "number" },
    coverage: { type: "enum", values: ["unserved", "underserved", "served", "overcrowded"] as const },
    urgency: { type: "enum", values: ["low", "medium", "high"] as const }
  },
  clientPromise: "Priorizar oportunidades de categoria por demanda no atendida, cobertura competitiva y urgencia.",
  codingInstruction: "Detecta necesidad, fuerza, cobertura y urgencia desde evidencia. No declares oportunidad final sin ausencia/cobertura.",
  charts: ["bubble_field", "bar_ranking", "matrix_2x2", "evidence_list"],
  qualityGates: ["demand_evidence_required", "coverage_evidence_required", "best_positioned_not_assumed", "confidence_calibrated"]
});
