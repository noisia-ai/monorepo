-- Immutable maps permit an aggregate-size cache without repeating full-corpus scans on status polls.
CREATE TABLE signal_mass_labeling_product_estimates (
 workspace_id uuid NOT NULL,map_id uuid NOT NULL,root_count integer NOT NULL CHECK(root_count>0),
 input_characters bigint NOT NULL CHECK(input_characters>=0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(map_id),FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id)
);
ALTER TABLE signal_mass_labeling_product_estimates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_mass_labeling_product_estimates FROM PUBLIC;
DO $$ DECLARE role_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON TABLE signal_mass_labeling_product_estimates FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

-- Product mass labeling uses the native processing policy on its complete prepared corpus.
-- This marker grants the existing governed actor path only to the pinned product profile.
CREATE FUNCTION signal_mass_labeling_product_engine_v2(target_workspace uuid,contract text,snapshot jsonb) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(contract='workspace-topic-engine-v1' AND snapshot->'mass_labeling_product'='true'::jsonb
   AND snapshot#>>'{engine_config,profile_version}'='workspace-bertopic-mass-labeling-v3'
   AND NOT snapshot ? 'discovery_population'
   AND snapshot#>'{interpretation_config,call_configuration}'='{"contract_version":"workspace-engine-interpretation-config-v1","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:0a06bc9251980b9b106aae4356ec4d5967a0c2116386fbaaf034ee191355fdce","schema_digest":"sha256:5831582bd98aba048f55aad6aa47f01361f262e053edd28844143d75ea972454","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"cache_read_micro_usd_per_million_tokens":300000,"cache_creation_micro_usd_per_million_tokens":3750000,"thinking":"disabled","effort":"high","max_output_tokens":16384,"token_bound_version":"utf8-request-bytes-times-four-plus-8192-v1","citation_wire_version":"group-local-reference-labels-v1","representative_count":30,"consolidation_contract_version":"workspace-mass-labeling-consolidation-v1","consolidation_prompt_digest":"sha256:62666381e9c24bba150e67475f1909d4260a86bbbbd65cf19d76865b3a1a6eff","consolidation_schema_digest":"sha256:57555a0eb2af9341cada92fe3292fa3bb9b46fd0c537462a74bf0f0da789b64d","consolidation_max_output_tokens":65536,"output_language":"en-US","localization_contract_version":"signal-topic-localization-v1","category_lexicon_contract_version":"mass-labeling-category-lexicon-v1"}'::jsonb
   AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=target_workspace AND feature='mass_labeling'),false)
$$;
REVOKE ALL ON FUNCTION signal_mass_labeling_product_engine_v2(uuid,text,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION signal_workspace_engine_actor_v1(execution signal_topic_catalog_executions,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT execution.actor_user_id=target_actor AND CASE
  WHEN (execution.input_contract IN('workspace-topic-engine-v1','workspace-incremental-editorial-v1') AND jsonb_typeof(execution.input_snapshot->'discovery_population')='object' OR signal_mass_labeling_product_engine_v2(execution.workspace_id,execution.input_contract,execution.input_snapshot))
   THEN signal_brand_context_processing_actor_v1(execution.workspace_id,target_actor)
  ELSE signal_workspace_classification_actor_v1(execution.workspace_id,target_actor) END
$$;

CREATE OR REPLACE FUNCTION signal_processing_owner_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE actor uuid;actions text[];provider text;model text;configuration jsonb;cap bigint;kind text;request_actor text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.processing_admission_id IS DISTINCT FROM OLD.processing_admission_id THEN
   RAISE EXCEPTION 'processing_admission_binding_immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='signal_corpus_preparation_runs' AND NEW.processing_admission_id IS NULL THEN
   -- Dispatch/lease recovery is mechanical. Never poison a multi-owner batch
   -- because one historical actor was revoked; the actual claim is fenced.
   IF (NEW.status='running' AND (OLD.status<>'running' OR NEW.execution_token IS DISTINCT FROM OLD.execution_token
     OR NEW.execution_expires_at IS DISTINCT FROM OLD.execution_expires_at))
    OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id THEN
    PERFORM signal_processing_lock_corpus_actor_v1(NEW.workspace_id,NEW.actor_user_id);
   END IF;
   -- A new reader can reuse completed evidence without renewing its old author.
   -- Validate each newly accepted request's actor, with the exact workspace fence.
   IF NEW.request_keys IS DISTINCT FROM OLD.request_keys THEN
    IF NOT OLD.request_keys <@ NEW.request_keys THEN
     RAISE EXCEPTION 'corpus_preparation_idempotency_conflict' USING ERRCODE='23514'; END IF;
    FOR request_actor IN SELECT value FROM jsonb_each_text(NEW.request_keys) entry WHERE NOT OLD.request_keys ? entry.key LOOP
     IF request_actor IS NULL OR request_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'corpus_preparation_forbidden' USING ERRCODE='42501'; END IF;
     PERFORM signal_processing_lock_corpus_actor_v1(NEW.workspace_id,request_actor::uuid);
    END LOOP;
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 actor:=COALESCE((to_jsonb(NEW)->>'actor_user_id')::uuid,(to_jsonb(NEW)->>'created_by_user_id')::uuid);
 -- Native MFP projection delivers recorded evidence; it is not a new provider admission.
 IF TG_TABLE_NAME='signal_topic_catalog_executions' AND to_jsonb(NEW)->>'input_contract'='workspace-topic-classification-v1'
  AND signal_workspace_discovery_projection_actor_v1(NEW.workspace_id,actor,to_jsonb(NEW)->'input_snapshot'->'source_projection') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='signal_corpus_preparation_runs' AND NEW.processing_admission_id IS NULL THEN
  PERFORM signal_processing_lock_corpus_actor_v1(NEW.workspace_id,actor);RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='signal_semantic_context_proposal_runs' THEN
  actions:=ARRAY['brand_context_proposal'];provider:=NEW.provider;model:=NEW.model;cap:=NEW.hard_cap_micro_usd;
  SELECT jsonb_object_agg(key,value) INTO configuration FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(ARRAY[
   'provider','model','model_version','pricing_version','max_input_tokens','max_output_tokens',
   'input_usd_per_million_tokens','output_usd_per_million_tokens']);
 ELSIF TG_TABLE_NAME='signal_workspace_embedding_runs' THEN
  kind:=to_jsonb(NEW)->>'input_contract';
  actions:=CASE WHEN kind='topic_prototypes' THEN ARRAY['topic_prototype_embeddings'] ELSE ARRAY['corpus_embeddings'] END;
  provider:=NEW.profile->>'provider';model:=NEW.profile->>'model';configuration:=NEW.profile;cap:=NEW.hard_cap_micro_usd;
 ELSIF TG_TABLE_NAME='signal_corpus_preparation_runs' THEN
  actions:=ARRAY['corpus_preparation'];configuration:='{}';cap:=0;
 ELSIF NEW.input_contract='workspace-incremental-editorial-v1' AND jsonb_typeof(NEW.input_snapshot->'discovery_population')='object' THEN
  IF NEW.processing_admission_id IS NULL THEN RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
  actions:=ARRAY['topic_interpretation'];configuration:=NEW.input_snapshot->'interpretation_configuration';
  provider:=configuration->>'provider';model:=configuration->>'model';cap:=(NEW.input_snapshot->>'claude_cap_micro_usd')::bigint;
 ELSIF (NEW.input_contract='workspace-topic-engine-v1' AND jsonb_typeof(NEW.input_snapshot->'discovery_population')='object' OR signal_mass_labeling_product_engine_v2(NEW.workspace_id,NEW.input_contract,NEW.input_snapshot)) THEN
  IF NEW.processing_admission_id IS NULL THEN RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
  IF NEW.input_snapshot ? 'numeric_descriptor' THEN
   actions:=ARRAY['topic_fit_incremental'];configuration:='{}';cap:=0;
  ELSE
   actions:=ARRAY['topic_interpretation'];configuration:=NEW.input_snapshot->'interpretation_config'->'call_configuration';
   provider:=configuration->>'provider';model:=configuration->>'model';cap:=(NEW.input_snapshot->>'claude_cap_micro_usd')::bigint;
  END IF;
 ELSE
  IF NEW.input_contract='workspace-incremental-editorial-v1' AND EXISTS(SELECT 1 FROM users WHERE id=actor AND user_type='client') THEN
   RAISE EXCEPTION 'processing_interpretation_binding_unavailable' USING ERRCODE='23514'; END IF;
  actions:=CASE WHEN NEW.input_contract='workspace-incremental-editorial-v1'
    THEN ARRAY['topic_interpretation_incremental']
    WHEN NEW.input_snapshot ? 'numeric_descriptor' THEN ARRAY['topic_fit_incremental'] ELSE ARRAY['topic_fit'] END;
  configuration:='{}';cap:=0;
 END IF;
 -- Admission-bearing owners cannot be attached to existing history by UPDATE.
 -- New client execution paths remain disabled by their existing actor predicates.
 PERFORM signal_processing_capacity_v1(NEW.workspace_id,actor,NEW.id,NEW.processing_admission_id,
  actions,provider,model,configuration,cap);
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION signal_processing_ledger_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner jsonb;actor uuid;admission uuid;actions text[];provider text;model text;configuration jsonb;cap bigint;
 amount bigint;stamp timestamptz;kind text;entry_id uuid;reservation_org uuid;
BEGIN
 IF TG_TABLE_NAME='signal_semantic_context_budget_reservations' THEN
  IF TG_OP='UPDATE' AND NOT (OLD.status='released' AND NEW.status='reserved') THEN RETURN NEW; END IF;
  IF NEW.status<>'reserved' THEN RETURN NEW; END IF;
  SELECT to_jsonb(r) INTO owner FROM signal_semantic_context_proposal_runs r WHERE id=NEW.run_id;
  kind:='semantic';amount:=NEW.reservation_micro_usd;stamp:=NEW.reserved_at;entry_id:=NEW.id;
 ELSIF TG_TABLE_NAME='signal_semantic_context_proposal_runs' THEN
  IF NOT (OLD.provider_call_state='not_started' AND NEW.provider_call_state='in_flight') THEN RETURN NEW; END IF;
  owner:=to_jsonb(NEW);kind:='semantic';
  SELECT id,reservation_micro_usd,reserved_at,processing_organization_id INTO entry_id,amount,stamp,reservation_org
   FROM signal_semantic_context_budget_reservations WHERE run_id=NEW.id AND status='reserved';
  IF reservation_org IS NOT NULL AND reservation_org IS DISTINCT FROM
    (SELECT organization_id FROM signal_workspaces WHERE id=NEW.workspace_id) THEN
   RAISE EXCEPTION 'processing_money_scope_changed' USING ERRCODE='23514'; END IF;
  IF entry_id IS NULL THEN RAISE EXCEPTION 'processing_reservation_required' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='signal_workspace_embedding_calls' THEN
  IF TG_OP='UPDATE' AND NOT (OLD.status='reserved' AND NEW.status='in_flight') THEN RETURN NEW; END IF;
  SELECT to_jsonb(r) INTO owner FROM signal_workspace_embedding_runs r WHERE id=NEW.run_id;
  kind:='voyage';amount:=NEW.reserved_micro_usd;stamp:=NEW.reserved_at;entry_id:=NEW.id;
 ELSE
  IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NOT (OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN RETURN NEW; END IF;
  SELECT to_jsonb(r) INTO owner FROM signal_topic_catalog_executions r WHERE id=NEW.catalog_execution_id;
  kind:='interpretation';amount:=NEW.reserved_micro_usd;stamp:=NEW.created_at;entry_id:=NEW.id;
 END IF;
 IF TG_TABLE_NAME<>'signal_semantic_context_proposal_runs' THEN
  IF NEW.processing_organization_id IS NOT NULL AND NEW.processing_organization_id IS DISTINCT FROM
    (SELECT organization_id FROM signal_workspaces WHERE id=NEW.workspace_id) THEN
   RAISE EXCEPTION 'processing_money_scope_changed' USING ERRCODE='23514'; END IF;
 END IF;
 IF kind='semantic' THEN
  actor:=(owner->>'created_by_user_id')::uuid;actions:=ARRAY['brand_context_proposal'];provider:=owner->>'provider';model:=owner->>'model';
  SELECT jsonb_object_agg(key,value) INTO configuration FROM jsonb_each(owner) WHERE key=ANY(ARRAY[
   'provider','model','model_version','pricing_version','max_input_tokens','max_output_tokens','input_usd_per_million_tokens','output_usd_per_million_tokens']);
  cap:=(owner->>'hard_cap_micro_usd')::bigint;admission:=(owner->>'processing_admission_id')::uuid;
 ELSIF kind='voyage' THEN
  actor:=(owner->>'actor_user_id')::uuid;actions:=CASE WHEN owner->>'input_contract'='topic_prototypes' THEN ARRAY['topic_prototype_embeddings'] ELSE ARRAY['corpus_embeddings'] END;
  configuration:=owner->'profile';provider:=configuration->>'provider';model:=configuration->>'model';
  cap:=(owner->>'hard_cap_micro_usd')::bigint;admission:=(owner->>'processing_admission_id')::uuid;
 ELSE
  actor:=NEW.actor_user_id;actions:=ARRAY['topic_interpretation','topic_interpretation_incremental'];
  provider:=NEW.provider;model:=NEW.model;configuration:=NEW.call_configuration;
  -- Phase 5 must supply a validated atomic binding; no client Claude send is
  -- authorized by the free fit admission or by merely knowing a target UUID.
  IF (owner->>'input_contract' IN('workspace-topic-engine-v1','workspace-incremental-editorial-v1') AND jsonb_typeof(owner->'input_snapshot'->'discovery_population')='object' OR signal_mass_labeling_product_engine_v2((owner->>'workspace_id')::uuid,owner->>'input_contract',owner->'input_snapshot')) THEN
   admission:=(owner->>'processing_admission_id')::uuid;cap:=(owner->'input_snapshot'->>'claude_cap_micro_usd')::bigint;
   IF admission IS NULL THEN RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
  ELSE admission:=NULL;cap:=0; END IF;
 END IF;
 PERFORM signal_processing_capacity_v1(NEW.workspace_id,actor,(owner->>'id')::uuid,admission,actions,
  provider,model,configuration,cap,kind,entry_id,amount,stamp);
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION signal_processing_capacity_pre0160_v1(target_workspace uuid,target_actor uuid,target_run uuid,admission_id uuid,
 allowed_actions text[],actual_provider text,actual_model text,actual_configuration jsonb,owner_cap bigint,
 ledger_kind text DEFAULT NULL,ledger_id uuid DEFAULT NULL,amount bigint DEFAULT 0,reserved_time timestamptz DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE org uuid;p signal_processing_policy_versions%ROWTYPE;r signal_processing_admissions%ROWTYPE;
 day date;spent bigint;run_spent bigint;client_actor boolean;mfp boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions e WHERE e.id=target_run AND e.workspace_id=target_workspace AND (e.input_contract IN('workspace-topic-engine-v1','workspace-incremental-editorial-v1') AND jsonb_typeof(e.input_snapshot->'discovery_population')='object' OR signal_mass_labeling_product_engine_v2(e.workspace_id,e.input_contract,e.input_snapshot))) INTO mfp;
 SELECT organization_id INTO org FROM signal_workspaces WHERE id=target_workspace;
 IF org IS NULL THEN RAISE EXCEPTION 'processing_scope_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||org::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=org AND status='active';
 SELECT user_type='client' INTO client_actor FROM users WHERE id=target_actor;
 IF admission_id IS NULL AND client_actor THEN
  RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
 -- Historical internal work without a live product policy keeps the SQL0155
 -- compatibility path. Every policy-backed path takes the day lock before any
 -- actor/grant row lock, matching admission and revocation lock order.
 IF admission_id IS NULL AND (p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until) THEN RETURN; END IF;
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN
  RAISE EXCEPTION 'processing_policy_expired' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(org,day);
 IF admission_id IS NOT NULL THEN
  SELECT * INTO r FROM signal_processing_admissions WHERE id=admission_id;
  IF r.action IN('brand_context_proposal','topic_prototype_embeddings','topic_interpretation') THEN
   PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
  ELSE PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor); END IF;
  IF r.workspace_id IS DISTINCT FROM target_workspace OR r.organization_id IS DISTINCT FROM org
   OR r.actor_user_id IS DISTINCT FROM target_actor OR r.target_id IS DISTINCT FROM target_run
   OR NOT r.action=ANY(allowed_actions) OR r.provider IS DISTINCT FROM actual_provider OR r.model IS DISTINCT FROM actual_model
   OR NOT signal_processing_configuration_allows_v1(r.action,r.configuration,actual_configuration)
   OR (r.execution_cap_micro_usd IS NOT NULL AND (owner_cap IS NULL OR owner_cap>r.execution_cap_micro_usd)) OR r.policy_version_id IS DISTINCT FROM p.id
   OR clock_timestamp()>=r.admission_not_after THEN
   RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF (admission_id IS NOT NULL AND r.budget_date<>day AND NOT (mfp AND r.action='topic_interpretation'))
  OR (reserved_time IS NOT NULL AND (reserved_time AT TIME ZONE p.budget_timezone)::date<>day AND NOT (mfp AND p.daily_cap_micro_usd IS NULL)) THEN
  RAISE EXCEPTION 'processing_budget_date_expired' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(org,day,p.budget_timezone,ledger_kind,ledger_id);
 IF admission_id IS NOT NULL AND ledger_kind IS NOT NULL THEN
  IF ledger_kind='semantic' THEN
   SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_micro_usd WHEN status='released' THEN 0 ELSE reservation_micro_usd END),0)
    INTO run_spent FROM signal_semantic_context_budget_reservations WHERE run_id=target_run AND id<>ledger_id;
  ELSIF ledger_kind='voyage' THEN
   SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd WHEN status='definitely_not_sent' THEN 0
    ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0) INTO run_spent
    FROM signal_workspace_embedding_calls WHERE run_id=target_run AND id<>ledger_id;
  ELSE
   SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END),0)
    INTO run_spent FROM engine_cost_events WHERE catalog_execution_id=target_run AND id<>ledger_id;
  END IF;
  IF run_spent+amount>r.execution_cap_micro_usd THEN
   RAISE EXCEPTION 'processing_execution_cap_exhausted' USING ERRCODE='23514'; END IF;
 END IF;
 IF amount>0 AND spent+amount>p.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION guard_workspace_engine_analysis_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE fit jsonb; config jsonb; coverage record; materialization analysis_artifacts%ROWTYPE; output analysis_artifacts%ROWTYPE;
BEGIN
 IF NEW.input_contract<>'workspace-topic-engine-v1' THEN RETURN NEW; END IF;
 config:=NEW.input_snapshot->'interpretation_config';
 IF config IS NULL THEN RETURN NEW; END IF;
 IF NOT COALESCE(jsonb_typeof(config)='object' AND jsonb_typeof(config->'call_configuration')='object'
   AND config->'call_configuration'->>'provider'='anthropic'
   AND config->'call_configuration'->>'prompt_digest'~'^sha256:[0-9a-f]{64}$'
   AND config->'call_configuration'->>'schema_digest'~'^sha256:[0-9a-f]{64}$'
   AND ((NEW.input_snapshot->>'claude_cap_micro_usd')::bigint>0 OR ((jsonb_typeof(NEW.input_snapshot->'discovery_population')='object' OR signal_mass_labeling_product_engine_v2(NEW.workspace_id,NEW.input_contract,NEW.input_snapshot)) AND NEW.input_snapshot->'claude_cap_micro_usd'='null'::jsonb))
   AND ((config->>'daily_cap_micro_usd')::bigint>0 OR ((jsonb_typeof(NEW.input_snapshot->'discovery_population')='object' OR signal_mass_labeling_product_engine_v2(NEW.workspace_id,NEW.input_contract,NEW.input_snapshot)) AND config->'daily_cap_micro_usd'='null'::jsonb))
   AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=config->>'budget_timezone'),false) THEN
  RAISE EXCEPTION 'Analysis interpretation configuration is invalid.' USING ERRCODE='23514'; END IF;
 fit:=NEW.result_summary->'fit_checkpoint';
 IF TG_OP='UPDATE' AND OLD.result_summary->'fit_checkpoint' IS NOT NULL
   AND OLD.result_summary->'fit_checkpoint' IS DISTINCT FROM fit THEN
  RAISE EXCEPTION 'Fitted analysis checkpoint is immutable.' USING ERRCODE='23514'; END IF;
 IF fit IS NOT NULL THEN
  SELECT * INTO output FROM analysis_artifacts WHERE id=(fit->>'output_artifact_id')::uuid
   AND workspace_id=NEW.workspace_id AND engine_execution_id=NEW.id AND artifact_type='engine_output';
  IF output.id IS NULL OR NOT COALESCE(fit->>'checkpoint_digest'~'^sha256:[0-9a-f]{64}$'
    AND jsonb_typeof(fit->'interpretation_manifest')='object'
    AND (fit->'interpretation_manifest'->>'unit_count')::bigint>=0
    AND fit->'interpretation_manifest'->>'unit_digest'~'^sha256:[0-9a-f]{64}$'
    AND ((fit->>'result_kind'='insufficient_population' AND fit->>'model_version_id' IS NULL AND fit->>'model_artifact_id' IS NULL)
      OR (fit->>'result_kind'='computational_grouping' AND EXISTS(SELECT 1 FROM tagging_model_versions model JOIN analysis_artifacts artifact
        ON artifact.id=(fit->>'model_artifact_id')::uuid AND artifact.workspace_id=NEW.workspace_id AND artifact.engine_execution_id=NEW.id
        AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=model.artifact_digest
        WHERE model.id=(fit->>'model_version_id')::uuid AND model.configuration->>'execution_id'=NEW.id::text))),false)
    OR NEW.processed_roots<>NEW.denominator OR NEW.processed_chunks<>NEW.expected_chunks THEN
   RAISE EXCEPTION 'Analysis fit checkpoint is incomplete.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='ready' THEN
  SELECT * INTO coverage FROM signal_workspace_engine_interpretation_coverage_v1(NEW.id);
  SELECT * INTO materialization FROM analysis_artifacts WHERE id=(NEW.result_summary->'analysis_checkpoint'->>'materialization_artifact_id')::uuid
   AND workspace_id=NEW.workspace_id AND engine_execution_id=NEW.id AND artifact_key='materialization.json' AND artifact_type='engine_proposals'
   AND metadata->>'contract_version'='workspace-topic-materialization-v1';
  IF fit IS NULL OR materialization.id IS NULL OR coverage.unit_count<>coverage.unique_count
   OR coverage.unit_count IS DISTINCT FROM (fit->'interpretation_manifest'->>'unit_count')::bigint
   OR coverage.unit_digest IS DISTINCT FROM fit->'interpretation_manifest'->>'unit_digest'
   OR coverage.unit_count IS DISTINCT FROM (NEW.result_summary->>'interpreted_units')::bigint
   OR materialization.metadata->>'interpretation_units_digest' IS DISTINCT FROM coverage.unit_digest
   OR materialization.metadata->>'output_catalog_profile_id' IS DISTINCT FROM NEW.result_summary->'analysis_checkpoint'->>'output_catalog_profile_id'
   OR materialization.metadata->>'output_catalog_revision' IS DISTINCT FROM NEW.result_summary->'analysis_checkpoint'->>'output_catalog_revision'
   OR materialization.metadata->>'mapping_digest' IS DISTINCT FROM NEW.result_summary->'analysis_checkpoint'->>'mapping_digest'
   OR materialization.metadata->>'topic_count' IS DISTINCT FROM NEW.result_summary->>'materialized_topics'
   OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=NEW.id AND workspace_contract='workspace-engine-interpretation-v1'
     AND call_state IN('reserved','in_flight','response_persisted','outcome_unknown')) THEN
   RAISE EXCEPTION 'Analysis cannot complete with partial interpretation or unresolved cost.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_workspace_engine_interpretation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; prior engine_cost_events%ROWTYPE; run_spent bigint; day_spent bigint;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.workspace_contract IS NOT NULL THEN RAISE EXCEPTION 'Provider monetary evidence is retained.' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND NEW.workspace_contract IS DISTINCT FROM OLD.workspace_contract THEN
  RAISE EXCEPTION 'Provider ledger authority cannot be converted.' USING ERRCODE='23514'; END IF;
 IF NEW.workspace_contract IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||NEW.actor_user_id::text,0));
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
  IF NEW.budget_daily_cap_micro_usd IS NULL AND NOT COALESCE((jsonb_typeof(execution.input_snapshot->'discovery_population')='object' OR signal_mass_labeling_product_engine_v2(execution.workspace_id,execution.input_contract,execution.input_snapshot)),false) THEN RAISE EXCEPTION 'workspace_interpretation_strict_cap_required' USING ERRCODE='23514'; END IF;
  IF execution.input_contract='workspace-incremental-editorial-v1' AND NOT workspace_incremental_editorial_ledger_request_v1(NEW) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_not_admitted' USING ERRCODE='23514'; END IF;
  IF execution.input_snapshot->'interpretation_config' IS NOT NULL AND (
    execution.status<>'running' OR execution.execution_expires_at<=clock_timestamp() OR execution.result_summary->'fit_checkpoint' IS NULL
    OR NEW.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,NEW.metadata->>'interpretation_revision_digest')
    OR NEW.budget_timezone IS DISTINCT FROM execution.input_snapshot->'interpretation_config'->>'budget_timezone'
    OR NEW.budget_daily_cap_micro_usd IS DISTINCT FROM (execution.input_snapshot->'interpretation_config'->>'daily_cap_micro_usd')::bigint
    OR NOT signal_workspace_engine_actor_v1(execution,NEW.actor_user_id)) THEN
   RAISE EXCEPTION 'Analysis interpretation requires its live checkpoint and sealed configuration.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.budget_timezone)
   OR (NEW.budget_date<>(clock_timestamp() AT TIME ZONE NEW.budget_timezone)::date AND NOT ((execution.input_snapshot ? 'discovery_population' OR signal_mass_labeling_product_engine_v2(execution.workspace_id,execution.input_contract,execution.input_snapshot)) AND NEW.budget_daily_cap_micro_usd IS NULL)) THEN
   RAISE EXCEPTION 'Provider daily authority is invalid.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN call_state='settled' OR call_state='terminal_confirmed'
       AND metadata->'provider_terminal_billing_reconciliation'->>'contract_version'='workspace-provider-terminal-billing-v1'
       THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END)
     FILTER(WHERE catalog_execution_id=NEW.catalog_execution_id),0),
    COALESCE(sum(CASE WHEN call_state='settled' OR call_state='terminal_confirmed'
       AND metadata->'provider_terminal_billing_reconciliation'->>'contract_version'='workspace-provider-terminal-billing-v1'
       THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END)
     FILTER(WHERE budget_date=NEW.budget_date),0) INTO run_spent,day_spent
   FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=NEW.actor_user_id AND id<>NEW.id;
  IF run_spent+NEW.reserved_micro_usd>(execution.input_snapshot->>'claude_cap_micro_usd')::bigint
   OR day_spent+NEW.reserved_micro_usd>NEW.budget_daily_cap_micro_usd THEN
   RAISE EXCEPTION 'Provider reservation exceeds its budget.' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.retry_of_call_id IS NOT NULL THEN
   SELECT * INTO prior FROM engine_cost_events WHERE id=NEW.retry_of_call_id FOR UPDATE;
   IF prior.id IS NULL OR prior.workspace_contract IS DISTINCT FROM NEW.workspace_contract
    OR prior.workspace_id<>NEW.workspace_id OR prior.catalog_execution_id<>NEW.catalog_execution_id
    OR prior.actor_user_id<>NEW.actor_user_id OR prior.call_state NOT IN('definitely_not_sent','terminal_confirmed') OR prior.response_storage_key IS NOT NULL
    OR prior.request_digest<>NEW.request_digest OR prior.call_configuration<>NEW.call_configuration
    OR prior.reserved_micro_usd<>NEW.reserved_micro_usd OR prior.attempt_token=NEW.attempt_token THEN
    RAISE EXCEPTION 'Provider retry requires an exact unsent or externally confirmed terminal predecessor.' USING ERRCODE='23514'; END IF;
  ELSIF EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=NEW.catalog_execution_id AND request_digest=NEW.request_digest
    AND workspace_contract='workspace-engine-interpretation-v1') THEN
   RAISE EXCEPTION 'Provider request retry requires an explicit predecessor.' USING ERRCODE='23514';
  END IF;
  IF execution.id IS NULL OR NOT ((execution.input_contract='workspace-topic-engine-v1' AND ((execution.input_snapshot->'interpretation_config' IS NULL AND execution.status='ready') OR (execution.input_snapshot->'interpretation_config' IS NOT NULL AND execution.status='running' AND execution.execution_expires_at>clock_timestamp() AND execution.result_summary->'fit_checkpoint' IS NOT NULL))) OR (execution.input_contract='workspace-incremental-editorial-v1' AND workspace_incremental_editorial_ledger_request_v1(NEW)))
   OR execution.actor_user_id<>NEW.actor_user_id OR NEW.call_state<>'reserved'
   OR NOT signal_workspace_engine_actor_v1(execution,NEW.actor_user_id)
   OR NEW.reserved_micro_usd>(execution.input_snapshot->>'claude_cap_micro_usd')::bigint
   OR NEW.input_tokens<>0 OR NEW.output_tokens<>0 OR NEW.total_tokens<>0 OR NEW.settled_micro_usd IS NOT NULL
   OR NEW.response_storage_key IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NOT COALESCE(NEW.call_configuration->>'provider'=NEW.provider AND NEW.call_configuration->>'model'=NEW.model
     AND NEW.call_configuration->>'prompt_digest'~'^sha256:[0-9a-f]{64}$'
     AND NEW.call_configuration->>'schema_digest'~'^sha256:[0-9a-f]{64}$',false) THEN
   RAISE EXCEPTION 'Provider reservation authority is invalid.' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.workspace_id,NEW.catalog_execution_id,NEW.actor_user_id,NEW.idempotency_key,NEW.request_digest,NEW.request_seal,
     NEW.call_configuration,NEW.attempt_token,NEW.retry_of_call_id,NEW.reserved_micro_usd,NEW.provider,NEW.model,NEW.operation,
     NEW.budget_date,NEW.budget_timezone,NEW.budget_daily_cap_micro_usd,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.catalog_execution_id,OLD.actor_user_id,OLD.idempotency_key,OLD.request_digest,OLD.request_seal,
     OLD.call_configuration,OLD.attempt_token,OLD.retry_of_call_id,OLD.reserved_micro_usd,OLD.provider,OLD.model,OLD.operation,
     OLD.budget_date,OLD.budget_timezone,OLD.budget_daily_cap_micro_usd,OLD.created_at) THEN
   RAISE EXCEPTION 'Provider request and budget are immutable.' USING ERRCODE='23514'; END IF;
  IF OLD.call_state IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Final provider cost evidence is immutable.' USING ERRCODE='55000'; END IF;
  IF OLD.call_state='terminal_confirmed' AND NEW IS DISTINCT FROM OLD AND NOT COALESCE((
    NEW.call_state='terminal_confirmed' AND NEW.response_storage_key IS NULL
    AND OLD.metadata ? 'provider_terminal_receipt'
    AND NEW.metadata->'provider_terminal_receipt' IS NOT DISTINCT FROM OLD.metadata->'provider_terminal_receipt'
    AND NEW.metadata-'usage'-'provider_terminal_billing_reconciliation' IS NOT DISTINCT FROM OLD.metadata
    AND NEW.metadata->'usage' IS NOT DISTINCT FROM OLD.metadata->'provider_terminal_receipt'->'usage'
    AND jsonb_typeof(NEW.metadata->'provider_terminal_billing_reconciliation')='object'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'contract_version'='workspace-provider-terminal-billing-v1'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'method'='audited_usage_pricing'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'provider_request_id'=OLD.metadata->'provider_terminal_receipt'->>'provider_request_id'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'terminal_receipt_digest'=
      'sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(OLD.metadata->'provider_terminal_receipt'),'UTF8')),'hex')
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'actual_micro_usd'=OLD.metadata->'provider_terminal_receipt'->>'usage_cost_micro_usd'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->'usage' IS NOT DISTINCT FROM OLD.metadata->'provider_terminal_receipt'->'usage'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'verified_by_user_id'~'^[0-9a-f-]{36}$'
    AND NEW.metadata->'provider_terminal_billing_reconciliation'->>'reconciled_at' IS NOT NULL
    AND NEW.settled_micro_usd=(OLD.metadata->'provider_terminal_receipt'->>'usage_cost_micro_usd')::bigint
    AND NEW.input_tokens=(OLD.metadata->'provider_terminal_receipt'->'usage'->>'input_tokens')::int
      +(OLD.metadata->'provider_terminal_receipt'->'usage'->>'cache_read_input_tokens')::int
      +(OLD.metadata->'provider_terminal_receipt'->'usage'->>'cache_creation_input_tokens')::int
    AND NEW.output_tokens=(OLD.metadata->'provider_terminal_receipt'->'usage'->>'output_tokens')::int
    AND NEW.total_tokens=NEW.input_tokens+NEW.output_tokens
    AND NEW.estimated_cost_usd=(NEW.settled_micro_usd::numeric/1000000)::numeric(10,4)
    AND NEW.settled_at IS NOT NULL
    AND EXISTS(SELECT 1 FROM users verifier WHERE verifier.id=(NEW.metadata->'provider_terminal_billing_reconciliation'->>'verified_by_user_id')::uuid
      AND verifier.status='active' AND verifier.user_type='noisia_internal' AND verifier.primary_role IN('noisia_admin','admin','founder'))
    AND signal_workspace_classification_actor_v1(NEW.workspace_id,(NEW.metadata->'provider_terminal_billing_reconciliation'->>'verified_by_user_id')::uuid)
    AND abs(extract(epoch FROM (NEW.metadata->'provider_terminal_billing_reconciliation'->>'reconciled_at')::timestamptz-clock_timestamp()))<=60
    AND (to_jsonb(NEW)-ARRAY['settled_micro_usd','input_tokens','output_tokens','total_tokens','estimated_cost_usd','metadata','settled_at'])
      IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['settled_micro_usd','input_tokens','output_tokens','total_tokens','estimated_cost_usd','metadata','settled_at'])
   ),false) THEN RAISE EXCEPTION 'Final provider cost evidence is immutable.' USING ERRCODE='55000'; END IF;
  IF NEW.call_state<>OLD.call_state AND NOT (
   (OLD.call_state='reserved' AND NEW.call_state IN('in_flight','definitely_not_sent'))
   OR (OLD.call_state='in_flight' AND NEW.call_state IN('response_persisted','outcome_unknown','definitely_not_sent'))
   OR (OLD.call_state='response_persisted' AND NEW.call_state IN('settled','outcome_unknown'))
   OR (OLD.call_state='outcome_unknown' AND (NEW.call_state IN('response_persisted','terminal_confirmed') OR NEW.call_state='settled' AND NEW.response_storage_key IS NOT NULL))
   ) THEN
   RAISE EXCEPTION 'Provider state transition is invalid.' USING ERRCODE='23514'; END IF;
  IF OLD.response_storage_key IS NOT NULL AND COALESCE((NEW.metadata->>'response_complete')::boolean,true)
    IS DISTINCT FROM COALESCE((OLD.metadata->>'response_complete')::boolean,true) THEN
   RAISE EXCEPTION 'Provider transport completeness is immutable.' USING ERRCODE='23514'; END IF;
  IF NEW.call_state='settled' AND NOT COALESCE((NEW.metadata->>'response_complete')::boolean,true) THEN
   RAISE EXCEPTION 'Incomplete provider transport cannot be settled.' USING ERRCODE='23514'; END IF;
  IF OLD.response_storage_key IS NOT NULL AND ROW(NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes,NEW.response_http_status,NEW.provider_request_id)
    IS DISTINCT FROM ROW(OLD.response_storage_key,OLD.response_sha256,OLD.response_size_bytes,OLD.response_http_status,OLD.provider_request_id) THEN
   RAISE EXCEPTION 'Provider response evidence is immutable.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

-- Unit claims retain their original receipt fence for the governed product actor.
CREATE OR REPLACE FUNCTION guard_workspace_interpretation_recovery_evidence_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_topic_catalog_executions%ROWTYPE; receipt engine_cost_events%ROWTYPE;
 exception signal_workspace_interpretation_exceptions%ROWTYPE; artifact analysis_artifacts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Interpretation recovery evidence is append-only.' USING ERRCODE='55000'; END IF;
 SELECT * INTO run FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF COALESCE(run.id IS NULL OR run.status<>'running' OR run.execution_expires_at<=clock_timestamp()
  OR run.input_contract<>'workspace-topic-engine-v1'
  OR run.input_snapshot#>>'{engine_config,profile_version}' NOT IN('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
  OR run.result_summary->'fit_checkpoint' IS NULL OR NEW.created_by_user_id<>run.actor_user_id
  OR NOT (signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id)
    OR signal_mass_labeling_product_engine_v2(run.workspace_id,run.input_contract,run.input_snapshot)
      AND signal_brand_context_processing_actor_v1(NEW.workspace_id,NEW.created_by_user_id)),true) THEN
  RAISE EXCEPTION 'workspace_engine_interpretation_recovery_invalid' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='signal_workspace_interpretation_unit_claims' THEN
  SELECT * INTO receipt FROM engine_cost_events WHERE id=NEW.original_call_id;
  IF COALESCE(NEW.input_digest<>run.input_digest OR NEW.fit_checkpoint_digest<>run.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR receipt.id IS NULL OR receipt.workspace_id<>NEW.workspace_id OR receipt.catalog_execution_id<>NEW.execution_id
   OR receipt.actor_user_id<>run.actor_user_id OR receipt.workspace_contract<>'workspace-engine-interpretation-v1'
   OR receipt.metadata ? 'editorial_repair' OR receipt.metadata ? 'mass_labeling_stage'
   OR receipt.request_digest<>NEW.original_request_digest
   OR receipt.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(run.id,receipt.metadata->>'interpretation_revision_digest')
   OR (receipt.metadata ? 'unit_manifest' AND NOT receipt.metadata->'unit_manifest' ? NEW.unit_key),true) THEN
   RAISE EXCEPTION 'workspace_engine_interpretation_unit_claim_invalid' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='signal_workspace_interpretation_receipt_reviews' THEN
  SELECT * INTO receipt FROM engine_cost_events WHERE id=NEW.call_id;
  IF COALESCE(NEW.input_digest<>run.input_digest OR NEW.fit_checkpoint_digest<>run.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR receipt.id IS NULL OR receipt.workspace_id<>NEW.workspace_id OR receipt.catalog_execution_id<>NEW.execution_id
   OR receipt.actor_user_id<>run.actor_user_id OR receipt.call_state<>'settled' OR receipt.response_http_status<>200
   OR NOT COALESCE((receipt.metadata->>'response_complete')::boolean,true) OR receipt.response_storage_key IS NULL
   OR receipt.metadata ? 'editorial_repair' OR receipt.metadata ? 'mass_labeling_stage'
   OR receipt.response_sha256<>NEW.response_sha256 OR receipt.request_digest<>NEW.request_digest
   OR receipt.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(run.id,receipt.metadata->>'interpretation_revision_digest')
   OR NEW.unit_manifest IS DISTINCT FROM (SELECT jsonb_agg(claim.unit_key ORDER BY claim.unit_key COLLATE "C")
      FROM signal_workspace_interpretation_unit_claims claim WHERE claim.execution_id=run.id AND claim.original_request_digest=receipt.request_digest)
   OR EXISTS(SELECT 1 FROM engine_cost_events repair WHERE repair.catalog_execution_id=run.id AND repair.metadata#>>'{editorial_repair,source_call_id}'=receipt.id::text
     AND NOT COALESCE(repair.call_state IN('reserved','definitely_not_sent','terminal_confirmed') AND repair.response_storage_key IS NULL
      AND repair.workspace_id=run.workspace_id AND repair.actor_user_id=run.actor_user_id AND repair.call_configuration=receipt.call_configuration
      AND repair.metadata#>>'{editorial_repair,source_request_digest}'=receipt.request_digest
      AND repair.metadata#>>'{editorial_repair,source_response_sha256}'=receipt.response_sha256,false)),true) THEN
   RAISE EXCEPTION 'workspace_engine_interpretation_recovery_review_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO exception FROM signal_workspace_interpretation_exceptions WHERE id=NEW.exception_id;
  SELECT * INTO artifact FROM analysis_artifacts WHERE id=NEW.artifact_id;
  SELECT * INTO receipt FROM engine_cost_events WHERE id=NEW.call_id;
  IF COALESCE(exception.id IS NULL OR exception.workspace_id<>run.workspace_id OR exception.execution_id<>run.id
   OR exception.input_digest<>run.input_digest OR exception.fit_checkpoint_digest<>run.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR artifact.id IS NULL OR artifact.workspace_id<>run.workspace_id OR artifact.engine_execution_id<>run.id
   OR artifact.metadata->>'contract_version'<>'workspace-engine-interpretation-checkpoint-v1'
   OR artifact.metadata->'unit_keys' IS DISTINCT FROM exception.unit_manifest
   OR artifact.metadata->>'call_id'<>NEW.call_id::text
   OR receipt.id NOT IN(exception.original_call_id,exception.repair_call_id) OR receipt.call_state<>'settled'
   OR receipt.response_http_status<>200 OR receipt.workspace_id<>run.workspace_id OR receipt.catalog_execution_id<>run.id
   OR receipt.response_sha256<>NEW.resolved_response_sha256 OR artifact.metadata->>'response_sha256'<>receipt.response_sha256
   OR NEW.original_response_sha256<>exception.original_response_sha256 OR NEW.repair_response_sha256<>exception.repair_response_sha256,true) THEN
   RAISE EXCEPTION 'workspace_engine_interpretation_exception_resolution_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
