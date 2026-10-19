-- Client Brand Context stage-one admission. This migration creates no policy,
-- admission, run, outbox, provider call or cost by itself.
--
-- A caller must create the semantic run, its reservation and its outbox in the
-- same READ COMMITTED transaction as authorize_signal_brand_context_processing_v1.
-- The deferred receipt constraint makes a partial commit impossible. Voyage is
-- deliberately absent: its target and deterministic plan do not exist until the
-- semantic generation has been published.

CREATE FUNCTION signal_brand_context_processing_actor_v1(target_workspace uuid,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspaces w
  JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
  JOIN organizations o ON o.id=w.organization_id
  JOIN users u ON u.id=target_actor AND u.organization_id=o.id
  JOIN user_brand_access a ON a.brand_id=b.id AND a.user_id=u.id
    AND a.revoked_at IS NULL AND a.access_level='admin'
  WHERE w.id=target_workspace AND w.status='active' AND b.status='active' AND o.status='active'
    AND u.status='active' AND u.user_type='client'
    AND u.primary_role='client_admin')
$$;

CREATE FUNCTION signal_brand_context_processing_lock_actor_v1(target_workspace uuid,target_actor uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 PERFORM u.id FROM users u JOIN signal_workspaces w ON w.id=target_workspace
  JOIN brands b ON b.id=w.brand_id JOIN organizations o ON o.id=w.organization_id
  WHERE u.id=target_actor FOR SHARE OF u,w,b,o;
 PERFORM a.id FROM user_brand_access a JOIN signal_workspaces w ON w.brand_id=a.brand_id
  WHERE w.id=target_workspace AND a.user_id=target_actor AND a.revoked_at IS NULL
  ORDER BY a.id FOR SHARE OF a;
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN
  RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
END; $$;

-- Stage two is still unavailable, but the composed quote must not promise a
-- future Voyage step for a policy the existing Worker can never execute.
CREATE FUNCTION signal_brand_context_prototype_configuration_v1(configuration jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT configuration IS NOT DISTINCT FROM jsonb_build_object(
  'contract_version','signal-workspace-embedding-profile-v1',
  'request_contract_version','signal-workspace-embedding-request-v1',
  'provider','voyage','model','voyage-4-large','dimensions',1024,
  'input_type','document','output_dtype','float','truncation',false,
  'chunk_policy_version','corpus-text-chunks-v1',
  'tokenizer_revision','bb931c2635a93efe400c24741363d8ff61d7bb32',
  'token_bound_version','voyage-nfc-byte-bpe-plus-64-v1',
  'pricing_version','voyage-4-large-usd-0.12-per-million-2026-09-08',
  'rate_micro_usd_per_million_tokens',120000,
  'config_digest','sha256:9f305e70fa4019ca22a0098053ca13ca37428abca630e87f5e974faa7b55b2ef')
$$;

-- Only Brand Context proposals may use bounded, input-dependent token ceilings.
-- Every other action retains the exact configuration equality from SQL0155.
CREATE FUNCTION signal_processing_configuration_allows_v1(target_action text,policy_configuration jsonb,actual_configuration jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE expected_keys text[]:=ARRAY['input_usd_per_million_tokens','max_input_tokens','max_output_tokens','model',
 'model_version','output_usd_per_million_tokens','pricing_version','provider'];
BEGIN
 IF target_action<>'brand_context_proposal' THEN
  RETURN policy_configuration IS NOT DISTINCT FROM actual_configuration; END IF;
 IF policy_configuration IS NULL OR actual_configuration IS NULL
  OR jsonb_typeof(policy_configuration)<>'object' OR jsonb_typeof(actual_configuration)<>'object'
  OR NOT signal_semantic_context_json_object_keys_match_v1(policy_configuration,expected_keys)
  OR NOT signal_semantic_context_json_object_keys_match_v1(actual_configuration,expected_keys)
  OR policy_configuration->>'provider' IS DISTINCT FROM 'anthropic'
  OR policy_configuration->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
  OR COALESCE(policy_configuration->>'model_version','')=''
  OR COALESCE(policy_configuration->>'pricing_version','')=''
  OR COALESCE(policy_configuration->>'input_usd_per_million_tokens','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'
  OR COALESCE(policy_configuration->>'output_usd_per_million_tokens','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'
  OR COALESCE(actual_configuration->>'input_usd_per_million_tokens','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'
  OR COALESCE(actual_configuration->>'output_usd_per_million_tokens','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'
  OR actual_configuration->>'provider' IS DISTINCT FROM policy_configuration->>'provider'
  OR actual_configuration->>'model' IS DISTINCT FROM policy_configuration->>'model'
  OR actual_configuration->>'model_version' IS DISTINCT FROM policy_configuration->>'model_version'
  OR actual_configuration->>'pricing_version' IS DISTINCT FROM policy_configuration->>'pricing_version'
  -- PostgreSQL serializes NUMERIC run columns as JSON numbers while the server
  -- policy uses decimal strings. Compare the validated decimal value, not the
  -- incidental JSON representation.
  OR (actual_configuration->>'input_usd_per_million_tokens')::numeric
    IS DISTINCT FROM (policy_configuration->>'input_usd_per_million_tokens')::numeric
  OR (actual_configuration->>'output_usd_per_million_tokens')::numeric
    IS DISTINCT FROM (policy_configuration->>'output_usd_per_million_tokens')::numeric
  OR COALESCE(policy_configuration->>'max_input_tokens','') !~ '^[1-9][0-9]*$'
  OR COALESCE(policy_configuration->>'max_output_tokens','') !~ '^[1-9][0-9]*$'
  OR COALESCE(actual_configuration->>'max_input_tokens','') !~ '^[1-9][0-9]*$'
  OR COALESCE(actual_configuration->>'max_output_tokens','') !~ '^[1-9][0-9]*$'
  OR (actual_configuration->>'max_input_tokens')::bigint>(policy_configuration->>'max_input_tokens')::bigint
  OR (actual_configuration->>'max_output_tokens')::bigint>(policy_configuration->>'max_output_tokens')::bigint THEN
  RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN data_exception OR numeric_value_out_of_range THEN RETURN false;
END; $$;

CREATE TABLE signal_brand_context_processing_receipts (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL CONSTRAINT fk_brand_context_receipt_org REFERENCES organizations(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL CONSTRAINT fk_brand_context_receipt_workspace REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 brand_id uuid NOT NULL CONSTRAINT fk_brand_context_receipt_brand REFERENCES brands(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL CONSTRAINT fk_brand_context_receipt_actor REFERENCES users(id) ON DELETE RESTRICT,
 generation_id uuid NOT NULL CONSTRAINT fk_brand_context_receipt_generation REFERENCES signal_semantic_context_generations(id) ON DELETE RESTRICT,
 policy_version_id uuid NOT NULL,
 semantic_admission_id uuid NOT NULL,
 semantic_run_id uuid NOT NULL,
 idempotency_key text NOT NULL CONSTRAINT signal_brand_context_receipt_key CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 request_digest text NOT NULL CONSTRAINT signal_brand_context_receipt_request_digest CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 quote_digest text NOT NULL CONSTRAINT signal_brand_context_receipt_quote_digest CHECK(quote_digest~'^sha256:[0-9a-f]{64}$'),
 quote_snapshot jsonb NOT NULL CONSTRAINT signal_brand_context_receipt_quote_snapshot CHECK(jsonb_typeof(quote_snapshot)='object' AND pg_column_size(quote_snapshot)<=32768),
 confirmation text NOT NULL CONSTRAINT signal_brand_context_receipt_confirmation CHECK(confirmation='prepare_brand_context_within_shown_cap'),
 source_authority_digest text NOT NULL CONSTRAINT signal_brand_context_receipt_source_digest CHECK(source_authority_digest~'^sha256:[0-9a-f]{64}$'),
 budget_date date NOT NULL,budget_timezone text NOT NULL,authorization_not_after timestamptz NOT NULL,
 semantic_cap_micro_usd bigint NOT NULL CONSTRAINT signal_brand_context_receipt_semantic_cap CHECK(semantic_cap_micro_usd>0),
 prototype_cap_micro_usd bigint NOT NULL CONSTRAINT signal_brand_context_receipt_prototype_cap CHECK(prototype_cap_micro_usd>=0),
 receipt_digest text NOT NULL CONSTRAINT signal_brand_context_receipt_digest CHECK(receipt_digest~'^sha256:[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT uq_brand_context_receipt_request UNIQUE(workspace_id,actor_user_id,idempotency_key),
 CONSTRAINT uq_brand_context_receipt_semantic_admission UNIQUE(semantic_admission_id),
 CONSTRAINT uq_brand_context_receipt_semantic_run UNIQUE(semantic_run_id),
 CONSTRAINT fk_brand_context_receipt_policy_scope FOREIGN KEY(organization_id,policy_version_id)
  REFERENCES signal_processing_policy_versions(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_brand_context_receipt_admission FOREIGN KEY(semantic_admission_id)
  REFERENCES signal_processing_admissions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT fk_brand_context_receipt_run FOREIGN KEY(semantic_run_id)
  REFERENCES signal_semantic_context_proposal_runs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE signal_processing_admissions ADD COLUMN brand_context_processing_receipt_id uuid;
ALTER TABLE signal_processing_admissions ADD CONSTRAINT fk_processing_admission_brand_context_receipt
 FOREIGN KEY(brand_context_processing_receipt_id) REFERENCES signal_brand_context_processing_receipts(id)
 ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- SQL0155's generic admission stays unavailable for composed Brand Context work.
-- Only an admission carrying the future receipt id may use the wider, explicitly
-- requested client-role fence. All other actions preserve SQL0155 verbatim.
CREATE OR REPLACE FUNCTION signal_processing_admission_guard_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;w signal_workspaces%ROWTYPE;exposure bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'processing_admission_immutable' USING ERRCODE='23514'; END IF;
 PERFORM signal_processing_lock_v1(NEW.organization_id,NEW.budget_date);
 IF NEW.action='topic_prototype_embeddings' THEN
  -- Stage two has no published-generation/plan binding yet. A parent receipt is
  -- historical evidence, never sufficient authority for a Voyage admission.
  RAISE EXCEPTION 'brand_context_prototype_admission_unavailable' USING ERRCODE='23514';
 ELSIF NEW.action='brand_context_proposal' THEN
  IF NEW.brand_context_processing_receipt_id IS NULL THEN
   RAISE EXCEPTION 'brand_context_composed_receipt_required' USING ERRCODE='23514'; END IF;
  PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 ELSE
  IF NEW.brand_context_processing_receipt_id IS NOT NULL THEN
   RAISE EXCEPTION 'brand_context_composed_receipt_invalid' USING ERRCODE='23514'; END IF;
  PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
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
 NEW.created_at:=clock_timestamp();
 NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION signal_processing_capacity_v1(target_workspace uuid,target_actor uuid,target_run uuid,admission_id uuid,
 allowed_actions text[],actual_provider text,actual_model text,actual_configuration jsonb,owner_cap bigint,
 ledger_kind text DEFAULT NULL,ledger_id uuid DEFAULT NULL,amount bigint DEFAULT 0,reserved_time timestamptz DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE org uuid;p signal_processing_policy_versions%ROWTYPE;r signal_processing_admissions%ROWTYPE;
 day date;spent bigint;run_spent bigint;client_actor boolean;
BEGIN
 SELECT organization_id INTO org FROM signal_workspaces WHERE id=target_workspace;
 IF org IS NULL THEN RAISE EXCEPTION 'processing_scope_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||org::text,0));
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=org AND status='active';
 SELECT user_type='client' INTO client_actor FROM users WHERE id=target_actor;
 IF admission_id IS NULL AND client_actor THEN
  RAISE EXCEPTION 'processing_admission_required' USING ERRCODE='23514'; END IF;
 -- Historical internal work without a live product policy keeps the SQL0155
 -- compatibility path. Every policy-backed path takes the day lock before any
 -- actor/grant row lock, matching admission and revocation lock order.
 IF admission_id IS NULL AND (p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until) THEN RETURN; END IF;
 IF p.id IS NULL OR clock_timestamp()<p.valid_from OR clock_timestamp()>=p.valid_until THEN
  RAISE EXCEPTION 'processing_policy_expired' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(org,day);
 IF admission_id IS NOT NULL THEN
  SELECT * INTO r FROM signal_processing_admissions WHERE id=admission_id;
  IF r.action IN('brand_context_proposal','topic_prototype_embeddings') THEN
   PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
  ELSE PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor); END IF;
  IF r.workspace_id IS DISTINCT FROM target_workspace OR r.organization_id IS DISTINCT FROM org
   OR r.actor_user_id IS DISTINCT FROM target_actor OR r.target_id IS DISTINCT FROM target_run
   OR NOT r.action=ANY(allowed_actions) OR r.provider IS DISTINCT FROM actual_provider OR r.model IS DISTINCT FROM actual_model
   OR NOT signal_processing_configuration_allows_v1(r.action,r.configuration,actual_configuration)
   OR owner_cap>r.execution_cap_micro_usd OR r.policy_version_id IS DISTINCT FROM p.id
   OR clock_timestamp()>=r.admission_not_after THEN
   RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF admission_id IS NOT NULL AND r.budget_date<>day
  OR reserved_time IS NOT NULL AND (reserved_time AT TIME ZONE p.budget_timezone)::date<>day THEN
  RAISE EXCEPTION 'processing_budget_date_expired' USING ERRCODE='23514'; END IF;
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(org,day,p.budget_timezone,ledger_kind,ledger_id);
 IF admission_id IS NOT NULL AND ledger_kind IS NOT NULL THEN
  IF ledger_kind='semantic' THEN
   SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_micro_usd WHEN status='released' THEN 0 ELSE reservation_micro_usd END),0)
    INTO run_spent FROM signal_semantic_context_budget_reservations WHERE run_id=target_run AND id<>ledger_id;
  ELSIF ledger_kind='voyage' THEN
   SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd WHEN status='definitely_not_sent' THEN 0
    ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0) INTO run_spent
    FROM signal_workspace_embedding_calls WHERE run_id=target_run AND id<>ledger_id;
  ELSE
   SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END),0)
    INTO run_spent FROM engine_cost_events WHERE catalog_execution_id=target_run AND id<>ledger_id;
  END IF;
  IF run_spent+amount>r.execution_cap_micro_usd THEN
   RAISE EXCEPTION 'processing_execution_cap_exhausted' USING ERRCODE='23514'; END IF;
 END IF;
 IF amount>0 AND spent+amount>p.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
END; $$;

-- Rebuild the mutable Brand OS, Knowledge and governed locale portions of the
-- source authority. Country/timezone changes without an acquisition brief are
-- also fenced; language inference itself remains sealed by the generation.
CREATE FUNCTION signal_brand_context_processing_source_current_v1(target_generation uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE generation signal_semantic_context_generations%ROWTYPE;w signal_workspaces%ROWTYPE;
 profile brand_os_profiles%ROWTYPE;brand brands%ROWTYPE;brand_snapshot jsonb;
 sources jsonb;chunks jsonb;current_knowledge text;artifact_digest text;brief jsonb;
 current_locales text[];current_markets text[];current_primary text;current_timezone text;current_locale_digest text;
BEGIN
 SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=target_generation;
 SELECT * INTO w FROM signal_workspaces WHERE id=generation.workspace_id;
 SELECT * INTO brand FROM brands WHERE id=w.brand_id AND organization_id=w.organization_id AND status='active';
 SELECT * INTO profile FROM brand_os_profiles WHERE brand_id=w.brand_id AND organization_id=w.organization_id AND status='active'
  ORDER BY version DESC LIMIT 1;
 IF generation.id IS NULL OR w.id IS NULL OR brand.id IS NULL OR profile.id IS NULL
  OR profile.id IS DISTINCT FROM generation.brand_os_profile_id
  OR profile.version IS DISTINCT FROM generation.brand_os_profile_version
  OR profile.metadata->>'snapshot_hash' IS DISTINCT FROM generation.brand_os_digest
  OR profile.metadata->'countries' IS DISTINCT FROM to_jsonb(brand.countries) THEN RETURN false; END IF;
 SELECT jsonb_build_object('name',COALESCE(brand.display_name,brand.name),'description',brand.description,
  'organization_id',brand.organization_id::text,'industry',brand.industry,'industry_sub',brand.industry_sub,
  'countries',brand.countries,'aliases',COALESCE(brand.brand_seed_handles,ARRAY[]::text[]),
  'competitors',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',seed.canonical_name,'seed_id',seed.id::text)
    ORDER BY lower(seed.canonical_name),seed.id) FROM competitors competitor JOIN brand_seeds seed
    ON seed.id=competitor.competitor_brand_seed_id WHERE competitor.brand_id=brand.id
      AND competitor.status='current' AND seed.active),'[]'::jsonb),
  'knowledge_count',(SELECT count(*)::int FROM brand_knowledge_sources source WHERE source.brand_id=brand.id
    AND source.study_corpus_id IS NULL AND source.status IN('processed','profiled','active'))) INTO brand_snapshot;
 IF signal_semantic_context_digest_json_v2(brand_snapshot) IS DISTINCT FROM generation.brand_os_digest THEN RETURN false; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',source.id::text,'kind',source.source_kind,'digest',
   CASE WHEN COALESCE(source.file_hash,'')~'^sha256:[0-9a-f]{64}$' THEN source.file_hash ELSE
    'sha256:'||encode(digest(COALESCE(source.raw_text,'')||source.extracted_payload::text,'sha256'),'hex') END)
   ORDER BY source.id),'[]'::jsonb) INTO sources FROM brand_knowledge_sources source
  WHERE source.organization_id=w.organization_id AND source.brand_id=w.brand_id AND source.study_corpus_id IS NULL
    AND source.status IN('processed','profiled','active');
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',chunk.id::text,'source_id',chunk.knowledge_source_id::text,
   'content_digest','sha256:'||encode(digest(chunk.chunk_text,'sha256'),'hex')) ORDER BY chunk.id),'[]'::jsonb)
  INTO chunks FROM knowledge_chunks chunk JOIN brand_knowledge_sources source ON source.id=chunk.knowledge_source_id
  WHERE source.organization_id=w.organization_id AND source.brand_id=w.brand_id AND source.study_corpus_id IS NULL
    AND source.status IN('processed','profiled','active');
 current_knowledge:=signal_semantic_context_digest_json_v2(jsonb_build_object('sources',sources,'chunks',chunks));
 SELECT acquisition_brief INTO brief FROM signal_acquisition_plans WHERE workspace_id=w.id AND acquisition_brief IS NOT NULL
 AND status IN('current','draft') ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END,plan_version DESC LIMIT 1;
 IF brief IS NOT NULL THEN
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO current_locales FROM (
   SELECT DISTINCT btrim(value) value FROM jsonb_array_elements_text(COALESCE(brief->'languages','[]'::jsonb)) item(value)
   WHERE btrim(value)<>'') normalized;
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO current_markets FROM (
   SELECT DISTINCT btrim(value) value FROM jsonb_array_elements_text(COALESCE(brief->'countries','[]'::jsonb)) item(value)
   WHERE btrim(value)<>'') normalized;
  current_primary:=COALESCE(brief->>'primary_locale',CASE WHEN current_locales[1] LIKE '%-%' THEN current_locales[1]
   WHEN current_markets[1] IS NOT NULL AND current_locales[1] IS NOT NULL THEN lower(left(current_locales[1],2))||'-'||current_markets[1] END);
  current_timezone:=COALESCE(brief->>'timezone',w.timezone);
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO current_locales FROM (
   SELECT DISTINCT value FROM (SELECT unnest(current_locales) value UNION ALL SELECT current_primary) item
   WHERE value IS NOT NULL AND btrim(value)<>'') normalized;
  IF current_primary IS NULL OR NOT current_primary=ANY(current_locales) OR cardinality(current_markets)=0 THEN RETURN false; END IF;
  current_locale_digest:=signal_semantic_context_digest_json_v2(jsonb_build_object('primary_locale',current_primary,
   'locale_variants',current_locales,'markets',current_markets,'timezone',current_timezone));
  IF current_locale_digest IS DISTINCT FROM generation.locale_context_digest THEN RETURN false; END IF;
 ELSE
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[]) INTO current_markets FROM (
   SELECT DISTINCT btrim(value) value FROM unnest(COALESCE(brand.countries::text[],ARRAY[]::text[])) item(value)
   WHERE btrim(value)<>'') normalized;
  IF generation.markets IS DISTINCT FROM current_markets OR generation.timezone IS DISTINCT FROM w.timezone
   OR NOT generation.primary_locale=ANY(generation.locale_variants) THEN RETURN false; END IF;
 END IF;
 SELECT workspace_authority_digest INTO artifact_digest FROM analysis_artifacts WHERE id=generation.artifact_id
  AND workspace_id=generation.workspace_id AND workspace_artifact_kind='semantic_context';
 RETURN current_knowledge=generation.knowledge_digest AND artifact_digest=signal_semantic_context_digest_json_v2(jsonb_build_object(
  'brand_os_profile_id',generation.brand_os_profile_id,'brand_os_profile_version',generation.brand_os_profile_version,
  'brand_os_digest',generation.brand_os_digest,'knowledge_generation_key',generation.knowledge_generation_key,
  'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest));
EXCEPTION WHEN data_exception OR numeric_value_out_of_range THEN RETURN false;
END; $$;

-- The five-minute window is bucketed so GET and POST can independently rebuild
-- one digest without persisting a bearer quote. Crossing the bucket, policy/day,
-- source, action, cap or exposure boundary changes the digest.
CREATE FUNCTION signal_brand_context_processing_quote_state_v1(target_workspace uuid,target_actor uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 semantic_action signal_processing_policy_actions%ROWTYPE;prototype_action signal_processing_policy_actions%ROWTYPE;
 generation signal_semantic_context_generations%ROWTYPE;source_digest text;exposure record;
 instant timestamptz:=clock_timestamp();day date;window_start timestamptz;window_end timestamptz;remaining bigint;
BEGIN
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN
  RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NULL THEN RAISE EXCEPTION 'processing_policy_missing' USING ERRCODE='23514'; END IF;
 IF instant<p.valid_from OR instant>=p.valid_until THEN RAISE EXCEPTION 'processing_policy_expired' USING ERRCODE='23514'; END IF;
 SELECT * INTO semantic_action FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='brand_context_proposal';
 SELECT * INTO prototype_action FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='topic_prototype_embeddings';
 IF semantic_action.action IS NULL OR prototype_action.action IS NULL THEN
  RAISE EXCEPTION 'processing_action_unavailable' USING ERRCODE='23514'; END IF;
 IF semantic_action.kind<>'provider' OR semantic_action.provider<>'anthropic' OR semantic_action.model<>'claude-sonnet-4-6'
  OR prototype_action.kind<>'provider' OR prototype_action.provider<>'voyage' OR prototype_action.model<>'voyage-4-large'
  OR semantic_action.max_execution_micro_usd<=0 OR prototype_action.max_execution_micro_usd<=0
  OR NOT prototype_action.automatic_allowed
  OR NOT signal_processing_configuration_allows_v1('brand_context_proposal',semantic_action.configuration,semantic_action.configuration)
  OR NOT signal_brand_context_prototype_configuration_v1(prototype_action.configuration) THEN
  RAISE EXCEPTION 'processing_action_incompatible' USING ERRCODE='23514'; END IF;
 SELECT gen.* INTO generation FROM signal_semantic_context_generations gen
  WHERE gen.workspace_id=target_workspace AND gen.status='draft'
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor WHERE successor.supersedes_generation_id=gen.id)
   AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs run WHERE run.generation_id=gen.id)
   AND EXISTS(SELECT 1 FROM signal_governance_control_operations op WHERE op.workspace_id=gen.workspace_id
    AND op.action='prepare-brand-context' AND op.status='completed'
    AND op.brand_context_preparation->>'generation_id'=gen.id::text)
  ORDER BY gen.generation_version DESC LIMIT 1;
 IF generation.id IS NULL THEN RAISE EXCEPTION 'brand_context_generation_required' USING ERRCODE='23514'; END IF;
 IF NOT signal_brand_context_processing_source_current_v1(generation.id) THEN
  RAISE EXCEPTION 'brand_context_source_stale' USING ERRCODE='23514'; END IF;
 SELECT workspace_authority_digest INTO source_digest FROM analysis_artifacts
  WHERE id=generation.artifact_id AND workspace_id=target_workspace AND workspace_artifact_kind='semantic_context';
 IF source_digest IS NULL OR source_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object(
   'brand_os_profile_id',generation.brand_os_profile_id,'brand_os_profile_version',generation.brand_os_profile_version,
   'brand_os_digest',generation.brand_os_digest,'knowledge_generation_key',generation.knowledge_generation_key,
   'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest)) THEN
  RAISE EXCEPTION 'brand_context_source_stale' USING ERRCODE='23514'; END IF;
 day:=(instant AT TIME ZONE p.budget_timezone)::date;
 SELECT * INTO exposure FROM signal_processing_org_exposure_v1(w.organization_id,day,p.budget_timezone);
 remaining:=greatest(p.daily_cap_micro_usd-exposure.total_micro_usd,0);
 IF semantic_action.max_execution_micro_usd+prototype_action.max_execution_micro_usd>remaining THEN
  RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 window_start:=to_timestamp(floor(extract(epoch FROM instant)/300)*300);
 window_end:=least(window_start+interval '5 minutes',p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 IF window_end<=instant THEN RAISE EXCEPTION 'processing_quote_expired' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('contract_version','brand-context-processing-authority-v1',
  'workspace_id',w.id,'organization_id',w.organization_id,'brand_id',w.brand_id,'actor_user_id',target_actor,
  'quote_expires_at',window_end,'policy_id',p.id,'policy_version',p.version,'policy_digest',p.policy_digest,
  'budget_date',day,'budget_timezone',p.budget_timezone,'daily_cap_micro_usd',p.daily_cap_micro_usd,
  'exposure',to_jsonb(exposure),'remaining_micro_usd',remaining,
  'source_authority_digest',source_digest,'generation_id',generation.id,'generation_key',generation.generation_key,
  'semantic_action',to_jsonb(semantic_action)-'policy_version_id',
  'prototype_action',to_jsonb(prototype_action)-'policy_version_id');
END; $$;

CREATE FUNCTION signal_brand_context_processing_quote_v1(target_workspace uuid,target_actor uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
 snapshot:=signal_brand_context_processing_quote_state_v1(target_workspace,target_actor);
 RETURN jsonb_build_object('quote_digest',signal_semantic_context_digest_json_v2(snapshot),'quote_snapshot',snapshot);
END; $$;

CREATE FUNCTION signal_brand_context_processing_receipt_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE admission signal_processing_admissions%ROWTYPE;generation signal_semantic_context_generations%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'brand_context_processing_receipt_immutable' USING ERRCODE='23514'; END IF;
 PERFORM signal_brand_context_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 SELECT * INTO admission FROM signal_processing_admissions WHERE id=NEW.semantic_admission_id;
 SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=NEW.generation_id;
 IF NEW.quote_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(NEW.quote_snapshot)
  OR NEW.quote_snapshot->>'contract_version' IS DISTINCT FROM 'brand-context-processing-authority-v1'
  OR NEW.quote_snapshot->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
  OR NEW.quote_snapshot->>'organization_id' IS DISTINCT FROM NEW.organization_id::text
  OR NEW.quote_snapshot->>'brand_id' IS DISTINCT FROM NEW.brand_id::text
  OR NEW.quote_snapshot->>'actor_user_id' IS DISTINCT FROM NEW.actor_user_id::text
  OR NEW.quote_snapshot->>'generation_id' IS DISTINCT FROM NEW.generation_id::text
  OR NEW.quote_snapshot->>'source_authority_digest' IS DISTINCT FROM NEW.source_authority_digest
  OR NEW.quote_snapshot->>'policy_id' IS DISTINCT FROM NEW.policy_version_id::text
  OR NEW.quote_snapshot->>'budget_date' IS DISTINCT FROM NEW.budget_date::text
  OR NEW.quote_snapshot->>'budget_timezone' IS DISTINCT FROM NEW.budget_timezone
  OR NEW.semantic_cap_micro_usd IS DISTINCT FROM (NEW.quote_snapshot#>>'{semantic_action,max_execution_micro_usd}')::bigint
  OR NEW.prototype_cap_micro_usd IS DISTINCT FROM (NEW.quote_snapshot#>>'{prototype_action,max_execution_micro_usd}')::bigint
  OR generation.workspace_id IS DISTINCT FROM NEW.workspace_id
  OR admission.id IS NULL OR admission.workspace_id IS DISTINCT FROM NEW.workspace_id
  OR admission.organization_id IS DISTINCT FROM NEW.organization_id OR admission.brand_id IS DISTINCT FROM NEW.brand_id
  OR admission.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR admission.policy_version_id IS DISTINCT FROM NEW.policy_version_id
  OR admission.action<>'brand_context_proposal' OR admission.target_id IS DISTINCT FROM NEW.semantic_run_id
  OR admission.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR admission.request_digest IS DISTINCT FROM NEW.request_digest
  OR admission.execution_cap_micro_usd IS DISTINCT FROM NEW.semantic_cap_micro_usd
  OR admission.budget_date IS DISTINCT FROM NEW.budget_date OR admission.budget_timezone IS DISTINCT FROM NEW.budget_timezone
  OR admission.admission_not_after IS DISTINCT FROM NEW.authorization_not_after
  OR admission.brand_context_processing_receipt_id IS DISTINCT FROM NEW.id THEN
  RAISE EXCEPTION 'brand_context_processing_receipt_invalid' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();
 NEW.receipt_digest:=signal_semantic_context_digest_json_v2(to_jsonb(NEW)-'receipt_digest');
 RETURN NEW;
EXCEPTION WHEN data_exception OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'brand_context_processing_receipt_invalid' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER brand_context_processing_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_brand_context_processing_receipts
 FOR EACH ROW EXECUTE FUNCTION signal_brand_context_processing_receipt_guard_v1();

CREATE FUNCTION signal_brand_context_processing_complete_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE run signal_semantic_context_proposal_runs%ROWTYPE;
 reservation signal_semantic_context_budget_reservations%ROWTYPE;
 outbox signal_semantic_context_proposal_outbox%ROWTYPE;actual_configuration jsonb;
BEGIN
 SELECT * INTO run FROM signal_semantic_context_proposal_runs WHERE id=NEW.semantic_run_id;
 SELECT * INTO reservation FROM signal_semantic_context_budget_reservations WHERE run_id=NEW.semantic_run_id;
 SELECT * INTO outbox FROM signal_semantic_context_proposal_outbox WHERE run_id=NEW.semantic_run_id;
 SELECT jsonb_object_agg(key,value) INTO actual_configuration FROM jsonb_each(to_jsonb(run)) WHERE key=ANY(ARRAY[
  'provider','model','model_version','pricing_version','max_input_tokens','max_output_tokens',
  'input_usd_per_million_tokens','output_usd_per_million_tokens']);
 IF run.id IS NULL OR run.workspace_id IS DISTINCT FROM NEW.workspace_id OR run.generation_id IS DISTINCT FROM NEW.generation_id
  OR run.created_by_user_id IS DISTINCT FROM NEW.actor_user_id OR run.processing_admission_id IS DISTINCT FROM NEW.semantic_admission_id
  OR run.brand_context_preparation_operation_id IS NOT NULL OR run.status<>'queued'
  OR run.provider_call_state<>'not_started' OR run.provider_call_count<>0
  OR NOT signal_processing_configuration_allows_v1('brand_context_proposal',NEW.quote_snapshot#>'{semantic_action,configuration}',actual_configuration)
  OR reservation.id IS NULL OR reservation.workspace_id IS DISTINCT FROM run.workspace_id OR reservation.status<>'reserved'
  OR reservation.reservation_micro_usd IS DISTINCT FROM run.reservation_micro_usd
  OR reservation.reserved_input_tokens<=0 OR reservation.reserved_input_tokens>run.max_input_tokens
  OR reservation.reserved_output_tokens IS DISTINCT FROM run.max_output_tokens
  OR reservation.reservation_micro_usd IS DISTINCT FROM ceil(
    reservation.reserved_input_tokens::numeric*run.input_usd_per_million_tokens
    +reservation.reserved_output_tokens::numeric*run.output_usd_per_million_tokens)::bigint
  OR reservation.reservation_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(jsonb_build_object(
    'run_id',run.id,'reservation_micro_usd',run.reservation_micro_usd::text,
    'max_input_tokens',reservation.reserved_input_tokens,'max_output_tokens',reservation.reserved_output_tokens))
  OR outbox.id IS NULL OR outbox.workspace_id IS DISTINCT FROM run.workspace_id OR outbox.status<>'pending' THEN
  RAISE EXCEPTION 'brand_context_processing_atomic_bundle_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER brand_context_processing_complete AFTER INSERT ON signal_brand_context_processing_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_brand_context_processing_complete_v1();

CREATE FUNCTION authorize_signal_brand_context_processing_v1(target_workspace uuid,target_actor uuid,request_key text,
 quote_hash text,stable_confirmation text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 prior signal_brand_context_processing_receipts%ROWTYPE;admission signal_processing_admissions%ROWTYPE;
 quoted jsonb;snapshot jsonb;request_hash text;day date;receipt_id uuid:=gen_random_uuid();run_id uuid:=gen_random_uuid();
 admission_id uuid:=gen_random_uuid();authorization_end timestamptz;source_digest text;generation_id uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'processing_capacity_requires_read_committed' USING ERRCODE='25001'; END IF;
 IF request_key !~ '^[A-Za-z0-9._:-]{8,200}$' OR quote_hash !~ '^sha256:[0-9a-f]{64}$'
  OR stable_confirmation<>'prepare_brand_context_within_shown_cap' THEN
  RAISE EXCEPTION 'brand_context_processing_request_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 IF w.id IS NULL THEN RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-semantic-context:'||target_workspace::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','brand-context-processing-request-v1',
  'workspace_id',target_workspace,'quote_digest',quote_hash,'confirmation',stable_confirmation));
 SELECT * INTO prior FROM signal_brand_context_processing_receipts WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  -- Preserve the global policy -> day -> actor lock order even for inert replay.
  PERFORM signal_processing_lock_v1(w.organization_id,prior.budget_date);
  PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
  IF prior.request_digest IS DISTINCT FROM request_hash OR prior.quote_digest IS DISTINCT FROM quote_hash
   OR prior.confirmation IS DISTINCT FROM stable_confirmation THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('replayed',true,'receipt',to_jsonb(prior));
 END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 IF p.id IS NULL THEN RAISE EXCEPTION 'processing_policy_missing' USING ERRCODE='23514'; END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(w.organization_id,day);
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 -- A same-key writer may have committed while this transaction waited for the
 -- organization/day lock. Re-read under the lock so the loser is an inert replay
 -- instead of leaking a unique-constraint error.
 SELECT * INTO prior FROM signal_brand_context_processing_receipts WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM request_hash OR prior.quote_digest IS DISTINCT FROM quote_hash
   OR prior.confirmation IS DISTINCT FROM stable_confirmation THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('replayed',true,'receipt',to_jsonb(prior));
 END IF;
 quoted:=signal_brand_context_processing_quote_v1(target_workspace,target_actor);snapshot:=quoted->'quote_snapshot';
 IF quoted->>'quote_digest' IS DISTINCT FROM quote_hash THEN
  RAISE EXCEPTION 'brand_context_quote_changed' USING ERRCODE='23514'; END IF;
 IF (snapshot->>'quote_expires_at')::timestamptz<=clock_timestamp() THEN
  RAISE EXCEPTION 'brand_context_quote_expired' USING ERRCODE='23514'; END IF;
 generation_id:=(snapshot->>'generation_id')::uuid;source_digest:=snapshot->>'source_authority_digest';
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='brand_context_proposal';
 authorization_end:=least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,policy_version_id,action,target_id,
  idempotency_key,request_digest,provider,model,configuration,configuration_digest,execution_cap_micro_usd,budget_date,
  budget_timezone,admission_not_after,automatic,receipt_digest,brand_context_processing_receipt_id)
 VALUES(admission_id,w.organization_id,w.id,w.brand_id,target_actor,p.id,'brand_context_proposal',run_id,request_key,request_hash,
  a.provider,a.model,a.configuration,a.configuration_digest,a.max_execution_micro_usd,day,p.budget_timezone,
  authorization_end,false,'pending',receipt_id) RETURNING * INTO admission;
 INSERT INTO signal_brand_context_processing_receipts(id,organization_id,workspace_id,brand_id,actor_user_id,generation_id,
  policy_version_id,semantic_admission_id,semantic_run_id,idempotency_key,request_digest,quote_digest,quote_snapshot,
  confirmation,source_authority_digest,budget_date,budget_timezone,authorization_not_after,semantic_cap_micro_usd,
  prototype_cap_micro_usd,receipt_digest)
 VALUES(receipt_id,w.organization_id,w.id,w.brand_id,target_actor,generation_id,p.id,admission.id,run_id,request_key,
  request_hash,quote_hash,snapshot,stable_confirmation,source_digest,day,p.budget_timezone,authorization_end,
  a.max_execution_micro_usd,(snapshot#>>'{prototype_action,max_execution_micro_usd}')::bigint,'pending') RETURNING * INTO prior;
 RETURN jsonb_build_object('replayed',false,'receipt',to_jsonb(prior),
  'run_contract',jsonb_build_object('semantic_run_id',run_id,'generation_id',generation_id,
   'generation_key',snapshot->>'generation_key','policy_configuration',a.configuration,
   'semantic_cap_micro_usd',a.max_execution_micro_usd));
END; $$;

REVOKE ALL ON signal_brand_context_processing_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_processing_actor_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_processing_lock_actor_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_configuration_allows_v1(text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_prototype_configuration_v1(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_processing_source_current_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_processing_quote_state_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_processing_quote_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_processing_receipt_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_processing_complete_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION authorize_signal_brand_context_processing_v1(uuid,uuid,text,text,text) FROM PUBLIC;
DO $$ DECLARE role_name text;function_identity text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_brand_context_processing_receipts FROM %I',role_name);
   FOREACH function_identity IN ARRAY ARRAY[
    'signal_brand_context_processing_actor_v1(uuid,uuid)',
    'signal_brand_context_processing_lock_actor_v1(uuid,uuid)',
    'signal_processing_configuration_allows_v1(text,jsonb,jsonb)',
    'signal_brand_context_prototype_configuration_v1(jsonb)',
    'signal_brand_context_processing_source_current_v1(uuid)',
    'signal_brand_context_processing_quote_state_v1(uuid,uuid)',
    'signal_brand_context_processing_quote_v1(uuid,uuid)',
    'signal_brand_context_processing_receipt_guard_v1()',
    'signal_brand_context_processing_complete_v1()',
    'authorize_signal_brand_context_processing_v1(uuid,uuid,text,text,text)'
   ] LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',function_identity,role_name); END LOOP;
  END IF;
 END LOOP;
END $$;

-- Stage two intentionally remains a closed contract. A later migration may add
-- admit_signal_brand_context_prototypes_v1 only after a published generation and
-- a deterministic, current prototype plan exist. This receipt is not its admission.
