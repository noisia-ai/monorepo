import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadSignalWorkspaceMentionsV1, type SignalWorkspaceMentionsArgsV1 } from "../signal-workspace-topics-serving";

const database: SignalWorkspaceMentionsArgsV1["database"] = { connect: async () => { throw new Error("unexpected_database_access"); } };
const access = { database, workspace_id: randomUUID(), actor_user_id: randomUUID() };
const scope = `sha256:${"a".repeat(64)}`;
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const valid = { version: 1, root_id: randomUUID(), occurred_at: "2026-09-09T01:02:03.123456Z", scope, offset: 1 };

test("mentions rejects unsupported filters, unsafe bounds and malformed dates before reading content", async () => {
  for (const change of [
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { sort_direction: "desc; SELECT" },
    { search_query: "a".repeat(301) }, { search_query: "a\0b" }, { platforms: [""] },
    { platforms: ["x\0y"] }, { platforms: "x" }, { platforms: Array(33).fill("x") },
    { workspace_id: "wrong" }, { actor_user_id: "wrong" }, { focus_mention_id: "wrong" },
    { focus_mention_id: randomUUID(), cursor: cursor(valid) }, { expected_scope_digest: "anything" },
  ]) await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, ...change } as SignalWorkspaceMentionsArgsV1), /workspace_mentions_request_invalid/u);
  for (const change of [{ date_from: "2026-02-30" }, { date_to: "2026-13-01" }, { date_from: "2026-09-10", date_to: "2026-09-09" }])
    await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, ...change }), /workspace_topics_date_invalid/u);
});

test("mentions cursors reject malformed scope, timestamps, extra fields and unsafe presentation offsets", async () => {
  for (const value of [null, [], {}, { ...valid, version: 2 }, { ...valid, root_id: "wrong" }, { ...valid, scope: "wrong" },
    { ...valid, offset: -1 }, { ...valid, offset: 1.5 }, { ...valid, offset: Number.MAX_SAFE_INTEGER },
    { ...valid, occurred_at: "2026-09-09" }, { ...valid, occurred_at: "2026-09-09T99:00:00.000000Z" },
    { ...valid, occurred_at: "2026-02-31T01:02:03.000000Z" },
    { ...valid, arbitrary: "ignored?" }, { ...valid, offset: "1" }])
    await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, cursor: cursor(value) }), /workspace_mentions_cursor_invalid/u);
  for (const value of ["", "=padding=", "a".repeat(2049)])
    await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, cursor: value }), /workspace_mentions_cursor_invalid/u);
});
