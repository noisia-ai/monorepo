"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { SignalListeningQuestionMetricsV1, SignalListeningStateV1 } from "@noisia/db";

type Metrics = SignalListeningQuestionMetricsV1 & { contract_version: "signal-listening-metrics-v1" };
const share = (part: number, total: number) => total ? `${Math.round(part / total * 1000) / 10}%` : "—";

/** Signal: a generic view of any question with options. Distribution, cross with topics and monthly trend. */
export function SignalListeningMetrics({ workspaceId, topicNames = {} }: { workspaceId: string; topicNames?: Record<string, string> }) {
  const t = useTranslations("Listening.metrics");
  const base = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/listening`;
  const [questions, setQuestions] = useState<SignalListeningStateV1["configuration"]["questions"]>([]);
  const [selected, setSelected] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setQuestions([]); setSelected(""); setMetrics(null);
    void fetch(base, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const state = await response.json() as SignalListeningStateV1;
      const active = state.configuration.questions.filter(question => question.active);
      setQuestions(active); setSelected(active[0]?.key ?? "");
    }).catch(() => undefined);
    return () => controller.abort();
  }, [base]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setMetrics(null); setFailed(false);
    void fetch(`${base}/metrics?question=${encodeURIComponent(selected)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) { setFailed(true); return; }
      setMetrics(await response.json() as Metrics);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [base, selected]);

  const question = questions.find(item => item.key === selected);
  const options = useMemo(() => question?.options.map(option => option.key) ?? [], [question]);
  const topics = useMemo(() => {
    const rows = new Map<string, Record<string, number>>();
    for (const row of metrics?.by_topic ?? []) rows.set(row.topic_key, { ...rows.get(row.topic_key), [row.option]: row.roots });
    return [...rows].map(([topic_key, counts]) => ({ topic_key, counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) }))
      .sort((a, b) => b.total - a.total).slice(0, 12);
  }, [metrics]);
  const periods = useMemo(() => {
    const rows = new Map<string, Record<string, number>>();
    for (const row of metrics?.trend ?? []) rows.set(row.period, { ...rows.get(row.period), [row.option]: row.roots });
    return [...rows].map(([period, counts]) => ({ period, counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) }))
      .sort((a, b) => a.period.localeCompare(b.period)).slice(-18);
  }, [metrics]);
  // Nothing to show until the brand defines a question: the widget stays out of the way.
  if (!questions.length) return null;

  return <section className="signal-v2-card signal-v2-card--full signal-v2-listening" aria-label={t("title")}>
    <header className="signal-v2-listening__head">
      <div><h3>{t("title")}</h3><p>{t("body")}</p></div>
      <label>{t("question")}<select value={selected} onChange={event => setSelected(event.target.value)}>
        {questions.map(item => <option key={item.key} value={item.key}>{item.text}</option>)}</select></label>
    </header>
    {failed ? <p role="alert">{t("unavailable")}</p> : !metrics ? <p role="status">{t("loading")}</p> : metrics.answered === 0 ? <p>{t("empty")}</p> : <>
      <p className="signal-v2-listening__note">{t(question?.scope === "all" ? "scopeAll" : "scopeConsumer", { count: metrics.answered.toLocaleString() })}</p>
      <table><caption>{t("distribution")}</caption>
        <thead><tr><th>{t("option")}</th><th>{t("mentions")}</th><th>{t("share")}</th></tr></thead>
        <tbody>{metrics.distribution.map(row => <tr key={row.option}><th scope="row">{row.option}</th>
          <td>{row.roots.toLocaleString()}</td><td>{share(row.roots, metrics.answered)}</td></tr>)}</tbody></table>
      {topics.length ? <table><caption>{t("byTopic")}</caption>
        <thead><tr><th>{t("topic")}</th>{options.map(option => <th key={option}>{option}</th>)}</tr></thead>
        <tbody>{topics.map(row => <tr key={row.topic_key}><th scope="row">{topicNames[row.topic_key] ?? row.topic_key.replaceAll("_", " ")}</th>
          {options.map(option => <td key={option}>{share(row.counts[option] ?? 0, row.total)}</td>)}</tr>)}</tbody></table> : null}
      {periods.length > 1 ? <table><caption>{t("trend")}</caption>
        <thead><tr><th>{t("period")}</th>{options.map(option => <th key={option}>{option}</th>)}</tr></thead>
        <tbody>{periods.map(row => <tr key={row.period}><th scope="row">{row.period}</th>
          {options.map(option => <td key={option}>{share(row.counts[option] ?? 0, row.total)}</td>)}</tr>)}</tbody></table> : null}
    </>}
  </section>;
}
