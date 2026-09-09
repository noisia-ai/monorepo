import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { TopicsManager } from "../../components/brands/TopicsManager";
import type { SignalTopicsManagementProductV1 } from "./signal-topics-management";
import { latestWorkspaceTopicComputation, parsePendingWorkspaceTopicComputation,
  validWorkspaceTopicComputationResults, validWorkspaceTopicComputationStatus, workspaceTopicSearchCanStart,
  workspaceTopicRequestStorageKey, type WorkspaceTopicComputationStatus } from "./signal-workspace-topic-computation-ui";

Object.assign(globalThis, { React });
const embedding = "00000000-0000-4000-8000-000000000001";
const status: WorkspaceTopicComputationStatus = {
  contract_version: "signal-workspace-topic-search-v1", mode: "workspace", workspace_id: "workspace-test",
  request_scope: "actor-workspace", can_execute: true, observed_at: "2026-09-08T20:00:00.000001Z",
  preflight: { state: "ready", embedding_run_id: embedding, missing_prototypes: 0 },
  active_run: null, latest_run: null, latest_ready: null, request_run: null, is_current: false
};
const ready: NonNullable<WorkspaceTopicComputationStatus["latest_ready"]> = {
  id: "completed-search", status: "ready", progress: 100, denominator: 40, processed_roots: 40,
  expected_chunks: 90, processed_chunks: 90, evaluated_topic_pairs: 2680, retained_candidate_pairs: 1280,
  omitted_candidate_pairs: 1400, error_code: null, created_at: status.observed_at, completed_at: status.observed_at
};
const management = {
  workspace: { id: status.workspace_id, slug: "new-brand", name: "New brand", timezone: "UTC", operational_corpus: null },
  profile: { id: "catalog", version: 1 }, active_profile_id: null, execution: null, search_execution_id: "completed-search", search_is_current: true,
  capabilities: { can_view: true, can_edit: true, can_execute: true, can_adopt: false },
  readiness: { state: "needs_preparation", canonical_mentions: 40, operational_corpus_id: null, next_action: "prepare_mentions", reason_code: null },
  embedding_preflight: { requires_paid_call: true, estimated_micro_usd: 5000, missing_inputs: 3 },
  discovered: { run_key: null, items: [], available: false },
  topics: [{ taxonomy_term_id: "term", term_key: "purchase_friction", label: "Fricciones de compra",
    definition: "Dificultades al completar la compra", scope: "category", lifecycle: "draft", origin: "manual",
    source: null, inclusion: [], exclusion: [], positive_examples: [], negative_examples: [], definition_revision: 1,
    definition_digest: "sha256:test", status: "ready", counts: { relevant: 9, doubt: 10, excluded: 2 },
    created_at: "2026-09-08T00:00:00.000Z", updated_at: "2026-09-08T00:00:00.000Z" }]
} as unknown as SignalTopicsManagementProductV1;

test("workspace search requires a current prepared cache and capability; legacy is a separate mode", () => {
  assert.equal(workspaceTopicSearchCanStart(status), true);
  for (const changed of [{ ...status, can_execute: false }, { ...status, mode: "legacy" as const },
    { ...status, active_run: { ...ready, status: "running" as const } },
    { ...status, request_run: { ...ready, status: "queued" as const } },
    { ...status, preflight: { ...status.preflight, state: "missing_embeddings" as const } },
    { ...status, preflight: { ...status.preflight, state: "missing_prototypes" as const } },
    { ...status, preflight: { ...status.preflight, embedding_run_id: null } }]) assert.equal(workspaceTopicSearchCanStart(changed), false);
});
test("late snapshots preserve a newer completion and never cross workspace or actor scope", () => {
  const current = { ...status, latest_ready: ready, observed_at: "2026-09-08T20:00:00.000003Z" };
  assert.equal(latestWorkspaceTopicComputation(current, status, status.workspace_id), current);
  assert.equal(latestWorkspaceTopicComputation(current, { ...status, workspace_id: "other" }, status.workspace_id), current);
  assert.equal(latestWorkspaceTopicComputation(current, status, "other"), null);
  assert.equal(latestWorkspaceTopicComputation(current, { ...status, request_scope: "another-actor" }, status.workspace_id)?.latest_ready, null);
  assert.equal(validWorkspaceTopicComputationStatus({ ...status, active_run: ready }), false);
  assert.equal(validWorkspaceTopicComputationStatus({ ...status, latest_ready: { ...ready, status: "running" } }), false);
  assert.equal(validWorkspaceTopicComputationStatus({ ...status, preflight: { ...status.preflight, missing_prototypes: NaN } }), false);
});
test("pending requests persist only exact actor/workspace scoped identity and original embedding snapshot", () => {
  const request = { workspace_id: status.workspace_id, request_scope: status.request_scope,
    key: "00000000-0000-4000-8000-000000000002", body: { embedding_run_id: embedding } };
  assert.deepEqual(parsePendingWorkspaceTopicComputation(JSON.parse(JSON.stringify(request)), status.workspace_id, status.request_scope), request);
  assert.equal(parsePendingWorkspaceTopicComputation(request, "other", status.request_scope), null);
  assert.equal(parsePendingWorkspaceTopicComputation(request, status.workspace_id, "other"), null);
  assert.equal(parsePendingWorkspaceTopicComputation({ ...request, body: { ...request.body, publish: true } }, status.workspace_id, status.request_scope), null);
  assert.notEqual(workspaceTopicRequestStorageKey(status.workspace_id, status.request_scope), workspaceTopicRequestStorageKey(status.workspace_id, "other"));
});
test("result decoder accepts only evidence candidates, finite scores and the requested execution", () => {
  const page = { execution_id: ready.id, next_cursor: null, items: [{ root_id: "root", text_excerpt: "Evidence", scope_status: "unknown",
    semantic_score: .3, ranking_score: -.4, negative_semantic_score: .7,
    evidence: { quality: "uncalibrated", approval_policy: "none", evaluated_chunk_count: 5, best_chunk: { chunk_index: 4 } } }] };
  assert.equal(validWorkspaceTopicComputationResults(page, ready.id), true);
  assert.equal(validWorkspaceTopicComputationResults(page, "another-execution"), false);
  assert.equal(validWorkspaceTopicComputationResults({ ...page, items: [{ ...page.items[0], ranking_score: NaN }] }, ready.id), false);
  assert.equal(validWorkspaceTopicComputationResults({ ...page, items: [{ ...page.items[0], evidence: { ...page.items[0]!.evidence, approval_policy: "automatic" } }] }, ready.id), false);
});

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (initialComputation: WorkspaceTopicComputationStatus | null, initial = management) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>, createElement(TopicsManager,
      { brandId: "new-brand", workspaceId: status.workspace_id, initial, initialComputation })));
  test(`${locale}: complete workspace search replaces legacy readiness, costs and publication controls inside Topics`, () => {
    const html = render({ ...status, latest_ready: ready, latest_run: ready, is_current: true });
    assert.ok(html.includes(messages.AdminWorkspace.topics.computation.resultsTitle));
    assert.ok(html.includes(messages.AdminWorkspace.topics.computation.available));
    assert.ok(html.includes("2680") && html.includes("1400") && html.includes("1280"));
    assert.doesNotMatch(html, />9 relevantes|>9 relevant/u);
    for (const key of ["follow", "updateSignal"]) assert.ok(!html.includes(messages.AdminWorkspace.topics.actions[key]));
    for (const key of ["belongs", "notBelongs"]) assert.ok(!html.includes(`>${messages.AdminWorkspace.topics.results[key]}<`));
    assert.ok(!html.includes(messages.AdminWorkspace.topics.scopeNotice));
    assert.ok(!html.includes(messages.AdminWorkspace.topics.states.ready));
    assert.doesNotMatch(html, /\$0\.005/u);
  });
  test(`${locale}: missing prototypes keeps interests editable and explains pending preparation without a paid CTA`, () => {
    const html = render({ ...status, preflight: { ...status.preflight, state: "missing_prototypes", missing_prototypes: 10 } });
    assert.ok(html.includes(messages.AdminWorkspace.topics.computation.preflight.missing_prototypes));
    assert.doesNotMatch(html, /<fieldset[^>]*disabled/u);
    const search = (html.match(/<button\b[^]*?<\/button>/gu) ?? []).find((button) => button.includes(messages.AdminWorkspace.topics.actions.search));
    assert.ok(search); assert.match(search, /^<button[^>]*disabled/u);
    assert.ok(!html.includes(messages.AdminWorkspace.topics.cost.notice));
  });
  test(`${locale}: discovered Topics use associations, never the interests search preflight or ranking`, () => {
    const discovered = { ...management, topics: [{ ...management.topics[0]!, origin: "workspace_discovery" as const,
      scope: "all_conversations" as const, discovery_guidance: false }] };
    for (const preflight of [status.preflight, { ...status.preflight, state: "missing_prototypes" as const, missing_prototypes: 10 }]) {
      const html = render({ ...status, preflight, latest_ready: ready, latest_run: ready, is_current: true }, discovered);
      assert.ok(html.includes(messages.AdminWorkspace.topics.signalSelection.show));
      assert.ok(html.includes(messages.AdminWorkspace.topics.states.discovered));
      assert.ok(html.includes(messages.AdminWorkspace.topics.fields.discoveryGuidance));
      assert.ok(html.includes(messages.AdminWorkspace.topics.actions.archive));
      assert.doesNotMatch(html, /<fieldset[^>]*disabled/u);
      for (const copy of [messages.AdminWorkspace.topics.actions.search,
        messages.AdminWorkspace.topics.computation.preflight.missing_prototypes,
        messages.AdminWorkspace.topics.computation.resultsTitle, messages.AdminWorkspace.topics.computation.startBody]) {
        assert.ok(!html.includes(copy), `discovery must not imply this prerequisite: ${copy}`);
      }
    }
  });
  test(`${locale}: a new run preserves the previous ready counts and describes their freshness`, () => {
    const html = render({ ...status, latest_ready: ready, active_run: { ...ready, id: "new-search", status: "running", progress: 25, processed_roots: 10 }, is_current: false });
    assert.ok(html.includes(messages.AdminWorkspace.topics.computation.resultsTitle));
    assert.ok(html.includes(messages.AdminWorkspace.topics.computation.previous));
    assert.match(html, /progress max="100" value="25"/u);
    assert.ok(html.includes("2680"));
  });
  test(`${locale}: an unavailable mode cannot fall back to starting a legacy paid search`, () => {
    const html = render(null);
    const search = (html.match(/<button\b[^]*?<\/button>/gu) ?? []).find((button) => button.includes(messages.AdminWorkspace.topics.actions.search));
    assert.ok(search); assert.match(search, /^<button[^>]*disabled/u);
  });
  test(`${locale}: completed computation updates a stale SSR draft badge without requiring a catalog reload`, () => {
    const html = render({ ...status, latest_ready: ready, latest_run: ready, is_current: true },
      { ...management, topics: management.topics.map((topic) => ({ ...topic, status: "draft" })) });
    assert.ok(html.includes(messages.AdminWorkspace.topics.computation.available));
    assert.ok(!html.includes(messages.AdminWorkspace.topics.list.notSearched));
  });
}
