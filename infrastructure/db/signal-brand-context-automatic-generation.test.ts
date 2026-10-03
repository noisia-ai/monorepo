import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const migration=readFile(new URL('./migrations/0153_signal_brand_context_preparation.sql',import.meta.url),'utf8');
const checkpoint=readFile(new URL('./migrations/0163_signal_semantic_context_cohort_validation_checkpoint.sql',import.meta.url),'utf8');
const digestBinding=readFile(new URL('./migrations/0164_signal_semantic_context_digest_extension_binding.sql',import.meta.url),'utf8');
// SQL contract checks, not a simulation of executing PostgreSQL. The composed
// synthetic PG journey owns the positive automatic/empty and save-only queries.
test('automatic empty authority requires a paid run from the exact admitted preparation, not a completed save',async()=>{
 const sql=await migration,body=sql.split('CREATE FUNCTION signal_brand_context_automatic_generation_v1')[1]!.split('END $$;')[0]!;
 for(const gate of ["run.generation_id=p_generation_id","run.status='completed'","run.provider_call_state='settled'",
   'admission.id=run.brand_context_preparation_operation_id','admission.workspace_id=run.workspace_id','admission.actor_user_id=run.created_by_user_id',
   "admission.action='prepare-brand-context'","admission.status='completed'","admission.brand_context_preparation->>'generation_id'=run.generation_id::text",
   "admission.brand_context_preparation->'admission' IS NOT NULL","admission.brand_context_preparation->'admission'<>'null'::jsonb",
   "run.automatic_policy_contract_version='signal-semantic-context-automatic-disposition-v1'",'signal_semantic_context_automatic_operation_run_valid_v1(run.appended_operation_id)'])assert.ok(body.includes(gate),gate);
 assert.match(body,/automatic_policy_valid_v1\(element.id\) IS DISTINCT FROM true/u);
 assert.match(body,/element.automatic_policy_outcome='ready'\)=run.automatic_ready_count/u);
 assert.match(body,/element.automatic_policy_outcome='exception'\)=run.automatic_exception_count/u);
 assert.doesNotMatch(body,/admission_not_after|clock_timestamp/u,'paid readiness does not depend on permission still being live');
});
test('edit and archive inherit automatic provenance only through the complete validated published carry census',async()=>{
 const body=(await migration).split('CREATE FUNCTION signal_brand_context_automatic_generation_v1')[1]!.split('END $$;')[0]!;
 for(const gate of ["parent.status<>'published'",'child.workspace_id<>parent.workspace_id','child.generation_version<>parent.generation_version+1',
   "artifact.metadata->>'carried_from_generation_id'=parent.id::text",'operation.id=child.created_operation_id',"operation.status='completed'",
   'expected<>actual','signal_brand_context_carried_row_valid_v1(element)','signal_brand_context_automatic_generation_v1(parent.id)'])assert.ok(body.includes(gate),gate);
 assert.match(body,/ROW\(child.brand_os_profile_id,child.brand_os_digest,child.knowledge_digest,child.locale_context_digest,child.proposal_provider_lineage_digest\)/u);
 assert.match(body,/actual<>\(SELECT count\(\*\)/u,'unproved extra copied rows fail the census');
});
test('publication preserves every baseline blocker when automatic provenance is missing',async()=>{
 const body=(await migration).split('CREATE FUNCTION signal_semantic_context_publication_snapshot_v2')[1]!.split('END $$;')[0]!;
 assert.match(body,/IF NOT signal_brand_context_automatic_generation_v1\(p_generation_id\) THEN RETURN base; END IF/u);
 assert.ok(body.indexOf('THEN RETURN base')<body.indexOf("value='zero_approved_elements'"));
 assert.match(body,/automatic_policy_outcome='exception' AND signal_semantic_context_automatic_policy_valid_v1\(id\)/u);
 assert.match(body,/value='pending_elements' AND pending=quarantined/u);
 assert.doesNotMatch(body,/brand_context_preparation->>'generation_id'/u,'a loose existence marker cannot unlock the baseline');
});

test('automatic cohort checkpoint validates once and is invalidated before every later row mutation',async()=>{
 const sql=await checkpoint;
 for(const marker of [
   'CREATE TABLE IF NOT EXISTS signal_semantic_context_automatic_cohort_validations',
   'REVOKE ALL ON signal_semantic_context_automatic_cohort_validations FROM PUBLIC',
   'BEFORE INSERT OR DELETE ON signal_semantic_context_element_versions',
   'BEFORE INSERT OR DELETE ON signal_semantic_context_events',
   'DELETE FROM signal_semantic_context_automatic_cohort_validations',
   'IF EXISTS(SELECT 1 FROM signal_semantic_context_automatic_cohort_validations checkpoint',
   'IF NOT signal_semantic_context_automatic_operation_run_valid_v1(target_operation_id)',
   'invalid_count<>0',
   'appended_event_keys<>input_keys',
   'INSERT INTO signal_semantic_context_automatic_cohort_validations(operation_id,cohort_digest)'
 ])assert.ok(sql.includes(marker),marker);
 assert.match(sql,/SECURITY DEFINER\s+SET search_path=pg_catalog,public/gu);
 assert.doesNotMatch(sql,/event_index\s*=|event_index<>|current_setting\(|set_config\(/u,
   'no caller-spoofable or missing-final-row shortcut may suppress cohort validation');
});
test('security-definer cohort validation uses an explicitly bound pgcrypto digest',async()=>{
 const sql=await digestBinding;
 const implementation=sql.split('CREATE OR REPLACE FUNCTION public.signal_semantic_context_digest_v1')[1]!;
 assert.match(sql,/extensions\.digest\(pg_catalog\.convert_to\(canonical_text,'UTF8'\),'sha256'\)/u);
 assert.match(sql,/SET search_path=pg_catalog/u);
 assert.doesNotMatch(implementation,/SELECT\s+(?:'sha256:'\|\|)?(?:pg_catalog\.)?encode\(\s*digest\(/u);
});
