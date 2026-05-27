"use client";

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Grid,
  MessageCircle,
  Target,
  TrendingUp,
  UserPlus,
} from "react-feather";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  ReferenceDot,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  volumeTimeline: ChartRecord[];
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
          <div className="signal-chart-fallback">
            <span>Dashboard temporalmente no disponible</span>
            <strong>El reporte sigue cargado; una visualización falló en el navegador.</strong>
            <p>Reintenta con refresh. Si persiste, el equipo puede revisar la consola sin bloquear el resto del Signal.</p>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
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
  volumeTimeline,
  findingsScatter,
  topVoice,
  topBarriers,
}: SignalDashboardChartsProps) {
  const [chartsReady, setChartsReady] = useState(false);
  const timeline = normalizeTimeline(volumeTimeline);
  const layers = normalizeLayerData(layerDist);
  const mobility = normalizeMobilityData(mobilityDist);
  const platforms = normalizePlatformData(platformDist);
  const scatter = normalizeScatterData(findingsScatter);
  const voice = normalizeVoiceData(topVoice);
  const polarity = normalizePolarityData(polarityDist);
  const triggerPct = Math.round((metrics.triggersTotal / Math.max(1, metrics.findingsTotal)) * 100);
  const barrierPct = Math.round((metrics.barriersTotal / Math.max(1, metrics.findingsTotal)) * 100);
  const movablePct = Math.round((metrics.movableTotal / Math.max(1, metrics.findingsTotal)) * 100);
  const perception = metrics.barriersTotal > metrics.triggersTotal ? "Negativa" : "Mixta";
  const topBarrier = topBarriers[0];
  const markers = buildTimelineMarkers(timeline, [...topBarriers, ...topVoice].slice(0, 4));
  const severityInsight = buildSeverityInsight(scatter);

  useEffect(() => {
    setChartsReady(true);
  }, []);

  return (
    <section className="signal-dashboard" id="overview">
      <div className="signal-dashboard-context">
        <span>{methodologyName}</span>
        <strong>{brandLabel}</strong>
      </div>

      <div className="signal-kpi-row" aria-label="Resumen del corte">
        <KpiCard
          label="Menciones totales"
          value={formatNumber(corpusTotal)}
          sub="Corpus del periodo"
          icon={<Grid size={15} />}
          action="Ver corpus"
          chartsReady={chartsReady}
        />
        <KpiCard
          label="Percepción"
          value={perception}
          sub={metrics.triggersTotal === 0 ? "Sin motivadores detectados" : "Fricción domina la lectura"}
          tone={perception === "Negativa" ? "negative" : "neutral"}
          action="Ver insight"
          chartsReady={chartsReady}
        />
        <KpiCard
          label="Triggers"
          value={formatNumber(metrics.triggersTotal)}
          sub={`${triggerPct}% de hallazgos`}
          radialValue={triggerPct}
          icon={<AlertTriangle size={15} />}
          radialTone="signal"
          chartsReady={chartsReady}
        />
        <KpiCard
          label="Barriers"
          value={formatNumber(metrics.barriersTotal)}
          sub={`${barrierPct}% de hallazgos`}
          radialValue={barrierPct}
          icon={<UserPlus size={15} />}
          radialTone="tension"
          chartsReady={chartsReady}
        />
        <KpiCard
          label="Mejoras"
          value={formatNumber(metrics.movableTotal)}
          sub={`${movablePct}% movibles por marca`}
          radialValue={movablePct}
          icon={<UserPlus size={15} />}
          radialTone="signal"
          chartsReady={chartsReady}
        />
      </div>

      <div className="signal-hero-chart-card">
        <div className="signal-hero-chart-head">
          <div>
            <span>Señales en el tiempo</span>
            <strong>{windowLabel}</strong>
          </div>
          <div className="signal-hero-chart-tabs" aria-label="Dimensiones visibles">
            <span>Volumen real</span>
            <span>Peaks anotados</span>
            <span>Hover activo</span>
          </div>
        </div>
        <div className="signal-hero-chart signal-recharts-frame">
          {chartsReady ? (
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
                name="Menciones"
                stroke={COLORS.ink}
                strokeWidth={2}
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
          ) : <ChartSkeleton />}
          {topBarrier ? (
            <div className="signal-floating-insight">
              <span>barrera encontrada</span>
              <strong>{stringValue(topBarrier.label) || "Fricción principal"}</strong>
              <small>{stringValue(topBarrier.confidence) || "media"} · prioridad alta</small>
            </div>
          ) : null}
        </div>
      </div>

      <div className="signal-chart-bento" id="snapshot">
        <ChartPanel eyebrow="Polaridad" title="La conversación empuja o frena" icon={<Activity size={15} />} span="half">
          <div className="signal-recharts-frame signal-recharts-frame--sm">
            {chartsReady ? (
            <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                cx="50%"
                cy="50%"
                data={polarity}
                dataKey="count"
                innerRadius={58}
                outerRadius={78}
                paddingAngle={4}
                nameKey="label"
              >
                {polarity.map((entry) => <Cell fill={entry.color} key={entry.key} />)}
              </Pie>
              <Tooltip content={<SignalTooltip />} />
            </PieChart>
          </ResponsiveContainer>
            ) : <ChartSkeleton compact />}
          </div>
          <MiniLegend items={polarity.map((p) => ({ label: p.label, value: p.count, color: p.color }))} />
        </ChartPanel>

        <ChartPanel eyebrow="Capas" title="Dónde vive la fricción" icon={<BarChart2 size={15} />} span="half">
          <div className="signal-recharts-frame signal-recharts-frame--md">
            {chartsReady ? (
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
              <Bar dataKey="count" name="Hallazgos" radius={[0, 10, 10, 0]}>
                {layers.map((entry) => <Cell fill={entry.color} key={entry.key} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
            ) : <ChartSkeleton compact />}
          </div>
        </ChartPanel>

        <ChartPanel eyebrow="Movilidad" title="Qué sí puede mover la marca" icon={<TrendingUp size={15} />} span="half">
          <div className="signal-recharts-frame signal-recharts-frame--sm">
            {chartsReady ? (
            <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="50%"
              data={mobility}
              endAngle={-270}
              innerRadius="38%"
              outerRadius="88%"
              startAngle={90}
            >
              <PolarAngleAxis angleAxisId={0} domain={[0, 100]} tick={false} type="number" />
              <RadialBar background={{ fill: "rgba(37,38,42,0.06)" }} dataKey="percent" radius={10} />
              <Tooltip content={<SignalTooltip />} />
            </RadialBarChart>
          </ResponsiveContainer>
            ) : <ChartSkeleton compact />}
          </div>
          <MiniLegend items={mobility.map((m) => ({ label: m.label, value: `${m.percent}%`, color: m.fill }))} />
        </ChartPanel>

        <ChartPanel eyebrow="Fuentes" title="Dónde aparece la señal" icon={<Grid size={15} />} span="half">
          <div className="signal-recharts-frame signal-recharts-frame--md">
            {chartsReady ? (
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={platforms} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 8" vertical={false} />
              <XAxis axisLine={false} dataKey="label" tick={{ fill: COLORS.quiet, fontSize: 12 }} tickLine={false} />
              <YAxis axisLine={false} tick={{ fill: COLORS.quiet, fontSize: 11 }} tickLine={false} width={34} />
              <Tooltip content={<SignalTooltip />} />
              <Bar dataKey="count" fill={COLORS.signalDark} name="Menciones" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
            ) : <ChartSkeleton compact />}
          </div>
        </ChartPanel>

        <ChartPanel eyebrow="Mapa de severidad" title="Frecuencia vs intensidad" icon={<Activity size={15} />} span="wide">
          <div className="signal-recharts-frame signal-recharts-frame--lg">
            {chartsReady ? (
            <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 14, right: 16, bottom: 20, left: 4 }}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 8" />
              <XAxis
                axisLine={false}
                dataKey="frequency"
                name="Frecuencia"
                tick={{ fill: COLORS.quiet, fontSize: 11 }}
                tickLine={false}
                type="number"
              />
              <YAxis
                axisLine={false}
                dataKey="intensity"
                name="Intensidad"
                tick={{ fill: COLORS.quiet, fontSize: 11 }}
                tickLine={false}
                type="number"
              />
              <Tooltip content={<SignalTooltip />} />
              <Scatter data={scatter} name="Hallazgos">
                {scatter.map((entry) => <Cell fill={entry.color} fillOpacity={0.72} key={entry.id} stroke={entry.color} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
            ) : <ChartSkeleton compact />}
          </div>
        </ChartPanel>

        <article className="signal-chart-insight">
          <Target size={18} />
          <span>Lectura rápida</span>
          <strong>{severityInsight.title}</strong>
          <p>{severityInsight.body}</p>
          <dl>
            <div>
              <dt>Hallazgos</dt>
              <dd>{scatter.length}</dd>
            </div>
            <div>
              <dt>Alta intensidad</dt>
              <dd>{severityInsight.highIntensity}</dd>
            </div>
          </dl>
        </article>

        <ChartPanel eyebrow="Share of voice" title="Qué barreras cargan más evidencia" icon={<MessageCircle size={15} />} span="full">
          <div className="signal-recharts-frame signal-recharts-frame--md">
            {chartsReady ? (
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={voice} layout="vertical" margin={{ top: 6, right: 18, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={COLORS.grid} />
              <XAxis axisLine={false} hide type="number" />
              <YAxis
                axisLine={false}
                dataKey="code"
                tick={{ fill: COLORS.quiet, fontSize: 11 }}
                tickLine={false}
                type="category"
                width={58}
              />
              <Tooltip content={<SignalTooltip />} />
              <Bar dataKey="count" fill={COLORS.tension} name="Citas" radius={[0, 10, 10, 0]} />
            </BarChart>
          </ResponsiveContainer>
            ) : <ChartSkeleton compact />}
          </div>
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
  chartsReady,
}: {
  label: string;
  value: string;
  sub: string;
  action?: string;
  icon?: React.ReactNode;
  radialValue?: number;
  radialTone?: "ink" | "signal" | "tension";
  tone?: "neutral" | "negative";
  chartsReady: boolean;
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
      {typeof radialValue === "number" && chartsReady ? (
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

function ChartSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`signal-chart-skeleton${compact ? " signal-chart-skeleton--compact" : ""}`} aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </div>
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
  span: "half" | "wide" | "full";
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

function SignalTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: unknown; payload?: ChartRecord; color?: string }>; label?: unknown }) {
  if (!active || !payload?.length) return null;
  const first = payload[0]?.payload;
  return (
    <div className="signal-chart-tooltip">
      <strong>{stringValue(first?.tooltipTitle) || stringValue(label) || stringValue(first?.label) || "Dato"}</strong>
      {payload.slice(0, 3).map((item, index) => (
        <span key={`${item.name ?? "value"}-${index}`}>
          <i style={{ background: item.color ?? stringValue(first?.color) ?? COLORS.ink }} />
          {item.name ?? "Valor"}: {formatNumber(Number(item.value ?? 0))}
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

function normalizeTimeline(rows: ChartRecord[]) {
  if (rows.length === 0) return [{ label: "Sin datos", mentions: 0, tooltipTitle: "Sin datos" }];
  return rows.map((row) => {
    const rawMonth = stringValue(row.month);
    const date = rawMonth ? new Date(`${rawMonth}-01T00:00:00Z`) : null;
    const label = date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" })
      : rawMonth || "Mes";
    const mentions = Number(row.count ?? 0);
    return {
      label,
      mentions,
      tooltipTitle: label,
      hint: `${formatNumber(mentions)} menciones en el corte`,
    };
  });
}

function normalizePolarityData(rows: ChartRecord[]) {
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
      label: prettifyPolarity(key),
      count: Number(row.count ?? 0),
      color: colorBy[key] ?? COLORS.quiet,
    };
  }).filter((row) => row.count > 0);
}

function normalizeLayerData(rows: ChartRecord[]) {
  return rows.map((row) => {
    const key = stringValue(row.layer) || "sin capa";
    return {
      key,
      label: prettifyKey(key),
      count: Number(row.count ?? 0),
      intensity: Number(row.avg_intensity ?? 0),
      color: layerColors[key] ?? COLORS.quiet,
      tooltipTitle: prettifyKey(key),
      hint: `Intensidad promedio ${Number(row.avg_intensity ?? 0).toFixed(1)}`,
    };
  }).filter((row) => row.count > 0);
}

function normalizeMobilityData(rows: ChartRecord[]) {
  const total = rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  return rows.map((row) => {
    const key = stringValue(row.movilidad) || "sin movilidad";
    const count = Number(row.count ?? 0);
    const percent = Math.round((count / Math.max(1, total)) * 100);
    return {
      key,
      label: mobilityLabel(key),
      count,
      percent,
      fill: mobilityColors[key] ?? COLORS.quiet,
      tooltipTitle: mobilityLabel(key),
      hint: `${count} hallazgos`,
    };
  }).filter((row) => row.count > 0);
}

function normalizePlatformData(rows: ChartRecord[]) {
  return rows.slice(0, 7).map((row) => {
    const label = stringValue(row.platform) || "Fuente";
    const count = Number(row.count ?? 0);
    return { label, count, tooltipTitle: label };
  }).filter((row) => row.count > 0);
}

function normalizeScatterData(rows: ChartRecord[]) {
  return rows.map((row, index) => {
    const layer = stringValue(row.layer);
    return {
      id: stringValue(row.finding_id) || String(index),
      frequency: Number(row.frecuencia ?? 0),
      intensity: Number(row.intensidad ?? 0),
      score: Number(row.score ?? 0),
      color: layerColors[layer] ?? COLORS.quiet,
      tooltipTitle: stringValue(row.nombre) || stringValue(row.finding_id) || "Hallazgo",
      hint: `${prettifyKey(layer)} · score ${Number(row.score ?? 0).toFixed(1)}`,
    };
  });
}

function normalizeVoiceData(rows: ChartRecord[]) {
  return rows.slice(0, 8).map((row, index) => {
    const code = stringValue(row.finding_id) || `B-${index + 1}`;
    const count = Number(row.citation_count ?? 0);
    return {
      code,
      count,
      tooltipTitle: stringValue(row.nombre) || code,
      hint: `${count} citas trazables`,
    };
  }).filter((row) => row.count > 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX").format(Number.isFinite(value) ? value : 0);
}

function buildTimelineMarkers(timeline: ReturnType<typeof normalizeTimeline>, records: ChartRecord[]) {
  const points = timeline
    .filter((point) => point.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 3);
  return points.map((point, index) => {
    const record = records[index] ?? records[0] ?? {};
    const label = truncateLabel(stringValue(record.label) || stringValue(record.nombre) || stringValue(record.finding_id) || "señal", 24);
    const id = stringValue(record.finding_id) || stringValue(record.id);
    return {
      x: point.label,
      y: point.mentions,
      label,
      tone: id.startsWith("T-") ? "trigger" : "barrier",
    };
  });
}

function buildSeverityInsight(scatter: ReturnType<typeof normalizeScatterData>) {
  if (scatter.length === 0) {
    return {
      title: "Sin mapa de severidad todavía",
      body: "Cuando el análisis tenga hallazgos codificados, aquí se mostrará qué tensiones combinan frecuencia e intensidad.",
      highIntensity: 0,
    };
  }
  const highIntensity = scatter.filter((item) => item.intensity >= 4).length;
  const leader = [...scatter].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  return {
    title: truncateLabel(leader?.tooltipTitle ?? "Tensión principal", 64),
    body: `${highIntensity} hallazgos viven arriba del umbral de intensidad alta. Prioriza los puntos que combinan frecuencia, intensidad y score compuesto.`,
    highIntensity,
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

function prettifyPolarity(p: string): string {
  if (p === "barrier") return "Barriers";
  if (p === "trigger") return "Triggers";
  if (p === "mixed") return "Mixtos";
  if (p === "irrelevant") return "Irrelevantes";
  return prettifyKey(p);
}

function mobilityLabel(key: string) {
  if (key === "movible_por_marca") return "Movible";
  if (key === "parcialmente_movible") return "Parcial";
  if (key === "estructural") return "Estructural";
  return prettifyKey(key);
}
