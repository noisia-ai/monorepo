-- Backend 69A.6: Semantic Context output contract V2 and paid-response revalidation.
--
-- A revalidation is a new append-only authority record over one immutable failed run.
-- It never mutates the original provider response, run, settlement or outbox and never
-- authorizes another provider call. Rejected normalization remains auditable with zero
-- appended proposals.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS signal_semantic_context_proposal_revalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  original_run_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  revalidation_key text NOT NULL,
  original_response_digest text NOT NULL,
  original_output_contract text NOT NULL,
  adapter_version text NOT NULL,
  target_output_contract text NOT NULL,
  normalization_version text NOT NULL,
  transformation_digest text NOT NULL,
  duplicate_decision_digest text NOT NULL,
  duplicate_decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposal_count_before integer NOT NULL,
  normalized_proposal_count integer NOT NULL,
  appended_proposal_count integer NOT NULL,
  status text NOT NULL,
  error_code text,
  appended_operation_id uuid REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  revalidation_digest text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_semantic_context_revalidation_key UNIQUE(workspace_id,revalidation_key),
  CONSTRAINT uq_signal_semantic_context_revalidation_contract UNIQUE(
    original_run_id,adapter_version,target_output_contract,normalization_version
  ),
  CONSTRAINT signal_semantic_context_revalidation_run_workspace
    FOREIGN KEY(original_run_id,workspace_id)
    REFERENCES signal_semantic_context_proposal_runs(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_revalidation_generation_workspace
    FOREIGN KEY(generation_id,workspace_id)
    REFERENCES signal_semantic_context_generations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_revalidation_status CHECK(status IN ('completed','rejected')),
  CONSTRAINT signal_semantic_context_revalidation_counts CHECK(
    proposal_count_before>0 AND normalized_proposal_count>=0
    AND normalized_proposal_count<=proposal_count_before
    AND appended_proposal_count>=0 AND appended_proposal_count<=normalized_proposal_count
  ),
  CONSTRAINT signal_semantic_context_revalidation_result CHECK(
    (status='completed' AND error_code IS NULL AND appended_operation_id IS NOT NULL
      AND normalized_proposal_count>0 AND appended_proposal_count=normalized_proposal_count)
    OR
    (status='rejected' AND error_code IS NOT NULL AND appended_operation_id IS NULL
      AND appended_proposal_count=0)
  ),
  CONSTRAINT signal_semantic_context_revalidation_digests CHECK(
    original_response_digest ~ '^sha256:[0-9a-f]{64}$'
    AND transformation_digest ~ '^sha256:[0-9a-f]{64}$'
    AND duplicate_decision_digest ~ '^sha256:[0-9a-f]{64}$'
    AND revalidation_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_revalidation_history
  ON signal_semantic_context_proposal_revalidations(workspace_id,created_at,id);

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
    'retry-semantic-context-proposal-run','revalidate-semantic-context-proposal-run'
  ));

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_revalidation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_run signal_semantic_context_proposal_runs%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;
BEGIN
  SELECT * INTO original_run FROM signal_semantic_context_proposal_runs
    WHERE id=NEW.original_run_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO generation FROM signal_semantic_context_generations
    WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF original_run.id IS NULL OR original_run.generation_id<>NEW.generation_id
     OR original_run.status<>'failed' OR original_run.provider_call_state<>'settled'
     OR original_run.provider_call_count<>1 OR original_run.provider_response_private IS NULL
     OR original_run.provider_response_digest<>NEW.original_response_digest
     OR original_run.appended_operation_id IS NOT NULL OR COALESCE(original_run.proposal_count,0)<>0 THEN
    RAISE EXCEPTION 'Semantic context paid response is not revalidatable.' USING ERRCODE='23514';
  END IF;
  IF generation.id IS NULL OR generation.status<>'draft'
     OR generation.brand_os_digest<>original_run.brand_os_digest
     OR generation.knowledge_digest<>original_run.knowledge_digest
     OR generation.locale_context_digest<>original_run.locale_context_digest THEN
    RAISE EXCEPTION 'Semantic context revalidation authority is incompatible.' USING ERRCODE='23514';
  END IF;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.created_by_user_id
     OR operation.action<>'revalidate-semantic-context-proposal-run'
     OR operation.status<>'in_progress'
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'Semantic context revalidation operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_signal_semantic_context_revalidation
  ON signal_semantic_context_proposal_revalidations;
CREATE TRIGGER trg_validate_signal_semantic_context_revalidation
BEFORE INSERT ON signal_semantic_context_proposal_revalidations
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_revalidation_v1();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_revalidation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Semantic context proposal revalidations are append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_semantic_context_revalidation
  ON signal_semantic_context_proposal_revalidations;
CREATE TRIGGER trg_protect_signal_semantic_context_revalidation
BEFORE UPDATE OR DELETE ON signal_semantic_context_proposal_revalidations
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_revalidation_v1();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_proposal_identity_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Semantic context proposal runs cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.generation_id<>OLD.generation_id
     OR NEW.operation_id<>OLD.operation_id OR NEW.run_key<>OLD.run_key
     OR NEW.preflight_digest<>OLD.preflight_digest OR NEW.brand_os_digest<>OLD.brand_os_digest
     OR NEW.knowledge_digest<>OLD.knowledge_digest
     OR NEW.locale_context_digest<>OLD.locale_context_digest
     OR NEW.prompt_digest<>OLD.prompt_digest OR NEW.context_input_digest<>OLD.context_input_digest
     OR NEW.provider<>OLD.provider OR NEW.model<>OLD.model OR NEW.model_version<>OLD.model_version
     OR NEW.pricing_version<>OLD.pricing_version OR NEW.max_input_tokens<>OLD.max_input_tokens
     OR NEW.max_output_tokens<>OLD.max_output_tokens
     OR NEW.input_usd_per_million_tokens<>OLD.input_usd_per_million_tokens
     OR NEW.output_usd_per_million_tokens<>OLD.output_usd_per_million_tokens
     OR NEW.hard_cap_micro_usd<>OLD.hard_cap_micro_usd
     OR NEW.reservation_micro_usd<>OLD.reservation_micro_usd
     OR NEW.provider_request_identity<>OLD.provider_request_identity
     OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Semantic context proposal run authority cannot be rewritten.' USING ERRCODE='55000';
  END IF;
  IF (OLD.status IN ('completed','stale','dead_letter')
      OR (OLD.status='failed' AND OLD.provider_call_state='settled'))
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal semantic context proposal runs are immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON TABLE signal_semantic_context_proposal_revalidations IS
  'Append-only audit of server-side V1/V2 adaptation over an already paid immutable response; never a provider retry.';
