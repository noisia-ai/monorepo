import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { publishedOutputs } from "@noisia/db";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { db, pool } from "@/lib/db";
import { persistDataOsOutputRefs } from "@/lib/data-os/output-refs";
import { loadPublishedSignalOverview } from "@/lib/data-os/published-signal-overview";
import {
  assessSignalServingReadiness,
  getSignalServingReadiness,
  type SignalServingReadinessAssessment
} from "@/lib/data-os/signal-serving";
import {
  explicitCompositeEngineLensesFromPlan,
  validateCompositeEnginePublishReadiness,
  type CompositeEngineLensAnalysis
} from "@/lib/engine/composite-publish-guards";
import { ACTIVE_ENGINE_RUNTIME_SLUGS, engineModuleKeyForMethodology } from "@/lib/engine/methodology-options";
import { attachLiveIntelligenceLinksToPayload } from "@/lib/live-intelligence/published-output";
import { persistTbSignalObservations } from "@/lib/live-intelligence/tb-observations";
import { buildSignalPayload, normalizeSignalManifest } from "@/lib/signal/build";
import { SIGNAL_PAYLOAD_VERSION } from "@/lib/signal/contracts";
import { attachSignalServingContract } from "@/lib/signal/semantics";

const bodySchema = z.object({
  title: z.string().min(3).max(140),
  headline: z.string().min(3).max(220).optional().nullable(),
  summary: z.string().min(3).max(700).optional().nullable(),
  manifest: z.record(z.unknown()).optional(),
  action: z.enum(["save_draft", "publish"]).default("save_draft")
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id, analysisId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const state = await getTbAnalysisForCorpus(corpus.id, analysisId, { includeAggregates: true });
  if (!state) {
    return Response.json({ error: "not_found", message: "Analysis not found." }, { status: 404 });
  }

  if (!["approved_by_im", "approved_by_kam"].includes(state.analysis.status)) {
    return Response.json(
      {
        error: "analysis_not_approved",
        message: "Primero aprueba la síntesis antes de preparar Signal."
      },
      { status: 409 }
    );
  }

  const allowBetaLenses = process.env.NOISIA_SHOW_ENGINE_BETA_PANEL === "true";
  const requestedManifest = normalizeSignalManifest(parsed.data.manifest);
  const manifest = allowBetaLenses ? requestedManifest : productionSignalManifest(requestedManifest);
  const snapshotId = state.analysis.snapshotId;
  const isPublish = parsed.data.action === "publish";
  let signalServingReadiness = snapshotId
    ? await getSignalServingReadiness({
        analysisId: state.analysis.id,
        snapshotId
      })
    : null;
  let signalServingAssessment: SignalServingReadinessAssessment = signalServingReadiness
    ? assessSignalServingReadiness(signalServingReadiness)
    : {
        ready: false,
        hardBlocks: [{
          code: "snapshot_missing",
          message: "El analisis no esta vinculado a un snapshot inmutable del corpus."
        }],
        warnings: []
      };
  const draftManifest = signalServingReadiness
    ? {
        ...manifest,
        data_os_readiness: {
          contract_version: signalServingReadiness.contractVersion,
          counts: signalServingReadiness.counts,
          warnings: signalServingAssessment.warnings.map((warning) => warning.code)
        }
      }
    : manifest;
  const payload = buildSignalPayload({
    state,
    corpus,
    manifest,
    headline: parsed.data.headline,
    summary: parsed.data.summary
  });
  if (isPublish) {
    if (!snapshotId) {
      return Response.json(
        {
          error: "published_signal_requires_snapshot",
          message: "El analisis no tiene un snapshot inmutable. Vuelve a aprobar el corpus antes de publicar Signal."
        },
        { status: 409 }
      );
    }
    if (!signalServingAssessment.ready) {
      return Response.json(
        {
          error: "data_os_readiness_failed",
          message: "Signal no se puede publicar porque faltan datos relacionales verificables.",
          readiness: signalServingReadiness,
          assessment: signalServingAssessment
        },
        { status: 409 }
      );
    }

    const selectedEngineLenses = allowBetaLenses ? explicitCompositeEngineLensesFromPlan(corpus.analysisPlan) : [];
    const compositeReadiness = validateCompositeEnginePublishReadiness({
      analysisPlan: corpus.analysisPlan,
      manifest,
      latestAnalyses: selectedEngineLenses.length > 0
        ? await loadLatestCompositeEngineAnalyses(corpus.id, selectedEngineLenses)
        : []
    });
    if (!compositeReadiness.ok) {
      return Response.json(
        {
          error: compositeReadiness.error,
          message: compositeReadiness.message,
          required_lenses: compositeReadiness.required_lenses,
          failed_lenses: compositeReadiness.failed_lenses
        },
        { status: 409 }
      );
    }
  }

  // Publishing is intentionally staged. The row stays draft until its immutable
  // snapshot and relational serving references have been persisted and verified.
  const [output] = await db
    .insert(publishedOutputs)
    .values({
      tbAnalysisId: state.analysis.id,
      studyCorpusId: corpus.id,
      brandId: corpus.brandId,
      themeId: corpus.themeId,
      methodologySlug: corpus.methodologySlug ?? "triggers-barriers",
      outputType: "narrative_dashboard",
      status: "draft",
      title: parsed.data.title,
      headline: parsed.data.headline,
      summary: parsed.data.summary,
      manifest: draftManifest,
      payload,
      version: SIGNAL_PAYLOAD_VERSION,
      createdByUserId: session.appUser.id,
      publishedByUserId: null,
      publishedAt: null,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [publishedOutputs.tbAnalysisId, publishedOutputs.outputType],
      set: {
        status: "draft",
        title: parsed.data.title,
        headline: parsed.data.headline,
        summary: parsed.data.summary,
        manifest: draftManifest,
        payload,
        version: SIGNAL_PAYLOAD_VERSION,
        publishedByUserId: null,
        publishedAt: null,
        archivedAt: null,
        updatedAt: new Date()
      }
    })
    .returning({
      id: publishedOutputs.id,
      status: publishedOutputs.status,
      title: publishedOutputs.title
    });

  let liveIntelligence: Awaited<ReturnType<typeof persistTbSignalObservations>> | null = null;
  const dataOsReferences = output?.id
    ? await persistDataOsOutputRefs({
        outputId: output.id,
        corpusId: corpus.id,
        analysisId: state.analysis.id,
        snapshotId,
        required: isPublish
      })
    : {
        status: "skipped" as const,
        refs: 0,
        lineageEdges: 0,
        contractVersion: "signal-serving-v1",
        presentRefs: [],
        missingRefs: [],
        reason: "output_not_created"
      };

  if (isPublish && dataOsReferences.status !== "ok") {
    return Response.json(
      {
        error: "signal_serving_contract_incomplete",
        message: "Signal no se publico porque faltan referencias verificables al snapshot y al analisis.",
        output,
        dataOsReferences
      },
      { status: 409 }
    );
  }

  let relationalVerification: {
    mentions: number;
    findings: number;
    opportunities: number;
  } | null = null;
  let publishedManifest: Record<string, unknown> = { ...draftManifest };

  if (isPublish && output?.id && snapshotId) {
    signalServingReadiness = await getSignalServingReadiness({
      analysisId: state.analysis.id,
      snapshotId,
      outputId: output.id,
      requireDataRefs: true
    });
    signalServingAssessment = assessSignalServingReadiness(signalServingReadiness);

    if (!signalServingAssessment.ready) {
      return Response.json(
        {
          error: "data_os_readiness_failed_after_refs",
          message: "Signal quedo como draft porque el contrato relacional no paso la verificacion posterior a sus referencias.",
          output,
          readiness: signalServingReadiness,
          assessment: signalServingAssessment,
          dataOsReferences
        },
        { status: 409 }
      );
    }

    try {
      const overview = await loadPublishedSignalOverview({
        outputId: output.id,
        corpusId: corpus.id,
        snapshotId,
        analysisId: state.analysis.id,
        requireGovernedRef: true
      });
      const mismatch = compareRelationalServingCounts(overview, signalServingReadiness);
      if (mismatch.length > 0) {
        return Response.json(
          {
            error: "signal_relational_serving_mismatch",
            message: "Signal quedo como draft porque la lectura relacional no coincide con el contrato de publicacion.",
            output,
            mismatch,
            readiness: signalServingReadiness,
            dataOsReferences
          },
          { status: 409 }
        );
      }
      relationalVerification = {
        mentions: overview.corpus.total_mentions,
        findings: overview.metrics.findings_total,
        opportunities: overview.metrics.opportunities_total
      };
    } catch (error) {
      return Response.json(
        {
          error: "signal_relational_serving_failed",
          message: "Signal quedo como draft porque no fue posible servir el snapshot relacional publicado.",
          output,
          detail: error instanceof Error ? error.message : "unknown_relational_serving_error",
          readiness: signalServingReadiness,
          dataOsReferences
        },
        { status: 409 }
      );
    }

    if (!relationalVerification) {
      return Response.json(
        {
          error: "signal_relational_verification_missing",
          message: "Signal quedo como draft porque no se pudo conservar la evidencia de reconciliacion relacional.",
          output,
          readiness: signalServingReadiness,
          dataOsReferences
        },
        { status: 409 }
      );
    }

    publishedManifest = attachSignalServingContract({
      ...manifest,
      data_os_readiness: {
        contract_version: signalServingReadiness.contractVersion,
        counts: signalServingReadiness.counts,
        warnings: signalServingAssessment.warnings.map((warning) => warning.code)
      },
      relational_verification: {
        status: "verified",
        contract_version: signalServingReadiness.contractVersion,
        verified_at: new Date().toISOString(),
        mentions: relationalVerification.mentions,
        findings: relationalVerification.findings,
        opportunities: relationalVerification.opportunities,
        payload_role: "manifest_only",
        payload_preserved: true
      }
    }, {
      analysisId: state.analysis.id,
      snapshotId
    });
  }

  let finalPayload = payload;
  if (isPublish && output?.id) {
    try {
      liveIntelligence = await persistTbSignalObservations({
        tbAnalysisId: state.analysis.id,
        publishedOutputId: output.id
      });
      if (liveIntelligence.status === "ok" && liveIntelligence.mappings.length > 0) {
        finalPayload = attachLiveIntelligenceLinksToPayload(payload, liveIntelligence);
      }
    } catch (error) {
      liveIntelligence = {
        status: "skipped",
        reason: error instanceof Error ? error.message : "unknown_live_intelligence_error",
        signals: 0,
        observations: 0,
        evidence: 0,
        mappings: []
      };
    }

    await db
      .update(publishedOutputs)
      .set({
        status: "published",
        manifest: publishedManifest,
        payload: finalPayload,
        publishedByUserId: session.appUser.id,
        publishedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(publishedOutputs.id, output.id));
  }

  return Response.json({
    ok: true,
    output: output ? { ...output, status: isPublish ? "published" : "draft" } : output,
    liveIntelligence,
    dataOsReferences,
    relationalVerification,
    signalServingReadiness,
    signalServingAssessment
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id, analysisId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const [output] = await db
    .select({
      id: publishedOutputs.id,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      status: publishedOutputs.status,
      manifest: publishedOutputs.manifest,
      publishedAt: publishedOutputs.publishedAt
    })
    .from(publishedOutputs)
    .where(and(eq(publishedOutputs.tbAnalysisId, analysisId), eq(publishedOutputs.outputType, "narrative_dashboard")))
    .limit(1);

  return Response.json({ output: output ?? null });
}

function productionSignalManifest(manifest: ReturnType<typeof normalizeSignalManifest>) {
  const production = { ...manifest, engine_methodology: false };
  for (const slug of ACTIVE_ENGINE_RUNTIME_SLUGS) {
    const moduleKey = engineModuleKeyForMethodology(slug);
    if (moduleKey) production[moduleKey] = false;
  }
  return production;
}

function compareRelationalServingCounts(
  overview: Awaited<ReturnType<typeof loadPublishedSignalOverview>>,
  readiness: Awaited<ReturnType<typeof getSignalServingReadiness>>
) {
  const mismatches: string[] = [];
  const pairs = [
    ["mentions", overview.corpus.total_mentions, readiness.counts.mentions],
    ["findings", overview.metrics.findings_total, readiness.counts.findings],
    ["opportunities", overview.metrics.opportunities_total, readiness.counts.opportunities]
  ] as const;

  for (const [name, served, expected] of pairs) {
    if (served !== expected) {
      mismatches.push(`${name}: served=${served}, expected=${expected}`);
    }
  }
  return mismatches;
}

async function loadLatestCompositeEngineAnalyses(
  corpusId: string,
  methodologySlugs: string[]
): Promise<CompositeEngineLensAnalysis[]> {
  if (methodologySlugs.length === 0) return [];
  const result = await pool.query<{
    methodology_slug: string;
    engine_analysis_id: string;
    status: string | null;
    current_step: string | null;
    meta_json: unknown;
    used_fixture_coding: boolean;
  }>(
    `
      SELECT DISTINCT ON (ea.methodology_slug)
        ea.methodology_slug,
        ea.id::text AS engine_analysis_id,
        ea.status,
        ea.current_step,
        ea.meta_json,
        EXISTS (
          SELECT 1
          FROM engine_cost_events ece
          WHERE ece.engine_analysis_id = ea.id
            AND ece.provider = 'fixture'
        ) AS used_fixture_coding
      FROM engine_analyses ea
      WHERE ea.study_corpus_id = $1
        AND ea.methodology_slug = ANY($2::text[])
      ORDER BY ea.methodology_slug, ea.created_at DESC
    `,
    [corpusId, methodologySlugs]
  );

  return result.rows.map((row) => ({
    methodologySlug: row.methodology_slug,
    engineAnalysisId: row.engine_analysis_id,
    status: row.status,
    currentStep: row.current_step,
    metaJson: row.meta_json,
    usedFixtureCoding: row.used_fixture_coding
  }));
}
