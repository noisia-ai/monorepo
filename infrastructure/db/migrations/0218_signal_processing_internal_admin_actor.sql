-- The Studio administrator can run the same governed, capped processing as a
-- client admin. Policy/admission/ledger guards remain unchanged. Other internal
-- roles and client viewers do not acquire spending authority.
CREATE OR REPLACE FUNCTION signal_processing_actor_v1(target_workspace uuid,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_workspaces w
  JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
  JOIN organizations o ON o.id=w.organization_id
  JOIN users u ON u.id=target_actor AND u.status='active'
  WHERE w.id=target_workspace AND w.status='active' AND b.status='active' AND o.status='active'
   AND ((u.user_type='noisia_internal' AND u.primary_role='noisia_admin')
    OR (u.user_type='client' AND u.organization_id=o.id AND u.primary_role='client_admin'
     AND EXISTS(SELECT 1 FROM user_brand_access a WHERE a.brand_id=b.id AND a.user_id=u.id
      AND a.revoked_at IS NULL AND a.access_level='admin'))))
$$;
