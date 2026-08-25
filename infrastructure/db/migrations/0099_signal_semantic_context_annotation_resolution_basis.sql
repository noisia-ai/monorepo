-- 0099 — deliberate Semantic Context annotation-resolution basis (forward-only).
-- Historical annotation rows remain byte-for-byte intact. A current resolved leaf
-- without the sealed basis below blocks publication until an append-only repair.

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
    'repair-semantic-context-annotation-resolution'
  ));

ALTER TABLE signal_semantic_context_review_annotations
  ADD COLUMN resolution_contract_version text,
  ADD COLUMN resolution_basis_digest text,
  ADD COLUMN resolution_input_digest text,
  ADD COLUMN resolution_authority_snapshot jsonb,
  ADD COLUMN resolution_authority_digest text,
  ADD COLUMN resolution_prestate_digest text,
  ADD COLUMN resolution_poststate_digest text;

ALTER TABLE signal_semantic_context_review_annotations
  ADD CONSTRAINT signal_semantic_context_annotation_resolution_basis_all_or_none CHECK (
    (resolution_contract_version IS NULL AND resolution_basis_digest IS NULL
      AND resolution_input_digest IS NULL AND resolution_authority_snapshot IS NULL
      AND resolution_authority_digest IS NULL AND resolution_prestate_digest IS NULL
      AND resolution_poststate_digest IS NULL)
    OR
    (resolution_contract_version IS NOT NULL AND resolution_basis_digest IS NOT NULL
      AND resolution_input_digest IS NOT NULL AND resolution_authority_snapshot IS NOT NULL
      AND resolution_authority_digest IS NOT NULL AND resolution_prestate_digest IS NOT NULL
      AND resolution_poststate_digest IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT signal_semantic_context_annotation_resolution_basis_shape CHECK (
    resolution_contract_version IS NULL OR (
      resolution_contract_version='signal-semantic-context-annotation-resolution-v1'
      AND jsonb_typeof(resolution_authority_snapshot)='object'
      AND resolution_basis_digest ~ '^sha256:[0-9a-f]{64}$'
      AND resolution_input_digest ~ '^sha256:[0-9a-f]{64}$'
      AND resolution_authority_digest ~ '^sha256:[0-9a-f]{64}$'
      AND resolution_prestate_digest ~ '^sha256:[0-9a-f]{64}$'
      AND resolution_poststate_digest ~ '^sha256:[0-9a-f]{64}$'
    )
  ) NOT VALID;

COMMENT ON COLUMN signal_semantic_context_review_annotations.resolution_basis_digest IS
  '0099 deliberate operator basis; NULL preserves pre-0099 annotation history.';
COMMENT ON COLUMN signal_semantic_context_review_annotations.resolution_authority_snapshot IS
  'Server-owned Brand OS, Knowledge, locale and provider-lineage snapshot at resolution time.';

CREATE OR REPLACE FUNCTION signal_semantic_context_annotation_state_digest_v1(
  annotation signal_semantic_context_review_annotations
)
RETURNS text LANGUAGE sql STABLE STRICT AS $$
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-annotation-state-v1',
    'annotation_key',annotation.annotation_key,
    'annotation_version',annotation.annotation_version,
    'annotation_type',annotation.annotation_type,
    'state',annotation.state,
    'resolution',annotation.resolution,
    'subject_element_id',lower(annotation.subject_element_id::text),
    'related_element_ids',COALESCE((SELECT jsonb_agg(lower(value::text)
      ORDER BY convert_to(lower(value::text),'UTF8')) FROM unnest(annotation.related_element_ids) value),'[]'::jsonb),
    'reason_code',annotation.reason_code,
    'rationale',annotation.rationale,
    'resolution_contract_version',annotation.resolution_contract_version,
    'resolution_basis_digest',annotation.resolution_basis_digest,
    'resolution_input_digest',annotation.resolution_input_digest,
    'resolution_authority_digest',annotation.resolution_authority_digest
  ))
$$;

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
       'repair-semantic-context-annotation-resolution') THEN
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
    IF NEW.annotation_version<>1 OR NEW.state<>'open' OR operation.action<>'annotate-semantic-context-element' THEN
      RAISE EXCEPTION 'Semantic context annotation creation is invalid.' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO predecessor FROM signal_semantic_context_review_annotations WHERE id=NEW.supersedes_annotation_id;
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
      WHERE successor.id=NEW.subject_element_id
        AND successor.supersedes_element_id=predecessor.subject_element_id
        AND successor.generation_id=NEW.generation_id AND successor.workspace_id=NEW.workspace_id
        AND successor.operation_id=NEW.operation_id AND successor.origin_kind='operator_correction'
    ) THEN
      RAISE EXCEPTION 'Semantic context correction annotation must bind to the exact element successor.'
        USING ERRCODE='23514';
    ELSIF operation.action='merge-semantic-context-elements' AND NEW.resolution='merged' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_merge_edges edge
      WHERE edge.operation_id=NEW.operation_id AND edge.generation_id=NEW.generation_id
        AND edge.workspace_id=NEW.workspace_id AND edge.source_predecessor_id=predecessor.subject_element_id
        AND NEW.subject_element_id=predecessor.subject_element_id
        AND edge.target_predecessor_id=ANY(predecessor.related_element_ids)
    ) THEN
      RAISE EXCEPTION 'Semantic context merge-source annotation authority is invalid.' USING ERRCODE='23514';
    ELSIF operation.action='merge-semantic-context-elements' AND NEW.resolution IS DISTINCT FROM 'merged' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_merge_edges edge
      WHERE edge.operation_id=NEW.operation_id AND edge.generation_id=NEW.generation_id
        AND edge.workspace_id=NEW.workspace_id AND edge.target_predecessor_id=predecessor.subject_element_id
        AND edge.target_pending_successor_id=NEW.subject_element_id
    ) THEN
      RAISE EXCEPTION 'Semantic context merge-target annotation must bind to the exact target successor.' USING ERRCODE='23514';
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
DECLARE resolution_actor users%ROWTYPE;
DECLARE input jsonb;basis jsonb;expected_basis text;expected_authority jsonb;
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
  IF NEW.resolution_basis_digest IS DISTINCT FROM expected_basis
     OR NEW.resolution_authority_snapshot IS DISTINCT FROM expected_authority
     OR NEW.resolution_authority_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(expected_authority)
     OR NEW.resolution_prestate_digest IS DISTINCT FROM signal_semantic_context_annotation_state_digest_v1(predecessor)
     OR NEW.resolution_poststate_digest IS DISTINCT FROM signal_semantic_context_annotation_state_digest_v1(NEW) THEN
    RAISE EXCEPTION 'Annotation resolution basis, authority or state digest is invalid.' USING ERRCODE='23514';
  END IF;
  IF operation.action IN ('resolve-semantic-context-annotation','repair-semantic-context-annotation-resolution') THEN
    IF jsonb_typeof(input)<>'object'
       OR NOT input ?& ARRAY['contract_version','generation_key','element_key','annotation_key','action',
         'annotation_type','resolution','decision_basis','confirmation']
       OR (input-ARRAY['contract_version','generation_key','element_key','annotation_key','action',
         'annotation_type','resolution','decision_basis','confirmation']::text[])<>'{}'::jsonb
       OR input->>'contract_version' IS DISTINCT FROM 'signal-semantic-context-annotation-resolution-v1'
       OR input->>'generation_key' IS DISTINCT FROM generation.generation_key
       OR input->>'annotation_key' IS DISTINCT FROM NEW.annotation_key
       OR input->>'annotation_type' IS DISTINCT FROM NEW.annotation_type
       OR input->>'resolution' IS DISTINCT FROM NEW.resolution
       OR input->'decision_basis' IS DISTINCT FROM basis
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

CREATE TRIGGER trg_validate_signal_semantic_context_annotation_resolution_basis_v1
  BEFORE INSERT ON signal_semantic_context_review_annotations
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_annotation_resolution_basis_v1();

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
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.action IS DISTINCT FROM expected_action
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_annotation_resolution_operation_v1(
  target_operation_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE successor signal_semantic_context_review_annotations%ROWTYPE;
DECLARE subject signal_semantic_context_element_versions%ROWTYPE;
DECLARE event_count integer;resolved_count integer;operation_row_count integer;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=target_operation_id;
  IF operation.action NOT IN ('resolve-semantic-context-annotation',
      'repair-semantic-context-annotation-resolution') THEN RETURN; END IF;
  IF operation.status<>'completed' OR operation.result IS NULL THEN
    RAISE EXCEPTION 'Annotation resolution operation did not complete atomically.' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::int INTO operation_row_count FROM signal_semantic_context_review_annotations
    WHERE operation_id=operation.id;
  SELECT count(*)::int INTO resolved_count FROM signal_semantic_context_review_annotations
    WHERE operation_id=operation.id AND state='resolved';
  IF operation_row_count<>1 OR resolved_count<>1 THEN
    RAISE EXCEPTION 'Annotation resolution operation must own exactly one row, its resolved successor.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO successor FROM signal_semantic_context_review_annotations
    WHERE operation_id=operation.id AND state='resolved';
  SELECT * INTO subject FROM signal_semantic_context_element_versions
    WHERE id=successor.subject_element_id;
  IF subject.id IS NULL
     OR subject.workspace_id<>operation.workspace_id
     OR subject.generation_id<>successor.generation_id
     OR EXISTS(SELECT 1 FROM signal_semantic_context_element_versions subject_successor
       WHERE subject_successor.supersedes_element_id=subject.id)
     OR operation.semantic_context_decision_input->>'element_key' IS DISTINCT FROM subject.element_key THEN
    RAISE EXCEPTION 'Annotation resolution operation element key does not match its current subject.' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(operation.result)<>'object'
     OR NOT operation.result ?& ARRAY['annotation_key','annotation_version','state','resolution','resolution_basis']
     OR (operation.result-ARRAY['annotation_key','annotation_version','state','resolution','resolution_basis']::text[])<>'{}'::jsonb
     OR jsonb_typeof(operation.result->'annotation_version')<>'number'
     OR operation.result->>'annotation_key' IS DISTINCT FROM successor.annotation_key
     OR (operation.result->>'annotation_version')::numeric IS DISTINCT FROM successor.annotation_version
     OR operation.result->>'state' IS DISTINCT FROM 'resolved'
     OR operation.result->>'resolution' IS DISTINCT FROM successor.resolution
     OR operation.result->>'resolution_basis' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'Annotation resolution result does not match its successor.' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::int INTO event_count FROM signal_semantic_context_events event
    WHERE event.operation_id=operation.id AND event.workspace_id=operation.workspace_id
      AND event.generation_id=successor.generation_id AND event.element_id=successor.subject_element_id
      AND event.event_index=0 AND event.event_kind='review_annotation_resolved'
      AND event.previous_state_digest=successor.resolution_prestate_digest
      AND event.next_state_digest=successor.resolution_poststate_digest
      AND event.actor_user_id=operation.actor_user_id;
  IF event_count<>1 OR (SELECT count(*) FROM signal_semantic_context_events
      WHERE operation_id=operation.id)<>1 THEN
    RAISE EXCEPTION 'Annotation resolution event graph is incomplete.' USING ERRCODE='23514';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION enforce_signal_semantic_context_annotation_resolution_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_signal_semantic_context_annotation_resolution_operation_v1(
    COALESCE((to_jsonb(NEW)->>'operation_id')::uuid,(to_jsonb(NEW)->>'id')::uuid));
  RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_annotation_resolution_operation_v1
  AFTER INSERT OR UPDATE ON signal_governance_control_operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.action IN ('resolve-semantic-context-annotation','repair-semantic-context-annotation-resolution'))
  EXECUTE FUNCTION enforce_signal_semantic_context_annotation_resolution_operation_v1();
CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_annotation_resolution_successor_v1
  AFTER INSERT ON signal_semantic_context_review_annotations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.resolution_contract_version='signal-semantic-context-annotation-resolution-v1')
  EXECUTE FUNCTION enforce_signal_semantic_context_annotation_resolution_operation_v1();

ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb)
  RENAME TO signal_semantic_context_publication_snapshot_pre_0099_v2;

CREATE OR REPLACE FUNCTION signal_semantic_context_publication_snapshot_v2(
  target_generation_id uuid,
  expected_live_authority jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE base jsonb;generation signal_semantic_context_generations%ROWTYPE;
DECLARE basis_graph jsonb;basis_graph_digest text;review_digest text;publication_graph jsonb;
DECLARE pack_digest text;preflight jsonb;counts jsonb;blockers text[]:='{}';basis_missing integer;
BEGIN
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=target_generation_id;
  IF generation.id IS NULL THEN RAISE EXCEPTION 'Semantic context generation not found.' USING ERRCODE='P0002'; END IF;
  base:=signal_semantic_context_publication_snapshot_pre_0099_v2(target_generation_id,expected_live_authority);
  WITH current_annotations AS (
    SELECT annotation.* FROM signal_semantic_context_review_annotations annotation
    WHERE annotation.generation_id=generation.id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_review_annotations successor
      WHERE successor.supersedes_annotation_id=annotation.id)
  ) SELECT count(*) FILTER(WHERE state='resolved' AND (
      resolution_contract_version IS NULL OR resolution_basis_digest IS NULL
      OR resolution_input_digest IS NULL OR resolution_authority_snapshot IS NULL
      OR resolution_authority_digest IS NULL OR resolution_prestate_digest IS NULL
      OR resolution_poststate_digest IS NULL))::int INTO basis_missing FROM current_annotations;
  basis_graph:=jsonb_build_object('contract_version','signal-semantic-context-annotation-resolution-graph-v1',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'annotations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'annotation_key',annotation_key,'annotation_version',annotation_version,
      'resolution_contract_version',resolution_contract_version,
      'resolution_basis_digest',resolution_basis_digest,'resolution_input_digest',resolution_input_digest,
      'resolution_authority_digest',resolution_authority_digest,
      'resolution_prestate_digest',resolution_prestate_digest,
      'resolution_poststate_digest',resolution_poststate_digest)
      ORDER BY convert_to(annotation_key,'UTF8'),annotation_version)
      FROM signal_semantic_context_review_annotations WHERE generation_id=generation.id),'[]'::jsonb));
  basis_graph_digest:=signal_semantic_context_digest_json_v2(basis_graph);
  review_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-review-graph-v4',
    'prior_review_graph_digest',base->>'review_graph_digest',
    'annotation_resolution_basis_graph_digest',basis_graph_digest));
  publication_graph:=jsonb_build_object('contract_version','signal-semantic-context-publication-graph-v2',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'candidate_pack_digest',base->>'candidate_pack_digest','evidence_graph_digest',base->>'evidence_graph_digest',
    'review_graph_digest',review_digest,'authority',base->'preflight'->'authority');
  pack_digest:=signal_semantic_context_digest_json_v2(publication_graph);
  counts:=(base->'counts')||jsonb_build_object('annotation_resolution_basis_missing',basis_missing);
  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::text[]) INTO blockers
    FROM jsonb_array_elements_text(base->'blockers') item(value);
  IF generation.status='draft' AND basis_missing>0 THEN
    blockers:=array_append(blockers,'annotation_resolution_basis_missing');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item),'{}'::text[]) INTO blockers FROM unnest(blockers) item;
  preflight:=(base->'preflight')||jsonb_build_object('review_graph_digest',review_digest,
    'semantic_context_pack_digest',pack_digest,'counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0,
    'annotation_resolution_basis_graph_digest',basis_graph_digest);
  RETURN base||jsonb_build_object('review_graph_digest',review_digest,
    'semantic_context_pack_digest',pack_digest,
    'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight),
    'counts',counts,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,'preflight',preflight);
END; $$;

COMMENT ON FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb) IS
  '0099 resolution-basis-aware snapshot; deficient current resolved annotations block publication.';
