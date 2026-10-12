-- Open discovery renews governed context while its numeric model keeps the parent
-- compatibility identity (0237). Guided/legacy history still requires equality.
-- This migration has no dependency on experimental H1 migration 0262.
-- Apply once after hash/target verification; no data, entity version, label,
-- membership, serving guard, rights or metered receipt is rewritten.
DO $guard$
BEGIN
 IF to_regprocedure('signal_workspace_discovery_context_revision_v1(uuid)') IS NULL
  OR position('discovery_population' IN pg_get_functiondef('guard_workspace_incremental_execution_v1()'::regprocedure))=0 THEN
  RAISE EXCEPTION 'incremental_context_history_requires_discovery_contract' USING ERRCODE='55000';
 END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
  WHERE oid='signal_workspace_incremental_projection_history_current_v1(uuid)'::regprocedure)
  IS DISTINCT FROM '361c0e022cfe5b27cd64cd10e839c4f7ab6a28141478e36bc0514bfcc9bd4fa5' THEN
  RAISE EXCEPTION 'incremental_context_history_preimage_changed' USING ERRCODE='55000';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION signal_workspace_incremental_projection_history_current_v1(target_execution uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions target WHERE target.id=target_execution AND target.input_snapshot ? 'numeric_descriptor')
 AND NOT EXISTS(SELECT 1 FROM signal_workspace_incremental_projection_lineage_v1(target_execution) lineage
  JOIN signal_topic_catalog_executions child ON child.id=lineage.child_id
  LEFT JOIN signal_topic_catalog_executions parent ON parent.id=lineage.parent_id AND parent.workspace_id=child.workspace_id
  CROSS JOIN LATERAL signal_workspace_incremental_editorial_cut_v1(lineage.parent_id,lineage.child_id) cut
  WHERE NOT COALESCE(parent.id IS NOT NULL AND parent.created_at<=child.created_at
   AND signal_workspace_incremental_parent_current_v1(parent.id,child.workspace_id,child.actor_user_id)
   AND CASE WHEN jsonb_typeof(child.input_snapshot->'discovery_population')='object' THEN
    jsonb_typeof(parent.input_snapshot->'discovery_population')='object'
    AND child.input_snapshot->'guides'='[]'::jsonb AND parent.input_snapshot->'guides'='[]'::jsonb
    AND child.input_snapshot->'numeric_descriptor'->'compatibility'->>'context_digest'=
      COALESCE(parent.input_snapshot->'numeric_descriptor'->'compatibility'->>'context_digest',parent.input_snapshot->>'context_digest')
    AND child.input_snapshot->'numeric_descriptor'->'compatibility'->>'input_interest_catalog_digest'=
      COALESCE(parent.input_snapshot->'numeric_descriptor'->'compatibility'->>'input_interest_catalog_digest',parent.input_snapshot->>'catalog_digest')
   ELSE parent.input_snapshot->>'context_digest'=child.input_snapshot->>'context_digest' END
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
