-- A failed or empty editorial map must not occupy the workspace engine drainer.
CREATE TABLE signal_mass_labeling_product_materializations (
 execution_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN('processing','completed','empty','failed')),
 attempts integer NOT NULL CHECK(attempts>0),
 lease_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 error_code text CHECK(error_code IS NULL OR error_code~'^[a-z0-9_]{1,160}$'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_topic_catalog_executions(workspace_id,id),
 CHECK((status='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
ALTER TABLE signal_mass_labeling_product_materializations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mass_labeling_product_materializations FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON signal_mass_labeling_product_materializations FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON signal_mass_labeling_product_materializations FROM authenticated; END IF;
END $$;
