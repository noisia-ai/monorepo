"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";

type KnowledgeSource = {
  id: string;
  sourceKind: string;
  title: string;
  rawText: string | null;
  status: string;
};

export function KnowledgeBaseManager({ brandId, sources }: { brandId: string; sources: KnowledgeSource[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetForm = event.currentTarget;
    setError(null);
    setIsAdding(true);

    const form = new FormData(targetForm);
    try {
      const res = await fetch(`/api/brands/${brandId}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFromForm(form))
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "No se pudo crear el bloque de Knowledge Base.");
      targetForm.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el bloque de Knowledge Base.");
    } finally {
      setIsAdding(false);
    }
  }

  async function saveSource(event: FormEvent<HTMLFormElement>, sourceId: string) {
    event.preventDefault();
    setError(null);
    setPendingId(sourceId);

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch(`/api/brands/${brandId}/knowledge/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFromForm(form))
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "No se pudo guardar el bloque.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el bloque.");
    } finally {
      setPendingId(null);
    }
  }

  async function deleteSource(sourceId: string) {
    if (!window.confirm("Borrar este bloque de Knowledge Base?")) return;
    setError(null);
    setPendingId(sourceId);

    try {
      const res = await fetch(`/api/brands/${brandId}/knowledge/${sourceId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "No se pudo borrar el bloque.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el bloque.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="new-study-panel knowledge-editor">
      <div className="new-study-section-head">
        <p className="vitals-eyebrow">Knowledge Base</p>
        <h2>Contexto editable por bloques</h2>
      </div>
      {error && (
        <p className="new-study-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
      <form className="knowledge-editor-card" onSubmit={addSource}>
        <div className="new-study-grid">
          <label className="new-study-field">
            <span>Título</span>
            <input className="filter-input new-study-input" name="title" placeholder="Brief always-on, campaña Q3, research competitivo..." required />
          </label>
          <label className="new-study-field">
            <span>Tipo</span>
            <select className="filter-input new-study-input" name="source_kind" defaultValue="brand_brief">
              <option value="brand_brief">Brand brief</option>
              <option value="campaign_brief">Campaign brief</option>
              <option value="market_notes">Market notes</option>
              <option value="competitive_notes">Competitive notes</option>
              <option value="always_on_context">Always-on context</option>
            </select>
          </label>
        </div>
        <label className="new-study-field new-study-field--wide">
          <span>Contenido</span>
          <textarea className="filter-input new-study-textarea" name="raw_text" required placeholder="Pega aquí research, contexto de campaña, aprendizajes, restricciones, hipótesis..." />
        </label>
        <div className="knowledge-editor-actions">
          <button className="wizard-cta wizard-cta--secondary" type="submit" disabled={isAdding}>
            <Icon name={isAdding ? "spinner" : "sparkle"} size={13} /> Agregar bloque
          </button>
        </div>
      </form>

      <div className="knowledge-editor-list">
        {sources.length === 0 ? (
          <p className="new-study-helper">Todavía no hay bloques de Knowledge Base para esta marca.</p>
        ) : (
          sources.map((source) => (
            <form className="knowledge-editor-card" key={source.id} onSubmit={(event) => saveSource(event, source.id)}>
              <div className="new-study-grid">
                <label className="new-study-field">
                  <span>Título</span>
                  <input className="filter-input new-study-input" name="title" defaultValue={source.title} required />
                </label>
                <label className="new-study-field">
                  <span>Tipo</span>
                  <input className="filter-input new-study-input" name="source_kind" defaultValue={source.sourceKind} required />
                </label>
              </div>
              <label className="new-study-field new-study-field--wide">
                <span>Contenido</span>
                <textarea className="filter-input new-study-textarea" name="raw_text" defaultValue={source.rawText ?? ""} required />
              </label>
              <div className="knowledge-editor-actions">
                <span>{source.status}</span>
                <button className="wizard-cta wizard-cta--ghost" type="button" onClick={() => deleteSource(source.id)} disabled={pendingId === source.id}>
                  <Icon name={pendingId === source.id ? "spinner" : "x"} size={13} /> Borrar
                </button>
                <button className="wizard-cta" type="submit" disabled={pendingId === source.id}>
                  <Icon name={pendingId === source.id ? "spinner" : "check"} size={13} /> Guardar
                </button>
              </div>
            </form>
          ))
        )}
      </div>
    </section>
  );
}

function payloadFromForm(form: FormData) {
  return {
    title: String(form.get("title") ?? "").trim(),
    source_kind: String(form.get("source_kind") ?? "brand_brief").trim(),
    raw_text: String(form.get("raw_text") ?? "").trim()
  };
}
