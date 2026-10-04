-- Optional strict maximum for MFP discovery consolidation, using its existing batch owners.
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT processing_nullable_action_cap;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT processing_nullable_action_cap CHECK(max_execution_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','corpus_embeddings','topic_interpretation','topic_consolidation'));
ALTER TABLE signal_processing_admissions DROP CONSTRAINT processing_nullable_admission_cap;
ALTER TABLE signal_processing_admissions ADD CONSTRAINT processing_nullable_admission_cap CHECK(execution_cap_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','corpus_embeddings','topic_interpretation','topic_consolidation'));
ALTER TABLE signal_topic_editorial_executions ALTER COLUMN hard_cap_micro_usd DROP NOT NULL;
CREATE FUNCTION signal_topic_discovery_run_v1(target_run uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_topic_consolidation_runs r JOIN signal_topic_catalog_executions e
  ON e.id=r.source_engine_execution_id AND e.workspace_id=r.workspace_id
  WHERE r.id=target_run AND e.input_contract='workspace-topic-engine-v1' AND jsonb_typeof(e.input_snapshot->'discovery_population')='object')
$$;
REVOKE ALL ON FUNCTION signal_topic_discovery_run_v1(uuid) FROM PUBLIC;

-- Source revision reuses the existing context families without a midnight expiry
-- or the unrelated legacy semantic-publication history.
CREATE FUNCTION signal_workspace_discovery_context_revision_v1(target_workspace uuid) RETURNS text LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 WITH scope AS MATERIALIZED (SELECT id,brand_id FROM signal_workspaces WHERE id=target_workspace),
 profiles AS MATERIALIZED (SELECT p.* FROM brand_os_profiles p JOIN scope s ON p.brand_id=s.brand_id),
 sources AS MATERIALIZED (SELECT k.* FROM brand_knowledge_sources k JOIN scope s ON k.brand_id=s.brand_id),
 entities AS MATERIALIZED (SELECT e.* FROM intelligence_entities e JOIN scope s ON e.brand_id=s.brand_id),
 members AS (
  SELECT 'workspace' kind,w.id::text id,signal_semantic_context_digest_v1(to_jsonb(w)::text) hash FROM signal_workspaces w JOIN scope s ON w.id=s.id
  UNION ALL SELECT 'brand',b.id::text,signal_semantic_context_digest_v1(to_jsonb(b)::text) FROM brands b JOIN scope s ON b.id=s.brand_id
  UNION ALL SELECT 'profile',p.id::text,signal_semantic_context_digest_v1(to_jsonb(p)::text) FROM profiles p
  UNION ALL SELECT 'objective',o.id::text,signal_semantic_context_digest_v1(to_jsonb(o)::text) FROM brand_os_objectives o JOIN profiles p ON o.brand_os_profile_id=p.id
  UNION ALL SELECT 'brief',b.id::text,signal_semantic_context_digest_v1(to_jsonb(b)::text) FROM brand_os_briefs b JOIN profiles p ON b.brand_os_profile_id=p.id
  UNION ALL SELECT 'audience',a.id::text,signal_semantic_context_digest_v1(to_jsonb(a)::text) FROM brand_os_audiences a JOIN profiles p ON a.brand_os_profile_id=p.id
  UNION ALL SELECT 'product',p.id::text,signal_semantic_context_digest_v1(to_jsonb(p)::text) FROM brand_os_products p JOIN profiles profile ON p.brand_os_profile_id=profile.id
  UNION ALL SELECT 'claim',c.id::text,signal_semantic_context_digest_v1(to_jsonb(c)::text) FROM brand_os_claims c JOIN profiles p ON c.brand_os_profile_id=p.id
  UNION ALL SELECT 'knowledge_source',k.id::text,signal_semantic_context_digest_v1(to_jsonb(k)::text) FROM sources k
  UNION ALL SELECT 'knowledge_chunk',c.id::text,signal_semantic_context_digest_v1(to_jsonb(c)::text) FROM knowledge_chunks c JOIN sources k ON c.knowledge_source_id=k.id
  UNION ALL SELECT 'knowledge_assertion',a.id::text,signal_semantic_context_digest_v1(to_jsonb(a)::text||
    ((a.valid_from IS NULL OR a.valid_from<=(statement_timestamp() AT TIME ZONE 'UTC')::date)
      AND (a.valid_to IS NULL OR a.valid_to>=(statement_timestamp() AT TIME ZONE 'UTC')::date))::text) FROM knowledge_assertions a JOIN sources k ON a.knowledge_source_id=k.id
  UNION ALL SELECT 'competitor',c.id::text,signal_semantic_context_digest_v1(to_jsonb(c)::text) FROM competitors c JOIN scope s ON c.brand_id=s.brand_id
  UNION ALL SELECT 'competitor_seed',b.id::text,signal_semantic_context_digest_v1(to_jsonb(b)::text) FROM brand_seeds b
   WHERE EXISTS(SELECT 1 FROM competitors c JOIN scope s ON c.brand_id=s.brand_id WHERE c.competitor_brand_seed_id=b.id)
  UNION ALL SELECT 'entity',e.id::text,signal_semantic_context_digest_v1(to_jsonb(e)::text) FROM entities e
  UNION ALL SELECT 'entity_alias',a.id::text,signal_semantic_context_digest_v1(to_jsonb(a)::text) FROM entity_aliases a JOIN entities e ON a.entity_id=e.id
  UNION ALL SELECT 'acquisition',p.id::text,signal_semantic_context_digest_v1(to_jsonb(p)::text) FROM signal_acquisition_plans p JOIN scope s ON p.workspace_id=s.id

 )
 SELECT CASE WHEN EXISTS(SELECT 1 FROM scope) THEN signal_semantic_context_digest_v1(
  COALESCE(string_agg(kind||':'||id||':'||hash,',' ORDER BY kind COLLATE "C",id COLLATE "C"),'')) END
 FROM members
$$;
REVOKE ALL ON FUNCTION signal_workspace_discovery_context_revision_v1(uuid) FROM PUBLIC;


-- Native MFP binds the current Brand OS/KB/locale revision directly.
-- The legacy source retains its published semantic-generation requirement.
CREATE OR REPLACE FUNCTION signal_topic_editorial_source_v1(target_run uuid) RETURNS jsonb LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('numeric_run_id',r.id,'workspace_id',r.workspace_id,'source_engine_execution_id',r.source_engine_execution_id,
  'census_digest',r.census_digest,'configuration_digest',r.configuration_digest,'community_plan_digest',r.community_plan_digest,
  'source_checkpoint_digest',r.source_checkpoint_digest,'context_digest',r.context_digest,'expected_group_count',r.expected_group_count,
  'centroid_artifact_id',r.centroid_artifact_id,'centroid_artifact_sha256',r.centroid_artifact_sha256,
  'numeric_source_binding',c.source_binding,'semantic_generation_id',g.id,'semantic_pack_digest',g.pack_digest)
 FROM signal_topic_consolidation_runs r JOIN signal_topic_consolidation_executions c ON c.consolidation_run_id=r.id
  AND c.workspace_id=r.workspace_id AND c.status='ready' AND c.census_digest=r.census_digest
 JOIN signal_topic_catalog_executions engine ON engine.id=r.source_engine_execution_id AND engine.workspace_id=r.workspace_id
 LEFT JOIN LATERAL(SELECT candidate.id,candidate.pack_digest FROM signal_semantic_context_generations candidate
  WHERE candidate.workspace_id=r.workspace_id AND candidate.status='published'
    AND NOT signal_topic_discovery_run_v1(r.id)
  ORDER BY candidate.generation_version DESC LIMIT 1) g ON true
 WHERE r.id=target_run AND r.status IN('ready_for_review','reviewing','validated')
  AND CASE WHEN signal_topic_discovery_run_v1(r.id) THEN
    engine.input_snapshot->>'discovery_context_revision'=signal_workspace_discovery_context_revision_v1(r.workspace_id)
    ELSE signal_brand_context_processing_source_current_v1(g.id) END
  AND c.source_binding=signal_topic_consolidation_source_binding_v1(r.source_engine_execution_id)
  AND r.expected_group_count BETWEEN 1 AND 5000 AND r.community_plan_digest IS NOT NULL
  AND r.expected_group_count=(SELECT count(*) FROM signal_topic_atomic_groups WHERE consolidation_run_id=r.id)
  AND r.expected_group_count=(SELECT count(*) FROM signal_topic_consolidation_community_members WHERE consolidation_run_id=r.id)
 $$;



CREATE OR REPLACE FUNCTION signal_topic_editorial_quote_fast_v2(target_workspace uuid,target_actor uuid,target_run uuid,
 target_plan_digest text,target_group_count integer,expected_deadline bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=public,extensions,pg_temp AS $$
DECLARE source jsonb;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 org uuid;exposure bigint;expiry bigint;send_deadline timestamptz;body jsonb;cap bigint;day date;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN RETURN '{"status":"access_required"}'::jsonb;END IF;
 source:=signal_topic_editorial_source_v1(target_run);
 IF source IS NULL OR source->>'workspace_id'<>target_workspace::text
  OR target_plan_digest !~ '^sha256:[a-f0-9]{64}$'
  OR target_group_count IS DISTINCT FROM (source->>'expected_group_count')::integer THEN
  RETURN '{"status":"source_stale"}'::jsonb;END IF;
 SELECT organization_id INTO org FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=org AND status='active';
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN RETURN '{"status":"policy_required"}'::jsonb;END IF;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF a.action IS NULL OR a.automatic_allowed OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR a.provider IS DISTINCT FROM 'anthropic' OR a.model IS DISTINCT FROM 'claude-sonnet-4-6' THEN
  RETURN '{"status":"policy_action_required"}'::jsonb;END IF;
 cap:=a.max_execution_micro_usd;day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(org,day,p.budget_timezone);
 IF (cap IS NULL AND NOT signal_topic_discovery_run_v1(target_run)) OR cap<=0 OR exposure IS NULL OR exposure::numeric+cap::numeric>p.daily_cap_micro_usd::numeric THEN
  RETURN '{"status":"budget_unavailable"}'::jsonb;END IF;
 send_deadline:=CASE WHEN signal_topic_discovery_run_v1(target_run) THEN p.valid_until ELSE least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone)) END;
 expiry:=COALESCE(expected_deadline,floor(extract(epoch FROM least(clock_timestamp()+interval '1 hour',send_deadline)))::bigint);
 IF to_timestamp(expiry)<=clock_timestamp() OR to_timestamp(expiry)>least(clock_timestamp()+interval '1 hour',send_deadline) THEN
  RETURN '{"status":"quote_expired"}'::jsonb;END IF;
 body:=jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'run_id',target_run,
  'source_binding',source,'plan_digest',target_plan_digest,'policy_id',p.id,'policy_digest',p.policy_digest,
  'configuration_digest',a.configuration_digest,'hard_cap_micro_usd',cap::text,'budget_date',day::text,
  'budget_timezone',p.budget_timezone,'send_deadline',send_deadline,'deadline',expiry::text);
 RETURN body||jsonb_build_object('status','ready_to_authorize','quote_reference','v2.'||expiry::text||'.'||
  substr(signal_semantic_context_digest_json_v2(body),8),'quote_expires_at',to_timestamp(expiry),
  'hard_cap_micro_usd',cap::text,'expected_group_count',target_group_count,'provider_execution_enabled',false);
END $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_admission_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;
 o signal_topic_editorial_batch_owners_v2%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=NEW.target_id;
 PERFORM signal_processing_lock_v1(NEW.organization_id,NEW.budget_date);
 PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 SELECT * INTO w FROM signal_workspaces WHERE id=NEW.workspace_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF o.execution_id IS NULL OR o.workspace_id<>NEW.workspace_id OR o.policy_version_id<>p.id
  OR NEW.action<>'topic_consolidation' OR NEW.automatic OR NEW.execution_cap_micro_usd<=0
  OR w.organization_id IS DISTINCT FROM NEW.organization_id OR w.brand_id IS DISTINCT FROM NEW.brand_id
  OR p.organization_id IS DISTINCT FROM NEW.organization_id OR p.status IS DISTINCT FROM 'active'
  OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until
  OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2() OR a.automatic_allowed
  OR NEW.configuration IS DISTINCT FROM a.configuration OR NEW.configuration_digest IS DISTINCT FROM a.configuration_digest
  OR NEW.provider IS DISTINCT FROM 'anthropic' OR NEW.model IS DISTINCT FROM 'claude-sonnet-4-6'
  OR (a.max_execution_micro_usd IS NOT NULL AND (NEW.execution_cap_micro_usd IS NULL OR NEW.execution_cap_micro_usd>a.max_execution_micro_usd))
  OR (NEW.execution_cap_micro_usd IS NULL AND NOT signal_topic_discovery_run_v1((o.plan_canonical_body::jsonb->'identity'->>'run_id')::uuid)) OR NEW.budget_timezone<>p.budget_timezone
  OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR NEW.admission_not_after IS DISTINCT FROM o.send_not_after OR NEW.admission_not_after>p.valid_until
  OR NEW.admission_not_after<=clock_timestamp() OR NEW.brand_context_processing_receipt_id IS NOT NULL
  OR NEW.brand_context_prototype_receipt_id IS NOT NULL THEN
  RAISE EXCEPTION 'topic_editorial_v2_admission_invalid' USING ERRCODE='23514';END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_owner_guard_v3() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_topic_editorial_batch_owners_v2%ROWTYPE;admission signal_processing_admissions%ROWTYPE;
 prior signal_topic_editorial_executions%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'topic_editorial_v3_owner_immutable' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO owner FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=NEW.id;
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=NEW.processing_admission_id;
 IF (NEW.hard_cap_micro_usd IS NULL AND NOT signal_topic_discovery_run_v1(NEW.numeric_run_id)) OR owner.execution_id IS NULL OR owner.workspace_id IS DISTINCT FROM NEW.workspace_id OR admission.id IS NULL
  OR admission.action IS DISTINCT FROM 'topic_consolidation'
  OR admission.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR ROW(admission.target_id,admission.workspace_id,admission.organization_id,admission.actor_user_id,
    admission.execution_cap_micro_usd,admission.idempotency_key,admission.request_digest)
   IS DISTINCT FROM ROW(NEW.id,NEW.workspace_id,NEW.organization_id,NEW.actor_user_id,
    NEW.hard_cap_micro_usd,NEW.idempotency_key,NEW.request_digest)
  OR admission.policy_version_id IS DISTINCT FROM owner.policy_version_id
  OR admission.admission_not_after IS DISTINCT FROM owner.send_not_after
  OR NEW.plan_digest IS DISTINCT FROM owner.plan_digest
  OR NEW.plan_digest IS DISTINCT FROM NEW.plan->>'admission_digest'
  OR signal_topic_editorial_header_valid_v3(NEW.numeric_run_id,NEW.plan,owner.plan_canonical_body) IS DISTINCT FROM true
  OR NEW.workspace_id::text IS DISTINCT FROM NEW.plan->'identity'->>'workspace_id'
  OR NEW.numeric_run_id::text IS DISTINCT FROM NEW.plan->'identity'->>'run_id'
  OR NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_runs run JOIN signal_workspaces w ON w.id=run.workspace_id
    WHERE run.id=NEW.numeric_run_id AND w.id=NEW.workspace_id AND w.organization_id=NEW.organization_id)
  OR NEW.source_binding IS DISTINCT FROM signal_topic_editorial_source_v1(NEW.numeric_run_id)
  OR NEW.source_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(NEW.source_binding)
  OR NEW.source_engine_execution_id::text IS DISTINCT FROM NEW.source_binding->>'source_engine_execution_id'
  OR NEW.status<>'queued' OR NEW.state_body IS NOT NULL OR NEW.state_digest IS NOT NULL OR NEW.result_revision_id IS NOT NULL
  OR NEW.execution_token IS NOT NULL OR NEW.execution_expires_at IS NOT NULL OR NEW.dispatch_generation<>1 OR NEW.attempt_count<>0
  OR NEW.supersedes_execution_id IS NOT NULL THEN
  RAISE EXCEPTION 'topic_editorial_v3_owner_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO prior FROM signal_topic_editorial_executions WHERE numeric_run_id=NEW.numeric_run_id
  ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF prior.id IS DISTINCT FROM owner.previous_execution_id OR prior.id IS NOT NULL AND
  (prior.status<>'failed' OR prior.execution_token IS NOT NULL
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls WHERE execution_id=prior.id AND status NOT IN('settled','definitely_not_sent'))
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_outbox WHERE execution_id=prior.id AND status IN('queued','dispatching')))
 THEN RAISE EXCEPTION 'topic_editorial_v3_predecessor_not_quiescent' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION replay_signal_topic_editorial_batch_v3_unprepared(target_workspace uuid,target_actor uuid,
 target_numeric_execution uuid,request_key text,expected_quote text,confirmed_cap bigint) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_topic_editorial_request_keys%ROWTYPE;e signal_topic_editorial_executions%ROWTYPE;
 admission signal_processing_admissions%ROWTYPE;owner signal_topic_editorial_batch_owners_v2%ROWTYPE;
 expected integer;actual integer;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v2\.[0-9]{10}\.[a-f0-9]{64}$'
  AND (confirmed_cap IS NULL OR confirmed_cap>0),false) THEN RAISE EXCEPTION 'topic_editorial_v3_request_invalid' USING ERRCODE='22023';END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NULL THEN RETURN '{"replayed":false}'::jsonb;END IF;
 SELECT execution.* INTO e FROM signal_topic_editorial_executions execution
  JOIN signal_topic_consolidation_executions control_run ON control_run.workspace_id=execution.workspace_id
   AND control_run.consolidation_run_id=execution.numeric_run_id AND control_run.id=target_numeric_execution
  WHERE execution.id=prior.execution_id AND execution.workspace_id=target_workspace
   AND execution.actor_user_id=target_actor AND execution.plan->>'contract_version'='signal-topic-editorial-admission-header-v3';
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO owner FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id;
 expected:=(e.plan->>'expected_group_count')::integer;
 SELECT count(*)::integer INTO actual FROM signal_topic_editorial_requests WHERE execution_id=e.id;
 IF e.id IS NULL OR owner.execution_id IS NULL OR admission.id IS NULL OR actual IS DISTINCT FROM expected
  OR e.quote_reference IS DISTINCT FROM expected_quote OR e.hard_cap_micro_usd IS DISTINCT FROM confirmed_cap
  OR e.request_digest IS DISTINCT FROM prior.request_digest OR admission.request_digest IS DISTINCT FROM prior.request_digest
  OR admission.target_id IS DISTINCT FROM e.id OR admission.idempotency_key IS DISTINCT FROM request_key
  OR owner.plan_digest IS DISTINCT FROM e.plan_digest
 THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
 RETURN prior.result||'{"replayed":true}'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_global_stage_call_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;g signal_topic_editorial_global_stages_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
 owner_row signal_topic_editorial_batch_owners_v2%ROWTYPE;grant_row signal_topic_editorial_global_continuations_v2%ROWTYPE;
 spent bigint;daily_spent bigint;expected bigint;prior signal_topic_editorial_global_stage_calls_v2%ROWTYPE;
 envelope jsonb;cost bigint;request_body text;max_tokens integer;new_send boolean;effective_day date;effective_deadline timestamptz;
BEGIN
 SELECT * INTO g FROM signal_topic_editorial_global_stages_v2 WHERE stage_id=NEW.stage_id;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=g.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 SELECT * INTO grant_row FROM signal_topic_editorial_global_continuations_v2 WHERE execution_id=e.id;
 IF TG_OP='INSERT' THEN new_send:=true;ELSE new_send:=OLD.status='reserved' AND NEW.status='in_flight';END IF;
 effective_day:=CASE WHEN grant_row.execution_id IS NULL AND NOT signal_topic_discovery_run_v1(e.numeric_run_id) THEN a.budget_date ELSE (clock_timestamp() AT TIME ZONE a.budget_timezone)::date END;
 PERFORM signal_processing_lock_v1(e.organization_id,CASE WHEN new_send THEN effective_day ELSE NEW.budget_date END);
 PERFORM signal_brand_context_processing_lock_actor_v1(e.workspace_id,e.actor_user_id);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=a.policy_version_id AND action='topic_consolidation';
 SELECT * INTO owner_row FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id AND workspace_id=e.workspace_id;
 effective_deadline:=CASE WHEN grant_row.execution_id IS NULL THEN least(a.admission_not_after,owner_row.send_not_after,p.valid_until)
   ELSE p.valid_until END;
 IF g.stage_id IS NULL OR g.processing_admission_id IS DISTINCT FROM e.processing_admission_id
  OR (NEW.workspace_id,NEW.organization_id,NEW.execution_id,NEW.stage_id)
   IS DISTINCT FROM (e.workspace_id,e.organization_id,e.id,g.stage_id)
  OR a.id IS DISTINCT FROM e.processing_admission_id OR a.action IS DISTINCT FROM 'topic_consolidation'
  OR a.workspace_id IS DISTINCT FROM e.workspace_id OR a.organization_id IS DISTINCT FROM e.organization_id
  OR a.actor_user_id IS DISTINCT FROM e.actor_user_id OR a.execution_cap_micro_usd IS DISTINCT FROM e.hard_cap_micro_usd
  OR owner_row.execution_id IS NULL OR owner_row.policy_version_id IS DISTINCT FROM a.policy_version_id
  OR (new_send AND NEW.budget_date<>effective_day) OR NEW.budget_timezone<>a.budget_timezone
  OR (grant_row.execution_id IS NOT NULL AND (grant_row.workspace_id,grant_row.organization_id,grant_row.actor_user_id,grant_row.policy_version_id)
    IS DISTINCT FROM (e.workspace_id,e.organization_id,e.actor_user_id,p.id))
  OR action_row.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR action_row.provider IS DISTINCT FROM 'anthropic' OR action_row.model IS DISTINCT FROM 'claude-sonnet-4-6' THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_authority_unavailable' USING ERRCODE='23514';
 END IF;
 IF new_send AND (p.id IS NULL OR p.organization_id<>e.organization_id OR p.status<>'active'
   OR clock_timestamp()<p.valid_from OR clock_timestamp()>=effective_deadline) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_authority_unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL
    OR NEW.settled_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_global_stage_call_invalid' USING ERRCODE='23514'; END IF;
  SELECT r.request_body,r.max_tokens INTO STRICT request_body,max_tokens FROM signal_topic_editorial_global_stage_requests_v2 r WHERE r.id=NEW.request_id AND r.stage_id=NEW.stage_id;
  IF NEW.retry_of_call_id IS NOT NULL THEN
   SELECT * INTO prior FROM signal_topic_editorial_global_stage_calls_v2 WHERE id=NEW.retry_of_call_id AND request_id=NEW.request_id AND stage_id=NEW.stage_id;
   IF prior.id IS NULL OR prior.status<>'settled'
    OR (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts WHERE attempts.request_id=NEW.request_id)>=5
    OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
      WHERE i.call_id=prior.id AND b.state='imported' AND (
       (prior.settled_micro_usd=0 AND prior.observed_micro_usd=0 AND i.outcome='errored'
        AND i.validation->>'status'='provider_error'
        AND prior.response_body_private::jsonb->'result'->'error'->'error'->>'message' LIKE 'Grammar compilation rate limit exceeded%')
       OR (i.outcome='succeeded' AND i.validation->>'status'='invalid_output'
        AND i.validation->>'code'='topic_editorial_global_shard_citation_invalid'))) THEN
    RAISE EXCEPTION 'topic_editorial_global_stage_retry_not_allowed' USING ERRCODE='23514';END IF;
  ELSIF EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 prior_call WHERE prior_call.request_id=NEW.request_id) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_retry_identity_required' USING ERRCODE='23514';
  END IF;
  expected:=(octet_length(request_body)::bigint*3+max_tokens::bigint*15+1)/2;
  IF NEW.reserved_micro_usd<>expected THEN RAISE EXCEPTION 'topic_editorial_global_stage_reservation_invalid' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO spent FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  spent:=spent+COALESCE((SELECT sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END)
   FROM signal_topic_editorial_global_stage_calls_v2 WHERE execution_id=e.id AND status<>'definitely_not_sent'),0);
  SELECT total_micro_usd INTO daily_spent FROM signal_processing_org_exposure_v1(e.organization_id,effective_day,a.budget_timezone);
  IF spent+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR daily_spent+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_cap_exhausted' USING ERRCODE='23514'; END IF;
  NEW.reserved_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','observed_micro_usd','settled_micro_usd','response_body_private','response_sha256','response_storage_key','response_http_status','response_complete','response_provider_request_id','error_code','sent_at','response_at','settled_at','provider_batch_id'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','observed_micro_usd','settled_micro_usd','response_body_private','response_sha256','response_storage_key','response_http_status','response_complete','response_provider_request_id','error_code','sent_at','response_at','settled_at','provider_batch_id'])
  OR OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256) IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256)
  OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_call_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status='definitely_not_sent' AND OLD.provider_batch_id IS NULL
   OR OLD.status='in_flight' AND NEW.status IN('submission_unknown','response_persisted','outcome_unknown')
   OR OLD.status='submission_unknown' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_call_transition_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status='in_flight' AND OLD.status='reserved' THEN NEW.sent_at:=clock_timestamp(); END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_receipt_invalid' USING ERRCODE='23514'; END IF;
  envelope:=NEW.response_body_private::jsonb;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 i
    JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
    WHERE i.call_id=NEW.id AND i.custom_id=envelope->>'custom_id' AND b.provider_batch_id=NEW.response_provider_request_id
      AND b.stage_id=NEW.stage_id AND b.state IN('ended','imported')) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_receipt_binding_invalid' USING ERRCODE='23514'; END IF;
  BEGIN cost:=signal_topic_editorial_batch_cost_v2(envelope);
  EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN cost:=NULL; END;
  IF cost IS NULL THEN
   IF NEW.status='settled' OR NEW.observed_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_usage_unresolved' USING ERRCODE='23514'; END IF;
  ELSIF cost>NEW.reserved_micro_usd OR NEW.observed_micro_usd IS DISTINCT FROM cost
    OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM cost THEN
   RAISE EXCEPTION 'topic_editorial_settlement_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='settled' THEN NEW.settled_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_call_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;o signal_topic_editorial_batch_owners_v2%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;prior signal_topic_editorial_calls%ROWTYPE;
 spent bigint;org_spent bigint;expected bigint;envelope jsonb;rejected boolean;usage_valid boolean:=true;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 SELECT * INTO o FROM signal_topic_editorial_batch_owners_v2 WHERE execution_id=e.id;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE id=NEW.request_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,NEW.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=e.id FOR UPDATE;
 IF o.execution_id IS NULL OR r.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v2()
  OR ROW(NEW.workspace_id,NEW.organization_id,r.workspace_id,r.execution_id,NEW.reserved_micro_usd,NEW.budget_timezone)
   IS DISTINCT FROM ROW(e.workspace_id,e.organization_id,e.workspace_id,e.id,r.reserved_micro_usd,a.budget_timezone)
 THEN RAISE EXCEPTION 'topic_editorial_v2_call_scope_invalid' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_topic_editorial_batch_authority_v2(e.id,false);
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NEW.response_output IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.settled_micro_usd IS NOT NULL
   OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_invalid' USING ERRCODE='23514';END IF;
  SELECT * INTO prior FROM signal_topic_editorial_calls WHERE request_id=r.id ORDER BY reserved_at DESC,id DESC LIMIT 1;
  IF prior.id IS DISTINCT FROM NEW.retry_of_call_id OR prior.id IS NOT NULL AND
   (prior.transport_version<>2 OR prior.status NOT IN('settled','definitely_not_sent')
    OR EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 WHERE call_id=prior.id AND validation->>'status'='accepted')
    OR prior.status='settled' AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 WHERE call_id=prior.id AND (validation IS NOT NULL OR outcome='submission_rejected'))) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_not_retryable' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM signal_topic_editorial_reused_decisions_v2 WHERE request_id=r.id) THEN
   RAISE EXCEPTION 'topic_editorial_v2_request_already_reused' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO spent FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  SELECT total_micro_usd INTO org_spent FROM signal_processing_org_exposure_v1(e.organization_id,NEW.budget_date,NEW.budget_timezone);
  SELECT * INTO p FROM signal_processing_policy_versions WHERE id=o.policy_version_id;
  IF spent+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR org_spent+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_v2_cap_exhausted' USING ERRCODE='23514';END IF;
  NEW.reserved_at:=clock_timestamp();
 ELSE
  IF OLD.transport_version<>2 OR (to_jsonb(NEW)-ARRAY['status','response_http_status','response_complete','response_provider_request_id','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','response_http_status','response_complete','response_provider_request_id','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD
   OR OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256,NEW.response_storage_key,NEW.response_output,NEW.response_http_status,NEW.response_complete,NEW.response_provider_request_id)
    IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256,OLD.response_storage_key,OLD.response_output,OLD.response_http_status,OLD.response_complete,OLD.response_provider_request_id) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_immutable' USING ERRCODE='23514';END IF;
  IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='outcome_unknown' AND NEW.status='response_persisted'
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
   RAISE EXCEPTION 'topic_editorial_v2_call_transition_invalid' USING ERRCODE='23514';END IF;
  IF OLD.status='reserved' AND NEW.status='in_flight' THEN
   PERFORM signal_topic_editorial_batch_authority_v2(e.id,false);
   IF NEW.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date AND NOT (signal_topic_discovery_run_v1(e.numeric_run_id) AND (SELECT daily_cap_micro_usd IS NULL FROM signal_processing_policy_versions WHERE id=o.policy_version_id)) THEN
    RAISE EXCEPTION 'topic_editorial_v2_reservation_day_expired' USING ERRCODE='23514';END IF;
   NEW.sent_at:=clock_timestamp();
  END IF;
  IF NEW.status='definitely_not_sent' AND (OLD.sent_at IS NOT NULL OR OLD.response_body_private IS NOT NULL) THEN
   RAISE EXCEPTION 'topic_editorial_not_sent_unproven' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 i JOIN signal_topic_editorial_provider_batches_v2 b ON b.id=i.batch_id
   WHERE i.call_id=NEW.id AND b.state='rejected' AND b.provider_receipt_body=NEW.response_body_private
    AND b.rejection_http_status=NEW.response_http_status AND NEW.response_complete=true) INTO rejected;
  IF rejected THEN
   IF NEW.observed_micro_usd IS DISTINCT FROM 0::bigint OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM 0::bigint
    OR NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private) THEN
    RAISE EXCEPTION 'topic_editorial_v2_rejection_settlement_invalid' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  envelope:=NEW.response_body_private::jsonb;
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_batch_items_v2 i JOIN signal_topic_editorial_provider_batches_v2 b ON b.id=i.batch_id
    WHERE i.call_id=NEW.id AND i.request_id=r.id AND i.custom_id=envelope->>'custom_id' AND b.provider_batch_id=NEW.response_provider_request_id
     AND b.execution_id=e.id AND b.state IN('ended','applied'))
   OR NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'topic_editorial_v2_response_binding_invalid' USING ERRCODE='23514';END IF;
  BEGIN expected:=signal_topic_editorial_batch_cost_v2(envelope);
  EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN usage_valid:=false;END;
  IF NOT usage_valid OR expected>NEW.reserved_micro_usd THEN
   IF NEW.status='settled' OR NEW.observed_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_v2_usage_unresolved' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  IF NEW.observed_micro_usd IS DISTINCT FROM expected
   OR NEW.status='settled' AND NEW.settled_micro_usd IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'topic_editorial_v2_settlement_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
