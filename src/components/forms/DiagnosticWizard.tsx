"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { clearDiagContext, readDiagContext } from "@/lib/diagContext";

const situations = [
  { label: "No sé por qué la gente no compra", slug: "no-compra" },
  { label: "Mi competencia me come share", slug: "competencia-share" },
  { label: "Mi journey está roto y no sé dónde", slug: "journey-roto" },
  { label: "No sé qué territorio creativo defender", slug: "territorio-creativo" },
  { label: "Mi comunicación no llega a los nodos correctos", slug: "comunicacion-nodos" },
  { label: "El consumidor decide lento en mi categoría", slug: "decision-lenta" },
  { label: "Otra pregunta estratégica", slug: "otra" },
];

const useCaseOptions = [
  { slug: "lanzamiento-de-campana", label: "Lanzamiento de campaña", sub: "Territorio creativo defensible" },
  { slug: "optimizacion-de-medios", label: "Optimización de medios", sub: "Fricción de mensaje" },
  { slug: "desarrollo-de-producto", label: "Desarrollo de producto", sub: "Jobs no resueltos" },
  { slug: "entrada-a-nuevo-mercado", label: "Nuevo mercado", sub: "Decodificación de categoría" },
  { slug: "defensa-competitiva", label: "Defensa competitiva", sub: "Narrativas de migración" },
  { slug: "anticipacion-de-tendencias", label: "Anticipación de tendencias", sub: "Señales débiles" },
];

const assetOptions = [
  "Research de mercado",
  "Data propia",
  "Social listening activo",
  "Análisis competitivo",
  "Focus groups recientes",
  "Data CRM / ventas",
  "Nada todavía",
];

const industryOptions = [
  "Alimentos y bebidas",
  "Belleza y cuidado personal",
  "Retail y e-commerce",
  "Tecnología y apps",
  "Fintech / servicios financieros",
  "Salud y bienestar",
  "Moda y lifestyle",
  "Educación",
  "Automotriz",
  "Telecomunicaciones",
  "Otra categoría",
];

const marketOptions = [
  "México", "Colombia", "Argentina", "Chile", "Perú", "España", "US Hispanic", "Otro",
];

type FormData = {
  situation: string;
  situationOther: string;
  caseSlug: string;
  assets: string[];
  industry: string;
  markets: string[];
  name: string;
  email: string;
  phone: string;
};

const TOTAL_STEPS = 5;

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 72 : -72, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -72 : 72, opacity: 0 }),
};

const transition = { duration: 0.3, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] };

export function DiagnosticWizard() {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [form, setForm] = useState<FormData>({
    situation: "",
    situationOther: "",
    caseSlug: "",
    assets: [],
    industry: "",
    markets: [],
    name: "",
    email: "",
    phone: "",
  });

  useEffect(() => {
    const ctx = readDiagContext();
    if (!ctx) return;
    setForm((prev) => {
      const updates: Partial<FormData> = {};
      if (ctx.wizardSituation) {
        const match = situations.find((s) => s.label === ctx.wizardSituation);
        if (match) updates.situation = match.slug;
      }
      if (ctx.caseSlug) updates.caseSlug = ctx.caseSlug;
      return { ...prev, ...updates };
    });
  }, []);

  function go(next: number) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleAsset(a: string) {
    setForm((prev) => ({
      ...prev,
      assets: prev.assets.includes(a) ? prev.assets.filter((x) => x !== a) : [...prev.assets, a],
    }));
  }

  function toggleMarket(m: string) {
    setForm((prev) => ({
      ...prev,
      markets: prev.markets.includes(m) ? prev.markets.filter((x) => x !== m) : [...prev.markets, m],
    }));
  }

  async function handleSubmit() {
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
    if (!emailValid) {
      setEmailError("Email inválido — revisa el formato.");
      return;
    }
    setEmailError("");
    setSubmitting(true);
    try {
      await fetch("/api/diagnostico", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } catch {
      // proceed to success even on network error
    }
    clearDiagContext();
    setSubmitting(false);
    setSubmitted(true);
  }

  if (submitted) {
    return <SuccessScreen name={form.name} />;
  }

  return (
    <div className="diag-wizard">
      <div className="diag-wizard__top">
        <div className="diag-wizard__progress-track">
          <motion.div
            className="diag-wizard__progress-fill"
            animate={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
        <span className="diag-wizard__step-count">{step + 1} / {TOTAL_STEPS}</span>
      </div>

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={step}
          className="diag-wizard__body"
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition}
        >
          {step === 0 && (
            <StepSituation form={form} setForm={setForm} onNext={() => go(1)} />
          )}
          {step === 1 && (
            <StepCase form={form} setForm={setForm} onNext={() => go(2)} onBack={() => go(0)} />
          )}
          {step === 2 && (
            <StepAssets form={form} toggle={toggleAsset} onNext={() => go(3)} onBack={() => go(1)} />
          )}
          {step === 3 && (
            <StepMarket
              form={form}
              setForm={setForm}
              toggle={toggleMarket}
              onNext={() => go(4)}
              onBack={() => go(2)}
            />
          )}
          {step === 4 && (
            <StepContact
              form={form}
              setForm={setForm}
              emailError={emailError}
              setEmailError={setEmailError}
              submitting={submitting}
              onBack={() => go(3)}
              onSubmit={handleSubmit}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepSituation({
  form,
  setForm,
  onNext,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
  onNext: () => void;
}) {
  return (
    <div className="diag-step">
      <div className="diag-step__head">
        <span className="diag-step__num">01</span>
        <h2 className="diag-step__title">¿Cuál es la situación que te trae aquí?</h2>
        <p className="diag-step__sub">Selecciona la que más se acerque. Después la afinamos.</p>
      </div>
      <div className="diag-option-grid">
        {situations.map((s) => (
          <button
            key={s.slug}
            type="button"
            className={`diag-option-card ${form.situation === s.slug ? "is-selected" : ""}`}
            onClick={() => {
              setForm((prev) => ({ ...prev, situation: s.slug }));
            }}
          >
            {form.situation === s.slug && (
              <span className="diag-option-check">
                <Check size={12} strokeWidth={2.5} />
              </span>
            )}
            {s.label}
          </button>
        ))}
      </div>
      {form.situation === "otra" && (
        <textarea
          className="diag-textarea"
          placeholder="Describe brevemente tu pregunta estratégica..."
          rows={3}
          value={form.situationOther}
          onChange={(e) => setForm((prev) => ({ ...prev, situationOther: e.target.value }))}
        />
      )}
      <div className="diag-nav diag-nav--end">
        <button
          className="diag-btn diag-btn--primary"
          type="button"
          disabled={!form.situation}
          onClick={onNext}
        >
          Siguiente <ArrowRight size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function StepCase({
  form,
  setForm,
  onNext,
  onBack,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="diag-step">
      <div className="diag-step__head">
        <span className="diag-step__num">02</span>
        <h2 className="diag-step__title">¿Qué tipo de decisión estás enfrentando?</h2>
        <p className="diag-step__sub">El caso que más resuena con tu contexto.</p>
      </div>
      <div className="diag-case-grid">
        {useCaseOptions.map((c) => (
          <button
            key={c.slug}
            type="button"
            className={`diag-case-card ${form.caseSlug === c.slug ? "is-selected" : ""}`}
            onClick={() => setForm((prev) => ({ ...prev, caseSlug: c.slug }))}
          >
            {form.caseSlug === c.slug && (
              <span className="diag-option-check">
                <Check size={12} strokeWidth={2.5} />
              </span>
            )}
            <strong>{c.label}</strong>
            <span>{c.sub}</span>
          </button>
        ))}
      </div>
      <div className="diag-nav">
        <button className="diag-btn diag-btn--ghost" type="button" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.8} /> Atrás
        </button>
        <button
          className="diag-btn diag-btn--primary"
          type="button"
          disabled={!form.caseSlug}
          onClick={onNext}
        >
          Siguiente <ArrowRight size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function StepAssets({
  form,
  toggle,
  onNext,
  onBack,
}: {
  form: FormData;
  toggle: (a: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="diag-step">
      <div className="diag-step__head">
        <span className="diag-step__num">03</span>
        <h2 className="diag-step__title">¿Con qué evidencia ya cuentas?</h2>
        <p className="diag-step__sub">Selecciona todo lo que aplique. Esto define qué necesitamos construir desde cero.</p>
      </div>
      <div className="diag-chips">
        {assetOptions.map((a) => (
          <button
            key={a}
            type="button"
            className={`diag-chip ${form.assets.includes(a) ? "is-selected" : ""}`}
            onClick={() => toggle(a)}
          >
            {form.assets.includes(a) && <Check size={11} strokeWidth={2.5} />}
            {a}
          </button>
        ))}
      </div>
      <div className="diag-nav">
        <button className="diag-btn diag-btn--ghost" type="button" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.8} /> Atrás
        </button>
        <button className="diag-btn diag-btn--primary" type="button" onClick={onNext}>
          Siguiente <ArrowRight size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function StepMarket({
  form,
  setForm,
  toggle,
  onNext,
  onBack,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
  toggle: (m: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="diag-step">
      <div className="diag-step__head">
        <span className="diag-step__num">04</span>
        <h2 className="diag-step__title">Categoría y mercado.</h2>
        <p className="diag-step__sub">Dónde opera la decisión. Cuanto más preciso, más útil el diagnóstico.</p>
      </div>
      <div className="diag-market-block">
        <label className="diag-label">Categoría</label>
        <div className="diag-chips">
          {industryOptions.map((ind) => (
            <button
              key={ind}
              type="button"
              className={`diag-chip ${form.industry === ind ? "is-selected" : ""}`}
              onClick={() => setForm((prev) => ({ ...prev, industry: ind }))}
            >
              {form.industry === ind && <Check size={11} strokeWidth={2.5} />}
              {ind}
            </button>
          ))}
        </div>
      </div>
      <div className="diag-market-block">
        <label className="diag-label">Mercados</label>
        <div className="diag-chips">
          {marketOptions.map((m) => (
            <button
              key={m}
              type="button"
              className={`diag-chip ${form.markets.includes(m) ? "is-selected" : ""}`}
              onClick={() => toggle(m)}
            >
              {form.markets.includes(m) && <Check size={11} strokeWidth={2.5} />}
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="diag-nav">
        <button className="diag-btn diag-btn--ghost" type="button" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.8} /> Atrás
        </button>
        <button
          className="diag-btn diag-btn--primary"
          type="button"
          disabled={!form.industry || form.markets.length === 0}
          onClick={onNext}
        >
          Siguiente <ArrowRight size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function StepContact({
  form,
  setForm,
  emailError,
  setEmailError,
  submitting,
  onBack,
  onSubmit,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
  emailError: string;
  setEmailError: (e: string) => void;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="diag-step">
      <div className="diag-step__head">
        <span className="diag-step__num">05</span>
        <h2 className="diag-step__title">¿Dónde te encontramos?</h2>
        <p className="diag-step__sub">
          Un arquitecto revisará el diagnóstico y te contactará para una llamada de 30 minutos.
          Sin presión comercial — solo para entender la pregunta.
        </p>
      </div>
      <div className="diag-contact-fields">
        <div className="diag-field">
          <label className="diag-label" htmlFor="diag-name">Nombre completo *</label>
          <input
            className="diag-input"
            id="diag-name"
            type="text"
            placeholder="Tu nombre"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          />
        </div>
        <div className="diag-field">
          <label className="diag-label" htmlFor="diag-email">Email de trabajo *</label>
          <input
            className={`diag-input ${emailError ? "diag-input--error" : ""}`}
            id="diag-email"
            type="email"
            placeholder="tu@empresa.com"
            value={form.email}
            onChange={(e) => {
              setEmailError("");
              setForm((prev) => ({ ...prev, email: e.target.value }));
            }}
          />
          {emailError && <span className="diag-field-error">{emailError}</span>}
        </div>
        <div className="diag-field">
          <label className="diag-label" htmlFor="diag-phone">Teléfono (opcional)</label>
          <input
            className="diag-input"
            id="diag-phone"
            type="tel"
            placeholder="+52 55 0000 0000"
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          />
        </div>
      </div>
      <div className="diag-nav">
        <button className="diag-btn diag-btn--ghost" type="button" onClick={onBack} disabled={submitting}>
          <ArrowLeft size={16} strokeWidth={1.8} /> Atrás
        </button>
        <button
          className="diag-btn diag-btn--primary"
          type="button"
          disabled={!form.name || !form.email || submitting}
          onClick={onSubmit}
        >
          {submitting ? "Enviando…" : "Enviar diagnóstico"}
          {!submitting && <ArrowRight size={16} strokeWidth={1.8} />}
        </button>
      </div>
      <p className="diag-legal">
        Tus respuestas son confidenciales. Firmamos NDA antes de cualquier conversación si lo necesitas.
      </p>
    </div>
  );
}

function SuccessScreen({ name }: { name: string }) {
  return (
    <motion.div
      className="diag-success"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="diag-success__icon">
        <Check size={28} strokeWidth={2} />
      </div>
      <h2 className="diag-success__title">
        {name ? `Listo, ${name.split(" ")[0]}.` : "Diagnóstico recibido."}
      </h2>
      <p className="diag-success__body">
        Un arquitecto Noisia revisará tus respuestas y te contactará en las próximas 24 horas
        para agendar una llamada de 30 minutos.
      </p>
      <p className="diag-success__body">
        No hay demo, no hay pitch. Solo una conversación para entender si la pregunta que tienes
        es la pregunta que debería guiar el protocolo.
      </p>
      <Link className="diag-btn diag-btn--primary" href="/">
        Volver al inicio
      </Link>
    </motion.div>
  );
}
