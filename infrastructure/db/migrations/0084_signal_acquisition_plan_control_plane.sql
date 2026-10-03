-- Signal Acquisition Plan control plane (workspace-owned, provider-neutral).
-- Forward-only. Sources remain connectors; slots express acquisition intent.
-- No row in this migration is semantic approval and no historical import is reclassified.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Connector identity and competitor lifecycle
-- ---------------------------------------------------------------------------

ALTER TABLE data_sources
  ADD COLUMN IF NOT EXISTS source_contract_version text,
  ADD COLUMN IF NOT EXISTS source_key text;

UPDATE data_sources
SET source_contract_version='signal-data-source-scope-compat-v1'
WHERE source_contract_version IS NULL;

UPDATE data_sources
SET source_key='source-sha256-' || encode(digest(convert_to(id::text,'UTF8'),'sha256'),'hex')
WHERE source_key IS NULL;

ALTER TABLE data_sources ALTER COLUMN source_contract_version SET NOT NULL;
ALTER TABLE data_sources ALTER COLUMN source_key SET NOT NULL;
ALTER TABLE data_sources ALTER COLUMN source_contract_version SET DEFAULT 'signal-data-source-scope-compat-v1';
ALTER TABLE data_sources ALTER COLUMN source_key SET DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_sources_workspace_source_key
  ON data_sources(workspace_id,source_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_sources_workspace_id
  ON data_sources(workspace_id,id);

CREATE OR REPLACE FUNCTION enforce_signal_data_source_connector_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND (NEW.source_key IS NULL OR NEW.source_key='') THEN
    NEW.source_key:='source-sha256-' || encode(digest(convert_to(NEW.id::text,'UTF8'),'sha256'),'hex');
  END IF;
  IF TG_OP='INSERT' AND NEW.source_contract_version IS NULL THEN
    NEW.source_contract_version:='signal-data-source-scope-compat-v1';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
      OR OLD.source_key IS DISTINCT FROM NEW.source_key
      OR OLD.source_contract_version IS DISTINCT FROM NEW.source_contract_version) THEN
    RAISE EXCEPTION 'Signal data source connector identity is immutable.' USING ERRCODE='55000';
  END IF;
  IF NEW.source_key !~ '^source-sha256-[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Signal data source key is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.source_contract_version='signal-data-source-connector-v1' AND (
      NEW.governed_scope IS NOT NULL OR NEW.governed_entity_type IS NOT NULL
      OR NEW.governed_entity_id IS NOT NULL OR NEW.scope_policy_version IS NOT NULL
      OR NEW.scope_approved_by_user_id IS NOT NULL OR NEW.scope_approval_source IS NOT NULL
      OR NEW.scope_approved_at IS NOT NULL OR NEW.scope_review_status<>'pending') THEN
    RAISE EXCEPTION 'Connector-only sources cannot contain semantic authority.' USING ERRCODE='23514';
  END IF;
  IF NEW.source_contract_version NOT IN (
      'signal-data-source-connector-v1','signal-data-source-scope-compat-v1') THEN
    RAISE EXCEPTION 'Signal data source contract is unsupported.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_signal_data_source_connector_v1 ON data_sources;
CREATE TRIGGER enforce_signal_data_source_connector_v1
  BEFORE INSERT OR UPDATE ON data_sources
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_data_source_connector_v1();

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS effective_from timestamptz,
  ADD COLUMN IF NOT EXISTS effective_to timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

UPDATE competitors SET status='current' WHERE status IS NULL;
UPDATE competitors SET effective_from=created_at WHERE effective_from IS NULL;
UPDATE competitors SET updated_at=created_at WHERE updated_at IS NULL;
ALTER TABLE competitors ALTER COLUMN status SET NOT NULL;
ALTER TABLE competitors ALTER COLUMN effective_from SET NOT NULL;
ALTER TABLE competitors ALTER COLUMN updated_at SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='competitors_lifecycle_shape') THEN
    ALTER TABLE competitors ADD CONSTRAINT competitors_lifecycle_shape CHECK (
      (status='current' AND effective_to IS NULL AND retired_by_user_id IS NULL)
      OR (status='retired' AND effective_to IS NOT NULL AND retired_by_user_id IS NOT NULL
          AND effective_to>=effective_from)
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS signal_competitor_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  event_index integer NOT NULL CHECK(event_index>=0),
  event_kind text NOT NULL CHECK(event_kind IN ('created','retired','reactivated')),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_status text,
  next_status text NOT NULL CHECK(next_status IN ('current','retired')),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  event_digest text NOT NULL CHECK(event_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id,event_index)
);
CREATE INDEX IF NOT EXISTS idx_signal_competitor_lifecycle_history
  ON signal_competitor_lifecycle_events(workspace_id,competitor_id,created_at,id);

CREATE OR REPLACE FUNCTION protect_signal_competitor_history_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Signal competitor history is append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS protect_signal_competitor_lifecycle_events_v1 ON signal_competitor_lifecycle_events;
CREATE TRIGGER protect_signal_competitor_lifecycle_events_v1
  BEFORE UPDATE OR DELETE ON signal_competitor_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION protect_signal_competitor_history_v1();
DROP TRIGGER IF EXISTS protect_signal_competitor_delete_v1 ON competitors;
CREATE TRIGGER protect_signal_competitor_delete_v1
  BEFORE DELETE ON competitors FOR EACH ROW EXECUTE FUNCTION protect_signal_competitor_history_v1();

CREATE OR REPLACE FUNCTION validate_signal_competitor_lifecycle_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE competitor_row competitors%ROWTYPE;DECLARE workspace_brand_id uuid;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT * INTO competitor_row FROM competitors WHERE id=NEW.competitor_id;
  SELECT brand_id INTO workspace_brand_id FROM signal_workspaces WHERE id=NEW.workspace_id;
  IF operation.id IS NULL OR competitor_row.id IS NULL OR workspace_brand_id IS NULL
     OR operation.workspace_id<>NEW.workspace_id OR operation.actor_user_id<>NEW.actor_user_id
     OR competitor_row.brand_id<>workspace_brand_id
     OR operation.action<>(CASE NEW.event_kind
       WHEN 'retired' THEN 'retire-competitor' ELSE 'create-competitor' END)
     OR (NEW.event_kind='created' AND (NEW.previous_status IS NOT NULL OR NEW.next_status<>'current'))
     OR (NEW.event_kind='reactivated' AND (NEW.previous_status<>'retired' OR NEW.next_status<>'current'))
     OR (NEW.event_kind='retired' AND (NEW.previous_status<>'current' OR NEW.next_status<>'retired'))
     OR competitor_row.status<>NEW.next_status THEN
    RAISE EXCEPTION 'Competitor lifecycle event authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_competitor_lifecycle_event_v1 ON signal_competitor_lifecycle_events;
CREATE TRIGGER validate_signal_competitor_lifecycle_event_v1 BEFORE INSERT
  ON signal_competitor_lifecycle_events FOR EACH ROW
  EXECUTE FUNCTION validate_signal_competitor_lifecycle_event_v1();

CREATE OR REPLACE FUNCTION enforce_signal_competitor_lifecycle_writer_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation_id uuid;DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE workspace_id uuid;DECLARE expected_action text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.effective_from IS NOT DISTINCT FROM NEW.effective_from
     AND OLD.effective_to IS NOT DISTINCT FROM NEW.effective_to
     AND OLD.retired_by_user_id IS NOT DISTINCT FROM NEW.retired_by_user_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    operation_id:=NULLIF(current_setting('noisia.competitor_lifecycle_operation_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN operation_id:=NULL;
  END;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=operation_id;
  workspace_id:=operation.workspace_id;
  expected_action:=CASE WHEN NEW.status='retired' THEN 'retire-competitor' ELSE 'create-competitor' END;
  IF operation.id IS NULL OR workspace_id IS NULL OR operation.workspace_id<>workspace_id
     OR operation.action<>expected_action OR operation.status<>'in_progress'
     OR NOT EXISTS(SELECT 1 FROM signal_workspaces workspace
       WHERE workspace.id=workspace_id AND workspace.brand_id=NEW.brand_id)
     OR NOT signal_data_governance_actor_is_valid(workspace_id,operation.actor_user_id)
     OR (NEW.status='retired' AND NEW.retired_by_user_id<>operation.actor_user_id) THEN
    RAISE EXCEPTION 'Competitor lifecycle requires the server-owned writer.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_signal_competitor_lifecycle_writer_v1 ON competitors;
CREATE TRIGGER enforce_signal_competitor_lifecycle_writer_v1 BEFORE UPDATE
  ON competitors FOR EACH ROW EXECUTE FUNCTION enforce_signal_competitor_lifecycle_writer_v1();

CREATE OR REPLACE FUNCTION require_signal_competitor_lifecycle_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_operation_id uuid;DECLARE expected_kind text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.effective_from IS NOT DISTINCT FROM NEW.effective_from
     AND OLD.effective_to IS NOT DISTINCT FROM NEW.effective_to
     AND OLD.retired_by_user_id IS NOT DISTINCT FROM NEW.retired_by_user_id THEN
    RETURN NULL;
  END IF;
  target_operation_id:=NULLIF(current_setting('noisia.competitor_lifecycle_operation_id',true),'')::uuid;
  expected_kind:=CASE WHEN NEW.status='retired' THEN 'retired' ELSE 'reactivated' END;
  IF target_operation_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM signal_competitor_lifecycle_events event
    WHERE event.operation_id=target_operation_id AND event.competitor_id=NEW.id
      AND event.event_kind=expected_kind AND event.next_status=NEW.status
  ) THEN
    RAISE EXCEPTION 'Competitor lifecycle event is required.' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS require_signal_competitor_lifecycle_event_v1 ON competitors;
CREATE CONSTRAINT TRIGGER require_signal_competitor_lifecycle_event_v1
  AFTER UPDATE ON competitors DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION require_signal_competitor_lifecycle_event_v1();

-- ---------------------------------------------------------------------------
-- Plans, reference decisions, versioned slots and queries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signal_acquisition_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  plan_version integer NOT NULL CHECK(plan_version>0),
  status text NOT NULL CHECK(status IN ('draft','current','retired')),
  brand_os_profile_id uuid NOT NULL REFERENCES brand_os_profiles(id) ON DELETE RESTRICT,
  brand_os_profile_version integer NOT NULL CHECK(brand_os_profile_version>0),
  brand_os_digest text NOT NULL CHECK(brand_os_digest ~ '^sha256:[0-9a-f]{64}$'),
  identity_catalog_digest text NOT NULL CHECK(identity_catalog_digest ~ '^sha256:[0-9a-f]{64}$'),
  draft_revision integer NOT NULL DEFAULT 0 CHECK(draft_revision>=0),
  draft_digest text NOT NULL CHECK(draft_digest ~ '^sha256:[0-9a-f]{64}$'),
  definition_hash text CHECK(definition_hash IS NULL OR definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  supersedes_plan_id uuid REFERENCES signal_acquisition_plans(id) ON DELETE RESTRICT,
  effective_from timestamptz,
  effective_to timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  promoted_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  retired_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  retired_at timestamptz,
  creation_idempotency_key text NOT NULL CHECK(creation_idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE(workspace_id,plan_version),
  UNIQUE(workspace_id,creation_idempotency_key),
  UNIQUE(workspace_id,id),
  CHECK(
    (status='draft' AND definition_hash IS NULL AND effective_from IS NULL
      AND promoted_by_user_id IS NULL AND promoted_at IS NULL AND retired_by_user_id IS NULL
      AND retired_at IS NULL AND effective_to IS NULL)
    OR (status='current' AND definition_hash=draft_digest AND effective_from IS NOT NULL
      AND promoted_by_user_id IS NOT NULL AND promoted_at IS NOT NULL
      AND retired_by_user_id IS NULL AND retired_at IS NULL AND effective_to IS NULL)
    OR (status='retired' AND definition_hash=draft_digest AND effective_from IS NOT NULL
      AND promoted_by_user_id IS NOT NULL AND promoted_at IS NOT NULL
      AND retired_by_user_id IS NOT NULL AND retired_at IS NOT NULL
      AND effective_to IS NOT NULL AND effective_to>=effective_from)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_acquisition_plan_current
  ON signal_acquisition_plans(workspace_id) WHERE status='current';
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_acquisition_plan_open_draft
  ON signal_acquisition_plans(workspace_id) WHERE status='draft';

CREATE TABLE IF NOT EXISTS signal_acquisition_reference_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  intelligence_entity_id uuid NOT NULL REFERENCES intelligence_entities(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('include','exclude','revert')),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 500),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  decision_hash text NOT NULL CHECK(decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  supersedes_decision_id uuid REFERENCES signal_acquisition_reference_decisions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
DROP INDEX IF EXISTS uq_signal_acquisition_reference_current;
CREATE INDEX IF NOT EXISTS idx_signal_acquisition_reference_history
  ON signal_acquisition_reference_decisions(workspace_id,intelligence_entity_id,created_at,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_acquisition_reference_genesis
  ON signal_acquisition_reference_decisions(workspace_id,intelligence_entity_id)
  WHERE supersedes_decision_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_acquisition_reference_successor
  ON signal_acquisition_reference_decisions(supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_acquisition_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  slot_key text NOT NULL,
  slot_version integer NOT NULL CHECK(slot_version>0),
  scope text NOT NULL CHECK(scope IN ('primary_brand','competitor','category','reference')),
  entity_type text NOT NULL CHECK(entity_type IN ('brand','competitor','category','reference')),
  entity_id uuid NOT NULL,
  entity_revision_digest text NOT NULL CHECK(entity_revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 300),
  desired_state text NOT NULL CHECK(desired_state IN ('active','retired')),
  position integer NOT NULL CHECK(position>=0),
  supersedes_slot_id uuid REFERENCES signal_acquisition_slots(id) ON DELETE RESTRICT,
  reference_decision_id uuid REFERENCES signal_acquisition_reference_decisions(id) ON DELETE RESTRICT,
  definition_hash text NOT NULL CHECK(definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,plan_id) REFERENCES signal_acquisition_plans(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(plan_id,slot_key,slot_version),
  UNIQUE(workspace_id,slot_key,slot_version),
  CHECK(slot_key='primary-brand' OR slot_key ~ '^(competitor|category|reference)-sha256-[0-9a-f]{64}$'),
  CHECK((scope='primary_brand' AND entity_type='brand' AND slot_key='primary-brand' AND reference_decision_id IS NULL)
    OR (scope='competitor' AND entity_type='competitor' AND reference_decision_id IS NULL)
    OR (scope='category' AND entity_type='category' AND reference_decision_id IS NULL)
    OR (scope='reference' AND entity_type='reference'
      AND ((desired_state='active' AND reference_decision_id IS NOT NULL) OR desired_state='retired')))
);
ALTER TABLE signal_acquisition_slots
  DROP CONSTRAINT IF EXISTS signal_acquisition_slots_plan_id_position_key;
CREATE INDEX IF NOT EXISTS idx_signal_acquisition_slots_plan
  ON signal_acquisition_slots(workspace_id,plan_id,position);
CREATE INDEX IF NOT EXISTS idx_signal_acquisition_slots_identity
  ON signal_acquisition_slots(workspace_id,scope,entity_id,plan_id);

CREATE TABLE IF NOT EXISTS signal_acquisition_query_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  slot_id uuid NOT NULL,
  query_key text NOT NULL CHECK(query_key ~ '^query-sha256-[0-9a-f]{64}$'),
  query_version integer NOT NULL CHECK(query_version>0),
  data_source_id uuid NOT NULL,
  provider_key text NOT NULL CHECK(provider_key IN ('sentione')),
  provider_syntax_version text NOT NULL CHECK(length(btrim(provider_syntax_version)) BETWEEN 1 AND 100),
  provider_schema_version text NOT NULL CHECK(provider_schema_version IN ('sentione-csv-47-v1')),
  query_text_private text NOT NULL CHECK(length(query_text_private) BETWEEN 1 AND 50000),
  structured_terms jsonb NOT NULL,
  query_hash text NOT NULL CHECK(query_hash ~ '^sha256:[0-9a-f]{64}$'),
  definition_hash text NOT NULL CHECK(definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  cadence text NOT NULL CHECK(cadence IN ('manual','ad-hoc','daily','weekly','monthly')),
  default_period_start date,
  default_period_end date,
  timezone text NOT NULL CHECK(length(btrim(timezone)) BETWEEN 1 AND 100),
  status text NOT NULL CHECK(status IN ('draft','current','superseded','retired')),
  effective_from timestamptz,
  effective_to timestamptz,
  supersedes_query_version_id uuid REFERENCES signal_acquisition_query_versions(id) ON DELETE RESTRICT,
  carried_from_query_version_id uuid REFERENCES signal_acquisition_query_versions(id) ON DELETE RESTRICT,
  origin_kind text NOT NULL CHECK(origin_kind IN ('operator','legacy-query-pack')),
  origin_reference_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  creation_idempotency_key text NOT NULL CHECK(creation_idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
  FOREIGN KEY(workspace_id,plan_id) REFERENCES signal_acquisition_plans(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,slot_id) REFERENCES signal_acquisition_slots(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,data_source_id) REFERENCES data_sources(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,creation_idempotency_key),
  UNIQUE(workspace_id,plan_id,query_key,query_version),
  CHECK((default_period_start IS NULL AND default_period_end IS NULL)
    OR (default_period_start IS NOT NULL AND default_period_end IS NOT NULL
      AND default_period_end>=default_period_start)),
  CHECK(effective_to IS NULL OR effective_from IS NOT NULL AND effective_to>=effective_from)
);
CREATE INDEX IF NOT EXISTS idx_signal_acquisition_queries_slot
  ON signal_acquisition_query_versions(workspace_id,plan_id,slot_id,provider_key,data_source_id,query_version DESC);

CREATE TABLE IF NOT EXISTS signal_acquisition_plan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  event_index integer NOT NULL CHECK(event_index>=0),
  event_kind text NOT NULL CHECK(event_kind IN (
    'draft-created','draft-reconciled','promoted','retired','slot-retired',
    'query-created','query-superseded','query-carried-forward','reference-decided','import-sealed',
    'drift-detected','rollback-promoted'
  )),
  plan_id uuid REFERENCES signal_acquisition_plans(id) ON DELETE RESTRICT,
  slot_id uuid REFERENCES signal_acquisition_slots(id) ON DELETE RESTRICT,
  query_version_id uuid REFERENCES signal_acquisition_query_versions(id) ON DELETE RESTRICT,
  reference_decision_id uuid REFERENCES signal_acquisition_reference_decisions(id) ON DELETE RESTRICT,
  import_batch_id uuid REFERENCES import_batches(id) ON DELETE RESTRICT,
  previous_state_digest text CHECK(previous_state_digest IS NULL OR previous_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  next_state_digest text NOT NULL CHECK(next_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_digest text NOT NULL CHECK(event_digest ~ '^sha256:[0-9a-f]{64}$'),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id,event_index)
);
CREATE INDEX IF NOT EXISTS idx_signal_acquisition_plan_events_workspace
  ON signal_acquisition_plan_events(workspace_id,created_at,id);

CREATE OR REPLACE FUNCTION protect_signal_acquisition_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Signal acquisition domain history is append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS protect_signal_acquisition_reference_decisions_v1 ON signal_acquisition_reference_decisions;
CREATE TRIGGER protect_signal_acquisition_reference_decisions_v1 BEFORE UPDATE OR DELETE
  ON signal_acquisition_reference_decisions FOR EACH ROW EXECUTE FUNCTION protect_signal_acquisition_append_only_v1();
DROP TRIGGER IF EXISTS protect_signal_acquisition_slots_v1 ON signal_acquisition_slots;
CREATE TRIGGER protect_signal_acquisition_slots_v1 BEFORE UPDATE OR DELETE
  ON signal_acquisition_slots FOR EACH ROW EXECUTE FUNCTION protect_signal_acquisition_append_only_v1();
DROP TRIGGER IF EXISTS protect_signal_acquisition_plan_events_v1 ON signal_acquisition_plan_events;
CREATE TRIGGER protect_signal_acquisition_plan_events_v1 BEFORE UPDATE OR DELETE
  ON signal_acquisition_plan_events FOR EACH ROW EXECUTE FUNCTION protect_signal_acquisition_append_only_v1();

CREATE OR REPLACE FUNCTION validate_signal_acquisition_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;DECLARE expected_action text;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  expected_action:=CASE NEW.event_kind
    WHEN 'draft-created' THEN 'reconcile-acquisition-plan'
    WHEN 'draft-reconciled' THEN 'reconcile-acquisition-plan'
    WHEN 'drift-detected' THEN 'reconcile-acquisition-plan'
    WHEN 'promoted' THEN 'promote-acquisition-plan'
    WHEN 'rollback-promoted' THEN 'promote-acquisition-plan'
    WHEN 'slot-retired' THEN 'retire-acquisition-slot'
    WHEN 'query-created' THEN 'create-acquisition-query'
    WHEN 'query-superseded' THEN 'create-acquisition-query'
    WHEN 'query-carried-forward' THEN 'reconcile-acquisition-plan'
    WHEN 'reference-decided' THEN 'decide-acquisition-reference'
    WHEN 'import-sealed' THEN 'seal-acquisition-import'
    WHEN 'retired' THEN 'promote-acquisition-plan'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.action<>expected_action
     OR (NEW.plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_acquisition_plans
       WHERE id=NEW.plan_id AND workspace_id=NEW.workspace_id))
     OR (NEW.slot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_acquisition_slots
       WHERE id=NEW.slot_id AND workspace_id=NEW.workspace_id))
     OR (NEW.query_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_acquisition_query_versions
       WHERE id=NEW.query_version_id AND workspace_id=NEW.workspace_id))
     OR (NEW.reference_decision_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM signal_acquisition_reference_decisions decision
       WHERE decision.id=NEW.reference_decision_id AND decision.workspace_id=NEW.workspace_id
         AND decision.operation_id=NEW.operation_id))
     OR (NEW.import_batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM import_batches
       WHERE id=NEW.import_batch_id AND workspace_id=NEW.workspace_id))
     OR (NEW.plan_id IS NOT NULL AND NEW.slot_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM signal_acquisition_slots slot
       WHERE slot.id=NEW.slot_id AND slot.plan_id=NEW.plan_id AND slot.workspace_id=NEW.workspace_id))
     OR (NEW.query_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM signal_acquisition_query_versions query
       WHERE query.id=NEW.query_version_id AND query.workspace_id=NEW.workspace_id
         AND (NEW.plan_id IS NULL OR query.plan_id=NEW.plan_id)
         AND (NEW.slot_id IS NULL OR query.slot_id=NEW.slot_id)))
     OR (NEW.import_batch_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM import_batches batch WHERE batch.id=NEW.import_batch_id
         AND batch.workspace_id=NEW.workspace_id
         AND (NEW.plan_id IS NULL OR batch.acquisition_plan_id=NEW.plan_id)
         AND (NEW.slot_id IS NULL OR batch.acquisition_slot_id=NEW.slot_id)
         AND (NEW.query_version_id IS NULL OR batch.acquisition_query_version_id=NEW.query_version_id)))
     OR (NEW.event_kind='reference-decided' AND NEW.reference_decision_id IS NULL)
     OR (NEW.event_kind<>'reference-decided' AND NEW.reference_decision_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Acquisition event authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_acquisition_event_v1 ON signal_acquisition_plan_events;
CREATE TRIGGER validate_signal_acquisition_event_v1 BEFORE INSERT
  ON signal_acquisition_plan_events FOR EACH ROW EXECUTE FUNCTION validate_signal_acquisition_event_v1();

CREATE OR REPLACE FUNCTION enforce_signal_acquisition_query_history_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Signal acquisition query history is append-only.' USING ERRCODE='55000';
  END IF;
  SELECT status INTO parent_status FROM signal_acquisition_plans WHERE id=OLD.plan_id;
  IF parent_status<>'draft' OR OLD.status<>'draft'
     OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.plan_id IS DISTINCT FROM NEW.plan_id OR OLD.slot_id IS DISTINCT FROM NEW.slot_id
     OR OLD.query_key IS DISTINCT FROM NEW.query_key OR OLD.query_version IS DISTINCT FROM NEW.query_version
     OR OLD.data_source_id IS DISTINCT FROM NEW.data_source_id
     OR OLD.provider_key IS DISTINCT FROM NEW.provider_key
     OR OLD.provider_syntax_version IS DISTINCT FROM NEW.provider_syntax_version
     OR OLD.provider_schema_version IS DISTINCT FROM NEW.provider_schema_version
     OR OLD.query_text_private IS DISTINCT FROM NEW.query_text_private
     OR OLD.structured_terms IS DISTINCT FROM NEW.structured_terms
     OR OLD.query_hash IS DISTINCT FROM NEW.query_hash
     OR OLD.definition_hash IS DISTINCT FROM NEW.definition_hash
     OR OLD.cadence IS DISTINCT FROM NEW.cadence
     OR OLD.default_period_start IS DISTINCT FROM NEW.default_period_start
     OR OLD.default_period_end IS DISTINCT FROM NEW.default_period_end
     OR OLD.timezone IS DISTINCT FROM NEW.timezone
     OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
     OR OLD.supersedes_query_version_id IS DISTINCT FROM NEW.supersedes_query_version_id
     OR OLD.carried_from_query_version_id IS DISTINCT FROM NEW.carried_from_query_version_id
     OR OLD.origin_kind IS DISTINCT FROM NEW.origin_kind
     OR OLD.origin_reference_id IS DISTINCT FROM NEW.origin_reference_id
     OR OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.creation_idempotency_key IS DISTINCT FROM NEW.creation_idempotency_key
     OR OLD.request_digest IS DISTINCT FROM NEW.request_digest
     OR NEW.status NOT IN ('current','superseded','retired') THEN
    RAISE EXCEPTION 'Signal acquisition query composition is immutable.' USING ERRCODE='55000';
  END IF;
  IF (NEW.status='current' AND NEW.effective_to IS NOT NULL)
     OR (NEW.status IN ('superseded','retired') AND NEW.effective_to IS NULL) THEN
    RAISE EXCEPTION 'Signal acquisition query lifecycle is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_signal_acquisition_query_history_v1 ON signal_acquisition_query_versions;
CREATE TRIGGER enforce_signal_acquisition_query_history_v1 BEFORE UPDATE OR DELETE
  ON signal_acquisition_query_versions FOR EACH ROW EXECUTE FUNCTION enforce_signal_acquisition_query_history_v1();

CREATE OR REPLACE FUNCTION enforce_signal_acquisition_plan_transition_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Signal acquisition plans are append-only.' USING ERRCODE='55000'; END IF;
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.plan_version IS DISTINCT FROM NEW.plan_version
     OR OLD.supersedes_plan_id IS DISTINCT FROM NEW.supersedes_plan_id
     OR OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.creation_idempotency_key IS DISTINCT FROM NEW.creation_idempotency_key
     OR OLD.request_digest IS DISTINCT FROM NEW.request_digest THEN
    RAISE EXCEPTION 'Signal acquisition plan authority is immutable.' USING ERRCODE='55000';
  END IF;
  IF OLD.status='draft' AND NEW.status='draft' THEN
    IF NEW.definition_hash IS NOT NULL OR NEW.draft_revision<>OLD.draft_revision+1
       OR NEW.draft_digest=OLD.draft_digest
       OR NOT EXISTS(SELECT 1 FROM signal_workspaces workspace
         JOIN brand_os_profiles profile ON profile.organization_id=workspace.organization_id
           AND profile.brand_id=workspace.brand_id
         WHERE workspace.id=NEW.workspace_id AND profile.id=NEW.brand_os_profile_id
           AND profile.version=NEW.brand_os_profile_version AND profile.status='active') THEN
      RAISE EXCEPTION 'Signal acquisition draft CAS is invalid.' USING ERRCODE='40001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='draft' AND NEW.status='current' THEN
    IF NEW.brand_os_profile_id<>OLD.brand_os_profile_id
       OR NEW.brand_os_profile_version<>OLD.brand_os_profile_version
       OR NEW.brand_os_digest<>OLD.brand_os_digest
       OR NEW.identity_catalog_digest<>OLD.identity_catalog_digest
       OR NEW.definition_hash IS DISTINCT FROM OLD.draft_digest
       OR NEW.draft_revision<>OLD.draft_revision OR NEW.draft_digest<>OLD.draft_digest
       OR NEW.effective_from>clock_timestamp()
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.promoted_by_user_id) THEN
      RAISE EXCEPTION 'Signal acquisition promotion does not seal the draft.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='current' AND NEW.status='retired' THEN
    IF NEW.brand_os_profile_id<>OLD.brand_os_profile_id
       OR NEW.brand_os_profile_version<>OLD.brand_os_profile_version
       OR NEW.brand_os_digest<>OLD.brand_os_digest
       OR NEW.identity_catalog_digest<>OLD.identity_catalog_digest
       OR NEW.definition_hash<>OLD.definition_hash OR NEW.draft_digest<>OLD.draft_digest
       OR NEW.draft_revision<>OLD.draft_revision
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.retired_by_user_id) THEN
      RAISE EXCEPTION 'Signal acquisition retirement changed authority.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Signal acquisition plan transition is invalid.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS enforce_signal_acquisition_plan_transition_v1 ON signal_acquisition_plans;
CREATE TRIGGER enforce_signal_acquisition_plan_transition_v1 BEFORE UPDATE OR DELETE
  ON signal_acquisition_plans FOR EACH ROW EXECUTE FUNCTION enforce_signal_acquisition_plan_transition_v1();

CREATE OR REPLACE FUNCTION validate_signal_acquisition_authority_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace signal_workspaces%ROWTYPE;DECLARE plan signal_acquisition_plans%ROWTYPE;
DECLARE source data_sources%ROWTYPE;DECLARE ref signal_acquisition_reference_decisions%ROWTYPE;
DECLARE valid boolean;
BEGIN
  SELECT * INTO workspace FROM signal_workspaces WHERE id=NEW.workspace_id;
  IF workspace.id IS NULL THEN RAISE EXCEPTION 'Acquisition workspace is missing.' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='signal_acquisition_plans' THEN
    SELECT EXISTS(SELECT 1 FROM brand_os_profiles profile
      WHERE profile.id=NEW.brand_os_profile_id AND profile.organization_id=workspace.organization_id
        AND profile.brand_id=workspace.brand_id AND profile.version=NEW.brand_os_profile_version
        AND profile.status='active') INTO valid;
    valid:=valid AND signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id);
    valid:=valid AND EXISTS(SELECT 1 FROM signal_governance_control_operations operation
      WHERE operation.workspace_id=NEW.workspace_id
        AND operation.idempotency_key=NEW.creation_idempotency_key
        AND operation.actor_user_id=NEW.created_by_user_id
        AND operation.action='reconcile-acquisition-plan' AND operation.status='in_progress');
    IF NEW.supersedes_plan_id IS NOT NULL THEN
      valid:=valid AND EXISTS(SELECT 1 FROM signal_acquisition_plans prior
        WHERE prior.id=NEW.supersedes_plan_id AND prior.workspace_id=NEW.workspace_id
          AND prior.plan_version=NEW.plan_version-1 AND prior.status IN ('current','retired'));
    END IF;
    IF NOT valid THEN RAISE EXCEPTION 'Acquisition plan authority is invalid.' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='signal_acquisition_reference_decisions' THEN
    SELECT EXISTS(SELECT 1 FROM intelligence_entities entity
      WHERE entity.id=NEW.intelligence_entity_id AND entity.organization_id=workspace.organization_id
        AND entity.brand_id=workspace.brand_id AND entity.entity_type='reference' AND entity.status='active') INTO valid;
    valid:=valid AND EXISTS(SELECT 1 FROM signal_governance_control_operations operation
      WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
        AND operation.actor_user_id=NEW.actor_user_id AND operation.action='decide-acquisition-reference');
    valid:=valid AND signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id);
    IF NEW.supersedes_decision_id IS NOT NULL THEN
      valid:=valid AND EXISTS(SELECT 1 FROM signal_acquisition_reference_decisions prior
        WHERE prior.id=NEW.supersedes_decision_id AND prior.workspace_id=NEW.workspace_id
          AND prior.intelligence_entity_id=NEW.intelligence_entity_id);
    END IF;
    IF NOT valid THEN RAISE EXCEPTION 'Reference decision authority is invalid.' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='signal_acquisition_slots' THEN
    SELECT * INTO plan FROM signal_acquisition_plans WHERE id=NEW.plan_id AND workspace_id=NEW.workspace_id;
    IF plan.status<>'draft' OR NOT signal_data_governance_actor_is_valid(
      NEW.workspace_id,NEW.created_by_user_id) THEN
      RAISE EXCEPTION 'Slots can only be appended to an authorized draft.' USING ERRCODE='55000';
    END IF;
    IF NEW.scope='primary_brand' THEN valid:=NEW.entity_id=workspace.brand_id;
    ELSIF NEW.scope='competitor' THEN
      SELECT EXISTS(SELECT 1 FROM competitors competitor JOIN brand_seeds seed
        ON seed.id=competitor.competitor_brand_seed_id AND seed.active=true
        WHERE competitor.id=NEW.entity_id AND competitor.brand_id=workspace.brand_id
          AND competitor.status='current') INTO valid;
    ELSE
      SELECT EXISTS(SELECT 1 FROM intelligence_entities entity
        WHERE entity.id=NEW.entity_id AND entity.organization_id=workspace.organization_id
          AND entity.brand_id=workspace.brand_id AND entity.entity_type=NEW.entity_type
          AND entity.status='active') INTO valid;
    END IF;
    IF NOT valid THEN RAISE EXCEPTION 'Acquisition slot entity authority is invalid.' USING ERRCODE='23514'; END IF;
    IF NEW.supersedes_slot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_acquisition_slots prior
      WHERE prior.id=NEW.supersedes_slot_id AND prior.workspace_id=NEW.workspace_id
        AND prior.slot_key=NEW.slot_key
        AND prior.slot_version=NEW.slot_version-1) THEN
      RAISE EXCEPTION 'Acquisition slot supersession is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.scope='reference' AND NEW.desired_state='active' THEN
      SELECT * INTO ref FROM signal_acquisition_reference_decisions
      WHERE id=NEW.reference_decision_id AND workspace_id=NEW.workspace_id
        AND intelligence_entity_id=NEW.entity_id AND action='include'
        AND effective_from<=clock_timestamp()
        AND (effective_to IS NULL OR effective_to>clock_timestamp())
        AND NOT EXISTS(SELECT 1 FROM signal_acquisition_reference_decisions successor
          WHERE successor.workspace_id=signal_acquisition_reference_decisions.workspace_id
            AND successor.intelligence_entity_id=signal_acquisition_reference_decisions.intelligence_entity_id
            AND successor.effective_from<=clock_timestamp()
            AND (successor.effective_to IS NULL OR successor.effective_to>clock_timestamp())
            AND (successor.effective_from>signal_acquisition_reference_decisions.effective_from
              OR (successor.effective_from=signal_acquisition_reference_decisions.effective_from
                AND (successor.created_at,successor.id)>(signal_acquisition_reference_decisions.created_at,
                  signal_acquisition_reference_decisions.id))));
      IF ref.id IS NULL THEN RAISE EXCEPTION 'Reference inclusion decision is unavailable.' USING ERRCODE='23514'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='signal_acquisition_query_versions' THEN
    SELECT * INTO plan FROM signal_acquisition_plans WHERE id=NEW.plan_id AND workspace_id=NEW.workspace_id;
    SELECT * INTO source FROM data_sources WHERE id=NEW.data_source_id AND workspace_id=NEW.workspace_id;
    IF plan.status<>'draft' OR source.id IS NULL OR source.status<>'active'
       OR source.source_contract_version<>'signal-data-source-connector-v1'
       OR source.provider<>NEW.provider_key
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
       OR NOT EXISTS(SELECT 1 FROM signal_acquisition_slots slot
         WHERE slot.id=NEW.slot_id AND slot.plan_id=NEW.plan_id AND slot.workspace_id=NEW.workspace_id)
       OR (NEW.supersedes_query_version_id IS NOT NULL AND NOT EXISTS(
         SELECT 1 FROM signal_acquisition_query_versions prior
         WHERE prior.id=NEW.supersedes_query_version_id AND prior.workspace_id=NEW.workspace_id
           AND prior.plan_id=NEW.plan_id AND prior.slot_id=NEW.slot_id
           AND prior.query_key=NEW.query_key AND prior.query_version=NEW.query_version-1)) THEN
      RAISE EXCEPTION 'Acquisition query authority is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_acquisition_reference_decision_v1 ON signal_acquisition_reference_decisions;
DROP TRIGGER IF EXISTS validate_signal_acquisition_plan_v1 ON signal_acquisition_plans;
CREATE TRIGGER validate_signal_acquisition_plan_v1 BEFORE INSERT
  ON signal_acquisition_plans FOR EACH ROW EXECUTE FUNCTION validate_signal_acquisition_authority_v1();
CREATE TRIGGER validate_signal_acquisition_reference_decision_v1 BEFORE INSERT
  ON signal_acquisition_reference_decisions FOR EACH ROW EXECUTE FUNCTION validate_signal_acquisition_authority_v1();
DROP TRIGGER IF EXISTS validate_signal_acquisition_slot_v1 ON signal_acquisition_slots;
CREATE TRIGGER validate_signal_acquisition_slot_v1 BEFORE INSERT
  ON signal_acquisition_slots FOR EACH ROW EXECUTE FUNCTION validate_signal_acquisition_authority_v1();
DROP TRIGGER IF EXISTS validate_signal_acquisition_query_v1 ON signal_acquisition_query_versions;
CREATE TRIGGER validate_signal_acquisition_query_v1 BEFORE INSERT
  ON signal_acquisition_query_versions FOR EACH ROW EXECUTE FUNCTION validate_signal_acquisition_authority_v1();

-- ---------------------------------------------------------------------------
-- Sealed imports and typed provider observations
-- ---------------------------------------------------------------------------

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS acquisition_contract_version text,
  ADD COLUMN IF NOT EXISTS acquisition_plan_id uuid REFERENCES signal_acquisition_plans(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS acquisition_slot_id uuid REFERENCES signal_acquisition_slots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS acquisition_query_version_id uuid REFERENCES signal_acquisition_query_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS capture_period_start date,
  ADD COLUMN IF NOT EXISTS capture_period_end date,
  ADD COLUMN IF NOT EXISTS capture_timezone text,
  ADD COLUMN IF NOT EXISTS acquisition_plan_digest text,
  ADD COLUMN IF NOT EXISTS acquisition_slot_digest text,
  ADD COLUMN IF NOT EXISTS acquisition_query_digest text,
  ADD COLUMN IF NOT EXISTS acquisition_brand_os_digest text,
  ADD COLUMN IF NOT EXISTS acquisition_identity_catalog_digest text,
  ADD COLUMN IF NOT EXISTS provider_schema_version text,
  ADD COLUMN IF NOT EXISTS provider_observation_projection_state text,
  ADD COLUMN IF NOT EXISTS provider_observation_header_hash text,
  ADD COLUMN IF NOT EXISTS provider_observation_count integer,
  ADD COLUMN IF NOT EXISTS acquisition_sealed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_workspace_id ON import_batches(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mentions_workspace_id ON mentions(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_provenance_binding_workspace_id
  ON signal_provenance_policy_bindings(workspace_id,id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='import_batches_acquisition_shape') THEN
    ALTER TABLE import_batches ADD CONSTRAINT import_batches_acquisition_shape CHECK (
      (acquisition_contract_version IS NULL
        AND acquisition_plan_id IS NULL AND acquisition_slot_id IS NULL
        AND acquisition_query_version_id IS NULL AND capture_period_start IS NULL
        AND capture_period_end IS NULL AND capture_timezone IS NULL
        AND acquisition_plan_digest IS NULL AND acquisition_slot_digest IS NULL
        AND acquisition_query_digest IS NULL AND acquisition_brand_os_digest IS NULL
        AND acquisition_identity_catalog_digest IS NULL AND provider_schema_version IS NULL
        AND provider_observation_projection_state IS NULL
        AND provider_observation_header_hash IS NULL AND provider_observation_count IS NULL
        AND acquisition_sealed_at IS NULL)
      OR (
        acquisition_contract_version='signal-acquisition-import-v1'
        AND acquisition_plan_id IS NOT NULL AND acquisition_slot_id IS NOT NULL
        AND acquisition_query_version_id IS NOT NULL AND capture_period_start IS NOT NULL
        AND capture_period_end IS NOT NULL AND capture_period_end>=capture_period_start
        AND capture_timezone IS NOT NULL AND length(btrim(capture_timezone))>0
        AND acquisition_plan_digest ~ '^sha256:[0-9a-f]{64}$'
        AND acquisition_slot_digest ~ '^sha256:[0-9a-f]{64}$'
        AND acquisition_query_digest ~ '^sha256:[0-9a-f]{64}$'
        AND acquisition_brand_os_digest ~ '^sha256:[0-9a-f]{64}$'
        AND acquisition_identity_catalog_digest ~ '^sha256:[0-9a-f]{64}$'
        AND provider_schema_version='sentione-csv-47-v1'
        AND provider_observation_projection_state IN ('pending','ready','not_available')
        AND provider_observation_count IS NOT NULL AND provider_observation_count>=0
        AND acquisition_sealed_at IS NOT NULL
      )
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_signal_acquisition_import_seal_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan signal_acquisition_plans%ROWTYPE;DECLARE slot signal_acquisition_slots%ROWTYPE;
DECLARE query signal_acquisition_query_versions%ROWTYPE;
DECLARE prior import_batches%ROWTYPE;
DECLARE projection_count integer;DECLARE membership_count integer;
DECLARE is_recovery boolean:=false;
BEGIN
  IF TG_OP='UPDATE' AND (
      OLD.acquisition_contract_version IS DISTINCT FROM NEW.acquisition_contract_version
      OR OLD.acquisition_plan_id IS DISTINCT FROM NEW.acquisition_plan_id
      OR OLD.acquisition_slot_id IS DISTINCT FROM NEW.acquisition_slot_id
      OR OLD.acquisition_query_version_id IS DISTINCT FROM NEW.acquisition_query_version_id
      OR OLD.capture_period_start IS DISTINCT FROM NEW.capture_period_start
      OR OLD.capture_period_end IS DISTINCT FROM NEW.capture_period_end
      OR OLD.capture_timezone IS DISTINCT FROM NEW.capture_timezone
      OR OLD.acquisition_plan_digest IS DISTINCT FROM NEW.acquisition_plan_digest
      OR OLD.acquisition_slot_digest IS DISTINCT FROM NEW.acquisition_slot_digest
      OR OLD.acquisition_query_digest IS DISTINCT FROM NEW.acquisition_query_digest
      OR OLD.acquisition_brand_os_digest IS DISTINCT FROM NEW.acquisition_brand_os_digest
      OR OLD.acquisition_identity_catalog_digest IS DISTINCT FROM NEW.acquisition_identity_catalog_digest
      OR OLD.provider_schema_version IS DISTINCT FROM NEW.provider_schema_version
      OR OLD.acquisition_sealed_at IS DISTINCT FROM NEW.acquisition_sealed_at) THEN
    RAISE EXCEPTION 'Signal acquisition import seal is immutable.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='completed' AND (
      OLD.provider_observation_projection_state IS DISTINCT FROM NEW.provider_observation_projection_state
      OR OLD.provider_observation_header_hash IS DISTINCT FROM NEW.provider_observation_header_hash
      OR OLD.provider_observation_count IS DISTINCT FROM NEW.provider_observation_count) THEN
    RAISE EXCEPTION 'Completed provider observation projection is immutable.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='INSERT' AND NEW.supersedes_import_batch_id IS NOT NULL THEN
    is_recovery:=true;
    SELECT * INTO prior FROM import_batches WHERE id=NEW.supersedes_import_batch_id;
    IF prior.id IS NULL OR prior.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR prior.data_source_id IS DISTINCT FROM NEW.data_source_id THEN
      RAISE EXCEPTION 'Acquisition recovery cannot cross workspace or connector authority.' USING ERRCODE='23514';
    END IF;
    IF prior.acquisition_contract_version IS NULL
       AND NEW.acquisition_contract_version IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy recovery cannot acquire a target acquisition seal.' USING ERRCODE='23514';
    ELSIF prior.acquisition_contract_version IS NOT NULL AND (
        NEW.acquisition_contract_version IS DISTINCT FROM prior.acquisition_contract_version
        OR NEW.acquisition_plan_id IS DISTINCT FROM prior.acquisition_plan_id
        OR NEW.acquisition_slot_id IS DISTINCT FROM prior.acquisition_slot_id
        OR NEW.acquisition_query_version_id IS DISTINCT FROM prior.acquisition_query_version_id
        OR NEW.capture_period_start IS DISTINCT FROM prior.capture_period_start
        OR NEW.capture_period_end IS DISTINCT FROM prior.capture_period_end
        OR NEW.capture_timezone IS DISTINCT FROM prior.capture_timezone
        OR NEW.acquisition_plan_digest IS DISTINCT FROM prior.acquisition_plan_digest
        OR NEW.acquisition_slot_digest IS DISTINCT FROM prior.acquisition_slot_digest
        OR NEW.acquisition_query_digest IS DISTINCT FROM prior.acquisition_query_digest
        OR NEW.acquisition_brand_os_digest IS DISTINCT FROM prior.acquisition_brand_os_digest
        OR NEW.acquisition_identity_catalog_digest IS DISTINCT FROM prior.acquisition_identity_catalog_digest
        OR NEW.provider_schema_version IS DISTINCT FROM prior.provider_schema_version
        OR NEW.acquisition_sealed_at IS DISTINCT FROM prior.acquisition_sealed_at) THEN
      RAISE EXCEPTION 'Acquisition recovery must preserve the original seal.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.acquisition_contract_version='signal-acquisition-import-v1'
     AND TG_OP='INSERT' AND NOT is_recovery THEN
    SELECT * INTO plan FROM signal_acquisition_plans WHERE id=NEW.acquisition_plan_id AND workspace_id=NEW.workspace_id;
    SELECT * INTO slot FROM signal_acquisition_slots WHERE id=NEW.acquisition_slot_id
      AND workspace_id=NEW.workspace_id AND plan_id=NEW.acquisition_plan_id;
    SELECT * INTO query FROM signal_acquisition_query_versions WHERE id=NEW.acquisition_query_version_id
      AND workspace_id=NEW.workspace_id AND plan_id=NEW.acquisition_plan_id
      AND slot_id=NEW.acquisition_slot_id AND data_source_id=NEW.data_source_id;
    IF plan.status<>'current' OR slot.id IS NULL OR slot.desired_state<>'active' OR query.id IS NULL
       OR plan.definition_hash IS DISTINCT FROM NEW.acquisition_plan_digest
       OR slot.definition_hash IS DISTINCT FROM NEW.acquisition_slot_digest
       OR query.definition_hash IS DISTINCT FROM NEW.acquisition_query_digest
       OR plan.brand_os_digest IS DISTINCT FROM NEW.acquisition_brand_os_digest
       OR plan.identity_catalog_digest IS DISTINCT FROM NEW.acquisition_identity_catalog_digest
       OR query.provider_schema_version IS DISTINCT FROM NEW.provider_schema_version
       OR NEW.capture_period_start<COALESCE(query.default_period_start,NEW.capture_period_start)
       OR NEW.capture_period_end>COALESCE(query.default_period_end,NEW.capture_period_end) THEN
      RAISE EXCEPTION 'Signal acquisition import authority is invalid or stale.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.acquisition_contract_version='signal-acquisition-import-v1' THEN
    IF NEW.status='completed' AND (NEW.provider_observation_projection_state='pending'
       OR NEW.provider_observation_header_hash IS NULL
       OR NEW.provider_observation_header_hash !~ '^sha256:[0-9a-f]{64}$'
       OR NEW.provider_observation_count IS NULL OR NEW.provider_observation_count<0) THEN
      RAISE EXCEPTION 'Signal acquisition typed provider projection is unresolved.' USING ERRCODE='23514';
    END IF;
    IF NEW.status='completed' AND NEW.provider_observation_projection_state='ready' THEN
      SELECT count(*)::int INTO projection_count
      FROM signal_provider_mention_observations observation
      WHERE observation.import_batch_id=NEW.id
        AND NOT EXISTS(SELECT 1 FROM signal_provider_mention_observations successor
          WHERE successor.supersedes_observation_id=observation.id);
      SELECT count(*)::int INTO membership_count
      FROM signal_mention_import_memberships membership
      WHERE membership.import_batch_id=NEW.id;
      IF projection_count<>NEW.provider_observation_count OR projection_count<>membership_count THEN
        RAISE EXCEPTION 'Signal acquisition typed provider projection is incomplete.' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.status='completed' AND NEW.provider_observation_projection_state='not_available'
        AND NEW.provider_observation_count<>0 THEN
      RAISE EXCEPTION 'Unavailable provider projection cannot publish typed rows.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.provider_observation_projection_state IS NOT NULL
     OR NEW.provider_observation_header_hash IS NOT NULL
     OR NEW.provider_observation_count IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy imports cannot claim the acquisition typed projection.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_signal_acquisition_import_seal_v1 ON import_batches;
CREATE TRIGGER enforce_signal_acquisition_import_seal_v1 BEFORE INSERT OR UPDATE
  ON import_batches FOR EACH ROW EXECUTE FUNCTION enforce_signal_acquisition_import_seal_v1();

CREATE TABLE IF NOT EXISTS signal_provider_mention_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  data_source_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  mention_id uuid NOT NULL,
  provider_key text NOT NULL CHECK(provider_key IN ('sentione')),
  provider_record_key_hash text NOT NULL CHECK(provider_record_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  acquisition_plan_id uuid REFERENCES signal_acquisition_plans(id) ON DELETE RESTRICT,
  acquisition_slot_id uuid REFERENCES signal_acquisition_slots(id) ON DELETE RESTRICT,
  acquisition_query_version_id uuid REFERENCES signal_acquisition_query_versions(id) ON DELETE RESTRICT,
  acquisition_plan_digest text,
  acquisition_slot_digest text,
  acquisition_query_digest text,
  provider_schema_version text NOT NULL CHECK(provider_schema_version IN ('sentione-csv-47-v1')),
  provider_header_hash text NOT NULL CHECK(provider_header_hash ~ '^sha256:[0-9a-f]{64}$'),
  observation_version integer NOT NULL CHECK(observation_version>0),
  observation_hash text NOT NULL CHECK(observation_hash ~ '^sha256:[0-9a-f]{64}$'),
  supersedes_observation_id uuid REFERENCES signal_provider_mention_observations(id) ON DELETE RESTRICT,
  provider_project_ref_hash text CHECK(provider_project_ref_hash IS NULL OR provider_project_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  platform text,
  public_domain text,
  provider_domain_category text,
  provider_source_type text,
  provider_content_type text,
  provider_thread_key_hash text CHECK(provider_thread_key_hash IS NULL OR provider_thread_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  thread_role text NOT NULL DEFAULT 'unknown' CHECK(thread_role IN ('root','reply','unknown')),
  language_code text,
  country_code text,
  published_at timestamptz NOT NULL,
  provider_collected_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  provider_sentiment_label text,
  provider_sentiment_score numeric,
  rating_value numeric,
  influence_score numeric,
  engagement_total bigint,
  comments_count bigint,
  views_count bigint,
  shares_count bigint,
  reaction_wow_count bigint,
  reaction_love_count bigint,
  reaction_like_count bigint,
  reaction_haha_count bigint,
  reaction_sad_count bigint,
  reaction_angry_count bigint,
  reaction_thankful_count bigint,
  unique_views_count bigint,
  fans_count bigint,
  repost_count bigint,
  favorites_count bigint,
  hearts_count bigint,
  likes_count bigint,
  dislikes_count bigint,
  followers_count bigint,
  author_ref_hash text CHECK(author_ref_hash IS NULL OR author_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  provenance_binding_id uuid,
  rights_definition_hash text CHECK(rights_definition_hash IS NULL OR rights_definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,data_source_id) REFERENCES data_sources(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,import_batch_id) REFERENCES import_batches(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,mention_id) REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,provenance_binding_id) REFERENCES signal_provenance_policy_bindings(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,acquisition_plan_id) REFERENCES signal_acquisition_plans(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,acquisition_slot_id) REFERENCES signal_acquisition_slots(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,acquisition_query_version_id) REFERENCES signal_acquisition_query_versions(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,id),
  UNIQUE(import_batch_id,provider_record_key_hash,observation_version),
  CHECK((acquisition_plan_id IS NULL AND acquisition_slot_id IS NULL
      AND acquisition_query_version_id IS NULL AND acquisition_plan_digest IS NULL
      AND acquisition_slot_digest IS NULL AND acquisition_query_digest IS NULL)
    OR (acquisition_plan_id IS NOT NULL AND acquisition_slot_id IS NOT NULL
      AND acquisition_query_version_id IS NOT NULL
      AND acquisition_plan_digest ~ '^sha256:[0-9a-f]{64}$'
      AND acquisition_slot_digest ~ '^sha256:[0-9a-f]{64}$'
      AND acquisition_query_digest ~ '^sha256:[0-9a-f]{64}$'))
);
CREATE INDEX IF NOT EXISTS idx_signal_provider_observation_root
  ON signal_provider_mention_observations(workspace_id,mention_id,import_batch_id);
CREATE INDEX IF NOT EXISTS idx_signal_provider_observation_import
  ON signal_provider_mention_observations(import_batch_id,mention_id);
CREATE INDEX IF NOT EXISTS idx_signal_provider_observation_platform_time
  ON signal_provider_mention_observations(workspace_id,platform,published_at,id);
CREATE INDEX IF NOT EXISTS idx_signal_provider_observation_thread
  ON signal_provider_mention_observations(workspace_id,provider_thread_key_hash,published_at,id);

CREATE TABLE IF NOT EXISTS signal_provider_mention_observation_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid NOT NULL REFERENCES signal_provider_mention_observations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  term_kind text NOT NULL CHECK(term_kind IN ('provider-tag','provider-keyword')),
  ordinal integer NOT NULL CHECK(ordinal>=0),
  term_private text NOT NULL CHECK(length(term_private) BETWEEN 1 AND 1000),
  term_hash text NOT NULL CHECK(term_hash ~ '^sha256:[0-9a-f]{64}$'),
  normalized_term text NOT NULL CHECK(length(normalized_term) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(observation_id,term_kind,term_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_provider_observation_workspace_id
  ON signal_provider_mention_observations(workspace_id,id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='signal_provider_observation_terms_workspace_observation_fk') THEN
    ALTER TABLE signal_provider_mention_observation_terms
      ADD CONSTRAINT signal_provider_observation_terms_workspace_observation_fk
      FOREIGN KEY(workspace_id,observation_id)
      REFERENCES signal_provider_mention_observations(workspace_id,id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_signal_provider_observation_terms_lookup
  ON signal_provider_mention_observation_terms(workspace_id,term_kind,term_hash,observation_id);

DROP TRIGGER IF EXISTS protect_signal_provider_observations_v1 ON signal_provider_mention_observations;
CREATE TRIGGER protect_signal_provider_observations_v1 BEFORE UPDATE OR DELETE
  ON signal_provider_mention_observations FOR EACH ROW EXECUTE FUNCTION protect_signal_acquisition_append_only_v1();
DROP TRIGGER IF EXISTS protect_signal_provider_observation_terms_v1 ON signal_provider_mention_observation_terms;
CREATE TRIGGER protect_signal_provider_observation_terms_v1 BEFORE UPDATE OR DELETE
  ON signal_provider_mention_observation_terms FOR EACH ROW EXECUTE FUNCTION protect_signal_acquisition_append_only_v1();

CREATE OR REPLACE FUNCTION validate_signal_provider_observation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior signal_provider_mention_observations%ROWTYPE;
DECLARE batch import_batches%ROWTYPE;DECLARE binding signal_provenance_policy_bindings%ROWTYPE;
DECLARE retention signal_retention_policies%ROWTYPE;DECLARE policies_current boolean;
BEGIN
  SELECT * INTO batch FROM import_batches WHERE id=NEW.import_batch_id AND workspace_id=NEW.workspace_id;
  IF batch.id IS NULL OR batch.data_source_id<>NEW.data_source_id THEN
    RAISE EXCEPTION 'Provider observation import authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF batch.acquisition_contract_version='signal-acquisition-import-v1' THEN
    SELECT * INTO binding FROM signal_provenance_policy_bindings
    WHERE id=NEW.provenance_binding_id AND workspace_id=NEW.workspace_id
      AND data_source_id=NEW.data_source_id AND status='active'
      AND effective_from<=clock_timestamp()
      AND (effective_to IS NULL OR effective_to>clock_timestamp());
    SELECT * INTO retention FROM signal_retention_policies
      WHERE id=binding.retention_policy_id AND workspace_id=NEW.workspace_id;
    SELECT binding.id IS NOT NULL
      AND EXISTS(SELECT 1 FROM signal_quality_policies quality
        WHERE quality.id=binding.quality_policy_id AND quality.workspace_id=NEW.workspace_id
          AND quality.status='active' AND quality.effective_from<=clock_timestamp()
          AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp()))
      AND EXISTS(SELECT 1 FROM signal_retention_policies policy
        WHERE policy.id=binding.retention_policy_id AND policy.workspace_id=NEW.workspace_id
          AND policy.status='active' AND policy.effective_from<=clock_timestamp()
          AND (policy.effective_to IS NULL OR policy.effective_to>clock_timestamp())
          AND (policy.retain_until IS NULL OR policy.retain_until>clock_timestamp()))
      AND EXISTS(SELECT 1 FROM signal_licensing_policies licensing
        WHERE licensing.id=binding.licensing_policy_id AND licensing.workspace_id=NEW.workspace_id
          AND licensing.status='active' AND licensing.effective_from<=clock_timestamp()
          AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp()))
      INTO policies_current;
    IF NEW.acquisition_plan_id IS DISTINCT FROM batch.acquisition_plan_id
       OR NEW.acquisition_slot_id IS DISTINCT FROM batch.acquisition_slot_id
       OR NEW.acquisition_query_version_id IS DISTINCT FROM batch.acquisition_query_version_id
       OR NEW.acquisition_plan_digest IS DISTINCT FROM batch.acquisition_plan_digest
       OR NEW.acquisition_slot_digest IS DISTINCT FROM batch.acquisition_slot_digest
       OR NEW.acquisition_query_digest IS DISTINCT FROM batch.acquisition_query_digest
       OR NEW.provider_schema_version IS DISTINCT FROM batch.provider_schema_version
       OR NEW.provider_header_hash IS DISTINCT FROM batch.provider_observation_header_hash
       OR NOT COALESCE(policies_current,false)
       OR NEW.rights_definition_hash IS DISTINCT FROM binding.definition_hash
       OR NEW.retention_until IS DISTINCT FROM retention.retain_until THEN
      RAISE EXCEPTION 'Provider observation does not preserve the sealed import and rights authority.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.supersedes_observation_id IS NOT NULL THEN
    SELECT * INTO prior FROM signal_provider_mention_observations
      WHERE id=NEW.supersedes_observation_id;
    IF prior.id IS NULL OR prior.workspace_id<>NEW.workspace_id
       OR prior.import_batch_id<>NEW.import_batch_id OR prior.mention_id<>NEW.mention_id
       OR prior.provider_key<>NEW.provider_key
       OR prior.provider_record_key_hash<>NEW.provider_record_key_hash
       OR NEW.observation_version<>prior.observation_version+1 THEN
      RAISE EXCEPTION 'Provider observation supersession is invalid.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.observation_version<>1 THEN
    RAISE EXCEPTION 'Initial provider observation version must be one.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_provider_observation_v1 ON signal_provider_mention_observations;
CREATE TRIGGER validate_signal_provider_observation_v1 BEFORE INSERT
  ON signal_provider_mention_observations FOR EACH ROW EXECUTE FUNCTION validate_signal_provider_observation_v1();

CREATE OR REPLACE FUNCTION signal_provider_observation_is_accepted_v1(target_observation_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM signal_provider_mention_observations observation
    JOIN import_batches batch ON batch.id=observation.import_batch_id
      AND batch.workspace_id=observation.workspace_id
    JOIN signal_provenance_policy_bindings binding ON binding.workspace_id=observation.workspace_id
      AND binding.data_source_id=observation.data_source_id AND binding.status='active'
      AND binding.effective_from<=clock_timestamp()
      AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp())
      AND (binding.import_batch_id=batch.id OR binding.import_batch_id IS NULL)
    JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id AND quality.status='active'
      AND quality.effective_from<=clock_timestamp()
      AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
    JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.status='active'
      AND retention.effective_from<=clock_timestamp()
      AND (retention.effective_to IS NULL OR retention.effective_to>clock_timestamp())
      AND (retention.retain_until IS NULL OR retention.retain_until>clock_timestamp())
    JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id AND licensing.status='active'
      AND licensing.effective_from<=clock_timestamp()
      AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp())
    WHERE observation.id=target_observation_id AND batch.status='completed'
      AND batch.ingestion_phase='completed'
      AND NOT signal_mention_has_only_incomplete_imports_v1(observation.workspace_id,observation.mention_id)
      AND NOT EXISTS(SELECT 1 FROM signal_provider_mention_observations successor
        WHERE successor.supersedes_observation_id=observation.id)
  )
$$;

-- The generic async provenance writer predates acquisition seals and materializes
-- legacy source intent as a side effect. Target acquisition imports must remain
-- quarantined until atomic completion: while processing, persist only the exact
-- canonical membership and immutable ingestion disposition. Historical/legacy
-- imports retain their prior behavior.
CREATE OR REPLACE FUNCTION record_signal_workspace_import_provenance_v1(
  target_mention_id uuid,target_import_batch_id uuid,target_disposition text
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE persisted_id uuid;DECLARE current_disposition text;
DECLARE target import_batches%ROWTYPE;DECLARE target_mention mentions%ROWTYPE;
BEGIN
  IF target_disposition NOT IN ('included','excluded','duplicate') THEN
    RAISE EXCEPTION 'Workspace import disposition is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id;
  SELECT * INTO target_mention FROM mentions WHERE id=target_mention_id;
  IF target.id IS NULL OR target_mention.id IS NULL
     OR target_mention.canonical_mention_id IS DISTINCT FROM target_mention.id
     OR target_mention.workspace_id IS DISTINCT FROM target.workspace_id THEN
    RAISE EXCEPTION 'Workspace import provenance is cross-workspace or non-canonical.' USING ERRCODE='23514';
  END IF;
  IF target.acquisition_contract_version='signal-acquisition-import-v1' THEN
    INSERT INTO signal_mention_import_memberships(
      workspace_id,mention_id,import_batch_id,data_source_id
    ) VALUES(target.workspace_id,target_mention.id,target.id,target.data_source_id)
    ON CONFLICT(mention_id,import_batch_id) DO NOTHING;
  ELSE
    PERFORM record_signal_mention_import_provenance(target_mention_id,target_import_batch_id);
  END IF;
  SELECT id,ingestion_disposition INTO persisted_id,current_disposition
  FROM signal_mention_import_memberships
  WHERE mention_id=target_mention_id AND import_batch_id=target_import_batch_id FOR UPDATE;
  IF persisted_id IS NULL THEN
    RAISE EXCEPTION 'Workspace import provenance was not persisted.' USING ERRCODE='23514';
  END IF;
  IF current_disposition IS NOT NULL AND current_disposition<>target_disposition THEN
    RAISE EXCEPTION 'Workspace import disposition conflicts with durable history.' USING ERRCODE='23514';
  END IF;
  UPDATE signal_mention_import_memberships SET ingestion_disposition=target_disposition
  WHERE id=persisted_id AND ingestion_disposition IS NULL;
  RETURN persisted_id;
END; $$;

-- Target imports materialize only pending/not-eligible acquisition intent. The legacy
-- branch preserves the previous bridge behavior byte-for-byte for historical imports.
CREATE OR REPLACE FUNCTION materialize_signal_workspace_import_source_intent_v1(
  target_import_batch_id uuid
)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;DECLARE source data_sources%ROWTYPE;
DECLARE workspace signal_workspaces%ROWTYPE;DECLARE inserted_count integer;
DECLARE resolved_scope text;DECLARE resolved_entity_type text;
DECLARE resolved_entity_id uuid;DECLARE resolved_review_status text;
DECLARE target_slot signal_acquisition_slots%ROWTYPE;
BEGIN
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR SHARE;
  SELECT * INTO source FROM data_sources WHERE id=target.data_source_id;
  SELECT * INTO workspace FROM signal_workspaces WHERE id=target.workspace_id;
  IF target.id IS NULL OR source.id IS NULL OR workspace.id IS NULL
     OR source.workspace_id IS DISTINCT FROM target.workspace_id THEN
    RAISE EXCEPTION 'Workspace import source intent cannot cross workspaces.' USING ERRCODE='23514';
  END IF;
  IF target.acquisition_contract_version='signal-acquisition-import-v1' THEN
    SELECT * INTO target_slot FROM signal_acquisition_slots
      WHERE id=target.acquisition_slot_id AND workspace_id=target.workspace_id
        AND plan_id=target.acquisition_plan_id;
    IF target_slot.id IS NULL THEN
      RAISE EXCEPTION 'Sealed acquisition slot is unavailable.' USING ERRCODE='23514';
    END IF;
    resolved_scope:=target_slot.scope;
    resolved_entity_type:=target_slot.entity_type;
    resolved_entity_id:=target_slot.entity_id;
    resolved_review_status:='pending';
  ELSE
    resolved_scope:=COALESCE(source.governed_scope,CASE
      WHEN target.mention_type='brand' OR target.entity_kind='primary_brand' THEN 'primary_brand'
      WHEN target.mention_type='competitor' OR target.entity_kind IN ('competitor','competitor_pool') THEN 'competitor'
      WHEN target.mention_type='industry' OR target.entity_kind='category' THEN 'category'
      WHEN target.entity_kind='reference' THEN 'reference' ELSE 'unattributed' END);
    resolved_entity_type:=COALESCE(source.governed_entity_type,CASE resolved_scope
      WHEN 'primary_brand' THEN 'brand' WHEN 'competitor' THEN 'competitor'
      WHEN 'category' THEN 'category' WHEN 'reference' THEN 'reference'
      ELSE 'unattributed' END);
    resolved_entity_id:=COALESCE(source.governed_entity_id,CASE resolved_scope
      WHEN 'primary_brand' THEN workspace.brand_id
      WHEN 'competitor' THEN target.competitor_id ELSE NULL END);
    resolved_review_status:=CASE WHEN source.governed_scope IS NULL
      THEN 'approved' ELSE source.scope_review_status END;
  END IF;
  PERFORM set_config('noisia.import_bulk_reconcile','on',true);
  INSERT INTO signal_mention_attributions(
    workspace_id,mention_id,data_source_id,import_batch_id,scope,entity_type,
    entity_id,entity_label,confidence,review_status,attribution_source,policy_version,
    approved_by_user_id,approval_source,approved_at,attribution_basis,eligibility_status
  ) SELECT target.workspace_id,membership.mention_id,source.id,target.id,
    resolved_scope,resolved_entity_type,resolved_entity_id,
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v1'
      THEN target_slot.label ELSE COALESCE(target.entity_label,source.name) END,
    1.0000,resolved_review_status,
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v1'
      THEN 'sealed_acquisition_slot'
      WHEN source.governed_scope IS NULL THEN 'legacy_import_batch' ELSE 'governed_data_source' END,
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v1'
      THEN 'signal-acquisition-source-intent-v1'
      ELSE COALESCE(source.scope_policy_version,'workspace-scope-legacy-v1') END,
    CASE WHEN target.acquisition_contract_version IS DISTINCT FROM 'signal-acquisition-import-v1'
      AND resolved_review_status='approved' THEN source.scope_approved_by_user_id END,
    CASE WHEN target.acquisition_contract_version IS DISTINCT FROM 'signal-acquisition-import-v1'
      AND resolved_review_status='approved' THEN COALESCE(source.scope_approval_source,'legacy_import_scope') END,
    CASE WHEN target.acquisition_contract_version IS DISTINCT FROM 'signal-acquisition-import-v1'
      AND resolved_review_status='approved' THEN COALESCE(source.scope_approved_at,now()) END,
    'source_intent','not_eligible'
  FROM signal_mention_import_memberships membership
  WHERE membership.import_batch_id=target.id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  PERFORM set_config('noisia.import_bulk_reconcile','off',true);
  RETURN inserted_count;
END; $$;

-- Existing storage recovery must copy the acquisition seal exactly. It must never
-- resolve current plan/slot/query authority again.
CREATE OR REPLACE FUNCTION create_signal_workspace_import_storage_recovery_v1(
  target_failed_import_batch_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_digest text,
  target_storage_content_hash text
)
RETURNS TABLE(import_batch_id uuid,outbox_id uuid,worker_job_id text,created boolean)
LANGUAGE plpgsql AS $$
DECLARE prior import_batches%ROWTYPE;DECLARE persisted import_batches%ROWTYPE;DECLARE queued record;
BEGIN
  IF target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$'
     OR (target_storage_content_hash IS NOT NULL AND target_storage_content_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Workspace import recovery authority is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO prior FROM import_batches WHERE id=target_failed_import_batch_id FOR UPDATE;
  IF prior.id IS NULL OR prior.status<>'failed' OR prior.ingestion_phase<>'failed'
     OR prior.storage_bucket IS NULL OR prior.storage_object_key IS NULL
     OR prior.storage_part_count IS NULL OR prior.storage_part_size_bytes IS NULL THEN
    RAISE EXCEPTION 'Workspace import recovery source is unavailable.' USING ERRCODE='23514';
  END IF;
  IF NOT signal_data_governance_actor_is_valid(prior.workspace_id,target_actor_user_id) THEN
    RAISE EXCEPTION 'Workspace import recovery actor is unauthorized.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'workspace-import-recovery:'||prior.workspace_id::text||':'||prior.id::text,0));
  SELECT * INTO persisted FROM import_batches
  WHERE workspace_id=prior.workspace_id AND product_idempotency_key=target_idempotency_key FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.product_request_digest<>target_request_digest
       OR persisted.supersedes_import_batch_id IS DISTINCT FROM prior.id THEN
      RAISE EXCEPTION 'Workspace import recovery idempotency conflict.' USING ERRCODE='23514';
    END IF;
    SELECT * INTO queued FROM signal_workspace_import_outbox outbox WHERE outbox.import_batch_id=persisted.id;
    RETURN QUERY SELECT persisted.id,queued.id,queued.worker_job_id,false;RETURN;
  END IF;
  INSERT INTO import_batches(
    workspace_id,study_corpus_id,contributed_by_study_corpus_id,data_source_id,
    query_iteration_id,query_pack_id,query_validation_run_id,mention_type,
    competitor_id,corpus_entity_id,entity_kind,entity_label,source_system,
    source_file_name,source_file_hash,ingestion_phase,storage_bucket,storage_object_key,
    upload_protocol,expected_file_size_bytes,storage_part_count,storage_part_size_bytes,
    storage_content_hash,storage_source_import_batch_id,supersedes_import_batch_id,
    product_idempotency_key,product_request_digest,imported_by_user_id,status,
    acquisition_contract_version,acquisition_plan_id,acquisition_slot_id,
    acquisition_query_version_id,capture_period_start,capture_period_end,capture_timezone,
    acquisition_plan_digest,acquisition_slot_digest,acquisition_query_digest,
    acquisition_brand_os_digest,acquisition_identity_catalog_digest,provider_schema_version,
    provider_observation_projection_state,provider_observation_header_hash,
    provider_observation_count,acquisition_sealed_at
  ) VALUES(
    prior.workspace_id,prior.study_corpus_id,prior.contributed_by_study_corpus_id,
    prior.data_source_id,prior.query_iteration_id,prior.query_pack_id,
    prior.query_validation_run_id,prior.mention_type,prior.competitor_id,
    prior.corpus_entity_id,prior.entity_kind,prior.entity_label,prior.source_system,
    prior.source_file_name,NULL,'queued',prior.storage_bucket,prior.storage_object_key,
    prior.upload_protocol,prior.expected_file_size_bytes,prior.storage_part_count,
    prior.storage_part_size_bytes,target_storage_content_hash,prior.id,prior.id,
    target_idempotency_key,target_request_digest,target_actor_user_id,'queued',
    prior.acquisition_contract_version,prior.acquisition_plan_id,prior.acquisition_slot_id,
    prior.acquisition_query_version_id,prior.capture_period_start,prior.capture_period_end,
    prior.capture_timezone,prior.acquisition_plan_digest,prior.acquisition_slot_digest,
    prior.acquisition_query_digest,prior.acquisition_brand_os_digest,
    prior.acquisition_identity_catalog_digest,prior.provider_schema_version,
    CASE WHEN prior.acquisition_contract_version IS NULL THEN NULL ELSE 'pending' END,NULL,
    CASE WHEN prior.acquisition_contract_version IS NULL THEN NULL ELSE 0 END,
    prior.acquisition_sealed_at
  ) RETURNING * INTO persisted;
  INSERT INTO signal_workspace_import_events(
    workspace_id,import_batch_id,event_type,actor_user_id,detail
  ) VALUES(prior.workspace_id,persisted.id,'retry-created',target_actor_user_id,
    jsonb_build_object('storage_reused',true,'supersedes_import_batch_id',prior.id,
      'verified_size_bytes',prior.expected_file_size_bytes,'acquisition_seal_preserved',
      prior.acquisition_contract_version IS NOT NULL));
  SELECT * INTO queued FROM enqueue_signal_workspace_import_v1(persisted.id,target_actor_user_id);
  RETURN QUERY SELECT persisted.id,queued.outbox_id,queued.worker_job_id,true;
END; $$;

CREATE OR REPLACE FUNCTION enforce_signal_acquisition_recovery_seal_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior import_batches%ROWTYPE;
BEGIN
  IF NEW.supersedes_import_batch_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO prior FROM import_batches WHERE id=NEW.supersedes_import_batch_id;
  IF prior.id IS NULL OR prior.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR prior.data_source_id IS DISTINCT FROM NEW.data_source_id THEN
    RAISE EXCEPTION 'Acquisition recovery cannot cross workspace or connector authority.' USING ERRCODE='23514';
  END IF;
  IF prior.acquisition_contract_version IS NULL
     AND NEW.acquisition_contract_version IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy recovery cannot acquire a target acquisition seal.' USING ERRCODE='23514';
  ELSIF prior.acquisition_contract_version IS NOT NULL AND (
      NEW.acquisition_contract_version IS DISTINCT FROM prior.acquisition_contract_version
      OR NEW.acquisition_plan_id IS DISTINCT FROM prior.acquisition_plan_id
      OR NEW.acquisition_slot_id IS DISTINCT FROM prior.acquisition_slot_id
      OR NEW.acquisition_query_version_id IS DISTINCT FROM prior.acquisition_query_version_id
      OR NEW.capture_period_start IS DISTINCT FROM prior.capture_period_start
      OR NEW.capture_period_end IS DISTINCT FROM prior.capture_period_end
      OR NEW.capture_timezone IS DISTINCT FROM prior.capture_timezone
      OR NEW.acquisition_plan_digest IS DISTINCT FROM prior.acquisition_plan_digest
      OR NEW.acquisition_slot_digest IS DISTINCT FROM prior.acquisition_slot_digest
      OR NEW.acquisition_query_digest IS DISTINCT FROM prior.acquisition_query_digest
      OR NEW.acquisition_brand_os_digest IS DISTINCT FROM prior.acquisition_brand_os_digest
      OR NEW.acquisition_identity_catalog_digest IS DISTINCT FROM prior.acquisition_identity_catalog_digest
      OR NEW.provider_schema_version IS DISTINCT FROM prior.provider_schema_version
      OR NEW.acquisition_sealed_at IS DISTINCT FROM prior.acquisition_sealed_at) THEN
    RAISE EXCEPTION 'Acquisition recovery must preserve the original seal.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_signal_acquisition_recovery_seal_v1 ON import_batches;
CREATE TRIGGER enforce_signal_acquisition_recovery_seal_v1 BEFORE INSERT
  ON import_batches FOR EACH ROW EXECUTE FUNCTION enforce_signal_acquisition_recovery_seal_v1();

-- Operation ledger remains the only request/idempotency authority.
ALTER TABLE signal_governance_control_operations
  DROP CONSTRAINT IF EXISTS signal_governance_control_action;
ALTER TABLE signal_governance_control_operations
  ADD CONSTRAINT signal_governance_control_action CHECK(action IN (
    'create-quality-draft','create-retention-draft','create-licensing-draft',
    'activate-policy','create-provenance-binding-draft','activate-provenance-binding',
    'upsert-identity','update-timezone','reconcile-brand-os','create-source','import-source',
    'reconcile-governed-view','reconcile-strategic-authority','promote-strategic-authority',
    'reconcile-acquisition-plan','promote-acquisition-plan','create-acquisition-query',
    'retire-acquisition-slot','decide-acquisition-reference','retire-competitor',
    'create-competitor','seal-acquisition-import'
  ));

COMMENT ON TABLE signal_acquisition_plans IS
  'Workspace-owned acquisition intent. Draft aggregate mutates only through server writers; current is sealed.';
COMMENT ON TABLE signal_acquisition_slots IS
  'Versioned acquisition intent; never semantic approval or mention attribution truth.';
COMMENT ON TABLE signal_provider_mention_observations IS
  'Typed provider lineage keyed to canonical mentions/import memberships; contains no canonical text. Rights columns are immutable lineage snapshots, never independent serving authority.';
COMMENT ON COLUMN signal_provider_mention_observations.provenance_binding_id IS
  'Immutable lineage snapshot of the binding used at ingestion; every consumer must re-evaluate the live binding and policies.';
COMMENT ON COLUMN signal_provider_mention_observations.rights_definition_hash IS
  'Immutable lineage snapshot, not quality/retention/licensing authority.';
COMMENT ON COLUMN signal_provider_mention_observations.retention_until IS
  'Retention frontier observed through the provenance binding at ingestion; live retention remains authoritative.';
COMMENT ON COLUMN data_sources.governed_scope IS
  'Compatibility-only source scope for historical imports; not acquisition or semantic authority.';
COMMENT ON COLUMN import_batches.query_pack_id IS
  'Compatibility-only study-owned query reference; never Acquisition Plan authority.';
COMMENT ON COLUMN import_batches.mention_type IS
  'Compatibility-only provider/source intent; never semantic truth.';
