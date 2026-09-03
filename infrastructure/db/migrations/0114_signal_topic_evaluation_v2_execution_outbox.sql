-- 0114: durable, disabled-by-default dispatch intent for the separately confirmed V2 flight.
-- This migration does not enable a Worker, create an authorization/run, or call a provider.

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_execution_authorizations)
     OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_runs
       WHERE execution_authorization_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Migration 0114 requires an empty V2 execution cut.';
  END IF;
END;
$$;

CREATE TABLE signal_topic_evaluation_v2_execution_outbox (
  run_id uuid PRIMARY KEY REFERENCES signal_topic_evaluation_v2_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  execution_authorization_id uuid NOT NULL
    REFERENCES signal_topic_evaluation_v2_execution_authorizations(id) ON DELETE RESTRICT,
  outbox_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  dispatch_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz,
  CONSTRAINT uq_signal_topic_evaluation_v2_execution_outbox_authorization
    UNIQUE(execution_authorization_id),
  CONSTRAINT signal_topic_evaluation_v2_execution_outbox_shape CHECK(
    outbox_key~'^[a-z0-9][a-z0-9._:-]{7,199}$'
    AND status IN('pending','dispatched')
    AND dispatch_count BETWEEN 0 AND 1
    AND ((status='pending' AND dispatch_count=0 AND dispatched_at IS NULL)
      OR (status='dispatched' AND dispatch_count=1 AND dispatched_at IS NOT NULL))
  )
);
CREATE INDEX idx_signal_topic_evaluation_v2_execution_outbox_pending
  ON signal_topic_evaluation_v2_execution_outbox(created_at,run_id) WHERE status='pending';

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_execution_outbox_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paired record;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Topic Evaluation V2 execution outbox is append-only.';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT run.workspace_id run_workspace_id,run.execution_authorization_id run_authorization_id,
      run.status run_status,run.provider_execution_enabled,authority.status authority_status
    INTO paired
    FROM signal_topic_evaluation_v2_runs run
    JOIN signal_topic_evaluation_v2_execution_authorizations authority
      ON authority.id=run.execution_authorization_id
    WHERE run.id=NEW.run_id;
    IF paired IS NULL OR paired.run_workspace_id<>NEW.workspace_id
       OR paired.run_authorization_id<>NEW.execution_authorization_id
       OR paired.run_status<>'planned' OR NOT paired.provider_execution_enabled
       OR paired.authority_status<>'authorized'
       OR NEW.status<>'pending' OR NEW.dispatch_count<>0 OR NEW.dispatched_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 execution outbox insert is invalid.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.run_id<>NEW.run_id OR OLD.workspace_id<>NEW.workspace_id
     OR OLD.execution_authorization_id<>NEW.execution_authorization_id
     OR OLD.outbox_key<>NEW.outbox_key OR OLD.created_at<>NEW.created_at
     OR OLD.status<>'pending' OR NEW.status<>'dispatched'
     OR OLD.dispatch_count<>0 OR NEW.dispatch_count<>1
     OR NEW.dispatched_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 execution outbox transition is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_execution_outbox
BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_evaluation_v2_execution_outbox FOR EACH ROW
EXECUTE FUNCTION protect_signal_topic_evaluation_v2_execution_outbox_v1();

COMMENT ON TABLE signal_topic_evaluation_v2_execution_outbox IS
  'Exactly one append-only, disabled-by-default Worker dispatch intent per separately confirmed V2 execution authority/run.';

-- Dispatch and claim are one serializable transaction. A planned/authorized pair cannot
-- terminalize or leave a dispatched outbox behind: rollback preserves the pending cohort.
CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Topic Evaluation V2 run is append-only.';
  END IF;
  IF OLD.status IN('completed','failed','outcome_unknown') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Topic Evaluation V2 terminal run is append-only.';
  END IF;
  IF OLD.workspace_id<>NEW.workspace_id OR OLD.snapshot_id<>NEW.snapshot_id
     OR OLD.execution_authorization_id IS DISTINCT FROM NEW.execution_authorization_id
     OR OLD.requested_by_user_id<>NEW.requested_by_user_id OR OLD.idempotency_key<>NEW.idempotency_key
     OR OLD.run_key<>NEW.run_key OR OLD.confirmation<>NEW.confirmation
     OR OLD.flight_card<>NEW.flight_card OR OLD.flight_card_digest<>NEW.flight_card_digest
     OR OLD.provider_execution_enabled<>NEW.provider_execution_enabled
     OR OLD.reserved_micro_usd<>NEW.reserved_micro_usd
     OR NEW.provider_call_count<OLD.provider_call_count
     OR NEW.model_turn_count<OLD.model_turn_count OR NEW.tool_call_count<OLD.tool_call_count
     OR NEW.total_input_tokens<OLD.total_input_tokens OR NEW.total_output_tokens<OLD.total_output_tokens
     OR NEW.total_tool_result_bytes<OLD.total_tool_result_bytes
     OR (OLD.settled_micro_usd IS NOT NULL AND NEW.settled_micro_usd IS DISTINCT FROM OLD.settled_micro_usd)
     OR (OLD.output_digest IS NOT NULL AND NEW.output_digest IS DISTINCT FROM OLD.output_digest)
     OR (NEW.status IN('planned','in_progress') AND
       (NEW.settled_micro_usd IS NOT NULL OR NEW.error_code IS NOT NULL
        OR NEW.completed_at IS NOT NULL OR NEW.output_digest IS NOT NULL))
     OR (NEW.status='completed' AND
       (NEW.settled_micro_usd IS NULL OR NEW.error_code IS NOT NULL
        OR NEW.completed_at IS NULL OR NEW.output_digest IS NULL))
     OR (NEW.status='failed' AND
       (NEW.settled_micro_usd IS NULL OR NEW.error_code IS NULL OR NEW.completed_at IS NULL))
     OR (NEW.status='outcome_unknown' AND
       (NEW.settled_micro_usd IS NOT NULL OR NEW.error_code IS NULL OR NEW.completed_at IS NULL))
     OR (OLD.status='planned' AND NEW.status NOT IN('planned','in_progress'))
     OR (OLD.status='in_progress' AND NEW.status NOT IN('in_progress','completed','failed','outcome_unknown')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic Evaluation V2 run transition is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_execution_authorization_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Topic Evaluation V2 execution authorization is append-only.';
  END IF;
  IF OLD.status IN('completed','failed','outcome_unknown')
     OR OLD.workspace_id<>NEW.workspace_id OR OLD.snapshot_id<>NEW.snapshot_id
     OR OLD.requested_by_user_id<>NEW.requested_by_user_id
     OR OLD.idempotency_key<>NEW.idempotency_key OR OLD.authorization_key<>NEW.authorization_key
     OR OLD.confirmation<>NEW.confirmation OR OLD.runtime_profile<>NEW.runtime_profile
     OR OLD.provider<>NEW.provider OR OLD.model<>NEW.model OR OLD.pricing_version<>NEW.pricing_version
     OR OLD.input_micro_usd_per_token<>NEW.input_micro_usd_per_token
     OR OLD.output_micro_usd_per_token<>NEW.output_micro_usd_per_token
     OR OLD.flight_card<>NEW.flight_card OR OLD.flight_card_digest<>NEW.flight_card_digest
     OR OLD.reserved_micro_usd<>NEW.reserved_micro_usd
     OR NEW.provider_call_count<OLD.provider_call_count
     OR (NEW.status IN('authorized','claimed') AND
       (NEW.settled_micro_usd IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.completed_at IS NOT NULL))
     OR (NEW.status='completed' AND
       (NEW.settled_micro_usd IS NULL OR NEW.error_code IS NOT NULL OR NEW.completed_at IS NULL))
     OR (NEW.status='failed' AND
       (NEW.settled_micro_usd IS NULL OR NEW.error_code IS NULL OR NEW.completed_at IS NULL))
     OR (NEW.status='outcome_unknown' AND
       (NEW.settled_micro_usd IS NOT NULL OR NEW.error_code IS NULL OR NEW.completed_at IS NULL))
     OR (OLD.status='authorized' AND NEW.status NOT IN('authorized','claimed'))
     OR (OLD.status='claimed' AND NEW.status NOT IN('claimed','completed','failed','outcome_unknown')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 execution authorization transition is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

-- 0113's deferred pair check is replaced, not weakened. The outbox is a third member of the
-- transaction-end cohort: exactly one row must exist and all three lifecycle states must agree.
CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_execution_pair_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authorization_id uuid;
DECLARE paired record;
BEGIN
  IF TG_TABLE_NAME='signal_topic_evaluation_v2_execution_authorizations' THEN
    authorization_id:=NEW.id;
  ELSE
    authorization_id:=NEW.execution_authorization_id;
  END IF;
  IF authorization_id IS NULL THEN RETURN NULL; END IF;

  SELECT authority.id authority_id,authority.workspace_id authority_workspace_id,
    authority.status authority_status,authority.provider_call_count authority_calls,
    authority.settled_micro_usd authority_settled,authority.error_code authority_error,
    authority.completed_at authority_completed,
    run.id run_id,run.workspace_id run_workspace_id,run.execution_authorization_id run_authority_id,
    run.status run_status,run.provider_call_count run_calls,run.settled_micro_usd run_settled,
    run.error_code run_error,run.completed_at run_completed,
    outbox.run_id outbox_run_id,outbox.workspace_id outbox_workspace_id,
    outbox.execution_authorization_id outbox_authority_id,outbox.status outbox_status,
    outbox.dispatch_count outbox_dispatch_count,outbox.dispatched_at outbox_dispatched_at
  INTO paired
  FROM signal_topic_evaluation_v2_execution_authorizations authority
  JOIN signal_topic_evaluation_v2_runs run ON run.execution_authorization_id=authority.id
  JOIN signal_topic_evaluation_v2_execution_outbox outbox
    ON outbox.execution_authorization_id=authority.id AND outbox.run_id=run.id
  WHERE authority.id=authorization_id;

  IF paired IS NULL
     OR paired.authority_workspace_id<>paired.run_workspace_id
     OR paired.authority_workspace_id<>paired.outbox_workspace_id
     OR paired.run_authority_id<>paired.authority_id
     OR paired.outbox_authority_id<>paired.authority_id
     OR paired.outbox_run_id<>paired.run_id
     OR paired.authority_calls<>paired.run_calls
     OR paired.authority_settled IS DISTINCT FROM paired.run_settled
     OR paired.authority_error IS DISTINCT FROM paired.run_error
     OR (paired.authority_completed IS NULL)<>(paired.run_completed IS NULL)
     OR NOT (
       (paired.authority_status='authorized' AND paired.run_status='planned'
         AND paired.outbox_status='pending' AND paired.outbox_dispatch_count=0
         AND paired.outbox_dispatched_at IS NULL)
       OR (paired.authority_status='claimed' AND paired.run_status='in_progress'
         AND paired.outbox_status='dispatched' AND paired.outbox_dispatch_count=1
         AND paired.outbox_dispatched_at IS NOT NULL)
       OR (paired.authority_status IN('completed','failed','outcome_unknown')
         AND paired.authority_status=paired.run_status
         AND paired.outbox_status='dispatched' AND paired.outbox_dispatch_count=1
         AND paired.outbox_dispatched_at IS NOT NULL)
     ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 execution authority/run/outbox cohort is invalid.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_validate_signal_topic_evaluation_v2_execution_outbox_pair
AFTER INSERT OR UPDATE ON signal_topic_evaluation_v2_execution_outbox
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_execution_pair_v1();
