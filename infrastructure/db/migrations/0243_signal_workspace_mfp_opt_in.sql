-- MFP activation belongs to a workspace. A runtime switch remains a kill switch.
CREATE TABLE signal_workspace_features (
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  feature text NOT NULL CHECK(feature IN ('mention_facets','concept_membership','mfp_discovery')),
  enabled_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  enabled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,feature)
);
REVOKE ALL ON signal_workspace_features FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON signal_workspace_features FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON signal_workspace_features FROM authenticated; END IF;
END $$;
