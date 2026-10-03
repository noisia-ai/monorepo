-- 69B.5I-E-R14: retain the sealed successor authority for a legacy ambiguous outcome code.
--
-- Migration 0110 introduced the dedicated append-only successor action. Older terminal
-- ambiguous runs can carry the pre-0110 `topic_evaluation_provider_outcome_unknown` code
-- while satisfying every other ambiguity predicate. This replacement keeps the complete
-- 0110 validator and admits only that closed legacy equivalence; it does not rewrite a run,
-- permit retry, or relax any other predecessor/accounting requirement.

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_successor_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  predecessor signal_topic_evaluation_runs%ROWTYPE;
  expected_input jsonb;
  expected_authority jsonb;
  expected_request jsonb;
  expected_request_digest text;
  expected_request_identity text;
  expected_run_key text;
  expected_result jsonb;
BEGIN
  SELECT * INTO predecessor FROM signal_topic_evaluation_runs
    WHERE id=NEW.predecessor_run_id AND workspace_id=NEW.workspace_id;
  IF predecessor.id IS NULL
     OR predecessor.status<>'outcome_unknown'
     OR predecessor.provider_call_count<>1
     OR predecessor.provider_call_state<>'in_flight'
     OR predecessor.error_code IS NULL
     OR predecessor.error_code NOT IN(
       'topic_evaluation_provider_ambiguous_after_send',
       'topic_evaluation_provider_outcome_unknown')
     OR predecessor.provider_response_private IS NOT NULL
     OR predecessor.provider_response_digest IS NOT NULL
     OR predecessor.settled_micro_usd IS NOT NULL
     OR predecessor.candidate_count IS NOT NULL
     OR predecessor.attempt_ordinal<1
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_reservations reservation
       WHERE reservation.run_id=predecessor.id AND reservation.workspace_id=NEW.workspace_id
         AND reservation.status='ambiguous' AND reservation.actual_micro_usd IS NULL
         AND reservation.settled_at IS NULL)
     OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_outbox outbox
       WHERE outbox.run_id=predecessor.id AND outbox.workspace_id=NEW.workspace_id
         AND outbox.status='dead_letter' AND outbox.dispatch_count=1)
     OR EXISTS(SELECT 1 FROM signal_topic_evaluation_candidates candidate
       WHERE candidate.run_id=predecessor.id) THEN
    RAISE EXCEPTION 'Topic evaluation successor predecessor is not eligible.' USING ERRCODE='23514';
  END IF;

  expected_input:=jsonb_build_object(
    'contract_version','signal-topic-evaluation-successor-input-v1',
    'predecessor_run_key',predecessor.run_key,
    'expected_envelope_digest',predecessor.envelope_digest,
    'confirmation',NEW.confirmation,
    'hard_cap_micro_usd',NEW.hard_cap_micro_usd::text
  );
  expected_authority:=jsonb_build_object(
    'contract_version','signal-topic-evaluation-successor-authority-v1',
    'workspace_id',NEW.workspace_id::text,
    'actor_user_id',NEW.actor_user_id::text,
    'idempotency_key',NEW.idempotency_key,
    'predecessor_run_key',predecessor.run_key,
    'predecessor_request_identity',predecessor.provider_request_identity,
    'input_digest',NEW.input_digest
  );
  expected_request:=jsonb_build_object(
    'contract_version','signal-topic-evaluation-successor-request-v1',
    'predecessor_run_key',predecessor.run_key,
    'predecessor_request_identity',predecessor.provider_request_identity,
    'envelope_digest',predecessor.envelope_digest,
    'operation_authority_digest',NEW.authority_digest,
    'provider',predecessor.provider,
    'model',predecessor.model,
    'pricing_version',predecessor.pricing_version,
    'max_input_tokens',predecessor.max_input_tokens,
    'max_output_tokens',predecessor.max_output_tokens,
    'hard_cap_micro_usd',NEW.hard_cap_micro_usd::text
  );
  expected_request_digest:=signal_semantic_context_digest_json_v2(expected_request);
  expected_request_identity:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-evaluation-provider-request-v2',
    'request_digest',expected_request_digest
  ));
  expected_run_key:='topic-evaluation-'||substring(expected_request_identity from 8 for 16);
  expected_result:=jsonb_build_object(
    'contract_version','signal-topic-evaluation-successor-result-v1',
    'predecessor_run_key',predecessor.run_key,
    'run_key',expected_run_key,
    'attempt_ordinal',predecessor.attempt_ordinal+1,
    'status','queued',
    'provider_call_count',0
  );

  IF NEW.action<>'authorize-topic-evaluation-successor-v1'
     OR NEW.confirmation<>'AUTHORIZE_ONE_TOPIC_EVALUATION_SUCCESSOR'
     OR NEW.expected_envelope_digest<>predecessor.envelope_digest
     OR NEW.hard_cap_micro_usd<>predecessor.hard_cap_micro_usd
     OR NEW.input IS DISTINCT FROM expected_input
     OR NEW.input_digest<>signal_semantic_context_digest_json_v2(expected_input)
     OR NEW.authority_digest<>signal_semantic_context_digest_json_v2(expected_authority)
     OR NEW.result_run_key<>expected_run_key
     OR NEW.attempt_ordinal<>predecessor.attempt_ordinal+1
     OR NEW.result IS DISTINCT FROM expected_result
     OR NEW.result_digest<>signal_semantic_context_digest_json_v2(expected_result) THEN
    RAISE EXCEPTION 'Topic evaluation successor operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
