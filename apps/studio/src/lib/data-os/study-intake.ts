import { and, eq } from "drizzle-orm";

import {
  brandOsAudiences,
  brandOsBriefs,
  brandOsLinks,
  brandOsObjectives,
  brandOsProfiles,
  brandOsSeedSets,
  brandOsSeedTerms,
  dataAssetFields,
  dataAssets,
  dataContracts,
  dataObservations,
  dataQualityResults,
  dataSources,
  knowledgeAssertionLinks,
  knowledgeAssertions,
  knowledgeChunks,
  knowledgeUsageEvents,
  lineageEdges,
  sourceSyncRuns
} from "@noisia/db";
import { buildSourceObservations } from "@noisia/query-engine";
import type { DataOsAudienceSpec, DataOsSignalSpec, StudyDataOsFieldSpecs } from "@/lib/data-os/field-specs";
import { db } from "@/lib/db";

type StudySubject = {
  type: "brand" | "theme";
  id: string;
  name: string;
  organizationId: string | null;
};

type IntakeKnowledgeSource = {
  id: string;
  title: string;
  sourceKind: string;
  rawText: string;
};

type IntakeAssertion = {
  type: string;
  text: string;
  confidence: "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
};

type IntakeBaseCorpus = {
  id: string;
  name: string | null;
  candidateType: "brand_reuse" | "industry_baseline";
  subjectLabel: string | null;
  methodologySlug: string;
  methodologyName: string;
  methodologyVersion: string;
  geoFocus: string[];
  industryTags: string[];
  includedCount: number;
  targetWindowMonths: number | null;
};

type IntakeSourceManifest = {
  name: string;
  kind?: string;
  size_bytes?: number;
  mime_type?: string;
  summary?: string;
  preview_text?: string;
  dataset_inventory?: string[];
  sheet_count?: number;
  row_count?: number;
  field_names?: string[];
  source_profile?: Record<string, unknown>;
  preview_status?: "ready" | "error";
  preview_error?: string;
};

export type InitializeDataOsStudyIntakeArgs = {
  corpusId: string;
  studyName: string;
  subject: StudySubject;
  methodologySlug: string;
  businessQuestion: string;
  studyContext: string | null;
  decisionToInform: string | null;
  audienceSegment: string | null;
  categoryContext: string | null;
  hypotheses: string | null;
  competitiveContext: string | null;
  knownTriggers: string | null;
  knownBarriers: string | null;
  strategicConstraints: string | null;
  successCriteria: string | null;
  geoFocus: string[];
  targetWindowMonths: number;
  analysisPlan: unknown;
  dataOsFieldSpecs?: StudyDataOsFieldSpecs;
  baseCorpus?: IntakeBaseCorpus | null;
  sourceManifest: IntakeSourceManifest[];
  knowledgeSources: IntakeKnowledgeSource[];
};

export type InitializeDataOsStudyIntakeResult =
  | { enabled: false; initialized: false }
  | {
      enabled: true;
      initialized: true;
      profileId: string;
      objectiveId: string;
      briefId: string;
      knowledgeSources: number;
      assertions: number;
      baselineLinks: number;
      dataSources: number;
      dataAssets: number;
      dataAssetFields: number;
      dataObservations: number;
    };

export async function initializeDataOsStudyIntake(
  args: InitializeDataOsStudyIntakeArgs
): Promise<InitializeDataOsStudyIntakeResult> {
  if (process.env.NOISIA_DATA_OS_ENABLED !== "true") {
    return { enabled: false, initialized: false };
  }

  const profileId = await upsertBrandOsProfile(args.subject);
  const objectiveId = await upsertObjective(profileId, args);
  const audienceSpecs = audienceSpecsForArgs(args);
  const audienceIds = (
    await Promise.all(audienceSpecs.map((segment) => upsertAudience(profileId, segment)))
  ).filter((id): id is string => Boolean(id));
  const primaryKnowledgeSource = args.knowledgeSources[0] ?? null;
  const briefId = await upsertBrief(profileId, objectiveId, primaryKnowledgeSource?.id ?? null, args);
  const seedSetId = await upsertSeedSet(profileId, objectiveId, args);

  await Promise.all([
    upsertBrandOsLink(profileId, "brand_os_objective", objectiveId, "study_corpus", args.corpusId, "frames"),
    upsertBrandOsLink(profileId, "brand_os_objective", objectiveId, "brand_os_brief", briefId, "briefed_by"),
    upsertBrandOsLink(profileId, "brand_os_brief", briefId, "study_corpus", args.corpusId, "frames"),
    upsertBrandOsLink(profileId, "brand_os_seed_set", seedSetId, "study_corpus", args.corpusId, "seeds"),
    ...audienceIds.map((audienceId) =>
      upsertBrandOsLink(profileId, "brand_os_objective", objectiveId, "brand_os_audience", audienceId, "targets")
    )
  ]);

  let baselineLinks = 0;
  if (args.baseCorpus) {
    const relationType = args.baseCorpus.candidateType === "brand_reuse" ? "reuses_brand_corpus" : "uses_industry_baseline";
    const baselineMetadata = buildBaselineMetadata(args.baseCorpus, args);
    await Promise.all([
      upsertBrandOsLink(profileId, "study_corpus", args.corpusId, "study_corpus", args.baseCorpus.id, relationType, baselineMetadata),
      upsertBrandOsLink(profileId, "brand_os_objective", objectiveId, "study_corpus", args.baseCorpus.id, "benchmarked_against", baselineMetadata),
      upsertBrandOsLink(profileId, "brand_os_brief", briefId, "study_corpus", args.baseCorpus.id, "uses_baseline_evidence", baselineMetadata),
      upsertBrandOsLink(profileId, "brand_os_seed_set", seedSetId, "study_corpus", args.baseCorpus.id, "extends_seed_scope", baselineMetadata),
      upsertLineageEdge("study_corpus", args.baseCorpus.id, "study_corpus", args.corpusId, "baseline_for", baselineMetadata),
      upsertLineageEdge("study_corpus", args.baseCorpus.id, "brand_os_brief", briefId, "informs", baselineMetadata),
      db.insert(knowledgeUsageEvents).values({
        usageType: "baseline_corpus_linked",
        metadata: {
          ...baselineMetadata,
          corpus_id: args.corpusId,
          base_corpus_id: args.baseCorpus.id,
          source: "new_study_form"
        }
      })
    ]);
    baselineLinks = 7;
  }

  const sourceCatalog = await catalogSourceManifestAssets(profileId, briefId, args);

  let assertions = 0;
  for (const source of args.knowledgeSources) {
    const chunkId = await upsertKnowledgeChunk(source);
    const sourceAssertions = buildAssertions(args, source);
    for (const assertion of sourceAssertions) {
      const assertionId = await upsertKnowledgeAssertion(source.id, assertion);
      assertions += 1;
      await Promise.all([
        upsertKnowledgeAssertionLink(assertionId, "brand_os_profile", profileId, "informs"),
        upsertKnowledgeAssertionLink(assertionId, "brand_os_objective", objectiveId, "informs"),
        upsertKnowledgeAssertionLink(assertionId, "brand_os_brief", briefId, "evidences"),
        db.insert(knowledgeUsageEvents).values({
          knowledgeSourceId: source.id,
          knowledgeChunkId: chunkId,
          knowledgeAssertionId: assertionId,
          usageType: "study_intake_cataloged",
          metadata: {
            corpus_id: args.corpusId,
            methodology_slug: args.methodologySlug,
            source: "new_study_form"
          }
        })
      ]);
    }
  }

  return {
    enabled: true,
    initialized: true,
    profileId,
    objectiveId,
    briefId,
    knowledgeSources: args.knowledgeSources.length,
    assertions,
    baselineLinks,
    dataSources: sourceCatalog.sources,
    dataAssets: sourceCatalog.assets,
    dataAssetFields: sourceCatalog.fields,
    dataObservations: sourceCatalog.observations
  };
}

async function upsertBrandOsProfile(subject: StudySubject) {
  const where =
    subject.type === "brand"
      ? and(eq(brandOsProfiles.brandId, subject.id), eq(brandOsProfiles.version, 1))
      : and(eq(brandOsProfiles.themeId, subject.id), eq(brandOsProfiles.version, 1));

  const [existing] = await db.select({ id: brandOsProfiles.id }).from(brandOsProfiles).where(where).limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(brandOsProfiles)
    .values({
      organizationId: subject.organizationId ?? undefined,
      brandId: subject.type === "brand" ? subject.id : undefined,
      themeId: subject.type === "theme" ? subject.id : undefined,
      name: `${subject.name} Brand OS`,
      status: "active",
      version: 1,
      metadata: { source: "new_study_form", initialized_by: "data_os_cut_1" }
    })
    .returning({ id: brandOsProfiles.id });

  if (!created) throw new Error("Data OS Brand OS profile was not created.");
  return created.id;
}

async function upsertObjective(profileId: string, args: InitializeDataOsStudyIntakeArgs) {
  const name = compact(args.businessQuestion, 180);
  const [existing] = await db
    .select({ id: brandOsObjectives.id })
    .from(brandOsObjectives)
    .where(
      and(
        eq(brandOsObjectives.brandOsProfileId, profileId),
        eq(brandOsObjectives.objectiveType, "study_objective"),
        eq(brandOsObjectives.name, name)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(brandOsObjectives)
    .values({
      brandOsProfileId: profileId,
      objectiveType: "study_objective",
      name,
      description: args.decisionToInform ?? args.businessQuestion,
      successCriteria: {
        criteria: splitList(args.successCriteria),
        decision_to_inform: args.decisionToInform,
        decision_catalog: splitList(args.decisionToInform),
        audience_segments: splitList(args.audienceSegment),
        study_context_present: Boolean(args.studyContext),
        hypotheses: splitList(args.hypotheses),
        known_triggers: splitList(args.knownTriggers),
        known_barriers: splitList(args.knownBarriers),
        strategic_constraints: splitList(args.strategicConstraints),
        data_os_field_specs: args.dataOsFieldSpecs,
        geo_focus: args.geoFocus,
        target_window_months: args.targetWindowMonths
      },
      priority: 1,
      status: "active"
    })
    .returning({ id: brandOsObjectives.id });

  if (!created) throw new Error("Data OS objective was not created.");
  return created.id;
}

async function upsertAudience(profileId: string, audienceSegment: string | DataOsAudienceSpec) {
  const spec = typeof audienceSegment === "string" ? null : audienceSegment;
  const label = typeof audienceSegment === "string" ? audienceSegment : audienceSegment.label;
  const name = compact(label, 140);
  const [existing] = await db
    .select({ id: brandOsAudiences.id })
    .from(brandOsAudiences)
    .where(and(eq(brandOsAudiences.brandOsProfileId, profileId), eq(brandOsAudiences.name, name)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(brandOsAudiences)
    .values({
      brandOsProfileId: profileId,
      name,
      description: label,
      attributes: spec
        ? {
            source: "new_study_form",
            data_os_entity: "audience_segment",
            ...spec
          }
        : { source: "new_study_form", data_os_entity: "audience_segment", ...inferAudienceAttributes(label) },
      status: "active"
    })
    .returning({ id: brandOsAudiences.id });

  return created?.id ?? null;
}

async function upsertBrief(
  profileId: string,
  objectiveId: string,
  knowledgeSourceId: string | null,
  args: InitializeDataOsStudyIntakeArgs
) {
  const [existing] = await db
    .select({ id: brandOsBriefs.id })
    .from(brandOsBriefs)
    .where(
      and(
        eq(brandOsBriefs.brandOsProfileId, profileId),
        eq(brandOsBriefs.studyCorpusId, args.corpusId),
        eq(brandOsBriefs.briefType, "study_intake"),
        eq(brandOsBriefs.title, args.studyName)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(brandOsBriefs)
    .values({
      brandOsProfileId: profileId,
      studyCorpusId: args.corpusId,
      objectiveId,
      knowledgeSourceId: knowledgeSourceId ?? undefined,
      briefType: "study_intake",
      title: args.studyName,
      summary: args.businessQuestion,
      sourceKind: "new_study_form",
      status: "active",
      metadata: {
        methodology_slug: args.methodologySlug,
        analysis_plan: args.analysisPlan,
        base_corpus_id: args.baseCorpus?.id ?? null,
        base_corpus_type: args.baseCorpus?.candidateType ?? null,
        base_corpus_policy: args.baseCorpus ? "reference_not_copy" : null,
        category_context: args.categoryContext,
        study_context: compact(args.studyContext ?? "", 1200),
        study_context_present: Boolean(args.studyContext),
        decision_catalog: splitList(args.decisionToInform),
        audience_segments: splitList(args.audienceSegment),
        data_os_field_specs: args.dataOsFieldSpecs,
        category_context_terms: splitList(args.categoryContext),
        competitive_context: args.competitiveContext,
        hypotheses: splitList(args.hypotheses),
        known_triggers: splitList(args.knownTriggers),
        known_barriers: splitList(args.knownBarriers),
        strategic_constraints: splitList(args.strategicConstraints),
        success_criteria: splitList(args.successCriteria)
      }
    })
    .returning({ id: brandOsBriefs.id });

  if (!created) throw new Error("Data OS brief was not created.");
  return created.id;
}

async function upsertSeedSet(profileId: string, objectiveId: string, args: InitializeDataOsStudyIntakeArgs) {
  const [existing] = await db
    .select({ id: brandOsSeedSets.id })
    .from(brandOsSeedSets)
    .where(
      and(
        eq(brandOsSeedSets.brandOsProfileId, profileId),
        eq(brandOsSeedSets.seedSetType, "study_intake"),
        eq(brandOsSeedSets.name, args.studyName)
      )
    )
    .limit(1);

  const seedSetId =
    existing?.id ??
    (
      await db
        .insert(brandOsSeedSets)
        .values({
          brandOsProfileId: profileId,
          name: args.studyName,
          seedSetType: "study_intake",
          objectiveId,
          status: "active",
          metadata: {
            source: "new_study_form",
            base_corpus_id: args.baseCorpus?.id ?? null,
            base_corpus_type: args.baseCorpus?.candidateType ?? null,
            data_os_field_specs: args.dataOsFieldSpecs
          }
        })
        .returning({ id: brandOsSeedSets.id })
    )[0]?.id;

  if (!seedSetId) throw new Error("Data OS seed set was not created.");

  const terms = uniqueTerms([
    args.subject.name,
    args.audienceSegment,
    ...splitList(args.categoryContext),
    ...splitList(args.hypotheses),
    ...splitList(args.knownTriggers),
    ...splitList(args.knownBarriers),
    ...splitList(args.competitiveContext),
    ...splitList(args.strategicConstraints),
    ...splitList(args.successCriteria)
  ]);

  for (const term of terms) {
    await db
      .insert(brandOsSeedTerms)
      .values({
        seedSetId,
        term,
        termType: inferSeedTermType(term, args),
        weight: "1",
        metadata: {
          source: "new_study_form",
          data_os_role: inferSeedDataOsRole(term, args),
          decision_keys: args.dataOsFieldSpecs?.decisions.map((decision) => decision.key) ?? [],
          audience_keys: args.dataOsFieldSpecs?.audiences.map((audience) => audience.key) ?? []
        }
      })
      .onConflictDoNothing();
  }

  return seedSetId;
}

async function catalogSourceManifestAssets(
  profileId: string,
  briefId: string,
  args: InitializeDataOsStudyIntakeArgs
) {
  let sources = 0;
  let assets = 0;
  let fields = 0;
  let observations = 0;

  for (const [index, source] of args.sourceManifest.entries()) {
    const sourceName = compact(source.name || `Study source ${index + 1}`, 180);
    const sourceType = source.kind || inferSourceKind(source);
    const status = source.preview_status === "error" ? "preview_failed" : "profiled";
    const metadata = buildSourceMetadata(source, index, args);
    const sourceProfile = readSourceProfile(source);

    const [createdSource] = await db
      .insert(dataSources)
      .values({
        studyCorpusId: args.corpusId,
        organizationId: args.subject.organizationId ?? undefined,
        brandId: args.subject.type === "brand" ? args.subject.id : undefined,
        sourceType,
        provider: inferSourceProvider(source),
        connectionMethod: "manual_upload",
        name: sourceName,
        mapping: {
          mime_type: source.mime_type ?? null,
          size_bytes: source.size_bytes ?? null,
          sheet_count: source.sheet_count ?? null,
          row_count: source.row_count ?? null,
          field_names: sanitizeFieldNames(source.field_names),
          dataset_inventory: source.dataset_inventory ?? [],
          preview_text_available: Boolean(source.preview_text),
          source_profile: sourceProfile,
          datasets: sourceProfile?.datasets ?? [],
          metrics: sourceProfile?.source_metrics ?? [],
          dimensions: sourceProfile?.source_dimensions ?? [],
          time_axes: sourceProfile?.source_time_axes ?? [],
          join_keys: sourceProfile?.source_join_keys ?? [],
          chart_readiness: sourceProfile?.chart_readiness ?? null,
          materialization_policy: sourceProfile?.materialization_policy ?? "profile_now_materialize_later"
        },
        mappingVersion: 1,
        role: {
          input_stage: "new_study_sources",
          data_os_role: sourceProfile?.chart_readiness?.time_series ? "analytical_source" : "context_source",
          objective_context: true,
          query_context: true,
          analysis_context: true,
          chart_context: Boolean(sourceProfile?.chart_readiness?.time_series),
          storage_policy: "profile_now_materialize_later"
        },
        status,
        visibility: "internal"
      })
      .returning({ id: dataSources.id });

    if (!createdSource) continue;
    sources += 1;

    const [syncRun] = await db.insert(sourceSyncRuns).values({
      dataSourceId: createdSource.id,
      finishedAt: new Date(),
      status: source.preview_status === "error" ? "failed" : "completed",
      recordsTotal: source.row_count ?? null,
      recordsValid: source.preview_status === "error" ? 0 : source.row_count ?? null,
      recordsFailed: source.preview_status === "error" ? source.row_count ?? 1 : 0,
      errorSummary: source.preview_status === "error" ? { message: source.preview_error ?? "Preview failed." } : {}
    }).returning({ id: sourceSyncRuns.id });

    const [createdAsset] = await db
      .insert(dataAssets)
      .values({
        organizationId: args.subject.organizationId ?? undefined,
        brandId: args.subject.type === "brand" ? args.subject.id : undefined,
        themeId: args.subject.type === "theme" ? args.subject.id : undefined,
        studyCorpusId: args.corpusId,
        dataSourceId: createdSource.id,
        assetKind: inferAssetKind(source),
        layer: "raw",
        name: buildAssetName(sourceName, index),
        description: source.summary ? compact(source.summary, 700) : null,
        sensitivity: "internal",
        status: status === "profiled" ? "active" : "needs_review",
        rowCount: source.row_count ?? null,
        metadata
      })
      .returning({ id: dataAssets.id });

    if (!createdAsset) continue;
    assets += 1;

    const fieldNames = sanitizeFieldNames(source.field_names).slice(0, 120);
    for (const [fieldIndex, fieldName] of fieldNames.entries()) {
      await db
        .insert(dataAssetFields)
        .values({
          dataAssetId: createdAsset.id,
          fieldName,
          fieldType: sourceProfileField(sourceProfile, fieldName)?.field_type ?? inferFieldType(fieldName),
          semanticType: sourceProfileField(sourceProfile, fieldName)?.semantic_type ?? inferSemanticType(fieldName),
          nullable: null,
          description: null,
          examples: sourceProfileField(sourceProfile, fieldName)?.examples ?? [],
          metadata: {
            source: "new_study_form",
            ordinal: fieldIndex,
            inferred_from: "source_preview",
            data_os_field_profile: sourceProfileField(sourceProfile, fieldName) ?? null,
            dataset_keys: sourceProfileDatasetsForField(sourceProfile, fieldName)
          }
        })
        .onConflictDoNothing();
      fields += 1;
    }

    await upsertIntakeDataContract({
      dataAssetId: createdAsset.id,
      source,
      sourceProfile,
      active: status === "profiled"
    });
    await upsertIntakeQualityResult({
      dataAssetId: createdAsset.id,
      source,
      sourceProfile,
      fieldCount: fieldNames.length
    });

    await Promise.all([
      upsertBrandOsLink(profileId, "brand_os_brief", briefId, "data_source", createdSource.id, "uses_source", metadata),
      upsertBrandOsLink(profileId, "brand_os_brief", briefId, "data_asset", createdAsset.id, "uses_asset", metadata),
      upsertLineageEdge("data_source", createdSource.id, "study_corpus", args.corpusId, "feeds", metadata),
      upsertLineageEdge("data_source", createdSource.id, "data_asset", createdAsset.id, "materializes", metadata),
      upsertLineageEdge("data_asset", createdAsset.id, "brand_os_brief", briefId, "informs", metadata),
      db.insert(knowledgeUsageEvents).values({
        usageType: "study_source_profiled",
        metadata: {
          ...metadata,
          corpus_id: args.corpusId,
          data_source_id: createdSource.id,
          data_asset_id: createdAsset.id
        }
      })
    ]);

    observations += await materializePreviewObservations({
      sourceName,
      sourceProfile,
      dataSourceId: createdSource.id,
      dataAssetId: createdAsset.id,
      sourceSyncRunId: syncRun?.id ?? null,
      args
    });
  }

  return { sources, assets, fields, observations };
}

async function upsertIntakeDataContract(args: {
  dataAssetId: string;
  source: IntakeSourceManifest;
  sourceProfile: ReturnType<typeof readSourceProfile>;
  active: boolean;
}) {
  const schemaContract = {
    contract_version: 1,
    datasets: args.sourceProfile?.datasets ?? [],
    declared_fields: sanitizeFieldNames(args.source.field_names),
    source_format: args.source.mime_type ?? inferSourceKind(args.source)
  };
  const qualityContract = {
    required: ["record_identity", "numeric_metric_value"],
    conditional: ["period_start_for_time_series", "join_key_for_entity_series"],
    review_policy: "reject_invalid_metrics_review_missing_time"
  };
  const semanticContract = {
    metrics: args.sourceProfile?.source_metrics ?? [],
    dimensions: args.sourceProfile?.source_dimensions ?? [],
    time_axes: args.sourceProfile?.source_time_axes ?? [],
    join_keys: args.sourceProfile?.source_join_keys ?? [],
    chart_readiness: args.sourceProfile?.chart_readiness ?? null,
    canonical_target: "data_observations"
  };

  await db
    .insert(dataContracts)
    .values({
      dataAssetId: args.dataAssetId,
      contractName: "study_source_contract",
      version: 1,
      status: args.active ? "active" : "draft",
      schemaContract,
      qualityContract,
      freshnessContract: { mode: "manual_upload", refresh: "on_new_file" },
      semanticContract
    })
    .onConflictDoUpdate({
      target: [dataContracts.dataAssetId, dataContracts.contractName, dataContracts.version],
      set: {
        status: args.active ? "active" : "draft",
        schemaContract,
        qualityContract,
        freshnessContract: { mode: "manual_upload", refresh: "on_new_file" },
        semanticContract,
        updatedAt: new Date()
      }
    });
}

async function upsertIntakeQualityResult(args: {
  dataAssetId: string;
  source: IntakeSourceManifest;
  sourceProfile: ReturnType<typeof readSourceProfile>;
  fieldCount: number;
}) {
  const failed = args.source.preview_status === "error";
  const hasSchema = args.fieldCount > 0 || Boolean(args.sourceProfile?.datasets?.length);
  const status = failed ? "fail" : hasSchema ? "pass" : "warn";

  await db
    .insert(dataQualityResults)
    .values({
      dataAssetId: args.dataAssetId,
      resultKey: "source_preview_profile",
      status,
      observedValue: {
        preview_status: args.source.preview_status ?? "ready",
        rows: args.source.row_count ?? null,
        fields: args.fieldCount,
        datasets: args.sourceProfile?.datasets?.length ?? 0,
        time_series: args.sourceProfile?.chart_readiness?.time_series ?? false
      },
      expectedValue: {
        preview_status: "ready",
        schema_profiled: true,
        canonical_target: "data_observations"
      },
      sampleRefs: args.source.preview_error ? [{ error: args.source.preview_error }] : []
    })
    .onConflictDoUpdate({
      target: [dataQualityResults.dataAssetId, dataQualityResults.resultKey],
      set: {
        status,
        observedValue: {
          preview_status: args.source.preview_status ?? "ready",
          rows: args.source.row_count ?? null,
          fields: args.fieldCount,
          datasets: args.sourceProfile?.datasets?.length ?? 0,
          time_series: args.sourceProfile?.chart_readiness?.time_series ?? false
        },
        expectedValue: {
          preview_status: "ready",
          schema_profiled: true,
          canonical_target: "data_observations"
        },
        checkedAt: new Date()
      }
    });
}

async function upsertKnowledgeChunk(source: IntakeKnowledgeSource) {
  const [existing] = await db
    .select({ id: knowledgeChunks.id })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.knowledgeSourceId, source.id), eq(knowledgeChunks.chunkIndex, 0)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(knowledgeChunks)
    .values({
      knowledgeSourceId: source.id,
      chunkIndex: 0,
      chunkText: compact(source.rawText, 5000),
      tokenCount: estimateTokens(source.rawText),
      embeddingStatus: "pending",
      metadata: { source_kind: source.sourceKind, source: "new_study_form" }
    })
    .returning({ id: knowledgeChunks.id });

  if (!created) throw new Error("Data OS knowledge chunk was not created.");
  return created.id;
}

async function upsertKnowledgeAssertion(
  knowledgeSourceId: string,
  assertion: { type: string; text: string; confidence: "low" | "medium" | "high"; metadata?: Record<string, unknown> }
) {
  const [existing] = await db
    .select({ id: knowledgeAssertions.id })
    .from(knowledgeAssertions)
    .where(
      and(
        eq(knowledgeAssertions.knowledgeSourceId, knowledgeSourceId),
        eq(knowledgeAssertions.assertionType, assertion.type),
        eq(knowledgeAssertions.assertionText, assertion.text)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(knowledgeAssertions)
    .values({
      knowledgeSourceId,
      assertionType: assertion.type,
      assertionText: assertion.text,
      confidence: assertion.confidence,
      status: "candidate",
      evidence: [{ source: "new_study_form", excerpt: compact(assertion.text, 280) }],
      metadata: { initialized_by: "data_os_cut_1", ...(assertion.metadata ?? {}) }
    })
    .returning({ id: knowledgeAssertions.id });

  if (!created) throw new Error("Data OS knowledge assertion was not created.");
  return created.id;
}

async function upsertBrandOsLink(
  profileId: string,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relationType: string,
  metadata: Record<string, unknown> = {}
) {
  await db
    .insert(brandOsLinks)
    .values({
      brandOsProfileId: profileId,
      sourceType,
      sourceId,
      targetType,
      targetId,
      relationType,
      metadata: { source: "new_study_form", ...metadata }
    })
    .onConflictDoNothing();
}

async function upsertLineageEdge(
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relationType: string,
  metadata: Record<string, unknown>
) {
  await db
    .insert(lineageEdges)
    .values({
      sourceType,
      sourceId,
      targetType,
      targetId,
      relationType,
      metadata: { source: "new_study_form", ...metadata }
    })
    .onConflictDoNothing();
}

async function upsertKnowledgeAssertionLink(
  knowledgeAssertionId: string,
  targetType: string,
  targetId: string,
  relationType: string
) {
  await db
    .insert(knowledgeAssertionLinks)
    .values({
      knowledgeAssertionId,
      targetType,
      targetId,
      relationType,
      metadata: { source: "new_study_form" }
    })
    .onConflictDoNothing();
}

function buildBaselineMetadata(baseCorpus: IntakeBaseCorpus, args: InitializeDataOsStudyIntakeArgs) {
  return {
    baseline_type: baseCorpus.candidateType,
    baseline_name: baseCorpus.name,
    baseline_subject: baseCorpus.subjectLabel,
    baseline_methodology_slug: baseCorpus.methodologySlug,
    baseline_methodology: `${baseCorpus.methodologyName} · ${baseCorpus.methodologyVersion}`,
    baseline_geo_focus: baseCorpus.geoFocus,
    baseline_industry_tags: baseCorpus.industryTags,
    baseline_included_mentions: baseCorpus.includedCount,
    baseline_target_window_months: baseCorpus.targetWindowMonths,
    study_methodology_slug: args.methodologySlug,
    link_policy: "reference_not_copy"
  };
}

function buildSourceMetadata(source: IntakeSourceManifest, index: number, args: InitializeDataOsStudyIntakeArgs) {
  return {
    source: "new_study_form",
    source_index: index,
    source_name: source.name,
    source_kind: source.kind ?? inferSourceKind(source),
    mime_type: source.mime_type ?? null,
    size_bytes: source.size_bytes ?? null,
    summary: source.summary ? compact(source.summary, 1200) : null,
    sheet_count: source.sheet_count ?? null,
    row_count: source.row_count ?? null,
    field_count: sanitizeFieldNames(source.field_names).length,
    field_names: sanitizeFieldNames(source.field_names).slice(0, 60),
    dataset_inventory: source.dataset_inventory ?? [],
    source_profile: readSourceProfile(source),
    canonical_datasets: readSourceProfile(source)?.datasets ?? [],
    canonical_metrics: readSourceProfile(source)?.source_metrics ?? [],
    canonical_dimensions: readSourceProfile(source)?.source_dimensions ?? [],
    canonical_time_axes: readSourceProfile(source)?.source_time_axes ?? [],
    canonical_join_keys: readSourceProfile(source)?.source_join_keys ?? [],
    chart_readiness: readSourceProfile(source)?.chart_readiness ?? null,
    preview_status: source.preview_status ?? "ready",
    preview_error: source.preview_error ?? null,
    methodology_slug: args.methodologySlug,
    target_window_months: args.targetWindowMonths
  };
}

function readSourceProfile(source: IntakeSourceManifest) {
  const profile = source.source_profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  return profile as {
    datasets?: Array<{
      key?: string;
      name?: string;
      semantic_role?: string;
      sample_records?: Record<string, unknown>[];
      fields?: Array<Record<string, unknown> & { name?: string; field_type?: string; semantic_type?: string; examples?: string[] }>;
    }>;
    source_metrics?: unknown[];
    source_dimensions?: unknown[];
    source_time_axes?: unknown[];
    source_join_keys?: unknown[];
    chart_readiness?: { time_series?: boolean; metric_count?: number; time_axis_count?: number; compatible_grains?: string[] };
    materialization_policy?: string;
  };
}

async function materializePreviewObservations(args: {
  sourceName: string;
  sourceProfile: ReturnType<typeof readSourceProfile>;
  dataSourceId: string;
  dataAssetId: string;
  sourceSyncRunId: string | null;
  args: InitializeDataOsStudyIntakeArgs;
}) {
  if (!args.sourceProfile?.datasets?.length) return 0;

  const observationRows = buildSourceObservations({
    sourceName: args.sourceName,
    maxRowsPerDataset: 25,
    datasets: args.sourceProfile.datasets.map((dataset) => ({
      datasetKey: String(dataset.key ?? dataset.name ?? "dataset"),
      datasetName: String(dataset.name ?? dataset.key ?? "Dataset"),
      datasetRole: typeof dataset.semantic_role === "string" ? dataset.semantic_role : null,
      records: Array.isArray(dataset.sample_records) ? dataset.sample_records : [],
      fields: (dataset.fields ?? [])
        .filter((field): field is Record<string, unknown> & { name: string } => typeof field.name === "string")
        .map((field) => ({
          name: field.name,
          semantic_type: stringOrUndefined(field.semantic_type),
          metric_role: stringOrUndefined(field.metric_role),
          dimension_role: stringOrUndefined(field.dimension_role),
          field_type: stringOrUndefined(field.field_type)
        }))
    }))
  });

  if (observationRows.length === 0) return 0;

  let inserted = 0;
  for (const chunk of chunkArray(observationRows, 100)) {
    await db
      .insert(dataObservations)
      .values(chunk.map((row) => ({
        organizationId: args.args.subject.organizationId ?? undefined,
        brandId: args.args.subject.type === "brand" ? args.args.subject.id : undefined,
        themeId: args.args.subject.type === "theme" ? args.args.subject.id : undefined,
        studyCorpusId: args.args.corpusId,
        dataSourceId: args.dataSourceId,
        dataAssetId: args.dataAssetId,
        sourceSyncRunId: args.sourceSyncRunId ?? undefined,
        datasetKey: row.datasetKey,
        datasetName: row.datasetName,
        datasetRole: row.datasetRole,
        rowIndex: row.rowIndex,
        recordHash: row.recordHash,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        periodGrain: row.periodGrain,
        entityType: row.entityType,
        entityKey: row.entityKey,
        entityLabel: row.entityLabel,
        metricKey: row.metricKey,
        metricFamily: row.metricFamily,
        metricValue: row.metricValue,
        metricUnit: row.metricUnit,
        dimensions: row.dimensions,
        rawRecord: row.rawRecord,
        lineage: {
          ...row.lineage,
          materialized_from: "source_preview",
          storage_policy: "sample_until_real_upload"
        },
        qualityStatus: row.periodStart ? "accepted" : "needs_mapping_review"
      })))
      .onConflictDoNothing();
    inserted += chunk.length;
  }

  return inserted;
}

function sourceProfileField(profile: ReturnType<typeof readSourceProfile>, fieldName: string) {
  const normalized = normalizeFieldName(fieldName);
  return profile?.datasets
    ?.flatMap((dataset) => dataset.fields ?? [])
    .find((field) => normalizeFieldName(String(field.name ?? "")) === normalized) ?? null;
}

function sourceProfileDatasetsForField(profile: ReturnType<typeof readSourceProfile>, fieldName: string) {
  const normalized = normalizeFieldName(fieldName);
  return (profile?.datasets ?? [])
    .filter((dataset) => (dataset.fields ?? []).some((field) => normalizeFieldName(String(field.name ?? "")) === normalized))
    .map((dataset) => dataset.key ?? dataset.name)
    .filter(Boolean);
}

function sanitizeFieldNames(fieldNames: string[] | undefined) {
  return Array.from(
    new Set(
      (fieldNames ?? [])
        .map((fieldName) => compact(String(fieldName), 120))
        .filter(Boolean)
    )
  );
}

function inferSourceKind(source: IntakeSourceManifest) {
  const name = source.name.toLowerCase();
  if (source.mime_type?.includes("spreadsheet") || source.mime_type?.includes("excel") || /\.(xlsx|xls)$/i.test(name)) {
    return "spreadsheet_archive";
  }
  if (source.mime_type?.includes("csv") || /\.csv$/i.test(name)) return "tabular_csv";
  if (source.mime_type?.includes("pdf") || /\.pdf$/i.test(name)) return "document_pdf";
  return "uploaded_source";
}

function inferSourceProvider(source: IntakeSourceManifest) {
  const normalized = `${source.kind ?? ""} ${source.name}`.toLowerCase();
  if (normalized.includes("meta") || normalized.includes("facebook") || normalized.includes("instagram")) return "meta";
  if (normalized.includes("tiktok")) return "tiktok";
  if (normalized.includes("google") || normalized.includes("search")) return "google";
  if (normalized.includes("sentione") || normalized.includes("social listening")) return "social_listening";
  if (normalized.includes("customer") || normalized.includes("ticket")) return "customer_service";
  return "manual_upload";
}

function inferAssetKind(source: IntakeSourceManifest) {
  const sourceKind = source.kind ?? inferSourceKind(source);
  if (sourceKind.includes("spreadsheet")) return "workbook";
  if (sourceKind.includes("csv") || sourceKind.includes("tabular")) return "table";
  if (sourceKind.includes("pdf") || sourceKind.includes("document")) return "document";
  return "source_profile";
}

function buildAssetName(sourceName: string, index: number) {
  return compact(`${sourceName} · source ${index + 1}`, 220);
}

function inferFieldType(fieldName: string) {
  const normalized = normalizeFieldName(fieldName);
  if (/\b(date|fecha|month|mes|year|ano|año|week|semana)\b/.test(normalized)) return "date_or_period";
  if (/\b(id|sku|ean|uuid|code|codigo|código)\b/.test(normalized)) return "identifier";
  if (/\b(price|precio|cost|costo|venta|sales|revenue|margen|margin|qty|quantity|cantidad|total)\b/.test(normalized)) {
    return "numeric";
  }
  return "text";
}

function inferSemanticType(fieldName: string) {
  const normalized = normalizeFieldName(fieldName);
  if (/\b(sku|ean|product|producto|descripcion|descripción)\b/.test(normalized)) return "product";
  if (/\b(price|precio|cost|costo|venta|sales|revenue|margen|margin)\b/.test(normalized)) return "commercial_metric";
  if (/\b(month|mes|year|ano|año|week|semana|fecha|date)\b/.test(normalized)) return "time";
  if (/\b(category|categoria|categoría|supercategoria|brand|marca)\b/.test(normalized)) return "taxonomy";
  return "attribute";
}

function normalizeFieldName(fieldName: string) {
  return fieldName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildAssertions(args: InitializeDataOsStudyIntakeArgs, source: IntakeKnowledgeSource): IntakeAssertion[] {
  const assertions: Array<IntakeAssertion | null> = [
    { type: "study_objective", text: args.businessQuestion, confidence: "high" as const },
    ...(args.dataOsFieldSpecs?.decisions ?? splitList(args.decisionToInform).map((text) => ({ label: text, key: compact(text, 80) }))).map((decision) => ({
      type: "decision_area",
      text: decision.label,
      confidence: "high" as const,
      metadata: { data_os_spec: decision }
    })),
    ...audienceSpecsForArgs(args).map((audience) => ({
      type: "audience_segment",
      text: typeof audience === "string" ? audience : audience.label,
      confidence: "medium" as const,
      metadata: { data_os_spec: audience }
    })),
    args.studyContext ? { type: "study_context", text: compact(args.studyContext, 1200), confidence: "medium" as const } : null,
    args.categoryContext ? { type: "category_context", text: args.categoryContext, confidence: "medium" as const } : null,
    ...signalSpecsForArgs(args, "hypotheses", "hypothesis").map((signal) => ({ type: "initial_hypothesis", text: signal.label, confidence: "medium" as const, metadata: { data_os_spec: signal } })),
    ...splitList(args.competitiveContext).map((text) => ({ type: "competitive_context", text, confidence: "medium" as const })),
    ...signalSpecsForArgs(args, "triggers", "trigger").map((signal) => ({ type: "trigger_hypothesis", text: signal.label, confidence: "medium" as const, metadata: { data_os_spec: signal } })),
    ...signalSpecsForArgs(args, "barriers", "barrier").map((signal) => ({ type: "barrier_hypothesis", text: signal.label, confidence: "medium" as const, metadata: { data_os_spec: signal } })),
    ...signalSpecsForArgs(args, "constraints", "constraint").map((signal) => ({ type: "constraint", text: signal.label, confidence: "medium" as const, metadata: { data_os_spec: signal } })),
    ...splitList(args.successCriteria).map((text) => ({ type: "success_criteria", text, confidence: "medium" as const }))
  ];

  const filtered = assertions.filter((item): item is IntakeAssertion => Boolean(item?.text.trim()));

  if (filtered.length > 0) return filtered.slice(0, 40);
  return [{ type: "summary", text: source.title, confidence: "low" as const }];
}

function audienceSpecsForArgs(args: InitializeDataOsStudyIntakeArgs): Array<string | DataOsAudienceSpec> {
  const specs = args.dataOsFieldSpecs?.audiences ?? [];
  if (specs.length > 0) return specs;
  return splitList(args.audienceSegment);
}

function signalSpecsForArgs(
  args: InitializeDataOsStudyIntakeArgs,
  key: "hypotheses" | "barriers" | "triggers" | "constraints",
  signalType: DataOsSignalSpec["signal_type"]
): DataOsSignalSpec[] | Array<{ label: string; signal_type: DataOsSignalSpec["signal_type"] }> {
  const specs = args.dataOsFieldSpecs?.[key] ?? [];
  if (specs.length > 0) return specs;
  const source =
    key === "hypotheses"
      ? args.hypotheses
      : key === "barriers"
        ? args.knownBarriers
        : key === "triggers"
          ? args.knownTriggers
          : args.strategicConstraints;
  return splitList(source).map((label) => ({ label, signal_type: signalType }));
}

function inferSeedTermType(term: string, args: InitializeDataOsStudyIntakeArgs) {
  const lower = term.toLowerCase();
  if (args.dataOsFieldSpecs?.audiences.some((audience) => audience.label.toLowerCase() === lower)) return "audience_segment";
  if (args.dataOsFieldSpecs?.triggers.some((trigger) => trigger.label.toLowerCase() === lower)) return "trigger";
  if (args.dataOsFieldSpecs?.barriers.some((barrier) => barrier.label.toLowerCase() === lower)) return "barrier";
  if (args.dataOsFieldSpecs?.hypotheses.some((hypothesis) => hypothesis.label.toLowerCase() === lower)) return "hypothesis";
  if (args.dataOsFieldSpecs?.success_metrics.some((metric) => metric.label.toLowerCase() === lower)) return "success_metric";
  return "keyword";
}

function inferSeedDataOsRole(term: string, args: InitializeDataOsStudyIntakeArgs) {
  const termType = inferSeedTermType(term, args);
  if (termType === "audience_segment") return "segment_seed";
  if (termType === "trigger") return "trigger_seed";
  if (termType === "barrier") return "barrier_seed";
  if (termType === "hypothesis") return "hypothesis_seed";
  if (termType === "success_metric") return "measurement_seed";
  return "context_seed";
}

function splitList(value: string | null | undefined) {
  return (value ?? "")
    .split(/\n|\t|;/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function inferAudienceAttributes(audienceSegment: string) {
  const normalized = audienceSegment
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const ageRange = audienceSegment.match(/\b\d{2}\s*[-–]\s*\d{2}\b/)?.[0] ?? null;
  const species = /\bgato|cat|felin/.test(normalized)
    ? "cat"
    : /\bperro|dog|canin/.test(normalized)
      ? "dog"
      : /\bmascota|pet\b/.test(normalized)
        ? "pet"
        : null;
  const lifecycle = /\b(first|primera compra|nuevo|prospect|sin experiencia)\b/.test(normalized)
    ? "prospect_or_first_purchase"
    : /\b(0 recompra|sin recompra|no recurrente|no recurrence)\b/.test(normalized)
      ? "non_recurrent"
      : /\b(member|miembro|membres)\b/.test(normalized)
        ? "member"
        : /\b(recurrente|retencion|recompra)\b/.test(normalized)
          ? "retention"
          : null;
  const geoMarket = /\b(cdmx|valle de mexico|valle de mexico|mexico city)\b/.test(normalized)
    ? "CDMX / Valle de Mexico"
    : /\b(mx|mexico|mexicano)\b/.test(normalized)
      ? "Mexico"
      : null;
  const intent = /\b(premium|salud|health|croqueta|alimento|food|convenien|ahorro|saving|descuento)\b/.test(normalized)
    ? "category_intent"
    : null;
  return {
    age_range: ageRange,
    species,
    lifecycle_stage: lifecycle,
    geo_market: geoMarket,
    intent
  };
}

function uniqueTerms(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.flatMap((value) => splitList(value)).map(compact).filter(Boolean))).slice(0, 50);
}

function compact(value: string, maxLength = 240) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3)}...` : clean;
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}
