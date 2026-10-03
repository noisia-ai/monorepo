-- LOCAL ONLY. One explicitly selected interest, complete source-root census,
-- independently paid Message Batches, and exact decision evidence. Installing
-- this migration creates no policy, admission, call, or provider job.

CREATE FUNCTION signal_interest_decision_configuration_v1() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT '{"contract_version":"signal-workspace-interest-decision-provider-config-v1","provider":"anthropic","transport":"message_batches","model":"claude-sonnet-4-6","max_output_tokens":128000,"thinking":"disabled","effort":"high","prompt_digest":"sha256:a3c77b96cddc5051bd97f2bb7027112a96f3c7d8643e73d974a98ee434ba0d10","pricing_version":"claude-sonnet-4-6-batch-usd-2026-09-26","input_micro_usd_per_million_tokens":1500000,"output_micro_usd_per_million_tokens":7500000}'::jsonb
$$;

ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_name;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_name CHECK(action IN(
 'brand_context_proposal','topic_prototype_embeddings','corpus_preparation','corpus_embeddings',
 'topic_fit','topic_interpretation','topic_fit_incremental','topic_interpretation_incremental',
 'topic_consolidation','topic_consolidation_numeric','interest_decision'));
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_provider;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_provider CHECK(
 (kind='free' AND action IN('corpus_preparation','topic_fit','topic_fit_incremental','topic_consolidation_numeric')
  AND provider IS NULL AND model IS NULL AND max_execution_micro_usd=0)
 OR (kind='provider' AND provider IS NOT NULL AND model IS NOT NULL AND (
  action IN('brand_context_proposal','topic_interpretation','topic_interpretation_incremental','topic_consolidation','interest_decision')
    AND provider='anthropic' AND model='claude-sonnet-4-6'
  OR action IN('topic_prototype_embeddings','corpus_embeddings') AND provider='voyage' AND model='voyage-4-large')));
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_interest_decision_action CHECK(
 action<>'interest_decision' OR
 (kind='provider' AND configuration=signal_interest_decision_configuration_v1()
  AND max_execution_micro_usd>0));

CREATE TABLE signal_interest_decision_owners_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),actor_user_id uuid NOT NULL REFERENCES users(id),
 generation_id uuid NOT NULL UNIQUE REFERENCES signal_classification_generations(id),
 source_execution_id uuid NOT NULL REFERENCES signal_topic_catalog_executions(id),
 taxonomy_term_id uuid NOT NULL REFERENCES taxonomy_terms(id),term_key text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest~'^sha256:[0-9a-f]{64}$'),
 source_input_digest text NOT NULL CHECK(source_input_digest~'^sha256:[0-9a-f]{64}$'),
 source_input_revision bigint NOT NULL,source_context_digest text NOT NULL,
 processing_admission_id uuid NOT NULL UNIQUE,
 hard_cap_micro_usd bigint NOT NULL CHECK(hard_cap_micro_usd>0),
 expected_roots integer NOT NULL CHECK(expected_roots>0),manifest_roots integer NOT NULL DEFAULT 0 CHECK(manifest_roots>=0),
 cursor_root_id uuid,manifest_complete boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','ready','completed','blocked')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,
 UNIQUE(workspace_id,id),CHECK(manifest_roots<=expected_roots),
 CHECK(manifest_complete=(manifest_roots=expected_roots)),
 FOREIGN KEY(workspace_id,processing_admission_id) REFERENCES signal_processing_admissions(workspace_id,id)
 DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE signal_interest_decision_request_keys_v1 (
 workspace_id uuid NOT NULL,actor_user_id uuid NOT NULL,idempotency_key text NOT NULL,
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 owner_id uuid NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,actor_user_id,idempotency_key),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES signal_interest_decision_owners_v1(workspace_id,id)
);
CREATE TABLE signal_interest_decision_owner_admissions_v1 (
 owner_id uuid NOT NULL REFERENCES signal_interest_decision_owners_v1(id),
 admission_id uuid NOT NULL UNIQUE REFERENCES signal_processing_admissions(id),
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 budget_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,budget_date)
);
CREATE TABLE signal_interest_decision_pages_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES signal_interest_decision_owners_v1(id),
 page_index integer NOT NULL CHECK(page_index>=0),root_count integer NOT NULL CHECK(root_count BETWEEN 1 AND 64),
 first_root_id uuid NOT NULL,last_root_id uuid NOT NULL,
 manifest jsonb NOT NULL,manifest_body text NOT NULL,page_body text NOT NULL,
 manifest_digest text NOT NULL CHECK(manifest_digest~'^sha256:[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,page_index),UNIQUE(owner_id,manifest_digest),
 CHECK(octet_length(manifest_body) BETWEEN 1 AND 268435456),
 CHECK(octet_length(page_body) BETWEEN 1 AND 33554432)
);
CREATE TABLE signal_interest_decision_requests_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES signal_interest_decision_owners_v1(id),
 page_id uuid NOT NULL REFERENCES signal_interest_decision_pages_v1(id),request_index integer NOT NULL CHECK(request_index>=0),
 custom_id text NOT NULL CHECK(custom_id~'^id1_[a-f0-9]{60}$'),
 request jsonb NOT NULL,request_body text NOT NULL,
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[a-f0-9]{64}$'),
 interest_identity_digest text NOT NULL CHECK(interest_identity_digest~'^sha256:[a-f0-9]{64}$'),
 provider_request jsonb NOT NULL,provider_body text NOT NULL,
 provider_request_digest text NOT NULL CHECK(provider_request_digest~'^sha256:[a-f0-9]{64}$'),
 reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(page_id,request_index),UNIQUE(owner_id,request_digest),UNIQUE(owner_id,custom_id),
 CHECK(octet_length(request_body) BETWEEN 1 AND 524288),
 CHECK(octet_length(provider_body) BETWEEN 1 AND 524288)
);
CREATE TABLE signal_interest_decision_request_roots_v1 (
 owner_id uuid NOT NULL REFERENCES signal_interest_decision_owners_v1(id),
 request_id uuid NOT NULL REFERENCES signal_interest_decision_requests_v1(id),
 root_id uuid NOT NULL,root_fingerprint text NOT NULL,asset_sha256 text NOT NULL,
 correction_digest text NOT NULL,root_body jsonb NOT NULL,
 PRIMARY KEY(owner_id,root_id),UNIQUE(request_id,root_id),
 CHECK(root_fingerprint~'^sha256:[a-f0-9]{64}$' AND asset_sha256~'^sha256:[a-f0-9]{64}$'
  AND correction_digest~'^sha256:[a-f0-9]{64}$')
);
CREATE TABLE signal_interest_decision_batches_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES signal_interest_decision_owners_v1(id),
 page_id uuid NOT NULL REFERENCES signal_interest_decision_pages_v1(id),
 admission_id uuid NOT NULL REFERENCES signal_processing_admissions(id),
 submission_key text NOT NULL CHECK(submission_key~'^[A-Za-z0-9._:-]{8,200}$'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','submitting','submission_unknown','in_progress','canceling','ended','applied','rejected')),
 submission_token uuid NOT NULL DEFAULT gen_random_uuid(),provider_batch_id text UNIQUE,
 provider_receipt_body text,provider_receipt_sha256 text,
 manifest_body text NOT NULL,manifest_digest text NOT NULL,
 last_error_code text,
 lease_token uuid,lease_expires_at timestamptz,next_poll_at timestamptz DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),submitted_at timestamptz,ended_at timestamptz,
 UNIQUE(owner_id,submission_key),
 CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
 CHECK((provider_receipt_body IS NULL)=(provider_receipt_sha256 IS NULL)),
 CHECK(provider_batch_id IS NULL OR provider_batch_id~'^[A-Za-z0-9_-]{1,200}$')
);
CREATE TABLE signal_interest_decision_calls_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES signal_interest_decision_owners_v1(id),
 request_id uuid NOT NULL REFERENCES signal_interest_decision_requests_v1(id),
 batch_id uuid NOT NULL REFERENCES signal_interest_decision_batches_v1(id),
 retry_of_call_id uuid UNIQUE REFERENCES signal_interest_decision_calls_v1(id),
 attempt_index integer NOT NULL CHECK(attempt_index BETWEEN 1 AND 5),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','in_flight','outcome_unknown','response_persisted','settled','definitely_not_sent')),
 reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),
 observed_micro_usd bigint,settled_micro_usd bigint,
 budget_date date NOT NULL,budget_timezone text NOT NULL,
 attempt_token uuid NOT NULL DEFAULT gen_random_uuid(),
 raw_body text,raw_sha256 text,storage_key text,output_text text,output_digest text,
 outcome text,error_code text,validation_status text
  CHECK(validation_status IN('accepted','invalid_output','refusal','max_tokens','invalid_message')),
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,response_at timestamptz,settled_at timestamptz,
 UNIQUE(request_id,attempt_index),UNIQUE(batch_id,request_id),
 CHECK((raw_body IS NULL)=(raw_sha256 IS NULL)),
 CHECK(raw_body IS NULL OR octet_length(raw_body)<=8388608),
 CHECK(status<>'settled' OR settled_micro_usd IS NOT NULL AND settled_at IS NOT NULL),
 CHECK(status NOT IN('response_persisted','settled') OR raw_body IS NOT NULL)
);
CREATE INDEX idx_signal_interest_decision_exposure_v1 ON signal_interest_decision_calls_v1(organization_id,budget_date)
 WHERE status<>'definitely_not_sent';
CREATE UNIQUE INDEX uq_signal_interest_decision_live_call_v1 ON signal_interest_decision_calls_v1(request_id)
 WHERE status NOT IN('settled','definitely_not_sent');
CREATE TABLE signal_interest_decision_root_evidence_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES signal_interest_decision_owners_v1(id),
 request_id uuid NOT NULL REFERENCES signal_interest_decision_requests_v1(id),
 call_id uuid NOT NULL REFERENCES signal_interest_decision_calls_v1(id),
 root_id uuid NOT NULL,term_key text NOT NULL,taxonomy_term_id uuid NOT NULL,
 root_fingerprint text NOT NULL,asset_sha256 text NOT NULL,
 verdict text NOT NULL CHECK(verdict IN('belongs','not_belongs','insufficient')),
 rationale text NOT NULL,citations jsonb NOT NULL CHECK(jsonb_typeof(citations)='array'),
 output_digest text NOT NULL CHECK(output_digest~'^sha256:[a-f0-9]{64}$'),
 decision_digest text NOT NULL CHECK(decision_digest~'^sha256:[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,root_id),UNIQUE(call_id,root_id),UNIQUE(id,output_digest),
 FOREIGN KEY(owner_id,root_id) REFERENCES signal_interest_decision_request_roots_v1(owner_id,root_id)
);

-- Preserve all prior ledger calculations exactly. Interest calls are a fifth
-- contribution, with unknown POSTs held against the same daily cap.
ALTER FUNCTION signal_processing_org_exposure_v1(uuid,date,text,text,uuid)
 RENAME TO signal_processing_org_exposure_pre0211_v1;
CREATE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,
 excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH old AS(SELECT * FROM signal_processing_org_exposure_pre0211_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),
 new AS(SELECT COALESCE(sum(settled_micro_usd) FILTER(WHERE status='settled'),0)::bigint confirmed,
  COALESCE(sum(greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0))) FILTER(WHERE status NOT IN('settled','outcome_unknown')),0)::bigint reserved,
  COALESCE(sum(greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0))) FILTER(WHERE status='outcome_unknown'),0)::bigint ambiguous
  FROM signal_interest_decision_calls_v1 WHERE organization_id=target_org AND budget_date=target_day
   AND status<>'definitely_not_sent' AND NOT COALESCE(excluded_ledger='interest_decision' AND id=excluded_id,false))
 SELECT old.confirmed_micro_usd+new.confirmed,old.reserved_micro_usd+new.reserved,
  old.ambiguous_micro_usd+new.ambiguous,old.total_micro_usd+new.confirmed+new.reserved+new.ambiguous FROM old,new
$$;

CREATE FUNCTION signal_interest_decision_provider_config_v1() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT signal_interest_decision_configuration_v1()-ARRAY[
  'pricing_version','input_micro_usd_per_million_tokens','output_micro_usd_per_million_tokens']
$$;
CREATE FUNCTION signal_interest_decision_model_digest_v1() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v1())
$$;

CREATE FUNCTION signal_interest_decision_source_current_v1(target_generation uuid,target_source uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_classification_generations g
  JOIN signal_topic_catalog_executions s ON s.id=target_source AND s.workspace_id=g.workspace_id
  JOIN signal_corpus_preparation_input_state current_input ON current_input.workspace_id=g.workspace_id
  JOIN signal_corpus_preparation_runs p ON p.id=g.preparation_run_id AND p.workspace_id=g.workspace_id
  JOIN signal_workspace_embedding_runs e ON e.id=g.embedding_run_id AND e.workspace_id=g.workspace_id
  WHERE g.id=target_generation AND g.input_contract='workspace-topic-classification-v1' AND g.status='open'
   AND g.input_snapshot->>'interest_term_key' IS NOT NULL
   AND jsonb_array_length(g.input_snapshot->'topics')=1
   AND g.input_snapshot->'source_projection' IS NULL
   AND g.input_snapshot->'identity'->>'engine_artifact_digest'=signal_interest_decision_model_digest_v1()
   AND s.input_contract='workspace-topic-computation-v1' AND s.status='ready'
   AND s.processed_roots=s.denominator AND s.processed_chunks=s.expected_chunks
   AND s.input_revision=current_input.input_revision AND g.input_revision=current_input.input_revision
   AND s.preparation_run_id=g.preparation_run_id AND s.embedding_run_id=g.embedding_run_id
   AND s.taxonomy_profile_id=g.taxonomy_profile_id
   AND s.input_snapshot->>'context_digest'=g.input_snapshot->>'context_digest'
   AND (SELECT count(*) FROM jsonb_array_elements(s.input_snapshot->'topics') topic
    WHERE topic->'definition'->>'term_key'=g.input_snapshot->>'interest_term_key'
     AND topic->'definition'->>'definition_digest'=g.input_snapshot->'topics'->0->'definition'->>'definition_digest'
     AND topic->>'taxonomy_term_id'=g.input_snapshot->'topics'->0->>'taxonomy_term_id')=1
   AND p.status='completed' AND e.status='completed'
   AND (s.policy_valid_until IS NULL OR s.policy_valid_until>clock_timestamp())
   AND (g.policy_valid_until IS NULL OR g.policy_valid_until>clock_timestamp())
   AND (p.policy_valid_until IS NULL OR p.policy_valid_until>clock_timestamp())
   AND (e.policy_valid_until IS NULL OR e.policy_valid_until>clock_timestamp())),false)
$$;

CREATE FUNCTION signal_interest_decision_root_rights_v1(target_workspace uuid,target_root uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_mention_import_memberships path
  JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=target_workspace
  JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=target_workspace
   AND batch.data_source_id=path.data_source_id AND batch.status='completed'
  JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=target_workspace AND source.status='active'
  JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
   WHERE candidate.workspace_id=target_workspace AND candidate.data_source_id=batch.data_source_id
    AND candidate.status='active' AND candidate.effective_from<=now()
    AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
    AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
   ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
  JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id
   AND license.workspace_id=target_workspace AND license.status='active' AND license.effective_from<=now()
   AND (license.effective_to IS NULL OR license.effective_to>now())
  JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
   AND retention.workspace_id=target_workspace AND retention.status='active' AND retention.retention_state='allowed'
   AND retention.effective_from<=now() AND (retention.effective_to IS NULL OR retention.effective_to>now())
   AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
  WHERE path.workspace_id=target_workspace AND origin.canonical_mention_id=target_root
   AND NOT EXISTS(SELECT 1 FROM (VALUES('llm-processing'),('client-derived-metrics'),('client-mention-list'),
    ('client-text-or-excerpt')) required(purpose) WHERE NOT EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage
     WHERE usage.workspace_id=target_workspace AND usage.licensing_policy_id=license.id
      AND usage.usage_purpose=required.purpose AND usage.decision='allowed')))
$$;

CREATE FUNCTION signal_interest_decision_correction_digest_v1(target_workspace uuid,target_root uuid,
 target_fingerprint text,target_context text,target_source uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
  jsonb_build_array(correction.term_key,correction.correction_operation_id,
   correction.disposition,correction.definition_revision,correction.definition_digest)::text,
  '' ORDER BY correction.term_key),''),'UTF8')),'hex')
 FROM signal_topic_membership_overrides correction
 WHERE correction.workspace_id=target_workspace AND correction.canonical_root_id=target_root
  AND correction.origin_input_contract='workspace-topic-classification-v1'
  AND correction.root_fingerprint=target_fingerprint AND correction.context_digest=target_context
  AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution,
    jsonb_array_elements(execution.input_snapshot->'topics') topic
   WHERE execution.id=target_source AND topic->'definition'->>'term_key'=correction.term_key
    AND topic->'definition'->>'definition_digest'=correction.definition_digest
    AND (topic->'definition'->>'definition_revision')::integer=correction.definition_revision)
$$;

-- A new active policy version carrying this action is provisioned once for the
-- organization, preserving its other action rows. Client execution then needs
-- no per-run quote, deadline, or second consent record.
CREATE FUNCTION request_signal_interest_decision_v1(target_workspace uuid,target_actor uuid,
 target_generation uuid,target_source uuid,request_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE w signal_workspaces%ROWTYPE;g signal_classification_generations%ROWTYPE;
 s signal_topic_catalog_executions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 a signal_processing_policy_actions%ROWTYPE;prior signal_interest_decision_request_keys_v1%ROWTYPE;
 owner_id uuid:=gen_random_uuid();admission_id uuid:=gen_random_uuid();request_hash text;
 day date;deadline timestamptz;result jsonb;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$',false) THEN
  RAISE EXCEPTION 'interest_decision_request_key_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=target_workspace;
 IF w.id IS NULL THEN RAISE EXCEPTION 'interest_decision_workspace_missing' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||w.organization_id::text,0));
 PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor);
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('workspace_id',target_workspace,
  'actor_user_id',target_actor,'generation_id',target_generation,'source_execution_id',target_source));
 SELECT * INTO prior FROM signal_interest_decision_request_keys_v1 WHERE workspace_id=target_workspace
  AND actor_user_id=target_actor AND idempotency_key=request_key FOR UPDATE;
 IF prior.owner_id IS NOT NULL THEN
  IF prior.request_digest IS DISTINCT FROM request_hash THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 SELECT * INTO g FROM signal_classification_generations WHERE id=target_generation AND workspace_id=target_workspace FOR SHARE;
 SELECT * INTO s FROM signal_topic_catalog_executions WHERE id=target_source AND workspace_id=target_workspace FOR SHARE;
 IF g.id IS NULL OR s.id IS NULL OR NOT signal_interest_decision_source_current_v1(g.id,s.id)
  OR g.denominator<>s.denominator OR g.denominator<1 OR
  EXISTS(SELECT 1 FROM signal_interest_decision_owners_v1 WHERE generation_id=g.id)
 THEN RAISE EXCEPTION 'interest_decision_source_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=w.organization_id AND status='active';
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='interest_decision';
 IF p.id IS NULL OR p.valid_from>clock_timestamp() OR p.valid_until<=clock_timestamp()
  OR a.action IS NULL OR a.configuration IS DISTINCT FROM signal_interest_decision_configuration_v1()
  OR NOT a.automatic_allowed OR a.max_execution_micro_usd<=0
 THEN RAISE EXCEPTION 'interest_decision_policy_required' USING ERRCODE='23514';END IF;
 -- Do not admit a paid owner that can never materialize: the same registered
 -- model and effective policy must already authorize this exact interest
 -- identity. The final assignment trigger rechecks them after provider I/O.
 IF NOT EXISTS(SELECT 1 FROM tagging_model_versions model
  JOIN signal_interest_decision_platform_benchmarks_v1 benchmark
   ON benchmark.id::text=model.configuration->>'platform_benchmark_id'
  JOIN signal_classification_approval_policies approval
   ON approval.model_version_id=model.id AND approval.workspace_id=g.workspace_id
    AND approval.taxonomy_profile_id=g.taxonomy_profile_id
  WHERE model.registry_contract_version='signal-tagging-model-registry-v1'
   AND model.provider='anthropic' AND model.taxonomy_profile_id=g.taxonomy_profile_id
   AND model.artifact_digest=signal_interest_decision_model_digest_v1()
   AND model.configuration->'provider_config'=signal_interest_decision_provider_config_v1()
   AND model.configuration->'workspace_classification_identity'=g.input_snapshot->'identity'
   AND model.configuration_digest=signal_semantic_context_digest_json_v2(model.configuration)
   AND model.dataset_digest=benchmark.dataset_digest AND model.gold_set_digest=benchmark.labels_digest
   AND benchmark.model_artifact_digest=model.artifact_digest
   AND benchmark.provider_config_digest=signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v1())
   AND benchmark.prompt_digest=signal_interest_decision_provider_config_v1()->>'prompt_digest'
   AND approval.authority_kind='model' AND approval.status='approved'
   AND approval.definition_hash=g.input_snapshot->'identity'->>'decision_policy_digest'
   AND approval.effective_from<=clock_timestamp()
   AND (approval.effective_to IS NULL OR approval.effective_to>clock_timestamp())
   AND (SELECT event.status FROM signal_tagging_model_version_events event
    WHERE event.workspace_id=g.workspace_id AND event.model_version_id=model.id
     AND event.effective_at<=clock_timestamp()
    ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved')
 THEN RAISE EXCEPTION 'interest_decision_model_authority_required' USING ERRCODE='23514';END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 deadline:=least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 PERFORM signal_processing_lock_v1(w.organization_id,day);
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,
  policy_version_id,action,target_id,idempotency_key,request_digest,provider,model,configuration,
  configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(admission_id,w.organization_id,w.id,w.brand_id,target_actor,p.id,'interest_decision',owner_id,
  request_key,request_hash,a.provider,a.model,a.configuration,a.configuration_digest,
  a.max_execution_micro_usd,day,p.budget_timezone,deadline,true,
  'sha256:'||repeat('0',64));
 INSERT INTO signal_interest_decision_owners_v1(id,workspace_id,organization_id,actor_user_id,
  generation_id,source_execution_id,taxonomy_term_id,term_key,definition_digest,
  source_input_digest,source_input_revision,source_context_digest,processing_admission_id,
  hard_cap_micro_usd,expected_roots)
 VALUES(owner_id,w.id,w.organization_id,target_actor,g.id,s.id,
  (g.input_snapshot->'topics'->0->>'taxonomy_term_id')::uuid,g.input_snapshot->>'interest_term_key',
  g.input_snapshot->'topics'->0->'definition'->>'definition_digest',s.input_digest,s.input_revision,
  s.input_snapshot->>'context_digest',admission_id,a.max_execution_micro_usd,g.denominator);
 INSERT INTO signal_interest_decision_owner_admissions_v1(owner_id,admission_id,policy_version_id,budget_date)
 VALUES(owner_id,admission_id,p.id,day);
 result:=jsonb_build_object('owner_id',owner_id,'generation_id',g.id,'expected_roots',g.denominator,
  'policy_version_id',p.id,'admission_id',admission_id,'replayed',false);
 INSERT INTO signal_interest_decision_request_keys_v1(workspace_id,actor_user_id,idempotency_key,
  request_digest,owner_id,result) VALUES(w.id,target_actor,request_key,request_hash,owner_id,result);
 RETURN result;
END $$;

CREATE FUNCTION signal_interest_decision_admission_complete_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_interest_decision_owners_v1 o
  JOIN signal_interest_decision_owner_admissions_v1 day ON day.owner_id=o.id AND day.admission_id=NEW.id
  WHERE o.id=NEW.target_id
   AND o.workspace_id=NEW.workspace_id AND o.organization_id=NEW.organization_id
   AND o.actor_user_id=NEW.actor_user_id AND day.budget_date=NEW.budget_date
   AND day.policy_version_id=NEW.policy_version_id
   AND (NEW.id=o.processing_admission_id AND EXISTS(SELECT 1 FROM signal_interest_decision_request_keys_v1 key
      WHERE key.owner_id=o.id AND key.idempotency_key=NEW.idempotency_key
       AND key.request_digest=NEW.request_digest)
    OR NEW.id<>o.processing_admission_id
      AND NEW.idempotency_key='interest-decision:'||o.id::text||':'||NEW.budget_date::text
      AND NEW.request_digest=signal_semantic_context_digest_json_v2(jsonb_build_object(
       'owner_id',o.id,'policy_version_id',NEW.policy_version_id,'budget_date',NEW.budget_date,
       'configuration_digest',NEW.configuration_digest)))) THEN
  RAISE EXCEPTION 'interest_decision_admission_incomplete' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER signal_interest_decision_admission_complete_v1
 AFTER INSERT ON signal_processing_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN(NEW.action='interest_decision') EXECUTE FUNCTION signal_interest_decision_admission_complete_v1();

CREATE FUNCTION renew_signal_interest_decision_admission_v1(target_owner uuid,target_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;w signal_workspaces%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;a signal_processing_policy_actions%ROWTYPE;
 prior signal_interest_decision_owner_admissions_v1%ROWTYPE;new_id uuid:=gen_random_uuid();
 day date;request_key text;request_hash text;deadline timestamptz;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 IF o.id IS NULL OR o.actor_user_id IS DISTINCT FROM target_actor OR o.status='completed' THEN
  RAISE EXCEPTION 'interest_decision_owner_invalid' USING ERRCODE='23514';END IF;
 PERFORM signal_processing_lock_actor_v1(o.workspace_id,target_actor);
 IF NOT signal_interest_decision_source_current_v1(o.generation_id,o.source_execution_id) THEN
  RAISE EXCEPTION 'interest_decision_source_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO w FROM signal_workspaces WHERE id=o.workspace_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE organization_id=o.organization_id AND status='active';
 SELECT * INTO a FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='interest_decision';
 IF p.id IS NULL OR p.valid_from>clock_timestamp() OR p.valid_until<=clock_timestamp()
  OR a.action IS NULL OR NOT a.automatic_allowed
  OR a.configuration IS DISTINCT FROM signal_interest_decision_configuration_v1()
  OR a.max_execution_micro_usd<=0 THEN
  RAISE EXCEPTION 'interest_decision_policy_required' USING ERRCODE='23514';END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(o.organization_id,day);
 SELECT * INTO prior FROM signal_interest_decision_owner_admissions_v1
  WHERE owner_id=o.id AND budget_date=day FOR UPDATE;
 IF prior.admission_id IS NOT NULL THEN
  IF prior.policy_version_id IS DISTINCT FROM p.id THEN
   RAISE EXCEPTION 'interest_decision_policy_changed_today' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('admission_id',prior.admission_id,'budget_date',day,'replayed',true);
 END IF;
 request_key:='interest-decision:'||o.id::text||':'||day::text;
 request_hash:=signal_semantic_context_digest_json_v2(jsonb_build_object('owner_id',o.id,
  'policy_version_id',p.id,'budget_date',day,'configuration_digest',a.configuration_digest));
 deadline:=least(p.valid_until,((day+1)::timestamp AT TIME ZONE p.budget_timezone));
 INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,actor_user_id,
  policy_version_id,action,target_id,idempotency_key,request_digest,provider,model,configuration,
  configuration_digest,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
 VALUES(new_id,o.organization_id,o.workspace_id,w.brand_id,target_actor,p.id,'interest_decision',o.id,
  request_key,request_hash,a.provider,a.model,a.configuration,a.configuration_digest,
  a.max_execution_micro_usd,day,p.budget_timezone,deadline,true,'sha256:'||repeat('0',64));
 INSERT INTO signal_interest_decision_owner_admissions_v1(owner_id,admission_id,policy_version_id,budget_date)
 VALUES(o.id,new_id,p.id,day);
 RETURN jsonb_build_object('admission_id',new_id,'budget_date',day,'replayed',false);
END $$;

CREATE FUNCTION signal_interest_decision_request_valid_v1(target_owner uuid,item jsonb,
 canonical_request_body text,canonical_interest_body text,provider_core_body text,exact_provider_body text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;g signal_classification_generations%ROWTYPE;
 request jsonb;provider jsonb;params jsonb;root jsonb;chunk jsonb;ref jsonb;
 prepared signal_corpus_preparation_items%ROWTYPE;asset signal_corpus_text_assets%ROWTYPE;
 mention mentions%ROWTYPE;source_item signal_topic_classification_items%ROWTYPE;
 i integer;last_end integer;root_count integer;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner;
 SELECT * INTO g FROM signal_classification_generations WHERE id=o.generation_id;
 request:=item->'request';provider:=item->'provider_request';params:=provider->'params';
 IF o.id IS NULL OR item->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-batch-request-v1'
  OR request->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-v1'
  OR request->>'workspace_id' IS DISTINCT FROM o.workspace_id::text
  OR request->>'context_digest' IS DISTINCT FROM o.source_context_digest
  OR request->>'decision_policy_digest' IS DISTINCT FROM g.input_snapshot->'identity'->>'decision_policy_digest'
  OR request->'interest' IS DISTINCT FROM jsonb_build_object(
   'taxonomy_term_id',o.taxonomy_term_id,'term_key',o.term_key,
   'definition_revision',(g.input_snapshot->'topics'->0->'definition'->>'definition_revision')::integer,
   'definition_digest',o.definition_digest,
   'definition',g.input_snapshot->'topics'->0->'definition'->>'definition',
   'inclusion',g.input_snapshot->'topics'->0->'definition'->'inclusion',
   'exclusion',g.input_snapshot->'topics'->0->'definition'->'exclusion')
  OR request-'request_digest' IS DISTINCT FROM canonical_request_body::jsonb
  OR request->>'request_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(canonical_request_body)
  OR request->'interest' IS DISTINCT FROM canonical_interest_body::jsonb
  OR provider_core_body::jsonb IS DISTINCT FROM jsonb_build_object('request_digest',request->>'request_digest',
    'configuration',signal_interest_decision_provider_config_v1(),'params',params)
  OR item->>'provider_request_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(provider_core_body)
  OR provider IS DISTINCT FROM exact_provider_body::jsonb
  OR item->>'provider_request_bytes' IS DISTINCT FROM octet_length(exact_provider_body)::text
  OR octet_length(exact_provider_body)>524288
  OR provider->>'custom_id' IS DISTINCT FROM 'id1_'||substr(item->>'provider_request_digest',8,60)
  OR params->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
  OR params->>'max_tokens' IS DISTINCT FROM '128000'
  OR params->'thinking' IS DISTINCT FROM '{"type":"disabled"}'::jsonb
  OR params->'output_config'->>'effort' IS DISTINCT FROM 'high'
  OR params->'output_config'->'format'->>'type' IS DISTINCT FROM 'json_schema'
  OR signal_semantic_context_digest_v1(params->>'system') IS DISTINCT FROM
     signal_interest_decision_provider_config_v1()->>'prompt_digest'
  OR jsonb_array_length(params->'messages')<>1
  OR params->'messages'->0->>'role' IS DISTINCT FROM 'user'
  OR (params->'messages'->0->>'content')::jsonb IS DISTINCT FROM
      jsonb_build_object('contract_version',request->>'contract_version','untrusted_data',request)
  OR jsonb_array_length(request->'roots') NOT BETWEEN 1 AND 64
  OR item->'root_ids' IS DISTINCT FROM
     (SELECT jsonb_agg(root->>'root_id' ORDER BY n) FROM jsonb_array_elements(request->'roots') WITH ORDINALITY r(root,n))
  OR (SELECT count(DISTINCT root->>'root_id') FROM jsonb_array_elements(request->'roots') root)
     <>jsonb_array_length(request->'roots')
 THEN RETURN false;END IF;
 FOR root IN SELECT value FROM jsonb_array_elements(request->'roots') LOOP
  SELECT * INTO prepared FROM signal_corpus_preparation_items
   WHERE run_id=g.preparation_run_id AND workspace_id=o.workspace_id AND root_id=(root->>'root_id')::uuid;
  SELECT * INTO asset FROM signal_corpus_text_assets WHERE workspace_id=o.workspace_id
   AND text_sha256=prepared.asset_sha256 AND chunk_policy_version=prepared.chunk_policy_version;
  SELECT * INTO mention FROM mentions WHERE id=prepared.root_id AND workspace_id=o.workspace_id;
  SELECT * INTO source_item FROM signal_topic_classification_items WHERE execution_id=o.source_execution_id
   AND workspace_id=o.workspace_id AND canonical_root_id=prepared.root_id;
  IF prepared.disposition IS DISTINCT FROM 'eligible' OR asset.text_sha256 IS NULL
   OR mention.inclusion_status IS DISTINCT FROM 'included' OR mention.canonical_mention_id IS DISTINCT FROM mention.id
   OR mention.text_clean_sha256 IS DISTINCT FROM prepared.asset_sha256
   OR source_item.resolution_state NOT IN('doubt','not_relevant')
   OR source_item.computation_evidence->>'root_fingerprint' IS DISTINCT FROM prepared.fingerprint
   OR source_item.computation_evidence->>'asset_sha256' IS DISTINCT FROM prepared.asset_sha256
   OR root->>'fingerprint' IS DISTINCT FROM prepared.fingerprint
   OR root->>'asset_sha256' IS DISTINCT FROM prepared.asset_sha256
   OR root->>'correction_digest' IS DISTINCT FROM signal_interest_decision_correction_digest_v1(
      o.workspace_id,prepared.root_id,prepared.fingerprint,o.source_context_digest,o.source_execution_id)
   OR signal_semantic_context_digest_v1(asset.full_text) IS DISTINCT FROM asset.text_sha256
   OR jsonb_array_length(root->'chunks') IS DISTINCT FROM jsonb_array_length(asset.chunks->'chunks')
   OR NOT signal_interest_decision_root_rights_v1(o.workspace_id,prepared.root_id)
  THEN RETURN false;END IF;
  last_end:=0;
  FOR i IN 0..jsonb_array_length(root->'chunks')-1 LOOP
   chunk:=root->'chunks'->i;ref:=asset.chunks->'chunks'->i;
   IF chunk->>'chunk_index' IS DISTINCT FROM i::text
    OR chunk->>'start' IS DISTINCT FROM ref->>'start'
    OR chunk->>'end' IS DISTINCT FROM ref->>'end'
    OR (chunk->>'start')::integer IS DISTINCT FROM last_end
    OR chunk->>'chunk_sha256' IS DISTINCT FROM ref->>'sha256'
    OR chunk->>'text' IS DISTINCT FROM signal_topic_utf16_fragment_v1(asset.full_text,
      (ref->>'start')::integer,(ref->>'end')::integer)
    OR signal_semantic_context_digest_v1(chunk->>'text') IS DISTINCT FROM ref->>'sha256'
   THEN RETURN false;END IF;
   last_end:=(ref->>'end')::integer;
  END LOOP;
  IF last_end IS DISTINCT FROM char_length(asset.full_text)+regexp_count(asset.full_text,U&'[\+010000-\+10FFFF]')
   OR source_item.computation_evidence->>'processed_chunks' IS DISTINCT FROM jsonb_array_length(root->'chunks')::text
  THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR check_violation OR numeric_value_out_of_range THEN
 RETURN false;
END $$;

CREATE FUNCTION append_signal_interest_decision_page_v1(target_owner uuid,manifest jsonb,
 canonical_manifest_body text,canonical_page_body text,request_bodies jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;g signal_classification_generations%ROWTYPE;
 prior signal_interest_decision_pages_v1%ROWTYPE;page_id uuid:=gen_random_uuid();
 request_item jsonb;body_item jsonb;root jsonb;request_id uuid;ids uuid[];expected uuid[];
 page_root_ids jsonb;request_roots jsonb:='[]'::jsonb;interest jsonb;position integer:=0;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'interest_decision_owner_missing' USING ERRCODE='23514';END IF;
 PERFORM signal_processing_lock_actor_v1(o.workspace_id,o.actor_user_id);
 IF NOT signal_interest_decision_source_current_v1(o.generation_id,o.source_execution_id)
  OR o.status<>'open' OR o.manifest_complete THEN
  RAISE EXCEPTION 'interest_decision_source_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO g FROM signal_classification_generations WHERE id=o.generation_id;
 page_root_ids:=manifest->'expected_root_ids';interest:=manifest->'requests'->0->'request'->'interest';
 IF manifest->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-page-manifest-v1'
  OR manifest->'configuration' IS DISTINCT FROM signal_interest_decision_provider_config_v1()
  OR manifest-'manifest_digest' IS DISTINCT FROM canonical_manifest_body::jsonb
  OR manifest->>'manifest_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(canonical_manifest_body)
  OR jsonb_typeof(page_root_ids) IS DISTINCT FROM 'array'
  OR jsonb_array_length(page_root_ids) NOT BETWEEN 1 AND 64
  OR jsonb_typeof(manifest->'requests') IS DISTINCT FROM 'array'
  OR jsonb_array_length(manifest->'requests') NOT BETWEEN 1 AND 64
  OR jsonb_array_length(manifest->'requests')<>jsonb_array_length(request_bodies)
  OR o.manifest_roots+jsonb_array_length(page_root_ids)>o.expected_roots
 THEN RAISE EXCEPTION 'interest_decision_page_invalid' USING ERRCODE='23514';END IF;
 SELECT array_agg(canonical_root_id ORDER BY canonical_root_id) INTO expected FROM (
  SELECT canonical_root_id FROM signal_topic_classification_items
  WHERE execution_id=o.source_execution_id AND workspace_id=o.workspace_id
   AND (o.cursor_root_id IS NULL OR canonical_root_id>o.cursor_root_id)
  ORDER BY canonical_root_id LIMIT jsonb_array_length(page_root_ids)) next_roots;
 SELECT array_agg(value::uuid ORDER BY ordinality) INTO ids
  FROM jsonb_array_elements_text(page_root_ids) WITH ORDINALITY;
 IF ids IS DISTINCT FROM expected OR cardinality(ids)<>jsonb_array_length(page_root_ids)
  OR (o.manifest_roots+cardinality(ids)=o.expected_roots AND EXISTS(
   SELECT 1 FROM signal_topic_classification_items item WHERE item.execution_id=o.source_execution_id
    AND item.workspace_id=o.workspace_id AND item.canonical_root_id>ids[array_length(ids,1)]))
 THEN RAISE EXCEPTION 'interest_decision_page_coverage_invalid' USING ERRCODE='23514';END IF;
 FOR request_item IN SELECT value FROM jsonb_array_elements(manifest->'requests') LOOP
  body_item:=request_bodies->position;
  IF NOT signal_interest_decision_request_valid_v1(o.id,request_item,
    body_item->>'request_body',body_item->>'interest_body',
    body_item->>'provider_core_body',body_item->>'provider_body') THEN
   RAISE EXCEPTION 'interest_decision_request_invalid' USING ERRCODE='23514';END IF;
  request_roots:=request_roots||(request_item->'request'->'roots');
  position:=position+1;
 END LOOP;
 IF (SELECT jsonb_agg(root->>'root_id' ORDER BY n) FROM jsonb_array_elements(request_roots) WITH ORDINALITY r(root,n))
    IS DISTINCT FROM page_root_ids
  OR canonical_page_body::jsonb IS DISTINCT FROM jsonb_build_object(
   'contract_version','signal-workspace-interest-decision-v1','workspace_id',o.workspace_id,
   'context_digest',o.source_context_digest,
   'decision_policy_digest',g.input_snapshot->'identity'->>'decision_policy_digest',
   'interest',interest,'roots',request_roots)
  OR manifest->>'page_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(canonical_page_body)
 THEN RAISE EXCEPTION 'interest_decision_page_digest_invalid' USING ERRCODE='23514';END IF;
 INSERT INTO signal_interest_decision_pages_v1(id,owner_id,page_index,root_count,first_root_id,last_root_id,
  manifest,manifest_body,page_body,manifest_digest)
 VALUES(page_id,o.id,(SELECT count(*) FROM signal_interest_decision_pages_v1 WHERE owner_id=o.id),
  cardinality(ids),ids[1],ids[array_length(ids,1)],manifest,canonical_manifest_body,canonical_page_body,
  manifest->>'manifest_digest');
 position:=0;
 FOR request_item IN SELECT value FROM jsonb_array_elements(manifest->'requests') LOOP
  body_item:=request_bodies->position;request_id:=gen_random_uuid();
  INSERT INTO signal_interest_decision_requests_v1(id,owner_id,page_id,request_index,custom_id,
   request,request_body,request_digest,interest_identity_digest,provider_request,provider_body,provider_request_digest,reserved_micro_usd)
  VALUES(request_id,o.id,page_id,position,request_item->'provider_request'->>'custom_id',
   request_item->'request',body_item->>'request_body',request_item->'request'->>'request_digest',
   signal_semantic_context_digest_v1(body_item->>'interest_body'),
   request_item->'provider_request',body_item->>'provider_body',request_item->>'provider_request_digest',
   (octet_length(body_item->>'provider_body')::bigint*3+128000::bigint*15+1)/2);
  FOR root IN SELECT value FROM jsonb_array_elements(request_item->'request'->'roots') LOOP
   INSERT INTO signal_interest_decision_request_roots_v1(owner_id,request_id,root_id,root_fingerprint,
    asset_sha256,correction_digest,root_body)
   VALUES(o.id,request_id,(root->>'root_id')::uuid,root->>'fingerprint',root->>'asset_sha256',
    root->>'correction_digest',root);
  END LOOP;
  position:=position+1;
 END LOOP;
 UPDATE signal_interest_decision_owners_v1 SET manifest_roots=manifest_roots+cardinality(ids),
  cursor_root_id=ids[array_length(ids,1)],manifest_complete=manifest_roots+cardinality(ids)=expected_roots,
  status=CASE WHEN manifest_roots+cardinality(ids)=expected_roots THEN 'ready' ELSE 'open' END
 WHERE id=o.id;
 RETURN jsonb_build_object('page_id',page_id,'root_count',cardinality(ids),
  'manifest_complete',o.manifest_roots+cardinality(ids)=o.expected_roots);
END $$;

CREATE FUNCTION signal_interest_decision_batch_authority_v1(target_owner uuid,target_admission uuid,
 require_send boolean DEFAULT true) RETURNS void LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 p signal_processing_policy_versions%ROWTYPE;action_row signal_processing_policy_actions%ROWTYPE;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=target_admission;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 SELECT * INTO action_row FROM signal_processing_policy_actions WHERE policy_version_id=p.id AND action='interest_decision';
 IF o.id IS NULL OR a.id IS NULL OR a.target_id IS DISTINCT FROM o.id OR a.action IS DISTINCT FROM 'interest_decision'
  OR a.organization_id IS DISTINCT FROM o.organization_id OR a.workspace_id IS DISTINCT FROM o.workspace_id
  OR a.actor_user_id IS DISTINCT FROM o.actor_user_id
  OR NOT EXISTS(SELECT 1 FROM signal_interest_decision_owner_admissions_v1 day
    WHERE day.owner_id=o.id AND day.admission_id=a.id AND day.budget_date=a.budget_date)
  OR NOT signal_interest_decision_source_current_v1(o.generation_id,o.source_execution_id)
  OR o.status NOT IN('ready','open') OR p.status IS DISTINCT FROM 'active'
  OR p.valid_from>clock_timestamp() OR p.valid_until<=clock_timestamp()
  OR action_row.action IS NULL OR NOT action_row.automatic_allowed
  OR action_row.configuration IS DISTINCT FROM signal_interest_decision_configuration_v1()
  OR a.configuration IS DISTINCT FROM action_row.configuration
  OR a.configuration_digest IS DISTINCT FROM action_row.configuration_digest
  OR a.admission_not_after<=clock_timestamp()
  OR a.budget_date<>(clock_timestamp() AT TIME ZONE a.budget_timezone)::date
 THEN RAISE EXCEPTION 'interest_decision_batch_authority_invalid' USING ERRCODE='23514';END IF;
 IF require_send THEN PERFORM signal_processing_lock_actor_v1(o.workspace_id,o.actor_user_id);END IF;
END $$;

CREATE FUNCTION prepare_signal_interest_decision_batch_v1(target_owner uuid,target_page uuid,
 request_digests text[],submission_key text) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;page signal_interest_decision_pages_v1%ROWTYPE;
 a signal_processing_admissions%ROWTYPE;p signal_processing_policy_versions%ROWTYPE;
 prior_batch signal_interest_decision_batches_v1%ROWTYPE;
 batch_id uuid:=gen_random_uuid();request_row signal_interest_decision_requests_v1%ROWTYPE;
 prior_call signal_interest_decision_calls_v1%ROWTYPE;day date;body text;body_sha text;
 request_count integer;spent bigint;org_exposure bigint;batch_amount bigint;
BEGIN
 IF NOT COALESCE(submission_key~'^[A-Za-z0-9._:-]{8,200}$',false)
  OR request_digests IS NULL OR cardinality(request_digests) NOT BETWEEN 1 AND 64
  OR cardinality(request_digests)<>(SELECT count(DISTINCT x) FROM unnest(request_digests) x)
 THEN RAISE EXCEPTION 'interest_decision_batch_request_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=o.processing_admission_id;
 SELECT * INTO p FROM signal_processing_policy_versions WHERE id=a.policy_version_id;
 IF o.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'interest_decision_owner_invalid' USING ERRCODE='23514';END IF;
 day:=(clock_timestamp() AT TIME ZONE p.budget_timezone)::date;
 PERFORM signal_processing_lock_v1(o.organization_id,day);
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 SELECT * INTO page FROM signal_interest_decision_pages_v1 WHERE id=target_page AND owner_id=o.id;
 SELECT admission.* INTO a FROM signal_processing_admissions admission JOIN signal_interest_decision_owner_admissions_v1 renewal
  ON renewal.admission_id=admission.id WHERE renewal.owner_id=o.id AND renewal.budget_date=day;
 IF page.id IS NULL OR NOT o.manifest_complete OR o.status<>'ready' OR a.id IS NULL THEN
  RAISE EXCEPTION 'interest_decision_batch_unavailable' USING ERRCODE='23514';END IF;
 PERFORM signal_interest_decision_batch_authority_v1(o.id,a.id,true);
 SELECT count(*),'{"requests":['||string_agg(provider_body,',' ORDER BY request_index)||']}' INTO request_count,body
  FROM signal_interest_decision_requests_v1 WHERE page_id=page.id AND owner_id=o.id
   AND request_digest=ANY(request_digests);
 IF request_count<>cardinality(request_digests) OR octet_length(body)>268435456 THEN
  RAISE EXCEPTION 'interest_decision_batch_coverage_invalid' USING ERRCODE='23514';END IF;
 body_sha:=signal_semantic_context_digest_v1(body);
 SELECT * INTO prior_batch FROM signal_interest_decision_batches_v1
  WHERE owner_id=o.id AND signal_interest_decision_batches_v1.submission_key=prepare_signal_interest_decision_batch_v1.submission_key;
 IF prior_batch.id IS NOT NULL THEN
  IF prior_batch.page_id IS DISTINCT FROM page.id OR prior_batch.manifest_digest IS DISTINCT FROM body_sha
   OR prior_batch.manifest_body IS DISTINCT FROM body THEN
   RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('batch_id',prior_batch.id,'manifest_digest',body_sha,'replayed',true);
 END IF;
 SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd
    WHEN status='definitely_not_sent' THEN 0
    ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
 INTO spent FROM signal_interest_decision_calls_v1 WHERE owner_id=o.id;
 SELECT COALESCE(sum(reserved_micro_usd),0) INTO batch_amount
  FROM signal_interest_decision_requests_v1 WHERE page_id=page.id AND owner_id=o.id
   AND request_digest=ANY(request_digests);
 SELECT total_micro_usd INTO org_exposure FROM signal_processing_org_exposure_v1(o.organization_id,day,a.budget_timezone);
 IF spent+batch_amount>o.hard_cap_micro_usd
  OR org_exposure+batch_amount>(SELECT daily_cap_micro_usd FROM signal_processing_policy_versions WHERE id=a.policy_version_id)
  OR batch_amount>a.execution_cap_micro_usd
 THEN RAISE EXCEPTION 'interest_decision_cap_exhausted' USING ERRCODE='23514';END IF;
 INSERT INTO signal_interest_decision_batches_v1(id,owner_id,page_id,admission_id,submission_key,manifest_body,manifest_digest)
 VALUES(batch_id,o.id,page.id,a.id,submission_key,body,body_sha);
 FOR request_row IN SELECT * FROM signal_interest_decision_requests_v1
  WHERE page_id=page.id AND owner_id=o.id AND request_digest=ANY(request_digests) ORDER BY request_index LOOP
  SELECT * INTO prior_call FROM signal_interest_decision_calls_v1 WHERE request_id=request_row.id
   ORDER BY attempt_index DESC LIMIT 1;
  IF prior_call.id IS NOT NULL AND (prior_call.status NOT IN('settled','definitely_not_sent')
   OR prior_call.status='settled' AND prior_call.outcome='succeeded'
    AND NOT COALESCE(prior_call.validation_status IN('invalid_output','refusal','max_tokens','invalid_message'),false)
   OR EXISTS(SELECT 1 FROM signal_interest_decision_root_evidence_v1 evidence WHERE evidence.call_id=prior_call.id))
   OR COALESCE(prior_call.attempt_index,0)>=5 THEN
   RAISE EXCEPTION 'interest_decision_request_not_retryable' USING ERRCODE='23514';END IF;
  INSERT INTO signal_interest_decision_calls_v1(owner_id,request_id,batch_id,retry_of_call_id,attempt_index,
   organization_id,reserved_micro_usd,budget_date,budget_timezone)
  VALUES(o.id,request_row.id,batch_id,prior_call.id,COALESCE(prior_call.attempt_index,0)+1,
   o.organization_id,request_row.reserved_micro_usd,day,a.budget_timezone);
 END LOOP;
 RETURN jsonb_build_object('batch_id',batch_id,'manifest_digest',body_sha,'request_count',request_count,
  'reserved_micro_usd',batch_amount,'replayed',false);
END $$;

CREATE FUNCTION claim_signal_interest_decision_batch_v1(target_batch uuid DEFAULT NULL,
 lease_seconds integer DEFAULT 120) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;token uuid:=gen_random_uuid();
BEGIN
 IF lease_seconds NOT BETWEEN 15 AND 300 THEN
  RAISE EXCEPTION 'interest_decision_lease_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO b FROM signal_interest_decision_batches_v1
 WHERE (target_batch IS NULL OR id=target_batch) AND state NOT IN('applied','rejected','submission_unknown')
  AND next_poll_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp())
 ORDER BY next_poll_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF b.id IS NULL THEN RETURN NULL;END IF;
 IF b.state='submitting' THEN
  UPDATE signal_interest_decision_batches_v1 SET state='submission_unknown',lease_token=NULL,
   lease_expires_at=NULL,next_poll_at=NULL WHERE id=b.id;
  UPDATE signal_interest_decision_calls_v1 SET status='outcome_unknown',
   error_code='interest_decision_submission_unknown'
   WHERE batch_id=b.id AND status='in_flight';
  RETURN NULL;
 END IF;
 UPDATE signal_interest_decision_batches_v1 SET lease_token=token,
  lease_expires_at=clock_timestamp()+make_interval(secs=>lease_seconds) WHERE id=b.id;
 RETURN jsonb_build_object('batch_id',b.id,'owner_id',b.owner_id,'lease_token',token,
  'submission_token',b.submission_token,'state',b.state,'provider_batch_id',b.provider_batch_id,
  'manifest_body',b.manifest_body,'manifest_digest',b.manifest_digest);
END $$;

CREATE FUNCTION signal_interest_decision_batch_lease_v1(target_batch uuid,target_token uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_interest_decision_batches_v1 WHERE id=target_batch
  AND lease_token=target_token AND lease_expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'interest_decision_lease_conflict' USING ERRCODE='23514';END IF;
END $$;

CREATE FUNCTION release_signal_interest_decision_batch_v1(target_batch uuid,target_token uuid,
 target_next_poll_at timestamptz,target_error_code text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state IN('submitting','applied','rejected')
  OR (target_next_poll_at IS NULL AND b.state NOT IN('submission_unknown','ended'))
  OR (target_next_poll_at IS NOT NULL AND target_next_poll_at<=clock_timestamp())
  OR (target_error_code IS NOT NULL AND target_error_code!~'^[a-z0-9_:-]{3,100}$') THEN
  RAISE EXCEPTION 'interest_decision_release_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_batches_v1 SET lease_token=NULL,lease_expires_at=NULL,
  next_poll_at=target_next_poll_at,last_error_code=target_error_code WHERE id=b.id;
 RETURN jsonb_build_object('batch_id',b.id,'state',b.state,'next_poll_at',target_next_poll_at,
  'error_code',target_error_code);
END $$;

CREATE FUNCTION mark_submitting_signal_interest_decision_batch_v1(target_batch uuid,target_token uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;a signal_processing_admissions%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state<>'prepared' OR b.provider_batch_id IS NOT NULL THEN
  RAISE EXCEPTION 'interest_decision_submission_already_attempted' USING ERRCODE='23514';END IF;
 PERFORM signal_interest_decision_batch_authority_v1(b.owner_id,b.admission_id,true);
 SELECT * INTO a FROM signal_processing_admissions WHERE id=b.admission_id;
 IF EXISTS(SELECT 1 FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id AND status<>'reserved')
  OR (SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id)=0
 THEN RAISE EXCEPTION 'interest_decision_batch_call_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_calls_v1 SET status='in_flight',sent_at=clock_timestamp()
  WHERE batch_id=b.id AND status='reserved';
 UPDATE signal_interest_decision_batches_v1 SET state='submitting',submitted_at=clock_timestamp()
  WHERE id=b.id;
 RETURN jsonb_build_object('submission_token',b.submission_token,'manifest_body',b.manifest_body,
  'manifest_digest',b.manifest_digest,'budget_date',a.budget_date);
END $$;

CREATE FUNCTION attach_provider_signal_interest_decision_batch_v1(target_batch uuid,
 target_submission_token uuid,raw_body text,raw_sha text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;receipt jsonb;total bigint;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 IF b.id IS NULL OR b.submission_token IS DISTINCT FROM target_submission_token
  OR raw_sha IS DISTINCT FROM signal_semantic_context_digest_v1(raw_body)
  OR octet_length(raw_body)>8388608 THEN
  RAISE EXCEPTION 'interest_decision_batch_receipt_invalid' USING ERRCODE='23514';END IF;
 receipt:=raw_body::jsonb;
 SELECT sum(value::bigint) INTO total FROM jsonb_each_text(receipt->'request_counts');
 IF receipt->>'id' IS NULL OR receipt->>'processing_status' NOT IN('in_progress','canceling','ended')
  OR total IS DISTINCT FROM (SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id)
 THEN RAISE EXCEPTION 'interest_decision_batch_receipt_invalid' USING ERRCODE='23514';END IF;
 IF b.provider_batch_id IS NOT NULL THEN
  IF b.provider_batch_id IS DISTINCT FROM receipt->>'id' OR b.provider_receipt_body IS DISTINCT FROM raw_body THEN
   RAISE EXCEPTION 'interest_decision_batch_receipt_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('provider_batch_id',b.provider_batch_id,'replayed',true);
 END IF;
 IF b.state NOT IN('submitting','submission_unknown') THEN
  RAISE EXCEPTION 'interest_decision_submission_state_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_batches_v1 SET provider_batch_id=receipt->>'id',
  provider_receipt_body=raw_body,provider_receipt_sha256=raw_sha,
  state=receipt->>'processing_status',next_poll_at=clock_timestamp(),
  ended_at=CASE WHEN receipt->>'processing_status'='ended' THEN clock_timestamp() END
 WHERE id=b.id;
 UPDATE signal_interest_decision_calls_v1 SET status='in_flight',error_code=NULL
  WHERE batch_id=b.id AND status='outcome_unknown';
 RETURN jsonb_build_object('provider_batch_id',receipt->>'id','replayed',false);
END $$;

CREATE TABLE signal_interest_decision_batch_polls_v1 (
 batch_id uuid NOT NULL REFERENCES signal_interest_decision_batches_v1(id),
 receipt_sha256 text NOT NULL CHECK(receipt_sha256~'^sha256:[0-9a-f]{64}$'),
 raw_body text NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(batch_id,receipt_sha256),CHECK(octet_length(raw_body) BETWEEN 1 AND 8388608)
);
CREATE FUNCTION poll_signal_interest_decision_batch_v1(target_batch uuid,target_token uuid,
 raw_body text,raw_sha text,next_poll timestamptz) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;receipt jsonb;total bigint;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 receipt:=raw_body::jsonb;
 SELECT sum(value::bigint) INTO total FROM jsonb_each_text(receipt->'request_counts');
 IF b.provider_batch_id IS NULL OR receipt->>'id' IS DISTINCT FROM b.provider_batch_id
  OR receipt->>'processing_status' NOT IN('in_progress','canceling','ended')
  OR total IS DISTINCT FROM (SELECT count(*) FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id)
  OR raw_sha IS DISTINCT FROM signal_semantic_context_digest_v1(raw_body)
  OR octet_length(raw_body)>8388608 OR b.state NOT IN('in_progress','canceling','ended')
  OR next_poll<=clock_timestamp() THEN
  RAISE EXCEPTION 'interest_decision_poll_invalid' USING ERRCODE='23514';END IF;
 INSERT INTO signal_interest_decision_batch_polls_v1(batch_id,receipt_sha256,raw_body)
 VALUES(b.id,raw_sha,raw_body) ON CONFLICT(batch_id,receipt_sha256) DO NOTHING;
 UPDATE signal_interest_decision_batches_v1 SET state=receipt->>'processing_status',
  next_poll_at=next_poll,ended_at=CASE WHEN receipt->>'processing_status'='ended'
   THEN COALESCE(ended_at,clock_timestamp()) ELSE ended_at END
  WHERE id=b.id;
 RETURN jsonb_build_object('state',receipt->>'processing_status','provider_batch_id',b.provider_batch_id);
END $$;

CREATE FUNCTION quarantine_signal_interest_decision_batch_v1(target_batch uuid,target_token uuid,
 target_error_code text DEFAULT 'interest_decision_submission_unknown',
 raw_body text DEFAULT NULL,raw_sha text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state<>'submitting' OR b.provider_batch_id IS NOT NULL
  OR NOT COALESCE(target_error_code~'^[a-z0-9_:-]{3,100}$',false)
  OR (raw_body IS NULL) IS DISTINCT FROM (raw_sha IS NULL)
  OR (raw_body IS NOT NULL AND (octet_length(raw_body)>8388608
   OR raw_sha IS DISTINCT FROM signal_semantic_context_digest_v1(raw_body))) THEN
  RAISE EXCEPTION 'interest_decision_quarantine_invalid' USING ERRCODE='23514';END IF;
 IF raw_body IS NOT NULL THEN
  INSERT INTO signal_interest_decision_batch_polls_v1(batch_id,receipt_sha256,raw_body)
  VALUES(b.id,raw_sha,raw_body) ON CONFLICT(batch_id,receipt_sha256) DO NOTHING;
 END IF;
 UPDATE signal_interest_decision_batches_v1 SET state='submission_unknown',lease_token=NULL,
  lease_expires_at=NULL,next_poll_at=NULL,last_error_code=target_error_code WHERE id=b.id;
 UPDATE signal_interest_decision_calls_v1 SET status='outcome_unknown',
  error_code=target_error_code WHERE batch_id=b.id AND status='in_flight';
 RETURN jsonb_build_object('state','submission_unknown','retry_allowed',false,
  'receipt_sha256',raw_sha);
END $$;

CREATE FUNCTION reject_signal_interest_decision_batch_v1(target_batch uuid,target_token uuid,
 http_status integer,raw_body text,raw_sha text) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state<>'submitting' OR b.provider_batch_id IS NOT NULL
  OR http_status NOT IN(400,401,403,404,413,422) OR raw_body IS NULL OR octet_length(raw_body)>8388608
  OR raw_sha IS DISTINCT FROM signal_semantic_context_digest_v1(raw_body) THEN
  RAISE EXCEPTION 'interest_decision_rejection_invalid' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_batches_v1 SET state='rejected',provider_receipt_body=raw_body,
  provider_receipt_sha256=raw_sha,lease_token=NULL,lease_expires_at=NULL,ended_at=clock_timestamp()
 WHERE id=b.id;
 UPDATE signal_interest_decision_calls_v1 SET status='definitely_not_sent',error_code='provider_rejected'
 WHERE batch_id=b.id AND status='in_flight';
 RETURN jsonb_build_object('state','rejected','retry_allowed',true);
END $$;

CREATE FUNCTION persist_signal_interest_decision_item_v1(target_batch uuid,target_token uuid,
 target_custom_id text,raw_body text,raw_sha text,storage_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;c signal_interest_decision_calls_v1%ROWTYPE;
 r signal_interest_decision_requests_v1%ROWTYPE;envelope jsonb;usage jsonb;
 input_tokens bigint;output_tokens bigint;cost bigint;output_text text;usage_valid boolean:=true;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 SELECT * INTO r FROM signal_interest_decision_requests_v1 WHERE custom_id=target_custom_id
  AND page_id=b.page_id AND owner_id=b.owner_id;
 SELECT * INTO c FROM signal_interest_decision_calls_v1 WHERE batch_id=b.id AND request_id=r.id FOR UPDATE;
 IF c.id IS NULL OR b.state NOT IN('ended','applied') OR b.provider_batch_id IS NULL
  OR raw_sha IS DISTINCT FROM signal_semantic_context_digest_v1(raw_body)
  OR octet_length(raw_body)>8388608
  OR NOT COALESCE(storage_key='workspace-engine/'||
    (SELECT workspace_id::text FROM signal_interest_decision_owners_v1 WHERE id=b.owner_id)||'/'||
    b.owner_id::text||'/interest-decision-'||b.id::text||'-'||c.id::text||'.json.'||
    substring(raw_sha from 8)||'.parts.json',false)
  OR length(storage_key)>1024 THEN
  RAISE EXCEPTION 'interest_decision_item_receipt_invalid' USING ERRCODE='23514';END IF;
 IF c.raw_body IS NOT NULL THEN
  IF c.raw_body IS DISTINCT FROM raw_body OR c.raw_sha256 IS DISTINCT FROM raw_sha
   OR c.storage_key IS DISTINCT FROM storage_key THEN
   RAISE EXCEPTION 'interest_decision_item_receipt_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('call_id',c.id,'status',c.status,'replayed',true);
 END IF;
 envelope:=raw_body::jsonb;
 IF envelope->>'custom_id' IS DISTINCT FROM target_custom_id
  OR envelope->'result'->>'type' NOT IN('succeeded','errored','canceled','expired')
  OR c.status NOT IN('in_flight','outcome_unknown') THEN
  RAISE EXCEPTION 'interest_decision_item_binding_invalid' USING ERRCODE='23514';END IF;
 IF envelope->'result'->>'type'='succeeded' THEN
  usage:=envelope->'result'->'message'->'usage';
  BEGIN
   IF envelope->'result'->'message'->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
    OR NOT COALESCE(usage->>'input_tokens'~'^[0-9]+$' AND usage->>'output_tokens'~'^[0-9]+$',false)
    OR COALESCE(usage->>'cache_creation_input_tokens','0')<>'0'
    OR COALESCE(usage->>'cache_read_input_tokens','0')<>'0' THEN
    usage_valid:=false;
   ELSE
    input_tokens:=(usage->>'input_tokens')::bigint;output_tokens:=(usage->>'output_tokens')::bigint;
    IF input_tokens>octet_length(r.provider_body) OR output_tokens>128000 THEN usage_valid:=false;
    ELSE cost:=(input_tokens*3+output_tokens*15+1)/2;END IF;
   END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   usage_valid:=false;
  END;
  IF jsonb_typeof(envelope->'result'->'message'->'content')='array'
   AND jsonb_array_length(envelope->'result'->'message'->'content')=1
   AND envelope->'result'->'message'->'content'->0->>'type'='text' THEN
   output_text:=envelope->'result'->'message'->'content'->0->>'text';
  END IF;
 ELSE cost:=0;END IF;
 IF cost>c.reserved_micro_usd THEN usage_valid:=false;END IF;
 UPDATE signal_interest_decision_calls_v1 SET status='response_persisted',raw_body=persist_signal_interest_decision_item_v1.raw_body,
  raw_sha256=raw_sha,storage_key=storage_key,output_text=output_text,
  output_digest=CASE WHEN output_text IS NOT NULL THEN signal_semantic_context_digest_v1(output_text) END,
  observed_micro_usd=CASE WHEN usage_valid THEN cost END,
  outcome=envelope->'result'->>'type',response_at=clock_timestamp(),error_code=NULL WHERE id=c.id;
 IF usage_valid THEN
  UPDATE signal_interest_decision_calls_v1 SET status='settled',settled_micro_usd=cost,
   settled_at=clock_timestamp() WHERE id=c.id;
 ELSE
  UPDATE signal_interest_decision_calls_v1 SET status='outcome_unknown',
   error_code='interest_decision_usage_unresolved' WHERE id=c.id;
 END IF;
 RETURN jsonb_build_object('call_id',c.id,'status',CASE WHEN usage_valid THEN 'settled' ELSE 'outcome_unknown' END,
  'settled_micro_usd',CASE WHEN usage_valid THEN cost END,'replayed',false);
END $$;

CREATE FUNCTION apply_signal_interest_decision_item_v1(target_call uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_interest_decision_calls_v1%ROWTYPE;r signal_interest_decision_requests_v1%ROWTYPE;
 o signal_interest_decision_owners_v1%ROWTYPE;b signal_interest_decision_batches_v1%ROWTYPE;
 envelope jsonb;output jsonb;decision jsonb;citation jsonb;root jsonb;chunk jsonb;
 seen uuid[]:='{}';v_root_id uuid;valid boolean:=true;status text;
BEGIN
 SELECT * INTO c FROM signal_interest_decision_calls_v1 WHERE id=target_call FOR UPDATE;
 SELECT * INTO r FROM signal_interest_decision_requests_v1 WHERE id=c.request_id;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=c.owner_id;
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=c.batch_id;
 IF c.id IS NULL OR c.status<>'settled' OR b.state NOT IN('ended','applied')
  OR c.raw_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(c.raw_body)
  OR r.owner_id IS DISTINCT FROM o.id OR r.page_id IS DISTINCT FROM b.page_id THEN
  RAISE EXCEPTION 'interest_decision_call_unsettled' USING ERRCODE='23514';END IF;
 IF c.validation_status IS NOT NULL THEN
  RETURN jsonb_build_object('call_id',c.id,'validation_status',c.validation_status,'replayed',true);
 END IF;
 envelope:=c.raw_body::jsonb;
 IF c.outcome<>'succeeded' THEN
  RETURN jsonb_build_object('call_id',c.id,'validation_status',c.outcome,'replayed',false);
 END IF;
 IF envelope->'result'->'message'->>'stop_reason'='refusal' THEN status:='refusal';
 ELSIF envelope->'result'->'message'->>'stop_reason'='max_tokens' THEN status:='max_tokens';
 ELSIF envelope->'result'->'message'->>'stop_reason'<>'end_turn' OR c.output_text IS NULL THEN status:='invalid_message';
 ELSE
  BEGIN output:=c.output_text::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN status:='invalid_output';END;
 END IF;
 IF status IS NULL THEN
  IF output->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-v1'
   OR output->>'request_digest' IS DISTINCT FROM r.request_digest
   OR output->>'interest_identity_digest' IS DISTINCT FROM r.interest_identity_digest
   OR jsonb_typeof(output->'decisions') IS DISTINCT FROM 'array'
   OR jsonb_array_length(output->'decisions')<>jsonb_array_length(r.request->'roots')
   OR output ? 'interest' THEN valid:=false;END IF;
 END IF;
 IF status IS NULL AND valid THEN
  FOR decision IN SELECT value FROM jsonb_array_elements(output->'decisions') LOOP
   BEGIN v_root_id:=(decision->>'root_id')::uuid;
   EXCEPTION WHEN invalid_text_representation THEN valid:=false;EXIT;END;
   SELECT root_body INTO root FROM signal_interest_decision_request_roots_v1
    WHERE owner_id=o.id AND request_id=r.id AND root_id=v_root_id;
   IF root IS NULL OR v_root_id=ANY(seen)
    OR decision->>'root_fingerprint' IS DISTINCT FROM root->>'fingerprint'
    OR decision->>'asset_sha256' IS DISTINCT FROM root->>'asset_sha256'
    OR NOT COALESCE(decision->>'verdict' IN('belongs','not_belongs','insufficient'),false)
    OR NULLIF(btrim(decision->>'rationale'),'') IS NULL
    OR jsonb_typeof(decision->'citations') IS DISTINCT FROM 'array'
    OR jsonb_array_length(decision->'citations')>128
    OR (SELECT count(DISTINCT (q->>'chunk_index',q->>'quote_start',q->>'quote_end'))
      FROM jsonb_array_elements(decision->'citations') q)<>jsonb_array_length(decision->'citations')
   THEN valid:=false;EXIT;END IF;
   IF decision->>'verdict'='belongs' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(decision->'citations') q
      WHERE q->>'role'='supports') OR decision->>'verdict'='not_belongs'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(decision->'citations') q
       WHERE q->>'role' IN('contradicts','context')) THEN valid:=false;EXIT;END IF;
   FOR citation IN SELECT value FROM jsonb_array_elements(decision->'citations') LOOP
    IF NOT COALESCE(citation->>'chunk_index'~'^[0-9]+$'
     AND citation->>'quote_start'~'^[0-9]+$' AND citation->>'quote_end'~'^[0-9]+$',false)
     OR NOT COALESCE(citation->>'role' IN('supports','contradicts','context'),false)
     OR NULLIF(btrim(citation->>'quote'),'') IS NULL THEN valid:=false;EXIT;END IF;
    BEGIN
     chunk:=root->'chunks'->(citation->>'chunk_index')::integer;
     IF chunk IS NULL OR citation->>'chunk_sha256' IS DISTINCT FROM chunk->>'chunk_sha256'
      OR (citation->>'quote_end')::integer<=(citation->>'quote_start')::integer
      OR (citation->>'quote_end')::integer> (chunk->>'end')::integer-(chunk->>'start')::integer
      OR citation->>'quote' IS DISTINCT FROM signal_topic_utf16_fragment_v1(chunk->>'text',
       (citation->>'quote_start')::integer,(citation->>'quote_end')::integer)
     THEN valid:=false;END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
     valid:=false;
    END;
    IF NOT valid THEN EXIT;END IF;
   END LOOP;
   IF NOT valid THEN EXIT;END IF;
   seen:=array_append(seen,v_root_id);
  END LOOP;
  IF cardinality(seen)<>jsonb_array_length(r.request->'roots') THEN valid:=false;END IF;
 END IF;
 IF status IS NULL AND NOT valid THEN status:='invalid_output';END IF;
 IF status IS NOT NULL THEN
  UPDATE signal_interest_decision_calls_v1 SET validation_status=status WHERE id=c.id;
  RETURN jsonb_build_object('call_id',c.id,'validation_status',status,'replayed',false);
 END IF;
 FOR decision IN SELECT value FROM jsonb_array_elements(output->'decisions') LOOP
  INSERT INTO signal_interest_decision_root_evidence_v1(owner_id,request_id,call_id,root_id,
   term_key,taxonomy_term_id,root_fingerprint,asset_sha256,verdict,rationale,citations,
   output_digest,decision_digest)
  VALUES(o.id,r.id,c.id,(decision->>'root_id')::uuid,o.term_key,o.taxonomy_term_id,
   decision->>'root_fingerprint',decision->>'asset_sha256',decision->>'verdict',
   decision->>'rationale',decision->'citations',c.output_digest,
   signal_semantic_context_digest_json_v2(decision));
 END LOOP;
 UPDATE signal_interest_decision_calls_v1 SET validation_status='accepted' WHERE id=c.id;
 RETURN jsonb_build_object('call_id',c.id,'validation_status','accepted',
  'root_count',jsonb_array_length(output->'decisions'),'output_digest',c.output_digest,'replayed',false);
END $$;

CREATE FUNCTION finish_signal_interest_decision_batch_v1(target_batch uuid,target_token uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_interest_decision_batches_v1%ROWTYPE;
BEGIN
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=target_batch FOR UPDATE;
 PERFORM signal_interest_decision_batch_lease_v1(b.id,target_token);
 IF b.state<>'ended' OR EXISTS(SELECT 1 FROM signal_interest_decision_calls_v1
  WHERE batch_id=b.id AND (status NOT IN('settled','definitely_not_sent')
   OR status='settled' AND outcome='succeeded' AND validation_status IS NULL)) THEN
  RAISE EXCEPTION 'interest_decision_batch_items_incomplete' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_batches_v1 SET state='applied',lease_token=NULL,
  lease_expires_at=NULL WHERE id=b.id;
 RETURN jsonb_build_object('batch_id',b.id,'state','applied');
END $$;

CREATE FUNCTION finish_signal_interest_decision_v1(target_owner uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;accepted integer;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'interest_decision_owner_missing' USING ERRCODE='23514';END IF;
 IF o.status='completed' THEN RETURN jsonb_build_object('owner_id',o.id,'completed',true,'replayed',true);END IF;
 PERFORM signal_processing_lock_actor_v1(o.workspace_id,o.actor_user_id);
 SELECT count(*) INTO accepted FROM signal_interest_decision_root_evidence_v1 evidence
  JOIN signal_interest_decision_calls_v1 call ON call.id=evidence.call_id AND call.status='settled'
   AND call.validation_status='accepted'
  WHERE evidence.owner_id=o.id;
 IF NOT o.manifest_complete OR accepted<>o.expected_roots
  OR NOT signal_interest_decision_source_current_v1(o.generation_id,o.source_execution_id)
  OR EXISTS(SELECT 1 FROM signal_interest_decision_requests_v1 request
   WHERE request.owner_id=o.id AND NOT EXISTS(SELECT 1 FROM signal_interest_decision_request_roots_v1 root
    JOIN signal_interest_decision_root_evidence_v1 evidence ON evidence.owner_id=root.owner_id
     AND evidence.root_id=root.root_id AND evidence.request_id=request.id
    WHERE root.request_id=request.id))
 THEN RAISE EXCEPTION 'interest_decision_coverage_incomplete' USING ERRCODE='23514';END IF;
 UPDATE signal_interest_decision_owners_v1 SET status='completed',completed_at=clock_timestamp() WHERE id=o.id;
 RETURN jsonb_build_object('owner_id',o.id,'completed',true,'accepted_roots',accepted,'replayed',false);
END $$;

CREATE FUNCTION signal_interest_decision_status_v1(target_owner uuid,target_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner;
 IF o.id IS NULL OR o.actor_user_id IS DISTINCT FROM target_actor
  OR NOT signal_processing_actor_v1(o.workspace_id,target_actor) THEN
  RAISE EXCEPTION 'interest_decision_status_forbidden' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('owner_id',o.id,'status',o.status,'manifest_roots',o.manifest_roots,
  'expected_roots',o.expected_roots,'manifest_complete',o.manifest_complete,
  'accepted_roots',(SELECT count(*) FROM signal_interest_decision_root_evidence_v1 WHERE owner_id=o.id),
  'unknown_batches',(SELECT count(*) FROM signal_interest_decision_batches_v1
    WHERE owner_id=o.id AND state='submission_unknown'),
  'unsettled_calls',(SELECT count(*) FROM signal_interest_decision_calls_v1
    WHERE owner_id=o.id AND status NOT IN('settled','definitely_not_sent')));
END $$;

-- One platform benchmark is reusable for this exact provider artifact across
-- workspaces. Its independent labeled corpus and receipt are stored outside
-- PostgreSQL; this append-only row records the reviewed digests and arithmetic.
CREATE TABLE signal_interest_decision_platform_benchmarks_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version integer NOT NULL CHECK(version>=1),
 model_artifact_digest text NOT NULL CHECK(model_artifact_digest~'^sha256:[a-f0-9]{64}$'),
 provider_config_digest text NOT NULL CHECK(provider_config_digest~'^sha256:[a-f0-9]{64}$'),
 prompt_digest text NOT NULL CHECK(prompt_digest~'^sha256:[a-f0-9]{64}$'),
 dataset_digest text NOT NULL CHECK(dataset_digest~'^sha256:[a-f0-9]{64}$'),
 labels_digest text NOT NULL CHECK(labels_digest~'^sha256:[a-f0-9]{64}$'),
 evaluation_evidence_digest text NOT NULL CHECK(evaluation_evidence_digest~'^sha256:[a-f0-9]{64}$'),
 evidence_locator text NOT NULL CHECK(length(evidence_locator) BETWEEN 8 AND 1024),
 thresholds jsonb NOT NULL CHECK(jsonb_typeof(thresholds)='object'),
 thresholds_digest text NOT NULL CHECK(thresholds_digest~'^sha256:[a-f0-9]{64}$'),
 positive_count integer NOT NULL CHECK(positive_count>0),negative_count integer NOT NULL CHECK(negative_count>0),
 mixed_count integer NOT NULL CHECK(mixed_count>0),true_positive integer NOT NULL CHECK(true_positive>=0),
 false_positive integer NOT NULL CHECK(false_positive>=0),false_negative integer NOT NULL CHECK(false_negative>=0),
 true_negative integer NOT NULL CHECK(true_negative>=0),positive_insufficient integer NOT NULL CHECK(positive_insufficient>=0),
 negative_insufficient integer NOT NULL CHECK(negative_insufficient>=0),mixed_correct integer NOT NULL CHECK(mixed_correct>=0),
 approved_by_user_id uuid NOT NULL REFERENCES users(id),approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(model_artifact_digest,provider_config_digest,prompt_digest,version),
 CHECK(positive_count=true_positive+false_negative+positive_insufficient),
 CHECK(negative_count=true_negative+false_positive+negative_insufficient),
 CHECK(mixed_count<=positive_count+negative_count AND mixed_correct<=mixed_count)
);
CREATE FUNCTION validate_signal_interest_decision_platform_benchmark_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE t jsonb:=NEW.thresholds;sample_count integer:=NEW.positive_count+NEW.negative_count;
 precision_value numeric;recall_value numeric;specificity numeric;mixed_accuracy numeric;
BEGIN
 IF NEW.model_artifact_digest IS DISTINCT FROM signal_interest_decision_model_digest_v1()
  OR NEW.provider_config_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v1())
  OR NEW.prompt_digest IS DISTINCT FROM signal_interest_decision_provider_config_v1()->>'prompt_digest'
  OR NEW.thresholds_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(t)
  OR NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.approved_by_user_id
   AND actor.status='active' AND actor.user_type='noisia_internal')
  OR t->>'contract_version' IS DISTINCT FROM 'signal-interest-decision-platform-quality-v1'
  OR NOT (t ?& ARRAY['min_samples','min_positive','min_negative','min_mixed',
   'min_precision_bps','min_recall_bps','min_specificity_bps','min_mixed_accuracy_bps','max_insufficient_rate_bps'])
  OR EXISTS(SELECT 1 FROM jsonb_each(t) entry WHERE entry.key=ANY(ARRAY[
   'min_samples','min_positive','min_negative','min_mixed','min_precision_bps',
   'min_recall_bps','min_specificity_bps','min_mixed_accuracy_bps','max_insufficient_rate_bps'])
   AND jsonb_typeof(entry.value)<>'number')
 THEN RAISE EXCEPTION 'interest_decision_platform_benchmark_invalid' USING ERRCODE='23514';END IF;
 precision_value:=CASE WHEN NEW.true_positive+NEW.false_positive=0 THEN NULL
  ELSE NEW.true_positive::numeric/(NEW.true_positive+NEW.false_positive) END;
 recall_value:=NEW.true_positive::numeric/NEW.positive_count;
 specificity:=NEW.true_negative::numeric/NEW.negative_count;
 mixed_accuracy:=NEW.mixed_correct::numeric/NEW.mixed_count;
 IF (t->>'min_samples')::integer<1 OR (t->>'min_positive')::integer<1
  OR (t->>'min_negative')::integer<1 OR (t->>'min_mixed')::integer<1
  OR (t->>'min_precision_bps')::integer NOT BETWEEN 0 AND 10000
  OR (t->>'min_recall_bps')::integer NOT BETWEEN 0 AND 10000
  OR (t->>'min_specificity_bps')::integer NOT BETWEEN 0 AND 10000
  OR (t->>'min_mixed_accuracy_bps')::integer NOT BETWEEN 0 AND 10000
  OR (t->>'max_insufficient_rate_bps')::integer NOT BETWEEN 0 AND 10000
  OR sample_count<(t->>'min_samples')::integer
  OR NEW.positive_count<(t->>'min_positive')::integer
  OR NEW.negative_count<(t->>'min_negative')::integer
  OR NEW.mixed_count<(t->>'min_mixed')::integer
  OR precision_value IS NULL OR precision_value*10000<(t->>'min_precision_bps')::integer
  OR recall_value*10000<(t->>'min_recall_bps')::integer
  OR specificity*10000<(t->>'min_specificity_bps')::integer
  OR mixed_accuracy*10000<(t->>'min_mixed_accuracy_bps')::integer
  OR (NEW.positive_insufficient+NEW.negative_insufficient)::numeric/sample_count
   *10000>(t->>'max_insufficient_rate_bps')::integer
 THEN RAISE EXCEPTION 'interest_decision_platform_benchmark_failed' USING ERRCODE='23514';END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'interest_decision_platform_benchmark_invalid' USING ERRCODE='23514';
END $$;
CREATE TRIGGER validate_signal_interest_decision_platform_benchmark_v1 BEFORE INSERT
 ON signal_interest_decision_platform_benchmarks_v1 FOR EACH ROW
 EXECUTE FUNCTION validate_signal_interest_decision_platform_benchmark_v1();

-- SQL0087 evaluates published assignments. Before publication, this exact
-- model instead records complete settled coverage and points to the approved
-- platform benchmark. Precision/recall/F1 remain NULL for the client corpus.
CREATE FUNCTION signal_interest_decision_model_id_v1(target_model uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM tagging_model_versions model WHERE model.id=target_model
  AND model.artifact_digest=signal_interest_decision_model_digest_v1())
$$;
CREATE FUNCTION validate_signal_interest_decision_evaluation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE g signal_classification_generations%ROWTYPE;o signal_interest_decision_owners_v1%ROWTYPE;
 model tagging_model_versions%ROWTYPE;benchmark signal_interest_decision_platform_benchmarks_v1%ROWTYPE;
 receipt_digest text;
BEGIN
 SELECT * INTO g FROM signal_classification_generations WHERE id=NEW.generation_id;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE generation_id=g.id;
 SELECT * INTO model FROM tagging_model_versions WHERE id=NEW.evaluated_model_version_id;
 SELECT * INTO benchmark FROM signal_interest_decision_platform_benchmarks_v1
  WHERE id=(model.configuration->>'platform_benchmark_id')::uuid;
 SELECT signal_semantic_context_digest_v1(o.source_input_digest||':'||
  string_agg(evidence.decision_digest,':' ORDER BY evidence.root_id)) INTO receipt_digest
  FROM signal_interest_decision_root_evidence_v1 evidence WHERE evidence.owner_id=o.id;
 IF g.id IS NULL OR g.status<>'open' OR g.workspace_id IS DISTINCT FROM NEW.workspace_id
  OR g.taxonomy_profile_id IS DISTINCT FROM NEW.taxonomy_profile_id
  OR o.id IS NULL OR o.status<>'completed' OR NOT o.manifest_complete
  OR NOT signal_interest_decision_source_current_v1(g.id,o.source_execution_id)
  OR model.id IS NULL OR model.registry_contract_version<>'signal-tagging-model-registry-v1'
  OR model.provider<>'anthropic' OR model.taxonomy_profile_id IS DISTINCT FROM g.taxonomy_profile_id
  OR model.artifact_digest IS DISTINCT FROM g.input_snapshot->'identity'->>'engine_artifact_digest'
  OR model.configuration->'provider_config' IS DISTINCT FROM signal_interest_decision_provider_config_v1()
  OR model.configuration->'workspace_classification_identity' IS DISTINCT FROM g.input_snapshot->'identity'
  OR model.configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(model.configuration)
  OR model.dataset_digest IS DISTINCT FROM benchmark.dataset_digest
  OR model.gold_set_digest IS DISTINCT FROM benchmark.labels_digest
  OR benchmark.id IS NULL OR benchmark.model_artifact_digest IS DISTINCT FROM model.artifact_digest
  OR benchmark.provider_config_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v1())
  OR benchmark.prompt_digest IS DISTINCT FROM signal_interest_decision_provider_config_v1()->>'prompt_digest'
  OR benchmark.approved_at>clock_timestamp()
  OR NEW.gold_set_version_id IS NOT NULL OR NEW.split IS NOT NULL
  OR NEW.evaluated_labeling_function_version_id IS NOT NULL
  OR NEW.denominator IS DISTINCT FROM o.expected_roots
  OR NEW.input_digest IS DISTINCT FROM receipt_digest
  OR NEW.artifact_digest IS DISTINCT FROM benchmark.evaluation_evidence_digest
  OR NEW.policy_digest IS DISTINCT FROM benchmark.thresholds_digest
  OR NEW.precision_score IS NOT NULL OR NEW.recall_score IS NOT NULL OR NEW.f1_score IS NOT NULL
  OR NEW.approved<>0
  OR NEW.pending IS DISTINCT FROM (SELECT count(*) FROM signal_interest_decision_root_evidence_v1
   WHERE owner_id=o.id AND verdict IN('belongs','insufficient'))
  OR NEW.rejected IS DISTINCT FROM (SELECT count(*) FROM signal_interest_decision_root_evidence_v1
   WHERE owner_id=o.id AND verdict='not_belongs')
  OR NEW.abstained<>0 OR NEW.error<>0 OR NEW.resolved<>NEW.denominator OR NEW.coverage<>1
  OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id)
  OR NOT EXISTS(SELECT 1 FROM signal_classification_operations operation
   WHERE operation.id=NEW.operation_id AND operation.workspace_id=NEW.workspace_id
    AND operation.operation_kind='evaluate-classifier' AND operation.status='in_progress'
    AND operation.actor_user_id=NEW.created_by_user_id)
 THEN RAISE EXCEPTION 'interest_decision_evaluation_authority_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION 'interest_decision_evaluation_authority_invalid' USING ERRCODE='23514';
END $$;
DROP TRIGGER validate_signal_classification_evaluation_v1 ON signal_classification_evaluations;
CREATE TRIGGER validate_signal_classification_evaluation_v1 BEFORE INSERT
 ON signal_classification_evaluations FOR EACH ROW
 WHEN (NOT signal_interest_decision_model_id_v1(NEW.evaluated_model_version_id))
 EXECUTE FUNCTION validate_signal_classification_evaluation_v1();
CREATE TRIGGER validate_signal_interest_decision_evaluation_v1 BEFORE INSERT
 ON signal_classification_evaluations FOR EACH ROW
 WHEN (signal_interest_decision_model_id_v1(NEW.evaluated_model_version_id))
 EXECUTE FUNCTION validate_signal_interest_decision_evaluation_v1();

-- Membership rows cannot carry citation JSON (SQL0140). The assignment refers
-- to one settled root decision and the exact output digest instead.
ALTER TABLE signal_classification_assignments
 ADD COLUMN interest_decision_evidence_id uuid REFERENCES signal_interest_decision_root_evidence_v1(id),
 ADD COLUMN interest_output_digest text CHECK(interest_output_digest~'^sha256:[0-9a-f]{64}$'),
 ADD CONSTRAINT signal_interest_decision_assignment_reference_v1 CHECK(
  (interest_decision_evidence_id IS NULL)=(interest_output_digest IS NULL));

CREATE FUNCTION guard_signal_interest_decision_assignment_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE g signal_classification_generations%ROWTYPE;e signal_interest_decision_root_evidence_v1%ROWTYPE;
 o signal_interest_decision_owners_v1%ROWTYPE;c signal_interest_decision_calls_v1%ROWTYPE;
 model tagging_model_versions%ROWTYPE;policy signal_classification_approval_policies%ROWTYPE;
BEGIN
 SELECT * INTO g FROM signal_classification_generations WHERE id=NEW.generation_id;
 IF g.input_contract<>'workspace-topic-classification-v1'
  OR g.input_snapshot->>'interest_term_key' IS NULL THEN
  IF NEW.interest_decision_evidence_id IS NOT NULL THEN
   RAISE EXCEPTION 'interest_decision_assignment_scope_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NEW.resolution_method='human' THEN
  IF NEW.interest_decision_evidence_id IS NOT NULL THEN
   RAISE EXCEPTION 'interest_decision_human_override_invalid' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO e FROM signal_interest_decision_root_evidence_v1 WHERE id=NEW.interest_decision_evidence_id;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=e.owner_id;
 SELECT * INTO c FROM signal_interest_decision_calls_v1 WHERE id=e.call_id;
 SELECT * INTO model FROM tagging_model_versions WHERE id=NEW.model_version_id;
 SELECT * INTO policy FROM signal_classification_approval_policies WHERE id=NEW.approval_policy_id;
 IF e.id IS NULL OR o.id IS NULL OR c.id IS NULL OR o.status<>'completed'
  OR o.generation_id IS DISTINCT FROM g.id OR o.workspace_id IS DISTINCT FROM NEW.workspace_id
  OR e.root_id IS DISTINCT FROM NEW.canonical_root_id
  OR e.taxonomy_term_id IS DISTINCT FROM NEW.taxonomy_term_id
  OR e.term_key IS DISTINCT FROM g.input_snapshot->>'interest_term_key'
  OR e.root_fingerprint IS DISTINCT FROM
    (SELECT root_fingerprint FROM signal_classification_generation_items WHERE id=NEW.generation_item_id)
  OR e.output_digest IS DISTINCT FROM NEW.interest_output_digest
  OR e.decision_digest IS DISTINCT FROM NEW.evidence_digest
  OR c.status<>'settled' OR c.validation_status<>'accepted' OR c.output_digest IS DISTINCT FROM e.output_digest
  OR NEW.membership_basis<>'decision' OR NEW.membership_metadata IS NOT NULL
  OR NEW.resolution_method<>'model'
  OR NEW.disposition IS DISTINCT FROM (CASE e.verdict WHEN 'belongs' THEN 'approved'
    WHEN 'not_belongs' THEN 'rejected' ELSE 'pending' END)
  OR model.id IS NULL OR model.provider IS DISTINCT FROM 'anthropic'
  OR model.artifact_digest IS DISTINCT FROM signal_interest_decision_model_digest_v1()
  OR model.artifact_digest IS DISTINCT FROM g.input_snapshot->'identity'->>'engine_artifact_digest'
  OR model.configuration->'provider_config' IS DISTINCT FROM signal_interest_decision_provider_config_v1()
  OR model.configuration->'workspace_classification_identity' IS DISTINCT FROM g.input_snapshot->'identity'
  OR model.taxonomy_profile_id IS DISTINCT FROM g.taxonomy_profile_id
  OR (SELECT event.status FROM signal_tagging_model_version_events event
     WHERE event.workspace_id=g.workspace_id AND event.model_version_id=model.id
      AND event.effective_at<=now() ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)
     IS DISTINCT FROM 'approved'
  OR (NEW.disposition='approved' AND (policy.id IS NULL OR policy.status<>'approved'
   OR policy.workspace_id IS DISTINCT FROM g.workspace_id
   OR policy.taxonomy_profile_id IS DISTINCT FROM g.taxonomy_profile_id
   OR policy.authority_kind<>'model' OR policy.model_version_id IS DISTINCT FROM model.id
   OR policy.definition_hash IS DISTINCT FROM g.input_snapshot->'identity'->>'decision_policy_digest'
   OR policy.effective_from>now() OR (policy.effective_to IS NOT NULL AND policy.effective_to<=now())))
 THEN RAISE EXCEPTION 'interest_decision_assignment_authority_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_signal_interest_decision_assignment_v1 BEFORE INSERT ON signal_classification_assignments
 FOR EACH ROW EXECUTE FUNCTION guard_signal_interest_decision_assignment_v1();

CREATE FUNCTION signal_interest_decision_immutable_row_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'interest_decision_history_immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_interest_decision_request_key_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_request_keys_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_immutable_row_v1();
CREATE TRIGGER signal_interest_decision_owner_admission_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_owner_admissions_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_immutable_row_v1();
CREATE TRIGGER signal_interest_decision_page_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_pages_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_immutable_row_v1();
CREATE TRIGGER signal_interest_decision_request_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_requests_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_immutable_row_v1();
CREATE TRIGGER signal_interest_decision_root_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_request_roots_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_immutable_row_v1();
CREATE TRIGGER signal_interest_decision_poll_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_batch_polls_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_immutable_row_v1();
CREATE TRIGGER signal_interest_decision_evidence_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_root_evidence_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_immutable_row_v1();
CREATE TRIGGER signal_interest_decision_platform_benchmark_immutable_v1
 BEFORE UPDATE OR DELETE ON signal_interest_decision_platform_benchmarks_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_immutable_row_v1();

CREATE FUNCTION signal_interest_decision_owner_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'interest_decision_owner_immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['manifest_roots','cursor_root_id','manifest_complete','status','completed_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['manifest_roots','cursor_root_id','manifest_complete','status','completed_at'])
  OR NEW.manifest_roots<OLD.manifest_roots OR NEW.manifest_roots>OLD.manifest_roots+64
  OR NEW.manifest_complete AND NEW.manifest_roots<>NEW.expected_roots
  OR OLD.status='completed' AND NEW IS DISTINCT FROM OLD
  OR NOT (OLD.status='open' AND NEW.status IN('open','ready')
   OR OLD.status='ready' AND NEW.status IN('ready','completed')
   OR OLD.status='completed' AND NEW.status='completed')
  OR NEW.status='completed' AND NEW.completed_at IS NULL)
 THEN RAISE EXCEPTION 'interest_decision_owner_transition_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_interest_decision_owner_guard_v1 BEFORE UPDATE OR DELETE
 ON signal_interest_decision_owners_v1 FOR EACH ROW EXECUTE FUNCTION signal_interest_decision_owner_guard_v1();

CREATE FUNCTION signal_interest_decision_batch_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'interest_decision_batch_immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','provider_batch_id','provider_receipt_body',
    'provider_receipt_sha256','lease_token','lease_expires_at','next_poll_at','submitted_at','ended_at','last_error_code'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_batch_id','provider_receipt_body',
    'provider_receipt_sha256','lease_token','lease_expires_at','next_poll_at','submitted_at','ended_at','last_error_code'])
  OR OLD.provider_batch_id IS NOT NULL AND NEW.provider_batch_id IS DISTINCT FROM OLD.provider_batch_id
  OR OLD.provider_receipt_body IS NOT NULL AND NEW.provider_receipt_body IS DISTINCT FROM OLD.provider_receipt_body
  OR OLD.state IN('applied','rejected') AND NEW IS DISTINCT FROM OLD
  OR NEW.state IS DISTINCT FROM OLD.state AND NOT(
   OLD.state='prepared' AND NEW.state='submitting'
   OR OLD.state='submitting' AND NEW.state IN('submission_unknown','in_progress','canceling','ended','rejected')
   OR OLD.state='submission_unknown' AND NEW.state IN('in_progress','canceling','ended')
   OR OLD.state='in_progress' AND NEW.state IN('in_progress','canceling','ended')
   OR OLD.state='canceling' AND NEW.state IN('canceling','ended')
   OR OLD.state='ended' AND NEW.state='applied'))
 THEN RAISE EXCEPTION 'interest_decision_batch_transition_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_interest_decision_batch_guard_v1 BEFORE UPDATE OR DELETE
 ON signal_interest_decision_batches_v1 FOR EACH ROW EXECUTE FUNCTION signal_interest_decision_batch_guard_v1();

CREATE FUNCTION signal_interest_decision_call_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;r signal_interest_decision_requests_v1%ROWTYPE;
 b signal_interest_decision_batches_v1%ROWTYPE;a signal_processing_admissions%ROWTYPE;
 org_exposure bigint;owner_exposure bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'interest_decision_call_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=NEW.owner_id;
 SELECT * INTO r FROM signal_interest_decision_requests_v1 WHERE id=NEW.request_id;
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=NEW.batch_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=b.admission_id;
 IF o.id IS NULL OR r.id IS NULL OR b.id IS NULL OR a.id IS NULL
  OR r.owner_id IS DISTINCT FROM o.id OR b.owner_id IS DISTINCT FROM o.id
  OR b.page_id IS DISTINCT FROM r.page_id OR a.target_id IS DISTINCT FROM o.id
  OR NEW.organization_id IS DISTINCT FROM o.organization_id
  OR NEW.reserved_micro_usd IS DISTINCT FROM r.reserved_micro_usd
  OR NEW.budget_date IS DISTINCT FROM a.budget_date
  OR NEW.budget_timezone IS DISTINCT FROM a.budget_timezone THEN
  RAISE EXCEPTION 'interest_decision_call_scope_invalid' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM signal_processing_lock_v1(o.organization_id,NEW.budget_date);
  IF NEW.status<>'reserved' OR NEW.raw_body IS NOT NULL OR NEW.sent_at IS NOT NULL
   OR NEW.settled_micro_usd IS NOT NULL OR NEW.observed_micro_usd IS NOT NULL
   OR NEW.attempt_index<>COALESCE((SELECT max(attempt_index)+1 FROM signal_interest_decision_calls_v1
     WHERE request_id=r.id),1)
   OR NEW.retry_of_call_id IS DISTINCT FROM (SELECT id FROM signal_interest_decision_calls_v1
     WHERE request_id=r.id ORDER BY attempt_index DESC LIMIT 1) THEN
   RAISE EXCEPTION 'interest_decision_call_insert_invalid' USING ERRCODE='23514';END IF;
  SELECT total_micro_usd INTO org_exposure FROM signal_processing_org_exposure_v1(
   o.organization_id,NEW.budget_date,NEW.budget_timezone);
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd
    WHEN status='definitely_not_sent' THEN 0 ELSE greatest(reserved_micro_usd,COALESCE(observed_micro_usd,0)) END),0)
   INTO owner_exposure FROM signal_interest_decision_calls_v1 WHERE owner_id=o.id;
  IF org_exposure+NEW.reserved_micro_usd>
    (SELECT daily_cap_micro_usd FROM signal_processing_policy_versions WHERE id=a.policy_version_id)
   OR owner_exposure+NEW.reserved_micro_usd>o.hard_cap_micro_usd THEN
   RAISE EXCEPTION 'interest_decision_cap_exhausted' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','raw_body','raw_sha256','storage_key','output_text','output_digest',
   'observed_micro_usd','settled_micro_usd','outcome','error_code','validation_status','sent_at','response_at','settled_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','raw_body','raw_sha256','storage_key','output_text','output_digest',
   'observed_micro_usd','settled_micro_usd','outcome','error_code','validation_status','sent_at','response_at','settled_at'])
   OR OLD.raw_body IS NOT NULL AND NEW.raw_body IS DISTINCT FROM OLD.raw_body
   OR OLD.status IN('settled','definitely_not_sent') AND NEW.status IS DISTINCT FROM OLD.status
   OR NEW.status IS DISTINCT FROM OLD.status AND NOT(
    OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
    OR OLD.status='in_flight' AND NEW.status IN('outcome_unknown','response_persisted')
    OR OLD.status='outcome_unknown' AND NEW.status IN('in_flight','response_persisted')
    OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown'))
   OR OLD.validation_status IS NOT NULL AND NEW.validation_status IS DISTINCT FROM OLD.validation_status
   OR NEW.status='settled' AND (NEW.raw_body IS NULL OR NEW.settled_micro_usd IS DISTINCT FROM NEW.observed_micro_usd
    OR NEW.settled_micro_usd>NEW.reserved_micro_usd)
   OR NEW.raw_body IS NOT NULL AND NEW.raw_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.raw_body)
   OR NEW.output_text IS NOT NULL AND NEW.output_digest IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.output_text)
  THEN RAISE EXCEPTION 'interest_decision_call_transition_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_interest_decision_call_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON signal_interest_decision_calls_v1 FOR EACH ROW EXECUTE FUNCTION signal_interest_decision_call_guard_v1();

REVOKE ALL ON signal_interest_decision_owners_v1,signal_interest_decision_request_keys_v1,
 signal_interest_decision_owner_admissions_v1,signal_interest_decision_pages_v1,
 signal_interest_decision_requests_v1,signal_interest_decision_request_roots_v1,
 signal_interest_decision_batches_v1,signal_interest_decision_batch_polls_v1,
 signal_interest_decision_calls_v1,signal_interest_decision_root_evidence_v1,
 signal_interest_decision_platform_benchmarks_v1 FROM PUBLIC;
DO $$ DECLARE role_name text;table_name text;routine record; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   FOR table_name IN SELECT unnest(ARRAY['signal_interest_decision_owners_v1','signal_interest_decision_request_keys_v1',
    'signal_interest_decision_owner_admissions_v1','signal_interest_decision_pages_v1',
    'signal_interest_decision_requests_v1','signal_interest_decision_request_roots_v1',
    'signal_interest_decision_batches_v1','signal_interest_decision_batch_polls_v1',
    'signal_interest_decision_calls_v1','signal_interest_decision_root_evidence_v1',
    'signal_interest_decision_platform_benchmarks_v1']) LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',table_name,role_name);
   END LOOP;
  END IF;
 END LOOP;
 FOR routine IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'signal_interest_decision_%_v1'
   OR n.nspname='public' AND p.proname LIKE '%signal_interest_decision%_v1' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',routine.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',routine.signature,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;

-- The worker's private DB role receives only state-machine entrypoints.
-- Internal validators, ledger helpers, and trigger functions stay uncallable.
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'request_signal_interest_decision_v1(uuid,uuid,uuid,uuid,text)',
  'renew_signal_interest_decision_admission_v1(uuid,uuid)',
  'append_signal_interest_decision_page_v1(uuid,jsonb,text,text,jsonb)',
  'prepare_signal_interest_decision_batch_v1(uuid,uuid,text[],text)',
  'claim_signal_interest_decision_batch_v1(uuid,integer)',
  'mark_submitting_signal_interest_decision_batch_v1(uuid,uuid)',
  'attach_provider_signal_interest_decision_batch_v1(uuid,uuid,text,text)',
  'poll_signal_interest_decision_batch_v1(uuid,uuid,text,text,timestamptz)',
  'quarantine_signal_interest_decision_batch_v1(uuid,uuid,text,text,text)',
  'reject_signal_interest_decision_batch_v1(uuid,uuid,integer,text,text)',
  'release_signal_interest_decision_batch_v1(uuid,uuid,timestamptz,text)',
  'persist_signal_interest_decision_item_v1(uuid,uuid,text,text,text,text)',
  'apply_signal_interest_decision_item_v1(uuid)',
  'finish_signal_interest_decision_batch_v1(uuid,uuid)',
  'finish_signal_interest_decision_v1(uuid)',
  'signal_interest_decision_status_v1(uuid,uuid)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER',signature);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',signature);
  END IF;
 END LOOP;
END $$;
