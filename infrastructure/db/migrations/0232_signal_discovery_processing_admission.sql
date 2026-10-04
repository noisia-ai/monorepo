-- MFP discovery uses the existing atomic processing admission, owner and monetary ledger.
-- Historical owners, explicit maxima and internal terminal reconciliation are retained.
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT processing_nullable_action_cap;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT processing_nullable_action_cap CHECK(max_execution_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','corpus_embeddings','topic_interpretation'));
ALTER TABLE signal_processing_admissions DROP CONSTRAINT processing_nullable_admission_cap;
ALTER TABLE signal_processing_admissions ADD CONSTRAINT processing_nullable_admission_cap CHECK(execution_cap_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','corpus_embeddings','topic_interpretation'));
CREATE FUNCTION signal_workspace_engine_actor_v1(execution signal_topic_catalog_executions,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT execution.actor_user_id=target_actor AND CASE
  WHEN execution.input_contract='workspace-topic-engine-v1' AND jsonb_typeof(execution.input_snapshot->'discovery_population')='object'
   THEN signal_brand_context_processing_actor_v1(execution.workspace_id,target_actor)
  ELSE signal_workspace_classification_actor_v1(execution.workspace_id,target_actor) END
$$;
REVOKE ALL ON FUNCTION signal_workspace_engine_actor_v1(signal_topic_catalog_executions,uuid) FROM PUBLIC;


ALTER TABLE engine_cost_events DROP CONSTRAINT workspace_interpretation_shape;
ALTER TABLE engine_cost_events
ADD CONSTRAINT workspace_interpretation_shape CHECK(
  (workspace_contract IS NULL AND engine_analysis_id IS NOT NULL AND workspace_id IS NULL AND catalog_execution_id IS NULL AND call_state IS NULL)
  OR COALESCE(workspace_contract='workspace-engine-interpretation-v1' AND engine_analysis_id IS NULL AND pipeline_step_id IS NULL
   AND workspace_id IS NOT NULL AND catalog_execution_id IS NOT NULL AND actor_user_id IS NOT NULL
   AND provider='anthropic' AND length(model) BETWEEN 1 AND 120 AND operation='workspace-engine-interpretation'
   AND idempotency_key~'^[A-Za-z0-9._:-]{8,200}$' AND request_digest~'^sha256:[0-9a-f]{64}$' AND request_seal~'^sha256:[0-9a-f]{64}$'
   AND jsonb_typeof(call_configuration)='object' AND pg_column_size(call_configuration)<=16384
   AND call_state IN('reserved','in_flight','response_persisted','settled','outcome_unknown','definitely_not_sent','terminal_confirmed')
   AND attempt_token IS NOT NULL AND reserved_micro_usd>0 AND (settled_micro_usd IS NULL OR settled_micro_usd>=0)
   AND budget_date IS NOT NULL AND length(budget_timezone) BETWEEN 1 AND 100 AND (budget_daily_cap_micro_usd IS NULL OR budget_daily_cap_micro_usd>0)
   AND ((response_storage_key IS NULL AND response_sha256 IS NULL AND response_size_bytes IS NULL AND response_http_status IS NULL)
    OR (response_storage_key LIKE 'workspace-engine/'||workspace_id::text||'/'||catalog_execution_id::text||'/%'
      AND response_sha256~'^sha256:[0-9a-f]{64}$' AND response_size_bytes>=0 AND response_http_status BETWEEN 100 AND 599))
   AND (call_state<>'response_persisted' OR response_storage_key IS NOT NULL)
   AND (call_state<>'settled' OR (response_storage_key IS NOT NULL AND settled_micro_usd IS NOT NULL AND settled_at IS NOT NULL)),false));


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
   AND ((NEW.input_snapshot->>'claude_cap_micro_usd')::bigint>0 OR (jsonb_typeof(NEW.input_snapshot->'discovery_population')='object' AND NEW.input_snapshot->'claude_cap_micro_usd'='null'::jsonb))
   AND ((config->>'daily_cap_micro_usd')::bigint>0 OR (jsonb_typeof(NEW.input_snapshot->'discovery_population')='object' AND config->'daily_cap_micro_usd'='null'::jsonb))
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
  IF NEW.budget_daily_cap_micro_usd IS NULL AND NOT COALESCE(jsonb_typeof(execution.input_snapshot->'discovery_population')='object',false) THEN RAISE EXCEPTION 'workspace_interpretation_strict_cap_required' USING ERRCODE='23514'; END IF;
  IF execution.input_contract='workspace-incremental-editorial-v1' AND NOT workspace_incremental_editorial_ledger_request_v1(NEW) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_not_admitted' USING ERRCODE='23514'; END IF;
  IF execution.input_snapshot->'interpretation_config' IS NOT NULL AND (
    execution.status<>'running' OR execution.execution_expires_at<=clock_timestamp() OR execution.result_summary->'fit_checkpoint' IS NULL
    OR NEW.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,NEW.metadata->>'interpretation_revision_digest')
    OR NEW.budget_timezone IS DISTINCT FROM execution.input_snapshot->'interpretation_config'->>'budget_timezone'
    OR NEW.budget_daily_cap_micro_usd IS DISTINCT FROM (execution.input_snapshot->'interpretation_config'->>'daily_cap_micro_usd')::bigint
    OR NOT signal_workspace_engine_actor_v1(execution,NEW.actor_user_id)) THEN
   RAISE EXCEPTION 'Analysis interpretation requires its live checkpoint and sealed configuration.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.budget_timezone)
   OR (NEW.budget_date<>(clock_timestamp() AT TIME ZONE NEW.budget_timezone)::date AND NOT (execution.input_snapshot ? 'discovery_population' AND NEW.budget_daily_cap_micro_usd IS NULL)) THEN
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

CREATE FUNCTION signal_workspace_discovery_projection_actor_v1(target_workspace uuid,target_actor uuid,source jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(source->>'contract_version'='workspace-topic-projection-v1' AND EXISTS(
  SELECT 1 FROM signal_topic_catalog_executions e WHERE e.id::text=source->>'engine_execution_id'
   AND e.workspace_id=target_workspace AND e.input_contract='workspace-topic-engine-v1'
   AND jsonb_typeof(e.input_snapshot->'discovery_population')='object'
   AND signal_workspace_engine_actor_v1(e,target_actor)),false)
$$;
REVOKE ALL ON FUNCTION signal_workspace_discovery_projection_actor_v1(uuid,uuid,jsonb) FROM PUBLIC;

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
 ELSIF NEW.input_contract='workspace-topic-engine-v1' AND jsonb_typeof(NEW.input_snapshot->'discovery_population')='object' THEN
  IF NEW.processing_admission_id IS NULL THEN RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
  actions:=ARRAY['topic_interpretation'];configuration:=NEW.input_snapshot->'interpretation_config'->'call_configuration';
  provider:=configuration->>'provider';model:=configuration->>'model';cap:=(NEW.input_snapshot->>'claude_cap_micro_usd')::bigint;
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
  IF owner->>'input_contract'='workspace-topic-engine-v1' AND jsonb_typeof(owner->'input_snapshot'->'discovery_population')='object' THEN
   admission:=(owner->>'processing_admission_id')::uuid;cap:=(owner->'input_snapshot'->>'claude_cap_micro_usd')::bigint;
   IF admission IS NULL THEN RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
  ELSE admission:=NULL;cap:=0; END IF;
 END IF;
 PERFORM signal_processing_capacity_v1(NEW.workspace_id,actor,(owner->>'id')::uuid,admission,actions,
  provider,model,configuration,cap,kind,entry_id,amount,stamp);
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION signal_processing_admission_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;
 child signal_brand_context_prototype_receipts%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.action='topic_consolidation' AND (NEW.execution_cap_micro_usd NOT BETWEEN 1 AND 30000000 OR NEW.automatic OR NEW.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1() OR NEW.provider IS DISTINCT FROM 'anthropic' OR NEW.model IS DISTINCT FROM 'claude-sonnet-4-6') THEN RAISE EXCEPTION 'topic_editorial_admission_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.action='topic_consolidation_numeric' AND (NEW.execution_cap_micro_usd<>0 OR NEW.automatic OR NEW.provider IS NOT NULL OR NEW.model IS NOT NULL) THEN
  RAISE EXCEPTION 'topic_consolidation_numeric_admission_invalid' USING ERRCODE='23514'; END IF;
 PERFORM signal_processing_lock_v1(NEW.organization_id,NEW.budget_date);
 IF NEW.action='topic_prototype_embeddings' THEN
  SELECT * INTO child FROM signal_brand_context_prototype_receipts WHERE id=NEW.brand_context_prototype_receipt_id;
  IF child.id IS NULL OR ROW(child.parent_receipt_id,child.admission_id,child.run_id,child.workspace_id,child.organization_id,
    child.brand_id,child.actor_user_id,child.policy_version_id,child.idempotency_key,child.request_digest,child.execution_cap_micro_usd,
    child.budget_date,child.budget_timezone,child.admission_not_after)
   IS DISTINCT FROM ROW(NEW.brand_context_processing_receipt_id,NEW.id,NEW.target_id,NEW.workspace_id,NEW.organization_id,
    NEW.brand_id,NEW.actor_user_id,NEW.policy_version_id,NEW.idempotency_key,NEW.request_digest,NEW.execution_cap_micro_usd,
    NEW.budget_date,NEW.budget_timezone,NEW.admission_not_after) THEN
   RAISE EXCEPTION 'brand_context_prototype_receipt_required' USING ERRCODE='23514'; END IF;
  PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 ELSE
  IF NEW.brand_context_prototype_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'brand_context_prototype_receipt_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.action='brand_context_proposal' THEN
   IF NEW.brand_context_processing_receipt_id IS NULL THEN RAISE EXCEPTION 'brand_context_composed_receipt_required' USING ERRCODE='23514'; END IF;
   PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  ELSE
   IF NEW.brand_context_processing_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'brand_context_composed_receipt_invalid' USING ERRCODE='23514'; END IF;
   IF NEW.action IN('topic_consolidation_numeric','topic_consolidation','topic_interpretation') THEN
    PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
   ELSE
    PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
   END IF;
  END IF;
 END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=NEW.workspace_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action=NEW.action;
 IF w.organization_id<>NEW.organization_id OR w.brand_id<>NEW.brand_id OR p.organization_id<>NEW.organization_id
  OR p.status IS DISTINCT FROM 'active' OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until
  OR a.action IS NULL OR NEW.provider IS DISTINCT FROM a.provider OR NEW.model IS DISTINCT FROM a.model
  OR NEW.configuration IS DISTINCT FROM a.configuration OR NEW.configuration_digest IS DISTINCT FROM a.configuration_digest
  OR (a.max_execution_micro_usd IS NOT NULL AND (NEW.execution_cap_micro_usd IS NULL OR NEW.execution_cap_micro_usd>a.max_execution_micro_usd)) OR NEW.automatic AND NOT a.automatic_allowed
  OR NEW.budget_timezone<>p.budget_timezone OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR NEW.admission_not_after>(CASE WHEN NEW.action IN('mention_facets','concept_membership','topic_interpretation') THEN p.valid_until ELSE least(p.valid_until,((NEW.budget_date+1)::timestamp AT TIME ZONE p.budget_timezone)) END)
  OR NEW.admission_not_after<=clock_timestamp() THEN
  RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(p.organization_id,NEW.budget_date,p.budget_timezone);
 IF NEW.execution_cap_micro_usd>0 AND exposure+NEW.execution_cap_micro_usd>p.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION admit_signal_processing_v1(target_workspace uuid,target_actor uuid,target_action text,target_run uuid,
 request_key text,request_hash text,requested_cap bigint,request_automatic boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 receipt signal_processing_admissions%ROWTYPE;w signal_workspaces%ROWTYPE;day date;
BEGIN
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 IF w.id IS NULL THEN RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NOT NULL THEN
  day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
  PERFORM signal_processing_lock_v1(w.organization_id,day);
 END IF;
 IF target_action='topic_interpretation' THEN PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor); ELSE PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor,false); END IF;
 SELECT * INTO receipt FROM signal_processing_admissions WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF receipt.id IS NOT NULL THEN
  IF ROW(receipt.action,receipt.target_id,receipt.request_digest,receipt.execution_cap_micro_usd,receipt.automatic)
   IS DISTINCT FROM ROW(target_action,target_run,request_hash,requested_cap,request_automatic) THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('replayed',true,'receipt',to_jsonb(receipt));
 END IF;
 IF target_action='topic_interpretation' THEN PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor); ELSE PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor); END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NULL THEN RAISE EXCEPTION 'processing_policy_missing' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(w.organization_id,day);
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action=target_action;
 IF a.action IS NULL THEN RAISE EXCEPTION 'processing_action_unavailable' USING ERRCODE='23514'; END IF;
 INSERT INTO signal_processing_admissions(organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,target_id,
  idempotency_key,request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,
  budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(w.organization_id,w.id,w.brand_id,target_actor,p.id,target_action,target_run,request_key,request_hash,
  a.provider,a.model,a.configuration,a.configuration_digest,requested_cap,day,p.budget_timezone,
  CASE WHEN target_action IN('mention_facets','concept_membership','topic_interpretation') THEN p.valid_until ELSE least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone)) END,request_automatic,'pending') RETURNING * INTO receipt;
 RETURN jsonb_build_object('replayed',false,'receipt',to_jsonb(receipt));
END; $$;

CREATE OR REPLACE FUNCTION signal_processing_capacity_pre0160_v1(target_workspace uuid,target_actor uuid,target_run uuid,admission_id uuid,
 allowed_actions text[],actual_provider text,actual_model text,actual_configuration jsonb,owner_cap bigint,
 ledger_kind text DEFAULT NULL,ledger_id uuid DEFAULT NULL,amount bigint DEFAULT 0,reserved_time timestamptz DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE org uuid;p signal_processing_policy_versions%ROWTYPE;r signal_processing_admissions%ROWTYPE;
 day date;spent bigint;run_spent bigint;client_actor boolean;mfp boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions e WHERE e.id=target_run AND e.workspace_id=target_workspace AND e.input_contract='workspace-topic-engine-v1' AND jsonb_typeof(e.input_snapshot->'discovery_population')='object') INTO mfp;
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

CREATE OR REPLACE FUNCTION validate_signal_tagging_model_registry_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace_id uuid;
BEGIN
  IF NEW.registry_contract_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.configuration->>'contract_version'='workspace-topic-incremental-projection-v1' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
    JOIN analysis_artifacts bank ON bank.id::text=NEW.configuration->>'model_artifact_id' AND bank.workspace_id=engine.workspace_id AND bank.engine_execution_id=engine.id
    JOIN analysis_artifacts binding ON binding.id::text=NEW.configuration->>'binding_artifact_id' AND binding.workspace_id=engine.workspace_id AND binding.engine_execution_id=engine.id
    WHERE engine.id::text=NEW.configuration->>'engine_execution_id' AND engine.status='ready' AND engine.input_snapshot ? 'numeric_descriptor'
     AND bank.id::text=engine.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'
     AND binding.metadata->>'contract_version'='workspace-incremental-binding-index-v1'
     AND binding.metadata->>'catalog_profile_id'=NEW.taxonomy_profile_id::text
     AND binding.metadata->>'binding_digest'=NEW.configuration->>'binding_digest'
     AND binding.metadata->>'numeric_checkpoint_digest'=NEW.configuration->>'numeric_checkpoint_digest'
     AND NEW.configuration->'workspace_classification_identity'=binding.metadata->'identity'
     AND NEW.artifact_digest=bank.content->>'sha256' AND NEW.configuration->>'approval_policy'='none'
     AND NEW.registered_by_user_id=engine.actor_user_id AND signal_workspace_incremental_binding_scope_v1(binding)
     AND NEW.runtime_kind='python' AND NEW.artifact_format='workspace-incremental-model-bank-v1'
     AND signal_data_governance_actor_is_valid(engine.workspace_id,NEW.registered_by_user_id)
     AND EXISTS(SELECT 1 FROM signal_classification_operations operation WHERE operation.id=NEW.registry_operation_id
      AND operation.workspace_id=engine.workspace_id AND operation.operation_kind='register-model' AND operation.status='in_progress'
      AND operation.actor_user_id=NEW.registered_by_user_id)) OR NEW.supersedes_model_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_incremental_projection_registry_invalid' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;

  IF NEW.configuration->>'contract_version'='workspace-topic-projection-v1' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
    JOIN signal_taxonomy_profiles profile ON profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=engine.workspace_id AND profile.status IN('draft','active','retired')
    JOIN analysis_artifacts model ON model.id::text=NEW.configuration->>'model_artifact_id' AND model.engine_execution_id=engine.id AND model.workspace_id=engine.workspace_id
    JOIN analysis_artifacts materialization ON materialization.id::text=NEW.configuration->>'materialization_artifact_id'
     AND materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
    WHERE engine.id::text=NEW.configuration->>'engine_execution_id' AND engine.input_contract='workspace-topic-engine-v1'
     AND signal_workspace_engine_materialization_source_v1(engine,materialization,profile.id)
     AND engine.result_summary->'fit_checkpoint'->>'model_artifact_id'=model.id::text
     AND model.artifact_type='engine_model' AND model.content->>'sha256'=NEW.artifact_digest
     AND materialization.metadata->>'mapping_digest'=NEW.configuration->>'mapping_digest'
     AND NEW.configuration->'workspace_classification_identity'->>'workspace_id'=engine.workspace_id::text
     AND NEW.configuration->'workspace_classification_identity'->>'engine_artifact_digest'=NEW.artifact_digest
     AND NEW.configuration->>'approval_policy'='none'
     AND signal_workspace_engine_actor_v1(engine,NEW.registered_by_user_id)
     AND signal_data_governance_actor_is_valid(engine.workspace_id,NEW.registered_by_user_id)
     AND EXISTS(SELECT 1 FROM signal_classification_operations operation WHERE operation.id=NEW.registry_operation_id
      AND operation.workspace_id=engine.workspace_id AND operation.operation_kind='register-model' AND operation.status='in_progress'
      AND operation.actor_user_id=NEW.registered_by_user_id)) OR NEW.supersedes_model_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_projection_model_invalid' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;

  IF NEW.configuration->>'contract_version'='workspace-topic-engine-v1' AND NOT EXISTS(
    SELECT 1 FROM signal_topic_catalog_executions execution
    JOIN analysis_artifacts artifact ON artifact.engine_execution_id=execution.id AND artifact.workspace_id=execution.workspace_id
    WHERE execution.id::text=NEW.configuration->>'execution_id' AND execution.input_contract='workspace-topic-engine-v1'
     AND execution.status='running' AND execution.taxonomy_profile_id=NEW.taxonomy_profile_id
     AND execution.actor_user_id=NEW.registered_by_user_id
     AND signal_workspace_engine_actor_v1(execution,NEW.registered_by_user_id)
     AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=NEW.artifact_digest) THEN
   RAISE EXCEPTION 'Native fitted model authority is invalid.' USING ERRCODE='23514'; END IF;

  SELECT workspace_id INTO target_workspace_id FROM signal_taxonomy_profiles
    WHERE id=NEW.taxonomy_profile_id AND (status='active' OR (status='draft' AND signal_interest_decision_draft_model_authorized_v2(NEW,workspace_id)) OR (status IN('draft','retired')
      AND NEW.configuration->>'contract_version'='workspace-topic-engine-v1'
      AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
       JOIN analysis_artifacts artifact ON artifact.engine_execution_id=execution.id AND artifact.workspace_id=execution.workspace_id
       WHERE execution.id::text=NEW.configuration->>'execution_id'
        AND execution.input_contract='workspace-topic-engine-v1' AND execution.status='running'
        AND execution.taxonomy_profile_id=NEW.taxonomy_profile_id AND execution.actor_user_id=NEW.registered_by_user_id
        AND artifact.artifact_type='engine_model' AND artifact.content->>'sha256'=NEW.artifact_digest)));
  IF target_workspace_id IS NULL
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,NEW.registered_by_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.registry_operation_id AND operation.workspace_id=target_workspace_id
         AND operation.operation_kind='register-model' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.registered_by_user_id)
     OR (NEW.supersedes_model_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM tagging_model_versions prior
       WHERE prior.id=NEW.supersedes_model_version_id
         AND prior.registry_contract_version='signal-tagging-model-registry-v1'
         AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
         AND prior.model_key=NEW.model_key AND prior.version<>NEW.version)) THEN
    RAISE EXCEPTION 'Tagging model registry authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_workspace_engine_analysis_artifact_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; call engine_cost_events%ROWTYPE;
 count_keys bigint; unique_keys bigint; profile signal_taxonomy_profiles%ROWTYPE; topics bigint; coverage record;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=OLD.engine_execution_id;
  IF execution.input_snapshot->'interpretation_config' IS NOT NULL THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Analysis checkpoint history is retained.' USING ERRCODE='55000'; END IF;
   IF ROW(NEW.workspace_id,NEW.engine_execution_id,NEW.artifact_key,NEW.artifact_type,NEW.content,NEW.metadata,NEW.discovery_run_digest,NEW.workspace_authority_digest)
     IS DISTINCT FROM ROW(OLD.workspace_id,OLD.engine_execution_id,OLD.artifact_key,OLD.artifact_type,OLD.content,OLD.metadata,OLD.discovery_run_digest,OLD.workspace_authority_digest) THEN
    RAISE EXCEPTION 'Analysis checkpoint evidence is immutable.' USING ERRCODE='55000'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.engine_execution_id IS DISTINCT FROM OLD.engine_execution_id AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions
    WHERE id=NEW.engine_execution_id AND input_snapshot->'interpretation_config' IS NOT NULL) THEN
   RAISE EXCEPTION 'Existing evidence cannot become an analysis checkpoint.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.engine_execution_id IS NULL OR NEW.artifact_type<>'engine_proposals' THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF execution.input_snapshot->'interpretation_config' IS NULL THEN
  IF NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1' THEN
   RAISE EXCEPTION 'Progress requires an editorial interpretation contract.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1' THEN
  SELECT * INTO coverage FROM signal_workspace_engine_interpretation_coverage_v1(execution.id);
  SELECT * INTO profile FROM signal_taxonomy_profiles WHERE id=(NEW.metadata->>'output_catalog_profile_id')::uuid
   AND workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active','retired');
  SELECT count(*) INTO topics FROM taxonomy_terms WHERE taxonomy_id=profile.taxonomy_id AND metadata->'topic'->>'lifecycle'<>'archived';
  IF NOT COALESCE(execution.status IN('running','failed','ready') AND execution.result_summary ? 'fit_checkpoint'
    AND signal_workspace_engine_actor_v1(execution,execution.actor_user_id)
    AND execution.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=execution.workspace_id)
    AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp())
    AND profile.id=signal_workspace_incremental_operational_profile_v1(execution.id)
    AND NEW.artifact_key='materialization-progress-'||profile.id::text||'.json'
    AND NEW.metadata->>'execution_id'=execution.id::text
    AND (NEW.metadata->>'output_catalog_revision')::int=profile.version AND (NEW.metadata->>'topic_count')::bigint=topics
    AND coverage.unit_count=coverage.unique_count AND coverage.unit_count>0
    AND coverage.unit_count=(NEW.metadata->>'interpreted_unit_count')::bigint
    AND coverage.unit_digest=NEW.metadata->>'interpretation_units_digest'
    AND (NEW.metadata->>'expected_interpretation_unit_count')::bigint=(execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::bigint
    AND NEW.metadata->>'expected_interpretation_units_digest'=execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_digest'
    AND coverage.unit_count<=(NEW.metadata->>'expected_interpretation_unit_count')::bigint
    AND (NEW.metadata->>'interpretation_complete')::boolean=(coverage.unit_count=(NEW.metadata->>'expected_interpretation_unit_count')::bigint
      AND coverage.unit_digest=NEW.metadata->>'expected_interpretation_units_digest')
    AND profile.metadata->>'source_engine_execution_id'=execution.id::text
    AND profile.metadata->>'source_interpretation_units_digest'=coverage.unit_digest
    AND profile.metadata->>'source_mapping_digest'=NEW.metadata->>'mapping_digest'
    AND NEW.metadata->>'mapping_digest'~'^sha256:[0-9a-f]{64}$',false)
   OR EXISTS(SELECT 1 FROM analysis_artifacts artifact LEFT JOIN engine_cost_events receipt
     ON receipt.id=(artifact.metadata->>'call_id')::uuid AND receipt.catalog_execution_id=execution.id AND receipt.workspace_id=execution.workspace_id
    WHERE artifact.engine_execution_id=execution.id AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
     AND NOT COALESCE(receipt.call_state='settled' AND receipt.actor_user_id=execution.actor_user_id
      AND receipt.response_sha256=artifact.metadata->>'response_sha256'
      AND receipt.call_configuration=workspace_engine_interpretation_configuration_v1(execution.id,receipt.metadata->>'interpretation_revision_digest'),false)) THEN
   RAISE EXCEPTION 'Progress materialization evidence is invalid.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF execution.status<>'running' OR execution.execution_expires_at<=clock_timestamp()
  OR execution.result_summary->'fit_checkpoint' IS NULL THEN
  RAISE EXCEPTION 'Analysis proposals require a live fitted execution.' USING ERRCODE='23514'; END IF;
 IF NEW.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' THEN
  SELECT * INTO call FROM engine_cost_events WHERE id=(NEW.metadata->>'call_id')::uuid
   AND workspace_id=NEW.workspace_id AND catalog_execution_id=execution.id AND workspace_contract='workspace-engine-interpretation-v1';
  IF call.id IS NULL OR call.call_state<>'settled' OR call.response_sha256 IS DISTINCT FROM NEW.metadata->>'response_sha256'
   OR call.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,call.metadata->>'interpretation_revision_digest')
   OR NEW.metadata->>'execution_id' IS DISTINCT FROM execution.id::text
   OR NEW.metadata->>'fit_checkpoint_digest' IS DISTINCT FROM execution.result_summary->'fit_checkpoint'->>'checkpoint_digest'
   OR jsonb_typeof(NEW.metadata->'unit_keys') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Interpretation checkpoint receipt is invalid.' USING ERRCODE='23514'; END IF;
  SELECT count(*),count(DISTINCT key) INTO count_keys,unique_keys FROM jsonb_array_elements_text(NEW.metadata->'unit_keys') unit(key);
  IF count_keys NOT BETWEEN 1 AND 128 OR count_keys<>unique_keys
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.metadata->'unit_keys') unit(key) WHERE key!~'^[A-Za-z0-9:._-]{1,200}$')
   OR EXISTS(SELECT 1 FROM analysis_artifacts prior CROSS JOIN LATERAL jsonb_array_elements_text(prior.metadata->'unit_keys') unit(key)
      WHERE prior.engine_execution_id=execution.id AND prior.artifact_type='engine_proposals'
       AND prior.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' AND NEW.metadata->'unit_keys' ? unit.key) THEN
   RAISE EXCEPTION 'Interpretation units are duplicate or invalid.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.metadata->>'contract_version'='workspace-topic-materialization-v1' THEN
  SELECT * INTO profile FROM signal_taxonomy_profiles WHERE id=(NEW.metadata->>'output_catalog_profile_id')::uuid
   AND workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active','retired');
  SELECT count(*) INTO topics FROM taxonomy_terms WHERE taxonomy_id=profile.taxonomy_id AND metadata->'topic'->>'lifecycle'<>'archived';
  IF NEW.artifact_key<>'materialization.json' OR profile.id IS NULL
   OR NEW.metadata->>'execution_id' IS DISTINCT FROM execution.id::text
   OR (NEW.metadata->>'output_catalog_revision')::integer IS DISTINCT FROM profile.version
   OR (NEW.metadata->>'topic_count')::bigint IS DISTINCT FROM topics
   OR NEW.metadata->>'interpretation_units_digest' IS DISTINCT FROM execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_digest'
   OR profile.metadata->>'source_engine_execution_id' IS DISTINCT FROM execution.id::text
   OR profile.metadata->>'source_interpretation_units_digest' IS DISTINCT FROM NEW.metadata->>'interpretation_units_digest'
   OR profile.metadata->>'source_mapping_digest' IS DISTINCT FROM NEW.metadata->>'mapping_digest'
   OR NOT COALESCE(NEW.metadata->>'mapping_digest'~'^sha256:[0-9a-f]{64}$',false) THEN
   RAISE EXCEPTION 'Analysis catalog materialization is invalid.' USING ERRCODE='23514'; END IF;
 ELSE
  RAISE EXCEPTION 'Analysis proposal contract is required.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION signal_workspace_engine_materialization_source_v1(engine signal_topic_catalog_executions,materialization analysis_artifacts,p_profile uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(materialization.engine_execution_id=engine.id AND materialization.workspace_id=engine.workspace_id
  AND materialization.artifact_type='engine_proposals'
  AND materialization.metadata->>'output_catalog_profile_id'=p_profile::text
  AND materialization.metadata->>'execution_id'=engine.id::text
  AND EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile WHERE profile.id=p_profile AND profile.workspace_id=engine.workspace_id
   AND profile.metadata->>'source_engine_execution_id'=engine.id::text
   AND profile.metadata->>'source_mapping_digest'=materialization.metadata->>'mapping_digest'
   AND profile.metadata->>'source_interpretation_units_digest'=materialization.metadata->>'interpretation_units_digest')
  AND ((materialization.metadata->>'contract_version'='workspace-topic-materialization-v1' AND engine.status='ready'
    AND engine.result_summary->'analysis_checkpoint'->>'materialization_artifact_id'=materialization.id::text
    AND engine.result_summary->'analysis_checkpoint'->>'output_catalog_profile_id'=p_profile::text)
   OR (materialization.metadata->>'contract_version'='workspace-topic-materialization-progress-v1'
    AND engine.status IN('running','failed','ready') AND engine.result_summary ? 'fit_checkpoint'
    AND materialization.metadata->>'expected_interpretation_units_digest'=engine.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_digest'
    AND (materialization.metadata->>'expected_interpretation_unit_count')::bigint=(engine.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::bigint
    AND (materialization.metadata->>'interpreted_unit_count')::bigint BETWEEN 1 AND (materialization.metadata->>'expected_interpretation_unit_count')::bigint)),false)
$$;

CREATE OR REPLACE FUNCTION guard_workspace_classification_generation_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE embedded signal_workspace_embedding_runs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.input_contract='workspace-topic-classification-v1' THEN RAISE EXCEPTION 'workspace_classification_history_immutable' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-ARRAY['status','finalized_digest','finalized_at']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['status','finalized_digest','finalized_at']) THEN
  RAISE EXCEPTION 'workspace_classification_input_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.input_contract<>'workspace-topic-classification-v1' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO embedded FROM signal_workspace_embedding_runs WHERE id=NEW.embedding_run_id AND workspace_id=NEW.workspace_id AND input_contract='corpus';
  IF embedded.id IS NULL OR embedded.status<>'completed' OR embedded.preparation_run_id<>NEW.preparation_run_id
   OR embedded.input_revision<>NEW.input_revision OR NEW.denominator<>(embedded.counts->>'eligible_roots')::bigint
   OR (embedded.counts->>'completed_roots')::bigint<>NEW.denominator
   OR embedded.config_digest IS DISTINCT FROM NEW.input_snapshot->'identity'->>'embedding_config_digest'
   OR NEW.input_digest<>'sha256:'||encode(sha256(convert_to(NEW.input_snapshot::text,'UTF8')),'hex')
   OR NOT COALESCE(NEW.input_snapshot->>'contract_version'='workspace-topic-classification-v1'
    AND NEW.input_snapshot->'identity'->>'contract_version'='signal-workspace-classification-v1'
    AND NEW.input_snapshot->'identity'->>'workspace_id'=NEW.workspace_id::text
    AND NEW.input_snapshot->'identity'->>'catalog_digest'=NEW.identity_catalog_digest
    AND jsonb_typeof(NEW.input_snapshot->'topics')='array',false)
   OR NOT (signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id)
    OR signal_workspace_discovery_projection_actor_v1(NEW.workspace_id,NEW.created_by_user_id,NEW.input_snapshot->'source_projection')
    OR signal_defined_interest_generation_actor_v1(NEW.workspace_id,NEW.created_by_user_id,
     NEW.taxonomy_profile_id,NEW.input_snapshot))
   OR NOT EXISTS(SELECT 1 FROM signal_classification_operations op WHERE op.id=NEW.operation_id AND op.workspace_id=NEW.workspace_id
    AND op.actor_user_id=NEW.created_by_user_id AND op.operation_kind='create-generation' AND op.status='in_progress')
   OR NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state state WHERE state.workspace_id=NEW.workspace_id AND state.input_revision=NEW.input_revision)
   OR NEW.policy_valid_until IS DISTINCT FROM embedded.policy_valid_until
   OR (NEW.policy_valid_until IS NOT NULL AND NEW.policy_valid_until<=clock_timestamp())
   OR (NEW.source_generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_classification_generations prior
    WHERE prior.id=NEW.source_generation_id AND prior.workspace_id=NEW.workspace_id AND prior.input_contract=NEW.input_contract
    AND prior.status='ready' AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item WHERE item.generation_id=prior.id AND item.resolution_state='error'))) THEN
   RAISE EXCEPTION 'workspace_classification_input_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
