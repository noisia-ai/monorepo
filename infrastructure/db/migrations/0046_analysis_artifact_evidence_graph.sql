-- Canonical analysis artifact and evidence graph.
-- Additive only: domain tables and published_outputs.payload remain intact while
-- Review and Signal migrate to addressable, evidence-backed records.

CREATE TABLE IF NOT EXISTS analysis_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id) ON DELETE CASCADE,
  tb_analysis_id uuid REFERENCES tb_analyses(id) ON DELETE CASCADE,
  engine_analysis_id uuid REFERENCES engine_analyses(id) ON DELETE CASCADE,
  artifact_key text NOT NULL,
  artifact_type text NOT NULL,
  source_entity_type text,
  source_entity_id uuid,
  title text,
  summary text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence text,
  review_status text NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1,
  position integer NOT NULL DEFAULT 0,
  supersedes_artifact_id uuid REFERENCES analysis_artifacts(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_artifacts_exactly_one_analysis CHECK (
    ((tb_analysis_id IS NOT NULL)::int + (engine_analysis_id IS NOT NULL)::int) = 1
  ),
  CONSTRAINT analysis_artifacts_source_pair CHECK (
    (source_entity_type IS NULL AND source_entity_id IS NULL)
    OR (source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL)
  ),
  CONSTRAINT analysis_artifacts_review_status CHECK (
    review_status IN ('draft', 'needs_review', 'accepted', 'corrected', 'rejected', 'limited')
  ),
  CONSTRAINT analysis_artifacts_revision_positive CHECK (revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_artifacts_tb_key_revision
  ON analysis_artifacts (tb_analysis_id, artifact_key, revision)
  WHERE tb_analysis_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_artifacts_engine_key_revision
  ON analysis_artifacts (engine_analysis_id, artifact_key, revision)
  WHERE engine_analysis_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_artifacts_source_revision
  ON analysis_artifacts (source_entity_type, source_entity_id, revision)
  WHERE source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_corpus_type
  ON analysis_artifacts (study_corpus_id, artifact_type, review_status, position);
CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_tb
  ON analysis_artifacts (tb_analysis_id, artifact_type, position);
CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_engine
  ON analysis_artifacts (engine_analysis_id, artifact_type, position);

CREATE TABLE IF NOT EXISTS analysis_evidence_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id) ON DELETE CASCADE,
  group_key text NOT NULL,
  role text NOT NULL DEFAULT 'supporting',
  label text,
  summary text,
  position integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_evidence_groups_role CHECK (
    role IN ('supporting', 'protagonist', 'counter', 'contextual', 'denominator', 'limitation')
  ),
  CONSTRAINT uq_analysis_evidence_groups_artifact_key UNIQUE (artifact_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_analysis_evidence_groups_artifact
  ON analysis_evidence_groups (artifact_id, role, position);

CREATE TABLE IF NOT EXISTS analysis_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_group_id uuid NOT NULL REFERENCES analysis_evidence_groups(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  relation_type text NOT NULL DEFAULT 'supports',
  evidence_role text NOT NULL DEFAULT 'supporting',
  quote text,
  locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence text,
  weight numeric(5,4),
  position integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_evidence_links_weight_range CHECK (
    weight IS NULL OR (weight >= 0 AND weight <= 1)
  ),
  CONSTRAINT uq_analysis_evidence_links_source UNIQUE (
    evidence_group_id,
    source_type,
    source_id,
    relation_type
  )
);

CREATE INDEX IF NOT EXISTS idx_analysis_evidence_links_group
  ON analysis_evidence_links (evidence_group_id, position);
CREATE INDEX IF NOT EXISTS idx_analysis_evidence_links_source
  ON analysis_evidence_links (source_type, source_id);

CREATE TABLE IF NOT EXISTS analysis_artifact_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id) ON DELETE CASCADE,
  target_artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_artifact_relations_no_self CHECK (source_artifact_id <> target_artifact_id),
  CONSTRAINT uq_analysis_artifact_relations_pair UNIQUE (
    source_artifact_id,
    target_artifact_id,
    relation_type
  )
);

CREATE INDEX IF NOT EXISTS idx_analysis_artifact_relations_source
  ON analysis_artifact_relations (source_artifact_id, relation_type, position);
CREATE INDEX IF NOT EXISTS idx_analysis_artifact_relations_target
  ON analysis_artifact_relations (target_artifact_id, relation_type);

CREATE TABLE IF NOT EXISTS analysis_artifact_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id) ON DELETE CASCADE,
  reviewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  previous_status text,
  next_status text NOT NULL,
  patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_artifact_review_events_artifact
  ON analysis_artifact_review_events (artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analysis_artifact_review_events_reviewer
  ON analysis_artifact_review_events (reviewer_user_id, created_at);

CREATE TABLE IF NOT EXISTS published_output_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  published_output_id uuid NOT NULL REFERENCES published_outputs(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id) ON DELETE CASCADE,
  artifact_revision integer NOT NULL,
  position integer NOT NULL DEFAULT 0,
  visibility text NOT NULL DEFAULT 'published',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT published_output_artifacts_revision_positive CHECK (artifact_revision >= 1),
  CONSTRAINT uq_published_output_artifacts_pair UNIQUE (published_output_id, artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_published_output_artifacts_output
  ON published_output_artifacts (published_output_id, visibility, position);
CREATE INDEX IF NOT EXISTS idx_published_output_artifacts_artifact
  ON published_output_artifacts (artifact_id);
