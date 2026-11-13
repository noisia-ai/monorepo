import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React, { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { NextIntlClientProvider } from "next-intl";
import type { SignalBrandMonitoringV1 } from "../signal-v2/brand-monitoring";

const browser = new Window({ url: "https://studio.example.test/signal/synthetic/mentions?view=all_conversations" });
Object.assign(globalThis, { window: browser, self: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const imageModule = require("next/image");
Object.assign(imageModule, imageModule.default);
const { SignalV2BrandMonitoring, readSignalModule } = await import("../../components/signal-v2/SignalV2BrandMonitoring");
// Compile the real lazy modules before measuring navigation under concurrent CI load.
await Promise.all([
  import("../../components/signal-v2/SignalV2Mentions"),
  import("../../components/signal-v2/SignalV2WorkspaceTopics"),
  import("../../components/signal-v2/SignalV2TriggersBarriers")
]);
const messages = JSON.parse(await readFile(new URL("../../../messages/en-US.json", import.meta.url), "utf8"));
const unavailable = { state: "not_available", reason: "workspace_has_no_sources" } as const;
const attention = { root_posts: 0, total_interactions: 0, median_interactions: 0, p90_interactions: 0,
  active_root_posts: 0, active_ratio: null, total_views: 0, viewed_root_posts: 0 };
const base = { contract_version: "signal-brand-monitoring-v1", workspace: { id: "workspace", slug: "synthetic", timezone: "UTC" },
  corpus: { id: "workspace", name: null }, coverage: { date_from: null, date_through: null, mentions: 0 },
  filter: { contract_version: "signal-backend-v1", date_range: { start: "2026-09-01", end: "2026-09-24" }, timezone: "UTC", granularity: "day", dimensions: {} },
  comparison: { mode: "none", date_range: null }, comparison_filter: null,
  freshness: { state: "not_available", data: { reason: "workspace_has_no_sources" }, interpretation: { reason: "workspace_has_no_sources" } },
  volume: { ...unavailable, points: [], previous_points: [], current_value: null, previous_value: null, delta: null, delta_ratio: null },
  conversation_structure: { ...unavailable, points: [], summary: { mentions: 0, conversations: 0, root_posts: 0, comments: 0, classified_sentiment: 0 },
    attention, previous_points: [], previous_summary: null },
  sentiment: { ...unavailable, buckets: [], previous_buckets: [] }, emotions: { ...unavailable, buckets: [] },
  platforms: { ...unavailable, buckets: [] }, topics: { ...unavailable, buckets: [] }, narratives: { ...unavailable, buckets: [] },
  attention: { ...attention, ...unavailable, previous: null, previous_total_interactions: null, interactions_delta_ratio: null },
  conversation_drivers: { ...unavailable, items: [] },
  monthly_insights: { contract_version: "signal-monthly-insights-v1", candidate_hash: null, cadence: "rolling_30_days", independent_of_page_filter: true,
    window: null, comparison_window: null, state: "not_available", reason: "workspace_has_no_sources", calculated_through: null,
    context: { state: "not_available", objectives: 0, briefs: 0, audiences: 0, approved_assertions: 0 }, interpretation_state: "not_available", items: [] },
  interpretations: [], highlights: { positive: [], negative: [] }, partial_states: [unavailable]
} as SignalBrandMonitoringV1;

function mentionPayload(workspaceId = "workspace") {
  const record = { subject_id: "00000000-0000-4000-8000-000000000003", occurred_at: "2026-09-01T12:00:00Z",
    text_snippet: "Synthetic evidence from the native read", title: null, url: "https://example.test/mention", platform: "web",
    language: "en", country: null, content_type: "post", conversation_role: "root_post", sentiment: null,
    sentiment_score: null, engagement: {}, interaction_count: 0, thread_key: "synthetic-thread", tags: [],
    entities: [], features: [], attribution: [], tb_classification: null };
  return { contract_version: "signal-backend-v1", metric_key: "mention.volume", filters_hash: "sha256:synthetic",
    total_count: 1, records: [record], page: { limit: 50, offset: 0, next_cursor: null, next_offset: null },
    filter: base.filter, comparison: base.comparison,
    native: { workspace_id: workspaceId, generation_id: null, scope_digest: "sha256:synthetic", is_current: true,
      is_processing: false, available_dates: { date_from: "2026-09-01", date_to: "2026-09-24" },
      filters: { date_from: null, date_to: null, search_query: null, platforms: [] }, sort_direction: "desc",
      metric_denominator: 1, evidence_visible_total: 1, withheld_evidence_count: 0, integrity_withheld_count: 0 } };
}
function response(workspaceId = "workspace") { return Response.json(mentionPayload(workspaceId)); }
async function mount(module: "monitoring" | "mentions" | "topics" = "mentions", studies = false) {
  const element = document.createElement("div"); document.body.appendChild(element);
  const root: Root = createRoot(element);
  const render = async (workspaceId = "workspace") => {
    await act(async () => root.render(createElement(StrictMode, null, createElement(AppRouterContext.Provider, { value: router }, createElement(NextIntlClientProvider,
      { locale: "en-US", messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>, createElement(SignalV2BrandMonitoring,
        { key: `${workspaceId}:${module}`, activeModule: module, activeStudy: null, brandName: "Synthetic QA",
          deferredInitialModule: module, canRefreshInsights: false,
          initialData: { ...base, workspace: { ...base.workspace, id: workspaceId } },
          initialMention: null, initialMentions: null, initialSettings: null,
          initialTopicsNarratives: null, initialTriggersBarriers: null, legacyOutputId: null, manageTopicsHref: null,
          strategicStudies: studies ? [{ id: "triggers-barriers", reportKey: "triggers-barriers", title: "Triggers & Barriers",
            href: "/signal/synthetic/reports/triggers-barriers", status: "not_available", legacyOutputId: null,
            currentRelease: null, releases: [] }] : [], userName: "Synthetic operator", workspaceOptions: [], workspaceSubjectId: "brand", viewKey: "all_conversations" }))))));
  };
  await render();
  return { element, render, async close() { await act(async () => root.unmount()); element.remove(); } };
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); }
async function until(ready: () => boolean) {
  const deadline = performance.now() + 30_000;
  while (!ready() && performance.now() < deadline) await settle();
  assert.ok(ready(), document.body.textContent?.slice(-500));
}
async function click(element: Element | null) {
  assert.ok(element);
  await act(async () => { element.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event); });
}
const isEvidenceVisible = () => document.body.textContent?.includes("Synthetic evidence from the native read") ?? false;
function refreshButton() { return [...document.querySelectorAll("button")].find(button => button.textContent === "Refresh") ?? null; }

test("the mounted native shell starts exactly one deferred read in StrictMode and keeps the URL filters", async () => {
  const calls: string[] = [], saved = globalThis.fetch;
  browser.history.replaceState(null, "", "/signal/synthetic/mentions?view=all_conversations&date_from=2026-09-01");
  globalThis.fetch = async input => { calls.push(String(input)); return new Response("{}", { status: 403 }); };
  const app = await mount();
  try {
    await until(() => Boolean(document.querySelector('[role="alert"]'))); await settle(); assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]!, browser.location.origin).searchParams.get("date_from"), "2026-09-01");
    assert.ok(document.querySelector('[role="alert"]')); assert.ok(refreshButton());
  } finally { await app.close(); globalThis.fetch = saved; }
});

test("a transport rejection retries once, renders the real table, and opens its excerpt without a document reload", async () => {
  const calls: string[] = [], saved = globalThis.fetch;
  browser.history.replaceState(null, "", "/signal/synthetic/mentions?view=all_conversations");
  globalThis.fetch = async input => { calls.push(String(input)); if (calls.length === 1) throw new TypeError("Failed to fetch"); return response(); };
  const app = await mount();
  try {
    await until(isEvidenceVisible); assert.equal(calls.length, 2); assert.equal(calls[0], calls[1]);
    await click(document.querySelector("tbody tr"));
    assert.ok(document.body.textContent?.includes("Mention excerpt"));
    assert.equal(browser.location.search.includes("mention="), true);
  } finally { await app.close(); globalThis.fetch = saved; }
});

test("two transport failures expose an actionable refresh which succeeds on the same mounted document", async () => {
  let calls = 0; const saved = globalThis.fetch;
  browser.history.replaceState(null, "", "/signal/synthetic/mentions?view=all_conversations");
  globalThis.fetch = async () => { if (++calls <= 2) throw new TypeError("network changed"); return response(); };
  const app = await mount();
  try {
    await until(() => Boolean(document.querySelector('[role="alert"]'))); assert.equal(calls, 2);
    await click(refreshButton()); await until(isEvidenceVisible); assert.equal(calls, 3);
    assert.equal(app.element.isConnected, true);
  } finally { await app.close(); globalThis.fetch = saved; }
});

for (const status of [401, 403, 404, 409, 422]) {
  test(`native navigation does not retry permission, scope or validation status ${status}`, async () => {
    let calls = 0; const saved = globalThis.fetch;
    globalThis.fetch = async () => { calls++; return new Response("{}", { status }); };
    const app = await mount();
    try { await until(() => Boolean(document.querySelector('[role="alert"]'))); await settle(); assert.equal(calls, 1); }
    finally { await app.close(); globalThis.fetch = saved; }
  });
}

for (const status of [502, 503, 504]) {
  test(`native navigation recovers from one proxy status ${status}`, async () => {
    let calls = 0; const saved = globalThis.fetch;
    globalThis.fetch = async () => ++calls === 1 ? new Response("{}", { status }) : response();
    const app = await mount();
    try { await until(isEvidenceVisible); assert.equal(calls, 2); }
    finally { await app.close(); globalThis.fetch = saved; }
  });
}

test("a scope change aborts the old GET and discards its late response without retrying", async () => {
  const calls: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
  let finishOld: ((value: Response) => void) | undefined;
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), signal: init?.signal });
    if (calls.length === 1) return new Promise<Response>(resolve => { finishOld = resolve; });
    return response("other-workspace");
  };
  const app = await mount();
  try {
    await until(() => calls.length === 1); await app.render("other-workspace");
    await until(isEvidenceVisible); assert.equal(calls[0]!.signal?.aborted, true);
    await act(async () => { finishOld!(response()); }); await settle();
    assert.equal(calls.length, 2); assert.ok(calls[1]!.url.includes("other-workspace"));
    assert.equal(document.querySelectorAll("tbody tr").length, 1);
  } finally { await app.close(); globalThis.fetch = saved; }
});

test("the mounted shell waits for network recovery before sending its second GET", async t => {
  const schedule = browser.setTimeout.bind(browser), saved = globalThis.fetch;
  let releaseRetry: (() => void) | undefined, calls = 0;
  t.mock.method(browser, "setTimeout", ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 1_500) {
      const timer = schedule(() => undefined, 120_000);
      releaseRetry = () => { browser.clearTimeout(timer); callback(...args); };
      return timer;
    }
    return schedule(callback, delay, ...args);
  }) as typeof browser.setTimeout);
  globalThis.fetch = async () => { if (++calls === 1) throw new TypeError("network changed"); return response(); };
  const app = await mount();
  try {
    await until(() => Boolean(releaseRetry)); await settle(); assert.equal(calls, 1);
    await act(async () => releaseRetry!()); await until(isEvidenceVisible); assert.equal(calls, 2);
  } finally { await app.close(); globalThis.fetch = saved; }
});

test("unmount during the network recovery wait cancels the second GET", async t => {
  const schedule = browser.setTimeout.bind(browser), saved = globalThis.fetch;
  let releaseRetry: (() => void) | undefined, calls = 0;
  t.mock.method(browser, "setTimeout", ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 1_500) {
      const timer = schedule(() => undefined, 120_000);
      releaseRetry = () => { browser.clearTimeout(timer); callback(...args); };
      return timer;
    }
    return schedule(callback, delay, ...args);
  }) as typeof browser.setTimeout);
  globalThis.fetch = async () => { calls++; throw new TypeError("network changed"); };
  const app = await mount();
  try {
    await until(() => Boolean(releaseRetry)); await app.close();
    await act(async () => releaseRetry!()); await settle(); assert.equal(calls, 1);
  } finally { globalThis.fetch = saved; }
});

test("an aborted pending read on unmount is not retried", async () => {
  let calls = 0, requestSignal: AbortSignal | null | undefined;
  const saved = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls++; requestSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true }));
  };
  const app = await mount();
  try {
    await until(() => calls === 1); await app.close();
    assert.equal(requestSignal?.aborted, true); await settle(); assert.equal(calls, 1);
  } finally { globalThis.fetch = saved; }
});


function overviewPayload() {
  return { contract_version: "signal-workspace-topics-serving-v1", source: "workspace_imported", classification_state: "pending",
    workspace_id: "workspace", corpus_id: null, scope: "all_conversations", generation_id: null, source_engine_execution_id: null,
    is_current: true, is_processing: false, selection_revision: 0, filters: { date_from: null, date_to: null },
    available_dates: { date_from: "2026-09-01", date_to: "2026-09-24" }, scope_digest: "sha256:synthetic",
    observed_at: "2026-09-24T00:00:00Z", denominator: 1, evidence_visible_total: 1,
    coverage: { processed: null, assigned_unique: null, abstained: null, noise: null, unresolved: null, withheld: null },
    quality: "not_analyzed", interpretation_coverage: null, terms: [], series: [], limitations: ["classification_required"] };
}

test("Topics to Mentions uses the native API and applies the table on the mounted shell", async () => {
  const calls: string[] = [], saved = globalThis.fetch;
  browser.history.replaceState(null, "", "/signal/synthetic/topics-narratives?view=all_conversations");
  globalThis.fetch = async url => {
    calls.push(String(url));
    return String(url).includes("/mentions?") ? response() : Response.json(overviewPayload());
  };
  const app = await mount("topics");
  try {
    await until(() => !document.querySelector(".signal-v2-module-skeleton"));
    await click(document.querySelector('a[href*="/mentions"]'));
    await until(isEvidenceVisible);
    assert.equal(calls.length, 2); assert.ok(calls[1]!.includes("/mentions?"));
    assert.equal(browser.location.pathname, "/signal/synthetic/mentions");
    // Happy DOM truncates forward history on replaceState. Restore the saved URL
    // and dispatch its native traversal event to exercise the real popstate handler.
    await act(async () => {
      browser.history.replaceState(null, "", "/signal/synthetic/topics-narratives?view=all_conversations");
      browser.dispatchEvent(new browser.PopStateEvent("popstate"));
    });
    await until(() => calls.length === 3 && browser.location.pathname.endsWith("topics-narratives")
      && !isEvidenceVisible() && !document.querySelector(".signal-v2-module-skeleton"));
    await act(async () => {
      browser.history.replaceState(null, "", "/signal/synthetic/mentions?view=all_conversations");
      browser.dispatchEvent(new browser.PopStateEvent("popstate"));
    });
    await until(() => browser.location.pathname.endsWith("/mentions") && isEvidenceVisible());
    assert.equal(calls.length, 4);
  } finally { await app.close(); globalThis.fetch = saved; }
});

for (const target of ["monitoring", "topics"] as const) {
  test(`${target} bootstrap failure preserves the original all-time URL`, async () => {
    const saved = globalThis.fetch;
    const path = `/signal/synthetic${target === "topics" ? "/topics-narratives" : ""}?view=all_conversations`;
    browser.history.replaceState(null, "", path);
    globalThis.fetch = async () => { throw new TypeError("network changed"); };
    const app = await mount(target);
    try {
      await until(() => Boolean(document.querySelector('[role="alert"]')));
      assert.equal(browser.location.pathname + browser.location.search, path);
    } finally { await app.close(); globalThis.fetch = saved; }
  });
}

test("a study opened during bootstrap can replace the cancelled initial read and resolve its skeleton", async () => {
  let firstSignal: AbortSignal | null | undefined;
  const saved = globalThis.fetch;
  browser.history.replaceState(null, "", "/signal/synthetic/topics-narratives?view=all_conversations");
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("triggers-barriers")) {
      firstSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => firstSignal?.addEventListener("abort", () => reject(firstSignal?.reason), { once: true }));
    }
    return Response.json({ contract_version: "signal-triggers-barriers-v2", workspace_id: "workspace",
      study: { id: "triggers-barriers", title: "Synthetic strategic report" }, cut: { analysis_id: "synthetic-analysis" },
      filter: base.filter, comparison: base.comparison, coverage: { date_from: "2026-09-01", date_through: "2026-09-24" },
      corpus: base.corpus, metrics: { coded_mentions_total: 0 }, findings: [], finding_time_series: [],
      initial_finding: null, initial_evidence: null });
  };
  const app = await mount("topics", true);
  try {
    await until(() => Boolean(firstSignal));
    await click(document.querySelector('a[href*="/reports/triggers-barriers"]'));
    await until(() => document.body.textContent?.includes("Synthetic strategic report") ?? false);
    assert.equal(firstSignal?.aborted, true);
    assert.equal(browser.location.pathname, "/signal/synthetic/reports/triggers-barriers");
  } finally { await app.close(); globalThis.fetch = saved; }
});

test("a stalled GET times out twice and exposes manual refresh even when fetch rejects AbortError", async t => {
  const expiries: Array<() => void> = [], saved = globalThis.fetch;
  const schedule = browser.setTimeout.bind(browser);
  t.mock.method(browser, "setTimeout", ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 60_000) { expiries.push(() => callback(...args)); return schedule(() => undefined, 120_000); }
    return schedule(callback, delay, ...args);
  }) as typeof browser.setTimeout);
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  };
  const app = await mount();
  try {
    await until(() => expiries.length === 1);
    await act(async () => expiries.shift()!());
    await until(() => calls === 2 && expiries.length === 1);
    await act(async () => expiries.shift()!());
    await until(() => Boolean(document.querySelector('[role="alert"]')));
    assert.equal(calls, 2); assert.ok(refreshButton());
  } finally { await app.close(); globalThis.fetch = saved; }
});

test("the same attempt deadline also bounds a stalled module chunk", async t => {
  const expiries: Array<() => void> = [], saved = globalThis.fetch;
  const schedule = browser.setTimeout.bind(browser);
  t.mock.method(browser, "setTimeout", ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 60_000) { expiries.push(() => callback(...args)); return schedule(() => undefined, 120_000); }
    return schedule(callback, delay, ...args);
  }) as typeof browser.setTimeout);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(); };
  const pending = readSignalModule("/synthetic", new AbortController().signal, () => new Promise(() => undefined));
  const rejected = assert.rejects(pending, { name: "TimeoutError" });
  try {
    await until(() => expiries.length === 1); expiries.shift()!();
    await until(() => calls === 2 && expiries.length === 1); expiries.shift()!();
    await rejected; assert.equal(calls, 2);
  } finally { globalThis.fetch = saved; }
});

test("the explicit native entry authorizes before returning a lightweight shell and leaves other scopes on their reader path", async () => {
  const source = await readFile(new URL("../../components/signal-v2/SignalV2WorkspacePage.tsx", import.meta.url), "utf8");
  const start = source.indexOf('if (query.view === "all_conversations" && !activeReportKey');
  const end = source.indexOf('if (activeModule === "mentions" && !activeReportKey)', start);
  assert.ok(start > source.indexOf("await requirePortalUser(returnPath)"));
  assert.ok(start > source.indexOf("await resolveSignalWorkspaceForUser"));
  assert.ok(start > source.indexOf('if (!workspace || workspace.status !== "active") notFound()'));
  const branch = source.slice(start, end);
  assert.match(branch, /activeModule === "monitoring".*activeModule === "mentions".*activeModule === "topics"/u);
  assert.match(branch, /deferredInitialModule=\{activeModule\}/u);
  assert.doesNotMatch(branch, /loadNativeSignal(?:TopicsPage|Mentions)V1/u);
  assert.match(source.slice(end), /await loadNativeSignalMentionsV1/u);
  assert.match(source.slice(end), /await loadNativeSignalTopicsPageV1/u);
});
