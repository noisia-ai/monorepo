-- Materialize one completed editorial result into the provider-free SQL0174
-- revision graph. The current Signal catalog, selection and serving authority
-- remain untouched. Installing this migration performs no data writes.

CREATE OR REPLACE FUNCTION signal_topic_editorial_owner_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE a signal_processing_admissions%ROWTYPE;source jsonb;new_owner jsonb;old_owner jsonb;result_revision signal_topic_consolidation_revisions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_history_retained' USING ERRCODE='55000';END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO a FROM signal_processing_admissions WHERE id=NEW.processing_admission_id;
  source:=signal_topic_editorial_source_v1(NEW.numeric_run_id);
  IF a.id IS NULL OR a.action<>'topic_consolidation' OR a.automatic OR a.provider<>'anthropic' OR a.model<>'claude-sonnet-4-6'
   OR ROW(a.target_id,a.workspace_id,a.organization_id,a.actor_user_id,a.idempotency_key,a.request_digest,a.execution_cap_micro_usd)
    IS DISTINCT FROM ROW(NEW.id,NEW.workspace_id,NEW.organization_id,NEW.actor_user_id,NEW.idempotency_key,NEW.request_digest,NEW.hard_cap_micro_usd)
   OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1() OR source IS NULL OR source IS DISTINCT FROM NEW.source_binding
   OR source->>'source_engine_execution_id' IS DISTINCT FROM NEW.source_engine_execution_id::text
   OR NEW.source_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(source)
   OR NOT signal_topic_editorial_plan_valid_v1(NEW.numeric_run_id,NEW.plan) OR NEW.plan_digest IS DISTINCT FROM NEW.plan->>'plan_digest'
   OR NEW.status<>'queued' OR NEW.state_body IS NOT NULL OR NEW.attempt_count<>0 OR NEW.dispatch_generation<>1 THEN
   RAISE EXCEPTION 'topic_editorial_owner_invalid' USING ERRCODE='23514';END IF;
 ELSE
  new_owner:=to_jsonb(jsonb_populate_record(NEW,'{"plan":null,"state_body":null}'::jsonb));
  old_owner:=to_jsonb(jsonb_populate_record(OLD,'{"plan":null,"state_body":null}'::jsonb));
  IF NEW.plan IS DISTINCT FROM OLD.plan OR (new_owner-ARRAY['status','dispatch_generation','execution_token','execution_expires_at','attempt_count','state_body','state_digest','result_revision_id','error_code','completed_at'])
   IS DISTINCT FROM (old_owner-ARRAY['status','dispatch_generation','execution_token','execution_expires_at','attempt_count','state_body','state_digest','result_revision_id','error_code','completed_at'])
  THEN RAISE EXCEPTION 'topic_editorial_owner_immutable' USING ERRCODE='23514';END IF;
  IF OLD.status='completed' AND (NEW.state_body IS DISTINCT FROM OLD.state_body OR new_owner IS DISTINCT FROM old_owner) THEN
   RAISE EXCEPTION 'topic_editorial_owner_immutable' USING ERRCODE='23514';
  ELSIF OLD.status='review_ready' THEN
   IF NEW.status<>'completed'
    OR ROW(NEW.dispatch_generation,NEW.execution_token,NEW.execution_expires_at,NEW.attempt_count,NEW.state_body,NEW.state_digest,NEW.error_code)
      IS DISTINCT FROM ROW(OLD.dispatch_generation,OLD.execution_token,OLD.execution_expires_at,OLD.attempt_count,OLD.state_body,OLD.state_digest,OLD.error_code)
    OR OLD.result_revision_id IS NOT NULL OR OLD.completed_at IS NOT NULL
    OR NEW.result_revision_id IS NULL OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'topic_editorial_completion_invalid' USING ERRCODE='23514';END IF;
   SELECT * INTO result_revision FROM signal_topic_consolidation_revisions
    WHERE id=NEW.result_revision_id AND consolidation_run_id=NEW.numeric_run_id AND workspace_id=NEW.workspace_id;
   IF result_revision.id IS NULL OR result_revision.status<>'validated' THEN
    RAISE EXCEPTION 'topic_editorial_completion_invalid' USING ERRCODE='23514';END IF;
  ELSIF NEW.status<>OLD.status AND NOT (OLD.status='queued' AND NEW.status IN('running','failed')
   OR OLD.status='running' AND NEW.status IN('queued','failed','review_ready') OR OLD.status='failed' AND NEW.status='queued') THEN
   RAISE EXCEPTION 'topic_editorial_transition_invalid' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.status IN('review_ready','completed') AND (NEW.state_body IS NULL OR NEW.state_body::jsonb->>'phase' IS DISTINCT FROM 'completed') THEN
  RAISE EXCEPTION 'topic_editorial_review_incomplete' USING ERRCODE='23514';END IF;
 IF NEW.state_body IS NOT NULL AND NEW.state_digest IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.state_body) THEN
  RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;

CREATE FUNCTION materialize_signal_topic_editorial_successor_v1(
 target_workspace uuid,target_actor uuid,target_execution uuid,expected_state_digest text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;r signal_topic_consolidation_runs%ROWTYPE;
 existing signal_topic_consolidation_revisions%ROWTYPE;parent signal_topic_consolidation_revisions%ROWTYPE;
 new_revision_id uuid:=gen_random_uuid();revision_number integer;new_revision_digest text;global_result jsonb;global_digest text;
 decisions jsonb;concept jsonb;validation jsonb;concept_count integer;decision_count integer;distinct_decisions integer;
 topic_count integer;narrative_count integer;noise_count integer;unresolved_count integer;target_range_met boolean;
BEGIN
 IF expected_state_digest IS NULL OR expected_state_digest!~'^sha256:[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'topic_editorial_materialization_digest_invalid' USING ERRCODE='22023';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=target_execution FOR UPDATE;
 IF e.id IS NULL OR e.workspace_id IS DISTINCT FROM target_workspace OR e.actor_user_id IS DISTINCT FROM target_actor THEN
  RAISE EXCEPTION 'topic_editorial_materialization_scope_invalid' USING ERRCODE='23514';END IF;
 IF e.state_digest IS DISTINCT FROM expected_state_digest OR e.state_body IS NULL
  OR e.state_body::jsonb->>'phase' IS DISTINCT FROM 'completed' THEN
  RAISE EXCEPTION 'topic_editorial_materialization_state_invalid' USING ERRCODE='23514';END IF;
 IF e.status='completed' THEN
  SELECT * INTO existing FROM signal_topic_consolidation_revisions
   WHERE id=e.result_revision_id AND consolidation_run_id=e.numeric_run_id AND workspace_id=e.workspace_id;
  IF existing.id IS NULL OR existing.status<>'validated' THEN
   RAISE EXCEPTION 'topic_editorial_materialization_replay_invalid' USING ERRCODE='23514';END IF;
  SELECT count(*)::integer,count(*) FILTER(WHERE kind='topic')::integer,count(*) FILTER(WHERE kind='narrative')::integer
   INTO concept_count,topic_count,narrative_count FROM signal_topic_editorial_concepts WHERE revision_id=existing.id;
  SELECT count(*)::integer,count(*) FILTER(WHERE disposition='noise')::integer,count(*) FILTER(WHERE disposition='unresolved')::integer
   INTO decision_count,noise_count,unresolved_count FROM signal_topic_consolidation_decisions WHERE revision_id=existing.id;
  RETURN jsonb_build_object('contract_version','signal-topic-editorial-materialization-v1','execution_id',e.id,
   'revision_id',existing.id,'revision',existing.revision,'status','completed','concept_count',concept_count,
   'decision_count',decision_count,'topic_count',topic_count,'narrative_count',narrative_count,
   'noise_count',noise_count,'unresolved_count',unresolved_count,'target_range_met',concept_count BETWEEN 24 AND 80,
   'activation','not_activated','replayed',true);
 END IF;
 IF e.status<>'review_ready' OR e.result_revision_id IS NOT NULL OR e.completed_at IS NOT NULL THEN
  RAISE EXCEPTION 'topic_editorial_materialization_not_ready' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM signal_topic_consolidation_runs WHERE id=e.numeric_run_id AND workspace_id=e.workspace_id FOR UPDATE;
 IF r.id IS NULL OR r.source_engine_execution_id IS DISTINCT FROM e.source_engine_execution_id
  OR r.status NOT IN('ready_for_review','reviewing') THEN
  RAISE EXCEPTION 'topic_editorial_materialization_source_invalid' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM signal_topic_consolidation_revisions WHERE consolidation_run_id=r.id AND status='validated') THEN
  RAISE EXCEPTION 'topic_editorial_materialization_current_revision_present' USING ERRCODE='23514';END IF;

 global_result:=e.state_body::jsonb->'global'->'result';
 IF jsonb_typeof(global_result) IS DISTINCT FROM 'object'
  OR global_result->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-global-result-v1'
  OR jsonb_typeof(global_result->'concepts') IS DISTINCT FROM 'array'
  OR jsonb_typeof(global_result->'noise_group_keys') IS DISTINCT FROM 'array'
  OR jsonb_typeof(global_result->'unresolved_group_keys') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'topic_editorial_materialization_result_invalid' USING ERRCODE='23514';END IF;
 concept_count:=jsonb_array_length(global_result->'concepts');target_range_met:=concept_count BETWEEN 24 AND 80;
 IF concept_count>120 THEN RAISE EXCEPTION 'topic_editorial_materialization_hard_cap_exceeded' USING ERRCODE='23514';END IF;
 IF (SELECT count(DISTINCT value->>'concept_key') FROM jsonb_array_elements(global_result->'concepts'))<>concept_count
  OR (SELECT count(DISTINCT lower(value->>'label')) FROM jsonb_array_elements(global_result->'concepts'))<>concept_count
  OR (SELECT count(DISTINCT (value->>'priority_rank')::integer) FROM jsonb_array_elements(global_result->'concepts'))<>concept_count
  OR (SELECT min((value->>'priority_rank')::integer) FROM jsonb_array_elements(global_result->'concepts'))<>1
  OR (SELECT max((value->>'priority_rank')::integer) FROM jsonb_array_elements(global_result->'concepts'))<>concept_count THEN
  RAISE EXCEPTION 'topic_editorial_materialization_concepts_invalid' USING ERRCODE='23514';END IF;
 FOR concept IN SELECT value FROM jsonb_array_elements(global_result->'concepts') LOOP
  IF jsonb_typeof(concept) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(concept))<>8
   OR jsonb_typeof(concept->'concept_key') IS DISTINCT FROM 'string'
   OR jsonb_typeof(concept->'kind') IS DISTINCT FROM 'string'
   OR jsonb_typeof(concept->'label') IS DISTINCT FROM 'string'
   OR jsonb_typeof(concept->'definition') IS DISTINCT FROM 'string'
   OR jsonb_typeof(concept->'locale') IS DISTINCT FROM 'string'
   OR jsonb_typeof(concept->'priority_rank') IS DISTINCT FROM 'number'
   OR jsonb_typeof(concept->'priority_rationale') IS DISTINCT FROM 'string'
   OR concept->>'kind' NOT IN('topic','narrative')
   OR concept->>'concept_key'!~'^[a-z0-9]+(?:-[a-z0-9]+)*$'
   OR concept->>'concept_key' NOT LIKE concept->>'kind'||'-%'
   OR octet_length(btrim(concept->>'label')) NOT BETWEEN 1 AND 120 OR btrim(concept->>'label') IS DISTINCT FROM concept->>'label'
   OR octet_length(btrim(concept->>'definition')) NOT BETWEEN 1 AND 500 OR btrim(concept->>'definition') IS DISTINCT FROM concept->>'definition'
   OR concept->>'locale' IS DISTINCT FROM e.plan->>'default_locale' OR octet_length(concept->>'locale') NOT BETWEEN 1 AND 35
   OR NOT COALESCE(concept->>'priority_rank'~'^[1-9][0-9]{0,2}$',false)
   OR (concept->>'priority_rank')::integer>120
   OR octet_length(btrim(concept->>'priority_rationale')) NOT BETWEEN 1 AND 280
   OR btrim(concept->>'priority_rationale') IS DISTINCT FROM concept->>'priority_rationale'
   OR jsonb_typeof(concept->'member_group_keys') IS DISTINCT FROM 'array'
   OR jsonb_array_length(concept->'member_group_keys') NOT BETWEEN 1 AND 5000
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(concept->'member_group_keys'))
      <>jsonb_array_length(concept->'member_group_keys') THEN
   RAISE EXCEPTION 'topic_editorial_materialization_concepts_invalid' USING ERRCODE='23514';END IF;
 END LOOP;
 global_digest:=signal_semantic_context_digest_json_v2(global_result);
 SELECT COALESCE(jsonb_agg(item ORDER BY item->>'group_key' COLLATE "C"),'[]'::jsonb) INTO decisions FROM(
  SELECT jsonb_build_object('group_key',member.value,'disposition',concept.value->>'kind','concept_key',concept.value->>'concept_key') item
   FROM jsonb_array_elements(global_result->'concepts') concept(value)
   CROSS JOIN LATERAL jsonb_array_elements_text(concept.value->'member_group_keys') member(value)
  UNION ALL SELECT jsonb_build_object('group_key',value,'disposition','noise','concept_key',NULL)
   FROM jsonb_array_elements_text(global_result->'noise_group_keys') item(value)
  UNION ALL SELECT jsonb_build_object('group_key',value,'disposition','unresolved','concept_key',NULL)
   FROM jsonb_array_elements_text(global_result->'unresolved_group_keys') item(value)
 ) all_decisions;
 decision_count:=jsonb_array_length(decisions);
 SELECT count(DISTINCT value->>'group_key')::integer INTO distinct_decisions FROM jsonb_array_elements(decisions);
 IF decision_count<>r.expected_group_count OR distinct_decisions<>r.expected_group_count
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(decisions) d
    WHERE NOT EXISTS(SELECT 1 FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=r.id AND g.group_key=d.value->>'group_key'))
  OR EXISTS(SELECT 1 FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=r.id
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(decisions) d WHERE d.value->>'group_key'=g.group_key)) THEN
  RAISE EXCEPTION 'topic_editorial_materialization_coverage_invalid' USING ERRCODE='23514';END IF;
 IF EXISTS(
  WITH screening AS(SELECT decision FROM jsonb_array_elements(e.state_body::jsonb->'screening_outputs') output
   CROSS JOIN LATERAL jsonb_array_elements(output->'decisions') decision)
  SELECT 1 FROM jsonb_array_elements(decisions) final LEFT JOIN screening ON screening.decision->>'group_key'=final.value->>'group_key'
   WHERE screening.decision IS NULL
    OR screening.decision->>'disposition' IN('noise','unresolved')
      AND screening.decision->>'disposition' IS DISTINCT FROM final.value->>'disposition'
    OR final.value->>'disposition' IN('topic','narrative')
      AND screening.decision->>'disposition' IS DISTINCT FROM final.value->>'disposition') THEN
  RAISE EXCEPTION 'topic_editorial_materialization_disposition_invalid' USING ERRCODE='23514';END IF;

 SELECT * INTO parent FROM signal_topic_consolidation_revisions WHERE consolidation_run_id=r.id ORDER BY revision DESC LIMIT 1;
 revision_number:=COALESCE(parent.revision,0)+1;
 INSERT INTO signal_topic_consolidation_revisions(id,consolidation_run_id,workspace_id,source_engine_execution_id,revision,status,parent_revision_id,created_by_user_id)
 VALUES(new_revision_id,r.id,e.workspace_id,e.source_engine_execution_id,revision_number,'draft',parent.id,e.actor_user_id);
 INSERT INTO signal_topic_editorial_concepts(revision_id,consolidation_run_id,workspace_id,concept_key,kind,label,definition,locale,source,metadata)
 SELECT new_revision_id,r.id,e.workspace_id,value->>'concept_key',value->>'kind',value->>'label',value->>'definition',value->>'locale','model',
  jsonb_build_object('contract_version','signal-topic-editorial-concept-metadata-v1','editorial_execution_id',e.id,
   'global_result_digest',global_digest,'priority_rank',(value->>'priority_rank')::integer,
   'priority_rationale',value->>'priority_rationale','target_range_met',target_range_met)
 FROM jsonb_array_elements(global_result->'concepts');
 INSERT INTO signal_topic_consolidation_decisions(revision_id,atomic_group_id,consolidation_run_id,workspace_id,disposition,concept_id,source,confidence,rationale,decision_digest)
 SELECT new_revision_id,g.id,r.id,e.workspace_id,final.value->>'disposition',concept_row.id,'model',
  CASE WHEN jsonb_typeof(screening.decision->'confidence')='number' THEN (screening.decision->>'confidence')::double precision ELSE NULL END,
  CASE WHEN jsonb_typeof(screening.decision->'rationale')='string' THEN screening.decision->>'rationale' ELSE NULL END,
  signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','signal-topic-consolidation-decision-v1',
   'global_result_digest',global_digest,'group_key',g.group_key,'group_digest',g.group_digest,
   'disposition',final.value->>'disposition','concept_key',final.value->>'concept_key','source','model'))
 FROM jsonb_array_elements(decisions) final
 JOIN signal_topic_atomic_groups g ON g.consolidation_run_id=r.id AND g.group_key=final.value->>'group_key'
 LEFT JOIN signal_topic_editorial_concepts concept_row ON concept_row.revision_id=new_revision_id AND concept_row.concept_key=final.value->>'concept_key'
 LEFT JOIN LATERAL(SELECT decision FROM jsonb_array_elements(e.state_body::jsonb->'screening_outputs') output
  CROSS JOIN LATERAL jsonb_array_elements(output->'decisions') decision WHERE decision->>'group_key'=g.group_key LIMIT 1) screening ON true;
 validation:=validate_signal_topic_consolidation_revision_v1(new_revision_id);
 IF validation IS NULL OR NOT COALESCE((validation->>'complete')::boolean,false)
  OR (validation->>'decision_count')::integer IS DISTINCT FROM r.expected_group_count THEN
  RAISE EXCEPTION 'topic_editorial_materialization_revision_invalid' USING ERRCODE='23514';END IF;
 SELECT signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','signal-topic-consolidation-materialized-revision-v1',
  'editorial_execution_id',e.id,'numeric_run_id',r.id,'state_digest',e.state_digest,'global_result_digest',global_digest,
  'concepts',COALESCE((SELECT jsonb_agg(jsonb_build_object('concept_key',c.concept_key,'kind',c.kind,'label',c.label,
   'definition',c.definition,'locale',c.locale,'metadata',c.metadata) ORDER BY c.concept_key COLLATE "C")
   FROM signal_topic_editorial_concepts c WHERE c.revision_id=new_revision_id),'[]'::jsonb),
  'decisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('group_key',g.group_key,'group_digest',g.group_digest,
   'disposition',d.disposition,'concept_key',c.concept_key,'decision_digest',d.decision_digest) ORDER BY g.group_key COLLATE "C")
   FROM signal_topic_consolidation_decisions d JOIN signal_topic_atomic_groups g ON g.id=d.atomic_group_id
   LEFT JOIN signal_topic_editorial_concepts c ON c.id=d.concept_id WHERE d.revision_id=new_revision_id),'[]'::jsonb))) INTO new_revision_digest;
 UPDATE signal_topic_consolidation_revisions SET status='validated',revision_digest=new_revision_digest,validated_at=clock_timestamp()
  WHERE id=new_revision_id;
 UPDATE signal_topic_consolidation_runs SET status='validated',completed_at=COALESCE(completed_at,clock_timestamp()) WHERE id=r.id;
 UPDATE signal_topic_editorial_executions SET status='completed',result_revision_id=new_revision_id,completed_at=clock_timestamp()
  WHERE id=e.id;
 SELECT count(*) FILTER(WHERE kind='topic')::integer,count(*) FILTER(WHERE kind='narrative')::integer
  INTO topic_count,narrative_count FROM signal_topic_editorial_concepts WHERE revision_id=new_revision_id;
 SELECT count(*) FILTER(WHERE disposition='noise')::integer,count(*) FILTER(WHERE disposition='unresolved')::integer
  INTO noise_count,unresolved_count FROM signal_topic_consolidation_decisions WHERE revision_id=new_revision_id;
 RETURN jsonb_build_object('contract_version','signal-topic-editorial-materialization-v1','execution_id',e.id,
  'revision_id',new_revision_id,'revision',revision_number,'status','completed','concept_count',concept_count,
  'decision_count',decision_count,'topic_count',topic_count,'narrative_count',narrative_count,
  'noise_count',noise_count,'unresolved_count',unresolved_count,'target_range_met',target_range_met,
  'activation','not_activated','replayed',false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
 RAISE EXCEPTION 'topic_editorial_materialization_result_invalid' USING ERRCODE='23514';
END;$$;

COMMENT ON FUNCTION materialize_signal_topic_editorial_successor_v1(uuid,uuid,uuid,text) IS
 'Provider-free, idempotent materialization of one completed editorial execution into a validated SQL0174 successor revision. Does not activate serving.';
REVOKE ALL ON FUNCTION materialize_signal_topic_editorial_successor_v1(uuid,uuid,uuid,text) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION materialize_signal_topic_editorial_successor_v1(uuid,uuid,uuid,text) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_owner_guard_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION signal_topic_editorial_owner_guard_v1() FROM PUBLIC;
