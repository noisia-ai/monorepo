import type { getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { defaultSignalManifest, type SignalModuleKey } from "@/lib/signal/manifest";

type AnalysisState = NonNullable<Awaited<ReturnType<typeof getTbAnalysisForCorpus>>>;

type BuildSignalPayloadArgs = {
  state: AnalysisState;
  corpus: {
    id: string;
    brandName: string | null;
    themeName: string | null;
    methodologyName: string | null;
    methodologySlug: string | null;
    businessQuestion: string | null;
  };
  manifest?: Partial<Record<SignalModuleKey, boolean>>;
  headline?: string | null;
  summary?: string | null;
};

export function normalizeSignalManifest(input?: Partial<Record<SignalModuleKey, boolean>>) {
  return {
    ...defaultSignalManifest,
    ...(input ?? {})
  };
}

export function buildSignalPayload(args: BuildSignalPayloadArgs) {
  const manifest = normalizeSignalManifest(args.manifest);
  const { analysis, recommendations, gates, findingSummary, findings, aggregates } = args.state;
  const brandName = args.corpus.brandName ?? args.corpus.themeName ?? "la marca";
  const friction = recommendations.filter((rec) => rec.kind === "friction_removal");
  const activation = recommendations.filter((rec) => rec.kind === "activation");
  const structural = recommendations.filter((rec) => rec.kind === "structural_note");
  const failedGates = gates.filter((gate) => !gate.passed);

  // Build a finding_human_id → enrichment map for O(1) lookups while
  // serializing recommendations. Defensive default if `findings` is absent
  // (older callers).
  const findingsByHumanId = new Map<string, { quote: string; journeyIntensity: { consideracion: number; compra: number; siniestro: number; renovacion: number } }>();
  for (const f of findings ?? []) {
    findingsByHumanId.set(f.findingHumanId, {
      quote: f.quote,
      journeyIntensity: f.journeyIntensity
    });
  }

  const serialize = (rec: AnalysisState["recommendations"][number]) =>
    serializeRecommendation(rec, findingsByHumanId);

  return {
    generated_at: new Date().toISOString(),
    report: {
      brand_name: brandName,
      methodology_name: args.corpus.methodologyName ?? "Triggers & Barriers",
      methodology_slug: args.corpus.methodologySlug ?? "triggers-barriers",
      business_question: args.corpus.businessQuestion,
      headline: args.headline?.trim() || `Lo que frena a México de contratar ${brandName}`,
      summary:
        args.summary?.trim() ||
        "Lectura editorial del corpus aprobado: barreras accionables, contexto estructural y movimientos recomendados para la marca."
    },
    manifest,
    metrics: {
      findings_total: findingSummary.total,
      barriers_total: findingSummary.barriers,
      triggers_total: findingSummary.triggers,
      movable_total: findingSummary.movable
    },
    overview: {
      top_barriers: friction.slice(0, 5).map((rec, index) => {
        const enrichment = findingsByHumanId.get(rec.findingHumanId ?? "");
        return {
          rank: index + 1,
          id: rec.findingHumanId,
          label: rec.findingName,
          confidence: rec.confidence,
          action: rec.intervencionSugerida,
          success_signal: rec.indicadorExito,
          // Real protagonist verbatim from tb_finding_citations
          quote: enrichment?.quote ?? null
        };
      }),
      // TODO mejora-futura: generar esta lectura editorial desde el análisis aprobado, no con una síntesis fija del MVP.
      editorial_note:
        analysis.frictionRemovalPlan && typeof analysis.frictionRemovalPlan === "object"
          ? "El corpus está dominado por fricciones de confianza, claridad contractual y experiencia de siniestro. La oportunidad no es prometer más: es probar mejor."
          : null
    },
    barriers: friction.map(serialize),
    triggers: activation.map(serialize),
    actions: {
      best_move: friction[0] ? serialize(friction[0]) : null,
      alternatives: friction.slice(1).map(serialize),
      structural_notes: structural.map(serialize)
    },
    quality: {
      gates_total: gates.length,
      failed: failedGates.map((gate) => ({ name: gate.gateName, notes: gate.notes }))
    },
    limitations: {
      compare: "On hold hasta tener corpora competidores aprobados.",
      cross_industry: "On hold hasta tener librería curada de referencias.",
      stream_graph: "On hold hasta generar series semanales por hallazgo."
    },
    // Block consumed by Signal dashboard charts. Feeds polarity donut, layer
    // bars, mobility split, source breakdown, volume timeline, severity scatter,
    // top findings by share-of-voice, and the verbatim explorer.
    aggregates: aggregates ?? null
  };
}

function serializeRecommendation(
  rec: AnalysisState["recommendations"][number],
  findingsByHumanId: Map<string, { quote: string; journeyIntensity: { consideracion: number; compra: number; siniestro: number; renovacion: number } }>
) {
  const enrichment = findingsByHumanId.get(rec.findingHumanId ?? "");
  return {
    id: rec.id,
    finding_id: rec.findingHumanId,
    finding_name: rec.findingName,
    kind: rec.kind,
    layer: rec.layer,
    confidence: rec.confidence,
    movilidad: rec.movilidad,
    text: rec.intervencionSugerida ?? rec.recomendacion ?? rec.razonEstructural,
    type: rec.tipoIntervencion,
    effort: rec.inversionEstimada,
    success_signal: rec.indicadorExito,
    owner: rec.responsableSugerido,
    medium: rec.medioRecomendado,
    tone: rec.tonoRecomendado,
    // Enrichment from tb_findings + tb_finding_citations for editorial render.
    quote: enrichment?.quote ?? null,
    journey_intensity: enrichment?.journeyIntensity ?? null
  };
}
