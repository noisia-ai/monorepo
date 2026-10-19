-- Backend 10A.6: query lineage is graduated evidence, not proof of CSV execution.
-- Forward-only. Historical imports remain byte-for-byte legacy/unplanned or V1.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS acquisition_query_evidence_class text,
  ADD COLUMN IF NOT EXISTS acquisition_query_evidence_reason text,
  ADD COLUMN IF NOT EXISTS acquisition_query_evidence_actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS acquisition_query_evidence_attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_execution_reference_hash text,
  ADD COLUMN IF NOT EXISTS provider_execution_adapter_key text,
  ADD COLUMN IF NOT EXISTS provider_execution_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS acquisition_import_seal_digest text;

ALTER TABLE signal_mention_attributions
  ADD COLUMN IF NOT EXISTS acquisition_query_evidence_class text,
  ADD COLUMN IF NOT EXISTS acquisition_query_version_id uuid,
  ADD COLUMN IF NOT EXISTS acquisition_query_evidence_actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_mention_attribution_query_evidence_fk') THEN
    ALTER TABLE signal_mention_attributions ADD CONSTRAINT signal_mention_attribution_query_evidence_fk
      FOREIGN KEY(workspace_id,acquisition_query_version_id)
      REFERENCES signal_acquisition_query_versions(workspace_id,id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE signal_mention_attributions
  DROP CONSTRAINT IF EXISTS signal_mention_attribution_query_evidence_shape;
ALTER TABLE signal_mention_attributions
  ADD CONSTRAINT signal_mention_attribution_query_evidence_shape CHECK(
    (attribution_source<>'sealed_acquisition_slot_v2'
      AND acquisition_query_evidence_class IS NULL
      AND acquisition_query_version_id IS NULL
      AND acquisition_query_evidence_actor_user_id IS NULL)
    OR (attribution_source='sealed_acquisition_slot_v2'
      AND attribution_basis='source_intent' AND eligibility_status='not_eligible'
      AND review_status='pending'
      AND acquisition_query_evidence_class IN ('provider_verified','operator_attested','unavailable')
      AND acquisition_query_evidence_actor_user_id IS NOT NULL
      AND ((acquisition_query_evidence_class IN ('provider_verified','operator_attested')
          AND acquisition_query_version_id IS NOT NULL)
        OR (acquisition_query_evidence_class='unavailable'
          AND acquisition_query_version_id IS NULL)))
  );

CREATE OR REPLACE FUNCTION validate_signal_source_intent_query_evidence_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch import_batches%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND OLD.attribution_source='sealed_acquisition_slot_v2' AND (
    OLD.acquisition_query_evidence_class IS DISTINCT FROM NEW.acquisition_query_evidence_class
    OR OLD.acquisition_query_version_id IS DISTINCT FROM NEW.acquisition_query_version_id
    OR OLD.acquisition_query_evidence_actor_user_id IS DISTINCT FROM NEW.acquisition_query_evidence_actor_user_id
    OR OLD.import_batch_id IS DISTINCT FROM NEW.import_batch_id) THEN
    RAISE EXCEPTION 'Acquisition source-intent query evidence is immutable.' USING ERRCODE='55000';
  END IF;
  IF NEW.attribution_source='sealed_acquisition_slot_v2' THEN
    SELECT * INTO batch FROM import_batches
      WHERE id=NEW.import_batch_id AND workspace_id=NEW.workspace_id;
    IF batch.id IS NULL OR batch.acquisition_contract_version<>'signal-acquisition-import-v2'
       OR NEW.data_source_id IS DISTINCT FROM batch.data_source_id
       OR NEW.acquisition_query_evidence_class IS DISTINCT FROM batch.acquisition_query_evidence_class
       OR NEW.acquisition_query_version_id IS DISTINCT FROM batch.acquisition_query_version_id
       OR NEW.acquisition_query_evidence_actor_user_id IS DISTINCT FROM batch.acquisition_query_evidence_actor_user_id THEN
      RAISE EXCEPTION 'Acquisition source-intent query evidence does not match its sealed import.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_source_intent_query_evidence_v2 ON signal_mention_attributions;
CREATE TRIGGER validate_signal_source_intent_query_evidence_v2 BEFORE INSERT OR UPDATE
  ON signal_mention_attributions FOR EACH ROW EXECUTE FUNCTION validate_signal_source_intent_query_evidence_v2();

ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_acquisition_shape;
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
    AND acquisition_sealed_at IS NULL AND acquisition_query_evidence_class IS NULL
    AND acquisition_query_evidence_reason IS NULL
    AND acquisition_query_evidence_actor_user_id IS NULL
    AND acquisition_query_evidence_attested_at IS NULL
    AND provider_execution_reference_hash IS NULL
    AND provider_execution_adapter_key IS NULL
    AND provider_execution_verified_at IS NULL
    AND acquisition_import_seal_digest IS NULL)
  OR (acquisition_contract_version='signal-acquisition-import-v1'
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
    AND acquisition_sealed_at IS NOT NULL AND acquisition_query_evidence_class IS NULL
    AND acquisition_query_evidence_reason IS NULL
    AND acquisition_query_evidence_actor_user_id IS NULL
    AND acquisition_query_evidence_attested_at IS NULL
    AND provider_execution_reference_hash IS NULL
    AND provider_execution_adapter_key IS NULL
    AND provider_execution_verified_at IS NULL
    AND acquisition_import_seal_digest IS NULL)
  OR (acquisition_contract_version='signal-acquisition-import-v2'
    AND acquisition_plan_id IS NOT NULL AND acquisition_slot_id IS NOT NULL
    AND capture_period_start IS NOT NULL AND capture_period_end IS NOT NULL
    AND capture_period_end>=capture_period_start
    AND capture_timezone IS NOT NULL AND length(btrim(capture_timezone))>0
    AND acquisition_plan_digest ~ '^sha256:[0-9a-f]{64}$'
    AND acquisition_slot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND acquisition_brand_os_digest ~ '^sha256:[0-9a-f]{64}$'
    AND acquisition_identity_catalog_digest ~ '^sha256:[0-9a-f]{64}$'
    AND acquisition_import_seal_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provider_schema_version='sentione-csv-47-v1'
    AND provider_observation_projection_state IN ('pending','ready','not_available')
    AND provider_observation_count IS NOT NULL AND provider_observation_count>=0
    AND acquisition_sealed_at IS NOT NULL
    AND acquisition_query_evidence_class IN ('provider_verified','operator_attested','unavailable')
    AND acquisition_query_evidence_actor_user_id IS NOT NULL
    AND acquisition_query_evidence_attested_at IS NOT NULL
    AND (
      (acquisition_query_evidence_class='provider_verified'
        AND acquisition_query_version_id IS NOT NULL
        AND acquisition_query_digest ~ '^sha256:[0-9a-f]{64}$'
        AND acquisition_query_evidence_reason IS NULL
        AND provider_execution_reference_hash ~ '^sha256:[0-9a-f]{64}$'
        AND provider_execution_adapter_key='sentione-server-api-v1'
        AND provider_execution_verified_at IS NOT NULL)
      OR (acquisition_query_evidence_class='operator_attested'
        AND acquisition_query_version_id IS NOT NULL
        AND acquisition_query_digest ~ '^sha256:[0-9a-f]{64}$'
        AND acquisition_query_evidence_reason IS NULL
        AND provider_execution_reference_hash IS NULL
        AND provider_execution_adapter_key IS NULL
        AND provider_execution_verified_at IS NULL)
      OR (acquisition_query_evidence_class='unavailable'
        AND acquisition_query_version_id IS NULL AND acquisition_query_digest IS NULL
        AND acquisition_query_evidence_reason IN (
          'historical_export','provider_did_not_embed_query','source_context_unavailable','other'
        )
        AND provider_execution_reference_hash IS NULL
        AND provider_execution_adapter_key IS NULL
        AND provider_execution_verified_at IS NULL)
    ))
);

CREATE INDEX IF NOT EXISTS idx_import_batches_query_evidence
  ON import_batches(workspace_id,acquisition_query_evidence_class,created_at,id)
  WHERE acquisition_contract_version='signal-acquisition-import-v2';

CREATE OR REPLACE FUNCTION enforce_signal_acquisition_import_seal_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan signal_acquisition_plans%ROWTYPE;DECLARE slot signal_acquisition_slots%ROWTYPE;
DECLARE query signal_acquisition_query_versions%ROWTYPE;DECLARE prior import_batches%ROWTYPE;
DECLARE projection_count integer;DECLARE membership_count integer;DECLARE is_recovery boolean:=false;
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
      OR OLD.acquisition_sealed_at IS DISTINCT FROM NEW.acquisition_sealed_at
      OR OLD.acquisition_query_evidence_class IS DISTINCT FROM NEW.acquisition_query_evidence_class
      OR OLD.acquisition_query_evidence_reason IS DISTINCT FROM NEW.acquisition_query_evidence_reason
      OR OLD.acquisition_query_evidence_actor_user_id IS DISTINCT FROM NEW.acquisition_query_evidence_actor_user_id
      OR OLD.acquisition_query_evidence_attested_at IS DISTINCT FROM NEW.acquisition_query_evidence_attested_at
      OR OLD.provider_execution_reference_hash IS DISTINCT FROM NEW.provider_execution_reference_hash
      OR OLD.provider_execution_adapter_key IS DISTINCT FROM NEW.provider_execution_adapter_key
      OR OLD.provider_execution_verified_at IS DISTINCT FROM NEW.provider_execution_verified_at
      OR OLD.acquisition_import_seal_digest IS DISTINCT FROM NEW.acquisition_import_seal_digest) THEN
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
    IF prior.acquisition_contract_version IS NULL AND NEW.acquisition_contract_version IS NOT NULL THEN
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
      OR NEW.acquisition_sealed_at IS DISTINCT FROM prior.acquisition_sealed_at
      OR NEW.acquisition_query_evidence_class IS DISTINCT FROM prior.acquisition_query_evidence_class
      OR NEW.acquisition_query_evidence_reason IS DISTINCT FROM prior.acquisition_query_evidence_reason
      OR NEW.acquisition_query_evidence_actor_user_id IS DISTINCT FROM prior.acquisition_query_evidence_actor_user_id
      OR NEW.acquisition_query_evidence_attested_at IS DISTINCT FROM prior.acquisition_query_evidence_attested_at
      OR NEW.provider_execution_reference_hash IS DISTINCT FROM prior.provider_execution_reference_hash
      OR NEW.provider_execution_adapter_key IS DISTINCT FROM prior.provider_execution_adapter_key
      OR NEW.provider_execution_verified_at IS DISTINCT FROM prior.provider_execution_verified_at
      OR NEW.acquisition_import_seal_digest IS DISTINCT FROM prior.acquisition_import_seal_digest) THEN
      RAISE EXCEPTION 'Acquisition recovery must preserve the original seal.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2')
     AND TG_OP='INSERT' AND NOT is_recovery THEN
    SELECT * INTO plan FROM signal_acquisition_plans
      WHERE id=NEW.acquisition_plan_id AND workspace_id=NEW.workspace_id;
    SELECT * INTO slot FROM signal_acquisition_slots
      WHERE id=NEW.acquisition_slot_id AND workspace_id=NEW.workspace_id
        AND plan_id=NEW.acquisition_plan_id;
    IF NEW.acquisition_query_version_id IS NOT NULL THEN
      SELECT * INTO query FROM signal_acquisition_query_versions
        WHERE id=NEW.acquisition_query_version_id AND workspace_id=NEW.workspace_id
          AND plan_id=NEW.acquisition_plan_id AND slot_id=NEW.acquisition_slot_id
          AND data_source_id=NEW.data_source_id AND status='current';
    END IF;
    IF plan.status<>'current' OR slot.id IS NULL OR slot.desired_state<>'active'
       OR plan.definition_hash IS DISTINCT FROM NEW.acquisition_plan_digest
       OR slot.definition_hash IS DISTINCT FROM NEW.acquisition_slot_digest
       OR plan.brand_os_digest IS DISTINCT FROM NEW.acquisition_brand_os_digest
       OR plan.identity_catalog_digest IS DISTINCT FROM NEW.acquisition_identity_catalog_digest
       OR (NEW.acquisition_query_version_id IS NOT NULL AND (
         query.id IS NULL OR query.definition_hash IS DISTINCT FROM NEW.acquisition_query_digest
         OR query.provider_schema_version IS DISTINCT FROM NEW.provider_schema_version
         OR NEW.capture_period_start<COALESCE(query.default_period_start,NEW.capture_period_start)
         OR NEW.capture_period_end>COALESCE(query.default_period_end,NEW.capture_period_end)))
       OR (NEW.acquisition_contract_version='signal-acquisition-import-v2'
         AND (NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.acquisition_query_evidence_actor_user_id)
           OR NEW.acquisition_query_evidence_actor_user_id IS DISTINCT FROM NEW.imported_by_user_id)) THEN
      RAISE EXCEPTION 'Signal acquisition import authority is invalid or stale.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2') THEN
    IF NEW.status='completed' AND (NEW.provider_observation_projection_state='pending'
       OR NEW.provider_observation_header_hash IS NULL
       OR NEW.provider_observation_header_hash !~ '^sha256:[0-9a-f]{64}$'
       OR NEW.provider_observation_count IS NULL OR NEW.provider_observation_count<0) THEN
      RAISE EXCEPTION 'Signal acquisition typed provider projection is unresolved.' USING ERRCODE='23514';
    END IF;
    IF NEW.status='completed' AND NEW.provider_observation_projection_state='ready' THEN
      SELECT count(*)::int INTO projection_count FROM signal_provider_mention_observations observation
      WHERE observation.import_batch_id=NEW.id AND NOT EXISTS(
        SELECT 1 FROM signal_provider_mention_observations successor
        WHERE successor.supersedes_observation_id=observation.id);
      SELECT count(*)::int INTO membership_count FROM signal_mention_import_memberships membership
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

ALTER TABLE signal_provider_mention_observations
  DROP CONSTRAINT IF EXISTS signal_provider_mention_observations_check;
ALTER TABLE signal_provider_mention_observations
  DROP CONSTRAINT IF EXISTS signal_provider_observation_acquisition_shape_v2;
ALTER TABLE signal_provider_mention_observations
  ADD CONSTRAINT signal_provider_observation_acquisition_shape_v2 CHECK (
    (acquisition_plan_id IS NULL AND acquisition_slot_id IS NULL
      AND acquisition_query_version_id IS NULL AND acquisition_plan_digest IS NULL
      AND acquisition_slot_digest IS NULL AND acquisition_query_digest IS NULL)
    OR (acquisition_plan_id IS NOT NULL AND acquisition_slot_id IS NOT NULL
      AND acquisition_plan_digest ~ '^sha256:[0-9a-f]{64}$'
      AND acquisition_slot_digest ~ '^sha256:[0-9a-f]{64}$'
      AND ((acquisition_query_version_id IS NULL AND acquisition_query_digest IS NULL)
        OR (acquisition_query_version_id IS NOT NULL
          AND acquisition_query_digest ~ '^sha256:[0-9a-f]{64}$')))
  );

-- Acquisition V1/V2 persists provenance while processing but delays source intent and
-- every serving reconciliation until atomic completion. The legacy branch is unchanged.
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
  IF target.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2') THEN
    INSERT INTO signal_mention_import_memberships(
      workspace_id,mention_id,import_batch_id,data_source_id
    ) VALUES(target.workspace_id,target_mention.id,target.id,target.data_source_id)
    ON CONFLICT(mention_id,import_batch_id) DO NOTHING;
  ELSE
    PERFORM record_signal_mention_import_provenance(target_mention_id,target_import_batch_id);
  END IF;
  SELECT membership.id,membership.ingestion_disposition INTO persisted_id,current_disposition
  FROM signal_mention_import_memberships membership
  WHERE membership.mention_id=target_mention_id AND membership.import_batch_id=target_import_batch_id
  FOR UPDATE;
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

CREATE OR REPLACE FUNCTION validate_signal_provider_observation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior signal_provider_mention_observations%ROWTYPE;DECLARE batch import_batches%ROWTYPE;
DECLARE binding signal_provenance_policy_bindings%ROWTYPE;DECLARE retention signal_retention_policies%ROWTYPE;
DECLARE policies_current boolean;
BEGIN
  SELECT * INTO batch FROM import_batches WHERE id=NEW.import_batch_id AND workspace_id=NEW.workspace_id;
  IF batch.id IS NULL OR batch.data_source_id<>NEW.data_source_id THEN
    RAISE EXCEPTION 'Provider observation import authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF batch.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2') THEN
    SELECT * INTO binding FROM signal_provenance_policy_bindings
    WHERE id=NEW.provenance_binding_id AND workspace_id=NEW.workspace_id
      AND data_source_id=NEW.data_source_id AND status='active'
      AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp());
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
          AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp())) INTO policies_current;
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
    SELECT * INTO prior FROM signal_provider_mention_observations WHERE id=NEW.supersedes_observation_id;
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

CREATE OR REPLACE FUNCTION materialize_signal_workspace_import_source_intent_v1(target_import_batch_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;DECLARE source data_sources%ROWTYPE;
DECLARE workspace signal_workspaces%ROWTYPE;DECLARE inserted_count integer;
DECLARE resolved_scope text;DECLARE resolved_entity_type text;DECLARE resolved_entity_id uuid;
DECLARE resolved_review_status text;DECLARE target_slot signal_acquisition_slots%ROWTYPE;
BEGIN
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR SHARE;
  SELECT * INTO source FROM data_sources WHERE id=target.data_source_id;
  SELECT * INTO workspace FROM signal_workspaces WHERE id=target.workspace_id;
  IF target.id IS NULL OR source.id IS NULL OR workspace.id IS NULL
     OR source.workspace_id IS DISTINCT FROM target.workspace_id THEN
    RAISE EXCEPTION 'Workspace import source intent cannot cross workspaces.' USING ERRCODE='23514';
  END IF;
  IF target.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2') THEN
    SELECT * INTO target_slot FROM signal_acquisition_slots WHERE id=target.acquisition_slot_id
      AND workspace_id=target.workspace_id AND plan_id=target.acquisition_plan_id;
    IF target_slot.id IS NULL THEN
      RAISE EXCEPTION 'Sealed acquisition slot is unavailable.' USING ERRCODE='23514';
    END IF;
    resolved_scope:=target_slot.scope;resolved_entity_type:=target_slot.entity_type;
    resolved_entity_id:=target_slot.entity_id;resolved_review_status:='pending';
  ELSE
    resolved_scope:=COALESCE(source.governed_scope,CASE
      WHEN target.mention_type='brand' OR target.entity_kind='primary_brand' THEN 'primary_brand'
      WHEN target.mention_type='competitor' OR target.entity_kind IN ('competitor','competitor_pool') THEN 'competitor'
      WHEN target.mention_type='industry' OR target.entity_kind='category' THEN 'category'
      WHEN target.entity_kind='reference' THEN 'reference' ELSE 'unattributed' END);
    resolved_entity_type:=COALESCE(source.governed_entity_type,CASE resolved_scope
      WHEN 'primary_brand' THEN 'brand' WHEN 'competitor' THEN 'competitor'
      WHEN 'category' THEN 'category' WHEN 'reference' THEN 'reference' ELSE 'unattributed' END);
    resolved_entity_id:=COALESCE(source.governed_entity_id,CASE resolved_scope
      WHEN 'primary_brand' THEN workspace.brand_id WHEN 'competitor' THEN target.competitor_id ELSE NULL END);
    resolved_review_status:=CASE WHEN source.governed_scope IS NULL THEN 'approved' ELSE source.scope_review_status END;
  END IF;
  PERFORM set_config('noisia.import_bulk_reconcile','on',true);
  INSERT INTO signal_mention_attributions(
    workspace_id,mention_id,data_source_id,import_batch_id,scope,entity_type,entity_id,
    entity_label,confidence,review_status,attribution_source,policy_version,
    approved_by_user_id,approval_source,approved_at,attribution_basis,eligibility_status,
    acquisition_query_evidence_class,acquisition_query_version_id,
    acquisition_query_evidence_actor_user_id
  ) SELECT target.workspace_id,membership.mention_id,source.id,target.id,resolved_scope,
    resolved_entity_type,resolved_entity_id,
    CASE WHEN target.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2')
      THEN target_slot.label ELSE COALESCE(target.entity_label,source.name) END,
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v2'
      THEN NULL ELSE 1.0000 END,resolved_review_status,
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v2' THEN 'sealed_acquisition_slot_v2'
      WHEN target.acquisition_contract_version='signal-acquisition-import-v1' THEN 'sealed_acquisition_slot'
      WHEN source.governed_scope IS NULL THEN 'legacy_import_batch' ELSE 'governed_data_source' END,
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v2'
      THEN 'signal-acquisition-source-intent-v2'
      WHEN target.acquisition_contract_version='signal-acquisition-import-v1'
      THEN 'signal-acquisition-source-intent-v1'
      ELSE COALESCE(source.scope_policy_version,'workspace-scope-legacy-v1') END,
    CASE WHEN target.acquisition_contract_version IS NULL AND resolved_review_status='approved'
      THEN source.scope_approved_by_user_id END,
    CASE WHEN target.acquisition_contract_version IS NULL AND resolved_review_status='approved'
      THEN COALESCE(source.scope_approval_source,'legacy_import_scope') END,
    CASE WHEN target.acquisition_contract_version IS NULL AND resolved_review_status='approved'
      THEN COALESCE(source.scope_approved_at,now()) END,
    'source_intent','not_eligible',
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v2'
      THEN target.acquisition_query_evidence_class END,
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v2'
      THEN target.acquisition_query_version_id END,
    CASE WHEN target.acquisition_contract_version='signal-acquisition-import-v2'
      THEN target.acquisition_query_evidence_actor_user_id END
  FROM signal_mention_import_memberships membership WHERE membership.import_batch_id=target.id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  PERFORM set_config('noisia.import_bulk_reconcile','off',true);
  RETURN inserted_count;
END; $$;

CREATE OR REPLACE FUNCTION create_signal_workspace_import_storage_recovery_v1(
  target_failed_import_batch_id uuid,target_actor_user_id uuid,target_idempotency_key text,
  target_request_digest text,target_storage_content_hash text
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
    query_iteration_id,query_pack_id,query_validation_run_id,mention_type,competitor_id,
    corpus_entity_id,entity_kind,entity_label,source_system,source_file_name,source_file_hash,
    ingestion_phase,storage_bucket,storage_object_key,upload_protocol,expected_file_size_bytes,
    storage_part_count,storage_part_size_bytes,storage_content_hash,storage_source_import_batch_id,
    supersedes_import_batch_id,product_idempotency_key,product_request_digest,imported_by_user_id,status,
    acquisition_contract_version,acquisition_plan_id,acquisition_slot_id,acquisition_query_version_id,
    capture_period_start,capture_period_end,capture_timezone,acquisition_plan_digest,
    acquisition_slot_digest,acquisition_query_digest,acquisition_brand_os_digest,
    acquisition_identity_catalog_digest,provider_schema_version,provider_observation_projection_state,
    provider_observation_header_hash,provider_observation_count,acquisition_sealed_at,
    acquisition_query_evidence_class,acquisition_query_evidence_reason,
    acquisition_query_evidence_actor_user_id,acquisition_query_evidence_attested_at,
    provider_execution_reference_hash,provider_execution_adapter_key,provider_execution_verified_at,
    acquisition_import_seal_digest
  ) VALUES(
    prior.workspace_id,prior.study_corpus_id,prior.contributed_by_study_corpus_id,prior.data_source_id,
    prior.query_iteration_id,prior.query_pack_id,prior.query_validation_run_id,prior.mention_type,
    prior.competitor_id,prior.corpus_entity_id,prior.entity_kind,prior.entity_label,prior.source_system,
    prior.source_file_name,NULL,'queued',prior.storage_bucket,prior.storage_object_key,
    prior.upload_protocol,prior.expected_file_size_bytes,prior.storage_part_count,
    prior.storage_part_size_bytes,target_storage_content_hash,prior.id,prior.id,target_idempotency_key,
    target_request_digest,target_actor_user_id,'queued',prior.acquisition_contract_version,
    prior.acquisition_plan_id,prior.acquisition_slot_id,prior.acquisition_query_version_id,
    prior.capture_period_start,prior.capture_period_end,prior.capture_timezone,
    prior.acquisition_plan_digest,prior.acquisition_slot_digest,prior.acquisition_query_digest,
    prior.acquisition_brand_os_digest,prior.acquisition_identity_catalog_digest,
    prior.provider_schema_version,CASE WHEN prior.acquisition_contract_version IS NULL THEN NULL ELSE 'pending' END,
    NULL,CASE WHEN prior.acquisition_contract_version IS NULL THEN NULL ELSE 0 END,prior.acquisition_sealed_at,
    prior.acquisition_query_evidence_class,prior.acquisition_query_evidence_reason,
    prior.acquisition_query_evidence_actor_user_id,prior.acquisition_query_evidence_attested_at,
    prior.provider_execution_reference_hash,prior.provider_execution_adapter_key,
    prior.provider_execution_verified_at,prior.acquisition_import_seal_digest
  ) RETURNING * INTO persisted;
  INSERT INTO signal_workspace_import_events(workspace_id,import_batch_id,event_type,actor_user_id,detail)
  VALUES(prior.workspace_id,persisted.id,'retry-created',target_actor_user_id,
    jsonb_build_object('storage_reused',true,'supersedes_import_batch_id',prior.id,
      'verified_size_bytes',prior.expected_file_size_bytes,'acquisition_seal_preserved',
      prior.acquisition_contract_version IS NOT NULL,'query_evidence_preserved',
      prior.acquisition_query_evidence_class IS NOT NULL));
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
  IF prior.acquisition_contract_version IS NULL AND NEW.acquisition_contract_version IS NOT NULL THEN
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
    OR NEW.acquisition_sealed_at IS DISTINCT FROM prior.acquisition_sealed_at
    OR NEW.acquisition_query_evidence_class IS DISTINCT FROM prior.acquisition_query_evidence_class
    OR NEW.acquisition_query_evidence_reason IS DISTINCT FROM prior.acquisition_query_evidence_reason
    OR NEW.acquisition_query_evidence_actor_user_id IS DISTINCT FROM prior.acquisition_query_evidence_actor_user_id
    OR NEW.acquisition_query_evidence_attested_at IS DISTINCT FROM prior.acquisition_query_evidence_attested_at
    OR NEW.provider_execution_reference_hash IS DISTINCT FROM prior.provider_execution_reference_hash
    OR NEW.provider_execution_adapter_key IS DISTINCT FROM prior.provider_execution_adapter_key
    OR NEW.provider_execution_verified_at IS DISTINCT FROM prior.provider_execution_verified_at
    OR NEW.acquisition_import_seal_digest IS DISTINCT FROM prior.acquisition_import_seal_digest) THEN
    RAISE EXCEPTION 'Acquisition recovery must preserve the original seal.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON COLUMN import_batches.acquisition_query_evidence_class IS
  'Graduated query evidence: provider_verified, operator_attested, or unavailable. Never semantic truth.';
COMMENT ON COLUMN import_batches.acquisition_import_seal_digest IS
  'Immutable V2 aggregate seal covering plan, slot, evidence class, period, actor and authority digests.';
COMMENT ON COLUMN signal_mention_attributions.acquisition_query_evidence_class IS
  'Projection of immutable V2 import query evidence for source-intent lineage; import_batches remains authority.';
