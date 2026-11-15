-- Additive durable JSONL pages. No admission, activation, provider call or spend.
-- Individual historical receipt references and settlement invariants stay intact.
ALTER TABLE signal_labeling_calls ADD CONSTRAINT signal_labeling_call_page_owner
 UNIQUE(workspace_id,run_id,id);

-- Pending-only scans must not revisit the full historical call ledger per flush.
CREATE INDEX signal_labeling_calls_pending_page ON signal_labeling_calls(run_id,created_at,id) WHERE NOT results_applied;

CREATE TABLE signal_labeling_raw_pages (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,run_id uuid NOT NULL,
 name text NOT NULL CHECK(name~'^page-[0-9a-f]{64}\.jsonl$'),
 storage_key text NOT NULL UNIQUE CHECK(length(storage_key) BETWEEN 1 AND 2048),
 sha256 text NOT NULL CHECK(sha256~'^sha256:[0-9a-f]{64}$'),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 33554432),
 member_count integer NOT NULL CHECK(member_count BETWEEN 1 AND 4096),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN('planned','verified')),
 verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,run_id,id),UNIQUE(workspace_id,run_id,sha256),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id) ON DELETE RESTRICT,
 CHECK((status='verified')=(verified_at IS NOT NULL))
);
CREATE INDEX signal_labeling_raw_pages_pending ON signal_labeling_raw_pages(run_id,id) WHERE status='planned';
CREATE TABLE signal_labeling_raw_page_members (
 call_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,run_id uuid NOT NULL,page_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 raw_sha256 text NOT NULL CHECK(raw_sha256~'^sha256:[0-9a-f]{64}$'),
 raw_size_bytes bigint NOT NULL CHECK(raw_size_bytes BETWEEN 1 AND 8388608),
 byte_offset bigint NOT NULL CHECK(byte_offset>=0),byte_length bigint NOT NULL CHECK(byte_length>0),
 UNIQUE(page_id,byte_offset),
 FOREIGN KEY(workspace_id,run_id,page_id) REFERENCES signal_labeling_raw_pages(workspace_id,run_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,run_id,call_id) REFERENCES signal_labeling_calls(workspace_id,run_id,id) ON DELETE RESTRICT
);
CREATE INDEX signal_labeling_raw_page_members_run ON signal_labeling_raw_page_members(run_id,page_id);

CREATE FUNCTION signal_labeling_raw_page_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,pg_temp AS $$
DECLARE valid boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'labeling_raw_page_immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'planned' OR NEW.verified_at IS NOT NULL THEN RAISE EXCEPTION 'labeling_raw_page_unverified'; END IF;
  IF NEW.name<>'page-'||substr(NEW.sha256,8)||'.jsonl' THEN RAISE EXCEPTION 'labeling_raw_page_identity_invalid'; END IF;
  RETURN NEW;
 END IF;
 IF to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-'status'-'verified_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'verified_at')
   OR OLD.status<>'planned' OR NEW.status<>'verified' OR NEW.verified_at IS NULL THEN
  RAISE EXCEPTION 'labeling_raw_page_immutable';
 END IF;
 SELECT count(*)=NEW.member_count AND COALESCE(sum(byte_length+1),0)=NEW.size_bytes
   AND COALESCE(bool_and(byte_offset=prior_end),false)
 INTO valid FROM (
  SELECT byte_offset,byte_length,
   lag(byte_offset+byte_length+1,1,0::bigint) OVER(ORDER BY byte_offset) prior_end
  FROM signal_labeling_raw_page_members WHERE page_id=NEW.id
 ) ordered;
 IF NOT valid THEN RAISE EXCEPTION 'labeling_raw_page_members_invalid'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER signal_labeling_raw_page_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_labeling_raw_pages
 FOR EACH ROW EXECUTE FUNCTION signal_labeling_raw_page_guard_v1();

CREATE FUNCTION signal_labeling_raw_page_member_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,pg_temp AS $$
DECLARE p signal_labeling_raw_pages;c signal_labeling_calls;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'labeling_raw_page_member_immutable'; END IF;
 SELECT * INTO p FROM signal_labeling_raw_pages WHERE id=NEW.page_id FOR KEY SHARE;
 SELECT * INTO c FROM signal_labeling_calls WHERE id=NEW.call_id FOR KEY SHARE;
 IF p.id IS NULL OR c.id IS NULL OR p.status<>'planned'
   OR NEW.workspace_id<>p.workspace_id OR NEW.run_id<>p.run_id
   OR NEW.workspace_id<>c.workspace_id OR NEW.run_id<>c.run_id OR NEW.request_digest<>c.request_digest
   OR c.status NOT IN('submitting','unknown') OR c.raw_sha256 IS NOT NULL OR c.raw_storage_key IS NOT NULL
   OR NEW.byte_offset+NEW.byte_length+1>p.size_bytes THEN
  RAISE EXCEPTION 'labeling_raw_page_member_invalid';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER signal_labeling_raw_page_member_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_labeling_raw_page_members
 FOR EACH ROW EXECUTE FUNCTION signal_labeling_raw_page_member_guard_v1();

CREATE FUNCTION signal_labeling_raw_page_call_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,pg_temp AS $$
DECLARE m signal_labeling_raw_page_members;p signal_labeling_raw_pages;
BEGIN
 SELECT * INTO m FROM signal_labeling_raw_page_members WHERE call_id=OLD.id;
 IF m.call_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.workspace_id<>m.workspace_id OR NEW.run_id<>m.run_id OR NEW.request_digest<>m.request_digest THEN
  RAISE EXCEPTION 'labeling_raw_page_call_identity_invalid';
 END IF;
 IF OLD.raw_storage_key IS NOT NULL AND
   (NEW.raw_storage_key,NEW.raw_sha256,NEW.raw_size_bytes) IS DISTINCT FROM
   (OLD.raw_storage_key,OLD.raw_sha256,OLD.raw_size_bytes) THEN
  RAISE EXCEPTION 'labeling_raw_page_call_immutable';
 END IF;
 IF NEW.raw_storage_key IS NOT NULL THEN
  SELECT * INTO p FROM signal_labeling_raw_pages WHERE id=m.page_id;
  IF p.status<>'verified' OR NEW.raw_storage_key<>p.storage_key OR NEW.raw_sha256<>m.raw_sha256
    OR NEW.raw_size_bytes<>m.raw_size_bytes THEN RAISE EXCEPTION 'labeling_raw_page_call_reference_invalid'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER signal_labeling_raw_page_call_guard
 BEFORE UPDATE OF workspace_id,run_id,request_digest,raw_storage_key,raw_sha256,raw_size_bytes ON signal_labeling_calls
 FOR EACH ROW EXECUTE FUNCTION signal_labeling_raw_page_call_guard_v1();

ALTER TABLE signal_labeling_raw_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_labeling_raw_page_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_labeling_raw_pages,signal_labeling_raw_page_members FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_labeling_raw_page_guard_v1(),signal_labeling_raw_page_member_guard_v1(),
 signal_labeling_raw_page_call_guard_v1() FROM PUBLIC;
DO $$DECLARE role_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_labeling_raw_pages,signal_labeling_raw_page_members FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_labeling_raw_page_guard_v1(),signal_labeling_raw_page_member_guard_v1(),signal_labeling_raw_page_call_guard_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

-- Historical recovery keeps its original exact-key contract. A page recovery
-- additionally seals the pre-existing, verified page/member in the same audit.
ALTER TABLE signal_mass_labeling_jev_receipt_recoveries ADD COLUMN raw_page_id uuid,
 ADD CONSTRAINT signal_mass_labeling_jev_recovery_page FOREIGN KEY(workspace_id,run_id,raw_page_id)
 REFERENCES signal_labeling_raw_pages(workspace_id,run_id,id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION guard_signal_mass_labeling_jev_recovery_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE receipt signal_labeling_calls%ROWTYPE; outcome signal_mass_labeling_results%ROWTYPE;
BEGIN
 SELECT * INTO receipt FROM signal_labeling_calls WHERE workspace_id=NEW.workspace_id AND id=NEW.call_id FOR UPDATE;
 SELECT * INTO outcome FROM signal_mass_labeling_results WHERE workspace_id=NEW.workspace_id AND map_id=NEW.map_id AND root_id=NEW.root_id FOR UPDATE;
 IF receipt.id IS NULL OR outcome.call_id IS DISTINCT FROM receipt.id OR receipt.run_id IS DISTINCT FROM NEW.run_id
  OR receipt.provider<>'typesafe' OR receipt.transport<>'sync' OR receipt.status<>'unknown'
  OR receipt.settled_micro_usd IS NOT NULL OR receipt.usage IS NOT NULL OR receipt.terminal_exposure_micro_usd<>0
  OR NOT receipt.results_applied OR outcome.status<>'error' OR receipt.request_digest IS DISTINCT FROM NEW.request_digest
  OR NEW.original_call IS DISTINCT FROM to_jsonb(receipt) OR NEW.original_result IS DISTINCT FROM to_jsonb(outcome)
  OR NOT (NEW.raw_page_id IS NULL AND NEW.raw_storage_key = 'workspace-engine/'||NEW.workspace_id||'/'||NEW.run_id||'/response-'||NEW.call_id||'.json.'||substr(NEW.raw_sha256,8)||'.parts.json'
    OR NEW.raw_page_id IS NOT NULL AND EXISTS(SELECT 1 FROM signal_labeling_raw_pages p
      JOIN signal_labeling_raw_page_members m ON m.page_id=p.id AND m.workspace_id=p.workspace_id AND m.run_id=p.run_id
      WHERE p.id=NEW.raw_page_id AND p.workspace_id=NEW.workspace_id AND p.run_id=NEW.run_id AND p.status='verified'
        AND m.call_id=NEW.call_id AND m.request_digest=NEW.request_digest AND m.raw_sha256=NEW.raw_sha256
        AND m.raw_size_bytes=NEW.raw_size_bytes AND p.storage_key=NEW.raw_storage_key
        AND m.byte_offset+m.byte_length+1<=p.size_bytes))
  OR NEW.recovered_result->>'root_id' IS DISTINCT FROM NEW.root_id::text
  OR NEW.recovered_result->>'input_digest' IS DISTINCT FROM receipt.inputs->0->>'input_digest'
  OR NOT COALESCE(NEW.recovered_result->>'status' IN('labeled','abstained'),false)
  OR receipt.raw_sha256 IS NOT NULL AND receipt.raw_sha256 IS DISTINCT FROM NEW.raw_sha256
  OR receipt.raw_storage_key IS NOT NULL AND receipt.raw_storage_key IS DISTINCT FROM NEW.raw_storage_key
  OR NOT EXISTS(SELECT 1 FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
    JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id AND admission.target_id=run.id AND admission.workspace_id=run.workspace_id
    WHERE run.id=NEW.run_id AND run.workspace_id=NEW.workspace_id AND run.kind='mass_labeling'
     AND run.actor_user_id=NEW.recovered_by_user_id AND run.status='failed' AND run.error_code='labeling_outcome_unknown'
     AND (run.lease_until IS NULL OR run.lease_until<now())
     AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v2') THEN
  RAISE EXCEPTION 'mass_labeling_jev_recovery_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
