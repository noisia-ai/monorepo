-- Native complete-corpus computational projection and explicit Signal selection.
-- No new assignment authority, paid call, approval, or serving activation.
ALTER TABLE signal_classification_assignments
 ADD COLUMN membership_basis text NOT NULL DEFAULT 'decision',
 ADD COLUMN membership_metadata jsonb,
 ADD CONSTRAINT signal_assignment_membership_basis_v1 CHECK(COALESCE(
  (membership_basis='decision' AND membership_metadata IS NULL) OR
  (membership_basis='computed_cluster' AND disposition='pending' AND resolution_method='model'
   AND approval_policy_id IS NULL AND decided_by_user_id IS NULL AND correction_operation_id IS NULL
   AND jsonb_typeof(membership_metadata)='object'),false));

CREATE FUNCTION signal_workspace_projection_source_current_v1(generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN analysis_artifacts output ON output.id::text=generation.input_snapshot->'source_projection'->>'output_artifact_id'
   AND output.engine_execution_id=engine.id AND output.workspace_id=engine.workspace_id AND output.artifact_type='engine_output'
  JOIN analysis_artifacts materialization ON materialization.id::text=generation.input_snapshot->'source_projection'->>'materialization_artifact_id'
   AND materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
   AND materialization.artifact_type='engine_proposals'
  WHERE engine.id::text=generation.input_snapshot->'source_projection'->>'engine_execution_id'
   AND engine.workspace_id=generation.workspace_id AND engine.input_contract='workspace-topic-engine-v1' AND engine.status='ready'
   AND engine.embedding_run_id=generation.embedding_run_id AND engine.preparation_run_id=generation.preparation_run_id
   AND engine.input_revision=generation.input_revision
   AND engine.result_summary->'analysis_checkpoint'->>'output_catalog_profile_id'=generation.taxonomy_profile_id::text
   AND engine.result_summary->'analysis_checkpoint'->>'materialization_artifact_id'=materialization.id::text
   AND engine.result_summary->'fit_checkpoint'->>'output_artifact_id'=output.id::text
   AND materialization.metadata->>'contract_version'='workspace-topic-materialization-v1'
   AND materialization.metadata->>'mapping_digest'=generation.input_snapshot->'source_projection'->>'mapping_digest'
   AND generation.input_snapshot->'source_projection'->>'policy_digest'=generation.input_snapshot->'identity'->>'decision_policy_digest'
   AND CASE WHEN generation.input_snapshot->'source_projection'->>'model_artifact_id' IS NULL
    THEN engine.result_summary->'fit_checkpoint'->>'model_artifact_id' IS NULL
     AND generation.input_snapshot->'source_projection'->>'model_version_id' IS NULL
     AND generation.input_snapshot->'identity'->>'engine_artifact_digest'=output.content->>'sha256'
    ELSE EXISTS(SELECT 1 FROM analysis_artifacts model JOIN tagging_model_versions registry
     ON registry.id::text=generation.input_snapshot->'source_projection'->>'model_version_id'
      AND registry.taxonomy_profile_id=generation.taxonomy_profile_id AND registry.artifact_digest=model.content->>'sha256'
      AND registry.configuration->'workspace_classification_identity'=generation.input_snapshot->'identity'
      AND (SELECT event.status FROM signal_tagging_model_version_events event WHERE event.model_version_id=registry.id
       AND event.workspace_id=generation.workspace_id AND event.effective_at<=now() ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1) IN('draft','evaluated','approved')
     WHERE model.id::text=generation.input_snapshot->'source_projection'->>'model_artifact_id'
      AND model.id::text=engine.result_summary->'fit_checkpoint'->>'model_artifact_id'
      AND model.workspace_id=engine.workspace_id AND model.engine_execution_id=engine.id AND model.artifact_type='engine_model'
      AND generation.input_snapshot->'identity'->>'engine_artifact_digest'=model.content->>'sha256') END),false)
$$;
CREATE FUNCTION guard_signal_workspace_projection_generation_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.input_snapshot->'source_projection' IS NOT NULL AND (NEW.input_contract<>'workspace-topic-classification-v1'
  OR NEW.input_snapshot->'source_projection'->>'contract_version' IS DISTINCT FROM 'workspace-topic-projection-v1'
  OR NOT signal_workspace_projection_source_current_v1(NEW)) THEN
  RAISE EXCEPTION 'workspace_projection_source_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER signal_workspace_projection_generation_v1 BEFORE INSERT ON signal_classification_generations
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_projection_generation_v1();

CREATE FUNCTION signal_workspace_computed_membership_current_v1(assignment signal_classification_assignments,generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(assignment.membership_basis='decision' OR (
  assignment.membership_basis='computed_cluster' AND assignment.disposition='pending' AND assignment.resolution_method='model'
  AND assignment.approval_policy_id IS NULL AND assignment.decided_by_user_id IS NULL
  AND signal_workspace_projection_source_current_v1(generation)
  AND assignment.model_version_id::text=generation.input_snapshot->'source_projection'->>'model_version_id'
  AND assignment.membership_metadata->>'contract_version'='workspace-computed-cluster-membership-v1'
  AND assignment.membership_metadata->>'engine_execution_id'=generation.input_snapshot->'source_projection'->>'engine_execution_id'
  AND assignment.membership_metadata->>'materialization_artifact_id'=generation.input_snapshot->'source_projection'->>'materialization_artifact_id'
  AND assignment.membership_metadata->>'materialized_definition_digest'=assignment.definition_digest
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(generation.input_snapshot->'topics') topic
   WHERE topic->>'taxonomy_term_id'=assignment.taxonomy_term_id::text
    AND topic->>'projection_semantics_digest'=assignment.membership_metadata->>'proposal_semantics_digest'
    AND assignment.membership_metadata->'unit_keys'=jsonb_build_array(topic->'definition'->'source'->>'candidate_key'))
  AND jsonb_typeof(assignment.membership_metadata->'assignment_artifact_ids')='array'
  AND jsonb_array_length(assignment.membership_metadata->'assignment_artifact_ids')=1
  AND (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(assignment.membership_metadata->'assignment_artifact_ids'))
    =jsonb_array_length(assignment.membership_metadata->'assignment_artifact_ids')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(assignment.membership_metadata->'assignment_artifact_ids') ref
   WHERE NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.id::text=ref.value
    AND artifact.workspace_id=generation.workspace_id AND artifact.engine_execution_id::text=assignment.membership_metadata->>'engine_execution_id'
    AND artifact.artifact_type='engine_output' AND artifact.artifact_key IN('assignments.open.jsonl','assignments.guided.jsonl')
    AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(assignment.membership_metadata->'unit_keys') unit
      WHERE artifact.artifact_key='assignments.'||split_part(unit.value,':',1)||'.jsonl')))
  AND jsonb_typeof(assignment.membership_metadata->'unit_keys')='array' AND jsonb_array_length(assignment.membership_metadata->'unit_keys')>0
  AND (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(assignment.membership_metadata->'unit_keys'))=jsonb_array_length(assignment.membership_metadata->'unit_keys')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(assignment.membership_metadata->'unit_keys') unit WHERE unit.value !~ '^(open|guided):[A-Za-z0-9_.:-]{1,180}$')
  AND EXISTS(SELECT 1 FROM signal_corpus_preparation_items root
   JOIN signal_corpus_text_assets asset ON asset.workspace_id=root.workspace_id AND asset.text_sha256=root.asset_sha256 AND asset.chunk_policy_version=root.chunk_policy_version
   WHERE root.run_id=generation.preparation_run_id AND root.workspace_id=generation.workspace_id AND root.root_id=assignment.canonical_root_id
    AND root.disposition='eligible' AND (assignment.membership_metadata->'evidence_fragment'->>'chunk_index')::int>=0
    AND jsonb_build_object('start',asset.chunks->'chunks'->(assignment.membership_metadata->'evidence_fragment'->>'chunk_index')::int->'start',
      'end',asset.chunks->'chunks'->(assignment.membership_metadata->'evidence_fragment'->>'chunk_index')::int->'end',
      'chunk_sha256',asset.chunks->'chunks'->(assignment.membership_metadata->'evidence_fragment'->>'chunk_index')::int->'sha256')
     =(assignment.membership_metadata->'evidence_fragment')-'chunk_index')
  AND (assignment.membership_metadata->>'matched_chunks')::int>0
  AND (assignment.membership_metadata->>'matched_chunks')::int <= (SELECT (outcome_metadata->'coverage'->>'expected_chunks')::int FROM signal_classification_generation_items item WHERE item.id=assignment.generation_item_id)
 ),false)
$$;
CREATE FUNCTION guard_signal_workspace_computed_membership_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ DECLARE generation signal_classification_generations%ROWTYPE; BEGIN
 SELECT * INTO generation FROM signal_classification_generations WHERE id=NEW.generation_id;
 IF NOT signal_workspace_computed_membership_current_v1(NEW,generation) THEN
  RAISE EXCEPTION 'workspace_projection_membership_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER signal_workspace_computed_membership_v1 BEFORE INSERT ON signal_classification_assignments
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_computed_membership_v1();

CREATE OR REPLACE FUNCTION validate_signal_tagging_model_registry_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace_id uuid;
BEGIN
  IF NEW.registry_contract_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.configuration->>'contract_version'='workspace-topic-projection-v1' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
    JOIN signal_taxonomy_profiles profile ON profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=engine.workspace_id AND profile.status IN('draft','active')
    JOIN analysis_artifacts model ON model.id::text=NEW.configuration->>'model_artifact_id' AND model.engine_execution_id=engine.id AND model.workspace_id=engine.workspace_id
    JOIN analysis_artifacts materialization ON materialization.id::text=NEW.configuration->>'materialization_artifact_id'
     AND materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
    WHERE engine.id::text=NEW.configuration->>'engine_execution_id' AND engine.input_contract='workspace-topic-engine-v1' AND engine.status='ready'
     AND engine.result_summary->'analysis_checkpoint'->>'output_catalog_profile_id'=profile.id::text
     AND engine.result_summary->'fit_checkpoint'->>'model_artifact_id'=model.id::text
     AND engine.result_summary->'analysis_checkpoint'->>'materialization_artifact_id'=materialization.id::text
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
    WHERE id=NEW.taxonomy_profile_id AND (status='active' OR (status='draft'
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

CREATE OR REPLACE FUNCTION signal_workspace_classification_assignment_current_v1(
 assignment signal_classification_assignments,target_generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_workspace_computed_membership_current_v1(assignment,target_generation) AND COALESCE(EXISTS(
  SELECT 1 FROM taxonomy_terms term JOIN jsonb_array_elements(target_generation.input_snapshot->'topics') topic
   ON topic->>'taxonomy_term_id'=term.id::text
  JOIN signal_classification_generation_items item ON item.id=assignment.generation_item_id
  WHERE term.term_key=(SELECT source_term.term_key FROM taxonomy_terms source_term WHERE source_term.id=assignment.taxonomy_term_id)
   AND topic->'definition'->>'definition_digest'=assignment.definition_digest
   AND (topic->'definition'->>'definition_revision')::int=assignment.definition_revision
   AND term.status IN('candidate','active')
   AND CASE WHEN assignment.resolution_method='human' THEN EXISTS(
    SELECT 1 FROM signal_topic_membership_operations op JOIN signal_topic_membership_overrides current ON current.correction_operation_id=op.id
     WHERE op.id=assignment.correction_operation_id AND op.workspace_id=target_generation.workspace_id
      AND op.actor_user_id=assignment.decided_by_user_id AND op.canonical_root_id=assignment.canonical_root_id
      AND op.term_key=term.term_key AND op.definition_digest=assignment.definition_digest AND op.definition_revision=assignment.definition_revision
      AND op.context_digest=target_generation.input_snapshot->>'context_digest' AND op.root_fingerprint=item.root_fingerprint
      AND ((op.disposition='belongs' AND assignment.disposition='approved') OR (op.disposition='excluded' AND assignment.disposition='rejected'))
      AND current.origin_input_contract='workspace-topic-classification-v1'
      AND signal_workspace_classification_actor_v1(op.workspace_id,op.actor_user_id))
   ELSE assignment.taxonomy_profile_id=target_generation.taxonomy_profile_id
    AND CASE WHEN assignment.resolution_method='model' THEN EXISTS(SELECT 1 FROM tagging_model_versions model
     WHERE model.id=assignment.model_version_id AND model.registry_contract_version='signal-tagging-model-registry-v1'
      AND model.taxonomy_profile_id=target_generation.taxonomy_profile_id
      AND model.artifact_digest=target_generation.input_snapshot->'identity'->>'engine_artifact_digest'
      AND model.configuration->'workspace_classification_identity'=target_generation.input_snapshot->'identity')
    WHEN assignment.resolution_method='labeling_function' THEN EXISTS(SELECT 1 FROM signal_labeling_function_versions lf
     WHERE lf.id=assignment.labeling_function_version_id AND lf.status='approved' AND lf.taxonomy_term_id=term.id
      AND lf.effective_from<=now() AND (lf.effective_to IS NULL OR lf.effective_to>now())
      AND lf.input_contract->'workspace_classification_identity'=target_generation.input_snapshot->'identity') ELSE false END
    AND (assignment.disposition<>'approved' OR EXISTS(SELECT 1 FROM signal_classification_approval_policies policy
     WHERE policy.id=assignment.approval_policy_id AND policy.workspace_id=target_generation.workspace_id
      AND policy.taxonomy_profile_id=target_generation.taxonomy_profile_id AND policy.status='approved'
      AND policy.effective_from<=now() AND (policy.effective_to IS NULL OR policy.effective_to>now())
      AND policy.definition_hash=target_generation.input_snapshot->'identity'->>'decision_policy_digest'
      AND policy.authority_kind=assignment.resolution_method
      AND (assignment.resolution_method<>'model' OR policy.model_version_id=assignment.model_version_id
       AND (SELECT status FROM signal_tagging_model_version_events event WHERE event.model_version_id=assignment.model_version_id
        AND event.workspace_id=target_generation.workspace_id AND event.effective_at<=now()
        ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved')
      AND (assignment.resolution_method<>'labeling_function' OR policy.labeling_function_version_id=assignment.labeling_function_version_id)))
   END),false)
$$;

ALTER TABLE signal_workspaces ADD COLUMN topic_signal_selection jsonb NOT NULL DEFAULT '{"revision":0,"items":{}}'::jsonb,
 ADD CONSTRAINT signal_topic_selection_shape_v1 CHECK(COALESCE(jsonb_typeof(topic_signal_selection)='object'
  AND jsonb_typeof(topic_signal_selection->'items')='object' AND (topic_signal_selection->>'revision') ~ '^[0-9]+$',false));
ALTER TABLE signal_topic_catalog_operations DROP CONSTRAINT signal_topic_catalog_operations_action_check;
ALTER TABLE signal_topic_catalog_operations ADD CONSTRAINT signal_topic_catalog_operations_action_check
 CHECK(action IN('create','adopt','update','archive','restore','select_signal')),
 ADD COLUMN selection_result jsonb,
 ADD CONSTRAINT signal_topic_selection_receipt_v1 CHECK(COALESCE((action='select_signal' AND jsonb_typeof(selection_result)='object')
  OR (action<>'select_signal' AND selection_result IS NULL),false));
CREATE FUNCTION guard_signal_topic_selection_receipt_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF OLD.action='select_signal' OR (TG_OP='UPDATE' AND NEW.action='select_signal') THEN
  RAISE EXCEPTION 'workspace_topic_selection_receipt_immutable' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $$;
CREATE TRIGGER signal_topic_selection_receipt_v1 BEFORE UPDATE OR DELETE ON signal_topic_catalog_operations
 FOR EACH ROW EXECUTE FUNCTION guard_signal_topic_selection_receipt_v1();

-- A catalog copy is inserted before its profile. Invalidate at profile insertion,
-- so archive and restore never resurrect a previous opt-in. Definition
-- edits remain stale through their definition binding; labels are independent.
CREATE FUNCTION clear_archived_signal_topic_selections_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace uuid; DECLARE target_taxonomy uuid; DECLARE changed jsonb;
BEGIN
 IF TG_TABLE_NAME='signal_taxonomy_profiles' THEN
  IF NEW.kind<>'topic' THEN RETURN NEW; END IF;
  target_workspace:=NEW.workspace_id; target_taxonomy:=NEW.taxonomy_id;
 ELSE
  IF NEW.status<>'archived' AND NEW.metadata->'topic'->>'lifecycle' IS DISTINCT FROM 'archived' THEN RETURN NEW; END IF;
  SELECT workspace_id,taxonomy_id INTO target_workspace,target_taxonomy FROM signal_taxonomy_profiles
   WHERE taxonomy_id=NEW.taxonomy_id AND kind='topic' AND id=(SELECT id FROM signal_taxonomy_profiles candidate
    WHERE candidate.workspace_id=signal_taxonomy_profiles.workspace_id AND candidate.kind='topic' ORDER BY version DESC LIMIT 1);
 END IF;
 IF target_workspace IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||target_workspace::text||':topic',0));
 PERFORM id FROM signal_workspaces WHERE id=target_workspace FOR UPDATE;
 SELECT jsonb_object_agg(entry.key,entry.value||'{"selected":false}'::jsonb) INTO changed
  FROM signal_workspaces workspace CROSS JOIN LATERAL jsonb_each(workspace.topic_signal_selection->'items') entry
  WHERE workspace.id=target_workspace AND entry.value->>'selected'='true' AND EXISTS(
   SELECT 1 FROM taxonomy_terms term WHERE term.taxonomy_id=target_taxonomy AND term.term_key=entry.key
    AND (term.status='archived' OR term.metadata->'topic'->>'lifecycle'='archived'));
 IF changed IS NOT NULL THEN UPDATE signal_workspaces SET topic_signal_selection=jsonb_build_object(
  'revision',(topic_signal_selection->>'revision')::bigint+1,'items',(topic_signal_selection->'items')||changed) WHERE id=target_workspace; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER clear_archived_signal_topic_selections_profile_v1 AFTER INSERT ON signal_taxonomy_profiles
 FOR EACH ROW EXECUTE FUNCTION clear_archived_signal_topic_selections_v1();
CREATE TRIGGER clear_archived_signal_topic_selections_term_v1 AFTER UPDATE OF status,metadata ON taxonomy_terms
 FOR EACH ROW EXECUTE FUNCTION clear_archived_signal_topic_selections_v1();
REVOKE ALL ON FUNCTION signal_workspace_projection_source_current_v1(signal_classification_generations),
 signal_workspace_computed_membership_current_v1(signal_classification_assignments,signal_classification_generations),
 guard_signal_workspace_projection_generation_v1(),guard_signal_workspace_computed_membership_v1(),
 guard_signal_topic_selection_receipt_v1(),clear_archived_signal_topic_selections_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
  EXECUTE format('REVOKE ALL ON FUNCTION signal_workspace_projection_source_current_v1(signal_classification_generations), signal_workspace_computed_membership_current_v1(signal_classification_assignments,signal_classification_generations), guard_signal_workspace_projection_generation_v1(), guard_signal_workspace_computed_membership_v1(), guard_signal_topic_selection_receipt_v1(),clear_archived_signal_topic_selections_v1() FROM %I',role_name);
 END IF; END LOOP; END $$;
