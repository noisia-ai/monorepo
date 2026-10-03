import { defineEngineMethodologySpec } from "./shared";

export const journeyFrictionMapping = defineEngineMethodologySpec({
  slug: "journey-friction-mapping",
  unitKind: "journey_friction",
  requiresCompetitors: false,
  minMentionsPerEntity: 80,
  dimensionSchema: {
    journey_phase: { type: "enum", values: ["discover", "consider", "choose", "buy", "use", "renew", "leave"] as const },
    friction_type: { type: "enum", values: ["informational", "economic", "trust", "effort", "access", "social", "emotional"] as const },
    visibility: { type: "enum", values: ["articulable", "invisible", "mixed"] as const },
    polarity: { type: "enum", values: ["blocker", "accelerator"] as const }
  },
  clientPromise: "Identificar fases del journey donde la decision se traba o acelera, con quick wins y choke points por entidad.",
  codingInstruction: "Clasifica fase, tipo de friccion, visibilidad y polaridad. No priorices ni estimes impacto.",
  charts: ["heatmap", "waterfall", "bar_ranking", "evidence_list"],
  qualityGates: ["journey_phase_coverage", "traceability", "removability_not_assumed", "confidence_calibrated"]
});
