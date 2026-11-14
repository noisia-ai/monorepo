-- Bound every call validation before rights/vector work; preserve historical/full serving APIs.
CREATE FUNCTION signal_listening_population_roots_v1(w uuid,cid uuid,mid uuid,ctx text,roots uuid[],purpose text)
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

CREATE OR REPLACE FUNCTION signal_listening_population_v1(w uuid,cid uuid,mid uuid,ctx text,purpose text DEFAULT 'llm-processing')
RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,
 question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,
 answer jsonb,cache_call_id uuid,scope_basis text)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT * FROM signal_listening_population_roots_v1(w,cid,mid,ctx,NULL::uuid[],purpose)
$$;
CREATE OR REPLACE FUNCTION signal_listening_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_listening_runs;r signal_labeling_runs;c signal_listening_configurations;admission signal_processing_admissions;
 i jsonb;actual jsonb;expected jsonb;questions jsonb;digests jsonb;basis jsonb;selected_count integer;ctx text;requeue jsonb;unsent boolean:=false;
BEGIN
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id;
 IF owner.run_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=owner.run_id;
 SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='submitting' AND NEW.status='reserved' THEN
   BEGIN requeue:=NULLIF(current_setting('noisia.labeling_unsent_requeue_v1',true),'')::jsonb;
   EXCEPTION WHEN OTHERS THEN requeue:=NULL;END;
   unsent:=COALESCE(requeue->>'contract_version'='signal-labeling-unsent-requeue-v1'
    AND requeue->>'run_id'=r.id::text AND requeue->>'workspace_id'=r.workspace_id::text
    AND requeue->>'lease_token'=r.lease_token::text AND r.status='running' AND r.lease_token IS NOT NULL AND r.lease_until>clock_timestamp()
    AND requeue->'calls' @> jsonb_build_array(jsonb_build_object('id',OLD.id,'request_digest',OLD.request_digest))
    AND OLD.provider_batch_id IS NULL AND OLD.raw_sha256 IS NULL AND OLD.raw_storage_key IS NULL AND OLD.raw_size_bytes IS NULL
    AND OLD.raw_storage_verified_at IS NULL AND OLD.raw_storage_verified_key IS NULL
    AND OLD.usage IS NULL AND OLD.settled_micro_usd IS NULL AND OLD.results IS NULL AND NOT OLD.results_applied
    AND OLD.terminal_exposure_micro_usd=0
    AND NOT EXISTS(SELECT 1 FROM signal_labeling_raw_page_members member WHERE member.call_id=OLD.id)
    AND (to_jsonb(NEW)-ARRAY['status','updated_at'])=(to_jsonb(OLD)-ARRAY['status','updated_at']),false);
   IF unsent THEN PERFORM signal_processing_lock_actor_v1(r.workspace_id,r.actor_user_id);END IF;
  END IF;
  IF ROW(NEW.run_id,NEW.workspace_id,NEW.provider,NEW.model,NEW.transport,NEW.custom_id,NEW.request_digest,NEW.request,NEW.inputs,
      NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.run_id,OLD.workspace_id,OLD.provider,OLD.model,OLD.transport,OLD.custom_id,OLD.request_digest,OLD.request,OLD.inputs,
      OLD.reserved_micro_usd,OLD.budget_date,OLD.budget_timezone,OLD.created_at)
   OR OLD.raw_sha256 IS NOT NULL AND ROW(NEW.raw_sha256,NEW.raw_storage_key,NEW.raw_size_bytes) IS DISTINCT FROM ROW(OLD.raw_sha256,OLD.raw_storage_key,OLD.raw_size_bytes)
   OR OLD.status='settled' AND ROW(NEW.status,NEW.usage,NEW.settled_micro_usd) IS DISTINCT FROM ROW(OLD.status,OLD.usage,OLD.settled_micro_usd)
   OR OLD.status<>'reserved' AND NEW.status='reserved' AND NOT unsent THEN RAISE EXCEPTION 'listening_call_immutable'; END IF;
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
   FROM signal_listening_population_roots_v1(r.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest,ARRAY[(i->>'root_id')::uuid],'llm-processing') p
   WHERE p.root_id=(i->>'root_id')::uuid AND p.question_key IN(SELECT jsonb_array_elements_text(i->'question_keys'))
    AND p.input_digest=i->>'input_digest' AND p.candidate AND p.scope_state='included' AND p.answer IS NULL;
  IF selected_count NOT BETWEEN 1 AND 256 OR selected_count<>jsonb_array_length(i->'question_keys')
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
CREATE FUNCTION signal_listening_prior_outcome_roots_v1(w uuid,cid uuid,mid uuid,ctx text,except_run uuid,roots uuid[]) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_listening_population_roots_v1(w,cid,mid,ctx,roots,'llm-processing') pending
  JOIN signal_listening_call_questions link ON link.workspace_id=w AND link.root_id=pending.root_id AND link.question_digest=pending.question_digest
  JOIN signal_labeling_calls call ON call.workspace_id=w AND call.id=link.call_id
  JOIN signal_labeling_runs run ON run.id=call.run_id AND run.workspace_id=w AND run.entity_context_digest=ctx
  WHERE pending.answer IS NULL AND pending.candidate AND pending.scope_state<>'excluded' AND call.run_id IS DISTINCT FROM except_run
   AND call.inputs->0->>'input_digest'=pending.input_digest
   AND (call.status IN('submitting','submitted','unknown') OR call.terminal_exposure_micro_usd>0
    OR call.status='failed' AND COALESCE(call.settled_micro_usd,0)>0 OR call.raw_storage_key IS NOT NULL AND NOT call.results_applied))
$$;
CREATE OR REPLACE FUNCTION signal_listening_prior_outcome_unresolved_v1(w uuid,cid uuid,mid uuid,ctx text,except_run uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_listening_prior_outcome_roots_v1(w,cid,mid,ctx,except_run,NULL::uuid[])
$$;
CREATE OR REPLACE FUNCTION signal_listening_cross_run_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_listening_runs;r signal_labeling_runs;
BEGIN
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id AND workspace_id=NEW.workspace_id;
 IF owner.run_id IS NULL THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' OR NEW.status='submitting' AND OLD.status='reserved' THEN
  SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id;
  IF signal_listening_prior_outcome_roots_v1(NEW.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest,r.id,ARRAY[(NEW.inputs->0->>'root_id')::uuid])
   THEN RAISE EXCEPTION 'listening_prior_outcome_unresolved';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION signal_listening_configuration_guard_v1() RETURNS trigger LANGUAGE plpgsql
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
    WHERE oldq->>'key'=newq->>'key' AND (oldq<>newq OR signal_listening_question_digest_v1(prior.configuration,oldq) IS DISTINCT FROM signal_listening_question_digest_v1(NEW.configuration,newq)))) THEN RAISE EXCEPTION 'listening_human_edit_must_freeze'; END IF;
 RETURN NEW;
END $$;

-- Publication only retires unsent work. Durable/unknown physical receipts retain
-- their frozen owner and exposure until the existing recovery path drains them.
CREATE FUNCTION signal_listening_supersede_v1(w uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE latest uuid;
BEGIN
 SELECT id INTO latest FROM signal_listening_configurations WHERE workspace_id=w AND state='published' ORDER BY revision DESC LIMIT 1;
 UPDATE signal_labeling_calls call SET status='failed',results_applied=true,results='[]'::jsonb,stop_reason='listening_configuration_changed',updated_at=clock_timestamp()
 FROM signal_listening_runs owner JOIN signal_labeling_runs run ON run.id=owner.run_id
 WHERE owner.workspace_id=w AND owner.configuration_id<>latest AND call.run_id=owner.run_id AND call.workspace_id=w
  AND run.status IN('queued','running') AND call.status='reserved' AND call.raw_sha256 IS NULL AND call.raw_storage_key IS NULL
  AND call.raw_size_bytes IS NULL AND call.raw_storage_verified_at IS NULL AND call.usage IS NULL AND call.settled_micro_usd IS NULL
  AND call.provider_batch_id IS NULL AND NOT call.results_applied AND call.terminal_exposure_micro_usd=0
  AND NOT EXISTS(SELECT 1 FROM signal_labeling_raw_page_members member WHERE member.call_id=call.id);
 UPDATE signal_labeling_runs run SET
  status=CASE WHEN EXISTS(SELECT 1 FROM signal_labeling_calls call WHERE call.run_id=run.id
    AND (call.status IN('submitting','submitted') OR call.raw_storage_key IS NOT NULL AND NOT call.results_applied)) THEN 'running' ELSE 'failed' END,
  error_code=CASE WHEN EXISTS(SELECT 1 FROM signal_labeling_calls call WHERE call.run_id=run.id AND call.status='unknown')
   THEN 'labeling_outcome_unknown' ELSE 'listening_configuration_changed' END,
  updated_at=clock_timestamp()
 FROM signal_listening_runs owner WHERE owner.run_id=run.id AND owner.workspace_id=w AND owner.configuration_id<>latest AND run.status IN('queued','running');
END $$;
CREATE OR REPLACE FUNCTION signal_listening_configuration_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF (SELECT count(*) FROM signal_listening_questions WHERE configuration_id=NEW.id)<>jsonb_array_length(NEW.configuration->'questions')
 THEN RAISE EXCEPTION 'listening_configuration_incomplete';END IF;
 IF NEW.state='published' THEN PERFORM signal_listening_supersede_v1(NEW.workspace_id);END IF;
 RETURN NEW;
END $$;

DO $$DECLARE name text;role_name text;BEGIN
 FOR name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'signal_listening_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||name||' FROM PUBLIC';
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',name,role_name);END IF;
  END LOOP;
 END LOOP;
END $$;
