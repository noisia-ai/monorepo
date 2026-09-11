import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("./migrations/0156_signal_brand_context_composed_admission.sql", import.meta.url), "utf8");
const policySql = readFileSync(new URL("./migrations/0155_signal_processing_policy.sql", import.meta.url), "utf8");
const proposalSql = readFileSync(new URL("./migrations/0092_signal_semantic_context_proposal_execution.sql", import.meta.url), "utf8");
const functionBody = (name: string, next: string) => sql.split(`CREATE FUNCTION ${name}`)[1]?.split(next)[0] ?? "";

test("stage one has one five-argument admission and no fabricated Voyage target", () => {
  assert.match(sql, /CREATE FUNCTION authorize_signal_brand_context_processing_v1\(target_workspace uuid,target_actor uuid,request_key text,\s*quote_hash text,stable_confirmation text\)/u);
  assert.doesNotMatch(sql, /CREATE FUNCTION admit_signal_brand_context_prototypes_v1/u);
  const authorize = functionBody("authorize_signal_brand_context_processing_v1", "REVOKE ALL ON signal_brand_context_processing_receipts");
  assert.equal([...authorize.matchAll(/signal-processing-policy:/gu)].length, 1,
    "authorization takes the organization policy advisory lock exactly once");
  assert.equal((authorize.match(/INSERT INTO signal_processing_admissions/gu) ?? []).length, 1);
  assert.match(authorize, /'brand_context_proposal'/u);
  assert.doesNotMatch(authorize, /'topic_prototype_embeddings'|'voyage'|signal_workspace_embedding_runs/u);
  assert.match(sql, /Stage two intentionally remains a closed contract/u);
});

test("the client fence exactly inherits can_request_processing and generic admission cannot bypass the receipt", () => {
  const actor = functionBody("signal_brand_context_processing_actor_v1", "CREATE FUNCTION signal_brand_context_processing_lock_actor_v1");
  assert.match(actor, /u\.user_type='client'/u);
  assert.match(actor, /u\.primary_role='client_admin'/u);
  assert.match(actor, /a\.access_level='admin'/u);
  assert.doesNotMatch(actor, /brand_manager|client_owner|comment/u);
  for (const fence of ["u.organization_id=o.id", "b.organization_id=w.organization_id", "a.revoked_at IS NULL",
    "w.status='active'", "b.status='active'", "o.status='active'", "u.status='active'"]) assert.ok(actor.includes(fence), fence);
  const guard = sql.split("CREATE OR REPLACE FUNCTION signal_processing_admission_guard_v1")[1]
    ?.split("CREATE OR REPLACE FUNCTION signal_processing_capacity_v1")[0] ?? "";
  assert.match(guard, /IF NEW\.action='topic_prototype_embeddings' THEN[\s\S]*brand_context_prototype_admission_unavailable/u);
  assert.ok(guard.indexOf("brand_context_prototype_admission_unavailable")
    < guard.indexOf("NEW.brand_context_processing_receipt_id IS NULL"));
  assert.match(guard, /NEW\.brand_context_processing_receipt_id IS NULL[\s\S]*brand_context_composed_receipt_required/u);
  assert.match(guard, /signal_brand_context_processing_lock_actor_v1/u);
  assert.match(guard, /ELSE[\s\S]*signal_processing_lock_actor_v1/u);
});

test("Claude configuration is action-specific, key-closed and only narrows token ceilings", () => {
  const comparator = functionBody("signal_processing_configuration_allows_v1", "CREATE TABLE signal_brand_context_processing_receipts");
  assert.match(comparator, /target_action<>'brand_context_proposal'[\s\S]*policy_configuration IS NOT DISTINCT FROM actual_configuration/u);
  assert.equal((comparator.match(/signal_semantic_context_json_object_keys_match_v1/gu) ?? []).length, 2);
  assert.match(comparator, /actual_configuration->>'model_version' IS DISTINCT FROM policy_configuration->>'model_version'/u);
  assert.match(comparator, /actual_configuration->>'pricing_version' IS DISTINCT FROM policy_configuration->>'pricing_version'/u);
  assert.match(comparator, /actual_configuration->>'input_usd_per_million_tokens'\)::numeric\s+IS DISTINCT FROM \(policy_configuration->>'input_usd_per_million_tokens'\)::numeric/u);
  assert.match(comparator, /actual_configuration->>'output_usd_per_million_tokens'\)::numeric\s+IS DISTINCT FROM \(policy_configuration->>'output_usd_per_million_tokens'\)::numeric/u);
  assert.equal((comparator.match(/COALESCE\(actual_configuration->>'(?:input|output)_usd_per_million_tokens'/gu) ?? []).length, 2);
  assert.equal((comparator.match(/::bigint>\(policy_configuration/gu) ?? []).length, 2);
  const capacity = sql.split("CREATE OR REPLACE FUNCTION signal_processing_capacity_v1")[1]
    ?.split("CREATE FUNCTION signal_brand_context_processing_quote_state_v1")[0] ?? "";
  assert.match(capacity, /NOT signal_processing_configuration_allows_v1\(r\.action,r\.configuration,actual_configuration\)/u);
  const dayLock = capacity.indexOf("signal_processing_lock_v1(org,day)");
  assert.ok(dayLock > capacity.indexOf("day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date"));
  assert.ok(dayLock < capacity.indexOf("signal_brand_context_processing_lock_actor_v1"));
  assert.ok(dayLock < capacity.indexOf("signal_processing_lock_actor_v1"));
});

test("quote digest is reconstructible, bucketed and CASes policy, source, both caps and exposure", () => {
  const source = functionBody("signal_brand_context_processing_source_current_v1", "-- The five-minute window");
  assert.match(source, /signal_semantic_context_digest_json_v2\(brand_snapshot\) IS DISTINCT FROM generation\.brand_os_digest/u);
  assert.match(source, /current_knowledge:=signal_semantic_context_digest_json_v2/u);
  assert.match(source, /signal_acquisition_plans[\s\S]*status IN\('current','draft'\)/u);
  assert.match(source, /current_locale_digest IS DISTINCT FROM generation\.locale_context_digest/u);
  const quote = functionBody("signal_brand_context_processing_quote_state_v1", "CREATE FUNCTION signal_brand_context_processing_quote_v1");
  assert.match(quote, /NOT signal_brand_context_processing_source_current_v1\(generation\.id\)/u);
  assert.match(quote, /floor\(extract\(epoch FROM instant\)\/300\)\*300/u);
  assert.match(quote, /least\(window_start\+interval '5 minutes',p\.valid_until,\(\(day\+1\)::timestamp AT TIME ZONE p\.budget_timezone\)\)/u);
  for (const field of ["policy_digest", "budget_date", "budget_timezone", "exposure", "remaining_micro_usd",
    "source_authority_digest", "generation_id", "semantic_action", "prototype_action"]) assert.ok(quote.includes(`'${field}'`), field);
  assert.match(quote, /semantic_action\.max_execution_micro_usd\+prototype_action\.max_execution_micro_usd>remaining/u);
  assert.match(quote, /prototype_action\.max_execution_micro_usd<=0/u);
  assert.match(quote, /NOT prototype_action\.automatic_allowed/u);
  const authorize = functionBody("authorize_signal_brand_context_processing_v1", "REVOKE ALL ON signal_brand_context_processing_receipts");
  const lockOrder = ["signal-semantic-context:", "signal-processing-policy:", "signal_processing_lock_v1",
    "signal_brand_context_processing_lock_actor_v1", "signal_brand_context_processing_quote_v1"];
  let cursor = -1;
  for (const marker of lockOrder) { const next = authorize.indexOf(marker); assert.ok(next > cursor, marker); cursor = next; }
  assert.match(authorize, /quoted->>'quote_digest' IS DISTINCT FROM quote_hash/u);
  assert.match(authorize, /quote_expires_at'\)::timestamptz<=clock_timestamp\(\)/u);
});

test("exact replay is inert and every partial monetary bundle is rejected at commit", () => {
  const authorize = functionBody("authorize_signal_brand_context_processing_v1", "REVOKE ALL ON signal_brand_context_processing_receipts");
  const replay = authorize.slice(authorize.indexOf("IF prior.id IS NOT NULL THEN"),
    authorize.indexOf("SELECT * INTO p FROM signal_processing_policy_versions"));
  assert.match(replay, /request_digest IS DISTINCT FROM request_hash/u);
  assert.match(replay, /quote_digest IS DISTINCT FROM quote_hash/u);
  assert.match(replay, /'replayed',true/u);
  assert.doesNotMatch(replay, /INSERT|UPDATE|DELETE/u);
  const postLockReplay = authorize.slice(authorize.indexOf("signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);"),
    authorize.indexOf("quoted:=signal_brand_context_processing_quote_v1"));
  assert.match(postLockReplay, /SELECT \* INTO prior FROM signal_brand_context_processing_receipts/u);
  assert.match(postLockReplay, /'replayed',true/u);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER brand_context_processing_complete AFTER INSERT[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  const complete = functionBody("signal_brand_context_processing_complete_v1", "CREATE CONSTRAINT TRIGGER brand_context_processing_complete");
  for (const relation of ["signal_semantic_context_proposal_runs", "signal_semantic_context_budget_reservations",
    "signal_semantic_context_proposal_outbox"]) assert.ok(complete.includes(relation), relation);
  assert.match(complete, /run\.processing_admission_id IS DISTINCT FROM NEW\.semantic_admission_id/u);
  assert.match(complete, /run\.provider_call_state<>'not_started' OR run\.provider_call_count<>0/u);
  assert.match(complete, /reservation\.reservation_micro_usd IS DISTINCT FROM run\.reservation_micro_usd/u);
  assert.match(complete, /reservation\.reserved_input_tokens<=0 OR reservation\.reserved_input_tokens>run\.max_input_tokens/u);
  assert.match(complete, /reservation\.reserved_output_tokens IS DISTINCT FROM run\.max_output_tokens/u);
  assert.match(complete, /reservation\.reservation_micro_usd IS DISTINCT FROM ceil\([\s\S]*reserved_input_tokens::numeric\*run\.input_usd_per_million_tokens[\s\S]*reserved_output_tokens::numeric\*run\.output_usd_per_million_tokens\)::bigint/u);
  assert.match(complete, /reservation\.reservation_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2/u);
});

test("policy/day locks precede admission and all new surfaces are private", () => {
  const authorize = functionBody("authorize_signal_brand_context_processing_v1", "REVOKE ALL ON signal_brand_context_processing_receipts");
  assert.ok(authorize.indexOf("signal_processing_lock_v1") < authorize.indexOf("INSERT INTO signal_processing_admissions"));
  const defined = [...sql.matchAll(/^(?:CREATE|CREATE OR REPLACE) FUNCTION ([a-z0-9_]+)\(/gmu)].map(match => match[1]!);
  const revoked = [...sql.matchAll(/^REVOKE ALL ON FUNCTION ([a-z0-9_]+)\(/gmu)].map(match => match[1]!);
  for (const name of defined.filter(name => !["signal_processing_admission_guard_v1", "signal_processing_capacity_v1"].includes(name))) {
    assert.ok(revoked.includes(name), name);
  }
  assert.match(sql, /REVOKE ALL ON signal_brand_context_processing_receipts FROM PUBLIC/u);
  assert.match(sql, /ARRAY\['anon','authenticated'\]/u);
  assert.doesNotMatch(sql, /GRANT .* ON/u);
});

test("paid Claude recovery remains mechanical after send and cannot create a second call", () => {
  const owner = policySql.split("CREATE FUNCTION signal_processing_owner_guard_v1")[1]
    ?.split("CREATE TRIGGER aaa_processing_owner")[0] ?? "";
  const updateBranch = owner.slice(owner.indexOf("IF TG_OP='UPDATE' THEN"), owner.indexOf("actor:=COALESCE"));
  assert.match(updateBranch, /processing_admission_binding_immutable/u);
  assert.match(updateBranch, /RETURN NEW;/u);
  assert.doesNotMatch(updateBranch, /signal_processing_capacity_v1/u);

  const ledger = policySql.split("CREATE FUNCTION signal_processing_ledger_guard_v1")[1]
    ?.split("CREATE TRIGGER aaa_processing_ledger")[0] ?? "";
  assert.match(ledger, /TG_TABLE_NAME='signal_semantic_context_proposal_runs'/u);
  assert.match(ledger, /OLD\.provider_call_state='not_started' AND NEW\.provider_call_state='in_flight'/u);
  assert.match(ledger, /IF NOT \(OLD\.provider_call_state='not_started' AND NEW\.provider_call_state='in_flight'\) THEN RETURN NEW;/u);
  assert.ok(policySql.indexOf("CREATE TRIGGER aaa_processing_ledger BEFORE UPDATE ON signal_semantic_context_proposal_runs")
    > policySql.indexOf("CREATE TRIGGER aaa_processing_owner BEFORE INSERT OR UPDATE ON signal_semantic_context_proposal_runs"));
  assert.ok("aaa_processing_ledger" < "aaa_processing_owner", "PostgreSQL fires same-kind triggers in name order");
  assert.match(proposalSql, /provider_call_count BETWEEN 0 AND 1/u);
});
