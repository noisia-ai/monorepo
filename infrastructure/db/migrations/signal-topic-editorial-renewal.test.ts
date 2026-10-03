import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('./0184_signal_topic_editorial_renewal.sql', import.meta.url), 'utf8');

test('0184 renews the existing paid owner and cannot replace its historical admission', () => {
  assert.match(sql, /CREATE TABLE signal_topic_editorial_renewals/u);
  assert.match(sql, /FOREIGN KEY\(workspace_id,execution_id\) REFERENCES signal_topic_editorial_executions/u);
  assert.match(sql, /IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'topic_editorial_renewal_immutable'/u);
  assert.doesNotMatch(sql, /UPDATE signal_topic_editorial_executions SET[\s\S]*processing_admission_id\s*=/u);
  assert.doesNotMatch(sql, /UPDATE signal_processing_admissions SET/u);
  assert.match(sql, /least\(e\.hard_cap_micro_usd-run_used,p\.daily_cap_micro_usd-day_used,action_row\.max_execution_micro_usd\)/u);
  assert.match(sql, /day<COALESCE\(previous\.budget_date,initial_admission\.budget_date\)/u);
  assert.match(sql, /owner_day_used\+maximum/u);
  assert.match(sql, /renewal_already_used_today/u);
  assert.match(sql, /IF NOT signal_brand_context_processing_actor_v1\(target_workspace,target_actor\) THEN[\s\S]*topic_editorial_renewal_forbidden/u);
  assert.match(sql, /c\.status IN\('reserved','in_flight','outcome_unknown'\)/u);
  assert.match(sql, /signal_topic_editorial_source_v1\(e\.numeric_run_id\) IS DISTINCT FROM e\.source_binding/u);
});

test('0184 rechecks time and spending on both reserve and send', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION signal_topic_editorial_assert_lease_v1[\s\S]*clock_timestamp\(\)>=least\(p\.valid_until,deadline\)/u);
  assert.match(sql, /CREATE OR REPLACE FUNCTION signal_topic_editorial_call_guard_v1[\s\S]*day_amount\+NEW\.reserved_micro_usd>renewal\.grant_cap_micro_usd/u);
  assert.match(sql, /CREATE OR REPLACE FUNCTION signal_topic_editorial_call_guard_v1[\s\S]*amount\+NEW\.reserved_micro_usd>e\.hard_cap_micro_usd/u);
  assert.match(sql, /CREATE OR REPLACE FUNCTION reserve_signal_topic_editorial_call_v1[\s\S]*COALESCE\(renewal\.budget_date,a\.budget_date\)/u);
  assert.match(sql, /CREATE OR REPLACE FUNCTION mark_sent_signal_topic_editorial_call_v1[\s\S]*topic_editorial_call_scope_invalid/u);
  assert.doesNotMatch(sql, /DROP TRIGGER topic_editorial_known_rejection_guard/u);
});

test('0184 denies browser roles and keeps same-day renewal unique', () => {
  assert.match(sql, /UNIQUE\(execution_id,budget_date\)/u);
  assert.match(sql, /UNIQUE\(workspace_id,actor_user_id,idempotency_key\)/u);
  assert.match(sql, /ALTER TABLE signal_topic_editorial_renewals ENABLE ROW LEVEL SECURITY/u);
  assert.match(sql, /REVOKE ALL ON TABLE signal_topic_editorial_renewals FROM PUBLIC/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION signal_topic_editorial_renewal_quote_v1/u);
});
