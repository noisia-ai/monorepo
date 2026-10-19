-- Signal workspace-owned data plane, Cut 1 vertical.
-- Forward-only and data-preserving: legacy corpus columns and published payloads remain.

-- Every brand is born with one stable workspace. Backfill existing brands first so
-- ownership columns below can be resolved without inventing a study corpus.
INSERT INTO signal_workspaces (
  organization_id, brand_id, slug, timezone, status, metadata
)
SELECT
  brand.organization_id,
  brand.id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM signal_workspaces existing
      WHERE existing.organization_id = brand.organization_id
        AND existing.slug = brand.slug
    ) THEN brand.slug || '-brand-' || left(replace(brand.id::text, '-', ''), 8)
    ELSE brand.slug
  END,
  'America/Mexico_City',
  'active',
  jsonb_build_object('created_by', 'workspace-owned-data-plane-v1')
FROM brands brand
WHERE NOT EXISTS (
  SELECT 1 FROM signal_workspaces existing
  WHERE existing.organization_id = brand.organization_id
    AND existing.brand_id = brand.id
)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS signal_workspace_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  report_key text NOT NULL,
  title text NOT NULL,
  report_type text NOT NULL DEFAULT 'strategic',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_workspace_reports_identity UNIQUE (workspace_id, report_key),
  CONSTRAINT signal_workspace_reports_key CHECK (report_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_workspace_reports_type CHECK (report_type IN ('strategic', 'operational')),
  CONSTRAINT signal_workspace_reports_status CHECK (status IN ('active', 'paused', 'archived'))
);
CREATE INDEX IF NOT EXISTS idx_signal_workspace_reports_workspace
  ON signal_workspace_reports (workspace_id, status);

INSERT INTO signal_workspace_reports (workspace_id, report_key, title, report_type, status)
SELECT id, 'triggers-barriers', 'Triggers & Barriers', 'strategic', 'active'
FROM signal_workspaces
ON CONFLICT (workspace_id, report_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS signal_population_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  population_key text NOT NULL,
  version integer NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  acceptance_status text NOT NULL DEFAULT 'included',
  allowed_scopes text[] NOT NULL,
  min_quality_score integer,
  period_start date,
  period_end date,
  definition_hash text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_population_definitions_version
    UNIQUE (workspace_id, population_key, version),
  CONSTRAINT signal_population_definitions_key
    CHECK (population_key ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT signal_population_definitions_version_positive CHECK (version >= 1),
  CONSTRAINT signal_population_definitions_purpose CHECK (purpose IN ('operational', 'analysis')),
  CONSTRAINT signal_population_definitions_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT signal_population_definitions_acceptance CHECK (acceptance_status = 'included'),
  CONSTRAINT signal_population_definitions_scopes CHECK (
    cardinality(allowed_scopes) > 0
    AND allowed_scopes <@ ARRAY[
      'primary_brand', 'competitor', 'category', 'reference', 'unattributed'
    ]::text[]
  ),
  CONSTRAINT signal_population_definitions_window CHECK (
    period_start IS NULL OR period_end IS NULL OR period_start <= period_end
  ),
  CONSTRAINT signal_population_definitions_hash CHECK (
    definition_hash ~ '^sha256:[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_population_definitions_active
  ON signal_population_definitions (workspace_id, population_key)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_signal_population_definitions_workspace
  ON signal_population_definitions (workspace_id, purpose, status);

CREATE TABLE IF NOT EXISTS signal_workspace_population_pointers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  population_id uuid NOT NULL REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  promoted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_workspace_population_pointer UNIQUE (workspace_id, purpose),
  CONSTRAINT uq_signal_workspace_population_pointer_population UNIQUE (population_id),
  CONSTRAINT signal_workspace_population_pointer_purpose
    CHECK (purpose IN ('operational', 'analysis'))
);

INSERT INTO signal_population_definitions (
  workspace_id, population_key, version, purpose, status,
  acceptance_status, allowed_scopes, definition_hash, activated_at
)
SELECT
  workspace.id,
  'primary-brand-operational',
  1,
  'operational',
  'active',
  'included',
  ARRAY['primary_brand']::text[],
  'sha256:1de7744849ac9904272a695372976f1ef6c5d3ddd3abb5f5855e81d571c01854',
  now()
FROM signal_workspaces workspace
ON CONFLICT (workspace_id, population_key, version) DO NOTHING;

INSERT INTO signal_workspace_population_pointers (workspace_id, purpose, population_id)
SELECT definition.workspace_id, 'operational', definition.id
FROM signal_population_definitions definition
WHERE definition.population_key = 'primary-brand-operational'
  AND definition.version = 1
ON CONFLICT (workspace_id, purpose) DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_signal_workspace_for_brand(
  target_brand_id uuid,
  target_created_by_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE target_brand brands%ROWTYPE;
DECLARE resolved_workspace_id uuid;
DECLARE resolved_population_id uuid;
DECLARE resolved_slug text;
BEGIN
  SELECT * INTO target_brand FROM brands WHERE id = target_brand_id;
  IF target_brand.id IS NULL THEN
    RAISE EXCEPTION 'Signal workspace brand does not exist.' USING ERRCODE = '23503';
  END IF;
  SELECT id INTO resolved_workspace_id
  FROM signal_workspaces
  WHERE organization_id = target_brand.organization_id
    AND brand_id = target_brand.id
  LIMIT 1;
  IF resolved_workspace_id IS NULL THEN
    resolved_slug := CASE WHEN EXISTS (
      SELECT 1 FROM signal_workspaces
      WHERE organization_id = target_brand.organization_id
        AND slug = target_brand.slug
    ) THEN target_brand.slug || '-brand-' || left(replace(target_brand.id::text, '-', ''), 8)
    ELSE target_brand.slug END;
    INSERT INTO signal_workspaces (
      organization_id, brand_id, slug, timezone, status, metadata
    ) VALUES (
      target_brand.organization_id,
      target_brand.id,
      resolved_slug,
      'America/Mexico_City',
      'active',
      jsonb_build_object(
        'created_by', 'brand-workspace-provision-v1',
        'created_by_user_id', target_created_by_user_id,
        'ownership', 'workspace'
      )
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO resolved_workspace_id;
    IF resolved_workspace_id IS NULL THEN
      SELECT id INTO resolved_workspace_id
      FROM signal_workspaces
      WHERE organization_id = target_brand.organization_id
        AND brand_id = target_brand.id
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO signal_workspace_reports (
    workspace_id, report_key, title, report_type, status
  ) VALUES (
    resolved_workspace_id, 'triggers-barriers', 'Triggers & Barriers', 'strategic', 'active'
  ) ON CONFLICT (workspace_id, report_key) DO NOTHING;

  INSERT INTO signal_population_definitions (
    workspace_id, population_key, version, purpose, status,
    acceptance_status, allowed_scopes, definition_hash,
    created_by_user_id, activated_by_user_id, activated_at
  ) VALUES (
    resolved_workspace_id, 'primary-brand-operational', 1, 'operational', 'active',
    'included', ARRAY['primary_brand']::text[],
    'sha256:1de7744849ac9904272a695372976f1ef6c5d3ddd3abb5f5855e81d571c01854',
    target_created_by_user_id, target_created_by_user_id, now()
  ) ON CONFLICT (workspace_id, population_key, version) DO NOTHING;
  SELECT id INTO resolved_population_id
  FROM signal_population_definitions
  WHERE workspace_id = resolved_workspace_id
    AND population_key = 'primary-brand-operational'
    AND version = 1;
  INSERT INTO signal_workspace_population_pointers (
    workspace_id, purpose, population_id, promoted_by_user_id
  ) VALUES (
    resolved_workspace_id, 'operational', resolved_population_id,
    target_created_by_user_id
  ) ON CONFLICT (workspace_id, purpose) DO NOTHING;
  RETURN resolved_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION provision_signal_workspace_after_brand_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ensure_signal_workspace_for_brand(NEW.id, NULL);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_provision_signal_workspace_after_brand_insert ON brands;
CREATE TRIGGER trg_provision_signal_workspace_after_brand_insert
  AFTER INSERT ON brands FOR EACH ROW
  EXECUTE FUNCTION provision_signal_workspace_after_brand_insert();

ALTER TABLE data_sources
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS governed_scope text,
  ADD COLUMN IF NOT EXISTS governed_entity_type text,
  ADD COLUMN IF NOT EXISTS governed_entity_id uuid,
  ADD COLUMN IF NOT EXISTS scope_policy_version text,
  ADD COLUMN IF NOT EXISTS scope_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scope_approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_approval_source text,
  ADD COLUMN IF NOT EXISTS scope_approved_at timestamptz;
ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contributed_by_study_corpus_id uuid REFERENCES study_corpora(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS data_source_id uuid REFERENCES data_sources(id) ON DELETE RESTRICT;
ALTER TABLE mentions
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS data_source_id uuid REFERENCES data_sources(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS canonical_mention_id uuid,
  ADD COLUMN IF NOT EXISTS provider_record_id text;
ALTER TABLE source_sync_runs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT;

UPDATE data_sources source
SET workspace_id = COALESCE(
  (
    SELECT workspace.id
    FROM study_corpora corpus
    JOIN signal_workspaces workspace
      ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
     AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    WHERE corpus.id = source.study_corpus_id
    ORDER BY workspace.created_at, workspace.id
    LIMIT 1
  ),
  (
    SELECT workspace.id
    FROM signal_workspaces workspace
    WHERE workspace.brand_id = source.brand_id
      AND workspace.organization_id = source.organization_id
    ORDER BY workspace.created_at, workspace.id
    LIMIT 1
  )
)
WHERE source.workspace_id IS NULL;

UPDATE import_batches batch
SET workspace_id = workspace.id,
    contributed_by_study_corpus_id = COALESCE(
      batch.contributed_by_study_corpus_id,
      batch.study_corpus_id
    )
FROM study_corpora corpus
JOIN signal_workspaces workspace
  ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
 AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
WHERE batch.workspace_id IS NULL
  AND corpus.id = batch.study_corpus_id;

-- Compatibility sources let existing corpus imports dual-write the new owner
-- without pretending that the corpus itself is the source identity.
INSERT INTO data_sources (
  workspace_id, organization_id, brand_id, source_type, provider,
  connection_method, name, mapping, mapping_version, role, status, visibility
)
SELECT DISTINCT
  workspace.id,
  workspace.organization_id,
  workspace.brand_id,
  'social-listening',
  'legacy-import',
  'compatibility-dual-write',
  'Legacy corpus import compatibility',
  '{}'::jsonb,
  1,
  jsonb_build_object('ownership', 'workspace', 'compatibility', true),
  'active',
  'internal'
FROM signal_workspaces workspace
JOIN import_batches batch ON batch.workspace_id = workspace.id
WHERE NOT EXISTS (
  SELECT 1 FROM data_sources existing
  WHERE existing.workspace_id = workspace.id
    AND existing.provider = 'legacy-import'
    AND existing.connection_method = 'compatibility-dual-write'
);

UPDATE import_batches batch
SET data_source_id = source.id
FROM data_sources source
WHERE batch.data_source_id IS NULL
  AND source.workspace_id = batch.workspace_id
  AND source.provider = 'legacy-import'
  AND source.connection_method = 'compatibility-dual-write';

-- A workspace source owns its scope policy. An import may carry historical
-- provenance, but it cannot redefine these governed fields. Existing sources
-- are promoted only when their historical batches agree on one scope/entity.
WITH source_scope_candidates AS (
  SELECT
    source.id,
    CASE
      WHEN source.role->>'scope' IN (
        'primary_brand', 'competitor', 'category', 'reference', 'unattributed'
      ) THEN source.role->>'scope'
      WHEN count(DISTINCT CASE
        WHEN batch.mention_type = 'brand' OR batch.entity_kind = 'primary_brand' THEN 'primary_brand'
        WHEN batch.mention_type = 'competitor' OR batch.entity_kind IN ('competitor', 'competitor_pool') THEN 'competitor'
        WHEN batch.mention_type = 'industry' OR batch.entity_kind = 'category' THEN 'category'
        WHEN batch.entity_kind = 'reference' THEN 'reference'
        ELSE 'unattributed'
      END) = 1 THEN min(CASE
        WHEN batch.mention_type = 'brand' OR batch.entity_kind = 'primary_brand' THEN 'primary_brand'
        WHEN batch.mention_type = 'competitor' OR batch.entity_kind IN ('competitor', 'competitor_pool') THEN 'competitor'
        WHEN batch.mention_type = 'industry' OR batch.entity_kind = 'category' THEN 'category'
        WHEN batch.entity_kind = 'reference' THEN 'reference'
        ELSE 'unattributed'
      END)
      ELSE NULL
    END AS governed_scope,
    min(batch.competitor_id::text) FILTER (
      WHERE batch.mention_type = 'competitor'
         OR batch.entity_kind IN ('competitor', 'competitor_pool')
    )::uuid AS competitor_id
  FROM data_sources source
  LEFT JOIN import_batches batch ON batch.data_source_id = source.id
  GROUP BY source.id, source.role
)
UPDATE data_sources source
SET governed_scope = candidate.governed_scope,
    governed_entity_type = CASE candidate.governed_scope
      WHEN 'primary_brand' THEN 'brand'
      WHEN 'competitor' THEN 'competitor'
      WHEN 'category' THEN 'category'
      WHEN 'reference' THEN 'reference'
      WHEN 'unattributed' THEN 'unattributed'
    END,
    governed_entity_id = CASE candidate.governed_scope
      WHEN 'primary_brand' THEN source.brand_id
      WHEN 'competitor' THEN candidate.competitor_id
      ELSE NULL
    END,
    scope_policy_version = CASE
      WHEN candidate.governed_scope IS NOT NULL THEN 'workspace-source-scope-v1'
      ELSE NULL
    END,
    scope_review_status = CASE
      WHEN candidate.governed_scope IS NOT NULL THEN 'approved'
      ELSE 'pending'
    END,
    scope_approval_source = CASE
      WHEN candidate.governed_scope IS NOT NULL THEN 'migration_legacy_source'
      ELSE NULL
    END,
    scope_approved_at = CASE
      WHEN candidate.governed_scope IS NOT NULL THEN now()
      ELSE NULL
    END
FROM source_scope_candidates candidate
WHERE candidate.id = source.id
  AND source.governed_scope IS NULL;

UPDATE mentions mention
SET workspace_id = COALESCE(
      (SELECT batch.workspace_id FROM import_batches batch WHERE batch.id = mention.source_file_id),
      workspace.id
    ),
    data_source_id = COALESCE(
      (SELECT batch.data_source_id FROM import_batches batch WHERE batch.id = mention.source_file_id),
      source.id
    ),
    provider_record_id = CASE
      WHEN mention.study_corpus_id IS NOT NULL
        AND mention.external_id LIKE mention.study_corpus_id::text || ':%'
        THEN substring(mention.external_id FROM length(mention.study_corpus_id::text) + 2)
      ELSE mention.external_id
    END
FROM study_corpora corpus
JOIN signal_workspaces workspace
  ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
 AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
LEFT JOIN data_sources source
  ON source.workspace_id = workspace.id
 AND source.provider = 'legacy-import'
 AND source.connection_method = 'compatibility-dual-write'
WHERE mention.study_corpus_id = corpus.id
  AND (
    mention.workspace_id IS NULL
    OR mention.data_source_id IS NULL
    OR mention.provider_record_id IS NULL
  );

UPDATE source_sync_runs run
SET workspace_id = source.workspace_id
FROM data_sources source
WHERE run.data_source_id = source.id
  AND run.workspace_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM data_sources WHERE workspace_id IS NULL) THEN
    RAISE EXCEPTION 'Workspace ownership backfill left data_sources without a workspace.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM import_batches
    WHERE workspace_id IS NULL OR data_source_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Workspace ownership backfill left import_batches incomplete.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mentions
    WHERE workspace_id IS NULL OR data_source_id IS NULL OR provider_record_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Workspace ownership backfill left mentions incomplete.';
  END IF;
  IF EXISTS (SELECT 1 FROM source_sync_runs WHERE workspace_id IS NULL) THEN
    RAISE EXCEPTION 'Workspace ownership backfill left source_sync_runs incomplete.';
  END IF;
END;
$$;

WITH ranked AS (
  SELECT
    mention.id,
    first_value(mention.id) OVER (
      PARTITION BY mention.workspace_id, mention.text_hash
      ORDER BY mention.created_at, mention.id
    ) AS canonical_id
  FROM mentions mention
)
UPDATE mentions mention
SET canonical_mention_id = ranked.canonical_id
FROM ranked
WHERE ranked.id = mention.id
  AND mention.canonical_mention_id IS NULL;

ALTER TABLE data_sources ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE import_batches
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN data_source_id SET NOT NULL,
  ALTER COLUMN study_corpus_id DROP NOT NULL;
ALTER TABLE mentions
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN data_source_id SET NOT NULL,
  ALTER COLUMN canonical_mention_id SET NOT NULL,
  ALTER COLUMN provider_record_id SET NOT NULL,
  ALTER COLUMN study_corpus_id DROP NOT NULL;
ALTER TABLE source_sync_runs ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE mentions
  DROP CONSTRAINT IF EXISTS mentions_canonical_mention_id_fkey;
ALTER TABLE mentions
  ADD CONSTRAINT mentions_canonical_mention_id_fkey
  FOREIGN KEY (canonical_mention_id) REFERENCES mentions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_data_sources_workspace
  ON data_sources (workspace_id, source_type, status);
CREATE INDEX IF NOT EXISTS idx_data_sources_governed_scope
  ON data_sources (workspace_id, governed_scope, scope_review_status);
ALTER TABLE data_sources
  DROP CONSTRAINT IF EXISTS data_sources_governed_scope,
  ADD CONSTRAINT data_sources_governed_scope CHECK (
    governed_scope IS NULL OR governed_scope IN (
      'primary_brand', 'competitor', 'category', 'reference', 'unattributed'
    )
  ),
  DROP CONSTRAINT IF EXISTS data_sources_governed_entity_type,
  ADD CONSTRAINT data_sources_governed_entity_type CHECK (
    governed_entity_type IS NULL OR governed_entity_type IN (
      'brand', 'competitor', 'category', 'reference', 'unattributed'
    )
  ),
  DROP CONSTRAINT IF EXISTS data_sources_scope_review,
  ADD CONSTRAINT data_sources_scope_review CHECK (
    scope_review_status IN ('pending', 'approved', 'rejected')
  ),
  DROP CONSTRAINT IF EXISTS data_sources_scope_policy,
  ADD CONSTRAINT data_sources_scope_policy CHECK (
    scope_policy_version IS NULL OR btrim(scope_policy_version) <> ''
  ),
  DROP CONSTRAINT IF EXISTS data_sources_scope_approval,
  ADD CONSTRAINT data_sources_scope_approval CHECK (
    scope_review_status <> 'approved'
    OR (
      governed_scope IS NOT NULL
      AND governed_entity_type IS NOT NULL
      AND scope_approval_source IS NOT NULL
      AND scope_approved_at IS NOT NULL
    )
  );
CREATE INDEX IF NOT EXISTS idx_import_batches_workspace
  ON import_batches (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_source
  ON import_batches (data_source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_contributing_study
  ON import_batches (contributed_by_study_corpus_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_sync_runs_workspace
  ON source_sync_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentions_workspace_acceptance
  ON mentions (workspace_id, inclusion_status, published_at, id);
CREATE INDEX IF NOT EXISTS idx_mentions_canonical_root
  ON mentions (canonical_mention_id, workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mentions_workspace_text_canonical
  ON mentions (workspace_id, text_hash)
  WHERE canonical_mention_id = id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mentions_workspace_provider_canonical
  ON mentions (workspace_id, source_system, provider_record_id)
  WHERE canonical_mention_id = id;

CREATE TABLE IF NOT EXISTS signal_mention_import_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  import_batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_mention_import_membership UNIQUE (mention_id, import_batch_id)
);
CREATE INDEX IF NOT EXISTS idx_signal_mention_import_memberships_batch
  ON signal_mention_import_memberships (import_batch_id, mention_id);
CREATE INDEX IF NOT EXISTS idx_signal_mention_import_memberships_workspace
  ON signal_mention_import_memberships (workspace_id, mention_id);

INSERT INTO signal_mention_import_memberships (
  workspace_id, mention_id, import_batch_id, data_source_id
)
SELECT DISTINCT
  mention.workspace_id,
  mention.canonical_mention_id,
  batch.id,
  batch.data_source_id
FROM mentions mention
JOIN import_batches batch ON batch.id = mention.source_file_id
ON CONFLICT (mention_id, import_batch_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS signal_mention_study_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id) ON DELETE CASCADE,
  import_batch_id uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  membership_role text NOT NULL DEFAULT 'contributed',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_mention_study_membership
    UNIQUE (mention_id, study_corpus_id, membership_role),
  CONSTRAINT signal_mention_study_membership_role
    CHECK (membership_role IN ('contributed', 'selected', 'analyzed'))
);
CREATE INDEX IF NOT EXISTS idx_signal_mention_study_memberships_study
  ON signal_mention_study_memberships (study_corpus_id, membership_role, mention_id);
CREATE INDEX IF NOT EXISTS idx_signal_mention_study_memberships_workspace
  ON signal_mention_study_memberships (workspace_id, mention_id);

INSERT INTO signal_mention_study_memberships (
  workspace_id, mention_id, study_corpus_id, import_batch_id, membership_role
)
SELECT
  mention.workspace_id,
  mention.canonical_mention_id,
  mention.study_corpus_id,
  mention.source_file_id,
  'contributed'
FROM mentions mention
WHERE mention.study_corpus_id IS NOT NULL
ON CONFLICT (mention_id, study_corpus_id, membership_role) DO NOTHING;

CREATE TABLE IF NOT EXISTS signal_mention_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  import_batch_id uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  scope text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_label text,
  confidence numeric(5,4),
  review_status text NOT NULL DEFAULT 'pending',
  attribution_source text NOT NULL,
  policy_version text NOT NULL,
  model_version text,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approval_source text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_mention_attribution_scope CHECK (
    scope IN ('primary_brand', 'competitor', 'category', 'reference', 'unattributed')
  ),
  CONSTRAINT signal_mention_attribution_entity_type CHECK (
    entity_type IN ('brand', 'competitor', 'category', 'reference', 'unattributed')
  ),
  CONSTRAINT signal_mention_attribution_confidence CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  CONSTRAINT signal_mention_attribution_review CHECK (
    review_status IN ('pending', 'approved', 'rejected')
  ),
  CONSTRAINT signal_mention_attribution_policy CHECK (btrim(policy_version) <> ''),
  CONSTRAINT signal_mention_attribution_approval CHECK (
    review_status <> 'approved'
    OR (approval_source IS NOT NULL AND approved_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_mention_attribution_provenance
  ON signal_mention_attributions (
    mention_id,
    data_source_id,
    COALESCE(import_batch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    scope,
    entity_type,
    COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_signal_mention_attributions_scope
  ON signal_mention_attributions (workspace_id, scope, review_status, mention_id);
CREATE INDEX IF NOT EXISTS idx_signal_mention_attributions_entity
  ON signal_mention_attributions (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_signal_mention_attributions_provenance
  ON signal_mention_attributions (import_batch_id, data_source_id, mention_id);

INSERT INTO signal_mention_attributions (
  workspace_id, mention_id, data_source_id, import_batch_id,
  scope, entity_type, entity_id, entity_label,
  confidence, review_status, attribution_source, policy_version,
  approved_by_user_id, approval_source, approved_at
)
SELECT
  membership.workspace_id,
  membership.mention_id,
  membership.data_source_id,
  membership.import_batch_id,
  COALESCE(source.governed_scope, CASE
    WHEN batch.mention_type = 'brand' OR batch.entity_kind = 'primary_brand' THEN 'primary_brand'
    WHEN batch.mention_type = 'competitor' OR batch.entity_kind IN ('competitor', 'competitor_pool') THEN 'competitor'
    WHEN batch.mention_type = 'industry' OR batch.entity_kind = 'category' THEN 'category'
    WHEN batch.entity_kind = 'reference' THEN 'reference'
    ELSE 'unattributed'
  END),
  COALESCE(source.governed_entity_type, CASE
    WHEN batch.mention_type = 'brand' OR batch.entity_kind = 'primary_brand' THEN 'brand'
    WHEN batch.mention_type = 'competitor' OR batch.entity_kind IN ('competitor', 'competitor_pool') THEN 'competitor'
    WHEN batch.mention_type = 'industry' OR batch.entity_kind = 'category' THEN 'category'
    WHEN batch.entity_kind = 'reference' THEN 'reference'
    ELSE 'unattributed'
  END),
  COALESCE(source.governed_entity_id, CASE
    WHEN batch.mention_type = 'brand' OR batch.entity_kind = 'primary_brand' THEN workspace.brand_id
    WHEN batch.mention_type = 'competitor' OR batch.entity_kind IN ('competitor', 'competitor_pool') THEN batch.competitor_id
    ELSE NULL
  END),
  COALESCE(batch.entity_label, source.name),
  1.0000,
  CASE
    WHEN source.governed_scope IS NOT NULL THEN source.scope_review_status
    ELSE 'approved'
  END,
  CASE
    WHEN source.governed_scope IS NOT NULL THEN 'governed_data_source'
    ELSE 'legacy_import_batch'
  END,
  COALESCE(source.scope_policy_version, 'workspace-scope-legacy-migration-v1'),
  source.scope_approved_by_user_id,
  CASE
    WHEN source.governed_scope IS NOT NULL THEN source.scope_approval_source
    ELSE 'migration_legacy_import'
  END,
  CASE
    WHEN source.governed_scope IS NOT NULL THEN source.scope_approved_at
    ELSE now()
  END
FROM signal_mention_import_memberships membership
JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
JOIN data_sources source ON source.id = membership.data_source_id
JOIN import_batches batch ON batch.id = membership.import_batch_id
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS signal_population_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  population_id uuid NOT NULL REFERENCES signal_population_definitions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  membership_status text NOT NULL DEFAULT 'included',
  membership_reason text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_population_membership UNIQUE (population_id, mention_id),
  CONSTRAINT signal_population_membership_status
    CHECK (membership_status IN ('included', 'excluded'))
);
CREATE INDEX IF NOT EXISTS idx_signal_population_memberships_serving
  ON signal_population_memberships (population_id, membership_status, mention_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signal_population_memberships_workspace
  ON signal_population_memberships (workspace_id, mention_id);

INSERT INTO signal_population_memberships (
  population_id, workspace_id, mention_id, membership_status, membership_reason
)
SELECT
  pointer.population_id,
  mention.workspace_id,
  mention.id,
  'included',
  'accepted_primary_brand_v1'
FROM mentions mention
JOIN signal_workspace_population_pointers pointer
  ON pointer.workspace_id = mention.workspace_id
 AND pointer.purpose = 'operational'
JOIN signal_mention_attributions attribution
  ON attribution.mention_id = mention.id
 AND attribution.workspace_id = mention.workspace_id
 AND attribution.scope = 'primary_brand'
 AND attribution.review_status = 'approved'
WHERE mention.canonical_mention_id = mention.id
  AND mention.inclusion_status = 'included'
ON CONFLICT (population_id, mention_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_signal_data_source_workspace_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE resolved_workspace signal_workspaces%ROWTYPE;
DECLARE corpus_brand_id uuid;
DECLARE corpus_theme_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.governed_scope IS NOT NULL
     AND NEW.governed_scope IS NULL THEN
    RAISE EXCEPTION 'Governed source scope cannot be cleared; reject or replace the source policy instead.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.workspace_id IS NULL AND NEW.study_corpus_id IS NOT NULL THEN
    SELECT workspace.* INTO resolved_workspace
    FROM study_corpora corpus
    JOIN signal_workspaces workspace
      ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
     AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    WHERE corpus.id = NEW.study_corpus_id
    ORDER BY workspace.created_at, workspace.id
    LIMIT 1;
    NEW.workspace_id := resolved_workspace.id;
  ELSIF NEW.workspace_id IS NULL AND NEW.brand_id IS NOT NULL THEN
    SELECT workspace.* INTO resolved_workspace
    FROM signal_workspaces workspace
    WHERE workspace.brand_id = NEW.brand_id
      AND workspace.organization_id = NEW.organization_id
    LIMIT 1;
    NEW.workspace_id := resolved_workspace.id;
  ELSE
    SELECT * INTO resolved_workspace FROM signal_workspaces WHERE id = NEW.workspace_id;
  END IF;
  IF resolved_workspace.id IS NULL THEN
    RAISE EXCEPTION 'Data source must resolve to a Signal workspace.' USING ERRCODE = '23514';
  END IF;
  NEW.organization_id := COALESCE(NEW.organization_id, resolved_workspace.organization_id);
  NEW.brand_id := COALESCE(NEW.brand_id, resolved_workspace.brand_id);
  IF NEW.organization_id IS DISTINCT FROM resolved_workspace.organization_id
     OR NEW.brand_id IS DISTINCT FROM resolved_workspace.brand_id THEN
    RAISE EXCEPTION 'Data source cannot cross workspace organization or brand.' USING ERRCODE = '23514';
  END IF;
  IF NEW.study_corpus_id IS NOT NULL THEN
    SELECT brand_id, theme_id INTO corpus_brand_id, corpus_theme_id
    FROM study_corpora WHERE id = NEW.study_corpus_id;
    IF corpus_brand_id IS DISTINCT FROM resolved_workspace.brand_id
       OR corpus_theme_id IS DISTINCT FROM resolved_workspace.theme_id THEN
      RAISE EXCEPTION 'Data source study provenance must match the workspace subject.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.governed_scope = 'primary_brand' AND (
    NEW.governed_entity_type IS DISTINCT FROM 'brand'
    OR NEW.governed_entity_id IS DISTINCT FROM resolved_workspace.brand_id
  ) THEN
    RAISE EXCEPTION 'Primary-brand source scope must target the workspace brand.' USING ERRCODE = '23514';
  END IF;
  IF NEW.governed_scope = 'competitor' AND (
    NEW.governed_entity_type IS DISTINCT FROM 'competitor'
    OR NEW.governed_entity_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM competitors competitor
      WHERE competitor.id = NEW.governed_entity_id
        AND competitor.brand_id = resolved_workspace.brand_id
    )
  ) THEN
    RAISE EXCEPTION 'Competitor source scope must target a competitor of the workspace brand.' USING ERRCODE = '23514';
  END IF;
  IF NEW.governed_scope IN ('category', 'reference', 'unattributed')
     AND NEW.governed_entity_type IS DISTINCT FROM NEW.governed_scope THEN
    RAISE EXCEPTION 'Source governed entity type must match its governed scope.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_data_sources_workspace_scope ON data_sources;
CREATE TRIGGER trg_data_sources_workspace_scope
  BEFORE INSERT OR UPDATE OF workspace_id, organization_id, brand_id, study_corpus_id,
    governed_scope, governed_entity_type, governed_entity_id, scope_review_status
  ON data_sources FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_data_source_workspace_scope();

CREATE OR REPLACE FUNCTION ensure_signal_compatibility_data_source(
  target_workspace_id uuid,
  target_source_system text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE resolved_source_id uuid;
DECLARE target_workspace signal_workspaces%ROWTYPE;
BEGIN
  SELECT id INTO resolved_source_id
  FROM data_sources
  WHERE workspace_id = target_workspace_id
    AND provider = 'legacy-import'
    AND connection_method = 'compatibility-dual-write'
  ORDER BY created_at, id
  LIMIT 1;
  IF resolved_source_id IS NOT NULL THEN RETURN resolved_source_id; END IF;
  SELECT * INTO target_workspace FROM signal_workspaces WHERE id = target_workspace_id;
  INSERT INTO data_sources (
    workspace_id, organization_id, brand_id, source_type, provider,
    connection_method, name, mapping, mapping_version, role, status, visibility
  ) VALUES (
    target_workspace.id, target_workspace.organization_id, target_workspace.brand_id,
    'social-listening', 'legacy-import', 'compatibility-dual-write',
    'Legacy corpus import compatibility', '{}'::jsonb, 1,
    jsonb_build_object('ownership', 'workspace', 'source_system', target_source_system),
    'active', 'internal'
  ) RETURNING id INTO resolved_source_id;
  RETURN resolved_source_id;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_import_workspace_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE resolved_workspace_id uuid;
DECLARE source_workspace_id uuid;
BEGIN
  IF NEW.workspace_id IS NULL AND NEW.study_corpus_id IS NOT NULL THEN
    SELECT workspace.id INTO resolved_workspace_id
    FROM study_corpora corpus
    JOIN signal_workspaces workspace
      ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
     AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    WHERE corpus.id = NEW.study_corpus_id
    ORDER BY workspace.created_at, workspace.id
    LIMIT 1;
    NEW.workspace_id := resolved_workspace_id;
  END IF;
  IF NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'Import batch must have workspace ownership.' USING ERRCODE = '23514';
  END IF;
  NEW.contributed_by_study_corpus_id := COALESCE(
    NEW.contributed_by_study_corpus_id,
    NEW.study_corpus_id
  );
  IF NEW.data_source_id IS NULL THEN
    NEW.data_source_id := ensure_signal_compatibility_data_source(
      NEW.workspace_id,
      NEW.source_system
    );
  END IF;
  SELECT workspace_id INTO source_workspace_id FROM data_sources WHERE id = NEW.data_source_id;
  IF source_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'Import batch source cannot cross workspaces.' USING ERRCODE = '23514';
  END IF;
  IF NEW.contributed_by_study_corpus_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM study_corpora corpus
    JOIN signal_workspaces workspace
      ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
     AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    WHERE corpus.id = NEW.contributed_by_study_corpus_id
      AND workspace.id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Import study provenance cannot cross workspaces.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_import_batches_workspace_scope ON import_batches;
CREATE TRIGGER trg_import_batches_workspace_scope
  BEFORE INSERT OR UPDATE OF workspace_id, study_corpus_id,
    contributed_by_study_corpus_id, data_source_id
  ON import_batches FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_import_workspace_scope();

CREATE OR REPLACE FUNCTION enforce_signal_mention_workspace_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE batch_workspace_id uuid;
DECLARE batch_source_id uuid;
DECLARE source_workspace_id uuid;
DECLARE resolved_workspace_id uuid;
BEGIN
  IF NEW.source_file_id IS NOT NULL THEN
    SELECT workspace_id, data_source_id
    INTO batch_workspace_id, batch_source_id
    FROM import_batches WHERE id = NEW.source_file_id;
    NEW.workspace_id := COALESCE(NEW.workspace_id, batch_workspace_id);
    NEW.data_source_id := COALESCE(NEW.data_source_id, batch_source_id);
  END IF;
  IF NEW.workspace_id IS NULL AND NEW.study_corpus_id IS NOT NULL THEN
    SELECT workspace.id INTO resolved_workspace_id
    FROM study_corpora corpus
    JOIN signal_workspaces workspace
      ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
     AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    WHERE corpus.id = NEW.study_corpus_id
    ORDER BY workspace.created_at, workspace.id
    LIMIT 1;
    NEW.workspace_id := resolved_workspace_id;
  END IF;
  IF NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'Mention must have workspace ownership.' USING ERRCODE = '23514';
  END IF;
  IF NEW.data_source_id IS NULL THEN
    NEW.data_source_id := ensure_signal_compatibility_data_source(
      NEW.workspace_id,
      NEW.source_system
    );
  END IF;
  SELECT workspace_id INTO source_workspace_id FROM data_sources WHERE id = NEW.data_source_id;
  IF source_workspace_id IS DISTINCT FROM NEW.workspace_id
     OR (batch_workspace_id IS NOT NULL AND batch_workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
    RAISE EXCEPTION 'Mention source or import cannot cross workspaces.' USING ERRCODE = '23514';
  END IF;
  NEW.provider_record_id := COALESCE(NULLIF(NEW.provider_record_id, ''), NEW.external_id);
  NEW.canonical_mention_id := COALESCE(NEW.canonical_mention_id, NEW.id);
  IF NEW.canonical_mention_id IS DISTINCT FROM NEW.id AND NOT EXISTS (
    SELECT 1 FROM mentions canonical
    WHERE canonical.id = NEW.canonical_mention_id
      AND canonical.workspace_id = NEW.workspace_id
      AND canonical.canonical_mention_id = canonical.id
  ) THEN
    RAISE EXCEPTION 'Mention canonical root must belong to the same workspace.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mentions_workspace_scope ON mentions;
CREATE TRIGGER trg_mentions_workspace_scope
  BEFORE INSERT OR UPDATE OF workspace_id, study_corpus_id, data_source_id,
    source_file_id, canonical_mention_id, provider_record_id
  ON mentions FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_mention_workspace_scope();

CREATE OR REPLACE FUNCTION reconcile_signal_operational_population_mention(
  target_workspace_id uuid,
  target_mention_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE target_population signal_population_definitions%ROWTYPE;
DECLARE target_mention mentions%ROWTYPE;
DECLARE eligible boolean := false;
DECLARE reason text := 'not_eligible';
BEGIN
  SELECT definition.* INTO target_population
  FROM signal_workspace_population_pointers pointer
  JOIN signal_population_definitions definition
    ON definition.id = pointer.population_id
   AND definition.workspace_id = pointer.workspace_id
  WHERE pointer.workspace_id = target_workspace_id
    AND pointer.purpose = 'operational'
    AND definition.status = 'active';
  IF target_population.id IS NULL THEN RETURN; END IF;

  SELECT * INTO target_mention
  FROM mentions mention
  WHERE mention.id = target_mention_id
    AND mention.workspace_id = target_workspace_id
    AND mention.canonical_mention_id = mention.id;
  IF target_mention.id IS NULL THEN RETURN; END IF;

  eligible := target_mention.inclusion_status = target_population.acceptance_status
    AND (
      target_population.min_quality_score IS NULL
      OR COALESCE(target_mention.quality_score, 0) >= target_population.min_quality_score
    )
    AND (
      target_population.period_start IS NULL
      OR target_mention.published_at::date >= target_population.period_start
    )
    AND (
      target_population.period_end IS NULL
      OR target_mention.published_at::date <= target_population.period_end
    )
    AND EXISTS (
      SELECT 1
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id = target_workspace_id
        AND attribution.mention_id = target_mention_id
        AND attribution.review_status = 'approved'
        AND attribution.scope = ANY(target_population.allowed_scopes)
    );

  reason := CASE
    WHEN eligible THEN 'governed_operational_population_v1'
    WHEN target_mention.inclusion_status <> target_population.acceptance_status
      THEN 'mention_acceptance_not_eligible'
    WHEN target_population.min_quality_score IS NOT NULL
      AND COALESCE(target_mention.quality_score, 0) < target_population.min_quality_score
      THEN 'quality_not_eligible'
    WHEN target_population.period_start IS NOT NULL
      AND target_mention.published_at::date < target_population.period_start
      THEN 'period_not_eligible'
    WHEN target_population.period_end IS NOT NULL
      AND target_mention.published_at::date > target_population.period_end
      THEN 'period_not_eligible'
    ELSE 'scope_or_review_not_eligible'
  END;

  INSERT INTO signal_population_memberships (
    population_id, workspace_id, mention_id, membership_status,
    membership_reason, effective_at, removed_at
  ) VALUES (
    target_population.id,
    target_workspace_id,
    target_mention_id,
    CASE WHEN eligible THEN 'included' ELSE 'excluded' END,
    reason,
    now(),
    CASE WHEN eligible THEN NULL ELSE now() END
  )
  ON CONFLICT (population_id, mention_id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    membership_status = EXCLUDED.membership_status,
    membership_reason = EXCLUDED.membership_reason,
    effective_at = CASE
      WHEN signal_population_memberships.membership_status
        IS DISTINCT FROM EXCLUDED.membership_status
      THEN now()
      ELSE signal_population_memberships.effective_at
    END,
    removed_at = EXCLUDED.removed_at;
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_signal_operational_population(
  target_workspace_id uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE candidate record;
DECLARE reconciled_count integer := 0;
BEGIN
  FOR candidate IN
    SELECT mention.id
    FROM mentions mention
    WHERE mention.workspace_id = target_workspace_id
      AND mention.canonical_mention_id = mention.id
  LOOP
    PERFORM reconcile_signal_operational_population_mention(
      target_workspace_id,
      candidate.id
    );
    reconciled_count := reconciled_count + 1;
  END LOOP;
  RETURN reconciled_count;
END;
$$;

CREATE OR REPLACE FUNCTION record_signal_mention_import_provenance(
  target_mention_id uuid,
  target_import_batch_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE target_mention mentions%ROWTYPE;
DECLARE target_batch import_batches%ROWTYPE;
DECLARE target_source data_sources%ROWTYPE;
DECLARE target_workspace signal_workspaces%ROWTYPE;
DECLARE resolved_scope text;
DECLARE resolved_entity_type text;
DECLARE resolved_entity_id uuid;
DECLARE resolved_review_status text;
DECLARE persisted_attribution_id uuid;
BEGIN
  SELECT * INTO target_mention
  FROM mentions mention
  WHERE mention.id = target_mention_id
    AND mention.canonical_mention_id = mention.id;
  SELECT * INTO target_batch FROM import_batches WHERE id = target_import_batch_id;
  SELECT * INTO target_source FROM data_sources WHERE id = target_batch.data_source_id;
  SELECT * INTO target_workspace FROM signal_workspaces WHERE id = target_batch.workspace_id;
  IF target_mention.id IS NULL OR target_batch.id IS NULL OR target_source.id IS NULL
     OR target_mention.workspace_id IS DISTINCT FROM target_batch.workspace_id
     OR target_source.workspace_id IS DISTINCT FROM target_batch.workspace_id THEN
    RAISE EXCEPTION 'Mention import provenance cannot cross workspaces.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO signal_mention_import_memberships (
    workspace_id, mention_id, import_batch_id, data_source_id
  ) VALUES (
    target_batch.workspace_id, target_mention.id, target_batch.id, target_source.id
  ) ON CONFLICT (mention_id, import_batch_id) DO NOTHING;

  IF target_batch.contributed_by_study_corpus_id IS NOT NULL THEN
    INSERT INTO signal_mention_study_memberships (
      workspace_id, mention_id, study_corpus_id, import_batch_id, membership_role
    ) VALUES (
      target_batch.workspace_id,
      target_mention.id,
      target_batch.contributed_by_study_corpus_id,
      target_batch.id,
      'contributed'
    ) ON CONFLICT DO NOTHING;
  END IF;

  resolved_scope := COALESCE(target_source.governed_scope, CASE
    WHEN target_batch.mention_type = 'brand' OR target_batch.entity_kind = 'primary_brand' THEN 'primary_brand'
    WHEN target_batch.mention_type = 'competitor'
      OR target_batch.entity_kind IN ('competitor', 'competitor_pool') THEN 'competitor'
    WHEN target_batch.mention_type = 'industry' OR target_batch.entity_kind = 'category' THEN 'category'
    WHEN target_batch.entity_kind = 'reference' THEN 'reference'
    ELSE 'unattributed'
  END);
  resolved_entity_type := COALESCE(target_source.governed_entity_type, CASE resolved_scope
    WHEN 'primary_brand' THEN 'brand'
    WHEN 'competitor' THEN 'competitor'
    WHEN 'category' THEN 'category'
    WHEN 'reference' THEN 'reference'
    ELSE 'unattributed'
  END);
  resolved_entity_id := COALESCE(target_source.governed_entity_id, CASE resolved_scope
    WHEN 'primary_brand' THEN target_workspace.brand_id
    WHEN 'competitor' THEN target_batch.competitor_id
    ELSE NULL
  END);
  resolved_review_status := CASE
    WHEN target_source.governed_scope IS NULL THEN 'approved'
    ELSE target_source.scope_review_status
  END;

  INSERT INTO signal_mention_attributions (
    workspace_id, mention_id, data_source_id, import_batch_id,
    scope, entity_type, entity_id, entity_label, confidence,
    review_status, attribution_source, policy_version,
    approved_by_user_id, approval_source, approved_at
  ) VALUES (
    target_batch.workspace_id,
    target_mention.id,
    target_source.id,
    target_batch.id,
    resolved_scope,
    resolved_entity_type,
    resolved_entity_id,
    COALESCE(target_batch.entity_label, target_source.name),
    1.0000,
    resolved_review_status,
    CASE WHEN target_source.governed_scope IS NULL
      THEN 'legacy_import_batch' ELSE 'governed_data_source' END,
    COALESCE(target_source.scope_policy_version, 'workspace-scope-legacy-v1'),
    CASE WHEN resolved_review_status = 'approved'
      THEN target_source.scope_approved_by_user_id END,
    CASE WHEN resolved_review_status = 'approved'
      THEN COALESCE(target_source.scope_approval_source, 'legacy_import_scope') END,
    CASE WHEN resolved_review_status = 'approved'
      THEN COALESCE(target_source.scope_approved_at, now()) END
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO persisted_attribution_id;

  IF persisted_attribution_id IS NULL THEN
    SELECT attribution.id INTO persisted_attribution_id
    FROM signal_mention_attributions attribution
    WHERE attribution.mention_id = target_mention.id
      AND attribution.data_source_id = target_source.id
      AND attribution.import_batch_id = target_batch.id
      AND attribution.scope = resolved_scope
      AND attribution.entity_type = resolved_entity_type
      AND attribution.entity_id IS NOT DISTINCT FROM resolved_entity_id
    LIMIT 1;
  END IF;
  PERFORM reconcile_signal_operational_population_mention(
    target_batch.workspace_id,
    target_mention.id
  );
  RETURN persisted_attribution_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_signal_mention_governance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.canonical_mention_id <> NEW.id THEN RETURN NEW; END IF;
  IF NEW.source_file_id IS NOT NULL THEN
    PERFORM record_signal_mention_import_provenance(NEW.id, NEW.source_file_id);
  END IF;
  PERFORM reconcile_signal_operational_population_mention(NEW.workspace_id, NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mentions_governance_sync ON mentions;
CREATE TRIGGER trg_mentions_governance_sync
  AFTER INSERT OR UPDATE OF inclusion_status, quality_score, published_at,
    canonical_mention_id, workspace_id, source_file_id
  ON mentions FOR EACH ROW
  EXECUTE FUNCTION sync_signal_mention_governance();

CREATE OR REPLACE FUNCTION enforce_signal_mention_import_membership_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM mentions mention
    JOIN import_batches batch ON batch.id = NEW.import_batch_id
    WHERE mention.id = NEW.mention_id
      AND mention.canonical_mention_id = mention.id
      AND mention.workspace_id = NEW.workspace_id
      AND batch.workspace_id = NEW.workspace_id
      AND batch.data_source_id = NEW.data_source_id
  ) THEN
    RAISE EXCEPTION 'Import membership must reference a canonical mention and import in the same workspace.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_mention_import_membership_scope
  ON signal_mention_import_memberships;
CREATE TRIGGER trg_signal_mention_import_membership_scope
  BEFORE INSERT OR UPDATE OF workspace_id, mention_id, import_batch_id, data_source_id
  ON signal_mention_import_memberships FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_mention_import_membership_scope();

CREATE OR REPLACE FUNCTION enforce_signal_mention_study_membership_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM mentions mention
    JOIN signal_workspace_corpora link ON link.study_corpus_id = NEW.study_corpus_id
    WHERE mention.id = NEW.mention_id
      AND mention.canonical_mention_id = mention.id
      AND mention.workspace_id = NEW.workspace_id
      AND link.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Study membership must reference a canonical mention and corpus in the same workspace.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_mention_study_membership_scope
  ON signal_mention_study_memberships;
CREATE TRIGGER trg_signal_mention_study_membership_scope
  BEFORE INSERT OR UPDATE OF workspace_id, mention_id, study_corpus_id
  ON signal_mention_study_memberships FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_mention_study_membership_scope();

CREATE OR REPLACE FUNCTION enforce_signal_attribution_workspace_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE mention_workspace_id uuid;
DECLARE workspace_brand_id uuid;
BEGIN
  SELECT workspace_id INTO mention_workspace_id
  FROM mentions
  WHERE id = NEW.mention_id
    AND canonical_mention_id = id;
  IF mention_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'Mention attribution cannot cross workspaces.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM data_sources source
    WHERE source.id = NEW.data_source_id
      AND source.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Mention attribution source cannot cross workspaces.' USING ERRCODE = '23514';
  END IF;
  IF NEW.import_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM import_batches batch
    WHERE batch.id = NEW.import_batch_id
      AND batch.workspace_id = NEW.workspace_id
      AND batch.data_source_id = NEW.data_source_id
  ) THEN
    RAISE EXCEPTION 'Mention attribution import cannot cross source or workspace.' USING ERRCODE = '23514';
  END IF;
  IF NEW.scope = 'primary_brand' THEN
    SELECT brand_id INTO workspace_brand_id FROM signal_workspaces WHERE id = NEW.workspace_id;
    IF NEW.entity_type <> 'brand' OR NEW.entity_id IS DISTINCT FROM workspace_brand_id THEN
      RAISE EXCEPTION 'Primary brand attribution must identify the workspace brand.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.scope = 'competitor' AND NEW.entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM competitors competitor
    JOIN signal_workspaces workspace ON workspace.brand_id = competitor.brand_id
    WHERE competitor.id = NEW.entity_id AND workspace.id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Competitor attribution cannot cross workspace brand scope.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_mention_attributions_workspace_scope
  ON signal_mention_attributions;
CREATE TRIGGER trg_signal_mention_attributions_workspace_scope
  BEFORE INSERT OR UPDATE OF workspace_id, mention_id, data_source_id,
    import_batch_id, scope, entity_type, entity_id
  ON signal_mention_attributions FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_attribution_workspace_scope();

CREATE OR REPLACE FUNCTION reconcile_signal_population_after_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM reconcile_signal_operational_population_mention(
      OLD.workspace_id,
      OLD.mention_id
    );
    RETURN OLD;
  END IF;
  PERFORM reconcile_signal_operational_population_mention(
    NEW.workspace_id,
    NEW.mention_id
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_attribution_population_reconcile
  ON signal_mention_attributions;
CREATE TRIGGER trg_signal_attribution_population_reconcile
  AFTER INSERT OR DELETE OR UPDATE OF scope, review_status, workspace_id, mention_id
  ON signal_mention_attributions FOR EACH ROW
  EXECUTE FUNCTION reconcile_signal_population_after_attribution();

CREATE OR REPLACE FUNCTION sync_signal_source_governance_to_attributions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.governed_scope IS NULL THEN RETURN NEW; END IF;
  UPDATE signal_mention_attributions attribution
  SET scope = NEW.governed_scope,
      entity_type = NEW.governed_entity_type,
      entity_id = NEW.governed_entity_id,
      entity_label = COALESCE(attribution.entity_label, NEW.name),
      review_status = NEW.scope_review_status,
      policy_version = COALESCE(NEW.scope_policy_version, attribution.policy_version),
      approved_by_user_id = CASE WHEN NEW.scope_review_status = 'approved'
        THEN NEW.scope_approved_by_user_id ELSE NULL END,
      approval_source = CASE WHEN NEW.scope_review_status = 'approved'
        THEN NEW.scope_approval_source ELSE NULL END,
      approved_at = CASE WHEN NEW.scope_review_status = 'approved'
        THEN NEW.scope_approved_at ELSE NULL END,
      updated_at = now()
  WHERE attribution.data_source_id = NEW.id
    AND attribution.attribution_source = 'governed_data_source';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_source_governance_attributions ON data_sources;
CREATE TRIGGER trg_signal_source_governance_attributions
  AFTER UPDATE OF governed_scope, governed_entity_type, governed_entity_id,
    scope_review_status, scope_policy_version, scope_approved_by_user_id,
    scope_approval_source, scope_approved_at
  ON data_sources FOR EACH ROW
  EXECUTE FUNCTION sync_signal_source_governance_to_attributions();

CREATE OR REPLACE FUNCTION enforce_signal_population_pointer_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM signal_population_definitions definition
    WHERE definition.id = NEW.population_id
      AND definition.workspace_id = NEW.workspace_id
      AND definition.purpose = NEW.purpose
      AND definition.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Population pointer must target an active definition in the same workspace.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_workspace_population_pointer_scope
  ON signal_workspace_population_pointers;
CREATE TRIGGER trg_signal_workspace_population_pointer_scope
  BEFORE INSERT OR UPDATE OF workspace_id, purpose, population_id
  ON signal_workspace_population_pointers FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_population_pointer_scope();

CREATE OR REPLACE FUNCTION reconcile_signal_population_after_policy_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM reconcile_signal_operational_population(NEW.workspace_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_population_pointer_reconcile
  ON signal_workspace_population_pointers;
CREATE TRIGGER trg_signal_population_pointer_reconcile
  AFTER INSERT OR UPDATE OF population_id
  ON signal_workspace_population_pointers FOR EACH ROW
  WHEN (NEW.purpose = 'operational')
  EXECUTE FUNCTION reconcile_signal_population_after_policy_change();
DROP TRIGGER IF EXISTS trg_signal_population_definition_reconcile
  ON signal_population_definitions;
CREATE TRIGGER trg_signal_population_definition_reconcile
  AFTER UPDATE OF status, acceptance_status, allowed_scopes,
    min_quality_score, period_start, period_end
  ON signal_population_definitions FOR EACH ROW
  WHEN (NEW.purpose = 'operational')
  EXECUTE FUNCTION reconcile_signal_population_after_policy_change();

CREATE OR REPLACE FUNCTION prevent_retiring_current_signal_population()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'retired'
     AND NEW.status = 'retired'
     AND EXISTS (
       SELECT 1
       FROM signal_workspace_population_pointers pointer
       WHERE pointer.population_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Current population cannot be retired while a workspace pointer references it.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_retiring_current_signal_population
  ON signal_population_definitions;
CREATE TRIGGER trg_prevent_retiring_current_signal_population
  BEFORE UPDATE OF status ON signal_population_definitions
  FOR EACH ROW EXECUTE FUNCTION prevent_retiring_current_signal_population();

CREATE OR REPLACE FUNCTION deactivate_signal_population_pointer_memberships()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.population_id = OLD.population_id THEN
    RETURN NEW;
  END IF;
  UPDATE signal_population_memberships membership
  SET membership_status = 'excluded',
      membership_reason = 'population_pointer_replaced',
      removed_at = now()
  WHERE membership.population_id = OLD.population_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_deactivate_signal_population_pointer_memberships_update
  ON signal_workspace_population_pointers;
CREATE TRIGGER trg_deactivate_signal_population_pointer_memberships_update
  AFTER UPDATE OF population_id ON signal_workspace_population_pointers
  FOR EACH ROW EXECUTE FUNCTION deactivate_signal_population_pointer_memberships();
DROP TRIGGER IF EXISTS trg_deactivate_signal_population_pointer_memberships_delete
  ON signal_workspace_population_pointers;
CREATE TRIGGER trg_deactivate_signal_population_pointer_memberships_delete
  AFTER DELETE ON signal_workspace_population_pointers
  FOR EACH ROW EXECUTE FUNCTION deactivate_signal_population_pointer_memberships();

CREATE OR REPLACE FUNCTION promote_signal_workspace_population(
  target_workspace_id uuid,
  target_purpose text,
  target_population_id uuid,
  target_promoted_by_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE current_pointer signal_workspace_population_pointers%ROWTYPE;
DECLARE current_definition signal_population_definitions%ROWTYPE;
DECLARE next_definition signal_population_definitions%ROWTYPE;
BEGIN
  SELECT * INTO current_pointer
  FROM signal_workspace_population_pointers pointer
  WHERE pointer.workspace_id = target_workspace_id
    AND pointer.purpose = target_purpose
  FOR UPDATE;
  IF current_pointer.id IS NULL THEN
    RAISE EXCEPTION 'Population promotion requires an existing current pointer.'
      USING ERRCODE = '23514';
  END IF;
  IF current_pointer.population_id = target_population_id THEN
    RETURN target_population_id;
  END IF;

  SELECT * INTO current_definition
  FROM signal_population_definitions definition
  WHERE definition.id = current_pointer.population_id
  FOR UPDATE;
  SELECT * INTO next_definition
  FROM signal_population_definitions definition
  WHERE definition.id = target_population_id
    AND definition.workspace_id = target_workspace_id
    AND definition.purpose = target_purpose
    AND definition.status IN ('draft', 'active')
  FOR UPDATE;
  IF next_definition.id IS NULL THEN
    RAISE EXCEPTION 'Next population must be a draft or active definition for the same workspace purpose.'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM signal_workspace_population_pointers
  WHERE id = current_pointer.id;

  UPDATE signal_population_definitions
  SET status = 'retired', updated_at = now()
  WHERE id = current_definition.id;
  UPDATE signal_population_definitions
  SET status = 'active',
      activated_by_user_id = target_promoted_by_user_id,
      activated_at = now(),
      updated_at = now()
  WHERE id = next_definition.id;

  INSERT INTO signal_workspace_population_pointers (
    workspace_id, purpose, population_id, promoted_by_user_id, promoted_at
  ) VALUES (
    target_workspace_id, target_purpose, next_definition.id,
    target_promoted_by_user_id, now()
  );
  IF target_purpose = 'operational' THEN
    PERFORM reconcile_signal_operational_population(target_workspace_id);
  END IF;
  RETURN next_definition.id;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_population_membership_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM signal_population_definitions definition
    JOIN mentions mention ON mention.id = NEW.mention_id
    WHERE definition.id = NEW.population_id
      AND definition.workspace_id = NEW.workspace_id
      AND mention.workspace_id = NEW.workspace_id
      AND mention.canonical_mention_id = mention.id
  ) THEN
    RAISE EXCEPTION 'Population membership must reference a canonical mention in the same workspace.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_population_membership_scope
  ON signal_population_memberships;
CREATE TRIGGER trg_signal_population_membership_scope
  BEFORE INSERT OR UPDATE OF population_id, workspace_id, mention_id
  ON signal_population_memberships FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_population_membership_scope();

DO $$
DECLARE workspace_row record;
BEGIN
  FOR workspace_row IN SELECT id FROM signal_workspaces LOOP
    PERFORM reconcile_signal_operational_population(workspace_row.id);
  END LOOP;
END;
$$;

ALTER TABLE signal_data_watermarks
  ADD COLUMN IF NOT EXISTS population_id uuid REFERENCES signal_population_definitions(id) ON DELETE SET NULL,
  ALTER COLUMN study_corpus_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_data_watermarks_workspace_source
  ON signal_data_watermarks (workspace_id, data_source_id, source_key)
  WHERE study_corpus_id IS NULL AND data_source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION record_signal_workspace_data_acceptance(
  target_workspace_id uuid,
  target_source_key text,
  target_data_source_id uuid,
  target_import_batch_id uuid,
  target_accepted_at timestamptz,
  target_materialized_at timestamptz
)
RETURNS TABLE (
  watermark_id uuid,
  workspace_id uuid,
  population_id uuid,
  changed boolean
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE prior signal_data_watermarks%ROWTYPE;
DECLARE persisted signal_data_watermarks%ROWTYPE;
DECLARE target_population_id uuid;
DECLARE max_observed timestamptz;
BEGIN
  IF NULLIF(btrim(target_source_key), '') IS NULL THEN
    RAISE EXCEPTION 'Workspace source key is required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM data_sources source
    WHERE source.id = target_data_source_id
      AND source.workspace_id = target_workspace_id
  ) THEN
    RAISE EXCEPTION 'Workspace data source does not belong to the workspace.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM import_batches batch
    WHERE batch.id = target_import_batch_id
      AND batch.workspace_id = target_workspace_id
      AND batch.data_source_id = target_data_source_id
      AND batch.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Completed import batch does not belong to the workspace source.'
      USING ERRCODE = '23514';
  END IF;
  SELECT pointer.population_id INTO target_population_id
  FROM signal_workspace_population_pointers pointer
  WHERE pointer.workspace_id = target_workspace_id
    AND pointer.purpose = 'operational';
  SELECT max(mention.published_at) INTO max_observed
  FROM mentions mention
  WHERE mention.workspace_id = target_workspace_id
    AND mention.data_source_id = target_data_source_id
    AND mention.canonical_mention_id = mention.id;
  SELECT * INTO prior
  FROM signal_data_watermarks watermark
  WHERE watermark.workspace_id = target_workspace_id
    AND watermark.study_corpus_id IS NULL
    AND watermark.data_source_id = target_data_source_id
    AND watermark.source_key = target_source_key
  FOR UPDATE;
  INSERT INTO signal_data_watermarks (
    workspace_id, study_corpus_id, population_id, data_source_id, source_key,
    corpus_revision, last_import_batch_id, max_observed_at, accepted_at,
    materialized_at, source_freshness_state, data_freshness_state, stale_after,
    metadata
  ) VALUES (
    target_workspace_id, NULL, target_population_id, target_data_source_id,
    target_source_key, 0, target_import_batch_id, max_observed,
    target_accepted_at, target_materialized_at, 'fresh', 'fresh', NULL,
    jsonb_build_object('ownership', 'workspace', 'acceptance_version', 1)
  )
  ON CONFLICT (workspace_id, data_source_id, source_key)
    WHERE study_corpus_id IS NULL AND data_source_id IS NOT NULL
  DO UPDATE SET
    population_id = EXCLUDED.population_id,
    last_import_batch_id = EXCLUDED.last_import_batch_id,
    max_observed_at = GREATEST(
      signal_data_watermarks.max_observed_at,
      EXCLUDED.max_observed_at
    ),
    accepted_at = EXCLUDED.accepted_at,
    materialized_at = EXCLUDED.materialized_at,
    source_freshness_state = 'fresh',
    data_freshness_state = 'fresh',
    metadata = signal_data_watermarks.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING * INTO persisted;
  watermark_id := persisted.id;
  workspace_id := persisted.workspace_id;
  population_id := persisted.population_id;
  changed := prior.id IS NULL
    OR prior.last_import_batch_id IS DISTINCT FROM persisted.last_import_batch_id
    OR prior.max_observed_at IS DISTINCT FROM persisted.max_observed_at;
  RETURN NEXT;
END;
$$;

ALTER TABLE corpus_snapshots
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS population_id uuid REFERENCES signal_population_definitions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS population_version integer,
  ADD COLUMN IF NOT EXISTS population_definition_hash text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS watermark_captured_at timestamptz;

UPDATE corpus_snapshots snapshot
SET workspace_id = workspace.id,
    population_id = pointer.population_id,
    population_version = definition.version,
    population_definition_hash = definition.definition_hash,
    period_start = (
      SELECT min(mention.published_at)::date
      FROM corpus_snapshot_mentions membership
      JOIN mentions mention ON mention.id = membership.mention_id
      WHERE membership.snapshot_id = snapshot.id
    ),
    period_end = (
      SELECT max(mention.published_at)::date
      FROM corpus_snapshot_mentions membership
      JOIN mentions mention ON mention.id = membership.mention_id
      WHERE membership.snapshot_id = snapshot.id
    ),
    watermark_captured_at = snapshot.created_at
FROM study_corpora corpus
JOIN signal_workspaces workspace
  ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
 AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
LEFT JOIN signal_workspace_population_pointers pointer
  ON pointer.workspace_id = workspace.id AND pointer.purpose = 'operational'
LEFT JOIN signal_population_definitions definition ON definition.id = pointer.population_id
WHERE snapshot.study_corpus_id = corpus.id
  AND snapshot.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_snap_workspace_population
  ON corpus_snapshots (workspace_id, population_id, created_at DESC);
ALTER TABLE corpus_snapshots
  DROP CONSTRAINT IF EXISTS corpus_snapshots_population_version_positive,
  ADD CONSTRAINT corpus_snapshots_population_version_positive
    CHECK (population_version IS NULL OR population_version >= 1),
  DROP CONSTRAINT IF EXISTS corpus_snapshots_population_window,
  ADD CONSTRAINT corpus_snapshots_population_window
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  DROP CONSTRAINT IF EXISTS corpus_snapshots_population_hash,
  ADD CONSTRAINT corpus_snapshots_population_hash
    CHECK (
      population_definition_hash IS NULL
      OR population_definition_hash ~ '^sha256:[0-9a-f]{64}$'
    );

CREATE TABLE IF NOT EXISTS signal_snapshot_watermarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES corpus_snapshots(id) ON DELETE CASCADE,
  data_source_id uuid REFERENCES data_sources(id) ON DELETE SET NULL,
  source_sync_run_id uuid REFERENCES source_sync_runs(id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  data_through_at timestamptz,
  accepted_at timestamptz NOT NULL,
  watermark_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_snapshot_watermark_hash
    CHECK (watermark_hash ~ '^sha256:[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_snapshot_watermark_source
  ON signal_snapshot_watermarks (
    snapshot_id,
    COALESCE(data_source_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_signal_snapshot_watermarks_snapshot
  ON signal_snapshot_watermarks (snapshot_id, accepted_at);

CREATE OR REPLACE FUNCTION create_signal_workspace_population_snapshot(
  target_workspace_id uuid,
  target_population_id uuid,
  target_study_corpus_id uuid,
  target_label text,
  target_kind text,
  target_created_by_user_id uuid,
  target_scores jsonb DEFAULT NULL
)
RETURNS TABLE (
  snapshot_id uuid,
  mention_count integer,
  population_version integer,
  population_definition_hash text,
  period_start date,
  period_end date
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE definition signal_population_definitions%ROWTYPE;
DECLARE persisted_snapshot_id uuid;
DECLARE persisted_count integer;
DECLARE persisted_period_start date;
DECLARE persisted_period_end date;
BEGIN
  SELECT * INTO definition
  FROM signal_population_definitions
  WHERE id = target_population_id
    AND workspace_id = target_workspace_id
    AND status = 'active'
  FOR SHARE;
  IF definition.id IS NULL THEN
    RAISE EXCEPTION 'Snapshot population must be active in the target workspace.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM signal_workspace_corpora membership
    WHERE membership.workspace_id = target_workspace_id
      AND membership.study_corpus_id = target_study_corpus_id
      AND membership.valid_to IS NULL
  ) THEN
    RAISE EXCEPTION 'Snapshot study must belong to the target workspace.'
      USING ERRCODE = '23514';
  END IF;
  IF target_kind NOT IN ('manual', 'approval') THEN
    RAISE EXCEPTION 'Snapshot kind must be manual or approval.' USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*)::integer,
    min(mention.published_at)::date,
    max(mention.published_at)::date
  INTO persisted_count, persisted_period_start, persisted_period_end
  FROM signal_population_memberships membership
  JOIN mentions mention
    ON mention.id = membership.mention_id
   AND mention.workspace_id = membership.workspace_id
   AND mention.canonical_mention_id = mention.id
  WHERE membership.population_id = target_population_id
    AND membership.workspace_id = target_workspace_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL;
  IF persisted_count = 0 THEN
    RAISE EXCEPTION 'Cannot freeze an empty governed population.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO corpus_snapshots (
    workspace_id, population_id, population_version,
    population_definition_hash, period_start, period_end,
    watermark_captured_at, study_corpus_id, label, kind,
    mention_count, scores_at_snapshot, created_by_user_id
  ) VALUES (
    target_workspace_id, definition.id, definition.version,
    definition.definition_hash, persisted_period_start, persisted_period_end,
    now(), target_study_corpus_id, target_label, target_kind,
    persisted_count, target_scores, target_created_by_user_id
  ) RETURNING id INTO persisted_snapshot_id;

  INSERT INTO corpus_snapshot_mentions (snapshot_id, mention_id)
  SELECT persisted_snapshot_id, membership.mention_id
  FROM signal_population_memberships membership
  WHERE membership.population_id = target_population_id
    AND membership.workspace_id = target_workspace_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL
  ORDER BY membership.mention_id;

  INSERT INTO signal_mention_study_memberships (
    workspace_id, mention_id, study_corpus_id, membership_role
  )
  SELECT target_workspace_id, snapshot_mention.mention_id,
    target_study_corpus_id, 'selected'
  FROM corpus_snapshot_mentions snapshot_mention
  WHERE snapshot_mention.snapshot_id = persisted_snapshot_id
  ON CONFLICT DO NOTHING;

  INSERT INTO signal_snapshot_watermarks (
    snapshot_id, data_source_id, import_batch_id,
    data_through_at, accepted_at, watermark_hash
  )
  SELECT
    persisted_snapshot_id,
    watermark.data_source_id,
    watermark.last_import_batch_id,
    watermark.max_observed_at,
    watermark.accepted_at,
    'sha256:' || encode(sha256(convert_to(concat_ws('|',
      target_workspace_id::text,
      target_population_id::text,
      watermark.data_source_id::text,
      watermark.last_import_batch_id::text,
      watermark.max_observed_at::text,
      watermark.accepted_at::text
    ), 'UTF8')), 'hex')
  FROM signal_data_watermarks watermark
  WHERE watermark.workspace_id = target_workspace_id
    AND watermark.study_corpus_id IS NULL
    AND watermark.data_source_id IS NOT NULL;

  snapshot_id := persisted_snapshot_id;
  mention_count := persisted_count;
  population_version := definition.version;
  population_definition_hash := definition.definition_hash;
  period_start := persisted_period_start;
  period_end := persisted_period_end;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION protect_frozen_signal_snapshot_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_snapshot_id uuid;
BEGIN
  target_snapshot_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.snapshot_id ELSE NEW.snapshot_id END;
  IF EXISTS (
    SELECT 1
    FROM corpus_snapshots snapshot
    WHERE snapshot.id = target_snapshot_id
      AND snapshot.workspace_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM tb_analyses analysis
          WHERE analysis.snapshot_id = snapshot.id
            AND analysis.scope_frozen_at IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM signal_workspace_releases release
          WHERE release.snapshot_id = snapshot.id
            AND release.status = 'published'
        )
      )
  ) THEN
    RAISE EXCEPTION 'frozen_signal_snapshot_membership_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_frozen_signal_snapshot_membership
  ON corpus_snapshot_mentions;
CREATE TRIGGER trg_protect_frozen_signal_snapshot_membership
  BEFORE INSERT OR UPDATE OR DELETE ON corpus_snapshot_mentions
  FOR EACH ROW EXECUTE FUNCTION protect_frozen_signal_snapshot_membership();

ALTER TABLE signal_workspace_releases
  ADD COLUMN IF NOT EXISTS report_key text NOT NULL DEFAULT 'triggers-barriers',
  ADD COLUMN IF NOT EXISTS report_revision integer;
WITH revisioned AS (
  SELECT id, row_number() OVER (
    PARTITION BY workspace_id, report_key
    ORDER BY created_at, id
  ) AS revision
  FROM signal_workspace_releases
)
UPDATE signal_workspace_releases release
SET report_revision = revisioned.revision
FROM revisioned
WHERE revisioned.id = release.id
  AND release.report_revision IS NULL;
ALTER TABLE signal_workspace_releases
  ALTER COLUMN report_revision SET NOT NULL,
  ALTER COLUMN report_revision SET DEFAULT 1,
  DROP CONSTRAINT IF EXISTS signal_workspace_releases_report_key,
  ADD CONSTRAINT signal_workspace_releases_report_key
    CHECK (report_key ~ '^[a-z][a-z0-9-]*$'),
  DROP CONSTRAINT IF EXISTS signal_workspace_releases_report_revision_positive,
  ADD CONSTRAINT signal_workspace_releases_report_revision_positive
    CHECK (report_revision >= 1),
  DROP CONSTRAINT IF EXISTS uq_signal_workspace_releases_report_revision,
  ADD CONSTRAINT uq_signal_workspace_releases_report_revision
    UNIQUE (workspace_id, report_key, report_revision);

CREATE TABLE IF NOT EXISTS signal_workspace_report_current_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  report_key text NOT NULL,
  release_id uuid NOT NULL REFERENCES signal_workspace_releases(id) ON DELETE RESTRICT,
  promoted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_workspace_report_current_identity UNIQUE (workspace_id, report_key),
  CONSTRAINT uq_signal_workspace_report_current_release UNIQUE (release_id)
);
CREATE INDEX IF NOT EXISTS idx_signal_workspace_report_current_workspace
  ON signal_workspace_report_current_releases (workspace_id, report_key);

INSERT INTO signal_workspace_report_current_releases (
  workspace_id, report_key, release_id, promoted_by_user_id, promoted_at
)
SELECT
  current_release.workspace_id,
  release.report_key,
  current_release.release_id,
  current_release.promoted_by_user_id,
  current_release.promoted_at
FROM signal_workspace_current_releases current_release
JOIN signal_workspace_releases release ON release.id = current_release.release_id
ON CONFLICT (workspace_id, report_key) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_signal_report_current_release_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM signal_workspace_reports report
    JOIN signal_workspace_releases release
      ON release.workspace_id = report.workspace_id
     AND release.report_key = report.report_key
    WHERE report.workspace_id = NEW.workspace_id
      AND report.report_key = NEW.report_key
      AND release.id = NEW.release_id
      AND release.status = 'published'
  ) THEN
    RAISE EXCEPTION 'Current release must be published for the same workspace report.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_workspace_report_current_release_scope
  ON signal_workspace_report_current_releases;
CREATE TRIGGER trg_signal_workspace_report_current_release_scope
  BEFORE INSERT OR UPDATE OF workspace_id, report_key, release_id
  ON signal_workspace_report_current_releases FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_report_current_release_scope();

-- Migration 0057 scoped reusable taxonomy tags through mentions.study_corpus_id.
-- Workspace-owned snapshots select canonical mentions by relational membership,
-- so study provenance must be validated through that membership instead.
CREATE OR REPLACE FUNCTION validate_signal_taxonomy_record_tag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE profile_taxonomy_id uuid;
DECLARE profile_model_version_id uuid;
DECLARE profile_workspace_id uuid;
DECLARE term_taxonomy_id uuid;
BEGIN
  IF NEW.signal_taxonomy_profile_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.subject_type <> 'mention'
    OR NEW.study_corpus_id IS NULL
    OR NEW.model_version_id IS NULL THEN
    RAISE EXCEPTION 'Signal taxonomy tags require mention, corpus, profile and model version';
  END IF;
  SELECT taxonomy_id, model_version_id, workspace_id
  INTO profile_taxonomy_id, profile_model_version_id, profile_workspace_id
  FROM signal_taxonomy_profiles
  WHERE id = NEW.signal_taxonomy_profile_id;
  SELECT taxonomy_id INTO term_taxonomy_id
  FROM taxonomy_terms WHERE id = NEW.taxonomy_term_id;
  IF term_taxonomy_id IS DISTINCT FROM profile_taxonomy_id THEN
    RAISE EXCEPTION 'Signal taxonomy tag term does not belong to its profile';
  END IF;
  IF NEW.model_version_id IS DISTINCT FROM profile_model_version_id THEN
    RAISE EXCEPTION 'Signal taxonomy tag model version does not match its profile';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM mentions mention
    JOIN signal_workspace_corpora corpus_membership
      ON corpus_membership.workspace_id = profile_workspace_id
     AND corpus_membership.study_corpus_id = NEW.study_corpus_id
     AND corpus_membership.valid_to IS NULL
    JOIN signal_mention_study_memberships mention_membership
      ON mention_membership.workspace_id = profile_workspace_id
     AND mention_membership.study_corpus_id = NEW.study_corpus_id
     AND mention_membership.mention_id = mention.id
     AND mention_membership.membership_role IN ('contributed', 'selected', 'analyzed')
    WHERE mention.id = NEW.subject_id
      AND mention.workspace_id = profile_workspace_id
      AND mention.canonical_mention_id = mention.id
  ) THEN
    RAISE EXCEPTION 'Signal taxonomy tag mention is outside its governed workspace study membership';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN mentions.workspace_id IS
  'Canonical ownership. study_corpus_id is optional execution provenance only.';
COMMENT ON COLUMN import_batches.contributed_by_study_corpus_id IS
  'Optional study that contributed data; it never owns the imported records.';
COMMENT ON TABLE signal_population_definitions IS
  'Versioned governed population definitions; membership is relational, never a serving payload.';
COMMENT ON TABLE signal_mention_study_memberships IS
  'Study/run provenance and analysis membership without copying canonical workspace mentions.';
COMMENT ON TABLE signal_mention_import_memberships IS
  'Import lineage for canonical mentions, including deduplicated records observed again in later imports.';
COMMENT ON TABLE signal_workspace_report_current_releases IS
  'Current immutable release identity by (workspace_id, report_key).';
