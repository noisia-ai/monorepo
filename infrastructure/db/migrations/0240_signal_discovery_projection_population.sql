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
  'signal_topic_consolidation_snapshot_current_v1(uuid)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name); END IF;
  END LOOP;
 END LOOP;
END $$;
