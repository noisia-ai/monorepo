-- Frozen local discovery bindings and subsets; no provider, policy or spend is created.
CREATE TABLE signal_listening_discovery_generations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,configuration_id uuid NOT NULL,map_id uuid NOT NULL,
 preparation_run_id uuid NOT NULL,input_revision bigint NOT NULL,embedding_config_digest text NOT NULL,entity_context_digest text NOT NULL,
 configuration_digest text NOT NULL,round integer NOT NULL CHECK(round BETWEEN 0 AND 3),
 kind text NOT NULL CHECK(kind IN('legacy_seed','source_seed','confirmed_members')),
 source_generation_id uuid REFERENCES signal_listening_discovery_generations(id),
 status text NOT NULL DEFAULT 'building' CHECK(status IN('building','ready')),counts jsonb,snapshot_digest text,
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(id,configuration_id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 CHECK((kind='legacy_seed')=(round=0)),CHECK((kind='legacy_seed')=(source_generation_id IS NULL)),CHECK(status<>'ready' OR counts IS NOT NULL AND snapshot_digest~'^sha256:[0-9a-f]{64}$')
);
CREATE INDEX signal_listening_discovery_current ON signal_listening_discovery_generations(workspace_id,configuration_id,map_id,created_at DESC,id DESC) WHERE status='ready';
CREATE TABLE signal_listening_discovery_manual(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,configuration_id uuid NOT NULL,map_id uuid NOT NULL,
 question_key text NOT NULL,question_digest text NOT NULL,root_id uuid NOT NULL,input_digest text NOT NULL,entity_context_digest text NOT NULL,
 belongs boolean NOT NULL,source_override_id uuid REFERENCES signal_mass_labeling_overrides(id),created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,configuration_id,question_key) REFERENCES signal_listening_questions(workspace_id,configuration_id,question_key),
 FOREIGN KEY(map_id,root_id) REFERENCES signal_mass_labeling_items(map_id,root_id)
);
CREATE INDEX signal_listening_discovery_manual_latest ON signal_listening_discovery_manual(workspace_id,root_id,input_digest,entity_context_digest,question_digest,created_at DESC,id DESC);
CREATE TABLE signal_listening_discovery_topics(
 generation_id uuid NOT NULL,workspace_id uuid NOT NULL,configuration_id uuid NOT NULL,question_key text NOT NULL,question_digest text NOT NULL,
 kind text NOT NULL CHECK(kind IN('legacy_seed','source_seed','confirmed_members')),
 source_map_id uuid,source_topic_key text,centroid vector(1024),centroid_sha256 text,
 lineage jsonb NOT NULL,member_count integer NOT NULL DEFAULT 0 CHECK(member_count>=0),
 PRIMARY KEY(generation_id,question_key),FOREIGN KEY(workspace_id,generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(generation_id,configuration_id) REFERENCES signal_listening_discovery_generations(id,configuration_id),
 FOREIGN KEY(workspace_id,configuration_id,question_key) REFERENCES signal_listening_questions(workspace_id,configuration_id,question_key),
 FOREIGN KEY(source_map_id,source_topic_key) REFERENCES signal_mass_labeling_topics(map_id,topic_key),
 CHECK(kind='legacy_seed' AND source_map_id IS NOT NULL AND source_topic_key IS NOT NULL OR kind<>'legacy_seed' AND source_map_id IS NULL AND source_topic_key IS NULL),
 CHECK((centroid IS NULL)=(centroid_sha256 IS NULL))
);
CREATE TABLE signal_listening_discovery_roots(
 generation_id uuid NOT NULL,workspace_id uuid NOT NULL,root_id uuid NOT NULL,proof jsonb NOT NULL,proof_digest text NOT NULL,
 PRIMARY KEY(generation_id,root_id),UNIQUE(workspace_id,generation_id,root_id),
 FOREIGN KEY(workspace_id,generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,root_id) REFERENCES mentions(workspace_id,id)
);
CREATE TABLE signal_listening_discovery_subsets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,generation_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'building' CHECK(status IN('building','ready')),root_count integer,cached_count integer,subset_digest text,
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workspace_id,id),UNIQUE(id,generation_id),
 FOREIGN KEY(workspace_id,generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 CHECK(status<>'ready' OR root_count>=0 AND cached_count BETWEEN 0 AND root_count AND subset_digest~'^sha256:[0-9a-f]{64}$')
);
CREATE TABLE signal_listening_discovery_subset_roots(
 subset_id uuid NOT NULL,generation_id uuid NOT NULL,root_id uuid NOT NULL,proof_digest text NOT NULL,
 PRIMARY KEY(subset_id,root_id),FOREIGN KEY(subset_id,generation_id) REFERENCES signal_listening_discovery_subsets(id,generation_id),
 FOREIGN KEY(generation_id,root_id) REFERENCES signal_listening_discovery_roots(generation_id,root_id)
);
CREATE TABLE signal_listening_discovery_members(
 generation_id uuid NOT NULL,workspace_id uuid NOT NULL,question_key text NOT NULL,root_id uuid NOT NULL,
 evidence jsonb NOT NULL,PRIMARY KEY(generation_id,question_key,root_id),
 FOREIGN KEY(generation_id,question_key) REFERENCES signal_listening_discovery_topics(generation_id,question_key),
 FOREIGN KEY(workspace_id,generation_id,root_id) REFERENCES signal_listening_discovery_roots(workspace_id,generation_id,root_id)
);

CREATE FUNCTION signal_listening_discovery_candidates_v1(w uuid,cid uuid,mid uuid,root uuid,explicit_generation uuid DEFAULT NULL) RETURNS text[] LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 WITH generation AS MATERIALIZED(
  SELECT latest.* FROM LATERAL(SELECT g.* FROM signal_listening_discovery_generations g WHERE g.workspace_id=w AND g.configuration_id=cid AND g.map_id=mid AND g.status='ready'
   ORDER BY g.created_at DESC,g.id DESC LIMIT 1) latest WHERE explicit_generation IS NULL
  UNION ALL
  SELECT g.* FROM signal_listening_discovery_generations g WHERE explicit_generation IS NOT NULL AND g.id=explicit_generation AND g.workspace_id=w AND g.configuration_id=cid AND g.map_id=mid)

 SELECT CASE WHEN EXISTS(SELECT 1 FROM generation) THEN ARRAY(
  SELECT t.question_key FROM generation g JOIN signal_listening_discovery_topics t ON t.generation_id=g.id AND t.workspace_id=w
  LEFT JOIN signal_listening_discovery_topics previous ON previous.generation_id=g.source_generation_id AND previous.question_key=t.question_key AND previous.question_digest=t.question_digest
  JOIN signal_mass_labeling_items i ON i.workspace_id=w AND i.map_id=mid AND i.root_id=root
  JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=w AND e.config_digest=g.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
  JOIN signal_workspace_embedding_calls receipt ON receipt.workspace_id=w AND receipt.id=e.call_id AND receipt.status='settled' AND vector_norm(e.embedding)>0
  WHERE (CASE WHEN g.kind='confirmed_members' THEN COALESCE(t.centroid,previous.centroid) ELSE t.centroid END) IS NOT NULL
   AND vector_norm(CASE WHEN g.kind='confirmed_members' THEN COALESCE(t.centroid,previous.centroid) ELSE t.centroid END)>0
  ORDER BY (CASE WHEN g.kind='confirmed_members' THEN COALESCE(t.centroid,previous.centroid) ELSE t.centroid END)<=>e.embedding,t.question_key LIMIT 4)
 ELSE NULL END
$$;

-- Complete per-root immutable source proof. The H2 selector is bounded before rights/vector work.
CREATE FUNCTION signal_listening_discovery_root_proofs_v1(target uuid,roots uuid[]) RETURNS TABLE(root_id uuid,proof jsonb) LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 WITH generation AS MATERIALIZED(SELECT g.*,c.configuration FROM signal_listening_discovery_generations g JOIN signal_listening_configurations c
  ON c.id=g.configuration_id AND c.workspace_id=g.workspace_id WHERE g.id=target),
 population AS MATERIALIZED(SELECT p.*,g.id generation_id,g.workspace_id,g.embedding_config_digest,g.configuration,g.entity_context_digest
  FROM generation g CROSS JOIN LATERAL signal_listening_population_roots_v1(g.workspace_id,g.configuration_id,g.map_id,g.entity_context_digest,roots,'llm-processing') p),
 root_candidates AS MATERIALIZED(SELECT roots.root_id,signal_listening_discovery_candidates_v1(g.workspace_id,g.configuration_id,g.map_id,roots.root_id,target) keys FROM (SELECT DISTINCT root_id FROM population) roots CROSS JOIN generation g),
 evaluated AS(SELECT p.*,manual.id manual_id,COALESCE(CASE WHEN manual.id IS NOT NULL THEN CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END END,(p.answer->>'noul')::double precision) probability,
  CASE WHEN p.definition->>'topic_source'='discovered' THEN
   COALESCE(p.question_key=ANY(candidates.keys),p.candidate)
   OR manual.id IS NOT NULL ELSE p.candidate END effective_candidate
  FROM population p JOIN root_candidates candidates ON candidates.root_id=p.root_id LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=p.workspace_id AND d.root_id=p.root_id
   AND d.input_digest=p.input_digest AND d.entity_context_digest=p.entity_context_digest AND d.question_digest=p.question_digest ORDER BY d.created_at DESC,d.id DESC LIMIT 1) manual ON true),
 grouped AS(SELECT p.root_id,max(p.input_digest) input_digest,max(p.body) body,
  max(p.answer->>'choice') FILTER(WHERE p.question_key='voice') voice,
  max((p.answer->>'noul')::double precision) FILTER(WHERE p.question_key='promotion') promotion,
  COALESCE(jsonb_agg(jsonb_build_object('question_key',p.question_key,'question_digest',p.question_digest,'probability',p.probability,
   'call_id',CASE WHEN p.manual_id IS NULL THEN p.cache_call_id ELSE NULL END,'manual_id',p.manual_id) ORDER BY p.question_key)
    FILTER(WHERE p.definition ? 'topic_source' AND p.effective_candidate AND p.scope_state='included'),'[]'::jsonb) evaluations
  FROM evaluated p GROUP BY p.root_id)
 SELECT r.root_id,jsonb_build_object('input_digest',r.input_digest,'source_text_sha256','sha256:'||encode(sha256(convert_to(r.body,'UTF8')),'hex'),
  'chunk_sha256',i.chunk_sha256,'embedding_call_id',receipt.id,'embedding_sha256',CASE WHEN receipt.id IS NOT NULL THEN 'sha256:'||encode(sha256(convert_to(e.embedding::text,'UTF8')),'hex') END,
  'in_category',CASE WHEN r.voice IS NULL OR r.promotion IS NULL THEN NULL ELSE r.voice='individual' AND r.promotion<=0.7
   AND NOT signal_mass_labeling_r13_hashtags_v1(r.body) AND signal_mass_labeling_category_matches_v1(r.body,ARRAY(SELECT jsonb_array_elements_text(g.configuration->'lexicon_terms'))) END,
  'pending_base',r.voice IS NULL OR r.promotion IS NULL,'evaluations',r.evaluations)
 FROM grouped r CROSS JOIN generation g JOIN signal_mass_labeling_items i ON i.workspace_id=g.workspace_id AND i.map_id=g.map_id AND i.root_id=r.root_id
 LEFT JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=g.workspace_id AND e.config_digest=g.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
 LEFT JOIN signal_workspace_embedding_calls receipt ON receipt.workspace_id=g.workspace_id AND receipt.id=e.call_id AND receipt.status='settled' AND vector_norm(e.embedding)>0
$$;

CREATE FUNCTION signal_listening_discovery_centroid_v1(target uuid,qkey text) RETURNS vector LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT CASE WHEN vector_norm(avg(l2_normalize(e.embedding) ORDER BY m.root_id))>1e-12 THEN l2_normalize(avg(l2_normalize(e.embedding) ORDER BY m.root_id)) END
 FROM signal_listening_discovery_members m JOIN signal_listening_discovery_generations g ON g.id=m.generation_id AND g.workspace_id=m.workspace_id
 JOIN signal_listening_discovery_roots r ON r.generation_id=g.id AND r.root_id=m.root_id
 JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=g.workspace_id AND e.config_digest=g.embedding_config_digest AND e.chunk_sha256=r.proof->>'chunk_sha256'
 WHERE m.generation_id=target AND m.question_key=qkey AND e.call_id::text=r.proof->>'embedding_call_id'
$$;
CREATE FUNCTION signal_listening_discovery_counts_v1(target uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('map_roots',(SELECT m.root_count FROM signal_listening_discovery_generations g JOIN signal_mass_labeling_maps m ON m.id=g.map_id WHERE g.id=target),'roots',count(*),'cached_vectors',count(*) FILTER(WHERE proof->>'embedding_call_id' IS NOT NULL),
  'category_roots',count(*) FILTER(WHERE proof->'in_category'='true'::jsonb),'pending_base',count(*) FILTER(WHERE proof->'pending_base'='true'::jsonb),
  'pending_topics',count(*) FILTER(WHERE jsonb_array_length(proof->'evaluations')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'evaluations') e WHERE e->>'probability' IS NULL)),
  'topics',(SELECT count(*) FROM signal_listening_discovery_topics WHERE generation_id=target)) FROM signal_listening_discovery_roots WHERE generation_id=target
$$;
CREATE FUNCTION signal_listening_discovery_digest_v1(target uuid) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(jsonb_build_object('generation_id',g.id,'workspace_id',g.workspace_id,'configuration_digest',g.configuration_digest,
  'map_id',g.map_id,'preparation_run_id',g.preparation_run_id,'input_revision',g.input_revision,'embedding_config_digest',g.embedding_config_digest,
  'entity_context_digest',g.entity_context_digest,'round',g.round,'kind',g.kind,
  'roots',(SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(root_id::text||':'||proof_digest,',' ORDER BY root_id),''),'UTF8')),'hex') FROM signal_listening_discovery_roots WHERE generation_id=g.id),
  'members',(SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(question_key||':'||root_id::text||':'||signal_labeling_digest_v1(evidence),',' ORDER BY question_key,root_id),''),'UTF8')),'hex') FROM signal_listening_discovery_members WHERE generation_id=g.id),
  'topics',(SELECT jsonb_agg(jsonb_build_array(question_key,question_digest,kind,centroid_sha256,lineage,member_count) ORDER BY question_key) FROM signal_listening_discovery_topics WHERE generation_id=g.id)))
 FROM signal_listening_discovery_generations g WHERE g.id=target
$$;
CREATE FUNCTION signal_listening_discovery_generation_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE map signal_mass_labeling_maps;cfg signal_listening_configurations;source signal_listening_discovery_generations;topic signal_listening_discovery_topics;expected_roots uuid[];actual_roots uuid[];
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND (OLD.status<>'building' OR NEW.status<>'ready' OR
  (to_jsonb(NEW)-ARRAY['status','counts','snapshot_digest']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','counts','snapshot_digest'])) THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 SELECT * INTO map FROM signal_mass_labeling_maps WHERE id=NEW.map_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO cfg FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id AND state='published';
 IF cfg.id IS NULL OR map.id IS NULL OR ROW(NEW.preparation_run_id,NEW.input_revision,NEW.embedding_config_digest,NEW.entity_context_digest,NEW.configuration_digest)
  IS DISTINCT FROM ROW(map.preparation_run_id,map.input_revision,map.embedding_config_digest,map.entity_context_digest,cfg.configuration_digest)
  OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling') THEN RAISE EXCEPTION 'listening_discovery_scope_invalid';END IF;
 IF NEW.source_generation_id IS NOT NULL THEN
  SELECT * INTO source FROM signal_listening_discovery_generations WHERE id=NEW.source_generation_id AND status='ready';
  IF source.id IS NULL OR ROW(source.workspace_id,source.map_id,source.preparation_run_id,source.input_revision,source.embedding_config_digest,source.entity_context_digest)
   IS DISTINCT FROM ROW(NEW.workspace_id,NEW.map_id,NEW.preparation_run_id,NEW.input_revision,NEW.embedding_config_digest,NEW.entity_context_digest)
   THEN RAISE EXCEPTION 'listening_discovery_source_invalid';END IF;
 END IF;
 IF TG_OP='INSERT' AND(NEW.status<>'building' OR NEW.counts IS NOT NULL OR NEW.snapshot_digest IS NOT NULL) THEN RAISE EXCEPTION 'listening_discovery_must_build';END IF;
 IF TG_OP='UPDATE' AND(NEW.counts IS DISTINCT FROM signal_listening_discovery_counts_v1(NEW.id)
   OR (NEW.counts->>'roots')::integer<>(SELECT count(*) FROM signal_mass_labeling_items i JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id WHERE i.workspace_id=NEW.workspace_id AND i.map_id=NEW.map_id AND m.canonical_mention_id=m.id AND m.inclusion_status='included' AND signal_listening_root_right_v1(NEW.workspace_id,i.root_id,'llm-processing'))
   OR NEW.snapshot_digest IS DISTINCT FROM signal_listening_discovery_digest_v1(NEW.id)
   OR (SELECT count(*) FROM signal_listening_discovery_topics WHERE generation_id=NEW.id)<>(SELECT count(*) FROM signal_listening_questions WHERE configuration_id=NEW.configuration_id AND definition->>'topic_source'='discovered'))
  THEN RAISE EXCEPTION 'listening_discovery_snapshot_incomplete';END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM signal_listening_discovery_topics t WHERE t.generation_id=NEW.id AND (t.kind='source_seed' AND t.member_count=0 OR t.kind='confirmed_members' AND t.member_count<>(SELECT count(*) FROM signal_listening_discovery_roots r CROSS JOIN LATERAL jsonb_array_elements(r.proof->'evaluations') e WHERE r.generation_id=NEW.id AND r.proof->>'embedding_call_id' IS NOT NULL AND e->>'question_key'=t.question_key AND e->>'question_digest'=t.question_digest AND (e->>'probability')::double precision>=0.7))) THEN RAISE EXCEPTION 'listening_discovery_members_incomplete';END IF;
 IF TG_OP='UPDATE' THEN
  FOR topic IN SELECT * FROM signal_listening_discovery_topics WHERE generation_id=NEW.id AND kind='source_seed' LOOP
   SELECT ARRAY(SELECT root_id FROM(SELECT member.root_id FROM signal_listening_discovery_members member WHERE member.generation_id=NEW.source_generation_id AND member.question_key IN(SELECT jsonb_array_elements_text(topic.lineage->'source_topic_keys')) AND member.evidence->>'kind' IN('jev','manual')
    UNION SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(topic.lineage->'orphan_root_ids','[]'::jsonb))) expected ORDER BY root_id) INTO expected_roots;
   SELECT ARRAY(SELECT root_id FROM signal_listening_discovery_members WHERE generation_id=NEW.id AND question_key=topic.question_key ORDER BY root_id) INTO actual_roots;
   IF expected_roots IS DISTINCT FROM actual_roots THEN RAISE EXCEPTION 'listening_discovery_seed_members_incomplete';END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_generation_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_generations FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_generation_guard_v1();
CREATE FUNCTION signal_listening_discovery_build_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_listening_discovery_generations WHERE id=NEW.id AND status='ready') THEN RAISE EXCEPTION 'listening_discovery_unsealed';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_discovery_build_complete AFTER INSERT ON signal_listening_discovery_generations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_build_complete_v1();
CREATE FUNCTION signal_listening_discovery_topic_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE g signal_listening_discovery_generations;q signal_listening_questions;legacy signal_mass_labeling_topics;expected vector;
BEGIN
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id;
 IF TG_OP='DELETE' OR g.status IS DISTINCT FROM 'building' THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 SELECT * INTO q FROM signal_listening_questions WHERE configuration_id=g.configuration_id AND question_key=NEW.question_key AND workspace_id=g.workspace_id;
 IF q.question_key IS NULL OR q.definition->>'topic_source' IS DISTINCT FROM 'discovered' OR NEW.configuration_id<>g.configuration_id OR NEW.question_digest<>q.question_digest
  OR NEW.kind IS DISTINCT FROM g.kind OR jsonb_typeof(NEW.lineage)<>'object' THEN RAISE EXCEPTION 'listening_discovery_topic_invalid';END IF;
 IF NEW.kind='confirmed_members' AND NEW.lineage IS DISTINCT FROM jsonb_build_object('source_generation_id',g.source_generation_id,'approval',0.7) THEN RAISE EXCEPTION 'listening_discovery_lineage_invalid';END IF;
 IF NEW.kind='source_seed' THEN
  IF NEW.lineage->>'source_generation_id' IS DISTINCT FROM g.source_generation_id::text OR jsonb_typeof(NEW.lineage->'source_topic_keys') IS DISTINCT FROM 'array'
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(NEW.lineage->'source_topic_keys'))<>jsonb_array_length(NEW.lineage->'source_topic_keys') THEN RAISE EXCEPTION 'listening_discovery_lineage_invalid';END IF;
  IF NEW.lineage ? 'subset_id' AND (jsonb_typeof(NEW.lineage->'orphan_root_ids') IS DISTINCT FROM 'array' OR NEW.lineage->>'group_digest' IS DISTINCT FROM
   signal_labeling_digest_v1(jsonb_build_object('subset_id',NEW.lineage->'subset_id','root_ids',(SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb) FROM(SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.lineage->'orphan_root_ids')) roots)))) THEN RAISE EXCEPTION 'listening_discovery_orphan_group_digest_invalid';END IF;
 END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['centroid','centroid_sha256','member_count']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['centroid','centroid_sha256','member_count']) THEN RAISE EXCEPTION 'listening_discovery_topic_immutable';END IF;
 IF NEW.kind='legacy_seed' THEN
  SELECT * INTO legacy FROM signal_mass_labeling_topics WHERE workspace_id=g.workspace_id AND map_id=g.map_id AND map_id=NEW.source_map_id AND topic_key=NEW.source_topic_key;
  IF legacy.topic_key IS NULL OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps map CROSS JOIN LATERAL jsonb_array_elements(map.catalog) t WHERE map.id=g.map_id AND t->>'topic_key'=NEW.source_topic_key AND t->>'definition'=q.definition->>'positive')
   OR NEW.lineage IS DISTINCT FROM jsonb_build_object('source_map_id',g.map_id,'source_topic_key',legacy.topic_key,'source_definition_digest',legacy.definition_digest)
  THEN RAISE EXCEPTION 'listening_discovery_legacy_binding_invalid';END IF;
  expected:=legacy.centroid;
 ELSE expected:=signal_listening_discovery_centroid_v1(g.id,NEW.question_key);END IF;
 IF NEW.centroid IS DISTINCT FROM expected OR NEW.member_count<>(SELECT count(*) FROM signal_listening_discovery_members WHERE generation_id=g.id AND question_key=NEW.question_key) THEN RAISE EXCEPTION 'listening_discovery_centroid_invalid';END IF;
 NEW.centroid_sha256:=CASE WHEN expected IS NOT NULL THEN 'sha256:'||encode(sha256(convert_to(expected::text,'UTF8')),'hex') END;RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_topic_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_topics FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_topic_guard_v1();
CREATE FUNCTION signal_listening_discovery_root_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM signal_listening_discovery_generations WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id AND status='building') THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 SELECT p.proof INTO expected FROM signal_listening_discovery_root_proofs_v1(NEW.generation_id,ARRAY[NEW.root_id]) p;
 IF expected IS NULL OR expected IS DISTINCT FROM NEW.proof OR NEW.proof_digest<>signal_labeling_digest_v1(expected) THEN RAISE EXCEPTION 'listening_discovery_root_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_root_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_roots FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_root_guard_v1();
CREATE FUNCTION signal_listening_discovery_member_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE g signal_listening_discovery_generations;t signal_listening_discovery_topics;r signal_listening_discovery_roots;v jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id AND status='building';
 SELECT * INTO t FROM signal_listening_discovery_topics WHERE generation_id=g.id AND question_key=NEW.question_key;
 SELECT * INTO r FROM signal_listening_discovery_roots WHERE generation_id=g.id AND root_id=NEW.root_id;
 IF g.id IS NULL OR t.question_key IS NULL OR r.root_id IS NULL OR r.proof->>'embedding_call_id' IS NULL THEN RAISE EXCEPTION 'listening_discovery_member_invalid';END IF;
 IF t.kind='confirmed_members' THEN
  SELECT value INTO v FROM jsonb_array_elements(r.proof->'evaluations') WHERE value->>'question_key'=t.question_key AND value->>'question_digest'=t.question_digest AND (value->>'probability')::double precision>=0.7;
  IF v IS NULL OR NEW.evidence IS DISTINCT FROM jsonb_build_object('kind',CASE WHEN v->>'manual_id' IS NULL THEN 'jev' ELSE 'manual' END,'evaluation',v) THEN RAISE EXCEPTION 'listening_discovery_confirmation_invalid';END IF;
 ELSIF t.kind='source_seed' THEN
  IF NEW.evidence->>'kind'='source_confirmed' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_listening_discovery_members source JOIN signal_listening_discovery_generations sg ON sg.id=source.generation_id
    JOIN signal_listening_discovery_roots sr ON sr.generation_id=source.generation_id AND sr.root_id=source.root_id
    WHERE source.generation_id=g.source_generation_id AND source.root_id=NEW.root_id AND source.question_key=NEW.evidence->>'question_key'
     AND NEW.evidence->>'generation_id'=source.generation_id::text AND source.evidence->>'kind' IN('jev','manual')
     AND (t.lineage->'source_topic_keys') ? source.question_key AND sg.status='ready'
     AND sr.proof->>'input_digest'=r.proof->>'input_digest' AND sr.proof->>'embedding_sha256'=r.proof->>'embedding_sha256') THEN RAISE EXCEPTION 'listening_discovery_source_member_invalid';END IF;
  ELSIF NEW.evidence->>'kind'='orphan_seed' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subsets subset JOIN signal_listening_discovery_subset_roots sr ON sr.subset_id=subset.id
    JOIN signal_listening_discovery_roots original ON original.generation_id=sr.generation_id AND original.root_id=sr.root_id
    JOIN signal_listening_discovery_generations sg ON sg.id=subset.generation_id
    WHERE subset.id=(NEW.evidence->>'subset_id')::uuid AND subset.status='ready' AND subset.workspace_id=g.workspace_id AND sr.root_id=NEW.root_id
     AND sg.map_id=g.map_id AND sg.embedding_config_digest=g.embedding_config_digest AND sg.entity_context_digest=g.entity_context_digest
     AND t.lineage->>'subset_id'=subset.id::text AND t.lineage->>'group_digest'=NEW.evidence->>'group_digest' AND (t.lineage->'orphan_root_ids') ? NEW.root_id::text AND original.proof->>'input_digest'=r.proof->>'input_digest'
     AND original.proof->>'embedding_sha256'=r.proof->>'embedding_sha256') THEN RAISE EXCEPTION 'listening_discovery_orphan_seed_invalid';END IF;
  ELSE RAISE EXCEPTION 'listening_discovery_source_kind_invalid';END IF;
 ELSE RAISE EXCEPTION 'listening_discovery_legacy_members_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_member_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_members FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_member_guard_v1();
CREATE FUNCTION signal_listening_discovery_manual_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE q signal_listening_questions;cfg signal_listening_configurations;map signal_mass_labeling_maps;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 SELECT * INTO cfg FROM signal_listening_configurations WHERE workspace_id=NEW.workspace_id AND state='published' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO q FROM signal_listening_questions WHERE configuration_id=cfg.id AND question_key=NEW.question_key;
 SELECT * INTO map FROM signal_mass_labeling_maps WHERE id=NEW.map_id AND workspace_id=NEW.workspace_id;
 IF cfg.id IS DISTINCT FROM NEW.configuration_id OR q.question_digest IS DISTINCT FROM NEW.question_digest
  OR q.definition->>'topic_source' IS DISTINCT FROM 'discovered' OR q.definition->'human_locked' IS DISTINCT FROM 'true'::jsonb
  OR map.entity_context_digest IS DISTINCT FROM NEW.entity_context_digest
  OR NOT EXISTS(SELECT 1 FROM signal_listening_population_roots_v1(NEW.workspace_id,cfg.id,map.id,map.entity_context_digest,ARRAY[NEW.root_id],'llm-processing') p
    WHERE p.question_key=q.question_key AND p.input_digest=NEW.input_digest AND p.scope_state='included') THEN RAISE EXCEPTION 'listening_discovery_manual_scope_invalid';END IF;
 IF NEW.source_override_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_overrides source JOIN signal_listening_discovery_topics t ON t.configuration_id=NEW.configuration_id AND t.question_key=NEW.question_key AND t.source_map_id=source.map_id AND t.source_topic_key=source.topic_key WHERE source.id=NEW.source_override_id AND source.workspace_id=NEW.workspace_id AND source.root_id=NEW.root_id AND source.belongs=NEW.belongs AND source.map_id=NEW.map_id AND source.decided_via='human_ui') THEN RAISE EXCEPTION 'listening_discovery_manual_source_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_manual_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_manual FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_manual_guard_v1();
CREATE FUNCTION signal_listening_discovery_subset_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE n integer;cached integer;sha text;
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND(OLD.status<>'building' OR NEW.status<>'ready' OR
  (to_jsonb(NEW)-ARRAY['status','root_count','cached_count','subset_digest']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','root_count','cached_count','subset_digest'])) THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 IF NOT EXISTS(SELECT 1 FROM signal_listening_discovery_generations WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id AND kind='confirmed_members' AND status='ready') THEN RAISE EXCEPTION 'listening_discovery_subset_source_invalid';END IF;
 IF TG_OP='INSERT' AND(NEW.status<>'building' OR NEW.root_count IS NOT NULL OR NEW.cached_count IS NOT NULL OR NEW.subset_digest IS NOT NULL) THEN RAISE EXCEPTION 'listening_discovery_subset_must_build';END IF;
 IF TG_OP='UPDATE' THEN
  SELECT count(*)::integer,count(*) FILTER(WHERE r.proof->>'embedding_call_id' IS NOT NULL)::integer,
   signal_labeling_digest_v1(jsonb_build_object('workspace_id',NEW.workspace_id,'generation_id',NEW.generation_id,
    'roots',COALESCE(jsonb_agg(jsonb_build_array(r.root_id,r.proof_digest) ORDER BY r.root_id),'[]'::jsonb))) INTO n,cached,sha
   FROM signal_listening_discovery_subset_roots chosen JOIN signal_listening_discovery_roots r ON r.generation_id=chosen.generation_id AND r.root_id=chosen.root_id WHERE chosen.subset_id=NEW.id;
  IF NEW.root_count IS DISTINCT FROM n OR NEW.cached_count IS DISTINCT FROM cached OR NEW.subset_digest IS DISTINCT FROM sha THEN RAISE EXCEPTION 'listening_discovery_subset_incomplete';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_subset_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_subsets FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_subset_guard_v1();
CREATE FUNCTION signal_listening_discovery_subset_root_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subsets WHERE id=NEW.subset_id AND generation_id=NEW.generation_id AND status='building') THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 SELECT proof INTO p FROM signal_listening_discovery_roots WHERE generation_id=NEW.generation_id AND root_id=NEW.root_id AND proof_digest=NEW.proof_digest;
 IF p IS NULL OR p->'in_category' IS DISTINCT FROM 'true'::jsonb OR jsonb_array_length(p->'evaluations')=0
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'evaluations') e WHERE e->>'probability' IS NULL OR (e->>'probability')::double precision>=0.7) THEN RAISE EXCEPTION 'listening_discovery_not_orphan';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_subset_root_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_subset_roots FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_subset_root_guard_v1();
CREATE FUNCTION signal_listening_discovery_subset_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subsets WHERE id=NEW.id AND status='ready') THEN RAISE EXCEPTION 'listening_discovery_subset_unsealed';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_discovery_subset_complete AFTER INSERT ON signal_listening_discovery_subsets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_subset_complete_v1();

CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(w uuid,cid uuid,mid uuid,ctx text,roots uuid[],purpose text)
RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,
 question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,
 answer jsonb,cache_call_id uuid,scope_basis text)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH config AS MATERIALIZED(SELECT * FROM signal_listening_configurations WHERE workspace_id=w AND id=cid AND state='published'),
 qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),
 selected_items AS MATERIALIZED(
  SELECT i.* FROM signal_mass_labeling_items i WHERE roots IS NULL AND i.workspace_id=w AND i.map_id=mid
  UNION ALL
  SELECT item.* FROM (SELECT DISTINCT root FROM unnest(roots) r(root) WHERE root IS NOT NULL AND cardinality(roots)<=4096) selected
  CROSS JOIN LATERAL(SELECT i.* FROM signal_mass_labeling_items i WHERE i.workspace_id=w AND i.map_id=mid AND i.root_id=selected.root OFFSET 0) item
  WHERE roots IS NOT NULL),
 items AS MATERIALIZED(SELECT i.*,signal_listening_input_digest_v1(i) listening_input_digest,m.published_at,m.platform,
  signal_mass_labeling_r13_hashtags_v1(m.text_clean) hashtag_only,
  signal_mass_labeling_category_matches_v1(m.text_clean,ARRAY(SELECT jsonb_array_elements_text(c.configuration->'lexicon_terms'))) category_match
  FROM selected_items i JOIN config c ON c.workspace_id=i.workspace_id
  JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id
  WHERE i.workspace_id=w AND i.map_id=mid AND m.canonical_mention_id=m.id AND m.inclusion_status='included'
   AND signal_listening_root_right_v1(w,i.root_id,purpose)),
 prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,
   signal_labeling_digest_v1(jsonb_build_object('voice',v.call_id,'promotion',p.call_id)) basis,
   ARRAY(SELECT ranked.question_key FROM qs ranked
    JOIN signal_topic_definition_embeddings prototype ON prototype.id=COALESCE(ranked.prototype_embedding_id,(SELECT v.prototype_embedding_id FROM signal_listening_question_vectors v
      WHERE v.configuration_id=cid AND v.question_key=ranked.question_key AND v.embedding_config_digest=(SELECT embedding_config_digest FROM signal_mass_labeling_maps WHERE id=mid))) AND prototype.workspace_id=w
    JOIN signal_mass_labeling_maps map ON map.id=mid AND map.workspace_id=w
    JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=w AND e.config_digest=map.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
    WHERE ranked.definition->>'topic_source'='defined' AND prototype.embedding_config_digest=map.embedding_config_digest
    ORDER BY prototype.embedding <=> e.embedding,ranked.question_key LIMIT 4) defined_keys,signal_listening_discovery_candidates_v1(w,cid,mid,i.root_id) discovered_keys
  FROM items i LEFT JOIN qs vq ON vq.question_key='voice' LEFT JOIN qs pq ON pq.question_key='promotion'
  LEFT JOIN signal_listening_answers v ON v.workspace_id=w AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=ctx AND v.question_digest=vq.question_digest
  LEFT JOIN signal_listening_answers p ON p.workspace_id=w AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=ctx AND p.question_digest=pq.question_digest)
 SELECT i.root_id,i.listening_input_digest,i.text,i.published_at,i.platform,q.question_key,q.question_digest,q.definition,q.wire,
  CASE q.definition->>'topic_source' WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE definition->>'topic_source'='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN CASE WHEN i.discovered_keys IS NULL THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key) ELSE q.question_key=ANY(i.discovered_keys) END OR manual.id IS NOT NULL
   ELSE true END,
  CASE WHEN q.definition->>'scope'='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.voice->>'choice'='individual' AND (i.promotion->>'noul')::double precision<=0.7 AND NOT i.hashtag_only AND i.category_match THEN 'included'
   ELSE 'excluded' END,
  COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer),CASE WHEN manual.id IS NULL THEN a.call_id END,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END
 FROM prepared i CROSS JOIN qs q LEFT JOIN signal_listening_answers a ON a.workspace_id=w AND a.root_id=i.root_id
  AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=ctx AND a.question_digest=q.question_digest
 LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=w AND d.root_id=i.root_id AND d.input_digest=i.listening_input_digest
  AND d.entity_context_digest=ctx AND d.question_digest=q.question_digest ORDER BY d.created_at DESC,d.id DESC LIMIT 1) manual ON true
$$;


DO $$DECLARE name text;role_name text;BEGIN
 FOREACH name IN ARRAY ARRAY['signal_listening_discovery_generations','signal_listening_discovery_topics','signal_listening_discovery_roots',
  'signal_listening_discovery_members','signal_listening_discovery_subsets','signal_listening_discovery_subset_roots','signal_listening_discovery_manual'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',name,role_name);END IF;
  END LOOP;
 END LOOP;
 FOR name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'signal_listening_discovery_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||name||' FROM PUBLIC';
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',name,role_name);END IF;
  END LOOP;
 END LOOP;
END $$;
