import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { ClientProcessingJourney } from "../../components/brands/ClientProcessingJourney";
import { clientProcessingRouteMaximumMicroUsdV1, clientProcessingStageStateV1,
  validClientProcessingPolicyViewV1, type ClientProcessingPolicyActionV1,
  type ClientProcessingPolicyViewV1 } from "./signal-processing-policy-ui";

Object.assign(globalThis, { React });
const hash = `sha256:${"a".repeat(64)}`;
const workspaceId = "00000000-0000-4000-8000-000000000001";
const action = (name: ClientProcessingPolicyActionV1["action"], kind: "free" | "provider",
  cap: string, available = true): ClientProcessingPolicyActionV1 => ({ action: name, kind,
  provider: kind === "provider" ? "voyage" : null,
  model: kind === "provider" ? "private-model" : null,
  configuration_digest: hash, max_execution_micro_usd: cap, automatic_allowed: false, available });
const ready: ClientProcessingPolicyViewV1 = {
  contract_version: "signal-processing-policy-view-v1", workspace_id: workspaceId,
  can_request_processing: true, status: "ready", budget_date: "2026-09-11",
  policy: { id: "policy-private-id", version: "2", digest: hash,
    valid_from: "2026-09-11T00:00:00.000Z", valid_until: "2026-10-11T00:00:00.000Z",
    budget_timezone: "America/Mexico_City", daily_cap_micro_usd: "5000000" },
  exposure: { confirmed_micro_usd: "100000", reserved_micro_usd: "200000",
    ambiguous_micro_usd: "300000", total_micro_usd: "600000" }, remaining_micro_usd: "4400000",
  actions: [action("corpus_preparation", "free", "0"),
    action("topic_prototype_embeddings", "provider", "100000"),
    action("corpus_embeddings", "provider", "400000"), action("topic_fit", "free", "0"),
    action("topic_interpretation", "provider", "1500000")]
};

test("processing-policy view validates exact monetary strings and exposes one initial-route ceiling", () => {
  assert.equal(validClientProcessingPolicyViewV1(ready), true);
  assert.equal(clientProcessingRouteMaximumMicroUsdV1(ready), "2000000");
  assert.equal(clientProcessingStageStateV1(ready, "prepare"), "ready");
  assert.equal(clientProcessingStageStateV1(ready, "vectors"), "ready");
  assert.equal(clientProcessingStageStateV1(ready, "analyze"), "ready");
  assert.equal(clientProcessingStageStateV1({ ...ready, actions: ready.actions.map(entry => entry.action === "corpus_embeddings"
    ? { ...entry, available: false } : entry) }, "vectors"), "blocked");
  assert.equal(clientProcessingStageStateV1({ ...ready, can_request_processing: false }, "analyze"), "unavailable");
});

test("processing-policy view rejects malformed, duplicated or inconsistent authority receipts", () => {
  for (const invalid of [
    { ...ready, workspace_id: "" },
    { ...ready, remaining_micro_usd: "0.10" },
    { ...ready, exposure: { ...ready.exposure, total_micro_usd: "599999" } },
    { ...ready, remaining_micro_usd: "4399999" },
    { ...ready, actions: [...ready.actions, ready.actions[0]] },
    { ...ready, actions: ready.actions.map(entry => entry.action === "corpus_preparation"
      ? { ...entry, max_execution_micro_usd: "1" } : entry) },
    { ...ready, policy: null },
    { ...ready, status: "missing", policy: null, budget_date: null, actions: ready.actions },
    { ...ready, policy: { ...ready.policy!, digest: "policy-private-id" } }
  ]) assert.equal(validClientProcessingPolicyViewV1(invalid), false);
  assert.equal(validClientProcessingPolicyViewV1({ ...ready, status: "missing", policy: null,
    budget_date: null, exposure: { confirmed_micro_usd: "0", reserved_micro_usd: "0",
      ambiguous_micro_usd: "0", total_micro_usd: "0" }, remaining_micro_usd: "0", actions: [] }), true);
});

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (initial: ClientProcessingPolicyViewV1) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(ClientProcessingJourney, { workspaceId, initial })));

  test(`${locale}: client processing is a three-step product view without internal provider controls`, () => {
    const html = render(ready);
    for (const stage of ["prepare", "vectors", "analyze"]) assert.match(html,
      new RegExp(`data-processing-stage="${stage}"[^>]*data-processing-stage-state="ready"`, "u"));
    for (const text of [messages.ClientProcessing.budget.routeMaximum,
      messages.ClientProcessing.budget.availableToday, messages.ClientProcessing.quoteNotice]) assert.ok(html.includes(text));
    assert.match(html, /data-client-processing-policy/u);
    assert.doesNotMatch(html, /voyage|private-model|policy-private-id|sha256:|<input|<select|type="submit"/u);
    assert.equal((html.match(/<button/gu) ?? []).length, 1, "the read-only cut exposes refresh only");
  });

  test(`${locale}: missing policy and read-only access keep the route visible without exposing budget`, () => {
    const missing = render({ ...ready, status: "missing", policy: null, budget_date: null,
      exposure: { confirmed_micro_usd: "0", reserved_micro_usd: "0", ambiguous_micro_usd: "0", total_micro_usd: "0" },
      remaining_micro_usd: "0", actions: [] });
    assert.ok(missing.includes(messages.ClientProcessing.states.missing));
    assert.doesNotMatch(missing, /admin-summary-strip/u);
    const readOnly = render({ ...ready, can_request_processing: false });
    assert.ok(readOnly.includes(messages.ClientProcessing.readOnly));
    assert.doesNotMatch(readOnly, /admin-summary-strip|policy-private-id|private-provider/u);
    assert.equal((readOnly.match(/data-processing-stage-state="unavailable"/gu) ?? []).length, 3);
  });
}
