"use client";

import { useState } from "react";
import type { InsightSignal, SignalEvolutionSeries } from "@/content/insights/reports";
import styles from "./Insights.module.css";

const maturityOrder = ["emergente", "acelerando", "mainstreaming"] as const;
const maturityLabels: Record<InsightSignal["maturity"], string> = {
  emergente: "Emergente",
  acelerando: "Acelerando",
  mainstreaming: "Mainstreaming"
};

const maturityColors: Record<InsightSignal["maturity"], string> = {
  emergente: "#D81B60",
  acelerando: "#007E89",
  mainstreaming: "#261447"
};

const lifecycleStages = [
  { key: "emergente", label: "Emergente", helper: "lenguaje formándose" },
  { key: "acelerando", label: "Acelerando", helper: "frecuencia creciente" },
  { key: "mainstreaming", label: "Mainstreaming", helper: "lenguaje dominante" },
  { key: "saturacion", label: "Saturación", helper: "riesgo de cliché" }
] as const;

const lifecycleBaseX: Record<InsightSignal["maturity"], number> = {
  emergente: 14,
  acelerando: 39,
  mainstreaming: 63
};

const lifecycleMobileBaseY: Record<InsightSignal["maturity"], number> = {
  emergente: 87.5,
  acelerando: 62.5,
  mainstreaming: 37.5
};

function compactSignalName(input: string) {
  return input
    .replace(/^El /, "")
    .replace(/^La /, "")
    .replace(/^Lo /, "")
    .replace(" se vuelve ", " ")
    .replace(" pierde ", " ")
    .replace(" necesita ", " ")
    .replace(" empieza a ", " ");
}

const monthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

function formatMonth(month: string) {
  const [year, monthNumber] = month.split("-");
  return `${monthNames[Number(monthNumber) - 1] ?? month} ${year}`;
}

function compactMentions(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 100_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return value.toLocaleString("es-MX");
}

function pathFromPoints(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

export function DownloadPrintButton() {
  return (
    <button className={`button button--secondary ${styles.printButton}`} type="button" onClick={() => window.print()}>
      Descargar PDF
    </button>
  );
}

export function SignalEvolutionChart({
  signal,
  evolution
}: {
  signal: InsightSignal;
  evolution?: SignalEvolutionSeries;
}) {
  const [tooltip, setTooltip] = useState<{
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  if (!evolution || evolution.monthly.length < 2) {
    return null;
  }

  const evolutionData = evolution;
  const values = evolutionData.monthly.map((item) => item.mentions);
  const maxValue = Math.max(...values);
  const yMax = Math.ceil((maxValue * 1.12) / 1000) * 1000;
  const yTicks = [0, yMax / 2, yMax];
  const xLabelIndexes = [0, Math.floor((evolutionData.monthly.length - 1) / 2), evolutionData.monthly.length - 1];
  const chartFrames = {
    desktop: {
      className: styles.signalEvolutionSvgDesktop,
      height: 188,
      padding: { top: 18, right: 22, bottom: 34, left: 52 },
      pointRadius: 7,
      width: 760
    },
    mobile: {
      className: styles.signalEvolutionSvgMobile,
      height: 360,
      padding: { top: 28, right: 18, bottom: 50, left: 56 },
      pointRadius: 11,
      width: 360
    }
  };

  function renderSvg(variant: keyof typeof chartFrames) {
    const frame = chartFrames[variant];
    const plotWidth = frame.width - frame.padding.left - frame.padding.right;
    const plotHeight = frame.height - frame.padding.top - frame.padding.bottom;
    const baselineY = frame.padding.top + plotHeight;
    const points = evolutionData.monthly.map((item, index) => {
      const x = frame.padding.left + (index / (evolutionData.monthly.length - 1)) * plotWidth;
      const y = frame.padding.top + plotHeight - (item.mentions / yMax) * plotHeight;

      return { ...item, x, y };
    });
    const linePath = pathFromPoints(points);
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
    const gradientId = `evolution-fill-${signal.id}-${variant}`;

    return (
      <svg
        className={frame.className}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        role="img"
        aria-label={`${signal.commercial_name}: menciones mensuales`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={signal.color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={signal.color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => {
          const y = frame.padding.top + plotHeight - (tick / yMax) * plotHeight;

          return (
            <g className={styles.signalEvolutionGuide} key={`${variant}-${tick}`}>
              <line x1={frame.padding.left} x2={frame.width - frame.padding.right} y1={y} y2={y} />
              <text x={frame.padding.left - 10} y={y + 4}>
                {compactMentions(tick)}
              </text>
            </g>
          );
        })}
        <path className={styles.signalEvolutionArea} d={areaPath} fill={`url(#${gradientId})`} />
        <path className={styles.signalEvolutionLine} d={linePath} style={{ stroke: signal.color }} />
        {points.map((point) => (
          <circle
            className={styles.signalEvolutionPoint}
            cx={point.x}
            cy={point.y}
            key={`${signal.id}-${variant}-${point.month}`}
            r={frame.pointRadius}
            style={{ ["--signal-color" as string]: signal.color }}
            tabIndex={0}
            aria-label={`${formatMonth(point.month)} · ${point.mentions.toLocaleString("es-MX")} menciones`}
            onBlur={() => setTooltip(null)}
            onFocus={() =>
              setTooltip({
                label: `${formatMonth(point.month)} · ${point.mentions.toLocaleString("es-MX")} menciones`,
                x: point.x,
                y: point.y,
                width: frame.width,
                height: frame.height
              })
            }
            onMouseEnter={() =>
              setTooltip({
                label: `${formatMonth(point.month)} · ${point.mentions.toLocaleString("es-MX")} menciones`,
                x: point.x,
                y: point.y,
                width: frame.width,
                height: frame.height
              })
            }
            onMouseLeave={() => setTooltip(null)}
          >
            <title>{`${formatMonth(point.month)} · ${point.mentions.toLocaleString("es-MX")} menciones`}</title>
          </circle>
        ))}
        {xLabelIndexes.map((index) => {
          const point = points[index];

          return (
            <text className={styles.signalEvolutionXAxis} x={point.x} y={frame.height - 10} key={`${signal.id}-${variant}-label-${point.month}`}>
              {point.month}
            </text>
          );
        })}
      </svg>
    );
  }

  return (
    <section className={styles.signalEvolution} aria-label={`Evolución mensual de ${signal.commercial_name}`}>
      <header className={styles.signalEvolutionHeader}>
        <span className="eyebrow">Evolución mensual</span>
        <strong>{evolutionData.total.toLocaleString("es-MX")} menciones</strong>
      </header>
      <div className={styles.signalEvolutionCanvas}>
        {renderSvg("desktop")}
        {renderSvg("mobile")}
        {tooltip ? (
          <span
            className={styles.signalEvolutionTooltip}
            style={{
              ["--tooltip-x" as string]: `${(tooltip.x / tooltip.width) * 100}%`,
              ["--tooltip-y" as string]: `${(tooltip.y / tooltip.height) * 100}%`
            }}
          >
            {tooltip.label}
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function MaturityDistributionChart({ signals }: { signals: InsightSignal[] }) {
  const total = signals.length;

  return (
    <div className={styles.maturityChart} role="img" aria-label="Distribución de señales por madurez cultural">
      <div className={styles.lifecycleMap}>
        {maturityOrder.map((maturity) => {
          const count = signals.filter((signal) => signal.maturity === maturity).length;
          const stageSignals = signals.filter((signal) => signal.maturity === maturity);

          return (
            <span className={styles.lifecycleStage} key={maturity} style={{ ["--segment-color" as string]: maturityColors[maturity] }}>
              <i />
              <small>{maturityLabels[maturity]}</small>
              <strong>{count}</strong>
              <em>{Math.round((count / total) * 100)}%</em>
              <span>
                {stageSignals.map((signal) => (
                  <a href={`#signal-${signal.order}`} key={signal.id} title={signal.commercial_name}>
                    {String(signal.order).padStart(2, "0")}
                  </a>
                ))}
              </span>
            </span>
          );
        })}
      </div>

      <div className={styles.maturityLegend}>
        {maturityOrder.map((maturity) => (
          <span key={maturity}>
            <i style={{ ["--segment-color" as string]: maturityColors[maturity] }} />
            {maturityLabels[maturity]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SignalScaleChart({ signals }: { signals: InsightSignal[] }) {
  const max = Math.max(...signals.map((signal) => signal.volume_indicator.records_analyzed));

  return (
    <div className={styles.scaleChart} role="img" aria-label="Menciones revisadas por señal">
      {signals.map((signal) => {
        const value = signal.volume_indicator.records_analyzed;
        const width = Math.max((value / max) * 100, 6);

        return (
          <a
            className={styles.scaleRow}
            href={`#signal-${signal.order}`}
            key={signal.id}
            style={{
              ["--signal-color" as string]: signal.color,
              ["--bar-width" as string]: `${width}%`
            }}
          >
            <span className={styles.scaleName}>
              <b>{String(signal.order).padStart(2, "0")}</b>
              {compactSignalName(signal.commercial_name)}
            </span>
            <span className={styles.scaleBar}>
              <i />
            </span>
            <strong>{value.toLocaleString("es-MX")}</strong>
          </a>
        );
      })}
    </div>
  );
}

export function SignalEvidenceScatter({
  signals,
  axisLabel = "Madurez cultural"
}: {
  signals: InsightSignal[];
  axisLabel?: string;
}) {
  const maxMentions = Math.max(...signals.map((signal) => signal.volume_indicator.records_analyzed));
  const strongestMxSignals = [...signals]
    .sort((a, b) => b.volume_indicator.mx_evidence_estimated - a.volume_indicator.mx_evidence_estimated)
    .slice(0, 3);

  return (
    <div className={styles.lifecycleChart} role="img" aria-label="Ciclo de vida de señales culturales por madurez y escala de conversación">
      <div className={styles.lifecyclePlot}>
        <span className={styles.lifecycleAxisY}>Escala de conversación revisada</span>
        <span className={styles.lifecycleAxisX}>{axisLabel}</span>
        <div className={styles.lifecycleBands} aria-hidden="true">
          {lifecycleStages.map((stage) => (
            <span key={stage.key}>
              <strong>{stage.label}</strong>
              <small>{stage.helper}</small>
            </span>
          ))}
        </div>
        {signals.map((signal) => {
          const stageSignals = signals.filter((item) => item.maturity === signal.maturity);
          const stageIndex = stageSignals.findIndex((item) => item.id === signal.id);
          const stageOffset = stageSignals.length > 1 ? (stageIndex - (stageSignals.length - 1) / 2) * 3.4 : 0;
          const x = lifecycleBaseX[signal.maturity] + stageOffset;
          const y = 18 + Math.sqrt(signal.volume_indicator.records_analyzed / maxMentions) * 68;
          const mobileX = 18 + Math.sqrt(signal.volume_indicator.records_analyzed / maxMentions) * 62;
          const mobileStageOffset = stageSignals.length > 1 ? (stageIndex - (stageSignals.length - 1) / 2) * 3.8 : 0;
          const mobileY = lifecycleMobileBaseY[signal.maturity] - mobileStageOffset;
          const size = 30 + signal.volume_indicator.sources_count * 7;
          const topMarkers = signal.monitor_next.slice(0, 2).join(" · ");

          return (
            <a
              className={styles.lifecyclePoint}
              href={`#signal-${signal.order}`}
              key={signal.id}
              style={{
                ["--signal-color" as string]: signal.color,
                ["--point-x" as string]: `${x}%`,
                ["--point-y" as string]: `${y}%`,
                ["--point-mobile-x" as string]: `${mobileX}%`,
                ["--point-mobile-y" as string]: `${mobileY}%`,
                ["--point-size" as string]: `${size}px`
              }}
              aria-label={`${signal.commercial_name}: ${signal.volume_indicator.records_analyzed} menciones revisadas`}
            >
              <span>{String(signal.order).padStart(2, "0")}</span>
              <strong>{signal.commercial_name}</strong>
              <small>
                {signal.volume_indicator.records_analyzed.toLocaleString("es-MX")} menciones · {topMarkers}
              </small>
            </a>
          );
        })}
      </div>
      <aside className={styles.lifecycleCallout}>
        <span>Marcadores MX más densos</span>
        {strongestMxSignals.map((signal) => (
          <a href={`#signal-${signal.order}`} key={signal.id} style={{ ["--signal-color" as string]: signal.color }}>
            <b>{String(signal.order).padStart(2, "0")}</b>
            <strong>{compactSignalName(signal.commercial_name)}</strong>
            <small>{signal.monitor_next.slice(0, 3).join(" · ")}</small>
          </a>
        ))}
      </aside>
    </div>
  );
}
