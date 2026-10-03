import { defineEngineMethodologySpec } from "./shared";

export const valuePerceptionMatrix = defineEngineMethodologySpec({
  slug: "value-perception-matrix",
  unitKind: "value_signal",
  requiresCompetitors: true,
  minMentionsPerEntity: 120,
  dimensionSchema: {
    value_benefit: { type: "enum", values: ["funcional", "emocional", "social", "aspiracional", "economico"] as const },
    value_cost: { type: "enum", values: ["monetario", "tiempo", "cognitivo", "social"] as const },
    perceived_value: { type: "enum", values: ["high", "medium", "low", "unclear"] as const }
  },
  clientPromise: "Mostrar que valor percibe la gente por entidad, que costo pesa mas y donde existe whitespace defendible.",
  codingInstruction: "Clasifica beneficio, costo y valor percibido desde lenguaje real; el score de celda y whitespace lo calcula SQL.",
  charts: ["heatmap", "matrix_2x2", "bar_ranking", "evidence_list"],
  qualityGates: ["balance_per_entity", "evidence_per_quadrant", "whitespace_has_absence_evidence", "confidence_calibrated"]
});
