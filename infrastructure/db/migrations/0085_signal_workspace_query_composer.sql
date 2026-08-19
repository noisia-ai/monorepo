-- Workspace-owned Query Composer lineage and Acquisition Brief.
-- Forward-only. No query is promoted and no Study OS table is written here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE signal_acquisition_plans
  ADD COLUMN IF NOT EXISTS acquisition_brief_contract_version text,
  ADD COLUMN IF NOT EXISTS acquisition_brief jsonb,
  ADD COLUMN IF NOT EXISTS acquisition_brief_digest text;

CREATE OR REPLACE FUNCTION signal_acquisition_brief_is_valid_v1(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(value)='object'
    AND value->>'contract_version'='signal-acquisition-brief-v1'
    AND length(btrim(value->>'objective')) BETWEEN 1 AND 1000
    AND length(btrim(value->>'purpose')) BETWEEN 1 AND 500
    AND length(btrim(value->>'timezone')) BETWEEN 1 AND 100
    AND value->>'construction_mode' IN ('exploratory','detection')
    AND (value->>'brand_os_profile_version') ~ '^[1-9][0-9]*$'
    AND (value->>'brand_os_digest') ~ '^sha256:[0-9a-f]{64}$'
    AND (value->>'identity_catalog_digest') ~ '^sha256:[0-9a-f]{64}$'
    AND (value->>'knowledge_context_digest') ~ '^sha256:[0-9a-f]{64}$'
    AND jsonb_typeof(value->'countries')='array'
    AND jsonb_typeof(value->'languages')='array'
    AND jsonb_typeof(value->'knowledge_context_refs')='array'
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(value->'knowledge_context_refs') ref
      WHERE ref !~ '^sha256:[0-9a-f]{64}$')
    AND length(btrim(value->>'provider_key')) BETWEEN 1 AND 80
    AND length(btrim(value->>'provider_syntax_version')) BETWEEN 1 AND 100
    AND length(btrim(value->>'provider_schema_version')) BETWEEN 1 AND 100
    AND (
      value->'default_capture_period'='null'::jsonb
      OR (jsonb_typeof(value->'default_capture_period')='object'
        AND (value->'default_capture_period'->>'start') ~ '^\d{4}-\d{2}-\d{2}$'
        AND (value->'default_capture_period'->>'end') ~ '^\d{4}-\d{2}-\d{2}$'
        AND (value->'default_capture_period'->>'start') <= (value->'default_capture_period'->>'end'))
    )
    AND (
      value->'optional_study_context'='null'::jsonb
      OR (jsonb_typeof(value->'optional_study_context')='object'
        AND (value->'optional_study_context'->>'reference_hash') ~ '^sha256:[0-9a-f]{64}$'
        AND (value->'optional_study_context'->>'digest') ~ '^sha256:[0-9a-f]{64}$')
    );
$$;

ALTER TABLE signal_acquisition_plans
  DROP CONSTRAINT IF EXISTS signal_acquisition_plan_brief_shape;
ALTER TABLE signal_acquisition_plans
  ADD CONSTRAINT signal_acquisition_plan_brief_shape CHECK (
    (acquisition_brief_contract_version IS NULL
      AND acquisition_brief IS NULL AND acquisition_brief_digest IS NULL)
    OR (acquisition_brief_contract_version='signal-acquisition-brief-v1'
      AND signal_acquisition_brief_is_valid_v1(acquisition_brief)
      AND acquisition_brief_digest ~ '^sha256:[0-9a-f]{64}$')
  );

ALTER TABLE signal_acquisition_query_versions
  ADD COLUMN IF NOT EXISTS generation_contract_version text,
  ADD COLUMN IF NOT EXISTS generation_model text,
  ADD COLUMN IF NOT EXISTS generation_pipeline_version text,
  ADD COLUMN IF NOT EXISTS generation_prompt_template_digest text,
  ADD COLUMN IF NOT EXISTS generation_context_digest text,
  ADD COLUMN IF NOT EXISTS generation_construction_plan_digest text,
  ADD COLUMN IF NOT EXISTS generation_validation_report_digest text,
  ADD COLUMN IF NOT EXISTS generation_fallback_used boolean,
  ADD COLUMN IF NOT EXISTS generation_fallback_reason text,
  ADD COLUMN IF NOT EXISTS generation_study_reference_hash text,
  ADD COLUMN IF NOT EXISTS generation_study_context_digest text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;

ALTER TABLE signal_acquisition_query_versions
  DROP CONSTRAINT IF EXISTS signal_acquisition_query_versions_origin_kind_check,
  DROP CONSTRAINT IF EXISTS signal_acquisition_query_origin_lineage_shape;
ALTER TABLE signal_acquisition_query_versions
  ADD CONSTRAINT signal_acquisition_query_versions_origin_kind_check
    CHECK(origin_kind IN ('operator','legacy-query-pack','engine-generated')),
  ADD CONSTRAINT signal_acquisition_query_origin_lineage_shape CHECK (
    (origin_kind IN ('operator','legacy-query-pack')
      AND generation_contract_version IS NULL AND generation_model IS NULL
      AND generation_pipeline_version IS NULL AND generation_prompt_template_digest IS NULL
      AND generation_context_digest IS NULL AND generation_construction_plan_digest IS NULL
      AND generation_validation_report_digest IS NULL AND generation_fallback_used IS NULL
      AND generation_fallback_reason IS NULL AND generation_study_reference_hash IS NULL
      AND generation_study_context_digest IS NULL AND generated_at IS NULL)
    OR (origin_kind='engine-generated'
      AND origin_reference_id IS NULL
      AND generation_contract_version='signal-query-composer-lineage-v1'
      AND length(btrim(generation_model)) BETWEEN 1 AND 200
      AND length(btrim(generation_pipeline_version)) BETWEEN 1 AND 200
      AND generation_prompt_template_digest ~ '^sha256:[0-9a-f]{64}$'
      AND generation_context_digest ~ '^sha256:[0-9a-f]{64}$'
      AND generation_construction_plan_digest ~ '^sha256:[0-9a-f]{64}$'
      AND generation_validation_report_digest ~ '^sha256:[0-9a-f]{64}$'
      AND generation_fallback_used IS NOT NULL
      AND ((generation_fallback_used=true AND length(btrim(generation_fallback_reason)) BETWEEN 1 AND 500)
        OR (generation_fallback_used=false AND generation_fallback_reason IS NULL))
      AND ((generation_study_reference_hash IS NULL AND generation_study_context_digest IS NULL)
        OR (generation_study_reference_hash ~ '^sha256:[0-9a-f]{64}$'
          AND generation_study_context_digest ~ '^sha256:[0-9a-f]{64}$'))
      AND generated_at IS NOT NULL)
  );

ALTER TABLE signal_acquisition_plan_events
  DROP CONSTRAINT IF EXISTS signal_acquisition_plan_events_event_kind_check;
ALTER TABLE signal_acquisition_plan_events
  ADD CONSTRAINT signal_acquisition_plan_events_event_kind_check CHECK(event_kind IN (
    'draft-created','draft-reconciled','promoted','retired','slot-retired',
    'query-created','query-superseded','query-carried-forward','reference-decided','import-sealed',
    'drift-detected','rollback-promoted','brief-sealed'
  ));

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
    'create-competitor','seal-acquisition-import','seal-acquisition-brief',
    'generate-acquisition-queries'
  ));

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
    WHEN 'brief-sealed' THEN 'seal-acquisition-brief'
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
       OR NEW.acquisition_brief_contract_version IS DISTINCT FROM OLD.acquisition_brief_contract_version
       OR NEW.acquisition_brief IS DISTINCT FROM OLD.acquisition_brief
       OR NEW.acquisition_brief_digest IS DISTINCT FROM OLD.acquisition_brief_digest
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
       OR NEW.acquisition_brief_contract_version IS DISTINCT FROM OLD.acquisition_brief_contract_version
       OR NEW.acquisition_brief IS DISTINCT FROM OLD.acquisition_brief
       OR NEW.acquisition_brief_digest IS DISTINCT FROM OLD.acquisition_brief_digest
       OR NEW.definition_hash<>OLD.definition_hash OR NEW.draft_digest<>OLD.draft_digest
       OR NEW.draft_revision<>OLD.draft_revision
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.retired_by_user_id) THEN
      RAISE EXCEPTION 'Signal acquisition retirement changed authority.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Signal acquisition plan transition is invalid.' USING ERRCODE='55000';
END; $$;

CREATE OR REPLACE FUNCTION require_signal_acquisition_brief_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.acquisition_brief_digest IS DISTINCT FROM NEW.acquisition_brief_digest
     AND NOT EXISTS(
       SELECT 1 FROM signal_acquisition_plan_events event
       JOIN signal_governance_control_operations operation ON operation.id=event.operation_id
       WHERE event.workspace_id=NEW.workspace_id AND event.plan_id=NEW.id
         AND event.event_kind='brief-sealed' AND event.next_state_digest=NEW.draft_digest
         AND operation.action='seal-acquisition-brief' AND operation.status IN ('in_progress','completed')
     ) THEN
    RAISE EXCEPTION 'Acquisition Brief change requires its domain event.' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS require_signal_acquisition_brief_event_v1 ON signal_acquisition_plans;
CREATE CONSTRAINT TRIGGER require_signal_acquisition_brief_event_v1
  AFTER UPDATE ON signal_acquisition_plans DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION require_signal_acquisition_brief_event_v1();

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
     OR OLD.generation_contract_version IS DISTINCT FROM NEW.generation_contract_version
     OR OLD.generation_model IS DISTINCT FROM NEW.generation_model
     OR OLD.generation_pipeline_version IS DISTINCT FROM NEW.generation_pipeline_version
     OR OLD.generation_prompt_template_digest IS DISTINCT FROM NEW.generation_prompt_template_digest
     OR OLD.generation_context_digest IS DISTINCT FROM NEW.generation_context_digest
     OR OLD.generation_construction_plan_digest IS DISTINCT FROM NEW.generation_construction_plan_digest
     OR OLD.generation_validation_report_digest IS DISTINCT FROM NEW.generation_validation_report_digest
     OR OLD.generation_fallback_used IS DISTINCT FROM NEW.generation_fallback_used
     OR OLD.generation_fallback_reason IS DISTINCT FROM NEW.generation_fallback_reason
     OR OLD.generation_study_reference_hash IS DISTINCT FROM NEW.generation_study_reference_hash
     OR OLD.generation_study_context_digest IS DISTINCT FROM NEW.generation_study_context_digest
     OR OLD.generated_at IS DISTINCT FROM NEW.generated_at
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

CREATE OR REPLACE FUNCTION validate_signal_acquisition_query_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM signal_governance_control_operations operation
    WHERE operation.workspace_id=NEW.workspace_id
      AND operation.actor_user_id=NEW.created_by_user_id
      AND operation.status='in_progress'
      AND (
        (operation.action='create-acquisition-query'
          AND operation.idempotency_key=NEW.creation_idempotency_key)
        OR (operation.action='reconcile-acquisition-plan'
          AND NEW.carried_from_query_version_id IS NOT NULL
          AND NEW.creation_idempotency_key='sha256:'||encode(digest(convert_to(
            operation.idempotency_key||E'\x1f'||NEW.carried_from_query_version_id::text,
            'UTF8'),'sha256'),'hex'))
      )
  ) THEN
    RAISE EXCEPTION 'Acquisition query operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_acquisition_query_operation_v1 ON signal_acquisition_query_versions;
CREATE TRIGGER validate_signal_acquisition_query_operation_v1 BEFORE INSERT
  ON signal_acquisition_query_versions FOR EACH ROW EXECUTE FUNCTION validate_signal_acquisition_query_operation_v1();

COMMENT ON COLUMN signal_acquisition_plans.acquisition_brief IS
  'Private, workspace-owned Query Composer brief. Contains no raw Knowledge payload or prompt.';
COMMENT ON COLUMN signal_acquisition_plans.acquisition_brief_digest IS
  'Canonical digest included in the mutable draft aggregate and sealed by promotion.';
COMMENT ON COLUMN signal_acquisition_query_versions.origin_kind IS
  'Query intent origin. engine-generated remains a draft and is never semantic approval.';
COMMENT ON COLUMN signal_acquisition_query_versions.generation_context_digest IS
  'Digest-only reproducibility lineage; never a browser authority or raw provider response.';
