import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SIGNAL_TOPIC_EDITORIAL_EXECUTION_CONFIGURATION_V1 } from '../signal-topic-consolidation-editorial';

const sql = readFileSync(new URL('./0182_signal_topic_editorial_plan_successor.sql', import.meta.url), 'utf8');

test('0182 advances SQL to the exact current provider contract', () => {
  const literal = sql.match(/SELECT '(\{"contract_version":"signal-topic-editorial-execution-config-v1".*?\})'::jsonb/u)?.[1];
  assert.ok(literal);
  assert.deepEqual(JSON.parse(literal), SIGNAL_TOPIC_EDITORIAL_EXECUTION_CONFIGURATION_V1);
});

test('0182 only supersedes a terminal zero-checkpoint obsolete plan with zero exposure', () => {
  assert.match(sql, /status='failed'/u);
  assert.match(sql, /NOT signal_topic_editorial_plan_valid_v1\(e\.numeric_run_id,e\.plan\)/u);
  assert.match(sql, /jsonb_array_length\(e\.state_body::jsonb->'screening_outputs'\),0\)=0/u);
  assert.match(sql, /c\.status<>'settled' OR COALESCE\(c\.settled_micro_usd,0\)<>0/u);
  assert.match(sql, /c\.status<>'definitely_not_sent'/u);
  assert.match(sql, /supersedes_execution_id uuid REFERENCES signal_topic_editorial_executions\(id\)/u);
  assert.match(sql, /prior\.id IS DISTINCT FROM \(SELECT candidate\.id FROM signal_topic_editorial_executions candidate[\s\S]*ORDER BY candidate\.created_at DESC,candidate\.id DESC LIMIT 1\)/u);
  assert.match(sql, /CREATE UNIQUE INDEX uq_topic_editorial_live_numeric_run[\s\S]*WHERE status<>'failed'/u);
  assert.match(sql, /ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE/u);
});

test('0182 preserves exact request replay before successor admission and rejects retrying an obsolete plan', () => {
  const replay = sql.indexOf('SELECT * INTO prior FROM signal_topic_editorial_request_keys');
  const owner = sql.indexOf('SELECT * INTO existing FROM signal_topic_editorial_executions');
  const quote = sql.indexOf('q:=signal_topic_editorial_quote_v1');
  assert.ok(replay >= 0 && owner > replay && quote > owner);
  assert.match(sql, /OR NOT signal_topic_editorial_plan_valid_v1\(e\.numeric_run_id,e\.plan\)/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION signal_topic_editorial_execution_replaceable_v1\(uuid\) FROM PUBLIC/u);
});
