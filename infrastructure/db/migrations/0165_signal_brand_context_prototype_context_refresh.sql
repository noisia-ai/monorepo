-- A completed prototype plan may be refreshed after the server-compiled Brand
-- OS context changes. The caller still has to pass the current server-built
-- plan through quote_signal_brand_context_prototypes_v1, which validates the
-- parent generation, source authority, catalog and active provider policy.
CREATE OR REPLACE FUNCTION signal_brand_context_prototype_refresh_safe_v1(target_receipt uuid,prototype_plan jsonb)
RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts receipt
  JOIN signal_brand_context_processing_receipts parent ON parent.id=receipt.parent_receipt_id
   AND parent.workspace_id=receipt.workspace_id AND parent.organization_id=receipt.organization_id
   AND parent.brand_id=receipt.brand_id AND parent.actor_user_id=receipt.actor_user_id
   AND parent.generation_id=receipt.generation_id
  JOIN signal_semantic_context_generations generation ON generation.id=parent.generation_id
   AND generation.workspace_id=parent.workspace_id AND generation.status='published'
   AND generation.publication_schema_version='signal-semantic-context-publication-v2'
   AND generation.semantic_context_pack_digest=receipt.pack_digest
   AND generation.published_operation_id IS NOT NULL
  JOIN signal_workspace_embedding_runs run ON run.id=receipt.run_id
   AND run.workspace_id=receipt.workspace_id AND run.actor_user_id=receipt.actor_user_id
   AND run.processing_admission_id=receipt.admission_id
  JOIN signal_processing_admissions admission ON admission.id=receipt.admission_id
   AND admission.target_id=run.id AND admission.workspace_id=receipt.workspace_id
   AND admission.organization_id=receipt.organization_id AND admission.actor_user_id=receipt.actor_user_id
   AND admission.brand_context_prototype_receipt_id=receipt.id
   AND admission.brand_context_processing_receipt_id=receipt.parent_receipt_id
   AND admission.action='topic_prototype_embeddings'
  WHERE receipt.id=target_receipt AND run.input_contract='topic_prototypes'
   AND signal_brand_context_composed_generation_valid_v1(generation.id)
   AND signal_brand_context_processing_source_current_v1(generation.id)
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations newer
    WHERE newer.workspace_id=generation.workspace_id AND newer.status='published'
     AND newer.generation_version>generation.generation_version)
   AND signal_brand_context_prototype_plan_valid_v1(receipt.workspace_id,prototype_plan)
   AND prototype_plan->>'plan_digest'~'^sha256:[0-9a-f]{64}$'
   AND prototype_plan->>'context_digest'~'^sha256:[0-9a-f]{64}$'
   AND prototype_plan->'embedding_profile'=receipt.plan->'embedding_profile'
   AND run.brand_context_preparation_operation_id IS NULL AND run.status='completed'
   AND run.execution_token IS NULL AND run.execution_expires_at IS NULL
   AND run.topic_input_snapshot=receipt.plan AND run.topic_input_digest=receipt.plan_digest
   AND run.taxonomy_profile_id=receipt.taxonomy_profile_id AND run.profile=receipt.plan->'embedding_profile'
   AND run.reserved_micro_usd=0 AND run.unknown_reserved_micro_usd=0 AND run.observed_exception_micro_usd=0
   AND run.counts->>'completed_topics'=run.counts->>'total_topics'
   AND run.counts->>'processed_unique_inputs'=run.counts->>'total_unique_inputs'
   AND run.counts->>'processed_input_references'=run.counts->>'total_input_references'
   AND receipt.plan_digest IS DISTINCT FROM prototype_plan->>'plan_digest'
   AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor
    WHERE successor.supersedes_receipt_id=receipt.id)
   AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id
    AND call.status NOT IN('settled','definitely_not_sent')))
$$;

REVOKE ALL ON FUNCTION signal_brand_context_prototype_refresh_safe_v1(uuid,jsonb) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_brand_context_prototype_refresh_safe_v1(uuid,jsonb) FROM %I',role_name);
  END IF;
 END LOOP;
END; $$;
