-- Free, workspace-scoped reconciliation. No provider/admission/owner is created by
-- this migration or by the reconciliation protocol. Existing paid history remains immutable.
CREATE TABLE signal_brand_context_source_reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 expected_generation_id uuid REFERENCES signal_semantic_context_generations(id) ON DELETE RESTRICT,
 generation_id uuid REFERENCES signal_semantic_context_generations(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'preparing' CHECK(status IN('preparing','completed')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,actor_user_id,idempotency_key)
);

-- An uploaded file hash identifies the original bytes. A Brand OS edit switches
-- authority back to the current content; corpus ingestion retains its own protocol.
CREATE FUNCTION invalidate_signal_brand_context_knowledge_hash_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.study_corpus_id IS NULL AND ROW(NEW.raw_text,NEW.extracted_payload,NEW.source_kind)
   IS DISTINCT FROM ROW(OLD.raw_text,OLD.extracted_payload,OLD.source_kind) THEN
  NEW.file_hash:=NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER brand_context_knowledge_hash BEFORE UPDATE OF raw_text,extracted_payload,source_kind
 ON brand_knowledge_sources FOR EACH ROW EXECUTE FUNCTION invalidate_signal_brand_context_knowledge_hash_v1();

CREATE FUNCTION signal_brand_context_source_editor_v1(target_workspace uuid,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspaces w
 JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
 JOIN organizations o ON o.id=w.organization_id
 JOIN users u ON u.id=target_actor AND u.organization_id=o.id
 JOIN user_brand_access a ON a.brand_id=b.id AND a.user_id=u.id
 WHERE w.id=target_workspace AND w.status='active' AND b.status='active' AND o.status='active'
 AND u.status='active' AND u.user_type='client' AND u.primary_role='client_admin'
 AND a.revoked_at IS NULL AND a.access_level IN('comment','admin'))
$$;

CREATE FUNCTION begin_signal_brand_context_source_reconciliation_v1(target_workspace uuid,target_actor uuid,
 request_key text,expected_generation uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;head signal_semantic_context_generations%ROWTYPE;
 prior signal_brand_context_source_reconciliations%ROWTYPE;request_hash text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'brand_context_reconciliation_requires_read_committed' USING ERRCODE='25001'; END IF;
 IF request_key IS NULL OR request_key!~'^[A-Za-z0-9._:-]{8,200}$' THEN
  RAISE EXCEPTION 'brand_context_reconciliation_request_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||target_workspace::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-os-reconcile:'||target_workspace::text,0));
 -- Do not take money locks or lock an owner after acquiring identity locks.
 SELECT * INTO head FROM signal_semantic_context_generations WHERE workspace_id=target_workspace
  ORDER BY generation_version DESC LIMIT 1 FOR UPDATE;
 -- Never lock a provider owner here: response append holds owner -> semantic.
 -- Active/uncertain owners only return awaiting_settlement; terminal successors
 -- are serialized by the same semantic lock used by explicit retries.
 PERFORM u.id FROM users u JOIN signal_workspaces scope ON scope.id=target_workspace
  JOIN brands b ON b.id=scope.brand_id JOIN organizations o ON o.id=scope.organization_id
  WHERE u.id=target_actor FOR SHARE OF u,scope,b,o;
 PERFORM a.id FROM user_brand_access a JOIN signal_workspaces scope ON scope.brand_id=a.brand_id
  WHERE scope.id=target_workspace AND a.user_id=target_actor ORDER BY a.id FOR SHARE OF a;
 IF NOT signal_brand_context_source_editor_v1(target_workspace,target_actor) THEN
  RAISE EXCEPTION 'brand_context_reconciliation_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object(
  'contract_version','brand-context-source-reconciliation-request-v1','workspace_id',target_workspace,
  'actor_user_id',target_actor,'expected_generation_id',expected_generation));
 SELECT * INTO prior FROM signal_brand_context_source_reconciliations
  WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash OR prior.status<>'completed' THEN
   RAISE EXCEPTION 'brand_context_reconciliation_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('replayed',true,'result',prior.result); END IF;
 IF head.id IS DISTINCT FROM expected_generation THEN
  RAISE EXCEPTION 'brand_context_generation_changed' USING ERRCODE='23514'; END IF;
 INSERT INTO signal_brand_context_source_reconciliations(workspace_id,actor_user_id,expected_generation_id,
  idempotency_key,request_digest) VALUES(target_workspace,target_actor,expected_generation,request_key,request_hash)
  RETURNING * INTO prior;
 RETURN jsonb_build_object('replayed',false,'reconciliation_id',prior.id,'workspace',jsonb_build_object(
  'id',w.id,'organizationId',w.organization_id,'subject',jsonb_build_object('type','brand','id',w.brand_id),'timezone',w.timezone),
  'head',CASE WHEN head.id IS NULL THEN NULL ELSE to_jsonb(head) END);
END; $$;

CREATE FUNCTION signal_brand_context_source_successor_safe_v1(target_generation uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs r WHERE r.generation_id=target_generation
  AND (r.status NOT IN('completed','stale','failed','dead_letter')
   OR r.provider_call_state NOT IN('not_started','settled') OR r.lease_token IS NOT NULL
   OR (r.provider_call_state='not_started' AND (r.provider_call_count<>0 OR r.provider_response_private IS NOT NULL))
   OR (r.provider_call_state='settled' AND (r.provider_response_private IS NULL OR r.provider_response_digest IS NULL
     -- A failed paid response is still eligible for server-side revalidation and
     -- append. Do not supersede its generation while that durable value remains
     -- publishable; no second provider call is needed to finish it.
     OR r.status='failed' AND r.appended_operation_id IS NULL AND COALESCE(r.proposal_count,0)=0))
   OR (r.status='completed' AND (r.provider_call_state<>'settled' OR r.validated_output_digest IS NULL
     OR r.appended_operation_id IS NULL OR COALESCE(r.proposal_count,0)<=0 OR r.result_digest IS NULL))
   OR EXISTS(SELECT 1 FROM signal_semantic_context_budget_reservations b WHERE b.run_id=r.id
     AND b.status NOT IN('released','settled'))
   OR EXISTS(SELECT 1 FROM signal_semantic_context_proposal_outbox q WHERE q.run_id=r.id
     AND q.status NOT IN('completed','dead_letter'))))
 AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts receipt
  JOIN signal_workspace_embedding_runs run ON run.id=receipt.run_id
   AND run.workspace_id=receipt.workspace_id AND run.processing_admission_id=receipt.admission_id
  WHERE receipt.generation_id=target_generation
   AND (run.input_contract<>'topic_prototypes'
    OR run.status NOT IN('completed','failed','canceled','stale')
    OR run.execution_token IS NOT NULL
    OR EXISTS(SELECT 1 FROM signal_workspace_embedding_calls call
      WHERE call.run_id=run.id AND call.workspace_id=run.workspace_id
       AND call.status NOT IN('settled','definitely_not_sent'))))
$$;

-- A source successor does not inherit or edit the predecessor's paid elements.
CREATE FUNCTION signal_brand_context_source_successor_valid_v1(candidate signal_semantic_context_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_brand_context_source_reconciliations receipt
 JOIN analysis_artifacts artifact ON artifact.id=candidate.artifact_id AND artifact.workspace_id=candidate.workspace_id
 JOIN signal_semantic_context_generations parent ON parent.id=receipt.expected_generation_id
 WHERE artifact.metadata->>'source_reconciliation_id'=receipt.id::text AND receipt.status='preparing'
 AND receipt.workspace_id=candidate.workspace_id AND receipt.actor_user_id=candidate.created_by_user_id
 AND receipt.generation_id=candidate.id AND candidate.supersedes_generation_id=parent.id
 AND candidate.status='draft' AND candidate.pack_digest IS NULL AND candidate.semantic_context_pack_digest IS NULL
 AND artifact.metadata->>'authority_only'='true'
 AND artifact.workspace_authority_digest IS DISTINCT FROM
   (SELECT workspace_authority_digest FROM analysis_artifacts WHERE id=parent.artifact_id)
 AND CASE candidate.supersession_reason
  WHEN 'brand_os_drift' THEN ROW(candidate.brand_os_profile_id,candidate.brand_os_digest)
    IS DISTINCT FROM ROW(parent.brand_os_profile_id,parent.brand_os_digest)
  WHEN 'knowledge_drift' THEN candidate.knowledge_digest IS DISTINCT FROM parent.knowledge_digest
  WHEN 'locale_market_drift' THEN candidate.locale_context_digest IS DISTINCT FROM parent.locale_context_digest ELSE false END
 AND signal_brand_context_source_editor_v1(candidate.workspace_id,candidate.created_by_user_id)
 AND signal_brand_context_source_successor_safe_v1(parent.id))
$$;

CREATE FUNCTION validate_signal_brand_context_source_reconciliation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE head_id uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||NEW.workspace_id::text,0));
  PERFORM u.id FROM users u JOIN signal_workspaces scope ON scope.id=NEW.workspace_id
   JOIN brands b ON b.id=scope.brand_id JOIN organizations o ON o.id=scope.organization_id
   WHERE u.id=NEW.actor_user_id FOR SHARE OF u,scope,b,o;
  PERFORM a.id FROM user_brand_access a JOIN signal_workspaces scope ON scope.brand_id=a.brand_id
   WHERE scope.id=NEW.workspace_id AND a.user_id=NEW.actor_user_id ORDER BY a.id FOR SHARE OF a;
  SELECT id INTO head_id FROM signal_semantic_context_generations WHERE workspace_id=NEW.workspace_id
   ORDER BY generation_version DESC LIMIT 1;
  IF current_setting('transaction_isolation')<>'read committed'
   OR head_id IS DISTINCT FROM NEW.expected_generation_id
   OR NEW.request_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','brand-context-source-reconciliation-request-v1','workspace_id',NEW.workspace_id,
    'actor_user_id',NEW.actor_user_id,'expected_generation_id',NEW.expected_generation_id)) THEN
   RAISE EXCEPTION 'brand_context_reconciliation_request_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE'  OR TG_OP='UPDATE' AND (OLD.status<>'preparing' OR NEW.status NOT IN('preparing','completed')
  OR (to_jsonb(NEW)-ARRAY['status','generation_id','result']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','generation_id','result'])
  OR OLD.generation_id IS NOT NULL AND NEW.generation_id IS DISTINCT FROM OLD.generation_id) THEN
  RAISE EXCEPTION 'brand_context_reconciliation_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'preparing' OR NEW.result IS NOT NULL OR NEW.generation_id IS NOT NULL) THEN
  RAISE EXCEPTION 'brand_context_reconciliation_request_invalid' USING ERRCODE='23514'; END IF;
 IF NOT signal_brand_context_source_editor_v1(NEW.workspace_id,NEW.actor_user_id) THEN
  RAISE EXCEPTION 'brand_context_reconciliation_forbidden' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER brand_context_source_reconciliation_guard BEFORE INSERT OR UPDATE OR DELETE
 ON signal_brand_context_source_reconciliations FOR EACH ROW EXECUTE FUNCTION validate_signal_brand_context_source_reconciliation_v1();

CREATE FUNCTION complete_signal_brand_context_source_reconciliation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE receipt signal_brand_context_source_reconciliations%ROWTYPE;g signal_semantic_context_generations%ROWTYPE;
BEGIN
 SELECT * INTO receipt FROM signal_brand_context_source_reconciliations WHERE id=NEW.id;
 SELECT * INTO g FROM signal_semantic_context_generations WHERE id=receipt.generation_id;
 IF receipt.status<>'completed' OR receipt.result IS NULL
  OR receipt.result->>'contract_version' IS DISTINCT FROM 'brand-context-source-reconciliation-v1'
  OR receipt.result->>'reconciliation_id' IS DISTINCT FROM receipt.id::text
  OR receipt.result->>'workspace_id' IS DISTINCT FROM receipt.workspace_id::text
  OR receipt.result->>'generation_id' IS DISTINCT FROM receipt.generation_id::text
  OR receipt.result->>'generation_key' IS DISTINCT FROM g.generation_key
  OR receipt.result->'replayed' IS DISTINCT FROM 'false'::jsonb
  OR receipt.result->>'state' IS NULL OR receipt.result->>'state' NOT IN('current','awaiting_authorization','awaiting_settlement')
  OR (receipt.generation_id IS NOT NULL AND (g.workspace_id IS DISTINCT FROM receipt.workspace_id
    OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor WHERE successor.supersedes_generation_id=g.id)))
  OR receipt.result->>'state'<>'awaiting_settlement' AND
    (g.id IS NULL OR signal_brand_context_processing_source_current_v1(g.id) IS DISTINCT FROM true)
  OR receipt.generation_id IS DISTINCT FROM receipt.expected_generation_id AND (
    g.status<>'draft' OR g.pack_digest IS NOT NULL OR g.supersedes_generation_id IS DISTINCT FROM receipt.expected_generation_id
    OR EXISTS(SELECT 1 FROM signal_semantic_context_element_versions WHERE generation_id=g.id)
    OR EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs WHERE generation_id=g.id)
    OR NOT EXISTS(SELECT 1 FROM signal_governance_control_operations op WHERE op.workspace_id=g.workspace_id
      AND op.action='prepare-brand-context' AND op.status='completed'
      AND op.brand_context_preparation->>'generation_id'=g.id::text
      AND op.brand_context_preparation->>'source_reconciliation_id'=receipt.id::text
      AND op.brand_context_preparation->'admission'='null'::jsonb)) THEN
  RAISE EXCEPTION 'brand_context_reconciliation_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER brand_context_source_reconciliation_complete AFTER INSERT OR UPDATE
 ON signal_brand_context_source_reconciliations DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION complete_signal_brand_context_source_reconciliation_v1();

-- New spend only. Evidence persistence and settlement deliberately do not pass this gate.
CREATE FUNCTION signal_brand_context_source_send_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_generation uuid;target_workspace uuid;
BEGIN
 IF TG_TABLE_NAME='signal_semantic_context_proposal_runs' THEN
  IF NOT (OLD.provider_call_state='not_started' AND NEW.provider_call_state='in_flight') THEN RETURN NEW; END IF;
  SELECT receipt.generation_id,receipt.workspace_id INTO target_generation,target_workspace
   FROM signal_brand_context_processing_receipts receipt WHERE receipt.semantic_run_id=NEW.id;
 ELSIF TG_TABLE_NAME='signal_semantic_context_budget_reservations' THEN
  IF NEW.status<>'reserved' OR TG_OP='UPDATE' AND OLD.status='reserved' THEN RETURN NEW; END IF;
  SELECT receipt.generation_id,receipt.workspace_id INTO target_generation,target_workspace
   FROM signal_brand_context_processing_receipts receipt WHERE receipt.semantic_run_id=NEW.run_id;
 ELSE
  IF TG_OP='UPDATE' AND NOT (OLD.status='reserved' AND NEW.status='in_flight') THEN RETURN NEW; END IF;
  SELECT receipt.generation_id,receipt.workspace_id INTO target_generation,target_workspace
   FROM signal_brand_context_prototype_receipts receipt WHERE receipt.run_id=NEW.run_id;
 END IF;
 IF target_generation IS NOT NULL AND (target_workspace IS DISTINCT FROM NEW.workspace_id
  OR signal_brand_context_processing_source_current_v1(target_generation) IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'brand_context_source_stale' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER aab_brand_context_source_send BEFORE UPDATE ON signal_semantic_context_proposal_runs
 FOR EACH ROW EXECUTE FUNCTION signal_brand_context_source_send_guard_v1();
CREATE TRIGGER aab_brand_context_source_reserve BEFORE INSERT OR UPDATE ON signal_semantic_context_budget_reservations
 FOR EACH ROW EXECUTE FUNCTION signal_brand_context_source_send_guard_v1();
CREATE TRIGGER aab_brand_context_source_call BEFORE INSERT OR UPDATE ON signal_workspace_embedding_calls
 FOR EACH ROW EXECUTE FUNCTION signal_brand_context_source_send_guard_v1();

-- Preserve the predecessor generation guard; the only added exception is a proved, free source successor.
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
      completed_drift:=COALESCE(completed_drift,false) OR signal_brand_context_source_successor_valid_v1(NEW);
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
       OR NOT (signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.published_by_user_id)
         OR signal_brand_context_composed_publication_actor_v1(NEW.id,NEW.published_by_user_id)) THEN
      RAISE EXCEPTION 'Semantic context publication operation authority is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;


CREATE OR REPLACE FUNCTION validate_signal_brand_context_preparation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
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
  -- Free client preparation is admitted only by the exact reconciliation receipt.
  -- Paid preparation and every historical/internal path still use the original guard.
  IF EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='client') THEN
    IF NOT signal_semantic_context_json_object_keys_match_v1(input,ARRAY[
      'admission','contract_version','generation_id','generation_key','primary_locale','source_authority_digest','source_reconciliation_id'])
      OR input->'admission' IS DISTINCT FROM 'null'::jsonb
      OR input->>'contract_version' IS DISTINCT FROM 'brand-context-preparation-input-v1'
      OR generation.id IS NULL OR generation.workspace_id<>NEW.workspace_id
      OR input->>'generation_key' IS DISTINCT FROM generation.generation_key
      OR input->>'primary_locale' IS DISTINCT FROM generation.primary_locale
      OR NOT signal_brand_context_source_editor_v1(NEW.workspace_id,NEW.actor_user_id)
      OR signal_brand_context_processing_source_current_v1(generation.id) IS DISTINCT FROM true
      OR input->>'source_authority_digest' IS DISTINCT FROM
        (SELECT workspace_authority_digest FROM analysis_artifacts WHERE id=generation.artifact_id)
      OR NOT EXISTS(SELECT 1 FROM signal_brand_context_source_reconciliations receipt
        WHERE receipt.id::text=input->>'source_reconciliation_id' AND receipt.status='preparing'
          AND receipt.workspace_id=NEW.workspace_id AND receipt.actor_user_id=NEW.actor_user_id
          AND receipt.generation_id=generation.id) THEN
      RAISE EXCEPTION 'brand_context_reconciliation_preparation_invalid' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
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

ALTER TABLE signal_brand_context_source_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_brand_context_source_reconciliations FROM PUBLIC;
DO $$ DECLARE role_name text; fn text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['PUBLIC','anon','authenticated'] LOOP
  IF role_name='PUBLIC' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_brand_context_source_reconciliations FROM %s',
    CASE WHEN role_name='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END);
   FOREACH fn IN ARRAY ARRAY[
    'invalidate_signal_brand_context_knowledge_hash_v1()',
    'signal_brand_context_source_editor_v1(uuid,uuid)',
    'begin_signal_brand_context_source_reconciliation_v1(uuid,uuid,text,uuid)',
    'signal_brand_context_source_successor_safe_v1(uuid)',
    'signal_brand_context_source_successor_valid_v1(signal_semantic_context_generations)',
    'validate_signal_brand_context_source_reconciliation_v1()',
    'complete_signal_brand_context_source_reconciliation_v1()',
    'signal_brand_context_source_send_guard_v1()',
    'validate_signal_semantic_context_generation_v1()',
    'validate_signal_brand_context_preparation_v1()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',fn,
     CASE WHEN role_name='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END);
   END LOOP;
  END IF;
 END LOOP;
END $$;
