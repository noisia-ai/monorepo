import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { engineAnalyses, engineCostEvents, enginePipelineSteps, methodologies, queryPacks, tbAnalyses } from "@noisia/db";
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
import { db, pool } from "@/lib/db";
import { validateEngineLaunchRequest } from "@/lib/engine/launch-guards";
import { ENGINE_BETA_METHODOLOGY_OPTIONS, buildEngineMethodologyOptions } from "@/lib/engine/methodology-options";
import { validateEngineQueryPackCoverage } from "@/lib/engine/query-pack-validation";
import { getEngineAnalysisQueue } from "@/lib/queue/engine-analysis";
import { buildSignalPulseLaunchPlan, buildSignalPulseRunParams } from "@/lib/signal-pulse/runtime-contracts";

const startEngineSchema = z.object({
  methodology_slug: z.string().min(1).optional(),
  params: z.record(z.unknown()).optional()
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  try {
    const seededMethodologies = await db
      .select({
        slug: methodologies.slug,
        status: methodologies.status,
        version: methodologies.version
      })
      .from(methodologies)
      .where(inArray(methodologies.slug, ENGINE_BETA_METHODOLOGY_OPTIONS.map((option) => option.slug)));

    const analyses = await db
      .select({
        id: engineAnalyses.id,
        methodologySlug: engineAnalyses.methodologySlug,
        methodologyVersion: engineAnalyses.methodologyVersion,
        status: engineAnalyses.status,
        currentStep: engineAnalyses.currentStep,
        businessQuestion: engineAnalyses.businessQuestion,
        limitations: engineAnalyses.limitations,
        metaJson: engineAnalyses.metaJson,
        createdAt: engineAnalyses.createdAt,
        updatedAt: engineAnalyses.updatedAt,
        failedAt: engineAnalyses.failedAt,
        failureReason: engineAnalyses.failureReason
      })
      .from(engineAnalyses)
      .where(eq(engineAnalyses.studyCorpusId, corpus.id))
      .orderBy(desc(engineAnalyses.createdAt))
      .limit(10);

    const latest = analyses[0] ?? null;
    const steps = latest
      ? await db
          .select({
            id: enginePipelineSteps.id,
            step: enginePipelineSteps.step,
            status: enginePipelineSteps.status,
            durationMs: enginePipelineSteps.durationMs,
            errorMessage: enginePipelineSteps.errorMessage,
            resultSummary: enginePipelineSteps.resultSummary,
            createdAt: enginePipelineSteps.createdAt
          })
          .from(enginePipelineSteps)
          .where(eq(enginePipelineSteps.engineAnalysisId, latest.id))
          .orderBy(enginePipelineSteps.createdAt)
      : [];
    const [costSummary] = latest
      ? await db
          .select({
            events: sql<number>`COUNT(*)::int`,
            totalTokens: sql<number>`COALESCE(SUM(${engineCostEvents.totalTokens}), 0)::int`,
            estimatedCostUsd: sql<string>`COALESCE(SUM(${engineCostEvents.estimatedCostUsd}), 0)::text`,
            providers: sql<string[]>`COALESCE(array_remove(array_agg(DISTINCT ${engineCostEvents.provider}), NULL), ARRAY[]::text[])`,
            operations: sql<string[]>`COALESCE(array_remove(array_agg(DISTINCT ${engineCostEvents.operation}), NULL), ARRAY[]::text[])`
          })
          .from(engineCostEvents)
          .where(eq(engineCostEvents.engineAnalysisId, latest.id))
      : [null];
    const signalPulseLaunchPlan = corpus.methodologySlug === "signal-pulse"
      ? await loadSignalPulseLaunchPlan({
          corpusId: corpus.id,
          analysisPlan: corpus.analysisPlan,
          targetWindowMonths: corpus.targetWindowMonths
        })
      : null;

    return Response.json({
      ok: true,
      runtimeEnabled: isEngineRuntimeEnabled(),
      methodologyOptions: buildEngineMethodologyOptions(seededMethodologies),
      latest,
      analyses,
      steps,
      signalPulseLaunchPlan,
      costSummary: costSummary
        ? {
            events: Number(costSummary.events ?? 0),
            totalTokens: Number(costSummary.totalTokens ?? 0),
            estimatedCostUsd: Number(costSummary.estimatedCostUsd ?? 0),
            providers: Array.isArray(costSummary.providers) ? costSummary.providers : [],
            operations: Array.isArray(costSummary.operations) ? costSummary.operations : []
          }
        : null
    });
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return Response.json({
      ok: false,
      unavailable: true,
      runtimeEnabled: isEngineRuntimeEnabled(),
      reason: "engine_schema_missing",
      message: "Engine beta schema is not migrated yet.",
      methodologyOptions: buildEngineMethodologyOptions(),
      latest: null,
      analyses: [],
      steps: [],
      signalPulseLaunchPlan: null,
      costSummary: null
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

  const parsed = startEngineSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  const allowFixtureCoding = parsed.data.params?.allow_fixture_coding === true;
  const requestedSlug = parsed.data.methodology_slug ?? corpus.methodologySlug;
  const isSignalPulseRequested = requestedSlug === "signal-pulse";
  if (!isSignalPulseRequested && !allowFixtureCoding && (!isEngineLlmEnabled() || !process.env.ANTHROPIC_API_KEY)) {
    return Response.json(
      {
        error: "engine_llm_disabled",
        message: "Los lentes engine requieren Claude real. Habilita NOISIA_ENGINE_LLM_ENABLED=true y ANTHROPIC_API_KEY antes de correrlos.",
        runtime: {
          runtime_enabled: isEngineRuntimeEnabled(),
          llm_enabled: isEngineLlmEnabled(),
          fixture_coding_enabled: isEngineFixtureCodingEnabled(),
          anthropic_configured: Boolean(process.env.ANTHROPIC_API_KEY)
        }
      },
      { status: 403 }
    );
  }

  try {
    const [methodology] = await db
      .select({
        slug: methodologies.slug,
        version: methodologies.version,
        status: methodologies.status
      })
      .from(methodologies)
      .where(eq(methodologies.slug, requestedSlug))
      .orderBy(desc(methodologies.version))
      .limit(1);

    const launch = validateEngineLaunchRequest(requestedSlug, methodology ?? null);
    if (!launch.ok) {
      return Response.json(
        {
          error: launch.error,
          message: launch.message,
          methodology_slug: launch.methodologySlug,
          status: launch.methodologyStatus
        },
        { status: launch.status }
      );
    }

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
    const queryPackValidation = validateEngineQueryPackCoverage(launch.methodologySlug, {
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
    });

    if (!queryPackValidation.ok) {
      return Response.json(
        {
          error: "query_pack_not_ready",
          message: "El lente seleccionado necesita más cobertura/atribución antes de correr el engine.",
          methodology_slug: launch.methodologySlug,
          query_pack_validation: queryPackValidation
        },
        { status: 422 }
      );
    }
    if (isSignalPulseRequested) {
      const signalPulseLaunchPlan = await loadSignalPulseLaunchPlan({
        corpusId: corpus.id,
        analysisPlan: corpus.analysisPlan,
        requestParams: parsed.data.params,
        targetWindowMonths: corpus.targetWindowMonths
      });
      if (signalPulseLaunchPlan.status === "blocked") {
        return Response.json(
          {
            error: "signal_pulse_not_ready",
            message: "Completa menciones, query pack, knowledge/brief y performance estructurada antes de correr Signal Pulse.",
            signalPulseLaunchPlan
          },
          { status: 422 }
        );
      }
    }

    const snapshotLabel = `Pre-engine ${launch.methodologySlug} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const snapshot = await createCorpusSnapshot({
      corpusId: corpus.id,
      label: snapshotLabel,
      kind: "manual",
      userId: session.appUser.id
    });
    if (!snapshot) {
      return Response.json({ error: "snapshot_failed", message: "No se pudo crear el snapshot pre-engine." }, { status: 500 });
    }

    const inheritedEngineParams = engineLensParamsFromTbMeta(await loadLatestTbMeta(corpus.id));
    const analysisPlan = corpus.analysisPlan && typeof corpus.analysisPlan === "object" && !Array.isArray(corpus.analysisPlan)
      ? corpus.analysisPlan as Record<string, unknown>
      : {};
    const signalPulseParams = isSignalPulseRequested
      ? buildSignalPulseRunParams({
          analysisPlan,
          requestParams: parsed.data.params,
          targetWindowMonths: corpus.targetWindowMonths
        })
      : {};
    const [analysis] = await db
      .insert(engineAnalyses)
      .values({
        studyCorpusId: corpus.id,
        snapshotId: snapshot.id,
        methodologySlug: launch.methodologySlug,
        methodologyVersion: launch.methodologyVersion,
        pipelineVersion: ENGINE_PIPELINE_VERSION,
        status: "queued",
        currentStep: "preflight",
        businessQuestion: corpus.businessQuestion,
        params: {
          ...inheritedEngineParams,
          ...(parsed.data.params ?? {}),
          ...signalPulseParams
        },
        metaJson: {
          launch: {
            requested_by_user_id: session.appUser.id,
            methodology_status: launch.methodologyStatus,
            snapshot_mentions: snapshot.mention_count,
            query_pack_validation: queryPackValidation,
            inherited_engine_params: inheritedEngineParams
          }
        },
        executedByUserId: session.appUser.id
      })
      .returning({ id: engineAnalyses.id });

    if (!analysis) {
      return Response.json({ error: "db_error", message: "No se pudo crear el engine analysis." }, { status: 500 });
    }

    const queue = getEngineAnalysisQueue();
    const job = await queue.add(
      "engine_run_analysis",
      { engineAnalysisId: analysis.id },
      { attempts: 1, removeOnComplete: { age: 60 * 60 * 24 } }
    );

    return Response.json(
      {
        ok: true,
        engine_analysis_id: analysis.id,
        snapshot_id: snapshot.id,
        bullmq_job_id: job.id,
        status: "queued",
        polling_url: `/api/jobs/${job.id}?queue=engine-analysis`
      },
      { status: 202 }
    );
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return Response.json(
      {
        error: "engine_schema_missing",
        message: "Engine beta schema is not migrated yet.",
        methodology_slug: requestedSlug
      },
      { status: 503 }
    );
  }
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

async function loadSignalPulseLaunchPlan(args: {
  corpusId: string;
  analysisPlan: unknown;
  requestParams?: unknown;
  targetWindowMonths: unknown;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const [coverage] = (await client.query<{
      conversation_mentions: number;
      signal_pulse_mentions: number;
      performance_records: number;
      query_packs: number;
      semantic_mention_embeddings: number;
      semantic_knowledge_embeddings: number;
      knowledge_sources: number;
    }>(
      `
        SELECT
          COUNT(DISTINCT m.id)::int AS conversation_mentions,
          COUNT(DISTINCT m.id) FILTER (WHERE mqs.lens_slug = 'signal-pulse')::int AS signal_pulse_mentions,
          (SELECT COUNT(*)::int FROM performance_records pr WHERE pr.study_corpus_id = $1) AS performance_records,
          (SELECT COUNT(*)::int FROM query_packs qp WHERE qp.study_corpus_id = $1 AND qp.lens_slug = 'signal-pulse') AS query_packs,
          (SELECT COUNT(DISTINCT se.mention_id)::int FROM semantic_embeddings se WHERE se.study_corpus_id = $1 AND se.scope_type = 'mention') AS semantic_mention_embeddings,
          (SELECT COUNT(*)::int FROM semantic_embeddings se WHERE se.study_corpus_id = $1 AND se.scope_type = 'knowledge_source') AS semantic_knowledge_embeddings,
          (
            SELECT COUNT(*)::int
            FROM brand_knowledge_sources bks
            WHERE bks.study_corpus_id = $1
              AND bks.status IN ('processed', 'processed_truncated')
          ) AS knowledge_sources
        FROM mentions m
        LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
        WHERE m.study_corpus_id = $1
          AND m.inclusion_status = 'included'
      `,
      [args.corpusId]
    )).rows;
    await client.query("COMMIT");

    return buildSignalPulseLaunchPlan({
      analysisPlan: args.analysisPlan,
      requestParams: args.requestParams,
      targetWindowMonths: args.targetWindowMonths,
      coverage: {
        conversationMentions: coverage?.conversation_mentions,
        signalPulseMentions: coverage?.signal_pulse_mentions,
        performanceRecords: coverage?.performance_records,
        queryPacks: coverage?.query_packs,
        semanticMentionEmbeddings: coverage?.semantic_mention_embeddings,
        semanticKnowledgeEmbeddings: coverage?.semantic_knowledge_embeddings,
        knowledgeSources: coverage?.knowledge_sources
      }
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
