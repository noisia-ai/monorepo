export * from "./tb";

export const QUERY_ENGINE_QUEUE_NAME = "noisia-query-engine";
export const QUERY_ENGINE_PIPELINE_VERSION = "query-engine-f2-1-mvp";
export const SAMPLE_EVALUATOR_PIPELINE_VERSION = "sample-evaluator-f2-2-mvp";
/** Default / minimum sample size for the first few iterations. */
export const SAMPLE_SIZE = 50;

/**
 * Adaptive sample size: as iterations accumulate the evaluator reads a larger
 * slice of the corpus so marginal improvements become detectable.
 *
 * Iter 1-3  → 100 mentions  (cost-safe, fast feedback)
 * Iter 4-6  → 250 mentions  (enough to distinguish signal from noise)
 * Iter 7+   → 500 mentions  (deep corpus diagnostic)
 */
export function getSampleSize(iterationNumber: number): number {
  if (iterationNumber >= 7) return 500;
  if (iterationNumber >= 4) return 250;
  return 100;
}

export type SampleMention = {
  id: string;
  text_snippet: string;
  platform: string;
  language: string | null;
  country: string | null;
  sentiment_source: string | null;
  quality_flags: Record<string, boolean>;
};

export type SampleEvaluationResult = {
  quality_score: number;
  density_score: number;
  noise_score: number;
  language_mx_pct: number;
  geo_mx_pct: number;
  notes: string;
  proposed_adjustments: string[];
};

export type SampleEvaluatorInput = {
  corpus: QueryComposerInput["corpus"];
  subject: QueryComposerInput["subject"];
  methodology: Pick<QueryComposerInput["methodology"], "slug" | "name">;
  query_text: string;
  sample: SampleMention[];
};

export function buildSampleEvaluatorPrompt(input: SampleEvaluatorInput): string {
  return [
    "Eres el Evaluador de Muestra del Engine de Noisia.",
    "Tu funcion es diagnosticar si la muestra de menciones produce senal cultural interpretable o solo volumen de ruido.",
    "No expliques teoria. Devuelve solo JSON valido.",
    "",
    "PRINCIPIO CLAVE: volumen no es senal. Una mencion tiene valor cuando revela tension, emocion, friccion, percepcion o codigo cultural — no cuando solo menciona una palabra clave.",
    "",
    "Criterios de puntuacion (0-10):",
    "- quality_score: relevancia cultural para la pregunta de negocio (0=nada relevante, 10=alta densidad cultural)",
    "- density_score: % estimado de menciones con senal real (>70%=excelente, 50-70%=bueno, 30-49%=debil, <30%=reconstruir)",
    "- noise_score: nivel de ruido en la muestra (10=todo ruido, 0=limpio) — se afecta por: letras/lirica, farandula/fandom, noticias sin interpretacion, spam/bots, contenido generico, menciones fuera de Mexico, listings de mercado, publicaciones de empleo, memes sin friccion, contenido IA autogenerado, quejas genericas sin angulo relevante",
    "- language_mx_pct: % de menciones en espanol mexicano informal (0-100)",
    "- geo_mx_pct: % de menciones con contexto geografico Mexico (0-100)",
    "- notes: diagnostico de 2-4 oraciones — que terminos del query capturan senal real, que causa el ruido, si la pregunta de negocio puede responderse con esta muestra",
    "- proposed_adjustments: lista de ajustes concretos y ejecutables al query booleano. Cada ajuste debe ser una instruccion especifica como: 'Agregar AND (\"frase trigger\")' o 'Remover termino X porque causa ruido Y' o 'Separar en dos queries: uno para A y otro para B' o 'Cambiar a Pattern B (seeded): agregar marca AND senal'",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        quality_score: 2,
        density_score: 2,
        noise_score: 9,
        language_mx_pct: 80,
        geo_mx_pct: 60,
        notes: "La muestra captura volumen pero no senal. El query es demasiado amplio: los brand seeds capturan menciones sin relacion con la pregunta de negocio. No se detectan triggers ni barriers de la categoria seguros. Se necesita anclar la query con frases de experiencia real de usuario.",
        proposed_adjustments: [
          "Agregar AND con frases de trigger: '(\"vale la pena\" OR \"me conviene\" OR \"sí cubre\" OR \"no cubre\")'",
          "Agregar AND con frases de barrier: '(\"es caro\" OR \"no me alcanza\" OR \"no entiendo la poliza\")'",
          "Remover terminos geograficos como 'Potosi' porque capturan ruido de San Luis Potosi y otras entidades no relacionadas con la marca"
        ]
      },
      null,
      2
    ),
    "",
    "Contexto del corpus:",
    JSON.stringify(
      {
        subject: input.subject,
        methodology: input.methodology,
        business_question: input.corpus.businessQuestion,
        audience_segment: input.corpus.audienceSegment,
        geo_focus: input.corpus.geoFocus,
        query_text: input.query_text
      },
      null,
      2
    ),
    "",
    `Muestra de ${input.sample.length} menciones (analiza cada una — no asumas que es senal por estar en la muestra):`,
    input.sample
      .map(
        (m, i) =>
          `[${i + 1}] platform=${m.platform} lang=${m.language ?? "?"} country=${m.country ?? "?"} sentiment=${m.sentiment_source ?? "?"}\n${m.text_snippet}`
      )
      .join("\n\n")
  ].join("\n");
}

/* ============================================================
   Corpus-level readiness assessment.
   Distinct from the per-iteration evaluator: takes a random sample
   ACROSS THE FULL CORPUS (all iterations combined) and decides if
   the methodology can already produce its target study with what's
   here, or whether more iteration is needed.
   ============================================================ */

export type CorpusAssessmentResult = {
  ready_for_study: boolean;
  confidence: number;
  verdict: "ready" | "needs_more_signal" | "needs_more_volume" | "corpus_too_noisy";
  coverage: {
    trigger_signal_pct: number;
    barrier_signal_pct: number;
    experience_signal_pct: number;
    noise_pct: number;
  };
  signals_well_covered: string[];
  signals_missing: string[];
  recommendation: string;
};

export type CorpusAssessmentInput = {
  corpus: QueryComposerInput["corpus"];
  subject: QueryComposerInput["subject"];
  methodology: Pick<QueryComposerInput["methodology"], "slug" | "name">;
  totalMentions: number;
  iterationsCount: number;
  sample: SampleMention[];
};

export function buildCorpusAssessmentPrompt(input: CorpusAssessmentInput): string {
  return [
    "Eres el Evaluador de Viabilidad del Corpus de Noisia.",
    "Tu tarea: decidir si este corpus acumulado tiene SUFICIENTE SEÑAL CULTURAL para generar el estudio de la metodologia seleccionada.",
    "No expliques teoria. Devuelve solo JSON valido.",
    "",
    "DIFERENCIA CRITICA — no estas evaluando una sola query: estas evaluando el corpus completo (mezcla de todas las iteraciones).",
    "El Insights Manager quiere saber: ¿con esto que tengo, puedo cerrar el estudio o necesito iterar mas?",
    "",
    "Criterio por metodologia:",
    "- Triggers & Barriers: necesitas suficientes menciones que expongan (a) razones por las que la gente compra/se mueve a la categoria (triggers) y (b) frenos/dolores que detienen la adopcion o continuidad (barriers). Una buena T&B reads 'percepciones reales en lenguaje del usuario', no menciones de noticias o farandula.",
    "- Brand Equity: necesitas menciones que muestren asociaciones de marca, comparaciones con competidores, atributos vividos.",
    "- Cultural Listening: necesitas tension cultural, codigos, contradicciones, no datos planos.",
    "",
    "Reglas de decision:",
    "- ready_for_study = true SOLO si density_score real (% menciones con señal interpretable) >= 40% y hay cobertura de los signal types clave de la metodologia.",
    "- Si tienes mucho volumen pero baja densidad (mucho ruido) → verdict='corpus_too_noisy'",
    "- Si tienes alta densidad pero poco volumen (<500 con señal) → verdict='needs_more_volume'",
    "- Si tienes volumen y densidad ok pero faltan tipos de señal clave → verdict='needs_more_signal'",
    "- ready → verdict='ready'",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        ready_for_study: false,
        confidence: 75,
        verdict: "needs_more_signal",
        coverage: {
          trigger_signal_pct: 25,
          barrier_signal_pct: 45,
          experience_signal_pct: 35,
          noise_pct: 40
        },
        signals_well_covered: [
          "barreras de costo: 'no me alcanza', 'es muy caro'",
          "frustracion con ajustadores: 'no me pagaron', 'tardaron'"
        ],
        signals_missing: [
          "triggers positivos de compra (por que SI contrataron)",
          "comparaciones con competidores nombrados",
          "experiencias de renovacion exitosa"
        ],
        recommendation: "Hay barreras suficientes pero faltan triggers. Recomendar query enfocada en momentos de decision de compra: 'me recomendaron', 'compare con', 'al final elegi'. Una iteracion mas deberia bastar."
      },
      null,
      2
    ),
    "",
    "Contexto del estudio:",
    JSON.stringify(
      {
        methodology: input.methodology,
        business_question: input.corpus.businessQuestion,
        subject: { type: input.subject.type, name: input.subject.name, industry: input.subject.industry },
        audience_segment: input.corpus.audienceSegment,
        total_mentions_in_corpus: input.totalMentions,
        iterations_run: input.iterationsCount
      },
      null,
      2
    ),
    "",
    `Muestra aleatoria de ${input.sample.length} menciones del corpus completo (analiza la composicion general, no menciones individuales):`,
    input.sample
      .map(
        (m, i) =>
          `[${i + 1}] platform=${m.platform} lang=${m.language ?? "?"} country=${m.country ?? "?"} sentiment=${m.sentiment_source ?? "?"}\n${m.text_snippet}`
      )
      .join("\n\n")
  ].join("\n");
}

export function parseCorpusAssessmentJson(raw: string): CorpusAssessmentResult {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as Partial<CorpusAssessmentResult>;
  const verdict = (["ready", "needs_more_signal", "needs_more_volume", "corpus_too_noisy"] as const).includes(
    parsed.verdict as never
  )
    ? (parsed.verdict as CorpusAssessmentResult["verdict"])
    : "needs_more_signal";
  return {
    ready_for_study: Boolean(parsed.ready_for_study),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
    verdict,
    coverage: {
      trigger_signal_pct: parsed.coverage?.trigger_signal_pct ?? 0,
      barrier_signal_pct: parsed.coverage?.barrier_signal_pct ?? 0,
      experience_signal_pct: parsed.coverage?.experience_signal_pct ?? 0,
      noise_pct: parsed.coverage?.noise_pct ?? 0
    },
    signals_well_covered: Array.isArray(parsed.signals_well_covered) ? parsed.signals_well_covered : [],
    signals_missing: Array.isArray(parsed.signals_missing) ? parsed.signals_missing : [],
    recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : ""
  };
}

export function parseSampleEvaluationJson(raw: string): SampleEvaluationResult {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<SampleEvaluationResult>;

  return {
    quality_score: clamp(Number(parsed.quality_score ?? 5), 0, 10),
    density_score: clamp(Number(parsed.density_score ?? 5), 0, 10),
    noise_score: clamp(Number(parsed.noise_score ?? 5), 0, 10),
    language_mx_pct: clamp(Number(parsed.language_mx_pct ?? 50), 0, 100),
    geo_mx_pct: clamp(Number(parsed.geo_mx_pct ?? 50), 0, 100),
    notes: typeof parsed.notes === "string" ? parsed.notes : "Sin notas.",
    proposed_adjustments: Array.isArray(parsed.proposed_adjustments)
      ? parsed.proposed_adjustments.filter((a): a is string => typeof a === "string")
      : []
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export type QueryComposerInput = {
  corpus: {
    id: string;
    name: string | null;
    businessQuestion: string | null;
    decisionToInform: string | null;
    audienceSegment: string | null;
    geoFocus: string[];
    targetWindowMonths: number | null;
    contextForm: unknown;
  };
  subject: {
    type: "brand" | "theme";
    name: string;
    slug: string;
    industry: string | null;
    industrySub: string | null;
    countries: string[];
    brandSeedHandles: string[];
    description: string | null;
  };
  methodology: {
    slug: string;
    name: string;
    version: string;
    manifest: MethodologyManifest;
  };
  competitors: string[];
  brandSeeds: string[];
  knowledgeSources: MemoryRecord[];
  memoryIndustry: MemoryRecord[];
  memoryBrand: MemoryRecord[];
};

export type MethodologyManifest = {
  signal_phrases?: {
    triggers_generic?: string[];
    barriers_generic?: string[];
  };
  global_exclusions?: string[];
  engine_validation_prompt?: string;
  inputs?: {
    corpus?: {
      minimum_viable?: number;
      ideal?: number;
      maximum_useful?: number;
    };
  };
};

export type MemoryRecord = {
  type: string;
  content: unknown;
};

export type ComposedQuery = {
  query_text: string;
  /** Competitor/peer-set query — competitor seeds + same signal frame — for explicit competitive benchmarking. */
  competitor_query_text?: string;
  /** Broader industry/category query — no brand constraint — for context and benchmarking. */
  industry_query_text?: string;
  query_components: {
    brand_seeds: string[];
    competitor_seeds: string[];
    category_seeds: string[];
    trigger_phrases_tb: string[];
    barrier_phrases_tb: string[];
    knowledge_query_language?: string[];
    knowledge_potential_triggers?: string[];
    knowledge_potential_barriers?: string[];
    global_exclusions: string[];
    knowledge_sources?: MemoryRecord[];
    memory_industry: MemoryRecord[];
    memory_brand: MemoryRecord[];
    model?: string;
    fallback_used?: boolean;
    fallback_reason?: string;
  };
};

export function buildQueryComposerPrompt(input: QueryComposerInput) {
  const components = buildQueryComponents(input);

  return [
    "Eres el Engine de Validacion de Queries de Noisia.",
    "Tu tarea es componer una query booleana para SentiOne que capture SENAL CULTURAL, no volumen.",
    "No expliques teoria. Devuelve solo JSON valido.",
    "",
    "PRINCIPIO: las personas no buscan cultura, la viven. La query debe capturar el lenguaje que usan mientras la viven.",
    "No maximices menciones. Maximiza menciones interpretables.",
    "",
    "Knowledge Base:",
    "- Puede incluir brief de estudio, documentos de marca, social archives, search data o exports de scrapers.",
    "- Usalo como CONTEXTO para entender lenguaje, tensiones, competidores y ruido probable.",
    "- No copies claims internos si no son lenguaje que un consumidor diria.",
    "- Si la fuente sugiere frases buscables, traducelas a lenguaje real de plataforma antes de meterlas a la query.",
    "",
    "Escalera de traduccion cultural (aplica siempre):",
    "Concepto estrategico → Espanol llano → Espanol mexicano informal → Expresion nativa de plataforma → Frase buscable",
    "Ejemplo: 'barreras de adopcion de seguros' → 'no lo entienden' → 'para que me sirve' / 'es muy caro' → '¿para que me sirve el seguro?' → 'para que sirve' AND (marca OR seguro)",
    "",
    "Patrones de query disponibles — elige el mas apropiado:",
    "- Patron A (escucha cultural abierta): solo frases de senal, sin semilla de marca",
    "- Patron B (seeded brand): (marcas) AND (frases de senal) — usa cuando toda mencion DEBE tener contexto de marca",
    "- Patron C (categoria + senal): (terminos de categoria) AND (frases de senal) — cuando la lista de marcas es incompleta",
    "- Patron D (con exclusion): (senal) AND (contexto) NOT (termino ruidoso) — solo agrega NOT despues de confirmar el ruido",
    "- Patron E (evidencia): frases muy especificas de alta densidad — para mining de citas interpretables",
    "",
    "Reglas de construccion:",
    "- Prefiere frases sobre palabras sueltas.",
    "- No uses lenguaje de consultor en la query (pon 'no me alcanza', no 'barrera economica').",
    "- Incluye variantes de acento y sin acento para la marca.",
    "- Incluye handles sociales si existen.",
    "- Los exclusions van SOLO cuando hay ruido real identificado.",
    "- Si el nombre de la marca es ambiguo, agrega exclusiones geograficas o categoriales.",
    "",
    SENTIONE_LQL_RULES,
    "",
    "OBLIGATORIO — Produce SIEMPRE tres queries distintas. Si omites cualquiera, la respuesta sera RECHAZADA:",
    "1. query_text (Query de Marca): incluye SOLO semillas de marca principal + frases de senal. Alta precision. Captura solo conversaciones donde la marca esta presente.",
    "2. competitor_query_text (Query de Competencia): incluye SOLO competidores nombrados + mismas frases de senal. No incluye la marca principal. Captura comparacion y tensiones del peer set.",
    "3. industry_query_text (Query de Industria): sin semillas de marca ni competidores. Usa solo terminos de categoria + frases de senal. Alta cobertura. Captura el contexto de la industria y el mercado total.",
    "No son interchangeables. Marca diagnostica la marca, competencia benchmarkea el peer set, industria mide contexto cultural amplio.",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        query_text: "((\"Marca\" OR \"@Marca\")) AND ((\"frase senal\")) NOT (\"ruido\")",
        competitor_query_text: "((\"Competidor 1\" OR \"Competidor 2\")) AND ((\"frase senal\")) NOT (\"ruido\")",
        industry_query_text: "((\"categoria\" OR \"termino industria\")) AND ((\"frase senal\"))",
        query_components: {
          brand_seeds: ["..."],
          competitor_seeds: ["..."],
          category_seeds: ["..."],
          trigger_phrases_tb: ["..."],
          barrier_phrases_tb: ["..."],
          global_exclusions: ["..."]
        }
      },
      null,
      2
    ),
    "",
    "Input:",
    JSON.stringify(
      {
        corpus: input.corpus,
        knowledge_base: input.knowledgeSources,
        subject: input.subject,
        methodology: {
          slug: input.methodology.slug,
          name: input.methodology.name,
          version: input.methodology.version,
          engine_validation_prompt: input.methodology.manifest.engine_validation_prompt
        },
        components
      },
      null,
      2
    )
  ].join("\n");
}

export type EvaluationHistoryEntry = {
  iteration_number: number;
  query_text: string;
  quality_score: number;
  density_score: number;
  noise_score: number;
  notes: string;
  proposed_adjustments: string[];
};

export function buildQueryRefinementPrompt(params: {
  previousQueryText: string;
  proposedAdjustments: string[];
  evaluation: { quality_score: number; density_score: number; noise_score: number; notes: string };
  subject: QueryComposerInput["subject"];
  corpus: QueryComposerInput["corpus"];
  methodology: Pick<QueryComposerInput["methodology"], "slug" | "name">;
  /** All previous evaluated iterations — oldest first — so Claude can see the full arc. */
  evaluationHistory?: EvaluationHistoryEntry[];
  /** Optional free-form user instructions to apply on top of the diagnostic. */
  userComments?: string;
}): string {
  return [
    "Eres el Engine de Validacion de Queries de Noisia.",
    "Tu tarea es refinar una query booleana de SentiOne a partir de los ajustes diagnosticados por el evaluador de muestra.",
    "Esta es una iteracion de refinamiento (v2 precision o v3 evidencia). Reduce ruido, aumenta densidad de senal.",
    "No expliques teoria. Devuelve solo JSON valido.",
    "",
    "PRINCIPIO: esta version debe tener MENOS terminos que la anterior, MEJOR anclados a senal cultural real.",
    "No agregar keywords por si acaso. Cada termino debe sobrevivir la prueba de compresion.",
    "",
    SENTIONE_LQL_RULES,
    "",
    "Escalera de traduccion: concepto estrategico → espanol llano → espanol mexicano informal → frase buscable.",
    "Aplica solo los ajustes propuestos. No reescribas todo si no es necesario.",
    "",
    "OBLIGATORIO — Produce SIEMPRE tres queries refinadas. Si omites cualquiera, la respuesta sera RECHAZADA:",
    "1. query_text (Query de Marca): refinada con los ajustes aplicados. Mantiene semillas de marca + frases de señal.",
    "2. competitor_query_text (Query de Competencia): usa competidores nombrados + la misma tematica/señal. NO incluye la marca principal.",
    "3. industry_query_text (Query de Industria): MISMA tematica de la marca pero SIN semillas de marca ni competidores. Solo terminos de categoria + frases de señal. Captura el mercado total.",
    "Las tres queries son independientes y miden cosas distintas — generar solo una invalida la iteracion.",
    "",
    "Formato JSON obligatorio — mismo schema:",
    JSON.stringify(
      {
        query_text: "((\"Marca\")) AND ((\"frase senal\")) NOT (\"ruido\")",
        competitor_query_text: "((\"Competidor\")) AND ((\"frase senal\")) NOT (\"ruido\")",
        industry_query_text: "((\"categoria\")) AND ((\"frase senal\"))",
        query_components: {
          brand_seeds: ["..."],
          competitor_seeds: ["..."],
          category_seeds: ["..."],
          trigger_phrases_tb: ["..."],
          barrier_phrases_tb: ["..."],
          global_exclusions: ["..."]
        }
      },
      null,
      2
    ),
    "",
    ...(params.evaluationHistory && params.evaluationHistory.length > 1
      ? [
          "HISTORIAL DE ITERACIONES (mas antigua → mas reciente):",
          "Usa este historial para entender QUE SE HA INTENTADO ANTES y POR QUE NO FUNCIONÓ.",
          "No repitas ajustes que ya se intentaron y fallaron.",
          params.evaluationHistory
            .map(
              (h) =>
                `Iteracion #${h.iteration_number} · Q:${h.quality_score} D:${h.density_score} N:${h.noise_score}\n` +
                `Query: ${h.query_text.slice(0, 200)}${h.query_text.length > 200 ? "…" : ""}\n` +
                `Notas: ${h.notes}\n` +
                (h.proposed_adjustments.length > 0
                  ? `Ajustes propuestos: ${h.proposed_adjustments.slice(0, 3).join(" | ")}`
                  : "Sin ajustes propuestos")
            )
            .join("\n\n"),
          ""
        ]
      : []),
    "Query a refinar:",
    params.previousQueryText,
    "",
    "Diagnostico actual del evaluador:",
    JSON.stringify(params.evaluation, null, 2),
    "",
    "Ajustes a aplicar en esta iteracion:",
    params.proposedAdjustments.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    "",
    ...(params.userComments && params.userComments.trim().length > 0
      ? [
          "INSTRUCCIONES ADICIONALES DEL ANALISTA (prioridad maxima — aplicar literalmente):",
          params.userComments.trim(),
          ""
        ]
      : []),
    "Contexto:",
    JSON.stringify({ subject: params.subject, corpus: params.corpus, methodology: params.methodology }, null, 2)
  ].join("\n");
}

/** Constraints reused by every prompt that emits a SentiOne LQL query. */
export const SENTIONE_LQL_RULES = [
  "REGLAS DE SINTAXIS SENTIONE LQL (CRITICAS — SentiOne RECHAZA queries que las violan):",
  "- PROHIBIDO usar operadores de campo: NO uses 'country:', 'lang:', 'language:', 'platform:', 'site:', 'from:', 'date:', 'author:', 'url:'.",
  "- NO uses 'AND (country:MX)' — SentiOne devuelve error de sintaxis. El filtro geografico va en la UI de SentiOne, no en la query.",
  "- NO uses 'AND (lang:es)' por la misma razon. Para limitar a espanol mexicano, agrega frases idiomaticas mexicanas (ej. 'pinche', 'chinga', '¿que onda?', 'no manches', 'wey').",
  "- La query SOLO debe contener: frases entre comillas dobles, operadores AND/OR/NOT en MAYUSCULAS, parentesis para agrupar.",
  "- Usa el operador NEAR/n entre frases solo si es esencial (ej. 'seguro' NEAR/3 'caro').",
  "- Si necesitas filtrar geografia/idioma, hazlo via terminos de la query (ej. menciones de ciudades mexicanas, modismos), no via operadores de campo."
].join("\n");

export function buildFallbackQuery(input: QueryComposerInput): ComposedQuery {
  const components = buildQueryComponents(input);
  const brandClause = quoteAny([...components.brand_seeds, input.subject.name]);
  const competitorClause = quoteAny(components.competitor_seeds);
  const categoryClause = quoteAny(components.category_seeds);
  const triggerClause = quoteAny(components.trigger_phrases_tb);
  const barrierClause = quoteAny([...components.barrier_phrases_tb, ...(components.knowledge_query_language ?? [])]);
  const exclusions = quoteAny(components.global_exclusions);

  const subjectClause = brandClause.length > 0 ? `((${brandClause}))` : `((${categoryClause}))`;
  const signalClause = `((${triggerClause}) OR (${barrierClause}))`;
  const exclusionClause = exclusions.length > 0 ? ` NOT (${exclusions})` : "";

  return {
    query_text: `${subjectClause} AND ${signalClause}${exclusionClause}`,
    competitor_query_text:
      competitorClause.length > 0
        ? `((${competitorClause})) AND ${signalClause}${exclusionClause}`
        : undefined,
    industry_query_text:
      categoryClause.length > 0
        ? `((${categoryClause})) AND ${signalClause}${exclusionClause}`
        : undefined,
    query_components: {
      ...components,
      fallback_used: true
    }
  };
}

export function parseComposedQueryJson(raw: string, input: QueryComposerInput, model: string): ComposedQuery {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as Partial<ComposedQuery>;
  const fallback = buildFallbackQuery(input);

  if (!parsed.query_text || typeof parsed.query_text !== "string") {
    return fallback;
  }

  return {
    query_text: parsed.query_text,
    competitor_query_text:
      typeof parsed.competitor_query_text === "string" && parsed.competitor_query_text.length > 0
        ? parsed.competitor_query_text
        : fallback.competitor_query_text,
    industry_query_text:
      typeof parsed.industry_query_text === "string" && parsed.industry_query_text.length > 0
        ? parsed.industry_query_text
        : fallback.industry_query_text,
    query_components: {
      ...fallback.query_components,
      ...(parsed.query_components ?? {}),
      model,
      fallback_used: false
    }
  };
}

function buildQueryComponents(input: QueryComposerInput) {
  const signalPhrases = input.methodology.manifest.signal_phrases ?? {};
  const categorySeeds = compact([
    input.subject.industry,
    input.subject.industrySub,
    input.subject.industry ? `${input.subject.industry} mexico` : null,
    input.subject.industry ? `${input.subject.industry} opiniones` : null
  ]);
  const memoryExclusions = extractMemoryStrings(input.memoryIndustry, "exclusion");
  const memoryBrandSeeds = extractMemoryStrings(input.memoryIndustry, "brand_seed");

  return {
    brand_seeds: unique(compact([...input.brandSeeds, ...input.subject.brandSeedHandles, ...memoryBrandSeeds])),
    competitor_seeds: unique(input.competitors),
    category_seeds: unique(categorySeeds),
    trigger_phrases_tb: unique(signalPhrases.triggers_generic ?? []),
    barrier_phrases_tb: unique(signalPhrases.barriers_generic ?? []),
    knowledge_query_language: unique(extractKnowledgeStrings(input.knowledgeSources, "query_language")),
    knowledge_potential_triggers: unique(extractKnowledgeStrings(input.knowledgeSources, "potential_triggers")),
    knowledge_potential_barriers: unique(extractKnowledgeStrings(input.knowledgeSources, "potential_barriers")),
    global_exclusions: unique([...(input.methodology.manifest.global_exclusions ?? []), ...memoryExclusions]),
    memory_industry: input.memoryIndustry,
    memory_brand: input.memoryBrand
  };
}

function extractKnowledgeStrings(records: MemoryRecord[], key: string) {
  return records.flatMap((record) => {
    if (!record.content || typeof record.content !== "object") return [];
    const value = (record.content as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  });
}

function extractMemoryStrings(records: MemoryRecord[], key: string) {
  return records.flatMap((record) => {
    if (record.type !== key && record.type !== "query_pattern") {
      return [];
    }

    if (Array.isArray(record.content)) {
      return record.content.filter((item): item is string => typeof item === "string");
    }

    if (record.content && typeof record.content === "object") {
      const value = (record.content as Record<string, unknown>)[key] ?? (record.content as Record<string, unknown>).terms;
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    }

    return [];
  });
}

function quoteAny(values: string[]) {
  return unique(values)
    .filter((value) => value.length > 0)
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(" OR ");
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function compact(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}
