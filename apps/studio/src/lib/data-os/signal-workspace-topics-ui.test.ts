import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";
import { SignalV2WorkspaceTopics } from "../../components/signal-v2/SignalV2WorkspaceTopics";
Object.assign(globalThis, { React });
const data: SignalWorkspaceTopicsOverviewV1 = {
  contract_version: "signal-workspace-topics-serving-v1", source: "workspace_computed", workspace_id: "workspace", corpus_id: null,
  scope: "all_conversations", generation_id: "generation", source_engine_execution_id: "engine", is_current: true, is_processing: false, selection_revision: 3,
  filters: { date_from: null, date_to: null }, available_dates: { date_from: "2026-09-01", date_to: "2026-09-08" },
  scope_digest: "sha256:scope", observed_at: "2026-09-08T00:00:00.000000Z", denominator: 10,
  coverage: { processed: 10, assigned_unique: 8, abstained: 1, unresolved: 1, withheld: 2 }, quality: "not_calibrated",
  terms: ["Delivery", "Support"].map((label, index) => ({ term_key: `topic${index}`, label, definition: `${label} experiences`,
    definition_revision: 1, definition_digest: "sha256:def", selected: true, mention_count: 7, share_of_corpus: 0.7, basis: "computed_cluster" })),
  series: [], limitations: ["computed_memberships_not_semantic_precision"]
};
async function render(locale: string, payload = data) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
    createElement(SignalV2WorkspaceTopics, { data: payload, loading: false, manageTopicsHref: "/studio/brands/brand/topics", onApplyFilter: async () => true })));
}
test("native Signal renders computed multilabel counts without claiming calibrated quality or a study corpus", async () => {
  const html = await render("es-MX");
  assert.match(html, /Pertenencia calculada/); assert.match(html, /no está calibrada/);
  assert.match(html, /sumar más de 100%/); assert.match(html, /Delivery/); assert.match(html, /Support/);
  assert.match(html, /En Topics seleccionados/); assert.match(html, /Fechas en UTC/);
  assert.doesNotMatch(html, /Precisión:|studio\/corpora|Investigar insights/);
});
test("empty completed catalogue is actionable without creating synthetic Topics or narratives", async () => {
  const html = await render("en-US", { ...data, terms: [] });
  assert.match(html, /No Topics selected/); assert.match(html, /Manage Topics/);
  assert.match(html, /Narratives and insights are not yet available/); assert.doesNotMatch(html, /topic0|topic1/);
});
test("stale generation preserves counts while disabling stale evidence access", async () => {
  const html = await render("en-US", { ...data, is_current: false });
  assert.match(html, /Previous result/); assert.match(html, /last complete result is retained/);
  assert.match(html, /disabled=""[^>]*>View evidence/);
});
