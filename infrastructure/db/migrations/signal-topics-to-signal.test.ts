import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("./0127_signal_topics_to_signal.sql", import.meta.url);
const hardeningUrl = new URL("./0128_signal_topics_to_signal_hardening.sql", import.meta.url);

test("Topics catalog migration keeps search evidence durable and corrections replay-safe", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "signal_topic_catalog_operations",
    "signal_topic_catalog_executions",
    "signal_topic_classification_items",
    "signal_topic_classification_suggestions",
    "signal_topic_membership_overrides",
    "signal_topic_membership_operations",
    "signal_topic_definition_embeddings"
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "u"));
  assert.match(sql, /UNIQUE\(workspace_id,idempotency_key\)/u);
  assert.match(sql, /signal_topic_membership_operations[\s\S]*request_digest text NOT NULL/u);
  assert.doesNotMatch(sql, /(?:DROP TABLE|TRUNCATE|DELETE FROM mentions|ON DELETE CASCADE\s*\n?\s*REFERENCES mentions)/u);
});

test("Topics publication verifies a complete current result before replacing the active profile", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const complete = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION complete_signal_topic_catalog_profile_v1"),
    sql.indexOf("CREATE OR REPLACE FUNCTION append_signal_classification_result_batch_v1")
  );
  assert.match(complete, /intent='search' AND status='ready'/u);
  assert.match(complete, /source\.denominator<>\(SELECT count\(\*\)/u);
  assert.match(complete, /signal_classification_watermark_digest_v1/u);
  assert.match(complete, /signal_data_governance_actor_is_valid/u);
  assert.ok(complete.indexOf("status='retired'") < complete.lastIndexOf("status='active'"));
});

test("one classification item accepts zero or many assignments for the same root", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const append = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION append_signal_classification_result_batch_v1"));
  assert.match(append, /jsonb_array_length\(target_assignments\)>128/u);
  assert.match(append, /INSERT INTO signal_classification_generation_items/u);
  assert.match(append, /jsonb_to_recordset\(target_assignments\)/u);
  assert.match(append, /INSERT INTO signal_classification_assignments/u);
  assert.match(append, /CASE WHEN assignment_count>0 THEN 'approved' ELSE 'abstained' END/u);
  assert.match(append, /IF operation\.status='completed'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION append_signal_classification_result_batch_v1/u);
});

test("Topics hardening seals population, corrections and paid embedding outcomes", async () => {
  const sql = await readFile(hardeningUrl, "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS signal_topic_embedding_calls/u);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS signal_topic_classification_outbox/u);
  assert.match(sql, /pricing_version text NOT NULL/u);
  assert.match(sql, /input_digests text\[\] NOT NULL/u);
  assert.match(sql, /embedding_cost_cap_micro_usd bigint/u);
  assert.match(sql, /status IN \('reserved','sent_unknown','completed','failed'\)/u);
  assert.match(sql, /signal_topic_membership_override_digest_v1/u);
  assert.match(sql, /source\.population_digest IS DISTINCT FROM execution\.population_digest/u);
  assert.match(sql, /source\.identity_catalog_digest IS DISTINCT FROM execution\.identity_catalog_digest/u);
  assert.match(sql, /source\.result_summary->>'correction_digest' IS DISTINCT FROM correction_digest/u);
  assert.match(sql, /target_current_population_digest text/u);
  assert.match(sql, /target_current_identity_catalog_digest text/u);
  assert.match(sql, /target_current_definition_digest text/u);
  assert.match(sql, /target_current_denominator integer/u);
  assert.match(sql, /requires a freshly recomputed population and definition snapshot/u);
  assert.match(sql, /profile\.status='activating'/u);
  assert.doesNotMatch(sql, /(?:DROP TABLE|TRUNCATE|DELETE FROM mentions)/u);
});
