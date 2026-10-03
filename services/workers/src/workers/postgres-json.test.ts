import assert from "node:assert/strict";
import test from "node:test";

import {
  safeJsonStringifyForPostgres,
  sanitizeUnicodeForPostgresJson,
  sanitizeUnicodeForPostgresText
} from "./postgres-json";

test("sanitizeUnicodeForPostgresText preserves valid surrogate pairs", () => {
  assert.equal(sanitizeUnicodeForPostgresText("Takis 🔥"), "Takis 🔥");
});

test("sanitizeUnicodeForPostgresText replaces lone surrogate code units", () => {
  assert.equal(sanitizeUnicodeForPostgresText("bad \uD835 text"), "bad � text");
  assert.equal(sanitizeUnicodeForPostgresText("bad \uDD00 text"), "bad � text");
});

test("safeJsonStringifyForPostgres sanitizes nested json values and keys", () => {
  const json = safeJsonStringifyForPostgres({
    "bad-key-\uD835": {
      title: "𝑰𝒏𝒈𝒓𝒆𝒅𝒊𝒆𝒏𝒕\uD835",
      quotes: ["ok", "\uDD00 dangling low"]
    }
  });
  const parsed = JSON.parse(json);

  assert.equal(Object.keys(parsed)[0], "bad-key-�");
  assert.equal(parsed["bad-key-�"].title.endsWith("�"), true);
  assert.deepEqual(parsed["bad-key-�"].quotes, ["ok", "� dangling low"]);
});

test("sanitizeUnicodeForPostgresJson converts Date values to strings", () => {
  assert.deepEqual(sanitizeUnicodeForPostgresJson({ at: new Date("2026-06-08T00:00:00.000Z") }), {
    at: "2026-06-08T00:00:00.000Z"
  });
});
