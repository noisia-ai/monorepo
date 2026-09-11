export type SignalWorkspaceCapabilitiesV1 = {
  can_view: boolean;
  can_edit_topics: boolean;
  can_import_mentions: boolean;
  can_execute_topics: boolean;
  can_adopt_topics: boolean;
  can_select_signal: boolean;
};

export type SignalWorkspaceCapabilityAuthorityV1 = {
  workspace_status: string;
  brand_status: string | null;
  actor_status: string;
  user_type: string;
  primary_role: string;
  same_organization: boolean;
  brand_access_level: string | null;
  /** Missing values cannot authorize editorial writes; historical read consumers may omit them. */
  organization_status?: string | null;
  brand_same_organization?: boolean;
};

/** Roles and grants come from our database, never from the request body or identity token. */
export function resolveSignalWorkspaceCapabilitiesV1(
  authority: SignalWorkspaceCapabilityAuthorityV1 | null
): SignalWorkspaceCapabilitiesV1 {
  const denied: SignalWorkspaceCapabilitiesV1 = { can_view: false, can_edit_topics: false,
    can_import_mentions: false, can_execute_topics: false, can_adopt_topics: false, can_select_signal: false };
  if (!authority || authority.workspace_status !== "active" || authority.brand_status !== "active"
    || authority.actor_status !== "active") return denied;
  const internalRoles = ["noisia_admin", "analyst", "founder", "admin", "kam",
    "insights_manager", "ux_data_specialist"];
  const internal = authority.user_type === "noisia_internal"
    && internalRoles.includes(authority.primary_role);
  if (internal) return { can_view: true, can_edit_topics: true, can_import_mentions: true,
    can_execute_topics: true, can_adopt_topics: true, can_select_signal: true };
  if (authority.user_type !== "client" || !authority.same_organization) return denied;
  const administrator = ["client_admin", "brand_manager", "client_owner"].includes(authority.primary_role);
  const viewer = ["client_viewer", "agency_insights"].includes(authority.primary_role);
  const hasGrant = ["read", "comment", "admin"].includes(authority.brand_access_level ?? "");
  const canEdit = administrator && ["comment", "admin"].includes(authority.brand_access_level ?? "");
  return { ...denied, can_view: (administrator || viewer) && hasGrant,
    can_edit_topics: canEdit && authority.primary_role === "client_admin"
      && authority.organization_status === "active" && authority.brand_same_organization === true,
    can_import_mentions: canEdit, can_select_signal: canEdit };
}

export async function loadSignalWorkspaceCapabilitiesStoreV1(args: {
  queryable: { query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> };
  workspace_id: string;
  actor_user_id: string;
  /** Mutations call this only inside their transaction, after the taxonomy advisory lock. */
  lock_authority?: boolean;
}): Promise<SignalWorkspaceCapabilitiesV1> {
  if (args.lock_authority) {
    // Hold mutable authority through the receipt/result read and commit. A grant
    // revocation or organization/role change cannot pass between check and write.
    await args.queryable.query(`
      SELECT actor.id FROM users actor
      JOIN signal_workspaces workspace ON workspace.id=$1::uuid
      JOIN brands brand ON brand.id=workspace.brand_id
      JOIN organizations organization ON organization.id=workspace.organization_id
      WHERE actor.id=$2::uuid
      FOR SHARE OF actor,organization,brand,workspace
    `, [args.workspace_id, args.actor_user_id]);
    await args.queryable.query(`
      SELECT access.id FROM user_brand_access access
      JOIN signal_workspaces workspace ON workspace.brand_id=access.brand_id
      WHERE workspace.id=$1::uuid AND access.user_id=$2::uuid AND access.revoked_at IS NULL
      ORDER BY access.id FOR SHARE OF access
    `, [args.workspace_id, args.actor_user_id]);
  }
  const authority = (await args.queryable.query<SignalWorkspaceCapabilityAuthorityV1>(`
    SELECT workspace.status workspace_status,brand.status brand_status,
      organization.status organization_status,
      (brand.organization_id=workspace.organization_id) brand_same_organization,
      actor.status actor_status,actor.user_type,actor.primary_role,
      (actor.organization_id=workspace.organization_id) same_organization,
      grant_access.access_level brand_access_level
    FROM signal_workspaces workspace
    JOIN users actor ON actor.id=$2::uuid
    LEFT JOIN brands brand ON brand.id=workspace.brand_id
    LEFT JOIN organizations organization ON organization.id=workspace.organization_id
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

export type SignalBrandWorkspaceEntryV1 = {
  workspace_id: string;
  workspace_slug: string;
  name: string;
  brand_id: string;
  organization_id: string;
  timezone: string;
  capabilities: SignalWorkspaceCapabilitiesV1;
};

/** One authorized brand-workspace inventory; no report or corpus is required. */
export async function listSignalBrandWorkspaceEntriesStoreV1(args: {
  queryable: Parameters<typeof loadSignalWorkspaceCapabilitiesStoreV1>[0]["queryable"];
  actor_user_id: string;
  workspace_slug?: string;
}): Promise<SignalBrandWorkspaceEntryV1[]> {
  if (args.workspace_slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(args.workspace_slug)) return [];
  type Row = Omit<SignalBrandWorkspaceEntryV1, "capabilities"> & SignalWorkspaceCapabilityAuthorityV1;
  const rows = (await args.queryable.query<Row>(`
    SELECT workspace.id workspace_id,workspace.slug workspace_slug,
      COALESCE(brand.display_name,brand.name,workspace.slug) name,
      workspace.brand_id,workspace.organization_id,workspace.timezone,
      workspace.status workspace_status,brand.status brand_status,
      organization.status organization_status,
      (brand.organization_id=workspace.organization_id) brand_same_organization,
      actor.status actor_status,actor.user_type,actor.primary_role,
      (actor.organization_id=workspace.organization_id) same_organization,
      grant_access.access_level brand_access_level
    FROM signal_workspaces workspace
    JOIN brands brand ON brand.id=workspace.brand_id AND brand.organization_id=workspace.organization_id
    JOIN organizations organization ON organization.id=workspace.organization_id
    JOIN users actor ON actor.id=$1::uuid AND actor.status='active'
    LEFT JOIN LATERAL (
      SELECT access.access_level FROM user_brand_access access
      WHERE access.user_id=actor.id AND access.brand_id=workspace.brand_id
        AND access.revoked_at IS NULL AND access.access_level IN('read','comment','admin')
      ORDER BY CASE access.access_level WHEN 'admin' THEN 0 WHEN 'comment' THEN 1 ELSE 2 END
      LIMIT 1
    ) grant_access ON true
    WHERE workspace.status='active' AND brand.status='active'
      AND ($2::text IS NULL OR workspace.slug=$2)
      AND (actor.user_type='noisia_internal' OR
        actor.user_type='client' AND actor.organization_id=workspace.organization_id AND grant_access.access_level IS NOT NULL)
    ORDER BY lower(COALESCE(brand.display_name,brand.name,workspace.slug)),workspace.id
  `, [args.actor_user_id, args.workspace_slug ?? null])).rows;
  return rows.flatMap(row => {
    const capabilities = resolveSignalWorkspaceCapabilitiesV1(row);
    if (!capabilities.can_view) return [];
    return [{ workspace_id: row.workspace_id, workspace_slug: row.workspace_slug, name: row.name,
      brand_id: row.brand_id, organization_id: row.organization_id, timezone: row.timezone, capabilities }];
  });
}
