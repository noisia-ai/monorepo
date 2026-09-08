import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { SignalWorkspaceCorpusReadinessV1 } from "@noisia/db";
import { latestCorpusReadinessSnapshot, WorkspaceCorpusReadinessPanel } from "../../components/admin/WorkspaceCorpusReadinessPanel";

Object.assign(globalThis, { React });

const receipt: SignalWorkspaceCorpusReadinessV1 = {
  contract_version: "signal-workspace-corpus-readiness-v1",
  workspace_id: "workspace-receipt-test", observed_at: "2026-09-08T18:00:00.000001Z",
  state: "received", accepted_files: 3, records_read: 14,
  dispositions: { included: 9, excluded: 2, duplicates: 3 },
  projection: { observations: 11, linked_roots: 6, included_roots: 5, excluded_roots: 1, roots_with_text: 5 },
  eligibility: { rights_eligible_roots: 4, rights_blocked_roots: 1, semantic_eligible_roots: 2, semantic_pending_roots: 2 },
  reconciliation_errors: []
};

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const copy = messages.AdminWorkspace.data.corpusReadiness;
  const render = (initial: SignalWorkspaceCorpusReadinessV1 | null) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceCorpusReadinessPanel, { initial, workspaceId: receipt.workspace_id })));

  test(`${locale}: receipt distinguishes files, rows, unique mentions and available text without claiming execution`, () => {
    const html = render(receipt);
    assert.ok(html.includes(`<dt>${copy.counts.files}</dt><dd>3</dd>`));
    assert.ok(html.includes(`<dt>${copy.counts.rows}</dt><dd>14</dd>`));
    assert.ok(html.includes(`<dt>${copy.counts.unique}</dt><dd>6</dd>`));
    assert.ok(html.includes(`<dt>${copy.counts.text}</dt><dd>5</dd>`));
    assert.ok(html.includes(copy.countsHelp));
    assert.match(html, /id="corpus-readiness"/u);
    assert.match(html, /<details><summary>/u);
    assert.doesNotMatch(html, /<details[^>]+open|<form|<progress|<input|BERTopic|Claude|workspace-receipt-test|2026-09-08T/u);
    assert.equal((html.match(/<button\b/gu) ?? []).length, 1, "refresh is the only action");
    assert.ok(html.includes(copy.refresh));
    assert.ok(html.includes(copy.details.eligibilityHelp));
    assert.ok(html.includes(`<dt>${copy.details.semanticPending}</dt><dd>2</dd>`));
  });

  test(`${locale}: missing response is loading, while a confirmed empty receipt displays real zeroes`, () => {
    const unavailable = render(null);
    assert.ok(unavailable.includes(copy.loading));
    assert.match(unavailable, /aria-busy="true"/u);
    assert.doesNotMatch(unavailable, /<dd>|<details>/u);
    const empty = render({ ...receipt, state: "awaiting_import", accepted_files: 0, records_read: 0,
      dispositions: { included: 0, excluded: 0, duplicates: 0 },
      projection: { observations: 0, linked_roots: 0, included_roots: 0, excluded_roots: 0, roots_with_text: 0 },
      eligibility: { rights_eligible_roots: 0, rights_blocked_roots: 0, semantic_eligible_roots: 0, semantic_pending_roots: 0 }
    });
    assert.ok(empty.includes(copy.empty));
    assert.ok(empty.includes(`<dt>${copy.counts.files}</dt><dd>0</dd>`));
    assert.doesNotMatch(empty, /aria-busy="true"/u);
  });

  test(`${locale}: reconciliation warning preserves the receipt without exposing raw internal errors`, () => {
    const html = render({ ...receipt, state: "needs_attention", reconciliation_errors: ["canonical_root_link_invalid"] });
    assert.match(html, /role="alert"/u);
    assert.ok(html.includes(copy.reconciliation));
    assert.ok(html.includes(copy.states.needs_attention));
    assert.ok(html.includes(`<dt>${copy.counts.rows}</dt><dd>14</dd>`));
    assert.doesNotMatch(html, /canonical_root_link_invalid/u);
  });

  test(`${locale}: receipt from another workspace cannot appear in this brand panel`, () => {
    const html = render({ ...receipt, workspace_id: "other-workspace" });
    assert.doesNotMatch(html, /<dd>|other-workspace/u);
  });
}

test("late server refresh cannot replace a newer GET receipt, including sub-millisecond snapshots", () => {
  const recent = { ...receipt, observed_at: "2026-09-08T18:00:00.000002Z", accepted_files: 4 };
  const afterGet = latestCorpusReadinessSnapshot(receipt, recent, receipt.workspace_id);
  assert.equal(afterGet, recent);
  assert.equal(latestCorpusReadinessSnapshot(afterGet, receipt, receipt.workspace_id), recent);
  assert.equal(latestCorpusReadinessSnapshot(afterGet, null, receipt.workspace_id), recent);
});

test("snapshot selection never carries counts between workspaces or accepts an invalid snapshot time", () => {
  const other = { ...receipt, workspace_id: "another-workspace", observed_at: "2026-09-08T18:01:00.000000Z" };
  assert.equal(latestCorpusReadinessSnapshot(receipt, other, receipt.workspace_id), receipt);
  assert.equal(latestCorpusReadinessSnapshot(receipt, null, other.workspace_id), null);
  assert.equal(latestCorpusReadinessSnapshot(receipt, other, other.workspace_id), other);
  assert.equal(latestCorpusReadinessSnapshot(receipt, { ...receipt, observed_at: "unknown" }, receipt.workspace_id), receipt);
});
