-- SB-08: exact governed T&B evidence and immutable artifact review.
-- Forward-only and additive. This migration does not alter published_outputs.payload.

CREATE TABLE IF NOT EXISTS tb_finding_structured_evidence_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES tb_findings(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  data_observation_id uuid REFERENCES data_observations(id) ON DELETE RESTRICT,
  data_asset_record_id uuid REFERENCES data_asset_records(id) ON DELETE RESTRICT,
  evidence_role text NOT NULL DEFAULT 'claim_specific',
  reference_token text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tb_finding_structured_evidence_refs_source_type CHECK (
    source_type IN ('data_observation', 'data_asset_record')
  ),
  CONSTRAINT tb_finding_structured_evidence_refs_role CHECK (
    evidence_role IN ('claim_specific', 'contextual', 'limitation')
  ),
  CONSTRAINT tb_finding_structured_evidence_refs_exactly_one_source CHECK (
    ((data_observation_id IS NOT NULL)::int + (data_asset_record_id IS NOT NULL)::int) = 1
  ),
  CONSTRAINT tb_finding_structured_evidence_refs_source_matches CHECK (
    (source_type = 'data_observation' AND data_observation_id IS NOT NULL)
    OR (source_type = 'data_asset_record' AND data_asset_record_id IS NOT NULL)
  ),
  CONSTRAINT uq_tb_finding_structured_evidence_ref UNIQUE (finding_id, reference_token)
);

CREATE INDEX IF NOT EXISTS idx_tb_finding_structured_evidence_finding
  ON tb_finding_structured_evidence_refs (finding_id, evidence_role);
CREATE INDEX IF NOT EXISTS idx_tb_finding_structured_evidence_observation
  ON tb_finding_structured_evidence_refs (data_observation_id)
  WHERE data_observation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tb_finding_structured_evidence_record
  ON tb_finding_structured_evidence_refs (data_asset_record_id)
  WHERE data_asset_record_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_tb_finding_structured_evidence_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  finding_corpus_id uuid;
  evidence_corpus_id uuid;
  evidence_quality_status text;
BEGIN
  SELECT analysis.study_corpus_id
  INTO finding_corpus_id
  FROM tb_findings finding
  JOIN tb_analyses analysis ON analysis.id = finding.tb_analysis_id
  WHERE finding.id = NEW.finding_id;

  IF NEW.source_type = 'data_observation' THEN
    SELECT observation.study_corpus_id, observation.quality_status
    INTO evidence_corpus_id, evidence_quality_status
    FROM data_observations observation
    WHERE observation.id = NEW.data_observation_id;
  ELSIF NEW.source_type = 'data_asset_record' THEN
    SELECT record.study_corpus_id, record.quality_status
    INTO evidence_corpus_id, evidence_quality_status
    FROM data_asset_records record
    WHERE record.id = NEW.data_asset_record_id;
  END IF;

  IF finding_corpus_id IS NULL OR evidence_corpus_id IS NULL THEN
    RAISE EXCEPTION 'unknown_structured_evidence_ref';
  END IF;
  IF finding_corpus_id <> evidence_corpus_id THEN
    RAISE EXCEPTION 'structured_evidence_cross_corpus';
  END IF;
  IF NEW.evidence_role = 'claim_specific' AND evidence_quality_status <> 'accepted' THEN
    RAISE EXCEPTION 'structured_evidence_not_accepted';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tb_finding_structured_evidence_ref
  ON tb_finding_structured_evidence_refs;
CREATE TRIGGER trg_validate_tb_finding_structured_evidence_ref
BEFORE INSERT OR UPDATE ON tb_finding_structured_evidence_refs
FOR EACH ROW EXECUTE FUNCTION validate_tb_finding_structured_evidence_ref();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analysis_artifact_review_events_action'
      AND conrelid = 'analysis_artifact_review_events'::regclass
  ) THEN
    ALTER TABLE analysis_artifact_review_events
      ADD CONSTRAINT analysis_artifact_review_events_action CHECK (
        action IN ('accept', 'correct', 'limit', 'reject', 'accept_analysis')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analysis_artifact_review_events_previous_status'
      AND conrelid = 'analysis_artifact_review_events'::regclass
  ) THEN
    ALTER TABLE analysis_artifact_review_events
      ADD CONSTRAINT analysis_artifact_review_events_previous_status CHECK (
        previous_status IS NULL
        OR previous_status IN ('draft', 'needs_review', 'accepted', 'corrected', 'rejected', 'limited')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analysis_artifact_review_events_next_status'
      AND conrelid = 'analysis_artifact_review_events'::regclass
  ) THEN
    ALTER TABLE analysis_artifact_review_events
      ADD CONSTRAINT analysis_artifact_review_events_next_status CHECK (
        next_status IN ('draft', 'needs_review', 'accepted', 'corrected', 'rejected', 'limited')
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION protect_published_analysis_artifact_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM published_output_artifacts published
    WHERE published.artifact_id = OLD.id
      AND published.artifact_revision = OLD.revision
  ) THEN
    RAISE EXCEPTION 'published_analysis_artifact_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_published_analysis_artifact_revision
  ON analysis_artifacts;
CREATE TRIGGER trg_protect_published_analysis_artifact_revision
BEFORE UPDATE OR DELETE ON analysis_artifacts
FOR EACH ROW EXECUTE FUNCTION protect_published_analysis_artifact_revision();

COMMENT ON TABLE tb_finding_structured_evidence_refs IS
  'Exact governed data_observation/data_asset_record evidence cited by a T&B finding.';
COMMENT ON FUNCTION protect_published_analysis_artifact_revision() IS
  'Prevents in-place mutation or deletion of an artifact revision linked to a published output.';
