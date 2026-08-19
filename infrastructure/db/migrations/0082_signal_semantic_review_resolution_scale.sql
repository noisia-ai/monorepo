-- Semantic Review and autonomous Resolution at 100K+ canonical roots.
--
-- This migration is forward-only and data-neutral. It creates a versioned read
-- projection, durable invalidation/outbox state, and parent/child resolution
-- controls. It does not create a run, enqueue a job, call a provider, approve an
-- assertion, or move an operational pointer.

CREATE TABLE IF NOT EXISTS signal_semantic_review_projection_state (
  workspace_id uuid PRIMARY KEY REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  current_generation bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'stale',
  snapshot_digest text,
  population_digest text,
  identity_digest text,
  governance_digest text,
  resolution_selection_digest text,
  resolution_selected_character_count bigint NOT NULL DEFAULT 0,
  resolution_next_policy_transition_at timestamptz,
  incomplete_provenance_count integer NOT NULL DEFAULT 0,
  projected_root_count integer NOT NULL DEFAULT 0,
  dirty_root_count integer NOT NULL DEFAULT 0,
  full_rebuild_required boolean NOT NULL DEFAULT true,
  last_reason text NOT NULL DEFAULT 'initial_projection_required',
  reconciled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_semantic_review_projection_state_status CHECK (
    status IN ('stale','reconciling','ready','failed')
  ),
  CONSTRAINT signal_semantic_review_projection_state_counts CHECK (
    current_generation >= 0 AND projected_root_count >= 0 AND dirty_root_count >= 0
    AND resolution_selected_character_count >= 0 AND incomplete_provenance_count >= 0
  ),
  CONSTRAINT signal_semantic_review_projection_state_hashes CHECK (
    (snapshot_digest IS NULL OR snapshot_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (population_digest IS NULL OR population_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (identity_digest IS NULL OR identity_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (governance_digest IS NULL OR governance_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (resolution_selection_digest IS NULL
      OR resolution_selection_digest ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT signal_semantic_review_projection_state_ready CHECK (
    status <> 'ready' OR (
      current_generation >= 1 AND snapshot_digest IS NOT NULL
      AND population_digest IS NOT NULL AND identity_digest IS NOT NULL
      AND governance_digest IS NOT NULL AND resolution_selection_digest IS NOT NULL
      AND full_rebuild_required=false
      AND dirty_root_count=0 AND reconciled_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS signal_semantic_review_projection_items (
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  generation bigint NOT NULL,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  queue_state text NOT NULL,
  published_at timestamptz NOT NULL,
  platform text NOT NULL,
  excerpt text NOT NULL,
  title text,
  account jsonb,
  url_host text,
  source_intents jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  proposed_assertions jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  current_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  confidence_bands text[] NOT NULL DEFAULT ARRAY[]::text[],
  current_assertions jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_resolution text NOT NULL,
  resolution_eligibility text NOT NULL DEFAULT 'licensing_unknown',
  resolution_authority_digest text,
  resolution_next_policy_transition_at timestamptz,
  character_count integer NOT NULL DEFAULT 0,
  context_hash text NOT NULL,
  projection_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,generation,mention_id),
  CONSTRAINT signal_semantic_review_projection_item_generation CHECK (generation>=1),
  CONSTRAINT signal_semantic_review_projection_item_state CHECK (
    queue_state IN ('candidate_pending','current_approved','current_rejected','unresolved','needs_context')
  ),
  CONSTRAINT signal_semantic_review_projection_item_resolution CHECK (
    candidate_resolution IN ('governed_identity_match','no_governed_identity_match','insufficient_context')
  ),
  CONSTRAINT signal_semantic_review_projection_item_resolution_eligibility CHECK (
    resolution_eligibility IN (
      'eligible','quality_excluded','quality_unknown','retention_blocked',
      'retention_expired','retention_unknown','licensing_denied',
      'licensing_expired','licensing_unknown'
    )
  ),
  CONSTRAINT signal_semantic_review_projection_item_json CHECK (
    jsonb_typeof(source_intents)='array' AND jsonb_typeof(proposed_assertions)='array'
    AND jsonb_typeof(current_assertions)='array'
    AND (account IS NULL OR jsonb_typeof(account)='object')
  ),
  CONSTRAINT signal_semantic_review_projection_item_counts CHECK (character_count>=0),
  CONSTRAINT signal_semantic_review_projection_item_hashes CHECK (
    context_hash ~ '^sha256:[0-9a-f]{64}$'
    AND projection_hash ~ '^sha256:[0-9a-f]{64}$'
    AND (resolution_authority_digest IS NULL
      OR resolution_authority_digest ~ '^sha256:[0-9a-f]{64}$')
  )
);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_page
  ON signal_semantic_review_projection_items(
    workspace_id,generation,queue_state,published_at DESC,mention_id DESC
  );
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_platform
  ON signal_semantic_review_projection_items(
    workspace_id,generation,platform,published_at DESC,mention_id DESC
  );
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_period
  ON signal_semantic_review_projection_items(
    workspace_id,generation,published_at DESC,mention_id DESC
  );
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_mention
  ON signal_semantic_review_projection_items(workspace_id,mention_id,generation DESC);
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_scopes
  ON signal_semantic_review_projection_items USING gin(proposed_scopes);
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_current_scopes
  ON signal_semantic_review_projection_items USING gin(current_scopes);
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_confidence
  ON signal_semantic_review_projection_items USING gin(confidence_bands);
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_sources
  ON signal_semantic_review_projection_items USING gin(source_ids);
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_resolution
  ON signal_semantic_review_projection_items(
    workspace_id,generation,resolution_eligibility,queue_state,mention_id
  );

CREATE TABLE IF NOT EXISTS signal_semantic_review_projection_aggregates (
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  generation bigint NOT NULL,
  dimension text NOT NULL,
  dimension_value text NOT NULL,
  root_count integer NOT NULL,
  PRIMARY KEY(workspace_id,generation,dimension,dimension_value),
  CONSTRAINT signal_semantic_review_projection_aggregate_dimension CHECK (
    dimension IN (
      'total','candidate_assertions','state','scope','confidence','platform','source',
      'resolution_eligibility','resolution_status','resolution_stratum'
    )
  ),
  CONSTRAINT signal_semantic_review_projection_aggregate_count CHECK (root_count>=0)
);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_aggregates_lookup
  ON signal_semantic_review_projection_aggregates(workspace_id,generation,dimension,dimension_value);

CREATE TABLE IF NOT EXISTS signal_semantic_review_projection_dirty_roots (
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  reason text NOT NULL,
  dirty_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,mention_id)
);

CREATE TABLE IF NOT EXISTS signal_semantic_review_projection_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT signal_semantic_review_projection_outbox_status CHECK (
    status IN ('pending','dispatching','processing','completed','failed','dead_letter','superseded')
  ),
  CONSTRAINT signal_semantic_review_projection_outbox_attempt CHECK (attempt>=0),
  CONSTRAINT signal_semantic_review_projection_outbox_lease CHECK (
    (status IN ('dispatching','processing'))=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_review_projection_outbox_active
  ON signal_semantic_review_projection_outbox(workspace_id)
  WHERE status IN ('pending','dispatching','processing','failed');
CREATE INDEX IF NOT EXISTS idx_signal_semantic_review_projection_outbox_recovery
  ON signal_semantic_review_projection_outbox(available_at,created_at,id)
  WHERE status IN ('pending','failed','dispatching','processing');

CREATE OR REPLACE FUNCTION queue_signal_semantic_review_projection_refresh_v1(
  target_workspace_id uuid,
  target_mention_id uuid,
  target_reason text,
  target_full_rebuild boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_workspace_id IS NULL OR target_reason IS NULL OR btrim(target_reason)='' THEN
    RAISE EXCEPTION 'Semantic Review projection invalidation is incomplete.' USING ERRCODE='23514';
  END IF;
  INSERT INTO signal_semantic_review_projection_state(
    workspace_id,status,full_rebuild_required,last_reason,updated_at
  ) VALUES(target_workspace_id,'stale',target_full_rebuild,target_reason,now())
  ON CONFLICT(workspace_id) DO UPDATE SET
    status='stale',
    full_rebuild_required=signal_semantic_review_projection_state.full_rebuild_required
      OR EXCLUDED.full_rebuild_required,
    last_reason=EXCLUDED.last_reason,
    updated_at=now();
  IF target_mention_id IS NOT NULL THEN
    INSERT INTO signal_semantic_review_projection_dirty_roots(workspace_id,mention_id,reason,dirty_at)
    SELECT target_workspace_id,root.id,target_reason,now()
    FROM mentions observed
    JOIN mentions root ON root.workspace_id=observed.workspace_id
      AND root.id=observed.canonical_mention_id
    WHERE observed.workspace_id=target_workspace_id AND observed.id=target_mention_id
    ON CONFLICT(workspace_id,mention_id) DO UPDATE SET reason=EXCLUDED.reason,dirty_at=now();
  END IF;
  UPDATE signal_semantic_review_projection_state state SET dirty_root_count=(
    SELECT count(*)::int FROM signal_semantic_review_projection_dirty_roots dirty
    WHERE dirty.workspace_id=target_workspace_id
  ) WHERE state.workspace_id=target_workspace_id;
  INSERT INTO signal_semantic_review_projection_outbox(workspace_id,status,reason)
  VALUES(target_workspace_id,'pending',target_reason)
  ON CONFLICT(workspace_id) WHERE status IN ('pending','dispatching','processing','failed')
  DO UPDATE SET status=CASE
      WHEN signal_semantic_review_projection_outbox.status IN ('dispatching','processing')
        THEN signal_semantic_review_projection_outbox.status
      ELSE 'pending' END,
    reason=EXCLUDED.reason,available_at=now(),error_code=NULL,updated_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION begin_signal_semantic_review_projection_v1(
  target_workspace_id uuid,
  target_lease_token uuid
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE next_generation bigint;
BEGIN
  IF target_workspace_id IS NULL OR target_lease_token IS NULL THEN
    RAISE EXCEPTION 'Semantic Review projection lease is required.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':semantic-review-projection',0));
  IF NOT EXISTS(
    SELECT 1 FROM signal_semantic_review_projection_outbox item
    WHERE item.workspace_id=target_workspace_id
      AND item.lease_token=target_lease_token
      AND item.status IN ('dispatching','processing')
      AND item.lease_expires_at>now()
  ) THEN
    RAISE EXCEPTION 'Semantic Review projection lease is invalid or expired.' USING ERRCODE='55000';
  END IF;
  INSERT INTO signal_semantic_review_projection_state(workspace_id) VALUES(target_workspace_id)
  ON CONFLICT(workspace_id) DO NOTHING;
  SELECT current_generation+1 INTO next_generation
  FROM signal_semantic_review_projection_state WHERE workspace_id=target_workspace_id FOR UPDATE;
  UPDATE signal_semantic_review_projection_state SET status='reconciling',updated_at=now()
  WHERE workspace_id=target_workspace_id;
  UPDATE signal_semantic_review_projection_outbox SET status='processing',lease_token=target_lease_token,
    lease_expires_at=now()+interval '15 minutes',updated_at=now()
  WHERE workspace_id=target_workspace_id AND lease_token=target_lease_token
    AND status IN ('dispatching','processing');
  RETURN next_generation;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_signal_semantic_review_resolution_authority_v1(
  target_workspace_id uuid,
  target_generation bigint,
  target_only_dirty boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE refreshed integer;
BEGIN
  IF target_generation<1 THEN
    RAISE EXCEPTION 'Semantic Review resolution authority generation is invalid.'
      USING ERRCODE='23514';
  END IF;

  WITH roots AS (
    SELECT item.mention_id,mention.quality_score,
      COALESCE(mention.quality_flags,'[]'::jsonb) AS quality_flags
    FROM signal_semantic_review_projection_items item
    JOIN mentions mention ON mention.workspace_id=item.workspace_id
      AND mention.id=item.mention_id AND mention.canonical_mention_id=mention.id
      AND mention.inclusion_status='included'
    WHERE item.workspace_id=target_workspace_id AND item.generation=target_generation
      AND (NOT target_only_dirty OR EXISTS(
        SELECT 1 FROM signal_semantic_review_projection_dirty_roots dirty
        WHERE dirty.workspace_id=item.workspace_id AND dirty.mention_id=item.mention_id
      ))
  ), memberships AS MATERIALIZED (
    SELECT DISTINCT root.mention_id,membership.data_source_id,membership.import_batch_id
    FROM roots root
    JOIN mentions provenance_mention
      ON provenance_mention.workspace_id=target_workspace_id
     AND provenance_mention.canonical_mention_id=root.mention_id
    JOIN signal_mention_import_memberships membership
      ON membership.workspace_id=target_workspace_id
     AND membership.mention_id=provenance_mention.id
    JOIN import_batches batch ON batch.id=membership.import_batch_id
      AND batch.workspace_id=membership.workspace_id AND batch.status='completed'
  ), source_imports AS MATERIALIZED (
    SELECT DISTINCT data_source_id,import_batch_id FROM memberships
  ), selected_bindings AS MATERIALIZED (
    SELECT pair.data_source_id,pair.import_batch_id,
      binding.id,binding.status,binding.effective_from,binding.effective_to,
      binding.binding_version,binding.quality_policy_id,
      binding.retention_policy_id,binding.licensing_policy_id
    FROM source_imports pair
    LEFT JOIN LATERAL (
      SELECT candidate.* FROM signal_provenance_policy_bindings candidate
      WHERE candidate.workspace_id=target_workspace_id
        AND candidate.data_source_id=pair.data_source_id
        AND (candidate.import_batch_id=pair.import_batch_id
          OR candidate.import_batch_id IS NULL)
      ORDER BY (
        candidate.status='active' AND candidate.effective_from<=clock_timestamp()
        AND (candidate.effective_to IS NULL OR candidate.effective_to>clock_timestamp())
      ) DESC,(candidate.import_batch_id IS NOT NULL) DESC,
        candidate.binding_version DESC,candidate.id
      LIMIT 1
    ) binding ON true
  ), paths AS (
    SELECT root.mention_id,binding.id AS binding_id,
      quality.id AS quality_policy_id,quality.definition_hash AS quality_hash,
      retention.id AS retention_policy_id,retention.definition_hash AS retention_hash,
      licensing.id AS licensing_policy_id,licensing.definition_hash AS licensing_hash,
      transition.next_transition,
      CASE
        WHEN binding.id IS NULL OR binding.status<>'active'
          OR binding.effective_from>clock_timestamp() THEN 'licensing_unknown'
        WHEN binding.effective_to IS NOT NULL AND binding.effective_to<=clock_timestamp()
          THEN 'licensing_expired'
        WHEN quality.id IS NULL OR quality.status<>'active'
          OR quality.effective_from>clock_timestamp()
          OR (quality.effective_to IS NOT NULL AND quality.effective_to<=clock_timestamp())
          OR quality.canonical_root_disposition='not_available' THEN 'quality_unknown'
        WHEN quality.canonical_root_disposition='blocked'
          OR (quality.min_quality_score IS NOT NULL
            AND COALESCE(root.quality_score,-1)<quality.min_quality_score)
          OR EXISTS (SELECT 1 FROM unnest(quality.required_quality_flags) flag
            WHERE NOT root.quality_flags ? flag)
          OR EXISTS (SELECT 1 FROM unnest(quality.forbidden_quality_flags) flag
            WHERE root.quality_flags ? flag) THEN 'quality_excluded'
        WHEN retention.id IS NULL OR retention.status<>'active'
          OR retention.effective_from>clock_timestamp()
          OR retention.retention_state='not_available' THEN 'retention_unknown'
        WHEN retention.effective_to IS NOT NULL AND retention.effective_to<=clock_timestamp()
          THEN 'retention_expired'
        WHEN retention.retention_state='blocked' THEN 'retention_blocked'
        WHEN retention.retention_mode='until' AND retention.retain_until<=clock_timestamp()
          THEN 'retention_expired'
        WHEN licensing.id IS NULL OR licensing.status<>'active'
          OR licensing.effective_from>clock_timestamp() THEN 'licensing_unknown'
        WHEN licensing.effective_to IS NOT NULL AND licensing.effective_to<=clock_timestamp()
          THEN 'licensing_expired'
        WHEN EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage
          WHERE usage.licensing_policy_id=licensing.id
            AND usage.usage_purpose='llm-processing' AND usage.decision='prohibited')
          THEN 'licensing_denied'
        WHEN NOT EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage
          WHERE usage.licensing_policy_id=licensing.id
            AND usage.usage_purpose='llm-processing' AND usage.decision='allowed')
          THEN 'licensing_unknown'
        ELSE 'eligible'
      END AS path_state
    FROM roots root
    JOIN memberships membership ON membership.mention_id=root.mention_id
    LEFT JOIN selected_bindings binding
      ON binding.data_source_id=membership.data_source_id
     AND binding.import_batch_id=membership.import_batch_id
    LEFT JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
    LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
    LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
    LEFT JOIN LATERAL (
      SELECT min(value) AS next_transition FROM (VALUES
        (binding.effective_to),(quality.effective_to),(retention.effective_to),
        (retention.retain_until),(licensing.effective_to)
      ) boundary(value) WHERE value IS NOT NULL
    ) transition ON true
  ), authority AS (
    SELECT root.mention_id,
      CASE
        WHEN bool_or(path.path_state='eligible') THEN 'eligible'
        WHEN bool_or(path.path_state='quality_excluded') THEN 'quality_excluded'
        WHEN bool_or(path.path_state='quality_unknown') THEN 'quality_unknown'
        WHEN bool_or(path.path_state='retention_blocked') THEN 'retention_blocked'
        WHEN bool_or(path.path_state='retention_expired') THEN 'retention_expired'
        WHEN bool_or(path.path_state='retention_unknown') THEN 'retention_unknown'
        WHEN bool_or(path.path_state='licensing_denied') THEN 'licensing_denied'
        WHEN bool_or(path.path_state='licensing_expired') THEN 'licensing_expired'
        ELSE 'licensing_unknown'
      END AS eligibility,
      CASE WHEN bool_or(path.path_state='eligible') THEN
        'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|',
          path.binding_id::text,path.quality_policy_id::text,path.retention_policy_id::text,
          path.licensing_policy_id::text,path.quality_hash,path.retention_hash,
          path.licensing_hash),E'\n' ORDER BY path.binding_id)
          FILTER (WHERE path.path_state='eligible'),''),'UTF8')),'hex')
      END AS authority_digest,
      min(path.next_transition) FILTER (WHERE path.path_state='eligible') AS next_transition
    FROM roots root LEFT JOIN paths path ON path.mention_id=root.mention_id
    GROUP BY root.mention_id
  )
  UPDATE signal_semantic_review_projection_items item SET
    resolution_eligibility=authority.eligibility,
    resolution_authority_digest=authority.authority_digest,
    resolution_next_policy_transition_at=authority.next_transition,
    updated_at=now()
  FROM authority
  WHERE item.workspace_id=target_workspace_id AND item.generation=target_generation
    AND item.mention_id=authority.mention_id;
  GET DIAGNOSTICS refreshed=ROW_COUNT;
  RETURN refreshed;
END;
$$;

CREATE OR REPLACE FUNCTION complete_signal_semantic_review_projection_v1(
  target_workspace_id uuid,
  target_generation bigint,
  target_identity_digest text,
  target_governance_digest text,
  target_lease_token uuid
)
RETURNS TABLE(snapshot_digest text,population_digest text,projected_root_count integer)
LANGUAGE plpgsql
AS $$
DECLARE roots integer;
DECLARE population_hash text;
DECLARE snapshot_hash text;
DECLARE governance_hash text;
DECLARE selection_hash text;
DECLARE selected_characters bigint;
DECLARE incomplete_roots integer;
DECLARE next_transition timestamptz;
BEGIN
  IF target_generation<1 OR target_identity_digest!~'^sha256:[0-9a-f]{64}$'
     OR target_governance_digest!~'^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Semantic Review projection completion is invalid.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':semantic-review-projection',0));
  IF NOT EXISTS(
    SELECT 1 FROM signal_semantic_review_projection_outbox item
    WHERE item.workspace_id=target_workspace_id AND item.lease_token=target_lease_token
      AND item.status='processing' AND item.lease_expires_at>now()
  ) THEN
    RAISE EXCEPTION 'Semantic Review projection completion lease is invalid or expired.'
      USING ERRCODE='40001';
  END IF;
  SELECT count(*)::int,
    'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
      concat_ws('|',mention_id::text,projection_hash),E'\n' ORDER BY mention_id),''),'UTF8')),'hex')
  INTO roots,population_hash
  FROM signal_semantic_review_projection_items
  WHERE workspace_id=target_workspace_id AND generation=target_generation;
  SELECT 'sha256:'||encode(sha256(convert_to(concat_ws('|',target_governance_digest,
      COALESCE(string_agg(concat_ws('|',mention_id::text,resolution_eligibility,
        COALESCE(resolution_authority_digest,'∅')),
        E'\n' ORDER BY mention_id),'')),'UTF8')),'hex'),
    'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
      concat_ws('|',mention_id::text,context_hash),E'\n' ORDER BY mention_id)
      FILTER (WHERE resolution_eligibility='eligible'
        AND queue_state NOT IN ('current_approved','current_rejected')),''),'UTF8')),'hex'),
    COALESCE(sum(character_count) FILTER (WHERE resolution_eligibility='eligible'
      AND queue_state NOT IN ('current_approved','current_rejected')),0)::bigint,
    min(resolution_next_policy_transition_at) FILTER (WHERE resolution_eligibility='eligible')
  INTO governance_hash,selection_hash,selected_characters,next_transition
  FROM signal_semantic_review_projection_items
  WHERE workspace_id=target_workspace_id AND generation=target_generation;
  SELECT count(*)::int INTO incomplete_roots
  FROM mentions mention
  WHERE mention.workspace_id=target_workspace_id
    AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
    AND signal_mention_has_only_incomplete_imports_v1(target_workspace_id,mention.id);
  snapshot_hash:='sha256:'||encode(sha256(convert_to(concat_ws('|',
    'semantic-review-projection-v1',target_workspace_id::text,target_generation::text,
    population_hash,target_identity_digest,governance_hash,selection_hash,roots::text),'UTF8')),'hex');
  DELETE FROM signal_semantic_review_projection_aggregates
  WHERE workspace_id=target_workspace_id AND generation=target_generation;
  INSERT INTO signal_semantic_review_projection_aggregates(workspace_id,generation,dimension,dimension_value,root_count)
  SELECT target_workspace_id,target_generation,'total','all',roots
  UNION ALL SELECT target_workspace_id,target_generation,'candidate_assertions','all',
    COALESCE(sum(jsonb_array_length(proposed_assertions)),0)::int
    FROM signal_semantic_review_projection_items
    WHERE workspace_id=target_workspace_id AND generation=target_generation
  UNION ALL SELECT target_workspace_id,target_generation,'state',queue_state,count(*)::int
    FROM signal_semantic_review_projection_items WHERE workspace_id=target_workspace_id AND generation=target_generation GROUP BY queue_state
  UNION ALL SELECT target_workspace_id,target_generation,'scope',scope_value,count(DISTINCT mention_id)::int
    FROM signal_semantic_review_projection_items item
    CROSS JOIN LATERAL (
      SELECT unnest(item.proposed_scopes) AS scope_value
      UNION SELECT unnest(item.current_scopes) AS scope_value
    ) scopes
    WHERE item.workspace_id=target_workspace_id AND item.generation=target_generation GROUP BY scope_value
  UNION ALL SELECT target_workspace_id,target_generation,'confidence',confidence_value,count(DISTINCT mention_id)::int
    FROM signal_semantic_review_projection_items item
    CROSS JOIN LATERAL unnest(item.confidence_bands) confidence_value
    WHERE item.workspace_id=target_workspace_id AND item.generation=target_generation GROUP BY confidence_value
  UNION ALL SELECT target_workspace_id,target_generation,'platform',platform,count(*)::int
    FROM signal_semantic_review_projection_items WHERE workspace_id=target_workspace_id AND generation=target_generation GROUP BY platform
  UNION ALL SELECT target_workspace_id,target_generation,'source',source_id::text,count(DISTINCT mention_id)::int
    FROM signal_semantic_review_projection_items item
    CROSS JOIN LATERAL unnest(item.source_ids) source_id
    WHERE item.workspace_id=target_workspace_id AND item.generation=target_generation GROUP BY source_id
  UNION ALL SELECT target_workspace_id,target_generation,'resolution_eligibility',
    resolution_eligibility,count(*)::int
    FROM signal_semantic_review_projection_items
    WHERE workspace_id=target_workspace_id AND generation=target_generation
    GROUP BY resolution_eligibility
  UNION ALL SELECT target_workspace_id,target_generation,'resolution_status',
    CASE WHEN queue_state IN ('current_approved','current_rejected')
      THEN 'resolved' ELSE 'unresolved' END,count(*)::int
    FROM signal_semantic_review_projection_items
    WHERE workspace_id=target_workspace_id AND generation=target_generation
      AND resolution_eligibility='eligible'
    GROUP BY CASE WHEN queue_state IN ('current_approved','current_rejected')
      THEN 'resolved' ELSE 'unresolved' END
  UNION ALL SELECT target_workspace_id,target_generation,'resolution_stratum',
    CASE
      WHEN queue_state='candidate_pending'
        AND candidate_resolution='governed_identity_match' THEN 'deterministic'
      WHEN queue_state='needs_context' THEN 'needs_context'
      ELSE 'ambiguous'
    END,count(*)::int
    FROM signal_semantic_review_projection_items
    WHERE workspace_id=target_workspace_id AND generation=target_generation
      AND resolution_eligibility='eligible'
      AND queue_state NOT IN ('current_approved','current_rejected')
    GROUP BY CASE
      WHEN queue_state='candidate_pending'
        AND candidate_resolution='governed_identity_match' THEN 'deterministic'
      WHEN queue_state='needs_context' THEN 'needs_context'
      ELSE 'ambiguous'
    END;
  UPDATE signal_semantic_review_projection_state SET
    current_generation=target_generation,status='ready',snapshot_digest=snapshot_hash,
    population_digest=population_hash,identity_digest=target_identity_digest,
    governance_digest=governance_hash,resolution_selection_digest=selection_hash,
    resolution_selected_character_count=selected_characters,
    resolution_next_policy_transition_at=next_transition,
    incomplete_provenance_count=incomplete_roots,projected_root_count=roots,
    dirty_root_count=0,full_rebuild_required=false,last_reason='reconciled',
    reconciled_at=now(),updated_at=now()
  WHERE workspace_id=target_workspace_id;
  DELETE FROM signal_semantic_review_projection_dirty_roots WHERE workspace_id=target_workspace_id;
  UPDATE signal_semantic_review_projection_outbox SET status='completed',lease_token=NULL,
    lease_expires_at=NULL,completed_at=now(),updated_at=now()
  WHERE workspace_id=target_workspace_id AND lease_token=target_lease_token
    AND status='processing';
  DELETE FROM signal_semantic_review_projection_items
  WHERE workspace_id=target_workspace_id AND generation<>target_generation;
  DELETE FROM signal_semantic_review_projection_aggregates
  WHERE workspace_id=target_workspace_id AND generation<>target_generation;
  RETURN QUERY SELECT snapshot_hash,population_hash,roots;
END;
$$;

CREATE OR REPLACE FUNCTION claim_signal_semantic_review_projection_v1(
  target_limit integer DEFAULT 5,
  target_lease_seconds integer DEFAULT 900
)
RETURNS TABLE(outbox_id uuid,workspace_id uuid,lease_token uuid,reason text)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT item.id FROM signal_semantic_review_projection_outbox item
    WHERE (
      item.status IN ('pending','failed') AND item.available_at<=now()
    ) OR (
      item.status IN ('dispatching','processing') AND item.lease_expires_at<=now()
    )
    ORDER BY item.available_at,item.created_at,item.id
    FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(target_limit,1),20)
  ), claimed AS (
    UPDATE signal_semantic_review_projection_outbox item SET status='dispatching',
      attempt=item.attempt+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>LEAST(GREATEST(target_lease_seconds,60),3600)),
      error_code=NULL,updated_at=now()
    FROM candidates WHERE item.id=candidates.id
    RETURNING item.id,item.workspace_id,item.lease_token,item.reason
  ) SELECT claimed.id,claimed.workspace_id,claimed.lease_token,claimed.reason FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION fail_signal_semantic_review_projection_v1(
  target_outbox_id uuid,target_lease_token uuid,target_error_code text,target_retry_seconds integer DEFAULT 30
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_semantic_review_projection_outbox SET
    status=CASE WHEN attempt>=8 THEN 'dead_letter' ELSE 'failed' END,
    lease_token=NULL,lease_expires_at=NULL,error_code=left(target_error_code,120),
    available_at=now()+make_interval(secs=>LEAST(GREATEST(target_retry_seconds,1),3600)),updated_at=now()
  WHERE id=target_outbox_id AND lease_token=target_lease_token
    AND status IN ('dispatching','processing');
  IF NOT FOUND THEN RAISE EXCEPTION 'Semantic Review projection lease changed.' USING ERRCODE='40001'; END IF;
END;
$$;

-- Statement-level invalidation avoids one outbox write per imported root.
CREATE OR REPLACE FUNCTION invalidate_signal_semantic_review_from_attributions_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace_row record;
BEGIN
  INSERT INTO signal_semantic_review_projection_dirty_roots(
    workspace_id,mention_id,reason,dirty_at
  )
  SELECT DISTINCT changed.workspace_id,root.id,
    'semantic_assertion_or_provenance_changed',now()
  FROM new_rows changed
  JOIN mentions observed ON observed.workspace_id=changed.workspace_id
    AND observed.id=changed.mention_id
  JOIN mentions root ON root.workspace_id=observed.workspace_id
    AND root.id=observed.canonical_mention_id
  WHERE changed.attribution_basis='mention_semantic'
    OR EXISTS(
      SELECT 1 FROM import_batches batch
      WHERE batch.id=changed.import_batch_id
        AND batch.workspace_id=changed.workspace_id
        AND batch.status='completed'
    )
  ON CONFLICT(workspace_id,mention_id) DO UPDATE SET
    reason=EXCLUDED.reason,dirty_at=EXCLUDED.dirty_at;
  FOR workspace_row IN
    SELECT DISTINCT changed.workspace_id
    FROM new_rows changed
    WHERE changed.attribution_basis='mention_semantic'
      OR EXISTS(
        SELECT 1 FROM import_batches batch
        WHERE batch.id=changed.import_batch_id
          AND batch.workspace_id=changed.workspace_id
          AND batch.status='completed'
      )
  LOOP
    PERFORM queue_signal_semantic_review_projection_refresh_v1(
      workspace_row.workspace_id,NULL,'semantic_assertion_or_provenance_changed',false
    );
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_semantic_review_attribution_insert ON signal_mention_attributions;
CREATE TRIGGER trg_signal_semantic_review_attribution_insert
AFTER INSERT ON signal_mention_attributions REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_semantic_review_from_attributions_v1();
DROP TRIGGER IF EXISTS trg_signal_semantic_review_attribution_update ON signal_mention_attributions;
CREATE TRIGGER trg_signal_semantic_review_attribution_update
AFTER UPDATE ON signal_mention_attributions REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_semantic_review_from_attributions_v1();

CREATE OR REPLACE FUNCTION invalidate_signal_semantic_review_workspace_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_workspace uuid;
BEGIN
  target_workspace:=COALESCE(NEW.workspace_id,OLD.workspace_id);
  IF target_workspace IS NOT NULL THEN
    PERFORM queue_signal_semantic_review_projection_refresh_v1(
      target_workspace,NULL,TG_TABLE_NAME||'_changed',true
    );
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'signal_provenance_policy_bindings','signal_quality_policies','signal_retention_policies',
    'signal_licensing_policies','signal_licensing_policy_usages'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_semantic_review_projection_%I ON %I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER trg_semantic_review_projection_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION invalidate_signal_semantic_review_workspace_v1()',table_name,table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION invalidate_signal_semantic_review_identity_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_brand uuid;
DECLARE workspace_row record;
BEGIN
  IF TG_TABLE_NAME='brands' THEN target_brand:=COALESCE(NEW.id,OLD.id);
  ELSIF TG_TABLE_NAME='competitors' THEN target_brand:=COALESCE(NEW.brand_id,OLD.brand_id);
  ELSIF TG_TABLE_NAME='intelligence_entities' THEN target_brand:=COALESCE(NEW.brand_id,OLD.brand_id);
  ELSE RETURN COALESCE(NEW,OLD); END IF;
  FOR workspace_row IN SELECT id FROM signal_workspaces WHERE brand_id=target_brand LOOP
    PERFORM queue_signal_semantic_review_projection_refresh_v1(
      workspace_row.id,NULL,TG_TABLE_NAME||'_identity_changed',true
    );
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_semantic_review_projection_brands ON brands;
CREATE TRIGGER trg_semantic_review_projection_brands AFTER UPDATE ON brands
FOR EACH ROW EXECUTE FUNCTION invalidate_signal_semantic_review_identity_v1();
DROP TRIGGER IF EXISTS trg_semantic_review_projection_competitors ON competitors;
CREATE TRIGGER trg_semantic_review_projection_competitors AFTER INSERT OR UPDATE OR DELETE ON competitors
FOR EACH ROW EXECUTE FUNCTION invalidate_signal_semantic_review_identity_v1();
DROP TRIGGER IF EXISTS trg_semantic_review_projection_entities ON intelligence_entities;
CREATE TRIGGER trg_semantic_review_projection_entities AFTER INSERT OR UPDATE OR DELETE ON intelligence_entities
FOR EACH ROW EXECUTE FUNCTION invalidate_signal_semantic_review_identity_v1();

CREATE OR REPLACE FUNCTION invalidate_signal_semantic_review_canonical_merge_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canonical_mention_id IS DISTINCT FROM OLD.canonical_mention_id THEN
    PERFORM queue_signal_semantic_review_projection_refresh_v1(
      NEW.workspace_id,NULL,'canonical_merge_changed',true
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_semantic_review_projection_canonical_merge ON mentions;
CREATE TRIGGER trg_semantic_review_projection_canonical_merge
AFTER UPDATE OF canonical_mention_id ON mentions FOR EACH ROW
EXECUTE FUNCTION invalidate_signal_semantic_review_canonical_merge_v1();

CREATE OR REPLACE FUNCTION invalidate_signal_semantic_review_import_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NOT NULL
     AND (NEW.status='completed' OR (TG_OP='UPDATE' AND OLD.status='completed'))
     AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM queue_signal_semantic_review_projection_refresh_v1(
      NEW.workspace_id,NULL,'accepted_import_transition',true
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_semantic_review_projection_import ON import_batches;
CREATE TRIGGER trg_semantic_review_projection_import
AFTER INSERT OR UPDATE OF status ON import_batches
FOR EACH ROW EXECUTE FUNCTION invalidate_signal_semantic_review_import_v1();

CREATE OR REPLACE FUNCTION invalidate_signal_semantic_review_identity_dependency_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_brand_id uuid;
DECLARE target_workspace_id uuid;
DECLARE target_profile_id uuid;
DECLARE target_seed_set_id uuid;
DECLARE target_entity_id uuid;
DECLARE target_seed_id uuid;
BEGIN
  IF TG_TABLE_NAME='brand_os_profiles' THEN
    target_brand_id:=COALESCE(NEW.brand_id,OLD.brand_id);
  ELSIF TG_TABLE_NAME='brand_os_seed_sets' THEN
    target_profile_id:=COALESCE(NEW.brand_os_profile_id,OLD.brand_os_profile_id);
    SELECT profile.brand_id INTO target_brand_id FROM brand_os_profiles profile
    WHERE profile.id=target_profile_id;
  ELSIF TG_TABLE_NAME='brand_os_seed_terms' THEN
    target_seed_set_id:=COALESCE(NEW.seed_set_id,OLD.seed_set_id);
    SELECT profile.brand_id INTO target_brand_id
    FROM brand_os_seed_sets seed_set
    JOIN brand_os_profiles profile ON profile.id=seed_set.brand_os_profile_id
    WHERE seed_set.id=target_seed_set_id;
  ELSIF TG_TABLE_NAME='entity_aliases' THEN
    target_entity_id:=COALESCE(NEW.entity_id,OLD.entity_id);
    SELECT entity.brand_id INTO target_brand_id FROM intelligence_entities entity
    WHERE entity.id=target_entity_id;
  ELSIF TG_TABLE_NAME='brand_seeds' THEN
    target_seed_id:=COALESCE(NEW.id,OLD.id);
    FOR target_workspace_id IN
      SELECT workspace.id FROM competitors competitor
      JOIN signal_workspaces workspace ON workspace.brand_id=competitor.brand_id
      WHERE competitor.competitor_brand_seed_id=target_seed_id
    LOOP
      PERFORM queue_signal_semantic_review_projection_refresh_v1(
        target_workspace_id,NULL,'governed_identity_changed',true
      );
    END LOOP;
    RETURN COALESCE(NEW,OLD);
  END IF;
  IF target_brand_id IS NOT NULL THEN
    FOR target_workspace_id IN
      SELECT workspace.id FROM signal_workspaces workspace
      WHERE workspace.brand_id=target_brand_id
    LOOP
      PERFORM queue_signal_semantic_review_projection_refresh_v1(
        target_workspace_id,NULL,'governed_identity_changed',true
      );
    END LOOP;
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'brand_os_profiles','brand_os_seed_sets','brand_os_seed_terms','entity_aliases','brand_seeds'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_semantic_review_projection_identity_dependency ON %I',table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_semantic_review_projection_identity_dependency '
      'AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW '
      'EXECUTE FUNCTION invalidate_signal_semantic_review_identity_dependency_v1()',table_name
    );
  END LOOP;
END;
$$;

-- Parent/child provider batches. Existing v1 run rows remain readable history.
ALTER TABLE signal_semantic_resolution_runs
  ADD COLUMN IF NOT EXISTS projection_snapshot_digest text,
  ADD COLUMN IF NOT EXISTS population_digest text,
  ADD COLUMN IF NOT EXISTS governance_digest text,
  ADD COLUMN IF NOT EXISTS pricing_version text,
  ADD COLUMN IF NOT EXISTS input_usd_per_million_tokens numeric(18,6),
  ADD COLUMN IF NOT EXISTS output_usd_per_million_tokens numeric(18,6),
  ADD COLUMN IF NOT EXISTS preflight_digest text,
  ADD COLUMN IF NOT EXISTS request_digest text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS estimated_cost_micro_usd bigint,
  ADD COLUMN IF NOT EXISTS hard_cap_micro_usd bigint,
  ADD COLUMN IF NOT EXISTS supersedes_run_id uuid REFERENCES signal_semantic_resolution_runs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS next_policy_transition_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_batch_item_limit integer,
  ADD COLUMN IF NOT EXISTS child_batch_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_child_batch_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_child_batch_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canceled_child_batch_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz;

ALTER TABLE signal_semantic_resolution_runs
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_run_status,
  ADD CONSTRAINT signal_semantic_resolution_run_status CHECK (
    status IN ('queued','running','applying','completed','partial','failed','canceling','canceled')
  ),
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_run_scale_contract,
  ADD CONSTRAINT signal_semantic_resolution_run_scale_contract CHECK (
    (projection_snapshot_digest IS NULL AND population_digest IS NULL AND governance_digest IS NULL
      AND pricing_version IS NULL AND provider_batch_item_limit IS NULL)
    OR
    (projection_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
      AND population_digest ~ '^sha256:[0-9a-f]{64}$'
      AND governance_digest ~ '^sha256:[0-9a-f]{64}$'
      AND pricing_version IS NOT NULL AND btrim(pricing_version)<>''
      AND input_usd_per_million_tokens>0 AND output_usd_per_million_tokens>0
      AND preflight_digest ~ '^sha256:[0-9a-f]{64}$'
      AND request_digest ~ '^sha256:[0-9a-f]{64}$'
      AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
      AND estimated_cost_micro_usd>=0 AND hard_cap_micro_usd>=estimated_cost_micro_usd
      AND provider_batch_item_limit BETWEEN 1 AND 100000)
  ),
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_run_child_counts,
  ADD CONSTRAINT signal_semantic_resolution_run_child_counts CHECK (
    child_batch_count>=0 AND completed_child_batch_count>=0
    AND failed_child_batch_count>=0 AND canceled_child_batch_count>=0
    AND completed_child_batch_count+failed_child_batch_count+canceled_child_batch_count<=child_batch_count
  );

ALTER TABLE signal_semantic_resolution_runs
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_run_cost,
  ADD CONSTRAINT signal_semantic_resolution_run_cost CHECK (
    budget_threshold_usd>=0 AND budget_cap_usd>=0 AND estimated_cost_usd>=0
    AND actual_cost_usd>=0 AND input_tokens>=0 AND output_tokens>=0
  );
DROP INDEX IF EXISTS uq_signal_semantic_resolution_active_workspace;
CREATE UNIQUE INDEX uq_signal_semantic_resolution_active_workspace
  ON signal_semantic_resolution_runs(workspace_id)
  WHERE status IN ('queued','running','applying','canceling');
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_resolution_request
  ON signal_semantic_resolution_runs(workspace_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_semantic_resolution_child_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES signal_semantic_resolution_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  item_count integer NOT NULL,
  completed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  provider_batch_id text,
  provider_batch_status text NOT NULL DEFAULT 'not_submitted',
  estimated_input_tokens bigint NOT NULL,
  estimated_output_tokens bigint NOT NULL,
  estimated_cost_usd numeric(12,6) NOT NULL,
  estimated_cost_micro_usd bigint NOT NULL,
  reserved_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  reserved_cost_micro_usd bigint NOT NULL DEFAULT 0,
  actual_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  actual_cost_micro_usd bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_semantic_resolution_child_ordinal UNIQUE(run_id,ordinal),
  CONSTRAINT uq_signal_semantic_resolution_child_provider UNIQUE(provider_batch_id),
  CONSTRAINT signal_semantic_resolution_child_status CHECK (
    status IN ('queued','dispatching','provider','applying','completed','partial','failed','canceling','canceled')
  ),
  CONSTRAINT signal_semantic_resolution_child_provider_status CHECK (
    provider_batch_status IN ('not_submitted','submitting','in_progress','canceling','ended')
  ),
  CONSTRAINT signal_semantic_resolution_child_counts CHECK (
    ordinal>=1 AND item_count>=1 AND completed_items>=0 AND failed_items>=0
    AND completed_items+failed_items<=item_count
  ),
  CONSTRAINT signal_semantic_resolution_child_cost CHECK (
    estimated_input_tokens>=0 AND estimated_output_tokens>=0 AND estimated_cost_usd>=0
    AND estimated_cost_micro_usd>=0
    AND reserved_cost_usd>=actual_cost_usd AND actual_cost_usd>=0
    AND reserved_cost_micro_usd>=actual_cost_micro_usd AND actual_cost_micro_usd>=0
    AND input_tokens>=0 AND output_tokens>=0
  ),
  CONSTRAINT signal_semantic_resolution_child_lease CHECK (
    (status IN ('dispatching','provider','applying'))=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
ALTER TABLE signal_semantic_resolution_child_batches
  ADD COLUMN IF NOT EXISTS estimated_cost_micro_usd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_cost_micro_usd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost_micro_usd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE signal_semantic_resolution_child_batches
  ADD COLUMN IF NOT EXISTS supersedes_child_batch_id uuid
    REFERENCES signal_semantic_resolution_child_batches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS resume_idempotency_key text;
ALTER TABLE signal_semantic_resolution_child_batches
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_child_cost,
  ADD CONSTRAINT signal_semantic_resolution_child_cost CHECK (
    estimated_input_tokens>=0 AND estimated_output_tokens>=0 AND estimated_cost_usd>=0
    AND estimated_cost_micro_usd>=0
    AND reserved_cost_usd>=actual_cost_usd AND actual_cost_usd>=0
    AND reserved_cost_micro_usd>=actual_cost_micro_usd AND actual_cost_micro_usd>=0
    AND input_tokens>=0 AND output_tokens>=0
  );
ALTER TABLE signal_semantic_resolution_child_batches
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_child_status,
  ADD CONSTRAINT signal_semantic_resolution_child_status CHECK (
    status IN ('queued','dispatching','provider','applying','completed','partial','failed',
      'canceling','canceled','superseded')
  ),
  DROP CONSTRAINT IF EXISTS signal_semantic_resolution_child_resume_key,
  ADD CONSTRAINT signal_semantic_resolution_child_resume_key CHECK (
    resume_idempotency_key IS NULL OR resume_idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_resolution_child_resume
  ON signal_semantic_resolution_child_batches(run_id,resume_idempotency_key)
  WHERE resume_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_semantic_resolution_children_run
  ON signal_semantic_resolution_child_batches(run_id,ordinal);
CREATE INDEX IF NOT EXISTS idx_signal_semantic_resolution_children_recovery
  ON signal_semantic_resolution_child_batches(status,lease_expires_at,updated_at,id);

ALTER TABLE signal_semantic_resolution_run_items
  ADD COLUMN IF NOT EXISTS child_batch_id uuid REFERENCES signal_semantic_resolution_child_batches(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_signal_semantic_resolution_items_child
  ON signal_semantic_resolution_run_items(child_batch_id,status,created_at,id);

CREATE TABLE IF NOT EXISTS signal_semantic_resolution_child_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES signal_semantic_resolution_runs(id) ON DELETE CASCADE,
  child_batch_id uuid NOT NULL REFERENCES signal_semantic_resolution_child_batches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT uq_signal_semantic_resolution_child_outbox UNIQUE(child_batch_id),
  CONSTRAINT signal_semantic_resolution_child_outbox_status CHECK (
    status IN ('pending','dispatching','dispatched','completed','failed','dead_letter','canceled')
  ),
  CONSTRAINT signal_semantic_resolution_child_outbox_attempt CHECK(attempt>=0),
  CONSTRAINT signal_semantic_resolution_child_outbox_lease CHECK (
    (status='dispatching')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS signal_semantic_resolution_item_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_item_id uuid NOT NULL REFERENCES signal_semantic_resolution_run_items(id) ON DELETE RESTRICT,
  child_batch_id uuid NOT NULL REFERENCES signal_semantic_resolution_child_batches(id) ON DELETE RESTRICT,
  attempt integer NOT NULL,
  provider_result_status text,
  decision_digest text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  error_code text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_semantic_resolution_item_attempt UNIQUE(run_item_id,child_batch_id,attempt),
  CONSTRAINT signal_semantic_resolution_item_attempt_values CHECK (
    attempt>=0 AND input_tokens>=0 AND output_tokens>=0 AND cost_micro_usd>=0
    AND (decision_digest IS NULL OR decision_digest ~ '^sha256:[0-9a-f]{64}$')
  )
);

CREATE TABLE IF NOT EXISTS signal_semantic_resolution_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES signal_semantic_resolution_runs(id) ON DELETE RESTRICT,
  child_batch_id uuid REFERENCES signal_semantic_resolution_child_batches(id) ON DELETE RESTRICT,
  action text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_semantic_resolution_run_event_action CHECK (
    action IN ('prepared','retry_scheduled','child_completed','child_failed',
      'cancel_requested','resumed')
  ),
  CONSTRAINT signal_semantic_resolution_run_event_key CHECK (
    idempotency_key ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof(details)='object'
  ),
  CONSTRAINT uq_signal_semantic_resolution_run_event UNIQUE(workspace_id,idempotency_key)
);

CREATE OR REPLACE FUNCTION protect_signal_semantic_resolution_history_v1()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Semantic resolution execution history is append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS trg_signal_semantic_resolution_item_attempts_append_only
  ON signal_semantic_resolution_item_attempts;
CREATE TRIGGER trg_signal_semantic_resolution_item_attempts_append_only
  BEFORE UPDATE OR DELETE ON signal_semantic_resolution_item_attempts
  FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_resolution_history_v1();
DROP TRIGGER IF EXISTS trg_signal_semantic_resolution_run_events_append_only
  ON signal_semantic_resolution_run_events;
CREATE TRIGGER trg_signal_semantic_resolution_run_events_append_only
  BEFORE UPDATE OR DELETE ON signal_semantic_resolution_run_events
  FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_resolution_history_v1();
DROP INDEX IF EXISTS idx_signal_semantic_resolution_child_outbox_recovery;
CREATE INDEX idx_signal_semantic_resolution_child_outbox_recovery
  ON signal_semantic_resolution_child_outbox(available_at,created_at,id)
  WHERE status IN ('pending','failed','dispatching','dispatched');

-- The return record gained the durable attempt used in deterministic BullMQ job IDs
-- while 0082 was still local-only. Drop first so a byte-identical reapply is valid.
DROP FUNCTION IF EXISTS claim_signal_semantic_resolution_child_dispatch_v1(integer,integer,integer);
CREATE OR REPLACE FUNCTION claim_signal_semantic_resolution_child_dispatch_v1(
  target_limit integer DEFAULT 5,target_lease_seconds integer DEFAULT 300,target_max_attempts integer DEFAULT 8
)
RETURNS TABLE(outbox_id uuid,workspace_id uuid,run_id uuid,child_batch_id uuid,lease_token uuid,attempt integer)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT item.id FROM signal_semantic_resolution_child_outbox item
    JOIN signal_semantic_resolution_runs run ON run.id=item.run_id
    JOIN signal_semantic_resolution_child_batches child ON child.id=item.child_batch_id
    WHERE run.cancellation_requested_at IS NULL
      AND ((item.status IN ('pending','failed') AND item.available_at<=now())
        OR (item.status='dispatching' AND item.lease_expires_at<=now())
        OR (item.status='dispatched' AND (
          child.status='queued' OR (
            child.status IN ('provider','applying') AND child.lease_expires_at<=now()
          )
        )))
      AND item.attempt<target_max_attempts
    ORDER BY item.available_at,item.created_at,item.id FOR UPDATE OF item SKIP LOCKED
    LIMIT LEAST(GREATEST(target_limit,1),20)
  ), claimed AS (
    UPDATE signal_semantic_resolution_child_outbox item SET status='dispatching',
      attempt=item.attempt+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>LEAST(GREATEST(target_lease_seconds,60),1800)),
      error_code=NULL,updated_at=now()
    FROM candidates WHERE item.id=candidates.id
    RETURNING item.id,item.workspace_id,item.run_id,item.child_batch_id,item.lease_token,item.attempt
  ) SELECT * FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION retry_signal_semantic_resolution_child_execution_v1(
  target_child_batch_id uuid,target_lease_token uuid,target_error_code text
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_semantic_resolution_child_batches SET status='queued',
    lease_token=NULL,lease_expires_at=NULL,error_code=left(target_error_code,120),updated_at=now()
  WHERE id=target_child_batch_id AND lease_token=target_lease_token
    AND status IN ('provider','applying');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semantic resolution child retry lease changed.' USING ERRCODE='40001';
  END IF;
  INSERT INTO signal_semantic_resolution_run_events(
    workspace_id,run_id,child_batch_id,action,idempotency_key,details
  ) SELECT child.workspace_id,child.run_id,child.id,'retry_scheduled',
    'sha256:'||encode(sha256(convert_to(concat_ws('|','retry',child.id::text,
      child.updated_at::text),'UTF8')),'hex'),jsonb_build_object('error_code',left(target_error_code,120))
  FROM signal_semantic_resolution_child_batches child WHERE child.id=target_child_batch_id
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION complete_signal_semantic_resolution_child_dispatch_v1(
  target_outbox_id uuid,target_lease_token uuid
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_semantic_resolution_child_outbox SET status='dispatched',lease_token=NULL,
    lease_expires_at=NULL,updated_at=now()
  WHERE id=target_outbox_id AND status='dispatching' AND lease_token=target_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semantic resolution child dispatch lease changed.' USING ERRCODE='40001'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fail_signal_semantic_resolution_child_dispatch_v1(
  target_outbox_id uuid,target_lease_token uuid,target_error_code text,target_retry_seconds integer DEFAULT 30
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_semantic_resolution_child_outbox SET
    status=CASE WHEN attempt>=8 THEN 'dead_letter' ELSE 'failed' END,
    lease_token=NULL,lease_expires_at=NULL,error_code=left(target_error_code,120),
    available_at=now()+make_interval(secs=>LEAST(GREATEST(target_retry_seconds,1),3600)),updated_at=now()
  WHERE id=target_outbox_id AND status='dispatching' AND lease_token=target_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semantic resolution child dispatch lease changed.' USING ERRCODE='40001'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION claim_signal_semantic_resolution_child_execution_v1(
  target_outbox_id uuid,target_child_batch_id uuid,target_lease_seconds integer DEFAULT 900
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE next_lease uuid:=gen_random_uuid();
DECLARE target_run_id uuid;
BEGIN
  SELECT child.run_id INTO target_run_id
  FROM signal_semantic_resolution_child_batches child
  JOIN signal_semantic_resolution_child_outbox outbox
    ON outbox.child_batch_id=child.id AND outbox.id=target_outbox_id
  JOIN signal_semantic_resolution_runs run ON run.id=child.run_id
  WHERE child.id=target_child_batch_id
    AND outbox.status='dispatched'
    AND run.cancellation_requested_at IS NULL
    AND run.status IN ('queued','running','applying')
    AND (
      child.status='queued'
      OR (child.status IN ('provider','applying') AND child.lease_expires_at<=now())
    )
  FOR UPDATE OF child,run;
  IF target_run_id IS NULL THEN
    RAISE EXCEPTION 'Semantic resolution child is not claimable.' USING ERRCODE='55000';
  END IF;
  UPDATE signal_semantic_resolution_child_batches
  SET status='provider',lease_token=next_lease,
    lease_expires_at=now()+make_interval(secs=>LEAST(GREATEST(target_lease_seconds,60),1800)),
    started_at=COALESCE(started_at,now()),error_code=NULL,updated_at=now()
  WHERE id=target_child_batch_id;
  UPDATE signal_semantic_resolution_runs SET status='running',started_at=COALESCE(started_at,now()),
    updated_at=now() WHERE id=target_run_id AND status='queued';
  RETURN next_lease;
END;
$$;

CREATE OR REPLACE FUNCTION heartbeat_signal_semantic_resolution_child_v1(
  target_child_batch_id uuid,target_lease_token uuid,target_status text,target_lease_seconds integer DEFAULT 900
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF target_status NOT IN ('provider','applying') THEN
    RAISE EXCEPTION 'Semantic resolution child heartbeat status is invalid.' USING ERRCODE='23514';
  END IF;
  UPDATE signal_semantic_resolution_child_batches SET status=target_status,
    lease_expires_at=now()+make_interval(secs=>LEAST(GREATEST(target_lease_seconds,60),1800)),
    updated_at=now()
  WHERE id=target_child_batch_id AND lease_token=target_lease_token
    AND status IN ('provider','applying') AND lease_expires_at>now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semantic resolution child execution lease changed.' USING ERRCODE='40001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reserve_signal_semantic_resolution_child_budget_v1(
  target_child_batch_id uuid,target_lease_token uuid
)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE run_row signal_semantic_resolution_runs%ROWTYPE;
DECLARE child_row signal_semantic_resolution_child_batches%ROWTYPE;
DECLARE consumed bigint;
BEGIN
  SELECT child.* INTO child_row FROM signal_semantic_resolution_child_batches child
  WHERE child.id=target_child_batch_id FOR UPDATE;
  IF child_row.id IS NULL OR child_row.lease_token IS DISTINCT FROM target_lease_token
     OR child_row.status<>'provider' OR child_row.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'Semantic resolution child budget lease changed.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO run_row FROM signal_semantic_resolution_runs
  WHERE id=child_row.run_id FOR UPDATE;
  IF run_row.cancellation_requested_at IS NOT NULL OR run_row.status NOT IN ('running','applying') THEN
    RAISE EXCEPTION 'Semantic resolution run is not dispatchable.' USING ERRCODE='55000';
  END IF;
  IF child_row.reserved_cost_micro_usd>0 THEN RETURN child_row.reserved_cost_micro_usd; END IF;
  SELECT COALESCE(sum(child.reserved_cost_micro_usd),0)::bigint INTO consumed
  FROM signal_semantic_resolution_child_batches child WHERE child.run_id=run_row.id;
  IF consumed+child_row.estimated_cost_micro_usd>run_row.hard_cap_micro_usd THEN
    RAISE EXCEPTION 'Semantic resolution hard cap would be exceeded.' USING ERRCODE='23514';
  END IF;
  UPDATE signal_semantic_resolution_child_batches SET
    reserved_cost_micro_usd=estimated_cost_micro_usd,
    reserved_cost_usd=estimated_cost_micro_usd::numeric/1000000,updated_at=now()
  WHERE id=target_child_batch_id;
  RETURN child_row.estimated_cost_micro_usd;
END;
$$;

CREATE OR REPLACE FUNCTION settle_signal_semantic_resolution_child_budget_v1(
  target_child_batch_id uuid,target_lease_token uuid,target_input_tokens bigint,
  target_output_tokens bigint,target_actual_cost_micro_usd bigint
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF target_input_tokens<0 OR target_output_tokens<0 OR target_actual_cost_micro_usd<0 THEN
    RAISE EXCEPTION 'Semantic resolution settlement is invalid.' USING ERRCODE='23514';
  END IF;
  UPDATE signal_semantic_resolution_child_batches SET
    input_tokens=target_input_tokens,output_tokens=target_output_tokens,
    actual_cost_micro_usd=target_actual_cost_micro_usd,
    actual_cost_usd=target_actual_cost_micro_usd::numeric/1000000,
    reserved_cost_micro_usd=target_actual_cost_micro_usd,
    reserved_cost_usd=target_actual_cost_micro_usd::numeric/1000000,updated_at=now()
  WHERE id=target_child_batch_id AND lease_token=target_lease_token
    AND status IN ('provider','applying') AND lease_expires_at>now()
    AND target_actual_cost_micro_usd<=reserved_cost_micro_usd
    AND (actual_cost_micro_usd=0 OR (
      actual_cost_micro_usd=target_actual_cost_micro_usd
      AND input_tokens=target_input_tokens AND output_tokens=target_output_tokens
    ));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semantic resolution settlement exceeds its reservation or changed.' USING ERRCODE='23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION complete_signal_semantic_resolution_child_v1(
  target_outbox_id uuid,target_child_batch_id uuid,target_lease_token uuid
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE target_run_id uuid;
DECLARE pending_count integer;
DECLARE completed_count integer;
DECLARE failed_count integer;
BEGIN
  SELECT child.run_id INTO target_run_id FROM signal_semantic_resolution_child_batches child
  WHERE child.id=target_child_batch_id AND child.lease_token=target_lease_token
    AND child.status IN ('provider','applying') AND child.lease_expires_at>now() FOR UPDATE;
  IF target_run_id IS NULL THEN
    RAISE EXCEPTION 'Semantic resolution child execution lease changed.' USING ERRCODE='40001';
  END IF;
  SELECT count(*) FILTER(WHERE item.status IN ('pending','processing'))::int,
    count(*) FILTER(WHERE item.status='completed')::int,
    count(*) FILTER(WHERE item.status='failed')::int
  INTO pending_count,completed_count,failed_count
  FROM signal_semantic_resolution_run_items item WHERE item.child_batch_id=target_child_batch_id;
  IF pending_count<>0 THEN
    RAISE EXCEPTION 'Semantic resolution child still has nonterminal items.' USING ERRCODE='23514';
  END IF;
  UPDATE signal_semantic_resolution_child_batches SET
    status=CASE WHEN failed_count=0 THEN 'completed' ELSE 'partial' END,
    completed_items=completed_count,failed_items=failed_count,
    lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now()
  WHERE id=target_child_batch_id;
  UPDATE signal_semantic_resolution_child_outbox SET status='completed',completed_at=now(),updated_at=now()
  WHERE id=target_outbox_id AND child_batch_id=target_child_batch_id AND status='dispatched';
  INSERT INTO signal_semantic_resolution_run_events(
    workspace_id,run_id,child_batch_id,action,idempotency_key,details
  ) SELECT child.workspace_id,child.run_id,child.id,'child_completed',
    'sha256:'||encode(sha256(convert_to(concat_ws('|','child-completed',child.id::text),
      'UTF8')),'hex'),jsonb_build_object('completed_items',completed_count,'failed_items',failed_count)
  FROM signal_semantic_resolution_child_batches child WHERE child.id=target_child_batch_id
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  RETURN refresh_signal_semantic_resolution_parent_v1(target_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION fail_signal_semantic_resolution_child_v1(
  target_outbox_id uuid,target_child_batch_id uuid,target_lease_token uuid,target_error_code text
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE target_run_id uuid;
BEGIN
  UPDATE signal_semantic_resolution_child_batches SET status='failed',
    error_code=left(target_error_code,120),lease_token=NULL,lease_expires_at=NULL,
    completed_at=now(),updated_at=now()
  WHERE id=target_child_batch_id AND lease_token=target_lease_token
    AND status IN ('provider','applying') RETURNING run_id INTO target_run_id;
  IF target_run_id IS NULL THEN
    RAISE EXCEPTION 'Semantic resolution child execution lease changed.' USING ERRCODE='40001';
  END IF;
  UPDATE signal_semantic_resolution_run_items SET status='failed',
    error_code=left(target_error_code,120),completed_at=now(),updated_at=now()
  WHERE child_batch_id=target_child_batch_id AND status IN ('pending','processing');
  UPDATE signal_semantic_resolution_child_outbox SET status='completed',completed_at=now(),updated_at=now()
  WHERE id=target_outbox_id AND child_batch_id=target_child_batch_id;
  INSERT INTO signal_semantic_resolution_run_events(
    workspace_id,run_id,child_batch_id,action,idempotency_key,details
  ) SELECT child.workspace_id,child.run_id,child.id,'child_failed',
    'sha256:'||encode(sha256(convert_to(concat_ws('|','child-failed',child.id::text),
      'UTF8')),'hex'),jsonb_build_object('error_code',left(target_error_code,120))
  FROM signal_semantic_resolution_child_batches child WHERE child.id=target_child_batch_id
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  RETURN refresh_signal_semantic_resolution_parent_v1(target_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION refresh_signal_semantic_resolution_parent_v1(target_run_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE next_status text;
BEGIN
  UPDATE signal_semantic_resolution_runs run SET
    completed_items=stats.completed_items,failed_items=stats.failed_items,
    completed_child_batch_count=stats.completed_children,
    failed_child_batch_count=stats.failed_children,
    canceled_child_batch_count=stats.canceled_children,
    actual_cost_usd=stats.actual_cost,
    status=CASE
      WHEN run.cancellation_requested_at IS NOT NULL AND stats.nonterminal_children>0 THEN 'canceling'
      WHEN run.cancellation_requested_at IS NOT NULL THEN 'canceled'
      WHEN stats.nonterminal_children>0 THEN 'running'
      WHEN stats.failed_children=0 AND stats.canceled_children=0
        AND stats.completed_items=run.total_items THEN 'completed'
      WHEN stats.completed_items>0 THEN 'partial'
      ELSE 'failed' END,
    completed_at=CASE WHEN stats.nonterminal_children=0 THEN now() ELSE NULL END,
    canceled_at=CASE WHEN run.cancellation_requested_at IS NOT NULL
      AND stats.nonterminal_children=0 THEN now() ELSE run.canceled_at END,
    updated_at=now()
  FROM (
    SELECT (SELECT count(*)::int FROM signal_semantic_resolution_run_items item
        WHERE item.run_id=target_run_id AND item.status='completed') completed_items,
      (SELECT count(*)::int FROM signal_semantic_resolution_run_items item
        WHERE item.run_id=target_run_id AND item.status='failed') failed_items,
      count(*) FILTER(WHERE child.status='completed')::int completed_children,
      count(*) FILTER(WHERE child.status IN ('failed','partial'))::int failed_children,
      count(*) FILTER(WHERE child.status='canceled')::int canceled_children,
      count(*) FILTER(WHERE child.status NOT IN (
        'completed','failed','partial','canceled','superseded'
      ))::int nonterminal_children,
      COALESCE(sum(child.actual_cost_usd),0) actual_cost
    FROM signal_semantic_resolution_child_batches child WHERE child.run_id=target_run_id
  ) stats WHERE run.id=target_run_id RETURNING run.status INTO next_status;
  RETURN next_status;
END;
$$;

CREATE OR REPLACE FUNCTION request_cancel_signal_semantic_resolution_run_v1(
  target_workspace_id uuid,target_run_id uuid,target_actor_id uuid,target_idempotency_key text
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE run_row signal_semantic_resolution_runs%ROWTYPE;
DECLARE event_row signal_semantic_resolution_run_events%ROWTYPE;
BEGIN
  SELECT * INTO run_row FROM signal_semantic_resolution_runs
  WHERE id=target_run_id AND workspace_id=target_workspace_id FOR UPDATE;
  IF run_row.id IS NULL THEN RAISE EXCEPTION 'Semantic resolution run was not found.' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=target_actor_id
    AND actor.status='active' AND actor.user_type='noisia_internal') THEN
    RAISE EXCEPTION 'Semantic resolution cancellation actor is unauthorized.' USING ERRCODE='42501';
  END IF;
  IF target_idempotency_key!~'^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Semantic resolution cancellation idempotency key is invalid.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO event_row FROM signal_semantic_resolution_run_events event
  WHERE event.workspace_id=target_workspace_id AND event.idempotency_key=target_idempotency_key;
  IF event_row.id IS NOT NULL THEN
    IF event_row.run_id IS DISTINCT FROM target_run_id
       OR event_row.actor_user_id IS DISTINCT FROM target_actor_id
       OR event_row.action<>'cancel_requested' THEN
      RAISE EXCEPTION 'Semantic resolution cancellation idempotency key was reused.' USING ERRCODE='23514';
    END IF;
    RETURN run_row.status;
  END IF;
  IF run_row.status IN ('completed','failed','canceled') THEN RETURN run_row.status; END IF;
  UPDATE signal_semantic_resolution_runs SET cancellation_requested_at=COALESCE(cancellation_requested_at,now()),
    status='canceling',updated_at=now() WHERE id=target_run_id;
  UPDATE signal_semantic_resolution_child_batches SET status='canceled',
    lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now()
  WHERE run_id=target_run_id AND status IN ('queued','dispatching');
  UPDATE signal_semantic_resolution_child_outbox outbox SET status='canceled',
    lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now()
  FROM signal_semantic_resolution_child_batches child
  WHERE outbox.run_id=target_run_id AND child.id=outbox.child_batch_id
    AND (outbox.status IN ('pending','failed','dispatching')
      OR (outbox.status='dispatched' AND child.status='canceled'));
  INSERT INTO signal_semantic_resolution_run_events(
    workspace_id,run_id,action,actor_user_id,idempotency_key,details
  ) VALUES(target_workspace_id,target_run_id,'cancel_requested',target_actor_id,
    target_idempotency_key,'{}'::jsonb)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
  RETURN refresh_signal_semantic_resolution_parent_v1(target_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION resume_signal_semantic_resolution_child_v1(
  target_workspace_id uuid,target_run_id uuid,target_child_batch_id uuid,
  target_actor_id uuid,target_idempotency_key text
)
RETURNS TABLE(child_batch_id uuid,replayed boolean)
LANGUAGE plpgsql AS $$
DECLARE run_row signal_semantic_resolution_runs%ROWTYPE;
DECLARE child_row signal_semantic_resolution_child_batches%ROWTYPE;
DECLARE existing_id uuid;
DECLARE next_id uuid:=gen_random_uuid();
DECLARE next_ordinal integer;
DECLARE failed_count integer;
DECLARE next_input bigint;
DECLARE next_output bigint;
DECLARE next_cost bigint;
BEGIN
  IF target_idempotency_key!~'^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Semantic resolution resume idempotency key is invalid.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_run_id::text||':semantic-resolution-resume',0));
  IF NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=target_actor_id
    AND actor.status='active' AND actor.user_type='noisia_internal') THEN
    RAISE EXCEPTION 'Semantic resolution resume actor is unauthorized.' USING ERRCODE='42501';
  END IF;
  SELECT child.id INTO existing_id FROM signal_semantic_resolution_child_batches child
  WHERE child.run_id=target_run_id AND child.resume_idempotency_key=target_idempotency_key;
  IF existing_id IS NOT NULL THEN RETURN QUERY SELECT existing_id,true; RETURN; END IF;
  SELECT * INTO run_row FROM signal_semantic_resolution_runs run
  WHERE run.id=target_run_id AND run.workspace_id=target_workspace_id FOR UPDATE;
  SELECT * INTO child_row FROM signal_semantic_resolution_child_batches child
  WHERE child.id=target_child_batch_id AND child.run_id=target_run_id
    AND child.workspace_id=target_workspace_id FOR UPDATE;
  IF run_row.id IS NULL OR run_row.status NOT IN ('partial','failed')
     OR child_row.id IS NULL OR child_row.status NOT IN ('partial','failed') THEN
    RAISE EXCEPTION 'Semantic resolution child is not resumable.' USING ERRCODE='55000';
  END IF;
  SELECT count(*)::int INTO failed_count FROM signal_semantic_resolution_run_items item
  WHERE item.run_id=target_run_id AND item.child_batch_id=target_child_batch_id
    AND item.status='failed';
  IF failed_count=0 THEN RAISE EXCEPTION 'Semantic resolution child has no failed items.' USING ERRCODE='55000'; END IF;
  SELECT COALESCE(max(child.ordinal),0)+1 INTO next_ordinal
  FROM signal_semantic_resolution_child_batches child WHERE child.run_id=target_run_id;
  next_input:=(child_row.estimated_input_tokens*failed_count+child_row.item_count-1)/child_row.item_count;
  next_output:=(child_row.estimated_output_tokens*failed_count+child_row.item_count-1)/child_row.item_count;
  next_cost:=(child_row.estimated_cost_micro_usd*failed_count+child_row.item_count-1)/child_row.item_count;
  INSERT INTO signal_semantic_resolution_item_attempts(
    run_item_id,child_batch_id,attempt,provider_result_status,decision_digest,
    input_tokens,output_tokens,cost_micro_usd,error_code
  ) SELECT item.id,target_child_batch_id,item.attempt,item.provider_result_status,
    CASE WHEN item.decision IS NULL THEN NULL ELSE 'sha256:'||encode(sha256(convert_to(
      item.decision::text,'UTF8')),'hex') END,item.provider_input_tokens,item.provider_output_tokens,
    round(item.provider_cost_usd*1000000)::bigint,COALESCE(item.provider_error_code,item.error_code)
  FROM signal_semantic_resolution_run_items item
  WHERE item.run_id=target_run_id AND item.child_batch_id=target_child_batch_id
    AND item.status='failed'
  ON CONFLICT ON CONSTRAINT uq_signal_semantic_resolution_item_attempt DO NOTHING;
  INSERT INTO signal_semantic_resolution_child_batches(
    id,run_id,workspace_id,ordinal,item_count,estimated_input_tokens,estimated_output_tokens,
    estimated_cost_usd,estimated_cost_micro_usd,supersedes_child_batch_id,resume_idempotency_key
  ) VALUES(next_id,target_run_id,target_workspace_id,next_ordinal,failed_count,next_input,next_output,
    next_cost::numeric/1000000,next_cost,target_child_batch_id,target_idempotency_key);
  UPDATE signal_semantic_resolution_run_items item SET child_batch_id=next_id,status='pending',
    provider_result_status=NULL,provider_input_tokens=0,provider_output_tokens=0,
    provider_cache_creation_input_tokens=0,provider_cache_read_input_tokens=0,
    provider_cost_usd=0,provider_error_code=NULL,decision=NULL,error_code=NULL,
    started_at=NULL,completed_at=NULL,updated_at=now()
  WHERE item.run_id=target_run_id AND item.child_batch_id=target_child_batch_id
    AND item.status='failed';
  UPDATE signal_semantic_resolution_child_batches SET status='superseded',updated_at=now()
  WHERE id=target_child_batch_id;
  INSERT INTO signal_semantic_resolution_child_outbox(workspace_id,run_id,child_batch_id,status)
  VALUES(target_workspace_id,target_run_id,next_id,'pending');
  UPDATE signal_semantic_resolution_runs SET status='queued',failed_items=0,
    child_batch_count=child_batch_count+1,error_code=NULL,completed_at=NULL,updated_at=now()
  WHERE id=target_run_id;
  INSERT INTO signal_semantic_resolution_run_events(
    workspace_id,run_id,child_batch_id,action,actor_user_id,idempotency_key,details
  ) VALUES(target_workspace_id,target_run_id,next_id,'resumed',target_actor_id,target_idempotency_key,
    jsonb_build_object('superseded_child_ordinal',child_row.ordinal,
      'resumed_item_count',failed_count,'new_child_ordinal',next_ordinal));
  RETURN QUERY SELECT next_id,false;
END;
$$;

COMMENT ON TABLE signal_semantic_review_projection_items IS
  'Versioned derived Review read model; client requests keyset-page this table and never rescan the canonical corpus.';
COMMENT ON TABLE signal_semantic_resolution_child_batches IS
  'Durable provider-sized partitions. The parent is terminal only after every selected item is terminal.';
COMMENT ON TABLE signal_semantic_resolution_child_outbox IS
  'Recoverable dispatch authority per semantic-resolution child batch; no provider dispatch is permitted outside this ledger.';

-- Existing workspaces need one deterministic projection build after the forward-only
-- migration. Reapplying 0082 never requeues a ready or already-stale workspace.
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT workspace.id
    FROM signal_workspaces workspace
    WHERE workspace.status='active'
      AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_review_projection_state state
        WHERE state.workspace_id=workspace.id
      )
  LOOP
    PERFORM queue_signal_semantic_review_projection_refresh_v1(
      target.id,NULL,'initial_projection_required',true
    );
  END LOOP;
END;
$$;
