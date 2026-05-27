// 5-step mini-demo: query → corpus → enrichment → analysis → evidence
// Static server component — no JS needed.
import type { ReactElement } from "react";

const QUERY = "¿Por qué los usuarios de 25–35 no convierten a pago en la primera semana?";

function StepCorpus() {
  const sources = ["Reddit/MX", "App Store", "Google Play", "Foros fintech", "Twitter/X"];
  return (
    <div className="qet-pills">
      {sources.map((s) => (
        <span className="chip" key={s}>{s}</span>
      ))}
      <span className="qet-corpus-count">2,847 unidades</span>
    </div>
  );
}

function StepEnrichment() {
  const tags = [
    { label: "fricción", count: "×847" },
    { label: "jobs", count: "×312" },
    { label: "tono", count: "×1,204" },
    { label: "sarcasmo", count: "×94" },
  ];
  return (
    <ul className="qet-tags">
      {tags.map(({ label, count }) => (
        <li key={label}>
          <span className="qet-tag-label">{label}</span>
          <span className="qet-tag-count">{count}</span>
        </li>
      ))}
    </ul>
  );
}

function StepAnalysis() {
  return (
    <div className="qet-finding">
      <p className="qet-finding-text">Barrera principal: precio vs. valor percibido</p>
      <div
        className="qet-bar"
        role="progressbar"
        aria-valuenow={67}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="qet-bar__fill" style={{ width: "67%" }} />
      </div>
      <span className="qet-bar__pct">67% de menciones de abandono</span>
    </div>
  );
}

function StepEvidence() {
  return (
    <figure className="qet-citation">
      <blockquote>
        &ldquo;Me parece caro para algo que no sé si me funciona. Lo probaría si hubiera un periodo
        más largo.&rdquo;
      </blockquote>
      <figcaption>
        <span className="chip">fricción:precio</span>
        <span className="chip">barrera:trial</span>
        <span className="qet-source">Reddit · r/finanzas_mx · 2026-02-14</span>
      </figcaption>
    </figure>
  );
}

const STEPS: Array<{
  num: string;
  phase: string;
  label: string;
  Body: () => ReactElement;
}> = [
  {
    num: "01",
    phase: "PREGUNTA",
    label: "Punto de entrada",
    Body: () => <p className="qet-query-text">{QUERY}</p>,
  },
  {
    num: "02",
    phase: "CORPUS",
    label: "Fuentes ensambladas",
    Body: StepCorpus,
  },
  {
    num: "03",
    phase: "ENRIQUECIMIENTO",
    label: "Capas anotadas",
    Body: StepEnrichment,
  },
  {
    num: "04",
    phase: "ANÁLISIS",
    label: "Lente: Triggers & Barriers",
    Body: StepAnalysis,
  },
  {
    num: "05",
    phase: "EVIDENCIA",
    label: "Cita trazable",
    Body: StepEvidence,
  },
];

export function QueryEvidenceTrace() {
  return (
    <div className="qet-wrapper" aria-label="Traza de evidencia">
      <div className="qet-steps" role="list">
        {STEPS.map((step, i) => (
          <div className="qet-step glass" key={step.num} role="listitem">
            <div className="qet-step__head">
              <span className="qet-step__num">{step.num}</span>
              <div>
                <span className="qet-step__phase">{step.phase}</span>
                <h3 className="qet-step__label">{step.label}</h3>
              </div>
            </div>
            <div className="qet-step__body">
              <step.Body />
            </div>
            {i < STEPS.length - 1 && (
              <span className="qet-step__arrow" aria-hidden="true">↓</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
