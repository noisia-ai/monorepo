-- Candidate rule cohorts bind one existing draft taxonomy/profile, not another Topic store.
CREATE TABLE signal_topic_rule_cohort_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_runs(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_snapshots(id) ON DELETE RESTRICT,
  cohort_revision integer NOT NULL CHECK(cohort_revision>=1),
  predecessor_id uuid REFERENCES signal_topic_rule_cohort_versions(id) ON DELETE RESTRICT,
  binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object' AND pg_column_size(binding)<=131072),
  cohort_digest text NOT NULL CHECK(cohort_digest~'^sha256:[0-9a-f]{64}$'),
  profile_id uuid NOT NULL UNIQUE REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
  profile_version integer NOT NULL CHECK(profile_version>=1),
  profile_binding_digest text NOT NULL CHECK(profile_binding_digest~'^sha256:[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND pg_column_size(request)<=32768),
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,idempotency_key),UNIQUE(workspace_id,run_id,cohort_revision),UNIQUE(id,workspace_id)
);
CREATE TABLE signal_topic_rule_cohort_trial_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  cohort_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND pg_column_size(request)<=4096),
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND pg_column_size(result)<=65536),
  result_digest text NOT NULL CHECK(result_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(cohort_id,workspace_id) REFERENCES signal_topic_rule_cohort_versions(id,workspace_id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,idempotency_key)
);
CREATE FUNCTION signal_topic_rule_cohort_profile_digest_v1(profile_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  -- Explicit composite arguments matter: bare rules resolves to tagging_rule_sets.rules,
  -- silently excluding that row's metadata from the mutable graph fingerprint.
  SELECT signal_semantic_context_digest_v1(jsonb_build_array(to_jsonb(profile.*),to_jsonb(taxonomy.*),to_jsonb(rules.*),to_jsonb(model.*),
    (SELECT jsonb_agg(to_jsonb(term.*) ORDER BY term_key) FROM taxonomy_terms term WHERE term.taxonomy_id=profile.taxonomy_id))::text)
  FROM signal_taxonomy_profiles profile JOIN taxonomies taxonomy ON taxonomy.id=profile.taxonomy_id
    JOIN tagging_rule_sets rules ON rules.id=profile.rule_set_id JOIN tagging_model_versions model ON model.id=profile.model_version_id
  WHERE profile.id=profile_id;
$$;
CREATE FUNCTION signal_topic_rule_cohort_sources_current_v1(binding jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE source jsonb; previous_key text:=''; matched integer;
BEGIN
  IF binding-(ARRAY['workspace_id','run_key','run_id','snapshot_id','snapshot_digest','population_digest','rights_digest',
    'semantic_context_authority_digest','artifact_binding_digest','cohort_revision','predecessor_digest','rules'])<>'{}'::jsonb
    OR jsonb_typeof(binding->'rules') IS DISTINCT FROM 'array' OR jsonb_array_length(binding->'rules') NOT BETWEEN 2 AND 15 THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_runs run JOIN signal_topic_evaluation_v2_snapshots snapshot
    ON snapshot.id=run.snapshot_id AND snapshot.workspace_id=run.workspace_id
    WHERE run.id=(binding->>'run_id')::uuid AND run.workspace_id=(binding->>'workspace_id')::uuid AND run.run_key=binding->>'run_key'
      AND run.status='completed' AND snapshot.id=(binding->>'snapshot_id')::uuid AND snapshot.state='frozen'
      AND snapshot.snapshot_digest=binding->>'snapshot_digest' AND snapshot.rights_digest=binding->>'rights_digest'
      AND snapshot.semantic_context_authority_digest=binding->>'semantic_context_authority_digest'
      AND snapshot.artifact_binding_digest=binding->>'artifact_binding_digest'
      AND snapshot.membership_binding_digest=binding->>'population_digest') THEN RETURN false; END IF;
  FOR source IN SELECT value FROM jsonb_array_elements(binding->'rules') LOOP
    IF source-(ARRAY['candidate_id','candidate_key','candidate_revision','candidate_version_digest','candidate_state_token',
      'draft_id','draft_revision','draft_digest','spec_digest','rule_spec'])<>'{}'::jsonb
      OR source->>'candidate_key' IS NULL OR (source->>'candidate_key') COLLATE "C"<=previous_key COLLATE "C" THEN RETURN false; END IF;
    previous_key:=source->>'candidate_key';
    SELECT count(*) INTO matched FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
    JOIN LATERAL(SELECT * FROM signal_topic_contract_draft_versions WHERE candidate_id=candidate.id ORDER BY revision DESC LIMIT 1) draft ON true
    LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions WHERE candidate_id=candidate.id ORDER BY revision DESC LIMIT 1) editorial ON true
    WHERE candidate.id=(source->>'candidate_id')::uuid AND candidate.candidate_key=source->>'candidate_key'
      AND candidate.workspace_id=(binding->>'workspace_id')::uuid AND candidate.run_id=(binding->>'run_id')::uuid
      AND candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
      AND COALESCE(editorial.review_state,'pending')='pending'
      AND COALESCE(editorial.revision,1)=(source->>'candidate_revision')::int
      AND COALESCE(editorial.version_digest,base.payload_digest)=source->>'candidate_version_digest'
      AND signal_topic_evaluation_v2_candidate_state_token_v1(candidate.id,COALESCE(editorial.revision,1),COALESCE(editorial.version_digest,base.payload_digest))=source->>'candidate_state_token'
      AND draft.id=(source->>'draft_id')::uuid AND draft.revision=(source->>'draft_revision')::int
      AND draft.workspace_id=candidate.workspace_id AND draft.run_id=candidate.run_id AND draft.snapshot_id=(binding->>'snapshot_id')::uuid
      AND draft.source_revision=COALESCE(editorial.revision,1) AND draft.source_version_digest=COALESCE(editorial.version_digest,base.payload_digest)
      AND draft.draft_digest=source->>'draft_digest' AND draft.spec_digest=source->>'spec_digest' AND draft.rule_spec=source->'rule_spec';
    IF matched<>1 THEN RETURN false; END IF;
  END LOOP;RETURN true;
END; $$;
CREATE FUNCTION validate_signal_topic_rule_cohort_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior signal_topic_rule_cohort_versions%ROWTYPE; p signal_taxonomy_profiles%ROWTYPE; source jsonb; expected_sources jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort actor is invalid.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-topic-cohort:'||NEW.workspace_id::text||':'||(NEW.binding->>'run_key'),0));
  FOR source IN SELECT value FROM jsonb_array_elements(NEW.binding->'rules') ORDER BY (value->>'candidate_key') COLLATE "C" LOOP
    PERFORM 1 FROM signal_topic_evaluation_v2_candidates WHERE id=(source->>'candidate_id')::uuid FOR UPDATE;
  END LOOP;
  SELECT * INTO prior FROM signal_topic_rule_cohort_versions WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id ORDER BY cohort_revision DESC LIMIT 1;
  IF NEW.cohort_revision<>COALESCE(prior.cohort_revision,0)+1 OR NEW.predecessor_id IS DISTINCT FROM prior.id
    OR NEW.binding->'predecessor_digest' IS DISTINCT FROM COALESCE(to_jsonb(prior.cohort_digest),'null'::jsonb)
    OR NEW.binding->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text OR NEW.binding->>'run_id' IS DISTINCT FROM NEW.run_id::text
    OR NEW.binding->>'snapshot_id' IS DISTINCT FROM NEW.snapshot_id::text
    OR (NEW.binding->>'cohort_revision')::int IS DISTINCT FROM NEW.cohort_revision
    OR NOT signal_topic_rule_cohort_sources_current_v1(NEW.binding)
    OR NEW.cohort_digest<>signal_semantic_context_digest_json_v2(NEW.binding)
    OR NEW.request_digest<>signal_semantic_context_digest_json_v2(NEW.request) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort binding or predecessor is invalid.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('candidate_key',value->>'candidate_key','draft_id',value->>'draft_id',
    'expected_candidate_revision',value->'candidate_revision','expected_candidate_state_token',value->>'candidate_state_token',
    'expected_draft_revision',value->'draft_revision','expected_draft_digest',value->>'draft_digest') ORDER BY (value->>'candidate_key') COLLATE "C")
    INTO expected_sources FROM jsonb_array_elements(NEW.binding->'rules');
  IF NEW.request IS DISTINCT FROM jsonb_build_object('run_key',NEW.binding->>'run_key','sources',expected_sources,
    'expected_cohort_revision',NEW.cohort_revision-1,'expected_cohort_digest',prior.cohort_digest) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort request is invalid.'; END IF;
  SELECT * INTO p FROM signal_taxonomy_profiles WHERE id=NEW.profile_id AND workspace_id=NEW.workspace_id AND kind='topic' AND status='draft';
  IF p.id IS NULL OR p.version<>NEW.profile_version OR p.context_hash<>NEW.cohort_digest
    OR p.metadata->>'cohort_digest' IS DISTINCT FROM NEW.cohort_digest OR p.metadata->'binding' IS DISTINCT FROM NEW.binding
    OR p.metadata->>'origin' IS DISTINCT FROM 'operator_deterministic'
    OR NEW.profile_binding_digest IS DISTINCT FROM signal_topic_rule_cohort_profile_digest_v1(p.id)
    OR NOT EXISTS(SELECT 1 FROM taxonomies WHERE id=p.taxonomy_id AND status='draft' AND scope='workspace')
    OR NOT EXISTS(SELECT 1 FROM tagging_rule_sets r WHERE r.id=p.rule_set_id AND r.taxonomy_id=p.taxonomy_id AND r.version=p.version AND r.status='draft'
      AND r.metadata->'binding'=NEW.binding AND r.metadata->>'cohort_digest'=NEW.cohort_digest AND r.rules->'binding'=NEW.binding
      AND r.rules->'rules'=(SELECT jsonb_agg(jsonb_build_object('candidate_key',value->>'candidate_key','rule_spec',value->'rule_spec')
        ORDER BY (value->>'candidate_key') COLLATE "C") FROM jsonb_array_elements(NEW.binding->'rules')))
    OR NOT EXISTS(SELECT 1 FROM tagging_model_versions m WHERE m.id=p.model_version_id AND m.tagging_rule_set_id=p.rule_set_id
      AND m.provider='operator' AND m.prompt_hash=NEW.cohort_digest AND m.metadata->'binding'=NEW.binding
      AND m.metadata->>'execution_kind'='deterministic' AND m.metadata->'provider_calls'='0'::jsonb
      AND m.metadata->'cost_micro_usd'='0'::jsonb AND m.metadata->'input_tokens'='0'::jsonb AND m.metadata->'output_tokens'='0'::jsonb)
    OR (SELECT count(*) FROM taxonomy_terms WHERE taxonomy_id=p.taxonomy_id)<>jsonb_array_length(NEW.binding->'rules') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort draft profile graph is invalid.'; END IF;
  FOR source IN SELECT value FROM jsonb_array_elements(NEW.binding->'rules') LOOP
    IF NOT EXISTS(SELECT 1 FROM taxonomy_terms term WHERE term.taxonomy_id=p.taxonomy_id AND term.term_key=source->>'candidate_key'
      AND term.status='candidate' AND term.label=source->'rule_spec'->>'label' AND term.description=source->'rule_spec'->>'definition'
      AND term.metadata->'source'=source AND term.metadata->>'origin'='operator_deterministic') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort term binding is invalid.'; END IF;
  END LOOP;RETURN NEW;
END; $$;
CREATE TRIGGER validate_signal_topic_rule_cohort_versions BEFORE INSERT ON signal_topic_rule_cohort_versions
  FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_rule_cohort_v1();
CREATE TRIGGER protect_signal_topic_rule_cohort_versions BEFORE UPDATE OR DELETE ON signal_topic_rule_cohort_versions
  FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_contract_draft_v1();
CREATE TRIGGER protect_signal_topic_rule_cohort_trial_receipts BEFORE UPDATE OR DELETE ON signal_topic_rule_cohort_trial_receipts
  FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_contract_draft_v1();

CREATE FUNCTION validate_signal_topic_rule_cohort_trial_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cohort signal_topic_rule_cohort_versions%ROWTYPE; counts jsonb; total integer; considered integer; source jsonb; item jsonb;
DECLARE key_count integer; exclusive_sum integer:=0; rule_index integer:=0; left_index integer; right_index integer;
DECLARE pair_index integer:=0; left_rule jsonb; right_rule jsonb; expected_keys jsonb; selected_key jsonb; previous_key text;
BEGIN
  SELECT * INTO cohort FROM signal_topic_rule_cohort_versions WHERE id=NEW.cohort_id AND workspace_id=NEW.workspace_id;
  IF cohort.id IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort trial authority is invalid.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-topic-cohort:'||cohort.workspace_id::text||':'||(cohort.binding->>'run_key'),0));
  FOR source IN SELECT value FROM jsonb_array_elements(cohort.binding->'rules') ORDER BY (value->>'candidate_key') COLLATE "C" LOOP
    PERFORM 1 FROM signal_topic_evaluation_v2_candidates WHERE id=(source->>'candidate_id')::uuid FOR UPDATE;
  END LOOP;
  IF EXISTS(SELECT 1 FROM signal_topic_rule_cohort_versions WHERE workspace_id=cohort.workspace_id AND run_id=cohort.run_id AND cohort_revision>cohort.cohort_revision)
    OR NOT signal_topic_rule_cohort_sources_current_v1(cohort.binding)
    OR cohort.profile_binding_digest IS DISTINCT FROM signal_topic_rule_cohort_profile_digest_v1(cohort.profile_id)
    OR NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles WHERE id=cohort.profile_id AND status='draft')
    OR NEW.request_digest<>signal_semantic_context_digest_json_v2(NEW.request) OR NEW.result_digest<>signal_semantic_context_digest_json_v2(NEW.result)
    OR NEW.result->>'contract_version' IS DISTINCT FROM 'signal-topic-rule-cohort-trial-v1'
    OR NEW.result->>'cohort_id' IS DISTINCT FROM cohort.id::text OR NEW.result->>'cohort_digest' IS DISTINCT FROM cohort.cohort_digest
    OR NEW.result->'cohort_revision' IS DISTINCT FROM to_jsonb(cohort.cohort_revision)
    OR NEW.result->>'profile_id' IS DISTINCT FROM cohort.profile_id::text OR NEW.result->'profile_version' IS DISTINCT FROM to_jsonb(cohort.profile_version)
    OR NEW.result->>'snapshot_digest' IS DISTINCT FROM cohort.binding->>'snapshot_digest'
    OR NEW.result->>'population_digest' IS DISTINCT FROM cohort.binding->>'population_digest'
    OR NEW.result->>'population_kind' IS DISTINCT FROM 'frozen_snapshot_memberships'
    OR NEW.result->'topic_adoption' IS DISTINCT FROM 'false'::jsonb OR NEW.result->'publication' IS DISTINCT FROM 'false'::jsonb
    OR NEW.result->'serving' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort trial source or receipt binding is invalid.'; END IF;
  IF NEW.result-(ARRAY['contract_version','cohort_id','cohort_revision','cohort_digest','profile_id','profile_version',
      'compiler_version','plan_hash','rule_plans','counts','per_rule','pairs','snapshot_digest','population_digest',
      'considered_digest','population_kind','max_memberships','example_limit','timeout_ms','examples','topic_adoption','publication','serving'])<>'{}'::jsonb
    OR NEW.result->>'compiler_version' IS DISTINCT FROM 'signal-topic-rule-cohort-simple-fts-v1'
    OR NOT COALESCE((NEW.result->>'plan_hash'~'^sha256:[0-9a-f]{64}$' AND NEW.result->>'considered_digest'~'^sha256:[0-9a-f]{64}$'),false)
    OR NEW.request IS DISTINCT FROM jsonb_build_object('run_key',cohort.binding->>'run_key','expected_cohort_revision',cohort.cohort_revision,
    'expected_cohort_digest',cohort.cohort_digest,'max_memberships',NEW.result->'max_memberships',
    'example_limit',NEW.result->'example_limit','timeout_ms',NEW.result->'timeout_ms')
    OR NOT COALESCE(((NEW.result->>'max_memberships')::int BETWEEN 1 AND 50000
      AND (NEW.result->>'example_limit')::int BETWEEN 0 AND 10 AND (NEW.result->>'timeout_ms')::int BETWEEN 1 AND 15000),false) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort trial request or limits are invalid.'; END IF;
  SELECT count(*) INTO total FROM signal_topic_evaluation_v2_cluster_memberships WHERE workspace_id=cohort.workspace_id AND snapshot_id=cohort.snapshot_id;
  considered:=LEAST(total,(NEW.result->>'max_memberships')::int);counts:=NEW.result->'counts';
  IF jsonb_typeof(counts) IS DISTINCT FROM 'object'
    OR counts-(ARRAY['total','considered','not_tested','unavailable','excluded_by_all_filters','abstained','single_match','multiple_match','covered'])<>'{}'::jsonb
    OR (SELECT count(*) FROM jsonb_object_keys(counts))<>9 OR (counts->>'total')::int IS DISTINCT FROM total
    OR (counts->>'considered')::int IS DISTINCT FROM considered OR (counts->>'not_tested')::int IS DISTINCT FROM total-considered
    OR (counts->>'covered')::int IS DISTINCT FROM (counts->>'single_match')::int+(counts->>'multiple_match')::int
    OR (counts->>'unavailable')::int+(counts->>'excluded_by_all_filters')::int+(counts->>'abstained')::int
      +(counts->>'single_match')::int+(counts->>'multiple_match')::int IS DISTINCT FROM considered
    OR EXISTS(SELECT 1 FROM jsonb_each(counts) entry WHERE jsonb_typeof(entry.value)<>'number' OR (entry.value#>>'{}')::int<0) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort trial denominator is invalid.'; END IF;
  key_count:=jsonb_array_length(cohort.binding->'rules');
  IF jsonb_typeof(NEW.result->'per_rule') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'per_rule')<>key_count
    OR jsonb_typeof(NEW.result->'pairs') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'pairs')<>key_count*(key_count-1)/2
    OR jsonb_typeof(NEW.result->'rule_plans') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'rule_plans')<>key_count THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort trial rule projections are invalid.'; END IF;
  FOR source IN SELECT value FROM jsonb_array_elements(cohort.binding->'rules') LOOP
    item:=NEW.result->'per_rule'->rule_index;
    IF item->>'candidate_key' IS DISTINCT FROM source->>'candidate_key'
      OR item-(ARRAY['candidate_key','matched','exclusive','shared'])<>'{}'::jsonb
      OR NOT COALESCE(((item->>'matched')::int=(item->>'exclusive')::int+(item->>'shared')::int
        AND (item->>'exclusive')::int>=0 AND (item->>'shared')::int>=0
        AND (item->>'shared')::int<=(counts->>'multiple_match')::int AND (item->>'matched')::int<=(counts->>'covered')::int),false) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort per-rule denominator is invalid.'; END IF;
    exclusive_sum:=exclusive_sum+(item->>'exclusive')::int;
    item:=NEW.result->'rule_plans'->rule_index;
    IF item->>'candidate_key' IS DISTINCT FROM source->>'candidate_key' OR item->>'spec_digest' IS DISTINCT FROM source->>'spec_digest'
      OR item-(ARRAY['candidate_key','spec_digest','compiler_version','plan_hash'])<>'{}'::jsonb
      OR item->>'compiler_version' IS DISTINCT FROM 'signal-topic-rule-simple-fts-v1'
      OR NOT COALESCE(item->>'plan_hash'~'^sha256:[0-9a-f]{64}$',false) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort rule plan is invalid.'; END IF;
    rule_index:=rule_index+1;
  END LOOP;
  FOR left_index IN 0..key_count-2 LOOP
    FOR right_index IN left_index+1..key_count-1 LOOP
      item:=NEW.result->'pairs'->pair_index;left_rule:=NEW.result->'per_rule'->left_index;right_rule:=NEW.result->'per_rule'->right_index;
      IF item->>'left_candidate_key' IS DISTINCT FROM left_rule->>'candidate_key'
        OR item->>'right_candidate_key' IS DISTINCT FROM right_rule->>'candidate_key'
        OR item-(ARRAY['left_candidate_key','right_candidate_key','intersection'])<>'{}'::jsonb
        OR NOT COALESCE(((item->>'intersection')::int BETWEEN 0 AND LEAST((left_rule->>'shared')::int,
          (right_rule->>'shared')::int,(counts->>'multiple_match')::int)),false) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort pair intersection is invalid.'; END IF;
      pair_index:=pair_index+1;
    END LOOP;
  END LOOP;
  IF exclusive_sum IS DISTINCT FROM (counts->>'single_match')::int OR jsonb_typeof(NEW.result->'examples') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.result->'examples')>(NEW.result->>'example_limit')::int THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort exclusive counts or examples are invalid.'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.result->'examples') LOOP
    IF item-(ARRAY['evidence_ref','outcome','matched_candidate_keys','excerpt','language','market','scope','month'])<>'{}'::jsonb
      OR NOT COALESCE((item->>'evidence_ref'~'^sha256:[0-9a-f]{64}$' AND item->>'outcome' IN('abstained','single_match','multiple_match')
      AND jsonb_typeof(item->'excerpt')='string' AND char_length(item->>'excerpt')<=600
      AND item->>'month'~'^[0-9]{4}-(0[1-9]|1[0-2])$'
      AND (item->'language'='null'::jsonb OR item->>'language'~'^[a-z]{2}$')
      AND (item->'market'='null'::jsonb OR item->>'market'~'^[A-Z]{2}$')
      AND (item->'scope'='null'::jsonb OR item->>'scope' IN('primary_brand','same_entity','competitor','category','other'))
      AND jsonb_typeof(item->'matched_candidate_keys')='array'),false) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort trial example is invalid.'; END IF;
    previous_key:='';
    FOR selected_key IN SELECT value FROM jsonb_array_elements(item->'matched_candidate_keys') LOOP
      IF jsonb_typeof(selected_key)<>'string' OR (selected_key#>>'{}') COLLATE "C"<=previous_key COLLATE "C"
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cohort.binding->'rules') r WHERE r.value->>'candidate_key'=selected_key#>>'{}') THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort example matched keys are invalid.'; END IF;
      previous_key:=selected_key#>>'{}';
    END LOOP;
    IF item->>'outcome' IS DISTINCT FROM (CASE jsonb_array_length(item->'matched_candidate_keys')
      WHEN 0 THEN 'abstained' WHEN 1 THEN 'single_match' ELSE 'multiple_match' END) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic cohort example outcome is invalid.'; END IF;
  END LOOP;RETURN NEW;
END; $$;
CREATE TRIGGER validate_signal_topic_rule_cohort_trial_receipts BEFORE INSERT ON signal_topic_rule_cohort_trial_receipts
  FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_rule_cohort_trial_v1();
CREATE INDEX idx_signal_topic_rule_cohort_latest ON signal_topic_rule_cohort_versions(workspace_id,run_id,cohort_revision DESC);
CREATE INDEX idx_signal_topic_rule_cohort_trial_latest ON signal_topic_rule_cohort_trial_receipts(cohort_id,created_at DESC,id DESC);
