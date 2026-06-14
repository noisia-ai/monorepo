import Link from "next/link";
import { notFound } from "next/navigation";

import { ApproveAnalysisButton } from "@/components/analysis/ApproveAnalysisButton";
import { SignalPulseReviewComposer } from "@/components/analysis/SignalPulseReviewComposer";
import { SignalComposer } from "@/components/analysis/SignalComposer";
import { Icon, type IconName } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { getDraftSignalOutput } from "@/lib/data/signal";
import { pool } from "@/lib/db";
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
  if (corpus.methodologySlug === "signal-pulse") {
    const state = await getSignalPulseReviewState(corpus.id, analysisId);
    if (!state) notFound();
    return <SignalPulseAnalysisReview corpus={corpus} state={state} />;
  }

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
          analysisPlan={corpus.analysisPlan}
          brandName={corpus.brandName ?? corpus.themeName ?? "la marca"}
          corpusId={corpus.id}
          draft={signalDraft}
        />
      ) : null}
    </div>
  );
}

type SignalPulseReviewState = Awaited<ReturnType<typeof getSignalPulseReviewState>> extends infer T ? NonNullable<T> : never;

function SignalPulseAnalysisReview({
  corpus,
  state
}: {
  corpus: NonNullable<Awaited<ReturnType<typeof getCorpusForUser>>>;
  state: SignalPulseReviewState;
}) {
  const meta = asRecord(state.analysis.meta_json);
  const signalPulseMeta = asRecord(meta.signal_pulse);
  const readiness = asRecord(signalPulseMeta.readiness);
  const cluster = asRecord(signalPulseMeta.cluster);
  const interpretation = asRecord(signalPulseMeta.interpretation);
  const qualityGates = arrayRecords(meta.quality_gates);
  const failedGates = qualityGates.filter((gate) => gate.passed === false);
  const noisySignals = state.signals.filter((signal) => looksNonActionableSignal(signal.title, signal.description, signal.dimensions));
  const publishableSignals = state.signals.filter((signal) => isPublishableSignal(signal.title, signal.description, signal.dimensions, Number(signal.current_volume ?? signal.volume ?? 0)));
  const inactiveCutSignals = state.signals.filter((signal) => isPublishCandidate(signal.dimensions) && Number(signal.current_volume ?? signal.volume ?? 0) <= 0);
  const hiddenSignalCount = Math.max(0, state.signals.length - publishableSignals.length);
  const repeatedMoveCount = state.moves.filter((move) => move.action_text.includes("Bajarlo a una serie corta")).length;
  const reviewIssues = [
    ...failedGates.map((gate) => `Gate fallido: ${stringValue(gate.id) || "quality_gate"}`),
    ...noisySignals.slice(0, 6).map((signal) => `Señal requiere curaduría: ${signal.title}`),
    publishableSignals.length < 3 ? `${publishableSignals.length} señales publicables en el corte actual; mínimo 3 para publicar.` : null,
    inactiveCutSignals.length > 0 ? `${inactiveCutSignals.length} señales no tienen volumen en el corte actual.` : null,
    repeatedMoveCount >= 3 ? `${repeatedMoveCount} marketing moves repiten la misma fórmula.` : null
  ].filter((issue): issue is string => Boolean(issue));
  const publishBlocked = state.analysis.status !== "needs_review" && state.analysis.status !== "approved"
    ? true
    : reviewIssues.length > 0;
  const measuredMentions = Number(readiness.conversation_mentions ?? 0);
  const signalPulseMentions = Number(readiness.signal_pulse_mentions ?? 0);
  const sampledRows = Number(cluster.mentions_sampled ?? 0);
  const maxClaudeSamples = Math.min(state.signals.length, 12) * 6;
  const cutMeta = asRecord(signalPulseMeta.cut);
  const cutLabel = (state.cut?.label ?? stringValue(cutMeta.label)) || "Corte pendiente";
  const dataThrough = (state.cut?.period_end ?? stringValue(cutMeta.data_through)) || null;
  const windowStart = (state.cut?.window_start ?? stringValue(cutMeta.window_start)) || null;
  const windowEnd = (state.cut?.window_end ?? stringValue(cutMeta.window_end)) || dataThrough;
  const defaultHeadline = stringValue(interpretation.headline) || `${corpus.brandName ?? corpus.themeName ?? "La marca"} necesita revisión editorial de señales antes de publicar.`;
  const defaultSummary = stringValue(interpretation.body) || "Revisa señales, evidencia, moves y gates antes de abrir el Pulse al cliente.";

  return (
    <div className="studio-page analysis-review-page">
      <section className="analysis-review-hero">
        <div>
          <Link prefetch={false} className="analysis-back-link" href={`/studio/corpora/${corpus.id}/engine`}>
            <Icon name="arrow-right" size={14} />
            Volver al engine
          </Link>
          <p className="vitals-eyebrow">Review Signal Pulse</p>
          <h1>Revisión táctica antes de publicar</h1>
          <p>
            Valida que las señales sean accionables, que los moves no sean genéricos y que el reporte sea honesto
            sobre qué midió SQL/embeddings y qué interpretó Claude.
          </p>
        </div>
        <div className="analysis-review-actions">
          <StatusPill tone={publishBlocked ? "warn" : "success"}>
            <Icon name={publishBlocked ? "alert" : "check"} size={12} />
            {publishBlocked ? "Requiere curaduría" : "Listo para publicar"}
          </StatusPill>
          <Link prefetch={false} className="wizard-cta wizard-cta--secondary" href={`/studio/corpora/${corpus.id}/mentions`}>
            <Icon name="search" size={15} />
            Revisar menciones
          </Link>
        </div>
      </section>

      <section className="analysis-review-vitals">
        <MetricCard label="Corte" value={cutLabel} />
        <MetricCard label="Data through" value={formatDateLabel(dataThrough)} />
        <MetricCard label="Menciones medidas" value={measuredMentions} />
        <MetricCard label="Menciones SP" value={signalPulseMentions} />
      </section>

      <section className="analysis-review-card">
        <div className="analysis-section-head">
          <SectionTitle icon="layers" eyebrow="Truth in analysis" title="Qué se midió vs qué vio Claude" />
          <span>{state.cost.events} eventos · USD {state.cost.estimated_cost_usd.toFixed(4)}</span>
        </div>
        <div className="analysis-readiness-grid signal-pulse-review-grid">
          <ReadinessTile label="SQL/embeddings midieron" value={measuredMentions} detail="Menciones incluidas dentro del corpus." />
          <ReadinessTile label="Query pack SP" value={signalPulseMentions} detail="Menciones atribuidas al pack Signal Pulse." />
          <ReadinessTile label="Cluster global sample" value={sampledRows || "n/d"} detail="Filas usadas para candidatos globales." />
          <ReadinessTile label="Candidatos por periodo" value={Number(cluster.period_first_candidate_clusters ?? 0)} detail="Clusters detectados mes a mes." />
          <ReadinessTile label="Claude sintetizó" value={publishableSignals.length} detail={`Hasta ${maxClaudeSamples} snippets cortos; las keywords quedan fuera del Pulse.`} />
          <ReadinessTile label="Ventana" value={`${formatDateLabel(windowStart)} - ${formatDateLabel(windowEnd)}`} detail="Los comparativos usan la ventana; el publish usa el corte actual." />
        </div>
      </section>

      {reviewIssues.length > 0 ? (
        <section className="analysis-empty-signal signal-pulse-review-warning">
          <Icon name="alert" size={18} />
          <div>
            <h2>No publicar todavía</h2>
            <ul>
              {reviewIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="analysis-review-card">
        <div className="analysis-section-head">
          <SectionTitle icon="wave" eyebrow="Signal review" title="Señales que entrarían al Pulse" />
          <span>{publishableSignals.length} publicables · {hiddenSignalCount} fuera</span>
        </div>
        <div className="analysis-preview-list analysis-preview-list--two">
          {publishableSignals.length > 0 ? publishableSignals.slice(0, 8).map((signal, index) => {
            const currentVolume = Number(signal.current_volume ?? signal.volume ?? 0);
            const windowVolume = Number(signal.window_volume ?? 0);
            const bodyPrefix = `${currentVolume} menciones en ${signal.cut_period_label || cutLabel}; ${windowVolume} en ventana. Última actividad: ${signal.last_seen_period || "sin actividad en ventana"}.`;
            return (
              <PreviewItem
                key={signal.id}
                code={`${index + 1}`}
                title={signal.title}
                body={`${bodyPrefix} ${signal.description || stringValue(signal.dimensions.marketing_read) || "Sin lectura editorial guardada."}`}
                meta={`${signal.cut_period_label || cutLabel} · impacto SQL ${formatImpact(signal.impact_v1)} · confianza ${signal.confidence || "baja"}`}
              />
            );
          }) : <EmptyCard text="Esta corrida no produjo señales publicables del corte actual. Hay que regenerar síntesis o revisar clustering antes de publicar." />}
        </div>
      </section>

      <section className="analysis-review-card">
        <div className="analysis-section-head">
          <SectionTitle icon="arrow-up" eyebrow="Marketing moves" title="Acciones propuestas" />
          <span>{repeatedMoveCount >= 3 ? "revisar copy" : "candidate"}</span>
        </div>
        <div className="analysis-preview-list">
          {state.moves.length > 0 ? state.moves.slice(0, 12).map((move, index) => (
            <PreviewItem
              key={move.id}
              code={move.move_type || `MOVE-${index + 1}`}
              title={move.owner_suggestion || "Marketing"}
              body={move.action_text}
              meta={move.confidence || "sin confianza"}
            />
          )) : <EmptyCard text="No hay marketing moves materializados. Signal Pulse no debe publicarse sin acciones." />}
        </div>
      </section>

      <section className="analysis-review-card">
        <div className="analysis-section-head">
          <SectionTitle icon="check" eyebrow="Quality gates" title="Chequeos automáticos" />
          <span>{qualityGates.length || "pendiente"}</span>
        </div>
        {qualityGates.length > 0 ? (
          <div className="quality-gate-list">
            {qualityGates.map((gate) => (
              <div className="quality-gate-row" key={stringValue(gate.id)}>
                <span className={`quality-gate-icon ${gate.passed ? "quality-gate-icon--ok" : "quality-gate-icon--warn"}`}>
                  {gate.passed ? <Icon name="check" size={15} /> : <Icon name="alert" size={15} />}
                </span>
                <strong>{stringValue(gate.id).replaceAll("_", " ")}</strong>
                <span>{stringValue(gate.detail) || "Sin detalle."}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyCard text="Faltan quality gates de Signal Pulse. Guarda draft o vuelve a correr antes de publicar." />
        )}
      </section>

      <SignalPulseReviewComposer
        analysisId={state.analysis.id}
        corpusId={corpus.id}
        defaultHeadline={defaultHeadline}
        defaultSummary={defaultSummary}
        defaultTitle={`${corpus.brandName ?? corpus.themeName ?? "Signal Pulse"} · Signal Pulse`}
        draft={state.draft}
        publishBlocked={publishBlocked}
      />
    </div>
  );
}

async function getSignalPulseReviewState(corpusId: string, analysisId: string) {
  const analysis = (await pool.query<{
    id: string;
    status: string;
    current_step: string;
    meta_json: Record<string, unknown> | null;
  }>(
    `SELECT id::text, status, current_step, meta_json
     FROM engine_analyses
     WHERE id = $1
       AND study_corpus_id = $2
       AND methodology_slug = 'signal-pulse'
     LIMIT 1`,
    [analysisId, corpusId]
  )).rows[0];
  if (!analysis) return null;

  const [cut, signals, moves, cost, draft] = await Promise.all([
    pool.query<{
      id: string;
      label: string;
      period_start: string;
      period_end: string;
      window_start: string | null;
      window_end: string | null;
    }>(
      `
        WITH window_bounds AS (
          SELECT MIN(period_start)::text AS window_start, MAX(period_end)::text AS window_end
          FROM report_periods
          WHERE study_corpus_id = $1 AND granularity = 'month'
        )
        SELECT rp.id::text,
               rp.label,
               rp.period_start::text,
               rp.period_end::text,
               wb.window_start,
               wb.window_end
        FROM report_periods rp
        CROSS JOIN window_bounds wb
        WHERE rp.study_corpus_id = $1
          AND rp.granularity = 'month'
        ORDER BY rp.period_start DESC
        LIMIT 1
      `,
      [corpusId]
    ),
    pool.query<{
      id: string;
      title: string;
      description: string | null;
      signal_type: string | null;
      dimensions: Record<string, unknown> | null;
      volume: number;
      current_volume: number;
      window_volume: number;
      active_periods: number;
      last_seen_period: string | null;
      cut_period_label: string | null;
      impact_v1: string | null;
      confidence: string | null;
    }>(
      `
        WITH cut_period AS (
          SELECT id, label
          FROM report_periods
          WHERE study_corpus_id = $1 AND granularity = 'month'
          ORDER BY period_start DESC
          LIMIT 1
        ),
        current_metrics AS (
          SELECT
            spm.canonical_signal_id,
            spm.volume,
            spm.impact_v1::text AS impact_v1,
            spm.confidence,
            cp.label AS cut_period_label
          FROM signal_period_metrics spm
          JOIN cut_period cp ON cp.id = spm.period_id
          WHERE spm.study_corpus_id = $1
        ),
        window_metrics AS (
          SELECT
            spm.canonical_signal_id,
            COALESCE(SUM(spm.volume), 0)::int AS window_volume,
            COUNT(*) FILTER (WHERE spm.volume > 0)::int AS active_periods,
            (array_remove(array_agg(rp.label ORDER BY rp.period_start DESC) FILTER (WHERE spm.volume > 0), NULL))[1] AS last_seen_period
          FROM signal_period_metrics spm
          JOIN report_periods rp ON rp.id = spm.period_id
          WHERE spm.study_corpus_id = $1
            AND rp.granularity = 'month'
          GROUP BY spm.canonical_signal_id
        )
        SELECT
          cs.id::text AS id,
          cs.canonical_title AS title,
          cs.description,
          cs.signal_type,
          cs.dimensions,
          COALESCE(current_metrics.volume, 0)::int AS volume,
          COALESCE(current_metrics.volume, 0)::int AS current_volume,
          COALESCE(window_metrics.window_volume, 0)::int AS window_volume,
          COALESCE(window_metrics.active_periods, 0)::int AS active_periods,
          window_metrics.last_seen_period,
          current_metrics.cut_period_label,
          current_metrics.impact_v1,
          current_metrics.confidence
        FROM canonical_signals cs
        LEFT JOIN current_metrics ON current_metrics.canonical_signal_id = cs.id
        LEFT JOIN window_metrics ON window_metrics.canonical_signal_id = cs.id
        WHERE cs.study_corpus_id = $1
          AND cs.methodology_slug = 'signal-pulse'
          AND cs.status <> 'archived'
        ORDER BY (COALESCE(current_metrics.volume, 0) > 0) DESC,
                 COALESCE(current_metrics.impact_v1::numeric, 0) DESC,
                 COALESCE(window_metrics.window_volume, 0) DESC
        LIMIT 80
      `,
      [corpusId]
    ),
    pool.query<{
      id: string;
      move_type: string | null;
      action_text: string;
      owner_suggestion: string | null;
      confidence: string | null;
    }>(
      `SELECT id::text, move_type, action_text, owner_suggestion, confidence
       FROM marketing_moves
       WHERE study_corpus_id = $1
         AND engine_analysis_id = $2
         AND EXISTS (
           SELECT 1
           FROM canonical_signals cs
           WHERE cs.id = ANY(marketing_moves.signal_refs)
             AND cs.study_corpus_id = marketing_moves.study_corpus_id
             AND cs.methodology_slug = 'signal-pulse'
             AND cs.status = 'active'
             AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
             AND lower(cs.canonical_title) NOT LIKE 'cluster pendiente de síntesis:%'
             AND lower(cs.canonical_title) NOT LIKE 'cluster pendiente de sintesis:%'
             AND lower(cs.canonical_title) !~ '^(fricción|friccion|oportunidad|territorio): (hasta|siempre|manejar|pinche|velocidad|mejor|nada|seguro|aseguradora|aseguradoras|choque|accidente|vehiculo|vehículo|qualitas|quálitas|sabritas|gobernador|padrino|antojo|groseras|vieja)$'
         )
       ORDER BY position NULLS LAST, created_at
       LIMIT 80`,
      [corpusId, analysisId]
    ),
    pool.query<{
      events: number;
      total_tokens: number;
      estimated_cost_usd: string | null;
    }>(
      `SELECT COUNT(*)::int AS events,
              COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
              COALESCE(SUM(estimated_cost_usd), 0)::text AS estimated_cost_usd
       FROM engine_cost_events
       WHERE engine_analysis_id = $1`,
      [analysisId]
    ),
    pool.query<{
      id: string;
      title: string;
      headline: string | null;
      summary: string | null;
      status: string;
    }>(
      `SELECT id::text, title, headline, summary, status
       FROM published_outputs
       WHERE engine_analysis_id = $1
         AND output_type = 'signal_pulse_dashboard'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [analysisId]
    )
  ]);

  const costRow = cost.rows[0];
  return {
    analysis,
    cut: cut.rows[0] ?? null,
    signals: signals.rows.map((row) => ({
      ...row,
      dimensions: row.dimensions ?? {},
      volume: Number(row.volume ?? 0),
      current_volume: Number(row.current_volume ?? 0),
      window_volume: Number(row.window_volume ?? 0),
      active_periods: Number(row.active_periods ?? 0),
      impact_v1: numberValue(row.impact_v1)
    })),
    moves: moves.rows,
    cost: {
      events: Number(costRow?.events ?? 0),
      total_tokens: Number(costRow?.total_tokens ?? 0),
      estimated_cost_usd: Number(costRow?.estimated_cost_usd ?? 0)
    },
    draft: draft.rows[0] ?? null
  };
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
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatImpact(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : "0.0";
}

function countClientReadyActions(actions: JsonRecord[]) {
  return actions.filter((action) => stringValue(action.action_text).trim().length > 20).length;
}

const RAW_SIGNAL_REVIEW_TERMS = new Set([
  "accidente", "accidentes", "aclarar", "actuan", "alcanzo", "antojo", "aseguradora",
  "aseguradoras", "auto", "autos", "choque", "choques", "danos", "danos", "directo",
  "excelente", "gobernador", "groseras", "manicomio", "padrino", "particulares",
  "potosi", "qualitas", "responsable", "saber", "sabritas", "seguro", "seguros",
  "situacion", "vehiculo", "vehiculos", "vieja"
]);

function isPublishCandidate(dimensions: JsonRecord) {
  return stringValue(dimensions.review_status) === "publish_candidate";
}

function isPublishableSignal(title: string, description: string | null, dimensions: JsonRecord, currentVolume: number) {
  return isPublishCandidate(dimensions)
    && currentVolume > 0
    && !looksNonActionableSignal(title, description, dimensions)
    && !looksRawKeywordSignal(title);
}

function looksNonActionableSignal(title: string, description: string | null, dimensions: JsonRecord) {
  const source = `${title} ${description ?? ""} ${stringValue(dimensions.marketing_read)} ${stringValue(dimensions.action_hint)}`.toLowerCase();
  const normalizedTitle = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (
    /^cluster pendiente de sintesis:/.test(normalizedTitle)
    || /^(friccion|oportunidad|territorio): (hasta|siempre|manejar|pinche|velocidad|mejor|nada)$/.test(normalizedTitle)
  ) {
    return true;
  }
  return [
    "pendiente de síntesis",
    "pendiente de sintesis",
    "señal débil",
    "sin relevancia",
    "sin valor",
    "sin conexión",
    "sin conexion",
    "sin ancla",
    "no accionable",
    "ruido",
    "conversación política",
    "conversacion politica",
    "menciones religiosas",
    "fútbol",
    "futbol",
    "links sin contexto"
  ].some((pattern) => source.includes(pattern));
}

function looksRawKeywordSignal(title: string) {
  const titleTerm = normalizeReviewSignalPhrase(title.replace(/^(fricción|friccion|oportunidad|territorio|prioridad|cluster pendiente de síntesis|cluster pendiente de sintesis):\s*/i, ""));
  return isRawReviewPhrase(titleTerm);
}

function normalizeReviewSignalPhrase(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRawReviewPhrase(value: string) {
  if (!value) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 1) return true;
  const rawCount = words.filter((word) => RAW_SIGNAL_REVIEW_TERMS.has(word)).length;
  return words.length <= 3 && rawCount >= Math.max(1, words.length - 1);
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
