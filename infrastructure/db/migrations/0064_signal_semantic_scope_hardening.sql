-- Signal semantic scope hardening (Phase 7A.1).
--
-- This migration is deliberately transitional:
-- - legacy/governed import scope remains available to operational v1 unchanged;
-- - acquisition intent is explicitly non-eligible for semantic serving;
-- - reviewed mention-level semantic assertions feed a draft v2 population only;
-- - no operational pointer is moved and no v1 membership is retired;
-- - new strategic populations and snapshots require approved, eligible semantics.

ALTER TABLE signal_mention_attributions
  ADD COLUMN IF NOT EXISTS attribution_basis text NOT NULL DEFAULT 'source_intent',
  ADD COLUMN IF NOT EXISTS eligibility_status text NOT NULL DEFAULT 'not_eligible',
  ADD COLUMN IF NOT EXISTS evidence_kind text,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS semantic_policy_key text,
  ADD COLUMN IF NOT EXISTS assertion_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_attribution_id uuid,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'signal_mention_attribution_supersedes_fk'
      AND conrelid = 'signal_mention_attributions'::regclass
  ) THEN
    ALTER TABLE signal_mention_attributions
      ADD CONSTRAINT signal_mention_attribution_supersedes_fk
      FOREIGN KEY (supersedes_attribution_id)
      REFERENCES signal_mention_attributions(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'signal_mention_attribution_basis'
      AND conrelid = 'signal_mention_attributions'::regclass
  ) THEN
    ALTER TABLE signal_mention_attributions
      ADD CONSTRAINT signal_mention_attribution_basis
      CHECK (attribution_basis IN ('source_intent', 'mention_semantic'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'signal_mention_attribution_eligibility'
      AND conrelid = 'signal_mention_attributions'::regclass
  ) THEN
    ALTER TABLE signal_mention_attributions
      ADD CONSTRAINT signal_mention_attribution_eligibility
      CHECK (eligibility_status IN ('not_eligible', 'candidate', 'eligible'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'signal_mention_attribution_basis_contract'
      AND conrelid = 'signal_mention_attributions'::regclass
  ) THEN
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
            'governed_rule'
          )
          AND evidence_hash IS NOT NULL
          AND evidence_hash ~ '^sha256:[0-9a-f]{64}$'
          AND idempotency_key IS NOT NULL
          AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'signal_mention_attribution_eligible_contract'
      AND conrelid = 'signal_mention_attributions'::regclass
  ) THEN
    ALTER TABLE signal_mention_attributions
      ADD CONSTRAINT signal_mention_attribution_eligible_contract CHECK (
        eligibility_status <> 'eligible'
        OR (
          attribution_basis = 'mention_semantic'
          AND is_current = true
          AND review_status = 'approved'
          AND confidence IS NOT NULL
          AND approved_by_user_id IS NOT NULL
          AND approval_source IS NOT NULL
          AND approved_at IS NOT NULL
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'signal_mention_attribution_candidate_contract'
      AND conrelid = 'signal_mention_attributions'::regclass
  ) THEN
    ALTER TABLE signal_mention_attributions
      ADD CONSTRAINT signal_mention_attribution_candidate_contract CHECK (
        eligibility_status <> 'candidate'
        OR (attribution_basis = 'mention_semantic' AND review_status = 'pending')
      );
  END IF;
END;
$$;

DROP INDEX IF EXISTS uq_signal_mention_attribution_provenance;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_mention_source_intent_provenance
  ON signal_mention_attributions (
    mention_id,
    data_source_id,
    COALESCE(import_batch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    scope,
    entity_type,
    COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE attribution_basis = 'source_intent';
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_mention_semantic_idempotency
  ON signal_mention_attributions (workspace_id, idempotency_key)
  WHERE attribution_basis = 'mention_semantic';
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_mention_semantic_version
  ON signal_mention_attributions (
    mention_id,
    semantic_policy_key,
    assertion_version
  )
  WHERE attribution_basis = 'mention_semantic';
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_mention_semantic_current
  ON signal_mention_attributions (
    mention_id,
    scope,
    entity_type,
    COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    semantic_policy_key
  )
  WHERE attribution_basis = 'mention_semantic' AND is_current = true;
CREATE INDEX IF NOT EXISTS idx_signal_mention_semantic_eligible
  ON signal_mention_attributions (
    workspace_id, scope, entity_type, entity_id, mention_id
  )
  WHERE attribution_basis = 'mention_semantic'
    AND is_current = true
    AND review_status = 'approved'
    AND eligibility_status = 'eligible';

CREATE TABLE IF NOT EXISTS signal_mention_attribution_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  attribution_id uuid NOT NULL REFERENCES signal_mention_attributions(id) ON DELETE RESTRICT,
  action text NOT NULL,
  previous_review_status text NOT NULL,
  next_review_status text NOT NULL,
  previous_eligibility_status text NOT NULL,
  next_eligibility_status text NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_policy_key text NOT NULL,
  review_policy_version text NOT NULL,
  rationale_hash text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_mention_attribution_review_action
    CHECK (action IN ('approved', 'rejected', 'superseded')),
  CONSTRAINT signal_mention_attribution_review_states CHECK (
    previous_review_status IN ('pending', 'approved', 'rejected')
    AND next_review_status IN ('pending', 'approved', 'rejected')
    AND previous_eligibility_status IN ('not_eligible', 'candidate', 'eligible')
    AND next_eligibility_status IN ('not_eligible', 'candidate', 'eligible')
  ),
  CONSTRAINT signal_mention_attribution_review_policy_key
    CHECK (review_policy_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_mention_attribution_review_policy_version
    CHECK (btrim(review_policy_version) <> ''),
  CONSTRAINT signal_mention_attribution_review_rationale_hash
    CHECK (rationale_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT signal_mention_attribution_review_idempotency_key
    CHECK (idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT uq_signal_mention_attribution_review_idempotency
    UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_signal_mention_attribution_review_events_assertion
  ON signal_mention_attribution_review_events (attribution_id, created_at, id);

CREATE OR REPLACE FUNCTION prevent_signal_attribution_review_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Signal mention attribution review events are append-only.'
    USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_attribution_review_events_append_only
  ON signal_mention_attribution_review_events;
CREATE TRIGGER trg_signal_attribution_review_events_append_only
  BEFORE UPDATE OR DELETE ON signal_mention_attribution_review_events
  FOR EACH ROW EXECUTE FUNCTION prevent_signal_attribution_review_event_mutation();

CREATE OR REPLACE FUNCTION assert_signal_semantic_entity_contract(
  target_workspace_id uuid,
  target_scope text,
  target_entity_type text,
  target_entity_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE target_brand_id uuid;
BEGIN
  SELECT workspace.brand_id INTO target_brand_id
  FROM signal_workspaces workspace
  WHERE workspace.id = target_workspace_id;
  IF target_brand_id IS NULL THEN
    RAISE EXCEPTION 'Semantic assertion workspace is not active or has no brand.'
      USING ERRCODE = '23514';
  END IF;
  IF target_scope = 'primary_brand' THEN
    IF target_entity_type <> 'brand' OR target_entity_id IS DISTINCT FROM target_brand_id THEN
      RAISE EXCEPTION 'Semantic primary-brand assertion must identify the workspace brand.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF target_scope = 'competitor' THEN
    IF target_entity_type <> 'competitor' OR target_entity_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM competitors competitor
      WHERE competitor.id = target_entity_id
        AND competitor.brand_id = target_brand_id
    ) THEN
      RAISE EXCEPTION 'Semantic competitor assertion requires a governed workspace competitor.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF target_scope = 'category' THEN
    IF target_entity_type <> 'category' OR target_entity_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM intelligence_entities entity
      WHERE entity.id = target_entity_id
        AND entity.brand_id = target_brand_id
        AND entity.entity_type = 'category'
        AND entity.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Semantic category assertion requires a governed workspace category.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF target_scope = 'reference' THEN
    IF target_entity_type <> 'reference' THEN
      RAISE EXCEPTION 'Semantic reference assertion has an invalid entity type.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF target_scope = 'unattributed' THEN
    IF target_entity_type <> 'unattributed' OR target_entity_id IS NOT NULL THEN
      RAISE EXCEPTION 'Unattributed semantics cannot claim a governed entity.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported semantic assertion scope.' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_semantic_attribution_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE superseded signal_mention_attributions%ROWTYPE;
BEGIN
  IF NEW.attribution_basis = 'source_intent' THEN
    IF NEW.eligibility_status <> 'not_eligible' THEN
      RAISE EXCEPTION 'Source intent can never be semantically eligible.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM assert_signal_semantic_entity_contract(
    NEW.workspace_id, NEW.scope, NEW.entity_type, NEW.entity_id
  );
  IF NEW.scope = 'unattributed' AND NEW.eligibility_status = 'eligible' THEN
    RAISE EXCEPTION 'Unattributed assertions cannot enter serving.' USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_attribution_id IS NOT NULL THEN
    SELECT * INTO superseded
    FROM signal_mention_attributions attribution
    WHERE attribution.id = NEW.supersedes_attribution_id;
    IF superseded.id IS NULL
       OR superseded.attribution_basis <> 'mention_semantic'
       OR superseded.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR superseded.mention_id IS DISTINCT FROM NEW.mention_id
       OR superseded.semantic_policy_key IS DISTINCT FROM NEW.semantic_policy_key
       OR superseded.assertion_version >= NEW.assertion_version THEN
      RAISE EXCEPTION 'Semantic supersession must reference an older assertion for the same subject and policy.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_semantic_attribution_contract
  ON signal_mention_attributions;
CREATE TRIGGER trg_signal_semantic_attribution_contract
  BEFORE INSERT OR UPDATE OF attribution_basis, eligibility_status, scope,
    entity_type, entity_id, workspace_id, mention_id, semantic_policy_key,
    assertion_version, supersedes_attribution_id, is_current
  ON signal_mention_attributions FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_semantic_attribution_contract();

CREATE OR REPLACE FUNCTION create_signal_mention_semantic_assertion(
  target_workspace_id uuid,
  target_mention_id uuid,
  target_data_source_id uuid,
  target_import_batch_id uuid,
  target_scope text,
  target_entity_type text,
  target_entity_id uuid,
  target_entity_label text,
  target_confidence numeric,
  target_evidence_kind text,
  target_evidence_hash text,
  target_policy_key text,
  target_policy_version text,
  target_model_version text,
  target_idempotency_key text,
  target_supersedes_attribution_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE persisted signal_mention_attributions%ROWTYPE;
DECLARE next_version integer;
BEGIN
  IF target_idempotency_key IS NULL
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_evidence_hash IS NULL
     OR target_evidence_hash !~ '^sha256:[0-9a-f]{64}$'
     OR target_evidence_kind IS NULL
     OR target_evidence_kind NOT IN (
       'explicit_primary_brand',
       'explicit_competitor_with_resolved_identity',
       'explicit_category',
       'multi_entity',
       'human_reviewed_context',
       'governed_rule'
     )
     OR target_policy_key IS NULL
     OR target_policy_key !~ '^[a-z][a-z0-9-]*$'
     OR target_policy_version IS NULL
     OR btrim(target_policy_version) = ''
     OR target_confidence IS NULL OR target_confidence < 0 OR target_confidence > 1 THEN
    RAISE EXCEPTION 'Semantic assertion contract is invalid.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':' || target_mention_id::text || ':'
      || target_policy_key || ':semantic-assertion', 0
  ));
  SELECT * INTO persisted
  FROM signal_mention_attributions attribution
  WHERE attribution.workspace_id = target_workspace_id
    AND attribution.attribution_basis = 'mention_semantic'
    AND attribution.idempotency_key = target_idempotency_key
  FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.mention_id IS DISTINCT FROM target_mention_id
       OR persisted.scope IS DISTINCT FROM target_scope
       OR persisted.entity_type IS DISTINCT FROM target_entity_type
       OR persisted.entity_id IS DISTINCT FROM target_entity_id
       OR persisted.semantic_policy_key IS DISTINCT FROM target_policy_key
       OR persisted.policy_version IS DISTINCT FROM target_policy_version
       OR persisted.evidence_hash IS DISTINCT FROM target_evidence_hash THEN
      RAISE EXCEPTION 'Semantic assertion idempotency key was reused with incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    RETURN persisted.id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM mentions mention
    WHERE mention.id = target_mention_id
      AND mention.workspace_id = target_workspace_id
      AND mention.canonical_mention_id = mention.id
  ) OR NOT EXISTS (
    SELECT 1 FROM data_sources source
    WHERE source.id = target_data_source_id
      AND source.workspace_id = target_workspace_id
  ) OR (
    target_import_batch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM import_batches batch
      WHERE batch.id = target_import_batch_id
        AND batch.workspace_id = target_workspace_id
        AND batch.data_source_id = target_data_source_id
    )
  ) THEN
    RAISE EXCEPTION 'Semantic assertion provenance cannot cross workspace or canonical identity.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM assert_signal_semantic_entity_contract(
    target_workspace_id, target_scope, target_entity_type, target_entity_id
  );
  IF target_supersedes_attribution_id IS NULL AND EXISTS (
    SELECT 1 FROM signal_mention_attributions attribution
    WHERE attribution.mention_id = target_mention_id
      AND attribution.scope = target_scope
      AND attribution.entity_type = target_entity_type
      AND attribution.entity_id IS NOT DISTINCT FROM target_entity_id
      AND attribution.semantic_policy_key = target_policy_key
      AND attribution.attribution_basis = 'mention_semantic'
      AND attribution.is_current = true
  ) THEN
    RAISE EXCEPTION 'A current semantic assertion already exists; use supersession.'
      USING ERRCODE = '23505';
  END IF;
  SELECT COALESCE(max(attribution.assertion_version), 0) + 1 INTO next_version
  FROM signal_mention_attributions attribution
  WHERE attribution.mention_id = target_mention_id
    AND attribution.semantic_policy_key = target_policy_key
    AND attribution.attribution_basis = 'mention_semantic';
  INSERT INTO signal_mention_attributions (
    workspace_id, mention_id, data_source_id, import_batch_id,
    scope, entity_type, entity_id, entity_label, confidence,
    review_status, attribution_source, policy_version, model_version,
    attribution_basis, eligibility_status, evidence_kind, evidence_hash,
    semantic_policy_key, assertion_version, supersedes_attribution_id,
    is_current, idempotency_key
  ) VALUES (
    target_workspace_id, target_mention_id, target_data_source_id, target_import_batch_id,
    target_scope, target_entity_type, target_entity_id, target_entity_label, target_confidence,
    'pending', 'mention_semantic', target_policy_version, target_model_version,
    'mention_semantic', 'candidate', target_evidence_kind, target_evidence_hash,
    target_policy_key, next_version, target_supersedes_attribution_id,
    true, target_idempotency_key
  ) RETURNING * INTO persisted;
  RETURN persisted.id;
END;
$$;

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
    IF assertion.scope = 'unattributed' THEN
      RAISE EXCEPTION 'Unattributed assertions cannot be approved for serving.'
        USING ERRCODE = '23514';
    END IF;
    PERFORM assert_signal_semantic_entity_contract(
      assertion.workspace_id, assertion.scope, assertion.entity_type, assertion.entity_id
    );
    next_review := 'approved';
    next_eligibility := 'eligible';
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

CREATE OR REPLACE FUNCTION supersede_signal_mention_semantic_assertion(
  target_attribution_id uuid,
  target_reviewer_user_id uuid,
  target_scope text,
  target_entity_type text,
  target_entity_id uuid,
  target_entity_label text,
  target_confidence numeric,
  target_evidence_kind text,
  target_evidence_hash text,
  target_policy_version text,
  target_model_version text,
  target_assertion_idempotency_key text,
  target_review_policy_key text,
  target_review_policy_version text,
  target_rationale_hash text,
  target_review_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE current_assertion signal_mention_attributions%ROWTYPE;
DECLARE existing_event signal_mention_attribution_review_events%ROWTYPE;
DECLARE created_id uuid;
BEGIN
  IF target_reviewer_user_id IS NULL
     OR target_assertion_idempotency_key IS NULL
     OR target_assertion_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_review_idempotency_key IS NULL
     OR target_review_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_rationale_hash IS NULL
     OR target_rationale_hash !~ '^sha256:[0-9a-f]{64}$'
     OR target_review_policy_key IS NULL
     OR target_review_policy_key !~ '^[a-z][a-z0-9-]*$'
     OR target_review_policy_version IS NULL
     OR btrim(target_review_policy_version) = '' THEN
    RAISE EXCEPTION 'Semantic supersession contract is invalid.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_attribution_id::text || ':semantic-supersession', 0
  ));
  SELECT * INTO existing_event
  FROM signal_mention_attribution_review_events event
  WHERE event.idempotency_key = target_review_idempotency_key;
  IF existing_event.id IS NOT NULL THEN
    IF existing_event.action <> 'superseded'
       OR existing_event.attribution_id IS DISTINCT FROM target_attribution_id
       OR existing_event.reviewer_user_id IS DISTINCT FROM target_reviewer_user_id
       OR existing_event.review_policy_key IS DISTINCT FROM target_review_policy_key
       OR existing_event.review_policy_version IS DISTINCT FROM target_review_policy_version
       OR existing_event.rationale_hash IS DISTINCT FROM target_rationale_hash THEN
      RAISE EXCEPTION 'Semantic supersession idempotency key was reused with incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    SELECT attribution.id INTO created_id
    FROM signal_mention_attributions attribution
    WHERE attribution.supersedes_attribution_id = target_attribution_id
      AND attribution.idempotency_key = target_assertion_idempotency_key;
    IF created_id IS NULL THEN
      RAISE EXCEPTION 'Semantic supersession idempotency state is inconsistent.'
        USING ERRCODE = '23514';
    END IF;
    RETURN created_id;
  END IF;
  SELECT * INTO current_assertion
  FROM signal_mention_attributions attribution
  WHERE attribution.id = target_attribution_id
  FOR UPDATE;
  IF current_assertion.id IS NULL
     OR current_assertion.attribution_basis <> 'mention_semantic'
     OR current_assertion.is_current = false THEN
    RAISE EXCEPTION 'Only a current semantic assertion can be superseded.'
      USING ERRCODE = '23514';
  END IF;
  UPDATE signal_mention_attributions
  SET is_current = false,
      eligibility_status = 'not_eligible',
      updated_at = now()
  WHERE id = current_assertion.id;
  created_id := create_signal_mention_semantic_assertion(
    current_assertion.workspace_id,
    current_assertion.mention_id,
    current_assertion.data_source_id,
    current_assertion.import_batch_id,
    target_scope,
    target_entity_type,
    target_entity_id,
    target_entity_label,
    target_confidence,
    target_evidence_kind,
    target_evidence_hash,
    current_assertion.semantic_policy_key,
    target_policy_version,
    target_model_version,
    target_assertion_idempotency_key,
    current_assertion.id
  );
  INSERT INTO signal_mention_attribution_review_events (
    workspace_id, attribution_id, action,
    previous_review_status, next_review_status,
    previous_eligibility_status, next_eligibility_status,
    reviewer_user_id, review_policy_key, review_policy_version,
    rationale_hash, idempotency_key
  ) VALUES (
    current_assertion.workspace_id, current_assertion.id, 'superseded',
    current_assertion.review_status, current_assertion.review_status,
    current_assertion.eligibility_status, 'not_eligible',
    target_reviewer_user_id, target_review_policy_key, target_review_policy_version,
    target_rationale_hash, target_review_idempotency_key
  );
  RETURN created_id;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_signal_semantic_candidate_membership_digest(
  target_population_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE computed_digest text;
BEGIN
  SELECT 'sha256:' || encode(sha256(convert_to(
    COALESCE(string_agg(membership.mention_id::text, ',' ORDER BY membership.mention_id), ''),
    'UTF8'
  )), 'hex') INTO computed_digest
  FROM signal_population_memberships membership
  WHERE membership.population_id = target_population_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL;
  UPDATE signal_population_definitions
  SET membership_digest = computed_digest,
      updated_at = now()
  WHERE id = target_population_id
    AND purpose = 'operational'
    AND status = 'draft'
    AND definition->>'contract_version' = 'signal-operational-primary-brand-semantic-v2';
  RETURN computed_digest;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_signal_operational_semantic_candidate_v2(
  target_workspace_id uuid,
  target_created_by_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE persisted signal_population_definitions%ROWTYPE;
DECLARE next_version integer;
DECLARE candidate_hash text;
DECLARE empty_digest text := 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':primary-brand-semantic-v2', 0
  ));
  IF NOT EXISTS (
    SELECT 1 FROM signal_workspaces workspace
    WHERE workspace.id = target_workspace_id AND workspace.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Operational semantic candidate requires an active workspace.'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO persisted
  FROM signal_population_definitions definition
  WHERE definition.workspace_id = target_workspace_id
    AND definition.population_key = 'primary-brand-operational'
    AND definition.purpose = 'operational'
    AND definition.status = 'draft'
    AND definition.definition->>'contract_version'
      = 'signal-operational-primary-brand-semantic-v2'
  ORDER BY definition.version DESC
  LIMIT 1
  FOR UPDATE;
  IF persisted.id IS NOT NULL THEN RETURN persisted.id; END IF;
  SELECT COALESCE(max(definition.version), 0) + 1 INTO next_version
  FROM signal_population_definitions definition
  WHERE definition.workspace_id = target_workspace_id
    AND definition.population_key = 'primary-brand-operational';
  candidate_hash := 'sha256:' || encode(sha256(convert_to(concat_ws('|',
    'signal-operational-primary-brand-semantic-v2',
    target_workspace_id::text,
    next_version::text,
    'primary-brand-semantic',
    '1'
  ), 'UTF8')), 'hex');
  INSERT INTO signal_population_definitions (
    workspace_id, population_key, version, purpose, status,
    acceptance_status, allowed_scopes, definition_hash,
    created_by_user_id, policy_key, policy_version, timezone,
    membership_digest, definition
  )
  SELECT
    workspace.id, 'primary-brand-operational', next_version, 'operational', 'draft',
    'included', ARRAY['primary_brand']::text[], candidate_hash,
    target_created_by_user_id, 'primary-brand-semantic', '1', workspace.timezone,
    empty_digest, jsonb_build_object(
      'contract_version', 'signal-operational-primary-brand-semantic-v2',
      'canonical_only', true,
      'attribution_basis', 'mention_semantic',
      'attribution_review_status', 'approved',
      'eligibility_status', 'eligible',
      'allowed_scopes', jsonb_build_array('primary_brand'),
      'promotion_state', 'candidate_not_promoted'
    )
  FROM signal_workspaces workspace
  WHERE workspace.id = target_workspace_id
  RETURNING * INTO persisted;
  RETURN persisted.id;
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_signal_semantic_candidate_population_mention(
  target_workspace_id uuid,
  target_mention_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE candidate record;
DECLARE target_mention mentions%ROWTYPE;
DECLARE eligible boolean;
DECLARE reason text;
BEGIN
  SELECT * INTO target_mention
  FROM mentions mention
  WHERE mention.id = target_mention_id
    AND mention.workspace_id = target_workspace_id
    AND mention.canonical_mention_id = mention.id;
  IF target_mention.id IS NULL THEN RETURN; END IF;
  FOR candidate IN
    SELECT definition.id, workspace.brand_id
    FROM signal_population_definitions definition
    JOIN signal_workspaces workspace ON workspace.id = definition.workspace_id
    WHERE definition.workspace_id = target_workspace_id
      AND definition.population_key = 'primary-brand-operational'
      AND definition.purpose = 'operational'
      AND definition.status = 'draft'
      AND definition.definition->>'contract_version'
        = 'signal-operational-primary-brand-semantic-v2'
  LOOP
    eligible := target_mention.inclusion_status = 'included'
      AND EXISTS (
        SELECT 1
        FROM signal_mention_attributions attribution
        WHERE attribution.workspace_id = target_workspace_id
          AND attribution.mention_id = target_mention_id
          AND attribution.attribution_basis = 'mention_semantic'
          AND attribution.is_current = true
          AND attribution.review_status = 'approved'
          AND attribution.eligibility_status = 'eligible'
          AND attribution.scope = 'primary_brand'
          AND attribution.entity_type = 'brand'
          AND attribution.entity_id = candidate.brand_id
      );
    reason := CASE
      WHEN eligible THEN 'semantic_primary_brand_approved_eligible_v2'
      WHEN target_mention.inclusion_status <> 'included' THEN 'mention_acceptance_not_eligible'
      ELSE 'semantic_assertion_not_eligible'
    END;
    IF eligible OR EXISTS (
      SELECT 1 FROM signal_population_memberships membership
      WHERE membership.population_id = candidate.id
        AND membership.mention_id = target_mention_id
    ) THEN
      INSERT INTO signal_population_memberships (
        population_id, workspace_id, mention_id, membership_status,
        membership_reason, effective_at, removed_at
      ) VALUES (
        candidate.id, target_workspace_id, target_mention_id,
        CASE WHEN eligible THEN 'included' ELSE 'excluded' END,
        reason, now(), CASE WHEN eligible THEN NULL ELSE now() END
      )
      ON CONFLICT (population_id, mention_id) DO UPDATE SET
        membership_status = EXCLUDED.membership_status,
        membership_reason = EXCLUDED.membership_reason,
        effective_at = CASE
          WHEN signal_population_memberships.membership_status
            IS DISTINCT FROM EXCLUDED.membership_status
          THEN now() ELSE signal_population_memberships.effective_at END,
        removed_at = EXCLUDED.removed_at;
    END IF;
    PERFORM refresh_signal_semantic_candidate_membership_digest(candidate.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_signal_semantic_candidate_population(
  target_workspace_id uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE candidate record;
DECLARE reconciled_count integer := 0;
BEGIN
  FOR candidate IN
    SELECT mention.id FROM mentions mention
    WHERE mention.workspace_id = target_workspace_id
      AND mention.canonical_mention_id = mention.id
  LOOP
    PERFORM reconcile_signal_semantic_candidate_population_mention(
      target_workspace_id, candidate.id
    );
    reconciled_count := reconciled_count + 1;
  END LOOP;
  RETURN reconciled_count;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_signal_semantic_candidate_after_workspace_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ensure_signal_operational_semantic_candidate_v2(NEW.id, NULL);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_semantic_candidate_workspace_insert ON signal_workspaces;
CREATE TRIGGER trg_signal_semantic_candidate_workspace_insert
  AFTER INSERT ON signal_workspaces FOR EACH ROW
  EXECUTE FUNCTION ensure_signal_semantic_candidate_after_workspace_insert();

DO $$
DECLARE workspace record;
BEGIN
  FOR workspace IN
    SELECT id FROM signal_workspaces WHERE status = 'active' ORDER BY id
  LOOP
    PERFORM ensure_signal_operational_semantic_candidate_v2(workspace.id, NULL);
  END LOOP;
END;
$$;

-- The current v1 pointer remains driven only by the source-intent rows that
-- already defined its visible contract. Semantic assertions cannot leak into
-- v1 if another mention/source lifecycle event causes a later reconciliation.
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
  SELECT definition.*
  INTO target_population
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
  semantic_contract := target_population.definition->>'contract_version'
    = 'signal-operational-primary-brand-semantic-v2';

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
    target_population.id,
    target_workspace_id,
    target_mention_id,
    CASE WHEN eligible THEN 'included' ELSE 'excluded' END,
    reason,
    now(),
    CASE WHEN eligible THEN NULL ELSE now() END
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

-- New imports preserve the source/query intent, but never manufacture a
-- client-safe semantic assertion. Operational v1 still observes these legacy
-- fields during the controlled transition; v2 ignores them by contract.
CREATE OR REPLACE FUNCTION record_signal_mention_import_provenance(
  target_mention_id uuid,
  target_import_batch_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE target_mention mentions%ROWTYPE;
DECLARE target_batch import_batches%ROWTYPE;
DECLARE target_source data_sources%ROWTYPE;
DECLARE target_workspace signal_workspaces%ROWTYPE;
DECLARE resolved_scope text;
DECLARE resolved_entity_type text;
DECLARE resolved_entity_id uuid;
DECLARE resolved_review_status text;
DECLARE persisted_attribution_id uuid;
BEGIN
  SELECT * INTO target_mention
  FROM mentions mention
  WHERE mention.id = target_mention_id
    AND mention.canonical_mention_id = mention.id;
  SELECT * INTO target_batch FROM import_batches WHERE id = target_import_batch_id;
  SELECT * INTO target_source FROM data_sources WHERE id = target_batch.data_source_id;
  SELECT * INTO target_workspace FROM signal_workspaces WHERE id = target_batch.workspace_id;
  IF target_mention.id IS NULL OR target_batch.id IS NULL OR target_source.id IS NULL
     OR target_mention.workspace_id IS DISTINCT FROM target_batch.workspace_id
     OR target_source.workspace_id IS DISTINCT FROM target_batch.workspace_id THEN
    RAISE EXCEPTION 'Mention import provenance cannot cross workspaces.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO signal_mention_import_memberships (
    workspace_id, mention_id, import_batch_id, data_source_id
  ) VALUES (
    target_batch.workspace_id, target_mention.id, target_batch.id, target_source.id
  ) ON CONFLICT (mention_id, import_batch_id) DO NOTHING;

  IF target_batch.contributed_by_study_corpus_id IS NOT NULL THEN
    INSERT INTO signal_mention_study_memberships (
      workspace_id, mention_id, study_corpus_id, import_batch_id, membership_role
    ) VALUES (
      target_batch.workspace_id,
      target_mention.id,
      target_batch.contributed_by_study_corpus_id,
      target_batch.id,
      'contributed'
    ) ON CONFLICT DO NOTHING;
  END IF;

  resolved_scope := COALESCE(target_source.governed_scope, CASE
    WHEN target_batch.mention_type = 'brand' OR target_batch.entity_kind = 'primary_brand' THEN 'primary_brand'
    WHEN target_batch.mention_type = 'competitor'
      OR target_batch.entity_kind IN ('competitor', 'competitor_pool') THEN 'competitor'
    WHEN target_batch.mention_type = 'industry' OR target_batch.entity_kind = 'category' THEN 'category'
    WHEN target_batch.entity_kind = 'reference' THEN 'reference'
    ELSE 'unattributed'
  END);
  resolved_entity_type := COALESCE(target_source.governed_entity_type, CASE resolved_scope
    WHEN 'primary_brand' THEN 'brand'
    WHEN 'competitor' THEN 'competitor'
    WHEN 'category' THEN 'category'
    WHEN 'reference' THEN 'reference'
    ELSE 'unattributed'
  END);
  resolved_entity_id := COALESCE(target_source.governed_entity_id, CASE resolved_scope
    WHEN 'primary_brand' THEN target_workspace.brand_id
    WHEN 'competitor' THEN target_batch.competitor_id
    ELSE NULL
  END);
  resolved_review_status := CASE
    WHEN target_source.governed_scope IS NULL THEN 'approved'
    ELSE target_source.scope_review_status
  END;

  INSERT INTO signal_mention_attributions (
    workspace_id, mention_id, data_source_id, import_batch_id,
    scope, entity_type, entity_id, entity_label, confidence,
    review_status, attribution_source, policy_version,
    approved_by_user_id, approval_source, approved_at,
    attribution_basis, eligibility_status
  ) VALUES (
    target_batch.workspace_id,
    target_mention.id,
    target_source.id,
    target_batch.id,
    resolved_scope,
    resolved_entity_type,
    resolved_entity_id,
    COALESCE(target_batch.entity_label, target_source.name),
    1.0000,
    resolved_review_status,
    CASE WHEN target_source.governed_scope IS NULL
      THEN 'legacy_import_batch' ELSE 'governed_data_source' END,
    COALESCE(target_source.scope_policy_version, 'workspace-scope-legacy-v1'),
    CASE WHEN resolved_review_status = 'approved'
      THEN target_source.scope_approved_by_user_id END,
    CASE WHEN resolved_review_status = 'approved'
      THEN COALESCE(target_source.scope_approval_source, 'legacy_import_scope') END,
    CASE WHEN resolved_review_status = 'approved'
      THEN COALESCE(target_source.scope_approved_at, now()) END,
    'source_intent',
    'not_eligible'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO persisted_attribution_id;

  IF persisted_attribution_id IS NULL THEN
    SELECT attribution.id INTO persisted_attribution_id
    FROM signal_mention_attributions attribution
    WHERE attribution.mention_id = target_mention.id
      AND attribution.data_source_id = target_source.id
      AND attribution.import_batch_id = target_batch.id
      AND attribution.scope = resolved_scope
      AND attribution.entity_type = resolved_entity_type
      AND attribution.entity_id IS NOT DISTINCT FROM resolved_entity_id
      AND attribution.attribution_basis = 'source_intent'
    LIMIT 1;
  END IF;
  PERFORM reconcile_signal_operational_population_mention(
    target_batch.workspace_id, target_mention.id
  );
  RETURN persisted_attribution_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_signal_source_governance_to_attributions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.governed_scope IS NULL THEN RETURN NEW; END IF;
  UPDATE signal_mention_attributions attribution
  SET scope = NEW.governed_scope,
      entity_type = NEW.governed_entity_type,
      entity_id = NEW.governed_entity_id,
      entity_label = COALESCE(attribution.entity_label, NEW.name),
      review_status = NEW.scope_review_status,
      policy_version = COALESCE(NEW.scope_policy_version, attribution.policy_version),
      approved_by_user_id = CASE WHEN NEW.scope_review_status = 'approved'
        THEN NEW.scope_approved_by_user_id ELSE NULL END,
      approval_source = CASE WHEN NEW.scope_review_status = 'approved'
        THEN NEW.scope_approval_source ELSE NULL END,
      approved_at = CASE WHEN NEW.scope_review_status = 'approved'
        THEN NEW.scope_approved_at ELSE NULL END,
      eligibility_status = 'not_eligible',
      updated_at = now()
  WHERE attribution.data_source_id = NEW.id
    AND attribution.attribution_source = 'governed_data_source'
    AND attribution.attribution_basis = 'source_intent';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_signal_population_after_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.attribution_basis = 'source_intent' THEN
      PERFORM reconcile_signal_operational_population_mention(
        OLD.workspace_id, OLD.mention_id
      );
    ELSE
      PERFORM reconcile_signal_semantic_candidate_population_mention(
        OLD.workspace_id, OLD.mention_id
      );
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    OR OLD.mention_id IS DISTINCT FROM NEW.mention_id
    OR OLD.attribution_basis IS DISTINCT FROM NEW.attribution_basis
  ) THEN
    IF OLD.attribution_basis = 'source_intent' THEN
      PERFORM reconcile_signal_operational_population_mention(
        OLD.workspace_id, OLD.mention_id
      );
    ELSE
      PERFORM reconcile_signal_semantic_candidate_population_mention(
        OLD.workspace_id, OLD.mention_id
      );
    END IF;
  END IF;
  IF NEW.attribution_basis = 'source_intent' THEN
    PERFORM reconcile_signal_operational_population_mention(
      NEW.workspace_id, NEW.mention_id
    );
  ELSE
    PERFORM reconcile_signal_semantic_candidate_population_mention(
      NEW.workspace_id, NEW.mention_id
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_attribution_population_reconcile
  ON signal_mention_attributions;
CREATE TRIGGER trg_signal_attribution_population_reconcile
  AFTER INSERT OR DELETE OR UPDATE OF scope, review_status, workspace_id,
    mention_id, attribution_basis, eligibility_status, entity_type, entity_id,
    is_current
  ON signal_mention_attributions FOR EACH ROW
  EXECUTE FUNCTION reconcile_signal_population_after_attribution();

CREATE OR REPLACE FUNCTION sync_signal_mention_governance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.canonical_mention_id <> NEW.id THEN RETURN NEW; END IF;
  IF NEW.source_file_id IS NOT NULL THEN
    PERFORM record_signal_mention_import_provenance(NEW.id, NEW.source_file_id);
  END IF;
  PERFORM reconcile_signal_operational_population_mention(NEW.workspace_id, NEW.id);
  PERFORM reconcile_signal_semantic_candidate_population_mention(NEW.workspace_id, NEW.id);
  RETURN NEW;
END;
$$;

-- Strategic populations created after 0064 are semantic-only. Existing
-- populations, snapshots, analyses, releases and published compatibility rows
-- remain immutable and readable.
CREATE OR REPLACE FUNCTION create_signal_tb_analysis_population(
  target_workspace_id uuid,
  target_report_key text,
  target_period_start date,
  target_period_end date,
  target_timezone text,
  target_policy_key text,
  target_policy_version text,
  target_created_by_user_id uuid,
  target_idempotency_key text
)
RETURNS TABLE (
  population_id uuid,
  population_version integer,
  definition_hash text,
  membership_digest text,
  mention_count integer
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE persisted signal_population_definitions%ROWTYPE;
DECLARE workspace_timezone text;
DECLARE workspace_brand_id uuid;
DECLARE next_version integer;
DECLARE computed_membership_digest text;
DECLARE computed_definition_hash text;
DECLARE computed_count integer;
BEGIN
  IF target_report_key <> 'triggers-barriers'
     OR target_policy_key <> 'primary-brand-analysis'
     OR target_policy_version <> '1' THEN
    RAISE EXCEPTION 'Unsupported strategic population policy.' USING ERRCODE = '23514';
  END IF;
  IF target_period_start IS NULL OR target_period_end IS NULL
     OR target_period_start > target_period_end THEN
    RAISE EXCEPTION 'Strategic population period is invalid.' USING ERRCODE = '23514';
  END IF;
  IF target_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Strategic population idempotency key is invalid.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':' || target_report_key || ':population', 0
  ));
  SELECT workspace.timezone, workspace.brand_id
  INTO workspace_timezone, workspace_brand_id
  FROM signal_workspaces workspace
  JOIN signal_workspace_reports report
    ON report.workspace_id = workspace.id
   AND report.report_key = target_report_key
   AND report.status = 'active'
  WHERE workspace.id = target_workspace_id AND workspace.status = 'active'
  FOR SHARE OF workspace, report;
  IF workspace_timezone IS NULL OR workspace_timezone <> target_timezone THEN
    RAISE EXCEPTION 'Strategic population timezone must match the active workspace.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = target_timezone) THEN
    RAISE EXCEPTION 'Strategic population timezone is not recognized by PostgreSQL.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO persisted
  FROM signal_population_definitions definition
  WHERE definition.workspace_id = target_workspace_id
    AND definition.purpose = 'analysis'
    AND definition.idempotency_key = target_idempotency_key
  FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.population_key <> 'triggers-barriers-analysis'
       OR persisted.period_start IS DISTINCT FROM target_period_start
       OR persisted.period_end IS DISTINCT FROM target_period_end
       OR persisted.timezone IS DISTINCT FROM target_timezone
       OR persisted.policy_key IS DISTINCT FROM target_policy_key
       OR persisted.policy_version IS DISTINCT FROM target_policy_version
       OR persisted.definition->>'contract_version'
          IS DISTINCT FROM 'signal-tb-analysis-population-semantic-v2'
       OR persisted.definition->>'eligibility_contract'
          IS DISTINCT FROM 'mention-semantic-approved-eligible-v1' THEN
      RAISE EXCEPTION 'Strategic population idempotency key was reused with incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    population_id := persisted.id;
    population_version := persisted.version;
    definition_hash := persisted.definition_hash;
    membership_digest := persisted.membership_digest;
    SELECT count(*)::integer INTO mention_count
    FROM signal_population_memberships membership
    WHERE membership.population_id = persisted.id
      AND membership.membership_status = 'included'
      AND membership.removed_at IS NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    count(*)::integer,
    'sha256:' || encode(sha256(convert_to(
      COALESCE(string_agg(mention.id::text, ',' ORDER BY mention.id), ''), 'UTF8'
    )), 'hex')
  INTO computed_count, computed_membership_digest
  FROM mentions mention
  WHERE mention.workspace_id = target_workspace_id
    AND mention.canonical_mention_id = mention.id
    AND mention.inclusion_status = 'included'
    AND (mention.published_at AT TIME ZONE target_timezone)::date
      BETWEEN target_period_start AND target_period_end
    AND EXISTS (
      SELECT 1
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id = target_workspace_id
        AND attribution.mention_id = mention.id
        AND attribution.attribution_basis = 'mention_semantic'
        AND attribution.is_current = true
        AND attribution.review_status = 'approved'
        AND attribution.eligibility_status = 'eligible'
        AND attribution.scope = 'primary_brand'
        AND attribution.entity_type = 'brand'
        AND attribution.entity_id = workspace_brand_id
    );
  IF computed_count = 0 THEN
    RAISE EXCEPTION 'Cannot create an empty semantic strategic population.'
      USING ERRCODE = '23514';
  END IF;
  computed_definition_hash := 'sha256:' || encode(sha256(convert_to(concat_ws('|',
    'signal-tb-analysis-population-semantic-v2', target_workspace_id::text,
    target_report_key, target_policy_key, target_policy_version,
    target_period_start::text, target_period_end::text, target_timezone,
    computed_membership_digest
  ), 'UTF8')), 'hex');

  SELECT COALESCE(max(definition.version), 0) + 1 INTO next_version
  FROM signal_population_definitions definition
  WHERE definition.workspace_id = target_workspace_id
    AND definition.population_key = 'triggers-barriers-analysis';
  UPDATE signal_population_definitions
  SET status = 'retired', updated_at = now()
  WHERE workspace_id = target_workspace_id
    AND population_key = 'triggers-barriers-analysis'
    AND status = 'active';
  INSERT INTO signal_population_definitions (
    workspace_id, population_key, version, purpose, status,
    acceptance_status, allowed_scopes, period_start, period_end,
    definition_hash, created_by_user_id, activated_by_user_id, activated_at,
    policy_key, policy_version, timezone, membership_digest,
    idempotency_key, definition
  ) VALUES (
    target_workspace_id, 'triggers-barriers-analysis', next_version, 'analysis', 'active',
    'included', ARRAY['primary_brand']::text[], target_period_start, target_period_end,
    computed_definition_hash, target_created_by_user_id, target_created_by_user_id, now(),
    target_policy_key, target_policy_version, target_timezone, computed_membership_digest,
    target_idempotency_key, jsonb_build_object(
      'contract_version', 'signal-tb-analysis-population-semantic-v2',
      'eligibility_contract', 'mention-semantic-approved-eligible-v1',
      'report_key', target_report_key,
      'acceptance_status', 'included',
      'allowed_scopes', jsonb_build_array('primary_brand'),
      'canonical_only', true,
      'attribution_basis', 'mention_semantic',
      'attribution_review_status', 'approved',
      'eligibility_status', 'eligible',
      'period_start', target_period_start,
      'period_end', target_period_end,
      'timezone', target_timezone
    )
  ) RETURNING * INTO persisted;

  INSERT INTO signal_population_memberships (
    population_id, workspace_id, mention_id,
    membership_status, membership_reason, effective_at
  )
  SELECT persisted.id, target_workspace_id, mention.id,
    'included', 'strategic_semantic_primary_brand_approved_eligible_v2', now()
  FROM mentions mention
  WHERE mention.workspace_id = target_workspace_id
    AND mention.canonical_mention_id = mention.id
    AND mention.inclusion_status = 'included'
    AND (mention.published_at AT TIME ZONE target_timezone)::date
      BETWEEN target_period_start AND target_period_end
    AND EXISTS (
      SELECT 1
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id = target_workspace_id
        AND attribution.mention_id = mention.id
        AND attribution.attribution_basis = 'mention_semantic'
        AND attribution.is_current = true
        AND attribution.review_status = 'approved'
        AND attribution.eligibility_status = 'eligible'
        AND attribution.scope = 'primary_brand'
        AND attribution.entity_type = 'brand'
        AND attribution.entity_id = workspace_brand_id
    )
  ORDER BY mention.id;

  population_id := persisted.id;
  population_version := persisted.version;
  definition_hash := persisted.definition_hash;
  membership_digest := persisted.membership_digest;
  mention_count := computed_count;
  RETURN NEXT;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure(
    'create_signal_tb_strategic_run_v1_compat(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,jsonb)'
  ) IS NULL THEN
    IF to_regprocedure(
      'create_signal_tb_strategic_run(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,jsonb)'
    ) IS NULL THEN
      RAISE EXCEPTION '0064 requires the 0062 strategic run function.';
    END IF;
    ALTER FUNCTION create_signal_tb_strategic_run(
      uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,jsonb
    ) RENAME TO create_signal_tb_strategic_run_v1_compat;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION create_signal_tb_strategic_run(
  target_workspace_id uuid,
  target_report_key text,
  target_population_id uuid,
  target_study_corpus_id uuid,
  target_created_by_user_id uuid,
  target_run_idempotency_key text,
  target_label text,
  target_pipeline_version text,
  target_methodology_version text,
  target_prompt_version text,
  target_model_version text,
  target_business_question text,
  target_decision_to_inform text,
  target_corpus_revision integer,
  target_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  tb_analysis_id uuid,
  snapshot_id uuid,
  population_id uuid,
  population_version integer,
  population_definition_hash text,
  snapshot_digest text,
  snapshot_mention_count integer,
  period_start date,
  period_end date,
  timezone text,
  report_key text,
  outbox_id uuid,
  created boolean
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM signal_population_definitions definition
    WHERE definition.id = target_population_id
      AND definition.workspace_id = target_workspace_id
      AND definition.purpose = 'analysis'
      AND definition.status = 'active'
      AND definition.definition->>'contract_version'
        = 'signal-tb-analysis-population-semantic-v2'
      AND definition.definition->>'eligibility_contract'
        = 'mention-semantic-approved-eligible-v1'
  ) THEN
    RAISE EXCEPTION 'Strategic snapshot requires a semantic approved-and-eligible population.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM signal_population_memberships membership
    JOIN signal_population_definitions definition
      ON definition.id = membership.population_id
    JOIN signal_workspaces workspace ON workspace.id = definition.workspace_id
    WHERE membership.population_id = target_population_id
      AND membership.membership_status = 'included'
      AND membership.removed_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM signal_mention_attributions attribution
        WHERE attribution.workspace_id = target_workspace_id
          AND attribution.mention_id = membership.mention_id
          AND attribution.attribution_basis = 'mention_semantic'
          AND attribution.is_current = true
          AND attribution.review_status = 'approved'
          AND attribution.eligibility_status = 'eligible'
          AND attribution.scope = 'primary_brand'
          AND attribution.entity_type = 'brand'
          AND attribution.entity_id = workspace.brand_id
      )
  ) THEN
    RAISE EXCEPTION 'Strategic population contains a membership without eligible semantics.'
      USING ERRCODE = '23514';
  END IF;
  RETURN QUERY
  SELECT * FROM create_signal_tb_strategic_run_v1_compat(
    target_workspace_id,
    target_report_key,
    target_population_id,
    target_study_corpus_id,
    target_created_by_user_id,
    target_run_idempotency_key,
    target_label,
    target_pipeline_version,
    target_methodology_version,
    target_prompt_version,
    target_model_version,
    target_business_question,
    target_decision_to_inform,
    target_corpus_revision,
    target_meta
  );
END;
$$;

COMMENT ON COLUMN signal_mention_attributions.attribution_basis IS
  'source_intent is acquisition provenance only; mention_semantic is a reviewable subject assertion.';
COMMENT ON COLUMN signal_mention_attributions.eligibility_status IS
  'Only current mention_semantic assertions that are approved and eligible may feed v2 serving or new strategic populations.';
COMMENT ON TABLE signal_mention_attribution_review_events IS
  'Append-only human/policy review lineage for versioned mention-semantic assertions.';
