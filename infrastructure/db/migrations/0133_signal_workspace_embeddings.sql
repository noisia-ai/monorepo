-- Workspace-native full-chunk embeddings. No provider call, prepared data rewrite,
-- legacy study corpus, serving activation or grants are created by this migration.
-- Ordered access to existing immutable references; no second population is copied.
CREATE INDEX idx_corpus_preparation_eligible_assets ON signal_corpus_preparation_items(run_id,asset_sha256)
 WHERE disposition='eligible';
CREATE TABLE signal_workspace_embedding_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 preparation_run_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 input_revision bigint NOT NULL CHECK(input_revision>0),
 policy_valid_until timestamptz,
 profile jsonb NOT NULL CHECK(jsonb_typeof(profile)='object'),
 config_digest text NOT NULL CHECK(config_digest~'^sha256:[0-9a-f]{64}$'),
 quote_digest text NOT NULL CHECK(quote_digest~'^sha256:[0-9a-f]{64}$'),
 request_keys jsonb NOT NULL CHECK(jsonb_typeof(request_keys)='object'),
 hard_cap_micro_usd bigint NOT NULL CHECK(hard_cap_micro_usd>=0),
 estimated_upper_micro_usd bigint NOT NULL CHECK(estimated_upper_micro_usd>=0),
 reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK(reserved_micro_usd>=0),
 settled_micro_usd bigint NOT NULL DEFAULT 0 CHECK(settled_micro_usd>=0),
 unknown_reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK(unknown_reserved_micro_usd>=0),
 observed_exception_micro_usd bigint NOT NULL DEFAULT 0 CHECK(observed_exception_micro_usd>=0),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed','stale','outcome_unknown','canceled')),
 counts jsonb NOT NULL CHECK(jsonb_typeof(counts)='object'),
 cursor_asset_sha256 text CHECK(cursor_asset_sha256 IS NULL OR cursor_asset_sha256~'^sha256:[0-9a-f]{64}$'),
 cursor_chunk_index integer CHECK(cursor_chunk_index>=0),
 execution_token uuid,execution_expires_at timestamptz,
 dispatch_generation integer NOT NULL DEFAULT 1 CHECK(dispatch_generation>0),
 worker_job_id text NOT NULL UNIQUE,
 dispatch_status text NOT NULL DEFAULT 'pending' CHECK(dispatch_status IN('pending','dispatching','dispatched')),
 dispatch_token uuid,dispatch_expires_at timestamptz,
 dispatch_attempts integer NOT NULL DEFAULT 0 CHECK(dispatch_attempts>=0),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,preparation_run_id) REFERENCES signal_corpus_preparation_runs(workspace_id,id) ON DELETE RESTRICT,
 CHECK((cursor_asset_sha256 IS NULL)=(cursor_chunk_index IS NULL)),
 CHECK((execution_token IS NULL)=(execution_expires_at IS NULL)),
 CHECK(reserved_micro_usd+settled_micro_usd<=hard_cap_micro_usd),
 CHECK(unknown_reserved_micro_usd<=reserved_micro_usd),
 CHECK(COALESCE(profile->>'config_digest'=config_digest AND profile->>'provider'='voyage'
   AND profile->>'model'='voyage-4-large' AND profile->>'dimensions'='1024'
   AND profile->>'input_type'='document' AND profile->'truncation'='false'::jsonb
   AND profile->>'chunk_policy_version'='corpus-text-chunks-v1'
   AND profile->>'rate_micro_usd_per_million_tokens'='120000',false))
);
CREATE UNIQUE INDEX uq_workspace_embedding_active ON signal_workspace_embedding_runs(workspace_id,config_digest)
 WHERE status IN('queued','running');
CREATE INDEX idx_workspace_embedding_recent ON signal_workspace_embedding_runs(workspace_id,created_at DESC,id DESC);
CREATE INDEX idx_workspace_embedding_dispatch ON signal_workspace_embedding_runs(available_at,created_at,id)
 WHERE status IN('queued','running');

CREATE TABLE signal_workspace_embedding_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 run_id uuid NOT NULL,
 config_digest text NOT NULL CHECK(config_digest~'^sha256:[0-9a-f]{64}$'),
 batch_digest text NOT NULL CHECK(batch_digest~'^sha256:[0-9a-f]{64}$'),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 input_keys text[] NOT NULL,
 batch jsonb NOT NULL CHECK(jsonb_typeof(batch)='object' AND octet_length(batch::text)<=262144),
 attempt_token uuid NOT NULL DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','in_flight','response_persisted','settled','definitely_not_sent','outcome_unknown')),
 tokens_upper bigint NOT NULL CHECK(tokens_upper>0 AND tokens_upper<=120000),
 reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),
 observed_tokens bigint CHECK(observed_tokens>=0),
 observed_micro_usd bigint CHECK(observed_micro_usd>=0),
 settled_micro_usd bigint CHECK(settled_micro_usd>=0),
 response_body_private text CHECK(response_body_private IS NULL OR octet_length(response_body_private)<=8388608),
 response_digest text CHECK(response_digest IS NULL OR response_digest~'^sha256:[0-9a-f]{64}$'),
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 provider_request_id text CHECK(provider_request_id IS NULL OR octet_length(provider_request_id)<=1024),
 error_code text,
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,response_at timestamptz,settled_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_workspace_embedding_runs(workspace_id,id) ON DELETE RESTRICT,
 CHECK(cardinality(input_keys) BETWEEN 1 AND 128 AND array_position(input_keys,NULL) IS NULL),
 CONSTRAINT workspace_embedding_call_reservation_bound CHECK(reserved_micro_usd=(tokens_upper*12+99)/100),
 CHECK((response_body_private IS NULL)=(response_digest IS NULL)),
 CHECK(response_digest IS NULL OR response_digest='sha256:'||encode(sha256(convert_to(response_body_private,'UTF8')),'hex')),
 CHECK((status='settled')=(settled_micro_usd IS NOT NULL)),
 CHECK(settled_micro_usd IS NULL OR settled_micro_usd<=reserved_micro_usd),
 CHECK(status<>'settled' OR observed_tokens IS NOT NULL AND observed_micro_usd=settled_micro_usd AND settled_at IS NOT NULL),
 CHECK(status NOT IN('response_persisted','settled') OR response_body_private IS NOT NULL)
);
CREATE INDEX idx_workspace_embedding_calls_run ON signal_workspace_embedding_calls(run_id,reserved_at,id);
CREATE INDEX idx_workspace_embedding_calls_overlap ON signal_workspace_embedding_calls USING gin(input_keys);
CREATE INDEX idx_workspace_embedding_calls_scope ON signal_workspace_embedding_calls(workspace_id,config_digest,status);

CREATE TABLE signal_workspace_chunk_embeddings (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 config_digest text NOT NULL CHECK(config_digest~'^sha256:[0-9a-f]{64}$'),
 chunk_sha256 text NOT NULL CHECK(chunk_sha256~'^sha256:[0-9a-f]{64}$'),
 call_id uuid NOT NULL,
 response_index integer NOT NULL CHECK(response_index BETWEEN 0 AND 127),
 embedding vector(1024) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,config_digest,chunk_sha256),
 FOREIGN KEY(workspace_id,call_id) REFERENCES signal_workspace_embedding_calls(workspace_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION guard_signal_workspace_embedding_run_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Embedding execution history is retained.' USING ERRCODE='55000'; END IF;
 IF NOT OLD.request_keys <@ NEW.request_keys THEN
  RAISE EXCEPTION 'Embedding request keys are append-only.' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['request_keys','status','counts','cursor_asset_sha256','cursor_chunk_index','execution_token','execution_expires_at',
  'dispatch_generation','worker_job_id','dispatch_status','dispatch_token','dispatch_expires_at','dispatch_attempts','available_at',
  'reserved_micro_usd','settled_micro_usd','unknown_reserved_micro_usd','observed_exception_micro_usd','error_code','updated_at','completed_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['request_keys','status','counts','cursor_asset_sha256','cursor_chunk_index','execution_token','execution_expires_at',
  'dispatch_generation','worker_job_id','dispatch_status','dispatch_token','dispatch_expires_at','dispatch_attempts','available_at',
  'reserved_micro_usd','settled_micro_usd','unknown_reserved_micro_usd','observed_exception_micro_usd','error_code','updated_at','completed_at']) THEN
  RAISE EXCEPTION 'Embedding input and budget seal is immutable.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='completed' AND (NEW.status<>'completed' OR NEW.counts IS DISTINCT FROM OLD.counts
  OR NEW.cursor_asset_sha256 IS DISTINCT FROM OLD.cursor_asset_sha256 OR NEW.cursor_chunk_index IS DISTINCT FROM OLD.cursor_chunk_index) THEN
  RAISE EXCEPTION 'Completed embedding execution is immutable.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_embedding_run_guard BEFORE UPDATE OR DELETE ON signal_workspace_embedding_runs
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_embedding_run_v1();

CREATE FUNCTION guard_signal_workspace_embedding_call_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_run signal_workspace_embedding_runs%ROWTYPE;
DECLARE old_reserved bigint:=0; DECLARE new_reserved bigint:=0;
DECLARE old_settled bigint:=0; DECLARE new_settled bigint:=0;
DECLARE old_unknown bigint:=0; DECLARE new_unknown bigint:=0;
DECLARE old_exception bigint:=0; DECLARE new_exception bigint:=0;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Embedding cost evidence is retained.' USING ERRCODE='55000'; END IF;
 SELECT * INTO owner_run FROM signal_workspace_embedding_runs WHERE id=NEW.run_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF owner_run.id IS NULL OR owner_run.config_digest<>NEW.config_digest THEN RAISE EXCEPTION 'Embedding call scope is invalid.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'reserved' OR owner_run.status<>'running') THEN
  RAISE EXCEPTION 'A new provider attempt must reserve a running execution.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','observed_tokens','observed_micro_usd','settled_micro_usd','response_body_private','response_digest',
   'http_status','provider_request_id','error_code','sent_at','response_at','settled_at','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','observed_tokens','observed_micro_usd','settled_micro_usd','response_body_private','response_digest',
   'http_status','provider_request_id','error_code','sent_at','response_at','settled_at','updated_at']) THEN
   RAISE EXCEPTION 'Embedding request and reservation are immutable.' USING ERRCODE='23514'; END IF;
  IF OLD.status IN('settled','definitely_not_sent') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Embedding terminal monetary evidence is immutable.' USING ERRCODE='23514'; END IF;
  IF OLD.response_digest IS NOT NULL AND (NEW.response_digest IS DISTINCT FROM OLD.response_digest OR NEW.response_body_private IS DISTINCT FROM OLD.response_body_private) THEN
   RAISE EXCEPTION 'Embedding provider receipt is immutable.' USING ERRCODE='23514'; END IF;
  IF NOT(NEW.status=OLD.status OR OLD.status='reserved' AND NEW.status IN('in_flight','definitely_not_sent')
   OR OLD.status='in_flight' AND NEW.status IN('response_persisted','definitely_not_sent','outcome_unknown')
   OR OLD.status='response_persisted' AND NEW.status IN('settled','outcome_unknown')
   OR OLD.status='outcome_unknown' AND NEW.status='response_persisted') THEN
   RAISE EXCEPTION 'Embedding call transition is invalid.' USING ERRCODE='23514'; END IF;
  old_reserved:=CASE WHEN OLD.status NOT IN('settled','definitely_not_sent') THEN OLD.reserved_micro_usd ELSE 0 END;
  old_settled:=COALESCE(OLD.settled_micro_usd,0);
  old_unknown:=CASE WHEN OLD.status='outcome_unknown' THEN OLD.reserved_micro_usd ELSE 0 END;
  old_exception:=CASE WHEN OLD.observed_micro_usd>OLD.reserved_micro_usd THEN OLD.observed_micro_usd ELSE 0 END;
 END IF;
 new_reserved:=CASE WHEN NEW.status NOT IN('settled','definitely_not_sent') THEN NEW.reserved_micro_usd ELSE 0 END;
 new_settled:=COALESCE(NEW.settled_micro_usd,0);
 new_unknown:=CASE WHEN NEW.status='outcome_unknown' THEN NEW.reserved_micro_usd ELSE 0 END;
 new_exception:=CASE WHEN NEW.observed_micro_usd>NEW.reserved_micro_usd THEN NEW.observed_micro_usd ELSE 0 END;
 UPDATE signal_workspace_embedding_runs SET reserved_micro_usd=reserved_micro_usd+new_reserved-old_reserved,
  settled_micro_usd=settled_micro_usd+new_settled-old_settled,unknown_reserved_micro_usd=unknown_reserved_micro_usd+new_unknown-old_unknown,
  observed_exception_micro_usd=observed_exception_micro_usd+new_exception-old_exception,updated_at=clock_timestamp() WHERE id=NEW.run_id;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_embedding_call_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_workspace_embedding_calls
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_embedding_call_v1();

CREATE FUNCTION guard_signal_workspace_chunk_embedding_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence signal_workspace_embedding_calls%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Embedding vectors are immutable.' USING ERRCODE='55000'; END IF;
 SELECT * INTO evidence FROM signal_workspace_embedding_calls WHERE id=NEW.call_id AND workspace_id=NEW.workspace_id;
 IF evidence.id IS NULL OR evidence.config_digest<>NEW.config_digest OR evidence.status<>'settled'
  OR evidence.input_keys[NEW.response_index+1] IS DISTINCT FROM NEW.chunk_sha256 THEN
  RAISE EXCEPTION 'Embedding vector does not match settled response identity.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_workspace_chunk_embedding_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_workspace_chunk_embeddings
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_chunk_embedding_v1();

ALTER TABLE signal_workspace_embedding_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_workspace_embedding_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_workspace_chunk_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_workspace_embedding_runs,signal_workspace_embedding_calls,signal_workspace_chunk_embeddings FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_signal_workspace_embedding_run_v1(),guard_signal_workspace_embedding_call_v1(),guard_signal_workspace_chunk_embedding_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_workspace_embedding_runs,signal_workspace_embedding_calls,signal_workspace_chunk_embeddings FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION guard_signal_workspace_embedding_run_v1(),guard_signal_workspace_embedding_call_v1(),guard_signal_workspace_chunk_embedding_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
