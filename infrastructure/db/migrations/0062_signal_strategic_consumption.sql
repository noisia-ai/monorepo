-- Signal Phase 5: workspace-owned strategic consumption for Triggers & Barriers.
--
-- This migration is additive and keeps every legacy corpus/output contract available.
-- It adds a workspace/report run identity, explicit immutable analysis populations,
-- relational snapshot containment, selected reusable-assertion review provenance and
-- an atomic report-key current-release promotion path.

ALTER TABLE signal_population_definitions
  ADD COLUMN IF NOT EXISTS policy_key text,
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS membership_digest text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS definition jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE signal_population_definitions
  DROP CONSTRAINT IF EXISTS signal_population_definitions_policy_key,
  ADD CONSTRAINT signal_population_definitions_policy_key CHECK (
    policy_key IS NULL OR policy_key ~ '^[a-z][a-z0-9-]*$'
  ),
  DROP CONSTRAINT IF EXISTS signal_population_definitions_policy_version,
  ADD CONSTRAINT signal_population_definitions_policy_version CHECK (
    policy_version IS NULL OR btrim(policy_version) <> ''
  ),
  DROP CONSTRAINT IF EXISTS signal_population_definitions_timezone,
  ADD CONSTRAINT signal_population_definitions_timezone CHECK (
    timezone IS NULL OR btrim(timezone) <> ''
  ),
  DROP CONSTRAINT IF EXISTS signal_population_definitions_membership_digest,
  ADD CONSTRAINT signal_population_definitions_membership_digest CHECK (
    membership_digest IS NULL OR membership_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  DROP CONSTRAINT IF EXISTS signal_population_definitions_idempotency_key,
  ADD CONSTRAINT signal_population_definitions_idempotency_key CHECK (
    idempotency_key IS NULL OR idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_analysis_population_idempotency
  ON signal_population_definitions (workspace_id, idempotency_key)
  WHERE purpose = 'analysis' AND idempotency_key IS NOT NULL;

ALTER TABLE corpus_snapshots
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS snapshot_digest text,
  ADD COLUMN IF NOT EXISTS source_watermark_digest text,
  ADD COLUMN IF NOT EXISTS scope_frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE corpus_snapshots
  DROP CONSTRAINT IF EXISTS corpus_snapshots_kind,
  ADD CONSTRAINT corpus_snapshots_kind CHECK (kind IN ('manual', 'approval', 'analysis')),
  DROP CONSTRAINT IF EXISTS corpus_snapshots_timezone,
  ADD CONSTRAINT corpus_snapshots_timezone CHECK (timezone IS NULL OR btrim(timezone) <> ''),
  DROP CONSTRAINT IF EXISTS corpus_snapshots_snapshot_digest,
  ADD CONSTRAINT corpus_snapshots_snapshot_digest CHECK (
    snapshot_digest IS NULL OR snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  DROP CONSTRAINT IF EXISTS corpus_snapshots_source_watermark_digest,
  ADD CONSTRAINT corpus_snapshots_source_watermark_digest CHECK (
    source_watermark_digest IS NULL OR source_watermark_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  DROP CONSTRAINT IF EXISTS corpus_snapshots_idempotency_key,
  ADD CONSTRAINT corpus_snapshots_idempotency_key CHECK (
    idempotency_key IS NULL OR idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_strategic_snapshot_idempotency
  ON corpus_snapshots (workspace_id, idempotency_key)
  WHERE kind = 'analysis' AND idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_strategic_snapshot_identity
  ON corpus_snapshots (workspace_id, population_id, scope_frozen_at DESC)
  WHERE kind = 'analysis';

ALTER TABLE tb_analyses
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS report_key text,
  ADD COLUMN IF NOT EXISTS population_id uuid REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS population_version integer,
  ADD COLUMN IF NOT EXISTS population_definition_hash text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS run_idempotency_key text,
  ADD COLUMN IF NOT EXISTS strategic_contract_version text;

ALTER TABLE tb_analyses
  DROP CONSTRAINT IF EXISTS tb_analyses_report_key,
  ADD CONSTRAINT tb_analyses_report_key CHECK (
    report_key IS NULL OR report_key ~ '^[a-z][a-z0-9-]*$'
  ),
  DROP CONSTRAINT IF EXISTS tb_analyses_population_version_positive,
  ADD CONSTRAINT tb_analyses_population_version_positive CHECK (
    population_version IS NULL OR population_version >= 1
  ),
  DROP CONSTRAINT IF EXISTS tb_analyses_population_hash,
  ADD CONSTRAINT tb_analyses_population_hash CHECK (
    population_definition_hash IS NULL
    OR population_definition_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  DROP CONSTRAINT IF EXISTS tb_analyses_run_idempotency_key,
  ADD CONSTRAINT tb_analyses_run_idempotency_key CHECK (
    run_idempotency_key IS NULL OR run_idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  DROP CONSTRAINT IF EXISTS tb_analyses_strategic_identity,
  ADD CONSTRAINT tb_analyses_strategic_identity CHECK (
    strategic_contract_version IS NULL
    OR (
      strategic_contract_version = 'signal-tb-strategic-v1'
      AND workspace_id IS NOT NULL
      AND report_key IS NOT NULL
      AND population_id IS NOT NULL
      AND population_version >= 1
      AND population_definition_hash ~ '^sha256:[0-9a-f]{64}$'
      AND NULLIF(btrim(timezone), '') IS NOT NULL
      AND run_idempotency_key ~ '^sha256:[0-9a-f]{64}$'
      AND snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
      AND scope_frozen_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_tb_analyses_workspace_report_idempotency
  ON tb_analyses (workspace_id, report_key, run_idempotency_key)
  WHERE strategic_contract_version = 'signal-tb-strategic-v1';
CREATE UNIQUE INDEX IF NOT EXISTS uq_tb_analyses_workspace_report_open_run
  ON tb_analyses (workspace_id, report_key)
  WHERE strategic_contract_version = 'signal-tb-strategic-v1'
    AND status IN ('running', 'needs_review');
CREATE INDEX IF NOT EXISTS idx_tb_analyses_workspace_report_history
  ON tb_analyses (workspace_id, report_key, created_at DESC)
  WHERE workspace_id IS NOT NULL AND report_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_strategic_run_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  report_key text NOT NULL,
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES corpus_snapshots(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  last_error jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_strategic_run_outbox_analysis UNIQUE (tb_analysis_id),
  CONSTRAINT uq_signal_strategic_run_outbox_idempotency UNIQUE (workspace_id, report_key, idempotency_key),
  CONSTRAINT signal_strategic_run_outbox_report_key CHECK (report_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_strategic_run_outbox_status CHECK (
    status IN ('pending', 'dispatching', 'dispatched', 'completed', 'failed', 'dead_letter')
  ),
  CONSTRAINT signal_strategic_run_outbox_attempt CHECK (attempt >= 0),
  CONSTRAINT signal_strategic_run_outbox_key CHECK (idempotency_key ~ '^sha256:[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_signal_strategic_run_outbox_dispatch
  ON signal_strategic_run_outbox (available_at, created_at, id)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS tb_analysis_context_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_version text NOT NULL,
  source_digest text NOT NULL,
  context_role text NOT NULL DEFAULT 'contextual',
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tb_analysis_context_ref UNIQUE (tb_analysis_id, source_type, source_id),
  CONSTRAINT tb_analysis_context_ref_source CHECK (
    source_type IN (
      'brand_knowledge_source', 'study_knowledge_source', 'knowledge_base',
      'data_asset', 'data_contract', 'data_observation', 'data_asset_record'
    )
  ),
  CONSTRAINT tb_analysis_context_ref_role CHECK (
    context_role IN ('contextual', 'structured_evidence', 'limitation')
  ),
  CONSTRAINT tb_analysis_context_ref_version CHECK (btrim(source_version) <> ''),
  CONSTRAINT tb_analysis_context_ref_digest CHECK (
    source_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);
CREATE INDEX IF NOT EXISTS idx_tb_analysis_context_refs_analysis
  ON tb_analysis_context_refs (tb_analysis_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS tb_reusable_assertion_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE RESTRICT,
  source_record_tag_id uuid NOT NULL REFERENCES record_tags(id) ON DELETE RESTRICT,
  resolved_record_tag_id uuid NOT NULL REFERENCES record_tags(id) ON DELETE RESTRICT,
  source_mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  canonical_mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL,
  previous_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tb_reusable_assertion_review_idempotency UNIQUE (tb_analysis_id, idempotency_key),
  CONSTRAINT tb_reusable_assertion_review_decision CHECK (
    decision IN ('approve', 'correct', 'reject')
  ),
  CONSTRAINT tb_reusable_assertion_review_key CHECK (
    idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  )
);
CREATE INDEX IF NOT EXISTS idx_tb_reusable_assertion_reviews_canonical
  ON tb_reusable_assertion_review_events (canonical_mention_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_frozen_signal_snapshot_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_snapshot_id uuid;
BEGIN
  target_snapshot_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.snapshot_id ELSE NEW.snapshot_id END;
  IF EXISTS (
    SELECT 1
    FROM corpus_snapshots snapshot
    WHERE snapshot.id = target_snapshot_id
      AND snapshot.workspace_id IS NOT NULL
      AND (
        snapshot.scope_frozen_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM tb_analyses analysis
          WHERE analysis.snapshot_id = snapshot.id
            AND analysis.scope_frozen_at IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM signal_workspace_releases release
          WHERE release.snapshot_id = snapshot.id
            AND release.status = 'published'
        )
      )
  ) THEN
    RAISE EXCEPTION 'frozen_signal_snapshot_membership_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_signal_strategic_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.kind = 'analysis' AND OLD.scope_frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'frozen_signal_strategic_snapshot_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD.kind = 'analysis' AND (
    NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.population_id IS DISTINCT FROM OLD.population_id
    OR NEW.population_version IS DISTINCT FROM OLD.population_version
    OR NEW.population_definition_hash IS DISTINCT FROM OLD.population_definition_hash
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
    OR NEW.timezone IS DISTINCT FROM OLD.timezone
    OR NEW.study_corpus_id IS DISTINCT FROM OLD.study_corpus_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  ) THEN
    RAISE EXCEPTION 'signal_strategic_snapshot_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_signal_strategic_snapshot ON corpus_snapshots;
CREATE TRIGGER trg_protect_signal_strategic_snapshot
  BEFORE UPDATE OR DELETE ON corpus_snapshots
  FOR EACH ROW EXECUTE FUNCTION protect_signal_strategic_snapshot();

CREATE OR REPLACE FUNCTION enforce_signal_tb_strategic_analysis_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.strategic_contract_version IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM signal_workspace_reports report
    JOIN signal_population_definitions population
      ON population.id = NEW.population_id
     AND population.workspace_id = report.workspace_id
     AND population.purpose = 'analysis'
    JOIN corpus_snapshots snapshot
      ON snapshot.id = NEW.snapshot_id
     AND snapshot.workspace_id = report.workspace_id
     AND snapshot.population_id = population.id
     AND snapshot.population_version = population.version
     AND snapshot.population_definition_hash = population.definition_hash
     AND snapshot.kind = 'analysis'
     AND snapshot.scope_frozen_at IS NOT NULL
     AND snapshot.snapshot_digest = NEW.snapshot_digest
     AND snapshot.timezone = NEW.timezone
    JOIN signal_workspace_corpora corpus_membership
      ON corpus_membership.workspace_id = report.workspace_id
     AND corpus_membership.study_corpus_id = NEW.study_corpus_id
     AND corpus_membership.valid_to IS NULL
    WHERE report.workspace_id = NEW.workspace_id
      AND report.report_key = NEW.report_key
      AND report.status = 'active'
      AND population.version = NEW.population_version
      AND population.definition_hash = NEW.population_definition_hash
      AND snapshot.mention_count = NEW.snapshot_mention_count
      AND snapshot.period_start = NEW.period_start
      AND snapshot.period_end = NEW.period_end
  ) THEN
    RAISE EXCEPTION 'Strategic analysis identity does not reconcile workspace, report, population, snapshot and execution corpus.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_tb_strategic_analysis_scope ON tb_analyses;
CREATE TRIGGER trg_signal_tb_strategic_analysis_scope
  BEFORE INSERT OR UPDATE OF workspace_id, report_key, population_id,
    population_version, population_definition_hash, snapshot_id, study_corpus_id,
    snapshot_digest, snapshot_mention_count, period_start, period_end, timezone,
    strategic_contract_version
  ON tb_analyses FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_tb_strategic_analysis_scope();

CREATE OR REPLACE FUNCTION protect_signal_tb_strategic_analysis_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.strategic_contract_version IS NOT NULL AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.report_key IS DISTINCT FROM OLD.report_key
    OR NEW.population_id IS DISTINCT FROM OLD.population_id
    OR NEW.population_version IS DISTINCT FROM OLD.population_version
    OR NEW.population_definition_hash IS DISTINCT FROM OLD.population_definition_hash
    OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
    OR NEW.study_corpus_id IS DISTINCT FROM OLD.study_corpus_id
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
    OR NEW.timezone IS DISTINCT FROM OLD.timezone
    OR NEW.snapshot_mention_count IS DISTINCT FROM OLD.snapshot_mention_count
    OR NEW.snapshot_digest IS DISTINCT FROM OLD.snapshot_digest
    OR NEW.scope_frozen_at IS DISTINCT FROM OLD.scope_frozen_at
    OR NEW.run_idempotency_key IS DISTINCT FROM OLD.run_idempotency_key
    OR NEW.strategic_contract_version IS DISTINCT FROM OLD.strategic_contract_version
  ) THEN
    RAISE EXCEPTION 'signal_tb_strategic_analysis_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_signal_tb_strategic_analysis_identity ON tb_analyses;
CREATE TRIGGER trg_protect_signal_tb_strategic_analysis_identity
  BEFORE UPDATE ON tb_analyses FOR EACH ROW
  EXECUTE FUNCTION protect_signal_tb_strategic_analysis_identity();

CREATE OR REPLACE FUNCTION enforce_signal_tb_mention_snapshot_containment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_analysis_id uuid;
DECLARE target_mention_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'tb_mention_codings' THEN
    target_analysis_id := NEW.tb_analysis_id;
    target_mention_id := NEW.mention_id;
  ELSIF TG_TABLE_NAME = 'tb_finding_citations' THEN
    target_mention_id := NEW.mention_id;
    SELECT finding.tb_analysis_id INTO target_analysis_id
    FROM tb_findings finding WHERE finding.id = NEW.finding_id;
  ELSE
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM tb_analyses analysis
    WHERE analysis.id = target_analysis_id
      AND analysis.strategic_contract_version = 'signal-tb-strategic-v1'
  ) AND NOT EXISTS (
    SELECT 1
    FROM tb_analyses analysis
    JOIN corpus_snapshot_mentions membership
      ON membership.snapshot_id = analysis.snapshot_id
     AND membership.mention_id = target_mention_id
    WHERE analysis.id = target_analysis_id
  ) THEN
    RAISE EXCEPTION 'T&B mention is outside the frozen strategic snapshot.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_tb_coding_snapshot_containment ON tb_mention_codings;
CREATE TRIGGER trg_signal_tb_coding_snapshot_containment
  BEFORE INSERT OR UPDATE OF tb_analysis_id, mention_id ON tb_mention_codings
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_tb_mention_snapshot_containment();
DROP TRIGGER IF EXISTS trg_signal_tb_citation_snapshot_containment ON tb_finding_citations;
CREATE TRIGGER trg_signal_tb_citation_snapshot_containment
  BEFORE INSERT OR UPDATE OF finding_id, mention_id ON tb_finding_citations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_tb_mention_snapshot_containment();

CREATE OR REPLACE FUNCTION enforce_signal_tb_evidence_snapshot_containment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_analysis_id uuid;
BEGIN
  IF NEW.source_type <> 'mention' THEN RETURN NEW; END IF;
  SELECT artifact.tb_analysis_id INTO target_analysis_id
  FROM analysis_evidence_groups evidence_group
  JOIN analysis_artifacts artifact ON artifact.id = evidence_group.artifact_id
  WHERE evidence_group.id = NEW.evidence_group_id;
  IF EXISTS (
    SELECT 1 FROM tb_analyses analysis
    WHERE analysis.id = target_analysis_id
      AND analysis.strategic_contract_version = 'signal-tb-strategic-v1'
  ) AND NOT EXISTS (
    SELECT 1
    FROM tb_analyses analysis
    JOIN corpus_snapshot_mentions membership
      ON membership.snapshot_id = analysis.snapshot_id
     AND membership.mention_id = NEW.source_id
    WHERE analysis.id = target_analysis_id
  ) THEN
    RAISE EXCEPTION 'T&B evidence mention is outside the frozen strategic snapshot.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_tb_evidence_snapshot_containment ON analysis_evidence_links;
CREATE TRIGGER trg_signal_tb_evidence_snapshot_containment
  BEFORE INSERT OR UPDATE OF evidence_group_id, source_type, source_id
  ON analysis_evidence_links FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_tb_evidence_snapshot_containment();

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
  SELECT workspace.timezone INTO workspace_timezone
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
       OR persisted.policy_version IS DISTINCT FROM target_policy_version THEN
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
      JOIN data_sources source
        ON source.id = attribution.data_source_id
       AND source.workspace_id = attribution.workspace_id
       AND source.scope_review_status = 'approved'
       AND source.governed_scope = 'primary_brand'
      WHERE attribution.workspace_id = target_workspace_id
        AND attribution.mention_id = mention.id
        AND attribution.scope = 'primary_brand'
        AND attribution.review_status = 'approved'
    );
  IF computed_count = 0 THEN
    RAISE EXCEPTION 'Cannot create an empty strategic population.' USING ERRCODE = '23514';
  END IF;
  computed_definition_hash := 'sha256:' || encode(sha256(convert_to(concat_ws('|',
    'signal-tb-analysis-population-v1', target_workspace_id::text, target_report_key,
    target_policy_key, target_policy_version, target_period_start::text,
    target_period_end::text, target_timezone, computed_membership_digest
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
      'contract_version', 'signal-tb-analysis-population-v1',
      'report_key', target_report_key,
      'acceptance_status', 'included',
      'allowed_scopes', jsonb_build_array('primary_brand'),
      'canonical_only', true,
      'attribution_review_status', 'approved',
      'source_scope_review_status', 'approved',
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
    'included', 'strategic_primary_brand_analysis_v1', now()
  FROM mentions mention
  WHERE mention.workspace_id = target_workspace_id
    AND mention.canonical_mention_id = mention.id
    AND mention.inclusion_status = 'included'
    AND (mention.published_at AT TIME ZONE target_timezone)::date
      BETWEEN target_period_start AND target_period_end
    AND EXISTS (
      SELECT 1
      FROM signal_mention_attributions attribution
      JOIN data_sources source
        ON source.id = attribution.data_source_id
       AND source.workspace_id = attribution.workspace_id
       AND source.scope_review_status = 'approved'
       AND source.governed_scope = 'primary_brand'
      WHERE attribution.workspace_id = target_workspace_id
        AND attribution.mention_id = mention.id
        AND attribution.scope = 'primary_brand'
        AND attribution.review_status = 'approved'
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
#variable_conflict use_column
DECLARE definition signal_population_definitions%ROWTYPE;
DECLARE existing tb_analyses%ROWTYPE;
DECLARE persisted_snapshot_id uuid;
DECLARE persisted_analysis_id uuid;
DECLARE persisted_outbox_id uuid;
DECLARE persisted_count integer;
DECLARE persisted_digest text;
DECLARE persisted_watermark_digest text;
DECLARE frozen_at timestamptz := clock_timestamp();
BEGIN
  IF target_report_key <> 'triggers-barriers'
     OR target_run_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Strategic run identity is invalid.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':' || target_report_key || ':run', 0
  ));
  SELECT * INTO existing
  FROM tb_analyses analysis
  WHERE analysis.workspace_id = target_workspace_id
    AND analysis.report_key = target_report_key
    AND analysis.run_idempotency_key = target_run_idempotency_key
  FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    IF existing.population_id IS DISTINCT FROM target_population_id
       OR existing.study_corpus_id IS DISTINCT FROM target_study_corpus_id THEN
      RAISE EXCEPTION 'Strategic run idempotency key was reused with incompatible scope.'
        USING ERRCODE = '23514';
    END IF;
    SELECT outbox.id INTO persisted_outbox_id
    FROM signal_strategic_run_outbox outbox
    WHERE outbox.tb_analysis_id = existing.id;
    tb_analysis_id := existing.id;
    snapshot_id := existing.snapshot_id;
    population_id := existing.population_id;
    population_version := existing.population_version;
    population_definition_hash := existing.population_definition_hash;
    snapshot_digest := existing.snapshot_digest;
    snapshot_mention_count := existing.snapshot_mention_count;
    period_start := existing.period_start;
    period_end := existing.period_end;
    timezone := existing.timezone;
    report_key := existing.report_key;
    outbox_id := persisted_outbox_id;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM tb_analyses analysis
    WHERE analysis.workspace_id = target_workspace_id
      AND analysis.report_key = target_report_key
      AND analysis.strategic_contract_version = 'signal-tb-strategic-v1'
      AND analysis.status IN ('running', 'needs_review')
  ) THEN
    RAISE EXCEPTION 'A strategic run is already open for this workspace report.'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO definition
  FROM signal_population_definitions population
  WHERE population.id = target_population_id
    AND population.workspace_id = target_workspace_id
    AND population.purpose = 'analysis'
    AND population.status = 'active'
    AND population.acceptance_status = 'included'
    AND population.allowed_scopes = ARRAY['primary_brand']::text[]
    AND population.policy_key = 'primary-brand-analysis'
    AND population.policy_version = '1'
    AND population.period_start IS NOT NULL
    AND population.period_end IS NOT NULL
    AND population.timezone IS NOT NULL
    AND population.membership_digest IS NOT NULL
    AND population.activated_by_user_id IS NOT NULL
  FOR SHARE;
  IF definition.id IS NULL THEN
    RAISE EXCEPTION 'Strategic run population is not an active approved primary-brand analysis population.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM signal_workspace_reports report
    JOIN signal_workspace_corpora membership
      ON membership.workspace_id = report.workspace_id
     AND membership.study_corpus_id = target_study_corpus_id
     AND membership.valid_to IS NULL
     AND membership.role IN ('operational', 'strategic', 'legacy')
    JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
    JOIN methodologies methodology ON methodology.id = corpus.methodology_id
    WHERE report.workspace_id = target_workspace_id
      AND report.report_key = target_report_key
      AND report.status = 'active'
      AND methodology.slug = 'triggers-barriers'
  ) THEN
    RAISE EXCEPTION 'Execution corpus is not compatible with the workspace report.'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*)::integer,
    'sha256:' || encode(sha256(convert_to(
      COALESCE(string_agg(membership.mention_id::text, ',' ORDER BY membership.mention_id), ''),
      'UTF8'
    )), 'hex')
  INTO persisted_count, persisted_digest
  FROM signal_population_memberships membership
  JOIN mentions mention
    ON mention.id = membership.mention_id
   AND mention.workspace_id = membership.workspace_id
   AND mention.canonical_mention_id = mention.id
  WHERE membership.population_id = definition.id
    AND membership.workspace_id = target_workspace_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL
    AND (mention.published_at AT TIME ZONE definition.timezone)::date
      BETWEEN definition.period_start AND definition.period_end;
  IF persisted_count = 0 OR persisted_digest IS DISTINCT FROM definition.membership_digest THEN
    RAISE EXCEPTION 'Strategic population membership does not reconcile its frozen definition.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO corpus_snapshots (
    workspace_id, population_id, population_version, population_definition_hash,
    period_start, period_end, timezone, watermark_captured_at,
    study_corpus_id, label, kind, mention_count, scores_at_snapshot,
    created_by_user_id, idempotency_key
  ) VALUES (
    target_workspace_id, definition.id, definition.version, definition.definition_hash,
    definition.period_start, definition.period_end, definition.timezone, frozen_at,
    target_study_corpus_id, target_label, 'analysis', persisted_count,
    jsonb_build_object(
      'contract_version', 'signal-tb-strategic-snapshot-v1',
      'report_key', target_report_key,
      'policy_key', definition.policy_key,
      'policy_version', definition.policy_version
    ), target_created_by_user_id, target_run_idempotency_key
  ) RETURNING id INTO persisted_snapshot_id;

  INSERT INTO corpus_snapshot_mentions (snapshot_id, mention_id)
  SELECT persisted_snapshot_id, membership.mention_id
  FROM signal_population_memberships membership
  WHERE membership.population_id = definition.id
    AND membership.workspace_id = target_workspace_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL
  ORDER BY membership.mention_id;

  INSERT INTO signal_mention_study_memberships (
    workspace_id, mention_id, study_corpus_id, membership_role
  )
  SELECT target_workspace_id, membership.mention_id, target_study_corpus_id, 'selected'
  FROM corpus_snapshot_mentions membership
  WHERE membership.snapshot_id = persisted_snapshot_id
  ON CONFLICT DO NOTHING;

  INSERT INTO signal_snapshot_watermarks (
    snapshot_id, data_source_id, import_batch_id,
    data_through_at, accepted_at, watermark_hash
  )
  SELECT
    persisted_snapshot_id, watermark.data_source_id, watermark.last_import_batch_id,
    watermark.max_observed_at, watermark.accepted_at,
    'sha256:' || encode(sha256(convert_to(concat_ws('|',
      target_workspace_id::text, definition.id::text, watermark.data_source_id::text,
      watermark.last_import_batch_id::text, watermark.max_observed_at::text,
      watermark.accepted_at::text
    ), 'UTF8')), 'hex')
  FROM signal_data_watermarks watermark
  WHERE watermark.workspace_id = target_workspace_id
    AND watermark.study_corpus_id IS NULL
    AND watermark.data_source_id IS NOT NULL
  ON CONFLICT (
    snapshot_id,
    (COALESCE(data_source_id, '00000000-0000-0000-0000-000000000000'::uuid))
  ) DO NOTHING;

  SELECT 'sha256:' || encode(sha256(convert_to(
    COALESCE(string_agg(concat_ws(':', watermark.data_source_id::text,
      watermark.import_batch_id::text, watermark.data_through_at::text,
      watermark.accepted_at::text, watermark.watermark_hash), ','
      ORDER BY watermark.data_source_id, watermark.id), ''), 'UTF8'
  )), 'hex')
  INTO persisted_watermark_digest
  FROM signal_snapshot_watermarks watermark
  WHERE watermark.snapshot_id = persisted_snapshot_id;

  UPDATE corpus_snapshots
  SET snapshot_digest = persisted_digest,
      source_watermark_digest = persisted_watermark_digest,
      scope_frozen_at = frozen_at
  WHERE id = persisted_snapshot_id;

  INSERT INTO tb_analyses (
    study_corpus_id, snapshot_id, pipeline_version, methodology_version,
    methodology_slug, prompt_version, model_version, corpus_revision,
    period_start, period_end, snapshot_mention_count, snapshot_digest,
    scope_frozen_at, comparison_compatibility_state, status, current_step,
    business_question, decision_to_inform, meta_json, executed_by_user_id,
    workspace_id, report_key, population_id, population_version,
    population_definition_hash, timezone, run_idempotency_key,
    strategic_contract_version
  ) VALUES (
    target_study_corpus_id, persisted_snapshot_id, target_pipeline_version,
    target_methodology_version, 'triggers-barriers', target_prompt_version,
    target_model_version, target_corpus_revision,
    definition.period_start, definition.period_end, persisted_count, persisted_digest,
    frozen_at, 'not_evaluated', 'running', 'preflight',
    target_business_question, target_decision_to_inform,
    COALESCE(target_meta, '{}'::jsonb) || jsonb_build_object(
      'strategic_contract_version', 'signal-tb-strategic-v1',
      'workspace_id', target_workspace_id,
      'report_key', target_report_key,
      'population_id', definition.id,
      'population_version', definition.version,
      'population_definition_hash', definition.definition_hash,
      'snapshot_id', persisted_snapshot_id,
      'execution_corpus_id', target_study_corpus_id
    ), target_created_by_user_id,
    target_workspace_id, target_report_key, definition.id, definition.version,
    definition.definition_hash, definition.timezone, target_run_idempotency_key,
    'signal-tb-strategic-v1'
  ) RETURNING id INTO persisted_analysis_id;

  UPDATE study_corpora
  SET locked_by_analysis_id = persisted_analysis_id, updated_at = now()
  WHERE id = target_study_corpus_id
    AND (locked_by_analysis_id IS NULL OR locked_by_analysis_id = persisted_analysis_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execution corpus is locked by another analysis.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO signal_strategic_run_outbox (
    workspace_id, report_key, tb_analysis_id, snapshot_id, idempotency_key
  ) VALUES (
    target_workspace_id, target_report_key, persisted_analysis_id,
    persisted_snapshot_id, target_run_idempotency_key
  ) RETURNING id INTO persisted_outbox_id;

  tb_analysis_id := persisted_analysis_id;
  snapshot_id := persisted_snapshot_id;
  population_id := definition.id;
  population_version := definition.version;
  population_definition_hash := definition.definition_hash;
  snapshot_digest := persisted_digest;
  snapshot_mention_count := persisted_count;
  period_start := definition.period_start;
  period_end := definition.period_end;
  timezone := definition.timezone;
  report_key := target_report_key;
  outbox_id := persisted_outbox_id;
  created := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION assert_signal_tb_snapshot_containment(
  target_tb_analysis_id uuid,
  target_stage text DEFAULT 'runtime'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE analysis tb_analyses%ROWTYPE;
DECLARE snapshot corpus_snapshots%ROWTYPE;
DECLARE actual_count integer;
DECLARE actual_digest text;
DECLARE actual_watermark_digest text;
DECLARE noncanonical_count integer;
DECLARE post_freeze_count integer;
DECLARE coding_outside_count integer;
DECLARE citation_outside_count integer;
DECLARE evidence_outside_count integer;
BEGIN
  SELECT * INTO analysis FROM tb_analyses WHERE id = target_tb_analysis_id FOR SHARE;
  IF analysis.id IS NULL THEN RAISE EXCEPTION 'T&B analysis not found.'; END IF;
  IF analysis.strategic_contract_version IS NULL THEN
    RETURN jsonb_build_object('contract_version', 'legacy', 'stage', target_stage, 'checked', false);
  END IF;
  SELECT * INTO snapshot FROM corpus_snapshots WHERE id = analysis.snapshot_id FOR SHARE;
  SELECT
    count(*)::integer,
    'sha256:' || encode(sha256(convert_to(
      COALESCE(string_agg(membership.mention_id::text, ',' ORDER BY membership.mention_id), ''),
      'UTF8'
    )), 'hex'),
    count(*) FILTER (WHERE mention.canonical_mention_id <> mention.id)::integer,
    count(*) FILTER (WHERE mention.created_at > analysis.scope_frozen_at)::integer
  INTO actual_count, actual_digest, noncanonical_count, post_freeze_count
  FROM corpus_snapshot_mentions membership
  JOIN mentions mention ON mention.id = membership.mention_id
  WHERE membership.snapshot_id = analysis.snapshot_id;
  SELECT 'sha256:' || encode(sha256(convert_to(
    COALESCE(string_agg(concat_ws(':', watermark.data_source_id::text,
      watermark.import_batch_id::text, watermark.data_through_at::text,
      watermark.accepted_at::text, watermark.watermark_hash), ','
      ORDER BY watermark.data_source_id, watermark.id), ''), 'UTF8'
  )), 'hex')
  INTO actual_watermark_digest
  FROM signal_snapshot_watermarks watermark
  WHERE watermark.snapshot_id = analysis.snapshot_id;
  SELECT count(*)::integer INTO coding_outside_count
  FROM tb_mention_codings coding
  WHERE coding.tb_analysis_id = analysis.id
    AND NOT EXISTS (
      SELECT 1 FROM corpus_snapshot_mentions membership
      WHERE membership.snapshot_id = analysis.snapshot_id
        AND membership.mention_id = coding.mention_id
    );
  SELECT count(*)::integer INTO citation_outside_count
  FROM tb_finding_citations citation
  JOIN tb_findings finding ON finding.id = citation.finding_id
  WHERE finding.tb_analysis_id = analysis.id
    AND NOT EXISTS (
      SELECT 1 FROM corpus_snapshot_mentions membership
      WHERE membership.snapshot_id = analysis.snapshot_id
        AND membership.mention_id = citation.mention_id
    );
  SELECT count(*)::integer INTO evidence_outside_count
  FROM analysis_evidence_links evidence
  JOIN analysis_evidence_groups evidence_group ON evidence_group.id = evidence.evidence_group_id
  JOIN analysis_artifacts artifact ON artifact.id = evidence_group.artifact_id
  WHERE artifact.tb_analysis_id = analysis.id
    AND evidence.source_type = 'mention'
    AND NOT EXISTS (
      SELECT 1 FROM corpus_snapshot_mentions membership
      WHERE membership.snapshot_id = analysis.snapshot_id
        AND membership.mention_id = evidence.source_id
    );
  IF actual_count IS DISTINCT FROM snapshot.mention_count
     OR actual_count IS DISTINCT FROM analysis.snapshot_mention_count
     OR actual_digest IS DISTINCT FROM snapshot.snapshot_digest
     OR actual_digest IS DISTINCT FROM analysis.snapshot_digest
     OR actual_watermark_digest IS DISTINCT FROM snapshot.source_watermark_digest
     OR snapshot.period_start IS DISTINCT FROM analysis.period_start
     OR snapshot.period_end IS DISTINCT FROM analysis.period_end
     OR snapshot.timezone IS DISTINCT FROM analysis.timezone
     OR noncanonical_count > 0 OR post_freeze_count > 0
     OR coding_outside_count > 0 OR citation_outside_count > 0
     OR evidence_outside_count > 0
     OR (SELECT count(DISTINCT coding.mention_id) FROM tb_mention_codings coding
         WHERE coding.tb_analysis_id = analysis.id) > actual_count
     OR (SELECT count(DISTINCT citation.mention_id)
         FROM tb_finding_citations citation
         JOIN tb_findings finding ON finding.id = citation.finding_id
         WHERE finding.tb_analysis_id = analysis.id) > actual_count THEN
    RAISE EXCEPTION 'T&B snapshot containment failed at stage %.', target_stage
      USING ERRCODE = '23514',
      DETAIL = jsonb_build_object(
        'snapshot_count', snapshot.mention_count,
        'actual_count', actual_count,
        'noncanonical_count', noncanonical_count,
        'post_freeze_count', post_freeze_count,
        'coding_outside_count', coding_outside_count,
        'citation_outside_count', citation_outside_count,
        'evidence_outside_count', evidence_outside_count
      )::text;
  END IF;
  RETURN jsonb_build_object(
    'contract_version', 'signal-tb-snapshot-containment-v1',
    'stage', target_stage,
    'checked', true,
    'snapshot_id', analysis.snapshot_id,
    'mention_count', actual_count,
    'snapshot_digest', actual_digest,
    'source_watermark_digest', actual_watermark_digest,
    'coding_outside_count', coding_outside_count,
    'citation_outside_count', citation_outside_count,
    'evidence_outside_count', evidence_outside_count,
    'contract_violation_count', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION review_signal_tb_reusable_assertion(
  target_tb_analysis_id uuid,
  target_record_tag_id uuid,
  target_reviewer_user_id uuid,
  target_decision text,
  target_notes text,
  target_idempotency_key text,
  target_correction jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE analysis tb_analyses%ROWTYPE;
DECLARE source_tag record_tags%ROWTYPE;
DECLARE source_mention mentions%ROWTYPE;
DECLARE canonical_tag_id uuid;
DECLARE existing_event tb_reusable_assertion_review_events%ROWTYPE;
DECLARE previous_state jsonb;
DECLARE next_state jsonb;
BEGIN
  IF target_reviewer_user_id IS NULL
     OR target_decision NOT IN ('approve', 'correct', 'reject')
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Reusable assertion review input is invalid.' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_tb_analysis_id::text || ':' || target_idempotency_key || ':assertion-review', 0
  ));
  SELECT * INTO existing_event
  FROM tb_reusable_assertion_review_events event
  WHERE event.tb_analysis_id = target_tb_analysis_id
    AND event.idempotency_key = target_idempotency_key;
  IF existing_event.id IS NOT NULL THEN RETURN existing_event.resolved_record_tag_id; END IF;
  SELECT * INTO analysis FROM tb_analyses WHERE id = target_tb_analysis_id FOR UPDATE;
  SELECT * INTO source_tag FROM record_tags WHERE id = target_record_tag_id FOR UPDATE;
  IF analysis.id IS NULL OR source_tag.id IS NULL
     OR analysis.strategic_contract_version <> 'signal-tb-strategic-v1'
     OR source_tag.tb_analysis_id IS DISTINCT FROM analysis.id
     OR source_tag.subject_type <> 'mention' THEN
    RAISE EXCEPTION 'Reusable assertion does not belong to the strategic analysis.'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO source_mention FROM mentions WHERE id = source_tag.subject_id FOR SHARE;
  IF source_mention.id IS NULL OR source_mention.workspace_id IS DISTINCT FROM analysis.workspace_id
     OR NOT EXISTS (
       SELECT 1 FROM corpus_snapshot_mentions membership
       WHERE membership.snapshot_id = analysis.snapshot_id
         AND membership.mention_id = source_mention.canonical_mention_id
     ) THEN
    RAISE EXCEPTION 'Reusable assertion mention is outside the frozen snapshot.'
      USING ERRCODE = '23514';
  END IF;
  previous_state := jsonb_build_object(
    'subject_id', source_tag.subject_id,
    'review_status', source_tag.review_status,
    'value', source_tag.value,
    'score', source_tag.score,
    'confidence', source_tag.confidence,
    'approval_source', source_tag.approval_source,
    'approved_at', source_tag.approved_at
  );

  IF target_decision = 'reject' THEN
    UPDATE record_tags
    SET review_status = 'rejected', approval_source = NULL,
        approval_policy_version = NULL, approved_at = NULL
    WHERE id = source_tag.id
    RETURNING id INTO canonical_tag_id;
  ELSE
    IF source_mention.id <> source_mention.canonical_mention_id THEN
      SELECT tag.id INTO canonical_tag_id
      FROM record_tags tag
      WHERE tag.subject_type = 'mention'
        AND tag.subject_id = source_mention.canonical_mention_id
        AND tag.taxonomy_term_id = source_tag.taxonomy_term_id
        AND tag.source = source_tag.source
      FOR UPDATE;
    END IF;
    IF canonical_tag_id IS NULL THEN
      UPDATE record_tags
      SET subject_id = source_mention.canonical_mention_id,
          value = CASE WHEN target_decision = 'correct' AND target_correction ? 'value'
            THEN target_correction->>'value' ELSE value END,
          score = CASE WHEN target_decision = 'correct' AND target_correction ? 'score'
            THEN NULLIF(target_correction->>'score', '')::numeric ELSE score END,
          confidence = CASE WHEN target_decision = 'correct' AND target_correction ? 'confidence'
            THEN target_correction->>'confidence' ELSE confidence END,
          review_status = 'approved', approval_source = 'human',
          approval_policy_version = NULL, approved_at = now()
      WHERE id = source_tag.id
      RETURNING id INTO canonical_tag_id;
    ELSE
      UPDATE record_tags
      SET value = CASE WHEN target_decision = 'correct' AND target_correction ? 'value'
            THEN target_correction->>'value' ELSE source_tag.value END,
          score = CASE WHEN target_decision = 'correct' AND target_correction ? 'score'
            THEN NULLIF(target_correction->>'score', '')::numeric ELSE source_tag.score END,
          confidence = CASE WHEN target_decision = 'correct' AND target_correction ? 'confidence'
            THEN target_correction->>'confidence' ELSE source_tag.confidence END,
          evidence = source_tag.evidence,
          review_status = 'approved', approval_source = 'human',
          approval_policy_version = NULL, approved_at = now()
      WHERE id = canonical_tag_id;
      UPDATE record_tags
      SET review_status = 'rejected', approval_source = NULL,
          approval_policy_version = NULL, approved_at = NULL
      WHERE id = source_tag.id AND id <> canonical_tag_id;
    END IF;
  END IF;
  SELECT jsonb_build_object(
    'subject_id', tag.subject_id,
    'review_status', tag.review_status,
    'value', tag.value,
    'score', tag.score,
    'confidence', tag.confidence,
    'approval_source', tag.approval_source,
    'approved_at', tag.approved_at
  ) INTO next_state FROM record_tags tag WHERE tag.id = canonical_tag_id;
  INSERT INTO tag_review_events (
    record_tag_id, reviewer_user_id, action, previous_value, next_value, notes
  ) VALUES (
    canonical_tag_id, target_reviewer_user_id, target_decision,
    previous_state, next_state, target_notes
  );
  INSERT INTO tb_reusable_assertion_review_events (
    tb_analysis_id, source_record_tag_id, resolved_record_tag_id,
    source_mention_id, canonical_mention_id, reviewer_user_id,
    decision, previous_state, next_state, notes, idempotency_key
  ) VALUES (
    analysis.id, source_tag.id, canonical_tag_id,
    source_mention.id, source_mention.canonical_mention_id, target_reviewer_user_id,
    target_decision, previous_state, next_state, target_notes, target_idempotency_key
  );
  IF source_mention.id <> source_mention.canonical_mention_id THEN
    INSERT INTO lineage_edges (
      source_type, source_id, target_type, target_id, relation_type, metadata
    ) VALUES (
      'mention_alias', source_mention.id, 'record_tag', canonical_tag_id,
      'canonicalized_during_review', jsonb_build_object(
        'tb_analysis_id', analysis.id,
        'canonical_mention_id', source_mention.canonical_mention_id,
        'reviewer_user_id', target_reviewer_user_id
      )
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN canonical_tag_id;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_strategic_release_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tb_analyses analysis
    WHERE analysis.id = NEW.tb_analysis_id
      AND analysis.strategic_contract_version = 'signal-tb-strategic-v1'
  ) AND NOT EXISTS (
    SELECT 1
    FROM tb_analyses analysis
    JOIN signal_workspace_reports report
      ON report.workspace_id = analysis.workspace_id
     AND report.report_key = analysis.report_key
    WHERE analysis.id = NEW.tb_analysis_id
      AND analysis.workspace_id = NEW.workspace_id
      AND analysis.report_key = NEW.report_key
      AND analysis.snapshot_id = NEW.snapshot_id
      AND report.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Strategic release does not match its workspace report analysis and snapshot.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_strategic_release_scope ON signal_workspace_releases;
CREATE TRIGGER trg_signal_strategic_release_scope
  BEFORE INSERT OR UPDATE OF workspace_id, tb_analysis_id, report_key, snapshot_id
  ON signal_workspace_releases FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_strategic_release_scope();

CREATE OR REPLACE FUNCTION promote_signal_workspace_report_release(
  requested_release_id uuid,
  reviewer_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE release_row signal_workspace_releases%ROWTYPE;
DECLARE analysis_status text;
DECLARE failed_gates integer;
DECLARE artifact_count integer;
DECLARE invalid_artifacts integer;
DECLARE current_release_id uuid;
BEGIN
  IF reviewer_user_id IS NULL THEN RAISE EXCEPTION 'signal_release_human_reviewer_required'; END IF;
  SELECT * INTO release_row FROM signal_workspace_releases
  WHERE id = requested_release_id FOR UPDATE;
  IF release_row.id IS NULL THEN RAISE EXCEPTION 'signal_release_not_found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    release_row.workspace_id::text || ':' || release_row.report_key || ':release', 0
  ));
  SELECT pointer.release_id INTO current_release_id
  FROM signal_workspace_report_current_releases pointer
  WHERE pointer.workspace_id = release_row.workspace_id
    AND pointer.report_key = release_row.report_key
  FOR UPDATE;
  IF release_row.status = 'published' THEN
    IF current_release_id = release_row.id THEN RETURN release_row.id; END IF;
    RAISE EXCEPTION 'signal_release_published_but_not_current';
  END IF;
  IF release_row.status NOT IN ('draft', 'needs_review') THEN
    RAISE EXCEPTION 'signal_release_not_promotable';
  END IF;
  SELECT status INTO analysis_status FROM tb_analyses
  WHERE id = release_row.tb_analysis_id FOR SHARE;
  IF analysis_status NOT IN ('approved_by_im', 'approved_by_kam') THEN
    RAISE EXCEPTION 'signal_release_analysis_not_human_approved';
  END IF;
  SELECT count(*) INTO failed_gates FROM tb_quality_gates
  WHERE tb_analysis_id = release_row.tb_analysis_id AND passed = false;
  IF failed_gates > 0 THEN RAISE EXCEPTION 'signal_release_quality_gates_failed'; END IF;
  SELECT count(*) INTO artifact_count FROM signal_workspace_release_artifacts
  WHERE release_id = release_row.id;
  IF artifact_count = 0 THEN RAISE EXCEPTION 'signal_release_artifacts_missing'; END IF;
  SELECT count(*) INTO invalid_artifacts
  FROM signal_workspace_release_artifacts release_artifact
  JOIN analysis_artifacts artifact ON artifact.id = release_artifact.artifact_id
  WHERE release_artifact.release_id = release_row.id
    AND (artifact.tb_analysis_id IS DISTINCT FROM release_row.tb_analysis_id
      OR artifact.revision <> release_artifact.artifact_revision
      OR artifact.review_status NOT IN ('accepted', 'corrected', 'limited'));
  IF invalid_artifacts > 0 THEN RAISE EXCEPTION 'signal_release_artifact_gate_failed'; END IF;
  PERFORM assert_signal_tb_snapshot_containment(release_row.tb_analysis_id, 'release_promotion');
  UPDATE signal_workspace_releases
  SET status = 'published', visibility = 'client',
      approved_by_user_id = reviewer_user_id, approved_at = now(),
      published_at = now(), updated_at = now()
  WHERE id = release_row.id;
  INSERT INTO signal_workspace_report_current_releases (
    workspace_id, report_key, release_id, promoted_by_user_id, promoted_at
  ) VALUES (
    release_row.workspace_id, release_row.report_key, release_row.id,
    reviewer_user_id, now()
  ) ON CONFLICT (workspace_id, report_key) DO UPDATE SET
    release_id = EXCLUDED.release_id,
    promoted_by_user_id = EXCLUDED.promoted_by_user_id,
    promoted_at = EXCLUDED.promoted_at;
  IF release_row.report_key = 'triggers-barriers' THEN
    INSERT INTO signal_workspace_current_releases (
      workspace_id, release_id, promoted_by_user_id, promoted_at
    ) VALUES (
      release_row.workspace_id, release_row.id, reviewer_user_id, now()
    ) ON CONFLICT (workspace_id) DO UPDATE SET
      release_id = EXCLUDED.release_id,
      promoted_by_user_id = EXCLUDED.promoted_by_user_id,
      promoted_at = EXCLUDED.promoted_at;
  END IF;
  RETURN release_row.id;
END;
$$;
