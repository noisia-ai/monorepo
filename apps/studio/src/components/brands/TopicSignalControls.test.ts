import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canChangeTopicSignalSelectionV1 } from "./TopicSignalControls";
import type { TopicSignalSelectionV1 } from "@/lib/data-os/signal-topic-selection-ui";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const state: TopicSignalSelectionV1 = {
  workspace_id: "workspace",
  term_key: "service",
  request_scope: "a".repeat(64),
  observed_at: "2026-09-11T12:00:00.000001Z",
  can_select: true,
  selection_revision: 3,
  selected: true,
  definition_revision: 1,
  definition_digest: digestA,
  generation_id: "00000000-0000-4000-8000-000000000001",
  is_current: true,
  is_processing: false,
  mention_count: 12,
  request_receipt: null
};

test("a selected serving definition can be removed while a newer working definition is pending", () => {
  assert.equal(canChangeTopicSignalSelectionV1(state,
    { definitionRevision: 2, definitionDigest: digestB }, false), true);
  assert.equal(canChangeTopicSignalSelectionV1({ ...state, selected: false },
    { definitionRevision: 2, definitionDigest: digestB }, false), false);
});

test("selecting requires the exact current working definition and every local edit/access fence", () => {
  const unselected = { ...state, selected: false };
  assert.equal(canChangeTopicSignalSelectionV1(unselected,
    { definitionRevision: 1, definitionDigest: digestA }, false), true);
  assert.equal(canChangeTopicSignalSelectionV1(unselected,
    { definitionRevision: 1, definitionDigest: digestA }, true), false);
  assert.equal(canChangeTopicSignalSelectionV1({ ...state, can_select: false },
    { definitionRevision: 2, definitionDigest: digestB }, false), false);
});

test("the client Topics entry keeps Brand OS in its scoped journey", async () => {
  const page = await readFile(new URL("../../app/signal/[outputId]/manage/topics/page.tsx", import.meta.url), "utf8");
  assert.match(page, /brandOs:\s*entry\.navigation\.brandOsHref/u);
  assert.match(page, /navigation=\{entry\.navigation\}/u);
  assert.doesNotMatch(page, /brandOs(?:Href)?:\s*null/u);
});
