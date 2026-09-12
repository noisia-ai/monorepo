-- Let financial internal operators use the same bounded, receipt-backed Brand
-- Context admission that client_admin already uses. This migration creates no
-- policy, admission, provider call or spend by itself. Analysts and other
-- operational roles cannot authorize the paid two-stage preparation.

CREATE OR REPLACE FUNCTION signal_brand_context_processing_actor_v1(target_workspace uuid,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspaces w
  JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
  JOIN organizations o ON o.id=w.organization_id
  JOIN users u ON u.id=target_actor
  WHERE w.id=target_workspace AND w.status='active' AND b.status='active' AND o.status='active'
    AND u.status='active' AND (
      u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','founder','admin')
      OR u.user_type='client' AND u.primary_role='client_admin' AND u.organization_id=o.id
        AND EXISTS(SELECT 1 FROM user_brand_access a WHERE a.brand_id=b.id AND a.user_id=u.id
          AND a.revoked_at IS NULL AND a.access_level='admin')
    ))
$$;

CREATE OR REPLACE FUNCTION signal_brand_context_processing_lock_actor_v1(target_workspace uuid,target_actor uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 PERFORM u.id FROM users u JOIN signal_workspaces w ON w.id=target_workspace
  JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
  JOIN organizations o ON o.id=w.organization_id
  WHERE u.id=target_actor FOR SHARE OF u,w,b,o;
 PERFORM a.id FROM user_brand_access a JOIN signal_workspaces w ON w.brand_id=a.brand_id
  WHERE w.id=target_workspace AND a.user_id=target_actor AND a.revoked_at IS NULL
  ORDER BY a.id FOR SHARE OF a;
 IF NOT signal_brand_context_processing_actor_v1(target_workspace,target_actor) THEN
  RAISE EXCEPTION 'processing_forbidden' USING ERRCODE='42501'; END IF;
END; $$;

-- CREATE OR REPLACE preserves the restricted ACL; repeat revocation explicitly
-- for installations that inherited legacy defaults.
REVOKE ALL ON FUNCTION signal_brand_context_processing_actor_v1(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_brand_context_processing_lock_actor_v1(uuid,uuid) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_brand_context_processing_actor_v1(uuid,uuid) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_brand_context_processing_lock_actor_v1(uuid,uuid) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
