"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  siAnthropic,
  siApacheairflow,
  siApachekafka,
  siClickhouse,
  siGooglegemini,
  siHuggingface,
  siLangchain,
  siOllama,
  siOpentelemetry,
  siPostgresql,
  siPython,
  siQdrant,
  siSpacy
} from "simple-icons";

const architectureSteps = [
  {
    name: "Escucha",
    metric: "2,847 señales",
    detail: "Reviews, foros, redes, marketplaces, audio, video y documentos entran con fuente, fecha, mercado y contexto."
  },
  {
    name: "Orden",
    metric: "1 esquema",
    detail: "Deduplicación, idioma, entidades, atribución y taxonomía común para comparar plataformas sin mezclar peras con manzanas."
  },
  {
    name: "Contexto",
    metric: "8 capas",
    detail: "Tono, sarcasmo, jobs, fricción, motivación, valor, velocidad y códigos culturales se anotan sobre el mismo corpus."
  },
  {
    name: "Lectura",
    metric: "6 lentes",
    detail: "Los métodos se aplican sobre evidencia comparable, no sobre capturas sueltas."
  },
  {
    name: "Evidencia",
    metric: "100% trazable",
    detail: "Cada hallazgo conserva cita, fuente, tag y relación con la pregunta de negocio."
  },
  {
    name: "Salida",
    metric: "lista para usar",
    detail: "Reporte, fuentes y exportables salen de la misma base de evidencia."
  }
];

const codeLines = [
  "const signals = await ingest.sources({ market: 'MX', question });",
  "const corpus = normalize(signals).dedupe().translate();",
  "const enriched = enrich(corpus, ['jobs', 'tone', 'sarcasm']);",
  "const evidenceGraph = methods.run(enriched, activeLenses);",
  "const narrative = composeDecision(evidenceGraph, citations);",
  "return decisionReady({ report, sources, deck });"
];

const processLogs = [
  "→ ingesting   Reddit:MX  +312 posts",
  "→ dedup       removed 84 near-duplicates",
  "→ translate   en→es  228 units",
  "→ tone        classified 1,204 fragments",
  "→ jobs-to-be  extracted 3 primary jobs",
  "→ friction    scored 847 signals (98.2%)",
  "→ barriers    clustered 6 patterns",
  "→ graph       built 1,204 edges",
  "→ citations   linked 847 nodes",
  "→ narrative   draft ready · 3 moves",
  "→ export      decision deck ready",
  "→ source_drawer  linked · 2,847 refs"
];

const stackLogos = [
  { name: "Anthropic", icon: siAnthropic, color: "#181818" },
  { name: "Gemini", icon: siGooglegemini, color: "#8E75B2" },
  { name: "Hugging Face", icon: siHuggingface, color: "#FF9D00" },
  { name: "Ollama", icon: siOllama, color: "#111111" },
  { name: "LangGraph", icon: siLangchain, color: "#1c3c3c" },
  { name: "Apache Airflow", icon: siApacheairflow, color: "#017CEE" },
  { name: "Kafka", icon: siApachekafka, color: "#231F20" },
  { name: "Qdrant", icon: siQdrant, color: "#dc244c" },
  { name: "ClickHouse", icon: siClickhouse, color: "#ffcc01" },
  { name: "Postgres", icon: siPostgresql, color: "#4169e1" },
  { name: "spaCy", icon: siSpacy, color: "#09a3d5" },
  { name: "Python", icon: siPython, color: "#3776ab" },
  { name: "OpenTelemetry", icon: siOpentelemetry, color: "#4f62ad" }
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function ArchitectureFlow() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [logOffset, setLogOffset] = useState(0);

  useEffect(() => {
    let frame = 0;

    const updateProgress = () => {
      frame = 0;
      const node = rootRef.current;

      if (!node) {
        return;
      }

      const rect = node.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const start = viewportHeight * 0.78;
      const distance = rect.height + viewportHeight * 0.32;
      setProgress(clamp((start - rect.top) / distance, 0, 1));
    };

    const queueUpdate = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(updateProgress);
      }
    };

    queueUpdate();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);

    return () => {
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLogOffset((i) => (i + 1) % processLogs.length);
    }, 900);
    return () => window.clearInterval(interval);
  }, []);

  const activeIndex = useMemo(
    () => clamp(Math.floor(progress * architectureSteps.length), 0, architectureSteps.length - 1),
    [progress]
  );

  const visibleLogs = useMemo(() => {
    const result = [];
    for (let i = 0; i < 5; i++) {
      result.push(processLogs[(logOffset + i) % processLogs.length]);
    }
    return result;
  }, [logOffset]);

  return (
    <div
      className="architecture-flow architecture-flow--technical glass"
      ref={rootRef}
      aria-label="Arquitectura técnica Noisia"
      style={{ "--architecture-progress": String(progress) } as CSSProperties}
    >
      <div className="architecture-code-card">
        <div className="architecture-code-top">
          <span>noisia.pipeline.ts</span>
          <strong>lectura activa</strong>
        </div>
        <pre aria-label="Código del proceso Noisia">
          <code>
            {codeLines.map((line, index) => (
              <span className={index <= activeIndex ? "is-active" : ""} key={line}>
                <em>{String(index + 1).padStart(2, "0")}</em>
                {line}
              </span>
            ))}
          </code>
        </pre>
        <div className="architecture-live-feed" aria-hidden="true">
          {visibleLogs.map((log, i) => (
            <span
              key={`${logOffset}-${i}`}
              className={`architecture-log-line ${i === 0 ? "is-newest" : ""}`}
              style={{ opacity: 1 - i * 0.18 } as CSSProperties}
            >
              {log}
            </span>
          ))}
        </div>
        <div className="architecture-code-output">
          <span>source_drawer.linked</span>
          <strong>{architectureSteps[activeIndex].metric}</strong>
        </div>
      </div>

      <div className="architecture-runtime">
        <div className="architecture-stack" aria-label="Stack operativo">
          {stackLogos.map((tool) => (
            <span className="architecture-logo-chip" key={tool.name} style={{ "--tool-color": tool.color } as CSSProperties}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={tool.icon.path} />
              </svg>
              {tool.name}
            </span>
          ))}
        </div>

        <div className="architecture-timeline">
          <span className="architecture-timeline-fill" />
          {architectureSteps.map((step, index) => {
            const isActive = index <= activeIndex;

            return (
              <article className={`architecture-node ${isActive ? "is-active" : ""}`} key={step.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step.name}</h3>
                  <strong>{step.metric}</strong>
                </div>
                <p>{step.detail}</p>
              </article>
            );
          })}
        </div>

        <div className={`architecture-outputs ${progress > 0.82 ? "is-active" : ""}`} aria-label="Capas de salida">
          <span>Reporte narrativo</span>
          <span>Fuentes conectadas</span>
          <span>Preguntas al reporte</span>
          <span>Export</span>
        </div>
      </div>
    </div>
  );
}
