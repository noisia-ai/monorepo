-- Backend 69A.7A: terminal-run successor authority and proposal-run guard.
--
-- A consumed draft is never reopened or rewritten. The only supported transition is
-- a new append-only generation whose predecessor has one safely terminal run and no
-- reviewable elements or executable provider work. This migration creates no
-- generation, run, reservation, outbox, proposal, provider call or serving write.

ALTER TABLE signal_semantic_context_generations
  DROP CONSTRAINT IF EXISTS signal_semantic_context_generation_supersession_reason;
ALTER TABLE signal_semantic_context_generations
  ADD CONSTRAINT signal_semantic_context_generation_supersession_reason CHECK(
    supersession_reason IS NULL OR supersession_reason IN (
      'brand_os_drift','knowledge_drift','locale_market_drift',
      'provider_lineage_missing','provider_lineage_changed',
      'operator_requested_reconciliation','terminal_provider_run'
    )
  );

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_kind text;artifact_authority text;profile_brand uuid;workspace_brand uuid;
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE predecessor signal_semantic_context_generations%ROWTYPE;
DECLARE predecessor_run signal_semantic_context_proposal_runs%ROWTYPE;
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

      SELECT * INTO predecessor_run FROM signal_semantic_context_proposal_runs
        WHERE workspace_id=NEW.workspace_id AND generation_id=predecessor.id;
      IF predecessor.status='draft' AND predecessor_run.id IS NOT NULL
         AND NEW.supersession_reason<>'terminal_provider_run' THEN
        RAISE EXCEPTION 'Consumed semantic context drafts require terminal-run supersession.' USING ERRCODE='23514';
      END IF;
      IF NEW.supersession_reason='terminal_provider_run' THEN
        IF predecessor.status<>'draft' OR predecessor_run.id IS NULL
           OR NOT (
             (predecessor_run.status='failed'
               AND predecessor_run.provider_call_state='settled'
               AND predecessor_run.provider_call_count=1
               AND predecessor_run.provider_response_digest IS NOT NULL)
             OR (predecessor_run.status='stale'
               AND predecessor_run.provider_call_state IN ('not_started','settled'))
             OR (predecessor_run.status='dead_letter'
               AND predecessor_run.provider_call_state='not_started'
               AND predecessor_run.provider_call_count=0)
           )
           OR EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element
             WHERE element.generation_id=predecessor.id AND NOT EXISTS(
               SELECT 1 FROM signal_semantic_context_element_versions successor
               WHERE successor.supersedes_element_id=element.id))
           OR EXISTS(SELECT 1 FROM signal_semantic_context_proposal_outbox outbox
             WHERE outbox.run_id=predecessor_run.id
               AND outbox.status IN ('pending','failed','dispatching','dispatched'))
           OR EXISTS(SELECT 1 FROM signal_semantic_context_budget_reservations reservation
             WHERE reservation.run_id=predecessor_run.id AND reservation.status='reserved') THEN
          RAISE EXCEPTION 'Terminal semantic context run is not eligible for a fresh successor.' USING ERRCODE='23514';
        END IF;
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

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_proposal_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||NEW.workspace_id::text,0));
  SELECT * INTO generation FROM signal_semantic_context_generations
    WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF generation.id IS NULL OR generation.status<>'draft'
     OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
       WHERE successor.supersedes_generation_id=generation.id)
     OR EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs existing
       WHERE existing.generation_id=generation.id)
     OR generation.brand_os_digest<>NEW.brand_os_digest
     OR generation.knowledge_digest<>NEW.knowledge_digest
     OR generation.locale_context_digest<>NEW.locale_context_digest
     OR generation.proposal_model<>NEW.model
     OR generation.proposal_model_version<>NEW.model_version
     OR generation.proposal_prompt_digest<>NEW.prompt_digest
     OR generation.proposal_pricing_version<>NEW.pricing_version THEN
    RAISE EXCEPTION 'Semantic context proposal run authority is incompatible.' USING ERRCODE='23514';
  END IF;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.created_by_user_id
     OR operation.action<>'start-semantic-context-proposal-run'
     OR operation.status<>'in_progress'
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'Semantic context proposal operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON COLUMN signal_semantic_context_generations.supersession_reason IS
  'Closed operator-safe cause for append-only reconciliation; terminal_provider_run is restricted to a consumed draft with no reviewable elements or executable provider work.';
