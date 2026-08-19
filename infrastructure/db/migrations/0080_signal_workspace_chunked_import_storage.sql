-- Workspace-owned imports larger than the platform object limit remain one
-- logical batch while their durable bytes span deterministic private objects.

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS storage_part_count integer,
  ADD COLUMN IF NOT EXISTS storage_part_size_bytes bigint;

ALTER TABLE signal_mention_import_memberships
  ADD COLUMN IF NOT EXISTS ingestion_disposition text;
ALTER TABLE signal_mention_import_memberships
  DROP CONSTRAINT IF EXISTS signal_mention_import_ingestion_disposition;
ALTER TABLE signal_mention_import_memberships
  ADD CONSTRAINT signal_mention_import_ingestion_disposition CHECK (
    ingestion_disposition IS NULL
    OR ingestion_disposition IN ('included','excluded','duplicate')
  );

CREATE OR REPLACE FUNCTION protect_signal_import_ingestion_disposition_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ingestion_disposition IS NOT NULL
     AND OLD.ingestion_disposition IS DISTINCT FROM NEW.ingestion_disposition THEN
    RAISE EXCEPTION 'Import ingestion disposition is immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_protect_signal_import_ingestion_disposition
  ON signal_mention_import_memberships;
CREATE TRIGGER trg_protect_signal_import_ingestion_disposition
  BEFORE UPDATE OF ingestion_disposition ON signal_mention_import_memberships
  FOR EACH ROW EXECUTE FUNCTION protect_signal_import_ingestion_disposition_v1();

CREATE OR REPLACE FUNCTION record_signal_workspace_import_provenance_v1(
  target_mention_id uuid,target_import_batch_id uuid,target_disposition text
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE persisted_id uuid;DECLARE current_disposition text;BEGIN
  IF target_disposition NOT IN ('included','excluded','duplicate') THEN
    RAISE EXCEPTION 'Workspace import disposition is invalid.' USING ERRCODE='23514';
  END IF;
  PERFORM record_signal_mention_import_provenance(
    target_mention_id,target_import_batch_id
  );
  SELECT id,ingestion_disposition INTO persisted_id,current_disposition
  FROM signal_mention_import_memberships
  WHERE mention_id=target_mention_id AND import_batch_id=target_import_batch_id
  FOR UPDATE;
  IF persisted_id IS NULL THEN
    RAISE EXCEPTION 'Workspace import provenance was not persisted.' USING ERRCODE='23514';
  END IF;
  IF current_disposition IS NOT NULL AND current_disposition<>target_disposition THEN
    RAISE EXCEPTION 'Workspace import disposition conflicts with durable history.'
      USING ERRCODE='23514';
  END IF;
  UPDATE signal_mention_import_memberships
  SET ingestion_disposition=target_disposition
  WHERE id=persisted_id AND ingestion_disposition IS NULL;
  RETURN persisted_id;
END; $$;

ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_async_state;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_async_state CHECK (
  ingestion_phase='legacy'
  OR (
    status IN ('queued','processing','completed','failed')
    AND ingestion_phase IN ('uploading','queued','processing','completed','failed')
    AND processed_bytes>=0 AND progress_record_count>=0
    AND expected_file_size_bytes>0
    AND storage_part_count BETWEEN 1 AND 10000
    AND storage_part_size_bytes BETWEEN 1 AND 50331648
    AND expected_file_size_bytes<=(storage_part_count::bigint*storage_part_size_bytes)
    AND expected_file_size_bytes>((storage_part_count-1)::bigint*storage_part_size_bytes)
    AND upload_protocol IN ('server-stream','supabase-tus','supabase-multipart-tus')
    AND (
      status<>'completed'
      OR (
        record_count IS NOT NULL AND included_count IS NOT NULL
        AND excluded_count IS NOT NULL AND duplicate_count IS NOT NULL
        AND record_count=included_count+excluded_count+duplicate_count
        AND source_file_hash~'^[0-9a-f]{64}$'
        AND completed_at IS NOT NULL
        AND processed_bytes=expected_file_size_bytes
      )
    )
    AND (
      status='completed'
      OR (COALESCE(record_count,0)=0 AND COALESCE(included_count,0)=0
          AND COALESCE(excluded_count,0)=0 AND COALESCE(duplicate_count,0)=0)
    )
  )
);

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
    NEW.updated_at:=now();
    RETURN NEW;
  END IF;
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.data_source_id IS DISTINCT FROM NEW.data_source_id
     OR OLD.imported_by_user_id IS DISTINCT FROM NEW.imported_by_user_id
     OR OLD.product_idempotency_key IS DISTINCT FROM NEW.product_idempotency_key
     OR OLD.product_request_digest IS DISTINCT FROM NEW.product_request_digest
     OR OLD.supersedes_import_batch_id IS DISTINCT FROM NEW.supersedes_import_batch_id
     OR OLD.storage_bucket IS DISTINCT FROM NEW.storage_bucket
     OR OLD.storage_object_key IS DISTINCT FROM NEW.storage_object_key
     OR OLD.upload_protocol IS DISTINCT FROM NEW.upload_protocol
     OR OLD.expected_file_size_bytes IS DISTINCT FROM NEW.expected_file_size_bytes
     OR OLD.storage_part_count IS DISTINCT FROM NEW.storage_part_count
     OR OLD.storage_part_size_bytes IS DISTINCT FROM NEW.storage_part_size_bytes THEN
    RAISE EXCEPTION 'Workspace import identity is immutable.' USING ERRCODE='55000';
  END IF;
  IF OLD.status='completed' AND NEW.status<>'completed'
     OR OLD.status='failed' AND NEW.status<>'failed'
     OR OLD.status='queued' AND NEW.status NOT IN ('queued','processing','failed')
     OR OLD.status='processing' AND NEW.status NOT IN ('processing','completed','failed') THEN
    RAISE EXCEPTION 'Workspace import status transition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND EXISTS(
       SELECT 1 FROM signal_mention_import_memberships membership
       WHERE membership.import_batch_id=NEW.id
         AND membership.ingestion_disposition IS NULL
     ) THEN
    RAISE EXCEPTION 'Completed workspace import requires durable ingestion dispositions.'
      USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=now();
  RETURN NEW;
END; $$;

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
     OR target.storage_bucket IS NULL OR target.storage_object_key IS NULL
     OR target.storage_part_count IS NULL OR target.storage_part_size_bytes IS NULL THEN
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

DROP FUNCTION IF EXISTS claim_signal_workspace_import_dispatch_v1(integer,integer,integer);
CREATE FUNCTION claim_signal_workspace_import_dispatch_v1(
  target_limit integer,
  target_lease_seconds integer,
  target_max_attempts integer
)
RETURNS TABLE(
  outbox_id uuid,lease_token uuid,import_batch_id uuid,workspace_id uuid,
  worker_job_id text,storage_bucket text,storage_object_key text,
  storage_part_count integer,storage_part_size_bytes bigint,
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
    batch.storage_part_count,batch.storage_part_size_bytes,
    batch.source_file_name,batch.data_source_id,batch.contributed_by_study_corpus_id,
    batch.entity_label
  FROM updated JOIN import_batches batch ON batch.id=updated.import_batch_id
  WHERE batch.status='queued';
END; $$;

COMMENT ON COLUMN import_batches.storage_object_key IS
  'Private Storage object prefix; multipart object keys append .part-NNNNN.';
COMMENT ON COLUMN import_batches.storage_part_count IS
  'Immutable number of durable objects composing one logical CSV import.';
COMMENT ON COLUMN import_batches.storage_part_size_bytes IS
  'Immutable maximum bytes per durable object; the final part may be smaller.';
COMMENT ON COLUMN signal_mention_import_memberships.ingestion_disposition IS
  'Durable per-batch root classification used to reconstruct exact counters after a Worker restart.';
