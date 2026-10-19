import { defineEngineMethodologySpec } from "./shared";

export const competitiveTbMatrix = defineEngineMethodologySpec({
  slug: "competitive-tb-matrix",
  unitKind: "tb_entity_cell",
  requiresCompetitors: true,
  minMentionsPerEntity: 30,
  dimensionSchema: {
    polarity: { type: "enum", values: ["trigger", "barrier", "mixed"] as const },
    layer: { type: "enum", values: ["psicologico", "personal", "social", "cultural"] as const },
    entity_share: { type: "number" },
    ownership: { type: "enum", values: ["brand_owned", "competitor_owned", "category_wide", "shared", "insufficient_evidence"] as const },
    differentiation_index: { type: "number" }
  },
  clientPromise: "Mostrar matriz densa trigger/barrier por entidad con dominancia, disputabilidad y evidencia insuficiente visible.",
  codingInstruction: "Solo clasifica polaridad y layer si viene de una unidad T&B; share, ownership y diferencial son deterministas.",
  charts: ["heatmap", "bar_ranking", "confidence_badge", "evidence_list"],
  qualityGates: ["cell_threshold_visible", "uses_tb_codings", "traceability", "confidence_calibrated"]
});
