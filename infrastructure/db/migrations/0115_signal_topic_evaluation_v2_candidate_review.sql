-- 0115: append-only editorial review for full-evidence Topic Evaluation V2 candidates.
--
-- Migration 0112 already protects model output, evidence, rankings and provenance from UPDATE
-- and DELETE. This migration does not replace or duplicate those guards. It adds a separate,
-- management-authorized editorial history whose only terminal states are pending and rejected.

ALTER TABLE signal_topic_evaluation_v2_candidates
  ADD CONSTRAINT uq_signal_topic_evaluation_v2_candidate_authority
  UNIQUE(id,run_id,workspace_id);

CREATE TABLE signal_topic_evaluation_v2_candidate_review_operations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  expected_revision integer NOT NULL,
  expected_state_token text NOT NULL,
  target_revision integer,
  input jsonb NOT NULL,
  input_digest text NOT NULL,
  result_revision_id uuid NOT NULL,
  result_revision integer NOT NULL,
  result_version_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_topic_evaluation_v2_review_operation_candidate FOREIGN KEY(
    candidate_id,run_id,workspace_id
  ) REFERENCES signal_topic_evaluation_v2_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_v2_review_idempotency UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_review_result UNIQUE(result_revision_id),
  CONSTRAINT signal_topic_evaluation_v2_review_operation_shape CHECK(
    action IN('save','reject','restore','undo')
    AND idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'
    AND expected_revision>=1 AND result_revision=expected_revision+1
    AND expected_state_token~'^sha256:[0-9a-f]{64}$'
    AND jsonb_typeof(input)='object'
    AND input_digest~'^sha256:[0-9a-f]{64}$'
    AND result_version_digest~'^sha256:[0-9a-f]{64}$'
    AND ((action='undo' AND target_revision IS NOT NULL AND target_revision>=1)
      OR (action<>'undo' AND target_revision IS NULL))
  )
);

CREATE TABLE signal_topic_evaluation_v2_candidate_editorial_revisions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL,
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  revision integer NOT NULL,
  base_model_revision_id uuid NOT NULL
    REFERENCES signal_topic_evaluation_v2_candidate_revisions(id) ON DELETE RESTRICT,
  predecessor_editorial_revision_id uuid
    REFERENCES signal_topic_evaluation_v2_candidate_editorial_revisions(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL UNIQUE
    REFERENCES signal_topic_evaluation_v2_candidate_review_operations(id) ON DELETE RESTRICT,
  action text NOT NULL,
  review_state text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  inclusion jsonb NOT NULL,
  exclusion jsonb NOT NULL,
  version_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_topic_evaluation_v2_editorial_candidate FOREIGN KEY(
    candidate_id,run_id,workspace_id
  ) REFERENCES signal_topic_evaluation_v2_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_v2_editorial_revision UNIQUE(candidate_id,revision),
  CONSTRAINT signal_topic_evaluation_v2_editorial_revision_shape CHECK(
    revision>=2 AND action IN('save','reject','restore','undo')
    AND review_state IN('pending','rejected')
    AND btrim(title)<>'' AND char_length(title)<=160
    AND btrim(description)<>'' AND char_length(description)<=1500
    AND jsonb_typeof(inclusion)='array' AND jsonb_array_length(inclusion) BETWEEN 1 AND 16
    AND jsonb_typeof(exclusion)='array' AND jsonb_array_length(exclusion) BETWEEN 0 AND 16
    AND version_digest~'^sha256:[0-9a-f]{64}$'
  )
);

ALTER TABLE signal_topic_evaluation_v2_candidate_review_operations
  ADD CONSTRAINT signal_topic_evaluation_v2_review_result_revision
  FOREIGN KEY(result_revision_id)
  REFERENCES signal_topic_evaluation_v2_candidate_editorial_revisions(id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE signal_topic_evaluation_v2_candidate_review_events (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE
    REFERENCES signal_topic_evaluation_v2_candidate_review_operations(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL,
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  event_kind text NOT NULL,
  previous_version_digest text NOT NULL,
  current_version_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_topic_evaluation_v2_review_event_candidate FOREIGN KEY(
    candidate_id,run_id,workspace_id
  ) REFERENCES signal_topic_evaluation_v2_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_v2_review_event_shape CHECK(
    event_kind IN('candidate_saved','candidate_rejected','candidate_restored','candidate_undone')
    AND previous_version_digest~'^sha256:[0-9a-f]{64}$'
    AND current_version_digest~'^sha256:[0-9a-f]{64}$'
  )
);

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_candidate_editorial_digest_v1(
  candidate uuid, revision_number integer, previous_digest text, action_name text,
  state_name text, title_value text, description_value text,
  inclusion_value jsonb, exclusion_value jsonb, base_payload_digest text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-evaluation-v2-candidate-editorial-v1',
    'candidate_id',candidate,'revision',revision_number,'previous_version_digest',previous_digest,
    'action',action_name,'review_state',state_name,'title',title_value,
    'description',description_value,'inclusion',inclusion_value,'exclusion',exclusion_value,
    'base_model_payload_digest',base_payload_digest
  ))
$$;

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_candidate_state_token_v1(
  candidate uuid, revision_number integer, version_digest_value text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-evaluation-v2-candidate-state-v1',
    'candidate_id',candidate,'revision',revision_number,'version_digest',version_digest_value
  ))
$$;

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_editorial_revision_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate signal_topic_evaluation_v2_candidates%ROWTYPE;
  operation signal_topic_evaluation_v2_candidate_review_operations%ROWTYPE;
  base_revision signal_topic_evaluation_v2_candidate_revisions%ROWTYPE;
  current_editorial signal_topic_evaluation_v2_candidate_editorial_revisions%ROWTYPE;
  target_editorial signal_topic_evaluation_v2_candidate_editorial_revisions%ROWTYPE;
  current_revision integer;
  current_state text;
  current_title text;
  current_description text;
  current_inclusion jsonb;
  current_exclusion jsonb;
  current_version_digest text;
  run_key_value text;
  expected_digest text;
BEGIN
  SELECT * INTO candidate FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id;
  SELECT * INTO base_revision FROM signal_topic_evaluation_v2_candidate_revisions
    WHERE id=NEW.base_model_revision_id AND candidate_id=NEW.candidate_id AND revision=1;
  SELECT * INTO operation FROM signal_topic_evaluation_v2_candidate_review_operations
    WHERE id=NEW.operation_id;
  SELECT run_key INTO run_key_value FROM signal_topic_evaluation_v2_runs
    WHERE id=NEW.run_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO current_editorial FROM signal_topic_evaluation_v2_candidate_editorial_revisions
    WHERE candidate_id=NEW.candidate_id ORDER BY revision DESC LIMIT 1;

  IF candidate.id IS NULL OR base_revision.id IS NULL OR operation.id IS NULL
     OR candidate.run_id<>NEW.run_id OR candidate.workspace_id<>NEW.workspace_id
     OR operation.candidate_id<>NEW.candidate_id OR operation.run_id<>NEW.run_id
     OR operation.workspace_id<>NEW.workspace_id OR operation.action<>NEW.action
     OR operation.result_revision_id<>NEW.id OR operation.result_revision<>NEW.revision
     OR operation.result_version_digest<>NEW.version_digest
     OR run_key_value IS NULL OR candidate.status<>'pending'
     OR candidate.adopted OR candidate.published OR candidate.serving
     OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_runs run
       WHERE run.id=NEW.run_id AND run.workspace_id=NEW.workspace_id AND run.status='completed')
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,operation.actor_user_id)
     OR NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=operation.actor_user_id
       AND actor.status='active' AND actor.user_type='noisia_internal') THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate review authority is invalid.';
  END IF;

  IF current_editorial.id IS NULL THEN
    current_revision:=1;
    current_state:='pending';
    current_title:=base_revision.payload->>'title';
    current_description:=base_revision.payload->>'description';
    current_inclusion:=base_revision.payload->'inclusion';
    current_exclusion:=base_revision.payload->'exclusion';
    current_version_digest:=base_revision.payload_digest;
    IF NEW.predecessor_editorial_revision_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate review predecessor is invalid.';
    END IF;
  ELSE
    current_revision:=current_editorial.revision;
    current_state:=current_editorial.review_state;
    current_title:=current_editorial.title;
    current_description:=current_editorial.description;
    current_inclusion:=current_editorial.inclusion;
    current_exclusion:=current_editorial.exclusion;
    current_version_digest:=current_editorial.version_digest;
    IF NEW.predecessor_editorial_revision_id<>current_editorial.id THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate review predecessor is invalid.';
    END IF;
  END IF;

  IF operation.expected_revision<>current_revision OR NEW.revision<>current_revision+1
     OR operation.expected_state_token<>signal_topic_evaluation_v2_candidate_state_token_v1(
       NEW.candidate_id,current_revision,current_version_digest) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate review state token is stale.';
  END IF;

  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.inclusion) value
       WHERE jsonb_typeof(value)<>'string' OR btrim(value#>>'{}')=''
         OR char_length(value#>>'{}')>240)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.exclusion) value
       WHERE jsonb_typeof(value)<>'string' OR btrim(value#>>'{}')=''
         OR char_length(value#>>'{}')>240) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate review list values are invalid.';
  END IF;

  expected_digest:=signal_topic_evaluation_v2_candidate_editorial_digest_v1(
    NEW.candidate_id,NEW.revision,current_version_digest,NEW.action,NEW.review_state,
    NEW.title,NEW.description,NEW.inclusion,NEW.exclusion,base_revision.payload_digest);
  IF NEW.version_digest<>expected_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate editorial digest is invalid.';
  END IF;

  IF NEW.action='save' THEN
    IF current_state<>'pending' OR NEW.review_state<>'pending'
       OR operation.input<>jsonb_build_object(
         'action','save','run_key',run_key_value,'candidate_key',candidate.candidate_key,
         'expected_revision',current_revision,'state_token',operation.expected_state_token,
         'values',jsonb_build_object('title',NEW.title,'description',NEW.description,
           'inclusion',NEW.inclusion,'exclusion',NEW.exclusion)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate save input is invalid.';
    END IF;
  ELSIF NEW.action='reject' THEN
    IF current_state<>'pending' OR NEW.review_state<>'rejected'
       OR ROW(NEW.title,NEW.description,NEW.inclusion,NEW.exclusion)
         IS DISTINCT FROM ROW(current_title,current_description,current_inclusion,current_exclusion)
       OR operation.input<>jsonb_build_object(
         'action','reject','run_key',run_key_value,'candidate_key',candidate.candidate_key,
         'expected_revision',current_revision,'state_token',operation.expected_state_token) THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate reject input is invalid.';
    END IF;
  ELSIF NEW.action='restore' THEN
    IF current_state<>'rejected' OR NEW.review_state<>'pending'
       OR ROW(NEW.title,NEW.description,NEW.inclusion,NEW.exclusion)
         IS DISTINCT FROM ROW(current_title,current_description,current_inclusion,current_exclusion)
       OR operation.input<>jsonb_build_object(
         'action','restore','run_key',run_key_value,'candidate_key',candidate.candidate_key,
         'expected_revision',current_revision,'state_token',operation.expected_state_token) THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate restore input is invalid.';
    END IF;
  ELSE
    IF operation.target_revision<>current_revision-1 THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate undo target is invalid.';
    END IF;
    IF operation.target_revision=1 THEN
      IF NEW.review_state<>'pending'
         OR ROW(NEW.title,NEW.description,NEW.inclusion,NEW.exclusion)
           IS DISTINCT FROM ROW(base_revision.payload->>'title',base_revision.payload->>'description',
             base_revision.payload->'inclusion',base_revision.payload->'exclusion') THEN
        RAISE EXCEPTION USING ERRCODE='23514',
          MESSAGE='Topic Evaluation V2 candidate undo target is invalid.';
      END IF;
    ELSE
      SELECT * INTO target_editorial FROM signal_topic_evaluation_v2_candidate_editorial_revisions
        WHERE candidate_id=NEW.candidate_id AND revision=operation.target_revision;
      IF target_editorial.id IS NULL OR NEW.review_state<>target_editorial.review_state
         OR ROW(NEW.title,NEW.description,NEW.inclusion,NEW.exclusion)
           IS DISTINCT FROM ROW(target_editorial.title,target_editorial.description,
             target_editorial.inclusion,target_editorial.exclusion) THEN
        RAISE EXCEPTION USING ERRCODE='23514',
          MESSAGE='Topic Evaluation V2 candidate undo target is invalid.';
      END IF;
    END IF;
    IF operation.input<>jsonb_build_object(
      'action','undo','run_key',run_key_value,'candidate_key',candidate.candidate_key,
      'expected_revision',current_revision,'state_token',operation.expected_state_token,
      'target_revision',operation.target_revision) THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate undo input is invalid.';
    END IF;
  END IF;

  IF operation.input_digest<>signal_semantic_context_digest_json_v2(operation.input) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate review input digest is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_editorial_revision
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_editorial_revisions
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_editorial_revision_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_review_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  operation signal_topic_evaluation_v2_candidate_review_operations%ROWTYPE;
  revision signal_topic_evaluation_v2_candidate_editorial_revisions%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM signal_topic_evaluation_v2_candidate_review_operations
    WHERE id=NEW.operation_id;
  SELECT * INTO revision FROM signal_topic_evaluation_v2_candidate_editorial_revisions
    WHERE id=operation.result_revision_id;
  IF operation.id IS NULL OR revision.id IS NULL
     OR NEW.candidate_id<>operation.candidate_id OR NEW.run_id<>operation.run_id
     OR NEW.workspace_id<>operation.workspace_id
     OR NEW.event_kind<>(CASE operation.action
       WHEN 'save' THEN 'candidate_saved'
       WHEN 'reject' THEN 'candidate_rejected'
       WHEN 'restore' THEN 'candidate_restored'
       ELSE 'candidate_undone' END)
     OR NEW.current_version_digest<>revision.version_digest
     OR NEW.previous_version_digest<>(CASE WHEN revision.predecessor_editorial_revision_id IS NULL
       THEN (SELECT payload_digest FROM signal_topic_evaluation_v2_candidate_revisions
         WHERE id=revision.base_model_revision_id)
       ELSE (SELECT version_digest FROM signal_topic_evaluation_v2_candidate_editorial_revisions
         WHERE id=revision.predecessor_editorial_revision_id) END) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate review event is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_review_event
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_review_events
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_review_event_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_review_cohort_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM signal_topic_evaluation_v2_candidate_editorial_revisions revision
       WHERE revision.operation_id=NEW.id)<>1
     OR (SELECT count(*) FROM signal_topic_evaluation_v2_candidate_review_events event
       WHERE event.operation_id=NEW.id)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate review operation is incomplete.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_review_cohort
AFTER INSERT ON signal_topic_evaluation_v2_candidate_review_operations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_review_cohort_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_candidate_review_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000',
    MESSAGE='Topic Evaluation V2 candidate review authority is append-only.';
END;
$$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_review_operations
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_review_operations
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_review_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_editorial_revisions
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_editorial_revisions
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_review_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_review_events
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_review_events
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_review_v1();

CREATE INDEX idx_signal_topic_evaluation_v2_editorial_current
  ON signal_topic_evaluation_v2_candidate_editorial_revisions(candidate_id,revision DESC);
CREATE INDEX idx_signal_topic_evaluation_v2_review_operations_workspace
  ON signal_topic_evaluation_v2_candidate_review_operations(workspace_id,created_at,id);

COMMENT ON TABLE signal_topic_evaluation_v2_candidate_editorial_revisions IS
  'Append-only pending/rejected editorial history. Model output and evidence remain in immutable 0112 tables; no row can adopt, publish or serve a Topic.';
