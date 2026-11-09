-- Derived serving data follows the existing immutable map and paid receipts.
-- Current licensing, selections, study policy and human overrides remain live.
CREATE TABLE signal_mass_labeling_root_segments (
 workspace_id uuid NOT NULL,map_id uuid NOT NULL,root_id uuid NOT NULL,
 hashtag_only boolean NOT NULL,
 promotion_probability double precision CHECK(promotion_probability BETWEEN 0 AND 1),
 conversation_segment text GENERATED ALWAYS AS(CASE WHEN hashtag_only THEN 'hashtags'
   WHEN promotion_probability>0.7 THEN 'advertising' ELSE 'conversation' END) STORED,
 PRIMARY KEY(map_id,root_id),
 FOREIGN KEY(workspace_id,map_id,root_id) REFERENCES signal_mass_labeling_items(workspace_id,map_id,root_id)
);
CREATE TABLE signal_mass_labeling_topic_probabilities (
 workspace_id uuid NOT NULL,map_id uuid NOT NULL,root_id uuid NOT NULL,concept_key text NOT NULL,
 candidate_ordinal bigint CHECK(candidate_ordinal BETWEEN 0 AND 7),
 probability double precision CHECK(probability BETWEEN 0 AND 1),
 PRIMARY KEY(map_id,root_id,concept_key),
 FOREIGN KEY(workspace_id,map_id,root_id) REFERENCES signal_mass_labeling_items(workspace_id,map_id,root_id),
 FOREIGN KEY(workspace_id,map_id,concept_key) REFERENCES signal_mass_labeling_topics(workspace_id,map_id,topic_key)
);
DO $$ DECLARE table_name text;role_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['signal_mass_labeling_root_segments','signal_mass_labeling_topic_probabilities'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',table_name,role_name); END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION materialize_signal_mass_labeling_serving_items_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 INSERT INTO signal_mass_labeling_root_segments(workspace_id,map_id,root_id,hashtag_only)
 SELECT item.workspace_id,item.map_id,item.root_id,signal_mass_labeling_r13_hashtags_v1(mention.text_clean)
 FROM serving_items item JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id;
 INSERT INTO signal_mass_labeling_topic_probabilities(workspace_id,map_id,root_id,concept_key,candidate_ordinal)
 SELECT item.workspace_id,item.map_id,item.root_id,candidate.value->>'topic_key',candidate.ordinality-1
 FROM serving_items item CROSS JOIN LATERAL jsonb_array_elements(item.candidates) WITH ORDINALITY candidate(value,ordinality);
 RETURN NULL;
END $$;
CREATE TRIGGER mass_labeling_serving_items AFTER INSERT ON signal_mass_labeling_items
 REFERENCING NEW TABLE AS serving_items FOR EACH STATEMENT EXECUTE FUNCTION materialize_signal_mass_labeling_serving_items_v1();

CREATE FUNCTION materialize_signal_mass_labeling_serving_results_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_mass_labeling_root_segments segment SET promotion_probability=(outcome.probabilities#>>'{promotion,noul}')::double precision
 FROM serving_results outcome WHERE segment.map_id=outcome.map_id AND segment.root_id=outcome.root_id AND segment.workspace_id=outcome.workspace_id;
 WITH requested AS MATERIALIZED (
  SELECT result.map_id,result.root_id,candidate.value->>'topic_key' concept_key,candidate.ordinality-1 candidate_ordinal
  FROM serving_results result JOIN signal_labeling_calls receipt ON receipt.id=result.call_id AND receipt.workspace_id=result.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements(receipt.inputs->0->'candidates') WITH ORDINALITY candidate(value,ordinality)
 ), incoming AS (
  SELECT pair.map_id,pair.root_id,pair.concept_key,requested.candidate_ordinal,
    CASE WHEN result.status IN('labeled','abstained') THEN
     (result.probabilities->('topic_'||requested.candidate_ordinal::text)->>'noul')::double precision END probability
  FROM serving_results result JOIN signal_mass_labeling_topic_probabilities pair ON pair.map_id=result.map_id AND pair.root_id=result.root_id
  LEFT JOIN requested ON requested.map_id=pair.map_id AND requested.root_id=pair.root_id AND requested.concept_key=pair.concept_key
 ) UPDATE signal_mass_labeling_topic_probabilities pair SET candidate_ordinal=incoming.candidate_ordinal,probability=incoming.probability
 FROM incoming WHERE pair.map_id=incoming.map_id AND pair.root_id=incoming.root_id AND pair.concept_key=incoming.concept_key;
 RETURN NULL;
END $$;
CREATE TRIGGER mass_labeling_serving_results AFTER INSERT ON signal_mass_labeling_results
 REFERENCING NEW TABLE AS serving_results FOR EACH STATEMENT EXECUTE FUNCTION materialize_signal_mass_labeling_serving_results_v1();

CREATE FUNCTION refresh_signal_mass_labeling_serving_text_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.text_clean IS DISTINCT FROM OLD.text_clean THEN
  UPDATE signal_mass_labeling_root_segments SET hashtag_only=signal_mass_labeling_r13_hashtags_v1(NEW.text_clean)
  WHERE workspace_id=NEW.workspace_id AND root_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_serving_text AFTER UPDATE OF text_clean ON mentions
 FOR EACH ROW EXECUTE FUNCTION refresh_signal_mass_labeling_serving_text_v1();
REVOKE ALL ON FUNCTION materialize_signal_mass_labeling_serving_items_v1(),
 materialize_signal_mass_labeling_serving_results_v1(),refresh_signal_mass_labeling_serving_text_v1() FROM PUBLIC;

-- Restore-time backfill is bounded to the existing mass-labeling items. Request
-- candidates are expanded once per settled root, preserving unasked NULLs.
INSERT INTO signal_mass_labeling_root_segments(workspace_id,map_id,root_id,hashtag_only,promotion_probability)
 SELECT item.workspace_id,item.map_id,item.root_id,signal_mass_labeling_r13_hashtags_v1(mention.text_clean),
   (result.probabilities#>>'{promotion,noul}')::double precision
 FROM signal_mass_labeling_items item JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
 LEFT JOIN signal_mass_labeling_results result ON result.map_id=item.map_id AND result.root_id=item.root_id;
WITH requested AS MATERIALIZED (
 SELECT result.map_id,result.root_id,candidate.value->>'topic_key' concept_key,candidate.ordinality-1 candidate_ordinal
 FROM signal_mass_labeling_results result JOIN signal_labeling_calls receipt ON receipt.id=result.call_id AND receipt.workspace_id=result.workspace_id
 CROSS JOIN LATERAL jsonb_array_elements(receipt.inputs->0->'candidates') WITH ORDINALITY candidate(value,ordinality)
) INSERT INTO signal_mass_labeling_topic_probabilities(workspace_id,map_id,root_id,concept_key,candidate_ordinal,probability)
 SELECT item.workspace_id,item.map_id,item.root_id,candidate.value->>'topic_key',
   CASE WHEN result.call_id IS NULL THEN candidate.ordinality-1 ELSE requested.candidate_ordinal END,
   CASE WHEN result.status IN('labeled','abstained') THEN
    (result.probabilities->('topic_'||requested.candidate_ordinal::text)->>'noul')::double precision END
 FROM signal_mass_labeling_items item
 CROSS JOIN LATERAL jsonb_array_elements(item.candidates) WITH ORDINALITY candidate(value,ordinality)
 LEFT JOIN signal_mass_labeling_results result ON result.map_id=item.map_id AND result.root_id=item.root_id
 LEFT JOIN requested ON requested.map_id=item.map_id AND requested.root_id=item.root_id AND requested.concept_key=candidate.value->>'topic_key';
CREATE INDEX mass_labeling_topic_positive ON signal_mass_labeling_topic_probabilities(workspace_id,map_id,root_id,concept_key) INCLUDE(probability) WHERE probability>0.7;
CREATE INDEX mass_labeling_segment_root ON signal_mass_labeling_root_segments(workspace_id,map_id,conversation_segment,root_id);

-- Expose the same nullable membership contract, with the latest human decision
-- applied at read time, including decisions for an unasked catalog concept.
CREATE OR REPLACE VIEW signal_mass_labeling_memberships_v1 AS
 WITH latest AS NOT MATERIALIZED (
  SELECT DISTINCT ON(map_id,root_id,topic_key) workspace_id,map_id,root_id,topic_key,id,belongs
  FROM signal_mass_labeling_overrides ORDER BY map_id,root_id,topic_key,created_at DESC,id DESC
 ) SELECT pair.workspace_id,pair.map_id,pair.root_id,pair.concept_key,topic.definition_digest,pair.candidate_ordinal,
   pair.probability>0.7 belongs,pair.probability,NULL::uuid override_id
 FROM signal_mass_labeling_topic_probabilities pair
 JOIN signal_mass_labeling_topics topic ON topic.map_id=pair.map_id AND topic.topic_key=pair.concept_key
 WHERE NOT EXISTS(SELECT 1 FROM latest override
   WHERE override.map_id=pair.map_id AND override.root_id=pair.root_id AND override.topic_key=pair.concept_key)
 UNION ALL
 SELECT override.workspace_id,override.map_id,override.root_id,override.topic_key,topic.definition_digest,pair.candidate_ordinal,
   override.belongs,1::double precision,override.id
 FROM latest override JOIN signal_mass_labeling_topics topic ON topic.map_id=override.map_id AND topic.topic_key=override.topic_key
 LEFT JOIN signal_mass_labeling_topic_probabilities pair
   ON pair.map_id=override.map_id AND pair.root_id=override.root_id AND pair.concept_key=override.topic_key;
ANALYZE signal_mass_labeling_root_segments;
ANALYZE signal_mass_labeling_topic_probabilities;
