import { z } from "zod";

import { buildAnthropicWebSearchTool } from "@/lib/anthropic/web-search";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { describeCountryCodes } from "@/lib/country-catalog";

export const runtime = "nodejs";

const bodySchema = z.object({
  brand: z.string().min(2).max(160),
  display_name: z.string().max(160).optional(),
  organization_name: z.string().max(180).optional(),
  countries: z.array(z.string().length(2)).min(1).max(12),
  industry: z.string().min(2).max(120),
  subindustries: z.array(z.string().min(2).max(160)).min(1).max(16),
  description: z.string().max(12000).optional(),
  aliases: z.array(z.string().min(1).max(240)).max(80).default([]),
  competitors: z.array(z.string().min(2).max(240)).max(80).default([]),
  knowledge_notes: z.string().max(50000).optional(),
  refine_instruction: z.string().max(600).optional()
});

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>;
  error?: { message?: string };
};

type BrandIntakeSuggestions = {
  strategic_description: string;
  aliases: string[];
  competitors: string[];
  knowledge_base_notes: string;
  research_assumptions: string[];
};

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error: "anthropic_key_missing",
        message: "No se pudo investigar la marca porque falta la configuración de investigación."
      },
      { status: 503 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL_BRAND_OS
    ?? process.env.ANTHROPIC_MODEL_DEFAULT
    ?? "claude-sonnet-4-6";
  let suggestions: BrandIntakeSuggestions;
  try {
    suggestions = await generateWithClaude(parsed.data, model);
  } catch (error) {
    console.error("[brand-os-intake-suggestions]", error);
    return Response.json(
      {
        error: "brand_research_failed",
        message: "No se pudo investigar la marca. Intenta de nuevo."
      },
      { status: 502 }
    );
  }

  return Response.json({
    status: "draft",
    provider: "anthropic",
    model,
    max_budget_note: "One small Claude call; suggestions are not persisted until the user accepts them.",
    suggestions
  });
}

async function generateWithClaude(input: z.infer<typeof bodySchema>, model: string): Promise<BrandIntakeSuggestions> {
  const timeoutMs = Number(process.env.ANTHROPIC_BRAND_OS_TIMEOUT_MS ?? 150000);
  const maxSearches = Number(process.env.ANTHROPIC_BRAND_OS_WEB_SEARCH_MAX_USES ?? 2);
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
      max_tokens: Number(process.env.ANTHROPIC_BRAND_OS_MAX_TOKENS ?? 4096),
      temperature: 0.1,
      system: [
        "Eres un estratega senior de Noisia creando un Brand OS intake inicial.",
        "Noisia colabora con marcas para construir inteligencia social, social listening, Data OS, análisis de señales y decisiones de marketing basadas en evidencia.",
        "Para una marca específica debes investigar en web antes de preparar los campos. Busca sitio oficial, app stores, perfiles/handles, noticias, competidores y contexto de mercado.",
        "Desambigua marcas con nombres compartidos: no confundas estudios, personas, memes o conceptos históricos con la marca comercial capturada.",
        "No inventes hechos verificables como revenue, campañas actuales, pricing, presencia geográfica o claims legales; si no aparece en fuentes, márcalo como hipótesis.",
        "No escribas prefacios, resúmenes ni explicación fuera de la herramienta; usa todo el presupuesto de salida en el tool call estructurado.",
        "Al terminar la investigación, llama build_brand_os_suggestions. No agregues texto final fuera de la herramienta."
      ].join(" "),
      tools: [
        buildAnthropicWebSearchTool({
          maxUses: Number.isFinite(maxSearches) ? maxSearches : 5
        }),
        {
          name: "build_brand_os_suggestions",
          description: "Prepara sugerencias investigadas para los campos existentes del Brand OS, sin crear campos nuevos.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              strategic_description: { type: "string", maxLength: 1400 },
              aliases: { type: "array", maxItems: 18, items: { type: "string" } },
              competitors: { type: "array", maxItems: 18, items: { type: "string" } },
              knowledge_base_notes: { type: "string", maxLength: 5000 },
              research_assumptions: { type: "array", maxItems: 6, items: { type: "string" } }
            },
            required: [
              "strategic_description",
              "aliases",
              "competitors",
              "knowledge_base_notes",
              "research_assumptions"
            ]
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: buildPrompt(input)
        }
      ]
    })
  });

  const json = (await response.json().catch(() => ({}))) as AnthropicResponse;
  if (!response.ok) {
    throw new Error(json.error?.message || response.statusText);
  }
  console.info("[brand-os-intake-suggestions] Anthropic response received", {
    elapsedMs: Date.now() - startedAt
  });

  const raw = json.content?.map((item) => item.text).filter(Boolean).join("\n").trim() ?? "";
  const toolUse = json.content?.find((item) => item.type === "tool_use" && item.name === "build_brand_os_suggestions");
  const suggestions = toolUse?.input
    ? normalizeSuggestions(toolUse.input as Partial<BrandIntakeSuggestions>, input)
    : normalizeSuggestions(parseJson(raw), input);
  assertUsableSuggestions(suggestions);
  return suggestions;
}

function buildPrompt(input: z.infer<typeof bodySchema>) {
  return [
    "Investiga la marca y genera un draft de campos para New Brand / Brand OS.",
    "",
    "Contexto capturado:",
    JSON.stringify(
      {
        brand: input.brand,
        display_name: input.display_name,
        organization_name: input.organization_name,
        countries: input.countries,
        country_labels: describeCountryCodes(input.countries),
        industry: input.industry,
        subindustries: input.subindustries,
        current_description: input.description,
        current_aliases: input.aliases,
        current_competitors: input.competitors,
        current_knowledge_notes: input.knowledge_notes,
        refine_instruction: input.refine_instruction
      },
      null,
      2
    ),
    "",
    "Investigación requerida antes de responder:",
    "- Identifica qué empresa/marca es realmente. Para nombres ambiguos, desambigua con país, industria y subindustria.",
    "- Revisa sitio oficial, app stores si aplica, perfiles/handles públicos, noticias recientes y fuentes de mercado.",
    "- Identifica qué vende/ofrece, modelo de negocio, canales, servicios, claims públicos y señales de expansión o relanzamiento.",
    "- Investiga aliases/handles útiles para social listening. No inventes handles exactos si no aparecen; usa variaciones de búsqueda como aliases.",
    "- Investiga competidores relevantes en el mercado capturado, mezclando especialistas, marketplaces y retailers cuando aplique.",
    "- Redacta retos de marketing/social listening derivados de la investigación: confianza, precio, entrega, app, servicio, categoría, ruido y desambiguación.",
    "",
    "Campos que debes preparar:",
    "- strategic_description: 90-140 palabras. Define quién es la marca, qué vende/ofrece, canales/modelo, mercado y por qué importa para Noisia. No describas el formulario.",
    "- aliases: 8-18 aliases/handles/términos de búsqueda útiles. Incluye handles públicos sólo si fueron encontrados; incluye variaciones sin acentos y desambiguadores.",
    "- competitors: 8-16 competidores relevantes investigados. Nombres limpios, uno por item.",
    "- knowledge_base_notes: notas de investigación accionables en 8-14 bullets. Incluye qué vende, qué promete, canales, contexto/noticias, posibles fricciones, desambiguación, 'Principales retos de investigación' con 4-6 retos, y fuentes consultadas como bullets de texto.",
    "- research_assumptions: 2-5 notas breves sobre qué fue inferido y qué requiere validación con fuentes. Esto es metadata interna, no un campo visible.",
    "",
    "Reglas:",
    "- Escribe en español profesional, directo, estilo estrategia Noisia.",
    "- Usa los mercados por nombre al buscar; los codigos ISO describen el mercado de la marca, no la ubicacion del usuario que investiga.",
    "- Evita decir 'probablemente' en exceso; usa 'hipótesis inicial' sólo donde haga falta.",
    "- Si una fuente demuestra un dato, escríbelo como hecho y agrega la fuente dentro de knowledge_base_notes.",
    "- Si el usuario ya escribió contenido, respétalo y mejóralo, no lo contradigas.",
    "- Devuelve SOLO JSON válido con estas claves exactas: strategic_description, aliases, competitors, knowledge_base_notes, research_assumptions."
  ].join("\n");
}

function parseJson(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Structured suggestions were not returned.");
  return JSON.parse(raw.slice(start, end + 1)) as Partial<BrandIntakeSuggestions>;
}

function normalizeSuggestions(
  value: Partial<BrandIntakeSuggestions>,
  input: z.infer<typeof bodySchema>
): BrandIntakeSuggestions {
  const aliases = uniqueList([
    ...uniqueList(value.aliases),
    ...fallbackBrandAliases(input)
  ]).slice(0, 16);
  const strategicDescription = compact(value.strategic_description, 1800)
    || fallbackStrategicDescription(input);
  const knowledgeBaseNotes = compact(value.knowledge_base_notes, 5000)
    || fallbackKnowledgeNotes(input);
  return {
    strategic_description: strategicDescription,
    aliases,
    competitors: uniqueList(value.competitors).slice(0, 24),
    knowledge_base_notes: knowledgeBaseNotes,
    research_assumptions: uniqueList([
      ...uniqueList(value.research_assumptions),
      ...(aliases.length < 6
        ? ["Aliases complementados con variaciones deterministicas del intake; validar handles exactos antes de queries finales."]
        : [])
    ]).slice(0, 8)
  };
}

function assertUsableSuggestions(value: BrandIntakeSuggestions) {
  const hasResearch = value.strategic_description.length >= 120
    || value.knowledge_base_notes.length >= 240
    || value.aliases.length > 0
    || value.competitors.length > 0;
  if (!hasResearch) throw new Error("Claude returned empty Brand OS research.");
}

function uniqueList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.replace(/\s+/g, " ").trim() : ""))
        .filter(Boolean)
    )
  );
}

function compact(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\r\n/g, "\n").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function fallbackBrandAliases(input: z.infer<typeof bodySchema>) {
  const brand = compact(input.brand, 160);
  const displayName = compact(input.display_name, 160);
  const organization = compact(input.organization_name, 180);
  return uniqueList([
    brand,
    displayName,
    organization,
    brand.toLowerCase(),
    brand.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    `${brand} ${input.industry}`,
    ...input.subindustries.map((subindustry) => `${brand} ${subindustry}`)
  ]);
}

function fallbackStrategicDescription(input: z.infer<typeof bodySchema>) {
  const countryLabels = describeCountryCodes(input.countries).join(", ");
  return [
    `${input.display_name || input.brand} requiere validacion investigada como marca de ${input.industry}`,
    input.subindustries.length > 0 ? `con foco inicial en ${input.subindustries.join(", ")}` : "",
    countryLabels ? `para ${countryLabels}` : "",
    "antes de abrir corpus, queries y analisis.",
    "Este borrador operativo existe para no bloquear el Brand OS cuando la investigacion externa regresa incompleta; debe validarse con sitio oficial, handles publicos, competidores reales, performance propia y social listening antes de usarse como contexto canonico."
  ].filter(Boolean).join(" ");
}

function fallbackKnowledgeNotes(input: z.infer<typeof bodySchema>) {
  const countryLabels = describeCountryCodes(input.countries).join(", ");
  return [
    `- Intake inicial: ${input.display_name || input.brand} / ${input.organization_name || input.brand}.`,
    `- Mercado capturado: ${countryLabels || input.countries.join(", ")}.`,
    `- Taxonomia inicial: ${input.industry}${input.subindustries.length ? ` / ${input.subindustries.join(", ")}` : ""}.`,
    "- Pendiente validar: sitio oficial, canales de venta, app, perfiles sociales, claims publicos, notas recientes y competidores directos.",
    "- Principales retos de investigacion: desambiguar menciones, separar ruido generico de categoria, mapear competidores reales, validar barreras/triggers de compra y conectar hallazgos con Data OS.",
    "- Este bloque es un fallback trazable; no debe tratarse como investigacion final."
  ].join("\n");
}
