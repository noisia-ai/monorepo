-- Governed, durable Claude resolution for the Signal semantic Review queue.
--
-- This migration does not move population pointers. It records autonomous runs,
-- preserves every reviewed decision in the existing append-only Review history,
-- and extends semantic evidence with a model-reviewed context kind.

ALTER TABLE signal_mention_attributions
  DROP CONSTRAINT IF EXISTS signal_mention_attribution_basis_contract;

ALTER TABLE signal_mention_attributions
  ADD CONSTRAINT signal_mention_attribution_basis_contract CHECK (
    (
      attribution_basis = 'source_intent'
      AND eligibility_status = 'not_eligible'
      AND semantic_policy_key IS NULL
      AND evidence_hash IS NULL
      AND supersedes_attribution_id IS NULL
      AND idempotency_key IS NULL
    )
    OR (
      attribution_basis = 'mention_semantic'
      AND semantic_policy_key IS NOT NULL
      AND semantic_policy_key ~ '^[a-z][a-z0-9-]*$'
      AND assertion_version >= 1
      AND evidence_kind IS NOT NULL
      AND evidence_kind IN (
        'explicit_primary_brand',
        'explicit_competitor_with_resolved_identity',
        'explicit_category',
        'multi_entity',
        'human_reviewed_context',
        'model_reviewed_context',
        'governed_rule'
      )
      AND evidence_hash IS NOT NULL
      AND evidence_hash ~ '^sha256:[0-9a-f]{64}$'
      AND idempotency_key IS NOT NULL
      AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
    )
  );

CREATE TABLE IF NOT EXISTS signal_semantic_resolution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued',
  model_version text NOT NULL,
  policy_key text NOT NULL,
  policy_version text NOT NULL,
  queue_digest text NOT NULL,
  total_items integer NOT NULL,
  completed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  budget_threshold_usd numeric(12,6) NOT NULL,
  budget_cap_usd numeric(12,6) NOT NULL,
  estimated_cost_usd numeric(12,6) NOT NULL,
  actual_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  over_budget_confirmed boolean NOT NULL DEFAULT false,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_semantic_resolution_run_status CHECK (
    status IN ('queued', 'running', 'completed', 'partial', 'failed')
  ),
  CONSTRAINT signal_semantic_resolution_run_counts CHECK (
    total_items >= 0
    AND completed_items >= 0
    AND failed_items >= 0
    AND completed_items + failed_items <= total_items
  ),
  CONSTRAINT signal_semantic_resolution_run_cost CHECK (
    budget_threshold_usd >= 0
    AND budget_cap_usd >= budget_threshold_usd
    AND estimated_cost_usd >= 0
    AND actual_cost_usd >= 0
    AND input_tokens >= 0
    AND output_tokens >= 0
  ),
  CONSTRAINT signal_semantic_resolution_run_digest CHECK (
    queue_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_resolution_active_workspace
  ON signal_semantic_resolution_runs(workspace_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_signal_semantic_resolution_runs_workspace
  ON signal_semantic_resolution_runs(workspace_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS signal_semantic_resolution_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES signal_semantic_resolution_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  context_hash text NOT NULL,
  decision jsonb,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_semantic_resolution_run_item UNIQUE (run_id, mention_id),
  CONSTRAINT signal_semantic_resolution_item_status CHECK (
    status IN ('pending', 'processing', 'completed', 'failed')
  ),
  CONSTRAINT signal_semantic_resolution_item_attempt CHECK (attempt >= 0),
  CONSTRAINT signal_semantic_resolution_item_context_hash CHECK (
    context_hash ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_resolution_items_pending
  ON signal_semantic_resolution_run_items(run_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_resolution_items_mention
  ON signal_semantic_resolution_run_items(workspace_id, mention_id, created_at DESC);

-- An unattributed result is a final reviewed classification, but it remains
-- explicitly ineligible for serving. This replaces only the 0064 Review
-- function; entity validation and all other Review behavior remain unchanged.
CREATE OR REPLACE FUNCTION review_signal_mention_semantic_assertion(
  target_attribution_id uuid,
  target_reviewer_user_id uuid,
  target_decision text,
  target_approval_source text,
  target_review_policy_key text,
  target_review_policy_version text,
  target_rationale_hash text,
  target_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE assertion signal_mention_attributions%ROWTYPE;
DECLARE existing_event signal_mention_attribution_review_events%ROWTYPE;
DECLARE previous_review text;
DECLARE previous_eligibility text;
DECLARE next_review text;
DECLARE next_eligibility text;
BEGIN
  IF target_reviewer_user_id IS NULL
     OR target_decision NOT IN ('approve', 'reject')
     OR target_approval_source IS NULL
     OR btrim(target_approval_source) = ''
     OR target_review_policy_key IS NULL
     OR target_review_policy_key !~ '^[a-z][a-z0-9-]*$'
     OR target_review_policy_version IS NULL
     OR btrim(target_review_policy_version) = ''
     OR target_rationale_hash IS NULL
     OR target_rationale_hash !~ '^sha256:[0-9a-f]{64}$'
     OR target_idempotency_key IS NULL
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Semantic review contract is invalid.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_attribution_id::text || ':semantic-review', 0
  ));
  SELECT * INTO existing_event
  FROM signal_mention_attribution_review_events event
  WHERE event.idempotency_key = target_idempotency_key;
  IF existing_event.id IS NOT NULL THEN
    IF existing_event.attribution_id IS DISTINCT FROM target_attribution_id
       OR (target_decision = 'approve' AND existing_event.action <> 'approved')
       OR (target_decision = 'reject' AND existing_event.action <> 'rejected')
       OR existing_event.reviewer_user_id IS DISTINCT FROM target_reviewer_user_id
       OR existing_event.review_policy_key IS DISTINCT FROM target_review_policy_key
       OR existing_event.review_policy_version IS DISTINCT FROM target_review_policy_version
       OR existing_event.rationale_hash IS DISTINCT FROM target_rationale_hash THEN
      RAISE EXCEPTION 'Semantic review idempotency key was reused for another assertion.'
        USING ERRCODE = '23514';
    END IF;
    RETURN existing_event.attribution_id;
  END IF;
  SELECT * INTO assertion
  FROM signal_mention_attributions attribution
  WHERE attribution.id = target_attribution_id
  FOR UPDATE;
  IF assertion.id IS NULL
     OR assertion.attribution_basis <> 'mention_semantic'
     OR assertion.is_current = false THEN
    RAISE EXCEPTION 'Only a current semantic assertion can be reviewed.'
      USING ERRCODE = '23514';
  END IF;
  previous_review := assertion.review_status;
  previous_eligibility := assertion.eligibility_status;
  IF target_decision = 'approve' THEN
    PERFORM assert_signal_semantic_entity_contract(
      assertion.workspace_id, assertion.scope, assertion.entity_type, assertion.entity_id
    );
    next_review := 'approved';
    next_eligibility := CASE
      WHEN assertion.scope = 'unattributed' THEN 'not_eligible'
      ELSE 'eligible'
    END;
  ELSE
    next_review := 'rejected';
    next_eligibility := 'not_eligible';
  END IF;
  UPDATE signal_mention_attributions
  SET review_status = next_review,
      eligibility_status = next_eligibility,
      approved_by_user_id = CASE WHEN next_review = 'approved'
        THEN target_reviewer_user_id ELSE NULL END,
      approval_source = CASE WHEN next_review = 'approved'
        THEN target_approval_source ELSE NULL END,
      approved_at = CASE WHEN next_review = 'approved' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = assertion.id;
  INSERT INTO signal_mention_attribution_review_events (
    workspace_id, attribution_id, action,
    previous_review_status, next_review_status,
    previous_eligibility_status, next_eligibility_status,
    reviewer_user_id, review_policy_key, review_policy_version,
    rationale_hash, idempotency_key
  ) VALUES (
    assertion.workspace_id, assertion.id,
    CASE WHEN target_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    previous_review, next_review, previous_eligibility, next_eligibility,
    target_reviewer_user_id, target_review_policy_key, target_review_policy_version,
    target_rationale_hash, target_idempotency_key
  );
  RETURN assertion.id;
END;
$$;
