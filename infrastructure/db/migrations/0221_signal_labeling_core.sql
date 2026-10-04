-- MFP common labeling ledger. Additive; installation creates no work or policy.
CREATE TABLE signal_labeler_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('facets','membership')),
 provider text NOT NULL CHECK(provider IN('anthropic','typesafe','rules','human')),model text NOT NULL,
 prompt_digest text NOT NULL,schema_digest text NOT NULL,labeler_digest text NOT NULL UNIQUE,identity jsonb NOT NULL,
 status text NOT NULL DEFAULT 'experimental' CHECK(status IN('experimental','approved','retired')),
 eval_report_ref text,approved_by_user_id uuid REFERENCES users(id),approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'approved' OR eval_report_ref IS NOT NULL AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
);
CREATE TABLE signal_labeling_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 kind text NOT NULL CHECK(kind IN('facets','membership')),labeler_version_id uuid NOT NULL REFERENCES signal_labeler_versions(id),
 preparation_run_id uuid NOT NULL,concept_set_digest text,entity_context_digest text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed','canceled')),
 counts jsonb NOT NULL DEFAULT '{}',estimated_micro_usd bigint NOT NULL CHECK(estimated_micro_usd>=0),
 budget_micro_usd bigint CHECK(budget_micro_usd>=0),cap_micro_usd bigint CHECK(cap_micro_usd>=0),
 idempotency_key text NOT NULL,request_digest text NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),
 processing_admission_id uuid REFERENCES signal_processing_admissions(id),full_recalculation_confirmed boolean NOT NULL DEFAULT false,
 waiting_full_confirmation boolean NOT NULL DEFAULT false,cursor_root_id uuid,selection_complete boolean NOT NULL DEFAULT false,
 lease_token uuid,lease_until timestamptz,next_poll_at timestamptz NOT NULL DEFAULT now(),error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,actor_user_id,idempotency_key),
 FOREIGN KEY(workspace_id,preparation_run_id) REFERENCES signal_corpus_preparation_runs(workspace_id,id)
);
CREATE UNIQUE INDEX signal_labeling_active ON signal_labeling_runs(workspace_id,kind) WHERE status IN('queued','running');
CREATE TABLE signal_labeling_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL,workspace_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN('anthropic','typesafe')),model text NOT NULL,transport text NOT NULL CHECK(transport IN('batch','sync')),
 provider_batch_id text,custom_id text NOT NULL UNIQUE,request_digest text NOT NULL,request_storage_key text,
 request jsonb NOT NULL,inputs jsonb NOT NULL,retry_depth integer NOT NULL DEFAULT 0 CHECK(retry_depth BETWEEN 0 AND 8),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','submitting','submitted','settled','failed','unknown')),
 reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>=0),settled_micro_usd bigint CHECK(settled_micro_usd>=0),usage jsonb,
 raw_sha256 text,raw_storage_key text,raw_body text,stop_reason text,refusal_category text,results_applied boolean NOT NULL DEFAULT false,results jsonb,
 budget_date date NOT NULL,budget_timezone text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id),
 CHECK(status<>'settled' OR settled_micro_usd IS NOT NULL AND raw_sha256 IS NOT NULL AND raw_storage_key IS NOT NULL),
 CHECK((raw_body IS NULL)=(raw_sha256 IS NULL))
);
CREATE INDEX signal_labeling_calls_run ON signal_labeling_calls(run_id,status);
CREATE INDEX signal_labeling_due ON signal_labeling_runs(next_poll_at) WHERE status IN('queued','running');
CREATE TABLE signal_workspace_labelers (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),kind text NOT NULL CHECK(kind IN('facets','membership')),
 labeler_version_id uuid NOT NULL REFERENCES signal_labeler_versions(id),PRIMARY KEY(workspace_id,kind)
);
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_name;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_name CHECK(action IN(
 'brand_context_proposal','topic_prototype_embeddings','corpus_preparation','corpus_embeddings','topic_fit','topic_interpretation',
 'topic_fit_incremental','topic_interpretation_incremental','topic_consolidation','topic_consolidation_numeric','interest_decision','mention_facets','concept_membership'));
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_provider;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_provider CHECK(
 (kind='free' AND action IN('corpus_preparation','topic_fit','topic_fit_incremental','topic_consolidation_numeric') AND provider IS NULL AND model IS NULL AND max_execution_micro_usd=0)
 OR (kind='provider' AND provider IS NOT NULL AND model IS NOT NULL AND (
 action IN('brand_context_proposal','topic_interpretation','topic_interpretation_incremental','topic_consolidation','interest_decision') AND provider='anthropic' AND model='claude-sonnet-4-6'
 OR action IN('topic_prototype_embeddings','corpus_embeddings') AND provider='voyage' AND model='voyage-4-large'
 OR action IN('mention_facets','concept_membership') AND (provider='anthropic' AND model='claude-sonnet-5-5' OR provider='typesafe' AND model IN('jev-latest','jev-1.13.0')))));
ALTER FUNCTION signal_processing_org_exposure_v1(uuid,date,text,text,uuid) RENAME TO signal_processing_org_exposure_pre0221_v1;
CREATE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint)
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH old AS(SELECT * FROM signal_processing_org_exposure_pre0221_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),
 fresh AS(SELECT COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'),0)::bigint confirmed,
 COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status IN('reserved','submitting','submitted')),0)::bigint reserved,
 COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status='unknown'),0)::bigint ambiguous
 FROM signal_labeling_calls c JOIN signal_workspaces w ON w.id=c.workspace_id
 WHERE w.organization_id=target_org AND c.budget_date=target_day AND NOT COALESCE(excluded_ledger='labeling' AND c.id=excluded_id,false))
 SELECT old.confirmed_micro_usd+fresh.confirmed,old.reserved_micro_usd+fresh.reserved,old.ambiguous_micro_usd+fresh.ambiguous,
 old.total_micro_usd+fresh.confirmed+fresh.reserved+fresh.ambiguous FROM old,fresh
 $$;
ALTER TABLE signal_labeler_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_labeling_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_labeling_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_workspace_labelers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_labeler_versions,signal_labeling_runs,signal_labeling_calls,signal_workspace_labelers FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_processing_org_exposure_v1(uuid,date,text,text,uuid) FROM PUBLIC;
