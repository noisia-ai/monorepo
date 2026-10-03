import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./0173_signal_workspace_terminal_billing_scale.sql", import.meta.url),
  "utf8"
);

test("terminal settlement validates the persisted numeric ledger scale", () => {
  assert.match(sql, /estimated_cost_usd=\(NEW\.settled_micro_usd::numeric\/1000000\)::numeric\(10,4\)/u);
  assert.doesNotMatch(sql, /NOT EXISTS\(SELECT 1 FROM engine_cost_events retry WHERE retry\.retry_of_call_id=OLD\.id\)/u);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|GRANT EXECUTE/iu);
});
