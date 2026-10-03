import {
  buildEngineMethodologyBlock,
  type EngineSignalFindingInput,
  type EngineSignalMethodologyBlock
} from "@noisia/query-engine";

export type EngineSynthesisAnalysisInput = {
  methodology_slug: string;
  methodology_version: string;
  limitations: unknown;
};

export type EngineSynthesisSummaryInput = {
  findings: number;
  high_confidence: number;
  medium_confidence: number;
  directional_confidence: number;
};

export function buildEngineSynthesisPayload(args: {
  analysis: EngineSynthesisAnalysisInput;
  summary: EngineSynthesisSummaryInput;
  findings: EngineSignalFindingInput[];
}) {
  const engineBlock = buildEngineMethodologyBlock({
    methodologySlug: args.analysis.methodology_slug,
    methodologyVersion: args.analysis.methodology_version,
    findings: args.findings,
    limitations: args.analysis.limitations
  });
  const synthesis = {
    generated_from: "engine_step_synthesize",
    headline: args.summary.findings > 0
      ? engineBlock.summary
      : "Sin findings metodologicos suficientes todavia.",
    confidence_mix: {
      alta: args.summary.high_confidence,
      media: args.summary.medium_confidence,
      baja_direccional: args.summary.directional_confidence
    },
    engine_block_ready: engineBlock.charts.length > 0 && engineBlock.findings.length > 0,
    methodology_slug: args.analysis.methodology_slug
  };

  return {
    synthesis,
    engine_block: engineBlock,
    result_summary: {
      ...synthesis,
      charts: engineBlock.charts.length,
      conclusions: engineBlock.methodology_view.conclusions.length,
      readiness: engineBlock.methodology_view.readiness.status
    }
  };
}

export type EngineEditorialSynthesis = {
  summary: string | null;
  finding_titles: Array<{
    finding_id: string;
    title: string;
    reader_takeaway: string | null;
    confidence_note: string | null;
  }>;
  conclusions: EngineSignalMethodologyBlock["methodology_view"]["conclusions"];
  limitations: string[];
};

export function isDeterministicEngineSynthesisAllowed(env: Record<string, string | undefined> = process.env) {
  return env.ENGINE_ALLOW_DETERMINISTIC_SYNTHESIS === "true";
}

export function engineEditorialSynthesisRequiredError(reason: string) {
  return `Engine editorial synthesis requires Claude for real corpus runs; deterministic fallback is disabled. ${reason}`;
}

export function buildEngineEditorialSynthesisPrompt(args: {
  analysis: EngineSynthesisAnalysisInput;
  block: EngineSignalMethodologyBlock;
  findings: EngineSignalFindingInput[];
}) {
  const evidence = args.findings.slice(0, 24).map((finding) => ({
    finding_id: finding.findingKey,
    current_title: finding.name,
    dimensions: finding.dimensions,
    frequency: finding.frequency,
    score: finding.compositeScore,
    confidence: finding.confidence,
    evidence_count: finding.evidenceCount,
    quote: finding.quote,
    mention_ids: finding.mentionIds.slice(0, 8)
  }));

  return [
    "Eres el editor metodologico de Noisia Signal.",
    "Tu tarea es convertir codings reales de corpus en una lectura client-safe para un modulo vivo del reporte.",
    "No inventes datos, menciones, ejes, entidades ni claims. Usa solo los finding_id, dimensiones, scores y citas recibidas.",
    "Puedes mejorar el lenguaje editorial, pero debes mantener los finding_id exactos.",
    "Devuelve solo JSON valido. Sin markdown.",
    "",
    "Contrato JSON obligatorio:",
    JSON.stringify(
      {
        summary: "Lectura breve de 1-2 frases sobre lo que este lente revela y sus limites.",
        finding_titles: [
          {
            finding_id: "finding-key-exacto",
            title: "Titulo humano, especifico y accionable",
            reader_takeaway: "Que debe entender el lector de esta senal.",
            confidence_note: "Por que la confianza es alta/media/direccional segun evidencia."
          }
        ],
        conclusions: [
          {
            kind: "protect",
            title: "Conclusion editorial",
            detail: "Implicacion accionable sin repetir teoria.",
            finding_ids: ["finding-key-exacto"]
          }
        ],
        limitations: ["Limite concreto de evidencia o cobertura, si aplica."]
      },
      null,
      2
    ),
    "",
    "Reglas:",
    "- conclusions.kind debe ser uno de: protect, dispute, watch, validate.",
    "- Si la evidencia es baja, dilo con claridad. No conviertas direccional en certeza.",
    "- Si dos findings parecen duplicados, mencionalo en reader_takeaway pero no cambies IDs.",
    "- No agregues findings nuevos.",
    "- No uses nombres genericos como 'funcional', 'atencion que resuelve' si la cita permite una lectura mas precisa.",
    "",
    "Contexto del lente:",
    JSON.stringify(
      {
        methodology_slug: args.analysis.methodology_slug,
        methodology_version: args.analysis.methodology_version,
        deterministic_summary: args.block.summary,
        readiness: args.block.methodology_view.readiness,
        charts: args.block.charts.map((chart) => ({ chart_id: chart.chart_id, type: chart.type, title: chart.title })),
        limitations: args.block.limitations
      },
      null,
      2
    ),
    "",
    "Findings y evidencia reales:",
    JSON.stringify(evidence, null, 2)
  ].join("\n");
}

export function parseEngineEditorialSynthesisResponse(raw: string): EngineEditorialSynthesis {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Engine editorial synthesis response did not contain a JSON object.");
  }
  const parsed = JSON.parse(raw.slice(start, end + 1));
  const value = asRecord(parsed);
  return {
    summary: stringValue(value.summary) || null,
    finding_titles: arrayValue(value.finding_titles).map(asRecord).map((item) => ({
      finding_id: stringValue(item.finding_id),
      title: stringValue(item.title),
      reader_takeaway: stringValue(item.reader_takeaway) || null,
      confidence_note: stringValue(item.confidence_note) || null
    })).filter((item) => item.finding_id && item.title),
    conclusions: arrayValue(value.conclusions).map(asRecord).map((item) => ({
      kind: coerceConclusionKind(item.kind),
      title: stringValue(item.title),
      detail: stringValue(item.detail),
      finding_ids: stringArray(item.finding_ids).slice(0, 8)
    })).filter((item) => item.title || item.detail),
    limitations: stringArray(value.limitations).slice(0, 8)
  };
}

export function applyEngineEditorialSynthesis(
  block: EngineSignalMethodologyBlock,
  editorial: EngineEditorialSynthesis
): EngineSignalMethodologyBlock {
  const byFindingId = new Map(editorial.finding_titles.map((item) => [item.finding_id, item]));
  const titleFor = (findingId: string, fallback: string) => {
    const editorialTitle = byFindingId.get(findingId)?.title?.trim();
    return editorialTitle || fallback;
  };

  return {
    ...block,
    summary: editorial.summary?.trim() || block.summary,
    methodology_view: {
      ...block.methodology_view,
      conclusions: editorial.conclusions.length > 0
        ? editorial.conclusions
        : block.methodology_view.conclusions,
      rows: block.methodology_view.rows.map((row) => ({
        ...row,
        label: titleFor(row.finding_id, row.label),
        dimensions: {
          ...row.dimensions,
          editorial_takeaway: byFindingId.get(row.finding_id)?.reader_takeaway ?? row.dimensions.editorial_takeaway ?? null,
          editorial_confidence_note: byFindingId.get(row.finding_id)?.confidence_note ?? row.dimensions.editorial_confidence_note ?? null
        }
      }))
    },
    findings: block.findings.map((finding) => ({
      ...finding,
      title: titleFor(finding.finding_id, finding.title),
      dimensions: {
        ...finding.dimensions,
        editorial_takeaway: byFindingId.get(finding.finding_id)?.reader_takeaway ?? finding.dimensions.editorial_takeaway ?? null,
        editorial_confidence_note: byFindingId.get(finding.finding_id)?.confidence_note ?? finding.dimensions.editorial_confidence_note ?? null
      }
    })),
    limitations: uniqueStrings([...block.limitations, ...editorial.limitations])
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceConclusionKind(value: unknown): EngineSignalMethodologyBlock["methodology_view"]["conclusions"][number]["kind"] {
  if (value === "protect" || value === "dispute" || value === "watch" || value === "validate") return value;
  return "validate";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}
