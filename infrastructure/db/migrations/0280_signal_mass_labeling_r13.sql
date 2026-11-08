-- Additive language and consumer-review evidence for a frozen mass-labeling map.
CREATE UNIQUE INDEX signal_mass_labeling_items_scope_root ON signal_mass_labeling_items(workspace_id,map_id,root_id);
CREATE UNIQUE INDEX signal_mass_labeling_topics_scope_key ON signal_mass_labeling_topics(workspace_id,map_id,topic_key);

CREATE TABLE signal_mass_labeling_localizations (
 workspace_id uuid NOT NULL, map_id uuid NOT NULL, topic_key text NOT NULL,
 localization jsonb NOT NULL CHECK(jsonb_typeof(localization)='object'),
 created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(map_id,topic_key),
 FOREIGN KEY(workspace_id,map_id,topic_key) REFERENCES signal_mass_labeling_topics(workspace_id,map_id,topic_key)
);
CREATE TABLE signal_mass_labeling_r13_results (
 workspace_id uuid NOT NULL, map_id uuid NOT NULL, root_id uuid NOT NULL,
 input_digest text NOT NULL CHECK(input_digest ~ '^sha256:[0-9a-f]{64}$'),
 trigger_barrier jsonb NOT NULL CHECK(jsonb_typeof(trigger_barrier)='object'),
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
 response_digest text NOT NULL CHECK(response_digest ~ '^sha256:[0-9a-f]{64}$'),
 usage jsonb NOT NULL CHECK(jsonb_typeof(usage)='object'),
 created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(map_id,root_id),
 FOREIGN KEY(workspace_id,map_id,root_id) REFERENCES signal_mass_labeling_items(workspace_id,map_id,root_id)
);
CREATE TABLE signal_mass_labeling_r13_interests (
 workspace_id uuid NOT NULL, map_id uuid NOT NULL, interest_key text NOT NULL CHECK(interest_key ~ '^[a-z][a-z0-9_]{0,119}$'),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160), definition text NOT NULL CHECK(length(definition) BETWEEN 1 AND 1200),
 localization jsonb CHECK(localization IS NULL OR jsonb_typeof(localization)='object'),
 created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(map_id,interest_key), UNIQUE(workspace_id,map_id,interest_key),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id)
);
CREATE TABLE signal_mass_labeling_r13_interest_results (
 workspace_id uuid NOT NULL, map_id uuid NOT NULL, interest_key text NOT NULL, root_id uuid NOT NULL,
 input_digest text NOT NULL CHECK(input_digest ~ '^sha256:[0-9a-f]{64}$'),
 probability double precision NOT NULL CHECK(probability BETWEEN 0 AND 1),
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
 response_digest text NOT NULL CHECK(response_digest ~ '^sha256:[0-9a-f]{64}$'),
 usage jsonb NOT NULL CHECK(jsonb_typeof(usage)='object'),
 created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(map_id,interest_key,root_id),
 FOREIGN KEY(workspace_id,map_id,root_id) REFERENCES signal_mass_labeling_items(workspace_id,map_id,root_id),
 FOREIGN KEY(workspace_id,map_id,interest_key) REFERENCES signal_mass_labeling_r13_interests(workspace_id,map_id,interest_key)
);

CREATE INDEX signal_mass_labeling_r13_interest_positive_root ON signal_mass_labeling_r13_interest_results(workspace_id,map_id,root_id) WHERE probability>0.7;

-- PG17 supplies pg_c_utf8. PG16 smoke databases use an ICU or UTF-8 libc
-- collation. Resolve Unicode support once at installation, keeping row reads static.
-- PG17 is canonical. Older ICU classes can omit isolated Alphabetic combining marks.
DO $install$
DECLARE candidate record; unicode_collation text; supports_unicode boolean;
BEGIN
 FOR candidate IN SELECT c.collname FROM pg_catalog.pg_collation c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace
  WHERE n.nspname='pg_catalog' AND (c.collname IN('pg_c_utf8','und-x-icu','unicode','default')
   OR c.collprovider='i' OR lower(COALESCE(c.collctype,'')) LIKE '%utf%8%')
  ORDER BY CASE c.collname WHEN 'pg_c_utf8' THEN 0 WHEN 'und-x-icu' THEN 1 WHEN 'unicode' THEN 2
   WHEN 'default' THEN 3 ELSE 4 END,c.collname LOOP
  EXECUTE format('SELECT %L COLLATE %I ~ %L','açãoé中',candidate.collname,'^[[:alpha:]]+$')
   INTO supports_unicode;
  IF supports_unicode THEN unicode_collation:=candidate.collname; EXIT; END IF;
 END LOOP;
 IF unicode_collation IS NULL THEN
  RAISE EXCEPTION 'r13_unicode_collation_unavailable' USING ERRCODE='23514';
 END IF;
 EXECUTE format($create$
 CREATE FUNCTION signal_mass_labeling_r13_hashtags_v1(body text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT COALESCE(body COLLATE %1$I ~ '#[[:alpha:]0-9_]+',false) AND strpos(COALESCE(body,''),chr(133))=0 AND
   replace(regexp_replace(regexp_replace(COALESCE(body,'') COLLATE %1$I,'#[[:alpha:]0-9_]+','','g'),
    '[[:space:].,;:!?()\[\]{}''"“”‘’«»…—–-]+','','g'),chr(65279),'')=''
 $fn$;
 $create$,unicode_collation);
END $install$;
CREATE FUNCTION signal_mass_labeling_r13_segment_v1(body text,probabilities jsonb) RETURNS text
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_catalog AS $$
 SELECT CASE WHEN signal_mass_labeling_r13_hashtags_v1(body) THEN 'hashtags'
  WHEN (probabilities#>>'{promotion,noul}')::double precision>0.7 THEN 'advertising' ELSE 'conversation' END
$$;
CREATE FUNCTION guard_signal_mass_labeling_r13_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE data jsonb:=to_jsonb(NEW); answer jsonb; p double precision; total double precision:=0; field text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'r13_receipt_immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN('signal_mass_labeling_r13_results','signal_mass_labeling_r13_interest_results') AND NOT EXISTS(
  SELECT 1 FROM signal_mass_labeling_items item WHERE item.workspace_id=NEW.workspace_id AND item.map_id=NEW.map_id
   AND item.root_id=(to_jsonb(NEW)->>'root_id')::uuid AND item.input_digest=to_jsonb(NEW)->>'input_digest') THEN
  RAISE EXCEPTION 'r13_input_changed' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME IN('signal_mass_labeling_r13_results','signal_mass_labeling_r13_interest_results') THEN
  IF NOT COALESCE(data#>>'{usage,input_tokens}' ~ '^[0-9]+$' AND data#>>'{usage,output_tokens}' ~ '^[0-9]+$',false) THEN
   RAISE EXCEPTION 'r13_usage_invalid' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='signal_mass_labeling_localizations' THEN
  IF NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps map CROSS JOIN LATERAL jsonb_array_elements(map.catalog) topic
    WHERE map.workspace_id=NEW.workspace_id AND map.id=NEW.map_id AND topic->>'topic_key'=data->>'topic_key'
      AND topic->>'name'=data#>>'{localization,original,name}' AND topic->>'definition'=data#>>'{localization,original,definition}') THEN
   RAISE EXCEPTION 'r13_original_changed' USING ERRCODE='23514';
  END IF;
  FOREACH field IN ARRAY ARRAY['original','en','es'] LOOP
   IF NOT COALESCE(length(btrim(data->'localization'->field->>'name')) BETWEEN 1 AND 160
    AND length(btrim(data->'localization'->field->>'definition')) BETWEEN 1 AND 1200,false) THEN
    RAISE EXCEPTION 'r13_translation_invalid' USING ERRCODE='23514';
   END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='signal_mass_labeling_r13_results' THEN
  answer:=data->'trigger_barrier';
  IF NOT COALESCE(answer->>'type'='choice' AND answer->>'choice' IN('trigger','barrier','none')
    AND jsonb_typeof(answer->'confidence')='number' AND (answer->>'confidence')::double precision BETWEEN 0 AND 1
    AND jsonb_typeof(answer->'probabilities')='object',false) THEN
   RAISE EXCEPTION 'r13_answer_invalid' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(answer->'probabilities'))<>3 THEN
   RAISE EXCEPTION 'r13_answer_invalid' USING ERRCODE='23514';
  END IF;
  FOREACH field IN ARRAY ARRAY['trigger','barrier','none'] LOOP
   IF jsonb_typeof(answer->'probabilities'->field) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'r13_answer_invalid' USING ERRCODE='23514';
   END IF;
   p:=(answer->'probabilities'->>field)::double precision;
   IF p<0 OR p>1 THEN RAISE EXCEPTION 'r13_answer_invalid' USING ERRCODE='23514'; END IF;
   total:=total+p;
  END LOOP;
  IF abs(total-1)>.010000000001 THEN RAISE EXCEPTION 'r13_answer_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE object_name text; role_name text; BEGIN
 FOREACH object_name IN ARRAY ARRAY['signal_mass_labeling_localizations','signal_mass_labeling_r13_results',
  'signal_mass_labeling_r13_interests','signal_mass_labeling_r13_interest_results'] LOOP
  EXECUTE format('CREATE TRIGGER r13_immutable BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_signal_mass_labeling_r13_v1()',object_name);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',object_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',object_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',object_name,role_name); END IF;
  END LOOP;
 END LOOP;
 REVOKE ALL ON FUNCTION guard_signal_mass_labeling_r13_v1() FROM PUBLIC;
END $$;
