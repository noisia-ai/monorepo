import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import type { SignalWorkspaceImportedOverviewV1 } from "@noisia/query-engine";
import type { SignalBrandMonitoringV1 } from "../signal-v2/brand-monitoring";
// Node's CJS/ESM interop exposes next/image's namespace instead of its real
// forwardRef component. Normalize only that package boundary for SSR tests.
const require = createRequire(import.meta.url);
const imageModule = require("next/image");
Object.assign(imageModule, imageModule.default);
const { SignalV2BrandMonitoring } = await import("../../components/signal-v2/SignalV2BrandMonitoring");
import { buildNativeSignalMonitoringV1 } from "./signal-workspace-monitoring-native";
Object.assign(globalThis, { React });
// Deliberately synthetic empty monitoring contract, with imported volume below.
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
const imported: SignalWorkspaceImportedOverviewV1 = {
  contract_version: "signal-workspace-topics-serving-v1", source: "workspace_imported", classification_state: "pending",
  workspace_id: "workspace", corpus_id: null, scope: "all_conversations", generation_id: null, source_engine_execution_id: null,
  is_current: true, is_processing: false, selection_revision: 0, filters: { date_from: null, date_to: null },
  available_dates: { date_from: "2026-09-01", date_to: "2026-09-03" }, scope_digest: "sha256:scope",
  observed_at: "2026-09-24T00:00:00Z", denominator: 3, evidence_visible_total: 3,
  coverage: { processed: null, assigned_unique: null, abstained: null, noise: null, unresolved: null, withheld: null },
  quality: "not_analyzed", interpretation_coverage: null, terms: [],
  series: [{ date: "2026-09-01", mention_count: 3, assigned_unique: null }], limitations: ["classification_required"]
};
async function render(locale: string, native = true) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
    createElement(SignalV2BrandMonitoring, { activeModule: "monitoring", activeStudy: null, brandName: "Synthetic QA",
      canRefreshInsights: false, initialData: native ? buildNativeSignalMonitoringV1(base, imported) : base,
      initialMention: null, initialMentions: null, initialSettings: null, initialTopicsNarratives: native ? imported : null,
      initialTriggersBarriers: null, legacyOutputId: null, manageTopicsHref: null, strategicStudies: [], userName: "Synthetic QA",
      workspaceOptions: [], workspaceSubjectId: "synthetic-brand", viewKey: native ? "all_conversations" : "brand" })));
}
for (const locale of ["es-MX", "en-US"]) {
  test(`${locale}: imported overview keeps real volume and the dashboard but does not present pending enrichment as zero`, async () => {
    const html = await render(locale);
    assert.ok(html.includes(locale === "es-MX" ? "El sentimiento todavía no está clasificado" : "Sentiment has not been classified yet"));
    assert.ok(html.includes(locale === "es-MX" ? "Las métricas de interacción todavía no están disponibles" : "Interaction metrics are not yet available"));
    assert.ok(html.includes(locale === "es-MX" ? "La evidencia priorizada estará disponible" : "Prioritized evidence will be available"));
    assert.doesNotMatch(html, /0 de 0 menciones|0 of 0 mentions|signal-v2-attention-metrics|3 señales positivas|3 señales negativas|3 positive signals|3 negative signals/);
    const evidence = html.match(/<article class="signal-v2-card signal-v2-card--full signal-v2-conversations">[\s\S]*?<\/article>/)?.[0];
    assert.ok(evidence);
    assert.doesNotMatch(evidence, /LIVE|signal-v2-conversation-columns/);
    assert.match(html, /signal-v2-engagement-card/);
    assert.match(html, /signal-v2-dashboard-stage/);
    assert.match(html, /<strong>3<\/strong>/);
  });
  test(`${locale}: legacy monitoring retains its current breakdowns and evidence presentation`, async () => {
    const html = await render(locale, false);
    assert.match(html, /signal-v2-attention-metrics/);
    assert.match(html, /signal-v2-conversation-columns/);
    assert.ok(html.includes(locale === "es-MX" ? "3 señales positivas" : "3 positive signals"));
  });
}
