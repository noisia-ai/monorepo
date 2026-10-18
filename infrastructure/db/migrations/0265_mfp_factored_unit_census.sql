-- Evaluate the existing validated census once per target, with every unit,
-- component, origin and claim predicate unchanged. No persistent cache or H1 DDL.
DO $$ BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
  WHERE oid='workspace_incremental_editorial_units_v1(uuid)'::regprocedure)
  IS DISTINCT FROM 'c2356d5d9f563e457fd6556c25e18976110d6528fe6a62b13b9640a41b57a7b8' THEN
  RAISE EXCEPTION 'mfp_unit_census_preimage_changed' USING ERRCODE='55000';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION workspace_incremental_editorial_units_v1(target uuid)
RETURNS TABLE(census_artifact_id uuid,component_artifact_id uuid,identity jsonb,emergent boolean,claimed_by uuid) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH validated_census AS MATERIALIZED (SELECT workspace_incremental_editorial_census_v1(target) digest)
 SELECT census.id,component.id,jsonb_build_object('component_key',component.metadata->>'component_key','unit',census.metadata->'unit','model_origin',component.metadata->'model_origin'),
 origin.input_snapshot ? 'numeric_descriptor',claim.engine_execution_id
 FROM analysis_artifacts census JOIN analysis_artifacts component ON component.engine_execution_id=census.engine_execution_id AND component.workspace_id=census.workspace_id
  AND component.metadata->>'contract_version'='workspace-incremental-component-v1' AND component.metadata->>'component_key'=census.metadata->>'component_key'
 JOIN signal_topic_catalog_executions origin ON origin.id::text=component.metadata->'model_origin'->>'execution_id' AND origin.workspace_id=component.workspace_id
 LEFT JOIN analysis_artifacts claim ON claim.workspace_id=census.workspace_id AND claim.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1'
  AND claim.metadata->>'component_key'=component.metadata->>'component_key' AND claim.metadata->'unit'->>'unit_key'=census.metadata->'unit'->>'unit_key'
 CROSS JOIN validated_census
 WHERE census.engine_execution_id=target AND census.metadata->>'contract_version'='workspace-incremental-unit-census-v1'
  AND census.metadata->>'derivation_digest'=validated_census.digest
$$;
