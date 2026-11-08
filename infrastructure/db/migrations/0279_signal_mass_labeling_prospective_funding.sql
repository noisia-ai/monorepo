-- Prospective TOTAL ceiling, on the same immutable pilot identity and run.
-- Neither the original grant/admission nor already paid calls are rewritten.
CREATE TABLE signal_mass_labeling_funding_receipts (
 id uuid PRIMARY KEY, contract_version text NOT NULL CHECK(contract_version='mass-labeling-prospective-total-budget-v1'),
 scoped_admission_id uuid NOT NULL UNIQUE CONSTRAINT mass_funding_prior_admission_fk REFERENCES signal_mass_labeling_scoped_admissions(id) ON DELETE RESTRICT,
 extension_id uuid NOT NULL,
 organization_id uuid NOT NULL, workspace_id uuid NOT NULL, map_id uuid NOT NULL, run_id uuid NOT NULL UNIQUE,
 actor_user_id uuid NOT NULL REFERENCES users(id), base_policy_version_id uuid NOT NULL, base_policy_digest text NOT NULL,
 map_digest text NOT NULL,labeler_digest text NOT NULL,entity_context_digest text NOT NULL,
 prior_admission_receipt_digest text NOT NULL, prior_total_cap_micro_usd bigint NOT NULL CHECK(prior_total_cap_micro_usd>0),
 total_cap_micro_usd bigint NOT NULL CHECK(total_cap_micro_usd>prior_total_cap_micro_usd AND total_cap_micro_usd<=9007199254740991),
 smoke_metrics_digest text NOT NULL,smoke_metrics_canonical text NOT NULL,smoke_root_count integer NOT NULL CHECK(smoke_root_count=1000),
 smoke_call_count integer NOT NULL CHECK(smoke_call_count=1000),smoke_calls_digest text NOT NULL,
 prior_budget_date date NOT NULL,prior_budget_timezone text NOT NULL,
 budget_date date NOT NULL,budget_timezone text NOT NULL,admission_not_after timestamptz NOT NULL,
 quote jsonb NOT NULL,quote_digest text NOT NULL,receipt_digest text NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,
 CONSTRAINT mass_funding_extension_fk FOREIGN KEY(extension_id,base_policy_version_id,workspace_id,map_id,actor_user_id) REFERENCES signal_mass_labeling_policy_extensions(id,base_policy_version_id,workspace_id,map_id,actor_user_id) ON DELETE RESTRICT,
 CONSTRAINT mass_funding_base_fk FOREIGN KEY(organization_id,base_policy_version_id) REFERENCES signal_processing_policy_versions(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT mass_funding_run_fk FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id) ON DELETE RESTRICT,
 CONSTRAINT mass_funding_map_fk FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id) ON DELETE RESTRICT,
 UNIQUE(id,scoped_admission_id,workspace_id,run_id),UNIQUE(workspace_id,actor_user_id,idempotency_key)
);
CREATE TABLE signal_mass_labeling_call_authorities (
 call_id uuid PRIMARY KEY, funding_receipt_id uuid NOT NULL,scoped_admission_id uuid NOT NULL,
 workspace_id uuid NOT NULL,run_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT mass_call_funding_receipt_fk FOREIGN KEY(funding_receipt_id,scoped_admission_id,workspace_id,run_id)
  REFERENCES signal_mass_labeling_funding_receipts(id,scoped_admission_id,workspace_id,run_id) ON DELETE RESTRICT,
 CONSTRAINT mass_call_funding_call_fk FOREIGN KEY(workspace_id,call_id) REFERENCES signal_labeling_calls(workspace_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION signal_mass_labeling_funding_payload_v1(f signal_mass_labeling_funding_receipts) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object(
 'id',f.id,'contract_version',f.contract_version,'scoped_admission_id',f.scoped_admission_id,'extension_id',f.extension_id,
 'organization_id',f.organization_id,'workspace_id',f.workspace_id,'map_id',f.map_id,'run_id',f.run_id,'actor_user_id',f.actor_user_id,
 'base_policy_version_id',f.base_policy_version_id,'base_policy_digest',f.base_policy_digest,
 'map_digest',f.map_digest,'labeler_digest',f.labeler_digest,'entity_context_digest',f.entity_context_digest,
 'prior_admission_receipt_digest',f.prior_admission_receipt_digest,'prior_total_cap_micro_usd',f.prior_total_cap_micro_usd::text,
 'total_cap_micro_usd',f.total_cap_micro_usd::text,'smoke_metrics_digest',f.smoke_metrics_digest,'smoke_metrics_canonical',f.smoke_metrics_canonical,
 'smoke_root_count',f.smoke_root_count,'smoke_call_count',f.smoke_call_count,'smoke_calls_digest',f.smoke_calls_digest,
 'prior_budget_date',to_char(f.prior_budget_date,'YYYY-MM-DD'),'prior_budget_timezone',f.prior_budget_timezone,
 'budget_date',to_char(f.budget_date,'YYYY-MM-DD'),'budget_timezone',f.budget_timezone,
 'admission_not_after',to_char(f.admission_not_after AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'quote_digest',f.quote_digest,'idempotency_key',f.idempotency_key,'created_by_user_id',f.created_by_user_id,
 'created_at',to_char(f.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $$;
CREATE FUNCTION signal_mass_labeling_funding_dto_v1(f signal_mass_labeling_funding_receipts) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_mass_labeling_funding_payload_v1(f)||jsonb_build_object('quote',f.quote,'receipt_digest',f.receipt_digest) $$;
-- This closed projection is also exportable. Sort UUID text in ASCII order.
CREATE FUNCTION signal_mass_labeling_smoke_calls_digest_v1(target_run uuid) RETURNS text
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(COALESCE(jsonb_agg(jsonb_build_object(
 'id',c.id,'run_id',c.run_id,'model',c.model,'status',c.status,'reserved_micro_usd',c.reserved_micro_usd::text,
 'settled_micro_usd',c.settled_micro_usd::text,'terminal_exposure_micro_usd',c.terminal_exposure_micro_usd::text,
 'usage',c.usage,'request_digest',c.request_digest,'raw_sha256',c.raw_sha256,'results_applied',c.results_applied,
 'budget_date',to_char(c.budget_date,'YYYY-MM-DD'),'budget_timezone',c.budget_timezone) ORDER BY c.id::text COLLATE "C"),'[]'::jsonb))
 FROM signal_labeling_calls c WHERE c.run_id=target_run $$;
CREATE FUNCTION guard_mass_labeling_funding_receipt_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE a signal_mass_labeling_scoped_admissions%ROWTYPE;e signal_mass_labeling_policy_extensions%ROWTYPE;
 r signal_labeling_runs%ROWTYPE;m signal_mass_labeling_runs%ROWTYPE;mp signal_mass_labeling_maps%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;n bigint;tokens bigint;cost bigint;peak bigint;spent bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Funding receipts are append-only' USING ERRCODE='55000'; END IF;
 SELECT * INTO a FROM signal_mass_labeling_scoped_admissions WHERE id=NEW.scoped_admission_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||a.organization_id::text,0));
 SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id FOR UPDATE;
 SELECT * INTO e FROM signal_mass_labeling_policy_extensions WHERE id=a.extension_id;
 SELECT * INTO m FROM signal_mass_labeling_runs WHERE run_id=r.id;
 SELECT * INTO mp FROM signal_mass_labeling_maps WHERE id=m.map_id;
 p=signal_mass_labeling_extension_base_v1(a.extension_id);
 PERFORM signal_processing_lock_v1(a.organization_id,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date);
 PERFORM signal_processing_lock_actor_v1(a.workspace_id,a.actor_user_id);
 IF NOT COALESCE(ROW(NEW.organization_id,NEW.workspace_id,NEW.map_id,NEW.run_id,NEW.actor_user_id,NEW.extension_id,NEW.base_policy_version_id,NEW.base_policy_digest)
  =ROW(a.organization_id,a.workspace_id,a.map_id,a.target_id,a.actor_user_id,a.extension_id,a.policy_version_id,e.base_policy_digest)
  AND NEW.created_by_user_id=a.actor_user_id AND NEW.map_digest=mp.map_digest AND NEW.map_digest=e.map_digest
  AND NEW.entity_context_digest=mp.entity_context_digest AND NEW.entity_context_digest=r.entity_context_digest
  AND NEW.labeler_digest=signal_mass_labeling_scoped_identity_v1()
  AND EXISTS(SELECT 1 FROM signal_labeler_versions l WHERE l.id=r.labeler_version_id AND l.labeler_digest=NEW.labeler_digest AND signal_labeling_digest_v1(l.identity)=l.labeler_digest)
  AND NEW.prior_admission_receipt_digest=a.receipt_digest AND NEW.prior_total_cap_micro_usd=least(r.cap_micro_usd,a.execution_cap_micro_usd,e.cap_micro_usd)
  AND NEW.prior_budget_date=a.budget_date AND NEW.prior_budget_timezone=a.budget_timezone
  AND r.kind='mass_labeling' AND r.processing_admission_id IS NULL AND r.workspace_id=a.workspace_id AND r.actor_user_id=a.actor_user_id
  AND r.status='completed' AND r.lease_token IS NULL AND m.smoke_root_limit=1000 AND m.continued_at IS NULL AND mp.root_count>1000
  AND NEW.smoke_metrics_digest=m.smoke_metrics_digest AND NEW.smoke_metrics_canonical::jsonb=m.smoke_metrics AND 'sha256:'||encode(sha256(convert_to(NEW.smoke_metrics_canonical,'UTF8')),'hex')=m.smoke_metrics_digest
  AND m.smoke_metrics->>'contract_version'='mass-labeling-smoke-metrics-v1' AND (m.smoke_metrics->>'root_count')::int=1000
  AND (m.smoke_metrics->>'error_roots')::int=0 AND (m.smoke_metrics->>'technical_failure')::boolean=false,false) THEN
  RAISE EXCEPTION 'mass_labeling_funding_invalid' USING ERRCODE='23514';END IF;
 SELECT count(*),sum((c.usage->>'input_tokens')::bigint),sum(c.settled_micro_usd) INTO n,tokens,cost FROM signal_labeling_calls c WHERE c.run_id=r.id;
 IF n<>1000 OR tokens NOT BETWEEN 0 AND 9007199254740991 OR EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.id AND (
   c.status<>'settled' OR c.raw_sha256 IS NULL OR c.raw_storage_key IS NULL OR c.raw_size_bytes<=0 OR NOT c.results_applied
   OR c.provider<>'typesafe' OR c.model<>'jev-1.13.0' OR c.transport<>'sync' OR c.terminal_exposure_micro_usd<>0
   OR c.budget_date<>a.budget_date OR c.budget_timezone<>a.budget_timezone
   OR NOT COALESCE((c.usage->>'input_tokens')~'^[0-9]+$' AND (c.usage->>'output_tokens')~'^[0-9]+$'
    AND c.settled_micro_usd=ceil((c.usage->>'input_tokens')::numeric*42/1000),false)))
  OR (SELECT count(*) FROM signal_mass_labeling_items i JOIN signal_mass_labeling_results result ON result.map_id=i.map_id AND result.root_id=i.root_id
     JOIN signal_mass_labeling_call_roots link ON link.run_id=r.id AND link.root_id=i.root_id AND link.call_id=result.call_id
     WHERE i.map_id=mp.id AND i.ordinal<=1000 AND result.status='labeled')<>1000
  OR EXISTS(SELECT 1 FROM signal_mass_labeling_call_roots link JOIN signal_mass_labeling_items i ON i.map_id=mp.id AND i.root_id=link.root_id WHERE link.run_id=r.id AND i.ordinal>1000) THEN
  RAISE EXCEPTION 'mass_labeling_funding_smoke_invalid' USING ERRCODE='23514';END IF;
 SELECT max(amount) INTO peak FROM(SELECT sum(reserved_micro_usd) OVER(ORDER BY created_at,id ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) amount FROM signal_labeling_calls WHERE run_id=r.id) page;
 NEW.smoke_root_count=1000;NEW.smoke_call_count=1000;NEW.smoke_calls_digest=signal_mass_labeling_smoke_calls_digest_v1(r.id);
 NEW.budget_date=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;NEW.budget_timezone=p.budget_timezone;
 NEW.admission_not_after=least(p.valid_until,((NEW.budget_date+1)::timestamp AT TIME ZONE p.budget_timezone));NEW.created_at=clock_timestamp();
 NEW.quote=jsonb_build_object('contract_version','mass-labeling-smoke-usage-quote-v1','basis','ledger_usage_at_sealed_tariff',
 'model','jev-1.13.0','input_usd_per_mtok',0.042,'population_roots',mp.root_count,'observed_smoke_roots',1000,'observed_smoke_calls',1000,
 'observed_input_tokens',tokens,'observed_settled_micro_usd',cost::text,'projected_total_usage_micro_usd',ceil(cost::numeric*mp.root_count/1000)::bigint::text,
 'observed_max_page_reserved_micro_usd',peak::text,'page_size',200,'reserve_observation_basis','max_200_call_window_from_smoke',
 'total_cap_micro_usd',NEW.total_cap_micro_usd::text,'provider_charged_micro_usd',NULL);
 NEW.quote_digest=signal_labeling_digest_v1(NEW.quote);
 NEW.receipt_digest=signal_labeling_digest_v1(signal_mass_labeling_funding_payload_v1(NEW));
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(a.organization_id,NEW.budget_date,NEW.budget_timezone);
 IF NEW.total_cap_micro_usd<cost OR (p.daily_cap_micro_usd IS NOT NULL AND spent+(NEW.total_cap_micro_usd-cost)>p.daily_cap_micro_usd) THEN
  RAISE EXCEPTION 'mass_labeling_funding_daily_cap_exhausted' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_funding_receipt BEFORE INSERT OR UPDATE OR DELETE ON signal_mass_labeling_funding_receipts FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_funding_receipt_v1();
CREATE FUNCTION guard_mass_labeling_call_authority_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE f signal_mass_labeling_funding_receipts%ROWTYPE;c signal_labeling_calls%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Call funding bindings are append-only' USING ERRCODE='55000';END IF;
 SELECT * INTO f FROM signal_mass_labeling_funding_receipts WHERE id=NEW.funding_receipt_id;
 IF f.id IS NULL OR NEW.scoped_admission_id IS DISTINCT FROM f.scoped_admission_id OR NEW.workspace_id IS DISTINCT FROM f.workspace_id OR NEW.run_id IS DISTINCT FROM f.run_id THEN
  RAISE EXCEPTION 'mass_labeling_funding_authority_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_call_authority BEFORE INSERT OR UPDATE OR DELETE ON signal_mass_labeling_call_authorities FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_call_authority_v1();
CREATE FUNCTION guard_mass_labeling_call_authority_owner_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_labeling_calls%ROWTYPE;f signal_mass_labeling_funding_receipts%ROWTYPE;
BEGIN
 SELECT * INTO c FROM signal_labeling_calls WHERE id=NEW.call_id;
 SELECT * INTO f FROM signal_mass_labeling_funding_receipts WHERE id=NEW.funding_receipt_id;
 IF NOT COALESCE(c.run_id=f.run_id AND c.workspace_id=f.workspace_id AND c.created_at>=f.created_at
  AND jsonb_array_length(c.inputs)=1 AND EXISTS(SELECT 1 FROM signal_mass_labeling_items i WHERE i.map_id=f.map_id AND i.ordinal>1000 AND i.root_id=(c.inputs->0->>'root_id')::uuid),false) THEN
  RAISE EXCEPTION 'mass_labeling_funding_authority_invalid' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mass_labeling_call_authority_owner AFTER INSERT ON signal_mass_labeling_call_authorities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_mass_labeling_call_authority_owner_v1();

CREATE OR REPLACE FUNCTION signal_mass_labeling_scoped_policy_v1(target_run uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_labeling_runs%ROWTYPE;a signal_mass_labeling_scoped_admissions%ROWTYPE;e signal_mass_labeling_policy_extensions%ROWTYPE;
 f signal_mass_labeling_funding_receipts%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;mass signal_mass_labeling_runs%ROWTYPE;spent bigint;run_spent bigint;
BEGIN
 SELECT * INTO r FROM signal_labeling_runs WHERE id=target_run;
 SELECT * INTO a FROM signal_mass_labeling_scoped_admissions WHERE target_id=target_run;
 IF a.id IS NULL THEN
  IF r.kind='mass_labeling' THEN
   IF r.processing_admission_id IS NULL THEN RAISE EXCEPTION 'mass_labeling_scoped_admission_required' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM signal_processing_admissions native WHERE native.id=r.processing_admission_id AND native.workspace_id=r.workspace_id
     AND native.target_id=r.id AND native.actor_user_id=r.actor_user_id AND native.action='mass_labeling_jev' AND native.provider='typesafe' AND native.model='jev-1.13.0') THEN
    RAISE EXCEPTION 'mass_labeling_native_admission_invalid' USING ERRCODE='23514';END IF;
  END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO e FROM signal_mass_labeling_policy_extensions WHERE id=a.extension_id;
 SELECT * INTO mass FROM signal_mass_labeling_runs WHERE run_id=target_run;
 SELECT * INTO f FROM signal_mass_labeling_funding_receipts WHERE run_id=target_run;
 PERFORM signal_processing_lock_v1(a.organization_id,(clock_timestamp() AT TIME ZONE a.budget_timezone)::date);
 p=signal_mass_labeling_extension_base_v1(a.extension_id);
 IF NOT COALESCE(r.workspace_id=a.workspace_id AND r.actor_user_id=a.actor_user_id AND r.kind='mass_labeling' AND r.processing_admission_id IS NULL
   AND r.cap_micro_usd IS NOT NULL AND r.cap_micro_usd>0 AND r.cap_micro_usd<=a.execution_cap_micro_usd AND r.cap_micro_usd<=e.cap_micro_usd
   AND r.concept_set_digest=e.map_digest AND mass.map_id=e.map_id AND mass.workspace_id=e.workspace_id
   AND r.entity_context_digest=(SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=e.map_id)
   AND EXISTS(SELECT 1 FROM signal_labeler_versions l WHERE l.id=r.labeler_version_id AND l.kind='mass_labeling' AND l.provider='typesafe' AND l.model='jev-1.13.0'
     AND l.identity#>>'{params,request_version}'='mass-labeling-jev-v1' AND l.labeler_digest=signal_mass_labeling_scoped_identity_v1()
     AND signal_labeling_digest_v1(l.identity)=l.labeler_digest)
   AND COALESCE(f.budget_date,a.budget_date)=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date
   AND COALESCE(f.budget_timezone,a.budget_timezone)=p.budget_timezone AND clock_timestamp()<COALESCE(f.admission_not_after,a.admission_not_after),false) THEN
  RAISE EXCEPTION 'mass_labeling_scoped_admission_invalid' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('organization_id',a.organization_id,'budget_date',COALESCE(f.budget_date,a.budget_date),'budget_timezone',p.budget_timezone,
   'daily_cap_micro_usd',p.daily_cap_micro_usd::text,'max_execution_micro_usd',COALESCE(f.total_cap_micro_usd,a.execution_cap_micro_usd)::text,'funding_receipt_id',f.id,'effective_total_cap_micro_usd',COALESCE(f.total_cap_micro_usd,r.cap_micro_usd)::text,'provider','typesafe','model','jev-1.13.0','action','mass_labeling_jev');
END $$;
CREATE OR REPLACE FUNCTION signal_mass_labeling_scoped_capacity_v1(target_run uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE policy jsonb;run_spent bigint;spent bigint;run_cap bigint;
BEGIN
 policy=signal_mass_labeling_scoped_policy_v1(target_run);IF policy IS NULL THEN RETURN NULL;END IF;
 SELECT CASE WHEN policy->>'funding_receipt_id' IS NOT NULL THEN (policy->>'effective_total_cap_micro_usd')::bigint ELSE cap_micro_usd END INTO run_cap FROM signal_labeling_runs WHERE id=target_run;
 SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd ELSE reserved_micro_usd END),0)
  INTO run_spent FROM signal_labeling_calls WHERE run_id=target_run;
 IF run_spent>run_cap OR run_spent>(policy->>'max_execution_micro_usd')::bigint THEN RAISE EXCEPTION 'labeling_cap_exhausted' USING ERRCODE='23514';END IF;
 SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1((policy->>'organization_id')::uuid,(policy->>'budget_date')::date,policy->>'budget_timezone');
 IF policy->>'daily_cap_micro_usd' IS NOT NULL AND spent>(policy->>'daily_cap_micro_usd')::bigint THEN RAISE EXCEPTION 'labeling_daily_cap_exhausted' USING ERRCODE='23514';END IF;
 RETURN policy;
END $$;
CREATE OR REPLACE FUNCTION guard_mass_labeling_scoped_money_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_labeling_runs%ROWTYPE;a signal_mass_labeling_scoped_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;policy jsonb;f signal_mass_labeling_funding_receipts%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.run_id IS DISTINCT FROM OLD.run_id AND EXISTS(SELECT 1 FROM signal_labeling_runs owner
   WHERE owner.id IN(OLD.run_id,NEW.run_id) AND owner.kind='mass_labeling' AND owner.processing_admission_id IS NULL) THEN
  RAISE EXCEPTION 'mass_labeling_scoped_call_immutable' USING ERRCODE='55000';END IF;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id;
 IF r.kind<>'mass_labeling' OR r.processing_admission_id IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.run_id,NEW.workspace_id,NEW.provider,NEW.model,NEW.transport,NEW.custom_id,NEW.request_digest,NEW.request,NEW.inputs,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.run_id,OLD.workspace_id,OLD.provider,OLD.model,OLD.transport,OLD.custom_id,OLD.request_digest,OLD.request,OLD.inputs,OLD.reserved_micro_usd,OLD.budget_date,OLD.budget_timezone,OLD.created_at)
    OR OLD.raw_sha256 IS NOT NULL AND ROW(NEW.raw_sha256,NEW.raw_storage_key,NEW.raw_size_bytes) IS DISTINCT FROM ROW(OLD.raw_sha256,OLD.raw_storage_key,OLD.raw_size_bytes)
    OR OLD.status<>'reserved' AND NEW.status='reserved' OR OLD.status='reserved' AND NEW.status='submitted'
    OR NEW.status='submitting' AND OLD.status NOT IN('reserved','submitting')
    OR OLD.status='settled' AND ROW(NEW.status,NEW.settled_micro_usd,NEW.usage) IS DISTINCT FROM ROW(OLD.status,OLD.settled_micro_usd,OLD.usage) THEN
   RAISE EXCEPTION 'mass_labeling_scoped_call_immutable' USING ERRCODE='55000';END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.status='submitting' AND OLD.status='reserved' THEN
  SELECT * INTO a FROM signal_mass_labeling_scoped_admissions WHERE target_id=NEW.run_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'mass_labeling_scoped_admission_required' USING ERRCODE='23514'; END IF;
  policy=signal_mass_labeling_scoped_policy_v1(NEW.run_id);p=signal_mass_labeling_extension_base_v1(a.extension_id);
  SELECT * INTO f FROM signal_mass_labeling_funding_receipts WHERE run_id=NEW.run_id;
  IF TG_OP='INSERT' AND NEW.status<>'reserved' OR NEW.workspace_id<>a.workspace_id OR NEW.provider<>'typesafe' OR NEW.model<>'jev-1.13.0'
   OR r.status<>'running' OR r.lease_token IS NULL OR r.lease_until<=clock_timestamp()
   OR NEW.transport<>'sync' OR NEW.budget_date<>(policy->>'budget_date')::date OR NEW.budget_timezone<>(policy->>'budget_timezone') OR NEW.reserved_micro_usd<=0 THEN
   RAISE EXCEPTION 'mass_labeling_scoped_call_invalid' USING ERRCODE='23514'; END IF;
  IF f.id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM signal_mass_labeling_runs WHERE run_id=r.id AND smoke_root_limit IS NULL AND continued_at IS NOT NULL)
    OR jsonb_array_length(NEW.inputs)<>1 OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_items i WHERE i.map_id=f.map_id AND i.ordinal>1000 AND i.root_id=(NEW.inputs->0->>'root_id')::uuid) THEN
    RAISE EXCEPTION 'mass_labeling_funding_authority_invalid' USING ERRCODE='23514';END IF;
   IF TG_OP='INSERT' THEN
    NEW.created_at=clock_timestamp();
    INSERT INTO signal_mass_labeling_call_authorities(call_id,funding_receipt_id,scoped_admission_id,workspace_id,run_id)
     VALUES(NEW.id,f.id,f.scoped_admission_id,NEW.workspace_id,NEW.run_id);
   ELSIF NOT EXISTS(SELECT 1 FROM signal_mass_labeling_call_authorities WHERE call_id=NEW.id AND funding_receipt_id=f.id) THEN
    RAISE EXCEPTION 'mass_labeling_funding_authority_invalid' USING ERRCODE='23514';END IF;
  END IF;
 END IF;RETURN NEW;
END $$;

ALTER TABLE signal_mass_labeling_funding_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_mass_labeling_call_authorities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mass_labeling_funding_receipts,signal_mass_labeling_call_authorities FROM PUBLIC;
DO $$ DECLARE role_name text;function_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['PUBLIC','anon','authenticated'] LOOP
  IF role_name='PUBLIC' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   IF role_name<>'PUBLIC' THEN EXECUTE format('REVOKE ALL ON signal_mass_labeling_funding_receipts,signal_mass_labeling_call_authorities FROM %I',role_name);END IF;
   FOR function_name IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
    'signal_mass_labeling_funding_payload_v1','signal_mass_labeling_funding_dto_v1','signal_mass_labeling_smoke_calls_digest_v1',
    'guard_mass_labeling_funding_receipt_v1','guard_mass_labeling_call_authority_v1','guard_mass_labeling_call_authority_owner_v1') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',function_name,CASE WHEN role_name='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END);
   END LOOP;
  END IF;
 END LOOP;
END $$;
