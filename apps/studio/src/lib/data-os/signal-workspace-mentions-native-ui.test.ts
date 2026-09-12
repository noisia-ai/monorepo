import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import { SignalV2Mentions, nativeMentionQueryParams, type SignalMentionsViewData } from "../../components/signal-v2/SignalV2Mentions";
import { splitNativeMentionsFocusQuery } from "../../components/signal-v2/native-mentions-navigation";

Object.assign(globalThis, { React });
const record = { subject_id: "00000000-0000-4000-8000-000000000003", occurred_at: "", text_snippet: "Evidence outside selected Topics.",
  title: null, url: "https://example.org/original", platform: "Web", language: null, country: null, content_type: "unknown", conversation_role: "root_post" as const,
  sentiment: null, sentiment_score: null, engagement: {}, interaction_count: 0, thread_key: "thread", tags: [], entities: [], features: [], attribution: [], tb_classification: null };
const data: SignalMentionsViewData = {
  contract_version: "signal-backend-v1", metric_key: "mention.volume", filters_hash: "sha256:scope", total_count: 7, records: [record],
  page: { limit: 50, offset: 0, next_cursor: null, next_offset: null },
  filter: { contract_version: "signal-backend-v1", date_range: { start: "2026-09-01", end: "2026-09-09" }, timezone: "UTC", granularity: "day", dimensions: {} },
  comparison: { mode: "none", date_range: null },
  native: { workspace_id: "workspace", generation_id: "generation", scope_digest: "sha256:scope", is_current: true, is_processing: false,
    available_dates: { date_from: "2026-09-01", date_to: "2026-09-09" }, filters: { date_from: null, date_to: null, search_query: null, platforms: [] },
    sort_direction: "desc", metric_denominator: 10, evidence_visible_total: 7, withheld_evidence_count: 2, integrity_withheld_count: 1 }
};
async function render(locale: string, payload = data, drawer = false) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
    createElement(SignalV2Mentions, { brandName: "Sample brand", coverage: { date_from: "2026-09-01", date_through: "2026-09-09" },
      data: payload, initialMention: drawer ? record : null, loading: false, onApplyFilter: async () => true, onDataChange: () => undefined,
      onOpenControls: () => undefined, workspaceId: "workspace" })));
}
for (const locale of ["es-MX", "en-US"]) {
  test(`${locale}: native list uses its whole readable universe and does not invent legacy enrichment`, async () => {
    const html = await render(locale);
    assert.ok(html.includes(locale === "es-MX" ? "10 conversaciones en las métricas" : "10 conversations in metrics"));
    assert.ok(html.includes(locale === "es-MX" ? "7 con texto disponible" : "7 with text available"));
    assert.ok(html.includes(locale === "es-MX" ? "resultados parciales" : "partial results"));
    assert.ok(html.includes(locale === "es-MX" ? "Todas las fechas" : "All dates"));
    assert.match(html, /Evidence outside selected Topics\./);
    assert.doesNotMatch(html, /signal-v2-mentions-table__(scope|sentiment|engagement|context|role)/);
    assert.doesNotMatch(html, /signal-v2-mentions-export|No attribution|Sin atribución|1970/);
    assert.match(html, /signal-v2-mentions-table__published">—/);
  });
  test(`${locale}: native drawer labels a fragment and never claims full or enriched text`, async () => {
    const html = await render(locale, data, true);
    assert.ok(html.includes(locale === "es-MX" ? "Fragmento de la mención" : "Mention excerpt"));
    assert.match(html, /https:\/\/example.org\/original/);
    assert.doesNotMatch(html, /signal-v2-mention-drawer__(metrics|scope|empty|tb|metadata)|1970/);
  });
  test(`${locale}: undated-only and empty results keep refresh without invented date bounds`, async () => {
    const html = await render(locale, { ...data, records: [], total_count: 0, native: { ...data.native!, available_dates: { date_from: null, date_to: null } } });
    assert.ok(html.includes(locale === "es-MX" ? ">Actualizar</button>" : ">Refresh</button>"));
    assert.doesNotMatch(html, /Evidence outside|Invalid Date|1970/);
  });
}
test("native query preserves all-time, literal search and exact repeated platforms without leaking legacy filters", () => {
  const query = nativeMentionQueryParams({ ...data, filter: { ...data.filter, dimensions: { country: ["MX"] } },
    native: { ...data.native!, filters: { ...data.native!.filters, search_query: "100% _delivery", platforms: ["Web, forums", "Reddit"] } } });
  assert.equal(query.get("view"), "all_conversations"); assert.equal(query.get("q"), "100% _delivery");
  assert.deepEqual(query.getAll("platform"), ["Web, forums", "Reddit"]);
  for (const key of ["start", "end", "offset", "dimension.country", "compare", "scope_digest", "cursor"]) assert.equal(query.has(key), false);
  assert.equal(nativeMentionQueryParams(data, { date_from: "2026-08-01", date_to: "2026-10-01" }).get("start"), "2026-08-01");
});
test("stale native data cannot render a retained row or an initial drawer even before effects", async () => {
  const html = await render("en-US", { ...data, native: { ...data.native!, is_current: false } }, true);
  assert.doesNotMatch(html, /Evidence outside selected Topics|example.org\/original|signal-v2-mention-drawer__verbatim/);
  assert.match(html, /10 conversations in metrics/);
});
test("direct and client focus reject ambiguous, empty and cursor-combined intentions before splitting", () => {
  const a = record.subject_id, b = "00000000-0000-4000-8000-000000000004";
  for (const query of [`mention=${a}&mention=${b}`, "mention=", `mention=${a}&cursor=opaque`]) {
    assert.throws(() => splitNativeMentionsFocusQuery(new URLSearchParams(query)), { code: "workspace_mentions_filter_invalid", status: 422 });
  }
  const result = splitNativeMentionsFocusQuery(new URLSearchParams(`mention=${a}&mention=${a}&q=literal&platform=Web`));
  assert.equal(result.focus, a); assert.equal(result.list.has("mention"), false);
  assert.equal(result.list.get("q"), "literal"); assert.equal(result.list.get("platform"), "Web");
});
test("workspace entry and client navigation request list plus focus in one native read", async () => {
  const [entry, navigation] = await Promise.all([
    readFile(new URL("../../components/signal-v2/SignalV2WorkspacePage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/signal-v2/SignalV2BrandMonitoring.tsx", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(entry, /splitNativeMentionsFocusQuery|focusQuery/u);
  assert.match(entry, /native = await loadNativeSignalMentionsV1\(scope, params\);\s+focused = native\?\.record/u);
  assert.match(navigation, /const requestQuery = new URLSearchParams\(query\);[\s\S]*fetch\(`\$\{endpoint\}\?\$\{requestQuery\}`/u);
  assert.doesNotMatch(navigation, /focusedResponse|focusQuery/u);
});
