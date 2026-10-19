-- Explicit, append-only operator review for Acquisition Plan query versions.
-- A generated or manually edited query remains acquisition intent until approved.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE signal_governance_control_operations
  DROP CONSTRAINT IF EXISTS signal_governance_control_action;
ALTER TABLE signal_governance_control_operations
  ADD CONSTRAINT signal_governance_control_action CHECK(action IN (
    'create-quality-draft','create-retention-draft','create-licensing-draft',
    'activate-policy','create-provenance-binding-draft','activate-provenance-binding',
    'upsert-identity','update-timezone','reconcile-brand-os','create-source','import-source',
    'reconcile-governed-view','reconcile-strategic-authority','promote-strategic-authority',
    'reconcile-acquisition-plan','promote-acquisition-plan','create-acquisition-query',
    'review-acquisition-query','retire-acquisition-slot','decide-acquisition-reference',
    'retire-competitor','create-competitor','seal-acquisition-import','seal-acquisition-brief',
    'generate-acquisition-queries'
  ));

CREATE TABLE IF NOT EXISTS signal_acquisition_query_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  query_version_id uuid NOT NULL REFERENCES signal_acquisition_query_versions(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 1 AND 500),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  decided_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now(),
  event_hash text NOT NULL CHECK(event_hash ~ '^sha256:[0-9a-f]{64}$'),
  FOREIGN KEY(workspace_id,query_version_id)
    REFERENCES signal_acquisition_query_versions(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,operation_id),
  UNIQUE(workspace_id,event_hash)
);

CREATE INDEX IF NOT EXISTS idx_signal_acquisition_query_reviews_latest
  ON signal_acquisition_query_review_events(workspace_id,query_version_id,event_sequence DESC);

CREATE OR REPLACE FUNCTION validate_signal_acquisition_query_review_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target signal_acquisition_query_versions%ROWTYPE;
DECLARE parent_status text;
DECLARE operation signal_governance_control_operations%ROWTYPE;
BEGIN
  SELECT * INTO target FROM signal_acquisition_query_versions WHERE id=NEW.query_version_id;
  SELECT status INTO parent_status FROM signal_acquisition_plans WHERE id=target.plan_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF target.id IS NULL OR target.workspace_id<>NEW.workspace_id
     OR parent_status<>'draft' OR target.status<>'draft'
     OR operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.decided_by_user_id
     OR operation.action<>'review-acquisition-query' OR operation.status<>'in_progress'
     OR NEW.evidence_hash<>'sha256:'||encode(digest(convert_to(NEW.evidence,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION 'Acquisition query review authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_signal_acquisition_query_review_event_v1
  ON signal_acquisition_query_review_events;
CREATE TRIGGER validate_signal_acquisition_query_review_event_v1 BEFORE INSERT
  ON signal_acquisition_query_review_events FOR EACH ROW
  EXECUTE FUNCTION validate_signal_acquisition_query_review_event_v1();

CREATE OR REPLACE FUNCTION enforce_signal_acquisition_query_review_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Acquisition query review history is append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS enforce_signal_acquisition_query_review_append_only_v1
  ON signal_acquisition_query_review_events;
CREATE TRIGGER enforce_signal_acquisition_query_review_append_only_v1
  BEFORE UPDATE OR DELETE ON signal_acquisition_query_review_events
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_acquisition_query_review_append_only_v1();

COMMENT ON TABLE signal_acquisition_query_review_events IS
  'Append-only operator decisions for private provider query versions. This is acquisition approval, never semantic mention approval.';
