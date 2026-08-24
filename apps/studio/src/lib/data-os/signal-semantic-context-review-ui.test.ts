import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignalSemanticContextMutationLockV1,
  signalSemanticContextAnnotationResolutionsV1,
  signalSemanticContextBoundedPendingSelectionV1,
  signalSemanticContextReviewRangeV1,
  signalSemanticContextSelectionWithinVisiblePageV1,
  submitSignalSemanticContextBulkApprovalUiV1,
  submitSignalSemanticContextGuidedRejectUiV1,
  submitSignalSemanticContextMergeUiV1
} from "./signal-semantic-context-review-ui";

test("mutation lock rejects rapid double activation until the active command settles", () => {
  const lock = createSignalSemanticContextMutationLockV1();
  assert.equal(lock.begin(), true);
  assert.equal(lock.isActive(), true);
  assert.equal(lock.begin(), false);
  lock.end();
  assert.equal(lock.isActive(), false);
  assert.equal(lock.begin(), true);
});

test("empty and populated ranges never render a negative endpoint", () => {
  assert.deepEqual(signalSemanticContextReviewRangeV1({ total: 0, visible: 0, pageIndex: 0, pageSize: 20 }),
    { start: 0, end: 0 });
  assert.deepEqual(signalSemanticContextReviewRangeV1({ total: 45, visible: 5, pageIndex: 2, pageSize: 20 }),
    { start: 41, end: 45 });
});

test("bounded bulk selection accepts only explicit pending leaves", () => {
  const elements = [
    { element_key: "a", disposition: "pending" },
    { element_key: "b", disposition: "approved" }
  ];
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: ["a"], elements }), true);
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: [], elements }), false);
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: ["a", "b"], elements }), false);
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: ["hidden"], elements }), false);
  assert.equal(signalSemanticContextBoundedPendingSelectionV1({
    selectedKeys: Array.from({ length: 101 }, (_, index) => `item-${index}`), elements: []
  }), false);
});

test("selection remains valid only while every key is on the visible page", () => {
  assert.equal(signalSemanticContextSelectionWithinVisiblePageV1({
    selectedKeys: ["a", "b"], visibleElementKeys: ["a", "b", "c"]
  }), true);
  assert.equal(signalSemanticContextSelectionWithinVisiblePageV1({
    selectedKeys: ["a", "hidden"], visibleElementKeys: ["a", "b", "c"]
  }), false);
});

test("bulk approval sends sorted, deduped keys and no hidden filter authority", async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  await submitSignalSemanticContextBulkApprovalUiV1({
    request: async (path, init) => { calls.push({ path, init }); return {}; },
    base: "/semantic-context",
    generationKey: "generation-v1",
    elementKeys: ["b", "a", "b"],
    idempotencyKey: "bulk-key"
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/semantic-context/decisions");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    action: "bulk_approve",
    generation_key: "generation-v1",
    element_keys: ["a", "b"]
  });
  assert.doesNotMatch(String(calls[0]!.init.body), /filter|all_population|workspace_id/u);
});

test("guided rejection crosses one atomic server-owned command boundary", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  await submitSignalSemanticContextGuidedRejectUiV1({
    request: async (path, init) => {
      calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return {};
    },
    base: "/semantic-context",
    generationKey: "generation-v1",
    elementKey: "element-a",
    reason: "insufficient_context",
    rationale: "The governed evidence does not distinguish this concept.",
    idempotencyKey: "reject-key"
  });
  assert.deepEqual(calls.map((call) => call.path), ["/semantic-context/decisions"]);
  assert.equal(calls[0]!.body.rationale, "The governed evidence does not distinguish this concept.");
  assert.equal(calls[0]!.body.reason, "insufficient_context");
  assert.equal(calls[0]!.body.action, "reject");
});

test("guided rejection cannot expose an intermediate browser annotation state", async () => {
  const paths: string[] = [];
  await assert.rejects(submitSignalSemanticContextGuidedRejectUiV1({
    request: async (path) => {
      paths.push(path);
      throw new Error("cut");
    },
    base: "/semantic-context",
    generationKey: "generation-v1",
    elementKey: "element-a",
    reason: "insufficient_context",
    rationale: "Needs more governed context.",
    idempotencyKey: "reject-key"
  }), /cut/u);
  assert.deepEqual(paths, ["/semantic-context/decisions"]);
});

test("merge creates only missing near-duplicate annotations before exact N-to-1 command", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  await submitSignalSemanticContextMergeUiV1({
    request: async (path, init) => {
      calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return {};
    },
    base: "/semantic-context",
    generationKey: "generation-v1",
    targetElementKey: "target",
    sourceElementKeys: ["source-b", "source-a"],
    missingAnnotationKeys: { "source-a": "merge-candidate:a" },
    reason: "duplicate_same_concept",
    rationale: "Both source leaves represent the same governed need.",
    targetCorrection: {
      canonical_key: "canonical-target",
      display_text: "Canonical target",
      scope: "primary_brand",
      locale: "es-MX",
      relation_kind: null,
      relation_target_key: null
    },
    idempotencyKey: "merge-key"
  });
  assert.deepEqual(calls.map((call) => call.path), [
    "/semantic-context/annotations", "/semantic-context/merge"
  ]);
  assert.deepEqual(calls[1]!.body.source_element_keys, ["source-a", "source-b"]);
  assert.equal(calls[1]!.body.target_element_key, "target");
});

test("annotation resolution choices remain closed by annotation kind", () => {
  assert.deepEqual(signalSemanticContextAnnotationResolutionsV1("near_duplicate"), ["kept_distinct"]);
  assert.deepEqual(signalSemanticContextAnnotationResolutionsV1("locale_unresolved"),
    ["governed_locale", "global"]);
  assert.deepEqual(signalSemanticContextAnnotationResolutionsV1("competitive_unit_unresolved"),
    ["canonical_unit", "not_applicable"]);
});
