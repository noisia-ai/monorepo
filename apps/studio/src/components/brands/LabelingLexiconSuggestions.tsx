"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMfpMutation, useMfpResource } from "./useMfpResource";

type Suggestions = {
  contract_version: "mass-labeling-lexicon-suggestions-v1";
  workspace_id: string; revision: number; available: boolean;
  items: Array<{ term: string; roots: number; trigger_roots: number; barrier_roots: number }>;
};

export function LabelingLexiconSuggestions({ workspaceId, revision, terms, disabled, onAccept, onAccessDenied }: {
  workspaceId: string; revision: number; terms: string[]; disabled: boolean;
  onAccept: (term: string) => void; onAccessDenied?: () => void;
}) {
  const t = useTranslations("LabelingStudySettings");
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t("suggestionsTitle")}</summary>
    {open ? <LexiconSuggestionList {...{ workspaceId, revision, terms, disabled, onAccept, onAccessDenied }} /> : null}
  </details>;
}

function LexiconSuggestionList({ workspaceId, revision, terms, disabled, onAccept, onAccessDenied }: {
  workspaceId: string; revision: number; terms: string[]; disabled: boolean;
  onAccept: (term: string) => void; onAccessDenied?: () => void;
}) {
  const t = useTranslations("LabelingStudySettings");
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/labeling/settings/suggestions`;
  const resource = useMfpResource<Suggestions>(endpoint, "mass-labeling-lexicon-suggestions-v1", onAccessDenied, false, String(revision));
  const mutation = useMfpMutation(endpoint, onAccessDenied);
  const current = resource.data?.workspace_id === workspaceId && resource.data.revision === revision ? resource.data : null;
  const existing = new Set(terms.map(term => term.trim().toLocaleLowerCase()));
  const items = current?.items.filter(item => !existing.has(item.term.toLocaleLowerCase())) ?? [];
  const dismiss = async (term?: string) => {
    const result = await mutation.send(term ? { expected_revision: revision, term } : undefined);
    if (result) await resource.read();
  };
  return <div>
    <p className="admin-drawer-form__hint">{t("suggestionsHelp")}</p>
    <button className="admin-button" type="button" disabled={resource.loading || mutation.busy}
      onClick={() => void resource.read()}>{t("suggestionsRefresh")}</button>
    {resource.loading ? <p role="status">{t("suggestionsLoading")}</p> : null}
    {current && !current.available ? <p>{t("suggestionsUnavailable")}</p> : null}
    {current?.available && !resource.loading && !items.length ? <p>{t("suggestionsEmpty")}</p> : null}
    {items.map(item => <div className="admin-form-actions" key={item.term}>
      <span><strong>{item.term}</strong> · {t("suggestionCounts", { roots: item.roots,
        triggers: item.trigger_roots, barriers: item.barrier_roots })}</span>
      <button className="admin-button" type="button" disabled={disabled || resource.loading || Boolean(resource.error) || mutation.busy || mutation.pending || terms.length >= 256}
        onClick={() => onAccept(item.term)}>{t("suggestionAccept")}</button>
      <button className="admin-button" type="button" disabled={disabled || resource.loading || Boolean(resource.error) || mutation.busy || mutation.pending}
        onClick={() => void dismiss(item.term)}>{t("suggestionDismiss")}</button>
    </div>)}
    {mutation.pending ? <button className="admin-button" type="button" disabled={mutation.busy}
      onClick={() => void dismiss()}>{t("suggestionRetry")}</button> : null}
    {resource.error || mutation.error ? <p className="team-msg team-msg--error" role="alert">{t("suggestionsError")}</p> : null}
  </div>;
}
