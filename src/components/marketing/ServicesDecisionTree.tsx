"use client";

import { useState } from "react";

type Step = {
  question: string;
  cue: string;
  options: Array<{ label: string; value: string }>;
};

const steps: Step[] = [
  {
    question: "¿Tienes una pregunta concreta o una preocupación recurrente?",
    cue: "Esto distingue validación puntual de necesidad continua.",
    options: [
      { label: "Una pregunta concreta", value: "concrete" },
      { label: "Una preocupación que vuelve", value: "recurring" }
    ]
  },
  {
    question: "¿Qué tan cerca está la decisión?",
    cue: "La urgencia cambia cuánto método y cuánta síntesis necesitas.",
    options: [
      { label: "Tengo que decidir pronto", value: "soon" },
      { label: "Quiero explorar primero", value: "explore" }
    ]
  },
  {
    question: "¿Es una situación puntual o necesitas capacidad continua?",
    cue: "Aquí se define si conviene proyecto o capacidad instalada.",
    options: [
      { label: "Proyecto puntual", value: "project" },
      { label: "Necesito capacidad continua", value: "ongoing" }
    ]
  }
];

type Answers = Record<number, string>;

function getRecommendation(answers: Answers): string {
  if (answers[2] === "ongoing" || answers[0] === "recurring") return "Strategy";
  if (answers[1] === "soon") return "Intelligence";
  return "Foundation";
}

const tierDescriptions: Record<string, { label: string; why: string; includes: string[] }> = {
  Foundation: {
    label: "Foundation",
    why: "Tienes una hipótesis concreta y necesitas evidencia antes de comprometer presupuesto.",
    includes: ["1-2 metodologías aplicadas", "Una pregunta principal", "Diagnóstico con recomendación defendible"]
  },
  Intelligence: {
    label: "Intelligence",
    why: "La decisión está cerca y el riesgo es real. Necesitas un playbook accionable.",
    includes: ["3-4 metodologías combinadas", "Lectura accionable para una decisión activa", "Playbook, rutas o defensa operable"]
  },
  Strategy: {
    label: "Strategy",
    why: "La inteligencia social es capacidad continua para tu categoría o portafolio.",
    includes: ["Las 6 metodologías activables", "Corpus vivo y protocolo evolutivo", "Acompañamiento trimestral o anual"]
  }
};

export function ServicesDecisionTree() {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [finished, setFinished] = useState(false);

  function handleAnswer(value: string) {
    const newAnswers = { ...answers, [currentStep]: value };
    setAnswers(newAnswers);

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setFinished(true);
      const tier = getRecommendation(newAnswers);
      setTimeout(() => {
        const target = document.getElementById(`tier-${tier.toLowerCase()}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("is-highlighted");
          setTimeout(() => target.classList.remove("is-highlighted"), 2000);
        }
      }, 400);
    }
  }

  function reset() {
    setCurrentStep(0);
    setAnswers({});
    setFinished(false);
  }

  const recommendation = finished ? getRecommendation(answers) : null;

  return (
    <div className="decision-tree glass">
      <p className="decision-tree__eyebrow">¿No sabes por dónde empezar?</p>

      {!finished ? (
        <>
          <div className="decision-tree__progress" aria-label={`Pregunta ${currentStep + 1} de ${steps.length}`}>
            {steps.map((_, i) => (
              <span
                className={`decision-tree__dot ${i <= currentStep ? "is-active" : ""}`}
                key={i}
                aria-hidden="true"
              />
            ))}
          </div>
          <div className="decision-tree__step-meta">
            <span>{`Paso ${currentStep + 1} de ${steps.length}`}</span>
            <small>{steps[currentStep].cue}</small>
          </div>
          <p className="decision-tree__question">{steps[currentStep].question}</p>
          <div className="decision-tree__options">
            {steps[currentStep].options.map((option) => (
              <button
                className="decision-tree__pill"
                key={option.value}
                onClick={() => handleAnswer(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="decision-tree__result">
          <p className="decision-tree__result-label">Para tu situación, recomendamos</p>
          <strong className="decision-tree__result-tier">{recommendation}</strong>
          <p className="decision-tree__result-why">{recommendation && tierDescriptions[recommendation].why}</p>
          {recommendation ? (
            <ul className="decision-tree__result-list">
              {tierDescriptions[recommendation].includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <div className="decision-tree__result-actions">
            <a className="button button--primary" href="#tier-grid">
              Ver {recommendation} →
            </a>
            <button className="button button--ghost" onClick={reset} type="button">
              Empezar de nuevo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
