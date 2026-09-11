import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { ClientProcessingJourney } from "../../components/brands/ClientProcessingJourney";
import { clientCorpusPreparationActionV1, clientCorpusPreparationInitialSnapshotV1, clientCorpusPreparationPollDelayV1,
  clientCorpusPreparationRejectionIsDefinitiveV1, clientCorpusPreparationRequestV1,
  clientCorpusPreparationRequestWasObservedV1, clientCorpusPreparationStageStateV1, latestClientCorpusPreparationSnapshotV1,
  validClientCorpusPreparationViewV1, type ClientCorpusPreparationViewV1
} from "../../components/brands/ClientCorpusPreparationStep";
import { clientProcessingPolicyForWorkspaceV1, clientProcessingRouteMaximumMicroUsdV1, clientProcessingStageStateV1,
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
const counts = { total_roots: 20, processed_roots: 20, eligible_roots: 16, excluded_roots: 2,
  rights_blocked_roots: 1, inclusion_pending_roots: 0, missing_text_roots: 1, reused_roots: 0,
  new_roots: 20, changed_roots: 0, removed_roots: 0, chunk_count: 24 };
const completedRun = { id: "preparation-run", status: "completed" as const, phase: "complete" as const,
  input_revision: 2, counts, error_code: null, retryable: false,
  created_at: "2026-09-11T08:00:00.000000Z", updated_at: "2026-09-11T08:01:00.000000Z",
  completed_at: "2026-09-11T08:01:00.000000Z" };
const preparation: ClientCorpusPreparationViewV1 = {
  contract_version: "signal-workspace-corpus-preparation-v1", workspace_id: workspaceId,
  observed_at: "2026-09-11T08:02:00.000000Z", input_revision: 2, can_prepare: true,
  active_run: null, latest_run: completedRun, latest_completed: completedRun,
  is_current: true, needs_preparation: false
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
  assert.equal(clientProcessingPolicyForWorkspaceV1(ready, workspaceId), ready);
  assert.equal(clientProcessingPolicyForWorkspaceV1(ready, "another-workspace"), null,
    "a route change cannot render the previous workspace policy while its replacement loads");
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

test("client text preparation is provider-free, idempotent and independent from paid policy availability", () => {
  assert.equal(validClientCorpusPreparationViewV1(preparation), true);
  assert.equal(clientCorpusPreparationStageStateV1(preparation), "ready");
  assert.equal(clientCorpusPreparationActionV1(preparation), null);
  const pending = { ...preparation, latest_run: null, latest_completed: null, is_current: false, needs_preparation: true };
  assert.equal(clientCorpusPreparationActionV1(pending), "prepare");
  assert.equal(clientCorpusPreparationStageStateV1(pending), "blocked");
  assert.equal(clientCorpusPreparationActionV1({ ...pending, input_revision: 0 }), null,
    "an empty brand must import mentions before the free request is offered");
  assert.equal(clientCorpusPreparationActionV1({ ...pending, can_prepare: false }), null);
  const active = { ...completedRun, id: "active-run", status: "running" as const, phase: "chunking" as const,
    counts: { ...counts, processed_roots: 5 }, completed_at: null };
  assert.equal(clientCorpusPreparationActionV1({ ...pending, active_run: active, latest_run: active }), null);
  const retryable = { ...active, status: "failed" as const, error_code: "corpus_preparation_worker_failed", retryable: true };
  assert.equal(clientCorpusPreparationActionV1({ ...pending, active_run: null, latest_run: retryable }), "resume");
  assert.equal(clientCorpusPreparationActionV1({ ...pending, active_run: null, latest_run: { ...retryable,
    retryable: false, error_code: "corpus_preparation_asset_hash_mismatch" } }), null);
  assert.equal(clientCorpusPreparationActionV1({ ...pending, input_revision: 3, active_run: null,
    latest_run: { ...retryable, retryable: false, error_code: "corpus_preparation_asset_hash_mismatch" } }), "restart");
  const request = { workspaceId, previousRunId: completedRun.id, previousRunUpdatedAt: completedRun.updated_at };
  assert.equal(clientCorpusPreparationRequestWasObservedV1(preparation, request), true);
  assert.equal(clientCorpusPreparationRequestWasObservedV1({ ...preparation, workspace_id: "other" }, request), false,
    "a late response from another workspace cannot confirm the current request");
  assert.equal(latestClientCorpusPreparationSnapshotV1(preparation,
    { ...preparation, observed_at: "2026-09-11T08:01:30.000000Z" }, workspaceId), preparation);
  assert.equal(latestClientCorpusPreparationSnapshotV1(preparation,
    { ...preparation, workspace_id: "other", observed_at: "2026-09-11T08:03:00.000000Z" }, workspaceId), preparation,
  "a newer cross-workspace snapshot is still rejected");
  assert.equal(validClientCorpusPreparationViewV1({ ...preparation, observed_at: "yesterday" }), false);
  const nextWorkspace = { ...preparation, workspace_id: "another-workspace" };
  assert.equal(clientCorpusPreparationInitialSnapshotV1(nextWorkspace, "another-workspace"), nextWorkspace,
    "a valid initial snapshot is adopted when navigation changes to its workspace");
  assert.equal(clientCorpusPreparationInitialSnapshotV1(preparation, "another-workspace"), null,
    "an old initial snapshot forces a scoped GET instead of retaining old data");
  const first = clientCorpusPreparationRequestV1(null, workspaceId, preparation, () => "first-key");
  assert.equal(first.key, "first-key");
  assert.equal(clientCorpusPreparationRequestV1(first, workspaceId, preparation, () => "must-not-run"), first,
    "a network-uncertain retry keeps the exact request key");
  const second = clientCorpusPreparationRequestV1(first, "another-workspace", preparation, () => "second-key");
  assert.equal(second.key, "second-key");
  assert.equal(second.workspaceId, "another-workspace");
  assert.equal(clientCorpusPreparationRejectionIsDefinitiveV1(409), true);
  assert.equal(clientCorpusPreparationRejectionIsDefinitiveV1(503), false);
  assert.equal(clientCorpusPreparationPollDelayV1({ ...preparation, active_run: {
    ...completedRun, status: "queued", phase: "queued", completed_at: null } }), 4_000);
  assert.equal(clientCorpusPreparationPollDelayV1(preparation), null);
});

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (initial: ClientProcessingPolicyViewV1, initialPreparation = preparation) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(ClientProcessingJourney, { workspaceId, initial, initialPreparation })));

  test(`${locale}: client processing is a three-step product view without internal provider controls`, () => {
    const html = render(ready);
    for (const stage of ["prepare", "vectors", "analyze"]) assert.match(html,
      new RegExp(`data-processing-stage="${stage}"[^>]*data-processing-stage-state="ready"`, "u"));
    for (const text of [messages.ClientProcessing.budget.routeMaximum,
      messages.ClientProcessing.budget.availableToday, messages.ClientProcessing.quoteNotice]) assert.ok(html.includes(text));
    assert.match(html, /data-client-processing-policy/u);
    assert.doesNotMatch(html, /voyage|private-model|policy-private-id|sha256:|<input|<select|type="submit"/u);
    assert.equal((html.match(/<button/gu) ?? []).length, 2, "policy and free preparation expose independent refreshes");
  });

  test(`${locale}: missing policy and read-only access keep the route visible without exposing budget`, () => {
    const missing = render({ ...ready, status: "missing", policy: null, budget_date: null,
      exposure: { confirmed_micro_usd: "0", reserved_micro_usd: "0", ambiguous_micro_usd: "0", total_micro_usd: "0" },
      remaining_micro_usd: "0", actions: [] });
    assert.ok(missing.includes(messages.ClientProcessing.states.missing));
    assert.doesNotMatch(missing, /admin-summary-strip/u);
    assert.match(missing, /data-processing-stage="prepare"[^>]*data-processing-stage-state="ready"/u,
      "free text preparation remains ready without a paid policy");
    const readOnly = render({ ...ready, can_request_processing: false });
    assert.ok(readOnly.includes(messages.ClientProcessing.readOnly));
    assert.doesNotMatch(readOnly, /admin-summary-strip|policy-private-id|private-provider/u);
    assert.equal((readOnly.match(/data-processing-stage-state="unavailable"/gu) ?? []).length, 2,
      "paid stages are unavailable while an already prepared free stage remains current");
  });

  test(`${locale}: pending client preparation exposes one free action without provider or budget input`, () => {
    const pending = { ...preparation, latest_run: null, latest_completed: null, is_current: false, needs_preparation: true };
    const html = render({ ...ready, status: "missing", policy: null, budget_date: null,
      exposure: { confirmed_micro_usd: "0", reserved_micro_usd: "0", ambiguous_micro_usd: "0", total_micro_usd: "0" },
      remaining_micro_usd: "0", actions: [] }, pending);
    assert.ok(html.includes(messages.ClientProcessing.stages.prepare.actions.prepare));
    assert.ok(html.includes(messages.ClientProcessing.stages.prepare.free));
    assert.match(html, /data-processing-stage="prepare"[^>]*data-processing-stage-state="blocked"/u);
    assert.doesNotMatch(html, /voyage|anthropic|private-model|policy-private-id|<input|<select|type="submit"/u);
  });

  test(`${locale}: empty, read-only and active preparation states do not offer duplicate work`, () => {
    const empty = render(ready, { ...preparation, input_revision: 0, latest_run: null, latest_completed: null,
      is_current: false, needs_preparation: true });
    assert.ok(empty.includes(messages.ClientProcessing.stages.prepare.help.awaiting_import));
    assert.ok(!empty.includes(`>${messages.ClientProcessing.stages.prepare.actions.prepare}</button>`));
    const readOnly = render(ready, { ...preparation, can_prepare: false, latest_run: null, latest_completed: null,
      is_current: false, needs_preparation: true });
    assert.ok(readOnly.includes(messages.ClientProcessing.stages.prepare.help.read_only));
    assert.ok(!readOnly.includes(`>${messages.ClientProcessing.stages.prepare.actions.prepare}</button>`));
    const active = { ...completedRun, id: "active-run", status: "running" as const, phase: "chunking" as const,
      counts: { ...counts, processed_roots: 5 }, completed_at: null };
    const running = render(ready, { ...preparation, active_run: active, latest_run: active,
      latest_completed: null, is_current: false, needs_preparation: true });
    assert.match(running, /<progress[^>]*max="20"[^>]*value="5"/u);
    assert.ok(running.includes(messages.ClientProcessing.stages.prepare.progressLabel));
    for (const action of ["prepare", "update", "resume", "restart"] as const)
      assert.ok(!running.includes(`>${messages.ClientProcessing.stages.prepare.actions[action]}</button>`));
  });
}
