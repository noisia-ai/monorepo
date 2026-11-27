"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { SignalListeningMapV1 } from "@noisia/db";

/** Signal: the reviewed topic map in two levels. Topics outside the category stay hidden until asked for. */
export function SignalListeningMap({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("Listening.map");
  const language = useLocale().toLowerCase().startsWith("es") ? "es" : "en";
  const [map, setMap] = useState<SignalListeningMapV1 | null>(null);
  const [outside, setOutside] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setMap(null);
    void fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/listening/map`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (response.ok) setMap(await response.json() as SignalListeningMapV1);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId]);
  // Until a discovery cycle finishes there is no reviewed map to show.
  if (!map?.cycle_id) return null;

  const hidden = map.themes.reduce((sum, theme) => sum + theme.topics.filter(topic => topic.domain === "outside").length, 0);
  const themes = map.themes.map(theme => ({ ...theme, topics: theme.topics.filter(topic => outside || topic.domain !== "outside") })).filter(theme => theme.topics.length);
  return <section className="signal-v2-card signal-v2-card--full signal-v2-listening" aria-label={t("title")}>
    <header className="signal-v2-listening__head">
      <div><h3>{t("title")}</h3><p>{t("body", { themes: themes.filter(theme => theme.theme_key !== null).length, topics: themes.reduce((sum, theme) => sum + theme.topics.length, 0) })}</p></div>
      {hidden ? <label className="signal-v2-listening__toggle"><input type="checkbox" checked={outside} onChange={event => setOutside(event.target.checked)} />
        {t("showOutside", { count: hidden })}</label> : null}
    </header>
    {themes.map(theme => <table key={theme.theme_key ?? "none"}>
      <caption>{theme.name ? theme.name[language] : t("noTheme")}</caption>
      <thead><tr><th>{t("topic")}</th><th>{t("scope")}</th><th>{t("mentions")}</th></tr></thead>
      <tbody>{theme.topics.map(topic => <tr key={topic.topic_key}>
        <th scope="row" title={topic.definition[language]}>{topic.name[language]}</th>
        <td>{t(`domain.${topic.domain}`)}</td><td>{topic.mentions.toLocaleString()}</td></tr>)}</tbody>
    </table>)}
  </section>;
}
