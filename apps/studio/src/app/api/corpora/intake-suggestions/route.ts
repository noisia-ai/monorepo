import { z } from "zod";

import { buildAnthropicWebSearchTool } from "@/lib/anthropic/web-search";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { describeCountryCodes } from "@/lib/country-catalog";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { listThemesForUser } from "@/lib/data/themes";
import { buildStudyDataOsFieldSpecs, type StudyDataOsFieldSpecs } from "@/lib/data-os/field-specs";
import {
  STUDY_BUSINESS_QUESTION_MAX_CHARS,
  STUDY_CONTEXT_MAX_CHARS,
  STUDY_SOURCE_SNAPSHOT_MAX_CHARS,
  buildStudyContextPayload
} from "@/lib/study-intake-context";

export const runtime = "nodejs";

const bodySchema = z.object({
  brand_id: z.string().uuid().optional(),
  theme_id: z.string().uuid().optional(),
  study_name: z.string().max(180).optional(),
  methodology_slug: z.string().max(120).optional(),
  business_question: z.string().max(STUDY_BUSINESS_QUESTION_MAX_CHARS).default(""),
  study_context: z.string().max(STUDY_CONTEXT_MAX_CHARS).optional(),
  uploaded_sources: z.array(z.object({
    name: z.string().min(1).max(180),
    kind: z.string().max(80).optional(),
    text: z.string().max(STUDY_SOURCE_SNAPSHOT_MAX_CHARS).optional(),
    size_bytes: z.number().int().nonnegative().optional()
  })).max(12).default([]),
  decision_to_inform: z.array(z.string().min(1).max(180)).max(20).default([]),
  audience_segment: z.array(z.string().min(1).max(180)).max(20).default([]),
  category_context: z.string().max(1200).optional(),
  competitive_context: z.string().max(2400).optional(),
  hypotheses: z.array(z.string().min(1).max(260)).max(24).default([]),
  known_barriers: z.array(z.string().min(1).max(220)).max(24).default([]),
  known_triggers: z.array(z.string().min(1).max(220)).max(24).default([]),
  strategic_constraints: z.array(z.string().min(1).max(220)).max(24).default([]),
  success_criteria: z.array(z.string().min(1).max(260)).max(24).default([]),
  geo_focus: z.array(z.string().length(2)).min(1).max(6).default(["MX"]),
  target_window_months: z.coerce.number().int().min(1).max(36).default(12),
  refine_instruction: z.string().max(700).optional()
}).refine((data) => {
  const hasQuestion = data.business_question.trim().length >= 10;
  const hasContext = (data.study_context ?? "").trim().length >= 80;
  const hasSourceText = data.uploaded_sources.some((source) => (source.text ?? "").trim().length >= 80);
  return hasQuestion || hasContext || hasSourceText;
}, {
  path: ["business_question"],
  message: "Agrega una pregunta, pega contexto de estudio o adjunta una fuente de texto."
}).refine((data) => Number(Boolean(data.brand_id)) + Number(Boolean(data.theme_id)) === 1, {
  path: ["brand_id"],
  message: "Selecciona una marca o un theme para generar el objetivo."
});

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>;
  error?: { message?: string };
};

type StudyObjectiveSuggestions = {
  canonical_business_question: string;
  internal_decisions: string[];
  audiences: string[];
  category_context: string;
  competitive_context: string;
  hypotheses: string[];
  known_barriers: string[];
  known_triggers: string[];
  strategic_constraints: string[];
  success_criteria: string[];
  research_assumptions: string[];
  study_context_summary: string;
  source_requirements: string[];
  data_os_field_specs: StudyDataOsFieldSpecs;
};

type BrandDetail = NonNullable<Awaited<ReturnType<typeof getBrandDetailForUser>>>;
type ThemeDetail = Awaited<ReturnType<typeof listThemesForUser>>["data"][number];

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  const subject = parsed.data.brand_id
    ? await resolveBrand(session.appUser, parsed.data.brand_id)
    : await resolveTheme(session.appUser, parsed.data.theme_id ?? "");
  if (!subject) {
    return Response.json(
      { error: "not_found", message: "No se encontró contexto de Brand OS/Theme para generar el objetivo." },
      { status: 404 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error: "anthropic_key_missing",
        message: "No se pudo generar el objetivo porque falta la configuración de investigación."
      },
      { status: 503 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL_STUDY_INTAKE
    ?? process.env.ANTHROPIC_MODEL_BRAND_OS
    ?? process.env.ANTHROPIC_MODEL_DEFAULT
    ?? "claude-sonnet-4-6";

  try {
    const suggestions = await generateWithClaude(parsed.data, subject, model);
    return Response.json({
      status: "draft",
      provider: "anthropic",
      model,
      max_budget_note: "One Claude call with Brand OS/KB context; nothing is persisted until the user accepts and creates the study.",
      rag: {
        subject_type: subject.type,
        subject_id: subject.id,
        knowledge_sources_used: subject.type === "brand" ? subject.knowledgeSources.length : 0,
        competitors_used: subject.type === "brand" ? subject.competitors.length : 0
      },
      suggestions
    });
  } catch (error) {
    console.error("[study-intake-suggestions]", error);
    return Response.json(
      {
        error: "study_intake_research_failed",
        message: "No se pudo generar el objetivo. Intenta de nuevo."
      },
      { status: 502 }
    );
  }
}

async function resolveBrand(
  appUser: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>["appUser"],
  brandId: string
) {
  const brand = await getBrandDetailForUser(appUser, brandId);
  if (!brand) return null;
  return {
    type: "brand" as const,
    id: brand.id,
    context: buildBrandRagContext(brand),
    competitors: brand.competitors,
    knowledgeSources: brand.knowledgeSources
  };
}

async function resolveTheme(
  appUser: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>["appUser"],
  themeId: string
) {
  const themes = await listThemesForUser(appUser, { pageSize: 500 });
  const theme = themes.data.find((item) => item.id === themeId && item.status !== "archived");
  if (!theme) return null;
  return {
    type: "theme" as const,
    id: theme.id,
    context: buildThemeRagContext(theme),
    competitors: [],
    knowledgeSources: []
  };
}

async function generateWithClaude(
  input: z.infer<typeof bodySchema>,
  subject: Awaited<ReturnType<typeof resolveBrand>> | Awaited<ReturnType<typeof resolveTheme>>,
  model: string
): Promise<StudyObjectiveSuggestions> {
  if (!subject) throw new Error("Subject context is required.");
  const studyContextPayload = buildStudyContextPayload({
    businessQuestion: input.business_question,
    studyContext: input.study_context,
    sourceSnapshots: input.uploaded_sources.map((source) => ({
      name: source.name,
      kind: source.kind,
      text: source.text,
      sizeBytes: source.size_bytes
    }))
  });
  const timeoutMs = Number(process.env.ANTHROPIC_STUDY_INTAKE_TIMEOUT_MS ?? 150000);
  const maxSearches = Number(process.env.ANTHROPIC_STUDY_INTAKE_WEB_SEARCH_MAX_USES ?? 1);
  const startedAt = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 60000),
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: Number(process.env.ANTHROPIC_STUDY_INTAKE_MAX_TOKENS ?? 4096),
      temperature: 0.1,
      system: [
        "Eres un strategist y data scientist senior de Noisia preparando el Objective step de New Study.",
        "Noisia construye corpora, social listening, Brand OS, Knowledge Base y Data OS. Tu trabajo es convertir una pregunta de negocio en un contrato de estudio estructurado.",
        "El usuario puede mandar una pregunta corta o un documento largo de contexto previo. Si viene un documento largo, extrae una pregunta canónica breve y usa el documento como evidencia/contexto, no como el objetivo literal.",
        "Usa primero el contexto RAG local de Brand OS, competidores y Knowledge Base. Usa web search sólo para actualizar huecos críticos o validar contexto de mercado.",
        "Los campos de salida deben alimentar Data OS: objective, audience, seed terms, hypotheses, barriers, triggers, constraints, success criteria y assertions.",
        "No describas el formulario. No crees campos nuevos. No inventes hechos como si fueran verdad; marca hipótesis o restricciones cuando no haya evidencia.",
        "Al terminar, llama build_study_objective_suggestions. No agregues texto final fuera de la herramienta."
      ].join(" "),
      tools: [
        buildAnthropicWebSearchTool({
          maxUses: Number.isFinite(maxSearches) ? maxSearches : 1
        }),
        {
          name: "build_study_objective_suggestions",
          description: "Genera sugerencias estructuradas para los campos existentes del Objective step.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              internal_decisions: { type: "array", maxItems: 6, items: { type: "string" } },
              audiences: { type: "array", maxItems: 8, items: { type: "string" } },
              category_context: { type: "string", maxLength: 1600 },
              competitive_context: { type: "string", maxLength: 2200 },
              hypotheses: { type: "array", maxItems: 10, items: { type: "string" } },
              known_barriers: { type: "array", maxItems: 12, items: { type: "string" } },
              known_triggers: { type: "array", maxItems: 12, items: { type: "string" } },
              strategic_constraints: { type: "array", maxItems: 8, items: { type: "string" } },
              success_criteria: { type: "array", maxItems: 8, items: { type: "string" } },
              research_assumptions: { type: "array", maxItems: 6, items: { type: "string" } },
              canonical_business_question: { type: "string", maxLength: 420 },
              study_context_summary: { type: "string", maxLength: 900 },
              source_requirements: { type: "array", maxItems: 8, items: { type: "string" } },
              data_os_field_specs: {
                type: "object",
                additionalProperties: true,
                description: "Optional CDP-style specs for decisions, audience segments, barriers, triggers, hypotheses, constraints, and success metrics."
              }
            },
            required: [
              "canonical_business_question",
              "internal_decisions",
              "audiences",
              "category_context",
              "competitive_context",
              "hypotheses",
              "known_barriers",
              "known_triggers",
              "strategic_constraints",
              "success_criteria",
              "research_assumptions",
              "study_context_summary",
              "source_requirements"
            ]
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: buildPrompt(input, subject.context, studyContextPayload)
        }
      ]
    })
  });

  const json = (await response.json().catch(() => ({}))) as AnthropicResponse;
  if (!response.ok) {
    throw new Error(json.error?.message || response.statusText);
  }
  console.info("[study-intake-suggestions] Anthropic response received", {
    elapsedMs: Date.now() - startedAt
  });

  const raw = json.content?.map((item) => item.text).filter(Boolean).join("\n").trim() ?? "";
  const toolUse = json.content?.find((item) => item.type === "tool_use" && item.name === "build_study_objective_suggestions");
  const suggestions = toolUse?.input
    ? normalizeSuggestions(toolUse.input as Partial<StudyObjectiveSuggestions>)
    : normalizeSuggestions(parseJson(raw));
  assertCompleteSuggestions(suggestions);
  return withDataOsFieldSpecs(suggestions, input);
}

function buildPrompt(
  input: z.infer<typeof bodySchema>,
  ragContext: unknown,
  studyContextPayload: ReturnType<typeof buildStudyContextPayload>
) {
  const originalQuestionForPrompt = studyContextPayload.rawQuestionIsContext
    ? `(input largo promovido a contexto; ${studyContextPayload.businessQuestion.length} caracteres, ver bloque de contexto)`
    : studyContextPayload.businessQuestion || "(vacio)";
  return [
    "Genera un draft para el paso Objective de New Study.",
    "",
    "Pregunta de negocio candidata:",
    studyContextPayload.questionCandidate || "(el usuario no escribio una pregunta explicita; extraela del contexto)",
    "",
    "Input original del usuario en Business Question:",
    originalQuestionForPrompt,
    "",
    "Contexto de estudio pegado o leido de fuentes antes del objetivo:",
    studyContextPayload.studyContext || "(sin contexto adicional)",
    "",
    "Fuentes adjuntas disponibles para este draft:",
    JSON.stringify(input.uploaded_sources.map((source) => ({
      name: source.name,
      kind: source.kind,
      size_bytes: source.size_bytes,
      text_snapshot_chars: source.text?.length ?? 0
    })), null, 2),
    "",
    "Contexto RAG disponible desde Brand OS / Knowledge Base / catalogos:",
    JSON.stringify(ragContext, null, 2),
    "",
    "Campos ya capturados por el usuario:",
    JSON.stringify(
      {
        study_name: input.study_name,
        methodology_slug: input.methodology_slug,
        decision_to_inform: input.decision_to_inform,
        audience_segment: input.audience_segment,
        category_context: input.category_context,
        competitive_context: input.competitive_context,
        hypotheses: input.hypotheses,
        known_barriers: input.known_barriers,
        known_triggers: input.known_triggers,
        strategic_constraints: input.strategic_constraints,
        success_criteria: input.success_criteria,
        geo_focus: input.geo_focus,
        geo_focus_labels: describeCountryCodes(input.geo_focus),
        target_window_months: input.target_window_months,
        refine_instruction: input.refine_instruction
      },
      null,
      2
    ),
    "",
    "Salida requerida:",
    "- internal_decisions: 2-5 chips canonicos de catalogo, no recomendaciones largas. Usa exactamente el formato Area / palanca. Opciones preferidas: Positioning / differentiation, Messaging / value proposition, Retention / member lifecycle, Product / membership experience, Media / category demand capture, Pricing / promotion architecture, Service / delivery experience, Commerce / funnel conversion, Operations / service recovery, Measurement / KPI definition.",
    "- audiences: 2-6 segmentos accionables. Cada chip debe describir un segmento completo con facets, no atributos sueltos. Usa separador medio: Segmento · mercado/canal · condicion. No uses comas como separador.",
    "- category_context: 120-220 palabras. Estructura de mercado, lenguaje de categoria, ocasiones/momentos, tensiones y territorios que conviene observar.",
    "- competitive_context: 100-200 palabras. Usa competidores del Brand OS si existen. Di que comparar, que defender, que benchmarkear y que ruido evitar.",
    "- hypotheses: 4-8 hipotesis iniciales, una idea por item, listas para convertirse en assertions.",
    "- known_barriers: 4-10 barriers como chips. Usa catalogos cuando aplique y agrega terminos especificos si la marca lo requiere.",
    "- known_triggers: 4-10 triggers como chips. Usa catalogos cuando aplique y agrega terminos especificos si la marca lo requiere.",
    "- strategic_constraints: 2-6 restricciones de timing, marca, legal, data, categoria o operacion.",
    "- success_criteria: 3-6 criterios medibles para saber si el estudio sirvio.",
    "- research_assumptions: 2-5 notas internas sobre inferencias o gaps de evidencia.",
    "- canonical_business_question: 1 pregunta operable, maximo 2 frases. Si el usuario pego un diagnostico largo, sintetiza el objetivo de decision. No copies todo el diagnostico.",
    "- study_context_summary: 80-150 palabras sobre que evidencia recibiste y como debe usarse.",
    "- source_requirements: 2-6 fuentes o datos faltantes que conviene pedir/subir antes de lanzar.",
    "- data_os_field_specs: si puedes, devuelve specs CDP estructurados para decisions, audiences, barriers, triggers, hypotheses, constraints y success_metrics. Audience no es texto libre: incluye entity_type, markets, facets, behavioral_rules, computed_traits, evidence, activation_readiness y confidence cuando haya base.",
    "",
    "Reglas:",
    "- Escribe en espanol profesional y directo.",
    "- Usa los mercados por nombre al buscar; los codigos ISO describen el mercado del estudio, no la ubicacion del usuario que investiga.",
    "- No agregues markdown en arrays; cada item debe ser corto, estructurado y usable como chip.",
    "- internal_decisions no debe contener dos puntos, frases de accion ni verbos largos como 'definir', 'disenar', 'capitalizar'.",
    "- audiences no debe devolver genericos como 'Consumers in Mexico' si hay evidencia para segmentar mejor.",
    "- Si el usuario ya capturo contenido, respeta lo util y complementalo.",
    "- Si falta evidencia, usa lenguaje de hipotesis, no de hallazgo.",
    "- Devuelve SOLO JSON valido con las claves exactas solicitadas si no usas la herramienta."
  ].join("\n");
}

function buildBrandRagContext(brand: BrandDetail) {
  return {
    subject_type: "brand",
    brand: {
      id: brand.id,
      name: brand.displayName ?? brand.name,
      slug: brand.slug,
      organization: brand.organizationName,
      industry: brand.industry,
      subindustries: splitList(brand.industrySub),
      countries: brand.countries,
      strategic_description: compact(brand.description, 1800),
      aliases_handles: splitList(brand.brandSeedHandles).slice(0, 32)
    },
    competitors: brand.competitors.map((competitor) => ({
      name: competitor.canonicalName,
      vertical: competitor.vertical,
      sub_vertical: competitor.subVertical,
      notes: compact(competitor.notes, 300)
    })).slice(0, 32),
    knowledge_sources: brand.knowledgeSources
      .filter((source) => source.status === "processed")
      .slice(0, 8)
      .map((source) => ({
        id: source.id,
        kind: source.sourceKind,
        title: source.title,
        raw_text: compact(source.rawText, 1600),
        extracted_payload: compactJson(source.extractedPayload, 1200)
      }))
  };
}

function buildThemeRagContext(theme: ThemeDetail) {
  return {
    subject_type: "theme",
    theme: {
      id: theme.id,
      name: theme.name,
      slug: theme.slug,
      description: compact(theme.description, 1800),
      industry_focus: theme.industryFocus,
      geo_focus: theme.geoFocus,
      organization: theme.organizationName
    }
  };
}

function parseJson(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Structured suggestions were not returned.");
  return JSON.parse(raw.slice(start, end + 1)) as Partial<StudyObjectiveSuggestions>;
}

function normalizeSuggestions(value: Partial<StudyObjectiveSuggestions>): StudyObjectiveSuggestions {
  return {
    canonical_business_question: compact(value.canonical_business_question, 420),
    internal_decisions: normalizeInternalDecisions(value.internal_decisions).slice(0, 8),
    audiences: normalizeAudienceSegments(value.audiences).slice(0, 10),
    category_context: compact(value.category_context, 1600),
    competitive_context: compact(value.competitive_context, 2200),
    hypotheses: uniqueList(value.hypotheses).slice(0, 12),
    known_barriers: uniqueList(value.known_barriers).slice(0, 14),
    known_triggers: uniqueList(value.known_triggers).slice(0, 14),
    strategic_constraints: uniqueList(value.strategic_constraints).slice(0, 10),
    success_criteria: uniqueList(value.success_criteria).slice(0, 10),
    research_assumptions: uniqueList(value.research_assumptions).slice(0, 8),
    study_context_summary: compact(value.study_context_summary, 900),
    source_requirements: uniqueList(value.source_requirements).slice(0, 8),
    data_os_field_specs: buildStudyDataOsFieldSpecs({
      submittedSpecs: value.data_os_field_specs,
      businessQuestion: compact(value.canonical_business_question, 420),
      decisionToInform: normalizeInternalDecisions(value.internal_decisions).join("\n"),
      audienceSegment: normalizeAudienceSegments(value.audiences).join("\n"),
      categoryContext: compact(value.category_context, 1600),
      competitiveContext: compact(value.competitive_context, 2200),
      hypotheses: uniqueList(value.hypotheses).join("\n"),
      knownBarriers: uniqueList(value.known_barriers).join("\n"),
      knownTriggers: uniqueList(value.known_triggers).join("\n"),
      strategicConstraints: uniqueList(value.strategic_constraints).join("\n"),
      successCriteria: uniqueList(value.success_criteria).join("\n"),
      geoFocus: [],
      targetWindowMonths: 12,
      sourceManifest: []
    })
  };
}

function withDataOsFieldSpecs(
  suggestions: StudyObjectiveSuggestions,
  input: z.infer<typeof bodySchema>
): StudyObjectiveSuggestions {
  return {
    ...suggestions,
    data_os_field_specs: buildStudyDataOsFieldSpecs({
      submittedSpecs: suggestions.data_os_field_specs,
      businessQuestion: suggestions.canonical_business_question,
      decisionToInform: suggestions.internal_decisions.join("\n"),
      audienceSegment: suggestions.audiences.join("\n"),
      categoryContext: suggestions.category_context,
      competitiveContext: suggestions.competitive_context,
      studyContext: suggestions.study_context_summary,
      hypotheses: suggestions.hypotheses.join("\n"),
      knownBarriers: suggestions.known_barriers.join("\n"),
      knownTriggers: suggestions.known_triggers.join("\n"),
      strategicConstraints: suggestions.strategic_constraints.join("\n"),
      successCriteria: suggestions.success_criteria.join("\n"),
      geoFocus: input.geo_focus,
      targetWindowMonths: input.target_window_months,
      sourceManifest: input.uploaded_sources.map((source) => ({
        name: source.name,
        kind: source.kind,
        size_bytes: source.size_bytes
      }))
    })
  };
}

function assertCompleteSuggestions(value: StudyObjectiveSuggestions) {
  const missing: string[] = [];
  if (value.canonical_business_question.length < 10) missing.push("canonical_business_question");
  if (value.internal_decisions.length < 1) missing.push("internal_decisions");
  if (value.audiences.length < 1) missing.push("audiences");
  if (value.category_context.length < 140) missing.push("category_context");
  if (value.competitive_context.length < 100) missing.push("competitive_context");
  if (value.hypotheses.length < 3) missing.push("hypotheses");
  if (value.known_barriers.length < 3) missing.push("known_barriers");
  if (value.known_triggers.length < 3) missing.push("known_triggers");
  if (value.success_criteria.length < 2) missing.push("success_criteria");
  if (value.study_context_summary.length < 60) missing.push("study_context_summary");
  if (missing.length > 0) {
    throw new Error(`Claude returned incomplete study objective research: ${missing.join(", ")}`);
  }
}

function uniqueList(value: unknown) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? splitList(value) : [];
  return Array.from(
    new Set(
      list
        .map((item) => (typeof item === "string" ? item.replace(/\s+/g, " ").trim() : ""))
        .filter(Boolean)
    )
  );
}

function splitList(value: unknown) {
  if (typeof value !== "string") return [];
  return value
    .split(/\n|\t|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const DECISION_CATALOG = [
  "Positioning / differentiation",
  "Messaging / value proposition",
  "Retention / member lifecycle",
  "Product / membership experience",
  "Media / category demand capture",
  "Pricing / promotion architecture",
  "Service / delivery experience",
  "Commerce / funnel conversion",
  "Operations / service recovery",
  "Measurement / KPI definition"
];

function normalizeInternalDecisions(value: unknown) {
  const rawItems = uniqueList(value);
  const normalized = rawItems
    .map(normalizeDecisionChip)
    .filter(Boolean);
  return uniqueInOrder(normalized.length > 0 ? normalized : rawItems.map((item) => compact(item, 72)));
}

function normalizeDecisionChip(item: string) {
  const normalized = item
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const match = DECISION_CATALOG.find((catalogItem) => {
    const [area] = catalogItem.toLowerCase().split(" / ");
    return normalized.includes(area ?? catalogItem.toLowerCase());
  });
  if (match) return match;
  if (/\b(position|territorio|diferenc|defend|defender)\b/.test(normalized)) return "Positioning / differentiation";
  if (/\b(message|mensaje|comunic|propuesta|value|valor|claim)\b/.test(normalized)) return "Messaging / value proposition";
  if (/\b(retention|retencion|recompra|crm|member|membres|recurr)\b/.test(normalized)) return "Retention / member lifecycle";
  if (/\b(product|producto|membership|membresia|experiencia|app)\b/.test(normalized)) return "Product / membership experience";
  if (/\b(media|medios|search|demand|demanda|notoriedad|awareness)\b/.test(normalized)) return "Media / category demand capture";
  if (/\b(price|precio|pricing|descuento|promoc|promotion|promo)\b/.test(normalized)) return "Pricing / promotion architecture";
  if (/\b(service|servicio|delivery|entrega|support|soporte|atencion)\b/.test(normalized)) return "Service / delivery experience";
  if (/\b(commerce|ecommerce|e-commerce|funnel|conversion|carrito|checkout)\b/.test(normalized)) return "Commerce / funnel conversion";
  if (/\b(operacion|operation|recovery|recuperacion)\b/.test(normalized)) return "Operations / service recovery";
  if (/\b(kpi|metric|medicion|measurement|success)\b/.test(normalized)) return "Measurement / KPI definition";
  const beforeColon = item.split(":")[0]?.trim();
  return compact(beforeColon || item, 72);
}

function normalizeAudienceSegments(value: unknown) {
  return uniqueList(value)
    .map((item) => item.replace(/\s*,\s*/g, " · ").replace(/\s+\/\s+/g, " / ").replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0)
    .map((item) => compact(item, 120));
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function compact(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\r\n/g, "\n").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function compactJson(value: unknown, maxLength: number) {
  if (!value) return "";
  return compact(JSON.stringify(value), maxLength);
}
