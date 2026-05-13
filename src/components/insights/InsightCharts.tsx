"use client";

import type { InsightSignal } from "@/content/insights/reports";
import styles from "./Insights.module.css";

const maturityOrder = ["emergente", "acelerando", "mainstreaming"] as const;
const maturityLabels: Record<InsightSignal["maturity"], string> = {
  emergente: "Emergente",
  acelerando: "Acelerando",
  mainstreaming: "Mainstreaming"
};

const maturityColors: Record<InsightSignal["maturity"], string> = {
  emergente: "#C9892E",
  acelerando: "#2D6A9F",
  mainstreaming: "#1D7A55"
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

export function DownloadPrintButton() {
  return (
    <button className={`button button--secondary ${styles.printButton}`} type="button" onClick={() => window.print()}>
      Descargar PDF
    </button>
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

export function SignalEvidenceScatter({ signals }: { signals: InsightSignal[] }) {
  const maxMentions = Math.max(...signals.map((signal) => signal.volume_indicator.records_analyzed));
  const strongestMxSignals = [...signals]
    .sort((a, b) => b.volume_indicator.mx_evidence_estimated - a.volume_indicator.mx_evidence_estimated)
    .slice(0, 3);

  return (
    <div className={styles.lifecycleChart} role="img" aria-label="Ciclo de vida de señales culturales por madurez y escala de conversación">
      <div className={styles.lifecyclePlot}>
        <span className={styles.lifecycleAxisY}>Escala de conversación revisada</span>
        <span className={styles.lifecycleAxisX}>Madurez cultural</span>
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
    </div>
  );
}
