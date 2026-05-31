import Link from "next/link";
import { notFound } from "next/navigation";

import { ApproveAnalysisButton } from "@/components/analysis/ApproveAnalysisButton";
import { SignalComposer } from "@/components/analysis/SignalComposer";
import { Icon, type IconName } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { getDraftSignalOutput } from "@/lib/data/signal";
import { buildSignalPayload } from "@/lib/signal/build";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

export default async function TbAnalysisReviewPage({
  params
}: {
  params: Promise<{ id: string; analysisId: string }>;
}) {
  const { id, analysisId } = await params;
  const session = await requireStudioUser(`/studio/corpora/${id}/analysis/${analysisId}`);
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) notFound();

  const state = await getTbAnalysisForCorpus(corpus.id, analysisId, { includeAggregates: true });
  if (!state) notFound();

  const { analysis, recommendations, gates, findingSummary } = state;
  const draftOutput = await getDraftSignalOutput(analysis.id);
  const signalDraft = draftOutput
    ? {
        id: draftOutput.id,
        title: draftOutput.title,
        headline: draftOutput.headline,
        summary: draftOutput.summary,
        status: draftOutput.status,
        manifest: draftOutput.manifest,
        publishedAt: draftOutput.publishedAt?.toISOString() ?? null
      }
    : null;
  const signalPreview = buildSignalPayload({
    state,
    corpus: {
      id: corpus.id,
      brandName: corpus.brandName,
      themeName: corpus.themeName,
      methodologyName: corpus.methodologyName,
      methodologySlug: corpus.methodologySlug,
      businessQuestion: corpus.businessQuestion,
      decisionToInform: corpus.decisionToInform
    }
  });
  const knowledgeImpact = asRecord(signalPreview.knowledge_impact);
  const knowledgeSources = arrayRecords(knowledgeImpact.sources_used);
  const opportunities = arrayRecords(signalPreview.strategic_opportunities);
  const emergingPatterns = arrayRecords(signalPreview.emerging_patterns);
  const actionCards = arrayRecords(signalPreview.action_cards);
  const competitive = asRecord(signalPreview.competitive);
  const competitiveEntities = arrayRecords(competitive.entities);
  const boundaries = asRecord(signalPreview.client_boundaries);
  const publicFindings = arrayRecords(signalPreview.findings);
  const activation = asRecord(analysis.activationPlaybook);
  const triggerRecs = recommendations.filter((rec) => rec.kind === "activation");
  const frictionRecs = recommendations.filter((rec) => rec.kind === "friction_removal");
  const structuralNotes = recommendations.filter((rec) => rec.kind === "structural_note");
  const canApprove = analysis.status === "needs_review";
  const failedPostGates = gates
    .filter((gate) => gate.gateName.startsWith("post_") && !gate.passed)
    .map((gate) => ({ gateName: gate.gateName, notes: gate.notes }));

  return (
    <div className="studio-page analysis-review-page">
      <section className="analysis-review-hero">
        <div>
          <Link prefetch={false} className="analysis-back-link" href={`/studio/corpora/${corpus.id}/engine`}>
            <Icon name="arrow-right" size={14} />
            Volver al engine
          </Link>
          <p className="vitals-eyebrow">Revisión del análisis</p>
          <h1>Síntesis estratégica</h1>
          <p>
            Lee lo que encontró el motor, valida si las acciones hacen sentido
            y aprueba sólo cuando el entregable ya esté listo para convertirse en reporte.
          </p>
        </div>
        <div className="analysis-review-actions">
          {analysis.status === "approved_by_im" || analysis.status === "approved_by_kam" ? (
            <SuccessPill>Aprobado</SuccessPill>
          ) : analysis.status === "needs_review" ? (
            <StatusPill tone="warn"><Icon name="info" size={12} /> Requiere revisión</StatusPill>
          ) : (
            <StatusPill tone={analysis.status === "failed" ? "error" : "running"}>
              <Icon name={analysis.status === "failed" ? "alert" : "spinner"} size={12} />
              {analysis.status}
            </StatusPill>
          )}
          <ApproveAnalysisButton
            corpusId={corpus.id}
            analysisId={analysis.id}
            disabled={!canApprove}
            failedGates={failedPostGates}
          />
        </div>
      </section>

      <section className="analysis-review-vitals">
        <MetricCard label="Hallazgos" value={findingSummary.total} />
        <MetricCard label="Barreras" value={findingSummary.barriers} />
        <MetricCard label="Señales positivas" value={findingSummary.triggers} />
        <MetricCard label="Accionables" value={findingSummary.movable} />
      </section>

      <section className="analysis-review-card analysis-review-brief">
        <div className="analysis-section-head">
          <SectionTitle icon="info" eyebrow="Brief + Knowledge Base" title="Lo que debe gobernar el reporte" />
          <span>{knowledgeSources.length} fuentes KB</span>
        </div>
        <div className="analysis-brief-grid">
          <div className="analysis-brief-block analysis-brief-block--wide">
            <span>Pregunta de negocio</span>
            <p>{analysis.businessQuestion || corpus.businessQuestion || "No hay pregunta de negocio guardada para este estudio."}</p>
          </div>
          <div className="analysis-brief-block">
            <span>Decisión interna</span>
            <p>{analysis.decisionToInform || corpus.decisionToInform || "No hay decisión interna guardada para este estudio."}</p>
          </div>
          <div className="analysis-brief-block">
            <span>Respuesta preliminar del Signal</span>
            <p>{stringValue(knowledgeImpact.business_question_answer) || "El payload todavía no trae una respuesta explícita cruzando brief, KB y corpus."}</p>
          </div>
        </div>
        <div className="analysis-kb-strip">
          {knowledgeSources.length > 0 ? (
            knowledgeSources.slice(0, 8).map((source) => (
              <article className="analysis-kb-source" key={stringValue(source.source_id) || stringValue(source.title)}>
                <strong>{stringValue(source.original_file_name) || stringValue(source.title) || "Fuente KB"}</strong>
                <p>{stringValue(source.summary) || "Fuente disponible sin resumen client-safe."}</p>
                <span>{stringValue(source.source_kind) || "knowledge_source"}</span>
              </article>
            ))
          ) : (
            <EmptyCard text="El review no encontró fuentes KB procesadas en el payload. Si el cliente subió archivos, esto debe revisarse antes de publicar." />
          )}
        </div>
      </section>

      <section className="analysis-review-card">
        <div className="analysis-section-head">
          <SectionTitle icon="check" eyebrow="Signal readiness" title="Componentes que sí llegarán al dashboard" />
          <span>{signalPreview.schema_version}</span>
        </div>
        <div className="analysis-readiness-grid">
          <ReadinessTile label="Findings públicos" value={publicFindings.length} detail="Decision Field + Evidence" />
          <ReadinessTile label="Opportunities" value={opportunities.length} detail="Prioridades accionables" />
          <ReadinessTile label="Action Studio" value={actionCards.length} detail={`${countClientReadyActions(actionCards)} con texto útil`} />
          <ReadinessTile label="Competitive" value={competitiveEntities.length} detail={competitiveEntities.length > 0 ? "Benchmark conectado" : "Sin entidades competitivas"} />
          <ReadinessTile label="Emerging Patterns" value={emergingPatterns.length} detail="Fuera del método T&B" />
          <ReadinessTile label="Boundaries" value={arrayValue(boundaries.limitations).length} detail="Límites client-safe" />
        </div>
      </section>

      {arrayValue(activation.top_triggers_movibles).length === 0 ? (
        <section className="analysis-empty-signal">
          <Icon name="info" size={18} />
          <div>
            <h2>Sin señales positivas suficientes</h2>
            <p>
              El modelo no inventó señales positivas: este corpus está dominado por barreras.
              La siguiente iteración debería capturar menciones positivas o casos de satisfacción.
            </p>
          </div>
        </section>
      ) : null}

      <div className="analysis-review-sections">
        <article className="analysis-review-card">
          <div className="analysis-section-head">
            <SectionTitle icon="arrow-up" eyebrow="Opportunities" title="Decisiones que cambian la estrategia" />
            <span>{opportunities.length}</span>
          </div>
          <div className="analysis-preview-list">
            {opportunities.length > 0 ? (
              opportunities.slice(0, 6).map((opportunity, index) => (
                <PreviewItem
                  key={stringValue(opportunity.opportunity_id) || index}
                  code={stringValue(opportunity.opportunity_id) || `OP-${index + 1}`}
                  title={stringValue(opportunity.title) || "Oportunidad estratégica"}
                  body={stringValue(opportunity.decision) || stringValue(opportunity.what_to_do) || stringValue(opportunity.evidence_summary)}
                  meta={stringValue(opportunity.level) || stringValue(opportunity.confidence)}
                />
              ))
            ) : (
              <EmptyCard text="El payload todavía no trae oportunidades estratégicas. Antes de publicar, Step 6 debe producir conclusiones que no sean sólo triggers o barriers." />
            )}
          </div>
        </article>

        <article className="analysis-review-card">
          <div className="analysis-section-head">
            <SectionTitle icon="wave" eyebrow="Emerging Patterns" title="Señales fuera del método" />
            <span>{emergingPatterns.length}</span>
          </div>
          <div className="analysis-preview-list analysis-preview-list--two">
            {emergingPatterns.length > 0 ? (
              emergingPatterns.slice(0, 6).map((pattern, index) => (
                <PreviewItem
                  key={stringValue(pattern.pattern_id) || index}
                  code={stringValue(pattern.pattern_id) || `EP-${index + 1}`}
                  title={stringValue(pattern.title) || "Pattern emergente"}
                  body={stringValue(pattern.why_it_matters)}
                  meta={`${numberValue(pattern.evidence_count)} evidencias`}
                />
              ))
            ) : (
              <EmptyCard text="No hay patrones emergentes listos. Si la pregunta del cliente no se responde sólo con T&B, este bloque debe regenerarse." />
            )}
          </div>
        </article>

        <article className="analysis-review-card">
          <div className="analysis-section-head">
            <SectionTitle icon="arrow-up" eyebrow="Plan de acción" title="Barreras que la marca sí puede mover" />
            <span>{frictionRecs.length} acciones</span>
          </div>
          <div className="recommendation-list">
            {frictionRecs.length > 0 ? (
              frictionRecs.map((rec) => (
                <RecommendationCard key={rec.id} rec={rec} />
              ))
            ) : (
              <EmptyCard text="Todavía no hay recomendaciones de reducción de fricción." />
            )}
          </div>
        </article>

        <article className="analysis-review-card">
          <div className="analysis-section-head">
            <SectionTitle icon="wave" eyebrow="Activación" title="Señales positivas para aprovechar" />
            <span>{triggerRecs.length}</span>
          </div>
          {triggerRecs.length > 0 ? (
            <div className="recommendation-list">
              {triggerRecs.map((rec) => <RecommendationCard key={rec.id} rec={rec} compact />)}
            </div>
          ) : (
            <EmptyCard text={stringValue(activation.nota_sobre_ausencia_de_triggers) || "Sin señales positivas movibles en este corpus."} />
          )}
        </article>

        <article className="analysis-review-card">
          <div className="analysis-section-head">
            <SectionTitle icon="layers" eyebrow="Contexto estructural" title="Barreras para alinear, no prometer" />
            <span>{structuralNotes.length}</span>
          </div>
          <div className="recommendation-list recommendation-list--compact-grid">
            {structuralNotes.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} compact />
            ))}
          </div>
        </article>
      </div>

      <section className="analysis-review-card">
        <div className="analysis-section-head">
          <SectionTitle icon="check" eyebrow="Control de calidad" title="Chequeos automáticos" />
          <span>{gates.length || "pendiente"}</span>
        </div>
        {gates.length > 0 ? (
          <div className="quality-gate-list">
            {gates.map((gate) => (
              <div className="quality-gate-row" key={gate.id}>
                <span className={`quality-gate-icon ${gate.passed ? "quality-gate-icon--ok" : "quality-gate-icon--warn"}`}>
                  {gate.passed ? <Icon name="check" size={15} /> : <Icon name="alert" size={15} />}
                </span>
                <strong>{friendlyGateName(gate.gateName)}</strong>
                <span>
                  {friendlyGateNotes(gate.notes)}
                  {!gate.passed ? (
                    <em>{gateResolutionHint(gate.gateName)}</em>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyCard text="Los chequeos automáticos todavía no están activos. Por ahora, la revisión del analista es la fuente de verdad." />
        )}
      </section>

      {analysis.status === "approved_by_im" || analysis.status === "approved_by_kam" ? (
        <SignalComposer
          analysisId={analysis.id}
          brandName={corpus.brandName ?? corpus.themeName ?? "la marca"}
          corpusId={corpus.id}
          draft={signalDraft}
        />
      ) : null}
    </div>
  );
}

function SectionTitle({ icon, eyebrow, title }: { icon: IconName; eyebrow: string; title: string }) {
  return (
    <div className="analysis-section-title">
      <span className="analysis-section-icon">
        <Icon name={icon} size={17} />
      </span>
      <div>
        <p className="vitals-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div className="analysis-metric-card">
      <span>{label}</span>
      <strong>{typeof value === "number" ? new Intl.NumberFormat("es-MX").format(value) : value ?? "-"}</strong>
    </div>
  );
}

function ReadinessTile({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="analysis-readiness-tile">
      <span>{label}</span>
      <strong>{typeof value === "number" ? new Intl.NumberFormat("es-MX").format(value) : value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function PreviewItem({
  code,
  title,
  body,
  meta
}: {
  code: string;
  title: string;
  body: string;
  meta?: string;
}) {
  return (
    <article className="analysis-preview-item">
      <header>
        <span>{code}</span>
        {meta ? <em>{meta}</em> : null}
      </header>
      <h3>{title}</h3>
      <p>{body || "Falta redacción client-safe para este bloque; debe regenerarse antes de publicar."}</p>
    </article>
  );
}

function RecommendationCard({
  rec,
  compact = false
}: {
  rec: {
    findingHumanId: string | null;
    findingName: string | null;
    kind: string;
    intervencionSugerida: string | null;
    recomendacion: string | null;
    razonEstructural: string | null;
    indicadorExito: string | null;
    responsableSugerido: string | null;
    tipoIntervencion: string | null;
    inversionEstimada: string | null;
    confidence: string | null;
    layer: string | null;
  };
  compact?: boolean;
}) {
  const mainText = rec.intervencionSugerida ?? rec.recomendacion ?? rec.razonEstructural ?? recommendationFallback(rec);

  return (
    <article className={`recommendation-card${compact ? " recommendation-card--compact" : ""}`}>
      <header>
        <div className="recommendation-title">
          <div>
            <span>{rec.findingHumanId ?? rec.kind}</span>
            <h3>{rec.findingName ?? "Hallazgo sin nombre"}</h3>
          </div>
        </div>
        <StatusPill tone={rec.confidence === "alta" ? "success" : rec.confidence === "baja_direccional" ? "warn" : "info"}>
          {rec.confidence ?? "media"}
        </StatusPill>
      </header>
      <p>{mainText}</p>
      {!compact ? (
        <dl>
          {rec.tipoIntervencion ? (
            <>
              <dt>Tipo</dt>
              <dd>{rec.tipoIntervencion}</dd>
            </>
          ) : null}
          {rec.inversionEstimada ? (
            <>
              <dt>Esfuerzo</dt>
              <dd>{rec.inversionEstimada}</dd>
            </>
          ) : null}
          {rec.indicadorExito ? (
            <>
              <dt>Señal de éxito</dt>
              <dd>{rec.indicadorExito}</dd>
            </>
          ) : null}
          {rec.responsableSugerido ? (
            <>
              <dt>Responsable</dt>
              <dd>{rec.responsableSugerido}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="analysis-empty-card">
      <Icon name="info" size={16} />
      <p>{text}</p>
    </div>
  );
}

function friendlyGateName(name: string) {
  const names: Record<string, string> = {
    post_actionability_complete: "Acciones completas",
    post_confidence_calibrated: "Confianza calibrada",
    post_hierarchy_complete: "Métricas completas",
    post_human_voice_and_no_projection: "Lenguaje humano",
    post_layer_coverage: "Cobertura de niveles",
    post_mobility_marked: "Accionabilidad marcada",
    post_synthesis_complete: "Síntesis completa",
    post_traceability_complete: "Trazabilidad de evidencia",
    preflight_business_question: "Pregunta de negocio clara",
    preflight_language_uniformity: "Idioma consistente",
    preflight_polarity_balance: "Mezcla de experiencias",
    preflight_source_balance: "Diversidad de fuentes",
    preflight_window_temporal: "Ventana temporal suficiente",
  };
  return names[name] ?? name.replace(/^preflight_/, "").replaceAll("_", " ");
}

function friendlyGateNotes(notes: string | null) {
  if (!notes) return "Sin observaciones.";
  return notes
    .replace(/^PASS:\s*/i, "")
    .replace(/^FAIL:\s*/i, "Observación: ")
    .replace(/^WARN:\s*/i, "Atención: ")
    .replace(/\bCorpus\b/g, "El corpus")
    .replace(/\bthreshold\b/gi, "umbral");
}

function gateResolutionHint(name: string) {
  const hints: Record<string, string> = {
    post_actionability_complete: "Cómo atenderlo: vuelve a correr síntesis pidiendo acción, esfuerzo, responsable y señal de éxito por recomendación.",
    post_confidence_calibrated: "Cómo atenderlo: revisa si los hallazgos con poca evidencia deben quedar como direccionales o moverse a limitaciones.",
    post_hierarchy_complete: "Cómo atenderlo: re-corre jerarquía/síntesis para completar frecuencia, intensidad, score y prioridad estratégica.",
    post_human_voice_and_no_projection: "Cómo atenderlo: re-genera la síntesis con instrucción editorial: sin guiones largos, sin claims inventados y con lenguaje natural MX.",
    post_layer_coverage: "Cómo atenderlo: si el corpus no trae cierto nivel, déjalo como limitación; si sí lo trae, re-corre el análisis pidiendo cobertura explícita.",
    post_mobility_marked: "Cómo atenderlo: re-corre movilidad para separar lo movible por marca, lo parcialmente movible y lo estructural.",
    post_synthesis_complete: "Cómo atenderlo: re-corre síntesis para completar playbook, plan de fricción y notas estructurales antes de publicar.",
    post_traceability_complete: "Cómo atenderlo: amplía corpus o re-corre síntesis pidiendo cita protagonista y al menos 3 verbatims por hallazgo; si el insight es útil pero direccional, aprueba con advertencia."
  };
  return hints[name] ?? "Cómo atenderlo: revisa el chequeo, ajusta el corpus o re-corre la síntesis. Si es una limitación aceptable, aprueba con advertencia.";
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function countClientReadyActions(actions: JsonRecord[]) {
  return actions.filter((action) => stringValue(action.action_text).trim().length > 20).length;
}

function recommendationFallback(rec: {
  findingHumanId: string | null;
  findingName: string | null;
  kind: string;
}) {
  const subject = rec.findingName || rec.findingHumanId || "este hallazgo";
  if (rec.kind === "activation") {
    return `Este trigger fue detectado como señal positiva, pero Step 6 no dejó una intervención redactada. Antes de publicar, conviértelo en una oportunidad concreta para ${subject}.`;
  }
  if (rec.kind === "structural_note") {
    return `Este hallazgo está marcado como contexto estructural. Úsalo como límite de decisión y evita prometer una acción directa sobre ${subject}.`;
  }
  return `Falta redacción de acción para ${subject}. Antes de publicar, Step 6 debe convertir el hallazgo en qué hacer, responsable, esfuerzo y señal de éxito.`;
}
