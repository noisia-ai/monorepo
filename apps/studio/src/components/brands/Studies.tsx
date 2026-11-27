"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { studyCreateInputSchemaV1, studyNamesFromTextV1 } from "@/lib/data-os/signal-study-api";
import { useMfpMutation, useMfpResource } from "./useMfpResource";

type Wording = { name: string; definition: string };
type StudyRow = { id: string; name: string; status: "queued" | "running" | "completed" | "failed" | "canceled"; step: string; spent_micro_usd: number;
  cap_micro_usd: number; created_at: string; error_code: string | null; methodology_key: string; output: StudyOutput | null };
type StudyOutput = { status: string; cut: { mentions: number; corpus_mentions: number };
  directed: { mentions: number; about_the_subject: number; with_a_motive: number; without_a_motive: number };
  layer_stability: { kappa: number | null } | null;
  layers: Array<{ layer: string; permission: string; motives: number; mentions: number; share_of_directed: number }>;
  motives: Array<{ motive_key: string; wording: { original: Wording; en: Wording; es: Wording }; layer: string; permission: string; mentions: number;
    share_of_directed: number; mentions_with_trigger_signal: number; mentions_with_barrier_signal: number; mentions_with_tension: number;
    verbatims: Array<{ quote: string; url: string; platform: string | null; published_at: string | null }> }> };
type List = { contract_version: "signal-studies-v1"; workspace_id: string; can_edit: boolean; can_run: boolean; studies: StudyRow[];
  promotions: Array<{ motive_key: string; defined_topic_key: string }>; latest?: { status: string } | null };
const KINDS = ["category", "own_brand", "alternative"] as const;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

/** Brand OS: the studies of this brand. A study applies a methodology to a cut of the same corpus the report listens to. */
export function Studies({ workspaceId, onAccessDenied, onPromoted }: { workspaceId: string; onAccessDenied?: () => void; onPromoted?: () => void }) {
  const t = useTranslations("Studies");
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/studies`;
  const resource = useMfpResource<List>(endpoint, "signal-studies-v1", undefined, true);
  const create = useMfpMutation(endpoint, onAccessDenied);
  const [form, setForm] = useState({ name: "", kind: "category" as typeof KINDS[number], subject: "", category: "", own_brand: "", competitors: "", alternatives: "",
    conventional_category: "", cap: "6.00" });
  const [open, setOpen] = useState<string | null>(null);
  const list = resource.data?.workspace_id === workspaceId ? resource.data : null;
  const input = useMemo(() => {
    const parsed = studyCreateInputSchemaV1.omit({ idempotency_key: true }).safeParse({ name: form.name, cap_micro_usd: Math.round(Number(form.cap) * 1e6),
      subject: { kind: form.kind, name: form.subject, category: form.category, own_brand: form.own_brand, competitors: studyNamesFromTextV1(form.competitors),
        alternatives: studyNamesFromTextV1(form.alternatives), ...(form.kind === "alternative" ? { conventional_category: form.conventional_category } : {}) } });
    return parsed.success ? parsed.data : null;
  }, [form]);
  if (!list) return resource.loading ? <p role="status">{t("loading")}</p>
    // The feature being off answers 404 and shows nothing; any other failure is said out loud.
    : resource.error && resource.error !== "forbidden" && resource.error !== "listening_not_enabled" ? <p className="team-msg team-msg--error" role="alert">{t("unavailable")}</p> : null;
  const field = (name: keyof typeof form, max: number) => <label>{t(`form.${name}`)}
    <input maxLength={max} value={form[name]} disabled={create.busy} onChange={event => setForm(current => ({ ...current, [name]: event.target.value }))} /></label>;
  const names = (name: "competitors" | "alternatives") => <label>{t(`form.${name}`)}
    <textarea rows={2} maxLength={1800} value={form[name]} disabled={create.busy} onChange={event => setForm(current => ({ ...current, [name]: event.target.value }))} /></label>;

  return <section className="admin-section" aria-label={t("title")} aria-busy={resource.loading || create.busy}>
    <header className="admin-section__head"><div><h2>{t("title")}</h2><p>{t("body")}</p></div>
      <button className="admin-button" type="button" disabled={resource.loading} onClick={() => void resource.read()}>{t("refresh")}</button></header>
    <div className="admin-section__body admin-drawer-form">
      {list.studies.length === 0 ? <p>{t("empty")}</p> : <table>
        <thead><tr><th>{t("col.name")}</th><th>{t("col.status")}</th><th>{t("col.cost")}</th><th>{t("col.created")}</th><th /></tr></thead>
        <tbody>{list.studies.map(study => <tr key={study.id}>
          <td>{study.name}</td>
          <td>{t(`status.${study.status}`)}{study.status === "running" ? ` · ${t(`step.${study.step}`)}` : ""}</td>
          <td>{`USD ${(study.spent_micro_usd / 1e6).toFixed(2)} / ${(study.cap_micro_usd / 1e6).toFixed(2)}`}</td>
          <td>{study.created_at.slice(0, 10)}</td>
          <td><button className="admin-button" type="button" disabled={study.status !== "completed"} aria-expanded={open === study.id}
            onClick={() => setOpen(current => current === study.id ? null : study.id)}>{t(open === study.id ? "close" : "open")}</button></td>
        </tr>)}</tbody></table>}
      {open ? <StudyReport key={open} endpoint={`${endpoint}/${open}`} canPromote={list.can_edit} onAccessDenied={onAccessDenied} onPromoted={onPromoted} /> : null}

      {list.can_run ? <fieldset disabled={create.busy}>
        <legend>{t("form.title")}</legend>
        <p className="admin-drawer-form__hint">{t("form.help")}</p>
        {field("name", 200)}
        <label>{t("form.kind")}<select value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as typeof KINDS[number] }))}>
          {KINDS.map(kind => <option key={kind} value={kind}>{t(`kind.${kind}`)}</option>)}</select></label>
        {field("subject", 240)}{field("category", 240)}{field("own_brand", 240)}
        {form.kind === "alternative" ? field("conventional_category", 240) : null}
        {names("competitors")}{names("alternatives")}
        <div className="admin-form-actions">
          <label>{t("form.cap")}<input type="number" min={6} max={200} step={0.5} value={form.cap} onChange={event => setForm(current => ({ ...current, cap: event.target.value }))} /></label>
          <button className="admin-button admin-button--primary" type="button" disabled={create.busy || !create.pending && !input}
            onClick={() => void create.send(create.pending ? undefined : input ?? undefined).then(result => { if (result) void resource.read(); })}>
            {t(create.busy ? "form.creating" : create.pending ? "form.retry" : "form.create")}</button>
        </div>
        {create.error ? <p className="team-msg team-msg--error" role="alert">{t("form.error")}</p> : null}
      </fieldset> : null}
    </div>
  </section>;
}

/** The directional result of one finished study, and the explicit action that carries motives to the report. */
function StudyReport({ endpoint, canPromote, onAccessDenied, onPromoted }: { endpoint: string; canPromote: boolean; onAccessDenied?: () => void; onPromoted?: () => void }) {
  const t = useTranslations("Studies");
  const language = useLocale().toLowerCase().startsWith("es") ? "es" : "en";
  const resource = useMfpResource<List>(endpoint, "signal-studies-v1");
  const promote = useMfpMutation(`${endpoint}/promotions`, onAccessDenied);
  const [chosen, setChosen] = useState<string[]>([]);
  const study = resource.data?.studies[0], output = study?.output;
  if (!study || !output) return <p role={resource.error ? "alert" : "status"}>{t(resource.error ? "unavailable" : "loading")}</p>;
  const promoted = new Set(resource.data!.promotions.map(item => item.motive_key));
  const toggle = (key: string) => setChosen(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);

  return <div className="admin-drawer-form" aria-label={study.name}>
    <h3>{study.name}</h3>
    <p className="team-msg" role="note">{t("directional")}</p>
    <p className="admin-drawer-form__hint">{t("summary", { cut: output.cut.mentions.toLocaleString(), corpus: output.cut.corpus_mentions.toLocaleString(),
      directed: output.directed.about_the_subject.toLocaleString(), withMotive: output.directed.with_a_motive.toLocaleString(),
      kappa: output.layer_stability?.kappa == null ? "—" : output.layer_stability.kappa.toFixed(2) })}</p>
    <table><caption>{t("layersTitle")}</caption>
      <thead><tr><th>{t("col.layer")}</th><th>{t("col.permission")}</th><th>{t("col.motives")}</th><th>{t("col.mentions")}</th><th>{t("col.share")}</th></tr></thead>
      <tbody>{output.layers.map(layer => <tr key={layer.layer}><td>{t(`layer.${layer.layer}`)}</td><td>{t(`permission.${layer.permission}`)}</td>
        <td>{layer.motives}</td><td>{layer.mentions.toLocaleString()}</td><td>{percent(layer.share_of_directed)}</td></tr>)}</tbody></table>
    <table><caption>{t("motivesTitle")}</caption>
      <thead><tr>{canPromote ? <th /> : null}<th>{t("col.motive")}</th><th>{t("col.layer")}</th><th>{t("col.mentions")}</th><th>{t("col.trigger")}</th>
        <th>{t("col.barrier")}</th><th>{t("col.tension")}</th></tr></thead>
      <tbody>{output.motives.map(motive => <tr key={motive.motive_key}>
        {canPromote ? <td><input type="checkbox" aria-label={t("choose", { name: motive.wording[language].name })} disabled={promoted.has(motive.motive_key) || promote.busy}
          checked={promoted.has(motive.motive_key) || chosen.includes(motive.motive_key)} onChange={() => toggle(motive.motive_key)} /></td> : null}
        <td><details><summary>{motive.wording[language].name}</summary><p>{motive.wording[language].definition}</p>
          {motive.verbatims.map(item => <blockquote key={item.url + item.quote}>{item.quote} <a href={item.url} target="_blank" rel="noreferrer noopener">
            {[item.platform, item.published_at?.slice(0, 10)].filter(Boolean).join(" · ") || t("source")}</a></blockquote>)}</details></td>
        <td>{t(`layer.${motive.layer}`)}</td><td>{`${motive.mentions.toLocaleString()} (${percent(motive.share_of_directed)})`}</td>
        <td>{motive.mentions_with_trigger_signal.toLocaleString()}</td><td>{motive.mentions_with_barrier_signal.toLocaleString()}</td>
        <td>{motive.mentions_with_tension.toLocaleString()}</td></tr>)}</tbody></table>
    {canPromote ? <div className="admin-form-actions">
      <p className="admin-drawer-form__hint">{t("promoteHelp")}</p>
      <button className="admin-button admin-button--primary" type="button" disabled={promote.busy || !promote.pending && chosen.length === 0}
        onClick={() => void promote.send(promote.pending ? undefined : { motive_keys: chosen }).then(result => { if (result) { setChosen([]); void resource.read(); onPromoted?.(); } })}>
        {t(promote.busy ? "promoting" : promote.pending ? "form.retry" : "promote", { count: chosen.length })}</button>
    </div> : null}
    {promote.error ? <p className="team-msg team-msg--error" role="alert">{t("promoteError")}</p> : null}
  </div>;
}
