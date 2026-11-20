-- R16 adds configurable listening owners and semantic per-question receipts.
-- It neither changes historical V1/V2 labels nor grants policy or provider spend.
CREATE FUNCTION signal_listening_wire_v1(c jsonb,q jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT
 SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('type',q->'type','instructions',jsonb_build_object('rules',c->'instructions','question',q->'text'),
  'criteria',CASE WHEN q->>'type'='choice' THEN
   (SELECT jsonb_object_agg(o->>'key',o->'definition') FROM jsonb_array_elements(q->'options') o)
   ELSE jsonb_build_object('true',q->'positive','false',q->'negative') END)
$$;
CREATE FUNCTION signal_listening_question_digest_v1(c jsonb,q jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT
 SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(jsonb_build_object('contract_version','listening-jev-v1','model',c->'model','key',q->'key',
  'question',signal_listening_wire_v1(c,q),'scope',CASE WHEN q->>'scope'='all' THEN jsonb_build_object('scope','all') ELSE
   jsonb_build_object('scope','consumer_category','category',c->'category','lexicon_terms',c->'lexicon_terms',
    'promotion_max',0.7,'hashtags','only-hashtags-v1','lexicon','unicode-token-boundary-v1','base',
    (SELECT jsonb_agg(jsonb_build_object('key',b->'key','wire',signal_listening_wire_v1(c,b)) ORDER BY b->>'key')
      FROM jsonb_array_elements(c->'questions') b WHERE b->>'key' IN('voice','promotion'))) END))
$$;

CREATE TABLE signal_listening_configurations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 revision integer NOT NULL CHECK(revision>0),configuration jsonb NOT NULL,configuration_digest text NOT NULL,
 provenance text NOT NULL CHECK(provenance IN('human','agent')),source_digest text,
 state text NOT NULL DEFAULT 'published' CHECK(state IN('proposal','published')),
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,revision),CHECK(configuration_digest~'^sha256:[0-9a-f]{64}$'),
 CHECK(source_digest IS NULL OR source_digest~'^sha256:[0-9a-f]{64}$'),CHECK(provenance<>'agent' OR source_digest IS NOT NULL)
);
CREATE TABLE signal_listening_questions(
 workspace_id uuid NOT NULL,configuration_id uuid NOT NULL,question_key text NOT NULL,
 question_digest text NOT NULL,definition jsonb NOT NULL,wire jsonb NOT NULL,
 prototype_embedding_id uuid REFERENCES signal_topic_definition_embeddings(id),
 PRIMARY KEY(configuration_id,question_key),UNIQUE(workspace_id,configuration_id,question_key),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id)
);
CREATE INDEX signal_listening_questions_digest ON signal_listening_questions(workspace_id,question_digest);
CREATE TABLE signal_listening_runs(
 run_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,configuration_id uuid NOT NULL,map_id uuid NOT NULL,
 full_corpus boolean NOT NULL DEFAULT true CHECK(full_corpus),configuration_digest text NOT NULL,
 UNIQUE(workspace_id,run_id),FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id)
);
CREATE INDEX signal_listening_runs_config ON signal_listening_runs(workspace_id,configuration_id,map_id);
CREATE TABLE signal_listening_call_questions(
 workspace_id uuid NOT NULL,run_id uuid NOT NULL,call_id uuid NOT NULL,root_id uuid NOT NULL,
 question_key text NOT NULL,question_digest text NOT NULL,
 PRIMARY KEY(run_id,root_id,question_digest),UNIQUE(call_id,question_key),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_listening_runs(workspace_id,run_id),
 FOREIGN KEY(workspace_id,run_id,call_id) REFERENCES signal_labeling_calls(workspace_id,run_id,id),
 FOREIGN KEY(workspace_id,root_id) REFERENCES mentions(workspace_id,id)
);
CREATE TABLE signal_listening_answers(
 workspace_id uuid NOT NULL,root_id uuid NOT NULL,input_digest text NOT NULL,entity_context_digest text NOT NULL,
 question_digest text NOT NULL,question_key text NOT NULL,answer jsonb NOT NULL,
 run_id uuid NOT NULL,call_id uuid NOT NULL,request_digest text NOT NULL,raw_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,root_id,input_digest,entity_context_digest,question_digest),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_listening_runs(workspace_id,run_id),
 FOREIGN KEY(workspace_id,run_id,call_id) REFERENCES signal_labeling_calls(workspace_id,run_id,id),
 FOREIGN KEY(call_id,question_key) REFERENCES signal_listening_call_questions(call_id,question_key)
);
CREATE INDEX signal_listening_answers_question ON signal_listening_answers(workspace_id,question_digest,root_id);
CREATE TABLE signal_listening_failures(
 call_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,run_id uuid NOT NULL,root_id uuid NOT NULL,error_code text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,run_id,call_id) REFERENCES signal_labeling_calls(workspace_id,run_id,id)
);
CREATE FUNCTION signal_listening_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'listening_history_immutable' USING ERRCODE='23514'; END $$;

CREATE FUNCTION signal_listening_configuration_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE question_value jsonb;before jsonb;prior signal_listening_configurations;max_revision integer;option_count integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 IF NOT signal_mass_labeling_study_editor_v1(NEW.workspace_id,NEW.created_by_user_id) THEN RAISE EXCEPTION 'listening_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-listening-config:'||NEW.workspace_id::text,0));
 SELECT COALESCE(max(revision),0) INTO max_revision FROM signal_listening_configurations WHERE workspace_id=NEW.workspace_id;
 SELECT * INTO prior FROM signal_listening_configurations WHERE workspace_id=NEW.workspace_id AND state='published' ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>max_revision+1 THEN RAISE EXCEPTION 'listening_configuration_conflict'; END IF;
 IF NEW.configuration_digest<>signal_labeling_digest_v1(NEW.configuration)
  OR NEW.configuration->>'contract_version' IS DISTINCT FROM 'signal-listening-config-v1' OR NEW.configuration->>'model' IS DISTINCT FROM 'jev-1.13.0'
  OR NOT COALESCE(length(btrim(NEW.configuration->>'instructions')) BETWEEN 1 AND 2000,false)
  OR NOT COALESCE(length(btrim(NEW.configuration->>'category')) BETWEEN 1 AND 160,false)
  OR jsonb_typeof(NEW.configuration->'lexicon_terms') IS DISTINCT FROM 'array'
  OR jsonb_array_length(NEW.configuration->'lexicon_terms') NOT BETWEEN 1 AND 500
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.configuration->'lexicon_terms') v WHERE length(btrim(v)) NOT BETWEEN 1 AND 160)
  OR jsonb_typeof(NEW.configuration->'questions') IS DISTINCT FROM 'array'
  OR jsonb_array_length(NEW.configuration->'questions') NOT BETWEEN 2 AND 256
  OR (SELECT count(DISTINCT i->>'key') FROM jsonb_array_elements(NEW.configuration->'questions') i)<>jsonb_array_length(NEW.configuration->'questions')
 THEN RAISE EXCEPTION 'listening_configuration_invalid'; END IF;
 FOR question_value IN SELECT * FROM jsonb_array_elements(NEW.configuration->'questions') LOOP
  IF NOT COALESCE(question_value->>'key'~'^[a-z][a-z0-9_]{0,63}$' AND question_value->>'type' IN('choice','noul') AND question_value->>'scope' IN('all','consumer_category')
   AND length(btrim(question_value->>'text')) BETWEEN 1 AND 1600 AND question_value->>'origin' IN('base','brand_os','agent','methodology')
   AND jsonb_typeof(question_value->'human_locked')='boolean',false)
   OR question_value ? 'topic_source' AND (question_value->>'type'<>'noul' OR question_value->>'topic_source' NOT IN('defined','discovered'))
   OR question_value ? 'domain' AND (question_value->>'domain' NOT IN('category','adjacent','outside') OR NOT question_value ? 'topic_source')
   OR question_value ? 'parent_theme_key' AND (NOT question_value ? 'topic_source' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'themes') t WHERE t->>'key'=question_value->>'parent_theme_key'))
   OR question_value->>'origin'='base' AND question_value->>'key' NOT IN('voice','promotion') THEN RAISE EXCEPTION 'listening_question_invalid'; END IF;
  IF question_value->>'type'='choice' THEN
   IF jsonb_typeof(question_value->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(question_value->'options') NOT BETWEEN 2 AND 32
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(question_value->'options') o WHERE NOT COALESCE(o->>'key'~'^[a-z][a-z0-9_]{0,63}$'
      AND length(btrim(o->>'definition')) BETWEEN 1 AND 1600,false))
    OR (SELECT count(DISTINCT o->>'key') FROM jsonb_array_elements(question_value->'options') o)<>jsonb_array_length(question_value->'options')
    THEN RAISE EXCEPTION 'listening_options_invalid'; END IF;
  ELSIF NOT COALESCE(length(btrim(question_value->>'positive')) BETWEEN 1 AND 1600 AND length(btrim(question_value->>'negative')) BETWEEN 1 AND 1600,false)
   THEN RAISE EXCEPTION 'listening_noul_invalid'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'questions') baseq WHERE baseq->>'key'='voice' AND baseq->>'type'='choice'
   AND baseq->>'origin'='base' AND baseq->>'scope'='all' AND EXISTS(SELECT 1 FROM jsonb_array_elements(baseq->'options') o WHERE o->>'key'='individual'))
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'questions') baseq WHERE baseq->>'key'='promotion' AND baseq->>'type'='noul'
    AND baseq->>'origin'='base' AND baseq->>'scope'='all') THEN RAISE EXCEPTION 'listening_base_required'; END IF;
 IF jsonb_typeof(NEW.configuration->'themes') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.configuration->'themes')>50
  OR (SELECT count(DISTINCT t->>'key') FROM jsonb_array_elements(NEW.configuration->'themes') t)<>jsonb_array_length(NEW.configuration->'themes')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'themes') t WHERE NOT COALESCE(t->>'key'~'^[a-z][a-z0-9_]{0,63}$'
    AND length(btrim(t->>'name')) BETWEEN 1 AND 160 AND t->>'origin' IN('brand_os','agent','methodology') AND jsonb_typeof(t->'human_locked')='boolean',false))
 THEN RAISE EXCEPTION 'listening_themes_invalid';END IF;
 IF jsonb_typeof(NEW.configuration->'retired_question_keys') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.configuration->'retired_theme_keys') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.configuration->'retired_question_keys') k
    JOIN jsonb_array_elements(NEW.configuration->'questions') target_question ON target_question->>'key'=k)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.configuration->'retired_theme_keys') k
    JOIN jsonb_array_elements(NEW.configuration->'themes') t ON t->>'key'=k) THEN RAISE EXCEPTION 'listening_tombstone_invalid';END IF;
 IF NEW.provenance='agent' AND NEW.state='published' AND (
  NOT (NEW.configuration->'retired_question_keys') @> (prior.configuration->'retired_question_keys')
  OR NOT (NEW.configuration->'retired_theme_keys') @> (prior.configuration->'retired_theme_keys')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(prior.configuration->'retired_question_keys') k
   JOIN jsonb_array_elements(NEW.configuration->'questions') target_question ON target_question->>'key'=k)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(prior.configuration->'retired_theme_keys') k
   JOIN jsonb_array_elements(NEW.configuration->'themes') t ON t->>'key'=k)) THEN RAISE EXCEPTION 'listening_human_edit_frozen';END IF;
 IF NEW.provenance='agent' AND NEW.state='published' AND EXISTS(SELECT 1 FROM jsonb_array_elements(prior.configuration->'themes') oldt
  WHERE oldt->'human_locked'='true'::jsonb AND NOT NEW.configuration->'themes' @> jsonb_build_array(oldt)) THEN RAISE EXCEPTION 'listening_human_edit_frozen';END IF;
 IF NEW.provenance='agent' AND NEW.state='published' AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(prior.configuration->'questions') oldq WHERE oldq->'human_locked'='true'::jsonb
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'questions') newq WHERE newq=oldq
    AND signal_listening_question_digest_v1(NEW.configuration,newq)=signal_listening_question_digest_v1(prior.configuration,oldq))) THEN
  RAISE EXCEPTION 'listening_human_edit_frozen'; END IF;
 IF NEW.provenance='human' AND NEW.state='published' AND prior.id IS NOT NULL AND (
  EXISTS(SELECT 1 FROM jsonb_array_elements(prior.configuration->'questions') oldq
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'questions') newq WHERE newq->>'key'=oldq->>'key')
    AND NOT NEW.configuration->'retired_question_keys' @> jsonb_build_array(oldq->>'key'))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(prior.configuration->'themes') oldt
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'themes') newt WHERE newt->>'key'=oldt->>'key')
    AND NOT NEW.configuration->'retired_theme_keys' @> jsonb_build_array(oldt->>'key'))) THEN RAISE EXCEPTION 'listening_tombstone_required';END IF;
 IF NEW.provenance='human' AND NEW.state='published' AND prior.id IS NOT NULL AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(NEW.configuration->'questions') newq WHERE newq->'human_locked'<>'true'::jsonb
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(prior.configuration->'questions') oldq
    WHERE oldq->>'key'=newq->>'key' AND oldq<>newq)) THEN RAISE EXCEPTION 'listening_human_edit_must_freeze'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_configuration_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_configurations
 FOR EACH ROW EXECUTE FUNCTION signal_listening_configuration_guard_v1();
CREATE FUNCTION signal_listening_question_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_listening_configurations;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 SELECT * INTO c FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id;
 IF c.id IS NULL OR NOT c.configuration->'questions' @> jsonb_build_array(NEW.definition)
  OR NEW.question_key IS DISTINCT FROM NEW.definition->>'key' OR NEW.wire IS DISTINCT FROM signal_listening_wire_v1(c.configuration,NEW.definition)
  OR NEW.question_digest IS DISTINCT FROM signal_listening_question_digest_v1(c.configuration,NEW.definition)
  OR NEW.prototype_embedding_id IS DISTINCT FROM (NEW.definition->>'prototype_embedding_id')::uuid THEN RAISE EXCEPTION 'listening_question_binding_invalid'; END IF;
 IF NEW.prototype_embedding_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_topic_definition_embeddings p
  JOIN signal_workspace_embedding_calls receipt ON receipt.id=p.source_embedding_call_id AND receipt.workspace_id=p.workspace_id
  WHERE p.id=NEW.prototype_embedding_id AND p.workspace_id=NEW.workspace_id AND p.provider='voyage' AND p.embedding_model='voyage-4-large'
   AND receipt.status='settled' AND p.input_text_sha256='sha256:'||encode(sha256(convert_to(NEW.definition->>'positive','UTF8')),'hex')) THEN
  RAISE EXCEPTION 'listening_topic_prototype_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_question_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_questions
 FOR EACH ROW EXECUTE FUNCTION signal_listening_question_guard_v1();

CREATE FUNCTION signal_listening_root_right_v1(w uuid,r uuid,purpose text) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT purpose IN('llm-processing','client-derived-metrics') AND EXISTS(
  SELECT 1 FROM signal_mention_import_memberships path JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=w
  JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=w AND batch.data_source_id=path.data_source_id AND batch.status='completed'
  JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=w AND source.status='active'
  JOIN LATERAL(SELECT b.* FROM signal_provenance_policy_bindings b WHERE b.workspace_id=w AND b.data_source_id=batch.data_source_id
   AND b.status='active' AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
   AND (b.import_batch_id=batch.id OR b.import_batch_id IS NULL)
   ORDER BY (b.import_batch_id IS NOT NULL) DESC,b.binding_version DESC,b.id LIMIT 1) binding ON true
  JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=w AND license.status='active'
   AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
  JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=w
   AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
   AND (retention.effective_to IS NULL OR retention.effective_to>now())
   AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
  WHERE path.workspace_id=w AND origin.canonical_mention_id=r AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages u
   WHERE u.workspace_id=w AND u.licensing_policy_id=license.id AND u.usage_purpose=purpose AND u.decision='allowed'))
$$;
CREATE FUNCTION signal_listening_input_digest_v1(item signal_mass_labeling_items) RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(jsonb_build_object('contract_version','signal-listening-input-v1',
  'root_id',item.root_id,'source_fingerprint',item.root_fingerprint,'text',item.text))
$$;
CREATE FUNCTION signal_listening_population_v1(w uuid,cid uuid,mid uuid,ctx text,purpose text DEFAULT 'llm-processing')
RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,
 question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,
 answer jsonb,cache_call_id uuid,scope_basis text)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH config AS MATERIALIZED(SELECT * FROM signal_listening_configurations WHERE workspace_id=w AND id=cid AND state='published'),
 qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),
 items AS MATERIALIZED(SELECT i.*,signal_listening_input_digest_v1(i) listening_input_digest,m.published_at,m.platform,
  signal_mass_labeling_r13_hashtags_v1(m.text_clean) hashtag_only,
  signal_mass_labeling_category_matches_v1(m.text_clean,ARRAY(SELECT jsonb_array_elements_text(c.configuration->'lexicon_terms'))) category_match
  FROM signal_mass_labeling_items i JOIN config c ON c.workspace_id=i.workspace_id
  JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id
  WHERE i.workspace_id=w AND i.map_id=mid AND m.canonical_mention_id=m.id AND m.inclusion_status='included'
   AND signal_listening_root_right_v1(w,i.root_id,purpose)),
 prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,
   signal_labeling_digest_v1(jsonb_build_object('voice',v.call_id,'promotion',p.call_id)) basis,
   ARRAY(SELECT ranked.question_key FROM qs ranked
    JOIN signal_topic_definition_embeddings prototype ON prototype.id=ranked.prototype_embedding_id AND prototype.workspace_id=w
    JOIN signal_mass_labeling_maps map ON map.id=mid AND map.workspace_id=w
    JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=w AND e.config_digest=map.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
    WHERE ranked.definition->>'topic_source'='defined' AND prototype.embedding_config_digest=map.embedding_config_digest
    ORDER BY prototype.embedding <=> e.embedding,ranked.question_key LIMIT 4) defined_keys
  FROM items i LEFT JOIN qs vq ON vq.question_key='voice' LEFT JOIN qs pq ON pq.question_key='promotion'
  LEFT JOIN signal_listening_answers v ON v.workspace_id=w AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=ctx AND v.question_digest=vq.question_digest
  LEFT JOIN signal_listening_answers p ON p.workspace_id=w AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=ctx AND p.question_digest=pq.question_digest)
 SELECT i.root_id,i.listening_input_digest,i.text,i.published_at,i.platform,q.question_key,q.question_digest,q.definition,q.wire,
  CASE q.definition->>'topic_source' WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE definition->>'topic_source'='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key)
   ELSE true END,
  CASE WHEN q.definition->>'scope'='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.voice->>'choice'='individual' AND (i.promotion->>'noul')::double precision<=0.7 AND NOT i.hashtag_only AND i.category_match THEN 'included'
   ELSE 'excluded' END,
  a.answer,a.call_id,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END
 FROM prepared i CROSS JOIN qs q LEFT JOIN signal_listening_answers a ON a.workspace_id=w AND a.root_id=i.root_id
  AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=ctx AND a.question_digest=q.question_digest
$$;

CREATE FUNCTION signal_listening_run_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE cfg signal_listening_configurations;r signal_labeling_runs;map signal_mass_labeling_maps;l signal_labeler_versions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 SELECT * INTO cfg FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id AND state='published';
 SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO l FROM signal_labeler_versions WHERE id=r.labeler_version_id;
 SELECT * INTO map FROM signal_mass_labeling_maps WHERE id=NEW.map_id AND workspace_id=NEW.workspace_id;
 IF cfg.id IS NULL OR r.id IS NULL OR map.id IS NULL OR NEW.configuration_digest IS DISTINCT FROM cfg.configuration_digest
  OR r.kind<>'mass_labeling' OR l.kind<>'mass_labeling' OR l.provider<>'typesafe' OR l.model<>'jev-1.13.0'
  OR l.identity#>>'{params,request_version}' IS DISTINCT FROM 'listening-jev-v1'
  OR l.identity#>'{params,configuration}' IS DISTINCT FROM cfg.configuration
  OR l.identity#>>'{params,configuration_digest}' IS DISTINCT FROM cfg.configuration_digest
  OR l.labeler_digest IS DISTINCT FROM signal_labeling_digest_v1(l.identity)
  OR r.entity_context_digest IS DISTINCT FROM map.entity_context_digest OR r.preparation_run_id IS DISTINCT FROM map.preparation_run_id
  OR r.membership_snapshot IS DISTINCT FROM jsonb_build_object('contract_version','signal-listening-run-v1','configuration_id',cfg.id,
   'configuration_digest',cfg.configuration_digest,'map_id',map.id,'map_digest',map.map_digest,'full_corpus',true)
  OR r.processing_admission_id IS NULL OR r.cap_micro_usd IS NULL OR r.cap_micro_usd<=0
  OR (SELECT count(*) FROM signal_listening_questions WHERE configuration_id=cfg.id)<>jsonb_array_length(cfg.configuration->'questions')
  OR cfg.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=NEW.workspace_id AND state='published')
 THEN RAISE EXCEPTION 'listening_run_binding_invalid'; END IF;
 IF (SELECT count(*) FROM signal_listening_questions WHERE configuration_id=cfg.id AND definition->>'topic_source'='defined')>8
  AND EXISTS(SELECT 1 FROM signal_listening_questions q LEFT JOIN signal_topic_definition_embeddings p ON p.id=q.prototype_embedding_id
   WHERE q.configuration_id=cfg.id AND q.definition->>'topic_source'='defined'
    AND (p.id IS NULL OR p.embedding_config_digest IS DISTINCT FROM map.embedding_config_digest)) THEN
  RAISE EXCEPTION 'listening_topic_prototype_required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_run_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_runs
 FOR EACH ROW EXECUTE FUNCTION signal_listening_run_guard_v1();

CREATE OR REPLACE FUNCTION guard_signal_mass_labeling_admission_owner_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 -- Only the new frozen listening owner may use this branch. The historical
 -- V1/V2 predicate below remains byte-for-byte unchanged.
 IF EXISTS(SELECT 1 FROM signal_listening_runs listening
  JOIN signal_labeling_runs r ON r.id=listening.run_id AND r.workspace_id=listening.workspace_id
  JOIN signal_listening_configurations c ON c.id=listening.configuration_id AND c.workspace_id=listening.workspace_id
  JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
  WHERE r.id=NEW.target_id AND r.workspace_id=NEW.workspace_id AND r.actor_user_id=NEW.actor_user_id
   AND r.processing_admission_id=NEW.id AND r.kind='mass_labeling' AND l.kind='mass_labeling'
   AND l.provider='typesafe' AND l.model='jev-1.13.0' AND l.identity#>>'{params,request_version}'='listening-jev-v1'
   AND l.identity#>>'{params,configuration_digest}'=c.configuration_digest AND l.identity#>'{params,configuration}'=c.configuration
   AND listening.configuration_digest=c.configuration_digest AND listening.full_corpus
   AND NEW.configuration=jsonb_build_object('contract_version','mass-labeling-jev-v2','provider','typesafe','model','jev-1.13.0')
   AND (SELECT count(*) FROM signal_listening_questions WHERE configuration_id=c.id)=jsonb_array_length(c.configuration->'questions')) THEN
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_mass_labeling_runs mass
   JOIN signal_labeling_runs run ON run.id=mass.run_id AND run.workspace_id=mass.workspace_id
   JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
   WHERE mass.workspace_id=NEW.workspace_id AND mass.run_id=NEW.target_id
     AND run.processing_admission_id=NEW.id AND run.actor_user_id=NEW.actor_user_id
     AND run.kind='mass_labeling' AND labeler.kind='mass_labeling' AND labeler.provider='typesafe'
     AND labeler.model='jev-1.13.0' AND (
       NEW.configuration->>'contract_version'='mass-labeling-jev-v1' AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v1'
       OR NEW.configuration->>'contract_version'='mass-labeling-jev-v2'
         AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v2'
         AND labeler.identity#>>'{params,question_language}'='en'
         AND labeler.identity#>>'{params,top_candidates}'='4'
         AND labeler.identity#>>'{params,candidate_language}' IN('en','original')
         AND length(btrim(labeler.identity#>>'{params,category}')) BETWEEN 1 AND 160
         AND jsonb_typeof(labeler.identity#>'{params,interests}')='array'
         AND run.membership_snapshot->'configuration'=jsonb_build_object(
           'category',labeler.identity#>'{params,category}',
           'candidate_language',labeler.identity#>'{params,candidate_language}',
           'interests',labeler.identity#>'{params,interests}')
     )) THEN
  RAISE EXCEPTION 'mass_labeling_admission_owner_required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION signal_listening_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_listening_runs;r signal_labeling_runs;c signal_listening_configurations;admission signal_processing_admissions;
 i jsonb;actual jsonb;expected jsonb;questions jsonb;digests jsonb;basis jsonb;selected_count integer;ctx text;
BEGIN
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id;
 IF owner.run_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=owner.run_id;
 SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.run_id,NEW.workspace_id,NEW.provider,NEW.model,NEW.transport,NEW.custom_id,NEW.request_digest,NEW.request,NEW.inputs,
      NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.run_id,OLD.workspace_id,OLD.provider,OLD.model,OLD.transport,OLD.custom_id,OLD.request_digest,OLD.request,OLD.inputs,
      OLD.reserved_micro_usd,OLD.budget_date,OLD.budget_timezone,OLD.created_at)
   OR OLD.raw_sha256 IS NOT NULL AND ROW(NEW.raw_sha256,NEW.raw_storage_key,NEW.raw_size_bytes) IS DISTINCT FROM ROW(OLD.raw_sha256,OLD.raw_storage_key,OLD.raw_size_bytes)
   OR OLD.status='settled' AND ROW(NEW.status,NEW.usage,NEW.settled_micro_usd) IS DISTINCT FROM ROW(OLD.status,OLD.usage,OLD.settled_micro_usd)
   OR OLD.status<>'reserved' AND NEW.status='reserved' THEN RAISE EXCEPTION 'listening_call_immutable'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.status='submitting' AND OLD.status='reserved' THEN
  IF NEW.workspace_id<>owner.workspace_id OR r.status<>'running' OR r.lease_token IS NULL OR r.lease_until<=clock_timestamp()
   OR NEW.provider<>'typesafe' OR NEW.model<>'jev-1.13.0' OR NEW.transport<>'sync' OR NEW.reserved_micro_usd<=0
   OR jsonb_array_length(NEW.inputs)<>1 THEN RAISE EXCEPTION 'listening_call_invalid'; END IF;
  PERFORM signal_processing_lock_actor_v1(r.workspace_id,r.actor_user_id);
  IF c.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=r.workspace_id AND state='published')
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=r.workspace_id AND feature='mass_labeling')
   OR r.entity_context_digest IS DISTINCT FROM(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=r.workspace_id ORDER BY version_no DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps m JOIN signal_corpus_preparation_input_state s
    ON s.workspace_id=m.workspace_id AND s.input_revision=m.input_revision WHERE m.id=owner.map_id AND m.workspace_id=r.workspace_id)
  THEN RAISE EXCEPTION 'listening_run_stale'; END IF;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  PERFORM signal_processing_capacity_v1(r.workspace_id,r.actor_user_id,r.id,admission.id,ARRAY['mass_labeling_jev'],
    'typesafe','jev-1.13.0',admission.configuration,r.cap_micro_usd,'labeling',NEW.id,NEW.reserved_micro_usd,NEW.created_at);
  IF NEW.budget_date<>admission.budget_date OR NEW.budget_timezone<>admission.budget_timezone THEN RAISE EXCEPTION 'listening_budget_invalid'; END IF;
  i:=NEW.inputs->0;
  SELECT count(*)::int,jsonb_object_agg(p.question_key,p.wire),jsonb_object_agg(p.question_key,to_jsonb(p.question_digest)),
    COALESCE(jsonb_object_agg(p.question_key,to_jsonb(p.scope_basis)) FILTER(WHERE p.scope_basis IS NOT NULL),'{}'::jsonb)
   INTO selected_count,questions,digests,basis
   FROM signal_listening_population_v1(r.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest) p
   WHERE p.root_id=(i->>'root_id')::uuid AND p.question_key IN(SELECT jsonb_array_elements_text(i->'question_keys'))
    AND p.input_digest=i->>'input_digest' AND p.candidate AND p.scope_state='included' AND p.answer IS NULL;
  IF selected_count NOT BETWEEN 1 AND 64 OR selected_count<>jsonb_array_length(i->'question_keys')
   OR i->>'configuration_digest' IS DISTINCT FROM c.configuration_digest OR i->>'map_id' IS DISTINCT FROM owner.map_id::text
   OR i->'question_digests' IS DISTINCT FROM digests OR i->'scope_basis' IS DISTINCT FROM basis THEN RAISE EXCEPTION 'listening_call_questions_invalid'; END IF;
  SELECT jsonb_build_object('model','jev-1.13.0','state',item.text,'questions',questions) INTO expected
   FROM signal_mass_labeling_items item WHERE item.workspace_id=r.workspace_id AND item.map_id=owner.map_id AND item.root_id=(i->>'root_id')::uuid;
  IF NEW.request IS DISTINCT FROM expected OR i->>'text' IS DISTINCT FROM expected->>'state'
   OR NEW.request_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_object('request_version','listening-jev-v1','run_id',r.id,
    'root_id',i->'root_id','input_digest',i->'input_digest','entity_context_digest',r.entity_context_digest,
    'question_digests',digests,'scope_basis',basis,'request',expected)) THEN RAISE EXCEPTION 'listening_request_invalid'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_call_guard BEFORE INSERT OR UPDATE ON signal_labeling_calls
 FOR EACH ROW EXECUTE FUNCTION signal_listening_call_guard_v1();
CREATE FUNCTION signal_listening_link_call_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM signal_listening_runs WHERE run_id=NEW.run_id AND workspace_id=NEW.workspace_id) THEN
  INSERT INTO signal_listening_call_questions(workspace_id,run_id,call_id,root_id,question_key,question_digest)
   SELECT NEW.workspace_id,NEW.run_id,NEW.id,(NEW.inputs->0->>'root_id')::uuid,key,value
   FROM jsonb_each_text(NEW.inputs->0->'question_digests');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_link_call AFTER INSERT ON signal_labeling_calls FOR EACH ROW EXECUTE FUNCTION signal_listening_link_call_v1();
CREATE FUNCTION signal_listening_call_question_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE call signal_labeling_calls;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 SELECT * INTO call FROM signal_labeling_calls WHERE id=NEW.call_id AND workspace_id=NEW.workspace_id AND run_id=NEW.run_id;
 IF call.id IS NULL OR call.status<>'reserved' OR call.inputs->0->>'root_id' IS DISTINCT FROM NEW.root_id::text
  OR call.inputs->0->'question_digests'->>NEW.question_key IS DISTINCT FROM NEW.question_digest THEN RAISE EXCEPTION 'listening_call_binding_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_call_question_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_call_questions
 FOR EACH ROW EXECUTE FUNCTION signal_listening_call_question_guard_v1();
CREATE FUNCTION signal_listening_answer_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE call signal_labeling_calls;r signal_labeling_runs;owner signal_listening_runs;q signal_listening_questions;result jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 SELECT * INTO call FROM signal_labeling_calls WHERE id=NEW.call_id AND workspace_id=NEW.workspace_id AND run_id=NEW.run_id;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id;
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=r.id AND workspace_id=NEW.workspace_id;
 SELECT * INTO q FROM signal_listening_questions WHERE configuration_id=owner.configuration_id AND question_key=NEW.question_key;
 result:=call.results->0;
 IF call.id IS NULL OR call.status<>'settled' OR call.settled_micro_usd IS NULL OR call.usage IS NULL
  OR call.raw_sha256 IS NULL OR call.raw_storage_verified_at IS NULL OR call.raw_storage_verified_key IS DISTINCT FROM call.raw_storage_key
  OR NOT call.results_applied OR jsonb_array_length(call.results)<>1 OR result->>'status' NOT IN('labeled','abstained')
  OR NEW.entity_context_digest IS DISTINCT FROM r.entity_context_digest OR NEW.root_id::text IS DISTINCT FROM result->>'root_id'
  OR NEW.input_digest IS DISTINCT FROM result->>'input_digest' OR NEW.entity_context_digest IS DISTINCT FROM result->>'entity_context_digest'
  OR NEW.question_digest IS DISTINCT FROM q.question_digest OR NEW.question_digest IS DISTINCT FROM result->'question_digests'->>NEW.question_key
  OR NEW.answer IS DISTINCT FROM result->'answers'->NEW.question_key OR NEW.request_digest IS DISTINCT FROM call.request_digest
  OR NEW.raw_sha256 IS DISTINCT FROM call.raw_sha256 OR NOT signal_listening_root_right_v1(NEW.workspace_id,NEW.root_id,'llm-processing')
  OR NEW.answer->>'type' IS DISTINCT FROM q.definition->>'type'
 THEN RAISE EXCEPTION 'listening_answer_receipt_invalid'; END IF;
 PERFORM signal_processing_lock_actor_v1(r.workspace_id,r.actor_user_id);
 IF NEW.answer->>'type'='noul' THEN
  IF NOT COALESCE((NEW.answer->>'noul')::double precision BETWEEN 0 AND 1,false) OR (SELECT count(*) FROM jsonb_object_keys(NEW.answer))<>2
   THEN RAISE EXCEPTION 'listening_answer_invalid'; END IF;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.answer))<>4
   OR NOT COALESCE((NEW.answer->>'confidence')::double precision BETWEEN 0 AND 1,false)
   OR NOT q.wire->'criteria' ? (NEW.answer->>'choice')
   OR (SELECT count(*) FROM jsonb_each(NEW.answer->'probabilities'))<>(SELECT count(*) FROM jsonb_each(q.wire->'criteria'))
   OR EXISTS(SELECT 1 FROM jsonb_each(NEW.answer->'probabilities') p WHERE NOT q.wire->'criteria' ? p.key
      OR NOT COALESCE((p.value#>>'{}')::double precision BETWEEN 0 AND 1,false)) THEN RAISE EXCEPTION 'listening_answer_invalid'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_answer_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_answers
 FOR EACH ROW EXECUTE FUNCTION signal_listening_answer_guard_v1();
CREATE FUNCTION signal_listening_failure_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_labeling_calls c JOIN signal_listening_runs owner ON owner.run_id=c.run_id
  WHERE c.id=NEW.call_id AND c.workspace_id=NEW.workspace_id AND c.run_id=NEW.run_id AND c.results_applied
   AND c.inputs->0->>'root_id'=NEW.root_id::text AND c.results->0->>'status'='error'
   AND c.results->0->>'error_code'=NEW.error_code) THEN RAISE EXCEPTION 'listening_failure_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_failure_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_failures
 FOR EACH ROW EXECUTE FUNCTION signal_listening_failure_guard_v1();

CREATE FUNCTION signal_listening_configuration_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF (SELECT count(*) FROM signal_listening_questions WHERE configuration_id=NEW.id)<>jsonb_array_length(NEW.configuration->'questions')
 THEN RAISE EXCEPTION 'listening_configuration_incomplete';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_configuration_complete AFTER INSERT ON signal_listening_configurations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_configuration_complete_v1();
CREATE FUNCTION signal_listening_owner_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM signal_listening_runs WHERE run_id=OLD.id) AND
  (to_jsonb(NEW)-ARRAY['status','counts','cursor_root_id','selection_complete','lease_token','lease_until','next_poll_at','error_code','updated_at','completed_at'])
  IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','counts','cursor_root_id','selection_complete','lease_token','lease_until','next_poll_at','error_code','updated_at','completed_at'])
 THEN RAISE EXCEPTION 'listening_run_immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_owner_immutable BEFORE UPDATE ON signal_labeling_runs
 FOR EACH ROW EXECUTE FUNCTION signal_listening_owner_immutable_v1();

DO $$DECLARE name text;role_name text;BEGIN
 FOREACH name IN ARRAY ARRAY['signal_listening_configurations','signal_listening_questions','signal_listening_runs',
  'signal_listening_call_questions','signal_listening_answers','signal_listening_failures'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',name,role_name);END IF;
  END LOOP;
 END LOOP;
 FOR name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'signal_listening_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||name||' FROM PUBLIC';
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',name,role_name);END IF;
  END LOOP;
 END LOOP;
END $$;
