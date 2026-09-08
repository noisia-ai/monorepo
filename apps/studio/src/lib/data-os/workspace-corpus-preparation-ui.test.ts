import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { corpusPreparationAction, latestCorpusPreparationSnapshot, preparationRequestWasObserved, WorkspaceCorpusPreparationPanel,
  type CorpusPreparationView } from "../../components/admin/WorkspaceCorpusPreparationPanel";

Object.assign(globalThis, { React });
const base: CorpusPreparationView = {
  contract_version: "signal-workspace-corpus-preparation-v1", workspace_id: "preparation-test",
  observed_at: "2026-09-08T20:00:00.000001Z", input_revision: 2, can_prepare: true,
  active_run: null, latest_run: null, latest_completed: null, is_current: false, needs_preparation: true
};
const complete: NonNullable<CorpusPreparationView["latest_run"]> = {
  id: "run-complete", status: "completed", phase: "complete", input_revision: 1,
  counts: { total_roots: 20, processed_roots: 20, eligible_roots: 10, excluded_roots: 3,
    rights_blocked_roots: 4, missing_text_roots: 1, inclusion_pending_roots: 2, reused_roots: 0, new_roots: 20,
    changed_roots: 0, removed_roots: 0, chunk_count: 25 },
  error_code: null, retryable: false, created_at: "2026-09-08T18:00:00.000Z",
  updated_at: "2026-09-08T18:01:00.000Z", completed_at: "2026-09-08T18:01:00.000Z"
};
const running = { ...complete, id: "run-active", status: "running" as const, phase: "chunking" as const,
  counts: { ...complete.counts, processed_roots: 6 }, completed_at: null };

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const copy = messages.AdminWorkspace.data.corpusPreparation;
  const render = (initial: CorpusPreparationView | null, hasReceivedFiles = true) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceCorpusPreparationPanel, { initial, workspaceId: base.workspace_id, hasReceivedFiles, receiptObservedAt: base.observed_at })));

  test(`${locale}: preparation is available only for an authorized workspace with received files`, () => {
    assert.ok(render(base).includes(copy.actions.prepare));
    for (const html of [render(null), render(base, false), render({ ...base, can_prepare: false })]) {
      assert.ok(!html.includes(`>${copy.actions.prepare}</button>`));
      assert.doesNotMatch(html, /<progress/u);
    }
    assert.ok(render(base, false).includes(copy.body.awaiting_import));
    assert.ok(render({ ...base, can_prepare: false }).includes(copy.readOnly));
    assert.ok(render(base).includes(copy.cost));
  });

  test(`${locale}: active preparation uses a fixed run denominator and keeps previous results visible`, () => {
    const html = render({ ...base, active_run: running, latest_run: running, latest_completed: complete });
    assert.match(html, /<progress[^>]*max="20"[^>]*value="6"/u);
    assert.ok(html.includes(copy.newInputs));
    assert.ok(html.includes(copy.lastCompleted.replace("{prepared}", "10").replace("{excluded}", "3")));
    assert.ok(!html.includes(`>${copy.actions.prepare}</button>`));
    assert.ok(!html.includes(`>${copy.actions.update}</button>`));
    assert.doesNotMatch(html, /run-active|run-complete|2026-09-08T/u);
    const counting = render({ ...base, active_run: { ...running, phase: "snapshotting", counts: { ...running.counts, total_roots: 0, processed_roots: 0 } } });
    assert.ok(counting.includes(copy.counting));
    assert.doesNotMatch(counting, /<progress/u);
  });

  test(`${locale}: completed text does not imply Topic analysis and accounts for unprepared mentions`, () => {
    const html = render({ ...base, latest_run: complete, latest_completed: complete, is_current: true, needs_preparation: false });
    assert.ok(html.includes(copy.states.completed));
    assert.ok(html.includes(copy.body.completed));
    assert.ok(html.includes(copy.unprepared.replace("{rights}", "4").replace("{missing}", "1")));
    assert.ok(html.includes(copy.inclusionPending.replace("{count}", "2")));
    assert.doesNotMatch(html, /<progress|<form/u);
    assert.equal((html.match(/<button\b/gu) ?? []).length, 1, "only a status read remains after preparation");
    const outdated = render({ ...base, latest_run: complete, latest_completed: complete });
    assert.ok(outdated.includes(copy.states.outdated));
    assert.ok(outdated.includes(copy.actions.update));
    const pendingOnly = { ...complete, counts: { ...complete.counts, eligible_roots: 18, excluded_roots: 0,
      rights_blocked_roots: 0, missing_text_roots: 0 } };
    assert.ok(render({ ...base, latest_completed: pendingOnly }).includes(copy.inclusionPending.replace("{count}", "2")));
  });

  test(`${locale}: only a server-retryable failure offers resuming its saved progress`, () => {
    const failure = { ...running, input_revision: base.input_revision, status: "failed" as const, retryable: true, error_code: "worker_transient" };
    const recoverable = render({ ...base, latest_run: failure });
    assert.ok(recoverable.includes(copy.actions.resume));
    assert.ok(recoverable.includes(copy.preserved.replace("{count}", "6")));
    const blocked = render({ ...base, latest_run: { ...failure, retryable: false } });
    assert.ok(blocked.includes(copy.body.blocked));
    assert.ok(!blocked.includes(`>${copy.actions.resume}</button>`));
    assert.doesNotMatch(blocked, /worker_transient/u);
    const permissions = render({ ...base, latest_run: { ...failure, retryable: false, error_code: "corpus_preparation_forbidden" } });
    assert.ok(permissions.includes(copy.failures.permissions));
    assert.ok(permissions.includes(copy.actions.restart));
    assert.ok(!permissions.includes(`>${copy.actions.resume}</button>`));
  });
}

test("new GET progress survives a late queued POST and snapshots from another workspace", () => {
  const recent = { ...base, observed_at: "2026-09-08T20:00:00.000002Z", active_run: running, latest_run: running };
  const queued = { ...base, active_run: { ...running, status: "queued" as const } };
  assert.equal(latestCorpusPreparationSnapshot(recent, queued, base.workspace_id), recent);
  assert.equal(latestCorpusPreparationSnapshot(recent, { ...base, workspace_id: "other" }, base.workspace_id), recent);
  assert.equal(latestCorpusPreparationSnapshot(recent, base, "other"), null);
});

test("a confirmed request releases its old key before a future import, while an unchanged read stays uncertain", () => {
  const pending = { workspaceId: base.workspace_id, previousRunId: complete.id, previousRunUpdatedAt: complete.updated_at };
  assert.equal(preparationRequestWasObserved({ ...base, latest_run: complete }, pending), false);
  assert.equal(preparationRequestWasObserved({ ...base, active_run: running }, pending), true);
  assert.equal(preparationRequestWasObserved({ ...base, latest_run: running }, pending), true);
  assert.equal(preparationRequestWasObserved({ ...base, latest_run: { ...complete, updated_at: "2026-09-08T19:00:00.000Z" } }, pending), true);
  assert.equal(preparationRequestWasObserved({ ...base, is_current: true }, pending), true);
  assert.equal(preparationRequestWasObserved({ ...base, workspace_id: "other", is_current: true }, pending), false);
});

test("non-retryable failures require changed inputs or currently authorized access restoration for a new preparation", () => {
  const failure = { ...complete, status: "failed" as const, input_revision: base.input_revision, retryable: false,
    error_code: "corpus_preparation_asset_hash_mismatch" };
  assert.equal(corpusPreparationAction({ ...base, latest_run: failure }, true), null);
  assert.equal(corpusPreparationAction({ ...base, latest_run: failure, input_revision: 3 }, true), "restart");
  const restored = { ...base, latest_run: { ...failure, error_code: "corpus_preparation_forbidden" } };
  assert.equal(corpusPreparationAction(restored, true), "restart");
  assert.equal(corpusPreparationAction({ ...restored, can_prepare: false }, true), null);
  assert.equal(corpusPreparationAction(restored, false), null);
  assert.equal(corpusPreparationAction({ ...restored, active_run: running }, true), null);
});
