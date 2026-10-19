-- Validate one complete automatic Brand Context cohort once per transaction.
-- The previous row-level deferred triggers repeated the same full census for
-- every element and event, turning 215 rows into hundreds of identical scans.

CREATE TABLE IF NOT EXISTS signal_semantic_context_automatic_cohort_validations (
  operation_id uuid PRIMARY KEY REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  cohort_digest text NOT NULL,
  validated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_semantic_context_automatic_cohort_validation_digest
    CHECK(cohort_digest ~ '^sha256:[0-9a-f]{64}$')
);

REVOKE ALL ON signal_semantic_context_automatic_cohort_validations FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON signal_semantic_context_automatic_cohort_validations FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON signal_semantic_context_automatic_cohort_validations FROM authenticated';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION invalidate_signal_semantic_context_automatic_cohort_validation_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE target_operation_id uuid;
BEGIN
  target_operation_id:=COALESCE(NEW.operation_id,OLD.operation_id);
  DELETE FROM signal_semantic_context_automatic_cohort_validations
    WHERE operation_id=target_operation_id;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION invalidate_signal_semantic_context_automatic_cohort_validation_v1() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION invalidate_signal_semantic_context_automatic_cohort_validation_v1() FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION invalidate_signal_semantic_context_automatic_cohort_validation_v1() FROM authenticated';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_invalidate_signal_semantic_context_automatic_element_validation
  ON signal_semantic_context_element_versions;
CREATE TRIGGER trg_invalidate_signal_semantic_context_automatic_element_validation
BEFORE INSERT OR DELETE ON signal_semantic_context_element_versions
FOR EACH ROW EXECUTE FUNCTION invalidate_signal_semantic_context_automatic_cohort_validation_v1();

DROP TRIGGER IF EXISTS trg_invalidate_signal_semantic_context_automatic_event_validation
  ON signal_semantic_context_events;
CREATE TRIGGER trg_invalidate_signal_semantic_context_automatic_event_validation
BEFORE INSERT OR DELETE ON signal_semantic_context_events
FOR EACH ROW EXECUTE FUNCTION invalidate_signal_semantic_context_automatic_cohort_validation_v1();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_automatic_policy_cohort_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE target_operation_id uuid;DECLARE invalid_count integer;DECLARE ready_count integer;DECLARE exception_count integer;
DECLARE input_keys jsonb;DECLARE row_keys jsonb;DECLARE outcome_keys jsonb;DECLARE appended_events integer;DECLARE ready_events integer;
DECLARE appended_event_keys jsonb;DECLARE ready_event_keys jsonb;DECLARE ready_row_keys jsonb;
DECLARE input jsonb;DECLARE computed_policy_digest text;DECLARE cohort_digest text;
BEGIN
  target_operation_id:=COALESCE(NEW.operation_id,OLD.operation_id);
  IF NOT EXISTS(SELECT 1 FROM signal_governance_control_operations operation
      WHERE operation.id=target_operation_id AND operation.action='append-semantic-context-proposals') THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM signal_semantic_context_automatic_cohort_validations checkpoint
      WHERE checkpoint.operation_id=target_operation_id) THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM signal_governance_control_operations operation
      WHERE operation.id=target_operation_id
        AND operation.semantic_context_decision_input->>'contract_version'=
          'signal-semantic-context-automatic-run-operation-v2')
     AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element
       WHERE element.operation_id=target_operation_id AND element.automatic_policy_contract_version IS NOT NULL)
     THEN RETURN NULL; END IF;
  IF NOT signal_semantic_context_automatic_operation_run_valid_v1(target_operation_id) THEN
    RAISE EXCEPTION 'Semantic context automatic policy is not bound to one settled run.' USING ERRCODE='23514'; END IF;
  SELECT count(*) FILTER(WHERE element.automatic_policy_outcome='ready'),
    count(*) FILTER(WHERE element.automatic_policy_outcome='exception'),
    count(*) FILTER(WHERE element.automatic_policy_contract_version IS NOT NULL
      AND NOT signal_semantic_context_automatic_policy_valid_v1(element.id))
    INTO ready_count,exception_count,invalid_count FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=target_operation_id;
  SELECT operation.semantic_context_decision_input->'proposal_keys',operation.semantic_context_decision_input
    INTO input_keys,input FROM signal_governance_control_operations operation WHERE operation.id=target_operation_id;
  computed_policy_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-semantic-context-automatic-disposition-v1',
    'generation_key',input->>'generation_key','parent_authority_digest',input->>'parent_authority_digest',
    'decisions',(SELECT jsonb_agg(jsonb_build_object('element_key',value->>'element_key',
      'decision_digest',value->>'decision_digest') ORDER BY convert_to(value->>'element_key','UTF8'))
      FROM jsonb_array_elements(input->'outcomes') item(value))));
  SELECT COALESCE(jsonb_agg(element.element_key ORDER BY convert_to(element.element_key,'UTF8')),'[]'::jsonb)
    INTO row_keys FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=target_operation_id AND element.element_version=1;
  SELECT COALESCE(jsonb_agg(value->>'element_key' ORDER BY convert_to(value->>'element_key','UTF8')),'[]'::jsonb)
    INTO outcome_keys FROM jsonb_array_elements(input->'outcomes') item(value);
  SELECT count(*) FILTER(WHERE event_kind='proposals_appended'),count(*) FILTER(WHERE event_kind='automatic_policy_ready')
    INTO appended_events,ready_events FROM signal_semantic_context_events event
    WHERE event.operation_id=target_operation_id;
  SELECT COALESCE(jsonb_agg(element.element_key ORDER BY convert_to(element.element_key,'UTF8'))
      FILTER(WHERE event.event_kind='proposals_appended'),'[]'::jsonb),
    COALESCE(jsonb_agg(element.element_key ORDER BY convert_to(element.element_key,'UTF8'))
      FILTER(WHERE event.event_kind='automatic_policy_ready'),'[]'::jsonb)
    INTO appended_event_keys,ready_event_keys
    FROM signal_semantic_context_events event
    LEFT JOIN signal_semantic_context_element_versions element ON element.id=event.element_id
    WHERE event.operation_id=target_operation_id;
  SELECT COALESCE(jsonb_agg(element.element_key ORDER BY convert_to(element.element_key,'UTF8')),'[]'::jsonb)
    INTO ready_row_keys FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=target_operation_id AND element.automatic_policy_outcome='ready';
  IF invalid_count<>0 OR input->>'policy_digest'<>computed_policy_digest
     OR input_keys<>row_keys OR input_keys<>outcome_keys
     OR jsonb_array_length(input_keys)<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(input_keys) item(value))
     OR ready_count+exception_count<>jsonb_array_length(input_keys)
     OR ready_count<>(SELECT automatic_ready_count FROM signal_semantic_context_proposal_runs
       WHERE appended_operation_id=target_operation_id)
     OR exception_count<>(SELECT automatic_exception_count FROM signal_semantic_context_proposal_runs
       WHERE appended_operation_id=target_operation_id)
     OR appended_events<>jsonb_array_length(input_keys) OR ready_events<>ready_count
     OR appended_event_keys<>input_keys OR ready_event_keys<>ready_row_keys OR EXISTS(
      SELECT 1 FROM signal_semantic_context_events event
      LEFT JOIN signal_semantic_context_element_versions element ON element.id=event.element_id
      WHERE event.operation_id=target_operation_id AND (event.element_id IS NULL
        OR event.workspace_id<>element.workspace_id OR event.generation_id<>element.generation_id
        OR event.event_kind NOT IN ('proposals_appended','automatic_policy_ready')
        OR event.event_kind='proposals_appended' AND (element.element_version<>1
          OR event.previous_state_digest IS NOT NULL OR event.next_state_digest<>element.element_digest)
        OR event.event_kind='automatic_policy_ready' AND (element.automatic_policy_outcome<>'ready'
          OR event.previous_state_digest<>element.automatic_policy_prestate_digest
          OR event.next_state_digest<>element.automatic_policy_poststate_digest))) THEN
    RAISE EXCEPTION 'Semantic context automatic policy cohort is incomplete or invalid.' USING ERRCODE='23514';
  END IF;
  cohort_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'operation_id',target_operation_id,'policy_digest',computed_policy_digest,
    'proposal_keys',input_keys,'ready_keys',ready_row_keys,
    'appended_events',appended_events,'ready_events',ready_events));
  INSERT INTO signal_semantic_context_automatic_cohort_validations(operation_id,cohort_digest)
    VALUES(target_operation_id,cohort_digest)
    ON CONFLICT(operation_id) DO NOTHING;
  RETURN NULL;
END; $$;

REVOKE ALL ON FUNCTION validate_signal_semantic_context_automatic_policy_cohort_v1() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION validate_signal_semantic_context_automatic_policy_cohort_v1() FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION validate_signal_semantic_context_automatic_policy_cohort_v1() FROM authenticated';
  END IF;
END $$;

COMMENT ON TABLE signal_semantic_context_automatic_cohort_validations IS
  'Server-only checkpoint: one complete automatic Brand Context cohort census per transaction; any later row mutation invalidates it before deferred revalidation.';
