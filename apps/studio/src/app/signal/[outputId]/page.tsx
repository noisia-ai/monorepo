import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { normalizeEngineMethodologyBlock } from "@noisia/query-engine";
import { SessionBadge } from "@/components/layout/SessionBadge";
import { SignalCorpusChat } from "@/components/signal/SignalCorpusChat";
import { FindingDetailWorkspace } from "@/components/signal/FindingDetailWorkspace";
import { SignalCorpusExplorer } from "@/components/signal/SignalCorpusExplorer";
import { SignalDeckButton } from "@/components/signal/SignalDeckButton";
import { SignalDashboardCharts } from "@/components/signal/SignalDashboardCharts";
import { SignalDataOsTimeline } from "@/components/signal/SignalDataOsTimeline";
import { SignalEmergingPatternsExplorer } from "@/components/signal/SignalEmergingPatternsExplorer";
import { SignalHistoricalOverview } from "@/components/signal/SignalHistoricalOverview";
import { SignalLiveComposer } from "@/components/signal/SignalLiveComposer";
import { SignalMonthlyDataPanel } from "@/components/signal/SignalMonthlyDataPanel";
import { SignalOpportunitiesExplorer } from "@/components/signal/SignalOpportunitiesExplorer";
import {
  SignalLocalizedText,
  SignalGlobalDateFilter,
  SignalReportShell,
  SignalSettingsPanel,
  type SignalShellGroup,
} from "@/components/signal/SignalReportShell";
import { SignalTriggerExplorer } from "@/components/signal/SignalTriggerExplorer";
import { Icon } from "@/components/ui/Icon";
import { SourceIcon } from "@/components/ui/SourceIcon";
import { requirePortalUser } from "@/lib/auth/guards";
import { canManageCorpus } from "@/lib/auth/roles";
import { validateEnginePublishReadiness } from "@/lib/engine/publish-guards";
import { pool } from "@/lib/db";
import { getSignalOutputForUser } from "@/lib/data/signal";
import {
  loadPublishedSignalOverview,
  type PublishedSignalOverview,
} from "@/lib/data-os/published-signal-overview";
import {
  assessSignalServingReadiness,
  getSignalServingReadiness,
  type SignalServingReadinessIssue,
} from "@/lib/data-os/signal-serving";
import { loadSignalDataOsTimeline } from "@/lib/data-os/signal-timeline";
import { adaptTbSignalPayload } from "@/lib/signal/adapters/tb";
import { filterEngineBlocksForComposerSelection, type ComposerRenderSelection } from "@/lib/signal/composer-render";
import type { EmergingPattern, EngineChart, EngineMethodologyBlock, PublicActionCard, PublicTbFinding, TbDecisionFieldNode } from "@/lib/signal/contracts";
import { defaultSignalManifest, normalizeSignalDemoMode, signalModuleMeta, type SignalModuleKey } from "@/lib/signal/manifest";
import { hasSignalServingContract } from "@/lib/signal/semantics";
import { buildTbDecisionFieldNodes } from "@/lib/signal/tb-decision-field";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

/* ============================================================
   Noisia Signal — Client report.
   Editorial cover + dashboard charts + verbatim explorer.
   Container is fluid up to 1480px so it fills 16" MacBook canvas.
   ============================================================ */

export default async function SignalOutputPage({
  params,
}: {
  params: Promise<{ outputId: string }>;
}) {
  const { outputId } = await params;
  const session = await requirePortalUser(`/signal/${outputId}`);
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) notFound();

  const payload = asRecord(output.payload);
  const manifest = asRecord(output.manifest);
  const strictRelational = hasSignalServingContract(manifest);
  let relationalOverview: PublishedSignalOverview | null = null;
  let relationalIssues: SignalServingReadinessIssue[] = [];

  if (strictRelational) {
    if (!output.snapshotId || !output.tbAnalysisId) {
      relationalIssues = [{
        code: "published_snapshot_contract_incomplete",
        message: "El output no tiene un snapshot y un analisis publicados.",
      }];
    } else {
      try {
        const readiness = await getSignalServingReadiness({
          analysisId: output.tbAnalysisId,
          outputId: output.id,
          requireDataRefs: true,
          snapshotId: output.snapshotId,
        });
        const assessment = assessSignalServingReadiness(readiness);
        relationalIssues = assessment.hardBlocks;

        if (assessment.ready) {
          relationalOverview = await loadPublishedSignalOverview({
            analysisId: output.tbAnalysisId,
            corpusId: output.studyCorpusId,
            outputId: output.id,
            requireGovernedRef: true,
            snapshotId: output.snapshotId,
          });
        }
      } catch (error) {
        console.error("[signal] relational serving failed", { error, outputId: output.id });
        relationalIssues = [{
          code: "relational_serving_failed",
          message: "No fue posible cargar el corte publicado desde Data OS.",
        }];
      }
    }
  }

  if (strictRelational && !relationalOverview) {
    return <SignalServingUnavailable issues={relationalIssues} />;
  }

  const rawViewModel = adaptTbSignalPayload(payload);
  const brandLabel = output.brandName ?? output.brandFallbackName ?? output.themeName ?? rawViewModel.report.brand_name;
  const relationalFindings = relationalOverview?.findings ?? rawViewModel.findings;
  const viewModel = {
    ...rawViewModel,
    decisionFieldNodes: relationalOverview
      ? buildTbDecisionFieldNodes(relationalFindings)
      : rawViewModel.decisionFieldNodes,
    findings: relationalFindings,
    report: {
      ...rawViewModel.report,
      brand_name: brandLabel
    },
    actionCards: relationalOverview
      ? relationalOverview.action_studio
      : rawViewModel.actionCards,
    strategicOpportunities: relationalOverview
      ? relationalOverview.opportunities
      : rawViewModel.strategicOpportunities,
  };
  const metrics = relationalOverview ? asRecord(relationalOverview.metrics) : asRecord(payload.metrics);
  const overview = asRecord(payload.overview);
  const actions = asRecord(payload.actions);
  const limitations = asRecord(payload.limitations);
  const aggregates = asRecord(payload.aggregates);
  const barriers = relationalOverview
    ? relationalOverview.findings.filter((finding) => finding.polarity === "barrier").map(asRecord)
    : arrayValue(payload.barriers).map(asRecord);
  const triggers = relationalOverview
    ? relationalOverview.findings.filter((finding) => finding.polarity === "trigger").map(asRecord)
    : arrayValue(payload.triggers).map(asRecord);
  const structuralNotes = arrayValue(actions.structural_notes).map(asRecord);
  const topBarriers = relationalOverview
    ? relationalOverview.top_barriers.map(asRecord)
    : arrayValue(overview.top_barriers).map(asRecord);
  const hasV2Manifest = signalModuleMeta.some((module) => Object.prototype.hasOwnProperty.call(manifest, module.key));
  const moduleEnabled = (key: SignalModuleKey) => isSignalModuleEnabled(manifest, key, hasV2Manifest);
  const demoMode = normalizeSignalDemoMode(manifest.demo_mode);
  const demoBlurredSections = new Set(demoMode.blurredSections);
  const demoLocked = (key: SignalModuleKey) => demoMode.enabled && moduleEnabled(key) && demoBlurredSections.has(key);
  const liveEngineBlocks = await getLiveEngineBlocks(output.studyCorpusId);
  const composerRenderSelection = await getComposerRenderSelection(output.id);
  const dataOsTimeline = relationalOverview?.cross_source_timeline ?? (
    strictRelational
      ? null
      : await loadSignalDataOsTimeline({
          corpusId: output.studyCorpusId,
          outputId: output.id,
          requireGovernedRef: false,
        })
  );
  const engineBlocks = filterEngineBlocksForComposerSelection(mergeEngineBlocks([
    ...(viewModel.engineBlock ? [viewModel.engineBlock] : []),
    ...liveEngineBlocks
  ]), composerRenderSelection);
  const engineEditorialActive = composerRenderSelection?.active === true;
  const canManageLiveCorpus = canManageCorpus(session.appUser.primaryRole);
  const bestMove = asRecord(actions.best_move);
  const fmtNum = (v: unknown) => new Intl.NumberFormat("es-MX").format(Number(v ?? 0));

  // Aggregates (already calculated in data layer)
  const corpusAgg = asRecord(aggregates.corpus);
  const corpusWindow = relationalOverview
    ? asRecord(relationalOverview.corpus.window)
    : asRecord(corpusAgg.window);
  const payloadCorpusTotal = relationalOverview?.corpus.total_mentions ?? Number(corpusAgg.total_mentions ?? 0);
  const payloadWindowMonths = relationalOverview
    ? countMonthsInclusive(toDateInput(corpusWindow.start), toDateInput(corpusWindow.end))
    : Number(corpusWindow.months ?? 0);
  const liveBounds = strictRelational
    ? null
    : await getLiveCorpusBounds([output.studyCorpusId, output.baseCorpusId].flatMap((id) => id ? [id] : []));
  const defaultDateFrom = liveBounds?.start ?? toDateInput(corpusWindow.start);
  const defaultDateTo = liveBounds?.end ?? toDateInput(corpusWindow.end);
  const corpusTotal = liveBounds?.totalMentions ?? payloadCorpusTotal;
  const windowMonths = liveBounds?.months ?? payloadWindowMonths;
  const polarityDist = relationalOverview
    ? relationalOverview.polarity_distribution.map(asRecord)
    : arrayValue(aggregates.polarity_distribution).map(asRecord);
  const layerDist = relationalOverview
    ? relationalOverview.layer_distribution.map(asRecord)
    : arrayValue(aggregates.layer_distribution).map(asRecord);
  const mobilityDist = relationalOverview
    ? relationalOverview.mobility_distribution.map(asRecord)
    : arrayValue(aggregates.mobility_distribution).map(asRecord);
  const platformDist = relationalOverview
    ? relationalOverview.platform_distribution.map(asRecord)
    : arrayValue(aggregates.platform_distribution).map(asRecord);
  const contentTypeDist = relationalOverview
    ? relationalOverview.content_type_distribution.map(asRecord)
    : arrayValue(aggregates.content_type_distribution).map(asRecord);
  const volumeTimeline = relationalOverview
    ? relationalOverview.volume_timeline.map(asRecord)
    : arrayValue(aggregates.volume_timeline).map(asRecord);
  const findingTimeSeries = relationalOverview
    ? relationalOverview.finding_time_series.map(asRecord)
    : arrayValue(aggregates.finding_time_series).map(asRecord);
  const polarityTimeSeries = relationalOverview
    ? relationalOverview.polarity_time_series.map(asRecord)
    : arrayValue(aggregates.polarity_time_series).map(asRecord);
  const findingsScatter = relationalOverview
    ? relationalOverview.findings_scatter.map(asRecord)
    : arrayValue(aggregates.findings_scatter).map(asRecord);
  const topVoice = relationalOverview
    ? relationalOverview.top_findings_by_voice.map(asRecord)
    : arrayValue(aggregates.top_findings_by_voice).map(asRecord);
  const mentionsSample = strictRelational ? [] : arrayValue(aggregates.mentions_sample).map(asRecord);
  const shellGroups = buildSignalShellGroups(moduleEnabled, engineBlocks, canManageLiveCorpus, strictRelational);
  const defaultSection = shellGroups[0]?.sections[0]?.key ?? "overview";

  return (
    <SignalReportShell
      defaultDateFrom={defaultDateFrom}
      defaultDateTo={defaultDateTo}
      defaultSection={defaultSection}
      groups={shellGroups}
      maxDate={defaultDateTo}
      minDate={defaultDateFrom}
    >
        {/* TOP UTILITY BAR — period chip + profile */}
        <div className="signal-topbar">
          <div className="signal-topbar-left">
            <span className="signal-method-mark"><span>T</span><i>&amp;</i><b>B</b></span>
            <div className="signal-report-title">
              <strong>{brandLabel}</strong>
              <small>{output.methodologyName ?? "Triggers & Barriers"}</small>
            </div>
          </div>
          <div className="signal-topbar-right">
            <span className="signal-period-pill">
              <Icon name="calendar" size={14} />
              {windowMonths > 0 ? (
                <SignalLocalizedText
                  en={`${strictRelational ? "Published snapshot" : "Live corpus"} · ${windowMonths} months`}
                  es={`${strictRelational ? "Snapshot publicado" : "Corpus vivo"} · ${windowMonths} meses`}
                />
              ) : (
                <SignalLocalizedText
                  en={strictRelational ? "Published snapshot" : "Live corpus"}
                  es={strictRelational ? "Snapshot publicado" : "Corpus vivo"}
                />
              )}
            </span>
            <SignalGlobalDateFilter />
            {demoMode.enabled ? (
              <span className="signal-demo-top-pill">
                <Icon name="info" size={14} />
                Demo preview
              </span>
            ) : null}
            <SignalDeckButton outputId={output.id} />
            <SessionBadge user={session.appUser} compact />
            <button className="signal-icon-btn" type="button" aria-label="Más opciones">
              <Icon name="sort" size={14} />
            </button>
          </div>
        </div>
        <SignalReadingGuide canManageLiveCorpus={canManageLiveCorpus} strictRelational={strictRelational} />

        {moduleEnabled("overview") ? (
          <div className="signal-view-panel" data-signal-section="overview" id="overview">
            <DemoModeSection locked={demoLocked("overview")} label="Overview & confianza">
              <KnowledgeImpactPanel impact={viewModel.knowledgeImpact} report={viewModel.report} />
              <SignalDashboardCharts
                brandLabel={brandLabel}
                corpusTotal={corpusTotal}
                findingsScatter={findingsScatter}
                layerDist={layerDist}
                methodologyName={output.methodologyName ?? "Triggers & Barriers"}
                metrics={{
                  findingsTotal: Number(metrics.findings_total ?? 0),
                  barriersTotal: Number(metrics.barriers_total ?? 0),
                  triggersTotal: Number(metrics.triggers_total ?? 0),
                  movableTotal: Number(metrics.movable_total ?? 0),
                  opportunitiesTotal: Number(metrics.opportunities_total ?? viewModel.strategicOpportunities.length),
                }}
                mobilityDist={mobilityDist}
                platformDist={platformDist}
                contentTypeDist={contentTypeDist}
                polarityDist={polarityDist}
                findingTimeSeries={findingTimeSeries}
                polarityTimeSeries={polarityTimeSeries}
                outputId={output.id}
                topBarriers={topBarriers}
                topVoice={topVoice}
                volumeTimeline={volumeTimeline}
                windowLabel={
                  windowMonths > 0
                    ? `${fmtDateRange(defaultDateFrom, defaultDateTo, "en-US")} · ${windowMonths} months${strictRelational ? " · published snapshot" : ""}`
                    : strictRelational ? "Published snapshot" : "Live corpus"
                }
              />
              {dataOsTimeline ? <SignalDataOsTimeline model={dataOsTimeline} /> : null}
            </DemoModeSection>
          </div>
        ) : null}

        {moduleEnabled("overview") ? (
          <section className="signal-section" data-signal-section="signal-history" hidden id="signal-history">
            <SectionHead
              eyebrow="Live Intelligence"
              title={<SignalLocalizedText en="Signal history" es="Historia de señales" />}
              sub={
                <SignalLocalizedText
                  en="Track persistent signals by month. The global range controls this view and month clicks update the whole report."
                  es="Da seguimiento mensual a señales persistentes. El rango global gobierna esta vista y cada mes actualiza todo el reporte."
                />
              }
            />
            <DemoModeSection locked={demoLocked("overview")} label="Signal History">
              <SignalHistoricalOverview outputId={output.id} />
            </DemoModeSection>
          </section>
        ) : null}

        {engineBlocks.map((block) => {
          const moduleKey = engineModuleKeyFor(block.methodology_slug ?? block.kind ?? null);
          const sectionKey = engineSectionKey(block);
          const locked = demoLocked("engine_methodology") || (moduleKey ? demoLocked(moduleKey) : false);
          return (
            <section className="signal-section" data-signal-section={sectionKey} hidden id={sectionKey} key={sectionKey}>
              <SectionHead
                eyebrow="Engine beta"
                title={engineDisplayLabel(block)}
                sub={
                  <SignalLocalizedText
                    en="Beta lens output with deterministic scores, charts, evidence links and explicit limitations."
                    es="Output beta del lente con scores determinísticos, charts, evidencia y limitaciones explícitas."
                  />
                }
              />
              <DemoModeSection locked={locked} label={engineDisplayLabel(block)}>
                <EngineMethodologyPanel block={block} editorialActive={engineEditorialActive} />
              </DemoModeSection>
            </section>
          );
        })}

        {moduleEnabled("live_composer") ? (
          <section className="signal-section" data-signal-section="live-composer" hidden id="live-composer">
            <SectionHead
              eyebrow="Live Intelligence"
              title={<SignalLocalizedText en="Composer across methods" es="Composer entre métodos" />}
              sub={
                <SignalLocalizedText
                  en="Persistent signals are deduped across lenses so the final report can combine methods without repeating the same evidence."
                  es="Las señales persistentes se deduplican entre lentes para que el reporte final combine métodos sin repetir la misma evidencia."
                />
              }
            />
            <DemoModeSection locked={demoLocked("live_composer")} label="Live Composer">
              <SignalLiveComposer outputId={output.id} />
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("tb_decision_field") ? (
          <section className="signal-section" data-signal-section="tb-decision-field" hidden id="tb-decision-field">
            <SectionHead
              eyebrow="Triggers & Barriers"
              title="Decision Field"
              sub={
                <SignalLocalizedText
                  en="Where each decision force lives: what the brand can move, what weighs as friction and what should be treated as structural context."
                  es="Dónde vive cada fuerza de decisión: qué puede mover la marca, qué pesa como fricción y qué debe tratarse como contexto estructural."
                />
              }
            />
            <DemoModeSection locked={demoLocked("tb_decision_field")} label="T&B Decision Field">
              <DecisionFieldPanel findings={viewModel.findings} nodes={viewModel.decisionFieldNodes} />
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("opportunities") ? (
          <section className="signal-section" data-signal-section="tb-opportunities" hidden id="tb-opportunities">
            <SectionHead
              eyebrow={<SignalLocalizedText en="Prioritization" es="Priorización" />}
              title={<SignalLocalizedText en="Opportunities that change the decision" es="Oportunidades que sí cambian la decisión" />}
              sub={
                <SignalLocalizedText
                  en="This section compresses findings into decision bets, avoiding the same evidence repeated across five formats."
                  es="Este bloque compacta los hallazgos en apuestas de decisión para evitar repetir la misma evidencia en cinco formatos distintos."
                />
              }
            />
            <DemoModeSection locked={demoLocked("opportunities")} label="Opportunities">
              <OpportunitiesPanel opportunities={viewModel.strategicOpportunities} findings={viewModel.findings} />
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("competitive_intelligence") ? (
          <section className="signal-section" data-signal-section="competitive" hidden id="competitive">
            <SectionHead
              eyebrow="Competitive intelligence"
              title={
                <SignalLocalizedText
                  en={`Where can ${viewModel.report.brand_name} turn competitor friction into advantage?`}
                  es={`¿Dónde puede ${viewModel.report.brand_name} convertir fricción competitiva en ventaja?`}
                />
              }
              sub={
                <SignalLocalizedText
                  en="Signal compares brand, competitor and category signals to find barriers competitors are carrying and the moves the brand can credibly own."
                  es="Signal compara señales de marca, competencia y categoría para encontrar barreras que carga la competencia y movimientos que la marca puede poseer con credibilidad."
                />
              }
            />
            <DemoModeSection locked={demoLocked("competitive_intelligence")} label="Competitive Intelligence">
              <CompetitivePanel
                brandName={viewModel.report.brand_name}
                competitive={viewModel.competitive}
                evidenceDeepDives={viewModel.evidenceDeepDives}
                findings={viewModel.findings}
                methodologyBlocks={viewModel.methodologyBlocks}
              />
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("tb_comparative_dashboard") ? (
          <section className="signal-section" data-signal-section="tb-comparative-dashboard" hidden id="tb-comparative-dashboard">
            <SectionHead
              eyebrow="T&B Comparative"
              title={<SignalLocalizedText en="Comparative dashboard" es="Dashboard comparativo" />}
              sub={
                <SignalLocalizedText
                  en="Output #01 reads the existing T&B comparative brief: heatmap, ownership ranking and trigger/barrier split by entity."
                  es="El output #01 lee el comparativo T&B existente: heatmap, ownership ranking y split trigger/barrier por entidad."
                />
              }
            />
            <DemoModeSection locked={demoLocked("tb_comparative_dashboard")} label="T&B Comparative">
              {viewModel.competitive.dashboard ? (
                <ComparativeDashboard dashboard={viewModel.competitive.dashboard} />
              ) : (
                <FindingNotice
                  icon="layers"
                  title="Comparative dashboard pendiente."
                  body="Este módulo aparece cuando el análisis T&B trae comparative_brief con entidades y presencia de findings."
                />
              )}
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("competitive_tb_matrix") ? (
          <section className="signal-section" data-signal-section="competitive-tb-matrix" hidden id="competitive-tb-matrix">
            <SectionHead
              eyebrow="Competitive T&B Matrix"
              title={<SignalLocalizedText en="Triggers and barriers by entity" es="Triggers y barreras por entidad" />}
              sub={
                <SignalLocalizedText
                  en="Output #11 keeps the dense competitive matrix separate from the broader intelligence narrative."
                  es="El output #11 mantiene la matriz competitiva densa separada de la narrativa general de inteligencia."
                />
              }
            />
            <DemoModeSection locked={demoLocked("competitive_tb_matrix")} label="Competitive T&B Matrix">
              {viewModel.methodologyBlocks.competitive_tb_matrix.findings.length > 0 ? (
                <CompetitiveTbMatrix block={viewModel.methodologyBlocks.competitive_tb_matrix} />
              ) : (
                <FindingNotice
                  icon="layers"
                  title="Competitive T&B Matrix pendiente."
                  body="La matriz necesita findings comparativos atribuidos por entidad en el comparative_brief."
                />
              )}
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("action_studio") ? (
          <section className="signal-section" data-signal-section="tb-action-studio" hidden id="tb-action-studio">
            <SectionHead
              eyebrow="Action Studio"
              title={<SignalLocalizedText en="What each team does with this" es="Qué hace cada equipo con esto" />}
              sub={
                <SignalLocalizedText
                  en="Actions grouped by team so the report does not stop at diagnosis."
                  es="Acciones agrupadas por área para que el reporte no se quede en diagnóstico."
                />
              }
            />
            <DemoModeSection locked={demoLocked("action_studio")} label="Action Studio">
              <ActionStudioPanel actions={viewModel.actionCards} />
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("emerging_patterns") ? (
          <section className="signal-section" data-signal-section="emerging-patterns" hidden id="emerging-patterns">
            <SectionHead
              eyebrow="Emerging Patterns"
              title={<SignalLocalizedText en="Open signals beyond the method" es="Señales abiertas fuera del método" />}
              sub={
                <SignalLocalizedText
                  en="Insights born from the corpus, Knowledge Base and client files without forcing them into the Triggers & Barriers framework."
                  es="Insights que nacen del corpus, Knowledge Base y archivos del cliente sin forzarlos al marco Triggers & Barriers."
                />
              }
            />
            <DemoModeSection locked={demoLocked("emerging_patterns")} label="Emerging Patterns">
              <EmergingPatternsPanel
                corpusId={output.studyCorpusId}
                futureSignals={viewModel.futureSignals}
                marketAnalysis={viewModel.marketAnalysis}
                patterns={viewModel.emergingPatterns}
              />
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("corpus_view") ? (
          <section className="signal-section" data-signal-section="corpus-view" hidden id="corpus-view">
            <SectionHead
              eyebrow="Corpus View"
              title={<SignalLocalizedText en="Explore corpus and evidence" es="Explorar corpus y evidencia" />}
              sub={
                <SignalLocalizedText
                  en="Operational view of the study corpus: search, channel, date and finding filters, and evidence connected to the analysis."
                  es="Vista operativa del corpus del estudio: búsqueda, filtros por canal, fecha y finding, y evidencia conectada al análisis."
                />
              }
            />
            <DemoModeSection locked={demoLocked("corpus_view")} label="Corpus View">
              <SignalCorpusExplorer
                mentions={mentionsSample}
                outputId={output.id}
                strictRelational={strictRelational}
              />
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("corpus_chat") ? (
          <section className="signal-section" data-signal-section="corpus-chat" hidden id="corpus-chat">
            <SectionHead
              eyebrow="Corpus Chat"
              title={<SignalLocalizedText en="Ask the published cut" es="Preguntarle al corte publicado" />}
              sub={
                <SignalLocalizedText
                  en="Agent restricted to the report, processed Knowledge Base and semantic evidence from the snapshot. It does not open access to the full corpus or other studies."
                  es="Agente restringido al reporte, Knowledge Base procesado y evidencia semántica del snapshot. No abre acceso al corpus completo ni a otros estudios."
                />
              }
            />
            <DemoModeSection locked={demoLocked("corpus_chat")} label="Corpus Chat">
              <SignalCorpusChat outputId={output.id} />
            </DemoModeSection>
          </section>
        ) : null}

        {moduleEnabled("evidence") ? (
          <section className="signal-section" data-signal-section="finding-detail" hidden id="finding-detail">
            <SectionHead
              eyebrow="Evidence system"
              title="Finding Detail Drawer"
              sub={
                <SignalLocalizedText
                  en="Each finding lives once. Charts, actions and annexes point to this detail so recommendations are not repeated as loose cards."
                  es="Cada hallazgo vive una sola vez. Charts, acciones y anexos apuntan a este detalle para no repetir recomendaciones como tarjetas sueltas."
                />
              }
            />
            <DemoModeSection locked={demoLocked("evidence")} label="Evidence">
              <FindingDetailDrawer
                actions={viewModel.actionCards}
                competitive={viewModel.competitive}
                evidenceDeepDives={viewModel.evidenceDeepDives}
                findings={viewModel.findings}
                mentionsSample={mentionsSample}
              />
            </DemoModeSection>
          </section>
        ) : null}

        {/* OVERVIEW — top barriers as editorial kicker cards */}
        {!hasV2Manifest && legacyModuleEnabled(manifest, "overview") && (
          <section className="signal-section" id="overview-detail">
            <SectionHead eyebrow="Top barreras" title="Lo que está frenando la decisión" />
            <TopBarriersPanel
              barriers={barriers}
              mentionsSample={mentionsSample}
              topBarriers={topBarriers}
              topVoice={topVoice}
            />
          </section>
        )}

        {/* TENSION MAP */}
        {!hasV2Manifest && legacyModuleEnabled(manifest, "tension_map") && (
          <section className="signal-section" id="tension_map">
            <SectionHead eyebrow="Visualización" title="Mapa de tensión" />
            <TensionMap
              findingsScatter={findingsScatter}
              triggers={triggers}
              barriers={barriers}
              barriersTotal={Number(metrics.barriers_total ?? barriers.length)}
              triggersTotal={Number(metrics.triggers_total ?? triggers.length)}
            />
          </section>
        )}

        {/* ACTIONS */}
        {!hasV2Manifest && legacyModuleEnabled(manifest, "actions") && (
          <section className="signal-section" id="actions">
            <SectionHead eyebrow="Plan de acción" title="La mejor jugada y alternativas" />
            <BestMoveCard
              mentions={mentionsSample.filter((mention) => stringValue(mention.finding_id) === stringValue(bestMove.finding_id))}
              move={bestMove}
            />
            {arrayValue(actions.alternatives).length > 0 && (
              <>
                <p className="signal-subhead">Alternativas priorizadas</p>
                <ul className="signal-action-list">
                  {arrayValue(actions.alternatives).map((alt, i) => {
                    const a = asRecord(alt);
                    return <ActionRow key={stringValue(a.id) || String(i)} item={a} rank={i + 2} />;
                  })}
                </ul>
              </>
            )}
          </section>
        )}

        {/* BARRIERS */}
        {!hasV2Manifest && legacyModuleEnabled(manifest, "barriers") && (
          <section className="signal-section" id="barriers">
            <SectionHead
              eyebrow="Barreras movibles"
              title="Anexo operativo de fricciones"
              sub="La lectura ejecutiva ya priorizó arriba. Este bloque conserva cada barrera como unidad accionable para seguimiento interno."
            />
            <div className="signal-finding-grid">
              {barriers.map((b, i) => (
                <FindingCard key={stringValue(b.id) || String(i)} item={b} />
              ))}
            </div>
          </section>
        )}

        {/* TRIGGERS */}
        {!hasV2Manifest && legacyModuleEnabled(manifest, "triggers") && (
          <section className="signal-section" id="triggers">
            <SectionHead eyebrow="Señales positivas" title="Triggers a aprovechar" />
            <SignalTriggerExplorer
              corpusTotal={corpusTotal}
              mentionsSample={mentionsSample}
              triggers={triggers}
              volumeTimeline={volumeTimeline}
            />
          </section>
        )}

        {/* STRUCTURAL */}
        {!hasV2Manifest && structuralNotes.length > 0 && (
          <section className="signal-section">
            <SectionHead
              eyebrow="Contexto estructural"
              title="Barreras para alinear, no prometer"
              sub="Códigos culturales o sistémicos que no se mueven con campañas. La marca debe alinearse con la narrativa o construir desde whitespace alternativo."
            />
            <div className="signal-finding-grid signal-finding-grid--two">
              {structuralNotes.map((note, i) => (
                <FindingCard
                  key={stringValue(note.id) || String(i)}
                  item={note}
                  variant="structural"
                />
              ))}
            </div>
          </section>
        )}

        {/* FRICTION HEATMAP */}
        {!hasV2Manifest && legacyModuleEnabled(manifest, "friction_heatmap") && (
          <section className="signal-section" id="friction_heatmap">
            <SectionHead
              eyebrow="Journey"
              title="Mapa de fricción"
              sub="Dónde en el customer journey duele más cada barrera. Intensidad calculada por matching de lenguaje sobre verbatims trazables."
            />
            <FrictionHeatmap barriers={barriers.slice(0, 8)} />
          </section>
        )}

        {/* MENTIONS BROWSER — voces del corpus */}
        {!hasV2Manifest && legacyModuleEnabled(manifest, "verbatims") && mentionsSample.length > 0 && (
          <section className="signal-section" id="voces">
            <SectionHead
              eyebrow="Voces del corpus"
              title="Lo que están diciendo, en sus propias palabras"
              sub={`Muestra trazable de ${mentionsSample.length} verbatims (de ${fmtNum(corpusTotal)} menciones del snapshot). Cada cita está vinculada a su finding.`}
            />
            <ul className="mentions-feed">
              {mentionsSample.map((m, i) => (
                <MentionCard key={stringValue(m.mention_id) || String(i)} item={m} />
              ))}
            </ul>
          </section>
        )}

        {/* PLACEHOLDERS */}
        {!hasV2Manifest && legacyModuleEnabled(manifest, "stream_graph") && (
          <section className="signal-section" id="stream_graph">
            <SectionHead eyebrow="Evolución" title="Stream cultural" />
            <FindingNotice
              icon="wave"
              title="Vista de evolución semanal por hallazgo en construcción."
              body={viewModel.clientBoundaries.find((item) => item.toLowerCase().includes("evidencia")) || "Esta vista contará cuándo nacen, crecen o se apagan las narrativas del corpus."}
            />
          </section>
        )}

        {!hasV2Manifest && legacyModuleEnabled(manifest, "compare") && (
          <section className="signal-section" id="compare">
            <SectionHead eyebrow="Benchmark" title="Comparativo competitivo" />
            <FindingNotice
              icon="layers"
              title="On hold hasta tener corpora competidores aprobados."
              body={viewModel.competitive.limitations[0] || "Signal no inventa benchmarks. Para comparar se requiere corpus competitivo atribuido y suficiente."}
            />
          </section>
        )}

        {!hasV2Manifest && legacyModuleEnabled(manifest, "chat") && (
          <section className="signal-section" id="chat">
            <SectionHead eyebrow="Pregúntale al corte" title="Chat sobre este reporte" />
            <FindingNotice
              icon="message"
              title="Chat client-safe en construcción."
              body="Sólo podrá consultar el snapshot publicado. No abre acceso a tu corpus completo ni a otros estudios."
            />
          </section>
        )}

        {/* META FOOTER */}
        {moduleEnabled("quality_boundaries") ? (
          <footer className="signal-meta" data-signal-section="quality-boundaries" hidden id="quality-boundaries">
            <DemoModeSection locked={demoLocked("quality_boundaries")} label="Quality / Boundaries">
              <QualityBoundariesPanel
                clientBoundaries={viewModel.clientBoundaries}
                limitations={limitations}
                publishedEvidenceCount={relationalOverview?.evidence.finding_citations ?? mentionsSample.length}
                totalMentions={corpusTotal}
              />
            </DemoModeSection>
          </footer>
        ) : null}

        <section className="signal-section" data-signal-section="settings" hidden id="settings">
          <SignalSettingsPanel />
        </section>

        {canManageLiveCorpus ? (
          <section className="signal-section" data-signal-section="monthly-data" hidden id="monthly-data">
            <SectionHead
              eyebrow={<SignalLocalizedText en="Live corpus admin" es="Admin de corpus vivo" />}
              title={<SignalLocalizedText en="Add monthly data" es="Agregar nuevo corte mensual" />}
              sub={
                <SignalLocalizedText
                  en="Use this to append CSV data to the live corpus before QA. It does not query an external provider or run a costly analysis by itself."
                  es="Úsalo para sumar CSVs al corpus vivo antes de QA. No consulta un proveedor externo ni corre un análisis costoso por sí solo."
                />
              }
            />
            <SignalMonthlyDataPanel
              baseCorpusId={output.baseCorpusId}
              brandLabel={brandLabel}
              outputId={output.id}
              studyCorpusId={output.studyCorpusId}
              subjectType={output.themeId && !output.brandId ? "theme" : "brand"}
            />
          </section>
        ) : null}
    </SignalReportShell>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function SignalServingUnavailable({ issues }: { issues: SignalServingReadinessIssue[] }) {
  const visibleIssues = issues.length > 0
    ? issues
    : [{ code: "signal_serving_unavailable", message: "El corte publicado no esta listo para servir desde Data OS." }];

  return (
    <main className="signal-report signal-report--unavailable">
      <section className="signal-section signal-serving-unavailable">
        <SectionHead
          eyebrow="Data OS"
          title={<SignalLocalizedText en="Published snapshot unavailable" es="Snapshot publicado no disponible" />}
          sub={
            <SignalLocalizedText
              en="Signal stopped before rendering because the governed relational contract is incomplete. The legacy JSON was not used as a fallback."
              es="Signal se detuvo antes de renderizar porque el contrato relacional gobernado esta incompleto. No se uso el JSON legado como fallback."
            />
          }
        />
        <div className="signal-serving-warning" role="alert">
          <Icon name="alert" size={18} />
          <div>
            {visibleIssues.map((issue) => (
              <p key={issue.code}>
                <strong>{issue.message}</strong>
                {issue.detail ? <span>{issue.detail}</span> : null}
              </p>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function SignalReadingGuide({
  canManageLiveCorpus,
  strictRelational,
}: {
  canManageLiveCorpus: boolean;
  strictRelational: boolean;
}) {
  return (
    <section className="signal-reading-guide" aria-label="Signal reading flow">
      <div>
        <span>1</span>
        <strong>Overview</strong>
        <small>Lectura ejecutiva y métricas del rango activo.</small>
      </div>
      <div>
        <span>2</span>
        <strong>{strictRelational ? "Snapshot publicado" : "Corpus vivo"}</strong>
        <small>
          {strictRelational
            ? "Menciones, dimensiones y evidencia del corte inmutable."
            : "Búsqueda real en DB: marca, baseline, fecha y evidencia."}
        </small>
      </div>
      <div>
        <span>3</span>
        <strong>Historia</strong>
        <small>Señales persistentes por mes, no snapshots sueltos.</small>
      </div>
      <div>
        <span>4</span>
        <strong>Composer</strong>
        <small>Oportunidades y riesgos deduplicados entre métodos.</small>
      </div>
      {canManageLiveCorpus ? (
        <a href="#monthly-data">
          <Icon name="upload" size={14} />
          Nuevo corte
        </a>
      ) : null}
    </section>
  );
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode }) {
  return (
    <header className="signal-sec-head">
      <p className="signal-eyebrow">{eyebrow}</p>
      <h2 className="signal-sec-title">{title}</h2>
      {sub && <p className="signal-sec-sub">{sub}</p>}
    </header>
  );
}

function DemoModeSection({ children, label, locked }: { children: ReactNode; label: string; locked: boolean }) {
  if (!locked) return <>{children}</>;

  return (
    <div className="signal-demo-lock" data-demo-locked="true">
      <div className="signal-demo-lock-content">{children}</div>
      <div className="signal-demo-lock-overlay" role="note">
        <span>Demo preview</span>
        <strong>{label}</strong>
        <small>Sección disponible en el reporte completo.</small>
      </div>
    </div>
  );
}

function DecisionFieldPanel({ findings, nodes }: { findings: PublicTbFinding[]; nodes: TbDecisionFieldNode[] }) {
  if (findings.length === 0) {
    return (
      <FindingNotice
        icon="info"
        title="Decision Field pendiente de dataset de findings."
        body="Los outputs publicados antes del contrato v2 pueden no traer hallazgos suficientes para construir el mapa."
      />
    );
  }

  const top = findings.slice().sort((a, b) => b.composite_score - a.composite_score).slice(0, 5);
  const layers: PublicTbFinding["layer"][] = ["personal", "psicologico", "social", "cultural"];
  const mobilityRows: Array<{ key: NonNullable<PublicTbFinding["mobility"]>; label: string; note: string }> = [
    { key: "movible_por_marca", label: "Act on it", note: "Direct brand action can shift this." },
    { key: "parcialmente_movible", label: "Shape it", note: "Brand can influence with partners, formats or timing." },
    { key: "estructural", label: "Respect it", note: "Do not promise it away; design around it." },
  ];
  const totalEvidence = findings.reduce((sum, finding) => sum + finding.evidence_count, 0);
  const movableEvidence = findings
    .filter((finding) => finding.mobility === "movible_por_marca")
    .reduce((sum, finding) => sum + finding.evidence_count, 0);
  const nodeCount = nodes.length;
  return (
    <div className="decision-field-shell decision-field-shell--matrix">
      <div className="decision-field-matrix" role="table" aria-label="Triggers and barriers by layer and mobility">
        <div className="decision-field-matrix-head" role="row">
          <span />
          {layers.map((layer) => <strong key={layer}>{layerLabel(layer)}</strong>)}
        </div>
        {mobilityRows.map((row) => (
          <div className="decision-field-matrix-row" role="row" key={row.key}>
            <div className="decision-field-row-label">
              <strong>{row.label}</strong>
              <span>{row.note}</span>
            </div>
            {layers.map((layer) => {
              const cellFindings = findings
                .filter((finding) => finding.layer === layer && finding.mobility === row.key)
                .sort((a, b) => b.composite_score - a.composite_score);
              return (
                <div className="decision-field-cell" role="cell" key={`${row.key}-${layer}`}>
                  {cellFindings.length > 0 ? cellFindings.slice(0, 4).map((finding) => (
                    <a
                      className={`decision-field-chip decision-field-chip--${finding.polarity}`}
                      href={`#${findingAnchor(finding.finding_id)}`}
                      key={finding.finding_id}
                    >
                      <span>{finding.finding_id}</span>
                      <strong>{truncate(finding.finding_name, 54)}</strong>
                      <small>{finding.evidence_count} evidence · score {finding.composite_score.toFixed(1)}</small>
                    </a>
                  )) : (
                    <span className="decision-field-empty">No signal</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <aside className="decision-field-rank">
        <div className="decision-field-legend">
          <span><i className="legend-dot legend-dot--trigger" /> Trigger = motivation</span>
          <span><i className="legend-dot legend-dot--barrier" /> Barrier = friction</span>
          <span><i className="legend-ring" /> Rows = actionability</span>
          <span><i className="legend-size" /> Columns = decision layer</span>
        </div>
        <div className="decision-field-stats">
          <div><strong>{findings.length}</strong><span>findings</span></div>
          <div><strong>{fmtCompact(totalEvidence)}</strong><span>evidence points</span></div>
          <div><strong>{Math.round((movableEvidence / Math.max(1, totalEvidence)) * 100)}%</strong><span>movable evidence</span></div>
          <div><strong>{nodeCount}</strong><span>mapped nodes</span></div>
        </div>
        <p className="signal-eyebrow">Decision priority</p>
        {top.map((finding, index) => (
          <article key={finding.finding_id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong><a href={`#${findingAnchor(finding.finding_id)}`}>{finding.finding_name}</a></strong>
              <small>{prettifyKey(finding.polarity)} · {prettifyKey(finding.layer)} · score {finding.composite_score.toFixed(1)}</small>
            </div>
          </article>
        ))}
      </aside>
    </div>
  );
}

function KnowledgeImpactPanel({
  impact,
  report,
}: {
  impact: ReturnType<typeof adaptTbSignalPayload>["knowledgeImpact"];
  report: ReturnType<typeof adaptTbSignalPayload>["report"];
}) {
  if (!impact) return null;
  const sources = dedupeKnowledgeSources(impact.sources_used);
  const briefSources = sources.filter((source) => source.source_kind.includes("brief"));
  const fileSources = sources.filter((source) => source.original_file_name || source.source_kind.includes("spreadsheet"));
  const sourceTypes = buildKnowledgeSourceTypes(sources, briefSources.length, fileSources.length);
  const visibleSourceTypes = sourceTypes.slice(0, 5);
  const sourceOverflow = Math.max(0, sourceTypes.length - visibleSourceTypes.length);
  const answerLead = splitLeadSentence(selectKnowledgeHeroText(impact.business_question_answer, report.summary));
  return (
    <section className="knowledge-impact-strip knowledge-impact-strip--hero">
      <div className="knowledge-impact-top">
        <div className="knowledge-impact-main">
          <p className="signal-eyebrow">Brief + Knowledge Base</p>
          <h3>{answerLead.title || <SignalLocalizedText en="What the brief asks us to decide" es="Lo que el brief pide decidir" />}</h3>
          {answerLead.body ? <p className="knowledge-impact-answer">{answerLead.body}</p> : null}
          <p className="knowledge-impact-validated">
            <Icon name="check" size={13} /> Validated by Noisia AI · Published insight
          </p>
        </div>
        <aside className="knowledge-source-ledger">
          <div className="knowledge-source-logo-panel">
            <strong>Data sources</strong>
            <div className="knowledge-source-logo-row" aria-label="Sources used by the analysis">
              {visibleSourceTypes.map((source) => (
                <span className="knowledge-source-logo" key={source.value} title={source.label}>
                  <SourceIcon value={source.value} />
                </span>
              ))}
              {sourceOverflow > 0 ? <span className="knowledge-source-more">+{sourceOverflow} more</span> : null}
            </div>
          </div>
          <div className="knowledge-source-stats" aria-label="Source totals">
            <div>
              <span><Icon name="copy" size={20} /></span>
              <strong>{briefSources.length}</strong>
              <small>Brief inputs</small>
            </div>
            <div>
              <span><Icon name="upload" size={20} /></span>
              <strong>{fileSources.length}</strong>
              <small>Uploaded files</small>
            </div>
            <div>
              <span><Icon name="layers" size={20} /></span>
              <strong>{sources.length}</strong>
              <small>Total sources</small>
            </div>
          </div>
          <div className="knowledge-source-insight-note">
            <span><Icon name="star" size={16} /></span>
            <p>This is the top insight based on impact and signal strength across your selected sources.</p>
          </div>
        </aside>
      </div>
      <dl className="knowledge-impact-brief">
        <div>
          <dt><Icon name="tag" size={14} /> Business decision</dt>
          <dd>{impact.decision_to_inform || "No decision was published for this cut."}</dd>
          <a href="#tb-action-studio">See recommendation <Icon name="arrow-right" size={13} /></a>
        </div>
        <div>
          <dt><Icon name="copy" size={14} /> What the corpus confirms</dt>
          <dd>{impact.confirmed_by_corpus[0] || "No confirmation note was published."}</dd>
          <a href="#finding-detail">See evidence <Icon name="arrow-right" size={13} /></a>
        </div>
        <div>
          <dt><Icon name="alert" size={14} /> Strategic constraint</dt>
          <dd>{impact.strategic_constraints[0] || "No strategic constraint was published."}</dd>
          <a href="#quality-boundaries">See implications <Icon name="arrow-right" size={13} /></a>
        </div>
      </dl>
      <div className="knowledge-impact-cta">
        <span><Icon name="search" size={18} /></span>
        <div>
          <strong>Looking for something specific?</strong>
          <p>Explore the evidence, audience insights and content examples behind this insight.</p>
        </div>
        <a href="#corpus-view">Explore the evidence <Icon name="arrow-right" size={14} /></a>
      </div>
    </section>
  );
}

function OpportunitiesPanel({
  opportunities,
  findings,
}: {
  opportunities: ReturnType<typeof adaptTbSignalPayload>["strategicOpportunities"];
  findings: PublicTbFinding[];
}) {
  return <SignalOpportunitiesExplorer findings={findings} opportunities={opportunities} />;
}

function EngineMethodologyPanel({
  block,
  editorialActive = false
}: {
  block: ReturnType<typeof adaptTbSignalPayload>["engineBlock"];
  editorialActive?: boolean;
}) {
  if (!block) return null;
  const topFindings = block.findings.slice(0, 6);
  const topCharts = block.charts.slice(0, 6);
  return (
    <section className="engine-methodology-panel">
      <header>
        <div>
          <p className="signal-eyebrow">{prettifyKey(block.methodology_slug)}</p>
          <h3>{block.title}</h3>
          {block.summary ? <p>{block.summary}</p> : null}
        </div>
        <dl>
          <div><dt>Findings</dt><dd>{block.findings.length}</dd></div>
          <div><dt>Charts</dt><dd>{block.charts.length}</dd></div>
        </dl>
      </header>
      {block.methodology_view && !editorialActive ? <EngineMethodologyViewPanel view={block.methodology_view} /> : null}
      {topCharts.length > 0 ? (
        <div className="engine-methodology-charts">
          {topCharts.map((chart) => (
            <EngineChartPreview chart={chart} key={chart.chart_id} />
          ))}
        </div>
      ) : editorialActive ? (
        <FindingNotice
          icon="info"
          title="No charts selected for this lens."
          body="The Composer editorial cut keeps this lens available but hides its charts from the published reading."
        />
      ) : null}
      {topFindings.length > 0 ? (
        <div className="engine-methodology-findings">
          {topFindings.map((finding) => (
            <article key={finding.finding_id}>
              <header>
                <strong>{finding.title}</strong>
                <span>{confidenceLabel(finding.confidence)}</span>
              </header>
              <p>{Object.entries(finding.dimensions).slice(0, 3).map(([key, value]) => `${prettifyKey(key)}: ${String(value)}`).join(" · ")}</p>
              <small>{finding.evidence_count} evidence · score {finding.score ?? "n/a"}</small>
            </article>
          ))}
        </div>
      ) : (
        <FindingNotice icon="info" title="Engine block without findings yet." body={block.limitations[0] || "This methodology did not publish enough findings for the selected corpus."} />
      )}
    </section>
  );
}

function EngineMethodologyViewPanel({
  view
}: {
  view: NonNullable<NonNullable<ReturnType<typeof adaptTbSignalPayload>["engineBlock"]>["methodology_view"]>;
}) {
  return (
    <div className="engine-methodology-view">
      <header>
        <div>
          <span>{prettifyKey(view.readiness.status)}</span>
          <strong>{view.title}</strong>
          {view.primary_question ? <p>{view.primary_question}</p> : null}
        </div>
        {view.readiness.missing.length > 0 ? (
          <small>Missing: {view.readiness.missing.join(", ")}</small>
        ) : (
          <small>{view.readiness.reason}</small>
        )}
      </header>
      {view.cards.length > 0 ? (
        <div className="engine-methodology-view__cards">
          {view.cards.map((card) => (
            <article key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </article>
          ))}
        </div>
      ) : null}
      {view.rows.length > 0 ? (
        <div className="engine-methodology-view__rows">
          {view.rows.slice(0, 8).map((row, index) => (
            <article key={`${row.label}-${row.axis ?? "axis"}-${index}`}>
              <div>
                <strong>{row.label}</strong>
                <span>{row.axis ?? row.entity ?? "sin eje"}</span>
              </div>
              <small>{row.evidence_count} ev. · score {row.score ?? "n/a"} · {confidenceLabel(row.confidence)}</small>
            </article>
          ))}
        </div>
      ) : null}
      {view.conclusions.length > 0 ? (
        <div className="engine-methodology-view__conclusions">
          {view.conclusions.slice(0, 4).map((item, index) => (
            <article key={`${item.kind}-${index}`}>
              <span>{prettifyKey(item.kind)}</span>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EngineChartPreview({ chart }: { chart: EngineChart }) {
  const rows = arrayValue(chart.data).map(asRecord);
  const confidenceCounts = asRecord(chart.data);
  const maxScore = Math.max(1, ...rows.map((row) => Number(row.score ?? row.frequency ?? row.share_pct ?? 0)));

  if (chart.type === "confidence_badge") {
    const total = Number(confidenceCounts.alta ?? 0) + Number(confidenceCounts.media ?? 0) + Number(confidenceCounts.baja_direccional ?? 0);
    const segments = [
      { key: "alta", label: "High", count: Number(confidenceCounts.alta ?? 0) },
      { key: "media", label: "Medium", count: Number(confidenceCounts.media ?? 0) },
      { key: "baja_direccional", label: "Directional", count: Number(confidenceCounts.baja_direccional ?? 0) }
    ].filter((segment) => segment.count > 0);
    return (
      <article className="engine-chart-preview engine-chart-preview--confidence">
        <EngineChartPreviewHeader chart={chart} />
        <div className="engine-confidence-strip">
          {segments.map((segment) => (
            <span
              className={`engine-confidence-strip__segment engine-confidence-strip__segment--${segment.key}`}
              key={segment.key}
              style={{ width: `${Math.max(10, (segment.count / Math.max(1, total)) * 100)}%` }}
            >
              {segment.label} · {segment.count}
            </span>
          ))}
        </div>
      </article>
    );
  }

  if (chart.type === "stacked_share") {
    const groups = groupRows(rows, (row) => stringValue(row.narrative) || stringValue(row.entity) || stringValue(row.name) || "signal");
    return (
      <article className="engine-chart-preview engine-chart-preview--stacked">
        <EngineChartPreviewHeader chart={chart} />
        <div className="engine-stacked-preview">
          {groups.slice(0, 5).map(([group, groupRows]) => {
            const total = Math.max(1, groupRows.reduce((sum, row) => sum + Number(row.share_pct ?? row.frequency ?? 0), 0));
            return (
              <div key={group}>
                <strong>{truncate(group, 44)}</strong>
                <span>
                  {groupRows.slice(0, 4).map((row, index) => {
                    const value = Number(row.share_pct ?? row.frequency ?? 0);
                    return (
                      <i
                        className={`engine-stacked-segment engine-stacked-segment--${index % 4}`}
                        key={`${group}-${stringValue(row.entity)}-${index}`}
                        style={{ width: `${Math.max(8, (value / total) * 100)}%` }}
                        title={`${stringValue(row.entity) || stringValue(row.advocacy_class) || "segment"} · ${value.toFixed(value > 10 ? 0 : 1)}`}
                      />
                    );
                  })}
                </span>
                <small>{groupRows.length} segments · {fmtCompact(total)} total</small>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  if (chart.type === "diverging_bar") {
    const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(Number(row.advocacy_proxy ?? row.risk_score ?? row.score ?? 0))));
    return (
      <article className="engine-chart-preview engine-chart-preview--diverging">
        <EngineChartPreviewHeader chart={chart} />
        <div className="engine-diverging-preview">
          {rows.slice(0, 7).map((row, index) => {
            const value = Number(row.advocacy_proxy ?? row.risk_score ?? row.score ?? 0);
            return (
              <div key={`${stringValue(row.finding_key)}-${index}`}>
                <span>{truncate(stringValue(row.theme) || stringValue(row.name), 36)}</span>
                <b>
                  <i
                    className={value < 0 ? "is-negative" : "is-positive"}
                    style={{ width: `${Math.max(6, (Math.abs(value) / maxAbs) * 50)}%` }}
                  />
                </b>
                <small>{Number.isFinite(value) ? value.toFixed(value > 10 ? 0 : 1) : "n/a"}</small>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  if (chart.type === "gauge") {
    return (
      <article className="engine-chart-preview engine-chart-preview--gauge">
        <EngineChartPreviewHeader chart={chart} />
        <div className="engine-gauge-preview">
          {rows.slice(0, 5).map((row, index) => {
            const trust = Math.max(0, Math.min(100, Number(row.trust_score ?? row.score ?? 0)));
            const risk = Math.max(0, Number(row.risk_score ?? 0));
            return (
              <div key={`${stringValue(row.finding_key)}-${index}`}>
                <header>
                  <strong>{truncate(stringValue(row.entity) || stringValue(row.name), 42)}</strong>
                  <small>{trust.toFixed(0)} trust · {fmtCompact(risk)} risk</small>
                </header>
                <span><i style={{ width: `${trust}%` }} /></span>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  if (chart.type === "timeline") {
    return (
      <article className="engine-chart-preview engine-chart-preview--timeline">
        <EngineChartPreviewHeader chart={chart} />
        <div className="engine-timeline-preview">
          {rows.slice(0, 8).map((row, index) => (
            <div key={`${stringValue(row.finding_key)}-${index}`}>
              <span>{stringValue(row.period) || String(index + 1)}</span>
              <i style={{ height: `${Math.max(8, (Number(row.frequency ?? 0) / maxScore) * 100)}%` }} />
              <small>{fmtCompact(Number(row.frequency ?? 0))}</small>
            </div>
          ))}
        </div>
      </article>
    );
  }

  if (chart.type === "waterfall") {
    return (
      <article className="engine-chart-preview engine-chart-preview--waterfall">
        <EngineChartPreviewHeader chart={chart} />
        <div className="engine-waterfall-preview">
          {rows.slice(0, 7).map((row, index) => {
            const blocker = Number(row.choke_score ?? row.frequency ?? 0);
            const accelerator = Number(row.accelerator_score ?? 0);
            const max = Math.max(1, blocker, accelerator);
            return (
              <div key={`${stringValue(row.finding_key)}-${index}`}>
                <span>{truncate(stringValue(row.phase) || stringValue(row.name), 38)}</span>
                <b><i className="is-blocker" style={{ width: `${Math.max(4, (blocker / max) * 100)}%` }} /></b>
                <b><i className="is-accelerator" style={{ width: `${Math.max(4, (accelerator / max) * 100)}%` }} /></b>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  if (["matrix_2x2", "heatmap", "radar", "radial", "wave_plot", "scatter_effort_impact", "bubble_field"].includes(chart.type)) {
    return (
      <article className="engine-chart-preview engine-chart-preview--matrix">
        <EngineChartPreviewHeader chart={chart} />
        <div className="engine-matrix-preview">
          {rows.slice(0, 9).map((row, index) => {
            const score = Number(row.value_score ?? row.choke_score ?? row.risk_score ?? row.score ?? row.intensity ?? row.frequency ?? 0);
            return (
              <span
                key={`${stringValue(row.finding_key)}-${index}`}
                style={{ opacity: Math.max(0.35, Math.min(1, score / maxScore)) }}
                title={stringValue(row.name)}
              >
                <strong>{truncate(stringValue(row.benefit) || stringValue(row.phase) || stringValue(row.name), 34)}</strong>
                <small>{stringValue(row.cost) || stringValue(row.friction_type) || stringValue(row.y) || `${fmtCompact(Number(row.frequency ?? row.evidence_count ?? 0))} ev.`}</small>
              </span>
            );
          })}
        </div>
      </article>
    );
  }

  if (chart.type === "evidence_list" || chart.type === "tension_card") {
    return (
      <article className="engine-chart-preview engine-chart-preview--list">
        <EngineChartPreviewHeader chart={chart} />
        {rows.slice(0, 4).map((row, index) => (
          <p key={`${stringValue(row.finding_key)}-${index}`}>
            <strong>{truncate(stringValue(row.name), 48)}</strong>
            <span>{Object.entries(asRecord(row.dimensions)).slice(0, 2).map(([key, value]) => `${prettifyKey(key)}: ${String(value)}`).join(" · ")}</span>
          </p>
        ))}
      </article>
    );
  }

  return (
    <article className="engine-chart-preview engine-chart-preview--bars">
      <EngineChartPreviewHeader chart={chart} />
      <div className="engine-bar-preview">
        {rows.slice(0, 6).map((row, index) => {
          const value = Number(row.score ?? row.share_pct ?? row.frequency ?? 0);
          return (
            <div key={`${stringValue(row.finding_key)}-${index}`}>
              <span>{truncate(stringValue(row.name), 42)}</span>
              <i style={{ width: `${Math.max(6, (value / maxScore) * 100)}%` }} />
              <small>{Number.isFinite(value) ? value.toFixed(value > 10 ? 0 : 2) : "n/a"}</small>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function EngineChartPreviewHeader({ chart }: { chart: EngineChart }) {
  return (
    <header>
      <span>{prettifyKey(chart.type)}</span>
      <strong>{chart.title}</strong>
      <small>{confidenceLabel(chart.confidence)} · {chart.evidence_ids.length} evidence links</small>
    </header>
  );
}

function CompetitivePanel({
  brandName,
  competitive,
  evidenceDeepDives,
  findings,
  methodologyBlocks,
}: {
  brandName: string;
  competitive: ReturnType<typeof adaptTbSignalPayload>["competitive"];
  evidenceDeepDives: ReturnType<typeof adaptTbSignalPayload>["evidenceDeepDives"];
  findings: PublicTbFinding[];
  methodologyBlocks: ReturnType<typeof adaptTbSignalPayload>["methodologyBlocks"];
}) {
  if (!competitive.enabled) {
    return (
      <FindingNotice
        icon="layers"
        title="Benchmark competitivo pendiente."
        body={competitive.limitations[0] || "Sube CSVs de competencia o industria atribuidos para activar ownership, gaps y acciones competitivas."}
      />
    );
  }

  const presence = competitive.finding_entity_presence.map(asRecord);
  const gaps = competitive.gaps.map(asRecord);
  const brandCount = competitive.entities.find((entity) => entity.entity_kind === "primary_brand")?.mention_count ?? 0;
  const competitorCount = competitive.entities.find((entity) => entity.entity_kind === "competitor_pool")?.mention_count ?? 0;
  const categoryCount = competitive.entities.find((entity) => entity.entity_kind === "category")?.mention_count ?? 0;
  const ownershipSegments = [
    { key: "category", title: "Category-wide", count: categoryCount, tone: "category" },
    { key: "competitor", title: "Competitor-owned", count: competitorCount, tone: "competitor" },
    { key: "brand", title: "Brand-owned", count: brandCount, tone: "brand" }
  ].filter((segment) => segment.count > 0);
  const ownershipTotal = ownershipSegments.reduce((sum, segment) => sum + segment.count, 0);
  const ownershipGroups = [
    {
      key: "brand_owned",
      title: "Brand-owned",
      description: `Where ${brandName} is visibly implicated or can credibly own the move.`,
      items: presence.filter((item) => stringValue(item.ownership) === "brand_owned" || Number(item.brand_mentions ?? 0) > Number(item.competitor_mentions ?? 0))
    },
    {
      key: "competitor_owned",
      title: "Competitor-owned",
      description: "Where competitors or the competitor pool are carrying the signal.",
      items: presence.filter((item) => stringValue(item.ownership) === "competitor_owned" || stringValue(item.dominant_entity_kind) === "competitor_pool")
    },
    {
      key: "category_wide",
      title: "Category-wide",
      description: "Where the barrier/trigger belongs to banking culture, not one brand.",
      items: presence.filter((item) => stringValue(item.ownership) === "category_wide" || stringValue(item.dominant_entity_kind) === "category")
    }
  ];
  const categoryGroup = ownershipGroups.find((group) => group.key === "category_wide");
  const competitorGroup = ownershipGroups.find((group) => group.key === "competitor_owned");
  const brandGroup = ownershipGroups.find((group) => group.key === "brand_owned");
  const strongestCategory = categoryGroup?.items[0];
  const strongestCompetitor = competitorGroup?.items[0];
  const strongestBrand = brandGroup?.items[0];
  const topConversionItems = uniqueCompetitiveItems([
    ...(competitorGroup?.items ?? []),
    ...(brandGroup?.items ?? []),
    ...(categoryGroup?.items ?? [])
  ]).slice(0, 3);
  const dominantSegment = ownershipSegments.reduce<typeof ownershipSegments[number] | null>(
    (winner, segment) => (!winner || segment.count > winner.count ? segment : winner),
    null
  );
  const ownershipInsight = dominantSegment
    ? `Most of the attributed signal is ${dominantSegment.title.toLowerCase()}, while competitor-owned barriers create ${Math.max(1, competitorGroup?.items.length ?? 0)} possible openings for ${brandName}.`
    : "Competitive ownership is available only for claims with attributed evidence.";

  return (
    <div className="competitive-panel competitive-panel--intelligence">
      <section className="competitive-ownership-card">
        <header>
          <div>
            <h3>Signal ownership</h3>
            <p>How the attributed corpus splits between category pressure, competitor-owned friction and brand-owned signal.</p>
          </div>
          <div className="competitive-share-actions" aria-label="Benchmark actions">
            <button type="button"><Icon name="upload" size={15} /> Share benchmark</button>
            <button type="button" aria-label="More benchmark options">...</button>
          </div>
        </header>
        <div className="competitive-ownership-bar" aria-label="Competitive ownership split">
          {ownershipSegments.map((segment) => {
            const share = Math.round((segment.count / Math.max(1, ownershipTotal)) * 100);
            return (
              <div
                className={`competitive-ownership-segment competitive-ownership-segment--${segment.tone}`}
                key={segment.key}
                style={{ width: `${Math.max(share, 12)}%` }}
              >
                <span>{segment.title}</span>
                <strong>{share}% · {fmtCompact(segment.count)}</strong>
              </div>
            );
          })}
        </div>
        <p className="competitive-ownership-insight">
          <Icon name="sparkle" size={16} />
          {ownershipInsight}
        </p>
      </section>

      <section className="competitive-answer competitive-answer--benchmark">
        <div>
          <p className="signal-eyebrow">Benchmark answer</p>
          <h3>
            {dominantSegment?.key === "category"
              ? `This is mostly a category problem, but competitors are exposed where trust, switching and tone break down.`
              : `${brandName} has a distinct competitive read, but claims stay tied to attributed evidence.`}
          </h3>
          <ul className="competitive-answer-list">
            <li>
              <Icon name="clock" size={16} />
              <p><strong>Category pressure:</strong> {competitiveItemDescription(strongestCategory ?? {}, "The biggest pressure is category-wide, so the brand should treat it as context before claiming ownership.")}</p>
            </li>
            <li>
              <Icon name="alert" size={16} />
              <p><strong>Competitor weakness:</strong> {competitiveItemDescription(strongestCompetitor ?? {}, "Competitor-owned signals reveal what the brand can counter, avoid or convert into a clearer proof point.")}</p>
            </li>
            <li>
              <Icon name="arrow-up" size={16} />
              <p><strong>{brandName} opening:</strong> {competitiveItemDescription(strongestBrand ?? strongestCompetitor ?? {}, "The strongest opening is to turn competitor friction into a credible brand move with evidence, not imitation.")}</p>
            </li>
          </ul>
        </div>
        <div className="competitive-answer-orb" aria-hidden="true">
          <Icon name="arrow-up" size={42} />
        </div>
      </section>

      {topConversionItems.length > 0 ? (
        <section className="competitive-conversion-section">
          <header>
            <h3>Top conversion opportunities</h3>
            <p>Competitor and category barriers the brand can convert into first-party advantage.</p>
          </header>
          <div className="competitive-conversion-grid">
            {topConversionItems.map((item, index) => {
              const findingId = stringValue(item.finding_id);
              const deepDive = evidenceDeepDives.find((dive) => dive.finding_id === findingId);
              const finding = findings.find((candidate) => candidate.finding_id === findingId);
              const evidenceCount = Number(item.brand_mentions ?? 0) + Number(item.competitor_mentions ?? 0) + Number(item.category_mentions ?? 0);
              return (
                <article className="competitive-conversion-card" key={`${findingId}-${index}`}>
                  <header>
                    <span>{index + 1}</span>
                    <h4>{stringValue(item.finding_name) || deepDive?.plain_language_title || finding?.finding_name || `Opportunity ${index + 1}`}</h4>
                  </header>
                  <div>
                    <span>Competitor barrier</span>
                    <p>{competitiveItemDescription(item, deepDive?.competitor_insight || finding?.public_quote || undefined)}</p>
                  </div>
                  <div>
                    <span>Convert into advantage</span>
                    <p>{deepDive?.future_watchout || deepDive?.description || "Use this signal as a proof point for a clearer, more credible brand move."}</p>
                  </div>
                  <div>
                    <span>Why it matters</span>
                    <p>{deepDive?.period_insight || deepDive?.channel_insight || "This opportunity matters because the claim is visible in attributed evidence, not inferred from the brief alone."}</p>
                  </div>
                  <small><Icon name="check" size={13} /> Evidence strength: {evidenceCount >= 25 ? "High" : evidenceCount >= 10 ? "Medium" : "Directional"} · {fmtCompact(evidenceCount)} items</small>
                  <a href={`#${findingAnchor(findingId)}`}>View evidence <Icon name="arrow-right" size={14} /></a>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {presence.length > 0 ? (
        <section className="competitive-ownership-table">
          <header>
            <div>
              <h3>Explore evidence by ownership</h3>
              <p>Counts reflect deduplicated, attributed signals only.</p>
            </div>
          </header>
          <div className="competitive-ownership-tabs" aria-label="Ownership evidence groups">
            {ownershipGroups.map((group) => (
              <a href={`#competitive-${group.key}`} key={group.key}>
                <Icon name={group.key === "brand_owned" ? "tag" : group.key === "competitor_owned" ? "alert" : "platform"} size={15} />
                {group.title}
                <span>{group.items.length}</span>
              </a>
            ))}
          </div>
          <div className="competitive-ledger-grid">
            {ownershipGroups.map((group) => (
              <section id={`competitive-${group.key}`} key={group.key}>
                <h4>{group.title}</h4>
                {group.items.length > 0 ? group.items.slice(0, 4).map((item) => (
                  <article key={`${group.key}-ledger-${stringValue(item.finding_id)}`}>
                    <strong>{stringValue(item.finding_name)}</strong>
                    <p>{competitiveItemDescription(item)}</p>
                    <small>Brand {fmtCompact(Number(item.brand_mentions ?? 0))} · Competitors {fmtCompact(Number(item.competitor_mentions ?? 0))} · Category {fmtCompact(Number(item.category_mentions ?? 0))}</small>
                  </article>
                )) : <p className="competitive-empty">No claim with enough evidence.</p>}
              </section>
            ))}
          </div>
        </section>
      ) : null}
      {gaps.length > 0 ? (
        <div className="competitive-gaps">
          <h3>Actionable gaps</h3>
          {gaps.slice(0, 6).map((gap, index) => (
            <p key={`${stringValue(gap.finding_id)}-${index}`}>
              <strong>{stringValue(gap.finding_name)}</strong>
              {stringValue(gap.question_to_answer)}
            </p>
          ))}
        </div>
      ) : null}
      <GenericMethodologyBlocks blocks={methodologyBlocks} />
    </div>
  );
}

function ComparativeDashboard({ dashboard }: { dashboard: NonNullable<ReturnType<typeof adaptTbSignalPayload>["competitive"]["dashboard"]> }) {
  const topEntities = dashboard.entity_finding_matrix.slice(0, 8);
  const ownershipRows = dashboard.ownership_rankings.slice(0, 5);
  const splitChart = dashboard.charts.find((chart) => chart.chart_id === "tb-comparative-trigger-barrier-split");
  const triggerBarrierRows = arrayValue(splitChart?.data).map(asRecord).slice(0, 8);
  const maxSplit = Math.max(
    1,
    ...triggerBarrierRows.flatMap((row) => [Number(row.triggers ?? 0), Number(row.barriers ?? 0)])
  );
  const conclusionCards = [
    { label: "Brand owned triggers", items: dashboard.conclusions.brand_owned_triggers },
    { label: "Competitor owned triggers", items: dashboard.conclusions.competitor_owned_triggers },
    { label: "Category-wide barriers", items: dashboard.conclusions.category_wide_barriers },
    { label: "Whitespace", items: dashboard.conclusions.whitespace },
    { label: "Actionable gaps", items: dashboard.conclusions.gaps_accionables }
  ].filter((card) => card.items.length > 0);

  return (
    <section className="comparative-dashboard">
      <header>
        <div>
          <p className="signal-eyebrow">T&B comparative dashboard</p>
          <h3>{dashboard.summary.headline}</h3>
          <p>Matrix view of which entity carries each trigger or barrier.</p>
        </div>
        <dl>
          <div><dt>Brand</dt><dd>{fmtCompact(dashboard.summary.brand_mentions)}</dd></div>
          <div><dt>Peers</dt><dd>{fmtCompact(dashboard.summary.competitor_mentions)}</dd></div>
          <div><dt>Category</dt><dd>{fmtCompact(dashboard.summary.category_mentions)}</dd></div>
        </dl>
      </header>

      <div className="comparative-dashboard-grid">
        <section className="comparative-matrix">
          <h4>Entity x finding matrix</h4>
          {topEntities.length > 0 ? topEntities.map((entity) => (
            <article key={entity.entity_id}>
              <header>
                <strong>{entity.entity_name}</strong>
                <span>{entity.entity_kind} · {fmtCompact(entity.mention_count)}</span>
              </header>
              <div>
                {entity.findings.slice(0, 5).map((finding) => (
                  <p key={`${entity.entity_id}-${finding.finding_id}`}>
                    <span style={{ width: `${Math.max(8, Math.min(100, finding.share_pct))}%` }} />
                    <strong>{finding.finding_name}</strong>
                    <em>
                      {fmtCompact(finding.mention_count)} · {Math.round(finding.share_pct)}% · {confidenceLabel(finding.confidence)}
                    </em>
                  </p>
                ))}
              </div>
            </article>
          )) : <p className="competitive-empty">No matrix evidence yet.</p>}
        </section>

        <section className="comparative-ownership-ranking">
          <h4>Ownership ranking</h4>
          {ownershipRows.map((row) => (
            <article key={row.ownership}>
              <span>{prettifyKey(row.ownership)}</span>
              <strong>{row.findings_count}</strong>
              <small>{row.top_findings.slice(0, 2).map((item) => stringValue(asRecord(item).finding_name)).filter(Boolean).join(" · ")}</small>
            </article>
          ))}
        </section>

        {triggerBarrierRows.length > 0 ? (
          <section className="comparative-trigger-split">
            <h4>Trigger / barrier split</h4>
            {triggerBarrierRows.map((row) => {
              const triggers = Number(row.triggers ?? 0);
              const barriers = Number(row.barriers ?? 0);
              const entityName = stringValue(row.entity_name) || "Entity";
              return (
                <article key={stringValue(row.entity_id) || entityName}>
                  <header>
                    <span>{entityName}</span>
                    <small>{fmtCompact(triggers + barriers)}</small>
                  </header>
                  <div>
                    <i style={{ width: `${Math.max(4, (triggers / maxSplit) * 100)}%` }} />
                    <b style={{ width: `${Math.max(4, (barriers / maxSplit) * 100)}%` }} />
                  </div>
                  <footer>
                    <span>{fmtCompact(triggers)} triggers</span>
                    <span>{fmtCompact(barriers)} barriers</span>
                  </footer>
                </article>
              );
            })}
          </section>
        ) : null}
      </div>
      {conclusionCards.length > 0 ? (
        <div className="comparative-conclusions">
          {conclusionCards.slice(0, 5).map((card) => (
            <article key={card.label}>
              <span>{card.label}</span>
              <strong>{card.items.length}</strong>
              <p>
                {card.items
                  .slice(0, 2)
                  .map((item) => stringValue(asRecord(item).finding_name))
                  .filter(Boolean)
                  .join(" · ") || "Evidence is directional."}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CompetitiveTbMatrix({ block }: { block: ReturnType<typeof adaptTbSignalPayload>["methodologyBlocks"]["competitive_tb_matrix"] }) {
  if (!block.findings.length) return null;
  const topFindings = block.findings.slice(0, 10);
  const topRankings = block.rankings.filter((ranking) => ranking.owned_findings_count > 0).slice(0, 5);
  const playbookCards = [
    { label: "Disputable", items: block.disputable },
    { label: "Do not copy", items: block.do_not_copy },
    { label: "Exclusive barriers", items: block.exclusive_barriers }
  ].filter((card) => card.items.length > 0);

  return (
    <section className="competitive-tb-matrix">
      <header>
        <div>
          <p className="signal-eyebrow">Competitive T&B Matrix</p>
          <h3>{block.title}</h3>
          <p>{block.summary}</p>
        </div>
        <dl>
          <div><dt>Findings</dt><dd>{block.findings.length}</dd></div>
          <div><dt>Rankings</dt><dd>{topRankings.length}</dd></div>
        </dl>
      </header>
      <div className="competitive-tb-layout">
        <div className="competitive-tb-table" role="table" aria-label="Competitive trigger and barrier matrix">
          <div className="competitive-tb-row competitive-tb-row--head" role="row">
            <span>Finding</span>
            <span>Dominant entity</span>
            <span>Share</span>
            <span>Diff</span>
            <span>Confidence</span>
          </div>
          {topFindings.map((finding) => {
            const dominant = finding.by_entity[0] ?? null;
            return (
              <a className="competitive-tb-row" href={`#${findingAnchor(finding.finding_id)}`} key={finding.finding_id} role="row">
                <span>
                  <strong>{finding.finding_name}</strong>
                  <small>{prettifyKey(finding.polarity)} · {prettifyKey(finding.layer)} · {prettifyKey(finding.ownership)}</small>
                </span>
                <span>{dominant?.entity_name ?? finding.dominant_entity_name ?? "Sin entidad"}</span>
                <span>{dominant ? `${Math.round(dominant.share_pct)}%` : "0%"}</span>
                <span>{dominant ? formatSignedPct(dominant.differentiation_index) : "0%"}</span>
                <span>{confidenceLabel(finding.confidence)}</span>
              </a>
            );
          })}
        </div>
        <aside className="competitive-tb-rankings">
          <h4>Dominance ranking</h4>
          {topRankings.length > 0 ? topRankings.map((ranking) => (
            <article key={ranking.entity_id}>
              <strong>{ranking.entity_name}</strong>
              <span>{ranking.owned_findings_count} owned findings</span>
              <p>{ranking.strongest_findings.slice(0, 3).join(" · ") || "Sin findings dominantes."}</p>
            </article>
          )) : (
            <p className="competitive-empty">No dominant entity with enough evidence yet.</p>
          )}
        </aside>
      </div>
      {playbookCards.length > 0 ? (
        <div className="competitive-tb-playbook">
          {playbookCards.map((card) => (
            <article key={card.label}>
              <span>{card.label}</span>
              {card.items.slice(0, 3).map((item, index) => {
                const record = asRecord(item);
                return (
                  <p key={`${card.label}-${stringValue(record.finding_id)}-${index}`}>
                    <strong>{stringValue(record.finding_name) || `Signal ${index + 1}`}</strong>
                    {stringValue(record.reason)}
                  </p>
                );
              })}
            </article>
          ))}
        </div>
      ) : null}
      {block.limitations.length > 0 ? (
        <p className="competitive-tb-limit">{block.limitations[0]}</p>
      ) : null}
    </section>
  );
}

function GenericMethodologyBlocks({ blocks }: { blocks: ReturnType<typeof adaptTbSignalPayload>["methodologyBlocks"] }) {
  const cards = [
    { key: "competitive_tb", title: blocks.competitive_tb_matrix.title, count: blocks.competitive_tb_matrix.findings.length, copy: "Matriz competitiva de triggers/barriers por entidad." },
    { key: "vpm", title: blocks.vpm.title, count: blocks.vpm.rows.length, copy: "Matriz valor por entidad." },
    { key: "jfm", title: blocks.jfm.title, count: blocks.jfm.rows.length, copy: "Fricciones por fase y entidad." },
    { key: "cultural", title: blocks.cultural_codes.title, count: blocks.cultural_codes.rows.length, copy: "Códigos por categoría y marca." },
    { key: "influence", title: blocks.influence_architecture.title, count: blocks.influence_architecture.rows.length, copy: "Nodos y comunidades por entidad." },
    { key: "velocity", title: blocks.decision_velocity.title, count: blocks.decision_velocity.rows.length, copy: "Blockers y accelerators por journey." }
  ];

  return (
    <section className="methodology-blocks">
      <header>
        <p className="signal-eyebrow">Reusable comparative blocks</p>
        <h3>Generic output layer for future methodologies</h3>
      </header>
      <div>
        {cards.map((card) => (
          <article key={card.key}>
            <strong>{card.title}</strong>
            <p>{card.copy}</p>
            <span>{card.count > 0 ? `${card.count} mapped rows` : "Waiting for methodology engine"}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function ActionStudioPanel({ actions }: { actions: PublicActionCard[] }) {
  const teams: Array<{ key: PublicActionCard["target_team"]; label: string }> = [
    { key: "brand_strategy", label: "Brand Strategy" },
    { key: "creative_content", label: "Creative / Content" },
    { key: "product_cx", label: "Product / CX" },
    { key: "retail_media", label: "Retail / Media" },
    { key: "measurement", label: "Measurement" },
    { key: "cultural_guardrails", label: "Guardrails" }
  ];
  const teamsWithActions = teams
    .map((team) => ({ ...team, actions: actions.filter((action) => action.target_team === team.key).slice(0, 3) }))
    .filter((team) => team.actions.length > 0);

  return (
    <div className="action-studio-grid">
      {teamsWithActions.map((team) => {
        const teamActions = team.actions;
        return (
          <section key={team.key}>
            <h3>{team.label}</h3>
            {teamActions.map((action) => (
              <article key={action.action_id}>
                <header>
                  <span>{prettifyActionKind(action.kind)}</span>
                  <strong>{action.title}</strong>
                </header>
                <div className="action-card-body">
                  <section>
                    <span>Why it matters</span>
                    <p>{action.rationale || "This action is tied to the prioritized evidence in the report."}</p>
                  </section>
                  <section>
                    <span>What to do</span>
                    <p>{action.action_text}</p>
                  </section>
                  {(action.suggested_format || action.suggested_channel) && (
                    <section className="action-example">
                      <span>Example activation</span>
                      <p>{actionExample(action)}</p>
                    </section>
                  )}
                </div>
                <div className="action-card-meta">
                  {action.suggested_channel && <span><Icon name="platform" size={12} /> {action.suggested_channel}</span>}
                  {action.suggested_format && <span><Icon name="message" size={12} /> {action.suggested_format}</span>}
                  {action.estimated_impact && <span>Impact {valueLabel(action.estimated_impact)}</span>}
                  {action.estimated_effort && <span>Effort {valueLabel(action.estimated_effort)}</span>}
                  {action.confidence && <span>Confidence {confidenceLabel(action.confidence)}</span>}
                </div>
                {action.finding_ids.length > 0 && (
                  <div className="action-card-findings">
                    {action.finding_ids.slice(0, 3).map((findingId) => (
                      <a href={`#${findingAnchor(findingId)}`} key={findingId}>{findingId}</a>
                ))}
              </div>
            )}
            {action.success_signal && (
              <small>
                <Icon name="check" size={12} />
                Success signal: {action.success_signal}
              </small>
            )}
              </article>
            ))}
          </section>
        );
      })}
      {teamsWithActions.length === 0 ? (
        <FindingNotice icon="info" title="Action Studio pendiente." body="Este corte no trae acciones client-safe suficientes. Recorre Step 6 para generar el handoff por equipo." />
      ) : null}
    </div>
  );
}

function EmergingPatternsPanel({
  corpusId,
  patterns,
  marketAnalysis,
  futureSignals,
}: {
  corpusId: string;
  patterns: EmergingPattern[];
  marketAnalysis: ReturnType<typeof adaptTbSignalPayload>["marketAnalysis"];
  futureSignals: ReturnType<typeof adaptTbSignalPayload>["futureSignals"];
}) {
  const visiblePatterns = dedupeEmergingPatterns(patterns);
  if (visiblePatterns.length === 0 && !marketAnalysis && futureSignals.length === 0) {
    return (
      <FindingNotice
        icon="wave"
        title="Emerging Patterns pendiente."
        body="Los próximos outputs generarán esta capa abierta desde corpus, Knowledge Base y archivos del cliente."
      />
    );
  }

  return <SignalEmergingPatternsExplorer corpusId={corpusId} futureSignals={futureSignals} marketAnalysis={marketAnalysis} patterns={patterns} />;
}

function FindingDetailDrawer({
  findings,
  actions,
  competitive,
  evidenceDeepDives,
  mentionsSample,
}: {
  findings: PublicTbFinding[];
  actions: PublicActionCard[];
  competitive: ReturnType<typeof adaptTbSignalPayload>["competitive"];
  evidenceDeepDives: ReturnType<typeof adaptTbSignalPayload>["evidenceDeepDives"];
  mentionsSample: JsonRecord[];
}) {
  return (
    <FindingDetailWorkspace
      actions={actions}
      competitivePresence={competitive.finding_entity_presence}
      evidenceDeepDives={evidenceDeepDives}
      findings={findings}
      mentionsSample={mentionsSample}
    />
  );
}

/* === Kicker / cards already had implementations === */

function TopBarriersPanel({
  topBarriers,
  barriers,
  topVoice,
  mentionsSample,
}: {
  topBarriers: JsonRecord[];
  barriers: JsonRecord[];
  topVoice: JsonRecord[];
  mentionsSample: JsonRecord[];
}) {
  return (
    <ol className="signal-kickers signal-kickers--executive">
      {topBarriers.slice(0, 5).map((barrier, i) => {
        const id = stringValue(barrier.id);
        const detail = barriers.find((b) => stringValue(b.finding_id) === id) ?? {};
        const voice = topVoice.find((v) => stringValue(v.finding_id) === id) ?? {};
        const samples = mentionsSample.filter((m) => stringValue(m.finding_id) === id);
        const channels = summarizeChannels(samples);
        return (
          <li className="signal-kicker signal-kicker--rich" key={`${barrier.id ?? i}`}>
            <span className="signal-kicker-num">{String(i + 1).padStart(2, "0")}</span>
            <div className="signal-kicker-body">
              <div className="signal-kicker-main">
                <h3 className="signal-kicker-label">{stringValue(barrier.label) || "Sin etiqueta"}</h3>
                <p className="signal-kicker-action">
                  {truncate(stringValue(barrier.action) || stringValue(detail.text), 220) || "Acción pendiente."}
                </p>
                {stringValue(barrier.quote) && (
                  <blockquote className="signal-kicker-quote">“{truncate(stringValue(barrier.quote), 260)}”</blockquote>
                )}
              </div>
              <aside className="signal-kicker-proof">
                <dl>
                  <div>
                    <dt>Evidencia</dt>
                    <dd>{fmtCompact(Number(voice.citation_count ?? samples.length))}</dd>
                  </div>
                  <div>
                    <dt>Capa</dt>
                    <dd>{prettifyKey(stringValue(detail.layer) || stringValue(voice.layer) || "sin capa")}</dd>
                  </div>
                  <div>
                    <dt>Movilidad</dt>
                    <dd>{prettifyKey(stringValue(detail.movilidad) || "sin clasificar")}</dd>
                  </div>
                </dl>
                <div className="signal-kicker-channels">
                  {channels.length > 0 ? channels.map((channel) => (
                    <span key={channel.label}>{channel.label} · {channel.count}</span>
                  )) : <span>Canales no incluidos en muestra</span>}
                </div>
                {stringValue(barrier.confidence) && (
                  <span className={`signal-confidence-pill signal-confidence-pill--${normalizeConfidence(barrier.confidence)}`}>
                    Confianza {stringValue(barrier.confidence)}
                  </span>
                )}
              </aside>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FindingCard({ item, variant }: { item: JsonRecord; variant?: "structural" }) {
  const layer = stringValue(item.layer);
  const mobility = stringValue(item.movilidad);
  const effort = stringValue(item.effort);
  const owner = stringValue(item.owner);
  const successSignal = stringValue(item.success_signal);
  return (
    <article className={`signal-finding${variant === "structural" ? " signal-finding--structural" : ""}`}>
      <header className="signal-finding-head">
        <span className="signal-finding-code">{stringValue(item.finding_id) || stringValue(item.kind)}</span>
        <span className={`signal-confidence-pill signal-confidence-pill--${normalizeConfidence(item.confidence)}`}>
          {stringValue(item.confidence) || "media"}
        </span>
      </header>
      <h3 className="signal-finding-name">{stringValue(item.finding_name) || "Hallazgo"}</h3>
      <p className="signal-finding-text">{stringValue(item.text) || "Sin texto publicado."}</p>
      {(layer || mobility || effort) && (
        <div className="signal-finding-tags">
          {layer && <Chip>capa · {layer}</Chip>}
          {mobility && <Chip>{prettifyKey(mobility)}</Chip>}
          {effort && <Chip>esfuerzo · {effort}</Chip>}
        </div>
      )}
      {successSignal && (
        <p className="signal-finding-success">
          <Icon name="check" size={12} /> {successSignal}
        </p>
      )}
      {owner && (
        <p className="signal-finding-owner">
          <Icon name="info" size={12} /> {owner}
        </p>
      )}
    </article>
  );
}

function BestMoveCard({ move, mentions }: { move: JsonRecord; mentions: JsonRecord[] }) {
  if (!stringValue(move.finding_name)) {
    return (
      <FindingNotice
        icon="info"
        title="Aún no hay mejor jugada priorizada."
        body="El compositor de Signal seleccionará la acción con mayor score + movilidad cuando el análisis esté completo."
      />
    );
  }
  const owner = stringValue(move.owner);
  const successSignal = stringValue(move.success_signal);
  return (
    <article className="signal-bestmove-shell">
      <div className="signal-bestmove">
        <p className="signal-eyebrow">Mejor jugada · prioridad #1</p>
        <h3 className="signal-bestmove-name">{stringValue(move.finding_name)}</h3>
        <p className="signal-bestmove-text">{stringValue(move.text)}</p>
        <dl className="signal-bestmove-meta">
          {successSignal && (
            <div>
              <dt>Indicador de éxito</dt>
              <dd>{successSignal}</dd>
            </div>
          )}
          {owner && (
            <div>
              <dt>Responsable sugerido</dt>
              <dd>{owner}</dd>
            </div>
          )}
          {stringValue(move.effort) && (
            <div>
              <dt>Esfuerzo</dt>
              <dd>{stringValue(move.effort)}</dd>
            </div>
          )}
        </dl>
      </div>
      <aside className="signal-evidence-rail">
        <span>Conversaciones que justifican</span>
        <div className="signal-evidence-scroll">
          {mentions.length > 0 ? mentions.slice(0, 8).map((mention, index) => (
            <blockquote key={stringValue(mention.mention_id) || index}>
              <small>{stringValue(mention.platform) || "Fuente"}</small>
              {truncate(stringValue(mention.text), 180)}
            </blockquote>
          )) : (
            <p>No hay verbatims de muestra asociados a esta jugada en el payload publicado.</p>
          )}
        </div>
      </aside>
    </article>
  );
}

function ActionRow({ item, rank }: { item: JsonRecord; rank: number }) {
  return (
    <li className="signal-action-row">
      <span className="signal-action-rank">{String(rank).padStart(2, "0")}</span>
      <div className="signal-action-body">
        <h4>{stringValue(item.finding_name) || "Acción"}</h4>
        <p>{truncate(stringValue(item.text), 240)}</p>
      </div>
    </li>
  );
}

function TensionMap({
  triggers,
  barriers,
  findingsScatter,
  triggersTotal,
  barriersTotal,
}: {
  triggers: JsonRecord[];
  barriers: JsonRecord[];
  findingsScatter: JsonRecord[];
  triggersTotal: number;
  barriersTotal: number;
}) {
  const total = Math.max(1, triggersTotal + barriersTotal);
  const trigPct = (triggersTotal / total) * 100;
  const barPct = (barriersTotal / total) * 100;
  const layerRows = summarizeLayerTension([...triggers, ...barriers], findingsScatter);
  return (
    <div className="tension-map">
      <div className="tension-bar" role="img" aria-label={`Triggers ${triggersTotal} vs Barriers ${barriersTotal}`}>
        <div className="tension-bar-triggers" style={{ width: `${trigPct}%` }}>
          <span>{triggersTotal} triggers</span>
        </div>
        <div className="tension-bar-barriers" style={{ width: `${barPct}%` }}>
          <span>{barriersTotal} barriers</span>
        </div>
      </div>
      <div className="tension-layer-grid">
        {layerRows.map((row) => (
          <article key={row.layer}>
            <span>{row.label}</span>
            <strong>{row.count}</strong>
            <div><i style={{ width: `${row.force}%` }} /></div>
            <small>Fuerza {row.force}% · confianza {row.confidence}</small>
          </article>
        ))}
      </div>
      <div className="tension-cols">
        <div className="tension-col tension-col--triggers">
          <p className="signal-eyebrow">Empujan a comprar</p>
          {triggers.length > 0 ? (
            <ul>
              {triggers.slice(0, 5).map((t, i) => (
                <li key={stringValue(t.id) || String(i)}>{stringValue(t.finding_name)}</li>
              ))}
            </ul>
          ) : (
            <p className="tension-empty">
              Sin señales positivas en este corte. La fuerza del corpus está completamente del lado de la fricción.
            </p>
          )}
        </div>
        <div className="tension-col tension-col--barriers">
          <p className="signal-eyebrow">Frenan la decisión</p>
          <ul>
            {barriers.slice(0, 5).map((b, i) => (
              <li key={stringValue(b.id) || String(i)}>{stringValue(b.finding_name)}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function FrictionHeatmap({ barriers }: { barriers: JsonRecord[] }) {
  const stages = [
    { label: "Awareness", key: "awareness" },
    { label: "Consideración", key: "consideration" },
    { label: "Evaluación", key: "evaluation" },
    { label: "Compra", key: "purchase" },
    { label: "Uso", key: "usage" },
    { label: "Recompra", key: "repeat" },
    { label: "Recomendación", key: "advocacy" },
  ];
  return (
    <div className="friction-heatmap">
      <div className="friction-heatmap-head">
        <span />
        {stages.map((s) => (
          <span key={s.key}>{s.label}</span>
        ))}
      </div>
      {barriers.map((b, rowIdx) => {
        const ji = asRecord(b.journey_intensity);
        const rowValues = stages.map((s) => Number(ji[s.key] ?? 0));
        const rowMax = Math.max(...rowValues, 0.001);
        return (
          <div className="friction-heatmap-row" key={stringValue(b.id) || String(rowIdx)}>
            <span className="friction-heatmap-label">{stringValue(b.finding_name) || "Barrera"}</span>
            {stages.map((s, colIdx) => {
              const raw = rowValues[colIdx] ?? 0;
              const norm = raw / rowMax;
              const pct = Math.round(raw * 100);
              return (
                <span
                  className="friction-heatmap-cell"
                  key={s.key}
                  style={{ background: heatColor(norm) }}
                  title={`${pct}% del peso`}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function MentionCard({ item }: { item: JsonRecord }) {
  const date = stringValue(item.published_at);
  const dateLabel = date ? new Date(date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "";
  return (
    <li className={`mention-card${Boolean(item.is_protagonist) ? " mention-card--protagonist" : ""}`}>
      <header className="mention-card-head">
        <span className="mention-card-platform">
          <Icon name="platform" size={12} /> {stringValue(item.platform)}
        </span>
        {Boolean(item.is_protagonist) && (
          <span className="mention-card-flag">
            <Icon name="star" size={11} /> protagonista
          </span>
        )}
      </header>
      <blockquote>“{truncate(stringValue(item.text), 320)}”</blockquote>
      <footer className="mention-card-foot">
        {stringValue(item.finding_name) && (
          <span className="mention-card-finding">
            <Icon name="tag" size={11} /> {stringValue(item.finding_name)}
          </span>
        )}
        {dateLabel && <span className="mention-card-date">{dateLabel}</span>}
      </footer>
    </li>
  );
}

function FindingNotice({ icon, title, body }: { icon: "info" | "wave" | "message" | "layers"; title: string; body: string }) {
  return (
    <div className="signal-notice">
      <span className="signal-notice-icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function QualityBoundariesPanel({
  clientBoundaries,
  limitations,
  publishedEvidenceCount,
  totalMentions,
}: {
  clientBoundaries: string[];
  limitations: JsonRecord;
  publishedEvidenceCount: number;
  totalMentions: number;
}) {
  const limitationEntries = Object.entries(limitations)
    .map(([key, value]) => friendlyLimitation(key, value))
    .filter(Boolean);
  const cards = [
    {
      icon: "check" as const,
      title: "Qué sí podemos afirmar",
      body: "Los findings y acciones están conectados a evidencia del corte publicado y deben leerse junto con su confianza.",
      stat: `${fmtCompact(totalMentions)} menciones en el snapshot`
    },
    {
      icon: "message" as const,
      title: "Qué evidencia ve el cliente",
      body: "Signal muestra citas seleccionadas para explicar los hallazgos sin abrir el corpus completo ni datos operativos internos.",
      stat: `${fmtCompact(publishedEvidenceCount)} verbatims publicados`
    },
    {
      icon: "layers" as const,
      title: "Cómo leer competencia",
      body: "Los claims comparativos sólo aparecen cuando existe data atribuida de marca, competencia o industria.",
      stat: "Sin evidencia, queda como pendiente"
    }
  ];

  return (
    <div className="quality-panel">
      <header>
        <p className="signal-eyebrow signal-eyebrow--quiet">Quality / Boundaries</p>
        <h3>Cómo leer este reporte con confianza</h3>
        <span>Client-friendly: límites claros, sin SQL, gates internos ni notas de operación.</span>
      </header>

      <div className="quality-card-grid">
        {cards.map((card) => (
          <article key={card.title}>
            <span className="quality-card-icon"><Icon name={card.icon} size={17} /></span>
            <strong>{card.title}</strong>
            <p>{card.body}</p>
            <small>{card.stat}</small>
          </article>
        ))}
      </div>

      <div className="quality-boundary-list">
        <section>
          <strong>Notas de lectura</strong>
          {(clientBoundaries.length > 0 ? clientBoundaries : ["El reporte muestra una lectura accionable del snapshot publicado."]).map((boundary, index) => (
            <p key={index}><Icon name="info" size={12} /> {friendlyBoundary(boundary)}</p>
          ))}
        </section>
        <section>
          <strong>Límites del corte</strong>
          {limitationEntries.length > 0 ? limitationEntries.map((entry, index) => (
            <p key={index}><Icon name="info" size={12} /> {entry}</p>
          )) : (
            <p><Icon name="check" size={12} /> No hay límites adicionales declarados para este output publicado.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="signal-chip">{children}</span>;
}

/* ============================================================ Helpers ============================================================ */

function heatColor(intensity: number): string {
  const alpha = 0.06 + intensity * 0.72;
  return `rgba(0, 126, 137, ${alpha})`;
}

function summarizeChannels(items: JsonRecord[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const platform = stringValue(item.platform);
    if (!platform || isContentTypeToken(platform)) continue;
    counts.set(platform, (counts.get(platform) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function isContentTypeToken(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  return ["comment", "comments", "video", "shorts", "reel", "reels", "post", "tweet", "quote_tweet"].includes(normalized);
}

function splitLeadSentence(text: string) {
  const clean = text.trim();
  if (!clean) return { title: "", body: "" };
  const match = clean.match(/^(.+?[.!?])(\s+|$)([\s\S]*)$/);
  if (!match) return { title: clean, body: "" };
  return {
    title: (match[1] ?? clean).trim(),
    body: (match[3] ?? "").trim(),
  };
}

function selectKnowledgeHeroText(answer: string, summary: string | null) {
  const cleanAnswer = answer.trim();
  const cleanSummary = (summary ?? "").trim();
  const genericSummary = /^client-ready read of the approved corpus/i.test(cleanSummary);
  const isMainAnswer = /first direct'?s tiktok problem/i.test(cleanAnswer);
  const isCompetitiveSnippet = /^(monzo|natwest|barclays|revolut)\b/i.test(cleanAnswer) || /hip[oó]tesis:/i.test(cleanAnswer);

  if (isMainAnswer) return cleanAnswer;
  if (cleanSummary && !genericSummary) return cleanSummary;
  if (cleanAnswer && !isCompetitiveSnippet) return cleanAnswer;
  return cleanSummary || cleanAnswer;
}

function layerLabel(layer: PublicTbFinding["layer"]) {
  if (layer === "psicologico") return "Psychological";
  if (layer === "personal") return "Personal";
  if (layer === "social") return "Social";
  if (layer === "cultural") return "Cultural";
  return prettifyKey(layer);
}

function confidenceLabel(value: unknown) {
  const normalized = normalizeConfidence(value);
  if (normalized === "alta") return "High";
  if (normalized === "baja") return "Directional";
  return "Medium";
}

function valueLabel(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "alto" || normalized === "alta" || normalized === "high") return "High";
  if (normalized === "bajo" || normalized === "baja" || normalized === "low") return "Low";
  if (normalized === "media" || normalized === "medio" || normalized === "medium") return "Medium";
  return prettifyKey(value);
}

function prettifyActionKind(kind: PublicActionCard["kind"]) {
  const labels: Record<PublicActionCard["kind"], string> = {
    activation: "Activation",
    friction_removal: "Friction removal",
    alignment: "Alignment",
    experiment: "Experiment",
    guardrail: "Guardrail",
    structural_note: "Structural note"
  };
  return labels[kind] ?? valueLabel(kind);
}

function competitiveItemDescription(item: JsonRecord, fallback?: string) {
  if (fallback) return truncate(fallback, 170);
  const ownership = stringValue(item.ownership);
  const brand = Number(item.brand_mentions ?? 0);
  const competitor = Number(item.competitor_mentions ?? 0);
  const category = Number(item.category_mentions ?? 0);
  if (ownership === "brand_owned" || brand > competitor + category) {
    return "This signal is visibly connected to the brand, so it needs a brand-owned response rather than a category explanation.";
  }
  if (ownership === "competitor_owned" || competitor > brand) {
    return "Competitors are carrying more evidence for this signal, so the opportunity is to decide whether to counter, borrow or avoid the move.";
  }
  return "The signal is mostly category-wide: useful context for strategy, but not a claim that one brand alone owns the problem.";
}

function uniqueCompetitiveItems(items: JsonRecord[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = stringValue(item.finding_id) || stringValue(item.finding_name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function actionExample(action: PublicActionCard) {
  const channel = action.suggested_channel ? ` on ${action.suggested_channel}` : "";
  const format = action.suggested_format || "a concrete execution";
  if (action.kind === "friction_removal") {
    return `Show the fix as ${format}${channel}: what changed, where users find it, and how success will be measured.`;
  }
  if (action.kind === "experiment") {
    return `Run ${format}${channel} as a controlled test with a clear audience, timing and success threshold.`;
  }
  return `Turn this into ${format}${channel}, then connect the execution back to the finding IDs listed below.`;
}

function dedupeKnowledgeSources(sources: NonNullable<ReturnType<typeof adaptTbSignalPayload>["knowledgeImpact"]>["sources_used"]) {
  const seen = new Map<string, (typeof sources)[number]>();
  for (const source of sources) {
    const key = `${source.original_file_name ?? source.title}:${source.source_kind}`;
    if (!seen.has(key)) seen.set(key, source);
  }
  return Array.from(seen.values());
}

function buildKnowledgeSourceTypes(
  sources: NonNullable<ReturnType<typeof adaptTbSignalPayload>["knowledgeImpact"]>["sources_used"],
  briefCount: number,
  fileCount: number
) {
  const haystack = sources
    .map((source) => `${source.source_kind} ${source.title} ${source.original_file_name ?? ""} ${source.summary}`)
    .join(" ")
    .toLowerCase();
  const has = (needle: string) => haystack.includes(needle);
  const tokens: Array<{ value: string; label: string; count?: number }> = [];
  const add = (value: string, label: string, count?: number) => tokens.push({ value, label, count });

  if (has("tiktok") || fileCount > 0) add("tiktok", "TikTok");
  add("x", "X");
  add("instagram", "Instagram");
  if (has("reddit")) add("reddit", "Reddit");
  add("csv", "CSV", fileCount);
  add("comment", "Comments");
  if (has("youtube")) add("youtube", "YouTube");
  if (has("facebook")) add("facebook", "Facebook");
  if (has("brief") || briefCount > 0) add("post", "Brief input", briefCount);

  const unique = new Map<string, { value: string; label: string; count?: number }>();
  for (const token of tokens) {
    if (!unique.has(token.value)) unique.set(token.value, token);
  }
  return Array.from(unique.values());
}

function dedupeEmergingPatterns(patterns: EmergingPattern[]) {
  const seen = new Map<string, EmergingPattern>();
  for (const pattern of patterns) {
    const key = normalizePatternKey(pattern);
    const current = seen.get(key);
    if (!current || pattern.evidence_count > current.evidence_count) {
      seen.set(key, pattern);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.evidence_count - a.evidence_count);
}

function normalizePatternKey(pattern: EmergingPattern) {
  const title = pattern.title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3 && !["pattern", "cluster", "senal", "signals", "emerging"].includes(token))
    .slice(0, 5)
    .join("-");
  return `${pattern.pattern_type}:${title || pattern.pattern_id}`;
}

function friendlyBoundary(value: string) {
  return value
    .replace("El reporte publica una muestra de evidencia vinculada a hallazgos; no expone el corpus completo.", "El reporte muestra evidencia seleccionada por finding; el corpus completo permanece protegido.")
    .replace("Las recomendaciones deben leerse junto con su nivel de confianza y evidencia disponible.", "Cada recomendación debe leerse con su confianza, volumen de evidencia y contexto del corte.")
    .replace("Este corte tuvo observaciones metodológicas internas; Noisia las considera antes de presentar conclusiones finales.", "Algunos hallazgos requieren lectura cuidadosa; se presentan como dirección de decisión, no como afirmación absoluta.")
    .replace("La lectura competitiva requiere corpus de marca, competencia e industria atribuido; si falta, se muestra como pendiente.", "La inteligencia competitiva sólo se activa cuando hay data competitiva atribuida y suficiente.");
}

function friendlyLimitation(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const label = prettifyKey(key)
    .replace("Sample", "Muestra")
    .replace("Coverage", "Cobertura")
    .replace("Competitive", "Competencia");
  const text = String(value)
    .replace(/quality gates?/gi, "validaciones metodológicas")
    .replace(/failed/gi, "pendientes")
    .replace(/internal/gi, "metodológico");
  return `${label}: ${text}`;
}

function summarizeLayerTension(items: JsonRecord[], scatter: JsonRecord[]) {
  const layers = ["psicologico", "personal", "social", "cultural"];
  const scatterByLayer = new Map<string, JsonRecord[]>();
  for (const point of scatter) {
    const layer = stringValue(point.layer);
    if (!scatterByLayer.has(layer)) scatterByLayer.set(layer, []);
    scatterByLayer.get(layer)?.push(point);
  }
  const maxCount = Math.max(1, ...layers.map((layer) => items.filter((item) => stringValue(item.layer) === layer).length));
  return layers.map((layer) => {
    const count = items.filter((item) => stringValue(item.layer) === layer).length;
    const layerScatter = scatterByLayer.get(layer) ?? [];
    const avgScore = layerScatter.length > 0
      ? layerScatter.reduce((sum, item) => sum + Number(item.score ?? 0), 0) / layerScatter.length
      : count;
    return {
      layer,
      label: prettifyKey(layer),
      count,
      force: Math.max(8, Math.round((count / maxCount) * 100)),
      confidence: avgScore >= 4 ? "alta" : avgScore >= 2 ? "media" : "direccional",
    };
  });
}

function fmtCompact(value: number): string {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0);
}

function groupRows<T>(rows: T[], keyFn: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row) || "signal";
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return Array.from(grouped.entries());
}

function formatSignedPct(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const pct = Math.round(value * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function normalizeConfidence(value: unknown): "alta" | "media" | "baja" {
  const s = String(value ?? "").toLowerCase();
  if (s.startsWith("alt")) return "alta";
  if (s.startsWith("baj")) return "baja";
  return "media";
}

function prettifyKey(key: unknown): string {
  return String(key ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function engineModuleKeyFor(slugOrKind: string | null): SignalModuleKey | null {
  const normalized = String(slugOrKind ?? "").replace(/_/g, "-");
  const map: Record<string, SignalModuleKey> = {
    "competitive-wave": "competitive_wave",
    "narrative-ownership": "narrative_ownership",
    "value-perception-matrix": "value_perception",
    "brand-positioning-map": "brand_positioning",
    "category-opportunity-map": "category_opportunity",
    "white-space-analysis": "white_space",
    "journey-friction-mapping": "journey_friction",
    "decision-velocity": "decision_velocity",
    "cultural-codes-decoding": "cultural_codes",
    "sentiment-advocacy-proxy": "advocacy_proxy",
    "audience-segment-lens": "audience_segment",
    "influence-architecture": "influence_architecture",
    "trust-risk-benchmark": "trust_risk",
    "evidence-confidence-layer": "evidence_confidence"
  };
  return map[normalized] ?? null;
}

function engineSectionKey(block: EngineMethodologyBlock): string {
  const slug = String(block.methodology_slug || block.kind || "methodology").replace(/_/g, "-");
  return `engine-${slug}`;
}

function engineDisplayLabel(block: EngineMethodologyBlock): string {
  const slug = String(block.methodology_slug || block.kind || "");
  const labels: Record<string, string> = {
    "competitive-wave": "Competitive Wave",
    "narrative-ownership": "Narrative Ownership",
    "value-perception-matrix": "VPM",
    "brand-positioning-map": "Brand Positioning",
    "category-opportunity-map": "Category Opportunity",
    "white-space-analysis": "White Space",
    "journey-friction-mapping": "JFM",
    "decision-velocity": "Decision Velocity",
    "cultural-codes-decoding": "Cultural Codes",
    "sentiment-advocacy-proxy": "Sentiment / Advocacy",
    "audience-segment-lens": "Audience Segment",
    "influence-architecture": "Influence Architecture",
    "trust-risk-benchmark": "Trust & Risk",
    "evidence-confidence-layer": "Evidence Confidence"
  };
  return labels[slug.replace(/_/g, "-")] ?? block.title ?? prettifyKey(slug || "Methodology");
}

function mergeEngineBlocks(blocks: EngineMethodologyBlock[]): EngineMethodologyBlock[] {
  const bySlug = new Map<string, EngineMethodologyBlock>();
  for (const block of blocks) {
    const slug = String(block.methodology_slug || block.kind || "").replace(/_/g, "-");
    if (!slug || bySlug.has(slug)) continue;
    bySlug.set(slug, block);
  }
  const priority = [
    "competitive-wave",
    "narrative-ownership",
    "value-perception-matrix",
    "brand-positioning-map",
    "category-opportunity-map",
    "white-space-analysis",
    "trust-risk-benchmark",
    "sentiment-advocacy-proxy",
    "journey-friction-mapping",
    "decision-velocity",
    "cultural-codes-decoding",
    "audience-segment-lens",
    "influence-architecture",
    "evidence-confidence-layer"
  ];
  return Array.from(bySlug.values()).sort((a, b) => {
    const aIndex = priority.indexOf(String(a.methodology_slug || a.kind || "").replace(/_/g, "-"));
    const bIndex = priority.indexOf(String(b.methodology_slug || b.kind || "").replace(/_/g, "-"));
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });
}

async function getLiveEngineBlocks(studyCorpusId: string): Promise<EngineMethodologyBlock[]> {
  try {
    const result = await pool.query<{
      methodology_slug: string;
      meta_json: JsonRecord | null;
    }>(
      `
        SELECT DISTINCT ON (methodology_slug)
          methodology_slug,
          meta_json
        FROM engine_analyses ea
        WHERE ea.study_corpus_id = $1
          AND status IN ('needs_review', 'approved')
          AND meta_json ? 'engine_block'
          AND COALESCE(meta_json->'engine_coding'->>'fixture', 'false') <> 'true'
          AND NOT EXISTS (
            SELECT 1
            FROM engine_cost_events ece
            WHERE ece.engine_analysis_id = ea.id
              AND ece.provider = 'fixture'
          )
        ORDER BY methodology_slug, created_at DESC
      `,
      [studyCorpusId]
    );

    return result.rows.flatMap((row) => {
      if (!isLiveEngineBlockSignalReady(row.meta_json)) return [];
      const block = normalizeEngineMethodologyBlock(asRecord(row.meta_json).engine_block);
      return block ? [block as unknown as EngineMethodologyBlock] : [];
    });
  } catch (error) {
    if (isMissingEngineLiveDataError(error)) return [];
    throw error;
  }
}

async function getComposerRenderSelection(outputId: string): Promise<ComposerRenderSelection | null> {
  try {
    const result = await pool.query<{
      selection: JsonRecord | null;
      draft: JsonRecord | null;
    }>(
      `
        SELECT selection, draft
        FROM signal_composer_edits
        WHERE output_id = $1
        LIMIT 1
      `,
      [outputId]
    );
    const selection = asRecord(result.rows[0]?.selection);
    const draft = asRecord(result.rows[0]?.draft);
    if (Object.keys(selection).length === 0 && Object.keys(draft).length === 0) return null;
    const selectionHasSignals = Object.prototype.hasOwnProperty.call(selection, "canonicalSignalIds");
    const draftHasSignals = Object.prototype.hasOwnProperty.call(draft, "selected_canonical_signal_ids");
    const canonicalSignalIds = selectionHasSignals
      ? arrayValue(selection.canonicalSignalIds).map(stringValue).filter(Boolean)
      : arrayValue(draft.selected_canonical_signal_ids).map(stringValue).filter(Boolean);
    const signalFindingKeys = await loadComposerSignalFindingKeys(canonicalSignalIds);
    return {
      active: true,
      chartKeys: arrayValue(selection.chartKeys).map(stringValue).filter(Boolean),
      canonicalSignalIds,
      signalFilteringActive: selectionHasSignals || draftHasSignals,
      signalFindingKeys,
      modules: arrayValue(selection.modules).map(stringValue).filter(Boolean)
    };
  } catch (error) {
    if (isMissingEngineLiveDataError(error)) return null;
    throw error;
  }
}

async function loadComposerSignalFindingKeys(canonicalSignalIds: string[]): Promise<string[]> {
  if (canonicalSignalIds.length === 0) return [];
  const result = await pool.query<{ finding_key: string | null }>(
    `
      SELECT DISTINCT COALESCE(
        dimensions->>'finding_key',
        semantic_key,
        id::text
      ) AS finding_key
      FROM canonical_signals
      WHERE id::text = ANY($1::text[])
    `,
    [canonicalSignalIds]
  );
  return result.rows.map((row) => stringValue(row.finding_key)).filter(Boolean);
}

function isLiveEngineBlockSignalReady(metaJson: unknown) {
  // Delegate to the canonical publish guard so the rendered Signal stays in
  // lockstep with /api publish checks. This also blocks directional/insufficient
  // engine blocks (readiness.status !== "beta_ready") that the previous local
  // check let through, so a thin/directional lens no longer renders client-ready.
  return validateEnginePublishReadiness(metaJson).ok;
}

function isMissingEngineLiveDataError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : null;
  return code === "42P01" || code === "42703";
}

function fmtDateRange(start: unknown, end: unknown, locale = "es-MX"): string {
  const s = String(start ?? "");
  const e = String(end ?? "");
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "2-digit" };
  const fmt = (d: string) => (d ? new Date(d).toLocaleDateString(locale, opts) : "");
  return [fmt(s), fmt(e)].filter(Boolean).join(" → ");
}

function toDateInput(value: unknown) {
  const raw = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

async function getLiveCorpusBounds(scopedCorpusIds: string[]) {
  if (scopedCorpusIds.length === 0) return null;
  try {
    const result = await pool.query<{
      window_start: string | null;
      window_end: string | null;
      total_mentions: number;
    }>(
      `
        SELECT
          min(m.published_at)::date::text AS window_start,
          max(m.published_at)::date::text AS window_end,
          count(*)::int AS total_mentions
        FROM mentions m
        WHERE m.study_corpus_id = ANY($1::uuid[])
          AND COALESCE(m.inclusion_status, 'included') <> 'excluded'
      `,
      [scopedCorpusIds]
    );
    const row = result.rows[0];
    const start = toDateInput(row?.window_start);
    const end = toDateInput(row?.window_end);
    if (!start || !end) return null;
    return {
      end,
      months: countMonthsInclusive(start, end),
      start,
      totalMentions: Number(row?.total_mentions ?? 0)
    };
  } catch {
    return null;
  }
}

function countMonthsInclusive(start: string, end: string) {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.max(1, (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1);
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function findingAnchor(findingId: string) {
  return `finding-${findingId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function buildSignalShellGroups(
  moduleEnabled: (key: SignalModuleKey) => boolean,
  engineBlocks: EngineMethodologyBlock[] = [],
  canManageLiveCorpus = false,
  strictRelational = false
): SignalShellGroup[] {
  const groups: SignalShellGroup[] = [
    {
      label: "Live Report",
      sections: [
        moduleEnabled("overview") ? { key: "overview", label: "Overview", icon: "platform" } : null,
        moduleEnabled("corpus_view")
          ? { key: "corpus-view", label: strictRelational ? "Published Corpus" : "Live Corpus", icon: "message" }
          : null,
        moduleEnabled("overview") ? { key: "signal-history", label: "Signal History", icon: "clock" } : null,
        moduleEnabled("live_composer") ? { key: "live-composer", label: "Composer", icon: "layers" } : null
      ].filter(Boolean) as SignalShellGroup["sections"]
    },
    {
      label: "T&B Detail",
      sections: [
        moduleEnabled("tb_decision_field") ? { key: "tb-decision-field", label: "Decision Field" } : null,
        moduleEnabled("opportunities") ? { key: "tb-opportunities", label: "Opportunities" } : null,
        moduleEnabled("competitive_intelligence") ? { key: "competitive", label: "Competitive Intelligence" } : null,
        moduleEnabled("tb_comparative_dashboard") ? { key: "tb-comparative-dashboard", label: "T&B Comparative" } : null,
        moduleEnabled("competitive_tb_matrix") ? { key: "competitive-tb-matrix", label: "Competitive T&B Matrix" } : null,
        moduleEnabled("action_studio") ? { key: "tb-action-studio", label: "Action Studio" } : null,
        moduleEnabled("evidence") ? { key: "finding-detail", label: "Evidence" } : null
      ].filter(Boolean) as SignalShellGroup["sections"]
    },
    {
      label: "Methodology Lenses",
      sections: engineBlocks.map((block) => ({
        key: engineSectionKey(block),
        label: engineDisplayLabel(block),
        icon: "sparkle"
      }))
    },
    {
      label: "Emerging Patterns",
      sections: [
        moduleEnabled("emerging_patterns") ? { key: "emerging-patterns", label: "Source Patterns", icon: "wave" } : null
      ].filter(Boolean) as SignalShellGroup["sections"]
    },
    {
      label: "Corpus Tools",
      sections: [
        moduleEnabled("corpus_chat") ? { key: "corpus-chat", label: "Corpus Chat", icon: "message" } : null
      ].filter(Boolean) as SignalShellGroup["sections"]
    },
    {
      label: "Quality",
      sections: [
        moduleEnabled("quality_boundaries") ? { key: "quality-boundaries", label: "Boundaries", icon: "info" } : null
      ].filter(Boolean) as SignalShellGroup["sections"]
    },
    {
      label: "Settings",
      sections: [
        canManageLiveCorpus ? { key: "monthly-data", label: "Add Data", icon: "upload" } : null,
        { key: "settings", label: "Settings", icon: "info" }
      ].filter(Boolean) as SignalShellGroup["sections"]
    }
  ];

  return groups.filter((group) => group.sections.length > 0);
}

const legacySignalModuleAliases: Record<SignalModuleKey, string[]> = {
  overview: ["overview"],
  live_composer: ["overview"],
  engine_methodology: ["engine_methodology"],
  competitive_wave: ["engine_methodology"],
  narrative_ownership: ["engine_methodology"],
  value_perception: ["engine_methodology"],
  brand_positioning: ["engine_methodology"],
  category_opportunity: ["engine_methodology"],
  white_space: ["engine_methodology"],
  journey_friction: ["engine_methodology"],
  decision_velocity: ["engine_methodology"],
  cultural_codes: ["engine_methodology"],
  advocacy_proxy: ["engine_methodology"],
  audience_segment: ["engine_methodology"],
  influence_architecture: ["engine_methodology"],
  trust_risk: ["engine_methodology"],
  evidence_confidence: ["engine_methodology"],
  tb_decision_field: ["tension_map"],
  opportunities: ["overview", "barriers", "triggers"],
  competitive_intelligence: ["compare"],
  tb_comparative_dashboard: ["compare"],
  competitive_tb_matrix: ["compare"],
  action_studio: ["actions"],
  evidence: ["verbatims"],
  quality_boundaries: [],
  emerging_patterns: [],
  corpus_view: ["verbatims"],
  corpus_chat: ["chat"]
};

function isSignalModuleEnabled(manifest: JsonRecord, key: SignalModuleKey, hasV2Manifest: boolean) {
  if (hasV2Manifest) return manifest[key] !== false;
  const aliases = legacySignalModuleAliases[key];
  const legacyKey = aliases.find((alias) => Object.prototype.hasOwnProperty.call(manifest, alias));
  return legacyKey ? manifest[legacyKey] !== false : defaultSignalManifest[key];
}

function legacyModuleEnabled(manifest: JsonRecord, key: string) {
  return manifest[key] !== false;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
