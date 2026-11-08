-- Study settings are append-only revisions. Paid evidence binds its definition.
CREATE TABLE signal_mass_labeling_study_policies (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id), revision integer NOT NULL CHECK(revision>0),
 category text NOT NULL CHECK(length(btrim(category)) BETWEEN 1 AND 160),
 lexicon_terms text[] NOT NULL CHECK(cardinality(lexicon_terms) BETWEEN 0 AND 256),
 candidate_language text NOT NULL CHECK(candidate_language IN('en','original')),
 interest_threshold double precision NOT NULL DEFAULT 0.85 CHECK(interest_threshold BETWEEN 0 AND 1),
 interests jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(interests)='array' AND jsonb_array_length(interests)<=32),
 lexicon_provenance text NOT NULL CHECK(lexicon_provenance IN('brand_os','editorial','analyst')),
 source_digest text CHECK(source_digest IS NULL OR source_digest ~ '^sha256:[0-9a-f]{64}$'),
 display_names jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(display_names)='object'),
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,revision)
);
CREATE TABLE signal_mass_labeling_study_interest_results (
 workspace_id uuid NOT NULL,map_id uuid NOT NULL,interest_key text NOT NULL CHECK(interest_key ~ '^[a-z][a-z0-9_]{0,63}$'),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^sha256:[0-9a-f]{64}$'),root_id uuid NOT NULL,
 input_digest text NOT NULL CHECK(input_digest ~ '^sha256:[0-9a-f]{64}$'),
 probability double precision NOT NULL CHECK(probability BETWEEN 0 AND 1),
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
 response_digest text NOT NULL CHECK(response_digest ~ '^sha256:[0-9a-f]{64}$'),
 usage jsonb NOT NULL CHECK(jsonb_typeof(usage)='object'),
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(map_id,interest_key,definition_digest,root_id),
 FOREIGN KEY(workspace_id,map_id,root_id) REFERENCES signal_mass_labeling_items(workspace_id,map_id,root_id)
);
CREATE INDEX signal_mass_labeling_study_interest_root ON signal_mass_labeling_study_interest_results(workspace_id,map_id,root_id);
CREATE FUNCTION guard_signal_mass_labeling_study_policy_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE item jsonb; field text; previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_policy_history_immutable' USING ERRCODE='23514'; END IF;
 IF NOT signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.created_by_user_id) THEN
  RAISE EXCEPTION 'study_policy_forbidden' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mass-study-policy:'||NEW.workspace_id::text,0));
 SELECT COALESCE(max(revision),0) INTO previous FROM signal_mass_labeling_study_policies WHERE workspace_id=NEW.workspace_id;
 IF NEW.revision<>previous+1 THEN RAISE EXCEPTION 'study_policy_conflict' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.lexicon_terms) term WHERE length(btrim(term)) NOT BETWEEN 1 AND 200)
   OR (SELECT count(DISTINCT i->>'key') FROM jsonb_array_elements(NEW.interests)i)<>jsonb_array_length(NEW.interests)
   OR (SELECT count(*) FROM jsonb_object_keys(NEW.display_names))>200 THEN
  RAISE EXCEPTION 'study_policy_invalid' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.interests) LOOP
  IF NOT COALESCE(item->>'key' ~ '^[a-z][a-z0-9_]{0,63}$' AND length(btrim(item->>'name')) BETWEEN 1 AND 160
    AND length(btrim(item->>'definition')) BETWEEN 1 AND 1200 AND jsonb_typeof(item->'active')='boolean',false)
    OR (SELECT count(*) FROM jsonb_object_keys(item))<>4 THEN
   RAISE EXCEPTION 'study_policy_interest_invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR field,item IN SELECT * FROM jsonb_each(NEW.display_names) LOOP
  IF NOT COALESCE(field ~ '^[a-z][a-z0-9_]{0,63}$' AND length(btrim(item->>'en')) BETWEEN 1 AND 160
    AND length(btrim(item->>'es')) BETWEEN 1 AND 160,false) OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 THEN
   RAISE EXCEPTION 'study_policy_names_invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_study_policy BEFORE INSERT OR UPDATE OR DELETE ON signal_mass_labeling_study_policies
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_study_policy_v1();
CREATE FUNCTION guard_signal_mass_labeling_study_interest_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_interest_history_immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_mass_labeling_items i WHERE i.workspace_id=NEW.workspace_id
  AND i.map_id=NEW.map_id AND i.root_id=NEW.root_id AND i.input_digest=NEW.input_digest)
  OR NOT COALESCE(NEW.usage->>'input_tokens' ~ '^[0-9]+$' AND NEW.usage->>'output_tokens' ~ '^[0-9]+$',false) THEN
  RAISE EXCEPTION 'study_interest_receipt_invalid' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_mass_labeling_study_policies policy
   CROSS JOIN LATERAL jsonb_array_elements(policy.interests) interest
   WHERE policy.workspace_id=NEW.workspace_id AND interest->>'key'=NEW.interest_key
    AND signal_labeling_digest_v1(jsonb_build_object('name',interest->>'name','definition',interest->>'definition'))=NEW.definition_digest) THEN
  RAISE EXCEPTION 'study_interest_definition_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_study_interest BEFORE INSERT OR UPDATE OR DELETE ON signal_mass_labeling_study_interest_results
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_study_interest_v1();

-- Literal lexical matching. The model supplies terms, never executable patterns.
DO $install$
DECLARE candidate record; unicode_collation text; supports_unicode boolean;
BEGIN
 FOR candidate IN SELECT c.collname FROM pg_catalog.pg_collation c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='pg_catalog'
   AND (c.collname IN('pg_c_utf8','und-x-icu','unicode','default') OR c.collprovider='i'
     OR lower(COALESCE(c.collctype,'')) LIKE '%utf%8%')
  ORDER BY CASE c.collname WHEN 'pg_c_utf8' THEN 0 WHEN 'und-x-icu' THEN 1 WHEN 'unicode' THEN 2 WHEN 'default' THEN 3 ELSE 4 END,c.collname LOOP
  EXECUTE format('SELECT %L COLLATE %I ~ %L','açãoé中',candidate.collname,'^[[:alpha:]]+$') INTO supports_unicode;
  IF supports_unicode THEN unicode_collation:=candidate.collname;EXIT;END IF;
 END LOOP;
 IF unicode_collation IS NULL THEN RAISE EXCEPTION 'study_unicode_collation_unavailable' USING ERRCODE='23514';END IF;
 EXECUTE format($create$
  CREATE FUNCTION signal_mass_labeling_lexical_text_v1(body text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
   SET search_path=pg_catalog AS $fn$
   SELECT ' '||btrim(regexp_replace(lower(COALESCE(body,'') COLLATE %1$I),'[^[:alnum:]]+',' ','g'))||' '
  $fn$;
 $create$,unicode_collation);
END $install$;
CREATE FUNCTION signal_mass_labeling_category_pattern_v1(terms text[]) RETURNS text
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_catalog AS $$
 SELECT ' ('||string_agg(term,'|' ORDER BY term COLLATE "C")||') '
 FROM (SELECT DISTINCT btrim(signal_mass_labeling_lexical_text_v1(value)) term FROM unnest(terms) value) normalized
 WHERE term<>''
$$;
-- Every pattern is constructed from normalized letters, digits and spaces.
-- A corpus body is normalized once, and query callers materialize the pattern once.
CREATE FUNCTION signal_mass_labeling_category_pattern_matches_v1(body text,pattern text) RETURNS boolean
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_catalog AS $$
 SELECT COALESCE(signal_mass_labeling_lexical_text_v1(body) ~ pattern,false)
$$;
CREATE FUNCTION signal_mass_labeling_category_matches_v1(body text,terms text[]) RETURNS boolean
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_catalog AS $$
 SELECT signal_mass_labeling_category_pattern_matches_v1(body,signal_mass_labeling_category_pattern_v1(terms))
$$;
DO $$ DECLARE object_name text;role_name text;BEGIN
 FOREACH object_name IN ARRAY ARRAY['signal_mass_labeling_study_policies','signal_mass_labeling_study_interest_results'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',object_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',object_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',object_name,role_name);END IF;
  END LOOP;
 END LOOP;
 REVOKE ALL ON FUNCTION signal_mass_labeling_category_pattern_matches_v1(text,text) FROM PUBLIC;
 REVOKE ALL ON FUNCTION guard_signal_mass_labeling_study_policy_v1(),guard_signal_mass_labeling_study_interest_v1() FROM PUBLIC;
END $$;

-- V2 retains the settled-call lineage fence and validates its complete question set.
CREATE OR REPLACE FUNCTION guard_signal_mass_labeling_result_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE call signal_labeling_calls%ROWTYPE; item signal_mass_labeling_items%ROWTYPE;
  stored jsonb; answer record; expected integer; identity jsonb; product boolean; topic_count integer; interest_count integer;
BEGIN
 SELECT * INTO call FROM signal_labeling_calls WHERE workspace_id=NEW.workspace_id AND id=NEW.call_id;
 SELECT * INTO item FROM signal_mass_labeling_items WHERE workspace_id=NEW.workspace_id AND map_id=NEW.map_id AND root_id=NEW.root_id;
 stored:=call.results->0;
 SELECT labeler.identity INTO identity FROM signal_labeling_runs run
  JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id WHERE run.id=NEW.run_id;
 product:=COALESCE(identity#>>'{params,request_version}'='mass-labeling-jev-v2',false);
 topic_count:=CASE WHEN product THEN least(4,jsonb_array_length(item.candidates)) ELSE jsonb_array_length(item.candidates) END;
 interest_count:=CASE WHEN product THEN jsonb_array_length(identity#>'{params,interests}') ELSE 0 END;
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
  expected:=CASE WHEN product THEN 3+topic_count+interest_count ELSE 5+topic_count END;
  IF call.status<>'settled' OR call.raw_sha256 IS NULL OR call.settled_micro_usd IS NULL
    OR (SELECT count(*) FROM jsonb_object_keys(NEW.probabilities))<>expected THEN
   RAISE EXCEPTION 'mass_labeling_probabilities_incomplete' USING ERRCODE='23514';
  END IF;
  FOR answer IN SELECT * FROM jsonb_each(NEW.probabilities) LOOP
   IF answer.key='promotion' OR NOT product AND answer.key IN('relevance','spam')
     OR answer.key ~ '^topic_[0-7]$' OR product AND EXISTS(SELECT 1 FROM jsonb_array_elements(identity#>'{params,interests}') i WHERE answer.key='interest_'||(i->>'key')) THEN
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
  IF NOT (NEW.probabilities ?& (CASE WHEN product THEN ARRAY['promotion','voice','trigger_barrier']
      ELSE ARRAY['relevance','promotion','spam','voice','trigger_barrier'] END))
    OR EXISTS(SELECT 1 FROM generate_series(0,topic_count-1) ordinal WHERE NOT NEW.probabilities ? ('topic_'||ordinal::text))
    OR product AND EXISTS(SELECT 1 FROM jsonb_array_elements(identity#>'{params,interests}') i WHERE NOT NEW.probabilities ? ('interest_'||(i->>'key'))) THEN
   RAISE EXCEPTION 'mass_labeling_probabilities_incomplete' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Candidate ordinals come from the exact paid request, including the four-candidate route.
CREATE OR REPLACE VIEW signal_mass_labeling_memberships_v1 AS
 WITH pairs AS (
  SELECT item.workspace_id,item.map_id,item.root_id,topic.topic_key concept_key,topic.definition_digest,
    CASE WHEN receipt.id IS NULL THEN candidate.ordinality-1 ELSE (SELECT selected.ordinality-1
      FROM jsonb_array_elements(receipt.inputs->0->'candidates') WITH ORDINALITY selected(value,ordinality)
      WHERE selected.value->>'topic_key'=candidate.value->>'topic_key') END candidate_ordinal
  FROM signal_mass_labeling_items item
  CROSS JOIN LATERAL jsonb_array_elements(item.candidates) WITH ORDINALITY candidate(value,ordinality)
  JOIN signal_mass_labeling_topics topic ON topic.map_id=item.map_id AND topic.topic_key=candidate.value->>'topic_key'
  LEFT JOIN signal_mass_labeling_results outcome ON outcome.map_id=item.map_id AND outcome.root_id=item.root_id
  LEFT JOIN signal_labeling_calls receipt ON receipt.id=outcome.call_id AND receipt.workspace_id=item.workspace_id
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
