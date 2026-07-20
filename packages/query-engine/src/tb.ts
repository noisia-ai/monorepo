/**
 * Triggers & Barriers pipeline constants and prompt builders.
 * Spec: docs/product/03_TRIGGERS_BARRIERS_DEEPDIVE.md
 */

export const TB_ANALYSIS_QUEUE_NAME = "noisia-tb-analysis";
export const TB_PIPELINE_VERSION = "tb-engine-2026.05.25";
export const TB_METHODOLOGY_VERSION = "1.0";

/** The 4 layers in the doble eje of T&B (besides polarity). */
export const TB_LAYERS = ["psicologico", "personal", "social", "cultural"] as const;
export type TbLayer = (typeof TB_LAYERS)[number];

export type TbPolarity = "trigger" | "barrier";
export type TbCodingPolarity = TbPolarity | "mixed" | "irrelevant";

export type TbStepName =
  | "preflight"
  | "step1_open_pass"
  | "step2_coding"
  | "step3_hierarchy"
  | "step4_mobility"
  | "step5_comparative"
  | "step6_synthesis"
  | "quality_gates";

/** Ordered list — orchestrator advances through this. */
export const TB_STEP_ORDER: TbStepName[] = [
  "preflight",
  "step1_open_pass",
  "step2_coding",
  "step3_hierarchy",
  "step4_mobility",
  "step5_comparative",
  "step6_synthesis",
  "quality_gates"
];

export function nextStep(current: TbStepName): TbStepName | null {
  const idx = TB_STEP_ORDER.indexOf(current);
  if (idx === -1 || idx === TB_STEP_ORDER.length - 1) return null;
  return TB_STEP_ORDER[idx + 1] ?? null;
}

/* ============================================================
   STEP 0 — Pre-flight check
   ============================================================ */

export type PreflightCheck = {
  id: "business_question" | "source_balance" | "window_temporal" | "polarity_balance" | "language_uniformity";
  /** PASS = clean, WARN = proceed but flag as limitation, FAIL = fatal blocker. */
  result: "PASS" | "WARN" | "FAIL";
  reason: string;
};

export type PreflightResult = {
  checks: PreflightCheck[];
  /**
   * PROCEDER                = corpus impecable
   * PROCEDER_WITH_WARNINGS  = proceder pero registrar warnings en limitations
   * ABORTAR                 = problema fatal (corpus vacío, idioma equivocado total)
   */
  decision: "PROCEDER" | "PROCEDER_WITH_WARNINGS" | "ABORTAR";
  /** Hard blockers — only populated when decision === 'ABORTAR'. */
  blockers: string[];
  /** Soft warnings — populated when decision === 'PROCEDER_WITH_WARNINGS'. */
  warnings: string[];
};

export type PreflightInput = {
  brandName: string;
  businessQuestion: string | null;
  totalMentions: number;
  sources: { name: string; count: number; pct: number }[];
  windowMonths: number | null;
  languageDistribution: { lang: string; pct: number }[];
  triggerToBarrierRatio?: number; // heuristic from initial sample
  ragContext?: TbRagPromptContext;
};

export type TbRagPromptContext = {
  query_strategy_brief?: unknown | null;
  knowledge_sources?: unknown[];
  corpus_intelligence?: unknown | null;
  structured_observations?: unknown | null;
};

export function buildPreflightPrompt(input: PreflightInput): string {
  return [
    "Rol: Eres un analista Noisia ejecutando pre-flight check de Triggers & Barriers sobre un corpus capturado.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble. NO uses markdown fences. NO expliques fuera del JSON.",
    "",
    "FILOSOFIA: Tu trabajo es proteger contra estudios INVIABLES, no rechazar estudios IMPERFECTOS.",
    "Un corpus con sesgos sigue siendo valioso si los limites se documentan. Solo ABORTA cuando el estudio no pueda producir señal cultural alguna (corpus vacio, idioma equivocado total).",
    "Para sesgos moderados usa WARN — el analisis procede registrando la limitacion para que el cliente la lea.",
    "",
    "Contexto:",
    `- Marca: ${input.brandName}`,
    "- Metodología: Triggers & Barriers",
    `- Pregunta de negocio: ${input.businessQuestion ?? "(no especificada)"}`,
    `- Tamaño del corpus: ${input.totalMentions} menciones`,
    `- Fuentes: ${input.sources.map((s) => `${s.name} ${s.pct.toFixed(1)}%`).join(", ")}`,
    `- Window temporal: ${input.windowMonths ?? "?"} meses`,
    `- Idiomas detectados: ${input.languageDistribution.map((l) => `${l.lang} ${l.pct.toFixed(1)}%`).join(", ")}`,
    "",
    "Contexto Knowledge Base / Query Strategy Brief:",
    renderTbRagContext(input.ragContext),
    "",
    "Tu tarea: validar 5 puntos. Por cada uno responde PASS, WARN o FAIL con razon breve (<30 palabras).",
    "Al final da decision: PROCEDER, PROCEDER_WITH_WARNINGS o ABORTAR.",
    "",
    "Puntos con thresholds explicitos:",
    "1. business_question — ¿Existe pregunta de negocio en frase explicita?",
    "   PASS si especifica y clara · WARN si vaga pero existe · FAIL solo si esta vacia",
    "2. source_balance — Diversidad de fuentes:",
    "   PASS si ninguna >60% · WARN si una entre 60% y 90% · FAIL solo si una fuente 100% (cero diversidad estructural)",
    "3. window_temporal — Ventana temporal:",
    "   PASS si <=13 meses · WARN si entre 14 y 24 meses (cultura puede haber cambiado) · FAIL si >24 meses",
    "4. polarity_balance — Mix de positivos vs quejas en el corpus:",
    "   PASS si mix visible · WARN si polarizado a un lado · FAIL si TODO un lado (impide T&B por definicion)",
    "5. language_uniformity — Idioma uniforme del estudio:",
    "   PASS si un idioma domina >=90% · WARN si domina entre 70-90% · FAIL si no hay idioma dominante claro",
    "",
    "Reglas de decision final:",
    "- CUALQUIER FAIL → decision = ABORTAR, listar TODOS los FAIL en blockers[]",
    "- 0 FAIL y >=1 WARN → decision = PROCEDER_WITH_WARNINGS, listar TODOS los WARN en warnings[]",
    "- Solo PASS → decision = PROCEDER, blockers=[], warnings=[]",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        checks: [
          { id: "business_question", result: "PASS", reason: "Pregunta clara sobre triggers/barriers de compra." },
          { id: "source_balance", result: "WARN", reason: "Fuente comments concentra 84%, supera el 60% recomendado pero hay 5 fuentes mas que aportan diversidad." },
          { id: "window_temporal", result: "PASS", reason: "12 meses dentro del limite de 13." },
          { id: "polarity_balance", result: "PASS", reason: "Mix visible de positivos y quejas." },
          { id: "language_uniformity", result: "PASS", reason: "100% en el idioma dominante del estudio." }
        ],
        decision: "PROCEDER_WITH_WARNINGS",
        blockers: [],
        warnings: [
          "source_balance: comments domina con 84% del corpus — los hallazgos pueden estar sesgados al comportamiento conversacional de esa plataforma."
        ]
      },
      null,
      2
    ),
    "",
    "Responde AHORA — solo el JSON:"
  ].join("\n");
}

/* ============================================================
   STEP 1 — Open pass (emergent tagging)
   ============================================================ */

/** Recommended batch size for one Claude call. ~30 fits comfortably in
 * context without truncating tag arrays. */
export const TB_OPEN_PASS_BATCH_SIZE = 30;

/** Max mentions to read in one open-pass run.
 * For current sold-work corpora (<= cap), we process all of them. */
export const TB_OPEN_PASS_MAX_SAMPLE = 50000;

export type OpenPassMentionInput = {
  id: string;
  text: string;
  platform: string;
};

export type OpenPassTaggedMention = {
  mention_id: string;
  tags: string[];
};

export type OpenPassBatchResult = {
  tagged_mentions: OpenPassTaggedMention[];
};

export function buildOpenPassPrompt(args: {
  brandName: string;
  industry: string | null;
  businessQuestion: string | null;
  outputLanguage?: string | null;
  ragContext?: TbRagPromptContext;
  mentions: OpenPassMentionInput[];
}): string {
  const outputLanguage = args.outputLanguage?.trim() || "the corpus language";
  return [
    "Rol: Eres un analista Noisia ejecutando Paso 1 del protocolo Triggers & Barriers.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble, NO uses markdown fences, NO expliques fuera del JSON.",
    "",
    "Contexto:",
    `- Marca: ${args.brandName}`,
    `- Industria: ${args.industry ?? "(no especificada)"}`,
    `- Pregunta de negocio: ${args.businessQuestion ?? "(no especificada)"}`,
    `- Idioma de tags/salida: ${outputLanguage}`,
    "",
    "Contexto Knowledge Base / Query Strategy Brief:",
    renderTbRagContext(args.ragContext),
    "",
    "Tarea: leer cada mención y asignarle 1-3 tags emergentes EN EL LENGUAJE DEL CORPUS MISMO.",
    "Los tags deben sonar como cosas que diría el consumidor, NO como vocabulario de consultor/marketing.",
    "",
    "Ejemplos de tags VÁLIDOS (lenguaje real):",
    "  · 'letra chica'",
    "  · 'no me cubrió cuando lo necesité'",
    "  · 'el ajustador nunca llegó'",
    "  · 'me la recomendó mi compa'",
    "  · 'pague de mas por nada'",
    "",
    "Ejemplos de tags INVÁLIDOS (lenguaje de framework):",
    "  · 'Trigger emocional' (eso es codificacion de capa 2, NO emergente)",
    "  · 'Layer psicológico' (idem)",
    "  · 'Sentimiento negativo' (genérico, vacío)",
    "  · 'Barrier de confianza' (marco, no lenguaje del usuario)",
    "",
    "Reglas:",
    "- Cada mención recibe 1 a 3 tags. Si la mención es 100% irrelevante a la categoria, devuelve tags: ['irrelevant'].",
    "- Tag corto (2-6 palabras), en el idioma de salida. Si el corpus está en inglés, los tags deben salir en inglés.",
    "- Reusa tags entre menciones cuando capturen el mismo concepto (NO crees variantes innecesarias).",
    "- NO inventes tags que no esten ancladas en el texto literal de las menciones.",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        tagged_mentions: [
          { mention_id: "00000000-0000-0000-0000-000000000001", tags: ["letra chica", "ya no me sirvió"] },
          { mention_id: "00000000-0000-0000-0000-000000000002", tags: ["me lo recomendaron", "buen precio"] },
          { mention_id: "00000000-0000-0000-0000-000000000003", tags: ["irrelevant"] }
        ]
      },
      null,
      2
    ),
    "",
    `Menciones del lote (${args.mentions.length}):`,
    args.mentions
      .map((m) => `[${m.id}] (${m.platform}) ${m.text.replace(/\s+/g, " ").trim().slice(0, 280)}`)
      .join("\n"),
    "",
    "Responde AHORA — solo el JSON:"
  ].join("\n");
}

export function parseOpenPassResponse(raw: string): OpenPassBatchResult {
  const noFences = raw.replace(/```(?:json)?/gi, "").trim();
  const start = noFences.indexOf("{");
  if (start === -1) throw new Error("No JSON object in open-pass response");
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < noFences.length; i++) {
    const c = noFences[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unbalanced JSON in open-pass response");
  const parsed = JSON.parse(noFences.slice(start, end)) as { tagged_mentions?: unknown[] };
  const tagged = Array.isArray(parsed.tagged_mentions) ? parsed.tagged_mentions : [];
  return {
    tagged_mentions: tagged
      .filter((m): m is { mention_id: unknown; tags: unknown } =>
        typeof m === "object" && m !== null && "mention_id" in m && "tags" in m
      )
      .map((m) => ({
        mention_id: String(m.mention_id),
        tags: Array.isArray(m.tags)
          ? m.tags.map((t) => String(t).trim().toLowerCase().slice(0, 60)).filter((t) => t.length >= 2 && t.length <= 60)
          : []
      }))
  };
}

/* ============================================================
   STEP 2 — Coding (polarity + layer per tag/mention)
   ============================================================ */

/** Top N tags we ask Claude to code in one call. Kept high so large corpora
 * don't collapse into the same few generic tensions before hierarchy. */
export const TB_CODING_TOP_TAGS = 300;

/** Number of sample verbatims to attach per tag so Claude can ground its
 * coding in real text rather than guessing from the tag label alone. */
export const TB_CODING_SAMPLES_PER_TAG = 2;

export type CodingTagInput = {
  tag: string;
  count: number;
  samples: string[];
};

export type CodedTag = {
  tag: string;
  /** 'trigger' | 'barrier' | 'mixed' | 'irrelevant' */
  polarity: TbCodingPolarity;
  /** null when polarity is 'irrelevant' */
  layer: TbLayer | null;
  ambiguous: boolean;
  reason: string;
  /** Optional cluster id Claude uses to group near-duplicate tags. */
  cluster: string | null;
};

export type CodingResponse = {
  coded_tags: CodedTag[];
  layer_distribution: { layer: TbLayer; pct: number }[];
  polarity_distribution: { polarity: TbCodingPolarity; pct: number }[];
};

export function buildCodingPrompt(args: {
  brandName: string;
  industry: string | null;
  businessQuestion: string | null;
  outputLanguage?: string | null;
  ragContext?: TbRagPromptContext;
  tags: CodingTagInput[];
}): string {
  const outputLanguage = args.outputLanguage?.trim() || "Spanish (Mexico)";
  return [
    "Rol: Eres un analista Noisia ejecutando Paso 2 del protocolo Triggers & Barriers.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble, NO uses markdown fences.",
    "",
    "Contexto:",
    `- Marca: ${args.brandName}`,
    `- Industria: ${args.industry ?? "(no especificada)"}`,
    `- Pregunta de negocio: ${args.businessQuestion ?? "(no especificada)"}`,
    `- Idioma de salida: ${outputLanguage}`,
    "",
    "Contexto Knowledge Base / Query Strategy Brief:",
    renderTbRagContext(args.ragContext),
    "",
    "Tarea: para cada tag emergente (con sus muestras reales), asignarle DOS dimensiones:",
    "",
    "DIMENSIÓN 1 — Polaridad:",
    "  · 'trigger'     — empuja a la persona HACIA la decisión (motivador positivo o curiosidad)",
    "  · 'barrier'     — frena, aleja o expone fricción/dolor",
    "  · 'mixed'       — el tag captura ambos lados simultáneamente",
    "  · 'irrelevant'  — el tag no aporta señal T&B (ej: spam, noticias, política sin relación)",
    "",
    "DIMENSIÓN 2 — Layer (capa cultural):",
    "  · 'psicologico'  — emociones, miedos, deseos individuales internos",
    "  · 'personal'     — experiencias concretas vividas (precio, tiempo, esfuerzo, producto)",
    "  · 'social'       — influencia de otros (recomendaciones, status, comparación)",
    "  · 'cultural'     — códigos colectivos, narrativas de categoría, valores compartidos",
    "  · null           — solo cuando polaridad es 'irrelevant'",
    "",
    "REGLAS:",
    "- Mantén `tag` EXACTAMENTE como llegó para que el sistema lo pueda mapear.",
    "- `reason` y `cluster` deben estar en el idioma de salida. Si el corpus es inglés, NO traduzcas a español.",
    "- Lee las muestras antes de codificar. Un mismo wording puede ser trigger o barrier según contexto.",
    "- 'ambiguous: true' SOLO si genuinamente no se puede decidir entre dos opciones (no abuses).",
    "- Si dos tags son semanticamente iguales (ej: 'pesimo servicio' y 'mal servicio'), asígnales el MISMO valor en 'cluster' (texto corto representativo).",
    "- Target: <5% de tags con ambiguous=true.",
    "- 'reason' en <20 palabras explicando QUÉ del verbatim te llevó a esa codificación.",
    "",
    "Al final también devuelves layer_distribution y polarity_distribution como % aproximado del corpus codificado.",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        coded_tags: [
          {
            tag: "letra chica",
            polarity: "barrier",
            layer: "personal",
            ambiguous: false,
            reason: "Verbatims exponen frustración con clausulas no leídas que invalidan reclamos.",
            cluster: "letra chica"
          },
          {
            tag: "el ajustador nunca llego",
            polarity: "barrier",
            layer: "personal",
            ambiguous: false,
            reason: "Friccion operativa concreta en momento de siniestro.",
            cluster: "ajustador deficiente"
          },
          {
            tag: "me lo recomendaron",
            polarity: "trigger",
            layer: "social",
            ambiguous: false,
            reason: "Decision activada por influencia social directa.",
            cluster: "recomendacion social"
          },
          {
            tag: "boletos concierto",
            polarity: "irrelevant",
            layer: null,
            ambiguous: false,
            reason: "Tema musical sin relacion con categoria seguros.",
            cluster: null
          }
        ],
        polarity_distribution: [
          { polarity: "barrier", pct: 58 },
          { polarity: "trigger", pct: 22 },
          { polarity: "mixed", pct: 5 },
          { polarity: "irrelevant", pct: 15 }
        ],
        layer_distribution: [
          { layer: "personal", pct: 48 },
          { layer: "psicologico", pct: 22 },
          { layer: "social", pct: 18 },
          { layer: "cultural", pct: 12 }
        ]
      },
      null,
      2
    ),
    "",
    `Tags a codificar (${args.tags.length}):`,
    args.tags
      .map(
        (t) =>
          `\n[tag: "${t.tag}"] (count: ${t.count})\n  muestras:\n` +
          t.samples.map((s) => `   - ${s.replace(/\s+/g, " ").trim().slice(0, 220)}`).join("\n")
      )
      .join("\n"),
    "",
    "Responde AHORA — solo el JSON:"
  ].join("\n");
}

export function parseCodingResponse(raw: string): CodingResponse {
  const noFences = raw.replace(/```(?:json)?/gi, "").trim();
  const start = noFences.indexOf("{");
  if (start === -1) throw new Error("No JSON object in coding response");
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < noFences.length; i++) {
    const c = noFences[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unbalanced JSON in coding response");
  const parsed = JSON.parse(noFences.slice(start, end)) as {
    coded_tags?: unknown[];
    polarity_distribution?: unknown[];
    layer_distribution?: unknown[];
  };

  const validPolarities: TbCodingPolarity[] = ["trigger", "barrier", "mixed", "irrelevant"];
  const validLayers: TbLayer[] = ["psicologico", "personal", "social", "cultural"];

  const codedTags = Array.isArray(parsed.coded_tags)
    ? parsed.coded_tags
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t): CodedTag => {
          const polarity = validPolarities.includes(t.polarity as TbCodingPolarity)
            ? (t.polarity as TbCodingPolarity)
            : "mixed";
          const layerRaw = t.layer;
          const layer =
            polarity === "irrelevant"
              ? null
              : validLayers.includes(layerRaw as TbLayer)
                ? (layerRaw as TbLayer)
                : null;
          return {
            tag: String(t.tag ?? "").trim().toLowerCase(),
            polarity,
            layer,
            ambiguous: Boolean(t.ambiguous),
            reason: typeof t.reason === "string" ? t.reason.slice(0, 240) : "",
            cluster: typeof t.cluster === "string" && t.cluster.length > 0 ? t.cluster.toLowerCase() : null
          };
        })
        .filter((t) => t.tag.length > 0)
    : [];

  const polarity_distribution = Array.isArray(parsed.polarity_distribution)
    ? parsed.polarity_distribution
        .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
        .map((p) => ({
          polarity: (validPolarities.includes(p.polarity as TbCodingPolarity)
            ? (p.polarity as TbCodingPolarity)
            : "mixed"),
          pct: typeof p.pct === "number" ? p.pct : 0
        }))
    : [];

  const layer_distribution = Array.isArray(parsed.layer_distribution)
    ? parsed.layer_distribution
        .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
        .map((l) => ({
          layer: (validLayers.includes(l.layer as TbLayer) ? (l.layer as TbLayer) : "personal"),
          pct: typeof l.pct === "number" ? l.pct : 0
        }))
    : [];

  return { coded_tags: codedTags, polarity_distribution, layer_distribution };
}

/* ============================================================
   STEP 3 — Hierarchy (frecuencia + intensidad + predictividad → score)
   ============================================================ */

/** Hard cap on how many clusters we ask Claude to evaluate in one call.
 * The output JSON grows linearly so this still bounds response tokens. */
export const TB_HIERARCHY_MAX_CLUSTERS = 140;

/** Minimum mentions a candidate cluster needs to become a finding. Below
 * this it's long-tail noise that step 6 will ignore anyway. */
export const TB_HIERARCHY_MIN_FREQUENCY = 3;

/** Number of sample verbatims attached per cluster for the hierarchy prompt.
 * Higher = more grounded scoring but more context per call. */
export const TB_HIERARCHY_SAMPLES_PER_CLUSTER = 5;

export type HierarchyClusterInput = {
  /** Stable id derived from polarity+layer+cluster-or-tag. */
  key: string;
  /** Short label Claude assigned in step 2 (or the dominant tag if no cluster). */
  label: string;
  polarity: "trigger" | "barrier" | "mixed";
  layer: TbLayer;
  member_tags: string[];
  frequency: number;
  samples: { mention_id: string; text: string }[];
};

export type EvaluatedCluster = {
  key: string;
  /** Business-friendly label, NOT the raw user-language tag. e.g. "Desconfianza en el pago de siniestros". */
  nombre_comercial: string;
  /** 0-5 — how visceral the language is. 5 = visceral / emotional / urgent. */
  intensidad_promedio: number;
  /** 0-1 — how well this signal predicts actual decision change (abandono / compra). */
  capacidad_predictiva: number;
  /** 'alta' | 'media' | 'baja_direccional' */
  confidence: "alta" | "media" | "baja_direccional";
  reason: string;
  /** Index (into samples[]) of the verbatim Claude considers the protagonist. */
  protagonist_sample_index: number;
  /** Indices of additional supporting verbatims (max 4). */
  supporting_sample_indices: number[];
};

export function buildHierarchyPrompt(args: {
  brandName: string;
  industry: string | null;
  businessQuestion: string | null;
  outputLanguage?: string | null;
  ragContext?: TbRagPromptContext;
  clusters: HierarchyClusterInput[];
}): string {
  const outputLanguage = args.outputLanguage?.trim() || "Spanish (Mexico)";
  return [
    "Rol: Eres un analista Noisia ejecutando Paso 3 del protocolo Triggers & Barriers (jerarquizacion tridimensional).",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble, NO uses markdown fences.",
    "",
    "Contexto:",
    `- Marca: ${args.brandName}`,
    `- Industria: ${args.industry ?? "(no especificada)"}`,
    `- Pregunta de negocio: ${args.businessQuestion ?? "(no especificada)"}`,
    `- Idioma de salida: ${outputLanguage}`,
    "",
    "Contexto Knowledge Base / Query Strategy Brief:",
    renderTbRagContext(args.ragContext),
    "",
    "Tarea: para cada cluster (que ya tiene polaridad + layer + frecuencia del paso anterior), evaluar TRES dimensiones:",
    "",
    "DIMENSIÓN 1 — Nombre comercial:",
    "  Una etiqueta profesional, business-friendly, que podría ir en un slide ejecutivo.",
    "  · Debe estar en el idioma de salida. Si el corpus es inglés, `nombre_comercial` y `reason` deben salir en inglés.",
    "  · NO es la frase cruda del usuario (eso ya esta en label).",
    "  · SI es una sintesis interpretativa: ej. 'Desconfianza en el pago de siniestros' (no 'no me cubrio').",
    "  · Maximo 60 caracteres.",
    "",
    "DIMENSIÓN 2 — Intensidad lingüística (0.0 a 5.0):",
    "  Que tan visceral/emocional es el lenguaje en las muestras.",
    "  · 0-1: tono neutro, descriptivo, sin carga emocional",
    "  · 2-3: queja moderada, frustración audible",
    "  · 4-5: rabia, traición, dolor agudo, urgencia",
    "",
    "DIMENSIÓN 3 — Capacidad predictiva (0.0 a 1.0):",
    "  Que tan probable es que esta señal prediga un cambio de decision real (abandono, compra, cambio de marca).",
    "  · 0.0-0.3: opinión sin acción detrás (rant generico)",
    "  · 0.4-0.6: tension que precede a busqueda activa de alternativa",
    "  · 0.7-1.0: evidencia explicita de decision tomada o a punto de tomarse",
    "",
    "Confidence: 'alta' (sample es robusto y consistente) | 'media' (señal clara pero sample limitado) | 'baja_direccional' (apenas para reportar como hipotesis).",
    "",
    "Por cada cluster tambien debes elegir UN verbatim protagonista (el mas representativo) y 1-4 verbatims de apoyo. Los indices son las posiciones en el array samples (0-based).",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        evaluated: [
          {
            key: "barrier|personal|letra-chica",
            nombre_comercial: "Letra chica que invalida reclamos",
            intensidad_promedio: 3.8,
            capacidad_predictiva: 0.62,
            confidence: "alta",
            reason: "Verbatims muestran tono de traicion y abandono activo de aseguradora tras descubrir clausulas.",
            protagonist_sample_index: 2,
            supporting_sample_indices: [0, 4, 7]
          }
        ]
      },
      null,
      2
    ),
    "",
    `Clusters a evaluar (${args.clusters.length}):`,
    args.clusters
      .map(
        (c) =>
          `\n[key: "${c.key}"]\n  label original: "${c.label}"\n  polaridad: ${c.polarity} · layer: ${c.layer} · frecuencia: ${c.frequency}\n  tags miembros: ${c.member_tags.slice(0, 6).join(", ")}\n  muestras:\n` +
          c.samples
            .map((s, i) => `   [${i}] ${s.text.replace(/\s+/g, " ").trim().slice(0, 220)}`)
            .join("\n")
      )
      .join("\n"),
    "",
    "Responde AHORA — solo el JSON:"
  ].join("\n");
}

export function parseHierarchyResponse(raw: string): { evaluated: EvaluatedCluster[] } {
  const noFences = raw.replace(/```(?:json)?/gi, "").trim();
  const start = noFences.indexOf("{");
  if (start === -1) throw new Error("No JSON object in hierarchy response");
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < noFences.length; i++) {
    const c = noFences[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unbalanced JSON in hierarchy response");
  const parsed = JSON.parse(noFences.slice(start, end)) as { evaluated?: unknown[] };
  const validConfidence = new Set(["alta", "media", "baja_direccional"]);
  const evaluated = Array.isArray(parsed.evaluated)
    ? parsed.evaluated
        .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
        .map((e): EvaluatedCluster => {
          const intensidad = Number(e.intensidad_promedio);
          const predictividad = Number(e.capacidad_predictiva);
          const supporting = Array.isArray(e.supporting_sample_indices)
            ? e.supporting_sample_indices.map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 4)
            : [];
          return {
            key: String(e.key ?? ""),
            nombre_comercial: typeof e.nombre_comercial === "string" ? e.nombre_comercial.slice(0, 80) : "Sin nombre",
            intensidad_promedio: Number.isFinite(intensidad) ? Math.max(0, Math.min(5, intensidad)) : 2.5,
            capacidad_predictiva: Number.isFinite(predictividad) ? Math.max(0, Math.min(1, predictividad)) : 0.5,
            confidence: validConfidence.has(String(e.confidence))
              ? (String(e.confidence) as EvaluatedCluster["confidence"])
              : "media",
            reason: typeof e.reason === "string" ? e.reason.slice(0, 280) : "",
            protagonist_sample_index: Number.isFinite(Number(e.protagonist_sample_index))
              ? Math.max(0, Number(e.protagonist_sample_index))
              : 0,
            supporting_sample_indices: supporting
          };
        })
        .filter((e) => e.key.length > 0)
    : [];
  return { evaluated };
}

/**
 * Compute the composite score from frequency + intensity + predictivity.
 * Frequency is normalized against the max in the same polarity bucket so a
 * giant cluster doesn't crush smaller ones with stronger signal.
 *
 * Formula:  0.30·freq_norm + 0.35·intensity_norm + 0.35·predictividad
 * Scale: 0 to 5 (matches `score_compuesto` column precision).
 */
export function computeCompositeScore(args: {
  frequency: number;
  maxFrequencyInBucket: number;
  intensidadPromedio: number;
  capacidadPredictiva: number;
}): number {
  const freqNorm = args.maxFrequencyInBucket > 0 ? args.frequency / args.maxFrequencyInBucket : 0;
  const intensityNorm = args.intensidadPromedio / 5;
  const score01 = 0.30 * freqNorm + 0.35 * intensityNorm + 0.35 * args.capacidadPredictiva;
  return Math.round(score01 * 5 * 100) / 100;
}

/** Build a stable finding_id like "B-PER-03" from polarity + layer + ordinal. */
export function buildFindingId(args: {
  polarity: "trigger" | "barrier" | "mixed";
  layer: TbLayer;
  ordinal: number;
}): string {
  const prefix = args.polarity === "trigger" ? "T" : args.polarity === "barrier" ? "B" : "M";
  const layerCode = (
    { psicologico: "PSI", personal: "PER", social: "SOC", cultural: "CUL" } as Record<TbLayer, string>
  )[args.layer];
  return `${prefix}-${layerCode}-${String(args.ordinal).padStart(2, "0")}`;
}

/* ============================================================
   STEP 4 — Mobility (movible vs estructural)
   ============================================================ */

export type TbMobility = "movible_por_marca" | "parcialmente_movible" | "estructural";

export type MobilityFindingInput = {
  finding_id: string;
  nombre_comercial: string;
  polarity: "trigger" | "barrier" | "mixed";
  layer: TbLayer;
  frecuencia: number;
  intensidad_promedio: number;
  capacidad_predictiva: number;
  score_compuesto: number;
  confidence: "alta" | "media" | "baja_direccional";
  /** Protagonist verbatim so Claude has the cluster's texture. */
  cita_protagonista_text: string;
};

export type MobilityVerdict = {
  finding_id: string;
  movilidad: TbMobility;
  /** 2-3 sentence rationale anchored in the finding's evidence. */
  movilidad_razon: string;
};

export type MobilityResponse = {
  verdicts: MobilityVerdict[];
};

export function buildMobilityPrompt(args: {
  brandName: string;
  industry: string | null;
  businessQuestion: string | null;
  outputLanguage?: string | null;
  ragContext?: TbRagPromptContext;
  findings: MobilityFindingInput[];
}): string {
  const outputLanguage = args.outputLanguage?.trim() || "Spanish (Mexico)";
  return [
    "Rol: Eres un strategist Noisia ejecutando Paso 4 del protocolo Triggers & Barriers.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble, NO uses markdown fences.",
    "",
    "Contexto:",
    `- Marca: ${args.brandName}`,
    `- Industria: ${args.industry ?? "(no especificada)"}`,
    `- Pregunta de negocio: ${args.businessQuestion ?? "(no especificada)"}`,
    `- Idioma de salida: ${outputLanguage}`,
    "",
    "Contexto Knowledge Base / Query Strategy Brief:",
    renderTbRagContext(args.ragContext),
    "",
    "Tarea: para cada finding, decidir su MOVILIDAD ESTRATÉGICA — qué tanto puede la marca mover este trigger/barrier con sus propias armas (producto, comunicación, operación).",
    "",
    "TRES NIVELES DE MOVILIDAD:",
    "",
    "1. 'movible_por_marca' — la marca puede atacar esto SOLA",
    "   · Problema operativo, de producto o de comunicación específico a esta marca.",
    "   · Ejemplos típicos: tiempos de respuesta, claridad de letra chica, calidad del ajustador, UX digital, transparencia de precio.",
    "   · Test: ¿Si esta marca arregla esto, el barrier desaparece para sus clientes? → SÍ.",
    "",
    "2. 'parcialmente_movible' — la marca comparte el dolor con la categoría pero puede diferenciarse",
    "   · La categoría completa sufre el problema, pero algunas marcas lo han mitigado mejor.",
    "   · Ejemplos típicos: complejidad percibida de pólizas, miedo a 'pagar de más', desconfianza en aseguradoras (general).",
    "   · Test: ¿Si esta marca lo hace mejor que el promedio, gana share-of-mind sin desaparecer el barrier? → SÍ.",
    "",
    "3. 'estructural' — código cultural / sistémico que NO se mueve con campañas",
    "   · Pertenece al imaginario de la categoría o del mercado. Pre-existe a la marca.",
    "   · Ejemplos típicos: desconfianza generalizada hacia aseguradoras en MX, percepción de seguros como 'transa', cultura de no-prevención.",
    "   · Test: ¿Si esta marca invierte millones intentando moverlo, mueve la aguja? → NO. La marca debe ALINEARSE con la narrativa o construir desde whitespace alternativo.",
    "",
    "REGLAS DE DECISIÓN:",
    "- Layer 'cultural' tiende a ser 'estructural' (no siempre — algunos códigos culturales son móviles vía categoría).",
    "- Layer 'personal' tiende a ser 'movible_por_marca' (fricciones operativas concretas).",
    "- Layer 'psicologico' suele caer en 'parcialmente_movible' (emociones colectivas con ángulo individual).",
    "- Layer 'social' depende: recomendaciones boca-a-boca son movibles via experiencia; status de categoría es estructural.",
    "- NO uses la heurística ciegamente — lee el `nombre_comercial` y el verbatim protagonista antes de decidir.",
    "",
    "`movilidad_razon`: 2-3 oraciones que justifiquen el verdict ANCLADAS en el verbatim/finding (no genéricas).",
    `Escribe \`movilidad_razon\` en ${outputLanguage}. No traduzcas a otro idioma.`,
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        verdicts: [
          {
            finding_id: "B-PER-01",
            movilidad: "movible_por_marca",
            movilidad_razon: "Es una falla operativa específica: ajustadores no llegan, deducibles no se devuelven. La marca puede atacar esto con cambios en proceso de siniestros y SLAs publicados — el verbatim '10 meses sin devolverme el deducible' es 100% intervención interna."
          },
          {
            finding_id: "B-CUL-01",
            movilidad: "estructural",
            movilidad_razon: "Desconfianza generalizada hacia aseguradoras en MX es un código cultural pre-marca, anclado en décadas de letra chica y trato deficiente del gremio. Combatirlo frontalmente quema presupuesto; la marca debe alinearse con narrativa de transparencia o construir whitespace nuevo."
          },
          {
            finding_id: "B-PSI-02",
            movilidad: "parcialmente_movible",
            movilidad_razon: "La percepción de 'evasión deliberada' afecta a toda la categoría, pero marcas como X han mitigado vía comunicación proactiva post-siniestro. Esta marca puede diferenciarse con misma estrategia, aunque no eliminar el barrier completo."
          }
        ]
      },
      null,
      2
    ),
    "",
    `Findings a evaluar (${args.findings.length}):`,
    args.findings
      .map(
        (f) =>
          `\n[${f.finding_id}] ${f.polarity} · ${f.layer}\n  nombre: ${f.nombre_comercial}\n  score: ${f.score_compuesto} (freq ${f.frecuencia}, int ${f.intensidad_promedio}, pred ${f.capacidad_predictiva}, conf ${f.confidence})\n  verbatim protagonista: "${f.cita_protagonista_text.replace(/\s+/g, " ").slice(0, 260)}"`
      )
      .join("\n"),
    "",
    "Responde AHORA — solo el JSON:"
  ].join("\n");
}

export function parseMobilityResponse(raw: string): MobilityResponse {
  const noFences = raw.replace(/```(?:json)?/gi, "").trim();
  const start = noFences.indexOf("{");
  if (start === -1) throw new Error("No JSON object in mobility response");
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < noFences.length; i++) {
    const c = noFences[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unbalanced JSON in mobility response");
  const parsed = JSON.parse(noFences.slice(start, end)) as { verdicts?: unknown[] };
  const validMobility: TbMobility[] = ["movible_por_marca", "parcialmente_movible", "estructural"];
  return {
    verdicts: Array.isArray(parsed.verdicts)
      ? parsed.verdicts
          .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
          .map((v): MobilityVerdict => ({
            finding_id: String(v.finding_id ?? "").trim(),
            movilidad: validMobility.includes(v.movilidad as TbMobility)
              ? (v.movilidad as TbMobility)
              : "parcialmente_movible",
            movilidad_razon: typeof v.movilidad_razon === "string" ? v.movilidad_razon.slice(0, 600) : ""
          }))
          .filter((v) => v.finding_id.length > 0)
      : []
  };
}

/* ============================================================
   STEP 6 — Synthesis + humanizer
   ============================================================ */

export const TB_SYNTHESIS_TOP_PER_KIND = 5;

export type SynthesisFindingInput = {
  id: string;
  finding_id: string;
  nombre_comercial: string;
  polarity: "trigger" | "barrier" | "mixed";
  layer: TbLayer;
  frecuencia: number;
  intensidad_promedio: number;
  capacidad_predictiva: number;
  score_compuesto: number;
  confidence: "alta" | "media" | "baja_direccional";
  movilidad: TbMobility;
  movilidad_razon: string;
  cita_protagonista_text: string;
};

export type ActivationRecommendation = {
  trigger_id: string;
  medio_recomendado: string;
  tono_recomendado: string;
  riesgo_saturacion: "bajo" | "medio" | "alto";
  categoria_donde_aplica: string[];
};

export type TriggerToAvoid = {
  trigger_id: string;
  razon: string;
  evidencia_competitiva?: string;
};

export type ActivationPlaybook = {
  top_triggers_movibles: Array<{
    trigger_id: string;
    nombre: string;
    layer: TbLayer;
    evidencia: string;
  }>;
  por_trigger_recomendacion: ActivationRecommendation[];
  triggers_a_evitar: TriggerToAvoid[];
  nota?: string;
};

export type BarrierIntervention = {
  barrier_id: string;
  intervencion_sugerida: string;
  tipo_intervencion: "comunicacion" | "producto" | "proceso" | "precio" | "distribucion";
  inversion_estimada: "baja" | "media" | "alta";
  indicador_exito: string;
  responsable_sugerido: string;
};

export type StructuralBarrierNote = {
  barrier_id: string;
  nombre: string;
  razon_estructural: string;
  recomendacion: string;
};

export type FrictionRemovalPlan = {
  top_barriers_movibles: Array<{
    barrier_id: string;
    nombre: string;
    layer: TbLayer;
    evidencia: string;
  }>;
  por_barrier_intervencion: BarrierIntervention[];
  barriers_estructurales: StructuralBarrierNote[];
};

export type ActionStudioCard = {
  action_id: string;
  target_team: "brand_strategy" | "creative_content" | "product_cx" | "retail_media" | "measurement" | "cultural_guardrails";
  kind: "activation" | "friction_removal" | "alignment" | "experiment" | "guardrail" | "structural_note";
  title: string;
  finding_ids: string[];
  primary_finding_id: string | null;
  rationale: string;
  action_text: string;
  suggested_channel: string | null;
  suggested_format: string | null;
  success_signal: string;
  estimated_effort: "baja" | "media" | "alta";
  estimated_impact: "bajo" | "medio" | "alto";
  confidence: "alta" | "media" | "baja_direccional";
  priority_rank: number;
};

export type EmergingPatternOutput = {
  pattern_id: string;
  title: string;
  pattern_type: "source_pattern" | "unexpected_insight" | "language_code" | "cx_signal" | "product_signal" | "content_signal" | "hypothesis";
  why_it_matters: string;
  data_basis: string[];
  evidence_count: number;
  source_breakdown: Array<{ source: string; count: number }>;
  related_finding_ids: string[];
  confidence: "alta" | "media" | "baja_direccional";
  evidence_quotes: string[];
};

export type KnowledgeImpactOutput = {
  business_question_answer: string;
  confirmed_by_corpus: string[];
  contradicted_or_unproven: string[];
  decision_implications: string[];
  strategic_constraints: string[];
};

export type StrategicOpportunityOutput = {
  opportunity_id: string;
  title: string;
  decision: string;
  why_now: string;
  level: "brand" | "content" | "product_cx" | "competitive" | "measurement" | "category";
  source_mix: string[];
  related_finding_ids: string[];
  evidence_summary: string;
  what_to_do: string;
  success_signal: string;
  confidence: "alta" | "media" | "baja_direccional";
};

export type FutureSignalOutput = {
  signal_id: string;
  title: string;
  polarity: "future_trigger" | "future_barrier";
  horizon: "30_90_days" | "3_6_months" | "6_12_months";
  why_it_could_emerge: string;
  evidence_basis: string[];
  watch_metric: string;
  related_finding_ids: string[];
  confidence: "alta" | "media" | "baja_direccional";
};

export type MarketAnalysisOutput = {
  headline: string;
  answer: string;
  implications: string[];
  patterns: Array<{
    title: string;
    why_it_matters: string;
    source_basis: string[];
    related_finding_ids: string[];
  }>;
};

export type EvidenceDeepDiveOutput = {
  finding_id: string;
  plain_language_title: string;
  description: string;
  channel_insight: string;
  format_insight: string;
  period_insight: string;
  competitor_insight: string | null;
  future_watchout: string | null;
  proof_points: string[];
};

export type SynthesisResponse = {
  activation_playbook: ActivationPlaybook;
  friction_removal_plan: FrictionRemovalPlan;
  action_studio: ActionStudioCard[];
  emerging_patterns: EmergingPatternOutput[];
  knowledge_impact: KnowledgeImpactOutput;
  strategic_opportunities: StrategicOpportunityOutput[];
  future_signals: FutureSignalOutput[];
  market_analysis: MarketAnalysisOutput;
  evidence_deep_dives: EvidenceDeepDiveOutput[];
};

export function buildSynthesisPrompt(args: {
  brandName: string;
  industry: string | null;
  businessQuestion: string | null;
  outputLanguage?: string | null;
  ragContext?: TbRagPromptContext;
  comparativeBrief?: unknown;
  findings: SynthesisFindingInput[];
}): string {
  const triggers = args.findings.filter((f) => f.polarity === "trigger");
  const barriers = args.findings.filter((f) => f.polarity === "barrier");
  const comparativeContext = compactJson(args.comparativeBrief, 8_000);
  const outputLanguage = args.outputLanguage?.trim() || "Spanish (Mexico)";
  const englishOutput = outputLanguage.toLowerCase().startsWith("english");
  const voiceLine = outputLanguage.toLowerCase().startsWith("english")
    ? "English, direct, commercially sharp, no LinkedIn-speak. Preserve the corpus and Knowledge Base wording when it is already in English."
    : "Español directo, accionable, sin LinkedIn-speak.";

  return [
    "Rol: Eres un strategist senior de Noisia ejecutando Paso 6 del protocolo Triggers & Barriers.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble, NO uses markdown fences, NO expliques fuera del JSON.",
    englishOutput
      ? "ABSOLUTE LANGUAGE CONTRACT: every client-visible string value MUST be written in English. Schema keys may stay Spanish; values cannot. Translate/adapt any Spanish finding names, mobility reasons, examples, or prior text into natural English."
      : "CONTRATO DE IDIOMA: todos los valores visibles para cliente deben estar en español natural.",
    englishOutput
      ? "FAILURE CONDITION: do not output Spanish narrative phrases such as 'aparece en', 'señal', 'barrera', 'intervención', 'día de pago', 'confío'. Use English equivalents."
      : "Evita inglés innecesario si el estudio está en español.",
    "",
    "Contexto:",
    `- Marca: ${args.brandName}`,
    `- Industria: ${args.industry ?? "(no especificada)"}`,
    `- Pregunta de negocio: ${args.businessQuestion ?? "(no especificada)"}`,
    `- Idioma de salida: ${outputLanguage}`,
    `- Comparative brief disponible: ${comparativeContext ? "sí" : "no"}`,
    "",
    "Contexto Knowledge Base / Query Strategy Brief:",
    renderTbRagContext(args.ragContext),
    "",
    "Tarea: producir el output canónico que el cliente puede leer: activation_playbook + friction_removal_plan + action_studio + opportunities + market analysis.",
    "Modo compacto obligatorio para estabilidad: prioriza calidad sobre volumen. Max 5 action_studio, max 5 strategic_opportunities, max 4 future_signals, max 4 evidence_deep_dives, max 4 emerging_patterns.",
    "Límites de longitud obligatorios: cada string narrativo máximo 25 palabras; evidence_quotes máximo 1 por item; nada de párrafos largos.",
    "No inventes evidencia. Si no hay triggers movibles suficientes, deja arrays vacios y escríbelo como limitacion accionable.",
    "Usa el comparative brief para distinguir si una recomendacion ataca algo propio de marca, algo de competencia o algo de categoria.",
    "Regla dura: no hagas claims competitivos si el comparative brief no trae evidencia para ese finding.",
    "Regla dura de Knowledge Base: el brief, CSVs y archivos del cliente NO son decoración. Debes decir qué confirmaron, qué contradijeron o qué todavía no se pudo probar.",
    "",
    "6.A Activation playbook:",
    `- Usa hasta ${TB_SYNTHESIS_TOP_PER_KIND} triggers con movilidad 'movible_por_marca' o 'parcialmente_movible'.`,
    "- Si no hay triggers, devuelve top_triggers_movibles=[] y por_trigger_recomendacion=[] con nota clara.",
    "- Para triggers parcialmente movibles que suenen saturados o agotados, agrega triggers_a_evitar.",
    "",
    "6.B Friction removal plan:",
    `- Usa hasta ${TB_SYNTHESIS_TOP_PER_KIND} barriers con movilidad='movible_por_marca'.`,
    "- Cada intervención debe decir qué hacer concretamente, no una intención abstracta.",
    "- Para barriers estructurales NO propongas intervención; escribe razon_estructural + recomendacion de alineamiento o whitespace.",
    "- Si una barrera es de categoria, la recomendacion debe ser de alineamiento/claridad, no de 'ganarle' a un competidor sin evidencia.",
    "- Si un trigger lo posee competencia, decide si la marca debe disputarlo, reinterpretarlo o evitar copiarlo.",
    "",
    "6.C Action Studio:",
    "- Produce acciones por equipo: brand_strategy, creative_content, product_cx, retail_media, measurement, cultural_guardrails.",
    "- Cada accion debe traer finding_ids, rationale, action_text, success_signal, estimated_effort, estimated_impact, confidence y priority_rank.",
    "- No repitas la misma accion en dos equipos. Si dos equipos colaboran, elige owner principal y menciona colaboradores en action_text.",
    "- Debe haber maximo 5 acciones totales; prioriza lo que contesta la pregunta de negocio.",
    "- Escribe para un usuario de negocio: títulos concretos, sin nombres abstractos de findings como headline.",
    "- Si un equipo no tiene una accion con evidencia, NO fuerces relleno.",
    "",
    "6.D Knowledge Impact:",
    "- Responde la pregunta del cliente en 1 parrafo contundente usando corpus + KB + comparative brief.",
    "- Lista qué cosas del brief/CSVs confirmó el corpus, qué quedó sin probar y qué implica para la decisión.",
    "- Incluye restricciones estratégicas del cliente si afectan la recomendación.",
    "",
    "6.E Strategic Opportunities:",
    "- NO son triggers ni barriers. Son apuestas/conclusiones accionables que nacen de cruzar T&B + cuantitativo + KB + competencia.",
    "- Cada oportunidad debe decir: la decisión que cambia, por qué ahora, qué hacer y cómo medir si funcionó.",
    "- Maximo 5. Si una oportunidad sólo repite un finding, elimínala.",
    "",
    "6.F Future Triggers / Future Barriers:",
    "- Forecast cultural: qué podría mover o frenar mañana a la marca si las señales actuales evolucionan.",
    "- Debe anclarse en evidencia actual, no en futurismo genérico.",
    "- Maximo 4.",
    "",
    "6.G Market Analysis / Source Patterns:",
    "- Esta es la sección agnóstica: responde la pregunta de negocio aunque T&B no alcance.",
    "- Puede usar corpus, Knowledge Base, CSVs, competitive brief, acciones y hallazgos.",
    "- NO repitas payday/keywords como tarjetas. Sintetiza patrones de mercado con implicación.",
    "",
    "6.H Evidence Deep Dives:",
    "- Para cada finding principal explica en lenguaje humano qué significa, dónde vive por canal/formato/periodo y qué watchout futuro tiene.",
    "- Estos deep dives alimentan Evidence; no deben ser recomendaciones disfrazadas.",
    "",
    "6.I Emerging Patterns:",
    "- Mantén sólo insights abiertos realmente nuevos. No repitas Strategic Opportunities ni Evidence.",
    "- Maximo 4 patterns. Cada uno necesita evidence_count, source_breakdown y 1-3 quotes.",
    "",
    "Voz Noisia:",
    `- ${voiceLine}`,
    "- No traduzcas el corpus ni el brief si ya están en el idioma de salida.",
    "- Evita: 'aprovechar sinergias', 'optimizar engagement', 'palanca de crecimiento', 'landscape', 'pivotal'.",
    "- Nada de frases genéricas tipo 'fortalecer la confianza del consumidor' si no dices cómo.",
    "",
    "Formato JSON obligatorio:",
    JSON.stringify(
      {
        activation_playbook: {
          top_triggers_movibles: [
            {
              trigger_id: "T-SOC-01",
              nombre: "Recomendación de conocidos que sí cobraron",
              layer: "social",
              evidencia: "La gente confía cuando alguien cercano cuenta que la aseguradora sí respondió."
            }
          ],
          por_trigger_recomendacion: [
            {
              trigger_id: "T-SOC-01",
              medio_recomendado: "video corto testimonial",
              tono_recomendado: "cercano, específico, sin prometer milagros",
              riesgo_saturacion: "medio",
              categoria_donde_aplica: ["social", "CRM"]
            }
          ],
          triggers_a_evitar: [
            {
              trigger_id: "T-PER-02",
              razon: "La categoría ya saturó el discurso de precio bajo y vuelve sospechosa la promesa."
            }
          ],
          nota: ""
        },
        friction_removal_plan: {
          top_barriers_movibles: [
            {
              barrier_id: "B-PER-01",
              nombre: "Letra chica que invalida reclamos",
              layer: "personal",
              evidencia: "Las menciones describen frustración cuando la cobertura no coincide con lo que entendieron al contratar."
            }
          ],
          por_barrier_intervencion: [
            {
              barrier_id: "B-PER-01",
              intervencion_sugerida: "Crear una ficha de cobertura en lenguaje simple antes del pago, con tres exclusiones críticas y ejemplo de siniestro cubierto/no cubierto.",
              tipo_intervencion: "comunicacion",
              inversion_estimada: "media",
              indicador_exito: "Bajar menciones de letra chica y no cubre en la siguiente medición quincenal.",
              responsable_sugerido: "Producto + Legal + Agencia creativa"
            }
          ],
          barriers_estructurales: [
            {
              barrier_id: "B-CUL-01",
              nombre: "Desconfianza histórica hacia aseguradoras",
              razon_estructural: "Es un código de categoría, no una falla aislada de marca.",
              recomendacion: "No prometer confianza en abstracto; demostrar claridad con reglas visibles y pruebas de cumplimiento."
            }
          ]
        },
        action_studio: [
          {
            action_id: "AS-01",
            target_team: "product_cx",
            kind: "friction_removal",
            title: "Hacer visible la exclusion critica antes del pago",
            finding_ids: ["B-PER-01"],
            primary_finding_id: "B-PER-01",
            rationale: "La barrera aparece como friccion movible y se puede reducir con claridad operacional.",
            action_text: "Producto y Legal deben convertir las tres exclusiones principales en una ficha simple con ejemplo cubierto/no cubierto.",
            suggested_channel: "checkout / PDP / onboarding",
            suggested_format: "ficha de decision",
            success_signal: "Bajan menciones de letra chica y no cubre en la siguiente medicion.",
            estimated_effort: "media",
            estimated_impact: "alto",
            confidence: "alta",
            priority_rank: 1
          }
        ],
        knowledge_impact: {
          business_question_answer: "El problema principal no es awareness sino conversion de reach a comunidad: la evidencia muestra fricciones de confianza y baja participacion organica, mientras los CSVs competitivos apuntan a creator-led y cultura UK como brecha.",
          confirmed_by_corpus: ["La categoria conversa sobre ansiedad de dinero y payday con lenguaje cotidiano."],
          contradicted_or_unproven: ["El corpus no prueba aun que #SweatTheSillyStuff tenga adopcion organica fuera de la marca."],
          decision_implications: ["Priorizar always-on creator-led antes que otra ola paid de awareness."],
          strategic_constraints: ["FCA: evitar consejo financiero especifico y separar paid/organic con claridad."]
        },
        strategic_opportunities: [
          {
            opportunity_id: "OP-01",
            title: "Convertir alcance pagado en conversacion propia",
            decision: "Mover el plan anual de videos de spots cerrados a formatos conversacionales con creator seeding.",
            why_now: "El benchmark muestra views altos pero engagement bajo; el corpus confirma que la gente responde a dinero cotidiano, no a claims bancarios.",
            level: "content",
            source_mix: ["corpus", "knowledge_base", "competitive_csv"],
            related_finding_ids: ["B-PER-02", "T-PER-01"],
            evidence_summary: "Payday y coste de vida concentran menciones; Monzo/NatWest ganan con formatos culturales o humanos.",
            what_to_do: "Lanzar una serie always-on de situaciones de dinero UK con creators mid-tier y CTA de conversacion, no de producto.",
            success_signal: "Suben comentarios y shares organicos por video frente al benchmark base.",
            confidence: "media"
          }
        ],
        future_signals: [
          {
            signal_id: "FS-01",
            title: "Fatiga contra consejos financieros genéricos",
            polarity: "future_barrier",
            horizon: "3_6_months",
            why_it_could_emerge: "El corpus ya castiga contenido financiero derivativo y la categoria TikTok esta saturada por hustle culture.",
            evidence_basis: ["B-CUL-02", "query_strategy_brief"],
            watch_metric: "Aumento de comentarios que llaman repetitivo, falso o generic al contenido de bancos.",
            related_finding_ids: ["B-CUL-02"],
            confidence: "media"
          }
        ],
        market_analysis: {
          headline: "La oportunidad no es hablar de banca; es entrar a la conversacion UK de dinero cotidiano",
          answer: "First direct debe construir un sistema de contenido que traduzca su equity humano/offline a formatos de participacion TikTok.",
          implications: ["Competir con Monzo por cultura, no por claims de banco.", "Usar creators para prestar confianza antes de pedir engagement."],
          patterns: [
            {
              title: "Creator trust antes que brand trust",
              why_it_matters: "NatWest demuestra que el formato human-story supera al branded spot cuando la categoria necesita credibilidad.",
              source_basis: ["competitive_brief", "corpus"],
              related_finding_ids: ["B-CUL-01"]
            }
          ]
        },
        evidence_deep_dives: [
          {
            finding_id: "B-PER-02",
            plain_language_title: "La audiencia espera el cobro para volver a respirar",
            description: "No es solo falta de dinero; es una rutina emocional donde payday reorganiza consumo, ansiedad y control.",
            channel_insight: "Vive sobre todo en TikTok cuando la mencion usa humor o confesion personal.",
            format_insight: "Funciona mejor como storytime corto, confession o lista de microdecisiones.",
            period_insight: "Revisar picos alrededor de fin de mes y ciclos de pago.",
            competitor_insight: "Si competidores ya ocupan money moments, first direct debe diferenciar por tono honesto y UK-specific.",
            future_watchout: "Puede convertirse en rechazo a bancos que romantizan budgeting sin reconocer presion real.",
            proof_points: ["Menciones recurrentes de esperar payday antes de comprar o resolver necesidades."]
          }
        ],
        emerging_patterns: [
          {
            pattern_id: "EP-01",
            title: "Customer service domina la narrativa operativa",
            pattern_type: "cx_signal",
            why_it_matters: "Aparece como tema transversal que no sólo frena compra; también define expectativa de experiencia.",
            data_basis: ["corpus", "customer_service_csv"],
            evidence_count: 42,
            source_breakdown: [{ source: "customer_service_csv", count: 28 }, { source: "social_listening", count: 14 }],
            related_finding_ids: ["B-PER-01"],
            confidence: "media",
            evidence_quotes: ["La gente no sabe con quién resolver cuando algo falla."]
          }
        ]
      },
      null,
      2
    ),
    "",
    "Comparative brief (client-safe, evidencia agregada):",
    comparativeContext || "(sin comparativo disponible)",
    "",
    `Findings disponibles (${args.findings.length}; triggers=${triggers.length}, barriers=${barriers.length}):`,
    args.findings
      .map(
        (f) =>
          `\n[${f.finding_id}] uuid=${f.id}\n  ${f.polarity} · ${f.layer} · movilidad=${f.movilidad} · score=${f.score_compuesto} · conf=${f.confidence}\n  nombre: ${f.nombre_comercial}\n  movilidad_razon: ${f.movilidad_razon.replace(/\s+/g, " ").slice(0, 420)}\n  verbatim protagonista: "${f.cita_protagonista_text.replace(/\s+/g, " ").slice(0, 320)}"`
      )
      .join("\n"),
    "",
    "Responde AHORA — solo el JSON:"
  ].join("\n");
}

function compactJson(value: unknown, maxChars: number): string {
  if (!value) return "";
  const profiles: JsonCompactionProfile[] = [
    { stringChars: 2_400, arrayItems: 80, knowledgeSources: 8, sourceInventory: 80, monthlySeries: 180 },
    { stringChars: 1_200, arrayItems: 40, knowledgeSources: 8, sourceInventory: 80, monthlySeries: 120 },
    { stringChars: 600, arrayItems: 24, knowledgeSources: 6, sourceInventory: 80, monthlySeries: 72 },
    { stringChars: 320, arrayItems: 12, knowledgeSources: 4, sourceInventory: 80, monthlySeries: 36 },
    { stringChars: 160, arrayItems: 8, knowledgeSources: 2, sourceInventory: 80, monthlySeries: 18 }
  ];

  for (const profile of profiles) {
    try {
      const serialized = JSON.stringify(compactJsonValue(value, profile, []));
      if (serialized.length <= maxChars) return serialized;
    } catch {
      return "";
    }
  }

  return JSON.stringify({
    truncated: true,
    reason: "Context exceeded the governed prompt budget after structured compaction.",
    top_level_keys: value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>)
      : []
  });
}

type JsonCompactionProfile = {
  stringChars: number;
  arrayItems: number;
  knowledgeSources: number;
  sourceInventory: number;
  monthlySeries: number;
};

function compactJsonValue(
  value: unknown,
  profile: JsonCompactionProfile,
  path: string[]
): unknown {
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= profile.stringChars
      ? normalized
      : `${normalized.slice(0, Math.max(0, profile.stringChars - 12))} [truncated]`;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const key = path.at(-1);
    const limit = key === "source_inventory"
      ? profile.sourceInventory
      : key === "monthly_series"
        ? profile.monthlySeries
        : key === "knowledge_sources"
          ? profile.knowledgeSources
          : profile.arrayItems;
    return value.slice(0, limit).map((item) => compactJsonValue(item, profile, [...path, "[]"]));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, compactJsonValue(item, profile, [...path, key])])
    );
  }
  return String(value);
}

export function renderTbRagContext(context: TbRagPromptContext | undefined): string {
  if (!context) return "(sin contexto Knowledge Base disponible)";
  const text = compactJson(
    {
      structured_observations: context.structured_observations ?? null,
      query_strategy_brief: context.query_strategy_brief ?? null,
      knowledge_sources: Array.isArray(context.knowledge_sources)
        ? context.knowledge_sources.slice(0, 8)
        : [],
      corpus_intelligence: context.corpus_intelligence ?? null
    },
    36_000
  );
  return text || "(sin contexto Knowledge Base disponible)";
}

export function buildHumanizerPrompt(args: { jsonText: string; outputLanguage?: string | null }): string {
  const outputLanguage = args.outputLanguage?.trim() || "Spanish (Mexico)";
  const englishOutput = outputLanguage.toLowerCase().startsWith("english");
  return [
    "Rol: Editor senior Noisia. Vas a humanizar un JSON de recomendaciones T&B sin cambiar su estructura.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble, NO uses markdown fences, NO expliques fuera del JSON.",
    "",
    "Tarea: reescribe SOLO los textos narrativos del JSON para que suenen a strategist humano.",
    `Idioma de salida: ${outputLanguage}. No traduzcas a otro idioma.`,
    englishOutput
      ? "Main job for this pass: translate/adapt EVERY client-visible Spanish narrative string into natural English while preserving ids and schema keys."
      : "Trabajo principal: dejar los textos en español natural, sin calcos raros.",
    englishOutput
      ? "Hard fail if any visible value remains in Spanish. Examples to translate: 'día de pago' → 'payday', 'barrera' → 'barrier', 'aparece en' → 'appears in'."
      : "No cambies ids ni llaves, sólo texto visible.",
    "",
    "Reglas de humanizer:",
    "- Elimina jerga consultora y LinkedIn-speak.",
    "- Prohibido: 'aprovechar sinergias', 'optimizar engagement', 'palanca de crecimiento', 'landscape', 'pivotal'.",
    "- Evita construcciones 'no es X, es Y'.",
    "- Mantén frases concretas: qué hacer, quién lo hace, cómo medirlo.",
    "- Mantén exactamente los mismos ids, arrays y llaves principales.",
    "- NO agregues findings nuevos.",
    "",
    "JSON a humanizar:",
    args.jsonText,
    "",
    "Responde AHORA — solo el JSON humanizado:"
  ].join("\n");
}

export function parseSynthesisResponse(raw: string): SynthesisResponse {
  const parsed = JSON.parse(extractBalancedJson(raw, "synthesis response")) as Record<string, unknown>;
  return normalizeSynthesisShape(parsed);
}

export function parseHumanizerResponse(raw: string): SynthesisResponse {
  const parsed = JSON.parse(extractBalancedJson(raw, "humanizer response")) as Record<string, unknown>;
  return normalizeSynthesisShape(parsed);
}

/** Normalize a tag for de-duplication (strip accents, collapse whitespace). */
export function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBalancedJson(raw: string, label: string): string {
  const noFences = raw.replace(/```(?:json)?/gi, "").trim();
  const start = noFences.indexOf("{");
  if (start === -1) throw new Error(`No JSON object in ${label}`);
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < noFences.length; i++) {
    const c = noFences[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(`Unbalanced JSON in ${label}`);
  return noFences.slice(start, end);
}

function normalizeSynthesisShape(parsed: Record<string, unknown>): SynthesisResponse {
  const activation = objectValue(parsed.activation_playbook);
  const friction = objectValue(parsed.friction_removal_plan);

  return {
    activation_playbook: {
      top_triggers_movibles: arrayValue(activation.top_triggers_movibles)
        .map((item) => {
          const v = objectValue(item);
          return {
            trigger_id: stringValue(v.trigger_id),
            nombre: stringValue(v.nombre),
            layer: layerValue(v.layer),
            evidencia: stringValue(v.evidencia)
          };
        })
        .filter((item) => item.trigger_id.length > 0),
      por_trigger_recomendacion: arrayValue(activation.por_trigger_recomendacion)
        .map((item) => {
          const v = objectValue(item);
          return {
            trigger_id: stringValue(v.trigger_id),
            medio_recomendado: stringValue(v.medio_recomendado),
            tono_recomendado: stringValue(v.tono_recomendado),
            riesgo_saturacion: riskValue(v.riesgo_saturacion),
            categoria_donde_aplica: stringArrayValue(v.categoria_donde_aplica)
          };
        })
        .filter((item) => item.trigger_id.length > 0),
      triggers_a_evitar: arrayValue(activation.triggers_a_evitar)
        .map((item) => {
          const v = objectValue(item);
          return {
            trigger_id: stringValue(v.trigger_id),
            razon: stringValue(v.razon),
            evidencia_competitiva: stringValue(v.evidencia_competitiva)
          };
        })
        .filter((item) => item.trigger_id.length > 0),
      nota: typeof activation.nota === "string" ? activation.nota.slice(0, 800) : undefined
    },
    friction_removal_plan: {
      top_barriers_movibles: arrayValue(friction.top_barriers_movibles)
        .map((item) => {
          const v = objectValue(item);
          return {
            barrier_id: stringValue(v.barrier_id),
            nombre: stringValue(v.nombre),
            layer: layerValue(v.layer),
            evidencia: stringValue(v.evidencia)
          };
        })
        .filter((item) => item.barrier_id.length > 0),
      por_barrier_intervencion: arrayValue(friction.por_barrier_intervencion)
        .map((item) => {
          const v = objectValue(item);
          return {
            barrier_id: stringValue(v.barrier_id),
            intervencion_sugerida: stringValue(v.intervencion_sugerida),
            tipo_intervencion: interventionTypeValue(v.tipo_intervencion),
            inversion_estimada: investmentValue(v.inversion_estimada),
            indicador_exito: stringValue(v.indicador_exito),
            responsable_sugerido: stringValue(v.responsable_sugerido)
          };
        })
        .filter((item) => item.barrier_id.length > 0),
      barriers_estructurales: arrayValue(friction.barriers_estructurales)
        .map((item) => {
          const v = objectValue(item);
          return {
            barrier_id: stringValue(v.barrier_id),
            nombre: stringValue(v.nombre),
            razon_estructural: stringValue(v.razon_estructural),
            recomendacion: stringValue(v.recomendacion)
          };
        })
        .filter((item) => item.barrier_id.length > 0)
    },
    action_studio: arrayValue(parsed.action_studio)
      .map((item, index) => {
        const v = objectValue(item);
        const findingIds = stringArrayValue(v.finding_ids);
        const primary = stringValue(v.primary_finding_id) || findingIds[0] || null;
        return {
          action_id: stringValue(v.action_id) || `AS-${String(index + 1).padStart(2, "0")}`,
          target_team: teamValue(v.target_team),
          kind: actionKindValue(v.kind),
          title: stringValue(v.title) || "Accion priorizada",
          finding_ids: findingIds,
          primary_finding_id: primary,
          rationale: stringValue(v.rationale),
          action_text: stringValue(v.action_text),
          suggested_channel: stringValue(v.suggested_channel) || null,
          suggested_format: stringValue(v.suggested_format) || null,
          success_signal: stringValue(v.success_signal),
          estimated_effort: investmentValue(v.estimated_effort),
          estimated_impact: impactValue(v.estimated_impact),
          confidence: confidenceValue(v.confidence),
          priority_rank: numberValue(v.priority_rank) || index + 1
        };
      })
      .filter((item) => item.action_text.length > 0)
      .slice(0, 12),
    emerging_patterns: arrayValue(parsed.emerging_patterns)
      .map((item, index) => {
        const v = objectValue(item);
        return {
          pattern_id: stringValue(v.pattern_id) || `EP-${String(index + 1).padStart(2, "0")}`,
          title: stringValue(v.title) || "Pattern emergente",
          pattern_type: patternTypeValue(v.pattern_type),
          why_it_matters: stringValue(v.why_it_matters),
          data_basis: stringArrayValue(v.data_basis),
          evidence_count: numberValue(v.evidence_count),
          source_breakdown: arrayValue(v.source_breakdown)
            .map((source) => {
              const item = objectValue(source);
              return { source: stringValue(item.source), count: numberValue(item.count) };
            })
            .filter((source) => source.source.length > 0)
            .slice(0, 6),
          related_finding_ids: stringArrayValue(v.related_finding_ids),
          confidence: confidenceValue(v.confidence),
          evidence_quotes: stringArrayValue(v.evidence_quotes).slice(0, 3)
        };
      })
      .filter((item) => item.why_it_matters.length > 0)
      .slice(0, 5),
    knowledge_impact: normalizeKnowledgeImpact(parsed.knowledge_impact),
    strategic_opportunities: arrayValue(parsed.strategic_opportunities)
      .map((item, index) => {
        const v = objectValue(item);
        return {
          opportunity_id: stringValue(v.opportunity_id) || `OP-${String(index + 1).padStart(2, "0")}`,
          title: stringValue(v.title) || "Oportunidad estrategica",
          decision: stringValue(v.decision),
          why_now: stringValue(v.why_now),
          level: opportunityLevelValue(v.level),
          source_mix: stringArrayValue(v.source_mix),
          related_finding_ids: stringArrayValue(v.related_finding_ids),
          evidence_summary: stringValue(v.evidence_summary),
          what_to_do: stringValue(v.what_to_do),
          success_signal: stringValue(v.success_signal),
          confidence: confidenceValue(v.confidence)
        };
      })
      .filter((item) => item.decision.length > 0 || item.what_to_do.length > 0)
      .slice(0, 8),
    future_signals: arrayValue(parsed.future_signals)
      .map((item, index) => {
        const v = objectValue(item);
        return {
          signal_id: stringValue(v.signal_id) || `FS-${String(index + 1).padStart(2, "0")}`,
          title: stringValue(v.title) || "Señal futura",
          polarity: futurePolarityValue(v.polarity),
          horizon: horizonValue(v.horizon),
          why_it_could_emerge: stringValue(v.why_it_could_emerge),
          evidence_basis: stringArrayValue(v.evidence_basis),
          watch_metric: stringValue(v.watch_metric),
          related_finding_ids: stringArrayValue(v.related_finding_ids),
          confidence: confidenceValue(v.confidence)
        };
      })
      .filter((item) => item.why_it_could_emerge.length > 0)
      .slice(0, 6),
    market_analysis: normalizeMarketAnalysis(parsed.market_analysis),
    evidence_deep_dives: arrayValue(parsed.evidence_deep_dives)
      .map((item) => {
        const v = objectValue(item);
        return {
          finding_id: stringValue(v.finding_id),
          plain_language_title: stringValue(v.plain_language_title),
          description: stringValue(v.description),
          channel_insight: stringValue(v.channel_insight),
          format_insight: stringValue(v.format_insight),
          period_insight: stringValue(v.period_insight),
          competitor_insight: stringValue(v.competitor_insight) || null,
          future_watchout: stringValue(v.future_watchout) || null,
          proof_points: stringArrayValue(v.proof_points)
        };
      })
      .filter((item) => item.finding_id.length > 0 && item.description.length > 0)
      .slice(0, 16)
  };
}

function normalizeKnowledgeImpact(value: unknown): KnowledgeImpactOutput {
  const v = objectValue(value);
  return {
    business_question_answer: stringValue(v.business_question_answer),
    confirmed_by_corpus: stringArrayValue(v.confirmed_by_corpus),
    contradicted_or_unproven: stringArrayValue(v.contradicted_or_unproven),
    decision_implications: stringArrayValue(v.decision_implications),
    strategic_constraints: stringArrayValue(v.strategic_constraints)
  };
}

function normalizeMarketAnalysis(value: unknown): MarketAnalysisOutput {
  const v = objectValue(value);
  return {
    headline: stringValue(v.headline),
    answer: stringValue(v.answer),
    implications: stringArrayValue(v.implications),
    patterns: arrayValue(v.patterns)
      .map((item) => {
        const p = objectValue(item);
        return {
          title: stringValue(p.title),
          why_it_matters: stringValue(p.why_it_matters),
          source_basis: stringArrayValue(p.source_basis),
          related_finding_ids: stringArrayValue(p.related_finding_ids)
        };
      })
      .filter((item) => item.title.length > 0 && item.why_it_matters.length > 0)
      .slice(0, 6)
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 1400) : "";
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean).slice(0, 8)
    : [];
}

function layerValue(value: unknown): TbLayer {
  const valid: TbLayer[] = ["psicologico", "personal", "social", "cultural"];
  return valid.includes(value as TbLayer) ? (value as TbLayer) : "personal";
}

function riskValue(value: unknown): "bajo" | "medio" | "alto" {
  return value === "bajo" || value === "medio" || value === "alto" ? value : "medio";
}

function investmentValue(value: unknown): "baja" | "media" | "alta" {
  return value === "baja" || value === "media" || value === "alta" ? value : "media";
}

function interventionTypeValue(value: unknown): BarrierIntervention["tipo_intervencion"] {
  const valid: BarrierIntervention["tipo_intervencion"][] = [
    "comunicacion",
    "producto",
    "proceso",
    "precio",
    "distribucion"
  ];
  return valid.includes(value as BarrierIntervention["tipo_intervencion"])
    ? (value as BarrierIntervention["tipo_intervencion"])
    : "comunicacion";
}

function teamValue(value: unknown): ActionStudioCard["target_team"] {
  const valid: ActionStudioCard["target_team"][] = [
    "brand_strategy",
    "creative_content",
    "product_cx",
    "retail_media",
    "measurement",
    "cultural_guardrails"
  ];
  return valid.includes(value as ActionStudioCard["target_team"])
    ? (value as ActionStudioCard["target_team"])
    : "creative_content";
}

function actionKindValue(value: unknown): ActionStudioCard["kind"] {
  const valid: ActionStudioCard["kind"][] = [
    "activation",
    "friction_removal",
    "alignment",
    "experiment",
    "guardrail",
    "structural_note"
  ];
  return valid.includes(value as ActionStudioCard["kind"])
    ? (value as ActionStudioCard["kind"])
    : "activation";
}

function confidenceValue(value: unknown): ActionStudioCard["confidence"] {
  return value === "alta" || value === "baja_direccional" ? value : "media";
}

function opportunityLevelValue(value: unknown): StrategicOpportunityOutput["level"] {
  const valid: StrategicOpportunityOutput["level"][] = ["brand", "content", "product_cx", "competitive", "measurement", "category"];
  return valid.includes(value as StrategicOpportunityOutput["level"]) ? value as StrategicOpportunityOutput["level"] : "content";
}

function futurePolarityValue(value: unknown): FutureSignalOutput["polarity"] {
  return value === "future_trigger" ? "future_trigger" : "future_barrier";
}

function horizonValue(value: unknown): FutureSignalOutput["horizon"] {
  if (value === "30_90_days" || value === "6_12_months") return value;
  return "3_6_months";
}

function impactValue(value: unknown): ActionStudioCard["estimated_impact"] {
  return value === "bajo" || value === "alto" ? value : "medio";
}

function patternTypeValue(value: unknown): EmergingPatternOutput["pattern_type"] {
  const valid: EmergingPatternOutput["pattern_type"][] = [
    "source_pattern",
    "unexpected_insight",
    "language_code",
    "cx_signal",
    "product_signal",
    "content_signal",
    "hypothesis"
  ];
  return valid.includes(value as EmergingPatternOutput["pattern_type"])
    ? (value as EmergingPatternOutput["pattern_type"])
    : "unexpected_insight";
}

function numberValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function parsePreflightResponse(raw: string): PreflightResult {
  const noFences = raw.replace(/```(?:json)?/gi, "").trim();
  const start = noFences.indexOf("{");
  if (start === -1) throw new Error("No JSON object in preflight response");
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < noFences.length; i++) {
    const c = noFences[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unbalanced JSON in preflight response");
  const parsed = JSON.parse(noFences.slice(start, end)) as Partial<PreflightResult>;
  const validDecisions: PreflightResult["decision"][] = ["PROCEDER", "PROCEDER_WITH_WARNINGS", "ABORTAR"];
  const decision = validDecisions.includes(parsed.decision as PreflightResult["decision"])
    ? (parsed.decision as PreflightResult["decision"])
    : "ABORTAR";
  return {
    checks: Array.isArray(parsed.checks)
      ? parsed.checks.filter((c) => c && typeof c.id === "string").map((c) => ({
          id: c.id as PreflightCheck["id"],
          result: c.result === "PASS" || c.result === "WARN" || c.result === "FAIL" ? c.result : "FAIL",
          reason: typeof c.reason === "string" ? c.reason : ""
        }))
      : [],
    decision,
    blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
  };
}
