-- Provider-free numerical continuation on existing engine/artifact/model ledgers.
-- Editorial receipts, source fits and projections keep their original contracts.
DROP INDEX uq_signal_topic_catalog_execution_active_profile;
CREATE UNIQUE INDEX uq_signal_topic_catalog_execution_active_profile
 ON signal_topic_catalog_executions(taxonomy_profile_id,intent,(COALESCE(input_snapshot ? 'numeric_descriptor',false)))
 WHERE status IN('queued','running');
CREATE FUNCTION signal_workspace_incremental_correction_epoch_v1(target_workspace uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
  jsonb_build_array(term_key,canonical_root_id,correction_operation_id,root_fingerprint,definition_digest,context_digest)::text,
  '' ORDER BY canonical_root_id,term_key),''),'UTF8')),'hex') FROM signal_topic_membership_overrides
 WHERE workspace_id=target_workspace AND origin_input_contract='workspace-topic-classification-v1'
$$;

CREATE FUNCTION signal_workspace_incremental_origin_current_v1(target_execution uuid,target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
  JOIN signal_corpus_preparation_runs prep ON prep.id=execution.preparation_run_id AND prep.workspace_id=execution.workspace_id
  WHERE execution.id=target_execution AND execution.workspace_id=target_workspace AND execution.input_contract='workspace-topic-engine-v1'
   AND execution.status IN('running','failed','ready') AND (execution.result_summary ? 'fit_checkpoint' OR execution.result_summary ? 'numeric_checkpoint')
   AND execution.processed_roots=execution.denominator AND execution.processed_chunks=execution.expected_chunks
   AND signal_workspace_classification_actor_v1(target_workspace,execution.actor_user_id)
   AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>statement_timestamp())
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prep.accepted_imports) source WHERE source->>'authorized'='true' AND NOT EXISTS(
    SELECT 1 FROM data_sources data_source JOIN signal_provenance_policy_bindings binding ON binding.workspace_id=data_source.workspace_id
     AND binding.data_source_id=data_source.id AND binding.id=(source->'binding'->>'id')::uuid
    JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=binding.workspace_id
    JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=binding.workspace_id
    WHERE data_source.workspace_id=target_workspace AND data_source.id=(source->>'data_source_id')::uuid AND data_source.status='active'
     AND binding.status='active' AND binding.effective_from<=statement_timestamp() AND (binding.effective_to IS NULL OR binding.effective_to>statement_timestamp())
     AND retention.status='active' AND retention.effective_from<=statement_timestamp() AND (retention.effective_to IS NULL OR retention.effective_to>statement_timestamp())
     AND retention.retention_state='allowed' AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>statement_timestamp())
     AND license.status='active' AND license.effective_from<=statement_timestamp() AND (license.effective_to IS NULL OR license.effective_to>statement_timestamp())
     AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=target_workspace AND usage.licensing_policy_id=license.id
      AND usage.usage_purpose='llm-processing' AND usage.decision='allowed')
     AND NOT EXISTS(SELECT 1 FROM signal_provenance_policy_bindings newer WHERE newer.workspace_id=target_workspace AND newer.data_source_id=data_source.id
      AND newer.status='active' AND newer.effective_from<=statement_timestamp() AND (newer.effective_to IS NULL OR newer.effective_to>statement_timestamp())
      AND (newer.import_batch_id=(source->>'import_batch_id')::uuid OR newer.import_batch_id IS NULL)
      AND ((newer.import_batch_id IS NOT NULL)::int,newer.binding_version,newer.id)>((binding.import_batch_id IS NOT NULL)::int,binding.binding_version,binding.id))
   ))),false)
$$;

CREATE FUNCTION signal_workspace_incremental_model_current_v1(target_artifact uuid,target_model uuid,target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM analysis_artifacts artifact
  JOIN signal_topic_catalog_executions origin ON origin.id=artifact.engine_execution_id AND origin.workspace_id=artifact.workspace_id
  JOIN tagging_model_versions model ON model.id=target_model AND model.configuration->>'execution_id'=origin.id::text
  JOIN analysis_artifacts bank ON bank.id::text=model.configuration->>'model_artifact_id' AND bank.engine_execution_id=origin.id AND bank.workspace_id=origin.workspace_id
  WHERE artifact.id=target_artifact AND artifact.workspace_id=target_workspace AND artifact.artifact_type='engine_model'
   AND bank.content->>'sha256'=model.artifact_digest AND model.registry_contract_version='signal-tagging-model-registry-v1'
   AND target_model::text=COALESCE(origin.result_summary->'numeric_checkpoint'->>'model_version_id',origin.result_summary->'fit_checkpoint'->>'model_version_id')
   AND COALESCE((SELECT event.status FROM signal_tagging_model_version_events event WHERE event.model_version_id=model.id
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1),'draft')<>'retired'
   AND signal_workspace_incremental_origin_current_v1(origin.id,target_workspace)),false)
$$;

CREATE FUNCTION signal_workspace_incremental_parent_current_v1(target_execution uuid,target_workspace uuid,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions parent
  JOIN analysis_artifacts output ON output.id::text=COALESCE(parent.result_summary->'numeric_checkpoint'->>'output_artifact_id',parent.result_summary->'fit_checkpoint'->>'output_artifact_id')
   AND output.engine_execution_id=parent.id AND output.workspace_id=parent.workspace_id AND output.artifact_type='engine_output'
  WHERE parent.id=target_execution AND parent.workspace_id=target_workspace
   AND (NOT parent.input_snapshot ? 'numeric_descriptor' OR parent.status='ready')
   AND signal_workspace_classification_actor_v1(target_workspace,target_actor)
   AND signal_workspace_incremental_origin_current_v1(parent.id,target_workspace)
   AND (COALESCE(parent.result_summary->'numeric_checkpoint'->>'model_version_id',parent.result_summary->'fit_checkpoint'->>'model_version_id') IS NULL
    OR signal_workspace_incremental_model_current_v1(
      COALESCE(parent.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id',parent.result_summary->'fit_checkpoint'->>'model_artifact_id')::uuid,
      COALESCE(parent.result_summary->'numeric_checkpoint'->>'model_version_id',parent.result_summary->'fit_checkpoint'->>'model_version_id')::uuid,target_workspace))
   AND NOT EXISTS(SELECT 1 FROM analysis_artifacts component WHERE component.engine_execution_id=parent.id AND component.workspace_id=target_workspace
    AND component.metadata->>'contract_version'='workspace-incremental-component-v1'
    AND NOT signal_workspace_incremental_model_current_v1((component.metadata->>'origin_model_artifact_id')::uuid,(component.metadata->>'origin_registry_id')::uuid,target_workspace))),false)
$$;

CREATE FUNCTION signal_workspace_incremental_execution_current_v1(target_execution uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions child WHERE child.id=target_execution
  AND child.input_snapshot ? 'numeric_descriptor'
  AND child.input_snapshot->'numeric_descriptor'->>'root_correction_epoch'=signal_workspace_incremental_correction_epoch_v1(child.workspace_id)
  AND signal_workspace_incremental_parent_current_v1((child.input_snapshot->'numeric_descriptor'->'parent'->>'execution_id')::uuid,child.workspace_id,child.actor_user_id)),false)
$$;

CREATE FUNCTION signal_workspace_incremental_editorial_at_v1(target_parent uuid,target_workspace uuid,target_time timestamptz)
RETURNS TABLE(unit_count bigint,unit_digest text) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT count(*),'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(unit.key)::text||E'\n','' ORDER BY unit.key COLLATE "C"),''),'UTF8')),'hex')
 FROM analysis_artifacts artifact
 CROSS JOIN LATERAL jsonb_array_elements_text(artifact.metadata->'unit_keys') unit(key)
 WHERE artifact.engine_execution_id=target_parent AND artifact.workspace_id=target_workspace AND artifact.created_at<=target_time
  AND artifact.artifact_type='engine_proposals'
  AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
$$;
CREATE FUNCTION signal_workspace_incremental_editorial_cut_v1(target_parent uuid,target_child uuid)
RETURNS TABLE(unit_count bigint,unit_digest text) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT coverage.* FROM signal_topic_catalog_executions child
 CROSS JOIN LATERAL signal_workspace_incremental_editorial_at_v1(target_parent,child.workspace_id,child.created_at) coverage
 WHERE child.id=target_child
$$;

CREATE FUNCTION guard_workspace_incremental_artifact_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; descriptor jsonb; artifact_metadata jsonb; model analysis_artifacts%ROWTYPE; origin analysis_artifacts%ROWTYPE; parent_component analysis_artifacts%ROWTYPE;
BEGIN
 IF NEW.engine_execution_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id;
 descriptor:=execution.input_snapshot->'numeric_descriptor';IF descriptor IS NULL THEN RETURN NEW; END IF;
 artifact_metadata:=NEW.metadata;
 IF NEW.artifact_type='engine_proposals' OR execution.input_snapshot ? 'interpretation_config' THEN
  RAISE EXCEPTION 'workspace_engine_incremental_numeric_only' USING ERRCODE='23514'; END IF;
 IF artifact_metadata->>'contract_version'='workspace-incremental-input-checkpoint-v1' THEN
  IF NOT COALESCE(NEW.artifact_key='incremental-input.json' AND NEW.artifact_type='engine_output'
   AND artifact_metadata->>'descriptor_digest'=descriptor->>'descriptor_digest' AND artifact_metadata->>'input_digest'=execution.input_digest
   AND (artifact_metadata->>'roots_count')::bigint=execution.denominator AND (artifact_metadata->>'chunks_count')::bigint=execution.expected_chunks
   AND artifact_metadata->'input'->>'contract_version'='workspace-topic-incremental-input-v1'
   AND artifact_metadata->'input'->>'execution_id'=execution.id::text AND artifact_metadata->'input'->>'workspace_id'=execution.workspace_id::text
   AND artifact_metadata->'input'->'compatibility'=descriptor->'compatibility'
   AND artifact_metadata->'input'->'parent'->>'execution_id'=descriptor->'parent'->>'execution_id'
   AND artifact_metadata->'input'->'parent'->>'manifest_sha256'=descriptor->'parent'->>'manifest_sha256'
   AND artifact_metadata->'input'->'discovery'->'close_requested'=descriptor->'discovery'->'close_requested'
   AND artifact_metadata->'input'->'discovery'->>'cohort_key'~'^sha256:[0-9a-f]{64}$'
   AND jsonb_typeof(artifact_metadata->'input_files')='array' AND jsonb_array_length(artifact_metadata->'input_files')=6
   AND (SELECT count(DISTINCT file->>'name') FROM jsonb_array_elements(artifact_metadata->'input_files') file)=6
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(artifact_metadata->'input_files') file WHERE NOT COALESCE(
    file->>'name' IN('manifest.json','chunks.jsonl','vectors.npy','guides.jsonl','guide-vectors.npy','current-roots.jsonl')
    AND file->>'storage_key' LIKE 'workspace-engine/'||execution.workspace_id::text||'/'||execution.id::text||'/%'
    AND position('..' in file->>'storage_key')=0 AND file->>'sha256'~'^sha256:[0-9a-f]{64}$'
    AND (file->>'size_bytes')::bigint>=0 AND length(file->>'media_type') BETWEEN 1 AND 120,false))
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(artifact_metadata->'input_files') file WHERE file->>'name'='manifest.json'
    AND file->>'sha256'=artifact_metadata->'input'->'current_input_manifest'->>'sha256'
    AND (file->>'size_bytes')::bigint=(artifact_metadata->'input'->'current_input_manifest'->>'bytes')::bigint)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(artifact_metadata->'input_files') file WHERE file->>'name'='current-roots.jsonl'
    AND file->>'sha256'=artifact_metadata->'input'->'current_roots'->>'sha256'
    AND (file->>'size_bytes')::bigint=(artifact_metadata->'input'->'current_roots'->>'bytes')::bigint),false) THEN
    RAISE EXCEPTION 'workspace_engine_incremental_input_invalid' USING ERRCODE='23514'; END IF;
 ELSIF artifact_metadata->>'contract_version'='workspace-incremental-output-index-v1' THEN
  IF NOT COALESCE(NEW.artifact_key='incremental-output-index.json' AND NEW.artifact_type='engine_output'
   AND artifact_metadata->>'descriptor_digest'=descriptor->>'descriptor_digest'
   AND artifact_metadata->>'input_artifact_id'=execution.result_summary->>'numeric_input_artifact_id'
   AND artifact_metadata->'output_manifest'->>'sha256'~'^sha256:[0-9a-f]{64}$'
   AND (artifact_metadata->'output_manifest'->>'size_bytes')::bigint>0 AND (artifact_metadata->>'file_count')::bigint>0,false) THEN
    RAISE EXCEPTION 'workspace_engine_incremental_output_index_invalid' USING ERRCODE='23514'; END IF;
 ELSIF artifact_metadata->>'contract_version'='workspace-incremental-history-v1' THEN
  IF NEW.artifact_key<>'incremental-history.json' OR NEW.artifact_type<>'engine_output'
   OR artifact_metadata->>'parent_execution_id' IS DISTINCT FROM descriptor->'parent'->>'execution_id'
   OR artifact_metadata->>'parent_manifest_sha256' IS DISTINCT FROM descriptor->'parent'->>'manifest_sha256'
   OR NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions parent
    CROSS JOIN LATERAL signal_workspace_incremental_editorial_cut_v1(parent.id,execution.id) coverage
    WHERE parent.id=(descriptor->'parent'->>'execution_id')::uuid AND parent.workspace_id=execution.workspace_id
     AND artifact_metadata->>'parent_history_artifact_id' IS NOT DISTINCT FROM parent.result_summary->'numeric_checkpoint'->>'history_artifact_id'
     AND (artifact_metadata->>'parent_paid_units')::bigint=coverage.unit_count AND artifact_metadata->>'parent_paid_unit_digest'=coverage.unit_digest
     AND coverage.unit_count=(descriptor->'editorial_cut'->>'unit_count')::bigint
     AND coverage.unit_digest=descriptor->'editorial_cut'->>'unit_digest')
   OR NOT EXISTS(SELECT 1 FROM analysis_artifacts relations WHERE relations.id=(artifact_metadata->>'relations_artifact_id')::uuid
    AND relations.workspace_id=execution.workspace_id AND relations.engine_execution_id=execution.id AND relations.artifact_key='relations.json') THEN
   RAISE EXCEPTION 'workspace_engine_incremental_history_invalid' USING ERRCODE='23514'; END IF;
 ELSIF artifact_metadata->>'contract_version'='workspace-incremental-component-v1' THEN
  SELECT * INTO model FROM analysis_artifacts WHERE id=(artifact_metadata->>'model_artifact_id')::uuid AND workspace_id=execution.workspace_id AND engine_execution_id=execution.id;
  SELECT * INTO origin FROM analysis_artifacts WHERE id=(artifact_metadata->>'origin_model_artifact_id')::uuid AND workspace_id=execution.workspace_id;
  IF NOT COALESCE(NEW.artifact_type='engine_model' AND model.artifact_type='engine_model' AND origin.artifact_type='engine_model'
   AND NEW.content=model.content AND origin.content->>'sha256'=model.content->>'sha256'
   AND artifact_metadata->>'descriptor_digest'=descriptor->>'descriptor_digest' AND (artifact_metadata->>'unit_count')::bigint>=0
   AND artifact_metadata->>'unit_digest'~'^sha256:[0-9a-f]{64}$'
   AND artifact_metadata->>'lane' IN('open','guided')
   AND artifact_metadata->'model_origin'->>'execution_id'=origin.engine_execution_id::text
   AND artifact_metadata->'model_origin'->>'model_artifact_sha256'=origin.content->>'sha256'
   AND artifact_metadata->>'component_key'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_array(
    origin.engine_execution_id::text,origin.content->>'sha256',artifact_metadata->>'lane')),'UTF8')),'hex')
   AND NEW.artifact_key='component-'||substring(artifact_metadata->>'component_key' from 8)
   AND ((artifact_metadata->>'lane'='open' AND artifact_metadata->>'center_artifact_id' IS NULL) OR (artifact_metadata->>'lane'='guided' AND EXISTS(
     SELECT 1 FROM analysis_artifacts center WHERE center.id=(artifact_metadata->>'center_artifact_id')::uuid AND center.workspace_id=execution.workspace_id AND center.engine_execution_id=execution.id)))
   AND EXISTS(SELECT 1 FROM tagging_model_versions bank WHERE bank.id=(artifact_metadata->>'bank_registry_id')::uuid
    AND bank.configuration->>'execution_id'=execution.id::text AND bank.configuration->>'numeric_contract'='workspace-incremental-model-bank-v1'),false) THEN
   RAISE EXCEPTION 'workspace_engine_incremental_component_invalid' USING ERRCODE='23514'; END IF;
  IF origin.engine_execution_id=execution.id THEN
   IF artifact_metadata->>'origin_model_artifact_id' IS DISTINCT FROM artifact_metadata->>'model_artifact_id'
    OR artifact_metadata->>'origin_registry_id' IS DISTINCT FROM artifact_metadata->>'bank_registry_id'
    OR artifact_metadata->>'parent_component_artifact_id' IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_engine_incremental_component_origin_invalid' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT signal_workspace_incremental_model_current_v1(origin.id,(artifact_metadata->>'origin_registry_id')::uuid,execution.workspace_id) THEN
    RAISE EXCEPTION 'workspace_engine_incremental_component_origin_invalid' USING ERRCODE='23514'; END IF;
   IF descriptor->'parent'->>'manifest_contract'='workspace-topic-engine-output-v1' THEN
    IF origin.engine_execution_id::text IS DISTINCT FROM descriptor->'parent'->>'execution_id'
     OR artifact_metadata->>'origin_registry_id' IS DISTINCT FROM descriptor->'parent'->>'model_version_id'
     OR artifact_metadata->>'parent_component_artifact_id' IS NOT NULL
     OR (artifact_metadata->>'lane'='guided' AND NOT EXISTS(SELECT 1 FROM analysis_artifacts center JOIN analysis_artifacts prior_center
       ON prior_center.workspace_id=center.workspace_id AND prior_center.engine_execution_id=origin.engine_execution_id
        AND prior_center.metadata->>'filename'=prior_center.artifact_key
        AND prior_center.content->>'sha256'=center.content->>'sha256' AND prior_center.content->>'size_bytes'=center.content->>'size_bytes'
       WHERE center.id=(artifact_metadata->>'center_artifact_id')::uuid)) THEN
     RAISE EXCEPTION 'workspace_engine_incremental_component_parent_invalid' USING ERRCODE='23514'; END IF;
   ELSE
    SELECT * INTO parent_component FROM analysis_artifacts WHERE id=(artifact_metadata->>'parent_component_artifact_id')::uuid
     AND workspace_id=execution.workspace_id AND engine_execution_id=(descriptor->'parent'->>'execution_id')::uuid;
    IF parent_component.id IS NULL OR parent_component.metadata->>'contract_version'<>'workspace-incremental-component-v1'
     OR (parent_component.metadata-ARRAY['model_artifact_id','center_artifact_id','descriptor_digest','parent_component_artifact_id','bank_registry_id'])
      IS DISTINCT FROM (artifact_metadata-ARRAY['model_artifact_id','center_artifact_id','descriptor_digest','parent_component_artifact_id','bank_registry_id'])
     OR (artifact_metadata->>'lane'='guided' AND NOT EXISTS(SELECT 1 FROM analysis_artifacts center JOIN analysis_artifacts prior_center
       ON prior_center.workspace_id=center.workspace_id AND prior_center.id=(parent_component.metadata->>'center_artifact_id')::uuid
        AND prior_center.content->>'sha256'=center.content->>'sha256' AND prior_center.content->>'size_bytes'=center.content->>'size_bytes'
       WHERE center.id=(artifact_metadata->>'center_artifact_id')::uuid)) THEN
     RAISE EXCEPTION 'workspace_engine_incremental_component_parent_invalid' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_incremental_artifact BEFORE INSERT ON analysis_artifacts FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_artifact_v1();

CREATE FUNCTION guard_workspace_incremental_execution_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE descriptor jsonb; checkpoint jsonb; prior jsonb; output analysis_artifacts%ROWTYPE; inventory analysis_artifacts%ROWTYPE; component_count bigint; component_digest text;
BEGIN
 IF NEW.input_contract<>'workspace-topic-engine-v1' OR NOT NEW.input_snapshot ? 'numeric_descriptor' THEN RETURN NEW; END IF;
 descriptor:=NEW.input_snapshot->'numeric_descriptor';checkpoint:=NEW.result_summary->'numeric_checkpoint';
 IF NOT COALESCE(descriptor->>'contract_version'='workspace-incremental-numeric-descriptor-v1'
  AND descriptor->>'policy_version'='workspace-frozen-model-cohort-v1' AND descriptor->>'mode'='frozen-model-delta'
  AND jsonb_typeof(descriptor->'discovery'->'close_requested')='boolean'
  AND descriptor->>'descriptor_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(descriptor-'descriptor_digest'),'UTF8')),'hex')
  AND descriptor->>'root_correction_epoch'~'^sha256:[0-9a-f]{64}$'
  AND (descriptor->'editorial_cut'->>'unit_count')::bigint>=0 AND descriptor->'editorial_cut'->>'unit_digest'~'^sha256:[0-9a-f]{64}$'
  AND descriptor->'parent'->>'execution_id'=NEW.input_snapshot->>'parent_execution_id'
  AND descriptor->'parent'->>'manifest_contract' IN('workspace-topic-engine-output-v1','workspace-topic-incremental-output-v1')
  AND descriptor->'compatibility'->>'embedding_config_digest'=NEW.embedding_config_digest
  AND descriptor->'compatibility'->>'context_digest'=NEW.input_snapshot->>'context_digest'
  AND descriptor->'compatibility'->>'input_interest_catalog_digest'=NEW.input_snapshot->>'catalog_digest'
  AND descriptor->'compatibility'->>'chunk_policy_version'='corpus-text-chunks-v1'
  AND descriptor->'compatibility'->>'fit_config_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(NEW.input_snapshot->'engine_config'),'UTF8')),'hex')
  AND descriptor->'compatibility'->>'guides_digest'~'^sha256:[0-9a-f]{64}$'
  AND descriptor->'compatibility'->>'runtime_digest'~'^sha256:[0-9a-f]{64}$'
  AND (NEW.input_snapshot->>'claude_cap_micro_usd')::bigint=0 AND NOT NEW.input_snapshot ? 'interpretation_config'
  AND NOT NEW.result_summary ?| ARRAY['fit_checkpoint','analysis_checkpoint','materialization_progress'] AND NEW.interpretation_revision IS NULL,false) THEN
  RAISE EXCEPTION 'workspace_engine_incremental_descriptor_invalid' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF descriptor->>'root_correction_epoch' IS DISTINCT FROM signal_workspace_incremental_correction_epoch_v1(NEW.workspace_id)
   OR EXISTS(SELECT 1 FROM signal_topic_catalog_executions active WHERE active.taxonomy_profile_id=NEW.taxonomy_profile_id
    AND active.status IN('queued','running') AND active.id<>(descriptor->'parent'->>'execution_id')::uuid)
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_incremental_editorial_at_v1((descriptor->'parent'->>'execution_id')::uuid,NEW.workspace_id,NEW.created_at) coverage
    WHERE coverage.unit_count=(descriptor->'editorial_cut'->>'unit_count')::bigint AND coverage.unit_digest=descriptor->'editorial_cut'->>'unit_digest')
   OR NOT signal_workspace_incremental_parent_current_v1((descriptor->'parent'->>'execution_id')::uuid,NEW.workspace_id,NEW.actor_user_id)
   OR NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions parent JOIN analysis_artifacts artifact
     ON artifact.id=(descriptor->'parent'->>'output_artifact_id')::uuid AND artifact.engine_execution_id=parent.id AND artifact.workspace_id=parent.workspace_id
    WHERE parent.id=(descriptor->'parent'->>'execution_id')::uuid AND parent.workspace_id=NEW.workspace_id
     AND artifact.content->>'sha256'=descriptor->'parent'->>'manifest_sha256'
     AND COALESCE(parent.result_summary->'numeric_checkpoint'->>'checkpoint_digest',parent.result_summary->'fit_checkpoint'->>'checkpoint_digest')=descriptor->'parent'->>'checkpoint_digest'
     AND COALESCE(parent.result_summary->'numeric_checkpoint'->>'model_version_id',parent.result_summary->'fit_checkpoint'->>'model_version_id') IS NOT DISTINCT FROM descriptor->'parent'->>'model_version_id') THEN
   RAISE EXCEPTION 'workspace_engine_incremental_parent_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.result_summary ? 'numeric_input_artifact_id' AND OLD.result_summary->'numeric_input_artifact_id' IS DISTINCT FROM NEW.result_summary->'numeric_input_artifact_id'
   OR OLD.result_summary ? 'numeric_checkpoint' AND OLD.result_summary->'numeric_checkpoint' IS DISTINCT FROM checkpoint THEN
   RAISE EXCEPTION 'workspace_engine_incremental_checkpoint_immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.result_summary ? 'numeric_input_artifact_id' AND NOT EXISTS(SELECT 1 FROM analysis_artifacts input WHERE input.id::text=NEW.result_summary->>'numeric_input_artifact_id'
  AND input.workspace_id=NEW.workspace_id AND input.engine_execution_id=NEW.id AND input.metadata->>'contract_version'='workspace-incremental-input-checkpoint-v1') THEN
  RAISE EXCEPTION 'workspace_engine_incremental_input_checkpoint_invalid' USING ERRCODE='23514'; END IF;
 IF checkpoint IS NOT NULL THEN
  SELECT * INTO output FROM analysis_artifacts WHERE id=(checkpoint->>'output_artifact_id')::uuid AND workspace_id=NEW.workspace_id AND engine_execution_id=NEW.id;
  SELECT * INTO inventory FROM analysis_artifacts WHERE id=(checkpoint->>'output_index_artifact_id')::uuid AND workspace_id=NEW.workspace_id AND engine_execution_id=NEW.id;
  SELECT count(*),'sha256:'||encode(sha256(convert_to('['||COALESCE(string_agg(signal_semantic_context_canonical_json_v1(jsonb_build_array(
   metadata->>'component_key',metadata->>'lane',metadata->'model_origin',(metadata->>'unit_count')::bigint,metadata->>'unit_digest')),
   ',' ORDER BY metadata->>'component_key'),'')||']','UTF8')),'hex') INTO component_count,component_digest
   FROM analysis_artifacts WHERE engine_execution_id=NEW.id AND workspace_id=NEW.workspace_id AND metadata->>'contract_version'='workspace-incremental-component-v1';
  IF NOT COALESCE(checkpoint->>'contract_version'='workspace-incremental-numeric-checkpoint-v1'
   AND checkpoint->>'checkpoint_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(checkpoint-'checkpoint_digest'),'UTF8')),'hex')
   AND checkpoint->>'descriptor_digest'=descriptor->>'descriptor_digest'
   AND checkpoint->>'input_artifact_id'=NEW.result_summary->>'numeric_input_artifact_id'
   AND checkpoint->>'population_digest'~'^sha256:[0-9a-f]{64}$'
   AND (checkpoint->>'roots')::bigint=NEW.denominator AND (checkpoint->>'occurrences')::bigint=NEW.expected_chunks
   AND NEW.processed_roots=NEW.denominator AND NEW.processed_chunks=NEW.expected_chunks
   AND checkpoint->>'numeric_complete'='true' AND checkpoint->>'analysis_complete'='false'
   AND checkpoint->>'relations_status' IN('pending','none')
   AND checkpoint->>'discovery_status' IN('complete','pending_insufficient_population','pending_cohort_close')
   AND output.artifact_type='engine_output' AND output.artifact_key='manifest.json'
   AND inventory.metadata->>'contract_version'='workspace-incremental-output-index-v1'
   AND inventory.metadata->>'input_artifact_id'=checkpoint->>'input_artifact_id'
   AND inventory.metadata->'output_manifest'->>'sha256'=output.content->>'sha256'
   AND inventory.metadata->'output_manifest'->>'size_bytes'=output.content->>'size_bytes'
   AND (inventory.metadata->>'file_count')::bigint=(SELECT count(*) FROM analysis_artifacts file WHERE file.engine_execution_id=NEW.id
    AND file.workspace_id=NEW.workspace_id AND (file.metadata->>'filename'=file.artifact_key OR file.id=(checkpoint->>'history_artifact_id')::uuid))
   AND (checkpoint->>'components')::bigint=component_count AND checkpoint->>'component_digest'=component_digest
   AND (checkpoint->>'model_bank_bytes')::bigint BETWEEN 0 AND 4294967296
   AND EXISTS(SELECT 1 FROM analysis_artifacts history WHERE history.id=(checkpoint->>'history_artifact_id')::uuid AND history.workspace_id=NEW.workspace_id
    AND history.engine_execution_id=NEW.id AND history.metadata->>'contract_version'='workspace-incremental-history-v1'
    AND history.metadata->>'parent_execution_id'=descriptor->'parent'->>'execution_id'
    AND history.metadata->>'parent_manifest_sha256'=descriptor->'parent'->>'manifest_sha256'
    AND history.metadata->>'parent_paid_units'=descriptor->'editorial_cut'->>'unit_count'
    AND history.metadata->>'parent_paid_unit_digest'=descriptor->'editorial_cut'->>'unit_digest')
   AND ((component_count=0 AND checkpoint->>'model_version_id' IS NULL AND checkpoint->>'model_bank_artifact_id' IS NULL)
    OR(component_count>0 AND EXISTS(SELECT 1 FROM tagging_model_versions bank JOIN analysis_artifacts artifact ON artifact.id=(checkpoint->>'model_bank_artifact_id')::uuid
      AND artifact.workspace_id=NEW.workspace_id AND artifact.engine_execution_id=NEW.id AND artifact.artifact_type='engine_model'
     WHERE bank.id=(checkpoint->>'model_version_id')::uuid AND bank.configuration->>'execution_id'=NEW.id::text
      AND bank.configuration->>'numeric_contract'='workspace-incremental-model-bank-v1' AND bank.artifact_digest=artifact.content->>'sha256'))),false) THEN
   RAISE EXCEPTION 'workspace_engine_incremental_checkpoint_invalid' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM analysis_artifacts component WHERE component.engine_execution_id=NEW.id AND component.workspace_id=NEW.workspace_id
   AND component.metadata->>'contract_version'='workspace-incremental-component-v1'
   AND component.metadata->'model_origin'->>'execution_id'<>NEW.id::text
   AND NOT signal_workspace_incremental_model_current_v1((component.metadata->>'origin_model_artifact_id')::uuid,(component.metadata->>'origin_registry_id')::uuid,NEW.workspace_id)) THEN
   RAISE EXCEPTION 'workspace_engine_incremental_component_authority_changed' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='ready' AND (checkpoint IS NULL OR NEW.result_summary->>'result_kind' IS DISTINCT FROM 'incremental_numeric'
  OR NEW.result_summary->>'numeric_complete' IS DISTINCT FROM 'true' OR NEW.result_summary->>'analysis_complete' IS DISTINCT FROM 'false'
  OR NEW.completed_at IS NULL OR NEW.execution_token IS NOT NULL OR NEW.execution_expires_at IS NOT NULL
  OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=NEW.id)) THEN
  RAISE EXCEPTION 'workspace_engine_incremental_numeric_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_incremental_execution BEFORE INSERT OR UPDATE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_execution_v1();

CREATE FUNCTION guard_workspace_incremental_registry_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.configuration->>'numeric_contract' IS DISTINCT FROM 'workspace-incremental-model-bank-v1' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
  JOIN analysis_artifacts model ON model.id=(NEW.configuration->>'model_artifact_id')::uuid AND model.engine_execution_id=execution.id AND model.workspace_id=execution.workspace_id
  JOIN analysis_artifacts output ON output.id=(NEW.configuration->>'output_artifact_id')::uuid AND output.engine_execution_id=execution.id AND output.workspace_id=execution.workspace_id
  JOIN analysis_artifacts inventory ON inventory.engine_execution_id=execution.id AND inventory.workspace_id=execution.workspace_id AND inventory.artifact_key='incremental-output-index.json'
  WHERE execution.id::text=NEW.configuration->>'execution_id' AND execution.input_snapshot ? 'numeric_descriptor'
   AND execution.status='running' AND execution.execution_expires_at>clock_timestamp()
   AND NEW.configuration->>'descriptor_digest'=execution.input_snapshot->'numeric_descriptor'->>'descriptor_digest'
   AND NEW.configuration->>'input_digest'=execution.input_digest AND NEW.configuration->>'approval_policy'='none'
   AND NEW.configuration->'compatibility'=execution.input_snapshot->'numeric_descriptor'->'compatibility'
   AND NEW.model_key='workspace-incremental:'||execution.workspace_id::text AND NEW.version=execution.id::text
   AND NEW.artifact_format='workspace-incremental-model-bank-v1' AND NEW.runtime_kind='python'
   AND NEW.supersedes_model_version_id IS NULL AND model.artifact_type='engine_model' AND model.artifact_key='model-manifest.json'
   AND model.content->>'sha256'=NEW.artifact_digest AND output.artifact_key='manifest.json' AND output.artifact_type='engine_output'
   AND inventory.metadata->'output_manifest'->>'sha256'=output.content->>'sha256'
   AND signal_workspace_incremental_execution_current_v1(execution.id)) THEN
  RAISE EXCEPTION 'workspace_engine_incremental_bank_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_incremental_registry BEFORE INSERT ON tagging_model_versions FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_registry_v1();

CREATE FUNCTION guard_workspace_incremental_provider_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.catalog_execution_id IS NOT NULL AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
  WHERE execution.id=NEW.catalog_execution_id AND execution.input_snapshot ? 'numeric_descriptor') THEN
  RAISE EXCEPTION 'workspace_engine_incremental_numeric_only' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_incremental_provider BEFORE INSERT ON engine_cost_events FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_provider_v1();

-- Preserve the original immutable execution guard; numeric-ready uses the separate strict guard above.
CREATE OR REPLACE FUNCTION guard_signal_workspace_engine_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE embedded signal_workspace_embedding_runs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.input_contract='workspace-topic-engine-v1' THEN RAISE EXCEPTION 'Engine history is retained.' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.input_contract<>'workspace-topic-engine-v1' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.workspace_id,NEW.actor_user_id,NEW.taxonomy_profile_id,NEW.embedding_run_id,NEW.preparation_run_id,
    NEW.input_revision,NEW.embedding_config_digest,NEW.input_snapshot,NEW.input_digest,NEW.policy_valid_until,
    NEW.request_digest,NEW.idempotency_key,NEW.population_digest,NEW.identity_catalog_digest,NEW.definition_digest,
    NEW.denominator,NEW.expected_chunks,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.actor_user_id,OLD.taxonomy_profile_id,OLD.embedding_run_id,OLD.preparation_run_id,
    OLD.input_revision,OLD.embedding_config_digest,OLD.input_snapshot,OLD.input_digest,OLD.policy_valid_until,
    OLD.request_digest,OLD.idempotency_key,OLD.population_digest,OLD.identity_catalog_digest,OLD.definition_digest,
    OLD.denominator,OLD.expected_chunks,OLD.created_at) THEN
   RAISE EXCEPTION 'Engine snapshot is immutable.' USING ERRCODE='23514'; END IF;
  IF NOT OLD.engine_request_keys <@ NEW.engine_request_keys THEN
   RAISE EXCEPTION 'Engine request keys are append-only.' USING ERRCODE='23514'; END IF;
  IF OLD.status='ready' AND (to_jsonb(NEW)-'engine_request_keys') IS DISTINCT FROM (to_jsonb(OLD)-'engine_request_keys') THEN
   RAISE EXCEPTION 'Complete engine evidence is immutable.' USING ERRCODE='55000'; END IF;
 ELSE
  SELECT * INTO embedded FROM signal_workspace_embedding_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.embedding_run_id;
  IF embedded.id IS NULL OR embedded.input_contract<>'corpus' OR embedded.status<>'completed'
   OR embedded.preparation_run_id<>NEW.preparation_run_id OR embedded.input_revision<>NEW.input_revision
   OR embedded.config_digest<>NEW.embedding_config_digest OR embedded.policy_valid_until IS DISTINCT FROM NEW.policy_valid_until
   OR NEW.denominator<>(embedded.counts->>'eligible_roots')::bigint
   OR NEW.expected_chunks<>(embedded.counts->>'total_chunk_references')::bigint
   OR NEW.status<>'queued' OR NEW.processed_roots<>0 OR NEW.processed_chunks<>0
   OR NEW.input_digest<>'sha256:'||encode(sha256(convert_to(NEW.input_snapshot::text,'UTF8')),'hex')
   OR NOT COALESCE(NEW.input_snapshot->>'contract_version'='workspace-topic-engine-v1'
     AND NEW.input_snapshot->>'workspace_id'=NEW.workspace_id::text
     AND NEW.input_snapshot->>'taxonomy_profile_id'=NEW.taxonomy_profile_id::text
     AND NEW.input_snapshot->'embedding_profile'=embedded.profile
     AND jsonb_typeof(NEW.input_snapshot->'guides')='array'
     AND jsonb_typeof(NEW.engine_request_keys)='object',false) THEN
   RAISE EXCEPTION 'Engine input authority is invalid.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='ready' AND NOT NEW.input_snapshot ? 'numeric_descriptor' AND (NEW.processed_roots<>NEW.denominator OR NEW.processed_chunks<>NEW.expected_chunks
  OR NEW.completed_at IS NULL OR NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact
    WHERE artifact.engine_execution_id=NEW.id AND artifact.artifact_type='engine_output')
  OR NOT COALESCE((NEW.result_summary->>'result_kind'='insufficient_population' AND NEW.result_summary->>'model_version_id' IS NULL)
    OR (NEW.result_summary->>'result_kind'='computational_grouping' AND EXISTS(
      SELECT 1 FROM tagging_model_versions model JOIN analysis_artifacts artifact ON artifact.engine_execution_id=NEW.id
       AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=model.artifact_digest
      WHERE model.id::text=NEW.result_summary->>'model_version_id'
       AND model.configuration->>'execution_id'=NEW.id::text AND model.configuration->>'contract_version'='workspace-topic-engine-v1')),false)) THEN
  RAISE EXCEPTION 'Engine coverage or fitted model is incomplete.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['signal_workspace_incremental_correction_epoch_v1(uuid)','signal_workspace_incremental_origin_current_v1(uuid,uuid)',
  'signal_workspace_incremental_model_current_v1(uuid,uuid,uuid)','signal_workspace_incremental_parent_current_v1(uuid,uuid,uuid)',
  'signal_workspace_incremental_execution_current_v1(uuid)','signal_workspace_incremental_editorial_at_v1(uuid,uuid,timestamptz)',
  'signal_workspace_incremental_editorial_cut_v1(uuid,uuid)','guard_workspace_incremental_artifact_v1()',
  'guard_workspace_incremental_execution_v1()','guard_workspace_incremental_registry_v1()','guard_workspace_incremental_provider_v1()','guard_signal_workspace_engine_v1()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name); END IF;
  END LOOP;
 END LOOP;
END $$;
