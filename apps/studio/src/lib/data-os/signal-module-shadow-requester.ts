import {
  canViewClientOutputs,
  getUserType,
  normalizeRole
} from "@/lib/auth/roles";
import type { SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import type { SignalModuleShadowRequesterAuthorityV1 } from "@/lib/data-os/signal-module-shadow-authority";

export type SignalModuleShadowRequesterRowV1 = {
  id: string;
  user_type: string;
  primary_role: string;
  organization_id: string | null;
  status: string;
};

export type SignalModuleShadowRequesterV1 = {
  user: SignalWorkspaceUser;
  isInternalUser: boolean;
};

export type SignalModuleShadowRequesterQueryableV1 = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Row[] }>;
};

/**
 * Re-derives requester capabilities from the current DB-owned role. The durable
 * request only supplies the user identity and an expected visibility class, so
 * a suspension, role change, organization change, or malformed user row fails
 * closed instead of inheriting the authorization that existed at enqueue time.
 */
export function resolveSignalModuleShadowRequesterV1(
  row: SignalModuleShadowRequesterRowV1 | undefined,
  expected: SignalModuleShadowRequesterAuthorityV1
): SignalModuleShadowRequesterV1 | null {
  if (!row || row.id !== expected.user_id || row.status !== "active") return null;
  const canonicalRole = normalizeRole(row.primary_role);
  if (!canonicalRole || !canViewClientOutputs(canonicalRole)) return null;
  const derivedUserType = getUserType(canonicalRole);
  if (row.user_type !== derivedUserType) return null;
  const isInternalUser = derivedUserType === "noisia_internal";
  if ((isInternalUser ? "internal" : "client") !== expected.visibility_class) {
    return null;
  }
  if (row.organization_id !== expected.organization_id) return null;
  if ((isInternalUser && row.organization_id !== null)
    || (!isInternalUser && row.organization_id === null)) {
    return null;
  }
  return {
    user: {
      id: row.id,
      userType: derivedUserType,
      organizationId: row.organization_id
    },
    isInternalUser
  };
}

export async function loadSignalModuleShadowRequesterV1(
  authority: SignalModuleShadowRequesterAuthorityV1,
  queryable: SignalModuleShadowRequesterQueryableV1
) {
  const result = await queryable.query<SignalModuleShadowRequesterRowV1>(`
    SELECT id::text, user_type, primary_role, organization_id::text, status
    FROM users
    WHERE id = $1::uuid
    LIMIT 1
  `, [authority.user_id]);
  return resolveSignalModuleShadowRequesterV1(result.rows[0], authority);
}
