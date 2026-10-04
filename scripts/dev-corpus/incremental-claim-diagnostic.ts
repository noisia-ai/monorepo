/** Rollback-only claim diagnostics: preserves the production predicate and emits
 * only named booleans, never corpus text, identifiers, grants or credentials. */
export async function installMfpClaimDiagnosticV1(query:(sql:string)=>Promise<unknown>){
 await query(`CREATE FUNCTION pg_temp.mfp_editorial_claim_diagnostic() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE checks jsonb;
 BEGIN
  IF NEW.metadata->>'contract_version' IS DISTINCT FROM 'workspace-incremental-editorial-unit-claim-v1'
   OR workspace_incremental_editorial_claim_valid_v1(NEW) THEN RETURN NEW; END IF;
  SELECT jsonb_build_object(
   'owner',owner.workspace_id=NEW.workspace_id AND owner.input_contract='workspace-incremental-editorial-v1' AND owner.status='queued',
   'artifact_shape',NEW.artifact_type='engine_output' AND NEW.review_status='draft' AND NEW.workspace_artifact_kind='topic_discovery' AND pg_column_size(NEW.metadata)<=4096,
   'owner_binding',NEW.metadata->>'owner_execution_id'=owner.id::text AND NEW.metadata->>'numeric_execution_id'=owner.source_execution_id::text,
   'target_digest',NEW.metadata->>'target_unit_digest'=owner.input_snapshot->>'target_unit_digest',
   'plan_unit',EXISTS(SELECT 1 FROM analysis_artifacts plan_unit WHERE plan_unit.metadata->>'plan_artifact_id'=owner.input_snapshot->>'evidence_plan_artifact_id'
    AND plan_unit.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND plan_unit.metadata->'unit'->>'status'='evidence_ready'
    AND plan_unit.metadata->>'census_artifact_id'=census.id::text),
   'census_binding',census.engine_execution_id=owner.source_execution_id AND census.workspace_id=owner.workspace_id AND NEW.content=census.content,
   'census_contract',census.metadata->>'contract_version'='workspace-incremental-unit-census-v1',
   'derivation_digest',census.metadata->>'derivation_digest'=owner.input_snapshot->>'census_derivation_digest',
   'component_binding',component.engine_execution_id=owner.source_execution_id AND component.workspace_id=owner.workspace_id,
   'component_contract',component.metadata->>'contract_version'='workspace-incremental-component-v1',
   'origin',origin.workspace_id=owner.workspace_id AND origin.input_snapshot ? 'numeric_descriptor',
   'component_key',NEW.metadata->>'component_key'=component.metadata->>'component_key' AND census.metadata->>'component_key'=component.metadata->>'component_key',
   'unit',NEW.metadata->'unit'=census.metadata->'unit',
   'model_origin',NEW.metadata->'model_origin'=component.metadata->'model_origin',
   'authority_digest',NEW.discovery_run_digest='sha256:'||encode(sha256(convert_to(owner.input_digest||':'||owner.id::text,'UTF8')),'hex') AND NEW.workspace_authority_digest=NEW.discovery_run_digest,
   'artifact_key',NEW.artifact_key='incremental-editorial-claim-'||substring(workspace_incremental_editorial_digest_v1(jsonb_build_array(NEW.metadata->>'component_key',NEW.metadata->'unit'->>'unit_key')) FROM 8)
  ) INTO checks FROM signal_topic_catalog_executions owner
  LEFT JOIN analysis_artifacts census ON census.id=(NEW.metadata->>'census_artifact_id')::uuid
  LEFT JOIN analysis_artifacts component ON component.id=(NEW.metadata->>'component_artifact_id')::uuid
  LEFT JOIN signal_topic_catalog_executions origin ON origin.id::text=component.metadata->'model_origin'->>'execution_id'
  WHERE owner.id=NEW.engine_execution_id;
  RAISE EXCEPTION 'mfp_editorial_claim_predicate_failed' USING ERRCODE='23514',DETAIL=COALESCE(checks,'{"owner_missing":true}'::jsonb)::text;
 END $$;
 CREATE TRIGGER aaa_mfp_editorial_claim_diagnostic BEFORE INSERT ON analysis_artifacts FOR EACH ROW EXECUTE FUNCTION pg_temp.mfp_editorial_claim_diagnostic();`);
}
