import { desc, eq } from "drizzle-orm";

import { methodologies, organizations, studyCorpora, themes } from "@noisia/db";
import { db } from "@/lib/db";

type AppUser = {
  userType: string;
  organizationId: string | null;
};

export type ThemeFilters = {
  organization?: string;
  industry?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function listThemesForUser(appUser: AppUser, filters: ThemeFilters = {}) {
  const rows = await db
    .select({
      id: themes.id,
      slug: themes.slug,
      name: themes.name,
      description: themes.description,
      industryFocus: themes.industryFocus,
      geoFocus: themes.geoFocus,
      status: themes.status,
      isPublic: themes.isPublic,
      organizationId: themes.organizationId,
      organizationSlug: organizations.slug,
      organizationName: organizations.displayName,
      createdAt: themes.createdAt
    })
    .from(themes)
    .leftJoin(organizations, eq(organizations.id, themes.organizationId));

  const visible = rows.filter((row) => {
    if (appUser.userType === "noisia_internal") {
      return true;
    }

    return row.isPublic || (!!appUser.organizationId && row.organizationId === appUser.organizationId);
  });

  // TODO mejora-futura: mover filtros/paginacion a SQL cuando themes deje de
  // ser catalogo chico y empiece a mezclar estudios publicos y cliente.
  const filtered = visible.filter((row) => {
    const organizationMatch =
      !filters.organization ||
      row.organizationId === filters.organization ||
      row.organizationSlug === filters.organization ||
      (filters.organization === "internal" && !row.organizationId);
    const industryMatch = !filters.industry || row.industryFocus?.includes(filters.industry);
    const statusMatch = !filters.status || row.status === filters.status;

    return organizationMatch && industryMatch && statusMatch;
  });

  const safePage = filters.page && filters.page > 0 ? filters.page : 1;
  const safePageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 50;
  const start = (safePage - 1) * safePageSize;

  return {
    data: filtered.slice(start, start + safePageSize),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total: filtered.length
    }
  };
}

export async function getThemeDetailForUser(appUser: AppUser, themeIdOrSlug: string) {
  const list = await listThemesForUser(appUser, { pageSize: 500 });
  const theme = list.data.find((row) => row.id === themeIdOrSlug || row.slug === themeIdOrSlug);
  if (!theme) return null;

  const corpora = await db
    .select({
      id: studyCorpora.id,
      name: studyCorpora.name,
      status: studyCorpora.status,
      businessQuestion: studyCorpora.businessQuestion,
      targetWindowMonths: studyCorpora.targetWindowMonths,
      methodologyName: methodologies.name,
      updatedAt: studyCorpora.updatedAt
    })
    .from(studyCorpora)
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .where(eq(studyCorpora.themeId, theme.id))
    .orderBy(desc(studyCorpora.updatedAt));

  return { ...theme, corpora };
}
