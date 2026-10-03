-- Brand OS preparation uses the existing immutable operation, semantic run and embedding ledgers.
-- No provider invocation, admission, content mutation or queue insertion occurs during migration.
ALTER TABLE signal_governance_control_operations ADD COLUMN brand_context_preparation jsonb, ADD COLUMN brand_context_progress jsonb;
ALTER TABLE signal_semantic_context_proposal_runs ADD COLUMN brand_context_preparation_operation_id uuid REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT;
ALTER TABLE signal_workspace_embedding_runs ADD COLUMN brand_context_preparation_operation_id uuid REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT;
ALTER TABLE signal_governance_control_operations DROP CONSTRAINT IF EXISTS signal_governance_control_action;
ALTER TABLE signal_governance_control_operations ADD CONSTRAINT signal_governance_control_action CHECK(action IN (
  'create-quality-draft','create-retention-draft','create-licensing-draft','activate-policy',
  'create-provenance-binding-draft','activate-provenance-binding','upsert-identity','update-timezone',
  'reconcile-brand-os','create-source','import-source','reconcile-governed-view','reconcile-strategic-authority',
  'promote-strategic-authority','reconcile-acquisition-plan','promote-acquisition-plan','create-acquisition-query',
  'review-acquisition-query','retire-acquisition-slot','decide-acquisition-reference','retire-competitor',
  'reactivate-competitor','create-competitor','update-brand-context','update-brand-knowledge',
  'delete-brand-knowledge','seal-acquisition-import','seal-acquisition-brief',
  'generate-acquisition-queries','authorize-acquisition-benchmark','register-topic-discovery-review',
  'save-topic-discovery-review-draft','save-topic-discovery-outlier-draft','finalize-topic-discovery-review',
  'supersede-topic-discovery-review','create-semantic-context-draft','reconcile-semantic-context-generation',
  'append-semantic-context-proposals','decide-semantic-context-element','bulk-approve-semantic-context-elements',
  'publish-semantic-context-generation','start-semantic-context-proposal-run','retry-semantic-context-proposal-run',
  'revalidate-semantic-context-proposal-run','merge-semantic-context-elements','correct-semantic-context-element',
  'annotate-semantic-context-element','resolve-semantic-context-annotation',
  'repair-semantic-context-annotation-resolution','decide-semantic-context-locale-authority',
  'edit-semantic-context-element-v1','create-semantic-context-element-v1','prepare-brand-context'
));
CREATE FUNCTION validate_signal_brand_context_preparation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE input jsonb;grant_data jsonb;generation signal_semantic_context_generations%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' AND NEW.brand_context_progress IS NOT NULL THEN
    RAISE EXCEPTION 'Preparation progress starts empty.' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.brand_context_preparation IS DISTINCT FROM OLD.brand_context_preparation THEN
      RAISE EXCEPTION 'Brand context preparation input is immutable.' USING ERRCODE='23514';
    END IF; RETURN NEW;
  END IF;
  IF NEW.action<>'prepare-brand-context' THEN
    IF NEW.brand_context_preparation IS NOT NULL THEN RAISE EXCEPTION 'Preparation action mismatch.' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  input:=NEW.brand_context_preparation;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=(input->>'generation_id')::uuid;
  IF input IS NULL OR input->>'contract_version' IS DISTINCT FROM 'brand-context-preparation-input-v1'
    OR generation.id IS NULL OR generation.workspace_id<>NEW.workspace_id
    OR input->>'generation_key' IS DISTINCT FROM generation.generation_key
    OR input->>'primary_locale' IS DISTINCT FROM generation.primary_locale
    OR input->>'source_authority_digest' IS DISTINCT FROM (SELECT workspace_authority_digest FROM analysis_artifacts WHERE id=generation.artifact_id)
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal') THEN
    RAISE EXCEPTION 'Brand context preparation authority mismatch.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.id=generation.artifact_id
       AND artifact.metadata ? 'completed_stale_predecessor_run_id')
    AND NOT EXISTS(SELECT 1 FROM signal_governance_control_operations prior WHERE prior.workspace_id=NEW.workspace_id
       AND prior.action='prepare-brand-context' AND prior.status='completed'
       AND prior.brand_context_preparation->>'generation_id'=generation.id::text)
    AND input->'admission' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Historical authority transition requires a separate fresh admission.' USING ERRCODE='23514'; END IF;
  IF input ? 'replaced_prototype_run_ids' THEN
    IF jsonb_typeof(input->'replaced_prototype_run_ids') IS DISTINCT FROM 'array'
      OR jsonb_array_length(input->'replaced_prototype_run_ids')=0
      OR input->'admission' IS NULL OR input->'admission'='null'::jsonb
      OR generation.status<>'published' THEN
      RAISE EXCEPTION 'Prototype replacement receipt invalid.' USING ERRCODE='23514'; END IF;
    IF (SELECT count(*)<>count(DISTINCT value::uuid) FROM jsonb_array_elements_text(input->'replaced_prototype_run_ids'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(input->'replaced_prototype_run_ids') candidate(id)
        LEFT JOIN signal_workspace_embedding_runs run ON run.id=candidate.id::uuid
        LEFT JOIN signal_governance_control_operations origin ON origin.id=run.brand_context_preparation_operation_id
        WHERE run.id IS NULL OR run.workspace_id<>NEW.workspace_id OR run.actor_user_id<>NEW.actor_user_id
          OR origin.brand_context_preparation->>'generation_id' IS DISTINCT FROM generation.id::text
          OR origin.brand_context_preparation->'admission'->>'configuration_digest'
            IS NOT DISTINCT FROM input->'admission'->>'configuration_digest'
          OR run.status<>'failed' OR NOT signal_brand_context_prototype_unspent_v1(run.id)) THEN
      RAISE EXCEPTION 'Prototype replacement scope or outcome invalid.' USING ERRCODE='23514'; END IF;
  END IF;
  grant_data:=input->'admission';
  IF grant_data IS DISTINCT FROM 'null'::jsonb AND grant_data IS NOT NULL THEN
    IF grant_data->>'contract_version' IS DISTINCT FROM 'brand-context-preparation-quote-v1'
      OR grant_data->>'available' IS DISTINCT FROM 'true' OR grant_data->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
      OR grant_data->>'embedding_model' IS DISTINCT FROM 'voyage-4-large'
      OR NOT COALESCE(grant_data->>'configuration_digest' ~ '^sha256:[0-9a-f]{64}$',false)
      OR NOT COALESCE(grant_data->>'quote_digest' ~ '^sha256:[0-9a-f]{64}$',false)
      OR NOT COALESCE(grant_data->>'semantic_cap_micro_usd' ~ '^[1-9][0-9]{0,14}$',false)
      OR NOT COALESCE(grant_data->>'prototype_cap_micro_usd' ~ '^(0|[1-9][0-9]{0,14})$',false)
      OR NOT grant_data ?& ARRAY['configuration_digest','quote_digest','quote_expires_at','admission_not_after','blocked_reason']
      OR grant_data->>'quote_digest' IS DISTINCT FROM signal_semantic_context_digest_json_v2(
        (grant_data-'quote_digest')||jsonb_build_object('actor_user_id',lower(NEW.actor_user_id::text)))
      OR COALESCE((grant_data->>'quote_expires_at')::timestamptz<=clock_timestamp(),true)
      OR COALESCE((grant_data->>'quote_expires_at')::timestamptz>(grant_data->>'admission_not_after')::timestamptz,true)
      OR (grant_data->>'admission_not_after')::timestamptz<=clock_timestamp()
      OR (grant_data->>'admission_not_after')::timestamptz>clock_timestamp()+interval '24 hours' THEN
      RAISE EXCEPTION 'Brand context preparation admission invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_signal_brand_context_preparation BEFORE INSERT OR UPDATE ON signal_governance_control_operations
FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_preparation_v1();

CREATE FUNCTION signal_brand_context_admission_valid_v1(p_operation_id uuid,p_workspace_id uuid,p_actor_id uuid,p_generation_id uuid,p_provider text,p_cap bigint)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 -- The original run pointer remains immutable provenance. A later explicit receipt can
 -- renew only the same actor, generation, configuration and original per-run caps.
 SELECT EXISTS(SELECT 1 FROM signal_governance_control_operations origin
 JOIN signal_semantic_context_generations gen ON gen.id=(origin.brand_context_preparation->>'generation_id')::uuid
 JOIN LATERAL(SELECT candidate.* FROM signal_governance_control_operations candidate
   WHERE candidate.workspace_id=origin.workspace_id AND candidate.actor_user_id=origin.actor_user_id
     AND candidate.action='prepare-brand-context' AND candidate.status='completed'
     AND candidate.brand_context_preparation->>'generation_id'=gen.id::text
     AND candidate.brand_context_preparation->'admission'<>'null'::jsonb
   ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1) op ON true
 WHERE origin.id=p_operation_id AND origin.workspace_id=p_workspace_id AND origin.actor_user_id=p_actor_id
 AND origin.action='prepare-brand-context' AND origin.status='completed' AND gen.id=p_generation_id
 AND origin.brand_context_preparation->'admission'->>'configuration_digest'
   =op.brand_context_preparation->'admission'->>'configuration_digest'
 AND origin.brand_context_preparation->'admission'->>'semantic_cap_micro_usd'
   =op.brand_context_preparation->'admission'->>'semantic_cap_micro_usd'
 AND origin.brand_context_preparation->'admission'->>'prototype_cap_micro_usd'
   =op.brand_context_preparation->'admission'->>'prototype_cap_micro_usd'
 AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor WHERE successor.supersedes_generation_id=gen.id)
 AND signal_data_governance_actor_is_valid(p_workspace_id,p_actor_id)
 AND (op.brand_context_preparation->'admission'->>'admission_not_after')::timestamptz>clock_timestamp()
 AND p_cap=CASE p_provider WHEN 'anthropic' THEN (op.brand_context_preparation->'admission'->>'semantic_cap_micro_usd')::bigint
   WHEN 'voyage' THEN (op.brand_context_preparation->'admission'->>'prototype_cap_micro_usd')::bigint END);
$$;
CREATE FUNCTION signal_brand_context_completed_history_v1(p_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs run
 JOIN signal_governance_control_operations origin ON origin.id=run.brand_context_preparation_operation_id
 WHERE run.id=p_run_id AND run.status='completed' AND run.provider_call_state='settled' AND run.provider_call_count=1
 AND run.provider_response_private IS NOT NULL AND run.provider_response_digest IS NOT NULL
 AND run.validated_output_digest IS NOT NULL AND run.result_digest IS NOT NULL AND run.appended_operation_id IS NOT NULL
 AND run.settled_micro_usd IS NOT NULL AND run.lease_token IS NULL
 AND origin.action='prepare-brand-context' AND origin.status='completed'
 AND origin.workspace_id=run.workspace_id AND origin.actor_user_id=run.created_by_user_id
 AND origin.brand_context_preparation->>'generation_id'=run.generation_id::text
 AND origin.brand_context_preparation->'admission' IS NOT NULL AND origin.brand_context_preparation->'admission'<>'null'::jsonb
 AND EXISTS(SELECT 1 FROM signal_semantic_context_budget_reservations reservation WHERE reservation.run_id=run.id
   AND reservation.status='settled' AND reservation.actual_micro_usd=run.settled_micro_usd)
 AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_budget_reservations reservation WHERE reservation.run_id=run.id AND reservation.status='reserved')
 AND EXISTS(SELECT 1 FROM signal_semantic_context_proposal_outbox outbox WHERE outbox.run_id=run.id AND outbox.status='completed')
 AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_runs embed JOIN signal_governance_control_operations prep ON prep.id=embed.brand_context_preparation_operation_id
   WHERE prep.brand_context_preparation->>'generation_id'=run.generation_id::text));
$$;
CREATE FUNCTION signal_brand_context_unspent_run_v1(p_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs run WHERE run.id=p_run_id
 AND run.brand_context_preparation_operation_id IS NOT NULL AND run.status='failed'
 AND run.provider_call_state='not_started' AND run.provider_call_count=0 AND run.provider_response_private IS NULL
 AND run.provider_response_digest IS NULL AND run.settled_micro_usd IS NULL AND run.lease_token IS NULL
 AND run.error_code='provider_not_started'
 AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_budget_reservations reservation WHERE reservation.run_id=run.id
   AND reservation.status NOT IN('reserved','released'))
 AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions WHERE generation_id=run.generation_id));
$$;
-- Configuration replacement can close only a terminal with no paid or ambiguous work.
-- The proof also recognizes that exact canceled history; it never confers send authority.
CREATE FUNCTION signal_brand_context_prototype_unspent_v1(p_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspace_embedding_runs run
 JOIN signal_governance_control_operations origin ON origin.id=run.brand_context_preparation_operation_id
 WHERE run.id=p_run_id AND run.input_contract='topic_prototypes' AND run.status IN('failed','canceled')
 AND origin.action='prepare-brand-context' AND origin.status='completed'
 AND origin.workspace_id=run.workspace_id AND origin.actor_user_id=run.actor_user_id
 AND run.error_code IN('workspace_embedding_worker_failed','workspace_embedding_queue_unavailable','workspace_embedding_definitely_not_sent')
 AND run.reserved_micro_usd=0 AND run.settled_micro_usd=0 AND run.unknown_reserved_micro_usd=0 AND run.observed_exception_micro_usd=0
 AND run.execution_token IS NULL AND run.dispatch_token IS NULL
 AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id
   AND (call.status<>'definitely_not_sent' OR call.response_body_private IS NOT NULL OR call.response_digest IS NOT NULL
     OR call.settled_micro_usd IS NOT NULL OR call.observed_micro_usd IS NOT NULL OR call.observed_tokens IS NOT NULL)));
$$;
CREATE FUNCTION validate_signal_brand_context_replacement_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
BEGIN
 SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.id;
 IF operation.brand_context_preparation ? 'replaced_prototype_run_ids' AND (
   operation.status<>'completed' OR EXISTS(
     SELECT 1 FROM jsonb_array_elements_text(operation.brand_context_preparation->'replaced_prototype_run_ids') candidate(id)
     LEFT JOIN signal_workspace_embedding_runs run ON run.id=candidate.id::uuid
     WHERE run.status IS DISTINCT FROM 'canceled' OR NOT signal_brand_context_prototype_unspent_v1(run.id))) THEN
   RAISE EXCEPTION 'Prototype replacement must close atomically with its receipt.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER trg_signal_brand_context_replacement_receipt AFTER INSERT OR UPDATE ON signal_governance_control_operations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_replacement_receipt_v1();
CREATE FUNCTION signal_brand_context_semantic_retryable_v1(p_run_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs run WHERE run.id=p_run_id
 AND run.brand_context_preparation_operation_id IS NOT NULL AND run.status='failed'
 AND run.provider_call_state='not_started' AND run.provider_call_count=0 AND run.provider_response_private IS NULL
 AND run.error_code='provider_not_started' AND run.lease_token IS NULL
 AND (SELECT count(*) FROM signal_governance_control_operations recovery WHERE recovery.workspace_id=run.workspace_id
   AND recovery.action='retry-semantic-context-proposal-run' AND recovery.status='completed' AND recovery.result->>'run_key'=run.run_key)<8
 AND signal_brand_context_admission_valid_v1(run.brand_context_preparation_operation_id,run.workspace_id,run.created_by_user_id,run.generation_id,'anthropic',run.hard_cap_micro_usd));
$$;
-- A receipt replay is free only when every sealed text has cache or its own durable raw response.
CREATE FUNCTION signal_brand_context_prototype_receipts_complete_v1(p_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspace_embedding_runs run WHERE run.id=p_run_id
 AND run.input_contract='topic_prototypes' AND run.brand_context_preparation_operation_id IS NOT NULL
 AND jsonb_typeof(run.topic_input_snapshot->'texts')='object'
 AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(run.topic_input_snapshot->'texts') input(text_sha256)
   WHERE NOT EXISTS(SELECT 1 FROM signal_workspace_chunk_embeddings cache WHERE cache.workspace_id=run.workspace_id
     AND cache.config_digest=run.config_digest AND cache.chunk_sha256=input.text_sha256)
   AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id
     AND call.status IN('response_persisted','settled') AND input.text_sha256=ANY(call.input_keys)
     AND call.response_body_private IS NOT NULL
     AND call.response_digest='sha256:'||encode(digest(convert_to(call.response_body_private,'UTF8'),'sha256'),'hex'))));
$$;
CREATE FUNCTION signal_brand_context_prototype_retryable_v1(p_run_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspace_embedding_runs run
 JOIN signal_governance_control_operations origin ON origin.id=run.brand_context_preparation_operation_id
 WHERE run.id=p_run_id AND run.input_contract='topic_prototypes' AND run.status='failed'
 AND run.error_code IN('workspace_embedding_worker_failed','workspace_embedding_queue_unavailable','workspace_embedding_definitely_not_sent')
 AND run.unknown_reserved_micro_usd=0 AND run.observed_exception_micro_usd=0 AND run.execution_token IS NULL
 AND run.dispatch_generation<8 AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id
   AND (call.status NOT IN('definitely_not_sent','response_persisted','settled')
     OR call.status IN('response_persisted','settled') AND call.response_body_private IS NULL))
 AND signal_data_governance_actor_is_valid(run.workspace_id,run.actor_user_id)
 AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
   WHERE successor.supersedes_generation_id=(origin.brand_context_preparation->>'generation_id')::uuid)
 AND (signal_brand_context_admission_valid_v1(run.brand_context_preparation_operation_id,run.workspace_id,run.actor_user_id,
   (origin.brand_context_preparation->>'generation_id')::uuid,'voyage',run.hard_cap_micro_usd)
   OR signal_brand_context_prototype_receipts_complete_v1(run.id)));
$$;
CREATE FUNCTION validate_signal_brand_context_run_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation_id uuid;actor_id uuid;provider_name text;op_id uuid;
BEGIN
 op_id:=NEW.brand_context_preparation_operation_id;
 IF TG_OP='UPDATE' AND op_id IS DISTINCT FROM OLD.brand_context_preparation_operation_id THEN
   RAISE EXCEPTION 'Brand context run admission is immutable.' USING ERRCODE='23514'; END IF;
 IF op_id IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='signal_semantic_context_proposal_runs' THEN
   IF NEW.model<>'claude-sonnet-4-6' OR NEW.model_version<>'claude-sonnet-4-6' THEN
     RAISE EXCEPTION 'Preparation requires the canonical Sonnet model.' USING ERRCODE='23514'; END IF;
   generation_id:=NEW.generation_id;actor_id:=NEW.created_by_user_id;provider_name:='anthropic';
 ELSE
   IF NEW.input_contract<>'topic_prototypes' THEN RAISE EXCEPTION 'Preparation cannot fund corpus embeddings.' USING ERRCODE='23514'; END IF;
   SELECT (brand_context_preparation->>'generation_id')::uuid INTO generation_id FROM signal_governance_control_operations WHERE id=op_id;
   actor_id:=NEW.actor_user_id;provider_name:='voyage';
 END IF;
 IF TG_TABLE_NAME='signal_workspace_embedding_runs' AND TG_OP='UPDATE' THEN
   IF OLD.status='canceled' AND NEW.status<>'canceled' THEN
     RAISE EXCEPTION 'Canceled preparation history cannot restart.' USING ERRCODE='23514'; END IF;
   IF OLD.status<>NEW.status AND NEW.status='canceled'
     AND (OLD.status<>'failed' OR NOT signal_brand_context_prototype_unspent_v1(OLD.id)
       OR NOT EXISTS(SELECT 1 FROM signal_governance_control_operations replacement
         WHERE replacement.workspace_id=OLD.workspace_id AND replacement.actor_user_id=OLD.actor_user_id
           AND replacement.action='prepare-brand-context' AND replacement.status='in_progress'
           AND replacement.brand_context_preparation->'replaced_prototype_run_ids' @> jsonb_build_array(OLD.id::text))) THEN
     RAISE EXCEPTION 'Only an unspent terminal preparation can be replaced.' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='failed' AND NEW.status IN('processing','validating','running') THEN
   RAISE EXCEPTION 'Failed preparation requires explicit bounded recovery.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='failed' AND NEW.status='queued' THEN
   IF TG_TABLE_NAME='signal_semantic_context_proposal_runs' THEN
     IF NOT signal_brand_context_semantic_retryable_v1(OLD.id) THEN RAISE EXCEPTION 'Brand context semantic recovery is not safe.' USING ERRCODE='23514'; END IF;
   ELSE
     IF NOT signal_brand_context_prototype_retryable_v1(OLD.id) THEN RAISE EXCEPTION 'Brand context prototype recovery is not safe.' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 IF TG_OP='INSERT' AND NOT signal_brand_context_admission_valid_v1(op_id,NEW.workspace_id,actor_id,generation_id,provider_name,NEW.hard_cap_micro_usd) THEN
   RAISE EXCEPTION 'Brand context run admission expired or changed.' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='signal_semantic_context_proposal_runs' AND TG_OP='UPDATE' THEN
   IF OLD.provider_call_state='not_started' AND NEW.provider_call_state='in_flight'
     AND NOT signal_brand_context_admission_valid_v1(op_id,NEW.workspace_id,actor_id,generation_id,provider_name,NEW.hard_cap_micro_usd) THEN
     RAISE EXCEPTION 'brand_context_admission_expired' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_signal_brand_context_semantic_run BEFORE INSERT OR UPDATE ON signal_semantic_context_proposal_runs
FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_run_v1();
CREATE TRIGGER trg_validate_signal_brand_context_embedding_run BEFORE INSERT OR UPDATE ON signal_workspace_embedding_runs
FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_run_v1();
CREATE FUNCTION validate_signal_brand_context_embedding_send_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run signal_workspace_embedding_runs%ROWTYPE;generation_id uuid;
BEGIN
 IF OLD.status='reserved' AND NEW.status='in_flight' THEN
  SELECT * INTO run FROM signal_workspace_embedding_runs WHERE id=NEW.run_id;
  IF run.brand_context_preparation_operation_id IS NOT NULL THEN
   SELECT (brand_context_preparation->>'generation_id')::uuid INTO generation_id FROM signal_governance_control_operations WHERE id=run.brand_context_preparation_operation_id;
   IF NOT signal_brand_context_admission_valid_v1(run.brand_context_preparation_operation_id,run.workspace_id,run.actor_user_id,generation_id,'voyage',run.hard_cap_micro_usd) THEN
    RAISE EXCEPTION 'brand_context_admission_expired' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_signal_brand_context_embedding_send BEFORE UPDATE ON signal_workspace_embedding_calls
FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_embedding_send_v1();

-- Automatic readiness is provenance, not the existence of a save-only preparation.
-- No current grant is needed to read or recover work that is already paid.
CREATE FUNCTION signal_brand_context_automatic_generation_v1(p_generation_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE child signal_semantic_context_generations%ROWTYPE;parent signal_semantic_context_generations%ROWTYPE;
 expected integer;actual integer;
BEGIN
 IF EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs run
   JOIN signal_governance_control_operations admission ON admission.id=run.brand_context_preparation_operation_id
   WHERE run.generation_id=p_generation_id AND run.status='completed'
     AND run.provider_call_state='settled' AND run.automatic_policy_contract_version='signal-semantic-context-automatic-disposition-v1'
     AND admission.workspace_id=run.workspace_id AND admission.actor_user_id=run.created_by_user_id
     AND admission.action='prepare-brand-context' AND admission.status='completed'
     AND admission.brand_context_preparation->>'generation_id'=run.generation_id::text
     AND admission.brand_context_preparation->'admission' IS NOT NULL AND admission.brand_context_preparation->'admission'<>'null'::jsonb
     AND signal_semantic_context_automatic_operation_run_valid_v1(run.appended_operation_id)
     AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element WHERE element.operation_id=run.appended_operation_id
       AND element.automatic_policy_contract_version IS NOT NULL AND signal_semantic_context_automatic_policy_valid_v1(element.id) IS DISTINCT FROM true)
     AND (SELECT count(*) FROM signal_semantic_context_element_versions element WHERE element.operation_id=run.appended_operation_id
       AND element.automatic_policy_outcome='ready')=run.automatic_ready_count
     AND (SELECT count(*) FROM signal_semantic_context_element_versions element WHERE element.operation_id=run.appended_operation_id
       AND element.automatic_policy_outcome='exception')=run.automatic_exception_count) THEN RETURN true; END IF;
 SELECT * INTO child FROM signal_semantic_context_generations WHERE id=p_generation_id;
 SELECT * INTO parent FROM signal_semantic_context_generations WHERE id=child.supersedes_generation_id;
 IF child.id IS NULL OR parent.id IS NULL OR parent.status<>'published' OR child.workspace_id<>parent.workspace_id
   OR child.generation_version<>parent.generation_version+1
   OR NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.id=child.artifact_id
     AND artifact.metadata->>'carried_from_generation_id'=parent.id::text)
   OR ROW(child.brand_os_profile_id,child.brand_os_digest,child.knowledge_digest,child.locale_context_digest,child.proposal_provider_lineage_digest)
     IS DISTINCT FROM ROW(parent.brand_os_profile_id,parent.brand_os_digest,parent.knowledge_digest,parent.locale_context_digest,parent.proposal_provider_lineage_digest)
   OR NOT EXISTS(SELECT 1 FROM signal_governance_control_operations operation WHERE operation.id=child.created_operation_id
     AND operation.workspace_id=child.workspace_id AND operation.actor_user_id=child.created_by_user_id
     AND operation.action='reconcile-semantic-context-generation' AND operation.status='completed') THEN RETURN false; END IF;
 SELECT count(*) INTO expected FROM signal_semantic_context_element_versions element WHERE element.generation_id=parent.id
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id);
 SELECT count(*) INTO actual FROM signal_semantic_context_element_versions element WHERE element.generation_id=child.id
   AND element.operation_id=child.created_operation_id AND signal_brand_context_carried_row_valid_v1(element);
 IF expected<>actual OR actual<>(SELECT count(*) FROM signal_semantic_context_element_versions element WHERE element.generation_id=child.id
   AND element.operation_id=child.created_operation_id) THEN RETURN false; END IF;
 RETURN signal_brand_context_automatic_generation_v1(parent.id);
END $$;
-- Keep every graph/authority blocker. Validated automatic exceptions are quarantined,
-- and an operator may intentionally archive the last ready element. The empty
-- published pack remains explicit and versioned instead of rolling the deletion back.
ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb) RENAME TO signal_semantic_context_publication_snapshot_pre_0153;
CREATE FUNCTION signal_semantic_context_publication_snapshot_v2(p_generation_id uuid,current_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE base jsonb;quarantined integer;pending integer;blockers text[];preflight jsonb;counts jsonb;
BEGIN
 base:=signal_semantic_context_publication_snapshot_pre_0153(p_generation_id,current_authority);
 IF NOT signal_brand_context_automatic_generation_v1(p_generation_id) THEN RETURN base; END IF;
 SELECT count(*) FILTER(WHERE disposition='pending'),count(*) FILTER(WHERE disposition='pending'
   AND automatic_policy_outcome='exception' AND signal_semantic_context_automatic_policy_valid_v1(id))
 INTO pending,quarantined FROM signal_semantic_context_element_versions element
 WHERE generation_id=p_generation_id AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id);
 SELECT COALESCE(array_agg(value ORDER BY value),'{}'::text[]) INTO blockers FROM jsonb_array_elements_text(base->'blockers') item(value)
 WHERE NOT ((value='pending_elements' AND pending=quarantined) OR value='zero_approved_elements');
 counts:=(base->'counts')||jsonb_build_object('quarantined_exceptions',quarantined);
 preflight:=(base->'preflight')||jsonb_build_object('counts',counts,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,
   'activation_contract_version','brand-context-automatic-activation-v1');
 RETURN base||jsonb_build_object('counts',counts,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,
   'preflight',preflight,'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight));
END $$;

CREATE OR REPLACE FUNCTION protect_signal_governance_control_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Governance control operation history is append-only' USING ERRCODE='55000';
  END IF;
  IF OLD.action='prepare-brand-context' AND OLD.status='completed' AND NEW.status='completed'
     AND (to_jsonb(OLD)-'brand_context_progress')=(to_jsonb(NEW)-'brand_context_progress') THEN
    IF NEW.brand_context_progress IS NULL OR jsonb_typeof(NEW.brand_context_progress)<>'object'
      OR NEW.brand_context_progress-ARRAY['attempt','last_error','retry_at']<>'{}'::jsonb
      OR NOT NEW.brand_context_progress ?& ARRAY['attempt','last_error','retry_at']
      OR NOT COALESCE(NEW.brand_context_progress->>'attempt' ~ '^[1-8]$',false)
      OR (NEW.brand_context_progress->>'attempt')::int<>COALESCE((OLD.brand_context_progress->>'attempt')::int,0)+1
      OR NOT COALESCE(NEW.brand_context_progress->>'last_error' ~ '^[a-z_]{1,140}$',false)
      OR (NEW.brand_context_progress->>'retry_at')::timestamptz<=clock_timestamp() THEN
      RAISE EXCEPTION 'Preparation progress is not a bounded retry receipt.' USING ERRCODE='23514';
    END IF; RETURN NEW;
  END IF;
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR OLD.action IS DISTINCT FROM NEW.action
     OR OLD.request_digest IS DISTINCT FROM NEW.request_digest
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.semantic_context_decision_input IS DISTINCT FROM NEW.semantic_context_decision_input
     OR OLD.semantic_context_decision_input_digest IS DISTINCT FROM NEW.semantic_context_decision_input_digest
     OR OLD.status<>'in_progress' OR NEW.status<>'completed'
     OR OLD.result IS NOT NULL OR NEW.result IS NULL
     OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Governance control operation mutation is forbidden' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

-- A carry row is a copy receipt, never a new provider proposal or decision.
ALTER TABLE signal_semantic_context_element_versions ADD COLUMN carried_from_element_id uuid
  REFERENCES signal_semantic_context_element_versions(id) ON DELETE RESTRICT;
ALTER TABLE signal_semantic_context_element_versions DROP CONSTRAINT signal_semantic_context_element_lineage;
ALTER TABLE signal_semantic_context_element_versions ADD CONSTRAINT signal_semantic_context_element_lineage CHECK(
  carried_from_element_id IS NOT NULL OR
  (origin_kind IN ('operator_correction','operator_merge','operator_ordinary') AND supersedes_element_id IS NOT NULL AND original_proposal_element_id IS NOT NULL)
  OR origin_kind NOT IN ('operator_correction','operator_merge','operator_ordinary'));
CREATE FUNCTION signal_brand_context_carried_row_valid_v1(candidate signal_semantic_context_element_versions)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE original signal_semantic_context_element_versions%ROWTYPE;parent signal_semantic_context_generations%ROWTYPE;
 child signal_semantic_context_generations%ROWTYPE;operation signal_governance_control_operations%ROWTYPE;left_refs jsonb;right_refs jsonb;
 ignored text[]:=ARRAY['id','artifact_id','evidence_group_id','generation_id','operation_id','supersedes_element_id','carried_from_element_id','created_at'];
BEGIN
 SELECT * INTO original FROM signal_semantic_context_element_versions WHERE id=candidate.carried_from_element_id;
 SELECT * INTO parent FROM signal_semantic_context_generations WHERE id=original.generation_id;
 SELECT * INTO child FROM signal_semantic_context_generations WHERE id=candidate.generation_id;
 SELECT * INTO operation FROM signal_governance_control_operations WHERE id=candidate.operation_id;
 IF original.id IS NULL OR parent.status<>'published' OR child.supersedes_generation_id IS DISTINCT FROM parent.id
   OR child.workspace_id<>parent.workspace_id OR candidate.workspace_id<>parent.workspace_id
   OR candidate.supersedes_element_id IS NOT NULL OR operation.id IS DISTINCT FROM child.created_operation_id
   OR operation.action<>'reconcile-semantic-context-generation' OR operation.workspace_id<>candidate.workspace_id
   OR NOT signal_data_governance_actor_is_valid(candidate.workspace_id,operation.actor_user_id)
   OR (to_jsonb(candidate)-ignored) IS DISTINCT FROM (to_jsonb(original)-ignored)
   OR EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=original.id)
   OR ROW(child.brand_os_profile_id,child.brand_os_digest,child.knowledge_digest,child.locale_context_digest,child.proposal_provider_lineage_digest)
     IS DISTINCT FROM ROW(parent.brand_os_profile_id,parent.brand_os_digest,parent.knowledge_digest,parent.locale_context_digest,parent.proposal_provider_lineage_digest)
   OR NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact JOIN analysis_evidence_groups evidence ON evidence.artifact_id=artifact.id
     WHERE artifact.id=candidate.artifact_id AND artifact.workspace_id=candidate.workspace_id AND artifact.workspace_artifact_kind='semantic_context'
       AND artifact.workspace_authority_digest=candidate.element_digest AND evidence.id=candidate.evidence_group_id) THEN RETURN false; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(link)-ARRAY['id','evidence_group_id','created_at'] ORDER BY source_type,source_id,relation_type),'[]'::jsonb)
   INTO left_refs FROM analysis_evidence_links link WHERE evidence_group_id=candidate.evidence_group_id;
 SELECT COALESCE(jsonb_agg(to_jsonb(link)-ARRAY['id','evidence_group_id','created_at'] ORDER BY source_type,source_id,relation_type),'[]'::jsonb)
   INTO right_refs FROM analysis_evidence_links link WHERE evidence_group_id=original.evidence_group_id;
 RETURN left_refs=right_refs AND jsonb_array_length(left_refs)>0
   AND (SELECT to_jsonb(a)-ARRAY['id','artifact_key','created_at'] FROM analysis_artifacts a WHERE id=candidate.artifact_id)
       IS NOT DISTINCT FROM (SELECT to_jsonb(a)-ARRAY['id','artifact_key','created_at'] FROM analysis_artifacts a WHERE id=original.artifact_id)
   AND (SELECT to_jsonb(g)-ARRAY['id','artifact_id','created_at'] FROM analysis_evidence_groups g WHERE id=candidate.evidence_group_id)
       IS NOT DISTINCT FROM (SELECT to_jsonb(g)-ARRAY['id','artifact_id','created_at'] FROM analysis_evidence_groups g WHERE id=original.evidence_group_id);
END $$;
CREATE FUNCTION fork_signal_brand_context_for_edit_v1(p_workspace uuid,p_actor uuid,p_generation_key text,p_edit_operation uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE parent signal_semantic_context_generations%ROWTYPE;child signal_semantic_context_generations%ROWTYPE;
 element signal_semantic_context_element_versions%ROWTYPE;copy signal_semantic_context_element_versions%ROWTYPE;
 artifact analysis_artifacts%ROWTYPE;group_row analysis_evidence_groups%ROWTYPE;link analysis_evidence_links%ROWTYPE;
 edit_op signal_governance_control_operations%ROWTYPE;op_id uuid:=gen_random_uuid();prep_id uuid:=gen_random_uuid();new_id uuid:=gen_random_uuid();
 new_artifact uuid:=gen_random_uuid();key text;source_digest text;new_digest text;payload jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||p_workspace::text,0));
 SELECT * INTO parent FROM signal_semantic_context_generations WHERE workspace_id=p_workspace AND generation_key=p_generation_key FOR UPDATE;
 IF parent.status='draft' THEN RETURN parent.generation_key; END IF;
 SELECT * INTO edit_op FROM signal_governance_control_operations WHERE id=p_edit_operation;
 IF parent.id IS NULL OR parent.status<>'published' OR edit_op.workspace_id IS DISTINCT FROM p_workspace OR edit_op.actor_user_id IS DISTINCT FROM p_actor
   OR edit_op.action IS DISTINCT FROM 'edit-semantic-context-element-v1' OR edit_op.status<>'in_progress'
   OR NOT signal_data_governance_actor_is_valid(p_workspace,p_actor)
   OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor WHERE successor.supersedes_generation_id=parent.id)
   OR NOT EXISTS(SELECT 1 FROM signal_governance_control_operations op WHERE op.workspace_id=p_workspace AND op.action='prepare-brand-context'
     AND op.status='completed' AND op.brand_context_preparation->>'generation_id'=parent.id::text) THEN
   RAISE EXCEPTION 'Brand context edit source is not current automatic publication.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations WHERE generation_id=parent.id)
   OR EXISTS(SELECT 1 FROM signal_semantic_context_merge_edges WHERE generation_id=parent.id) THEN
   RAISE EXCEPTION 'brand_context_edit_review_graph_not_supported' USING ERRCODE='23514'; END IF;
 key:='semantic-context-v'||(parent.generation_version+1)::text;
 SELECT workspace_authority_digest INTO source_digest FROM analysis_artifacts WHERE id=parent.artifact_id;
 new_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','signal-semantic-context-carry-forward-v1','parent_id',parent.id,'parent_pack_digest',parent.pack_digest,'generation_key',key));
 INSERT INTO signal_governance_control_operations(id,workspace_id,actor_user_id,action,request_digest,idempotency_key)
 VALUES(op_id,p_workspace,p_actor,'reconcile-semantic-context-generation',new_digest,
   signal_semantic_context_digest_json_v2(jsonb_build_array('brand-context-edit-fork',p_edit_operation)));
 INSERT INTO analysis_artifacts(id,workspace_id,workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,content,review_status,revision,metadata)
 VALUES(new_artifact,p_workspace,'semantic_context',source_digest,key,'semantic_context_pack_generation',
   jsonb_build_object('contract_version','signal-semantic-context-pack-v1','generation_version',parent.generation_version+1,'lifecycle_state','draft'),'needs_review',1,jsonb_build_object('authority_only',true,'carried_from_generation_id',parent.id));
 payload:=to_jsonb(parent)||jsonb_build_object('id',new_id,'artifact_id',new_artifact,'generation_key',key,'generation_version',parent.generation_version+1,
   'status','draft','supersedes_generation_id',parent.id,'supersession_reason','operator_requested_reconciliation','draft_digest',new_digest,
   'pack_digest',NULL,'published_operation_id',NULL,'published_by_user_id',NULL,'published_at',NULL,
   'publication_schema_version',NULL,'candidate_pack_digest',NULL,'evidence_graph_digest',NULL,'review_graph_digest',NULL,
   'publication_authority_digest',NULL,'publication_authority_snapshot',NULL,'semantic_context_pack_digest',NULL,
   'publish_preflight_digest',NULL,'publication_counts',NULL,'created_operation_id',op_id,'created_by_user_id',p_actor,'created_at',clock_timestamp());
 child:=jsonb_populate_record(NULL::signal_semantic_context_generations,payload);
 INSERT INTO signal_semantic_context_generations SELECT child.*;
 FOR element IN SELECT e.* FROM signal_semantic_context_element_versions e WHERE e.generation_id=parent.id
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=e.id) ORDER BY e.element_key LOOP
   SELECT * INTO artifact FROM analysis_artifacts WHERE id=element.artifact_id;
   artifact:=jsonb_populate_record(NULL::analysis_artifacts,to_jsonb(artifact)||jsonb_build_object('id',gen_random_uuid(),'artifact_key',key||':carry:'||element.element_key,
     'created_at',clock_timestamp())); INSERT INTO analysis_artifacts SELECT artifact.*;
   SELECT * INTO group_row FROM analysis_evidence_groups WHERE id=element.evidence_group_id;
   group_row:=jsonb_populate_record(NULL::analysis_evidence_groups,to_jsonb(group_row)||jsonb_build_object('id',gen_random_uuid(),'artifact_id',artifact.id,'created_at',clock_timestamp()));
   INSERT INTO analysis_evidence_groups SELECT group_row.*;
   FOR link IN SELECT * FROM analysis_evidence_links WHERE evidence_group_id=element.evidence_group_id LOOP
     link:=jsonb_populate_record(NULL::analysis_evidence_links,to_jsonb(link)||jsonb_build_object('id',gen_random_uuid(),'evidence_group_id',group_row.id,'created_at',clock_timestamp()));
     INSERT INTO analysis_evidence_links SELECT link.*;
   END LOOP;
   copy:=jsonb_populate_record(NULL::signal_semantic_context_element_versions,to_jsonb(element)||jsonb_build_object('id',gen_random_uuid(),'artifact_id',artifact.id,
     'generation_id',child.id,'evidence_group_id',group_row.id,'operation_id',op_id,'supersedes_element_id',NULL,'carried_from_element_id',element.id,'created_at',clock_timestamp()));
   INSERT INTO signal_semantic_context_element_versions SELECT copy.*;
 END LOOP;
 -- Match the ordinary-command digest even when the requested edit is a no-op.
 SELECT signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','signal-semantic-context-draft-v2',
   'elements',COALESCE(jsonb_agg(jsonb_build_object('element_key',element_key,'element_version',element_version,
     'element_digest',element_digest,'disposition',disposition) ORDER BY convert_to(element_key,'UTF8')),'[]'::jsonb)))
 INTO new_digest FROM signal_semantic_context_element_versions e WHERE generation_id=child.id
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=e.id);
 UPDATE signal_semantic_context_generations SET draft_digest=new_digest WHERE id=child.id;
 INSERT INTO signal_semantic_context_events(workspace_id,generation_id,operation_id,event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
 VALUES(p_workspace,child.id,op_id,0,'generation_reconciled',parent.pack_digest,new_digest,p_actor);
 UPDATE signal_governance_control_operations SET status='completed',result=jsonb_build_object('generation_key',key,'generation_version',child.generation_version,'status','draft'),
   completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=op_id;
 INSERT INTO signal_governance_control_operations(id,workspace_id,actor_user_id,action,request_digest,idempotency_key,brand_context_preparation,created_at)
 VALUES(prep_id,p_workspace,p_actor,'prepare-brand-context',new_digest,signal_semantic_context_digest_json_v2(jsonb_build_array('brand-context-edit-preparation',p_edit_operation)),
   jsonb_build_object('contract_version','brand-context-preparation-input-v1','primary_locale',child.primary_locale,'source_authority_digest',source_digest,
     'generation_id',child.id,'generation_key',key,'admission',NULL),clock_timestamp());
 UPDATE signal_governance_control_operations SET status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp(),result=jsonb_build_object(
   'contract_version','brand-context-preparation-v1','operation_id',prep_id,'workspace_id',p_workspace,'generation_id',child.id,'generation_key',key,'state','awaiting_authorization',
   'semantic_run_id',NULL,'prototype_run_id',NULL,'active_elements',0,'exceptions',0,'error_code',NULL,'replayed',false) WHERE id=prep_id;
 RETURN key;
END $$;
CREATE FUNCTION validate_signal_brand_context_carried_row_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.carried_from_element_id IS DISTINCT FROM OLD.carried_from_element_id THEN
   RAISE EXCEPTION 'Carry-forward provenance is immutable.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.carried_from_element_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM signal_semantic_context_generations child JOIN signal_governance_control_operations operation ON operation.id=NEW.operation_id
   WHERE child.id=NEW.generation_id AND child.status='draft' AND operation.id=child.created_operation_id AND operation.status='in_progress') THEN
   RAISE EXCEPTION 'Carried rows require the open copy operation and unpublished successor.' USING ERRCODE='23514'; END IF;
 IF NEW.carried_from_element_id IS NOT NULL AND NOT signal_brand_context_carried_row_valid_v1(NEW) THEN
   RAISE EXCEPTION 'Carry-forward element does not match its published source.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_signal_brand_context_carried_row BEFORE INSERT OR UPDATE ON signal_semantic_context_element_versions
FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_carried_row_v1();

-- Original 0105_signal_semantic_context_automatic_disposition.sql branch retained verbatim below the exact copy fence.
CREATE OR REPLACE FUNCTION validate_signal_semantic_context_element_operation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;generation_status text;
DECLARE artifact_kind text;artifact_authority text;group_artifact uuid;
DECLARE generation_has_provider_lineage boolean;generation_profile_id uuid;
DECLARE workspace_organization_id uuid;workspace_brand_id uuid;
BEGIN
  IF NEW.carried_from_element_id IS NOT NULL THEN
    IF NOT signal_brand_context_carried_row_valid_v1(NEW) THEN
      RAISE EXCEPTION 'Carry-forward provenance or evidence is invalid.' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT generation.status,(generation.proposal_model IS NOT NULL AND generation.proposal_model_version IS NOT NULL
      AND generation.proposal_prompt_digest IS NOT NULL AND generation.proposal_pricing_version IS NOT NULL
      AND generation.proposal_provider_lineage IS NOT NULL AND generation.proposal_provider_lineage_digest IS NOT NULL),
      generation.brand_os_profile_id,workspace.organization_id,workspace.brand_id
    INTO generation_status,generation_has_provider_lineage,generation_profile_id,
      workspace_organization_id,workspace_brand_id
    FROM signal_semantic_context_generations generation JOIN signal_workspaces workspace
      ON workspace.id=generation.workspace_id
    WHERE generation.id=NEW.generation_id AND generation.workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT workspace_artifact_kind,workspace_authority_digest INTO artifact_kind,artifact_authority
    FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  SELECT artifact_id INTO group_artifact FROM analysis_evidence_groups WHERE id=NEW.evidence_group_id;
  IF generation_status IS DISTINCT FROM 'draft' OR operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.proposed_by_user_id OR operation.status<>'in_progress'
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.proposed_by_user_id) THEN
    RAISE EXCEPTION 'Semantic context element operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF artifact_kind IS DISTINCT FROM 'semantic_context' OR artifact_authority IS DISTINCT FROM NEW.element_digest
     OR group_artifact IS DISTINCT FROM NEW.artifact_id THEN
    RAISE EXCEPTION 'Semantic context element artifact/evidence lineage is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=NEW.evidence_group_id)
     OR EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=NEW.evidence_group_id
      AND NOT CASE link.source_type
        WHEN 'brand_os_profile' THEN EXISTS(SELECT 1 FROM brand_os_profiles source
          WHERE source.id=link.source_id AND source.id=generation_profile_id)
        WHEN 'brand_os_product' THEN EXISTS(SELECT 1 FROM brand_os_products source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation_profile_id)
        WHEN 'brand_os_competitor' THEN EXISTS(SELECT 1 FROM brand_os_competitors source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation_profile_id)
        WHEN 'brand_os_seed_term' THEN EXISTS(SELECT 1 FROM brand_os_seed_terms source
          JOIN brand_os_seed_sets seed_set ON seed_set.id=source.seed_set_id
          WHERE source.id=link.source_id AND seed_set.brand_os_profile_id=generation_profile_id)
        WHEN 'knowledge_source' THEN EXISTS(SELECT 1 FROM brand_knowledge_sources source
          WHERE source.id=link.source_id AND source.organization_id=workspace_organization_id
            AND source.brand_id=workspace_brand_id AND source.study_corpus_id IS NULL
            AND source.status IN ('processed','profiled','active'))
        WHEN 'knowledge_chunk' THEN EXISTS(SELECT 1 FROM knowledge_chunks source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace_organization_id
            AND knowledge.brand_id=workspace_brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        WHEN 'knowledge_assertion' THEN EXISTS(SELECT 1 FROM knowledge_assertions source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace_organization_id
            AND knowledge.brand_id=workspace_brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        WHEN 'semantic_context_operator_input' THEN link.relation_type='supports' AND (
          (operation.action='create-semantic-context-element-v1' AND link.source_id=operation.id)
          OR EXISTS(SELECT 1 FROM signal_governance_control_operations source_operation
            WHERE source_operation.id=link.source_id AND source_operation.workspace_id=NEW.workspace_id
              AND source_operation.action='create-semantic-context-element-v1'
              AND source_operation.status='completed'
              AND signal_data_governance_actor_is_valid(NEW.workspace_id,source_operation.actor_user_id)))
        ELSE false END) THEN
    RAISE EXCEPTION 'Semantic context source references are cross-workspace or stale.' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_element_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions predecessor
    WHERE predecessor.id=NEW.supersedes_element_id AND predecessor.workspace_id=NEW.workspace_id
      AND predecessor.generation_id=NEW.generation_id AND predecessor.element_key=NEW.element_key
      AND predecessor.element_version=NEW.element_version-1) THEN
    RAISE EXCEPTION 'Semantic context element supersession is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind IN ('server_projection','provider_proposal') AND NOT (
      operation.action='append-semantic-context-proposals'
      AND (NEW.disposition='pending' OR (NEW.origin_kind='server_projection'
        AND NEW.disposition='approved'
        AND to_jsonb(NEW)->>'automatic_policy_outcome'='ready'))
    ) THEN
    RAISE EXCEPTION 'Semantic context proposal disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_decision' AND (operation.action NOT IN (
      'decide-semantic-context-element','bulk-approve-semantic-context-elements')
      OR NEW.disposition NOT IN ('approved','rejected') OR NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context operator decision is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_merge' AND (operation.action<>'merge-semantic-context-elements'
       OR NEW.disposition<>'merged') THEN
    RAISE EXCEPTION 'Semantic context merged disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_correction' AND (operation.action NOT IN (
      'decide-semantic-context-element','correct-semantic-context-element','merge-semantic-context-elements')
      OR NEW.disposition<>'pending') THEN
    RAISE EXCEPTION 'Semantic context correction disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_created' AND (operation.action<>'create-semantic-context-element-v1'
      OR NEW.disposition<>'approved' OR NEW.lifecycle_state<>'active'
      OR NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context operator creation is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='provider_proposal' AND NOT generation_has_provider_lineage THEN
    RAISE EXCEPTION 'Provider proposal lineage is incomplete.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- Original 0102_signal_semantic_context_ordinary_editing.sql branch retained verbatim below the exact copy fence.
CREATE OR REPLACE FUNCTION validate_signal_semantic_context_ordinary_command_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE predecessor signal_semantic_context_element_versions%ROWTYPE;
BEGIN
  IF NEW.carried_from_element_id IS NOT NULL THEN
    IF NOT signal_brand_context_carried_row_valid_v1(NEW) THEN
      RAISE EXCEPTION 'Carry-forward provenance or evidence is invalid.' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.origin_kind IS DISTINCT FROM 'operator_ordinary' THEN
    IF NEW.ordinary_command_contract_version IS NOT NULL THEN
      RAISE EXCEPTION 'Only operator_ordinary may carry ordinary command authority.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT * INTO predecessor FROM signal_semantic_context_element_versions WHERE id=NEW.supersedes_element_id;
  IF operation.action IS DISTINCT FROM 'edit-semantic-context-element-v1'
     OR operation.semantic_context_decision_input_digest IS DISTINCT FROM NEW.ordinary_command_input_digest
     OR signal_semantic_context_digest_json_v2(operation.semantic_context_decision_input)
        IS DISTINCT FROM NEW.ordinary_command_input_digest
     OR predecessor.id IS NULL OR predecessor.workspace_id<>NEW.workspace_id
     OR predecessor.generation_id<>NEW.generation_id OR predecessor.element_key<>NEW.element_key
     OR predecessor.element_version+1<>NEW.element_version
     OR NEW.ordinary_command_basis_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(NEW.ordinary_command_basis)
     OR NEW.ordinary_command_prestate_digest IS DISTINCT FROM predecessor.element_digest
     OR NEW.ordinary_command_poststate_digest IS DISTINCT FROM NEW.element_digest
     OR NEW.source_refs_digest IS DISTINCT FROM predecessor.source_refs_digest
     OR NEW.evidence_group_id=predecessor.evidence_group_id
     OR NEW.element_kind IS DISTINCT FROM predecessor.element_kind
     OR NEW.entity_type IS DISTINCT FROM predecessor.entity_type OR NEW.entity_id IS DISTINCT FROM predecessor.entity_id
     OR NEW.confidence IS DISTINCT FROM predecessor.confidence
     OR (NEW.ordinary_command_action='archive' AND (NEW.disposition<>'archived' OR NEW.lifecycle_state<>'archived'))
     OR (NEW.ordinary_command_action<>'archive' AND (NEW.disposition<>'approved' OR NEW.lifecycle_state<>'active')) THEN
    RAISE EXCEPTION 'Ordinary Semantic Context successor is not server-authoritative.' USING ERRCODE='23514';
  END IF;
  IF NEW.ordinary_command_action<>'save' AND ROW(NEW.locale,NEW.locale_decision_contract_version,
      NEW.locale_decision_disposition,NEW.locale_decision_locale,NEW.locale_decision_reason_code,
      NEW.locale_decision_rationale,NEW.locale_decision_basis_digest,NEW.locale_decision_input_digest,
      NEW.locale_decision_authority_snapshot,NEW.locale_decision_authority_digest)
    IS DISTINCT FROM ROW(predecessor.locale,predecessor.locale_decision_contract_version,
      predecessor.locale_decision_disposition,predecessor.locale_decision_locale,predecessor.locale_decision_reason_code,
      predecessor.locale_decision_rationale,predecessor.locale_decision_basis_digest,predecessor.locale_decision_input_digest,
      predecessor.locale_decision_authority_snapshot,predecessor.locale_decision_authority_digest)
    AND NEW.ordinary_command_action<>'undo' THEN
    RAISE EXCEPTION 'Archive and restore preserve applicability authority.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- Original 0102_signal_semantic_context_ordinary_editing.sql branch retained verbatim below the exact copy fence.
CREATE OR REPLACE FUNCTION validate_signal_semantic_context_locale_decision_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE predecessor signal_semantic_context_element_versions%ROWTYPE;
DECLARE decision_actor users%ROWTYPE;basis jsonb;expected_authority jsonb;expected_element_digest text;
BEGIN
  IF NEW.carried_from_element_id IS NOT NULL THEN
    IF NOT signal_brand_context_carried_row_valid_v1(NEW) THEN
      RAISE EXCEPTION 'Carry-forward provenance or evidence is invalid.' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=NEW.generation_id;
  SELECT * INTO predecessor FROM signal_semantic_context_element_versions WHERE id=NEW.supersedes_element_id;
  IF operation.action='edit-semantic-context-element-v1' THEN RETURN NEW; END IF;
  IF operation.action IS DISTINCT FROM 'decide-semantic-context-locale-authority' THEN
    IF predecessor.id IS NULL THEN
      IF NEW.locale_decision_contract_version IS NOT NULL THEN
        RAISE EXCEPTION 'Only the dedicated locale authority operation may originate locale lineage.' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF ROW(NEW.locale,NEW.locale_decision_contract_version,NEW.locale_decision_disposition,
      NEW.locale_decision_locale,NEW.locale_decision_reason_code,NEW.locale_decision_rationale,
      NEW.locale_decision_basis_digest,NEW.locale_decision_input_digest,
      NEW.locale_decision_authority_snapshot,NEW.locale_decision_authority_digest,
      NEW.locale_decision_prestate_digest,NEW.locale_decision_poststate_digest)
      IS DISTINCT FROM ROW(predecessor.locale,predecessor.locale_decision_contract_version,
      predecessor.locale_decision_disposition,predecessor.locale_decision_locale,
      predecessor.locale_decision_reason_code,predecessor.locale_decision_rationale,
      predecessor.locale_decision_basis_digest,predecessor.locale_decision_input_digest,
      predecessor.locale_decision_authority_snapshot,predecessor.locale_decision_authority_digest,
      predecessor.locale_decision_prestate_digest,predecessor.locale_decision_poststate_digest) THEN
      RAISE EXCEPTION 'Generic Semantic Context successors must preserve locale authority byte-for-byte.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.locale_decision_contract_version IS NULL THEN
    RAISE EXCEPTION 'The dedicated locale authority operation requires sealed locale lineage.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO decision_actor FROM users WHERE id=operation.actor_user_id;
  basis:=jsonb_build_object('contract_version',NEW.locale_decision_contract_version,
    'disposition',NEW.locale_decision_disposition,'locale',NEW.locale_decision_locale,
    'reason',NEW.locale_decision_reason_code,'rationale',NEW.locale_decision_rationale);
  expected_authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest,
    'actor',jsonb_build_object('id',lower(decision_actor.id::text),'user_type',decision_actor.user_type,
      'primary_role',decision_actor.primary_role));
  IF NEW.locale_decision_basis_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(basis)
     OR NEW.locale_decision_authority_snapshot IS DISTINCT FROM expected_authority
     OR NEW.locale_decision_authority_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(expected_authority)
     OR NEW.locale_decision_locale IS NOT NULL AND NOT NEW.locale_decision_locale=ANY(generation.locale_variants) THEN
    RAISE EXCEPTION 'Semantic Context locale decision basis or authority is invalid.' USING ERRCODE='23514';
  END IF;
  expected_element_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-locale-decision-element-v1','element_key',NEW.element_key,
    'element_kind',NEW.element_kind,'canonical_key',NEW.canonical_key,'display_text',NEW.display_text,
    'scope',NEW.scope,'entity_type',NEW.entity_type,'entity_id',lower(NEW.entity_id::text),'locale',NEW.locale,
    'relation_kind',NEW.relation_kind,'relation_target_key',NEW.relation_target_key,'element_version',NEW.element_version,
    'disposition','pending','source_refs_digest',NEW.source_refs_digest,'locale_decision_basis',basis));
  IF predecessor.id IS NULL OR predecessor.disposition<>'approved' OR NEW.origin_kind<>'operator_correction'
     OR NEW.disposition<>'pending' OR NEW.locale_decision_prestate_digest IS DISTINCT FROM predecessor.element_digest
     OR NEW.locale_decision_poststate_digest IS DISTINCT FROM expected_element_digest
     OR NEW.element_digest IS DISTINCT FROM expected_element_digest
     OR operation.semantic_context_decision_input_digest IS DISTINCT FROM NEW.locale_decision_input_digest
     OR signal_semantic_context_digest_json_v2(operation.semantic_context_decision_input)
       IS DISTINCT FROM NEW.locale_decision_input_digest THEN
    RAISE EXCEPTION 'Semantic Context locale decision successor is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- Original 0103_signal_semantic_context_simple_creation.sql branch retained verbatim below the exact copy fence.
CREATE OR REPLACE FUNCTION validate_signal_semantic_context_creation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;DECLARE generation signal_semantic_context_generations%ROWTYPE;
BEGIN
  IF NEW.carried_from_element_id IS NOT NULL THEN
    IF NOT signal_brand_context_carried_row_valid_v1(NEW) THEN
      RAISE EXCEPTION 'Carry-forward provenance or evidence is invalid.' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.origin_kind<>'operator_created' THEN
    IF NEW.creation_contract_version IS NOT NULL THEN
      RAISE EXCEPTION 'Only operator_created may carry creation authority.' USING ERRCODE='23514';
    END IF;RETURN NEW;
  END IF;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=NEW.generation_id;
  IF operation.action<>'create-semantic-context-element-v1' OR operation.status<>'in_progress'
     OR operation.semantic_context_decision_input_digest IS DISTINCT FROM NEW.creation_input_digest
     OR signal_semantic_context_digest_json_v2(operation.semantic_context_decision_input)
       IS DISTINCT FROM NEW.creation_input_digest
     OR NEW.creation_basis_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(NEW.creation_basis)
     OR NEW.creation_poststate_digest IS DISTINCT FROM NEW.element_digest
     OR NEW.element_key IS DISTINCT FROM signal_semantic_context_operator_element_key_v1(NEW.element_kind,NEW.canonical_key,NEW.locale)
     OR NEW.element_version<>1 OR NEW.supersedes_element_id IS NOT NULL OR NEW.original_proposal_element_id IS NOT NULL
     OR operation.semantic_context_decision_input->>'generation_key' IS DISTINCT FROM generation.generation_key
     OR operation.semantic_context_decision_input->'values'->>'element_kind' IS DISTINCT FROM NEW.element_kind
     OR operation.semantic_context_decision_input->'values'->>'canonical_key' IS DISTINCT FROM NEW.canonical_key
     OR operation.semantic_context_decision_input->'values'->>'display_text' IS DISTINCT FROM NEW.display_text
     OR operation.semantic_context_decision_input->'values'->>'scope' IS DISTINCT FROM NEW.scope
     OR operation.semantic_context_decision_input->'values'->>'relation_kind' IS DISTINCT FROM NEW.relation_kind
     OR operation.semantic_context_decision_input->'values'->>'relation_target_key' IS DISTINCT FROM NEW.relation_target_key
     OR NOT operation.semantic_context_decision_input ?& ARRAY['contract_version','generation_key','values']
     OR NOT (operation.semantic_context_decision_input->'values') ?& ARRAY['element_kind','display_text',
       'canonical_key','scope','relation_kind','relation_target_key','applicability']
     OR jsonb_typeof(operation.semantic_context_decision_input->'values'->'applicability')<>'object'
     OR (operation.semantic_context_decision_input->'values'->'applicability')-ARRAY['state','locale']<>'{}'::jsonb
     OR NOT (operation.semantic_context_decision_input->'values'->'applicability') ?& ARRAY['state','locale']
     OR jsonb_typeof(operation.semantic_context_decision_input->'values'->'applicability'->'state')<>'string'
     OR (operation.semantic_context_decision_input)-ARRAY['contract_version','generation_key','values']<>'{}'::jsonb
     OR (operation.semantic_context_decision_input->'values')-ARRAY['element_kind','display_text','canonical_key','scope',
       'relation_kind','relation_target_key','applicability']<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Semantic context creation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION signal_semantic_context_ordinary_authority_valid_v1(target_element_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
DECLARE predecessor signal_semantic_context_element_versions%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;DECLARE actor users%ROWTYPE;
DECLARE expected_authority jsonb;DECLARE parent jsonb;DECLARE expected_diff jsonb;DECLARE expected_basis jsonb;
DECLARE target signal_semantic_context_element_versions%ROWTYPE;DECLARE safe_expected integer;DECLARE safe_target integer;
DECLARE predecessor_applicability jsonb;DECLARE successor_applicability jsonb;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  SELECT * INTO predecessor FROM signal_semantic_context_element_versions WHERE id=element.supersedes_element_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=element.operation_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=element.generation_id;
  SELECT * INTO actor FROM users WHERE id=operation.actor_user_id;
  expected_authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest);
  parent:=signal_semantic_context_parent_applicability_v1(generation.id,expected_authority);
  safe_expected:=signal_semantic_context_safe_positive_int_v1(operation.semantic_context_decision_input->'expected_version');
  safe_target:=signal_semantic_context_safe_positive_int_v1(operation.semantic_context_decision_input->'target_version');
  IF element.ordinary_command_action='undo' AND safe_target IS NOT NULL THEN
    SELECT * INTO target FROM signal_semantic_context_element_versions candidate
      WHERE candidate.generation_id=element.generation_id AND candidate.element_key=element.element_key
        AND candidate.element_version<predecessor.element_version
        AND candidate.lifecycle_state='active' AND candidate.disposition='approved'
        AND COALESCE(candidate.original_proposal_element_id,candidate.id)=COALESCE(element.original_proposal_element_id,element.id)
        AND ROW(candidate.display_text,candidate.canonical_key,candidate.scope,candidate.relation_kind,
          candidate.relation_target_key,candidate.locale,candidate.locale_decision_contract_version,
          candidate.locale_decision_disposition,candidate.locale_decision_locale,candidate.locale_decision_authority_digest)
          IS DISTINCT FROM ROW(predecessor.display_text,predecessor.canonical_key,predecessor.scope,
          predecessor.relation_kind,predecessor.relation_target_key,predecessor.locale,
          predecessor.locale_decision_contract_version,predecessor.locale_decision_disposition,
          predecessor.locale_decision_locale,predecessor.locale_decision_authority_digest)
      ORDER BY candidate.element_version DESC LIMIT 1;
  END IF;
  predecessor_applicability:=jsonb_build_object('state',CASE
    WHEN predecessor.locale_decision_disposition='global' THEN 'explicit_global'
    WHEN predecessor.locale_decision_disposition='locale_specific' THEN 'explicit_locale'
    WHEN predecessor.locale IS NOT NULL THEN 'sealed_existing_locale'
    WHEN predecessor.locale_decision_contract_version IS NULL THEN 'workspace_inherited' ELSE 'unresolved' END,
    'locale',predecessor.locale,'contract_version',predecessor.locale_decision_contract_version,
    'authority_digest',predecessor.locale_decision_authority_digest);
  successor_applicability:=jsonb_build_object('state',CASE
    WHEN element.locale_decision_disposition='global' THEN 'explicit_global'
    WHEN element.locale_decision_disposition='locale_specific' THEN 'explicit_locale'
    WHEN element.locale IS NOT NULL THEN 'sealed_existing_locale'
    WHEN element.locale_decision_contract_version IS NULL THEN 'workspace_inherited' ELSE 'unresolved' END,
    'locale',element.locale,'contract_version',element.locale_decision_contract_version,
    'authority_digest',element.locale_decision_authority_digest);
  SELECT coalesce(jsonb_agg(jsonb_build_object('field',field,'before',before_value,'after',after_value)
    ORDER BY ordinal),'[]'::jsonb) INTO expected_diff FROM (VALUES
    (1,'display_text',to_jsonb(predecessor.display_text),to_jsonb(element.display_text)),
    (2,'canonical_key',to_jsonb(predecessor.canonical_key),to_jsonb(element.canonical_key)),
    (3,'scope',to_jsonb(predecessor.scope),to_jsonb(element.scope)),
    (4,'relation_kind',to_jsonb(predecessor.relation_kind),to_jsonb(element.relation_kind)),
    (5,'relation_target_key',to_jsonb(predecessor.relation_target_key),to_jsonb(element.relation_target_key)),
    (6,'locale',to_jsonb(predecessor.locale),to_jsonb(element.locale)),
    (7,'lifecycle_state',to_jsonb(predecessor.lifecycle_state),to_jsonb(element.lifecycle_state)),
    (8,'applicability',predecessor_applicability,successor_applicability)
  ) fields(ordinal,field,before_value,after_value) WHERE before_value IS DISTINCT FROM after_value;
  expected_basis:=jsonb_build_object('contract_version','signal-semantic-context-ordinary-audit-v1',
    'command_version','edit-semantic-context-element-v1','action',element.ordinary_command_action,
    'actor',jsonb_build_object('id',lower(actor.id::text),'user_type',actor.user_type,'primary_role',actor.primary_role),
    'changed_at',to_char(element.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'parent_applicability_digest',parent->>'parent_authority_digest','diff',expected_diff);
  RETURN element.id IS NOT NULL AND predecessor.id IS NOT NULL AND element.origin_kind='operator_ordinary'
    AND element.ordinary_command_contract_version='edit-semantic-context-element-v1'
    AND element.ordinary_command_action IN ('save','undo','archive','restore')
    AND operation.action='edit-semantic-context-element-v1' AND operation.status='completed'
    AND operation.semantic_context_decision_input->>'contract_version'='edit-semantic-context-element-v1'
    AND operation.semantic_context_decision_input->>'action'=element.ordinary_command_action
    AND operation.semantic_context_decision_input->>'element_key'=predecessor.element_key
    AND (operation.semantic_context_decision_input->>'generation_key'=generation.generation_key
      OR (predecessor.carried_from_element_id IS NOT NULL AND signal_brand_context_carried_row_valid_v1(predecessor)
        AND operation.semantic_context_decision_input->>'generation_key'=(SELECT source.generation_key FROM signal_semantic_context_generations source
          WHERE source.id=generation.supersedes_generation_id)))
    AND safe_expected=predecessor.element_version
    AND operation.semantic_context_decision_input->>'state_token'=signal_semantic_context_digest_json_v2(
      jsonb_build_object('contract_version','signal-semantic-context-ordinary-state-token-v1',
        'element_key',predecessor.element_key,'element_version',predecessor.element_version,
        'element_digest',predecessor.element_digest,'lifecycle_state',predecessor.lifecycle_state))
    AND (element.ordinary_command_action<>'undo' OR (target.id IS NOT NULL AND safe_target=target.element_version
      AND ROW(element.element_kind,element.canonical_key,element.display_text,element.scope,element.entity_type,element.entity_id,
        element.locale,element.relation_kind,element.relation_target_key,element.source_refs_digest,
        element.locale_decision_contract_version,element.locale_decision_disposition,element.locale_decision_locale,
        element.locale_decision_reason_code,element.locale_decision_rationale,element.locale_decision_basis_digest,
        element.locale_decision_input_digest,element.locale_decision_authority_snapshot,element.locale_decision_authority_digest,
        element.locale_decision_prestate_digest,element.locale_decision_poststate_digest)
      IS NOT DISTINCT FROM ROW(target.element_kind,target.canonical_key,target.display_text,target.scope,target.entity_type,target.entity_id,
        target.locale,target.relation_kind,target.relation_target_key,target.source_refs_digest,
        target.locale_decision_contract_version,target.locale_decision_disposition,target.locale_decision_locale,
        target.locale_decision_reason_code,target.locale_decision_rationale,target.locale_decision_basis_digest,
        target.locale_decision_input_digest,target.locale_decision_authority_snapshot,target.locale_decision_authority_digest,
        target.locale_decision_prestate_digest,target.locale_decision_poststate_digest)))
    AND (element.ordinary_command_action<>'save' OR (jsonb_typeof(operation.semantic_context_decision_input->'values')='object'
      AND operation.semantic_context_decision_input->'values'->>'display_text'=element.display_text
      AND operation.semantic_context_decision_input->'values'->>'canonical_key'=element.canonical_key
      AND operation.semantic_context_decision_input->'values'->'scope' IS NOT DISTINCT FROM COALESCE(to_jsonb(element.scope),'null'::jsonb)
      AND operation.semantic_context_decision_input->'values'->'relation_kind' IS NOT DISTINCT FROM COALESCE(to_jsonb(element.relation_kind),'null'::jsonb)
      AND operation.semantic_context_decision_input->'values'->'relation_target_key' IS NOT DISTINCT FROM COALESCE(to_jsonb(element.relation_target_key),'null'::jsonb)))
    AND CASE element.ordinary_command_action
      WHEN 'save' THEN operation.semantic_context_decision_input-ARRAY['contract_version','action','generation_key',
        'element_key','expected_version','state_token','values']='{}'::jsonb
      WHEN 'undo' THEN operation.semantic_context_decision_input-ARRAY['contract_version','action','generation_key',
        'element_key','expected_version','state_token','target_version']='{}'::jsonb
      ELSE operation.semantic_context_decision_input-ARRAY['contract_version','action','generation_key',
        'element_key','expected_version','state_token']='{}'::jsonb END
    AND (element.ordinary_command_action<>'save' OR CASE operation.semantic_context_decision_input->'values'->'applicability'->>'state'
      WHEN 'preserve' THEN ROW(element.locale,element.locale_decision_contract_version,element.locale_decision_disposition,
        element.locale_decision_locale,element.locale_decision_reason_code,element.locale_decision_rationale,
        element.locale_decision_basis_digest,element.locale_decision_input_digest,element.locale_decision_authority_snapshot,
        element.locale_decision_authority_digest,element.locale_decision_prestate_digest,element.locale_decision_poststate_digest)
        IS NOT DISTINCT FROM ROW(predecessor.locale,predecessor.locale_decision_contract_version,
        predecessor.locale_decision_disposition,predecessor.locale_decision_locale,predecessor.locale_decision_reason_code,
        predecessor.locale_decision_rationale,predecessor.locale_decision_basis_digest,predecessor.locale_decision_input_digest,
        predecessor.locale_decision_authority_snapshot,predecessor.locale_decision_authority_digest,
        predecessor.locale_decision_prestate_digest,predecessor.locale_decision_poststate_digest)
      WHEN 'workspace_inherited' THEN element.locale IS NULL AND element.locale_decision_contract_version IS NULL
        AND operation.semantic_context_decision_input->'values'->'applicability'->'locale'='null'::jsonb
      WHEN 'explicit_global' THEN element.locale IS NULL AND element.locale_decision_disposition='global'
        AND operation.semantic_context_decision_input->'values'->'applicability'->'locale'='null'::jsonb
        AND element.locale_decision_input_digest=operation.semantic_context_decision_input_digest
      WHEN 'explicit_locale' THEN element.locale_decision_disposition='locale_specific'
        AND element.locale=operation.semantic_context_decision_input->'values'->'applicability'->>'locale'
        AND element.locale_decision_input_digest=operation.semantic_context_decision_input_digest
      ELSE false END)
    AND operation.semantic_context_decision_input_digest=element.ordinary_command_input_digest
    AND signal_semantic_context_digest_json_v2(operation.semantic_context_decision_input)=element.ordinary_command_input_digest
    AND parent->>'valid'='true' AND element.ordinary_command_basis=expected_basis
    AND signal_semantic_context_digest_json_v2(expected_basis)=element.ordinary_command_basis_digest
    AND element.decided_by_user_id=operation.actor_user_id AND element.decided_at IS NOT NULL
    AND element.ordinary_command_prestate_digest=predecessor.element_digest
    AND element.ordinary_command_poststate_digest=element.element_digest
    AND element.source_refs_digest=predecessor.source_refs_digest
    AND ((element.ordinary_command_action='archive' AND (predecessor.disposition='approved' OR (predecessor.disposition='pending' AND predecessor.automatic_policy_outcome='exception'
          AND signal_semantic_context_automatic_policy_valid_v1(predecessor.id)))
        AND predecessor.lifecycle_state='active' AND element.disposition='archived' AND element.lifecycle_state='archived')
      OR (element.ordinary_command_action IN ('save','undo') AND (predecessor.disposition='approved' OR (predecessor.disposition='pending' AND predecessor.automatic_policy_outcome='exception'
          AND signal_semantic_context_automatic_policy_valid_v1(predecessor.id)))
        AND predecessor.lifecycle_state='active' AND element.disposition='approved' AND element.lifecycle_state='active')
      OR (element.ordinary_command_action='restore' AND predecessor.disposition='archived'
        AND predecessor.lifecycle_state='archived' AND element.disposition='approved' AND element.lifecycle_state='active'));
END; $$;

ALTER FUNCTION signal_semantic_context_automatic_policy_valid_v1(uuid) RENAME TO signal_semantic_context_automatic_policy_valid_v1_pre_0153;
CREATE FUNCTION signal_semantic_context_automatic_policy_valid_v1(target_element_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
BEGIN
 SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
 IF element.carried_from_element_id IS NOT NULL THEN
   RETURN signal_brand_context_carried_row_valid_v1(element) AND signal_semantic_context_automatic_policy_valid_v1(element.carried_from_element_id);
 END IF;
 RETURN signal_semantic_context_automatic_policy_valid_v1_pre_0153(target_element_id);
END $$;

ALTER FUNCTION signal_semantic_context_ordinary_authority_valid_v1(uuid) RENAME TO signal_semantic_context_ordinary_authority_valid_v1_pre_0153;
CREATE FUNCTION signal_semantic_context_ordinary_authority_valid_v1(target_element_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
BEGIN
 SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
 IF element.carried_from_element_id IS NOT NULL THEN
   RETURN signal_brand_context_carried_row_valid_v1(element) AND signal_semantic_context_ordinary_authority_valid_v1(element.carried_from_element_id);
 END IF;
 RETURN signal_semantic_context_ordinary_authority_valid_v1_pre_0153(target_element_id);
END $$;

ALTER FUNCTION signal_semantic_context_creation_authority_valid_v1(uuid) RENAME TO signal_semantic_context_creation_authority_valid_v1_pre_0153;
CREATE FUNCTION signal_semantic_context_creation_authority_valid_v1(target_element_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
BEGIN
 SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
 IF element.carried_from_element_id IS NOT NULL THEN
   RETURN signal_brand_context_carried_row_valid_v1(element) AND signal_semantic_context_creation_authority_valid_v1(element.carried_from_element_id);
 END IF;
 RETURN signal_semantic_context_creation_authority_valid_v1_pre_0153(target_element_id);
END $$;

ALTER FUNCTION signal_semantic_context_creation_lineage_valid_v1(uuid) RENAME TO signal_semantic_context_creation_lineage_valid_v1_pre_0153;
CREATE FUNCTION signal_semantic_context_creation_lineage_valid_v1(target_element_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
BEGIN
 SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
 IF element.carried_from_element_id IS NOT NULL THEN
   RETURN signal_brand_context_carried_row_valid_v1(element) AND signal_semantic_context_creation_lineage_valid_v1(element.carried_from_element_id);
 END IF;
 RETURN signal_semantic_context_creation_lineage_valid_v1_pre_0153(target_element_id);
END $$;

-- Restoration needs provenance through an archived leaf, not public applicability
-- for that archived leaf. Every intervening archive/copy must preserve locale.
CREATE FUNCTION signal_brand_context_approved_applicability_source_v1(p_element_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE origin signal_semantic_context_element_versions%ROWTYPE;
 cursor_element signal_semantic_context_element_versions%ROWTYPE;predecessor signal_semantic_context_element_versions%ROWTYPE;
BEGIN
 SELECT * INTO origin FROM signal_semantic_context_element_versions WHERE id=p_element_id;
 cursor_element:=origin;
 LOOP
   IF cursor_element.id IS NULL THEN RETURN NULL; END IF;
   IF cursor_element.disposition='approved' THEN
     IF cursor_element.origin_kind='operator_ordinary'
       AND signal_semantic_context_ordinary_authority_valid_v1(cursor_element.id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
     RETURN cursor_element.id;
   END IF;
   IF cursor_element.carried_from_element_id IS NOT NULL THEN
     IF signal_brand_context_carried_row_valid_v1(cursor_element) IS DISTINCT FROM true THEN RETURN NULL; END IF;
     SELECT prior.* INTO predecessor FROM signal_semantic_context_element_versions prior
       JOIN signal_semantic_context_generations prior_generation ON prior_generation.id=prior.generation_id
       JOIN signal_semantic_context_generations current_generation ON current_generation.id=cursor_element.generation_id
       WHERE prior.id=cursor_element.carried_from_element_id AND prior.workspace_id=origin.workspace_id
         AND prior.element_key=origin.element_key AND prior_generation.generation_version<current_generation.generation_version;
   ELSE
     IF cursor_element.origin_kind IS DISTINCT FROM 'operator_ordinary'
       OR cursor_element.ordinary_command_action IS DISTINCT FROM 'archive'
       OR cursor_element.disposition IS DISTINCT FROM 'archived' OR cursor_element.lifecycle_state IS DISTINCT FROM 'archived'
       OR signal_semantic_context_ordinary_authority_valid_v1(cursor_element.id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
     SELECT * INTO predecessor FROM signal_semantic_context_element_versions prior
       WHERE prior.id=cursor_element.supersedes_element_id AND prior.workspace_id=origin.workspace_id
         AND prior.generation_id=cursor_element.generation_id AND prior.element_key=origin.element_key
         AND prior.element_version<cursor_element.element_version;
   END IF;
   IF predecessor.id IS NULL OR ROW(cursor_element.locale,cursor_element.locale_decision_contract_version,
     cursor_element.locale_decision_disposition,cursor_element.locale_decision_locale,
     cursor_element.locale_decision_reason_code,cursor_element.locale_decision_rationale,
     cursor_element.locale_decision_basis_digest,cursor_element.locale_decision_input_digest,
     cursor_element.locale_decision_authority_snapshot,cursor_element.locale_decision_authority_digest,
     cursor_element.locale_decision_prestate_digest,cursor_element.locale_decision_poststate_digest)
     IS DISTINCT FROM ROW(predecessor.locale,predecessor.locale_decision_contract_version,
     predecessor.locale_decision_disposition,predecessor.locale_decision_locale,
     predecessor.locale_decision_reason_code,predecessor.locale_decision_rationale,
     predecessor.locale_decision_basis_digest,predecessor.locale_decision_input_digest,
     predecessor.locale_decision_authority_snapshot,predecessor.locale_decision_authority_digest,
     predecessor.locale_decision_prestate_digest,predecessor.locale_decision_poststate_digest) THEN RETURN NULL; END IF;
   cursor_element:=predecessor;
 END LOOP;
END $$;

ALTER FUNCTION signal_semantic_context_locale_authority_valid_v1(uuid) RENAME TO signal_semantic_context_locale_authority_valid_v1_pre_0153;
CREATE FUNCTION signal_semantic_context_locale_authority_valid_v1(target_element_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
 cursor_element signal_semantic_context_element_versions%ROWTYPE;predecessor signal_semantic_context_element_versions%ROWTYPE;
BEGIN
 SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
 IF element.carried_from_element_id IS NOT NULL THEN
   RETURN signal_brand_context_carried_row_valid_v1(element) AND signal_semantic_context_locale_authority_valid_v1(element.carried_from_element_id);
 END IF;
 IF signal_semantic_context_locale_authority_valid_v1_pre_0153(target_element_id) IS TRUE THEN RETURN true; END IF;
 IF element.origin_kind IS DISTINCT FROM 'operator_ordinary' OR element.disposition IS DISTINCT FROM 'approved' THEN RETURN false; END IF;
 -- A normal decision authored in this generation already passed above. Only
 -- unchanged, fully proven locale authority may cross a carry boundary.
 cursor_element:=element;
 WHILE cursor_element.carried_from_element_id IS NULL LOOP
   IF cursor_element.origin_kind IS DISTINCT FROM 'operator_ordinary'
     OR signal_semantic_context_ordinary_authority_valid_v1(cursor_element.id) IS DISTINCT FROM true THEN RETURN false; END IF;
   SELECT * INTO predecessor FROM signal_semantic_context_element_versions prior
     WHERE prior.id=cursor_element.supersedes_element_id AND prior.generation_id=element.generation_id
       AND prior.workspace_id=element.workspace_id AND prior.element_key=element.element_key
       AND prior.element_version<cursor_element.element_version;
   IF predecessor.id IS NULL OR ROW(cursor_element.locale,cursor_element.locale_decision_contract_version,
     cursor_element.locale_decision_disposition,cursor_element.locale_decision_locale,
     cursor_element.locale_decision_reason_code,cursor_element.locale_decision_rationale,
     cursor_element.locale_decision_basis_digest,cursor_element.locale_decision_input_digest,
     cursor_element.locale_decision_authority_snapshot,cursor_element.locale_decision_authority_digest,
     cursor_element.locale_decision_prestate_digest,cursor_element.locale_decision_poststate_digest)
     IS DISTINCT FROM ROW(predecessor.locale,predecessor.locale_decision_contract_version,
     predecessor.locale_decision_disposition,predecessor.locale_decision_locale,
     predecessor.locale_decision_reason_code,predecessor.locale_decision_rationale,
     predecessor.locale_decision_basis_digest,predecessor.locale_decision_input_digest,
     predecessor.locale_decision_authority_snapshot,predecessor.locale_decision_authority_digest,
     predecessor.locale_decision_prestate_digest,predecessor.locale_decision_poststate_digest) THEN RETURN false; END IF;
   cursor_element:=predecessor;
 END LOOP;
 RETURN signal_brand_context_carried_row_valid_v1(cursor_element)
   AND COALESCE(signal_semantic_context_locale_authority_valid_v1(
     signal_brand_context_approved_applicability_source_v1(cursor_element.id)),false);
END $$;

-- A copied leaf retains its proposal pointer in the published source generation.
-- Resolve that provenance without pretending it was proposed in the child. Both
-- generations must independently satisfy the same live authority; the serving
-- envelope and its digest belong to the child being published.
ALTER FUNCTION signal_semantic_context_effective_applicability_v1(uuid,jsonb)
 RENAME TO signal_semantic_context_effective_applicability_v1_pre_0153;
CREATE FUNCTION signal_semantic_context_effective_applicability_v1(target_element_id uuid,expected_live_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
 cursor_element signal_semantic_context_element_versions%ROWTYPE;predecessor signal_semantic_context_element_versions%ROWTYPE;
 parent_result jsonb;source_result jsonb;applicability jsonb;base jsonb;state text;
BEGIN
 SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
 IF element.carried_from_element_id IS NULL THEN
   base:=signal_semantic_context_effective_applicability_v1_pre_0153(target_element_id,expected_live_authority);
   -- Ordinary descendants keep the original proposal pointer as well. Repair
   -- only this exact cross-generation case, never another legacy rejection.
   IF base->>'reason' IS DISTINCT FROM 'proposal_origin_invalid' OR element.origin_kind IS DISTINCT FROM 'operator_ordinary'
     OR element.disposition IS DISTINCT FROM 'approved' OR element.locale_decision_contract_version IS NOT NULL THEN RETURN base; END IF;
   cursor_element:=element;
   WHILE cursor_element.carried_from_element_id IS NULL LOOP
     IF cursor_element.origin_kind IS DISTINCT FROM 'operator_ordinary'
       OR signal_semantic_context_ordinary_authority_valid_v1(cursor_element.id) IS DISTINCT FROM true THEN RETURN base; END IF;
     SELECT * INTO predecessor FROM signal_semantic_context_element_versions prior
       WHERE prior.id=cursor_element.supersedes_element_id AND prior.generation_id=element.generation_id
         AND prior.workspace_id=element.workspace_id AND prior.element_key=element.element_key
         AND prior.element_version<cursor_element.element_version;
     IF predecessor.id IS NULL THEN RETURN base; END IF;
     cursor_element:=predecessor;
   END LOOP;
   source_result:=signal_semantic_context_effective_applicability_v1(
     signal_brand_context_approved_applicability_source_v1(cursor_element.id),expected_live_authority);
   IF source_result->>'valid' IS DISTINCT FROM 'true' THEN RETURN base; END IF;
   parent_result:=signal_semantic_context_parent_applicability_v1(element.generation_id,expected_live_authority);
   IF parent_result->>'valid' IS DISTINCT FROM 'true' THEN RETURN parent_result; END IF;
   IF element.locale IS NOT NULL THEN
     IF signal_semantic_context_locale_authority_valid_v1(element.id) IS DISTINCT FROM true THEN
       RETURN jsonb_build_object('valid',false,'reason','explicit_locale_invalid'); END IF;
     state:='explicit_locale';
   ELSIF element.element_kind='locale_variant' THEN
     RETURN jsonb_build_object('valid',false,'reason','locale_specific_locale_required');
   ELSE state:='workspace_inherited'; END IF;
   applicability:=jsonb_build_object('contract_version','signal-semantic-context-effective-applicability-v1',
     'state',state,'locale',element.locale,'locales',CASE WHEN state='explicit_locale' THEN jsonb_build_array(element.locale)
       ELSE parent_result->'parent_authority'->'locales' END,'markets',parent_result->'parent_authority'->'markets',
     'source',CASE state WHEN 'workspace_inherited' THEN 'sealed_generation_locale_context' ELSE 'sealed_element_locale' END,
     'parent_authority',parent_result->'parent_authority','parent_authority_digest',parent_result->>'parent_authority_digest',
     'explicit_authority_digest',NULL);
   RETURN jsonb_build_object('valid',true,'applicability',applicability,
     'applicability_digest',signal_semantic_context_digest_json_v2(applicability));
 END IF;
 IF signal_brand_context_carried_row_valid_v1(element) IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('valid',false,'reason','carried_element_invalid');
 END IF;
 parent_result:=signal_semantic_context_parent_applicability_v1(element.generation_id,expected_live_authority);
 IF parent_result->>'valid' IS DISTINCT FROM 'true' THEN RETURN parent_result; END IF;
 source_result:=signal_semantic_context_effective_applicability_v1(element.carried_from_element_id,expected_live_authority);
 IF source_result->>'valid' IS DISTINCT FROM 'true' THEN
   RETURN jsonb_build_object('valid',false,'reason','carried_source_applicability_invalid');
 END IF;
 applicability:=(source_result->'applicability')||jsonb_build_object(
   'parent_authority',parent_result->'parent_authority',
   'parent_authority_digest',parent_result->>'parent_authority_digest');
 RETURN jsonb_build_object('valid',true,'applicability',applicability,
   'applicability_digest',signal_semantic_context_digest_json_v2(applicability));
END $$;
CREATE UNIQUE INDEX uq_signal_brand_context_carried_element ON signal_semantic_context_element_versions(generation_id,carried_from_element_id)
WHERE carried_from_element_id IS NOT NULL;
CREATE FUNCTION validate_signal_brand_context_carry_completion_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE child signal_semantic_context_generations%ROWTYPE;expected integer;actual integer;
BEGIN
 IF NEW.action<>'reconcile-semantic-context-generation' OR NEW.status<>'completed' THEN RETURN NEW; END IF;
 SELECT gen.* INTO child FROM signal_semantic_context_generations gen JOIN analysis_artifacts artifact ON artifact.id=gen.artifact_id
   WHERE gen.created_operation_id=NEW.id AND artifact.metadata ? 'carried_from_generation_id';
 IF child.id IS NULL THEN RETURN NEW; END IF;
 SELECT count(*) INTO expected FROM signal_semantic_context_element_versions element WHERE generation_id=child.supersedes_generation_id
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id);
 SELECT count(*) INTO actual FROM signal_semantic_context_element_versions element WHERE generation_id=child.id
   AND operation_id=NEW.id AND signal_brand_context_carried_row_valid_v1(element);
 IF expected<>actual OR actual<>(SELECT count(*) FROM signal_semantic_context_element_versions WHERE generation_id=child.id) THEN
   RAISE EXCEPTION 'Carry-forward must preserve the complete published leaf census.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_signal_brand_context_carry_completion BEFORE UPDATE ON signal_governance_control_operations
FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_carry_completion_v1();

-- Original generation guards retained; only a proved unspent Brand Context terminal can use the existing successor contract.
CREATE OR REPLACE FUNCTION validate_signal_semantic_context_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_kind text;artifact_authority text;profile_brand uuid;workspace_brand uuid;
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE predecessor signal_semantic_context_generations%ROWTYPE;
DECLARE predecessor_run signal_semantic_context_proposal_runs%ROWTYPE;completed_drift boolean:=false;
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
      completed_drift:=predecessor.status='draft' AND predecessor_run.id IS NOT NULL
        AND predecessor_run.created_by_user_id=NEW.created_by_user_id
        AND signal_brand_context_completed_history_v1(predecessor_run.id)
        AND NEW.supersession_reason IN('brand_os_drift','knowledge_drift','locale_market_drift')
        AND artifact_authority IS DISTINCT FROM (SELECT workspace_authority_digest FROM analysis_artifacts WHERE id=predecessor.artifact_id)
        AND CASE NEW.supersession_reason
          WHEN 'brand_os_drift' THEN ROW(NEW.brand_os_profile_id,NEW.brand_os_digest) IS DISTINCT FROM ROW(predecessor.brand_os_profile_id,predecessor.brand_os_digest)
          WHEN 'knowledge_drift' THEN NEW.knowledge_digest IS DISTINCT FROM predecessor.knowledge_digest
          WHEN 'locale_market_drift' THEN NEW.locale_context_digest IS DISTINCT FROM predecessor.locale_context_digest ELSE false END
        AND EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.id=NEW.artifact_id
          AND artifact.metadata->>'completed_stale_predecessor_run_id'=predecessor_run.id::text
          AND artifact.metadata->>'authority_only'='true')
        AND NEW.status='draft' AND NEW.pack_digest IS NULL;
      IF predecessor.status='draft' AND predecessor_run.id IS NOT NULL
         AND NEW.supersession_reason<>'terminal_provider_run' AND NOT COALESCE(completed_drift,false) THEN
        RAISE EXCEPTION 'Consumed semantic context drafts require terminal-run supersession.' USING ERRCODE='23514';
      END IF;
      IF NEW.supersession_reason='terminal_provider_run' THEN
        IF predecessor.status<>'draft' OR predecessor_run.id IS NULL
           OR NOT (
             signal_brand_context_unspent_run_v1(predecessor_run.id)
             OR (predecessor_run.status='failed'
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
