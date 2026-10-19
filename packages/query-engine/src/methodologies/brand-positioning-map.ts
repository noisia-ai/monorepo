import { defineEngineMethodologySpec } from "./shared";

export const brandPositioningMap = defineEngineMethodologySpec({
  slug: "brand-positioning-map",
  unitKind: "positioning_attribute",
  requiresCompetitors: true,
  minMentionsPerEntity: 120,
  dimensionSchema: {
    attribute: { type: "text" },
    axis_value: { type: "number" },
    axis_pole: { type: "enum", values: ["premium", "accessible", "innovative", "traditional", "human", "technical", "unclear"] as const }
  },
  clientPromise: "Ubicar marcas en un mapa perceptual, detectar clusters indistinguibles y gaps defendibles.",
  codingInstruction: "Clasifica atributo y direccion perceptual en la unidad. El promedio de posicion lo calcula SQL.",
  charts: ["matrix_2x2", "radar", "bar_ranking", "evidence_list"],
  qualityGates: ["competitor_required", "attribute_evidence_required", "axis_defined", "confidence_calibrated"]
});
