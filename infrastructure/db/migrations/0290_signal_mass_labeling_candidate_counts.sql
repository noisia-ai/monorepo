-- Candidate arrays are immutable. Store their cardinality beside the root's
-- derived segment so coverage checks do not decompress every frozen request.
ALTER TABLE signal_mass_labeling_root_segments ADD COLUMN candidate_count smallint
 CHECK(candidate_count BETWEEN 1 AND 8);
UPDATE signal_mass_labeling_root_segments segment SET candidate_count=jsonb_array_length(item.candidates)
 FROM signal_mass_labeling_items item WHERE item.workspace_id=segment.workspace_id
  AND item.map_id=segment.map_id AND item.root_id=segment.root_id;
ALTER TABLE signal_mass_labeling_root_segments ALTER COLUMN candidate_count SET NOT NULL;

CREATE OR REPLACE FUNCTION materialize_signal_mass_labeling_serving_items_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 INSERT INTO signal_mass_labeling_root_segments(workspace_id,map_id,root_id,hashtag_only,candidate_count)
 SELECT item.workspace_id,item.map_id,item.root_id,signal_mass_labeling_r13_hashtags_v1(mention.text_clean),jsonb_array_length(item.candidates)
 FROM serving_items item JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id;
 INSERT INTO signal_mass_labeling_topic_probabilities(workspace_id,map_id,root_id,concept_key,candidate_ordinal)
 SELECT item.workspace_id,item.map_id,item.root_id,candidate.value->>'topic_key',candidate.ordinality-1
 FROM serving_items item CROSS JOIN LATERAL jsonb_array_elements(item.candidates) WITH ORDINALITY candidate(value,ordinality);
 RETURN NULL;
END $$;
ANALYZE signal_mass_labeling_root_segments;
