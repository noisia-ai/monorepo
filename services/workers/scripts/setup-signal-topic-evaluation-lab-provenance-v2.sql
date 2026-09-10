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
  source_membership_binding_digest text NOT NULL
    CHECK (source_membership_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
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
  source_membership_binding_digest,
  system_identifier
)
SELECT
  'noisia.topic-evaluation.disposable-lab-clone',
  'signal-topic-evaluation-lab-clone-provenance-v1',
  current_database(),
  snapshot.source_run_key,
  snapshot.snapshot_digest,
  snapshot.artifact_binding_digest,
  snapshot.membership_binding_digest,
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

-- The external receipt is created by the fixed host-side clone creator after this marker
-- exists. Persist its digest once, alongside a container identity digest, so a later
-- refinement-flight request cannot provide a merely well-formed but unrelated receipt.
CREATE TABLE noisia_topic_evaluation_lab.host_receipt_anchor (
  marker_id boolean PRIMARY KEY DEFAULT true CHECK (marker_id),
  contract_version text NOT NULL
    CHECK (contract_version = 'signal-topic-evaluation-lab-host-receipt-anchor-v1'),
  clone_name text NOT NULL,
  source_run_key text NOT NULL,
  source_snapshot_digest text NOT NULL CHECK (source_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_artifact_binding_digest text NOT NULL
    CHECK (source_artifact_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_membership_binding_digest text NOT NULL
    CHECK (source_membership_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]+$'),
  host_receipt_digest text NOT NULL CHECK (host_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  container_identity_digest text NOT NULL
    CHECK (container_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  anchor_digest text NOT NULL CHECK (anchor_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION noisia_topic_evaluation_lab.seal_host_receipt_anchor_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE marker noisia_topic_evaluation_lab.clone_provenance%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT'
     OR EXISTS (SELECT 1 FROM noisia_topic_evaluation_lab.host_receipt_anchor) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Topic Evaluation Lab host receipt anchor is immutable.';
  END IF;
  SELECT * INTO marker FROM noisia_topic_evaluation_lab.clone_provenance WHERE marker_id;
  IF marker.marker_id IS NULL OR current_database() <> marker.clone_name
     OR NEW.host_receipt_digest !~ '^sha256:[0-9a-f]{64}$'
     OR NEW.container_identity_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Topic Evaluation Lab host receipt anchor is invalid.';
  END IF;
  NEW.marker_id := true;
  NEW.contract_version := 'signal-topic-evaluation-lab-host-receipt-anchor-v1';
  NEW.clone_name := marker.clone_name;
  NEW.source_run_key := marker.source_run_key;
  NEW.source_snapshot_digest := marker.source_snapshot_digest;
  NEW.source_artifact_binding_digest := marker.source_artifact_binding_digest;
  NEW.source_membership_binding_digest := marker.source_membership_binding_digest;
  NEW.system_identifier := marker.system_identifier;
  NEW.anchor_digest := 'sha256:' || encode(digest(jsonb_build_object(
    'contract_version', NEW.contract_version,
    'clone_name', NEW.clone_name,
    'source_run_key', NEW.source_run_key,
    'source_snapshot_digest', NEW.source_snapshot_digest,
    'source_artifact_binding_digest', NEW.source_artifact_binding_digest,
    'source_membership_binding_digest', NEW.source_membership_binding_digest,
    'system_identifier', NEW.system_identifier,
    'host_receipt_digest', NEW.host_receipt_digest,
    'container_identity_digest', NEW.container_identity_digest
  )::text, 'sha256'), 'hex');
  RETURN NEW;
END
$function$;

CREATE TRIGGER signal_topic_evaluation_lab_host_receipt_anchor_immutable
BEFORE INSERT OR UPDATE OR DELETE
ON noisia_topic_evaluation_lab.host_receipt_anchor
FOR EACH ROW
EXECUTE FUNCTION noisia_topic_evaluation_lab.seal_host_receipt_anchor_v1();

CREATE TRIGGER signal_topic_evaluation_lab_host_receipt_anchor_no_truncate
BEFORE TRUNCATE
ON noisia_topic_evaluation_lab.host_receipt_anchor
FOR EACH STATEMENT
EXECUTE FUNCTION noisia_topic_evaluation_lab.reject_clone_provenance_mutation_v1();

ALTER TABLE noisia_topic_evaluation_lab.host_receipt_anchor
  ENABLE ALWAYS TRIGGER signal_topic_evaluation_lab_host_receipt_anchor_immutable;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON noisia_topic_evaluation_lab.host_receipt_anchor FROM PUBLIC;

COMMIT;
