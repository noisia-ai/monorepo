"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { SignalListeningMapV1, SignalListeningTopicMentionsV1 } from "@noisia/db";
import { useMfpMutation } from "../brands/useMfpResource";

type Period = { date_from: string | null; date_to: string | null; timezone: string };
/**
 * What the Topics page listed before the brand had a reviewed map. With a
 * reviewed map it stays on the page, folded, as the previous map; without one
 * it is shown as it always was. The page's header and period stay outside.
 */
export function SignalPreviousMap({ folded, children }: { folded: boolean; children: ReactNode }) {
  const t = useTranslations("Listening.map");
  return folded ? <details className="signal-v2-listening__previous"><summary>{t("previousMap")}</summary>{children}</details> : <>{children}</>;
}

/**
 * Signal: the reviewed topic map in two levels. Topics outside the category stay
 * hidden until asked for. A person who may edit topics can open one, take a
 * mention out of it or move it, and fold a topic into another. None of it is
 * needed for the report to work.
 */
export function SignalListeningMap({ workspaceId, period, onAvailable }: { workspaceId: string; period?: Period; onAvailable?: (available: boolean) => void }) {
  const t = useTranslations("Listening.map");
  const language = useLocale().toLowerCase().startsWith("es") ? "es" : "en";
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/listening/map`;
  const [map, setMap] = useState<SignalListeningMapV1 | null>(null);
  const [outside, setOutside] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [mentions, setMentions] = useState<SignalListeningTopicMentionsV1 | null>(null);
  const [destination, setDestination] = useState("");
  const edit = useMfpMutation(`${endpoint}/edits`);

  const start = period?.date_from ?? null, end = period?.date_to ?? null, timezone = period?.timezone ?? null;
  // The map and the mentions of a topic are read for the same period.
  const when = useCallback(() => {
    const query = new URLSearchParams();
    if (start) query.set("start", start);
    if (end) query.set("end", end);
    if (timezone && (start || end)) query.set("tz", timezone);
    return query;
  }, [start, end, timezone]);
  const readMap = useCallback(async (signal?: AbortSignal) => {
    const query = when();
    const response = await fetch(query.size ? `${endpoint}?${query}` : endpoint, { cache: "no-store", signal });
    if (response.ok) setMap(await response.json() as SignalListeningMapV1);
  }, [endpoint, when]);
  const available = Boolean(map?.cycle_id);
  useEffect(() => { onAvailable?.(available); }, [available, onAvailable]);
  const readMentions = useCallback(async (topic: string, signal?: AbortSignal) => {
    const query = when(); query.set("topic", topic);
    const response = await fetch(`${endpoint}/mentions?${query}`, { cache: "no-store", signal });
    setMentions(response.ok ? await response.json() as SignalListeningTopicMentionsV1 : null);
  }, [endpoint, when]);
  useEffect(() => {
    const controller = new AbortController();
    setMap(null); setOpen(null);
    void readMap(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [readMap]);
  useEffect(() => {
    setMentions(null); setDestination("");
    if (!open) return;
    const controller = new AbortController();
    void readMentions(open, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [open, readMentions]);
  const choices = useMemo(() => (map?.themes ?? []).flatMap(theme => theme.topics).map(topic => ({ key: topic.topic_key, name: topic.name[language] }))
    .sort((a, b) => a.name.localeCompare(b.name)), [map, language]);
  // Until a discovery cycle finishes there is no reviewed map to show.
  if (!map?.cycle_id) return null;

  const hidden = map.themes.reduce((sum, theme) => sum + theme.topics.filter(topic => topic.domain === "outside").length, 0);
  const themes = map.themes.map(theme => ({ ...theme, topics: theme.topics.filter(topic => outside || topic.domain !== "outside") })).filter(theme => theme.topics.length);
  const send = (body: Record<string, unknown>, merged = false) => void edit.send(edit.pending ? undefined : body).then(result => {
    if (!result) return;
    if (merged) setOpen(null); else if (open) void readMentions(open).catch(() => undefined);
    void readMap().catch(() => undefined);
  });
  const others = choices.filter(choice => choice.key !== open);

  return <section className="signal-v2-card signal-v2-card--full signal-v2-listening" aria-label={t("title")} aria-busy={edit.busy}>
    <header className="signal-v2-listening__head">
      <div><h3>{t("title")}</h3><p>{t("body", { themes: themes.filter(theme => theme.theme_key !== null).length, topics: themes.reduce((sum, theme) => sum + theme.topics.length, 0) })}</p></div>
      {hidden ? <label className="signal-v2-listening__toggle"><input type="checkbox" checked={outside} onChange={event => setOutside(event.target.checked)} />
        {t("showOutside", { count: hidden })}</label> : null}
    </header>
    {themes.map(theme => <table key={theme.theme_key ?? "none"}>
      <caption>{theme.name ? theme.name[language] : t("noTheme")}</caption>
      <thead><tr><th>{t("topic")}</th><th>{t("scope")}</th><th>{t("mentions")}</th></tr></thead>
      <tbody>{theme.topics.flatMap(topic => [<tr key={topic.topic_key}>
        <th scope="row" title={topic.definition[language]}>
          {map.can_edit ? <button type="button" className="signal-v2-listening__topic" aria-expanded={open === topic.topic_key}
            onClick={() => setOpen(current => current === topic.topic_key ? null : topic.topic_key)}>{topic.name[language]}</button> : topic.name[language]}
          {topic.merged_from.length ? <small> · {t("mergedFrom", { count: topic.merged_from.length })}</small> : null}</th>
        <td>{t(`domain.${topic.domain}`)}</td>
        <td>{topic.mentions.toLocaleString()}{topic.probable_mentions ? <small title={t("probableHelp")}> · {t("probable", { count: topic.probable_mentions.toLocaleString() })}</small> : null}</td></tr>,
      open === topic.topic_key ? <tr key={`${topic.topic_key}:edit`}><td colSpan={3} className="signal-v2-listening__edit">
        <p className="signal-v2-listening__note">{topic.definition[language]}</p>
        <label>{t("destination")}<select value={destination} disabled={edit.busy} onChange={event => setDestination(event.target.value)}>
          <option value="">{t("choose")}</option>{others.map(choice => <option key={choice.key} value={choice.key}>{choice.name}</option>)}</select></label>
        <button type="button" disabled={edit.busy || !destination} onClick={() => send({ operation: "merge_topics", source_topic_key: topic.topic_key, target_topic_key: destination }, true)}>
          {t("merge")}</button>
        {!mentions ? <p role="status">{t("loadingMentions")}</p> : mentions.mentions.length === 0 ? <p>{t("noMentions")}</p> : <ul>
          {mentions.mentions.map(mention => <li key={mention.root_id}>
            <span>{mention.text}</span>{" "}
            {mention.url ? <a href={mention.url} target="_blank" rel="noreferrer noopener">{[mention.platform, mention.published_at?.slice(0, 10)].filter(Boolean).join(" · ") || t("source")}</a> : null}
            {mention.by_person ? <small> · {t("byPerson")}</small> : null}{" "}
            <button type="button" disabled={edit.busy} onClick={() => send({ operation: "remove_label", topic_key: topic.topic_key, root_id: mention.root_id })}>{t("remove")}</button>{" "}
            <button type="button" disabled={edit.busy || !destination}
              onClick={() => send({ operation: "move_label", root_id: mention.root_id, from_topic_key: topic.topic_key, to_topic_key: destination })}>{t("move")}</button>
          </li>)}</ul>}
        {mentions && mentions.total > mentions.mentions.length ? <p className="signal-v2-listening__note">{t("showing", { shown: mentions.mentions.length, total: mentions.total.toLocaleString() })}</p> : null}
        {edit.error ? <p role="alert">{t("editError")}</p> : null}
      </td></tr> : null])}</tbody>
    </table>)}
  </section>;
}
