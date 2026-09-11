"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { BrandContextPreparationNotice, useBrandContextPreparation } from "./BrandContextPreparationNotice";

type Competitor = {
  id: string;
  priority: number | null;
  canonicalName: string;
  vertical: string | null;
  subVertical: string | null;
};

export function CompetitorManager({ brandId, workspaceId, competitors, unfunded = false }: {
  brandId: string;
  workspaceId: string | null;
  competitors: Competitor[];
  unfunded?: boolean;
}) {
  const t = useTranslations("CompetitorManager");
  const router = useRouter();
  const preparation = useBrandContextPreparation(!unfunded);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recoverAutomaticKnowledge(action: string, errorCode: unknown) {
    if (errorCode !== "brand_context_knowledge_refresh_unavailable") return true;
    if (unfunded) return false;
    if (!workspaceId) return false;
    const recoveryAction = `recover-competitor-context:${action}`;
    const requestIdentity = { reason: "operator_requested_reconciliation", source_action: action };
    const intent = preparation.forRequest(recoveryAction, requestIdentity);
    try {
      const response = await fetch(`/api/data-os/signal/${workspaceId}/semantic-context/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.idempotency_key },
        body: JSON.stringify({ reason: requestIdentity.reason, preparation: intent })
      });
      if (!response.ok) return false;
      preparation.accepted(recoveryAction);
      return true;
    } catch { return false; }
  }

  async function addCompetitors(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetForm = event.currentTarget;
    setError(null);
    setIsAdding(true);

    const form = new FormData(targetForm);
    const names = splitList(String(form.get("competitors") ?? ""));
    const action = `add-competitors:${brandId}`;
    const intent = unfunded
      ? preparation.forUnfundedRequest(action, { competitors: names })
      : preparation.forRequest(action, { competitors: names });
    try {
      const res = await fetch(`/api/brands/${brandId}/competitors`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": intent.idempotency_key
        },
        body: JSON.stringify({ competitors: names, preparation: intent })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("fallbackAddError"));
      preparation.accepted(action);
      if (!await recoverAutomaticKnowledge(action, json?.brand_context_preparation?.error_code)) {
        setError(t("contextPending"));
      }
      targetForm.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fallbackAddError"));
    } finally {
      setIsAdding(false);
    }
  }

  async function removeOne(competitorId: string) {
    setError(null);
    setPendingId(competitorId);
    const action = `remove-competitor:${competitorId}`;
    const intent = unfunded
      ? preparation.forUnfundedRequest(action, { competitor_id: competitorId })
      : preparation.forRequest(action, { competitor_id: competitorId });
    try {
      const res = await fetch(`/api/brands/${brandId}/competitors/${competitorId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.idempotency_key },
        body: JSON.stringify({ preparation: intent })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("fallbackDeleteError"));
      preparation.accepted(action);
      if (!await recoverAutomaticKnowledge(action, json?.brand_context_preparation?.error_code)) {
        setError(t("contextPending"));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fallbackDeleteError"));
    } finally {
      setPendingId(null);
    }
  }

  async function clearAll() {
    if (!window.confirm(t("confirmClear", { count: competitors.length }))) return;

    setError(null);
    setIsClearing(true);
    const action = `clear-competitors:${brandId}`;
    const intent = unfunded
      ? preparation.forUnfundedRequest(action, { competitor_ids: "all-current" })
      : preparation.forRequest(action, { competitor_ids: "all-current" });
    try {
      const res = await fetch(`/api/brands/${brandId}/competitors`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.idempotency_key },
        body: JSON.stringify({ preparation: intent })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("fallbackClearError"));
      preparation.accepted(action);
      if (!await recoverAutomaticKnowledge(action, json?.brand_context_preparation?.error_code)) {
        setError(t("contextPending"));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fallbackClearError"));
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <section className="admin-section workspace-resource-section">
      <header className="admin-section__head">
        <div>
          <p className="workspace-form__eyebrow">{t("eyebrow")}</p>
          <h2>{t("title", { count: competitors.length })}</h2>
          <p>{t("subtitle")}</p>
        </div>
        {competitors.length > 0 ? (
          <button className="admin-button admin-button--danger" type="button" onClick={clearAll} disabled={isClearing}>
            <Icon name={isClearing ? "spinner" : "x"} size={13} /> {t("clear")}
          </button>
        ) : null}
      </header>
      <div className="workspace-resource-section__body">
      {error && (
        <p className="workspace-form__error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
      <form className="workspace-inline-form" onSubmit={addCompetitors}>
        <label className="workspace-field">
          <span>{t("addLabel")}</span>
          <textarea
            className="workspace-control workspace-control--textarea workspace-control--compact"
            name="competitors"
            placeholder={t("addPlaceholder")}
            rows={2}
          />
          <small>{t("hint")}</small>
        </label>
        <button className="admin-button" type="submit" disabled={isAdding}>
          <Icon name={isAdding ? "spinner" : "tag"} size={13} /> {t("add")}
        </button>
      </form>
      {!unfunded ? <BrandContextPreparationNotice quote={preparation.quote} loading={preparation.loading} /> : null}
      {competitors.length === 0 ? (
        <div className="admin-empty workspace-resource-section__empty">
          <Icon name="info" size={18} />
          <p>{t("empty")}</p>
        </div>
      ) : (
        <ul className="workspace-chip-list">
          {competitors.map((competitor) => (
            <li key={competitor.id}>
              <article className="workspace-chip workspace-chip--removable">
                <span>#{competitor.priority ?? "—"}</span>
                <strong title={competitor.canonicalName}>{competitor.canonicalName}</strong>
                <button
                  type="button"
                  aria-label={t("deleteAria", { name: competitor.canonicalName })}
                  onClick={() => removeOne(competitor.id)}
                  disabled={pendingId === competitor.id || isClearing}
                >
                  <Icon name={pendingId === competitor.id ? "spinner" : "x"} size={12} />
                </button>
              </article>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  );
}

function splitList(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim().replace(/\s+/g, " ").slice(0, 240))
    .filter((item) => item.length >= 2 && item.length <= 240);
}
