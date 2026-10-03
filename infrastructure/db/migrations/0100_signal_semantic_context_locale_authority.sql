-- 0100 — governed locale/global authority for reviewed Semantic Context leaves.
-- Historical rows remain byte-for-byte intact. New decisions reopen approved leaves
-- append-only as pending successors and never grant approval by themselves.

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
    'retry-semantic-context-proposal-run','revalidate-semantic-context-proposal-run',
    'merge-semantic-context-elements','correct-semantic-context-element',
    'annotate-semantic-context-element','resolve-semantic-context-annotation',
    'repair-semantic-context-annotation-resolution','decide-semantic-context-locale-authority'
  ));

ALTER TABLE signal_semantic_context_events
  DROP CONSTRAINT IF EXISTS signal_semantic_context_event_kind;
ALTER TABLE signal_semantic_context_events
  ADD CONSTRAINT signal_semantic_context_event_kind CHECK(event_kind IN (
    'generation_created','generation_reconciled','proposals_appended','element_approved',
    'element_rejected','element_corrected','elements_bulk_approved','elements_merged',
    'review_annotation_created','review_annotation_updated','review_annotation_resolved',
    'locale_authority_decided','generation_published'
  ));

ALTER TABLE signal_semantic_context_element_versions
  ADD COLUMN locale_decision_contract_version text,
  ADD COLUMN locale_decision_disposition text,
  ADD COLUMN locale_decision_locale text,
  ADD COLUMN locale_decision_reason_code text,
  ADD COLUMN locale_decision_rationale text,
  ADD COLUMN locale_decision_basis_digest text,
  ADD COLUMN locale_decision_input_digest text,
  ADD COLUMN locale_decision_authority_snapshot jsonb,
  ADD COLUMN locale_decision_authority_digest text,
  ADD COLUMN locale_decision_prestate_digest text,
  ADD COLUMN locale_decision_poststate_digest text;

ALTER TABLE signal_semantic_context_element_versions
  ADD CONSTRAINT signal_semantic_context_locale_decision_all_or_none CHECK (
    (locale_decision_contract_version IS NULL AND locale_decision_disposition IS NULL
      AND locale_decision_locale IS NULL AND locale_decision_reason_code IS NULL
      AND locale_decision_rationale IS NULL AND locale_decision_basis_digest IS NULL
      AND locale_decision_input_digest IS NULL AND locale_decision_authority_snapshot IS NULL
      AND locale_decision_authority_digest IS NULL AND locale_decision_prestate_digest IS NULL
      AND locale_decision_poststate_digest IS NULL)
    OR
    (locale_decision_contract_version IS NOT NULL AND locale_decision_disposition IS NOT NULL
      AND locale_decision_reason_code IS NOT NULL AND locale_decision_rationale IS NOT NULL
      AND locale_decision_basis_digest IS NOT NULL AND locale_decision_input_digest IS NOT NULL
      AND locale_decision_authority_snapshot IS NOT NULL AND locale_decision_authority_digest IS NOT NULL
      AND locale_decision_prestate_digest IS NOT NULL AND locale_decision_poststate_digest IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT signal_semantic_context_locale_decision_closed CHECK (
    locale_decision_contract_version IS NULL OR (
      locale_decision_contract_version='signal-semantic-context-locale-decision-v1'
      AND locale_decision_disposition IN ('global','locale_specific')
      AND ((locale_decision_disposition='global' AND locale_decision_locale IS NULL AND locale IS NULL)
        OR (locale_decision_disposition='locale_specific' AND locale_decision_locale IS NOT NULL
          AND locale=locale_decision_locale))
      AND locale_decision_reason_code IN (
        'duplicate_same_concept','alias_or_variant','canonicalization','semantic_boundary',
        'locale_resolution','competitive_unit_resolution','insufficient_context','operator_correction')
      AND locale_decision_rationale=signal_semantic_context_trim_ecmascript_v2(
        normalize(locale_decision_rationale,NFC))
      AND char_length(locale_decision_rationale) BETWEEN 1 AND 1000
      AND locale_decision_basis_digest ~ '^sha256:[0-9a-f]{64}$'
      AND locale_decision_input_digest ~ '^sha256:[0-9a-f]{64}$'
      AND locale_decision_authority_digest ~ '^sha256:[0-9a-f]{64}$'
      AND locale_decision_prestate_digest ~ '^sha256:[0-9a-f]{64}$'
      AND locale_decision_poststate_digest ~ '^sha256:[0-9a-f]{64}$'
    )
  ) NOT VALID;

COMMENT ON COLUMN signal_semantic_context_element_versions.locale_decision_disposition IS
  'Operator-sealed global or locale-specific authority. It never grants approval.';

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_element_operation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;generation_status text;
DECLARE artifact_kind text;artifact_authority text;group_artifact uuid;
DECLARE generation_has_provider_lineage boolean;generation_profile_id uuid;
DECLARE workspace_organization_id uuid;workspace_brand_id uuid;
BEGIN
  SELECT generation.status,(generation.proposal_model IS NOT NULL
      AND generation.proposal_model_version IS NOT NULL
      AND generation.proposal_prompt_digest IS NOT NULL
      AND generation.proposal_pricing_version IS NOT NULL
      AND generation.proposal_provider_lineage IS NOT NULL
      AND generation.proposal_provider_lineage_digest IS NOT NULL),
      generation.brand_os_profile_id,workspace.organization_id,workspace.brand_id
    INTO generation_status,generation_has_provider_lineage,generation_profile_id,
      workspace_organization_id,workspace_brand_id
    FROM signal_semantic_context_generations generation
    JOIN signal_workspaces workspace ON workspace.id=generation.workspace_id
    WHERE generation.id=NEW.generation_id AND generation.workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT workspace_artifact_kind,workspace_authority_digest INTO artifact_kind,artifact_authority
    FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  SELECT artifact_id INTO group_artifact FROM analysis_evidence_groups WHERE id=NEW.evidence_group_id;
  IF generation_status IS DISTINCT FROM 'draft' OR operation.id IS NULL
     OR operation.workspace_id<>NEW.workspace_id OR operation.actor_user_id<>NEW.proposed_by_user_id
     OR operation.status<>'in_progress' OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.proposed_by_user_id) THEN
    RAISE EXCEPTION 'Semantic context element operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF artifact_kind IS DISTINCT FROM 'semantic_context' OR artifact_authority IS DISTINCT FROM NEW.element_digest
     OR group_artifact IS DISTINCT FROM NEW.artifact_id THEN
    RAISE EXCEPTION 'Semantic context element artifact/evidence lineage is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=NEW.evidence_group_id)
     OR EXISTS(SELECT 1 FROM analysis_evidence_links link
      WHERE link.evidence_group_id=NEW.evidence_group_id AND NOT CASE link.source_type
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
        ELSE false END) THEN
    RAISE EXCEPTION 'Semantic context source references are cross-workspace or stale.' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_element_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM signal_semantic_context_element_versions predecessor
    WHERE predecessor.id=NEW.supersedes_element_id AND predecessor.workspace_id=NEW.workspace_id
      AND predecessor.generation_id=NEW.generation_id AND predecessor.element_key=NEW.element_key
      AND predecessor.element_version=NEW.element_version-1) THEN
    RAISE EXCEPTION 'Semantic context element supersession is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind IN ('server_projection','provider_proposal') AND
     (operation.action<>'append-semantic-context-proposals' OR NEW.disposition<>'pending') THEN
    RAISE EXCEPTION 'Semantic context proposal disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_decision' AND
     (operation.action NOT IN ('decide-semantic-context-element','bulk-approve-semantic-context-elements')
       OR NEW.disposition NOT IN ('approved','rejected')
       OR NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context operator decision is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_merge' AND (operation.action<>'merge-semantic-context-elements'
       OR NEW.disposition<>'merged') THEN
    RAISE EXCEPTION 'Semantic context merged disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_correction' AND (operation.action NOT IN (
      'decide-semantic-context-element','correct-semantic-context-element','merge-semantic-context-elements',
      'decide-semantic-context-locale-authority') OR NEW.disposition<>'pending') THEN
    RAISE EXCEPTION 'Semantic context correction disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='provider_proposal' AND NOT generation_has_provider_lineage THEN
    RAISE EXCEPTION 'Provider proposal lineage is incomplete.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

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
  IF operation.action IS DISTINCT FROM 'decide-semantic-context-locale-authority' THEN
    IF predecessor.id IS NULL THEN
      IF NEW.locale_decision_contract_version IS NOT NULL THEN
        RAISE EXCEPTION 'Only the dedicated locale authority operation may originate locale lineage.'
          USING ERRCODE='23514';
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
      RAISE EXCEPTION 'Generic Semantic Context successors must preserve locale authority byte-for-byte.'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.locale_decision_contract_version IS NULL THEN
    RAISE EXCEPTION 'The dedicated locale authority operation requires sealed locale lineage.'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO decision_actor FROM users WHERE id=operation.actor_user_id;
  basis:=jsonb_build_object('contract_version',NEW.locale_decision_contract_version,
    'disposition',NEW.locale_decision_disposition,'locale',NEW.locale_decision_locale,
    'reason',NEW.locale_decision_reason_code,'rationale',NEW.locale_decision_rationale);
  expected_authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest,
    'actor',jsonb_build_object('id',lower(decision_actor.id::text),
      'user_type',decision_actor.user_type,'primary_role',decision_actor.primary_role));
  IF NEW.locale_decision_basis_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(basis)
     OR NEW.locale_decision_authority_snapshot IS DISTINCT FROM expected_authority
     OR NEW.locale_decision_authority_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(expected_authority)
     OR NEW.locale_decision_locale IS NOT NULL AND NOT NEW.locale_decision_locale=ANY(generation.locale_variants) THEN
    RAISE EXCEPTION 'Semantic Context locale decision basis or authority is invalid.' USING ERRCODE='23514';
  END IF;
  expected_element_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
      'contract_version','signal-semantic-context-locale-decision-element-v1',
      'element_key',NEW.element_key,'element_kind',NEW.element_kind,'canonical_key',NEW.canonical_key,
      'display_text',NEW.display_text,'scope',NEW.scope,'entity_type',NEW.entity_type,
      'entity_id',lower(NEW.entity_id::text),'locale',NEW.locale,'relation_kind',NEW.relation_kind,
      'relation_target_key',NEW.relation_target_key,'element_version',NEW.element_version,
      'disposition','pending','source_refs_digest',NEW.source_refs_digest,'locale_decision_basis',basis));
  IF predecessor.id IS NULL OR predecessor.disposition<>'approved'
       OR NEW.origin_kind<>'operator_correction' OR NEW.disposition<>'pending'
       OR NEW.locale_decision_prestate_digest IS DISTINCT FROM predecessor.element_digest
       OR NEW.locale_decision_poststate_digest IS DISTINCT FROM expected_element_digest
       OR NEW.element_digest IS DISTINCT FROM expected_element_digest
       OR operation.semantic_context_decision_input_digest IS DISTINCT FROM NEW.locale_decision_input_digest
       OR signal_semantic_context_digest_json_v2(operation.semantic_context_decision_input)
          IS DISTINCT FROM NEW.locale_decision_input_digest THEN
    RAISE EXCEPTION 'Semantic Context locale decision successor is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_signal_semantic_context_locale_decision_v1
  BEFORE INSERT ON signal_semantic_context_element_versions
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_locale_decision_v1();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_annotation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject signal_semantic_context_element_versions%ROWTYPE;
DECLARE predecessor signal_semantic_context_review_annotations%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;related uuid;
BEGIN
  SELECT * INTO subject FROM signal_semantic_context_element_versions WHERE id=NEW.subject_element_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF subject.id IS NULL OR subject.workspace_id<>NEW.workspace_id OR subject.generation_id<>NEW.generation_id
     OR operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.status<>'in_progress'
     OR operation.action NOT IN ('annotate-semantic-context-element','merge-semantic-context-elements',
       'correct-semantic-context-element','resolve-semantic-context-annotation',
       'repair-semantic-context-annotation-resolution','decide-semantic-context-locale-authority') THEN
    RAISE EXCEPTION 'Semantic context annotation authority is invalid.' USING ERRCODE='23514';
  END IF;
  FOREACH related IN ARRAY NEW.related_element_ids LOOP
    IF NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element
      WHERE element.id=related AND element.workspace_id=NEW.workspace_id
        AND element.generation_id=NEW.generation_id) THEN
      RAISE EXCEPTION 'Semantic context annotation relation is cross-authority.' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF NEW.supersedes_annotation_id IS NULL THEN
    IF operation.action='decide-semantic-context-locale-authority' THEN
      IF NEW.annotation_version<>1 OR NEW.state<>'resolved' OR NEW.annotation_type<>'locale_unresolved'
         OR NEW.resolution<>'global' OR cardinality(NEW.related_element_ids)<>0
         OR subject.operation_id<>operation.id OR subject.origin_kind<>'operator_correction'
         OR subject.disposition<>'pending' OR subject.locale_decision_disposition<>'global'
         OR NEW.annotation_key IS DISTINCT FROM
            'locale-authority.'||encode(digest(subject.element_key,'sha256'),'hex') THEN
        RAISE EXCEPTION 'Semantic Context global locale authority record is invalid.' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.annotation_version<>1 OR NEW.state<>'open'
       OR operation.action<>'annotate-semantic-context-element' THEN
      RAISE EXCEPTION 'Semantic context annotation creation is invalid.' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO predecessor FROM signal_semantic_context_review_annotations WHERE id=NEW.supersedes_annotation_id;
    IF operation.action='decide-semantic-context-locale-authority' THEN
      RAISE EXCEPTION 'Global locale authority must not rewrite an annotation.' USING ERRCODE='23514';
    END IF;
    IF predecessor.id IS NULL OR predecessor.workspace_id<>NEW.workspace_id
       OR predecessor.generation_id<>NEW.generation_id OR predecessor.annotation_key<>NEW.annotation_key
       OR predecessor.annotation_version+1<>NEW.annotation_version
       OR predecessor.annotation_type<>NEW.annotation_type THEN
      RAISE EXCEPTION 'Semantic context annotation successor is invalid.' USING ERRCODE='23514';
    END IF;
    IF operation.action='repair-semantic-context-annotation-resolution' THEN
      IF predecessor.state<>'resolved' OR NEW.state<>'resolved'
         OR NEW.resolution IS DISTINCT FROM predecessor.resolution
         OR predecessor.resolution_basis_digest IS NOT NULL THEN
        RAISE EXCEPTION 'Semantic context annotation repair must supersede one deficient resolved leaf.'
          USING ERRCODE='23514';
      END IF;
    ELSIF predecessor.state<>'open' THEN
      RAISE EXCEPTION 'Semantic context annotation successor must resolve or rebind one open leaf.'
        USING ERRCODE='23514';
    END IF;
    IF NEW.related_element_ids IS DISTINCT FROM predecessor.related_element_ids THEN
      RAISE EXCEPTION 'Semantic context annotation related authority cannot be rebound.' USING ERRCODE='23514';
    END IF;
    IF operation.action IN ('annotate-semantic-context-element','resolve-semantic-context-annotation',
         'repair-semantic-context-annotation-resolution')
       AND NEW.subject_element_id IS DISTINCT FROM predecessor.subject_element_id THEN
      RAISE EXCEPTION 'Semantic context annotation resolution must preserve its subject.' USING ERRCODE='23514';
    ELSIF operation.action='correct-semantic-context-element' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.id=NEW.subject_element_id AND successor.supersedes_element_id=predecessor.subject_element_id
        AND successor.generation_id=NEW.generation_id AND successor.workspace_id=NEW.workspace_id
        AND successor.operation_id=NEW.operation_id AND successor.origin_kind='operator_correction') THEN
      RAISE EXCEPTION 'Semantic context correction annotation must bind to the exact element successor.'
        USING ERRCODE='23514';
    ELSIF operation.action='merge-semantic-context-elements' AND NEW.resolution='merged' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_merge_edges edge
      WHERE edge.operation_id=NEW.operation_id AND edge.generation_id=NEW.generation_id
        AND edge.workspace_id=NEW.workspace_id AND edge.source_predecessor_id=predecessor.subject_element_id
        AND NEW.subject_element_id=predecessor.subject_element_id
        AND edge.target_predecessor_id=ANY(predecessor.related_element_ids)) THEN
      RAISE EXCEPTION 'Semantic context merge-source annotation authority is invalid.' USING ERRCODE='23514';
    ELSIF operation.action='merge-semantic-context-elements' AND NEW.resolution IS DISTINCT FROM 'merged' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_merge_edges edge
      WHERE edge.operation_id=NEW.operation_id AND edge.generation_id=NEW.generation_id
        AND edge.workspace_id=NEW.workspace_id AND edge.target_predecessor_id=predecessor.subject_element_id
        AND edge.target_pending_successor_id=NEW.subject_element_id) THEN
      RAISE EXCEPTION 'Semantic context merge-target annotation must bind to the exact target successor.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.annotation_type='near_duplicate' AND NEW.state='resolved' AND NEW.resolution='merged'
     AND operation.action<>'merge-semantic-context-elements' THEN
    RAISE EXCEPTION 'Near duplicate merged resolution requires atomic merge.' USING ERRCODE='23514';
  END IF;
  IF NEW.annotation_type='near_duplicate' AND NEW.state='resolved'
     AND NEW.resolution NOT IN ('merged','kept_distinct') THEN
    RAISE EXCEPTION 'Near duplicate resolution is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.annotation_type IN ('uncertain','needs_more_context') AND NEW.state='resolved'
     AND NEW.resolution NOT IN ('context_sufficient','not_supported') THEN
    RAISE EXCEPTION 'Uncertainty resolution is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.annotation_type='locale_unresolved' AND NEW.state='resolved'
     AND NEW.resolution NOT IN ('governed_locale','global') THEN
    RAISE EXCEPTION 'Locale resolution is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.annotation_type='competitive_unit_unresolved' AND NEW.state='resolved'
     AND NEW.resolution NOT IN ('canonical_unit','not_applicable') THEN
    RAISE EXCEPTION 'Competitive-unit resolution is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_annotation_resolution_basis_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE predecessor signal_semantic_context_review_annotations%ROWTYPE;
DECLARE subject signal_semantic_context_element_versions%ROWTYPE;
DECLARE resolution_actor users%ROWTYPE;
DECLARE input jsonb;basis jsonb;expected_basis text;expected_authority jsonb;expected_prestate text;
BEGIN
  IF NEW.state='open' THEN
    IF NEW.resolution_contract_version IS NOT NULL OR NEW.resolution_basis_digest IS NOT NULL
       OR NEW.resolution_input_digest IS NOT NULL OR NEW.resolution_authority_snapshot IS NOT NULL
       OR NEW.resolution_authority_digest IS NOT NULL OR NEW.resolution_prestate_digest IS NOT NULL
       OR NEW.resolution_poststate_digest IS NOT NULL THEN
      RAISE EXCEPTION 'Open annotations cannot carry resolution authority.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=NEW.generation_id;
  SELECT * INTO predecessor FROM signal_semantic_context_review_annotations WHERE id=NEW.supersedes_annotation_id;
  SELECT * INTO subject FROM signal_semantic_context_element_versions WHERE id=NEW.subject_element_id;
  SELECT * INTO resolution_actor FROM users WHERE id=operation.actor_user_id;
  IF NEW.resolution_contract_version IS DISTINCT FROM 'signal-semantic-context-annotation-resolution-v1'
     OR NEW.resolution_basis_digest IS NULL OR NEW.resolution_input_digest IS NULL
     OR NEW.resolution_authority_snapshot IS NULL OR NEW.resolution_authority_digest IS NULL
     OR NEW.resolution_prestate_digest IS NULL OR NEW.resolution_poststate_digest IS NULL
     OR operation.semantic_context_decision_input IS NULL
     OR operation.semantic_context_decision_input_digest IS DISTINCT FROM NEW.resolution_input_digest THEN
    RAISE EXCEPTION 'Resolved annotations require a complete deliberate resolution basis.' USING ERRCODE='23514';
  END IF;
  input:=operation.semantic_context_decision_input;
  IF signal_semantic_context_digest_json_v2(input) IS DISTINCT FROM NEW.resolution_input_digest THEN
    RAISE EXCEPTION 'Annotation resolution input digest is invalid.' USING ERRCODE='23514';
  END IF;
  basis:=jsonb_build_object('contract_version',NEW.resolution_contract_version,
    'annotation_type',NEW.annotation_type,'resolution',NEW.resolution,
    'reason',NEW.reason_code,'rationale',NEW.rationale);
  expected_basis:=signal_semantic_context_digest_json_v2(basis);
  expected_authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest,
    'actor',jsonb_build_object('id',lower(resolution_actor.id::text),
      'user_type',resolution_actor.user_type,'primary_role',resolution_actor.primary_role));
  expected_prestate:=CASE WHEN operation.action='decide-semantic-context-locale-authority'
    THEN signal_semantic_context_digest_json_v2(jsonb_build_object(
      'contract_version','signal-semantic-context-annotation-absent-v1','annotation_key',NEW.annotation_key))
    ELSE signal_semantic_context_annotation_state_digest_v1(predecessor) END;
  IF NEW.resolution_basis_digest IS DISTINCT FROM expected_basis
     OR NEW.resolution_authority_snapshot IS DISTINCT FROM expected_authority
     OR NEW.resolution_authority_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(expected_authority)
     OR NEW.resolution_prestate_digest IS DISTINCT FROM expected_prestate
     OR NEW.resolution_poststate_digest IS DISTINCT FROM signal_semantic_context_annotation_state_digest_v1(NEW) THEN
    RAISE EXCEPTION 'Annotation resolution basis, authority or state digest is invalid.' USING ERRCODE='23514';
  END IF;
  IF operation.action='decide-semantic-context-locale-authority' THEN
    IF predecessor.id IS NOT NULL OR subject.operation_id<>operation.id
       OR input->>'contract_version' IS DISTINCT FROM 'signal-semantic-context-locale-decision-v1'
       OR input->>'generation_key' IS DISTINCT FROM generation.generation_key
       OR input->>'disposition' IS DISTINCT FROM 'global' OR input->'locale'<>'null'::jsonb
       OR input->>'reason' IS DISTINCT FROM NEW.reason_code
       OR input->>'rationale' IS DISTINCT FROM NEW.rationale
       OR NOT (input->'element_keys') @> to_jsonb(ARRAY[subject.element_key]) THEN
      RAISE EXCEPTION 'Global locale authority input does not match its annotation.' USING ERRCODE='23514';
    END IF;
  ELSIF operation.action IN ('resolve-semantic-context-annotation','repair-semantic-context-annotation-resolution') THEN
    IF jsonb_typeof(input)<>'object'
       OR NOT input ?& ARRAY['contract_version','generation_key','element_key','annotation_key','action',
         'annotation_type','resolution','decision_basis','confirmation']
       OR (input-ARRAY['contract_version','generation_key','element_key','annotation_key','action',
         'annotation_type','resolution','decision_basis','confirmation']::text[])<>'{}'::jsonb
       OR input->>'contract_version' IS DISTINCT FROM 'signal-semantic-context-annotation-resolution-v1'
       OR input->>'generation_key' IS DISTINCT FROM generation.generation_key
       OR input->>'annotation_key' IS DISTINCT FROM NEW.annotation_key
       OR input->>'annotation_type' IS DISTINCT FROM NEW.annotation_type
       OR input->>'resolution' IS DISTINCT FROM NEW.resolution OR input->'decision_basis' IS DISTINCT FROM basis
       OR input->>'action' IS DISTINCT FROM (CASE operation.action
          WHEN 'resolve-semantic-context-annotation' THEN 'resolve' ELSE 'repair' END)
       OR input->>'confirmation' IS DISTINCT FROM (CASE operation.action
          WHEN 'resolve-semantic-context-annotation'
            THEN 'resolve_semantic_context_annotation_with_deliberate_basis'
          ELSE 'repair_semantic_context_annotation_resolution_basis' END) THEN
      RAISE EXCEPTION 'Direct annotation resolution input does not match its successor.' USING ERRCODE='23514';
    END IF;
  ELSE
    IF input->>'reason' IS DISTINCT FROM NEW.reason_code
       OR input->>'rationale' IS DISTINCT FROM NEW.rationale THEN
      RAISE EXCEPTION 'Parent review operation does not seal the annotation resolution basis.' USING ERRCODE='23514';
    END IF;
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
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.action IS DISTINCT FROM expected_action
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_locale_operation_v1(
  target_operation_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE input jsonb;input_keys jsonb;input_count integer;successor_count integer;
DECLARE annotation_count integer;event_count integer;invalid_count integer;
DECLARE pre_digest text;post_digest text;expected_ref text;expected_basis jsonb;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=target_operation_id;
  IF operation.action<>'decide-semantic-context-locale-authority' THEN RETURN; END IF;
  IF operation.status<>'completed' OR operation.result IS NULL
     OR operation.semantic_context_decision_input IS NULL
     OR operation.semantic_context_decision_input_digest IS NULL THEN
    RAISE EXCEPTION 'Locale authority operation did not complete atomically.' USING ERRCODE='23514';
  END IF;
  input:=operation.semantic_context_decision_input;
  IF jsonb_typeof(input)<>'object'
     OR NOT input ?& ARRAY['contract_version','generation_key','element_keys','disposition','locale',
       'reason','rationale','confirmation']
     OR (input-ARRAY['contract_version','generation_key','element_keys','disposition','locale',
       'reason','rationale','confirmation']::text[])<>'{}'::jsonb
     OR input->>'contract_version'<>'signal-semantic-context-locale-decision-v1'
     OR input->>'disposition' NOT IN ('global','locale_specific')
     OR input->>'confirmation'<>'apply_semantic_context_locale_authority_decision'
     OR jsonb_typeof(input->'element_keys')<>'array'
     OR signal_semantic_context_digest_json_v2(input)<>operation.semantic_context_decision_input_digest THEN
    RAISE EXCEPTION 'Locale authority operation input is invalid.' USING ERRCODE='23514';
  END IF;
  input_keys:=input->'element_keys';input_count:=jsonb_array_length(input_keys);
  IF input_count NOT BETWEEN 1 AND 15
     OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(input_keys) item(value))<>input_count
     OR (SELECT COALESCE(jsonb_agg(value ORDER BY convert_to(value,'UTF8')),'[]'::jsonb)
         FROM jsonb_array_elements_text(input_keys) item(value))<>input_keys
     OR ((input->>'disposition')='global' AND input->'locale'<>'null'::jsonb)
     OR ((input->>'disposition')='locale_specific' AND jsonb_typeof(input->'locale')<>'string') THEN
    RAISE EXCEPTION 'Locale authority batch scope is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO generation FROM signal_semantic_context_generations
    WHERE workspace_id=operation.workspace_id AND generation_key=input->>'generation_key';
  IF generation.id IS NULL OR generation.status<>'draft'
     OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
       WHERE successor.supersedes_generation_id=generation.id)
     OR ((input->>'disposition')='locale_specific'
       AND NOT (input->>'locale')=ANY(generation.locale_variants)) THEN
    RAISE EXCEPTION 'Locale authority generation or sealed locale is invalid.' USING ERRCODE='23514';
  END IF;
  expected_basis:=jsonb_build_object('contract_version','signal-semantic-context-locale-decision-v1',
    'disposition',input->>'disposition','locale',input->'locale',
    'reason',input->>'reason','rationale',input->>'rationale');
  SELECT count(*)::int INTO successor_count FROM signal_semantic_context_element_versions
    WHERE operation_id=operation.id AND generation_id=generation.id;
  IF successor_count<>input_count OR EXISTS(
    SELECT 1 FROM signal_semantic_context_element_versions successor
    LEFT JOIN signal_semantic_context_element_versions predecessor ON predecessor.id=successor.supersedes_element_id
    WHERE successor.operation_id=operation.id AND (
      successor.workspace_id<>operation.workspace_id OR successor.generation_id<>generation.id
      OR successor.origin_kind<>'operator_correction' OR successor.disposition<>'pending'
      OR predecessor.id IS NULL OR predecessor.disposition<>'approved'
      OR predecessor.workspace_id<>successor.workspace_id OR predecessor.generation_id<>successor.generation_id
      OR predecessor.element_key<>successor.element_key OR predecessor.element_version+1<>successor.element_version
      OR predecessor.locale IS NOT NULL
      OR successor.element_key NOT IN (SELECT value FROM jsonb_array_elements_text(input_keys) item(value))
      OR successor.element_kind<>predecessor.element_kind OR successor.canonical_key<>predecessor.canonical_key
      OR successor.display_text<>predecessor.display_text OR successor.scope IS DISTINCT FROM predecessor.scope
      OR successor.entity_type IS DISTINCT FROM predecessor.entity_type
      OR successor.entity_id IS DISTINCT FROM predecessor.entity_id
      OR successor.relation_kind IS DISTINCT FROM predecessor.relation_kind
      OR successor.relation_target_key IS DISTINCT FROM predecessor.relation_target_key
      OR successor.confidence IS DISTINCT FROM predecessor.confidence
      OR successor.source_refs_digest<>predecessor.source_refs_digest
      OR successor.original_proposal_element_id IS DISTINCT FROM predecessor.original_proposal_element_id
      OR successor.locale_decision_basis_digest<>signal_semantic_context_digest_json_v2(expected_basis)
      OR successor.locale_decision_input_digest<>operation.semantic_context_decision_input_digest
      OR successor.locale_decision_disposition<>input->>'disposition'
      OR successor.locale_decision_locale IS DISTINCT FROM NULLIF(input->>'locale','')
      OR successor.locale_decision_reason_code<>input->>'reason'
      OR successor.locale_decision_rationale<>input->>'rationale'
      OR successor.locale_decision_prestate_digest<>predecessor.element_digest
      OR successor.locale_decision_poststate_digest<>successor.element_digest
      OR EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
        WHERE child.supersedes_element_id=successor.id))) THEN
    RAISE EXCEPTION 'Locale authority successor cohort is incomplete or heterogeneous.' USING ERRCODE='23514';
  END IF;
  IF (SELECT COALESCE(jsonb_agg(element_key ORDER BY convert_to(element_key,'UTF8')),'[]'::jsonb)
      FROM signal_semantic_context_element_versions WHERE operation_id=operation.id)<>input_keys THEN
    RAISE EXCEPTION 'Locale authority successor keys do not match the exact requested set.' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::int INTO annotation_count FROM signal_semantic_context_review_annotations
    WHERE operation_id=operation.id;
  IF ((input->>'disposition')='global' AND (annotation_count<>input_count OR EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.operation_id=operation.id AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_review_annotations annotation
        WHERE annotation.operation_id=operation.id AND annotation.subject_element_id=successor.id
          AND annotation.annotation_key='locale-authority.'||encode(digest(successor.element_key,'sha256'),'hex')
          AND annotation.annotation_version=1 AND annotation.annotation_type='locale_unresolved'
          AND annotation.state='resolved' AND annotation.resolution='global'))))
     OR ((input->>'disposition')='locale_specific' AND annotation_count<>0) THEN
    RAISE EXCEPTION 'Locale authority global-resolution cohort is incomplete.' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::int INTO event_count FROM signal_semantic_context_events event
    JOIN signal_semantic_context_element_versions successor ON successor.id=event.element_id
    JOIN signal_semantic_context_element_versions predecessor ON predecessor.id=successor.supersedes_element_id
    WHERE event.operation_id=operation.id AND event.workspace_id=operation.workspace_id
      AND event.generation_id=generation.id AND event.event_kind='locale_authority_decided'
      AND event.event_index BETWEEN 0 AND input_count-1
      AND event.previous_state_digest=predecessor.element_digest
      AND event.next_state_digest=successor.element_digest
      AND event.actor_user_id=operation.actor_user_id;
  IF event_count<>input_count OR (SELECT count(*) FROM signal_semantic_context_events
      WHERE operation_id=operation.id)<>input_count
     OR (SELECT count(DISTINCT event_index) FROM signal_semantic_context_events
      WHERE operation_id=operation.id)<>input_count THEN
    RAISE EXCEPTION 'Locale authority event cohort is incomplete.' USING ERRCODE='23514';
  END IF;
  pre_digest:=signal_semantic_context_draft_digest_v2(generation.id,operation.id);
  post_digest:=signal_semantic_context_draft_digest_v2(generation.id);
  expected_ref:=left(post_digest,15)||'…'||right(post_digest,8);
  IF generation.draft_digest<>post_digest OR jsonb_typeof(operation.result)<>'object'
     OR NOT operation.result ?& ARRAY['generation_key','decided','disposition','locale','pending','draft_digest_ref']
     OR (operation.result-ARRAY['generation_key','decided','disposition','locale','pending','draft_digest_ref']::text[])<>'{}'::jsonb
     OR jsonb_typeof(operation.result->'decided')<>'number'
     OR jsonb_typeof(operation.result->'pending')<>'number'
     OR operation.result->>'generation_key'<>generation.generation_key
     OR operation.result->>'disposition'<>input->>'disposition'
     OR operation.result->'locale' IS DISTINCT FROM input->'locale'
     OR (operation.result->>'decided')::int<>input_count
     OR (operation.result->>'pending')::int<>input_count
     OR operation.result->>'draft_digest_ref'<>expected_ref THEN
    RAISE EXCEPTION 'Locale authority result or draft seal is incomplete.' USING ERRCODE='23514';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION enforce_signal_semantic_context_locale_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_signal_semantic_context_locale_operation_v1(
    COALESCE((to_jsonb(NEW)->>'operation_id')::uuid,(to_jsonb(NEW)->>'id')::uuid));
  RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_locale_operation_v1
  AFTER INSERT OR UPDATE ON signal_governance_control_operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.action='decide-semantic-context-locale-authority')
  EXECUTE FUNCTION enforce_signal_semantic_context_locale_operation_v1();
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_locale_successor_v1
  AFTER INSERT ON signal_semantic_context_element_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.locale_decision_contract_version='signal-semantic-context-locale-decision-v1'
    AND NEW.operation_id IS NOT NULL)
  EXECUTE FUNCTION enforce_signal_semantic_context_locale_operation_v1();
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_locale_annotation_v1
  AFTER INSERT ON signal_semantic_context_review_annotations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.annotation_type='locale_unresolved' AND NEW.resolution='global'
    AND NEW.resolution_contract_version='signal-semantic-context-annotation-resolution-v1')
  EXECUTE FUNCTION enforce_signal_semantic_context_locale_operation_v1();

CREATE OR REPLACE FUNCTION signal_semantic_context_locale_authority_valid_v1(target_element_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE current_leaf signal_semantic_context_element_versions%ROWTYPE;
DECLARE generation signal_semantic_context_generations%ROWTYPE;
DECLARE proposal_origin signal_semantic_context_element_versions%ROWTYPE;
DECLARE decision_origin signal_semantic_context_element_versions%ROWTYPE;
DECLARE decision_operation signal_governance_control_operations%ROWTYPE;
DECLARE expected_basis jsonb;
BEGIN
  SELECT * INTO current_leaf FROM signal_semantic_context_element_versions WHERE id=target_element_id;
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=current_leaf.generation_id;
  IF current_leaf.id IS NULL OR current_leaf.disposition<>'approved' OR generation.id IS NULL THEN RETURN false; END IF;

  IF current_leaf.locale_decision_contract_version IS NULL THEN
    SELECT * INTO proposal_origin FROM signal_semantic_context_element_versions
      WHERE id=COALESCE(current_leaf.original_proposal_element_id,current_leaf.id);
    RETURN current_leaf.locale IS NOT NULL AND current_leaf.locale=ANY(generation.locale_variants)
      AND proposal_origin.id IS NOT NULL AND proposal_origin.generation_id=current_leaf.generation_id
      AND proposal_origin.element_key=current_leaf.element_key
      AND proposal_origin.origin_kind IN ('server_projection','provider_proposal')
      AND proposal_origin.locale IS NOT DISTINCT FROM current_leaf.locale
      AND proposal_origin.locale_decision_contract_version IS NULL;
  END IF;

  IF current_leaf.locale_decision_contract_version<>'signal-semantic-context-locale-decision-v1'
     OR current_leaf.locale_decision_disposition NOT IN ('global','locale_specific') THEN RETURN false; END IF;
  SELECT * INTO decision_origin FROM signal_semantic_context_element_versions decision
    WHERE decision.generation_id=current_leaf.generation_id AND decision.element_key=current_leaf.element_key
      AND decision.element_digest=current_leaf.locale_decision_poststate_digest
      AND decision.locale_decision_contract_version='signal-semantic-context-locale-decision-v1'
    ORDER BY decision.element_version LIMIT 1;
  SELECT * INTO decision_operation FROM signal_governance_control_operations WHERE id=decision_origin.operation_id;
  expected_basis:=jsonb_build_object('contract_version',current_leaf.locale_decision_contract_version,
    'disposition',current_leaf.locale_decision_disposition,'locale',current_leaf.locale_decision_locale,
    'reason',current_leaf.locale_decision_reason_code,'rationale',current_leaf.locale_decision_rationale);
  IF decision_origin.id IS NULL OR decision_operation.action<>'decide-semantic-context-locale-authority'
     OR decision_operation.status<>'completed'
     OR current_leaf.locale_decision_basis_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(expected_basis)
     OR current_leaf.locale_decision_input_digest IS DISTINCT FROM decision_operation.semantic_context_decision_input_digest
     OR current_leaf.locale_decision_authority_digest IS DISTINCT FROM
        signal_semantic_context_digest_json_v2(current_leaf.locale_decision_authority_snapshot)
     OR current_leaf.locale_decision_authority_snapshot->>'brand_os_digest' IS DISTINCT FROM generation.brand_os_digest
     OR current_leaf.locale_decision_authority_snapshot->>'knowledge_digest' IS DISTINCT FROM generation.knowledge_digest
     OR current_leaf.locale_decision_authority_snapshot->>'locale_context_digest' IS DISTINCT FROM generation.locale_context_digest
     OR current_leaf.locale_decision_authority_snapshot->>'proposal_provider_lineage_digest'
        IS DISTINCT FROM generation.proposal_provider_lineage_digest
     OR ROW(current_leaf.locale,current_leaf.locale_decision_contract_version,
       current_leaf.locale_decision_disposition,current_leaf.locale_decision_locale,
       current_leaf.locale_decision_reason_code,current_leaf.locale_decision_rationale,
       current_leaf.locale_decision_basis_digest,current_leaf.locale_decision_input_digest,
       current_leaf.locale_decision_authority_snapshot,current_leaf.locale_decision_authority_digest,
       current_leaf.locale_decision_prestate_digest,current_leaf.locale_decision_poststate_digest)
        IS DISTINCT FROM ROW(decision_origin.locale,decision_origin.locale_decision_contract_version,
       decision_origin.locale_decision_disposition,decision_origin.locale_decision_locale,
       decision_origin.locale_decision_reason_code,decision_origin.locale_decision_rationale,
       decision_origin.locale_decision_basis_digest,decision_origin.locale_decision_input_digest,
       decision_origin.locale_decision_authority_snapshot,decision_origin.locale_decision_authority_digest,
       decision_origin.locale_decision_prestate_digest,decision_origin.locale_decision_poststate_digest) THEN
    RETURN false;
  END IF;
  IF current_leaf.locale_decision_disposition='locale_specific' THEN
    RETURN current_leaf.locale IS NOT NULL AND current_leaf.locale=current_leaf.locale_decision_locale
      AND current_leaf.locale=ANY(generation.locale_variants);
  END IF;
  RETURN current_leaf.locale IS NULL AND current_leaf.locale_decision_locale IS NULL
    AND EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations annotation
      WHERE annotation.generation_id=current_leaf.generation_id
        AND annotation.annotation_key='locale-authority.'||encode(digest(current_leaf.element_key,'sha256'),'hex')
        AND annotation.annotation_type='locale_unresolved' AND annotation.state='resolved'
        AND annotation.resolution='global' AND annotation.resolution_basis_digest IS NOT NULL
        AND annotation.resolution_input_digest=current_leaf.locale_decision_input_digest
        AND annotation.resolution_authority_digest=current_leaf.locale_decision_authority_digest
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations child
          WHERE child.supersedes_annotation_id=annotation.id));
END; $$;

ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb)
  RENAME TO signal_semantic_context_publication_snapshot_pre_0100_v2;

CREATE OR REPLACE FUNCTION signal_semantic_context_publication_snapshot_v2(
  target_generation_id uuid,
  expected_live_authority jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE base jsonb;generation signal_semantic_context_generations%ROWTYPE;
DECLARE locale_graph jsonb;locale_graph_digest text;review_digest text;publication_graph jsonb;
DECLARE pack_digest text;preflight jsonb;counts jsonb;blockers text[]:='{}';locale_missing integer;
BEGIN
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=target_generation_id;
  IF generation.id IS NULL THEN
    RAISE EXCEPTION 'Semantic context generation not found.' USING ERRCODE='P0002';
  END IF;
  base:=signal_semantic_context_publication_snapshot_pre_0100_v2(target_generation_id,expected_live_authority);
  WITH current_leaves AS (
    SELECT element.* FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=generation.id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*) FILTER(WHERE disposition='approved'
      AND NOT signal_semantic_context_locale_authority_valid_v1(id))::int
    INTO locale_missing FROM current_leaves;
  locale_graph:=jsonb_build_object('contract_version','signal-semantic-context-locale-authority-graph-v1',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'decisions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'element_key',element_key,'element_version',element_version,
      'locale_decision_contract_version',locale_decision_contract_version,
      'locale_decision_disposition',locale_decision_disposition,'locale_decision_locale',locale_decision_locale,
      'locale_decision_reason_code',locale_decision_reason_code,
      'locale_decision_rationale',locale_decision_rationale,
      'locale_decision_basis_digest',locale_decision_basis_digest,
      'locale_decision_input_digest',locale_decision_input_digest,
      'locale_decision_authority_digest',locale_decision_authority_digest,
      'locale_decision_prestate_digest',locale_decision_prestate_digest,
      'locale_decision_poststate_digest',locale_decision_poststate_digest)
      ORDER BY convert_to(element_key,'UTF8'),element_version)
      FROM signal_semantic_context_element_versions WHERE generation_id=generation.id
        AND locale_decision_contract_version IS NOT NULL),'[]'::jsonb));
  locale_graph_digest:=signal_semantic_context_digest_json_v2(locale_graph);
  review_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-review-graph-v5',
    'prior_review_graph_digest',base->>'review_graph_digest',
    'locale_authority_graph_digest',locale_graph_digest));
  publication_graph:=jsonb_build_object('contract_version','signal-semantic-context-publication-graph-v2',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'candidate_pack_digest',base->>'candidate_pack_digest','evidence_graph_digest',base->>'evidence_graph_digest',
    'review_graph_digest',review_digest,'authority',base->'preflight'->'authority');
  pack_digest:=signal_semantic_context_digest_json_v2(publication_graph);
  counts:=(base->'counts')||jsonb_build_object('locale_market_required_unresolved',locale_missing);
  SELECT COALESCE(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) INTO blockers
    FROM jsonb_array_elements_text(base->'blockers') item(value)
    WHERE value<>'locale_market_required_unresolved';
  IF generation.status='draft' AND locale_missing>0 THEN
    blockers:=array_append(blockers,'locale_market_required_unresolved');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item),'{}'::text[]) INTO blockers FROM unnest(blockers) item;
  preflight:=(base->'preflight')||jsonb_build_object('review_graph_digest',review_digest,
    'semantic_context_pack_digest',pack_digest,'counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,'locale_authority_graph_digest',locale_graph_digest);
  RETURN base||jsonb_build_object('review_graph_digest',review_digest,
    'semantic_context_pack_digest',pack_digest,
    'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight),
    'counts',counts,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,'preflight',preflight);
END; $$;

COMMENT ON FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb) IS
  '0100 locale/global-authority-aware publication snapshot; reopened leaves remain pending until separately approved.';
