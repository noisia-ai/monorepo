"use client";

import { Icon } from "@/components/ui/Icon";

export default function StudioError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app-content">
      <div className="studio-page">
        <section className="studio-error-card" role="alert">
          <div className="studio-error-icon">
            <Icon name="alert" size={24} />
          </div>
          <div>
            <p className="vitals-eyebrow">Studio</p>
            <h1>No pudimos cargar esta vista</h1>
            <p>
              {error.message || "La conexión respondió de forma inesperada. Intenta de nuevo."}
            </p>
          </div>
          <button className="wizard-cta" onClick={reset} type="button">
            <Icon name="refresh" size={14} /> Reintentar
          </button>
        </section>
      </div>
    </main>
  );
}
