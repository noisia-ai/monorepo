import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AdminCorpusCoverage, AdminCorpusProgress, AdminCorpusReceipt, AdminCorpusStatus, AdminCorpusSummaryStrip } from "../../components/admin/AdminCorpusSummary";
import { adminCorpusAnalysisStep, adminCorpusDateRange, adminCorpusState, type AdminCorpusSummary } from "./admin-corpus-presentation";
import type { WorkspaceAnalysisStatus } from "../data-os/signal-workspace-analysis-ui";

Object.assign(globalThis, { React });
export const corpusFixture: AdminCorpusSummary = {
  contract_version: "admin-workspace-corpus-summary-v1", workspace_id: "00000000-0000-4000-8000-000000000001",
  observed_at: "2026-09-09T07:00:00.000001Z", state: "received", measurement_state: "complete", unmeasured_sources: 0,
  received_unique_roots: 7396, included_roots: 7396, excluded_roots: 0, pending_roots: 0, accepted_files: 16,
  records_read: 9131, duplicate_rows: 1735, sources_with_accepted_imports: 1, sources_without_accepted_imports: 0,
  capture_scopes: { primary_brand: 2, competitor: 12, category: 2, reference: 0, unknown: 0 },
  coverage: { from: "2026-01-01", through: "2026-08-31", timezone: "America/Mexico_City", dated_roots: 7396, unknown_date_roots: 0, state: "observed" },
  reconciliation_errors: []
};
export const analysisFixture: WorkspaceAnalysisStatus = {
  contract_version: "signal-workspace-analysis-v1", workspace_id: corpusFixture.workspace_id, observed_at: corpusFixture.observed_at,
  request_scope: "fixture-actor-scope", can_execute: true, latest_complete: null, latest_complete_execution_id: null, active_run: null, request_run: null,
  latest_run: { execution_id: corpusFixture.workspace_id, status: "failed", phase: "failed", progress: 30,
    expected_roots: 7396, expected_chunks: 9120, expected_guides: 4, processed_roots: 7396, processed_chunks: 9120,
    error_code: "workspace_engine_interpretation_daily_authority_expired", is_current: true, model_version_id: null,
    artifact_count: 15, claude_cap_micro_usd: 30_000_000, result_kind: "computational_grouping", fit_completed: true,
    expected_interpretation_units: 357, interpreted_units: 32, materialized_topics: 0, retryable: false,
    outcome_unknown: false, transport_recovery_eligible: false,
    claude_cost: { hard_cap_micro_usd: 30_000_000, settled_micro_usd: 1_918_865, reserved_micro_usd: 1_681_800,
      unknown_reserved_micro_usd: 0, terminal_reserved_micro_usd: 1_681_800 } },
  preflight: { state: "ready", embedding_run_id: corpusFixture.workspace_id, context_digest: `sha256:${"1".repeat(64)}`, catalog_digest: `sha256:${"2".repeat(64)}`,
    cost: { claude: { estimated_upper_micro_usd: null, maximum_cap_micro_usd: 0, provider_available: false }, voyage: { estimated_upper_micro_usd: 0 } } }
};
async function render(locale: string, children: React.ReactNode) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(<NextIntlClientProvider messages={messages} locale={locale} timeZone="UTC">{children}</NextIntlClientProvider>);
}
test("received counts do not become analyzed or Signal-ready, and missing measurements are not zero", async () => {
  for (const locale of ["es-MX", "en-US"]) {
    const markup = await render(locale, <><AdminCorpusSummaryStrip corpus={corpusFixture} /><AdminCorpusProgress corpus={corpusFixture} analysis={analysisFixture} brandId="brand" workspaceSlug="example" /></>);
    assert.match(markup, /7,396/u); assert.match(markup, /9,131/u); assert.match(markup, /32.*357/u);
    assert.match(markup, locale === "es-MX" ? /permiso de gasto.*venció/u : /Spending authorization.*expired/u);
    assert.doesNotMatch(markup, /Sin bloqueos|No blockers|Menciones gobernadas|Governed mentions/u);
    assert.match(markup, /\/studio\/brands\/brand\/topics/u); assert.match(markup, /\/signal\/example\/topics-narratives/u);
    const unavailable = await render(locale, <AdminCorpusReceipt corpus={{ ...corpusFixture, received_unique_roots: null, measurement_state: "unavailable", accepted_files: 0, unmeasured_sources: 1 }} />);
    assert.match(unavailable, /<strong>—<\/strong>/u);
    const missing = await render(locale, <AdminCorpusSummaryStrip corpus={null} />);
    assert.doesNotMatch(missing, /<dd>0<\/dd>/u);
  }
});
test("receipt-only table is consistent and partial measurement is visible in ES/EN", async () => {
  const partial = { ...corpusFixture, measurement_state: "partial" as const, unmeasured_sources: 1 };
  assert.equal(adminCorpusState(partial), "partial");
  for (const locale of ["es-MX", "en-US"]) {
    const markup = await render(locale, <><AdminCorpusReceipt corpus={partial} /><AdminCorpusCoverage corpus={partial} /><AdminCorpusStatus corpus={partial} /></>);
    assert.match(markup, /7,396/u);
    assert.match(markup, locale === "es-MX" ? /Recepción parcial/u : /Partial receipt/u);
    assert.doesNotMatch(markup, /Actualizado|Up to date|Healthy|Saludable/u);
  }
});
test("server-produced local calendar dates are stable across SSR and browser host timezones", () => {
  const original = process.env.TZ;
  try {
    for (const locale of ["es-MX", "en-US"]) {
      process.env.TZ = "UTC"; const ssr = adminCorpusDateRange(corpusFixture, locale);
      process.env.TZ = "America/Los_Angeles"; assert.equal(adminCorpusDateRange(corpusFixture, locale), ssr);
      process.env.TZ = "Pacific/Kiritimati"; assert.equal(adminCorpusDateRange(corpusFixture, locale), ssr);
      assert.match(ssr, /2026/u);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
test("next step honors received data, current inputs, failed generic vs explicit expiry, and complete zero groups", () => {
  assert.equal(adminCorpusAnalysisStep(corpusFixture, null), "unavailable");
  assert.equal(adminCorpusAnalysisStep({ ...corpusFixture, received_unique_roots: null }, analysisFixture), "unavailable");
  assert.equal(adminCorpusAnalysisStep({ ...corpusFixture, received_unique_roots: 0, accepted_files: 0, state: "awaiting_import" }, analysisFixture), "awaiting_import");
  assert.equal(adminCorpusAnalysisStep({ ...corpusFixture, received_unique_roots: 0, measurement_state: "partial", state: "needs_attention", reconciliation_errors: ["missing_root"] }, analysisFixture), "receipt_attention");
  assert.equal(adminCorpusAnalysisStep(corpusFixture, analysisFixture), "authorization_expired");
  const run = analysisFixture.latest_run!;
  assert.equal(adminCorpusAnalysisStep(corpusFixture, { ...analysisFixture, latest_run: { ...run, error_code: "workspace_engine_worker_failed" } }), "interrupted");
  assert.equal(adminCorpusAnalysisStep(corpusFixture, { ...analysisFixture, latest_run: { ...run, is_current: false } }), "changed");
  assert.equal(adminCorpusAnalysisStep(corpusFixture, { ...analysisFixture, latest_run: null, preflight: { ...analysisFixture.preflight, state: "awaiting_import" } }), "unavailable");
  assert.equal(adminCorpusAnalysisStep(corpusFixture, { ...analysisFixture, latest_run: { ...run, status: "ready", phase: "complete", interpreted_units: 357 } }), "complete");
  assert.equal(adminCorpusAnalysisStep(corpusFixture, { ...analysisFixture, latest_run: { ...run, status: "ready", phase: "complete", interpreted_units: 0, expected_interpretation_units: 0 } }), "no_groups");
});
