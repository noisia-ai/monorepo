-- Brand Context stage two. No migration-time policy, grant, provider or queue work.
-- The server supplies a plan built by loadSignalWorkspaceTopicPrototypePlanV1;
-- it is never a browser payload. SQL seals its bytes to the exact paid parent,
-- current publication and policy. The existing embedding Worker stays gated
-- until a separate server adapter consumes this contract.
-- SQL validates structural/text/definition integrity; the server adapter MUST
-- rebuild context_digest and every compiled input from the current published
-- pack in the same transaction. A caller-supplied plan is not semantic proof.

CREATE FUNCTION signal_brand_context_composed_generation_valid_v1(target_generation uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_brand_context_processing_receipts receipt
  JOIN signal_processing_admissions admission ON admission.id=receipt.semantic_admission_id
  JOIN signal_semantic_context_proposal_runs run ON run.id=receipt.semantic_run_id
  JOIN signal_semantic_context_generations generation ON generation.id=receipt.generation_id
  WHERE receipt.generation_id=target_generation AND generation.workspace_id=receipt.workspace_id
   AND run.workspace_id=receipt.workspace_id AND run.generation_id=receipt.generation_id
   AND run.created_by_user_id=receipt.actor_user_id AND run.processing_admission_id=admission.id
   AND run.brand_context_preparation_operation_id IS NULL
   AND admission.workspace_id=receipt.workspace_id AND admission.organization_id=receipt.organization_id
   AND admission.actor_user_id=receipt.actor_user_id AND admission.brand_id=receipt.brand_id
   AND admission.action='brand_context_proposal' AND admission.target_id=run.id
   AND admission.brand_context_processing_receipt_id=receipt.id
   AND run.status='completed' AND run.provider_call_state='settled'
   AND run.automatic_policy_contract_version='signal-semantic-context-automatic-disposition-v1'
   AND ROW(run.brand_os_digest,run.knowledge_digest,run.locale_context_digest)
    IS NOT DISTINCT FROM ROW(generation.brand_os_digest,generation.knowledge_digest,generation.locale_context_digest)
   AND signal_semantic_context_automatic_operation_run_valid_v1(run.appended_operation_id)
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=run.appended_operation_id AND element.automatic_policy_contract_version IS NOT NULL
     AND signal_semantic_context_automatic_policy_valid_v1(element.id) IS DISTINCT FROM true)
   AND (SELECT count(*) FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=run.appended_operation_id AND element.automatic_policy_outcome='ready')=run.automatic_ready_count
   AND (SELECT count(*) FROM signal_semantic_context_element_versions element
    WHERE element.operation_id=run.appended_operation_id AND element.automatic_policy_outcome='exception')=run.automatic_exception_count)
$$;

-- Keep the old admitted/carry branch verbatim. The new branch is direct only:
-- edited descendants do not inherit a client's monetary authority.
ALTER FUNCTION signal_brand_context_automatic_generation_v1(uuid) RENAME TO signal_brand_context_automatic_generation_pre_0157;
CREATE FUNCTION signal_brand_context_automatic_generation_v1(p_generation_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF signal_brand_context_composed_generation_valid_v1(p_generation_id) THEN RETURN true; END IF;
 -- The old function resolves its parent by the public function name. Prevent
 -- that recursion from silently extending the new client's direct-only branch.
 IF EXISTS(WITH RECURSIVE ancestors AS (
   SELECT id,workspace_id,supersedes_generation_id,generation_version FROM signal_semantic_context_generations WHERE id=p_generation_id
   UNION ALL SELECT parent.id,parent.workspace_id,parent.supersedes_generation_id,parent.generation_version
   FROM signal_semantic_context_generations parent JOIN ancestors child ON parent.id=child.supersedes_generation_id
    AND parent.workspace_id=child.workspace_id AND parent.generation_version<child.generation_version)
  SELECT 1 FROM ancestors JOIN signal_brand_context_processing_receipts receipt ON receipt.generation_id=ancestors.id) THEN RETURN false; END IF;
 RETURN signal_brand_context_automatic_generation_pre_0157(p_generation_id);
END;
$$;

CREATE FUNCTION signal_brand_context_prototype_plan_valid_v1(target_workspace uuid,plan jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE profile signal_taxonomy_profiles%ROWTYPE;item jsonb;entry record;aliases jsonb:='{}';references_count integer:=0;
BEGIN
 IF plan IS NULL OR jsonb_typeof(plan)<>'object' OR pg_column_size(plan)>8388608
  OR plan->>'contract_version' IS DISTINCT FROM 'signal-workspace-topic-prototype-plan-v1'
  OR NOT signal_semantic_context_json_object_keys_match_v1(plan,CASE WHEN plan ? 'context_inputs' THEN
    ARRAY['contract_version','taxonomy_profile_id','embedding_profile','context_digest','topics','context_inputs','inputs','texts','plan_digest']
   ELSE ARRAY['contract_version','taxonomy_profile_id','embedding_profile','context_digest','topics','inputs','texts','plan_digest'] END)
  OR NOT COALESCE(plan->>'context_digest'~'^sha256:[0-9a-f]{64}$',false)
  OR plan->>'plan_digest' IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(
    signal_semantic_context_canonical_json_v1(plan-'plan_digest'),'UTF8')),'hex')
  OR NOT signal_brand_context_prototype_configuration_v1(plan->'embedding_profile')
  OR jsonb_typeof(plan->'topics') IS DISTINCT FROM 'array' OR jsonb_typeof(plan->'inputs') IS DISTINCT FROM 'array'
  OR jsonb_typeof(plan->'texts') IS DISTINCT FROM 'object'
  OR jsonb_typeof(COALESCE(plan->'context_inputs','[]')) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 SELECT * INTO profile FROM signal_taxonomy_profiles WHERE id=(plan->>'taxonomy_profile_id')::uuid;
 IF profile.workspace_id IS DISTINCT FROM target_workspace OR profile.kind IS DISTINCT FROM 'topic'
  OR profile.status NOT IN('draft','activating','active')
  OR profile.metadata->>'contract_version' IS DISTINCT FROM 'signal-topic-catalog-v1' THEN RETURN false; END IF;
 FOR entry IN SELECT key,value FROM jsonb_each(plan->'texts') LOOP
  IF jsonb_typeof(entry.value)<>'string' OR entry.key IS DISTINCT FROM
    'sha256:'||encode(digest(entry.value#>>'{}','sha256'),'hex')
   OR length(entry.value#>>'{}')=0 OR octet_length(normalize(entry.value#>>'{}',NFC))+64>32000 THEN RETURN false; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(plan->'inputs') LOOP
  IF NOT signal_semantic_context_json_object_keys_match_v1(item,ARRAY['input_digest','text_sha256'])
   OR NOT COALESCE(item->>'input_digest'~'^sha256:[0-9a-f]{64}$',false)
   OR NOT COALESCE(item->>'text_sha256'~'^sha256:[0-9a-f]{64}$',false)
   OR NOT ((plan->'texts') ? (item->>'text_sha256')) OR aliases ? (item->>'input_digest') THEN RETURN false; END IF;
  aliases:=aliases||jsonb_build_object(item->>'input_digest',item->>'text_sha256');
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(plan->'texts') text_hash WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_each_text(aliases) alias WHERE alias.value=text_hash)) THEN RETURN false; END IF;
 IF (SELECT count(*)<>count(DISTINCT value->>'taxonomy_term_id') FROM jsonb_array_elements(plan->'topics')) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(plan->'topics') LOOP
  IF NOT signal_semantic_context_json_object_keys_match_v1(item,ARRAY['taxonomy_term_id','definition_digest','definition_revision','compiler_digest','context_digest','input_digests'])
   OR jsonb_typeof(item->'input_digests') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'input_digests')=0
   OR NOT COALESCE(item->>'compiler_digest'~'^sha256:[0-9a-f]{64}$',false)
   OR NOT COALESCE(item->>'context_digest'~'^sha256:[0-9a-f]{64}$',false)
   OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements_text(item->'input_digests'))
   OR NOT EXISTS(SELECT 1 FROM taxonomy_terms term WHERE term.id=(item->>'taxonomy_term_id')::uuid
    AND term.taxonomy_id=profile.taxonomy_id AND term.metadata->'topic'->>'lifecycle'<>'archived'
    AND term.metadata->'topic'->>'definition_digest'=item->>'definition_digest'
    AND term.metadata->'topic'->>'definition_revision'=item->>'definition_revision')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(item->'input_digests') value WHERE NOT aliases ? value) THEN RETURN false; END IF;
  references_count:=references_count+jsonb_array_length(item->'input_digests');
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(plan->'context_inputs','[]')) LOOP
  IF NOT signal_semantic_context_json_object_keys_match_v1(item,ARRAY['guide_key','role','input_digest','text_sha256'])
   OR NOT COALESCE(item->>'guide_key' IN('scope:primary_brand','scope:competitor','scope:category'),false)
   OR NOT COALESCE(item->>'role' IN('scope_positive','scope_negative'),false)
   OR NOT COALESCE(item->>'input_digest'~'^sha256:[0-9a-f]{64}$',false)
   OR NOT COALESCE(item->>'text_sha256'~'^sha256:[0-9a-f]{64}$',false)
   OR aliases->>(item->>'input_digest') IS DISTINCT FROM item->>'text_sha256' THEN RETURN false; END IF;
  references_count:=references_count+1;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT value->>'input_digest') FROM jsonb_array_elements(COALESCE(plan->'context_inputs','[]'))) THEN RETURN false; END IF;
 -- Every alias must be used by a Topic or an autonomous context guide.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(aliases) key WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(plan->'topics') topic,jsonb_array_elements_text(topic->'input_digests') alias WHERE alias=key)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(plan->'context_inputs','[]')) context_entry(value) WHERE context_entry.value->>'input_digest'=key)) THEN RETURN false; END IF;
 RETURN references_count>=jsonb_array_length(plan->'inputs');
EXCEPTION WHEN data_exception OR numeric_value_out_of_range THEN RETURN false;
END; $$;

CREATE TABLE signal_brand_context_prototype_receipts (
 id uuid PRIMARY KEY,
 parent_receipt_id uuid NOT NULL CONSTRAINT fk_bc_prototype_parent REFERENCES signal_brand_context_processing_receipts(id) ON DELETE RESTRICT,
 supersedes_receipt_id uuid CONSTRAINT fk_bc_prototype_supersedes REFERENCES signal_brand_context_prototype_receipts(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL CONSTRAINT fk_bc_prototype_org REFERENCES organizations(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL CONSTRAINT fk_bc_prototype_workspace REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 brand_id uuid NOT NULL CONSTRAINT fk_bc_prototype_brand REFERENCES brands(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL CONSTRAINT fk_bc_prototype_actor REFERENCES users(id) ON DELETE RESTRICT,
 generation_id uuid NOT NULL CONSTRAINT fk_bc_prototype_generation REFERENCES signal_semantic_context_generations(id) ON DELETE RESTRICT,
 taxonomy_profile_id uuid NOT NULL CONSTRAINT fk_bc_prototype_profile REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
 policy_version_id uuid NOT NULL CONSTRAINT fk_bc_prototype_policy REFERENCES signal_processing_policy_versions(id) ON DELETE RESTRICT,
 admission_id uuid NOT NULL CONSTRAINT fk_bc_prototype_admission REFERENCES signal_processing_admissions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 run_id uuid NOT NULL CONSTRAINT fk_bc_prototype_run REFERENCES signal_workspace_embedding_runs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 idempotency_key text NOT NULL CONSTRAINT bc_prototype_key CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 confirmation text CONSTRAINT bc_prototype_confirmation CHECK(confirmation='prepare_brand_context_prototypes_within_shown_cap'),
 request_digest text NOT NULL CONSTRAINT bc_prototype_request_digest CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 pack_digest text NOT NULL CONSTRAINT bc_prototype_pack_digest CHECK(pack_digest~'^sha256:[0-9a-f]{64}$'),
 plan_digest text NOT NULL CONSTRAINT bc_prototype_plan_digest CHECK(plan_digest~'^sha256:[0-9a-f]{64}$'),
 configuration_digest text NOT NULL CONSTRAINT bc_prototype_configuration_digest CHECK(configuration_digest~'^sha256:[0-9a-f]{64}$'),
 plan jsonb NOT NULL CONSTRAINT bc_prototype_plan_size CHECK(jsonb_typeof(plan)='object' AND pg_column_size(plan)<=8388608),
 quote_digest text NOT NULL CONSTRAINT bc_prototype_quote_digest CHECK(quote_digest~'^sha256:[0-9a-f]{64}$'),
 quote_snapshot jsonb NOT NULL CONSTRAINT bc_prototype_quote_size CHECK(jsonb_typeof(quote_snapshot)='object' AND pg_column_size(quote_snapshot)<=32768),
 execution_cap_micro_usd bigint NOT NULL CONSTRAINT bc_prototype_cap CHECK(execution_cap_micro_usd>=0),
 budget_date date NOT NULL,budget_timezone text NOT NULL,admission_not_after timestamptz NOT NULL,
 receipt_digest text NOT NULL CONSTRAINT bc_prototype_receipt_digest CHECK(receipt_digest~'^sha256:[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT uq_bc_prototype_successor UNIQUE(supersedes_receipt_id),
 CONSTRAINT uq_bc_prototype_request UNIQUE(workspace_id,actor_user_id,idempotency_key),
 CONSTRAINT uq_bc_prototype_admission UNIQUE(admission_id),CONSTRAINT uq_bc_prototype_run UNIQUE(run_id)
);
CREATE UNIQUE INDEX uq_bc_prototype_root ON signal_brand_context_prototype_receipts(parent_receipt_id) WHERE supersedes_receipt_id IS NULL;
ALTER TABLE signal_processing_admissions ADD COLUMN brand_context_prototype_receipt_id uuid
 CONSTRAINT fk_processing_prototype_receipt REFERENCES signal_brand_context_prototype_receipts(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- A new authorization may replace only an exhausted attempt proven not sent.
-- Keep the original run and receipt unchanged; no ambiguous/paid call can be
-- converted to available capacity by this transition.
CREATE FUNCTION signal_brand_context_prototype_retry_safe_v1(target_run uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspace_embedding_runs run
  JOIN signal_brand_context_prototype_receipts receipt ON receipt.run_id=run.id AND receipt.admission_id=run.processing_admission_id
  WHERE run.id=target_run AND run.workspace_id=receipt.workspace_id AND run.actor_user_id=receipt.actor_user_id
   AND run.input_contract='topic_prototypes' AND run.brand_context_preparation_operation_id IS NULL
   AND run.status IN('failed','canceled') AND run.execution_token IS NULL
   AND run.reserved_micro_usd=0 AND run.settled_micro_usd=0 AND run.unknown_reserved_micro_usd=0 AND run.observed_exception_micro_usd=0
   AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id
    AND (call.status<>'definitely_not_sent' OR call.response_body_private IS NOT NULL)))
$$;

CREATE FUNCTION quote_signal_brand_context_prototypes_v1(parent_receipt_id uuid,target_actor uuid,prototype_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $$
DECLARE parent signal_brand_context_processing_receipts%ROWTYPE;generation signal_semantic_context_generations%ROWTYPE;
 policy signal_processing_policy_versions%ROWTYPE;action signal_processing_policy_actions%ROWTYPE;exposure record;
 previous signal_brand_context_prototype_receipts%ROWTYPE;inherited_authorization boolean;
 instant timestamptz:=clock_timestamp();day date;expires timestamptz;missing_count bigint;input_bytes bigint;tokens bigint;estimate bigint;
 total_count bigint;cached_count bigint;execution_cap bigint;blocked text;snapshot jsonb;
BEGIN
 SELECT * INTO parent FROM signal_brand_context_processing_receipts WHERE id=parent_receipt_id;
 IF parent.id IS NULL OR parent.actor_user_id IS DISTINCT FROM target_actor
  OR NOT signal_brand_context_processing_actor_v1(parent.workspace_id,target_actor)
  OR NOT EXISTS(SELECT 1 FROM signal_workspaces WHERE id=parent.workspace_id AND organization_id=parent.organization_id AND brand_id=parent.brand_id) THEN
  RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=parent.generation_id;
 IF generation.status IS DISTINCT FROM 'published' OR generation.publication_schema_version IS DISTINCT FROM 'signal-semantic-context-publication-v2'
  OR generation.semantic_context_pack_digest IS NULL OR generation.published_operation_id IS NULL
  OR NOT signal_brand_context_composed_generation_valid_v1(generation.id)
  OR EXISTS(SELECT 1 FROM signal_semantic_context_generations newer WHERE newer.workspace_id=parent.workspace_id
   AND newer.status='published' AND newer.generation_version>generation.generation_version)
  OR NOT signal_brand_context_processing_source_current_v1(generation.id) THEN
  RAISE EXCEPTION 'brand_context_prototype_publication_required' USING ERRCODE='23514'; END IF;
 IF NOT signal_brand_context_prototype_plan_valid_v1(parent.workspace_id,prototype_plan) THEN
  RAISE EXCEPTION 'brand_context_prototype_plan_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM signal_brand_context_prototype_receipts receipt WHERE receipt.parent_receipt_id=parent.id
  AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor WHERE successor.supersedes_receipt_id=receipt.id);
 IF previous.id IS NOT NULL AND NOT signal_brand_context_prototype_retry_safe_v1(previous.run_id) THEN
  RAISE EXCEPTION 'brand_context_prototype_prior_run_unresolved' USING ERRCODE='23514'; END IF;
 SELECT * INTO policy FROM signal_processing_policy_versions WHERE organization_id=parent.organization_id AND status='active';
 SELECT configured.* INTO action FROM signal_processing_policy_actions configured WHERE configured.policy_version_id=policy.id AND configured.action='topic_prototype_embeddings';
 IF policy.status IS DISTINCT FROM 'active' OR policy.organization_id IS DISTINCT FROM parent.organization_id
  OR instant<policy.valid_from OR instant>=policy.valid_until THEN
  RAISE EXCEPTION 'brand_context_prototype_authorization_expired' USING ERRCODE='23514'; END IF;
 IF action.action IS NULL OR action.kind<>'provider' OR action.provider<>'voyage' OR action.model<>'voyage-4-large' OR NOT action.automatic_allowed
  OR NOT signal_brand_context_prototype_configuration_v1(action.configuration)
  OR action.configuration IS DISTINCT FROM prototype_plan->'embedding_profile' THEN
  RAISE EXCEPTION 'brand_context_prototype_configuration_changed' USING ERRCODE='23514'; END IF;
 day:=(instant AT TIME ZONE policy.budget_timezone)::date;
 inherited_authorization:=previous.id IS NULL AND instant<parent.authorization_not_after
  AND day=parent.budget_date AND policy.budget_timezone=parent.budget_timezone AND policy.id=parent.policy_version_id
  AND (to_jsonb(action)-'policy_version_id') IS NOT DISTINCT FROM parent.quote_snapshot->'prototype_action'
  AND action.max_execution_micro_usd=parent.prototype_cap_micro_usd;
 SELECT count(*),count(*) FILTER(WHERE cache.chunk_sha256 IS NOT NULL),count(*) FILTER(WHERE cache.chunk_sha256 IS NULL),
  COALESCE(sum(octet_length(text.value)) FILTER(WHERE cache.chunk_sha256 IS NULL),0)
 INTO total_count,cached_count,missing_count,input_bytes FROM jsonb_each_text(prototype_plan->'texts') text
 LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=parent.workspace_id
  AND cache.config_digest=prototype_plan->'embedding_profile'->>'config_digest' AND cache.chunk_sha256=text.key;
 SELECT call.status INTO blocked FROM signal_workspace_embedding_calls call WHERE call.workspace_id=parent.workspace_id
  AND call.config_digest=prototype_plan->'embedding_profile'->>'config_digest' AND call.status<>'definitely_not_sent'
  AND EXISTS(SELECT 1 FROM jsonb_object_keys(prototype_plan->'texts') text_hash WHERE text_hash=ANY(call.input_keys)
   AND NOT EXISTS(SELECT 1 FROM signal_workspace_chunk_embeddings cache WHERE cache.workspace_id=parent.workspace_id
    AND cache.config_digest=call.config_digest AND cache.chunk_sha256=text_hash)) LIMIT 1;
 IF blocked IS NOT NULL THEN RAISE EXCEPTION 'brand_context_prototype_prior_call_unresolved' USING ERRCODE='23514'; END IF;
 tokens:=input_bytes*3+missing_count*64;estimate:=(tokens*12+99)/100+greatest(0,missing_count-1);
 IF estimate>action.max_execution_micro_usd THEN RAISE EXCEPTION 'processing_execution_cap_exhausted' USING ERRCODE='23514'; END IF;
 -- Complete physical cache coverage grants no provider capacity, even when the
 -- policy ceiling is larger or the organization's paid budget is exhausted.
 execution_cap:=CASE WHEN missing_count=0 THEN 0 ELSE action.max_execution_micro_usd END;
 SELECT * INTO exposure FROM signal_processing_org_exposure_v1(parent.organization_id,day,policy.budget_timezone);
 IF execution_cap>0 AND exposure.total_micro_usd+execution_cap>policy.daily_cap_micro_usd THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 expires:=least(to_timestamp(floor(extract(epoch FROM instant)/300)*300)+interval '5 minutes',
  CASE WHEN inherited_authorization THEN parent.authorization_not_after ELSE policy.valid_until END,
  policy.valid_until,((day+1)::timestamp AT TIME ZONE policy.budget_timezone));
 snapshot:=jsonb_build_object('contract_version','brand-context-prototypes-authority-v1','parent_receipt_id',parent.id,
  'workspace_id',parent.workspace_id,'organization_id',parent.organization_id,'brand_id',parent.brand_id,'actor_user_id',target_actor,
  'generation_id',generation.id,'pack_digest',generation.semantic_context_pack_digest,'source_authority_digest',parent.source_authority_digest,
  'supersedes_receipt_id',previous.id,'requires_confirmation',NOT inherited_authorization AND missing_count>0,
  'authorization_state',CASE WHEN inherited_authorization OR missing_count=0 THEN 'automatic_ready' ELSE 'awaiting_authorization' END,
  'taxonomy_profile_id',prototype_plan->>'taxonomy_profile_id','plan_digest',prototype_plan->>'plan_digest',
  'context_digest',prototype_plan->>'context_digest',
  'policy_version_id',policy.id,'policy_digest',policy.policy_digest,'configuration_digest',action.configuration_digest,
  'execution_cap_micro_usd',execution_cap,'budget_date',day,'budget_timezone',policy.budget_timezone,
  'admission_not_after',least(CASE WHEN inherited_authorization THEN parent.authorization_not_after ELSE policy.valid_until END,
    policy.valid_until,((day+1)::timestamp AT TIME ZONE policy.budget_timezone)),
  'quote_expires_at',expires,'exposure',to_jsonb(exposure),'total_unique_inputs',total_count,'cached_unique_inputs',cached_count,
  'missing_unique_inputs',missing_count,'input_bytes',input_bytes,'tokens_upper',tokens,'estimated_upper_micro_usd',estimate,'requires_provider',missing_count>0);
 RETURN jsonb_build_object('quote_snapshot',snapshot,'quote_digest',signal_semantic_context_digest_json_v2(snapshot));
END; $$;

CREATE FUNCTION guard_signal_brand_context_prototype_receipt_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE quote jsonb;expected_request text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'brand_context_prototype_receipt_immutable' USING ERRCODE='23514'; END IF;
 quote:=quote_signal_brand_context_prototypes_v1(NEW.parent_receipt_id,NEW.actor_user_id,NEW.plan);
 expected_request:=signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','brand-context-prototypes-request-v1',
  'parent_receipt_id',NEW.parent_receipt_id,'actor_user_id',NEW.actor_user_id,'pack_digest',NEW.pack_digest,
  'plan',NEW.plan,'quote_digest',NEW.quote_digest,'confirmation',NEW.confirmation));
 IF NEW.quote_snapshot IS DISTINCT FROM quote->'quote_snapshot' OR NEW.quote_digest IS DISTINCT FROM quote->>'quote_digest'
  OR NEW.request_digest IS DISTINCT FROM expected_request OR (NEW.quote_snapshot->>'quote_expires_at')::timestamptz<=clock_timestamp()
  OR NEW.supersedes_receipt_id IS DISTINCT FROM (NEW.quote_snapshot->>'supersedes_receipt_id')::uuid
  OR (NEW.quote_snapshot->>'requires_confirmation')::boolean AND NEW.confirmation IS DISTINCT FROM 'prepare_brand_context_prototypes_within_shown_cap'
  OR NEW.workspace_id::text IS DISTINCT FROM NEW.quote_snapshot->>'workspace_id'
  OR NEW.organization_id::text IS DISTINCT FROM NEW.quote_snapshot->>'organization_id'
  OR NEW.brand_id::text IS DISTINCT FROM NEW.quote_snapshot->>'brand_id'
  OR NEW.generation_id::text IS DISTINCT FROM NEW.quote_snapshot->>'generation_id'
  OR NEW.taxonomy_profile_id::text IS DISTINCT FROM NEW.quote_snapshot->>'taxonomy_profile_id'
  OR NEW.policy_version_id::text IS DISTINCT FROM NEW.quote_snapshot->>'policy_version_id'
  OR NEW.pack_digest IS DISTINCT FROM NEW.quote_snapshot->>'pack_digest'
  OR NEW.plan_digest IS DISTINCT FROM NEW.quote_snapshot->>'plan_digest'
  OR NEW.configuration_digest IS DISTINCT FROM NEW.quote_snapshot->>'configuration_digest'
  OR NEW.execution_cap_micro_usd IS DISTINCT FROM (NEW.quote_snapshot->>'execution_cap_micro_usd')::bigint
  OR NEW.budget_date IS DISTINCT FROM (NEW.quote_snapshot->>'budget_date')::date
  OR NEW.budget_timezone IS DISTINCT FROM NEW.quote_snapshot->>'budget_timezone'
  OR NEW.admission_not_after IS DISTINCT FROM (NEW.quote_snapshot->>'admission_not_after')::timestamptz THEN
  RAISE EXCEPTION 'brand_context_prototype_receipt_invalid' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');RETURN NEW;
END; $$;
CREATE TRIGGER bc_prototype_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_brand_context_prototype_receipts
 FOR EACH ROW EXECUTE FUNCTION guard_signal_brand_context_prototype_receipt_v1();

CREATE FUNCTION complete_signal_brand_context_prototype_receipt_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE admission signal_processing_admissions%ROWTYPE;run signal_workspace_embedding_runs%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=NEW.admission_id;
 SELECT * INTO run FROM signal_workspace_embedding_runs WHERE id=NEW.run_id;
 IF admission.id IS NULL OR admission.action IS DISTINCT FROM 'topic_prototype_embeddings'
  OR admission.automatic IS DISTINCT FROM true
  OR ROW(admission.workspace_id,admission.organization_id,admission.brand_id,admission.actor_user_id,admission.policy_version_id,
    admission.target_id,admission.brand_context_processing_receipt_id,admission.brand_context_prototype_receipt_id)
   IS DISTINCT FROM ROW(NEW.workspace_id,NEW.organization_id,NEW.brand_id,NEW.actor_user_id,NEW.policy_version_id,NEW.run_id,NEW.parent_receipt_id,NEW.id)
  OR admission.request_digest IS DISTINCT FROM NEW.request_digest OR admission.idempotency_key IS DISTINCT FROM NEW.idempotency_key
  OR admission.configuration IS DISTINCT FROM NEW.plan->'embedding_profile' OR admission.configuration_digest IS DISTINCT FROM NEW.configuration_digest
  OR admission.execution_cap_micro_usd IS DISTINCT FROM NEW.execution_cap_micro_usd OR admission.budget_date IS DISTINCT FROM NEW.budget_date
  OR admission.budget_timezone IS DISTINCT FROM NEW.budget_timezone OR admission.admission_not_after IS DISTINCT FROM NEW.admission_not_after
  OR run.id IS NULL OR run.workspace_id IS DISTINCT FROM NEW.workspace_id OR run.actor_user_id IS DISTINCT FROM NEW.actor_user_id
  OR run.processing_admission_id IS DISTINCT FROM NEW.admission_id OR run.brand_context_preparation_operation_id IS NOT NULL
  OR run.input_contract IS DISTINCT FROM 'topic_prototypes' OR run.taxonomy_profile_id IS DISTINCT FROM NEW.taxonomy_profile_id
  OR run.topic_input_snapshot IS DISTINCT FROM NEW.plan OR run.topic_input_digest IS DISTINCT FROM NEW.plan_digest
  OR run.profile IS DISTINCT FROM NEW.plan->'embedding_profile' OR run.hard_cap_micro_usd IS DISTINCT FROM NEW.execution_cap_micro_usd
  OR run.quote_digest IS DISTINCT FROM NEW.quote_digest OR run.status IS DISTINCT FROM 'queued' OR run.dispatch_status IS DISTINCT FROM 'pending'
  OR run.request_keys IS DISTINCT FROM jsonb_build_object(NEW.idempotency_key,jsonb_build_object('actor_user_id',NEW.actor_user_id,'request_digest',NEW.request_digest))
  OR run.execution_token IS NOT NULL OR run.reserved_micro_usd<>0 OR run.settled_micro_usd<>0
  OR EXISTS(SELECT 1 FROM signal_workspace_embedding_calls WHERE run_id=NEW.run_id) THEN
  RAISE EXCEPTION 'brand_context_prototype_atomic_bundle_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER bc_prototype_receipt_complete AFTER INSERT ON signal_brand_context_prototype_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_signal_brand_context_prototype_receipt_v1();

-- Preserve every stage-one/ordinary admission check; only the previously closed
-- Voyage branch changes. Both parent and child pointers must match, so merely
-- knowing a stage-one receipt never authorizes another run.
CREATE OR REPLACE FUNCTION signal_processing_admission_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;
 child signal_brand_context_prototype_receipts%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514'; END IF;
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
   PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
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

CREATE FUNCTION authorize_signal_brand_context_prototypes_v1(parent_receipt_id uuid,target_actor uuid,request_key text,
 expected_pack_digest text,prototype_plan jsonb,quote_hash text,stable_confirmation text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE parent signal_brand_context_processing_receipts%ROWTYPE;prior signal_brand_context_prototype_receipts%ROWTYPE;
 action signal_processing_policy_actions%ROWTYPE;policy signal_processing_policy_versions%ROWTYPE;
 quote jsonb;snapshot jsonb;request_hash text;locked_day date;
 receipt_id uuid:=gen_random_uuid();admission_id uuid:=gen_random_uuid();run_id uuid:=gen_random_uuid();topic_count integer;reference_count integer;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'processing_capacity_requires_read_committed' USING ERRCODE='25001'; END IF;
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$' AND expected_pack_digest~'^sha256:[0-9a-f]{64}$'
  AND quote_hash~'^sha256:[0-9a-f]{64}$',false) OR prototype_plan IS NULL
  OR stable_confirmation IS NOT NULL AND stable_confirmation<>'prepare_brand_context_prototypes_within_shown_cap' THEN
  RAISE EXCEPTION 'brand_context_prototype_request_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO parent FROM signal_brand_context_processing_receipts WHERE id=parent_receipt_id;
 IF parent.id IS NULL OR parent.actor_user_id IS DISTINCT FROM target_actor THEN RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 -- Workers already acquire taxonomy before owner/policy. Never take policy and
 -- then wait on taxonomy, nor hold this organization's lock while visiting a
 -- second workspace. Actor rows are locked only after the daily money fence.
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||parent.workspace_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||parent.workspace_id::text||':topic',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-embedding-request:'||parent.workspace_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||parent.organization_id::text,0));
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','brand-context-prototypes-request-v1',
  'parent_receipt_id',parent.id,'actor_user_id',target_actor,'pack_digest',expected_pack_digest,'plan',prototype_plan,'quote_digest',quote_hash,'confirmation',stable_confirmation));
 SELECT * INTO prior FROM signal_brand_context_prototype_receipts WHERE workspace_id=parent.workspace_id AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  PERFORM signal_processing_lock_v1(parent.organization_id,prior.budget_date);
  PERFORM signal_brand_context_processing_lock_actor_v1(parent.workspace_id,target_actor);
  IF NOT EXISTS(SELECT 1 FROM signal_workspaces WHERE id=parent.workspace_id AND organization_id=parent.organization_id AND brand_id=parent.brand_id) THEN
   RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
  IF prior.parent_receipt_id<>parent.id OR prior.request_digest<>request_hash THEN RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('replayed',true,'run_id',prior.run_id,'receipt',to_jsonb(prior));
 END IF;
 SELECT * INTO policy FROM signal_processing_policy_versions WHERE organization_id=parent.organization_id AND status='active';
 IF policy.id IS NULL THEN RAISE EXCEPTION 'processing_policy_missing' USING ERRCODE='23514'; END IF;
 locked_day:=(clock_timestamp() AT TIME ZONE policy.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(parent.organization_id,locked_day);
 PERFORM signal_brand_context_processing_lock_actor_v1(parent.workspace_id,target_actor);
 quote:=quote_signal_brand_context_prototypes_v1(parent.id,target_actor,prototype_plan);snapshot:=quote->'quote_snapshot';
 IF (snapshot->>'budget_date')::date<>locked_day THEN RAISE EXCEPTION 'processing_budget_date_expired' USING ERRCODE='23514'; END IF;
 IF quote->>'quote_digest' IS DISTINCT FROM quote_hash OR snapshot->>'pack_digest' IS DISTINCT FROM expected_pack_digest THEN
  RAISE EXCEPTION 'brand_context_prototype_quote_changed' USING ERRCODE='23514'; END IF;
 IF (snapshot->>'requires_confirmation')::boolean AND stable_confirmation IS DISTINCT FROM 'prepare_brand_context_prototypes_within_shown_cap' THEN
  RAISE EXCEPTION 'brand_context_prototype_awaiting_authorization' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM signal_workspace_embedding_runs WHERE workspace_id=parent.workspace_id
  AND config_digest=prototype_plan->'embedding_profile'->>'config_digest' AND status IN('queued','running')) THEN
  RAISE EXCEPTION 'workspace_embedding_already_running' USING ERRCODE='23514'; END IF;
 SELECT configured.* INTO action FROM signal_processing_policy_actions configured WHERE configured.policy_version_id=(snapshot->>'policy_version_id')::uuid AND configured.action='topic_prototype_embeddings';
 INSERT INTO signal_brand_context_prototype_receipts(id,parent_receipt_id,supersedes_receipt_id,confirmation,organization_id,workspace_id,brand_id,actor_user_id,generation_id,
  taxonomy_profile_id,policy_version_id,admission_id,run_id,idempotency_key,request_digest,pack_digest,plan_digest,configuration_digest,
  plan,quote_digest,quote_snapshot,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,receipt_digest)
 VALUES(receipt_id,parent.id,(snapshot->>'supersedes_receipt_id')::uuid,stable_confirmation,parent.organization_id,parent.workspace_id,parent.brand_id,target_actor,parent.generation_id,
  (prototype_plan->>'taxonomy_profile_id')::uuid,(snapshot->>'policy_version_id')::uuid,admission_id,run_id,request_key,request_hash,expected_pack_digest,
  prototype_plan->>'plan_digest',action.configuration_digest,prototype_plan,quote_hash,snapshot,(snapshot->>'execution_cap_micro_usd')::bigint,
  (snapshot->>'budget_date')::date,snapshot->>'budget_timezone',(snapshot->>'admission_not_after')::timestamptz,'pending') RETURNING * INTO prior;
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,target_id,
  idempotency_key,request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,
  admission_not_after,automatic,receipt_digest,brand_context_processing_receipt_id,brand_context_prototype_receipt_id)
 VALUES(admission_id,parent.organization_id,parent.workspace_id,parent.brand_id,target_actor,prior.policy_version_id,'topic_prototype_embeddings',run_id,
  request_key,request_hash,action.provider,action.model,action.configuration,action.configuration_digest,prior.execution_cap_micro_usd,prior.budget_date,
  prior.budget_timezone,prior.admission_not_after,true,'pending',parent.id,receipt_id);
 SELECT count(*),COALESCE(sum(jsonb_array_length(topic->'input_digests')),0) INTO topic_count,reference_count FROM jsonb_array_elements(prototype_plan->'topics') topic;
 reference_count:=reference_count+jsonb_array_length(COALESCE(prototype_plan->'context_inputs','[]'));
 INSERT INTO signal_workspace_embedding_runs(id,workspace_id,actor_user_id,input_contract,taxonomy_profile_id,topic_input_snapshot,topic_input_digest,
  profile,config_digest,quote_digest,request_keys,hard_cap_micro_usd,estimated_upper_micro_usd,counts,worker_job_id,processing_admission_id,brand_context_preparation_operation_id)
 VALUES(run_id,parent.workspace_id,target_actor,'topic_prototypes',prior.taxonomy_profile_id,prototype_plan,prior.plan_digest,
  action.configuration,prototype_plan->'embedding_profile'->>'config_digest',quote_hash,
  jsonb_build_object(request_key,jsonb_build_object('actor_user_id',target_actor,'request_digest',request_hash)),prior.execution_cap_micro_usd,
  (snapshot->>'estimated_upper_micro_usd')::bigint,jsonb_build_object('total_topics',topic_count,'completed_topics',0,'partial_topics',0,'pending_topics',topic_count,
   'total_input_references',reference_count,'processed_input_references',0,'total_unique_inputs',(snapshot->>'total_unique_inputs')::bigint,
   'processed_unique_inputs',0,'cache_hits',0,'embedded_unique_inputs',0),'workspace-embeddings-'||run_id::text||'-1',admission_id,NULL);
 RETURN jsonb_build_object('replayed',false,'run_id',run_id,'receipt',to_jsonb(prior));
END; $$;

ALTER TABLE signal_brand_context_prototype_receipts ENABLE ROW LEVEL SECURITY;
-- A paid, validated direct client output can finish publication after spending
-- authority is revoked. It cannot publish a descendant or a manually altered
-- graph; both existing publication triggers still verify their complete seals.
CREATE FUNCTION signal_brand_context_composed_publication_actor_v1(target_generation uuid,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_brand_context_processing_receipts receipt
  JOIN signal_semantic_context_proposal_runs run ON run.id=receipt.semantic_run_id
  JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id
  WHERE receipt.generation_id=target_generation AND receipt.actor_user_id=target_actor
   AND signal_brand_context_composed_generation_valid_v1(target_generation)
   AND reservation.workspace_id=receipt.workspace_id
   AND reservation.status='settled' AND reservation.actual_micro_usd=run.settled_micro_usd
   AND run.provider_call_count=1 AND run.provider_response_private IS NOT NULL
   AND run.provider_response_digest=signal_semantic_context_digest_json_v2(to_jsonb(run.provider_response_private))
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element WHERE element.generation_id=target_generation
    AND (element.operation_id IS DISTINCT FROM run.appended_operation_id
     OR (NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id)
      AND element.automatic_policy_contract_version IS DISTINCT FROM 'signal-semantic-context-automatic-disposition-v1'))))
$$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_kind text;artifact_authority text;profile_brand uuid;workspace_brand uuid;
DECLARE operation signal_governance_control_operations%ROWTYPE;
DECLARE predecessor signal_semantic_context_generations%ROWTYPE;
DECLARE predecessor_run signal_semantic_context_proposal_runs%ROWTYPE;completed_drift boolean:=false;
BEGIN
  SELECT workspace_artifact_kind,workspace_authority_digest
    INTO artifact_kind,artifact_authority
  FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  IF artifact_kind IS DISTINCT FROM 'semantic_context'
     OR artifact_authority !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Semantic context generation artifact authority is incompatible.' USING ERRCODE='23514';
  END IF;
  SELECT brand_id INTO profile_brand FROM brand_os_profiles WHERE id=NEW.brand_os_profile_id;
  SELECT brand_id INTO workspace_brand FROM signal_workspaces WHERE id=NEW.workspace_id;
  IF profile_brand IS NULL OR workspace_brand IS NULL OR profile_brand<>workspace_brand THEN
    RAISE EXCEPTION 'Semantic context generation is cross-workspace.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||NEW.workspace_id::text,0));
    SELECT * INTO operation FROM signal_governance_control_operations
      WHERE id=NEW.created_operation_id;
    IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
       OR operation.actor_user_id<>NEW.created_by_user_id
       OR operation.action NOT IN ('create-semantic-context-draft','reconcile-semantic-context-generation')
       OR operation.status<>'in_progress'
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id) THEN
      RAISE EXCEPTION 'Semantic context generation operation authority is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.supersedes_generation_id IS NULL THEN
      IF operation.action<>'create-semantic-context-draft' OR NEW.supersession_reason IS NOT NULL
         OR EXISTS(SELECT 1 FROM signal_semantic_context_generations
           WHERE workspace_id=NEW.workspace_id) THEN
        RAISE EXCEPTION 'Initial semantic context generation is incompatible.' USING ERRCODE='23514';
      END IF;
    ELSE
      SELECT * INTO predecessor FROM signal_semantic_context_generations
        WHERE id=NEW.supersedes_generation_id AND workspace_id=NEW.workspace_id;
      IF operation.action<>'reconcile-semantic-context-generation'
         OR NEW.supersession_reason IS NULL
         OR predecessor.id IS NULL
         OR predecessor.generation_version<>NEW.generation_version-1
         OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
           WHERE successor.supersedes_generation_id=predecessor.id) THEN
        RAISE EXCEPTION 'Semantic context generation supersession is incompatible.' USING ERRCODE='23514';
      END IF;

      SELECT * INTO predecessor_run FROM signal_semantic_context_proposal_runs
        WHERE workspace_id=NEW.workspace_id AND generation_id=predecessor.id;
      completed_drift:=predecessor.status='draft' AND predecessor_run.id IS NOT NULL
        AND predecessor_run.created_by_user_id=NEW.created_by_user_id
        AND signal_brand_context_completed_history_v1(predecessor_run.id)
        AND NEW.supersession_reason IN('brand_os_drift','knowledge_drift','locale_market_drift')
        AND artifact_authority IS DISTINCT FROM (SELECT workspace_authority_digest FROM analysis_artifacts WHERE id=predecessor.artifact_id)
        AND CASE NEW.supersession_reason
          WHEN 'brand_os_drift' THEN ROW(NEW.brand_os_profile_id,NEW.brand_os_digest) IS DISTINCT FROM ROW(predecessor.brand_os_profile_id,predecessor.brand_os_digest)
          WHEN 'knowledge_drift' THEN NEW.knowledge_digest IS DISTINCT FROM predecessor.knowledge_digest
          WHEN 'locale_market_drift' THEN NEW.locale_context_digest IS DISTINCT FROM predecessor.locale_context_digest ELSE false END
        AND EXISTS(SELECT 1 FROM analysis_artifacts artifact WHERE artifact.id=NEW.artifact_id
          AND artifact.metadata->>'completed_stale_predecessor_run_id'=predecessor_run.id::text
          AND artifact.metadata->>'authority_only'='true')
        AND NEW.status='draft' AND NEW.pack_digest IS NULL;
      IF predecessor.status='draft' AND predecessor_run.id IS NOT NULL
         AND NEW.supersession_reason<>'terminal_provider_run' AND NOT COALESCE(completed_drift,false) THEN
        RAISE EXCEPTION 'Consumed semantic context drafts require terminal-run supersession.' USING ERRCODE='23514';
      END IF;
      IF NEW.supersession_reason='terminal_provider_run' THEN
        IF predecessor.status<>'draft' OR predecessor_run.id IS NULL
           OR NOT (
             signal_brand_context_unspent_run_v1(predecessor_run.id)
             OR (predecessor_run.status='failed'
               AND predecessor_run.provider_call_state='settled'
               AND predecessor_run.provider_call_count=1
               AND predecessor_run.provider_response_digest IS NOT NULL)
             OR (predecessor_run.status='stale'
               AND predecessor_run.provider_call_state IN ('not_started','settled'))
             OR (predecessor_run.status='dead_letter'
               AND predecessor_run.provider_call_state='not_started'
               AND predecessor_run.provider_call_count=0)
           )
           OR EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element
             WHERE element.generation_id=predecessor.id AND NOT EXISTS(
               SELECT 1 FROM signal_semantic_context_element_versions successor
               WHERE successor.supersedes_element_id=element.id))
           OR EXISTS(SELECT 1 FROM signal_semantic_context_proposal_outbox outbox
             WHERE outbox.run_id=predecessor_run.id
               AND outbox.status IN ('pending','failed','dispatching','dispatched'))
           OR EXISTS(SELECT 1 FROM signal_semantic_context_budget_reservations reservation
             WHERE reservation.run_id=predecessor_run.id AND reservation.status='reserved') THEN
          RAISE EXCEPTION 'Terminal semantic context run is not eligible for a fresh successor.' USING ERRCODE='23514';
        END IF;
      END IF;
    END IF;
  ELSIF OLD.status='draft' AND NEW.status='published' THEN
    SELECT * INTO operation FROM signal_governance_control_operations
      WHERE id=NEW.published_operation_id;
    IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
       OR operation.actor_user_id<>NEW.published_by_user_id
       OR operation.action<>'publish-semantic-context-generation'
       OR operation.status<>'in_progress'
       OR NOT (signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.published_by_user_id)
         OR signal_brand_context_composed_publication_actor_v1(NEW.id,NEW.published_by_user_id)) THEN
      RAISE EXCEPTION 'Semantic context publication operation authority is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_publication_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;computed jsonb;
BEGIN
  IF OLD.status='draft' AND NEW.status='published' THEN
    SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.published_operation_id;
    IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
       OR operation.actor_user_id<>NEW.published_by_user_id
       OR operation.action<>'publish-semantic-context-generation' OR operation.status<>'in_progress'
       OR NOT (signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.published_by_user_id)
         OR signal_brand_context_composed_publication_actor_v1(NEW.id,NEW.published_by_user_id)) THEN
      RAISE EXCEPTION 'Semantic context publication operation authority is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.publication_schema_version IS DISTINCT FROM 'signal-semantic-context-publication-v2' THEN
      RAISE EXCEPTION 'semantic_context_publish_v1_retired' USING ERRCODE='55000';
    END IF;
    IF NEW.publication_authority_snapshot IS NULL THEN
      RAISE EXCEPTION 'Semantic context V2 publication requires the sealed live authority.' USING ERRCODE='23514';
    END IF;
    computed:=signal_semantic_context_publication_snapshot_v2(NEW.id,NEW.publication_authority_snapshot);
    IF computed->>'publishable'<>'true'
       OR NEW.candidate_pack_digest IS DISTINCT FROM computed->>'candidate_pack_digest'
       OR NEW.evidence_graph_digest IS DISTINCT FROM computed->>'evidence_graph_digest'
       OR NEW.review_graph_digest IS DISTINCT FROM computed->>'review_graph_digest'
       OR NEW.publication_authority_digest IS DISTINCT FROM computed->>'publication_authority_digest'
       OR NEW.semantic_context_pack_digest IS DISTINCT FROM computed->>'semantic_context_pack_digest'
       OR NEW.publish_preflight_digest IS DISTINCT FROM computed->>'publish_preflight_digest'
       OR NEW.publication_counts IS DISTINCT FROM computed->'counts'
       OR NEW.pack_digest IS DISTINCT FROM computed->>'semantic_context_pack_digest' THEN
      RAISE EXCEPTION 'Semantic context V2 publication seal does not match the DB-owned graph.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- Recovery of a response already received under one composed admission. This
-- proof permits only the automatic append; existing deferred cohort guards
-- still require the complete validated graph and settlement before commit.
CREATE FUNCTION signal_brand_context_composed_append_actor_v1(target_operation uuid,target_generation uuid,target_actor uuid)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT SET search_path=public,extensions,pg_temp AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;input jsonb;run_input jsonb;
BEGIN
 SELECT * INTO operation FROM signal_governance_control_operations WHERE id=target_operation;
 input:=operation.semantic_context_decision_input;run_input:=input->'run';
 IF operation.id IS NULL OR operation.status IS DISTINCT FROM 'in_progress'
  OR operation.action IS DISTINCT FROM 'append-semantic-context-proposals' OR operation.actor_user_id<>target_actor
  OR jsonb_typeof(input) IS DISTINCT FROM 'object'
  OR input-ARRAY['contract_version','generation_key','run','proposal_count','proposal_keys','parent_authority_digest','outcomes','policy_digest']<>'{}'::jsonb
  OR NOT input ?& ARRAY['contract_version','generation_key','run','proposal_count','proposal_keys','parent_authority_digest','outcomes','policy_digest']
  OR input->>'contract_version' IS DISTINCT FROM 'signal-semantic-context-automatic-run-operation-v2'
  OR operation.semantic_context_decision_input_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(input)
  OR jsonb_typeof(input->'proposal_count') IS DISTINCT FROM 'number'
  OR jsonb_typeof(input->'proposal_keys') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'outcomes') IS DISTINCT FROM 'array'
  OR jsonb_typeof(run_input) IS DISTINCT FROM 'object'
  OR run_input-ARRAY['run_id','run_key','response_digest','validated_output_digest','provider_lineage_digest','provider_request_identity',
    'brand_os_digest','knowledge_digest','locale_context_digest','prompt_digest','context_input_digest','settled_micro_usd']<>'{}'::jsonb
  OR NOT run_input ?& ARRAY['run_id','run_key','response_digest','validated_output_digest','provider_lineage_digest','provider_request_identity',
    'brand_os_digest','knowledge_digest','locale_context_digest','prompt_digest','context_input_digest','settled_micro_usd']
  OR COALESCE(run_input->>'validated_output_digest','') !~ '^sha256:[0-9a-f]{64}$'
  OR (input->>'proposal_count')::int<1 OR (input->>'proposal_count')::int>250
  OR jsonb_array_length(input->'proposal_keys')<>(input->>'proposal_count')::int
  OR jsonb_array_length(input->'outcomes')<>(input->>'proposal_count')::int THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM signal_brand_context_processing_receipts receipt
  JOIN signal_semantic_context_proposal_runs run ON receipt.semantic_run_id=run.id
  JOIN signal_processing_admissions admission ON admission.id=receipt.semantic_admission_id
  JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id
  JOIN signal_semantic_context_generations generation ON generation.id=receipt.generation_id
  WHERE receipt.generation_id=target_generation AND receipt.actor_user_id=target_actor
   AND receipt.workspace_id=operation.workspace_id AND run.workspace_id=receipt.workspace_id
   AND run.generation_id=receipt.generation_id AND run.created_by_user_id=receipt.actor_user_id
   AND run.processing_admission_id=admission.id AND run.brand_context_preparation_operation_id IS NULL
   AND admission.brand_context_processing_receipt_id=receipt.id AND admission.action='brand_context_proposal'
   AND admission.target_id=run.id AND admission.actor_user_id=receipt.actor_user_id
   AND admission.workspace_id=receipt.workspace_id AND admission.organization_id=receipt.organization_id AND admission.brand_id=receipt.brand_id
   AND run.status='validating' AND run.provider_call_state='response_persisted' AND run.provider_call_count=1
   AND run.appended_operation_id IS NULL AND run.provider_response_private IS NOT NULL
   AND run.provider_response_digest=signal_semantic_context_digest_json_v2(to_jsonb(run.provider_response_private))
   AND run.provider_response_digest=run_input->>'response_digest' AND run.id::text=run_input->>'run_id'
   AND run.run_key=run_input->>'run_key' AND run.provider_request_identity=run_input->>'provider_request_identity'
   AND run.provider_lineage_digest=run_input->>'provider_lineage_digest' AND run.prompt_digest=run_input->>'prompt_digest'
   AND run.context_input_digest=run_input->>'context_input_digest'
   AND run.brand_os_digest=run_input->>'brand_os_digest' AND run.knowledge_digest=run_input->>'knowledge_digest'
   AND run.locale_context_digest=run_input->>'locale_context_digest'
   AND generation.workspace_id=receipt.workspace_id AND generation.status='draft' AND generation.generation_key=input->>'generation_key'
   AND generation.brand_os_digest=run.brand_os_digest AND generation.knowledge_digest=run.knowledge_digest
   AND generation.locale_context_digest=run.locale_context_digest AND generation.proposal_prompt_digest=run.prompt_digest
   AND generation.proposal_provider_lineage_digest=run.provider_lineage_digest
   AND reservation.workspace_id=receipt.workspace_id AND reservation.status='reserved'
   AND reservation.reservation_micro_usd=run.reservation_micro_usd
   AND ceil(run.input_tokens*run.input_usd_per_million_tokens+run.output_tokens*run.output_usd_per_million_tokens)::bigint::text=run_input->>'settled_micro_usd'
   AND (run_input->>'settled_micro_usd')::bigint BETWEEN 0 AND reservation.reservation_micro_usd);
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_element_operation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;generation_status text;
DECLARE artifact_kind text;artifact_authority text;group_artifact uuid;
DECLARE generation_has_provider_lineage boolean;generation_profile_id uuid;
DECLARE workspace_organization_id uuid;workspace_brand_id uuid;
BEGIN
  IF NEW.carried_from_element_id IS NOT NULL THEN
    IF NOT signal_brand_context_carried_row_valid_v1(NEW) THEN
      RAISE EXCEPTION 'Carry-forward provenance or evidence is invalid.' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT generation.status,(generation.proposal_model IS NOT NULL AND generation.proposal_model_version IS NOT NULL
      AND generation.proposal_prompt_digest IS NOT NULL AND generation.proposal_pricing_version IS NOT NULL
      AND generation.proposal_provider_lineage IS NOT NULL AND generation.proposal_provider_lineage_digest IS NOT NULL),
      generation.brand_os_profile_id,workspace.organization_id,workspace.brand_id
    INTO generation_status,generation_has_provider_lineage,generation_profile_id,
      workspace_organization_id,workspace_brand_id
    FROM signal_semantic_context_generations generation JOIN signal_workspaces workspace
      ON workspace.id=generation.workspace_id
    WHERE generation.id=NEW.generation_id AND generation.workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT workspace_artifact_kind,workspace_authority_digest INTO artifact_kind,artifact_authority
    FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  SELECT artifact_id INTO group_artifact FROM analysis_evidence_groups WHERE id=NEW.evidence_group_id;
  IF generation_status IS DISTINCT FROM 'draft' OR operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.proposed_by_user_id OR operation.status<>'in_progress'
     OR NOT (signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.proposed_by_user_id)
       OR (NEW.origin_kind IN ('provider_proposal','server_projection')
        AND signal_brand_context_composed_append_actor_v1(NEW.operation_id,NEW.generation_id,NEW.proposed_by_user_id))) THEN
    RAISE EXCEPTION 'Semantic context element operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF artifact_kind IS DISTINCT FROM 'semantic_context' OR artifact_authority IS DISTINCT FROM NEW.element_digest
     OR group_artifact IS DISTINCT FROM NEW.artifact_id THEN
    RAISE EXCEPTION 'Semantic context element artifact/evidence lineage is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=NEW.evidence_group_id)
     OR EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=NEW.evidence_group_id
      AND NOT CASE link.source_type
        WHEN 'brand_os_profile' THEN EXISTS(SELECT 1 FROM brand_os_profiles source
          WHERE source.id=link.source_id AND source.id=generation_profile_id)
        WHEN 'brand_os_product' THEN EXISTS(SELECT 1 FROM brand_os_products source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation_profile_id)
        WHEN 'brand_os_competitor' THEN EXISTS(SELECT 1 FROM brand_os_competitors source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation_profile_id)
        WHEN 'brand_os_seed_term' THEN EXISTS(SELECT 1 FROM brand_os_seed_terms source
          JOIN brand_os_seed_sets seed_set ON seed_set.id=source.seed_set_id
          WHERE source.id=link.source_id AND seed_set.brand_os_profile_id=generation_profile_id)
        WHEN 'knowledge_source' THEN EXISTS(SELECT 1 FROM brand_knowledge_sources source
          WHERE source.id=link.source_id AND source.organization_id=workspace_organization_id
            AND source.brand_id=workspace_brand_id AND source.study_corpus_id IS NULL
            AND source.status IN ('processed','profiled','active'))
        WHEN 'knowledge_chunk' THEN EXISTS(SELECT 1 FROM knowledge_chunks source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace_organization_id
            AND knowledge.brand_id=workspace_brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        WHEN 'knowledge_assertion' THEN EXISTS(SELECT 1 FROM knowledge_assertions source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace_organization_id
            AND knowledge.brand_id=workspace_brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        WHEN 'semantic_context_operator_input' THEN link.relation_type='supports' AND (
          (operation.action='create-semantic-context-element-v1' AND link.source_id=operation.id)
          OR EXISTS(SELECT 1 FROM signal_governance_control_operations source_operation
            WHERE source_operation.id=link.source_id AND source_operation.workspace_id=NEW.workspace_id
              AND source_operation.action='create-semantic-context-element-v1'
              AND source_operation.status='completed'
              AND signal_data_governance_actor_is_valid(NEW.workspace_id,source_operation.actor_user_id)))
        ELSE false END) THEN
    RAISE EXCEPTION 'Semantic context source references are cross-workspace or stale.' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_element_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions predecessor
    WHERE predecessor.id=NEW.supersedes_element_id AND predecessor.workspace_id=NEW.workspace_id
      AND predecessor.generation_id=NEW.generation_id AND predecessor.element_key=NEW.element_key
      AND predecessor.element_version=NEW.element_version-1) THEN
    RAISE EXCEPTION 'Semantic context element supersession is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind IN ('server_projection','provider_proposal') AND NOT (
      operation.action='append-semantic-context-proposals'
      AND (NEW.disposition='pending' OR (NEW.origin_kind='server_projection'
        AND NEW.disposition='approved'
        AND to_jsonb(NEW)->>'automatic_policy_outcome'='ready'))
    ) THEN
    RAISE EXCEPTION 'Semantic context proposal disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_decision' AND (operation.action NOT IN (
      'decide-semantic-context-element','bulk-approve-semantic-context-elements')
      OR NEW.disposition NOT IN ('approved','rejected') OR NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context operator decision is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_merge' AND (operation.action<>'merge-semantic-context-elements'
       OR NEW.disposition<>'merged') THEN
    RAISE EXCEPTION 'Semantic context merged disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_correction' AND (operation.action NOT IN (
      'decide-semantic-context-element','correct-semantic-context-element','merge-semantic-context-elements')
      OR NEW.disposition<>'pending') THEN
    RAISE EXCEPTION 'Semantic context correction disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_created' AND (operation.action<>'create-semantic-context-element-v1'
      OR NEW.disposition<>'approved' OR NEW.lifecycle_state<>'active'
      OR NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context operator creation is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='provider_proposal' AND NOT generation_has_provider_lineage THEN
    RAISE EXCEPTION 'Provider proposal lineage is incomplete.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;expected_action text;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  expected_action:=CASE NEW.event_kind
    WHEN 'generation_created' THEN 'create-semantic-context-draft'
    WHEN 'generation_reconciled' THEN 'reconcile-semantic-context-generation'
    WHEN 'proposals_appended' THEN 'append-semantic-context-proposals'
    WHEN 'automatic_policy_ready' THEN 'append-semantic-context-proposals'
    WHEN 'element_approved' THEN 'decide-semantic-context-element'
    WHEN 'element_rejected' THEN 'decide-semantic-context-element'
    WHEN 'element_corrected' THEN CASE WHEN operation.action='correct-semantic-context-element'
      THEN 'correct-semantic-context-element' ELSE 'decide-semantic-context-element' END
    WHEN 'elements_bulk_approved' THEN 'bulk-approve-semantic-context-elements'
    WHEN 'elements_merged' THEN 'merge-semantic-context-elements'
    WHEN 'review_annotation_created' THEN 'annotate-semantic-context-element'
    WHEN 'review_annotation_updated' THEN CASE WHEN operation.action IN (
      'merge-semantic-context-elements','correct-semantic-context-element') THEN operation.action
      ELSE 'annotate-semantic-context-element' END
    WHEN 'review_annotation_resolved' THEN CASE WHEN operation.action IN ('merge-semantic-context-elements',
      'correct-semantic-context-element','resolve-semantic-context-annotation',
      'repair-semantic-context-annotation-resolution') THEN operation.action ELSE 'annotate-semantic-context-element' END
    WHEN 'locale_authority_decided' THEN 'decide-semantic-context-locale-authority'
    WHEN 'ordinary_element_save' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_undo' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_archive' THEN 'edit-semantic-context-element-v1'
    WHEN 'ordinary_element_restore' THEN 'edit-semantic-context-element-v1'
    WHEN 'operator_element_created' THEN 'create-semantic-context-element-v1'
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.action IS DISTINCT FROM expected_action
     OR NOT (signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
       OR (NEW.event_kind IN ('proposals_appended','automatic_policy_ready')
        AND signal_brand_context_composed_append_actor_v1(NEW.operation_id,NEW.generation_id,NEW.actor_user_id))
       OR (NEW.event_kind='generation_published' AND NEW.element_id IS NULL
        AND signal_brand_context_composed_publication_actor_v1(NEW.generation_id,NEW.actor_user_id)
        AND EXISTS(SELECT 1 FROM signal_semantic_context_generations published WHERE published.id=NEW.generation_id
         AND published.workspace_id=NEW.workspace_id AND published.status='published'
         AND published.published_operation_id=NEW.operation_id))) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;RETURN NEW;
END; $$;

REVOKE ALL ON signal_brand_context_prototype_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_composed_publication_actor_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_composed_append_actor_v1(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_composed_generation_valid_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_automatic_generation_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_automatic_generation_pre_0157(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_prototype_plan_valid_v1(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_prototype_retry_safe_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quote_signal_brand_context_prototypes_v1(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_signal_brand_context_prototype_receipt_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_signal_brand_context_prototype_receipt_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION authorize_signal_brand_context_prototypes_v1(uuid,uuid,text,text,jsonb,text,text) FROM PUBLIC;
DO $$ DECLARE role_name text;function_identity text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_brand_context_prototype_receipts FROM %I',role_name);
   FOREACH function_identity IN ARRAY ARRAY['signal_brand_context_composed_generation_valid_v1(uuid)',
    'signal_brand_context_automatic_generation_v1(uuid)','signal_brand_context_automatic_generation_pre_0157(uuid)',
    'signal_brand_context_prototype_plan_valid_v1(uuid,jsonb)','signal_brand_context_prototype_retry_safe_v1(uuid)','quote_signal_brand_context_prototypes_v1(uuid,uuid,jsonb)',
    'guard_signal_brand_context_prototype_receipt_v1()','complete_signal_brand_context_prototype_receipt_v1()',
    'authorize_signal_brand_context_prototypes_v1(uuid,uuid,text,text,jsonb,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',function_identity,role_name);
   END LOOP;
  END IF;
 END LOOP;
END $$;

DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION signal_brand_context_composed_publication_actor_v1(uuid,uuid) FROM %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION signal_brand_context_composed_append_actor_v1(uuid,uuid,uuid) FROM %I',role_name);
 END LOOP;
END; $$;
