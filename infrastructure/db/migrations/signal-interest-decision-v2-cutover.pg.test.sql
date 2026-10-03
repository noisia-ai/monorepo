-- SQL0216 V2 model authority on a disposable local PG fixture. Rolls back.
BEGIN;
DO $$
DECLARE signature text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RETURN;END IF;
 FOREACH signature IN ARRAY ARRAY[
  'signal_interest_decision_configuration_v2()',
  'signal_interest_decision_provider_config_v2()',
  'signal_interest_decision_model_digest_v2()',
  'signal_interest_decision_source_current_v2(uuid,uuid)',
  'signal_interest_decision_status_v2(uuid,uuid)'] LOOP
  IF NOT has_function_privilege('service_role',signature,'EXECUTE') THEN
   RAISE EXCEPTION 'service role cannot read V2 authority: %',signature;END IF;
 END LOOP;
 IF has_function_privilege('service_role',
  'request_signal_interest_decision_v1(uuid,uuid,uuid,uuid,text)','EXECUTE')
  OR has_function_privilege('service_role',
   'signal_interest_decision_request_valid_v2(uuid,jsonb,text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'service role can invoke legacy mutation or private V2 parser';END IF;
END $$;
CREATE TEMP TABLE interest_prepublication_test_state (
 model_id uuid,receipt_id uuid,registry_key text,identity jsonb,policy_id uuid
);
SET LOCAL session_replication_role=replica;
INSERT INTO organizations(id,slug,legal_name,status) VALUES
 ('ee100000-0000-4000-8000-000000000001','interest-prepublication-fixture','Interest fixture','active'),
 ('ee100000-0000-4000-8000-000000000002','interest-prepublication-other','Other fixture','active');
INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES
 ('ee100000-0000-4000-8000-000000000003','authority-internal@example.test','noisia_internal','admin','ee100000-0000-4000-8000-000000000001','active'),
 ('ee100000-0000-4000-8000-000000000004','authority-client@example.test','client','client_admin','ee100000-0000-4000-8000-000000000001','active'),
 ('ee100000-0000-4000-8000-000000000005','authority-viewer@example.test','client','client_viewer','ee100000-0000-4000-8000-000000000001','active'),
 ('ee100000-0000-4000-8000-000000000006','authority-other@example.test','client','client_admin','ee100000-0000-4000-8000-000000000002','active');
INSERT INTO brands(id,organization_id,slug,name,display_name,status) VALUES
 ('ee100000-0000-4000-8000-000000000007','ee100000-0000-4000-8000-000000000001',
  'interest-prepublication-fixture','Interest fixture','Interest fixture','active');
INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,status) VALUES
 ('ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000001',
  'ee100000-0000-4000-8000-000000000007','interest-prepublication-fixture','active');
INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES
 ('ee100000-0000-4000-8000-000000000004','ee100000-0000-4000-8000-000000000007','admin'),
 ('ee100000-0000-4000-8000-000000000005','ee100000-0000-4000-8000-000000000007','read');
INSERT INTO taxonomies(id,taxonomy_key,name,status) VALUES
 ('ee100000-0000-4000-8000-000000000009','interest-prepublication','Fixture interests','active');
INSERT INTO tagging_rule_sets(id,rule_set_key,taxonomy_id) VALUES
 ('ee100000-0000-4000-8000-000000000010','interest-prepublication-rule','ee100000-0000-4000-8000-000000000009');
INSERT INTO tagging_model_versions(id,model_key,version,tagging_rule_set_id) VALUES
 ('ee100000-0000-4000-8000-000000000011','interest-prepublication-profile','1','ee100000-0000-4000-8000-000000000010');
INSERT INTO signal_taxonomy_profiles(id,workspace_id,taxonomy_id,kind,version,status,context_hash,
 rule_set_id,model_version_id,approved_by_user_id,approved_at) VALUES
 ('ee100000-0000-4000-8000-000000000012','ee100000-0000-4000-8000-000000000008',
  'ee100000-0000-4000-8000-000000000009','topic',1,'active','sha256:'||repeat('1',64),
  'ee100000-0000-4000-8000-000000000010','ee100000-0000-4000-8000-000000000011',
  'ee100000-0000-4000-8000-000000000003',clock_timestamp());
SET LOCAL session_replication_role=origin;

INSERT INTO signal_interest_decision_platform_benchmarks_v1(version,model_artifact_digest,
 provider_config_digest,prompt_digest,dataset_digest,labels_digest,evaluation_evidence_digest,
 evidence_locator,thresholds,thresholds_digest,positive_count,negative_count,mixed_count,
 true_positive,false_positive,false_negative,true_negative,positive_insufficient,
 negative_insufficient,mixed_correct,approved_by_user_id)
SELECT 1,signal_interest_decision_model_digest_v2(),
 signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2()),
 signal_interest_decision_provider_config_v2()->>'prompt_digest',
 signal_semantic_context_digest_v1('synthetic-independent-dataset'),
 signal_semantic_context_digest_v1('synthetic-human-labels'),
 signal_semantic_context_digest_v1('synthetic-platform-evaluation'),
 'private/synthetic/interest-platform-benchmark.json',quality,
 signal_semantic_context_digest_json_v2(quality),20,20,10,18,0,1,19,1,1,9,
 'ee100000-0000-4000-8000-000000000003'::uuid
FROM (SELECT '{"contract_version":"signal-interest-decision-platform-quality-v1",
 "min_samples":40,"min_positive":20,"min_negative":20,"min_mixed":10,
 "min_precision_bps":9500,"min_recall_bps":8500,"min_specificity_bps":9000,
 "min_mixed_accuracy_bps":8000,"max_insufficient_rate_bps":1000}'::jsonb quality) q;

DO $$
DECLARE identity jsonb;result jsonb;again jsonb;client_result jsonb;b uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_tagging_model_event_evaluation_fk')
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='signal_tagging_model_version_events'
   AND column_name='prepublication_receipt_id') THEN
  RAISE EXCEPTION 'legacy evaluation FK or additive receipt reference missing';END IF;
 SELECT id INTO b FROM signal_interest_decision_platform_benchmarks_v1;
 identity:=jsonb_build_object('contract_version','signal-workspace-classification-v1',
  'workspace_id','ee100000-0000-4000-8000-000000000008','engine_key','interest_decision',
  'engine_version',2,'engine_artifact_digest',signal_interest_decision_model_digest_v2(),
  'embedding_config_digest','sha256:'||repeat('2',64),
  'catalog_digest','sha256:'||repeat('3',64),'compiler_digest','sha256:'||repeat('4',64),
  'context_digest','sha256:'||repeat('5',64),
  'decision_policy_digest',(SELECT thresholds_digest FROM signal_interest_decision_platform_benchmarks_v1 WHERE id=b));
 result:=register_signal_interest_decision_model_v2(
  'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
  'explicit_interest',identity,b,'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('a',64));
 IF result->>'replayed'<>'false' THEN RAISE EXCEPTION 'initial registration replayed';END IF;
 INSERT INTO interest_prepublication_test_state(model_id,receipt_id,registry_key,identity)
 VALUES((result->>'model_version_id')::uuid,(result->>'prepublication_receipt_id')::uuid,
  result->>'registry_key',identity);
 again:=register_signal_interest_decision_model_v2(
  'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
  'explicit_interest',identity,b,'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('a',64));
 IF again->>'replayed'<>'true' OR again->>'model_version_id'<>result->>'model_version_id'
  THEN RAISE EXCEPTION 'registration replay lost identity';END IF;
 BEGIN
  PERFORM register_signal_interest_decision_model_v2(
   'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
   'different_interest',identity,b,'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('a',64));
  RAISE EXCEPTION 'changed interest reused key';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
 BEGIN
  PERFORM register_signal_interest_decision_model_v2(
   'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
   'viewer_interest',identity,b,'ee100000-0000-4000-8000-000000000005','sha256:'||repeat('b',64));
  RAISE EXCEPTION 'viewer registered model';
 EXCEPTION WHEN sqlstate '42501' THEN NULL;END;
 BEGIN
  PERFORM register_signal_interest_decision_model_v2(
   'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
   'other_interest',identity,b,'ee100000-0000-4000-8000-000000000006','sha256:'||repeat('c',64));
  RAISE EXCEPTION 'cross-organization actor registered model';
 EXCEPTION WHEN sqlstate '42501' THEN NULL;END;
 BEGIN
  PERFORM register_signal_interest_decision_model_v2(
   'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
   'invalid_interest',identity||'{"engine_version":3}'::jsonb,b,
   'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('7',64));
  RAISE EXCEPTION 'wrong engine identity registered';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
 client_result:=register_signal_interest_decision_model_v2(
  'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
  'explicit_interest',identity,b,'ee100000-0000-4000-8000-000000000004','sha256:'||repeat('5',64));
 IF client_result->>'replayed'<>'true'
  OR client_result->>'model_version_id'<>result->>'model_version_id'
  OR client_result->>'prepublication_receipt_id'<>result->>'prepublication_receipt_id'
 THEN RAISE EXCEPTION 'second admin failed to adopt partial model';END IF;
 again:=register_signal_interest_decision_model_v2(
  'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
  'explicit_interest',identity,b,'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('4',64));
 IF again->>'model_version_id'<>result->>'model_version_id'
  OR (SELECT count(*) FROM tagging_model_versions WHERE model_key=result->>'registry_key')<>1
 THEN RAISE EXCEPTION 'new request key duplicated model';END IF;
 client_result:=register_signal_interest_decision_model_v2(
  'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
  'client_interest',identity||jsonb_build_object('context_digest','sha256:'||repeat('6',64)),
  b,'ee100000-0000-4000-8000-000000000004','sha256:'||repeat('6',64));
 IF client_result->>'replayed'<>'false' THEN RAISE EXCEPTION 'client admin was not admitted';END IF;
 IF (SELECT count(*) FROM signal_interest_decision_prepublication_evaluations_v1)<>2
  OR (SELECT count(*) FROM signal_interest_decision_owners_v1)<>0
  OR (SELECT count(*) FROM signal_processing_admissions WHERE action='interest_decision')<>0
  OR (SELECT count(*) FROM signal_interest_decision_calls_v1)<>0
 THEN RAISE EXCEPTION 'bootstrap created payment or provider state';END IF;
END $$;

-- Production bootstrap and evaluated transitions are separate transactions.
-- Give synthetic draft events that earlier creation time inside this rollback.
SET LOCAL session_replication_role=replica;
UPDATE signal_tagging_model_version_events SET created_at=now()-interval '2 seconds'
 WHERE status='draft';
SET LOCAL session_replication_role=origin;

DO $$
DECLARE s interest_prepublication_test_state%ROWTYPE;result record;
BEGIN
 SELECT * INTO s FROM interest_prepublication_test_state;
 BEGIN
  PERFORM transition_signal_tagging_model_v1(
   'ee100000-0000-4000-8000-000000000008',s.model_id,'evaluated',s.receipt_id,
   clock_timestamp(),'sha256:'||repeat('c',64),'ee100000-0000-4000-8000-000000000003',
   'sha256:'||repeat('b',64),'sha256:'||repeat('c',64));
  RAISE EXCEPTION 'legacy evaluation FK accepted platform receipt';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
 BEGIN
  PERFORM transition_signal_interest_decision_model_evaluated_v2(
   'ee100000-0000-4000-8000-000000000008',s.model_id,gen_random_uuid(),
   'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('c',64));
  RAISE EXCEPTION 'unmatched platform receipt accepted';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
 SELECT * INTO result FROM transition_signal_interest_decision_model_evaluated_v2(
  'ee100000-0000-4000-8000-000000000008',s.model_id,s.receipt_id,
  'ee100000-0000-4000-8000-000000000004','sha256:'||repeat('d',64));
 IF result.status<>'evaluated' OR NOT result.created THEN RAISE EXCEPTION 'prepublication evaluation did not transition';END IF;
 SELECT * INTO result FROM transition_signal_interest_decision_model_evaluated_v2(
  'ee100000-0000-4000-8000-000000000008',s.model_id,s.receipt_id,
  'ee100000-0000-4000-8000-000000000004','sha256:'||repeat('d',64));
 IF result.created THEN RAISE EXCEPTION 'evaluated transition replay duplicated event';END IF;
 SELECT * INTO result FROM transition_signal_interest_decision_model_evaluated_v2(
  'ee100000-0000-4000-8000-000000000008',s.model_id,s.receipt_id,
  'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('1',64));
 IF result.created THEN RAISE EXCEPTION 'new actor/key duplicated evaluated event';END IF;
 UPDATE user_brand_access SET revoked_at=clock_timestamp()
  WHERE user_id='ee100000-0000-4000-8000-000000000004';
 BEGIN
  PERFORM register_signal_interest_decision_model_v2(
   'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
   'explicit_interest',s.identity,
   (SELECT benchmark_id FROM signal_interest_decision_prepublication_evaluations_v1 WHERE id=s.receipt_id),
   'ee100000-0000-4000-8000-000000000004','sha256:'||repeat('5',64));
  RAISE EXCEPTION 'revoked client replayed adoption';
 EXCEPTION WHEN sqlstate '42501' THEN NULL;END;
 IF NOT EXISTS(SELECT 1 FROM signal_tagging_model_version_events event
  WHERE event.model_version_id=s.model_id AND event.status='evaluated'
   AND event.evaluation_id IS NULL AND event.prepublication_receipt_id=s.receipt_id) THEN
  RAISE EXCEPTION 'prepublication reference did not preserve legacy FK';END IF;
 BEGIN
  UPDATE signal_interest_decision_prepublication_evaluations_v1 SET thresholds_digest='sha256:'||repeat('f',64)
   WHERE id=s.receipt_id;
  RAISE EXCEPTION 'prepublication receipt was mutable';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
END $$;

SET LOCAL session_replication_role=replica;
UPDATE signal_tagging_model_version_events SET created_at=now()-interval '1 second'
 WHERE status='evaluated';
SET LOCAL session_replication_role=origin;

DO $$
DECLARE s interest_prepublication_test_state%ROWTYPE;result record;
BEGIN
 SELECT * INTO s FROM interest_prepublication_test_state;
 SELECT * INTO result FROM transition_signal_tagging_model_v1(
  'ee100000-0000-4000-8000-000000000008',s.model_id,'approved',NULL,
  clock_timestamp(),(SELECT receipt_digest FROM signal_interest_decision_prepublication_evaluations_v1
   WHERE id=s.receipt_id),'ee100000-0000-4000-8000-000000000003',
  'sha256:'||repeat('e',64),'sha256:'||repeat('f',64));
 IF result.status<>'approved' OR NOT result.created THEN RAISE EXCEPTION 'model approval failed';END IF;
 SELECT * INTO result FROM transition_signal_tagging_model_v1(
  'ee100000-0000-4000-8000-000000000008',s.model_id,'approved',NULL,
  clock_timestamp(),(SELECT receipt_digest FROM signal_interest_decision_prepublication_evaluations_v1
   WHERE id=s.receipt_id),'ee100000-0000-4000-8000-000000000003',
  'sha256:'||repeat('e',64),'sha256:'||repeat('f',64));
 IF result.created THEN RAISE EXCEPTION 'approved transition replay duplicated event';END IF;
END $$;

-- Policy guards compare event.effective_at with policy.created_at (transaction
-- timestamp). Recreate the same temporal ordering as separate real requests.
SET LOCAL session_replication_role=replica;
UPDATE signal_tagging_model_version_events
 SET effective_at=CASE status WHEN 'draft' THEN now()-interval '3 seconds'
  WHEN 'evaluated' THEN now()-interval '2 seconds'
  WHEN 'approved' THEN now()-interval '1 second' ELSE effective_at END,
 created_at=CASE status WHEN 'draft' THEN now()-interval '3 seconds'
  WHEN 'evaluated' THEN now()-interval '2 seconds'
  WHEN 'approved' THEN now()-interval '1 second' ELSE created_at END
 WHERE model_version_id IN(SELECT model_id FROM interest_prepublication_test_state);
SET LOCAL session_replication_role=origin;

DO $$
DECLARE s interest_prepublication_test_state%ROWTYPE;result record;adopted jsonb;
BEGIN
 SELECT * INTO s FROM interest_prepublication_test_state;
 SELECT * INTO result FROM register_signal_classification_approval_policy_v1(
  'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
  s.registry_key,1,'model',NULL,s.model_id,NULL,s.identity->>'decision_policy_digest',
  'approved',clock_timestamp(),NULL,NULL,'ee100000-0000-4000-8000-000000000003',
  'sha256:'||repeat('8',64),'sha256:'||repeat('9',64));
 IF NOT result.created THEN RAISE EXCEPTION 'policy approval failed';END IF;
 UPDATE interest_prepublication_test_state SET policy_id=result.approval_policy_id;
 SELECT * INTO result FROM register_signal_classification_approval_policy_v1(
  'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
  s.registry_key,1,'model',NULL,s.model_id,NULL,s.identity->>'decision_policy_digest',
  'approved',clock_timestamp(),NULL,NULL,'ee100000-0000-4000-8000-000000000003',
  'sha256:'||repeat('8',64),'sha256:'||repeat('9',64));
 IF result.created THEN RAISE EXCEPTION 'policy replay duplicated version';END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_classification_approval_policies policy
  JOIN interest_prepublication_test_state state ON policy.id=state.policy_id
  WHERE policy.status='approved' AND policy.model_version_id=state.model_id
   AND policy.definition_hash=state.identity->>'decision_policy_digest') THEN
  RAISE EXCEPTION 'policy and identity mismatch';END IF;
 adopted:=register_signal_interest_decision_model_v2(
  'ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000012',
  'explicit_interest',s.identity,
  (SELECT benchmark_id FROM signal_interest_decision_prepublication_evaluations_v1 WHERE id=s.receipt_id),
  'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('2',64));
 IF adopted->>'model_version_id'<>s.model_id::text
  OR adopted->>'prepublication_receipt_id'<>s.receipt_id::text
 THEN RAISE EXCEPTION 'complete model was not adopted';END IF;
 SELECT * INTO result FROM transition_signal_interest_decision_model_evaluated_v2(
  'ee100000-0000-4000-8000-000000000008',s.model_id,s.receipt_id,
  'ee100000-0000-4000-8000-000000000003','sha256:'||repeat('3',64));
 IF result.created OR result.status<>'evaluated' THEN
  RAISE EXCEPTION 'completed lifecycle replay appended an event';END IF;
 IF (SELECT count(*) FROM signal_classification_evaluations)<>0
  OR (SELECT count(*) FROM signal_interest_decision_owners_v1)<>0
  OR (SELECT count(*) FROM signal_processing_admissions WHERE action='interest_decision')<>0
 THEN RAISE EXCEPTION 'prepublication authority fabricated paid coverage';END IF;
END $$;

-- A non-interest model still takes the historical generic lifecycle path.
SET LOCAL session_replication_role=replica;
INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,
 idempotency_key,request_digest,status) VALUES
 ('ee100000-0000-4000-8000-000000000020','ee100000-0000-4000-8000-000000000008',
 'ee100000-0000-4000-8000-000000000003','register-model',
 signal_semantic_context_digest_v1('other model key'),
 signal_semantic_context_digest_v1('other model request'),'in_progress');
INSERT INTO tagging_model_versions(id,model_key,version,registry_contract_version,provider,
 artifact_digest,taxonomy_profile_id,registered_by_user_id,runtime_kind,artifact_format,
 configuration,configuration_digest,dataset_digest,provenance_digest,registry_operation_id) VALUES
 ('ee100000-0000-4000-8000-000000000021','other-taxonomy-model','1',
 'signal-tagging-model-registry-v1','local',signal_semantic_context_digest_v1('other artifact'),
 'ee100000-0000-4000-8000-000000000012','ee100000-0000-4000-8000-000000000003',
 'local','model-key','{}'::jsonb,signal_semantic_context_digest_json_v2('{}'::jsonb),
 signal_semantic_context_digest_v1('other dataset'),signal_semantic_context_digest_v1('other provenance'),
 'ee100000-0000-4000-8000-000000000020');
SET LOCAL session_replication_role=origin;
INSERT INTO signal_tagging_model_version_events(workspace_id,model_version_id,operation_id,
 event_index,status,actor_user_id,effective_at,evidence_digest) VALUES
 ('ee100000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000021',
 'ee100000-0000-4000-8000-000000000020',0,'draft',
 'ee100000-0000-4000-8000-000000000003',clock_timestamp(),
 signal_semantic_context_digest_v1('other model draft'));
DO $$ BEGIN
 IF (SELECT count(*) FROM signal_tagging_model_version_events
  WHERE model_version_id='ee100000-0000-4000-8000-000000000021' AND status='draft')<>1
 THEN RAISE EXCEPTION 'non-interest model lifecycle changed';END IF;
END $$;

ROLLBACK;
