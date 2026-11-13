import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { NextIntlClientProvider } from "next-intl";
import type { SignalConversationSegmentV1 } from "@noisia/query-engine";
import { useNativeMonitoringInsights, type NativeMonitoringInsightsView } from "../../components/signal-v2/useNativeMonitoringInsights";
import { NativeMonitoringInsightControls } from "../../components/signal-v2/NativeMonitoringInsightControls";

const browser = new Window({ url: "https://studio.example.test/signal/synthetic/monitoring" });
Object.assign(globalThis, { window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true });
const messages = JSON.parse(await readFile(new URL("../../../messages/en-US.json", import.meta.url), "utf8"));
const view = {
  contract_version: "signal-workspace-monitoring-insights-view-v1", workspace_id: "workspace", request_scope: "sha256:scope",
  observed_at: "2026-11-13T00:00:00Z",
  monthly_insights: { contract_version: "signal-monthly-insights-v1", candidate_hash: null, cadence: "rolling_30_days",
    independent_of_page_filter: false, independent_of_page_period: true, scope_segment: "conversation", editorial_locale: "es-MX", window: null,
    comparison_window: null, calculated_through: null, context: { state: "not_available", objectives: 0, briefs: 0,
      audiences: 0, approved_assertions: 0 }, interpretation_state: "not_available", items: [] },
  authorization: { can_request: true, provider_available: true, blocked_reason: null, max_budget_micro_usd: 2_000_000 }, run: null
} as NativeMonitoringInsightsView;
const quote = { contract_version: "signal-workspace-monitoring-insights-quote-v1", workspace_id: "workspace", request_scope: "sha256:scope", quote_digest: "sha256:quote",
  packet_digest: "sha256:packet", scope_digest: "sha256:scope", expires_at: new Date(Date.now() + 60_000).toISOString(), reserved_micro_usd: 100_000, budget_cap_micro_usd: 2_000_000 };
function Harness({ workspaceId, segment, locale }: { workspaceId: string; segment: SignalConversationSegmentV1; locale: "es-MX" | "en-US" }) {
  const insights = useNativeMonitoringInsights(workspaceId, true, "Could not load insights", segment, locale);
  return createElement(NativeMonitoringInsightControls, { insights });
}
async function mount() {
  const element = document.createElement("div"); document.body.appendChild(element); const root = createRoot(element);
  const render = async (workspaceId = "workspace", segment: SignalConversationSegmentV1 = "conversation", locale: "es-MX" | "en-US" = "es-MX") => { await act(async () => root.render(createElement(NextIntlClientProvider,
    { locale: "en-US", messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>, createElement(Harness, { workspaceId, segment, locale })))); };
  await render();
  return { element, render, async close() { await act(async () => root.unmount()); element.remove(); } };
}
async function until(ready: () => boolean) {
  const deadline = performance.now() + 30_000;
  while (!ready() && performance.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(ready(), document.body.textContent ?? "No body");
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(item => item.textContent?.includes(label));
  assert.ok(button); assert.equal(button.disabled, false);
  await act(async () => button.click());
}

test("native insight controls read capability before showing a paid action and never POST on mount", async () => {
  const calls: string[] = []; globalThis.fetch = async (url, options) => {
    calls.push(`${options?.method ?? "GET"} ${url}`);
    return Response.json({ ...view, authorization: { ...view.authorization, can_request: false } });
  };
  const mounted = await mount();
  try { await until(() => calls.length === 1); assert.equal(mounted.element.querySelector("button"), null); assert.ok(calls.every(call => call.startsWith("GET "))); }
  finally { await mounted.close(); }
});
test("native paid action previews an exact quote and requires confirmation before the only POST", async () => {
  const posts: RequestInit[] = []; globalThis.fetch = async (url, options) => {
    if (String(url).includes("/quote?")) return Response.json(quote);
    if (options?.method === "POST") { posts.push(options); return Response.json({ ...view, run: { id: "run", status: "completed" } }); }
    return Response.json(view);
  };
  const mounted = await mount();
  try {
    await until(() => mounted.element.textContent!.includes("up to USD 2"));
    assert.equal(posts.length, 0); await click("Analyze insights");
    await until(() => mounted.element.textContent!.includes("Maximum: USD 2.00")); assert.equal(posts.length, 0);
    await click("Confirm analysis"); await until(() => posts.length === 1);
    assert.deepEqual(JSON.parse(posts[0]!.body as string), { quote_digest: quote.quote_digest, budget_cap_micro_usd: 2_000_000 });
    assert.ok((posts[0]!.headers as Record<string, string>)["Idempotency-Key"]);
  } finally { await mounted.close(); }
});
test("an uncertain POST preserves its exact quote and identity without an automatic replay", async () => {
  const posts: RequestInit[] = []; globalThis.fetch = async (url, options) => {
    if (String(url).includes("/quote?")) return Response.json(quote);
    if (options?.method === "POST") { posts.push(options); if (posts.length === 1) throw new TypeError("Network changed"); return Response.json({ ...view, run: { id: "run", status: "completed" } }); }
    return Response.json(view);
  };
  const mounted = await mount();
  try {
    await until(() => mounted.element.textContent!.includes("up to USD 2")); await click("Analyze insights");
    await until(() => mounted.element.textContent!.includes("Confirm analysis")); await click("Confirm analysis");
    await until(() => mounted.element.textContent!.includes("Network changed")); assert.equal(posts.length, 1);
    assert.ok(![...mounted.element.querySelectorAll("button")].some(button => button.textContent === "Cancel"));
    await click("Retry the same request"); await until(() => posts.length === 2);
    assert.deepEqual(posts[0]!.headers, posts[1]!.headers); assert.equal(posts[0]!.body, posts[1]!.body);
  } finally { await mounted.close(); }
});
test("a segment change sends the exact selected population and rejects a late response from the previous one", async () => {
  const urls: string[] = []; let release!: (response: Response) => void; let signal: AbortSignal | undefined | null;
  globalThis.fetch = async (url, options) => { urls.push(String(url)); signal = options?.signal; return new Promise(resolve => { release = resolve; }); };
  const mounted = await mount();
  try {
    const oldSignal = signal;
    globalThis.fetch = async url => { urls.push(String(url)); return Response.json({ ...view, monthly_insights: { ...view.monthly_insights, scope_segment: "advertising" },
      authorization: { ...view.authorization, can_request: false } }); };
    await mounted.render("workspace", "advertising"); assert.equal(oldSignal?.aborted, true);
    await act(async () => release(Response.json(view)));
    assert.ok(!mounted.element.textContent!.includes("up to USD 2"));
    assert.match(urls[0]!, /conversation_segment=conversation&locale=es-MX$/);
    assert.match(urls[1]!, /conversation_segment=advertising&locale=es-MX$/);
    assert.ok(urls.every(url => !url.includes("date_from") && !url.includes("date_to")));
  } finally { await mounted.close(); }
});
test("an unknown provider outcome permits only status reconciliation", async () => {
  let reads = 0; globalThis.fetch = async () => { reads++; return Response.json({ ...view, run: { id: "run", status: "outcome_unknown" } }); };
  const mounted = await mount();
  try {
    await until(() => mounted.element.textContent!.includes("Reconciling the previous request"));
    assert.equal(mounted.element.querySelector<HTMLButtonElement>("button")?.disabled, true);
    await click("Check status"); assert.equal(reads, 2);
  } finally { await mounted.close(); }
});
test("a workspace change aborts the old read and rejects its late capability", async () => {
  let release!: (response: Response) => void; let signal: AbortSignal | undefined | null;
  globalThis.fetch = async (_url, options) => { signal = options?.signal; return new Promise(resolve => { release = resolve; }); };
  const mounted = await mount();
  try {
    const oldSignal = signal; globalThis.fetch = async () => Response.json({ ...view, workspace_id: "other", authorization: { ...view.authorization, can_request: false } });
    await mounted.render("other"); assert.equal(oldSignal?.aborted, true);
    await act(async () => release(Response.json(view)));
    assert.ok(!mounted.element.textContent!.includes("up to USD 2"));
  } finally { await mounted.close(); }
});
test("changing language aborts the previous scope and requests matching editorial copy", async () => {
  const urls: string[] = []; let release!: (response: Response) => void; let oldSignal: AbortSignal | undefined | null;
  globalThis.fetch = async (url, options) => { urls.push(String(url)); oldSignal = options?.signal; return new Promise(resolve => { release = resolve; }); };
  const mounted = await mount();
  try {
    globalThis.fetch = async url => { urls.push(String(url)); return Response.json({ ...view, monthly_insights: { ...view.monthly_insights, editorial_locale: "en-US" },
      authorization: { ...view.authorization, can_request: false } }); };
    await mounted.render("workspace", "conversation", "en-US"); assert.equal(oldSignal?.aborted, true);
    await act(async () => release(Response.json(view)));
    assert.ok(!mounted.element.textContent!.includes("up to USD 2"));
    assert.match(urls[0]!, /locale=es-MX$/); assert.match(urls[1]!, /locale=en-US$/);
  } finally { await mounted.close(); }
});
test("a quote outside the capability scope or cap cannot create a paid intent", async () => {
  for (const invalid of [{ ...quote, request_scope: "sha256:another" }, { ...quote, budget_cap_micro_usd: 3_000_000 },
    { ...quote, reserved_micro_usd: 2_000_001 }, { ...quote, expires_at: "invalid" }]) {
    let posts = 0; globalThis.fetch = async (url, options) => {
      if (options?.method === "POST") posts++;
      return Response.json(String(url).includes("/quote?") ? invalid : view);
    };
    const mounted = await mount();
    try {
      await until(() => mounted.element.textContent!.includes("up to USD 2")); await click("Analyze insights");
      await until(() => mounted.element.textContent!.includes("Could not load insights"));
      assert.ok(!mounted.element.textContent!.includes("Confirm analysis")); assert.equal(posts, 0);
    } finally { await mounted.close(); }
  }
});
test("revoked authorization clears a displayed quote and capability", async () => {
  globalThis.fetch = async url => Response.json(String(url).includes("/quote?") ? quote : view);
  const mounted = await mount();
  try {
    await until(() => mounted.element.textContent!.includes("up to USD 2")); await click("Analyze insights");
    await until(() => mounted.element.textContent!.includes("Confirm analysis"));
    globalThis.fetch = async () => Response.json({ message: "Access denied" }, { status: 403 });
    await click("Confirm analysis"); await until(() => mounted.element.textContent!.includes("Access denied"));
    assert.ok(!mounted.element.textContent!.includes("Confirm analysis")); assert.ok(!mounted.element.textContent!.includes("up to USD 2"));
  } finally { await mounted.close(); }
});
