-- A format stop is a private diagnostic, never a provider call or a zero-cost
-- settlement. Previously committed steps, verified RAW and costs stay intact.
CREATE TABLE signal_study_format_stops(
 execution_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),
 source_digest text NOT NULL,compiler_version text NOT NULL,stop_json jsonb NOT NULL,stop_digest text NOT NULL,
 recorded_by_token uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id),
 CHECK(compiler_version IN('legacy-v1','signal-study-editorial-batches-v2')),
 CHECK(stop_digest=signal_labeling_digest_v1(stop_json) AND source_digest~'^sha256:[a-f0-9]{64}$' AND octet_length(stop_json::text)<=8192),
 CHECK(jsonb_typeof(stop_json) IS NOT DISTINCT FROM 'object' AND stop_json ?& ARRAY['status','compiler_version','phase','unit_keys','reason','observed','limit','estimate_profile']
  AND stop_json->>'status' IS NOT DISTINCT FROM 'format_stop' AND stop_json->>'compiler_version' IS NOT DISTINCT FROM compiler_version
  AND jsonb_typeof(stop_json->'unit_keys') IS NOT DISTINCT FROM 'array' AND stop_json->>'phase' IS NOT NULL
  AND stop_json->>'reason' IN('request_bytes','estimated_output_tokens')
  AND COALESCE(stop_json->>'observed','')~'^[0-9]+$' AND COALESCE(stop_json->>'limit','')~'^[0-9]+$'
  AND(stop_json->>'observed')::numeric>(stop_json->>'limit')::numeric
  AND(stop_json->>'limit')::bigint=CASE WHEN stop_json->>'reason'='request_bytes' THEN 524288 ELSE 32768 END));
ALTER TABLE signal_study_format_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_study_format_stops FROM PUBLIC;
DO $roles$ DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON signal_study_format_stops FROM %I',r);END IF;END LOOP;END $roles$;
CREATE FUNCTION signal_study_format_stop_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;marker jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_format_stop_immutable';END IF;
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 marker:=NULLIF(current_setting('noisia.study_format_stop_v1',true),'')::jsonb;
 IF p.id IS NULL OR p.status<>'running' OR p.actor_user_id<>NEW.actor_user_id OR p.execution_token IS DISTINCT FROM NEW.recorded_by_token
  OR p.execution_expires_at<=clock_timestamp() OR p.source_digest<>NEW.source_digest
  OR COALESCE(p.source_header->>'editorial_compiler_version','legacy-v1')<>NEW.compiler_version
  OR NOT COALESCE(signal_study_source_current_v1(p.id),false) OR signal_study_exposure_v1(p.id)>p.cap_micro_usd
  OR marker IS DISTINCT FROM jsonb_build_object('execution_id',p.id,'execution_token',p.execution_token,'stop_digest',NEW.stop_digest)
 THEN RAISE EXCEPTION 'study_format_stop_not_native';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_format_stop_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_format_stops FOR EACH ROW EXECUTE FUNCTION signal_study_format_stop_guard_v1();
CREATE TRIGGER signal_study_format_stop_no_truncate BEFORE TRUNCATE ON signal_study_format_stops FOR EACH STATEMENT EXECUTE FUNCTION signal_study_truncate_v1();
CREATE FUNCTION signal_study_format_stop_parent_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF OLD.error_code='study_editorial_format_stop' AND ROW(NEW.status,NEW.error_code) IS DISTINCT FROM ROW(OLD.status,OLD.error_code)
  OR NEW.error_code='study_editorial_format_stop' AND(NEW.status<>'failed' OR NOT EXISTS(
   SELECT 1 FROM signal_study_format_stops f WHERE f.execution_id=NEW.id AND f.workspace_id=NEW.workspace_id AND f.source_digest=NEW.source_digest))
 THEN RAISE EXCEPTION 'study_format_stop_receipt_required';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_format_stop_parent_guard BEFORE UPDATE ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_study_format_stop_parent_guard_v1();
-- Reconciliation is a separate V2 wire protocol on the SAME native paid owner.
-- Preserve every prior mode/owner/provider/admission constraint.
DO $ddl$ DECLARE prior text;BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT prior FROM pg_constraint WHERE conrelid='signal_study_steps'::regclass AND conname='signal_study_steps_mode_check';
 ALTER TABLE signal_study_steps DROP CONSTRAINT signal_study_steps_mode_check;
 EXECUTE 'ALTER TABLE signal_study_steps ADD CONSTRAINT signal_study_steps_mode_check CHECK(('||prior||') OR mode=''reconciliation'')';
END $ddl$;
CREATE FUNCTION signal_study_reconciliation_owner_guard_v2() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;body jsonb;payload jsonb;
BEGIN
 IF NEW.mode<>'reconciliation' THEN RETURN NEW;END IF;
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 body:=NEW.request_body::jsonb;payload:=(body#>>'{messages,0,content}')::jsonb->'untrusted_data';
 IF p.id IS NULL OR p.source_header->>'editorial_compiler_version' IS DISTINCT FROM 'signal-study-editorial-batches-v2'
  OR payload->>'contract_version' IS DISTINCT FROM 'signal-study-reconciliation-input-v2'
  OR payload->>'study_digest' IS DISTINCT FROM p.source_header#>>'{configuration,study_digest}'
  OR COALESCE(payload->>'discovery_plan_digest','')!~'^sha256:[0-9a-f]{64}$' OR jsonb_typeof(payload->'candidates') IS DISTINCT FROM 'array'
  OR jsonb_array_length(payload->'candidates')=0 OR body->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
 THEN RAISE EXCEPTION 'study_reconciliation_owner_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER aab_signal_study_reconciliation_owner BEFORE INSERT OR UPDATE ON signal_study_steps FOR EACH ROW EXECUTE FUNCTION signal_study_reconciliation_owner_guard_v2();
REVOKE ALL ON FUNCTION signal_study_format_stop_guard_v1(),signal_study_format_stop_parent_guard_v1(),signal_study_reconciliation_owner_guard_v2() FROM PUBLIC;
CREATE FUNCTION signal_study_editorial_compiler_guard_v2() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.source_header ? 'editorial_compiler_version' AND(
  jsonb_typeof(NEW.source_header->'editorial_compiler_version') IS DISTINCT FROM 'string'
  OR NEW.source_header->>'editorial_compiler_version' IS DISTINCT FROM 'signal-study-editorial-batches-v2')
 THEN RAISE EXCEPTION 'study_editorial_compiler_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER aab_signal_study_editorial_compiler_guard BEFORE INSERT OR UPDATE ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_study_editorial_compiler_guard_v2();
REVOKE ALL ON FUNCTION signal_study_editorial_compiler_guard_v2() FROM PUBLIC;
-- An observed over-cap usage remains in the ledger, but cannot publish a new
-- interpretation even if a bookkeeping caller has not yet closed its parent.
DO $ddl$ DECLARE prior text;BEGIN
 SELECT pg_get_functiondef('signal_study_step_guard_v1()'::regprocedure) INTO STRICT prior;
 IF position('IF NEW.status=''committed'' AND(NEW.value IS NULL OR' IN prior)=0 THEN RAISE EXCEPTION 'study_commit_guard_shape_changed';END IF;
 EXECUTE replace(prior,'IF NEW.status=''committed'' AND(NEW.value IS NULL OR','IF NEW.status=''committed'' AND(NEW.value IS NULL OR signal_study_exposure_v1(p.id)>p.cap_micro_usd OR');
END $ddl$;
