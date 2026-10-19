import { defineEngineMethodologySpec } from "./shared";

export const culturalCodesDecoding = defineEngineMethodologySpec({
  slug: "cultural-codes-decoding",
  unitKind: "cultural_code",
  requiresCompetitors: false,
  minMentionsPerEntity: 80,
  dimensionSchema: {
    code_level: { type: "enum", values: ["surface", "emerging", "deep"] as const },
    binary_opposition: { type: "text" },
    maturity: { type: "enum", values: ["nascent", "active", "dominant", "declining"] as const },
    valence: { type: "enum", values: ["positive", "negative", "ambivalent"] as const }
  },
  clientPromise: "Decodificar codigos culturales de categoria y marca, tensiones activas y whitespace narrativo.",
  codingInstruction: "Detecta codigo, oposicion cultural y madurez desde texto largo. No fuerces teoria si no aparece en corpus.",
  charts: ["tension_card", "heatmap", "bar_ranking", "evidence_list"],
  qualityGates: ["codes_emerge_from_corpus", "long_quote_evidence", "no_theory_recitation", "confidence_calibrated"]
});
