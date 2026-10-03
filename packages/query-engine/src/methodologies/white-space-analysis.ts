import { defineEngineMethodologySpec } from "./shared";

export const whiteSpaceAnalysis = defineEngineMethodologySpec({
  slug: "white-space-analysis",
  unitKind: "whitespace_signal",
  requiresCompetitors: true,
  minMentionsPerEntity: 120,
  dimensionSchema: {
    demand: { type: "text" },
    competitive_coverage: { type: "enum", values: ["low", "medium", "high", "unclear"] as const },
    brand_permission: { type: "enum", values: ["strong", "moderate", "weak", "none"] as const },
    whitespace_score_hint: { type: "number" }
  },
  clientPromise: "Detectar espacios no ocupados con demanda real, ausencia competitiva y permiso de marca.",
  codingInstruction: "Marca demanda, cobertura y permiso. Whitespace sin evidencia de ausencia debe quedar ambiguous.",
  charts: ["bubble_field", "matrix_2x2", "bar_ranking", "evidence_list"],
  qualityGates: ["demand_and_absence_evidence", "brand_permission_evidence", "no_conjecture_whitespace", "confidence_calibrated"]
});
