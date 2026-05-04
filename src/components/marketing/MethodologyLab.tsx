"use client";

import React, { useState, useEffect, useRef } from "react";

type Polarity = "Trigger" | "Barrier";

type LabQuote = {
  text: string;
  dimension: string;
  polarity: Polarity;
  source: string;
};

const QUOTES: LabQuote[] = [
  {
    text: "Me da nervios meter mi tarjeta en una app que no conozco",
    dimension: "Psychological",
    polarity: "Barrier",
    source: "App Store review · MX",
  },
  {
    text: "Mi mamá ya lo usa, así que ya bajé la app",
    dimension: "Social",
    polarity: "Trigger",
    source: "Foro · Reddit",
  },
  {
    text: "Si no acepto pago digital pierdo clientes y ya",
    dimension: "Cultural",
    polarity: "Trigger",
    source: "Facebook · PYME",
  },
  {
    text: "No tengo paciencia para aprender otra app más",
    dimension: "Personal",
    polarity: "Barrier",
    source: "Twitter / X · MX",
  },
];

const DIMENSIONS = ["Cultural", "Social", "Personal", "Psychological"] as const;
const POLARITIES: Polarity[] = ["Trigger", "Barrier"];

type Phase = 0 | 1 | 2 | 3 | 4;

export function MethodologyLab() {
  const [phase, setPhase] = useState<Phase>(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [filledCells, setFilledCells] = useState<Set<string>>(new Set());
  const [activeQuote, setActiveQuote] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function run() {
    clearTimers();
    setPhase(1);
    setRevealedCount(0);
    setFilledCells(new Set());
    setActiveQuote(null);

    // Phase 1: stagger quote reveals — 250ms apart starting at 100ms
    QUOTES.forEach((_, i) => {
      timers.current.push(setTimeout(() => setRevealedCount(i + 1), 100 + i * 250));
    });

    // Phase 2 at 1000ms: labels appear
    timers.current.push(setTimeout(() => setPhase(2), 1000));

    // Phase 3 at 2500ms: matrix fills
    timers.current.push(
      setTimeout(() => {
        setPhase(3);
        QUOTES.forEach((q, i) => {
          timers.current.push(
            setTimeout(
              () => setFilledCells((prev) => new Set([...prev, `${q.polarity}__${q.dimension}`])),
              i * 375
            )
          );
        });
      }, 2500)
    );

    // Phase 4 at 4000ms: done / interactive
    timers.current.push(setTimeout(() => setPhase(4), 4000));
  }

  function reset() {
    clearTimers();
    setPhase(0);
    setRevealedCount(0);
    setFilledCells(new Set());
    setActiveQuote(null);
  }

  useEffect(() => () => clearTimers(), []);

  const quoteByCell = Object.fromEntries(
    QUOTES.map((q) => [`${q.polarity}__${q.dimension}`, q])
  );

  const isDone = phase === 4;

  return (
    <div className={`mlab glass mlab--p${phase}`} aria-label="Demo interactivo de Triggers & Barriers">
      <div className="mlab__head">
        <div className="mlab__head-copy">
          <span className="eyebrow">DEMO EN VIVO</span>
          <h3>Velo en 30 segundos</h3>
          <p className="mlab__head-sub">Así opera Triggers &amp; Barriers sobre conversación pública real.</p>
        </div>
        <div className="mlab__head-actions">
          {phase === 0 && (
            <button className="mlab__cta" onClick={run} type="button">
              Ver el método <span aria-hidden="true">→</span>
            </button>
          )}
          {phase === 4 && (
            <button className="mlab__reset" onClick={reset} type="button">
              Repetir
            </button>
          )}
        </div>
      </div>

      {phase > 0 && (
        <div className="mlab__body">
          {/* Quote stream */}
          <div className="mlab__quotes">
            {QUOTES.map((q, i) => {
              const isRevealed = i < revealedCount;
              const hasTags = phase >= 2 && isRevealed;
              const isActive = activeQuote === i;
              return (
                <div
                  key={i}
                  className={[
                    "mlab__quote",
                    isRevealed ? "is-revealed" : "",
                    hasTags ? "has-tags" : "",
                    isDone ? "is-interactive" : "",
                    isActive ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => isDone && setActiveQuote(activeQuote === i ? null : i)}
                  role={isDone ? "button" : undefined}
                  tabIndex={isDone ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (isDone && (e.key === "Enter" || e.key === " "))
                      setActiveQuote(activeQuote === i ? null : i);
                  }}
                >
                  <p className="mlab__quote-text">&ldquo;{q.text}&rdquo;</p>
                  <div className="mlab__quote-tags">
                    <span
                      className={`chip chip--${q.polarity === "Trigger" ? "signal" : "barrier"}`}
                    >
                      {q.polarity}
                    </span>
                    <span className="chip">{q.dimension}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Matrix — visible from phase 3 */}
          <div className="mlab__matrix">
            <div className="mlab__grid">
              <div className="mlab__g-corner" />
              {DIMENSIONS.map((d) => (
                <div className="mlab__g-col" key={d}>
                  {d}
                </div>
              ))}
              {POLARITIES.map((polarity) => (
                <React.Fragment key={polarity}>
                  <div className="mlab__g-row">{polarity}</div>
                  {DIMENSIONS.map((dim) => {
                    const key = `${polarity}__${dim}`;
                    const q = quoteByCell[key];
                    const filled = filledCells.has(key);
                    const qIdx = q ? QUOTES.indexOf(q) : -1;
                    const highlighted = activeQuote === qIdx && qIdx !== -1;
                    return (
                      <div
                        key={key}
                        className={[
                          "mlab__g-cell",
                          q ? "mlab__g-cell--active" : "mlab__g-cell--empty",
                          filled ? "is-filled" : "",
                          highlighted ? "is-highlighted" : "",
                          isDone && q ? "is-interactive" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() =>
                          isDone && q && setActiveQuote(activeQuote === qIdx ? null : qIdx)
                        }
                        role={isDone && q ? "button" : undefined}
                        tabIndex={isDone && q ? 0 : undefined}
                        onKeyDown={(e) => {
                          if (isDone && q && (e.key === "Enter" || e.key === " "))
                            setActiveQuote(activeQuote === qIdx ? null : qIdx);
                        }}
                      >
                        {filled && q && (
                          <span className="mlab__g-cell-text">
                            &ldquo;
                            {q.text.length > 36 ? q.text.slice(0, 36) + "…" : q.text}
                            &rdquo;
                          </span>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Closing line — fades in at phase 4 */}
      {phase >= 3 && (
        <p className={`mlab__closing ${isDone ? "is-visible" : ""}`}>
          Eso es Triggers &amp; Barriers. Lo demás es escala, rigor y precisión.
        </p>
      )}

      {/* Detail panel for selected quote */}
      {isDone && activeQuote !== null && (
        <div className="mlab__detail glass">
          <div className="mlab__detail-tags">
            <span
              className={`chip chip--${QUOTES[activeQuote].polarity === "Trigger" ? "signal" : "barrier"}`}
            >
              {QUOTES[activeQuote].polarity}
            </span>
            <span className="chip">{QUOTES[activeQuote].dimension}</span>
          </div>
          <blockquote className="mlab__detail-quote">
            &ldquo;{QUOTES[activeQuote].text}&rdquo;
          </blockquote>
          <span className="mlab__detail-source">{QUOTES[activeQuote].source}</span>
        </div>
      )}
    </div>
  );
}
