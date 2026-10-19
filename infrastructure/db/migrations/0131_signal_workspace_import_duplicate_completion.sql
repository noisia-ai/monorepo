-- Complete exact-file replay without colliding with the RETURNS TABLE variable.
-- Forward-only function replacement; no rows, keys, rights, or retry policy are changed.
-- The existing accepted import remains the sole accepted dataset for this hash/source.

CREATE OR REPLACE FUNCTION complete_signal_workspace_import_v1(
  target_import_batch_id uuid,target_worker_job_id text,target_file_hash text,
  target_record_count integer,target_included_count integer,
  target_excluded_count integer,target_duplicate_count integer,target_processed_bytes bigint
)
RETURNS TABLE(import_batch_id uuid,accepted boolean,accepted_batch_id uuid)
LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;DECLARE duplicate_batch_id uuid;DECLARE accepted_record record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-import:'||target_import_batch_id::text,0));
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR UPDATE;
  IF target.id IS NULL OR target.worker_job_id IS DISTINCT FROM target_worker_job_id THEN
    RAISE EXCEPTION 'Workspace import completion job is invalid.' USING ERRCODE='23514';
  END IF;
  IF target.status='completed' THEN RETURN QUERY SELECT target.id,true,target.id;RETURN; END IF;
  IF target.status<>'processing' OR target_file_hash !~ '^[0-9a-f]{64}$'
     OR (target.storage_source_import_batch_id IS NOT NULL
       AND target.storage_content_hash IS NULL)
     OR (target.storage_content_hash IS NOT NULL AND target.storage_content_hash<>target_file_hash)
     OR target_record_count<>target_included_count+target_excluded_count+target_duplicate_count
     OR least(target_record_count,target_included_count,target_excluded_count,target_duplicate_count)<0
     OR target_processed_bytes<>target.expected_file_size_bytes THEN
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
    UPDATE signal_workspace_import_outbox outbox SET status='failed',completed_at=now(),updated_at=now()
    WHERE outbox.import_batch_id=target.id;
    RETURN QUERY SELECT target.id,false,duplicate_batch_id;RETURN;
  END IF;
  PERFORM materialize_signal_workspace_import_source_intent_v1(target.id);
  UPDATE import_batches SET record_count=target_record_count,included_count=target_included_count,
    excluded_count=target_excluded_count,duplicate_count=target_duplicate_count,
    source_file_hash=target_file_hash,processed_bytes=target_processed_bytes,
    progress_record_count=target_record_count,status='completed',ingestion_phase='completed',
    completed_at=now()
  WHERE id=target.id;
  INSERT INTO source_sync_runs(
    workspace_id,data_source_id,import_batch_id,finished_at,status,records_total,
    records_valid,records_duplicate,records_failed,error_summary,coverage_start,coverage_end
  ) SELECT target.workspace_id,target.data_source_id,target.id,now(),'completed',
    target_record_count,target_included_count+target_excluded_count,target_duplicate_count,0,'{}'::jsonb,
    min((mention.published_at AT TIME ZONE workspace.timezone)::date),
    max((mention.published_at AT TIME ZONE workspace.timezone)::date)
  FROM signal_workspaces workspace
  LEFT JOIN signal_mention_import_memberships membership ON membership.import_batch_id=target.id
  LEFT JOIN mentions mention ON mention.id=membership.mention_id
  WHERE workspace.id=target.workspace_id
    AND NOT EXISTS(SELECT 1 FROM source_sync_runs prior WHERE prior.import_batch_id=target.id)
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
