-- Incremental and in-flight execution use their immutable operational lineage.
-- Working drafts do not establish execution authority. DDL only: no migration-time data or budget writes.
CREATE FUNCTION signal_workspace_incremental_operational_profile_v1(target_execution uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH RECURSIVE lineage AS (
  SELECT execution.id,execution.workspace_id,execution.taxonomy_profile_id,execution.input_snapshot,
   0 depth,ARRAY[execution.id] path FROM signal_topic_catalog_executions execution
   WHERE execution.id=target_execution AND execution.input_contract='workspace-topic-engine-v1'
  UNION ALL
  SELECT parent.id,parent.workspace_id,parent.taxonomy_profile_id,parent.input_snapshot,lineage.depth+1,lineage.path||parent.id
   FROM lineage JOIN signal_topic_catalog_executions parent
    ON parent.id::text=lineage.input_snapshot->'numeric_descriptor'->'parent'->>'execution_id'
    AND parent.workspace_id=lineage.workspace_id AND parent.input_contract='workspace-topic-engine-v1'
   WHERE NOT parent.id=ANY(lineage.path)
 ), candidates AS (
  -- Guarded, immutable delivery receipts take precedence over their inputs.
  SELECT lineage.depth,operation.result_profile_id profile_id FROM lineage JOIN signal_topic_catalog_operations operation
   ON operation.workspace_id=lineage.workspace_id AND operation.action='materialize_incremental'
    AND operation.result_summary->>'numeric_execution_id'=lineage.id::text
    AND operation.result_summary->>'output_catalog_profile_id'=operation.result_profile_id::text
    AND operation.result_summary->>'contract_version'='workspace-incremental-editorial-catalog-receipt-v1'
  UNION ALL
  SELECT lineage.depth,profile.id FROM lineage JOIN analysis_artifacts artifact
   ON artifact.engine_execution_id=lineage.id AND artifact.workspace_id=lineage.workspace_id
    AND artifact.metadata->>'contract_version' IN('workspace-topic-materialization-v1','workspace-topic-materialization-progress-v1')
   JOIN signal_taxonomy_profiles profile ON profile.id::text=artifact.metadata->>'output_catalog_profile_id' AND profile.workspace_id=lineage.workspace_id
  UNION ALL
  -- Full-fit materialization commits its immutable profile before its artifact
  -- checkpoint. The paid coverage anchors this recoverable intermediate state.
  SELECT lineage.depth,profile.id FROM lineage JOIN signal_taxonomy_profiles profile
   ON profile.workspace_id=lineage.workspace_id AND profile.metadata->>'source_engine_execution_id'=lineage.id::text
   CROSS JOIN LATERAL signal_workspace_engine_interpretation_coverage_v1(lineage.id) coverage
   WHERE NOT lineage.input_snapshot ? 'numeric_descriptor'
    AND coverage.unit_count=coverage.unique_count
    AND profile.metadata->>'source_interpretation_units_digest'=coverage.unit_digest
    AND profile.metadata->>'source_mapping_digest'~'^sha256:[0-9a-f]{64}$'
    AND (profile.metadata->>'catalog_role' IS NULL OR profile.metadata->>'catalog_role'='analysis_materialized')
  UNION ALL
  SELECT lineage.depth,generation.taxonomy_profile_id FROM lineage JOIN signal_classification_generations generation
   ON generation.workspace_id=lineage.workspace_id AND generation.status='ready'
    AND generation.input_snapshot->'source_projection'->>'engine_execution_id'=lineage.id::text
    AND generation.input_snapshot->'source_projection'->>'contract_version' IN('workspace-topic-projection-v1','workspace-topic-incremental-projection-v1')
   WHERE NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item WHERE item.generation_id=generation.id AND item.resolution_state='error')
 ), operational AS (
  SELECT candidate.profile_id,candidate.depth,profile.version FROM candidates candidate JOIN signal_taxonomy_profiles profile ON profile.id=candidate.profile_id
   JOIN lineage ON lineage.id=target_execution AND lineage.workspace_id=profile.workspace_id
   WHERE profile.kind='topic' AND profile.metadata->>'contract_version'='signal-topic-catalog-v1'
 ), opted AS (
  SELECT profile.id FROM lineage JOIN signal_taxonomy_profiles profile ON profile.id=lineage.taxonomy_profile_id AND profile.workspace_id=lineage.workspace_id
   WHERE NOT lineage.input_snapshot ? 'numeric_descriptor' AND profile.id::text=lineage.input_snapshot->>'taxonomy_profile_id'
    AND profile.kind='topic' AND profile.metadata->>'contract_version'='signal-topic-catalog-v1'
  ORDER BY lineage.depth LIMIT 1
 )
 SELECT COALESCE((SELECT profile_id FROM operational ORDER BY depth,version DESC,profile_id LIMIT 1),(SELECT id FROM opted))
$$;

CREATE FUNCTION guard_workspace_operational_numeric_profile_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.input_contract='workspace-topic-engine-v1' AND NEW.input_snapshot ? 'numeric_descriptor' AND NOT EXISTS(
  SELECT 1 FROM signal_topic_catalog_executions parent WHERE parent.id::text=NEW.input_snapshot->'numeric_descriptor'->'parent'->>'execution_id'
   AND parent.workspace_id=NEW.workspace_id AND parent.input_contract='workspace-topic-engine-v1'
   AND parent.input_snapshot->>'taxonomy_profile_id'=NEW.input_snapshot->>'taxonomy_profile_id'
   AND NEW.taxonomy_profile_id::text=NEW.input_snapshot->>'taxonomy_profile_id'
 ) THEN RAISE EXCEPTION 'workspace_engine_operational_profile_changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_operational_numeric_profile BEFORE INSERT ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_operational_numeric_profile_v1();


CREATE OR REPLACE FUNCTION guard_workspace_incremental_editorial_execution_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source signal_topic_catalog_executions%ROWTYPE; body jsonb; policy jsonb; targets jsonb;
BEGIN
 IF COALESCE(NEW.input_contract,'')<>'workspace-incremental-editorial-v1' AND COALESCE(OLD.input_contract,'')<>'workspace-incremental-editorial-v1' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'workspace_incremental_editorial_history_immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['interpretation_admission_operation_id','status','worker_job_id','execution_token','execution_expires_at','heartbeat_at','started_at','completed_at','result_summary','error_code','progress','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['interpretation_admission_operation_id','status','worker_job_id','execution_token','execution_expires_at','heartbeat_at','started_at','completed_at','result_summary','error_code','progress','updated_at'])
   OR (NEW.result_summary->'delivery_retry_count' IS DISTINCT FROM OLD.result_summary->'delivery_retry_count' AND NOT (OLD.status='failed' AND NEW.status='queued'))
   OR NEW.input_contract IS DISTINCT FROM OLD.input_contract OR OLD.status='ready' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
   OR (OLD.result_summary ? 'request_plan_artifact_id' AND (NEW.result_summary->>'request_plan_artifact_id' IS DISTINCT FROM OLD.result_summary->>'request_plan_artifact_id' OR NEW.result_summary->>'request_plan_digest' IS DISTINCT FROM OLD.result_summary->>'request_plan_digest'))
   OR NEW.result_summary->'analysis_complete' IS DISTINCT FROM 'false'::jsonb
   OR NEW.result_summary->'provider_enabled' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'workspace_incremental_editorial_history_immutable' USING ERRCODE='55000'; END IF;
  IF NEW.status<>OLD.status AND NOT (OLD.status='failed' AND NEW.status='queued'
   AND NEW.interpretation_admission_operation_id IS DISTINCT FROM OLD.interpretation_admission_operation_id
   AND COALESCE((workspace_incremental_editorial_renewal_state_v1(OLD.id)->>'eligible')::boolean,false)
   AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.error_code IS NULL
   AND NEW.result_summary IS NOT DISTINCT FROM OLD.result_summary
   AND EXISTS(SELECT 1 FROM signal_classification_operations permission WHERE permission.id=NEW.interpretation_admission_operation_id
    AND permission.workspace_id=OLD.workspace_id AND permission.operation_kind='authorize-interpretation' AND permission.status='completed'
    AND permission.result->>'contract_version'='workspace-incremental-editorial-admission-v1' AND permission.result->>'execution_id'=OLD.id::text
    AND permission.result->>'prior_admission_operation_id'=OLD.interpretation_admission_operation_id::text
    AND permission.result->>'action'='authorize_interpretation' AND (permission.result->>'admission_not_after')::timestamptz>clock_timestamp())
   OR OLD.status='queued' AND NEW.status='running' OR (OLD.status='queued' AND NEW.status='failed'
   AND OLD.execution_token IS NULL AND OLD.execution_expires_at IS NULL AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL
   AND EXISTS(SELECT 1 FROM signal_topic_classification_outbox dispatch WHERE dispatch.execution_id=OLD.id AND dispatch.workspace_id=OLD.workspace_id AND dispatch.dispatch_kind='execution'
     AND dispatch.worker_job_id='signal-workspace-incremental-editorial-'||OLD.id::text||'-1' AND dispatch.status='dead_letter' AND dispatch.error_code=NEW.error_code
     AND (OLD.result_summary->>'worker_job_id' IS NULL OR OLD.result_summary->>'worker_job_id'=dispatch.worker_job_id))
   AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND (OLD.result_summary->>'worker_job_id' IS NULL OR call_state IN('in_flight','outcome_unknown')))) OR OLD.status='running' AND NEW.status IN('ready','failed') OR OLD.status='failed' AND NEW.status='queued' AND OLD.error_code IN('workspace_incremental_editorial_transport_unavailable','workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable','workspace_engine_interpretation_transport_terminal_confirmed','workspace_engine_interpretation_receipt_recovery_required') AND (OLD.error_code<>'workspace_engine_interpretation_receipt_recovery_required' OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='response_persisted' AND response_storage_key IS NOT NULL AND COALESCE((metadata->>'response_complete')::boolean,true))) AND (OLD.error_code<>'workspace_engine_interpretation_transport_terminal_confirmed' OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='terminal_confirmed' AND metadata ? 'provider_terminal_receipt') AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='terminal_confirmed' GROUP BY request_digest HAVING count(*)>1)) AND COALESCE((OLD.result_summary->>'delivery_retry_count')::int,0)<8 AND (NEW.result_summary->>'delivery_retry_count')::int=COALESCE((OLD.result_summary->>'delivery_retry_count')::int,0)+1 AND workspace_incremental_editorial_execution_current_v1(OLD.id) AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state IN('in_flight','outcome_unknown'))) THEN RAISE EXCEPTION 'workspace_incremental_editorial_transition_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.status='running' AND NOT COALESCE(NEW.execution_token IS NOT NULL AND NEW.execution_expires_at>clock_timestamp() AND NEW.result_summary->>'worker_job_id' LIKE 'signal-workspace-incremental-editorial-'||NEW.id::text||'-%'
   AND EXISTS(SELECT 1 FROM signal_topic_classification_outbox WHERE execution_id=NEW.id AND workspace_id=NEW.workspace_id AND dispatch_kind='execution' AND worker_job_id=NEW.result_summary->>'worker_job_id' AND status IN('dispatching','dispatched')),false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_lease_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.result_summary ? 'request_plan_artifact_id' AND NOT (workspace_incremental_editorial_request_plan_valid_v1((NEW.result_summary->>'request_plan_artifact_id')::uuid) AND EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id::text=NEW.result_summary->>'request_plan_artifact_id' AND plan.engine_execution_id=NEW.id AND plan.workspace_id=NEW.workspace_id AND plan.metadata->'plan'->>'plan_digest'=NEW.result_summary->>'request_plan_digest')) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_plan_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NOT COALESCE(NEW.completed_at IS NOT NULL AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.result_summary->'editorial_complete'='true'::jsonb AND workspace_incremental_editorial_output_complete_v1(NEW.id),false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_checkpoint_incomplete' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO source FROM signal_topic_catalog_executions WHERE id=NEW.source_execution_id FOR UPDATE;
 body:=NEW.input_snapshot; policy:=workspace_incremental_editorial_policy_v1(source.id);targets:=workspace_incremental_editorial_targets_v1(source.id);
 IF NOT COALESCE(source.id IS NOT NULL AND source.workspace_id=NEW.workspace_id AND NEW.actor_user_id=source.actor_user_id
  AND NEW.status='queued' AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.completed_at IS NULL
  AND NEW.interpretation_revision IS NULL AND NEW.interpretation_admission_operation_id IS NULL
  AND NEW.processed_roots=0 AND NEW.processed_chunks=0 AND NEW.denominator=source.denominator AND NEW.expected_chunks=source.expected_chunks
  AND NEW.embedding_run_id=source.embedding_run_id AND NEW.preparation_run_id=source.preparation_run_id AND NEW.embedding_config_digest=source.embedding_config_digest
  AND NEW.input_revision=source.input_revision AND NEW.policy_valid_until IS NOT DISTINCT FROM source.policy_valid_until
  AND NEW.population_digest=source.result_summary->'numeric_checkpoint'->>'population_digest'
  AND NEW.identity_catalog_digest=source.identity_catalog_digest AND NEW.definition_digest=source.definition_digest
  AND NEW.taxonomy_profile_id=signal_workspace_incremental_operational_profile_v1(source.id)
  AND workspace_incremental_editorial_source_v1(source.id) AND policy IS NOT NULL
  AND body->>'contract_version'='workspace-incremental-editorial-v1' AND pg_column_size(body)<=16384
  AND body->>'execution_id'=NEW.id::text AND body->>'workspace_id'=NEW.workspace_id::text
  AND body->>'numeric_execution_id'=source.id::text AND body->>'numeric_checkpoint_digest'=source.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
  AND body->>'population_digest'=NEW.population_digest AND body->>'input_revision'=NEW.input_revision::text
  AND body->>'context_digest'=source.input_snapshot->>'context_digest' AND body->>'catalog_input_digest'=source.input_snapshot->>'catalog_digest'
  AND body->>'model_bank_artifact_id'=source.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'
  AND body->>'model_bank_sha256'=(SELECT content->>'sha256' FROM analysis_artifacts WHERE id=(body->>'model_bank_artifact_id')::uuid AND engine_execution_id=source.id)
  AND body->>'census_derivation_digest'=workspace_incremental_editorial_census_v1(source.id)
  AND body->>'history_cut_digest'=signal_workspace_incremental_projection_editorial_digest_v1(source.id)
  AND (body->>'expected_units')::bigint=(targets->>'expected_units')::bigint AND targets->>'expected_units'=targets->>'unique_units'
  AND workspace_incremental_editorial_plan_valid_v1((body->>'evidence_plan_artifact_id')::uuid)
  AND EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id::text=body->>'evidence_plan_artifact_id' AND (plan.metadata->>'numeric_execution_id')::uuid=source.id
   AND body->>'target_units'=plan.metadata->'descriptor'->'stream'->>'rows' AND (body->>'target_units')::bigint>0
   AND body->>'target_unit_digest'=plan.metadata->'descriptor'->>'target_unit_digest' AND body->>'target_binding_digest'=plan.metadata->'descriptor'->>'target_binding_digest'
   AND body->>'evidence_digest'=plan.metadata->>'evidence_digest')
  AND body->'budget_policy'=policy AND body->>'budget_actor_user_id'=source.actor_user_id::text
  AND workspace_interpretation_admission_admin_v1(NEW.workspace_id,(body->>'authorized_by_user_id')::uuid)
  AND (body->>'claude_cap_micro_usd')::bigint>0 AND (body->>'claude_cap_micro_usd')::bigint<=(policy->>'daily_cap_micro_usd')::bigint
  AND body->'interpretation_configuration'=workspace_incremental_editorial_sonnet_v1()
  AND NEW.input_digest=workspace_incremental_editorial_digest_v1(body)
  AND NEW.result_summary='{"phase":"admitted","analysis_complete":false,"provider_enabled":false}'::jsonb
  AND NEW.engine_request_keys IS NULL,false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_execution_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_workspace_incremental_binding_scope_v1(artifact analysis_artifacts)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN signal_topic_classification_outbox dispatch ON dispatch.execution_id=engine.id AND dispatch.workspace_id=engine.workspace_id
   AND dispatch.dispatch_kind='incremental_projection' AND dispatch.status IN('dispatching','dispatched')
  WHERE engine.id=artifact.engine_execution_id AND engine.workspace_id=artifact.workspace_id AND engine.status='ready'
   AND engine.input_snapshot ? 'numeric_descriptor' AND engine.result_summary ? 'numeric_checkpoint'
   AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=engine.workspace_id)
   AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp())
   AND signal_workspace_incremental_execution_current_v1(engine.id) AND signal_workspace_incremental_serving_current_v1(engine.id)
   AND signal_workspace_classification_actor_v1(engine.workspace_id,engine.actor_user_id)
   AND artifact.metadata->>'actor_user_id'=engine.actor_user_id::text
   AND artifact.metadata->>'worker_job_id'=dispatch.worker_job_id
   AND dispatch.worker_job_id='workspace-incremental-projection-'||engine.id::text||'-'||substring(workspace_incremental_editorial_digest_v1(jsonb_build_array(
    engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest',signal_workspace_incremental_operational_profile_v1(engine.id)::text,
    signal_workspace_incremental_correction_epoch_v1(engine.workspace_id),signal_workspace_incremental_serving_digest_v1(engine.id))) FROM 8)
   AND artifact.metadata->>'numeric_checkpoint_digest'=engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
   AND artifact.metadata->>'derivation_digest'~'^sha256:[0-9a-f]{64}$'),false)
$$;

CREATE OR REPLACE FUNCTION guard_workspace_incremental_binding_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE engine signal_topic_catalog_executions%ROWTYPE; binding jsonb; component analysis_artifacts%ROWTYPE;
 proposal analysis_artifacts%ROWTYPE; receipt engine_cost_events%ROWTYPE; census_row analysis_artifacts%ROWTYPE;
 topic taxonomy_terms%ROWTYPE; actual_bindings jsonb; coverage jsonb; expected_count bigint; actual_count bigint; expected_digest text; actual_digest text;
BEGIN
 IF NOT (COALESCE(NEW.metadata->>'contract_version','') IN('workspace-incremental-unit-census-v1','workspace-incremental-unit-binding-v1','workspace-incremental-binding-index-v1') OR COALESCE(OLD.metadata->>'contract_version','') IN('workspace-incremental-unit-census-v1','workspace-incremental-unit-binding-v1','workspace-incremental-binding-index-v1')) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' OR ROW(NEW.content,NEW.metadata,NEW.engine_execution_id,NEW.workspace_id,NEW.artifact_key,NEW.artifact_type)
    IS DISTINCT FROM ROW(OLD.content,OLD.metadata,OLD.engine_execution_id,OLD.workspace_id,OLD.artifact_key,OLD.artifact_type) THEN
   RAISE EXCEPTION 'workspace_incremental_projection_history_immutable' USING ERRCODE='55000'; END IF;RETURN NEW;
 END IF;
 IF NEW.artifact_type<>'engine_output' OR NOT signal_workspace_incremental_binding_scope_v1(NEW) THEN
  RAISE EXCEPTION 'workspace_incremental_projection_binding_scope_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO engine FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id;
 IF NEW.metadata->>'contract_version'='workspace-incremental-unit-census-v1' THEN
  SELECT * INTO component FROM analysis_artifacts WHERE engine_execution_id=engine.id AND workspace_id=engine.workspace_id
   AND metadata->>'contract_version'='workspace-incremental-component-v1' AND metadata->>'component_key'=NEW.metadata->>'component_key';
  IF NOT COALESCE(component.id IS NOT NULL AND NEW.metadata->'unit'->>'unit_key'~'^(open|guided):[0-9a-f-]{36}$'
   AND split_part(NEW.metadata->'unit'->>'unit_key',':',1)=component.metadata->>'lane'
   AND (NEW.metadata->'unit'->>'local_label')::bigint>=0 AND NEW.metadata->'unit'->>'birth_membership_digest'~'^sha256:[0-9a-f]{64}$'
   AND NEW.artifact_key='incremental-census-'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_array(
    NEW.metadata->>'derivation_digest',NEW.metadata->'unit'->>'unit_key')),'UTF8')),'hex')
   AND EXISTS(SELECT 1 FROM analysis_artifacts file WHERE file.engine_execution_id=engine.id AND file.workspace_id=engine.workspace_id
    AND file.artifact_key='model-components.json' AND file.content=NEW.content),false) THEN
   RAISE EXCEPTION 'workspace_incremental_projection_census_invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT COALESCE(NEW.metadata->>'engine_execution_id'=engine.id::text
  AND NEW.metadata->>'editorial_cut_digest'=signal_workspace_incremental_serving_digest_v1(engine.id)
  AND NEW.metadata->>'catalog_profile_id'=signal_workspace_incremental_operational_profile_v1(engine.id)::text
  AND NEW.metadata->'identity'->>'workspace_id'=engine.workspace_id::text
  AND NEW.metadata->'identity'->>'context_digest'=engine.input_snapshot->>'context_digest'
  AND NEW.metadata->'identity'->>'embedding_config_digest'=engine.embedding_config_digest
  AND NEW.metadata->>'derivation_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_object(
   'engine_execution_id',engine.id::text,'numeric_checkpoint_digest',NEW.metadata->>'numeric_checkpoint_digest',
   'catalog_profile_id',NEW.metadata->>'catalog_profile_id','identity',NEW.metadata->'identity',
   'correction_digest',NEW.metadata->>'correction_digest','editorial_cut_digest',NEW.metadata->>'editorial_cut_digest')),'UTF8')),'hex'),false) THEN
  RAISE EXCEPTION 'workspace_incremental_projection_binding_identity_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.metadata->>'contract_version'='workspace-incremental-unit-binding-v1' THEN
  binding:=NEW.metadata->'binding';
  SELECT * INTO component FROM analysis_artifacts WHERE engine_execution_id=engine.id AND workspace_id=engine.workspace_id
   AND metadata->>'contract_version'='workspace-incremental-component-v1' AND metadata->>'component_key'=binding->>'component_key';
  SELECT * INTO census_row FROM analysis_artifacts WHERE engine_execution_id=engine.id AND workspace_id=engine.workspace_id
   AND metadata->>'contract_version'='workspace-incremental-unit-census-v1' AND metadata->>'derivation_digest'=NEW.metadata->>'derivation_digest'
   AND metadata->'unit'->>'unit_key'=binding->>'unit_key';
  SELECT artifact.* INTO proposal FROM signal_workspace_incremental_serving_history_v1(engine.id) history
   JOIN analysis_artifacts artifact ON artifact.id=history.artifact_id WHERE artifact.id=(binding->'proposal'->>'artifact_id')::uuid;
  SELECT * INTO receipt FROM engine_cost_events WHERE id=(binding->'proposal'->>'call_id')::uuid;
  IF NOT COALESCE(component.id IS NOT NULL AND census_row.id IS NOT NULL AND proposal.id IS NOT NULL
   AND census_row.metadata->>'component_key'=component.metadata->>'component_key'
   AND census_row.metadata->'unit'->>'birth_membership_digest'=binding->>'birth_membership_digest'
   AND component.metadata->'model_origin'=binding->'model_origin'
   AND signal_workspace_incremental_binding_provenance_v1(engine.id,binding)
   AND binding->'proposal'->>'owner_execution_id'=proposal.engine_execution_id::text
   AND binding->'proposal'->>'artifact_sha256'=proposal.content->>'sha256'
   AND proposal.metadata->'unit_keys' ? (binding->>'unit_key')
   AND proposal.metadata->>'call_id'=receipt.id::text AND receipt.call_state='settled'
   AND binding->'proposal'->>'request_digest'=receipt.request_digest
   AND binding->'proposal'->>'configuration_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(receipt.call_configuration),'UTF8')),'hex')
   AND binding->'proposal'->>'cluster_digest'~'^sha256:[0-9a-f]{64}$'
   AND binding->'proposal'->>'proposal_semantics_digest'~'^sha256:[0-9a-f]{64}$'
   AND binding->'proposal'->>'status' IN('coherent','mixed','insufficient')
   AND NEW.artifact_key='incremental-unit-'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_array(
    NEW.metadata->>'derivation_digest',binding->>'unit_key')),'UTF8')),'hex'),false) THEN
   RAISE EXCEPTION 'workspace_incremental_projection_binding_invalid' USING ERRCODE='23514'; END IF;
  IF binding->>'term_key' IS NOT NULL THEN
   SELECT term.* INTO topic FROM signal_taxonomy_profiles profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
    WHERE profile.id=(NEW.metadata->>'catalog_profile_id')::uuid AND profile.workspace_id=engine.workspace_id AND term.term_key=binding->>'term_key';
   IF NOT COALESCE(topic.id IS NOT NULL AND topic.metadata->'topic'->>'definition_digest'=binding->>'definition_digest'
    AND topic.metadata->'topic'->>'definition_revision'=binding->>'definition_revision'
    AND topic.metadata->'topic'->'source'->>'candidate_key'=binding->>'unit_key'
    AND topic.metadata->'topic'->'source'->>'run_key'='workspace-engine:'||proposal.engine_execution_id::text
    AND topic.metadata->'topic'->'source'->>'candidate_digest'=binding->'proposal'->>'cluster_digest',false) THEN
    RAISE EXCEPTION 'workspace_incremental_projection_topic_invalid' USING ERRCODE='23514'; END IF;
  ELSIF binding->>'definition_digest' IS NOT NULL OR binding->>'definition_revision' IS NOT NULL THEN
   RAISE EXCEPTION 'workspace_incremental_projection_topic_invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.artifact_key<>'incremental-bindings-'||substring(NEW.metadata->>'derivation_digest' from 8)||'.jsonl'
  OR NOT signal_workspace_incremental_unit_census_valid_v1(engine.id,NEW.metadata->>'derivation_digest') THEN
  RAISE EXCEPTION 'workspace_incremental_projection_census_incomplete' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(jsonb_agg(artifact.metadata->'binding' ORDER BY artifact.metadata->'binding'->>'unit_key' COLLATE "C"),'[]'::jsonb),count(*),
  'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(artifact.metadata->'binding'->>'unit_key')::text||E'\n','' ORDER BY artifact.metadata->'binding'->>'unit_key' COLLATE "C"),''),'UTF8')),'hex')
 INTO actual_bindings,actual_count,actual_digest FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=engine.id
  AND artifact.metadata->>'contract_version'='workspace-incremental-unit-binding-v1' AND artifact.metadata->>'derivation_digest'=NEW.metadata->>'derivation_digest';
 SELECT count(*),'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(census.metadata->'unit'->>'unit_key')::text||E'\n','' ORDER BY census.metadata->'unit'->>'unit_key' COLLATE "C"),''),'UTF8')),'hex')
 INTO expected_count,expected_digest FROM analysis_artifacts census WHERE census.engine_execution_id=engine.id
  AND census.metadata->>'contract_version'='workspace-incremental-unit-census-v1' AND census.metadata->>'derivation_digest'=NEW.metadata->>'derivation_digest';
 coverage:=jsonb_build_object('interpreted_unit_count',actual_count,'expected_unit_count',expected_count,
  'unit_digest',actual_digest,'expected_unit_digest',expected_digest,'complete',actual_count=expected_count);
 IF NOT COALESCE(NEW.metadata->'interpretation_coverage'=coverage
  AND NEW.metadata->>'binding_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_object(
   'bindings',actual_bindings,'editorial_cut_digest',NEW.metadata->>'editorial_cut_digest','interpretation_coverage',coverage)),'UTF8')),'hex')
  AND NEW.metadata->'discovery_coverage'->>'state'=engine.result_summary->'numeric_checkpoint'->>'discovery_status'
  AND (NEW.metadata->'discovery_coverage'->>'pending_roots')::bigint BETWEEN 0 AND engine.denominator
  AND ((NEW.metadata->'discovery_coverage'->>'state'='complete')=((NEW.metadata->'discovery_coverage'->>'pending_roots')::bigint=0)),false)
  OR EXISTS(SELECT 1 FROM analysis_artifacts alias WHERE alias.engine_execution_id=engine.id
   AND alias.metadata->>'contract_version'='workspace-incremental-unit-binding-v1' AND alias.metadata->>'derivation_digest'=NEW.metadata->>'derivation_digest'
   AND (alias.content<>NEW.content OR alias.metadata-'contract_version'-'binding'<>NEW.metadata-'contract_version')) THEN
  RAISE EXCEPTION 'workspace_incremental_projection_index_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_signal_workspace_incremental_catalog_receipt_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE body jsonb; engine signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF COALESCE(NEW.action,'')<>'materialize_incremental' AND COALESCE(OLD.action,'')<>'materialize_incremental' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'workspace_incremental_catalog_receipt_immutable' USING ERRCODE='55000'; END IF;
 body:=NEW.result_summary;
 SELECT * INTO engine FROM signal_topic_catalog_executions WHERE id::text=body->>'numeric_execution_id' AND workspace_id=NEW.workspace_id;
 IF NOT COALESCE(engine.input_snapshot ? 'numeric_descriptor' AND engine.status='ready' AND engine.actor_user_id=NEW.actor_user_id
  AND signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id) AND signal_workspace_incremental_execution_current_v1(engine.id)
  AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=NEW.workspace_id)
  AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp()) AND signal_workspace_incremental_origin_current_v1(engine.id,engine.workspace_id)
  AND signal_workspace_incremental_serving_current_v1(engine.id)
  AND body->>'contract_version'='workspace-incremental-editorial-catalog-receipt-v1' AND body->>'receipt_id'=NEW.id::text
  AND body->>'serving_editorial_cut_digest'=signal_workspace_incremental_serving_digest_v1(engine.id)
  AND NEW.idempotency_key='incremental-catalog:'||engine.id::text||':'||substring(body->>'serving_editorial_cut_digest' FROM 8)
  AND NEW.request_digest=workspace_incremental_editorial_digest_v1(jsonb_build_object('numeric_execution_id',engine.id::text,'serving_editorial_cut_digest',body->>'serving_editorial_cut_digest'))
  AND body->>'output_catalog_profile_id'=NEW.result_profile_id::text AND body->>'mapping_digest'~'^sha256:[0-9a-f]{64}$'
  AND EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile WHERE profile.id=NEW.result_profile_id AND profile.workspace_id=NEW.workspace_id
   AND profile.version::text=body->>'output_catalog_revision' AND profile.kind='topic' AND profile.metadata->>'contract_version'='signal-topic-catalog-v1'
   AND (profile.id=signal_workspace_incremental_operational_profile_v1(engine.id)
    OR (profile.metadata->>'catalog_role'='incremental'
     AND profile.metadata->>'source_catalog_profile_id'=signal_workspace_incremental_operational_profile_v1(engine.id)::text
     AND profile.metadata->>'source_numeric_execution_id'=engine.id::text
     AND profile.metadata->>'serving_editorial_cut_digest'=body->>'serving_editorial_cut_digest'
     AND profile.metadata->>'source_mapping_digest'=body->>'mapping_digest')))
  AND jsonb_typeof(body->'topic_count')='number' AND jsonb_typeof(body->'discovered_topic_count')='number'
  AND body->>'topic_count'=(SELECT count(*)::text FROM taxonomy_terms term JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id
   WHERE profile.id=NEW.result_profile_id AND term.metadata->'topic'->>'lifecycle'<>'archived')
  AND body->>'discovered_topic_count'=(SELECT count(*)::text FROM taxonomy_terms term JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id
   WHERE profile.id=NEW.result_profile_id AND term.metadata->'topic'->>'lifecycle'<>'archived' AND term.metadata->'topic'->>'origin'='workspace_discovery')
  AND NEW.result_term_key='' AND NEW.selection_result IS NULL,false) THEN RAISE EXCEPTION 'workspace_incremental_catalog_receipt_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION signal_workspace_incremental_operational_profile_v1(uuid),guard_workspace_operational_numeric_profile_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_workspace_incremental_operational_profile_v1(uuid),guard_workspace_operational_numeric_profile_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION guard_workspace_engine_analysis_artifact_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; call engine_cost_events%ROWTYPE;
 count_keys bigint; unique_keys bigint; profile signal_taxonomy_profiles%ROWTYPE; topics bigint; coverage record;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=OLD.engine_execution_id;
  IF execution.input_snapshot->'interpretation_config' IS NOT NULL THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Analysis checkpoint history is retained.' USING ERRCODE='55000'; END IF;
   IF ROW(NEW.workspace_id,NEW.engine_execution_id,NEW.artifact_key,NEW.artifact_type,NEW.content,NEW.metadata,NEW.discovery_run_digest,NEW.workspace_authority_digest)
     IS DISTINCT FROM ROW(OLD.workspace_id,OLD.engine_execution_id,OLD.artifact_key,OLD.artifact_type,OLD.content,OLD.metadata,OLD.discovery_run_digest,OLD.workspace_authority_digest) THEN
    RAISE EXCEPTION 'Analysis checkpoint evidence is immutable.' USING ERRCODE='55000'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.engine_execution_id IS DISTINCT FROM OLD.engine_execution_id AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions
    WHERE id=NEW.engine_execution_id AND input_snapshot->'interpretation_config' IS NOT NULL) THEN
   RAISE EXCEPTION 'Existing evidence cannot become an analysis checkpoint.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.engine_execution_id IS NULL OR NEW.artifact_type<>'engine_proposals' THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF execution.input_snapshot->'interpretation_config' IS NULL THEN
  IF NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1' THEN
   RAISE EXCEPTION 'Progress requires an editorial interpretation contract.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1' THEN
  SELECT * INTO coverage FROM signal_workspace_engine_interpretation_coverage_v1(execution.id);
  SELECT * INTO profile FROM signal_taxonomy_profiles WHERE id=(NEW.metadata->>'output_catalog_profile_id')::uuid
   AND workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active','retired');
  SELECT count(*) INTO topics FROM taxonomy_terms WHERE taxonomy_id=profile.taxonomy_id AND metadata->'topic'->>'lifecycle'<>'archived';
  IF NOT COALESCE(execution.status IN('running','failed','ready') AND execution.result_summary ? 'fit_checkpoint'
    AND signal_workspace_classification_actor_v1(execution.workspace_id,execution.actor_user_id)
    AND execution.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=execution.workspace_id)
    AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp())
    AND profile.id=signal_workspace_incremental_operational_profile_v1(execution.id)
    AND NEW.artifact_key='materialization-progress-'||profile.id::text||'.json'
    AND NEW.metadata->>'execution_id'=execution.id::text
    AND (NEW.metadata->>'output_catalog_revision')::int=profile.version AND (NEW.metadata->>'topic_count')::bigint=topics
    AND coverage.unit_count=coverage.unique_count AND coverage.unit_count>0
    AND coverage.unit_count=(NEW.metadata->>'interpreted_unit_count')::bigint
    AND coverage.unit_digest=NEW.metadata->>'interpretation_units_digest'
    AND (NEW.metadata->>'expected_interpretation_unit_count')::bigint=(execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::bigint
    AND NEW.metadata->>'expected_interpretation_units_digest'=execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_digest'
    AND coverage.unit_count<=(NEW.metadata->>'expected_interpretation_unit_count')::bigint
    AND (NEW.metadata->>'interpretation_complete')::boolean=(coverage.unit_count=(NEW.metadata->>'expected_interpretation_unit_count')::bigint
      AND coverage.unit_digest=NEW.metadata->>'expected_interpretation_units_digest')
    AND profile.metadata->>'source_engine_execution_id'=execution.id::text
    AND profile.metadata->>'source_interpretation_units_digest'=coverage.unit_digest
    AND profile.metadata->>'source_mapping_digest'=NEW.metadata->>'mapping_digest'
    AND NEW.metadata->>'mapping_digest'~'^sha256:[0-9a-f]{64}$',false)
   OR EXISTS(SELECT 1 FROM analysis_artifacts artifact LEFT JOIN engine_cost_events receipt
     ON receipt.id=(artifact.metadata->>'call_id')::uuid AND receipt.catalog_execution_id=execution.id AND receipt.workspace_id=execution.workspace_id
    WHERE artifact.engine_execution_id=execution.id AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
     AND NOT COALESCE(receipt.call_state='settled' AND receipt.actor_user_id=execution.actor_user_id
      AND receipt.response_sha256=artifact.metadata->>'response_sha256'
      AND receipt.call_configuration=workspace_engine_interpretation_configuration_v1(execution.id,receipt.metadata->>'interpretation_revision_digest'),false)) THEN
   RAISE EXCEPTION 'Progress materialization evidence is invalid.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF execution.status<>'running' OR execution.execution_expires_at<=clock_timestamp()
  OR execution.result_summary->'fit_checkpoint' IS NULL THEN
  RAISE EXCEPTION 'Analysis proposals require a live fitted execution.' USING ERRCODE='23514'; END IF;
 IF NEW.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' THEN
  SELECT * INTO call FROM engine_cost_events WHERE id=(NEW.metadata->>'call_id')::uuid
   AND workspace_id=NEW.workspace_id AND catalog_execution_id=execution.id AND workspace_contract='workspace-engine-interpretation-v1';
  IF call.id IS NULL OR call.call_state<>'settled' OR call.response_sha256 IS DISTINCT FROM NEW.metadata->>'response_sha256'
   OR call.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,call.metadata->>'interpretation_revision_digest')
   OR NEW.metadata->>'execution_id' IS DISTINCT FROM execution.id::text
   OR NEW.metadata->>'fit_checkpoint_digest' IS DISTINCT FROM execution.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR jsonb_typeof(NEW.metadata->'unit_keys') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Interpretation checkpoint receipt is invalid.' USING ERRCODE='23514'; END IF;
  SELECT count(*),count(DISTINCT key) INTO count_keys,unique_keys FROM jsonb_array_elements_text(NEW.metadata->'unit_keys') unit(key);
  IF count_keys NOT BETWEEN 1 AND 128 OR count_keys<>unique_keys
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.metadata->'unit_keys') unit(key) WHERE key!~'^[A-Za-z0-9:._-]{1,200}$')
   OR EXISTS(SELECT 1 FROM analysis_artifacts prior CROSS JOIN LATERAL jsonb_array_elements_text(prior.metadata->'unit_keys') unit(key)
      WHERE prior.engine_execution_id=execution.id AND prior.artifact_type='engine_proposals'
       AND prior.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' AND NEW.metadata->'unit_keys' ? unit.key) THEN
   RAISE EXCEPTION 'Interpretation units are duplicate or invalid.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.metadata->>'contract_version'='workspace-topic-materialization-v1' THEN
  SELECT * INTO profile FROM signal_taxonomy_profiles WHERE id=(NEW.metadata->>'output_catalog_profile_id')::uuid
   AND workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active','retired');
  SELECT count(*) INTO topics FROM taxonomy_terms WHERE taxonomy_id=profile.taxonomy_id AND metadata->'topic'->>'lifecycle'<>'archived';
  IF NEW.artifact_key<>'materialization.json' OR profile.id IS NULL
   OR NEW.metadata->>'execution_id' IS DISTINCT FROM execution.id::text
   OR (NEW.metadata->>'output_catalog_revision')::integer IS DISTINCT FROM profile.version
   OR (NEW.metadata->>'topic_count')::bigint IS DISTINCT FROM topics
   OR NEW.metadata->>'interpretation_units_digest' IS DISTINCT FROM execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_digest'
   OR profile.metadata->>'source_engine_execution_id' IS DISTINCT FROM execution.id::text
   OR profile.metadata->>'source_interpretation_units_digest' IS DISTINCT FROM NEW.metadata->>'interpretation_units_digest'
   OR profile.metadata->>'source_mapping_digest' IS DISTINCT FROM NEW.metadata->>'mapping_digest'
   OR NOT COALESCE(NEW.metadata->>'mapping_digest'~'^sha256:[0-9a-f]{64}$',false) THEN
   RAISE EXCEPTION 'Analysis catalog materialization is invalid.' USING ERRCODE='23514'; END IF;
 ELSE
  RAISE EXCEPTION 'Analysis proposal contract is required.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;


-- Historical native profiles remain usable only through the exact sealed run
-- and materialization. Generic registry admission still requires active status.
CREATE OR REPLACE FUNCTION validate_signal_tagging_model_registry_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace_id uuid;
BEGIN
  IF NEW.registry_contract_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.configuration->>'contract_version'='workspace-topic-incremental-projection-v1' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
    JOIN analysis_artifacts bank ON bank.id::text=NEW.configuration->>'model_artifact_id' AND bank.workspace_id=engine.workspace_id AND bank.engine_execution_id=engine.id
    JOIN analysis_artifacts binding ON binding.id::text=NEW.configuration->>'binding_artifact_id' AND binding.workspace_id=engine.workspace_id AND binding.engine_execution_id=engine.id
    WHERE engine.id::text=NEW.configuration->>'engine_execution_id' AND engine.status='ready' AND engine.input_snapshot ? 'numeric_descriptor'
     AND bank.id::text=engine.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'
     AND binding.metadata->>'contract_version'='workspace-incremental-binding-index-v1'
     AND binding.metadata->>'catalog_profile_id'=NEW.taxonomy_profile_id::text
     AND binding.metadata->>'binding_digest'=NEW.configuration->>'binding_digest'
     AND binding.metadata->>'numeric_checkpoint_digest'=NEW.configuration->>'numeric_checkpoint_digest'
     AND NEW.configuration->'workspace_classification_identity'=binding.metadata->'identity'
     AND NEW.artifact_digest=bank.content->>'sha256' AND NEW.configuration->>'approval_policy'='none'
     AND NEW.registered_by_user_id=engine.actor_user_id AND signal_workspace_incremental_binding_scope_v1(binding)
     AND NEW.runtime_kind='python' AND NEW.artifact_format='workspace-incremental-model-bank-v1'
     AND signal_data_governance_actor_is_valid(engine.workspace_id,NEW.registered_by_user_id)
     AND EXISTS(SELECT 1 FROM signal_classification_operations operation WHERE operation.id=NEW.registry_operation_id
      AND operation.workspace_id=engine.workspace_id AND operation.operation_kind='register-model' AND operation.status='in_progress'
      AND operation.actor_user_id=NEW.registered_by_user_id)) OR NEW.supersedes_model_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_incremental_projection_registry_invalid' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;

  IF NEW.configuration->>'contract_version'='workspace-topic-projection-v1' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
    JOIN signal_taxonomy_profiles profile ON profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=engine.workspace_id AND profile.status IN('draft','active','retired')
    JOIN analysis_artifacts model ON model.id::text=NEW.configuration->>'model_artifact_id' AND model.engine_execution_id=engine.id AND model.workspace_id=engine.workspace_id
    JOIN analysis_artifacts materialization ON materialization.id::text=NEW.configuration->>'materialization_artifact_id'
     AND materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
    WHERE engine.id::text=NEW.configuration->>'engine_execution_id' AND engine.input_contract='workspace-topic-engine-v1'
     AND signal_workspace_engine_materialization_source_v1(engine,materialization,profile.id)
     AND engine.result_summary->'fit_checkpoint'->>'model_artifact_id'=model.id::text
     AND model.artifact_type='engine_model' AND model.content->>'sha256'=NEW.artifact_digest
     AND materialization.metadata->>'mapping_digest'=NEW.configuration->>'mapping_digest'
     AND NEW.configuration->'workspace_classification_identity'->>'workspace_id'=engine.workspace_id::text
     AND NEW.configuration->'workspace_classification_identity'->>'engine_artifact_digest'=NEW.artifact_digest
     AND NEW.configuration->>'approval_policy'='none'
     AND signal_workspace_classification_actor_v1(engine.workspace_id,NEW.registered_by_user_id)
     AND signal_data_governance_actor_is_valid(engine.workspace_id,NEW.registered_by_user_id)
     AND EXISTS(SELECT 1 FROM signal_classification_operations operation WHERE operation.id=NEW.registry_operation_id
      AND operation.workspace_id=engine.workspace_id AND operation.operation_kind='register-model' AND operation.status='in_progress'
      AND operation.actor_user_id=NEW.registered_by_user_id)) OR NEW.supersedes_model_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_projection_model_invalid' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;

  IF NEW.configuration->>'contract_version'='workspace-topic-engine-v1' AND NOT EXISTS(
    SELECT 1 FROM signal_topic_catalog_executions execution
    JOIN analysis_artifacts artifact ON artifact.engine_execution_id=execution.id AND artifact.workspace_id=execution.workspace_id
    WHERE execution.id::text=NEW.configuration->>'execution_id' AND execution.input_contract='workspace-topic-engine-v1'
     AND execution.status='running' AND execution.taxonomy_profile_id=NEW.taxonomy_profile_id
     AND execution.actor_user_id=NEW.registered_by_user_id
     AND signal_workspace_classification_actor_v1(execution.workspace_id,NEW.registered_by_user_id)
     AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=NEW.artifact_digest) THEN
   RAISE EXCEPTION 'Native fitted model authority is invalid.' USING ERRCODE='23514'; END IF;

  SELECT workspace_id INTO target_workspace_id FROM signal_taxonomy_profiles
    WHERE id=NEW.taxonomy_profile_id AND (status='active' OR (status IN('draft','retired')
      AND NEW.configuration->>'contract_version'='workspace-topic-engine-v1'
      AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
       JOIN analysis_artifacts artifact ON artifact.engine_execution_id=execution.id AND artifact.workspace_id=execution.workspace_id
       WHERE execution.id::text=NEW.configuration->>'execution_id'
        AND execution.input_contract='workspace-topic-engine-v1' AND execution.status='running'
        AND execution.taxonomy_profile_id=NEW.taxonomy_profile_id AND execution.actor_user_id=NEW.registered_by_user_id
        AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=NEW.artifact_digest)));
  IF target_workspace_id IS NULL
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,NEW.registered_by_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.registry_operation_id AND operation.workspace_id=target_workspace_id
         AND operation.operation_kind='register-model' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.registered_by_user_id)
     OR (NEW.supersedes_model_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM tagging_model_versions prior
       WHERE prior.id=NEW.supersedes_model_version_id
         AND prior.registry_contract_version='signal-tagging-model-registry-v1'
         AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
         AND prior.model_key=NEW.model_key AND prior.version<>NEW.version)) THEN
    RAISE EXCEPTION 'Tagging model registry authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- A historical native projection can finish its exact generation after profile
-- retirement. Retired generic classifications and incompatible terms still fail.
CREATE OR REPLACE FUNCTION validate_signal_classification_assignment_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE item signal_classification_generation_items%ROWTYPE;
DECLARE profile_taxonomy uuid; DECLARE term_taxonomy uuid;
DECLARE policy signal_classification_approval_policies%ROWTYPE;
BEGIN
  SELECT * INTO generation FROM signal_classification_generations WHERE id=NEW.generation_id;
  SELECT * INTO item FROM signal_classification_generation_items WHERE id=NEW.generation_item_id;
  SELECT taxonomy_id INTO profile_taxonomy FROM signal_taxonomy_profiles
   WHERE id=NEW.taxonomy_profile_id AND workspace_id=NEW.workspace_id AND (status='active' OR generation.input_contract='workspace-topic-classification-v1' AND (status IN('draft','activating') OR status='retired'
    AND generation.input_snapshot->'source_projection'->>'contract_version' IN('workspace-topic-projection-v1','workspace-topic-incremental-projection-v1')
    AND signal_workspace_projection_source_current_v1(generation)));
  IF generation.id IS NULL OR generation.status<>'open'
     OR generation.workspace_id<>NEW.workspace_id
     OR generation.taxonomy_profile_id<>NEW.taxonomy_profile_id
     OR item.id IS NULL OR item.workspace_id<>NEW.workspace_id
     OR item.generation_id<>NEW.generation_id OR item.canonical_root_id<>NEW.canonical_root_id
     OR (generation.input_contract='legacy-classification-v1' AND item.resolution_state<>NEW.disposition)
     OR NOT EXISTS(SELECT 1 FROM mentions mention WHERE mention.id=NEW.canonical_root_id
       AND mention.workspace_id=NEW.workspace_id AND mention.canonical_mention_id=mention.id) THEN
    RAISE EXCEPTION 'Classification assignment scope is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.taxonomy_term_id IS NOT NULL THEN
    SELECT taxonomy_id INTO term_taxonomy FROM taxonomy_terms
      WHERE id=NEW.taxonomy_term_id AND (status='active' OR generation.input_contract='workspace-topic-classification-v1' AND status='candidate');
    IF term_taxonomy IS DISTINCT FROM profile_taxonomy THEN
      RAISE EXCEPTION 'Classification term is incompatible or retired.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.resolution_method='labeling_function' AND NOT EXISTS(
    SELECT 1 FROM signal_labeling_function_versions lf
    WHERE lf.id=NEW.labeling_function_version_id AND lf.status='approved'
      AND (lf.owner_kind='platform' OR lf.workspace_id=NEW.workspace_id)
      AND lf.taxonomy_term_id=NEW.taxonomy_term_id
      AND lf.effective_from<=NEW.created_at
      AND (lf.effective_to IS NULL OR lf.effective_to>NEW.created_at)
  ) THEN RAISE EXCEPTION 'Labeling function authority is invalid.' USING ERRCODE='23514'; END IF;
  IF NEW.resolution_method='model' AND NOT EXISTS(
    SELECT 1 FROM tagging_model_versions model
    WHERE model.id=NEW.model_version_id
      AND model.registry_contract_version='signal-tagging-model-registry-v1'
      AND model.taxonomy_profile_id=NEW.taxonomy_profile_id
  ) THEN RAISE EXCEPTION 'Model assignment requires a registered compatible artifact.' USING ERRCODE='23514'; END IF;
  IF NEW.disposition='approved' AND NEW.resolution_method<>'human' THEN
    SELECT * INTO policy FROM signal_classification_approval_policies
      WHERE id=NEW.approval_policy_id AND workspace_id=NEW.workspace_id
        AND taxonomy_profile_id=NEW.taxonomy_profile_id AND status='approved'
        AND effective_from<=NEW.created_at AND (effective_to IS NULL OR effective_to>NEW.created_at);
    IF policy.id IS NULL OR policy.authority_kind<>NEW.resolution_method
       OR (NEW.resolution_method='labeling_function'
         AND policy.labeling_function_version_id<>NEW.labeling_function_version_id)
       OR (NEW.resolution_method='model' AND policy.model_version_id<>NEW.model_version_id) THEN
      RAISE EXCEPTION 'Approved classification requires matching human or approved policy authority.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.disposition='approved' AND NEW.resolution_method='model' AND (
    SELECT event.status FROM signal_tagging_model_version_events event
    WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=NEW.model_version_id
      AND event.effective_at<=NEW.created_at
    ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1
  ) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Approved model assignment requires an effective approved model version.' USING ERRCODE='23514';
  END IF;
  IF NEW.resolution_method='human'
     AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.decided_by_user_id) THEN
    RAISE EXCEPTION 'Human classification actor is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.disposition<>'approved' AND NEW.approval_policy_id IS NOT NULL THEN
    RAISE EXCEPTION 'Non-approved assignments cannot claim approval authority.' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_assignment_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM signal_classification_assignments prior
    WHERE prior.id=NEW.supersedes_assignment_id AND prior.workspace_id=NEW.workspace_id
      AND prior.canonical_root_id=NEW.canonical_root_id
      AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
  ) THEN RAISE EXCEPTION 'Assignment supersession is incompatible.' USING ERRCODE='23514'; END IF;
  IF generation.input_contract='workspace-topic-classification-v1' THEN
    PERFORM signal_workspace_classification_assignment_authority_v1(NEW,generation,item);
  ELSIF NEW.definition_digest IS NOT NULL OR NEW.correction_operation_id IS NOT NULL OR NEW.source_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_classification_legacy_binding_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- Match the native serving reader's generation choice. Do not fall back to an
-- older generation merely because the most recent one has become stale.
CREATE FUNCTION signal_workspace_selection_serving_generation_v1(target_workspace uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT generation.id FROM signal_classification_generations generation
 JOIN signal_topic_catalog_executions execution ON execution.generation_id=generation.id
  AND execution.workspace_id=generation.workspace_id AND execution.status='ready'
 WHERE generation.workspace_id=target_workspace AND generation.input_contract='workspace-topic-classification-v1'
  AND generation.status='ready'
  AND generation.input_snapshot->'source_projection'->>'contract_version' IN('workspace-topic-projection-v1','workspace-topic-incremental-projection-v1')
  AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item
   WHERE item.generation_id=generation.id AND item.resolution_state='error')
 ORDER BY generation.generation_version DESC,generation.id DESC LIMIT 1
$$;

-- Pending profile copies have no authority over another profile's selection.
-- An in-place archive may invalidate only the currently served binding. Retain
-- the exact active-profile legacy path when no native generation is served.
CREATE OR REPLACE FUNCTION clear_archived_signal_topic_selections_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace uuid; target_taxonomy uuid; target_profile uuid; target_term uuid; changed jsonb;
 current_generation signal_classification_generations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='signal_taxonomy_profiles' THEN
  IF NEW.kind<>'topic' THEN RETURN NEW; END IF;
  target_workspace:=NEW.workspace_id; target_taxonomy:=NEW.taxonomy_id; target_profile:=NEW.id;
 ELSE
  IF NEW.status<>'archived' AND NEW.metadata->'topic'->>'lifecycle' IS DISTINCT FROM 'archived' THEN RETURN NEW; END IF;
  target_term:=NEW.id; target_taxonomy:=NEW.taxonomy_id;
  SELECT workspace_id INTO target_workspace FROM signal_taxonomy_profiles
   WHERE taxonomy_id=target_taxonomy AND kind='topic' ORDER BY version DESC,id DESC LIMIT 1;
 END IF;
 IF target_workspace IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||target_workspace::text||':topic',0));
 PERFORM id FROM signal_workspaces WHERE id=target_workspace FOR UPDATE;
 SELECT * INTO current_generation FROM signal_classification_generations
  WHERE id=signal_workspace_selection_serving_generation_v1(target_workspace);
 IF current_generation.id IS NOT NULL AND ((target_profile IS NOT NULL AND current_generation.taxonomy_profile_id<>target_profile)
  OR NOT signal_workspace_projection_source_current_v1(current_generation)
  OR NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile WHERE profile.id=current_generation.taxonomy_profile_id
   AND profile.workspace_id=target_workspace AND profile.taxonomy_id=target_taxonomy)) THEN RETURN NEW; END IF;
 SELECT jsonb_object_agg(entry.key,entry.value||'{"selected":false}'::jsonb) INTO changed
 FROM signal_workspaces workspace CROSS JOIN LATERAL jsonb_each(workspace.topic_signal_selection->'items') entry
 WHERE workspace.id=target_workspace AND entry.value->>'selected'='true' AND EXISTS(
  SELECT 1 FROM taxonomy_terms term WHERE term.taxonomy_id=target_taxonomy AND term.term_key=entry.key
   AND (target_term IS NULL OR term.id=target_term)
   AND (term.status='archived' OR term.metadata->'topic'->>'lifecycle'='archived')
   AND CASE WHEN current_generation.id IS NOT NULL THEN EXISTS(
    SELECT 1 FROM jsonb_array_elements(current_generation.input_snapshot->'topics') topic
    WHERE topic->>'taxonomy_term_id'=term.id::text AND topic->'definition'->>'term_key'=entry.key
     AND topic->'definition'->>'definition_digest'=entry.value->>'definition_digest'
     AND topic->'definition'->>'definition_revision'=entry.value->>'definition_revision')
   ELSE EXISTS(SELECT 1 FROM signal_classification_generations generation JOIN signal_taxonomy_profiles profile
    ON profile.id=generation.taxonomy_profile_id AND profile.workspace_id=generation.workspace_id
    WHERE generation.id::text=entry.value->>'generation_id' AND generation.workspace_id=target_workspace
     AND generation.input_contract='legacy-classification-v1' AND profile.taxonomy_id=target_taxonomy AND profile.status='active'
     AND (target_profile IS NULL OR profile.id=target_profile)) END);
 IF changed IS NOT NULL THEN UPDATE signal_workspaces SET topic_signal_selection=jsonb_build_object(
  'revision',(topic_signal_selection->>'revision')::bigint+1,'items',(topic_signal_selection->'items')||changed)
  WHERE id=target_workspace; END IF;
 RETURN NEW;
END; $$;

-- Applying an archive writes a durable deselection only after the completed
-- generation becomes the serving choice. Restore never writes selected=true.
CREATE FUNCTION clear_applied_archived_signal_topic_selections_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE generation signal_classification_generations%ROWTYPE; changed jsonb;
BEGIN
 IF NEW.input_contract<>'workspace-topic-classification-v1' OR NEW.status<>'ready'
  OR OLD.status='ready' OR NEW.generation_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||NEW.workspace_id::text||':topic',0));
 PERFORM id FROM signal_workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 IF NEW.generation_id IS DISTINCT FROM signal_workspace_selection_serving_generation_v1(NEW.workspace_id) THEN RETURN NEW; END IF;
 SELECT * INTO generation FROM signal_classification_generations WHERE id=NEW.generation_id
  AND workspace_id=NEW.workspace_id AND taxonomy_profile_id=NEW.taxonomy_profile_id AND status='ready';
 IF generation.id IS NULL OR NOT signal_workspace_projection_source_current_v1(generation) THEN RETURN NEW; END IF;
 SELECT jsonb_object_agg(entry.key,entry.value||'{"selected":false}'::jsonb) INTO changed
 FROM signal_workspaces workspace CROSS JOIN LATERAL jsonb_each(workspace.topic_signal_selection->'items') entry
 WHERE workspace.id=NEW.workspace_id AND entry.value->>'selected'='true'
  AND EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
   WHERE profile.id=generation.taxonomy_profile_id AND profile.workspace_id=NEW.workspace_id
    AND term.term_key=entry.key AND (term.status='archived' OR term.metadata->'topic'->>'lifecycle'='archived'))
  AND EXISTS(SELECT 1 FROM signal_classification_generations selected_generation
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(selected_generation.input_snapshot->'topics')='array'
    THEN selected_generation.input_snapshot->'topics' ELSE '[]'::jsonb END) topic
   WHERE selected_generation.id::text=entry.value->>'generation_id' AND selected_generation.workspace_id=NEW.workspace_id
    AND topic->'definition'->>'term_key'=entry.key
    AND topic->'definition'->>'definition_digest'=entry.value->>'definition_digest'
    AND topic->'definition'->>'definition_revision'=entry.value->>'definition_revision');
 IF changed IS NOT NULL THEN UPDATE signal_workspaces SET topic_signal_selection=jsonb_build_object(
  'revision',(topic_signal_selection->>'revision')::bigint+1,'items',(topic_signal_selection->'items')||changed)
  WHERE id=NEW.workspace_id; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER clear_applied_archived_signal_topic_selections_v1 AFTER UPDATE OF status ON signal_topic_catalog_executions
 FOR EACH ROW WHEN (NEW.status='ready' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION clear_applied_archived_signal_topic_selections_v1();
REVOKE ALL ON FUNCTION signal_workspace_selection_serving_generation_v1(uuid),clear_applied_archived_signal_topic_selections_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
  EXECUTE format('REVOKE ALL ON FUNCTION signal_workspace_selection_serving_generation_v1(uuid),clear_applied_archived_signal_topic_selections_v1() FROM %I',role_name);
 END IF; END LOOP;
END $$;
