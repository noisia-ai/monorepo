-- LOCAL disposable PostgreSQL fixture after SQL0214. No provider is called.
-- Synthetic admissions represent yesterday and today; all rows roll back.
BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO organizations(id,slug,legal_name,status) VALUES
 ('f2140000-0000-4000-8000-000000000001','interest-rollover-fixture','Interest rollover','active');
INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES
 ('f2140000-0000-4000-8000-000000000002','interest-rollover@example.test','client','client_admin',
  'f2140000-0000-4000-8000-000000000001','active');
INSERT INTO brands(id,organization_id,slug,name,display_name,status) VALUES
 ('f2140000-0000-4000-8000-000000000003','f2140000-0000-4000-8000-000000000001',
  'interest-rollover-fixture','Interest rollover','Interest rollover','active');
INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,status) VALUES
 ('f2140000-0000-4000-8000-000000000004','f2140000-0000-4000-8000-000000000001',
  'f2140000-0000-4000-8000-000000000003','interest-rollover-fixture','active');
INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES
 ('f2140000-0000-4000-8000-000000000002','f2140000-0000-4000-8000-000000000003','admin');
INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,
 budget_timezone,daily_cap_micro_usd,policy_digest,created_by_user_id) VALUES
 ('f2140000-0000-4000-8000-000000000005','f2140000-0000-4000-8000-000000000001',1,'active',
  clock_timestamp()-interval '2 days',clock_timestamp()+interval '2 days','UTC',150,
  'sha256:'||repeat('a',64),'f2140000-0000-4000-8000-000000000002');
INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
 configuration_digest,max_execution_micro_usd,automatic_allowed) VALUES
 ('f2140000-0000-4000-8000-000000000005','interest_decision','provider','anthropic','claude-sonnet-4-6',
  signal_interest_decision_configuration_v1(),
  signal_semantic_context_digest_json_v2(signal_interest_decision_configuration_v1()),300,true);
INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,
 policy_version_id,action,target_id,idempotency_key,request_digest,provider,model,configuration,
 configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,
 automatic,receipt_digest)
SELECT id,'f2140000-0000-4000-8000-000000000001','f2140000-0000-4000-8000-000000000004',
 'f2140000-0000-4000-8000-000000000003','f2140000-0000-4000-8000-000000000002',
 'f2140000-0000-4000-8000-000000000005','interest_decision','f2140000-0000-4000-8000-000000000008',
 'interest-rollover:'||day::text,'sha256:'||repeat('b',64),'anthropic','claude-sonnet-4-6',
 signal_interest_decision_configuration_v1(),
 signal_semantic_context_digest_json_v2(signal_interest_decision_configuration_v1()),300,day,'UTC',
 ((day+1)::timestamp AT TIME ZONE 'UTC'),true,'sha256:'||repeat('0',64)
FROM (VALUES
 ('f2140000-0000-4000-8000-000000000006'::uuid,(clock_timestamp() AT TIME ZONE 'UTC')::date-1),
 ('f2140000-0000-4000-8000-000000000007'::uuid,(clock_timestamp() AT TIME ZONE 'UTC')::date)) admission(id,day);
INSERT INTO signal_interest_decision_owners_v1(id,workspace_id,organization_id,actor_user_id,
 generation_id,source_execution_id,taxonomy_term_id,term_key,definition_digest,source_input_digest,
 source_input_revision,source_context_digest,processing_admission_id,hard_cap_micro_usd,
 expected_roots,manifest_roots,manifest_complete,status) VALUES
 ('f2140000-0000-4000-8000-000000000008','f2140000-0000-4000-8000-000000000004',
  'f2140000-0000-4000-8000-000000000001','f2140000-0000-4000-8000-000000000002',
  'f2140000-0000-4000-8000-000000000011','f2140000-0000-4000-8000-000000000012',
  'f2140000-0000-4000-8000-000000000013','rollover-interest','sha256:'||repeat('c',64),
  'sha256:'||repeat('d',64),1,'sha256:'||repeat('e',64),
  'f2140000-0000-4000-8000-000000000006',300,2,2,true,'ready');
INSERT INTO signal_interest_decision_owner_admissions_v1(owner_id,admission_id,policy_version_id,budget_date)
SELECT 'f2140000-0000-4000-8000-000000000008',id,'f2140000-0000-4000-8000-000000000005',budget_date
 FROM signal_processing_admissions WHERE id IN('f2140000-0000-4000-8000-000000000006',
 'f2140000-0000-4000-8000-000000000007');
INSERT INTO signal_interest_decision_pages_v1(id,owner_id,page_index,root_count,first_root_id,
 last_root_id,manifest,manifest_body,page_body,manifest_digest)
SELECT page_id,'f2140000-0000-4000-8000-000000000008',page_index,1,root_id,root_id,'{}'::jsonb,
 '{"requests":['||provider_body||']}','{}',signal_semantic_context_digest_v1('{"requests":['||provider_body||']}')
FROM (VALUES
 ('f2140000-0000-4000-8000-000000000009'::uuid,0,'f2140000-0000-4000-8000-000000000014'::uuid,
  '{"custom_id":"id1_'||repeat('1',60)||'","params":{"model":"claude-sonnet-4-6","max_tokens":128000}}'),
 ('f2140000-0000-4000-8000-00000000000a'::uuid,1,'f2140000-0000-4000-8000-000000000015'::uuid,
  '{"custom_id":"id1_'||repeat('2',60)||'","params":{"model":"claude-sonnet-4-6","max_tokens":128000}}'))
 p(page_id,page_index,root_id,provider_body);
INSERT INTO signal_interest_decision_requests_v1(id,owner_id,page_id,request_index,custom_id,
 request,request_body,request_digest,interest_identity_digest,provider_request,provider_body,
 provider_request_digest,reserved_micro_usd)
SELECT request_id,'f2140000-0000-4000-8000-000000000008',page_id,0,
 'id1_'||repeat(digit,60),'{}'::jsonb,'{}','sha256:'||repeat(digit,64),
 'sha256:'||repeat('3',64),provider_body::jsonb,provider_body,
 'sha256:'||repeat('4',64),100
FROM (VALUES
 ('f2140000-0000-4000-8000-00000000000b'::uuid,'f2140000-0000-4000-8000-000000000009'::uuid,'1',
  '{"custom_id":"id1_'||repeat('1',60)||'","params":{"model":"claude-sonnet-4-6","max_tokens":128000}}'),
 ('f2140000-0000-4000-8000-00000000000c'::uuid,'f2140000-0000-4000-8000-00000000000a'::uuid,'2',
  '{"custom_id":"id1_'||repeat('2',60)||'","params":{"model":"claude-sonnet-4-6","max_tokens":128000}}'))
 r(request_id,page_id,digit,provider_body);
INSERT INTO signal_interest_decision_batches_v1(id,owner_id,page_id,admission_id,submission_key,
 state,lease_token,lease_expires_at,manifest_body,manifest_digest)
SELECT batch_id,'f2140000-0000-4000-8000-000000000008',r.page_id,
 'f2140000-0000-4000-8000-000000000006','interest-decision-page:'||r.page_id::text,'prepared',
 'f2140000-0000-4000-8000-000000000016',clock_timestamp()+interval '10 minutes',
 '{"requests":['||r.provider_body||']}',signal_semantic_context_digest_v1('{"requests":['||r.provider_body||']}')
FROM (VALUES
 ('f2140000-0000-4000-8000-00000000000d'::uuid,'f2140000-0000-4000-8000-000000000009'::uuid),
 ('f2140000-0000-4000-8000-00000000000e'::uuid,'f2140000-0000-4000-8000-00000000000a'::uuid)) b(batch_id,page_id)
JOIN signal_interest_decision_requests_v1 r ON r.page_id=b.page_id;
INSERT INTO signal_interest_decision_calls_v1(id,owner_id,request_id,batch_id,attempt_index,
 organization_id,status,reserved_micro_usd,budget_date,budget_timezone)
SELECT call_id,'f2140000-0000-4000-8000-000000000008',request_id,batch_id,1,
 'f2140000-0000-4000-8000-000000000001','reserved',100,
 (clock_timestamp() AT TIME ZONE 'UTC')::date-1,'UTC'
FROM (VALUES
 ('f2140000-0000-4000-8000-00000000000f'::uuid,'f2140000-0000-4000-8000-00000000000b'::uuid,
  'f2140000-0000-4000-8000-00000000000d'::uuid),
 ('f2140000-0000-4000-8000-000000000010'::uuid,'f2140000-0000-4000-8000-00000000000c'::uuid,
  'f2140000-0000-4000-8000-00000000000e'::uuid)) c(call_id,request_id,batch_id);
SET LOCAL session_replication_role=origin;
-- Only the source predicate is synthesized; budget, policy, owner, call and
-- batch guards execute normally. This replacement disappears on ROLLBACK.
CREATE OR REPLACE FUNCTION signal_interest_decision_source_current_v1(target_generation uuid,target_source uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT target_generation='f2140000-0000-4000-8000-000000000011'::uuid
  AND target_source='f2140000-0000-4000-8000-000000000012'::uuid
$$;
DO $$
DECLARE result jsonb;again jsonb;successor uuid;old_day date;
BEGIN
 old_day:=(clock_timestamp() AT TIME ZONE 'UTC')::date-1;
 BEGIN
  PERFORM rollover_prepared_signal_interest_decision_batch_v1(
   'f2140000-0000-4000-8000-00000000000d','f2140000-0000-4000-8000-000000000017',
   'f2140000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'wrong lease accepted';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 BEGIN
  PERFORM rollover_prepared_signal_interest_decision_batch_v1(
   'f2140000-0000-4000-8000-00000000000d','f2140000-0000-4000-8000-000000000016',
   'f2140000-0000-4000-8000-000000000018');
  RAISE EXCEPTION 'foreign actor accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 result:=rollover_prepared_signal_interest_decision_batch_v1(
  'f2140000-0000-4000-8000-00000000000d','f2140000-0000-4000-8000-000000000016',
  'f2140000-0000-4000-8000-000000000002');
 successor:=(result->>'batch_id')::uuid;
 IF result->>'replayed'<>'false'
  OR (SELECT state FROM signal_interest_decision_batches_v1
   WHERE id='f2140000-0000-4000-8000-00000000000d')<>'expired_unsubmitted'
  OR (SELECT status FROM signal_interest_decision_calls_v1
   WHERE id='f2140000-0000-4000-8000-00000000000f')<>'definitely_not_sent'
  OR (SELECT admission_id FROM signal_interest_decision_batches_v1 WHERE id=successor)
    IS DISTINCT FROM 'f2140000-0000-4000-8000-000000000007'::uuid
  OR (SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE request_id=
   'f2140000-0000-4000-8000-00000000000b')<>2
  OR (SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE batch_id=successor
   AND status='reserved' AND budget_date=(clock_timestamp() AT TIME ZONE 'UTC')::date)<>1
  OR (SELECT manifest_body FROM signal_interest_decision_batches_v1 WHERE id=successor)
   IS DISTINCT FROM (SELECT manifest_body FROM signal_interest_decision_batches_v1
    WHERE id='f2140000-0000-4000-8000-00000000000d')
  OR (SELECT total_micro_usd FROM signal_processing_org_exposure_v1(
   'f2140000-0000-4000-8000-000000000001',old_day,'UTC'))<>100
  OR claim_signal_interest_decision_batch_v1(
   'f2140000-0000-4000-8000-00000000000d') IS NOT NULL
 THEN RAISE EXCEPTION 'rollover failed to preserve exact unsent lineage';END IF;
 BEGIN
  UPDATE signal_interest_decision_batches_v1 SET state='prepared',next_poll_at=clock_timestamp()
   WHERE id='f2140000-0000-4000-8000-00000000000d';
  RAISE EXCEPTION 'expired batch was reactivated';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 again:=rollover_prepared_signal_interest_decision_batch_v1(
  'f2140000-0000-4000-8000-00000000000d','f2140000-0000-4000-8000-000000000016',
  'f2140000-0000-4000-8000-000000000002');
 IF again->>'replayed'<>'true' OR (again->>'batch_id')::uuid<>successor
  OR (SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE request_id=
   'f2140000-0000-4000-8000-00000000000b')<>2
 THEN RAISE EXCEPTION 'replay duplicated a call';END IF;
 BEGIN
  PERFORM rollover_prepared_signal_interest_decision_batch_v1(
   'f2140000-0000-4000-8000-00000000000e','f2140000-0000-4000-8000-000000000016',
   'f2140000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'daily cap allowed another reservation';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 IF (SELECT state FROM signal_interest_decision_batches_v1
   WHERE id='f2140000-0000-4000-8000-00000000000e')<>'prepared'
  OR (SELECT status FROM signal_interest_decision_calls_v1
   WHERE id='f2140000-0000-4000-8000-000000000010')<>'reserved'
  OR EXISTS(SELECT 1 FROM signal_interest_decision_batches_v1
   WHERE submission_key='interest-decision-rollover:f2140000-0000-4000-8000-00000000000e')
 THEN RAISE EXCEPTION 'cap rejection left partial rollover';END IF;
END $$;
ROLLBACK;
