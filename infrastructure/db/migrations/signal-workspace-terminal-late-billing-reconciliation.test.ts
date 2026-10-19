import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./0172_signal_workspace_terminal_late_billing_reconciliation.sql", import.meta.url),
  "utf8"
);

test("audited terminal usage can be reconciled after its one transport successor exists", () => {
  assert.match(sql, /OLD\.call_state='terminal_confirmed'.*NEW\.call_state='terminal_confirmed'/su);
  assert.match(sql, /workspace-provider-terminal-billing-v1/u);
  assert.match(sql, /NEW\.response_storage_key IS NULL/u);
  assert.doesNotMatch(sql, /NOT EXISTS\(SELECT 1 FROM engine_cost_events retry WHERE retry\.retry_of_call_id=OLD\.id\)/u);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|GRANT EXECUTE/iu);
});
