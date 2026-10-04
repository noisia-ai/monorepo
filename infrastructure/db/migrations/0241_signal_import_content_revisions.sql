-- Explicit source-local content revisions. Existing imports stay append_only.
-- The canonical row is a current projection; immutable before/after snapshots
-- become accepted only with their import batch, in the same completion transaction.
ALTER TABLE import_batches
 ADD COLUMN content_revision_mode text NOT NULL DEFAULT 'append_only'
   CHECK(content_revision_mode IN('append_only','revise_existing')),
 ADD COLUMN content_revision_base_batch_id uuid REFERENCES import_batches(id) ON DELETE RESTRICT;

-- Preserve text deduplication, but provider IDs belong to a connector, not a workspace.
-- Existing rows/identifiers are untouched. The CSV resolver uses this same scope.
DROP INDEX uq_mentions_workspace_provider_canonical;
CREATE UNIQUE INDEX uq_mentions_workspace_provider_canonical
 ON mentions(workspace_id,data_source_id,source_system,provider_record_id)
 WHERE canonical_mention_id=id;
DROP INDEX uq_import_batches_completed_content;
CREATE UNIQUE INDEX uq_import_batches_completed_content
 ON import_batches(workspace_id,data_source_id,source_file_hash,content_revision_mode)
 WHERE status='completed' AND source_file_hash IS NOT NULL AND ingestion_phase<>'legacy';

CREATE FUNCTION seal_signal_import_content_revision_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior import_batches%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.content_revision_mode,NEW.content_revision_base_batch_id) IS DISTINCT FROM
     ROW(OLD.content_revision_mode,OLD.content_revision_base_batch_id) THEN
   RAISE EXCEPTION 'content_revision_seal_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.supersedes_import_batch_id IS NOT NULL THEN
  SELECT * INTO prior FROM import_batches WHERE id=NEW.supersedes_import_batch_id;
  IF prior.workspace_id IS DISTINCT FROM NEW.workspace_id OR prior.data_source_id IS DISTINCT FROM NEW.data_source_id THEN
   RAISE EXCEPTION 'content_revision_source_mismatch' USING ERRCODE='23514';
  END IF;
  NEW.content_revision_mode:=prior.content_revision_mode;
  NEW.content_revision_base_batch_id:=prior.content_revision_base_batch_id;
 ELSIF NEW.content_revision_mode='revise_existing' THEN
  IF NEW.acquisition_contract_version IS DISTINCT FROM 'signal-acquisition-import-v2'
     OR NEW.imported_by_user_id IS NULL OR NEW.content_revision_base_batch_id IS NOT NULL THEN
   RAISE EXCEPTION 'content_revision_authority_required' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-import-source:'||NEW.data_source_id::text,0));
  SELECT id INTO NEW.content_revision_base_batch_id FROM import_batches
   WHERE workspace_id=NEW.workspace_id AND data_source_id=NEW.data_source_id AND status='completed'
   ORDER BY completed_at DESC,id DESC LIMIT 1;
  IF NEW.content_revision_base_batch_id IS NULL THEN
   RAISE EXCEPTION 'content_revision_base_required' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.content_revision_base_batch_id IS NOT NULL THEN
  RAISE EXCEPTION 'content_revision_mode_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_import_content_revision_seal BEFORE INSERT OR UPDATE ON import_batches
 FOR EACH ROW EXECUTE FUNCTION seal_signal_import_content_revision_v1();

CREATE TABLE signal_mention_content_revisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
 import_batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
 mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
 source_system text NOT NULL,provider_record_id text NOT NULL,
 previous_content jsonb NOT NULL CHECK(jsonb_typeof(previous_content)='object'),
 next_content jsonb NOT NULL CHECK(jsonb_typeof(next_content)='object'),
 previous_digest text NOT NULL,
 next_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT uq_mention_content_revision_batch_root UNIQUE(import_batch_id,mention_id)
);
ALTER TABLE signal_mention_content_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mention_content_revisions FROM PUBLIC;

-- Content snapshots deliberately exclude row/source identity. Raw metadata is
-- retained for historical evidence; it is not used to decide whether text changed.
CREATE FUNCTION signal_mention_revision_snapshot_v1(m mentions) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('text_raw',m.text_raw,'text_clean',m.text_clean,'text_hash',m.text_hash,
 'text_snippet',m.text_snippet,'text_length',m.text_length,'title',m.title,'language',m.language,
 'published_at',m.published_at,'platform',m.platform,'resolved_platform',m.resolved_platform,
 'content_type',m.content_type,'url',m.url,'country',m.country,'engagement',m.engagement,
 'sentiment_source',m.sentiment_source,'sentiment_score',m.sentiment_score,'quality_score',m.quality_score,
 'inclusion_status',m.inclusion_status,'exclusion_reason',m.exclusion_reason,
 'quality_flags',m.quality_flags,'raw_metadata',m.raw_metadata)
$$;
CREATE FUNCTION signal_mention_revision_digest_v1(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT 'sha256:'||encode(digest(value::text,'sha256'),'hex')
$$;
CREATE FUNCTION guard_signal_mention_content_revision_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE batch import_batches%ROWTYPE;root mentions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'content_revision_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO batch FROM import_batches WHERE id=NEW.import_batch_id;
 SELECT * INTO root FROM mentions WHERE id=NEW.mention_id;
 IF batch.content_revision_mode IS DISTINCT FROM 'revise_existing' OR batch.status<>'processing'
    OR batch.workspace_id IS DISTINCT FROM NEW.workspace_id OR batch.data_source_id IS DISTINCT FROM NEW.data_source_id
    OR root.workspace_id IS DISTINCT FROM NEW.workspace_id OR root.data_source_id IS DISTINCT FROM NEW.data_source_id
    OR root.source_system IS DISTINCT FROM NEW.source_system OR root.provider_record_id IS DISTINCT FROM NEW.provider_record_id
    OR root.canonical_mention_id IS DISTINCT FROM root.id
    OR NEW.previous_content IS DISTINCT FROM signal_mention_revision_snapshot_v1(root)
    OR NEW.previous_digest IS DISTINCT FROM signal_mention_revision_digest_v1(NEW.previous_content)
    OR NEW.next_digest IS DISTINCT FROM signal_mention_revision_digest_v1(NEW.next_content) THEN
  RAISE EXCEPTION 'content_revision_snapshot_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_mention_content_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_mention_content_revisions
 FOR EACH ROW EXECUTE FUNCTION guard_signal_mention_content_revision_v1();

-- Set-based staging, at most one round trip per parsed chunk. No current text changes here.
CREATE FUNCTION stage_signal_mention_content_revisions_v1(target_batch uuid,payload jsonb)
RETURNS TABLE(mention_id uuid) LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE batch import_batches%ROWTYPE;
BEGIN
 SELECT * INTO batch FROM import_batches WHERE id=target_batch FOR SHARE;
 IF batch.content_revision_mode IS DISTINCT FROM 'revise_existing' OR batch.status IS DISTINCT FROM 'processing'
    OR jsonb_typeof(payload) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'content_revision_authority_required' USING ERRCODE='23514';
 END IF;
 -- Lock in stable order; staged retries are idempotent and never overwrite their first snapshot.
 PERFORM m.id FROM mentions m JOIN jsonb_to_recordset(payload) p(mention_id uuid,content jsonb) ON p.mention_id=m.id
  ORDER BY m.id FOR UPDATE OF m;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(payload) p(mention_id uuid,content jsonb)
   LEFT JOIN mentions m ON m.id=p.mention_id
   WHERE m.id IS NULL OR m.workspace_id<>batch.workspace_id OR m.canonical_mention_id<>m.id) THEN
  RAISE EXCEPTION 'content_revision_source_mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(payload) p(mention_id uuid,content jsonb)
   JOIN signal_mention_content_revisions r ON r.import_batch_id=batch.id AND r.mention_id=p.mention_id
   WHERE r.next_content IS DISTINCT FROM signal_mention_revision_snapshot_v1(jsonb_populate_record(NULL::mentions,p.content))) THEN
  RAISE EXCEPTION 'content_revision_conflicting_rows' USING ERRCODE='23514';
 END IF;
 -- Only a material content edit is a revision. Provenance file names, metrics,
 -- observation timestamps and unchanged text do not manufacture a revision.
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(payload) p(mention_id uuid,content jsonb)
   JOIN mentions m ON m.id=p.mention_id
   WHERE ROW(m.text_raw,m.text_clean,m.title,m.content_type) IS DISTINCT FROM
     ROW(p.content->>'text_raw',p.content->>'text_clean',p.content->>'title',p.content->>'content_type')
   AND (m.data_source_id<>batch.data_source_id OR m.source_system IS DISTINCT FROM p.content->>'source_system' OR m.provider_record_id IS DISTINCT FROM p.content->>'provider_record_id'
     OR EXISTS(SELECT 1 FROM signal_mention_import_memberships x WHERE x.mention_id=m.id AND x.data_source_id<>batch.data_source_id)
     OR EXISTS(SELECT 1 FROM signal_provider_mention_observations o WHERE o.mention_id=m.id
       AND (o.data_source_id<>batch.data_source_id OR o.provider_record_key_hash<>
         'sha256:'||encode(digest(m.provider_record_id,'sha256'),'hex')))
     OR NOT EXISTS(SELECT 1 FROM signal_provider_mention_observations o JOIN import_batches b ON b.id=o.import_batch_id
       WHERE o.mention_id=m.id AND b.status='completed' AND o.data_source_id=batch.data_source_id
       AND o.provider_record_key_hash='sha256:'||encode(digest(m.provider_record_id,'sha256'),'hex')))) THEN
  RAISE EXCEPTION 'content_revision_identity_ambiguous' USING ERRCODE='23514';
 END IF;
 INSERT INTO signal_mention_content_revisions(workspace_id,data_source_id,import_batch_id,mention_id,source_system,provider_record_id,
   previous_content,next_content,previous_digest,next_digest)
 SELECT batch.workspace_id,batch.data_source_id,batch.id,m.id,m.source_system,m.provider_record_id,
   signal_mention_revision_snapshot_v1(m),signal_mention_revision_snapshot_v1(n),
   signal_mention_revision_digest_v1(signal_mention_revision_snapshot_v1(m)),
   signal_mention_revision_digest_v1(signal_mention_revision_snapshot_v1(n))
 FROM jsonb_to_recordset(payload) p(mention_id uuid,content jsonb) JOIN mentions m ON m.id=p.mention_id
 CROSS JOIN LATERAL jsonb_populate_record(NULL::mentions,p.content) n
 WHERE ROW(m.text_raw,m.text_clean,m.title,m.content_type) IS DISTINCT FROM ROW(n.text_raw,n.text_clean,n.title,n.content_type)
 ON CONFLICT ON CONSTRAINT uq_mention_content_revision_batch_root DO NOTHING;
 RETURN QUERY SELECT r.mention_id FROM signal_mention_content_revisions r
  WHERE r.import_batch_id=batch.id AND EXISTS(SELECT 1 FROM jsonb_to_recordset(payload) p(mention_id uuid,content jsonb) WHERE p.mention_id=r.mention_id);
END; $$;

-- The publishing function runs inside complete_signal_workspace_import_v1.
CREATE FUNCTION apply_signal_mention_content_revisions_v1(target_batch uuid) RETURNS integer
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE batch import_batches%ROWTYPE;latest uuid;changed integer;
BEGIN
 SELECT * INTO batch FROM import_batches WHERE id=target_batch FOR UPDATE;
 IF batch.content_revision_mode='append_only' THEN RETURN 0; END IF;
 IF batch.status IS DISTINCT FROM 'processing' THEN RAISE EXCEPTION 'content_revision_authority_required' USING ERRCODE='23514'; END IF;
 PERFORM signal_processing_lock_actor_v1(batch.workspace_id,batch.imported_by_user_id,false);
 IF NOT EXISTS(SELECT 1 FROM signal_workspaces w JOIN users u ON u.id=batch.imported_by_user_id
   WHERE w.id=batch.workspace_id AND
    ((u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','analyst','founder','admin','kam','insights_manager','ux_data_specialist'))
     OR (u.user_type='client' AND u.organization_id=w.organization_id AND u.primary_role IN('client_admin','brand_manager','client_owner')
       AND EXISTS(SELECT 1 FROM user_brand_access a WHERE a.brand_id=w.brand_id AND a.user_id=u.id
         AND a.revoked_at IS NULL AND a.access_level IN('comment','admin'))))) THEN
  RAISE EXCEPTION 'content_revision_forbidden' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-import-source:'||batch.data_source_id::text,0));
 SELECT id INTO latest FROM import_batches WHERE workspace_id=batch.workspace_id AND data_source_id=batch.data_source_id
  AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1;
 IF latest IS DISTINCT FROM batch.content_revision_base_batch_id THEN
  RAISE EXCEPTION 'content_revision_base_stale' USING ERRCODE='23514';
 END IF;
 -- Retain existing rights gates and hold active policy rows through publication.
 PERFORM s.id FROM data_sources s WHERE s.id=batch.data_source_id AND s.status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'content_revision_source_inactive' USING ERRCODE='23514'; END IF;
 PERFORM b.id FROM signal_provenance_policy_bindings b
  JOIN signal_quality_policies q ON q.id=b.quality_policy_id
  JOIN signal_retention_policies r ON r.id=b.retention_policy_id
  JOIN signal_licensing_policies l ON l.id=b.licensing_policy_id
  WHERE b.workspace_id=batch.workspace_id AND b.data_source_id=batch.data_source_id
   AND b.import_batch_id IS NULL AND b.status='active' AND q.status='active' AND r.status='active' AND l.status='active'
   AND b.effective_from<=clock_timestamp() AND (b.effective_to IS NULL OR b.effective_to>clock_timestamp())
   AND q.effective_from<=clock_timestamp() AND (q.effective_to IS NULL OR q.effective_to>clock_timestamp())
   AND r.effective_from<=clock_timestamp() AND (r.effective_to IS NULL OR r.effective_to>clock_timestamp())
   AND (r.retain_until IS NULL OR r.retain_until>clock_timestamp())
   AND l.effective_from<=clock_timestamp() AND (l.effective_to IS NULL OR l.effective_to>clock_timestamp())
   FOR SHARE OF b,q,r,l;
 IF NOT FOUND THEN RAISE EXCEPTION 'content_revision_rights_unavailable' USING ERRCODE='23514'; END IF;
 PERFORM m.id FROM mentions m JOIN signal_mention_content_revisions r ON r.mention_id=m.id
  WHERE r.import_batch_id=batch.id ORDER BY m.id FOR UPDATE OF m;
 IF EXISTS(SELECT 1 FROM signal_mention_content_revisions r JOIN mentions m ON m.id=r.mention_id
   WHERE r.import_batch_id=batch.id AND (m.workspace_id<>r.workspace_id OR m.data_source_id<>r.data_source_id
     OR m.source_system<>r.source_system OR m.provider_record_id<>r.provider_record_id OR m.canonical_mention_id<>m.id
     OR r.previous_digest<>signal_mention_revision_digest_v1(signal_mention_revision_snapshot_v1(m))
     OR EXISTS(SELECT 1 FROM signal_mention_import_memberships x WHERE x.mention_id=m.id AND x.data_source_id<>batch.data_source_id)
     OR EXISTS(SELECT 1 FROM signal_provider_mention_observations o WHERE o.mention_id=m.id AND
       (o.data_source_id<>batch.data_source_id OR o.provider_record_key_hash<>'sha256:'||encode(digest(m.provider_record_id,'sha256'),'hex')))
     OR EXISTS(SELECT 1 FROM mentions other WHERE other.workspace_id=batch.workspace_id AND other.canonical_mention_id=other.id
       AND other.id<>m.id AND other.text_hash=r.next_content->>'text_hash'))) THEN
  RAISE EXCEPTION 'content_revision_conflict' USING ERRCODE='23514';
 END IF;
 UPDATE mentions m SET
  text_raw=n.text_raw,text_clean=n.text_clean,text_hash=n.text_hash,text_snippet=n.text_snippet,text_length=n.text_length,
  title=n.title,language=n.language,published_at=n.published_at,platform=n.platform,resolved_platform=n.resolved_platform,
  content_type=n.content_type,url=n.url,country=n.country,engagement=n.engagement,
  sentiment_source=n.sentiment_source,sentiment_score=n.sentiment_score,quality_score=n.quality_score,
  inclusion_status=n.inclusion_status,exclusion_reason=n.exclusion_reason,quality_flags=n.quality_flags,raw_metadata=n.raw_metadata
 FROM signal_mention_content_revisions r CROSS JOIN LATERAL jsonb_populate_record(NULL::mentions,r.next_content) n
 WHERE r.import_batch_id=batch.id AND m.id=r.mention_id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END; $$;

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
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-import-source:'||target.data_source_id::text,0));
  SELECT id INTO duplicate_batch_id FROM import_batches
  WHERE workspace_id=target.workspace_id AND data_source_id=target.data_source_id
    AND source_file_hash=target_file_hash AND content_revision_mode=target.content_revision_mode AND status='completed' AND id<>target.id
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
  PERFORM apply_signal_mention_content_revisions_v1(target.id);
  PERFORM materialize_signal_workspace_import_source_intent_v1(target.id);
  UPDATE import_batches SET record_count=target_record_count,included_count=target_included_count,
    excluded_count=target_excluded_count,duplicate_count=target_duplicate_count,
    source_file_hash=target_file_hash,processed_bytes=target_processed_bytes,
    progress_record_count=target_record_count,status='completed',ingestion_phase='completed',
    completed_at=clock_timestamp()
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

REVOKE ALL ON FUNCTION stage_signal_mention_content_revisions_v1(uuid,jsonb),
 apply_signal_mention_content_revisions_v1(uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON signal_mention_content_revisions FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON signal_mention_content_revisions FROM authenticated;
 END IF;
END; $$;
