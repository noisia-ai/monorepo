-- Validate every affected Listening call against ONE fresh population per
-- statement/owner. Transition relations, not a GUC or caller cache, identify the
-- rows. Existing row immutability/requeue, human INSERT exclusion, all monetary
-- fences and post-work physical-clock checks remain authoritative.
CREATE FUNCTION signal_listening_statement_roots_v1(ids uuid[]) RETURNS uuid[]
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE roots uuid[];
BEGIN
 IF ids IS NULL THEN RAISE EXCEPTION 'listening_statement_roots_invalid' USING ERRCODE='22023'; END IF;
 SELECT ARRAY(SELECT DISTINCT id FROM unnest(ids) id ORDER BY id LIMIT 4097) INTO roots;
 IF cardinality(roots) NOT BETWEEN 1 AND 4096 OR array_position(roots,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'listening_statement_roots_invalid' USING ERRCODE='22023'; END IF;
 RETURN roots;
END $$;
REVOKE ALL ON FUNCTION signal_listening_statement_roots_v1(uuid[]) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION signal_listening_statement_roots_v1(uuid[]) FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION signal_listening_statement_roots_v1(uuid[]) FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT EXECUTE ON FUNCTION signal_listening_statement_roots_v1(uuid[]) TO service_role; END IF;
END $$;

CREATE OR REPLACE FUNCTION signal_listening_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_listening_runs;r signal_labeling_runs;requeue jsonb;unsent boolean:=false;
BEGIN
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id;
 IF owner.run_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=owner.run_id;
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
  IF NEW.id IS DISTINCT FROM OLD.id OR ROW(NEW.run_id,NEW.workspace_id,NEW.provider,NEW.model,NEW.transport,NEW.custom_id,NEW.request_digest,NEW.request,NEW.inputs,
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
  -- The AFTER STATEMENT guard validates authority, fresh eligibility and the
  -- exact request for every changed call atomically. No caller-supplied marker
  -- or transaction-wide approval can authorize this row.
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE targets uuid[];target uuid;r signal_labeling_runs;admission signal_processing_admissions;action_cap bigint;
 policy record;spent bigint;parent record;owner signal_listening_runs;c signal_listening_configurations;
 batch_sql text;root_ids uuid[];invalid boolean;checked record;policy_zone text;
BEGIN
 IF TG_OP='INSERT' THEN
  batch_sql:='SELECT n.* FROM listening_new_calls n WHERE n.run_id=$1';
  SELECT array_agg(DISTINCT n.run_id ORDER BY n.run_id) INTO targets FROM listening_new_calls n
   JOIN signal_listening_runs owner ON owner.run_id=n.run_id AND owner.workspace_id=n.workspace_id;
 ELSE
  batch_sql:='SELECT n.* FROM listening_new_calls n JOIN listening_old_calls o ON o.id=n.id WHERE n.run_id=$1 AND o.status=''reserved'' AND n.status=''submitting''';
  SELECT array_agg(DISTINCT n.run_id ORDER BY n.run_id) INTO targets FROM listening_new_calls n
   JOIN listening_old_calls o ON o.id=n.id JOIN signal_listening_runs owner ON owner.run_id=n.run_id AND owner.workspace_id=n.workspace_id
   WHERE o.status='reserved' AND n.status='submitting';
 END IF;
 IF targets IS NULL THEN RETURN NULL; END IF;
 FOR target IN SELECT unnest(targets) LOOP
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  PERFORM signal_listening_call_authority_v1(target,admission.budget_date,admission.budget_timezone,NULL);
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO owner FROM signal_listening_runs WHERE run_id=target AND workspace_id=r.workspace_id;
  SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
  IF c.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=r.workspace_id AND state='published')
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=r.workspace_id AND feature='mass_labeling')
   OR r.entity_context_digest IS DISTINCT FROM(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=r.workspace_id ORDER BY version_no DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps m JOIN signal_corpus_preparation_input_state s
    ON s.workspace_id=m.workspace_id AND s.input_revision=m.input_revision WHERE m.id=owner.map_id AND m.workspace_id=r.workspace_id)
  THEN RAISE EXCEPTION 'listening_run_stale'; END IF;
  -- One typed allowlist built ONLY from this statement's actual transition
  -- rows. NULL/empty can never reach the native selector as a full-corpus read.
  EXECUTE format('SELECT signal_listening_statement_roots_v1(array_agg((n.inputs->0->>''root_id'')::uuid)) FROM (%s) n',batch_sql)
   INTO root_ids USING target;
  EXECUTE format('SELECT COALESCE(bool_or(n.budget_date IS DISTINCT FROM $2 OR n.budget_timezone IS DISTINCT FROM $3),false) FROM (%s) n',batch_sql)
   INTO invalid USING target,admission.budget_date,admission.budget_timezone;
  IF invalid THEN RAISE EXCEPTION 'listening_budget_invalid' USING ERRCODE='23514'; END IF;
  SELECT budget_timezone INTO policy_zone FROM signal_processing_policy_versions WHERE id=admission.policy_version_id;
  EXECUTE format('SELECT COALESCE(bool_or((n.created_at AT TIME ZONE $3)::date IS DISTINCT FROM $2),false) FROM (%s) n',batch_sql)
   INTO invalid USING target,admission.budget_date,policy_zone;
  IF invalid THEN RAISE EXCEPTION 'processing_budget_date_expired' USING ERRCODE='23514'; END IF;
  EXECUTE format($validation$
   WITH batch AS MATERIALIZED(%s),
   population AS MATERIALIZED(
    SELECT p.* FROM signal_listening_population_roots_v1($2,$3,$4,$5,$6,'llm-processing') p
   ),
   requested AS MATERIALIZED(
    SELECT DISTINCT n.id,(n.inputs->0->>'root_id')::uuid root_id,n.inputs->0->>'input_digest' input_digest,k.question_key
    FROM batch n CROSS JOIN LATERAL jsonb_array_elements_text(n.inputs->0->'question_keys') k(question_key)
   ),
   selected AS(
    SELECT k.id,count(*)::int selected_count,jsonb_object_agg(p.question_key,p.wire) questions,
     jsonb_object_agg(p.question_key,to_jsonb(p.question_digest)) digests,
     COALESCE(jsonb_object_agg(p.question_key,to_jsonb(p.scope_basis)) FILTER(WHERE p.scope_basis IS NOT NULL),'{}'::jsonb) basis
    FROM requested k JOIN population p ON p.root_id=k.root_id AND p.input_digest=k.input_digest AND p.question_key=k.question_key
    WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL GROUP BY k.id
   ),
   expected AS(
    SELECT n.*,n.inputs->0 i,s.selected_count,s.digests,s.basis,
     CASE WHEN item.root_id IS NULL THEN NULL ELSE jsonb_build_object('model','jev-1.13.0','state',item.text,'questions',s.questions) END expected_request
    FROM batch n LEFT JOIN selected s ON s.id=n.id
    LEFT JOIN signal_mass_labeling_items item ON item.workspace_id=$2 AND item.map_id=$4 AND item.root_id=(n.inputs->0->>'root_id')::uuid
   )
   SELECT COALESCE((SELECT bool_or(COALESCE(selected_count,0) NOT BETWEEN 1 AND 256
     OR selected_count IS DISTINCT FROM jsonb_array_length(i->'question_keys')
     OR i->>'configuration_digest' IS DISTINCT FROM $7 OR i->>'map_id' IS DISTINCT FROM $4::text
     OR i->'question_digests' IS DISTINCT FROM digests OR i->'scope_basis' IS DISTINCT FROM basis) FROM expected),false) invalid_questions,
    COALESCE((SELECT bool_or(request IS DISTINCT FROM expected_request OR i->>'text' IS DISTINCT FROM expected_request->>'state'
     OR request_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_object('request_version','listening-jev-v1','run_id',$1,
      'root_id',i->'root_id','input_digest',i->'input_digest','entity_context_digest',$5,
      'question_digests',digests,'scope_basis',basis,'request',expected_request))) FROM expected),false) invalid_request,
    EXISTS(SELECT 1 FROM population pending
     JOIN signal_listening_call_questions link ON link.workspace_id=$2 AND link.root_id=pending.root_id AND link.question_digest=pending.question_digest
     JOIN signal_labeling_calls call ON call.workspace_id=$2 AND call.id=link.call_id
     JOIN signal_labeling_runs other_run ON other_run.id=call.run_id AND other_run.workspace_id=$2 AND other_run.entity_context_digest=$5
     WHERE pending.answer IS NULL AND pending.candidate AND pending.scope_state<>'excluded' AND call.run_id IS DISTINCT FROM $1
      AND call.inputs->0->>'input_digest'=pending.input_digest
      AND(call.status IN('submitting','submitted','unknown') OR call.terminal_exposure_micro_usd>0
       OR call.status='failed' AND COALESCE(call.settled_micro_usd,0)>0 OR call.raw_storage_key IS NOT NULL AND NOT call.results_applied)) invalid_prior
  $validation$,batch_sql) INTO checked USING target,r.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest,root_ids,c.configuration_digest;
  IF checked.invalid_questions THEN RAISE EXCEPTION 'listening_call_questions_invalid'; END IF;
  IF checked.invalid_request THEN RAISE EXCEPTION 'listening_request_invalid'; END IF;
  IF checked.invalid_prior THEN RAISE EXCEPTION 'listening_prior_outcome_unresolved'; END IF;

  SELECT max_execution_micro_usd INTO action_cap FROM signal_processing_policy_actions
   WHERE policy_version_id=admission.policy_version_id AND action=admission.action;
  IF NOT FOUND THEN RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
  -- Identical to readSignalLabelingRunExposureV1: ambiguous work keeps its
  -- reservation and terminal exposure never disappears behind a failed row.
  SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd
   ELSE reserved_micro_usd END),0) INTO spent FROM signal_labeling_calls WHERE run_id=target;
  IF spent>r.cap_micro_usd OR spent>admission.execution_cap_micro_usd OR spent>action_cap THEN
   RAISE EXCEPTION 'labeling_cap_exhausted' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR policy IN SELECT DISTINCT p.id,p.organization_id,p.budget_timezone,p.daily_cap_micro_usd,ad.budget_date
  FROM signal_labeling_runs run JOIN signal_processing_admissions ad ON ad.id=run.processing_admission_id
  JOIN signal_processing_policy_versions p ON p.id=ad.policy_version_id WHERE run.id=ANY(targets)
  ORDER BY p.organization_id,ad.budget_date,p.id LOOP
  SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(policy.organization_id,policy.budget_date,policy.budget_timezone);
  IF spent>policy.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR parent IN SELECT DISTINCT execution.id,execution.cap_micro_usd FROM signal_listening_discovery_children child
  JOIN signal_listening_discovery_executions execution ON execution.id=child.execution_id AND execution.workspace_id=child.workspace_id
  WHERE child.run_id=ANY(targets) ORDER BY execution.id LOOP
  PERFORM 1 FROM signal_listening_discovery_executions WHERE id=parent.id FOR UPDATE;
  IF signal_listening_discovery_exposure_v1(parent.id)>parent.cap_micro_usd THEN
   RAISE EXCEPTION 'listening_discovery_parent_cap_exhausted'; END IF;
 END LOOP;
 -- A large final aggregate may cross the physical lease or admission expiry.
 -- Recheck after that work, while all original authority locks remain held.
 FOR target IN SELECT unnest(targets) LOOP
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  PERFORM signal_listening_call_authority_v1(target,admission.budget_date,admission.budget_timezone,NULL);
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO owner FROM signal_listening_runs WHERE run_id=target AND workspace_id=r.workspace_id;
  SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
  IF c.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=r.workspace_id AND state='published')
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=r.workspace_id AND feature='mass_labeling')
   OR r.entity_context_digest IS DISTINCT FROM(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=r.workspace_id ORDER BY version_no DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps m JOIN signal_corpus_preparation_input_state s
    ON s.workspace_id=m.workspace_id AND s.input_revision=m.input_revision WHERE m.id=owner.map_id AND m.workspace_id=r.workspace_id)
  THEN RAISE EXCEPTION 'listening_run_stale'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION signal_listening_discovery_child_capacity_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE parent_id uuid;cap bigint;amount bigint;kind text;
BEGIN
 IF TG_TABLE_NAME='signal_labeling_calls' THEN
  -- Listening validates its parent cap once in the transition-table guard,
  -- after native policy/day/actor locks. Taking parent here first would invert
  -- the complete/advance order for direct SQL callers. Other owners and the
  -- entire Voyage branch retain their original row-level checks below.
  IF EXISTS(SELECT 1 FROM signal_listening_runs owner WHERE owner.run_id=NEW.run_id AND owner.workspace_id=NEW.workspace_id) THEN RETURN NEW; END IF;
 SELECT execution_id INTO parent_id FROM signal_listening_discovery_children WHERE run_id=NEW.run_id;
 kind:='labeling';
 IF parent_id IS NULL OR NOT(TG_OP='INSERT' OR OLD.status='reserved' AND NEW.status='submitting') THEN RETURN NEW;END IF;
 -- Keep the same parent lock before any row can become sendable.
 -- The final transition-table check below includes every sibling at once.
 PERFORM 1 FROM signal_listening_discovery_executions WHERE id=parent_id FOR UPDATE;
 RETURN NEW;
 ELSE
 SELECT p.id INTO parent_id FROM signal_listening_discovery_executions p WHERE p.initial_preparation_id IN(SELECT id FROM signal_listening_preparations WHERE prototype_run_id=NEW.run_id)
 UNION SELECT execution_id FROM signal_listening_discovery_children child JOIN signal_listening_preparations flow ON flow.id=child.preparation_id WHERE flow.prototype_run_id=NEW.run_id UNION SELECT r.execution_id FROM signal_listening_discovery_rounds r JOIN signal_listening_preparations flow ON flow.id=r.classification_preparation_id WHERE flow.prototype_run_id=NEW.run_id LIMIT 1;
 kind:='voyage';
 IF parent_id IS NULL OR NOT(TG_OP='INSERT' OR OLD.status='reserved' AND NEW.status='in_flight') THEN RETURN NEW;END IF;
 amount:=NEW.reserved_micro_usd;
 END IF;
 SELECT cap_micro_usd INTO cap FROM signal_listening_discovery_executions WHERE id=parent_id FOR UPDATE;
 IF signal_listening_discovery_exposure_v1(parent_id,kind,NEW.id)+amount>cap THEN RAISE EXCEPTION 'listening_discovery_parent_cap_exhausted';END IF;
 RETURN NEW;
END $$;

-- Its exact unresolved-physical-attempt predicate is now evaluated above using
-- the same fresh materialized population. The public admission helper remains
-- unchanged; only this redundant per-row trigger is retired.
DROP TRIGGER signal_listening_cross_run_call_guard ON signal_labeling_calls;
