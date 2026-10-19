-- Backend 10C.2B: append-only import-scoped strategic authority.
--
-- The policy and binding tables introduced in 0069 already support an import-scoped
-- licensing exception. This migration closes the two structural gaps needed to use
-- that authority safely: a durable product-operation identity and a single immutable
-- successor for each typed provider observation.

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
    'retire-competitor','reactivate-competitor','create-competitor','seal-acquisition-import',
    'seal-acquisition-brief','generate-acquisition-queries',
    'authorize-acquisition-benchmark'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_provider_observation_successor
  ON signal_provider_mention_observations(supersedes_observation_id)
  WHERE supersedes_observation_id IS NOT NULL;

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
    SELECT * INTO prior FROM signal_provider_mention_observations
      WHERE id=NEW.supersedes_observation_id FOR SHARE;
    IF prior.id IS NULL OR prior.workspace_id<>NEW.workspace_id
       OR prior.import_batch_id<>NEW.import_batch_id OR prior.mention_id<>NEW.mention_id
       OR prior.provider_key<>NEW.provider_key
       OR prior.provider_record_key_hash<>NEW.provider_record_key_hash
       OR NEW.observation_version<>prior.observation_version+1
       OR EXISTS(SELECT 1 FROM signal_provider_mention_observations successor
          WHERE successor.supersedes_observation_id=prior.id)
       OR (to_jsonb(NEW)-ARRAY['id','observation_version','supersedes_observation_id',
          'provenance_binding_id','rights_definition_hash','retention_until','created_at']::text[])
          IS DISTINCT FROM
          (to_jsonb(prior)-ARRAY['id','observation_version','supersedes_observation_id',
          'provenance_binding_id','rights_definition_hash','retention_until','created_at']::text[]) THEN
      RAISE EXCEPTION 'Provider observation supersession is invalid.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.observation_version<>1 THEN
    RAISE EXCEPTION 'Initial provider observation version must be one.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON INDEX uq_signal_provider_observation_successor IS
  'A typed provider observation has at most one append-only successor; retries reuse the completed governance operation.';
COMMENT ON FUNCTION validate_signal_provider_observation_v1() IS
  'Preserves the immutable provider/acquisition payload across rights-only observation supersession and validates the current import-scoped binding.';
