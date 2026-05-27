"use client";

import { useState } from "react";
import { saveDiagContext } from "@/lib/diagContext";

const wizardOptions = [
  {
    label: "No sé por qué la gente no compra",
    method: "Triggers & Barriers",
    slug: "triggers-y-barriers"
  },
  {
    label: "Mi competencia me come share",
    method: "Triggers & Barriers + Value Perception",
    slug: "triggers-y-barriers"
  },
  {
    label: "La gente se interesa, pero no termina de avanzar",
    method: "Journey Friction Mapping",
    slug: "journey-friction-mapping"
  },
  {
    label: "No sé qué territorio creativo defender",
    method: "Cultural Codes Decoding",
    slug: "cultural-codes-decoding"
  },
  {
    label: "No sé qué voces hacen creíble mi mensaje",
    method: "Influence Architecture",
    slug: "influence-architecture"
  },
  {
    label: "La decisión tarda demasiado en cerrarse",
    method: "Decision Velocity",
    slug: "decision-velocity"
  }
];

export function MethodologyWizard() {
  const [selected, setSelected] = useState<string | null>(null);

  function handleSelect(slug: string, label: string) {
    setSelected(slug);
    saveDiagContext({ wizardSituation: label });
    const target = document.getElementById(`methodology-${slug}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-highlighted");
    setTimeout(() => target.classList.remove("is-highlighted"), 1800);
  }

  return (
    <div className="method-wizard-v2">
      <header className="method-wizard-v2__head">
        <span className="eyebrow">GUÍA RÁPIDA</span>
        <h2 className="method-wizard-v2__title">
          Elige la situación que más se parece a la tuya.
        </h2>
        <p className="method-wizard-v2__lead">
          Te llevamos al método que normalmente ayuda a responder esa pregunta.
        </p>
      </header>

      <ol className="method-wizard-v2__list">
        {wizardOptions.map((option, idx) => (
          <li className="method-wizard-v2__row" key={option.label}>
            <button
              className={`method-wizard-v2__trigger ${selected === option.slug ? "is-active" : ""}`}
              onClick={() => handleSelect(option.slug, option.label)}
              type="button"
            >
              <span className="method-wizard-v2__index" aria-hidden="true">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="method-wizard-v2__situation">{option.label}</span>
              <span className="method-wizard-v2__arrow" aria-hidden="true">→</span>
              <span className="method-wizard-v2__method">{option.method}</span>
              <span className="method-wizard-v2__cta" aria-hidden="true">Ver método ↓</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
