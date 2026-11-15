-- Governed whole-map review over the existing monetary ledger. No policy or provider is enabled.
CREATE FUNCTION signal_listening_discovery_review_configuration_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('contract_version','listening-discovery-round-v1','provider','anthropic','model','claude-sonnet-4-6',
  'pricing_version','claude-sonnet-4-6-global-2026-11-14','input_rate',3000000,'output_rate',15000000,'cache_read_rate',300000,
  'cache_5m_rate',3750000,'cache_1h_rate',6000000,'reservation_input_rate',6000000,'context_tokens',1000000,
  'maximum_output_tokens',64000,'maximum_request_bytes',2097152,'input_bound','utf8-bytes-plus4096-v1',
  'prompt_digest','sha256:c5b6f157f107b9eab6805ca03eec4feb5414e6eae95445c5d6887bcd9d4582ea',
  'schema_digest','sha256:1d849d35081d143476c6256dbbda6bbd68f229f210b4c5f6b8dee60a95b79b92')
$$;
-- Pinned standard/global prices and 1M context: https://platform.claude.com/docs/en/models/sonnet-4-6/overview
-- Cache categories: https://platform.claude.com/docs/en/about-claude/pricing
CREATE TABLE signal_listening_discovery_executions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),map_id uuid NOT NULL,initial_configuration_id uuid NOT NULL,
 initial_generation_id uuid NOT NULL,initial_preparation_id uuid REFERENCES signal_listening_preparations(id),initial_classification_run_id uuid NOT NULL,
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),configuration jsonb NOT NULL,configuration_digest text NOT NULL,
 policy jsonb NOT NULL,policy_digest text NOT NULL,root_census_digest text NOT NULL,root_count integer NOT NULL CHECK(root_count>0),
 cap_micro_usd bigint NOT NULL CHECK(cap_micro_usd>0),idempotency_key text NOT NULL,request_digest text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','completed','failed','stale','outcome_unknown')),
 error_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,actor_user_id,idempotency_key),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(workspace_id,initial_configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,initial_generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,initial_classification_run_id) REFERENCES signal_labeling_runs(workspace_id,id)
);
CREATE UNIQUE INDEX signal_listening_discovery_one_execution ON signal_listening_discovery_executions(workspace_id) WHERE status IN('active','outcome_unknown');
CREATE TABLE signal_listening_discovery_rounds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 3),input_generation_id uuid NOT NULL,configuration_id uuid NOT NULL,
 admission_id uuid,configuration jsonb NOT NULL,configuration_digest text NOT NULL,
 request_body text NOT NULL,request_digest text NOT NULL,request_sha256 text NOT NULL,source_digest text NOT NULL,
 population_digest text NOT NULL,quote jsonb NOT NULL,reservation_micro_usd bigint NOT NULL CHECK(reservation_micro_usd>0),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','reviewing','reviewed','classifying','completed','failed','stale','outcome_unknown')),
 execution_token uuid,execution_expires_at timestamptz,output_configuration_id uuid,output_digest text,
 classification_preparation_id uuid REFERENCES signal_listening_preparations(id),classification_run_id uuid,
 output_generation_id uuid,planned_child_cap_micro_usd bigint,stop_decision jsonb,error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(execution_id,ordinal),UNIQUE(admission_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_listening_discovery_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,input_generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,output_configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,output_generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,classification_run_id) REFERENCES signal_labeling_runs(workspace_id,id),
 FOREIGN KEY(workspace_id,admission_id) REFERENCES signal_processing_admissions(workspace_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX signal_listening_discovery_one_active_round ON signal_listening_discovery_rounds(execution_id)
 WHERE status IN('queued','reviewing','reviewed','classifying','outcome_unknown');
CREATE TABLE signal_listening_discovery_children(
 execution_id uuid NOT NULL,workspace_id uuid NOT NULL,run_id uuid NOT NULL UNIQUE,preparation_id uuid REFERENCES signal_listening_preparations(id),round_id uuid,
 PRIMARY KEY(execution_id,run_id),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_listening_discovery_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id),FOREIGN KEY(workspace_id,round_id) REFERENCES signal_listening_discovery_rounds(workspace_id,id)
);
ALTER TABLE engine_cost_events ADD COLUMN listening_round_id uuid,
 ADD CONSTRAINT listening_discovery_engine_round FOREIGN KEY(workspace_id,listening_round_id) REFERENCES signal_listening_discovery_rounds(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE engine_cost_events DROP CONSTRAINT workspace_interpretation_shape;
ALTER TABLE engine_cost_events ADD CONSTRAINT workspace_interpretation_shape CHECK(
 ((((workspace_contract IS NULL) AND (engine_analysis_id IS NOT NULL) AND (workspace_id IS NULL) AND (catalog_execution_id IS NULL) AND (call_state IS NULL)) OR COALESCE(((workspace_contract = 'workspace-engine-interpretation-v1'::text) AND (engine_analysis_id IS NULL) AND (pipeline_step_id IS NULL) AND (workspace_id IS NOT NULL) AND (catalog_execution_id IS NOT NULL) AND (actor_user_id IS NOT NULL) AND (provider = 'anthropic'::text) AND ((length(model) >= 1) AND (length(model) <= 120)) AND (operation = 'workspace-engine-interpretation'::text) AND (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'::text) AND (request_digest ~ '^sha256:[0-9a-f]{64}$'::text) AND (request_seal ~ '^sha256:[0-9a-f]{64}$'::text) AND (jsonb_typeof(call_configuration) = 'object'::text) AND (pg_column_size(call_configuration) <= 16384) AND (call_state = ANY (ARRAY['reserved'::text, 'in_flight'::text, 'response_persisted'::text, 'settled'::text, 'outcome_unknown'::text, 'definitely_not_sent'::text, 'terminal_confirmed'::text])) AND (attempt_token IS NOT NULL) AND (reserved_micro_usd > 0) AND ((settled_micro_usd IS NULL) OR (settled_micro_usd >= 0)) AND (budget_date IS NOT NULL) AND ((length(budget_timezone) >= 1) AND (length(budget_timezone) <= 100)) AND ((budget_daily_cap_micro_usd IS NULL) OR (budget_daily_cap_micro_usd > 0)) AND (((response_storage_key IS NULL) AND (response_sha256 IS NULL) AND (response_size_bytes IS NULL) AND (response_http_status IS NULL)) OR ((response_storage_key ~~ (((('workspace-engine/'::text || (workspace_id)::text) || '/'::text) || (catalog_execution_id)::text) || '/%'::text)) AND (response_sha256 ~ '^sha256:[0-9a-f]{64}$'::text) AND (response_size_bytes >= 0) AND ((response_http_status >= 100) AND (response_http_status <= 599)))) AND ((call_state <> 'response_persisted'::text) OR (response_storage_key IS NOT NULL)) AND ((call_state <> 'settled'::text) OR ((response_storage_key IS NOT NULL) AND (settled_micro_usd IS NOT NULL) AND (settled_at IS NOT NULL)))), false)) AND listening_round_id IS NULL)
 OR COALESCE(workspace_contract='listening-discovery-round-v1' AND engine_analysis_id IS NULL AND pipeline_step_id IS NULL AND catalog_execution_id IS NULL
  AND listening_round_id IS NOT NULL AND workspace_id IS NOT NULL AND actor_user_id IS NOT NULL AND provider='anthropic' AND model='claude-sonnet-4-6'
  AND operation='listening-discovery-review' AND idempotency_key~'^[A-Za-z0-9._:-]{8,200}$' AND request_digest~'^sha256:[0-9a-f]{64}$'
  AND request_seal~'^sha256:[0-9a-f]{64}$' AND call_configuration=signal_listening_discovery_review_configuration_v1()
  AND call_state IN('reserved','in_flight','response_persisted','settled','outcome_unknown','definitely_not_sent')
  AND attempt_token IS NOT NULL AND retry_of_call_id IS NULL AND reserved_micro_usd>0 AND budget_date IS NOT NULL AND budget_timezone IS NOT NULL
  AND (settled_micro_usd IS NULL OR settled_micro_usd>=0)
  AND ((response_storage_key IS NULL AND response_sha256 IS NULL AND response_size_bytes IS NULL AND response_http_status IS NULL)
   OR (response_storage_key LIKE 'workspace-engine/'||workspace_id::text||'/'||listening_round_id::text||'/%' AND response_sha256~'^sha256:[0-9a-f]{64}$' AND response_size_bytes>=0 AND response_http_status BETWEEN 100 AND 599))
  AND (call_state<>'response_persisted' OR response_storage_key IS NOT NULL)
  AND (call_state<>'settled' OR response_storage_key IS NOT NULL AND settled_micro_usd IS NOT NULL AND settled_at IS NOT NULL),false));
CREATE UNIQUE INDEX signal_listening_discovery_one_call ON engine_cost_events(listening_round_id) WHERE workspace_contract='listening-discovery-round-v1';
CREATE INDEX signal_listening_discovery_money_day ON engine_cost_events(processing_organization_id,budget_date,id) INCLUDE(call_state,reserved_micro_usd,settled_micro_usd) WHERE workspace_contract='listening-discovery-round-v1';
CREATE UNIQUE INDEX signal_listening_discovery_request_no_resend ON engine_cost_events(workspace_id,request_digest) WHERE workspace_contract='listening-discovery-round-v1' AND call_state<>'definitely_not_sent';
CREATE TABLE signal_listening_discovery_raw_receipts(
 call_id uuid PRIMARY KEY REFERENCES engine_cost_events(id),workspace_id uuid NOT NULL,round_id uuid NOT NULL,attempt_token uuid NOT NULL,
 request_digest text NOT NULL,raw_text text NOT NULL,raw_sha256 text NOT NULL,size_bytes bigint NOT NULL,storage_key text NOT NULL,
 verification_status text NOT NULL DEFAULT 'planned' CHECK(verification_status IN('planned','verified')),verified_at timestamptz,FOREIGN KEY(workspace_id,round_id) REFERENCES signal_listening_discovery_rounds(workspace_id,id),
 CHECK(octet_length(raw_text)=size_bytes),CHECK(raw_sha256='sha256:'||encode(sha256(convert_to(raw_text,'UTF8')),'hex'))
);
CREATE TABLE signal_listening_serving_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,round_id uuid NOT NULL,map_id uuid NOT NULL,
 configuration_id uuid NOT NULL,generation_id uuid NOT NULL,classification_run_id uuid NOT NULL,snapshot_digest text NOT NULL,
 activated_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(round_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_listening_discovery_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,round_id) REFERENCES signal_listening_discovery_rounds(workspace_id,id),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,classification_run_id) REFERENCES signal_labeling_runs(workspace_id,id)
);
CREATE INDEX signal_listening_serving_latest ON signal_listening_serving_snapshots(workspace_id,created_at DESC,id DESC);
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_name;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_name CHECK((action = ANY (ARRAY['brand_context_proposal'::text, 'topic_prototype_embeddings'::text, 'corpus_preparation'::text, 'corpus_embeddings'::text, 'topic_fit'::text, 'topic_interpretation'::text, 'topic_fit_incremental'::text, 'topic_interpretation_incremental'::text, 'topic_consolidation'::text, 'topic_consolidation_numeric'::text, 'interest_decision'::text, 'mention_facets'::text, 'concept_membership'::text, 'concept_membership_jev'::text, 'concept_membership_claude'::text, 'mass_labeling_jev'::text, 'monitoring_insights'::text])) OR action='listening_discovery_review');
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_provider;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_provider CHECK((((kind = 'free'::text) AND (action = ANY (ARRAY['corpus_preparation'::text, 'topic_fit'::text, 'topic_fit_incremental'::text, 'topic_consolidation_numeric'::text])) AND (provider IS NULL) AND (model IS NULL) AND (max_execution_micro_usd = 0)) OR ((kind = 'provider'::text) AND (provider IS NOT NULL) AND (model IS NOT NULL) AND (((action = ANY (ARRAY['brand_context_proposal'::text, 'topic_interpretation'::text, 'topic_interpretation_incremental'::text, 'topic_consolidation'::text, 'interest_decision'::text, 'monitoring_insights'::text])) AND (provider = 'anthropic'::text) AND (model = 'claude-sonnet-4-6'::text)) OR ((action = ANY (ARRAY['topic_prototype_embeddings'::text, 'corpus_embeddings'::text])) AND (provider = 'voyage'::text) AND (model = 'voyage-4-large'::text)) OR ((action = ANY (ARRAY['mention_facets'::text, 'concept_membership'::text])) AND (((provider = 'anthropic'::text) AND (model = 'claude-sonnet-5-5'::text)) OR ((provider = 'typesafe'::text) AND (model = ANY (ARRAY['jev-latest'::text, 'jev-1.13.0'::text]))))) OR ((action = ANY (ARRAY['concept_membership_jev'::text, 'mass_labeling_jev'::text])) AND (provider = 'typesafe'::text) AND (model = 'jev-1.13.0'::text)) OR ((action = 'concept_membership_claude'::text) AND (provider = 'anthropic'::text) AND (model = 'claude-sonnet-5-5'::text))))) OR(kind='provider' AND action='listening_discovery_review' AND provider='anthropic' AND model='claude-sonnet-4-6' AND configuration=signal_listening_discovery_review_configuration_v1()));

-- Keep the same exposure function OID; existing sibling producers see the new sums.
CREATE OR REPLACE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH prior(confirmed_micro_usd,reserved_micro_usd,ambiguous_micro_usd,total_micro_usd) AS(WITH prior(confirmed_micro_usd,reserved_micro_usd,ambiguous_micro_usd,total_micro_usd) AS (

 WITH old AS(SELECT * FROM signal_processing_org_exposure_pre0221_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),
 fresh AS(SELECT COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'
   OR c.status='failed' AND c.settled_micro_usd IS NOT NULL),0)::bigint confirmed,
 COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status IN('reserved','submitting','submitted')),0)::bigint reserved,
 (COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status='unknown'),0)+COALESCE(sum(c.terminal_exposure_micro_usd),0))::bigint ambiguous
 FROM signal_labeling_calls c JOIN signal_workspaces w ON w.id=c.workspace_id
 WHERE w.organization_id=target_org AND c.budget_date=target_day AND NOT COALESCE(excluded_ledger='labeling' AND c.id=excluded_id,false))
 SELECT old.confirmed_micro_usd+fresh.confirmed,old.reserved_micro_usd+fresh.reserved,old.ambiguous_micro_usd+COALESCE(fresh.ambiguous,0),
 old.total_micro_usd+fresh.confirmed+fresh.reserved+COALESCE(fresh.ambiguous,0) FROM old,fresh

), monthly AS (
 SELECT COALESCE(sum(settled_micro_usd) FILTER(WHERE state='settled'),0)::bigint confirmed,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE state IN('reserved','in_flight','response_persisted')),0)::bigint reserved,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE state='outcome_unknown'),0)::bigint ambiguous
 FROM signal_monitoring_insight_calls WHERE organization_id=target_org AND budget_date=target_day
  AND NOT COALESCE(excluded_ledger='monitoring_insights' AND id=excluded_id,false)
)
SELECT prior.confirmed_micro_usd+monthly.confirmed,prior.reserved_micro_usd+monthly.reserved,
 prior.ambiguous_micro_usd+monthly.ambiguous,prior.total_micro_usd+monthly.confirmed+monthly.reserved+monthly.ambiguous FROM prior,monthly),reviews AS(
 SELECT COALESCE(sum(settled_micro_usd) FILTER(WHERE call_state='settled'),0)::bigint confirmed,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE call_state IN('reserved','in_flight','response_persisted')),0)::bigint reserved,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE call_state='outcome_unknown'),0)::bigint ambiguous
 FROM engine_cost_events WHERE workspace_contract='listening-discovery-round-v1' AND processing_organization_id=target_org AND budget_date=target_day
 AND NOT COALESCE(excluded_ledger='listening_discovery' AND id=excluded_id,false))
 SELECT prior.confirmed_micro_usd+reviews.confirmed,prior.reserved_micro_usd+reviews.reserved,prior.ambiguous_micro_usd+reviews.ambiguous,
 prior.total_micro_usd+reviews.confirmed+reviews.reserved+reviews.ambiguous FROM prior,reviews
 $$;

CREATE OR REPLACE FUNCTION public.guard_workspace_engine_interpretation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; prior engine_cost_events%ROWTYPE; run_spent bigint; day_spent bigint;
BEGIN
 -- Strict new owner is validated by aab_listening_discovery_ledger; retain the complete legacy body below.
 IF TG_OP<>'DELETE' AND NEW.workspace_contract='listening-discovery-round-v1' THEN RETURN NEW;END IF;
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
END; $function$;

-- Composite exposure uses the existing three ledgers, never a second money ledger.
CREATE FUNCTION signal_listening_discovery_exposure_v1(target uuid,excluded_kind text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT sum(CASE WHEN c.call_state='settled' THEN c.settled_micro_usd WHEN c.call_state='definitely_not_sent' THEN 0 ELSE c.reserved_micro_usd END)
 FROM signal_listening_discovery_rounds r JOIN engine_cost_events c ON c.listening_round_id=r.id AND c.workspace_contract='listening-discovery-round-v1'
 WHERE r.execution_id=target AND NOT COALESCE(excluded_kind='listening_discovery' AND c.id=excluded_id,false)),0)
 +COALESCE((SELECT sum(CASE WHEN c.status='settled' OR c.status='failed' AND c.settled_micro_usd IS NOT NULL THEN c.settled_micro_usd ELSE CASE WHEN c.status IN('reserved','submitting','submitted','unknown') THEN c.reserved_micro_usd ELSE 0 END END+COALESCE(c.terminal_exposure_micro_usd,0))
 FROM signal_listening_discovery_children child JOIN signal_labeling_calls c ON c.run_id=child.run_id
 WHERE child.execution_id=target AND NOT COALESCE(excluded_kind='labeling' AND c.id=excluded_id,false)),0)
 +COALESCE((SELECT sum(CASE WHEN c.status='settled' THEN c.settled_micro_usd WHEN c.status='definitely_not_sent' THEN 0 ELSE greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0)) END)
 FROM signal_workspace_embedding_calls c WHERE c.run_id IN(SELECT p.prototype_run_id FROM signal_listening_preparations p WHERE p.id IN(
 SELECT initial_preparation_id FROM signal_listening_discovery_executions WHERE id=target UNION SELECT preparation_id FROM signal_listening_discovery_children WHERE execution_id=target UNION SELECT classification_preparation_id FROM signal_listening_discovery_rounds WHERE execution_id=target))
 AND NOT COALESCE(excluded_kind='voyage' AND c.id=excluded_id,false)),0)
$$;
CREATE FUNCTION signal_listening_discovery_census_v1(target uuid) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(COALESCE(jsonb_agg(jsonb_build_array(root_id,proof->>'source_text_sha256',proof->'in_category') ORDER BY root_id),'[]'::jsonb))
 FROM signal_listening_discovery_roots WHERE generation_id=target
$$;
CREATE FUNCTION signal_listening_discovery_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(g.status='ready' AND g.kind='confirmed_members' AND(g.counts->>'pending_base')::integer=0 AND(g.counts->>'pending_topics')::integer=0
 AND(g.counts->>'roots')::integer=(g.counts->>'map_roots')::integer AND(g.counts->>'cached_vectors')::integer=(g.counts->>'roots')::integer
 AND cfg.state='published' AND cfg.revision=(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=g.workspace_id AND state='published')
 AND g.entity_context_digest=(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=g.workspace_id ORDER BY version_no DESC LIMIT 1)
 AND EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state state WHERE state.workspace_id=g.workspace_id AND state.input_revision=g.input_revision)
 AND EXISTS(SELECT 1 FROM signal_corpus_preparation_runs prep WHERE prep.id=g.preparation_run_id AND prep.workspace_id=g.workspace_id AND prep.status='completed' AND(prep.policy_valid_until IS NULL OR prep.policy_valid_until>clock_timestamp()))
 AND m.preparation_run_id=g.preparation_run_id AND m.input_revision=g.input_revision AND m.embedding_config_digest=g.embedding_config_digest AND m.entity_context_digest=g.entity_context_digest
 AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=g.workspace_id AND feature='mass_labeling')
 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_roots r LEFT JOIN signal_mass_labeling_items i ON i.workspace_id=r.workspace_id AND i.map_id=g.map_id AND i.root_id=r.root_id
 WHERE r.generation_id=g.id AND(i.root_id IS NULL OR NOT signal_listening_root_right_v1(g.workspace_id,r.root_id,'llm-processing') OR r.proof->>'source_text_sha256'<>'sha256:'||encode(sha256(convert_to(i.text,'UTF8')),'hex'))),false)
 FROM signal_listening_discovery_generations g JOIN signal_mass_labeling_maps m ON m.id=g.map_id AND m.workspace_id=g.workspace_id
 JOIN signal_listening_configurations cfg ON cfg.id=g.configuration_id AND cfg.workspace_id=g.workspace_id WHERE g.id=target
$$;
CREATE FUNCTION signal_listening_discovery_execution_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE g signal_listening_discovery_generations;owner signal_listening_runs;r signal_labeling_runs;p signal_processing_policy_versions;
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND(to_jsonb(NEW)-ARRAY['status','error_code','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','error_code','updated_at']) THEN RAISE EXCEPTION 'listening_discovery_execution_immutable';END IF;
 IF TG_OP='INSERT' THEN
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.initial_generation_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.initial_classification_run_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=owner.run_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||NEW.organization_id::text,0));
 PERFORM signal_processing_lock_v1(NEW.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date);
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 IF NOT COALESCE(signal_listening_discovery_current_v1(g.id),false) OR NEW.status<>'active' OR r.status<>'completed' OR r.actor_user_id<>NEW.actor_user_id
 OR ROW(g.map_id,g.configuration_id,g.configuration_digest) IS DISTINCT FROM ROW(NEW.map_id,NEW.initial_configuration_id,NEW.configuration_digest)
 OR owner.configuration_id IS DISTINCT FROM g.configuration_id OR owner.map_id IS DISTINCT FROM g.map_id
 OR NEW.organization_id IS DISTINCT FROM(SELECT organization_id FROM signal_workspaces WHERE id=NEW.workspace_id)
 OR NEW.configuration IS DISTINCT FROM(SELECT configuration FROM signal_listening_configurations WHERE id=g.configuration_id)
 OR NEW.configuration_digest IS DISTINCT FROM signal_labeling_digest_v1(NEW.configuration)
 OR NEW.root_census_digest IS DISTINCT FROM signal_listening_discovery_census_v1(g.id) OR NEW.root_count<>(g.counts->>'roots')::integer
 OR NEW.policy IS DISTINCT FROM '{"contract_version":"listening-discovery-policy-v1","approval":0.7,"twin_jaccard":0.6,"twin_coapproval":0.8,"min_jointly_asked":20,"min_jointly_approved":10,"stop_absolute_improvement":0.01,"max_rounds":3,"examples_per_stratum":8}'::jsonb
 OR NEW.policy_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_array('listening-discovery-policy-v1',0.7,0.6,0.8,20,10,0.01,3,8))
 OR p.organization_id IS DISTINCT FROM NEW.organization_id OR p.status<>'active' OR clock_timestamp() NOT BETWEEN p.valid_from AND p.valid_until
 OR NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='listening_discovery_review' AND configuration=signal_listening_discovery_review_configuration_v1() AND(max_execution_micro_usd IS NULL OR NEW.cap_micro_usd<=max_execution_micro_usd))
 OR NEW.initial_preparation_id IS DISTINCT FROM(SELECT id FROM signal_listening_preparations WHERE workspace_id=NEW.workspace_id AND listening_run_id=r.id)
 OR NEW.initial_preparation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_listening_preparations flow WHERE flow.id=NEW.initial_preparation_id AND flow.listening_run_id=r.id AND flow.workspace_id=NEW.workspace_id AND flow.actor_user_id=NEW.actor_user_id)
 THEN RAISE EXCEPTION 'listening_discovery_execution_invalid';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_execution_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_executions FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_execution_guard_v1();

CREATE FUNCTION signal_listening_discovery_round_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE parent signal_listening_discovery_executions;g signal_listening_discovery_generations;cfg signal_listening_configurations;body jsonb;payload jsonb;ad signal_processing_admissions;
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND(to_jsonb(NEW)-ARRAY['admission_id','status','execution_token','execution_expires_at','output_configuration_id','output_digest','classification_preparation_id','classification_run_id','output_generation_id','planned_child_cap_micro_usd','stop_decision','error_code','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['admission_id','status','execution_token','execution_expires_at','output_configuration_id','output_digest','classification_preparation_id','classification_run_id','output_generation_id','planned_child_cap_micro_usd','stop_decision','error_code','updated_at']) THEN RAISE EXCEPTION 'listening_discovery_round_immutable';END IF;
 SELECT * INTO parent FROM signal_listening_discovery_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION 'listening_discovery_round_scope_invalid';END IF;
 IF TG_OP='INSERT' THEN
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.input_generation_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO cfg FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,parent.actor_user_id);
 body:=NEW.request_body::jsonb;payload:=(body#>>'{messages,0,content}')::jsonb;
 IF parent.status<>'active' OR NEW.ordinal<>(SELECT COALESCE(max(ordinal),0)+1 FROM signal_listening_discovery_rounds WHERE execution_id=parent.id)
 OR NEW.ordinal>3 OR NEW.status<>'queued' OR NEW.execution_token IS NOT NULL OR NEW.output_configuration_id IS NOT NULL
 OR NOT COALESCE(signal_listening_discovery_current_v1(g.id),false) OR g.configuration_id IS DISTINCT FROM cfg.id OR g.map_id IS DISTINCT FROM parent.map_id
 OR signal_listening_discovery_census_v1(g.id) IS DISTINCT FROM parent.root_census_digest
 OR NEW.configuration IS DISTINCT FROM cfg.configuration OR NEW.configuration_digest IS DISTINCT FROM cfg.configuration_digest
 OR NEW.request_digest IS DISTINCT FROM signal_labeling_digest_v1(body) OR NEW.request_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(NEW.request_body,'UTF8')),'hex')
 OR payload->>'population_digest' IS DISTINCT FROM NEW.population_digest
 OR NEW.source_digest IS DISTINCT FROM g.snapshot_digest OR NEW.population_digest IS DISTINCT FROM signal_listening_discovery_census_v1(g.id)
 OR octet_length(NEW.request_body)>2097152 OR octet_length(NEW.request_body)+4096+64000>1000000
 OR NEW.reservation_micro_usd<>(octet_length(NEW.request_body)+4096)*6+64000*15
 OR body->>'model'<>'claude-sonnet-4-6' OR body->'max_tokens'<>'64000'::jsonb OR body->'stream'<>'false'::jsonb OR body->'temperature'<>'0'::jsonb OR body->'thinking'<>'{"type":"disabled"}'::jsonb
 OR body-ARRAY['model','max_tokens','stream','temperature','thinking','system','output_config','messages']<>'{}'::jsonb
 OR 'sha256:'||encode(sha256(convert_to(body->>'system','UTF8')),'hex') IS DISTINCT FROM signal_listening_discovery_review_configuration_v1()->>'prompt_digest'
 OR signal_labeling_digest_v1(body#>'{output_config,format,schema}') IS DISTINCT FROM signal_listening_discovery_review_configuration_v1()->>'schema_digest'
 OR payload->'configuration' IS DISTINCT FROM cfg.configuration OR payload->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
 OR payload->>'map_digest' IS DISTINCT FROM cfg.configuration_digest OR (payload->>'round')::integer<>NEW.ordinal
 OR payload->>'policy_digest' IS DISTINCT FROM parent.policy_digest OR payload->>'vector_space_digest' IS DISTINCT FROM g.embedding_config_digest
 OR (payload#>>'{population,roots}')::integer<>parent.root_count OR (payload#>>'{population,category_roots}')::integer<>(g.counts->>'category_roots')::integer
 OR signal_listening_discovery_exposure_v1(parent.id)+NEW.reservation_micro_usd>parent.cap_micro_usd
 OR NEW.ordinal>1 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_rounds prior WHERE prior.execution_id=parent.id AND prior.ordinal=NEW.ordinal-1 AND prior.status='completed' AND prior.output_generation_id=g.id AND prior.stop_decision->'stop'='false'::jsonb)
 THEN RAISE EXCEPTION 'listening_discovery_round_invalid';END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
 IF OLD.admission_id IS NOT NULL AND NEW.admission_id IS DISTINCT FROM OLD.admission_id THEN RAISE EXCEPTION 'listening_discovery_admission_immutable';END IF;
 IF OLD.status IN('completed','stale','failed') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'listening_discovery_round_terminal';END IF;
 IF(OLD.output_configuration_id IS NOT NULL AND NEW.output_configuration_id IS DISTINCT FROM OLD.output_configuration_id)
 OR(OLD.planned_child_cap_micro_usd IS NOT NULL AND NEW.planned_child_cap_micro_usd IS DISTINCT FROM OLD.planned_child_cap_micro_usd)
 OR(OLD.classification_preparation_id IS NOT NULL AND NEW.classification_preparation_id IS DISTINCT FROM OLD.classification_preparation_id)
 OR(OLD.classification_run_id IS NOT NULL AND NEW.classification_run_id IS DISTINCT FROM OLD.classification_run_id) THEN RAISE EXCEPTION 'listening_discovery_child_binding_immutable';END IF;
 IF NEW.classification_preparation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_listening_preparations flow WHERE flow.id=NEW.classification_preparation_id AND flow.workspace_id=NEW.workspace_id AND flow.configuration_id=NEW.output_configuration_id AND flow.map_id=parent.map_id AND flow.actor_user_id=parent.actor_user_id AND flow.cap_micro_usd<=NEW.planned_child_cap_micro_usd AND(NEW.classification_run_id IS NULL OR flow.listening_run_id=NEW.classification_run_id)) THEN RAISE EXCEPTION 'listening_discovery_child_preparation_invalid';END IF;
 IF NEW.status='reviewed' AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE listening_round_id=NEW.id AND call_state='settled') THEN RAISE EXCEPTION 'listening_discovery_paid_receipt_required';END IF;
 IF NEW.output_configuration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE listening_round_id=NEW.id AND call_state='settled') THEN RAISE EXCEPTION 'listening_discovery_paid_receipt_required';END IF;
 IF NEW.output_configuration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_listening_configurations WHERE id=NEW.output_configuration_id AND workspace_id=NEW.workspace_id AND configuration_digest=NEW.output_digest AND state='published') THEN RAISE EXCEPTION 'listening_discovery_output_invalid';END IF;
 IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_generations output JOIN signal_labeling_runs r ON r.id=NEW.classification_run_id
 JOIN signal_listening_runs owner ON owner.run_id=r.id WHERE output.id=NEW.output_generation_id AND output.configuration_id=NEW.output_configuration_id AND output.workspace_id=NEW.workspace_id
 AND output.kind='confirmed_members' AND output.status='ready' AND r.status='completed' AND owner.configuration_id=output.configuration_id AND owner.map_id=parent.map_id
 AND signal_listening_discovery_census_v1(output.id)=parent.root_census_digest AND(output.counts->>'pending_base')::integer=0 AND(output.counts->>'pending_topics')::integer=0) THEN RAISE EXCEPTION 'listening_discovery_classification_incomplete';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_round_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_rounds FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_round_guard_v1();
CREATE FUNCTION signal_listening_discovery_admission_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.action='listening_discovery_review' AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r JOIN signal_listening_discovery_executions p ON p.id=r.execution_id
 WHERE r.id=NEW.target_id AND r.workspace_id=NEW.workspace_id AND p.organization_id=NEW.organization_id AND p.actor_user_id=NEW.actor_user_id
 AND p.policy_version_id=NEW.policy_version_id AND(r.admission_id IS NULL OR r.admission_id=NEW.id) AND r.request_digest=NEW.request_digest AND NEW.execution_cap_micro_usd=r.reservation_micro_usd
 AND NEW.configuration=signal_listening_discovery_review_configuration_v1() AND NEW.provider='anthropic' AND NEW.model='claude-sonnet-4-6' AND NOT NEW.automatic
 AND NEW.brand_context_processing_receipt_id IS NULL AND NEW.brand_context_prototype_receipt_id IS NULL) THEN RAISE EXCEPTION 'listening_discovery_admission_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_listening_discovery_admission_guard BEFORE INSERT ON signal_processing_admissions FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_admission_guard_v1();

CREATE FUNCTION signal_listening_discovery_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_listening_discovery_rounds;p signal_listening_discovery_executions;a signal_processing_admissions;receipt signal_listening_discovery_raw_receipts;body jsonb;usage jsonb;expected bigint;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.workspace_contract='listening-discovery-round-v1' THEN RAISE EXCEPTION 'listening_discovery_money_immutable';END IF;RETURN OLD;END IF;
 IF NEW.workspace_contract IS DISTINCT FROM 'listening-discovery-round-v1' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND NEW.workspace_contract IS DISTINCT FROM OLD.workspace_contract THEN RAISE EXCEPTION 'listening_discovery_money_immutable';END IF;
 SELECT * INTO r FROM signal_listening_discovery_rounds WHERE id=NEW.listening_round_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO p FROM signal_listening_discovery_executions WHERE id=r.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=r.admission_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||p.organization_id::text,0));
 PERFORM signal_processing_lock_v1(p.organization_id,a.budget_date);
 IF p.id IS NULL OR ROW(NEW.workspace_id,NEW.actor_user_id,NEW.request_digest,NEW.request_seal,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone)
 IS DISTINCT FROM ROW(r.workspace_id,p.actor_user_id,r.request_digest,r.request_sha256,r.reservation_micro_usd,a.budget_date,a.budget_timezone)
 OR NEW.call_configuration IS DISTINCT FROM signal_listening_discovery_review_configuration_v1() OR NEW.idempotency_key IS DISTINCT FROM 'listening-round:'||r.id::text THEN RAISE EXCEPTION 'listening_discovery_call_binding_invalid';END IF;
 IF TG_OP='INSERT' OR OLD.call_state='reserved' AND NEW.call_state='in_flight' THEN
 IF r.status<>'reviewing' OR r.execution_token IS NULL OR r.execution_expires_at<=clock_timestamp() OR NEW.metadata->>'lease_token' IS DISTINCT FROM r.execution_token::text
 OR p.status<>'active' OR NOT COALESCE(signal_listening_discovery_current_v1(r.input_generation_id),false) THEN RAISE EXCEPTION 'listening_discovery_send_authority_invalid';END IF;
 PERFORM signal_processing_capacity_v1(p.workspace_id,p.actor_user_id,r.id,r.admission_id,ARRAY['listening_discovery_review'],'anthropic','claude-sonnet-4-6',NEW.call_configuration,r.reservation_micro_usd,'listening_discovery',NEW.id,NEW.reserved_micro_usd,NEW.created_at);
 IF signal_listening_discovery_exposure_v1(p.id,'listening_discovery',NEW.id)+NEW.reserved_micro_usd>p.cap_micro_usd THEN RAISE EXCEPTION 'listening_discovery_parent_cap_exhausted';END IF;
 END IF;
 IF TG_OP='INSERT' THEN IF NEW.call_state<>'reserved' OR NEW.sent_at IS NOT NULL OR NEW.response_storage_key IS NOT NULL OR NEW.settled_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'listening_discovery_call_must_reserve';END IF;RETURN NEW;END IF;
 IF (to_jsonb(NEW)-ARRAY['call_state','sent_at','response_storage_key','response_sha256','response_size_bytes','response_http_status','provider_request_id','response_received_at','settled_micro_usd','settled_at','input_tokens','output_tokens','total_tokens','metadata']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['call_state','sent_at','response_storage_key','response_sha256','response_size_bytes','response_http_status','provider_request_id','response_received_at','settled_micro_usd','settled_at','input_tokens','output_tokens','total_tokens','metadata'])
 OR(NEW.metadata-'usage'-'error_code' IS DISTINCT FROM OLD.metadata-'usage'-'error_code' AND NOT(OLD.call_state='reserved' AND NEW.call_state='reserved' AND OLD.sent_at IS NULL AND NEW.metadata-'lease_token'=OLD.metadata-'lease_token' AND NEW.metadata->>'lease_token'=r.execution_token::text AND r.execution_expires_at>clock_timestamp()))
 OR OLD.call_state IN('settled','definitely_not_sent') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
 OR NOT(NEW.call_state=OLD.call_state OR OLD.call_state='reserved' AND NEW.call_state IN('in_flight','definitely_not_sent') OR OLD.call_state='in_flight' AND NEW.call_state IN('response_persisted','outcome_unknown') OR OLD.call_state='outcome_unknown' AND NEW.call_state='response_persisted' OR OLD.call_state='response_persisted' AND NEW.call_state IN('settled','outcome_unknown')) THEN RAISE EXCEPTION 'listening_discovery_call_transition_invalid';END IF;
 IF(NEW.sent_at IS DISTINCT FROM OLD.sent_at AND NOT(OLD.call_state='reserved' AND NEW.call_state='in_flight' AND OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL)) OR NEW.call_state='in_flight' AND NEW.sent_at IS NULL OR NEW.call_state='definitely_not_sent' AND NEW.sent_at IS NOT NULL THEN RAISE EXCEPTION 'listening_discovery_sent_immutable';END IF;
 IF NEW.response_storage_key IS NOT NULL THEN
 SELECT * INTO receipt FROM signal_listening_discovery_raw_receipts WHERE call_id=NEW.id;
 IF receipt.call_id IS NULL OR receipt.verification_status<>'verified' OR ROW(receipt.workspace_id,receipt.round_id,receipt.attempt_token,receipt.request_digest,receipt.storage_key,receipt.raw_sha256,receipt.size_bytes)
 IS DISTINCT FROM ROW(NEW.workspace_id,NEW.listening_round_id,NEW.attempt_token,NEW.request_digest,NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes)
 OR OLD.response_storage_key IS NOT NULL AND ROW(NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes,NEW.response_http_status,NEW.provider_request_id) IS DISTINCT FROM ROW(OLD.response_storage_key,OLD.response_sha256,OLD.response_size_bytes,OLD.response_http_status,OLD.provider_request_id) THEN RAISE EXCEPTION 'listening_discovery_raw_required';END IF;
 IF (receipt.raw_text::jsonb->>'http_status')::integer IS DISTINCT FROM NEW.response_http_status THEN RAISE EXCEPTION 'listening_discovery_raw_http_mismatch';END IF;
 END IF;
 IF NEW.call_state='settled' THEN
 BEGIN body:=(receipt.raw_text::jsonb->>'body')::jsonb;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'listening_discovery_usage_invalid';END;
 usage:=body->'usage';
 IF NEW.response_http_status<>200 OR body->>'model' !~'^claude-sonnet-4-6(-[0-9]{8})?$' OR jsonb_typeof(usage)<>'object'
 OR COALESCE(usage->>'input_tokens','')!~'^[0-9]+$' OR COALESCE(usage->>'output_tokens','')!~'^[0-9]+$'
 OR COALESCE(usage#>>'{cache_creation,ephemeral_5m_input_tokens}','0')!~'^[0-9]+$' OR COALESCE(usage#>>'{cache_creation,ephemeral_1h_input_tokens}','0')!~'^[0-9]+$'
 OR COALESCE(usage->>'cache_read_input_tokens','0')!~'^[0-9]+$' OR COALESCE(usage->>'cache_creation_input_tokens','0')!~'^[0-9]+$'
 THEN RAISE EXCEPTION 'listening_discovery_usage_invalid';END IF;
 expected:=ceil((usage->>'input_tokens')::numeric*3+(usage->>'output_tokens')::numeric*15+COALESCE((usage->>'cache_read_input_tokens')::numeric,0)*0.3
 +COALESCE((usage#>>'{cache_creation,ephemeral_5m_input_tokens}')::numeric,0)*3.75+COALESCE((usage#>>'{cache_creation,ephemeral_1h_input_tokens}')::numeric,0)*6);
 IF COALESCE((usage->>'cache_creation_input_tokens')::bigint,0)<>COALESCE((usage#>>'{cache_creation,ephemeral_5m_input_tokens}')::bigint,0)+COALESCE((usage#>>'{cache_creation,ephemeral_1h_input_tokens}')::bigint,0)
 OR NEW.settled_micro_usd IS DISTINCT FROM expected OR NEW.input_tokens IS DISTINCT FROM(usage->>'input_tokens')::integer OR NEW.output_tokens IS DISTINCT FROM(usage->>'output_tokens')::integer OR NEW.metadata->'usage' IS DISTINCT FROM usage
 OR NEW.total_tokens IS DISTINCT FROM NEW.input_tokens+NEW.output_tokens+COALESCE((usage->>'cache_creation_input_tokens')::integer,0)+COALESCE((usage->>'cache_read_input_tokens')::integer,0) THEN RAISE EXCEPTION 'listening_discovery_usage_mismatch';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aab_listening_discovery_ledger BEFORE INSERT OR UPDATE OR DELETE ON engine_cost_events FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_call_guard_v1();
CREATE FUNCTION signal_listening_discovery_raw_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c engine_cost_events;
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND(OLD.verification_status<>'planned' OR NEW.verification_status<>'verified' OR NEW.verified_at IS NULL OR(to_jsonb(NEW)-ARRAY['verification_status','verified_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['verification_status','verified_at'])) THEN RAISE EXCEPTION 'listening_discovery_raw_immutable';END IF;
 IF TG_OP='INSERT' AND(NEW.verification_status<>'planned' OR NEW.verified_at IS NOT NULL) THEN RAISE EXCEPTION 'listening_discovery_raw_must_plan';END IF;
 SELECT * INTO c FROM engine_cost_events WHERE id=NEW.call_id AND workspace_contract='listening-discovery-round-v1';
 IF c.id IS NULL OR c.call_state NOT IN('in_flight','outcome_unknown') OR ROW(NEW.workspace_id,NEW.round_id,NEW.attempt_token,NEW.request_digest) IS DISTINCT FROM ROW(c.workspace_id,c.listening_round_id,c.attempt_token,c.request_digest)
 OR NEW.storage_key NOT LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||NEW.round_id::text||'/%' OR NEW.size_bytes NOT BETWEEN 1 AND 8388608 THEN RAISE EXCEPTION 'listening_discovery_raw_binding_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_raw_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_raw_receipts FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_raw_guard_v1();

CREATE FUNCTION signal_listening_discovery_child_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_listening_discovery_executions;run signal_labeling_runs;owner signal_listening_runs;r signal_listening_discovery_rounds;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_discovery_child_immutable';END IF;
 SELECT * INTO p FROM signal_listening_discovery_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO run FROM signal_labeling_runs WHERE id=NEW.run_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id;
 IF p.id IS NULL OR run.id IS NULL OR owner.run_id IS NULL OR run.actor_user_id<>p.actor_user_id OR owner.map_id<>p.map_id
 OR NEW.preparation_id IS DISTINCT FROM(SELECT id FROM signal_listening_preparations WHERE workspace_id=NEW.workspace_id AND listening_run_id=run.id)
 OR NEW.preparation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_listening_preparations flow WHERE flow.id=NEW.preparation_id AND flow.workspace_id=NEW.workspace_id AND flow.actor_user_id=p.actor_user_id AND flow.listening_run_id=run.id)
 THEN RAISE EXCEPTION 'listening_discovery_child_invalid';END IF;
 IF NEW.round_id IS NULL THEN
 IF NEW.run_id<>p.initial_classification_run_id OR NEW.preparation_id IS DISTINCT FROM p.initial_preparation_id THEN RAISE EXCEPTION 'listening_discovery_initial_child_invalid';END IF;
 ELSE
 SELECT * INTO r FROM signal_listening_discovery_rounds WHERE id=NEW.round_id AND execution_id=p.id AND workspace_id=NEW.workspace_id;
 IF r.status<>'classifying' OR owner.configuration_id IS DISTINCT FROM r.output_configuration_id OR run.cap_micro_usd>r.planned_child_cap_micro_usd THEN RAISE EXCEPTION 'listening_discovery_child_round_invalid';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_child_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_children FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_child_guard_v1();
CREATE FUNCTION signal_listening_discovery_child_capacity_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE parent_id uuid;cap bigint;amount bigint;kind text;
BEGIN
 IF TG_TABLE_NAME='signal_labeling_calls' THEN
 SELECT execution_id INTO parent_id FROM signal_listening_discovery_children WHERE run_id=NEW.run_id;
 kind:='labeling';
 IF parent_id IS NULL OR NOT(TG_OP='INSERT' OR OLD.status='reserved' AND NEW.status='submitting') THEN RETURN NEW;END IF;
 amount:=NEW.reserved_micro_usd;
 ELSE
 SELECT p.id INTO parent_id FROM signal_listening_discovery_executions p WHERE p.initial_preparation_id IN(SELECT id FROM signal_listening_preparations WHERE prototype_run_id=NEW.run_id)
 UNION SELECT execution_id FROM signal_listening_discovery_children child JOIN signal_listening_preparations flow ON flow.id=child.preparation_id WHERE flow.prototype_run_id=NEW.run_id UNION SELECT r.execution_id FROM signal_listening_discovery_rounds r JOIN signal_listening_preparations flow ON flow.id=r.classification_preparation_id WHERE flow.prototype_run_id=NEW.run_id LIMIT 1;
 kind:='voyage';
 IF parent_id IS NULL OR NOT(TG_OP='INSERT' OR OLD.status='reserved' AND NEW.status='in_flight') THEN RETURN NEW;END IF;
 amount:=NEW.reserved_micro_usd;
 END IF;
 SELECT cap_micro_usd INTO cap FROM signal_listening_discovery_executions WHERE id=parent_id FOR UPDATE;
 IF signal_listening_discovery_exposure_v1(parent_id,kind,NEW.id)+amount>cap THEN RAISE EXCEPTION 'listening_discovery_parent_cap_exhausted';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_listening_discovery_child_capacity BEFORE INSERT OR UPDATE ON signal_labeling_calls FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_child_capacity_v1();
CREATE TRIGGER z_listening_discovery_child_capacity BEFORE INSERT OR UPDATE ON signal_workspace_embedding_calls FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_child_capacity_v1();
CREATE FUNCTION signal_listening_serving_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_listening_discovery_rounds;p signal_listening_discovery_executions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_serving_history_immutable';END IF;
 SELECT * INTO r FROM signal_listening_discovery_rounds WHERE id=NEW.round_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO p FROM signal_listening_discovery_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.activated_by_user_id);
 IF r.id IS NULL OR p.id IS NULL OR r.execution_id<>p.id OR r.status<>'completed' OR NEW.activated_by_user_id<>p.actor_user_id
 OR ROW(NEW.map_id,NEW.configuration_id,NEW.generation_id,NEW.classification_run_id) IS DISTINCT FROM ROW(p.map_id,r.output_configuration_id,r.output_generation_id,r.classification_run_id)
 OR NOT COALESCE(signal_listening_discovery_current_v1(NEW.generation_id),false) OR signal_listening_discovery_exposure_v1(p.id)>p.cap_micro_usd
 OR NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE listening_round_id=r.id AND workspace_contract='listening-discovery-round-v1' AND call_state='settled')
 OR EXISTS(SELECT 1 FROM engine_cost_events c JOIN signal_listening_discovery_rounds stage ON stage.id=c.listening_round_id WHERE stage.execution_id=p.id AND c.call_state<>'settled')
 OR NEW.snapshot_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_object('workspace_id',NEW.workspace_id,'execution_id',p.id,'round_id',r.id,'map_id',NEW.map_id,'configuration_id',NEW.configuration_id,'generation_id',NEW.generation_id,'classification_run_id',NEW.classification_run_id))
 THEN RAISE EXCEPTION 'listening_serving_snapshot_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_serving_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_serving_snapshots FOR EACH ROW EXECUTE FUNCTION signal_listening_serving_guard_v1();
DO $$DECLARE name text;role_name text;BEGIN
 FOREACH name IN ARRAY ARRAY['signal_listening_discovery_executions','signal_listening_discovery_rounds','signal_listening_discovery_children','signal_listening_discovery_raw_receipts','signal_listening_serving_snapshots'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',name,role_name);END IF;END LOOP;
 END LOOP;
 FOR name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND(p.proname LIKE 'signal_listening_discovery_%' OR p.proname='signal_listening_serving_guard_v1') LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||name||' FROM PUBLIC';
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',name,role_name);END IF;END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION signal_listening_discovery_round_admitted_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r JOIN signal_processing_admissions a ON a.id=r.admission_id
 WHERE r.id=NEW.id AND a.target_id=r.id AND a.workspace_id=r.workspace_id AND a.action='listening_discovery_review' AND a.request_digest=r.request_digest)
 THEN RAISE EXCEPTION 'listening_discovery_admission_required';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_discovery_round_admitted AFTER INSERT OR UPDATE ON signal_listening_discovery_rounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_round_admitted_v1();
REVOKE ALL ON FUNCTION signal_listening_discovery_round_admitted_v1() FROM PUBLIC;

-- An empty source is explicit evidence, not a vector, negative answer or failure.
CREATE FUNCTION signal_listening_discovery_empty_seed_v1(t signal_listening_discovery_topics) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(t.kind='source_seed' AND t.member_count=0 AND t.centroid IS NULL AND t.lineage->'no_confirmed_members'='true'::jsonb
 AND NOT(t.lineage ? 'subset_id') AND jsonb_array_length(t.lineage->'source_topic_keys')>0
 AND EXISTS(SELECT 1 FROM signal_listening_discovery_generations g JOIN signal_listening_discovery_generations source ON source.id=g.source_generation_id
 WHERE g.id=t.generation_id AND source.workspace_id=g.workspace_id AND source.map_id=g.map_id AND source.status='ready' AND source.kind='confirmed_members'
 AND source.embedding_config_digest=g.embedding_config_digest AND source.entity_context_digest=g.entity_context_digest
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(t.lineage->'source_topic_keys') key(value) LEFT JOIN signal_listening_discovery_topics previous ON previous.generation_id=source.id AND previous.question_key=key.value
 WHERE previous.question_key IS NULL OR previous.member_count<>0 OR previous.centroid IS NOT NULL OR EXISTS(SELECT 1 FROM signal_listening_discovery_members m WHERE m.generation_id=source.id AND m.question_key=key.value))),false)
$$;

CREATE OR REPLACE FUNCTION signal_listening_discovery_generation_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE map signal_mass_labeling_maps;cfg signal_listening_configurations;source signal_listening_discovery_generations;topic signal_listening_discovery_topics;expected_roots uuid[];actual_roots uuid[];
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND (OLD.status<>'building' OR NEW.status<>'ready' OR
  (to_jsonb(NEW)-ARRAY['status','counts','snapshot_digest']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','counts','snapshot_digest'])) THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 SELECT * INTO map FROM signal_mass_labeling_maps WHERE id=NEW.map_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO cfg FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id AND state='published';
 IF cfg.id IS NULL OR map.id IS NULL OR ROW(NEW.preparation_run_id,NEW.input_revision,NEW.embedding_config_digest,NEW.entity_context_digest,NEW.configuration_digest)
  IS DISTINCT FROM ROW(map.preparation_run_id,map.input_revision,map.embedding_config_digest,map.entity_context_digest,cfg.configuration_digest)
  OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling') THEN RAISE EXCEPTION 'listening_discovery_scope_invalid';END IF;
 IF NEW.source_generation_id IS NOT NULL THEN
  SELECT * INTO source FROM signal_listening_discovery_generations WHERE id=NEW.source_generation_id AND status='ready';
  IF source.id IS NULL OR ROW(source.workspace_id,source.map_id,source.preparation_run_id,source.input_revision,source.embedding_config_digest,source.entity_context_digest)
   IS DISTINCT FROM ROW(NEW.workspace_id,NEW.map_id,NEW.preparation_run_id,NEW.input_revision,NEW.embedding_config_digest,NEW.entity_context_digest)
   THEN RAISE EXCEPTION 'listening_discovery_source_invalid';END IF;
 END IF;
 IF TG_OP='INSERT' AND(NEW.status<>'building' OR NEW.counts IS NOT NULL OR NEW.snapshot_digest IS NOT NULL) THEN RAISE EXCEPTION 'listening_discovery_must_build';END IF;
 IF TG_OP='UPDATE' AND(NEW.counts IS DISTINCT FROM signal_listening_discovery_counts_v1(NEW.id)
   OR (NEW.counts->>'roots')::integer<>(SELECT count(*) FROM signal_mass_labeling_items i JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id WHERE i.workspace_id=NEW.workspace_id AND i.map_id=NEW.map_id AND m.canonical_mention_id=m.id AND m.inclusion_status='included' AND signal_listening_root_right_v1(NEW.workspace_id,i.root_id,'llm-processing'))
   OR NEW.snapshot_digest IS DISTINCT FROM signal_listening_discovery_digest_v1(NEW.id)
   OR (SELECT count(*) FROM signal_listening_discovery_topics WHERE generation_id=NEW.id)<>(SELECT count(*) FROM signal_listening_questions WHERE configuration_id=NEW.configuration_id AND definition->>'topic_source'='discovered'))
  THEN RAISE EXCEPTION 'listening_discovery_snapshot_incomplete';END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM signal_listening_discovery_topics t WHERE t.generation_id=NEW.id AND (t.kind='source_seed' AND t.member_count=0 AND NOT signal_listening_discovery_empty_seed_v1(t) OR t.kind='confirmed_members' AND t.member_count<>(SELECT count(*) FROM signal_listening_discovery_roots r CROSS JOIN LATERAL jsonb_array_elements(r.proof->'evaluations') e WHERE r.generation_id=NEW.id AND r.proof->>'embedding_call_id' IS NOT NULL AND e->>'question_key'=t.question_key AND e->>'question_digest'=t.question_digest AND (e->>'probability')::double precision>=0.7))) THEN RAISE EXCEPTION 'listening_discovery_members_incomplete';END IF;
 IF TG_OP='UPDATE' THEN
  FOR topic IN SELECT * FROM signal_listening_discovery_topics WHERE generation_id=NEW.id AND kind='source_seed' LOOP
   SELECT ARRAY(SELECT root_id FROM(SELECT member.root_id FROM signal_listening_discovery_members member WHERE member.generation_id=NEW.source_generation_id AND member.question_key IN(SELECT jsonb_array_elements_text(topic.lineage->'source_topic_keys')) AND member.evidence->>'kind' IN('jev','manual')
    UNION SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(topic.lineage->'orphan_root_ids','[]'::jsonb))) expected ORDER BY root_id) INTO expected_roots;
   SELECT ARRAY(SELECT root_id FROM signal_listening_discovery_members WHERE generation_id=NEW.id AND question_key=topic.question_key ORDER BY root_id) INTO actual_roots;
   IF expected_roots IS DISTINCT FROM actual_roots THEN RAISE EXCEPTION 'listening_discovery_seed_members_incomplete';END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_listening_discovery_counts_v1(target uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('map_roots',(SELECT m.root_count FROM signal_listening_discovery_generations g JOIN signal_mass_labeling_maps m ON m.id=g.map_id WHERE g.id=target),'roots',count(*),'cached_vectors',count(*) FILTER(WHERE proof->>'embedding_call_id' IS NOT NULL),
  'category_roots',count(*) FILTER(WHERE proof->'in_category'='true'::jsonb),'pending_base',count(*) FILTER(WHERE proof->'pending_base'='true'::jsonb),
  'pending_topics',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'evaluations') e WHERE e->>'probability' IS NULL)),
  'topics',(SELECT count(*) FROM signal_listening_discovery_topics WHERE generation_id=target)) FROM signal_listening_discovery_roots WHERE generation_id=target
$$;

CREATE OR REPLACE FUNCTION signal_listening_discovery_subset_root_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subsets WHERE id=NEW.subset_id AND generation_id=NEW.generation_id AND status='building') THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 SELECT proof INTO p FROM signal_listening_discovery_roots WHERE generation_id=NEW.generation_id AND root_id=NEW.root_id AND proof_digest=NEW.proof_digest;
 IF p IS NULL OR p->'in_category' IS DISTINCT FROM 'true'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'evaluations') e WHERE e->>'probability' IS NULL OR (e->>'probability')::double precision>=0.7) THEN RAISE EXCEPTION 'listening_discovery_not_orphan';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION signal_listening_discovery_empty_seed_v1(signal_listening_discovery_topics) FROM PUBLIC;

-- Serving may retain its completed version while Brand OS has a newer draft cut.
CREATE FUNCTION signal_listening_discovery_source_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(g.status='ready' AND g.kind='confirmed_members' AND(g.counts->>'pending_base')::integer=0 AND(g.counts->>'pending_topics')::integer=0
 AND(g.counts->>'roots')::integer=(g.counts->>'map_roots')::integer AND(g.counts->>'cached_vectors')::integer=(g.counts->>'roots')::integer
 AND cfg.state='published'
 AND g.entity_context_digest=(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=g.workspace_id ORDER BY version_no DESC LIMIT 1)
 AND EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state state WHERE state.workspace_id=g.workspace_id AND state.input_revision=g.input_revision)
 AND EXISTS(SELECT 1 FROM signal_corpus_preparation_runs prep WHERE prep.id=g.preparation_run_id AND prep.workspace_id=g.workspace_id AND prep.status='completed' AND(prep.policy_valid_until IS NULL OR prep.policy_valid_until>clock_timestamp()))
 AND m.preparation_run_id=g.preparation_run_id AND m.input_revision=g.input_revision AND m.embedding_config_digest=g.embedding_config_digest AND m.entity_context_digest=g.entity_context_digest
 AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=g.workspace_id AND feature='mass_labeling')
 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_roots r LEFT JOIN signal_mass_labeling_items i ON i.workspace_id=r.workspace_id AND i.map_id=g.map_id AND i.root_id=r.root_id
 WHERE r.generation_id=g.id AND(i.root_id IS NULL OR NOT signal_listening_root_right_v1(g.workspace_id,r.root_id,'llm-processing') OR r.proof->>'source_text_sha256'<>'sha256:'||encode(sha256(convert_to(i.text,'UTF8')),'hex'))),false)
 FROM signal_listening_discovery_generations g JOIN signal_mass_labeling_maps m ON m.id=g.map_id AND m.workspace_id=g.workspace_id
 JOIN signal_listening_configurations cfg ON cfg.id=g.configuration_id AND cfg.workspace_id=g.workspace_id WHERE g.id=target
$$;
REVOKE ALL ON FUNCTION signal_listening_discovery_source_current_v1(uuid) FROM PUBLIC;
