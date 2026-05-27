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
    "5. language_uniformity — Idioma uniforme español:",
    "   PASS si >=90% es · WARN si entre 70-90% es · FAIL si <70% es (corpus es de otro idioma)",
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
          { id: "language_uniformity", result: "PASS", reason: "100% español MX." }
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

/** Max mentions to sample from a large corpus in one open-pass run.
 * For tiny corpora (<= cap), we process all of them. */
export const TB_OPEN_PASS_MAX_SAMPLE = 1500;

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
  mentions: OpenPassMentionInput[];
}): string {
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
    "- Tag corto (2-6 palabras), en español MX informal cuando aplique.",
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

/** Top N tags we ask Claude to code in one call. Beyond this the prompt
 * grows uncomfortably and the long-tail tags add noise more than signal. */
export const TB_CODING_TOP_TAGS = 120;

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
  tags: CodingTagInput[];
}): string {
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
 * The output JSON grows linearly so this also bounds response tokens. */
export const TB_HIERARCHY_MAX_CLUSTERS = 60;

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
  clusters: HierarchyClusterInput[];
}): string {
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
    "",
    "Tarea: para cada cluster (que ya tiene polaridad + layer + frecuencia del paso anterior), evaluar TRES dimensiones:",
    "",
    "DIMENSIÓN 1 — Nombre comercial:",
    "  Una etiqueta profesional, business-friendly, que podría ir en un slide ejecutivo.",
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
  findings: MobilityFindingInput[];
}): string {
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

export type SynthesisResponse = {
  activation_playbook: ActivationPlaybook;
  friction_removal_plan: FrictionRemovalPlan;
};

export function buildSynthesisPrompt(args: {
  brandName: string;
  industry: string | null;
  businessQuestion: string | null;
  findings: SynthesisFindingInput[];
}): string {
  const triggers = args.findings.filter((f) => f.polarity === "trigger");
  const barriers = args.findings.filter((f) => f.polarity === "barrier");

  return [
    "Rol: Eres un strategist senior de Noisia ejecutando Paso 6 del protocolo Triggers & Barriers.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble, NO uses markdown fences, NO expliques fuera del JSON.",
    "",
    "Contexto:",
    `- Marca: ${args.brandName}`,
    `- Industria: ${args.industry ?? "(no especificada)"}`,
    `- Pregunta de negocio: ${args.businessQuestion ?? "(no especificada)"}`,
    "",
    "Tarea: producir el output canónico que el cliente puede leer: activation_playbook + friction_removal_plan.",
    "No inventes evidencia. Si no hay triggers movibles suficientes, deja arrays vacios y escríbelo como limitacion accionable.",
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
    "",
    "Voz Noisia:",
    "- Español directo, accionable, sin LinkedIn-speak.",
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
        }
      },
      null,
      2
    ),
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

export function buildHumanizerPrompt(args: { jsonText: string }): string {
  return [
    "Rol: Editor senior Noisia. Vas a humanizar un JSON de recomendaciones T&B sin cambiar su estructura.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble, NO uses markdown fences, NO expliques fuera del JSON.",
    "",
    "Tarea: reescribe SOLO los textos narrativos del JSON para que suenen a strategist humano.",
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
    }
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
