-- Backend 10C.3B-A.2 / NOI-72: bounded Semantic Context proposal execution.
--
-- This migration adds durable execution, budget and recovery state around the
-- append-only authority introduced in 0091. It creates no proposal, provider call,
-- Topic Contract, assignment, record_tag, serving binding or pointer.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS signal_semantic_context_proposal_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  run_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  preflight_digest text NOT NULL,
  brand_os_digest text NOT NULL,
  knowledge_digest text NOT NULL,
  locale_context_digest text NOT NULL,
  prompt_digest text NOT NULL,
  context_input_digest text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  model_version text NOT NULL,
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
  input_tokens bigint,
  output_tokens bigint,
  settled_micro_usd bigint,
  validated_output_digest text,
  appended_operation_id uuid REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  proposal_count integer,
  result_digest text,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  error_summary text,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  validating_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  stale_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_semantic_context_proposal_run_id_workspace UNIQUE(id,workspace_id),
  CONSTRAINT uq_signal_semantic_context_proposal_run_generation UNIQUE(generation_id),
  CONSTRAINT uq_signal_semantic_context_proposal_run_key UNIQUE(workspace_id,run_key),
  CONSTRAINT signal_semantic_context_proposal_run_generation_workspace
    FOREIGN KEY(generation_id,workspace_id)
    REFERENCES signal_semantic_context_generations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_proposal_run_status CHECK(status IN (
    'queued','processing','validating','completed','failed','stale','dead_letter'
  )),
  CONSTRAINT signal_semantic_context_proposal_provider_state CHECK(provider_call_state IN (
    'not_started','in_flight','response_persisted','outcome_unknown','settled'
  )),
  CONSTRAINT signal_semantic_context_proposal_run_digests CHECK(
    preflight_digest ~ '^sha256:[0-9a-f]{64}$'
    AND brand_os_digest ~ '^sha256:[0-9a-f]{64}$'
    AND knowledge_digest ~ '^sha256:[0-9a-f]{64}$'
    AND locale_context_digest ~ '^sha256:[0-9a-f]{64}$'
    AND prompt_digest ~ '^sha256:[0-9a-f]{64}$'
    AND context_input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provider_request_identity ~ '^sha256:[0-9a-f]{64}$'
    AND (provider_response_digest IS NULL OR provider_response_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (validated_output_digest IS NULL OR validated_output_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (result_digest IS NULL OR result_digest ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT signal_semantic_context_proposal_run_budget CHECK(
    max_input_tokens>0 AND max_output_tokens>0
    AND input_usd_per_million_tokens>=0 AND output_usd_per_million_tokens>=0
    AND hard_cap_micro_usd>0 AND reservation_micro_usd>0
    AND reservation_micro_usd<=hard_cap_micro_usd
    AND (settled_micro_usd IS NULL OR settled_micro_usd<=reservation_micro_usd)
  ),
  CONSTRAINT signal_semantic_context_proposal_run_provider_call CHECK(
    provider_call_count BETWEEN 0 AND 1
    AND (provider_call_state='not_started' OR provider_call_count=1)
    AND (provider_response_private IS NULL)=(provider_response_digest IS NULL)
    AND (provider_response_private IS NULL OR provider_call_state IN ('response_persisted','settled'))
    AND (settled_micro_usd IS NULL OR provider_call_state='settled')
  ),
  CONSTRAINT signal_semantic_context_proposal_run_usage CHECK(
    (input_tokens IS NULL AND output_tokens IS NULL)
    OR (input_tokens>=0 AND output_tokens>=0)
  ),
  CONSTRAINT signal_semantic_context_proposal_run_result CHECK(
    (status='completed' AND proposal_count>0 AND result_digest IS NOT NULL
      AND appended_operation_id IS NOT NULL AND completed_at IS NOT NULL
      AND provider_call_state='settled')
    OR (status<>'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT signal_semantic_context_proposal_run_lease CHECK(
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_proposal_run_status
  ON signal_semantic_context_proposal_runs(status,updated_at,id);
CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_proposal_run_recovery
  ON signal_semantic_context_proposal_runs(lease_expires_at,status)
  WHERE status IN ('processing','validating');

CREATE TABLE IF NOT EXISTS signal_semantic_context_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  reservation_micro_usd bigint NOT NULL,
  reserved_input_tokens bigint NOT NULL,
  reserved_output_tokens bigint NOT NULL,
  input_tokens bigint,
  output_tokens bigint,
  actual_micro_usd bigint,
  reservation_digest text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  released_at timestamptz,
  release_reason text,
  CONSTRAINT uq_signal_semantic_context_budget_run UNIQUE(run_id),
  CONSTRAINT signal_semantic_context_budget_run_workspace
    FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_semantic_context_proposal_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_budget_status CHECK(status IN ('reserved','settled','released')),
  CONSTRAINT signal_semantic_context_budget_values CHECK(
    reservation_micro_usd>0 AND reserved_input_tokens>0 AND reserved_output_tokens>0
    AND reservation_digest ~ '^sha256:[0-9a-f]{64}$'
    AND (actual_micro_usd IS NULL OR (actual_micro_usd>=0 AND actual_micro_usd<=reservation_micro_usd))
  ),
  CONSTRAINT signal_semantic_context_budget_settlement CHECK(
    (status='reserved' AND input_tokens IS NULL AND output_tokens IS NULL
      AND actual_micro_usd IS NULL AND settled_at IS NULL AND released_at IS NULL)
    OR (status='settled' AND input_tokens>=0 AND output_tokens>=0
      AND actual_micro_usd IS NOT NULL AND settled_at IS NOT NULL AND released_at IS NULL)
    OR (status='released' AND actual_micro_usd IS NULL AND settled_at IS NULL
      AND released_at IS NOT NULL AND release_reason IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS signal_semantic_context_proposal_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  worker_job_id text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  error_summary text,
  dispatched_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_semantic_context_proposal_outbox_run UNIQUE(run_id),
  CONSTRAINT signal_semantic_context_proposal_outbox_run_workspace
    FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_semantic_context_proposal_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_proposal_outbox_status CHECK(status IN (
    'pending','dispatching','dispatched','completed','failed','dead_letter'
  )),
  CONSTRAINT signal_semantic_context_proposal_outbox_attempt CHECK(attempt_count>=0),
  CONSTRAINT signal_semantic_context_proposal_outbox_lease CHECK(
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_proposal_outbox_claim
  ON signal_semantic_context_proposal_outbox(status,available_at,created_at)
  WHERE status IN ('pending','failed','dispatching','dispatched');

CREATE TABLE IF NOT EXISTS signal_semantic_context_proposal_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  transition_key text NOT NULL,
  event_kind text NOT NULL,
  state_digest text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_semantic_context_proposal_event_run_workspace
    FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_semantic_context_proposal_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_semantic_context_proposal_event UNIQUE(run_id,transition_key),
  CONSTRAINT signal_semantic_context_proposal_event_kind CHECK(event_kind IN (
    'queued','dispatching','dispatched','processing','provider_started','provider_response_persisted',
    'validating','completed','failed','stale','dead_letter','recovery_queued','budget_settled'
  )),
  CONSTRAINT signal_semantic_context_proposal_event_digest CHECK(
    state_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_proposal_events
  ON signal_semantic_context_proposal_run_events(run_id,created_at,id);

ALTER TABLE signal_governance_control_operations
  DROP CONSTRAINT IF EXISTS signal_governance_control_action;
ALTER TABLE signal_governance_control_operations
  ADD CONSTRAINT signal_governance_control_action CHECK(action IN (
    'create-quality-draft','create-retention-draft','create-licensing-draft',
    'activate-policy','create-provenance-binding-draft','activate-provenance-binding',
    'upsert-identity','update-timezone','reconcile-brand-os','create-source','import-source',
    'reconcile-governed-view','reconcile-strategic-authority','promote-strategic-authority',
    'reconcile-acquisition-plan','promote-acquisition-plan','create-acquisition-query',
    'review-acquisition-query','retire-acquisition-slot','decide-acquisition-reference',
    'retire-competitor','reactivate-competitor','create-competitor','seal-acquisition-import',
    'seal-acquisition-brief','generate-acquisition-queries','authorize-acquisition-benchmark',
    'register-topic-discovery-review','save-topic-discovery-review-draft',
    'save-topic-discovery-outlier-draft','finalize-topic-discovery-review',
    'supersede-topic-discovery-review','create-semantic-context-draft',
    'append-semantic-context-proposals','decide-semantic-context-element',
    'bulk-approve-semantic-context-elements','publish-semantic-context-generation',
    'start-semantic-context-proposal-run','retry-semantic-context-proposal-run'
  ));

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_proposal_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;
BEGIN
  SELECT * INTO generation FROM signal_semantic_context_generations
    WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF generation.id IS NULL OR generation.status<>'draft'
     OR generation.brand_os_digest<>NEW.brand_os_digest
     OR generation.knowledge_digest<>NEW.knowledge_digest
     OR generation.locale_context_digest<>NEW.locale_context_digest
     OR generation.proposal_model<>NEW.model
     OR generation.proposal_model_version<>NEW.model_version
     OR generation.proposal_prompt_digest<>NEW.prompt_digest
     OR generation.proposal_pricing_version<>NEW.pricing_version THEN
    RAISE EXCEPTION 'Semantic context proposal run authority is incompatible.' USING ERRCODE='23514';
  END IF;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.created_by_user_id
     OR operation.action<>'start-semantic-context-proposal-run'
     OR operation.status<>'in_progress'
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'Semantic context proposal operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_signal_semantic_context_proposal_run
  ON signal_semantic_context_proposal_runs;
CREATE TRIGGER trg_validate_signal_semantic_context_proposal_run
BEFORE INSERT ON signal_semantic_context_proposal_runs
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_proposal_run_v1();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_proposal_identity_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Semantic context proposal runs cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.generation_id<>OLD.generation_id
     OR NEW.operation_id<>OLD.operation_id OR NEW.run_key<>OLD.run_key
     OR NEW.preflight_digest<>OLD.preflight_digest OR NEW.brand_os_digest<>OLD.brand_os_digest
     OR NEW.knowledge_digest<>OLD.knowledge_digest
     OR NEW.locale_context_digest<>OLD.locale_context_digest
     OR NEW.prompt_digest<>OLD.prompt_digest OR NEW.context_input_digest<>OLD.context_input_digest
     OR NEW.provider<>OLD.provider OR NEW.model<>OLD.model OR NEW.model_version<>OLD.model_version
     OR NEW.pricing_version<>OLD.pricing_version OR NEW.max_input_tokens<>OLD.max_input_tokens
     OR NEW.max_output_tokens<>OLD.max_output_tokens
     OR NEW.input_usd_per_million_tokens<>OLD.input_usd_per_million_tokens
     OR NEW.output_usd_per_million_tokens<>OLD.output_usd_per_million_tokens
     OR NEW.hard_cap_micro_usd<>OLD.hard_cap_micro_usd
     OR NEW.reservation_micro_usd<>OLD.reservation_micro_usd
     OR NEW.provider_request_identity<>OLD.provider_request_identity
     OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Semantic context proposal run authority cannot be rewritten.' USING ERRCODE='55000';
  END IF;
  IF OLD.status IN ('completed','stale','dead_letter') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal semantic context proposal runs are immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_semantic_context_proposal_run
  ON signal_semantic_context_proposal_runs;
CREATE TRIGGER trg_protect_signal_semantic_context_proposal_run
BEFORE UPDATE OR DELETE ON signal_semantic_context_proposal_runs
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_proposal_identity_v1();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_budget_reservation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Semantic context budget reservations cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.run_id<>OLD.run_id
     OR NEW.reservation_micro_usd<>OLD.reservation_micro_usd
     OR NEW.reserved_input_tokens<>OLD.reserved_input_tokens
     OR NEW.reserved_output_tokens<>OLD.reserved_output_tokens
     OR NEW.reservation_digest<>OLD.reservation_digest OR NEW.reserved_at<>OLD.reserved_at THEN
    RAISE EXCEPTION 'Semantic context budget reservation authority cannot be rewritten.' USING ERRCODE='55000';
  END IF;
  IF OLD.status IN ('settled','released') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal semantic context budget reservations are immutable.' USING ERRCODE='55000';
  END IF;
  IF OLD.status='reserved' AND NEW.status NOT IN ('reserved','settled','released') THEN
    RAISE EXCEPTION 'Invalid semantic context budget transition.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_semantic_context_budget_reservation
  ON signal_semantic_context_budget_reservations;
CREATE TRIGGER trg_protect_signal_semantic_context_budget_reservation
BEFORE UPDATE OR DELETE ON signal_semantic_context_budget_reservations
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_budget_reservation_v1();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_proposal_outbox_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Semantic context proposal outbox rows cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.run_id<>OLD.run_id
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Semantic context proposal outbox authority cannot be rewritten.' USING ERRCODE='55000';
  END IF;
  IF OLD.status IN ('completed','dead_letter') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal semantic context proposal outbox rows are immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_semantic_context_proposal_outbox
  ON signal_semantic_context_proposal_outbox;
CREATE TRIGGER trg_protect_signal_semantic_context_proposal_outbox
BEFORE UPDATE OR DELETE ON signal_semantic_context_proposal_outbox
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_proposal_outbox_v1();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_proposal_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Semantic context proposal events are append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_semantic_context_proposal_events
  ON signal_semantic_context_proposal_run_events;
CREATE TRIGGER trg_protect_signal_semantic_context_proposal_events
BEFORE UPDATE OR DELETE ON signal_semantic_context_proposal_run_events
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_proposal_event_v1();

CREATE OR REPLACE FUNCTION claim_signal_semantic_context_proposal_dispatch_v1(
  target_limit integer,
  target_lease_seconds integer,
  target_max_attempts integer
)
RETURNS TABLE(outbox_id uuid,run_id uuid,workspace_id uuid,lease_token uuid,
  worker_job_id text,dispatch_attempt integer)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY WITH claimable AS (
    SELECT outbox.id FROM signal_semantic_context_proposal_outbox outbox
    JOIN signal_semantic_context_proposal_runs run ON run.id=outbox.run_id
    WHERE outbox.attempt_count<target_max_attempts
      AND run.status NOT IN ('completed','stale','dead_letter')
      AND (
        outbox.status IN ('pending','failed') AND outbox.available_at<=now()
        OR outbox.status='dispatching' AND outbox.lease_expires_at<now()
        OR outbox.status='dispatched' AND (
          run.lease_expires_at<now()
          OR (run.status='queued' AND outbox.dispatched_at<now()-interval '30 seconds')
        )
      )
    ORDER BY outbox.available_at,outbox.created_at
    FOR UPDATE OF outbox SKIP LOCKED LIMIT greatest(1,least(target_limit,100))
  ), claimed AS (
    UPDATE signal_semantic_context_proposal_outbox outbox SET
      status='dispatching',attempt_count=outbox.attempt_count+1,
      lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>greatest(15,least(target_lease_seconds,600))),
      worker_job_id='semantic-context-proposal-'||outbox.run_id::text||'-'||(outbox.attempt_count+1)::text,
      updated_at=now()
    FROM claimable WHERE outbox.id=claimable.id RETURNING outbox.*
  )
  SELECT claimed.id,claimed.run_id,claimed.workspace_id,claimed.lease_token,
    claimed.worker_job_id,claimed.attempt_count FROM claimed;
END; $$;

CREATE OR REPLACE FUNCTION complete_signal_semantic_context_proposal_dispatch_v1(
  target_outbox_id uuid,target_lease_token uuid
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE changed integer;
BEGIN
  UPDATE signal_semantic_context_proposal_outbox SET status='dispatched',
    lease_token=NULL,lease_expires_at=NULL,dispatched_at=clock_timestamp(),
    error_summary=NULL,updated_at=now()
  WHERE id=target_outbox_id AND status='dispatching' AND lease_token=target_lease_token;
  GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END; $$;

CREATE OR REPLACE FUNCTION fail_signal_semantic_context_proposal_dispatch_v1(
  target_outbox_id uuid,target_lease_token uuid,target_retry_at timestamptz,
  target_error text,target_max_attempts integer
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE next_status text;
BEGIN
  UPDATE signal_semantic_context_proposal_outbox SET
    status=CASE WHEN attempt_count>=target_max_attempts THEN 'dead_letter' ELSE 'failed' END,
    available_at=target_retry_at,lease_token=NULL,lease_expires_at=NULL,
    error_summary=left(target_error,300),
    dead_lettered_at=CASE WHEN attempt_count>=target_max_attempts THEN clock_timestamp() ELSE NULL END,
    updated_at=now()
  WHERE id=target_outbox_id AND status='dispatching' AND lease_token=target_lease_token
  RETURNING status INTO next_status;
  RETURN next_status;
END; $$;

COMMENT ON TABLE signal_semantic_context_proposal_runs IS
  'Durable, one-call maximum proposal executions bound to an exact draft and preflight. Private provider output is never an API response.';
COMMENT ON TABLE signal_semantic_context_budget_reservations IS
  'Exact micro-USD reservation and settlement for one bounded Semantic Context provider call.';
COMMENT ON TABLE signal_semantic_context_proposal_outbox IS
  'PostgreSQL dispatch authority for recoverable Semantic Context jobs on the existing Data OS queue.';
COMMENT ON TABLE signal_semantic_context_proposal_run_events IS
  'Append-only sanitized lifecycle for Semantic Context provider execution and recovery.';
