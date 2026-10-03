-- Local-only native classification persistence. No publication, producer or policy activation.
-- The 0087 assignment ledger remains the only classification authority.
ALTER TABLE signal_classification_generations
 ALTER COLUMN input_watermark_digest DROP NOT NULL,
 ADD COLUMN input_contract text NOT NULL DEFAULT 'legacy-classification-v1',
 ADD COLUMN preparation_run_id uuid,
 ADD COLUMN embedding_run_id uuid,
 ADD COLUMN input_revision bigint,
 ADD COLUMN input_snapshot jsonb,
 ADD COLUMN input_digest text,
 ADD COLUMN policy_valid_until timestamptz,
 ADD COLUMN source_generation_id uuid REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
 ADD CONSTRAINT workspace_classification_preparation FOREIGN KEY(workspace_id,preparation_run_id)
  REFERENCES signal_corpus_preparation_runs(workspace_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT workspace_classification_embeddings FOREIGN KEY(workspace_id,embedding_run_id)
  REFERENCES signal_workspace_embedding_runs(workspace_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT workspace_classification_generation_shape CHECK(
  (input_contract='legacy-classification-v1' AND input_watermark_digest IS NOT NULL
   AND preparation_run_id IS NULL AND embedding_run_id IS NULL AND input_snapshot IS NULL AND input_digest IS NULL AND source_generation_id IS NULL)
  OR COALESCE(input_contract='workspace-topic-classification-v1' AND study_corpus_id IS NULL AND input_watermark_digest IS NULL
   AND supersedes_generation_id IS NULL AND preparation_run_id IS NOT NULL AND embedding_run_id IS NOT NULL AND input_revision>0
   AND jsonb_typeof(input_snapshot)='object' AND input_digest~'^sha256:[0-9a-f]{64}$',false));
ALTER TABLE signal_classification_generation_items
 ADD COLUMN root_fingerprint text CHECK(root_fingerprint~'^sha256:[0-9a-f]{64}$'),
 ADD COLUMN correction_digest text CHECK(correction_digest~'^sha256:[0-9a-f]{64}$'),
 ADD COLUMN reuse_key text CHECK(reuse_key~'^sha256:[0-9a-f]{64}$'),
 ADD COLUMN outcome_metadata jsonb,
 ADD COLUMN source_generation_item_id uuid REFERENCES signal_classification_generation_items(id) ON DELETE RESTRICT;
ALTER TABLE signal_classification_assignments
 ADD COLUMN source_assignment_id uuid REFERENCES signal_classification_assignments(id) ON DELETE RESTRICT,
 ADD COLUMN correction_operation_id uuid REFERENCES signal_topic_membership_operations(id) ON DELETE RESTRICT,
 ADD COLUMN definition_digest text CHECK(definition_digest~'^sha256:[0-9a-f]{64}$'),
 ADD COLUMN definition_revision integer CHECK(definition_revision>0);
CREATE UNIQUE INDEX uq_workspace_classification_root_topic ON signal_classification_assignments(generation_id,canonical_root_id,taxonomy_term_id)
 WHERE definition_digest IS NOT NULL;
CREATE INDEX idx_workspace_classification_reuse ON signal_classification_generation_items(canonical_root_id,reuse_key,generation_id)
 WHERE reuse_key IS NOT NULL;
CREATE INDEX idx_workspace_classification_latest ON signal_classification_generations(workspace_id,generation_version DESC)
 WHERE input_contract='workspace-topic-classification-v1' AND status='ready';

ALTER TABLE signal_topic_membership_operations
 ADD COLUMN origin_input_contract text NOT NULL DEFAULT 'legacy-topic-catalog-v1',
 ADD COLUMN root_fingerprint text,
 ADD COLUMN definition_digest text,
 ADD COLUMN context_digest text,
 ADD CONSTRAINT workspace_topic_correction_operation_shape CHECK(
  (origin_input_contract='legacy-topic-catalog-v1' AND root_fingerprint IS NULL AND definition_digest IS NULL AND context_digest IS NULL)
  OR COALESCE(origin_input_contract='workspace-topic-classification-v1' AND root_fingerprint~'^sha256:[0-9a-f]{64}$'
   AND definition_digest~'^sha256:[0-9a-f]{64}$' AND context_digest~'^sha256:[0-9a-f]{64}$',false));
ALTER TABLE signal_topic_membership_overrides
 ADD COLUMN origin_input_contract text NOT NULL DEFAULT 'legacy-topic-catalog-v1',
 ADD COLUMN root_fingerprint text,
 ADD COLUMN definition_digest text,
 ADD COLUMN context_digest text,
 ADD COLUMN correction_operation_id uuid REFERENCES signal_topic_membership_operations(id) ON DELETE RESTRICT,
 ADD CONSTRAINT workspace_topic_correction_override_shape CHECK(
  (origin_input_contract='legacy-topic-catalog-v1' AND root_fingerprint IS NULL AND definition_digest IS NULL AND context_digest IS NULL AND correction_operation_id IS NULL)
  OR COALESCE(origin_input_contract='workspace-topic-classification-v1' AND root_fingerprint~'^sha256:[0-9a-f]{64}$'
   AND definition_digest~'^sha256:[0-9a-f]{64}$' AND context_digest~'^sha256:[0-9a-f]{64}$' AND correction_operation_id IS NOT NULL,false));

ALTER TABLE signal_topic_catalog_executions ALTER COLUMN watermark_digest DROP NOT NULL,
 DROP CONSTRAINT workspace_topic_input_shape,
 ADD CONSTRAINT workspace_topic_input_shape CHECK(
  (input_contract='legacy-topic-catalog-v1' AND study_corpus_id IS NOT NULL AND watermark_digest IS NOT NULL
   AND embedding_run_id IS NULL AND preparation_run_id IS NULL AND input_snapshot IS NULL AND input_digest IS NULL)
  OR COALESCE((input_contract='workspace-topic-computation-v1' AND study_corpus_id IS NULL AND watermark_digest IS NOT NULL
   AND intent='search' AND NOT publish_when_ready AND generation_id IS NULL
   AND source_execution_id IS NULL AND embedding_run_id IS NOT NULL AND preparation_run_id IS NOT NULL
   AND input_revision>0 AND embedding_config_digest~'^sha256:[0-9a-f]{64}$'
   AND jsonb_typeof(input_snapshot)='object' AND input_digest~'^sha256:[0-9a-f]{64}$'
   AND expected_chunks>=0 AND processed_roots<=denominator AND processed_chunks<=expected_chunks),false)
  OR COALESCE((input_contract='workspace-topic-classification-v1' AND study_corpus_id IS NULL AND watermark_digest IS NULL
   AND intent='search' AND NOT publish_when_ready AND generation_id IS NOT NULL AND source_execution_id IS NULL
   AND embedding_run_id IS NOT NULL AND preparation_run_id IS NOT NULL AND input_revision>0
   AND embedding_config_digest~'^sha256:[0-9a-f]{64}$' AND jsonb_typeof(input_snapshot)='object'
   AND input_digest~'^sha256:[0-9a-f]{64}$' AND expected_chunks>=0 AND processed_roots<=denominator
   AND processed_chunks<=expected_chunks),false));
CREATE UNIQUE INDEX uq_workspace_classification_execution_generation ON signal_topic_catalog_executions(generation_id)
 WHERE input_contract='workspace-topic-classification-v1';

CREATE FUNCTION signal_workspace_classification_actor_v1(target_workspace uuid,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
  JOIN users actor ON actor.id=target_actor WHERE workspace.id=target_workspace AND workspace.status='active'
  AND brand.status='active' AND actor.status='active' AND actor.user_type='noisia_internal'
  AND actor.primary_role IN('noisia_admin','analyst','founder','admin','kam','insights_manager','ux_data_specialist'))
$$;

-- Same ordered JSON-array lines and newline digest as 0134, without copying text to Node.
CREATE FUNCTION signal_workspace_classification_chunk_digest_v1(chunks jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=public,extensions,pg_temp AS $$
 SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
  '['||(ordinality-1)::text||','||(value->>'start')::bigint::text||','||(value->>'end')::bigint::text
   ||','||to_jsonb(value->>'sha256')::text||']'||chr(10),'' ORDER BY ordinality),''),'UTF8')),'hex')
 FROM jsonb_array_elements(chunks->'chunks') WITH ORDINALITY
$$;

CREATE FUNCTION guard_workspace_classification_generation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE embedded signal_workspace_embedding_runs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.input_contract='workspace-topic-classification-v1' THEN RAISE EXCEPTION 'workspace_classification_history_immutable' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-ARRAY['status','finalized_digest','finalized_at']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['status','finalized_digest','finalized_at']) THEN
  RAISE EXCEPTION 'workspace_classification_input_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.input_contract<>'workspace-topic-classification-v1' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO embedded FROM signal_workspace_embedding_runs WHERE id=NEW.embedding_run_id AND workspace_id=NEW.workspace_id AND input_contract='corpus';
  IF embedded.id IS NULL OR embedded.status<>'completed' OR embedded.preparation_run_id<>NEW.preparation_run_id
   OR embedded.input_revision<>NEW.input_revision OR NEW.denominator<>(embedded.counts->>'eligible_roots')::bigint
   OR (embedded.counts->>'completed_roots')::bigint<>NEW.denominator
   OR embedded.config_digest IS DISTINCT FROM NEW.input_snapshot->'identity'->>'embedding_config_digest'
   OR NEW.input_digest<>'sha256:'||encode(sha256(convert_to(NEW.input_snapshot::text,'UTF8')),'hex')
   OR NOT COALESCE(NEW.input_snapshot->>'contract_version'='workspace-topic-classification-v1'
    AND NEW.input_snapshot->'identity'->>'contract_version'='signal-workspace-classification-v1'
    AND NEW.input_snapshot->'identity'->>'workspace_id'=NEW.workspace_id::text
    AND NEW.input_snapshot->'identity'->>'catalog_digest'=NEW.identity_catalog_digest
    AND jsonb_typeof(NEW.input_snapshot->'topics')='array',false)
   OR NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id)
   OR NOT EXISTS(SELECT 1 FROM signal_classification_operations op WHERE op.id=NEW.operation_id AND op.workspace_id=NEW.workspace_id
    AND op.actor_user_id=NEW.created_by_user_id AND op.operation_kind='create-generation' AND op.status='in_progress')
   OR NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state state WHERE state.workspace_id=NEW.workspace_id AND state.input_revision=NEW.input_revision)
   OR NEW.policy_valid_until IS DISTINCT FROM embedded.policy_valid_until
   OR (NEW.policy_valid_until IS NOT NULL AND NEW.policy_valid_until<=clock_timestamp())
   OR (NEW.source_generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_classification_generations prior
    WHERE prior.id=NEW.source_generation_id AND prior.workspace_id=NEW.workspace_id AND prior.input_contract=NEW.input_contract
    AND prior.status='ready' AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item WHERE item.generation_id=prior.id AND item.resolution_state='error'))) THEN
   RAISE EXCEPTION 'workspace_classification_input_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_classification_generation BEFORE INSERT OR UPDATE OR DELETE ON signal_classification_generations
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_classification_generation_v1();

CREATE FUNCTION guard_workspace_classification_execution_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE generation signal_classification_generations%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.input_contract='workspace-topic-classification-v1' THEN RAISE EXCEPTION 'workspace_classification_history_immutable' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.input_contract='workspace-topic-classification-v1' THEN
  IF (to_jsonb(OLD)-ARRAY['status','progress','result_summary','error_code','heartbeat_at','started_at','completed_at','updated_at',
   'execution_token','execution_expires_at','cursor_root_id','processed_roots','processed_chunks','dispatch_generation']) IS DISTINCT FROM
   (to_jsonb(NEW)-ARRAY['status','progress','result_summary','error_code','heartbeat_at','started_at','completed_at','updated_at',
   'execution_token','execution_expires_at','cursor_root_id','processed_roots','processed_chunks','dispatch_generation'])
   OR OLD.status='ready' THEN RAISE EXCEPTION 'workspace_classification_input_immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.input_contract<>'workspace-topic-classification-v1' THEN RETURN NEW; END IF;
 SELECT * INTO generation FROM signal_classification_generations WHERE id=NEW.generation_id;
 IF generation.workspace_id IS DISTINCT FROM NEW.workspace_id OR generation.input_contract<>NEW.input_contract
  OR generation.taxonomy_profile_id<>NEW.taxonomy_profile_id OR generation.input_digest<>NEW.input_digest
  OR generation.input_snapshot<>NEW.input_snapshot OR generation.denominator<>NEW.denominator
  OR generation.preparation_run_id<>NEW.preparation_run_id OR generation.embedding_run_id<>NEW.embedding_run_id
  OR generation.input_revision<>NEW.input_revision OR generation.created_by_user_id<>NEW.actor_user_id THEN
  RAISE EXCEPTION 'workspace_classification_execution_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status='ready' AND (generation.status<>'ready' OR NEW.processed_roots<>NEW.denominator
  OR NEW.completed_at IS NULL OR (SELECT count(*) FROM signal_classification_generation_items WHERE generation_id=generation.id)<>NEW.denominator) THEN
  RAISE EXCEPTION 'workspace_classification_coverage_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_classification_execution BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_catalog_executions
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_classification_execution_v1();

CREATE FUNCTION guard_workspace_classification_correction_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
DECLARE op signal_topic_membership_operations%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.origin_input_contract='workspace-topic-classification-v1' THEN RAISE EXCEPTION 'workspace_classification_correction_immutable' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_TABLE_NAME='signal_topic_membership_operations' AND TG_OP='UPDATE' AND OLD.origin_input_contract='workspace-topic-classification-v1' THEN
  RAISE EXCEPTION 'workspace_classification_correction_immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND OLD.origin_input_contract='workspace-topic-classification-v1' AND NEW.origin_input_contract<>OLD.origin_input_contract THEN
  RAISE EXCEPTION 'workspace_classification_correction_origin_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.origin_input_contract<>'workspace-topic-classification-v1' THEN RETURN NEW; END IF;
 IF NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id) THEN
  RAISE EXCEPTION 'workspace_classification_forbidden' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='signal_topic_membership_operations' THEN
  SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id
   AND input_contract IN('workspace-topic-computation-v1','workspace-topic-classification-v1');
  IF execution.id IS NULL OR NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_items item
   WHERE item.run_id=execution.preparation_run_id AND item.root_id=NEW.canonical_root_id AND item.fingerprint=NEW.root_fingerprint)
   OR execution.input_snapshot->>'context_digest' IS DISTINCT FROM NEW.context_digest
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(execution.input_snapshot->'topics') topic
    WHERE topic->'definition'->>'term_key'=NEW.term_key AND topic->'definition'->>'definition_digest'=NEW.definition_digest
     AND (topic->'definition'->>'definition_revision')::int=NEW.definition_revision) THEN
   RAISE EXCEPTION 'workspace_classification_correction_binding_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO op FROM signal_topic_membership_operations WHERE id=NEW.correction_operation_id;
  IF op.id IS NULL OR op.origin_input_contract<>NEW.origin_input_contract OR op.workspace_id<>NEW.workspace_id
   OR op.actor_user_id<>NEW.actor_user_id OR op.canonical_root_id<>NEW.canonical_root_id OR op.term_key<>NEW.term_key
   OR op.disposition<>NEW.disposition OR op.definition_revision<>NEW.definition_revision
   OR op.root_fingerprint<>NEW.root_fingerprint OR op.definition_digest<>NEW.definition_digest OR op.context_digest<>NEW.context_digest THEN
   RAISE EXCEPTION 'workspace_classification_correction_binding_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_classification_correction_operation BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_membership_operations
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_classification_correction_v1();
CREATE TRIGGER trg_workspace_classification_correction_override BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_membership_overrides
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_classification_correction_v1();

-- Preserve all legacy validation; only native root summaries permit mixed Topic dispositions.
CREATE OR REPLACE FUNCTION validate_signal_classification_assignment_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE item signal_classification_generation_items%ROWTYPE;
DECLARE profile_taxonomy uuid; DECLARE term_taxonomy uuid;
DECLARE policy signal_classification_approval_policies%ROWTYPE;
BEGIN
  SELECT * INTO generation FROM signal_classification_generations WHERE id=NEW.generation_id;
  SELECT * INTO item FROM signal_classification_generation_items WHERE id=NEW.generation_item_id;
  SELECT taxonomy_id INTO profile_taxonomy FROM signal_taxonomy_profiles
   WHERE id=NEW.taxonomy_profile_id AND workspace_id=NEW.workspace_id AND (status='active' OR generation.input_contract='workspace-topic-classification-v1' AND status IN('draft','activating'));
  IF generation.id IS NULL OR generation.status<>'open'
     OR generation.workspace_id<>NEW.workspace_id
     OR generation.taxonomy_profile_id<>NEW.taxonomy_profile_id
     OR item.id IS NULL OR item.workspace_id<>NEW.workspace_id
     OR item.generation_id<>NEW.generation_id OR item.canonical_root_id<>NEW.canonical_root_id
     OR (generation.input_contract='legacy-classification-v1' AND item.resolution_state<>NEW.disposition)
     OR NOT EXISTS(SELECT 1 FROM mentions mention WHERE mention.id=NEW.canonical_root_id
       AND mention.workspace_id=NEW.workspace_id AND mention.canonical_mention_id=mention.id) THEN
    RAISE EXCEPTION 'Classification assignment scope is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.taxonomy_term_id IS NOT NULL THEN
    SELECT taxonomy_id INTO term_taxonomy FROM taxonomy_terms
      WHERE id=NEW.taxonomy_term_id AND (status='active' OR generation.input_contract='workspace-topic-classification-v1' AND status='candidate');
    IF term_taxonomy IS DISTINCT FROM profile_taxonomy THEN
      RAISE EXCEPTION 'Classification term is incompatible or retired.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.resolution_method='labeling_function' AND NOT EXISTS(
    SELECT 1 FROM signal_labeling_function_versions lf
    WHERE lf.id=NEW.labeling_function_version_id AND lf.status='approved'
      AND (lf.owner_kind='platform' OR lf.workspace_id=NEW.workspace_id)
      AND lf.taxonomy_term_id=NEW.taxonomy_term_id
      AND lf.effective_from<=NEW.created_at
      AND (lf.effective_to IS NULL OR lf.effective_to>NEW.created_at)
  ) THEN RAISE EXCEPTION 'Labeling function authority is invalid.' USING ERRCODE='23514'; END IF;
  IF NEW.resolution_method='model' AND NOT EXISTS(
    SELECT 1 FROM tagging_model_versions model
    WHERE model.id=NEW.model_version_id
      AND model.registry_contract_version='signal-tagging-model-registry-v1'
      AND model.taxonomy_profile_id=NEW.taxonomy_profile_id
  ) THEN RAISE EXCEPTION 'Model assignment requires a registered compatible artifact.' USING ERRCODE='23514'; END IF;
  IF NEW.disposition='approved' AND NEW.resolution_method<>'human' THEN
    SELECT * INTO policy FROM signal_classification_approval_policies
      WHERE id=NEW.approval_policy_id AND workspace_id=NEW.workspace_id
        AND taxonomy_profile_id=NEW.taxonomy_profile_id AND status='approved'
        AND effective_from<=NEW.created_at AND (effective_to IS NULL OR effective_to>NEW.created_at);
    IF policy.id IS NULL OR policy.authority_kind<>NEW.resolution_method
       OR (NEW.resolution_method='labeling_function'
         AND policy.labeling_function_version_id<>NEW.labeling_function_version_id)
       OR (NEW.resolution_method='model' AND policy.model_version_id<>NEW.model_version_id) THEN
      RAISE EXCEPTION 'Approved classification requires matching human or approved policy authority.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.disposition='approved' AND NEW.resolution_method='model' AND (
    SELECT event.status FROM signal_tagging_model_version_events event
    WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=NEW.model_version_id
      AND event.effective_at<=NEW.created_at
    ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1
  ) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Approved model assignment requires an effective approved model version.' USING ERRCODE='23514';
  END IF;
  IF NEW.resolution_method='human'
     AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.decided_by_user_id) THEN
    RAISE EXCEPTION 'Human classification actor is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.disposition<>'approved' AND NEW.approval_policy_id IS NOT NULL THEN
    RAISE EXCEPTION 'Non-approved assignments cannot claim approval authority.' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_assignment_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM signal_classification_assignments prior
    WHERE prior.id=NEW.supersedes_assignment_id AND prior.workspace_id=NEW.workspace_id
      AND prior.canonical_root_id=NEW.canonical_root_id
      AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
  ) THEN RAISE EXCEPTION 'Assignment supersession is incompatible.' USING ERRCODE='23514'; END IF;
  IF generation.input_contract='workspace-topic-classification-v1' THEN
    PERFORM signal_workspace_classification_assignment_authority_v1(NEW,generation,item);
  ELSIF NEW.definition_digest IS NOT NULL OR NEW.correction_operation_id IS NOT NULL OR NEW.source_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_classification_legacy_binding_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION signal_workspace_classification_assignment_authority_v1(
 assignment signal_classification_assignments,generation signal_classification_generations,item signal_classification_generation_items)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE topic jsonb; DECLARE prior signal_classification_assignments%ROWTYPE;
BEGIN
 SELECT value INTO topic FROM jsonb_array_elements(generation.input_snapshot->'topics')
  WHERE value->>'taxonomy_term_id'=assignment.taxonomy_term_id::text;
 IF topic IS NULL OR assignment.definition_digest IS DISTINCT FROM topic->'definition'->>'definition_digest'
  OR assignment.definition_revision IS DISTINCT FROM (topic->'definition'->>'definition_revision')::int
  OR assignment.resolution_method='exact' OR assignment.disposition='abstained' OR assignment.supersedes_assignment_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM signal_classification_operations op WHERE op.id=assignment.operation_id
   AND op.workspace_id=assignment.workspace_id AND op.operation_kind='append-results' AND op.status='in_progress') THEN
  RAISE EXCEPTION 'workspace_classification_assignment_binding_invalid' USING ERRCODE='23514'; END IF;
 IF assignment.resolution_method='human' THEN
  IF assignment.approval_policy_id IS NOT NULL OR NOT EXISTS(
   SELECT 1 FROM signal_topic_membership_operations op JOIN signal_topic_membership_overrides current
    ON current.correction_operation_id=op.id AND current.origin_input_contract='workspace-topic-classification-v1'
   WHERE op.id=assignment.correction_operation_id AND op.workspace_id=assignment.workspace_id
    AND op.canonical_root_id=assignment.canonical_root_id AND op.actor_user_id=assignment.decided_by_user_id
    AND op.term_key=topic->'definition'->>'term_key' AND op.definition_revision=assignment.definition_revision
    AND op.definition_digest=assignment.definition_digest AND op.root_fingerprint=item.root_fingerprint
    AND op.context_digest=generation.input_snapshot->>'context_digest'
    AND ((op.disposition='belongs' AND assignment.disposition='approved') OR (op.disposition='excluded' AND assignment.disposition='rejected'))
    AND signal_workspace_classification_actor_v1(op.workspace_id,op.actor_user_id)) THEN
   RAISE EXCEPTION 'workspace_classification_human_authority_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  IF assignment.correction_operation_id IS NOT NULL OR assignment.decided_by_user_id IS NOT NULL THEN
   RAISE EXCEPTION 'workspace_classification_actor_is_not_model_authority' USING ERRCODE='23514'; END IF;
  IF assignment.resolution_method='model' AND NOT EXISTS(SELECT 1 FROM tagging_model_versions model
   WHERE model.id=assignment.model_version_id AND model.artifact_digest=generation.input_snapshot->'identity'->>'engine_artifact_digest'
    AND model.configuration->'workspace_classification_identity'=generation.input_snapshot->'identity') THEN
   RAISE EXCEPTION 'workspace_classification_model_identity_invalid' USING ERRCODE='23514'; END IF;
  IF assignment.resolution_method='labeling_function' AND NOT EXISTS(SELECT 1 FROM signal_labeling_function_versions lf
   WHERE lf.id=assignment.labeling_function_version_id AND lf.input_contract->'workspace_classification_identity'=generation.input_snapshot->'identity') THEN
   RAISE EXCEPTION 'workspace_classification_labeling_identity_invalid' USING ERRCODE='23514'; END IF;
  IF assignment.disposition='approved' AND NOT EXISTS(SELECT 1 FROM signal_classification_approval_policies policy
   WHERE policy.id=assignment.approval_policy_id AND policy.definition_hash=generation.input_snapshot->'identity'->>'decision_policy_digest') THEN
   RAISE EXCEPTION 'workspace_classification_policy_identity_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF assignment.source_assignment_id IS NOT NULL THEN
  SELECT * INTO prior FROM signal_classification_assignments WHERE id=assignment.source_assignment_id;
  IF prior.id IS NULL OR prior.workspace_id<>assignment.workspace_id OR prior.canonical_root_id<>assignment.canonical_root_id
   OR prior.generation_item_id IS DISTINCT FROM item.source_generation_item_id
   OR (to_jsonb(prior)-ARRAY['id','generation_id','generation_item_id','taxonomy_profile_id','taxonomy_term_id','operation_id','created_at','source_assignment_id'])
    IS DISTINCT FROM (to_jsonb(assignment)-ARRAY['id','generation_id','generation_item_id','taxonomy_profile_id','taxonomy_term_id','operation_id','created_at','source_assignment_id']) THEN
   RAISE EXCEPTION 'workspace_classification_copy_authority_invalid' USING ERRCODE='23514'; END IF;
 END IF;
END; $$;

CREATE FUNCTION guard_workspace_classification_item_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE generation signal_classification_generations%ROWTYPE; DECLARE root signal_corpus_preparation_items%ROWTYPE;
DECLARE prior signal_classification_generation_items%ROWTYPE; DECLARE chunks jsonb;
BEGIN
 SELECT * INTO generation FROM signal_classification_generations WHERE id=NEW.generation_id;
 IF generation.input_contract<>'workspace-topic-classification-v1' THEN
  IF NEW.outcome_metadata IS NOT NULL OR NEW.reuse_key IS NOT NULL OR NEW.source_generation_item_id IS NOT NULL THEN
   RAISE EXCEPTION 'workspace_classification_legacy_binding_invalid' USING ERRCODE='23514'; END IF; RETURN NEW;
 END IF;
 SELECT * INTO root FROM signal_corpus_preparation_items WHERE run_id=generation.preparation_run_id AND workspace_id=NEW.workspace_id
  AND root_id=NEW.canonical_root_id AND disposition='eligible';
 SELECT asset.chunks INTO chunks FROM signal_corpus_text_assets asset WHERE asset.workspace_id=NEW.workspace_id
  AND asset.text_sha256=root.asset_sha256 AND asset.chunk_policy_version=root.chunk_policy_version;
 IF root.root_id IS NULL OR NEW.root_fingerprint IS DISTINCT FROM root.fingerprint OR NEW.correction_digest IS NULL OR NEW.reuse_key IS NULL
  OR NEW.correction_digest IS DISTINCT FROM signal_workspace_classification_root_correction_digest_v1(NEW.workspace_id,NEW.canonical_root_id,root.fingerprint,
   generation.input_snapshot->>'context_digest',generation.input_snapshot->'topics')
  OR NOT COALESCE(jsonb_typeof(NEW.outcome_metadata)='object' AND NEW.outcome_metadata->>'resolution_state'=NEW.resolution_state
   AND NEW.outcome_metadata->'root'->>'root_id'=NEW.canonical_root_id::text
   AND NEW.outcome_metadata->'root'->>'fingerprint'=NEW.root_fingerprint
   AND NEW.outcome_metadata->'root'->>'correction_digest'=NEW.correction_digest
   AND NEW.outcome_metadata->>'reuse_key'=NEW.reuse_key
   AND (NEW.outcome_metadata->'coverage'->>'expected_chunks')::int=jsonb_array_length(chunks->'chunks')
   AND NEW.outcome_metadata->'coverage'->>'chunk_coverage_digest'=signal_workspace_classification_chunk_digest_v1(chunks)
   AND (NEW.outcome_metadata->'coverage'->>'processed_chunks')::int BETWEEN 0 AND jsonb_array_length(chunks->'chunks')
   AND (NEW.resolution_state='error' OR (NEW.outcome_metadata->'coverage'->>'processed_chunks')::int=jsonb_array_length(chunks->'chunks')),false) THEN
  RAISE EXCEPTION 'workspace_classification_root_binding_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.source_generation_item_id IS NOT NULL THEN
  SELECT * INTO prior FROM signal_classification_generation_items WHERE id=NEW.source_generation_item_id;
  IF prior.id IS NULL OR prior.workspace_id<>NEW.workspace_id OR prior.canonical_root_id<>NEW.canonical_root_id
   OR prior.reuse_key<>NEW.reuse_key OR prior.resolution_state='error' OR prior.item_digest<>NEW.item_digest
   OR prior.outcome_metadata<>NEW.outcome_metadata
   OR NOT EXISTS(SELECT 1 FROM signal_classification_generations source WHERE source.id=prior.generation_id AND source.status='ready'
    AND source.input_contract='workspace-topic-classification-v1'
    AND source.input_snapshot->'identity'=generation.input_snapshot->'identity'
    AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items bad WHERE bad.generation_id=source.id AND bad.resolution_state='error')) THEN
   RAISE EXCEPTION 'workspace_classification_copy_identity_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_classification_item BEFORE INSERT ON signal_classification_generation_items
 FOR EACH ROW EXECUTE FUNCTION guard_workspace_classification_item_v1();

-- Existing legacy current/projector functions require a real study_corpus_id;
-- they remain closed to this new input contract. A new native reader chooses
-- the last complete usable generation independently of a newer failed child.
COMMENT ON COLUMN signal_classification_assignments.source_assignment_id IS
 'Immutable carry-forward lineage; never global supersession of the last complete generation.';
COMMENT ON COLUMN signal_classification_generation_items.outcome_metadata IS
 'Sparse root outcome without decisions or text. Missing assignment is not rejection. An error root may retain verified assignments.';

REVOKE ALL ON FUNCTION signal_workspace_classification_actor_v1(uuid,uuid),signal_workspace_classification_chunk_digest_v1(jsonb),
 guard_workspace_classification_generation_v1(),guard_workspace_classification_execution_v1(),guard_workspace_classification_correction_v1(),
 signal_workspace_classification_assignment_authority_v1(signal_classification_assignments,signal_classification_generations,signal_classification_generation_items),
 guard_workspace_classification_item_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_workspace_classification_actor_v1(uuid,uuid),signal_workspace_classification_chunk_digest_v1(jsonb),guard_workspace_classification_generation_v1(),guard_workspace_classification_execution_v1(),guard_workspace_classification_correction_v1(),signal_workspace_classification_assignment_authority_v1(signal_classification_assignments,signal_classification_generations,signal_classification_generation_items),guard_workspace_classification_item_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END; $$;

-- Used by copy preflight and finalization as well as the native reader. A saved
-- receipt remains available historically, but revoked approval cannot be used.
CREATE FUNCTION signal_workspace_classification_assignment_current_v1(
 assignment signal_classification_assignments,target_generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(
  SELECT 1 FROM taxonomy_terms term JOIN jsonb_array_elements(target_generation.input_snapshot->'topics') topic
   ON topic->>'taxonomy_term_id'=term.id::text
  JOIN signal_classification_generation_items item ON item.id=assignment.generation_item_id
  WHERE term.term_key=(SELECT source_term.term_key FROM taxonomy_terms source_term WHERE source_term.id=assignment.taxonomy_term_id)
   AND topic->'definition'->>'definition_digest'=assignment.definition_digest
   AND (topic->'definition'->>'definition_revision')::int=assignment.definition_revision
   AND term.status IN('candidate','active')
   AND CASE WHEN assignment.resolution_method='human' THEN EXISTS(
    SELECT 1 FROM signal_topic_membership_operations op JOIN signal_topic_membership_overrides current ON current.correction_operation_id=op.id
     WHERE op.id=assignment.correction_operation_id AND op.workspace_id=target_generation.workspace_id
      AND op.actor_user_id=assignment.decided_by_user_id AND op.canonical_root_id=assignment.canonical_root_id
      AND op.term_key=term.term_key AND op.definition_digest=assignment.definition_digest AND op.definition_revision=assignment.definition_revision
      AND op.context_digest=target_generation.input_snapshot->>'context_digest' AND op.root_fingerprint=item.root_fingerprint
      AND ((op.disposition='belongs' AND assignment.disposition='approved') OR (op.disposition='excluded' AND assignment.disposition='rejected'))
      AND current.origin_input_contract='workspace-topic-classification-v1'
      AND signal_workspace_classification_actor_v1(op.workspace_id,op.actor_user_id))
   ELSE assignment.taxonomy_profile_id=target_generation.taxonomy_profile_id
    AND CASE WHEN assignment.resolution_method='model' THEN EXISTS(SELECT 1 FROM tagging_model_versions model
     WHERE model.id=assignment.model_version_id AND model.registry_contract_version='signal-tagging-model-registry-v1'
      AND model.taxonomy_profile_id=target_generation.taxonomy_profile_id
      AND model.artifact_digest=target_generation.input_snapshot->'identity'->>'engine_artifact_digest'
      AND model.configuration->'workspace_classification_identity'=target_generation.input_snapshot->'identity')
    WHEN assignment.resolution_method='labeling_function' THEN EXISTS(SELECT 1 FROM signal_labeling_function_versions lf
     WHERE lf.id=assignment.labeling_function_version_id AND lf.status='approved' AND lf.taxonomy_term_id=term.id
      AND lf.effective_from<=now() AND (lf.effective_to IS NULL OR lf.effective_to>now())
      AND lf.input_contract->'workspace_classification_identity'=target_generation.input_snapshot->'identity') ELSE false END
    AND (assignment.disposition<>'approved' OR EXISTS(SELECT 1 FROM signal_classification_approval_policies policy
     WHERE policy.id=assignment.approval_policy_id AND policy.workspace_id=target_generation.workspace_id
      AND policy.taxonomy_profile_id=target_generation.taxonomy_profile_id AND policy.status='approved'
      AND policy.effective_from<=now() AND (policy.effective_to IS NULL OR policy.effective_to>now())
      AND policy.definition_hash=target_generation.input_snapshot->'identity'->>'decision_policy_digest'
      AND policy.authority_kind=assignment.resolution_method
      AND (assignment.resolution_method<>'model' OR policy.model_version_id=assignment.model_version_id
       AND (SELECT status FROM signal_tagging_model_version_events event WHERE event.model_version_id=assignment.model_version_id
        AND event.workspace_id=target_generation.workspace_id AND event.effective_at<=now()
        ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved')
      AND (assignment.resolution_method<>'labeling_function' OR policy.labeling_function_version_id=assignment.labeling_function_version_id)))
   END),false)
$$;
REVOKE ALL ON FUNCTION signal_workspace_classification_assignment_current_v1(signal_classification_assignments,signal_classification_generations) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON FUNCTION signal_workspace_classification_assignment_current_v1(signal_classification_assignments,signal_classification_generations) FROM %I',r);
END IF; END LOOP; END; $$;
CREATE INDEX idx_workspace_classification_corrections_root ON signal_topic_membership_overrides(workspace_id,canonical_root_id,term_key)
 WHERE origin_input_contract='workspace-topic-classification-v1';

CREATE FUNCTION signal_workspace_classification_root_correction_digest_v1(workspace uuid,root uuid,fingerprint text,context_digest text,topics jsonb)
RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(jsonb_build_array(correction.term_key,correction.correction_operation_id,
  correction.disposition,correction.definition_revision,correction.definition_digest)::text,'' ORDER BY correction.term_key),''),'UTF8')),'hex')
 FROM signal_topic_membership_overrides correction WHERE correction.workspace_id=workspace AND correction.canonical_root_id=root
  AND correction.origin_input_contract='workspace-topic-classification-v1' AND correction.root_fingerprint=fingerprint
  AND correction.context_digest=signal_workspace_classification_root_correction_digest_v1.context_digest
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(topics) topic WHERE topic->'definition'->>'term_key'=correction.term_key
   AND topic->'definition'->>'definition_digest'=correction.definition_digest
   AND (topic->'definition'->>'definition_revision')::int=correction.definition_revision)
$$;
REVOKE ALL ON FUNCTION signal_workspace_classification_root_correction_digest_v1(uuid,uuid,text,text,jsonb) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON FUNCTION signal_workspace_classification_root_correction_digest_v1(uuid,uuid,text,text,jsonb) FROM %I',r);
END IF; END LOOP; END; $$;

-- The legacy finalizer accepts only its original population authority.
CREATE OR REPLACE FUNCTION finalize_signal_classification_generation_v1(
  target_workspace_id uuid,
  target_generation_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_digest text
)
RETURNS TABLE(generation_id uuid,finalized_digest text,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE expected_digest text; DECLARE actual_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_generation_id::text||':finalize',0));
  SELECT * INTO generation FROM signal_classification_generations
    WHERE id=target_generation_id AND workspace_id=target_workspace_id AND input_contract='legacy-classification-v1' FOR UPDATE;
  IF generation.id IS NULL OR NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Classification finalization authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'finalize-generation',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.request_digest<>target_request_digest OR operation.operation_kind<>'finalize-generation'
     OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    generation_id:=generation.id; finalized_digest:=generation.finalized_digest; created:=false; RETURN NEXT; RETURN;
  END IF;
  IF generation.status<>'open' THEN RAISE EXCEPTION 'Classification generation is already final.' USING ERRCODE='23514'; END IF;
  IF generation.input_watermark_digest IS DISTINCT FROM
      signal_classification_watermark_digest_v1(target_workspace_id,generation.study_corpus_id) THEN
    RAISE EXCEPTION 'Classification generation watermark became stale before finalization.' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::int,
    'sha256:'||encode(digest(convert_to(COALESCE(string_agg(item_digest,'' ORDER BY canonical_root_id),'empty'),'UTF8'),'sha256'),'hex')
    INTO actual_count,expected_digest FROM signal_classification_generation_items item
    WHERE item.generation_id=generation.id;
  IF actual_count<>generation.denominator THEN
    RAISE EXCEPTION 'Classification denominator is incomplete.' USING ERRCODE='23514';
  END IF;
  UPDATE signal_classification_generations SET status='ready',finalized_digest=expected_digest,finalized_at=now()
    WHERE id=generation.id RETURNING * INTO generation;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'generation-finalized','generation',generation.id,
    generation.definition_digest,generation.finalized_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||generation.finalized_digest,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('generation_id',generation.id,'finalized_digest',generation.finalized_digest)
  WHERE id=operation.id;
  generation_id:=generation.id; finalized_digest:=generation.finalized_digest; created:=true; RETURN NEXT;
END; $$;
