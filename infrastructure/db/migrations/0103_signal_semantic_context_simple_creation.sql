-- 0103 — append-only, operator-authored Semantic Context element creation.
-- This extends 0101/0102 without changing their historical meanings.

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
  'edit-semantic-context-element-v1','create-semantic-context-element-v1'
));

ALTER TABLE signal_semantic_context_events DROP CONSTRAINT IF EXISTS signal_semantic_context_event_kind;
ALTER TABLE signal_semantic_context_events ADD CONSTRAINT signal_semantic_context_event_kind CHECK(event_kind IN (
  'generation_created','generation_reconciled','proposals_appended','element_approved','element_rejected',
  'element_corrected','elements_bulk_approved','elements_merged','review_annotation_created',
  'review_annotation_updated','review_annotation_resolved','locale_authority_decided','generation_published',
  'ordinary_element_save','ordinary_element_undo','ordinary_element_archive','ordinary_element_restore',
  'operator_element_created'
));

ALTER TABLE signal_semantic_context_element_versions
  ADD COLUMN creation_contract_version text,
  ADD COLUMN creation_basis jsonb,
  ADD COLUMN creation_basis_digest text,
  ADD COLUMN creation_input_digest text,
  ADD COLUMN creation_poststate_digest text;

ALTER TABLE signal_semantic_context_element_versions
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_origin,
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_lineage;
ALTER TABLE signal_semantic_context_element_versions
  ADD CONSTRAINT signal_semantic_context_element_origin CHECK(origin_kind IN ('server_projection','provider_proposal',
    'operator_decision','operator_correction','operator_merge','operator_ordinary','operator_created')),
  ADD CONSTRAINT signal_semantic_context_element_lineage CHECK(
    (origin_kind IN ('operator_correction','operator_merge','operator_ordinary') AND supersedes_element_id IS NOT NULL
      AND original_proposal_element_id IS NOT NULL)
    OR (origin_kind='operator_created' AND supersedes_element_id IS NULL AND original_proposal_element_id IS NULL
      AND element_version=1)
    OR origin_kind NOT IN ('operator_correction','operator_merge','operator_ordinary','operator_created')),
  ADD CONSTRAINT signal_semantic_context_creation_all_or_none CHECK(
    (creation_contract_version IS NULL AND creation_basis IS NULL AND creation_basis_digest IS NULL
      AND creation_input_digest IS NULL AND creation_poststate_digest IS NULL)
    OR (creation_contract_version='create-semantic-context-element-v1'
      AND jsonb_typeof(creation_basis)='object'
      AND creation_basis_digest ~ '^sha256:[0-9a-f]{64}$'
      AND creation_input_digest ~ '^sha256:[0-9a-f]{64}$'
      AND creation_poststate_digest ~ '^sha256:[0-9a-f]{64}$'));

CREATE FUNCTION signal_semantic_context_operator_element_key_v1(kind text,canonical_key text,raw_locale text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN char_length('operator.'||kind||'.'||canonical_key||
      CASE WHEN raw_locale IS NULL THEN '' ELSE '.'||lower(raw_locale) END)<=200
    THEN 'operator.'||kind||'.'||canonical_key||CASE WHEN raw_locale IS NULL THEN '' ELSE '.'||lower(raw_locale) END
    ELSE left('operator.'||kind||'.'||canonical_key||CASE WHEN raw_locale IS NULL THEN '' ELSE '.'||lower(raw_locale) END,183)
      ||'.'||left(encode(digest(kind||chr(31)||canonical_key||chr(31)||COALESCE(raw_locale,''),'sha256'),'hex'),16)
  END
$$;

CREATE FUNCTION signal_semantic_context_creation_authority_valid_v1(target_element_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE actor users%ROWTYPE;DECLARE parent jsonb;DECLARE expected_authority jsonb;DECLARE expected_basis jsonb;
DECLARE expected_source_digest text;DECLARE expected_element_digest text;DECLARE input jsonb;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=element.operation_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=element.generation_id;
  SELECT * INTO actor FROM users WHERE id=operation.actor_user_id;input:=operation.semantic_context_decision_input;
  expected_authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest,
    'actor',jsonb_build_object('id',lower(actor.id::text),'user_type',actor.user_type,'primary_role',actor.primary_role));
  parent:=signal_semantic_context_parent_applicability_v1(generation.id,expected_authority-'actor');
  expected_basis:=jsonb_build_object('contract_version','signal-semantic-context-operator-create-audit-v1',
    'command_version','create-semantic-context-element-v1','action','create',
    'actor',expected_authority->'actor','created_at',to_char(element.decided_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'parent_applicability_digest',parent->>'parent_authority_digest',
    'diff',jsonb_build_array(jsonb_build_object('field','element','before',NULL,'after',jsonb_build_object(
      'element_kind',element.element_kind,'canonical_key',element.canonical_key,'display_text',element.display_text,
      'scope',element.scope,'relation_kind',element.relation_kind,'relation_target_key',element.relation_target_key,
      'applicability',input->'values'->'applicability'))),
    'provenance',jsonb_build_object('source_type','semantic_context_operator_input','relation_type','supports'));
  expected_source_digest:=signal_semantic_context_digest_json_v2(jsonb_build_array(jsonb_build_object(
    'source_type','semantic_context_operator_input','source_id',lower(operation.id::text),'relation_type','supports')));
  expected_element_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-operator-element-v1','element_key',element.element_key,
    'element_kind',element.element_kind,'canonical_key',element.canonical_key,'display_text',element.display_text,
    'scope',element.scope,'entity_type',element.entity_type,'entity_id',lower(element.entity_id::text),
    'locale',element.locale,'relation_kind',element.relation_kind,
    'relation_target_key',element.relation_target_key,'element_version',1,'disposition','approved',
    'lifecycle_state','active','source_refs_digest',expected_source_digest,
    'creation_basis_digest',signal_semantic_context_digest_json_v2(expected_basis)));
  RETURN element.id IS NOT NULL AND operation.id IS NOT NULL AND generation.id IS NOT NULL
    AND element.origin_kind='operator_created' AND element.element_version=1 AND element.disposition='approved'
    AND element.lifecycle_state='active' AND element.supersedes_element_id IS NULL
    AND element.original_proposal_element_id IS NULL AND operation.action='create-semantic-context-element-v1'
    AND operation.status='completed' AND operation.workspace_id=element.workspace_id
    AND operation.actor_user_id=element.proposed_by_user_id AND element.decided_by_user_id=operation.actor_user_id
    AND input->>'contract_version'='create-semantic-context-element-v1'
    AND input->>'generation_key'=generation.generation_key
    AND (input)-ARRAY['contract_version','generation_key','values']='{}'::jsonb
    AND input ?& ARRAY['contract_version','generation_key','values']
    AND jsonb_typeof(input->'values')='object'
    AND (input->'values') ?& ARRAY['element_kind','display_text','canonical_key','scope','relation_kind',
      'relation_target_key','applicability']
    AND (input->'values')-ARRAY['element_kind','display_text','canonical_key','scope','relation_kind',
      'relation_target_key','applicability']='{}'::jsonb
    AND input->'values'->>'element_kind'=element.element_kind
    AND input->'values'->>'display_text'=element.display_text
    AND input->'values'->>'canonical_key'=element.canonical_key
    AND input->'values'->>'scope' IS NOT DISTINCT FROM element.scope
    AND input->'values'->>'relation_kind' IS NOT DISTINCT FROM element.relation_kind
    AND input->'values'->>'relation_target_key' IS NOT DISTINCT FROM element.relation_target_key
    AND jsonb_typeof(input->'values'->'applicability')='object'
    AND (input->'values'->'applicability')-ARRAY['state','locale']='{}'::jsonb
    AND (input->'values'->'applicability') ?& ARRAY['state','locale']
    AND jsonb_typeof(input->'values'->'applicability'->'state')='string'
    AND element.element_key=signal_semantic_context_operator_element_key_v1(element.element_kind,element.canonical_key,element.locale)
    AND operation.semantic_context_decision_input_digest=element.creation_input_digest
    AND signal_semantic_context_digest_json_v2(input)=element.creation_input_digest
    AND element.creation_contract_version='create-semantic-context-element-v1'
    AND element.creation_basis=expected_basis
    AND element.creation_basis_digest=signal_semantic_context_digest_json_v2(expected_basis)
    AND element.element_digest=expected_element_digest
    AND element.creation_poststate_digest=element.element_digest
    AND parent->>'valid'='true' AND element.source_refs_digest=expected_source_digest
    AND (SELECT count(*) FROM analysis_evidence_links link WHERE link.evidence_group_id=element.evidence_group_id)=1
    AND EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=element.evidence_group_id
      AND link.source_type='semantic_context_operator_input' AND link.source_id=operation.id
      AND link.relation_type='supports');
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
    WHEN 'element_corrected' THEN CASE WHEN operation.action='correct-semantic-context-element'
      THEN 'correct-semantic-context-element' ELSE 'decide-semantic-context-element' END
    WHEN 'elements_bulk_approved' THEN 'bulk-approve-semantic-context-elements'
    WHEN 'elements_merged' THEN 'merge-semantic-context-elements'
    WHEN 'review_annotation_created' THEN 'annotate-semantic-context-element'
    WHEN 'review_annotation_updated' THEN CASE WHEN operation.action IN (
      'merge-semantic-context-elements','correct-semantic-context-element') THEN operation.action
      ELSE 'annotate-semantic-context-element' END
    WHEN 'review_annotation_resolved' THEN CASE WHEN operation.action IN ('merge-semantic-context-elements',
      'correct-semantic-context-element','resolve-semantic-context-annotation',
      'repair-semantic-context-annotation-resolution') THEN operation.action ELSE 'annotate-semantic-context-element' END
    WHEN 'locale_authority_decided' THEN 'decide-semantic-context-locale-authority'
    WHEN 'ordinary_element_save' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_undo' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_archive' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_restore' THEN 'edit-semantic-context-element-v1'
    WHEN 'operator_element_created' THEN 'create-semantic-context-element-v1'
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.action IS DISTINCT FROM expected_action
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_element_operation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;generation_status text;
DECLARE artifact_kind text;artifact_authority text;group_artifact uuid;
DECLARE generation_has_provider_lineage boolean;generation_profile_id uuid;
DECLARE workspace_organization_id uuid;workspace_brand_id uuid;
BEGIN
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
  IF NEW.origin_kind IN ('server_projection','provider_proposal') AND
     (operation.action<>'append-semantic-context-proposals' OR NEW.disposition<>'pending') THEN
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

CREATE FUNCTION validate_signal_semantic_context_creation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;DECLARE generation signal_semantic_context_generations%ROWTYPE;
BEGIN
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
CREATE TRIGGER trg_validate_signal_semantic_context_creation_v1 BEFORE INSERT
  ON signal_semantic_context_element_versions FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_creation_v1();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_locale_decision_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE predecessor signal_semantic_context_element_versions%ROWTYPE;
DECLARE decision_actor users%ROWTYPE;basis jsonb;expected_authority jsonb;expected_element_digest text;
DECLARE applicability_state text;expected_prestate text;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=NEW.generation_id;
  SELECT * INTO predecessor FROM signal_semantic_context_element_versions WHERE id=NEW.supersedes_element_id;
  IF operation.action='create-semantic-context-element-v1' THEN
    applicability_state:=operation.semantic_context_decision_input->'values'->'applicability'->>'state';
    IF applicability_state='workspace_inherited' THEN
      IF operation.semantic_context_decision_input->'values'->'applicability'->'locale'<>'null'::jsonb
         OR NEW.locale IS NOT NULL OR NEW.locale_decision_contract_version IS NOT NULL
         OR NEW.element_kind='locale_variant' THEN
        RAISE EXCEPTION 'Inherited creation applicability is invalid.' USING ERRCODE='23514';
      END IF;RETURN NEW;
    END IF;
    SELECT * INTO decision_actor FROM users WHERE id=operation.actor_user_id;
    basis:=jsonb_build_object('contract_version','signal-semantic-context-locale-decision-v1',
      'disposition',CASE applicability_state WHEN 'explicit_global' THEN 'global' ELSE 'locale_specific' END,
      'locale',CASE applicability_state WHEN 'explicit_locale'
        THEN operation.semantic_context_decision_input->'values'->'applicability'->>'locale' ELSE NULL END,
      'reason','locale_resolution','rationale',
      'Applicability selected by the authenticated operator during element creation.');
    expected_authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
      'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
      'proposal_provider_lineage',generation.proposal_provider_lineage,
      'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest,
      'actor',jsonb_build_object('id',lower(decision_actor.id::text),'user_type',decision_actor.user_type,
        'primary_role',decision_actor.primary_role));
    expected_prestate:=signal_semantic_context_digest_json_v2(jsonb_build_object(
      'contract_version','signal-semantic-context-create-prestate-v1','element_key',NEW.element_key,
      'parent_applicability_digest',NEW.creation_basis->>'parent_applicability_digest'));
    IF applicability_state NOT IN ('explicit_global','explicit_locale')
       OR (applicability_state='explicit_global'
         AND operation.semantic_context_decision_input->'values'->'applicability'->'locale'<>'null'::jsonb)
       OR (applicability_state='explicit_locale'
         AND jsonb_typeof(operation.semantic_context_decision_input->'values'->'applicability'->'locale')<>'string')
       OR (NEW.element_kind='locale_variant' AND applicability_state<>'explicit_locale')
       OR NEW.locale_decision_basis_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(basis)
       OR NEW.locale_decision_authority_snapshot IS DISTINCT FROM expected_authority
       OR NEW.locale_decision_authority_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(expected_authority)
       OR NEW.locale_decision_input_digest IS DISTINCT FROM operation.semantic_context_decision_input_digest
       OR NEW.locale_decision_prestate_digest IS DISTINCT FROM expected_prestate
       OR NEW.locale_decision_poststate_digest IS DISTINCT FROM NEW.element_digest
       OR NEW.locale_decision_disposition IS DISTINCT FROM basis->>'disposition'
       OR NEW.locale_decision_locale IS DISTINCT FROM NULLIF(basis->>'locale','')
       OR NEW.locale IS DISTINCT FROM NULLIF(basis->>'locale','')
       OR (NEW.locale IS NOT NULL AND NOT NEW.locale=ANY(generation.locale_variants)) THEN
      RAISE EXCEPTION 'Created Semantic Context applicability authority is invalid.' USING ERRCODE='23514';
    END IF;RETURN NEW;
  END IF;
  IF operation.action='edit-semantic-context-element-v1' THEN RETURN NEW; END IF;
  IF operation.action IS DISTINCT FROM 'decide-semantic-context-locale-authority' THEN
    IF predecessor.id IS NULL THEN
      IF NEW.locale_decision_contract_version IS NOT NULL THEN
        RAISE EXCEPTION 'Only the dedicated locale authority operation may originate locale lineage.' USING ERRCODE='23514';
      END IF;RETURN NEW;
    END IF;
    IF ROW(NEW.locale,NEW.locale_decision_contract_version,NEW.locale_decision_disposition,
      NEW.locale_decision_locale,NEW.locale_decision_reason_code,NEW.locale_decision_rationale,
      NEW.locale_decision_basis_digest,NEW.locale_decision_input_digest,NEW.locale_decision_authority_snapshot,
      NEW.locale_decision_authority_digest,NEW.locale_decision_prestate_digest,NEW.locale_decision_poststate_digest)
      IS DISTINCT FROM ROW(predecessor.locale,predecessor.locale_decision_contract_version,
      predecessor.locale_decision_disposition,predecessor.locale_decision_locale,predecessor.locale_decision_reason_code,
      predecessor.locale_decision_rationale,predecessor.locale_decision_basis_digest,
      predecessor.locale_decision_input_digest,predecessor.locale_decision_authority_snapshot,
      predecessor.locale_decision_authority_digest,predecessor.locale_decision_prestate_digest,
      predecessor.locale_decision_poststate_digest) THEN
      RAISE EXCEPTION 'Generic Semantic Context successors must preserve locale authority byte-for-byte.' USING ERRCODE='23514';
    END IF;RETURN NEW;
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
  END IF;RETURN NEW;
END; $$;

CREATE FUNCTION signal_semantic_context_creation_lineage_valid_v1(target_element_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
DECLARE origin signal_semantic_context_element_versions%ROWTYPE;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  SELECT * INTO origin FROM signal_semantic_context_element_versions
    WHERE id=COALESCE(element.original_proposal_element_id,element.id);
  RETURN element.id IS NOT NULL AND origin.origin_kind='operator_created'
    AND signal_semantic_context_creation_authority_valid_v1(origin.id)
    AND element.generation_id=origin.generation_id AND element.element_key=origin.element_key
    AND element.source_refs_digest=origin.source_refs_digest
    AND (element.id=origin.id OR (element.origin_kind='operator_ordinary'
      AND signal_semantic_context_ordinary_authority_valid_v1(element.id)));
END; $$;

ALTER FUNCTION signal_semantic_context_locale_authority_valid_v1(uuid)
  RENAME TO signal_semantic_context_locale_authority_valid_pre_0103;
CREATE FUNCTION signal_semantic_context_locale_authority_valid_v1(target_element_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
DECLARE origin signal_semantic_context_element_versions%ROWTYPE;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  SELECT * INTO origin FROM signal_semantic_context_element_versions
    WHERE id=COALESCE(element.original_proposal_element_id,element.id);
  IF origin.origin_kind<>'operator_created' THEN
    RETURN signal_semantic_context_locale_authority_valid_pre_0103(target_element_id);
  END IF;
  IF NOT signal_semantic_context_creation_lineage_valid_v1(target_element_id) THEN RETURN false; END IF;
  IF element.locale_decision_contract_version IS NULL THEN
    RETURN element.locale IS NULL AND element.element_kind<>'locale_variant';
  END IF;
  RETURN ROW(element.locale,element.locale_decision_contract_version,element.locale_decision_disposition,
    element.locale_decision_locale,element.locale_decision_reason_code,element.locale_decision_rationale,
    element.locale_decision_basis_digest,element.locale_decision_input_digest,
    element.locale_decision_authority_snapshot,element.locale_decision_authority_digest,
    element.locale_decision_prestate_digest,element.locale_decision_poststate_digest)
    IS NOT DISTINCT FROM ROW(origin.locale,origin.locale_decision_contract_version,origin.locale_decision_disposition,
    origin.locale_decision_locale,origin.locale_decision_reason_code,origin.locale_decision_rationale,
    origin.locale_decision_basis_digest,origin.locale_decision_input_digest,origin.locale_decision_authority_snapshot,
    origin.locale_decision_authority_digest,origin.locale_decision_prestate_digest,origin.locale_decision_poststate_digest)
    AND ((element.locale_decision_disposition='global' AND element.locale IS NULL)
      OR (element.locale_decision_disposition='locale_specific' AND element.locale IS NOT NULL));
END; $$;

CREATE OR REPLACE FUNCTION signal_semantic_context_effective_applicability_v1(target_element_id uuid,
  expected_live_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE element signal_semantic_context_element_versions%ROWTYPE;
DECLARE origin signal_semantic_context_element_versions%ROWTYPE;
DECLARE parent_result jsonb;parent jsonb;applicability jsonb;state text;
BEGIN
  SELECT * INTO element FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  IF element.id IS NULL THEN RETURN jsonb_build_object('valid',false,'reason','element_missing'); END IF;
  IF element.disposition<>'approved' THEN RETURN jsonb_build_object('valid',false,'reason','element_not_approved'); END IF;
  parent_result:=signal_semantic_context_parent_applicability_v1(element.generation_id,expected_live_authority);
  IF parent_result->>'valid'<>'true' THEN RETURN parent_result; END IF;parent:=parent_result->'parent_authority';
  IF element.locale_decision_contract_version IS NOT NULL THEN
    IF NOT signal_semantic_context_locale_authority_valid_v1(element.id) THEN
      RETURN jsonb_build_object('valid',false,'reason','explicit_locale_authority_invalid'); END IF;
    state:=CASE element.locale_decision_disposition WHEN 'global' THEN 'explicit_global'
      WHEN 'locale_specific' THEN 'explicit_locale' ELSE NULL END;
  ELSE
    SELECT * INTO origin FROM signal_semantic_context_element_versions
      WHERE id=COALESCE(element.original_proposal_element_id,element.id);
    IF origin.id IS NULL OR origin.generation_id<>element.generation_id OR origin.element_key<>element.element_key
       OR (origin.origin_kind IN ('server_projection','provider_proposal')
         AND (origin.locale IS DISTINCT FROM element.locale OR origin.locale_decision_contract_version IS NOT NULL))
       OR (origin.origin_kind='operator_created' AND NOT signal_semantic_context_creation_lineage_valid_v1(element.id))
       OR origin.origin_kind NOT IN ('server_projection','provider_proposal','operator_created') THEN
      RETURN jsonb_build_object('valid',false,'reason','proposal_origin_invalid');
    END IF;
    IF element.locale IS NOT NULL THEN
      IF NOT signal_semantic_context_locale_authority_valid_v1(element.id) THEN
        RETURN jsonb_build_object('valid',false,'reason','explicit_locale_invalid'); END IF;
      state:='explicit_locale';
    ELSIF element.element_kind='locale_variant' THEN
      RETURN jsonb_build_object('valid',false,'reason','locale_specific_locale_required');
    ELSE state:='workspace_inherited'; END IF;
  END IF;
  applicability:=jsonb_build_object('contract_version','signal-semantic-context-effective-applicability-v1',
    'state',state,'locale',element.locale,'locales',CASE WHEN state='explicit_locale'
      THEN jsonb_build_array(element.locale) ELSE parent->'locales' END,'markets',parent->'markets',
    'source',CASE state WHEN 'workspace_inherited' THEN 'sealed_generation_locale_context'
      WHEN 'explicit_global' THEN 'operator_locale_authority'
      WHEN 'explicit_locale' THEN CASE WHEN element.locale_decision_contract_version IS NOT NULL
        THEN 'operator_locale_authority' ELSE 'sealed_element_locale' END ELSE NULL END,
    'parent_authority',parent,'parent_authority_digest',parent_result->>'parent_authority_digest',
    'explicit_authority_digest',CASE WHEN element.locale_decision_contract_version IS NULL THEN NULL
      ELSE element.locale_decision_authority_digest END);
  RETURN jsonb_build_object('valid',true,'applicability',applicability,
    'applicability_digest',signal_semantic_context_digest_json_v2(applicability));
END; $$;

CREATE FUNCTION validate_signal_semantic_context_creation_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE element_count integer;event_count integer;collision boolean;created signal_semantic_context_element_versions%ROWTYPE;
BEGIN
  IF NEW.action<>'create-semantic-context-element-v1' OR NEW.status<>'completed' THEN RETURN NEW; END IF;
  SELECT count(*) INTO element_count FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=NEW.id AND element.origin_kind='operator_created';
  SELECT * INTO created FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=NEW.id AND element.origin_kind='operator_created' LIMIT 1;
  SELECT count(*) INTO event_count FROM signal_semantic_context_events event
    WHERE event.operation_id=NEW.id AND event.event_kind='operator_element_created';
  collision:=CASE WHEN jsonb_typeof(NEW.result->'collision')='boolean'
    THEN (NEW.result->>'collision')::boolean ELSE NULL END;
  IF jsonb_typeof(NEW.semantic_context_decision_input)<>'object'
     OR NEW.semantic_context_decision_input->>'contract_version'<>'create-semantic-context-element-v1'
     OR jsonb_typeof(NEW.result)<>'object' OR NEW.result-ARRAY['generation_key','element_key','element_version',
       'disposition','lifecycle_state','collision','draft_digest_ref']<>'{}'::jsonb
     OR NOT NEW.result ?& ARRAY['generation_key','element_key','element_version','disposition',
       'lifecycle_state','collision','draft_digest_ref'] OR collision IS DISTINCT FROM false
     OR jsonb_typeof(NEW.result->'element_version')<>'number'
     OR element_count<>1 OR event_count<>1
     OR NEW.result->>'element_key' IS DISTINCT FROM created.element_key
     OR signal_semantic_context_safe_positive_int_v1(NEW.result->'element_version') IS DISTINCT FROM created.element_version
     OR NEW.result->>'disposition'<>'approved' OR NEW.result->>'lifecycle_state'<>'active' THEN
    RAISE EXCEPTION 'Semantic Context creation operation is incomplete.' USING ERRCODE='23514';
  END IF;RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_creation_operation_v1
  AFTER INSERT OR UPDATE ON signal_governance_control_operations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_creation_operation_v1();

CREATE FUNCTION validate_signal_semantic_context_creation_cohort_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation_id uuid;operation signal_governance_control_operations%ROWTYPE;
DECLARE element_count integer;event_count integer;
BEGIN
  operation_id:=CASE WHEN TG_OP='DELETE' THEN OLD.operation_id ELSE NEW.operation_id END;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=operation_id;
  IF operation.action<>'create-semantic-context-element-v1' OR operation.status<>'completed' THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT count(*) INTO element_count FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=operation.id AND element.origin_kind='operator_created';
  SELECT count(*) INTO event_count FROM signal_semantic_context_events event
    WHERE event.operation_id=operation.id AND event.event_kind='operator_element_created';
  IF element_count NOT IN (0,1) OR event_count<>element_count THEN
    RAISE EXCEPTION 'Semantic Context creation operation/event cohort is incomplete.' USING ERRCODE='23514';
  END IF;RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_creation_event_cohort_v1
  AFTER INSERT OR DELETE ON signal_semantic_context_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_creation_cohort_v1();
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_creation_element_cohort_v1
  AFTER INSERT OR DELETE ON signal_semantic_context_element_versions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_creation_cohort_v1();

ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb)
  RENAME TO signal_semantic_context_publication_snapshot_pre_0103;
CREATE FUNCTION signal_semantic_context_publication_snapshot_v2(p_generation_id uuid,current_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE base jsonb;valid_created integer;missing integer;invalid_evidence integer;
DECLARE blockers text[];counts jsonb;preflight jsonb;
BEGIN
  base:=signal_semantic_context_publication_snapshot_pre_0103(p_generation_id,current_authority);
  SELECT count(*)::int INTO valid_created FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=p_generation_id AND element.disposition='approved' AND element.lifecycle_state='active'
      AND signal_semantic_context_creation_lineage_valid_v1(element.id)
      AND (element.decision_contract_version IS NULL OR element.decision_reason_code IS NULL
        OR element.decision_rationale IS NULL OR element.decision_basis_digest IS NULL)
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id);
  missing:=greatest(COALESCE((base->'counts'->>'decision_basis_missing')::int,0)-valid_created,0);
  invalid_evidence:=greatest(COALESCE((base->'counts'->>'invalid_evidence_refs')::int,0)-valid_created,0);
  counts:=(base->'counts')||jsonb_build_object('decision_basis_missing',missing,
    'invalid_evidence_refs',invalid_evidence);
  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::text[]) INTO blockers
    FROM jsonb_array_elements_text(base->'blockers') item(value)
    WHERE value NOT IN ('decision_basis_missing','invalid_current_evidence');
  IF missing>0 THEN blockers:=array_append(blockers,'decision_basis_missing'); END IF;
  IF invalid_evidence>0 THEN blockers:=array_append(blockers,'invalid_current_evidence'); END IF;
  SELECT COALESCE(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) INTO blockers FROM unnest(blockers) item(value);
  preflight:=(base->'preflight')||jsonb_build_object('counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,
    'creation_contract_version','create-semantic-context-element-v1');
  RETURN base||jsonb_build_object('counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,'preflight',preflight,
    'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight));
END; $$;

COMMENT ON COLUMN signal_semantic_context_element_versions.creation_basis IS
  'Server-authored actor/time/diff/parent-applicability basis for one operator-created element.';
COMMENT ON FUNCTION signal_semantic_context_creation_authority_valid_v1(uuid) IS
  'Validates the exact closed operation, actor, input, provenance and audit basis of an operator-created element.';
