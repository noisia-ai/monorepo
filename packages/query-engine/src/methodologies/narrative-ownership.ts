import type { EngineMethodologySpec } from "../engine";

export const narrativeOwnership: EngineMethodologySpec = {
  slug: "narrative-ownership",
  unitKind: "narrative",
  requiresCompetitors: true,
  minMentionsPerEntity: 150,
  dimensionSchema: {
    narrative: { type: "text" },
    valence: { type: "enum", values: ["positiva", "negativa", "neutra"] as const }
  },
  buildCodingPrompt(input) {
    return [
      "Rol: Eres un analista Noisia codificando Narrative Ownership.",
      "",
      "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
      "NO escribas preamble. NO uses markdown fences. NO expliques fuera del JSON.",
      "",
      "Objetivo: asignar cada unidad a una narrativa emergente del corpus y su valencia.",
      "No inventes conteos, shares, owners ni rankings. Solo clasifica la unidad.",
      "La narrativa debe nacer del lenguaje del corpus, no de una taxonomia impuesta.",
      "Si la unidad no contiene senal narrativa suficiente, marca ambiguous=true y usa finding_key='insufficient_signal'.",
      "Cada coding publicable debe traer dimensions.signal_label: una frase humana y concreta que pueda leerse como finding.",
      "Idioma: usa el mismo idioma dominante del brief/unidades. Si el corpus esta en espanol, signal_label y narrativa deben estar en espanol natural.",
      "No traduzcas el lenguaje de usuarios mexicanos a etiquetas corporativas en ingles.",
      "No repitas etiquetas genericas si el lenguaje del corpus permite una lectura mas especifica.",
      "No uses Title Case ni nombres de taxonomy como finding: evita frases como 'Brand Activation Event', 'Positive Experience', 'Social Amplification'.",
      "Un signal_label publicable debe poder leerse en una slide como insight pequeno: sujeto + tension/valor/friccion + contexto.",
      "Si solo puedes nombrar la fuente, la campana o un tema amplio, marca ambiguous=true.",
      "finding_key debe ser un slug estable derivado de signal_label.",
      "",
      "Contexto:",
      JSON.stringify(
        {
          brand_name: input.brandName,
          business_question: input.businessQuestion,
          params: input.params,
          rag_context: input.ragContext ?? null
        },
        null,
        2
      ),
      "",
      "Dimensiones obligatorias por coding:",
      JSON.stringify(
        {
          narrative: "texto corto en lenguaje de la categoria",
          valence: "positiva | negativa | neutra"
        },
        null,
        2
      ),
      "",
      "Contrato JSON obligatorio:",
      JSON.stringify(
        {
          codings: [
            {
              external_ref: "uuid_eco_de_la_unidad",
              finding_key: "red_sin_letras_chiquitas_como_promesa_confiable",
              dimensions: {
                signal_label: "red sin letras chiquitas como promesa confiable",
                narrative: "precio sin trucos",
                valence: "positiva"
              },
              intensity: 4,
              span: "fragmento textual de <=400 chars",
              ambiguous: false
            }
          ]
        },
        null,
        2
      ),
      "",
      `Unidades (${input.units.length}):`,
      input.units
        .map((unit, index) =>
          [
            `[${index + 1}] external_ref=${unit.external_ref}`,
            `entity_hint=${unit.entity_hint ?? "unknown"} platform=${unit.platform ?? "unknown"} published_at=${unit.published_at ?? "unknown"}`,
            unit.text.slice(0, 1600)
          ].join("\n")
        )
        .join("\n\n")
    ].join("\n");
  },
  charts: ["stacked_share", "matrix_2x2", "bar_ranking"],
  qualityGates: ["narrative_emergent_not_imposed", "owned_negative_flagged"]
};
