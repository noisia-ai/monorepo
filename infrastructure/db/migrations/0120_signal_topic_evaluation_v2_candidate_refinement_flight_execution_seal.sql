-- 0120: close the local-only refinement-flight dispatch and settlement bypasses found by
-- independent audit. This is forward-only and applies only to a disposable Topic Lab clone.

DO $$
BEGIN
  IF current_database()!~'^noisia_topic_eval_lab_[a-z0-9_]{8,64}$'
     OR to_regclass('noisia_topic_evaluation_lab.clone_provenance') IS NULL
     OR to_regclass('signal_topic_evaluation_v2_candidate_refinement_flights') IS NULL
     OR NOT EXISTS(
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal=119 AND migration_name='0119_signal_topic_evaluation_v2_candidate_refinement_flight.sql'
         AND disposition='applied'
     ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Migration 0120 requires the 0119 externally anchored local Topic Refinement Lab.';
  END IF;
END;
$$;

-- A claim is inserted before the first provider transport. It is append-only: a crash after a
-- claim is reconciled as unknown rather than retried, so two processes cannot spend one flight.
CREATE TABLE signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL UNIQUE REFERENCES signal_topic_evaluation_v2_candidate_refinement_flights(id)
    ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claim_key text NOT NULL UNIQUE,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_topic_evaluation_v2_refinement_dispatch_claim_shape CHECK(
    claim_key~'^topic-refinement-claim-[0-9a-f-]{36}$'
  )
);

-- PostgreSQL CHECK accepts NULL, so the original 0119 branch must be replaced with explicit
-- presence checks for every known-response settlement field.
ALTER TABLE signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts
  DROP CONSTRAINT signal_topic_evaluation_v2_refinement_terminal_shape;
ALTER TABLE signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts
  ADD CONSTRAINT signal_topic_evaluation_v2_refinement_terminal_shape CHECK(
    terminal_status IN('completed','definitely_not_sent','provider_response_invalid','outcome_unknown')
    AND provider_call_count BETWEEN 0 AND 12
    AND (provider_request_digest IS NULL OR provider_request_digest~'^sha256:[0-9a-f]{64}$')
    AND (error_code IS NULL OR error_code~'^topic_refinement_[a-z0-9_]+$')
    AND terminal_digest~'^sha256:[0-9a-f]{64}$'
    AND CASE
      WHEN terminal_status='definitely_not_sent' THEN
        provider_call_count=0 AND input_tokens IS NOT NULL AND input_tokens=0
        AND output_tokens IS NOT NULL AND output_tokens=0
        AND settled_micro_usd IS NOT NULL AND settled_micro_usd=0
      WHEN terminal_status='outcome_unknown' THEN
        provider_call_count BETWEEN 1 AND 12
        AND input_tokens IS NULL AND output_tokens IS NULL AND settled_micro_usd IS NULL
      ELSE
        provider_call_count BETWEEN 1 AND 12
        AND input_tokens IS NOT NULL AND input_tokens>=0
        AND output_tokens IS NOT NULL AND output_tokens>=0
        AND settled_micro_usd IS NOT NULL AND settled_micro_usd>=0
    END
  );

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_flight_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_row signal_topic_evaluation_v2_candidate_refinement_sessions%ROWTYPE;
DECLARE candidate_row signal_topic_evaluation_v2_candidates%ROWTYPE;
DECLARE snapshot_digest_value text;
DECLARE expected_digest text; DECLARE committed_micro_usd bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('topic-refinement-local-aggregate-v1',0));
  SELECT * INTO session_row FROM signal_topic_evaluation_v2_candidate_refinement_sessions
    WHERE id=NEW.session_id FOR KEY SHARE;
  SELECT * INTO candidate_row FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id FOR KEY SHARE;
  SELECT snapshot_digest INTO snapshot_digest_value FROM signal_topic_evaluation_v2_snapshots
    WHERE id=NEW.snapshot_id FOR KEY SHARE;
  IF session_row.id IS NULL OR candidate_row.id IS NULL OR session_row.workspace_id<>NEW.workspace_id
     OR session_row.run_id<>NEW.run_id OR session_row.snapshot_id<>NEW.snapshot_id
     OR session_row.candidate_id<>NEW.candidate_id OR session_row.actor_user_id<>NEW.actor_user_id
     OR candidate_row.status<>'pending' OR candidate_row.adopted OR candidate_row.published OR candidate_row.serving
     -- `source_run_key` is the immutable frozen BERTopic source-run identity. The evaluation
     -- run is bound separately by `session_row.run_id = NEW.run_id` and the session FK; it must
     -- not be compared to the source corpus key.
     OR session_row.expires_at<=clock_timestamp()
     OR snapshot_digest_value IS NULL OR NEW.source_snapshot_digest<>snapshot_digest_value
     OR NOT EXISTS(SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal=116 AND migration_name='0116_signal_topic_evaluation_disposable_lab_execution.sql'
         AND checksum_sha256=NEW.migration_0116_checksum AND disposition='applied')
     OR NOT EXISTS(SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal=117 AND migration_name='0117_signal_topic_evaluation_lab_evaluation_brief.sql'
         AND checksum_sha256=NEW.migration_0117_checksum AND disposition='applied')
     OR NOT EXISTS(SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal=118 AND migration_name='0118_signal_topic_evaluation_v2_candidate_refinement.sql'
         AND checksum_sha256=NEW.migration_0118_checksum AND disposition='applied')
  THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='topic_refinement_flight_authority_invalid';
  END IF;
  IF NEW.source_brand_os_authority_digest<>session_row.brand_os_authority_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='topic_refinement_flight_authority_invalid';
  END IF;
  expected_digest:=signal_topic_evaluation_v2_candidate_refinement_flight_digest_v1(
    NEW.session_id,NEW.workspace_id,NEW.run_id,NEW.snapshot_id,NEW.candidate_id,NEW.actor_user_id,
    NEW.idempotency_key,NEW.flight_key,NEW.confirmation_digest,NEW.source_run_key,
    NEW.source_clone_receipt_digest,NEW.source_container_identity_digest,NEW.source_snapshot_digest,
    NEW.source_brand_os_authority_digest,NEW.migration_0116_checksum,NEW.migration_0117_checksum,
    NEW.migration_0118_checksum,NEW.pricing_version,NEW.model,NEW.input_micro_usd_per_token,
    NEW.output_micro_usd_per_token,NEW.max_model_turns,NEW.max_navigation_calls,NEW.max_input_tokens,
    NEW.max_output_tokens,NEW.max_input_tokens_per_turn,NEW.max_output_tokens_per_turn,
    NEW.hard_cap_micro_usd,NEW.reserved_micro_usd,NEW.aggregate_budget_scope,
    NEW.aggregate_budget_cap_micro_usd);
  NEW.flight_authority_digest:=expected_digest;
  SELECT COALESCE(sum(CASE receipt.terminal_status
    WHEN 'completed' THEN COALESCE(receipt.settled_micro_usd,flight.reserved_micro_usd)
    WHEN 'definitely_not_sent' THEN 0
    WHEN 'provider_response_invalid' THEN COALESCE(receipt.settled_micro_usd,flight.reserved_micro_usd)
    ELSE flight.reserved_micro_usd END),0) INTO committed_micro_usd
  FROM signal_topic_evaluation_v2_candidate_refinement_flights flight
  LEFT JOIN signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts receipt
    ON receipt.flight_id=flight.id
  WHERE flight.aggregate_budget_scope=NEW.aggregate_budget_scope;
  IF committed_micro_usd+NEW.reserved_micro_usd>NEW.aggregate_budget_cap_micro_usd THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='topic_refinement_flight_budget_exhausted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_dispatch_claim_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE flight signal_topic_evaluation_v2_candidate_refinement_flights%ROWTYPE;
DECLARE session_row signal_topic_evaluation_v2_candidate_refinement_sessions%ROWTYPE;
DECLARE candidate_row signal_topic_evaluation_v2_candidates%ROWTYPE;
BEGIN
  SELECT * INTO flight FROM signal_topic_evaluation_v2_candidate_refinement_flights WHERE id=NEW.flight_id
    FOR KEY SHARE;
  SELECT * INTO session_row FROM signal_topic_evaluation_v2_candidate_refinement_sessions WHERE id=flight.session_id
    FOR KEY SHARE;
  SELECT * INTO candidate_row FROM signal_topic_evaluation_v2_candidates WHERE id=flight.candidate_id
    FOR KEY SHARE;
  IF flight.id IS NULL OR session_row.id IS NULL OR candidate_row.id IS NULL
     OR NEW.actor_user_id<>flight.actor_user_id OR session_row.actor_user_id<>flight.actor_user_id
     OR session_row.expires_at<=clock_timestamp() OR candidate_row.status<>'pending'
     OR candidate_row.adopted OR candidate_row.published OR candidate_row.serving
     OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts
       WHERE flight_id=NEW.flight_id)
  THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='topic_refinement_dispatch_claim_authority_invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_refinement_dispatch_claim
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_dispatch_claim_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_terminal_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE flight signal_topic_evaluation_v2_candidate_refinement_flights%ROWTYPE;
DECLARE expected_cost integer; DECLARE expected_digest text;
BEGIN
  SELECT * INTO flight FROM signal_topic_evaluation_v2_candidate_refinement_flights WHERE id=NEW.flight_id
    FOR KEY SHARE;
  IF flight.id IS NULL
     OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims
       WHERE flight_id=NEW.flight_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='topic_refinement_terminal_authority_invalid';
  END IF;
  IF NEW.terminal_status IN('completed','provider_response_invalid') THEN
    IF NEW.input_tokens IS NULL OR NEW.output_tokens IS NULL OR NEW.settled_micro_usd IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='topic_refinement_terminal_settlement_invalid';
    END IF;
    expected_cost:=NEW.input_tokens*flight.input_micro_usd_per_token
      +NEW.output_tokens*flight.output_micro_usd_per_token;
    IF NEW.input_tokens>flight.max_input_tokens OR NEW.output_tokens>flight.max_output_tokens
       OR NEW.settled_micro_usd<>expected_cost OR NEW.settled_micro_usd>flight.reserved_micro_usd THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='topic_refinement_terminal_settlement_invalid';
    END IF;
  END IF;
  expected_digest:='sha256:'||encode(digest(jsonb_build_object(
    'contract_version','signal-topic-candidate-refinement-terminal-v1','flight_id',NEW.flight_id,
    'terminal_status',NEW.terminal_status,'provider_call_count',NEW.provider_call_count,
    'input_tokens',NEW.input_tokens,'output_tokens',NEW.output_tokens,
    'settled_micro_usd',NEW.settled_micro_usd,'provider_request_digest',NEW.provider_request_digest,
    'error_code',NEW.error_code
  )::text,'sha256'),'hex');
  NEW.terminal_digest:=expected_digest;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_refinement_dispatch_claims
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_flight_v1();

CREATE INDEX idx_signal_topic_evaluation_v2_refinement_dispatch_claims_flight
  ON signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims(flight_id,claimed_at DESC);

COMMENT ON TABLE signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims IS
  'One append-only execution claim per local-only refinement flight; it must exist before any provider transport.';
