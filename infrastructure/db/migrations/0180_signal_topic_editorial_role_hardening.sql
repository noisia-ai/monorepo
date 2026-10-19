-- Supabase can retain direct default grants for API roles even when PUBLIC is
-- revoked. Editorial plans, evidence, receipts and materialization remain
-- server-only; revoke every current editorial signature by OID.
DO $$
DECLARE member record;role_name text;
BEGIN
 FOR member IN
  SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'signal_topic_editorial%'
    OR p.proname='materialize_signal_topic_editorial_successor_v1')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',member.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',member.signature,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
