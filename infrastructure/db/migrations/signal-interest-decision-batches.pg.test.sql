-- Run only against an isolated PostgreSQL fixture after ordered migrations.
-- All calls are read-only or fail before mutation; the transaction rolls back.
BEGIN;
DO $$
DECLARE r jsonb;benchmark_id uuid;internal_actor uuid:='e1111111-1111-4111-8111-111111111111';
 quality jsonb:='{"contract_version":"signal-interest-decision-platform-quality-v1","min_samples":40,"min_positive":20,"min_negative":20,"min_mixed":10,"min_precision_bps":9500,"min_recall_bps":8500,"min_specificity_bps":9000,"min_mixed_accuracy_bps":8000,"max_insufficient_rate_bps":1000}'::jsonb;
BEGIN
 IF signal_interest_decision_configuration_v1()->>'model'<>'claude-sonnet-4-6'
  OR (signal_interest_decision_configuration_v1()->>'max_output_tokens')::integer<>128000
  OR (signal_interest_decision_configuration_v1()->>'input_micro_usd_per_million_tokens')::bigint<>1500000
  OR (signal_interest_decision_configuration_v1()->>'output_micro_usd_per_million_tokens')::bigint<>7500000
 THEN RAISE EXCEPTION 'provider price or max output drift';END IF;
 IF to_regclass('signal_interest_decision_org_consents_v1') IS NOT NULL
 THEN RAISE EXCEPTION 'duplicate consent gate';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='uq_signal_interest_decision_live_call_v1'
  AND indexdef LIKE '%WHERE (status <> ALL%')
 THEN RAISE EXCEPTION 'retry lineage lost its live-attempt fence';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='validate_signal_interest_decision_evaluation_v1'
  AND tgrelid='signal_classification_evaluations'::regclass AND NOT tgisinternal)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='validate_signal_classification_evaluation_v1'
   AND tgrelid='signal_classification_evaluations'::regclass AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'interest or legacy evaluation guard missing';END IF;
 INSERT INTO organizations(id,slug,legal_name,status)
 VALUES('e1111111-1111-4111-8111-111111111112','interest-pg-fixture','Interest PG Fixture','active');
 INSERT INTO users(id,email,user_type,primary_role,organization_id,status)
 VALUES(internal_actor,'interest-pg-fixture@example.test','noisia_internal','admin',
  'e1111111-1111-4111-8111-111111111112','active');
 INSERT INTO signal_interest_decision_platform_benchmarks_v1(version,model_artifact_digest,
  provider_config_digest,prompt_digest,dataset_digest,labels_digest,evaluation_evidence_digest,
  evidence_locator,thresholds,thresholds_digest,positive_count,negative_count,mixed_count,
  true_positive,false_positive,false_negative,true_negative,positive_insufficient,
  negative_insufficient,mixed_correct,approved_by_user_id)
 VALUES(1,signal_interest_decision_model_digest_v1(),
  signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v1()),
  signal_interest_decision_provider_config_v1()->>'prompt_digest',
  signal_semantic_context_digest_v1('independent-dataset'),
  signal_semantic_context_digest_v1('human-labels'),
  signal_semantic_context_digest_v1('independent-evaluation-receipt'),
  'private/platform/interest-benchmark-fixture.json',quality,
  signal_semantic_context_digest_json_v2(quality),20,20,10,18,0,1,19,1,1,9,internal_actor)
 RETURNING id INTO benchmark_id;
 BEGIN
  UPDATE signal_interest_decision_platform_benchmarks_v1 SET mixed_correct=10 WHERE id=benchmark_id;
  RAISE EXCEPTION 'benchmark evidence mutated';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
 BEGIN
  INSERT INTO signal_interest_decision_platform_benchmarks_v1(version,model_artifact_digest,
   provider_config_digest,prompt_digest,dataset_digest,labels_digest,evaluation_evidence_digest,
   evidence_locator,thresholds,thresholds_digest,positive_count,negative_count,mixed_count,
   true_positive,false_positive,false_negative,true_negative,positive_insufficient,
   negative_insufficient,mixed_correct,approved_by_user_id)
  VALUES(2,signal_interest_decision_model_digest_v1(),
   signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v1()),
   signal_interest_decision_provider_config_v1()->>'prompt_digest',
   signal_semantic_context_digest_v1('independent-dataset'),
   signal_semantic_context_digest_v1('human-labels'),
   signal_semantic_context_digest_v1('failing-evaluation-receipt'),
   'private/platform/interest-benchmark-fixture-fail.json',
   quality||'{"min_recall_bps":9500}'::jsonb,
   signal_semantic_context_digest_json_v2(quality||'{"min_recall_bps":9500}'::jsonb),
   20,20,10,18,0,1,19,1,1,9,internal_actor);
  RAISE EXCEPTION 'benchmark below policy accepted';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='persist_signal_interest_decision_item_v1(uuid,uuid,text,text,text,text)'::regprocedure
  AND prosecdef)
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='release_signal_interest_decision_batch_v1(uuid,uuid,timestamptz,text)'::regprocedure
   AND prosecdef)
 THEN RAISE EXCEPTION 'worker API is not security definer';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) acl
  WHERE p.oid='persist_signal_interest_decision_item_v1(uuid,uuid,text,text,text,text)'::regprocedure
   AND acl.grantee=0 AND acl.privilege_type='EXECUTE')
 THEN RAISE EXCEPTION 'raw receipt API is public';END IF;
 SELECT claim_signal_interest_decision_batch_v1(NULL,120) INTO r;
 IF r IS NOT NULL THEN RAISE EXCEPTION 'empty queue claimed work';END IF;
 BEGIN
  PERFORM prepare_signal_interest_decision_batch_v1(gen_random_uuid(),gen_random_uuid(),ARRAY[]::text[],'valid_submission');
  RAISE EXCEPTION 'empty request batch accepted';
 EXCEPTION WHEN sqlstate '22023' THEN NULL;END;
 BEGIN
  PERFORM release_signal_interest_decision_batch_v1(gen_random_uuid(),gen_random_uuid(),NULL,NULL);
  RAISE EXCEPTION 'unleased batch released';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
 BEGIN
  PERFORM reject_signal_interest_decision_batch_v1(gen_random_uuid(),gen_random_uuid(),429,'{}',
   signal_semantic_context_digest_v1('{}'));
  RAISE EXCEPTION 'unleased 429 treated as known rejection';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
 BEGIN
  PERFORM finish_signal_interest_decision_v1(gen_random_uuid());
  RAISE EXCEPTION 'missing owner completed';
 EXCEPTION WHEN sqlstate '23514' THEN NULL;END;
END $$;
ROLLBACK;
