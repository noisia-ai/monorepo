export type SignalWorkspaceCapabilitiesV1 = {
  can_view: boolean;
  can_edit_topics: boolean;
  can_import_mentions: boolean;
  can_execute_topics: boolean;
  can_adopt_topics: boolean;
};

export type SignalWorkspaceCapabilityAuthorityV1 = {
  workspace_status: string;
  brand_status: string | null;
  actor_status: string;
  user_type: string;
  primary_role: string;
  same_organization: boolean;
  brand_access_level: string | null;
};

/** Roles and grants come from our database, never from the request body or identity token. */
export function resolveSignalWorkspaceCapabilitiesV1(
  authority: SignalWorkspaceCapabilityAuthorityV1 | null
): SignalWorkspaceCapabilitiesV1 {
  const denied: SignalWorkspaceCapabilitiesV1 = { can_view: false, can_edit_topics: false,
    can_import_mentions: false, can_execute_topics: false, can_adopt_topics: false };
  if (!authority || authority.workspace_status !== "active" || authority.brand_status !== "active"
    || authority.actor_status !== "active") return denied;
  const internalRoles = ["noisia_admin", "analyst", "founder", "admin", "kam",
    "insights_manager", "ux_data_specialist"];
  const internal = authority.user_type === "noisia_internal"
    && internalRoles.includes(authority.primary_role);
  if (internal) return { can_view: true, can_edit_topics: true, can_import_mentions: true,
    can_execute_topics: true, can_adopt_topics: true };
  if (authority.user_type !== "client" || !authority.same_organization) return denied;
  const administrator = ["client_admin", "brand_manager", "client_owner"].includes(authority.primary_role);
  const viewer = ["client_viewer", "agency_insights"].includes(authority.primary_role);
  const hasGrant = ["read", "comment", "admin"].includes(authority.brand_access_level ?? "");
  const canEdit = administrator && ["comment", "admin"].includes(authority.brand_access_level ?? "");
  return { ...denied, can_view: (administrator || viewer) && hasGrant,
    can_edit_topics: canEdit, can_import_mentions: canEdit };
}

export async function loadSignalWorkspaceCapabilitiesStoreV1(args: {
  queryable: { query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> };
  workspace_id: string;
  actor_user_id: string;
}): Promise<SignalWorkspaceCapabilitiesV1> {
  const authority = (await args.queryable.query<SignalWorkspaceCapabilityAuthorityV1>(`
    SELECT workspace.status workspace_status,brand.status brand_status,
      actor.status actor_status,actor.user_type,actor.primary_role,
      (actor.organization_id=workspace.organization_id) same_organization,
      grant_access.access_level brand_access_level
    FROM signal_workspaces workspace
    JOIN users actor ON actor.id=$2::uuid
    LEFT JOIN brands brand ON brand.id=workspace.brand_id
    LEFT JOIN LATERAL (
      SELECT access.access_level FROM user_brand_access access
      WHERE access.user_id=actor.id AND access.brand_id=workspace.brand_id
        AND access.revoked_at IS NULL
      ORDER BY CASE access.access_level WHEN 'admin' THEN 0 WHEN 'comment' THEN 1 ELSE 2 END
      LIMIT 1
    ) grant_access ON true
    WHERE workspace.id=$1::uuid
  `, [args.workspace_id, args.actor_user_id])).rows[0] ?? null;
  return resolveSignalWorkspaceCapabilitiesV1(authority);
}
