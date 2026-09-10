-- 0119: local-disposable, provider-flight authority for one candidate-refinement proposal.
--
-- This migration extends 0118 only inside an externally anchored Topic Lab clone. It does not
-- change candidates, editorial revisions, Topic Contracts, publication or serving. A flight is
-- append-only: a terminal receipt is the sole durable settlement record.

DO $$
BEGIN
  IF current_database()!~'^noisia_topic_eval_lab_[a-z0-9_]{8,64}$'
     OR to_regclass('noisia_topic_evaluation_lab.clone_provenance') IS NULL
     OR to_regclass('signal_topic_evaluation_v2_candidate_refinement_sessions') IS NULL
     OR NOT EXISTS(
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal=118 AND migration_name='0118_signal_topic_evaluation_v2_candidate_refinement.sql'
         AND disposition='applied'
     ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Migration 0119 requires the externally anchored local Topic Refinement Lab.';
  END IF;
END;
$$;

CREATE TABLE signal_topic_evaluation_v2_candidate_refinement_flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES signal_topic_evaluation_v2_candidate_refinement_sessions(id)
    ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  flight_key text NOT NULL,
  confirmation_digest text NOT NULL,
  source_run_key text NOT NULL,
  source_clone_receipt_digest text NOT NULL,
  source_container_identity_digest text NOT NULL,
  source_snapshot_digest text NOT NULL,
  source_brand_os_authority_digest text NOT NULL,
  migration_0116_checksum text NOT NULL,
  migration_0117_checksum text NOT NULL,
  migration_0118_checksum text NOT NULL,
  pricing_version text NOT NULL,
  model text NOT NULL,
  input_micro_usd_per_token integer NOT NULL,
  output_micro_usd_per_token integer NOT NULL,
  max_model_turns integer NOT NULL,
  max_navigation_calls integer NOT NULL,
  max_input_tokens integer NOT NULL,
  max_output_tokens integer NOT NULL,
  max_input_tokens_per_turn integer NOT NULL,
  max_output_tokens_per_turn integer NOT NULL,
  hard_cap_micro_usd integer NOT NULL,
  reserved_micro_usd integer NOT NULL,
  aggregate_budget_scope text NOT NULL,
  aggregate_budget_cap_micro_usd integer NOT NULL,
  flight_authority_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_signal_topic_evaluation_v2_refinement_flight_idempotency
    UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_refinement_flight_key UNIQUE(workspace_id,flight_key),
  CONSTRAINT signal_topic_evaluation_v2_refinement_flight_scope_fk FOREIGN KEY(
    session_id,workspace_id,run_id,snapshot_id,candidate_id
  ) REFERENCES signal_topic_evaluation_v2_candidate_refinement_sessions(
    id,workspace_id,run_id,snapshot_id,candidate_id
  ) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_v2_refinement_flight_shape CHECK(
    idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'
    AND flight_key~'^topic-refinement-flight-[a-f0-9]{16}$'
    AND confirmation_digest='sha256:c9ed8bdf211a2d62edcfd2e02a39a1af9e223058106021f7c7ec0e5efc7e59ad'
    AND source_run_key='backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17'
    AND source_clone_receipt_digest~'^sha256:[0-9a-f]{64}$'
    AND source_container_identity_digest~'^sha256:[0-9a-f]{64}$'
    AND source_snapshot_digest~'^sha256:[0-9a-f]{64}$'
    AND source_brand_os_authority_digest~'^sha256:[0-9a-f]{64}$'
    AND migration_0116_checksum~'^sha256:[0-9a-f]{64}$'
    AND migration_0117_checksum~'^sha256:[0-9a-f]{64}$'
    AND migration_0118_checksum~'^sha256:[0-9a-f]{64}$'
    AND pricing_version='anthropic-sonnet-5-topic-refinement-2026-09-05'
    AND model='claude-sonnet-5'
    AND input_micro_usd_per_token=3 AND output_micro_usd_per_token=15
    AND max_model_turns=12 AND max_navigation_calls=12
    AND max_input_tokens=240000 AND max_output_tokens=12000
    AND max_input_tokens_per_turn=24000 AND max_output_tokens_per_turn=1000
    AND hard_cap_micro_usd=1000000 AND reserved_micro_usd=1000000
    AND aggregate_budget_scope='topic-refinement-local-aggregate-v1'
    AND aggregate_budget_cap_micro_usd=18807816
    AND flight_authority_digest~'^sha256:[0-9a-f]{64}$'
  )
);

CREATE TABLE signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL UNIQUE REFERENCES signal_topic_evaluation_v2_candidate_refinement_flights(id)
    ON DELETE RESTRICT,
  terminal_status text NOT NULL,
  provider_call_count integer NOT NULL,
  input_tokens integer,
  output_tokens integer,
  settled_micro_usd integer,
  provider_request_digest text,
  error_code text,
  terminal_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_topic_evaluation_v2_refinement_terminal_shape CHECK(
    terminal_status IN('completed','definitely_not_sent','provider_response_invalid','outcome_unknown')
    AND provider_call_count BETWEEN 0 AND 12
    AND (provider_request_digest IS NULL OR provider_request_digest~'^sha256:[0-9a-f]{64}$')
    AND (error_code IS NULL OR error_code~'^topic_refinement_[a-z0-9_]+$')
    AND terminal_digest~'^sha256:[0-9a-f]{64}$'
    AND CASE
      WHEN terminal_status='definitely_not_sent' THEN provider_call_count=0
        AND input_tokens=0 AND output_tokens=0 AND settled_micro_usd=0
      WHEN terminal_status='outcome_unknown' THEN provider_call_count BETWEEN 1 AND 12
        AND input_tokens IS NULL AND output_tokens IS NULL AND settled_micro_usd IS NULL
      ELSE provider_call_count BETWEEN 1 AND 12 AND input_tokens>=0 AND output_tokens>=0
        AND settled_micro_usd>=0
    END
  )
);

CREATE TABLE signal_topic_evaluation_v2_candidate_refinement_negative_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid REFERENCES signal_topic_evaluation_v2_candidate_refinement_flights(id) ON DELETE RESTRICT,
  authority_key_digest text NOT NULL,
  operation text NOT NULL,
  domain_code text NOT NULL,
  sqlstate text,
  proof_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_topic_evaluation_v2_refinement_negative_proof_shape CHECK(
    authority_key_digest~'^sha256:[0-9a-f]{64}$'
    AND operation IN('preflight','flight_authority','tool_navigation','terminal_reconciliation')
    AND domain_code~'^topic_refinement_[a-z0-9_]+$'
    AND (sqlstate IS NULL OR sqlstate~'^[0-9A-Z]{5}$')
    AND proof_digest~'^sha256:[0-9a-f]{64}$'
  )
);

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_candidate_refinement_flight_digest_v1(
  session_id uuid,workspace_id uuid,run_id uuid,snapshot_id uuid,candidate_id uuid,actor_user_id uuid,
  idempotency_key text,flight_key text,confirmation_digest text,source_run_key text,
  source_clone_receipt_digest text,source_container_identity_digest text,source_snapshot_digest text,
  source_brand_os_authority_digest text,migration_0116_checksum text,migration_0117_checksum text,
  migration_0118_checksum text,pricing_version text,model text,input_rate integer,output_rate integer,
  max_turns integer,max_navigation integer,max_input integer,max_output integer,max_input_turn integer,
  max_output_turn integer,hard_cap integer,reserved integer,budget_scope text,budget_cap integer
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'sha256:'||encode(digest(jsonb_build_object(
    'contract_version','signal-topic-candidate-refinement-flight-v1','session_id',session_id,
    'workspace_id',workspace_id,'run_id',run_id,'snapshot_id',snapshot_id,'candidate_id',candidate_id,
    'actor_user_id',actor_user_id,'idempotency_key',idempotency_key,'flight_key',flight_key,
    'confirmation_digest',confirmation_digest,'source_run_key',source_run_key,
    'source_clone_receipt_digest',source_clone_receipt_digest,
    'source_container_identity_digest',source_container_identity_digest,
    'source_snapshot_digest',source_snapshot_digest,
    'source_brand_os_authority_digest',source_brand_os_authority_digest,
    'migration_0116_checksum',migration_0116_checksum,'migration_0117_checksum',migration_0117_checksum,
    'migration_0118_checksum',migration_0118_checksum,'pricing_version',pricing_version,'model',model,
    'input_rate',input_rate,'output_rate',output_rate,'max_turns',max_turns,'max_navigation',max_navigation,
    'max_input',max_input,'max_output',max_output,'max_input_turn',max_input_turn,
    'max_output_turn',max_output_turn,'hard_cap',hard_cap,'reserved',reserved,
    'budget_scope',budget_scope,'budget_cap',budget_cap
  )::text,'sha256'),'hex')
$$;

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
     OR session_row.expires_at<=clock_timestamp()
     OR snapshot_digest_value IS NULL OR NEW.source_snapshot_digest<>snapshot_digest_value
  THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic refinement flight authority is invalid.';
  END IF;
  -- The separate source snapshot is proven by a digest receipt outside the disposable target;
  -- the live session must still bind its own current Brand OS authority exactly.
  IF NEW.source_brand_os_authority_digest<>session_row.brand_os_authority_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic refinement flight authority is invalid.';
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
  -- The database, not a caller, seals the authority after validating every input field.
  NEW.flight_authority_digest:=expected_digest;
  SELECT COALESCE(sum(CASE receipt.terminal_status
    WHEN 'completed' THEN receipt.settled_micro_usd
    WHEN 'definitely_not_sent' THEN 0
    WHEN 'provider_response_invalid' THEN receipt.settled_micro_usd
    ELSE flight.reserved_micro_usd END),0) INTO committed_micro_usd
  FROM signal_topic_evaluation_v2_candidate_refinement_flights flight
  LEFT JOIN signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts receipt
    ON receipt.flight_id=flight.id
  WHERE flight.aggregate_budget_scope=NEW.aggregate_budget_scope;
  IF committed_micro_usd+NEW.reserved_micro_usd>NEW.aggregate_budget_cap_micro_usd THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic refinement aggregate budget is exhausted.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_refinement_flight
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_refinement_flights
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_flight_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_terminal_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE flight signal_topic_evaluation_v2_candidate_refinement_flights%ROWTYPE;
DECLARE expected_cost integer; DECLARE expected_digest text;
BEGIN
  SELECT * INTO flight FROM signal_topic_evaluation_v2_candidate_refinement_flights WHERE id=NEW.flight_id
    FOR KEY SHARE;
  IF flight.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic refinement terminal authority is invalid.'; END IF;
  IF NEW.terminal_status IN('completed','provider_response_invalid') THEN
    expected_cost:=NEW.input_tokens*flight.input_micro_usd_per_token
      +NEW.output_tokens*flight.output_micro_usd_per_token;
    IF NEW.input_tokens>flight.max_input_tokens OR NEW.output_tokens>flight.max_output_tokens
       OR NEW.settled_micro_usd<>expected_cost OR NEW.settled_micro_usd>flight.reserved_micro_usd THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic refinement terminal settlement is invalid.';
    END IF;
  END IF;
  expected_digest:='sha256:'||encode(digest(jsonb_build_object(
    'contract_version','signal-topic-candidate-refinement-terminal-v1','flight_id',NEW.flight_id,
    'terminal_status',NEW.terminal_status,'provider_call_count',NEW.provider_call_count,
    'input_tokens',NEW.input_tokens,'output_tokens',NEW.output_tokens,
    'settled_micro_usd',NEW.settled_micro_usd,'provider_request_digest',NEW.provider_request_digest,
    'error_code',NEW.error_code
  )::text,'sha256'),'hex');
  -- The terminal digest is likewise derived by PostgreSQL so the caller cannot forge a receipt.
  NEW.terminal_digest:=expected_digest;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_refinement_terminal
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_terminal_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_flight_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000',
    MESSAGE='Topic refinement flight records are append-only.';
END;
$$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_refinement_flights
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_refinement_flights
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_flight_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_refinement_terminal_receipts
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_flight_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_refinement_negative_proofs
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_refinement_negative_proofs
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_flight_v1();

CREATE INDEX idx_signal_topic_evaluation_v2_refinement_flights_session
  ON signal_topic_evaluation_v2_candidate_refinement_flights(session_id,created_at DESC);
CREATE INDEX idx_signal_topic_evaluation_v2_refinement_negative_proofs_flight
  ON signal_topic_evaluation_v2_candidate_refinement_negative_proofs(flight_id,created_at DESC);

COMMENT ON TABLE signal_topic_evaluation_v2_candidate_refinement_flights IS
  'Lab-only append-only authority and budget reservation for one proposal-only candidate refinement flight.';
COMMENT ON TABLE signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts IS
  'Append-only terminal settlements. They never edit candidates or activate Topics.';
