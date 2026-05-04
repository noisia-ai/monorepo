"use client";

import Link from "next/link";
import { useState } from "react";
import { MethodologyChip } from "@/components/ui/MethodologyIcon";
import type { UseCase } from "@/content/site";

const DECISION_TYPES = ["Lanzamiento", "Crisis", "Reposicionamiento", "Nuevo mercado", "Optimización"];
const TIMELINES = ["2-4 sem", "4-6 sem", "4-8 sem", "6-10 sem"];

const FEATURED_SLUGS = ["lanzamiento-de-campana", "defensa-competitiva", "reposicionamiento"];

function matchesTimeline(timing: string, filter: string): boolean {
  return timing.toLowerCase().includes(filter.toLowerCase().replace(" sem", ""));
}

function matchesDecision(useCase: UseCase, filter: string): boolean {
  const map: Record<string, string[]> = {
    Lanzamiento: ["lanzamiento"],
    Crisis: ["crisis"],
    Reposicionamiento: ["reposicionamiento"],
    "Nuevo mercado": ["mercado"],
    Optimización: ["optimizacion", "optimización", "medios"]
  };
  const terms = map[filter] ?? [filter.toLowerCase()];
  return terms.some((t) => useCase.slug.toLowerCase().includes(t) || useCase.shortTitle.toLowerCase().includes(t));
}

type Props = {
  useCases: UseCase[];
};

export function CasosFilter({ useCases }: Props) {
  const [activeDecision, setActiveDecision] = useState<string | null>(null);
  const [activeTimeline, setActiveTimeline] = useState<string | null>(null);

  const filtered = useCases.filter((uc) => {
    if (activeDecision && !matchesDecision(uc, activeDecision)) return false;
    if (activeTimeline && !matchesTimeline(uc.timing, activeTimeline)) return false;
    return true;
  });

  const featured = filtered.filter((uc) => FEATURED_SLUGS.includes(uc.slug));
  const regular = filtered.filter((uc) => !FEATURED_SLUGS.includes(uc.slug));

  function toggleDecision(f: string) {
    setActiveDecision(activeDecision === f ? null : f);
  }

  function toggleTimeline(f: string) {
    setActiveTimeline(activeTimeline === f ? null : f);
  }

  return (
    <>
      <div className="cases-filter-intro">
        <div>
          <span className="cases-filter-kicker">Mapa activo</span>
          <p className="cases-filter-summary">
            {filtered.length} casos calibrados para distintas combinaciones de urgencia, riesgo y profundidad.
          </p>
        </div>
        <p className="cases-filter-note">
          Los filtros no sustituyen el diagnóstico. Solo te ayudan a encontrar la lectura que más se parece a tu
          situación.
        </p>
      </div>

      <div className="cases-filter-bar">
        <div className="cases-filter-group">
          <span className="cases-filter-label">Tipo</span>
          <div className="cases-filter-pills">
            {DECISION_TYPES.map((f) => (
              <button
                className={`cases-filter-pill ${activeDecision === f ? "is-active" : ""}`}
                key={f}
                onClick={() => toggleDecision(f)}
                type="button"
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="cases-filter-group">
          <span className="cases-filter-label">Timeline</span>
          <div className="cases-filter-pills">
            {TIMELINES.map((f) => (
              <button
                className={`cases-filter-pill ${activeTimeline === f ? "is-active" : ""}`}
                key={f}
                onClick={() => toggleTimeline(f)}
                type="button"
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {(activeDecision || activeTimeline) && (
          <button
            className="cases-filter-clear"
            onClick={() => {
              setActiveDecision(null);
              setActiveTimeline(null);
            }}
            type="button"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="cases-filter-empty">No hay casos que coincidan con esos filtros.</p>
      )}

      {featured.length > 0 && (
        <div className="cases-featured-grid">
          {featured.map((useCase) => (
            <Link
              className="content-card content-card--featured glass"
              href={`/casos-de-uso/${useCase.slug}`}
              key={useCase.slug}
            >
              <span className="chip">{useCase.timing}</span>
              <h2>{useCase.title}</h2>
              <p>{useCase.approach}</p>
              <div className="tag-list">
                {useCase.methodologies.map((m) => (
                  <MethodologyChip identifier={m} key={m} compact />
                ))}
              </div>
              <b className="link-arrow">
                Ver caso <span>→</span>
              </b>
            </Link>
          ))}
        </div>
      )}

      {regular.length > 0 && (
        <div className="content-grid" style={{ marginTop: featured.length > 0 ? "24px" : 0 }}>
          {regular.map((useCase) => (
            <Link className="content-card glass" href={`/casos-de-uso/${useCase.slug}`} key={useCase.slug}>
              <span className="chip">{useCase.timing}</span>
              <h2>{useCase.title}</h2>
              <p>{useCase.approach}</p>
              <div className="tag-list">
                {useCase.methodologies.map((m) => (
                  <MethodologyChip identifier={m} key={m} compact />
                ))}
              </div>
              <b className="link-arrow">
                Ver caso <span>→</span>
              </b>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
