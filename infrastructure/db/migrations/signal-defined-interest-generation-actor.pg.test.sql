-- LOCAL PG17 fixture after ordered migrations through 0213. No provider calls.
-- Synthetic rows are rolled back. Replica mode seeds prerequisites only;
-- the authorization checks below run with normal triggers and functions.
BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO organizations(id,slug,legal_name,status) VALUES
 ('e3000000-0000-4000-8000-000000000001','interest-generation-actor','Interest actor fixture','active');
INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES
 ('e3000000-0000-4000-8000-000000000002','interest-internal@example.test','noisia_internal','admin',
  'e3000000-0000-4000-8000-000000000001','active'),
 ('e3000000-0000-4000-8000-000000000003','interest-client@example.test','client','client_admin',
  'e3000000-0000-4000-8000-000000000001','active');
INSERT INTO brands(id,organization_id,slug,name,display_name,status) VALUES
 ('e3000000-0000-4000-8000-000000000004','e3000000-0000-4000-8000-000000000001',
  'interest-generation-brand','Interest brand','Interest brand','active');
INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,status) VALUES
 ('e3000000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000004','interest-generation-workspace','active');
INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES
 ('e3000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000004','admin');
INSERT INTO signal_interest_decision_platform_benchmarks_v1(id,version,model_artifact_digest,
 provider_config_digest,prompt_digest,dataset_digest,labels_digest,evaluation_evidence_digest,
 evidence_locator,thresholds,thresholds_digest,positive_count,negative_count,mixed_count,
 true_positive,false_positive,false_negative,true_negative,positive_insufficient,
 negative_insufficient,mixed_correct,approved_by_user_id) VALUES
 ('e3000000-0000-4000-8000-000000000006',321,signal_interest_decision_model_digest_v1(),
  signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v1()),
  signal_interest_decision_provider_config_v1()->>'prompt_digest',
  'sha256:'||repeat('1',64),'sha256:'||repeat('2',64),'sha256:'||repeat('3',64),
  'private/platform/synthetic-interest-actor-fixture',
  '{"contract_version":"signal-interest-decision-platform-quality-v1","min_samples":40,"min_positive":20,"min_negative":20,"min_mixed":10,"min_precision_bps":9000,"min_recall_bps":8500,"min_specificity_bps":9000,"min_mixed_accuracy_bps":8000,"max_insufficient_rate_bps":1000}'::jsonb,
  signal_semantic_context_digest_json_v2('{"contract_version":"signal-interest-decision-platform-quality-v1","min_samples":40,"min_positive":20,"min_negative":20,"min_mixed":10,"min_precision_bps":9000,"min_recall_bps":8500,"min_specificity_bps":9000,"min_mixed_accuracy_bps":8000,"max_insufficient_rate_bps":1000}'::jsonb),
  20,20,10,18,0,1,19,1,1,9,'e3000000-0000-4000-8000-000000000002');
WITH identity AS (SELECT jsonb_build_object(
 'contract_version','signal-workspace-classification-v1',
 'workspace_id','e3000000-0000-4000-8000-000000000005',
 'engine_key','interest_decision','engine_version',1,
 'engine_artifact_digest',signal_interest_decision_model_digest_v1(),
 'embedding_config_digest','sha256:'||repeat('4',64),
 'catalog_digest','sha256:'||repeat('5',64),
 'compiler_digest','sha256:'||repeat('6',64),
 'context_digest','sha256:'||repeat('7',64),
 'decision_policy_digest','sha256:'||repeat('8',64)) value),
 configuration AS (SELECT jsonb_build_object(
  'provider_config',signal_interest_decision_provider_config_v1(),
  'workspace_classification_identity',identity.value,
  'platform_benchmark_id','e3000000-0000-4000-8000-000000000006') value FROM identity)
INSERT INTO tagging_model_versions(id,model_key,provider,version,registry_contract_version,
 artifact_digest,runtime_kind,artifact_format,configuration,configuration_digest,dataset_digest,
 gold_set_digest,provenance_digest,taxonomy_profile_id,registry_operation_id,registered_by_user_id)
SELECT 'e3000000-0000-4000-8000-000000000007','synthetic-interest-actor','anthropic','1',
 'signal-tagging-model-registry-v1',signal_interest_decision_model_digest_v1(),
 'remote','provider-contract',configuration.value,
 signal_semantic_context_digest_json_v2(configuration.value),'sha256:'||repeat('1',64),
 'sha256:'||repeat('2',64),'sha256:'||repeat('9',64),
 'e3000000-0000-4000-8000-000000000009','e3000000-0000-4000-8000-000000000010',
 'e3000000-0000-4000-8000-000000000002' FROM configuration;
INSERT INTO signal_tagging_model_version_events(id,workspace_id,model_version_id,operation_id,
 event_index,status,actor_user_id,effective_at,evidence_digest) VALUES
 ('e3000000-0000-4000-8000-000000000011','e3000000-0000-4000-8000-000000000005',
  'e3000000-0000-4000-8000-000000000007','e3000000-0000-4000-8000-000000000010',
  0,'approved','e3000000-0000-4000-8000-000000000002',clock_timestamp()-interval '1 day',
  'sha256:'||repeat('a',64));
INSERT INTO signal_classification_approval_policies(id,workspace_id,taxonomy_profile_id,policy_key,
 version,authority_kind,model_version_id,definition_hash,status,effective_from,operation_id,
 created_by_user_id,approved_by_user_id) VALUES
 ('e3000000-0000-4000-8000-000000000012','e3000000-0000-4000-8000-000000000005',
  'e3000000-0000-4000-8000-000000000009','synthetic-interest-actor',1,'model',
  'e3000000-0000-4000-8000-000000000007','sha256:'||repeat('8',64),
  'approved',clock_timestamp()-interval '1 day','e3000000-0000-4000-8000-000000000010',
  'e3000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002');
SET LOCAL session_replication_role=origin;
DO $$ DECLARE ws uuid:='e3000000-0000-4000-8000-000000000005';
 actor uuid:='e3000000-0000-4000-8000-000000000003';
 profile uuid:='e3000000-0000-4000-8000-000000000009';
 snapshot jsonb;
BEGIN
 SELECT jsonb_build_object('identity',model.configuration->'workspace_classification_identity',
  'interest_term_key','delivery_consent','topics',jsonb_build_array(jsonb_build_object(
   'definition',jsonb_build_object('term_key','delivery_consent','origin','manual',
    'definition_digest','sha256:'||repeat('b',64),'definition_revision',1))))
 INTO snapshot FROM tagging_model_versions model
 WHERE model.id='e3000000-0000-4000-8000-000000000007';
 IF position('signal_defined_interest_generation_actor_v1' in
  pg_get_functiondef('guard_workspace_classification_generation_v1()'::regprocedure))=0
 THEN RAISE EXCEPTION 'generation trigger lost its client interest branch';END IF;
 IF signal_workspace_classification_actor_v1(ws,actor)
  OR NOT signal_defined_interest_generation_actor_v1(ws,actor,profile,snapshot)
 THEN RAISE EXCEPTION 'client interest grant did not remain narrow';END IF;
 IF signal_defined_interest_generation_actor_v1(ws,actor,profile,
   snapshot||'{"interest_term_key":null}'::jsonb)
  OR signal_defined_interest_generation_actor_v1(ws,actor,profile,
   jsonb_set(snapshot,'{identity,engine_key}','"other_engine"'::jsonb))
  OR signal_defined_interest_generation_actor_v1(ws,actor,profile,
   jsonb_set(snapshot,'{identity,decision_policy_digest}',to_jsonb('sha256:'||repeat('c',64))))
  OR signal_defined_interest_generation_actor_v1(ws,actor,gen_random_uuid(),snapshot)
 THEN RAISE EXCEPTION 'client escaped interest identity or policy';END IF;
 UPDATE user_brand_access SET access_level='comment' WHERE user_id=actor;
 IF signal_defined_interest_generation_actor_v1(ws,actor,profile,snapshot)
 THEN RAISE EXCEPTION 'comment grant started interest decision';END IF;
END $$;
ROLLBACK;
