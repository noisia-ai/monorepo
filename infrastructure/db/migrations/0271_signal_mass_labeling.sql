-- Workspace-owned mass classification. Installation creates no policy, activation or spend.
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_name;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_name CHECK(action IN(
 'brand_context_proposal','topic_prototype_embeddings','corpus_preparation','corpus_embeddings','topic_fit',
 'topic_interpretation','topic_fit_incremental','topic_interpretation_incremental','topic_consolidation',
 'topic_consolidation_numeric','interest_decision','mention_facets','concept_membership',
 'concept_membership_jev','concept_membership_claude','mass_labeling_jev'));
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_provider;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_provider CHECK(
 (kind='free' AND action IN('corpus_preparation','topic_fit','topic_fit_incremental','topic_consolidation_numeric')
  AND provider IS NULL AND model IS NULL AND max_execution_micro_usd=0)
 OR (kind='provider' AND provider IS NOT NULL AND model IS NOT NULL AND (
  action IN('brand_context_proposal','topic_interpretation','topic_interpretation_incremental','topic_consolidation','interest_decision')
    AND provider='anthropic' AND model='claude-sonnet-4-6'
  OR action IN('topic_prototype_embeddings','corpus_embeddings') AND provider='voyage' AND model='voyage-4-large'
  OR action IN('mention_facets','concept_membership') AND
    (provider='anthropic' AND model='claude-sonnet-5-5' OR provider='typesafe' AND model IN('jev-latest','jev-1.13.0'))
  OR action IN('concept_membership_jev','mass_labeling_jev') AND provider='typesafe' AND model='jev-1.13.0'
  OR action='concept_membership_claude' AND provider='anthropic' AND model='claude-sonnet-5-5')));

-- The organization policy admits only the explicitly configured pilot workspace.
CREATE FUNCTION guard_signal_mass_labeling_admission_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.configuration->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
   OR NEW.configuration->>'contract_version' IS DISTINCT FROM 'mass-labeling-jev-v1'
   OR NEW.provider IS DISTINCT FROM 'typesafe' OR NEW.model IS DISTINCT FROM 'jev-1.13.0'
   OR NEW.execution_cap_micro_usd IS NULL OR NEW.execution_cap_micro_usd<=0 OR NEW.automatic
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling') THEN
  RAISE EXCEPTION 'mass_labeling_admission_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_admission BEFORE INSERT ON signal_processing_admissions
 FOR EACH ROW WHEN(NEW.action='mass_labeling_jev') EXECUTE FUNCTION guard_signal_mass_labeling_admission_v1();

ALTER TABLE signal_labeler_versions DROP CONSTRAINT signal_labeler_versions_kind_check;
ALTER TABLE signal_labeler_versions ADD CONSTRAINT signal_labeler_versions_kind_check
 CHECK(kind IN('facets','membership','mass_labeling'));
ALTER TABLE signal_labeling_runs DROP CONSTRAINT signal_labeling_runs_kind_check;
ALTER TABLE signal_labeling_runs ADD CONSTRAINT signal_labeling_runs_kind_check
 CHECK(kind IN('facets','membership','mass_labeling'));

CREATE UNIQUE INDEX signal_labeling_calls_workspace_id ON signal_labeling_calls(workspace_id,id);

CREATE TABLE signal_mass_labeling_maps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 source_engine_execution_id uuid NOT NULL,
 preparation_run_id uuid NOT NULL,
 input_revision bigint NOT NULL,
 embedding_config_digest text NOT NULL CHECK(embedding_config_digest ~ '^sha256:[0-9a-f]{64}$'),
 map_digest text NOT NULL CHECK(map_digest ~ '^sha256:[0-9a-f]{64}$'),
 entity_context_digest text NOT NULL CHECK(entity_context_digest ~ '^sha256:[0-9a-f]{64}$'),
 consolidation_artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id),
 consolidation_digest text NOT NULL CHECK(consolidation_digest ~ '^sha256:[0-9a-f]{64}$'),
 assignments_artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id),
 assignments_digest text NOT NULL CHECK(assignments_digest ~ '^sha256:[0-9a-f]{64}$'),
 catalog jsonb NOT NULL CHECK(jsonb_typeof(catalog)='array' AND jsonb_array_length(catalog) BETWEEN 1 AND 200),
 root_count integer NOT NULL CHECK(root_count>0),
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,map_digest),
 FOREIGN KEY(workspace_id,source_engine_execution_id) REFERENCES signal_topic_catalog_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,preparation_run_id) REFERENCES signal_corpus_preparation_runs(workspace_id,id)
);
CREATE TABLE signal_mass_labeling_topics (
 workspace_id uuid NOT NULL,
 map_id uuid NOT NULL,
 topic_key text NOT NULL CHECK(topic_key ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^sha256:[0-9a-f]{64}$'),
 centroid vector(1024) NOT NULL,
 group_ids text[] NOT NULL CHECK(cardinality(group_ids)>0),
 PRIMARY KEY(map_id,topic_key),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id)
);
CREATE TABLE signal_mass_labeling_items (
 workspace_id uuid NOT NULL,
 map_id uuid NOT NULL,
 root_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>0),
 input_digest text NOT NULL CHECK(input_digest ~ '^sha256:[0-9a-f]{64}$'),
 root_fingerprint text NOT NULL CHECK(root_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
 chunk_index integer NOT NULL CHECK(chunk_index>=0),
 chunk_sha256 text NOT NULL,
 text text NOT NULL,
 candidates jsonb NOT NULL CHECK(jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates) BETWEEN 1 AND 8),
 PRIMARY KEY(map_id,root_id), UNIQUE(map_id,ordinal),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(workspace_id,root_id) REFERENCES mentions(workspace_id,id)
);
CREATE TABLE signal_mass_labeling_runs (
 workspace_id uuid NOT NULL,
 map_id uuid NOT NULL UNIQUE,
 run_id uuid PRIMARY KEY,
 smoke_root_limit integer CHECK(smoke_root_limit=1000),
 continued_at timestamptz,
 smoke_metrics jsonb,
 smoke_metrics_digest text CHECK(smoke_metrics_digest IS NULL OR smoke_metrics_digest ~ '^sha256:[0-9a-f]{64}$'),
 UNIQUE(workspace_id,run_id),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id)
);
CREATE TABLE signal_mass_labeling_call_roots (
 workspace_id uuid NOT NULL,
 run_id uuid NOT NULL,
 root_id uuid NOT NULL,
 call_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(run_id,root_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_mass_labeling_runs(workspace_id,run_id),
 FOREIGN KEY(workspace_id,root_id) REFERENCES mentions(workspace_id,id),
 FOREIGN KEY(workspace_id,call_id) REFERENCES signal_labeling_calls(workspace_id,id)
);
CREATE FUNCTION guard_signal_mass_labeling_call_root_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE mass signal_mass_labeling_runs%ROWTYPE; item signal_mass_labeling_items%ROWTYPE;
BEGIN
 SELECT * INTO mass FROM signal_mass_labeling_runs WHERE run_id=NEW.run_id AND workspace_id=NEW.workspace_id;
 IF mass.run_id IS NULL THEN RETURN NEW; END IF;
 IF jsonb_array_length(NEW.inputs)<>1 THEN
  RAISE EXCEPTION 'mass_labeling_call_root_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO item FROM signal_mass_labeling_items WHERE map_id=mass.map_id
   AND root_id=(NEW.inputs->0->>'root_id')::uuid;
 IF item.root_id IS NULL OR item.input_digest IS DISTINCT FROM NEW.inputs->0->>'input_digest'
   OR NEW.inputs->0->>'map_id' IS DISTINCT FROM mass.map_id::text
   OR mass.smoke_root_limit IS NOT NULL AND item.ordinal>mass.smoke_root_limit THEN
  RAISE EXCEPTION 'mass_labeling_call_root_invalid' USING ERRCODE='23514'; END IF;
 INSERT INTO signal_mass_labeling_call_roots(workspace_id,run_id,root_id,call_id)
 VALUES(NEW.workspace_id,NEW.run_id,item.root_id,NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_call_root AFTER INSERT ON signal_labeling_calls
 FOR EACH ROW WHEN(NEW.provider='typesafe') EXECUTE FUNCTION guard_signal_mass_labeling_call_root_v1();

CREATE TABLE signal_mass_labeling_results (
 workspace_id uuid NOT NULL,
 map_id uuid NOT NULL,
 root_id uuid NOT NULL,
 run_id uuid NOT NULL,
 call_id uuid NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN('labeled','abstained','refused','error')),
 probabilities jsonb NOT NULL CHECK(jsonb_typeof(probabilities)='object'),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(map_id,root_id),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(map_id,root_id) REFERENCES signal_mass_labeling_items(map_id,root_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_mass_labeling_runs(workspace_id,run_id),
 FOREIGN KEY(workspace_id,call_id) REFERENCES signal_labeling_calls(workspace_id,id)
);
CREATE TABLE signal_mass_labeling_selections (
 workspace_id uuid PRIMARY KEY REFERENCES signal_workspaces(id),
 map_id uuid NOT NULL,
 selected_topic_keys text[] NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 selected_by_user_id uuid NOT NULL REFERENCES users(id),
 selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id)
);
CREATE TABLE signal_mass_labeling_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 map_id uuid NOT NULL,
 root_id uuid NOT NULL,
 topic_key text NOT NULL,
 belongs boolean NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id),
 decided_via text NOT NULL CHECK(decided_via IN('human_ui','agent_assisted')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(map_id,root_id) REFERENCES signal_mass_labeling_items(map_id,root_id),
 FOREIGN KEY(map_id,topic_key) REFERENCES signal_mass_labeling_topics(map_id,topic_key)
);
CREATE INDEX signal_mass_labeling_overrides_pair ON signal_mass_labeling_overrides(map_id,root_id,topic_key,created_at DESC,id DESC);

CREATE FUNCTION guard_signal_mass_labeling_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'mass_labeling_history_is_immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER mass_labeling_map_immutable BEFORE UPDATE OR DELETE ON signal_mass_labeling_maps
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_immutable_v1();
CREATE TRIGGER mass_labeling_topics_immutable BEFORE UPDATE OR DELETE ON signal_mass_labeling_topics
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_immutable_v1();
CREATE TRIGGER mass_labeling_items_immutable BEFORE UPDATE OR DELETE ON signal_mass_labeling_items
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_immutable_v1();
CREATE TRIGGER mass_labeling_call_roots_immutable BEFORE UPDATE OR DELETE ON signal_mass_labeling_call_roots
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_immutable_v1();
CREATE TRIGGER mass_labeling_results_immutable BEFORE UPDATE OR DELETE ON signal_mass_labeling_results
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_immutable_v1();
CREATE TRIGGER mass_labeling_overrides_immutable BEFORE UPDATE OR DELETE ON signal_mass_labeling_overrides
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_immutable_v1();

CREATE FUNCTION guard_signal_mass_labeling_run_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.workspace_id,NEW.map_id,NEW.run_id)
   IS DISTINCT FROM ROW(OLD.workspace_id,OLD.map_id,OLD.run_id)
   OR OLD.smoke_root_limit IS NULL AND NEW.smoke_root_limit IS NOT NULL
   OR OLD.smoke_metrics IS NOT NULL AND ROW(NEW.smoke_metrics,NEW.smoke_metrics_digest)
     IS DISTINCT FROM ROW(OLD.smoke_metrics,OLD.smoke_metrics_digest)
   OR OLD.continued_at IS NOT NULL AND NEW.continued_at IS DISTINCT FROM OLD.continued_at THEN
  RAISE EXCEPTION 'mass_labeling_run_seal_invalid' USING ERRCODE='23514';
 END IF;
 IF OLD.smoke_root_limit IS NOT NULL AND NEW.smoke_root_limit IS NULL AND (
   NEW.smoke_metrics IS NULL OR COALESCE((NEW.smoke_metrics->>'technical_failure')::boolean,true)
   OR NEW.continued_at IS NULL) THEN
  RAISE EXCEPTION 'mass_labeling_smoke_review_required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_run_seal BEFORE UPDATE OR DELETE ON signal_mass_labeling_runs
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_run_v1();

CREATE VIEW signal_mass_labeling_memberships_v1 AS
 WITH pairs AS (
  SELECT item.workspace_id,item.map_id,item.root_id,topic.topic_key concept_key,topic.definition_digest,
    candidate.ordinality-1 candidate_ordinal
  FROM signal_mass_labeling_items item
  CROSS JOIN LATERAL jsonb_array_elements(item.candidates) WITH ORDINALITY candidate(value,ordinality)
  JOIN signal_mass_labeling_topics topic ON topic.map_id=item.map_id AND topic.topic_key=candidate.value->>'topic_key'
  UNION
  SELECT correction.workspace_id,correction.map_id,correction.root_id,topic.topic_key,topic.definition_digest,NULL::bigint
  FROM signal_mass_labeling_overrides correction
  JOIN signal_mass_labeling_topics topic ON topic.map_id=correction.map_id AND topic.topic_key=correction.topic_key
  WHERE NOT EXISTS(SELECT 1 FROM signal_mass_labeling_items item
    CROSS JOIN LATERAL jsonb_array_elements(item.candidates) candidate
    WHERE item.map_id=correction.map_id AND item.root_id=correction.root_id AND candidate->>'topic_key'=correction.topic_key)
 ) SELECT pair.*,COALESCE(override.belongs,
   (result.probabilities->('topic_'||candidate_ordinal::text)->>'noul')::double precision>0.7) belongs,
   CASE WHEN override.id IS NOT NULL THEN 1::double precision
     ELSE (result.probabilities->('topic_'||candidate_ordinal::text)->>'noul')::double precision END probability,
   override.id override_id
 FROM pairs pair
 LEFT JOIN signal_mass_labeling_results result ON result.map_id=pair.map_id AND result.root_id=pair.root_id
   AND result.status IN('labeled','abstained')
 LEFT JOIN LATERAL (
   SELECT correction.id,correction.belongs FROM signal_mass_labeling_overrides correction
   WHERE correction.map_id=pair.map_id AND correction.root_id=pair.root_id AND correction.topic_key=pair.concept_key
   ORDER BY correction.created_at DESC,correction.id DESC LIMIT 1
 ) override ON true;

CREATE FUNCTION guard_signal_mass_labeling_result_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE call signal_labeling_calls%ROWTYPE; item signal_mass_labeling_items%ROWTYPE;
  stored jsonb; answer record; expected integer;
BEGIN
 SELECT * INTO call FROM signal_labeling_calls WHERE workspace_id=NEW.workspace_id AND id=NEW.call_id;
 SELECT * INTO item FROM signal_mass_labeling_items WHERE workspace_id=NEW.workspace_id AND map_id=NEW.map_id AND root_id=NEW.root_id;
 stored:=call.results->0;
 IF call.run_id IS DISTINCT FROM NEW.run_id OR NOT call.results_applied OR jsonb_array_length(call.inputs)<>1
   OR jsonb_array_length(call.results)<>1 OR call.inputs->0->>'map_id' IS DISTINCT FROM NEW.map_id::text
   OR call.inputs->0->>'root_id' IS DISTINCT FROM NEW.root_id::text
   OR call.inputs->0->>'input_digest' IS DISTINCT FROM item.input_digest
   OR stored->>'root_id' IS DISTINCT FROM NEW.root_id::text
   OR stored->>'input_digest' IS DISTINCT FROM item.input_digest
   OR stored->>'status' IS DISTINCT FROM NEW.status
   OR COALESCE(stored->'probabilities','{}'::jsonb) IS DISTINCT FROM NEW.probabilities
   OR stored->>'error_code' IS DISTINCT FROM NEW.error_code
   OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_runs mass WHERE mass.workspace_id=NEW.workspace_id
     AND mass.map_id=NEW.map_id AND mass.run_id=NEW.run_id) THEN
  RAISE EXCEPTION 'mass_labeling_result_lineage_invalid' USING ERRCODE='23514';
 END IF;
 IF NEW.status IN('labeled','abstained') THEN
  expected:=5+jsonb_array_length(item.candidates);
  IF call.status<>'settled' OR call.raw_sha256 IS NULL OR call.settled_micro_usd IS NULL
    OR (SELECT count(*) FROM jsonb_object_keys(NEW.probabilities))<>expected THEN
   RAISE EXCEPTION 'mass_labeling_probabilities_incomplete' USING ERRCODE='23514';
  END IF;
  FOR answer IN SELECT * FROM jsonb_each(NEW.probabilities) LOOP
   IF answer.key IN('relevance','promotion','spam') OR answer.key ~ '^topic_[0-7]$' THEN
    IF answer.value->>'type' IS DISTINCT FROM 'noul' OR jsonb_typeof(answer.value->'noul') IS DISTINCT FROM 'number'
      OR (answer.value->>'noul')::numeric NOT BETWEEN 0 AND 1 THEN
     RAISE EXCEPTION 'mass_labeling_probability_invalid' USING ERRCODE='23514';
    END IF;
   ELSIF answer.key IN('voice','trigger_barrier') THEN
    IF answer.value->>'type' IS DISTINCT FROM 'choice' OR jsonb_typeof(answer.value->'probabilities') IS DISTINCT FROM 'object' THEN
     RAISE EXCEPTION 'mass_labeling_choice_invalid' USING ERRCODE='23514';
    END IF;
   ELSE RAISE EXCEPTION 'mass_labeling_question_invalid' USING ERRCODE='23514';
   END IF;
  END LOOP;
  IF NOT NEW.probabilities ?& ARRAY['relevance','promotion','spam','voice','trigger_barrier']
    OR EXISTS(SELECT 1 FROM generate_series(0,jsonb_array_length(item.candidates)-1) ordinal
      WHERE NOT NEW.probabilities ? ('topic_'||ordinal::text)) THEN
   RAISE EXCEPTION 'mass_labeling_probabilities_incomplete' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_result_lineage BEFORE INSERT ON signal_mass_labeling_results
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_result_v1();

DO $$ DECLARE object_name text; role_name text; BEGIN
 FOREACH object_name IN ARRAY ARRAY['signal_mass_labeling_maps','signal_mass_labeling_topics',
   'signal_mass_labeling_items','signal_mass_labeling_runs','signal_mass_labeling_call_roots','signal_mass_labeling_results',
   'signal_mass_labeling_selections','signal_mass_labeling_overrides'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',object_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',object_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',object_name,role_name);
   END IF;
  END LOOP;
 END LOOP;
 REVOKE ALL ON signal_mass_labeling_memberships_v1 FROM PUBLIC;
 REVOKE ALL ON FUNCTION guard_signal_mass_labeling_call_root_v1(),guard_signal_mass_labeling_admission_v1(),guard_signal_mass_labeling_immutable_v1(),guard_signal_mass_labeling_result_v1(),guard_signal_mass_labeling_run_v1() FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_mass_labeling_memberships_v1 FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION guard_signal_mass_labeling_call_root_v1(),guard_signal_mass_labeling_admission_v1(),guard_signal_mass_labeling_immutable_v1(),guard_signal_mass_labeling_result_v1(),guard_signal_mass_labeling_run_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
