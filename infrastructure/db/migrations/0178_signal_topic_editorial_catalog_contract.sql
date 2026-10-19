-- Forward-only contract update before the first paid editorial execution.
-- Existing environments must remain empty because v1 executions are sealed to
-- their original prompt/schema digests and cannot be rewritten in place.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM signal_topic_editorial_executions)
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_requests)
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_calls)
   OR EXISTS(SELECT 1 FROM signal_topic_editorial_outbox)
 THEN RAISE EXCEPTION 'topic_editorial_contract_upgrade_requires_empty_ledger' USING ERRCODE='55000';
 END IF;
END $$;

-- The exact UTF-8 reservation for the 1,652-group Alexa+ plan is USD 29.081754.
-- Raise only this editorial action ceiling to USD 30; the organization daily cap
-- remains policy-owned and the provider ledger settles actual usage.
ALTER TABLE signal_topic_editorial_executions
 DROP CONSTRAINT signal_topic_editorial_executions_hard_cap_micro_usd_check,
 ADD CONSTRAINT signal_topic_editorial_executions_hard_cap_micro_usd_check
  CHECK(hard_cap_micro_usd BETWEEN 1 AND 30000000);
ALTER TABLE signal_processing_policy_actions
 DROP CONSTRAINT signal_processing_consolidation_action,
 ADD CONSTRAINT signal_processing_consolidation_action CHECK(
  action<>'topic_consolidation' OR (automatic_allowed=false AND max_execution_micro_usd BETWEEN 1 AND 30000000));

CREATE OR REPLACE FUNCTION signal_topic_editorial_quote_v1(target_workspace uuid,target_actor uuid,target_run uuid,plan jsonb,deadline bigint DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source jsonb;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;org uuid;exposure bigint;expiry bigint;body jsonb;cap bigint;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN RETURN '{"status":"access_required"}'::jsonb;END IF;
 source:=signal_topic_editorial_source_v1(target_run);
 IF source IS NULL OR source->>'workspace_id'<>target_workspace::text THEN RETURN '{"status":"source_stale"}'::jsonb;END IF;
 IF NOT signal_topic_editorial_plan_valid_v1(target_run,plan) THEN RAISE EXCEPTION 'topic_editorial_plan_invalid' USING ERRCODE='23514';END IF;
 SELECT organization_id INTO org FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=org AND status='active';
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN RETURN '{"status":"policy_required"}'::jsonb;END IF;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 IF a.action IS NULL OR a.automatic_allowed OR a.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1()
  OR a.provider IS DISTINCT FROM 'anthropic' OR a.model IS DISTINCT FROM 'claude-sonnet-4-6' THEN RETURN '{"status":"policy_action_required"}'::jsonb;END IF;
 cap:=least(a.max_execution_micro_usd,30000000);
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(org,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone);
 IF cap<=0 OR exposure+cap>p.daily_cap_micro_usd THEN RETURN '{"status":"budget_unavailable"}'::jsonb;END IF;
 expiry:=COALESCE(deadline,floor(extract(epoch FROM least(clock_timestamp()+interval '5 minutes',p.valid_until,
  (((clock_timestamp() AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone))))::bigint);
 IF to_timestamp(expiry)<=clock_timestamp() OR to_timestamp(expiry)>least(clock_timestamp()+interval '5 minutes',p.valid_until,
  (((clock_timestamp() AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone)) THEN RETURN '{"status":"quote_expired"}'::jsonb;END IF;
 body:=jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'source_binding',source,'plan_digest',plan->>'plan_digest',
  'policy_id',p.id,'policy_digest',p.policy_digest,'configuration_digest',a.configuration_digest,'hard_cap_micro_usd',cap::text,'deadline',expiry::text);
 RETURN body||jsonb_build_object('status','ready_to_authorize','quote_reference','v1.'||expiry::text||'.'||substr(signal_semantic_context_digest_json_v2(body),8),
  'quote_expires_at',to_timestamp(expiry),'provider_execution_enabled',false);
END;$$;

CREATE OR REPLACE FUNCTION signal_processing_admission_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;
 child signal_brand_context_prototype_receipts%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.action='topic_consolidation' AND (NEW.execution_cap_micro_usd NOT BETWEEN 1 AND 30000000 OR NEW.automatic OR NEW.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1() OR NEW.provider IS DISTINCT FROM 'anthropic' OR NEW.model IS DISTINCT FROM 'claude-sonnet-4-6') THEN RAISE EXCEPTION 'topic_editorial_admission_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.action='topic_consolidation_numeric' AND (NEW.execution_cap_micro_usd<>0 OR NEW.automatic OR NEW.provider IS NOT NULL OR NEW.model IS NOT NULL) THEN
  RAISE EXCEPTION 'topic_consolidation_numeric_admission_invalid' USING ERRCODE='23514'; END IF;
 PERFORM signal_processing_lock_v1(NEW.organization_id,NEW.budget_date);
 IF NEW.action='topic_prototype_embeddings' THEN
  SELECT * INTO child FROM signal_brand_context_prototype_receipts WHERE id=NEW.brand_context_prototype_receipt_id;
  IF child.id IS NULL OR ROW(child.parent_receipt_id,child.admission_id,child.run_id,child.workspace_id,child.organization_id,
    child.brand_id,child.actor_user_id,child.policy_version_id,child.idempotency_key,child.request_digest,child.execution_cap_micro_usd,
    child.budget_date,child.budget_timezone,child.admission_not_after)
   IS DISTINCT FROM ROW(NEW.brand_context_processing_receipt_id,NEW.id,NEW.target_id,NEW.workspace_id,NEW.organization_id,
    NEW.brand_id,NEW.actor_user_id,NEW.policy_version_id,NEW.idempotency_key,NEW.request_digest,NEW.execution_cap_micro_usd,
    NEW.budget_date,NEW.budget_timezone,NEW.admission_not_after) THEN
   RAISE EXCEPTION 'brand_context_prototype_receipt_required' USING ERRCODE='23514'; END IF;
  PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 ELSE
  IF NEW.brand_context_prototype_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'brand_context_prototype_receipt_invalid' USING ERRCODE='23514'; END IF;
  IF NEW.action='brand_context_proposal' THEN
   IF NEW.brand_context_processing_receipt_id IS NULL THEN RAISE EXCEPTION 'brand_context_composed_receipt_required' USING ERRCODE='23514'; END IF;
   PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  ELSE
   IF NEW.brand_context_processing_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'brand_context_composed_receipt_invalid' USING ERRCODE='23514'; END IF;
   IF NEW.action IN('topic_consolidation_numeric','topic_consolidation') THEN
    PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
   ELSE
    PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
   END IF;
  END IF;
 END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=NEW.workspace_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action=NEW.action;
 IF w.organization_id<>NEW.organization_id OR w.brand_id<>NEW.brand_id OR p.organization_id<>NEW.organization_id
  OR p.status IS DISTINCT FROM 'active' OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until
  OR a.action IS NULL OR NEW.provider IS DISTINCT FROM a.provider OR NEW.model IS DISTINCT FROM a.model
  OR NEW.configuration IS DISTINCT FROM a.configuration OR NEW.configuration_digest IS DISTINCT FROM a.configuration_digest
  OR NEW.execution_cap_micro_usd>a.max_execution_micro_usd OR NEW.automatic AND NOT a.automatic_allowed
  OR NEW.budget_timezone<>p.budget_timezone OR NEW.budget_date<>(clock_timestamp() AT TIME ZONE p.budget_timezone)::date
  OR NEW.admission_not_after>least(p.valid_until,((NEW.budget_date+1)::timestamp AT TIME ZONE p.budget_timezone))
  OR NEW.admission_not_after<=clock_timestamp() THEN
  RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO exposure FROM signal_processing_org_exposure_v1(p.organization_id,NEW.budget_date,p.budget_timezone);
 IF NEW.execution_cap_micro_usd>0 AND exposure+NEW.execution_cap_micro_usd>p.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_configuration_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE
 SET search_path=public,pg_temp AS $$ SELECT '{"contract_version":"signal-topic-editorial-execution-config-v1","screening":{"contract_version":"signal-topic-editorial-provider-config-v1","phase":"screening","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:08f97c1229f3a2603a69d5224c97492b7d0cb32bb2c65c868233fae06a551f2e","schema_digest":"sha256:c411a17c3d93c2fa73f7d81cdd755a97de45a379f9513ca0f17075681cdd3503","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"thinking":"disabled","effort":"high","stream":false,"max_output_tokens":8192},"global":{"contract_version":"signal-topic-editorial-provider-config-v1","phase":"global","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:13996f4e96d9aeac84712100447d6c0a1ab289bee242f187cf434ef8ddc2121d","schema_digest":"sha256:12ad951109d4713e94cffb61def501a1987035b15eb485362117dc88b5c559c2","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"thinking":"disabled","effort":"high","stream":false,"max_output_tokens":32768},"screening_batch_size":40,"max_call_attempts":3}'::jsonb $$;

REVOKE ALL ON FUNCTION signal_topic_editorial_configuration_v1() FROM PUBLIC;

-- Recovery must preserve HTTP facts; a body without them is not a receipt.
ALTER TABLE signal_topic_editorial_calls
 ADD COLUMN response_http_status smallint,
 ADD COLUMN response_complete boolean,
 ADD COLUMN response_provider_request_id text,
 ADD CONSTRAINT topic_editorial_http_receipt_shape CHECK (
  (response_body_private IS NULL AND response_http_status IS NULL AND response_complete IS NULL AND response_provider_request_id IS NULL)
  OR (response_body_private IS NOT NULL AND response_http_status IS NOT NULL AND response_http_status BETWEEN 100 AND 599
   AND response_complete IS NOT NULL AND (response_provider_request_id IS NULL OR response_provider_request_id~'^[A-Za-z0-9_.:-]{1,200}$')));

-- Editorial envelopes use the exact QE stable/JSON.stringify bytes. Historical
-- semantic-context NFC/control normalization is intentionally not reused here.
-- JSONB cannot represent U+0000 or lone surrogates: PostgreSQL rejects those inputs.
CREATE FUNCTION signal_topic_editorial_key_order_v1(value text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT
 SET search_path=public,extensions,pg_temp AS $$
 SELECT decode(COALESCE(string_agg(CASE WHEN ascii(character)>65535
  THEN lpad(to_hex(55296+((ascii(character)-65536)>>10)),4,'0')||lpad(to_hex(56320+((ascii(character)-65536)&1023)),4,'0')
  ELSE lpad(to_hex(ascii(character)),4,'0') END,'' ORDER BY ordinal),''),'hex')
 FROM regexp_split_to_table(value,'') WITH ORDINALITY member(character,ordinal)
$$;
CREATE FUNCTION signal_topic_editorial_canonical_json_v1(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT
 SET search_path=public,extensions,pg_temp AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN
  SELECT '{'||COALESCE(string_agg(to_json(key)::text||':'||signal_topic_editorial_canonical_json_v1(item),','
    ORDER BY signal_topic_editorial_key_order_v1(key)),'')||'}' INTO result FROM jsonb_each(value) member(key,item);
 WHEN 'array' THEN
  SELECT '['||COALESCE(string_agg(signal_topic_editorial_canonical_json_v1(item),',' ORDER BY position),'')||']'
   INTO result FROM jsonb_array_elements(value) WITH ORDINALITY member(item,position);
 WHEN 'string' THEN result:=to_json(value#>>'{}')::text;
 WHEN 'number' THEN
  result:=value#>>'{}';IF result !~ '^-?(0|[1-9][0-9]*)$' THEN
   RAISE EXCEPTION 'canonical_json_v2 accepts integers only.' USING ERRCODE='22023';END IF;
 WHEN 'boolean' THEN result:=value#>>'{}';
 WHEN 'null' THEN result:='null';
 ELSE RAISE EXCEPTION 'canonical_json_v2 received an unsupported value.' USING ERRCODE='22023';
 END CASE;RETURN result;
END;$$;
CREATE FUNCTION signal_topic_editorial_digest_json_v1(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT
 SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_semantic_context_digest_v1(signal_topic_editorial_canonical_json_v1(value))
$$;
REVOKE ALL ON FUNCTION signal_topic_editorial_key_order_v1(text),signal_topic_editorial_canonical_json_v1(jsonb),signal_topic_editorial_digest_json_v1(jsonb) FROM PUBLIC;

-- This is a cache-invalidation fingerprint, not a new semantic digest. Hash full
-- scoped source rows (including aliases, assertions and supersession history) in
-- PostgreSQL; only the small revision leaves the server. Permission/source-current
-- checks remain independent and execute before every reserve and send.
CREATE FUNCTION signal_topic_editorial_context_revision_v1(target_workspace uuid) RETURNS text LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 WITH scope AS MATERIALIZED (SELECT id,brand_id FROM signal_workspaces WHERE id=target_workspace),
 profiles AS MATERIALIZED (SELECT p.* FROM brand_os_profiles p JOIN scope s ON p.brand_id=s.brand_id),
 sources AS MATERIALIZED (SELECT k.* FROM brand_knowledge_sources k JOIN scope s ON k.brand_id=s.brand_id),
 entities AS MATERIALIZED (SELECT e.* FROM intelligence_entities e JOIN scope s ON e.brand_id=s.brand_id),
 generations AS MATERIALIZED (SELECT g.* FROM signal_semantic_context_generations g JOIN scope s ON g.workspace_id=s.id),
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
  UNION ALL SELECT 'knowledge_assertion',a.id::text,signal_semantic_context_digest_v1(to_jsonb(a)::text) FROM knowledge_assertions a JOIN sources k ON a.knowledge_source_id=k.id
  UNION ALL SELECT 'competitor',c.id::text,signal_semantic_context_digest_v1(to_jsonb(c)::text) FROM competitors c JOIN scope s ON c.brand_id=s.brand_id
  UNION ALL SELECT 'competitor_seed',b.id::text,signal_semantic_context_digest_v1(to_jsonb(b)::text) FROM brand_seeds b
   WHERE EXISTS(SELECT 1 FROM competitors c JOIN scope s ON c.brand_id=s.brand_id WHERE c.competitor_brand_seed_id=b.id)
  UNION ALL SELECT 'entity',e.id::text,signal_semantic_context_digest_v1(to_jsonb(e)::text) FROM entities e
  UNION ALL SELECT 'entity_alias',a.id::text,signal_semantic_context_digest_v1(to_jsonb(a)::text) FROM entity_aliases a JOIN entities e ON a.entity_id=e.id
  UNION ALL SELECT 'acquisition',p.id::text,signal_semantic_context_digest_v1(to_jsonb(p)::text) FROM signal_acquisition_plans p JOIN scope s ON p.workspace_id=s.id
  UNION ALL SELECT 'generation',g.id::text,signal_semantic_context_digest_v1(to_jsonb(g)::text) FROM generations g
  UNION ALL SELECT 'element',e.id::text,signal_semantic_context_digest_v1(to_jsonb(e)::text) FROM signal_semantic_context_element_versions e JOIN scope s ON e.workspace_id=s.id
  UNION ALL SELECT 'semantic_artifact',a.id::text,signal_semantic_context_digest_v1(to_jsonb(a)::text) FROM analysis_artifacts a
   WHERE EXISTS(SELECT 1 FROM generations g WHERE g.artifact_id=a.id)
 )
 SELECT CASE WHEN EXISTS(SELECT 1 FROM scope) THEN signal_semantic_context_digest_v1(
  (statement_timestamp() AT TIME ZONE 'UTC')::date::text||':'||COALESCE(string_agg(kind||':'||id||':'||hash,',' ORDER BY kind COLLATE "C",id COLLATE "C"),'')) END
 FROM members
$$;
REVOKE ALL ON FUNCTION signal_topic_editorial_context_revision_v1(uuid) FROM PUBLIC;

-- Expand every sealed collection once. Joins below prove coverage and provenance
-- as sets, avoiding a table lookup for each of the thousands of group receipts.
CREATE OR REPLACE FUNCTION signal_topic_editorial_plan_valid_v1(target_run uuid,body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE
 SET search_path=public,extensions,pg_temp SET jit=off AS $$
DECLARE r signal_topic_consolidation_runs%ROWTYPE;valid boolean;
BEGIN
 SELECT * INTO r FROM signal_topic_consolidation_runs WHERE id=target_run;
 IF r.id IS NULL OR body->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-screening-plan-v1'
  OR body->>'model' IS DISTINCT FROM 'claude-sonnet-4-6' OR body->>'source_context_digest' IS DISTINCT FROM r.context_digest
  OR body->>'batch_size' IS DISTINCT FROM '40' OR body->>'expected_group_count' IS DISTINCT FROM r.expected_group_count::text
  OR body->>'plan_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(body-'plan_digest')
  OR jsonb_typeof(body->'batches') IS DISTINCT FROM 'array'
  OR jsonb_array_length(body->'batches')<>(r.expected_group_count+39)/40 THEN RETURN false;END IF;
 WITH batches AS MATERIALIZED (
  SELECT b.value AS batch,b.ordinality-1 AS batch_index,(b.value->>'source_groups_body')::jsonb AS source_groups
  FROM jsonb_array_elements(body->'batches') WITH ORDINALITY b
 ), receipts AS MATERIALIZED (
  SELECT b.batch_index,item.value AS receipt,item.value->>'group_key' AS group_key
  FROM batches b CROSS JOIN LATERAL jsonb_array_elements(b.batch->'group_receipts') item
 ), projections AS MATERIALIZED (
  SELECT b.batch_index,item.value AS projected,item.value->>'group_key' AS group_key
  FROM batches b CROSS JOIN LATERAL jsonb_array_elements(b.source_groups) item
 ), keys AS MATERIALIZED (
  SELECT b.batch_index,item.value AS group_key FROM batches b
  CROSS JOIN LATERAL jsonb_array_elements_text(b.batch->'group_keys') item
 ), originals AS MATERIALIZED (
  SELECT g.* FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=r.id AND g.workspace_id=r.workspace_id
 ), paired AS MATERIALIZED (
  SELECT receipt.batch_index,receipt.receipt,receipt.group_key,projection.projected,
   original.id,original.group_digest,original.dossier_digest,original.lane,original.root_count,original.chunk_count,original.terms,original.dossier
  FROM receipts receipt LEFT JOIN projections projection USING(batch_index,group_key)
  LEFT JOIN originals original USING(group_key)
 ), selected AS MATERIALIZED (
  SELECT p.group_key,p.id,item.value AS ref_id FROM paired p
  CROSS JOIN LATERAL jsonb_array_elements_text(p.receipt->'evidence_ref_ids') item
 ), evidence AS MATERIALIZED (
  SELECT p.group_key,p.id,p.dossier,item.value AS item,item.value->>'ref_id' AS ref_id FROM paired p
  CROSS JOIN LATERAL jsonb_array_elements(p.projected->'evidence') item
 ), original_evidence AS MATERIALIZED (
  SELECT e.atomic_group_id,e.ref_id FROM signal_topic_atomic_group_evidence e JOIN originals o ON o.id=e.atomic_group_id
 ), communities AS MATERIALIZED (
  SELECT member.atomic_group_id,community.community_key FROM signal_topic_consolidation_community_members member
  JOIN originals o ON o.id=member.atomic_group_id
  JOIN signal_topic_consolidation_communities community ON community.id=member.community_id
 )
 SELECT NOT EXISTS (
  SELECT 1 FROM batches b WHERE
   b.batch->>'batch_index' IS DISTINCT FROM b.batch_index::text
   OR b.batch->'configuration' IS DISTINCT FROM signal_topic_editorial_configuration_v1()->'screening'
   OR b.batch->>'model' IS DISTINCT FROM 'claude-sonnet-4-6' OR b.batch->>'source_context_digest' IS DISTINCT FROM r.context_digest
   OR b.batch->>'editorial_context_digest' IS DISTINCT FROM body->>'editorial_context_digest'
   OR b.batch->>'request_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(jsonb_build_object('request_body',b.batch->>'request_body',
    'configuration',b.batch->'configuration','group_receipts',b.batch->'group_receipts'))
   OR b.batch->>'batch_key' IS DISTINCT FROM 'topic-consolidation-screen-v1:'||b.batch_index::text||':'||substr(b.batch->>'request_digest',8,16)
   OR b.batch->>'request_body' IS NULL OR octet_length(b.batch->>'request_body') NOT BETWEEN 1 AND 1500000
   OR jsonb_typeof(b.batch->'group_receipts') IS DISTINCT FROM 'array'
   OR jsonb_array_length(b.batch->'group_receipts') NOT BETWEEN 1 AND 40
   OR jsonb_typeof(b.batch->'group_keys') IS DISTINCT FROM 'array'
   OR jsonb_array_length(b.batch->'group_keys')<>jsonb_array_length(b.batch->'group_receipts')
   OR jsonb_typeof(b.batch->'source_groups_body') IS DISTINCT FROM 'string'
   OR jsonb_typeof(b.source_groups) IS DISTINCT FROM 'array'
   OR jsonb_array_length(b.source_groups)<>jsonb_array_length(b.batch->'group_receipts')
 ) AND (SELECT count(*) FROM receipts)=r.expected_group_count
 AND NOT EXISTS(SELECT 1 FROM receipts GROUP BY group_key HAVING group_key IS NULL OR count(*)<>1)
 AND NOT EXISTS(SELECT 1 FROM projections GROUP BY batch_index,group_key HAVING group_key IS NULL OR count(*)<>1)
 AND NOT EXISTS(SELECT 1 FROM keys GROUP BY batch_index,group_key HAVING group_key IS NULL OR count(*)<>1)
 AND NOT EXISTS(SELECT batch_index,group_key FROM receipts EXCEPT SELECT batch_index,group_key FROM projections)
 AND NOT EXISTS(SELECT batch_index,group_key FROM projections EXCEPT SELECT batch_index,group_key FROM receipts)
 AND NOT EXISTS(SELECT batch_index,group_key FROM receipts EXCEPT SELECT batch_index,group_key FROM keys)
 AND NOT EXISTS(SELECT batch_index,group_key FROM keys EXCEPT SELECT batch_index,group_key FROM receipts)
 AND NOT EXISTS (
  SELECT 1 FROM paired p WHERE p.id IS NULL
   OR p.group_digest IS DISTINCT FROM p.receipt->>'group_digest'
   OR p.dossier_digest IS DISTINCT FROM p.receipt->>'source_dossier_digest'
   OR jsonb_typeof(p.receipt->'evidence_ref_ids') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p.receipt->'evidence_ref_ids') NOT BETWEEN 1 AND 10
   OR p.projected->>'group_digest' IS DISTINCT FROM p.group_digest
   OR p.projected->>'source_dossier_digest' IS DISTINCT FROM p.dossier_digest
   OR p.projected->>'dossier_digest' IS DISTINCT FROM p.receipt->>'dossier_digest'
   OR p.projected->>'lane' IS DISTINCT FROM p.lane
   OR p.projected->>'root_count' IS DISTINCT FROM p.root_count::text
   OR p.projected->>'chunk_count' IS DISTINCT FROM p.chunk_count::text
   OR p.projected->'terms' IS DISTINCT FROM to_jsonb(p.terms)
   OR (p.projected-ARRAY['group_key','lane','group_digest','source_dossier_digest','dossier_digest','community_key','root_count','chunk_count','terms','evidence'])
     IS DISTINCT FROM (p.dossier-ARRAY['contract_version','evidence'])
   OR jsonb_typeof(p.projected->'evidence') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p.projected->'evidence')<>jsonb_array_length(p.receipt->'evidence_ref_ids')
   OR NOT COALESCE(p.projected->>'dossier_digest'~'^sha256:[a-f0-9]{64}$',false)
 )
 AND NOT EXISTS(SELECT 1 FROM selected GROUP BY group_key,ref_id HAVING ref_id IS NULL OR count(*)<>1)
 AND NOT EXISTS(SELECT 1 FROM evidence GROUP BY group_key,ref_id HAVING ref_id IS NULL OR count(*)<>1)
 AND NOT EXISTS(SELECT group_key,ref_id FROM selected EXCEPT SELECT group_key,ref_id FROM evidence)
 AND NOT EXISTS(SELECT group_key,ref_id FROM evidence EXCEPT SELECT group_key,ref_id FROM selected)
 AND NOT EXISTS(SELECT id,ref_id FROM selected EXCEPT SELECT atomic_group_id,ref_id FROM original_evidence)
 AND NOT EXISTS(SELECT 1 FROM evidence e WHERE NOT(e.dossier->'evidence' @> jsonb_build_array(e.item-'text'))
   OR jsonb_typeof(e.item->'text') IS DISTINCT FROM 'string'
   OR signal_semantic_context_digest_v1(e.item->>'text') IS DISTINCT FROM e.item->>'chunk_sha256')
 AND NOT EXISTS(SELECT id,projected->>'community_key' FROM paired EXCEPT SELECT atomic_group_id,community_key FROM communities)
 INTO valid;
 RETURN COALESCE(valid,false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END;$$;

CREATE OR REPLACE FUNCTION request_signal_topic_editorial_v1(target_workspace uuid,target_actor uuid,target_run uuid,plan jsonb,request_key text,expected_quote text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 q jsonb;prior signal_topic_editorial_request_keys%ROWTYPE;hash text;e uuid:=gen_random_uuid();admission uuid:=gen_random_uuid();b jsonb;result jsonb;day date;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_quote~'^v1\.[0-9]{10}\.[a-f0-9]{64}$',false) THEN
  RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NOT NULL THEN PERFORM signal_processing_lock_v1(w.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date);END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('topic-editorial:'||target_workspace::text,0));
 hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,'numeric_run_id',target_run,
  'plan_digest',plan->>'plan_digest','quote_reference',expected_quote));
 SELECT * INTO prior FROM signal_topic_editorial_request_keys WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.execution_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;END IF;
 q:=signal_topic_editorial_quote_v1(target_workspace,target_actor,target_run,plan,split_part(expected_quote,'.',2)::bigint);
 IF q->>'status'<>'ready_to_authorize' OR q->>'quote_reference' IS DISTINCT FROM expected_quote THEN
  RAISE EXCEPTION 'topic_editorial_quote_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=(q->>'policy_id')::uuid;
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_consolidation';
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,target_id,
  idempotency_key,request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(admission,w.organization_id,w.id,w.brand_id,target_actor,p.id,a.action,e,request_key,hash,a.provider,a.model,a.configuration,a.configuration_digest,
  (q->>'hard_cap_micro_usd')::bigint,day,p.budget_timezone,least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone)),false,'pending');
 INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,source_binding,source_digest,
  plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference)
 VALUES(e,w.id,w.organization_id,target_actor,target_run,(q->'source_binding'->>'source_engine_execution_id')::uuid,q->'source_binding',
  signal_topic_editorial_digest_json_v1(q->'source_binding'),plan,plan->>'plan_digest',admission,(q->>'hard_cap_micro_usd')::bigint,request_key,hash,expected_quote);
 FOR b IN SELECT value FROM jsonb_array_elements(plan->'batches') LOOP
  INSERT INTO signal_topic_editorial_requests(workspace_id,execution_id,phase,batch_index,request_digest,request_body,configuration,receipts,reserved_micro_usd)
  VALUES(w.id,e,'screening',(b->>'batch_index')::integer,b->>'request_digest',b->>'request_body',b->'configuration',b->'group_receipts',
   octet_length(b->>'request_body')::bigint*3+(b->'configuration'->>'max_output_tokens')::bigint*15);
 END LOOP;
 INSERT INTO signal_topic_editorial_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id) VALUES(w.id,e,1,'topic-editorial-'||e::text||'-1');
 result:=jsonb_build_object('execution_id',e,'worker_job_id','topic-editorial-'||e::text||'-1','replayed',false);
 INSERT INTO signal_topic_editorial_request_keys(workspace_id,actor_user_id,idempotency_key,execution_id,request_digest,result) VALUES(w.id,target_actor,request_key,e,hash,result);
 RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;r signal_topic_editorial_requests%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;prior signal_topic_editorial_calls%ROWTYPE;amount bigint;org_amount bigint;body jsonb;usage jsonb;cost bigint;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=e.processing_admission_id;
 PERFORM signal_processing_lock_v1(e.organization_id,a.budget_date);
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id FOR UPDATE;
 SELECT * INTO r FROM signal_topic_editorial_requests WHERE id=NEW.request_id;
 IF ROW(NEW.workspace_id,NEW.organization_id,r.workspace_id,r.execution_id,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone)
  IS DISTINCT FROM ROW(e.workspace_id,e.organization_id,e.workspace_id,e.id,r.reserved_micro_usd,a.budget_date,a.budget_timezone) THEN
  RAISE EXCEPTION 'topic_editorial_call_scope_invalid' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_topic_editorial_assert_lease_v1(e.id,e.execution_token,true);
  IF NEW.status<>'reserved' OR NEW.response_body_private IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NEW.response_output IS NOT NULL OR NEW.error_code IS NOT NULL THEN RAISE EXCEPTION 'topic_editorial_call_invalid' USING ERRCODE='23514';END IF;
  SELECT * INTO prior FROM signal_topic_editorial_calls WHERE request_id=r.id ORDER BY reserved_at DESC,id DESC LIMIT 1;
  IF prior.id IS NOT NULL AND (prior.status<>'definitely_not_sent' OR NEW.retry_of_call_id IS DISTINCT FROM prior.id)
   OR prior.id IS NULL AND NEW.retry_of_call_id IS NOT NULL
   OR (SELECT count(*) FROM signal_topic_editorial_calls WHERE request_id=r.id)>=3 THEN
   RAISE EXCEPTION 'topic_editorial_call_not_retryable' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO amount FROM signal_topic_editorial_calls WHERE execution_id=e.id AND status<>'definitely_not_sent';
  SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
  SELECT total_micro_usd INTO org_amount FROM signal_processing_org_exposure_v1(e.organization_id,a.budget_date,a.budget_timezone);
  IF amount+NEW.reserved_micro_usd>e.hard_cap_micro_usd OR org_amount+NEW.reserved_micro_usd>p.daily_cap_micro_usd THEN
   RAISE EXCEPTION 'topic_editorial_cap_exhausted' USING ERRCODE='23514';END IF;
  NEW.reserved_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-ARRAY['response_http_status','response_complete','response_provider_request_id','status','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['response_http_status','response_complete','response_provider_request_id','status','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key','response_output','error_code','sent_at','response_at','settled_at'])
   OR OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'topic_editorial_call_immutable' USING ERRCODE='23514';END IF;
  IF OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256,NEW.response_storage_key,NEW.response_output,NEW.response_http_status,NEW.response_complete,NEW.response_provider_request_id)
   IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256,OLD.response_storage_key,OLD.response_output,OLD.response_http_status,OLD.response_complete,OLD.response_provider_request_id) THEN
   RAISE EXCEPTION 'topic_editorial_response_immutable' USING ERRCODE='23514';END IF;
  IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status IN('response_persisted','outcome_unknown')
   OR OLD.status='outcome_unknown' AND NEW.status='response_persisted'
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')) THEN
   RAISE EXCEPTION 'topic_editorial_call_transition_invalid' USING ERRCODE='23514';END IF;
  IF NEW.status='in_flight' AND OLD.status='reserved' THEN
   PERFORM signal_topic_editorial_assert_lease_v1(e.id,e.execution_token,true);NEW.sent_at:=clock_timestamp();
  END IF;
  IF NEW.status='definitely_not_sent' AND (OLD.sent_at IS NOT NULL OR OLD.response_body_private IS NOT NULL) THEN
   RAISE EXCEPTION 'topic_editorial_not_sent_unproven' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.status='settled' AND (NEW.response_http_status IS DISTINCT FROM 200 OR NEW.response_complete IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'topic_editorial_receipt_incomplete' USING ERRCODE='23514';END IF;
 IF NEW.response_body_private IS NOT NULL THEN
  IF NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
   OR length(NEW.response_storage_key) NOT BETWEEN 1 AND 1024 THEN RAISE EXCEPTION 'topic_editorial_response_invalid' USING ERRCODE='23514';END IF;
  body:=signal_topic_editorial_parse_json_v1(NEW.response_body_private);usage:=body->'usage';
  IF body->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
   OR NOT COALESCE(usage->>'input_tokens'~'^[0-9]+$' AND usage->>'output_tokens'~'^[0-9]+$',false)
   OR COALESCE(usage->>'cache_creation_input_tokens','0')<>'0' OR COALESCE(usage->>'cache_read_input_tokens','0')<>'0' THEN
   IF NEW.status='settled' THEN RAISE EXCEPTION 'topic_editorial_usage_invalid' USING ERRCODE='23514';END IF;
  ELSE
   cost:=(usage->>'input_tokens')::bigint*3+(usage->>'output_tokens')::bigint*15;
   IF NEW.status='settled' AND (NEW.settled_micro_usd IS DISTINCT FROM cost OR cost>NEW.reserved_micro_usd) THEN
    RAISE EXCEPTION 'topic_editorial_settlement_invalid' USING ERRCODE='23514';END IF;
   IF NEW.observed_micro_usd IS DISTINCT FROM cost THEN RAISE EXCEPTION 'topic_editorial_usage_invalid' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 RETURN NEW;
END;$$;

CREATE FUNCTION persist_signal_topic_editorial_receipt_v1(target_call uuid,target_attempt uuid,target_request_digest text,
 body text,storage_key text,http_status integer,complete boolean,provider_request_id text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_topic_editorial_calls%ROWTYPE;request signal_topic_editorial_requests%ROWTYPE;parsed jsonb;output_text text;cost bigint;
BEGIN
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call;
 PERFORM signal_processing_lock_v1(c.organization_id,c.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=c.execution_id FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call FOR UPDATE;
 SELECT * INTO request FROM signal_topic_editorial_requests WHERE id=c.request_id;
 IF c.id IS NULL OR request.request_digest IS DISTINCT FROM target_request_digest OR http_status IS NULL OR http_status NOT BETWEEN 100 AND 599
  OR complete IS NULL OR provider_request_id IS NOT NULL AND provider_request_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
  OR body IS NULL OR octet_length(body)>8388608 OR storage_key IS NULL OR length(storage_key) NOT BETWEEN 1 AND 1024 THEN
  RAISE EXCEPTION 'topic_editorial_receipt_invalid' USING ERRCODE='23514';END IF;
 IF c.attempt_token IS DISTINCT FROM target_attempt OR c.status NOT IN('in_flight','outcome_unknown','response_persisted','settled') THEN
  RAISE EXCEPTION 'topic_editorial_response_attempt_invalid' USING ERRCODE='23514';END IF;
 IF c.response_body_private IS NOT NULL THEN
  IF c.response_body_private IS DISTINCT FROM body OR c.response_storage_key IS DISTINCT FROM storage_key
   OR c.response_http_status IS DISTINCT FROM http_status OR c.response_complete IS DISTINCT FROM complete
   OR c.response_provider_request_id IS DISTINCT FROM provider_request_id THEN
   RAISE EXCEPTION 'topic_editorial_response_immutable' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('status',c.status,'replayed',true);END IF;
 parsed:=signal_topic_editorial_parse_json_v1(body);
 IF jsonb_typeof(parsed->'content')='array' THEN
  SELECT string_agg(value->>'text','' ORDER BY ordinal) INTO output_text FROM jsonb_array_elements(parsed->'content') WITH ORDINALITY x(value,ordinal)
   WHERE value->>'type'='text';END IF;
 IF http_status=200 AND complete AND parsed->>'model'='claude-sonnet-4-6' AND parsed->'usage'->>'input_tokens'~'^[0-9]+$' AND parsed->'usage'->>'output_tokens'~'^[0-9]+$'
  AND COALESCE(parsed->'usage'->>'cache_creation_input_tokens','0')='0' AND COALESCE(parsed->'usage'->>'cache_read_input_tokens','0')='0' THEN
  cost:=(parsed->'usage'->>'input_tokens')::bigint*3+(parsed->'usage'->>'output_tokens')::bigint*15;END IF;
 UPDATE signal_topic_editorial_calls SET status='response_persisted',response_body_private=body,response_sha256=signal_semantic_context_digest_v1(body),
  response_storage_key=storage_key,response_http_status=http_status,response_complete=complete,
  response_provider_request_id=provider_request_id,response_output=signal_topic_editorial_parse_json_v1(output_text),observed_micro_usd=cost,response_at=clock_timestamp() WHERE id=c.id;
 RETURN jsonb_build_object('status','response_persisted','replayed',false);
END;$$;

-- The old body-only seam cannot invent the missing HTTP facts.
CREATE OR REPLACE FUNCTION persist_signal_topic_editorial_response_v1(target_call uuid,target_attempt uuid,body text,storage_key text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN RAISE EXCEPTION 'topic_editorial_http_metadata_required' USING ERRCODE='23514';END;$$;

REVOKE ALL ON FUNCTION persist_signal_topic_editorial_receipt_v1(uuid,uuid,text,text,text,integer,boolean,text) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION persist_signal_topic_editorial_receipt_v1(uuid,uuid,text,text,text,integer,boolean,text) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;


-- One semantic repair per original request; financial attempts remain separate.
ALTER TABLE signal_topic_editorial_requests
 ADD COLUMN parent_request_id uuid,
 ADD COLUMN repair_binding jsonb,
 ADD COLUMN repair_parent_output_body text,
 ADD CONSTRAINT topic_editorial_repair_parent_fk FOREIGN KEY(workspace_id,parent_request_id)
  REFERENCES signal_topic_editorial_requests(workspace_id,id),
 ADD CONSTRAINT topic_editorial_repair_shape CHECK (
  (parent_request_id IS NULL AND repair_binding IS NULL AND repair_parent_output_body IS NULL)
  OR (parent_request_id IS NOT NULL AND repair_binding IS NOT NULL AND repair_parent_output_body IS NOT NULL
   AND jsonb_typeof(repair_binding)='object' AND octet_length(repair_parent_output_body) BETWEEN 1 AND 8388608));
DO $$ DECLARE constraint_name text; BEGIN
 SELECT conname INTO STRICT constraint_name FROM pg_constraint
  WHERE conrelid='signal_topic_editorial_requests'::regclass AND contype='u'
   AND pg_get_constraintdef(oid)='UNIQUE (execution_id, phase, batch_index)';
 EXECUTE format('ALTER TABLE signal_topic_editorial_requests DROP CONSTRAINT %I',constraint_name);
END $$;
CREATE UNIQUE INDEX topic_editorial_original_request_slot ON signal_topic_editorial_requests(execution_id,phase,batch_index)
 WHERE parent_request_id IS NULL;
CREATE UNIQUE INDEX topic_editorial_one_repair_per_parent ON signal_topic_editorial_requests(parent_request_id)
 WHERE parent_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION signal_topic_editorial_request_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;b jsonb;expected_hash text;parent signal_topic_editorial_requests%ROWTYPE;payload jsonb;
BEGIN
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 IF e.id IS NULL OR NEW.configuration IS DISTINCT FROM signal_topic_editorial_configuration_v1()->NEW.phase THEN
  RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='23514';END IF;
 IF NEW.parent_request_id IS NOT NULL THEN
  PERFORM signal_topic_editorial_assert_lease_v1(e.id,e.execution_token,false);
  SELECT * INTO parent FROM signal_topic_editorial_requests WHERE id=NEW.parent_request_id;
  IF parent.id IS NULL OR parent.parent_request_id IS NOT NULL
   OR ROW(parent.workspace_id,parent.execution_id,parent.phase,parent.batch_index,parent.configuration,parent.receipts)
    IS DISTINCT FROM ROW(NEW.workspace_id,NEW.execution_id,NEW.phase,NEW.batch_index,NEW.configuration,NEW.receipts)
   OR NEW.repair_binding->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-repair-v1'
   OR NEW.repair_binding->'repair_index' IS DISTINCT FROM '1'::jsonb
   OR (SELECT count(*) FROM jsonb_object_keys(NEW.repair_binding))<>6
   OR NEW.repair_binding->>'parent_request_digest' IS DISTINCT FROM parent.request_digest
   OR NEW.repair_binding->>'parent_idempotency_key' IS DISTINCT FROM (CASE WHEN parent.phase='screening'
      THEN e.plan->'batches'->parent.batch_index->>'batch_key'
      ELSE 'topic-consolidation-global-v1:'||substr(parent.request_digest,8,16) END)
   OR NEW.repair_binding->>'parent_response_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.repair_parent_output_body)
   OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_calls c WHERE c.request_id=parent.id AND c.status='settled'
      AND c.response_http_status=200 AND c.response_complete=true AND c.response_output=NEW.repair_parent_output_body::jsonb)
   OR NEW.phase='screening' AND NOT COALESCE(NEW.repair_binding->>'error_code'=ANY(ARRAY['topic_editorial_output_invalid',
     'topic_editorial_output_coverage_invalid','topic_editorial_output_target_invalid','topic_editorial_output_citation_invalid','topic_editorial_output_locale_invalid']),false)
   OR NEW.phase='global' AND NOT COALESCE(NEW.repair_binding->>'error_code'=ANY(ARRAY['topic_editorial_global_output_invalid',
     'topic_editorial_global_concept_invalid','topic_editorial_global_members_invalid','topic_editorial_global_locale_invalid',
     'topic_editorial_global_priority_invalid','topic_editorial_global_fixed_disposition_invalid','topic_editorial_global_coverage_invalid']),false)
  THEN RAISE EXCEPTION 'topic_editorial_repair_parent_invalid' USING ERRCODE='23514';END IF;
  payload:=(NEW.request_body::jsonb->'messages'->0->>'content')::jsonb;
  IF payload->'repair' IS DISTINCT FROM NEW.repair_binding
   OR payload->'invalid_response' IS DISTINCT FROM NEW.repair_parent_output_body::jsonb
   OR payload->>'original_message' IS DISTINCT FROM parent.request_body::jsonb->'messages'->0->>'content'
  THEN RAISE EXCEPTION 'topic_editorial_repair_request_invalid' USING ERRCODE='23514';END IF;
  expected_hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('contract_version','signal-topic-editorial-repair-v1',
    'phase',NEW.phase,'repair',NEW.repair_binding,'request_body',NEW.request_body,'configuration',NEW.configuration));
 ELSE
 IF NEW.phase='screening' THEN
  b:=e.plan->'batches'->NEW.batch_index;
  IF b IS NULL OR b->>'request_digest' IS DISTINCT FROM NEW.request_digest OR b->>'request_body' IS DISTINCT FROM NEW.request_body
   OR b->'group_receipts' IS DISTINCT FROM NEW.receipts THEN RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='23514';END IF;
  expected_hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('request_body',NEW.request_body,'configuration',NEW.configuration,'group_receipts',NEW.receipts));
 ELSE
  IF e.state_body IS NULL OR e.state_body::jsonb->>'phase'<>'global'
   OR jsonb_array_length(e.state_body::jsonb->'screening_outputs')<>jsonb_array_length(e.plan->'batches') THEN
   RAISE EXCEPTION 'topic_editorial_screening_incomplete' USING ERRCODE='23514';END IF;
  expected_hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('request_body',NEW.request_body,'configuration',NEW.configuration,'eligible_group_receipts',NEW.receipts));
 END IF;
 END IF;
 -- UTF-8 byte count is a conservative token bound, plus the exact output cap.
 IF expected_hash IS DISTINCT FROM NEW.request_digest OR NEW.reserved_micro_usd IS DISTINCT FROM
  octet_length(NEW.request_body)::bigint*3+(NEW.configuration->>'max_output_tokens')::bigint*15 THEN
  RAISE EXCEPTION 'topic_editorial_request_invalid' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_owner_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE a signal_processing_admissions%ROWTYPE;source jsonb;new_owner jsonb;old_owner jsonb;
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
  -- Compare the immutable plan as JSONB, without serializing its multi-megabyte
  -- strings on every checkpoint. Null only these heavy fields before the generic
  -- record comparison; unknown future columns therefore remain immutable.
  new_owner:=to_jsonb(jsonb_populate_record(NEW,'{"plan":null,"state_body":null}'::jsonb));
  old_owner:=to_jsonb(jsonb_populate_record(OLD,'{"plan":null,"state_body":null}'::jsonb));
  IF NEW.plan IS DISTINCT FROM OLD.plan
   OR (new_owner-ARRAY['status','dispatch_generation','execution_token','execution_expires_at','attempt_count','state_digest','result_revision_id','error_code','completed_at'])
    IS DISTINCT FROM (old_owner-ARRAY['status','dispatch_generation','execution_token','execution_expires_at','attempt_count','state_digest','result_revision_id','error_code','completed_at'])
   OR OLD.status IN('review_ready','completed') AND (NEW.state_body IS DISTINCT FROM OLD.state_body OR new_owner IS DISTINCT FROM old_owner)
   THEN RAISE EXCEPTION 'topic_editorial_owner_immutable' USING ERRCODE='23514';END IF;
  IF NEW.status<>OLD.status AND NOT (OLD.status='queued' AND NEW.status IN('running','failed')
   OR OLD.status='running' AND NEW.status IN('queued','failed','review_ready') OR OLD.status='failed' AND NEW.status='queued') THEN
   RAISE EXCEPTION 'topic_editorial_transition_invalid' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.status='review_ready' AND (NEW.state_body IS NULL OR NEW.state_body::jsonb->>'phase' IS DISTINCT FROM 'completed') THEN RAISE EXCEPTION 'topic_editorial_review_incomplete' USING ERRCODE='23514';END IF;
 IF NEW.state_body IS NOT NULL AND NEW.state_digest IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.state_body) THEN
  RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_state_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp SET jit=off AS $$
DECLARE body jsonb;prior jsonb;seen integer;invalid boolean;unpaid boolean;bad_coverage boolean;
BEGIN
 IF NEW.state_body IS NOT DISTINCT FROM OLD.state_body THEN RETURN NEW;END IF;
 IF OLD.status<>'running' OR OLD.execution_token IS NULL OR OLD.execution_expires_at<=clock_timestamp() OR NEW.state_body IS NULL THEN
  RAISE EXCEPTION 'topic_editorial_state_lease_invalid' USING ERRCODE='23514';END IF;
 body:=NEW.state_body::jsonb;prior:=OLD.state_body::jsonb;
 IF body->>'contract_version' IS DISTINCT FROM 'signal-topic-editorial-runner-v1' OR body->>'execution_key' IS DISTINCT FROM NEW.id::text
  OR body->>'plan_digest' IS DISTINCT FROM NEW.plan_digest OR NOT COALESCE(body->>'phase' IN('screening','global','completed'),false)
  OR jsonb_typeof(body->'screening_outputs') IS DISTINCT FROM 'array'
  OR prior->'global' IS DISTINCT FROM 'null'::jsonb AND prior->'global' IS NOT NULL AND body->'global' IS DISTINCT FROM prior->'global' THEN
  RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
 -- Prior outputs already passed this trigger and their settled receipts are
 -- immutable. Prove append-only retention, then validate only newly added batches.
 -- Normalized fallback preserves the existing acceptance of array reordering;
 -- the usual byte-equivalent replay never recursively normalizes old outputs.
 WITH outputs AS MATERIALIZED (
  SELECT value AS output,(value->>'batch_index')::integer AS batch_index FROM jsonb_array_elements(body->'screening_outputs')
 ), previous AS MATERIALIZED (
  SELECT value AS output,(value->>'batch_index')::integer AS batch_index
   FROM jsonb_array_elements(COALESCE(prior->'screening_outputs','[]'::jsonb))
 ), delta AS MATERIALIZED (
  SELECT o.*,signal_topic_editorial_normalize_output_v1(o.output) AS normalized FROM outputs o
   LEFT JOIN previous p USING(batch_index) WHERE p.batch_index IS NULL
 ), requests AS MATERIALIZED (
  SELECT r.id,r.batch_index,r.receipts FROM signal_topic_editorial_requests r JOIN delta d USING(batch_index)
   WHERE r.execution_id=NEW.id AND r.workspace_id=NEW.workspace_id AND r.phase='screening' AND r.parent_request_id IS NULL
 ), paid_lineage AS MATERIALIZED (
  SELECT id AS request_id,id AS original_id FROM requests
  UNION ALL
  SELECT child.id,parent.id FROM requests parent JOIN signal_topic_editorial_requests child ON child.parent_request_id=parent.id
   WHERE child.execution_id=NEW.id AND child.workspace_id=NEW.workspace_id AND child.phase='screening'
 ), paid AS MATERIALIZED (
  SELECT r.batch_index,signal_topic_editorial_normalize_output_v1(c.response_output) AS normalized
   FROM requests r JOIN paid_lineage lineage ON lineage.original_id=r.id
   JOIN signal_topic_editorial_calls c ON c.request_id=lineage.request_id
   WHERE c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id AND c.status='settled'
    AND c.response_http_status=200 AND c.response_complete=true
 ), decision_keys AS MATERIALIZED (
  SELECT d.batch_index,array_agg(item.value->>'group_key' ORDER BY item.value->>'group_key' COLLATE "C") AS keys
   FROM delta d CROSS JOIN LATERAL jsonb_array_elements(d.output->'decisions') item GROUP BY d.batch_index
 ), expected_keys AS MATERIALIZED (
  SELECT r.batch_index,array_agg(item.value->>'group_key' ORDER BY item.value->>'group_key' COLLATE "C") AS keys
   FROM requests r CROSS JOIN LATERAL jsonb_array_elements(r.receipts) item GROUP BY r.batch_index
 )
 SELECT (SELECT count(*) FROM outputs),
  EXISTS(SELECT 1 FROM outputs GROUP BY batch_index HAVING batch_index IS NULL OR count(*)<>1)
  OR EXISTS(SELECT 1 FROM previous p LEFT JOIN outputs o USING(batch_index) WHERE o.batch_index IS NULL
    OR NOT (o.output @> p.output) OR o.output IS DISTINCT FROM p.output AND signal_topic_editorial_normalize_output_v1(o.output) IS DISTINCT FROM signal_topic_editorial_normalize_output_v1(p.output)),
  EXISTS(SELECT 1 FROM delta d WHERE NOT EXISTS(SELECT 1 FROM paid p WHERE p.batch_index=d.batch_index AND p.normalized=d.normalized)),
  EXISTS(SELECT 1 FROM delta d LEFT JOIN decision_keys actual USING(batch_index) LEFT JOIN expected_keys expected USING(batch_index)
    WHERE actual.keys IS DISTINCT FROM expected.keys)
 INTO seen,invalid,unpaid,bad_coverage;
 IF invalid THEN RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;
 IF unpaid THEN RAISE EXCEPTION 'topic_editorial_state_unpaid' USING ERRCODE='23514';END IF;
 IF bad_coverage THEN RAISE EXCEPTION 'topic_editorial_state_coverage_invalid' USING ERRCODE='23514';END IF;
 IF body->>'phase' IN('global','completed') AND seen<>jsonb_array_length(NEW.plan->'batches')
  OR body->>'phase'='screening' AND seen>=jsonb_array_length(NEW.plan->'batches') THEN
  RAISE EXCEPTION 'topic_editorial_state_coverage_invalid' USING ERRCODE='23514';END IF;
 IF body->>'phase'='completed' THEN
  IF NOT EXISTS(SELECT 1 FROM signal_topic_editorial_requests q JOIN signal_topic_editorial_requests paid ON paid.id=q.id OR paid.parent_request_id=q.id
   JOIN signal_topic_editorial_calls c ON c.request_id=paid.id
   WHERE q.execution_id=NEW.id AND q.workspace_id=NEW.workspace_id AND q.phase='global' AND q.parent_request_id IS NULL
    AND paid.execution_id=NEW.id AND paid.workspace_id=NEW.workspace_id AND c.execution_id=NEW.id AND c.workspace_id=NEW.workspace_id
    AND q.request_digest=body->'global'->>'request_digest' AND c.status='settled' AND c.response_http_status=200 AND c.response_complete=true
    AND signal_topic_editorial_normalize_output_v1(c.response_output)=signal_topic_editorial_normalize_output_v1(body->'global'->'result')) THEN
   RAISE EXCEPTION 'topic_editorial_global_unpaid' USING ERRCODE='23514';END IF;
 ELSE IF body->'global' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'topic_editorial_state_invalid' USING ERRCODE='23514';END IF;END IF;
 RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION signal_topic_editorial_admission_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_topic_editorial_executions%ROWTYPE;
BEGIN
 IF NEW.action<>'topic_consolidation' THEN RETURN NULL;END IF;
 SELECT * INTO e FROM signal_topic_editorial_executions WHERE id=NEW.target_id AND processing_admission_id=NEW.id;
 IF e.id IS NULL OR e.workspace_id<>NEW.workspace_id OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_outbox WHERE execution_id=e.id AND dispatch_generation=1)
  OR NOT EXISTS(SELECT 1 FROM signal_topic_editorial_request_keys WHERE execution_id=e.id AND request_digest=e.request_digest)
  OR (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id=e.id AND phase='screening' AND parent_request_id IS NULL)<>jsonb_array_length(e.plan->'batches') THEN
  RAISE EXCEPTION 'topic_editorial_admission_incomplete' USING ERRCODE='23514';END IF;RETURN NULL;
END;$$;
