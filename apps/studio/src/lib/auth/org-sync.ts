import { and, eq } from "drizzle-orm";

import { brands, organizations, userBrandAccess } from "@noisia/db";
import { db } from "@/lib/db";
import { brandAccessLevelForRole, isInternalRole, normalizeRole } from "@/lib/auth/roles";

type KindeOrganizationLike = {
  orgCode?: string | null;
  orgName?: string | null;
};

export async function resolveOrganizationIdFromKinde(
  kindeOrganization: KindeOrganizationLike | null,
  role: string,
  existingOrganizationId?: string | null
) {
  const canonicalRole = normalizeRole(role);
  if (!canonicalRole || isInternalRole(canonicalRole)) return null;

  const mappedSlug = mappedOrganizationSlug(kindeOrganization?.orgCode);
  const candidates = [
    mappedSlug,
    kindeOrganization?.orgCode,
    slugify(kindeOrganization?.orgName)
  ].filter((item): item is string => Boolean(item));

  if (candidates.length === 0) {
    return existingOrganizationId ?? null;
  }

  const rows = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      legalName: organizations.legalName,
      displayName: organizations.displayName
    })
    .from(organizations);

  const normalizedCandidates = new Set(candidates.map(slugify).filter(Boolean));
  const match = rows.find((org) => {
    const values = [org.slug, org.legalName, org.displayName].map(slugify).filter(Boolean);
    return values.some((value) => normalizedCandidates.has(value));
  });

  return match?.id ?? existingOrganizationId ?? null;
}

export async function syncClientBrandAccessForOrganization(args: {
  userId: string;
  role: string;
  organizationId: string | null;
}) {
  const canonicalRole = normalizeRole(args.role);
  if (!canonicalRole || isInternalRole(canonicalRole) || !args.organizationId) return;

  const brandRows = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.organizationId, args.organizationId), eq(brands.status, "active")));

  // TODO mejora-futura: reemplazar este grant por invitaciones con scope por marca.
  // Para MVP, un cliente dentro de la organizacion Kinde recibe acceso read/comment
  // a las marcas activas de esa organizacion en Noisia.
  const accessLevel = brandAccessLevelForRole(canonicalRole);

  for (const brand of brandRows) {
    await db
      .insert(userBrandAccess)
      .values({
        userId: args.userId,
        brandId: brand.id,
        accessLevel
      })
      .onConflictDoUpdate({
        target: [userBrandAccess.userId, userBrandAccess.brandId],
        set: {
          accessLevel,
          revokedAt: null
        }
      });
  }
}

function mappedOrganizationSlug(orgCode: string | null | undefined) {
  if (!orgCode) return null;
  const entries = (process.env.NOISIA_KINDE_ORG_MAP ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const [code, slug] = entry.split(":").map((item) => item?.trim());
    if (code && slug && code === orgCode) return slug;
  }

  return null;
}

function slugify(value: string | null | undefined) {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
