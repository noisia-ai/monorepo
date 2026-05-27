import type { NoisiaCanonicalRole, NoisiaPrimaryRole, NoisiaUserType } from "@noisia/types";

export const canonicalRoles = [
  "noisia_admin",
  "analyst",
  "client_admin",
  "client_viewer"
] as const satisfies NoisiaCanonicalRole[];

const rolePriority: NoisiaCanonicalRole[] = [
  "noisia_admin",
  "analyst",
  "client_admin",
  "client_viewer"
];

const legacyRoleAliases: Record<string, NoisiaCanonicalRole> = {
  founder: "noisia_admin",
  admin: "noisia_admin",
  kam: "noisia_admin",
  insights_manager: "analyst",
  ux_data_specialist: "analyst",
  brand_manager: "client_admin",
  client_owner: "client_admin",
  agency_insights: "client_viewer"
};

export const roleLabels: Record<NoisiaCanonicalRole, string> = {
  noisia_admin: "Noisia admin",
  analyst: "Analista",
  client_admin: "Cliente admin",
  client_viewer: "Cliente lector"
};

export function normalizeRole(role: string | null | undefined): NoisiaCanonicalRole | null {
  if (!role) return null;
  const normalized = role.trim().toLowerCase();
  if ((canonicalRoles as readonly string[]).includes(normalized)) {
    return normalized as NoisiaCanonicalRole;
  }
  return legacyRoleAliases[normalized] ?? null;
}

export function pickPrimaryRole(
  kindeRoles: Array<{ key?: string; name?: string }> | null,
  email?: string
): NoisiaCanonicalRole {
  const keys = new Set(
    (kindeRoles ?? [])
      .flatMap((role) => [role.key, role.name])
      .filter((role): role is string => Boolean(role))
      .map((role) => normalizeRole(role))
      .filter((role): role is NoisiaCanonicalRole => Boolean(role))
  );

  const kindeRole = rolePriority.find((role) => keys.has(role));

  if (kindeRole) {
    return kindeRole;
  }

  // TODO mejora-futura: reemplazar este bootstrap MVP por roles Kinde
  // obligatorios asignados desde invitaciones y organization memberships.
  if (email && isBootstrapFounderEmail(email)) {
    return "noisia_admin";
  }

  return "client_viewer";
}

export function getUserType(role: NoisiaPrimaryRole | string): NoisiaUserType {
  const canonical = normalizeRole(role) ?? "client_viewer";
  return isInternalRole(canonical) ? "noisia_internal" : "client";
}

export function isInternalRole(role: string) {
  const canonical = normalizeRole(role);
  return canonical === "noisia_admin" || canonical === "analyst";
}

export function canAccessStudio(role: string) {
  return isInternalRole(role);
}

export function canAccessPortal(role: string) {
  return Boolean(normalizeRole(role));
}

export function canCreateBrandOrTheme(role: string) {
  const canonical = normalizeRole(role);
  return canonical === "noisia_admin" || canonical === "analyst";
}

export function canManageCorpus(role: string) {
  const canonical = normalizeRole(role);
  return canonical === "noisia_admin" || canonical === "analyst";
}

export function canApproveAnalysis(role: string) {
  const canonical = normalizeRole(role);
  return canonical === "noisia_admin" || canonical === "analyst";
}

export function canViewClientOutputs(role: string) {
  return Boolean(normalizeRole(role));
}

export function defaultAuthenticatedPath(role: string) {
  return canAccessStudio(role) ? "/studio" : "/signal";
}

export function brandAccessLevelForRole(role: string) {
  const canonical = normalizeRole(role);
  if (canonical === "client_admin") return "comment";
  if (canonical === "client_viewer") return "read";
  if (canonical === "noisia_admin" || canonical === "analyst") return "admin";
  return "read";
}

export function displayRole(role: string) {
  const canonical = normalizeRole(role);
  return canonical ? roleLabels[canonical] : role;
}

function isBootstrapFounderEmail(email: string) {
  const configuredEmails = (process.env.NOISIA_BOOTSTRAP_FOUNDER_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const configuredDomains = (process.env.NOISIA_INTERNAL_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const normalized = email.toLowerCase();
  const domain = normalized.split("@")[1];

  return configuredEmails.includes(normalized) || (!!domain && configuredDomains.includes(domain));
}
