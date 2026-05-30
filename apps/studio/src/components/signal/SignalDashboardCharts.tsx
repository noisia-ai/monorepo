"use client";

import { Component, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import {
  Activity,
  BarChart2,
  Grid,
  MessageCircle,
  TrendingUp,
} from "react-feather";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useSignalUiLanguage, type SignalUiLanguage } from "@/components/signal/SignalReportShell";

type ChartRecord = Record<string, unknown>;

type SignalDashboardChartsProps = {
  brandLabel: string;
  methodologyName: string;
  windowLabel: string;
  corpusTotal: number;
  metrics: {
    findingsTotal: number;
    barriersTotal: number;
    triggersTotal: number;
    movableTotal: number;
  };
  polarityDist: ChartRecord[];
  layerDist: ChartRecord[];
  mobilityDist: ChartRecord[];
  platformDist: ChartRecord[];
  contentTypeDist?: ChartRecord[];
  volumeTimeline: ChartRecord[];
  findingTimeSeries: ChartRecord[];
  polarityTimeSeries: ChartRecord[];
  findingsScatter: ChartRecord[];
  topVoice: ChartRecord[];
  topBarriers: ChartRecord[];
};

type SignalChartBoundaryState = {
  hasError: boolean;
};

const COLORS = {
  ink: "#25262a",
  quiet: "#8d9094",
  grid: "rgba(37, 38, 42, 0.08)",
  signal: "#00a9b3",
  signalDark: "#006a70",
  tension: "#d91441",
  inkSoft: "#575a60",
  tealSoft: "#82bdc2",
  soft: "#e9eff0",
};

const layerColors: Record<string, string> = {
  psicologico: COLORS.tension,
  personal: COLORS.signalDark,
  social: COLORS.signal,
  cultural: COLORS.ink,
};

const mobilityColors: Record<string, string> = {
  movible_por_marca: COLORS.signalDark,
  parcialmente_movible: COLORS.signal,
  estructural: COLORS.ink,
};

const chartCopy = {
  en: {
    unavailable: "Dashboard temporarily unavailable",
    unavailableBody: "The report is still loaded; a visualization failed in the browser.",
    unavailableHint: "Refresh and try again. If it persists, the team can inspect the console without blocking the rest of Signal.",
    contextAria: "Analysis context",
    publishedMentions: "published mentions",
    cutSummary: "Published cut summary",
    mentions: "Mentions",
    periodCorpus: "Period corpus",
    findings: "Findings",
    clientSafeFindings: "Client-safe findings",
    triggersOfFindings: "of findings",
    opportunities: "Opportunities",
    movableByBrand: "movable by brand",
    confidence: "Confidence",
    signalsOverTime: "Signals over time",
    temporalFilter: "Date filter",
    from: "From",
    to: "To",
    clear: "Clear",
    mentionsInRange: "mentions in range",
    findingsWithActivity: "findings with activity",
    composition: "Composition",
    layers: "Layers",
    tensionLives: "Where tension lives",
    mobility: "Mobility",
    brandCanAct: "What the brand can act on",
    evidence: "Evidence",
    realChannelVsContent: "Real channel vs content type",
    channelReality: "Real channel distribution",
    contentFormatMix: "Content type distribution",
    traceability: "Traceability",
    findingsMostEvidence: "Findings with most evidence",
    noComposition: "No composition published",
    polarityComposition: "Polarity composition",
    noMobility: "No mobility coded",
    findingsUnit: "findings",
    noSourceDistribution: "No source distribution published",
    realChannels: "Real channels",
    contentTypes: "Content types",
    notPublished: "Not published",
    noFindingEvidence: "No aggregate evidence by finding",
    data: "Data",
    value: "Value",
    noData: "No data",
    month: "Month",
    mentionsInCut: "mentions in the cut",
    averageIntensity: "Average intensity",
    traceableQuotes: "traceable quotes",
    high: "High",
    medium: "Medium",
    bounded: "Bounded",
    broadCorpus: "Broad corpus + traceable evidence",
    sufficientRead: "Sufficient reading with boundaries",
    reviewLimits: "Review boundaries before deciding",
    frictionDominates: "Friction dominates",
    impulseDominates: "Momentum dominates",
    balanced: "Momentum and friction are balanced",
    frictionBody: "This is not just negative perception: it shows where the decision gets blocked and what the brand can move.",
    impulseBody: "Motivators carry more weight than barriers; the focus is converting those signals into repeatable actions.",
    balancedBody: "Triggers and barriers carry similar weight; the decision depends on what is movable and what is structural.",
    mixed: "Mixed",
    irrelevant: "Irrelevant",
    movable: "Movable",
    partial: "Partial",
    structural: "Structural",
    unknown: "Unknown",
    signal: "signal",
  },
  es: {
    unavailable: "Dashboard temporalmente no disponible",
    unavailableBody: "El reporte sigue cargado; una visualización falló en el navegador.",
    unavailableHint: "Reintenta con refresh. Si persiste, el equipo puede revisar la consola sin bloquear el resto del Signal.",
    contextAria: "Contexto del análisis",
    publishedMentions: "menciones publicadas",
    cutSummary: "Resumen del corte",
    mentions: "Menciones",
    periodCorpus: "Corpus del periodo",
    findings: "Findings",
    clientSafeFindings: "Hallazgos client-safe",
    triggersOfFindings: "de hallazgos",
    opportunities: "Oportunidades",
    movableByBrand: "movibles por marca",
    confidence: "Confianza",
    signalsOverTime: "Señales en el tiempo",
    temporalFilter: "Filtro temporal",
    from: "Desde",
    to: "Hasta",
    clear: "Limpiar",
    mentionsInRange: "menciones en rango",
    findingsWithActivity: "findings con actividad",
    composition: "Composición",
    layers: "Capas",
    tensionLives: "Dónde vive la tensión",
    mobility: "Movilidad",
    brandCanAct: "Qué puede accionar la marca",
    evidence: "Evidencia",
    realChannelVsContent: "Canal real vs tipo de contenido",
    channelReality: "Distribución por canal real",
    contentFormatMix: "Distribución por tipo de contenido",
    traceability: "Trazabilidad",
    findingsMostEvidence: "Findings con más evidencia",
    noComposition: "Sin composición publicada",
    polarityComposition: "Composición de polaridad",
    noMobility: "Sin movilidad codificada",
    findingsUnit: "hallazgos",
    noSourceDistribution: "Sin distribución de fuentes publicada",
    realChannels: "Canales reales",
    contentTypes: "Tipos de contenido",
    notPublished: "No publicado",
    noFindingEvidence: "Sin evidencia agregada por finding",
    data: "Dato",
    value: "Valor",
    noData: "Sin datos",
    month: "Mes",
    mentionsInCut: "menciones en el corte",
    averageIntensity: "Intensidad promedio",
    traceableQuotes: "citas trazables",
    high: "Alta",
    medium: "Media",
    bounded: "Acotada",
    broadCorpus: "Corpus amplio + evidencia trazable",
    sufficientRead: "Lectura suficiente con límites",
    reviewLimits: "Revisar límites antes de decidir",
    frictionDominates: "Predomina la fricción",
    impulseDominates: "Predomina el impulso",
    balanced: "Impulso y fricción balanceados",
    frictionBody: "La lectura no se resume como percepción negativa: muestra dónde la decisión se bloquea y qué parte puede mover la marca.",
    impulseBody: "Los motivadores aparecen con más peso que las barreras; el foco es convertir esas señales en acciones repetibles.",
    balancedBody: "Triggers y barriers tienen peso similar; la decisión depende de qué señales sean movibles y cuáles son estructurales.",
    mixed: "Mixtos",
    irrelevant: "Irrelevantes",
    movable: "Movible",
    partial: "Parcial",
    structural: "Estructural",
    unknown: "Unknown",
    signal: "señal",
  },
} satisfies Record<SignalUiLanguage, Record<string, string>>;

export function SignalDashboardCharts(props: SignalDashboardChartsProps) {
  return (
    <SignalChartBoundary>
      <SignalDashboardChartsInner {...props} />
    </SignalChartBoundary>
  );
}

class SignalChartBoundary extends Component<{ children: ReactNode }, SignalChartBoundaryState> {
  state: SignalChartBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SignalChartBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[signal-dashboard] chart render failed", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="signal-dashboard" id="overview">
          <SignalChartFallback />
        </section>
      );
    }

    return this.props.children;
  }
}

function SignalChartFallback() {
  const { uiLanguage } = useSignalUiLanguage();
  const copy = chartCopy[uiLanguage];
  return (
    <div className="signal-chart-fallback">
      <span>{copy.unavailable}</span>
      <strong>{copy.unavailableBody}</strong>
      <p>{copy.unavailableHint}</p>
    </div>
  );
}

function SignalDashboardChartsInner({
  brandLabel,
  methodologyName,
  windowLabel,
  corpusTotal,
  metrics,
  polarityDist,
  layerDist,
  mobilityDist,
  platformDist,
  contentTypeDist = [],
  volumeTimeline,
  findingTimeSeries,
  polarityTimeSeries,
  topVoice,
  topBarriers,
}: SignalDashboardChartsProps) {
  const { uiLanguage } = useSignalUiLanguage();
  const copy = chartCopy[uiLanguage];
  const polarityTimeline = normalizePolarityTimeline(polarityTimeSeries);
  const allTimeline = mergeTimelinePolarity(normalizeTimeline(volumeTimeline, uiLanguage), polarityTimeline);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const timeline = filterTimelineByDate(allTimeline, dateFrom, dateTo);
  const filteredPolarityTimeline = filterPolarityTimelineByDate(polarityTimeline, dateFrom, dateTo);
  const filteredFindingSeries = filterFindingSeriesByDate(normalizeFindingTimeSeries(findingTimeSeries), dateFrom, dateTo);
  const layers = normalizeLayerData(layerDist, uiLanguage);
  const mobility = normalizeMobilityData(mobilityDist, uiLanguage);
  const platforms = normalizePlatformData(platformDist);
  const contentTypes = normalizeContentTypeData(contentTypeDist);
  const voice = normalizeVoiceData(topVoice, uiLanguage);
  const polarity = normalizePolarityData(polarityDist, uiLanguage);
  const triggerPct = Math.round((metrics.triggersTotal / Math.max(1, metrics.findingsTotal)) * 100);
  const barrierPct = Math.round((metrics.barriersTotal / Math.max(1, metrics.findingsTotal)) * 100);
  const movablePct = Math.round((metrics.movableTotal / Math.max(1, metrics.findingsTotal)) * 100);
  const markers = buildTimelineMarkers(timeline, [...topBarriers, ...topVoice].slice(0, 4), uiLanguage);
  const filteredMentionTotal = timeline.reduce((sum, row) => sum + row.mentions, 0);
  const topTemporalFindings = buildTopTemporalFindings(filteredFindingSeries);
  const confidence = buildConfidenceLabel(corpusTotal, metrics.findingsTotal, voice.length, uiLanguage);
  const balance = buildSignalBalance(metrics.triggersTotal, metrics.barriersTotal, uiLanguage);

  return (
    <section className="signal-dashboard signal-dashboard--redesign" id="overview">
      <div className="signal-dashboard-context">
        <span>{methodologyName}</span>
        <strong>{brandLabel}</strong>
      </div>

      <div className="signal-context-strip" aria-label={copy.contextAria}>
        <span>{methodologyName}</span>
        <strong>{brandLabel}</strong>
        <span>{windowLabel}</span>
        <span>{formatNumber(corpusTotal)} {copy.publishedMentions}</span>
      </div>

      <div className="signal-kpi-row signal-kpi-row--six" aria-label={copy.cutSummary}>
        <KpiCard
          label={copy.mentions}
          value={formatNumber(corpusTotal)}
          sub={copy.periodCorpus}
          icon={<Grid size={15} />}
        />
        <KpiCard
          label={copy.findings}
          value={formatNumber(metrics.findingsTotal)}
          sub={copy.clientSafeFindings}
          icon={<Activity size={15} />}
        />
        <KpiCard
          label="Triggers"
          value={formatNumber(metrics.triggersTotal)}
          sub={`${triggerPct}% ${copy.triggersOfFindings}`}
          radialValue={triggerPct}
          icon={<TrendingUp size={15} />}
          radialTone="signal"
        />
        <KpiCard
          label="Barriers"
          value={formatNumber(metrics.barriersTotal)}
          sub={`${barrierPct}% ${copy.triggersOfFindings}`}
          radialValue={barrierPct}
          icon={<BarChart2 size={15} />}
          radialTone="tension"
        />
        <KpiCard
          label={copy.opportunities}
          value={formatNumber(metrics.movableTotal)}
          sub={`${movablePct}% ${copy.movableByBrand}`}
          radialValue={movablePct}
          icon={<MessageCircle size={15} />}
          radialTone="signal"
        />
        <KpiCard
          label={copy.confidence}
          value={confidence.value}
          sub={confidence.sub}
          icon={<Activity size={15} />}
          tone={confidence.tone}
        />
      </div>

      <div className="signal-hero-chart-card signal-hero-chart-card--compact">
        <div className="signal-hero-chart-head">
          <div>
            <span>{copy.signalsOverTime}</span>
            <strong>{windowLabel}</strong>
          </div>
          <div className="signal-date-filter" aria-label={copy.temporalFilter}>
            <label>
              {copy.from}
              <input type="month" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label>
              {copy.to}
              <input type="month" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
            {(dateFrom || dateTo) && (
              <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                {copy.clear}
              </button>
            )}
          </div>
        </div>
        <div className="signal-temporal-summary">
          <span>{formatNumber(filteredMentionTotal)} {copy.mentionsInRange}</span>
          <span>{topTemporalFindings.length} {copy.findingsWithActivity}</span>
          <span>{filteredPolarityTimeline.reduce((sum, row) => sum + row.trigger, 0)} triggers · {filteredPolarityTimeline.reduce((sum, row) => sum + row.barrier, 0)} barriers</span>
        </div>
        <div className="signal-hero-chart signal-recharts-frame">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline} margin={{ top: 14, right: 18, bottom: 10, left: 0 }}>
              <defs>
                <linearGradient id="signalVolumeFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.signal} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={COLORS.signal} stopOpacity={0.02} />
                </linearGradient>
                <pattern id="signalHatch" width="8" height="8" patternTransform="rotate(135)" patternUnits="userSpaceOnUse">
                  <line x1="0" x2="0" y1="0" y2="8" stroke="rgba(37,38,42,0.28)" strokeWidth="2" />
                </pattern>
              </defs>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 8" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                minTickGap={28}
                tick={{ fill: COLORS.quiet, fontSize: 12 }}
                tickLine={false}
              />
              <YAxis hide domain={[0, "dataMax + 10"]} />
              <Tooltip content={<SignalTooltip />} cursor={{ stroke: "rgba(37,38,42,0.18)", strokeWidth: 1 }} />
              <Area
                activeDot={{ r: 6, fill: COLORS.ink, stroke: "#fff", strokeWidth: 3 }}
                dataKey="mentions"
                dot={{ r: 4, fill: COLORS.ink, stroke: "#fff", strokeWidth: 2 }}
                fill="url(#signalVolumeFill)"
                fillOpacity={1}
                name={copy.mentions}
                stroke={COLORS.ink}
                strokeWidth={2}
                type="monotone"
              />
              <Area
                dataKey="barriers"
                fill="rgba(217,20,65,0.08)"
                name="Barriers T&B"
                stroke={COLORS.tension}
                strokeDasharray="5 5"
                strokeWidth={1.5}
                type="monotone"
              />
              <Area
                dataKey="triggers"
                fill="rgba(0,169,179,0.08)"
                name="Triggers T&B"
                stroke={COLORS.signalDark}
                strokeDasharray="3 6"
                strokeWidth={1.5}
                type="monotone"
              />
              {markers.map((marker) => (
                <ReferenceDot
                  fill={marker.tone === "trigger" ? COLORS.signalDark : COLORS.tension}
                  ifOverflow="extendDomain"
                  key={`${marker.label}-${marker.x}`}
                  r={5}
                  stroke="#fff"
                  strokeWidth={3}
                  x={marker.x}
                  y={marker.y}
                  label={{
                    value: marker.label,
                    position: "top",
                    fill: COLORS.ink,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {topTemporalFindings.length > 0 && (
          <div className="signal-temporal-findings">
            {topTemporalFindings.slice(0, 4).map((finding) => (
              <span key={finding.findingId}>
                <i className={`signal-temporal-dot signal-temporal-dot--${finding.polarity}`} />
                {finding.name} · {formatNumber(finding.count)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="signal-overview-grid" id="snapshot">
        <ChartPanel eyebrow={copy.composition} title={balance.title} icon={<Activity size={15} />} span="third">
          <CompositionStack items={polarity} uiLanguage={uiLanguage} />
          <p className="signal-overview-note">{balance.body}</p>
        </ChartPanel>

        <ChartPanel eyebrow={copy.layers} title={copy.tensionLives} icon={<BarChart2 size={15} />} span="third">
          <div className="signal-recharts-frame signal-recharts-frame--md">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={layers} layout="vertical" margin={{ top: 6, right: 18, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={COLORS.grid} />
                  <XAxis axisLine={false} hide type="number" />
                  <YAxis
                    axisLine={false}
                    dataKey="label"
                    tick={{ fill: COLORS.quiet, fontSize: 12 }}
                    tickLine={false}
                    type="category"
                    width={96}
                  />
                  <Tooltip content={<SignalTooltip />} />
                  <Bar dataKey="count" name={copy.findings} radius={[0, 10, 10, 0]}>
                    {layers.map((entry) => <Cell fill={entry.color} key={entry.key} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
          </div>
        </ChartPanel>

        <ChartPanel eyebrow={copy.mobility} title={copy.brandCanAct} icon={<TrendingUp size={15} />} span="third">
          <MobilityList items={mobility} uiLanguage={uiLanguage} />
        </ChartPanel>

        <ChartPanel eyebrow={copy.evidence} title={copy.channelReality} icon={<Grid size={15} />} span="third">
          <EvidenceColumn title={copy.realChannels} items={platforms} color={COLORS.signalDark} uiLanguage={uiLanguage} />
        </ChartPanel>

        <ChartPanel eyebrow={copy.evidence} title={copy.contentFormatMix} icon={<BarChart2 size={15} />} span="third">
          <EvidenceColumn title={copy.contentTypes} items={contentTypes} color={COLORS.quiet} uiLanguage={uiLanguage} />
        </ChartPanel>

        <ChartPanel eyebrow={copy.traceability} title={copy.findingsMostEvidence} icon={<MessageCircle size={15} />} span="third">
          <EvidenceBars items={voice} uiLanguage={uiLanguage} />
        </ChartPanel>
      </div>
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  action,
  icon,
  radialValue,
  radialTone = "ink",
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  action?: string;
  icon?: React.ReactNode;
  radialValue?: number;
  radialTone?: "ink" | "signal" | "tension";
  tone?: "neutral" | "negative";
}) {
  const fill = radialTone === "signal" ? COLORS.signalDark : radialTone === "tension" ? COLORS.tension : COLORS.ink;
  const radialPct = Math.max(0, Math.min(100, radialValue ?? 0));
  return (
    <article className={`signal-kpi-card signal-kpi-card--${tone}`}>
      <header>
        <span>{label}</span>
        {icon ? <i aria-hidden>{icon}</i> : null}
      </header>
      <strong>{value}</strong>
      <footer>
        <span>{sub}</span>
        {action ? <button type="button">{action}</button> : null}
      </footer>
      {typeof radialValue === "number" ? (
        <div
          className="signal-kpi-radial"
          style={{
            background: `conic-gradient(${fill} ${radialPct * 3.6}deg, rgba(37,38,42,0.12) 0deg)`,
          }}
        >
          <span>{radialPct}%</span>
        </div>
      ) : null}
    </article>
  );
}

function ChartPanel({
  eyebrow,
  title,
  icon,
  span,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
  span: "third" | "half" | "wide" | "full";
  children: React.ReactNode;
}) {
  return (
    <article className={`signal-chart-panel signal-chart-panel--${span}`}>
      <header>
        <i aria-hidden>{icon}</i>
        <div>
          <span>{eyebrow}</span>
          <strong>{title}</strong>
        </div>
      </header>
      <div className="signal-chart-panel-body">{children}</div>
    </article>
  );
}

function CompositionStack({ items, uiLanguage }: { items: ReturnType<typeof normalizePolarityData>; uiLanguage: SignalUiLanguage }) {
  const copy = chartCopy[uiLanguage];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (total <= 0) {
    return <EmptyChartNote label={copy.noComposition} />;
  }
  return (
    <div className="signal-composition-stack">
      <div className="signal-stack-bar" aria-label={copy.polarityComposition}>
        {items.map((item) => {
          const width = Math.max(4, Math.round((item.count / total) * 100));
          return (
            <span
              key={item.key}
              style={{ "--stack-color": item.color, "--stack-width": `${width}%` } as CSSProperties}
              title={`${item.label}: ${formatNumber(item.count)}`}
            />
          );
        })}
      </div>
      <MiniLegend items={items.map((p) => ({ label: p.label, value: p.count, color: p.color }))} />
    </div>
  );
}

function MobilityList({ items, uiLanguage }: { items: ReturnType<typeof normalizeMobilityData>; uiLanguage: SignalUiLanguage }) {
  const copy = chartCopy[uiLanguage];
  if (items.length === 0) {
    return <EmptyChartNote label={copy.noMobility} />;
  }
  return (
    <div className="signal-mobility-list">
      {items.map((item) => (
        <div className="signal-mobility-row" key={item.key}>
          <div>
            <span>{item.label}</span>
            <strong>{formatNumber(item.count)} {copy.findingsUnit}</strong>
          </div>
          <div className="signal-progress-track" aria-hidden>
            <i style={{ "--progress-color": item.fill, "--progress-width": `${item.percent}%` } as CSSProperties} />
          </div>
          <em>{item.percent}%</em>
        </div>
      ))}
    </div>
  );
}

function EvidenceColumn({
  title,
  items,
  color,
  uiLanguage,
}: {
  title: string;
  items: Array<{ label: string; count: number }>;
  color: string;
  uiLanguage: SignalUiLanguage;
}) {
  const copy = chartCopy[uiLanguage];
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="signal-evidence-column">
      <span>{title}</span>
      {items.length > 0 ? (
        items.slice(0, 6).map((item) => (
          <div className="signal-evidence-row" key={`${title}-${item.label}`}>
            <strong>{item.label}</strong>
            <div className="signal-progress-track" aria-hidden>
              <i
                style={{
                  "--progress-color": color,
                  "--progress-width": `${Math.max(5, Math.round((item.count / max) * 100))}%`,
                } as CSSProperties}
              />
            </div>
            <em>{fmtCompact(item.count)}</em>
          </div>
        ))
      ) : (
        <small>{copy.notPublished}</small>
      )}
    </div>
  );
}

function EvidenceBars({ items, uiLanguage }: { items: ReturnType<typeof normalizeVoiceData>; uiLanguage: SignalUiLanguage }) {
  const copy = chartCopy[uiLanguage];
  if (items.length === 0) {
    return <EmptyChartNote label={copy.noFindingEvidence} />;
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="signal-evidence-bars">
      {items.slice(0, 7).map((item) => (
        <div className="signal-evidence-bar" key={item.code}>
          <span>{item.code}</span>
          <div className="signal-progress-track" aria-hidden>
            <i
              style={{
                "--progress-color": COLORS.tension,
                "--progress-width": `${Math.max(5, Math.round((item.count / max) * 100))}%`,
              } as CSSProperties}
            />
          </div>
          <strong>{formatNumber(item.count)}</strong>
        </div>
      ))}
    </div>
  );
}

function EmptyChartNote({ label }: { label: string }) {
  return <div className="signal-chart-empty-note">{label}</div>;
}

function SignalTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: unknown; payload?: ChartRecord; color?: string }>; label?: unknown }) {
  const { uiLanguage } = useSignalUiLanguage();
  const copy = chartCopy[uiLanguage];
  if (!active || !payload?.length) return null;
  const first = payload[0]?.payload;
  return (
    <div className="signal-chart-tooltip">
      <strong>{stringValue(first?.tooltipTitle) || stringValue(label) || stringValue(first?.label) || copy.data}</strong>
      {payload.slice(0, 3).map((item, index) => (
        <span key={`${item.name ?? "value"}-${index}`}>
          <i style={{ background: item.color ?? stringValue(first?.color) ?? COLORS.ink }} />
          {item.name ?? copy.value}: {formatNumber(Number(item.value ?? 0))}
        </span>
      ))}
      {stringValue(first?.hint) ? <em>{stringValue(first?.hint)}</em> : null}
    </div>
  );
}

function MiniLegend({ items }: { items: Array<{ label: string; value: number | string; color: string }> }) {
  return (
    <ul className="signal-mini-legend">
      {items.map((item) => (
        <li key={item.label}>
          <i style={{ background: item.color }} />
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </li>
      ))}
    </ul>
  );
}

function normalizeTimeline(rows: ChartRecord[], uiLanguage: SignalUiLanguage) {
  const copy = chartCopy[uiLanguage];
  const locale = uiLanguage === "en" ? "en-US" : "es-MX";
  if (rows.length === 0) return [{ month: "", label: copy.noData, mentions: 0, triggers: 0, barriers: 0, tooltipTitle: copy.noData, hint: copy.noData }];
  return rows.map((row) => {
    const rawMonth = stringValue(row.month);
    const date = rawMonth ? new Date(`${rawMonth}-01T00:00:00Z`) : null;
    const label = date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString(locale, { month: "short", year: "2-digit", timeZone: "UTC" })
      : rawMonth || copy.month;
    const mentions = Number(row.count ?? 0);
    return {
      month: rawMonth,
      label,
      mentions,
      triggers: 0,
      barriers: 0,
      tooltipTitle: label,
      hint: `${formatNumber(mentions)} ${copy.mentionsInCut}`,
    };
  });
}

function normalizePolarityTimeline(rows: ChartRecord[]) {
  return rows.map((row) => ({
    month: stringValue(row.month),
    trigger: Number(row.trigger ?? 0),
    barrier: Number(row.barrier ?? 0),
    mixed: Number(row.mixed ?? 0),
    total: Number(row.total ?? 0)
  })).filter((row) => row.month);
}

function mergeTimelinePolarity(
  timeline: ReturnType<typeof normalizeTimeline>,
  polarityTimeline: ReturnType<typeof normalizePolarityTimeline>
) {
  const byMonth = new Map(polarityTimeline.map((row) => [row.month, row]));
  return timeline.map((row) => {
    const polarity = byMonth.get(row.month);
    return {
      ...row,
      triggers: polarity?.trigger ?? 0,
      barriers: polarity?.barrier ?? 0
    };
  });
}

function normalizeFindingTimeSeries(rows: ChartRecord[]) {
  return rows.map((row) => ({
    month: stringValue(row.month),
    findingId: stringValue(row.finding_id),
    name: stringValue(row.finding_name),
    polarity: stringValue(row.polarity),
    layer: stringValue(row.layer),
    count: Number(row.count ?? 0)
  })).filter((row) => row.month && row.findingId && row.count > 0);
}

function filterTimelineByDate<T extends { month: string }>(rows: T[], dateFrom: string, dateTo: string) {
  return rows.filter((row) => inMonthRange(row.month, dateFrom, dateTo));
}

function filterPolarityTimelineByDate(rows: ReturnType<typeof normalizePolarityTimeline>, dateFrom: string, dateTo: string) {
  return filterTimelineByDate(rows, dateFrom, dateTo);
}

function filterFindingSeriesByDate(rows: ReturnType<typeof normalizeFindingTimeSeries>, dateFrom: string, dateTo: string) {
  return filterTimelineByDate(rows, dateFrom, dateTo);
}

function inMonthRange(month: string, dateFrom: string, dateTo: string) {
  if (!month) return false;
  if (dateFrom && month < dateFrom) return false;
  if (dateTo && month > dateTo) return false;
  return true;
}

function buildTopTemporalFindings(rows: ReturnType<typeof normalizeFindingTimeSeries>) {
  const byFinding = new Map<string, { findingId: string; name: string; polarity: string; count: number }>();
  for (const row of rows) {
    const current = byFinding.get(row.findingId) ?? {
      findingId: row.findingId,
      name: row.name || row.findingId,
      polarity: row.polarity,
      count: 0
    };
    current.count += row.count;
    byFinding.set(row.findingId, current);
  }
  return Array.from(byFinding.values()).sort((a, b) => b.count - a.count);
}

function normalizePolarityData(rows: ChartRecord[], uiLanguage: SignalUiLanguage) {
  const colorBy: Record<string, string> = {
    barrier: COLORS.tension,
    trigger: COLORS.signalDark,
    mixed: COLORS.inkSoft,
    irrelevant: COLORS.soft,
  };
  return rows.map((row) => {
    const key = stringValue(row.polarity) || "unknown";
    return {
      key,
      label: prettifyPolarity(key, uiLanguage),
      count: Number(row.count ?? 0),
      color: colorBy[key] ?? COLORS.quiet,
    };
  }).filter((row) => row.count > 0);
}

function normalizeLayerData(rows: ChartRecord[], uiLanguage: SignalUiLanguage) {
  const copy = chartCopy[uiLanguage];
  return rows.map((row) => {
    const key = stringValue(row.layer) || "sin capa";
    return {
      key,
      label: prettifyKey(key),
      count: Number(row.count ?? 0),
      intensity: Number(row.avg_intensity ?? 0),
      color: layerColors[key] ?? COLORS.quiet,
      tooltipTitle: prettifyKey(key),
      hint: `${copy.averageIntensity} ${Number(row.avg_intensity ?? 0).toFixed(1)}`,
    };
  }).filter((row) => row.count > 0);
}

function normalizeMobilityData(rows: ChartRecord[], uiLanguage: SignalUiLanguage) {
  const total = rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  return rows.map((row) => {
    const key = stringValue(row.movilidad) || "sin movilidad";
    const count = Number(row.count ?? 0);
    const percent = Math.round((count / Math.max(1, total)) * 100);
    return {
      key,
      label: mobilityLabel(key, uiLanguage),
      count,
      percent,
      fill: mobilityColors[key] ?? COLORS.quiet,
      tooltipTitle: mobilityLabel(key, uiLanguage),
      hint: `${count} ${chartCopy[uiLanguage].findingsUnit}`,
    };
  }).filter((row) => row.count > 0);
}

function normalizePlatformData(rows: ChartRecord[]) {
  return rows.slice(0, 7).map((row) => {
    const label = titleCaseToken(stringValue(row.platform) || "unknown");
    const count = Number(row.count ?? 0);
    return { label, count, tooltipTitle: label };
  }).filter((row) => row.count > 0);
}

function normalizeContentTypeData(rows: ChartRecord[]) {
  return rows.slice(0, 6).map((row) => {
    const label = titleCaseToken(stringValue(row.content_type) || stringValue(row.platform) || "unknown");
    const count = Number(row.count ?? 0);
    return { label, count };
  }).filter((row) => row.count > 0 && row.label !== "Unknown");
}

function titleCaseToken(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Unknown";
}

function normalizeVoiceData(rows: ChartRecord[], uiLanguage: SignalUiLanguage) {
  const copy = chartCopy[uiLanguage];
  return rows.slice(0, 8).map((row, index) => {
    const code = stringValue(row.finding_id) || `B-${index + 1}`;
    const count = Number(row.citation_count ?? 0);
    return {
      code,
      count,
      tooltipTitle: stringValue(row.nombre) || code,
      hint: `${count} ${copy.traceableQuotes}`,
    };
  }).filter((row) => row.count > 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX").format(Number.isFinite(value) ? value : 0);
}

function fmtCompact(value: number) {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0);
}

function buildTimelineMarkers(timeline: ReturnType<typeof normalizeTimeline>, records: ChartRecord[], uiLanguage: SignalUiLanguage) {
  const points = timeline
    .filter((point) => point.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 3);
  return points.map((point, index) => {
    const record = records[index] ?? records[0] ?? {};
    const label = truncateLabel(stringValue(record.label) || stringValue(record.nombre) || stringValue(record.finding_id) || chartCopy[uiLanguage].signal, 24);
    const id = stringValue(record.finding_id) || stringValue(record.id);
    return {
      x: point.label,
      y: point.mentions,
      label,
      tone: id.startsWith("T-") ? "trigger" : "barrier",
    };
  });
}

function buildConfidenceLabel(corpusTotal: number, findingsTotal: number, evidenceFindingCount: number, uiLanguage: SignalUiLanguage) {
  const copy = chartCopy[uiLanguage];
  if (corpusTotal >= 10000 && findingsTotal >= 8 && evidenceFindingCount >= 3) {
    return { value: copy.high, sub: copy.broadCorpus, tone: "neutral" as const };
  }
  if (corpusTotal >= 1500 && findingsTotal >= 5) {
    return { value: copy.medium, sub: copy.sufficientRead, tone: "neutral" as const };
  }
  return { value: copy.bounded, sub: copy.reviewLimits, tone: "negative" as const };
}

function buildSignalBalance(triggersTotal: number, barriersTotal: number, uiLanguage: SignalUiLanguage) {
  const copy = chartCopy[uiLanguage];
  if (barriersTotal > triggersTotal) {
    return {
      title: copy.frictionDominates,
      body: copy.frictionBody,
    };
  }
  if (triggersTotal > barriersTotal) {
    return {
      title: copy.impulseDominates,
      body: copy.impulseBody,
    };
  }
  return {
    title: copy.balanced,
    body: copy.balancedBody,
  };
}

function truncateLabel(text: string, max: number) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}...`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function prettifyKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettifyPolarity(p: string, uiLanguage: SignalUiLanguage): string {
  const copy = chartCopy[uiLanguage];
  if (p === "barrier") return "Barriers";
  if (p === "trigger") return "Triggers";
  if (p === "mixed") return copy.mixed;
  if (p === "irrelevant") return copy.irrelevant;
  return prettifyKey(p);
}

function mobilityLabel(key: string, uiLanguage: SignalUiLanguage) {
  const copy = chartCopy[uiLanguage];
  if (key === "movible_por_marca") return copy.movable;
  if (key === "parcialmente_movible") return copy.partial;
  if (key === "estructural") return copy.structural;
  return prettifyKey(key);
}
