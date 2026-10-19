-- Versioned interpretation layer over canonical SB-05 materializations.
-- This is intentionally separate from analysis_artifacts: metric interpretations
-- have a workspace/materialization owner, while analysis_artifacts require an
-- analysis owner and keep their existing ownership constraint.

CREATE TABLE IF NOT EXISTS metric_interpretation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id) ON DELETE CASCADE,
  metric_group_key text NOT NULL,
  metric_group_version integer NOT NULL DEFAULT 1,
  normalized_filter jsonb NOT NULL,
  filters_hash text NOT NULL,
  data_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_watermark_hash text NOT NULL,
  packet jsonb NOT NULL,
  packet_hash text NOT NULL,
  prompt_version text NOT NULL,
  model_version text NOT NULL,
  provider text NOT NULL DEFAULT 'anthropic',
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL DEFAULT 0,
  budget_cap_usd numeric(12,6) NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  actual_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  timeout_ms integer NOT NULL,
  error_code text,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallback_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metric_interpretation_runs_group_version CHECK (metric_group_version >= 1),
  CONSTRAINT metric_interpretation_runs_hashes CHECK (
    filters_hash ~ '^sha256:[0-9a-f]{64}$'
    AND data_watermark_hash ~ '^sha256:[0-9a-f]{64}$'
    AND packet_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT metric_interpretation_runs_status CHECK (
    status IN ('queued', 'running', 'completed', 'skipped', 'failed', 'dead_letter')
  ),
  CONSTRAINT metric_interpretation_runs_cost CHECK (
    attempt >= 0 AND budget_cap_usd >= 0 AND estimated_cost_usd >= 0
    AND actual_cost_usd >= 0 AND actual_cost_usd <= budget_cap_usd
  ),
  CONSTRAINT metric_interpretation_runs_timeout CHECK (timeout_ms BETWEEN 1000 AND 120000),
  CONSTRAINT uq_metric_interpretation_runs_idempotency UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS metric_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES metric_interpretation_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id) ON DELETE CASCADE,
  metric_group_key text NOT NULL,
  metric_group_version integer NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  filters_hash text NOT NULL,
  data_watermark_hash text NOT NULL,
  packet_hash text NOT NULL,
  data_scope jsonb NOT NULL,
  content jsonb NOT NULL,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  hypotheses jsonb NOT NULL DEFAULT '[]'::jsonb,
  causal_claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'fresh',
  review_status text NOT NULL,
  generated_by text NOT NULL,
  stale_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT metric_interpretations_revision CHECK (revision >= 1),
  CONSTRAINT metric_interpretations_status CHECK (
    status IN ('fresh', 'stale', 'pending', 'partial', 'not_available')
  ),
  CONSTRAINT metric_interpretations_review_status CHECK (
    review_status IN ('auto_published', 'needs_review', 'approved', 'rejected')
  ),
  CONSTRAINT metric_interpretations_generated_by CHECK (
    generated_by IN ('claude', 'deterministic_fallback')
  ),
  CONSTRAINT metric_interpretations_hashes CHECK (
    filters_hash ~ '^sha256:[0-9a-f]{64}$'
    AND data_watermark_hash ~ '^sha256:[0-9a-f]{64}$'
    AND packet_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT uq_metric_interpretations_scope_revision UNIQUE (
    workspace_id, metric_group_key, metric_group_version,
    filters_hash, data_watermark_hash, revision
  )
);

CREATE TABLE IF NOT EXISTS metric_interpretation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interpretation_id uuid NOT NULL REFERENCES metric_interpretations(id) ON DELETE CASCADE,
  materialization_id uuid NOT NULL REFERENCES metric_materializations(id) ON DELETE RESTRICT,
  claim_index integer NOT NULL,
  claim_kind text NOT NULL,
  field text,
  cited_numeric_value numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metric_interpretation_evidence_claim_index CHECK (claim_index >= 0),
  CONSTRAINT metric_interpretation_evidence_claim_kind CHECK (
    claim_kind IN ('fact', 'hypothesis', 'causal_claim', 'recommendation')
  ),
  CONSTRAINT metric_interpretation_evidence_field CHECK (
    field IS NULL OR field IN ('value', 'denominator', 'sample_size')
  ),
  CONSTRAINT metric_interpretation_evidence_numeric_pair CHECK (
    (field IS NULL) = (cited_numeric_value IS NULL)
  ),
  CONSTRAINT uq_metric_interpretation_evidence_ref UNIQUE (
    interpretation_id, materialization_id, claim_index, claim_kind, field
  )
);

ALTER TABLE signal_interpretation_freshness
  ADD COLUMN IF NOT EXISTS latest_interpretation_id uuid
    REFERENCES metric_interpretations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_metric_interpretation_runs_outbox
  ON metric_interpretation_runs (status, created_at, id)
  WHERE status IN ('queued', 'failed');

CREATE INDEX IF NOT EXISTS idx_metric_interpretation_runs_scope
  ON metric_interpretation_runs (
    workspace_id, metric_group_key, filters_hash, data_watermark_hash, created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_metric_interpretations_serving
  ON metric_interpretations (
    workspace_id, metric_group_key, filters_hash, status, created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_metric_interpretation_evidence_materialization
  ON metric_interpretation_evidence (materialization_id, interpretation_id);

COMMENT ON TABLE metric_interpretation_runs IS
  'Async, idempotent and budget-bounded Signal metric interpretation attempts built only from SB-05 packets.';
COMMENT ON TABLE metric_interpretations IS
  'Versioned descriptive/analytical text scoped to an exact filter, watermark and metric packet.';
COMMENT ON TABLE metric_interpretation_evidence IS
  'Exact claim-to-materialization and numeric-field references validated before persistence.';
