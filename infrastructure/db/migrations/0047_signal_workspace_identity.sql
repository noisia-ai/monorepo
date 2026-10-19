-- Stable Signal workspace identity and governed corpus membership.
-- Forward-only and additive: legacy published output routes remain unchanged.

CREATE TABLE IF NOT EXISTS signal_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  brand_id uuid REFERENCES brands(id) ON DELETE RESTRICT,
  theme_id uuid REFERENCES themes(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_workspaces_exactly_one_subject CHECK (
    ((brand_id IS NOT NULL)::int + (theme_id IS NOT NULL)::int) = 1
  ),
  CONSTRAINT signal_workspaces_slug_format CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  CONSTRAINT signal_workspaces_timezone_present CHECK (btrim(timezone) <> ''),
  CONSTRAINT signal_workspaces_status CHECK (status IN ('active', 'paused', 'archived')),
  CONSTRAINT uq_signal_workspaces_org_slug UNIQUE (organization_id, slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_workspaces_brand
  ON signal_workspaces (organization_id, brand_id)
  WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_workspaces_theme
  ON signal_workspaces (organization_id, theme_id)
  WHERE theme_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_workspaces_org_status
  ON signal_workspaces (organization_id, status, slug);
CREATE INDEX IF NOT EXISTS idx_signal_workspaces_subject
  ON signal_workspaces (brand_id, theme_id);

CREATE OR REPLACE FUNCTION enforce_signal_workspace_subject_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subject_organization_id uuid;
BEGIN
  IF NEW.brand_id IS NOT NULL THEN
    SELECT organization_id INTO subject_organization_id
    FROM brands
    WHERE id = NEW.brand_id;
  ELSE
    SELECT organization_id INTO subject_organization_id
    FROM themes
    WHERE id = NEW.theme_id;
  END IF;

  IF subject_organization_id IS NULL OR subject_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Signal workspace subject must belong to its organization.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_workspaces_subject_organization ON signal_workspaces;
CREATE TRIGGER trg_signal_workspaces_subject_organization
  BEFORE INSERT OR UPDATE OF organization_id, brand_id, theme_id
  ON signal_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_workspace_subject_organization();

CREATE TABLE IF NOT EXISTS signal_workspace_corpora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id) ON DELETE RESTRICT,
  role text NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_workspace_corpora_role CHECK (
    role IN ('operational', 'strategic', 'legacy')
  ),
  CONSTRAINT signal_workspace_corpora_validity CHECK (
    valid_to IS NULL OR valid_to > valid_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_workspace_corpora_active
  ON signal_workspace_corpora (workspace_id, study_corpus_id)
  WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_signal_workspace_corpora_workspace_active
  ON signal_workspace_corpora (workspace_id, role, valid_from DESC)
  WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_signal_workspace_corpora_corpus_active
  ON signal_workspace_corpora (study_corpus_id, role, workspace_id)
  WHERE valid_to IS NULL;

CREATE OR REPLACE FUNCTION enforce_signal_workspace_corpus_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_brand_id uuid;
  workspace_theme_id uuid;
  corpus_brand_id uuid;
  corpus_theme_id uuid;
BEGIN
  SELECT brand_id, theme_id
  INTO workspace_brand_id, workspace_theme_id
  FROM signal_workspaces
  WHERE id = NEW.workspace_id;

  SELECT brand_id, theme_id
  INTO corpus_brand_id, corpus_theme_id
  FROM study_corpora
  WHERE id = NEW.study_corpus_id;

  IF workspace_brand_id IS DISTINCT FROM corpus_brand_id
     OR workspace_theme_id IS DISTINCT FROM corpus_theme_id THEN
    RAISE EXCEPTION 'Signal workspace and corpus must have the same governed subject.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_workspace_corpora_scope ON signal_workspace_corpora;
CREATE TRIGGER trg_signal_workspace_corpora_scope
  BEFORE INSERT OR UPDATE OF workspace_id, study_corpus_id
  ON signal_workspace_corpora
  FOR EACH ROW
  EXECUTE FUNCTION enforce_signal_workspace_corpus_scope();
