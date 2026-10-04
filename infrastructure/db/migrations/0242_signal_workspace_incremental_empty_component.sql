-- Empty components are valid numeric output. Match the checkpoint's canonical []
-- without changing its identity, stored files, unit census or evidence guards.
CREATE OR REPLACE FUNCTION workspace_incremental_editorial_validation_v1(target uuid,census jsonb,component_order jsonb) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT workspace_incremental_editorial_digest_v1(jsonb_build_object('contract_version','workspace-incremental-file-validation-v1',
 'request_digest',workspace_incremental_editorial_digest_v1(jsonb_build_object('input',input.metadata->'input','runtime_digest',source.input_snapshot->'numeric_descriptor'->'compatibility'->>'runtime_digest')),
 'population_digest',source.result_summary->'numeric_checkpoint'->>'population_digest',
 'complete_file_digest',(SELECT workspace_incremental_editorial_digest_v1(jsonb_agg(jsonb_build_object('file',artifact_key,'sha256',content->>'sha256','bytes',(content->>'size_bytes')::bigint) ORDER BY artifact_key COLLATE "C"))
 FROM analysis_artifacts file WHERE file.engine_execution_id=source.id AND file.metadata->>'filename'=file.artifact_key AND file.id::text<>source.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'),
 'origin_digest',(SELECT workspace_incremental_editorial_digest_v1(jsonb_agg(jsonb_build_object('component_key',component.metadata->>'component_key','lane',component.metadata->>'lane','model_origin',component.metadata->'model_origin',
 'model',jsonb_build_object('sha256',model.content->>'sha256','bytes',(model.content->>'size_bytes')::bigint),
 'center',CASE WHEN center.id IS NULL THEN NULL ELSE jsonb_build_object('sha256',center.content->>'sha256','bytes',(center.content->>'size_bytes')::bigint) END,
 'units',(SELECT COALESCE(jsonb_agg(unit.metadata->'unit' ORDER BY (unit.metadata->'unit'->>'local_label')::bigint),'[]'::jsonb) FROM analysis_artifacts unit WHERE unit.engine_execution_id=source.id
 AND unit.metadata->>'contract_version'='workspace-incremental-unit-census-v1' AND unit.metadata->>'component_key'=component.metadata->>'component_key' AND unit.metadata->>'derivation_digest'=workspace_incremental_editorial_census_v1(source.id))) ORDER BY ordering.ordinality))
 FROM jsonb_array_elements_text(component_order) WITH ORDINALITY ordering(component_key,ordinality)
 JOIN analysis_artifacts component ON component.metadata->>'component_key'=ordering.component_key JOIN analysis_artifacts model ON model.id=(component.metadata->>'model_artifact_id')::uuid
 LEFT JOIN analysis_artifacts center ON center.id=(component.metadata->>'center_artifact_id')::uuid
 WHERE component.engine_execution_id=source.id AND component.metadata->>'contract_version'='workspace-incremental-component-v1'),
 'roots',(census->>'roots')::bigint,'occurrences',(census->>'chunks')::bigint,'memberships',(census->>'memberships')::bigint,
 'pending_occurrences',(census->>'pending_occurrences')::bigint,'relations_scope','new_candidates_in_this_execution'))
 FROM signal_topic_catalog_executions source JOIN analysis_artifacts input ON input.id::text=source.result_summary->'numeric_checkpoint'->>'input_artifact_id' WHERE source.id=target
$$;

-- Enables an explicit free preparation retry only for this verifiable condition.
-- This predicate grants no authority and is never used by automatic dispatch.
CREATE FUNCTION workspace_incremental_editorial_empty_component_v1(target uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(workspace_incremental_editorial_source_v1(target),false)
 AND EXISTS(SELECT 1 FROM analysis_artifacts component
  WHERE component.engine_execution_id=target
   AND component.metadata->>'contract_version'='workspace-incremental-component-v1'
   AND component.metadata->>'unit_count'='0'
   AND component.metadata->>'unit_digest'=workspace_incremental_editorial_digest_v1('[]'::jsonb)
   AND NOT EXISTS(SELECT 1 FROM analysis_artifacts unit
    WHERE unit.engine_execution_id=target AND unit.metadata->>'contract_version'='workspace-incremental-unit-census-v1'
     AND unit.metadata->>'component_key'=component.metadata->>'component_key'
     AND unit.metadata->>'derivation_digest'=workspace_incremental_editorial_census_v1(target)))
$$;
REVOKE ALL ON FUNCTION workspace_incremental_editorial_empty_component_v1(uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON FUNCTION workspace_incremental_editorial_empty_component_v1(uuid) FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON FUNCTION workspace_incremental_editorial_empty_component_v1(uuid) FROM authenticated;
 END IF;
END $$;
