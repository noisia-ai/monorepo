import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";
import { SignalV2WorkspaceTopics, SignalWorkspaceTopicDisposition, nativeTopicsVolumeChartV1 } from "../../components/signal-v2/SignalV2WorkspaceTopics";
import { SignalTopicsRankingCard, SignalTopicsRankingList } from "../../components/signal-v2/SignalTopicsPrimitives";
import { buildSignalTopicSentimentOption, buildSignalTopicTrendOption } from "../../components/signal-v2/SignalTopicChartOptions";
Object.assign(globalThis, { React });
const data: SignalWorkspaceTopicsOverviewV1 = {
  contract_version: "signal-workspace-topics-serving-v1", source: "workspace_computed", workspace_id: "workspace", corpus_id: null,
  scope: "all_conversations", generation_id: "generation", source_engine_execution_id: "engine", is_current: true, is_processing: false, selection_revision: 3,
  filters: { date_from: null, date_to: null }, available_dates: { date_from: "2026-09-01", date_to: "2026-09-08" },
  scope_digest: "sha256:scope", observed_at: "2026-09-08T00:00:00.000000Z", denominator: 10,
  coverage: { processed: 10, assigned_unique: 8, abstained: 1, unresolved: 1, withheld: 2 }, interpretation_coverage: { interpreted_unit_count: 32, expected_unit_count: 357, complete: false }, quality: "not_calibrated",
  terms: ["Delivery", "Support"].map((label, index) => ({ term_key: `topic${index}`, label, definition: `${label} experiences`,
    definition_revision: 1, definition_digest: "sha256:def", selected: true, mention_count: 7, share_of_corpus: 0.7, basis: "computed_cluster" })),
  series: [], limitations: ["computed_memberships_not_semantic_precision"]
};
async function render(locale: string, payload = data, surface: "summary" | "topics" = "topics", refreshFailed = false) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
    createElement(SignalV2WorkspaceTopics, { brandName: "Alexa Plus", data: payload, loading: false, surface, refreshFailed,
      onRefresh: async () => true, onOpenTopics: () => undefined, onOpenMentions: () => undefined,
      manageTopicsHref: "/studio/brands/brand/topics", onApplyFilter: async () => true, workspaceTimezone: "America/Mexico_City" })));
}
test("native Signal renders computed multilabel counts without claiming calibrated quality or a study corpus", async () => {
  const html = await render("es-MX");
  assert.match(html, /Pertenencia calculada/); assert.match(html, /no está calibrada/);
  assert.match(html, /sumar más de 100%/); assert.match(html, /Delivery/); assert.match(html, /Support/);
  assert.match(html, /En Topics seleccionados/); assert.match(html, /Zona horaria del workspace: America\/Mexico_City/);
  assert.match(html, /Datos: Alexa Plus/);
  assert.doesNotMatch(html, /Precisión:|studio\/corpora|Investigar insights/);
  assert.ok(html.indexOf("Topics seleccionados") < html.indexOf("Pertenencia calculada"));
});
test("empty completed catalogue is actionable without creating synthetic Topics or narratives", async () => {
  const html = await render("en-US", { ...data, terms: [] });
  assert.match(html, /No Topics selected/); assert.match(html, /Manage Topics/);
  assert.match(html, /Narratives and insights are not yet available/); assert.doesNotMatch(html, /topic0|topic1/);
});
test("stale generation preserves counts while disabling stale evidence access", async () => {
  const html = await render("en-US", { ...data, is_current: false });
  assert.match(html, /Previous result/); assert.match(html, /last complete result is retained/);
  const evidenceButton = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*View evidence<\/button>/)?.[0];
  assert.ok(evidenceButton); assert.match(evidenceButton, /disabled=""/);
});

for (const locale of ["es-MX", "en-US"]) {
  test(`${locale}: native summary and Topics share partial unit coverage, overlapping root counts and citations`, async () => {
    const summary = await render(locale, data, "summary"), topics = await render(locale);
    const expected = locale === "es-MX" ? "Interpretación parcial: 32 de 357" : "Partial interpretation: 32 of 357";
    for (const html of [summary, topics]) {
      assert.ok(html.includes(expected)); assert.match(html, /Delivery|Support/);
      assert.ok(html.includes(locale === "es-MX" ? "conteos pueden superponerse" : "counts can overlap"));
      assert.match(html, /<strong>10<\/strong>/); assert.match(html, /<strong>8<\/strong>/);
      assert.doesNotMatch(html, /Precisión:|precision:|1,000|1000/);
    }
    assert.ok(summary.includes(locale === "es-MX" ? "Resumen" : "Overview"));
    assert.ok(summary.includes(locale === "es-MX" ? "Ver todos los Topics" : "View all Topics"));
  });
  test(`${locale}: refresh remains available before dated projection and complete/unknown coverage stays honest`, async () => {
    const pending = await render(locale, { ...data, terms: [], generation_id: null, interpretation_coverage: null,
      is_current: false, is_processing: true, available_dates: { date_from: null, date_to: null } }, "summary");
    assert.ok(pending.includes(locale === "es-MX" ? "Preparando el resultado" : "Preparing the Topics result"));
    assert.ok(pending.includes(locale === "es-MX" ? ">Actualizar</button>" : ">Refresh</button>"));
    assert.doesNotMatch(pending, /32[^]*357/);
    const complete = await render(locale, { ...data, interpretation_coverage: { interpreted_unit_count: 357, expected_unit_count: 357, complete: true } });
    assert.ok(complete.includes(locale === "es-MX" ? "Interpretación completa" : "Interpretation is complete"));
    const unknown = await render(locale, { ...data, interpretation_coverage: null });
    assert.ok(unknown.includes(locale === "es-MX" ? "avance de interpretación" : "Interpretation progress"));
    assert.doesNotMatch(unknown, /32[^]*357/);
  });
}

test("failed refresh remains visible in native summary while preserving counts and manual recovery", async () => {
  for (const locale of ["es-MX", "en-US"]) {
    const html = await render(locale, data, "summary", true);
    assert.match(html, /role="alert"/);
    assert.ok(html.includes(locale === "es-MX" ? "No se pudo actualizar" : "could not be refreshed"));
    assert.match(html, /<strong>10<\/strong>/); assert.match(html, /Delivery/);
    assert.ok(html.includes(locale === "es-MX" ? ">Actualizar</button>" : ">Refresh</button>"));
  }
});

for (const locale of ["es-MX", "en-US"]) {
  test(`${locale}: native Topics reuse ranking and detail with unavailable editorial dimensions instead of invented zeroes`, async () => {
    const html = await render(locale);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
    assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
    assert.ok(html.includes(locale === "es-MX" ? "Noise<span>No disponible</span>" : "Noise<span>Unavailable</span>"));
    assert.ok(html.includes(locale === "es-MX" ? "Narrativas<span>No disponible</span>" : "Narratives<span>Unavailable</span>"));
    assert.match(html, /signal-v2-tn__ranking-metrics--native/);
    assert.match(html, /signal-v2-tn__definition/);
    assert.ok(html.includes(locale === "es-MX" ? "Presencia de este Topic" : "This Topic over time"));
    assert.ok(html.includes(locale === "es-MX" ? "Versión de la definición" : "Definition version"));
    assert.doesNotMatch(html, /claude|voyage|sha256:|input_tokens|workspace_computed|Investigar insights|Research insights/i);
  });
  for (const section of ["narratives", "noise", "unresolved"] as const) {
    test(`${locale}: ${section} explains only the dimension the native contract proves`, async () => {
      const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
        { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
        createElement(SignalWorkspaceTopicDisposition, { section, data })));
      assert.match(html, new RegExp(`data-availability="${section === "unresolved" ? "available" : "not_available"}"`));
      assert.doesNotMatch(html, /Delivery|Support|<button|<strong>0<\/strong>/);
      if (section === "noise") assert.ok(html.includes(locale === "es-MX" ? "no equivale" : "is not an editorial"));
      if (section === "unresolved") { assert.match(html, /<strong>1<\/strong>/); assert.ok(html.includes(locale === "es-MX" ? "superponerse" : "overlap")); }
    });
  }
}

test("the shared ranking retains governed comparison and renders true zero volumes without synthetic minimum bars", () => {
  const html = renderToStaticMarkup(createElement(SignalTopicsRankingList, {
    entries: [{ key: "zero", label: "No evidence", count: 0, formattedCount: "0", share: "0%", change: createElement("span", { className: "signal-v2-tn__delta" }, "—") }],
    labels: { term: "Topic", count: "Mentions", share: "Share", change: "Change" }, selectedKey: "zero", onSelect: () => undefined
  }));
  assert.match(html, /width:0%/); assert.match(html, /<span>Change<\/span>/); assert.match(html, /signal-v2-tn__delta/);
  assert.match(html, /aria-pressed="true"/); assert.doesNotMatch(html, /ranking-metrics--native/);
});

test("the shared ranking card preserves the Laika view switch for native catalogues", () => {
  const html = renderToStaticMarkup(createElement(SignalTopicsRankingCard, {
    activeView: "list", eyebrow: "Presence", title: "Selected Topics", viewLabel: "Topics view",
    views: [{ key: "chart", label: "Chart" }, { key: "list", label: "List" }], onViewChange: () => undefined
  }, createElement("p", null, "Real catalogue")));
  assert.match(html, /signal-v2-tn__ranking/); assert.match(html, /aria-label="Topics view"/);
  assert.match(html, /aria-pressed="true"[^>]*>List/); assert.match(html, /Real catalogue/);
});

test("shared Laika chart primitives preserve real values for governed and native Topics", () => {
  const trend = buildSignalTopicTrendOption([{ label: "1 Sep", value: 0 }, { label: "2 Sep", value: 12 }], "Mentions", false) as {
    animation: boolean; xAxis: { data: string[] }; series: Array<{ areaStyle: { opacity: number }; data: number[] }>;
  };
  assert.equal(trend.animation, false); assert.deepEqual(trend.xAxis.data, ["1 Sep", "2 Sep"]);
  assert.deepEqual(trend.series[0]!.data, [0, 12]); assert.equal(trend.series[0]!.areaStyle.opacity, 0.18);
  const sentiment = buildSignalTopicSentimentOption({ positive: 3, neutral: 2, negative: 5 },
    { positive: "Positive", neutral: "Neutral", negative: "Negative" }, false) as {
      animation: boolean; graphic: Array<{ style: { text: string } }>;
      series: Array<{ data: Array<{ value: number }> }>;
    };
  assert.equal(sentiment.animation, false); assert.equal(sentiment.graphic[0]!.style.text, "10");
  assert.deepEqual(sentiment.series[0]!.data.map(item => item.value), [3, 2, 5]);
});

test("the real native Topics route opens one evidence mention through the enriched Mentions view", async () => {
  const source = await readFile(
    new URL("../../components/signal-v2/SignalV2BrandMonitoring.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /<SignalV2WorkspaceTopics[\s\S]*brandName=\{brandName\}[\s\S]*workspaceTimezone=\{data\.workspace\.timezone\}/u);
  assert.match(source, /onOpenMentions=\{\(\) => void navigateToModule\("mentions"\)\}/u);
  assert.match(source, /onOpenMention=\{mentionId => \{[\s\S]*new URLSearchParams\(\{ view: "all_conversations", mention: mentionId \}\)[\s\S]*navigateToModule\("mentions", "push", params\)/u);
  assert.match(source, /initialMention=\{mentionsData\.native \? mentionsData\.record \?\? null : initialMention\}/u);
});

test("native volume chart preserves exact keys and counts, with no fabricated sentiment or proximity", () => {
  const terms = [{ ...data.terms[0]!, mention_count: 0 }, { ...data.terms[1]!, label: "Same name", mention_count: 12 }];
  const option = nativeTopicsVolumeChartV1(terms, "topic1", "Mentions");
  assert.deepEqual(option.series[0]!.data.map(item => [item.name, item.value]), [["topic0", 0], ["topic1", 12]]);
  assert.equal(option.yAxis.axisLabel.formatter("topic1"), "Same name");
  assert.equal(option.series[0]!.data[1]!.itemStyle.color, "#1689f5");
  assert.equal(option.animation, false); assert.equal(option.tooltip.renderMode, "richText");
  assert.doesNotMatch(JSON.stringify(option), /sentiment|positive|negative|scatter/);
});
