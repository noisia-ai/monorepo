-- Clone-local setup marker for the disposable Full Evidence Topic Evaluation Lab.
--
-- Run this file only after creating the named loopback clone from the registered frozen source
-- and applying its hand-verified V2 migrations. The script accepts no variables: database name,
-- source identity, authority digests and PostgreSQL system identity are derived from the connected
-- server. The preflight itself is read-only and can neither create nor supply this marker.

BEGIN;

DO $guard$
DECLARE
  frozen_sources integer;
BEGIN
  IF current_database() !~ '^noisia_topic_eval_lab_[a-z0-9_]{8,64}$'
     OR current_database() ~ '(^|_)(preview|uat|staging|prod|production)(_|$)' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Topic Evaluation Lab clone name is invalid.';
  END IF;

  SELECT count(*)::integer
  INTO frozen_sources
  FROM signal_topic_evaluation_v2_snapshots
  WHERE source_run_key = 'backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17'
    AND state = 'frozen';

  IF frozen_sources <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Topic Evaluation Lab frozen source authority is invalid.';
  END IF;
END
$guard$;

CREATE SCHEMA noisia_topic_evaluation_lab;

CREATE TABLE noisia_topic_evaluation_lab.clone_provenance (
  marker_id boolean PRIMARY KEY DEFAULT true CHECK (marker_id),
  marker_namespace text NOT NULL
    CHECK (marker_namespace = 'noisia.topic-evaluation.disposable-lab-clone'),
  contract_version text NOT NULL
    CHECK (contract_version = 'signal-topic-evaluation-lab-clone-provenance-v1'),
  clone_name text NOT NULL,
  source_run_key text NOT NULL,
  source_snapshot_digest text NOT NULL CHECK (source_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_artifact_binding_digest text NOT NULL
    CHECK (source_artifact_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]+$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO noisia_topic_evaluation_lab.clone_provenance (
  marker_namespace,
  contract_version,
  clone_name,
  source_run_key,
  source_snapshot_digest,
  source_artifact_binding_digest,
  system_identifier
)
SELECT
  'noisia.topic-evaluation.disposable-lab-clone',
  'signal-topic-evaluation-lab-clone-provenance-v1',
  current_database(),
  snapshot.source_run_key,
  snapshot.snapshot_digest,
  snapshot.artifact_binding_digest,
  (pg_control_system()).system_identifier::text
FROM signal_topic_evaluation_v2_snapshots snapshot
WHERE snapshot.source_run_key =
  'backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17'
  AND snapshot.state = 'frozen';

CREATE FUNCTION noisia_topic_evaluation_lab.reject_clone_provenance_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = 'Topic Evaluation Lab clone provenance is immutable.';
END
$function$;

CREATE TRIGGER signal_topic_evaluation_lab_clone_provenance_immutable
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON noisia_topic_evaluation_lab.clone_provenance
FOR EACH STATEMENT
EXECUTE FUNCTION noisia_topic_evaluation_lab.reject_clone_provenance_mutation_v1();

ALTER TABLE noisia_topic_evaluation_lab.clone_provenance
  ENABLE ALWAYS TRIGGER signal_topic_evaluation_lab_clone_provenance_immutable;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON noisia_topic_evaluation_lab.clone_provenance FROM PUBLIC;

COMMIT;
