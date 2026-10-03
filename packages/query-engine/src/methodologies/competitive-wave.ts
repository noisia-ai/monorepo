import { defineEngineMethodologySpec } from "./shared";

export const competitiveWave = defineEngineMethodologySpec({
  slug: "competitive-wave",
  unitKind: "entity_axis_signal",
  requiresCompetitors: true,
  minMentionsPerEntity: 150,
  dimensionSchema: {
    axis: { type: "enum", values: ["resonance", "cultural_ownership", "sentiment", "decision_velocity", "differentiation"] as const },
    direction: { type: "enum", values: ["positive", "negative", "mixed"] as const }
  },
  clientPromise: "Comparar entidades en una wave tipo mercado, mostrando quien lidera, quien reta y donde hay riesgo o whitespace.",
  codingInstruction: "Clasifica si la unidad sostiene un eje competitivo observable para una entidad; no calcules posiciones ni cuadrantes.",
  charts: ["wave_plot", "bar_ranking", "confidence_badge"],
  qualityGates: ["axis_balance", "competitor_required", "traceability", "confidence_calibrated"]
});
