import { defineEngineMethodologySpec } from "./shared";

export const influenceArchitecture = defineEngineMethodologySpec({
  slug: "influence-architecture",
  unitKind: "influence_signal",
  requiresCompetitors: true,
  requiresAuthorsMetadata: true,
  minMentionsPerEntity: 150,
  dimensionSchema: {
    node_role: { type: "enum", values: ["originator", "amplifier", "translator", "skeptic", "authority", "bridge"] as const },
    community: { type: "text" },
    tie_type: { type: "enum", values: ["endorsement", "critique", "translation", "comparison", "question"] as const }
  },
  clientPromise: "Mapear nodos, comunidades y puntos de traduccion donde se mueve la influencia por entidad.",
  codingInstruction: "Clasifica rol, comunidad y tipo de lazo observable. La centralidad y comunidades finales se calculan fuera del LLM.",
  charts: ["force_graph", "bar_ranking", "sankey_flow", "evidence_list"],
  qualityGates: ["author_metadata_required", "community_traceability", "no_influence_without_source", "confidence_calibrated"]
});
