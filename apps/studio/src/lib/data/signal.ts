import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import {
  brands,
  engineAnalyses,
  methodologies,
  publishedOutputs,
  studyCorpora,
  tbAnalyses,
  themes,
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
    const accessClauses = [];

    if (brandIds.length > 0) {
      accessClauses.push(inArray(publishedOutputs.brandId, brandIds));
    }
    if (appUser.organizationId) {
      accessClauses.push(eq(themes.organizationId, appUser.organizationId));
    }

    if (accessClauses.length === 0) return [];
    where.push(or(...accessClauses)!);
  }

  const rows = await db
    .select({
      id: publishedOutputs.id,
      studyCorpusId: publishedOutputs.studyCorpusId,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      outputType: publishedOutputs.outputType,
      kind: publishedOutputs.kind,
      status: publishedOutputs.status,
      manifest: publishedOutputs.manifest,
      publishedAt: publishedOutputs.publishedAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      themeName: themes.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug
    })
    .from(publishedOutputs)
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
    .leftJoin(themes, eq(themes.id, publishedOutputs.themeId))
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
    where.push(
      appUser.organizationId
        ? or(isNotNull(userBrandAccess.id), eq(themes.organizationId, appUser.organizationId))!
        : isNotNull(userBrandAccess.id)
    );
  }

  try {
    return await selectSignalOutputForUserRow(appUser, where, {
      includeAnalysisPlan: true,
      includeEngineAnalysis: true
    });
  } catch (error) {
    if (
      !isMissingRelationError(error, "engine_analyses") &&
      !isMissingColumnError(error, "engine_analysis_id") &&
      !isMissingColumnError(error, "analysis_plan")
    ) {
      throw error;
    }
    return await selectSignalOutputForUserRow(appUser, where, {
      includeAnalysisPlan: false,
      includeEngineAnalysis: false
    });
  }
}

async function selectSignalOutputForUserRow(
  appUser: AppUser,
  where: SQL[],
  options: {
    includeAnalysisPlan: boolean;
    includeEngineAnalysis: boolean;
  }
) {
  const statusExpression = options.includeEngineAnalysis
    ? sql<string | null>`COALESCE(${tbAnalyses.status}, ${engineAnalyses.status})`
    : sql<string | null>`${tbAnalyses.status}`;

  let query = db
    .select({
      id: publishedOutputs.id,
      tbAnalysisId: publishedOutputs.tbAnalysisId,
      engineAnalysisId: options.includeEngineAnalysis
        ? publishedOutputs.engineAnalysisId
        : sql<string | null>`NULL`,
      studyCorpusId: publishedOutputs.studyCorpusId,
      baseCorpusId: studyCorpora.baseCorpusId,
      analysisPlan: options.includeAnalysisPlan
        ? studyCorpora.analysisPlan
        : sql<Record<string, unknown> | null>`NULL`,
      brandId: publishedOutputs.brandId,
      themeId: publishedOutputs.themeId,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      manifest: publishedOutputs.manifest,
      payload: publishedOutputs.payload,
      visibilityConfig: publishedOutputs.visibilityConfig,
      kind: publishedOutputs.kind,
      version: publishedOutputs.version,
      publishedAt: publishedOutputs.publishedAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      themeName: themes.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug,
      analysisStatus: statusExpression
    })
    .from(publishedOutputs)
    .leftJoin(tbAnalyses, eq(tbAnalyses.id, publishedOutputs.tbAnalysisId))
    .$dynamic();

  if (options.includeEngineAnalysis) {
    query = query.leftJoin(engineAnalyses, eq(engineAnalyses.id, publishedOutputs.engineAnalysisId));
  }

  const [row] = await query
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
    .leftJoin(themes, eq(themes.id, publishedOutputs.themeId))
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

function isMissingRelationError(error: unknown, relationName: string) {
  const cause = error && typeof error === "object" && "cause" in error
    ? (error as { cause?: unknown }).cause
    : error;
  if (!cause || typeof cause !== "object") return false;
  const code = "code" in cause ? (cause as { code?: unknown }).code : null;
  const message = "message" in cause ? String((cause as { message?: unknown }).message) : "";
  return code === "42P01" && message.includes(`"${relationName}"`);
}

function isMissingColumnError(error: unknown, columnName: string) {
  const cause = error && typeof error === "object" && "cause" in error
    ? (error as { cause?: unknown }).cause
    : error;
  if (!cause || typeof cause !== "object") return false;
  const code = "code" in cause ? (cause as { code?: unknown }).code : null;
  const message = "message" in cause ? String((cause as { message?: unknown }).message) : "";
  return code === "42703" && message.includes(`.${columnName}`);
}

export async function getDraftSignalOutput(tbAnalysisId: string) {
  const [row] = await db
    .select()
    .from(publishedOutputs)
    .where(and(eq(publishedOutputs.tbAnalysisId, tbAnalysisId), eq(publishedOutputs.outputType, "narrative_dashboard")))
    .limit(1);

  return row ?? null;
}
