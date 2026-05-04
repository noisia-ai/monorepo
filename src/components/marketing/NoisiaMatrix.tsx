"use client";

import React, { useState } from "react";

// --- Data ---

const METHODS = [
  "Cultural Codes",
  "Triggers & Barriers",
  "Value Perception Matrix",
  "Journey Friction Mapping",
  "Decision Velocity",
  "Influence Architecture",
] as const;

type Method = (typeof METHODS)[number];

const USE_CASES = [
  { id: "launch", label: "Lanzamiento" },
  { id: "market", label: "Nuevo mercado" },
  { id: "product", label: "Producto" },
  { id: "defense", label: "Defensa" },
  { id: "media", label: "Medios" },
  { id: "reposition", label: "Reposición" },
  { id: "trends", label: "Tendencias" },
  { id: "crisis", label: "Crisis" },
] as const;

type UseCaseId = (typeof USE_CASES)[number]["id"];
type CellState = "hot" | "warm" | null;

// [launch, market, product, defense, media, reposition, trends, crisis]
const MATRIX: Record<Method, CellState[]> = {
  "Cultural Codes":           ["hot",  "hot",  null,   null,   null,   "hot",  "hot",  "warm"],
  "Triggers & Barriers":      ["warm", null,   "hot",  "hot",  null,   null,   null,   null ],
  "Value Perception Matrix":  [null,   null,   "warm", null,   null,   "warm", null,   null ],
  "Journey Friction Mapping": [null,   null,   null,   "warm", "hot",  null,   null,   null ],
  "Decision Velocity":        [null,   null,   null,   null,   "warm", null,   null,   null ],
  "Influence Architecture":   [null,   "warm", null,   null,   null,   null,   "warm", "hot" ],
};

type CellKey = `${Method}__${UseCaseId}`;

const EXPLANATIONS: Partial<Record<CellKey, string>> = {
  "Cultural Codes__launch":
    "El código cultural define qué ángulo de campaña activa permiso sin cinismo. Necesario para que el mensaje encaje en la conversación existente.",
  "Cultural Codes__market":
    "La entrada a un nuevo mercado exige leer el código local primero. Sin eso, cualquier posicionamiento llega como importado.",
  "Cultural Codes__reposition":
    "El reposicionamiento requiere entender qué código nuevo puede adoptar la marca sin perder credibilidad en su base actual.",
  "Cultural Codes__trends":
    "Las tendencias emergentes se leen primero en códigos culturales antes de volverse datos de mercado.",
  "Cultural Codes__crisis":
    "Secundario: el código cultural determina qué narrativa tiene permiso de circular y cuál activa rechazo.",
  "Triggers & Barriers__launch":
    "Secundario: mapea barreras de adopción en la primera exposición — qué frena la prueba antes de que haya convicción.",
  "Triggers & Barriers__product":
    "El desarrollo de producto parte de entender qué barreras bloquean la adopción actual y qué triggers activan el cambio de hábito.",
  "Triggers & Barriers__defense":
    "La defensa competitiva requiere saber exactamente qué triggers empujan al consumidor hacia el competidor y en qué momento.",
  "Value Perception Matrix__product":
    "Secundario: valida si el nuevo producto construye o destruye percepción de valor versus las alternativas disponibles.",
  "Value Perception Matrix__reposition":
    "Secundario: el reposicionamiento debe reconstruir el argumento de valor antes de cambiar precio o canal.",
  "Journey Friction Mapping__defense":
    "Secundario: mapea en qué punto del journey la fricción acelera el switch hacia el competidor.",
  "Journey Friction Mapping__media":
    "La optimización de medios necesita saber dónde muere la conversión post-clic — la fricción invisible que anula el gasto.",
  "Decision Velocity__media":
    "Secundario: la velocidad de decisión determina en qué momento del funnel cada medio tiene más impacto.",
  "Influence Architecture__market":
    "Secundario: la arquitectura de influencia identifica quién legitima la categoría en el nuevo mercado antes de la marca.",
  "Influence Architecture__trends":
    "Secundario: las tendencias llegan primero a través de nodos de influencia específicos — el mapa señala dónde observar.",
  "Influence Architecture__crisis":
    "La arquitectura de influencia define qué actores tienen credibilidad para contener la narrativa y por qué canal llegan.",
};

// --- Component ---

type ActiveCell = { method: Method; useCaseId: UseCaseId; label: string } | null;

export function NoisiaMatrix() {
  const [active, setActive] = useState<ActiveCell>(null);

  function handleCell(method: Method, ucIdx: number) {
    const state = MATRIX[method][ucIdx];
    if (!state) return;

    const uc = USE_CASES[ucIdx];
    const key = `${method}__${uc.id}` as CellKey;
    const explanation = EXPLANATIONS[key];
    if (!explanation) return;

    if (active?.method === method && active.useCaseId === uc.id) {
      setActive(null);
    } else {
      setActive({ method, useCaseId: uc.id, label: uc.label });
    }
  }

  const activeKey = active ? (`${active.method}__${active.useCaseId}` as CellKey) : null;

  return (
    <div className="noisia-matrix" aria-label="Matriz de cobertura metodológica">
      {/* Column headers */}
      <div className="nm-grid">
        <div className="nm-corner" />
        {USE_CASES.map((uc) => (
          <div className="nm-col-label" key={uc.id}>
            {uc.label}
          </div>
        ))}

        {/* Rows */}
        {METHODS.map((method) => (
          <React.Fragment key={method}>
            <div className="nm-row-label">
              {method}
            </div>
            {MATRIX[method].map((state, ucIdx) => {
              const uc = USE_CASES[ucIdx];
              const key = `${method}__${uc.id}` as CellKey;
              const isActive = activeKey === key;
              const hasExplanation = !!EXPLANATIONS[key];
              return (
                <button
                  key={key}
                  className={`nm-cell nm-cell--${state ?? "cold"} ${isActive ? "nm-cell--active" : ""}`}
                  onClick={() => handleCell(method, ucIdx)}
                  disabled={!hasExplanation}
                  aria-label={
                    state
                      ? `${method} para ${uc.label}: ${state === "hot" ? "primario" : "secundario"}`
                      : `${method} no aplica a ${uc.label}`
                  }
                  aria-pressed={isActive}
                >
                  <span className="nm-dot" aria-hidden="true" />
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Callout */}
      {active && activeKey && EXPLANATIONS[activeKey] && (
        <div className="nm-callout glass" role="region" aria-live="polite">
          <div className="nm-callout__head">
            <span className="chip chip--signal">{active.method}</span>
            <span className="nm-callout__arrow">→</span>
            <span className="chip">{active.label}</span>
          </div>
          <p className="nm-callout__text">{EXPLANATIONS[activeKey]}</p>
        </div>
      )}

      {/* Legend */}
      <div className="nm-legend">
        <span className="nm-legend-item">
          <span className="nm-dot nm-dot--hot" />
          Lente primario
        </span>
        <span className="nm-legend-item">
          <span className="nm-dot nm-dot--warm" />
          Lente complementario
        </span>
        <span className="nm-legend-item">
          <span className="nm-dot nm-dot--cold" />
          No aplica
        </span>
      </div>
    </div>
  );
}
