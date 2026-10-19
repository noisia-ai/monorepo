-- Query-pack quality is evaluated after ingest against mentions linked to the
-- exact query pack. Provider APIs may return later as optional adapters, but
-- they are not part of the production approval contract.

ALTER TABLE query_validation_runs
  ALTER COLUMN source_system SET DEFAULT 'imported_corpus',
  ALTER COLUMN sample_size_per_pack SET DEFAULT 100,
  ALTER COLUMN max_attempts SET DEFAULT 1;

COMMENT ON TABLE query_validation_runs IS
  'Post-ingest query-pack evaluation runs over imported corpus evidence.';

COMMENT ON COLUMN query_validation_runs.source_system IS
  'Evidence origin. Production Studio uses imported_corpus; provider adapters are optional.';

COMMENT ON COLUMN query_validation_attempts.attempt_kind IS
  'Evaluation phase. Current post-ingest flow writes one imported_evidence attempt per pack.';

COMMENT ON TABLE query_validation_mentions IS
  'Mention-level classifications copied from imported mentions for an auditable query-pack evaluation.';
