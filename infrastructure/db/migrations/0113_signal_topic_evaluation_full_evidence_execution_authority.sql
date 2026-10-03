-- 0113: additive, disabled-by-default authority for one future Full Evidence provider flight.
-- It does not enable a provider, create a run, enqueue work, or change Topic adoption/publication/serving.

CREATE TABLE signal_topic_evaluation_v2_execution_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_snapshots(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  authorization_key text NOT NULL,
  confirmation text NOT NULL,
  runtime_profile text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  pricing_version text NOT NULL,
  input_micro_usd_per_token bigint NOT NULL,
  output_micro_usd_per_token bigint NOT NULL,
  flight_card jsonb NOT NULL,
  flight_card_digest text NOT NULL,
  reserved_micro_usd bigint NOT NULL,
  settled_micro_usd bigint,
  provider_call_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'authorized',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT uq_signal_topic_evaluation_v2_execution_authorization_idempotency
    UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_execution_authorization_key
    UNIQUE(workspace_id,authorization_key),
  CONSTRAINT signal_topic_evaluation_v2_execution_authorization_shape CHECK(
    idempotency_key~'^[a-zA-Z0-9._:-]{8,200}$'
    AND authorization_key~'^[a-z0-9][a-z0-9._:-]{7,199}$'
    AND confirmation='AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION'
    AND runtime_profile='uat'
    AND provider='anthropic'
    AND model~'^[a-z0-9][a-z0-9._.-]{2,159}$'
    AND pricing_version~'^[a-z0-9][a-z0-9._:-]{2,159}$'
    AND input_micro_usd_per_token BETWEEN 0 AND 1000000
    AND output_micro_usd_per_token BETWEEN 0 AND 1000000
    AND jsonb_typeof(flight_card)='object'
    AND flight_card_digest~'^sha256:[0-9a-f]{64}$'
    AND flight_card_digest=signal_semantic_context_digest_json_v2(flight_card)
    AND flight_card @> '{"contract_version":"signal-topic-evaluation-full-evidence-v2","execution_enabled":true,"no_retry":true,"action_time_confirmation_required":true,"preserve_complete_candidate_pool":true,"top_view_limit":10}'::jsonb
    AND COALESCE((flight_card->>'provider_calls_allowed')::int,0) BETWEEN 1 AND 12
    AND COALESCE((flight_card->>'max_model_turns')::int,0) BETWEEN 1 AND 12
    AND COALESCE((flight_card->>'max_tool_calls')::int,0) BETWEEN 1 AND 24
    AND COALESCE((flight_card->>'max_tool_result_bytes')::int,0) BETWEEN 1 AND 32768
    AND COALESCE((flight_card->>'max_total_tool_result_bytes')::int,0) BETWEEN 1 AND 262144
    AND COALESCE((flight_card->>'max_total_input_tokens')::int,0) BETWEEN 1 AND 450000
    AND COALESCE((flight_card->>'max_total_output_tokens')::int,0) BETWEEN 1 AND 50000
    AND COALESCE((flight_card->>'hard_cap_micro_usd')::bigint,0) BETWEEN 1 AND 20000000
    AND reserved_micro_usd BETWEEN 1 AND 20000000
    AND reserved_micro_usd<=COALESCE((flight_card->>'hard_cap_micro_usd')::bigint,0)
    AND (settled_micro_usd IS NULL OR settled_micro_usd BETWEEN 0 AND reserved_micro_usd)
    AND provider_call_count BETWEEN 0 AND COALESCE((flight_card->>'provider_calls_allowed')::int,0)
    AND status IN('authorized','claimed','completed','failed','outcome_unknown')
    AND (error_code IS NULL OR error_code~'^[a-z0-9_]{1,120}$')
  )
);
-- Application locks make conflicts friendly; this index is the database backstop against two
-- concurrent paid flights for the same frozen snapshot.
CREATE UNIQUE INDEX uq_signal_topic_evaluation_v2_execution_authorization_active_snapshot
  ON signal_topic_evaluation_v2_execution_authorizations(workspace_id,snapshot_id)
  WHERE status IN('authorized','claimed');

ALTER TABLE signal_topic_evaluation_v2_runs
  ADD COLUMN execution_authorization_id uuid
  REFERENCES signal_topic_evaluation_v2_execution_authorizations(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_signal_topic_evaluation_v2_run_execution_authorization
  ON signal_topic_evaluation_v2_runs(execution_authorization_id)
  WHERE execution_authorization_id IS NOT NULL;

ALTER TABLE signal_topic_evaluation_v2_runs
  DROP CONSTRAINT signal_topic_evaluation_v2_run_bounds;
ALTER TABLE signal_topic_evaluation_v2_runs
  ADD CONSTRAINT signal_topic_evaluation_v2_run_bounds CHECK(
    idempotency_key~'^[a-zA-Z0-9._:-]{8,200}$' AND run_key~'^[a-z0-9][a-z0-9._:-]{7,199}$'
    AND confirmation IN('RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION',
      'AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION')
    AND jsonb_typeof(flight_card)='object' AND flight_card_digest~'^sha256:[0-9a-f]{64}$'
    AND flight_card_digest=signal_semantic_context_digest_json_v2(flight_card)
    AND (flight_card->>'max_model_turns')::int BETWEEN 1 AND 12
    AND (flight_card->>'max_tool_calls')::int BETWEEN 1 AND 24
    AND (flight_card->>'max_tool_result_bytes')::int BETWEEN 1 AND 32768
    AND (flight_card->>'max_total_tool_result_bytes')::int BETWEEN 1 AND 262144
    AND (flight_card->>'max_total_input_tokens')::int BETWEEN 1 AND 450000
    AND (flight_card->>'max_total_output_tokens')::int BETWEEN 1 AND 50000
    AND (flight_card->>'hard_cap_micro_usd')::bigint BETWEEN 1 AND 20000000
    AND status IN('planned','in_progress','completed','failed','outcome_unknown')
    AND model_turn_count BETWEEN 0 AND 12 AND tool_call_count BETWEEN 0 AND 24
    AND total_input_tokens BETWEEN 0 AND 450000 AND total_output_tokens BETWEEN 0 AND 50000
    AND total_tool_result_bytes BETWEEN 0 AND 262144
    AND reserved_micro_usd BETWEEN 0 AND 20000000
    AND (settled_micro_usd IS NULL OR settled_micro_usd BETWEEN 0 AND 20000000)
    AND (error_code IS NULL OR error_code~'^[a-z0-9_]{1,120}$')
    AND (output_digest IS NULL OR output_digest~'^sha256:[0-9a-f]{64}$')
    AND ((NOT provider_execution_enabled
      AND execution_authorization_id IS NULL
      AND provider_call_count=0
      AND confirmation='RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION'
      AND flight_card @> '{"contract_version":"signal-topic-evaluation-full-evidence-v2","execution_enabled":false,"provider_calls_allowed":0,"no_retry":true,"action_time_confirmation_required":true,"preserve_complete_candidate_pool":true,"top_view_limit":10}'::jsonb)
      OR (provider_execution_enabled
        AND execution_authorization_id IS NOT NULL
        AND confirmation='AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION'
        AND provider_call_count BETWEEN 0 AND 12
        AND flight_card @> '{"contract_version":"signal-topic-evaluation-full-evidence-v2","execution_enabled":true,"no_retry":true,"action_time_confirmation_required":true,"preserve_complete_candidate_pool":true,"top_view_limit":10}'::jsonb
        AND COALESCE((flight_card->>'provider_calls_allowed')::int,0) BETWEEN 1 AND 12))
  );

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_execution_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authority signal_topic_evaluation_v2_execution_authorizations%ROWTYPE;
BEGIN
  IF NOT NEW.provider_execution_enabled THEN RETURN NEW; END IF;
  SELECT * INTO authority FROM signal_topic_evaluation_v2_execution_authorizations
    WHERE id=NEW.execution_authorization_id;
  IF authority.id IS NULL OR authority.workspace_id<>NEW.workspace_id
     OR authority.snapshot_id<>NEW.snapshot_id
     OR authority.requested_by_user_id<>NEW.requested_by_user_id
     OR authority.idempotency_key<>NEW.idempotency_key
     OR authority.flight_card<>NEW.flight_card
     OR authority.flight_card_digest<>NEW.flight_card_digest
     OR authority.reserved_micro_usd<>NEW.reserved_micro_usd
     OR authority.status NOT IN('authorized','claimed') THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 provider execution authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_execution_run
BEFORE INSERT OR UPDATE ON signal_topic_evaluation_v2_runs FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_execution_run_v1();

-- 0112 predates execution_authorization_id. Replace its transition guard rather than leaving a
-- new mutable column outside the append-only boundary. Counts are monotonic and the reservation,
-- flight card and execution authority are fixed when the run is created.
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
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_execution_authorization
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_execution_authorizations FOR EACH ROW
EXECUTE FUNCTION protect_signal_topic_evaluation_v2_execution_authorization_v1();

-- The two rows are updated by separate statements inside one transaction. A deferred pair check
-- lets the approved writers reach their final state atomically while rejecting a transaction that
-- commits either half, its provider-attempt accounting, or its settlement independently.
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

  SELECT authority.status authority_status,run.status run_status,
    authority.provider_call_count authority_calls,run.provider_call_count run_calls,
    authority.settled_micro_usd authority_settled,run.settled_micro_usd run_settled,
    authority.error_code authority_error,run.error_code run_error,
    authority.completed_at authority_completed,run.completed_at run_completed
  INTO paired
  FROM signal_topic_evaluation_v2_execution_authorizations authority
  JOIN signal_topic_evaluation_v2_runs run ON run.execution_authorization_id=authority.id
  WHERE authority.id=authorization_id;

  IF paired IS NULL
     OR paired.authority_calls<>paired.run_calls
     OR paired.authority_settled IS DISTINCT FROM paired.run_settled
     OR paired.authority_error IS DISTINCT FROM paired.run_error
     OR (paired.authority_completed IS NULL)<>(paired.run_completed IS NULL)
     OR NOT ((paired.authority_status='authorized' AND paired.run_status='planned')
       OR (paired.authority_status='claimed' AND paired.run_status='in_progress')
       OR (paired.authority_status IN('completed','failed','outcome_unknown')
         AND paired.authority_status=paired.run_status)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 execution authority/run pair is invalid.';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_validate_signal_topic_evaluation_v2_execution_authorization_pair
AFTER INSERT OR UPDATE ON signal_topic_evaluation_v2_execution_authorizations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_execution_pair_v1();
CREATE CONSTRAINT TRIGGER trg_validate_signal_topic_evaluation_v2_execution_run_pair
AFTER INSERT OR UPDATE ON signal_topic_evaluation_v2_runs
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_execution_pair_v1();

COMMENT ON TABLE signal_topic_evaluation_v2_execution_authorizations IS
  'Append-only UAT-only authority for a separately confirmed bounded provider evaluation. It defaults to unused; it cannot adopt, publish or serve Topics.';
