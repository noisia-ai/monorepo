import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./0170_signal_workspace_terminal_billing_reconciliation.sql", import.meta.url),
  "utf8"
);

test("terminal billing reconciles audited usage without inventing a response or changing transport state", () => {
  assert.match(sql, /OLD\.call_state='terminal_confirmed'.*NEW\.call_state='terminal_confirmed'/su);
  assert.match(sql, /NEW\.response_storage_key IS NULL/u);
  assert.match(sql, /workspace-provider-terminal-billing-v1/u);
  assert.match(sql, /audited_usage_pricing/u);
  assert.match(sql, /usage_cost_micro_usd/u);
  assert.match(sql, /terminal_receipt_digest.*signal_semantic_context_canonical_json_v1/su);
  assert.match(sql, /NOT EXISTS\(SELECT 1 FROM engine_cost_events retry WHERE retry\.retry_of_call_id=OLD\.id\)/u);
  assert.match(sql, /NOT COALESCE\(\(/u);
  assert.doesNotMatch(sql, /ALTER TABLE engine_cost_events DROP CONSTRAINT workspace_interpretation_shape/u);
});

test("terminal billing stays private and preserves the original terminal receipt", () => {
  assert.match(sql, /provider_terminal_receipt' IS NOT DISTINCT FROM OLD\.metadata->'provider_terminal_receipt/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION guard_workspace_engine_interpretation_v1\(\) FROM PUBLIC/u);
  assert.doesNotMatch(sql, /GRANT EXECUTE|CREATE POLICY|SECURITY DEFINER/iu);
});

test("every provider budget boundary uses the reconciled terminal cost", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION workspace_engine_interpretation_effective_cost_v1/u);
  assert.match(sql, /CREATE OR REPLACE FUNCTION workspace_engine_interpretation_effective_state_v1/u);
  for (const boundary of [
    "guard_workspace_interpretation_admission_operation_v1",
    "guard_workspace_interpretation_call_admission_v1",
    "workspace_incremental_editorial_renewal_state_v1",
    "workspace_incremental_editorial_admission_validate_v1",
    "signal_processing_org_exposure_v1"
  ]) assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION ${boundary}`));
  assert.ok((sql.match(/workspace_engine_interpretation_effective_cost_v1\(/gu) ?? []).length >= 7);
  assert.match(sql, /input_contract='workspace-incremental-editorial-v1'.*workspace_incremental_editorial_admission_validate_v1/su);
  assert.match(sql, /workspace_incremental_editorial_execution_current_v1\(execution\.id\)/u);
});
