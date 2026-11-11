-- Replay an already settled native global receipt after a bounded deterministic V2 disposition.
-- No new admission, capacity, reservation or send; the immutable binding and no-send
-- triggers from 0277 remain in force. Budget-date rollover grants no money authority.
CREATE OR REPLACE FUNCTION guard_mass_labeling_global_receipt_decision_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_catalog_executions%ROWTYPE; call engine_cost_events%ROWTYPE; coverage record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Global receipt decisions are append-only.' USING ERRCODE='55000'; END IF;
 IF NEW.decision->>'contract_version'='workspace-mass-labeling-receipt-recovery-v2' THEN
  IF NEW.decision-ARRAY['contract_version','workspace_id','execution_id','call_id','request_digest','response_sha256','source_groups_digest',
    'singleton_exclusions','english_definition_reconciliations']<>'{}'::jsonb
    OR jsonb_typeof(NEW.decision->'singleton_exclusions') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.decision->'english_definition_reconciliations') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'workspace_engine_global_receipt_decision_invalid' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.decision->'singleton_exclusions')>2
    OR jsonb_array_length(NEW.decision->'english_definition_reconciliations')>1
    OR jsonb_array_length(NEW.decision->'singleton_exclusions')+jsonb_array_length(NEW.decision->'english_definition_reconciliations')=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.decision->'singleton_exclusions') item WHERE
      jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['group_id','topic_key','reason_sha256']<>'{}'::jsonb
      OR NOT COALESCE(length(item->>'group_id') BETWEEN 1 AND 200 AND length(item->>'topic_key') BETWEEN 1 AND 200
        AND item->>'reason_sha256'~'^sha256:[0-9a-f]{64}$',false))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.decision->'english_definition_reconciliations') item WHERE
      jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['topic_key','original_definition_sha256','english_definition_sha256']<>'{}'::jsonb
      OR NOT COALESCE(length(item->>'topic_key') BETWEEN 1 AND 200
        AND item->>'original_definition_sha256'~'^sha256:[0-9a-f]{64}$'
        AND item->>'english_definition_sha256'~'^sha256:[0-9a-f]{64}$',false)) THEN
   RAISE EXCEPTION 'workspace_engine_global_receipt_decision_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO run FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO call FROM engine_cost_events WHERE id=NEW.call_id;
 SELECT * INTO coverage FROM signal_workspace_engine_interpretation_coverage_v1(NEW.execution_id);
 IF NOT COALESCE(run.id IS NOT NULL AND run.status='failed' AND run.input_contract='workspace-topic-engine-v1'
  AND run.error_code='workspace_engine_worker_failed'
  AND run.actor_user_id=NEW.created_by_user_id AND run.input_digest=NEW.input_digest
  AND run.input_snapshot#>>'{engine_config,profile_version}' IN('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
  AND run.input_snapshot ? 'interpretation_config' AND NOT run.result_summary ? 'analysis_checkpoint'
  AND run.result_summary#>>'{fit_checkpoint,checkpoint_digest}'=NEW.fit_checkpoint_digest
  AND coverage.unit_count=coverage.unique_count AND coverage.unit_count>0
  AND coverage.unit_count=(run.result_summary#>>'{fit_checkpoint,interpretation_manifest,unit_count}')::bigint
  AND coverage.unit_digest=run.result_summary#>>'{fit_checkpoint,interpretation_manifest,unit_digest}'
  AND run.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=run.workspace_id)
  AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())
  AND (NEW.decision->>'contract_version'='workspace-mass-labeling-receipt-recovery-v1'
    AND signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id)
    AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.created_by_user_id AND actor.status='active'
      AND actor.user_type='noisia_internal' AND actor.primary_role IN('noisia_admin','admin','founder'))
   OR NEW.decision->>'contract_version'='workspace-mass-labeling-receipt-recovery-v2'
    AND signal_mass_labeling_product_engine_v2(run.workspace_id,run.input_contract,run.input_snapshot)
    AND signal_workspace_engine_actor_v1(run,NEW.created_by_user_id)
    AND EXISTS(SELECT 1 FROM signal_processing_admissions admission
      WHERE admission.id=run.processing_admission_id AND admission.workspace_id=run.workspace_id
       AND admission.target_id=run.id AND admission.actor_user_id=run.actor_user_id
       AND admission.action='topic_interpretation' AND admission.provider=call.provider AND admission.model=call.model
       AND admission.configuration=call.call_configuration))
  AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling')
  AND call.workspace_contract='workspace-engine-interpretation-v1' AND call.workspace_id=NEW.workspace_id AND call.catalog_execution_id=NEW.execution_id
  AND call.actor_user_id=NEW.created_by_user_id AND call.call_state='settled' AND call.settled_micro_usd IS NOT NULL
  AND call.request_digest=NEW.request_digest AND call.response_sha256=NEW.response_sha256 AND call.response_storage_key IS NOT NULL
  AND call.response_http_status=200 AND call.response_size_bytes>0 AND COALESCE((call.metadata->>'response_complete')::boolean,true)
  AND call.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'
  AND call.metadata#>>'{mass_labeling_stage,source_groups_digest}'=NEW.source_groups_digest
  AND NOT call.metadata ? 'editorial_repair'
  AND call.call_configuration=workspace_engine_interpretation_configuration_v1(run.id,call.metadata->>'interpretation_revision_digest')
  AND NEW.decision->>'contract_version' IN('workspace-mass-labeling-receipt-recovery-v1','workspace-mass-labeling-receipt-recovery-v2')
  AND NEW.decision->>'workspace_id'=NEW.workspace_id::text AND NEW.decision->>'execution_id'=NEW.execution_id::text
  AND NEW.decision->>'call_id'=NEW.call_id::text AND NEW.decision->>'request_digest'=NEW.request_digest
  AND NEW.decision->>'response_sha256'=NEW.response_sha256 AND NEW.decision->>'source_groups_digest'=NEW.source_groups_digest
  AND NEW.decision_digest='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(NEW.decision),'UTF8')),'hex')
  AND NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=run.id
    AND artifact.metadata->>'contract_version'='workspace-mass-labeling-consolidation-v1')
  AND NOT EXISTS(SELECT 1 FROM engine_cost_events pending WHERE pending.catalog_execution_id=run.id
    AND pending.workspace_contract='workspace-engine-interpretation-v1'
    AND (pending.call_state IN('reserved','in_flight','response_persisted','outcome_unknown')
      OR pending.call_state='terminal_confirmed' AND NOT pending.metadata ? 'provider_terminal_billing_reconciliation'))
  AND NOT EXISTS(SELECT 1 FROM engine_cost_events later WHERE later.catalog_execution_id=run.id AND later.id<>call.id
    AND later.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1' AND later.sent_at>call.sent_at),false) THEN
  RAISE EXCEPTION 'workspace_engine_global_receipt_decision_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
