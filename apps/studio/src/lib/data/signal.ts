import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import {
  brands,
  methodologies,
  publishedOutputs,
  studyCorpora,
  tbAnalyses,
  userBrandAccess
} from "@noisia/db";
import { db } from "@/lib/db";

type AppUser = {
  id: string;
  userType: string;
  organizationId: string | null;
};

export async function listSignalOutputsForUser(appUser: AppUser) {
  const where = [eq(publishedOutputs.status, "published"), isNull(publishedOutputs.archivedAt)];

  if (appUser.userType !== "noisia_internal") {
    const accessRows = await db
      .select({ brandId: userBrandAccess.brandId })
      .from(userBrandAccess)
      .where(and(eq(userBrandAccess.userId, appUser.id), isNull(userBrandAccess.revokedAt)));
    const brandIds = accessRows.map((row) => row.brandId);

    if (brandIds.length === 0) return [];
    where.push(inArray(publishedOutputs.brandId, brandIds));
  }

  const rows = await db
    .select({
      id: publishedOutputs.id,
      studyCorpusId: publishedOutputs.studyCorpusId,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      outputType: publishedOutputs.outputType,
      status: publishedOutputs.status,
      manifest: publishedOutputs.manifest,
      publishedAt: publishedOutputs.publishedAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug
    })
    .from(publishedOutputs)
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
    .where(and(...where))
    .orderBy(desc(publishedOutputs.publishedAt), desc(publishedOutputs.updatedAt));

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.studyCorpusId}:${row.outputType}:${row.methodologySlug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getSignalOutputForUser(appUser: AppUser, outputId: string) {
  const where = [
    eq(publishedOutputs.id, outputId),
    eq(publishedOutputs.status, "published"),
    isNull(publishedOutputs.archivedAt)
  ];

  if (appUser.userType !== "noisia_internal") {
    where.push(isNotNull(userBrandAccess.id));
  }

  const [row] = await db
    .select({
      id: publishedOutputs.id,
      tbAnalysisId: publishedOutputs.tbAnalysisId,
      studyCorpusId: publishedOutputs.studyCorpusId,
      brandId: publishedOutputs.brandId,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      manifest: publishedOutputs.manifest,
      payload: publishedOutputs.payload,
      version: publishedOutputs.version,
      publishedAt: publishedOutputs.publishedAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug,
      analysisStatus: tbAnalyses.status
    })
    .from(publishedOutputs)
    .innerJoin(tbAnalyses, eq(tbAnalyses.id, publishedOutputs.tbAnalysisId))
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
    .leftJoin(
      userBrandAccess,
      and(
        eq(userBrandAccess.brandId, publishedOutputs.brandId),
        eq(userBrandAccess.userId, appUser.id),
        isNull(userBrandAccess.revokedAt)
      )
    )
    .where(and(...where))
    .limit(1);

  return row ?? null;
}

export async function getDraftSignalOutput(tbAnalysisId: string) {
  const [row] = await db
    .select()
    .from(publishedOutputs)
    .where(and(eq(publishedOutputs.tbAnalysisId, tbAnalysisId), eq(publishedOutputs.outputType, "narrative_dashboard")))
    .limit(1);

  return row ?? null;
}
