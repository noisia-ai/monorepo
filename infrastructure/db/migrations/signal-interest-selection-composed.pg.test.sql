-- LOCAL PG17/pgvector only. Run after the full ordered migrations through 0212.
-- Fixture rows are synthetic; historical triggers are disabled only while
-- constructing prior-state prerequisites. Scenario calls run with triggers on.
BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO organizations(id,slug,legal_name,status) VALUES
 ('e2000000-0000-4000-8000-000000000001','interest-composed-a','Interest fixture A','active'),
 ('e2000000-0000-4000-8000-000000000002','interest-composed-b','Interest fixture B','active');
INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES
 ('e2000000-0000-4000-8000-000000000003','interest-a@example.test','noisia_internal','admin','e2000000-0000-4000-8000-000000000001','active'),
 ('e2000000-0000-4000-8000-000000000004','interest-b@example.test','client','client_admin','e2000000-0000-4000-8000-000000000002','active');
INSERT INTO brands(id,organization_id,slug,name,display_name,status) VALUES
 ('e2000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000001','interest-a','Interest A','Interest A','active'),
 ('e2000000-0000-4000-8000-000000000006','e2000000-0000-4000-8000-000000000002','interest-b','Interest B','Interest B','active');
INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,status) VALUES
 ('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000005','interest-a','active'),
 ('e2000000-0000-4000-8000-000000000008','e2000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000006','interest-b','active');
INSERT INTO data_sources(id,source_type,provider,connection_method,name,workspace_id,status)
 VALUES('e2000000-0000-4000-8000-000000000009','upload','client','csv','Fixture import','e2000000-0000-4000-8000-000000000007','active');
INSERT INTO import_batches(id,source_system,status,workspace_id,data_source_id,completed_at)
 VALUES('e2000000-0000-4000-8000-000000000010','fixture','completed','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000009',clock_timestamp());
INSERT INTO mentions(id,external_id,source_system,text_hash,text_clean,text_length,published_at,platform,
 workspace_id,data_source_id,canonical_mention_id,provider_record_id,text_clean_sha256,inclusion_status)
 VALUES('e2000000-0000-4000-8000-000000000011','fixture-root','fixture',repeat('a',64),'Synthetic Alexa activation report',32,
 clock_timestamp(),'synthetic','e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000009',
 'e2000000-0000-4000-8000-000000000011','fixture-root',signal_semantic_context_digest_v1('Synthetic Alexa activation report'),'included');
INSERT INTO mentions(id,external_id,source_system,text_hash,text_clean,text_length,published_at,platform,
 workspace_id,data_source_id,canonical_mention_id,provider_record_id,text_clean_sha256,inclusion_status)
 VALUES('e2000000-0000-4000-8000-000000000038','fixture-negative','fixture',repeat('b',64),
 'Synthetic Alexa did not activate',31,clock_timestamp(),'synthetic',
 'e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000009',
 'e2000000-0000-4000-8000-000000000038','fixture-negative',
 signal_semantic_context_digest_v1('Synthetic Alexa did not activate'),'included');
INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,import_batch_id,data_source_id)
 VALUES('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000011',
 'e2000000-0000-4000-8000-000000000010','e2000000-0000-4000-8000-000000000009'),
 ('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000038',
 'e2000000-0000-4000-8000-000000000010','e2000000-0000-4000-8000-000000000009');
INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
 approval_evidence_hash,definition_hash,created_by_user_id,approved_by_user_id,approved_at,creation_idempotency_key)
 VALUES('e2000000-0000-4000-8000-000000000012','e2000000-0000-4000-8000-000000000001',
 'e2000000-0000-4000-8000-000000000007','fixture-license',1,'active',
 'sha256:'||repeat('a',64),'sha256:'||repeat('b',64),'e2000000-0000-4000-8000-000000000003',
 'e2000000-0000-4000-8000-000000000003',clock_timestamp(),'sha256:'||repeat('c',64));
INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision)
 VALUES('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000012','client-derived-metrics','allowed'),
 ('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000012','client-mention-list','allowed'),
 ('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000012','client-text-or-excerpt','allowed');
INSERT INTO signal_retention_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
 retention_state,retention_mode,expiry_action,approval_evidence_hash,definition_hash,
 created_by_user_id,approved_by_user_id,approved_at,creation_idempotency_key)
 VALUES('e2000000-0000-4000-8000-000000000013','e2000000-0000-4000-8000-000000000001',
 'e2000000-0000-4000-8000-000000000007','fixture-retention',1,'active','allowed','indefinite','block_use',
 'sha256:'||repeat('d',64),'sha256:'||repeat('e',64),'e2000000-0000-4000-8000-000000000003',
 'e2000000-0000-4000-8000-000000000003',clock_timestamp(),'sha256:'||repeat('f',64));
INSERT INTO signal_provenance_policy_bindings(id,workspace_id,data_source_id,binding_version,status,
 quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,
 activated_by_user_id,activated_at,creation_idempotency_key)
 VALUES('e2000000-0000-4000-8000-000000000014','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000009',1,'active','e2000000-0000-4000-8000-000000000015',
 'e2000000-0000-4000-8000-000000000013','e2000000-0000-4000-8000-000000000012',
 'sha256:'||repeat('1',64),'e2000000-0000-4000-8000-000000000003',
 'e2000000-0000-4000-8000-000000000003',clock_timestamp(),'sha256:'||repeat('2',64));
SET LOCAL session_replication_role=origin;
DO $$ BEGIN
 IF (SELECT count(*) FROM signal_mention_import_memberships path JOIN import_batches batch ON batch.id=path.import_batch_id
  WHERE path.workspace_id='e2000000-0000-4000-8000-000000000007' AND batch.status='completed')<>2
  OR EXISTS(SELECT 1 FROM signal_classification_generations WHERE workspace_id='e2000000-0000-4000-8000-000000000007')
  OR signal_defined_interest_selection_current_v1('e2000000-0000-4000-8000-000000000007','alexa_activation')
 THEN RAISE EXCEPTION 'import-only baseline is not distinct from classification';END IF;
END $$;
SET LOCAL session_replication_role=replica;
INSERT INTO taxonomies(id,taxonomy_key,name,status) VALUES
 ('e2000000-0000-4000-8000-000000000016','fixture-interests','Fixture interests','active');
INSERT INTO taxonomy_terms(id,taxonomy_id,term_key,label,status,metadata) VALUES
 ('e2000000-0000-4000-8000-000000000017','e2000000-0000-4000-8000-000000000016',
 'alexa_activation','Alexa activation','candidate',jsonb_build_object('topic',jsonb_build_object(
  'definition_digest','sha256:'||repeat('3',64),'definition_revision',1,'lifecycle','active')));
INSERT INTO signal_taxonomy_profiles(id,workspace_id,taxonomy_id,kind,version,status,context_hash,
 rule_set_id,model_version_id,approved_by_user_id,approved_at) VALUES
 ('e2000000-0000-4000-8000-000000000018','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000016','topic',1,'active','sha256:'||repeat('4',64),
 'e2000000-0000-4000-8000-000000000019','e2000000-0000-4000-8000-000000000020',
 'e2000000-0000-4000-8000-000000000003',clock_timestamp());
INSERT INTO signal_corpus_preparation_input_state(workspace_id,input_revision)
 VALUES('e2000000-0000-4000-8000-000000000007',1);
INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,worker_job_id,status,phase,input_revision,completed_at)
 VALUES('e2000000-0000-4000-8000-000000000021','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000003','synthetic-composed-fixture','completed','complete',1,clock_timestamp());
INSERT INTO signal_classification_generations(id,workspace_id,taxonomy_profile_id,generation_key,generation_version,
 status,input_population_digest,identity_catalog_digest,denominator,operation_id,created_by_user_id,definition_digest,
 finalized_digest,finalized_at,input_contract,preparation_run_id,embedding_run_id,input_revision,input_snapshot,input_digest)
 VALUES('e2000000-0000-4000-8000-000000000022','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000018','fixture-interest-generation',1,'ready',
 'sha256:'||repeat('5',64),'sha256:'||repeat('6',64),2,'e2000000-0000-4000-8000-000000000023',
 'e2000000-0000-4000-8000-000000000003','sha256:'||repeat('7',64),
 'sha256:'||repeat('8',64),clock_timestamp(),'workspace-topic-classification-v1',
 'e2000000-0000-4000-8000-000000000021','e2000000-0000-4000-8000-000000000024',1,
 jsonb_build_object('interest_term_key','alexa_activation','context_digest','sha256:'||repeat('9',64),
  'identity',jsonb_build_object('engine_artifact_digest',signal_interest_decision_model_digest_v1(),
   'decision_policy_digest','sha256:'||repeat('a',64)),
  'topics',jsonb_build_array(jsonb_build_object('taxonomy_term_id','e2000000-0000-4000-8000-000000000017',
   'definition',jsonb_build_object('term_key','alexa_activation','definition_digest','sha256:'||repeat('3',64),
    'definition_revision',1)))),
 'sha256:'||repeat('b',64));
INSERT INTO signal_topic_catalog_executions(id,workspace_id,taxonomy_profile_id,actor_user_id,intent,idempotency_key,
 request_digest,status,progress,population_digest,identity_catalog_digest,definition_digest,denominator,generation_id,
 input_contract,embedding_run_id,preparation_run_id,input_revision,embedding_config_digest,input_snapshot,input_digest,
 expected_chunks,processed_roots,processed_chunks)
 VALUES('e2000000-0000-4000-8000-000000000025','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000018','e2000000-0000-4000-8000-000000000003',
 'search','synthetic-classification-catalog','sha256:'||repeat('c',64),'ready',100,
 'sha256:'||repeat('d',64),'sha256:'||repeat('e',64),'sha256:'||repeat('f',64),2,
 'e2000000-0000-4000-8000-000000000022','workspace-topic-classification-v1',
 'e2000000-0000-4000-8000-000000000024','e2000000-0000-4000-8000-000000000021',1,
 'sha256:'||repeat('1',64),'{}'::jsonb,'sha256:'||repeat('2',64),2,2,2);
SET LOCAL session_replication_role=origin;
DO $$ DECLARE result jsonb;payload jsonb;BEGIN
 payload:=jsonb_build_object('term_key','alexa_activation','taxonomy_term_id','e2000000-0000-4000-8000-000000000017',
  'generation_id','e2000000-0000-4000-8000-000000000022','snapshot_id',NULL::uuid,
  'expected_snapshot_digest',NULL::text,'definition_digest','sha256:'||repeat('3',64),
  'definition_revision',1,'selected',true,'expected_selection_revision',0);
 result:=mutate_signal_defined_interest_selection_v1('e2000000-0000-4000-8000-000000000007',
  'e2000000-0000-4000-8000-000000000003','zero-positives-selection',payload);
 IF result->'selection'->>'selected'<>'true' OR NOT signal_defined_interest_selection_current_v1(
   'e2000000-0000-4000-8000-000000000007','alexa_activation')
 THEN RAISE EXCEPTION 'zero-positive explicit selection was not current';END IF;
 result:=mutate_signal_defined_interest_selection_v1('e2000000-0000-4000-8000-000000000007',
  'e2000000-0000-4000-8000-000000000003','zero-positives-selection',payload);
 IF result->>'replayed'<>'true' THEN RAISE EXCEPTION 'selection replay lost';END IF;
 BEGIN
  PERFORM mutate_signal_defined_interest_selection_v1('e2000000-0000-4000-8000-000000000007',
   'e2000000-0000-4000-8000-000000000004','cross-org-selection',payload);
  RAISE EXCEPTION 'cross-organization actor selected interest';
 EXCEPTION WHEN sqlstate '42501' THEN NULL;END;
END $$;
SET LOCAL session_replication_role=replica;
UPDATE signal_corpus_preparation_input_state SET input_revision=2
 WHERE workspace_id='e2000000-0000-4000-8000-000000000007';
SET LOCAL session_replication_role=origin;
DO $$ BEGIN IF signal_defined_interest_selection_current_v1('e2000000-0000-4000-8000-000000000007','alexa_activation')
 THEN RAISE EXCEPTION 'stale input revision remained selected';END IF;END $$;
SET LOCAL session_replication_role=replica;
UPDATE signal_corpus_preparation_input_state SET input_revision=1
 WHERE workspace_id='e2000000-0000-4000-8000-000000000007';
SET LOCAL session_replication_role=origin;
-- The following receipt/model/policy rows model already approved historical
-- authority. They are fixture prerequisites, never a claim that the platform
-- benchmark or a paid provider call happened in this transaction.
SET LOCAL session_replication_role=replica;
INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,
 idempotency_key,request_digest,status) VALUES
 ('e2000000-0000-4000-8000-000000000023','e2000000-0000-4000-8000-000000000007',
  'e2000000-0000-4000-8000-000000000003','append-results','sha256:'||repeat('1',64),
  'sha256:'||repeat('2',64),'in_progress');
INSERT INTO signal_classification_generation_items(id,workspace_id,generation_id,canonical_root_id,
 resolution_state,item_digest,root_fingerprint) VALUES
 ('e2000000-0000-4000-8000-000000000031','e2000000-0000-4000-8000-000000000007',
  'e2000000-0000-4000-8000-000000000022','e2000000-0000-4000-8000-000000000011',
  'approved','sha256:'||repeat('d',64),'sha256:'||repeat('3',64)),
 ('e2000000-0000-4000-8000-000000000039','e2000000-0000-4000-8000-000000000007',
  'e2000000-0000-4000-8000-000000000022','e2000000-0000-4000-8000-000000000038',
  'rejected','sha256:'||repeat('e',64),'sha256:'||repeat('4',64));
INSERT INTO tagging_model_versions(id,model_key,provider,version,registry_contract_version,
 artifact_digest,runtime_kind,artifact_format,configuration,configuration_digest,dataset_digest,
 provenance_digest,taxonomy_profile_id,registry_operation_id,registered_by_user_id)
 SELECT 'e2000000-0000-4000-8000-000000000026','fixture-interest-decision','anthropic','1',
  'signal-tagging-model-registry-v1',signal_interest_decision_model_digest_v1(),'remote','provider-contract',
  jsonb_build_object('provider_config',signal_interest_decision_provider_config_v1(),
   'workspace_classification_identity',input_snapshot->'identity'),
  'sha256:'||repeat('4',64),'sha256:'||repeat('5',64),'sha256:'||repeat('6',64),
  taxonomy_profile_id,'e2000000-0000-4000-8000-000000000023','e2000000-0000-4000-8000-000000000003'
 FROM signal_classification_generations WHERE id='e2000000-0000-4000-8000-000000000022';
INSERT INTO signal_tagging_model_version_events(id,workspace_id,model_version_id,operation_id,
 event_index,status,actor_user_id,effective_at,evidence_digest) VALUES
 ('e2000000-0000-4000-8000-000000000032','e2000000-0000-4000-8000-000000000007',
  'e2000000-0000-4000-8000-000000000026','e2000000-0000-4000-8000-000000000023',0,'approved',
  'e2000000-0000-4000-8000-000000000003',now()-interval '1 day','sha256:'||repeat('7',64));
INSERT INTO signal_classification_approval_policies(id,workspace_id,taxonomy_profile_id,policy_key,
 version,authority_kind,model_version_id,definition_hash,status,effective_from,operation_id,
 created_by_user_id,approved_by_user_id)
 VALUES('e2000000-0000-4000-8000-000000000027','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000018','fixture-model-policy',1,'model',
 'e2000000-0000-4000-8000-000000000026','sha256:'||repeat('a',64),'approved',now()-interval '1 day',
 'e2000000-0000-4000-8000-000000000023','e2000000-0000-4000-8000-000000000003',
 'e2000000-0000-4000-8000-000000000003');
INSERT INTO signal_interest_decision_owners_v1(id,workspace_id,organization_id,actor_user_id,
 generation_id,source_execution_id,taxonomy_term_id,term_key,definition_digest,source_input_digest,
 source_input_revision,source_context_digest,processing_admission_id,hard_cap_micro_usd,expected_roots,
 manifest_roots,manifest_complete,status,completed_at)
 VALUES('e2000000-0000-4000-8000-000000000028','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003',
 'e2000000-0000-4000-8000-000000000022','e2000000-0000-4000-8000-000000000025',
 'e2000000-0000-4000-8000-000000000017','alexa_activation','sha256:'||repeat('3',64),
 'sha256:'||repeat('b',64),1,'sha256:'||repeat('9',64),
 'e2000000-0000-4000-8000-000000000033',1000000,2,2,true,'completed',clock_timestamp());
INSERT INTO signal_interest_decision_pages_v1(id,owner_id,page_index,root_count,first_root_id,last_root_id,
 manifest,manifest_body,page_body,manifest_digest)
 VALUES('e2000000-0000-4000-8000-000000000034','e2000000-0000-4000-8000-000000000028',
 0,2,'e2000000-0000-4000-8000-000000000011','e2000000-0000-4000-8000-000000000038',
 '{}'::jsonb,'{}','{}','sha256:'||repeat('8',64));
INSERT INTO signal_interest_decision_requests_v1(id,owner_id,page_id,request_index,custom_id,request,
 request_body,request_digest,interest_identity_digest,provider_request,provider_body,
 provider_request_digest,reserved_micro_usd)
 VALUES('e2000000-0000-4000-8000-000000000035','e2000000-0000-4000-8000-000000000028',
 'e2000000-0000-4000-8000-000000000034',0,'id1_'||repeat('a',60),'{}'::jsonb,'{}',
 'sha256:'||repeat('9',64),'sha256:'||repeat('a',64),'{}'::jsonb,'{}',
 'sha256:'||repeat('b',64),100);
INSERT INTO signal_interest_decision_request_roots_v1(owner_id,request_id,root_id,root_fingerprint,
 asset_sha256,correction_digest,root_body)
 VALUES('e2000000-0000-4000-8000-000000000028','e2000000-0000-4000-8000-000000000035',
 'e2000000-0000-4000-8000-000000000011','sha256:'||repeat('3',64),
 'sha256:'||repeat('c',64),'sha256:'||repeat('d',64),'{}'::jsonb),
 ('e2000000-0000-4000-8000-000000000028','e2000000-0000-4000-8000-000000000035',
 'e2000000-0000-4000-8000-000000000038','sha256:'||repeat('4',64),
 'sha256:'||repeat('e',64),'sha256:'||repeat('f',64),'{}'::jsonb);
INSERT INTO signal_interest_decision_batches_v1(id,owner_id,page_id,admission_id,submission_key,
 state,manifest_body,manifest_digest)
 VALUES('e2000000-0000-4000-8000-000000000036','e2000000-0000-4000-8000-000000000028',
 'e2000000-0000-4000-8000-000000000034','e2000000-0000-4000-8000-000000000033',
 'fixture-settled-1','applied','{}','sha256:'||repeat('8',64));
INSERT INTO signal_interest_decision_calls_v1(id,owner_id,request_id,batch_id,attempt_index,organization_id,
 status,reserved_micro_usd,observed_micro_usd,settled_micro_usd,budget_date,budget_timezone,
 raw_body,raw_sha256,output_text,output_digest,outcome,validation_status,settled_at)
 VALUES('e2000000-0000-4000-8000-000000000029','e2000000-0000-4000-8000-000000000028',
 'e2000000-0000-4000-8000-000000000035','e2000000-0000-4000-8000-000000000036',1,
 'e2000000-0000-4000-8000-000000000001','settled',100,70,70,current_date,'UTC',
 '{}','sha256:'||repeat('e',64),'{}','sha256:'||repeat('f',64),'succeeded','accepted',clock_timestamp());
INSERT INTO signal_interest_decision_root_evidence_v1(id,owner_id,request_id,call_id,root_id,term_key,
 taxonomy_term_id,root_fingerprint,asset_sha256,verdict,rationale,citations,output_digest,decision_digest)
 VALUES('e2000000-0000-4000-8000-000000000030','e2000000-0000-4000-8000-000000000028',
 'e2000000-0000-4000-8000-000000000035','e2000000-0000-4000-8000-000000000029',
 'e2000000-0000-4000-8000-000000000011','alexa_activation','e2000000-0000-4000-8000-000000000017',
 'sha256:'||repeat('3',64),'sha256:'||repeat('c',64),'belongs','Synthetic positive fixture',
 '[{"quote":"Alexa activation","chunk_index":0,"start":10,"end":26}]'::jsonb,
 'sha256:'||repeat('f',64),'sha256:'||repeat('0',64)),
 ('e2000000-0000-4000-8000-000000000040','e2000000-0000-4000-8000-000000000028',
 'e2000000-0000-4000-8000-000000000035','e2000000-0000-4000-8000-000000000029',
 'e2000000-0000-4000-8000-000000000038','alexa_activation','e2000000-0000-4000-8000-000000000017',
 'sha256:'||repeat('4',64),'sha256:'||repeat('e',64),'not_belongs','Synthetic negative fixture',
 '[{"quote":"did not activate","chunk_index":0,"start":16,"end":32}]'::jsonb,
 'sha256:'||repeat('f',64),'sha256:'||repeat('2',64));
UPDATE signal_classification_generations SET status='open',finalized_digest=NULL,finalized_at=NULL
 WHERE id='e2000000-0000-4000-8000-000000000022';
SET LOCAL session_replication_role=origin;
DO $$ DECLARE a signal_classification_assignments%ROWTYPE;g signal_classification_generations%ROWTYPE;BEGIN
 BEGIN
  INSERT INTO signal_classification_assignments(workspace_id,generation_id,generation_item_id,
   canonical_root_id,taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,model_version_id,
   approval_policy_id,evidence_digest,lineage_digest,operation_id,definition_digest,definition_revision)
  VALUES('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000022',
   'e2000000-0000-4000-8000-000000000031','e2000000-0000-4000-8000-000000000011',
   'e2000000-0000-4000-8000-000000000018','e2000000-0000-4000-8000-000000000017',
   'model','approved','e2000000-0000-4000-8000-000000000026',
   'e2000000-0000-4000-8000-000000000027','sha256:'||repeat('0',64),
   'sha256:'||repeat('1',64),'e2000000-0000-4000-8000-000000000023',
   'sha256:'||repeat('3',64),1);
  RAISE EXCEPTION 'generic writer without receipt reference bypassed authority';
 EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN
  INSERT INTO signal_classification_assignments(workspace_id,generation_id,generation_item_id,
   canonical_root_id,taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,model_version_id,
   approval_policy_id,evidence_digest,lineage_digest,operation_id,definition_digest,definition_revision,
   interest_decision_evidence_id,interest_output_digest)
  VALUES('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000022',
   'e2000000-0000-4000-8000-000000000031','e2000000-0000-4000-8000-000000000011',
   'e2000000-0000-4000-8000-000000000018','e2000000-0000-4000-8000-000000000017',
   'model','approved','e2000000-0000-4000-8000-000000000026',
   'e2000000-0000-4000-8000-000000000027','sha256:'||repeat('0',64),
   'sha256:'||repeat('1',64),'e2000000-0000-4000-8000-000000000023',
   'sha256:'||repeat('3',64),1,'e2000000-0000-4000-8000-000000000030',
   'sha256:'||repeat('e',64));
  RAISE EXCEPTION 'altered output digest bypassed receipt binding';
 EXCEPTION WHEN check_violation THEN NULL;END;
 INSERT INTO signal_classification_assignments(id,workspace_id,generation_id,generation_item_id,
   canonical_root_id,taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,model_version_id,
   approval_policy_id,evidence_digest,lineage_digest,operation_id,definition_digest,definition_revision,
   interest_decision_evidence_id,interest_output_digest)
  VALUES('e2000000-0000-4000-8000-000000000037','e2000000-0000-4000-8000-000000000007',
   'e2000000-0000-4000-8000-000000000022','e2000000-0000-4000-8000-000000000031',
   'e2000000-0000-4000-8000-000000000011','e2000000-0000-4000-8000-000000000018',
   'e2000000-0000-4000-8000-000000000017','model','approved',
   'e2000000-0000-4000-8000-000000000026','e2000000-0000-4000-8000-000000000027',
   'sha256:'||repeat('0',64),'sha256:'||repeat('1',64),
   'e2000000-0000-4000-8000-000000000023','sha256:'||repeat('3',64),1,
   'e2000000-0000-4000-8000-000000000030','sha256:'||repeat('f',64));
 INSERT INTO signal_classification_assignments(id,workspace_id,generation_id,generation_item_id,
   canonical_root_id,taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,model_version_id,
   approval_policy_id,evidence_digest,lineage_digest,operation_id,definition_digest,definition_revision,
   interest_decision_evidence_id,interest_output_digest)
  VALUES('e2000000-0000-4000-8000-000000000041','e2000000-0000-4000-8000-000000000007',
   'e2000000-0000-4000-8000-000000000022','e2000000-0000-4000-8000-000000000039',
   'e2000000-0000-4000-8000-000000000038','e2000000-0000-4000-8000-000000000018',
   'e2000000-0000-4000-8000-000000000017','model','rejected',
   'e2000000-0000-4000-8000-000000000026',NULL,
   'sha256:'||repeat('2',64),'sha256:'||repeat('3',64),
   'e2000000-0000-4000-8000-000000000023','sha256:'||repeat('3',64),1,
   'e2000000-0000-4000-8000-000000000040','sha256:'||repeat('f',64));
 SELECT * INTO a FROM signal_classification_assignments WHERE id='e2000000-0000-4000-8000-000000000037';
 SELECT * INTO g FROM signal_classification_generations WHERE id=a.generation_id;
 IF NOT signal_workspace_classification_assignment_current_v1(a,g) THEN
  RAISE EXCEPTION 'cited positive is not current';END IF;
 SELECT * INTO a FROM signal_classification_assignments WHERE id='e2000000-0000-4000-8000-000000000041';
 IF NOT signal_workspace_classification_assignment_current_v1(a,g) THEN
  RAISE EXCEPTION 'cited rejection is not current';END IF;
END $$;
SET LOCAL session_replication_role=replica;
UPDATE signal_classification_generations SET status='ready',finalized_digest='sha256:'||repeat('8',64),
 finalized_at=clock_timestamp() WHERE id='e2000000-0000-4000-8000-000000000022';
SET LOCAL session_replication_role=origin;
DO $$ BEGIN
 IF NOT signal_defined_interest_selection_current_v1('e2000000-0000-4000-8000-000000000007','alexa_activation')
  THEN RAISE EXCEPTION 'cited positive lost selection currentness';END IF;
 IF signal_defined_interest_selection_current_v1('e2000000-0000-4000-8000-000000000008','alexa_activation')
  THEN RAISE EXCEPTION 'cross-workspace positive leaked';END IF;
END $$;
SET LOCAL session_replication_role=replica;
UPDATE signal_provenance_policy_bindings SET status='retired'
 WHERE id='e2000000-0000-4000-8000-000000000014';
SET LOCAL session_replication_role=origin;
DO $$ BEGIN
 IF signal_defined_interest_selection_current_v1('e2000000-0000-4000-8000-000000000007','alexa_activation')
 THEN RAISE EXCEPTION 'revoked source rights retained selected positive';END IF;
END $$;
SET LOCAL session_replication_role=replica;
UPDATE signal_provenance_policy_bindings SET status='active'
 WHERE id='e2000000-0000-4000-8000-000000000014';
SET LOCAL session_replication_role=origin;
DO $$ BEGIN
 IF NOT signal_defined_interest_selection_current_v1('e2000000-0000-4000-8000-000000000007','alexa_activation')
 THEN RAISE EXCEPTION 'reinstated rights did not restore currentness';END IF;
END $$;
-- Reusing an old assignment in a new generation cannot reuse its paid
-- evidence owner. This test records the known incremental seam explicitly.
SET LOCAL session_replication_role=replica;
INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,
 idempotency_key,request_digest,status) VALUES
 ('e2000000-0000-4000-8000-000000000042','e2000000-0000-4000-8000-000000000007',
  'e2000000-0000-4000-8000-000000000003','append-results','sha256:'||repeat('4',64),
  'sha256:'||repeat('5',64),'in_progress');
INSERT INTO signal_classification_generations(id,workspace_id,taxonomy_profile_id,generation_key,generation_version,
 status,input_population_digest,identity_catalog_digest,denominator,operation_id,created_by_user_id,definition_digest,
 input_contract,preparation_run_id,embedding_run_id,input_revision,input_snapshot,input_digest)
 SELECT 'e2000000-0000-4000-8000-000000000043',workspace_id,taxonomy_profile_id,
 'fixture-interest-next-generation',2,'open',input_population_digest,identity_catalog_digest,denominator,
 'e2000000-0000-4000-8000-000000000042',created_by_user_id,definition_digest,input_contract,
 preparation_run_id,embedding_run_id,input_revision,input_snapshot,input_digest
 FROM signal_classification_generations WHERE id='e2000000-0000-4000-8000-000000000022';
INSERT INTO signal_classification_generation_items(id,workspace_id,generation_id,canonical_root_id,
 resolution_state,item_digest,root_fingerprint,source_generation_item_id)
 VALUES('e2000000-0000-4000-8000-000000000044','e2000000-0000-4000-8000-000000000007',
 'e2000000-0000-4000-8000-000000000043','e2000000-0000-4000-8000-000000000011',
 'approved','sha256:'||repeat('d',64),'sha256:'||repeat('3',64),
 'e2000000-0000-4000-8000-000000000031');
SET LOCAL session_replication_role=origin;
DO $$ BEGIN
 BEGIN
  INSERT INTO signal_classification_assignments(workspace_id,generation_id,generation_item_id,
   canonical_root_id,taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,model_version_id,
   approval_policy_id,evidence_digest,lineage_digest,operation_id,definition_digest,definition_revision,
   source_assignment_id,interest_decision_evidence_id,interest_output_digest)
  VALUES('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000043',
   'e2000000-0000-4000-8000-000000000044','e2000000-0000-4000-8000-000000000011',
   'e2000000-0000-4000-8000-000000000018','e2000000-0000-4000-8000-000000000017',
   'model','approved','e2000000-0000-4000-8000-000000000026',
   'e2000000-0000-4000-8000-000000000027','sha256:'||repeat('0',64),
   'sha256:'||repeat('1',64),'e2000000-0000-4000-8000-000000000042',
   'sha256:'||repeat('3',64),1,'e2000000-0000-4000-8000-000000000037',
   'e2000000-0000-4000-8000-000000000030','sha256:'||repeat('f',64));
  RAISE EXCEPTION 'older-generation receipt was copied across generations';
 EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
ROLLBACK;
