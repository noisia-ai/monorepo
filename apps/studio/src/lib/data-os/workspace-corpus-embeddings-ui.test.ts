import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
import { embeddingQuoteCanExecute, validCorpusEmbeddingQuote, WorkspaceCorpusEmbeddingsControls,
  type CorpusEmbeddingsQuote, type CorpusEmbeddingsStatus } from "../../components/admin/WorkspaceCorpusEmbeddingsControls";
import { embeddingCapUsdInput, embeddingRequestStorageKey, formatEmbeddingMicroUsd,
  latestCorpusEmbeddingSnapshot, parseEmbeddingCapMicroUsd, parsePendingCorpusEmbeddingRequest,
  type PendingCorpusEmbeddingRequest } from "./workspace-corpus-embeddings-ui";

const request: PendingCorpusEmbeddingRequest = {
  version: 1, workspace_id: "workspace-one", request_scope: "actor-workspace-scope", key: "request-key-one",
  body: { preparation_run_id: "00000000-0000-4000-8000-000000000001",
    quote_digest: `sha256:${"a".repeat(64)}`, hard_cap_micro_usd: 4700 }
};

test("embedding cap preserves micro-USD exactly, including positive subcent amounts", () => {
  for (const [input, micro] of [["0", "0"], ["5", "5000000"], ["0.004700", "4700"],
    ["0.000001", "1"], ["4.999999", "4999999"]]) {
    assert.equal(parseEmbeddingCapMicroUsd(input!), micro);
    assert.equal(parseEmbeddingCapMicroUsd(embeddingCapUsdInput(micro!)), micro);
  }
  for (const invalid of ["", "-1", "Infinity", "1e-3", "0.0000001", "1,000", "5.5.5", "05", "NaN"]) {
    assert.equal(parseEmbeddingCapMicroUsd(invalid), null);
  }
  assert.equal(formatEmbeddingMicroUsd("4700", "en-US"), "$0.0047");
  assert.match(formatEmbeddingMicroUsd("4700", "es-MX"), /0\.0047/u);
  assert.throws(() => formatEmbeddingMicroUsd("-1", "en-US"));
});

test("paid request survives storage serialization without changing its key, quote or cap", () => {
  const restored = parsePendingCorpusEmbeddingRequest(JSON.parse(JSON.stringify(request)), request.workspace_id, request.request_scope);
  assert.deepEqual(restored, request);
  assert.notEqual(embeddingRequestStorageKey(request.workspace_id, request.request_scope),
    embeddingRequestStorageKey(request.workspace_id, "different-actor"));
  assert.throws(() => parsePendingCorpusEmbeddingRequest(request, "different-workspace", request.request_scope));
  assert.throws(() => parsePendingCorpusEmbeddingRequest(request, request.workspace_id, "different-actor"));
  for (const body of [{ ...request.body, model: "caller-selected-model" },
    { ...request.body, hard_cap_micro_usd: -1 }, { ...request.body, quote_digest: "new-quote" },
    { ...request.body, preparation_run_id: "not-a-run" }]) {
    assert.throws(() => parsePendingCorpusEmbeddingRequest({ ...request, body }, request.workspace_id, request.request_scope));
  }
});

test("late embedding snapshots cannot regress progress or restore another workspace", () => {
  const next = { workspace_id: request.workspace_id, observed_at: "2026-09-08T20:00:00.000002Z", completed: 10 };
  const stale = { ...next, observed_at: "2026-09-08T20:00:00.000001Z", completed: 3 };
  assert.equal(latestCorpusEmbeddingSnapshot(next, stale, request.workspace_id), next);
  assert.equal(latestCorpusEmbeddingSnapshot(stale, next, request.workspace_id), next);
  assert.equal(latestCorpusEmbeddingSnapshot(next, { ...next, workspace_id: "other" }, request.workspace_id), next);
  assert.equal(latestCorpusEmbeddingSnapshot(next, stale, "other"), null);
  assert.equal(latestCorpusEmbeddingSnapshot(null, { ...next, observed_at: "invalid" }, request.workspace_id), null);
});

Object.assign(globalThis, { React });
const status: CorpusEmbeddingsStatus = {
  contract_version: "signal-workspace-embeddings-v1", workspace_id: request.workspace_id,
  observed_at: "2026-09-08T20:00:00.000001Z", can_execute: true, provider_available: false,
  max_run_cost_micro_usd: 5_000_000, request_scope: request.request_scope,
  active_run: null, latest_run: null, latest_completed: null, request_run: null, is_current: false
};
const quote: CorpusEmbeddingsQuote = {
  contract_version: "signal-workspace-embeddings-quote-v1", workspace_id: request.workspace_id,
  preparation_run_id: request.body.preparation_run_id, input_revision: 1,
  profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, quote_digest: request.body.quote_digest,
  eligible_roots: 3, total_chunk_references: 12, total_asset_chunks: 8, cached_asset_chunks: 2, missing_asset_chunks: 6,
  full_text_bytes: 20_000, tokens_upper: 20_768, estimated_upper_micro_usd: 4700,
  resume_run_id: null, required_cap_micro_usd: null,
  policy_valid_until: null, observed_at: status.observed_at, can_execute: true, provider_available: false,
  max_run_cost_micro_usd: status.max_run_cost_micro_usd, request_scope: request.request_scope
};
const running: NonNullable<CorpusEmbeddingsStatus["latest_run"]> = {
  id: "00000000-0000-4000-8000-000000000101", preparation_run_id: request.body.preparation_run_id, input_revision: 1, status: "running",
  counts: { eligible_roots: 3, completed_roots: 1, partial_roots: 1, pending_roots: 1,
    total_chunk_references: 12, processed_chunk_references: 7, total_asset_chunks: 8,
    processed_asset_chunks: 4, cache_hits: 2, embedded_unique_chunks: 2 },
  hard_cap_micro_usd: 4700, estimated_upper_micro_usd: 4700, reserved_micro_usd: 1700, settled_micro_usd: 1000,
  unknown_reserved_micro_usd: 0, observed_exception_micro_usd: 0, error_code: null, retryable: false,
  created_at: status.observed_at, updated_at: status.observed_at, completed_at: null
};

test("execution needs current quote, provider and DB capability, sufficient cap and no unresolved provider outcome", () => {
  const enabled = { ...status, provider_available: true };
  const readyQuote = { ...quote, provider_available: true };
  const can = (next = enabled, nextQuote = readyQuote, cap = "0.0047", preparation = request.body.preparation_run_id) =>
    embeddingQuoteCanExecute(nextQuote, next, preparation, cap);
  assert.equal(can(), true);
  assert.equal(can(status), false);
  assert.equal(can(enabled, quote), false);
  assert.equal(can({ ...enabled, can_execute: false }), false);
  assert.equal(can(enabled, readyQuote, "0.004699"), false);
  assert.equal(can(enabled, readyQuote, "5.000001"), false);
  assert.equal(can(enabled, readyQuote, "0.0047", "different-preparation"), false);
  assert.equal(can({ ...enabled, request_scope: "another-actor" }), false);
  assert.equal(can({ ...enabled, active_run: running }), false);
  assert.equal(can({ ...enabled, latest_run: { ...running, status: "outcome_unknown" } }), false);
  assert.equal(can({ ...enabled, latest_run: { ...running, status: "failed", retryable: false } }), false);
  assert.equal(can({ ...enabled, latest_run: { ...running, status: "failed", retryable: false, preparation_run_id: "older-preparation" } }), true);
  assert.equal(can({ ...enabled, latest_run: { ...running, status: "failed", retryable: true, unknown_reserved_micro_usd: 1 } }), false);
  assert.equal(can({ ...enabled, latest_run: { ...running, status: "failed", retryable: true } }), true);
  const resumeQuote = { ...readyQuote, resume_run_id: running.id, required_cap_micro_usd: 4700, estimated_upper_micro_usd: 1000 };
  assert.equal(can(enabled, resumeQuote), true);
  assert.equal(can(enabled, resumeQuote, "0.004701"), false, "resuming cannot silently increase the existing budget");
});

test("malformed recovery quote cannot reach BigInt or enable paid execution", () => {
  assert.equal(validCorpusEmbeddingQuote(quote), true);
  for (const change of [{ required_cap_micro_usd: undefined }, { required_cap_micro_usd: "4700" },
    { required_cap_micro_usd: -1 }, { resume_run_id: undefined }, { resume_run_id: "not-a-run", required_cap_micro_usd: 4700 },
    { resume_run_id: running.id, required_cap_micro_usd: null }, { estimated_upper_micro_usd: NaN },
    { cached_asset_chunks: null }]) {
    assert.equal(validCorpusEmbeddingQuote({ ...quote, ...change }), false);
  }
});

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const copy = messages.AdminWorkspace.data.corpusEmbeddings;
  const render = (initialStatus = status, initialQuote: CorpusEmbeddingsQuote | null = null,
    preparationRunId = request.body.preparation_run_id) => renderToStaticMarkup(createElement(NextIntlClientProvider,
      { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
      createElement(WorkspaceCorpusEmbeddingsControls, { initialStatus, initialQuote, workspaceId: status.workspace_id, preparationRunId })));

  test(`${locale}: disabled provider still shows honest quote and keeps execution disabled`, () => {
    const html = render(status, quote);
    assert.ok(html.includes(copy.disabled));
    assert.ok(html.includes(copy.freeQuote));
    assert.match(html, /0\.0047/u);
    assert.match(html, /class="admin-button admin-button--primary"[^>]*disabled/u);
    assert.ok(html.includes(copy.actions.quote));
    assert.ok(!html.includes(copy.complete));
    assert.doesNotMatch(html, /<form|<progress/u);
  });

  test(`${locale}: progress uses complete mentions and preserves partial chunks without claiming analysis`, () => {
    const html = render({ ...status, active_run: running, latest_run: running });
    assert.match(html, /<progress[^>]*max="3"[^>]*value="1"/u);
    assert.ok(html.includes(copy.coverage.replace("{completed}", "1").replace("{total}", "3").replace("{partial}", "1").replace("{pending}", "1")));
    assert.ok(html.includes(copy.chunks.replace("{processed}", "7").replace("{total}", "12")));
    assert.ok(!html.includes(copy.actions.quote));
    assert.ok(html.includes(copy.body));
  });

  test(`${locale}: unknown provider spend stays explicit and cannot offer a new paid request`, () => {
    const unknown = { ...running, status: "outcome_unknown" as const, unknown_reserved_micro_usd: 1700 };
    const html = render({ ...status, latest_run: unknown });
    assert.ok(html.includes(copy.unknown));
    assert.match(html, /0\.0017/u);
    assert.ok(!html.includes(copy.actions.quote));
    assert.doesNotMatch(html, /admin-button--primary/u);
  });

  test(`${locale}: resuming preserves the original cap without offering an editable extra budget`, () => {
    const resumeQuote = { ...quote, resume_run_id: running.id, required_cap_micro_usd: 4700, estimated_upper_micro_usd: 1000 };
    const html = render({ ...status, latest_run: { ...running, status: "failed", retryable: true } }, resumeQuote);
    assert.ok(html.includes(copy.resumeBudget));
    assert.match(html, /0\.0047/u);
    assert.ok(!html.includes(copy.changeCap));
    assert.doesNotMatch(html, /<input/u);
  });

  test(`${locale}: completed embeddings remain distinct from Topics, and an old run stays visibly outdated`, () => {
    const complete = { ...running, status: "completed" as const, completed_at: running.updated_at, reserved_micro_usd: 0,
      counts: { ...running.counts, completed_roots: 3, partial_roots: 0, pending_roots: 0, processed_chunk_references: 12 } };
    const completeStatus = { ...status, latest_run: complete, latest_completed: complete, is_current: true };
    assert.ok(render(completeStatus).includes(copy.complete));
    assert.ok(!render(completeStatus).includes(copy.actions.quote));
    const stale = render({ ...completeStatus, is_current: false }, null, "another-preparation");
    assert.ok(stale.includes(copy.outdated));
    assert.ok(!stale.includes(copy.complete));
  });
}
