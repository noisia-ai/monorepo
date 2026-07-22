import {
  PORTABLE_LISTEN_QUERY_DIALECT_VERSION,
  validatePortableListenQuery,
  type PortableListenQueryValidation
} from "./listen-query-language";
import {
  buildQueryConstructionPlan,
  resolveQueryConstructionMode,
  validateConstructedQuery,
  type QueryCompetitorEntity,
  type QueryConstructionInput,
  type QueryConstructionMode,
  type QueryConstructionPlan,
  type QueryConstructionScope,
  type QuerySemanticValidation
} from "./query-construction";

export * from "./tb";
export * from "./semantic-rag";
export * from "./engine";
export * from "./engine-coding";
export * from "./engine-retrieval";
export * from "./engine-scoring";
export * from "./engine-aggregation";
export * from "./engine-signal-block";
export * from "./engine-lens-budget";
export * from "./lens-query-packs";
export * from "./lens-coverage";
export * from "./signal-pulse";
export * from "./data-os";
export * from "./source-observations";
export * from "./source-materialization-contract";
export * from "./listening-data-os";
export * from "./data-os-capabilities";
export * from "./tb-data-os-bridge-quality";
export * from "./data-os-corpus-audit";
export * from "./data-os-metric-catalog";
export * from "./signal-backend-v1";
export * from "./signal-refresh-v1";
export * from "./query-pack-evaluation";
export * from "./listen-query-language";
export * from "./query-construction";
export * from "./corpus-assessment";
export * from "./methodologies/registry";
export * from "./methodologies/narrative-ownership";

export const QUERY_ENGINE_QUEUE_NAME = "noisia-query-engine";
export const QUERY_ENGINE_PIPELINE_VERSION = "query-engine-f2-1-mvp";
/** @deprecated Runtime query-pack evaluation uses QUERY_PACK_EVALUATOR_PIPELINE_VERSION. */
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
/** @deprecated Corpus certification and imported query-pack evidence own their sample policies. */
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
  queryStrategyBrief?: QueryStrategyBrief;
  knowledgeSources?: MemoryRecord[];
  query_text: string;
  sample: SampleMention[];
};

/**
 * @deprecated Kept for historical fixtures only. The worker uses
 * buildQueryPackEvaluatorPrompt(), persists mention-level classifications and
 * lets deterministic code compute all scores.
 */
export function buildSampleEvaluatorPrompt(input: SampleEvaluatorInput): string {
  const constructionMode = resolveQueryConstructionMode(input.methodology.slug);
  const adjustmentRules = constructionMode === "exploratory"
    ? [
        "MODO EXPLORATORIO: esta evaluacion mide la evidencia importada por este query pack; no certifica el corpus completo.",
        "No propongas agregar un AND obligatorio de trigger, barrier, emocion, journey o frase de decision. Eso sesga la ingesta y reduce recall.",
        "Propone ajustes sobre ANCHOR y NOISE: aliases canonicos, producto+marca, homonimos, terminos ambiguos, frases exactas demasiado largas, idioma o fuente recomendada.",
        "Triggers, barriers, experiences y comparisons se clasifican post-ingesta mediante el tag plan; pueden aparecer en el diagnostico, no como puerta obligatoria del boolean."
      ]
    : [
        "MODO DETECTION: el query puede exigir un THEME porque el playbook busca una alerta o senal acotada.",
        "Todo ajuste de THEME debe conservar lenguaje natural positivo y negativo en balance aproximado 40-60; nunca uses solo quejas.",
        "Prefiere wildcard o proximidad a listas de frases literales largas y conserva ANCHOR + NOISE."
      ];
  const proposedAdjustments = constructionMode === "exploratory"
    ? [
        "Agregar AND NOT con 'Laika Studios', 'Coraline' y 'perra Laika' porque son homonimos observados.",
        "Reemplazar el anchor ambiguo 'Laika' por aliases canonicos y combinaciones producto+marca sin exigir un tema.",
        "Separar Petco y Maskota en query packs independientes para preservar identidad por competidor."
      ]
    : [
        "Agregar AND NOT con homonimos observados sin alterar el anchor.",
        "Reemplazar frases exactas largas por wildcard o proximidad portable.",
        "Balancear el bloque THEME con lenguaje natural positivo y negativo."
      ];

  return [
    "Eres el Evaluador de Evidencia Importada por Query Pack del Engine de Noisia.",
    "Tu funcion es clasificar si las menciones recuperadas por este query producen senal interpretable o ruido para su pack.",
    "No apruebas el corpus, no predices el rendimiento de un query sin extraccion y no calculas los scores finales; codigo deterministico los calcula con tus clasificaciones.",
    "No expliques teoria. Devuelve solo JSON valido.",
    "",
    "PRINCIPIO CLAVE: volumen no es senal. Una mencion tiene valor cuando revela tension, emocion, friccion, percepcion o codigo cultural — no cuando solo menciona una palabra clave.",
    `Modo de construccion: ${constructionMode}.`,
    ...adjustmentRules,
    "",
    "Criterios de puntuacion (0-10):",
    "- quality_score: relevancia cultural para la pregunta de negocio (0=nada relevante, 10=alta densidad cultural)",
    "- density_score: % estimado de menciones con senal real (>70%=excelente, 50-70%=bueno, 30-49%=debil, <30%=reconstruir)",
    "- noise_score: nivel de ruido en la muestra (10=todo ruido, 0=limpio) — se afecta por: letras/lirica, farandula/fandom, noticias sin interpretacion, spam/bots, contenido generico, menciones fuera de Mexico, listings de mercado, publicaciones de empleo, memes sin friccion, contenido IA autogenerado, quejas genericas sin angulo relevante",
    "- language_mx_pct: % de menciones en espanol mexicano informal (0-100)",
    "- geo_mx_pct: % de menciones con contexto geografico Mexico (0-100)",
    "- notes: diagnostico de 2-4 oraciones — que terminos del query capturan senal real, que causa el ruido, si la pregunta de negocio puede responderse con esta muestra",
    "- proposed_adjustments: lista de ajustes concretos y ejecutables compatibles con el modo de construccion. Cada ajuste debe indicar el bloque ANCHOR, THEME o NOISE, el termino y la evidencia que lo justifica.",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        quality_score: 2,
        density_score: 2,
        noise_score: 9,
        language_mx_pct: 80,
        geo_mx_pct: 60,
        notes: "La evidencia importada contiene demasiado ruido de homonimos para este query pack. La recomendacion corrige identidad y exclusiones sin convertir temas exploratorios en filtros obligatorios.",
        proposed_adjustments: proposedAdjustments
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
        query_strategy_brief: input.queryStrategyBrief ?? null,
        knowledge_base: input.knowledgeSources ?? [],
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
  competitorEntities?: QueryCompetitorEntity[];
  brandSeeds: string[];
  knowledgeSources: MemoryRecord[];
  memoryIndustry: MemoryRecord[];
  memoryBrand: MemoryRecord[];
  queryStrategyBrief?: QueryStrategyBrief;
};

export type QueryStrategyBrief = {
  summary: string;
  priority_topics: string[];
  audience_clues: string[];
  competitor_hypotheses: string[];
  query_language: string[];
  exclusions_or_noise: string[];
  brand_query_role: string;
  competitor_query_role: string;
  industry_query_role: string;
  must_answer: string[];
  limitations: string[];
};

export type MethodologyManifest = {
  query_mode?: QueryConstructionMode;
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
  /** First-class competitive queries. Every item represents exactly one governed entity. */
  competitor_queries?: Array<{
    entity: string;
    query_text: string;
  }>;
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
    competitor_queries?: Array<{
      entity: string;
      query_text: string;
    }>;
    global_exclusions: string[];
    knowledge_sources?: MemoryRecord[];
    query_strategy_brief?: QueryStrategyBrief | null;
    memory_industry: MemoryRecord[];
    memory_brand: MemoryRecord[];
    model?: string;
    fallback_used?: boolean;
    fallback_reason?: string;
    generation_contract?: {
      dialect_version: string;
      validation_mode: "structural_pre_import" | "structural_plus_imported_evidence";
      evidence_status: "awaiting_imported_mentions" | "validated_on_imported_mentions";
      subject_os: "brand_os" | "theme_os";
      rag_scopes: Array<"brand_os" | "theme_os" | "study_os">;
      knowledge_source_types: string[];
      knowledge_source_count: number;
      strategy_brief_used: boolean;
      required_scopes?: Array<"brand" | "competitors" | "category">;
      /** Canonical query identities. Competitive keys use `competitor:<entity>`. */
      required_query_keys?: string[];
      queries: Record<string, PortableListenQueryValidation>;
      semantic_queries: Record<string, QuerySemanticValidation>;
      construction_plan: QueryConstructionPlan;
      rejected_queries?: Record<string, PortableListenQueryValidation>;
      rejected_semantic_queries?: Record<string, QuerySemanticValidation>;
      fallback_scopes?: string[];
    };
    refinement?: {
      source_iteration_id: string;
      refined_pack_scopes: string[];
      frozen_pack_scopes: string[];
      refined_query_identities?: string[];
      frozen_query_identities?: string[];
      applied_at: string;
    };
  };
};

export function buildQueryComposerPrompt(input: QueryComposerInput) {
  const constructionInput = buildQueryConstructionInput(input);
  const plan = buildQueryConstructionPlan(constructionInput);
  const subjectOs = input.subject.type === "brand" ? "Brand OS" : "Theme OS";
  const governedRagLabel = `${subjectOs} + Study OS`;
  const hasCompetitorScope = plan.anchors.competitor_entities.length > 0;
  const hasCategoryScope = plan.anchors.category.length > 0;
  const governedScopeCount = 1 + (hasCompetitorScope ? 1 : 0) + (hasCategoryScope ? 1 : 0);
  const responseExample = {
    query_text: plan.recommended_variant === "themed" && plan.themed
      ? plan.themed.brand
      : plan.permissive.brand,
    ...(hasCompetitorScope
      ? {
          competitor_queries: plan.anchors.competitor_entities.map((competitor) => ({
            entity: competitor.entity,
            query_text: plan.recommended_variant === "themed" && plan.themed
              ? plan.themed.competitor_entities.find((item) => item.entity === competitor.entity)?.query ?? ""
              : plan.permissive.competitor_entities.find((item) => item.entity === competitor.entity)?.query ?? ""
          }))
        }
      : {}),
    ...(hasCategoryScope
      ? {
          industry_query_text: plan.recommended_variant === "themed" && plan.themed
            ? plan.themed.category ?? ""
            : plan.permissive.category ?? ""
        }
      : {})
  };

  return [
    "Eres el constructor semantico de queries de Noisia.",
    "Tu trabajo es enriquecer un contrato determinista gobernado por Data OS; no puedes cambiar su modo, entidades ni limites.",
    `RAG gobernado: ${governedRagLabel}.`,
    `Produce exactamente los ${governedScopeCount} scopes respaldados por Data OS.`,
    "No inventes un scope opcional sin anchors canonicos.",
    "No expliques teoria. Devuelve solo JSON valido.",
    "",
    `MODO: ${plan.mode.toUpperCase()}.`,
    ...(plan.mode === "exploratory"
      ? [
          "REGLA CRITICA: captura la entidad o categoria con recall amplio y aplica THEME despues de la ingesta.",
          "PROHIBIDO agregar AND con triggers, barriers, journey, valor o lenguaje de la pregunta de negocio.",
          "Los terminos de senal viven en tag_plan; no deben filtrar el universo antes de observarlo."
        ]
      : [
          "Este playbook permite THEME en la recuperacion.",
          "Balancea lenguaje positivo y negativo: 40-60% de cada lado. No construyas una query solo de quejas."
        ]),
    "",
    "CAPAS DEL CONTRATO:",
    `- ANCHOR: conserva al menos un termino gobernado por ${subjectOs}. No inventes marcas, aliases ni handles.`,
    "- NOISE: conserva el AND NOT preemptivo del perfil de dominio y solo suma homonimos respaldados por RAG.",
    "- THEME: se usa solo cuando el modo lo permite. Prefiere lenguaje vivido a lenguaje de consultoria.",
    "- CONFIG: idioma, mercado, periodo y fuentes son metadata; nunca los incrustes como operadores propietarios.",
    "- COMPETENCIA: una query por entidad. Nunca unas dos competidores en el mismo OR.",
    "",
    "CALIDAD LINGUISTICA:",
    "- Usa variantes naturales en los idiomas configurados, incluidas expresiones positivas, negativas y de resolucion.",
    "- Usa frases exactas cortas; para coocurrencias flexibles usa proximidad \"frase\"~n.",
    "- Usa wildcard final solo en raices no ambiguas: bloque*, clon*, hipotec*.",
    "- Terminos ambiguos como PIX, Nu, Elo, bandeira, tarjeta o cartao nunca pueden aparecer solos.",
    "- Comprime sinonimos redundantes, pero no reduzcas la query a cuatro frases genericas.",
    "",
    BOOLEAN_LISTENING_QUERY_RULES,
    "",
    "CONTRATO DETERMINISTA DE ENTRADA:",
    JSON.stringify(plan, null, 2),
    "",
    "Devuelve exactamente los scopes presentes en el ejemplo. El parser valida sintaxis Y semantica por scope; cualquier violacion se sustituye por el draft determinista.",
    "Formato JSON obligatorio (puedes enriquecer lenguaje, no la estructura):",
    JSON.stringify(responseExample, null, 2),
    "",
    "Input:",
    JSON.stringify(
      {
        corpus: input.corpus,
        query_strategy_brief: input.queryStrategyBrief ?? null,
        knowledge_base: input.knowledgeSources,
        subject: input.subject,
        methodology: {
          slug: input.methodology.slug,
          name: input.methodology.name,
          version: input.methodology.version,
          engine_validation_prompt: input.methodology.manifest.engine_validation_prompt
        },
        construction_plan: plan
      },
      null,
      2
    )
  ].join("\n");
}

export function buildQueryStrategyBriefPrompt(input: QueryComposerInput): string {
  const subjectOs = input.subject.type === "brand" ? "Brand OS" : "Theme OS";
  const constructionPlan = buildQueryConstructionPlan(buildQueryConstructionInput(input));
  const hasCompetitorScope = constructionPlan.anchors.competitor_entities.length > 0;
  const hasCategoryScope = constructionPlan.anchors.category.length > 0;
  return [
    "Eres el Strategy Intake Engine de Noisia.",
    `Tu tarea es leer Study OS, ${subjectOs} y Knowledge Sources PRE-CORPUS para producir una estrategia de búsqueda y análisis.`,
    "No generes queries booleanas aqui. Devuelve SOLO JSON valido.",
    "",
    "Objetivo:",
    "- Priorizar que debe buscar el engine.",
    "- Separar diagnóstico del sujeto, benchmark competitivo y baseline de categoría cuando cada scope tenga datos canónicos.",
    "- Traducir lenguaje de brief/cliente a lenguaje real de usuario/plataforma.",
    "- Detectar ruido/exclusiones antes de componer queries.",
    "- Decir que necesita poder responder el output final.",
    "",
    "Reglas:",
    "- No inventes competidores, categorías, mercados ni handles que no estén en el input gobernado.",
    "- No conviertas claims internos en verdad del consumidor.",
    "- Si el Knowledge Base trae customer service/social archive con lenguaje real, extrae frases buscables.",
    "- Si trae campañas/briefs, usalos como contexto e hipotesis, no como evidencia.",
    "- Si falta data competitiva suficiente, dilo como limitacion.",
    "- Si un scope opcional no tiene semillas canónicas, devuelve su rol como cadena vacía.",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        summary: "...",
        priority_topics: ["..."],
        audience_clues: ["..."],
        competitor_hypotheses: ["..."],
        query_language: ["..."],
        exclusions_or_noise: ["..."],
        brand_query_role: "Diagnosticar que triggers/barriers aparecen cuando la marca esta presente.",
        competitor_query_role: hasCompetitorScope
          ? "Benchmarkear si las mismas tensiones pertenecen al peer set o a competidores."
          : "",
        industry_query_role: hasCategoryScope
          ? "Medir si la tension es de categoria aunque nadie mencione marcas."
          : "",
        must_answer: ["..."],
        limitations: ["..."]
      },
      null,
      2
    ),
    "",
    "Input:",
    JSON.stringify(
      {
        corpus: input.corpus,
        subject: input.subject,
        methodology: {
          slug: input.methodology.slug,
          name: input.methodology.name,
          version: input.methodology.version
        },
        competitors: input.competitors,
        brand_seeds: input.brandSeeds,
        knowledge_base: input.knowledgeSources,
        memory_industry: input.memoryIndustry,
        memory_brand: input.memoryBrand
      },
      null,
      2
    )
  ].join("\n");
}

export function parseQueryStrategyBriefJson(raw: string): QueryStrategyBrief {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in query strategy brief response");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<QueryStrategyBrief>;
  return normalizeQueryStrategyBrief(parsed);
}

function normalizeQueryStrategyBrief(value: Partial<QueryStrategyBrief>): QueryStrategyBrief {
  return {
    summary: asBriefString(value.summary, 1200),
    priority_topics: briefArray(value.priority_topics, 12),
    audience_clues: briefArray(value.audience_clues, 10),
    competitor_hypotheses: briefArray(value.competitor_hypotheses, 12),
    query_language: briefArray(value.query_language, 24),
    exclusions_or_noise: briefArray(value.exclusions_or_noise, 16),
    brand_query_role: asBriefString(value.brand_query_role, 500),
    competitor_query_role: asBriefString(value.competitor_query_role, 500),
    industry_query_role: asBriefString(value.industry_query_role, 500),
    must_answer: briefArray(value.must_answer, 10),
    limitations: briefArray(value.limitations, 10)
  };
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
  previousCompetitorQueryText?: string;
  previousIndustryQueryText?: string;
  proposedAdjustments: string[];
  evaluation: { quality_score: number; density_score: number; noise_score: number; notes: string };
  subject: QueryComposerInput["subject"];
  corpus: QueryComposerInput["corpus"];
  methodology: Pick<QueryComposerInput["methodology"], "slug" | "name">;
  knowledgeSources?: MemoryRecord[];
  queryStrategyBrief?: QueryStrategyBrief;
  /** All previous evaluated iterations — oldest first — so Claude can see the full arc. */
  evaluationHistory?: EvaluationHistoryEntry[];
  /** Optional free-form user instructions to apply on top of the diagnostic. */
  userComments?: string;
}): string {
  const mode = resolveQueryConstructionMode(params.methodology.slug);
  const requiredScopeLines = [
    "1. query_text: refina la query primaria del sujeto.",
    ...(params.previousCompetitorQueryText
      ? ["2. competitor_query_text: refina el benchmark competitivo sin introducir competidores nuevos."]
      : []),
    ...(params.previousIndustryQueryText
      ? ["3. industry_query_text: refina el baseline de categoría sin introducir marcas."]
      : [])
  ];
  const responseExample = {
    query_text: mode === "exploratory"
      ? '("Sujeto" OR @handle) AND NOT ("homonimo")'
      : '("Sujeto" OR @handle) AND ("me resolvieron" OR "no me resolvieron") AND NOT ("homonimo")',
    ...(params.previousCompetitorQueryText
      ? {
          competitor_query_text: mode === "exploratory"
            ? '("Competidor") AND NOT ("homonimo")'
            : '("Competidor") AND ("vale la pena" OR "no vale la pena") AND NOT ("homonimo")'
        }
      : {}),
    ...(params.previousIndustryQueryText
      ? {
          industry_query_text: mode === "exploratory"
            ? '("categoria" OR "lenguaje natural de categoria") AND NOT ("ruido")'
            : '("categoria") AND ("me conviene" OR "no me conviene") AND NOT ("ruido")'
        }
      : {}),
    query_components: {
      brand_seeds: ["..."],
      competitor_seeds: ["..."],
      category_seeds: ["..."],
      trigger_phrases_tb: ["..."],
      barrier_phrases_tb: ["..."],
      global_exclusions: ["..."]
    }
  };
  return [
    "Eres el Engine de Validacion de Queries de Noisia.",
    "Tu tarea es refinar una hipotesis booleana portable a partir de evidencia importada, sin romper el contrato metodologico.",
    `MODO GOBERNADO: ${mode.toUpperCase()}. No puedes cambiarlo.`,
    "No expliques teoria. Devuelve solo JSON valido.",
    "",
    ...(mode === "exploratory"
      ? [
          "REGLA CRITICA: refina ANCHOR y NOISE; NO agregues un AND obligatorio con triggers, barriers, journey o lenguaje del brief.",
          "Los hallazgos tematicos de la evidencia deben alimentar clasificacion y diagnostico post-ingesta, no reducir el universo recuperado."
        ]
      : [
          "El modo detection permite THEME obligatorio, pero debe contener lenguaje positivo y negativo en una proporcion 40-60.",
          "No conviertas la query en un inventario solo de quejas."
        ]),
    "Conserva el scope, las entidades gobernadas y las exclusiones defendibles. No inventes aliases, handles ni competidores.",
    "Prefiere lenguaje vivido y variantes naturales. Usa proximidad para coocurrencias flexibles y wildcard final solo en raices no ambiguas.",
    "No existe una meta artificial de hacer la siguiente version mas corta: debe ser mas precisa, auditable y suficientemente amplia.",
    "",
    BOOLEAN_LISTENING_QUERY_RULES,
    "",
    "Escalera de traduccion: concepto estrategico → lenguaje cotidiano local → variantes observables → expresion buscable.",
    "Aplica ajustes compatibles con el modo. Si un ajuste propone theme-gating en modo exploratory, conviertelo en mejor NOISE o descartalo.",
    "",
    `OBLIGATORIO — Refina exactamente los ${requiredScopeLines.length} scopes presentes en la iteración:`,
    ...requiredScopeLines,
    "No inventes scopes ausentes ni cambies su función analítica.",
    "",
    "Formato JSON obligatorio — mismo schema:",
    JSON.stringify(responseExample, null, 2),
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
    ...(params.previousCompetitorQueryText
      ? ["", "Query competitiva a refinar:", params.previousCompetitorQueryText]
      : []),
    ...(params.previousIndustryQueryText
      ? ["", "Query de categoría a refinar:", params.previousIndustryQueryText]
      : []),
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
    JSON.stringify(
      {
        subject: params.subject,
        corpus: params.corpus,
        methodology: params.methodology,
        query_strategy_brief: params.queryStrategyBrief ?? null,
        knowledge_base: params.knowledgeSources ?? []
      },
      null,
      2
    )
  ].join("\n");
}

/** Provider-neutral constraints reused by every prompt that emits a listening query. */
export const BOOLEAN_LISTENING_QUERY_RULES = [
  `REGLAS DEL DIALECTO ${PORTABLE_LISTEN_QUERY_DIALECT_VERSION}:`,
  "- Usa términos, frases exactas entre comillas dobles, AND, OR, NOT y paréntesis balanceados.",
  "- Cada término o grupo debe estar conectado explícitamente con AND u OR; NOT niega el término o grupo siguiente.",
  "- Usa proximidad \"frase flexible\"~n cuando dos o mas palabras deban aparecer cerca sin exigir una frase literal.",
  "- * solo puede ir al final de un término y requiere al menos cuatro caracteres antes; ? sustituye un carácter y no puede ir al inicio.",
  "- No combines comillas de frase exacta con comodines: \"mascota*\" es inválido.",
  "- PROHIBIDO usar operadores de campo o sintaxis propietaria: country:, lang:, platform:, site:, from:, date:, author:, url:, NEAR/n u operadores equivalentes.",
  "- Toda exclusión debe escribirse como AND NOT (...).",
  "- Geografía, idioma, fechas y plataformas se configuran como metadata al ejecutar la extracción, no dentro de la expresión.",
  "- Incluye solo términos defendibles por Brand OS, brief, Knowledge Base o evidencia importada.",
  "- La expresión es una hipótesis portable: su calidad se evalúa después de importar una extracción ligada al query pack."
].join("\n");

export function buildFallbackQuery(input: QueryComposerInput): ComposedQuery {
  const components = buildQueryComponents(input);
  const constructionPlan = buildQueryConstructionPlan(buildQueryConstructionInput(input));
  const canonical = queriesFromConstructionPlan(constructionPlan);
  const competitorQueryText = constructionPlan.permissive.competitors_legacy_union;

  return {
    query_text: canonical.brand ?? constructionPlan.permissive.brand,
    competitor_queries: canonicalCompetitorQueries(canonical),
    competitor_query_text: competitorQueryText,
    industry_query_text: canonical.category,
    query_components: {
      ...components,
      competitor_queries: canonicalCompetitorQueries(canonical),
      fallback_used: true,
      generation_contract: buildGenerationContract(input, canonical)
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
  const constructionInput = buildQueryConstructionInput(input);
  const constructionPlan = buildQueryConstructionPlan(constructionInput);
  const fallbackCandidates = queriesFromComposedQuery(fallback);
  const suppliedCandidates = suppliedQueriesFromParsed(parsed, constructionPlan);
  const candidateKeys = Object.keys(fallbackCandidates);
  const rejectedQueries: Record<string, PortableListenQueryValidation> = {};
  const rejectedSemanticQueries: Record<string, QuerySemanticValidation> = {};
  const fallbackScopes: string[] = [];
  const chosen: Record<string, string> = {};

  for (const key of candidateKeys) {
    const supplied = suppliedCandidates[key] ?? "";
    const fallbackQuery = fallbackCandidates[key] ?? "";
    const identity = queryIdentityFromKey(key);
    const structural = validatePortableListenQuery(supplied);
    const semantic = validateConstructedQuery({
      query: supplied,
      scope: identity.scope,
      input: constructionInput,
      plan: constructionPlan,
      ...(identity.competitorEntity ? { competitorEntity: identity.competitorEntity } : {})
    });
    if (structural.valid && semantic.valid) {
      chosen[key] = structural.normalized_query;
      continue;
    }
    rejectedQueries[key] = structural;
    rejectedSemanticQueries[key] = semantic;
    fallbackScopes.push(key);
    chosen[key] = fallbackQuery;
  }

  const competitorQueries = canonicalCompetitorQueries(chosen);
  const legacyCompetitorUnion = constructionPlan.permissive.competitors_legacy_union;

  return {
    query_text: chosen.brand ?? fallback.query_text,
    competitor_queries: competitorQueries,
    competitor_query_text: legacyCompetitorUnion,
    industry_query_text: chosen.category,
    query_components: {
      ...fallback.query_components,
      competitor_queries: competitorQueries,
      model,
      fallback_used: fallbackScopes.length > 0,
      fallback_reason: fallbackScopes.length > 0 ? `invalid_or_missing_scopes:${fallbackScopes.join(",")}` : undefined,
      generation_contract: {
        ...buildGenerationContract(input, chosen),
        ...(fallbackScopes.length > 0
          ? {
              rejected_queries: rejectedQueries,
              rejected_semantic_queries: rejectedSemanticQueries,
              fallback_scopes: fallbackScopes
            }
          : {})
      }
    }
  };
}

export function buildGenerationContract(
  input: QueryComposerInput,
  queries: Record<string, string | PortableListenQueryValidation>,
  options: {
    validationMode?: NonNullable<ComposedQuery["query_components"]["generation_contract"]>["validation_mode"];
    evidenceStatus?: NonNullable<ComposedQuery["query_components"]["generation_contract"]>["evidence_status"];
  } = {}
): NonNullable<ComposedQuery["query_components"]["generation_contract"]> {
  const subjectOs = input.subject.type === "brand" ? "brand_os" : "theme_os";
  const constructionInput = buildQueryConstructionInput(input);
  const constructionPlan = buildQueryConstructionPlan(constructionInput);
  const requiredScopes: Array<"brand" | "competitors" | "category"> = [
    "brand",
    ...(constructionPlan.anchors.competitor_entities.length > 0 ? (["competitors"] as const) : []),
    ...(constructionPlan.anchors.category.length > 0 ? (["category"] as const) : [])
  ];
  const requiredQueryKeys = [
    "brand",
    ...constructionPlan.anchors.competitor_entities.map((entity) => competitorQueryKey(entity.entity)),
    ...(constructionPlan.anchors.category.length > 0 ? ["category"] : [])
  ];
  const scopedQueries = Object.fromEntries(requiredQueryKeys.map((key) => {
    const query = queries[key];
    return [key, typeof query === "string" ? validatePortableListenQuery(query) : query ?? validatePortableListenQuery("")];
  })) as Record<string, PortableListenQueryValidation>;
  const semanticQueries = Object.fromEntries(requiredQueryKeys.map((key) => {
    const identity = queryIdentityFromKey(key);
    const report = scopedQueries[key];
    return [key, validateConstructedQuery({
      query: report?.normalized_query ?? "",
      scope: identity.scope,
      input: constructionInput,
      plan: constructionPlan,
      ...(identity.competitorEntity ? { competitorEntity: identity.competitorEntity } : {})
    })];
  })) as Record<string, QuerySemanticValidation>;
  return {
    dialect_version: PORTABLE_LISTEN_QUERY_DIALECT_VERSION,
    validation_mode: options.validationMode ?? "structural_pre_import",
    evidence_status: options.evidenceStatus ?? "awaiting_imported_mentions",
    subject_os: subjectOs,
    rag_scopes: [subjectOs, "study_os"],
    knowledge_source_types: unique(input.knowledgeSources.map((source) => source.type)),
    knowledge_source_count: input.knowledgeSources.length,
    strategy_brief_used: Boolean(input.queryStrategyBrief),
    required_scopes: requiredScopes,
    required_query_keys: requiredQueryKeys,
    queries: scopedQueries,
    semantic_queries: semanticQueries,
    construction_plan: constructionPlan
  };
}

export function queryValidationReports(queries: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(queries).map(([scope, query]) => [scope, validatePortableListenQuery(query)])
  ) as Record<string, PortableListenQueryValidation>;
}

function queriesFromConstructionPlan(plan: QueryConstructionPlan): Record<string, string> {
  const variant = plan.recommended_variant === "themed" && plan.themed
    ? plan.themed
    : plan.permissive;
  return {
    brand: variant.brand,
    ...Object.fromEntries(
      variant.competitor_entities.map((item) => [competitorQueryKey(item.entity), item.query])
    ),
    ...(variant.category ? { category: variant.category } : {})
  };
}

function queriesFromComposedQuery(composed: ComposedQuery): Record<string, string> {
  return {
    brand: composed.query_text,
    ...Object.fromEntries(
      (composed.competitor_queries ?? []).map((item) => [competitorQueryKey(item.entity), item.query_text])
    ),
    ...(composed.industry_query_text ? { category: composed.industry_query_text } : {})
  };
}

function suppliedQueriesFromParsed(
  parsed: Partial<ComposedQuery>,
  plan: QueryConstructionPlan
): Record<string, string> {
  const governedEntities = new Map(
    plan.anchors.competitor_entities.map((item) => [normalizeQueryEntityName(item.entity), item.entity])
  );
  const competitors = Object.fromEntries(
    (parsed.competitor_queries ?? []).flatMap((item) => {
      if (!item || typeof item.entity !== "string" || typeof item.query_text !== "string") return [];
      const governedEntity = governedEntities.get(normalizeQueryEntityName(item.entity));
      return governedEntity ? [[competitorQueryKey(governedEntity), item.query_text] as const] : [];
    })
  );

  if (
    Object.keys(competitors).length === 0
    && plan.anchors.competitor_entities.length === 1
    && typeof parsed.competitor_query_text === "string"
  ) {
    const entity = plan.anchors.competitor_entities[0]?.entity;
    if (entity) competitors[competitorQueryKey(entity)] = parsed.competitor_query_text;
  }

  return {
    ...(typeof parsed.query_text === "string" ? { brand: parsed.query_text } : {}),
    ...competitors,
    ...(typeof parsed.industry_query_text === "string" ? { category: parsed.industry_query_text } : {})
  };
}

function canonicalCompetitorQueries(queries: Record<string, string>) {
  return Object.entries(queries).flatMap(([key, query]) => {
    if (!key.startsWith("competitor:") || !query) return [];
    return [{ entity: key.slice("competitor:".length), query_text: query }];
  });
}

function competitorQueryKey(entity: string) {
  return `competitor:${entity}`;
}

function queryIdentityFromKey(key: string): {
  scope: QueryConstructionScope;
  competitorEntity?: string;
} {
  if (key === "category") return { scope: "category" };
  if (key.startsWith("competitor:")) {
    return { scope: "competitors", competitorEntity: key.slice("competitor:".length) };
  }
  return { scope: "brand" };
}

function normalizeQueryEntityName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildQueryComponents(input: QueryComposerInput) {
  const signalPhrases = input.methodology.manifest.signal_phrases ?? {};
  const categorySeeds = compact([
    input.subject.industry,
    input.subject.industrySub
  ]);
  const memoryExclusions = extractMemoryStrings(input.memoryIndustry, "exclusion");
  const memoryBrandSeeds = extractMemoryStrings(input.memoryIndustry, "brand_seed");

  return {
    brand_seeds: unique(compact([...input.brandSeeds, ...input.subject.brandSeedHandles, ...memoryBrandSeeds])),
    competitor_seeds: unique(input.competitors),
    category_seeds: unique(categorySeeds),
    trigger_phrases_tb: unique(signalPhrases.triggers_generic ?? []),
    barrier_phrases_tb: unique(signalPhrases.barriers_generic ?? []),
    knowledge_query_language: unique([
      ...extractKnowledgeStrings(input.knowledgeSources, "query_language"),
      ...(input.queryStrategyBrief?.query_language ?? [])
    ]),
    knowledge_potential_triggers: unique(extractKnowledgeStrings(input.knowledgeSources, "potential_triggers")),
    knowledge_potential_barriers: unique(extractKnowledgeStrings(input.knowledgeSources, "potential_barriers")),
    global_exclusions: unique([
      ...(input.methodology.manifest.global_exclusions ?? []),
      ...memoryExclusions,
      ...(input.queryStrategyBrief?.exclusions_or_noise ?? [])
    ]),
    memory_industry: input.memoryIndustry,
    memory_brand: input.memoryBrand,
    query_strategy_brief: input.queryStrategyBrief ?? null
  };
}

export function buildQueryConstructionInput(input: QueryComposerInput): QueryConstructionInput {
  const components = buildQueryComponents(input);
  return {
    methodologySlug: input.methodology.slug,
    ...(input.methodology.manifest.query_mode
      ? { queryModeOverride: input.methodology.manifest.query_mode }
      : {}),
    subject: {
      type: input.subject.type,
      name: input.subject.name,
      industry: input.subject.industry,
      industrySub: input.subject.industrySub,
      countries: input.subject.countries,
      handles: input.subject.brandSeedHandles
    },
    brandSeeds: components.brand_seeds,
    categorySeeds: components.category_seeds,
    competitorEntities: input.competitorEntities,
    competitorSeeds: components.competitor_seeds,
    triggerTerms: unique([
      ...components.trigger_phrases_tb,
      ...(components.knowledge_potential_triggers ?? [])
    ]),
    barrierTerms: unique([
      ...components.barrier_phrases_tb,
      ...(components.knowledge_potential_barriers ?? [])
    ]),
    queryLanguage: components.knowledge_query_language,
    exclusions: components.global_exclusions,
    targetWindowMonths: input.corpus.targetWindowMonths
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

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function compact(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}

function asBriefString(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function briefArray(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 500)).filter(Boolean).slice(0, limit)
    : [];
}
