import { eq } from "drizzle-orm";

import { brandKnowledgeSources, methodologies, studyCorpora } from "@noisia/db";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { collectIndustryTags, getBaselineCompatibility } from "@/lib/baseline-corpus";
import { listBrandsForUser } from "@/lib/data/brands";
import { listReusableBaselineCorporaForUser } from "@/lib/data/corpora";
import { listThemesForUser } from "@/lib/data/themes";
import { buildStudyDataOsFieldSpecs } from "@/lib/data-os/field-specs";
import { initializeDataOsStudyIntake } from "@/lib/data-os/study-intake";
import { db } from "@/lib/db";
import { normalizeStudyAnalysisPlan } from "@/lib/multimethod/analysis-plan";
import { buildStudyContextPayload } from "@/lib/study-intake-context";
import { createStudySchema } from "@/lib/validation/brand";

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canManageCorpus(session.appUser.primaryRole)) {
    return forbidden();
  }

  const parsed = createStudySchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const subject = parsed.data.brand_id
    ? await resolveBrandSubject(session.appUser, parsed.data.brand_id)
    : await resolveThemeSubject(session.appUser, parsed.data.theme_id ?? "");

  if (!subject) {
    return Response.json(
      { error: "not_found", message: "Sujeto de estudio no encontrado o sin acceso." },
      { status: 404 }
    );
  }

  const [methodology] = await db
    .select({
      id: methodologies.id,
      slug: methodologies.slug,
      name: methodologies.name,
      version: methodologies.version,
      status: methodologies.status
    })
    .from(methodologies)
    .where(eq(methodologies.id, parsed.data.methodology_id))
    .limit(1);

  const methodologyAllowed = methodology?.status === "active" || (methodology?.slug === "signal-pulse" && methodology.status === "beta");
  if (!methodology || !methodologyAllowed) {
    return Response.json(
      { error: "not_found", message: "Metodología activa no encontrada." },
      { status: 404 }
    );
  }

  const baseCorpus = parsed.data.base_corpus_id
    ? await resolveBaseCorpus(session.appUser, parsed.data.base_corpus_id, {
        brandId: subject.type === "brand" ? subject.id : null,
        methodologySlug: methodology.slug,
        industryTags: subject.type === "brand" ? collectIndustryTags(subject.industry, subject.industrySub) : [],
        geoFocus: parsed.data.geo_focus
      })
    : null;
  if (parsed.data.base_corpus_id && !baseCorpus) {
    return Response.json(
      { error: "invalid_baseline", message: "Corpus baseline no encontrado, sin acceso o incompatible con la marca, mercado y metodología." },
      { status: 422 }
    );
  }

  const analysisPlan = normalizeStudyAnalysisPlan(parsed.data.analysis_plan, methodology.slug);
  const cleanName = parsed.data.name.trim();
  const sourceManifest = parsed.data.source_manifest ?? [];
  const studyContextPayload = buildStudyContextPayload({
    businessQuestion: parsed.data.business_question,
    studyContext: parsed.data.study_context,
    sourceSnapshots: sourceManifest.map((source) => ({
      name: source.name,
      kind: source.kind,
      text: source.preview_text,
      sizeBytes: source.size_bytes
    }))
  });
  const studyContext = studyContextPayload.studyContext || null;
  const canonicalBusinessQuestion = studyContextPayload.questionCandidate.trim() || parsed.data.business_question.trim();
  const decisionCatalog = splitLines(parsed.data.decision_to_inform);
  const audienceSegments = splitLines(parsed.data.audience_segment);
  const dataOsFieldSpecs = buildStudyDataOsFieldSpecs({
    submittedSpecs: parsed.data.data_os_field_specs,
    businessQuestion: canonicalBusinessQuestion,
    decisionToInform: parsed.data.decision_to_inform,
    audienceSegment: parsed.data.audience_segment,
    categoryContext: parsed.data.category_context,
    competitiveContext: parsed.data.competitive_context,
    studyContext,
    hypotheses: parsed.data.hypotheses,
    knownBarriers: parsed.data.known_barriers,
    knownTriggers: parsed.data.known_triggers,
    strategicConstraints: parsed.data.strategic_constraints,
    successCriteria: parsed.data.success_criteria,
    geoFocus: parsed.data.geo_focus,
    targetWindowMonths: parsed.data.target_window_months,
    sourceManifest
  });
  const intakeContract = {
    version: 1,
    source: "studio_new_study_form",
    methodology_slug: methodology.slug,
    objective: {
      business_question: canonicalBusinessQuestion,
      canonical_question_candidate: studyContextPayload.questionCandidate,
      raw_question_was_context: studyContextPayload.rawQuestionIsContext,
      raw_business_question_chars: parsed.data.business_question.trim().length,
      decision_to_inform: emptyToNull(parsed.data.decision_to_inform),
      decision_catalog: decisionCatalog,
      audience_segment: emptyToNull(parsed.data.audience_segment),
      audience_segments: audienceSegments,
      data_os_field_specs: dataOsFieldSpecs,
      geo_focus: parsed.data.geo_focus,
      target_window_months: parsed.data.target_window_months
    },
    study_context: studyContext
      ? {
          present: true,
          source: studyContextPayload.rawQuestionIsContext ? "business_question_promoted_to_context" : "study_context_field",
          chars: studyContext.length
        }
      : { present: false },
    source_manifest: sourceManifest,
    normalized_lists: {
      decision_catalog: decisionCatalog,
      audience_segments: audienceSegments,
      hypotheses: splitLines(parsed.data.hypotheses),
      category_context_terms: splitLines(parsed.data.category_context),
      competitive_context_terms: splitLines(parsed.data.competitive_context),
      known_barriers: splitLines(parsed.data.known_barriers),
      known_triggers: splitLines(parsed.data.known_triggers),
      strategic_constraints: splitLines(parsed.data.strategic_constraints),
      success_criteria: splitLines(parsed.data.success_criteria)
    },
    field_specs: dataOsFieldSpecs,
    data_os_targets: [
      "study_corpora.context_form",
      "brand_knowledge_sources.study_brief",
      "brand_os_objectives",
      "brand_os_briefs",
      "brand_os_seed_sets",
      "brand_os_seed_terms",
      "knowledge_assertions",
      "knowledge_usage_events",
      "brand_os_links",
      "lineage_edges",
      "data_sources",
      "source_sync_runs",
      "data_assets",
      "data_asset_fields"
    ],
    baseline: baseCorpus
      ? {
          corpus_id: baseCorpus.id,
          type: baseCorpus.candidateType,
          name: baseCorpus.name,
          subject: baseCorpus.subjectLabel,
          methodology_slug: baseCorpus.methodologySlug,
          geo_focus: baseCorpus.geoFocus,
          included_mentions: baseCorpus.includedCount,
          link_policy: "reference_not_copy"
        }
      : null
  };
  const studyBrief = {
    study_name: cleanName,
    subject_type: subject.type,
    subject_name: subject.name,
    base_corpus_id: baseCorpus?.id ?? null,
    base_corpus_type: baseCorpus?.candidateType ?? null,
    base_corpus_name: baseCorpus?.name ?? null,
    base_corpus_theme: baseCorpus?.themeName ?? null,
    base_corpus_subject: baseCorpus?.subjectLabel ?? null,
    base_corpus_methodology: baseCorpus?.methodologySlug ?? null,
    base_corpus_included_mentions: baseCorpus?.includedCount ?? null,
    methodology_slug: methodology.slug,
    analysis_plan: analysisPlan,
    business_question: canonicalBusinessQuestion,
    study_context: studyContext,
    source_manifest: sourceManifest,
    decision_to_inform: emptyToNull(parsed.data.decision_to_inform),
    audience_segment: emptyToNull(parsed.data.audience_segment),
    category_context: emptyToNull(parsed.data.category_context),
    hypotheses: emptyToNull(parsed.data.hypotheses),
    competitive_context: emptyToNull(parsed.data.competitive_context),
    known_barriers: emptyToNull(parsed.data.known_barriers),
    known_triggers: emptyToNull(parsed.data.known_triggers),
    strategic_constraints: emptyToNull(parsed.data.strategic_constraints),
    success_criteria: emptyToNull(parsed.data.success_criteria),
    data_os_field_specs: dataOsFieldSpecs,
    geo_focus: parsed.data.geo_focus,
    target_window_months: parsed.data.target_window_months,
    created_from: "studio_new_study_form",
    intake_contract: intakeContract
  };
  const [corpus] = await db
    .insert(studyCorpora)
    .values({
      name: cleanName,
      brandId: subject.type === "brand" ? subject.id : undefined,
      themeId: subject.type === "theme" ? subject.id : undefined,
      baseCorpusId: baseCorpus?.id,
      methodologyId: methodology.id,
      methodologyVersionAtCreation: methodology.version,
      businessQuestion: canonicalBusinessQuestion,
      decisionToInform: emptyToNull(parsed.data.decision_to_inform),
      audienceSegment: emptyToNull(parsed.data.audience_segment),
      geoFocus: parsed.data.geo_focus,
      targetWindowMonths: parsed.data.target_window_months,
      contextForm: studyBrief,
      analysisPlan,
      status: "draft",
      currentPipelineVersion: "mvp-f1",
      insightsManagerUserId: session.appUser.id
    })
    .returning({ id: studyCorpora.id });

  if (!corpus) {
    return Response.json(
      { error: "insert_failed", message: "No se pudo crear el estudio." },
      { status: 500 }
    );
  }

  const studyBriefRawText = Object.entries(studyBrief)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${briefValueToText(value)}`)
    .join("\n");

  const [studyBriefSource] = await db.insert(brandKnowledgeSources).values({
    organizationId: subject.organizationId,
    brandId: subject.type === "brand" ? subject.id : undefined,
    studyCorpusId: corpus.id,
    sourceKind: "study_brief",
    title: cleanName,
    rawText: studyBriefRawText,
    extractedPayload: {
      summary: canonicalBusinessQuestion,
      decision_clues: decisionCatalog,
      audience_clues: audienceSegments,
      cultural_codes: splitLines(parsed.data.category_context),
      initial_hypotheses: splitLines(parsed.data.hypotheses),
      competitor_clues: splitLines(parsed.data.competitive_context),
      potential_triggers: splitLines(parsed.data.known_triggers),
      potential_barriers: splitLines(parsed.data.known_barriers),
      query_language: [],
      strategic_constraints: splitLines(parsed.data.strategic_constraints),
      success_criteria: splitLines(parsed.data.success_criteria),
      data_os_field_specs: dataOsFieldSpecs,
      intake_contract: intakeContract,
      recommended_use: ["query_composition", "analysis_context", "signal_editorial"],
      source: "study_brief"
    },
    status: "processed",
    createdByUserId: session.appUser.id
  }).returning({ id: brandKnowledgeSources.id });

  let contextSource: { id: string } | null = null;
  if (studyContext) {
    const [createdContextSource] = await db.insert(brandKnowledgeSources).values({
      organizationId: subject.organizationId,
      brandId: subject.type === "brand" ? subject.id : undefined,
      studyCorpusId: corpus.id,
      sourceKind: "study_context",
      title: `${cleanName} · Prior context`,
      rawText: studyContext,
      extractedPayload: {
        summary: studyContextPayload.questionCandidate,
        context_chars: studyContext.length,
        source_manifest: sourceManifest,
        raw_question_was_context: studyContextPayload.rawQuestionIsContext,
        recommended_use: ["study_objective_generation", "query_composition", "analysis_context", "data_os_lineage"],
        source: "study_context"
      },
      status: "processed",
      createdByUserId: session.appUser.id
    }).returning({ id: brandKnowledgeSources.id });
    contextSource = createdContextSource ?? null;
  }

  let competitiveBriefSource: { id: string } | null = null;
  if (parsed.data.competitive_context?.trim()) {
    const [createdCompetitiveBriefSource] = await db.insert(brandKnowledgeSources).values({
      organizationId: subject.organizationId,
      brandId: subject.type === "brand" ? subject.id : undefined,
      studyCorpusId: corpus.id,
      sourceKind: "competitive_brief",
      title: `${cleanName} · Competitive context`,
      rawText: parsed.data.competitive_context.trim(),
      extractedPayload: {
        summary: parsed.data.competitive_context.trim().slice(0, 1200),
        competitor_clues: splitLines(parsed.data.competitive_context),
        recommended_use: ["query_composition", "analysis_context", "signal_editorial", "competitive_analysis"],
        source: "study_competitive_brief"
      },
      status: "processed",
      createdByUserId: session.appUser.id
    }).returning({ id: brandKnowledgeSources.id });
    competitiveBriefSource = createdCompetitiveBriefSource ?? null;
  }

  let dataOsIntake: Awaited<ReturnType<typeof initializeDataOsStudyIntake>> | { enabled: true; initialized: false; error: string } | null = null;
  if (studyBriefSource) {
    try {
      dataOsIntake = await initializeDataOsStudyIntake({
        corpusId: corpus.id,
        studyName: cleanName,
        subject,
        methodologySlug: methodology.slug,
        businessQuestion: canonicalBusinessQuestion,
        studyContext,
        decisionToInform: emptyToNull(parsed.data.decision_to_inform),
        audienceSegment: emptyToNull(parsed.data.audience_segment),
        categoryContext: emptyToNull(parsed.data.category_context),
        hypotheses: emptyToNull(parsed.data.hypotheses),
        competitiveContext: emptyToNull(parsed.data.competitive_context),
        knownTriggers: emptyToNull(parsed.data.known_triggers),
        knownBarriers: emptyToNull(parsed.data.known_barriers),
        strategicConstraints: emptyToNull(parsed.data.strategic_constraints),
        successCriteria: emptyToNull(parsed.data.success_criteria),
        dataOsFieldSpecs,
        geoFocus: parsed.data.geo_focus,
        targetWindowMonths: parsed.data.target_window_months,
        analysisPlan,
        baseCorpus,
        sourceManifest,
        knowledgeSources: [
          {
            id: studyBriefSource.id,
            title: cleanName,
            sourceKind: "study_brief",
            rawText: studyBriefRawText
          },
          ...(contextSource
            ? [
                {
                  id: contextSource.id,
                  title: `${cleanName} · Prior context`,
                  sourceKind: "study_context",
                  rawText: studyContext ?? ""
                }
              ]
            : []),
          ...(competitiveBriefSource
            ? [
                {
                  id: competitiveBriefSource.id,
                  title: `${cleanName} · Competitive context`,
                  sourceKind: "competitive_brief",
                  rawText: parsed.data.competitive_context?.trim() ?? ""
                }
              ]
            : [])
        ]
      });
    } catch (error) {
      console.warn("[data-os] study intake initialization failed", {
        corpusId: corpus.id,
        error: error instanceof Error ? error.message : String(error)
      });
      dataOsIntake = {
        enabled: true,
        initialized: false,
        error: error instanceof Error ? error.message : "Data OS intake initialization failed."
      };
    }
  }

  return Response.json(
    {
      data: {
        id: corpus.id,
        engine_url: `/studio/corpora/${corpus.id}/engine`,
        data_os_intake: dataOsIntake
      }
    },
    { status: 201 }
  );
}

async function resolveBrandSubject(
  appUser: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>["appUser"],
  brandId: string
) {
  const brandsResult = await listBrandsForUser(appUser, { pageSize: 500 });
  const brand = brandsResult.data.find((item) => item.id === brandId);
  if (!brand) return null;

  return {
    type: "brand" as const,
    id: brand.id,
    name: brand.displayName ?? brand.name,
    organizationId: brand.organizationId,
    industry: brand.industry,
    industrySub: brand.industrySub,
    countries: brand.countries ?? []
  };
}

async function resolveThemeSubject(
  appUser: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>["appUser"],
  themeId: string
) {
  const themesResult = await listThemesForUser(appUser, { pageSize: 500 });
  const theme = themesResult.data.find((item) => item.id === themeId && item.status !== "archived");
  if (!theme) return null;

  return {
    type: "theme" as const,
    id: theme.id,
    name: theme.name,
    organizationId: theme.organizationId,
    industry: null,
    industrySub: null,
    countries: theme.geoFocus ?? []
  };
}

async function resolveBaseCorpus(
  appUser: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>["appUser"],
  corpusId: string,
  context: {
    brandId: string | null;
    methodologySlug: string | null;
    industryTags: string[];
    geoFocus: string[];
  }
) {
  const corpora = await listReusableBaselineCorporaForUser(appUser);
  const corpus = corpora.find((item) => item.id === corpusId);
  if (!corpus) return null;
  if (!getBaselineCompatibility(corpus, context).eligible) return null;

  return corpus;
}

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitLines(value: string | undefined) {
  return (value ?? "")
    .split(/\n|\t|;/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function briefValueToText(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}
