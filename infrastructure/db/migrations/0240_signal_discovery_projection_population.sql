-- Full and incremental projection retain the complete eligible denominator, but
-- may inherit computed groups only while their sealed discovery population is current.
-- Historical engines without a discovery population keep their existing fences.
CREATE FUNCTION signal_workspace_discovery_population_current_v1(target_engine uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_catalog_executions%ROWTYPE; selected jsonb; expected integer;
BEGIN
 SELECT * INTO e FROM signal_topic_catalog_executions WHERE id=target_engine AND input_contract='workspace-topic-engine-v1';
 IF e.id IS NULL THEN RETURN false; END IF;
 IF NOT e.input_snapshot ? 'discovery_population' THEN RETURN true; END IF;
 selected:=e.input_snapshot->'discovery_population'->'root_ids';
 IF jsonb_typeof(selected) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 expected:=jsonb_array_length(selected);
 IF expected<>(e.input_snapshot->>'expected_roots')::integer
  OR expected<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(selected)) THEN RETURN false; END IF;
 RETURN (WITH current_facets AS MATERIALIZED (
   SELECT root_id,preparation_run_id,relevance FROM signal_mention_facets_current_v1 WHERE workspace_id=e.workspace_id
  ) SELECT count(*)=expected FROM jsonb_array_elements_text(selected) root
  JOIN current_facets f ON f.root_id=root.value::uuid AND f.preparation_run_id=e.preparation_run_id AND f.relevance='relevant');
END $$;

CREATE OR REPLACE FUNCTION signal_workspace_projection_source_current_v1(generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE generation.input_snapshot->'source_projection'->>'contract_version'
  WHEN 'workspace-topic-projection-v1' THEN signal_workspace_fit_projection_source_current_v1(generation)
  WHEN 'workspace-topic-incremental-projection-v1' THEN signal_workspace_incremental_projection_source_current_v1(generation)
  ELSE false END
 AND signal_workspace_discovery_population_current_v1((generation.input_snapshot->'source_projection'->>'engine_execution_id')::uuid)
$$;

-- Keep the row-local identity/artifact/evidence validation intact. The global
-- population scan belongs to a statement boundary, not every assignment row.
CREATE OR REPLACE FUNCTION signal_workspace_fit_membership_current_v1(assignment signal_classification_assignments,generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(assignment.membership_basis='decision' OR (
  assignment.membership_basis='computed_cluster' AND assignment.disposition='pending' AND assignment.resolution_method='model'
  AND assignment.approval_policy_id IS NULL AND assignment.decided_by_user_id IS NULL
  AND signal_workspace_fit_projection_source_current_v1(generation)
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

CREATE FUNCTION guard_signal_discovery_projection_statement_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE generation signal_classification_generations%ROWTYPE;
BEGIN
 FOR generation IN SELECT g.* FROM signal_classification_generations g
  JOIN (SELECT DISTINCT generation_id FROM inserted_assignments) affected ON affected.generation_id=g.id
  WHERE g.input_snapshot->'source_projection' IS NOT NULL LOOP
  IF NOT signal_workspace_projection_source_current_v1(generation) THEN
   RAISE EXCEPTION 'workspace_projection_source_invalid' USING ERRCODE='23514';
  END IF;
 END LOOP;
 -- No computed membership may be created outside the immutable fit population.
 -- Human decisions remain independent of discovery population membership.
 IF EXISTS(SELECT 1 FROM inserted_assignments a
  JOIN signal_classification_generations g ON g.id=a.generation_id
  JOIN signal_topic_catalog_executions e ON e.id::text=g.input_snapshot->'source_projection'->>'engine_execution_id'
  WHERE a.membership_basis='computed_cluster' AND e.input_snapshot ? 'discovery_population'
   AND NOT (e.input_snapshot->'discovery_population'->'root_ids' ? a.canonical_root_id::text)) THEN
  RAISE EXCEPTION 'workspace_projection_membership_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
-- Assignments already reject every UPDATE/DELETE through the append-only guard
-- installed by0087. A transition table validates even direct multi-row INSERTs.
CREATE TRIGGER signal_discovery_projection_statement_v1 AFTER INSERT ON signal_classification_assignments
 REFERENCING NEW TABLE AS inserted_assignments FOR EACH STATEMENT
 EXECUTE FUNCTION guard_signal_discovery_projection_statement_v1();

-- Consolidated serving uses a snapshot rather than a classification generation.
CREATE OR REPLACE FUNCTION signal_topic_consolidation_snapshot_current_v1(target_snapshot uuid) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT s.source_binding=signal_topic_editorial_source_v1(s.consolidation_run_id)
  AND r.revision_digest=s.revision_digest AND r.status IN('validated','superseded')
  AND state.input_revision=s.input_revision
  AND signal_workspace_discovery_population_current_v1(s.source_engine_execution_id)
  FROM signal_topic_consolidation_snapshots s JOIN signal_topic_consolidation_revisions r ON r.id=s.revision_id
  JOIN signal_corpus_preparation_input_state state ON state.workspace_id=s.workspace_id WHERE s.id=target_snapshot),false)
$$;
DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['signal_workspace_discovery_population_current_v1(uuid)',
  'signal_workspace_projection_source_current_v1(signal_classification_generations)',
  'signal_topic_consolidation_snapshot_current_v1(uuid)',
  'signal_workspace_fit_membership_current_v1(signal_classification_assignments,signal_classification_generations)',
  'guard_signal_discovery_projection_statement_v1()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name); END IF;
  END LOOP;
 END LOOP;
END $$;
