import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const migration=(name:string)=>readFileSync(new URL(`./migrations/${name}`,import.meta.url),"utf8");
const sql=migration("0157_signal_brand_context_prototype_admission.sql");
function body(source:string,name:string){const expression=new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name}\\([^]*?AS \\$\\$([^]*?)\\$\\$;`);const match=source.match(expression);assert.ok(match,`${name} exists`);return match[1]!;}
const condition="NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.published_by_user_id)";
const replacement="NOT (signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.published_by_user_id)\n         OR signal_brand_context_composed_publication_actor_v1(NEW.id,NEW.published_by_user_id))";
test("generation and V2 publication keep every prior guard except the exact paid publication alternative",()=>{
 for(const [name,prior] of [
  ["validate_signal_semantic_context_generation_v1","0153_signal_brand_context_preparation.sql"],
  ["validate_signal_semantic_context_publication_v2","0097_signal_semantic_context_review_publication_v2.sql"]]){
  const original=body(migration(prior!),name!);assert.equal(original.split(condition).length,2);
  assert.equal(body(sql,name!),original.replace(condition,replacement));
 }
});
test("paid publication is direct, actor-bound, settled and contains only its automatic output",()=>{
 const proof=body(sql,"signal_brand_context_composed_publication_actor_v1");
 for(const check of ["receipt.actor_user_id=target_actor","receipt.generation_id=target_generation","signal_brand_context_composed_generation_valid_v1(target_generation)",
  "reservation.status='settled'","reservation.actual_micro_usd=run.settled_micro_usd","run.provider_call_count=1",
  "run.provider_response_private IS NOT NULL","signal_semantic_context_digest_json_v2(to_jsonb(run.provider_response_private))","element.operation_id IS DISTINCT FROM run.appended_operation_id",
  "element.automatic_policy_contract_version IS DISTINCT FROM 'signal-semantic-context-automatic-disposition-v1'"])
  assert.ok(proof.includes(check),check);
 assert.doesNotMatch(proof,/current_policy|signal_processing_capacity|can_execute|signal_data_governance_actor_is_valid/u);
 assert.match(sql,/REVOKE ALL ON FUNCTION signal_brand_context_composed_publication_actor_v1\(uuid,uuid\) FROM PUBLIC/u);
});
test("recovery already bypasses monetary revalidation; reserve and send keep the existing fences",()=>{
 const original=migration("0155_signal_processing_policy.sql");const owner=body(original,"signal_processing_owner_guard_v1");
 assert.ok(owner.indexOf("RETURN NEW;\n END IF;")<owner.indexOf("PERFORM signal_processing_capacity_v1"));
 const ledger=body(original,"signal_processing_ledger_guard_v1");
 assert.match(ledger,/OLD.provider_call_state='not_started' AND NEW.provider_call_state='in_flight'/u);
 assert.match(ledger,/OLD.status='reserved' AND NEW.status='in_flight'/u);
 assert.doesNotMatch(sql,/CREATE (?:OR REPLACE )?FUNCTION signal_processing_owner_guard_v1/u);
 assert.doesNotMatch(sql,/CREATE (?:OR REPLACE )?FUNCTION signal_processing_ledger_guard_v1/u);
});

test("persisted-response append proof binds one operation, generation, actor, parent and exact reservation",()=>{
 const proof=body(sql,"signal_brand_context_composed_append_actor_v1");
 for(const check of ["operation.status IS DISTINCT FROM 'in_progress'","operation.action IS DISTINCT FROM 'append-semantic-context-proposals'",
  "receipt.actor_user_id=target_actor","receipt.generation_id=target_generation","receipt.semantic_run_id=run.id",
  "run.provider_call_state='response_persisted'","run.provider_call_count=1","reservation.status='reserved'",
  "operation.semantic_context_decision_input_digest","run.provider_response_digest=signal_semantic_context_digest_json_v2(to_jsonb(run.provider_response_private))",
  "reservation.reservation_micro_usd=run.reservation_micro_usd","run.appended_operation_id IS NULL","run_input->>'settled_micro_usd'","run.provider_lineage_digest=run_input->>'provider_lineage_digest'"])
  assert.ok(proof.includes(check),check);
 assert.doesNotMatch(proof,/signal_data_governance_actor_is_valid|signal_processing_capacity_v1|policy.status/u);
 assert.match(sql,/REVOKE ALL ON FUNCTION signal_brand_context_composed_append_actor_v1\(uuid,uuid,uuid\) FROM PUBLIC/u);
});
test("append and event alternatives preserve the complete historical guards and remain origin/event scoped",()=>{
 const element=body(sql,"validate_signal_semantic_context_element_operation_v2");
 const before=body(migration("0153_signal_brand_context_preparation.sql"),"validate_signal_semantic_context_element_operation_v2");
 const old="NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.proposed_by_user_id)";
 const replacement="NOT (signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.proposed_by_user_id)\n       OR (NEW.origin_kind IN ('provider_proposal','server_projection')\n        AND signal_brand_context_composed_append_actor_v1(NEW.operation_id,NEW.generation_id,NEW.proposed_by_user_id)))";
 assert.equal(element,before.replace(old,replacement));
 const event=body(sql,"validate_signal_semantic_context_event_v1");
 assert.match(event,/NEW.event_kind IN \('proposals_appended','automatic_policy_ready'\)/u);
 assert.match(event,/signal_brand_context_composed_append_actor_v1\(NEW.operation_id,NEW.generation_id,NEW.actor_user_id\)/u);
 assert.match(event,/NEW.event_kind='generation_published'/u);
 assert.match(event,/published.published_operation_id=NEW.operation_id/u);
 // Cohort constraints remain intact and still demand settlement at transaction completion.
 assert.doesNotMatch(sql,/DROP TRIGGER.*automatic_(?:event|policy)|CREATE (?:OR REPLACE )?FUNCTION validate_signal_semantic_context_automatic_policy_cohort_v1/u);
});
