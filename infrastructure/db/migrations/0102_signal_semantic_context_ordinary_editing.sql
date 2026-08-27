-- 0102 — append-only ordinary Semantic Context editing.
-- Existing history is unchanged. Save/undo/archive/restore are one closed management command.

ALTER TABLE signal_governance_control_operations DROP CONSTRAINT IF EXISTS signal_governance_control_action;
ALTER TABLE signal_governance_control_operations ADD CONSTRAINT signal_governance_control_action CHECK(action IN (
  'create-quality-draft','create-retention-draft','create-licensing-draft','activate-policy',
  'create-provenance-binding-draft','activate-provenance-binding','upsert-identity','update-timezone',
  'reconcile-brand-os','create-source','import-source','reconcile-governed-view','reconcile-strategic-authority',
  'promote-strategic-authority','reconcile-acquisition-plan','promote-acquisition-plan','create-acquisition-query',
  'review-acquisition-query','retire-acquisition-slot','decide-acquisition-reference','retire-competitor',
  'reactivate-competitor','create-competitor','seal-acquisition-import','seal-acquisition-brief',
  'generate-acquisition-queries','authorize-acquisition-benchmark','register-topic-discovery-review',
  'save-topic-discovery-review-draft','save-topic-discovery-outlier-draft','finalize-topic-discovery-review',
  'supersede-topic-discovery-review','create-semantic-context-draft','reconcile-semantic-context-generation',
  'append-semantic-context-proposals','decide-semantic-context-element','bulk-approve-semantic-context-elements',
  'publish-semantic-context-generation','start-semantic-context-proposal-run','retry-semantic-context-proposal-run',
  'revalidate-semantic-context-proposal-run','merge-semantic-context-elements','correct-semantic-context-element',
  'annotate-semantic-context-element','resolve-semantic-context-annotation',
  'repair-semantic-context-annotation-resolution','decide-semantic-context-locale-authority',
  'edit-semantic-context-element-v1'
));

ALTER TABLE signal_semantic_context_events DROP CONSTRAINT IF EXISTS signal_semantic_context_event_kind;
ALTER TABLE signal_semantic_context_events ADD CONSTRAINT signal_semantic_context_event_kind CHECK(event_kind IN (
  'generation_created','generation_reconciled','proposals_appended','element_approved','element_rejected',
  'element_corrected','elements_bulk_approved','elements_merged','review_annotation_created',
  'review_annotation_updated','review_annotation_resolved','locale_authority_decided','generation_published',
  'ordinary_element_save','ordinary_element_undo','ordinary_element_archive','ordinary_element_restore'
));

ALTER TABLE signal_semantic_context_element_versions
  ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active',
  ADD COLUMN ordinary_command_contract_version text,
  ADD COLUMN ordinary_command_action text,
  ADD COLUMN ordinary_command_basis jsonb,
  ADD COLUMN ordinary_command_basis_digest text,
  ADD COLUMN ordinary_command_input_digest text,
  ADD COLUMN ordinary_command_prestate_digest text,
  ADD COLUMN ordinary_command_poststate_digest text;

ALTER TABLE signal_semantic_context_element_versions
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_disposition,
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_origin,
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_decision,
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_lineage;
ALTER TABLE signal_semantic_context_element_versions
  ADD CONSTRAINT signal_semantic_context_element_disposition CHECK(disposition IN ('pending','approved','rejected','merged','archived')),
  ADD CONSTRAINT signal_semantic_context_element_origin CHECK(origin_kind IN ('server_projection','provider_proposal',
    'operator_decision','operator_correction','operator_merge','operator_ordinary')),
  ADD CONSTRAINT signal_semantic_context_element_decision CHECK(
    (disposition='pending' AND decided_by_user_id IS NULL AND decided_at IS NULL)
    OR (disposition IN ('approved','rejected','merged','archived') AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)),
  ADD CONSTRAINT signal_semantic_context_element_lineage CHECK(
    (origin_kind IN ('operator_correction','operator_merge','operator_ordinary') AND supersedes_element_id IS NOT NULL
      AND original_proposal_element_id IS NOT NULL)
    OR origin_kind NOT IN ('operator_correction','operator_merge','operator_ordinary')),
  ADD CONSTRAINT signal_semantic_context_lifecycle_state CHECK(lifecycle_state IN ('active','archived')
    AND ((disposition='archived')=(lifecycle_state='archived'))),
  ADD CONSTRAINT signal_semantic_context_ordinary_all_or_none CHECK(
    (ordinary_command_contract_version IS NULL AND ordinary_command_action IS NULL AND ordinary_command_basis IS NULL
      AND ordinary_command_basis_digest IS NULL AND ordinary_command_input_digest IS NULL
      AND ordinary_command_prestate_digest IS NULL AND ordinary_command_poststate_digest IS NULL)
    OR (ordinary_command_contract_version='edit-semantic-context-element-v1'
      AND ordinary_command_action IN ('save','undo','archive','restore')
      AND jsonb_typeof(ordinary_command_basis)='object'
      AND ordinary_command_basis_digest ~ '^sha256:[0-9a-f]{64}$'
      AND ordinary_command_input_digest ~ '^sha256:[0-9a-f]{64}$'
      AND ordinary_command_prestate_digest ~ '^sha256:[0-9a-f]{64}$'
      AND ordinary_command_poststate_digest ~ '^sha256:[0-9a-f]{64}$'));

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_ordinary_command_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE predecessor signal_semantic_context_element_versions%ROWTYPE;
BEGIN
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
CREATE TRIGGER trg_validate_signal_semantic_context_ordinary_command_v1
  BEFORE INSERT ON signal_semantic_context_element_versions FOR EACH ROW
  EXECUTE FUNCTION validate_signal_semantic_context_ordinary_command_v1();

-- Preserve the complete 0100 event/operation mapping and add only the four ordinary events.
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
    WHEN 'element_corrected' THEN CASE WHEN operation.action='correct-semantic-context-element'
      THEN 'correct-semantic-context-element' ELSE 'decide-semantic-context-element' END
    WHEN 'elements_bulk_approved' THEN 'bulk-approve-semantic-context-elements'
    WHEN 'elements_merged' THEN 'merge-semantic-context-elements'
    WHEN 'review_annotation_created' THEN 'annotate-semantic-context-element'
    WHEN 'review_annotation_updated' THEN CASE
      WHEN operation.action IN ('merge-semantic-context-elements','correct-semantic-context-element')
        THEN operation.action ELSE 'annotate-semantic-context-element' END
    WHEN 'review_annotation_resolved' THEN CASE
      WHEN operation.action IN ('merge-semantic-context-elements','correct-semantic-context-element',
        'resolve-semantic-context-annotation','repair-semantic-context-annotation-resolution')
        THEN operation.action ELSE 'annotate-semantic-context-element' END
    WHEN 'locale_authority_decided' THEN 'decide-semantic-context-locale-authority'
    WHEN 'ordinary_element_save' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_undo' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_archive' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_restore' THEN 'edit-semantic-context-element-v1'
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.action IS DISTINCT FROM expected_action
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- Let the dedicated ordinary validator own applicability changes for this one closed action.
CREATE OR REPLACE FUNCTION validate_signal_semantic_context_locale_decision_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE predecessor signal_semantic_context_element_versions%ROWTYPE;
DECLARE decision_actor users%ROWTYPE;basis jsonb;expected_authority jsonb;expected_element_digest text;
BEGIN
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

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_ordinary_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE successor_count integer;event_count integer;
BEGIN
  IF NEW.action<>'edit-semantic-context-element-v1' OR NEW.status<>'completed' THEN RETURN NEW; END IF;
  SELECT count(*) INTO successor_count
  FROM signal_semantic_context_element_versions element WHERE element.operation_id=NEW.id AND element.origin_kind='operator_ordinary';
  SELECT count(*) INTO event_count FROM signal_semantic_context_events event WHERE event.operation_id=NEW.id
    AND event.event_kind IN ('ordinary_element_save','ordinary_element_undo','ordinary_element_archive','ordinary_element_restore');
  IF successor_count NOT IN (0,1) OR event_count<>successor_count
     OR jsonb_typeof(NEW.semantic_context_decision_input)<>'object'
     OR NEW.semantic_context_decision_input->>'contract_version'<>'edit-semantic-context-element-v1'
     OR jsonb_typeof(NEW.result)<>'object' THEN
    RAISE EXCEPTION 'Ordinary Semantic Context operation is incomplete.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_ordinary_operation_v1
  AFTER INSERT OR UPDATE ON signal_governance_control_operations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_ordinary_operation_v1();

CREATE FUNCTION validate_signal_semantic_context_ordinary_cohort_from_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_operation_id uuid;operation signal_governance_control_operations%ROWTYPE;
DECLARE successor_count integer;event_count integer;
BEGIN
  target_operation_id:=CASE WHEN TG_OP='DELETE' THEN OLD.operation_id ELSE NEW.operation_id END;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=target_operation_id;
  IF operation.action<>'edit-semantic-context-element-v1' OR operation.status<>'completed' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT count(*) INTO successor_count FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=operation.id AND element.origin_kind='operator_ordinary';
  SELECT count(*) INTO event_count FROM signal_semantic_context_events event WHERE event.operation_id=operation.id
    AND event.event_kind IN ('ordinary_element_save','ordinary_element_undo','ordinary_element_archive','ordinary_element_restore');
  IF successor_count NOT IN (0,1) OR event_count<>successor_count THEN
    RAISE EXCEPTION 'Ordinary Semantic Context operation/event cohort is incomplete.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_ordinary_event_cohort_v1
  AFTER INSERT OR DELETE ON signal_semantic_context_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_ordinary_cohort_from_event_v1();

CREATE FUNCTION validate_signal_semantic_context_ordinary_cohort_from_element_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_operation_id uuid;operation signal_governance_control_operations%ROWTYPE;
DECLARE successor_count integer;event_count integer;
BEGIN
  target_operation_id:=CASE WHEN TG_OP='DELETE' THEN OLD.operation_id ELSE NEW.operation_id END;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=target_operation_id;
  IF operation.action<>'edit-semantic-context-element-v1' OR operation.status<>'completed' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT count(*) INTO successor_count FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=operation.id AND element.origin_kind='operator_ordinary';
  SELECT count(*) INTO event_count FROM signal_semantic_context_events event WHERE event.operation_id=operation.id
    AND event.event_kind IN ('ordinary_element_save','ordinary_element_undo','ordinary_element_archive','ordinary_element_restore');
  IF successor_count NOT IN (0,1) OR event_count<>successor_count THEN
    RAISE EXCEPTION 'Ordinary Semantic Context operation/element cohort is incomplete.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_ordinary_element_cohort_v1
  AFTER INSERT OR DELETE ON signal_semantic_context_element_versions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_ordinary_cohort_from_element_v1();

CREATE FUNCTION signal_semantic_context_safe_positive_int_v1(value jsonb)
RETURNS integer LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF jsonb_typeof(value)<>'number' OR value::text!~'^[1-9][0-9]*$' THEN RETURN NULL; END IF;
  BEGIN RETURN value::text::integer;
  EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN NULL;
  END;
END; $$;

CREATE FUNCTION signal_semantic_context_ordinary_authority_valid_v1(target_element_id uuid)
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
    AND operation.semantic_context_decision_input->>'generation_key'=generation.generation_key
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
      AND operation.semantic_context_decision_input->'values'->'scope' IS NOT DISTINCT FROM to_jsonb(element.scope)
      AND operation.semantic_context_decision_input->'values'->'relation_kind' IS NOT DISTINCT FROM to_jsonb(element.relation_kind)
      AND operation.semantic_context_decision_input->'values'->'relation_target_key' IS NOT DISTINCT FROM to_jsonb(element.relation_target_key)))
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
    AND ((element.ordinary_command_action='archive' AND predecessor.disposition='approved'
        AND predecessor.lifecycle_state='active' AND element.disposition='archived' AND element.lifecycle_state='archived')
      OR (element.ordinary_command_action IN ('save','undo') AND predecessor.disposition='approved'
        AND predecessor.lifecycle_state='active' AND element.disposition='approved' AND element.lifecycle_state='active')
      OR (element.ordinary_command_action='restore' AND predecessor.disposition='archived'
        AND predecessor.lifecycle_state='archived' AND element.disposition='approved' AND element.lifecycle_state='active'));
END; $$;

ALTER FUNCTION signal_semantic_context_locale_authority_valid_v1(uuid)
  RENAME TO signal_semantic_context_locale_authority_valid_pre_0102;
CREATE FUNCTION signal_semantic_context_locale_authority_valid_v1(target_element_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE origin signal_semantic_context_element_versions%ROWTYPE;DECLARE decision_origin signal_semantic_context_element_versions%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;DECLARE expected_basis jsonb;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=element.generation_id;
  IF element.disposition<>'approved' THEN RETURN false; END IF;
  IF element.locale_decision_contract_version IS NOT NULL THEN
    SELECT * INTO decision_origin FROM signal_semantic_context_element_versions decision
      WHERE decision.generation_id=element.generation_id AND decision.element_key=element.element_key
        AND decision.element_digest=element.locale_decision_poststate_digest ORDER BY decision.element_version LIMIT 1;
    IF decision_origin.origin_kind<>'operator_ordinary' THEN
      RETURN signal_semantic_context_locale_authority_valid_pre_0102(target_element_id);
    END IF;
    SELECT * INTO operation FROM signal_governance_control_operations WHERE id=decision_origin.operation_id;
    expected_basis:=jsonb_build_object('contract_version',element.locale_decision_contract_version,
      'disposition',element.locale_decision_disposition,'locale',element.locale_decision_locale,
      'reason',element.locale_decision_reason_code,'rationale',element.locale_decision_rationale);
    RETURN signal_semantic_context_ordinary_authority_valid_v1(decision_origin.id)
      AND operation.action='edit-semantic-context-element-v1'
      AND decision_origin.locale_decision_input_digest=operation.semantic_context_decision_input_digest
      AND decision_origin.locale_decision_prestate_digest=(SELECT element_digest FROM signal_semantic_context_element_versions
        WHERE id=decision_origin.supersedes_element_id)
      AND decision_origin.locale_decision_basis_digest=signal_semantic_context_digest_json_v2(expected_basis)
      AND decision_origin.locale_decision_authority_digest=signal_semantic_context_digest_json_v2(
        decision_origin.locale_decision_authority_snapshot)
      AND decision_origin.locale_decision_authority_snapshot->'actor'->>'id'=lower(operation.actor_user_id::text)
      AND ROW(element.locale,element.locale_decision_contract_version,element.locale_decision_disposition,
        element.locale_decision_locale,element.locale_decision_reason_code,element.locale_decision_rationale,
        element.locale_decision_basis_digest,element.locale_decision_input_digest,element.locale_decision_authority_snapshot,
        element.locale_decision_authority_digest,element.locale_decision_prestate_digest,element.locale_decision_poststate_digest)
        IS NOT DISTINCT FROM ROW(decision_origin.locale,decision_origin.locale_decision_contract_version,
        decision_origin.locale_decision_disposition,decision_origin.locale_decision_locale,
        decision_origin.locale_decision_reason_code,decision_origin.locale_decision_rationale,
        decision_origin.locale_decision_basis_digest,decision_origin.locale_decision_input_digest,
        decision_origin.locale_decision_authority_snapshot,decision_origin.locale_decision_authority_digest,
        decision_origin.locale_decision_prestate_digest,decision_origin.locale_decision_poststate_digest)
      AND ((element.id=decision_origin.id) OR signal_semantic_context_ordinary_authority_valid_v1(element.id))
      AND ((element.locale_decision_disposition='global' AND element.locale IS NULL)
        OR (element.locale_decision_disposition='locale_specific' AND element.locale=element.locale_decision_locale
          AND element.locale=ANY(generation.locale_variants)));
  END IF;
  IF element.origin_kind<>'operator_ordinary' THEN RETURN signal_semantic_context_locale_authority_valid_pre_0102(target_element_id); END IF;
  IF NOT signal_semantic_context_ordinary_authority_valid_v1(element.id) THEN RETURN false; END IF;
  SELECT * INTO origin FROM signal_semantic_context_element_versions
    WHERE id=COALESCE(element.original_proposal_element_id,element.id);
  RETURN (element.locale IS NULL AND element.element_kind<>'locale_variant')
    OR (element.locale IS NOT NULL AND element.locale=ANY(generation.locale_variants)
      AND origin.locale IS NOT DISTINCT FROM element.locale);
END; $$;

ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb)
  RENAME TO signal_semantic_context_publication_snapshot_pre_0102;
CREATE FUNCTION signal_semantic_context_publication_snapshot_v2(p_generation_id uuid,current_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE base jsonb;ordinary_approved integer;archived integer;missing integer;blockers text[];counts jsonb;preflight jsonb;
BEGIN
  base:=signal_semantic_context_publication_snapshot_pre_0102(p_generation_id,current_authority);
  SELECT count(*) FILTER(WHERE disposition='approved' AND signal_semantic_context_ordinary_authority_valid_v1(id)
      AND (decision_contract_version IS NULL OR decision_reason_code IS NULL
        OR decision_rationale IS NULL OR decision_basis_digest IS NULL)),
    count(*) FILTER(WHERE disposition='archived' AND lifecycle_state='archived')
    INTO ordinary_approved,archived FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=p_generation_id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id);
  missing:=greatest(coalesce((base->'counts'->>'decision_basis_missing')::int,0)-ordinary_approved,0);
  counts:=(base->'counts')||jsonb_build_object('decision_basis_missing',missing,'archived',archived);
  SELECT coalesce(array_agg(value ORDER BY value),'{}'::text[]) INTO blockers
    FROM jsonb_array_elements_text(base->'blockers') item(value)
    WHERE value<>'decision_basis_missing';
  IF missing>0 THEN blockers:=array_append(blockers,'decision_basis_missing'); END IF;
  SELECT coalesce(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) INTO blockers FROM unnest(blockers) item(value);
  preflight:=(base->'preflight')||jsonb_build_object('counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,'ordinary_command_contract_version','edit-semantic-context-element-v1');
  RETURN base||jsonb_build_object('counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,'preflight',preflight,
    'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight));
END; $$;

COMMENT ON COLUMN signal_semantic_context_element_versions.ordinary_command_basis IS
  'Server-generated actor/time/diff/applicability audit basis; never browser-authored prose.';
