-- Explicit renewable temporal admission; original model, snapshots and caps remain sealed.
ALTER TABLE signal_classification_operations DROP CONSTRAINT signal_classification_operations_operation_kind_check;
ALTER TABLE signal_classification_operations ADD CONSTRAINT signal_classification_operations_operation_kind_check CHECK(operation_kind IN(
 'create-generation','append-results','finalize-generation','supersede-assignment','register-labeling-function','register-approval-policy','register-gold-set',
 'register-model','transition-model','evaluate-classifier','evaluate-classifier-slice','project-generation','authorize-interpretation','revoke-interpretation'));
ALTER TABLE signal_topic_catalog_executions ADD COLUMN interpretation_admission_operation_id uuid REFERENCES signal_classification_operations(id) ON DELETE RESTRICT;
CREATE FUNCTION workspace_interpretation_admission_receipt_v1(target uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT operation.result FROM signal_topic_catalog_executions execution JOIN signal_classification_operations operation
 ON operation.id=execution.interpretation_admission_operation_id AND operation.workspace_id=execution.workspace_id
 WHERE execution.id=target AND operation.status='completed' AND operation.operation_kind IN('authorize-interpretation','revoke-interpretation')
$$;
CREATE FUNCTION workspace_interpretation_admission_admin_v1(workspace uuid,actor uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_workspace_classification_actor_v1(workspace,actor) AND EXISTS(SELECT 1 FROM users WHERE id=actor AND status='active'
 AND user_type='noisia_internal' AND primary_role IN('noisia_admin','admin','founder'))
$$;
CREATE FUNCTION workspace_interpretation_admission_required_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution WHERE id=target AND (
 workspace_interpretation_admission_receipt_v1(id)->>'action'='revoke_interpretation'
 OR clock_timestamp()>=(workspace_interpretation_admission_receipt_v1(id)->>'admission_not_after')::timestamptz
 OR interpretation_admission_operation_id IS NULL AND interpretation_revision IS NOT NULL AND (
  clock_timestamp()>=(interpretation_revision->>'admission_not_after')::timestamptz
  OR interpretation_revision->>'budget_date'<>(clock_timestamp() AT TIME ZONE (interpretation_revision->'configuration'->>'budget_timezone'))::date::text)
 OR error_code IN('workspace_engine_interpretation_daily_authority_expired','workspace_engine_interpretation_admission_cap_exceeded'))),false)
$$;
CREATE FUNCTION workspace_interpretation_admission_eligible_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
 CROSS JOIN LATERAL signal_workspace_engine_interpretation_coverage_v1(execution.id) coverage
 WHERE execution.id=target AND execution.input_contract='workspace-topic-engine-v1' AND NOT execution.input_snapshot ? 'numeric_descriptor'
 AND execution.status='failed' AND (execution.error_code IN('workspace_engine_interpretation_daily_authority_expired','workspace_engine_interpretation_admission_revoked','workspace_engine_interpretation_admission_changed')
  OR execution.error_code='workspace_engine_worker_failed' AND workspace_interpretation_admission_required_v1(execution.id)
  OR execution.error_code='workspace_engine_interpretation_admission_cap_exceeded'
   AND workspace_interpretation_admission_receipt_v1(execution.id)->>'action'='authorize_interpretation'
   AND NOT EXISTS(SELECT 1 FROM engine_cost_events pending WHERE pending.catalog_execution_id=execution.id AND pending.call_state='reserved'))
 AND NOT execution.result_summary ? 'analysis_checkpoint' AND workspace_engine_terminal_checkpoint_v1(execution.id)
 AND coverage.unit_count<(execution.result_summary->'fit_checkpoint'->'interpretation_manifest'->>'unit_count')::bigint AND coverage.unit_count=coverage.unique_count
 AND workspace_engine_interpretation_configuration_v1(execution.id,execution.interpretation_revision->>'revision_digest')->>'model'='claude-sonnet-4-6'
 AND signal_workspace_incremental_parent_current_v1(execution.id,execution.workspace_id,execution.actor_user_id)
 AND execution.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=execution.workspace_id)
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events call WHERE call.catalog_execution_id=execution.id
  AND (call.call_state IN('in_flight','response_persisted','outcome_unknown') OR call.call_state='reserved' AND (call.sent_at IS NOT NULL OR call.response_storage_key IS NOT NULL)))
 AND NOT EXISTS(SELECT 1 FROM engine_cost_events call WHERE call.catalog_execution_id=execution.id AND call.call_state='terminal_confirmed'
  GROUP BY request_digest HAVING count(*)>1)),false)
$$;
CREATE FUNCTION guard_workspace_interpretation_admission_operation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE body jsonb; execution signal_topic_catalog_executions%ROWTYPE; config jsonb; run_spent bigint; day_spent bigint;
BEGIN
 IF NEW.operation_kind NOT IN('authorize-interpretation','revoke-interpretation') THEN RETURN NEW; END IF;
 body:=NEW.result;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=(body->>'execution_id')::uuid FOR UPDATE;
 config:=COALESCE(execution.interpretation_revision->'configuration',execution.input_snapshot->'interpretation_config');
 IF NEW.status<>'completed' OR NEW.completed_at IS NULL OR pg_column_size(body)>8192
 OR NOT workspace_interpretation_admission_admin_v1(NEW.workspace_id,NEW.actor_user_id)
 OR execution.id IS NULL OR execution.workspace_id<>NEW.workspace_id OR execution.input_contract<>'workspace-topic-engine-v1'
 OR execution.input_snapshot ? 'numeric_descriptor'
 OR NOT COALESCE(body->>'contract_version'='workspace-interpretation-admission-v1'
  AND body->>'operation_id'=NEW.id::text AND body->>'workspace_id'=NEW.workspace_id::text
  AND body->>'authorized_by_user_id'=NEW.actor_user_id::text AND body->>'budget_actor_user_id'=execution.actor_user_id::text
  AND (body->>'prior_admission_operation_id')::uuid IS NOT DISTINCT FROM execution.interpretation_admission_operation_id
  AND body->>'input_digest'=execution.input_digest
  AND body->>'fit_checkpoint_digest'=execution.result_summary->'fit_checkpoint'->>'checkpoint_digest'
  AND body->>'interpretation_revision_digest' IS NOT DISTINCT FROM execution.interpretation_revision->>'revision_digest'
  AND body->>'configuration_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(config->'call_configuration'),'UTF8')),'hex')
  AND (body->>'run_cap_micro_usd')::bigint=(execution.input_snapshot->>'claude_cap_micro_usd')::bigint
  AND (body->>'daily_cap_micro_usd')::bigint=(config->>'daily_cap_micro_usd')::bigint
  AND body->>'budget_timezone'=config->>'budget_timezone'
  AND body->>'authorized_at'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND abs(extract(epoch FROM ((body->>'authorized_at')::timestamptz-clock_timestamp())))<60
  AND body->>'grant_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(body-'grant_digest'),'UTF8')),'hex'),false) THEN
 RAISE EXCEPTION 'Interpretation admission receipt invalid.' USING ERRCODE='23514'; END IF;
 IF NEW.operation_kind='revoke-interpretation' THEN
  IF body->>'action'<>'revoke_interpretation' OR (body->>'grant_cap_micro_usd')::bigint<>0
   OR workspace_interpretation_admission_receipt_v1(execution.id)->>'action' IS DISTINCT FROM 'authorize_interpretation'
   OR body-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd'
      IS DISTINCT FROM workspace_interpretation_admission_receipt_v1(execution.id)-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd' THEN
   RAISE EXCEPTION 'Interpretation revocation invalid.' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT workspace_interpretation_admission_eligible_v1(execution.id)
   OR NOT COALESCE(body->>'action'='authorize_interpretation' AND (body->>'grant_cap_micro_usd')::bigint>0
    AND body->>'budget_date'=(clock_timestamp() AT TIME ZONE (config->>'budget_timezone'))::date::text
    AND body->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    AND (body->>'admission_not_after')::timestamptz>clock_timestamp()
    AND (body->>'admission_not_after')::timestamptz<=(((body->>'budget_date')::date+1)::timestamp AT TIME ZONE (config->>'budget_timezone')),false) THEN
   RAISE EXCEPTION 'Interpretation authorization unavailable.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END) FILTER(WHERE catalog_execution_id=execution.id),0),
   COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END) FILTER(WHERE budget_date=(body->>'budget_date')::date),0)
  INTO run_spent,day_spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=execution.actor_user_id;
  IF (body->>'grant_cap_micro_usd')::bigint>LEAST((body->>'run_cap_micro_usd')::bigint-run_spent,(body->>'daily_cap_micro_usd')::bigint-day_spent) THEN
   RAISE EXCEPTION 'Interpretation admission cap exceeded.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_interpretation_admission_operation BEFORE INSERT ON signal_classification_operations
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_interpretation_admission_operation_v1();
CREATE FUNCTION guard_workspace_interpretation_admission_pointer_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE receipt jsonb;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.interpretation_admission_operation_id IS NOT NULL THEN RAISE EXCEPTION 'Admission needs an existing execution.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.interpretation_admission_operation_id IS DISTINCT FROM OLD.interpretation_admission_operation_id THEN
  SELECT result INTO receipt FROM signal_classification_operations WHERE id=NEW.interpretation_admission_operation_id
   AND workspace_id=NEW.workspace_id AND status='completed' AND operation_kind IN('authorize-interpretation','revoke-interpretation');
  IF NOT COALESCE(receipt->>'execution_id'=OLD.id::text AND (receipt->>'prior_admission_operation_id')::uuid IS NOT DISTINCT FROM OLD.interpretation_admission_operation_id,false) THEN
   RAISE EXCEPTION 'Interpretation admission CAS invalid.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_interpretation_admission_pointer BEFORE INSERT OR UPDATE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_interpretation_admission_pointer_v1();
CREATE FUNCTION guard_workspace_interpretation_call_admission_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
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
   AND signal_workspace_incremental_parent_current_v1(execution.id,execution.workspace_id,execution.actor_user_id),false) THEN
   RAISE EXCEPTION 'Call admission unavailable.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END),0)
   INTO grant_spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND id<>NEW.id
    AND catalog_execution_id=NEW.catalog_execution_id AND metadata->'interpretation_admission'->>'operation_id'=receipt->>'operation_id';
  IF grant_spent+NEW.reserved_micro_usd>(receipt->>'grant_cap_micro_usd')::bigint THEN
   RAISE EXCEPTION 'Interpretation grant cap exceeded.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_interpretation_call_admission BEFORE INSERT OR UPDATE ON engine_cost_events
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_interpretation_call_admission_v1();

CREATE OR REPLACE FUNCTION guard_workspace_engine_call_revision_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE; revision text;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'workspace-engine-interpretation-v1' THEN RETURN NEW; END IF;
 revision:=NEW.metadata->>'interpretation_revision_digest';
 IF TG_OP='UPDATE' AND NEW.metadata->'interpretation_revision_digest' IS DISTINCT FROM OLD.metadata->'interpretation_revision_digest' THEN
  RAISE EXCEPTION 'Call editorial revision is immutable.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.call_state='reserved' AND NEW.call_state='in_flight') THEN
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id FOR UPDATE;
  IF revision IS DISTINCT FROM execution.interpretation_revision->>'revision_digest' THEN
   RAISE EXCEPTION 'Call editorial revision is not current.' USING ERRCODE='23514'; END IF;
  IF revision IS NOT NULL AND (NEW.call_configuration IS DISTINCT FROM workspace_engine_interpretation_configuration_v1(execution.id,revision)
   OR (execution.interpretation_admission_operation_id IS NULL AND (NEW.budget_date::text IS DISTINCT FROM execution.interpretation_revision->>'budget_date'
    OR clock_timestamp()>=(execution.interpretation_revision->>'admission_not_after')::timestamptz))) THEN
   RAISE EXCEPTION 'Editorial revision grant is unavailable.' USING ERRCODE='23514'; END IF;
  IF NEW.retry_of_call_id IS NOT NULL AND EXISTS(SELECT 1 FROM engine_cost_events prior WHERE prior.id=NEW.retry_of_call_id
    AND prior.metadata->>'interpretation_revision_digest' IS DISTINCT FROM revision) THEN
   RAISE EXCEPTION 'Transport cannot change editorial revision.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION workspace_interpretation_admission_receipt_v1(uuid),workspace_interpretation_admission_admin_v1(uuid,uuid),workspace_interpretation_admission_eligible_v1(uuid),workspace_interpretation_admission_required_v1(uuid),guard_workspace_interpretation_admission_operation_v1(),guard_workspace_interpretation_admission_pointer_v1(),guard_workspace_interpretation_call_admission_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION workspace_interpretation_admission_receipt_v1(uuid),workspace_interpretation_admission_admin_v1(uuid,uuid),workspace_interpretation_admission_eligible_v1(uuid),workspace_interpretation_admission_required_v1(uuid),guard_workspace_interpretation_admission_operation_v1(),guard_workspace_interpretation_admission_pointer_v1(),guard_workspace_interpretation_call_admission_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
