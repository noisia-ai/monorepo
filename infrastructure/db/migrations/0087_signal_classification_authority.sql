-- Backend 10B: canonical semantic classification authority.
-- Forward-only. No data is backfilled, reclassified, projected, or published here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Historical autonomous assertions remain readable, but no new provider response may
-- claim approval authority. Human review can approve a model proposal under its own
-- explicit approval_source through the existing semantic Review writer.
ALTER TABLE signal_mention_attributions
  DROP CONSTRAINT IF EXISTS signal_mention_attribution_no_provider_autoapproval;
ALTER TABLE signal_mention_attributions
  ADD CONSTRAINT signal_mention_attribution_no_provider_autoapproval CHECK (
    approval_source IS DISTINCT FROM 'claude_semantic_resolution'
  ) NOT VALID;

-- Composite workspace keys used by the new authority. These do not reinterpret history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_taxonomy_profiles_workspace_id
  ON signal_taxonomy_profiles(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mentions_workspace_id
  ON mentions(workspace_id,id);

CREATE OR REPLACE FUNCTION signal_classification_watermark_digest_v1(
  target_workspace_id uuid,
  target_study_corpus_id uuid
)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*)=0 THEN NULL ELSE
    'sha256:'||encode(digest(convert_to(string_agg(
      concat_ws(':',watermark.id::text,watermark.source_key,
        watermark.corpus_revision::text,
        COALESCE(watermark.last_source_sync_run_id::text,''),
        COALESCE(watermark.last_import_batch_id::text,''),
        COALESCE(watermark.max_observed_at::text,''),
        watermark.accepted_at::text,watermark.materialized_at::text,
        watermark.source_freshness_state,watermark.data_freshness_state,
        COALESCE(watermark.stale_after::text,'')),
      '|' ORDER BY watermark.source_key,watermark.id),'UTF8'),'sha256'),'hex') END
  FROM signal_data_watermarks watermark
  WHERE watermark.workspace_id=target_workspace_id
    AND watermark.study_corpus_id=target_study_corpus_id;
$$;

-- ---------------------------------------------------------------------------
-- Immutable operation and event ledgers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signal_classification_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_kind text NOT NULL CHECK(operation_kind IN (
    'create-generation','append-results','finalize-generation','supersede-assignment',
    'register-labeling-function','register-approval-policy','register-gold-set',
    'register-model','transition-model','evaluate-classifier','evaluate-classifier-slice',
    'project-generation'
  )),
  idempotency_key text NOT NULL CHECK(idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT signal_classification_operation_completion CHECK (
    (status='in_progress' AND result IS NULL AND completed_at IS NULL)
    OR (status='completed' AND result IS NOT NULL AND completed_at IS NOT NULL)
  ),
  UNIQUE(workspace_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS signal_classification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  event_index integer NOT NULL CHECK(event_index>=0),
  event_kind text NOT NULL CHECK(event_kind IN (
    'generation-created','results-appended','generation-finalized','assignment-superseded',
    'labeling-function-registered','approval-policy-registered','gold-set-registered',
    'model-registered','model-transitioned','evaluation-recorded',
    'evaluation-slice-recorded','projection-rebuilt'
  )),
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  previous_state_digest text,
  next_state_digest text NOT NULL CHECK(next_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_digest text NOT NULL CHECK(event_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id,event_index),
  UNIQUE(workspace_id,event_digest)
);

CREATE OR REPLACE FUNCTION validate_signal_classification_operation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Classification operation actor is outside workspace authority.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_classification_operation_v1 ON signal_classification_operations;
CREATE TRIGGER validate_signal_classification_operation_v1 BEFORE INSERT
  ON signal_classification_operations FOR EACH ROW EXECUTE FUNCTION validate_signal_classification_operation_v1();

CREATE OR REPLACE FUNCTION validate_signal_classification_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
      WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id) THEN
    RAISE EXCEPTION 'Classification event is outside operation authority.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_classification_event_v1 ON signal_classification_events;
CREATE TRIGGER validate_signal_classification_event_v1 BEFORE INSERT
  ON signal_classification_events FOR EACH ROW EXECUTE FUNCTION validate_signal_classification_event_v1();

CREATE OR REPLACE FUNCTION protect_signal_classification_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Signal classification authority is append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS protect_signal_classification_operations_v1 ON signal_classification_operations;
CREATE TRIGGER protect_signal_classification_operations_v1
  BEFORE DELETE ON signal_classification_operations
  FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();

CREATE OR REPLACE FUNCTION protect_signal_classification_operation_transition_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR OLD.operation_kind IS DISTINCT FROM NEW.operation_kind
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.request_digest IS DISTINCT FROM NEW.request_digest
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.status<>'in_progress' OR NEW.status<>'completed'
     OR OLD.result IS NOT NULL OR NEW.result IS NULL
     OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Signal classification operation mutation is forbidden.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS protect_signal_classification_operation_transition_v1 ON signal_classification_operations;
CREATE TRIGGER protect_signal_classification_operation_transition_v1
  BEFORE UPDATE ON signal_classification_operations
  FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_operation_transition_v1();

DROP TRIGGER IF EXISTS protect_signal_classification_events_v1 ON signal_classification_events;
CREATE TRIGGER protect_signal_classification_events_v1
  BEFORE UPDATE OR DELETE ON signal_classification_events
  FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();

-- ---------------------------------------------------------------------------
-- Versioned deterministic labeling functions and explicit approval policies
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signal_labeling_function_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  owner_kind text NOT NULL CHECK(owner_kind IN ('platform','workspace')),
  function_key text NOT NULL,
  version integer NOT NULL CHECK(version>=1),
  contract_version text NOT NULL DEFAULT 'signal-labeling-function-v1'
    CHECK(contract_version='signal-labeling-function-v1'),
  taxonomy_profile_id uuid REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  taxonomy_term_id uuid NOT NULL REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
  input_contract jsonb NOT NULL,
  output_contract jsonb NOT NULL,
  definition_hash text NOT NULL CHECK(definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('draft','approved','retired')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  supersedes_id uuid REFERENCES signal_labeling_function_versions(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_labeling_function_owner CHECK (
    (owner_kind='platform' AND workspace_id IS NULL AND taxonomy_profile_id IS NULL)
    OR (owner_kind='workspace' AND workspace_id IS NOT NULL AND taxonomy_profile_id IS NOT NULL)
  ),
  CONSTRAINT signal_labeling_function_approval CHECK (
    (status='draft' AND approved_by_user_id IS NULL)
    OR (status IN ('approved','retired') AND approved_by_user_id IS NOT NULL)
  ),
  CONSTRAINT signal_labeling_function_period CHECK(effective_to IS NULL OR effective_to>effective_from),
  CONSTRAINT signal_labeling_function_contract_shape CHECK (
    jsonb_typeof(input_contract)='object'
    AND jsonb_typeof(output_contract)='object'
    AND NOT (input_contract ?| ARRAY['sql','javascript','expression','code','query'])
    AND NOT (output_contract ?| ARRAY['sql','javascript','expression','code','query'])
    AND jsonb_typeof(output_contract->'outcomes')='array'
    AND (output_contract->'outcomes') <@ '["vote","abstain"]'::jsonb
    AND (output_contract->'outcomes') @> '["abstain"]'::jsonb
    AND pg_column_size(input_contract)<=65536
    AND pg_column_size(output_contract)<=16384
  ),
  UNIQUE(owner_kind,workspace_id,function_key,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_labeling_function_platform_version
  ON signal_labeling_function_versions(function_key,version)
  WHERE owner_kind='platform';
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_labeling_function_supersedes
  ON signal_labeling_function_versions(supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_classification_approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  taxonomy_profile_id uuid NOT NULL REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  policy_key text NOT NULL,
  version integer NOT NULL CHECK(version>=1),
  authority_kind text NOT NULL CHECK(authority_kind IN ('exact','labeling_function','model')),
  labeling_function_version_id uuid REFERENCES signal_labeling_function_versions(id) ON DELETE RESTRICT,
  model_version_id uuid REFERENCES tagging_model_versions(id) ON DELETE RESTRICT,
  exact_contract_hash text,
  definition_hash text NOT NULL CHECK(definition_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('draft','approved','retired')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  supersedes_id uuid REFERENCES signal_classification_approval_policies(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_classification_policy_authority_shape CHECK (
    (authority_kind='exact' AND exact_contract_hash ~ '^sha256:[0-9a-f]{64}$'
      AND labeling_function_version_id IS NULL AND model_version_id IS NULL)
    OR (authority_kind='labeling_function' AND labeling_function_version_id IS NOT NULL
      AND model_version_id IS NULL AND exact_contract_hash IS NULL)
    OR (authority_kind='model' AND model_version_id IS NOT NULL
      AND labeling_function_version_id IS NULL AND exact_contract_hash IS NULL)
  ),
  CONSTRAINT signal_classification_policy_approval CHECK (
    (status='draft' AND approved_by_user_id IS NULL)
    OR (status IN ('approved','retired') AND approved_by_user_id IS NOT NULL)
  ),
  CONSTRAINT signal_classification_policy_period CHECK(effective_to IS NULL OR effective_to>effective_from),
  UNIQUE(workspace_id,policy_key,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_classification_policy_supersedes
  ON signal_classification_approval_policies(supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_signal_classification_policy_scope_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_taxonomy uuid; DECLARE term_taxonomy uuid; DECLARE taxonomy_scope text;
BEGIN
  IF TG_TABLE_NAME='signal_labeling_function_versions' THEN
    SELECT term.taxonomy_id,taxonomy.scope INTO term_taxonomy,taxonomy_scope
    FROM taxonomy_terms term JOIN taxonomies taxonomy ON taxonomy.id=term.taxonomy_id
    WHERE term.id=NEW.taxonomy_term_id AND term.status='active' AND taxonomy.status='active';
    IF NEW.owner_kind='workspace' THEN
      SELECT taxonomy_id INTO profile_taxonomy FROM signal_taxonomy_profiles
       WHERE id=NEW.taxonomy_profile_id AND workspace_id=NEW.workspace_id AND status='active';
      IF profile_taxonomy IS NULL
         OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
         OR (NEW.approved_by_user_id IS NOT NULL
           AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.approved_by_user_id)) THEN
        RAISE EXCEPTION 'Labeling function actor is outside workspace authority.' USING ERRCODE='23514';
      END IF;
    ELSIF taxonomy_scope<>'global'
       OR NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.created_by_user_id
         AND actor.status='active' AND actor.user_type='noisia_internal')
       OR (NEW.approved_by_user_id IS NOT NULL AND NOT EXISTS(
         SELECT 1 FROM users actor WHERE actor.id=NEW.approved_by_user_id
           AND actor.status='active' AND actor.user_type='noisia_internal')) THEN
      RAISE EXCEPTION 'Platform labeling function authority is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.owner_kind='workspace' AND term_taxonomy IS DISTINCT FROM profile_taxonomy THEN
      RAISE EXCEPTION 'Labeling function term is incompatible with profile.' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
      WHERE operation.id=NEW.operation_id AND operation.operation_kind='register-labeling-function'
        AND operation.status='in_progress' AND operation.actor_user_id=NEW.created_by_user_id
        AND (NEW.workspace_id IS NULL OR operation.workspace_id=NEW.workspace_id)) THEN
      RAISE EXCEPTION 'Labeling function registration operation is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM signal_labeling_function_versions prior
      WHERE prior.id=NEW.supersedes_id AND prior.owner_kind=NEW.owner_kind
        AND prior.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
        AND prior.function_key=NEW.function_key AND NEW.version=prior.version+1) THEN
      RAISE EXCEPTION 'Labeling function supersession is invalid.' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT taxonomy_id INTO profile_taxonomy FROM signal_taxonomy_profiles
      WHERE id=NEW.taxonomy_profile_id AND workspace_id=NEW.workspace_id AND status='active';
    IF profile_taxonomy IS NULL THEN
      RAISE EXCEPTION 'Classification profile is outside workspace.' USING ERRCODE='23514';
    END IF;
    IF NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
     OR (NEW.approved_by_user_id IS NOT NULL
       AND NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.approved_by_user_id))
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
         AND operation.operation_kind='register-approval-policy' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.created_by_user_id) THEN
      RAISE EXCEPTION 'Classification approval policy authority is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='signal_classification_approval_policies' THEN
    IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM signal_classification_approval_policies prior
      WHERE prior.id=NEW.supersedes_id AND prior.workspace_id=NEW.workspace_id
        AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
        AND prior.policy_key=NEW.policy_key AND prior.authority_kind=NEW.authority_kind
        AND NEW.version=prior.version+1) THEN
      RAISE EXCEPTION 'Classification approval policy supersession is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.authority_kind='labeling_function' AND NOT EXISTS(
      SELECT 1 FROM signal_labeling_function_versions lf
      WHERE lf.id=NEW.labeling_function_version_id
        AND lf.status='approved'
        AND (lf.owner_kind='platform' OR lf.workspace_id=NEW.workspace_id)
        AND (lf.taxonomy_profile_id IS NULL OR lf.taxonomy_profile_id=NEW.taxonomy_profile_id)
        AND lf.effective_from<=NEW.created_at
        AND (lf.effective_to IS NULL OR lf.effective_to>NEW.created_at)
    ) THEN
      RAISE EXCEPTION 'Approval policy labeling function is not approved or compatible.' USING ERRCODE='23514';
    ELSIF NEW.authority_kind='model' AND NOT EXISTS(
      SELECT 1 FROM tagging_model_versions model
      WHERE model.id=NEW.model_version_id
        AND model.registry_contract_version='signal-tagging-model-registry-v1'
        AND model.taxonomy_profile_id=NEW.taxonomy_profile_id
        AND (SELECT event.status FROM signal_tagging_model_version_events event
          WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=model.id
            AND event.effective_at<=NEW.created_at
          ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved'
    ) THEN
      RAISE EXCEPTION 'Approval policy model is not explicitly approved.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_signal_labeling_function_scope_v1 ON signal_labeling_function_versions;
CREATE TRIGGER validate_signal_labeling_function_scope_v1 BEFORE INSERT
  ON signal_labeling_function_versions FOR EACH ROW
  EXECUTE FUNCTION validate_signal_classification_policy_scope_v1();
DROP TRIGGER IF EXISTS validate_signal_classification_policy_scope_v1 ON signal_classification_approval_policies;
CREATE TRIGGER validate_signal_classification_policy_scope_v1 BEFORE INSERT
  ON signal_classification_approval_policies FOR EACH ROW
  EXECUTE FUNCTION validate_signal_classification_policy_scope_v1();

DROP TRIGGER IF EXISTS protect_signal_labeling_function_versions_v1 ON signal_labeling_function_versions;
CREATE TRIGGER protect_signal_labeling_function_versions_v1 BEFORE UPDATE OR DELETE
  ON signal_labeling_function_versions FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();
DROP TRIGGER IF EXISTS protect_signal_classification_approval_policies_v1 ON signal_classification_approval_policies;
CREATE TRIGGER protect_signal_classification_approval_policies_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_approval_policies FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();

CREATE OR REPLACE FUNCTION register_signal_labeling_function_v1(
  target_workspace_id uuid,target_owner_kind text,target_function_key text,target_version integer,
  target_taxonomy_profile_id uuid,target_taxonomy_term_id uuid,target_input_contract jsonb,
  target_output_contract jsonb,target_definition_hash text,target_status text,
  target_effective_from timestamptz,target_effective_to timestamptz,
  target_supersedes_id uuid,target_actor_user_id uuid,target_idempotency_key text,
  target_request_digest text
)
RETURNS TABLE(labeling_function_version_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':labeling-function:'||target_function_key,0));
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Labeling function registration authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'register-labeling-function',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.operation_kind<>'register-labeling-function'
     OR operation.request_digest<>target_request_digest OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    labeling_function_version_id:=(operation.result->>'labeling_function_version_id')::uuid;
    created:=false; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO signal_labeling_function_versions(workspace_id,owner_kind,function_key,version,
    taxonomy_profile_id,taxonomy_term_id,input_contract,output_contract,definition_hash,status,
    effective_from,effective_to,supersedes_id,operation_id,created_by_user_id,approved_by_user_id)
  VALUES(CASE WHEN target_owner_kind='workspace' THEN target_workspace_id END,target_owner_kind,
    target_function_key,target_version,
    CASE WHEN target_owner_kind='workspace' THEN target_taxonomy_profile_id END,
    target_taxonomy_term_id,target_input_contract,target_output_contract,target_definition_hash,
    target_status,target_effective_from,target_effective_to,target_supersedes_id,operation.id,
    target_actor_user_id,CASE WHEN target_status IN ('approved','retired') THEN target_actor_user_id END)
  RETURNING id INTO labeling_function_version_id;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'labeling-function-registered','labeling-function',
    labeling_function_version_id,
    (SELECT definition_hash FROM signal_labeling_function_versions WHERE id=target_supersedes_id),
    target_definition_hash,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||target_definition_hash,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('labeling_function_version_id',labeling_function_version_id)
  WHERE id=operation.id;
  created:=true; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION register_signal_classification_approval_policy_v1(
  target_workspace_id uuid,target_taxonomy_profile_id uuid,target_policy_key text,
  target_version integer,target_authority_kind text,target_labeling_function_version_id uuid,
  target_model_version_id uuid,target_exact_contract_hash text,target_definition_hash text,
  target_status text,target_effective_from timestamptz,target_effective_to timestamptz,
  target_supersedes_id uuid,target_actor_user_id uuid,target_idempotency_key text,
  target_request_digest text
)
RETURNS TABLE(approval_policy_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':classification-policy:'||target_policy_key,0));
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$'
     OR (target_supersedes_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM signal_classification_approval_policies prior
       WHERE prior.id=target_supersedes_id AND prior.workspace_id=target_workspace_id
         AND prior.taxonomy_profile_id=target_taxonomy_profile_id
         AND prior.policy_key=target_policy_key AND prior.version<target_version)) THEN
    RAISE EXCEPTION 'Classification approval policy authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'register-approval-policy',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.operation_kind<>'register-approval-policy'
     OR operation.request_digest<>target_request_digest OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    approval_policy_id:=(operation.result->>'approval_policy_id')::uuid;
    created:=false; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO signal_classification_approval_policies(workspace_id,taxonomy_profile_id,policy_key,
    version,authority_kind,labeling_function_version_id,model_version_id,exact_contract_hash,
    definition_hash,status,effective_from,effective_to,supersedes_id,operation_id,
    created_by_user_id,approved_by_user_id)
  VALUES(target_workspace_id,target_taxonomy_profile_id,target_policy_key,target_version,
    target_authority_kind,target_labeling_function_version_id,target_model_version_id,
    target_exact_contract_hash,target_definition_hash,target_status,target_effective_from,
    target_effective_to,target_supersedes_id,operation.id,target_actor_user_id,
    CASE WHEN target_status IN ('approved','retired') THEN target_actor_user_id END)
  RETURNING id INTO approval_policy_id;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'approval-policy-registered','approval-policy',
    approval_policy_id,
    (SELECT definition_hash FROM signal_classification_approval_policies WHERE id=target_supersedes_id),
    target_definition_hash,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||target_definition_hash,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('approval_policy_id',approval_policy_id)
  WHERE id=operation.id;
  created:=true; RETURN NEXT;
END; $$;

-- ---------------------------------------------------------------------------
-- Harden the existing model registry without storing artifacts in PostgreSQL.
-- Legacy rows remain readable and are never reinterpreted.
-- ---------------------------------------------------------------------------

ALTER TABLE tagging_model_versions
  ADD COLUMN IF NOT EXISTS registry_contract_version text,
  ADD COLUMN IF NOT EXISTS artifact_digest text,
  ADD COLUMN IF NOT EXISTS runtime_kind text,
  ADD COLUMN IF NOT EXISTS artifact_format text,
  ADD COLUMN IF NOT EXISTS configuration jsonb,
  ADD COLUMN IF NOT EXISTS configuration_digest text,
  ADD COLUMN IF NOT EXISTS dataset_digest text,
  ADD COLUMN IF NOT EXISTS gold_set_digest text,
  ADD COLUMN IF NOT EXISTS license_key text,
  ADD COLUMN IF NOT EXISTS provenance_digest text,
  ADD COLUMN IF NOT EXISTS taxonomy_profile_id uuid REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS supersedes_model_version_id uuid REFERENCES tagging_model_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS registry_operation_id uuid REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS registered_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE tagging_model_versions DROP CONSTRAINT IF EXISTS signal_tagging_model_registry_shape;
ALTER TABLE tagging_model_versions ADD CONSTRAINT signal_tagging_model_registry_shape CHECK (
  (registry_contract_version IS NULL)
  OR (registry_contract_version='signal-tagging-model-registry-v1'
    AND artifact_digest ~ '^sha256:[0-9a-f]{64}$'
    AND configuration_digest ~ '^sha256:[0-9a-f]{64}$'
    AND dataset_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provenance_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(runtime_kind)) BETWEEN 1 AND 80
    AND length(btrim(artifact_format)) BETWEEN 1 AND 80
    AND jsonb_typeof(configuration)='object'
    AND pg_column_size(configuration)<=65536
    AND NOT (configuration ?| ARRAY['binary','model_bytes','artifact_payload','provider_response'])
    AND registry_operation_id IS NOT NULL
    AND registered_by_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_tagging_model_registry_supersedes
  ON tagging_model_versions(supersedes_model_version_id)
  WHERE registry_contract_version='signal-tagging-model-registry-v1'
    AND supersedes_model_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_signal_tagging_model_registry_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_workspace_id uuid;
BEGIN
  IF NEW.registry_contract_version IS NULL THEN RETURN NEW; END IF;
  SELECT workspace_id INTO target_workspace_id FROM signal_taxonomy_profiles
    WHERE id=NEW.taxonomy_profile_id AND status='active';
  IF target_workspace_id IS NULL
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,NEW.registered_by_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.registry_operation_id AND operation.workspace_id=target_workspace_id
         AND operation.operation_kind='register-model' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.registered_by_user_id)
     OR (NEW.supersedes_model_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM tagging_model_versions prior
       WHERE prior.id=NEW.supersedes_model_version_id
         AND prior.registry_contract_version='signal-tagging-model-registry-v1'
         AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
         AND prior.model_key=NEW.model_key AND prior.version<>NEW.version)) THEN
    RAISE EXCEPTION 'Tagging model registry authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_tagging_model_registry_v1 ON tagging_model_versions;
CREATE TRIGGER validate_signal_tagging_model_registry_v1 BEFORE INSERT
  ON tagging_model_versions FOR EACH ROW EXECUTE FUNCTION validate_signal_tagging_model_registry_v1();

CREATE TABLE IF NOT EXISTS signal_tagging_model_version_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  model_version_id uuid NOT NULL REFERENCES tagging_model_versions(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  event_index integer NOT NULL CHECK(event_index>=0),
  status text NOT NULL CHECK(status IN ('draft','evaluated','approved','retired')),
  evaluation_id uuid,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  effective_at timestamptz NOT NULL,
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id,event_index)
);

CREATE OR REPLACE FUNCTION validate_signal_tagging_model_version_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_status text; DECLARE prior_effective_at timestamptz;
BEGIN
  SELECT event.status,event.effective_at INTO prior_status,prior_effective_at
  FROM signal_tagging_model_version_events event
    WHERE event.workspace_id=NEW.workspace_id AND event.model_version_id=NEW.model_version_id
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1;
  IF NOT EXISTS(SELECT 1 FROM tagging_model_versions model
      WHERE model.id=NEW.model_version_id
        AND model.registry_contract_version='signal-tagging-model-registry-v1'
        AND model.taxonomy_profile_id IN (SELECT id FROM signal_taxonomy_profiles
          WHERE workspace_id=NEW.workspace_id))
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
         AND operation.actor_user_id=NEW.actor_user_id
         AND operation.operation_kind IN ('register-model','transition-model'))
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
     OR (prior_status IS NULL AND NEW.status<>'draft')
     OR (prior_status='draft' AND NEW.status<>'evaluated')
     OR (prior_status='evaluated' AND NEW.status NOT IN ('approved','retired'))
     OR (prior_status='approved' AND NEW.status<>'retired')
     OR prior_status='retired'
     OR (prior_effective_at IS NOT NULL AND NEW.effective_at<prior_effective_at)
     OR (NEW.status='evaluated' AND NEW.evaluation_id IS NULL)
     OR (NEW.status='draft' AND NEW.evaluation_id IS NOT NULL)
     OR (NEW.status='evaluated' AND NOT EXISTS(
       SELECT 1 FROM signal_classification_evaluations evaluation
       WHERE evaluation.id=NEW.evaluation_id AND evaluation.workspace_id=NEW.workspace_id
         AND evaluation.evaluated_model_version_id=NEW.model_version_id)) THEN
    RAISE EXCEPTION 'Tagging model lifecycle transition is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_tagging_model_version_event_v1 ON signal_tagging_model_version_events;
CREATE TRIGGER validate_signal_tagging_model_version_event_v1 BEFORE INSERT
  ON signal_tagging_model_version_events FOR EACH ROW
  EXECUTE FUNCTION validate_signal_tagging_model_version_event_v1();

DROP TRIGGER IF EXISTS protect_signal_tagging_model_version_events_v1 ON signal_tagging_model_version_events;
CREATE TRIGGER protect_signal_tagging_model_version_events_v1 BEFORE UPDATE OR DELETE
  ON signal_tagging_model_version_events FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();

CREATE OR REPLACE FUNCTION protect_signal_tagging_model_registry_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.registry_contract_version IS NOT NULL THEN
    RAISE EXCEPTION 'Registered tagging model versions are immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS protect_signal_tagging_model_registry_v1 ON tagging_model_versions;
CREATE TRIGGER protect_signal_tagging_model_registry_v1 BEFORE UPDATE OR DELETE
  ON tagging_model_versions FOR EACH ROW EXECUTE FUNCTION protect_signal_tagging_model_registry_v1();

CREATE OR REPLACE FUNCTION register_signal_tagging_model_v1(
  target_workspace_id uuid,target_taxonomy_profile_id uuid,target_model_key text,
  target_version text,target_provider text,target_tagging_rule_set_id uuid,
  target_artifact_digest text,target_runtime_kind text,target_artifact_format text,
  target_configuration jsonb,target_configuration_digest text,target_dataset_digest text,
  target_gold_set_digest text,target_license_key text,target_provenance_digest text,
  target_supersedes_model_version_id uuid,target_actor_user_id uuid,
  target_idempotency_key text,target_request_digest text
)
RETURNS TABLE(model_version_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':tagging-model:'||target_model_key,0));
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Tagging model registration authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'register-model',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.operation_kind<>'register-model'
     OR operation.request_digest<>target_request_digest OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    model_version_id:=(operation.result->>'model_version_id')::uuid;
    created:=false; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO tagging_model_versions(model_key,provider,version,tagging_rule_set_id,
    registry_contract_version,artifact_digest,runtime_kind,artifact_format,configuration,
    configuration_digest,dataset_digest,gold_set_digest,license_key,provenance_digest,
    taxonomy_profile_id,supersedes_model_version_id,registry_operation_id,registered_by_user_id)
  VALUES(target_model_key,target_provider,target_version,target_tagging_rule_set_id,
    'signal-tagging-model-registry-v1',target_artifact_digest,target_runtime_kind,
    target_artifact_format,target_configuration,target_configuration_digest,target_dataset_digest,
    target_gold_set_digest,target_license_key,target_provenance_digest,target_taxonomy_profile_id,
    target_supersedes_model_version_id,operation.id,target_actor_user_id)
  RETURNING id INTO model_version_id;
  INSERT INTO signal_tagging_model_version_events(workspace_id,model_version_id,operation_id,
    event_index,status,actor_user_id,effective_at,evidence_digest)
  VALUES(target_workspace_id,model_version_id,operation.id,0,'draft',target_actor_user_id,
    now(),target_artifact_digest);
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'model-registered','model-version',model_version_id,
    (SELECT artifact_digest FROM tagging_model_versions WHERE id=target_supersedes_model_version_id),
    target_artifact_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||target_artifact_digest,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('model_version_id',model_version_id)
  WHERE id=operation.id;
  created:=true; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION transition_signal_tagging_model_v1(
  target_workspace_id uuid,target_model_version_id uuid,target_status text,
  target_evaluation_id uuid,target_effective_at timestamptz,target_evidence_digest text,
  target_actor_user_id uuid,target_idempotency_key text,target_request_digest text
)
RETURNS TABLE(model_version_id uuid,status text,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE; DECLARE prior_digest text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':tagging-model-transition:'||target_model_version_id::text,0));
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Tagging model transition authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'transition-model',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.operation_kind<>'transition-model'
     OR operation.request_digest<>target_request_digest OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    model_version_id:=(operation.result->>'model_version_id')::uuid;
    status:=operation.result->>'status'; created:=false; RETURN NEXT; RETURN;
  END IF;
  SELECT event.evidence_digest INTO prior_digest FROM signal_tagging_model_version_events event
    WHERE event.workspace_id=target_workspace_id AND event.model_version_id=target_model_version_id
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1;
  INSERT INTO signal_tagging_model_version_events(workspace_id,model_version_id,operation_id,
    event_index,status,evaluation_id,actor_user_id,effective_at,evidence_digest)
  VALUES(target_workspace_id,target_model_version_id,operation.id,0,target_status,
    target_evaluation_id,target_actor_user_id,target_effective_at,target_evidence_digest);
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'model-transitioned','model-version',
    target_model_version_id,prior_digest,target_evidence_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||target_evidence_digest,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('model_version_id',target_model_version_id,'status',target_status)
  WHERE id=operation.id;
  model_version_id:=target_model_version_id; status:=target_status; created:=true; RETURN NEXT;
END; $$;

-- ---------------------------------------------------------------------------
-- Immutable generations, denominator items, and assignment ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signal_classification_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  taxonomy_profile_id uuid NOT NULL REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  generation_key text NOT NULL,
  generation_version integer NOT NULL CHECK(generation_version>=1),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','ready','retired')),
  study_corpus_id uuid REFERENCES study_corpora(id) ON DELETE RESTRICT,
  input_population_digest text NOT NULL CHECK(input_population_digest ~ '^sha256:[0-9a-f]{64}$'),
  input_watermark_digest text NOT NULL CHECK(input_watermark_digest ~ '^sha256:[0-9a-f]{64}$'),
  identity_catalog_digest text NOT NULL CHECK(identity_catalog_digest ~ '^sha256:[0-9a-f]{64}$'),
  denominator integer NOT NULL CHECK(denominator>=0),
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supersedes_generation_id uuid REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
  definition_digest text NOT NULL CHECK(definition_digest ~ '^sha256:[0-9a-f]{64}$'),
  finalized_digest text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT signal_classification_generation_finalized CHECK (
    (status='open' AND finalized_digest IS NULL AND finalized_at IS NULL)
    OR (status IN ('ready','retired') AND finalized_digest ~ '^sha256:[0-9a-f]{64}$' AND finalized_at IS NOT NULL)
  ),
  UNIQUE(workspace_id,generation_key,generation_version),
  UNIQUE(workspace_id,id)
);

CREATE TABLE IF NOT EXISTS signal_classification_generation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
  canonical_root_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  resolution_state text NOT NULL CHECK(resolution_state IN (
    'approved','pending','rejected','abstained','error'
  )),
  technical_error_code text,
  item_digest text NOT NULL CHECK(item_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,generation_id)
    REFERENCES signal_classification_generations(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,canonical_root_id)
    REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT signal_classification_item_error_shape CHECK (
    (resolution_state='error' AND length(btrim(technical_error_code)) BETWEEN 1 AND 120)
    OR (resolution_state<>'error' AND technical_error_code IS NULL)
  ),
  UNIQUE(generation_id,canonical_root_id),
  UNIQUE(workspace_id,id)
);

CREATE TABLE IF NOT EXISTS signal_classification_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
  generation_item_id uuid NOT NULL REFERENCES signal_classification_generation_items(id) ON DELETE RESTRICT,
  canonical_root_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  taxonomy_profile_id uuid NOT NULL REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  taxonomy_term_id uuid REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
  resolution_method text NOT NULL CHECK(resolution_method IN ('exact','labeling_function','model','human')),
  disposition text NOT NULL CHECK(disposition IN ('approved','pending','rejected','abstained')),
  labeling_function_version_id uuid REFERENCES signal_labeling_function_versions(id) ON DELETE RESTRICT,
  model_version_id uuid REFERENCES tagging_model_versions(id) ON DELETE RESTRICT,
  approval_policy_id uuid REFERENCES signal_classification_approval_policies(id) ON DELETE RESTRICT,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  score numeric,
  confidence text,
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  lineage_digest text NOT NULL CHECK(lineage_digest ~ '^sha256:[0-9a-f]{64}$'),
  supersedes_assignment_id uuid REFERENCES signal_classification_assignments(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,generation_id)
    REFERENCES signal_classification_generations(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,generation_item_id)
    REFERENCES signal_classification_generation_items(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,canonical_root_id)
    REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT signal_classification_assignment_term_shape CHECK (
    (disposition='abstained' AND taxonomy_term_id IS NULL)
    OR (disposition<>'abstained' AND taxonomy_term_id IS NOT NULL)
  ),
  CONSTRAINT signal_classification_assignment_method_shape CHECK (
    (resolution_method='exact' AND labeling_function_version_id IS NULL AND model_version_id IS NULL)
    OR (resolution_method='labeling_function' AND labeling_function_version_id IS NOT NULL AND model_version_id IS NULL)
    OR (resolution_method='model' AND model_version_id IS NOT NULL AND labeling_function_version_id IS NULL)
    OR (resolution_method='human' AND decided_by_user_id IS NOT NULL
      AND labeling_function_version_id IS NULL AND model_version_id IS NULL)
  ),
  UNIQUE(generation_id,canonical_root_id,taxonomy_term_id,resolution_method,created_at,id),
  UNIQUE(workspace_id,id)
);

CREATE INDEX IF NOT EXISTS idx_signal_classification_items_coverage
  ON signal_classification_generation_items(generation_id,resolution_state,canonical_root_id);
CREATE INDEX IF NOT EXISTS idx_signal_classification_assignments_current
  ON signal_classification_assignments(generation_id,disposition,taxonomy_term_id,canonical_root_id);
CREATE INDEX IF NOT EXISTS idx_signal_classification_assignments_supersession
  ON signal_classification_assignments(supersedes_assignment_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_classification_assignment_supersedes
  ON signal_classification_assignments(supersedes_assignment_id)
  WHERE supersedes_assignment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_classification_generation_supersedes
  ON signal_classification_generations(supersedes_generation_id)
  WHERE supersedes_generation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_signal_classification_assignment_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE item signal_classification_generation_items%ROWTYPE;
DECLARE profile_taxonomy uuid; DECLARE term_taxonomy uuid;
DECLARE policy signal_classification_approval_policies%ROWTYPE;
BEGIN
  SELECT * INTO generation FROM signal_classification_generations WHERE id=NEW.generation_id;
  SELECT * INTO item FROM signal_classification_generation_items WHERE id=NEW.generation_item_id;
  SELECT taxonomy_id INTO profile_taxonomy FROM signal_taxonomy_profiles
   WHERE id=NEW.taxonomy_profile_id AND workspace_id=NEW.workspace_id AND status='active';
  IF generation.id IS NULL OR generation.status<>'open'
     OR generation.workspace_id<>NEW.workspace_id
     OR generation.taxonomy_profile_id<>NEW.taxonomy_profile_id
     OR item.id IS NULL OR item.workspace_id<>NEW.workspace_id
     OR item.generation_id<>NEW.generation_id OR item.canonical_root_id<>NEW.canonical_root_id
     OR item.resolution_state<>NEW.disposition
     OR NOT EXISTS(SELECT 1 FROM mentions mention WHERE mention.id=NEW.canonical_root_id
       AND mention.workspace_id=NEW.workspace_id AND mention.canonical_mention_id=mention.id) THEN
    RAISE EXCEPTION 'Classification assignment scope is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.taxonomy_term_id IS NOT NULL THEN
    SELECT taxonomy_id INTO term_taxonomy FROM taxonomy_terms
      WHERE id=NEW.taxonomy_term_id AND status='active';
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
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_signal_classification_assignment_v1 ON signal_classification_assignments;
CREATE TRIGGER validate_signal_classification_assignment_v1 BEFORE INSERT
  ON signal_classification_assignments FOR EACH ROW EXECUTE FUNCTION validate_signal_classification_assignment_v1();

CREATE OR REPLACE FUNCTION validate_signal_classification_generation_item_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM signal_classification_generations generation
      WHERE generation.id=NEW.generation_id AND generation.workspace_id=NEW.workspace_id
        AND generation.status='open')
     OR NOT EXISTS(SELECT 1 FROM mentions mention WHERE mention.id=NEW.canonical_root_id
       AND mention.workspace_id=NEW.workspace_id AND mention.canonical_mention_id=mention.id) THEN
    RAISE EXCEPTION 'Classification generation item is outside open generation authority.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_classification_generation_item_v1 ON signal_classification_generation_items;
CREATE TRIGGER validate_signal_classification_generation_item_v1 BEFORE INSERT
  ON signal_classification_generation_items FOR EACH ROW EXECUTE FUNCTION validate_signal_classification_generation_item_v1();

DROP TRIGGER IF EXISTS protect_signal_classification_generation_items_v1 ON signal_classification_generation_items;
CREATE TRIGGER protect_signal_classification_generation_items_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_generation_items FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();
DROP TRIGGER IF EXISTS protect_signal_classification_assignments_v1 ON signal_classification_assignments;
CREATE TRIGGER protect_signal_classification_assignments_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_assignments FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();

CREATE OR REPLACE FUNCTION protect_signal_classification_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_count integer; DECLARE actual_digest text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Classification generations are immutable.' USING ERRCODE='55000'; END IF;
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.taxonomy_profile_id IS DISTINCT FROM NEW.taxonomy_profile_id
     OR OLD.generation_key IS DISTINCT FROM NEW.generation_key OR OLD.generation_version IS DISTINCT FROM NEW.generation_version
     OR OLD.study_corpus_id IS DISTINCT FROM NEW.study_corpus_id
     OR OLD.input_population_digest IS DISTINCT FROM NEW.input_population_digest
     OR OLD.input_watermark_digest IS DISTINCT FROM NEW.input_watermark_digest
     OR OLD.identity_catalog_digest IS DISTINCT FROM NEW.identity_catalog_digest
     OR OLD.denominator IS DISTINCT FROM NEW.denominator OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
     OR OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id
     OR OLD.supersedes_generation_id IS DISTINCT FROM NEW.supersedes_generation_id
     OR OLD.definition_digest IS DISTINCT FROM NEW.definition_digest OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.status<>'open' OR NEW.status NOT IN ('ready','retired') THEN
    RAISE EXCEPTION 'Classification generation mutation is forbidden.' USING ERRCODE='55000';
  END IF;
  SELECT count(*)::int,
    'sha256:'||encode(digest(convert_to(COALESCE(string_agg(item_digest,'' ORDER BY canonical_root_id),'empty'),'UTF8'),'sha256'),'hex')
    INTO actual_count,actual_digest FROM signal_classification_generation_items WHERE generation_id=OLD.id;
  IF actual_count<>NEW.denominator OR NEW.finalized_digest<>actual_digest OR NEW.finalized_at IS NULL THEN
    RAISE EXCEPTION 'Classification generation finalization does not reconcile.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS protect_signal_classification_generation_v1 ON signal_classification_generations;
CREATE TRIGGER protect_signal_classification_generation_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_generations FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_generation_v1();

-- ---------------------------------------------------------------------------
-- Gold sets and reproducible evaluations. Unknown metrics remain NULL.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signal_classification_gold_set_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  taxonomy_profile_id uuid NOT NULL REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  gold_set_key text NOT NULL,
  version integer NOT NULL CHECK(version>=1),
  definition_digest text NOT NULL CHECK(definition_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','retired')),
  expected_item_count integer NOT NULL CHECK(expected_item_count>=0),
  finalized_digest text,
  finalized_at timestamptz,
  supersedes_id uuid REFERENCES signal_classification_gold_set_versions(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_classification_gold_set_period CHECK(effective_to IS NULL OR effective_to>effective_from),
  CONSTRAINT signal_classification_gold_set_finalization CHECK (
    (status='draft' AND finalized_digest IS NULL AND finalized_at IS NULL)
    OR (status IN ('ready','retired') AND finalized_digest ~ '^sha256:[0-9a-f]{64}$'
      AND finalized_at IS NOT NULL)
  ),
  UNIQUE(workspace_id,gold_set_key,version),
  UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_classification_gold_set_supersedes
  ON signal_classification_gold_set_versions(supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_signal_classification_gold_set_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile
       WHERE profile.id=NEW.taxonomy_profile_id AND profile.workspace_id=NEW.workspace_id
         AND profile.status='active')
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
         AND operation.operation_kind='register-gold-set' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.created_by_user_id)
     OR (NEW.supersedes_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM signal_classification_gold_set_versions prior
       WHERE prior.id=NEW.supersedes_id AND prior.workspace_id=NEW.workspace_id
         AND prior.taxonomy_profile_id=NEW.taxonomy_profile_id
         AND prior.gold_set_key=NEW.gold_set_key AND NEW.version=prior.version+1)) THEN
    RAISE EXCEPTION 'Classification gold-set authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_classification_gold_set_v1
  ON signal_classification_gold_set_versions;
CREATE TRIGGER validate_signal_classification_gold_set_v1 BEFORE INSERT
  ON signal_classification_gold_set_versions FOR EACH ROW
  EXECUTE FUNCTION validate_signal_classification_gold_set_v1();

CREATE OR REPLACE FUNCTION signal_classification_slice_keys_are_valid_v1(target_slice_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(target_slice_keys)<=32
    AND NOT EXISTS(SELECT 1 FROM unnest(target_slice_keys) slice_key
      WHERE slice_key !~ '^[a-z0-9][a-z0-9._:-]{0,119}$')
    AND cardinality(target_slice_keys)=cardinality(
      ARRAY(SELECT DISTINCT value FROM unnest(target_slice_keys) value));
$$;

CREATE TABLE IF NOT EXISTS signal_classification_gold_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  gold_set_version_id uuid NOT NULL REFERENCES signal_classification_gold_set_versions(id) ON DELETE RESTRICT,
  canonical_root_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  split text NOT NULL CHECK(split IN ('train','validation','test')),
  expected_disposition text NOT NULL CHECK(expected_disposition IN ('approved','abstained')),
  expected_taxonomy_term_id uuid REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
  slice_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  labeled_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  item_digest text NOT NULL CHECK(item_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,gold_set_version_id)
    REFERENCES signal_classification_gold_set_versions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,canonical_root_id)
    REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT signal_classification_gold_expected_shape CHECK (
    (expected_disposition='approved' AND expected_taxonomy_term_id IS NOT NULL)
    OR (expected_disposition='abstained' AND expected_taxonomy_term_id IS NULL)
  ),
  CONSTRAINT signal_classification_gold_slice_keys CHECK (
    signal_classification_slice_keys_are_valid_v1(slice_keys)
  ),
  UNIQUE(gold_set_version_id,canonical_root_id)
);

CREATE TABLE IF NOT EXISTS signal_classification_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  taxonomy_profile_id uuid NOT NULL REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
  gold_set_version_id uuid REFERENCES signal_classification_gold_set_versions(id) ON DELETE RESTRICT,
  evaluated_model_version_id uuid REFERENCES tagging_model_versions(id) ON DELETE RESTRICT,
  evaluated_labeling_function_version_id uuid REFERENCES signal_labeling_function_versions(id) ON DELETE RESTRICT,
  split text CHECK(split IN ('validation','test')),
  denominator integer NOT NULL CHECK(denominator>=0),
  resolved integer NOT NULL CHECK(resolved>=0),
  approved integer NOT NULL CHECK(approved>=0),
  pending integer NOT NULL CHECK(pending>=0),
  rejected integer NOT NULL CHECK(rejected>=0),
  abstained integer NOT NULL CHECK(abstained>=0),
  error integer NOT NULL CHECK(error>=0),
  coverage numeric,
  precision_score numeric,
  recall_score numeric,
  f1_score numeric,
  input_digest text NOT NULL CHECK(input_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact_digest text NOT NULL CHECK(artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_digest text NOT NULL CHECK(policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_classification_evaluation_target CHECK (
    (evaluated_model_version_id IS NOT NULL)::int
      + (evaluated_labeling_function_version_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT signal_classification_evaluation_reconciliation CHECK (
    denominator=approved+pending+rejected+abstained+error
    AND resolved=approved+pending+rejected+abstained
  ),
  CONSTRAINT signal_classification_evaluation_metrics CHECK (
    (denominator=0 AND coverage IS NULL)
    OR (denominator>0 AND coverage=resolved::numeric/denominator::numeric)
  ),
  CONSTRAINT signal_classification_evaluation_gold_metrics CHECK (
    (gold_set_version_id IS NULL AND split IS NULL AND precision_score IS NULL AND recall_score IS NULL AND f1_score IS NULL)
    OR (gold_set_version_id IS NOT NULL AND split IS NOT NULL
      AND (precision_score IS NULL OR precision_score BETWEEN 0 AND 1)
      AND (recall_score IS NULL OR recall_score BETWEEN 0 AND 1)
      AND (f1_score IS NULL OR f1_score BETWEEN 0 AND 1))
  )
);

CREATE TABLE IF NOT EXISTS signal_classification_evaluation_slices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES signal_classification_evaluations(id) ON DELETE RESTRICT,
  slice_key text NOT NULL,
  split text NOT NULL CHECK(split IN ('validation','test')),
  denominator integer NOT NULL CHECK(denominator>=0),
  resolved integer NOT NULL CHECK(resolved>=0 AND resolved<=denominator),
  precision_score numeric,
  recall_score numeric,
  f1_score numeric,
  slice_digest text NOT NULL CHECK(slice_digest ~ '^sha256:[0-9a-f]{64}$'),
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  UNIQUE(evaluation_id,slice_key,split)
);

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_tagging_model_event_evaluation_fk') THEN
    ALTER TABLE signal_tagging_model_version_events
      ADD CONSTRAINT signal_tagging_model_event_evaluation_fk
      FOREIGN KEY(evaluation_id) REFERENCES signal_classification_evaluations(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_signal_classification_gold_item_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_taxonomy uuid; DECLARE term_taxonomy uuid;
BEGIN
  SELECT profile.taxonomy_id INTO profile_taxonomy
  FROM signal_classification_gold_set_versions gold
  JOIN signal_taxonomy_profiles profile ON profile.id=gold.taxonomy_profile_id
  WHERE gold.id=NEW.gold_set_version_id AND gold.workspace_id=NEW.workspace_id
    AND gold.status='draft';
  SELECT taxonomy_id INTO term_taxonomy FROM taxonomy_terms WHERE id=NEW.expected_taxonomy_term_id AND status='active';
  IF EXISTS(
    SELECT 1
    FROM signal_classification_gold_items prior_item
    JOIN signal_classification_gold_set_versions prior_gold
      ON prior_gold.id=prior_item.gold_set_version_id
    JOIN signal_classification_gold_set_versions next_gold
      ON next_gold.id=NEW.gold_set_version_id
    WHERE prior_gold.workspace_id=NEW.workspace_id
      AND prior_gold.taxonomy_profile_id=next_gold.taxonomy_profile_id
      AND prior_gold.gold_set_key=next_gold.gold_set_key
      AND prior_item.canonical_root_id=NEW.canonical_root_id
      AND prior_item.split<>NEW.split) THEN
    RAISE EXCEPTION 'Gold-set split leakage is forbidden.' USING ERRCODE='23514';
  END IF;
  IF profile_taxonomy IS NULL
     OR NOT EXISTS(SELECT 1 FROM mentions mention WHERE mention.id=NEW.canonical_root_id
       AND mention.workspace_id=NEW.workspace_id AND mention.canonical_mention_id=mention.id)
     OR (NEW.expected_taxonomy_term_id IS NOT NULL AND term_taxonomy IS DISTINCT FROM profile_taxonomy)
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.labeled_by_user_id) THEN
    RAISE EXCEPTION 'Gold-set item authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_classification_gold_item_v1 ON signal_classification_gold_items;
CREATE TRIGGER validate_signal_classification_gold_item_v1 BEFORE INSERT
  ON signal_classification_gold_items FOR EACH ROW EXECUTE FUNCTION validate_signal_classification_gold_item_v1();

CREATE OR REPLACE FUNCTION validate_signal_classification_evaluation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE comparable_count integer; DECLARE true_positive integer;
DECLARE false_positive integer; DECLARE false_negative integer;
DECLARE expected_precision numeric; DECLARE expected_recall numeric; DECLARE expected_f1 numeric;
BEGIN
  SELECT * INTO generation FROM signal_classification_generations
    WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id
      AND taxonomy_profile_id=NEW.taxonomy_profile_id AND status='ready';
  IF generation.id IS NULL
     OR NEW.denominator<>generation.denominator
     OR NOT EXISTS(SELECT 1 FROM signal_classification_coverage_v1(generation.id) coverage
       WHERE coverage.denominator=NEW.denominator AND coverage.resolved=NEW.resolved
         AND coverage.approved=NEW.approved AND coverage.pending=NEW.pending
         AND coverage.rejected=NEW.rejected AND coverage.abstained=NEW.abstained
         AND coverage.error=NEW.error)
     OR (NEW.gold_set_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM signal_classification_gold_set_versions gold
       WHERE gold.id=NEW.gold_set_version_id AND gold.workspace_id=NEW.workspace_id
         AND gold.taxonomy_profile_id=NEW.taxonomy_profile_id AND gold.status='ready'))
     OR (NEW.evaluated_model_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM tagging_model_versions model
       WHERE model.id=NEW.evaluated_model_version_id
         AND model.registry_contract_version='signal-tagging-model-registry-v1'
         AND model.taxonomy_profile_id=NEW.taxonomy_profile_id))
     OR (NEW.evaluated_labeling_function_version_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM signal_labeling_function_versions lf
       WHERE lf.id=NEW.evaluated_labeling_function_version_id
         AND (lf.owner_kind='platform' OR lf.workspace_id=NEW.workspace_id)
         AND (lf.taxonomy_profile_id IS NULL OR lf.taxonomy_profile_id=NEW.taxonomy_profile_id)))
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
     OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
       WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
         AND operation.operation_kind='evaluate-classifier' AND operation.status='in_progress'
         AND operation.actor_user_id=NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'Classification evaluation authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.gold_set_version_id IS NOT NULL THEN
    WITH comparable AS (
      SELECT gold.expected_disposition,gold.expected_taxonomy_term_id,
        assignment.disposition AS actual_disposition,
        assignment.taxonomy_term_id AS actual_taxonomy_term_id
      FROM signal_classification_gold_items gold
      LEFT JOIN signal_classification_generation_items item
        ON item.generation_id=NEW.generation_id
       AND item.canonical_root_id=gold.canonical_root_id
      LEFT JOIN signal_classification_assignments assignment
        ON assignment.generation_item_id=item.id
       AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments child
         WHERE child.supersedes_assignment_id=assignment.id)
      WHERE gold.gold_set_version_id=NEW.gold_set_version_id AND gold.split=NEW.split
    )
    SELECT count(*)::int,
      count(*) FILTER(WHERE expected_disposition='approved'
        AND actual_disposition='approved'
        AND actual_taxonomy_term_id=expected_taxonomy_term_id)::int,
      count(*) FILTER(WHERE actual_disposition='approved' AND NOT (
        expected_disposition='approved' AND actual_taxonomy_term_id=expected_taxonomy_term_id))::int,
      count(*) FILTER(WHERE expected_disposition='approved' AND NOT (
        actual_disposition='approved' AND actual_taxonomy_term_id=expected_taxonomy_term_id))::int
    INTO comparable_count,true_positive,false_positive,false_negative FROM comparable;
    IF comparable_count=0 THEN
      expected_precision:=NULL; expected_recall:=NULL; expected_f1:=NULL;
    ELSE
      expected_precision:=CASE WHEN true_positive+false_positive=0 THEN NULL
        ELSE true_positive::numeric/(true_positive+false_positive)::numeric END;
      expected_recall:=CASE WHEN true_positive+false_negative=0 THEN NULL
        ELSE true_positive::numeric/(true_positive+false_negative)::numeric END;
      expected_f1:=CASE WHEN expected_precision IS NULL OR expected_recall IS NULL
          OR expected_precision+expected_recall=0 THEN NULL
        ELSE 2*expected_precision*expected_recall/(expected_precision+expected_recall) END;
    END IF;
    IF NEW.precision_score IS DISTINCT FROM expected_precision
       OR NEW.recall_score IS DISTINCT FROM expected_recall
       OR NEW.f1_score IS DISTINCT FROM expected_f1 THEN
      RAISE EXCEPTION 'Classification evaluation gold metrics are not reproducible.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_classification_evaluation_v1 ON signal_classification_evaluations;
CREATE TRIGGER validate_signal_classification_evaluation_v1 BEFORE INSERT
  ON signal_classification_evaluations FOR EACH ROW EXECUTE FUNCTION validate_signal_classification_evaluation_v1();

CREATE OR REPLACE FUNCTION signal_classification_evaluation_slice_metrics_v1(
  target_evaluation_id uuid,target_slice_key text
)
RETURNS TABLE(denominator integer,resolved integer,precision_score numeric,
  recall_score numeric,f1_score numeric,slice_digest text)
LANGUAGE sql STABLE AS $$
  WITH selected AS (
    SELECT evaluation.* FROM signal_classification_evaluations evaluation
    WHERE evaluation.id=target_evaluation_id
  ), comparable AS (
    SELECT gold.canonical_root_id,gold.item_digest,gold.expected_disposition,
      gold.expected_taxonomy_term_id,assignment.disposition AS actual_disposition,
      assignment.taxonomy_term_id AS actual_taxonomy_term_id,
      assignment.lineage_digest
    FROM selected evaluation
    JOIN signal_classification_gold_items gold
      ON gold.gold_set_version_id=evaluation.gold_set_version_id
     AND gold.split=evaluation.split AND target_slice_key=ANY(gold.slice_keys)
    LEFT JOIN signal_classification_generation_items item
      ON item.generation_id=evaluation.generation_id
     AND item.canonical_root_id=gold.canonical_root_id
    LEFT JOIN signal_classification_assignments assignment
      ON assignment.generation_item_id=item.id
     AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments child
       WHERE child.supersedes_assignment_id=assignment.id)
  ), counted AS (
    SELECT count(*)::int AS denominator,
      count(*) FILTER(WHERE actual_disposition IS NOT NULL)::int AS resolved,
      count(*) FILTER(WHERE expected_disposition='approved'
        AND actual_disposition='approved'
        AND actual_taxonomy_term_id=expected_taxonomy_term_id)::int AS true_positive,
      count(*) FILTER(WHERE actual_disposition='approved' AND NOT (
        expected_disposition='approved' AND actual_taxonomy_term_id=expected_taxonomy_term_id))::int AS false_positive,
      count(*) FILTER(WHERE expected_disposition='approved' AND NOT (
        actual_disposition='approved' AND actual_taxonomy_term_id=expected_taxonomy_term_id))::int AS false_negative,
      'sha256:'||encode(digest(convert_to(COALESCE(string_agg(
        canonical_root_id::text||':'||item_digest||':'||COALESCE(actual_disposition,'missing')||':'||
        COALESCE(actual_taxonomy_term_id::text,'')||':'||COALESCE(lineage_digest,''),''
        ORDER BY canonical_root_id),'empty'),'UTF8'),'sha256'),'hex') AS slice_digest
    FROM comparable
  ), ratios AS (
    SELECT counted.*,
      CASE WHEN true_positive+false_positive=0 THEN NULL
        ELSE true_positive::numeric/(true_positive+false_positive)::numeric END AS precision_score,
      CASE WHEN true_positive+false_negative=0 THEN NULL
        ELSE true_positive::numeric/(true_positive+false_negative)::numeric END AS recall_score
    FROM counted
  )
  SELECT denominator,resolved,precision_score,recall_score,
    CASE WHEN precision_score IS NULL OR recall_score IS NULL OR precision_score+recall_score=0
      THEN NULL ELSE 2*precision_score*recall_score/(precision_score+recall_score) END,
    slice_digest FROM ratios;
$$;

CREATE OR REPLACE FUNCTION validate_signal_classification_evaluation_slice_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected record;
BEGIN
  SELECT * INTO expected FROM signal_classification_evaluation_slice_metrics_v1(
    NEW.evaluation_id,NEW.slice_key);
  IF NOT EXISTS(SELECT 1 FROM signal_classification_evaluations evaluation
      JOIN signal_classification_operations operation ON operation.id=NEW.operation_id
      WHERE evaluation.id=NEW.evaluation_id AND evaluation.split=NEW.split
        AND operation.workspace_id=evaluation.workspace_id
        AND operation.operation_kind='evaluate-classifier-slice'
        AND operation.status='in_progress')
     OR expected.denominator=0
     OR NEW.denominator IS DISTINCT FROM expected.denominator
     OR NEW.resolved IS DISTINCT FROM expected.resolved
     OR NEW.precision_score IS DISTINCT FROM expected.precision_score
     OR NEW.recall_score IS DISTINCT FROM expected.recall_score
     OR NEW.f1_score IS DISTINCT FROM expected.f1_score
     OR NEW.slice_digest IS DISTINCT FROM expected.slice_digest THEN
    RAISE EXCEPTION 'Classification evaluation slice is not reproducible.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_signal_classification_evaluation_slice_v1
  ON signal_classification_evaluation_slices;
CREATE TRIGGER validate_signal_classification_evaluation_slice_v1 BEFORE INSERT
  ON signal_classification_evaluation_slices FOR EACH ROW
  EXECUTE FUNCTION validate_signal_classification_evaluation_slice_v1();

CREATE OR REPLACE FUNCTION protect_signal_classification_gold_set_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_count integer; DECLARE actual_digest text;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Classification gold sets are append-only.' USING ERRCODE='55000';
  END IF;
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.taxonomy_profile_id IS DISTINCT FROM NEW.taxonomy_profile_id
     OR OLD.gold_set_key IS DISTINCT FROM NEW.gold_set_key OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.definition_digest IS DISTINCT FROM NEW.definition_digest
     OR OLD.expected_item_count IS DISTINCT FROM NEW.expected_item_count
     OR OLD.supersedes_id IS DISTINCT FROM NEW.supersedes_id
     OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
     OR OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id
     OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
     OR OLD.effective_to IS DISTINCT FROM NEW.effective_to
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.status<>'draft' OR NEW.status<>'ready' THEN
    RAISE EXCEPTION 'Classification gold-set mutation is forbidden.' USING ERRCODE='55000';
  END IF;
  SELECT count(*)::int,
    'sha256:'||encode(digest(convert_to(COALESCE(string_agg(item_digest,''
      ORDER BY canonical_root_id),'empty'),'UTF8'),'sha256'),'hex')
  INTO actual_count,actual_digest FROM signal_classification_gold_items
  WHERE gold_set_version_id=OLD.id;
  IF actual_count<>NEW.expected_item_count OR NEW.finalized_digest<>actual_digest
     OR NEW.finalized_at IS NULL THEN
    RAISE EXCEPTION 'Classification gold-set finalization does not reconcile.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS protect_signal_classification_gold_sets_v1 ON signal_classification_gold_set_versions;
CREATE TRIGGER protect_signal_classification_gold_sets_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_gold_set_versions FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_gold_set_v1();
DROP TRIGGER IF EXISTS protect_signal_classification_gold_items_v1 ON signal_classification_gold_items;
CREATE TRIGGER protect_signal_classification_gold_items_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_gold_items FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();
DROP TRIGGER IF EXISTS protect_signal_classification_evaluations_v1 ON signal_classification_evaluations;
CREATE TRIGGER protect_signal_classification_evaluations_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_evaluations FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();
DROP TRIGGER IF EXISTS protect_signal_classification_evaluation_slices_v1 ON signal_classification_evaluation_slices;
CREATE TRIGGER protect_signal_classification_evaluation_slices_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_evaluation_slices FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();

CREATE OR REPLACE FUNCTION register_signal_classification_gold_set_v1(
  target_workspace_id uuid,target_taxonomy_profile_id uuid,target_gold_set_key text,
  target_version integer,target_definition_digest text,target_effective_from timestamptz,
  target_effective_to timestamptz,target_supersedes_id uuid,target_items jsonb,
  target_actor_user_id uuid,target_idempotency_key text,target_request_digest text
)
RETURNS TABLE(gold_set_version_id uuid,finalized_digest text,item_count integer,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':gold-set:'||target_gold_set_key,0));
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(target_items)<>'array' THEN
    RAISE EXCEPTION 'Classification gold-set registration authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'register-gold-set',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.operation_kind<>'register-gold-set'
     OR operation.request_digest<>target_request_digest OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    gold_set_version_id:=(operation.result->>'gold_set_version_id')::uuid;
    finalized_digest:=operation.result->>'finalized_digest';
    item_count:=(operation.result->>'item_count')::integer;
    created:=false; RETURN NEXT; RETURN;
  END IF;
  item_count:=jsonb_array_length(target_items);
  INSERT INTO signal_classification_gold_set_versions(workspace_id,taxonomy_profile_id,
    gold_set_key,version,definition_digest,status,expected_item_count,supersedes_id,
    operation_id,created_by_user_id,effective_from,effective_to)
  VALUES(target_workspace_id,target_taxonomy_profile_id,target_gold_set_key,target_version,
    target_definition_digest,'draft',item_count,target_supersedes_id,operation.id,
    target_actor_user_id,target_effective_from,target_effective_to)
  RETURNING id INTO gold_set_version_id;
  INSERT INTO signal_classification_gold_items(workspace_id,gold_set_version_id,
    canonical_root_id,split,expected_disposition,expected_taxonomy_term_id,slice_keys,evidence_digest,
    labeled_by_user_id,item_digest)
  SELECT target_workspace_id,gold_set_version_id,item.canonical_root_id,item.split,
    item.expected_disposition,item.expected_taxonomy_term_id,COALESCE(item.slice_keys,ARRAY[]::text[]),
    item.evidence_digest,target_actor_user_id,
    'sha256:'||encode(digest(convert_to(item.canonical_root_id::text||':'||item.split||':'||
      item.expected_disposition||':'||COALESCE(item.expected_taxonomy_term_id::text,'')||':'||
      item.evidence_digest||':'||array_to_string(ARRAY(SELECT value FROM unnest(
        COALESCE(item.slice_keys,ARRAY[]::text[])) value ORDER BY value),','),'UTF8'),'sha256'),'hex')
  FROM jsonb_to_recordset(target_items) AS item(
    canonical_root_id uuid,split text,expected_disposition text,
    expected_taxonomy_term_id uuid,slice_keys text[],evidence_digest text,item_digest text);
  SELECT 'sha256:'||encode(digest(convert_to(COALESCE(string_agg(gold.item_digest,''
    ORDER BY gold.canonical_root_id),'empty'),'UTF8'),'sha256'),'hex')
  INTO finalized_digest FROM signal_classification_gold_items gold
  WHERE gold.gold_set_version_id=register_signal_classification_gold_set_v1.gold_set_version_id;
  UPDATE signal_classification_gold_set_versions SET status='ready',
    finalized_digest=register_signal_classification_gold_set_v1.finalized_digest,
    finalized_at=now() WHERE id=register_signal_classification_gold_set_v1.gold_set_version_id;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'gold-set-registered','gold-set',gold_set_version_id,
    (SELECT prior.finalized_digest FROM signal_classification_gold_set_versions prior
      WHERE prior.id=target_supersedes_id),
    finalized_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||finalized_digest,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('gold_set_version_id',gold_set_version_id,
      'finalized_digest',finalized_digest,'item_count',item_count)
  WHERE id=operation.id;
  created:=true; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION record_signal_classification_evaluation_v1(
  target_workspace_id uuid,target_taxonomy_profile_id uuid,target_generation_id uuid,
  target_gold_set_version_id uuid,target_evaluated_model_version_id uuid,
  target_evaluated_labeling_function_version_id uuid,target_split text,
  target_denominator integer,target_resolved integer,target_approved integer,
  target_pending integer,target_rejected integer,target_abstained integer,target_error integer,
  target_coverage numeric,target_precision numeric,target_recall numeric,target_f1 numeric,
  target_input_digest text,target_artifact_digest text,target_policy_digest text,
  target_actor_user_id uuid,target_idempotency_key text,target_request_digest text
)
RETURNS TABLE(evaluation_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':classification-evaluation:'||target_generation_id::text,0));
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Classification evaluation authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'evaluate-classifier',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.operation_kind<>'evaluate-classifier'
     OR operation.request_digest<>target_request_digest OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    evaluation_id:=(operation.result->>'evaluation_id')::uuid; created:=false; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO signal_classification_evaluations(workspace_id,taxonomy_profile_id,generation_id,
    gold_set_version_id,evaluated_model_version_id,evaluated_labeling_function_version_id,
    split,denominator,resolved,approved,pending,rejected,abstained,error,coverage,
    precision_score,recall_score,f1_score,input_digest,artifact_digest,policy_digest,
    operation_id,created_by_user_id)
  VALUES(target_workspace_id,target_taxonomy_profile_id,target_generation_id,
    target_gold_set_version_id,target_evaluated_model_version_id,
    target_evaluated_labeling_function_version_id,target_split,target_denominator,
    target_resolved,target_approved,target_pending,target_rejected,target_abstained,target_error,
    target_coverage,target_precision,target_recall,target_f1,target_input_digest,
    target_artifact_digest,target_policy_digest,operation.id,target_actor_user_id)
  RETURNING id INTO evaluation_id;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'evaluation-recorded','evaluation',evaluation_id,
    NULL,target_input_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||target_input_digest,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('evaluation_id',evaluation_id)
  WHERE id=operation.id;
  created:=true; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION record_signal_classification_evaluation_slice_v1(
  target_workspace_id uuid,target_evaluation_id uuid,target_slice_key text,
  target_actor_user_id uuid,target_idempotency_key text,target_request_digest text
)
RETURNS TABLE(evaluation_slice_id uuid,denominator integer,resolved integer,
  precision_score numeric,recall_score numeric,f1_score numeric,slice_digest text,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE; DECLARE evaluation signal_classification_evaluations%ROWTYPE;
DECLARE expected record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':classification-slice:'||
    target_evaluation_id::text||':'||target_slice_key,0));
  SELECT * INTO evaluation FROM signal_classification_evaluations
    WHERE id=target_evaluation_id AND workspace_id=target_workspace_id;
  IF evaluation.id IS NULL OR target_slice_key !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Classification evaluation slice authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'evaluate-classifier-slice',
    target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.operation_kind<>'evaluate-classifier-slice'
     OR operation.request_digest<>target_request_digest OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    evaluation_slice_id:=(operation.result->>'evaluation_slice_id')::uuid;
    denominator:=(operation.result->>'denominator')::integer;
    resolved:=(operation.result->>'resolved')::integer;
    precision_score:=(operation.result->>'precision_score')::numeric;
    recall_score:=(operation.result->>'recall_score')::numeric;
    f1_score:=(operation.result->>'f1_score')::numeric;
    slice_digest:=operation.result->>'slice_digest'; created:=false; RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO expected FROM signal_classification_evaluation_slice_metrics_v1(
    target_evaluation_id,target_slice_key);
  IF expected.denominator=0 THEN
    RAISE EXCEPTION 'Classification evaluation slice is empty.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_evaluation_slices(evaluation_id,slice_key,split,
    denominator,resolved,precision_score,recall_score,f1_score,slice_digest,operation_id)
  VALUES(target_evaluation_id,target_slice_key,evaluation.split,expected.denominator,
    expected.resolved,expected.precision_score,expected.recall_score,expected.f1_score,
    expected.slice_digest,operation.id)
  RETURNING id INTO evaluation_slice_id;
  denominator:=expected.denominator; resolved:=expected.resolved;
  precision_score:=expected.precision_score; recall_score:=expected.recall_score;
  f1_score:=expected.f1_score; slice_digest:=expected.slice_digest;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'evaluation-slice-recorded','evaluation-slice',
    evaluation_slice_id,NULL,slice_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||slice_digest,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('evaluation_slice_id',evaluation_slice_id,'denominator',denominator,
      'resolved',resolved,'precision_score',precision_score,'recall_score',recall_score,
      'f1_score',f1_score,'slice_digest',slice_digest)
  WHERE id=operation.id;
  created:=true; RETURN NEXT;
END; $$;

-- ---------------------------------------------------------------------------
-- Temporary temporal projector into record_tags (bridge expires 2026-10-15).
-- Only projector-owned rows are governed here; legacy and T&B history are untouched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION signal_classification_generation_is_current_v1(
  target_generation_id uuid,
  authority_at timestamptz DEFAULT now()
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1
    FROM signal_classification_generations generation
    JOIN signal_workspaces workspace ON workspace.id=generation.workspace_id
      AND workspace.status='active'
    JOIN signal_taxonomy_profiles profile ON profile.id=generation.taxonomy_profile_id
      AND profile.workspace_id=generation.workspace_id AND profile.status='active'
    JOIN taxonomies taxonomy ON taxonomy.id=profile.taxonomy_id AND taxonomy.status='active'
    WHERE generation.id=target_generation_id AND generation.status='ready'
      AND NOT EXISTS(SELECT 1 FROM signal_classification_generations child
        WHERE child.supersedes_generation_id=generation.id)
      AND generation.study_corpus_id IS NOT NULL
      AND generation.input_watermark_digest=signal_classification_watermark_digest_v1(
        generation.workspace_id,generation.study_corpus_id)
      AND NOT EXISTS(
        SELECT 1 FROM signal_classification_generation_items item
        JOIN mentions root ON root.id=item.canonical_root_id
        WHERE item.generation_id=generation.id
          AND (root.workspace_id<>generation.workspace_id OR root.canonical_mention_id<>root.id)
      )
      AND NOT EXISTS(
        SELECT 1
        FROM signal_classification_assignments assignment
        LEFT JOIN taxonomy_terms term ON term.id=assignment.taxonomy_term_id
        WHERE assignment.generation_id=generation.id
          AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments child
            WHERE child.supersedes_assignment_id=assignment.id)
          AND assignment.disposition<>'abstained'
          AND (term.id IS NULL OR term.status<>'active' OR term.taxonomy_id<>profile.taxonomy_id)
      )
      AND NOT EXISTS(
        SELECT 1
        FROM signal_classification_assignments assignment
        LEFT JOIN signal_classification_approval_policies policy
          ON policy.id=assignment.approval_policy_id
        LEFT JOIN signal_labeling_function_versions lf
          ON lf.id=assignment.labeling_function_version_id
        WHERE assignment.generation_id=generation.id
          AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments child
            WHERE child.supersedes_assignment_id=assignment.id)
          AND assignment.disposition='approved'
          AND assignment.resolution_method<>'human'
          AND (
            policy.id IS NULL OR policy.workspace_id<>generation.workspace_id
            OR policy.taxonomy_profile_id<>generation.taxonomy_profile_id
            OR policy.status<>'approved' OR policy.effective_from>authority_at
            OR (policy.effective_to IS NOT NULL AND policy.effective_to<=authority_at)
            OR policy.authority_kind<>assignment.resolution_method
            OR (assignment.resolution_method='labeling_function' AND (
              policy.labeling_function_version_id<>assignment.labeling_function_version_id
              OR lf.status<>'approved' OR lf.effective_from>authority_at
              OR (lf.effective_to IS NOT NULL AND lf.effective_to<=authority_at)))
            OR (assignment.resolution_method='model' AND (
              policy.model_version_id<>assignment.model_version_id
              OR (SELECT event.status FROM signal_tagging_model_version_events event
                WHERE event.workspace_id=generation.workspace_id
                  AND event.model_version_id=assignment.model_version_id
                  AND event.effective_at<=authority_at
                ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1
              ) IS DISTINCT FROM 'approved'))
          )
      )
  );
$$;

ALTER TABLE record_tags
  ADD COLUMN IF NOT EXISTS classification_assignment_id uuid REFERENCES signal_classification_assignments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS classification_generation_id uuid REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS classification_projection_contract text;

ALTER TABLE record_tags DROP CONSTRAINT IF EXISTS record_tags_classification_projection_shape;
ALTER TABLE record_tags ADD CONSTRAINT record_tags_classification_projection_shape CHECK (
  (classification_projection_contract IS NULL
    AND classification_assignment_id IS NULL AND classification_generation_id IS NULL)
  OR (classification_projection_contract='signal-record-tags-projector-v1'
    AND classification_assignment_id IS NOT NULL AND classification_generation_id IS NOT NULL
    AND source='signal-classification-projector-v1' AND review_status='approved'
    AND approval_source IN ('human','policy') AND approved_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_record_tags_classification_assignment
  ON record_tags(classification_assignment_id)
  WHERE classification_assignment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_classification_projection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_classification_operations(id) ON DELETE RESTRICT,
  projected_count integer NOT NULL CHECK(projected_count>=0),
  projection_digest text NOT NULL CHECK(projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  invalidation_digest text NOT NULL CHECK(invalidation_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,generation_id,projection_digest)
);

DROP TRIGGER IF EXISTS protect_signal_classification_projection_runs_v1 ON signal_classification_projection_runs;
CREATE TRIGGER protect_signal_classification_projection_runs_v1 BEFORE UPDATE OR DELETE
  ON signal_classification_projection_runs FOR EACH ROW EXECUTE FUNCTION protect_signal_classification_append_only_v1();

CREATE OR REPLACE FUNCTION validate_signal_classification_record_tag_projection_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment signal_classification_assignments%ROWTYPE;
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE profile signal_taxonomy_profiles%ROWTYPE;
DECLARE projector_operation signal_classification_operations%ROWTYPE;
DECLARE projector_operation_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.classification_projection_contract IS NULL THEN RETURN OLD; END IF;
    BEGIN
      projector_operation_id:=nullif(current_setting('noisia.classification_projector_operation',true),'')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      projector_operation_id:=NULL;
    END;
    SELECT * INTO projector_operation FROM signal_classification_operations
      WHERE id=projector_operation_id AND workspace_id=(
        SELECT workspace_id FROM signal_classification_generations
        WHERE id=OLD.classification_generation_id)
        AND operation_kind='project-generation' AND status='in_progress';
    IF projector_operation.id IS NULL THEN
      RAISE EXCEPTION 'Direct classification projection delete is forbidden.' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.classification_projection_contract IS NULL THEN
    IF NEW.signal_taxonomy_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'Signal taxonomy record_tags writes require the classification projector.' USING ERRCODE='55000';
    END IF;
    -- Study-first/T&B compatibility rows remain outside Signal taxonomy authority
    -- until their independent bridge retirement; they cannot claim a Signal profile.
    RETURN NEW;
  END IF;
  SELECT * INTO assignment FROM signal_classification_assignments WHERE id=NEW.classification_assignment_id;
  SELECT * INTO generation FROM signal_classification_generations WHERE id=NEW.classification_generation_id;
  SELECT * INTO profile FROM signal_taxonomy_profiles WHERE id=assignment.taxonomy_profile_id;
  BEGIN
    projector_operation_id:=nullif(current_setting('noisia.classification_projector_operation',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    projector_operation_id:=NULL;
  END;
  SELECT * INTO projector_operation FROM signal_classification_operations
    WHERE id=projector_operation_id AND workspace_id=generation.workspace_id
      AND operation_kind='project-generation' AND status='in_progress';
  IF projector_operation.id IS NULL THEN
    RAISE EXCEPTION 'Classification projection owner operation is missing.' USING ERRCODE='55000';
  END IF;
  IF assignment.id IS NULL OR assignment.disposition<>'approved'
     OR assignment.generation_id<>generation.id OR generation.status<>'ready'
     OR assignment.canonical_root_id<>NEW.subject_id OR assignment.taxonomy_term_id<>NEW.taxonomy_term_id
     OR assignment.taxonomy_profile_id<>NEW.signal_taxonomy_profile_id
     OR NEW.subject_type<>'mention' OR NEW.study_corpus_id IS DISTINCT FROM generation.study_corpus_id
     OR NEW.organization_id IS DISTINCT FROM (SELECT organization_id FROM signal_workspaces WHERE id=generation.workspace_id)
     OR NEW.brand_id IS DISTINCT FROM (SELECT brand_id FROM signal_workspaces WHERE id=generation.workspace_id)
     OR (assignment.resolution_method='human' AND NEW.approval_source<>'human')
     OR (assignment.resolution_method<>'human' AND NEW.approval_source<>'policy') THEN
    RAISE EXCEPTION 'Direct or incompatible classification projection write is forbidden.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_signal_classification_record_tag_projection_v1 ON record_tags;
CREATE TRIGGER validate_signal_classification_record_tag_projection_v1
  BEFORE INSERT OR DELETE OR UPDATE OF classification_assignment_id,classification_generation_id,
    classification_projection_contract,subject_id,taxonomy_term_id,review_status,approval_source
  ON record_tags FOR EACH ROW EXECUTE FUNCTION validate_signal_classification_record_tag_projection_v1();

DROP FUNCTION IF EXISTS project_signal_classification_generation_v1(uuid,uuid,uuid);
CREATE OR REPLACE FUNCTION project_signal_classification_generation_v1(
  target_workspace_id uuid,
  target_generation_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_digest text
)
RETURNS TABLE(projected_count integer,projection_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE workspace signal_workspaces%ROWTYPE;
DECLARE operation signal_classification_operations%ROWTYPE;
DECLARE watermark_id uuid;
DECLARE invalidation_digest_value text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':classification-projector',0));
  SELECT * INTO generation FROM signal_classification_generations
    WHERE id=target_generation_id AND workspace_id=target_workspace_id AND status='ready';
  SELECT * INTO workspace FROM signal_workspaces WHERE id=target_workspace_id;
  IF generation.id IS NULL OR workspace.id IS NULL
     OR NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$'
     OR NOT signal_classification_generation_is_current_v1(generation.id,now()) THEN
    RAISE EXCEPTION 'Classification projection authority is invalid or stale.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'project-generation',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  SELECT id INTO watermark_id FROM signal_data_watermarks
    WHERE workspace_id=target_workspace_id AND study_corpus_id=generation.study_corpus_id
    ORDER BY accepted_at DESC,id DESC LIMIT 1;
  IF operation.id IS NULL OR operation.workspace_id<>target_workspace_id
     OR operation.operation_kind<>'project-generation'
     OR operation.actor_user_id<>target_actor_user_id
     OR operation.request_digest<>target_request_digest
     OR generation.study_corpus_id IS NULL OR watermark_id IS NULL THEN
    RAISE EXCEPTION 'Classification projection authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF operation.status='completed' THEN
    projected_count:=(operation.result->>'projected_count')::integer;
    projection_digest:=operation.result->>'projection_digest';
    RETURN NEXT; RETURN;
  END IF;

  PERFORM set_config('noisia.classification_projector_operation',operation.id::text,true);

  DELETE FROM record_tags tag
  WHERE tag.classification_projection_contract='signal-record-tags-projector-v1'
    AND tag.signal_taxonomy_profile_id=generation.taxonomy_profile_id;

  INSERT INTO record_tags(id,organization_id,brand_id,study_corpus_id,subject_type,subject_id,
    taxonomy_term_id,value,score,confidence,evidence,source,model_version_id,
    signal_taxonomy_profile_id,review_status,approval_source,approval_policy_version,approved_at,
    classification_assignment_id,classification_generation_id,classification_projection_contract)
  SELECT assignment.id,workspace.organization_id,workspace.brand_id,generation.study_corpus_id,'mention',assignment.canonical_root_id,
    assignment.taxonomy_term_id,NULL,assignment.score,assignment.confidence,'[]'::jsonb,
    'signal-classification-projector-v1',profile.model_version_id,assignment.taxonomy_profile_id,
    'approved',CASE WHEN assignment.resolution_method='human' THEN 'human' ELSE 'policy' END,
    CASE WHEN assignment.resolution_method='human' THEN NULL ELSE policy.policy_key||'@'||policy.version::text END,
    assignment.created_at,assignment.id,generation.id,'signal-record-tags-projector-v1'
  FROM signal_classification_assignments assignment
  LEFT JOIN signal_classification_approval_policies policy ON policy.id=assignment.approval_policy_id
  JOIN signal_taxonomy_profiles profile ON profile.id=assignment.taxonomy_profile_id
  WHERE assignment.generation_id=generation.id AND assignment.disposition='approved'
    AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments child
      WHERE child.supersedes_assignment_id=assignment.id)
  ON CONFLICT (classification_assignment_id) WHERE classification_assignment_id IS NOT NULL DO NOTHING;

  SELECT count(*)::int,
    'sha256:'||encode(digest(convert_to(COALESCE(string_agg(
      classification_assignment_id::text||':'||taxonomy_term_id::text,'' ORDER BY classification_assignment_id),'empty'),
      'UTF8'),'sha256'),'hex')
    INTO projected_count,projection_digest
  FROM record_tags WHERE classification_generation_id=generation.id
    AND classification_projection_contract='signal-record-tags-projector-v1';

  invalidation_digest_value:='sha256:'||encode(digest(convert_to(
    target_workspace_id::text||':'||generation.id::text||':'||projection_digest||':classification-projection',
    'UTF8'),'sha256'),'hex');

  INSERT INTO signal_data_invalidations(workspace_id,study_corpus_id,data_watermark_id,
    source_key,idempotency_key,reason,scope)
  VALUES(target_workspace_id,generation.study_corpus_id,watermark_id,
    'signal-classification-projector-v1',invalidation_digest_value,
    'classification_projection_rebuilt',jsonb_build_object(
      'contract_version','signal-record-tags-projector-v1',
      'generation_key',generation.generation_key,
      'generation_version',generation.generation_version,
      'definition_digest',generation.definition_digest,
      'projection_digest',projection_digest))
  ON CONFLICT(idempotency_key) DO NOTHING;

  INSERT INTO signal_classification_projection_runs(workspace_id,generation_id,operation_id,
    projected_count,projection_digest,invalidation_digest)
  VALUES(target_workspace_id,generation.id,operation.id,projected_count,projection_digest,
    invalidation_digest_value)
  ON CONFLICT DO NOTHING;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'projection-rebuilt','generation',generation.id,
    generation.finalized_digest,projection_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||projection_digest,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('generation_id',generation.id,'projected_count',projected_count,
      'projection_digest',projection_digest,'invalidation_digest',invalidation_digest_value)
  WHERE id=operation.id;
  RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION signal_classification_coverage_v1(target_generation_id uuid)
RETURNS TABLE(
  availability text,denominator integer,resolved integer,approved integer,pending integer,
  rejected integer,abstained integer,error integer,coverage numeric,limitations text[]
)
LANGUAGE sql STABLE AS $$
  WITH selected AS (
    SELECT generation.*,
      signal_classification_generation_is_current_v1(generation.id,now()) AS authority_current
    FROM signal_classification_generations generation
    WHERE generation.id=target_generation_id
  )
  SELECT CASE WHEN COALESCE(generation.authority_current,false) THEN 'available' ELSE 'not_available' END,
    CASE WHEN generation.authority_current THEN generation.denominator END,
    CASE WHEN generation.authority_current THEN count(item.id) FILTER(WHERE item.resolution_state<>'error')::int END,
    CASE WHEN generation.authority_current THEN count(item.id) FILTER(WHERE item.resolution_state='approved')::int END,
    CASE WHEN generation.authority_current THEN count(item.id) FILTER(WHERE item.resolution_state='pending')::int END,
    CASE WHEN generation.authority_current THEN count(item.id) FILTER(WHERE item.resolution_state='rejected')::int END,
    CASE WHEN generation.authority_current THEN count(item.id) FILTER(WHERE item.resolution_state='abstained')::int END,
    CASE WHEN generation.authority_current THEN count(item.id) FILTER(WHERE item.resolution_state='error')::int END,
    CASE WHEN NOT COALESCE(generation.authority_current,false) OR generation.denominator=0 THEN NULL
      ELSE count(item.id) FILTER(WHERE item.resolution_state<>'error')::numeric/generation.denominator::numeric END,
    CASE WHEN generation.id IS NULL THEN ARRAY['generation_not_found']::text[]
      WHEN NOT generation.authority_current THEN ARRAY['generation_authority_stale']::text[]
      ELSE ARRAY[]::text[] END
  FROM (SELECT 1) anchor
  LEFT JOIN selected generation ON true
  LEFT JOIN signal_classification_generation_items item ON item.generation_id=generation.id
  GROUP BY generation.id,generation.authority_current,generation.denominator;
$$;

CREATE OR REPLACE FUNCTION begin_signal_classification_generation_v1(
  target_workspace_id uuid,
  target_taxonomy_profile_id uuid,
  target_generation_key text,
  target_generation_version integer,
  target_study_corpus_id uuid,
  target_population_digest text,
  target_watermark_digest text,
  target_identity_catalog_digest text,
  target_denominator integer,
  target_definition_digest text,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_digest text,
  target_supersedes_generation_id uuid DEFAULT NULL
)
RETURNS TABLE(generation_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
DECLARE generation signal_classification_generations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':classification-generation:'||target_generation_key,0));
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$'
     OR NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile
       WHERE profile.id=target_taxonomy_profile_id AND profile.workspace_id=target_workspace_id
         AND profile.status='active')
     OR target_study_corpus_id IS NULL
     OR NOT EXISTS(
       SELECT 1 FROM signal_workspace_corpora membership
       WHERE membership.workspace_id=target_workspace_id
         AND membership.study_corpus_id=target_study_corpus_id AND membership.valid_to IS NULL)
     OR target_watermark_digest IS DISTINCT FROM
       signal_classification_watermark_digest_v1(target_workspace_id,target_study_corpus_id)
     OR (target_supersedes_generation_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM signal_classification_generations prior
       WHERE prior.id=target_supersedes_generation_id AND prior.workspace_id=target_workspace_id
         AND prior.taxonomy_profile_id=target_taxonomy_profile_id AND prior.status='ready'
         AND prior.generation_key=target_generation_key
         AND target_generation_version=prior.generation_version+1
         AND prior.study_corpus_id=target_study_corpus_id)) THEN
    RAISE EXCEPTION 'Classification generation authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'create-generation',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.request_digest<>target_request_digest OR operation.operation_kind<>'create-generation'
     OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    generation_id:=(operation.result->>'generation_id')::uuid; created:=false; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO signal_classification_generations(workspace_id,taxonomy_profile_id,generation_key,
    generation_version,study_corpus_id,input_population_digest,input_watermark_digest,
    identity_catalog_digest,denominator,operation_id,created_by_user_id,
    supersedes_generation_id,definition_digest)
  VALUES(target_workspace_id,target_taxonomy_profile_id,target_generation_key,
    target_generation_version,target_study_corpus_id,target_population_digest,target_watermark_digest,
    target_identity_catalog_digest,target_denominator,operation.id,target_actor_user_id,
    target_supersedes_generation_id,target_definition_digest)
  RETURNING * INTO generation;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'generation-created','generation',generation.id,
    NULL,generation.definition_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||generation.definition_digest,'UTF8'),'sha256'),'hex'));
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('generation_id',generation.id)
  WHERE id=operation.id;
  generation_id:=generation.id; created:=true; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION append_signal_classification_result_v1(
  target_workspace_id uuid,
  target_generation_id uuid,
  target_canonical_root_id uuid,
  target_resolution_state text,
  target_resolution_method text,
  target_taxonomy_term_id uuid,
  target_labeling_function_version_id uuid,
  target_model_version_id uuid,
  target_approval_policy_id uuid,
  target_score numeric,
  target_confidence text,
  target_evidence_digest text,
  target_lineage_digest text,
  target_item_digest text,
  target_technical_error_code text,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_digest text,
  target_supersedes_assignment_id uuid DEFAULT NULL
)
RETURNS TABLE(generation_item_id uuid,assignment_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE resolved_root_id uuid;
BEGIN
  SELECT canonical_mention_id INTO resolved_root_id FROM mentions
    WHERE id=target_canonical_root_id AND workspace_id=target_workspace_id;
  IF resolved_root_id IS NULL THEN
    RAISE EXCEPTION 'Classification root is outside workspace.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_generation_id::text||':'||resolved_root_id::text,0));
  SELECT * INTO generation FROM signal_classification_generations
    WHERE id=target_generation_id AND workspace_id=target_workspace_id AND status='open';
  IF generation.id IS NULL OR NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Classification result authority is invalid.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_classification_operations(workspace_id,actor_user_id,operation_kind,
    idempotency_key,request_digest)
  VALUES(target_workspace_id,target_actor_user_id,'append-results',target_idempotency_key,target_request_digest)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  SELECT * INTO operation FROM signal_classification_operations
    WHERE workspace_id=target_workspace_id AND idempotency_key=target_idempotency_key FOR UPDATE;
  IF operation.request_digest<>target_request_digest OR operation.operation_kind<>'append-results'
     OR operation.actor_user_id<>target_actor_user_id THEN
    RAISE EXCEPTION 'Classification idempotency key was reused with incompatible input.' USING ERRCODE='40001';
  END IF;
  IF operation.status='completed' THEN
    generation_item_id:=(operation.result->>'generation_item_id')::uuid;
    assignment_id:=NULLIF(operation.result->>'assignment_id','')::uuid;
    created:=false; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO signal_classification_generation_items(workspace_id,generation_id,canonical_root_id,
    resolution_state,technical_error_code,item_digest)
  VALUES(target_workspace_id,target_generation_id,resolved_root_id,target_resolution_state,
    target_technical_error_code,target_item_digest)
  RETURNING id INTO generation_item_id;
  IF target_resolution_state<>'error' THEN
    INSERT INTO signal_classification_assignments(workspace_id,generation_id,generation_item_id,
      canonical_root_id,taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,
      labeling_function_version_id,model_version_id,approval_policy_id,decided_by_user_id,
      score,confidence,evidence_digest,lineage_digest,supersedes_assignment_id,operation_id)
    VALUES(target_workspace_id,target_generation_id,generation_item_id,resolved_root_id,
      generation.taxonomy_profile_id,target_taxonomy_term_id,target_resolution_method,target_resolution_state,
      target_labeling_function_version_id,target_model_version_id,target_approval_policy_id,
      CASE WHEN target_resolution_method='human' THEN target_actor_user_id END,
      target_score,target_confidence,target_evidence_digest,target_lineage_digest,
      target_supersedes_assignment_id,operation.id)
    RETURNING id INTO assignment_id;
  END IF;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'results-appended','generation-item',generation_item_id,
    NULL,target_item_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':0:'||target_item_digest,'UTF8'),'sha256'),'hex'));
  IF assignment_id IS NOT NULL THEN
    INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
      object_type,object_id,previous_state_digest,next_state_digest,event_digest)
    VALUES(target_workspace_id,operation.id,1,
      CASE WHEN target_supersedes_assignment_id IS NULL THEN 'results-appended'
        ELSE 'assignment-superseded' END,
      'assignment',assignment_id,
      (SELECT prior.lineage_digest FROM signal_classification_assignments prior
        WHERE prior.id=target_supersedes_assignment_id),
      target_lineage_digest,
      'sha256:'||encode(digest(convert_to(operation.id::text||':1:'||target_lineage_digest,'UTF8'),'sha256'),'hex'));
  END IF;
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('generation_item_id',generation_item_id,'assignment_id',assignment_id)
  WHERE id=operation.id;
  created:=true; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION finalize_signal_classification_generation_v1(
  target_workspace_id uuid,
  target_generation_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_digest text
)
RETURNS TABLE(generation_id uuid,finalized_digest text,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE expected_digest text; DECLARE actual_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_generation_id::text||':finalize',0));
  SELECT * INTO generation FROM signal_classification_generations
    WHERE id=target_generation_id AND workspace_id=target_workspace_id FOR UPDATE;
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

COMMENT ON TABLE signal_classification_generations IS
  'Immutable workspace classification population identity. Denominator includes abstentions and technical errors.';
COMMENT ON TABLE signal_classification_assignments IS
  'Append-only semantic assignment ledger. Method and disposition are separate; score is evidence only.';
COMMENT ON COLUMN record_tags.classification_projection_contract IS
  'Temporary 10B bridge owned only by project_signal_classification_generation_v1; target removal 2026-10-15 in Gate 10H.';

-- The retired full-pop job cannot be created or reactivated by old code, flags,
-- recovery, or a manually injected durable run. Existing history stays readable.
CREATE OR REPLACE FUNCTION enforce_signal_taxonomy_enrichment_retired_10b_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.run_type='taxonomy_enrichment' AND NEW.status IN ('queued','running','partial') THEN
    RAISE EXCEPTION 'signal_taxonomy_enrichment_retired_10b' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_signal_taxonomy_enrichment_retired_10b_v1 ON signal_refresh_runs;
CREATE TRIGGER enforce_signal_taxonomy_enrichment_retired_10b_v1
  BEFORE INSERT OR UPDATE OF run_type,status ON signal_refresh_runs
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_taxonomy_enrichment_retired_10b_v1();
