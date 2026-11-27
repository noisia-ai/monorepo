"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { SignalListeningStateV1 } from "@noisia/db";
import { listeningKeyFromLabelV1, listeningQuestionInputSchemaV1, type ListeningQuestionInputV1 } from "@/lib/data-os/signal-listening-api";
import { useMfpMutation, useMfpResource } from "./useMfpResource";

type Estimate = { roots: number; requests: number; estimated_micro_usd: number;
  questions: Array<{ label: string; scope: string; roots: number; pending: number }> };
type State = SignalListeningStateV1 & { estimate: Estimate };
type DraftOption = { id: string; key: string; name: string; definition: string };
type DraftQuestion = { id: string; key: string; text: string; scope: "all" | "consumer_category"; active: boolean; options: DraftOption[] };

const uid = () => crypto.randomUUID();
const toDraft = (questions: State["configuration"]["questions"]): DraftQuestion[] => questions.map(question => ({ id: uid(), key: question.key,
  text: question.text, scope: question.scope, active: question.active,
  options: question.options.map(option => ({ id: uid(), key: option.key, name: option.key, definition: option.definition })) }));
/** Keys of saved items never change, so their answers stay in the cache. New items get a key from their text. */
function toInput(draft: DraftQuestion[]): ListeningQuestionInputV1[] | null {
  const taken = new Set(draft.map(question => question.key).filter(Boolean));
  const questions = draft.map(question => {
    const optionKeys = new Set(question.options.map(option => option.key).filter(Boolean));
    const key = question.key || listeningKeyFromLabelV1(question.text, taken); taken.add(key);
    return { key, text: question.text.trim(), scope: question.scope, active: question.active, origin: "brand_os" as const, human_locked: true,
      options: question.options.map(option => {
        const optionKey = option.key || listeningKeyFromLabelV1(option.name, optionKeys); optionKeys.add(optionKey);
        return { key: optionKey, definition: option.definition.trim() };
      }) };
  });
  return questions.every(question => listeningQuestionInputSchemaV1.safeParse(question).success) ? questions : null;
}
const comparable = (questions: ListeningQuestionInputV1[] | null) => JSON.stringify(questions?.map(question => ({ key: question.key, text: question.text,
  scope: question.scope, active: question.active, options: [...question.options].sort((a, b) => a.key.localeCompare(b.key)) }))
  .sort((a, b) => a.key.localeCompare(b.key)) ?? null);

/** Brand OS: the questions with options this brand asks of its listening, and the button that asks what is pending. */
export function ListeningQuestions({ workspaceId, onAccessDenied }: { workspaceId: string; onAccessDenied?: () => void }) {
  const t = useTranslations("Listening");
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/listening`;
  const resource = useMfpResource<State>(endpoint, "signal-listening-state-v1", undefined, true);
  const save = useMfpMutation(endpoint, onAccessDenied), run = useMfpMutation(endpoint, onAccessDenied);
  const state = resource.data?.workspace_id === workspaceId ? resource.data : null;
  const [draft, setDraft] = useState<DraftQuestion[]>([]);
  const [cap, setCap] = useState("");
  useEffect(() => { if (state) setDraft(toDraft(state.configuration.questions)); }, [state?.revision, state?.workspace_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestedCap = state ? Math.max(0.1, Math.ceil(state.estimate.estimated_micro_usd / 1e6 * 2 * 100) / 100) : 0;
  useEffect(() => { setCap(suggestedCap ? suggestedCap.toFixed(2) : ""); }, [suggestedCap]);
  const input = useMemo(() => toInput(draft), [draft]);
  if (!state) return resource.loading ? <p role="status">{t("loading")}</p> : null;

  const stored = comparable(state.configuration.questions.map(question => ({ ...question })));
  const dirty = comparable(input) !== stored;
  const active = ["queued", "running"].includes(state.run?.status ?? "");
  const disabled = !state.can_edit || save.busy || active;
  const pending = state.estimate.questions.reduce((sum, question) => sum + question.pending, 0);
  const capValue = Number(cap);
  const edit = (id: string, change: Partial<DraftQuestion>) => setDraft(current => current.map(question => question.id === id ? { ...question, ...change } : question));
  const editOption = (questionId: string, optionId: string, change: Partial<DraftOption>) => setDraft(current => current.map(question => question.id !== questionId ? question
    : { ...question, options: question.options.map(option => option.id === optionId ? { ...option, ...change } : option) }));
  const label = (value: string) => value.startsWith("question:") ? draft.find(question => question.key === value.slice(9))?.text ?? value.slice(9)
    : value.startsWith("interest:") ? state.configuration.defined_topics.find(topic => topic.key === value.slice(9))?.name ?? value.slice(9)
    : t(value === "voice" ? "baseVoice" : "basePromotion");

  return <section className="admin-section" aria-label={t("title")} aria-busy={resource.loading || save.busy || run.busy}>
    <header className="admin-section__head"><div><h2>{t("title")}</h2><p>{t("body")}</p></div>
      <button className="admin-button" type="button" disabled={resource.loading} onClick={() => void resource.read()}>{t("refresh")}</button></header>
    <div className="admin-section__body admin-drawer-form">
      <p className="admin-drawer-form__hint">{t("baseHelp", { topics: state.configuration.defined_topics.filter(topic => topic.active).length })}</p>
      {draft.length === 0 ? <p>{t("empty")}</p> : null}
      {draft.map((question, index) => <fieldset key={question.id} disabled={disabled}>
        <legend>{t("questionNumber", { number: index + 1 })}</legend>
        <label>{t("questionText")}<textarea rows={2} maxLength={600} value={question.text} onChange={event => edit(question.id, { text: event.target.value })} /></label>
        <label>{t("scope")}<select value={question.scope} onChange={event => edit(question.id, { scope: event.target.value as DraftQuestion["scope"] })}>
          <option value="consumer_category">{t("scopeConsumer")}</option><option value="all">{t("scopeAll")}</option></select></label>
        <label><input type="checkbox" checked={question.active} onChange={event => edit(question.id, { active: event.target.checked })} />{t("active")}</label>
        {question.options.map(option => <div key={option.id} className="admin-form-actions">
          <label>{t("optionName")}<input maxLength={48} value={option.name} disabled={Boolean(option.key)} onChange={event => editOption(question.id, option.id, { name: event.target.value })} /></label>
          <label>{t("optionDefinition")}<input maxLength={600} value={option.definition} onChange={event => editOption(question.id, option.id, { definition: event.target.value })} /></label>
          <button className="admin-button" type="button" disabled={question.options.length <= 2}
            onClick={() => edit(question.id, { options: question.options.filter(item => item.id !== option.id) })}>{t("removeOption")}</button>
        </div>)}
        <div className="admin-form-actions">
          <button className="admin-button" type="button" disabled={question.options.length >= 12}
            onClick={() => edit(question.id, { options: [...question.options, { id: uid(), key: "", name: "", definition: "" }] })}>{t("addOption")}</button>
          <button className="admin-button" type="button" onClick={() => setDraft(current => current.filter(item => item.id !== question.id))}>{t("removeQuestion")}</button>
        </div>
      </fieldset>)}
      <div className="admin-form-actions">
        <button className="admin-button" type="button" disabled={disabled || draft.length >= 16} onClick={() => setDraft(current => [...current, { id: uid(), key: "", text: "",
          scope: "consumer_category", active: true, options: [{ id: uid(), key: "", name: "", definition: "" }, { id: uid(), key: "", name: "", definition: "" }] }])}>{t("addQuestion")}</button>
        <button className="admin-button admin-button--primary" type="button" disabled={disabled || !dirty || !input}
          onClick={() => void save.send({ expected_revision: state.revision, questions: input ?? [] }, "PUT").then(result => { if (result) void resource.read(); })}>
          {t(save.busy ? "saving" : "save")}</button>
      </div>
      {dirty && !input ? <p className="team-msg team-msg--error" role="alert">{t("invalid")}</p> : null}
      {save.error ? <p className="team-msg team-msg--error" role="alert">{t("saveError")}</p> : null}

      <h3>{t("updateTitle")}</h3>
      <p className="admin-drawer-form__hint">{t("updateHelp")}</p>
      {state.population ? <table><thead><tr><th>{t("colQuestion")}</th><th>{t("colScope")}</th><th>{t("colRoots")}</th><th>{t("colPending")}</th></tr></thead>
        <tbody>{state.estimate.questions.map(question => <tr key={question.label}><td>{label(question.label)}</td>
          <td>{t(question.scope === "all" ? "scopeAllShort" : "scopeConsumerShort")}</td><td>{question.roots.toLocaleString()}</td>
          <td>{question.pending.toLocaleString()}</td></tr>)}</tbody></table> : <p>{t("noPopulation")}</p>}
      {state.unsaved_settings ? <p className="admin-drawer-form__hint">{t("settingsChanged")}</p> : null}
      {state.can_run && state.population ? <div className="admin-form-actions">
        <label>{t("cap")}<input type="number" min={0.01} max={200} step={0.01} value={cap} disabled={active || run.busy} onChange={event => setCap(event.target.value)} /></label>
        <button className="admin-button admin-button--primary" type="button"
          disabled={active || run.busy || dirty || pending === 0 || !Number.isFinite(capValue) || capValue < 0.01 || capValue > 200}
          onClick={() => void run.send({ cap_micro_usd: Math.round(capValue * 1e6) }).then(result => { if (result) void resource.read(); })}>
          {t(active ? "running" : "update", { cost: (state.estimate.estimated_micro_usd / 1e6).toFixed(2) })}</button>
      </div> : null}
      {pending === 0 && state.population ? <p role="status">{t("nothingPending")}</p> : null}
      {run.error ? <p className="team-msg team-msg--error" role="alert">{t("runError")}</p> : null}
      {state.run ? <p role="status">{t(`run.${state.run.status}`, { done: state.run.roots_done.toLocaleString(),
        cost: (state.run.spent_micro_usd / 1e6).toFixed(2) })}</p> : null}
    </div>
  </section>;
}
