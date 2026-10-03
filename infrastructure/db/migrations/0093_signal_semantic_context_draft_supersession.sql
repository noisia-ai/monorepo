-- Backend 69A.3: append-only Semantic Context draft reconciliation.
--
-- A stale draft remains immutable. Its replacement is a new generation that points
-- to the prior effective generation and seals current Brand OS, Knowledge, locale and
-- provider lineage. This migration creates no generation, proposal, provider call,
-- Topic Contract, assignment, record_tag, pointer or serving binding.

ALTER TABLE signal_semantic_context_generations
  ADD COLUMN IF NOT EXISTS supersession_reason text;

ALTER TABLE signal_semantic_context_generations
  DROP CONSTRAINT IF EXISTS signal_semantic_context_generation_supersession_reason;
ALTER TABLE signal_semantic_context_generations
  ADD CONSTRAINT signal_semantic_context_generation_supersession_reason CHECK(
    supersession_reason IS NULL OR supersession_reason IN (
      'brand_os_drift','knowledge_drift','locale_market_drift',
      'provider_lineage_missing','provider_lineage_changed',
      'operator_requested_reconciliation'
    )
  );

-- Historical drafts must remain byte-for-byte intact. Effective uniqueness is the
-- single leaf of the supersession chain, enforced by the INSERT trigger under the
-- same workspace advisory lock as the application writer.
DROP INDEX IF EXISTS uq_signal_semantic_context_open_draft;
CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_draft_history
  ON signal_semantic_context_generations(workspace_id,generation_version DESC)
  WHERE status='draft';

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
    'seal-acquisition-brief','generate-acquisition-queries','authorize-acquisition-benchmark',
    'register-topic-discovery-review','save-topic-discovery-review-draft',
    'save-topic-discovery-outlier-draft','finalize-topic-discovery-review',
    'supersede-topic-discovery-review','create-semantic-context-draft',
    'reconcile-semantic-context-generation','append-semantic-context-proposals',
    'decide-semantic-context-element','bulk-approve-semantic-context-elements',
    'publish-semantic-context-generation','start-semantic-context-proposal-run',
    'retry-semantic-context-proposal-run'
  ));

ALTER TABLE signal_semantic_context_events
  DROP CONSTRAINT IF EXISTS signal_semantic_context_event_kind;
ALTER TABLE signal_semantic_context_events
  ADD CONSTRAINT signal_semantic_context_event_kind CHECK(event_kind IN (
    'generation_created','generation_reconciled','proposals_appended','element_approved',
    'element_rejected','element_corrected','elements_bulk_approved','generation_published'
  ));

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_kind text;artifact_authority text;profile_brand uuid;workspace_brand uuid;
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE predecessor signal_semantic_context_generations%ROWTYPE;
BEGIN
  SELECT workspace_artifact_kind,workspace_authority_digest
    INTO artifact_kind,artifact_authority
  FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  IF artifact_kind IS DISTINCT FROM 'semantic_context'
     OR artifact_authority !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Semantic context generation artifact authority is incompatible.' USING ERRCODE='23514';
  END IF;
  SELECT brand_id INTO profile_brand FROM brand_os_profiles WHERE id=NEW.brand_os_profile_id;
  SELECT brand_id INTO workspace_brand FROM signal_workspaces WHERE id=NEW.workspace_id;
  IF profile_brand IS NULL OR workspace_brand IS NULL OR profile_brand<>workspace_brand THEN
    RAISE EXCEPTION 'Semantic context generation is cross-workspace.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||NEW.workspace_id::text,0));
    SELECT * INTO operation FROM signal_governance_control_operations
      WHERE id=NEW.created_operation_id;
    IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
       OR operation.actor_user_id<>NEW.created_by_user_id
       OR operation.action NOT IN ('create-semantic-context-draft','reconcile-semantic-context-generation')
       OR operation.status<>'in_progress'
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id) THEN
      RAISE EXCEPTION 'Semantic context generation operation authority is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.supersedes_generation_id IS NULL THEN
      IF operation.action<>'create-semantic-context-draft' OR NEW.supersession_reason IS NOT NULL
         OR EXISTS(SELECT 1 FROM signal_semantic_context_generations
           WHERE workspace_id=NEW.workspace_id) THEN
        RAISE EXCEPTION 'Initial semantic context generation is incompatible.' USING ERRCODE='23514';
      END IF;
    ELSE
      SELECT * INTO predecessor FROM signal_semantic_context_generations
        WHERE id=NEW.supersedes_generation_id AND workspace_id=NEW.workspace_id;
      IF operation.action<>'reconcile-semantic-context-generation'
         OR NEW.supersession_reason IS NULL
         OR predecessor.id IS NULL
         OR predecessor.generation_version<>NEW.generation_version-1
         OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
           WHERE successor.supersedes_generation_id=predecessor.id) THEN
        RAISE EXCEPTION 'Semantic context generation supersession is incompatible.' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF OLD.status='draft' AND NEW.status='published' THEN
    SELECT * INTO operation FROM signal_governance_control_operations
      WHERE id=NEW.published_operation_id;
    IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
       OR operation.actor_user_id<>NEW.published_by_user_id
       OR operation.action<>'publish-semantic-context-generation'
       OR operation.status<>'in_progress'
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.published_by_user_id) THEN
      RAISE EXCEPTION 'Semantic context publication operation authority is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Semantic context generations cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF OLD.status='published' THEN
    RAISE EXCEPTION 'Published semantic context generations are immutable.' USING ERRCODE='55000';
  END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.artifact_id<>OLD.artifact_id
     OR NEW.generation_key<>OLD.generation_key OR NEW.generation_version<>OLD.generation_version
     OR NEW.supersedes_generation_id IS DISTINCT FROM OLD.supersedes_generation_id
     OR NEW.supersession_reason IS DISTINCT FROM OLD.supersession_reason
     OR NEW.brand_os_profile_id<>OLD.brand_os_profile_id
     OR NEW.brand_os_profile_version<>OLD.brand_os_profile_version
     OR NEW.brand_os_digest<>OLD.brand_os_digest
     OR NEW.knowledge_generation_key<>OLD.knowledge_generation_key
     OR NEW.knowledge_digest<>OLD.knowledge_digest
     OR NEW.locale_context_digest<>OLD.locale_context_digest
     OR NEW.primary_locale<>OLD.primary_locale OR NEW.locale_variants<>OLD.locale_variants
     OR NEW.markets<>OLD.markets OR NEW.timezone<>OLD.timezone
     OR NEW.proposal_model IS DISTINCT FROM OLD.proposal_model
     OR NEW.proposal_model_version IS DISTINCT FROM OLD.proposal_model_version
     OR NEW.proposal_prompt_digest IS DISTINCT FROM OLD.proposal_prompt_digest
     OR NEW.proposal_pricing_version IS DISTINCT FROM OLD.proposal_pricing_version
     OR NEW.created_operation_id<>OLD.created_operation_id
     OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Semantic context generation authority cannot be rewritten.' USING ERRCODE='55000';
  END IF;
  IF NEW.status='draft' AND (NEW.pack_digest IS NOT NULL OR NEW.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Draft semantic context publication fields are invalid.' USING ERRCODE='55000';
  END IF;
  IF NEW.status NOT IN ('draft','published') THEN
    RAISE EXCEPTION 'Semantic context generation lifecycle is invalid.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;expected_action text;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  expected_action:=CASE NEW.event_kind
    WHEN 'generation_created' THEN 'create-semantic-context-draft'
    WHEN 'generation_reconciled' THEN 'reconcile-semantic-context-generation'
    WHEN 'proposals_appended' THEN 'append-semantic-context-proposals'
    WHEN 'element_approved' THEN 'decide-semantic-context-element'
    WHEN 'element_rejected' THEN 'decide-semantic-context-element'
    WHEN 'element_corrected' THEN 'decide-semantic-context-element'
    WHEN 'elements_bulk_approved' THEN 'bulk-approve-semantic-context-elements'
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id
     OR operation.action IS DISTINCT FROM expected_action
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON COLUMN signal_semantic_context_generations.supersession_reason IS
  'Closed operator-safe cause for an append-only reconciled successor. NULL only for an initial or historical generation.';
