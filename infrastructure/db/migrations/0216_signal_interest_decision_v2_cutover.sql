-- LOCAL ONLY. Empty-ledger cutover from V1 provider transport to V2.
-- SQL0211-0215 and their historical V1 receipts are retained. Installation
-- fails when this database contains any V1 interest decision authority or work.
-- No policy, model, admission, call, provider job or assignment is created here.
DO $gate$
DECLARE table_name text;row_count bigint;
BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'signal_interest_decision_owners_v1','signal_interest_decision_request_keys_v1',
  'signal_interest_decision_owner_admissions_v1','signal_interest_decision_pages_v1',
  'signal_interest_decision_requests_v1','signal_interest_decision_request_roots_v1',
  'signal_interest_decision_batches_v1','signal_interest_decision_batch_polls_v1',
  'signal_interest_decision_calls_v1','signal_interest_decision_root_evidence_v1',
  'signal_interest_decision_platform_benchmarks_v1',
  'signal_interest_decision_prepublication_evaluations_v1',
  'signal_interest_decision_model_bootstrap_keys_v1'] LOOP
  EXECUTE format('SELECT count(*) FROM %I',table_name) INTO row_count;
  IF row_count<>0 THEN RAISE EXCEPTION 'interest_decision_v2_cutover_nonempty: %',table_name USING ERRCODE='23514';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM signal_processing_admissions WHERE action='interest_decision')
  OR EXISTS(SELECT 1 FROM tagging_model_versions WHERE artifact_digest=signal_interest_decision_model_digest_v1())
 THEN RAISE EXCEPTION 'interest_decision_v2_cutover_historical_authority' USING ERRCODE='23514';END IF;
END $gate$;

CREATE OR REPLACE FUNCTION validate_signal_interest_decision_platform_benchmark_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE t jsonb:=NEW.thresholds;sample_count integer:=NEW.positive_count+NEW.negative_count;
 precision_value numeric;recall_value numeric;specificity numeric;mixed_accuracy numeric;
BEGIN
 IF NEW.model_artifact_digest IS DISTINCT FROM signal_interest_decision_model_digest_v2()
  OR NEW.provider_config_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2())
  OR NEW.prompt_digest IS DISTINCT FROM signal_interest_decision_provider_config_v2()->>'prompt_digest'
  OR NEW.thresholds_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(t)
  OR NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.approved_by_user_id
   AND actor.status='active' AND actor.user_type='noisia_internal')
  OR t->>'contract_version' IS DISTINCT FROM 'signal-interest-decision-platform-quality-v1'
  OR NOT (t ?& ARRAY['min_samples','min_positive','min_negative','min_mixed',
   'min_precision_bps','min_recall_bps','min_specificity_bps','min_mixed_accuracy_bps','max_insufficient_rate_bps'])
  OR EXISTS(SELECT 1 FROM jsonb_each(t) entry WHERE entry.key=ANY(ARRAY[
   'min_samples','min_positive','min_negative','min_mixed','min_precision_bps',
   'min_recall_bps','min_specificity_bps','min_mixed_accuracy_bps','max_insufficient_rate_bps'])
   AND jsonb_typeof(entry.value)<>'number')
 THEN RAISE EXCEPTION 'interest_decision_platform_benchmark_invalid' USING ERRCODE='23514';END IF;
 precision_value:=CASE WHEN NEW.true_positive+NEW.false_positive=0 THEN NULL
  ELSE NEW.true_positive::numeric/(NEW.true_positive+NEW.false_positive) END;
 recall_value:=NEW.true_positive::numeric/NEW.positive_count;
 specificity:=NEW.true_negative::numeric/NEW.negative_count;
 mixed_accuracy:=NEW.mixed_correct::numeric/NEW.mixed_count;
 IF (t->>'min_samples')::integer<1 OR (t->>'min_positive')::integer<1
  OR (t->>'min_negative')::integer<1 OR (t->>'min_mixed')::integer<1
  OR (t->>'min_precision_bps')::integer NOT BETWEEN 0 AND 10000
  OR (t->>'min_recall_bps')::integer NOT BETWEEN 0 AND 10000
  OR (t->>'min_specificity_bps')::integer NOT BETWEEN 0 AND 10000
  OR (t->>'min_mixed_accuracy_bps')::integer NOT BETWEEN 0 AND 10000
  OR (t->>'max_insufficient_rate_bps')::integer NOT BETWEEN 0 AND 10000
  OR sample_count<(t->>'min_samples')::integer
  OR NEW.positive_count<(t->>'min_positive')::integer
  OR NEW.negative_count<(t->>'min_negative')::integer
  OR NEW.mixed_count<(t->>'min_mixed')::integer
  OR precision_value IS NULL OR precision_value*10000<(t->>'min_precision_bps')::integer
  OR recall_value*10000<(t->>'min_recall_bps')::integer
  OR specificity*10000<(t->>'min_specificity_bps')::integer
  OR mixed_accuracy*10000<(t->>'min_mixed_accuracy_bps')::integer
  OR (NEW.positive_insufficient+NEW.negative_insufficient)::numeric/sample_count
   *10000>(t->>'max_insufficient_rate_bps')::integer
 THEN RAISE EXCEPTION 'interest_decision_platform_benchmark_failed' USING ERRCODE='23514';END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'interest_decision_platform_benchmark_invalid' USING ERRCODE='23514';
END $$;

CREATE OR REPLACE FUNCTION validate_signal_interest_decision_prepublication_evaluation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE m tagging_model_versions%ROWTYPE;b signal_interest_decision_platform_benchmarks_v1%ROWTYPE;
 identity jsonb; expected_request text;
BEGIN
 NEW.created_at:=clock_timestamp();
 SELECT * INTO m FROM tagging_model_versions WHERE id=NEW.model_version_id;
 SELECT * INTO b FROM signal_interest_decision_platform_benchmarks_v1 WHERE id=NEW.benchmark_id;
 identity:=m.configuration->'workspace_classification_identity';
 expected_request:=signal_semantic_context_digest_json_v2(jsonb_build_object(
  'workspace_id',NEW.workspace_id,'taxonomy_profile_id',NEW.taxonomy_profile_id,
  'model_version_id',NEW.model_version_id,'benchmark_id',NEW.benchmark_id,
  'actor_user_id',NEW.actor_user_id,'interest_term_key',NEW.interest_term_key,
  'identity_digest',NEW.identity_digest));
 IF m.id IS NULL OR b.id IS NULL OR m.registry_contract_version<>'signal-tagging-model-registry-v1'
  OR m.taxonomy_profile_id IS DISTINCT FROM NEW.taxonomy_profile_id
  OR NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile
   WHERE profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=NEW.workspace_id
    AND profile.status='active')
  OR m.registered_by_user_id IS DISTINCT FROM NEW.actor_user_id
  OR NOT (signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id)
   OR signal_processing_actor_v1(NEW.workspace_id,NEW.actor_user_id))
  OR m.provider<>'anthropic' OR m.artifact_digest IS DISTINCT FROM signal_interest_decision_model_digest_v2()
  OR m.configuration IS DISTINCT FROM jsonb_build_object('provider_config',signal_interest_decision_provider_config_v2(),
   'workspace_classification_identity',identity,'platform_benchmark_id',b.id,
   'interest_term_key',NEW.interest_term_key)
  OR m.configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(m.configuration)
  OR jsonb_typeof(identity)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(identity))<>10
  OR NOT (identity ?& ARRAY['contract_version','workspace_id','engine_key','engine_version',
   'engine_artifact_digest','embedding_config_digest','catalog_digest','compiler_digest',
   'context_digest','decision_policy_digest'])
  OR identity->>'contract_version'<>'signal-workspace-classification-v1'
  OR identity->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
  OR identity->>'engine_key'<>'interest_decision' OR identity->'engine_version'<>'2'::jsonb
  OR identity->>'engine_artifact_digest' IS DISTINCT FROM m.artifact_digest
  OR EXISTS(SELECT 1 FROM jsonb_each_text(identity) field
   WHERE field.key IN('embedding_config_digest','catalog_digest','compiler_digest',
    'context_digest','decision_policy_digest') AND field.value!~'^sha256:[a-f0-9]{64}$')
  OR NEW.identity_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(identity)
  OR b.model_artifact_digest IS DISTINCT FROM m.artifact_digest
  OR b.provider_config_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2())
  OR b.prompt_digest IS DISTINCT FROM signal_interest_decision_provider_config_v2()->>'prompt_digest'
  OR b.dataset_digest IS DISTINCT FROM m.dataset_digest OR b.labels_digest IS DISTINCT FROM m.gold_set_digest
  OR b.approved_at>clock_timestamp()
  OR NEW.evaluation_evidence_digest IS DISTINCT FROM b.evaluation_evidence_digest
  OR NEW.thresholds_digest IS DISTINCT FROM b.thresholds_digest
  OR NEW.request_digest IS DISTINCT FROM expected_request
  OR NEW.receipt_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object(
   'contract_version','signal-interest-decision-prepublication-evaluation-v1',
   'request_digest',expected_request,'evaluation_evidence_digest',b.evaluation_evidence_digest,
   'thresholds_digest',b.thresholds_digest))
  OR NOT EXISTS(SELECT 1 FROM signal_tagging_model_version_events event
   WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=m.id AND event.status='draft')
  OR EXISTS(SELECT 1 FROM signal_tagging_model_version_events event
   WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=m.id AND event.status<>'draft')
 THEN RAISE EXCEPTION 'interest_decision_prepublication_authority_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_signal_tagging_model_version_event_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior_status text;prior_effective_at timestamptz;
BEGIN
 SELECT event.status,event.effective_at INTO prior_status,prior_effective_at
 FROM signal_tagging_model_version_events event
 WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=NEW.model_version_id
 ORDER BY event.created_at DESC,event.id DESC LIMIT 1;
 IF NOT EXISTS(SELECT 1 FROM tagging_model_versions model
  WHERE model.id=NEW.model_version_id AND model.registry_contract_version='signal-tagging-model-registry-v1'
   AND model.taxonomy_profile_id IN(SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=NEW.workspace_id))
  OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
   WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
    AND operation.actor_user_id=NEW.actor_user_id
    AND operation.operation_kind IN('register-model','transition-model'))
  OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
  OR (prior_status IS NULL AND NEW.status<>'draft')
  OR (prior_status='draft' AND NEW.status<>'evaluated')
  OR (prior_status='evaluated' AND NEW.status NOT IN('approved','retired'))
  OR (prior_status='approved' AND NEW.status<>'retired') OR prior_status='retired'
  OR (prior_effective_at IS NOT NULL AND NEW.effective_at<prior_effective_at)
  OR (NEW.status='evaluated' AND (NEW.evaluation_id IS NULL)=(NEW.prepublication_receipt_id IS NULL))
  OR (NEW.status='draft' AND (NEW.evaluation_id IS NOT NULL OR NEW.prepublication_receipt_id IS NOT NULL))
  OR (NEW.status<>'evaluated' AND NEW.prepublication_receipt_id IS NOT NULL)
  OR (NEW.status='evaluated' AND NEW.evaluation_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM signal_classification_evaluations evaluation
   WHERE evaluation.id=NEW.evaluation_id AND evaluation.workspace_id=NEW.workspace_id
    AND evaluation.evaluated_model_version_id=NEW.model_version_id))
  OR (NEW.status='evaluated' AND NEW.prepublication_receipt_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM signal_interest_decision_prepublication_evaluations_v1 receipt
   JOIN tagging_model_versions model ON model.id=receipt.model_version_id
   WHERE receipt.id=NEW.prepublication_receipt_id AND receipt.workspace_id=NEW.workspace_id
    AND receipt.model_version_id=NEW.model_version_id
    AND model.artifact_digest=signal_interest_decision_model_digest_v2()
    AND receipt.receipt_digest=NEW.evidence_digest AND receipt.created_at<=NEW.effective_at))
 THEN RAISE EXCEPTION 'Tagging model lifecycle transition is invalid.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_interest_decision_model_id_v1(target_model uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM tagging_model_versions model WHERE model.id=target_model
  AND model.artifact_digest=signal_interest_decision_model_digest_v2())
$$;

CREATE OR REPLACE FUNCTION validate_signal_interest_decision_evaluation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE g signal_classification_generations%ROWTYPE;o signal_interest_decision_owners_v1%ROWTYPE;
 model tagging_model_versions%ROWTYPE;benchmark signal_interest_decision_platform_benchmarks_v1%ROWTYPE;
 receipt_digest text;
BEGIN
 SELECT * INTO g FROM signal_classification_generations WHERE id=NEW.generation_id;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE generation_id=g.id;
 SELECT * INTO model FROM tagging_model_versions WHERE id=NEW.evaluated_model_version_id;
 SELECT * INTO benchmark FROM signal_interest_decision_platform_benchmarks_v1
  WHERE id=(model.configuration->>'platform_benchmark_id')::uuid;
 SELECT signal_semantic_context_digest_v1(o.source_input_digest||':'||
  string_agg(evidence.decision_digest,':' ORDER BY evidence.root_id)) INTO receipt_digest
  FROM signal_interest_decision_root_evidence_v1 evidence WHERE evidence.owner_id=o.id;
 IF g.id IS NULL OR g.status<>'open' OR g.workspace_id IS DISTINCT FROM NEW.workspace_id
  OR g.taxonomy_profile_id IS DISTINCT FROM NEW.taxonomy_profile_id
  OR o.id IS NULL OR o.status<>'completed' OR NOT o.manifest_complete
  OR NOT signal_interest_decision_source_current_v2(g.id,o.source_execution_id)
  OR model.id IS NULL OR model.registry_contract_version<>'signal-tagging-model-registry-v1'
  OR model.provider<>'anthropic' OR model.taxonomy_profile_id IS DISTINCT FROM g.taxonomy_profile_id
  OR model.artifact_digest IS DISTINCT FROM g.input_snapshot->'identity'->>'engine_artifact_digest'
  OR model.configuration->'provider_config' IS DISTINCT FROM signal_interest_decision_provider_config_v2()
  OR model.configuration->'workspace_classification_identity' IS DISTINCT FROM g.input_snapshot->'identity'
  OR model.configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(model.configuration)
  OR model.dataset_digest IS DISTINCT FROM benchmark.dataset_digest
  OR model.gold_set_digest IS DISTINCT FROM benchmark.labels_digest
  OR benchmark.id IS NULL OR benchmark.model_artifact_digest IS DISTINCT FROM model.artifact_digest
  OR benchmark.provider_config_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2())
  OR benchmark.prompt_digest IS DISTINCT FROM signal_interest_decision_provider_config_v2()->>'prompt_digest'
  OR benchmark.approved_at>clock_timestamp()
  OR NEW.gold_set_version_id IS NOT NULL OR NEW.split IS NOT NULL
  OR NEW.evaluated_labeling_function_version_id IS NOT NULL
  OR NEW.denominator IS DISTINCT FROM o.expected_roots
  OR NEW.input_digest IS DISTINCT FROM receipt_digest
  OR NEW.artifact_digest IS DISTINCT FROM benchmark.evaluation_evidence_digest
  OR NEW.policy_digest IS DISTINCT FROM benchmark.thresholds_digest
  OR NEW.precision_score IS NOT NULL OR NEW.recall_score IS NOT NULL OR NEW.f1_score IS NOT NULL
  OR NEW.approved<>0
  OR NEW.pending IS DISTINCT FROM (SELECT count(*) FROM signal_interest_decision_root_evidence_v1
   WHERE owner_id=o.id AND verdict IN('belongs','insufficient'))
  OR NEW.rejected IS DISTINCT FROM (SELECT count(*) FROM signal_interest_decision_root_evidence_v1
   WHERE owner_id=o.id AND verdict='not_belongs')
  OR NEW.abstained<>0 OR NEW.error<>0 OR NEW.resolved<>NEW.denominator OR NEW.coverage<>1
  OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
  OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
   WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
    AND operation.operation_kind='evaluate-classifier' AND operation.status='in_progress'
    AND operation.actor_user_id=NEW.created_by_user_id)
 THEN RAISE EXCEPTION 'interest_decision_evaluation_authority_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION 'interest_decision_evaluation_authority_invalid' USING ERRCODE='23514';
END $$;

CREATE OR REPLACE FUNCTION guard_signal_interest_decision_assignment_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE g signal_classification_generations%ROWTYPE;e signal_interest_decision_root_evidence_v1%ROWTYPE;
 o signal_interest_decision_owners_v1%ROWTYPE;c signal_interest_decision_calls_v1%ROWTYPE;
 model tagging_model_versions%ROWTYPE;policy signal_classification_approval_policies%ROWTYPE;
BEGIN
 SELECT * INTO g FROM signal_classification_generations WHERE id=NEW.generation_id;
 IF g.input_contract<>'workspace-topic-classification-v1'
  OR g.input_snapshot->>'interest_term_key' IS NULL THEN
  IF NEW.interest_decision_evidence_id IS NOT NULL THEN
   RAISE EXCEPTION 'interest_decision_assignment_scope_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NEW.resolution_method='human' THEN
  IF NEW.interest_decision_evidence_id IS NOT NULL THEN
   RAISE EXCEPTION 'interest_decision_human_override_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO e FROM signal_interest_decision_root_evidence_v1 WHERE id=NEW.interest_decision_evidence_id;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=e.owner_id;
 SELECT * INTO c FROM signal_interest_decision_calls_v1 WHERE id=e.call_id;
 SELECT * INTO model FROM tagging_model_versions WHERE id=NEW.model_version_id;
 SELECT * INTO policy FROM signal_classification_approval_policies WHERE id=NEW.approval_policy_id;
 IF e.id IS NULL OR o.id IS NULL OR c.id IS NULL OR o.status<>'completed'
  OR o.generation_id IS DISTINCT FROM g.id OR o.workspace_id IS DISTINCT FROM NEW.workspace_id
  OR e.root_id IS DISTINCT FROM NEW.canonical_root_id
  OR e.taxonomy_term_id IS DISTINCT FROM NEW.taxonomy_term_id
  OR e.term_key IS DISTINCT FROM g.input_snapshot->>'interest_term_key'
  OR e.root_fingerprint IS DISTINCT FROM
    (SELECT root_fingerprint FROM signal_classification_generation_items WHERE id=NEW.generation_item_id)
  OR e.output_digest IS DISTINCT FROM NEW.interest_output_digest
  OR e.decision_digest IS DISTINCT FROM NEW.evidence_digest
  OR c.status<>'settled' OR c.validation_status<>'accepted' OR c.output_digest IS DISTINCT FROM e.output_digest
  OR NEW.membership_basis<>'decision' OR NEW.membership_metadata IS NOT NULL
  OR NEW.resolution_method<>'model'
  OR NEW.disposition IS DISTINCT FROM (CASE e.verdict WHEN 'belongs' THEN 'approved'
    WHEN 'not_belongs' THEN 'rejected' ELSE 'pending' END)
  OR model.id IS NULL OR model.provider IS DISTINCT FROM 'anthropic'
  OR model.artifact_digest IS DISTINCT FROM signal_interest_decision_model_digest_v2()
  OR model.artifact_digest IS DISTINCT FROM g.input_snapshot->'identity'->>'engine_artifact_digest'
  OR model.configuration->'provider_config' IS DISTINCT FROM signal_interest_decision_provider_config_v2()
  OR model.configuration->'workspace_classification_identity' IS DISTINCT FROM g.input_snapshot->'identity'
  OR model.taxonomy_profile_id IS DISTINCT FROM g.taxonomy_profile_id
  OR (SELECT event.status FROM signal_tagging_model_version_events event
     WHERE event.workspace_id=g.workspace_id AND event.model_version_id=model.id
      AND event.effective_at<=now() ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)
     IS DISTINCT FROM 'approved'
  OR (NEW.disposition='approved' AND (policy.id IS NULL OR policy.status<>'approved'
   OR policy.workspace_id IS DISTINCT FROM g.workspace_id
   OR policy.taxonomy_profile_id IS DISTINCT FROM g.taxonomy_profile_id
   OR policy.authority_kind<>'model' OR policy.model_version_id IS DISTINCT FROM model.id
   OR policy.definition_hash IS DISTINCT FROM g.input_snapshot->'identity'->>'decision_policy_digest'
   OR policy.effective_from>now() OR (policy.effective_to IS NOT NULL AND policy.effective_to<=now())))
 THEN RAISE EXCEPTION 'interest_decision_assignment_authority_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_defined_interest_generation_actor_v1(target_workspace uuid,
 target_actor uuid,target_profile uuid,snapshot jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(signal_processing_actor_v1(target_workspace,target_actor)
  AND jsonb_typeof(snapshot->'topics')='array'
  AND CASE WHEN jsonb_typeof(snapshot->'topics')='array'
   THEN jsonb_array_length(snapshot->'topics')=1 ELSE false END
  AND snapshot->'source_projection' IS NULL
  AND snapshot->>'interest_term_key'=snapshot->'topics'->0->'definition'->>'term_key'
  AND COALESCE((snapshot->'topics'->0->'definition'->>'discovery_guidance')::boolean,
   snapshot->'topics'->0->'definition'->>'origin'<>'workspace_discovery')
  AND snapshot->'identity'->>'engine_key'='interest_decision'
  AND snapshot->'identity'->>'engine_version'='2'
  AND snapshot->'identity'->>'engine_artifact_digest'=signal_interest_decision_model_digest_v2()
  AND snapshot->'identity'->>'workspace_id'=target_workspace::text
  AND EXISTS(SELECT 1 FROM tagging_model_versions model
   JOIN signal_interest_decision_platform_benchmarks_v1 benchmark
    ON benchmark.id::text=model.configuration->>'platform_benchmark_id'
   JOIN signal_classification_approval_policies policy
    ON policy.model_version_id=model.id AND policy.workspace_id=target_workspace
     AND policy.taxonomy_profile_id=target_profile
   WHERE model.registry_contract_version='signal-tagging-model-registry-v1'
    AND model.provider='anthropic' AND model.taxonomy_profile_id=target_profile
    AND model.artifact_digest=signal_interest_decision_model_digest_v2()
    AND model.configuration->'provider_config'=signal_interest_decision_provider_config_v2()
    AND model.configuration->'workspace_classification_identity'=snapshot->'identity'
    AND model.configuration_digest=signal_semantic_context_digest_json_v2(model.configuration)
    AND model.dataset_digest=benchmark.dataset_digest
    AND model.gold_set_digest=benchmark.labels_digest
    AND benchmark.model_artifact_digest=model.artifact_digest
    AND benchmark.provider_config_digest=signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2())
    AND benchmark.prompt_digest=signal_interest_decision_provider_config_v2()->>'prompt_digest'
    AND benchmark.approved_at<=clock_timestamp()
    AND policy.authority_kind='model' AND policy.status='approved'
    AND policy.definition_hash=snapshot->'identity'->>'decision_policy_digest'
    AND policy.effective_from<=clock_timestamp()
    AND (policy.effective_to IS NULL OR policy.effective_to>clock_timestamp())
    AND (SELECT event.status FROM signal_tagging_model_version_events event
     WHERE event.workspace_id=target_workspace AND event.model_version_id=model.id
      AND event.effective_at<=clock_timestamp()
     ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved'),false)
$$;

CREATE FUNCTION register_signal_interest_decision_model_v2(target_workspace uuid,
 target_profile uuid,target_term_key text,target_identity jsonb,target_benchmark uuid,
 target_actor uuid,target_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_platform_benchmarks_v1%ROWTYPE;
 cfg jsonb;identity_digest text;registry_key text;provenance_digest text;
 model_id uuid;model_created boolean;receipt_id uuid;receipt_replayed boolean;
 request_digest text;prior_key signal_interest_decision_model_bootstrap_keys_v1%ROWTYPE;
 existing_model tagging_model_versions%ROWTYPE;
 existing_receipt signal_interest_decision_prepublication_evaluations_v1%ROWTYPE;
BEGIN
 IF target_key IS NULL OR target_key!~'^sha256:[a-f0-9]{64}$'
  OR target_term_key IS NULL OR target_term_key!~'^[a-z0-9][a-z0-9._-]{0,119}$'
 THEN RAISE EXCEPTION 'interest_decision_model_registration_invalid' USING ERRCODE='22023';END IF;
 PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor,false);
 IF NOT (signal_workspace_classification_actor_v1(target_workspace,target_actor)
  OR signal_processing_actor_v1(target_workspace,target_actor)) THEN
  RAISE EXCEPTION 'interest_decision_prepublication_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM signal_interest_decision_platform_benchmarks_v1 WHERE id=target_benchmark;
 IF b.id IS NULL OR jsonb_typeof(target_identity)<>'object' THEN
  RAISE EXCEPTION 'interest_decision_model_registration_invalid' USING ERRCODE='23514';END IF;
 identity_digest:=signal_semantic_context_digest_json_v2(target_identity);
 registry_key:='interest_decision:'||substr(signal_semantic_context_digest_json_v2(jsonb_build_object(
  'workspace_id',target_workspace,'taxonomy_profile_id',target_profile,
  'interest_term_key',target_term_key,'identity_digest',identity_digest,
  'benchmark_id',b.id)),8);
 cfg:=jsonb_build_object('provider_config',signal_interest_decision_provider_config_v2(),
  'workspace_classification_identity',target_identity,'platform_benchmark_id',b.id,
  'interest_term_key',target_term_key);
 provenance_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
  'benchmark_id',b.id,'evaluation_evidence_digest',b.evaluation_evidence_digest,
  'thresholds_digest',b.thresholds_digest));
 request_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
  'workspace_id',target_workspace,'taxonomy_profile_id',target_profile,
  'interest_term_key',target_term_key,'identity_digest',identity_digest,
  'benchmark_id',b.id));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'interest-decision-model-bootstrap:'||target_workspace::text||':'||target_actor::text||':'||target_key,0));
 SELECT * INTO prior_key FROM signal_interest_decision_model_bootstrap_keys_v1
  WHERE workspace_id=target_workspace AND actor_user_id=target_actor
   AND idempotency_key=target_key FOR UPDATE;
 IF prior_key.idempotency_key IS NOT NULL THEN
  IF prior_key.request_digest IS DISTINCT FROM request_digest THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('model_version_id',prior_key.model_version_id,
   'prepublication_receipt_id',prior_key.prepublication_receipt_id,
   'registry_key',registry_key,'replayed',true);
 END IF;
 -- Match SQL0087's generic registry lock before looking for an existing row.
 PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace::text||':tagging-model:'||registry_key,0));
 SELECT * INTO existing_model FROM tagging_model_versions model
  WHERE model.model_key=registry_key AND model.version='1' FOR UPDATE;
 IF existing_model.id IS NOT NULL THEN
  SELECT * INTO existing_receipt FROM signal_interest_decision_prepublication_evaluations_v1
   WHERE model_version_id=existing_model.id;
  IF existing_model.registry_contract_version<>'signal-tagging-model-registry-v1'
   OR existing_model.taxonomy_profile_id IS DISTINCT FROM target_profile
   OR existing_model.provider<>'anthropic' OR existing_model.artifact_digest IS DISTINCT FROM signal_interest_decision_model_digest_v2()
   OR existing_model.runtime_kind<>'provider_api' OR existing_model.artifact_format<>'message_batches'
   OR existing_model.configuration IS DISTINCT FROM cfg
   OR existing_model.configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(cfg)
   OR existing_model.dataset_digest IS DISTINCT FROM b.dataset_digest
   OR existing_model.gold_set_digest IS DISTINCT FROM b.labels_digest
   OR existing_model.provenance_digest IS DISTINCT FROM provenance_digest
   OR existing_receipt.id IS NULL OR existing_receipt.workspace_id IS DISTINCT FROM target_workspace
   OR existing_receipt.taxonomy_profile_id IS DISTINCT FROM target_profile
   OR existing_receipt.benchmark_id IS DISTINCT FROM b.id
   OR existing_receipt.interest_term_key IS DISTINCT FROM target_term_key
   OR existing_receipt.identity_digest IS DISTINCT FROM identity_digest
   OR existing_receipt.evaluation_evidence_digest IS DISTINCT FROM b.evaluation_evidence_digest
   OR existing_receipt.thresholds_digest IS DISTINCT FROM b.thresholds_digest
  THEN RAISE EXCEPTION 'interest_decision_model_adoption_conflict' USING ERRCODE='23514';END IF;
  model_id:=existing_model.id;receipt_id:=existing_receipt.id;model_created:=false;receipt_replayed:=true;
 ELSE
  SELECT registered.model_version_id,registered.created INTO model_id,model_created
  FROM register_signal_tagging_model_v1(target_workspace,target_profile,registry_key,'1',
   'anthropic',NULL,signal_interest_decision_model_digest_v2(),'provider_api',
   'message_batches',cfg,signal_semantic_context_digest_json_v2(cfg),
   b.dataset_digest,b.labels_digest,NULL,provenance_digest,NULL,target_actor,
   signal_semantic_context_digest_v1(target_key||':model'),
   signal_semantic_context_digest_json_v2(jsonb_build_object('registry_key',registry_key,
    'configuration',cfg,'benchmark_id',b.id,'actor_user_id',target_actor))) registered;
  SELECT receipt.evaluation_id,receipt.replayed INTO receipt_id,receipt_replayed
  FROM register_signal_interest_decision_prepublication_evaluation_v1(
   target_workspace,model_id,b.id,target_actor,target_term_key,
   signal_semantic_context_digest_v1(target_key||':receipt')) receipt;
 END IF;
 INSERT INTO signal_interest_decision_model_bootstrap_keys_v1(workspace_id,actor_user_id,
  idempotency_key,request_digest,model_version_id,prepublication_receipt_id)
 VALUES(target_workspace,target_actor,target_key,request_digest,model_id,receipt_id);
 RETURN jsonb_build_object('model_version_id',model_id,'prepublication_receipt_id',receipt_id,
  'registry_key',registry_key,'replayed',NOT model_created AND receipt_replayed);
END $$;

CREATE FUNCTION transition_signal_interest_decision_model_evaluated_v2(target_workspace uuid,
 target_model uuid,target_receipt uuid,target_actor uuid,target_key text)
RETURNS TABLE(model_version_id uuid,status text,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
 receipt signal_interest_decision_prepublication_evaluations_v1%ROWTYPE;
 prior_digest text;request_hash text;current_status text;
BEGIN
 IF target_key IS NULL OR target_key!~'^sha256:[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'interest_decision_model_transition_invalid' USING ERRCODE='22023';END IF;
 PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor,false);
 IF NOT (signal_workspace_classification_actor_v1(target_workspace,target_actor)
  OR signal_processing_actor_v1(target_workspace,target_actor)) THEN
  RAISE EXCEPTION 'interest_decision_prepublication_actor_forbidden' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace::text||':tagging-model-transition:'||target_model::text,0));
 SELECT * INTO receipt FROM signal_interest_decision_prepublication_evaluations_v1 source
  WHERE source.id=target_receipt AND source.workspace_id=target_workspace
   AND source.model_version_id=target_model;
 IF receipt.id IS NULL THEN
  RAISE EXCEPTION 'interest_decision_model_transition_invalid' USING ERRCODE='23514';END IF;
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object(
  'workspace_id',target_workspace,'model_version_id',target_model,
  'prepublication_receipt_id',target_receipt,'actor_user_id',target_actor));
 SELECT * INTO operation FROM signal_classification_operations
  WHERE workspace_id=target_workspace AND idempotency_key=target_key FOR UPDATE;
 IF operation.id IS NOT NULL AND (operation.operation_kind<>'transition-model'
  OR operation.actor_user_id<>target_actor OR operation.request_digest<>request_hash) THEN
  RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';END IF;
 IF operation.status='completed' THEN
  model_version_id:=(operation.result->>'model_version_id')::uuid;
  status:=operation.result->>'status';created:=false;RETURN NEXT;RETURN;
 END IF;
 SELECT event.status INTO current_status FROM signal_tagging_model_version_events event
  WHERE event.workspace_id=target_workspace AND event.model_version_id=target_model
  ORDER BY event.created_at DESC,event.id DESC LIMIT 1;
 IF current_status IN('evaluated','approved') THEN
  IF NOT EXISTS(SELECT 1 FROM signal_tagging_model_version_events event
   WHERE event.workspace_id=target_workspace AND event.model_version_id=target_model
    AND event.status='evaluated' AND event.prepublication_receipt_id=target_receipt
    AND event.evidence_digest=receipt.receipt_digest) THEN
   RAISE EXCEPTION 'interest_decision_model_adoption_conflict' USING ERRCODE='23514';END IF;
  model_version_id:=target_model;status:='evaluated';created:=false;RETURN NEXT;RETURN;
 END IF;
 IF current_status IS DISTINCT FROM 'draft' THEN
  RAISE EXCEPTION 'interest_decision_model_transition_invalid' USING ERRCODE='23514';END IF;
 INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
  idempotency_key,request_digest)
 VALUES(target_workspace,target_actor,'transition-model',target_key,request_hash)
 ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
 SELECT * INTO operation FROM signal_classification_operations
  WHERE workspace_id=target_workspace AND idempotency_key=target_key FOR UPDATE;
 IF operation.operation_kind<>'transition-model' OR operation.actor_user_id<>target_actor
  OR operation.request_digest<>request_hash THEN
  RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';END IF;
 IF operation.status='completed' THEN
  model_version_id:=(operation.result->>'model_version_id')::uuid;
  status:=operation.result->>'status';created:=false;RETURN NEXT;RETURN;
 END IF;
 SELECT event.evidence_digest INTO prior_digest FROM signal_tagging_model_version_events event
  WHERE event.workspace_id=target_workspace AND event.model_version_id=target_model
  ORDER BY event.created_at DESC,event.id DESC LIMIT 1;
 INSERT INTO signal_tagging_model_version_events(workspace_id,model_version_id,operation_id,
  event_index,status,evaluation_id,prepublication_receipt_id,actor_user_id,effective_at,evidence_digest)
 VALUES(target_workspace,target_model,operation.id,0,'evaluated',NULL,receipt.id,
  target_actor,clock_timestamp(),receipt.receipt_digest);
 INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
  object_type,object_id,previous_state_digest,next_state_digest,event_digest)
 VALUES(target_workspace,operation.id,0,'model-transitioned','model-version',target_model,
  prior_digest,receipt.receipt_digest,
  'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||receipt.receipt_digest,'UTF8'),'sha256'),'hex'));
 UPDATE signal_classification_operations SET status='completed',completed_at=now(),
  result=jsonb_build_object('model_version_id',target_model,'status','evaluated') WHERE id=operation.id;
 model_version_id:=target_model;status:='evaluated';created:=true;RETURN NEXT;
END $$;

CREATE FUNCTION request_signal_interest_decision_v2(target_workspace uuid,target_actor uuid,
 target_generation uuid,target_source uuid,request_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;g signal_classification_generations%ROWTYPE;
 s signal_topic_catalog_executions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 a signal_processing_policy_actions%ROWTYPE;prior signal_interest_decision_request_keys_v1%ROWTYPE;
 owner_id uuid:=gen_random_uuid();admission_id uuid:=gen_random_uuid();request_hash text;
 day date;deadline timestamptz;result jsonb;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$',false) THEN
  RAISE EXCEPTION 'interest_decision_request_key_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 IF w.id IS NULL THEN RAISE EXCEPTION 'interest_decision_workspace_missing' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor);
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('workspace_id',target_workspace,
  'actor_user_id',target_actor,'generation_id',target_generation,'source_execution_id',target_source));
 SELECT * INTO prior FROM signal_interest_decision_request_keys_v1 WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key FOR UPDATE;
 IF prior.owner_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM request_hash THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 SELECT * INTO g FROM signal_classification_generations WHERE id=target_generation AND workspace_id=target_workspace FOR SHARE;
 SELECT * INTO s FROM signal_topic_catalog_executions WHERE id=target_source AND workspace_id=target_workspace FOR SHARE;
 IF g.id IS NULL OR s.id IS NULL OR NOT signal_interest_decision_source_current_v2(g.id,s.id)
  OR g.denominator<>s.denominator OR g.denominator<1 OR
  EXISTS(SELECT 1 FROM signal_interest_decision_owners_v1 WHERE generation_id=g.id)
 THEN RAISE EXCEPTION 'interest_decision_source_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='interest_decision';
 IF p.id IS NULL OR p.valid_from>clock_timestamp() OR p.valid_until<=clock_timestamp()
  OR a.action IS NULL OR a.configuration IS DISTINCT FROM signal_interest_decision_configuration_v2()
  OR NOT a.automatic_allowed OR a.max_execution_micro_usd<=0
 THEN RAISE EXCEPTION 'interest_decision_policy_required' USING ERRCODE='23514';END IF;
 -- Do not admit a paid owner that can never materialize: the same registered
 -- model and effective policy must already authorize this exact interest
 -- identity. The final assignment trigger rechecks them after provider I/O.
 IF NOT EXISTS(SELECT 1 FROM tagging_model_versions model
  JOIN signal_interest_decision_platform_benchmarks_v1 benchmark
   ON benchmark.id::text=model.configuration->>'platform_benchmark_id'
  JOIN signal_classification_approval_policies approval
   ON approval.model_version_id=model.id AND approval.workspace_id=g.workspace_id
    AND approval.taxonomy_profile_id=g.taxonomy_profile_id
  WHERE model.registry_contract_version='signal-tagging-model-registry-v1'
   AND model.provider='anthropic' AND model.taxonomy_profile_id=g.taxonomy_profile_id
   AND model.artifact_digest=signal_interest_decision_model_digest_v2()
   AND model.configuration->'provider_config'=signal_interest_decision_provider_config_v2()
   AND model.configuration->'workspace_classification_identity'=g.input_snapshot->'identity'
   AND model.configuration_digest=signal_semantic_context_digest_json_v2(model.configuration)
   AND model.dataset_digest=benchmark.dataset_digest AND model.gold_set_digest=benchmark.labels_digest
   AND benchmark.model_artifact_digest=model.artifact_digest
   AND benchmark.provider_config_digest=signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2())
   AND benchmark.prompt_digest=signal_interest_decision_provider_config_v2()->>'prompt_digest'
   AND approval.authority_kind='model' AND approval.status='approved'
   AND approval.definition_hash=g.input_snapshot->'identity'->>'decision_policy_digest'
   AND approval.effective_from<=clock_timestamp()
   AND (approval.effective_to IS NULL OR approval.effective_to>clock_timestamp())
   AND (SELECT event.status FROM signal_tagging_model_version_events event
    WHERE event.workspace_id=g.workspace_id AND event.model_version_id=model.id
     AND event.effective_at<=clock_timestamp()
    ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved')
 THEN RAISE EXCEPTION 'interest_decision_model_authority_required' USING ERRCODE='23514';END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 deadline:=least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 PERFORM signal_processing_lock_v1(w.organization_id,day);
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,
  policy_version_id,action,target_id,idempotency_key,request_digest,provider,model,configuration,
  configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(admission_id,w.organization_id,w.id,w.brand_id,target_actor,p.id,'interest_decision',owner_id,
  request_key,request_hash,a.provider,a.model,a.configuration,a.configuration_digest,
  a.max_execution_micro_usd,day,p.budget_timezone,deadline,true,
  'sha256:'||repeat('0',64));
 INSERT INTO signal_interest_decision_owners_v1(id,workspace_id,organization_id,actor_user_id,
  generation_id,source_execution_id,taxonomy_term_id,term_key,definition_digest,
  source_input_digest,source_input_revision,source_context_digest,processing_admission_id,
  hard_cap_micro_usd,expected_roots,provider_contract_version)
 VALUES(owner_id,w.id,w.organization_id,target_actor,g.id,s.id,
  (g.input_snapshot->'topics'->0->>'taxonomy_term_id')::uuid,g.input_snapshot->>'interest_term_key',
  g.input_snapshot->'topics'->0->'definition'->>'definition_digest',s.input_digest,s.input_revision,
  s.input_snapshot->>'context_digest',admission_id,a.max_execution_micro_usd,g.denominator,2);
 INSERT INTO signal_interest_decision_owner_admissions_v1(owner_id,admission_id,policy_version_id,budget_date)
 VALUES(owner_id,admission_id,p.id,day);
 result:=jsonb_build_object('owner_id',owner_id,'generation_id',g.id,'expected_roots',g.denominator,
  'policy_version_id',p.id,'admission_id',admission_id,'replayed',false);
 INSERT INTO signal_interest_decision_request_keys_v1(workspace_id,actor_user_id,idempotency_key,
  request_digest,owner_id,result) VALUES(w.id,target_actor,request_key,request_hash,owner_id,result);
 RETURN result;
END $$;

CREATE FUNCTION renew_signal_interest_decision_admission_v2(target_owner uuid,target_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;w signal_workspaces%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 prior signal_interest_decision_owner_admissions_v1%ROWTYPE;new_id uuid:=gen_random_uuid();
 day date;request_key text;request_hash text;deadline timestamptz;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 IF o.id IS NULL OR o.provider_contract_version<>2 OR o.actor_user_id IS DISTINCT FROM target_actor OR o.status='completed' THEN
  RAISE EXCEPTION 'interest_decision_owner_invalid' USING ERRCODE='23514';END IF;
 PERFORM signal_processing_lock_actor_v1(o.workspace_id,target_actor);
 IF NOT signal_interest_decision_source_current_v2(o.generation_id,o.source_execution_id) THEN
  RAISE EXCEPTION 'interest_decision_source_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=o.workspace_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=o.organization_id AND status='active';
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='interest_decision';
 IF p.id IS NULL OR p.valid_from>clock_timestamp() OR p.valid_until<=clock_timestamp()
  OR a.action IS NULL OR NOT a.automatic_allowed
  OR a.configuration IS DISTINCT FROM signal_interest_decision_configuration_v2()
  OR a.max_execution_micro_usd<=0 THEN
  RAISE EXCEPTION 'interest_decision_policy_required' USING ERRCODE='23514';END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(o.organization_id,day);
 SELECT * INTO prior FROM signal_interest_decision_owner_admissions_v1
  WHERE owner_id=o.id AND budget_date=day FOR UPDATE;
 IF prior.admission_id IS NOT NULL THEN
  IF prior.policy_version_id IS DISTINCT FROM p.id THEN
   RAISE EXCEPTION 'interest_decision_policy_changed_today' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('admission_id',prior.admission_id,'budget_date',day,'replayed',true);
 END IF;
 request_key:='interest-decision:'||o.id::text||':'||day::text;
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('owner_id',o.id,
  'policy_version_id',p.id,'budget_date',day,'configuration_digest',a.configuration_digest));
 deadline:=least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,
  policy_version_id,action,target_id,idempotency_key,request_digest,provider,model,configuration,
  configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(new_id,o.organization_id,o.workspace_id,w.brand_id,target_actor,p.id,'interest_decision',o.id,
  request_key,request_hash,a.provider,a.model,a.configuration,a.configuration_digest,
  a.max_execution_micro_usd,day,p.budget_timezone,deadline,true,'sha256:'||repeat('0',64));
 INSERT INTO signal_interest_decision_owner_admissions_v1(owner_id,admission_id,policy_version_id,budget_date)
 VALUES(o.id,new_id,p.id,day);
 RETURN jsonb_build_object('admission_id',new_id,'budget_date',day,'replayed',false);
END $$;

CREATE FUNCTION append_signal_interest_decision_page_v2(target_owner uuid,manifest jsonb,
 canonical_manifest_body text,canonical_page_body text,request_bodies jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;g signal_classification_generations%ROWTYPE;
 prior signal_interest_decision_pages_v1%ROWTYPE;page_id uuid:=gen_random_uuid();
 request_item jsonb;body_item jsonb;root jsonb;request_id uuid;ids uuid[];expected uuid[];
 page_root_ids jsonb;request_roots jsonb:='[]'::jsonb;interest jsonb;position integer:=0;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 IF o.id IS NULL OR o.provider_contract_version<>2 THEN RAISE EXCEPTION 'interest_decision_owner_missing' USING ERRCODE='23514';END IF;
 PERFORM signal_processing_lock_actor_v1(o.workspace_id,o.actor_user_id);
 IF NOT signal_interest_decision_source_current_v2(o.generation_id,o.source_execution_id)
  OR o.status<>'open' OR o.manifest_complete THEN
  RAISE EXCEPTION 'interest_decision_source_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO g FROM signal_classification_generations WHERE id=o.generation_id;
 page_root_ids:=manifest->'expected_root_ids';interest:=manifest->'requests'->0->'request'->'interest';
 IF manifest->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-page-manifest-v2'
  OR manifest->'configuration' IS DISTINCT FROM signal_interest_decision_provider_config_v2()
  OR manifest-'manifest_digest' IS DISTINCT FROM canonical_manifest_body::jsonb
  OR manifest->>'manifest_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(canonical_manifest_body)
  OR jsonb_typeof(page_root_ids) IS DISTINCT FROM 'array'
  OR jsonb_array_length(page_root_ids) NOT BETWEEN 1 AND 64
  OR jsonb_typeof(manifest->'requests') IS DISTINCT FROM 'array'
  OR jsonb_array_length(manifest->'requests') NOT BETWEEN 1 AND 64
  OR jsonb_array_length(manifest->'requests')<>jsonb_array_length(request_bodies)
  OR o.manifest_roots+jsonb_array_length(page_root_ids)>o.expected_roots
 THEN RAISE EXCEPTION 'interest_decision_page_invalid' USING ERRCODE='23514';END IF;
 SELECT array_agg(canonical_root_id ORDER BY canonical_root_id) INTO expected FROM (
  SELECT canonical_root_id FROM signal_topic_classification_items
  WHERE execution_id=o.source_execution_id AND workspace_id=o.workspace_id
   AND (o.cursor_root_id IS NULL OR canonical_root_id>o.cursor_root_id)
  ORDER BY canonical_root_id LIMIT jsonb_array_length(page_root_ids)) next_roots;
 SELECT array_agg(value::uuid ORDER BY ordinality) INTO ids
  FROM jsonb_array_elements_text(page_root_ids) WITH ORDINALITY;
 IF ids IS DISTINCT FROM expected OR cardinality(ids)<>jsonb_array_length(page_root_ids)
  OR (o.manifest_roots+cardinality(ids)=o.expected_roots AND EXISTS(
   SELECT 1 FROM signal_topic_classification_items item WHERE item.execution_id=o.source_execution_id
    AND item.workspace_id=o.workspace_id AND item.canonical_root_id>ids[array_length(ids,1)]))
 THEN RAISE EXCEPTION 'interest_decision_page_coverage_invalid' USING ERRCODE='23514';END IF;
 FOR request_item IN SELECT value FROM jsonb_array_elements(manifest->'requests') LOOP
  body_item:=request_bodies->position;
  IF NOT signal_interest_decision_request_valid_v2(o.id,request_item,
    body_item->>'request_body',body_item->>'interest_body',
    body_item->>'provider_core_body',body_item->>'provider_body') THEN
   RAISE EXCEPTION 'interest_decision_request_invalid' USING ERRCODE='23514';END IF;
  request_roots:=request_roots||(request_item->'request'->'roots');
  position:=position+1;
 END LOOP;
 IF (SELECT jsonb_agg(r.root_value->>'root_id' ORDER BY r.n)
     FROM jsonb_array_elements(request_roots) WITH ORDINALITY r(root_value,n))
    IS DISTINCT FROM page_root_ids
  OR canonical_page_body::jsonb IS DISTINCT FROM jsonb_build_object(
   'contract_version','signal-workspace-interest-decision-v1','workspace_id',o.workspace_id,
   'context_digest',o.source_context_digest,
   'decision_policy_digest',g.input_snapshot->'identity'->>'decision_policy_digest',
   'interest',interest,'roots',request_roots)
  OR manifest->>'page_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(canonical_page_body)
 THEN RAISE EXCEPTION 'interest_decision_page_digest_invalid' USING ERRCODE='23514';END IF;
 INSERT INTO signal_interest_decision_pages_v1(id,owner_id,page_index,root_count,first_root_id,last_root_id,
  manifest,manifest_body,page_body,manifest_digest)
 VALUES(page_id,o.id,(SELECT count(*) FROM signal_interest_decision_pages_v1 WHERE owner_id=o.id),
  cardinality(ids),ids[1],ids[array_length(ids,1)],manifest,canonical_manifest_body,canonical_page_body,
  manifest->>'manifest_digest');
 position:=0;
 FOR request_item IN SELECT value FROM jsonb_array_elements(manifest->'requests') LOOP
  body_item:=request_bodies->position;request_id:=gen_random_uuid();
  INSERT INTO signal_interest_decision_requests_v1(id,owner_id,page_id,request_index,custom_id,
   request,request_body,request_digest,interest_identity_digest,provider_request,provider_body,provider_request_digest,reserved_micro_usd,provider_contract_version,provider_core_body_v2)
  VALUES(request_id,o.id,page_id,position,request_item->'provider_request'->>'custom_id',
   request_item->'request',body_item->>'request_body',request_item->'request'->>'request_digest',
   signal_semantic_context_digest_v1(body_item->>'interest_body'),
   request_item->'provider_request',body_item->>'provider_body',request_item->>'provider_request_digest',
   (octet_length(body_item->>'provider_body')::bigint*3+32768::bigint*15+1)/2,2,body_item->>'provider_core_body');
  FOR root IN SELECT value FROM jsonb_array_elements(request_item->'request'->'roots') LOOP
   INSERT INTO signal_interest_decision_request_roots_v1(owner_id,request_id,root_id,root_fingerprint,
    asset_sha256,correction_digest,root_body)
   VALUES(o.id,request_id,(root->>'root_id')::uuid,root->>'fingerprint',root->>'asset_sha256',
    root->>'correction_digest',root);
  END LOOP;
  position:=position+1;
 END LOOP;
 UPDATE signal_interest_decision_owners_v1 SET manifest_roots=manifest_roots+cardinality(ids),
  cursor_root_id=ids[array_length(ids,1)],manifest_complete=manifest_roots+cardinality(ids)=expected_roots,
  status=CASE WHEN manifest_roots+cardinality(ids)=expected_roots THEN 'ready' ELSE 'open' END
 WHERE id=o.id;
 RETURN jsonb_build_object('page_id',page_id,'root_count',cardinality(ids),
  'manifest_complete',o.manifest_roots+cardinality(ids)=o.expected_roots);
END $$;

CREATE FUNCTION signal_interest_decision_batch_authority_v2(target_owner uuid,target_admission uuid,
 require_send boolean DEFAULT true) RETURNS void LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=target_admission;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='interest_decision';
 IF o.id IS NULL OR o.provider_contract_version<>2 OR a.id IS NULL OR a.target_id IS DISTINCT FROM o.id OR a.action IS DISTINCT FROM 'interest_decision'
  OR a.organization_id IS DISTINCT FROM o.organization_id OR a.workspace_id IS DISTINCT FROM o.workspace_id
  OR a.actor_user_id IS DISTINCT FROM o.actor_user_id
  OR NOT EXISTS(SELECT 1 FROM signal_interest_decision_owner_admissions_v1 day
    WHERE day.owner_id=o.id AND day.admission_id=a.id AND day.budget_date=a.budget_date)
  OR NOT signal_interest_decision_source_current_v2(o.generation_id,o.source_execution_id)
  OR o.status NOT IN('ready','open') OR p.status IS DISTINCT FROM 'active'
  OR p.valid_from>clock_timestamp() OR p.valid_until<=clock_timestamp()
  OR action_row.action IS NULL OR NOT action_row.automatic_allowed
  OR action_row.configuration IS DISTINCT FROM signal_interest_decision_configuration_v2()
  OR a.configuration IS DISTINCT FROM action_row.configuration
  OR a.configuration_digest IS DISTINCT FROM action_row.configuration_digest
  OR a.admission_not_after<=clock_timestamp()
  OR a.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date
 THEN RAISE EXCEPTION 'interest_decision_batch_authority_invalid' USING ERRCODE='23514';END IF;
 IF require_send THEN PERFORM signal_processing_lock_actor_v1(o.workspace_id,o.actor_user_id);END IF;
END $$;

CREATE FUNCTION prepare_signal_interest_decision_batch_v2(target_owner uuid,target_page uuid,
 request_digests text[],submission_key text) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;page signal_interest_decision_pages_v1%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 prior_batch signal_interest_decision_batches_v1%ROWTYPE;
 batch_id uuid:=gen_random_uuid();request_row signal_interest_decision_requests_v1%ROWTYPE;
 prior_call signal_interest_decision_calls_v1%ROWTYPE;day date;body text;body_sha text;
 request_count integer;spent bigint;org_exposure bigint;batch_amount bigint;
BEGIN
 IF NOT COALESCE(submission_key~'^[A-Za-z0-9._:-]{8,200}$',false)
  OR request_digests IS NULL OR cardinality(request_digests) NOT BETWEEN 1 AND 64
  OR cardinality(request_digests)<>(SELECT count(DISTINCT x) FROM unnest(request_digests) x)
 THEN RAISE EXCEPTION 'interest_decision_batch_request_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=o.processing_admission_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 IF o.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'interest_decision_owner_invalid' USING ERRCODE='23514';END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(o.organization_id,day);
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 SELECT * INTO page FROM signal_interest_decision_pages_v1 WHERE id=target_page AND owner_id=o.id;
 SELECT admission.* INTO a FROM signal_processing_admissions admission JOIN signal_interest_decision_owner_admissions_v1 renewal
  ON renewal.admission_id=admission.id WHERE renewal.owner_id=o.id AND renewal.budget_date=day;
 IF page.id IS NULL OR NOT o.manifest_complete OR o.status<>'ready' OR a.id IS NULL THEN
  RAISE EXCEPTION 'interest_decision_batch_unavailable' USING ERRCODE='23514';END IF;
 PERFORM signal_interest_decision_batch_authority_v2(o.id,a.id,true);
 SELECT count(*),'{"requests":['||string_agg(provider_body,',' ORDER BY request_index)||']}' INTO request_count,body
  FROM signal_interest_decision_requests_v1 WHERE page_id=page.id AND owner_id=o.id
   AND request_digest=ANY(request_digests);
 IF request_count<>cardinality(request_digests) OR octet_length(body)>268435456 THEN
  RAISE EXCEPTION 'interest_decision_batch_coverage_invalid' USING ERRCODE='23514';END IF;
 body_sha:=signal_semantic_context_digest_v1(body);
 SELECT * INTO prior_batch FROM signal_interest_decision_batches_v1
  WHERE owner_id=o.id AND signal_interest_decision_batches_v1.submission_key=prepare_signal_interest_decision_batch_v2.submission_key;
 IF prior_batch.id IS NOT NULL THEN
  IF prior_batch.page_id IS DISTINCT FROM page.id OR prior_batch.manifest_digest IS DISTINCT FROM body_sha
   OR prior_batch.manifest_body IS DISTINCT FROM body THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('batch_id',prior_batch.id,'manifest_digest',body_sha,'replayed',true);
 END IF;
 SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd
    WHEN status='definitely_not_sent' THEN 0
    ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
 INTO spent FROM signal_interest_decision_calls_v1 WHERE owner_id=o.id;
 SELECT COALESCE(sum(reserved_micro_usd),0) INTO batch_amount
  FROM signal_interest_decision_requests_v1 WHERE page_id=page.id AND owner_id=o.id
   AND request_digest=ANY(request_digests);
 SELECT total_micro_usd INTO org_exposure FROM signal_processing_org_exposure_v1(o.organization_id,day,a.budget_timezone);
 IF spent+batch_amount>o.hard_cap_micro_usd
  OR org_exposure+batch_amount>(SELECT daily_cap_micro_usd FROM signal_processing_policy_versions WHERE id=a.policy_version_id)
  OR batch_amount>a.execution_cap_micro_usd
 THEN RAISE EXCEPTION 'interest_decision_cap_exhausted' USING ERRCODE='23514';END IF;
 INSERT INTO signal_interest_decision_batches_v1(id,owner_id,page_id,admission_id,submission_key,manifest_body,manifest_digest)
 VALUES(batch_id,o.id,page.id,a.id,submission_key,body,body_sha);
 FOR request_row IN SELECT * FROM signal_interest_decision_requests_v1
  WHERE page_id=page.id AND owner_id=o.id AND request_digest=ANY(request_digests) ORDER BY request_index LOOP
  SELECT * INTO prior_call FROM signal_interest_decision_calls_v1 WHERE request_id=request_row.id
   ORDER BY attempt_index DESC LIMIT 1;
  IF prior_call.id IS NOT NULL AND (prior_call.status NOT IN('settled','definitely_not_sent')
   OR prior_call.status='settled' AND prior_call.outcome='succeeded'
    AND NOT COALESCE(prior_call.validation_status IN('invalid_output','refusal','max_tokens','invalid_message'),false)
   OR EXISTS(SELECT 1 FROM signal_interest_decision_root_evidence_v1 evidence WHERE evidence.call_id=prior_call.id))
   OR COALESCE(prior_call.attempt_index,0)>=5 THEN
   RAISE EXCEPTION 'interest_decision_request_not_retryable' USING ERRCODE='23514';END IF;
  INSERT INTO signal_interest_decision_calls_v1(owner_id,request_id,batch_id,retry_of_call_id,attempt_index,
   organization_id,reserved_micro_usd,budget_date,budget_timezone)
  VALUES(o.id,request_row.id,batch_id,prior_call.id,COALESCE(prior_call.attempt_index,0)+1,
   o.organization_id,request_row.reserved_micro_usd,day,a.budget_timezone);
 END LOOP;
 RETURN jsonb_build_object('batch_id',batch_id,'manifest_digest',body_sha,'request_count',request_count,
  'reserved_micro_usd',batch_amount,'replayed',false);
END $$;

CREATE FUNCTION mark_submitting_signal_interest_decision_batch_v2(target_batch uuid,target_token uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 owner_org uuid;owner_workspace uuid;locked_workspace uuid;
BEGIN
 -- Revocation of the processing policy takes this organization lock. Governance
 -- changes increment the corpus input revision; SHARE fences that increment.
 -- Take both before the batch lock, then recheck authority with a fresh
 -- READ COMMITTED statement snapshot before recording a possible provider POST.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'processing_capacity_requires_read_committed' USING ERRCODE='25001';END IF;
 SELECT owner.organization_id,owner.workspace_id INTO owner_org,owner_workspace
 FROM signal_interest_decision_batches_v1 batch
 JOIN signal_interest_decision_owners_v1 owner ON owner.id=batch.owner_id
 WHERE batch.id=target_batch;
 IF owner_org IS NULL OR owner_workspace IS NULL THEN
  RAISE EXCEPTION 'interest_decision_batch_unavailable' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'signal-processing-policy:'||owner_org::text,0));
 SELECT state.workspace_id INTO locked_workspace FROM signal_corpus_preparation_input_state state
 WHERE state.workspace_id=owner_workspace FOR SHARE;
 IF locked_workspace IS NULL THEN
  RAISE EXCEPTION 'interest_decision_source_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 IF b.id IS NULL OR NOT EXISTS(SELECT 1 FROM signal_interest_decision_owners_v1 owner
  WHERE owner.id=b.owner_id AND owner.workspace_id=locked_workspace
   AND owner.organization_id=owner_org) THEN
  RAISE EXCEPTION 'interest_decision_batch_unavailable' USING ERRCODE='23514';END IF;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state<>'prepared' OR b.provider_batch_id IS NOT NULL THEN
  RAISE EXCEPTION 'interest_decision_submission_already_attempted' USING ERRCODE='23514';END IF;
 PERFORM signal_interest_decision_batch_authority_v2(b.owner_id,b.admission_id,true);
 SELECT * INTO a FROM signal_processing_admissions WHERE id=b.admission_id;
 IF EXISTS(SELECT 1 FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id AND status<>'reserved')
  OR (SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id)=0
 THEN RAISE EXCEPTION 'interest_decision_batch_call_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_calls_v1 SET status='in_flight',sent_at=clock_timestamp()
  WHERE batch_id=b.id AND status='reserved';
 UPDATE signal_interest_decision_batches_v1 SET state='submitting',submitted_at=clock_timestamp()
  WHERE id=b.id;
 RETURN jsonb_build_object('submission_token',b.submission_token,'manifest_body',b.manifest_body,
  'manifest_digest',b.manifest_digest,'budget_date',a.budget_date);
END $$;

CREATE FUNCTION persist_signal_interest_decision_item_v2(target_batch uuid,target_token uuid,
 target_custom_id text,raw_body text,raw_sha text,storage_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;c signal_interest_decision_calls_v1%ROWTYPE;
 r signal_interest_decision_requests_v1%ROWTYPE;envelope jsonb;usage jsonb;
 input_tokens bigint;output_tokens bigint;cost bigint;parsed_output_text text;usage_valid boolean:=true;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 SELECT * INTO r FROM signal_interest_decision_requests_v1 WHERE custom_id=target_custom_id
  AND page_id=b.page_id AND owner_id=b.owner_id;
 SELECT * INTO c FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id AND request_id=r.id FOR UPDATE;
 IF c.id IS NULL OR r.provider_contract_version<>2 OR r.custom_id!~'^id2_[a-f0-9]{60}$'
  OR b.state NOT IN('ended','applied') OR b.provider_batch_id IS NULL
  OR raw_sha IS DISTINCT FROM signal_semantic_context_digest_v1(raw_body)
  OR octet_length(raw_body)>8388608
  OR NOT COALESCE(storage_key='workspace-engine/'||
    (SELECT workspace_id::text FROM signal_interest_decision_owners_v1 WHERE id=b.owner_id)||'/'||
    b.owner_id::text||'/interest-decision-'||b.id::text||'-'||c.id::text||'.json.'||
    substring(raw_sha from 8)||'.parts.json',false)
  OR length(storage_key)>1024 THEN
  RAISE EXCEPTION 'interest_decision_item_receipt_invalid' USING ERRCODE='23514';END IF;
 IF c.raw_body IS NOT NULL THEN
  IF c.raw_body IS DISTINCT FROM raw_body OR c.raw_sha256 IS DISTINCT FROM raw_sha
   OR c.storage_key IS DISTINCT FROM storage_key THEN
   RAISE EXCEPTION 'interest_decision_item_receipt_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('call_id',c.id,'status',c.status,'replayed',true);
 END IF;
 envelope:=raw_body::jsonb;
 IF envelope->>'custom_id' IS DISTINCT FROM target_custom_id
  OR envelope->'result'->>'type' NOT IN('succeeded','errored','canceled','expired')
  OR c.status NOT IN('in_flight','outcome_unknown') THEN
  RAISE EXCEPTION 'interest_decision_item_binding_invalid' USING ERRCODE='23514';END IF;
 IF envelope->'result'->>'type'='succeeded' THEN
  usage:=envelope->'result'->'message'->'usage';
  BEGIN
   IF envelope->'result'->'message'->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
    OR NOT COALESCE(usage->>'input_tokens'~'^[0-9]+$' AND usage->>'output_tokens'~'^[0-9]+$',false)
    OR COALESCE(usage->>'cache_creation_input_tokens','0')<>'0'
    OR COALESCE(usage->>'cache_read_input_tokens','0')<>'0' THEN
    usage_valid:=false;
   ELSE
    input_tokens:=(usage->>'input_tokens')::bigint;output_tokens:=(usage->>'output_tokens')::bigint;
    IF input_tokens>octet_length(r.provider_body) OR output_tokens>32768 THEN usage_valid:=false;
    ELSE cost:=(input_tokens*3+output_tokens*15+1)/2;END IF;
   END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   usage_valid:=false;
  END;
  IF jsonb_typeof(envelope->'result'->'message'->'content')='array'
   AND jsonb_array_length(envelope->'result'->'message'->'content')=1
   AND envelope->'result'->'message'->'content'->0->>'type'='text' THEN
   parsed_output_text:=envelope->'result'->'message'->'content'->0->>'text';
  END IF;
 ELSE cost:=0;END IF;
 IF cost>c.reserved_micro_usd THEN usage_valid:=false;END IF;
 UPDATE signal_interest_decision_calls_v1 SET status='response_persisted',raw_body=persist_signal_interest_decision_item_v2.raw_body,
  raw_sha256=raw_sha,storage_key=persist_signal_interest_decision_item_v2.storage_key,output_text=parsed_output_text,
  output_digest=CASE WHEN parsed_output_text IS NOT NULL
   THEN signal_semantic_context_digest_v1(parsed_output_text) END,
  observed_micro_usd=CASE WHEN usage_valid THEN cost END,
  outcome=envelope->'result'->>'type',response_at=clock_timestamp(),error_code=NULL WHERE id=c.id;
 IF usage_valid THEN
  UPDATE signal_interest_decision_calls_v1 SET status='settled',settled_micro_usd=cost,
   settled_at=clock_timestamp() WHERE id=c.id;
 ELSE
  UPDATE signal_interest_decision_calls_v1 SET status='outcome_unknown',
   error_code='interest_decision_usage_unresolved' WHERE id=c.id;
 END IF;
 RETURN jsonb_build_object('call_id',c.id,'status',CASE WHEN usage_valid THEN 'settled' ELSE 'outcome_unknown' END,
  'settled_micro_usd',CASE WHEN usage_valid THEN cost END,'replayed',false);
END $$;

CREATE FUNCTION finish_signal_interest_decision_v2(target_owner uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;accepted integer;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 IF o.id IS NULL OR o.provider_contract_version<>2 THEN RAISE EXCEPTION 'interest_decision_owner_missing' USING ERRCODE='23514';END IF;
 IF o.status='completed' THEN RETURN jsonb_build_object('owner_id',o.id,'completed',true,'replayed',true);END IF;
 PERFORM signal_processing_lock_actor_v1(o.workspace_id,o.actor_user_id);
 SELECT count(*) INTO accepted FROM signal_interest_decision_root_evidence_v1 evidence
  JOIN signal_interest_decision_calls_v1 call ON call.id=evidence.call_id AND call.status='settled'
   AND call.validation_status='accepted'
  WHERE evidence.owner_id=o.id;
 IF NOT o.manifest_complete OR accepted<>o.expected_roots
  OR NOT signal_interest_decision_source_current_v2(o.generation_id,o.source_execution_id)
  OR EXISTS(SELECT 1 FROM signal_interest_decision_requests_v1 request
   WHERE request.owner_id=o.id AND NOT EXISTS(SELECT 1 FROM signal_interest_decision_request_roots_v1 root
    JOIN signal_interest_decision_root_evidence_v1 evidence ON evidence.owner_id=root.owner_id
     AND evidence.root_id=root.root_id AND evidence.request_id=request.id
    WHERE root.request_id=request.id))
 THEN RAISE EXCEPTION 'interest_decision_coverage_incomplete' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_owners_v1 SET status='completed',completed_at=clock_timestamp() WHERE id=o.id;
 RETURN jsonb_build_object('owner_id',o.id,'completed',true,'accepted_roots',accepted,'replayed',false);
END $$;

-- Exhaustion is a technical failure, distinct from a model's valid
-- "insufficient" verdict. Report only roots without accepted evidence whose
-- latest immutable attempt cannot be retried under the five-attempt cap.
CREATE FUNCTION signal_interest_decision_status_v2(target_owner uuid,target_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE base jsonb;failed_count integer;
BEGIN
 base:=signal_interest_decision_status_v1(target_owner,target_actor);
 IF NOT EXISTS(SELECT 1 FROM signal_interest_decision_owners_v1
  WHERE id=target_owner AND provider_contract_version=2) THEN
  RAISE EXCEPTION 'interest_decision_status_forbidden' USING ERRCODE='42501';END IF;
 SELECT count(*)::integer INTO failed_count FROM signal_interest_decision_request_roots_v1 root
 JOIN signal_interest_decision_requests_v1 request ON request.id=root.request_id
 JOIN LATERAL (SELECT call.* FROM signal_interest_decision_calls_v1 call
   WHERE call.request_id=request.id ORDER BY call.attempt_index DESC,call.id DESC LIMIT 1) latest ON true
 WHERE request.owner_id=target_owner AND root.owner_id=target_owner
  AND latest.attempt_index>=5
  AND (latest.status='definitely_not_sent' OR latest.status='settled' AND
   (latest.outcome IS DISTINCT FROM 'succeeded' OR
    latest.validation_status IN('invalid_output','refusal','max_tokens','invalid_message')))
  AND NOT EXISTS(SELECT 1 FROM signal_interest_decision_root_evidence_v1 evidence
   WHERE evidence.owner_id=target_owner AND evidence.root_id=root.root_id);
 RETURN base||jsonb_build_object('terminal_failed_roots',failed_count,
  'technical_error_code',CASE WHEN failed_count>0 THEN 'interest_decision_attempts_exhausted'
   ELSE NULL END);
END $$;

CREATE FUNCTION rollover_prepared_signal_interest_decision_batch_v2(
 target_batch uuid,target_token uuid,target_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE scope record;o signal_interest_decision_owners_v1%ROWTYPE;
 b signal_interest_decision_batches_v1%ROWTYPE;old_a signal_processing_admissions%ROWTYPE;
 current_a signal_processing_admissions%ROWTYPE;successor signal_interest_decision_batches_v1%ROWTYPE;
 day date;request_digests text[];call_count integer;rollover_key text;prepared jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'processing_capacity_requires_read_committed' USING ERRCODE='25001';END IF;
 SELECT owner.id owner_id,owner.organization_id,owner.workspace_id,owner.actor_user_id,
  admission.budget_date,admission.budget_timezone INTO scope
 FROM signal_interest_decision_batches_v1 batch
 JOIN signal_interest_decision_owners_v1 owner ON owner.id=batch.owner_id
 JOIN signal_processing_admissions admission ON admission.id=batch.admission_id
 WHERE batch.id=target_batch;
 IF scope.owner_id IS NULL OR scope.actor_user_id IS DISTINCT FROM target_actor THEN
  RAISE EXCEPTION 'interest_decision_rollover_forbidden' USING ERRCODE='42501';END IF;
 day:=(clock_timestamp() AT TIME ZONE scope.budget_timezone)::date;
 rollover_key:='interest-decision-rollover:'||target_batch::text;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'signal-processing-policy:'||scope.organization_id::text,0));
 PERFORM signal_processing_lock_v1(scope.organization_id,day);
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=scope.owner_id FOR UPDATE NOWAIT;
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 SELECT * INTO old_a FROM signal_processing_admissions WHERE id=b.admission_id;
 IF o.id IS NULL OR b.id IS NULL OR b.owner_id IS DISTINCT FROM o.id
  OR o.organization_id IS DISTINCT FROM scope.organization_id
  OR o.workspace_id IS DISTINCT FROM scope.workspace_id
  OR o.actor_user_id IS DISTINCT FROM target_actor
  OR old_a.budget_timezone IS DISTINCT FROM scope.budget_timezone
  OR old_a.budget_date IS DISTINCT FROM scope.budget_date THEN
  RAISE EXCEPTION 'interest_decision_rollover_scope_invalid' USING ERRCODE='23514';END IF;
 IF b.state='expired_unsubmitted' THEN
  SELECT * INTO successor FROM signal_interest_decision_batches_v1
   WHERE owner_id=o.id AND submission_key=rollover_key;
  IF successor.id IS NULL OR successor.page_id IS DISTINCT FROM b.page_id
   OR successor.manifest_body IS DISTINCT FROM b.manifest_body
   OR successor.manifest_digest IS DISTINCT FROM b.manifest_digest THEN
   RAISE EXCEPTION 'interest_decision_rollover_replay_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('batch_id',successor.id,'manifest_digest',successor.manifest_digest,
   'replayed',true,'expired_batch_id',b.id);
 END IF;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state<>'prepared' OR b.provider_batch_id IS NOT NULL
  OR b.provider_receipt_body IS NOT NULL OR b.provider_receipt_sha256 IS NOT NULL
  OR b.submitted_at IS NOT NULL
  OR old_a.budget_date>=day OR old_a.admission_not_after>clock_timestamp()
  OR o.status<>'ready' THEN
  RAISE EXCEPTION 'interest_decision_rollover_not_unsent' USING ERRCODE='23514';END IF;
 SELECT admission.* INTO current_a FROM signal_processing_admissions admission
  JOIN signal_interest_decision_owner_admissions_v1 renewal ON renewal.admission_id=admission.id
  WHERE renewal.owner_id=o.id AND renewal.budget_date=day;
 IF current_a.id IS NULL OR current_a.budget_timezone IS DISTINCT FROM old_a.budget_timezone THEN
  RAISE EXCEPTION 'interest_decision_rollover_admission_required' USING ERRCODE='23514';END IF;
 PERFORM signal_interest_decision_batch_authority_v2(o.id,current_a.id,true);
 SELECT count(*)::integer,array_agg(request.request_digest ORDER BY request.request_index)
  INTO call_count,request_digests
 FROM signal_interest_decision_calls_v1 call
 JOIN signal_interest_decision_requests_v1 request ON request.id=call.request_id
 WHERE call.batch_id=b.id AND call.owner_id=o.id AND request.owner_id=o.id
  AND request.page_id=b.page_id AND call.status='reserved'
  AND call.sent_at IS NULL AND call.raw_body IS NULL AND call.response_at IS NULL;
 IF call_count<1 OR call_count>64 OR call_count<>(SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id)
  OR b.manifest_digest IS DISTINCT FROM signal_semantic_context_digest_v1(b.manifest_body) THEN
  RAISE EXCEPTION 'interest_decision_rollover_call_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_calls_v1 SET status='definitely_not_sent',error_code='budget_day_expired_unsent'
  WHERE batch_id=b.id AND status='reserved';
 UPDATE signal_interest_decision_batches_v1 SET state='expired_unsubmitted',lease_token=NULL,
  lease_expires_at=NULL,next_poll_at=NULL,last_error_code='budget_day_expired_unsent'
  WHERE id=b.id;
 prepared:=prepare_signal_interest_decision_batch_v2(o.id,b.page_id,request_digests,rollover_key);
 SELECT * INTO successor FROM signal_interest_decision_batches_v1 WHERE id=(prepared->>'batch_id')::uuid;
 IF successor.id IS NULL OR successor.owner_id IS DISTINCT FROM o.id
  OR successor.page_id IS DISTINCT FROM b.page_id
  OR successor.admission_id IS DISTINCT FROM current_a.id
  OR successor.manifest_body IS DISTINCT FROM b.manifest_body
  OR successor.manifest_digest IS DISTINCT FROM b.manifest_digest THEN
  RAISE EXCEPTION 'interest_decision_rollover_successor_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('batch_id',successor.id,'manifest_digest',successor.manifest_digest,
  'replayed',false,'expired_batch_id',b.id);
END $$;

-- The service role can invoke only the new V2 mutation boundary. Historical
-- V1 function bodies remain in the schema for forensic migration replay.
DO $grants$ DECLARE signature text;role_name text;BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'register_signal_interest_decision_model_v2(uuid,uuid,text,jsonb,uuid,uuid,text)',
  'transition_signal_interest_decision_model_evaluated_v2(uuid,uuid,uuid,uuid,text)',
  'request_signal_interest_decision_v2(uuid,uuid,uuid,uuid,text)',
  'renew_signal_interest_decision_admission_v2(uuid,uuid)',
  'append_signal_interest_decision_page_v2(uuid,jsonb,text,text,jsonb)',
  'prepare_signal_interest_decision_batch_v2(uuid,uuid,text[],text)',
  'mark_submitting_signal_interest_decision_batch_v2(uuid,uuid)',
  'persist_signal_interest_decision_item_v2(uuid,uuid,text,text,text,text)',
  'finish_signal_interest_decision_v2(uuid)',
  'signal_interest_decision_status_v2(uuid,uuid)',
  'rollover_prepared_signal_interest_decision_batch_v2(uuid,uuid,uuid)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER',signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name);END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',signature);END IF;
 END LOOP;
 -- Studio and Worker read these four sealed authority facts directly before
 -- entering the SECURITY DEFINER mutation boundary. No V2 validator or
 -- parser is exposed to the service role.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  FOREACH signature IN ARRAY ARRAY[
   'signal_interest_decision_configuration_v2()',
   'signal_interest_decision_provider_config_v2()',
   'signal_interest_decision_model_digest_v2()',
   'signal_interest_decision_source_current_v2(uuid,uuid)'] LOOP
   EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER',signature);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',signature);
  END LOOP;
 END IF;
 -- Old worker entrypoints must fail closed after the empty-ledger cutover.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  FOREACH signature IN ARRAY ARRAY[
   'register_signal_interest_decision_model_v1(uuid,uuid,text,jsonb,uuid,uuid,text)',
   'transition_signal_interest_decision_model_evaluated_v1(uuid,uuid,uuid,uuid,text)',
   'request_signal_interest_decision_v1(uuid,uuid,uuid,uuid,text)',
   'renew_signal_interest_decision_admission_v1(uuid,uuid)',
   'append_signal_interest_decision_page_v1(uuid,jsonb,text,text,jsonb)',
   'prepare_signal_interest_decision_batch_v1(uuid,uuid,text[],text)',
   'mark_submitting_signal_interest_decision_batch_v1(uuid,uuid)',
   'persist_signal_interest_decision_item_v1(uuid,uuid,text,text,text,text)',
   'apply_signal_interest_decision_item_v1(uuid)',
   'finish_signal_interest_decision_v1(uuid)',
   'rollover_prepared_signal_interest_decision_batch_v1(uuid,uuid,uuid)'] LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role',signature);
  END LOOP;
 END IF;
END $grants$;
