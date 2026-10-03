import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./0171_signal_workspace_interpretation_exceptions.sql", import.meta.url),
  "utf8"
);
const engine = readFileSync(new URL("../signal-workspace-engine.ts", import.meta.url), "utf8");

test("invalid paid repair batches are append-only quarantine evidence", () => {
  assert.match(sql, /CREATE TABLE signal_workspace_interpretation_exceptions/u);
  assert.match(sql, /UNIQUE\(execution_id,repair_call_id\)/u);
  assert.match(sql, /status text NOT NULL DEFAULT 'quarantined' CHECK\(status='quarantined'\)/u);
  assert.match(sql, /IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Interpretation exceptions are append-only\.'/u);
  assert.match(sql, /original\.call_state IS DISTINCT FROM 'settled' OR repair\.call_state IS DISTINCT FROM 'settled'/u);
  assert.match(sql, /NOT \(repair\.metadata \? 'editorial_repair'\)/u);
  assert.match(sql, /repair\.metadata->'editorial_repair'->>'source_call_id' IS DISTINCT FROM original\.id::text/u);
});

test("quarantine cannot overlap a checkpoint or another exception", () => {
  assert.match(sql, /artifact\.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'/u);
  assert.match(sql, /jsonb_array_elements_text\(artifact\.metadata->'unit_keys'\)/u);
  assert.match(sql, /jsonb_array_elements_text\(prior\.unit_manifest\)/u);
  assert.match(sql, /calculated_digest IS DISTINCT FROM NEW\.unit_digest OR duplicate_unit IS DISTINCT FROM false/u);
});

test("exception evidence is private and grants no provider authority", () => {
  assert.match(sql, /ALTER TABLE signal_workspace_interpretation_exceptions ENABLE ROW LEVEL SECURITY/u);
  assert.match(sql, /REVOKE ALL ON TABLE signal_workspace_interpretation_exceptions FROM PUBLIC/u);
  assert.doesNotMatch(sql, /GRANT EXECUTE|CREATE POLICY|SECURITY DEFINER|engine_cost_events SET/u);
});

test("quarantine excludes every transport attempt for both logical requests", () => {
  assert.ok((engine.match(/exception\.original_request_digest=call\.request_digest/gu) ?? []).length >= 2);
  assert.ok((engine.match(/exception\.repair_request_digest=call\.request_digest/gu) ?? []).length >= 2);
});
