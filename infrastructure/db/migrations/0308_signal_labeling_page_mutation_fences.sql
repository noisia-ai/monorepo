-- Private lease checks for opted-in native page mutations. No processing
-- authority, provider attempt, charge or historical result is created here.
CREATE TABLE signal_labeling_page_mutation_fences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,run_id uuid NOT NULL,lease_token uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('mark','apply')),
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(transaction_id,run_id,operation),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id) ON DELETE RESTRICT
);
CREATE INDEX signal_labeling_page_mutation_fences_run ON signal_labeling_page_mutation_fences(workspace_id,run_id);

CREATE FUNCTION guard_signal_labeling_page_mutation_fence_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE owner signal_labeling_runs%ROWTYPE;
BEGIN
 -- SHARE also protects a direct private insertion which did not already own
 -- the worker's read fence. Check the physical clock after acquiring that lock.
 SELECT * INTO owner FROM signal_labeling_runs
 WHERE id=NEW.run_id AND workspace_id=NEW.workspace_id FOR SHARE;
 IF owner.id IS NULL OR owner.lease_token IS DISTINCT FROM NEW.lease_token
   OR owner.lease_until IS NULL OR owner.lease_until<=clock_timestamp()
   OR NEW.transaction_id<>txid_current()
   OR NEW.operation='mark' AND(owner.status<>'running' OR owner.error_code IS NOT NULL) THEN
  RAISE EXCEPTION 'labeling_lease_lost' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_labeling_page_mutation_fence
 AFTER INSERT ON signal_labeling_page_mutation_fences DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION guard_signal_labeling_page_mutation_fence_v1();

CREATE FUNCTION guard_signal_labeling_page_mutation_fence_immutable_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 RAISE EXCEPTION 'labeling_page_fence_immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER signal_labeling_page_mutation_fence_immutable
 BEFORE UPDATE OR DELETE ON signal_labeling_page_mutation_fences
 FOR EACH ROW EXECUTE FUNCTION guard_signal_labeling_page_mutation_fence_immutable_v1();
CREATE TRIGGER signal_labeling_page_mutation_fence_no_truncate
 BEFORE TRUNCATE ON signal_labeling_page_mutation_fences
 FOR EACH STATEMENT EXECUTE FUNCTION guard_signal_labeling_page_mutation_fence_immutable_v1();
ALTER TABLE signal_labeling_page_mutation_fences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_labeling_page_mutation_fences FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_signal_labeling_page_mutation_fence_v1(),guard_signal_labeling_page_mutation_fence_immutable_v1() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_labeling_page_mutation_fences FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION guard_signal_labeling_page_mutation_fence_v1(),guard_signal_labeling_page_mutation_fence_immutable_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
