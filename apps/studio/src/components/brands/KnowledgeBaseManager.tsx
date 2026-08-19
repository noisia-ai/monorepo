"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { WorkspaceSelectField } from "@/components/admin/WorkspaceSelect";

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
  const [sourceKind, setSourceKind] = useState("brand_brief");

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
      setSourceKind("brand_brief");
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
    <section className="admin-section workspace-resource-section">
      <header className="admin-section__head">
        <div>
          <p className="workspace-form__eyebrow">{t("eyebrow")}</p>
          <h2>{t("title")}</h2>
        </div>
      </header>
      <div className="workspace-resource-section__body">
      {error && (
        <p className="workspace-form__error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
      <details className="workspace-disclosure workspace-disclosure--create">
        <summary>
          <span>{t("addNew")}</span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <form className="workspace-disclosure__form" onSubmit={addSource}>
          <div className="workspace-form__grid">
            <label className="workspace-field">
              <span>{t("fieldTitle")}</span>
              <input className="workspace-control" name="title" placeholder={t("fieldTitlePlaceholder")} required />
            </label>
            <WorkspaceSelectField
              ariaLabel={t("type")}
              label={t("type")}
              name="source_kind"
              onChange={setSourceKind}
              options={[
                { label: "Brand brief", value: "brand_brief" },
                { label: "Campaign brief", value: "campaign_brief" },
                { label: "Market notes", value: "market_notes" },
                { label: "Competitive notes", value: "competitive_notes" },
                { label: "Always-on context", value: "always_on_context" }
              ]}
              value={sourceKind}
            />
          </div>
          <label className="workspace-field workspace-field--wide">
            <span>{t("content")}</span>
            <textarea className="workspace-control workspace-control--textarea" name="raw_text" required placeholder={t("contentPlaceholder")} rows={4} />
          </label>
          <div className="workspace-form__actions">
            <button className="admin-button admin-button--primary" type="submit" disabled={isAdding}>
              <Icon name={isAdding ? "spinner" : "sparkle"} size={13} /> {t("add")}
            </button>
          </div>
        </form>
      </details>

      <div className="workspace-disclosure-list">
        {sources.length === 0 ? (
          <div className="admin-empty"><p>{t("empty")}</p></div>
        ) : (
          sources.map((source) => (
            <details className="workspace-disclosure" key={source.id}>
              <summary>
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.sourceKind} · {source.status}</small>
                </span>
                <Icon name="chevron-down" size={14} />
              </summary>
              <p className="workspace-disclosure__preview">{source.rawText ? compactText(source.rawText) : t("emptySource")}</p>
              <form className="workspace-disclosure__form" onSubmit={(event) => saveSource(event, source.id)}>
                <div className="workspace-form__grid">
                  <label className="workspace-field">
                    <span>{t("fieldTitle")}</span>
                    <input className="workspace-control" name="title" defaultValue={source.title} required />
                  </label>
                  <label className="workspace-field">
                    <span>{t("type")}</span>
                    <input className="workspace-control" name="source_kind" defaultValue={source.sourceKind} required />
                  </label>
                </div>
                <label className="workspace-field workspace-field--wide">
                  <span>{t("content")}</span>
                  <textarea className="workspace-control workspace-control--textarea" name="raw_text" defaultValue={source.rawText ?? ""} required rows={5} />
                </label>
                <div className="workspace-form__actions workspace-form__actions--between">
                  <button className="admin-button admin-button--danger" type="button" onClick={() => deleteSource(source.id)} disabled={pendingId === source.id}>
                    <Icon name={pendingId === source.id ? "spinner" : "x"} size={13} /> {t("delete")}
                  </button>
                  <button className="admin-button admin-button--primary" type="submit" disabled={pendingId === source.id}>
                    <Icon name={pendingId === source.id ? "spinner" : "check"} size={13} /> {t("save")}
                  </button>
                </div>
              </form>
            </details>
          ))
        )}
      </div>
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
