import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import type { SignalWorkspaceTopicDetailV1 } from "@noisia/db";
import { SignalWorkspaceTopicDetailMetrics, validNativeTopicDetail } from "../../components/signal-v2/SignalWorkspaceTopicDetail";
Object.assign(globalThis, { React });
const detail: SignalWorkspaceTopicDetailV1 = {
  contract_version: "signal-workspace-topic-detail-v1", workspace_id: "workspace", generation_id: "generation",
  scope_digest: "scope", term_key: "assistant", mention_count: 12, undated_mentions: 2,
  series: [{ date: "2026-09-01", mention_count: 10 }],
  sentiment: { positive: 3, neutral: 2, negative: 3, unclassified: 4, meaning: "evidence_sentiment_not_topic_polarity" },
  related_topics: [{ term_key: "privacy", label: "Privacy concerns", shared_mentions: 3 }], relationship_meaning: "cooccurrence_not_causality"
};
test("native detail rejects stale scope and impossible aggregate counts", () => {
  assert.equal(validNativeTopicDetail(detail, detail), true);
  for (const field of ["workspace_id", "generation_id", "scope_digest", "term_key"] as const)
    assert.equal(validNativeTopicDetail({ ...detail, [field]: "other" }, detail), false);
  assert.equal(validNativeTopicDetail({ ...detail, sentiment: { ...detail.sentiment, positive: 13 } }, detail), false);
  assert.equal(validNativeTopicDetail({ ...detail, series: [{ date: "2026-09-01", mention_count: 12 }] }, detail), false);
  assert.equal(validNativeTopicDetail({ ...detail, related_topics: [{ term_key: "privacy", label: "Privacy", shared_mentions: 13 }] }, detail), false);
  assert.equal(validNativeTopicDetail({ ...detail, relationship_meaning: "causality" }, detail), false);
  assert.equal(validNativeTopicDetail({ ...detail, series: [null] }, detail), false);
  assert.equal(validNativeTopicDetail({ ...detail, related_topics: [null] }, detail), false);
  assert.equal(validNativeTopicDetail({ ...detail, related_topics: [...detail.related_topics, ...detail.related_topics] }, detail), false);
});
for (const locale of ["es-MX", "en-US"]) {
  async function render(payload: SignalWorkspaceTopicDetailV1 | null) {
    const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
    return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
      createElement(SignalWorkspaceTopicDetailMetrics, { detail: payload, onSelect() {} })));
  }
  test(`${locale}: native detail uses actual sentiment counts and cooccurrence without inventing polarity`, async () => {
    const html = await render(detail);
    assert.match(html, /signal-v2-tn__detail-charts/);
    assert.match(html, /Privacy concerns/);
    assert.match(html, locale === "es-MX" ? /Sin sentimiento disponible: 4/ : /Sentiment unavailable: 4/);
    assert.match(html, locale === "es-MX" ? /3 menciones compartidas/ : /3 shared mentions/);
    assert.match(html, locale === "es-MX" ? /no implica causalidad/ : /does not imply causality/);
    assert.match(html, locale === "es-MX" ? /Sin fecha disponible: 2/ : /Date unavailable: 2/);
  });
  test(`${locale}: missing detail is unavailable, while zero overlap and unclassified sentiment stay explicit`, async () => {
    const empty = await render(null);
    assert.match(empty, locale === "es-MX" ? /No disponible para este resultado/ : /Not available for this result/);
    assert.doesNotMatch(empty, /Privacy concerns|>0</);
    const unclassified = await render({ ...detail, related_topics: [],
      sentiment: { ...detail.sentiment, positive: 0, neutral: 0, negative: 0, unclassified: 12 } });
    assert.match(unclassified, locale === "es-MX" ? /Sin sentimiento disponible: 12/ : /Sentiment unavailable: 12/);
    assert.match(unclassified, locale === "es-MX" ? /No hay menciones compartidas/ : /No shared mentions/);
    assert.doesNotMatch(unclassified, /signal-v2-tn__sentiment-legend/);
  });
}
