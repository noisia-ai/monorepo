-- 0098 — Semantic Context deliberate decision basis (forward-only).
-- Historical element versions remain byte-for-byte intact and may retain a NULL basis.

-- PostgreSQL btrim(text) only removes U+0020, while ECMAScript String.trim() removes
-- the closed WhiteSpace + LineTerminator set below. Decision basis normalization must
-- be identical at the browser/service and database boundaries.
CREATE OR REPLACE FUNCTION signal_semantic_context_trim_ecmascript_v2(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

ALTER TABLE signal_governance_control_operations
  ADD COLUMN semantic_context_decision_input jsonb,
  ADD COLUMN semantic_context_decision_input_digest text;

ALTER TABLE signal_governance_control_operations
  ADD CONSTRAINT signal_governance_control_decision_input_all_or_none CHECK (
    (semantic_context_decision_input IS NULL AND semantic_context_decision_input_digest IS NULL)
    OR
    (semantic_context_decision_input IS NOT NULL AND semantic_context_decision_input_digest IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT signal_governance_control_decision_input_digest CHECK (
    semantic_context_decision_input_digest IS NULL
    OR semantic_context_decision_input_digest ~ '^sha256:[0-9a-f]{64}$'
  ) NOT VALID;

COMMENT ON COLUMN signal_governance_control_operations.semantic_context_decision_input IS
  '0098 DB-owned collective input for one Semantic Context decision operation; NULL preserves earlier operations.';

CREATE OR REPLACE FUNCTION protect_signal_governance_control_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Governance control operation history is append-only' USING ERRCODE='55000';
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

ALTER TABLE signal_semantic_context_element_versions
  ADD COLUMN decision_contract_version text,
  ADD COLUMN decision_reason_code text,
  ADD COLUMN decision_rationale text,
  ADD COLUMN decision_basis_digest text;

ALTER TABLE signal_semantic_context_element_versions
  ADD CONSTRAINT signal_semantic_context_decision_basis_all_or_none CHECK (
    (decision_contract_version IS NULL AND decision_reason_code IS NULL
      AND decision_rationale IS NULL AND decision_basis_digest IS NULL)
    OR
    (decision_contract_version IS NOT NULL AND decision_reason_code IS NOT NULL
      AND decision_rationale IS NOT NULL AND decision_basis_digest IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT signal_semantic_context_decision_basis_valid CHECK (
    decision_contract_version IS NULL OR (
      decision_contract_version='signal-semantic-context-decision-v2'
      AND decision_reason_code IN (
        'duplicate_same_concept','alias_or_variant','canonicalization','semantic_boundary',
        'locale_resolution','competitive_unit_resolution','insufficient_context','operator_correction'
      )
      AND decision_rationale=signal_semantic_context_trim_ecmascript_v2(
        normalize(decision_rationale,NFC))
      AND char_length(decision_rationale) BETWEEN 1 AND 1000
      AND decision_basis_digest ~ '^sha256:[0-9a-f]{64}$'
    )
  ) NOT VALID;

COMMENT ON COLUMN signal_semantic_context_element_versions.decision_contract_version IS
  'Forward-only deliberate decision contract; NULL preserves pre-0098 history.';
COMMENT ON COLUMN signal_semantic_context_element_versions.decision_rationale IS
  'NFC-normalized operator rationale sealed into the decision successor and review graph.';

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_decision_basis_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_basis_digest text;expected_element_digest text;
BEGIN
  IF NEW.origin_kind='operator_decision' THEN
    IF NEW.disposition NOT IN ('approved','rejected')
       OR NEW.decision_contract_version IS DISTINCT FROM 'signal-semantic-context-decision-v2'
       OR NEW.decision_reason_code IS NULL OR NEW.decision_rationale IS NULL
       OR NEW.decision_basis_digest IS NULL THEN
      RAISE EXCEPTION 'New operator decisions require a complete deliberate decision basis.'
        USING ERRCODE='23514';
    END IF;
    expected_basis_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
      'contract_version',NEW.decision_contract_version,
      'reason',NEW.decision_reason_code,
      'rationale',NEW.decision_rationale));
    IF NEW.decision_basis_digest IS DISTINCT FROM expected_basis_digest THEN
      RAISE EXCEPTION 'Decision basis digest does not match its canonical fields.'
        USING ERRCODE='23514';
    END IF;
    expected_element_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
      'contract_version','signal-semantic-context-element-v3',
      'element_key',NEW.element_key,'element_kind',NEW.element_kind,
      'canonical_key',NEW.canonical_key,'display_text',NEW.display_text,
      'scope',NEW.scope,'entity_type',NEW.entity_type,'entity_id',lower(NEW.entity_id::text),
      'locale',NEW.locale,'relation_kind',NEW.relation_kind,
      'relation_target_key',NEW.relation_target_key,'element_version',NEW.element_version,
      'disposition',NEW.disposition,'source_refs_digest',NEW.source_refs_digest,
      'decision_basis',jsonb_build_object('contract_version',NEW.decision_contract_version,
        'reason',NEW.decision_reason_code,'rationale',NEW.decision_rationale)));
    IF NEW.element_digest IS DISTINCT FROM expected_element_digest THEN
      RAISE EXCEPTION 'Decision element digest does not seal its deliberate basis.'
        USING ERRCODE='23514';
    END IF;
  ELSIF NEW.decision_contract_version IS NOT NULL OR NEW.decision_reason_code IS NOT NULL
      OR NEW.decision_rationale IS NOT NULL OR NEW.decision_basis_digest IS NOT NULL THEN
    RAISE EXCEPTION 'Only operator decision successors may carry a decision basis.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_signal_semantic_context_decision_basis_v2
  BEFORE INSERT ON signal_semantic_context_element_versions
  FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_decision_basis_v2();

-- Recompute the draft seal from authority rows instead of trusting the mutable cached
-- generation column. When an operation is supplied, reconstruct its exact pre-state by
-- replacing that operation's current successors with their immediate predecessors.
CREATE OR REPLACE FUNCTION signal_semantic_context_draft_digest_v2(
  target_generation_id uuid,
  target_operation_id uuid DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE total_rows integer;reached_rows integer;distinct_reached_rows integer;
DECLARE forked_rows integer;duplicate_leaf_keys integer;operation_rows integer;
DECLARE operation_current_rows integer;invalid_operation_rows integer;elements jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations
      WHERE id=target_generation_id) THEN
    RAISE EXCEPTION 'Semantic Context draft digest generation is missing.' USING ERRCODE='23514';
  END IF;

  SELECT count(*)::int INTO total_rows FROM signal_semantic_context_element_versions
    WHERE generation_id=target_generation_id;
  WITH RECURSIVE lineage(id) AS (
    SELECT id FROM signal_semantic_context_element_versions
      WHERE generation_id=target_generation_id AND supersedes_element_id IS NULL
    UNION
    SELECT successor.id FROM lineage predecessor
      JOIN signal_semantic_context_element_versions successor
        ON successor.generation_id=target_generation_id
       AND successor.supersedes_element_id=predecessor.id
  ) SELECT count(*)::int,count(DISTINCT id)::int
    INTO reached_rows,distinct_reached_rows FROM lineage;
  SELECT count(*)::int INTO forked_rows FROM (
    SELECT supersedes_element_id FROM signal_semantic_context_element_versions
      WHERE generation_id=target_generation_id AND supersedes_element_id IS NOT NULL
      GROUP BY supersedes_element_id HAVING count(*)<>1
  ) forks;
  WITH leaves AS (
    SELECT element.element_key FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=target_generation_id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*)::int INTO duplicate_leaf_keys FROM (
    SELECT element_key FROM leaves GROUP BY element_key HAVING count(*)<>1
  ) duplicates;
  IF total_rows IS DISTINCT FROM reached_rows OR reached_rows IS DISTINCT FROM distinct_reached_rows
     OR forked_rows<>0 OR duplicate_leaf_keys<>0 THEN
    RAISE EXCEPTION 'Semantic Context draft lineage is forked, cyclic, or incomplete.'
      USING ERRCODE='23514';
  END IF;

  IF target_operation_id IS NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'element_key',leaf.element_key,'element_version',leaf.element_version,
        'element_digest',leaf.element_digest,'disposition',leaf.disposition)
        ORDER BY convert_to(leaf.element_key,'UTF8')),'[]'::jsonb)
      INTO elements
    FROM signal_semantic_context_element_versions leaf
    WHERE leaf.generation_id=target_generation_id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=leaf.id);
  ELSE
    SELECT count(*)::int INTO operation_rows
      FROM signal_semantic_context_element_versions
      WHERE operation_id=target_operation_id AND generation_id=target_generation_id;
    SELECT count(*)::int INTO operation_current_rows
      FROM signal_semantic_context_element_versions successor
      WHERE successor.operation_id=target_operation_id
        AND successor.generation_id=target_generation_id
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
          WHERE child.supersedes_element_id=successor.id);
    SELECT count(*)::int INTO invalid_operation_rows
      FROM signal_semantic_context_element_versions successor
      LEFT JOIN signal_semantic_context_element_versions predecessor
        ON predecessor.id=successor.supersedes_element_id
      WHERE successor.operation_id=target_operation_id
        AND (successor.generation_id IS DISTINCT FROM target_generation_id
          OR predecessor.id IS NULL
          OR predecessor.generation_id IS DISTINCT FROM target_generation_id
          OR predecessor.element_key IS DISTINCT FROM successor.element_key
          OR predecessor.element_version+1 IS DISTINCT FROM successor.element_version);
    IF operation_rows<1 OR operation_rows IS DISTINCT FROM operation_current_rows
       OR invalid_operation_rows<>0 THEN
      RAISE EXCEPTION 'Semantic Context operation pre-state cannot be reconstructed exactly.'
        USING ERRCODE='23514';
    END IF;
    WITH current_leaves AS (
      SELECT element.* FROM signal_semantic_context_element_versions element
      WHERE element.generation_id=target_generation_id AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)
    ), pre_leaves AS (
      SELECT leaf.element_key,leaf.element_version,leaf.element_digest,leaf.disposition
      FROM current_leaves leaf WHERE leaf.operation_id IS DISTINCT FROM target_operation_id
      UNION ALL
      SELECT predecessor.element_key,predecessor.element_version,
        predecessor.element_digest,predecessor.disposition
      FROM current_leaves successor
      JOIN signal_semantic_context_element_versions predecessor
        ON predecessor.id=successor.supersedes_element_id
      WHERE successor.operation_id=target_operation_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'element_key',leaf.element_key,'element_version',leaf.element_version,
        'element_digest',leaf.element_digest,'disposition',leaf.disposition)
        ORDER BY convert_to(leaf.element_key,'UTF8')),'[]'::jsonb)
      INTO elements FROM pre_leaves leaf;
    IF (SELECT count(*) FROM jsonb_array_elements(elements)) IS DISTINCT FROM (
      SELECT count(DISTINCT item.value->>'element_key')
      FROM jsonb_array_elements(elements) AS item(value)) THEN
      RAISE EXCEPTION 'Semantic Context reconstructed pre-state contains duplicate leaves.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-draft-v2','elements',elements));
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_decision_operation_graph_v2(
  target_operation_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE input jsonb;basis jsonb;expected_basis_digest text;target_generation_id uuid;
DECLARE generation_status text;generation_draft_digest text;post_draft_digest text;
DECLARE pre_draft_digest text;expected_draft_digest_ref text;
DECLARE total_elements integer;decision_elements integer;event_count integer;input_count integer;
DECLARE distinct_input_count integer;distinct_kinds integer;distinct_basis integer;
DECLARE single_successor signal_semantic_context_element_versions%ROWTYPE;
DECLARE single_predecessor signal_semantic_context_element_versions%ROWTYPE;
DECLARE expected_disposition text;expected_event text;expected_confirmation text;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=target_operation_id;
  IF operation.id IS NULL OR operation.action NOT IN (
      'decide-semantic-context-element','bulk-approve-semantic-context-elements') THEN
    RETURN;
  END IF;
  input:=operation.semantic_context_decision_input;
  IF operation.status IS DISTINCT FROM 'completed' OR operation.result IS NULL OR operation.completed_at IS NULL
     OR input IS NULL OR operation.semantic_context_decision_input_digest IS NULL
     OR jsonb_typeof(input) IS DISTINCT FROM 'object'
     OR operation.semantic_context_decision_input_digest IS DISTINCT FROM
        signal_semantic_context_digest_json_v2(input) THEN
    RAISE EXCEPTION 'Semantic Context decision operation is incomplete or its sealed input is invalid.'
      USING ERRCODE='23514';
  END IF;
  basis:=input->'decision_basis';
  IF jsonb_typeof(basis) IS DISTINCT FROM 'object'
     OR NOT basis ?& ARRAY['contract_version','reason','rationale']
     OR (basis - ARRAY['contract_version','reason','rationale']::text[]) <> '{}'::jsonb
     OR basis->>'contract_version' IS DISTINCT FROM 'signal-semantic-context-decision-v2'
     OR basis->>'reason' IS NULL OR basis->>'reason' NOT IN (
       'duplicate_same_concept','alias_or_variant','canonicalization','semantic_boundary',
       'locale_resolution','competitive_unit_resolution','insufficient_context','operator_correction')
     OR jsonb_typeof(basis->'rationale') IS DISTINCT FROM 'string'
     OR basis->>'rationale' IS DISTINCT FROM signal_semantic_context_trim_ecmascript_v2(
       normalize(basis->>'rationale',NFC))
     OR char_length(basis->>'rationale') NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Semantic Context decision operation basis is invalid.' USING ERRCODE='23514';
  END IF;
  expected_basis_digest:=signal_semantic_context_digest_json_v2(basis);
  SELECT generation.id,generation.status,generation.draft_digest
    INTO target_generation_id,generation_status,generation_draft_digest
  FROM signal_semantic_context_generations generation
  WHERE generation.workspace_id=operation.workspace_id
    AND generation.generation_key=input->>'generation_key';
  IF target_generation_id IS NULL OR generation_status IS DISTINCT FROM 'draft'
     OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor_generation
        WHERE successor_generation.supersedes_generation_id=target_generation_id) THEN
    RAISE EXCEPTION 'Semantic Context decision operation generation is not the current draft.'
      USING ERRCODE='23514';
  END IF;
  post_draft_digest:=signal_semantic_context_draft_digest_v2(target_generation_id);
  IF generation_draft_digest IS DISTINCT FROM post_draft_digest THEN
    RAISE EXCEPTION 'Semantic Context stored draft digest does not match the DB-owned current leaf graph.'
      USING ERRCODE='23514';
  END IF;
  expected_draft_digest_ref:=left(post_draft_digest,15)||'…'||right(post_draft_digest,8);
  SELECT count(*)::int,count(*) FILTER(WHERE origin_kind='operator_decision')::int
    INTO total_elements,decision_elements
  FROM signal_semantic_context_element_versions WHERE operation_id=operation.id;

  IF operation.action='decide-semantic-context-element' THEN
    IF NOT input ?& ARRAY['contract_version','generation_key','element_key','action',
        'decision_basis','confirmation']
       OR (input - ARRAY['contract_version','generation_key','element_key','action',
        'decision_basis','confirmation']::text[]) <> '{}'::jsonb
       OR input->>'contract_version' IS DISTINCT FROM 'signal-semantic-context-decision-v2'
       OR jsonb_typeof(input->'generation_key') IS DISTINCT FROM 'string'
       OR jsonb_typeof(input->'element_key') IS DISTINCT FROM 'string'
       OR input->>'action' IS NULL OR input->>'action' NOT IN ('approve','reject')
       OR jsonb_typeof(input->'confirmation') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Single Semantic Context decision input is invalid.' USING ERRCODE='23514';
    END IF;
    expected_disposition:=CASE input->>'action' WHEN 'approve' THEN 'approved' ELSE 'rejected' END;
    expected_event:=CASE input->>'action' WHEN 'approve' THEN 'element_approved' ELSE 'element_rejected' END;
    expected_confirmation:=CASE input->>'action' WHEN 'approve'
      THEN 'approve_selected_semantic_context_element' ELSE 'reject_selected_semantic_context_element' END;
    IF input->>'confirmation' IS DISTINCT FROM expected_confirmation
       OR total_elements IS DISTINCT FROM 1 OR decision_elements IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Single Semantic Context decision cardinality or confirmation is invalid.'
        USING ERRCODE='23514';
    END IF;
    SELECT * INTO single_successor FROM signal_semantic_context_element_versions
      WHERE operation_id=operation.id AND origin_kind='operator_decision';
    SELECT * INTO single_predecessor FROM signal_semantic_context_element_versions
      WHERE id=single_successor.supersedes_element_id;
    IF jsonb_typeof(operation.result) IS DISTINCT FROM 'object'
       OR NOT operation.result ?& ARRAY['element_key','element_version','disposition','draft_digest_ref']
       OR (operation.result - ARRAY['element_key','element_version','disposition','draft_digest_ref']::text[])
          <> '{}'::jsonb
       OR jsonb_typeof(operation.result->'element_version') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Single Semantic Context decision result is invalid.' USING ERRCODE='23514';
    END IF;
    IF (operation.result->>'element_version')::numeric IS DISTINCT FROM
         trunc((operation.result->>'element_version')::numeric) THEN
      RAISE EXCEPTION 'Single Semantic Context decision result is invalid.' USING ERRCODE='23514';
    END IF;
    IF single_successor.workspace_id IS DISTINCT FROM operation.workspace_id
       OR single_successor.generation_id IS DISTINCT FROM target_generation_id
       OR single_successor.element_key IS DISTINCT FROM input->>'element_key'
       OR single_successor.disposition IS DISTINCT FROM expected_disposition
       OR single_successor.decision_basis_digest IS DISTINCT FROM expected_basis_digest
       OR single_successor.decided_by_user_id IS DISTINCT FROM operation.actor_user_id
       OR single_predecessor.id IS NULL
       OR single_predecessor.workspace_id IS DISTINCT FROM operation.workspace_id
       OR single_predecessor.generation_id IS DISTINCT FROM target_generation_id
       OR single_predecessor.element_key IS DISTINCT FROM single_successor.element_key
       OR single_predecessor.disposition IS DISTINCT FROM 'pending'
       OR single_predecessor.operation_id IS NOT DISTINCT FROM operation.id
       OR single_predecessor.created_at>operation.created_at
       OR single_successor.created_at<operation.created_at
       OR single_successor.element_version IS DISTINCT FROM single_predecessor.element_version+1
       OR EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
          WHERE child.supersedes_element_id=single_successor.id)
       OR (operation.result->>'element_key') IS DISTINCT FROM single_successor.element_key
       OR (operation.result->>'element_version')::numeric IS DISTINCT FROM single_successor.element_version
       OR (operation.result->>'disposition') IS DISTINCT FROM single_successor.disposition
       OR (operation.result->>'draft_digest_ref') IS DISTINCT FROM expected_draft_digest_ref THEN
      RAISE EXCEPTION 'Single Semantic Context decision graph does not match its sealed input.'
        USING ERRCODE='23514';
    END IF;
    SELECT count(*)::int INTO event_count FROM signal_semantic_context_events event
      WHERE event.operation_id=operation.id AND event.workspace_id=operation.workspace_id
        AND event.generation_id=target_generation_id AND event.element_id=single_successor.id
        AND event.event_index=0 AND event.event_kind=expected_event
        AND event.previous_state_digest=single_predecessor.element_digest
        AND event.next_state_digest=single_successor.element_digest
        AND event.actor_user_id=operation.actor_user_id;
    IF event_count IS DISTINCT FROM 1 OR (SELECT count(*) FROM signal_semantic_context_events
        WHERE operation_id=operation.id) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Single Semantic Context decision event graph is incomplete.' USING ERRCODE='23514';
    END IF;
  ELSE
    pre_draft_digest:=signal_semantic_context_draft_digest_v2(target_generation_id,operation.id);
    IF NOT input ?& ARRAY['contract_version','generation_key','element_keys','decision_basis','confirmation']
       OR (input - ARRAY['contract_version','generation_key','element_keys','decision_basis','confirmation']::text[])
          <> '{}'::jsonb
       OR input->>'contract_version' IS DISTINCT FROM 'signal-semantic-context-decision-v2'
       OR jsonb_typeof(input->'generation_key') IS DISTINCT FROM 'string'
       OR jsonb_typeof(input->'element_keys') IS DISTINCT FROM 'array'
       OR input->>'confirmation' IS DISTINCT FROM 'apply_shared_decision_basis_to_all_selected_elements'
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'element_keys') item
          WHERE jsonb_typeof(item) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'Bulk Semantic Context decision input is invalid.' USING ERRCODE='23514';
    END IF;
    SELECT count(*)::int,count(DISTINCT value)::int INTO input_count,distinct_input_count
      FROM jsonb_array_elements_text(input->'element_keys') item(value);
    IF input_count NOT BETWEEN 2 AND 15 OR distinct_input_count IS DISTINCT FROM input_count
       OR total_elements IS DISTINCT FROM input_count OR decision_elements IS DISTINCT FROM input_count THEN
      RAISE EXCEPTION 'Bulk Semantic Context decision cardinality is invalid.' USING ERRCODE='23514';
    END IF;
    IF EXISTS(
      (SELECT value FROM jsonb_array_elements_text(input->'element_keys') item(value)
       EXCEPT SELECT element_key FROM signal_semantic_context_element_versions WHERE operation_id=operation.id)
      UNION ALL
      (SELECT element_key FROM signal_semantic_context_element_versions WHERE operation_id=operation.id
       EXCEPT SELECT value FROM jsonb_array_elements_text(input->'element_keys') item(value))
    ) THEN
      RAISE EXCEPTION 'Bulk Semantic Context successor keys do not match the sealed selection.'
        USING ERRCODE='23514';
    END IF;
    SELECT count(DISTINCT element_kind)::int,count(DISTINCT decision_basis_digest)::int
      INTO distinct_kinds,distinct_basis FROM signal_semantic_context_element_versions
      WHERE operation_id=operation.id;
    IF distinct_kinds IS DISTINCT FROM 1 OR distinct_basis IS DISTINCT FROM 1 OR EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      LEFT JOIN signal_semantic_context_element_versions predecessor
        ON predecessor.id=successor.supersedes_element_id
      WHERE successor.operation_id=operation.id AND (
        successor.origin_kind IS DISTINCT FROM 'operator_decision'
        OR successor.disposition IS DISTINCT FROM 'approved'
        OR successor.workspace_id IS DISTINCT FROM operation.workspace_id
        OR successor.generation_id IS DISTINCT FROM target_generation_id
        OR successor.decision_basis_digest IS DISTINCT FROM expected_basis_digest
        OR successor.decided_by_user_id IS DISTINCT FROM operation.actor_user_id OR predecessor.id IS NULL
        OR predecessor.workspace_id IS DISTINCT FROM operation.workspace_id
        OR predecessor.generation_id IS DISTINCT FROM target_generation_id
        OR predecessor.element_key IS DISTINCT FROM successor.element_key
        OR predecessor.disposition IS DISTINCT FROM 'pending'
        OR predecessor.operation_id IS NOT DISTINCT FROM operation.id
        OR predecessor.created_at>operation.created_at
        OR successor.created_at<operation.created_at
        OR successor.element_version IS DISTINCT FROM predecessor.element_version+1
        OR EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
          WHERE child.supersedes_element_id=successor.id))) THEN
      RAISE EXCEPTION 'Bulk Semantic Context decision cohort violates shared authority.'
        USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(operation.result) IS DISTINCT FROM 'object'
       OR NOT operation.result ?& ARRAY['generation_key','approved','draft_digest_ref']
       OR (operation.result - ARRAY['generation_key','approved','draft_digest_ref']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(operation.result->'approved') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Bulk Semantic Context decision result is invalid.' USING ERRCODE='23514';
    END IF;
    IF (operation.result->>'approved')::numeric IS DISTINCT FROM
         trunc((operation.result->>'approved')::numeric)
       OR operation.result->>'generation_key' IS DISTINCT FROM input->>'generation_key'
       OR (operation.result->>'approved')::numeric IS DISTINCT FROM input_count
       OR operation.result->>'draft_digest_ref' IS DISTINCT FROM expected_draft_digest_ref THEN
      RAISE EXCEPTION 'Bulk Semantic Context decision result is incomplete.' USING ERRCODE='23514';
    END IF;
    SELECT count(*)::int INTO event_count FROM signal_semantic_context_events event
      WHERE event.operation_id=operation.id AND event.workspace_id=operation.workspace_id
        AND event.generation_id=target_generation_id AND event.element_id IS NULL
        AND event.event_index=0 AND event.event_kind='elements_bulk_approved'
        AND event.previous_state_digest=pre_draft_digest
        AND event.next_state_digest=post_draft_digest
        AND event.actor_user_id=operation.actor_user_id;
    IF event_count IS DISTINCT FROM 1 OR (SELECT count(*) FROM signal_semantic_context_events
        WHERE operation_id=operation.id) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Bulk Semantic Context decision event digests do not match the reconstructed pre/post graphs.'
        USING ERRCODE='23514';
    END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION enforce_signal_semantic_context_decision_operation_graph_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_operation_id uuid;
BEGIN
  target_operation_id:=COALESCE((to_jsonb(NEW)->>'operation_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);
  PERFORM validate_signal_semantic_context_decision_operation_graph_v2(target_operation_id);
  RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_decision_operation_v2
  AFTER INSERT OR UPDATE ON signal_governance_control_operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.action IN ('decide-semantic-context-element','bulk-approve-semantic-context-elements'))
  EXECUTE FUNCTION enforce_signal_semantic_context_decision_operation_graph_v2();

CREATE CONSTRAINT TRIGGER trg_validate_signal_semantic_context_decision_cohort_v2
  AFTER INSERT ON signal_semantic_context_element_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.origin_kind='operator_decision')
  EXECUTE FUNCTION enforce_signal_semantic_context_decision_operation_graph_v2();

-- Preserve the exact 0097 snapshot implementation for historical audit while moving
-- current draft publication to the decision-aware wrapper under the canonical name.
ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb)
  RENAME TO signal_semantic_context_publication_snapshot_pre_0098_v2;

CREATE OR REPLACE FUNCTION signal_semantic_context_publication_snapshot_v2(
  target_generation_id uuid,
  expected_live_authority jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE base jsonb;generation signal_semantic_context_generations%ROWTYPE;review jsonb;
DECLARE review_digest text;publication_graph jsonb;pack_digest text;preflight jsonb;
DECLARE counts jsonb;blockers text[]:='{}';decision_basis_missing integer;
BEGIN
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=target_generation_id;
  IF generation.id IS NULL THEN RAISE EXCEPTION 'Semantic context generation not found.' USING ERRCODE='P0002'; END IF;
  base:=signal_semantic_context_publication_snapshot_pre_0098_v2(target_generation_id,expected_live_authority);

  WITH leaves AS (
    SELECT element.* FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=generation.id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*) FILTER(WHERE disposition IN ('approved','rejected') AND (
      decision_contract_version IS NULL OR decision_reason_code IS NULL
      OR decision_rationale IS NULL OR decision_basis_digest IS NULL))::int
    INTO decision_basis_missing FROM leaves;

  review:=jsonb_build_object('contract_version','signal-semantic-context-review-graph-v3',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'element_versions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'element_key',element_key,'element_version',element_version,'element_digest',element_digest,
      'disposition',disposition,'origin_kind',origin_kind,'supersedes_element_id',lower(supersedes_element_id::text),
      'original_proposal_element_id',lower(original_proposal_element_id::text),'operation_id',lower(operation_id::text),
      'decided_by_user_id',lower(decided_by_user_id::text),'decided_at',CASE WHEN decided_at IS NULL THEN NULL
        ELSE to_char(decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'decision_contract_version',decision_contract_version,'decision_reason_code',decision_reason_code,
      'decision_rationale',decision_rationale,'decision_basis_digest',decision_basis_digest)
      ORDER BY convert_to(element_key,'UTF8'),element_version,convert_to(id::text,'UTF8'))
      FROM signal_semantic_context_element_versions WHERE generation_id=generation.id),'[]'::jsonb),
    'merge_edges',(base->'preflight'->'review_graph'->'merge_edges'),
    'annotations',(base->'preflight'->'review_graph'->'annotations'));
  -- 0097 did not expose review_graph itself; rebuild its non-element sections exactly.
  review:=jsonb_set(review,'{merge_edges}',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'operation_id',lower(operation_id::text),'source_predecessor_id',lower(source_predecessor_id::text),
      'source_element_key',source_element_key,'source_element_version',source_element_version,
      'source_merged_successor_id',lower(source_merged_successor_id::text),
      'target_predecessor_id',lower(target_predecessor_id::text),'target_element_key',target_element_key,
      'target_element_version',target_element_version,'target_pending_successor_id',lower(target_pending_successor_id::text),
      'reason_code',reason_code,'rationale',rationale,'actor_user_id',lower(actor_user_id::text),
      'created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ORDER BY convert_to(operation_id::text,'UTF8'),convert_to(source_element_key,'UTF8'),source_element_version)
      FROM signal_semantic_context_merge_edges WHERE generation_id=generation.id),'[]'::jsonb),true);
  review:=jsonb_set(review,'{annotations}',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'annotation_key',annotation_key,'annotation_version',annotation_version,'annotation_type',annotation_type,
      'state',state,'resolution',resolution,'subject_element_id',lower(subject_element_id::text),
      'related_element_ids',COALESCE((SELECT jsonb_agg(lower(item::text) ORDER BY convert_to(item::text,'UTF8'))
        FROM unnest(related_element_ids) item),'[]'::jsonb),'reason_code',reason_code,'rationale',rationale,
      'supersedes_annotation_id',lower(supersedes_annotation_id::text),'operation_id',lower(operation_id::text),
      'actor_user_id',lower(actor_user_id::text),'created_at',
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ORDER BY convert_to(annotation_key,'UTF8'),annotation_version,convert_to(id::text,'UTF8'))
      FROM signal_semantic_context_review_annotations WHERE generation_id=generation.id),'[]'::jsonb),true);
  review_digest:=signal_semantic_context_digest_json_v2(review);
  publication_graph:=jsonb_build_object('contract_version','signal-semantic-context-publication-graph-v2',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'candidate_pack_digest',base->>'candidate_pack_digest','evidence_graph_digest',base->>'evidence_graph_digest',
    'review_graph_digest',review_digest,'authority',base->'preflight'->'authority');
  pack_digest:=signal_semantic_context_digest_json_v2(publication_graph);
  counts:=(base->'counts')||jsonb_build_object('decision_basis_missing',decision_basis_missing);
  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::text[]) INTO blockers
    FROM jsonb_array_elements_text(base->'blockers') item(value);
  IF generation.status='draft' AND decision_basis_missing>0 THEN
    blockers:=array_append(blockers,'decision_basis_missing');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item),'{}'::text[]) INTO blockers FROM unnest(blockers) item;
  preflight:=(base->'preflight')||jsonb_build_object('review_graph_digest',review_digest,
    'semantic_context_pack_digest',pack_digest,'counts',counts,'blockers',to_jsonb(blockers),
    'publishable',cardinality(blockers)=0);
  RETURN base||jsonb_build_object('review_graph_digest',review_digest,
    'semantic_context_pack_digest',pack_digest,
    'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight),
    'counts',counts,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,'preflight',preflight);
END; $$;

COMMENT ON FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb) IS
  '0098 decision-aware draft snapshot; review_graph_digest includes deliberate decision basis.';
