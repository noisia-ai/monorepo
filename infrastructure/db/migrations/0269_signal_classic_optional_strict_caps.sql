-- Classic Brand Context uses the same immutable composed receipts and ledgers.
-- NULL is no configured strict maximum; token-derived reservation remains mandatory.
-- No policy, workspace feature, provider call, owner or serving row is changed here.
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT processing_nullable_action_cap;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT processing_nullable_action_cap CHECK(max_execution_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','corpus_embeddings','topic_interpretation','topic_consolidation','concept_membership_jev','concept_membership_claude','brand_context_proposal','topic_prototype_embeddings'));
ALTER TABLE signal_processing_admissions DROP CONSTRAINT processing_nullable_admission_cap;
ALTER TABLE signal_processing_admissions ADD CONSTRAINT processing_nullable_admission_cap CHECK(execution_cap_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','corpus_embeddings','topic_interpretation','topic_consolidation','concept_membership_jev','concept_membership_claude','brand_context_proposal','topic_prototype_embeddings'));
ALTER TABLE signal_brand_context_processing_receipts ALTER COLUMN semantic_cap_micro_usd DROP NOT NULL;
ALTER TABLE signal_brand_context_processing_receipts ALTER COLUMN prototype_cap_micro_usd DROP NOT NULL;
ALTER TABLE signal_brand_context_prototype_receipts ALTER COLUMN execution_cap_micro_usd DROP NOT NULL;
ALTER TABLE signal_semantic_context_proposal_runs ALTER COLUMN hard_cap_micro_usd DROP NOT NULL;
ALTER TABLE signal_semantic_context_proposal_runs ADD CONSTRAINT semantic_nullable_composed_cap CHECK(hard_cap_micro_usd IS NOT NULL OR processing_admission_id IS NOT NULL);
ALTER TABLE signal_workspace_embedding_runs DROP CONSTRAINT embedding_nullable_corpus_cap;
ALTER TABLE signal_workspace_embedding_runs ADD CONSTRAINT embedding_nullable_corpus_cap CHECK(hard_cap_micro_usd IS NOT NULL OR input_contract='corpus' OR (input_contract='topic_prototypes' AND processing_admission_id IS NOT NULL));
CREATE OR REPLACE FUNCTION signal_brand_context_processing_quote_state_v1(target_workspace uuid,target_actor uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 semantic_action signal_processing_policy_actions%ROWTYPE;prototype_action signal_processing_policy_actions%ROWTYPE;
 generation signal_semantic_context_generations%ROWTYPE;source_digest text;exposure record;
 instant timestamptz:=clock_timestamp();day date;window_start timestamptz;window_end timestamptz;remaining bigint;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN
  RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NULL THEN RAISE EXCEPTION 'processing_policy_missing' USING ERRCODE='23514'; END IF;
 IF instant<p.valid_from OR instant>=p.valid_until THEN RAISE EXCEPTION 'processing_policy_expired' USING ERRCODE='23514'; END IF;
 SELECT * INTO semantic_action FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='brand_context_proposal';
 SELECT * INTO prototype_action FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_prototype_embeddings';
 IF semantic_action.action IS NULL OR prototype_action.action IS NULL THEN
  RAISE EXCEPTION 'processing_action_unavailable' USING ERRCODE='23514'; END IF;
 IF semantic_action.kind<>'provider' OR semantic_action.provider<>'anthropic' OR semantic_action.model<>'claude-sonnet-4-6'
  OR prototype_action.kind<>'provider' OR prototype_action.provider<>'voyage' OR prototype_action.model<>'voyage-4-large'
  OR semantic_action.max_execution_micro_usd<=0 OR prototype_action.max_execution_micro_usd<=0
  OR NOT prototype_action.automatic_allowed
  OR NOT signal_processing_configuration_allows_v1('brand_context_proposal',semantic_action.configuration,semantic_action.configuration)
  OR NOT signal_brand_context_prototype_configuration_v1(prototype_action.configuration) THEN
  RAISE EXCEPTION 'processing_action_incompatible' USING ERRCODE='23514'; END IF;
 SELECT gen.* INTO generation FROM signal_semantic_context_generations gen
  WHERE gen.workspace_id=target_workspace AND gen.status='draft'
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor WHERE successor.supersedes_generation_id=gen.id)
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs run WHERE run.generation_id=gen.id)
   AND EXISTS(SELECT 1 FROM signal_governance_control_operations op WHERE op.workspace_id=gen.workspace_id
    AND op.action='prepare-brand-context' AND op.status='completed'
    AND op.brand_context_preparation->>'generation_id'=gen.id::text)
  ORDER BY gen.generation_version DESC LIMIT 1;
 IF generation.id IS NULL THEN RAISE EXCEPTION 'brand_context_generation_required' USING ERRCODE='23514'; END IF;
 IF NOT signal_brand_context_processing_source_current_v1(generation.id) THEN
  RAISE EXCEPTION 'brand_context_source_stale' USING ERRCODE='23514'; END IF;
 SELECT workspace_authority_digest INTO source_digest FROM analysis_artifacts
  WHERE id=generation.artifact_id AND workspace_id=target_workspace AND workspace_artifact_kind='semantic_context';
 IF source_digest IS NULL OR source_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object(
   'brand_os_profile_id',generation.brand_os_profile_id,'brand_os_profile_version',generation.brand_os_profile_version,
   'brand_os_digest',generation.brand_os_digest,'knowledge_generation_key',generation.knowledge_generation_key,
   'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest)) THEN
  RAISE EXCEPTION 'brand_context_source_stale' USING ERRCODE='23514'; END IF;
 day:=(instant AT TIME ZONE p.budget_timezone)::date;
 SELECT * INTO exposure FROM signal_processing_org_exposure_v1(w.organization_id,day,p.budget_timezone);
 remaining:=CASE WHEN p.daily_cap_micro_usd IS NULL THEN NULL ELSE greatest(p.daily_cap_micro_usd-exposure.total_micro_usd,0) END;
 IF semantic_action.max_execution_micro_usd+prototype_action.max_execution_micro_usd>remaining THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 window_start:=to_timestamp(floor(extract(epoch FROM instant)/300)*300);
 window_end:=least(window_start+interval '5 minutes',p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 IF window_end<=instant THEN RAISE EXCEPTION 'processing_quote_expired' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('contract_version','brand-context-processing-authority-v1',
  'workspace_id',w.id,'organization_id',w.organization_id,'brand_id',w.brand_id,'actor_user_id',target_actor,
  'quote_expires_at',window_end,'policy_id',p.id,'policy_version',p.version,'policy_digest',p.policy_digest,
  'budget_date',day,'budget_timezone',p.budget_timezone,'daily_cap_micro_usd',p.daily_cap_micro_usd,
  'exposure',to_jsonb(exposure),'remaining_micro_usd',remaining,
  'source_authority_digest',source_digest,'generation_id',generation.id,'generation_key',generation.generation_key,
  'semantic_action',to_jsonb(semantic_action)-'policy_version_id',
  'prototype_action',to_jsonb(prototype_action)-'policy_version_id');
END; $$;

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
  AND action.max_execution_micro_usd IS NOT DISTINCT FROM parent.prototype_cap_micro_usd;
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

CREATE OR REPLACE FUNCTION signal_semantic_context_provider_lineage_valid_v1(
  lineage jsonb,lineage_digest text,legacy_model text,legacy_model_version text,
  legacy_prompt_digest text,legacy_pricing_version text
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE without_digest jsonb;minimum_proposals integer;target_proposals integer;
DECLARE maximum_proposals integer;output_budget integer;configured_output integer;
DECLARE model_output integer;
BEGIN
  IF lineage IS NULL OR lineage_digest IS NULL
     OR lineage_digest !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(lineage)<>'object'
     OR NOT signal_semantic_context_json_object_keys_match_v1(lineage,ARRAY[
       'capacity','contract_version','lineage_digest','model','model_version',
       'platform_hard_cap_micro_usd','pricing','prompt','provider','token_ceilings'])
     OR NOT signal_semantic_context_json_object_keys_match_v1(lineage->'pricing',ARRAY[
       'input_usd_per_million_tokens','output_usd_per_million_tokens','unit','version'])
     OR NOT signal_semantic_context_json_object_keys_match_v1(lineage->'prompt',ARRAY[
       'digest','input_contract_version','output_contract_version','schema_contract_version'])
     OR NOT signal_semantic_context_json_object_keys_match_v1(lineage->'capacity',ARRAY[
       'capacity_digest','counts','maximum_proposals','minimum_useful_proposals',
       'output_token_budget','policy_digest','policy_version','target_proposals'])
     OR NOT signal_semantic_context_json_object_keys_match_v1(lineage#>'{capacity,counts}',ARRAY[
       'aliases','category_fields','code_switching','competitors','evidence_source_kinds',
       'knowledge_blocks','locale_variants','markets','products','structured_terms'])
     OR NOT signal_semantic_context_json_object_keys_match_v1(lineage->'token_ceilings',ARRAY[
       'configured_max_output_tokens','max_input_tokens','model_max_output_tokens']) THEN
    RETURN false;
  END IF;
  IF lineage->>'contract_version'<>'signal-semantic-context-provider-lineage-v1'
     OR COALESCE(lineage->>'provider','')=''
     OR COALESCE(lineage->>'model','')=''
     OR COALESCE(lineage->>'model_version','')=''
     OR lineage#>>'{pricing,unit}'<>'usd_per_million_tokens'
     OR COALESCE(lineage#>>'{pricing,version}','')=''
     OR lineage#>>'{pricing,input_usd_per_million_tokens}' !~ '^(0|[1-9][0-9]*)\.[0-9]{6}$'
     OR lineage#>>'{pricing,output_usd_per_million_tokens}' !~ '^(0|[1-9][0-9]*)\.[0-9]{6}$'
     OR lineage#>>'{prompt,input_contract_version}'<>'signal-semantic-context-proposal-input-v2'
     OR lineage#>>'{prompt,output_contract_version}'<>'signal-semantic-context-proposal-output-v3'
     OR lineage#>>'{prompt,schema_contract_version}'<>'signal-semantic-context-proposal-output-v3'
     OR lineage#>>'{prompt,digest}' !~ '^sha256:[0-9a-f]{64}$'
     OR lineage#>>'{capacity,policy_version}'<>'signal-semantic-context-capacity-policy-v1'
     OR lineage#>>'{capacity,policy_digest}' !~ '^sha256:[0-9a-f]{64}$'
     OR lineage#>>'{capacity,capacity_digest}' !~ '^sha256:[0-9a-f]{64}$'
     OR NOT COALESCE(lineage->'platform_hard_cap_micro_usd'='null'::jsonb OR lineage->>'platform_hard_cap_micro_usd' ~ '^[1-9][0-9]*$',false)
     OR lineage#>>'{token_ceilings,max_input_tokens}' !~ '^[1-9][0-9]*$'
     OR lineage#>>'{token_ceilings,configured_max_output_tokens}' !~ '^[1-9][0-9]*$'
     OR lineage#>>'{token_ceilings,model_max_output_tokens}' !~ '^[1-9][0-9]*$'
     OR lineage#>>'{capacity,minimum_useful_proposals}' !~ '^[1-9][0-9]*$'
     OR lineage#>>'{capacity,target_proposals}' !~ '^[1-9][0-9]*$'
     OR lineage#>>'{capacity,maximum_proposals}' !~ '^[1-9][0-9]*$'
     OR lineage#>>'{capacity,output_token_budget}' !~ '^[1-9][0-9]*$' THEN
    RETURN false;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(lineage#>'{capacity,counts}') count_value
    WHERE count_value.value !~ '^(0|[1-9][0-9]*)$') THEN RETURN false; END IF;
  minimum_proposals:=(lineage#>>'{capacity,minimum_useful_proposals}')::integer;
  target_proposals:=(lineage#>>'{capacity,target_proposals}')::integer;
  maximum_proposals:=(lineage#>>'{capacity,maximum_proposals}')::integer;
  output_budget:=(lineage#>>'{capacity,output_token_budget}')::integer;
  configured_output:=(lineage#>>'{token_ceilings,configured_max_output_tokens}')::integer;
  model_output:=(lineage#>>'{token_ceilings,model_max_output_tokens}')::integer;
  IF minimum_proposals>target_proposals OR target_proposals>maximum_proposals
     OR output_budget>configured_output OR output_budget>model_output THEN RETURN false; END IF;
  IF lineage->>'lineage_digest' IS DISTINCT FROM lineage_digest
     OR lineage->>'model' IS DISTINCT FROM legacy_model
     OR lineage->>'model_version' IS DISTINCT FROM legacy_model_version
     OR lineage#>>'{prompt,digest}' IS DISTINCT FROM legacy_prompt_digest
     OR lineage#>>'{pricing,version}' IS DISTINCT FROM legacy_pricing_version THEN RETURN false; END IF;
  without_digest:=lineage-'lineage_digest';
  RETURN signal_semantic_context_digest_v1(
    signal_semantic_context_canonical_json_v1(without_digest))=lineage_digest;
EXCEPTION WHEN data_exception OR numeric_value_out_of_range THEN
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_proposal_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||NEW.workspace_id::text,0));
  SELECT * INTO generation FROM signal_semantic_context_generations
    WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF generation.id IS NULL OR generation.status<>'draft'
     OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
       WHERE successor.supersedes_generation_id=generation.id)
     OR EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs existing
       WHERE existing.generation_id=generation.id)
     OR generation.brand_os_digest<>NEW.brand_os_digest
     OR generation.knowledge_digest<>NEW.knowledge_digest
     OR generation.locale_context_digest<>NEW.locale_context_digest
     OR generation.proposal_provider_lineage IS NULL
     OR generation.proposal_provider_lineage_digest IS NULL
     OR generation.proposal_provider_lineage_digest IS DISTINCT FROM NEW.provider_lineage_digest
     OR generation.proposal_model<>NEW.model
     OR generation.proposal_model_version<>NEW.model_version
     OR generation.proposal_prompt_digest<>NEW.prompt_digest
     OR generation.proposal_pricing_version<>NEW.pricing_version
     OR generation.proposal_provider_lineage->>'provider'<>NEW.provider
     OR generation.proposal_provider_lineage#>>'{pricing,input_usd_per_million_tokens}'
       <>to_char(NEW.input_usd_per_million_tokens,'FM999999999999990.000000')
     OR generation.proposal_provider_lineage#>>'{pricing,output_usd_per_million_tokens}'
       <>to_char(NEW.output_usd_per_million_tokens,'FM999999999999990.000000')
     OR (generation.proposal_provider_lineage#>>'{token_ceilings,max_input_tokens}')::integer
       <>NEW.max_input_tokens
     OR (generation.proposal_provider_lineage#>>'{capacity,output_token_budget}')::integer
       <>NEW.max_output_tokens
     OR (generation.proposal_provider_lineage->'platform_hard_cap_micro_usd'<>'null'::jsonb AND (NEW.hard_cap_micro_usd IS NULL OR (generation.proposal_provider_lineage->>'platform_hard_cap_micro_usd')::bigint <NEW.hard_cap_micro_usd)) THEN
    RAISE EXCEPTION 'Semantic context proposal run authority is incompatible.' USING ERRCODE='23514';
  END IF;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.created_by_user_id
     OR operation.action<>'start-semantic-context-proposal-run'
     OR operation.status<>'in_progress'
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'Semantic context proposal operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_proposal_identity_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Semantic context proposal runs cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.generation_id<>OLD.generation_id
     OR NEW.operation_id<>OLD.operation_id OR NEW.run_key<>OLD.run_key
     OR NEW.preflight_digest<>OLD.preflight_digest OR NEW.brand_os_digest<>OLD.brand_os_digest
     OR NEW.knowledge_digest<>OLD.knowledge_digest
     OR NEW.locale_context_digest<>OLD.locale_context_digest
     OR NEW.prompt_digest<>OLD.prompt_digest OR NEW.context_input_digest<>OLD.context_input_digest
     OR NEW.provider<>OLD.provider OR NEW.model<>OLD.model OR NEW.model_version<>OLD.model_version
     OR NEW.pricing_version<>OLD.pricing_version OR NEW.max_input_tokens<>OLD.max_input_tokens
     OR NEW.max_output_tokens<>OLD.max_output_tokens
     OR NEW.input_usd_per_million_tokens<>OLD.input_usd_per_million_tokens
     OR NEW.output_usd_per_million_tokens<>OLD.output_usd_per_million_tokens
     OR NEW.hard_cap_micro_usd IS DISTINCT FROM OLD.hard_cap_micro_usd
     OR NEW.reservation_micro_usd<>OLD.reservation_micro_usd
     OR NEW.provider_lineage_digest IS DISTINCT FROM OLD.provider_lineage_digest
     OR NEW.provider_request_identity<>OLD.provider_request_identity
     OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Semantic context proposal run authority cannot be rewritten.' USING ERRCODE='55000';
  END IF;
  -- Preserve the stricter terminal boundary introduced by 0094 for paid failures.
  IF (OLD.status IN ('completed','stale','dead_letter')
      OR (OLD.status='failed' AND OLD.provider_call_state='settled'))
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal semantic context proposal runs are immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION renew_signal_brand_context_semantic_admission_v1(parent_id uuid,target_actor uuid,request_key text,
 quote_hash text,stable_confirmation text,runtime_configuration jsonb,runtime_cap bigint,runtime_available boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_brand_context_semantic_renewals%ROWTYPE;parent signal_brand_context_processing_receipts%ROWTYPE;
 quoted jsonb;s jsonb;request_hash text;state text;changed integer;
BEGIN
 IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{8,200}$' OR quote_hash IS NULL OR quote_hash !~ '^sha256:[0-9a-f]{64}$'
  OR stable_confirmation IS DISTINCT FROM 'renew_brand_context_semantic_within_shown_cap' THEN
  RAISE EXCEPTION 'brand_context_semantic_renewal_request_invalid' USING ERRCODE='22023'; END IF;
 -- An immutable replay needs actor/tenant locks, but never waits for the Worker owner.
 PERFORM signal_brand_context_semantic_renewal_lock_v1(parent_id,target_actor,NOT EXISTS(
  SELECT 1 FROM signal_brand_context_semantic_renewals WHERE parent_receipt_id=parent_id
   AND actor_user_id=target_actor AND idempotency_key=request_key));
 SELECT * INTO parent FROM signal_brand_context_processing_receipts WHERE id=parent_id;
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('parent_receipt_id',parent_id,
  'actor_user_id',target_actor,'quote_digest',quote_hash,'confirmation',stable_confirmation));
 SELECT * INTO prior FROM signal_brand_context_semantic_renewals WHERE workspace_id=parent.workspace_id
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  IF prior.parent_receipt_id IS DISTINCT FROM parent_id OR prior.request_digest IS DISTINCT FROM request_hash THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
 ELSE
  quoted:=quote_signal_brand_context_semantic_renewal_v1(parent_id,target_actor);s:=quoted->'quote_snapshot';
  IF quoted->>'quote_digest' IS DISTINCT FROM quote_hash THEN
   RAISE EXCEPTION 'brand_context_semantic_renewal_quote_changed' USING ERRCODE='23514'; END IF;
  IF runtime_available IS DISTINCT FROM true THEN RAISE EXCEPTION 'brand_context_processing_runtime_unavailable' USING ERRCODE='23514'; END IF;
  IF NOT signal_processing_configuration_allows_v1('brand_context_proposal',runtime_configuration,s->'configuration')
   OR (runtime_cap IS NOT NULL AND ((s->>'execution_cap_micro_usd')::bigint IS NULL OR runtime_cap<(s->>'execution_cap_micro_usd')::bigint)) THEN
   RAISE EXCEPTION 'brand_context_processing_runtime_drift' USING ERRCODE='23514'; END IF;
  INSERT INTO signal_brand_context_semantic_renewals(parent_receipt_id,admission_id,run_id,reservation_id,workspace_id,
   organization_id,actor_user_id,generation_id,supersedes_renewal_id,policy_version_id,budget_date,budget_timezone,admission_not_after,
   idempotency_key,request_digest,quote_digest,quote_snapshot,confirmation,receipt_digest)
  VALUES(parent_id,(s->>'admission_id')::uuid,(s->>'run_id')::uuid,(s->>'reservation_id')::uuid,(s->>'workspace_id')::uuid,
   (s->>'organization_id')::uuid,target_actor,(s->>'generation_id')::uuid,(s->>'supersedes_renewal_id')::uuid,
   (s->>'policy_version_id')::uuid,(s->>'budget_date')::date,s->>'budget_timezone',(s->>'admission_not_after')::timestamptz,
   request_key,request_hash,quote_hash,s,stable_confirmation,'pending') RETURNING * INTO prior;
  UPDATE signal_semantic_context_proposal_runs SET status='queued',failed_at=NULL,error_code=NULL,error_summary=NULL,
   updated_at=clock_timestamp() WHERE id=prior.run_id AND status='failed' AND provider_call_state='not_started'
   AND provider_call_count=0 AND provider_response_private IS NULL AND lease_token IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'brand_context_semantic_renewal_incomplete' USING ERRCODE='23514'; END IF;
  UPDATE signal_semantic_context_proposal_outbox SET status='pending',available_at=clock_timestamp(),error_summary=NULL,
   lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE run_id=prior.run_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'brand_context_semantic_renewal_incomplete' USING ERRCODE='23514'; END IF;
  INSERT INTO signal_semantic_context_proposal_run_events(workspace_id,run_id,transition_key,event_kind,state_digest,detail)
   VALUES(prior.workspace_id,prior.run_id,'renewal-'||prior.id::text,'recovery_queued',prior.receipt_digest,
    jsonb_build_object('renewal_id',prior.id,'budget_date',prior.budget_date));
 END IF;
 SELECT status INTO state FROM signal_semantic_context_proposal_runs WHERE id=prior.run_id;
 RETURN jsonb_build_object('contract_version','brand-context-semantic-renewal-v1','parent_receipt_id',parent_id,
  'workspace_id',prior.workspace_id,'run_id',prior.run_id,'admission_id',prior.admission_id,'reservation_id',prior.reservation_id,
  'renewal_id',prior.id,'status',state,'replayed',s IS NULL,'admission_not_after',prior.admission_not_after);
END; $$;
