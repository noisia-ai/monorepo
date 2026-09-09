import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { WorkspaceAnalysisControls } from "../../components/brands/WorkspaceAnalysisControls";
import { WorkspaceInterpretationAdmissionControls } from "../../components/brands/WorkspaceInterpretationAdmissionControls";
import { validWorkspaceAnalysisStatus, parsePendingWorkspaceAnalysis, workspaceAnalysisCanReplay, workspaceAnalysisCanRetry, workspaceAnalysisCanStart,
  type WorkspaceAnalysisStatus } from "./signal-workspace-analysis-ui";
import { formatWorkspaceAdmissionExpiry, validWorkspaceAdmissionRequest, validWorkspaceInterpretationAdmission,
  workspaceAdmissionCanSubmit, workspaceAdmissionRequestConfirmed,
  type WorkspaceInterpretationAdmission, type WorkspaceInterpretationAdmissionRequest } from "./signal-workspace-interpretation-admission-ui";

Object.assign(globalThis, { React });
const id = "aabbccdd-eeff-4aab-8ccd-aabbccddeeff", other = "00000000-0000-4000-8000-000000000002", hash = `sha256:${"1".repeat(64)}`;
const admission: WorkspaceInterpretationAdmission = { execution_id: id, is_current: true, can_authorize: true, can_revoke: false, requires_authorization: true,
  blocked_reason: null, current: null, request: null, model: "claude-sonnet-4-6", provider_available: true,
  budget_timezone: "America/Mexico_City", budget_date: "2026-09-08", maximum_admission_not_after: "2026-09-09T06:00:00.000Z",
  confirmed_micro_usd: 1_000_000, reserved_micro_usd: 1_000_000, terminal_reserved_micro_usd: 500_000,
  run_cap_micro_usd: 5_000_000, daily_cap_micro_usd: 4_000_000, maximum_grant_micro_usd: 3_000_000 };
const status: WorkspaceAnalysisStatus = { contract_version: "signal-workspace-analysis-v1", workspace_id: id,
  observed_at: "2026-09-09T02:00:00.000000Z", request_scope: "actor-workspace", can_execute: true,
  latest_run: null, active_run: null, latest_complete: null, request_run: null, latest_complete_execution_id: null, admission,
  preflight: { state: "ready", embedding_run_id: id, context_digest: hash, catalog_digest: hash,
    cost: { claude: { estimated_upper_micro_usd: null, maximum_cap_micro_usd: 0, provider_available: false }, voyage: { estimated_upper_micro_usd: 0 } } } };
const body: WorkspaceInterpretationAdmissionRequest = { action: "authorize_interpretation", run_id: id,
  expected_admission_operation_id: null, grant_cap_micro_usd: 2_000_000, admission_not_after: admission.maximum_admission_not_after };
const receipt = { contract_version: "workspace-interpretation-admission-v1" as const, operation_id: other, grant_digest: hash,
  action: "authorize_interpretation" as const, execution_id: id, workspace_id: id, authorized_by_user_id: other, budget_actor_user_id: id,
  prior_admission_operation_id: null, input_digest: hash, fit_checkpoint_digest: hash, interpretation_revision_digest: hash, configuration_digest: hash,
  budget_date: admission.budget_date, budget_timezone: admission.budget_timezone, authorized_at: status.observed_at,
  admission_not_after: body.admission_not_after, grant_cap_micro_usd: body.grant_cap_micro_usd, run_cap_micro_usd: admission.run_cap_micro_usd,
  daily_cap_micro_usd: admission.daily_cap_micro_usd };
const intent = { version: 1 as const, workspace_id: id, request_scope: status.request_scope, key: "admission-original-key", body };

test("admission body seals only execution, CAS, additional cap and server deadline; no model, actor or ceiling override", () => {
  assert.equal(validWorkspaceAdmissionRequest(body), true);
  assert.deepEqual(parsePendingWorkspaceAnalysis(intent, id, status.request_scope), intent);
  for (const patch of [{ model: "claude-opus-5" }, { budget_actor_user_id: other }, { daily_cap_micro_usd: 50_000_000 },
    { grant_cap_micro_usd: 0 }, { grant_cap_micro_usd: -1 }, { grant_cap_micro_usd: 1.5 }, { grant_cap_micro_usd: "100" },
    { expected_admission_operation_id: "invalid" }, { admission_not_after: "2026-09-08T23:00:00-06:00" }, { admission_not_after: "2026-02-30T06:00:00.000Z" }])
    assert.equal(validWorkspaceAdmissionRequest({ ...body, ...patch }), false);
});
test("renewal uses its own admin permission and operating flag while the legacy admission deadline stays closed", () => {
  assert.equal(status.preflight.cost.claude.provider_available, false);
  assert.equal(workspaceAdmissionCanSubmit(status, body), true);
  for (const patch of [{ can_authorize: false }, { provider_available: false }, { is_current: false }, { model: null }, { maximum_grant_micro_usd: 1_999_999 }])
    assert.equal(workspaceAdmissionCanSubmit({ ...status, admission: { ...admission, ...patch } }, body), false);
  for (const patch of [{ run_id: other }, { expected_admission_operation_id: other }, { admission_not_after: "2026-09-09T06:00:00.001Z" },
    { admission_not_after: status.observed_at }, { admission_not_after: "2026-09-08T23:00:00.000Z" }])
    assert.equal(workspaceAdmissionCanSubmit(status, { ...body, ...patch }), false);
});
test("stop uses the confirmed grant CAS independently of stale inputs, provider availability or interpretation expiry", () => {
  const stop = { action: "revoke_interpretation" as const, run_id: id, expected_admission_operation_id: other };
  const current = { ...status, admission: { ...admission, current: receipt, can_authorize: false, can_revoke: true,
    is_current: false, provider_available: false, maximum_grant_micro_usd: 0 } };
  assert.equal(validWorkspaceAdmissionRequest(stop), true); assert.equal(workspaceAdmissionCanSubmit(current, stop), true);
  assert.equal(workspaceAdmissionCanSubmit(current, { ...stop, expected_admission_operation_id: id }), false);
  assert.equal(workspaceAdmissionCanSubmit({ ...current, admission: { ...current.admission, can_revoke: false } }, stop), false);
  assert.equal(workspaceAdmissionCanSubmit({ ...current, admission: { ...current.admission, current: { ...receipt, action: "revoke_interpretation" } } }, stop), false);
});
test("lost admission ACK resolves its own historical receipt, not the latest permission or run, without rewriting the intent", () => {
  const saved = JSON.stringify(intent);
  const accepted = { ...status, admission: { ...admission, execution_id: other, current: null,
    request: { idempotency_key: intent.key, receipt } } };
  assert.equal(workspaceAdmissionRequestConfirmed(accepted, intent), true);
  assert.equal(workspaceAdmissionRequestConfirmed(accepted, { ...intent, body: { ...body, run_id: id.toUpperCase() } }), true);
  for (const patch of [{ request_scope: "another-actor" }, { workspace_id: other }])
    assert.equal(workspaceAdmissionRequestConfirmed({ ...accepted, ...patch }, intent), false);
  for (const patch of [{ execution_id: other }, { grant_cap_micro_usd: 1 }, { prior_admission_operation_id: id },
    { action: "revoke_interpretation" as const }, { admission_not_after: "2026-09-09T05:00:00.000Z" }])
    assert.equal(workspaceAdmissionRequestConfirmed({ ...accepted, admission: { ...accepted.admission,
      request: { idempotency_key: intent.key, receipt: { ...receipt, ...patch } } } }, intent), false);
  assert.equal(workspaceAdmissionRequestConfirmed({ ...accepted, admission: { ...accepted.admission, request: { idempotency_key: "other-key", receipt } } }, intent), false);
  assert.equal(JSON.stringify(intent), saved);
  assert.equal(workspaceAnalysisCanReplay(status, intent), true);
  assert.equal(workspaceAnalysisCanReplay(accepted, intent), false);
  assert.equal(workspaceAnalysisCanReplay({ ...status, observed_at: "2026-09-09T07:00:00.000000Z",
    admission: { ...admission, current: receipt, can_authorize: false } }, intent), true,
    "only explicit same-body replay can resolve a lost request after deadline/CAS changed; server still validates or returns its receipt");
});
test("malformed admission or cross-workspace receipts cannot be rendered as current authority", () => {
  assert.equal(validWorkspaceAnalysisStatus(status), true);
  assert.equal(validWorkspaceInterpretationAdmission({ ...admission, current: receipt }, id), true);
  for (const patch of [{ can_authorize: "true" }, { maximum_grant_micro_usd: -1 }, { terminal_reserved_micro_usd: 1_000_001 },
    { maximum_admission_not_after: "tomorrow" }, { model: "claude-opus-5" }, { budget_timezone: "server-local" },
    { current: { ...receipt, workspace_id: other } }])
    assert.equal(validWorkspaceInterpretationAdmission({ ...admission, ...patch }, id), false);
});
test("generic historical worker error never implies expiry, but explicit server diagnosis suppresses its old retry", () => {
  const run = { execution_id: id, status: "failed", is_current: true, retryable: true, outcome_unknown: false,
    error_code: "workspace_engine_worker_failed", claude_cost: { unknown_reserved_micro_usd: 0 } } as NonNullable<WorkspaceAnalysisStatus["latest_run"]>;
  assert.equal(workspaceAnalysisCanRetry({ ...status, latest_run: run }, run), false);
  assert.equal(workspaceAnalysisCanRetry({ ...status, latest_run: run, admission: { ...admission, can_authorize: false } }, run), false,
    "read-only analyst still cannot use generic retry to bypass expired authority");
  assert.equal(workspaceAnalysisCanRetry({ ...status, latest_run: run, admission: { ...admission, requires_authorization: false } }, run), true);
  assert.equal(workspaceAnalysisCanStart({ ...status, preflight: { ...status.preflight, cost: { ...status.preflight.cost,
    claude: { provider_available: true, maximum_cap_micro_usd: 1_000_000, estimated_upper_micro_usd: 100 } } } }, "1"), false);
  assert.equal(run.error_code, "workspace_engine_worker_failed");
});
for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const copy = messages.AdminWorkspace.topics.analysis.admissionGrant;
  const provider = { locale, timeZone: "UTC", messages } as ComponentProps<typeof NextIntlClientProvider>;
  const render = (value = status, allowed = true) => renderToStaticMarkup(createElement(NextIntlClientProvider, provider,
    createElement(WorkspaceInterpretationAdmissionControls, { status: value, canAuthorize: allowed, canRevoke: true,
      submitting: false, onSubmit: async () => undefined })));
  test(`${locale}: one inline confirmation shows additional maximum, sealed limits, server timezone and retained liability`, () => {
    const html = render();
    assert.ok(html.includes(copy.authorize)); assert.ok(html.includes("Sonnet 4.6")); assert.ok(html.includes("America/Mexico_City"));
    assert.ok(html.includes(copy.partial)); assert.match(html, /value="3"/u);
    assert.doesNotMatch(html, /<form|type="checkbox"|claude-opus/u);
    assert.doesNotMatch(html, /class="admin-button admin-button--primary"[^>]*disabled/u);
    assert.match(render(status, false), /class="admin-button admin-button--primary"[^>]*disabled/u);
    assert.ok(render({ ...status, admission: { ...admission, provider_available: false } }).includes(copy.providerDisabled));
    const prior = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Auckland"; const a = formatWorkspaceAdmissionExpiry(body.admission_not_after, admission.budget_timezone, locale);
      process.env.TZ = "Europe/London"; assert.equal(formatWorkspaceAdmissionExpiry(body.admission_not_after, admission.budget_timezone, locale), a);
    } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
  });
  test(`${locale}: stop explains admitted calls still finish; revocation never erases the receipt`, () => {
    const current = { ...status, admission: { ...admission, current: receipt, can_authorize: false, can_revoke: true } };
    const html = render(current, false);
    assert.ok(html.includes(copy.revoke)); assert.ok(html.includes(copy.stopEffect));
    assert.doesNotMatch(html, /<button[^>]*disabled/u);
    const stopped = render({ ...current, admission: { ...current.admission, can_revoke: false,
      current: { ...receipt, action: "revoke_interpretation" } } });
    assert.ok(stopped.includes(copy.revoked)); assert.ok(!stopped.includes(`>${copy.revoke}</button>`));
  });
}

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const copy = messages.AdminWorkspace.topics.analysis;
  const run: NonNullable<WorkspaceAnalysisStatus["latest_run"]> = {
    execution_id: id, status: "failed", phase: "failed", progress: 82, expected_roots: 100, expected_chunks: 130,
    expected_guides: 2, processed_roots: 100, processed_chunks: 130, error_code: "workspace_engine_worker_failed",
    is_current: true, model_version_id: id, artifact_count: 23, claude_cap_micro_usd: 5_000_000,
    result_kind: "computational_grouping", fit_completed: true, expected_interpretation_units: 357,
    interpreted_units: 32, materialized_topics: 0, retryable: true, outcome_unknown: false, transport_recovery_eligible: false,
    claude_cost: { hard_cap_micro_usd: 5_000_000, settled_micro_usd: 1_000_000, reserved_micro_usd: 1_000_000,
      unknown_reserved_micro_usd: 0, terminal_reserved_micro_usd: 500_000 },
    materialization_progress: { artifact_id: id, output_catalog_profile_id: id, mapping_digest: hash,
      interpreted_unit_count: 32, expected_interpretation_unit_count: 357, interpretation_complete: false,
      topic_count: 32, discovered_topic_count: 32, projection_execution_id: id, generation_id: id }
  };
  const value: WorkspaceAnalysisStatus = { ...status, latest_run: run };
  const render = (input = value) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, timeZone: "UTC", messages } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceAnalysisControls, { workspaceId: id, brandId: "example-brand", catalogVersion: "1", initial: input })));
  test(`${locale}: equal same-run receipts appear once; partial catalog and reconciliation remain visible`, () => {
    const html = render();
    assert.ok(html.includes(copy.receiptLabels.confirmed));
    assert.ok(!html.includes(copy.admissionGrant.receipts.split("{")[0]));
    assert.ok(html.includes(copy.terminalAmount.split("{")[0]));
    assert.match(html, /32[^<]*357/u);
    assert.ok(html.includes(copy.partialCoverage));
    assert.ok(html.indexOf(copy.partialCoverage) < html.indexOf(copy.admissionGrant.title));
    assert.ok(html.includes(copy.errors.failed));
    assert.ok(html.includes(copy.admissionGrant.authorize));
    assert.ok(html.includes(copy.refresh));
    assert.ok(!render({ ...value, admission: { ...admission, execution_id: id.toUpperCase() } }).includes(copy.admissionGrant.receipts.split("{")[0]));
  });
  test(`${locale}: different executions, changed amounts, and unknown exposure are never deduplicated away`, () => {
    for (const patch of [{ execution_id: other }, { confirmed_micro_usd: 900_000 },
      { reserved_micro_usd: 1_100_000 }, { terminal_reserved_micro_usd: 400_000 }]) {
      assert.ok(render({ ...value, admission: { ...admission, ...patch } }).includes(copy.admissionGrant.receipts.split("{")[0]));
    }
    assert.ok(render({ ...value, latest_run: { ...run, outcome_unknown: true,
      claude_cost: { ...run.claude_cost, unknown_reserved_micro_usd: 200_000 } } }).includes(copy.unknownAmount.split("{")[0]));
    assert.ok(render({ ...value, latest_run: null }).includes(copy.admissionGrant.receipts.split("{")[0]));
  });
}
