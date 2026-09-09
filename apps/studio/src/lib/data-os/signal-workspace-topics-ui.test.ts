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
  coverage: { processed: 10, assigned_unique: 8, abstained: 1, unresolved: 1, withheld: 2 }, interpretation_coverage: { interpreted_unit_count: 32, expected_unit_count: 357, complete: false }, quality: "not_calibrated",
  terms: ["Delivery", "Support"].map((label, index) => ({ term_key: `topic${index}`, label, definition: `${label} experiences`,
    definition_revision: 1, definition_digest: "sha256:def", selected: true, mention_count: 7, share_of_corpus: 0.7, basis: "computed_cluster" })),
  series: [], limitations: ["computed_memberships_not_semantic_precision"]
};
async function render(locale: string, payload = data, surface: "summary" | "topics" = "topics", refreshFailed = false) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
    createElement(SignalV2WorkspaceTopics, { data: payload, loading: false, surface, refreshFailed, onRefresh: async () => true, onOpenTopics: () => undefined, manageTopicsHref: "/studio/brands/brand/topics", onApplyFilter: async () => true })));
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
