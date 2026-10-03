import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("./0158_signal_brand_context_trigger_acl.sql", import.meta.url),
  "utf8"
);

const triggerFunctions = [
  "public.validate_signal_semantic_context_element_operation_v2()",
  "public.validate_signal_semantic_context_event_v1()",
  "public.validate_signal_semantic_context_generation_v1()",
  "public.validate_signal_semantic_context_publication_v2()"
] as const;

test("SQL0158 only closes the four inherited trigger-function ACLs", () => {
  assert.doesNotMatch(migration, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);

  for (const identity of triggerFunctions) {
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(migration, new RegExp(escaped, "u"));
    assert.match(migration, new RegExp(`'${escaped}'`, "u"));
  }

  assert.match(migration, /ARRAY\['anon', 'authenticated'\]/u);
  assert.equal((migration.match(/FROM PUBLIC;/gu) ?? []).length, 1);
});
