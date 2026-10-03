-- Project the reconciled population through paid historical Topics. No provider
-- admission, model approval, catalog creation or second population is introduced.
ALTER TABLE signal_topic_classification_outbox DROP CONSTRAINT signal_topic_classification_outbox_dispatch_kind_check;
ALTER TABLE signal_topic_classification_outbox ADD CONSTRAINT signal_topic_classification_outbox_dispatch_kind_check
 CHECK(dispatch_kind IN('execution','engine_progress','incremental_projection'));
DROP INDEX uq_signal_topic_catalog_execution_active_profile;
CREATE UNIQUE INDEX uq_signal_topic_catalog_execution_active_profile ON signal_topic_catalog_executions(taxonomy_profile_id,intent,
 (CASE WHEN input_snapshot ? 'numeric_descriptor' THEN 'numeric'
 WHEN input_contract='workspace-topic-classification-v1' AND input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1'
 THEN 'incremental_classification' ELSE 'legacy' END)) WHERE status IN('queued','running');

CREATE FUNCTION signal_workspace_incremental_projection_lineage_v1(target_execution uuid)
RETURNS TABLE(child_id uuid,parent_id uuid,cut_at timestamptz) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH RECURSIVE lineage AS(
  SELECT child.id child_id,(child.input_snapshot->'numeric_descriptor'->'parent'->>'execution_id')::uuid parent_id,
   child.created_at cut_at,ARRAY[child.id] path FROM signal_topic_catalog_executions child WHERE child.id=target_execution AND child.input_snapshot ? 'numeric_descriptor'
  UNION ALL SELECT parent.id,(parent.input_snapshot->'numeric_descriptor'->'parent'->>'execution_id')::uuid,parent.created_at,lineage.path||parent.id
   FROM lineage JOIN signal_topic_catalog_executions parent ON parent.id=lineage.parent_id
   WHERE parent.input_snapshot ? 'numeric_descriptor' AND NOT parent.id=ANY(lineage.path))
 SELECT child_id,parent_id,cut_at FROM lineage
$$;
CREATE FUNCTION signal_workspace_incremental_projection_history_v1(target_execution uuid)
RETURNS TABLE(artifact_id uuid) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT artifact.id FROM signal_workspace_incremental_projection_lineage_v1(target_execution) lineage
 JOIN signal_topic_catalog_executions child ON child.id=lineage.child_id
 JOIN analysis_artifacts artifact ON artifact.engine_execution_id=lineage.parent_id AND artifact.workspace_id=child.workspace_id
 WHERE artifact.artifact_type='engine_proposals' AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
  AND artifact.created_at<=lineage.cut_at
$$;
CREATE FUNCTION signal_workspace_incremental_projection_history_current_v1(target_execution uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions target WHERE target.id=target_execution AND target.input_snapshot ? 'numeric_descriptor')
 AND NOT EXISTS(SELECT 1 FROM signal_workspace_incremental_projection_lineage_v1(target_execution) lineage
  JOIN signal_topic_catalog_executions child ON child.id=lineage.child_id
  LEFT JOIN signal_topic_catalog_executions parent ON parent.id=lineage.parent_id AND parent.workspace_id=child.workspace_id
  CROSS JOIN LATERAL signal_workspace_incremental_editorial_cut_v1(lineage.parent_id,lineage.child_id) cut
  WHERE NOT COALESCE(parent.id IS NOT NULL AND parent.created_at<=child.created_at
   AND signal_workspace_incremental_parent_current_v1(parent.id,child.workspace_id,child.actor_user_id)
   AND parent.input_snapshot->>'context_digest'=child.input_snapshot->>'context_digest'
   AND cut.unit_count=(child.input_snapshot->'numeric_descriptor'->'editorial_cut'->>'unit_count')::bigint
   AND cut.unit_digest=child.input_snapshot->'numeric_descriptor'->'editorial_cut'->>'unit_digest',false))
 AND NOT EXISTS(SELECT 1 FROM signal_workspace_incremental_projection_history_v1(target_execution) history
  JOIN analysis_artifacts artifact ON artifact.id=history.artifact_id
  JOIN signal_topic_catalog_executions owner ON owner.id=artifact.engine_execution_id
  LEFT JOIN engine_cost_events call ON call.id=(artifact.metadata->>'call_id')::uuid AND call.workspace_id=artifact.workspace_id AND call.catalog_execution_id=owner.id
  WHERE NOT COALESCE(call.call_state='settled' AND COALESCE((call.metadata->>'response_complete')::boolean,true)
   AND call.response_storage_key IS NOT NULL AND call.response_sha256=artifact.metadata->>'response_sha256'
   AND call.actor_user_id=owner.actor_user_id AND call.workspace_contract='workspace-engine-interpretation-v1'
   AND call.call_configuration=workspace_engine_interpretation_configuration_v1(owner.id,call.metadata->>'interpretation_revision_digest')
   AND artifact.metadata->>'execution_id'=owner.id::text
   AND artifact.metadata->>'fit_checkpoint_digest'=owner.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   AND signal_workspace_incremental_origin_current_v1(owner.id,owner.workspace_id),false))
$$;
CREATE FUNCTION signal_workspace_incremental_projection_editorial_digest_v1(target_execution uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT 'sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(COALESCE(jsonb_agg(jsonb_build_object(
  'artifact_id',artifact.id::text,'owner_execution_id',artifact.engine_execution_id::text,'artifact_sha256',artifact.content->>'sha256',
  'call_id',call.id::text,'request_digest',call.request_digest) ORDER BY artifact.id),'[]'::jsonb)),'UTF8')),'hex')
 FROM signal_workspace_incremental_projection_history_v1(target_execution) history JOIN analysis_artifacts artifact ON artifact.id=history.artifact_id
 JOIN engine_cost_events call ON call.id=(artifact.metadata->>'call_id')::uuid
$$;
CREATE FUNCTION guard_workspace_incremental_projection_dispatch_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.dispatch_kind='incremental_projection' AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  WHERE engine.id=NEW.execution_id AND engine.workspace_id=NEW.workspace_id AND engine.status='ready'
   AND engine.input_contract='workspace-topic-engine-v1' AND engine.input_snapshot ? 'numeric_descriptor'
   AND engine.result_summary ? 'numeric_checkpoint' AND NEW.worker_job_id LIKE 'workspace-incremental-projection-'||engine.id::text||'-%') THEN
  RAISE EXCEPTION 'workspace_incremental_projection_dispatch_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_workspace_incremental_projection_dispatch BEFORE INSERT OR UPDATE ON signal_topic_classification_outbox
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_projection_dispatch_v1();

CREATE FUNCTION signal_workspace_incremental_binding_scope_v1(artifact analysis_artifacts)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN signal_topic_classification_outbox dispatch ON dispatch.execution_id=engine.id AND dispatch.workspace_id=engine.workspace_id
   AND dispatch.dispatch_kind='incremental_projection' AND dispatch.status IN('dispatching','dispatched')
  WHERE engine.id=artifact.engine_execution_id AND engine.workspace_id=artifact.workspace_id AND engine.status='ready'
   AND engine.input_snapshot ? 'numeric_descriptor' AND engine.result_summary ? 'numeric_checkpoint'
   AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=engine.workspace_id)
   AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp())
   AND signal_workspace_incremental_execution_current_v1(engine.id) AND signal_workspace_incremental_projection_history_current_v1(engine.id)
   AND signal_workspace_classification_actor_v1(engine.workspace_id,engine.actor_user_id)
   AND artifact.metadata->>'actor_user_id'=engine.actor_user_id::text
   AND artifact.metadata->>'worker_job_id'=dispatch.worker_job_id
   AND artifact.metadata->>'numeric_checkpoint_digest'=engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
   AND artifact.metadata->>'derivation_digest'~'^sha256:[0-9a-f]{64}$'),false)
$$;
CREATE FUNCTION signal_workspace_incremental_unit_census_valid_v1(target_execution uuid,target_derivation text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM analysis_artifacts component
  LEFT JOIN LATERAL(SELECT count(*) count,'sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(
   COALESCE(jsonb_agg(census.metadata->'unit' ORDER BY (census.metadata->'unit'->>'local_label')::int),'[]'::jsonb)),'UTF8')),'hex') digest,
   count(DISTINCT census.metadata->'unit'->>'local_label') unique_labels
   FROM analysis_artifacts census WHERE census.engine_execution_id=target_execution
    AND census.metadata->>'contract_version'='workspace-incremental-unit-census-v1'
    AND census.metadata->>'derivation_digest'=target_derivation AND census.metadata->>'component_key'=component.metadata->>'component_key') units ON true
  WHERE component.engine_execution_id=target_execution AND component.metadata->>'contract_version'='workspace-incremental-component-v1'
   AND (units.count<>(component.metadata->>'unit_count')::bigint OR units.count<>units.unique_labels OR units.digest<>component.metadata->>'unit_digest'))
$$;
CREATE FUNCTION guard_workspace_incremental_binding_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
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
  AND NEW.metadata->>'editorial_cut_digest'=signal_workspace_incremental_projection_editorial_digest_v1(engine.id)
  AND NEW.metadata->>'catalog_profile_id'=(SELECT id::text FROM signal_taxonomy_profiles WHERE workspace_id=engine.workspace_id AND kind='topic'
   AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1)
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
  SELECT artifact.* INTO proposal FROM signal_workspace_incremental_projection_history_v1(engine.id) history
   JOIN analysis_artifacts artifact ON artifact.id=history.artifact_id WHERE artifact.id=(binding->'proposal'->>'artifact_id')::uuid;
  SELECT * INTO receipt FROM engine_cost_events WHERE id=(binding->'proposal'->>'call_id')::uuid;
  IF NOT COALESCE(component.id IS NOT NULL AND census_row.id IS NOT NULL AND proposal.id IS NOT NULL
   AND census_row.metadata->>'component_key'=component.metadata->>'component_key'
   AND census_row.metadata->'unit'->>'birth_membership_digest'=binding->>'birth_membership_digest'
   AND component.metadata->'model_origin'=binding->'model_origin'
   AND binding->'model_origin'->>'execution_id'=proposal.engine_execution_id::text
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
CREATE TRIGGER trg_workspace_incremental_binding BEFORE INSERT OR UPDATE OR DELETE ON analysis_artifacts
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_binding_v1();

CREATE FUNCTION signal_workspace_incremental_projection_source_current_v1(generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN analysis_artifacts binding ON binding.id::text=generation.input_snapshot->'source_projection'->>'binding_artifact_id'
   AND binding.engine_execution_id=engine.id AND binding.workspace_id=engine.workspace_id AND binding.artifact_type='engine_output'
  JOIN analysis_artifacts output ON output.id::text=generation.input_snapshot->'source_projection'->>'output_artifact_id'
   AND output.engine_execution_id=engine.id AND output.workspace_id=engine.workspace_id AND output.artifact_key='manifest.json'
  WHERE engine.id::text=generation.input_snapshot->'source_projection'->>'engine_execution_id' AND engine.workspace_id=generation.workspace_id
   AND engine.status='ready' AND engine.input_snapshot ? 'numeric_descriptor' AND engine.result_summary ? 'numeric_checkpoint'
   AND engine.input_revision=generation.input_revision AND engine.embedding_run_id=generation.embedding_run_id AND engine.preparation_run_id=generation.preparation_run_id
   AND signal_workspace_incremental_execution_current_v1(engine.id) AND signal_workspace_incremental_projection_history_current_v1(engine.id)
   AND signal_workspace_incremental_origin_current_v1(engine.id,engine.workspace_id)
   AND binding.metadata->>'contract_version'='workspace-incremental-binding-index-v1'
   AND binding.metadata->>'catalog_profile_id'=generation.taxonomy_profile_id::text
   AND binding.metadata->'identity'=generation.input_snapshot->'identity'
   AND binding.metadata->>'correction_digest'=generation.input_snapshot->>'correction_digest'
   AND binding.metadata->>'actor_user_id'=generation.created_by_user_id::text
   AND binding.metadata->>'numeric_checkpoint_digest'=engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
   AND generation.input_snapshot->'source_projection'->>'numeric_checkpoint_digest'=binding.metadata->>'numeric_checkpoint_digest'
   AND generation.input_snapshot->'source_projection'->>'workspace_id'=engine.workspace_id::text
   AND generation.input_snapshot->'source_projection'->>'population_digest'=engine.result_summary->'numeric_checkpoint'->>'population_digest'
   AND generation.input_snapshot->'source_projection'->>'editorial_cut_digest'=binding.metadata->>'editorial_cut_digest'
   AND generation.input_snapshot->'source_projection'->>'binding_digest'=binding.metadata->>'binding_digest'
   AND generation.input_snapshot->'source_projection'->>'policy_digest'=generation.input_snapshot->'identity'->>'decision_policy_digest'
   AND generation.input_snapshot->'source_projection'->'interpretation_coverage'=binding.metadata->'interpretation_coverage'
   AND generation.input_snapshot->'source_projection'->'discovery_coverage'=binding.metadata->'discovery_coverage'
   AND output.id::text=engine.result_summary->'numeric_checkpoint'->>'output_artifact_id'
   AND generation.input_snapshot->'source_projection'->>'output_manifest_sha256'=output.content->>'sha256'
   AND EXISTS(SELECT 1 FROM analysis_artifacts members WHERE members.id::text=generation.input_snapshot->'source_projection'->>'memberships_artifact_id'
    AND members.engine_execution_id=engine.id AND members.workspace_id=engine.workspace_id AND members.artifact_key='memberships.jsonl')
   AND EXISTS(SELECT 1 FROM analysis_artifacts roots WHERE roots.id::text=generation.input_snapshot->'source_projection'->>'roots_artifact_id'
    AND roots.engine_execution_id=engine.id AND roots.workspace_id=engine.workspace_id AND roots.artifact_key='roots.jsonl')
   AND CASE WHEN engine.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id' IS NULL THEN
    generation.input_snapshot->'source_projection'->>'model_bank_artifact_id' IS NULL AND generation.input_snapshot->'source_projection'->>'model_version_id' IS NULL
    AND generation.input_snapshot->'identity'->>'engine_artifact_digest'=output.content->>'sha256'
   ELSE EXISTS(SELECT 1 FROM analysis_artifacts bank JOIN tagging_model_versions registry
    ON registry.id::text=generation.input_snapshot->'source_projection'->>'model_version_id'
     AND registry.configuration->>'binding_artifact_id'=binding.id::text AND registry.configuration->>'binding_digest'=binding.metadata->>'binding_digest'
     AND registry.configuration->'workspace_classification_identity'=generation.input_snapshot->'identity'
     AND registry.configuration->>'contract_version'='workspace-topic-incremental-projection-v1'
     AND registry.taxonomy_profile_id=generation.taxonomy_profile_id AND registry.artifact_digest=bank.content->>'sha256'
     AND (SELECT event.status FROM signal_tagging_model_version_events event WHERE event.model_version_id=registry.id
      AND event.workspace_id=generation.workspace_id AND event.effective_at<=now() ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1) IN('draft','evaluated','approved')
    WHERE bank.id::text=engine.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id' AND bank.engine_execution_id=engine.id AND bank.workspace_id=engine.workspace_id
     AND generation.input_snapshot->'source_projection'->>'model_bank_artifact_id'=bank.id::text
     AND generation.input_snapshot->'identity'->>'engine_artifact_digest'=bank.content->>'sha256') END),false)
$$;

CREATE FUNCTION signal_workspace_incremental_membership_current_v1(assignment signal_classification_assignments,generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(assignment.membership_basis='decision' OR (assignment.membership_basis='computed_cluster'
  AND assignment.disposition='pending' AND assignment.resolution_method='model' AND assignment.approval_policy_id IS NULL AND assignment.decided_by_user_id IS NULL
  AND signal_workspace_incremental_projection_source_current_v1(generation)
  AND assignment.model_version_id::text=generation.input_snapshot->'source_projection'->>'model_version_id'
  AND assignment.membership_metadata->>'contract_version'='workspace-computed-incremental-membership-v1'
  AND assignment.membership_metadata->>'engine_execution_id'=generation.input_snapshot->'source_projection'->>'engine_execution_id'
  AND assignment.membership_metadata->>'output_artifact_id'=generation.input_snapshot->'source_projection'->>'output_artifact_id'
  AND assignment.membership_metadata->>'memberships_artifact_id'=generation.input_snapshot->'source_projection'->>'memberships_artifact_id'
  AND assignment.membership_metadata->>'binding_artifact_id'=generation.input_snapshot->'source_projection'->>'binding_artifact_id'
  AND assignment.membership_metadata->>'binding_digest'=generation.input_snapshot->'source_projection'->>'binding_digest'
  AND assignment.membership_metadata->>'materialized_definition_digest'=assignment.definition_digest
  AND assignment.membership_metadata->>'evaluation_digest'~'^sha256:[0-9a-f]{64}$'
  AND EXISTS(SELECT 1 FROM analysis_artifacts binding JOIN analysis_artifacts unit ON unit.engine_execution_id=binding.engine_execution_id
   AND unit.workspace_id=binding.workspace_id AND unit.metadata->>'contract_version'='workspace-incremental-unit-binding-v1'
   AND unit.metadata->>'derivation_digest'=binding.metadata->>'derivation_digest'
   CROSS JOIN LATERAL jsonb_array_elements(generation.input_snapshot->'topics') topic
   WHERE binding.id::text=generation.input_snapshot->'source_projection'->>'binding_artifact_id'
    AND topic->>'taxonomy_term_id'=assignment.taxonomy_term_id::text
    AND topic->'definition'->>'term_key'=unit.metadata->'binding'->>'term_key'
    AND topic->'definition'->>'lifecycle'<>'archived'
    AND topic->>'projection_semantics_digest'=assignment.membership_metadata->>'proposal_semantics_digest'
    AND unit.metadata->'binding'->'proposal'->>'status' IN('coherent','mixed')
    AND unit.metadata->'binding'->>'definition_digest'=assignment.definition_digest
    AND unit.metadata->'binding'->>'definition_revision'=assignment.definition_revision::text
    AND assignment.membership_metadata->'unit_keys'=jsonb_build_array(unit.metadata->'binding'->>'unit_key')
    AND assignment.membership_metadata->>'model_component_key'=unit.metadata->'binding'->>'component_key'
    AND assignment.membership_metadata->>'birth_membership_digest'=unit.metadata->'binding'->>'birth_membership_digest'
    AND assignment.membership_metadata->'model_origin'=unit.metadata->'binding'->'model_origin'
    AND assignment.membership_metadata->>'proposal_artifact_id'=unit.metadata->'binding'->'proposal'->>'artifact_id'
    AND assignment.membership_metadata->>'proposal_owner_execution_id'=unit.metadata->'binding'->'proposal'->>'owner_execution_id'
    AND assignment.membership_metadata->>'proposal_semantics_digest'=unit.metadata->'binding'->'proposal'->>'proposal_semantics_digest')
  AND EXISTS(SELECT 1 FROM signal_corpus_preparation_items root JOIN signal_corpus_text_assets asset ON asset.workspace_id=root.workspace_id
   AND asset.text_sha256=root.asset_sha256 AND asset.chunk_policy_version=root.chunk_policy_version
   WHERE root.run_id=generation.preparation_run_id AND root.workspace_id=generation.workspace_id AND root.root_id=assignment.canonical_root_id AND root.disposition='eligible'
    AND (assignment.membership_metadata->'evidence_fragment'->>'chunk_index')::int>=0
    AND jsonb_build_object('start',asset.chunks->'chunks'->(assignment.membership_metadata->'evidence_fragment'->>'chunk_index')::int->'start',
     'end',asset.chunks->'chunks'->(assignment.membership_metadata->'evidence_fragment'->>'chunk_index')::int->'end',
     'chunk_sha256',asset.chunks->'chunks'->(assignment.membership_metadata->'evidence_fragment'->>'chunk_index')::int->'sha256')
     =(assignment.membership_metadata->'evidence_fragment')-'chunk_index')
  AND (assignment.membership_metadata->>'matched_chunks')::int>0
  AND (assignment.membership_metadata->>'matched_chunks')::int<=(SELECT (outcome_metadata->'coverage'->>'expected_chunks')::int
   FROM signal_classification_generation_items item WHERE item.id=assignment.generation_item_id)),false)
$$;

-- Preserve the prior source and membership branches verbatim.
CREATE FUNCTION signal_workspace_fit_projection_source_current_v1(generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN analysis_artifacts output ON output.id::text=generation.input_snapshot->'source_projection'->>'output_artifact_id'
   AND output.engine_execution_id=engine.id AND output.workspace_id=engine.workspace_id AND output.artifact_type='engine_output'
  JOIN analysis_artifacts materialization ON materialization.id::text=generation.input_snapshot->'source_projection'->>'materialization_artifact_id'
   AND materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
   AND materialization.artifact_type='engine_proposals'
  WHERE engine.id::text=generation.input_snapshot->'source_projection'->>'engine_execution_id'
   AND engine.workspace_id=generation.workspace_id AND engine.input_contract='workspace-topic-engine-v1'
   AND engine.embedding_run_id=generation.embedding_run_id AND engine.preparation_run_id=generation.preparation_run_id
   AND engine.input_revision=generation.input_revision
   AND signal_workspace_engine_materialization_source_v1(engine,materialization,generation.taxonomy_profile_id)
   AND engine.result_summary->'fit_checkpoint'->>'output_artifact_id'=output.id::text
   AND materialization.metadata->>'mapping_digest'=generation.input_snapshot->'source_projection'->>'mapping_digest'
   AND (materialization.metadata->>'contract_version'<>'workspace-topic-materialization-progress-v1' OR
    generation.input_snapshot->'source_projection'->'interpretation_coverage'=jsonb_build_object(
     'interpreted_unit_count',(materialization.metadata->>'interpreted_unit_count')::bigint,
     'expected_unit_count',(materialization.metadata->>'expected_interpretation_unit_count')::bigint,
     'unit_digest',materialization.metadata->>'interpretation_units_digest',
     'expected_unit_digest',materialization.metadata->>'expected_interpretation_units_digest',
     'complete',(materialization.metadata->>'interpretation_complete')::boolean))
   AND generation.input_snapshot->'source_projection'->>'policy_digest' =generation.input_snapshot->'identity'->>'decision_policy_digest'
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
CREATE FUNCTION signal_workspace_fit_membership_current_v1(assignment signal_classification_assignments,generation signal_classification_generations)
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
CREATE OR REPLACE FUNCTION signal_workspace_projection_source_current_v1(generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE generation.input_snapshot->'source_projection'->>'contract_version'
  WHEN 'workspace-topic-projection-v1' THEN signal_workspace_fit_projection_source_current_v1(generation)
  WHEN 'workspace-topic-incremental-projection-v1' THEN signal_workspace_incremental_projection_source_current_v1(generation) ELSE false END
$$;
CREATE OR REPLACE FUNCTION signal_workspace_computed_membership_current_v1(assignment signal_classification_assignments,generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN generation.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1'
 THEN signal_workspace_incremental_membership_current_v1(assignment,generation) ELSE signal_workspace_fit_membership_current_v1(assignment,generation) END
$$;
CREATE OR REPLACE FUNCTION guard_signal_workspace_projection_generation_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.input_snapshot->'source_projection' IS NOT NULL AND (NEW.input_contract<>'workspace-topic-classification-v1'
  OR NEW.input_snapshot->'source_projection'->>'contract_version' NOT IN('workspace-topic-projection-v1','workspace-topic-incremental-projection-v1')
  OR NOT signal_workspace_projection_source_current_v1(NEW)) THEN
  RAISE EXCEPTION 'workspace_projection_source_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_signal_workspace_engine_artifact_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.engine_execution_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id;
 IF execution.id IS NULL OR execution.input_contract<>'workspace-topic-engine-v1' OR NOT (execution.status='ready' AND NEW.metadata->>'contract_version' IN('workspace-incremental-unit-census-v1','workspace-incremental-unit-binding-v1','workspace-incremental-binding-index-v1') AND signal_workspace_incremental_binding_scope_v1(NEW) OR execution.status='running' OR execution.status IN('failed','ready') AND NEW.artifact_type='engine_proposals' AND NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1')
  OR NEW.workspace_artifact_kind<>'topic_discovery' OR NEW.discovery_run_digest<>'sha256:'||encode(sha256(convert_to(execution.input_digest||':'||execution.id::text,'UTF8')),'hex')
  OR NEW.review_status<>'draft' OR NEW.artifact_type NOT IN('engine_model','engine_output','engine_proposals')
  OR NOT COALESCE(NEW.content->>'contract_version'='workspace-engine-private-artifact-v1'
    AND NEW.content->>'sha256'~'^sha256:[0-9a-f]{64}$'
    AND (NEW.content->>'size_bytes')::bigint>=0
    AND NEW.content->>'storage_key' LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||execution.id::text||'/%',false)
  OR pg_column_size(NEW.content)>65536 OR pg_column_size(NEW.metadata)>65536 THEN
  RAISE EXCEPTION 'Engine artifact authority is invalid.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
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
    JOIN signal_taxonomy_profiles profile ON profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=engine.workspace_id AND profile.status IN('draft','active')
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
DO $$ DECLARE fn record; role_name text; BEGIN
 FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND
 (p.proname LIKE 'signal_workspace_incremental_projection_%' OR p.proname IN('guard_workspace_incremental_projection_dispatch_v1',
  'signal_workspace_incremental_binding_scope_v1','signal_workspace_incremental_unit_census_valid_v1','guard_workspace_incremental_binding_v1',
  'signal_workspace_incremental_membership_current_v1','signal_workspace_fit_projection_source_current_v1','signal_workspace_fit_membership_current_v1',
  'signal_workspace_projection_source_current_v1','signal_workspace_computed_membership_current_v1','guard_signal_workspace_projection_generation_v1',
  'guard_signal_workspace_engine_artifact_v1','validate_signal_tagging_model_registry_v1')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn.signature,role_name);END IF;END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION guard_workspace_incremental_projection_execution_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.status NOT IN('queued','running') THEN RETURN NEW;END IF;
 IF NEW.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1' THEN
  IF EXISTS(SELECT 1 FROM signal_topic_catalog_executions active WHERE active.taxonomy_profile_id=NEW.taxonomy_profile_id AND active.id<>NEW.id
   AND active.status IN('queued','running') AND NOT EXISTS(SELECT 1 FROM signal_workspace_incremental_projection_lineage_v1(
    (NEW.input_snapshot->'source_projection'->>'engine_execution_id')::uuid) lineage
    WHERE (active.id=lineage.parent_id AND active.input_contract='workspace-topic-engine-v1' AND NOT active.input_snapshot ? 'numeric_descriptor')
     OR(active.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-projection-v1'
      AND active.input_snapshot->'source_projection'->>'engine_execution_id'=lineage.parent_id::text))) THEN
   RAISE EXCEPTION 'workspace_incremental_projection_execution_active' USING ERRCODE='23514'; END IF;
 ELSIF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions active WHERE active.taxonomy_profile_id=NEW.taxonomy_profile_id
  AND active.status IN('queued','running') AND active.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1') THEN
  RAISE EXCEPTION 'workspace_incremental_projection_execution_active' USING ERRCODE='23514'; END IF;
 RETURN NEW;END $$;
CREATE TRIGGER trg_workspace_incremental_projection_execution BEFORE INSERT OR UPDATE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_projection_execution_v1();
REVOKE ALL ON FUNCTION guard_workspace_incremental_projection_execution_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_incremental_projection_execution_v1() FROM %I',role_name);END IF;
END LOOP;END $$;
