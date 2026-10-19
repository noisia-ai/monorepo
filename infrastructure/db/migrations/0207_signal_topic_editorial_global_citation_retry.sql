-- A model may return an invalid group-specific citation in an otherwise paid
-- shard Batch. Reopen only that exact terminal state so the same sealed request
-- can be retried without repeating accepted siblings or rewriting paid receipts.
-- A continuation is an explicit, immutable authorization for the global phase
-- of one existing execution. It removes the arbitrary short send window, not
-- the active policy, execution cap, daily cap, actor, model or receipts.
CREATE TABLE signal_topic_editorial_global_continuations_v2 (
 execution_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 actor_user_id uuid NOT NULL,
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_editorial_executions(workspace_id,id)
);
CREATE FUNCTION signal_topic_editorial_global_continuation_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 o signal_topic_editorial_batch_owners_v2%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 action_row signal_processing_policy_actions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'topic_editorial_global_continuation_immutable' USING ERRCODE='23514';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id FOR UPDATE;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=e.workspace_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF e.id IS NULL OR e.plan->>'contract_version'<>'signal-topic-editorial-admission-header-v3'
  OR e.status NOT IN('queued','running') OR o.stage<>'review_pending'
  OR (NEW.workspace_id,NEW.organization_id,NEW.actor_user_id)
   IS DISTINCT FROM (e.workspace_id,e.organization_id,e.actor_user_id)
  OR a.id IS DISTINCT FROM e.processing_admission_id OR a.action<>'topic_consolidation'
  OR a.execution_cap_micro_usd IS DISTINCT FROM e.hard_cap_micro_usd
  OR p.id IS NULL OR p.organization_id<>e.organization_id OR p.status<>'active'
  OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until
  OR p.budget_timezone IS DISTINCT FROM a.budget_timezone
  OR action_row.action IS NULL OR action_row.automatic_allowed
  OR action_row.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR action_row.provider<>'anthropic' OR action_row.model<>'claude-sonnet-4-6'
  OR action_row.max_execution_micro_usd<e.hard_cap_micro_usd
  OR NEW.created_at>clock_timestamp()+interval '1 minute' THEN
  RAISE EXCEPTION 'topic_editorial_global_continuation_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_topic_editorial_global_continuation_guard_v2 BEFORE INSERT OR UPDATE OR DELETE
 ON signal_topic_editorial_global_continuations_v2 FOR EACH ROW EXECUTE FUNCTION signal_topic_editorial_global_continuation_guard_v2();
ALTER TABLE signal_topic_editorial_global_continuations_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE signal_topic_editorial_global_continuations_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_global_continuation_guard_v2() FROM PUBLIC;

CREATE OR REPLACE FUNCTION signal_topic_editorial_global_stage_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;
 run signal_topic_consolidation_runs%ROWTYPE;
 snapshot_count integer;snapshot_value text;
 owner_row signal_topic_editorial_batch_owners_v2%ROWTYPE;
 retryable_count integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'state'-'completed_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'completed_at') THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
  IF OLD.state='blocked' AND NEW.state='open' AND NEW.completed_at IS NULL THEN
   IF EXISTS(SELECT 1 FROM signal_topic_editorial_global_stages_v2 successor
       WHERE successor.execution_id=OLD.execution_id AND successor.stage_id<>OLD.stage_id
         AND successor.state IN('open','complete','materialized'))
    OR EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batches_v2 b
       WHERE b.stage_id=OLD.stage_id AND b.state<>'imported')
    OR EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 c
       WHERE c.stage_id=OLD.stage_id AND c.status NOT IN('settled','definitely_not_sent')) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
   WITH latest AS (SELECT DISTINCT ON(i.request_id) i.request_id,i.outcome,i.validation,b.state,c.status,
       (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts WHERE attempts.request_id=i.request_id) attempts
      FROM signal_topic_editorial_global_stage_batch_items_v2 i
      JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
      JOIN signal_topic_editorial_global_stage_calls_v2 c ON c.id=i.call_id
      WHERE i.stage_id=OLD.stage_id ORDER BY i.request_id,b.created_at DESC)
    SELECT count(*) FILTER(WHERE l.outcome='succeeded' AND l.validation->>'status'='invalid_output'
      AND l.validation->>'code'='topic_editorial_global_shard_citation_invalid' AND l.state='imported'
      AND l.status='settled' AND l.attempts<5) INTO retryable_count
    FROM latest l;
   IF retryable_count<1 OR EXISTS(
     SELECT 1 FROM signal_topic_editorial_global_stage_requests_v2 r
     WHERE r.stage_id=OLD.stage_id AND NOT EXISTS(
       SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
       JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
       JOIN signal_topic_editorial_global_stage_calls_v2 c ON c.id=i.call_id
       WHERE i.request_id=r.id AND b.state='imported' AND c.status='settled'
         AND (i.validation->>'status'=CASE r.stage_kind WHEN 'shard' THEN 'accepted_shard'
             WHEN 'merge' THEN 'accepted_merge' ELSE 'accepted_rank' END
           OR (i.validation->>'status'='invalid_output'
             AND i.validation->>'code'='topic_editorial_global_shard_citation_invalid'
             AND (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts
               WHERE attempts.request_id=r.id)<5))
         AND b.created_at=(SELECT max(newest.created_at) FROM signal_topic_editorial_global_stage_batches_v2 newest
           JOIN signal_topic_editorial_global_stage_batch_items_v2 newest_item ON newest_item.batch_id=newest.id
           WHERE newest_item.request_id=r.id))) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  IF OLD.state NOT IN('open','complete') OR NEW.state NOT IN('blocked','complete','materialized')
   OR (NEW.state='blocked' AND OLD.state<>'open') OR (NEW.state='complete' AND OLD.state<>'open')
   OR (NEW.state='materialized' AND OLD.state NOT IN('open','complete'))
   OR (NEW.state='open')<>(NEW.completed_at IS NULL) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_transition_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_stage_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO run FROM signal_topic_consolidation_runs WHERE id=e.numeric_run_id AND workspace_id=e.workspace_id;
 SELECT * INTO owner_row FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=e.workspace_id;
 SELECT count(DISTINCT request.receipts->'request'->'identity'->>'snapshot_digest'),
   min(request.receipts->'request'->'identity'->>'snapshot_digest')
   INTO snapshot_count,snapshot_value FROM signal_topic_editorial_requests request WHERE request.execution_id=e.id;
 IF e.id IS NULL OR run.id IS NULL OR owner_row.stage<>'review_pending'
  OR NEW.processing_admission_id IS DISTINCT FROM e.processing_admission_id
  OR NEW.organization_id IS DISTINCT FROM e.organization_id OR NEW.expected_group_count IS DISTINCT FROM run.expected_group_count
  OR snapshot_count<>1 OR snapshot_value IS DISTINCT FROM NEW.snapshot_digest
  OR (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id=e.id)<>NEW.expected_group_count THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_source_mismatch' USING ERRCODE='23514';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 RETURN NEW;
END $$;
-- Existing charge and exposure accounting remains unchanged. Retry identity is
-- allowed for the exact paid citation failure as well as the zero-cost grammar
-- error; every retry gets a new immutable call and passes the same cap checks.
CREATE OR REPLACE FUNCTION signal_topic_editorial_global_stage_call_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;g signal_topic_editorial_global_stages_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
 owner_row signal_topic_editorial_batch_owners_v2%ROWTYPE;grant_row signal_topic_editorial_global_continuations_v2%ROWTYPE;
 spent bigint;daily_spent bigint;expected bigint;prior signal_topic_editorial_global_stage_calls_v2%ROWTYPE;
 envelope jsonb;cost bigint;request_body text;max_tokens integer;new_send boolean;effective_day date;effective_deadline timestamptz;
BEGIN
 SELECT * INTO g FROM signal_topic_editorial_global_stages_v2 WHERE stage_id=NEW.stage_id;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=g.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO grant_row FROM signal_topic_editorial_global_continuations_v2 WHERE execution_id=e.id;
 IF TG_OP='INSERT' THEN new_send:=true;ELSE new_send:=OLD.status='reserved' AND NEW.status='in_flight';END IF;
 effective_day:=CASE WHEN grant_row.execution_id IS NULL THEN a.budget_date ELSE (clock_timestamp() AT TIME ZONE a.budget_timezone)::date END;
 PERFORM signal_processing_lock_v1(e.organization_id,CASE WHEN new_send THEN effective_day ELSE NEW.budget_date END);
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=a.policy_version_id AND action='topic_consolidation';
 SELECT * INTO owner_row FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=e.workspace_id;
 effective_deadline:=CASE WHEN grant_row.execution_id IS NULL THEN least(a.admission_not_after,owner_row.send_not_after,p.valid_until)
   ELSE p.valid_until END;
 IF g.stage_id IS NULL OR g.processing_admission_id IS DISTINCT FROM e.processing_admission_id
  OR (NEW.workspace_id,NEW.organization_id,NEW.execution_id,NEW.stage_id)
   IS DISTINCT FROM (e.workspace_id,e.organization_id,e.id,g.stage_id)
  OR a.id IS DISTINCT FROM e.processing_admission_id OR a.action IS DISTINCT FROM 'topic_consolidation'
  OR a.workspace_id IS DISTINCT FROM e.workspace_id OR a.organization_id IS DISTINCT FROM e.organization_id
  OR a.actor_user_id IS DISTINCT FROM e.actor_user_id OR a.execution_cap_micro_usd IS DISTINCT FROM e.hard_cap_micro_usd
  OR owner_row.execution_id IS NULL OR owner_row.policy_version_id IS DISTINCT FROM a.policy_version_id
  OR (new_send AND NEW.budget_date<>effective_day) OR NEW.budget_timezone<>a.budget_timezone
  OR (grant_row.execution_id IS NOT NULL AND (grant_row.workspace_id,grant_row.organization_id,grant_row.actor_user_id,grant_row.policy_version_id)
    IS DISTINCT FROM (e.workspace_id,e.organization_id,e.actor_user_id,p.id))
  OR action_row.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR action_row.provider IS DISTINCT FROM 'anthropic' OR action_row.model IS DISTINCT FROM 'claude-sonnet-4-6' THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_authority_unavailable' USING ERRCODE='23514';
 END IF;
 IF new_send AND (p.id IS NULL OR p.organization_id<>e.organization_id OR p.status<>'active'
   OR clock_timestamp()<p.valid_from OR clock_timestamp()>=effective_deadline) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_authority_unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL
    OR NEW.settled_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_global_stage_call_invalid' USING ERRCODE='23514'; END IF;
  SELECT r.request_body,r.max_tokens INTO STRICT request_body,max_tokens FROM signal_topic_editorial_global_stage_requests_v2 r WHERE r.id=NEW.request_id AND r.stage_id=NEW.stage_id;
  IF NEW.retry_of_call_id IS NOT NULL THEN
   SELECT * INTO prior FROM signal_topic_editorial_global_stage_calls_v2 WHERE id=NEW.retry_of_call_id AND request_id=NEW.request_id AND stage_id=NEW.stage_id;
   IF prior.id IS NULL OR prior.status<>'settled'
    OR (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts WHERE attempts.request_id=NEW.request_id)>=5
    OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
      WHERE i.call_id=prior.id AND b.state='imported' AND (
       (prior.settled_micro_usd=0 AND prior.observed_micro_usd=0 AND i.outcome='errored'
        AND i.validation->>'status'='provider_error'
        AND prior.response_body_private::jsonb->'result'->'error'->'error'->>'message' LIKE 'Grammar compilation rate limit exceeded%')
       OR (i.outcome='succeeded' AND i.validation->>'status'='invalid_output'
        AND i.validation->>'code'='topic_editorial_global_shard_citation_invalid'))) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_retry_not_allowed' USING ERRCODE='23514';END IF;
  ELSIF EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 prior_call WHERE prior_call.request_id=NEW.request_id) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_retry_identity_required' USING ERRCODE='23514';
  END IF;
  expected:=(octet_length(request_body)::bigint*3+max_tokens::bigint*15+1)/2;
  IF NEW.reserved_micro_usd<>expected THEN RAISE EXCEPTION 'topic_editorial_global_stage_reservation_invalid' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO spent FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  spent:=spent+COALESCE((SELECT sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END)
   FROM signal_topic_editorial_global_stage_calls_v2 WHERE execution_id=e.id AND status<>'definitely_not_sent'),0);
  SELECT total_micro_usd INTO daily_spent FROM signal_processing_org_exposure_v1(e.organization_id,effective_day,a.budget_timezone);
  IF spent+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR daily_spent+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_cap_exhausted' USING ERRCODE='23514'; END IF;
  NEW.reserved_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','observed_micro_usd','settled_micro_usd','response_body_private','response_sha256','response_storage_key','response_http_status','response_complete','response_provider_request_id','error_code','sent_at','response_at','settled_at','provider_batch_id'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','observed_micro_usd','settled_micro_usd','response_body_private','response_sha256','response_storage_key','response_http_status','response_complete','response_provider_request_id','error_code','sent_at','response_at','settled_at','provider_batch_id'])
  OR OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256) IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256)
  OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_call_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status='definitely_not_sent' AND OLD.provider_batch_id IS NULL
   OR OLD.status='in_flight' AND NEW.status IN('submission_unknown','response_persisted','outcome_unknown')
   OR OLD.status='submission_unknown' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_call_transition_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status='in_flight' AND OLD.status='reserved' THEN NEW.sent_at:=clock_timestamp(); END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_receipt_invalid' USING ERRCODE='23514'; END IF;
  envelope:=NEW.response_body_private::jsonb;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
    JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
    WHERE i.call_id=NEW.id AND i.custom_id=envelope->>'custom_id' AND b.provider_batch_id=NEW.response_provider_request_id
      AND b.stage_id=NEW.stage_id AND b.state IN('ended','imported')) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_receipt_binding_invalid' USING ERRCODE='23514'; END IF;
  BEGIN cost:=signal_topic_editorial_batch_cost_v2(envelope);
  EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN cost:=NULL; END;
  IF cost IS NULL THEN
   IF NEW.status='settled' OR NEW.observed_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_usage_unresolved' USING ERRCODE='23514'; END IF;
  ELSIF cost>NEW.reserved_micro_usd OR NEW.observed_micro_usd IS DISTINCT FROM cost
    OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM cost THEN
   RAISE EXCEPTION 'topic_editorial_settlement_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='settled' THEN NEW.settled_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
