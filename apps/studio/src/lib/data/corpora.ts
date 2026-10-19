import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";

import {
  brands,
  brandKnowledgeSources,
  cleanupActions,
  corpusEntities,
  corpusSnapshots,
  importBatches,
  mentions,
  methodologies,
  queryIterations,
  queryPacks,
  queryValidationAttempts,
  queryValidationRuns,
  organizations,
  studyCorpora,
  tbAnalyses,
  tbFindings,
  tbPipelineSteps,
  tbQualityGates,
  tbRecommendations,
  themes,
  userBrandAccess
} from "@noisia/db";
import {
  QUERY_PACK_EVALUATOR_PIPELINE_VERSION,
  QUERY_PACK_IMPORTED_SAMPLE_SIZE,
  QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE
} from "@noisia/query-engine";
import {
  collectIndustryTags,
  isGloballyReusableBaselineCandidate,
  type BaselineCorpusOption
} from "@/lib/baseline-corpus";
import { db, pool } from "@/lib/db";
import { queryPackHasDirectCsv } from "@/lib/engine/query-pack-readiness";
import { normalizeStudyAnalysisPlan } from "@/lib/multimethod/analysis-plan";

type AppUser = {
  id: string;
  userType: string;
  organizationId: string | null;
};

export type MentionFilters = {
  inclusionStatus?: string;
  platform?: string;
  sentiment?: string;
  dateFrom?: string;
  dateTo?: string;
  cleanupKind?: string;
  exclusionReason?: string;
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

export type TbAnalysisState = Awaited<ReturnType<typeof getTbAnalysisForCorpus>>;

export type CorpusEntityWithStats = Awaited<ReturnType<typeof listCorpusEntitiesForCorpus>>[number];

export async function getCorpusForUser(appUser: AppUser, corpusId: string) {
  const [corpus] = await db
    .select({
      id: studyCorpora.id,
      name: studyCorpora.name,
      brandId: studyCorpora.brandId,
      themeId: studyCorpora.themeId,
      baseCorpusId: studyCorpora.baseCorpusId,
      status: studyCorpora.status,
      businessQuestion: studyCorpora.businessQuestion,
      decisionToInform: studyCorpora.decisionToInform,
      targetWindowMonths: studyCorpora.targetWindowMonths,
      methodologyId: studyCorpora.methodologyId,
      analysisPlan: studyCorpora.analysisPlan,
      methodologySlug: methodologies.slug,
      methodologyName: methodologies.name,
      brandSlug: brands.slug,
      brandName: brands.name,
      themeSlug: themes.slug,
      themeName: themes.name,
      baseCorpusName: sql<string | null>`(
        select name
        from study_corpora base_corpus
        where base_corpus.id = ${studyCorpora.baseCorpusId}
        limit 1
      )`,
      baseCorpusThemeName: sql<string | null>`(
        select t_base.name
        from study_corpora base_corpus
        join themes t_base on t_base.id = base_corpus.theme_id
        where base_corpus.id = ${studyCorpora.baseCorpusId}
        limit 1
      )`,
      organizationId: sql<string | null>`coalesce(${brands.organizationId}, ${themes.organizationId})`,
      organizationSlug: sql<string | null>`(
        select ${organizations.slug}
        from ${organizations}
        where ${organizations.id} = coalesce(${brands.organizationId}, ${themes.organizationId})
        limit 1
      )`,
      organizationName: sql<string | null>`(
        select ${organizations.displayName}
        from ${organizations}
        where ${organizations.id} = coalesce(${brands.organizationId}, ${themes.organizationId})
        limit 1
      )`
    })
    .from(studyCorpora)
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, studyCorpora.brandId))
    .leftJoin(themes, eq(themes.id, studyCorpora.themeId))
    .where(eq(studyCorpora.id, corpusId))
    .limit(1);

  if (!corpus) {
    return null;
  }

  if (appUser.userType === "noisia_internal") {
    return corpus;
  }

  if (corpus.brandId) {
    const [access] = await db
      .select({ id: userBrandAccess.id })
      .from(userBrandAccess)
      .where(
        and(
          eq(userBrandAccess.userId, appUser.id),
          eq(userBrandAccess.brandId, corpus.brandId),
          isNull(userBrandAccess.revokedAt)
        )
      )
      .limit(1);

    return access ? corpus : null;
  }

  if (corpus.themeId) {
    const themeVisibility = appUser.organizationId
      ? or(eq(themes.isPublic, true), eq(themes.organizationId, appUser.organizationId))
      : eq(themes.isPublic, true);

    const [themeAccess] = await db
      .select({ id: themes.id })
      .from(themes)
      .where(and(eq(themes.id, corpus.themeId), themeVisibility))
      .limit(1);

    return themeAccess ? corpus : null;
  }

  return null;
}

export async function listCorporaForBrand(brandId: string) {
  return db
    .select({
      id: studyCorpora.id,
      name: studyCorpora.name,
      status: studyCorpora.status,
      businessQuestion: studyCorpora.businessQuestion,
      targetWindowMonths: studyCorpora.targetWindowMonths,
      methodologySlug: methodologies.slug,
      methodologyName: methodologies.name,
      updatedAt: studyCorpora.updatedAt
    })
    .from(studyCorpora)
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .where(and(eq(studyCorpora.brandId, brandId), ne(studyCorpora.status, "archived")))
    .orderBy(desc(studyCorpora.updatedAt));
}

export async function listActiveMethodologies() {
  return db
    .select({
      id: methodologies.id,
      slug: methodologies.slug,
      name: methodologies.name,
      version: methodologies.version,
      status: methodologies.status
    })
    .from(methodologies)
    .where(or(eq(methodologies.status, "active"), and(eq(methodologies.slug, "signal-pulse"), eq(methodologies.status, "beta"))))
    .orderBy(asc(methodologies.name), desc(methodologies.version));
}

export async function listReusableBaselineCorporaForUser(appUser: AppUser): Promise<BaselineCorpusOption[]> {
  const rows = await db
    .select({
      id: studyCorpora.id,
      name: studyCorpora.name,
      status: studyCorpora.status,
      brandId: studyCorpora.brandId,
      brandName: brands.name,
      brandDisplayName: brands.displayName,
      brandIndustry: brands.industry,
      brandIndustrySub: brands.industrySub,
      brandCountries: brands.countries,
      themeId: studyCorpora.themeId,
      themeName: themes.name,
      themeSlug: themes.slug,
      themeIndustryFocus: themes.industryFocus,
      themeGeoFocus: themes.geoFocus,
      organizationId: sql<string | null>`coalesce(${brands.organizationId}, ${themes.organizationId})`,
      isPublic: themes.isPublic,
      methodologyId: methodologies.id,
      methodologySlug: methodologies.slug,
      methodologyName: methodologies.name,
      methodologyVersion: methodologies.version,
      geoFocus: studyCorpora.geoFocus,
      targetWindowMonths: studyCorpora.targetWindowMonths,
      corpusFirstApprovedAt: studyCorpora.corpusFirstApprovedAt,
      includedCount: sql<number>`coalesce((
        select count(*)::int
        from ${mentions}
        where ${mentions.studyCorpusId} = ${studyCorpora.id}
          and ${mentions.inclusionStatus} = 'included'
      ), 0)`,
      updatedAt: studyCorpora.updatedAt
    })
    .from(studyCorpora)
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, studyCorpora.brandId))
    .leftJoin(themes, eq(themes.id, studyCorpora.themeId))
    .where(ne(studyCorpora.status, "archived"))
    .orderBy(desc(studyCorpora.updatedAt));

  const accessibleBrandIds = appUser.userType === "noisia_internal"
    ? null
    : new Set(
        (
          await db
            .select({ brandId: userBrandAccess.brandId })
            .from(userBrandAccess)
            .where(and(eq(userBrandAccess.userId, appUser.id), isNull(userBrandAccess.revokedAt)))
        ).map((row) => row.brandId)
      );

  return rows
    .filter((row) => {
      if (appUser.userType === "noisia_internal") return true;
      if (row.brandId) return accessibleBrandIds?.has(row.brandId) ?? false;
      return Boolean(row.isPublic || (!!appUser.organizationId && row.organizationId === appUser.organizationId));
    })
    .map((row) => {
      const candidate: BaselineCorpusOption = {
        id: row.id,
        name: row.name,
        status: row.status,
        candidateType: row.brandId ? "brand_reuse" : "industry_baseline",
        subjectLabel: row.brandId ? row.brandDisplayName ?? row.brandName : row.themeName,
        brandId: row.brandId,
        brandName: row.brandDisplayName ?? row.brandName,
        themeId: row.themeId,
        themeName: row.themeName,
        themeSlug: row.themeSlug,
        methodologyId: row.methodologyId,
        methodologySlug: row.methodologySlug,
        methodologyName: row.methodologyName,
        methodologyVersion: row.methodologyVersion,
        industryTags: row.brandId
          ? collectIndustryTags(row.brandIndustry, row.brandIndustrySub)
          : collectIndustryTags(row.themeIndustryFocus),
        geoFocus: normalizeCountryList(row.geoFocus ?? row.themeGeoFocus ?? row.brandCountries),
        includedCount: row.includedCount,
        targetWindowMonths: row.targetWindowMonths ?? null,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        corpusFirstApprovedAt: row.corpusFirstApprovedAt?.toISOString() ?? null
      };
      return candidate;
    })
    .filter(isGloballyReusableBaselineCandidate);
}

export async function listReusableIndustryCorporaForUser(appUser: AppUser) {
  return listReusableBaselineCorporaForUser(appUser);
}

function normalizeCountryList(value: string[] | null | undefined) {
  return Array.from(new Set((value ?? []).map((item) => item.toUpperCase()).filter(Boolean)));
}

export async function listImportBatchesForCorpus(corpusId: string) {
  return db
    .select({
      id: importBatches.id,
      sourceSystem: importBatches.sourceSystem,
      sourceFileName: importBatches.sourceFileName,
      queryPackId: importBatches.queryPackId,
      mentionType: importBatches.mentionType,
      competitorId: importBatches.competitorId,
      corpusEntityId: importBatches.corpusEntityId,
      entityKind: importBatches.entityKind,
      entityLabel: importBatches.entityLabel,
      recordCount: importBatches.recordCount,
      includedCount: importBatches.includedCount,
      excludedCount: importBatches.excludedCount,
      duplicateCount: importBatches.duplicateCount,
      status: importBatches.status,
      createdAt: importBatches.createdAt
    })
    .from(importBatches)
    .where(eq(importBatches.studyCorpusId, corpusId))
    .orderBy(desc(importBatches.createdAt));
}

export async function listCorpusEntitiesForCorpus(corpusId: string) {
  return db
    .select({
      id: corpusEntities.id,
      studyCorpusId: corpusEntities.studyCorpusId,
      competitorId: corpusEntities.competitorId,
      entityKind: corpusEntities.entityKind,
      name: corpusEntities.name,
      aliases: corpusEntities.aliases,
      handles: corpusEntities.handles,
      querySeeds: corpusEntities.querySeeds,
      notes: corpusEntities.notes,
      isCategoryBaseline: corpusEntities.isCategoryBaseline,
      priority: corpusEntities.priority,
      status: corpusEntities.status,
      createdAt: corpusEntities.createdAt,
      updatedAt: corpusEntities.updatedAt,
      batchCount: sql<number>`coalesce((
        select count(*)::int
        from ${importBatches}
        where ${importBatches.corpusEntityId} = ${corpusEntities.id}
      ), 0)`,
      includedCount: sql<number>`coalesce((
        select sum(${importBatches.includedCount})::int
        from ${importBatches}
        where ${importBatches.corpusEntityId} = ${corpusEntities.id}
          and ${importBatches.status} = 'completed'
      ), 0)`,
      latestBatchAt: sql<Date | null>`(
        select max(${importBatches.createdAt})
        from ${importBatches}
        where ${importBatches.corpusEntityId} = ${corpusEntities.id}
      )`
    })
    .from(corpusEntities)
    .where(eq(corpusEntities.studyCorpusId, corpusId))
    .orderBy(asc(corpusEntities.priority), asc(corpusEntities.name));
}

export async function listMentionsForCorpus(corpusId: string, filters: MentionFilters = {}) {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 50;
  const offset = (page - 1) * pageSize;
  const dateFrom = parseDateBoundary(filters.dateFrom, "start");
  const dateTo = parseDateBoundary(filters.dateTo, "end");
  const where = [
    eq(mentions.studyCorpusId, corpusId),
    filters.inclusionStatus ? eq(mentions.inclusionStatus, filters.inclusionStatus) : undefined,
    filters.platform ? eq(mentions.platform, filters.platform) : undefined,
    filters.sentiment ? eq(mentions.sentimentSource, filters.sentiment) : undefined,
    dateFrom ? gte(mentions.publishedAt, dateFrom) : undefined,
    dateTo ? lte(mentions.publishedAt, dateTo) : undefined,
    filters.cleanupKind ? eq(cleanupActions.kind, filters.cleanupKind) : undefined,
    filters.exclusionReason === "any"
      ? isNotNull(mentions.exclusionReason)
      : filters.exclusionReason
        ? ilike(mentions.exclusionReason, `%${filters.exclusionReason}%`)
        : undefined,
    filters.search
      ? or(
          ilike(mentions.textClean, `%${filters.search}%`),
          ilike(mentions.textSnippet, `%${filters.search}%`),
          ilike(mentions.exclusionReason, `%${filters.search}%`)
        )
      : undefined
  ].filter(Boolean);

  const whereSql = and(...where);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mentions)
    .leftJoin(cleanupActions, eq(cleanupActions.id, mentions.cleanupActionId))
    .where(whereSql);

  const rows = await db
    .select({
      id: mentions.id,
      textSnippet: mentions.textSnippet,
      textClean: mentions.textClean,
      publishedAt: mentions.publishedAt,
      platform: mentions.platform,
      url: mentions.url,
      sentimentSource: mentions.sentimentSource,
      sentimentScore: mentions.sentimentScore,
      inclusionStatus: mentions.inclusionStatus,
      exclusionReason: mentions.exclusionReason,
      cleanupActionKind: cleanupActions.kind,
      engagement: mentions.engagement,
      rawMetadata: mentions.rawMetadata
    })
    .from(mentions)
    .leftJoin(cleanupActions, eq(cleanupActions.id, mentions.cleanupActionId))
    .where(whereSql)
    .orderBy(...mentionOrder(filters.sort))
    .limit(pageSize)
    .offset(offset);

  return {
    data: rows,
    pagination: {
      page,
      pageSize,
      total: countRow?.count ?? 0
    }
  };
}

function mentionOrder(sort?: string) {
  if (sort === "oldest") return [asc(mentions.publishedAt)];
  if (sort === "longest") return [desc(mentions.textLength), desc(mentions.publishedAt)];
  if (sort === "shortest") return [asc(mentions.textLength), desc(mentions.publishedAt)];
  if (sort === "pending_first") {
    return [
      asc(sql`case when ${mentions.inclusionStatus} = 'pending' then 0 else 1 end`),
      desc(mentions.publishedAt)
    ];
  }
  return [desc(mentions.publishedAt)];
}

export async function getMentionFacetsForCorpus(corpusId: string) {
  const [platforms, sentiments, cleanupKinds, exclusionReasons, dateRange] = await Promise.all([
    db
      .select({
        value: mentions.platform,
        count: sql<number>`count(*)::int`
      })
      .from(mentions)
      .where(eq(mentions.studyCorpusId, corpusId))
      .groupBy(mentions.platform)
      .orderBy(desc(sql`count(*)`))
      .limit(16),
    db
      .select({
        value: mentions.sentimentSource,
        count: sql<number>`count(*)::int`
      })
      .from(mentions)
      .where(and(eq(mentions.studyCorpusId, corpusId), isNotNull(mentions.sentimentSource)))
      .groupBy(mentions.sentimentSource)
      .orderBy(desc(sql`count(*)`))
      .limit(12),
    db
      .select({
        value: cleanupActions.kind,
        count: sql<number>`count(*)::int`
      })
      .from(mentions)
      .innerJoin(cleanupActions, eq(cleanupActions.id, mentions.cleanupActionId))
      .where(eq(mentions.studyCorpusId, corpusId))
      .groupBy(cleanupActions.kind)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
    db
      .select({
        value: mentions.exclusionReason,
        count: sql<number>`count(*)::int`
      })
      .from(mentions)
      .where(and(eq(mentions.studyCorpusId, corpusId), isNotNull(mentions.exclusionReason)))
      .groupBy(mentions.exclusionReason)
      .orderBy(desc(sql`count(*)`))
      .limit(12),
    db
      .select({
        min: sql<Date | null>`min(${mentions.publishedAt})`,
        max: sql<Date | null>`max(${mentions.publishedAt})`
      })
      .from(mentions)
      // TODO mejora-futura: reemplazar este umbral por una columna explicita de fecha valida en ingest.
      .where(and(eq(mentions.studyCorpusId, corpusId), gte(mentions.publishedAt, new Date("2000-01-01T00:00:00.000Z"))))
  ]);

  // TODO mejora-futura: estas facets se calculan en vivo; si el corpus crece a
  // cientos de miles de menciones conviene materializarlas por corpus.
  return {
    platforms,
    sentiments: sentiments.filter((item) => item.value && item.value !== "\""),
    cleanupKinds,
    exclusionReasons,
    dateRange: dateRange[0] ?? { min: null, max: null }
  };
}

export async function listQueryIterationsForCorpus(corpusId: string) {
  return db
    .select({
      id: queryIterations.id,
      iterationNumber: queryIterations.iterationNumber,
      queryText: queryIterations.queryText,
      competitorQueryText: queryIterations.competitorQueryText,
      industryQueryText: queryIterations.industryQueryText,
      queryComponents: queryIterations.queryComponents,
      mentionsReturned: queryIterations.mentionsReturned,
      qualityScore: queryIterations.qualityScore,
      densityScore: queryIterations.densityScore,
      noiseScore: queryIterations.noiseScore,
      aiEvaluationNotes: queryIterations.aiEvaluationNotes,
      insightsManagerDecision: queryIterations.insightsManagerDecision,
      latestQueryValidationRunId: queryIterations.latestQueryValidationRunId,
      approvedQueryValidationRunId: queryIterations.approvedQueryValidationRunId,
      pipelineVersion: queryIterations.pipelineVersion,
      createdAt: queryIterations.createdAt
    })
    .from(queryIterations)
    .where(eq(queryIterations.studyCorpusId, corpusId))
    .orderBy(desc(queryIterations.createdAt));
}

export async function getTbAnalysisForCorpus(
  corpusId: string,
  analysisId?: string,
  options: { includeAggregates?: boolean } = {}
) {
  const where = [
    eq(tbAnalyses.studyCorpusId, corpusId),
    analysisId ? eq(tbAnalyses.id, analysisId) : undefined
  ].filter(Boolean);

  const [analysis] = await db
    .select({
      id: tbAnalyses.id,
      status: tbAnalyses.status,
      currentStep: tbAnalyses.currentStep,
      businessQuestion: tbAnalyses.businessQuestion,
      decisionToInform: tbAnalyses.decisionToInform,
      metaJson: tbAnalyses.metaJson,
      activationPlaybook: tbAnalyses.activationPlaybook,
      frictionRemovalPlan: tbAnalyses.frictionRemovalPlan,
      comparativeBrief: tbAnalyses.comparativeBrief,
      limitations: tbAnalyses.limitations,
      confidencePerFinding: tbAnalyses.confidencePerFinding,
      failureReason: tbAnalyses.failureReason,
      snapshotId: tbAnalyses.snapshotId,
      createdAt: tbAnalyses.createdAt,
      updatedAt: tbAnalyses.updatedAt,
      executedAt: tbAnalyses.executedAt,
      imApprovedAt: tbAnalyses.imApprovedAt,
      kamApprovedAt: tbAnalyses.kamApprovedAt
    })
    .from(tbAnalyses)
    .where(and(...where))
    .orderBy(desc(tbAnalyses.createdAt))
    .limit(1);

  if (!analysis) return null;
  const persistedIntelligence = await loadPersistedIntelligence(analysis.id);
  const analysisWithPersistedIntelligence = {
    ...analysis,
    metaJson: mergePersistedIntelligence(analysis.metaJson, persistedIntelligence)
  };

  const [steps, recommendations, gates, findingSummary, knowledgeSources] = await Promise.all([
    db
      .select({
        id: tbPipelineSteps.id,
        step: tbPipelineSteps.step,
        status: tbPipelineSteps.status,
        durationMs: tbPipelineSteps.durationMs,
        errorMessage: tbPipelineSteps.errorMessage,
        resultSummary: tbPipelineSteps.resultSummary,
        createdAt: tbPipelineSteps.createdAt,
        startedAt: tbPipelineSteps.startedAt,
        completedAt: tbPipelineSteps.completedAt
      })
      .from(tbPipelineSteps)
      .where(eq(tbPipelineSteps.tbAnalysisId, analysis.id))
      .orderBy(asc(tbPipelineSteps.createdAt)),
    db
      .select({
        id: tbRecommendations.id,
        kind: tbRecommendations.kind,
        position: tbRecommendations.position,
        medioRecomendado: tbRecommendations.medioRecomendado,
        tonoRecomendado: tbRecommendations.tonoRecomendado,
        riesgoSaturacion: tbRecommendations.riesgoSaturacion,
        categoriaDondeAplica: tbRecommendations.categoriaDondeAplica,
        intervencionSugerida: tbRecommendations.intervencionSugerida,
        tipoIntervencion: tbRecommendations.tipoIntervencion,
        inversionEstimada: tbRecommendations.inversionEstimada,
        indicadorExito: tbRecommendations.indicadorExito,
        responsableSugerido: tbRecommendations.responsableSugerido,
        razonEstructural: tbRecommendations.razonEstructural,
        recomendacion: tbRecommendations.recomendacion,
        findingHumanId: tbFindings.findingId,
        findingName: tbFindings.nombreComercial,
        polarity: tbFindings.polarity,
        layer: tbFindings.layer,
        confidence: tbFindings.confidence,
        movilidad: tbFindings.movilidad
      })
      .from(tbRecommendations)
      .leftJoin(tbFindings, eq(tbFindings.id, tbRecommendations.findingId))
      .where(eq(tbRecommendations.tbAnalysisId, analysis.id))
      .orderBy(asc(tbRecommendations.kind), asc(tbRecommendations.position)),
    db
      .select({
        id: tbQualityGates.id,
        gateName: tbQualityGates.gateName,
        passed: tbQualityGates.passed,
        notes: tbQualityGates.notes,
        checkedAt: tbQualityGates.checkedAt
      })
      .from(tbQualityGates)
      .where(eq(tbQualityGates.tbAnalysisId, analysis.id))
      .orderBy(asc(tbQualityGates.gateName)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        triggers: sql<number>`sum(case when ${tbFindings.polarity} = 'trigger' then 1 else 0 end)::int`,
        barriers: sql<number>`sum(case when ${tbFindings.polarity} = 'barrier' then 1 else 0 end)::int`,
        structural: sql<number>`sum(case when ${tbFindings.movilidad} = 'estructural' then 1 else 0 end)::int`,
        movable: sql<number>`sum(case when ${tbFindings.movilidad} = 'movible_por_marca' then 1 else 0 end)::int`
      })
      .from(tbFindings)
      .where(eq(tbFindings.tbAnalysisId, analysis.id)),
    db
      .select({
        id: brandKnowledgeSources.id,
        sourceKind: brandKnowledgeSources.sourceKind,
        title: brandKnowledgeSources.title,
        originalFileName: brandKnowledgeSources.originalFileName,
        status: brandKnowledgeSources.status,
        errorMessage: brandKnowledgeSources.errorMessage,
        extractedPayload: brandKnowledgeSources.extractedPayload,
        sourcePeriodStart: brandKnowledgeSources.sourcePeriodStart,
        sourcePeriodEnd: brandKnowledgeSources.sourcePeriodEnd,
        createdAt: brandKnowledgeSources.createdAt
      })
      .from(brandKnowledgeSources)
      .where(eq(brandKnowledgeSources.studyCorpusId, corpusId))
      .orderBy(asc(brandKnowledgeSources.createdAt))
  ]);

  // Per-finding enrichment: protagonist quote + journey intensity vector.
  // Used by the Signal payload builder so kicker cards show real verbatims
  // and the friction heatmap shows real journey distribution instead of
  // pseudo-random intensity.
  const findingRows = await db
    .select({
      id: tbFindings.id,
      findingHumanId: tbFindings.findingId,
      findingName: tbFindings.nombreComercial,
      polarity: tbFindings.polarity,
      layer: tbFindings.layer,
      frecuencia: tbFindings.frecuencia,
      intensidadPromedio: tbFindings.intensidadPromedio,
      capacidadPredictiva: tbFindings.capacidadPredictiva,
      scoreCompuesto: tbFindings.scoreCompuesto,
      movilidad: tbFindings.movilidad,
      confidence: tbFindings.confidence,
      periodStart: tbFindings.periodStart,
      periodEnd: tbFindings.periodEnd,
      citaProtagonista: tbFindings.citaProtagonista
    })
    .from(tbFindings)
    .where(eq(tbFindings.tbAnalysisId, analysis.id));

  const citationRows = await db.execute<{
    finding_id: string;
    finding_human_id: string;
    text: string;
    is_protagonist: boolean;
  }>(sql`
    SELECT f.id AS finding_id,
           f.finding_id AS finding_human_id,
           m.text_clean AS text,
           c.is_protagonist
    FROM tb_finding_citations c
    JOIN tb_findings f ON f.id = c.finding_id
    JOIN mentions m ON m.id = c.mention_id
    WHERE f.tb_analysis_id = ${analysis.id}
    ORDER BY f.id, c.is_protagonist DESC, c.position ASC
  `);

  const citationsByFinding = new Map<string, string[]>();
  // Drizzle returns either { rows } or array depending on driver — normalize.
  const rows = (citationRows as unknown as { rows?: typeof citationRows }).rows ?? (citationRows as unknown as Array<{ finding_human_id: string; text: string }>);
  for (const row of rows as Array<{ finding_human_id: string; text: string }>) {
    if (!row?.finding_human_id) continue;
    const list = citationsByFinding.get(row.finding_human_id) ?? [];
    list.push(row.text ?? "");
    citationsByFinding.set(row.finding_human_id, list);
  }

  const findings = findingRows.map((f) => {
    const cita = (f.citaProtagonista ?? null) as { text?: string } | null;
    const quote = cita?.text?.trim() ?? "";
    const allCitations = citationsByFinding.get(f.findingHumanId) ?? [];
    return {
      findingHumanId: f.findingHumanId,
      findingName: f.findingName,
      polarity: f.polarity,
      layer: f.layer,
      frecuencia: f.frecuencia,
      intensidadPromedio: f.intensidadPromedio,
      capacidadPredictiva: f.capacidadPredictiva,
      scoreCompuesto: f.scoreCompuesto,
      movilidad: f.movilidad,
      confidence: f.confidence,
      periodStart: dateString(f.periodStart),
      periodEnd: dateString(f.periodEnd),
      quote,
      evidenceCount: allCitations.length,
      journeyIntensity: computeJourneyIntensity(allCitations.length > 0 ? allCitations : quote ? [quote] : [])
    };
  });

  // Aggregates: feed the Signal dashboard charts (polarity / layer / mobility
  // distributions, source breakdown, volume timeline, severity scatter, top
  // findings by share-of-voice). All computed against the snapshot id so the
  // report stays reproducible from a frozen state.
  const aggregates = options.includeAggregates
    ? await safeLoadDashboardAggregates({
        snapshotId: analysis.snapshotId,
        tbAnalysisId: analysis.id
      })
    : emptySignalAggregates();

  return {
    analysis: analysisWithPersistedIntelligence,
    steps,
    recommendations,
    gates,
    knowledgeSources,
    findings,
    aggregates,
    findingSummary: findingSummary[0] ?? {
      total: 0,
      triggers: 0,
      barriers: 0,
      structural: 0,
      movable: 0
    }
  };
}

type PersistedInsightRow = {
  insight_id: string;
  kind: string;
  title: string;
  summary: string;
  finding_ids: string[] | null;
  data_basis: string[] | null;
  source_breakdown: unknown;
  evidence_quotes: string[] | null;
  confidence: string;
};

type PersistedOpenSignalRow = {
  signal_id: string;
  title: string;
  signal_type: string;
  why_it_matters: string;
  tags: string[] | null;
  evidence_count: number;
  source_breakdown: unknown;
  evidence_quotes: string[] | null;
  confidence: string;
};

type PersistedStrategicOpportunityRow = {
  opportunity_id: string;
  title: string;
  decision: string;
  why_now: string;
  level: string;
  source_mix: string[] | null;
  related_finding_ids: string[] | null;
  evidence_summary: string;
  what_to_do: string;
  success_signal: string;
  confidence: string;
};

type PersistedActionStudioRow = {
  action_id: string;
  target_team: string;
  kind: string;
  title: string;
  finding_ids: string[] | null;
  primary_finding_id: string | null;
  rationale: string;
  action_text: string;
  suggested_channel: string | null;
  suggested_format: string | null;
  success_signal: string;
  estimated_effort: string;
  estimated_impact: string;
  confidence: string;
  priority_rank: number;
};

async function loadPersistedIntelligence(tbAnalysisId: string) {
  const [insights, openSignals, strategicOpportunities, actionStudio] = await Promise.all([
    pool.query<PersistedInsightRow>(
      `
        SELECT
          insight_id,
          kind,
          title,
          summary,
          finding_ids,
          data_basis,
          source_breakdown,
          evidence_quotes,
          confidence
        FROM tb_insights
        WHERE tb_analysis_id = $1
        ORDER BY position ASC, created_at ASC
      `,
      [tbAnalysisId]
    ),
    pool.query<PersistedOpenSignalRow>(
      `
        SELECT
          signal_id,
          title,
          signal_type,
          why_it_matters,
          tags,
          evidence_count,
          source_breakdown,
          evidence_quotes,
          confidence
        FROM tb_open_signals
        WHERE tb_analysis_id = $1
        ORDER BY position ASC, created_at ASC
      `,
      [tbAnalysisId]
    ),
    pool.query<PersistedStrategicOpportunityRow>(
      `
        SELECT
          opportunity.opportunity_id,
          opportunity.title,
          opportunity.decision,
          opportunity.why_now,
          opportunity.level,
          opportunity.source_mix,
          COALESCE((
            SELECT array_agg(finding.finding_id ORDER BY link.position, finding.finding_id)
            FROM tb_opportunity_findings link
            INNER JOIN tb_findings finding ON finding.id = link.finding_id
            WHERE link.opportunity_id = opportunity.id
              AND finding.tb_analysis_id = opportunity.tb_analysis_id
          ), ARRAY[]::text[]) AS related_finding_ids,
          opportunity.evidence_summary,
          opportunity.what_to_do,
          opportunity.success_signal,
          opportunity.confidence
        FROM tb_strategic_opportunities opportunity
        WHERE opportunity.tb_analysis_id = $1
        ORDER BY opportunity.position ASC, opportunity.created_at ASC
      `,
      [tbAnalysisId]
    ),
    pool.query<PersistedActionStudioRow>(
      `
        SELECT
          action.action_id,
          action.target_team,
          action.kind,
          action.title,
          COALESCE((
            SELECT array_agg(finding.finding_id ORDER BY link.position, finding.finding_id)
            FROM tb_action_findings link
            INNER JOIN tb_findings finding ON finding.id = link.finding_id
            WHERE link.action_id = action.id
              AND finding.tb_analysis_id = action.tb_analysis_id
          ), ARRAY[]::text[]) AS finding_ids,
          primary_finding.finding_id AS primary_finding_id,
          action.rationale,
          action.action_text,
          action.suggested_channel,
          action.suggested_format,
          action.success_signal,
          action.estimated_effort,
          action.estimated_impact,
          action.confidence,
          action.priority_rank
        FROM tb_action_studio action
        LEFT JOIN tb_findings primary_finding
          ON primary_finding.id = action.primary_finding_id
         AND primary_finding.tb_analysis_id = action.tb_analysis_id
        WHERE action.tb_analysis_id = $1
        ORDER BY action.priority_rank ASC, action.created_at ASC
      `,
      [tbAnalysisId]
    )
  ]);

  return {
    emergingPatterns: insights.rows.map((row) => ({
      pattern_id: row.insight_id,
      title: row.title,
      pattern_type: row.kind,
      why_it_matters: row.summary,
      data_basis: row.data_basis ?? [],
      evidence_count: Array.isArray(row.evidence_quotes) ? row.evidence_quotes.length : 0,
      source_breakdown: Array.isArray(row.source_breakdown) ? row.source_breakdown : [],
      related_finding_ids: row.finding_ids ?? [],
      confidence: row.confidence,
      evidence_quotes: row.evidence_quotes ?? []
    })),
    openSignals: openSignals.rows.map((row) => ({
      pattern_id: row.signal_id,
      title: row.title,
      pattern_type: row.signal_type,
      why_it_matters: row.why_it_matters,
      data_basis: row.tags ?? [],
      evidence_count: row.evidence_count,
      source_breakdown: Array.isArray(row.source_breakdown) ? row.source_breakdown : [],
      related_finding_ids: [],
      confidence: row.confidence,
      evidence_quotes: row.evidence_quotes ?? []
    })),
    strategicOpportunities: strategicOpportunities.rows.map((row) => ({
      opportunity_id: row.opportunity_id,
      title: row.title,
      decision: row.decision,
      why_now: row.why_now,
      level: row.level,
      source_mix: row.source_mix ?? [],
      related_finding_ids: row.related_finding_ids ?? [],
      evidence_summary: row.evidence_summary,
      what_to_do: row.what_to_do,
      success_signal: row.success_signal,
      confidence: row.confidence
    })),
    actionStudio: actionStudio.rows.map((row) => ({
      action_id: row.action_id,
      target_team: row.target_team,
      kind: row.kind,
      title: row.title,
      finding_ids: row.finding_ids ?? [],
      primary_finding_id: row.primary_finding_id,
      rationale: row.rationale,
      action_text: row.action_text,
      suggested_channel: row.suggested_channel,
      suggested_format: row.suggested_format,
      success_signal: row.success_signal,
      estimated_effort: row.estimated_effort,
      estimated_impact: row.estimated_impact,
      confidence: row.confidence,
      priority_rank: row.priority_rank
    }))
  };
}

function mergePersistedIntelligence(
  metaJson: unknown,
  persisted: Awaited<ReturnType<typeof loadPersistedIntelligence>>
) {
  const meta = metaJson && typeof metaJson === "object" ? metaJson as Record<string, unknown> : {};
  return {
    ...meta,
    emerging_patterns: persisted.emergingPatterns.length > 0 ? persisted.emergingPatterns : meta.emerging_patterns,
    open_signals: persisted.openSignals.length > 0 ? persisted.openSignals : meta.open_signals,
    strategic_opportunities: persisted.strategicOpportunities.length > 0
      ? persisted.strategicOpportunities
      : meta.strategic_opportunities,
    action_studio: persisted.actionStudio.length > 0 ? persisted.actionStudio : meta.action_studio
  };
}

export type SignalAggregates = {
  corpus: { total_mentions: number; window: { start: string | null; end: string | null; months: number } };
  polarity_distribution: { polarity: string; count: number; pct: number }[];
  layer_distribution: { layer: string; count: number; pct: number; avg_intensity: number }[];
  mobility_distribution: { movilidad: string; count: number; pct: number }[];
  platform_distribution: { platform: string; count: number; pct: number }[];
  content_type_distribution: { content_type: string; count: number; pct: number }[];
  volume_timeline: { month: string; count: number }[];
  finding_time_series: {
    month: string;
    finding_id: string;
    finding_name: string;
    polarity: string;
    layer: string | null;
    count: number;
  }[];
  polarity_time_series: { month: string; trigger: number; barrier: number; mixed: number; total: number }[];
  findings_scatter: {
    finding_id: string;
    nombre: string;
    polarity: string;
    layer: string | null;
    movilidad: string | null;
    frecuencia: number;
    intensidad: number;
    score: number;
    period_start: string | null;
    period_end: string | null;
  }[];
  top_findings_by_voice: {
    finding_id: string;
    nombre: string;
    polarity: string;
    layer: string | null;
    citation_count: number;
  }[];
  mentions_sample: {
    mention_id: string;
    finding_id: string | null;
    finding_name: string | null;
    text: string;
    platform: string;
    published_at: string | null;
    is_protagonist: boolean;
  }[];
};

type SnapshotPlatformAggregate = { platform: string; count: number };
type SnapshotContentTypeAggregate = { content_type: string; count: number };
type SnapshotTimelineAggregate = { month: string; count: number };
type SnapshotDashboardBasics = {
  total: number;
  windowData: { start: string | null; end: string | null };
  platforms: SnapshotPlatformAggregate[];
  contentTypes: SnapshotContentTypeAggregate[];
  timeline: SnapshotTimelineAggregate[];
};

function emptySignalAggregates(): SignalAggregates {
  return {
    corpus: { total_mentions: 0, window: { start: null, end: null, months: 0 } },
    polarity_distribution: [],
    layer_distribution: [],
    mobility_distribution: [],
    platform_distribution: [],
    content_type_distribution: [],
    volume_timeline: [],
    finding_time_series: [],
    polarity_time_series: [],
    findings_scatter: [],
    top_findings_by_voice: [],
    mentions_sample: []
  };
}

async function safeLoadDashboardAggregates(args: {
  snapshotId: string;
  tbAnalysisId: string;
}): Promise<SignalAggregates> {
  try {
    return await loadDashboardAggregates(args);
  } catch (err) {
    console.warn("Signal aggregates failed; rendering review without chart aggregates.", {
      snapshotId: args.snapshotId,
      tbAnalysisId: args.tbAnalysisId,
      error: err instanceof Error ? err.message : String(err)
    });
    return emptySignalAggregates();
  }
}

async function loadSnapshotDashboardBasics(snapshotId: string): Promise<SnapshotDashboardBasics> {
  const cache = await loadSnapshotAggregateCache(snapshotId);
  if (cache) return cache;

  const unwrap = <T>(r: unknown): T[] =>
    (r as { rows?: T[] }).rows ?? (r as T[]);

  const [
    corpusTotalRow,
    windowRow,
    platformRows,
    contentTypeRows,
    timelineRows
  ] = await Promise.all([
    db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total FROM mentions m
      JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
      WHERE csm.snapshot_id = ${snapshotId}::uuid
    `),
    db.execute<{ start: string | null; end: string | null }>(sql`
      SELECT MIN(published_at)::text AS start, MAX(published_at)::text AS end
      FROM mentions m
      JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
      WHERE csm.snapshot_id = ${snapshotId}::uuid
    `),
    db.execute<SnapshotPlatformAggregate>(sql`
      SELECT COALESCE(NULLIF(m.resolved_platform, ''), 'unknown') AS platform, COUNT(*)::int AS count
      FROM mentions m
      JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
      WHERE csm.snapshot_id = ${snapshotId}::uuid
      GROUP BY 1 ORDER BY count DESC LIMIT 10
    `),
    db.execute<SnapshotContentTypeAggregate>(sql`
      SELECT COALESCE(NULLIF(m.content_type, ''), 'unknown') AS content_type, COUNT(*)::int AS count
      FROM mentions m
      JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
      WHERE csm.snapshot_id = ${snapshotId}::uuid
      GROUP BY 1 ORDER BY count DESC LIMIT 10
    `),
    db.execute<SnapshotTimelineAggregate>(sql`
      SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, COUNT(*)::int AS count
      FROM mentions m
      JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
      WHERE csm.snapshot_id = ${snapshotId}::uuid
      GROUP BY month ORDER BY month ASC
    `)
  ]);

  return {
    total: unwrap<{ total: number }>(corpusTotalRow)[0]?.total ?? 0,
    windowData: unwrap<{ start: string | null; end: string | null }>(windowRow)[0] ?? { start: null, end: null },
    platforms: unwrap<SnapshotPlatformAggregate>(platformRows),
    contentTypes: unwrap<SnapshotContentTypeAggregate>(contentTypeRows),
    timeline: unwrap<SnapshotTimelineAggregate>(timelineRows)
  };
}

async function loadSnapshotAggregateCache(snapshotId: string): Promise<SnapshotDashboardBasics | null> {
  type CacheRow = {
    total_mentions: number;
    start: string | null;
    end: string | null;
    platform_distribution: unknown;
    content_type_distribution: unknown;
    volume_timeline: unknown;
  };
  const result = await db.execute<CacheRow>(sql`
    SELECT
      total_mentions,
      window_start::text AS start,
      window_end::text AS end,
      platform_distribution,
      content_type_distribution,
      volume_timeline
    FROM corpus_snapshot_aggregates
    WHERE snapshot_id = ${snapshotId}::uuid
    LIMIT 1
  `);
  const rows = (result as { rows?: CacheRow[] }).rows ?? (result as unknown as CacheRow[]);
  const row = rows[0];
  if (!row) return null;

  return {
    total: Number(row.total_mentions ?? 0),
    windowData: { start: row.start, end: row.end },
    platforms: normalizePlatformAggregateRows(row.platform_distribution),
    contentTypes: normalizeContentTypeAggregateRows(row.content_type_distribution),
    timeline: normalizeTimelineAggregateRows(row.volume_timeline)
  };
}

function normalizePlatformAggregateRows(value: unknown): SnapshotPlatformAggregate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      platform: String(item.platform ?? "unknown"),
      count: Number(item.count ?? 0)
    }))
    .filter((item) => item.count > 0);
}

function normalizeContentTypeAggregateRows(value: unknown): SnapshotContentTypeAggregate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      content_type: String(item.content_type ?? "unknown"),
      count: Number(item.count ?? 0)
    }))
    .filter((item) => item.count > 0);
}

function normalizeTimelineAggregateRows(value: unknown): SnapshotTimelineAggregate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      month: String(item.month ?? ""),
      count: Number(item.count ?? 0)
    }))
    .filter((item) => item.month && item.count > 0);
}

async function loadDashboardAggregates(args: {
  snapshotId: string;
  tbAnalysisId: string;
}): Promise<SignalAggregates> {
  const [
    snapshotBasics,
    findingTimelineRows,
    polarityTimelineRows,
    findingsRows,
    voiceRows,
    sampleRows
  ] = await Promise.all([
    loadSnapshotDashboardBasics(args.snapshotId),
    db.execute<{
      month: string;
      finding_id: string;
      finding_name: string;
      polarity: string;
      layer: string | null;
      count: number;
    }>(sql`
      SELECT to_char(date_trunc('month', m.published_at), 'YYYY-MM') AS month,
             f.finding_id,
             f.nombre_comercial AS finding_name,
             f.polarity,
             f.layer,
             COUNT(*)::int AS count
      FROM tb_mention_codings c
      JOIN tb_findings f ON f.id = c.finding_id
      JOIN mentions m ON m.id = c.mention_id
      JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
      WHERE f.tb_analysis_id = ${args.tbAnalysisId}::uuid
        AND c.tb_analysis_id = ${args.tbAnalysisId}::uuid
        AND csm.snapshot_id = ${args.snapshotId}::uuid
        AND c.finding_id IS NOT NULL
      GROUP BY month, f.finding_id, f.nombre_comercial, f.polarity, f.layer
      ORDER BY month ASC, count DESC
    `),
    db.execute<{ month: string; trigger: number; barrier: number; mixed: number; total: number }>(sql`
      SELECT month,
             SUM(CASE WHEN polarity = 'trigger' THEN count ELSE 0 END)::int AS trigger,
             SUM(CASE WHEN polarity = 'barrier' THEN count ELSE 0 END)::int AS barrier,
             SUM(CASE WHEN polarity = 'mixed' THEN count ELSE 0 END)::int AS mixed,
             SUM(count)::int AS total
      FROM (
        SELECT to_char(date_trunc('month', m.published_at), 'YYYY-MM') AS month,
               f.polarity,
               COUNT(*)::int AS count
        FROM tb_mention_codings c
        JOIN tb_findings f ON f.id = c.finding_id
        JOIN mentions m ON m.id = c.mention_id
        JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
        WHERE f.tb_analysis_id = ${args.tbAnalysisId}::uuid
          AND c.tb_analysis_id = ${args.tbAnalysisId}::uuid
          AND csm.snapshot_id = ${args.snapshotId}::uuid
          AND c.finding_id IS NOT NULL
        GROUP BY month, f.polarity
      ) series
      GROUP BY month
      ORDER BY month ASC
    `),
    db.execute<{
      finding_id: string;
      nombre: string;
      polarity: string;
      layer: string | null;
      movilidad: string | null;
      frecuencia: number;
      intensidad: number;
      score: number;
      period_start: string | null;
      period_end: string | null;
    }>(sql`
      SELECT finding_id, nombre_comercial AS nombre, polarity, layer, movilidad,
             frecuencia, intensidad_promedio::float AS intensidad, score_compuesto::float AS score,
             period_start::text, period_end::text
      FROM tb_findings
      WHERE tb_analysis_id = ${args.tbAnalysisId}::uuid
      ORDER BY score_compuesto DESC
    `),
    db.execute<{
      finding_id: string;
      nombre: string;
      polarity: string;
      layer: string | null;
      citation_count: number;
    }>(sql`
      SELECT f.finding_id, f.nombre_comercial AS nombre, f.polarity, f.layer,
             COUNT(c.mention_id)::int AS citation_count
      FROM tb_findings f
      LEFT JOIN tb_mention_codings c ON c.finding_id = f.id
      WHERE f.tb_analysis_id = ${args.tbAnalysisId}::uuid
      GROUP BY f.finding_id, f.nombre_comercial, f.polarity, f.layer
      ORDER BY citation_count DESC LIMIT 12
    `),
    // Mentions sample for the client-safe Signal Corpus View. Pull protagonist
    // verbatims per finding, then top-up with supporting/random citations so
    // the published report can filter/search without exposing the full corpus.
    db.execute<{
      mention_id: string;
      finding_id: string | null;
      finding_name: string | null;
      text: string;
      platform: string;
      published_at: string | null;
      is_protagonist: boolean;
    }>(sql`
      (SELECT m.id AS mention_id, f.finding_id, f.nombre_comercial AS finding_name,
              m.text_clean AS text, m.platform, m.published_at::text AS published_at,
              c.is_protagonist
       FROM tb_finding_citations c
       JOIN tb_findings f ON f.id = c.finding_id
       JOIN mentions m ON m.id = c.mention_id
       WHERE f.tb_analysis_id = ${args.tbAnalysisId}::uuid AND c.is_protagonist = true
       ORDER BY f.score_compuesto DESC
       LIMIT 40)
      UNION ALL
      (SELECT m.id, f.finding_id, f.nombre_comercial, m.text_clean, m.platform,
              m.published_at::text, c.is_protagonist
       FROM tb_finding_citations c
       JOIN tb_findings f ON f.id = c.finding_id
       JOIN mentions m ON m.id = c.mention_id
       WHERE f.tb_analysis_id = ${args.tbAnalysisId}::uuid AND c.is_protagonist = false
       ORDER BY random()
       LIMIT 80)
    `)
  ]);

  const unwrap = <T>(r: unknown): T[] =>
    (r as { rows?: T[] }).rows ?? (r as T[]);

  const total = snapshotBasics.total;
  const windowData = snapshotBasics.windowData;
  const months =
    windowData.start && windowData.end
      ? Math.max(1, Math.round((new Date(windowData.end).getTime() - new Date(windowData.start).getTime()) / (1000 * 60 * 60 * 24 * 30)))
      : 0;

  const platforms = snapshotBasics.platforms;
  const contentTypes = snapshotBasics.contentTypes;
  const timeline = snapshotBasics.timeline;
  const findingTimeline = unwrap<{
    month: string;
    finding_id: string;
    finding_name: string;
    polarity: string;
    layer: string | null;
    count: number;
  }>(findingTimelineRows);
  const polarityTimeline = unwrap<{ month: string; trigger: number; barrier: number; mixed: number; total: number }>(polarityTimelineRows);
  const findingsList = unwrap<{
    finding_id: string;
    nombre: string;
    polarity: string;
    layer: string | null;
    movilidad: string | null;
    frecuencia: number;
    intensidad: number;
    score: number;
    period_start: string | null;
    period_end: string | null;
  }>(findingsRows);
  const voiceList = unwrap<{
    finding_id: string;
    nombre: string;
    polarity: string;
    layer: string | null;
    citation_count: number;
  }>(voiceRows);
  const sampleList = unwrap<{
    mention_id: string;
    finding_id: string | null;
    finding_name: string | null;
    text: string;
    platform: string;
    published_at: string | null;
    is_protagonist: boolean;
  }>(sampleRows);

  // Polarity distribution from findings
  const polarityCounts = new Map<string, number>();
  const layerAgg = new Map<string, { count: number; intensitySum: number }>();
  const mobilityCounts = new Map<string, number>();
  for (const f of findingsList) {
    polarityCounts.set(f.polarity, (polarityCounts.get(f.polarity) ?? 0) + 1);
    if (f.layer) {
      const cur = layerAgg.get(f.layer) ?? { count: 0, intensitySum: 0 };
      cur.count += 1;
      cur.intensitySum += Number(f.intensidad ?? 0);
      layerAgg.set(f.layer, cur);
    }
    if (f.movilidad) {
      mobilityCounts.set(f.movilidad, (mobilityCounts.get(f.movilidad) ?? 0) + 1);
    }
  }
  const totalFindings = Math.max(1, findingsList.length);

  return {
    corpus: {
      total_mentions: total,
      window: { start: windowData.start, end: windowData.end, months }
    },
    polarity_distribution: Array.from(polarityCounts.entries()).map(([polarity, count]) => ({
      polarity,
      count,
      pct: (count / totalFindings) * 100
    })),
    layer_distribution: ["personal", "psicologico", "social", "cultural"].map((layer) => {
      const a = layerAgg.get(layer) ?? { count: 0, intensitySum: 0 };
      return {
        layer,
        count: a.count,
        pct: (a.count / totalFindings) * 100,
        avg_intensity: a.count > 0 ? a.intensitySum / a.count : 0
      };
    }),
    mobility_distribution: ["movible_por_marca", "parcialmente_movible", "estructural"].map((movilidad) => {
      const count = mobilityCounts.get(movilidad) ?? 0;
      return { movilidad, count, pct: (count / totalFindings) * 100 };
    }),
    platform_distribution: platforms.map((p) => ({
      platform: p.platform,
      count: p.count,
      pct: total > 0 ? (p.count / total) * 100 : 0
    })),
    content_type_distribution: contentTypes.map((p) => ({
      content_type: p.content_type,
      count: p.count,
      pct: total > 0 ? (p.count / total) * 100 : 0
    })),
    volume_timeline: timeline.map((t) => ({ month: t.month, count: t.count })),
    finding_time_series: findingTimeline.map((t) => ({
      month: t.month,
      finding_id: t.finding_id,
      finding_name: t.finding_name,
      polarity: t.polarity,
      layer: t.layer,
      count: Number(t.count ?? 0)
    })),
    polarity_time_series: polarityTimeline.map((t) => ({
      month: t.month,
      trigger: Number(t.trigger ?? 0),
      barrier: Number(t.barrier ?? 0),
      mixed: Number(t.mixed ?? 0),
      total: Number(t.total ?? 0)
    })),
    findings_scatter: findingsList.map((f) => ({
      finding_id: f.finding_id,
      nombre: f.nombre,
      polarity: f.polarity,
      layer: f.layer,
      movilidad: f.movilidad,
      frecuencia: Number(f.frecuencia ?? 0),
      intensidad: Number(f.intensidad ?? 0),
      score: Number(f.score ?? 0),
      period_start: f.period_start,
      period_end: f.period_end
    })),
    top_findings_by_voice: voiceList.map((v) => ({
      finding_id: v.finding_id,
      nombre: v.nombre,
      polarity: v.polarity,
      layer: v.layer,
      citation_count: Number(v.citation_count ?? 0)
    })),
    mentions_sample: sampleList.map((s) => ({
      mention_id: s.mention_id,
      finding_id: s.finding_id,
      finding_name: s.finding_name,
      text: s.text,
      platform: s.platform,
      published_at: s.published_at,
      is_protagonist: Boolean(s.is_protagonist)
    }))
  };
}

/**
 * Heuristic Spanish-MX classifier mapping verbatims to T&B customer journey
 * stages. Returns a 4-tuple of normalized intensity scores for
 * [consideracion, compra, siniestro, renovacion]. Sum of components in [0,1].
 *
 * TODO mejora-futura: reemplazar por clasificador semántico (embeddings o
 * Claude small) cuando agreguemos pgvector. Hoy esta heurística es honesta
 * — captura las señales fuertes y deja vacío cuando no hay match.
 */
function computeJourneyIntensity(texts: string[]): Record<string, number> {
  if (texts.length === 0) {
    return emptyJourneyIntensity();
  }
  const stageKeywords: Record<keyof ReturnType<typeof emptyJourneyIntensity>, RegExp[]> = {
    awareness: [/vi (?:un |el |la )?/i, /me sali[oó]/i, /anuncio/i, /tiktok/i, /instagram/i, /viral/i, /me apareci[oó]/i, /escuch[eé]/i],
    consideration: [/buscar/i, /comparar/i, /vale la pena/i, /elegir/i, /quiero/i, /\bduda(?:s)?\b/i, /opiniones/i, /reseñas/i, /recomend/i],
    evaluation: [/qu[eé] tan/i, /calidad/i, /precio/i, /car[oa]/i, /barat[oa]/i, /conviene/i, /mejor/i, /diferencia/i, /funciona/i],
    purchase: [/compr[eé]/i, /pag[ué]\b/i, /ped[ií]/i, /orden/i, /checkout/i, /env[ií]o/i, /tienda/i, /carrito/i],
    usage: [/us[eé]/i, /prob[eé]/i, /me sirvi[oó]/i, /no me sirvi[oó]/i, /experiencia/i, /lleg[oó]/i, /servicio/i, /soporte/i],
    repeat: [/volver[ií]a/i, /recompr/i, /otra vez/i, /cancel/i, /me cambi[eé]/i, /ya no/i, /seguir[eé]/i],
    advocacy: [/recomiendo/i, /me recomendaron/i, /favorit[oa]/i, /amo/i, /me encant[oó]/i, /no lo recomiendo/i]
  };

  const counts = emptyJourneyIntensity();
  let totalMatches = 0;

  for (const text of texts) {
    if (!text) continue;
    for (const stage of Object.keys(stageKeywords) as Array<keyof typeof stageKeywords>) {
      const hits = (stageKeywords[stage] ?? []).reduce((acc, re) => acc + (re.test(text) ? 1 : 0), 0);
      counts[stage] += hits;
      totalMatches += hits;
    }
  }

  if (totalMatches === 0) {
    return emptyJourneyIntensity(0.02);
  }

  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value / totalMatches]));
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

function emptyJourneyIntensity(value = 0): Record<"awareness" | "consideration" | "evaluation" | "purchase" | "usage" | "repeat" | "advocacy", number> {
  return {
    awareness: value,
    consideration: value,
    evaluation: value,
    purchase: value,
    usage: value,
    repeat: value,
    advocacy: value
  };
}

function parseDateBoundary(value: string | undefined, boundary: "start" | "end") {
  if (!value) return null;
  const date = new Date(`${value}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Returns the live state needed by the engine wizard.
 * - corpus mention counts (included / excluded / total)
 * - per-iteration batch counts so the wizard knows which CSVs already arrived
 * - "current step" derived from the latest iteration's progression
 */
export async function getCorpusEngineState(corpusId: string) {
  const iterations = await listQueryIterationsForCorpus(corpusId);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      included: sql<number>`sum(case when ${mentions.inclusionStatus}='included' then 1 else 0 end)::int`,
      excluded: sql<number>`sum(case when ${mentions.inclusionStatus}='excluded' then 1 else 0 end)::int`,
      pending: sql<number>`sum(case when ${mentions.inclusionStatus}='pending' then 1 else 0 end)::int`
    })
    .from(mentions)
    .where(eq(mentions.studyCorpusId, corpusId));

  const [assessmentRow] = await db
    .select({
      themeId: studyCorpora.themeId,
      analysisPlan: studyCorpora.analysisPlan,
      status: studyCorpora.status,
      corpusRevision: studyCorpora.corpusRevision,
      latestAssessment: studyCorpora.latestAssessment,
      latestAssessedAt: studyCorpora.latestAssessedAt,
      latestAssessedRevision: studyCorpora.latestAssessedRevision
    })
    .from(studyCorpora)
    .where(eq(studyCorpora.id, corpusId))
    .limit(1);

  const batches = await db
    .select({
      id: importBatches.id,
      queryIterationId: importBatches.queryIterationId,
      queryPackId: importBatches.queryPackId,
      mentionType: importBatches.mentionType,
      competitorId: importBatches.competitorId,
      corpusEntityId: importBatches.corpusEntityId,
      entityKind: importBatches.entityKind,
      entityLabel: importBatches.entityLabel,
      recordCount: importBatches.recordCount,
      includedCount: importBatches.includedCount,
      excludedCount: importBatches.excludedCount,
      sourceFileName: importBatches.sourceFileName,
      status: importBatches.status,
      createdAt: importBatches.createdAt
    })
    .from(importBatches)
    .where(eq(importBatches.studyCorpusId, corpusId))
    .orderBy(desc(importBatches.createdAt));

  const packs = await db
    .select({
      id: queryPacks.id,
      queryIterationId: queryPacks.queryIterationId,
      lensSlug: queryPacks.lensSlug,
      signalIntent: queryPacks.signalIntent,
      scope: queryPacks.scope,
      objective: queryPacks.objective,
      queryText: queryPacks.queryText,
      queryComponents: queryPacks.queryComponents,
      seeds: queryPacks.seeds,
      evaluation: queryPacks.evaluation,
      status: queryPacks.status,
      mentionsReturned: queryPacks.mentionsReturned,
      qualityScore: queryPacks.qualityScore,
      densityScore: queryPacks.densityScore,
      noiseScore: queryPacks.noiseScore,
      evaluatedAt: queryPacks.evaluatedAt,
      linkedMentionCount: sql<number>`(
        SELECT COUNT(DISTINCT mqs.mention_id)::int
        FROM mention_query_sources mqs
        JOIN mentions mn ON mn.id = mqs.mention_id
        WHERE mqs.query_pack_id = ${sql.raw('"query_packs"."id"')}
          AND mn.inclusion_status = 'included'
      )`,
      createdAt: queryPacks.createdAt
    })
    .from(queryPacks)
    .where(eq(queryPacks.studyCorpusId, corpusId))
    .orderBy(desc(queryPacks.createdAt));
  const productionLensSlug = normalizeStudyAnalysisPlan(assessmentRow?.analysisPlan).primary_methodology_slug === "signal-pulse"
    ? "signal-pulse"
    : "triggers-barriers";
  const productionPacks = packs.filter((pack) => pack.lensSlug === productionLensSlug);

  const activeEntities = await db
    .select({ id: corpusEntities.id })
    .from(corpusEntities)
    .where(and(eq(corpusEntities.studyCorpusId, corpusId), ne(corpusEntities.status, "archived")));

  // The "current" iteration is the most recently created — wizard works on it
  const current = iterations[0] ?? null;

  const [latestQueryValidationRun] = current?.latestQueryValidationRunId
    ? await db
        .select({
          id: queryValidationRuns.id,
          status: queryValidationRuns.status,
          sourceSystem: queryValidationRuns.sourceSystem,
          sampleSizePerPack: queryValidationRuns.sampleSizePerPack,
          maxAttempts: queryValidationRuns.maxAttempts,
          summary: queryValidationRuns.summary,
          pipelineVersion: queryValidationRuns.pipelineVersion,
          startedAt: queryValidationRuns.startedAt,
          completedAt: queryValidationRuns.completedAt
        })
        .from(queryValidationRuns)
        .where(eq(queryValidationRuns.id, current.latestQueryValidationRunId))
        .limit(1)
    : [];

  const queryValidationAttemptsForRun = latestQueryValidationRun
    ? await db
        .select({
          id: queryValidationAttempts.id,
          queryPackId: queryValidationAttempts.queryPackId,
          attemptNumber: queryValidationAttempts.attemptNumber,
          attemptKind: queryValidationAttempts.attemptKind,
          queryText: queryValidationAttempts.queryText,
          sampleSize: queryValidationAttempts.sampleSize,
          uniqueSampleSize: queryValidationAttempts.uniqueSampleSize,
          status: queryValidationAttempts.status,
          metrics: queryValidationAttempts.metrics,
          notes: queryValidationAttempts.notes,
          proposedAdjustments: queryValidationAttempts.proposedAdjustments,
          evaluatedAt: queryValidationAttempts.evaluatedAt
        })
        .from(queryValidationAttempts)
        .where(eq(queryValidationAttempts.queryValidationRunId, latestQueryValidationRun.id))
        .orderBy(asc(queryValidationAttempts.attemptNumber))
    : [];

  // Decide the active step purely from current iteration state
  type Step = "compose" | "upload" | "evaluate" | "decide" | "approved";
  let activeStep: Step = "compose";

  if (current) {
    const decision = current.insightsManagerDecision;
    const currentBatches = batches.filter(
      (b) => b.queryIterationId === current.id && b.status === "completed"
    );
    const currentPacks = productionPacks.filter((pack) => pack.queryIterationId === current.id);
    const primaryMentionType = assessmentRow?.themeId ? "industry" : "brand";
    const hasBrand = currentBatches.some((b) => b.mentionType === "brand");
    const hasCompetitor = currentBatches.some((b) => b.mentionType === "competitor");
    const hasIndustry = currentBatches.some((b) => b.mentionType === "industry");
    const wantsCompetitor = !!current.competitorQueryText;
    const wantsIndustry = primaryMentionType === "brand" && !!current.industryQueryText;
    const hasPrimary = primaryMentionType === "brand" ? hasBrand : hasIndustry;
    const uploadedEntityIds = new Set(
      currentBatches
        .map((batch) => batch.corpusEntityId)
        .filter((entityId): entityId is string => Boolean(entityId))
    );
    const entityUploadsReady = activeEntities.length > 0
      && activeEntities.every((entity) => uploadedEntityIds.has(entity.id));
    const legacyCsvsReady = hasPrimary && (!wantsCompetitor || hasCompetitor) && (!wantsIndustry || hasIndustry);
    const packUploadsReady = currentPacks.length > 0
      && currentPacks.every((pack) => queryPackHasDirectCsv(pack, currentBatches));
    const csvsReady = currentPacks.length > 0
        ? packUploadsReady
      : activeEntities.length > 0
        ? entityUploadsReady
        : legacyCsvsReady;
    const terminalEvaluationStatuses = new Set(["ready", "needs_adjustment", "insufficient_sample", "failed"]);
    const packEvaluationStatuses = currentPacks.map((pack) => queryPackEvaluationStatus(pack.evaluation));
    const packsEvaluated = currentPacks.length > 0
      && packEvaluationStatuses.every((status) => status && terminalEvaluationStatuses.has(status));
    const legacyEvaluated = currentPacks.length === 0 && current.qualityScore !== null;

    const validationContractCurrent = Boolean(
      latestQueryValidationRun
        && latestQueryValidationRun.sourceSystem === "imported_corpus"
        && latestQueryValidationRun.pipelineVersion === QUERY_PACK_EVALUATOR_PIPELINE_VERSION
    );

    if (decision === "query_approved" || decision === "approved") {
      // Query validation closes on imported evidence. Corpus certification is
      // a separate, revision-bound gate rendered above the query workflow.
      activeStep = "decide";
    } else if (decision === "applied" || decision === "rejected") {
      // last iteration was actioned but no new iteration yet — compose next
      activeStep = "compose";
    } else if (currentPacks.length > 0) {
      if (!packUploadsReady) {
        activeStep = "upload";
      } else if (!packsEvaluated || !validationContractCurrent) {
        activeStep = "evaluate";
      } else {
        // Terminal imported-evidence results always go through analyst review.
        activeStep = "decide";
      }
    } else if (legacyEvaluated) {
      activeStep = "decide";
    } else if (csvsReady) {
      activeStep = "evaluate";
    } else {
      activeStep = "upload";
    }
  }

  // Query potential is a gate for the candidate query only. It never certifies
  // the imported corpus; corpus approval is revisioned independently below.
  let queryReady = false;
  if (current) {
    const currentPacks = productionPacks.filter((pack) => pack.queryIterationId === current.id);
    if (currentPacks.length > 0) {
      queryReady = current.insightsManagerDecision === "query_approved"
        && Boolean(current.approvedQueryValidationRunId);
    } else if (current.qualityScore !== null) {
      const q = Number(current.qualityScore);
      const d = Number(current.densityScore);
      const n = Number(current.noiseScore);
      queryReady = q >= 7 && d >= 7 && n <= 3;
    }
  }

  const snapshots = await db
    .select({
      id: corpusSnapshots.id,
      label: corpusSnapshots.label,
      kind: corpusSnapshots.kind,
      mentionCount: corpusSnapshots.mentionCount,
      createdAt: corpusSnapshots.createdAt
    })
    .from(corpusSnapshots)
    .where(eq(corpusSnapshots.studyCorpusId, corpusId))
    .orderBy(desc(corpusSnapshots.createdAt))
    .limit(20);

  const assessmentCurrent = Boolean(
    assessmentRow?.latestAssessment
      && assessmentRow.latestAssessedRevision === assessmentRow.corpusRevision
  );
  const hasApprovalSnapshot = snapshots.some((snapshot) => snapshot.kind === "approval");
  const isApproved = assessmentRow?.status === "corpus_approved"
    && assessmentCurrent
    && hasApprovalSnapshot;
  if (isApproved) activeStep = "approved";

  const cleanups = await db
    .select({
      id: cleanupActions.id,
      kind: cleanupActions.kind,
      instruction: cleanupActions.instruction,
      patterns: cleanupActions.patterns,
      claudeNotes: cleanupActions.claudeNotes,
      mentionCount: cleanupActions.mentionCount,
      createdAt: cleanupActions.createdAt,
      revertedAt: cleanupActions.revertedAt
    })
    .from(cleanupActions)
    .where(eq(cleanupActions.studyCorpusId, corpusId))
    .orderBy(desc(cleanupActions.createdAt))
    .limit(20);

  return {
    corpus: {
      total: counts?.total ?? 0,
      included: counts?.included ?? 0,
      excluded: counts?.excluded ?? 0,
      pending: counts?.pending ?? 0
    },
    iterations,
    batches,
    queryPacks: productionPacks,
    current,
    activeStep,
    isApproved,
    queryReady,
    queryValidation: latestQueryValidationRun
      ? {
          ...latestQueryValidationRun,
          approved: current?.approvedQueryValidationRunId === latestQueryValidationRun.id,
          contractCurrent: latestQueryValidationRun.sourceSystem === "imported_corpus"
            && latestQueryValidationRun.pipelineVersion === QUERY_PACK_EVALUATOR_PIPELINE_VERSION,
          evidenceSampleTarget: QUERY_PACK_IMPORTED_SAMPLE_SIZE,
          minimumEvidenceSample: QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE,
          attempts: queryValidationAttemptsForRun
        }
      : null,
    assessment: assessmentRow?.latestAssessment ?? null,
    assessedAt: assessmentRow?.latestAssessedAt ?? null,
    corpusRevision: assessmentRow?.corpusRevision ?? 1,
    latestAssessedRevision: assessmentRow?.latestAssessedRevision ?? null,
    assessmentCurrent,
    snapshots,
    cleanups
  };
}

function queryPackEvaluationStatus(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>).status;
  return typeof status === "string" ? status : null;
}
