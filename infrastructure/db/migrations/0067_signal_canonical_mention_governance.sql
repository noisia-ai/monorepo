-- Workspace-native, append-only governance for canonical mention inclusion.
-- This migration does not promote population pointers or alter serving modes.

-- Operational V1 definitions predate contract_version. Treat its absence as
-- the legacy/source-intent contract; SQL NULL must not make both branches
-- ineligible when an inclusion change is reconciled.
CREATE OR REPLACE FUNCTION reconcile_signal_operational_population_mention(
  target_workspace_id uuid,
  target_mention_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE target_population signal_population_definitions%ROWTYPE;
DECLARE target_mention mentions%ROWTYPE;
DECLARE target_brand_id uuid;
DECLARE semantic_contract boolean := false;
DECLARE eligible boolean := false;
DECLARE reason text := 'not_eligible';
BEGIN
  SELECT definition.* INTO target_population
  FROM signal_workspace_population_pointers pointer
  JOIN signal_population_definitions definition
    ON definition.id = pointer.population_id
   AND definition.workspace_id = pointer.workspace_id
  WHERE pointer.workspace_id = target_workspace_id
    AND pointer.purpose = 'operational'
    AND definition.status = 'active';
  IF target_population.id IS NULL THEN RETURN; END IF;
  SELECT workspace.brand_id INTO target_brand_id
  FROM signal_workspaces workspace
  WHERE workspace.id = target_workspace_id;
  semantic_contract := COALESCE(
    target_population.definition->>'contract_version'
      = 'signal-operational-primary-brand-semantic-v2',
    false
  );

  SELECT * INTO target_mention
  FROM mentions mention
  WHERE mention.id = target_mention_id
    AND mention.workspace_id = target_workspace_id
    AND mention.canonical_mention_id = mention.id;
  IF target_mention.id IS NULL THEN RETURN; END IF;

  eligible := target_mention.inclusion_status = target_population.acceptance_status
    AND (
      target_population.min_quality_score IS NULL
      OR COALESCE(target_mention.quality_score, 0) >= target_population.min_quality_score
    )
    AND (
      target_population.period_start IS NULL
      OR target_mention.published_at::date >= target_population.period_start
    )
    AND (
      target_population.period_end IS NULL
      OR target_mention.published_at::date <= target_population.period_end
    )
    AND EXISTS (
      SELECT 1
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id = target_workspace_id
        AND attribution.mention_id = target_mention_id
        AND (
          (
            semantic_contract = false
            AND attribution.attribution_basis = 'source_intent'
            AND attribution.review_status = 'approved'
            AND attribution.scope = ANY(target_population.allowed_scopes)
          )
          OR (
            semantic_contract = true
            AND attribution.attribution_basis = 'mention_semantic'
            AND attribution.is_current = true
            AND attribution.review_status = 'approved'
            AND attribution.eligibility_status = 'eligible'
            AND attribution.scope = 'primary_brand'
            AND attribution.entity_type = 'brand'
            AND attribution.entity_id = target_brand_id
          )
        )
    );

  reason := CASE
    WHEN eligible AND semantic_contract THEN 'semantic_primary_brand_approved_eligible_v2'
    WHEN eligible THEN 'governed_operational_population_v1'
    WHEN target_mention.inclusion_status <> target_population.acceptance_status
      THEN 'mention_acceptance_not_eligible'
    WHEN target_population.min_quality_score IS NOT NULL
      AND COALESCE(target_mention.quality_score, 0) < target_population.min_quality_score
      THEN 'quality_not_eligible'
    WHEN target_population.period_start IS NOT NULL
      AND target_mention.published_at::date < target_population.period_start
      THEN 'period_not_eligible'
    WHEN target_population.period_end IS NOT NULL
      AND target_mention.published_at::date > target_population.period_end
      THEN 'period_not_eligible'
    WHEN semantic_contract THEN 'semantic_assertion_not_eligible'
    ELSE 'scope_or_review_not_eligible'
  END;

  INSERT INTO signal_population_memberships (
    population_id, workspace_id, mention_id, membership_status,
    membership_reason, effective_at, removed_at
  ) VALUES (
    target_population.id, target_workspace_id, target_mention_id,
    CASE WHEN eligible THEN 'included' ELSE 'excluded' END,
    reason, now(), CASE WHEN eligible THEN NULL ELSE now() END
  )
  ON CONFLICT (population_id, mention_id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    membership_status = EXCLUDED.membership_status,
    membership_reason = EXCLUDED.membership_reason,
    effective_at = CASE
      WHEN signal_population_memberships.membership_status
        IS DISTINCT FROM EXCLUDED.membership_status
      THEN now()
      ELSE signal_population_memberships.effective_at
    END,
    removed_at = EXCLUDED.removed_at;
END;
$$;

CREATE TABLE IF NOT EXISTS signal_mention_governance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  action text NOT NULL,
  previous_inclusion_status text NOT NULL,
  next_inclusion_status text NOT NULL,
  previous_exclusion_reason text,
  next_exclusion_reason text,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  reverts_event_id uuid REFERENCES signal_mention_governance_events(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_mention_governance_idempotency
    UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT signal_mention_governance_action CHECK (
    action IN ('include', 'exclude', 'revert', 'send_to_review')
  ),
  CONSTRAINT signal_mention_governance_previous_status CHECK (
    previous_inclusion_status IN ('pending', 'included', 'excluded')
  ),
  CONSTRAINT signal_mention_governance_next_status CHECK (
    next_inclusion_status IN ('pending', 'included', 'excluded')
  ),
  CONSTRAINT signal_mention_governance_reason CHECK (btrim(reason) <> ''),
  CONSTRAINT signal_mention_governance_idempotency_key CHECK (
    idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_mention_governance_exclusion_reason CHECK (
    (next_inclusion_status <> 'excluded')
    OR NULLIF(btrim(next_exclusion_reason), '') IS NOT NULL
  ),
  CONSTRAINT signal_mention_governance_revert_shape CHECK (
    (action = 'revert' AND reverts_event_id IS NOT NULL)
    OR (action <> 'revert' AND reverts_event_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_mention_governance_history
  ON signal_mention_governance_events (workspace_id, mention_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_mention_governance_reverted_event
  ON signal_mention_governance_events (reverts_event_id)
  WHERE reverts_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_signal_mention_governance_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Signal mention governance events are append-only.' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_signal_mention_governance_event
  ON signal_mention_governance_events;
CREATE TRIGGER trg_protect_signal_mention_governance_event
  BEFORE UPDATE OR DELETE ON signal_mention_governance_events
  FOR EACH ROW EXECUTE FUNCTION protect_signal_mention_governance_event();

CREATE OR REPLACE FUNCTION mutate_signal_canonical_mention_governance(
  target_workspace_id uuid,
  target_mention_id uuid,
  target_actor_user_id uuid,
  target_action text,
  target_reason text,
  target_idempotency_key text
)
RETURNS TABLE (
  event_id uuid,
  canonical_mention_id uuid,
  action text,
  inclusion_status text,
  exclusion_reason text,
  was_replayed boolean,
  changed boolean
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE observed mentions%ROWTYPE;
DECLARE root mentions%ROWTYPE;
DECLARE persisted signal_mention_governance_events%ROWTYPE;
DECLARE reverted signal_mention_governance_events%ROWTYPE;
DECLARE next_status text;
DECLARE next_reason text;
BEGIN
  IF target_workspace_id IS NULL
     OR target_mention_id IS NULL
     OR target_actor_user_id IS NULL
     OR target_action NOT IN ('include', 'exclude', 'revert', 'send_to_review')
     OR target_reason IS NULL
     OR btrim(target_reason) = ''
     OR target_idempotency_key IS NULL
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Canonical mention governance contract is invalid.' USING ERRCODE = '23514';
  END IF;
  IF target_action = 'exclude' AND btrim(target_reason) = '' THEN
    RAISE EXCEPTION 'Exclusion requires a governed reason.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':' || target_mention_id::text || ':mention-governance', 0
  ));

  SELECT mention.* INTO observed
  FROM mentions mention
  WHERE mention.id = target_mention_id
    AND mention.workspace_id = target_workspace_id;
  IF observed.id IS NULL THEN
    RAISE EXCEPTION 'Mention does not belong to the requested workspace.' USING ERRCODE = '23514';
  END IF;

  SELECT mention.* INTO root
  FROM mentions mention
  WHERE mention.id = observed.canonical_mention_id
    AND mention.workspace_id = target_workspace_id
    AND mention.canonical_mention_id = mention.id
  FOR UPDATE;
  IF root.id IS NULL THEN
    RAISE EXCEPTION 'Canonical mention root is invalid.' USING ERRCODE = '23514';
  END IF;

  SELECT event.* INTO persisted
  FROM signal_mention_governance_events event
  WHERE event.workspace_id = target_workspace_id
    AND event.idempotency_key = target_idempotency_key;
  IF persisted.id IS NOT NULL THEN
    IF persisted.mention_id IS DISTINCT FROM root.id
       OR persisted.actor_user_id IS DISTINCT FROM target_actor_user_id
       OR persisted.action IS DISTINCT FROM target_action
       OR persisted.reason IS DISTINCT FROM btrim(target_reason) THEN
      RAISE EXCEPTION 'Mention governance idempotency key was reused with incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    event_id := persisted.id;
    canonical_mention_id := persisted.mention_id;
    action := persisted.action;
    inclusion_status := persisted.next_inclusion_status;
    exclusion_reason := persisted.next_exclusion_reason;
    was_replayed := true;
    changed := persisted.previous_inclusion_status IS DISTINCT FROM persisted.next_inclusion_status
      OR persisted.previous_exclusion_reason IS DISTINCT FROM persisted.next_exclusion_reason;
    RETURN NEXT;
    RETURN;
  END IF;

  next_status := root.inclusion_status;
  next_reason := root.exclusion_reason;
  IF target_action = 'include' THEN
    next_status := 'included';
    next_reason := NULL;
  ELSIF target_action = 'exclude' THEN
    next_status := 'excluded';
    next_reason := btrim(target_reason);
  ELSIF target_action = 'revert' THEN
    SELECT candidate.* INTO reverted
    FROM signal_mention_governance_events candidate
    WHERE candidate.workspace_id = target_workspace_id
      AND candidate.mention_id = root.id
      AND candidate.action IN ('include', 'exclude')
      AND NOT EXISTS (
        SELECT 1 FROM signal_mention_governance_events reversal
        WHERE reversal.reverts_event_id = candidate.id
      )
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
    FOR UPDATE;
    IF reverted.id IS NULL THEN
      RAISE EXCEPTION 'No reversible workspace-native mention action exists.' USING ERRCODE = '23514';
    END IF;
    next_status := reverted.previous_inclusion_status;
    next_reason := reverted.previous_exclusion_reason;
  END IF;

  IF root.inclusion_status IS DISTINCT FROM next_status
     OR root.exclusion_reason IS DISTINCT FROM next_reason THEN
    UPDATE mentions
    SET inclusion_status = next_status,
        exclusion_reason = next_reason,
        updated_at = now()
    WHERE id = root.id AND workspace_id = target_workspace_id;
  END IF;

  INSERT INTO signal_mention_governance_events (
    workspace_id, mention_id, action,
    previous_inclusion_status, next_inclusion_status,
    previous_exclusion_reason, next_exclusion_reason,
    actor_user_id, reason, reverts_event_id, idempotency_key
  ) VALUES (
    target_workspace_id, root.id, target_action,
    root.inclusion_status, next_status,
    root.exclusion_reason, next_reason,
    target_actor_user_id, btrim(target_reason), reverted.id, target_idempotency_key
  ) RETURNING * INTO persisted;

  event_id := persisted.id;
  canonical_mention_id := persisted.mention_id;
  action := persisted.action;
  inclusion_status := persisted.next_inclusion_status;
  exclusion_reason := persisted.next_exclusion_reason;
  was_replayed := false;
  changed := persisted.previous_inclusion_status IS DISTINCT FROM persisted.next_inclusion_status
    OR persisted.previous_exclusion_reason IS DISTINCT FROM persisted.next_exclusion_reason;
  RETURN NEXT;
END;
$$;

COMMENT ON TABLE signal_mention_governance_events IS
  'Append-only workspace-native include/exclude/revert/review-request history for canonical mentions.';
COMMENT ON FUNCTION mutate_signal_canonical_mention_governance(uuid,uuid,uuid,text,text,text) IS
  'Resolves aliases to their canonical root and mutates inclusion atomically; existing population triggers reconcile and invalidate serving.';
