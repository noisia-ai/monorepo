-- 69B.5I-E-R7: explicit, append-only authority for one successor flight.
--
-- Root evaluation flights remain unique by workspace/envelope. A successor is not a
-- retry of a run: it is a new one-call run authorized by one immutable operation whose
-- predecessor is a terminal ambiguous-after-send run.

CREATE TABLE signal_topic_evaluation_successor_operations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  predecessor_run_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  confirmation text NOT NULL,
  expected_envelope_digest text NOT NULL,
  hard_cap_micro_usd bigint NOT NULL,
  input jsonb NOT NULL,
  input_digest text NOT NULL,
  authority_digest text NOT NULL,
  result_run_id uuid NOT NULL,
  result_run_key text NOT NULL,
  attempt_ordinal integer NOT NULL,
  result jsonb NOT NULL,
  result_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_signal_topic_evaluation_successor_operation_workspace UNIQUE(id,workspace_id),
  CONSTRAINT uq_signal_topic_evaluation_successor_idempotency UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_signal_topic_evaluation_successor_predecessor UNIQUE(predecessor_run_id),
  CONSTRAINT uq_signal_topic_evaluation_successor_result UNIQUE(result_run_id),
  CONSTRAINT signal_topic_evaluation_successor_predecessor_fk FOREIGN KEY(predecessor_run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_successor_result_fk FOREIGN KEY(result_run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT signal_topic_evaluation_successor_closed CHECK(
    action='authorize-topic-evaluation-successor-v1'
    AND confirmation='AUTHORIZE_ONE_TOPIC_EVALUATION_SUCCESSOR'
    AND hard_cap_micro_usd>0 AND attempt_ordinal>1
    AND jsonb_typeof(input)='object' AND jsonb_typeof(result)='object'
    AND expected_envelope_digest ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND authority_digest ~ '^sha256:[0-9a-f]{64}$'
    AND result_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);

ALTER TABLE signal_topic_evaluation_runs
  ADD COLUMN predecessor_run_id uuid,
  ADD COLUMN successor_operation_id uuid,
  ADD COLUMN attempt_ordinal integer NOT NULL DEFAULT 1;

ALTER TABLE signal_topic_evaluation_runs
  DROP CONSTRAINT uq_signal_topic_evaluation_envelope,
  ADD CONSTRAINT signal_topic_evaluation_attempt_lineage CHECK(
    (predecessor_run_id IS NULL AND successor_operation_id IS NULL AND attempt_ordinal=1)
    OR (predecessor_run_id IS NOT NULL AND successor_operation_id IS NOT NULL AND attempt_ordinal>1)
  ),
  ADD CONSTRAINT signal_topic_evaluation_predecessor_run_fk FOREIGN KEY(predecessor_run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT signal_topic_evaluation_successor_operation_fk FOREIGN KEY(successor_operation_id,workspace_id)
    REFERENCES signal_topic_evaluation_successor_operations(id,workspace_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT uq_signal_topic_evaluation_direct_successor UNIQUE(predecessor_run_id),
  ADD CONSTRAINT uq_signal_topic_evaluation_successor_operation UNIQUE(successor_operation_id);

CREATE UNIQUE INDEX uq_signal_topic_evaluation_root_envelope
  ON signal_topic_evaluation_runs(workspace_id,envelope_digest)
  WHERE predecessor_run_id IS NULL;

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
     OR predecessor.error_code<>'topic_evaluation_provider_ambiguous_after_send'
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

CREATE TRIGGER trg_validate_signal_topic_evaluation_successor_operation
BEFORE INSERT ON signal_topic_evaluation_successor_operations
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_successor_operation_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_successor_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Topic evaluation successor authority is append-only.' USING ERRCODE='55000';
END; $$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_successor_operation
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_successor_operations
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_successor_operation_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_successor_predecessor_accounting_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM signal_topic_evaluation_successor_operations operation
    WHERE operation.predecessor_run_id=OLD.run_id) THEN
    RAISE EXCEPTION 'Topic evaluation successor predecessor accounting is immutable.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_successor_predecessor_reservation
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_reservations
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_successor_predecessor_accounting_v1();

CREATE TRIGGER trg_protect_signal_topic_evaluation_successor_predecessor_outbox
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_outbox
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_successor_predecessor_accounting_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  generation signal_semantic_context_generations%ROWTYPE;
  predecessor signal_topic_evaluation_runs%ROWTYPE;
  operation signal_topic_evaluation_successor_operations%ROWTYPE;
  expected_request_digest text;
  expected_request_identity text;
BEGIN
  SELECT * INTO generation FROM signal_semantic_context_generations
    WHERE id=NEW.semantic_context_generation_id AND workspace_id=NEW.workspace_id;
  IF generation.id IS NULL OR generation.status<>'draft'
     OR generation.generation_key<>NEW.semantic_context_generation_key
     OR generation.brand_os_digest<>NEW.brand_os_digest
     OR generation.knowledge_digest<>NEW.knowledge_digest
     OR generation.locale_context_digest<>NEW.locale_context_digest
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.requested_by_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets packet
       WHERE packet.workspace_id=NEW.workspace_id AND packet.packet_digest=NEW.packet_digest
         AND packet.discovery_run_digest=NEW.discovery_run_digest
         AND packet.source_manifest_digest=NEW.source_manifest_digest
         AND packet.rights_digest=NEW.rights_digest
         AND packet.proposal_count=NEW.packet_proposal_count
         AND packet.evidence_count=NEW.packet_evidence_count
         AND packet.modeling_denominator=NEW.modeling_count
         AND packet.source_holdout_state='sealed') THEN
    RAISE EXCEPTION 'Topic evaluation input authority is incompatible.' USING ERRCODE='23514';
  END IF;

  IF NEW.predecessor_run_id IS NULL THEN
    IF NEW.successor_operation_id IS NOT NULL OR NEW.attempt_ordinal<>1 THEN
      RAISE EXCEPTION 'Topic evaluation root lineage is invalid.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO predecessor FROM signal_topic_evaluation_runs
    WHERE id=NEW.predecessor_run_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_topic_evaluation_successor_operations
    WHERE id=NEW.successor_operation_id AND workspace_id=NEW.workspace_id;
  expected_request_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-evaluation-successor-request-v1',
    'predecessor_run_key',predecessor.run_key,
    'predecessor_request_identity',predecessor.provider_request_identity,
    'envelope_digest',predecessor.envelope_digest,
    'operation_authority_digest',operation.authority_digest,
    'provider',predecessor.provider,
    'model',predecessor.model,
    'pricing_version',predecessor.pricing_version,
    'max_input_tokens',predecessor.max_input_tokens,
    'max_output_tokens',predecessor.max_output_tokens,
    'hard_cap_micro_usd',operation.hard_cap_micro_usd::text
  ));
  expected_request_identity:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-evaluation-provider-request-v2',
    'request_digest',expected_request_digest
  ));

  IF predecessor.id IS NULL OR operation.id IS NULL
     OR operation.predecessor_run_id<>predecessor.id
     OR operation.result_run_id<>NEW.id
     OR operation.result_run_key<>NEW.run_key
     OR operation.actor_user_id<>NEW.requested_by_user_id
     OR operation.idempotency_key<>NEW.idempotency_key
     OR operation.expected_envelope_digest<>NEW.envelope_digest
     OR operation.hard_cap_micro_usd<>NEW.hard_cap_micro_usd
     OR operation.attempt_ordinal<>NEW.attempt_ordinal
     OR NEW.status<>'queued' OR NEW.provider_call_state<>'not_started'
     OR NEW.provider_call_count<>0 OR NEW.provider_request_id IS NOT NULL
     OR NEW.provider_response_private IS NOT NULL OR NEW.provider_response_digest IS NOT NULL
     OR NEW.input_tokens IS NOT NULL OR NEW.output_tokens IS NOT NULL
     OR NEW.settled_micro_usd IS NOT NULL OR NEW.output_digest IS NOT NULL
     OR NEW.candidate_count IS NOT NULL OR NEW.rubric_met IS NOT NULL OR NEW.error_code IS NOT NULL
     OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.failed_at IS NOT NULL
     OR NEW.request_digest<>expected_request_digest
     OR NEW.provider_request_identity<>expected_request_identity
     OR NEW.run_key<>'topic-evaluation-'||substring(expected_request_identity from 8 for 16)
     OR ROW(NEW.input_contract_version,NEW.output_contract_version,NEW.corpus_identity,
       NEW.discovery_run_digest,NEW.source_manifest_digest,NEW.rights_digest,NEW.modeling_count,
       NEW.packet_digest,NEW.packet_proposal_count,NEW.packet_evidence_count,
       NEW.semantic_context_generation_id,NEW.semantic_context_generation_key,
       NEW.semantic_context_authority_digest,NEW.brand_os_digest,NEW.knowledge_digest,
       NEW.locale_context_digest,NEW.candidate_pack_digest,NEW.approved_context_count,
       NEW.envelope_digest,NEW.provider,NEW.model,NEW.pricing_version,NEW.max_input_tokens,
       NEW.max_output_tokens,NEW.input_usd_per_million_tokens,NEW.output_usd_per_million_tokens,
       NEW.reservation_micro_usd)
       IS DISTINCT FROM ROW(predecessor.input_contract_version,predecessor.output_contract_version,
       predecessor.corpus_identity,predecessor.discovery_run_digest,predecessor.source_manifest_digest,
       predecessor.rights_digest,predecessor.modeling_count,predecessor.packet_digest,
       predecessor.packet_proposal_count,predecessor.packet_evidence_count,
       predecessor.semantic_context_generation_id,predecessor.semantic_context_generation_key,
       predecessor.semantic_context_authority_digest,predecessor.brand_os_digest,
       predecessor.knowledge_digest,predecessor.locale_context_digest,predecessor.candidate_pack_digest,
       predecessor.approved_context_count,predecessor.envelope_digest,predecessor.provider,
       predecessor.model,predecessor.pricing_version,predecessor.max_input_tokens,
       predecessor.max_output_tokens,predecessor.input_usd_per_million_tokens,
       predecessor.output_usd_per_million_tokens,predecessor.reservation_micro_usd) THEN
    RAISE EXCEPTION 'Topic evaluation successor run authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_successor_cohort_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  successor signal_topic_evaluation_runs%ROWTYPE;
  predecessor signal_topic_evaluation_runs%ROWTYPE;
  expected_reservation_digest text;
  expected_event_digest text;
BEGIN
  SELECT * INTO successor FROM signal_topic_evaluation_runs
    WHERE id=NEW.result_run_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO predecessor FROM signal_topic_evaluation_runs
    WHERE id=NEW.predecessor_run_id AND workspace_id=NEW.workspace_id;
  expected_reservation_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'run_id',NEW.result_run_id::text,
    'reservation_micro_usd',successor.reservation_micro_usd::text
  ));
  expected_event_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'event_kind','queued','detail',jsonb_build_object(
      'provider_calls',0,
      'predecessor_run_key',predecessor.run_key,
      'successor_authority_digest',NEW.authority_digest
    )
  ));

  IF successor.id IS NULL OR predecessor.id IS NULL
     OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_reservations reservation
       WHERE reservation.run_id=successor.id AND reservation.workspace_id=NEW.workspace_id
         AND reservation.status='reserved'
         AND reservation.reserved_micro_usd=successor.reservation_micro_usd
         AND reservation.actual_micro_usd IS NULL AND reservation.input_tokens IS NULL
         AND reservation.output_tokens IS NULL AND reservation.settled_at IS NULL
         AND reservation.reservation_digest=expected_reservation_digest)
     OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_outbox outbox
       WHERE outbox.run_id=successor.id AND outbox.workspace_id=NEW.workspace_id
         AND outbox.status='pending' AND outbox.dispatch_count=0 AND outbox.error_code IS NULL
         AND outbox.dispatched_at IS NULL AND outbox.completed_at IS NULL
         AND outbox.worker_job_id='topic-evaluation-'||successor.id::text)
     OR (SELECT count(*) FROM signal_topic_evaluation_events event
       WHERE event.run_id=successor.id)<>1
     OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_events event
       WHERE event.run_id=successor.id AND event.workspace_id=NEW.workspace_id
         AND event.event_index=0 AND event.event_kind='queued'
         AND event.state_digest=expected_event_digest)
     OR EXISTS(SELECT evidence_ref_digest,mention_ref_digest,relation
       FROM signal_topic_evaluation_input_evidence WHERE run_id=predecessor.id
       EXCEPT SELECT evidence_ref_digest,mention_ref_digest,relation
       FROM signal_topic_evaluation_input_evidence WHERE run_id=successor.id)
     OR EXISTS(SELECT evidence_ref_digest,mention_ref_digest,relation
       FROM signal_topic_evaluation_input_evidence WHERE run_id=successor.id
       EXCEPT SELECT evidence_ref_digest,mention_ref_digest,relation
       FROM signal_topic_evaluation_input_evidence WHERE run_id=predecessor.id)
     OR EXISTS(SELECT 1 FROM signal_topic_evaluation_candidates candidate
       WHERE candidate.run_id=successor.id) THEN
    RAISE EXCEPTION 'Topic evaluation successor cohort is incomplete or inconsistent.' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER trg_validate_signal_topic_evaluation_successor_cohort
AFTER INSERT ON signal_topic_evaluation_successor_operations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_successor_cohort_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Topic evaluation runs cannot be deleted.' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM signal_topic_evaluation_successor_operations operation
      WHERE operation.predecessor_run_id=OLD.id)
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Topic evaluation successor predecessor is immutable.' USING ERRCODE='55000';
  END IF;
  IF ROW(NEW.id,NEW.workspace_id,NEW.requested_by_user_id,NEW.idempotency_key,NEW.run_key,
    NEW.input_contract_version,NEW.output_contract_version,NEW.corpus_identity,
    NEW.discovery_run_digest,NEW.source_manifest_digest,NEW.rights_digest,NEW.modeling_count,
    NEW.packet_digest,NEW.packet_proposal_count,NEW.packet_evidence_count,
    NEW.semantic_context_generation_id,NEW.semantic_context_generation_key,
    NEW.semantic_context_authority_digest,NEW.brand_os_digest,NEW.knowledge_digest,
    NEW.locale_context_digest,NEW.candidate_pack_digest,NEW.approved_context_count,
    NEW.envelope_digest,NEW.request_digest,NEW.provider,NEW.model,NEW.pricing_version,
    NEW.max_input_tokens,NEW.max_output_tokens,NEW.input_usd_per_million_tokens,
    NEW.output_usd_per_million_tokens,NEW.hard_cap_micro_usd,
    NEW.reservation_micro_usd,NEW.provider_request_identity,NEW.predecessor_run_id,
    NEW.successor_operation_id,NEW.attempt_ordinal)
    IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.requested_by_user_id,OLD.idempotency_key,OLD.run_key,
    OLD.input_contract_version,OLD.output_contract_version,OLD.corpus_identity,
    OLD.discovery_run_digest,OLD.source_manifest_digest,OLD.rights_digest,OLD.modeling_count,
    OLD.packet_digest,OLD.packet_proposal_count,OLD.packet_evidence_count,
    OLD.semantic_context_generation_id,OLD.semantic_context_generation_key,
    OLD.semantic_context_authority_digest,OLD.brand_os_digest,OLD.knowledge_digest,
    OLD.locale_context_digest,OLD.candidate_pack_digest,OLD.approved_context_count,
    OLD.envelope_digest,OLD.request_digest,OLD.provider,OLD.model,OLD.pricing_version,
    OLD.max_input_tokens,OLD.max_output_tokens,OLD.input_usd_per_million_tokens,
    OLD.output_usd_per_million_tokens,OLD.hard_cap_micro_usd,
    OLD.reservation_micro_usd,OLD.provider_request_identity,OLD.predecessor_run_id,
    OLD.successor_operation_id,OLD.attempt_ordinal)
     OR NEW.provider_call_count<OLD.provider_call_count THEN
    RAISE EXCEPTION 'Topic evaluation sealed authority is immutable.' USING ERRCODE='55000';
  END IF;
  IF NOT (CASE OLD.status
    WHEN 'queued' THEN NEW.status IN('queued','in_flight','failed')
    WHEN 'in_flight' THEN NEW.status IN('in_flight','response_persisted','outcome_unknown') OR (
      NEW.status='failed'
      AND NEW.provider_call_count=1
      AND NEW.provider_call_state='settled'
      AND NEW.error_code='topic_evaluation_provider_definitely_not_sent'
      AND NEW.provider_response_private IS NULL
      AND NEW.provider_response_digest IS NULL
      AND NEW.provider_request_id IS NULL
      AND NEW.input_tokens=0 AND NEW.output_tokens=0 AND NEW.settled_micro_usd=0
      AND NEW.output_digest IS NULL AND NEW.candidate_count IS NULL AND NEW.rubric_met IS NULL
      AND NEW.completed_at IS NULL AND NEW.failed_at IS NOT NULL)
    WHEN 'response_persisted' THEN NEW.status IN('response_persisted','completed','failed')
    ELSE NEW.status=OLD.status END) THEN
    RAISE EXCEPTION 'Topic evaluation state is terminal or regressive.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON TABLE signal_topic_evaluation_successor_operations IS
  'Append-only explicit authority for one successor flight after an ambiguous provider outcome.';
