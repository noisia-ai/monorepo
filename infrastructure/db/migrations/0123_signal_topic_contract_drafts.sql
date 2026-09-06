-- Candidate-bound preparation only: no catalog, classifier authority, assignment or serving writes.
-- Requires product 0112/0115, not historical-result imports or local Lab migrations.
CREATE TABLE signal_topic_contract_draft_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_snapshots(id) ON DELETE RESTRICT,
  base_revision_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_candidate_revisions(id) ON DELETE RESTRICT,
  editorial_revision_id uuid REFERENCES signal_topic_evaluation_v2_candidate_editorial_revisions(id) ON DELETE RESTRICT,
  source_revision integer NOT NULL CHECK(source_revision>=1),
  source_version_digest text NOT NULL CHECK(source_version_digest~'^sha256:[0-9a-f]{64}$'),
  source_state_token text NOT NULL CHECK(source_state_token~'^sha256:[0-9a-f]{64}$'),
  revision integer NOT NULL CHECK(revision>=1),
  predecessor_id uuid REFERENCES signal_topic_contract_draft_versions(id) ON DELETE RESTRICT,
  predecessor_digest text,
  rule_spec jsonb NOT NULL,
  spec_digest text NOT NULL CHECK(spec_digest~'^sha256:[0-9a-f]{64}$'),
  draft_digest text NOT NULL CHECK(draft_digest~'^sha256:[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
  request jsonb NOT NULL,
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(candidate_id,run_id,workspace_id)
    REFERENCES signal_topic_evaluation_v2_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT uq_topic_rule_draft_key UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_topic_rule_draft_revision UNIQUE(candidate_id,revision),
  CONSTRAINT uq_topic_rule_draft_workspace UNIQUE(id,workspace_id),
  CHECK((revision=1 AND predecessor_id IS NULL AND predecessor_digest IS NULL)
    OR (revision>1 AND predecessor_id IS NOT NULL AND predecessor_digest~'^sha256:[0-9a-f]{64}$')),
  CHECK(COALESCE((jsonb_typeof(rule_spec)='object' AND pg_column_size(rule_spec)<=32768
    AND rule_spec->>'contract_version'='signal-topic-rule-spec-v1' AND rule_spec->>'kind'='topic'
    AND rule_spec-(ARRAY['contract_version','kind','label','definition','lexical','filters'])='{}'::jsonb
    AND jsonb_typeof(rule_spec->'label')='string' AND jsonb_typeof(rule_spec->'definition')='string'
    AND char_length(btrim(rule_spec->>'label')) BETWEEN 1 AND 160
    AND char_length(rule_spec->>'definition') BETWEEN 1 AND 1500
    AND jsonb_typeof(rule_spec->'lexical')='object' AND jsonb_typeof(rule_spec->'filters')='object'),false)),
  CHECK(jsonb_typeof(request)='object' AND pg_column_size(request)<=49152)
);

CREATE TABLE signal_topic_contract_draft_trial_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  draft_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
  request jsonb NOT NULL,
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  result_digest text NOT NULL CHECK(result_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(draft_id,workspace_id) REFERENCES signal_topic_contract_draft_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT uq_topic_rule_trial_key UNIQUE(workspace_id,idempotency_key),
  CHECK(jsonb_typeof(request)='object' AND pg_column_size(request)<=4096),
  CHECK(jsonb_typeof(result)='object' AND pg_column_size(result)<=32768)
);

CREATE FUNCTION protect_signal_topic_contract_draft_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Topic contract drafts and trials are append-only.'; END;
$$;
CREATE TRIGGER protect_signal_topic_contract_draft_versions BEFORE UPDATE OR DELETE
  ON signal_topic_contract_draft_versions FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_contract_draft_v1();
CREATE TRIGGER protect_signal_topic_contract_draft_trial_receipts BEFORE UPDATE OR DELETE
  ON signal_topic_contract_draft_trial_receipts FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_contract_draft_v1();

CREATE FUNCTION validate_signal_topic_contract_draft_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source record; prior signal_topic_contract_draft_versions%ROWTYPE; expected jsonb;
DECLARE item jsonb; list_name text; count_terms integer:=0;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft actor is outside workspace authority.';
  END IF;
  PERFORM 1 FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id FOR UPDATE;
  SELECT base.id base_id,editorial.id editorial_id,COALESCE(editorial.revision,1) revision,
    COALESCE(editorial.version_digest,base.payload_digest) version_digest,
    COALESCE(editorial.review_state,'pending') review_state,run.run_key,candidate.candidate_key
    INTO source FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id AND run.workspace_id=candidate.workspace_id
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id AND snapshot.workspace_id=run.workspace_id
    JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
    LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions
      WHERE candidate_id=candidate.id ORDER BY revision DESC LIMIT 1) editorial ON true
    WHERE candidate.id=NEW.candidate_id AND candidate.run_id=NEW.run_id AND candidate.workspace_id=NEW.workspace_id
      AND run.snapshot_id=NEW.snapshot_id AND run.status='completed' AND snapshot.state='frozen'
      AND candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving;
  IF source IS NULL OR source.review_state<>'pending' OR source.base_id<>NEW.base_revision_id
    OR source.editorial_id IS DISTINCT FROM NEW.editorial_revision_id OR source.revision<>NEW.source_revision
    OR source.version_digest<>NEW.source_version_digest
    OR NEW.source_state_token<>signal_topic_evaluation_v2_candidate_state_token_v1(
      NEW.candidate_id,NEW.source_revision,NEW.source_version_digest) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft candidate source is stale or outside scope.';
  END IF;
  SELECT * INTO prior FROM signal_topic_contract_draft_versions WHERE candidate_id=NEW.candidate_id ORDER BY revision DESC LIMIT 1;
  IF NEW.revision<>COALESCE(prior.revision,0)+1 OR NEW.predecessor_id IS DISTINCT FROM prior.id
    OR NEW.predecessor_digest IS DISTINCT FROM prior.draft_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft predecessor is stale.';
  END IF;
  IF (NEW.rule_spec->'lexical')-(ARRAY['any','all','not'])<>'{}'::jsonb
    OR (NEW.rule_spec->'filters')-(ARRAY['languages','markets','scopes'])<>'{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic Rule Spec contains unknown fields.';
  END IF;
  FOREACH list_name IN ARRAY ARRAY['any','all','not'] LOOP
    IF jsonb_typeof(NEW.rule_spec->'lexical'->list_name) IS DISTINCT FROM 'array'
      OR jsonb_array_length(NEW.rule_spec->'lexical'->list_name)>16 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic lexical list is invalid.';
    END IF;
    count_terms:=count_terms+jsonb_array_length(NEW.rule_spec->'lexical'->list_name);
    FOR item IN SELECT value FROM jsonb_array_elements(NEW.rule_spec->'lexical'->list_name) LOOP
      IF jsonb_typeof(item)<>'string' OR char_length(item#>>'{}') NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic lexical literal is invalid.';
      END IF;
    END LOOP;
  END LOOP;
  IF count_terms>32 OR jsonb_array_length(NEW.rule_spec->'lexical'->'any')+jsonb_array_length(NEW.rule_spec->'lexical'->'all')=0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic Rule Spec needs a positive lexical clause.';
  END IF;
  FOREACH list_name IN ARRAY ARRAY['languages','markets','scopes'] LOOP
    IF jsonb_typeof(NEW.rule_spec->'filters'->list_name) IS DISTINCT FROM 'array'
      OR jsonb_array_length(NEW.rule_spec->'filters'->list_name)>16 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic filter list is invalid.';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(NEW.rule_spec->'filters'->list_name) LOOP
      IF jsonb_typeof(item)<>'string' OR (list_name='languages' AND (item#>>'{}')!~'^[a-z]{2}$')
        OR (list_name='markets' AND (item#>>'{}')!~'^[A-Z]{2}$')
        OR (list_name='scopes' AND (item#>>'{}') NOT IN('primary_brand','same_entity','competitor','category','other')) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic filter value is invalid.';
      END IF;
    END LOOP;
  END LOOP;
  expected:=jsonb_build_object('workspace_id',NEW.workspace_id::text,'run_id',NEW.run_id::text,
    'candidate_id',NEW.candidate_id::text,'snapshot_id',NEW.snapshot_id::text,'source_revision',NEW.source_revision,
    'source_version_digest',NEW.source_version_digest,'revision',NEW.revision,
    'predecessor_digest',NEW.predecessor_digest,'spec_digest',NEW.spec_digest);
  IF NEW.spec_digest<>signal_semantic_context_digest_json_v2(NEW.rule_spec)
    OR NEW.draft_digest<>signal_semantic_context_digest_json_v2(expected)
    OR NEW.request_digest<>signal_semantic_context_digest_json_v2(NEW.request)
    OR NEW.request IS DISTINCT FROM jsonb_build_object('run_key',source.run_key,'candidate_key',source.candidate_key,
      'expected_candidate_revision',NEW.source_revision,'expected_candidate_state_token',NEW.source_state_token,
      'expected_draft_revision',NEW.revision-1,'expected_draft_digest',NEW.predecessor_digest,'rule_spec',NEW.rule_spec) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft content or request digest is invalid.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_signal_topic_contract_draft_versions BEFORE INSERT
  ON signal_topic_contract_draft_versions FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_contract_draft_v1();

CREATE FUNCTION validate_signal_topic_contract_draft_trial_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE draft signal_topic_contract_draft_versions%ROWTYPE; counts jsonb; total_members integer; considered integer;
DECLARE source record; item jsonb;
BEGIN
  SELECT * INTO draft FROM signal_topic_contract_draft_versions WHERE id=NEW.draft_id AND workspace_id=NEW.workspace_id;
  IF draft.id IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
    OR NEW.request_digest<>signal_semantic_context_digest_json_v2(NEW.request)
    OR NEW.result_digest<>signal_semantic_context_digest_json_v2(NEW.result)
    OR NEW.result->>'draft_digest' IS DISTINCT FROM draft.draft_digest
    OR NEW.result->>'spec_digest' IS DISTINCT FROM draft.spec_digest
    OR (NEW.result->>'draft_revision')::integer IS DISTINCT FROM draft.revision
    OR NEW.result->>'contract_version' IS DISTINCT FROM 'signal-topic-contract-draft-trial-v1'
    OR NEW.result->>'population_kind' IS DISTINCT FROM 'frozen_snapshot_memberships'
    OR NEW.result->'topic_adoption' IS DISTINCT FROM 'false'::jsonb
    OR NEW.result->'publication' IS DISTINCT FROM 'false'::jsonb
    OR NEW.result->'serving' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft trial receipt authority or digest is invalid.';
  END IF;
  PERFORM 1 FROM signal_topic_evaluation_v2_candidates WHERE id=draft.candidate_id FOR UPDATE;
  SELECT COALESCE(editorial.revision,1) revision,COALESCE(editorial.version_digest,base.payload_digest) version_digest,
    COALESCE(editorial.review_state,'pending') review_state INTO source
    FROM signal_topic_evaluation_v2_candidate_revisions base
    LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions
      WHERE candidate_id=draft.candidate_id ORDER BY revision DESC LIMIT 1) editorial ON true
    WHERE base.id=draft.base_revision_id AND base.candidate_id=draft.candidate_id AND base.revision=1;
  IF source IS NULL OR source.revision<>draft.source_revision OR source.version_digest<>draft.source_version_digest
    OR source.review_state<>'pending' OR EXISTS(SELECT 1 FROM signal_topic_contract_draft_versions
      WHERE candidate_id=draft.candidate_id AND revision>draft.revision)
    OR NEW.request IS DISTINCT FROM jsonb_build_object('draft_id',draft.id::text,'expected_draft_revision',draft.revision,
      'expected_draft_digest',draft.draft_digest,'expected_candidate_revision',draft.source_revision,
      'expected_candidate_state_token',draft.source_state_token,'max_memberships',NEW.result->'max_memberships',
      'example_limit',NEW.result->'example_limit','timeout_ms',NEW.result->'timeout_ms') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft trial source, predecessor or request is stale.';
  END IF;
  IF NOT COALESCE(((NEW.result->>'max_memberships')::integer BETWEEN 1 AND 50000
    AND (NEW.result->>'example_limit')::integer BETWEEN 0 AND 10
    AND (NEW.result->>'timeout_ms')::integer BETWEEN 1 AND 15000),false)
    OR jsonb_typeof(NEW.result->'examples') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.result->'examples')>(NEW.result->>'example_limit')::integer THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft trial limits are invalid.';
  END IF;
  IF NEW.result-(ARRAY['contract_version','draft_id','draft_revision','draft_digest','spec_digest','compiler_version',
    'plan_hash','snapshot_digest','population_digest','considered_digest','population_kind','counts','max_memberships',
    'example_limit','timeout_ms','examples','topic_adoption','publication','serving'])<>'{}'::jsonb
    OR NEW.result->>'draft_id' IS DISTINCT FROM draft.id::text
    OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_snapshots snapshot WHERE snapshot.id=draft.snapshot_id
      AND snapshot.workspace_id=draft.workspace_id AND snapshot.state='frozen'
      AND snapshot.snapshot_digest=NEW.result->>'snapshot_digest'
      AND snapshot.membership_binding_digest=NEW.result->>'population_digest') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft trial projection or snapshot is invalid.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.result->'examples') LOOP
    IF jsonb_typeof(item)<>'object' OR item-(ARRAY['evidence_ref','outcome','excerpt','language','market','scope','month'])<>'{}'::jsonb
      OR NOT COALESCE((item->>'evidence_ref'~'^sha256:[0-9a-f]{64}$'
        AND item->>'outcome' IN('matched','abstained') AND jsonb_typeof(item->'excerpt')='string'
        AND char_length(item->>'excerpt')<=600),false) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft trial example projection is invalid.';
    END IF;
  END LOOP;
  SELECT count(*) INTO total_members FROM signal_topic_evaluation_v2_cluster_memberships
    WHERE snapshot_id=draft.snapshot_id AND workspace_id=draft.workspace_id;
  counts:=NEW.result->'counts';considered:=LEAST(total_members,(NEW.result->>'max_memberships')::integer);
  IF jsonb_typeof(counts) IS DISTINCT FROM 'object'
    OR counts-(ARRAY['total','considered','not_tested','unavailable','filter_excluded','matched','abstained'])<>'{}'::jsonb
    OR (counts->>'total')::integer IS DISTINCT FROM total_members
    OR (counts->>'considered')::integer IS DISTINCT FROM considered
    OR (counts->>'not_tested')::integer IS DISTINCT FROM total_members-considered
    OR (counts->>'unavailable')::integer<0 OR (counts->>'filter_excluded')::integer<0
    OR (counts->>'matched')::integer<0 OR (counts->>'abstained')::integer<0
    OR (counts->>'unavailable')::integer+(counts->>'filter_excluded')::integer
      +(counts->>'matched')::integer+(counts->>'abstained')::integer IS DISTINCT FROM considered THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic draft trial denominator does not reconcile.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_signal_topic_contract_draft_trial_receipts BEFORE INSERT
  ON signal_topic_contract_draft_trial_receipts FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_contract_draft_trial_v1();
CREATE INDEX idx_signal_topic_contract_draft_latest ON signal_topic_contract_draft_versions(candidate_id,revision DESC);
CREATE INDEX idx_signal_topic_contract_trial_latest ON signal_topic_contract_draft_trial_receipts(draft_id,created_at DESC,id);
