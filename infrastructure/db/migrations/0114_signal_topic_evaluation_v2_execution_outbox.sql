-- 0114: durable, disabled-by-default dispatch intent for the separately confirmed V2 flight.
-- This migration does not enable a Worker, create an authorization/run, or call a provider.

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
  'One append-only, disabled-by-default Worker dispatch intent per separately confirmed V2 execution authority.';

-- 0113 permits planned/authorized -> claimed/in_progress before transport. Once an outbox has
-- irreversibly dispatched, a local Worker failure before that claim must be able to terminalize
-- the paired rows at zero spend. It cannot do so before dispatch or after a provider attempt.
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
     OR (OLD.status='planned' AND NEW.status NOT IN('planned','in_progress','failed'))
     OR (OLD.status='planned' AND NEW.status='failed' AND
       (OLD.provider_call_count<>0 OR NEW.provider_call_count<>0 OR NEW.settled_micro_usd<>0
        OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_execution_outbox outbox
          WHERE outbox.run_id=OLD.id AND outbox.status='dispatched' AND outbox.dispatch_count=1)))
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
     OR (OLD.status='authorized' AND NEW.status NOT IN('authorized','claimed','failed'))
     OR (OLD.status='authorized' AND NEW.status='failed' AND
       (OLD.provider_call_count<>0 OR NEW.provider_call_count<>0 OR NEW.settled_micro_usd<>0
        OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_execution_outbox outbox
          WHERE outbox.execution_authorization_id=OLD.id AND outbox.status='dispatched'
            AND outbox.dispatch_count=1)))
     OR (OLD.status='claimed' AND NEW.status NOT IN('claimed','completed','failed','outcome_unknown')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 execution authorization transition is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
