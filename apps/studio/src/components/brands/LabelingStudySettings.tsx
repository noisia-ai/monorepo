"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { labelingStudySettingsInputV1, setLabelingTopicDisplayNameV1, type LabelingStudySettingsV1 } from "@/lib/data-os/signal-labeling-settings";
import { LabelingLexiconSuggestions } from "./LabelingLexiconSuggestions";
import { useMfpMutation, useMfpResource } from "./useMfpResource";

export function LabelingStudySettings({ workspaceId, onAccessDenied, onSaved, onReadyChange }: {
  workspaceId: string; onAccessDenied?: () => void; onSaved?: () => void; onReadyChange?: (ready: boolean) => void;
}) {
  const t = useTranslations("LabelingStudySettings");
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/labeling/settings`;
  const resource = useMfpResource<LabelingStudySettingsV1>(endpoint, "mass-labeling-study-policy-v1", onAccessDenied);
  const mutation = useMfpMutation(endpoint, onAccessDenied);
  const [draft, setDraft] = useState({ category: "", terms: "", threshold: "0.85", interests: [] as LabelingStudySettingsV1["interests"],
    names: {} as NonNullable<LabelingStudySettingsV1["display_names"]> });
  const [topicKey, setTopicKey] = useState("");
  const [saved, setSaved] = useState(false);
  const state = resource.data?.workspace_id === workspaceId ? resource.data : null;
  useEffect(() => {
    if (!state) return;
    setDraft({ category: state.category, terms: state.lexicon_terms.join("\n"),
      threshold: String(state.interest_threshold), interests: state.interests, names: state.display_names ?? {} });
  }, [state]);
  const parsed = state ? labelingStudySettingsInputV1(state, draft) : null;
  const stored = state ? labelingStudySettingsInputV1(state, { category: state.category, terms: state.lexicon_terms.join("\n"),
    threshold: String(state.interest_threshold), interests: state.interests, names: state.display_names ?? {} }) : null;
  const ready = Boolean(parsed?.success && stored?.success && !resource.error && !resource.loading && !mutation.pending
    && JSON.stringify(parsed.data) === JSON.stringify(stored.data));
  useEffect(() => { onReadyChange?.(ready); }, [onReadyChange, ready]);
  const topic = state?.topics?.find(item => item.topic_key === topicKey);
  const disabled = !state?.can_edit || resource.loading || mutation.busy || mutation.pending || Boolean(resource.error);
  const edit = (values: Partial<typeof draft>) => { setSaved(false); setDraft(current => ({ ...current, ...values })); };
  const save = async () => {
    const result = await mutation.send(mutation.pending ? undefined : parsed?.success ? parsed.data : undefined, "PUT");
    if (!result) return;
    setSaved(true); await resource.read(); onSaved?.();
  };
  return <section className="admin-section" aria-label={t("title")} aria-busy={resource.loading || mutation.busy}>
    <header className="admin-section__head"><div><h2>{t("title")}</h2><p>{t("body")}</p></div>
      <button className="admin-button" type="button" disabled={resource.loading || mutation.busy}
        onClick={() => void resource.read()}>{t("refresh")}</button></header>
    <div className="admin-section__body admin-drawer-form">
      {resource.loading && !state ? <p role="status">{t("loading")}</p> : null}
      {state ? <>
        <label>{t("category")}<input value={draft.category} disabled={disabled} maxLength={160}
          onChange={event => edit({ category: event.target.value })} /></label>
        <label>{t("lexicon")}<textarea rows={7} value={draft.terms} disabled={disabled}
          onChange={event => edit({ terms: event.target.value })} /></label>
        <p className="admin-drawer-form__hint">{t("lexiconHelp")}</p>
        <LabelingLexiconSuggestions workspaceId={workspaceId} revision={state.revision} disabled={disabled || draft.category.trim() !== state.category}
          terms={draft.terms.split(/\r?\n/u).map(term => term.trim()).filter(Boolean)} onAccessDenied={onAccessDenied}
          onAccept={term => edit({ terms: [draft.terms.trim(), term].filter(Boolean).join("\n") })} />
        <label>{t("threshold")}<input type="number" min={0} max={1} step={0.01} value={draft.threshold}
          disabled={disabled} onChange={event => edit({ threshold: event.target.value })} /></label>
        <p className="admin-drawer-form__hint">{t("thresholdHelp")}</p>
        <h3>{t("interests")}</h3>
        {draft.interests.length === 0 ? <p>{t("noInterests")}</p> : null}
        {draft.interests.map((interest, index) => <fieldset key={interest.key} disabled={disabled}>
          <legend>{t("interestNumber", { number: index + 1 })}</legend>
          <label><input type="checkbox" checked={interest.active} onChange={event => edit({ interests: draft.interests.map(item =>
            item.key === interest.key ? { ...item, active: event.target.checked } : item) })} />{t("active")}</label>
          <label>{t("interestName")}<input maxLength={160} value={interest.name} onChange={event => edit({ interests: draft.interests.map(item =>
            item.key === interest.key ? { ...item, name: event.target.value } : item) })} /></label>
          <label>{t("interestDefinition")}<textarea rows={3} maxLength={1200} value={interest.definition}
            onChange={event => edit({ interests: draft.interests.map(item => item.key === interest.key
              ? { ...item, definition: event.target.value } : item) })} /></label>
          {!state.interests.some(item => item.key === interest.key) ? <button className="admin-button" type="button"
            onClick={() => edit({ interests: draft.interests.filter(item => item.key !== interest.key) })}>{t("cancelInterest")}</button> : null}
        </fieldset>)}
        <button className="admin-button" type="button" disabled={disabled || draft.interests.length >= 32}
          onClick={() => edit({ interests: [...draft.interests, { key: `interest_${crypto.randomUUID().replaceAll("-", "")}`,
            name: "", definition: "", active: true }] })}>{t("addInterest")}</button>
        <p className="admin-drawer-form__hint">{t("interestHelp")}</p>
        {state.topics?.length ? <details><summary>{t("topicNames")}</summary>
          <label>{t("selectTopic")}<select value={topicKey} disabled={disabled} onChange={event => setTopicKey(event.target.value)}>
            <option value="">{t("chooseTopic")}</option>
            {state.topics.map(item => <option key={item.topic_key} value={item.topic_key}>{draft.names[item.topic_key]?.en ?? item.en}</option>)}
          </select></label>
          {topic ? <>
            <p>{t("originalName")} <strong>{topic.name}</strong></p>
            {(["en", "es"] as const).map(language => <label key={language}>{t(language === "en" ? "englishName" : "spanishName")}
              <input maxLength={160} disabled={disabled} value={draft.names[topicKey]?.[language] ?? topic[language]}
                onChange={event => edit({ names: setLabelingTopicDisplayNameV1(draft.names, topic, language, event.target.value) })} /></label>)}
          </> : null}
        </details> : null}
        <div className="admin-form-actions"><button className="admin-button admin-button--primary" type="button"
          disabled={mutation.busy || resource.loading || !state.can_edit || Boolean(resource.error) || !mutation.pending && !parsed?.success}
          onClick={() => void save()}>{t(mutation.busy ? "saving" : mutation.pending ? "retry" : "save")}</button></div>
        {!state.can_edit ? <p>{t("readOnly")}</p> : null}
      </> : null}
      {saved ? <p className="team-msg team-msg--ok" role="status">{t("saved")}</p> : null}
      {mutation.pending ? <p role="status">{t("pending")}</p> : null}
      {resource.error || mutation.error ? <p className="team-msg team-msg--error" role="alert">{t(
        resource.error === "forbidden" ? "forbidden" : mutation.error?.includes("conflict") ? "conflict" : "error")}</p> : null}
    </div>
  </section>;
}
