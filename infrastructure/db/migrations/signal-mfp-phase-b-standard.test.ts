import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("human membership overrides are fenced by definition and root content", () => {
  const sql = migration("0250_signal_membership_override_fencing.sql");
  const store = readFileSync(new URL("../signal-concept-memberships.ts", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN definition_digest text, ADD COLUMN root_fingerprint text/u);
  assert.match(sql, /o\.definition_digest=p\.definition_digest AND o\.root_fingerprint=p\.root_fingerprint/u);
  assert.match(sql, /stale_override\.definition_digest IS DISTINCT FROM p\.definition_digest/u);
  assert.match(sql, /stale_override\.root_fingerprint IS DISTINCT FROM p\.root_fingerprint/u);
  assert.match(store, /m\.definition_digest,m\.root_fingerprint/u);
  assert.match(store, /current\.verdict<>'pending'/u);
});

test("consolidation reads facets only on the opted-in branch", () => {
  const sql = migration("0251_signal_consolidation_facets_opt_in.sql");
  const [legacy, opted] = sql.split(/\bUNION ALL\b/u);
  assert.ok(legacy && opted);
  assert.doesNotMatch(legacy, /signal_mention_facets_current_v1/u);
  assert.match(legacy, /NOT EXISTS \(SELECT 1 FROM signal_workspace_features/u);
  assert.match(opted, /LEFT JOIN signal_mention_facets_current_v1/u);
  assert.match(opted, /WHERE EXISTS \(SELECT 1 FROM signal_workspace_features/u);
});
