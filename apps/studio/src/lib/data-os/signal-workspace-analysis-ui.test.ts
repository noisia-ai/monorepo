import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { WorkspaceAnalysisControls } from "../../components/brands/WorkspaceAnalysisControls";
import { latestWorkspaceAnalysis, parsePendingWorkspaceAnalysis, validWorkspaceAnalysisStatus,
  workspaceAnalysisCanReleaseChangedEditorialRequest, workspaceAnalysisCanReplay, workspaceAnalysisCanRetry, workspaceAnalysisCanStart, workspaceAnalysisDefaultCap, workspaceAnalysisStorageKey,
  workspaceAnalysisErrorKey, workspaceAnalysisInterpretedComplete, workspaceAnalysisUnknown, type PendingWorkspaceAnalysis, type WorkspaceAnalysisRun, type WorkspaceAnalysisStatus } from "./signal-workspace-analysis-ui";

Object.assign(globalThis, { React });
const id = "00000000-0000-4000-8000-000000000001";
const hash = `sha256:${"1".repeat(64)}`;
const status: WorkspaceAnalysisStatus = {
  contract_version: "signal-workspace-analysis-v1", workspace_id: id, request_scope: "workspace-actor", can_execute: true,
  observed_at: "2026-09-08T20:00:00.000001Z", latest_complete_execution_id: null,
  latest_run: null, latest_complete: null, active_run: null, request_run: null,
  preflight: { state: "ready", embedding_run_id: id, context_digest: hash, catalog_digest: hash,
    cost: { claude: { estimated_upper_micro_usd: 2_001, maximum_cap_micro_usd: 10_000, provider_available: true },
      voyage: { estimated_upper_micro_usd: 0 } } }
};
const ready: WorkspaceAnalysisRun = { execution_id: id, status: "ready", phase: "complete", progress: 100,
  expected_roots: 100, expected_chunks: 130, expected_guides: 2, processed_roots: 100, processed_chunks: 130,
  error_code: null, is_current: true, model_version_id: id, artifact_count: 3, retryable: false, outcome_unknown: false,
  claude_cap_micro_usd: 0, result_kind: "computational_grouping",
  fit_completed: false, expected_interpretation_units: 0, interpreted_units: 0, materialized_topics: 0,
  claude_cost: { hard_cap_micro_usd: 0, settled_micro_usd: 0, reserved_micro_usd: 0, unknown_reserved_micro_usd: 0 } };
const pending: PendingWorkspaceAnalysis = { version: 1, workspace_id: id, request_scope: status.request_scope,
  key: "analysis-request-1", body: { action: "start", embedding_run_id: id, expected_context_digest: hash,
    expected_catalog_digest: hash, claude_cap_micro_usd: 2_001 } };

test("full analysis can start without topic counts; complete inputs and exact monetary bounds still apply", () => {
  assert.equal(validWorkspaceAnalysisStatus(status), true);
  assert.equal(workspaceAnalysisCanStart(status, "0.002001"), true);
  assert.equal(workspaceAnalysisCanStart(status, "0.002"), false);
  assert.equal(workspaceAnalysisCanStart(status, "0.010001"), false);
  for (const state of ["awaiting_import", "needs_preparation", "missing_embeddings", "missing_context"] as const)
    assert.equal(workspaceAnalysisCanStart({ ...status, preflight: { ...status.preflight, state } }, "0.002001"), false);
  assert.equal(workspaceAnalysisCanStart({ ...status, can_execute: false }, "0.002001"), false);
  assert.equal(workspaceAnalysisCanStart({ ...status, active_run: { ...ready, status: "running", phase: "fitting" } }, "0.002001"), false);
});
test("complete analysis requires an available provider and a positive cap; historical fit receipts stay readable", () => {
  const unavailable = { ...status, preflight: { ...status.preflight, cost: { ...status.preflight.cost,
    claude: { ...status.preflight.cost.claude, provider_available: false } } } };
  assert.equal(workspaceAnalysisCanStart(unavailable, "0.002001"), false);
  assert.equal(workspaceAnalysisCanStart({ ...unavailable, preflight: { ...unavailable.preflight,
    cost: { ...unavailable.preflight.cost, claude: { ...unavailable.preflight.cost.claude, estimated_upper_micro_usd: 0 } } } }, "0"), false);
  assert.equal(workspaceAnalysisCanStart({ ...status, preflight: { ...status.preflight, cost: { ...status.preflight.cost,
    claude: { estimated_upper_micro_usd: null, maximum_cap_micro_usd: 0, provider_available: true } } } }, "0"), false);
  assert.equal(validWorkspaceAnalysisStatus({ ...status, latest_run: ready, latest_complete: ready }), true);
});
test("unknown estimate defaults to the server limit without inventing a lower bound or zero estimate", () => {
  const unknown = { ...status, preflight: { ...status.preflight, cost: { ...status.preflight.cost,
    claude: { ...status.preflight.cost.claude, estimated_upper_micro_usd: null } } } };
  assert.equal(validWorkspaceAnalysisStatus(unknown), true);
  assert.equal(workspaceAnalysisDefaultCap(unknown), "0.01");
  assert.equal(workspaceAnalysisDefaultCap(status), "0.002001");
  assert.equal(workspaceAnalysisCanStart(unknown, "0.000001"), true);
  assert.equal(workspaceAnalysisCanStart(unknown, "0.01"), true);
  assert.equal(workspaceAnalysisCanStart(unknown, "0"), false);
  assert.equal(workspaceAnalysisCanStart(unknown, "0.010001"), false);
  assert.equal(validWorkspaceAnalysisStatus({ ...unknown, preflight: { ...unknown.preflight, cost: { ...unknown.preflight.cost,
    claude: { ...unknown.preflight.cost.claude, estimated_upper_micro_usd: undefined } } } }), false);
});
test("unknown outcome/reserve blocks new starts, replay and retry even when a latest failure says retryable", () => {
  const failed = { ...ready, status: "failed" as const, phase: "failed" as const, retryable: true };
  const activeUnknown = { ...status, latest_run: { ...failed, outcome_unknown: true } };
  const reservedUnknown = { ...status, latest_run: { ...failed, claude_cost: { ...failed.claude_cost, unknown_reserved_micro_usd: 1 } } };
  for (const unknown of [activeUnknown, reservedUnknown]) {
    assert.equal(workspaceAnalysisUnknown(unknown), true);
    assert.equal(workspaceAnalysisCanStart(unknown, "0.002001"), false);
    assert.equal(workspaceAnalysisCanRetry(unknown, failed), false);
    assert.equal(workspaceAnalysisCanReplay(unknown, pending), false);
  }
  assert.equal(workspaceAnalysisCanRetry({ ...status, latest_run: failed }, failed), true);
  assert.equal(workspaceAnalysisCanRetry(status, { ...failed, is_current: false }), false);
  assert.equal(workspaceAnalysisCanRetry(status, { ...failed, retryable: false }), false);
});
test("known editorial failures cannot become a replacement run; eligible recovery stays on the same execution", () => {
  for (const code of ["workspace_engine_interpretation_output_invalid", "workspace_engine_interpretation_repair_invalid"]) {
    const failed = { ...ready, status: "failed" as const, phase: "failed" as const, error_code: code, retryable: code.endsWith("output_invalid") };
    const received = { ...status, latest_run: failed };
    assert.equal(workspaceAnalysisUnknown(received), false);
    assert.equal(workspaceAnalysisCanStart(received, "0.002001"), false);
    assert.equal(workspaceAnalysisCanReplay(received, pending), false);
    assert.equal(workspaceAnalysisCanRetry(received, failed), failed.retryable);
    assert.equal(workspaceAnalysisCanStart({ ...received, latest_run: { ...failed, is_current: false } }, "0.002001"), true);
  }
  assert.equal(workspaceAnalysisErrorKey("workspace_engine_interpretation_output_invalid"), "editorialInvalid");
  assert.equal(workspaceAnalysisErrorKey("workspace_engine_interpretation_repair_invalid"), "editorialRepairExhausted");
});
test("only a confirmed editorial failure with changed inputs releases the local intent; unknown receipts stay pending", () => {
  for (const code of ["workspace_engine_interpretation_output_invalid", "workspace_engine_interpretation_repair_invalid"]) {
    const failed = { ...ready, status: "failed" as const, phase: "failed" as const, error_code: code, is_current: false };
    const changed = { ...status, latest_run: failed, request_run: failed };
    assert.equal(workspaceAnalysisCanReleaseChangedEditorialRequest(changed), true);
    assert.equal(workspaceAnalysisCanStart(changed, "0.002001"), true);
    assert.equal(workspaceAnalysisCanReleaseChangedEditorialRequest({ ...changed, request_run: null }), false);
    assert.equal(workspaceAnalysisCanReleaseChangedEditorialRequest({ ...changed, request_run: { ...failed, is_current: true } }), false);
    assert.equal(workspaceAnalysisCanReleaseChangedEditorialRequest({ ...changed, request_run: { ...failed, outcome_unknown: true } }), false);
    assert.equal(workspaceAnalysisCanReleaseChangedEditorialRequest({ ...changed, request_run: { ...failed,
      claude_cost: { ...failed.claude_cost, unknown_reserved_micro_usd: 1 } } }), false);
    assert.equal(workspaceAnalysisCanReleaseChangedEditorialRequest({ ...changed, latest_run: { ...failed, outcome_unknown: true } }), false);
    assert.equal(workspaceAnalysisCanReleaseChangedEditorialRequest({ ...changed, request_run: { ...failed,
      error_code: "workspace_engine_storage_verification_failed" } }), false);
  }
});
test("late status cannot undo a newer receipt or cross workspace/actor scope", () => {
  const current = { ...status, latest_run: ready, latest_complete: ready, latest_complete_execution_id: id,
    observed_at: "2026-09-08T20:00:00.000003Z" };
  assert.equal(latestWorkspaceAnalysis(current, status, id), current);
  assert.equal(latestWorkspaceAnalysis(current, { ...status, workspace_id: "other" }, id), current);
  assert.equal(latestWorkspaceAnalysis(current, status, "other"), null);
  assert.equal(latestWorkspaceAnalysis(current, { ...status, request_scope: "other-actor" }, id)?.latest_run, null);
  assert.equal(validWorkspaceAnalysisStatus({ ...status, active_run: ready }), false);
  assert.equal(validWorkspaceAnalysisStatus({ ...status, latest_complete: { ...ready, status: "failed" } }), false);
  assert.equal(validWorkspaceAnalysisStatus({ ...status, latest_run: { ...ready, claude_cost: { ...ready.claude_cost, reserved_micro_usd: NaN } } }), false);
});
test("saved intent has exact start/retry body and scoped key; server receipt is checked before retry", () => {
  assert.deepEqual(parsePendingWorkspaceAnalysis(pending, id, status.request_scope), pending);
  assert.equal(parsePendingWorkspaceAnalysis(pending, id, "another-actor"), null);
  assert.equal(parsePendingWorkspaceAnalysis({ ...pending, body: { ...pending.body, publish: true } }, id, status.request_scope), null);
  const retry = { ...pending, key: "retry-request-1", body: { action: "retry", run_id: id } };
  assert.deepEqual(parsePendingWorkspaceAnalysis(retry, id, status.request_scope), retry);
  assert.equal(parsePendingWorkspaceAnalysis({ ...retry, body: { ...retry.body, claude_cap_micro_usd: 10_000 } }, id, status.request_scope), null);
  assert.notEqual(workspaceAnalysisStorageKey(id, status.request_scope), workspaceAnalysisStorageKey(id, "other-actor"));
  assert.equal(workspaceAnalysisCanReplay(status, pending), true);
  assert.equal(workspaceAnalysisCanReplay({ ...status, request_run: ready }, pending), false);
  assert.equal(workspaceAnalysisCanReplay({ ...status, preflight: { ...status.preflight, context_digest: `sha256:${"2".repeat(64)}` } }, pending), false);
});
test("interpretation stages retain exact counters; fitting alone and partial materialization never become complete", () => {
  const fit = { ...ready, fit_completed: true, expected_interpretation_units: 12, interpreted_units: 4, status: "running" as const, phase: "interpreting" as const };
  assert.equal(validWorkspaceAnalysisStatus({ ...status, active_run: fit }), true);
  assert.equal(workspaceAnalysisInterpretedComplete(fit), false);
  const materializing = { ...fit, interpreted_units: 12, phase: "materializing" as const, materialized_topics: 3 };
  assert.equal(validWorkspaceAnalysisStatus({ ...status, active_run: materializing }), true);
  assert.equal(workspaceAnalysisInterpretedComplete(materializing), false);
  assert.equal(workspaceAnalysisInterpretedComplete({ ...materializing, status: "ready", phase: "complete" }), true);
  assert.equal(workspaceAnalysisInterpretedComplete(ready), false);
  for (const patch of [{ interpreted_units: 13 }, { expected_interpretation_units: -1 }, { fit_completed: undefined }, { materialized_topics: NaN }])
    assert.equal(validWorkspaceAnalysisStatus({ ...status, active_run: { ...fit, ...patch } }), false);
});
for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const t = messages.AdminWorkspace.topics.analysis;
  const providerProps = { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>;
  const render = (initial: WorkspaceAnalysisStatus, disabled = false) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    providerProps, createElement(WorkspaceAnalysisControls, { brandId: "new-brand", workspaceId: id,
      catalogVersion: "empty:0", initial, disabled })));
  test(`${locale}: zero interests has an analysis entry and import path; missing context has existing preparation`, () => {
    const html = render({ ...status, preflight: { ...status.preflight, state: "awaiting_import" } });
    assert.ok(html.includes(t.title)); assert.ok(html.includes(t.awaiting_import));
    assert.ok(html.includes("/studio/brands/new-brand/data#corpus-readiness"));
    assert.ok(render({ ...status, preflight: { ...status.preflight, state: "missing_context" } }).includes(t.missing_context));
    assert.ok(render(status, true).includes(t.saveFirst));
  });
  test(`${locale}: computational receipt is pending interpretation, and actual fitting phase does not claim classification`, () => {
    const complete = render({ ...status, latest_run: ready, latest_complete: ready, latest_complete_execution_id: id });
    assert.ok(complete.includes(t.computed)); assert.ok(complete.includes(t.computedBody));
    assert.ok(!complete.includes(t.completedBody));
    const insufficient = render({ ...status, latest_complete: { ...ready, model_version_id: null, result_kind: "insufficient_population" }, latest_complete_execution_id: id });
    assert.ok(insufficient.includes(t.insufficientBody)); assert.ok(!insufficient.includes(t.computedBody));
    const running = render({ ...status, active_run: { ...ready, status: "running", phase: "fitting", progress: 40 } });
    assert.ok(running.includes(t.phases.fitting)); assert.ok(!running.includes(t.phases.classifying));
  });
  test(`${locale}: fit completion, interpretation and catalog creation remain distinct from a complete result or Signal selection`, () => {
    const interpreting: WorkspaceAnalysisRun = { ...ready, fit_completed: true, expected_interpretation_units: 12, interpreted_units: 4,
      status: "running", phase: "interpreting", progress: 75,
      claude_cost: { hard_cap_micro_usd: 500_000, settled_micro_usd: 100_000, reserved_micro_usd: 50_000, unknown_reserved_micro_usd: 0 } };
    const html = render({ ...status, active_run: interpreting, latest_run: interpreting });
    assert.ok(html.includes(t.phases.interpreting)); assert.ok(html.includes(t.fitCompletePending));
    assert.ok(!html.includes(t.completedBody)); assert.ok(!html.includes(t.phases.classifying));
    assert.match(html, /4[^]*12/u);
    assert.ok(html.includes("0.10") && html.includes("0.05"), "confirmed and reserved costs remain separately visible");
    const materializing = render({ ...status, active_run: { ...interpreting, phase: "materializing", interpreted_units: 12, materialized_topics: 3 } });
    assert.ok(materializing.includes(t.phases.materializing)); assert.ok(!materializing.includes(t.completedBody));
    const complete = { ...interpreting, phase: "complete" as const, status: "ready" as const, interpreted_units: 12, materialized_topics: 3 };
    const completed = render({ ...status, latest_complete: complete, latest_run: complete, latest_complete_execution_id: id });
    assert.ok(completed.includes(t.completedBody)); assert.ok(!completed.includes(t.computedBody));
    assert.ok(!completed.includes(t.phases.classifying));
    const uncertain = render({ ...status, latest_run: { ...interpreting, status: "failed", phase: "failed", outcome_unknown: true,
      claude_cost: { ...interpreting.claude_cost, unknown_reserved_micro_usd: 75_000 } } });
    assert.ok(uncertain.replace(/&#x27;/gu, "'").includes(t.unknown)); assert.ok(uncertain.includes("0.075"));
    assert.ok(!uncertain.includes(t.estimate.split("{amount}")[0]), "a new estimate must not compete with an unresolved receipt");
    assert.ok(!uncertain.includes(t.startWithCap.split("{amount}")[0]), "the disabled action does not suggest a new cap while cost is uncertain");
  });
  test(`${locale}: invalid paid editorial output retains its cost and exhausted repair never advertises a replacement run`, () => {
    const failed = { ...ready, status: "failed" as const, phase: "failed" as const, fit_completed: true,
      expected_interpretation_units: 357, interpreted_units: 0, error_code: "workspace_engine_interpretation_output_invalid", retryable: true,
      claude_cap_micro_usd: 30_000_000, claude_cost: { hard_cap_micro_usd: 30_000_000, settled_micro_usd: 147_415, reserved_micro_usd: 0, unknown_reserved_micro_usd: 0 } };
    const invalid = render({ ...status, latest_run: failed });
    assert.ok(invalid.includes(t.errors.editorialInvalid)); assert.ok(invalid.includes(t.retry));
    assert.match(invalid, /0[.,]147415/u); assert.ok(!invalid.includes(t.unknown));
    const exhausted = render({ ...status, latest_run: { ...failed, retryable: false, error_code: "workspace_engine_interpretation_repair_invalid" } });
    assert.ok(exhausted.includes(t.errors.editorialRepairExhausted)); assert.match(exhausted, /0[.,]147415/u);
    assert.ok(!exhausted.includes(t.retry)); assert.ok(!exhausted.includes(t.changeCap));
    assert.ok(!exhausted.includes(t.startWithCap.split("{amount}")[0]));
    assert.ok(!exhausted.includes(t.unknown));
  });
  test(`${locale}: unknown estimate is explained as a spending limit and no-provider blocks complete analysis`, () => {
    const unknown = { ...status, preflight: { ...status.preflight, cost: { ...status.preflight.cost,
      claude: { ...status.preflight.cost.claude, estimated_upper_micro_usd: null } } } };
    const html = render(unknown);
    assert.ok(html.includes(t.estimateUnknown)); assert.ok(html.includes(t.spendingLimit.split("{amount}")[0]));
    assert.ok(!html.includes(t.estimate.split("{amount}")[0]));
    const blocked = render({ ...unknown, preflight: { ...unknown.preflight, cost: { ...unknown.preflight.cost,
      claude: { estimated_upper_micro_usd: null, maximum_cap_micro_usd: 0, provider_available: false } } } });
    assert.ok(blocked.includes(t.noInterpretation));
    const start = (blocked.match(/<button\b[^]*?<\/button>/gu) ?? []).find((button) => button.includes(t.start));
    assert.ok(start); assert.match(start, /^<button[^>]*disabled/u);
  });
}
