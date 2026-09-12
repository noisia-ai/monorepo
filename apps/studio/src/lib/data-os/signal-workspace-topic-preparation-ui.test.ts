import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
import { TopicPreparationControls } from "../../components/brands/TopicPreparationControls";
import { latestTopicPreparation, parsePendingTopicPreparation, topicPreparationCanExecute, topicPreparationCanReplay,
  topicPreparationStorageKey, validTopicPreparationQuote, validTopicPreparationStatus,
  type PendingTopicPreparation, type TopicPreparationQuote, type TopicPreparationStatus } from "./signal-workspace-topic-preparation-ui";
Object.assign(globalThis, { React });
const digest = `sha256:${"a".repeat(64)}`;
const status: TopicPreparationStatus = { contract_version: "signal-workspace-topic-prototypes-v1", workspace_id: "local-workspace",
  observed_at: "2026-09-08T20:00:00.000001Z", current_plan_digest: digest, availability: "available", active_run: null,
  latest_run: null, latest_completed: null, request_run: null, is_current: false, blocking_run_kind: null,
  can_execute: true, provider_available: false, max_run_cost_micro_usd: 5_000_000, request_scope: "local-actor-workspace" };
const quote: TopicPreparationQuote = { contract_version: "signal-workspace-topic-prototypes-quote-v1", workspace_id: status.workspace_id,
  observed_at: status.observed_at, plan_digest: digest, quote_digest: `sha256:${"b".repeat(64)}`, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  total_topics: 4, total_input_references: 20, total_unique_inputs: 10, cached_unique_inputs: 10, missing_unique_inputs: 0,
  recoverable_receipt_inputs: 0, requires_provider: false, input_bytes: 0, tokens_upper: 0, estimated_upper_micro_usd: 0,
  resume_run_id: null, required_cap_micro_usd: null, blocking_run_kind: null, has_unknown_outcome: false, blocking_error_code: null,
  can_execute: true, provider_available: false, max_run_cost_micro_usd: status.max_run_cost_micro_usd, request_scope: status.request_scope };
const run: NonNullable<TopicPreparationStatus["latest_run"]> = { id: "run-local", plan_digest: digest, status: "failed", retryable: true,
  counts: { total_topics: 4, completed_topics: 2, partial_topics: 1, pending_topics: 1, total_input_references: 20, processed_input_references: 10,
    total_unique_inputs: 10, processed_unique_inputs: 5, cache_hits: 5, embedded_unique_inputs: 0 },
  hard_cap_micro_usd: 1500, estimated_upper_micro_usd: 1500, reserved_micro_usd: 500, settled_micro_usd: 800,
  unknown_reserved_micro_usd: 0, observed_exception_micro_usd: 0, error_code: "worker_failed", created_at: status.observed_at,
  updated_at: status.observed_at, completed_at: null };
const pending: PendingTopicPreparation = { version: 1, workspace_id: status.workspace_id, request_scope: status.request_scope,
  key: "00000000-0000-4000-8000-000000000001", body: { plan_digest: digest, quote_digest: quote.quote_digest, hard_cap_micro_usd: 1500 } };

test("preparation before any corpus allows only zero-cost cache with disabled provider", () => {
  assert.equal(validTopicPreparationStatus(status), true); assert.equal(validTopicPreparationQuote(quote), true);
  assert.equal(topicPreparationCanExecute(status, quote, "0"), true);
  assert.equal(topicPreparationCanExecute(status, quote, "0.001"), false);
  assert.equal(topicPreparationCanExecute(status, { ...quote, requires_provider: true, missing_unique_inputs: 10, estimated_upper_micro_usd: 1500 }, "0.0015"), false);
  assert.equal(topicPreparationCanExecute({ ...status, availability: "no_topics" }, quote, "0"), false);
});
test("durable received responses can recover without provider while retaining the original cap", () => {
  const recovered = { ...quote, cached_unique_inputs: 5, missing_unique_inputs: 5, recoverable_receipt_inputs: 5,
    resume_run_id: run.id, required_cap_micro_usd: 1500 };
  assert.equal(topicPreparationCanExecute(status, recovered, "0.0015"), true);
  assert.equal(topicPreparationCanExecute(status, recovered, "0"), false);
  assert.equal(topicPreparationCanExecute({ ...status, max_run_cost_micro_usd: 1 }, recovered, "0.0015"), true);
});
test("paid estimate uses exact integer caps, latest server limit, scope and saved plan", () => {
  const paid = { ...quote, requires_provider: true, provider_available: true, estimated_upper_micro_usd: 1500 };
  const enabled = { ...status, provider_available: true };
  assert.equal(topicPreparationCanExecute(enabled, paid, "0.0015"), true);
  for (const cap of ["0.001499", "5.000001", "1e-3", "NaN", "0,0015"]) assert.equal(topicPreparationCanExecute(enabled, paid, cap), false);
  for (const changed of [{ ...enabled, can_execute: false }, { ...enabled, current_plan_digest: `sha256:${"c".repeat(64)}` },
    { ...enabled, request_scope: "other" }, { ...enabled, max_run_cost_micro_usd: 1400 }]) assert.equal(topicPreparationCanExecute(changed, paid, "0.0015"), false);
});
test("unknown outcomes, unusable receipts, another kind of work and active requests suppress execution", () => {
  for (const changed of [{ ...quote, has_unknown_outcome: true }, { ...quote, blocking_run_kind: "corpus" as const },
    { ...quote, blocking_error_code: "workspace_embedding_prior_response_unusable" as const },
    { ...quote, blocking_error_code: "workspace_embedding_prior_run_unresolved" as const }]) {
    assert.equal(validTopicPreparationQuote(changed), true);
    assert.equal(topicPreparationCanExecute(status, changed, "0"), false);
  }
  assert.equal(topicPreparationCanExecute({ ...status, latest_run: { ...run, unknown_reserved_micro_usd: 1 } }, quote, "0"), false);
  assert.equal(topicPreparationCanExecute({ ...status, active_run: { ...run, status: "queued" } }, quote, "0"), false);
});
test("lost POST then failed retry uses the original body; queued/running/unknown never replay", () => {
  const failed = { ...status, provider_available: true, request_run: run };
  assert.equal(topicPreparationCanReplay(failed, pending, null), true);
  assert.equal(topicPreparationCanReplay({ ...failed, provider_available: false }, pending, null), false);
  assert.equal(topicPreparationCanReplay({ ...failed, provider_available: false }, pending, quote), true);
  assert.equal(topicPreparationCanReplay({ ...status, provider_available: true }, pending, null), true);
  for (const state of ["queued", "running", "completed", "stale", "canceled", "outcome_unknown"] as const) {
    assert.equal(topicPreparationCanReplay({ ...failed, request_run: { ...run, status: state } }, pending, null), false);
  }
  assert.equal(topicPreparationCanReplay({ ...failed, request_run: { ...run, retryable: false } }, pending, null), false);
  assert.equal(topicPreparationCanReplay({ ...failed, blocking_run_kind: "corpus" }, pending, null), false);
  assert.equal(topicPreparationCanReplay({ ...failed, current_plan_digest: `sha256:${"c".repeat(64)}` }, pending, null), false);
});
test("request recovery accepts only exact actor/workspace scoped key, body and safe amount", () => {
  assert.deepEqual(parsePendingTopicPreparation(JSON.parse(JSON.stringify(pending)), status.workspace_id, status.request_scope), pending);
  for (const changed of [{ ...pending, body: { ...pending.body, publish: true } }, { ...pending, key: "" },
    { ...pending, body: { ...pending.body, hard_cap_micro_usd: 0.1 } }]) assert.equal(parsePendingTopicPreparation(changed, status.workspace_id, status.request_scope), null);
  assert.equal(parsePendingTopicPreparation(pending, "other", status.request_scope), null);
  assert.equal(parsePendingTopicPreparation(pending, status.workspace_id, "other"), null);
  assert.notEqual(topicPreparationStorageKey(status.workspace_id, "other"), topicPreparationStorageKey(status.workspace_id, status.request_scope));
});
test("microsecond snapshots fence older completions and cannot reuse receipts across actor or workspace", () => {
  const newer = { ...status, observed_at: "2026-09-08T20:00:00.000002Z", is_current: true };
  assert.equal(latestTopicPreparation(newer, status, status.workspace_id), newer);
  assert.equal(latestTopicPreparation(newer, { ...status, workspace_id: "other" }, status.workspace_id), newer);
  assert.equal(latestTopicPreparation(newer, status, "other"), null);
  assert.equal(latestTopicPreparation(newer, { ...status, request_scope: "other" }, status.workspace_id)?.is_current, false);
});
test("malformed money, recovery pairs, unknown flags and counts are rejected before formatting or requesting", () => {
  for (const changed of [{ ...quote, required_cap_micro_usd: undefined }, { ...quote, estimated_upper_micro_usd: NaN },
    { ...quote, resume_run_id: run.id }, { ...quote, requires_provider: undefined }, { ...quote, blocking_error_code: undefined }]) assert.equal(validTopicPreparationQuote(changed), false);
  assert.equal(validTopicPreparationStatus({ ...status, latest_run: { ...run, reserved_micro_usd: -1 } }), false);
  assert.equal(validTopicPreparationStatus({ ...status, latest_completed: run }), false);
});
for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const text = messages.AdminWorkspace.topics.preparation;
  const render = (initialStatus = status, initialQuote: TopicPreparationQuote | null = quote, disabled = false) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>, createElement(TopicPreparationControls,
      { workspaceId: status.workspace_id, catalogVersion: "catalog:1", initialStatus, initialQuote, disabled })));
  for (const availability of ["context_required", "context_stale"] as const) test(`${locale}: ${availability} explains the semantic blocker and disables preparation without hiding receipts`, () => {
    const blocked: TopicPreparationStatus = { ...status, availability, current_plan_digest: null,
      latest_completed: { ...run, status: "completed" } };
    assert.equal(validTopicPreparationStatus(blocked), true);
    assert.equal(topicPreparationCanExecute(blocked, quote, "0"), false);
    assert.equal(topicPreparationCanReplay(blocked, pending, quote), false);
    const html = render(blocked, null), buttons = html.match(/<button\b[^]*?<\/button>/gu) ?? [];
    assert.ok(html.includes(text[availability === "context_required" ? "contextRequired" : "contextStale"]));
    assert.ok(!html.includes(text.noInputs));
    assert.match(buttons.find(button => button.includes(text.quote))!, /disabled/u);
    assert.doesNotMatch(buttons.find(button => button.includes(text.refresh))!, /disabled/u);
    assert.ok(html.includes(text.previous.split("{")[0]));
  });
  test(`${locale}: before-import inline controls quote the cost and do not claim Topics/Signal output`, () => {
    const html = render(); assert.ok(html.includes(text.body));
    const prepare = (html.match(/<button\b[^]*?<\/button>/gu) ?? []).find(button => button.includes(locale === "es-MX" ? "Preparar guía de marca" : "Prepare brand guide"));
    assert.ok(prepare); assert.doesNotMatch(prepare, /^<button[^>]*disabled/u); assert.match(prepare, /0[.,]00/u);
    const unavailable = render({ ...status, availability: "no_topics", current_plan_digest: null }, null);
    assert.ok(unavailable.includes(text.noInputs)); assert.ok(unavailable.includes(text.refresh));
    const calculate = (unavailable.match(/<button\b[^]*?<\/button>/gu) ?? []).find(button => button.includes(text.quote));
    assert.ok(calculate); assert.doesNotMatch(calculate, /^<button[^>]*disabled/u);
  });
  test(`${locale}: zero interests can prepare independent Brand OS context and report its completion`, () => {
    const contextQuote = { ...quote, total_topics: 0 };
    assert.equal(topicPreparationCanExecute(status, contextQuote, "0"), true);
    const html = render(status, contextQuote); assert.ok(html.includes(text.body));
    assert.match(html, locale === "es-MX" ? /Preparar guía de marca/u : /Prepare brand guide/u);
    const completed = { ...run, status: "completed" as const, counts: { ...run.counts,
      total_topics: 0, completed_topics: 0, partial_topics: 0, pending_topics: 0,
      processed_input_references: 20, processed_unique_inputs: 10, cache_hits: 10 } };
    const prepared = render({ ...status, latest_completed: completed, is_current: true }, null);
    assert.ok(prepared.includes(text.currentContext));
    assert.doesNotMatch(prepared, /0 intereses preparados|0 prepared interests/u);
  });
  test(`${locale}: a completed preparation hides its original pending quote and retains the receipt`, () => {
    const completed = { ...run, status: "completed" as const, counts: { ...run.counts, completed_topics: 4, partial_topics: 0,
      pending_topics: 0, processed_input_references: 20, processed_unique_inputs: 10, cache_hits: 10 } };
    const originalQuote = { ...quote, cached_unique_inputs: 0, missing_unique_inputs: 10, requires_provider: true,
      estimated_upper_micro_usd: 1500 };
    const html = render({ ...status, latest_completed: completed, latest_run: completed, is_current: true }, originalQuote);
    assert.doesNotMatch(html, /Costo pendiente estimado|Estimated remaining cost|0 de 10 textos|0 of 10 texts/u);
    assert.match(html, /0[.,]0008/u);
    assert.ok(html.includes(text.refresh));
    assert.doesNotMatch(html, /Preparar guía de marca ·|Prepare brand guide ·/u);
    const changed = render({ ...status, current_plan_digest: `sha256:${"c".repeat(64)}`, latest_completed: completed },
      { ...originalQuote, plan_digest: `sha256:${"c".repeat(64)}` });
    assert.match(changed, /Costo pendiente estimado|Estimated remaining cost/u);
  });
  test(`${locale}: provider disabled and unsaved edits block submission without disabling editing or hiding receipts`, () => {
    const html = render(status, { ...quote, requires_provider: true, missing_unique_inputs: 10, estimated_upper_micro_usd: 1500 });
    assert.ok(html.includes(text.providerDisabled));
    const saved = render(status, quote, true); assert.ok(saved.includes(text.saveFirst));
    assert.doesNotMatch(saved, /<form|<fieldset/u);
    const unresolved = render(status, { ...quote, blocking_error_code: "workspace_embedding_prior_run_unresolved" });
    assert.ok(unresolved.includes(text.unresolved)); assert.ok(!unresolved.includes(text.unknown));
  });
  test(`${locale}: latest completion remains distinct from running progress and unresolved cost`, () => {
    const html = render({ ...status, latest_completed: { ...run, status: "completed" },
      active_run: { ...run, status: "running", unknown_reserved_micro_usd: 500 }, latest_run: run }, null);
    assert.ok(html.includes(text.unknown)); assert.match(html, /progress value="5" max="10"/u);
    assert.match(html, /0[.,]0005/u); assert.ok(!html.includes(text.current));
  });
}
