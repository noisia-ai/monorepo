import type { EngineCodingPromptInput, EngineMethodologySpec } from "../engine";

type DefineEngineSpecArgs = Omit<EngineMethodologySpec, "buildCodingPrompt"> & {
  clientPromise: string;
  codingInstruction: string;
};

export function defineEngineMethodologySpec(args: DefineEngineSpecArgs): EngineMethodologySpec {
  return {
    slug: args.slug,
    unitKind: args.unitKind,
    requiresCompetitors: args.requiresCompetitors,
    requiresAuthorsMetadata: args.requiresAuthorsMetadata,
    minMentionsPerEntity: args.minMentionsPerEntity,
    dimensionSchema: args.dimensionSchema,
    charts: args.charts,
    qualityGates: args.qualityGates,
    buildCodingPrompt(input) {
      return buildStructuredCodingPrompt(args, input);
    }
  };
}

function buildStructuredCodingPrompt(spec: DefineEngineSpecArgs, input: EngineCodingPromptInput): string {
  return [
    `Rol: Eres un analista Noisia codificando ${spec.slug}.`,
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble. NO uses markdown fences. NO expliques fuera del JSON.",
    "",
    `Promesa cliente: ${spec.clientPromise}`,
    `Instruccion de codificacion: ${spec.codingInstruction}`,
    "No inventes conteos, shares, owners, rankings ni scores finales. SQL puntua despues.",
    "Si una unidad no contiene senal suficiente para esta metodologia, marca ambiguous=true y usa finding_key='insufficient_signal'.",
    "Cada coding publicable debe traer dimensions.signal_label: una frase humana, concreta y observada en el corpus.",
    "Idioma: usa el mismo idioma dominante del brief/unidades. Si el corpus esta en espanol, signal_label y dimensiones textuales deben estar en espanol natural.",
    "No traduzcas el lenguaje de usuarios mexicanos a etiquetas corporativas en ingles.",
    "No uses labels genericos como funcional, monetario, soporte o positivo como finding completo.",
    "No uses Title Case ni nombres de taxonomy como finding: evita frases como 'Brand Activation Event', 'Positive Experience', 'Social Amplification'.",
    "Un signal_label publicable debe poder leerse en una slide como insight pequeno: sujeto + tension/valor/friccion + contexto.",
    "Si solo puedes nombrar la celda de matriz, el tema amplio o la fuente, marca ambiguous=true.",
    "finding_key debe ser un slug estable derivado de signal_label, no solo de una celda de matriz.",
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
    "Dimension schema obligatorio:",
    JSON.stringify(spec.dimensionSchema, null, 2),
    "",
    "Contrato JSON obligatorio:",
    JSON.stringify(
      {
        codings: [
          {
            external_ref: "uuid_eco_de_la_unidad",
            finding_key: "stable_slug_from_observed_signal_label",
            dimensions: Object.fromEntries(
              [
                ["signal_label", "mas datos reales por peso como valor percibido"],
                ...Object.entries(spec.dimensionSchema).map(([key, value]) => [
                  key,
                  value.type === "enum" ? value.values[0] ?? "enum_value" : value.type === "number" ? 3 : "texto corto"
                ])
              ]
            ),
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
}
