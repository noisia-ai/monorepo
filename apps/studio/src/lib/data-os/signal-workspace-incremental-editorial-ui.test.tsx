import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { WorkspaceIncrementalEditorialControls } from "../../components/brands/WorkspaceIncrementalEditorialControls";
import { parsePendingWorkspaceAnalysis, validWorkspaceAnalysisStatus, workspaceAnalysisCanReplay, workspaceAnalysisCanStart, workspaceAnalysisUnknown, workspaceAnalysisUsesIncremental, workspaceAnalysisCatalogReceiptKey, type PendingWorkspaceAnalysis, type WorkspaceAnalysisStatus } from "./signal-workspace-analysis-ui";
import { validWorkspaceIncrementalEditorialRequest, workspaceIncrementalEditorialCanSubmit, workspaceIncrementalEditorialPending,
  workspaceIncrementalEditorialRequestConfirmed, type WorkspaceIncrementalEditorial, type WorkspaceIncrementalEditorialRequest } from "./signal-workspace-incremental-editorial-ui";

Object.assign(globalThis, { React });
const id = "abcdef01-0000-4000-8000-000000000001", owner = "abcdef02-0000-4000-8000-000000000002";
const other = "abcdef03-0000-4000-8000-000000000003", hash = `sha256:${"1".repeat(64)}`, hash2 = `sha256:${"2".repeat(64)}`;
const deadline = "2026-09-10T06:00:00.000Z";
const state: WorkspaceIncrementalEditorial = { preparation: {
  numeric_execution_id: id, numeric_checkpoint_digest: hash, source_digest: hash,
  is_current: true, can_prepare: true, blocked_reason: null, has_pending_work: false, preparation: null, request: null
}, admission: {
  numeric_execution_id: id, numeric_checkpoint_digest: hash, history_cut_digest: hash, target_unit_digest: hash,
  target_binding_digest: hash, evidence_plan_artifact_id: other, expected_units: 11, target_units: 3, legacy_units: 2, claimed_units: 4,
  is_current: true, can_authorize: true, blocked_reason: null, budget_actor_user_id: other, budget_timezone: "America/Mexico_City",
  budget_date: "2026-09-09", maximum_admission_not_after: deadline, daily_cap_micro_usd: 8_000_000,
  confirmed_micro_usd: 1_000_000, reserved_micro_usd: 500_000, terminal_reserved_micro_usd: 100_000, maximum_grant_micro_usd: 6_500_000,
  model: "claude-sonnet-4-6", adapter_available: true, provider_available: true, operation: null, request: null
} };
const status: WorkspaceAnalysisStatus = { contract_version: "signal-workspace-analysis-v1", workspace_id: id, request_scope: "actor-workspace",
  observed_at: "2026-09-09T12:00:00.000001Z", can_execute: true, latest_complete_execution_id: null,
  latest_run: null, latest_complete: null, active_run: null, request_run: null, incremental_editorial: state,
  preflight: { state: "ready", embedding_run_id: id, context_digest: hash, catalog_digest: hash,
    cost: { claude: { estimated_upper_micro_usd: null, maximum_cap_micro_usd: 6_500_000, provider_available: true }, voyage: { estimated_upper_micro_usd: 0 } } } };
const prepare: WorkspaceIncrementalEditorialRequest = { action: "prepare_incremental_editorial", run_id: id, expected_source_digest: hash };
const begin: WorkspaceIncrementalEditorialRequest = { action: "begin_incremental_editorial", run_id: id,
  expected_evidence_plan_artifact_id: other, expected_numeric_checkpoint_digest: hash, expected_target_unit_digest: hash,
  expected_history_cut_digest: hash, cap_micro_usd: 2_000_000, admission_not_after: deadline };
const revoke: WorkspaceIncrementalEditorialRequest = { action: "revoke_incremental_editorial", run_id: owner, expected_admission_operation_id: other };
const retry: WorkspaceIncrementalEditorialRequest = { action: "retry_incremental_editorial", run_id: owner, expected_worker_job_id: "editorial-job-1" };
const execution: NonNullable<WorkspaceIncrementalEditorial["execution"]> = {
  execution_id: owner, status: "failed", error_code: "workspace_engine_interpretation_receipt_recovery_required",
  is_current: true, has_pending_work: false, has_unresolved_call: false, expected_units: 3, interpreted_units: 1,
  dispatch: { worker_job_id: "editorial-job-1", status: "failed" }, can_retry: true, requires_authorization: true, recorded_recovery_available: true,
  costs: { confirmed_micro_usd: 120_000, reserved_micro_usd: 40_000, terminal_reserved_micro_usd: 10_000 }, request: null
};
const withExecution = (patch: Partial<typeof execution> = {}): WorkspaceAnalysisStatus => ({ ...status, incremental_editorial: {
  ...state, admission: { ...state.admission!, provider_available: false }, execution: { ...execution, ...patch }
} });
const receipt = { contract_version: "workspace-incremental-editorial-admission-v1" as const, operation_id: other, execution_id: owner,
  workspace_id: id, action: "authorize_interpretation" as const, grant_digest: hash, prior_admission_operation_id: null,
  authorized_by_user_id: id, budget_actor_user_id: other, input_digest: hash, numeric_execution_id: id, numeric_checkpoint_digest: hash,
  target_unit_digest: hash, target_binding_digest: hash, evidence_plan_artifact_id: other, configuration_digest: hash,
  budget_timezone: "America/Mexico_City", budget_date: "2026-09-09", authorized_at: "2026-09-09T12:00:00.000Z",
  admission_not_after: deadline, grant_cap_micro_usd: 2_000_000, run_cap_micro_usd: 2_000_000, daily_cap_micro_usd: 8_000_000 };
const intent = (body: WorkspaceIncrementalEditorialRequest): PendingWorkspaceAnalysis & { body: WorkspaceIncrementalEditorialRequest } => ({
  version: 1, workspace_id: id, request_scope: status.request_scope, key: "incremental-intent-1", body
});
function withAdmission(patch: Partial<NonNullable<WorkspaceIncrementalEditorial["admission"]>>) {
  return { ...status, incremental_editorial: { ...state, admission: { ...state.admission!, ...patch } } };
}

const renewal: NonNullable<typeof execution.renewal> = {
  execution_id: owner, is_current: true, can_renew: true, blocked_reason: null,
  expected_admission_operation_id: other, budget_actor_user_id: other, budget_timezone: "America/Mexico_City", budget_date: "2026-09-09",
  maximum_admission_not_after: "2026-09-10T05:30:00.000Z", run_cap_micro_usd: 2_000_000, daily_cap_micro_usd: 8_000_000,
  ...execution.costs, maximum_grant_micro_usd: 1_500_000
};
const renew: WorkspaceIncrementalEditorialRequest = { action: "renew_incremental_editorial", run_id: owner,
  expected_admission_operation_id: other, grant_cap_micro_usd: 1_000_000, admission_not_after: renewal.maximum_admission_not_after };
function withRenewal(patch: Partial<typeof renewal> = {}, runPatch: Partial<typeof execution> = {}): WorkspaceAnalysisStatus {
  return { ...status, incremental_editorial: { ...state, preparation: { ...state.preparation!, can_prepare: false },
    admission: { ...state.admission!, can_authorize: false, operation: { execution_id: owner, status: "failed", is_current: true,
      can_revoke: false, requires_authorization: true, receipt } },
    execution: { ...execution, error_code: "workspace_engine_interpretation_daily_authority_expired", can_retry: false,
      recorded_recovery_available: false, renewal: { ...renewal, ...patch }, ...runPatch } } };
}

test("closed requests accept only server CAS and explicit cap/deadline, never source refs or budget actor", () => {
  for (const body of [prepare, begin, revoke, retry, renew]) {
    assert.equal(validWorkspaceIncrementalEditorialRequest(body), true);
    assert.deepEqual(parsePendingWorkspaceAnalysis(intent(body), id, status.request_scope), intent(body));
    for (const extra of [{ actor_user_id: other }, { budget_actor_user_id: other }, { configuration: {} }, { refs: [] }, { census: {} }, { automatic: true }])
      assert.equal(validWorkspaceIncrementalEditorialRequest({ ...body, ...extra }), false);
  }
  for (const patch of [{ cap_micro_usd: 0 }, { cap_micro_usd: -1 }, { cap_micro_usd: 0.1 }, { cap_micro_usd: "2" },
    { admission_not_after: "2026-09-31T12:00:00.000Z" }, { expected_target_unit_digest: "bad" }, { run_id: "bad" }])
    assert.equal(validWorkspaceIncrementalEditorialRequest({ ...begin, ...patch }), false);
  assert.equal(validWorkspaceIncrementalEditorialRequest({ ...prepare, cap_micro_usd: 0 }), false);
});
test("free preparation depends on its own current server authority, not Claude availability or expired grant", () => {
  const disabled = withAdmission({ provider_available: false, maximum_admission_not_after: "2020-01-01T00:00:00.000Z" });
  assert.equal(workspaceIncrementalEditorialCanSubmit(disabled, prepare), true);
  assert.equal(workspaceIncrementalEditorialCanSubmit(disabled, begin), false);
  for (const patch of [{ can_prepare: false }, { is_current: false }, { has_pending_work: true }, { source_digest: hash2 }])
    assert.equal(workspaceIncrementalEditorialCanSubmit({ ...status, incremental_editorial: { ...state, preparation: { ...state.preparation!, ...patch } } }, prepare), false);
  assert.equal(workspaceIncrementalEditorialCanSubmit({ ...status, can_execute: false }, prepare), false);
  assert.equal(workspaceIncrementalEditorialCanSubmit(status, { ...prepare, run_id: owner }), false);
});
test("begin requires exact current plan and positive explicit money within the server date and budget", () => {
  assert.equal(workspaceIncrementalEditorialCanSubmit(status, begin), true);
  for (const patch of [{ can_authorize: false }, { is_current: false }, { provider_available: false }, { adapter_available: false },
    { target_units: 0 }, { maximum_grant_micro_usd: 1 }, { history_cut_digest: hash2 }, { target_unit_digest: hash2 },
    { numeric_checkpoint_digest: hash2 }, { evidence_plan_artifact_id: id }])
    assert.equal(workspaceIncrementalEditorialCanSubmit(withAdmission(patch), begin), false);
  assert.equal(workspaceIncrementalEditorialCanSubmit(status, { ...begin, admission_not_after: "2020-01-01T00:00:00.000Z" }), false);
  assert.equal(workspaceIncrementalEditorialCanSubmit(status, { ...begin, admission_not_after: "2027-01-01T00:00:00.000Z" }), false);
});
test("accepted begin ACK is historical and scoped even after owner failed or source changed; never promotes the numeric owner", () => {
  const accepted = withAdmission({ is_current: false, can_authorize: false, request: { idempotency_key: intent(begin).key, receipt },
    operation: { execution_id: owner, status: "failed", is_current: false, can_revoke: true, requires_authorization: false, receipt } });
  assert.equal(validWorkspaceAnalysisStatus(accepted), true);
  assert.equal(workspaceIncrementalEditorialRequestConfirmed(accepted, intent({ ...begin, run_id: id.toUpperCase() })), true);
  for (const candidate of [intent({ ...begin, run_id: owner }), intent({ ...begin, cap_micro_usd: 1 }), intent({ ...begin, expected_evidence_plan_artifact_id: id }),
    { ...intent(begin), key: "other-request-key" }, { ...intent(begin), request_scope: "other" }, { ...intent(begin), workspace_id: other }])
    assert.equal(workspaceIncrementalEditorialRequestConfirmed(accepted, candidate), false);
  assert.equal(workspaceAnalysisCanReplay(accepted, intent(begin)), false);
  assert.equal(accepted.latest_run, null);
});
test("lost ACK permits only explicit replay of the saved request, including expired date; changed scope or authority blocks", () => {
  const expired = intent({ ...begin, admission_not_after: "2020-01-01T00:00:00.000Z" });
  assert.equal(workspaceAnalysisCanReplay(withAdmission({ can_authorize: false, is_current: false }), expired), true);
  assert.equal(workspaceAnalysisCanReplay({ ...status, can_execute: false }, expired), false);
  assert.equal(workspaceAnalysisCanReplay(status, { ...expired, request_scope: "another-actor" }), false);
  assert.deepEqual(parsePendingWorkspaceAnalysis(JSON.parse(JSON.stringify(expired)), id, status.request_scope), expired);
});
test("free preparation ACK confirms the exact saved source even after a different source becomes current", () => {
  const accepted = { ...status, incremental_editorial: { ...state, preparation: { ...state.preparation!, source_digest: hash2, request: {
    idempotency_key: intent(prepare).key, receipt: { contract_version: "workspace-incremental-editorial-preparation-request-v1" as const,
      operation_id: other, workspace_id: id, actor_user_id: id, numeric_execution_id: id, source_digest: hash,
      source: { contract_version: "workspace-incremental-editorial-preparation-source-v1" as const, numeric_execution_id: id,
        numeric_checkpoint_digest: hash, input_revision: "2", context_digest: hash, catalog_digest: hash, census_digest: hash,
        history_cut_digest: hash, units_digest: hash, origins_digest: hash }, worker_job_id: "free-job",
      requested_at: "2026-09-09T12:00:00.000Z", charge_micro_usd: 0 as const }
  } } } };
  assert.equal(validWorkspaceAnalysisStatus(accepted), true);
  assert.equal(workspaceIncrementalEditorialRequestConfirmed(accepted, intent({ ...prepare, run_id: id.toUpperCase() })), true);
  assert.equal(workspaceIncrementalEditorialRequestConfirmed(accepted, intent({ ...prepare, expected_source_digest: hash2 })), false);
  assert.equal(workspaceAnalysisCanReplay(accepted, intent(prepare)), false);
});
test("a durable incremental catalog receipt refreshes the catalog without fabricating a complete full run", () => {
  const update: NonNullable<WorkspaceAnalysisStatus["update"]> = {
    desired_revision: "2", input_revision: "2", has_pending_work: true,
    numeric: { execution_id: id, status: "ready", phase: "complete", progress: 100, is_current: true,
      expected_roots: 10, processed_roots: 10, error_code: null }, derivation: null, projection: null, serving: null,
    catalog_receipt: { contract_version: "workspace-incremental-editorial-catalog-receipt-v1", receipt_id: owner,
      numeric_execution_id: id, serving_editorial_cut_digest: hash, output_catalog_profile_id: other,
      output_catalog_revision: 2, mapping_digest: hash, topic_count: 5, discovered_topic_count: 3 }
  };
  const available = { ...status, update };
  assert.equal(validWorkspaceAnalysisStatus(available), true);
  assert.match(workspaceAnalysisCatalogReceiptKey(available)!, new RegExp(owner));
  assert.equal(available.latest_complete, null);
  assert.notEqual(workspaceAnalysisCatalogReceiptKey(available), workspaceAnalysisCatalogReceiptKey({ ...available, update: {
    ...update, catalog_receipt: { ...update.catalog_receipt!, receipt_id: other }
  } }));
  assert.equal(validWorkspaceAnalysisStatus({ ...available, update: { ...update, catalog_receipt: { ...update.catalog_receipt!, discovered_topic_count: 6 } } }), false);
});
test("stop is tied to editorial receipt CAS and remains available for stale input or unavailable provider", () => {
  const current = withAdmission({ provider_available: false, is_current: false, operation: {
    execution_id: owner, status: "running", is_current: false, can_revoke: true, requires_authorization: false, receipt
  } });
  assert.equal(workspaceIncrementalEditorialCanSubmit(current, revoke), true);
  assert.equal(workspaceIncrementalEditorialCanSubmit(current, { ...revoke, run_id: id }), false);
  assert.equal(workspaceIncrementalEditorialCanSubmit(current, { ...revoke, expected_admission_operation_id: id }), false);
  assert.equal(workspaceIncrementalEditorialCanSubmit({ ...current, can_execute: false }, revoke), false);
});
test("a ready plan or historical admission without durable dispatch never starts polling or declares catalog complete", () => {
  assert.equal(workspaceIncrementalEditorialPending(state), null);
  assert.equal(workspaceIncrementalEditorialPending({ ...state, preparation: { ...state.preparation!, has_pending_work: true } }), id);
  assert.equal(workspaceIncrementalEditorialPending({ ...state, admission: { ...state.admission!, operation: {
    execution_id: owner, status: "queued", is_current: true, can_revoke: true, requires_authorization: false, receipt
  } } }), null);
  const bad = withAdmission({ terminal_reserved_micro_usd: 900_000 });
  assert.equal(validWorkspaceAnalysisStatus(status), true);
  assert.equal(validWorkspaceAnalysisStatus(bad), false);
});
test("current incremental work is the primary path; stale incremental history does not hide a new full analysis", () => {
  assert.equal(workspaceAnalysisUsesIncremental(status), true);
  assert.equal(workspaceAnalysisCanStart(status, "1"), false);
  const stale = { ...status, incremental_editorial: { preparation: { ...state.preparation!, is_current: false }, admission: { ...state.admission!, is_current: false } } };
  assert.equal(workspaceAnalysisUsesIncremental(stale), false);
  assert.equal(workspaceAnalysisCanStart(stale, "1"), true);
});
for (const locale of ["es-MX", "en-US"]) test(`${locale}: real controls distinguish free preparation, explicit cap and old groups without starting on render`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  let submitted = 0;
  const html = renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
    <WorkspaceIncrementalEditorialControls status={status} canSubmit canRevoke={false} submitting={false} canReplay={false}
      onReplay={async () => { submitted++; }} onSubmit={async () => { submitted++; }} />
  </NextIntlClientProvider>);
  assert.equal(submitted, 0);
  assert.match(html, /Claude Sonnet 4.6/);
  assert.doesNotMatch(html, /claude-sonnet-4-6/);
  assert.match(html, /<details[^>]*data-incremental-editorial-details/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /America\/Mexico_City/);
  assert.match(html, /value="6.5"/);
  assert.match(html, locale === "es-MX" ? /sin costo Claude/ : /no Claude cost/);
  assert.match(html, locale === "es-MX" ? /no una estimación/ : /not an estimate/);
  assert.match(html, locale === "es-MX" ? /análisis anterior/ : /earlier analysis/);
  assert.doesNotMatch(html, /data-analysis-receipt/);
});

test("editorial recovery targets only its current owner/job with server authority, including paid response after expiry", () => {
  assert.equal(validWorkspaceAnalysisStatus(withExecution()), true);
  assert.equal(workspaceIncrementalEditorialCanSubmit(withExecution(), retry), true);
  for (const patch of [{ is_current: false }, { can_retry: false }, { has_unresolved_call: true }, { has_pending_work: true }, { status: "ready" }, { dispatch: null }])
    assert.equal(workspaceIncrementalEditorialCanSubmit(withExecution(patch), retry), false);
  for (const body of [{ ...retry, run_id: id }, { ...retry, expected_worker_job_id: "changed-job" }])
    assert.equal(workspaceIncrementalEditorialCanSubmit(withExecution(), body), false);
  assert.equal(workspaceIncrementalEditorialCanSubmit({ ...withExecution(), can_execute: false }, retry), false);
  assert.equal(validWorkspaceIncrementalEditorialRequest({ ...retry, expected_worker_job_id: "" }), false);
  assert.equal(validWorkspaceIncrementalEditorialRequest({ ...retry, cap_micro_usd: 1 }), false);
});
test("retry ACK closes the exact saved request after failure/stale even if the current admission belongs elsewhere", () => {
  const accepted = withExecution({ is_current: false, can_retry: false, request: { idempotency_key: intent(retry).key, receipt: {
    contract_version: "workspace-incremental-editorial-retry-v1", workspace_id: id, execution_id: owner,
    actor_user_id: id, worker_job_id: retry.expected_worker_job_id, request_digest: hash,
    accepted_at: "2026-09-09T12:00:00.000Z", retry_count: 1
  } } });
  assert.equal(validWorkspaceAnalysisStatus(accepted), true);
  assert.equal(workspaceIncrementalEditorialRequestConfirmed(accepted, intent({ ...retry, run_id: owner.toUpperCase() })), true);
  assert.equal(workspaceAnalysisCanReplay(accepted, intent(retry)), false);
  for (const candidate of [intent({ ...retry, run_id: id }), intent({ ...retry, expected_worker_job_id: "another-job" }),
    { ...intent(retry), key: "different-key" }, { ...intent(retry), request_scope: "another-actor" }])
    assert.equal(workspaceIncrementalEditorialRequestConfirmed(accepted, candidate), false);
  assert.equal(workspaceAnalysisCanReplay(withExecution({ can_retry: false, is_current: false }), intent(retry)), true,
    "scoped GET permits only explicit replay of the same body/key; the server revalidates it");
});
test("execution polling and unresolved money follow the editorial ledger, not numeric ready or admission status", () => {
  assert.equal(workspaceIncrementalEditorialPending(withExecution().incremental_editorial), null);
  assert.equal(workspaceIncrementalEditorialPending(withExecution({ status: "running", has_pending_work: true }).incremental_editorial), owner);
  assert.equal(workspaceAnalysisUnknown(withExecution({ has_unresolved_call: true })), true);
  assert.equal(workspaceAnalysisCanStart(withExecution({ has_unresolved_call: true, is_current: false }), "1"), false);
  for (const patch of [{ interpreted_units: 4 }, { costs: { ...execution.costs, terminal_reserved_micro_usd: 40_001 } }, { status: "unknown-invented" }])
    assert.equal(validWorkspaceAnalysisStatus(withExecution(patch)), false);
});
for (const locale of ["es-MX", "en-US"]) test(`${locale}: execution keeps progress, money and unknown distinct from free preparation and catalog readiness`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (value: WorkspaceAnalysisStatus) => renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
    <WorkspaceIncrementalEditorialControls status={value} canSubmit canRevoke={false} submitting={false} canReplay={false}
      onReplay={async () => {}} onSubmit={async () => {}} />
  </NextIntlClientProvider>);
  const html = render(withExecution());
  assert.match(html, locale === "es-MX" ? /1 de 3 grupos/ : /1 of 3 groups/);
  assert.match(html, /0[.,]12/); assert.match(html, /0[.,]04/); assert.match(html, /0[.,]01/);
  assert.match(html, locale === "es-MX" ? /Recuperar resultados guardados/ : /Recover saved results/);
  assert.doesNotMatch(html, locale === "es-MX" ? /Catálogo guardado:/ : /Catalog saved:/);
  const unknown = render(withExecution({ has_unresolved_call: true, can_retry: false }));
  assert.match(unknown, locale === "es-MX" ? /no se ha conciliado/ : /not yet been reconciled/);
  assert.doesNotMatch(unknown, locale === "es-MX" ? /Recuperar resultados guardados/ : /Recover saved results/);
  const noDispatch = render(withExecution({ status: "queued", dispatch: null, can_retry: false, requires_authorization: false }));
  assert.match(noDispatch, locale === "es-MX" ? /no hay una entrega activa confirmada/ : /no active delivery is confirmed/);
});

test("renewal uses only current owner CAS and server remaining cap; never numeric or initial admission maxima", () => {
  assert.equal(validWorkspaceAnalysisStatus(withRenewal()), true);
  assert.equal(workspaceIncrementalEditorialCanSubmit(withRenewal(), renew), true);
  for (const patch of [{ can_renew: false }, { is_current: false }, { maximum_grant_micro_usd: 999_999 }])
    assert.equal(workspaceIncrementalEditorialCanSubmit(withRenewal(patch), renew), false);
  for (const patch of [{ is_current: false }, { has_pending_work: true }, { has_unresolved_call: true }, { status: "running" },
    { status: "ready" }, { recorded_recovery_available: true }, { interpreted_units: 3 }])
    assert.equal(workspaceIncrementalEditorialCanSubmit(withRenewal({}, patch), renew), false);
  for (const body of [{ ...renew, run_id: id }, { ...renew, expected_admission_operation_id: id }, { ...renew, grant_cap_micro_usd: 2_000_000 },
    { ...renew, grant_cap_micro_usd: 0 }, { ...renew, admission_not_after: deadline }, { ...renew, admission_not_after: "2020-01-01T00:00:00.000Z" }])
    assert.equal(workspaceIncrementalEditorialCanSubmit(withRenewal(), body), false);
  const current = withRenewal();
  assert.equal(workspaceIncrementalEditorialCanSubmit({ ...current, can_execute: false }, renew), false);
  assert.equal(workspaceIncrementalEditorialCanSubmit({ ...current, incremental_editorial: { ...current.incremental_editorial!,
    admission: { ...current.incremental_editorial!.admission!, provider_available: false } } }, renew), false);
  for (const patch of [{ grant_cap_micro_usd: "1" }, { grant_cap_micro_usd: 0.1 }, { grant_cap_micro_usd: -1 },
    { provider_available: true }, { model: "claude-sonnet-4-6" }, { expected_admission_operation_id: null }])
    assert.equal(validWorkspaceIncrementalEditorialRequest({ ...renew, ...patch }), false);
});
test("renewal decoder rejects mismatched identity and fabricated limits; legacy status without renewal stays readable", () => {
  assert.equal(validWorkspaceAnalysisStatus(withExecution()), true);
  for (const patch of [{ execution_id: id }, { maximum_grant_micro_usd: -1 }, { expected_admission_operation_id: "bad" },
    { budget_timezone: "fake-zone" }, { terminal_reserved_micro_usd: 40_001 }])
    assert.equal(validWorkspaceAnalysisStatus(withRenewal(patch)), false);
});
test("renewed receipt closes original owner/CAS/cap/date/key after changed source, expired deadline or another failed attempt", () => {
  const current = withRenewal({ can_renew: false, is_current: false }, { is_current: false });
  const accepted = { ...current, observed_at: "2026-09-11T12:00:00.000001Z", incremental_editorial: { ...current.incremental_editorial!,
    admission: { ...current.incremental_editorial!.admission!, numeric_execution_id: other, is_current: false, request: {
      idempotency_key: intent(renew).key, receipt: { ...receipt, prior_admission_operation_id: other,
        grant_cap_micro_usd: renew.grant_cap_micro_usd, admission_not_after: renew.admission_not_after }
    } } } };
  assert.equal(validWorkspaceAnalysisStatus(accepted), true);
  assert.equal(workspaceIncrementalEditorialRequestConfirmed(accepted, intent({ ...renew, run_id: owner.toUpperCase(), expected_admission_operation_id: other.toUpperCase() })), true);
  assert.equal(workspaceAnalysisCanReplay(accepted, intent(renew)), false);
  for (const candidate of [intent({ ...renew, run_id: id }), intent({ ...renew, expected_admission_operation_id: id }),
    intent({ ...renew, grant_cap_micro_usd: 1 }), intent({ ...renew, admission_not_after: deadline }), { ...intent(renew), key: "other-key" },
    { ...intent(renew), workspace_id: other }, { ...intent(renew), request_scope: "other-actor" }])
    assert.equal(workspaceIncrementalEditorialRequestConfirmed(accepted, candidate), false);
  const pending = intent(renew);
  assert.equal(workspaceAnalysisCanReplay({ ...current, observed_at: accepted.observed_at }, pending), true);
  assert.deepEqual(parsePendingWorkspaceAnalysis(JSON.parse(JSON.stringify(pending)), id, status.request_scope), pending);
  assert.equal(workspaceAnalysisCanReplay({ ...current, can_execute: false }, pending), false);
});
for (const locale of ["es-MX", "en-US"]) test(`${locale}: renewal uses compact existing confirmation and prioritizes paid recovery without another grant`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  let posts = 0;
  const render = (value: WorkspaceAnalysisStatus) => renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
    <WorkspaceIncrementalEditorialControls status={value} canSubmit canRevoke={false} submitting={false} canReplay={false}
      onReplay={async () => { posts++; }} onSubmit={async () => { posts++; }} />
  </NextIntlClientProvider>);
  const html = render(withRenewal());
  assert.match(html, /value="1.5"/); assert.doesNotMatch(html, /value="6.5"/);
  assert.match(html, locale === "es-MX" ? /2 grupos pendientes/ : /2 pending groups/);
  assert.match(html, locale === "es-MX" ? /Autorizar y continuar/ : /Authorize and continue/);
  assert.match(html, /America\/Mexico_City/);
  assert.match(html, /0[.,]12/); assert.match(html, /0[.,]04/); assert.match(html, /0[.,]01/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.equal((html.match(/<input /g) ?? []).length, 1);
  const recovery = withRenewal({}, { can_retry: true, recorded_recovery_available: true });
  recovery.incremental_editorial!.admission!.provider_available = false;
  const saved = render(recovery);
  assert.match(saved, locale === "es-MX" ? /Recuperar resultados guardados/ : /Recover saved results/);
  assert.doesNotMatch(saved, locale === "es-MX" ? /Autorizar y continuar|Hace falta otro permiso/ : /Authorize and continue|Another spending authorization/);
  assert.doesNotMatch(saved, /<input /);
  assert.equal(workspaceIncrementalEditorialCanSubmit(recovery, retry), true);
  assert.equal(posts, 0);
});

for (const locale of ["es-MX", "en-US"]) test(`${locale}: unavailable renewal explains server reason without hiding paid recovery`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (value: WorkspaceAnalysisStatus) => renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
    <WorkspaceIncrementalEditorialControls status={value} canSubmit canRevoke={false} submitting={false} canReplay={false}
      onReplay={async () => {}} onSubmit={async () => {}} />
  </NextIntlClientProvider>);
  const copy = messages.AdminWorkspace.topics.analysis.incrementalEditorial;
  for (const [reason, key] of [["cap_exceeded", "budgetUnavailable"], ["forbidden", "permission"], ["source_stale", "changed"]] as const) {
    const html = render(withRenewal({ can_renew: false, blocked_reason: `workspace_incremental_editorial_${reason}` }));
    assert.ok(html.includes(copy[key]));
    assert.doesNotMatch(html, locale === "es-MX" ? /Autorizar y continuar/ : /Authorize and continue/);
  }
  const stale = render(withRenewal({ can_renew: false, blocked_reason: "workspace_incremental_editorial_source_stale" }, { is_current: false }));
  assert.equal(stale.split(copy.changed).length - 1, 1);
  const saved = render(withRenewal({ can_renew: false, blocked_reason: "workspace_incremental_editorial_cap_exceeded" }, { recorded_recovery_available: true, can_retry: true }));
  assert.ok(!saved.includes(copy.budgetUnavailable));
});
