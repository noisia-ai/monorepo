import { and, eq, sql } from "drizzle-orm";

import { brands, organizations, signalWorkspaces, userBrandAccess, users } from "@noisia/db";
import { db } from "@/lib/db";
import { clientBrandContextAccessDecisionV1 } from "./client-brand-self-service";

type ClientBrandActor = {
  id: string;
  userType: string;
  primaryRole: string;
  organizationId: string | null;
  status: string;
};

export async function loadClientBrandCreationContextV1(actor: ClientBrandActor) {
  const decision = actor.organizationId ? {
    userId: actor.id,
    organizationId: actor.organizationId
  } : null;
  if (!decision) return null;
  const [row] = await db.select({
    organizationId: organizations.id,
    organizationName: organizations.displayName,
    organizationLegalName: organizations.legalName
  }).from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(
      eq(users.id, decision.userId),
      eq(users.userType, "client"),
      eq(users.primaryRole, "client_admin"),
      eq(users.status, "active"),
      eq(users.organizationId, decision.organizationId),
      eq(organizations.status, "active")
    ))
    .limit(1);
  return row ? {
    organizationId: row.organizationId,
    organizationName: row.organizationName ?? row.organizationLegalName
  } : null;
}

export async function loadClientBrandContextAccessV1(actor: ClientBrandActor, brandId: string) {
  if (!actor.organizationId) return null;
  const [row] = await db.select({
    brandId: brands.id,
    brandOrganizationId: brands.organizationId,
    brandStatus: brands.status,
    workspaceId: signalWorkspaces.id,
    workspaceSlug: signalWorkspaces.slug,
    workspaceStatus: signalWorkspaces.status,
    accessLevel: userBrandAccess.accessLevel,
    revokedAt: userBrandAccess.revokedAt
  }).from(brands)
    .innerJoin(users, and(
      eq(users.id, actor.id),
      eq(users.organizationId, brands.organizationId)
    ))
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .innerJoin(signalWorkspaces, and(
      eq(signalWorkspaces.brandId, brands.id),
      eq(signalWorkspaces.organizationId, brands.organizationId)
    ))
    .innerJoin(userBrandAccess, and(
      eq(userBrandAccess.brandId, brands.id),
      eq(userBrandAccess.userId, actor.id)
    ))
    .where(and(
      eq(brands.id, brandId),
      eq(brands.organizationId, actor.organizationId),
      eq(users.userType, "client"),
      eq(users.primaryRole, "client_admin"),
      eq(users.status, "active"),
      eq(organizations.status, "active")
    ))
    .limit(1);
  if (!row || !clientBrandContextAccessDecisionV1({
    actor,
    brandOrganizationId: row.brandOrganizationId,
    brandStatus: row.brandStatus,
    workspaceStatus: row.workspaceStatus,
    accessLevel: row.accessLevel,
    revokedAt: row.revokedAt
  }).allowed) return null;
  return row;
}

export async function lockClientBrandContextAccessV1(
  queryable: Pick<typeof db, "execute">,
  actor: ClientBrandActor,
  brandId: string
) {
  if (!actor.organizationId) return null;
  const result = await queryable.execute(sql`
          SELECT brand.id::text AS brand_id, workspace.id::text AS workspace_id,
                 workspace.slug AS workspace_slug
          FROM users app_user
          JOIN organizations organization ON organization.id=app_user.organization_id
          JOIN brands brand ON brand.organization_id=organization.id
          JOIN signal_workspaces workspace ON workspace.brand_id=brand.id
            AND workspace.organization_id=organization.id
          JOIN user_brand_access access ON access.user_id=app_user.id AND access.brand_id=brand.id
          WHERE app_user.id=${actor.id}::uuid AND app_user.user_type='client'
            AND app_user.primary_role='client_admin' AND app_user.status='active'
            AND app_user.organization_id=${actor.organizationId}::uuid AND organization.status='active'
            AND brand.id=${brandId}::uuid AND brand.status='active' AND workspace.status='active'
            AND access.revoked_at IS NULL AND access.access_level IN ('comment','admin')
          FOR UPDATE OF app_user, organization, brand, workspace, access
  `);
  const rows = (result as unknown as { rows?: Array<{ brand_id: string; workspace_id: string; workspace_slug: string }> }).rows ?? [];
  return rows.length === 1 ? rows[0]! : null;
}
