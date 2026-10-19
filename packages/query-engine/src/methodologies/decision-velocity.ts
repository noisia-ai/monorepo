import { defineEngineMethodologySpec } from "./shared";

export const decisionVelocity = defineEngineMethodologySpec({
  slug: "decision-velocity",
  unitKind: "decision_factor",
  requiresCompetitors: false,
  minMentionsPerEntity: 100,
  dimensionSchema: {
    decision_phase: { type: "enum", values: ["triggered", "researching", "comparing", "deciding", "postponing", "abandoning"] as const },
    cognitive_system: { type: "enum", values: ["system_1", "system_2", "social_proof", "habit"] as const },
    factor: { type: "text" },
    polarity: { type: "enum", values: ["blocker", "accelerator"] as const }
  },
  clientPromise: "Entender que acelera o bloquea la decision por fase para disenar arquitectura de decision.",
  codingInstruction: "Clasifica fase, sistema cognitivo, factor y polaridad. No afirmes velocity score; SQL agrega despues.",
  charts: ["timeline", "waterfall", "heatmap", "evidence_list"],
  qualityGates: ["decision_language_required", "no_future_projection", "traceability", "confidence_calibrated"]
});
