-- Read-only factoring of common plan/generation guards. No persistent cache,
-- provider, dispatch, authority or change to row insertion/serving guards.
DO $$ BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='workspace_incremental_editorial_plan_valid_v1(uuid)'::regprocedure) IS DISTINCT FROM 'a8bc4e48913c8c2df680305703e134d3597ee1922d2942299eddceab13ae1e7e' THEN
  RAISE EXCEPTION 'mfp_read_guard_preimage_changed: workspace_incremental_editorial_plan_valid_v1'; END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='signal_workspace_fit_membership_current_v1(signal_classification_assignments,signal_classification_generations)'::regprocedure) IS DISTINCT FROM 'e3118383798f9832aea7f9dfbc0224aee9be5fee90ebabed5618488aef659e13' THEN
  RAISE EXCEPTION 'mfp_read_guard_preimage_changed: signal_workspace_fit_membership_current_v1'; END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='signal_workspace_incremental_membership_current_v1(signal_classification_assignments,signal_classification_generations)'::regprocedure) IS DISTINCT FROM '91812f25f0d9dfe1579a3ba5cdb959a4a3e42bdea1ded0a0bd8695ba3cd246a4' THEN
  RAISE EXCEPTION 'mfp_read_guard_preimage_changed: signal_workspace_incremental_membership_current_v1'; END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='signal_workspace_classification_assignment_current_v1(signal_classification_assignments,signal_classification_generations)'::regprocedure) IS DISTINCT FROM '7675fb317916d7bf768fc3ca21bee21c75cd909d024ff21675c8251c1ea132ef' THEN
  RAISE EXCEPTION 'mfp_read_guard_preimage_changed: signal_workspace_classification_assignment_current_v1'; END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='workspace_incremental_editorial_plan_unit_valid_v1(analysis_artifacts)'::regprocedure) IS DISTINCT FROM '9e73336ba26455bed278c4b4045428b5ec9b2b494fdf5ff5b384e95649b48caa' THEN
  RAISE EXCEPTION 'mfp_read_guard_preimage_changed: workspace_incremental_editorial_plan_unit_valid_v1'; END IF;
END $$;

CREATE OR REPLACE FUNCTION workspace_incremental_editorial_plan_valid_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH source_scope AS MATERIALIZED (
  SELECT source.* FROM analysis_artifacts plan JOIN signal_topic_catalog_executions source
   ON source.id=(plan.metadata->>'numeric_execution_id')::uuid AND source.workspace_id=plan.workspace_id WHERE plan.id=target
 ), known_units AS MATERIALIZED (
  SELECT unit.* FROM source_scope source CROSS JOIN LATERAL workspace_incremental_editorial_units_v1(source.id) unit
 ), plan_history AS MATERIALIZED (
  SELECT history.* FROM source_scope source CROSS JOIN LATERAL signal_workspace_incremental_projection_history_v1(source.id) history
 ) SELECT COALESCE(EXISTS(SELECT 1 FROM analysis_artifacts plan JOIN signal_topic_catalog_executions source ON source.id=(plan.metadata->>'numeric_execution_id')::uuid AND source.workspace_id=plan.workspace_id
 CROSS JOIN LATERAL(SELECT count(*) count,count(DISTINCT unit.metadata->'unit'->>'unit_key') unique_count,
 jsonb_agg(unit.metadata->'unit' ORDER BY unit.metadata->'unit'->>'unit_key' COLLATE "C") units,
 count(*) FILTER(WHERE unit.metadata->'unit'->>'status'='evidence_ready') ready,
 workspace_incremental_editorial_digest_v1(COALESCE(jsonb_agg(jsonb_build_object('component_key',unit.metadata->'unit'->>'component_key',
 'unit',jsonb_build_object('local_label',unit.metadata->'unit'->'local_label','unit_key',unit.metadata->'unit'->>'unit_key','birth_membership_digest',unit.metadata->'unit'->>'birth_membership_digest'),
 'model_origin',unit.metadata->'unit'->'model_origin') ORDER BY unit.metadata->'unit'->>'unit_key' COLLATE "C") FILTER(WHERE unit.metadata->'unit'->>'status'='evidence_ready'),'[]'::jsonb)) binding_digest,
 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(unit.metadata->'unit'->>'unit_key')::text||E'\n','' ORDER BY unit.metadata->'unit'->>'unit_key' COLLATE "C") FILTER(WHERE unit.metadata->'unit'->>'status'='evidence_ready'),''),'UTF8')),'hex') unit_digest
 FROM analysis_artifacts unit WHERE unit.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND unit.metadata->>'plan_artifact_id'=plan.id::text AND unit.workspace_id=plan.workspace_id AND (unit.metadata->>'numeric_execution_id')::uuid=source.id) census
 WHERE plan.id=target AND plan.metadata->>'contract_version'='workspace-incremental-editorial-plan-v1'
 AND workspace_incremental_editorial_source_v1(source.id)
 AND plan.metadata->>'plan_artifact_id'=plan.id::text AND plan.metadata->>'evidence_digest'=plan.metadata->'descriptor'->>'evidence_digest'
 AND plan.metadata->'descriptor'->>'contract_version'='workspace-incremental-editorial-evidence-stream-v1'
 AND plan.metadata->'descriptor'->>'representative_selection_policy'='distinct-roots-affiliation-boundary-v1'
 AND plan.metadata->'descriptor'->'stream'->>'contract_version'='workspace-incremental-editorial-evidence-jsonl-v1'
 AND plan.metadata->'descriptor'->>'numeric_execution_id'=source.id::text
 AND plan.metadata->'descriptor'->>'numeric_checkpoint_digest'=source.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
 AND plan.metadata->'descriptor'->>'population_digest'=source.result_summary->'numeric_checkpoint'->>'population_digest'
 AND plan.metadata->'descriptor'->>'numeric_manifest_sha256'=(SELECT content->>'sha256' FROM analysis_artifacts WHERE id::text=source.result_summary->'numeric_checkpoint'->>'output_artifact_id')
 AND census.count=(SELECT count(*) FROM known_units) AND census.unique_count=census.count
 AND NOT EXISTS(SELECT 1 FROM analysis_artifacts unit WHERE unit.metadata->>'plan_artifact_id'=plan.id::text AND unit.id<>plan.id AND (NOT EXISTS(SELECT 1 FROM known_units known WHERE unit.workspace_id=source.workspace_id AND (unit.metadata->>'numeric_execution_id')::uuid=source.id AND known.census_artifact_id=(unit.metadata->>'census_artifact_id')::uuid
 AND unit.metadata->'unit'->>'component_key'=known.identity->>'component_key'
 AND unit.metadata->'unit'->'model_origin'=known.identity->'model_origin'
 AND (unit.metadata->'unit'->>'local_label')::bigint=(known.identity->'unit'->>'local_label')::bigint
 AND unit.metadata->'unit'->>'unit_key'=known.identity->'unit'->>'unit_key'
 AND unit.metadata->'unit'->>'birth_membership_digest'=known.identity->'unit'->>'birth_membership_digest'
 AND unit.metadata->'unit'->>'lane'=split_part(known.identity->'unit'->>'unit_key',':',1)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['root_count','chunk_count','local_label']) field WHERE jsonb_typeof(unit.metadata->'unit'->field) IS DISTINCT FROM 'number' OR unit.metadata->'unit'->>field !~ '^(0|[1-9][0-9]*)$' OR (unit.metadata->'unit'->>field)::numeric>9007199254740991)
 AND (unit.metadata->'unit'->>'chunk_count')::bigint>=(unit.metadata->'unit'->>'root_count')::bigint
 AND ((unit.metadata->'unit'->>'chunk_count')::bigint=0)=((unit.metadata->'unit'->>'root_count')::bigint=0)
 AND unit.metadata->'unit'->>'cluster_digest'~'^sha256:[0-9a-f]{64}$'
 AND (unit.metadata->'unit'->>'root_count')::bigint BETWEEN 0 AND source.denominator
 AND (unit.metadata->'unit'->>'chunk_count')::bigint BETWEEN 0 AND source.expected_chunks
 AND (CASE unit.metadata->'unit'->>'status'
 WHEN 'editorial_claimed' THEN known.claimed_by IS NOT NULL
 WHEN 'already_interpreted' THEN EXISTS(SELECT 1 FROM plan_history history JOIN analysis_artifacts proposal ON proposal.id=history.artifact_id
  WHERE proposal.engine_execution_id::text=known.identity->'model_origin'->>'execution_id' AND proposal.metadata->'unit_keys' ? (known.identity->'unit'->>'unit_key'))
 WHEN 'legacy_full_fit' THEN NOT known.emergent AND known.claimed_by IS NULL
 WHEN 'no_current_members' THEN known.emergent AND known.claimed_by IS NULL AND unit.metadata->'unit'->>'root_count'='0' AND unit.metadata->'unit'->>'chunk_count'='0'
 WHEN 'evidence_ready' THEN known.emergent AND known.claimed_by IS NULL AND (unit.metadata->'unit'->>'root_count')::bigint>0 AND (unit.metadata->'unit'->>'chunk_count')::bigint>0
 ELSE false END)) OR unit.content<>plan.content OR unit.metadata->>'evidence_digest'<>plan.metadata->>'evidence_digest'))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions origin_run JOIN analysis_artifacts manifest ON manifest.id::text=origin_run.result_summary->'numeric_checkpoint'->>'output_artifact_id' JOIN analysis_artifacts candidate ON candidate.engine_execution_id=origin_run.id AND candidate.workspace_id=origin_run.workspace_id AND candidate.artifact_key='candidate-groups.json' WHERE origin_run.id::text=origin->>'execution_id' AND origin_run.workspace_id=source.workspace_id AND manifest.content->>'sha256'=origin->>'manifest_sha256' AND candidate.content->>'sha256'=origin->>'candidate_sha256' AND signal_workspace_incremental_parent_current_v1(origin_run.id,source.workspace_id,source.actor_user_id)))
 AND NOT EXISTS(SELECT 1 FROM known_units unit WHERE unit.emergent AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE origin->>'execution_id'=unit.identity->'model_origin'->>'execution_id'))
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['roots','chunks','memberships','pending_roots','pending_occurrences','expected_unit_count']) field WHERE jsonb_typeof(plan.metadata->'descriptor'->'census'->field) IS DISTINCT FROM 'number' OR plan.metadata->'descriptor'->'census'->>field !~ '^(0|[1-9][0-9]*)$' OR (plan.metadata->'descriptor'->'census'->>field)::numeric>9007199254740991)
 AND jsonb_typeof(plan.metadata->'descriptor'->'origins')='array'
 AND jsonb_typeof(plan.metadata->'descriptor'->'numeric_component_order')='array'
 AND (SELECT count(*)=count(DISTINCT key) AND count(*)=(source.result_summary->'numeric_checkpoint'->>'components')::bigint FROM jsonb_array_elements_text(plan.metadata->'descriptor'->'numeric_component_order') key)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(plan.metadata->'descriptor'->'numeric_component_order') key WHERE NOT EXISTS(SELECT 1 FROM analysis_artifacts component WHERE component.engine_execution_id=source.id AND component.metadata->>'contract_version'='workspace-incremental-component-v1' AND component.metadata->>'component_key'=key))
 AND (SELECT count(*)=count(DISTINCT origin->>'execution_id') FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE NOT EXISTS(SELECT 1 FROM known_units unit WHERE unit.emergent AND unit.identity->'model_origin'->>'execution_id'=origin->>'execution_id') AND NOT workspace_incremental_editorial_empty_component_v1(source.id,(origin->>'execution_id')::uuid))
 AND (plan.metadata->'descriptor'->'census'->>'pending_roots')::bigint<=LEAST(source.denominator,(plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint)
 AND ((plan.metadata->'descriptor'->'census'->>'pending_roots')::bigint=0)=((plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint=0)
 AND (plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint<=source.expected_chunks
 AND workspace_incremental_editorial_validation_v1(source.id,plan.metadata->'descriptor'->'census',plan.metadata->'descriptor'->'numeric_component_order')=source.result_summary->'numeric_checkpoint'->>'validation_digest'
 AND plan.metadata->'descriptor'->'census'->>'expected_unit_digest'=(SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(unit.identity->'unit'->>'unit_key')::text||E'\n','' ORDER BY unit.identity->'unit'->>'unit_key' COLLATE "C"),''),'UTF8')),'hex') FROM known_units unit)
 AND (plan.metadata->'descriptor'->'census'->>'roots')::bigint=source.denominator AND (plan.metadata->'descriptor'->'census'->>'chunks')::bigint=source.expected_chunks
 AND (plan.metadata->'descriptor'->'census'->>'expected_unit_count')::bigint=census.count
 AND plan.metadata->'descriptor'->'census'->>'population_digest'=source.result_summary->'numeric_checkpoint'->>'population_digest'
 AND plan.metadata->'descriptor'->>'evidence_digest'=workspace_incremental_editorial_digest_v1(((plan.metadata->'descriptor')-'evidence_digest')||jsonb_build_object('units',census.units))
 AND plan.metadata->'descriptor'->>'target_binding_digest'=census.binding_digest AND plan.metadata->'descriptor'->>'target_unit_digest'=census.unit_digest
 AND (plan.metadata->'descriptor'->'stream'->>'rows')::bigint=census.ready
 AND plan.metadata->'descriptor'->'stream'->>'sha256'=plan.content->>'sha256'
 AND plan.metadata->'descriptor'->'stream'->>'bytes'=plan.content->>'size_bytes'
 AND plan.metadata->>'history_cut_digest'=signal_workspace_incremental_projection_editorial_digest_v1(source.id)),false)
$$;

CREATE FUNCTION signal_workspace_fit_membership_row_current_v1(assignment signal_classification_assignments,generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(assignment.membership_basis='decision' OR (
  assignment.membership_basis='computed_cluster' AND assignment.disposition='pending' AND assignment.resolution_method='model'
  AND assignment.approval_policy_id IS NULL AND assignment.decided_by_user_id IS NULL
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

CREATE FUNCTION signal_workspace_incremental_membership_row_current_v1(assignment signal_classification_assignments,generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(assignment.membership_basis='decision' OR (assignment.membership_basis='computed_cluster'
  AND assignment.disposition='pending' AND assignment.resolution_method='model' AND assignment.approval_policy_id IS NULL AND assignment.decided_by_user_id IS NULL
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

CREATE FUNCTION signal_workspace_classification_assignment_row_current_v1(
 assignment signal_classification_assignments,target_generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN target_generation.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1' THEN signal_workspace_incremental_membership_row_current_v1(assignment,target_generation) ELSE signal_workspace_fit_membership_row_current_v1(assignment,target_generation) END AND COALESCE(EXISTS(
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

CREATE FUNCTION signal_workspace_projection_assignments_current_v1(generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH source AS MATERIALIZED (SELECT signal_workspace_projection_source_current_v1(generation) valid)
 SELECT source.valid AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments assignment
  WHERE assignment.generation_id=generation.id
   AND NOT signal_workspace_classification_assignment_row_current_v1(assignment,generation)) FROM source
$$;

DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'signal_workspace_fit_membership_row_current_v1(signal_classification_assignments,signal_classification_generations)',
 'signal_workspace_incremental_membership_row_current_v1(signal_classification_assignments,signal_classification_generations)',
 'signal_workspace_classification_assignment_row_current_v1(signal_classification_assignments,signal_classification_generations)',
 'signal_workspace_projection_assignments_current_v1(signal_classification_generations)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name); END IF;
  END LOOP;
 END LOOP;
END $$;
