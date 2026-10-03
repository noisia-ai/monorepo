-- 69B.5I-E-S: append-only, reversible review for Topic Evaluation candidates.
--
-- Generated candidates remain immutable and non-serving. Review commands append a
-- current projection only; they never create, adopt, publish, or serve a Topic.

CREATE TABLE signal_topic_evaluation_candidate_review_operations (
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
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_evaluation_review_operation_candidate FOREIGN KEY(
    candidate_id,run_id,workspace_id
  ) REFERENCES signal_topic_evaluation_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_review_idempotency UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_signal_topic_evaluation_review_result UNIQUE(result_revision_id),
  CONSTRAINT signal_topic_evaluation_review_operation_shape CHECK(
    action IN('save','reject','restore','undo')
    AND expected_revision>=1 AND result_revision=expected_revision+1
    AND expected_state_token ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND result_version_digest ~ '^sha256:[0-9a-f]{64}$'
    AND jsonb_typeof(input)='object'
    AND ((action='undo' AND target_revision IS NOT NULL AND target_revision>=1)
      OR (action<>'undo' AND target_revision IS NULL))
  )
);

CREATE TABLE signal_topic_evaluation_candidate_revisions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL,
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  revision integer NOT NULL,
  predecessor_revision_id uuid,
  operation_id uuid,
  action text NOT NULL,
  review_state text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  inclusion jsonb NOT NULL,
  exclusion jsonb NOT NULL,
  version_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_evaluation_revision_candidate FOREIGN KEY(
    candidate_id,run_id,workspace_id
  ) REFERENCES signal_topic_evaluation_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_revision_predecessor FOREIGN KEY(predecessor_revision_id)
    REFERENCES signal_topic_evaluation_candidate_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_revision_operation FOREIGN KEY(operation_id)
    REFERENCES signal_topic_evaluation_candidate_review_operations(id) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_candidate_revision UNIQUE(candidate_id,revision),
  CONSTRAINT uq_signal_topic_evaluation_revision_operation UNIQUE(operation_id),
  CONSTRAINT signal_topic_evaluation_revision_shape CHECK(
    revision>=1 AND action IN('generated','save','reject','restore','undo')
    AND review_state IN('pending','rejected')
    AND btrim(title)<>'' AND char_length(title)<=160
    AND btrim(description)<>'' AND char_length(description)<=2000
    AND jsonb_typeof(inclusion)='array' AND jsonb_array_length(inclusion) BETWEEN 1 AND 12
    AND jsonb_typeof(exclusion)='array' AND jsonb_array_length(exclusion) BETWEEN 0 AND 12
    AND version_digest ~ '^sha256:[0-9a-f]{64}$'
    AND ((revision=1 AND predecessor_revision_id IS NULL AND operation_id IS NULL AND action='generated')
      OR (revision>1 AND predecessor_revision_id IS NOT NULL AND operation_id IS NOT NULL AND action<>'generated'))
  )
);

ALTER TABLE signal_topic_evaluation_candidate_review_operations
  ADD CONSTRAINT signal_topic_evaluation_review_result_revision
  FOREIGN KEY(result_revision_id) REFERENCES signal_topic_evaluation_candidate_revisions(id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE signal_topic_evaluation_candidate_review_events (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES signal_topic_evaluation_candidate_review_operations(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL,
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  event_kind text NOT NULL,
  previous_version_digest text NOT NULL,
  current_version_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_evaluation_review_event_candidate FOREIGN KEY(
    candidate_id,run_id,workspace_id
  ) REFERENCES signal_topic_evaluation_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_review_event_shape CHECK(
    event_kind IN('candidate_saved','candidate_rejected','candidate_restored','candidate_undone')
    AND previous_version_digest ~ '^sha256:[0-9a-f]{64}$'
    AND current_version_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE OR REPLACE FUNCTION signal_topic_evaluation_candidate_version_digest_v1(
  candidate uuid, revision_number integer, predecessor uuid, action_name text, state_name text,
  title_value text, description_value text, inclusion_value jsonb, exclusion_value jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'sha256:'||encode(digest(jsonb_build_object(
    'contract_version','signal-topic-evaluation-candidate-revision-v1',
    'candidate_id',candidate,'revision',revision_number,'predecessor_revision_id',predecessor,
    'action',action_name,'review_state',state_name,'title',title_value,
    'description',description_value,'inclusion',inclusion_value,'exclusion',exclusion_value
  )::text,'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION signal_topic_evaluation_candidate_state_token_v1(
  candidate uuid, revision_number integer, version_digest_value text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'sha256:'||encode(digest(jsonb_build_object(
    'contract_version','signal-topic-evaluation-candidate-state-v1',
    'candidate_id',candidate,'revision',revision_number,'version_digest',version_digest_value
  )::text,'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION seed_signal_topic_evaluation_candidate_revision_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_id uuid:=gen_random_uuid(); digest_value text;
BEGIN
  digest_value:=signal_topic_evaluation_candidate_version_digest_v1(
    NEW.id,1,NULL,'generated','pending',NEW.title,NEW.description,NEW.inclusion,NEW.exclusion);
  INSERT INTO signal_topic_evaluation_candidate_revisions(
    id,candidate_id,run_id,workspace_id,revision,action,review_state,title,description,
    inclusion,exclusion,version_digest,created_at
  ) VALUES(revision_id,NEW.id,NEW.run_id,NEW.workspace_id,1,'generated','pending',NEW.title,
    NEW.description,NEW.inclusion,NEW.exclusion,digest_value,NEW.created_at);
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_seed_signal_topic_evaluation_candidate_revision
AFTER INSERT ON signal_topic_evaluation_candidates
FOR EACH ROW EXECUTE FUNCTION seed_signal_topic_evaluation_candidate_revision_v1();

INSERT INTO signal_topic_evaluation_candidate_revisions(
  id,candidate_id,run_id,workspace_id,revision,action,review_state,title,description,
  inclusion,exclusion,version_digest,created_at
)
SELECT gen_random_uuid(),candidate.id,candidate.run_id,candidate.workspace_id,1,'generated','pending',
  candidate.title,candidate.description,candidate.inclusion,candidate.exclusion,
  signal_topic_evaluation_candidate_version_digest_v1(candidate.id,1,NULL,'generated','pending',
    candidate.title,candidate.description,candidate.inclusion,candidate.exclusion),candidate.created_at
FROM signal_topic_evaluation_candidates candidate
WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_candidate_revisions revision
  WHERE revision.candidate_id=candidate.id);

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_candidate_revision_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate signal_topic_evaluation_candidates%ROWTYPE;
  operation signal_topic_evaluation_candidate_review_operations%ROWTYPE;
  predecessor signal_topic_evaluation_candidate_revisions%ROWTYPE;
  target signal_topic_evaluation_candidate_revisions%ROWTYPE;
  expected_digest text;
BEGIN
  SELECT * INTO candidate FROM signal_topic_evaluation_candidates WHERE id=NEW.candidate_id;
  IF candidate.id IS NULL OR candidate.run_id<>NEW.run_id OR candidate.workspace_id<>NEW.workspace_id THEN
    RAISE EXCEPTION 'Topic evaluation candidate revision authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.inclusion) value
      WHERE jsonb_typeof(value)<>'string' OR btrim(value#>>'{}')='' OR char_length(value#>>'{}')>240)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.exclusion) value
      WHERE jsonb_typeof(value)<>'string' OR btrim(value#>>'{}')='' OR char_length(value#>>'{}')>240) THEN
    RAISE EXCEPTION 'Topic evaluation candidate review list values are invalid.' USING ERRCODE='23514';
  END IF;
  expected_digest:=signal_topic_evaluation_candidate_version_digest_v1(NEW.candidate_id,NEW.revision,
    NEW.predecessor_revision_id,NEW.action,NEW.review_state,NEW.title,NEW.description,NEW.inclusion,NEW.exclusion);
  IF NEW.version_digest<>expected_digest THEN
    RAISE EXCEPTION 'Topic evaluation candidate revision digest is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.revision=1 THEN
    IF NEW.title<>candidate.title OR NEW.description<>candidate.description
      OR NEW.inclusion<>candidate.inclusion OR NEW.exclusion<>candidate.exclusion
      OR NEW.review_state<>'pending' THEN
      RAISE EXCEPTION 'Topic evaluation generated revision differs from immutable output.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO operation FROM signal_topic_evaluation_candidate_review_operations WHERE id=NEW.operation_id;
  SELECT * INTO predecessor FROM signal_topic_evaluation_candidate_revisions WHERE id=NEW.predecessor_revision_id;
  IF operation.id IS NULL OR predecessor.id IS NULL
    OR operation.candidate_id<>NEW.candidate_id OR operation.run_id<>NEW.run_id
    OR operation.workspace_id<>NEW.workspace_id OR operation.action<>NEW.action
    OR operation.result_revision_id<>NEW.id OR operation.result_revision<>NEW.revision
    OR operation.result_version_digest<>NEW.version_digest
    OR predecessor.candidate_id<>NEW.candidate_id OR predecessor.revision<>operation.expected_revision
    OR NEW.revision<>predecessor.revision+1
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,operation.actor_user_id)
    OR NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=operation.actor_user_id
      AND actor.status='active' AND actor.user_type='noisia_internal')
    OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_runs run
      WHERE run.id=NEW.run_id AND run.workspace_id=NEW.workspace_id AND run.status='completed') THEN
    RAISE EXCEPTION 'Topic evaluation candidate review authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF operation.expected_state_token<>signal_topic_evaluation_candidate_state_token_v1(
      predecessor.candidate_id,predecessor.revision,predecessor.version_digest) THEN
    RAISE EXCEPTION 'Topic evaluation candidate review state token is stale.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM signal_topic_evaluation_candidate_revisions later
      WHERE later.candidate_id=NEW.candidate_id AND later.revision>predecessor.revision) THEN
    RAISE EXCEPTION 'Topic evaluation candidate review successor already exists.' USING ERRCODE='23514';
  END IF;
  IF NEW.action='save' THEN
    IF predecessor.review_state<>'pending' OR NEW.review_state<>'pending'
      OR operation.input<>jsonb_build_object('action','save','candidate_key',candidate.candidate_key,
        'expected_revision',predecessor.revision,'state_token',operation.expected_state_token,
        'values',jsonb_build_object('title',NEW.title,'description',NEW.description,
          'inclusion',NEW.inclusion,'exclusion',NEW.exclusion)) THEN
      RAISE EXCEPTION 'Topic evaluation candidate save input is invalid.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.action='reject' THEN
    IF predecessor.review_state<>'pending' OR NEW.review_state<>'rejected'
      OR ROW(NEW.title,NEW.description,NEW.inclusion,NEW.exclusion)
        IS DISTINCT FROM ROW(predecessor.title,predecessor.description,predecessor.inclusion,predecessor.exclusion)
      OR operation.input<>jsonb_build_object('action','reject','candidate_key',candidate.candidate_key,
        'expected_revision',predecessor.revision,'state_token',operation.expected_state_token) THEN
      RAISE EXCEPTION 'Topic evaluation candidate reject input is invalid.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.action='restore' THEN
    IF predecessor.review_state<>'rejected' OR NEW.review_state<>'pending'
      OR ROW(NEW.title,NEW.description,NEW.inclusion,NEW.exclusion)
        IS DISTINCT FROM ROW(predecessor.title,predecessor.description,predecessor.inclusion,predecessor.exclusion)
      OR operation.input<>jsonb_build_object('action','restore','candidate_key',candidate.candidate_key,
        'expected_revision',predecessor.revision,'state_token',operation.expected_state_token) THEN
      RAISE EXCEPTION 'Topic evaluation candidate restore input is invalid.' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO target FROM signal_topic_evaluation_candidate_revisions
      WHERE candidate_id=NEW.candidate_id AND revision=operation.target_revision;
    IF target.id IS NULL OR target.id<>predecessor.predecessor_revision_id
      OR NEW.review_state<>target.review_state
      OR ROW(NEW.title,NEW.description,NEW.inclusion,NEW.exclusion)
        IS DISTINCT FROM ROW(target.title,target.description,target.inclusion,target.exclusion)
      OR operation.input<>jsonb_build_object('action','undo','candidate_key',candidate.candidate_key,
        'expected_revision',predecessor.revision,'state_token',operation.expected_state_token,
        'target_revision',target.revision) THEN
      RAISE EXCEPTION 'Topic evaluation candidate undo target is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF operation.input_digest<>'sha256:'||encode(digest(operation.input::text,'sha256'),'hex') THEN
    RAISE EXCEPTION 'Topic evaluation candidate review input digest is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_candidate_revision
BEFORE INSERT ON signal_topic_evaluation_candidate_revisions
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_candidate_revision_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_candidate_review_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_topic_evaluation_candidate_review_operations%ROWTYPE;
  current_revision signal_topic_evaluation_candidate_revisions%ROWTYPE;
  previous_revision signal_topic_evaluation_candidate_revisions%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM signal_topic_evaluation_candidate_review_operations WHERE id=NEW.operation_id;
  SELECT * INTO current_revision FROM signal_topic_evaluation_candidate_revisions WHERE id=operation.result_revision_id;
  SELECT * INTO previous_revision FROM signal_topic_evaluation_candidate_revisions
    WHERE id=current_revision.predecessor_revision_id;
  IF operation.id IS NULL OR current_revision.id IS NULL OR previous_revision.id IS NULL
    OR NEW.candidate_id<>operation.candidate_id OR NEW.run_id<>operation.run_id
    OR NEW.workspace_id<>operation.workspace_id
    OR NEW.event_kind<>(CASE operation.action WHEN 'save' THEN 'candidate_saved'
      WHEN 'reject' THEN 'candidate_rejected' WHEN 'restore' THEN 'candidate_restored'
      ELSE 'candidate_undone' END)
    OR NEW.previous_version_digest<>previous_revision.version_digest
    OR NEW.current_version_digest<>current_revision.version_digest THEN
    RAISE EXCEPTION 'Topic evaluation candidate review event is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_candidate_review_event
BEFORE INSERT ON signal_topic_evaluation_candidate_review_events
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_candidate_review_event_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_candidate_review_cohort_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM signal_topic_evaluation_candidate_revisions revision
      WHERE revision.operation_id=NEW.id)<>1
    OR (SELECT count(*) FROM signal_topic_evaluation_candidate_review_events event
      WHERE event.operation_id=NEW.id)<>1 THEN
    RAISE EXCEPTION 'Topic evaluation candidate review operation is incomplete.' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER trg_validate_signal_topic_evaluation_candidate_review_cohort
AFTER INSERT ON signal_topic_evaluation_candidate_review_operations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_candidate_review_cohort_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_candidate_review_v1()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Topic evaluation candidate review authority is append-only.' USING ERRCODE='55000';
END; $$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_candidate_revisions
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_candidate_revisions
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_candidate_review_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_candidate_review_operations
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_candidate_review_operations
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_candidate_review_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_candidate_review_events
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_candidate_review_events
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_candidate_review_v1();

CREATE INDEX idx_signal_topic_evaluation_candidate_revisions_current
  ON signal_topic_evaluation_candidate_revisions(candidate_id,revision DESC);
CREATE INDEX idx_signal_topic_evaluation_candidate_reviews_workspace
  ON signal_topic_evaluation_candidate_review_operations(workspace_id,created_at,id);

COMMENT ON TABLE signal_topic_evaluation_candidate_revisions IS
  'Append-only pending/rejected review history. It is not Topic adoption, publication, or serving.';
