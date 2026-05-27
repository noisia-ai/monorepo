import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  brandKnowledgeSources,
  brands,
  brandSeeds,
  competitors,
  mentions,
  organizations,
  studyCorpora,
  userBrandAccess
} from "@noisia/db";
import { listCorporaForBrand } from "@/lib/data/corpora";
import { db } from "@/lib/db";

type AppUser = {
  id: string;
  userType: string;
  organizationId: string | null;
};

export type BrandFilters = {
  organization?: string;
  industry?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function listBrandsForUser(appUser: AppUser, filters: BrandFilters = {}) {
  const baseSelect = {
    id: brands.id,
    slug: brands.slug,
    name: brands.name,
    displayName: brands.displayName,
    industry: brands.industry,
    industrySub: brands.industrySub,
    countries: brands.countries,
    description: brands.description,
    brandSeedHandles: brands.brandSeedHandles,
    status: brands.status,
    organizationId: brands.organizationId,
    organizationSlug: organizations.slug,
    organizationName: organizations.displayName,
    createdAt: brands.createdAt
  };

  const rows =
    appUser.userType === "noisia_internal"
      ? await db.select(baseSelect).from(brands).innerJoin(organizations, eq(organizations.id, brands.organizationId))
      : await db
          .select(baseSelect)
          .from(userBrandAccess)
          .innerJoin(brands, eq(brands.id, userBrandAccess.brandId))
          .innerJoin(organizations, eq(organizations.id, brands.organizationId))
          .where(and(eq(userBrandAccess.userId, appUser.id), isNull(userBrandAccess.revokedAt)));

  // TODO mejora-futura: mover filtros/paginacion a SQL cuando la lista pase
  // de cientos de marcas. En MVP favorecemos claridad y filtros flexibles.
  const filtered = rows.filter((row) => {
    const organizationMatch =
      !filters.organization ||
      row.organizationId === filters.organization ||
      row.organizationSlug === filters.organization;
    const industryMatch = !filters.industry || row.industry === filters.industry;
    const statusMatch = !filters.status || row.status === filters.status;

    return organizationMatch && industryMatch && statusMatch;
  });

  const page = paginate(filtered, filters.page, filters.pageSize);

  // Enrich each brand with corpus stats so the list card can show counts
  if (page.data.length > 0) {
    const brandIds = page.data.map((b) => b.id);
    const statsRows = await db
      .select({
        brandId: studyCorpora.brandId,
        total: sql<number>`count(*)::int`,
        approved: sql<number>`sum(case when ${studyCorpora.status}='corpus_approved' then 1 else 0 end)::int`
      })
      .from(studyCorpora)
      .where(inArray(studyCorpora.brandId, brandIds))
      .groupBy(studyCorpora.brandId);

    const statsByBrand = new Map(statsRows.map((r) => [r.brandId, r]));
    const enriched = page.data.map((b) => ({
      ...b,
      corporaCount: statsByBrand.get(b.id)?.total ?? 0,
      corporaApproved: statsByBrand.get(b.id)?.approved ?? 0
    }));
    return { ...page, data: enriched };
  }

  return { ...page, data: page.data.map((b) => ({ ...b, corporaCount: 0, corporaApproved: 0 })) };
}

/** Aggregate stats for the /studio home dashboard. */
export async function getStudioDashboard(appUser: AppUser) {
  const brandsList = await listBrandsForUser(appUser, { pageSize: 500 });
  const brandIds = brandsList.data.map((b) => b.id);

  // If no brands visible, dashboard shows zeros — short-circuit to avoid
  // an empty IN () clause and an extra round-trip.
  if (brandIds.length === 0) {
    return {
      brands_count: 0,
      corpora_total: 0,
      corpora_approved: 0,
      mentions_total: 0,
      recent_corpora: [] as Array<{
        id: string;
        name: string;
        brandName: string;
        methodologyName: string;
        status: string;
        included: number;
        updatedAt: Date;
      }>
    };
  }

  const [aggregate] = await db
    .select({
      total: sql<number>`count(*)::int`,
      approved: sql<number>`sum(case when ${studyCorpora.status}='corpus_approved' then 1 else 0 end)::int`
    })
    .from(studyCorpora)
    .where(inArray(studyCorpora.brandId, brandIds));

  const [mentionsAgg] = await db
    .select({
      total: sql<number>`count(*)::int`
    })
    .from(mentions)
    .innerJoin(studyCorpora, eq(studyCorpora.id, mentions.studyCorpusId))
    .where(inArray(studyCorpora.brandId, brandIds));

  const recentRows = await db.execute(sql`
    SELECT sc.id, sc.name, b.display_name AS brand_name, m.name AS methodology_name,
           sc.status, sc.updated_at,
           COALESCE((SELECT COUNT(*) FROM mentions
                     WHERE study_corpus_id = sc.id AND inclusion_status='included'), 0)::int AS included
    FROM study_corpora sc
    JOIN brands b ON b.id = sc.brand_id
    JOIN methodologies m ON m.id = sc.methodology_id
    WHERE sc.brand_id IN ${brandIds.length > 0 ? sql.raw(`('${brandIds.join("','")}')`) : sql`(NULL)`}
    ORDER BY sc.updated_at DESC
    LIMIT 5
  `);

  const recent = ((recentRows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    brandName: String(r.brand_name ?? ""),
    methodologyName: String(r.methodology_name ?? ""),
    status: String(r.status ?? ""),
    included: Number(r.included ?? 0),
    updatedAt: new Date(String(r.updated_at))
  }));

  return {
    brands_count: brandsList.data.length,
    corpora_total: aggregate?.total ?? 0,
    corpora_approved: aggregate?.approved ?? 0,
    mentions_total: mentionsAgg?.total ?? 0,
    recent_corpora: recent
  };
}

export async function getBrandDetailForUser(appUser: AppUser, brandId: string) {
  const list = await listBrandsForUser(appUser, { pageSize: 500 });
  const brand = list.data.find((row) => row.id === brandId || row.slug === brandId);

  if (!brand) {
    return null;
  }

  const competitorRows = await db
    .select({
      id: competitors.id,
      priority: competitors.priority,
      notes: competitors.notes,
      canonicalName: brandSeeds.canonicalName,
      vertical: brandSeeds.vertical,
      subVertical: brandSeeds.subVertical
    })
    .from(competitors)
    .innerJoin(brandSeeds, eq(brandSeeds.id, competitors.competitorBrandSeedId))
    .where(eq(competitors.brandId, brand.id));
  const knowledgeRows = await db
    .select({
      id: brandKnowledgeSources.id,
      sourceKind: brandKnowledgeSources.sourceKind,
      title: brandKnowledgeSources.title,
      rawText: brandKnowledgeSources.rawText,
      extractedPayload: brandKnowledgeSources.extractedPayload,
      status: brandKnowledgeSources.status,
      createdAt: brandKnowledgeSources.createdAt,
      updatedAt: brandKnowledgeSources.updatedAt
    })
    .from(brandKnowledgeSources)
    .where(eq(brandKnowledgeSources.brandId, brand.id))
    .orderBy(desc(brandKnowledgeSources.createdAt));
  const corpora = await listCorporaForBrand(brand.id);

  return { ...brand, competitors: competitorRows, knowledgeSources: knowledgeRows, corpora };
}

function paginate<T>(rows: T[], page = 1, pageSize = 50) {
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 50;
  const start = (safePage - 1) * safePageSize;

  return {
    data: rows.slice(start, start + safePageSize),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total: rows.length
    }
  };
}
