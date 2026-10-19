-- Workspace-owned CSV recovery integrity and set-based provenance.
-- Failed attempts remain immutable audit history; recoveries reuse the exact
-- durable private objects and must independently recompute their content hash.

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS storage_source_import_batch_id uuid
    REFERENCES import_batches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS storage_content_hash text,
  ADD COLUMN IF NOT EXISTS processing_metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE import_batches
  DROP CONSTRAINT IF EXISTS import_batches_storage_content_hash;
ALTER TABLE import_batches
  ADD CONSTRAINT import_batches_storage_content_hash CHECK (
    storage_content_hash IS NULL OR storage_content_hash ~ '^[0-9a-f]{64}$'
  );
ALTER TABLE import_batches
  DROP CONSTRAINT IF EXISTS import_batches_processing_metrics_object;
ALTER TABLE import_batches
  ADD CONSTRAINT import_batches_processing_metrics_object CHECK (
    jsonb_typeof(processing_metrics)='object'
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_active_storage_recovery
  ON import_batches(supersedes_import_batch_id)
  WHERE supersedes_import_batch_id IS NOT NULL
    AND status IN ('queued','processing','completed');

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
      IF NEW.storage_source_import_batch_id IS NOT NULL THEN
        IF NEW.storage_source_import_batch_id IS DISTINCT FROM prior.id
           OR NEW.storage_bucket IS DISTINCT FROM prior.storage_bucket
           OR NEW.storage_object_key IS DISTINCT FROM prior.storage_object_key
           OR NEW.expected_file_size_bytes IS DISTINCT FROM prior.expected_file_size_bytes
           OR NEW.storage_part_count IS DISTINCT FROM prior.storage_part_count
           OR NEW.storage_part_size_bytes IS DISTINCT FROM prior.storage_part_size_bytes
           OR NEW.source_file_name IS DISTINCT FROM prior.source_file_name THEN
          RAISE EXCEPTION 'Import storage recovery must reuse and verify the failed batch objects.'
            USING ERRCODE='23514';
        END IF;
      ELSIF NEW.storage_content_hash IS NOT NULL
         OR NEW.storage_object_key IS NOT DISTINCT FROM prior.storage_object_key THEN
        RAISE EXCEPTION 'Import reupload recovery storage identity is invalid.'
          USING ERRCODE='23514';
      END IF;
    ELSIF NEW.storage_source_import_batch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Import storage source requires a superseded failed batch.'
        USING ERRCODE='23514';
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
     OR OLD.storage_source_import_batch_id IS DISTINCT FROM NEW.storage_source_import_batch_id
     OR OLD.storage_bucket IS DISTINCT FROM NEW.storage_bucket
     OR OLD.storage_object_key IS DISTINCT FROM NEW.storage_object_key
     OR OLD.upload_protocol IS DISTINCT FROM NEW.upload_protocol
     OR OLD.expected_file_size_bytes IS DISTINCT FROM NEW.expected_file_size_bytes
     OR OLD.storage_part_count IS DISTINCT FROM NEW.storage_part_count
     OR OLD.storage_part_size_bytes IS DISTINCT FROM NEW.storage_part_size_bytes
     OR (OLD.storage_content_hash IS NOT NULL
       AND OLD.storage_content_hash IS DISTINCT FROM NEW.storage_content_hash)
     OR (OLD.storage_content_hash IS NULL AND NEW.storage_content_hash IS NOT NULL
       AND NOT (OLD.status='processing' AND NEW.status='processing'
         AND OLD.storage_source_import_batch_id IS NOT NULL)) THEN
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

-- Async inserts remain quarantined until the atomic completion transition.
-- Avoid invoking the legacy row-at-a-time provenance and population reconciler
-- for every newly inserted root. Legacy ingestion semantics remain unchanged.
CREATE OR REPLACE FUNCTION sync_signal_mention_governance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_phase text;
BEGIN
  IF NEW.canonical_mention_id<>NEW.id THEN RETURN NEW; END IF;
  IF NEW.source_file_id IS NOT NULL THEN
    SELECT ingestion_phase INTO target_phase FROM import_batches
    WHERE id=NEW.source_file_id;
    IF target_phase IS DISTINCT FROM 'legacy' THEN RETURN NEW; END IF;
    PERFORM record_signal_mention_import_provenance(NEW.id,NEW.source_file_id);
  END IF;
  PERFORM reconcile_signal_operational_population_mention(NEW.workspace_id,NEW.id);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION enforce_signal_mention_import_membership_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('noisia.import_set_provenance',true)='on' THEN RETURN NEW; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM mentions mention JOIN import_batches batch ON batch.id=NEW.import_batch_id
    WHERE mention.id=NEW.mention_id AND mention.canonical_mention_id=mention.id
      AND mention.workspace_id=NEW.workspace_id AND batch.workspace_id=NEW.workspace_id
      AND batch.data_source_id=NEW.data_source_id
  ) THEN
    RAISE EXCEPTION 'Import membership must reference a canonical mention and import in the same workspace.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION enforce_signal_mention_study_membership_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('noisia.import_set_provenance',true)='on' THEN RETURN NEW; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM mentions mention
    JOIN signal_workspace_corpora link ON link.study_corpus_id=NEW.study_corpus_id
    WHERE mention.id=NEW.mention_id AND mention.canonical_mention_id=mention.id
      AND mention.workspace_id=NEW.workspace_id AND link.workspace_id=NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Study membership must reference a canonical mention and corpus in the same workspace.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION enforce_signal_attribution_workspace_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mention_workspace_id uuid;DECLARE workspace_brand_id uuid;
BEGIN
  IF current_setting('noisia.import_bulk_reconcile',true)='on' THEN RETURN NEW; END IF;
  SELECT workspace_id INTO mention_workspace_id FROM mentions
  WHERE id=NEW.mention_id AND canonical_mention_id=id;
  IF mention_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'Mention attribution cannot cross workspaces.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM data_sources source WHERE source.id=NEW.data_source_id
    AND source.workspace_id=NEW.workspace_id) THEN
    RAISE EXCEPTION 'Mention attribution source cannot cross workspaces.' USING ERRCODE='23514';
  END IF;
  IF NEW.import_batch_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM import_batches batch WHERE batch.id=NEW.import_batch_id
      AND batch.workspace_id=NEW.workspace_id AND batch.data_source_id=NEW.data_source_id
  ) THEN
    RAISE EXCEPTION 'Mention attribution import cannot cross source or workspace.' USING ERRCODE='23514';
  END IF;
  IF NEW.scope='primary_brand' THEN
    SELECT brand_id INTO workspace_brand_id FROM signal_workspaces WHERE id=NEW.workspace_id;
    IF NEW.entity_type<>'brand' OR NEW.entity_id IS DISTINCT FROM workspace_brand_id THEN
      RAISE EXCEPTION 'Primary brand attribution must identify the workspace brand.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.scope='competitor' AND NEW.entity_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM competitors competitor
    JOIN signal_workspaces workspace ON workspace.brand_id=competitor.brand_id
    WHERE competitor.id=NEW.entity_id AND workspace.id=NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Competitor attribution cannot cross workspace brand scope.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION record_signal_workspace_import_provenance_set_v1(
  target_import_batch_id uuid,
  target_mention_ids uuid[],
  target_dispositions text[]
)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;
DECLARE invalid_count integer;
DECLARE persisted_count integer;
BEGIN
  IF target_mention_ids IS NULL OR target_dispositions IS NULL
     OR cardinality(target_mention_ids)<>cardinality(target_dispositions)
     OR cardinality(target_mention_ids)=0 THEN
    RAISE EXCEPTION 'Workspace import provenance set is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR SHARE;
  IF target.id IS NULL OR target.ingestion_phase='legacy'
     OR target.status NOT IN ('queued','processing') THEN
    RAISE EXCEPTION 'Workspace import provenance target is unavailable.' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO invalid_count
  FROM unnest(target_mention_ids,target_dispositions) input(mention_id,disposition)
  LEFT JOIN mentions mention ON mention.id=input.mention_id
    AND mention.workspace_id=target.workspace_id
    AND mention.canonical_mention_id=mention.id
  WHERE mention.id IS NULL OR input.disposition NOT IN ('included','excluded','duplicate');
  IF invalid_count<>0 THEN
    RAISE EXCEPTION 'Workspace import provenance cannot cross workspaces.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(target_mention_ids,target_dispositions) input(mention_id,disposition)
    JOIN signal_mention_import_memberships membership
      ON membership.mention_id=input.mention_id
     AND membership.import_batch_id=target.id
    WHERE membership.ingestion_disposition IS NOT NULL
      AND membership.ingestion_disposition<>input.disposition
  ) THEN
    RAISE EXCEPTION 'Workspace import disposition conflicts with durable history.'
      USING ERRCODE='23514';
  END IF;
  IF target.contributed_by_study_corpus_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM signal_workspace_corpora link
    WHERE link.workspace_id=target.workspace_id
      AND link.study_corpus_id=target.contributed_by_study_corpus_id
  ) THEN
    RAISE EXCEPTION 'Workspace import study provenance cannot cross workspaces.'
      USING ERRCODE='23514';
  END IF;
  PERFORM set_config('noisia.import_set_provenance','on',true);
  INSERT INTO signal_mention_import_memberships(
    workspace_id,mention_id,import_batch_id,data_source_id,ingestion_disposition
  )
  SELECT target.workspace_id,input.mention_id,target.id,target.data_source_id,input.disposition
  FROM unnest(target_mention_ids,target_dispositions) input(mention_id,disposition)
  ON CONFLICT(mention_id,import_batch_id) DO UPDATE
  SET ingestion_disposition=COALESCE(
    signal_mention_import_memberships.ingestion_disposition,
    EXCLUDED.ingestion_disposition
  );
  GET DIAGNOSTICS persisted_count=ROW_COUNT;
  IF target.contributed_by_study_corpus_id IS NOT NULL THEN
    INSERT INTO signal_mention_study_memberships(
      workspace_id,mention_id,study_corpus_id,import_batch_id,membership_role
    ) SELECT target.workspace_id,input.mention_id,target.contributed_by_study_corpus_id,
      target.id,'contributed'
    FROM unnest(target_mention_ids) input(mention_id)
    ON CONFLICT DO NOTHING;
  END IF;
  PERFORM set_config('noisia.import_set_provenance','off',true);
  RETURN persisted_count;
END; $$;

CREATE OR REPLACE FUNCTION materialize_signal_workspace_import_source_intent_v1(
  target_import_batch_id uuid
)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;DECLARE source data_sources%ROWTYPE;
DECLARE workspace signal_workspaces%ROWTYPE;DECLARE inserted_count integer;
DECLARE resolved_scope text;DECLARE resolved_entity_type text;
DECLARE resolved_entity_id uuid;DECLARE resolved_review_status text;
BEGIN
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR SHARE;
  SELECT * INTO source FROM data_sources WHERE id=target.data_source_id;
  SELECT * INTO workspace FROM signal_workspaces WHERE id=target.workspace_id;
  IF target.id IS NULL OR source.id IS NULL OR workspace.id IS NULL
     OR source.workspace_id IS DISTINCT FROM target.workspace_id THEN
    RAISE EXCEPTION 'Workspace import source intent cannot cross workspaces.' USING ERRCODE='23514';
  END IF;
  resolved_scope:=COALESCE(source.governed_scope,CASE
    WHEN target.mention_type='brand' OR target.entity_kind='primary_brand' THEN 'primary_brand'
    WHEN target.mention_type='competitor' OR target.entity_kind IN ('competitor','competitor_pool') THEN 'competitor'
    WHEN target.mention_type='industry' OR target.entity_kind='category' THEN 'category'
    WHEN target.entity_kind='reference' THEN 'reference' ELSE 'unattributed' END);
  resolved_entity_type:=COALESCE(source.governed_entity_type,CASE resolved_scope
    WHEN 'primary_brand' THEN 'brand' WHEN 'competitor' THEN 'competitor'
    WHEN 'category' THEN 'category' WHEN 'reference' THEN 'reference'
    ELSE 'unattributed' END);
  resolved_entity_id:=COALESCE(source.governed_entity_id,CASE resolved_scope
    WHEN 'primary_brand' THEN workspace.brand_id
    WHEN 'competitor' THEN target.competitor_id ELSE NULL END);
  resolved_review_status:=CASE WHEN source.governed_scope IS NULL
    THEN 'approved' ELSE source.scope_review_status END;
  PERFORM set_config('noisia.import_bulk_reconcile','on',true);
  INSERT INTO signal_mention_attributions(
    workspace_id,mention_id,data_source_id,import_batch_id,scope,entity_type,
    entity_id,entity_label,confidence,review_status,attribution_source,policy_version,
    approved_by_user_id,approval_source,approved_at,attribution_basis,eligibility_status
  ) SELECT target.workspace_id,membership.mention_id,source.id,target.id,
    resolved_scope,resolved_entity_type,resolved_entity_id,
    COALESCE(target.entity_label,source.name),1.0000,resolved_review_status,
    CASE WHEN source.governed_scope IS NULL THEN 'legacy_import_batch'
      ELSE 'governed_data_source' END,
    COALESCE(source.scope_policy_version,'workspace-scope-legacy-v1'),
    CASE WHEN resolved_review_status='approved' THEN source.scope_approved_by_user_id END,
    CASE WHEN resolved_review_status='approved' THEN
      COALESCE(source.scope_approval_source,'legacy_import_scope') END,
    CASE WHEN resolved_review_status='approved' THEN
      COALESCE(source.scope_approved_at,now()) END,
    'source_intent','not_eligible'
  FROM signal_mention_import_memberships membership
  WHERE membership.import_batch_id=target.id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  PERFORM set_config('noisia.import_bulk_reconcile','off',true);
  RETURN inserted_count;
END; $$;

-- The existing trigger function is retained semantically but honors the same
-- transaction-local bulk reconcile guard used by completion since 0079.
CREATE OR REPLACE FUNCTION reconcile_signal_population_after_attribution()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('noisia.import_bulk_reconcile',true)='on' THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.attribution_basis='source_intent' THEN
      PERFORM reconcile_signal_operational_population_mention(OLD.workspace_id,OLD.mention_id);
    ELSE
      PERFORM reconcile_signal_semantic_candidate_population_mention(OLD.workspace_id,OLD.mention_id);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
      OR OLD.mention_id IS DISTINCT FROM NEW.mention_id
      OR OLD.attribution_basis IS DISTINCT FROM NEW.attribution_basis) THEN
    IF OLD.attribution_basis='source_intent' THEN
      PERFORM reconcile_signal_operational_population_mention(OLD.workspace_id,OLD.mention_id);
    ELSE
      PERFORM reconcile_signal_semantic_candidate_population_mention(OLD.workspace_id,OLD.mention_id);
    END IF;
  END IF;
  IF NEW.attribution_basis='source_intent' THEN
    PERFORM reconcile_signal_operational_population_mention(NEW.workspace_id,NEW.mention_id);
  ELSE
    PERFORM reconcile_signal_semantic_candidate_population_mention(NEW.workspace_id,NEW.mention_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION create_signal_workspace_import_storage_recovery_v1(
  target_failed_import_batch_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_request_digest text,
  target_storage_content_hash text
)
RETURNS TABLE(
  import_batch_id uuid,outbox_id uuid,worker_job_id text,created boolean
)
LANGUAGE plpgsql AS $$
DECLARE prior import_batches%ROWTYPE;DECLARE persisted import_batches%ROWTYPE;
DECLARE queued record;
BEGIN
  IF target_idempotency_key !~ '^sha256:[0-9a-f]{64}$'
     OR target_request_digest !~ '^sha256:[0-9a-f]{64}$'
     OR (target_storage_content_hash IS NOT NULL
       AND target_storage_content_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Workspace import recovery authority is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO prior FROM import_batches
  WHERE id=target_failed_import_batch_id FOR UPDATE;
  IF prior.id IS NULL OR prior.status<>'failed' OR prior.ingestion_phase<>'failed'
     OR prior.storage_bucket IS NULL OR prior.storage_object_key IS NULL
     OR prior.storage_part_count IS NULL OR prior.storage_part_size_bytes IS NULL THEN
    RAISE EXCEPTION 'Workspace import recovery source is unavailable.' USING ERRCODE='23514';
  END IF;
  IF NOT signal_data_governance_actor_is_valid(prior.workspace_id,target_actor_user_id) THEN
    RAISE EXCEPTION 'Workspace import recovery actor is unauthorized.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'workspace-import-recovery:'||prior.workspace_id::text||':'||prior.id::text,0
  ));
  SELECT * INTO persisted FROM import_batches
  WHERE workspace_id=prior.workspace_id AND product_idempotency_key=target_idempotency_key
  FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    IF persisted.product_request_digest<>target_request_digest
       OR persisted.supersedes_import_batch_id IS DISTINCT FROM prior.id THEN
      RAISE EXCEPTION 'Workspace import recovery idempotency conflict.' USING ERRCODE='23514';
    END IF;
    SELECT * INTO queued FROM signal_workspace_import_outbox outbox
    WHERE outbox.import_batch_id=persisted.id;
    RETURN QUERY SELECT persisted.id,queued.id,queued.worker_job_id,false;RETURN;
  END IF;
  INSERT INTO import_batches(
    workspace_id,study_corpus_id,contributed_by_study_corpus_id,data_source_id,
    query_iteration_id,query_pack_id,query_validation_run_id,mention_type,
    competitor_id,corpus_entity_id,entity_kind,entity_label,source_system,
    source_file_name,source_file_hash,ingestion_phase,storage_bucket,
    storage_object_key,upload_protocol,expected_file_size_bytes,storage_part_count,
    storage_part_size_bytes,storage_content_hash,storage_source_import_batch_id,
    supersedes_import_batch_id,product_idempotency_key,product_request_digest,
    imported_by_user_id,status
  ) VALUES(
    prior.workspace_id,prior.study_corpus_id,prior.contributed_by_study_corpus_id,
    prior.data_source_id,prior.query_iteration_id,prior.query_pack_id,
    prior.query_validation_run_id,prior.mention_type,prior.competitor_id,
    prior.corpus_entity_id,prior.entity_kind,prior.entity_label,prior.source_system,
    prior.source_file_name,NULL,'queued',prior.storage_bucket,prior.storage_object_key,
    prior.upload_protocol,prior.expected_file_size_bytes,prior.storage_part_count,
    prior.storage_part_size_bytes,target_storage_content_hash,prior.id,prior.id,
    target_idempotency_key,target_request_digest,target_actor_user_id,'queued'
  ) RETURNING * INTO persisted;
  INSERT INTO signal_workspace_import_events(
    workspace_id,import_batch_id,event_type,actor_user_id,detail
  ) VALUES(prior.workspace_id,persisted.id,'retry-created',
    target_actor_user_id,jsonb_build_object(
      'storage_reused',true,'supersedes_import_batch_id',prior.id,
      'verified_size_bytes',prior.expected_file_size_bytes
    ));
  SELECT * INTO queued FROM enqueue_signal_workspace_import_v1(
    persisted.id,target_actor_user_id
  );
  RETURN QUERY SELECT persisted.id,queued.outbox_id,queued.worker_job_id,true;
END; $$;

CREATE OR REPLACE FUNCTION seal_signal_workspace_import_storage_hash_v1(
  target_import_batch_id uuid,target_worker_job_id text,
  target_storage_content_hash text,target_verified_bytes bigint
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;
BEGIN
  IF target_storage_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Workspace import storage hash is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO target FROM import_batches WHERE id=target_import_batch_id FOR UPDATE;
  IF target.id IS NULL OR target.status<>'processing'
     OR target.worker_job_id IS DISTINCT FROM target_worker_job_id
     OR target.storage_source_import_batch_id IS NULL
     OR target_verified_bytes IS DISTINCT FROM target.expected_file_size_bytes THEN
    RAISE EXCEPTION 'Workspace import storage verification is stale.' USING ERRCODE='23514';
  END IF;
  IF target.storage_content_hash IS NOT NULL THEN
    IF target.storage_content_hash<>target_storage_content_hash THEN
      RAISE EXCEPTION 'Workspace import storage hash conflicts with durable history.'
        USING ERRCODE='23514';
    END IF;
    RETURN false;
  END IF;
  UPDATE import_batches SET storage_content_hash=target_storage_content_hash
  WHERE id=target.id;
  INSERT INTO signal_workspace_import_events(
    workspace_id,import_batch_id,event_type,detail
  ) VALUES(target.workspace_id,target.id,'progress',jsonb_build_object(
    'stage','storage-verification','verified_bytes',target_verified_bytes
  ));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION record_signal_workspace_import_metrics_v1(
  target_import_batch_id uuid,target_worker_job_id text,target_metrics jsonb
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(target_metrics)<>'object' THEN
    RAISE EXCEPTION 'Workspace import metrics are invalid.' USING ERRCODE='23514';
  END IF;
  UPDATE import_batches SET processing_metrics=target_metrics
  WHERE id=target_import_batch_id AND worker_job_id=target_worker_job_id
    AND status IN ('processing','completed','failed');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace import metrics job is stale.' USING ERRCODE='40001';
  END IF;
END; $$;

-- Preserve the exact 0079 closure invariant and additionally bind recovery to
-- the SHA-256 verified before it was queued. Source intent is materialized in
-- this same transaction, immediately before the accepted status transition.
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
    UPDATE signal_workspace_import_outbox SET status='failed',completed_at=now(),updated_at=now()
    WHERE import_batch_id=target.id;
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

COMMENT ON FUNCTION create_signal_workspace_import_storage_recovery_v1(uuid,uuid,text,text,text) IS
  'Transactional and idempotent recovery writer that reuses verified immutable private multipart objects.';
COMMENT ON COLUMN import_batches.storage_source_import_batch_id IS
  'Failed predecessor whose immutable private objects are reused by this recovery attempt.';
COMMENT ON COLUMN import_batches.storage_content_hash IS
  'SHA-256 recomputed from all durable parts before queueing; completion must independently match it.';
COMMENT ON COLUMN import_batches.processing_metrics IS
  'Operator-safe stage timings and set-based query counts; never raw mention content.';
COMMENT ON FUNCTION seal_signal_workspace_import_storage_hash_v1(uuid,text,text,bigint) IS
  'Worker-only recovery preflight: seals the SHA-256 of reused immutable objects before mention persistence begins.';
