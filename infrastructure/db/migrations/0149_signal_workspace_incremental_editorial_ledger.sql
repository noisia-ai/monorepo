-- One existing monetary ledger; only sealed, exclusively owned editorial requests.
-- Numeric/full-fit snapshots, claims, model origins and prior receipts remain immutable.
CREATE FUNCTION workspace_incremental_editorial_execution_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions owner JOIN signal_topic_catalog_executions source ON source.id=owner.source_execution_id
 WHERE owner.id=target AND owner.input_contract='workspace-incremental-editorial-v1' AND owner.workspace_id=source.workspace_id AND owner.actor_user_id=source.actor_user_id
 AND source.input_contract='workspace-topic-engine-v1' AND source.input_snapshot ? 'numeric_descriptor' AND source.status='ready'
 AND (source.input_snapshot->>'claude_cap_micro_usd')::bigint=0 AND NOT source.input_snapshot ? 'interpretation_config' AND source.interpretation_admission_operation_id IS NULL
 AND owner.input_snapshot->>'numeric_checkpoint_digest'=source.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
 AND owner.input_snapshot->>'history_cut_digest'=signal_workspace_incremental_projection_editorial_digest_v1(source.id)
 AND signal_workspace_incremental_parent_current_v1(source.id,source.workspace_id,source.actor_user_id)
 AND signal_workspace_incremental_execution_current_v1(source.id) AND signal_workspace_incremental_projection_history_current_v1(source.id)
 AND source.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=source.workspace_id)
 AND workspace_incremental_editorial_claims_complete_v1(owner.id)
 AND NOT EXISTS(SELECT 1 FROM workspace_incremental_editorial_units_v1(source.id) unit JOIN analysis_artifacts claim ON claim.engine_execution_id=owner.id
  AND claim.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1' AND claim.metadata->'unit'->>'unit_key'=unit.identity->'unit'->>'unit_key'
  WHERE unit.claimed_by IS DISTINCT FROM owner.id OR unit.identity IS DISTINCT FROM jsonb_build_object('component_key',claim.metadata->>'component_key','unit',claim.metadata->'unit','model_origin',claim.metadata->'model_origin'))
 AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions newer WHERE newer.workspace_id=source.workspace_id AND newer.status='ready' AND newer.input_snapshot ? 'numeric_descriptor' AND newer.input_revision=source.input_revision AND (newer.created_at,newer.id)>(source.created_at,source.id))
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events call WHERE call.workspace_id=source.workspace_id AND call.catalog_execution_id<>owner.id AND call.call_state IN('reserved','in_flight','response_persisted','outcome_unknown')
  AND (call.catalog_execution_id=source.id OR call.catalog_execution_id IN(SELECT parent_id FROM signal_workspace_incremental_projection_lineage_v1(source.id)) OR call.catalog_execution_id IN(SELECT claimed_by FROM workspace_incremental_editorial_units_v1(source.id))))),false)
$$;
CREATE FUNCTION workspace_incremental_editorial_request_plan_valid_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH plan AS (SELECT a.*,a.metadata->'plan' body FROM analysis_artifacts a WHERE a.id=target AND a.metadata->>'contract_version'='workspace-incremental-editorial-request-plan-v1'),
 requests AS (SELECT a.metadata->'request' body FROM analysis_artifacts a JOIN plan ON a.engine_execution_id=plan.engine_execution_id WHERE a.metadata->>'contract_version'='workspace-incremental-editorial-request-v1' AND a.metadata->>'plan_digest'=plan.body->>'plan_digest'),
 census AS (SELECT count(*) n,count(DISTINCT body->>'index') unique_index,count(DISTINCT body->>'request_digest') unique_request,
  jsonb_agg(body ORDER BY (body->>'index')::int) requests,sum((body->>'size_bytes')::bigint) bytes FROM requests),
 units AS (SELECT key FROM requests CROSS JOIN LATERAL jsonb_array_elements_text(body->'unit_keys') unit(key))
 SELECT COALESCE(EXISTS(SELECT 1 FROM plan JOIN signal_topic_catalog_executions owner ON owner.id=plan.engine_execution_id CROSS JOIN census
 WHERE owner.input_contract='workspace-incremental-editorial-v1' AND plan.workspace_id=owner.workspace_id
 AND plan.body->>'contract_version'='workspace-incremental-editorial-batch-plan-v1'
 AND plan.body->>'workspace_id'=owner.workspace_id::text AND plan.body->>'editorial_execution_id'=owner.id::text
 AND plan.body->>'numeric_execution_id'=owner.source_execution_id::text
 AND plan.body->>'evidence_digest'=owner.input_snapshot->>'evidence_digest'
 AND plan.body->>'target_unit_digest'=owner.input_snapshot->>'target_unit_digest'
 AND plan.body->>'target_binding_digest'=owner.input_snapshot->>'target_binding_digest'
 AND plan.body->>'context_digest'=owner.input_snapshot->>'context_digest'
 AND plan.body->>'configuration_digest'=workspace_incremental_editorial_digest_v1(owner.input_snapshot->'interpretation_configuration')
 AND census.n=(SELECT count(*) FROM analysis_artifacts extra WHERE extra.engine_execution_id=owner.id AND extra.metadata->>'contract_version'='workspace-incremental-editorial-request-v1')
 AND NOT EXISTS(SELECT 1 FROM analysis_artifacts extra WHERE extra.engine_execution_id=owner.id AND extra.metadata->>'contract_version'='workspace-incremental-editorial-request-v1' AND extra.content IS DISTINCT FROM plan.content)
 AND census.n>0 AND census.n=census.unique_index AND census.n=census.unique_request AND census.n=(plan.body->>'batches')::bigint
 AND census.bytes=(plan.body->'stream'->>'bytes')::bigint AND plan.content->>'size_bytes'=plan.body->'stream'->>'bytes' AND plan.content->>'sha256'=plan.body->'stream'->>'sha256'
 AND plan.body->>'plan_digest'=workspace_incremental_editorial_digest_v1((plan.body-'plan_digest')||jsonb_build_object('requests',census.requests))
 AND (SELECT count(*) FROM units)=(owner.input_snapshot->>'target_units')::bigint AND (SELECT count(*) FROM units)=(plan.body->>'units')::bigint
 AND (SELECT count(*) FROM units)=(SELECT count(DISTINCT key) FROM units)
 AND NOT EXISTS(SELECT 1 FROM units WHERE NOT EXISTS(SELECT 1 FROM analysis_artifacts claim WHERE claim.engine_execution_id=owner.id AND claim.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1' AND claim.metadata->'unit'->>'unit_key'=units.key))
 AND NOT EXISTS(SELECT 1 FROM (SELECT body,row_number() OVER(ORDER BY (body->>'index')::int)-1 expected_index,
 COALESCE(sum((body->>'size_bytes')::bigint) OVER(ORDER BY (body->>'index')::int ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) expected_offset FROM requests) row
 WHERE (body->>'index')::bigint<>expected_index OR (body->>'offset')::bigint<>expected_offset)),false)
$$;
CREATE FUNCTION workspace_incremental_editorial_request_v1(target uuid,requested text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT request.metadata->'request' FROM analysis_artifacts request JOIN signal_topic_catalog_executions owner ON owner.id=request.engine_execution_id JOIN analysis_artifacts plan ON plan.id::text=owner.result_summary->>'request_plan_artifact_id' AND plan.engine_execution_id=owner.id
 WHERE owner.id=target AND request.metadata->>'contract_version'='workspace-incremental-editorial-request-v1' AND request.metadata->'request'->>'request_digest'=requested
 AND request.metadata->>'plan_digest'=owner.result_summary->>'request_plan_digest' AND request.metadata->>'plan_digest'=plan.metadata->'plan'->>'plan_digest' AND request.content=plan.content
 UNION ALL SELECT jsonb_build_object('request_digest',metadata->>'request_digest','unit_keys',metadata->'unit_keys','reserved_micro_usd',metadata->'reserved_micro_usd','editorial_repair',metadata->'editorial_repair') FROM analysis_artifacts WHERE engine_execution_id=target AND metadata->>'contract_version'='workspace-incremental-editorial-repair-request-v1' AND metadata->>'request_digest'=requested
$$;
CREATE FUNCTION workspace_incremental_editorial_output_complete_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH units AS (SELECT unit.key FROM analysis_artifacts a CROSS JOIN LATERAL jsonb_array_elements_text(a.metadata->'unit_keys') unit(key) WHERE a.engine_execution_id=target AND a.metadata->>'contract_version'='workspace-incremental-editorial-checkpoint-v1')
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions owner WHERE owner.id=target AND owner.input_contract='workspace-incremental-editorial-v1'
 AND (SELECT count(*) FROM units)=(owner.input_snapshot->>'target_units')::bigint AND (SELECT count(*) FROM units)=(SELECT count(DISTINCT key) FROM units)
 AND NOT EXISTS(SELECT 1 FROM units WHERE NOT EXISTS(SELECT 1 FROM analysis_artifacts claim WHERE claim.engine_execution_id=target AND claim.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1' AND claim.metadata->'unit'->>'unit_key'=units.key))
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=target AND call_state IN('reserved','in_flight','response_persisted','outcome_unknown'))),false)
$$;
CREATE FUNCTION workspace_incremental_editorial_ledger_request_v1(call engine_cost_events) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions owner WHERE owner.id=call.catalog_execution_id AND owner.workspace_id=call.workspace_id AND owner.actor_user_id=call.actor_user_id
 AND owner.input_contract='workspace-incremental-editorial-v1' AND owner.status='running' AND owner.execution_expires_at>clock_timestamp()
 AND workspace_incremental_editorial_execution_current_v1(owner.id)
 AND workspace_incremental_editorial_request_plan_valid_v1((owner.result_summary->>'request_plan_artifact_id')::uuid)
 AND call.call_configuration=owner.input_snapshot->'interpretation_configuration'
 AND call.budget_timezone=owner.input_snapshot->'budget_policy'->>'budget_timezone'
 AND call.budget_daily_cap_micro_usd=(owner.input_snapshot->'budget_policy'->>'daily_cap_micro_usd')::bigint
 AND call.reserved_micro_usd=(workspace_incremental_editorial_request_v1(owner.id,call.request_digest)->>'reserved_micro_usd')::bigint
 AND call.metadata->'editorial_repair' IS NOT DISTINCT FROM workspace_incremental_editorial_request_v1(owner.id,call.request_digest)->'editorial_repair'
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events other WHERE other.catalog_execution_id=owner.id AND other.id<>call.id AND other.call_state IN('in_flight','response_persisted','outcome_unknown'))),false)
$$;
CREATE FUNCTION workspace_incremental_editorial_artifact_valid_v1(a analysis_artifacts) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_topic_catalog_executions%ROWTYPE; body jsonb; request jsonb; call engine_cost_events%ROWTYPE; source engine_cost_events%ROWTYPE; value jsonb; field text;
BEGIN
 SELECT * INTO owner FROM signal_topic_catalog_executions WHERE id=a.engine_execution_id AND workspace_id=a.workspace_id;
 IF NOT COALESCE(owner.input_contract='workspace-incremental-editorial-v1' AND owner.status='running' AND owner.execution_expires_at>clock_timestamp()
 AND signal_workspace_classification_actor_v1(owner.workspace_id,owner.actor_user_id) AND a.workspace_artifact_kind='topic_discovery' AND a.review_status='draft'
 AND a.discovery_run_digest='sha256:'||encode(sha256(convert_to(owner.input_digest||':'||owner.id::text,'UTF8')),'hex') AND a.workspace_authority_digest=a.discovery_run_digest
 AND a.content->>'contract_version'='workspace-engine-private-artifact-v1' AND a.content->>'sha256'~'^sha256:[0-9a-f]{64}$'
 AND a.content->>'size_bytes'~'^[1-9][0-9]*$' AND (a.content->>'size_bytes')::numeric<=9007199254740991
 AND a.content->>'storage_key' LIKE 'workspace-engine/'||owner.workspace_id::text||'/'||owner.id::text||'/%' AND position('..' IN a.content->>'storage_key')=0
 AND pg_column_size(a.metadata)<=65536 AND pg_column_size(a.content)<=65536,false) THEN RETURN false; END IF;
 body:=a.metadata;
 IF body->>'contract_version'='workspace-incremental-editorial-request-v1' THEN
  request:=body->'request';
  FOREACH field IN ARRAY ARRAY['index','reserved_micro_usd','offset','size_bytes'] LOOP
   IF jsonb_typeof(request->field) IS DISTINCT FROM 'number' OR (request->>field)!~'^(0|[1-9][0-9]*)$' OR (request->>field)::numeric>9007199254740991 THEN RETURN false; END IF;
  END LOOP;
  RETURN COALESCE(a.artifact_type='engine_output' AND a.artifact_key='editorial-request-'||(request->>'index') AND body->>'plan_digest'~'^sha256:[0-9a-f]{64}$'
   AND (request->>'reserved_micro_usd')::bigint>0 AND (request->>'size_bytes')::bigint BETWEEN 1 AND 8388608
   AND request->>'request_digest'~'^sha256:[0-9a-f]{64}$' AND request->>'sha256'~'^sha256:[0-9a-f]{64}$'
   AND request->>'batch_key'='interpretation:'||substring(request->>'request_digest' FROM 8)
   AND jsonb_typeof(request->'unit_keys')='array' AND jsonb_array_length(request->'unit_keys') BETWEEN 1 AND 4
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(request->'unit_keys') unit(key) WHERE NOT EXISTS(SELECT 1 FROM analysis_artifacts claim WHERE claim.engine_execution_id=owner.id AND claim.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1' AND claim.metadata->'unit'->>'unit_key'=unit.key))
   AND NOT owner.result_summary ? 'request_plan_artifact_id',false);
 ELSIF body->>'contract_version'='workspace-incremental-editorial-request-plan-v1' THEN
  FOREACH field IN ARRAY ARRAY['units','batches'] LOOP IF jsonb_typeof(body->'plan'->field) IS DISTINCT FROM 'number' OR (body->'plan'->>field)!~'^[1-9][0-9]*$' OR (body->'plan'->>field)::numeric>9007199254740991 THEN RETURN false; END IF; END LOOP;
  RETURN a.artifact_type='engine_output' AND a.artifact_key='editorial-request-plan.jsonl' AND jsonb_typeof(body->'plan')='object' AND NOT owner.result_summary ? 'request_plan_artifact_id';
 ELSIF body->>'contract_version'='workspace-incremental-editorial-repair-request-v1' THEN
  request:=workspace_incremental_editorial_request_v1(owner.id,body->'editorial_repair'->>'source_request_digest');
  SELECT * INTO source FROM engine_cost_events WHERE id=(body->'editorial_repair'->>'source_call_id')::uuid;
  RETURN COALESCE(a.artifact_type='engine_output' AND a.artifact_key='editorial-repair-'||source.id::text AND source.catalog_execution_id=owner.id AND source.actor_user_id=owner.actor_user_id
   AND source.call_state='settled' AND source.response_http_status=200 AND source.metadata->>'response_complete' IS DISTINCT FROM 'false' AND source.response_sha256=body->'editorial_repair'->>'source_response_sha256'
   AND source.request_digest=request->>'request_digest' AND NOT source.metadata ? 'editorial_repair' AND NOT request ? 'editorial_repair'
   AND body->'unit_keys'=request->'unit_keys' AND body->>'request_digest'~'^sha256:[0-9a-f]{64}$' AND body->>'request_digest'<>source.request_digest
   AND body->'editorial_repair'->>'contract_version'='workspace-editorial-repair-v1' AND body->'editorial_repair'->>'diagnostic'='output_invalid'
   AND body->'editorial_repair'->>'protocol_digest'='sha256:7b113e97b33c00fc94a6043ac1f1f4a6c7aa99c5e792c465a384587e9b72e3d3'
   AND jsonb_typeof(body->'reserved_micro_usd')='number' AND body->>'reserved_micro_usd'~'^[1-9][0-9]*$' AND (body->>'reserved_micro_usd')::numeric<=9007199254740991
   AND NOT EXISTS(SELECT 1 FROM analysis_artifacts prior WHERE prior.engine_execution_id=owner.id AND prior.metadata->>'contract_version'='workspace-incremental-editorial-checkpoint-v1' AND prior.metadata->'unit_keys' ?| ARRAY(SELECT jsonb_array_elements_text(body->'unit_keys'))),false);
 ELSIF body->>'contract_version'='workspace-incremental-editorial-checkpoint-v1' THEN
  SELECT * INTO call FROM engine_cost_events WHERE id=(body->>'call_id')::uuid AND catalog_execution_id=owner.id AND workspace_id=owner.workspace_id;
  request:=workspace_incremental_editorial_request_v1(owner.id,call.request_digest);
  RETURN COALESCE(a.artifact_type='engine_proposals' AND a.artifact_key='editorial-checkpoint-'||call.id::text AND call.call_state='settled' AND call.response_http_status=200 AND call.metadata->>'response_complete' IS DISTINCT FROM 'false'
   AND call.response_sha256=body->>'response_sha256' AND call.request_digest=body->>'request_digest' AND body->'unit_keys'=request->'unit_keys'
   AND body->>'numeric_execution_id'=owner.source_execution_id::text AND body->>'numeric_checkpoint_digest'=owner.input_snapshot->>'numeric_checkpoint_digest'
   AND body->>'evidence_digest'=owner.input_snapshot->>'evidence_digest' AND body->>'target_binding_digest'=owner.input_snapshot->>'target_binding_digest'
   AND NOT EXISTS(SELECT 1 FROM analysis_artifacts prior WHERE prior.engine_execution_id=owner.id AND prior.metadata->>'contract_version'='workspace-incremental-editorial-checkpoint-v1' AND prior.metadata->'unit_keys' ?| ARRAY(SELECT jsonb_array_elements_text(body->'unit_keys'))),false);
 END IF; RETURN false;
END $$;
CREATE FUNCTION guard_workspace_incremental_editorial_artifact_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF TG_OP<>'INSERT' AND (EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=OLD.engine_execution_id AND input_contract='workspace-incremental-editorial-v1') OR EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND input_contract='workspace-incremental-editorial-v1')) THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_artifact_immutable' USING ERRCODE='55000'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_workspace_incremental_editorial_artifact BEFORE UPDATE OR DELETE ON analysis_artifacts FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_artifact_v1();
CREATE FUNCTION guard_workspace_incremental_editorial_request_plan_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.metadata->>'contract_version'='workspace-incremental-editorial-request-plan-v1' AND NOT workspace_incremental_editorial_request_plan_valid_v1(NEW.id) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_plan_invalid' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_workspace_incremental_editorial_request_plan_complete AFTER INSERT ON analysis_artifacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_request_plan_complete_v1();

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
  IF NEW.status<>OLD.status AND NOT (OLD.status='queued' AND NEW.status='running' OR (OLD.status='queued' AND NEW.status='failed'
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
  AND NEW.taxonomy_profile_id=(SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1)
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
  AND workspace_interpretation_admission_admin_v1(NEW.workspace_id,(body->>'authorized_by_user_id')::uuid)
  AND (body->>'claude_cap_micro_usd')::bigint>0 AND (body->>'claude_cap_micro_usd')::bigint<=(policy->>'daily_cap_micro_usd')::bigint
  AND body->'interpretation_configuration'=workspace_incremental_editorial_sonnet_v1()
  AND NEW.input_digest=workspace_incremental_editorial_digest_v1(body)
  AND NEW.result_summary='{"phase":"admitted","analysis_complete":false,"provider_enabled":false}'::jsonb
  AND NEW.engine_request_keys IS NULL,false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_execution_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_signal_workspace_engine_artifact_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.engine_execution_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id;
 IF execution.input_contract='workspace-incremental-editorial-v1' THEN
  IF NOT (workspace_incremental_editorial_claim_valid_v1(NEW) OR workspace_incremental_editorial_artifact_valid_v1(NEW)) THEN RAISE EXCEPTION 'workspace_incremental_editorial_claim_invalid' USING ERRCODE='23514'; END IF; RETURN NEW; END IF;
 IF execution.id IS NULL OR execution.input_contract<>'workspace-topic-engine-v1' OR NOT (execution.status='ready' AND NEW.metadata->>'contract_version' IN('workspace-incremental-unit-census-v1','workspace-incremental-unit-binding-v1','workspace-incremental-binding-index-v1') AND signal_workspace_incremental_binding_scope_v1(NEW) OR execution.status='running' OR execution.status IN('failed','ready') AND NEW.artifact_type='engine_proposals' AND NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1')
  OR NEW.workspace_artifact_kind<>'topic_discovery' OR NEW.discovery_run_digest<>'sha256:'||encode(sha256(convert_to(execution.input_digest||':'||execution.id::text,'UTF8')),'hex')
  OR NEW.review_status<>'draft' OR NEW.artifact_type NOT IN('engine_model','engine_output','engine_proposals')
  OR NOT COALESCE(NEW.content->>'contract_version'='workspace-engine-private-artifact-v1'
    AND NEW.content->>'sha256'~'^sha256:[0-9a-f]{64}$'
    AND (NEW.content->>'size_bytes')::bigint>=0
    AND NEW.content->>'storage_key' LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||execution.id::text||'/%',false)
  OR pg_column_size(NEW.content)>65536 OR pg_column_size(NEW.metadata)>65536 THEN
  RAISE EXCEPTION 'Engine artifact authority is invalid.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_workspace_incremental_editorial_no_dispatch_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND input_contract='workspace-incremental-editorial-v1') AND NOT COALESCE(NEW.dispatch_kind='execution' AND NEW.worker_job_id='signal-workspace-incremental-editorial-'||NEW.execution_id::text||'-1' AND NEW.workspace_id=(SELECT workspace_id FROM signal_topic_catalog_executions WHERE id=NEW.execution_id),false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_dispatch_invalid' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION guard_workspace_incremental_editorial_no_provider_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id AND input_contract='workspace-incremental-editorial-v1') AND NOT workspace_incremental_editorial_ledger_request_v1(NEW) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_not_admitted' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION workspace_engine_interpretation_configuration_v1(p_execution uuid,p_revision text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN input_contract='workspace-incremental-editorial-v1' AND p_revision IS NULL THEN input_snapshot->'interpretation_configuration' WHEN p_revision IS NULL THEN input_snapshot->'interpretation_config'->'call_configuration'
  WHEN interpretation_revision->>'revision_digest'=p_revision THEN interpretation_revision->'configuration'->'call_configuration' END
 FROM signal_topic_catalog_executions WHERE id=p_execution AND input_contract IN('workspace-topic-engine-v1','workspace-incremental-editorial-v1');
$$;

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
  IF execution.input_contract='workspace-incremental-editorial-v1' AND NOT workspace_incremental_editorial_ledger_request_v1(NEW) THEN RAISE EXCEPTION 'workspace_incremental_editorial_request_not_admitted' USING ERRCODE='23514'; END IF;
  IF execution.input_snapshot->'interpretation_config' IS NOT NULL AND (
    execution.status<>'running' OR execution.execution_expires_at<=clock_timestamp() OR execution.result_summary->'fit_checkpoint' IS NULL
    OR NEW.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,NEW.metadata->>'interpretation_revision_digest')
    OR NEW.budget_timezone IS DISTINCT FROM execution.input_snapshot->'interpretation_config'->>'budget_timezone'
    OR NEW.budget_daily_cap_micro_usd IS DISTINCT FROM (execution.input_snapshot->'interpretation_config'->>'daily_cap_micro_usd')::bigint
    OR NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id)) THEN
   RAISE EXCEPTION 'Analysis interpretation requires its live checkpoint and sealed configuration.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.budget_timezone)
   OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE NEW.budget_timezone)::date THEN
   RAISE EXCEPTION 'Provider daily authority is invalid.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END)
     FILTER(WHERE catalog_execution_id=NEW.catalog_execution_id),0),
    COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END)
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
   OR NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id)
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
  IF OLD.call_state IN('settled','definitely_not_sent','terminal_confirmed') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Final provider cost evidence is immutable.' USING ERRCODE='55000'; END IF;
  IF NEW.call_state<>OLD.call_state AND NOT (
   (OLD.call_state='reserved' AND NEW.call_state IN('in_flight','definitely_not_sent'))
   OR (OLD.call_state='in_flight' AND NEW.call_state IN('response_persisted','outcome_unknown','definitely_not_sent'))
   OR (OLD.call_state='response_persisted' AND NEW.call_state IN('settled','outcome_unknown'))
   OR (OLD.call_state='outcome_unknown' AND (NEW.call_state IN('response_persisted','terminal_confirmed') OR NEW.call_state='settled' AND NEW.response_storage_key IS NOT NULL))) THEN
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
   AND workspace_interpretation_admission_admin_v1(execution.workspace_id,(receipt->>'authorized_by_user_id')::uuid)
   AND signal_workspace_classification_actor_v1(execution.workspace_id,execution.actor_user_id)
   AND CASE WHEN execution.input_contract='workspace-incremental-editorial-v1' THEN workspace_incremental_editorial_execution_current_v1(execution.id) ELSE signal_workspace_incremental_parent_current_v1(execution.id,execution.workspace_id,execution.actor_user_id) END,false) THEN
   RAISE EXCEPTION 'Call admission unavailable.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END),0)
   INTO grant_spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND id<>NEW.id
    AND catalog_execution_id=NEW.catalog_execution_id AND metadata->'interpretation_admission'->>'operation_id'=receipt->>'operation_id';
  IF grant_spent+NEW.reserved_micro_usd>(receipt->>'grant_cap_micro_usd')::bigint THEN
   RAISE EXCEPTION 'Interpretation grant cap exceeded.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_workspace_engine_editorial_repair_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE repair jsonb; source engine_cost_events%ROWTYPE; prior engine_cost_events%ROWTYPE;
 execution signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 repair:=NEW.metadata->'editorial_repair';
 IF TG_OP='UPDATE' THEN
  IF repair IS DISTINCT FROM OLD.metadata->'editorial_repair' THEN
   RAISE EXCEPTION 'Editorial repair identity is immutable.' USING ERRCODE='23514'; END IF;
  IF NOT (OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN RETURN NEW; END IF;
 END IF;
 IF repair IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(repair) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Editorial repair contract is invalid.' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(repair))<>6
  OR NOT COALESCE(repair->>'contract_version'='workspace-editorial-repair-v1'
   AND repair->>'diagnostic'='output_invalid'
   AND repair->>'source_call_id'~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
   AND repair->>'source_request_digest'~'^sha256:[0-9a-f]{64}$'
   AND repair->>'source_response_sha256'~'^sha256:[0-9a-f]{64}$'
   AND repair->>'protocol_digest'='sha256:7b113e97b33c00fc94a6043ac1f1f4a6c7aa99c5e792c465a384587e9b72e3d3',false) THEN
  RAISE EXCEPTION 'Editorial repair contract is invalid.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||NEW.actor_user_id::text,0));
 SELECT * INTO execution FROM signal_topic_catalog_executions
  WHERE id=NEW.catalog_execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO source FROM engine_cost_events WHERE id=(repair->>'source_call_id')::uuid FOR UPDATE;
 IF execution.status IS DISTINCT FROM 'running' OR (execution.input_contract='workspace-incremental-editorial-v1' AND NOT workspace_incremental_editorial_ledger_request_v1(NEW))
  OR (execution.input_contract<>'workspace-incremental-editorial-v1' AND (execution.result_summary->'fit_checkpoint' IS NULL OR execution.input_snapshot->'interpretation_config' IS NULL))
  OR source.id IS NULL OR source.workspace_contract IS DISTINCT FROM NEW.workspace_contract
  OR source.workspace_id IS DISTINCT FROM NEW.workspace_id OR source.catalog_execution_id IS DISTINCT FROM NEW.catalog_execution_id
  OR source.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR source.call_state IS DISTINCT FROM 'settled'
  OR source.response_storage_key IS NULL OR source.response_http_status IS DISTINCT FROM 200
  OR NOT COALESCE((source.metadata->>'response_complete')::boolean,true)
  OR source.metadata ? 'editorial_repair'
  OR source.request_digest IS DISTINCT FROM repair->>'source_request_digest'
  OR source.response_sha256 IS DISTINCT FROM repair->>'source_response_sha256'
  OR source.request_digest=NEW.request_digest OR source.call_configuration IS DISTINCT FROM NEW.call_configuration
  OR NEW.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,NEW.metadata->>'interpretation_revision_digest')
  OR EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=NEW.catalog_execution_id
    AND artifact.metadata->>'call_id'=source.id::text) THEN
   RAISE EXCEPTION 'Editorial repair requires its unmaterialized settled source receipt.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM engine_cost_events other WHERE other.catalog_execution_id=NEW.catalog_execution_id
   AND other.id<>NEW.id AND other.call_state IN('in_flight','response_persisted','outcome_unknown')) THEN
  RAISE EXCEPTION 'Unresolved provider outcome blocks editorial repair.' USING ERRCODE='23514'; END IF;
 IF NEW.retry_of_call_id IS NOT NULL THEN
  SELECT * INTO prior FROM engine_cost_events WHERE id=NEW.retry_of_call_id FOR UPDATE;
  IF prior.call_state NOT IN('definitely_not_sent','terminal_confirmed') OR prior.metadata->'editorial_repair' IS DISTINCT FROM repair THEN
   RAISE EXCEPTION 'Repair transport successor requires an unsent or externally confirmed predecessor.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION workspace_engine_terminal_checkpoint_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=target AND input_contract='workspace-incremental-editorial-v1') THEN COALESCE((SELECT workspace_incremental_editorial_request_plan_valid_v1((result_summary->>'request_plan_artifact_id')::uuid) FROM signal_topic_catalog_executions WHERE id=target),false) ELSE COALESCE((SELECT execution.result_summary ? 'fit_checkpoint' AND (EXISTS(SELECT 1 FROM analysis_artifacts manifest
 CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(manifest.metadata->'bundle')='array'
   THEN manifest.metadata->'bundle' ELSE '[]'::jsonb END entries) bundle
 WHERE manifest.engine_execution_id=execution.id AND manifest.workspace_id=execution.workspace_id
 AND manifest.artifact_type='engine_output' AND manifest.artifact_key='manifest.json'
 AND jsonb_array_length(bundle.entries) BETWEEN 5 AND 34
 AND (SELECT count(DISTINCT entry->>'name') FROM jsonb_array_elements(bundle.entries) entry)=jsonb_array_length(bundle.entries)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['manifest.json','model-manifest.json','clusters.open.json','assignments.open.jsonl','roots.jsonl']) required(name)
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle.entries) entry WHERE entry->>'name'=required.name))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle.entries) entry WHERE NOT EXISTS(
   SELECT 1 FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id
    AND artifact.workspace_id=execution.workspace_id AND artifact.artifact_key=entry->>'name'
    AND artifact.artifact_type=CASE WHEN entry->>'name'='model-manifest.json' OR entry->>'name' LIKE '%.joblib' THEN 'engine_model' ELSE 'engine_output' END
    AND artifact.content->>'contract_version'='workspace-engine-private-artifact-v1'
    AND artifact.content-'contract_version'=entry-'name'))
 AND (SELECT count(*) FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=execution.id
   AND artifact.artifact_type IN('engine_output','engine_model'))=jsonb_array_length(bundle.entries))) FROM signal_topic_catalog_executions execution WHERE execution.id=target AND execution.input_contract='workspace-topic-engine-v1'),false) END;
$$;

DO $$ DECLARE fn regprocedure; role_name text; BEGIN
 FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'workspace_incremental_editorial_%' OR proname LIKE 'guard_workspace_incremental_editorial_%') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn); FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,role_name); END IF; END LOOP; END LOOP; END $$;
COMMENT ON FUNCTION guard_workspace_incremental_editorial_artifact_v1() IS '0149: sealed incremental editorial request ownership, retained monetary evidence, no numeric financing';
