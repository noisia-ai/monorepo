-- MFP incremental editorial uses the active processing policy and the existing ledger.
-- Legacy authorization, finite budgets and immutable receipts retain their prior rules.
CREATE FUNCTION signal_workspace_incremental_editorial_actor_v1(workspace uuid,actor uuid,target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM signal_topic_catalog_executions e WHERE e.id=target AND e.workspace_id=workspace
  AND (e.input_contract='workspace-topic-engine-v1' AND e.input_snapshot ? 'numeric_descriptor' OR e.input_contract='workspace-incremental-editorial-v1')
  AND jsonb_typeof(e.input_snapshot->'discovery_population')='object')
 THEN signal_brand_context_processing_actor_v1(workspace,actor) ELSE workspace_interpretation_admission_admin_v1(workspace,actor) END
$$;
REVOKE ALL ON FUNCTION signal_workspace_incremental_editorial_actor_v1(uuid,uuid,uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION signal_workspace_engine_actor_v1(execution signal_topic_catalog_executions,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT execution.actor_user_id=target_actor AND CASE
  WHEN execution.input_contract IN('workspace-topic-engine-v1','workspace-incremental-editorial-v1') AND jsonb_typeof(execution.input_snapshot->'discovery_population')='object'
   THEN signal_brand_context_processing_actor_v1(execution.workspace_id,target_actor)
  ELSE signal_workspace_classification_actor_v1(execution.workspace_id,target_actor) END
$$;
-- ISO 9999 is only a JSON transport representation of PostgreSQL infinity.
-- Policy/admission SQL authority keeps the original expiry and every finite maximum.
CREATE OR REPLACE FUNCTION workspace_incremental_editorial_policy_v1(target uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('source_execution_id',child.id::text,'budget_actor_user_id',child.actor_user_id::text,
 'budget_timezone',policy.budget_timezone,'daily_cap_micro_usd',policy.daily_cap_micro_usd,'maximum_cap_micro_usd',action.max_execution_micro_usd,
 'processing_policy_id',policy.id::text,'valid_until',to_char(least(policy.valid_until,'9999-12-31T23:59:59.999Z'::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 FROM signal_topic_catalog_executions child JOIN signal_workspaces workspace ON workspace.id=child.workspace_id
 JOIN signal_processing_policy_versions policy ON policy.organization_id=workspace.organization_id AND policy.status='active'
 JOIN signal_processing_policy_actions action ON action.policy_version_id=policy.id AND action.action='topic_interpretation'
 WHERE child.id=target AND child.input_snapshot ? 'discovery_population' AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp()
  AND action.provider='anthropic' AND action.configuration=workspace_incremental_editorial_sonnet_v1() AND action.model=action.configuration->>'model'
 UNION ALL (SELECT jsonb_build_object('source_execution_id',parent.id::text,'budget_actor_user_id',child.actor_user_id::text,
 'budget_timezone',COALESCE(parent.interpretation_revision->'configuration',parent.input_snapshot->'interpretation_config')->>'budget_timezone',
 'daily_cap_micro_usd',COALESCE(parent.interpretation_revision->'configuration',parent.input_snapshot->'interpretation_config')->'daily_cap_micro_usd')
 FROM signal_topic_catalog_executions child CROSS JOIN LATERAL signal_workspace_incremental_projection_lineage_v1(child.id) lineage
 JOIN signal_topic_catalog_executions parent ON parent.id=lineage.parent_id AND parent.workspace_id=child.workspace_id AND parent.actor_user_id=child.actor_user_id
 WHERE child.id=target AND NOT child.input_snapshot ? 'discovery_population' AND NOT parent.input_snapshot ? 'numeric_descriptor' AND parent.input_snapshot ? 'interpretation_config'
 ORDER BY parent.created_at DESC,parent.id DESC LIMIT 1)
 LIMIT 1
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
 ELSIF NEW.input_contract='workspace-topic-engine-v1' AND jsonb_typeof(NEW.input_snapshot->'discovery_population')='object' THEN
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
  IF owner->>'input_contract' IN('workspace-topic-engine-v1','workspace-incremental-editorial-v1') AND jsonb_typeof(owner->'input_snapshot'->'discovery_population')='object' THEN
   admission:=(owner->>'processing_admission_id')::uuid;cap:=(owner->'input_snapshot'->>'claude_cap_micro_usd')::bigint;
   IF admission IS NULL THEN RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
  ELSE admission:=NULL;cap:=0; END IF;
 END IF;
 PERFORM signal_processing_capacity_v1(NEW.workspace_id,actor,(owner->>'id')::uuid,admission,actions,
  provider,model,configuration,cap,kind,entry_id,amount,stamp);
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION guard_workspace_incremental_editorial_execution_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source signal_topic_catalog_executions%ROWTYPE; body jsonb; policy jsonb; targets jsonb;
BEGIN
 IF COALESCE(NEW.input_contract,'')<>'workspace-incremental-editorial-v1' AND COALESCE(OLD.input_contract,'')<>'workspace-incremental-editorial-v1' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'workspace_incremental_editorial_history_immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['interpretation_admission_operation_id','status','worker_job_id','execution_token','execution_expires_at','heartbeat_at','started_at','completed_at','result_summary','error_code','progress','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['interpretation_admission_operation_id','status','worker_job_id','execution_token','execution_expires_at','heartbeat_at','started_at','completed_at','result_summary','error_code','progress','updated_at'])
   OR (NEW.result_summary->'delivery_retry_count' IS DISTINCT FROM OLD.result_summary->'delivery_retry_count' AND NOT (OLD.status='failed' AND NEW.status='queued'))
   OR NEW.input_contract IS DISTINCT FROM OLD.input_contract OR OLD.status='ready' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
   OR (OLD.result_summary ? 'request_plan_artifact_id' AND (NEW.result_summary->>'request_plan_artifact_id' IS DISTINCT FROM OLD.result_summary->>'request_plan_artifact_id' OR NEW.result_summary->>'request_plan_digest' IS DISTINCT FROM OLD.result_summary->>'request_plan_digest'))
   OR NEW.result_summary->'analysis_complete' IS DISTINCT FROM 'false'::jsonb
   OR NEW.result_summary->'provider_enabled' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'workspace_incremental_editorial_history_immutable' USING ERRCODE='55000'; END IF;
  IF NEW.status<>OLD.status AND NOT (OLD.status='failed' AND NEW.status='queued'
   AND NEW.interpretation_admission_operation_id IS DISTINCT FROM OLD.interpretation_admission_operation_id
   AND COALESCE((workspace_incremental_editorial_renewal_state_v1(OLD.id)->>'eligible')::boolean,false)
   AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.error_code IS NULL
   AND NEW.result_summary IS NOT DISTINCT FROM OLD.result_summary
   AND EXISTS(SELECT 1 FROM signal_classification_operations permission WHERE permission.id=NEW.interpretation_admission_operation_id
    AND permission.workspace_id=OLD.workspace_id AND permission.operation_kind='authorize-interpretation' AND permission.status='completed'
    AND permission.result->>'contract_version'='workspace-incremental-editorial-admission-v1' AND permission.result->>'execution_id'=OLD.id::text
    AND permission.result->>'prior_admission_operation_id'=OLD.interpretation_admission_operation_id::text
    AND permission.result->>'action'='authorize_interpretation' AND (permission.result->>'admission_not_after')::timestamptz>clock_timestamp())
   OR OLD.status='queued' AND NEW.status='running' OR (OLD.status='queued' AND NEW.status='failed'
   AND OLD.execution_token IS NULL AND OLD.execution_expires_at IS NULL AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL
   AND EXISTS(SELECT 1 FROM signal_topic_classification_outbox dispatch WHERE dispatch.execution_id=OLD.id AND dispatch.workspace_id=OLD.workspace_id AND dispatch.dispatch_kind='execution'
     AND dispatch.worker_job_id='signal-workspace-incremental-editorial-'||OLD.id::text||'-1' AND dispatch.status='dead_letter' AND dispatch.error_code=NEW.error_code
     AND (OLD.result_summary->>'worker_job_id' IS NULL OR OLD.result_summary->>'worker_job_id'=dispatch.worker_job_id))
   AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND (OLD.result_summary->>'worker_job_id' IS NULL OR call_state IN('in_flight','outcome_unknown')))) OR OLD.status='running' AND NEW.status IN('ready','failed') OR OLD.status='failed' AND NEW.status='queued' AND OLD.error_code IN('workspace_incremental_editorial_transport_unavailable','workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable','workspace_engine_interpretation_transport_terminal_confirmed','workspace_engine_interpretation_receipt_recovery_required') AND (OLD.error_code<>'workspace_engine_interpretation_receipt_recovery_required' OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='response_persisted' AND response_storage_key IS NOT NULL AND COALESCE((metadata->>'response_complete')::boolean,true))) AND (OLD.error_code<>'workspace_engine_interpretation_transport_terminal_confirmed' OR EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='terminal_confirmed' AND metadata ? 'provider_terminal_receipt') AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state='terminal_confirmed' GROUP BY request_digest HAVING count(*)>1)) AND COALESCE((OLD.result_summary->>'delivery_retry_count')::int,0)<8 AND (NEW.result_summary->>'delivery_retry_count')::int=COALESCE((OLD.result_summary->>'delivery_retry_count')::int,0)+1 AND workspace_incremental_editorial_execution_current_v1(OLD.id) AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=OLD.id AND call_state IN('in_flight','outcome_unknown'))) THEN RAISE EXCEPTION 'workspace_incremental_editorial_transition_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.status='running' AND NOT COALESCE(NEW.execution_token IS NOT NULL AND NEW.execution_expires_at>clock_timestamp() AND NEW.result_summary->>'worker_job_id' LIKE 'signal-workspace-incremental-editorial-'||NEW.id::text||'-%'
   AND EXISTS(SELECT 1 FROM signal_topic_classification_outbox WHERE execution_id=NEW.id AND workspace_id=NEW.workspace_id AND dispatch_kind='execution' AND worker_job_id=NEW.result_summary->>'worker_job_id' AND status IN('dispatching','dispatched')),false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_lease_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.result_summary ? 'request_plan_artifact_id' AND NOT (workspace_incremental_editorial_request_plan_valid_v1((NEW.result_summary->>'request_plan_artifact_id')::uuid) AND EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id::text=NEW.result_summary->>'request_plan_artifact_id' AND plan.engine_execution_id=NEW.id AND plan.workspace_id=NEW.workspace_id AND plan.metadata->'plan'->>'plan_digest'=NEW.result_summary->>'request_plan_digest')) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_plan_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NOT COALESCE(NEW.completed_at IS NOT NULL AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.result_summary->'editorial_complete'='true'::jsonb AND workspace_incremental_editorial_output_complete_v1(NEW.id),false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_checkpoint_incomplete' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO source FROM signal_topic_catalog_executions WHERE id=NEW.source_execution_id FOR UPDATE;
 body:=NEW.input_snapshot; policy:=workspace_incremental_editorial_policy_v1(source.id);targets:=workspace_incremental_editorial_targets_v1(source.id);
 IF NOT COALESCE(source.id IS NOT NULL AND source.workspace_id=NEW.workspace_id AND NEW.actor_user_id=source.actor_user_id
  AND NEW.status='queued' AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.completed_at IS NULL
  AND NEW.interpretation_revision IS NULL AND NEW.interpretation_admission_operation_id IS NULL
  AND NEW.processed_roots=0 AND NEW.processed_chunks=0 AND NEW.denominator=source.denominator AND NEW.expected_chunks=source.expected_chunks
  AND NEW.embedding_run_id=source.embedding_run_id AND NEW.preparation_run_id=source.preparation_run_id AND NEW.embedding_config_digest=source.embedding_config_digest
  AND NEW.input_revision=source.input_revision AND NEW.policy_valid_until IS NOT DISTINCT FROM source.policy_valid_until
  AND NEW.population_digest=source.result_summary->'numeric_checkpoint'->>'population_digest'
  AND NEW.identity_catalog_digest=source.identity_catalog_digest AND NEW.definition_digest=source.definition_digest
  AND NEW.taxonomy_profile_id=signal_workspace_incremental_operational_profile_v1(source.id)
  AND workspace_incremental_editorial_source_v1(source.id) AND policy IS NOT NULL
  AND body->>'contract_version'='workspace-incremental-editorial-v1' AND pg_column_size(body)<=16384
  AND body->>'execution_id'=NEW.id::text AND body->>'workspace_id'=NEW.workspace_id::text
  AND body->>'numeric_execution_id'=source.id::text AND body->>'numeric_checkpoint_digest'=source.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
  AND body->>'population_digest'=NEW.population_digest AND body->>'input_revision'=NEW.input_revision::text
  AND body->>'context_digest'=source.input_snapshot->>'context_digest' AND body->>'catalog_input_digest'=source.input_snapshot->>'catalog_digest'
  AND body->>'model_bank_artifact_id'=source.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'
  AND body->>'model_bank_sha256'=(SELECT content->>'sha256' FROM analysis_artifacts WHERE id=(body->>'model_bank_artifact_id')::uuid AND engine_execution_id=source.id)
  AND body->>'census_derivation_digest'=workspace_incremental_editorial_census_v1(source.id)
  AND body->>'history_cut_digest'=signal_workspace_incremental_projection_editorial_digest_v1(source.id)
  AND (body->>'expected_units')::bigint=(targets->>'expected_units')::bigint AND targets->>'expected_units'=targets->>'unique_units'
  AND workspace_incremental_editorial_plan_valid_v1((body->>'evidence_plan_artifact_id')::uuid)
  AND EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id::text=body->>'evidence_plan_artifact_id' AND (plan.metadata->>'numeric_execution_id')::uuid=source.id
   AND body->>'target_units'=plan.metadata->'descriptor'->'stream'->>'rows' AND (body->>'target_units')::bigint>0
   AND body->>'target_unit_digest'=plan.metadata->'descriptor'->>'target_unit_digest' AND body->>'target_binding_digest'=plan.metadata->'descriptor'->>'target_binding_digest'
   AND body->>'evidence_digest'=plan.metadata->>'evidence_digest')
  AND body->'budget_policy'=policy AND body->>'budget_actor_user_id'=source.actor_user_id::text
  AND signal_workspace_incremental_editorial_actor_v1(NEW.workspace_id,(body->>'authorized_by_user_id')::uuid,source.id)
  AND CASE WHEN source.input_snapshot ? 'discovery_population' THEN
   body->'discovery_population'=jsonb_build_object('numeric_execution_id',source.id::text)
   AND NEW.processing_admission_id IS NOT NULL
   AND (body->'claude_cap_micro_usd'='null'::jsonb OR (body->>'claude_cap_micro_usd')::bigint>0)
   AND (policy->>'maximum_cap_micro_usd' IS NULL OR (body->>'claude_cap_micro_usd')::bigint<=(policy->>'maximum_cap_micro_usd')::bigint)
   AND (policy->>'daily_cap_micro_usd' IS NULL OR body->'claude_cap_micro_usd'='null'::jsonb OR (body->>'claude_cap_micro_usd')::bigint<=(policy->>'daily_cap_micro_usd')::bigint)
  ELSE NOT body ? 'discovery_population' AND (body->>'claude_cap_micro_usd')::bigint>0 AND (body->>'claude_cap_micro_usd')::bigint<=(policy->>'daily_cap_micro_usd')::bigint END
  AND body->'interpretation_configuration'=workspace_incremental_editorial_sonnet_v1()
  AND NEW.input_digest=workspace_incremental_editorial_digest_v1(body)
  AND NEW.result_summary='{"phase":"admitted","analysis_complete":false,"provider_enabled":false}'::jsonb
  AND NEW.engine_request_keys IS NULL,false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_execution_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_workspace_incremental_editorial_plan_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF COALESCE(NEW.metadata->>'contract_version','') NOT IN('workspace-incremental-editorial-plan-v1','workspace-incremental-editorial-plan-unit-v1')
 AND COALESCE(OLD.metadata->>'contract_version','') NOT IN('workspace-incremental-editorial-plan-v1','workspace-incremental-editorial-plan-unit-v1') THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'workspace_incremental_editorial_plan_immutable' USING ERRCODE='55000'; END IF;
 IF NOT COALESCE(NEW.engine_execution_id IS NULL AND NEW.source_entity_type IS NULL AND NEW.source_entity_id IS NULL AND NEW.metadata->>'numeric_execution_id'~'^[0-9a-f-]{36}$'
 AND NEW.artifact_type='engine_output' AND NEW.review_status='draft' AND NEW.workspace_artifact_kind='topic_discovery'
 AND NEW.metadata->>'plan_artifact_id'~'^[0-9a-f-]{36}$' AND pg_column_size(NEW.metadata)<=65536 AND pg_column_size(NEW.content)<=4096
 AND NEW.content->>'contract_version'='workspace-engine-private-artifact-v1' AND NEW.content->>'sha256'~'^sha256:[0-9a-f]{64}$'
 AND (NEW.content->>'size_bytes')::bigint>=0 AND NEW.content->>'storage_key' LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||(NEW.metadata->>'numeric_execution_id')||'/%'
 AND position('..' in NEW.content->>'storage_key')=0 AND workspace_incremental_editorial_source_v1((NEW.metadata->>'numeric_execution_id')::uuid)
 AND signal_workspace_incremental_editorial_actor_v1(NEW.workspace_id,(NEW.metadata->>'actor_user_id')::uuid,(NEW.metadata->>'numeric_execution_id')::uuid)
 AND NEW.discovery_run_digest=NEW.workspace_authority_digest AND NEW.discovery_run_digest=NEW.metadata->>'evidence_digest',false) THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_plan_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND NOT workspace_incremental_editorial_plan_unit_valid_v1(NEW) THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_plan_unit_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_workspace_incremental_editorial_preparation_request_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ DECLARE source jsonb; BEGIN
 IF NEW.operation_kind<>'prepare-incremental-editorial' THEN RETURN NEW; END IF;
 source:=workspace_incremental_editorial_preparation_source_v1((NEW.result->>'numeric_execution_id')::uuid);
 IF NOT COALESCE(NEW.status='completed' AND NEW.completed_at IS NOT NULL
  AND NEW.result->>'contract_version'='workspace-incremental-editorial-preparation-request-v1'
  AND NEW.result->>'operation_id'=NEW.id::text AND NEW.result->>'workspace_id'=NEW.workspace_id::text
  AND NEW.result->>'actor_user_id'=NEW.actor_user_id::text AND NEW.result->'charge_micro_usd'='0'::jsonb
  AND pg_column_size(NEW.result)<=16384
  AND NEW.result->'source'=source AND NEW.result->>'source_digest'=workspace_incremental_editorial_digest_v1(source)
  AND NEW.result->>'worker_job_id'='workspace-incremental-editorial-evidence-'||(NEW.result->>'numeric_execution_id')||'-'||substr(NEW.result->>'source_digest',8)
  AND signal_workspace_incremental_editorial_actor_v1(NEW.workspace_id,NEW.actor_user_id,(NEW.result->>'numeric_execution_id')::uuid)
  AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.id::text=NEW.result->>'numeric_execution_id' AND run.workspace_id=NEW.workspace_id
    AND workspace_incremental_editorial_source_v1(run.id)),false) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_request_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_workspace_incremental_editorial_preparation_dispatch_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$ DECLARE operation signal_classification_operations; BEGIN
 IF TG_OP='UPDATE' AND OLD.dispatch_kind='incremental_editorial_evidence' AND
   (NEW.dispatch_kind<>OLD.dispatch_kind OR NEW.execution_id<>OLD.execution_id OR NEW.workspace_id<>OLD.workspace_id) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_dispatch_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.dispatch_kind<>'incremental_editorial_evidence' THEN RETURN NEW; END IF;
 SELECT * INTO operation FROM signal_classification_operations WHERE id=NEW.preparation_operation_id AND workspace_id=NEW.workspace_id;
 IF NOT COALESCE(operation.operation_kind='prepare-incremental-editorial' AND operation.status='completed'
  AND operation.result->>'numeric_execution_id'=NEW.execution_id::text AND operation.result->>'worker_job_id'=NEW.worker_job_id
  AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions run WHERE run.id=NEW.execution_id AND run.workspace_id=NEW.workspace_id
    AND run.status='ready' AND run.input_snapshot ? 'numeric_descriptor' AND (run.input_snapshot->>'claude_cap_micro_usd')::bigint=0),false) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_dispatch_invalid' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR NEW.preparation_operation_id IS DISTINCT FROM OLD.preparation_operation_id
   OR (NEW.preparation_token IS NOT NULL AND NEW.preparation_token IS DISTINCT FROM OLD.preparation_token) THEN
  IF NOT COALESCE(workspace_incremental_editorial_source_v1(NEW.execution_id)
   AND operation.result->'source'=workspace_incremental_editorial_preparation_source_v1(NEW.execution_id)
   AND signal_workspace_incremental_editorial_actor_v1(NEW.workspace_id,operation.actor_user_id,NEW.execution_id),false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_preparation_source_stale' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.preparation_token IS NOT NULL AND OLD.preparation_expires_at>clock_timestamp() THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_preparation_busy' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id=NEW.preparation_plan_artifact_id
   AND plan.workspace_id=NEW.workspace_id AND plan.metadata->>'numeric_execution_id'=NEW.execution_id::text
   AND plan.metadata->>'contract_version'='workspace-incremental-editorial-plan-v1'
   AND plan.metadata->>'history_cut_digest'=operation.result->'source'->>'history_cut_digest') THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_plan_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status<>'completed') AND NOT COALESCE(
    OLD.preparation_token IS NOT NULL AND OLD.preparation_expires_at>clock_timestamp()
    AND operation.result->'source'=workspace_incremental_editorial_preparation_source_v1(NEW.execution_id)
    AND workspace_incremental_editorial_plan_valid_v1(NEW.preparation_plan_artifact_id),false) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_preparation_completion_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION workspace_incremental_editorial_admission_validate_v1(operation signal_classification_operations) RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_topic_catalog_executions%ROWTYPE; body jsonb:=operation.result; policy jsonb; current_receipt jsonb; spent bigint; renewal jsonb;
BEGIN
 SELECT * INTO owner FROM signal_topic_catalog_executions WHERE id=(body->>'execution_id')::uuid FOR UPDATE;policy:=owner.input_snapshot->'budget_policy';
 IF NOT COALESCE(owner.input_contract='workspace-incremental-editorial-v1' AND owner.workspace_id=operation.workspace_id
  AND operation.status='completed' AND operation.completed_at IS NOT NULL AND pg_column_size(body)<=8192
  AND signal_workspace_incremental_editorial_actor_v1(operation.workspace_id,operation.actor_user_id,owner.id)
  AND body->>'contract_version'='workspace-incremental-editorial-admission-v1' AND body->>'operation_id'=operation.id::text
  AND body->>'workspace_id'=owner.workspace_id::text AND body->>'authorized_by_user_id'=operation.actor_user_id::text
  AND body->>'budget_actor_user_id'=owner.actor_user_id::text AND body->>'input_digest'=owner.input_digest
  AND body->>'numeric_execution_id'=owner.source_execution_id::text AND body->>'numeric_checkpoint_digest'=owner.input_snapshot->>'numeric_checkpoint_digest'
  AND body->>'target_unit_digest'=owner.input_snapshot->>'target_unit_digest'
  AND body->>'target_binding_digest'=owner.input_snapshot->>'target_binding_digest' AND body->>'evidence_plan_artifact_id'=owner.input_snapshot->>'evidence_plan_artifact_id'
  AND body->>'configuration_digest'=workspace_incremental_editorial_digest_v1(owner.input_snapshot->'interpretation_configuration')
  AND (body->>'prior_admission_operation_id')::uuid IS NOT DISTINCT FROM owner.interpretation_admission_operation_id
  AND body->>'budget_timezone'=policy->>'budget_timezone' AND body->'daily_cap_micro_usd' IS NOT DISTINCT FROM policy->'daily_cap_micro_usd'
  AND body->'run_cap_micro_usd' IS NOT DISTINCT FROM owner.input_snapshot->'claude_cap_micro_usd'
  AND body->>'authorized_at'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND abs(extract(epoch FROM ((body->>'authorized_at')::timestamptz-clock_timestamp())))<60
  AND body->>'grant_digest'=workspace_incremental_editorial_digest_v1(body-'grant_digest'),false) THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_permission_invalid' USING ERRCODE='23514'; END IF;
 IF operation.operation_kind='revoke-interpretation' THEN
  current_receipt:=workspace_interpretation_admission_receipt_v1(owner.id);
  IF body->>'action' IS DISTINCT FROM 'revoke_interpretation' OR body->>'grant_cap_micro_usd' IS DISTINCT FROM '0'
   OR current_receipt->>'action' IS DISTINCT FROM 'authorize_interpretation'
   OR body-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd'
    IS DISTINCT FROM current_receipt-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd' THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_revoke_invalid' USING ERRCODE='23514'; END IF;
 ELSIF owner.interpretation_admission_operation_id IS NOT NULL THEN
  renewal:=workspace_incremental_editorial_renewal_state_v1(owner.id);
  IF NOT COALESCE(operation.operation_kind='authorize-interpretation' AND body->>'action'='authorize_interpretation'
   AND (renewal->>'eligible')::boolean
   AND ((owner.input_snapshot ? 'discovery_population' AND body->'grant_cap_micro_usd'='null'::jsonb AND renewal->'maximum_grant_micro_usd'='null'::jsonb)
    OR body->>'grant_cap_micro_usd'~'^[1-9][0-9]*$' AND (body->>'grant_cap_micro_usd')::numeric<=9007199254740991
    AND (renewal->'maximum_grant_micro_usd'='null'::jsonb OR (body->>'grant_cap_micro_usd')::numeric<=(renewal->>'maximum_grant_micro_usd')::numeric))
   AND body->>'budget_date'=renewal->>'budget_date'
   AND body->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   AND (body->>'admission_not_after')::timestamptz>clock_timestamp()
   AND (body->>'admission_not_after')::timestamptz<=(renewal->>'maximum_admission_not_after')::timestamptz,false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_renewal_unavailable' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||owner.actor_user_id::text,0));
  renewal:=workspace_incremental_editorial_renewal_state_v1(owner.id);
  IF NOT COALESCE((renewal->>'eligible')::boolean AND (renewal->'maximum_grant_micro_usd'='null'::jsonb OR (body->>'grant_cap_micro_usd')::numeric<=(renewal->>'maximum_grant_micro_usd')::numeric),false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_cap_exceeded' USING ERRCODE='23514'; END IF;
 ELSE
  -- Initial permission only: a new key never renews or reacquires a unit.
  IF NOT COALESCE(owner.interpretation_admission_operation_id IS NULL AND body->>'action'='authorize_interpretation'
   AND body->'grant_cap_micro_usd' IS NOT DISTINCT FROM owner.input_snapshot->'claude_cap_micro_usd'
   AND workspace_incremental_editorial_source_v1(owner.source_execution_id) AND workspace_incremental_editorial_claims_complete_v1(owner.id)
   AND body->>'budget_date'=(clock_timestamp() AT TIME ZONE (policy->>'budget_timezone'))::date::text
   AND body->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   AND (body->>'admission_not_after')::timestamptz>clock_timestamp()
   AND (body->>'admission_not_after')::timestamptz<=CASE WHEN owner.input_snapshot ? 'discovery_population' AND policy->>'daily_cap_micro_usd' IS NULL THEN (policy->>'valid_until')::timestamptz ELSE (((body->>'budget_date')::date+1)::timestamp AT TIME ZONE (policy->>'budget_timezone')) END,false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_permission_unavailable' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||owner.actor_user_id::text,0));
  SELECT COALESCE(sum(workspace_engine_interpretation_effective_cost_v1(engine_cost_events)),0)
   INTO spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=owner.actor_user_id AND budget_date=(body->>'budget_date')::date;
  IF (body->>'grant_cap_micro_usd')::bigint<=0 OR (body->>'grant_cap_micro_usd')::bigint>(policy->>'daily_cap_micro_usd')::bigint-spent THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_cap_exceeded' USING ERRCODE='23514'; END IF;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION guard_workspace_interpretation_call_admission_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; receipt jsonb; grant_spent bigint;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.metadata->'interpretation_admission' IS DISTINCT FROM OLD.metadata->'interpretation_admission' THEN
  RAISE EXCEPTION 'Call admission is immutable.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id FOR UPDATE;
  IF execution.interpretation_admission_operation_id IS NULL THEN
   IF NEW.metadata ? 'interpretation_admission' THEN RAISE EXCEPTION 'Unexpected admission.' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
  receipt:=workspace_interpretation_admission_receipt_v1(execution.id);
  IF NOT COALESCE(receipt->>'action'='authorize_interpretation'
   AND NEW.metadata->'interpretation_admission'=jsonb_build_object('operation_id',receipt->>'operation_id','grant_digest',receipt->>'grant_digest')
   AND receipt->>'budget_actor_user_id'=NEW.actor_user_id::text
   AND receipt->>'budget_date'=NEW.budget_date::text
   AND clock_timestamp()<(receipt->>'admission_not_after')::timestamptz
   AND signal_workspace_incremental_editorial_actor_v1(execution.workspace_id,(receipt->>'authorized_by_user_id')::uuid,execution.id)
   AND signal_workspace_engine_actor_v1(execution,execution.actor_user_id)
   AND CASE WHEN execution.input_contract='workspace-incremental-editorial-v1' THEN workspace_incremental_editorial_execution_current_v1(execution.id) ELSE signal_workspace_incremental_parent_current_v1(execution.id,execution.workspace_id,execution.actor_user_id) END,false) THEN
   RAISE EXCEPTION 'Call admission unavailable.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(workspace_engine_interpretation_effective_cost_v1(engine_cost_events)),0)
   INTO grant_spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND id<>NEW.id
    AND catalog_execution_id=NEW.catalog_execution_id AND metadata->'interpretation_admission'->>'operation_id'=receipt->>'operation_id';
  IF grant_spent+NEW.reserved_micro_usd>(receipt->>'grant_cap_micro_usd')::bigint THEN
   RAISE EXCEPTION 'Interpretation grant cap exceeded.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION signal_workspace_incremental_binding_scope_v1(artifact analysis_artifacts)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN signal_topic_classification_outbox dispatch ON dispatch.execution_id=engine.id AND dispatch.workspace_id=engine.workspace_id
   AND dispatch.dispatch_kind='incremental_projection' AND dispatch.status IN('dispatching','dispatched')
  WHERE engine.id=artifact.engine_execution_id AND engine.workspace_id=artifact.workspace_id AND engine.status='ready'
   AND engine.input_snapshot ? 'numeric_descriptor' AND engine.result_summary ? 'numeric_checkpoint'
   AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=engine.workspace_id)
   AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp())
   AND signal_workspace_incremental_execution_current_v1(engine.id) AND signal_workspace_incremental_serving_current_v1(engine.id)
   AND signal_workspace_engine_actor_v1(engine,engine.actor_user_id)
   AND artifact.metadata->>'actor_user_id'=engine.actor_user_id::text
   AND artifact.metadata->>'worker_job_id'=dispatch.worker_job_id
   AND dispatch.worker_job_id='workspace-incremental-projection-'||engine.id::text||'-'||substring(workspace_incremental_editorial_digest_v1(jsonb_build_array(
    engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest',signal_workspace_incremental_operational_profile_v1(engine.id)::text,
    signal_workspace_incremental_correction_epoch_v1(engine.workspace_id),signal_workspace_incremental_serving_digest_v1(engine.id))) FROM 8)
   AND artifact.metadata->>'numeric_checkpoint_digest'=engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
   AND artifact.metadata->>'derivation_digest'~'^sha256:[0-9a-f]{64}$'),false)
$$;
CREATE OR REPLACE FUNCTION workspace_incremental_editorial_renewal_state_v1(target uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path=public,extensions,pg_temp AS $$
 WITH source AS MATERIALIZED (SELECT owner.*,workspace_interpretation_admission_receipt_v1(owner.id) receipt,
  workspace_incremental_editorial_execution_current_v1(owner.id) is_current,
  workspace_incremental_editorial_output_complete_v1(owner.id) output_complete,
  clock_timestamp() now FROM signal_topic_catalog_executions owner WHERE owner.id=target AND owner.input_contract='workspace-incremental-editorial-v1'),
 policy AS MATERIALIZED (SELECT source.*,(input_snapshot->>'claude_cap_micro_usd')::bigint run_cap,
  (input_snapshot->'budget_policy'->>'daily_cap_micro_usd')::bigint daily_cap,
  input_snapshot->'budget_policy'->>'budget_timezone' zone,
  (now AT TIME ZONE (input_snapshot->'budget_policy'->>'budget_timezone'))::date AS budget_day FROM source),
 calls AS MATERIALIZED (SELECT call.*,workspace_incremental_editorial_renewal_releasable_v1(call) releasable,
  workspace_engine_interpretation_effective_cost_v1(call) exposure,
  workspace_engine_interpretation_terminal_billed_v1(call) terminal_billed
  FROM engine_cost_events call JOIN policy ON call.actor_user_id=policy.actor_user_id
  WHERE call.workspace_contract='workspace-engine-interpretation-v1' AND (call.catalog_execution_id=target OR call.budget_date=policy.budget_day)),
 money AS (SELECT
  COALESCE(sum(exposure) FILTER(WHERE catalog_execution_id=target AND NOT releasable),0) run_spent,
  COALESCE(sum(exposure) FILTER(WHERE budget_date=(SELECT budget_day FROM policy) AND NOT (catalog_execution_id=target AND releasable)),0) day_spent,
  COALESCE(sum(settled_micro_usd) FILTER(WHERE catalog_execution_id=target AND (call_state='settled' OR terminal_billed)),0) confirmed,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=target AND call_state NOT IN('settled','definitely_not_sent') AND NOT terminal_billed),0) reserved,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=target AND call_state='terminal_confirmed' AND NOT terminal_billed),0) terminal,
  COALESCE(bool_or(catalog_execution_id=target AND (call_state IN('in_flight','outcome_unknown')
   OR call_state='reserved' AND NOT releasable OR call_state='response_persisted' AND (response_storage_key IS NULL OR NOT COALESCE((metadata->>'response_complete')::boolean,true)))),false) uncertain
  FROM calls),
 prepared AS (SELECT policy.*,money.*,CASE WHEN run_cap IS NULL AND daily_cap IS NULL AND input_snapshot ? 'discovery_population' THEN NULL ELSE greatest(0,least(run_cap-run_spent,daily_cap-day_spent)) END maximum,
  (SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=target AND workspace_id=policy.workspace_id AND dispatch_kind='execution') job
  FROM policy CROSS JOIN money),
 checked AS (SELECT prepared.*,CASE
  WHEN NOT is_current THEN 'workspace_incremental_editorial_source_stale'
  WHEN status<>'failed' OR execution_token IS NOT NULL OR execution_expires_at IS NOT NULL THEN 'workspace_incremental_editorial_renewal_not_failed'
  WHEN uncertain THEN 'workspace_incremental_editorial_renewal_uncertain'
  WHEN output_complete THEN 'workspace_incremental_editorial_renewal_output_complete'
  WHEN receipt IS NULL OR NOT COALESCE(receipt->>'action'='revoke_interpretation' OR (receipt->>'admission_not_after')::timestamptz<=now,false) THEN 'workspace_incremental_editorial_renewal_not_expired'
  WHEN error_code IS NULL OR error_code NOT IN('workspace_engine_interpretation_daily_authority_expired','workspace_engine_interpretation_admission_revoked','workspace_engine_interpretation_admission_changed',
   'workspace_incremental_editorial_transport_unavailable','workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable','workspace_engine_interpretation_receipt_recovery_required','workspace_engine_interpretation_transport_terminal_confirmed') THEN 'workspace_incremental_editorial_renewal_failure_blocked'
  WHEN error_code='workspace_engine_interpretation_receipt_recovery_required' AND NOT EXISTS(SELECT 1 FROM calls WHERE catalog_execution_id=target AND call_state='response_persisted' AND response_storage_key IS NOT NULL AND COALESCE((metadata->>'response_complete')::boolean,true)) THEN 'workspace_incremental_editorial_renewal_failure_blocked'
  WHEN error_code='workspace_engine_interpretation_transport_terminal_confirmed' AND (NOT EXISTS(SELECT 1 FROM calls WHERE catalog_execution_id=target AND call_state='terminal_confirmed' AND metadata ? 'provider_terminal_receipt') OR EXISTS(SELECT 1 FROM calls WHERE catalog_execution_id=target AND call_state='terminal_confirmed' GROUP BY request_digest HAVING count(*)>1)) THEN 'workspace_incremental_editorial_renewal_failure_blocked'
  WHEN job IS DISTINCT FROM 'signal-workspace-incremental-editorial-'||target::text||'-1'
   OR (result_summary->>'worker_job_id' IS NOT NULL AND result_summary->>'worker_job_id'<>job) THEN 'workspace_incremental_editorial_dispatch_unavailable'
  WHEN maximum<=0 THEN 'workspace_incremental_editorial_cap_exceeded'
  ELSE NULL END blocked FROM prepared)
 SELECT jsonb_build_object('execution_id',id,'is_current',is_current,'eligible',blocked IS NULL,'can_renew',blocked IS NULL,'blocked_reason',blocked,
  'expected_admission_operation_id',interpretation_admission_operation_id,'budget_actor_user_id',actor_user_id,'budget_timezone',zone,'budget_date',budget_day::text,
  'now',to_char(now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'maximum_admission_not_after',to_char((CASE WHEN input_snapshot ? 'discovery_population' AND daily_cap IS NULL THEN (input_snapshot->'budget_policy'->>'valid_until')::timestamptz ELSE ((budget_day+1)::timestamp AT TIME ZONE zone) END) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'run_cap_micro_usd',run_cap,'daily_cap_micro_usd',daily_cap,'confirmed_micro_usd',confirmed,'reserved_micro_usd',reserved,'terminal_reserved_micro_usd',terminal,
  'maximum_grant_micro_usd',maximum,'receipt',receipt,'context_digest',input_snapshot->>'context_digest','catalog_digest',input_snapshot->>'catalog_input_digest','worker_job_id',job)
 FROM checked
$$;
CREATE OR REPLACE FUNCTION guard_signal_workspace_incremental_catalog_receipt_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE body jsonb; engine signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF COALESCE(NEW.action,'')<>'materialize_incremental' AND COALESCE(OLD.action,'')<>'materialize_incremental' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'workspace_incremental_catalog_receipt_immutable' USING ERRCODE='55000'; END IF;
 body:=NEW.result_summary;
 SELECT * INTO engine FROM signal_topic_catalog_executions WHERE id::text=body->>'numeric_execution_id' AND workspace_id=NEW.workspace_id;
 IF NOT COALESCE(engine.input_snapshot ? 'numeric_descriptor' AND engine.status='ready' AND engine.actor_user_id=NEW.actor_user_id
  AND signal_workspace_engine_actor_v1(engine,NEW.actor_user_id) AND signal_workspace_incremental_execution_current_v1(engine.id)
  AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=NEW.workspace_id)
  AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp()) AND signal_workspace_incremental_origin_current_v1(engine.id,engine.workspace_id)
  AND signal_workspace_incremental_serving_current_v1(engine.id)
  AND body->>'contract_version'='workspace-incremental-editorial-catalog-receipt-v1' AND body->>'receipt_id'=NEW.id::text
  AND body->>'serving_editorial_cut_digest'=signal_workspace_incremental_serving_digest_v1(engine.id)
  AND NEW.idempotency_key='incremental-catalog:'||engine.id::text||':'||substring(body->>'serving_editorial_cut_digest' FROM 8)
  AND NEW.request_digest=workspace_incremental_editorial_digest_v1(jsonb_build_object('numeric_execution_id',engine.id::text,'serving_editorial_cut_digest',body->>'serving_editorial_cut_digest'))
  AND body->>'output_catalog_profile_id'=NEW.result_profile_id::text AND body->>'mapping_digest'~'^sha256:[0-9a-f]{64}$'
  AND EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile WHERE profile.id=NEW.result_profile_id AND profile.workspace_id=NEW.workspace_id
   AND profile.version::text=body->>'output_catalog_revision' AND profile.kind='topic' AND profile.metadata->>'contract_version'='signal-topic-catalog-v1'
   AND (profile.id=signal_workspace_incremental_operational_profile_v1(engine.id)
    OR (profile.metadata->>'catalog_role'='incremental'
     AND profile.metadata->>'source_catalog_profile_id'=signal_workspace_incremental_operational_profile_v1(engine.id)::text
     AND profile.metadata->>'source_numeric_execution_id'=engine.id::text
     AND profile.metadata->>'serving_editorial_cut_digest'=body->>'serving_editorial_cut_digest'
     AND profile.metadata->>'source_mapping_digest'=body->>'mapping_digest')))
  AND jsonb_typeof(body->'topic_count')='number' AND jsonb_typeof(body->'discovered_topic_count')='number'
  AND body->>'topic_count'=(SELECT count(*)::text FROM taxonomy_terms term JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id
   WHERE profile.id=NEW.result_profile_id AND term.metadata->'topic'->>'lifecycle'<>'archived')
  AND body->>'discovered_topic_count'=(SELECT count(*)::text FROM taxonomy_terms term JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id
   WHERE profile.id=NEW.result_profile_id AND term.metadata->'topic'->>'lifecycle'<>'archived' AND term.metadata->'topic'->>'origin'='workspace_discovery')
  AND NEW.result_term_key='' AND NEW.selection_result IS NULL,false) THEN RAISE EXCEPTION 'workspace_incremental_catalog_receipt_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION signal_processing_capacity_pre0160_v1(target_workspace uuid,target_actor uuid,target_run uuid,admission_id uuid,
 allowed_actions text[],actual_provider text,actual_model text,actual_configuration jsonb,owner_cap bigint,
 ledger_kind text DEFAULT NULL,ledger_id uuid DEFAULT NULL,amount bigint DEFAULT 0,reserved_time timestamptz DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE org uuid;p signal_processing_policy_versions%ROWTYPE;r signal_processing_admissions%ROWTYPE;
 day date;spent bigint;run_spent bigint;client_actor boolean;mfp boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions e WHERE e.id=target_run AND e.workspace_id=target_workspace AND e.input_contract IN('workspace-topic-engine-v1','workspace-incremental-editorial-v1') AND jsonb_typeof(e.input_snapshot->'discovery_population')='object') INTO mfp;
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
