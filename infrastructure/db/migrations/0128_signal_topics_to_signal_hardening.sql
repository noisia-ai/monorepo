-- Hardens the Topics -> Signal UAT cut after the initial 0127 installation.
-- Forward-only: no existing result or serving generation is deleted or rewritten.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE signal_topic_classification_suggestions
  ADD COLUMN IF NOT EXISTS negative_semantic_score numeric,
  ADD COLUMN IF NOT EXISTS excluded_by_negative boolean NOT NULL DEFAULT false;

ALTER TABLE signal_topic_catalog_executions
  ADD COLUMN IF NOT EXISTS embedding_cost_estimate_micro_usd bigint
    CHECK(embedding_cost_estimate_micro_usd IS NULL OR embedding_cost_estimate_micro_usd>=0),
  ADD COLUMN IF NOT EXISTS embedding_cost_cap_micro_usd bigint
    CHECK(embedding_cost_cap_micro_usd IS NULL OR embedding_cost_cap_micro_usd>0),
  ADD COLUMN IF NOT EXISTS embedding_pricing_version text;

ALTER TABLE signal_topic_catalog_operations
  ADD COLUMN IF NOT EXISTS result_summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(result_summary)='object');

CREATE TABLE IF NOT EXISTS signal_topic_classification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL UNIQUE REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  worker_job_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','dispatching','dispatched','completed','failed','dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,execution_id),
  FOREIGN KEY(workspace_id,execution_id)
    REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE RESTRICT,
  CHECK((status='dispatching' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status<>'dispatching' AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK((status='completed' AND completed_at IS NOT NULL)
    OR (status<>'completed' AND completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_signal_topic_classification_outbox_recovery
  ON signal_topic_classification_outbox(status,available_at,lease_expires_at,created_at);

CREATE TABLE IF NOT EXISTS signal_topic_embedding_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK(provider IN ('voyage','openai')),
  embedding_model text NOT NULL,
  pricing_version text NOT NULL,
  request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
  input_digests text[] NOT NULL,
  input_count integer NOT NULL CHECK(input_count>0),
  input_characters integer NOT NULL CHECK(input_characters>0),
  reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),
  settled_micro_usd bigint CHECK(settled_micro_usd IS NULL OR settled_micro_usd>=0),
  status text NOT NULL CHECK(status IN ('reserved','sent_unknown','completed','failed')),
  error_code text,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id),
  UNIQUE(workspace_id,request_digest),
  FOREIGN KEY(workspace_id,execution_id)
    REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE RESTRICT,
  CHECK(
    cardinality(input_digests)=input_count AND array_position(input_digests,NULL) IS NULL
  ),
  CHECK(
    (status IN ('reserved','sent_unknown') AND settled_micro_usd IS NULL AND completed_at IS NULL)
    OR (status='completed' AND settled_micro_usd IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status='failed' AND settled_micro_usd IS NOT NULL AND completed_at IS NOT NULL
      AND NULLIF(btrim(error_code),'') IS NOT NULL)
  )
);

COMMENT ON TABLE signal_topic_embedding_calls IS
  'Durable one-call budget and outcome ledger for definition embeddings. sent_unknown is fail-closed and is never retried automatically.';
COMMENT ON COLUMN signal_topic_embedding_calls.settled_micro_usd IS
  'Conservative settled upper bound when the embedding provider does not return billable usage.';

CREATE OR REPLACE FUNCTION signal_topic_membership_override_digest_v1(
  target_workspace_id uuid,
  target_profile_id uuid
)
RETURNS text
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT 'sha256:'||encode(extensions.digest(convert_to(COALESCE(string_agg(
    concat_ws('|',override.term_key,override.canonical_root_id::text,override.disposition,
      override.definition_revision::text),E'\n'
    ORDER BY override.term_key,override.canonical_root_id,override.definition_revision),''),'UTF8'),'sha256'),'hex')
  FROM signal_taxonomy_profiles profile
  JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
  JOIN signal_topic_membership_overrides override
    ON override.workspace_id=profile.workspace_id AND override.term_key=term.term_key
    AND override.definition_revision=(term.metadata->'topic'->>'definition_revision')::int
  WHERE profile.id=target_profile_id AND profile.workspace_id=target_workspace_id
    AND profile.kind='topic';
$$;

CREATE OR REPLACE FUNCTION complete_signal_topic_catalog_profile_v1(
  target_execution_id uuid,
  target_current_population_digest text,
  target_current_identity_catalog_digest text,
  target_current_definition_digest text,
  target_current_denominator integer
)
RETURNS signal_taxonomy_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
DECLARE source signal_topic_catalog_executions%ROWTYPE;
DECLARE profile signal_taxonomy_profiles%ROWTYPE;
DECLARE activated signal_taxonomy_profiles%ROWTYPE;
DECLARE correction_digest text;
BEGIN
  SELECT * INTO execution FROM signal_topic_catalog_executions
    WHERE id=target_execution_id AND intent='publish' AND status='running' FOR UPDATE;
  IF execution.id IS NULL THEN
    RAISE EXCEPTION 'Topic publication execution is not running.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(execution.workspace_id::text||':topic-catalog-publish',0));
  SELECT * INTO source FROM signal_topic_catalog_executions
    WHERE id=execution.source_execution_id AND workspace_id=execution.workspace_id
      AND taxonomy_profile_id=execution.taxonomy_profile_id AND intent='search' AND status='ready'
    FOR SHARE;
  correction_digest:=signal_topic_membership_override_digest_v1(
    execution.workspace_id,execution.taxonomy_profile_id);
  IF source.id IS NULL
     OR target_current_population_digest IS DISTINCT FROM execution.population_digest
     OR target_current_identity_catalog_digest IS DISTINCT FROM execution.identity_catalog_digest
     OR target_current_definition_digest IS DISTINCT FROM execution.definition_digest
     OR target_current_denominator IS DISTINCT FROM execution.denominator
     OR source.study_corpus_id IS DISTINCT FROM execution.study_corpus_id
     OR source.population_digest IS DISTINCT FROM execution.population_digest
     OR source.watermark_digest IS DISTINCT FROM execution.watermark_digest
     OR source.identity_catalog_digest IS DISTINCT FROM execution.identity_catalog_digest
     OR source.definition_digest IS DISTINCT FROM execution.definition_digest
     OR source.denominator IS DISTINCT FROM execution.denominator
     OR source.result_summary->>'correction_digest' IS DISTINCT FROM correction_digest
     OR source.denominator<>(SELECT count(*) FROM signal_topic_classification_items item
       WHERE item.execution_id=source.id)
     OR EXISTS(SELECT 1 FROM signal_topic_classification_items item
       WHERE item.execution_id=source.id AND item.resolution_state='error')
     OR source.watermark_digest IS DISTINCT FROM
       signal_classification_watermark_digest_v1(source.workspace_id,source.study_corpus_id)
     OR NOT signal_data_governance_actor_is_valid(execution.workspace_id,execution.actor_user_id) THEN
    RAISE EXCEPTION 'Topic publication source is incomplete, stale, or unauthorized.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO profile FROM signal_taxonomy_profiles
    WHERE id=execution.taxonomy_profile_id AND workspace_id=execution.workspace_id
      AND kind='topic' AND status IN('activating','active') FOR UPDATE;
  IF profile.id IS NULL THEN
    RAISE EXCEPTION 'Topic catalog is not ready for atomic activation.' USING ERRCODE='23514';
  END IF;
  IF profile.status='activating' THEN
    UPDATE signal_taxonomy_profiles candidate SET status='retired',updated_at=now()
      WHERE candidate.workspace_id=execution.workspace_id AND candidate.kind='topic'
        AND candidate.status='active' AND candidate.id<>execution.taxonomy_profile_id;
    UPDATE taxonomies taxonomy SET status='retired'
      WHERE taxonomy.id IN(SELECT candidate.taxonomy_id FROM signal_taxonomy_profiles candidate
        WHERE candidate.workspace_id=execution.workspace_id AND candidate.kind='topic'
          AND candidate.status='retired' AND candidate.id<>execution.taxonomy_profile_id);
  END IF;
  UPDATE taxonomies taxonomy SET status='active' WHERE taxonomy.id=profile.taxonomy_id;
  UPDATE taxonomy_terms term SET status='active'
    WHERE term.taxonomy_id=profile.taxonomy_id AND term.status='candidate';
  UPDATE signal_taxonomy_profiles SET status='active',updated_at=now()
    WHERE id=execution.taxonomy_profile_id RETURNING * INTO activated;
  RETURN activated;
END; $$;

CREATE OR REPLACE FUNCTION complete_signal_topic_catalog_profile_v1(
  target_execution_id uuid
)
RETURNS signal_taxonomy_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Topic publication requires a freshly recomputed population and definition snapshot.'
    USING ERRCODE='23514';
END; $$;

REVOKE ALL ON FUNCTION signal_topic_membership_override_digest_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_signal_topic_catalog_profile_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_signal_topic_catalog_profile_v1(uuid,text,text,text,integer) FROM PUBLIC;
