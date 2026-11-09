-- Complete a normal CSV import with bounded, set-based population reconciliation.
-- Keep 0067/0064/0073 membership predicates, reasons, timestamps and draft fences.
-- No acceptance, rights, source-intent, recovery, pointer or publication policy changes.
CREATE OR REPLACE FUNCTION reconcile_signal_workspace_import_completion_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE population record;
DECLARE semantic_contract boolean;
DECLARE locked_pointer uuid;
DECLARE pointer_attempt integer;
BEGIN
  IF NEW.status<>'completed' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  -- Same first row lock as promote_signal_workspace_population. A promotion
  -- deletes/reinserts the pointer; retry a fresh statement if the old row vanished
  -- while waiting (REPEATABLE READ instead raises its native 40001).
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-import-completion:'||NEW.workspace_id::text,0));
  FOR pointer_attempt IN 1..8 LOOP
    SELECT id INTO locked_pointer FROM signal_workspace_population_pointers
      WHERE workspace_id=NEW.workspace_id AND purpose='operational' FOR UPDATE;
    EXIT WHEN FOUND;
    EXIT WHEN NOT EXISTS(SELECT 1 FROM signal_workspace_population_pointers
      WHERE workspace_id=NEW.workspace_id AND purpose='operational');
    IF pointer_attempt=8 THEN
      RAISE EXCEPTION 'workspace_import_population_changed' USING ERRCODE='40001';
    END IF;
  END LOOP;
  -- Share the existing creation locks before locking definitions: a draft
  -- cannot appear between the lock query and the population cursor.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text||':primary-brand-semantic-v2',0));
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','attributable-semantic-base-v1',NEW.workspace_id::text),0));
  -- Lock definitions only after the pointer. The following population query is
  -- a new statement, so a completion that waited never uses a stale list.
  PERFORM definition.id FROM signal_workspace_population_pointers pointer
    JOIN signal_population_definitions definition ON definition.id=pointer.population_id
    WHERE pointer.id=locked_pointer FOR UPDATE OF definition;
  PERFORM id FROM signal_population_definitions WHERE workspace_id=NEW.workspace_id
    AND status='draft' AND definition->>'contract_version' IN (
      'signal-operational-primary-brand-semantic-v2','signal-operational-attributable-semantic-v1')
    ORDER BY id FOR UPDATE;
  PERFORM set_config('noisia.import_bulk_reconcile','on',true);
  -- Iterate populations (normally one active bridge and at most two drafts),
  -- never the potentially 100K roots. Draft contracts remain unpromoted.
  FOR population IN
    SELECT definition.*,workspace.brand_id,'operational'::text reconcile_kind
    FROM signal_workspace_population_pointers pointer
    JOIN signal_population_definitions definition
      ON definition.id=pointer.population_id AND definition.workspace_id=pointer.workspace_id
    JOIN signal_workspaces workspace ON workspace.id=definition.workspace_id
    WHERE pointer.workspace_id=NEW.workspace_id AND pointer.purpose='operational'
      AND definition.status='active'
    UNION ALL
    SELECT definition.*,workspace.brand_id,'semantic'::text reconcile_kind
    FROM signal_population_definitions definition
    JOIN signal_workspaces workspace ON workspace.id=definition.workspace_id
    WHERE definition.workspace_id=NEW.workspace_id AND definition.population_key='primary-brand-operational'
      AND definition.purpose='operational' AND definition.status='draft'
      AND definition.definition->>'contract_version'='signal-operational-primary-brand-semantic-v2'
    UNION ALL
    SELECT definition.*,workspace.brand_id,'attributable'::text reconcile_kind
    FROM signal_population_definitions definition
    JOIN signal_workspaces workspace ON workspace.id=definition.workspace_id
    WHERE definition.workspace_id=NEW.workspace_id AND definition.status='draft'
      AND definition.definition->>'contract_version'='signal-operational-attributable-semantic-v1'
  LOOP
    semantic_contract:=COALESCE(population.definition->>'contract_version'
      ='signal-operational-primary-brand-semantic-v2',false);
    WITH roots AS MATERIALIZED (
      SELECT mention.id,mention.inclusion_status,mention.quality_score,mention.published_at
      FROM signal_mention_import_memberships membership
      JOIN mentions mention ON mention.id=membership.mention_id AND mention.workspace_id=NEW.workspace_id
        AND mention.canonical_mention_id=mention.id
      WHERE membership.import_batch_id=NEW.id AND membership.workspace_id=NEW.workspace_id
    ), attributed AS MATERIALIZED (
      SELECT DISTINCT attribution.mention_id
      FROM signal_mention_attributions attribution JOIN roots ON roots.id=attribution.mention_id
      WHERE attribution.workspace_id=NEW.workspace_id AND (
        (population.reconcile_kind='operational' AND NOT semantic_contract
          AND attribution.attribution_basis='source_intent' AND attribution.review_status='approved'
          AND attribution.scope=ANY(population.allowed_scopes))
        OR ((population.reconcile_kind='semantic' OR (population.reconcile_kind='operational' AND semantic_contract))
          AND attribution.attribution_basis='mention_semantic' AND attribution.is_current
          AND attribution.review_status='approved' AND attribution.eligibility_status='eligible'
          AND attribution.scope='primary_brand' AND attribution.entity_type='brand'
          AND attribution.entity_id=population.brand_id)
        OR (population.reconcile_kind='attributable' AND attribution.attribution_basis='mention_semantic'
          AND attribution.is_current AND attribution.review_status='approved'
          AND attribution.eligibility_status='eligible'
          AND attribution.scope IN ('primary_brand','competitor','category','reference')
          AND signal_population_policy_entity_is_governed_v1(NEW.workspace_id,
            attribution.scope,attribution.entity_type,attribution.entity_id))
      )
    ), decisions AS (
      SELECT roots.*,
        CASE WHEN population.reconcile_kind='operational' THEN
          roots.inclusion_status=population.acceptance_status
          AND (population.min_quality_score IS NULL OR COALESCE(roots.quality_score,0)>=population.min_quality_score)
          AND (population.period_start IS NULL OR roots.published_at::date>=population.period_start)
          AND (population.period_end IS NULL OR roots.published_at::date<=population.period_end)
          AND attributed.mention_id IS NOT NULL
        ELSE roots.inclusion_status='included' AND attributed.mention_id IS NOT NULL END eligible
      FROM roots LEFT JOIN attributed ON attributed.mention_id=roots.id
    )
    INSERT INTO signal_population_memberships(population_id,workspace_id,mention_id,
      membership_status,membership_reason,effective_at,removed_at)
    SELECT population.id,NEW.workspace_id,decision.id,
      CASE WHEN eligible THEN 'included' ELSE 'excluded' END,
      CASE WHEN population.reconcile_kind='attributable' THEN
        CASE WHEN eligible THEN 'semantic_attributable_approved_eligible_v1' ELSE 'semantic_attributable_not_eligible_v1' END
      WHEN population.reconcile_kind='semantic' THEN
        CASE WHEN eligible THEN 'semantic_primary_brand_approved_eligible_v2'
          WHEN inclusion_status<>'included' THEN 'mention_acceptance_not_eligible' ELSE 'semantic_assertion_not_eligible' END
      ELSE CASE
        WHEN eligible AND semantic_contract THEN 'semantic_primary_brand_approved_eligible_v2'
        WHEN eligible THEN 'governed_operational_population_v1'
        WHEN inclusion_status<>population.acceptance_status THEN 'mention_acceptance_not_eligible'
        WHEN population.min_quality_score IS NOT NULL AND COALESCE(quality_score,0)<population.min_quality_score THEN 'quality_not_eligible'
        WHEN population.period_start IS NOT NULL AND published_at::date<population.period_start THEN 'period_not_eligible'
        WHEN population.period_end IS NOT NULL AND published_at::date>population.period_end THEN 'period_not_eligible'
        WHEN semantic_contract THEN 'semantic_assertion_not_eligible' ELSE 'scope_or_review_not_eligible' END END,
      now(),CASE WHEN eligible THEN NULL ELSE now() END
    FROM decisions decision
    WHERE population.reconcile_kind='operational' OR eligible OR EXISTS(
      SELECT 1 FROM signal_population_memberships prior WHERE prior.population_id=population.id AND prior.mention_id=decision.id)
    ON CONFLICT(population_id,mention_id) DO UPDATE SET
      workspace_id=EXCLUDED.workspace_id,membership_status=EXCLUDED.membership_status,
      membership_reason=EXCLUDED.membership_reason,
      effective_at=CASE WHEN signal_population_memberships.membership_status IS DISTINCT FROM EXCLUDED.membership_status
        THEN now() ELSE signal_population_memberships.effective_at END,
      removed_at=EXCLUDED.removed_at;

    -- 0073 also retires prior draft memberships when a former root is no longer
    -- canonical. Operational and primary-brand candidate helpers simply skip it.
    IF population.reconcile_kind='attributable' THEN
      UPDATE signal_population_memberships prior SET membership_status='excluded',
        membership_reason='canonical_identity_changed_v1',removed_at=now()
      WHERE prior.population_id=population.id AND prior.mention_id IN (
        SELECT membership.mention_id FROM signal_mention_import_memberships membership
        WHERE membership.import_batch_id=NEW.id AND membership.workspace_id=NEW.workspace_id
          AND NOT EXISTS(SELECT 1 FROM mentions mention WHERE mention.id=membership.mention_id
            AND mention.workspace_id=NEW.workspace_id AND mention.canonical_mention_id=mention.id))
        AND (prior.membership_status<>'excluded' OR prior.removed_at IS NULL);
    END IF;
  END LOOP;
  PERFORM set_config('noisia.import_bulk_reconcile','off',true);
  PERFORM refresh_signal_operational_bridge_membership_digest_v1(NEW.workspace_id);
  FOR population IN SELECT id,definition->>'contract_version' contract_version
    FROM signal_population_definitions WHERE workspace_id=NEW.workspace_id AND status='draft'
      AND definition->>'contract_version' IN (
        'signal-operational-primary-brand-semantic-v2','signal-operational-attributable-semantic-v1')
  LOOP
    IF population.contract_version='signal-operational-primary-brand-semantic-v2' THEN
      PERFORM refresh_signal_semantic_candidate_membership_digest(population.id);
    ELSE
      PERFORM refresh_signal_attributable_semantic_base_digest_v1(population.id);
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;

-- Existing atomic acceptance entry; only add the early publication lock.
CREATE OR REPLACE FUNCTION complete_signal_workspace_import_v1(
  target_import_batch_id uuid,target_worker_job_id text,target_file_hash text,
  target_record_count integer,target_included_count integer,
  target_excluded_count integer,target_duplicate_count integer,target_processed_bytes bigint
)
RETURNS TABLE(import_batch_id uuid,accepted boolean,accepted_batch_id uuid)
LANGUAGE plpgsql AS $$
DECLARE target import_batches%ROWTYPE;DECLARE duplicate_batch_id uuid;DECLARE accepted_record record;DECLARE locked_pointer uuid;DECLARE pointer_attempt integer;
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
  -- Serialize publication before content-revision triggers can lock a root or
  -- a population definition. Do not prelock definitions ahead of those roots.
  -- Same first row lock as promote_signal_workspace_population. A promotion
  -- deletes/reinserts the pointer; retry a fresh statement if the old row vanished
  -- while waiting (REPEATABLE READ instead raises its native 40001).
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-import-completion:'||target.workspace_id::text,0));
  FOR pointer_attempt IN 1..8 LOOP
    SELECT id INTO locked_pointer FROM signal_workspace_population_pointers
      WHERE workspace_id=target.workspace_id AND purpose='operational' FOR UPDATE;
    EXIT WHEN FOUND;
    EXIT WHEN NOT EXISTS(SELECT 1 FROM signal_workspace_population_pointers
      WHERE workspace_id=target.workspace_id AND purpose='operational');
    IF pointer_attempt=8 THEN
      RAISE EXCEPTION 'workspace_import_population_changed' USING ERRCODE='40001';
    END IF;
  END LOOP;
  -- Share the existing creation locks before locking definitions: a draft
  -- cannot appear between the lock query and the population cursor.
  PERFORM pg_advisory_xact_lock(hashtextextended(target.workspace_id::text||':primary-brand-semantic-v2',0));
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','attributable-semantic-base-v1',target.workspace_id::text),0));
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
