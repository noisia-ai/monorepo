CREATE TABLE signal_entity_context_versions (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),version_no integer NOT NULL CHECK(version_no>0),digest text NOT NULL,
 parent_digest text,context jsonb NOT NULL,diff jsonb NOT NULL,affected_mode text NOT NULL CHECK(affected_mode IN('targeted','full')),
 affected_count integer NOT NULL CHECK(affected_count>=0),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,version_no)
);
CREATE TABLE signal_entity_context_affected_roots (
 workspace_id uuid NOT NULL,version_no integer NOT NULL,root_id uuid NOT NULL REFERENCES mentions(id),
 PRIMARY KEY(workspace_id,version_no,root_id),FOREIGN KEY(workspace_id,version_no) REFERENCES signal_entity_context_versions(workspace_id,version_no)
);
CREATE INDEX signal_entity_context_digest ON signal_entity_context_versions(workspace_id,digest);
ALTER TABLE signal_labeling_runs ADD COLUMN entity_context_version_no integer NOT NULL, ADD FOREIGN KEY(workspace_id,entity_context_version_no) REFERENCES signal_entity_context_versions(workspace_id,version_no);
ALTER TABLE signal_entity_context_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_entity_context_affected_roots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_entity_context_versions,signal_entity_context_affected_roots FROM PUBLIC;
