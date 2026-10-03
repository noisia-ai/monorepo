-- SB-10: indexes justified by the workspace home, facets, series and drill-down
-- query families. Additive and safe to build before client activation.

CREATE INDEX IF NOT EXISTS idx_metric_materializations_signal_facade
  ON metric_materializations (
    workspace_id,
    study_corpus_id,
    filters_hash,
    metric_key,
    metric_version,
    computed_at DESC
  )
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mentions_signal_facets
  ON mentions (
    study_corpus_id,
    resolved_platform,
    published_at,
    id
  )
  WHERE inclusion_status = 'included';

CREATE INDEX IF NOT EXISTS idx_record_tags_signal_approved_subject
  ON record_tags (subject_type, subject_id, taxonomy_term_id)
  WHERE review_status = 'approved';

COMMENT ON INDEX idx_metric_materializations_signal_facade IS
  'Supports Signal V2 home, metric-group and lineage lookups by exact canonical filter.';
COMMENT ON INDEX idx_mentions_signal_facets IS
  'Supports permission-aware facet and drill-down scans over included listening data.';
COMMENT ON INDEX idx_record_tags_signal_approved_subject IS
  'Keeps governed topic/emotion/narrative facets and drill-down on accepted evidence.';
