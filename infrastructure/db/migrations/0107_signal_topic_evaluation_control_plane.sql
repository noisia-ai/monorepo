-- 69B.5I-E-I: one-call Topic Evaluation control plane.
--
-- This is non-serving, non-adopting authority. It stores sealed references and
-- bounded candidate metadata, never corpus blobs or a Topic Contract.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE signal_topic_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  run_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  input_contract_version text NOT NULL,
  output_contract_version text NOT NULL,
  corpus_identity text NOT NULL,
  discovery_run_digest text NOT NULL,
  source_manifest_digest text NOT NULL,
  rights_digest text NOT NULL,
  modeling_count integer NOT NULL,
  packet_digest text NOT NULL,
  packet_proposal_count integer NOT NULL,
  packet_evidence_count integer NOT NULL,
  semantic_context_generation_id uuid NOT NULL,
  semantic_context_generation_key text NOT NULL,
  semantic_context_authority_digest text NOT NULL,
  brand_os_digest text NOT NULL,
  knowledge_digest text NOT NULL,
  locale_context_digest text NOT NULL,
  candidate_pack_digest text NOT NULL,
  approved_context_count integer NOT NULL,
  envelope_digest text NOT NULL,
  request_digest text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  pricing_version text NOT NULL,
  max_input_tokens integer NOT NULL,
  max_output_tokens integer NOT NULL,
  input_usd_per_million_tokens numeric(14,6) NOT NULL,
  output_usd_per_million_tokens numeric(14,6) NOT NULL,
  hard_cap_micro_usd bigint NOT NULL,
  reservation_micro_usd bigint NOT NULL,
  provider_request_identity text NOT NULL,
  provider_request_id text,
  provider_call_state text NOT NULL DEFAULT 'not_started',
  provider_call_count integer NOT NULL DEFAULT 0,
  provider_response_private text,
  provider_response_digest text,
  input_tokens integer,
  output_tokens integer,
  settled_micro_usd bigint,
  output_digest text,
  candidate_count integer,
  rubric_met boolean,
  error_code text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_topic_evaluation_run_workspace UNIQUE(id,workspace_id),
  CONSTRAINT uq_signal_topic_evaluation_idempotency UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_signal_topic_evaluation_run_key UNIQUE(workspace_id,run_key),
  CONSTRAINT uq_signal_topic_evaluation_envelope UNIQUE(workspace_id,envelope_digest),
  CONSTRAINT signal_topic_evaluation_generation_workspace FOREIGN KEY(
    semantic_context_generation_id,workspace_id
  ) REFERENCES signal_semantic_context_generations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_status CHECK(status IN(
    'queued','in_flight','response_persisted','completed','failed','outcome_unknown'
  )),
  CONSTRAINT signal_topic_evaluation_provider_state CHECK(provider_call_state IN(
    'not_started','in_flight','response_persisted','settled'
  )),
  CONSTRAINT signal_topic_evaluation_contracts CHECK(
    input_contract_version='signal-topic-evaluation-v1'
    AND output_contract_version='signal-topic-evaluation-output-v1'
  ),
  CONSTRAINT signal_topic_evaluation_counts CHECK(
    modeling_count>0 AND packet_proposal_count=115 AND packet_evidence_count>=115
    AND approved_context_count>0
    AND (candidate_count IS NULL OR candidate_count BETWEEN 1 AND 80)
  ),
  CONSTRAINT signal_topic_evaluation_digests CHECK(
    discovery_run_digest ~ '^sha256:[0-9a-f]{64}$'
    AND source_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
    AND rights_digest ~ '^sha256:[0-9a-f]{64}$'
    AND packet_digest ~ '^sha256:[0-9a-f]{64}$'
    AND semantic_context_authority_digest ~ '^sha256:[0-9a-f]{64}$'
    AND brand_os_digest ~ '^sha256:[0-9a-f]{64}$'
    AND knowledge_digest ~ '^sha256:[0-9a-f]{64}$'
    AND locale_context_digest ~ '^sha256:[0-9a-f]{64}$'
    AND candidate_pack_digest ~ '^sha256:[0-9a-f]{64}$'
    AND envelope_digest ~ '^sha256:[0-9a-f]{64}$'
    AND request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provider_request_identity ~ '^sha256:[0-9a-f]{64}$'
    AND (provider_response_digest IS NULL OR provider_response_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (output_digest IS NULL OR output_digest ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT signal_topic_evaluation_budget CHECK(
    max_input_tokens>0 AND max_output_tokens>0
    AND input_usd_per_million_tokens>=0 AND output_usd_per_million_tokens>=0
    AND hard_cap_micro_usd>0
    AND reservation_micro_usd>0 AND reservation_micro_usd<=hard_cap_micro_usd
    AND (settled_micro_usd IS NULL OR settled_micro_usd BETWEEN 0 AND reservation_micro_usd)
  ),
  CONSTRAINT signal_topic_evaluation_one_call CHECK(
    provider_call_count BETWEEN 0 AND 1
    AND (provider_call_state='not_started' OR provider_call_count=1)
    AND (provider_response_private IS NULL)=(provider_response_digest IS NULL)
    AND (provider_response_private IS NULL OR provider_call_state IN('response_persisted','settled'))
  ),
  CONSTRAINT signal_topic_evaluation_terminal CHECK(
    (status='completed' AND provider_call_state='settled' AND settled_micro_usd IS NOT NULL
      AND output_digest IS NOT NULL AND candidate_count IS NOT NULL AND rubric_met IS NOT NULL
      AND completed_at IS NOT NULL AND failed_at IS NULL)
    OR (status<>'completed' AND completed_at IS NULL)
  )
);

CREATE TABLE signal_topic_evaluation_reservations (
  run_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  reserved_micro_usd bigint NOT NULL,
  actual_micro_usd bigint,
  input_tokens integer,
  output_tokens integer,
  reservation_digest text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT signal_topic_evaluation_reservation_run FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_reservation_status CHECK(status IN('reserved','settled','ambiguous')),
  CONSTRAINT signal_topic_evaluation_reservation_values CHECK(
    reserved_micro_usd>0 AND reservation_digest ~ '^sha256:[0-9a-f]{64}$'
    AND (actual_micro_usd IS NULL OR actual_micro_usd BETWEEN 0 AND reserved_micro_usd)
    AND ((status='settled' AND actual_micro_usd IS NOT NULL AND input_tokens>=0 AND output_tokens>=0
      AND settled_at IS NOT NULL) OR (status<>'settled' AND settled_at IS NULL))
  )
);

CREATE TABLE signal_topic_evaluation_outbox (
  run_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  worker_job_id text NOT NULL UNIQUE,
  dispatch_count integer NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT signal_topic_evaluation_outbox_run FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_outbox_status CHECK(status IN(
    'pending','dispatched','completed','dead_letter'
  )),
  CONSTRAINT signal_topic_evaluation_outbox_once CHECK(dispatch_count BETWEEN 0 AND 1)
);

CREATE TABLE signal_topic_evaluation_input_evidence (
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  evidence_ref_digest text NOT NULL,
  mention_ref_digest text NOT NULL,
  relation text NOT NULL,
  PRIMARY KEY(run_id,evidence_ref_digest),
  CONSTRAINT signal_topic_evaluation_input_evidence_run FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_input_evidence_digest CHECK(
    evidence_ref_digest ~ '^sha256:[0-9a-f]{64}$'
    AND mention_ref_digest ~ '^sha256:[0-9a-f]{64}$'
    AND relation IN('supports','limits','contradicts')
  )
);

CREATE TABLE signal_topic_evaluation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  candidate_key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  inclusion jsonb NOT NULL,
  exclusion jsonb NOT NULL,
  source_proposal_keys text[] NOT NULL,
  candidate_digest text NOT NULL,
  review_state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_evaluation_candidate_run FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_candidate_identity UNIQUE(id,run_id,workspace_id),
  CONSTRAINT uq_signal_topic_evaluation_candidate UNIQUE(run_id,candidate_key),
  CONSTRAINT signal_topic_evaluation_candidate_shape CHECK(
    btrim(title)<>'' AND btrim(description)<>''
    AND jsonb_typeof(inclusion)='array' AND jsonb_array_length(inclusion)>0
    AND jsonb_typeof(exclusion)='array' AND cardinality(source_proposal_keys)>0
    AND candidate_digest ~ '^sha256:[0-9a-f]{64}$'
    AND review_state='pending'
  )
);

CREATE TABLE signal_topic_evaluation_candidate_evidence (
  candidate_id uuid NOT NULL,
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  evidence_ref_digest text NOT NULL,
  PRIMARY KEY(candidate_id,evidence_ref_digest),
  CONSTRAINT signal_topic_evaluation_candidate_evidence_candidate FOREIGN KEY(
    candidate_id,run_id,workspace_id
  ) REFERENCES signal_topic_evaluation_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_candidate_evidence_input FOREIGN KEY(
    run_id,evidence_ref_digest
  ) REFERENCES signal_topic_evaluation_input_evidence(run_id,evidence_ref_digest) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_candidate_evidence_run FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE signal_topic_evaluation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  event_index integer NOT NULL,
  event_kind text NOT NULL,
  state_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_evaluation_event_run FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_topic_evaluation_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_event UNIQUE(run_id,event_index),
  CONSTRAINT signal_topic_evaluation_event_shape CHECK(
    event_index>=0 AND event_kind IN('queued','provider_started','response_persisted','completed','failed','outcome_unknown')
    AND state_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation signal_semantic_context_generations%ROWTYPE;
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
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_run
BEFORE INSERT ON signal_topic_evaluation_runs
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_run_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Topic evaluation runs cannot be deleted.' USING ERRCODE='55000'; END IF;
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
    NEW.reservation_micro_usd,NEW.provider_request_identity)
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
    OLD.reservation_micro_usd,OLD.provider_request_identity)
     OR NEW.provider_call_count<OLD.provider_call_count THEN
    RAISE EXCEPTION 'Topic evaluation sealed authority is immutable.' USING ERRCODE='55000';
  END IF;
  IF NOT (CASE OLD.status
    WHEN 'queued' THEN NEW.status IN('queued','in_flight','failed')
    WHEN 'in_flight' THEN NEW.status IN('in_flight','response_persisted','outcome_unknown')
    WHEN 'response_persisted' THEN NEW.status IN('response_persisted','completed','failed')
    ELSE NEW.status=OLD.status END) THEN
    RAISE EXCEPTION 'Topic evaluation state is terminal or regressive.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_run
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_runs
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_run_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Topic evaluation evidence and candidates are append-only.' USING ERRCODE='55000';
END; $$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_input_evidence
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_input_evidence
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_append_only_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_candidates
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_candidates
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_append_only_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_candidate_evidence
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_candidate_evidence
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_append_only_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_events
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_events
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_append_only_v1();

CREATE INDEX idx_signal_topic_evaluation_runs_status ON signal_topic_evaluation_runs(status,updated_at,id);
CREATE INDEX idx_signal_topic_evaluation_candidates_run ON signal_topic_evaluation_candidates(run_id,candidate_key);

COMMENT ON TABLE signal_topic_evaluation_runs IS
  'One-call, non-serving evaluation authority. It never creates or adopts a Topic Contract.';
COMMENT ON TABLE signal_topic_evaluation_candidates IS
  'Editable/rejectable evaluation candidates only; pending is not Topic adoption or publication.';
