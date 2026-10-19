-- Explicit preparation of changed interests on the same published Brand Context.
-- No data rewrite, new ledger, or change to receipt replay / reserve / send gates.
CREATE FUNCTION signal_brand_context_prototype_refresh_safe_v1(target_receipt uuid,prototype_plan jsonb)
RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts receipt
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
   AND run.brand_context_preparation_operation_id IS NULL AND run.status='completed'
   AND run.execution_token IS NULL AND run.execution_expires_at IS NULL
   AND run.topic_input_snapshot=receipt.plan AND run.topic_input_digest=receipt.plan_digest
   AND run.taxonomy_profile_id=receipt.taxonomy_profile_id AND run.profile=receipt.plan->'embedding_profile'
   AND run.reserved_micro_usd=0 AND run.unknown_reserved_micro_usd=0 AND run.observed_exception_micro_usd=0
   AND run.counts->>'completed_topics'=run.counts->>'total_topics'
   AND run.counts->>'processed_unique_inputs'=run.counts->>'total_unique_inputs'
   AND run.counts->>'processed_input_references'=run.counts->>'total_input_references'
   AND receipt.plan_digest IS DISTINCT FROM prototype_plan->>'plan_digest'
   AND receipt.plan->>'context_digest'=prototype_plan->>'context_digest'
   AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor
    WHERE successor.supersedes_receipt_id=receipt.id)
   AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id
    AND call.status NOT IN('settled','definitely_not_sent')))
$$;

CREATE OR REPLACE FUNCTION quote_signal_brand_context_prototypes_v1(parent_receipt_id uuid,target_actor uuid,prototype_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $$
DECLARE parent signal_brand_context_processing_receipts%ROWTYPE;generation signal_semantic_context_generations%ROWTYPE;
 policy signal_processing_policy_versions%ROWTYPE;action signal_processing_policy_actions%ROWTYPE;exposure record;
 previous signal_brand_context_prototype_receipts%ROWTYPE;inherited_authorization boolean;refresh_completed boolean:=false;
 instant timestamptz:=clock_timestamp();day date;expires timestamptz;missing_count bigint;input_bytes bigint;tokens bigint;estimate bigint;
 total_count bigint;cached_count bigint;execution_cap bigint;blocked text;snapshot jsonb;
BEGIN
 SELECT * INTO parent FROM signal_brand_context_processing_receipts WHERE id=parent_receipt_id;
 IF parent.id IS NULL OR parent.actor_user_id IS DISTINCT FROM target_actor
  OR NOT signal_brand_context_processing_actor_v1(parent.workspace_id,target_actor)
  OR NOT EXISTS(SELECT 1 FROM signal_workspaces WHERE id=parent.workspace_id AND organization_id=parent.organization_id AND brand_id=parent.brand_id) THEN
  RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=parent.generation_id;
 IF generation.status IS DISTINCT FROM 'published' OR generation.publication_schema_version IS DISTINCT FROM 'signal-semantic-context-publication-v2'
  OR generation.semantic_context_pack_digest IS NULL OR generation.published_operation_id IS NULL
  OR NOT signal_brand_context_composed_generation_valid_v1(generation.id)
  OR EXISTS(SELECT 1 FROM signal_semantic_context_generations newer WHERE newer.workspace_id=parent.workspace_id
   AND newer.status='published' AND newer.generation_version>generation.generation_version)
  OR NOT signal_brand_context_processing_source_current_v1(generation.id) THEN
  RAISE EXCEPTION 'brand_context_prototype_publication_required' USING ERRCODE='23514'; END IF;
 IF NOT signal_brand_context_prototype_plan_valid_v1(parent.workspace_id,prototype_plan) THEN
  RAISE EXCEPTION 'brand_context_prototype_plan_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM signal_brand_context_prototype_receipts receipt WHERE receipt.parent_receipt_id=parent.id
  AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor WHERE successor.supersedes_receipt_id=receipt.id);
 -- A DNC continuation of an explicit refresh remains explicit, including cap0.
 -- This leaves the pre-existing automatic DNC path for the initial Stage2 intact.
 refresh_completed:=COALESCE(signal_brand_context_prototype_refresh_safe_v1(previous.id,prototype_plan),false)
  OR (COALESCE(previous.quote_snapshot->>'refreshes_completed_plan'='true',false)
   AND signal_brand_context_prototype_retry_safe_v1(previous.run_id));
 IF previous.id IS NOT NULL AND NOT refresh_completed AND NOT signal_brand_context_prototype_retry_safe_v1(previous.run_id) THEN
  RAISE EXCEPTION 'brand_context_prototype_prior_run_unresolved' USING ERRCODE='23514'; END IF;
 SELECT * INTO policy FROM signal_processing_policy_versions WHERE organization_id=parent.organization_id AND status='active';
 SELECT configured.* INTO action FROM signal_processing_policy_actions configured WHERE configured.policy_version_id=policy.id AND configured.action='topic_prototype_embeddings';
 IF policy.status IS DISTINCT FROM 'active' OR policy.organization_id IS DISTINCT FROM parent.organization_id
  OR instant<policy.valid_from OR instant>=policy.valid_until THEN
  RAISE EXCEPTION 'brand_context_prototype_authorization_expired' USING ERRCODE='23514'; END IF;
 IF action.action IS NULL OR action.kind<>'provider' OR action.provider<>'voyage' OR action.model<>'voyage-4-large' OR NOT action.automatic_allowed
  OR NOT signal_brand_context_prototype_configuration_v1(action.configuration)
  OR action.configuration IS DISTINCT FROM prototype_plan->'embedding_profile' THEN
  RAISE EXCEPTION 'brand_context_prototype_configuration_changed' USING ERRCODE='23514'; END IF;
 day:=(instant AT TIME ZONE policy.budget_timezone)::date;
 inherited_authorization:=previous.id IS NULL AND instant<parent.authorization_not_after
  AND day=parent.budget_date AND policy.budget_timezone=parent.budget_timezone AND policy.id=parent.policy_version_id
  AND (to_jsonb(action)-'policy_version_id') IS NOT DISTINCT FROM parent.quote_snapshot->'prototype_action'
  AND action.max_execution_micro_usd=parent.prototype_cap_micro_usd;
 SELECT count(*),count(*) FILTER(WHERE cache.chunk_sha256 IS NOT NULL),count(*) FILTER(WHERE cache.chunk_sha256 IS NULL),
  COALESCE(sum(octet_length(text.value)) FILTER(WHERE cache.chunk_sha256 IS NULL),0)
 INTO total_count,cached_count,missing_count,input_bytes FROM jsonb_each_text(prototype_plan->'texts') text
 LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=parent.workspace_id
  AND cache.config_digest=prototype_plan->'embedding_profile'->>'config_digest' AND cache.chunk_sha256=text.key;
 SELECT call.status INTO blocked FROM signal_workspace_embedding_calls call WHERE call.workspace_id=parent.workspace_id
  AND call.config_digest=prototype_plan->'embedding_profile'->>'config_digest' AND call.status<>'definitely_not_sent'
  AND EXISTS(SELECT 1 FROM jsonb_object_keys(prototype_plan->'texts') text_hash WHERE text_hash=ANY(call.input_keys)
   AND NOT EXISTS(SELECT 1 FROM signal_workspace_chunk_embeddings cache WHERE cache.workspace_id=parent.workspace_id
    AND cache.config_digest=call.config_digest AND cache.chunk_sha256=text_hash)) LIMIT 1;
 IF blocked IS NOT NULL THEN RAISE EXCEPTION 'brand_context_prototype_prior_call_unresolved' USING ERRCODE='23514'; END IF;
 tokens:=input_bytes*3+missing_count*64;estimate:=(tokens*12+99)/100+greatest(0,missing_count-1);
 IF estimate>action.max_execution_micro_usd THEN RAISE EXCEPTION 'processing_execution_cap_exhausted' USING ERRCODE='23514'; END IF;
 -- Complete physical cache coverage grants no provider capacity, even when the
 -- policy ceiling is larger or the organization's paid budget is exhausted.
 execution_cap:=CASE WHEN missing_count=0 THEN 0 ELSE action.max_execution_micro_usd END;
 SELECT * INTO exposure FROM signal_processing_org_exposure_v1(parent.organization_id,day,policy.budget_timezone);
 IF execution_cap>0 AND exposure.total_micro_usd+execution_cap>policy.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 expires:=least(to_timestamp(floor(extract(epoch FROM instant)/300)*300)+interval '5 minutes',
  CASE WHEN inherited_authorization THEN parent.authorization_not_after ELSE policy.valid_until END,
  policy.valid_until,((day+1)::timestamp AT TIME ZONE policy.budget_timezone));
 snapshot:=jsonb_build_object('contract_version','brand-context-prototypes-authority-v1','parent_receipt_id',parent.id,
  'workspace_id',parent.workspace_id,'organization_id',parent.organization_id,'brand_id',parent.brand_id,'actor_user_id',target_actor,
  'generation_id',generation.id,'pack_digest',generation.semantic_context_pack_digest,'source_authority_digest',parent.source_authority_digest,
  'supersedes_receipt_id',previous.id,'refreshes_completed_plan',refresh_completed,
  'requires_confirmation',refresh_completed OR NOT inherited_authorization AND missing_count>0,
  'authorization_state',CASE WHEN NOT refresh_completed AND (inherited_authorization OR missing_count=0) THEN 'automatic_ready' ELSE 'awaiting_authorization' END,
  'taxonomy_profile_id',prototype_plan->>'taxonomy_profile_id','plan_digest',prototype_plan->>'plan_digest',
  'context_digest',prototype_plan->>'context_digest',
  'policy_version_id',policy.id,'policy_digest',policy.policy_digest,'configuration_digest',action.configuration_digest,
  'execution_cap_micro_usd',execution_cap,'budget_date',day,'budget_timezone',policy.budget_timezone,
  'admission_not_after',least(CASE WHEN inherited_authorization THEN parent.authorization_not_after ELSE policy.valid_until END,
    policy.valid_until,((day+1)::timestamp AT TIME ZONE policy.budget_timezone)),
  'quote_expires_at',expires,'exposure',to_jsonb(exposure),'total_unique_inputs',total_count,'cached_unique_inputs',cached_count,
  'missing_unique_inputs',missing_count,'input_bytes',input_bytes,'tokens_upper',tokens,'estimated_upper_micro_usd',estimate,'requires_provider',missing_count>0);
 RETURN jsonb_build_object('quote_snapshot',snapshot,'quote_digest',signal_semantic_context_digest_json_v2(snapshot));
END; $$;

-- CREATE OR REPLACE preserves the existing quote ACL. Only the new helper needs revocation.
REVOKE ALL ON FUNCTION signal_brand_context_prototype_refresh_safe_v1(uuid,jsonb) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_brand_context_prototype_refresh_safe_v1(uuid,jsonb) FROM %I',role_name);
  END IF;
 END LOOP;
END; $$;
