import assert from "node:assert/strict";
import test from "node:test";
import { decodeSignalWorkspaceTopicResultCursorV1 } from "./signal-workspace-topic-computation-management";

test("ranking pagination preserves negative scores and rejects authority-bearing cursors", () => {
  const value = { score: -0.2, root_id: "00000000-0000-4000-8000-000000000001" };
  const encode = (item: unknown) => Buffer.from(JSON.stringify(item)).toString("base64url");
  assert.deepEqual(decodeSignalWorkspaceTopicResultCursorV1(encode(value)), value);
  assert.equal(decodeSignalWorkspaceTopicResultCursorV1(), null);
  for (const malformed of [{ ...value, workspace_id: "another" }, { ...value, score: 2 }, { ...value, score: null },
    { ...value, root_id: "broken" }, {}, []]) {
    assert.throws(() => decodeSignalWorkspaceTopicResultCursorV1(encode(malformed)), /cursor_invalid/);
  }
  assert.throws(() => decodeSignalWorkspaceTopicResultCursorV1("#bad"), /cursor_invalid/);
});
