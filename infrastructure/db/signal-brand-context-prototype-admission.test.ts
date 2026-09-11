import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {createHash} from "node:crypto";
import {buildSignalWorkspaceTopicPrototypePlanV1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  signalWorkspaceEmbeddingDigestV1} from "@noisia/query-engine";

const sql = readFileSync(new URL("./migrations/0157_signal_brand_context_prototype_admission.sql", import.meta.url), "utf8");
const body = (name: string) => sql.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name}\\(`, "u"))[1]?.split("$$;")[0] ?? "";

test("automatic publication accepts a proven completed composed parent without widening legacy actors", () => {
  const proof = body("signal_brand_context_composed_generation_valid_v1");
  for (const field of ["run.processing_admission_id=admission.id", "admission.target_id=run.id",
    "admission.brand_context_processing_receipt_id=receipt.id", "run.brand_context_preparation_operation_id IS NULL",
    "run.status='completed'", "run.provider_call_state='settled'", "run.automatic_ready_count", "run.automatic_exception_count",
    "signal_semantic_context_automatic_operation_run_valid_v1", "signal_semantic_context_automatic_policy_valid_v1"]) assert.ok(proof.includes(field), field);
  const automatic = body("signal_brand_context_automatic_generation_v1");
  assert.match(automatic, /signal_brand_context_composed_generation_valid_v1\(p_generation_id\)/u);
  assert.match(automatic, /WITH RECURSIVE ancestors/u);
  assert.match(automatic, /parent\.generation_version<child\.generation_version/u);
  assert.match(automatic, /RETURN signal_brand_context_automatic_generation_pre_0157\(p_generation_id\)/u);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION signal_data_governance_actor_is_valid|can_execute_topics\s*[:=]\s*true/u);
});

test("plan integrity includes bytes, every alias, scoped definitions and exact Voyage profile", () => {
  const plan = body("signal_brand_context_prototype_plan_valid_v1");
  for (const marker of ["8388608", "signal_brand_context_prototype_configuration_v1", "plan-'plan_digest'",
    "profile.workspace_id IS DISTINCT FROM target_workspace", "term.taxonomy_id=profile.taxonomy_id",
    "definition_digest", "definition_revision", "digest(entry.value#>>'{}','sha256')",
    "normalize(entry.value#>>'{}',NFC)", "32000", "Every alias must be used", "count(DISTINCT value->>'input_digest')"])
    assert.ok(plan.includes(marker), marker);
  assert.match(plan, /COALESCE\(item->>'text_sha256'~'\^sha256:\[0-9a-f\]\{64\}\$',false\)/u);
  assert.match(plan, /EXCEPTION WHEN data_exception OR numeric_value_out_of_range THEN RETURN false/u);
  assert.match(plan, /jsonb_array_elements\(COALESCE\(plan->'context_inputs','\[\]'\)\) context_entry\(value\) WHERE context_entry.value->>'input_digest'=key/u);
  assert.doesNotMatch(plan, /jsonb_array_elements\([^\n]+\) item WHERE item->/u);
});

test("real prototype plans retain the existing JSON digest contract for newline and tab text", () => {
  const text="Synthetic workshop\nScheduled repairs\tby appointment";
  const textHash=`sha256:${createHash("sha256").update(text).digest("hex")}`;
  const plan=buildSignalWorkspaceTopicPrototypePlanV1({
    taxonomy_profile_id:"11111111-1111-4111-8111-111111111111",
    embedding_profile:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
    context_digest:`sha256:${"a".repeat(64)}`,topics:[],texts:{[textHash]:text},
    context_inputs:[{guide_key:"scope:primary_brand",role:"scope_positive",
      input_digest:`sha256:${"b".repeat(64)}`,text_sha256:textHash}]
  });
  const {plan_digest,...payload}=plan;
  assert.equal(plan_digest,signalWorkspaceEmbeddingDigestV1(payload));
  assert.notEqual(signalWorkspaceEmbeddingDigestV1(text),
    `sha256:${createHash("sha256").update(JSON.stringify(text).replaceAll("\\n","\\u000A").replaceAll("\\t","\\u0009")).digest("hex")}`);
  const planGuard=body("signal_brand_context_prototype_plan_valid_v1");
  assert.match(planGuard,/plan->>'plan_digest' IS DISTINCT FROM 'sha256:'\|\|encode\(sha256\(convert_to\(\s*signal_semantic_context_canonical_json_v1\(plan-'plan_digest'\),'UTF8'\)\),'hex'\)/u);
  const legacy=readFileSync(new URL("./migrations/0135_signal_workspace_topic_prototypes.sql",import.meta.url),"utf8");
  assert.match(legacy,/signal_semantic_context_canonical_json_v1\(NEW.topic_input_snapshot-'plan_digest'\)/u);
  assert.match(body("quote_signal_brand_context_prototypes_v1"),/signal_semantic_context_digest_json_v2\(snapshot\)/u);
});

test("quote binds publication and current policy; changed or expired inherited authority requires new confirmation", () => {
  const quote = body("quote_signal_brand_context_prototypes_v1");
  for (const marker of ["parent.actor_user_id IS DISTINCT FROM target_actor", "generation.status IS DISTINCT FROM 'published'",
    "signal_brand_context_composed_generation_valid_v1(generation.id)", "signal_brand_context_processing_source_current_v1(generation.id)",
    "newer.generation_version>generation.generation_version", "instant<parent.authorization_not_after",
    "parent.quote_snapshot->'prototype_action'", "parent.prototype_cap_micro_usd", "day=parent.budget_date", "NOT action.automatic_allowed",
    "'requires_confirmation',NOT inherited_authorization AND missing_count>0", "'awaiting_authorization'",
    "execution_cap>0 AND exposure.total_micro_usd+execution_cap>policy.daily_cap_micro_usd"]) assert.ok(quote.includes(marker), marker);
  assert.match(quote, /call\.status<>'definitely_not_sent'/u);
  assert.match(quote, /tokens:=input_bytes\*3\+missing_count\*64;estimate:=\(tokens\*12\+99\)\/100\+greatest\(0,missing_count-1\)/u);
  assert.match(quote, /'requires_provider',missing_count>0/u);
});

test("complete cache coverage creates zero-cap authority and cannot consume another provider reservation", () => {
  const quote = body("quote_signal_brand_context_prototypes_v1");
  assert.match(quote, /execution_cap:=CASE WHEN missing_count=0 THEN 0 ELSE action.max_execution_micro_usd END/u);
  assert.match(quote, /'execution_cap_micro_usd',execution_cap/u);
  assert.match(quote, /'requires_confirmation',NOT inherited_authorization AND missing_count>0/u);
  const authorize = body("authorize_signal_brand_context_prototypes_v1");
  assert.match(authorize, /snapshot,\(snapshot->>'execution_cap_micro_usd'\)::bigint/u);
  assert.equal((authorize.match(/prior.execution_cap_micro_usd/gu) ?? []).length, 2);
  const guard = body("guard_signal_brand_context_prototype_receipt_v1");
  assert.match(guard, /NEW.execution_cap_micro_usd IS DISTINCT FROM \(NEW.quote_snapshot->>'execution_cap_micro_usd'\)::bigint/u);
  assert.match(guard, /quote:=quote_signal_brand_context_prototypes_v1/u);
});

test("the direct receipt guard reconstructs the canonical quote, not a caller self-signed snapshot", () => {
  const guard = body("guard_signal_brand_context_prototype_receipt_v1");
  assert.match(guard, /quote:=quote_signal_brand_context_prototypes_v1\(NEW.parent_receipt_id,NEW.actor_user_id,NEW.plan\)/u);
  assert.match(guard, /NEW.quote_snapshot IS DISTINCT FROM quote->'quote_snapshot'/u);
  assert.match(guard, /NEW.request_digest IS DISTINCT FROM expected_request/u);
  assert.match(guard, /quote_expires_at'\)::timestamptz<=clock_timestamp\(\)/u);
});

test("admission requires both exact receipts; generic or foreign-parent admission stays closed", () => {
  const guard = body("signal_processing_admission_guard_v1");
  for (const marker of ["child.id IS NULL", "NEW.brand_context_prototype_receipt_id", "child.parent_receipt_id",
    "child.admission_id", "child.run_id", "child.actor_user_id", "child.request_digest", "child.admission_not_after",
    "NEW.brand_context_processing_receipt_id", "brand_context_prototype_receipt_required",
    "signal_brand_context_processing_lock_actor_v1", "signal_processing_lock_actor_v1"]) assert.ok(guard.includes(marker), marker);
  assert.match(guard, /NEW\.configuration IS DISTINCT FROM a\.configuration/u);
  assert.match(guard, /NEW\.configuration_digest IS DISTINCT FROM a\.configuration_digest/u);
});

test("one direct parent has one successor chain; replay precedes quote freshness", () => {
  const authorize = body("authorize_signal_brand_context_prototypes_v1");
  assert.match(sql, /CONSTRAINT uq_bc_prototype_successor UNIQUE\(supersedes_receipt_id\)/u);
  assert.match(sql, /CREATE UNIQUE INDEX uq_bc_prototype_root[\s\S]*WHERE supersedes_receipt_id IS NULL/u);
  assert.match(sql, /CONSTRAINT uq_bc_prototype_request UNIQUE\(workspace_id,actor_user_id,idempotency_key\)/u);
  const replay = authorize.slice(authorize.indexOf("IF prior.id IS NOT NULL"), authorize.indexOf("quote:=quote_signal"));
  assert.match(replay, /prior.request_digest<>request_hash/u);
  assert.match(replay, /'replayed',true/u);
  assert.doesNotMatch(replay, /INSERT INTO|UPDATE |DELETE /u);
  for (const table of ["signal_brand_context_prototype_receipts", "signal_processing_admissions", "signal_workspace_embedding_runs"])
    assert.equal((authorize.match(new RegExp(`INSERT INTO ${table}\\(`, "gu")) ?? []).length, 1);
  assert.match(authorize, /'workspace-embeddings-'\|\|run_id::text\|\|'-1',admission_id,NULL/u);
  assert.match(authorize, /prior\.admission_not_after,true,'pending',parent\.id,receipt_id/u);
  assert.doesNotMatch(authorize, /INSERT INTO signal_workspace_embedding_calls|INSERT INTO signal_semantic_context_proposal_runs/u);
  const complete = body("complete_signal_brand_context_prototype_receipt_v1");
  for (const marker of ["run.processing_admission_id IS DISTINCT FROM NEW.admission_id", "run.brand_context_preparation_operation_id IS NOT NULL",
    "run.topic_input_snapshot IS DISTINCT FROM NEW.plan", "run.status IS DISTINCT FROM 'queued'", "run.dispatch_status IS DISTINCT FROM 'pending'",
    "EXISTS(SELECT 1 FROM signal_workspace_embedding_calls WHERE run_id=NEW.run_id)"]) assert.ok(complete.includes(marker), marker);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER bc_prototype_receipt_complete AFTER INSERT[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
});

test("a fresh Stage2 grant only replaces a proven no-send attempt and never rewrites paid history", () => {
  const retry = body("signal_brand_context_prototype_retry_safe_v1");
  for (const marker of ["run.status IN('failed','canceled')", "run.execution_token IS NULL", "run.settled_micro_usd=0",
    "run.unknown_reserved_micro_usd=0", "call.status<>'definitely_not_sent'", "call.response_body_private IS NOT NULL"])
    assert.ok(retry.includes(marker), marker);
  const authorize = body("authorize_signal_brand_context_prototypes_v1");
  assert.match(authorize, /stable_confirmation IS DISTINCT FROM 'prepare_brand_context_prototypes_within_shown_cap'/u);
  assert.match(authorize, /brand_context_prototype_awaiting_authorization/u);
  assert.match(authorize, /'confirmation',stable_confirmation/u);
  assert.doesNotMatch(authorize, /UPDATE signal_(?:workspace_embedding_runs|processing_admissions|semantic_context_proposal_runs)/u);
});

test("taxonomy precedes organization money locks and every new function is private", () => {
  const authorize = body("authorize_signal_brand_context_prototypes_v1");
  const order = ["signal-semantic-context:", "signal-taxonomy:", "workspace-embedding-request:",
    "signal_processing_lock_v1", "signal_brand_context_processing_lock_actor_v1", "INSERT INTO signal_brand_context_prototype_receipts"];
  let cursor = -1;
  for (const marker of order) { const index = authorize.indexOf(marker); assert.ok(index > cursor, marker); cursor = index; }
  assert.match(authorize, /transaction_isolation'\)<>'read committed'/u);
  const functions = [...sql.matchAll(/^CREATE FUNCTION ([a-z0-9_]+)\(/gmu)].map(match => match[1]!);
  for (const name of functions) assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${name}(`), name);
  assert.match(sql, /ARRAY\['anon','authenticated'\]/u);
  assert.doesNotMatch(sql, /GRANT .* ON|SECURITY DEFINER/u);
});
