-- Backend 09 follow-up: durable, workspace-owned asynchronous CSV ingestion.
-- Incomplete imports are auditable provenance but never serving authority.

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS ingestion_phase text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_object_key text,
  ADD COLUMN IF NOT EXISTS upload_protocol text,
  ADD COLUMN IF NOT EXISTS expected_file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS processed_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_record_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_detail jsonb,
  ADD COLUMN IF NOT EXISTS worker_job_id text,
  ADD COLUMN IF NOT EXISTS supersedes_import_batch_id uuid
    REFERENCES import_batches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE source_sync_runs
  ADD COLUMN IF NOT EXISTS import_batch_id uuid
    REFERENCES import_batches(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_sync_runs_import_batch
  ON source_sync_runs(import_batch_id) WHERE import_batch_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_async_state;
  ALTER TABLE import_batches ADD CONSTRAINT import_batches_async_state CHECK (
    ingestion_phase='legacy'
    OR (
      status IN ('queued','processing','completed','failed')
      AND ingestion_phase IN ('uploading','queued','processing','completed','failed')
      AND processed_bytes >= 0 AND progress_record_count >= 0
      AND (expected_file_size_bytes IS NULL OR expected_file_size_bytes > 0)
      AND upload_protocol IN ('server-stream','supabase-tus')
      AND (
        (
          status <> 'completed'
          OR (
            record_count IS NOT NULL AND included_count IS NOT NULL
            AND excluded_count IS NOT NULL AND duplicate_count IS NOT NULL
            AND record_count = included_count + excluded_count + duplicate_count
            AND source_file_hash ~ '^[0-9a-f]{64}$'
            AND completed_at IS NOT NULL
          )
        )
        AND (
          status = 'completed'
          OR (COALESCE(record_count,0)=0 AND COALESCE(included_count,0)=0
              AND COALESCE(excluded_count,0)=0 AND COALESCE(duplicate_count,0)=0)
        )
      )
    )
  );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_completed_content
  ON import_batches(workspace_id,data_source_id,source_file_hash)
  WHERE status='completed' AND source_file_hash IS NOT NULL
    AND ingestion_phase<>'legacy';
CREATE INDEX IF NOT EXISTS idx_import_batches_async_poll
  ON import_batches(workspace_id,data_source_id,updated_at DESC)
  WHERE ingestion_phase <> 'legacy';
CREATE INDEX IF NOT EXISTS idx_import_batches_supersedes
  ON import_batches(supersedes_import_batch_id)
  WHERE supersedes_import_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_workspace_import_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  import_batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','dispatching','dispatched','completed','failed','dead_letter')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  worker_job_id text NOT NULL,
  error_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(import_batch_id),
  UNIQUE(worker_job_id)
);
CREATE INDEX IF NOT EXISTS idx_signal_workspace_import_outbox_claim
  ON signal_workspace_import_outbox(status,available_at,created_at)
  WHERE status IN ('pending','failed','dispatching');

CREATE TABLE IF NOT EXISTS signal_workspace_import_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  import_batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
  outbox_id uuid REFERENCES signal_workspace_import_outbox(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'upload-created','upload-completed','queued','dispatching','dispatched',
    'processing','progress','completed','failed','retry-created','dead-letter'
  )),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signal_workspace_import_events_batch
  ON signal_workspace_import_events(import_batch_id,created_at,id);

CREATE OR REPLACE FUNCTION protect_signal_workspace_import_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Workspace import events are append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS trg_protect_signal_workspace_import_event
  ON signal_workspace_import_events;
CREATE TRIGGER trg_protect_signal_workspace_import_event
  BEFORE UPDATE OR DELETE ON signal_workspace_import_events
  FOR EACH ROW EXECUTE FUNCTION protect_signal_workspace_import_event_v1();

CREATE OR REPLACE FUNCTION signal_mention_has_accepted_import_v1(
  target_workspace_id uuid,
  target_mention_id uuid
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM signal_mention_import_memberships membership
    JOIN import_batches batch
      ON batch.id=membership.import_batch_id
     AND batch.workspace_id=membership.workspace_id
     AND batch.status='completed'
    WHERE membership.workspace_id=target_workspace_id
      AND membership.mention_id=target_mention_id
  );
$$;

CREATE OR REPLACE FUNCTION signal_mention_has_only_incomplete_imports_v1(
  target_workspace_id uuid,
  target_mention_id uuid
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM signal_mention_import_memberships membership
    WHERE membership.workspace_id=target_workspace_id
      AND membership.mention_id=target_mention_id
  ) AND NOT signal_mention_has_accepted_import_v1(
    target_workspace_id,target_mention_id
  );
$$;

CREATE OR REPLACE FUNCTION enforce_signal_population_accepted_import_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.membership_status='included'
     AND signal_mention_has_only_incomplete_imports_v1(
       NEW.workspace_id,NEW.mention_id
     ) THEN
    NEW.membership_status := 'excluded';
    NEW.membership_reason := 'import_batch_not_accepted_v1';
    NEW.removed_at := now();
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_signal_population_accepted_import
  ON signal_population_memberships;
CREATE TRIGGER trg_signal_population_accepted_import
  BEFORE INSERT OR UPDATE OF membership_status,removed_at
  ON signal_population_memberships FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_population_accepted_import_v1();

CREATE OR REPLACE FUNCTION enforce_signal_semantic_assertion_accepted_import_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attribution_basis='mention_semantic'
     AND NEW.is_current
     AND NEW.review_status='approved'
     AND NEW.eligibility_status='eligible'
     AND signal_mention_has_only_incomplete_imports_v1(
       NEW.workspace_id,NEW.mention_id
     ) THEN
    RAISE EXCEPTION 'Semantic approval requires accepted import provenance.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_signal_semantic_assertion_accepted_import
  ON signal_mention_attributions;
CREATE TRIGGER trg_signal_semantic_assertion_accepted_import
  BEFORE INSERT OR UPDATE OF attribution_basis,is_current,review_status,
    eligibility_status,workspace_id,mention_id
  ON signal_mention_attributions FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_semantic_assertion_accepted_import_v1();

CREATE OR REPLACE FUNCTION enforce_signal_workspace_import_batch_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior import_batches%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.supersedes_import_batch_id IS NOT NULL THEN
      SELECT * INTO prior FROM import_batches
      WHERE id=NEW.supersedes_import_batch_id FOR SHARE;
      IF prior.id IS NULL OR prior.workspace_id IS DISTINCT FROM NEW.workspace_id
         OR prior.data_source_id IS DISTINCT FROM NEW.data_source_id
         OR prior.status<>'failed' THEN
        RAISE EXCEPTION 'Import recovery must supersede a failed batch in the same workspace source.'
          USING ERRCODE='23514';
      END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.data_source_id IS DISTINCT FROM NEW.data_source_id
     OR OLD.imported_by_user_id IS DISTINCT FROM NEW.imported_by_user_id
     OR OLD.product_idempotency_key IS DISTINCT FROM NEW.product_idempotency_key
     OR OLD.product_request_digest IS DISTINCT FROM NEW.product_request_digest
     OR OLD.supersedes_import_batch_id IS DISTINCT FROM NEW.supersedes_import_batch_id
     OR OLD.storage_bucket IS DISTINCT FROM NEW.storage_bucket
     OR OLD.storage_object_key IS DISTINCT FROM NEW.storage_object_key THEN
    RAISE EXCEPTION 'Workspace import identity is immutable.' USING ERRCODE='55000';
  END IF;
  IF OLD.status='completed' AND NEW.status<>'completed'
     OR OLD.status='failed' AND NEW.status<>'failed'
     OR OLD.status='queued' AND NEW.status NOT IN ('queued','processing','failed')
     OR OLD.status='processing' AND NEW.status NOT IN ('processing','completed','failed') THEN
    RAISE EXCEPTION 'Workspace import status transition is invalid.' USING ERRCODE='23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_enforce_signal_workspace_import_batch
  ON import_batches;
CREATE TRIGGER trg_enforce_signal_workspace_import_batch
  BEFORE INSERT OR UPDATE ON import_batches FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_workspace_import_batch_v1();

CREATE OR REPLACE FUNCTION refresh_signal_semantic_candidate_membership_digest(
  target_population_id uuid
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE computed_digest text;
BEGIN
  IF current_setting('noisia.import_bulk_reconcile',true)='on' THEN
    SELECT membership_digest INTO computed_digest
    FROM signal_population_definitions WHERE id=target_population_id;
    RETURN computed_digest;
  END IF;
  SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
    membership.mention_id::text,',' ORDER BY membership.mention_id
  ),''),'UTF8')),'hex') INTO computed_digest
  FROM signal_population_memberships membership
  WHERE membership.population_id=target_population_id
    AND membership.membership_status='included' AND membership.removed_at IS NULL;
  UPDATE signal_population_definitions
  SET membership_digest=computed_digest,updated_at=now()
  WHERE id=target_population_id AND purpose='operational' AND status='draft'
    AND definition->>'contract_version'='signal-operational-primary-brand-semantic-v2';
  RETURN computed_digest;
END; $$;

CREATE OR REPLACE FUNCTION refresh_signal_attributable_semantic_base_digest_v1(
  target_population_id uuid
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE computed_digest text;
BEGIN
  IF current_setting('noisia.import_bulk_reconcile',true)='on' THEN
    SELECT membership_digest INTO computed_digest
    FROM signal_population_definitions WHERE id=target_population_id;
    RETURN computed_digest;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM signal_population_definitions population
    WHERE population.id=target_population_id AND population.status='draft'
      AND population.definition->>'contract_version'='signal-operational-attributable-semantic-v1') THEN
    RAISE EXCEPTION 'Attributable semantic base is unavailable.' USING ERRCODE='23514';
  END IF;
  SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
    membership.mention_id::text,',' ORDER BY membership.mention_id
  ) FILTER (WHERE membership.membership_status='included'
      AND membership.removed_at IS NULL),''),'UTF8')),'hex') INTO computed_digest
  FROM signal_population_memberships membership
  WHERE membership.population_id=target_population_id;
  UPDATE signal_population_definitions SET membership_digest=computed_digest,updated_at=now()
  WHERE id=target_population_id;
  RETURN computed_digest;
END; $$;

CREATE OR REPLACE FUNCTION refresh_signal_operational_bridge_after_membership_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_workspace_id uuid;
BEGIN
  IF current_setting('noisia.import_bulk_reconcile',true)='on' THEN
    RETURN COALESCE(NEW,OLD);
  END IF;
  affected_workspace_id:=COALESCE(NEW.workspace_id,OLD.workspace_id);
  IF EXISTS (SELECT 1 FROM signal_workspace_population_pointers pointer
    WHERE pointer.workspace_id=affected_workspace_id AND pointer.purpose='operational'
      AND pointer.population_id=COALESCE(NEW.population_id,OLD.population_id)) THEN
    PERFORM refresh_signal_operational_bridge_membership_digest_v1(affected_workspace_id);
  END IF;
  RETURN COALESCE(NEW,OLD);
END; $$;

CREATE OR REPLACE FUNCTION invalidate_signal_data_governance_from_row()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_workspace uuid;
DECLARE mention_id uuid;
DECLARE population_id uuid;
DECLARE reason_code text;
DECLARE object_kind text;
DECLARE identity text;
DECLARE target_batch_status text;
BEGIN
  IF current_setting('noisia.import_bulk_reconcile',true)='on' THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME='signal_mention_import_memberships' AND TG_OP<>'DELETE' THEN
    SELECT status INTO target_batch_status FROM import_batches
    WHERE id=NEW.import_batch_id;
    IF target_batch_status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN target_workspace:=OLD.workspace_id; ELSE target_workspace:=NEW.workspace_id; END IF;
  IF TG_TABLE_NAME='mentions' THEN
    mention_id:=CASE WHEN TG_OP='DELETE' THEN OLD.canonical_mention_id ELSE NEW.canonical_mention_id END;
    reason_code:=CASE WHEN NEW.canonical_mention_id IS DISTINCT FROM OLD.canonical_mention_id
      THEN 'canonical-identity-changed' ELSE 'quality-state-changed' END;
    object_kind:='mention';identity:=CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME='signal_mention_attributions' THEN
    mention_id:=CASE WHEN TG_OP='DELETE' THEN OLD.mention_id ELSE NEW.mention_id END;
    reason_code:='semantic-assertion-changed';object_kind:='attribution';
    identity:=CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME='signal_mention_import_memberships' THEN
    mention_id:=CASE WHEN TG_OP='DELETE' THEN OLD.mention_id ELSE NEW.mention_id END;
    reason_code:='provenance-changed';object_kind:='membership';
    identity:=CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSIF TG_TABLE_NAME='signal_population_memberships' THEN
    mention_id:=CASE WHEN TG_OP='DELETE' THEN OLD.mention_id ELSE NEW.mention_id END;
    population_id:=CASE WHEN TG_OP='DELETE' THEN OLD.population_id ELSE NEW.population_id END;
    reason_code:='population-membership-changed';object_kind:='membership';
    identity:=CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  ELSE
    reason_code:='watermark-changed';object_kind:='watermark';
    identity:=CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  END IF;
  PERFORM invalidate_signal_data_governance_compilations(
    target_workspace,reason_code,object_kind,identity,mention_id,population_id
  );
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE OR REPLACE FUNCTION reconcile_signal_workspace_import_completion_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root record;
DECLARE population record;
BEGIN
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM set_config('noisia.import_bulk_reconcile','on',true);
    FOR root IN
      SELECT DISTINCT membership.mention_id
      FROM signal_mention_import_memberships membership
      WHERE membership.import_batch_id=NEW.id
      ORDER BY membership.mention_id
    LOOP
      PERFORM reconcile_signal_operational_population_mention(NEW.workspace_id,root.mention_id);
      PERFORM reconcile_signal_semantic_candidate_population_mention(NEW.workspace_id,root.mention_id);
      PERFORM reconcile_signal_attributable_semantic_base_mention_v1(
        NEW.workspace_id,root.mention_id,false
      );
    END LOOP;
    PERFORM set_config('noisia.import_bulk_reconcile','off',true);
    PERFORM refresh_signal_operational_bridge_membership_digest_v1(NEW.workspace_id);
    FOR population IN SELECT id,definition->>'contract_version' AS contract_version
      FROM signal_population_definitions
      WHERE workspace_id=NEW.workspace_id AND status='draft'
        AND definition->>'contract_version' IN (
          'signal-operational-primary-brand-semantic-v2',
          'signal-operational-attributable-semantic-v1'
        )
    LOOP
      IF population.contract_version='signal-operational-primary-brand-semantic-v2' THEN
        PERFORM refresh_signal_semantic_candidate_membership_digest(population.id);
      ELSE
        PERFORM refresh_signal_attributable_semantic_base_digest_v1(population.id);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_signal_workspace_import_completion_reconcile ON import_batches;
CREATE TRIGGER trg_signal_workspace_import_completion_reconcile
  AFTER UPDATE OF status ON import_batches FOR EACH ROW
  EXECUTE FUNCTION reconcile_signal_workspace_import_completion_v1();

CREATE OR REPLACE FUNCTION enqueue_signal_workspace_import_v1(
  target_import_batch_id uuid,
  target_actor_user_id uuid
)
RETURNS TABLE(outbox_id uuid,worker_job_id text,created boolean)
LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;
DECLARE persisted signal_workspace_import_outbox%ROWTYPE;
BEGIN
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR UPDATE;
  IF target.id IS NULL OR target.status<>'queued'
     OR target.ingestion_phase NOT IN ('uploading','queued')
     OR target.storage_bucket IS NULL OR target.storage_object_key IS NULL THEN
    RAISE EXCEPTION 'Workspace import is not ready to queue.' USING ERRCODE='23514';
  END IF;
  IF NOT signal_data_governance_actor_is_valid(
    target.workspace_id,target_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Workspace import actor is unauthorized.' USING ERRCODE='42501';
  END IF;
  INSERT INTO signal_workspace_import_outbox(
    workspace_id,import_batch_id,worker_job_id
  ) VALUES(target.workspace_id,target.id,'signal-import-'||target.id::text)
  ON CONFLICT(import_batch_id) DO NOTHING RETURNING * INTO persisted;
  created:=persisted.id IS NOT NULL;
  IF NOT created THEN SELECT * INTO persisted FROM signal_workspace_import_outbox
    WHERE import_batch_id=target.id; END IF;
  UPDATE import_batches SET ingestion_phase='queued',worker_job_id=persisted.worker_job_id
  WHERE id=target.id;
  IF created THEN
    INSERT INTO signal_workspace_import_events(
      workspace_id,import_batch_id,outbox_id,event_type,actor_user_id
    ) VALUES(target.workspace_id,target.id,persisted.id,'queued',target_actor_user_id);
  END IF;
  RETURN QUERY SELECT persisted.id,persisted.worker_job_id,created;
END; $$;

CREATE OR REPLACE FUNCTION claim_signal_workspace_import_dispatch_v1(
  target_limit integer,
  target_lease_seconds integer,
  target_max_attempts integer
)
RETURNS TABLE(
  outbox_id uuid,lease_token uuid,import_batch_id uuid,workspace_id uuid,
  worker_job_id text,storage_bucket text,storage_object_key text,
  source_file_name text,data_source_id uuid,study_corpus_id uuid,entity_label text
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY WITH claimed AS (
    SELECT outbox.id FROM signal_workspace_import_outbox outbox
    JOIN import_batches batch ON batch.id=outbox.import_batch_id
    WHERE (
      outbox.status IN ('pending','failed') AND outbox.available_at<=now()
      OR outbox.status='dispatching' AND outbox.lease_expires_at<now()
    ) AND outbox.attempt_count<target_max_attempts
      AND batch.status='queued'
    ORDER BY outbox.available_at,outbox.created_at
    FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(target_limit,100))
  ), updated AS (
    UPDATE signal_workspace_import_outbox outbox
    SET status='dispatching',attempt_count=outbox.attempt_count+1,
      lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>target_lease_seconds),
      updated_at=now()
    FROM claimed WHERE outbox.id=claimed.id RETURNING outbox.*
  )
  SELECT updated.id,updated.lease_token,batch.id,batch.workspace_id,
    updated.worker_job_id,batch.storage_bucket,batch.storage_object_key,
    batch.source_file_name,batch.data_source_id,batch.contributed_by_study_corpus_id,
    batch.entity_label
  FROM updated JOIN import_batches batch ON batch.id=updated.import_batch_id
  WHERE batch.status='queued';
END; $$;

CREATE OR REPLACE FUNCTION complete_signal_workspace_import_dispatch_v1(
  target_outbox_id uuid,target_lease_token uuid
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_workspace_import_outbox SET status='dispatched',lease_token=NULL,
    lease_expires_at=NULL,error_summary=NULL,updated_at=now()
  WHERE id=target_outbox_id AND status='dispatching' AND lease_token=target_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace import dispatch lease is stale.' USING ERRCODE='40001'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION fail_signal_workspace_import_dispatch_v1(
  target_outbox_id uuid,target_lease_token uuid,target_retry_at timestamptz,
  target_error jsonb,target_max_attempts integer
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_workspace_import_outbox
  SET status=CASE WHEN attempt_count>=target_max_attempts THEN 'dead_letter' ELSE 'failed' END,
    available_at=target_retry_at,lease_token=NULL,lease_expires_at=NULL,
    error_summary=target_error,updated_at=now()
  WHERE id=target_outbox_id AND status='dispatching' AND lease_token=target_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace import dispatch lease is stale.' USING ERRCODE='40001'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION begin_signal_workspace_import_processing_v1(
  target_import_batch_id uuid,target_worker_job_id text
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;
BEGIN
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR UPDATE;
  IF target.id IS NULL OR target.worker_job_id IS DISTINCT FROM target_worker_job_id THEN
    RAISE EXCEPTION 'Workspace import job identity is invalid.' USING ERRCODE='23514';
  END IF;
  IF target.status='completed' THEN RETURN false; END IF;
  IF target.status='processing' THEN
    INSERT INTO signal_workspace_import_events(workspace_id,import_batch_id,event_type,detail)
    VALUES(target.workspace_id,target.id,'processing',
      jsonb_build_object('job',target_worker_job_id,'resumed',true));
    RETURN true;
  END IF;
  IF target.status<>'queued' THEN
    RAISE EXCEPTION 'Workspace import is not queued.' USING ERRCODE='23514';
  END IF;
  UPDATE import_batches SET status='processing',ingestion_phase='processing',
    processing_started_at=COALESCE(processing_started_at,now()),failure_code=NULL,failure_detail=NULL
  WHERE id=target.id;
  INSERT INTO signal_workspace_import_events(workspace_id,import_batch_id,event_type,detail)
  VALUES(target.workspace_id,target.id,'processing',jsonb_build_object('job',target_worker_job_id));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION record_signal_workspace_import_progress_v1(
  target_import_batch_id uuid,target_worker_job_id text,
  target_records integer,target_bytes bigint
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE target_workspace_id uuid;
BEGIN
  UPDATE import_batches SET progress_record_count=greatest(progress_record_count,target_records),
    processed_bytes=greatest(processed_bytes,target_bytes)
  WHERE id=target_import_batch_id AND status='processing'
    AND worker_job_id=target_worker_job_id RETURNING workspace_id INTO target_workspace_id;
  IF target_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace import progress job is stale.' USING ERRCODE='40001';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION complete_signal_workspace_import_v1(
  target_import_batch_id uuid,target_worker_job_id text,target_file_hash text,
  target_record_count integer,target_included_count integer,
  target_excluded_count integer,target_duplicate_count integer,target_processed_bytes bigint
)
RETURNS TABLE(import_batch_id uuid,accepted boolean,accepted_batch_id uuid)
LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;
DECLARE duplicate_batch_id uuid;
DECLARE accepted_record record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-import:'||target_import_batch_id::text,0));
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR UPDATE;
  IF target.id IS NULL OR target.worker_job_id IS DISTINCT FROM target_worker_job_id THEN
    RAISE EXCEPTION 'Workspace import completion job is invalid.' USING ERRCODE='23514';
  END IF;
  IF target.status='completed' THEN
    RETURN QUERY SELECT target.id,true,target.id;RETURN;
  END IF;
  IF target.status<>'processing' OR target_file_hash !~ '^[0-9a-f]{64}$'
     OR target_record_count<>target_included_count+target_excluded_count+target_duplicate_count
     OR least(target_record_count,target_included_count,target_excluded_count,target_duplicate_count)<0 THEN
    RAISE EXCEPTION 'Workspace import final counters or hash are invalid.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'workspace-import-content',target.workspace_id::text,target.data_source_id::text,target_file_hash
  ),0));
  SELECT id INTO duplicate_batch_id FROM import_batches
  WHERE workspace_id=target.workspace_id AND data_source_id=target.data_source_id
    AND source_file_hash=target_file_hash AND status='completed' AND id<>target.id
  ORDER BY completed_at,id LIMIT 1;
  IF duplicate_batch_id IS NOT NULL THEN
    UPDATE import_batches SET status='failed',ingestion_phase='failed',failed_at=now(),
      failure_code='content_already_accepted',
      failure_detail=jsonb_build_object('accepted_batch_id',duplicate_batch_id),
      processed_bytes=target_processed_bytes,progress_record_count=target_record_count
    WHERE id=target.id;
    UPDATE signal_workspace_import_outbox outbox
    SET status='failed',completed_at=now(),updated_at=now()
    WHERE outbox.import_batch_id=target.id;
    RETURN QUERY SELECT target.id,false,duplicate_batch_id;RETURN;
  END IF;
  UPDATE import_batches SET record_count=target_record_count,
    included_count=target_included_count,excluded_count=target_excluded_count,
    duplicate_count=target_duplicate_count,source_file_hash=target_file_hash,
    processed_bytes=target_processed_bytes,progress_record_count=target_record_count,
    status='completed',ingestion_phase='completed',completed_at=now()
  WHERE id=target.id;
  INSERT INTO source_sync_runs(
    workspace_id,data_source_id,import_batch_id,finished_at,status,
    records_total,records_valid,records_duplicate,records_failed,error_summary,
    coverage_start,coverage_end
  ) SELECT target.workspace_id,target.data_source_id,target.id,now(),'completed',
    target_record_count,target_included_count+target_excluded_count,target_duplicate_count,0,'{}'::jsonb,
    min((mention.published_at AT TIME ZONE workspace.timezone)::date),
    max((mention.published_at AT TIME ZONE workspace.timezone)::date)
  FROM signal_workspaces workspace
  LEFT JOIN signal_mention_import_memberships membership ON membership.import_batch_id=target.id
  LEFT JOIN mentions mention ON mention.id=membership.mention_id
  WHERE workspace.id=target.workspace_id
    AND NOT EXISTS (SELECT 1 FROM source_sync_runs prior
      WHERE prior.import_batch_id=target.id)
  GROUP BY workspace.id;
  SELECT * INTO accepted_record FROM record_signal_workspace_data_acceptance_v2(
    target.workspace_id,'source-'||target.data_source_id::text,target.data_source_id,target.id,now(),now()
  );
  UPDATE signal_workspace_import_outbox outbox SET status='completed',completed_at=now(),
    lease_token=NULL,lease_expires_at=NULL,error_summary=NULL,updated_at=now()
  WHERE outbox.import_batch_id=target.id;
  INSERT INTO signal_workspace_import_events(workspace_id,import_batch_id,event_type,detail)
  VALUES(target.workspace_id,target.id,'completed',jsonb_build_object(
    'records',target_record_count,'included',target_included_count,
    'excluded',target_excluded_count,'duplicates',target_duplicate_count
  ));
  RETURN QUERY SELECT target.id,true,target.id;
END; $$;

CREATE OR REPLACE FUNCTION fail_signal_workspace_import_v1(
  target_import_batch_id uuid,target_worker_job_id text,
  target_failure_code text,target_failure_detail jsonb,
  target_progress_records integer,target_processed_bytes bigint
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE target_workspace_id uuid;
BEGIN
  UPDATE import_batches SET status='failed',ingestion_phase='failed',failed_at=now(),
    failure_code=left(target_failure_code,120),failure_detail=target_failure_detail,
    progress_record_count=greatest(progress_record_count,target_progress_records),
    processed_bytes=greatest(processed_bytes,target_processed_bytes)
  WHERE id=target_import_batch_id AND status IN ('queued','processing')
    AND worker_job_id=target_worker_job_id RETURNING workspace_id INTO target_workspace_id;
  IF target_workspace_id IS NULL THEN RETURN; END IF;
  UPDATE signal_workspace_import_outbox SET status='failed',completed_at=now(),
    error_summary=target_failure_detail,updated_at=now()
  WHERE import_batch_id=target_import_batch_id;
  INSERT INTO signal_workspace_import_events(workspace_id,import_batch_id,event_type,detail)
  VALUES(target_workspace_id,target_import_batch_id,'failed',
    jsonb_build_object('code',left(target_failure_code,120)));
END; $$;

-- Repair derived state already contaminated by unfinished imports. The failed
-- batch and all provenance rows remain intact for audit and recovery. Per-row
-- digest/invalidation triggers are deferred; exactly one workspace-scoped
-- invalidation is emitted for each workspace whose derived membership actually
-- changed. Reapplying the migration therefore performs no second data write.
DO $$ DECLARE workspace record;DECLARE population record;BEGIN
  PERFORM set_config('noisia.import_bulk_reconcile','on',true);
  FOR workspace IN
    WITH quarantined AS (
      UPDATE signal_population_memberships membership
      SET membership_status='excluded',membership_reason='import_batch_not_accepted_v1',
        removed_at=now()
      WHERE membership.membership_status='included'
        AND membership.removed_at IS NULL
        AND signal_mention_has_only_incomplete_imports_v1(
          membership.workspace_id,membership.mention_id
        )
      RETURNING membership.workspace_id
    )
    SELECT DISTINCT quarantined.workspace_id FROM quarantined
  LOOP
    PERFORM invalidate_signal_data_governance_compilations(
      workspace.workspace_id,'provenance-changed','membership',
      'incomplete-import-quarantine-v1',NULL,NULL
    );
    PERFORM refresh_signal_operational_bridge_membership_digest_v1(workspace.workspace_id);
    FOR population IN SELECT id,definition->>'contract_version' AS contract_version
      FROM signal_population_definitions WHERE workspace_id=workspace.workspace_id
        AND status='draft' AND definition->>'contract_version' IN (
          'signal-operational-primary-brand-semantic-v2',
          'signal-operational-attributable-semantic-v1'
        )
    LOOP
      IF population.contract_version='signal-operational-primary-brand-semantic-v2' THEN
        PERFORM refresh_signal_semantic_candidate_membership_digest(population.id);
      ELSE
        PERFORM refresh_signal_attributable_semantic_base_digest_v1(population.id);
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('noisia.import_bulk_reconcile','off',true);
END $$;

COMMENT ON FUNCTION signal_mention_has_accepted_import_v1(uuid,uuid) IS
  'True only when a canonical root has at least one provenance route through a completed import batch.';
COMMENT ON TABLE signal_workspace_import_outbox IS
  'Durable dispatch authority for workspace-owned CSV ingestion; BullMQ is a delivery mechanism, not the source of truth.';
