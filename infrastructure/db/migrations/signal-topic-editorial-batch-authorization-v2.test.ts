import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql=readFileSync(new URL("./0194_signal_topic_editorial_batch_authorization_v2.sql",import.meta.url),"utf8");
const quoteSql=readFileSync(new URL("./0197_signal_topic_editorial_quote_preflight.sql",import.meta.url),"utf8");
const batchSql=readFileSync(new URL("./0193_signal_topic_editorial_message_batches_v2.sql",import.meta.url),"utf8");

test("V2 provisional quote seals source, plan identity/digest and policy cap without group-by-group revalidation",()=>{
  assert.match(quoteSql,/signal_topic_editorial_source_v1\(target_run\)/u);
  assert.match(quoteSql,/plan->'identity'->>'workspace_id' IS DISTINCT FROM target_workspace::text/u);
  assert.match(quoteSql,/plan->'identity'->>'run_id' IS DISTINCT FROM target_run::text/u);
  assert.match(quoteSql,/plan->>'plan_digest' IS DISTINCT FROM signal_semantic_context_digest_v1\(plan_body\)/u);
  assert.match(quoteSql,/jsonb_array_length\(plan->'requests'\)<>expected_groups/u);
  assert.doesNotMatch(quoteSql,/signal_topic_editorial_plan_valid_v2\(/u);
  assert.match(quoteSql,/cap:=a\.max_execution_micro_usd/u);
  assert.match(quoteSql,/exposure::numeric\+cap::numeric>p\.daily_cap_micro_usd::numeric/u);
  assert.match(quoteSql,/source_binding',source/u);
  assert.doesNotMatch(quoteSql,/least\(a\.max_execution_micro_usd,\s*(?:20000000|30000000)/u);
  assert.match(batchSql,/NEW\.plan_digest IS DISTINCT FROM o\.plan_digest OR NOT signal_topic_editorial_plan_valid_v2\(NEW\.numeric_run_id,NEW\.plan,o\.plan_canonical_body\)/u,
    "full provenance validation must remain on durable admission before an execution can commit");
});

test("authorization revalidates the signed quote inside the V2 admission transaction and prepares one durable batch",()=>{
  assert.match(sql,/signal_topic_editorial_quote_v2\(target_workspace,target_actor,[\s\S]*?expected_quote[\s\S]*?RAISE EXCEPTION 'topic_editorial_quote_stale'/u);
  assert.match(sql,/admit_signal_topic_editorial_batch_v2\(target_workspace,target_actor,plan,plan_body,request_bodies,request_key/u);
  assert.match(sql,/prepare_signal_topic_editorial_batch_v2\(\(result->>'execution_id'\)::uuid,digests,request_key\)/u);
  assert.match(sql,/REVOKE ALL ON FUNCTION request_signal_topic_editorial_batch_v2/u);
});

test("same-key response recovery validates the original quote, numeric scope and durable batch without resubmitting",()=>{
  const start=sql.indexOf("CREATE FUNCTION replay_signal_topic_editorial_batch_v2("),end=sql.indexOf("REVOKE ALL ON FUNCTION signal_topic_editorial_quote_v2",start);
  assert.ok(start>=0&&end>start);
  const replay=sql.slice(start,end);
  assert.match(replay,/signal_topic_editorial_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key/u);
  assert.match(replay,/expected_quote IS DISTINCT FROM 'v2\.'/u);
  assert.match(replay,/e\.hard_cap_micro_usd<>confirmed_cap/u);
  assert.match(replay,/target_numeric_execution/u);
  assert.match(replay,/prior\.request_digest IS DISTINCT FROM e\.request_digest/u);
  assert.match(replay,/manifest_body::jsonb IS DISTINCT FROM/u);
  assert.doesNotMatch(replay,/prepare_signal_topic_editorial_batch_v2\(/u);
  assert.doesNotMatch(replay,/signal_topic_editorial_plan_valid_v2|signal_topic_editorial_source_v1/u);
});
