import { canManageTeam, normalizeRole } from "@/lib/auth/roles";

export type AdminNavigationKey =
  | "dashboard"
  | "brands"
  | "data"
  | "reports"
  | "team"
  | "settings"
  | "corpora"
  | "themes";

export type AdminNavigationItem = {
  href: string;
  key: AdminNavigationKey;
  section?: "advanced";
};

export type BrandContextNavigationKey =
  | "overview"
  | "data"
  | "data-mentions"
  | "data-review"
  | "brand-os"
  | "reports"
  | "settings";

export type BrandContextNavigationItem = {
  depth?: 1;
  href: string;
  key: BrandContextNavigationKey;
};

export type CorpusContextNavigationKey = "engine" | "mentions" | "review";

export type CorpusContextNavigationItem = {
  href: string;
  key: CorpusContextNavigationKey;
};

export function buildAdminNavigation(role: string): AdminNavigationItem[] {
  if (!normalizeRole(role)) return [];
  return [
    { key: "dashboard", href: "/studio" },
    { key: "brands", href: "/studio/brands" },
    { key: "data", href: "/studio/data" },
    { key: "reports", href: "/studio/reports" },
    ...(canManageTeam(role) ? [{ key: "team" as const, href: "/studio/team" }] : []),
    { key: "settings", href: "/studio/settings" },
    { key: "corpora", href: "/studio/corpora/new", section: "advanced" },
    { key: "themes", href: "/studio/themes", section: "advanced" }
  ];
}

export function buildCorpusContextNavigation(corpusId: string): CorpusContextNavigationItem[] {
  const base = `/studio/corpora/${encodeURIComponent(corpusId)}`;
  return [
    { key: "engine", href: `${base}/engine` },
    { key: "mentions", href: `${base}/mentions` },
    { key: "review", href: `${base}/analysis` }
  ];
}

export function buildBrandContextNavigation(brandId: string): BrandContextNavigationItem[] {
  const base = `/studio/brands/${encodeURIComponent(brandId)}`;
  return [
    { key: "overview", href: base },
    { key: "data", href: `${base}/data` },
    { key: "data-mentions", href: `${base}/data/mentions`, depth: 1 },
    { key: "data-review", href: `${base}/data/review`, depth: 1 },
    { key: "brand-os", href: `${base}/brand-os` },
    { key: "reports", href: `${base}/reports` },
    { key: "settings", href: `${base}/settings` }
  ];
}

export function brandIdFromStudioPath(pathname: string) {
  const match = pathname.match(/^\/studio\/brands\/([^/]+)(?:\/|$)/u);
  if (!match || match[1] === "new") return null;
  return decodeURIComponent(match[1]!);
}

export function corpusIdFromStudioPath(pathname: string) {
  const match = pathname.match(/^\/studio\/corpora\/([^/]+)(?:\/|$)/u);
  if (!match || match[1] === "new") return null;
  return decodeURIComponent(match[1]!);
}
