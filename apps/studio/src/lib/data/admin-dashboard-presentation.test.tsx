import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AdminDashboard } from "../../components/admin/AdminDashboard";
import { adminDashboardCorpusTotals, adminDashboardNeedsAttention, adminDashboardReceiptPriority } from "./admin-dashboard-presentation";
import type { AdminBrandWorkspaceRow } from "./admin-workspace";

Object.assign(globalThis, { React });
const id = "00000000-0000-4000-8000-000000000001";
const received: NonNullable<AdminBrandWorkspaceRow["corpus"]> = {
  contract_version: "admin-workspace-corpus-summary-v1", workspace_id: id, observed_at: "2026-09-09T11:00:00.000001Z",
  state: "received", measurement_state: "complete", unmeasured_sources: 0,
  received_unique_roots: 421, included_roots: 400, excluded_roots: 21, pending_roots: 0,
  accepted_files: 7, records_read: 600, duplicate_rows: 179, sources_with_accepted_imports: 2, sources_without_accepted_imports: 0,
  capture_scopes: { primary_brand: 3, competitor: 3, category: 1, reference: 0, unknown: 0 },
  coverage: { from: "2026-08-01", through: "2026-08-31", timezone: "America/Mexico_City", dated_roots: 421, unknown_date_roots: 0, state: "observed" },
  reconciliation_errors: []
};
const brand: AdminBrandWorkspaceRow = { brandId: id, brandName: "Example brand", brandSlug: "example", brandStatus: "active",
  organizationId: id, organizationName: "Example organization", industry: null, workspaceId: id, workspaceSlug: "example",
  workspaceStatus: "active", timezone: "America/Mexico_City", populationId: null, populationVersion: null,
  governedMentions: 0, corpus: received, coverageFrom: null, coverageThrough: null, coverageState: "warning",
  freshnessState: "not_available", freshnessLabel: "not_available", qualityState: "good", activeSources: 2,
  staleSources: 0, failedSources: 0, pendingImports: 0, importsFailed: 0, reportState: "not_available", currentReportRevision: null,
  reportsNeedingReview: 0, latestActivityAt: "2026-09-09T02:00:00.000Z" };
const dashboard = (brands: AdminBrandWorkspaceRow[]) => ({ brands, priorities: brands.flatMap(value => {
  const receipt = adminDashboardReceiptPriority(value);
  return receipt ? [{ brandId: value.brandId, brandName: value.brandName, ...receipt, count: value.corpus?.received_unique_roots ?? 0,
    href: `/studio/brands/${value.brandId}/data` }] : [];
}), totals: { brands: brands.length, governedMentions: 0, ...adminDashboardCorpusTotals(brands),
  sourcesRequiringAttention: 0, pendingImports: 0, reportsNeedingReview: 0 } });

test("Dashboard totals use authorized workspace receipts even when the primary-brand population is empty", () => {
  assert.deepEqual(adminDashboardCorpusTotals([brand]), { receivedMentions: 421, acceptedFiles: 7, recordsRead: 600, incompleteReceiptBrands: 0 });
  assert.equal(adminDashboardReceiptPriority(brand), null);
  assert.equal(adminDashboardNeedsAttention(brand), false);
  assert.equal(adminDashboardNeedsAttention({ ...brand, freshnessState: "warning" }), true);
  assert.equal(adminDashboardNeedsAttention({ ...brand, qualityState: "danger" }), true);
  assert.equal(adminDashboardNeedsAttention({ ...brand, reportsNeedingReview: 1 }), true);
});
test("cross-brand total declares unmeasured or partial receipts and never substitutes an operational count", () => {
  const partial = { ...brand, brandId: "partial", corpus: { ...received, received_unique_roots: 19, measurement_state: "partial" as const, unmeasured_sources: 1 } };
  const unavailable = { ...brand, brandId: "unavailable", governedMentions: 999, corpus: null };
  assert.deepEqual(adminDashboardCorpusTotals([brand, partial, unavailable]), {
    receivedMentions: 440, acceptedFiles: 14, recordsRead: 1200, incompleteReceiptBrands: 2 });
  assert.equal(adminDashboardCorpusTotals([unavailable]).receivedMentions, null);
  assert.equal(adminDashboardCorpusTotals([{ ...brand, corpus: { ...received, received_unique_roots: null, measurement_state: "unavailable" } }]).receivedMentions, null);
  assert.equal(adminDashboardCorpusTotals([]).receivedMentions, 0);
  assert.equal(adminDashboardReceiptPriority(partial)?.code, "receipt_partial");
  assert.equal(adminDashboardReceiptPriority(unavailable)?.code, "receipt_unavailable");
});
test("empty receipt and zero with a reconciliation failure have different next actions", () => {
  const empty = { ...brand, corpus: { ...received, state: "awaiting_import" as const, received_unique_roots: 0, accepted_files: 0, records_read: 0 } };
  assert.equal(adminDashboardReceiptPriority(empty)?.code, "receipt_empty");
  assert.equal(adminDashboardReceiptPriority({ ...empty, corpus: { ...empty.corpus, state: "needs_attention", accepted_files: 1,
    reconciliation_errors: ["accepted_import_membership_missing"] } })?.code, "receipt_attention");
});
for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const t = messages.AdminWorkspace;
  const render = (brands: AdminBrandWorkspaceRow[], corpusLoading = false, corpusRequested: string | null = "all") => renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
    <AdminDashboard dashboard={dashboard(brands)} corpusLoading={corpusLoading} corpusRequested={corpusRequested} /></NextIntlClientProvider>);
  test(`${locale}: Dashboard renders receipt, accepted files and dates without false primary-brand alerts or analysis claims`, () => {
    const html = render([brand]);
    assert.match(html, /421/u); assert.match(html, /600/u); assert.ok(html.includes(t.dashboard.summary.mentionsHint));
    assert.ok(html.includes(t.dashboard.priorities.emptyTitle)); assert.ok(html.includes(t.brands.columns.mentions));
    assert.ok(html.includes(t.brands.columns.coverage)); assert.ok(html.includes(t.corpusSummary.states.received));
    assert.doesNotMatch(html, /primary.brand|Sin menciones gobernadas|No governed mentions|Menciones gobernadas|Governed mentions/u);
    assert.doesNotMatch(html, /Sin bloqueos|No blockers|Analysis complete|Análisis completo/u);
    assert.ok(html.includes(`/studio/brands/${id}`));
    assert.ok(html.includes('/signal/example/topics-narratives'));
    assert.ok(html.includes(t.corpusSummary.openSignal));
    const withoutWorkspace = render([{ ...brand, workspaceId: null, workspaceSlug: null }]);
    assert.ok(!withoutWorkspace.includes('/signal/'));
    const encodedWorkspace = render([{ ...brand, workspaceSlug: 'café / test' }]);
    assert.ok(encodedWorkspace.includes('/signal/caf%C3%A9%20%2F%20test/topics-narratives'));
    assert.ok(!html.includes(t.dashboard.priority.receipt_empty));
  });
  test(`${locale}: navigation stays usable while canonical receipts load without reporting empty or unavailable data`, () => {
    const html = render([{ ...brand, corpus: null }], true);
    assert.ok(html.includes('/signal/example/topics-narratives'));
    assert.ok(html.includes(t.dashboard.receiptsLoading));
    assert.ok(!html.includes(t.dashboard.priority.receipt_unavailable));
    assert.ok(!html.includes(t.corpusSummary.states.unavailable));
    assert.ok(!html.includes(t.dashboard.priorities.emptyTitle));
    assert.ok(!html.includes(t.dashboard.summary.receiptCounts.replace('{files, number}', '0').replace('{rows, number}', '0')));
  });
  test(`${locale}: opening Dashboard shows every workspace and waits for an explicit receipt request`, () => {
    const many = Array.from({ length: 16 }, (_, index) => ({ ...brand,
      brandId: `brand-${index}`, workspaceSlug: `workspace-${index}`, corpus: null }));
    const html = render(many, false, null);
    assert.ok(html.includes('/signal/workspace-15/topics-narratives'));
    assert.ok(html.includes(t.dashboard.receiptsIdle));
    assert.ok(html.includes('name="receipts"'));
    assert.ok(!html.includes(t.dashboard.receiptsLoading));
    assert.ok(!html.includes(t.dashboard.priority.receipt_unavailable));
    assert.ok(!html.includes(t.corpusSummary.states.unavailable));
    const noWorkspace = render([{ ...brand, workspaceId: null, workspaceSlug: null, corpus: null }], false, null);
    assert.ok(noWorkspace.includes(`/studio/brands/${id}`));
    assert.ok(!noWorkspace.includes('/signal/'));
  });
  test(`${locale}: the sixteenth requested workspace retains its priority after unrequested receipts are filtered`, async () => {
    process.env.DATABASE_URL ??= "postgresql://test@127.0.0.1:1/noisia_test";
    const { getAdminDashboard } = await import("./admin-workspace");
    const { pool } = await import("../db");
    const rows = Array.from({ length: 16 }, (_, index) => ({
      brand_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      brand_name: `Workspace ${index + 1}`, brand_slug: `workspace-${index + 1}`, brand_status: "active",
      organization_id: id, organization_name: "Example organization", industry: null,
      workspace_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      workspace_slug: `workspace-${index + 1}`, workspace_status: "active", timezone: "UTC",
      population_id: null, population_version: null, coverage_from: null, coverage_through: null,
      freshness_state: null, current_report_status: null, current_report_revision: null,
      latest_activity_at: null
    }));
    const query = mock.method(pool, "query", async () => ({ rows }));
    let actual: Awaited<ReturnType<typeof getAdminDashboard>>;
    try {
      actual = await getAdminDashboard({ id, userType: "noisia_internal" }, { includeCorpus: false });
      assert.equal(actual.priorities.length, 16);
    } finally {
      query.mock.restore();
    }
    const html = renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <AdminDashboard dashboard={actual} corpusRequested={rows[15]!.workspace_id} />
    </NextIntlClientProvider>);
    const priorities = html.match(/<ol class="admin-priority-list">([\s\S]*?)<\/ol>/u)?.[1] ?? "";
    assert.ok(priorities.includes("Workspace 16"));
    assert.equal((priorities.match(/<li>/gu) ?? []).length, 1);
    assert.ok(priorities.includes(t.dashboard.priority.receipt_unavailable));
    assert.ok(!html.includes(t.dashboard.priorities.emptyTitle));
    assert.ok(html.includes(t.dashboard.summary.mentionsSubtotal));
    assert.ok(html.includes(t.dashboard.summary.mentionsSubtotalHint));
    assert.ok(!html.includes(t.dashboard.summary.mentionsHint));
    const measured = actual.brands.map((item, index) => index === 15
      ? { ...item, corpus: { ...received, workspace_id: item.workspaceId! } } : item);
    const measuredHtml = render(measured, false, rows[15]!.workspace_id);
    assert.ok(measuredHtml.includes(t.dashboard.summary.mentionsSubtotal));
    assert.match(measuredHtml, /<dd>421<\/dd>/u);
    assert.ok(measuredHtml.includes(t.dashboard.summary.receiptCounts.replace('{files, number}', '7').replace('{rows, number}', '600')));
    assert.ok(!measuredHtml.includes(locale === "es-MX" ? "15 marcas" : "15 brands"));
  });
  test(`${locale}: partial and unavailable remain distinct from a brand with no received files`, () => {
    const partial = { ...brand, corpus: { ...received, measurement_state: "partial" as const, unmeasured_sources: 1 } };
    const html = render([partial]);
    assert.ok(html.includes(t.corpusSummary.states.partial)); assert.ok(html.includes(t.dashboard.priority.receipt_partial));
    const unknown = render([{ ...brand, corpus: null }]);
    assert.match(unknown, /<dd>—<\/dd>/u); assert.ok(unknown.includes(t.dashboard.priority.receipt_unavailable));
    assert.ok(render([]).includes(t.dashboard.attention.emptyTitle));
    const empty = render([{ ...brand, corpus: { ...received, state: "awaiting_import", received_unique_roots: 0, accepted_files: 0, records_read: 0 } }]);
    assert.ok(empty.includes(t.dashboard.priority.receipt_empty));
  });
}
