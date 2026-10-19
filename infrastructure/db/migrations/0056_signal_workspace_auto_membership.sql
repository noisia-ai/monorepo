-- Attach every new study corpus to the stable Signal workspace for its governed subject.
-- Forward-only and additive: existing memberships and published output routes remain intact.

CREATE OR REPLACE FUNCTION attach_study_corpus_to_signal_workspace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subject_organization_id uuid;
  subject_slug text;
  subject_kind text;
  workspace_slug text;
  resolved_workspace_id uuid;
  methodology_slug text;
  desired_role text;
BEGIN
  IF NEW.brand_id IS NOT NULL THEN
    SELECT brand.organization_id, brand.slug
    INTO subject_organization_id, subject_slug
    FROM brands brand
    WHERE brand.id = NEW.brand_id;
    subject_kind := 'brand';
  ELSE
    SELECT theme.organization_id, theme.slug
    INTO subject_organization_id, subject_slug
    FROM themes theme
    WHERE theme.id = NEW.theme_id;
    subject_kind := 'theme';
  END IF;

  IF subject_organization_id IS NULL OR subject_slug IS NULL THEN
    RAISE EXCEPTION 'Study corpus subject must resolve before Signal workspace membership.'
      USING ERRCODE = '23514';
  END IF;

  SELECT workspace.id
  INTO resolved_workspace_id
  FROM signal_workspaces workspace
  WHERE workspace.organization_id = subject_organization_id
    AND workspace.brand_id IS NOT DISTINCT FROM NEW.brand_id
    AND workspace.theme_id IS NOT DISTINCT FROM NEW.theme_id
  LIMIT 1;

  IF resolved_workspace_id IS NULL THEN
    workspace_slug := subject_slug;
    IF EXISTS (
      SELECT 1
      FROM signal_workspaces workspace
      WHERE workspace.organization_id = subject_organization_id
        AND workspace.slug = workspace_slug
    ) THEN
      workspace_slug := subject_slug || '-' || subject_kind;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM signal_workspaces workspace
      WHERE workspace.organization_id = subject_organization_id
        AND workspace.slug = workspace_slug
    ) THEN
      workspace_slug := workspace_slug || '-' || left(replace(
        COALESCE(NEW.brand_id, NEW.theme_id)::text,
        '-',
        ''
      ), 8);
    END IF;

    INSERT INTO signal_workspaces (
      organization_id,
      brand_id,
      theme_id,
      slug,
      timezone,
      status,
      metadata
    ) VALUES (
      subject_organization_id,
      NEW.brand_id,
      NEW.theme_id,
      workspace_slug,
      'America/Mexico_City',
      'active',
      jsonb_build_object(
        'created_by', 'study-corpus-auto-membership-v1',
        'subject_kind', subject_kind
      )
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO resolved_workspace_id;

    IF resolved_workspace_id IS NULL THEN
      SELECT workspace.id
      INTO resolved_workspace_id
      FROM signal_workspaces workspace
      WHERE workspace.organization_id = subject_organization_id
        AND workspace.brand_id IS NOT DISTINCT FROM NEW.brand_id
        AND workspace.theme_id IS NOT DISTINCT FROM NEW.theme_id
      LIMIT 1;
    END IF;
  END IF;

  IF resolved_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Signal workspace could not be resolved for the new study corpus.'
      USING ERRCODE = '23514';
  END IF;

  SELECT methodology.slug
  INTO methodology_slug
  FROM methodologies methodology
  WHERE methodology.id = NEW.methodology_id;

  desired_role := CASE
    WHEN methodology_slug = 'triggers-barriers' THEN 'strategic'
    WHEN methodology_slug = 'signal-pulse'
      AND NOT EXISTS (
        SELECT 1
        FROM signal_workspace_corpora membership
        WHERE membership.workspace_id = resolved_workspace_id
          AND membership.role = 'operational'
          AND membership.valid_to IS NULL
      ) THEN 'operational'
    ELSE 'legacy'
  END;

  INSERT INTO signal_workspace_corpora (
    workspace_id,
    study_corpus_id,
    role,
    metadata
  ) VALUES (
    resolved_workspace_id,
    NEW.id,
    desired_role,
    jsonb_build_object(
      'attached_by', 'study-corpus-auto-membership-v1',
      'methodology_slug', methodology_slug,
      'navigation_title_source', 'study_corpora.name'
    )
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_study_corpora_signal_workspace_membership ON study_corpora;
CREATE TRIGGER trg_study_corpora_signal_workspace_membership
  AFTER INSERT
  ON study_corpora
  FOR EACH ROW
  EXECUTE FUNCTION attach_study_corpus_to_signal_workspace();

COMMENT ON FUNCTION attach_study_corpus_to_signal_workspace() IS
  'Guarantees one stable Signal workspace per governed subject and maps each new study as an operational, strategic, or legacy page source.';
