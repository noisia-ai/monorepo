-- Topics -> Signal UAT cut.
-- Adds durable pre-publication search evidence and an atomic bridge into the
-- existing 0087 classification authority. No historical data is reinterpreted.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS signal_topic_catalog_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('create','adopt','update','archive','restore')),
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
  result_profile_id uuid NOT NULL REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  result_term_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS signal_topic_catalog_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  taxonomy_profile_id uuid NOT NULL REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  intent text NOT NULL CHECK(intent IN ('search','publish')),
  source_execution_id uuid REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','ready','completed','failed')),
  progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  population_digest text NOT NULL CHECK(population_digest ~ '^sha256:[0-9a-f]{64}$'),
  watermark_digest text NOT NULL CHECK(watermark_digest ~ '^sha256:[0-9a-f]{64}$'),
  identity_catalog_digest text NOT NULL CHECK(identity_catalog_digest ~ '^sha256:[0-9a-f]{64}$'),
  definition_digest text NOT NULL CHECK(definition_digest ~ '^sha256:[0-9a-f]{64}$'),
  denominator integer NOT NULL CHECK(denominator >= 0),
  embedding_model text,
  generation_id uuid REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  publish_when_ready boolean NOT NULL DEFAULT false,
  error_code text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,idempotency_key),
  UNIQUE(workspace_id,id),
  CONSTRAINT signal_topic_catalog_execution_source CHECK (
    (intent='search' AND source_execution_id IS NULL)
    OR (intent='publish' AND source_execution_id IS NOT NULL)
  ),
  CONSTRAINT signal_topic_catalog_execution_chained_publish CHECK (
    NOT publish_when_ready OR intent='search'
  ),
  CONSTRAINT signal_topic_catalog_execution_error CHECK (
    (status='failed' AND NULLIF(btrim(error_code),'') IS NOT NULL)
    OR (status<>'failed' AND error_code IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_topic_catalog_execution_active_profile
  ON signal_topic_catalog_executions(taxonomy_profile_id,intent)
  WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_signal_topic_catalog_execution_workspace
  ON signal_topic_catalog_executions(workspace_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS signal_topic_classification_items (
  execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  canonical_root_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  resolution_state text NOT NULL
    CHECK(resolution_state IN ('relevant','doubt','excluded','not_relevant','error')),
  best_score numeric,
  technical_error_code text,
  item_digest text NOT NULL CHECK(item_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(execution_id,canonical_root_id),
  FOREIGN KEY(workspace_id,execution_id)
    REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,canonical_root_id)
    REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_classification_item_error CHECK (
    (resolution_state='error' AND NULLIF(btrim(technical_error_code),'') IS NOT NULL)
    OR (resolution_state<>'error' AND technical_error_code IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_topic_classification_items_state
  ON signal_topic_classification_items(execution_id,resolution_state,best_score DESC,canonical_root_id);

CREATE TABLE IF NOT EXISTS signal_topic_classification_suggestions (
  execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  canonical_root_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  taxonomy_term_id uuid NOT NULL REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
  term_key text NOT NULL,
  disposition text NOT NULL CHECK(disposition IN ('relevant','doubt','excluded','none')),
  method text NOT NULL CHECK(method IN ('semantic','lexical','semantic_lexical','human')),
  semantic_score numeric,
  lexical_match boolean NOT NULL DEFAULT false,
  excluded_by_rule boolean NOT NULL DEFAULT false,
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  lineage_digest text NOT NULL CHECK(lineage_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(execution_id,canonical_root_id,taxonomy_term_id),
  FOREIGN KEY(workspace_id,execution_id)
    REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,canonical_root_id)
    REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_signal_topic_classification_suggestions_topic
  ON signal_topic_classification_suggestions(execution_id,term_key,disposition,semantic_score DESC,canonical_root_id);

CREATE TABLE IF NOT EXISTS signal_topic_membership_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  term_key text NOT NULL,
  canonical_root_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  disposition text NOT NULL CHECK(disposition IN ('belongs','excluded')),
  definition_revision integer NOT NULL CHECK(definition_revision >= 1),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,term_key,canonical_root_id),
  FOREIGN KEY(workspace_id,canonical_root_id)
    REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS signal_topic_membership_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
  term_key text NOT NULL,
  canonical_root_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  disposition text NOT NULL CHECK(disposition IN ('belongs','excluded')),
  definition_revision integer NOT NULL CHECK(definition_revision >= 1),
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,idempotency_key),
  FOREIGN KEY(workspace_id,canonical_root_id)
    REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_signal_topic_membership_overrides_topic
  ON signal_topic_membership_overrides(workspace_id,term_key,updated_at DESC,canonical_root_id);

CREATE TABLE IF NOT EXISTS signal_topic_definition_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  definition_digest text NOT NULL CHECK(definition_digest ~ '^sha256:[0-9a-f]{64}$'),
  embedding_model text NOT NULL,
  provider text NOT NULL CHECK(provider IN ('voyage','openai')),
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,definition_digest,embedding_model)
);

COMMENT ON TABLE signal_topic_catalog_executions IS
  'Durable pre-publication search and publish jobs for the operator Topics flow. 0087 remains the serving assignment authority.';
COMMENT ON TABLE signal_topic_classification_suggestions IS
  'Version-bound search evidence. Relevant/doubt is not approval authority and is never projected directly to Signal.';
COMMENT ON TABLE signal_topic_membership_overrides IS
  'Latest explicit operator membership correction by stable workspace term key.';

CREATE OR REPLACE FUNCTION prepare_signal_topic_catalog_profile_v1(
  target_profile_id uuid,
  reviewer_user_id uuid
)
RETURNS signal_taxonomy_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prepared signal_taxonomy_profiles%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_profile_id::text,0));
  IF reviewer_user_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM signal_taxonomy_profiles profile
    WHERE profile.id=target_profile_id AND profile.kind='topic' AND profile.status='draft'
      AND signal_data_governance_actor_is_valid(profile.workspace_id,reviewer_user_id)
  ) THEN
    RAISE EXCEPTION 'Only an authorized draft Topics catalog can be prepared.' USING ERRCODE='23514';
  END IF;
  UPDATE taxonomies taxonomy SET status='active'
    FROM signal_taxonomy_profiles profile
    WHERE profile.id=target_profile_id AND taxonomy.id=profile.taxonomy_id;
  UPDATE taxonomy_terms term SET status='active'
    FROM signal_taxonomy_profiles profile
    WHERE profile.id=target_profile_id AND term.taxonomy_id=profile.taxonomy_id
      AND term.status='candidate';
  UPDATE signal_taxonomy_profiles SET status='activating',approved_by_user_id=reviewer_user_id,
    approved_at=now(),updated_at=now()
    WHERE id=target_profile_id AND status='draft' RETURNING * INTO prepared;
  RETURN prepared;
END; $$;

CREATE OR REPLACE FUNCTION complete_signal_topic_catalog_profile_v1(
  target_execution_id uuid
)
RETURNS signal_taxonomy_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
DECLARE source signal_topic_catalog_executions%ROWTYPE;
DECLARE activated signal_taxonomy_profiles%ROWTYPE;
BEGIN
  SELECT * INTO execution FROM signal_topic_catalog_executions
    WHERE id=target_execution_id AND intent='publish' AND status='running' FOR UPDATE;
  IF execution.id IS NULL THEN
    RAISE EXCEPTION 'Topic publication execution is not running.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO source FROM signal_topic_catalog_executions
    WHERE id=execution.source_execution_id AND workspace_id=execution.workspace_id
      AND taxonomy_profile_id=execution.taxonomy_profile_id AND intent='search' AND status='ready';
  IF source.id IS NULL
     OR source.denominator<>(SELECT count(*) FROM signal_topic_classification_items item
       WHERE item.execution_id=source.id)
     OR EXISTS(SELECT 1 FROM signal_topic_classification_items item
       WHERE item.execution_id=source.id AND item.resolution_state='error')
     OR source.watermark_digest IS DISTINCT FROM
       signal_classification_watermark_digest_v1(source.workspace_id,source.study_corpus_id)
     OR NOT signal_data_governance_actor_is_valid(execution.workspace_id,execution.actor_user_id) THEN
    RAISE EXCEPTION 'Topic publication source is incomplete, stale, or unauthorized.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(execution.workspace_id::text||':topic-catalog-publish',0));
  IF NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile
      WHERE profile.id=execution.taxonomy_profile_id AND profile.workspace_id=execution.workspace_id
        AND profile.kind='topic' AND profile.status='activating') THEN
    RAISE EXCEPTION 'Topic catalog is not ready for atomic activation.' USING ERRCODE='23514';
  END IF;
  UPDATE signal_taxonomy_profiles profile SET status='retired',updated_at=now()
    WHERE profile.workspace_id=execution.workspace_id AND profile.kind='topic'
      AND profile.status='active' AND profile.id<>execution.taxonomy_profile_id;
  UPDATE taxonomies taxonomy SET status='retired'
    WHERE taxonomy.id IN(SELECT profile.taxonomy_id FROM signal_taxonomy_profiles profile
      WHERE profile.workspace_id=execution.workspace_id AND profile.kind='topic'
        AND profile.status='retired' AND profile.id<>execution.taxonomy_profile_id);
  UPDATE taxonomies taxonomy SET status='active'
    WHERE taxonomy.id=(SELECT profile.taxonomy_id FROM signal_taxonomy_profiles profile
      WHERE profile.id=execution.taxonomy_profile_id);
  UPDATE taxonomy_terms term SET status='active'
    WHERE term.taxonomy_id=(SELECT profile.taxonomy_id FROM signal_taxonomy_profiles profile
      WHERE profile.id=execution.taxonomy_profile_id) AND term.status='candidate';
  UPDATE signal_taxonomy_profiles SET status='active',updated_at=now()
    WHERE id=execution.taxonomy_profile_id RETURNING * INTO activated;
  RETURN activated;
END; $$;

CREATE OR REPLACE FUNCTION append_signal_classification_result_batch_v1(
  target_workspace_id uuid,
  target_generation_id uuid,
  target_canonical_root_id uuid,
  target_assignments jsonb,
  target_item_digest text,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_digest text
)
RETURNS TABLE(generation_item_id uuid,assignment_ids jsonb,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE operation signal_classification_operations%ROWTYPE;
DECLARE generation signal_classification_generations%ROWTYPE;
DECLARE resolved_root_id uuid;
DECLARE assignment_count integer;
BEGIN
  SELECT canonical_mention_id INTO resolved_root_id FROM mentions
    WHERE id=target_canonical_root_id AND workspace_id=target_workspace_id;
  IF resolved_root_id IS NULL OR jsonb_typeof(target_assignments)<>'array'
     OR target_item_digest !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_array_length(target_assignments)>128 THEN
    RAISE EXCEPTION 'Classification batch result shape is invalid.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_generation_id::text||':'||resolved_root_id::text,0));
  SELECT * INTO generation FROM signal_classification_generations
    WHERE id=target_generation_id AND workspace_id=target_workspace_id AND status='open';
  IF generation.id IS NULL OR NOT signal_data_governance_actor_is_valid(target_workspace_id,target_actor_user_id)
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Classification batch result authority is invalid.' USING ERRCODE='23514';
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
    assignment_ids:=operation.result->'assignment_ids';created:=false;RETURN NEXT;RETURN;
  END IF;
  assignment_count:=jsonb_array_length(target_assignments);
  INSERT INTO signal_classification_generation_items(workspace_id,generation_id,canonical_root_id,
    resolution_state,technical_error_code,item_digest)
  VALUES(target_workspace_id,target_generation_id,resolved_root_id,
    CASE WHEN assignment_count>0 THEN 'approved' ELSE 'abstained' END,NULL,target_item_digest)
  RETURNING id INTO generation_item_id;
  IF assignment_count>0 THEN
    WITH parsed AS(
      SELECT * FROM jsonb_to_recordset(target_assignments) AS item(
        taxonomy_term_id uuid,resolution_method text,labeling_function_version_id uuid,
        model_version_id uuid,approval_policy_id uuid,score numeric,confidence text,
        evidence_digest text,lineage_digest text)
    ), inserted AS(
      INSERT INTO signal_classification_assignments(workspace_id,generation_id,generation_item_id,
        canonical_root_id,taxonomy_profile_id,taxonomy_term_id,resolution_method,disposition,
        labeling_function_version_id,model_version_id,approval_policy_id,decided_by_user_id,
        score,confidence,evidence_digest,lineage_digest,operation_id)
      SELECT target_workspace_id,target_generation_id,generation_item_id,resolved_root_id,
        generation.taxonomy_profile_id,parsed.taxonomy_term_id,parsed.resolution_method,'approved',
        parsed.labeling_function_version_id,parsed.model_version_id,parsed.approval_policy_id,
        CASE WHEN parsed.resolution_method='human' THEN target_actor_user_id END,
        parsed.score,parsed.confidence,parsed.evidence_digest,parsed.lineage_digest,operation.id
      FROM parsed
      RETURNING id
    ) SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO assignment_ids FROM inserted;
  ELSE assignment_ids:='[]'::jsonb;
  END IF;
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  VALUES(target_workspace_id,operation.id,0,'results-appended','generation-item',generation_item_id,
    NULL,target_item_digest,'sha256:'||encode(digest(convert_to(
      operation.id::text||':0:'||target_item_digest,'UTF8'),'sha256'),'hex'));
  INSERT INTO signal_classification_events(workspace_id,operation_id,event_index,event_kind,
    object_type,object_id,previous_state_digest,next_state_digest,event_digest)
  SELECT target_workspace_id,operation.id,row_number() OVER(ORDER BY assignment.id)::int,
    'results-appended','assignment',assignment.id,NULL,assignment.lineage_digest,
    'sha256:'||encode(digest(convert_to(operation.id::text||':'||
      row_number() OVER(ORDER BY assignment.id)::text||':'||assignment.lineage_digest,'UTF8'),'sha256'),'hex')
  FROM signal_classification_assignments assignment
  WHERE assignment.operation_id=operation.id;
  UPDATE signal_classification_operations SET status='completed',completed_at=now(),
    result=jsonb_build_object('generation_item_id',generation_item_id,'assignment_ids',assignment_ids)
  WHERE id=operation.id;
  created:=true;RETURN NEXT;
END; $$;

REVOKE ALL ON FUNCTION prepare_signal_topic_catalog_profile_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_signal_topic_catalog_profile_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_signal_classification_result_batch_v1(
  uuid,uuid,uuid,jsonb,text,uuid,text,text
) FROM PUBLIC;
