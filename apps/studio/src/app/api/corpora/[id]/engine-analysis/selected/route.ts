import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { engineAnalyses, methodologies, queryPacks, studyCorpora, tbAnalyses } from "@noisia/db";
import {
  ENGINE_PIPELINE_VERSION,
  engineRuntimeDisabledMessage,
  engineLensParamsFromTbMeta,
  isEngineFixtureCodingEnabled,
  isEngineLlmEnabled,
  isEngineRuntimeEnabled
} from "@noisia/query-engine";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { createCorpusSnapshot } from "@/lib/corpus/snapshots";
import { getCorpusForUser, listCorpusEntitiesForCorpus, listImportBatchesForCorpus } from "@/lib/data/corpora";
import { isUndefinedTableError } from "@/lib/db/errors";
import { db } from "@/lib/db";
import { shouldReuseEngineAnalysis, validateEngineLaunchRequest } from "@/lib/engine/launch-guards";
import { selectedEngineRuntimeLenses } from "@/lib/engine/selected-lenses";
import { validateEngineQueryPackCoverage } from "@/lib/engine/query-pack-validation";
import { getEngineAnalysisQueue } from "@/lib/queue/engine-analysis";

const launchSelectedSchema = z.object({
  force: z.boolean().optional(),
  params: z.record(z.unknown()).optional()
});

const reusableStatuses = ["queued", "running", "needs_review", "approved"] as const;
const forceReusableStatuses = ["queued", "running"] as const;

type LensLaunchStatus = {
  methodology_slug: string;
  status: "ready" | "queued" | "running" | "needs_review" | "approved" | "failed" | "blocked" | "missing" | "not_started";
  engine_analysis_id: string | null;
  current_step: string | null;
  message: string | null;
  query_pack_validation?: ReturnType<typeof validateEngineQueryPackCoverage> | null;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  try {
    const analysisPlan = await loadAnalysisPlan(corpus.id);
    const selectedLenses = selectedEngineRuntimeLenses(analysisPlan);
    const [entities, importBatchRows, queryPackRows] = await Promise.all([
      listCorpusEntitiesForCorpus(corpus.id),
      listImportBatchesForCorpus(corpus.id),
      db
        .select({
          id: queryPacks.id,
          lensSlug: queryPacks.lensSlug,
          signalIntent: queryPacks.signalIntent,
          scope: queryPacks.scope,
          status: queryPacks.status,
          mentionsReturned: queryPacks.mentionsReturned,
          linkedMentionCount: sql<number>`(
            SELECT COUNT(DISTINCT mqs.mention_id)::int
            FROM mention_query_sources mqs
            JOIN mentions mn ON mn.id = mqs.mention_id
            WHERE mqs.query_pack_id = ${sql.raw('"query_packs"."id"')}
              AND mn.inclusion_status = 'included'
          )`,
          directMentionCount: sql<number>`(
            SELECT COUNT(DISTINCT mqs.mention_id)::int
            FROM mention_query_sources mqs
            JOIN mentions mn ON mn.id = mqs.mention_id
            WHERE mqs.query_pack_id = ${sql.raw('"query_packs"."id"')}
              AND mqs.match_reason = 'csv_import_batch'
              AND mn.inclusion_status = 'included'
          )`,
          sharedMentionCount: sql<number>`(
            SELECT COUNT(DISTINCT mqs.mention_id)::int
            FROM mention_query_sources mqs
            JOIN mentions mn ON mn.id = mqs.mention_id
            WHERE mqs.query_pack_id = ${sql.raw('"query_packs"."id"')}
              AND COALESCE(mqs.match_reason, '') <> 'csv_import_batch'
              AND mn.inclusion_status = 'included'
          )`
        })
        .from(queryPacks)
        .where(eq(queryPacks.studyCorpusId, corpus.id))
    ]);
    const coverageInput = buildCoverageInput(corpus, entities, importBatchRows, queryPackRows);
    const statuses = await listSelectedLensStatuses(corpus.id, selectedLenses, coverageInput);

    return Response.json({
      ok: true,
      runtimeEnabled: isEngineRuntimeEnabled(),
      fixtureCodingEnabled: isEngineFixtureCodingEnabled(),
      llmEnabled: isEngineLlmEnabled(),
      selected_lenses: selectedLenses,
      statuses
    });
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return Response.json({
      ok: false,
      unavailable: true,
      runtimeEnabled: isEngineRuntimeEnabled(),
      message: "Engine beta schema is not migrated yet.",
      selected_lenses: [],
      statuses: []
    });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  if (!isEngineRuntimeEnabled()) {
    return Response.json(
      {
        error: "engine_runtime_disabled",
        message: engineRuntimeDisabledMessage()
      },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const parsed = launchSelectedSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  const allowFixtureCoding = parsed.data.params?.allow_fixture_coding === true;
  if (!allowFixtureCoding && (!isEngineLlmEnabled() || !process.env.ANTHROPIC_API_KEY)) {
    return Response.json(
      {
        error: "engine_llm_disabled",
        message: "Los lentes seleccionados requieren Claude real. Habilita NOISIA_ENGINE_LLM_ENABLED=true y ANTHROPIC_API_KEY antes de correrlos.",
        runtime: runtimeSummary()
      },
      { status: 403 }
    );
  }

  try {
    const analysisPlan = await loadAnalysisPlan(corpus.id);
    const selectedLenses = selectedEngineRuntimeLenses(analysisPlan);
    if (selectedLenses.length === 0) {
      return Response.json({
        ok: true,
        message: "No hay lentes engine seleccionados en el plan del estudio.",
        selected_lenses: [],
        created: [],
        skipped: [],
        blocked: []
      });
    }

    const [methodologyRows, existingRows, entities, importBatchRows, queryPackRows] = await Promise.all([
      db
        .select({
          slug: methodologies.slug,
          version: methodologies.version,
          status: methodologies.status
        })
        .from(methodologies)
        .where(inArray(methodologies.slug, selectedLenses))
        .orderBy(desc(methodologies.version)),
      db
        .select({
          id: engineAnalyses.id,
          methodologySlug: engineAnalyses.methodologySlug,
          status: engineAnalyses.status,
          currentStep: engineAnalyses.currentStep,
          createdAt: engineAnalyses.createdAt,
          retrievedUnits: sql<number>`COALESCE((${engineAnalyses.metaJson}->'retrieval'->>'retrieved_units')::int, 0)`,
          codingProvider: sql<string | null>`${engineAnalyses.metaJson}->'engine_coding'->>'provider'`,
          codingFixture: sql<boolean | null>`CASE
            WHEN ${engineAnalyses.metaJson}->'engine_coding' ? 'fixture'
            THEN (${engineAnalyses.metaJson}->'engine_coding'->>'fixture')::boolean
            ELSE NULL
          END`
        })
        .from(engineAnalyses)
        .where(and(
          eq(engineAnalyses.studyCorpusId, corpus.id),
          inArray(engineAnalyses.methodologySlug, selectedLenses),
          parsed.data.force ? inArray(engineAnalyses.status, forceReusableStatuses) : inArray(engineAnalyses.status, reusableStatuses)
        ))
        .orderBy(desc(engineAnalyses.createdAt)),
      listCorpusEntitiesForCorpus(corpus.id),
      listImportBatchesForCorpus(corpus.id),
      db
        .select({
          id: queryPacks.id,
          lensSlug: queryPacks.lensSlug,
          signalIntent: queryPacks.signalIntent,
          scope: queryPacks.scope,
          status: queryPacks.status,
          mentionsReturned: queryPacks.mentionsReturned,
          linkedMentionCount: sql<number>`(
            SELECT COUNT(DISTINCT mqs.mention_id)::int
            FROM mention_query_sources mqs
            JOIN mentions mn ON mn.id = mqs.mention_id
            WHERE mqs.query_pack_id = ${sql.raw('"query_packs"."id"')}
              AND mn.inclusion_status = 'included'
          )`,
          directMentionCount: sql<number>`(
            SELECT COUNT(DISTINCT mqs.mention_id)::int
            FROM mention_query_sources mqs
            JOIN mentions mn ON mn.id = mqs.mention_id
            WHERE mqs.query_pack_id = ${sql.raw('"query_packs"."id"')}
              AND mqs.match_reason = 'csv_import_batch'
              AND mn.inclusion_status = 'included'
          )`,
          sharedMentionCount: sql<number>`(
            SELECT COUNT(DISTINCT mqs.mention_id)::int
            FROM mention_query_sources mqs
            JOIN mentions mn ON mn.id = mqs.mention_id
            WHERE mqs.query_pack_id = ${sql.raw('"query_packs"."id"')}
              AND COALESCE(mqs.match_reason, '') <> 'csv_import_batch'
              AND mn.inclusion_status = 'included'
          )`
        })
        .from(queryPacks)
        .where(eq(queryPacks.studyCorpusId, corpus.id))
    ]);

    const methodologyBySlug = new Map(methodologyRows.map((row) => [row.slug, row]));
    const existingBySlug = new Map<string, typeof existingRows[number]>();
    for (const row of existingRows) {
      if (!existingBySlug.has(row.methodologySlug)) existingBySlug.set(row.methodologySlug, row);
    }

    const coverageInput = {
      brandId: corpus.brandId,
      themeId: corpus.themeId,
      baseCorpusId: corpus.baseCorpusId,
      entities: entities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        entityKind: entity.entityKind,
        isCategoryBaseline: entity.isCategoryBaseline,
        includedCount: entity.includedCount
      })),
      importBatches: importBatchRows.map((batch) => ({
        queryPackId: batch.queryPackId,
        corpusEntityId: batch.corpusEntityId,
        entityKind: batch.entityKind,
        entityLabel: batch.entityLabel,
        mentionType: batch.mentionType,
        includedCount: batch.includedCount,
        status: batch.status
      })),
      queryPacks: queryPackRows.map((pack) => ({
        id: pack.id,
        lensSlug: pack.lensSlug,
        signalIntent: pack.signalIntent,
        scope: pack.scope,
        status: pack.status,
        mentionsReturned: pack.mentionsReturned,
        linkedMentionCount: pack.linkedMentionCount,
        directMentionCount: pack.directMentionCount,
        sharedMentionCount: pack.sharedMentionCount
      }))
    };

    const skipped: Array<Record<string, unknown>> = [];
    const blocked: Array<Record<string, unknown>> = [];
    const launchable: Array<{
      methodologySlug: string;
      methodologyVersion: string;
      methodologyStatus: string | null;
      queryPackValidation: ReturnType<typeof validateEngineQueryPackCoverage>;
    }> = [];

    for (const slug of selectedLenses) {
      const existing = existingBySlug.get(slug);
      if (existing && shouldReuseEngineAnalysis(existing)) {
        skipped.push({
          methodology_slug: slug,
          reason: "already_exists",
          engine_analysis_id: existing.id,
          status: existing.status,
          current_step: existing.currentStep,
          retrieved_units: existing.retrievedUnits,
          coding_provider: existing.codingProvider
        });
        continue;
      }

      const methodology = methodologyBySlug.get(slug) ?? null;
      const launch = validateEngineLaunchRequest(slug, methodology);
      if (!launch.ok) {
        blocked.push({
          methodology_slug: slug,
          reason: launch.error,
          message: launch.message,
          status: launch.status
        });
        continue;
      }

      const queryPackValidation = validateEngineQueryPackCoverage(launch.methodologySlug, coverageInput);
      if (!queryPackValidation.ok) {
        blocked.push({
          methodology_slug: slug,
          reason: "query_pack_not_ready",
          message: "El lente seleccionado necesita más cobertura/atribución antes de correr el engine.",
          query_pack_validation: queryPackValidation
        });
        continue;
      }

      launchable.push({
        methodologySlug: launch.methodologySlug,
        methodologyVersion: launch.methodologyVersion,
        methodologyStatus: launch.methodologyStatus,
        queryPackValidation
      });
    }

    if (launchable.length === 0) {
      return Response.json({
        ok: true,
        selected_lenses: selectedLenses,
        created: [],
        skipped,
        blocked,
        runtime: runtimeSummary()
      });
    }

    const snapshotLabel = `Pre-engine selected lenses · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const snapshot = await createCorpusSnapshot({
      corpusId: corpus.id,
      label: snapshotLabel,
      kind: "manual",
      userId: session.appUser.id
    });
    if (!snapshot) {
      return Response.json({ error: "snapshot_failed", message: "No se pudo crear el snapshot pre-engine." }, { status: 500 });
    }

    const queue = getEngineAnalysisQueue();
    const created: Array<Record<string, unknown>> = [];
    const inheritedEngineParams = engineLensParamsFromTbMeta(await loadLatestTbMeta(corpus.id));
    for (const item of launchable) {
      const [analysis] = await db
        .insert(engineAnalyses)
        .values({
          studyCorpusId: corpus.id,
          snapshotId: snapshot.id,
          methodologySlug: item.methodologySlug,
          methodologyVersion: item.methodologyVersion,
          pipelineVersion: ENGINE_PIPELINE_VERSION,
          status: "queued",
          currentStep: "preflight",
          businessQuestion: corpus.businessQuestion,
          params: {
            launch_surface: "selected_lenses_batch",
            ...inheritedEngineParams,
            ...(parsed.data.params ?? {})
          },
          metaJson: {
            launch: {
              requested_by_user_id: session.appUser.id,
              methodology_status: item.methodologyStatus,
              snapshot_mentions: snapshot.mention_count,
              query_pack_validation: item.queryPackValidation,
              selected_lenses_batch: selectedLenses,
              inherited_engine_params: inheritedEngineParams
            },
            runtime: runtimeSummary()
          },
          executedByUserId: session.appUser.id
        })
        .returning({ id: engineAnalyses.id });

      if (!analysis) continue;
      const job = await queue.add(
        "engine_run_analysis",
        { engineAnalysisId: analysis.id },
        { attempts: 1, removeOnComplete: { age: 60 * 60 * 24 } }
      );
      created.push({
        methodology_slug: item.methodologySlug,
        engine_analysis_id: analysis.id,
        bullmq_job_id: job.id,
        status: "queued"
      });
    }

    return Response.json(
      {
        ok: true,
        selected_lenses: selectedLenses,
        snapshot_id: snapshot.id,
        created,
        skipped,
        blocked,
        runtime: runtimeSummary()
      },
      { status: 202 }
    );
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return Response.json(
      {
        error: "engine_schema_missing",
        message: "Engine beta schema is not migrated yet."
      },
      { status: 503 }
    );
  }
}

async function loadAnalysisPlan(corpusId: string) {
  const [row] = await db
    .select({ analysisPlan: studyCorpora.analysisPlan })
    .from(studyCorpora)
    .where(eq(studyCorpora.id, corpusId))
    .limit(1);
  return row?.analysisPlan ?? null;
}

async function loadLatestTbMeta(corpusId: string) {
  const [row] = await db
    .select({ metaJson: tbAnalyses.metaJson })
    .from(tbAnalyses)
    .where(eq(tbAnalyses.studyCorpusId, corpusId))
    .orderBy(desc(tbAnalyses.createdAt))
    .limit(1);
  return row?.metaJson ?? null;
}

async function listSelectedLensStatuses(
  corpusId: string,
  selectedLenses: string[],
  coverageInput: Parameters<typeof validateEngineQueryPackCoverage>[1] | null = null
): Promise<LensLaunchStatus[]> {
  if (selectedLenses.length === 0) return [];
  const rows = await db
    .select({
      id: engineAnalyses.id,
      methodologySlug: engineAnalyses.methodologySlug,
      status: engineAnalyses.status,
      currentStep: engineAnalyses.currentStep,
      failureReason: engineAnalyses.failureReason,
      createdAt: engineAnalyses.createdAt,
      retrievedUnits: sql<number>`COALESCE((${engineAnalyses.metaJson}->'retrieval'->>'retrieved_units')::int, 0)`,
      codingProvider: sql<string | null>`${engineAnalyses.metaJson}->'engine_coding'->>'provider'`,
      codingFixture: sql<boolean | null>`CASE
        WHEN ${engineAnalyses.metaJson}->'engine_coding' ? 'fixture'
        THEN (${engineAnalyses.metaJson}->'engine_coding'->>'fixture')::boolean
        ELSE NULL
      END`
    })
    .from(engineAnalyses)
    .where(and(eq(engineAnalyses.studyCorpusId, corpusId), inArray(engineAnalyses.methodologySlug, selectedLenses)))
    .orderBy(desc(engineAnalyses.createdAt));

  const latestBySlug = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!latestBySlug.has(row.methodologySlug)) latestBySlug.set(row.methodologySlug, row);
  }

  return selectedLenses.map((slug) => {
    const queryPackValidation = coverageInput ? validateEngineQueryPackCoverage(slug, coverageInput) : null;
    const row = latestBySlug.get(slug);
    if (!row) {
      if (queryPackValidation && !queryPackValidation.ok) {
        return {
          methodology_slug: slug,
          status: "blocked",
          engine_analysis_id: null,
          current_step: null,
          message: queryPackValidation.hardFailures[0] ?? "El lente no tiene coverage suficiente para correr.",
          query_pack_validation: queryPackValidation
        };
      }
      return {
        methodology_slug: slug,
        status: queryPackValidation?.ok ? "ready" : "not_started",
        engine_analysis_id: null,
        current_step: null,
        message: queryPackValidation?.warnings[0] ?? "Listo para correr con el corpus cargado.",
        query_pack_validation: queryPackValidation
      };
    }
    if (!shouldReuseEngineAnalysis(row)) {
      const latestReason = row.status === "needs_review" || row.status === "approved"
        ? "La última corrida de este lente no tiene retrieval + Claude real completos; vuelve a correrla para publicar datos reales."
        : row.failureReason ?? queryPackValidation?.warnings[0] ?? "Listo para reintentar.";
      return {
        methodology_slug: slug,
        status: queryPackValidation && !queryPackValidation.ok ? "blocked" : "ready",
        engine_analysis_id: row.id,
        current_step: null,
        message: latestReason,
        query_pack_validation: queryPackValidation
      };
    }
    return {
      methodology_slug: slug,
      status: normalizeLensStatus(row.status),
      engine_analysis_id: row.id,
      current_step: row.currentStep,
      message: row.failureReason ?? queryPackValidation?.warnings[0] ?? null,
      query_pack_validation: queryPackValidation
    };
  });
}

function buildCoverageInput(
  corpus: Awaited<ReturnType<typeof getCorpusForUser>>,
  entities: Awaited<ReturnType<typeof listCorpusEntitiesForCorpus>>,
  importBatchRows: Awaited<ReturnType<typeof listImportBatchesForCorpus>>,
  queryPackRows: Array<{
    id: string;
    lensSlug: string;
    signalIntent: string;
    scope: string;
    status: string;
    mentionsReturned: number | null;
    linkedMentionCount: number | null;
    directMentionCount?: number | null;
    sharedMentionCount?: number | null;
  }>
): Parameters<typeof validateEngineQueryPackCoverage>[1] {
  return {
    brandId: corpus?.brandId,
    themeId: corpus?.themeId,
    baseCorpusId: corpus?.baseCorpusId,
    entities: entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      entityKind: entity.entityKind,
      isCategoryBaseline: entity.isCategoryBaseline,
      includedCount: entity.includedCount
    })),
    importBatches: importBatchRows.map((batch) => ({
      queryPackId: batch.queryPackId,
      corpusEntityId: batch.corpusEntityId,
      entityKind: batch.entityKind,
      entityLabel: batch.entityLabel,
      mentionType: batch.mentionType,
      includedCount: batch.includedCount,
      status: batch.status
    })),
    queryPacks: queryPackRows.map((pack) => ({
      id: pack.id,
      lensSlug: pack.lensSlug,
      signalIntent: pack.signalIntent,
      scope: pack.scope,
      status: pack.status,
      mentionsReturned: pack.mentionsReturned,
      linkedMentionCount: pack.linkedMentionCount,
      directMentionCount: pack.directMentionCount,
      sharedMentionCount: pack.sharedMentionCount
      }))
  };
}

function normalizeLensStatus(status: string): LensLaunchStatus["status"] {
  if (status === "queued" || status === "running" || status === "needs_review" || status === "approved" || status === "failed") {
    return status;
  }
  return "running";
}

function runtimeSummary() {
  return {
    runtime_enabled: isEngineRuntimeEnabled(),
    fixture_coding_enabled: isEngineFixtureCodingEnabled(),
    llm_enabled: isEngineLlmEnabled(),
    anthropic_configured: Boolean(process.env.ANTHROPIC_API_KEY)
  };
}
