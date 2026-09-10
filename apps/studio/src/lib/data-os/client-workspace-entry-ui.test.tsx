import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ClientBrandWorkspaceList } from "../../components/brands/ClientBrandWorkspaceList";
import { ClientBrandWorkspaceData } from "../../components/brands/ClientBrandWorkspaceData";
import { BrandMonitoringJourney } from "../../components/brands/BrandMonitoringJourney";
import { TopicsManager } from "../../components/brands/TopicsManager";
import { AcquisitionPlanManager } from "../../components/admin/AcquisitionPlanManager";
import type { ClientBrandWorkspaceEntryV1 } from "./workspace-management-entry";
import type { SignalTopicsManagementProductV1 } from "./signal-topics-management";
Object.assign(globalThis, { React });
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const entry: ClientBrandWorkspaceEntryV1 = { workspaceId: "abcdef01-0000-4000-8000-000000000001", workspaceSlug: "brand-one",
  brandId: "abcdef02-0000-4000-8000-000000000002", name: "First assigned brand", timezone: "UTC", requestScope: "actor-one-workspace-one",
  capabilities: { can_view: true, can_edit_topics: true, can_import_mentions: true, can_select_signal: true, can_execute_topics: false, can_adopt_topics: false },
  navigation: { topicsHref: "/signal/brand-one/manage/topics", dataHref: "/signal/brand-one/manage/data", signalHref: "/signal/brand-one" } };
const catalog = JSON.parse(JSON.stringify({ workspace: { id: entry.workspaceId, slug: entry.workspaceSlug, name: entry.name, timezone: "UTC", operational_corpus: null },
  profile: null, active_profile_id: null, topics: [], execution: null, search_execution_id: null, search_is_current: false,
  capabilities: { can_view: true, can_edit: true, can_execute: false, can_adopt: false },
  readiness: { state: "awaiting_import", canonical_mentions: 0, operational_corpus_id: null, next_action: "import_mentions", reason_code: "topic_mentions_required" },
  embedding_preflight: { status: "blocked", requires_paid_call: false, missing_inputs: 0, estimated_micro_usd: 0, embedding_model: null, pricing_version: null, error_code: "topic_mentions_required" },
  discovered: { run_key: null, items: [], available: false } })) as SignalTopicsManagementProductV1;
for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (children: React.ReactNode) => renderToStaticMarkup(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={messages} onError={(error) => { throw error; }}>
    <AppRouterContext.Provider value={router}>{children}</AppRouterContext.Provider>
  </NextIntlClientProvider>);
  test(`${locale}: brand inventory does not require published outputs or expose global administration`, () => {
    const other = { ...entry, workspaceId: "abcdef03-0000-4000-8000-000000000003", name: "Second assigned brand", navigation: {
      topicsHref: "/signal/second-brand/manage/topics", dataHref: "/signal/second-brand/manage/data", signalHref: "/signal/second-brand" } };
    const html = render(<ClientBrandWorkspaceList entries={[entry, other]} />);
    for (const target of [entry, other]) for (const href of Object.values(target.navigation)) assert.ok(html.includes(`href="${href}"`));
    assert.doesNotMatch(html, /\/studio|client_admin|published_outputs|ANALYZE/u);
    const empty = render(<ClientBrandWorkspaceList entries={[]} />);
    assert.ok(empty.includes(messages.ClientWorkspaceEntry.emptyTitle));
    assert.doesNotMatch(empty, /href=|First assigned brand/u);
  });
  test(`${locale}: scoped journey uses client destinations without editable Brand OS`, () => {
    const html = render(<BrandMonitoringJourney brandId={entry.brandId} current="topics" destinations={{ topics: entry.navigation.topicsHref,
        data: entry.navigation.dataHref, signal: entry.navigation.signalHref, brandOs: null }} />);
    assert.doesNotMatch(html, /\/studio|brand-os/u);
    assert.equal((html.match(/aria-current="step"/gu) ?? []).length, 1);
  });
  test(`${locale}: Topics keeps draft authoring but hides processing for server-incapable client`, () => {
    const html = render(<TopicsManager brandId={entry.brandId} workspaceId={entry.workspaceId} initial={catalog}
      requestScope={entry.requestScope} navigation={entry.navigation} />);
    assert.ok(html.includes(`href="${entry.navigation.dataHref}"`));
    assert.ok(html.includes(messages.AdminWorkspace.topics.actions.create));
    assert.doesNotMatch(html, /data-analysis-receipt|data-incremental-editorial|\/studio|admin-topic-analysis/u);
    assert.ok(!html.includes(messages.AdminWorkspace.topics.actions.search));
    const denied = render(<TopicsManager brandId={entry.brandId} workspaceId={entry.workspaceId} initial={{ ...catalog,
      capabilities: { can_view: false, can_edit: false, can_execute: false, can_adopt: false } }} requestScope={entry.requestScope} navigation={entry.navigation} />);
    assert.match(denied, /role="alert"/u); assert.doesNotMatch(denied, /<input|<button/u);
  });
  test(`${locale}: viewer data exposes unknown receipt honestly without import or model controls`, () => {
    const viewer = { ...entry, capabilities: { ...entry.capabilities, can_import_mentions: false, can_edit_topics: false, can_select_signal: false } };
    const html = render(<ClientBrandWorkspaceData entry={viewer} corpus={null} initialReadiness={null} />);
    assert.ok(html.includes(messages.ClientWorkspaceEntry.dataReadOnly));
    assert.doesNotMatch(html, /<form|type="file"|query-generation|data-incremental-editorial/u);
    assert.ok(html.includes("—"));
  });
  test(`${locale}: imports-only query generation controls respect processing capability independently of import`, () => {
    const denied = render(<AcquisitionPlanManager workspaceId={entry.workspaceId} timezone="UTC" importsOnly canProcess={false} />);
    assert.ok(!denied.includes(messages.AdminWorkspace.data.acquisition.manualImport.prepareQueries));
    assert.ok(denied.includes(messages.AdminWorkspace.data.acquisition.manualImport.configuration));
    const internal = render(<AcquisitionPlanManager workspaceId={entry.workspaceId} timezone="UTC" importsOnly />);
    assert.ok(internal.includes(messages.AdminWorkspace.data.acquisition.manualImport.prepareQueries), "internal default remains unchanged");
  });
}

// The server page must skip the inventory query, not merely hide its links.
test("internal Signal home retains the report entrance without querying client workspace inventory", async () => {
  const page = await readFile(new URL("../../app/signal/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const isInternalUser = session\.appUser\.userType === "noisia_internal"/u);
  assert.match(page, /isInternalUser \? Promise\.resolve\(\[\]\) : listClientBrandWorkspaceEntriesV1\(session\.appUser\)/u);
  assert.match(page, /!isInternalUser \? <ClientBrandWorkspaceList entries=\{entries\} \/> : null/u);
});
