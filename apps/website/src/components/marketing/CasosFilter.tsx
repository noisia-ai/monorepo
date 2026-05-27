"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MethodologyChip } from "@/components/ui/MethodologyIcon";
import type { UseCase } from "@/content/site";

const DECISION_TYPES = ["Todos", "Lanzar", "Defender", "Entrar", "Optimizar", "Innovar", "Anticipar"];

const DECISION_MAP: Record<string, string[]> = {
  Lanzar: ["lanzamiento"],
  Defender: ["defensa", "crisis"],
  Entrar: ["mercado", "reposicionamiento"],
  Optimizar: ["optimizacion", "optimización", "medios"],
  Innovar: ["producto", "hipotesis", "hipótesis"],
  Anticipar: ["tendencias", "influencia"]
};

type Props = {
  useCases: UseCase[];
};

function matchesDecision(useCase: UseCase, filter: string): boolean {
  if (filter === "Todos") return true;
  const terms = DECISION_MAP[filter] ?? [filter.toLowerCase()];
  const searchable = `${useCase.slug} ${useCase.shortTitle} ${useCase.title}`.toLowerCase();
  return terms.some((term) => searchable.includes(term));
}

export function CasosFilter({ useCases }: Props) {
  const [activeDecision, setActiveDecision] = useState("Todos");

  const filtered = useMemo(
    () => useCases.filter((uc) => matchesDecision(uc, activeDecision)),
    [activeDecision, useCases]
  );

  return (
    <>
      <div className="cases-filter-intro">
        <div>
          <span className="cases-filter-kicker">Casos disponibles</span>
          <p className="cases-filter-summary">
            {filtered.length} casos para ubicar dónde puede servir Noisia antes de tomar una decisión.
          </p>
        </div>
        <p className="cases-filter-note">
          No son paquetes ni plantillas. Son formas de explicar qué pregunta se puede responder, qué fuentes conviene
          mirar y qué hallazgo debería llegar a la mesa.
        </p>
      </div>

      <div className="cases-filter-bar cases-filter-bar--editorial">
        <div className="cases-filter-group">
          <span className="cases-filter-label">Decisión</span>
          <div className="cases-filter-pills">
            {DECISION_TYPES.map((filter) => (
              <button
                className={`cases-filter-pill ${activeDecision === filter ? "is-active" : ""}`}
                key={filter}
                onClick={() => setActiveDecision(filter)}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="cases-filter-empty">No hay casos que coincidan con ese filtro.</p>
      )}

      {filtered.length > 0 && (
        <div className="cases-editorial-list">
          {filtered.map((useCase, index) => (
            <Link className="case-editorial-row" href={`/casos-de-uso/${useCase.slug}`} key={useCase.slug}>
              <span className="case-editorial-row__index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="case-editorial-row__body">
                <span className="case-editorial-row__kicker">{useCase.shortTitle}</span>
                <h3>{useCase.title}</h3>
                <p>{useCase.vignette}</p>
                <div className="tag-list">
                  {useCase.methodologies.map((methodology) => (
                    <MethodologyChip identifier={methodology} key={methodology} compact />
                  ))}
                </div>
              </div>
              <span className="case-editorial-row__arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
