import assert from "node:assert/strict";
import test from "node:test";
import { safeTopicEditorialStartErrorCode, withTopicEditorialStartPhase } from "./signal-topic-editorial-start-observability";

test("editorial start diagnostics only expose allowlisted error codes", () => {
  assert.equal(safeTopicEditorialStartErrorCode({ code: "processing_forbidden" }), "processing_forbidden");
  assert.equal(safeTopicEditorialStartErrorCode(new Error("postgres://user:secret@host/private")), "internal_error");
  assert.equal(safeTopicEditorialStartErrorCode({ code: "23505", detail: "private request payload" }), "internal_error");
});

test("editorial start phase logs duration and safe outcome but never the exception message", async () => {
  const original = console.warn;
  const entries: unknown[] = [];
  console.warn = ((...values: unknown[]) => entries.push(values)) as typeof console.warn;
  try {
    await assert.rejects(withTopicEditorialStartPhase("quote_policy", async () => {
      throw new Error("postgres://user:secret@host/private");
    }, { group_count: 1652 }));
  } finally {
    console.warn = original;
  }
  const serialized = JSON.stringify(entries);
  assert.match(serialized, /quote_policy/u);
  assert.match(serialized, /internal_error/u);
  assert.match(serialized, /duration_ms/u);
  assert.doesNotMatch(serialized, /secret|private/u);
});
