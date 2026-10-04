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

-- Validate the sealed empty component without mutating its immutable artifact.
CREATE FUNCTION workspace_incremental_editorial_component_empty_v1(component analysis_artifacts)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(component.metadata->>'contract_version'='workspace-incremental-component-v1'
  AND component.metadata->>'unit_count'='0'
  AND component.metadata->>'unit_digest'=workspace_incremental_editorial_digest_v1('[]'::jsonb)
  AND workspace_incremental_editorial_census_v1(component.engine_execution_id) IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM analysis_artifacts unit
   WHERE unit.engine_execution_id=component.engine_execution_id AND unit.metadata->>'contract_version'='workspace-incremental-unit-census-v1'
    AND unit.metadata->>'component_key'=component.metadata->>'component_key'
    AND unit.metadata->>'derivation_digest'=workspace_incremental_editorial_census_v1(component.engine_execution_id)),false)
$$;
-- This condition grants no authority and is never used by automatic dispatch.
-- target_origin binds an evidence origin to its exact sealed model origin.
CREATE FUNCTION workspace_incremental_editorial_empty_component_v1(target uuid,target_origin uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(workspace_incremental_editorial_source_v1(target),false)
 AND EXISTS(SELECT 1 FROM analysis_artifacts component
  WHERE component.engine_execution_id=target
   AND (target_origin IS NULL OR component.metadata->'model_origin'->>'execution_id'=target_origin::text)
   AND workspace_incremental_editorial_component_empty_v1(component))
$$;

-- An origin can own zero units while its numeric component and files remain sealed.
CREATE OR REPLACE FUNCTION workspace_incremental_editorial_plan_valid_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM analysis_artifacts plan JOIN signal_topic_catalog_executions source ON source.id=(plan.metadata->>'numeric_execution_id')::uuid AND source.workspace_id=plan.workspace_id
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
 AND census.count=(workspace_incremental_editorial_targets_v1(source.id)->>'expected_units')::bigint AND census.unique_count=census.count
 AND NOT EXISTS(SELECT 1 FROM analysis_artifacts unit WHERE unit.metadata->>'plan_artifact_id'=plan.id::text AND unit.id<>plan.id AND (NOT workspace_incremental_editorial_plan_unit_valid_v1(unit) OR unit.content<>plan.content OR unit.metadata->>'evidence_digest'<>plan.metadata->>'evidence_digest'))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions origin_run JOIN analysis_artifacts manifest ON manifest.id::text=origin_run.result_summary->'numeric_checkpoint'->>'output_artifact_id' JOIN analysis_artifacts candidate ON candidate.engine_execution_id=origin_run.id AND candidate.workspace_id=origin_run.workspace_id AND candidate.artifact_key='candidate-groups.json' WHERE origin_run.id::text=origin->>'execution_id' AND origin_run.workspace_id=source.workspace_id AND manifest.content->>'sha256'=origin->>'manifest_sha256' AND candidate.content->>'sha256'=origin->>'candidate_sha256' AND signal_workspace_incremental_parent_current_v1(origin_run.id,source.workspace_id,source.actor_user_id)))
 AND NOT EXISTS(SELECT 1 FROM workspace_incremental_editorial_units_v1(source.id) unit WHERE unit.emergent AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE origin->>'execution_id'=unit.identity->'model_origin'->>'execution_id'))
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['roots','chunks','memberships','pending_roots','pending_occurrences','expected_unit_count']) field WHERE jsonb_typeof(plan.metadata->'descriptor'->'census'->field) IS DISTINCT FROM 'number' OR plan.metadata->'descriptor'->'census'->>field !~ '^(0|[1-9][0-9]*)$' OR (plan.metadata->'descriptor'->'census'->>field)::numeric>9007199254740991)
 AND jsonb_typeof(plan.metadata->'descriptor'->'origins')='array'
 AND jsonb_typeof(plan.metadata->'descriptor'->'numeric_component_order')='array'
 AND (SELECT count(*)=count(DISTINCT key) AND count(*)=(source.result_summary->'numeric_checkpoint'->>'components')::bigint FROM jsonb_array_elements_text(plan.metadata->'descriptor'->'numeric_component_order') key)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(plan.metadata->'descriptor'->'numeric_component_order') key WHERE NOT EXISTS(SELECT 1 FROM analysis_artifacts component WHERE component.engine_execution_id=source.id AND component.metadata->>'contract_version'='workspace-incremental-component-v1' AND component.metadata->>'component_key'=key))
 AND (SELECT count(*)=count(DISTINCT origin->>'execution_id') FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE NOT EXISTS(SELECT 1 FROM workspace_incremental_editorial_units_v1(source.id) unit WHERE unit.emergent AND unit.identity->'model_origin'->>'execution_id'=origin->>'execution_id') AND NOT workspace_incremental_editorial_empty_component_v1(source.id,(origin->>'execution_id')::uuid))
 AND (plan.metadata->'descriptor'->'census'->>'pending_roots')::bigint<=LEAST(source.denominator,(plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint)
 AND ((plan.metadata->'descriptor'->'census'->>'pending_roots')::bigint=0)=((plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint=0)
 AND (plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint<=source.expected_chunks
 AND workspace_incremental_editorial_validation_v1(source.id,plan.metadata->'descriptor'->'census',plan.metadata->'descriptor'->'numeric_component_order')=source.result_summary->'numeric_checkpoint'->>'validation_digest'
 AND plan.metadata->'descriptor'->'census'->>'expected_unit_digest'=(SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(unit.identity->'unit'->>'unit_key')::text||E'\n','' ORDER BY unit.identity->'unit'->>'unit_key' COLLATE "C"),''),'UTF8')),'hex') FROM workspace_incremental_editorial_units_v1(source.id) unit)
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
REVOKE ALL ON FUNCTION workspace_incremental_editorial_component_empty_v1(analysis_artifacts),
 workspace_incremental_editorial_empty_component_v1(uuid,uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON FUNCTION workspace_incremental_editorial_component_empty_v1(analysis_artifacts),
   workspace_incremental_editorial_empty_component_v1(uuid,uuid) FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON FUNCTION workspace_incremental_editorial_component_empty_v1(analysis_artifacts),
   workspace_incremental_editorial_empty_component_v1(uuid,uuid) FROM authenticated;
 END IF;
END $$;
