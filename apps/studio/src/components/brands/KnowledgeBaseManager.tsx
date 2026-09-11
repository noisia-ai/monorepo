"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { BrandContextPreparationNotice, useBrandContextPreparation } from "./BrandContextPreparationNotice";
import { Icon } from "@/components/ui/Icon";
import { WorkspaceSelectField } from "@/components/admin/WorkspaceSelect";
import { BRAND_KNOWLEDGE_SOURCE_MAX_CHARS } from "@/lib/data-os/brand-automatic-knowledge";

type KnowledgeSource = {
  id: string;
  sourceKind: string;
  title: string;
  rawText: string | null;
  status: string;
};

export function KnowledgeBaseManager({ brandId, sources, unfunded = false }: {
  brandId: string;
  sources: KnowledgeSource[];
  unfunded?: boolean;
}) {
  const t = useTranslations("KnowledgeBaseManager");
  const router = useRouter();
  const preparation = useBrandContextPreparation(!unfunded);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState("brand_brief");
  const [addingOpen, setAddingOpen] = useState(false);
  const addFormId = useId(), titleInput = useRef<HTMLInputElement | null>(null);
  const sourceKinds = ["brand_brief", "campaign_brief", "market_notes", "competitive_notes", "always_on_context"] as const;
  const sourceOptions = sourceKinds.map((value) => ({ value, label: t(`types.${value}`) }));
  useEffect(() => { if (addingOpen) titleInput.current?.focus(); }, [addingOpen]);

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAdding) return;
    const targetForm = event.currentTarget;
    setError(null);
    setIsAdding(true);

    const form = new FormData(targetForm);
    const payload = payloadFromForm(form);
    const action = `add-knowledge:${brandId}`;
    const intent = unfunded ? preparation.forUnfundedRequest(action, payload) : preparation.forRequest(action, payload);
    try {
      const res = await fetch(`/api/brands/${brandId}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.idempotency_key },
        body: JSON.stringify({ ...payload, preparation: intent })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("fallbackAddError"));
      preparation.accepted(action);
      targetForm.reset();
      setSourceKind("brand_brief");
      setAddingOpen(false);
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
    const action = `edit-knowledge:${sourceId}`;
    const payload = payloadFromForm(form);
    const intent = unfunded ? preparation.forUnfundedRequest(action, payload) : preparation.forRequest(action, payload);
    try {
      const res = await fetch(`/api/brands/${brandId}/knowledge/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.idempotency_key },
        body: JSON.stringify({ ...payload, preparation: intent })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("fallbackSaveError"));
      preparation.accepted(action);
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

    const action = `delete-knowledge:${sourceId}`;
    const intent = unfunded
      ? preparation.forUnfundedRequest(action, { source_id: sourceId })
      : preparation.forRequest(action, { source_id: sourceId });
    try {
      const res = await fetch(`/api/brands/${brandId}/knowledge/${sourceId}`, { method: "DELETE",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.idempotency_key },
        body: JSON.stringify({ preparation: intent }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("fallbackDeleteError"));
      preparation.accepted(action);
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
          <p>{t("multipleHelp")}</p>
        </div>
        <button aria-controls={addFormId} aria-expanded={addingOpen} className="admin-button admin-button--primary"
          disabled={isAdding} onClick={() => setAddingOpen(true)} type="button"><Icon name="sparkle" size={14} /> {t("addNew")}</button>
      </header>
      <div className="workspace-resource-section__body">
      {error && (
        <p className="workspace-form__error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
      <p className="admin-drawer-form__hint">{t("sourceCount", { count: sources.length })}</p>
      <details className="workspace-disclosure workspace-disclosure--create" id={addFormId} open={addingOpen}
        onToggle={(event) => setAddingOpen(event.currentTarget.open)}>
        <summary>
          <span>{t("newTitle")}</span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <form className="workspace-disclosure__form" onSubmit={addSource}>
          <div className="workspace-form__grid">
            <label className="workspace-field">
              <span>{t("fieldTitle")}</span>
              <input className="workspace-control" name="title" ref={titleInput} maxLength={180} placeholder={t("fieldTitlePlaceholder")} required />
            </label>
            <WorkspaceSelectField
              ariaLabel={t("type")}
              label={t("type")}
              name="source_kind"
              onChange={setSourceKind}
              options={sourceOptions}
              value={sourceKind}
            />
          </div>
          <label className="workspace-field workspace-field--wide">
            <span>{t("content")}</span>
            <textarea className="workspace-control workspace-control--textarea" name="raw_text" required maxLength={BRAND_KNOWLEDGE_SOURCE_MAX_CHARS} placeholder={t("contentPlaceholder")} rows={4} />
          </label>
          {!unfunded ? <BrandContextPreparationNotice quote={preparation.quote} loading={preparation.loading} /> : null}
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
                  <small>{source.sourceKind === "brand_os_context" ? t("types.brand_os_context") : sourceOptions.find((option) => option.value === source.sourceKind)?.label ?? t("types.other")}</small>
                </span>
                <Icon name="chevron-down" size={14} />
              </summary>
              <p className="workspace-disclosure__preview">{source.rawText ? compactText(source.rawText) : t("emptySource")}</p>
              <form className="workspace-disclosure__form" onSubmit={(event) => saveSource(event, source.id)}>
                <div className="workspace-form__grid">
                  <label className="workspace-field">
                    <span>{t("fieldTitle")}</span>
                    <input className="workspace-control" name="title" defaultValue={source.title} maxLength={180} required />
                  </label>
                  <label className="workspace-field">
                    <span>{t("type")}</span>
                    {source.sourceKind === "brand_os_context" ? <><span className="workspace-control">{t("types.brand_os_context")}</span><input type="hidden" name="source_kind" value="brand_os_context" /></> :
                      <select className="workspace-control" name="source_kind" defaultValue={source.sourceKind} required>
                        {!sourceOptions.some(option => option.value === source.sourceKind) ? <option value={source.sourceKind}>{t("types.other")}</option> : null}
                        {sourceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>}
                  </label>
                </div>
                <label className="workspace-field workspace-field--wide">
                  <span>{t("content")}</span>
                  <textarea className="workspace-control workspace-control--textarea" name="raw_text" defaultValue={source.rawText ?? ""} required maxLength={BRAND_KNOWLEDGE_SOURCE_MAX_CHARS} rows={5} />
                </label>
                {!unfunded ? <BrandContextPreparationNotice quote={preparation.quote} loading={preparation.loading} /> : null}
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
