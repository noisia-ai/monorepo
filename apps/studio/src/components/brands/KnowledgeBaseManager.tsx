"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";

type KnowledgeSource = {
  id: string;
  sourceKind: string;
  title: string;
  rawText: string | null;
  status: string;
};

export function KnowledgeBaseManager({ brandId, sources }: { brandId: string; sources: KnowledgeSource[] }) {
  const t = useTranslations("KnowledgeBaseManager");
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
      if (!res.ok) throw new Error(json?.message ?? t("fallbackAddError"));
      targetForm.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fallbackAddError"));
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
      if (!res.ok) throw new Error(json?.message ?? t("fallbackSaveError"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fallbackSaveError"));
    } finally {
      setPendingId(null);
    }
  }

  async function deleteSource(sourceId: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    setError(null);
    setPendingId(sourceId);

    try {
      const res = await fetch(`/api/brands/${brandId}/knowledge/${sourceId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("fallbackDeleteError"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fallbackDeleteError"));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="new-study-panel knowledge-editor">
      <div className="new-study-section-head">
        <p className="vitals-eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
      </div>
      {error && (
        <p className="new-study-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
      <details className="knowledge-add-shell">
        <summary>
          <span>{t("addNew")}</span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <form className="knowledge-editor-card knowledge-editor-card--new" onSubmit={addSource}>
          <div className="new-study-grid">
            <label className="new-study-field">
              <span>{t("fieldTitle")}</span>
              <input className="filter-input new-study-input" name="title" placeholder={t("fieldTitlePlaceholder")} required />
            </label>
            <label className="new-study-field">
              <span>{t("type")}</span>
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
            <span>{t("content")}</span>
            <textarea className="filter-input new-study-textarea" name="raw_text" required placeholder={t("contentPlaceholder")} rows={4} />
          </label>
          <div className="knowledge-editor-actions">
            <button className="brand-os-action brand-os-action--secondary" type="submit" disabled={isAdding}>
              <Icon name={isAdding ? "spinner" : "sparkle"} size={13} /> {t("add")}
            </button>
          </div>
        </form>
      </details>

      <div className="knowledge-editor-list">
        {sources.length === 0 ? (
          <p className="new-study-helper">{t("empty")}</p>
        ) : (
          sources.map((source) => (
            <details className="knowledge-source-card" key={source.id}>
              <summary>
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.sourceKind} · {source.status}</small>
                </span>
                <Icon name="chevron-down" size={14} />
              </summary>
              <p className="knowledge-source-preview">{source.rawText ? compactText(source.rawText) : t("emptySource")}</p>
              <form className="knowledge-source-edit" onSubmit={(event) => saveSource(event, source.id)}>
                <div className="new-study-grid">
                  <label className="new-study-field">
                    <span>{t("fieldTitle")}</span>
                    <input className="filter-input new-study-input" name="title" defaultValue={source.title} required />
                  </label>
                  <label className="new-study-field">
                    <span>{t("type")}</span>
                    <input className="filter-input new-study-input" name="source_kind" defaultValue={source.sourceKind} required />
                  </label>
                </div>
                <label className="new-study-field new-study-field--wide">
                  <span>{t("content")}</span>
                  <textarea className="filter-input new-study-textarea" name="raw_text" defaultValue={source.rawText ?? ""} required rows={5} />
                </label>
                <div className="knowledge-editor-actions">
                  <button className="brand-os-action brand-os-action--tertiary brand-os-action--danger" type="button" onClick={() => deleteSource(source.id)} disabled={pendingId === source.id}>
                    <Icon name={pendingId === source.id ? "spinner" : "x"} size={13} /> {t("delete")}
                  </button>
                  <button className="brand-os-action brand-os-action--primary" type="submit" disabled={pendingId === source.id}>
                    <Icon name={pendingId === source.id ? "spinner" : "check"} size={13} /> {t("save")}
                  </button>
                </div>
              </form>
            </details>
          ))
        )}
      </div>
    </section>
  );
}

function compactText(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 380);
}

function payloadFromForm(form: FormData) {
  return {
    title: String(form.get("title") ?? "").trim(),
    source_kind: String(form.get("source_kind") ?? "brand_brief").trim(),
    raw_text: String(form.get("raw_text") ?? "").trim()
  };
}
