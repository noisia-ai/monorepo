type ClientBrandActor = {
  id: string;
  userType: string;
  primaryRole: string;
  organizationId: string | null;
  status: string;
};

export type ClientBrandCreationAuthorityV1 =
  | { allowed: true; organizationId: string; accessLevel: "comment" }
  | { allowed: false };

export function clientBrandCreationDecisionV1(actor: ClientBrandActor): ClientBrandCreationAuthorityV1 {
  return actor.userType === "client" && actor.primaryRole === "client_admin"
    && actor.status === "active" && Boolean(actor.organizationId)
    ? { allowed: true, organizationId: actor.organizationId!, accessLevel: "comment" }
    : { allowed: false };
}

export function clientBrandContextAccessDecisionV1(args: {
  actor: ClientBrandActor;
  brandOrganizationId: string;
  brandStatus: string;
  workspaceStatus: string;
  accessLevel: string | null;
  revokedAt: Date | null;
}) {
  const creation = clientBrandCreationDecisionV1(args.actor);
  return {
    allowed: creation.allowed
      && creation.organizationId === args.brandOrganizationId
      && args.brandStatus === "active"
      && args.workspaceStatus === "active"
      && args.revokedAt === null
      && (args.accessLevel === "comment" || args.accessLevel === "admin")
  };
}

type CanonicalResult<T extends Record<string, unknown>> =
  | { ok: true; value: T }
  | { ok: false; error: "client_brand_scope_forbidden" };

export function canonicalClientBrandCreateRequestV1(args: {
  actor: ClientBrandActor;
  authority: ClientBrandCreationAuthorityV1;
  mutationId: string;
  input: Record<string, unknown>;
}): CanonicalResult<Record<string, unknown>> {
  if (!args.authority.allowed) return { ok: false, error: "client_brand_scope_forbidden" };
  const requestedOrganizationId = cleanOptionalString(args.input.organization_id);
  const organizationName = cleanOptionalString(args.input.organization_name);
  const requestedStatus = cleanOptionalString(args.input.status);
  const requestedManager = cleanOptionalString(args.input.primary_brand_manager_user_id);
  if ((requestedOrganizationId && requestedOrganizationId !== args.authority.organizationId)
      || organizationName || (requestedStatus && requestedStatus !== "active")
      || (requestedManager && requestedManager !== args.actor.id)) {
    return { ok: false, error: "client_brand_scope_forbidden" };
  }
  const value: Record<string, unknown> = { ...args.input };
  delete value["organization_name"];
  value["organization_id"] = args.authority.organizationId;
  value["status"] = "active";
  value["primary_brand_manager_user_id"] = args.actor.id;
  value["preparation"] = { idempotency_key: args.mutationId };
  return { ok: true, value };
}

export function canonicalClientBrandUpdateRequestV1(args: {
  actor: ClientBrandActor;
  current: { organizationId: string; slug: string; status: string };
  mutationId: string;
  input: Record<string, unknown>;
}): CanonicalResult<Record<string, unknown>> {
  const requestedOrganizationId = cleanOptionalString(args.input.organization_id);
  const requestedSlug = cleanOptionalString(args.input.slug);
  const requestedStatus = cleanOptionalString(args.input.status);
  if ((requestedOrganizationId && requestedOrganizationId !== args.current.organizationId)
      || (requestedSlug && requestedSlug !== args.current.slug)
      || (requestedStatus && requestedStatus !== args.current.status)) {
    return { ok: false, error: "client_brand_scope_forbidden" };
  }
  const value: Record<string, unknown> = { ...args.input };
  value["organization_id"] = args.current.organizationId;
  value["slug"] = args.current.slug;
  value["status"] = args.current.status;
  value["preparation"] = { idempotency_key: args.mutationId };
  return { ok: true, value };
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
