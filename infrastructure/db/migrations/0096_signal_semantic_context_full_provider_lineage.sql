-- Backend 69A.7P: persist the complete server-owned Semantic Context provider lineage.
--
-- Historical generations and runs remain untouched. New provider-backed generations
-- seal the canonical JSON plus its digest; runs seal that digest and concrete rates,
-- capacity, ceilings and hard-cap values. This migration creates no generation, run,
-- job, provider call, proposal, Topic Contract, assignment or serving write.
-- 0096 intentionally accepts only the current input-v2/output-v3/schema-v3 contract.
-- Advancing that contract requires a later forward-only migration and validator version;
-- it must fail closed here instead of silently reinterpreting historical generations.

ALTER TABLE signal_semantic_context_generations
  ADD COLUMN IF NOT EXISTS proposal_provider_lineage jsonb,
  ADD COLUMN IF NOT EXISTS proposal_provider_lineage_digest text;

ALTER TABLE signal_semantic_context_proposal_runs
  ADD COLUMN IF NOT EXISTS provider_lineage_digest text;

CREATE OR REPLACE FUNCTION signal_semantic_context_canonical_json_v1(value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text;entry record;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      result:='{';
      FOR entry IN SELECT key,item FROM jsonb_each(value) AS member(key,item) ORDER BY key LOOP
        IF length(result)>1 THEN result:=result||','; END IF;
        result:=result||to_jsonb(entry.key)::text||':'
          ||signal_semantic_context_canonical_json_v1(entry.item);
      END LOOP;
      RETURN result||'}';
    WHEN 'array' THEN
      result:='[';
      FOR entry IN SELECT item FROM jsonb_array_elements(value) WITH ORDINALITY AS member(item,position)
        ORDER BY position LOOP
        IF length(result)>1 THEN result:=result||','; END IF;
        result:=result||signal_semantic_context_canonical_json_v1(entry.item);
      END LOOP;
      RETURN result||']';
    ELSE
      RETURN value::text;
  END CASE;
END; $$;

CREATE OR REPLACE FUNCTION signal_semantic_context_json_object_keys_match_v1(
  value jsonb, expected text[]
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE actual text[];
BEGIN
  IF jsonb_typeof(value)<>'object' THEN RETURN false; END IF;
  SELECT COALESCE(array_agg(key ORDER BY key),'{}'::text[]) INTO actual
    FROM jsonb_object_keys(value) key;
  RETURN actual=(SELECT array_agg(item ORDER BY item) FROM unnest(expected) item);
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
     OR lineage->>'platform_hard_cap_micro_usd' !~ '^[1-9][0-9]*$'
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

ALTER TABLE signal_semantic_context_generations
  DROP CONSTRAINT IF EXISTS signal_semantic_context_generation_full_provider_lineage;
ALTER TABLE signal_semantic_context_generations
  ADD CONSTRAINT signal_semantic_context_generation_full_provider_lineage CHECK(
    (proposal_provider_lineage IS NULL AND proposal_provider_lineage_digest IS NULL)
    OR signal_semantic_context_provider_lineage_valid_v1(
      proposal_provider_lineage,proposal_provider_lineage_digest,proposal_model,
      proposal_model_version,proposal_prompt_digest,proposal_pricing_version)
  ) NOT VALID;

ALTER TABLE signal_semantic_context_proposal_runs
  DROP CONSTRAINT IF EXISTS signal_semantic_context_proposal_run_lineage_digest;
ALTER TABLE signal_semantic_context_proposal_runs
  ADD CONSTRAINT signal_semantic_context_proposal_run_lineage_digest CHECK(
    provider_lineage_digest IS NULL
    OR provider_lineage_digest ~ '^sha256:[0-9a-f]{64}$'
  ) NOT VALID;

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Semantic context generations cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF OLD.status='published' THEN
    RAISE EXCEPTION 'Published semantic context generations are immutable.' USING ERRCODE='55000';
  END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.artifact_id<>OLD.artifact_id
     OR NEW.generation_key<>OLD.generation_key OR NEW.generation_version<>OLD.generation_version
     OR NEW.supersedes_generation_id IS DISTINCT FROM OLD.supersedes_generation_id
     OR NEW.supersession_reason IS DISTINCT FROM OLD.supersession_reason
     OR NEW.brand_os_profile_id<>OLD.brand_os_profile_id
     OR NEW.brand_os_profile_version<>OLD.brand_os_profile_version
     OR NEW.brand_os_digest<>OLD.brand_os_digest
     OR NEW.knowledge_generation_key<>OLD.knowledge_generation_key
     OR NEW.knowledge_digest<>OLD.knowledge_digest
     OR NEW.locale_context_digest<>OLD.locale_context_digest
     OR NEW.primary_locale<>OLD.primary_locale OR NEW.locale_variants<>OLD.locale_variants
     OR NEW.markets<>OLD.markets OR NEW.timezone<>OLD.timezone
     OR NEW.proposal_model IS DISTINCT FROM OLD.proposal_model
     OR NEW.proposal_model_version IS DISTINCT FROM OLD.proposal_model_version
     OR NEW.proposal_prompt_digest IS DISTINCT FROM OLD.proposal_prompt_digest
     OR NEW.proposal_pricing_version IS DISTINCT FROM OLD.proposal_pricing_version
     OR NEW.proposal_provider_lineage IS DISTINCT FROM OLD.proposal_provider_lineage
     OR NEW.proposal_provider_lineage_digest IS DISTINCT FROM OLD.proposal_provider_lineage_digest
     OR NEW.created_operation_id<>OLD.created_operation_id
     OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Semantic context generation authority cannot be rewritten.' USING ERRCODE='55000';
  END IF;
  IF NEW.status='draft' AND (NEW.pack_digest IS NOT NULL OR NEW.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Draft semantic context publication fields are invalid.' USING ERRCODE='55000';
  END IF;
  IF NEW.status NOT IN ('draft','published') THEN
    RAISE EXCEPTION 'Semantic context generation lifecycle is invalid.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
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
     OR (generation.proposal_provider_lineage->>'platform_hard_cap_micro_usd')::bigint
       <NEW.hard_cap_micro_usd THEN
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
     OR NEW.hard_cap_micro_usd<>OLD.hard_cap_micro_usd
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

COMMENT ON COLUMN signal_semantic_context_generations.proposal_provider_lineage IS
  'Closed server-owned provider lineage snapshot; no browser authority, secrets, raw Knowledge or provider response.';
COMMENT ON COLUMN signal_semantic_context_generations.proposal_provider_lineage_digest IS
  'Deterministic digest of proposal_provider_lineage excluding its lineage_digest member.';
COMMENT ON COLUMN signal_semantic_context_proposal_runs.provider_lineage_digest IS
  'Full generation provider-lineage digest sealed into the immutable run identity.';
