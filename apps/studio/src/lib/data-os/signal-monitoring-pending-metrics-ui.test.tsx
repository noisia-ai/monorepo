import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";
import type { SignalBrandMonitoringV1 } from "../signal-v2/brand-monitoring";
// Node's CJS/ESM interop exposes next/image's namespace instead of its real
// forwardRef component. Normalize only that package boundary for SSR tests.
const require = createRequire(import.meta.url);
const imageModule = require("next/image");
Object.assign(imageModule, imageModule.default);
const { SignalV2BrandMonitoring } = await import("../../components/signal-v2/SignalV2BrandMonitoring");
import { buildNativeSignalMonitoringV1 } from "./signal-workspace-monitoring-native";
Object.assign(globalThis, { React });
// Deliberately synthetic empty monitoring contract, with computed native volume below.
const base = {
  "contract_version": "signal-brand-monitoring-v1",
  "workspace": {
    "id": "workspace",
    "slug": "synthetic-import",
    "timezone": "America/Mexico_City"
  },
  "corpus": {
    "id": "00000000-0000-4000-8000-000000000001",
    "name": null
  },
  "coverage": {
    "date_from": null,
    "date_through": null,
    "mentions": 0
  },
  "filter": {
    "contract_version": "signal-backend-v1",
    "date_range": {
      "start": "2026-09-01",
      "end": "2026-09-24"
    },
    "timezone": "America/Mexico_City",
    "granularity": "day",
    "dimensions": {}
  },
  "comparison": {
    "mode": "previous_period",
    "date_range": {
      "start": "2026-08-08",
      "end": "2026-08-31"
    }
  },
  "comparison_filter": null,
  "freshness": {
    "state": "not_available",
    "data": {
      "reason": "workspace_has_no_sources"
    },
    "interpretation": {
      "reason": "workspace_has_no_sources"
    }
  },
  "volume": {
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "points": [],
    "previous_points": [],
    "current_value": null,
    "previous_value": null,
    "delta": null,
    "delta_ratio": null
  },
  "conversation_structure": {
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "points": [],
    "summary": {
      "mentions": 0,
      "conversations": 0,
      "root_posts": 0,
      "comments": 0,
      "classified_sentiment": 0
    },
    "attention": {
      "root_posts": 0,
      "total_interactions": 0,
      "median_interactions": 0,
      "p90_interactions": 0,
      "active_root_posts": 0,
      "active_ratio": null,
      "total_views": 0,
      "viewed_root_posts": 0
    },
    "previous_points": [],
    "previous_summary": null
  },
  "sentiment": {
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "buckets": [],
    "previous_buckets": []
  },
  "emotions": {
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "buckets": []
  },
  "platforms": {
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "buckets": []
  },
  "topics": {
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "buckets": []
  },
  "narratives": {
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "buckets": []
  },
  "attention": {
    "root_posts": 0,
    "total_interactions": 0,
    "median_interactions": 0,
    "p90_interactions": 0,
    "active_root_posts": 0,
    "active_ratio": null,
    "total_views": 0,
    "viewed_root_posts": 0,
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "previous": null,
    "previous_total_interactions": null,
    "interactions_delta_ratio": null
  },
  "conversation_drivers": {
    "state": "not_available",
    "reason": "workspace_has_no_sources",
    "items": []
  },
  "monthly_insights": {
    "contract_version": "signal-monthly-insights-v1",
    "candidate_hash": null,
    "cadence": "rolling_30_days",
    "independent_of_page_filter": true,
    "window": null,
    "comparison_window": null,
    "calculated_through": null,
    "context": {
      "state": "not_available",
      "objectives": 0,
      "briefs": 0,
      "audiences": 0,
      "approved_assertions": 0
    },
    "interpretation_state": "not_available",
    "items": []
  },
  "interpretations": [],
  "highlights": {
    "positive": [],
    "negative": []
  },
  "partial_states": [
    {
      "state": "not_available",
      "reason": "workspace_has_no_sources"
    }
  ]
} as SignalBrandMonitoringV1;
const native: SignalWorkspaceTopicsOverviewV1 = {
  contract_version: "signal-workspace-topics-serving-v1", source: "workspace_computed",
  workspace_id: "workspace", corpus_id: null, scope: "all_conversations",
  generation_id: "00000000-0000-4000-8000-000000000002", source_engine_execution_id: "00000000-0000-4000-8000-000000000003",
  is_current: true, is_processing: false, selection_revision: 0, filters: { date_from: null, date_to: null },
  available_dates: { date_from: "2026-09-01", date_to: "2026-09-03" }, scope_digest: "sha256:scope",
  observed_at: "2026-09-24T00:00:00Z", denominator: 3,
  coverage: { processed: 3, assigned_unique: 0, abstained: 3, noise: null, unresolved: 0, withheld: 0 },
  quality: "not_calibrated", interpretation_coverage: null, terms: [],
  series: [{ date: "2026-09-01", mention_count: 3, assigned_unique: 0 }], limitations: []
};
const computed = () => buildNativeSignalMonitoringV1(structuredClone(base), native);
const fullNative: SignalWorkspaceTopicsOverviewV1 = {
  ...native,
  monitoring: {
    contract_version: "signal-workspace-monitoring-v1", denominator: 3, scope_digest: native.scope_digest, metadata_digest: "sha256:metadata",
    population: { map_id: native.generation_id!, map_digest: "sha256:map", input_revision: "revision", policy_revision: 1 },
    summary: { mentions: 3, conversations: 2, root_posts: 1, comments: 2, unknown_roles: 0, classified_sentiment: 2 },
    series: [{ period_start: "2026-09-01", mentions: 3, conversations: 2, root_posts: 1, comments: 2,
      sentiment: { positive: 1, neutral: 0, negative: 1, classified: 2 } }],
    sentiment: { positive: 1, neutral: 0, negative: 1, unclassified: 1 },
    emotions: [],
    platforms: [{ key: "instagram", count: 3 }],
    attention: { root_posts: 1, total_interactions: 123, median_interactions: 123, p90_interactions: 123,
      active_root_posts: 1, active_ratio: 1, total_views: 456, viewed_root_posts: 1 },
    source_coverage: { sentiment_known: 2, emotion_classified: 0, thread_id_known: 3, content_type_known: 3, engagement_known: 1, views_known: 1,
      engagement_known_root_posts: 1, views_known_root_posts: 1, provider_observation_roots: 3, evidence_eligible: 3, llm_eligible_roots: 0 },
    drivers: [{ id: "synthetic-driver", title: "Synthetic thread", text: "Synthetic driver evidence", url: null,
      platform: "instagram", mention_count: 3, root_post_count: 1, comment_count: 2, interaction_count: 123, view_count: 456, source_sha256: "sha256:text" }],
    highlights: { positive: [{ id: "synthetic-highlight", occurred_at: "2026-09-01", title: null,
      text: "Synthetic positive source", url: null, platform: "instagram", sentiment: 1, engagement: 123,
      reach: null, source_sha256: "sha256:text" }], negative: [] }, limitations: []
  }
};
test("native metadata never inherits a previous population when the DTO is absent or mismatched", () => {
  const previous = buildNativeSignalMonitoringV1(structuredClone(base), fullNative);
  for (const next of [native, { ...fullNative, scope_digest: "sha256:other-scope" },
    { ...fullNative, denominator: 999 }]) {
    const result = buildNativeSignalMonitoringV1(previous, next);
    assert.equal(result.conversation_structure.state, "not_available");
    assert.deepEqual(result.conversation_structure.points, []);
    assert.equal(result.sentiment.state, "not_available");
    assert.deepEqual(result.platforms.buckets, []);
    assert.equal(result.attention.state, "not_available");
    assert.deepEqual(result.conversation_drivers.items, []);
    assert.deepEqual(result.highlights, { positive: [], negative: [] });
  }
});
async function render(locale: string, data = computed()) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
    createElement(SignalV2BrandMonitoring, { activeModule: "monitoring", activeStudy: null, brandName: "Synthetic QA",
      canRefreshInsights: false, initialData: data,
      initialMention: null, initialMentions: null, initialSettings: null, initialTopicsNarratives: null,
      initialTriggersBarriers: null, legacyOutputId: null, manageTopicsHref: null, strategicStudies: [], userName: "Synthetic QA",
      workspaceOptions: [], workspaceSubjectId: "synthetic-brand", viewKey: "all_conversations" })));
}
for (const locale of ["es-MX", "en-US"]) {
  test(`${locale}: native source metrics restore all proven dashboard widgets without enabling unsupported comparison`, async () => {
    const data = buildNativeSignalMonitoringV1(structuredClone(base), fullNative);
    assert.deepEqual(data.conversation_structure.summary, fullNative.monitoring!.summary);
    assert.deepEqual(data.conversation_structure.points, fullNative.monitoring!.series);
    assert.equal(data.sentiment.buckets.find(bucket => bucket.key === "positive")?.value, 1);
    assert.equal(data.platforms.buckets[0]?.key, "instagram");
    assert.equal(data.attention.total_interactions, 123);
    assert.equal(data.conversation_drivers.items[0]?.id, "synthetic-driver");
    assert.equal(data.highlights.positive[0]?.text, "Synthetic positive source");
    const html = await render(locale, data);
    assert.match(html, /signal-v2-metric-switch/);
    assert.match(html, /signal-v2-attention-metrics/);
    assert.match(html, /Synthetic positive source/);
    assert.ok(html.includes(locale === "es-MX" ? "2 de 3 menciones" : "2 of 3 mentions"));
    assert.ok(html.includes(locale === "es-MX" ? "La fuente no incluye clasificación de emociones" : "The source does not include emotion classifications"));
    assert.equal(data.comparison_filter, null);
    assert.equal(data.comparison.mode, "none");
  });
  test(`${locale}: missing views stay absent while genuine interaction zero and source emotions remain visible`, async () => {
    const source = structuredClone(fullNative);
    source.monitoring!.source_coverage.views_known_root_posts = 0;
    source.monitoring!.attention.total_views = 0;
    source.monitoring!.attention.total_interactions = 0;
    source.monitoring!.emotions = [{ key: "joy", count: 1 }];
    source.monitoring!.source_coverage.emotion_classified = 1;
    const data = buildNativeSignalMonitoringV1(structuredClone(base), source);
    const html = await render(locale, data);
    assert.equal(data.emotions.buckets[0]?.value, 1);
    assert.equal(data.emotions.state, "partial");
    assert.ok(!html.includes(locale === "es-MX" ? "La fuente no incluye clasificación de emociones" : "The source does not include emotion classifications"));
    assert.match(html, /signal-v2-attention-metrics/);
    assert.match(html, /<strong>0<\/strong>/);
    assert.match(html, /<strong>—<\/strong>/);
  });
  for (const state of ["not_available", "pending"] as const) {
    test(`${locale}: native ${state} metrics keep dashboard/volume without invented zero enrichment or live highlights`, async () => {
      const data = computed(); data.sentiment.state = state; data.attention.state = state;
      const html = await render(locale, data);
      assert.ok(html.includes(locale === "es-MX" ? "El sentimiento todavía no está disponible" : "Sentiment is not yet available"));
      assert.ok(html.includes(locale === "es-MX" ? "Las métricas de interacción todavía no están disponibles" : "Interaction metrics are not yet available"));
      assert.ok(html.includes(locale === "es-MX" ? "Todavía no hay conversaciones destacadas para este periodo" : "There are no highlighted conversations for this period yet"));
      assert.doesNotMatch(html, /0 de 0 menciones|0 of 0 mentions|signal-v2-attention-metrics|3 señales positivas|3 señales negativas|3 positive signals|3 negative signals/);
      const evidence = html.match(/<article class="signal-v2-card signal-v2-card--full signal-v2-conversations">[\s\S]*?<\/article>/)?.[0];
      assert.ok(evidence); assert.doesNotMatch(evidence, /LIVE|signal-v2-conversation-columns/);
      assert.match(html, /signal-v2-engagement-card/); assert.match(html, /signal-v2-dashboard-stage/);
      assert.match(html, /<strong>3<\/strong>/);
      assert.doesNotMatch(html, /Data OS|metricsPending\./);
    });
  }
  for (const state of ["fresh", "stale", "partial"] as const) {
    test(`${locale}: real ${state} zero metrics remain visible`, async () => {
      const data = computed(); data.sentiment.state = state; data.attention.state = state;
      const html = await render(locale, data);
      assert.match(html, /signal-v2-attention-metrics/);
      assert.match(html, /<strong>0<\/strong>/);
      assert.ok(html.includes(locale === "es-MX" ? "0 de 0 menciones" : "0 of 0 mentions"));
      assert.ok(!html.includes(locale === "es-MX" ? "El sentimiento todavía no está disponible" : "Sentiment is not yet available"));
      assert.ok(!html.includes(locale === "es-MX" ? "Las métricas de interacción todavía no están disponibles" : "Interaction metrics are not yet available"));
    });
  }
  test(`${locale}: existing native highlighted conversations are retained`, async () => {
    const data = computed();
    data.highlights.positive = [{ id: "synthetic-evidence", occurred_at: "2026-09-01", title: null,
      text: "Synthetic highlighted conversation", url: null, platform: "Web", sentiment: 1,
      engagement: 0, reach: null, explanation: "Synthetic evidence" }];
    const html = await render(locale, data);
    assert.match(html, /Synthetic highlighted conversation|Synthetic evidence/);
    assert.match(html, /signal-v2-conversation-columns/);
  });
  test(`${locale}: legacy monitoring retains its current breakdowns and evidence presentation`, async () => {
    const html = await render(locale, base);
    assert.match(html, /signal-v2-attention-metrics/); assert.match(html, /signal-v2-conversation-columns/);
    assert.ok(html.includes(locale === "es-MX" ? "3 señales positivas" : "3 positive signals"));
  });
}
