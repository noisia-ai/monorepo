-- 0121: bind every local Topic-refinement flight to the clone's immutable host receipt anchor.
--
-- The anchor is installed only by the fixed local clone creator after it has verified the
-- external 0600 receipt and the loopback container. This migration is local-disposable only.

DO $$
BEGIN
  IF current_database() !~ '^noisia_topic_eval_lab_[a-z0-9_]{8,64}$'
     OR to_regclass('noisia_topic_evaluation_lab.clone_provenance') IS NULL
     OR to_regclass('noisia_topic_evaluation_lab.host_receipt_anchor') IS NULL
     OR NOT EXISTS (SELECT 1 FROM noisia_topic_evaluation_lab.host_receipt_anchor WHERE marker_id)
     OR to_regclass('signal_topic_evaluation_v2_candidate_refinement_flights') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal = 120
         AND migration_name = '0120_signal_topic_evaluation_v2_candidate_refinement_flight_execution_seal.sql'
         AND disposition = 'applied'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Migration 0121 requires the sealed externally anchored local Topic Refinement Lab.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_flight_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_row signal_topic_evaluation_v2_candidate_refinement_sessions%ROWTYPE;
DECLARE candidate_row signal_topic_evaluation_v2_candidates%ROWTYPE;
DECLARE clone_anchor noisia_topic_evaluation_lab.host_receipt_anchor%ROWTYPE;
DECLARE snapshot_digest_value text;
DECLARE expected_digest text;
DECLARE committed_micro_usd bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('topic-refinement-local-aggregate-v1', 0));
  SELECT * INTO session_row FROM signal_topic_evaluation_v2_candidate_refinement_sessions
    WHERE id = NEW.session_id FOR KEY SHARE;
  SELECT * INTO candidate_row FROM signal_topic_evaluation_v2_candidates
    WHERE id = NEW.candidate_id FOR KEY SHARE;
  SELECT snapshot_digest INTO snapshot_digest_value FROM signal_topic_evaluation_v2_snapshots
    WHERE id = NEW.snapshot_id FOR KEY SHARE;
  SELECT * INTO clone_anchor FROM noisia_topic_evaluation_lab.host_receipt_anchor
    WHERE marker_id FOR KEY SHARE;

  IF session_row.id IS NULL OR candidate_row.id IS NULL OR clone_anchor.marker_id IS NULL
     OR clone_anchor.clone_name <> current_database()
     OR session_row.workspace_id <> NEW.workspace_id OR session_row.run_id <> NEW.run_id
     OR session_row.snapshot_id <> NEW.snapshot_id OR session_row.candidate_id <> NEW.candidate_id
     OR session_row.actor_user_id <> NEW.actor_user_id
     OR candidate_row.status <> 'pending' OR candidate_row.adopted OR candidate_row.published OR candidate_row.serving
     OR session_row.expires_at <= clock_timestamp() OR snapshot_digest_value IS NULL
     OR NEW.source_run_key <> clone_anchor.source_run_key
     OR NEW.source_snapshot_digest <> clone_anchor.source_snapshot_digest
     OR NEW.source_snapshot_digest <> snapshot_digest_value
     OR NEW.source_clone_receipt_digest <> clone_anchor.host_receipt_digest
     OR NEW.source_container_identity_digest <> clone_anchor.container_identity_digest
     OR NOT EXISTS (
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal = 116 AND migration_name = '0116_signal_topic_evaluation_disposable_lab_execution.sql'
         AND checksum_sha256 = NEW.migration_0116_checksum AND disposition = 'applied'
     )
     OR NOT EXISTS (
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal = 117 AND migration_name = '0117_signal_topic_evaluation_lab_evaluation_brief.sql'
         AND checksum_sha256 = NEW.migration_0117_checksum AND disposition = 'applied'
     )
     OR NOT EXISTS (
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal = 118 AND migration_name = '0118_signal_topic_evaluation_v2_candidate_refinement.sql'
         AND checksum_sha256 = NEW.migration_0118_checksum AND disposition = 'applied'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'topic_refinement_flight_authority_invalid';
  END IF;
  IF NEW.source_brand_os_authority_digest <> session_row.brand_os_authority_digest THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'topic_refinement_flight_authority_invalid';
  END IF;

  expected_digest := signal_topic_evaluation_v2_candidate_refinement_flight_digest_v1(
    NEW.session_id, NEW.workspace_id, NEW.run_id, NEW.snapshot_id, NEW.candidate_id, NEW.actor_user_id,
    NEW.idempotency_key, NEW.flight_key, NEW.confirmation_digest, NEW.source_run_key,
    NEW.source_clone_receipt_digest, NEW.source_container_identity_digest, NEW.source_snapshot_digest,
    NEW.source_brand_os_authority_digest, NEW.migration_0116_checksum, NEW.migration_0117_checksum,
    NEW.migration_0118_checksum, NEW.pricing_version, NEW.model, NEW.input_micro_usd_per_token,
    NEW.output_micro_usd_per_token, NEW.max_model_turns, NEW.max_navigation_calls, NEW.max_input_tokens,
    NEW.max_output_tokens, NEW.max_input_tokens_per_turn, NEW.max_output_tokens_per_turn,
    NEW.hard_cap_micro_usd, NEW.reserved_micro_usd, NEW.aggregate_budget_scope,
    NEW.aggregate_budget_cap_micro_usd
  );
  NEW.flight_authority_digest := expected_digest;

  SELECT COALESCE(sum(CASE receipt.terminal_status
    WHEN 'completed' THEN COALESCE(receipt.settled_micro_usd, flight.reserved_micro_usd)
    WHEN 'definitely_not_sent' THEN 0
    WHEN 'provider_response_invalid' THEN COALESCE(receipt.settled_micro_usd, flight.reserved_micro_usd)
    ELSE flight.reserved_micro_usd END), 0)
  INTO committed_micro_usd
  FROM signal_topic_evaluation_v2_candidate_refinement_flights flight
  LEFT JOIN signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts receipt
    ON receipt.flight_id = flight.id
  WHERE flight.aggregate_budget_scope = NEW.aggregate_budget_scope;
  IF committed_micro_usd + NEW.reserved_micro_usd > NEW.aggregate_budget_cap_micro_usd THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'topic_refinement_flight_budget_exhausted';
  END IF;
  RETURN NEW;
END;
$$;
