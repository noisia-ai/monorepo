import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { corpusSnapshots, studyCorpora, tbAnalyses } from "@noisia/db";
import {
  TB_METHODOLOGY_SLUG,
  TB_METHODOLOGY_VERSION,
  TB_PROMPT_VERSION,
  TB_PIPELINE_VERSION,
  type DataOsCorpusAudit,
  type ListeningDataOsReconciliation
} from "@noisia/query-engine";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { type AnalysisStudySize, resolveAnalysisStudyPlan } from "@/lib/analysis/study-size";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { auditCorpusDataOs } from "@/lib/data-os/corpus-audit";
import { reconcileCorpusListeningDataOs } from "@/lib/data-os/listening";
import { db, pool } from "@/lib/db";
import { getTbAnalysisQueue } from "@/lib/queue/tb-analysis";

const startBodySchema = z.object({
  studySize: z.enum(["small", "medium", "large", "full_power"]).optional()
});

type AssessmentPayload = {
  ready_for_study?: boolean;
  score?: number;
  [key: string]: unknown;
};

function readAssessmentPayload(value: unknown): AssessmentPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AssessmentPayload;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const analysisId = url.searchParams.get("analysisId") ?? undefined;
  const state = await getTbAnalysisForCorpus(corpus.id, analysisId);

  return Response.json({ ok: true, state });
}

/**
 * POST — launch a Triggers & Barriers analysis on the current corpus state.
 * Flow:
 *  1. Reject if corpus is already locked by another running analysis.
 *  2. Reuse the approval snapshot for the current corpus revision so the
 *     pipeline reads exactly the mention set the analyst certified.
 *  3. Insert tb_analyses row in 'running' status.
 *  4. Lock the corpus pointing at this analysis.
 *  5. Enqueue tb_run_analysis on the tb-analysis BullMQ queue.
 *  6. Return analysis id + bullmq job id so the UI can poll progress.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  // Reject if another analysis is already locking this corpus
  const [lockRow] = await db
    .select({ lockedBy: studyCorpora.lockedByAnalysisId })
    .from(studyCorpora)
    .where(and(eq(studyCorpora.id, corpus.id), isNotNull(studyCorpora.lockedByAnalysisId)))
    .limit(1);

  if (lockRow?.lockedBy) {
    return Response.json(
      {
        error: "corpus_locked",
        message: "Ya hay un análisis T&B en curso sobre este corpus. Espera a que termine o usa force-unlock.",
        locked_by_analysis_id: lockRow.lockedBy
      },
      { status: 409 }
    );
  }

  let requestedStudySize: AnalysisStudySize | undefined;
  try {
    const body = await request.json();
    const parsed = startBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_body", message: "Tamaño de estudio inválido." }, { status: 400 });
    }
    requestedStudySize = parsed.data.studySize;
  } catch {
    requestedStudySize = undefined;
  }

  const [readinessRow] = await db
    .select({
      latestAssessment: studyCorpora.latestAssessment,
      latestAssessedAt: studyCorpora.latestAssessedAt,
      latestAssessedRevision: studyCorpora.latestAssessedRevision,
      corpusRevision: studyCorpora.corpusRevision,
      status: studyCorpora.status
    })
    .from(studyCorpora)
    .where(eq(studyCorpora.id, corpus.id))
    .limit(1);
  const latestAssessment = readAssessmentPayload(readinessRow?.latestAssessment);
  const assessmentCurrent = Boolean(
    latestAssessment &&
    readinessRow?.latestAssessedRevision === readinessRow?.corpusRevision
  );
  if (readinessRow?.status !== "corpus_approved" || !assessmentCurrent) {
    return Response.json(
      {
        error: "corpus_not_approved",
        message: "Diagnostica y aprueba la revisión actual del corpus antes de iniciar el análisis.",
        assessment: latestAssessment,
        assessed_at: readinessRow?.latestAssessedAt?.toISOString() ?? null,
        corpus_revision: readinessRow?.corpusRevision ?? null,
        assessed_revision: readinessRow?.latestAssessedRevision ?? null
      },
      { status: 409 }
    );
  }

  let dataOs;
  try {
    dataOs = await reconcileCorpusListeningDataOs(corpus.id);
  } catch (error) {
    console.error("[data-os:listening] analysis reconciliation failed", error);
    return Response.json(
      {
        error: "data_os_reconciliation_failed",
        message: "No se pudo reconciliar el listening con Data OS. El análisis no fue creado ni enviado a workers."
      },
      { status: 503 }
    );
  }
  if (!dataOs.quality.readyForAnalysis) {
    return Response.json(
      {
        error: "data_os_listening_not_ready",
        message: "El listening no cumple el contrato mínimo de texto, fecha y cobertura temporal para iniciar Claude.",
        data_os: publicListeningDataOs(dataOs)
      },
      { status: 409 }
    );
  }

  let dataOsAudit: DataOsCorpusAudit;
  try {
    dataOsAudit = await auditCorpusDataOs({
      corpusId: corpus.id,
      stage: "pre_analysis"
    });
  } catch (error) {
    console.error("[data-os:audit] analysis preflight failed", error);
    return Response.json(
      {
        error: "data_os_audit_failed",
        message: "No se pudo comprobar el contrato Data OS. El análisis no fue creado ni enviado a workers."
      },
      { status: 503 }
    );
  }
  if (!dataOsAudit.ready_for_claude) {
    return Response.json(
      {
        error: "data_os_contract_blocked",
        message: "Data OS no reconcilia todavía catálogo, listening, observaciones, calidad y lineage. Corrige los bloqueos antes de iniciar Claude.",
        data_os: {
          listening: publicListeningDataOs(dataOs),
          audit: dataOsAudit
        }
      },
      { status: 409 }
    );
  }

  const approvalSnapshots = await db
    .select({
      id: corpusSnapshots.id,
      mentionCount: corpusSnapshots.mentionCount,
      scores: corpusSnapshots.scoresAtSnapshot
    })
    .from(corpusSnapshots)
    .where(and(
      eq(corpusSnapshots.studyCorpusId, corpus.id),
      eq(corpusSnapshots.kind, "approval")
    ))
    .orderBy(desc(corpusSnapshots.createdAt));
  const snapshot = approvalSnapshots.find((candidate) => {
    const scores = candidate.scores;
    if (!scores || typeof scores !== "object" || Array.isArray(scores)) return false;
    return Number((scores as Record<string, unknown>).corpus_revision) === readinessRow.corpusRevision;
  });
  if (!snapshot) {
    return Response.json(
      {
        error: "approval_snapshot_missing",
        message: "La revisión figura como aprobada, pero no existe su snapshot de aprobación. Vuelve a aprobarla antes de analizar."
      },
      { status: 409 }
    );
  }

  const studyPlan = resolveAnalysisStudyPlan({
    corpusMentions: snapshot.mentionCount,
    requestedSize: requestedStudySize
  });
  const scopeResult = await pool.query<{
    period_start: string | null;
    period_end: string | null;
    mention_count: number;
    snapshot_digest: string;
  }>(
    `SELECT
       MIN(mention.published_at)::date::text AS period_start,
       MAX(mention.published_at)::date::text AS period_end,
       COUNT(snapshot_mention.mention_id)::integer AS mention_count,
       'md5:' || md5(
         COALESCE(string_agg(snapshot_mention.mention_id::text, ',' ORDER BY snapshot_mention.mention_id), '')
       ) AS snapshot_digest
     FROM corpus_snapshot_mentions snapshot_mention
     JOIN mentions mention ON mention.id = snapshot_mention.mention_id
     WHERE snapshot_mention.snapshot_id = $1::uuid
       AND mention.study_corpus_id = $2::uuid`,
    [snapshot.id, corpus.id]
  );
  const frozenScope = scopeResult.rows[0];
  if (
    !frozenScope?.period_start
    || !frozenScope.period_end
    || frozenScope.mention_count !== snapshot.mentionCount
  ) {
    return Response.json(
      {
        error: "snapshot_scope_invalid",
        message: "El snapshot aprobado no reconcilia periodo, membresía y mention_count."
      },
      { status: 409 }
    );
  }

  // 2. Insert tb_analyses row
  const [analysis] = await db
    .insert(tbAnalyses)
    .values({
      studyCorpusId: corpus.id,
      snapshotId: snapshot.id,
      pipelineVersion: TB_PIPELINE_VERSION,
      methodologyVersion: TB_METHODOLOGY_VERSION,
      methodologySlug: TB_METHODOLOGY_SLUG,
      promptVersion: TB_PROMPT_VERSION,
      modelVersion: process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6",
      corpusRevision: readinessRow.corpusRevision,
      periodStart: frozenScope.period_start,
      periodEnd: frozenScope.period_end,
      snapshotMentionCount: frozenScope.mention_count,
      snapshotDigest: frozenScope.snapshot_digest,
      scopeFrozenAt: new Date(),
      comparisonCompatibilityState: "not_evaluated",
      status: "running",
      currentStep: "preflight",
      businessQuestion: corpus.businessQuestion,
      decisionToInform: corpus.decisionToInform,
      metaJson: {
        analysis_sample: {
          requested_study_size: requestedStudySize ?? "medium",
          resolved_study_size: studyPlan.size,
          label: studyPlan.label,
          strategy: studyPlan.isAutoFull ? "full_snapshot_auto" : "stratified_random",
          snapshot_mentions: snapshot.mentionCount,
          target_mentions: studyPlan.estimatedMentions,
          coverage_pct: studyPlan.coveragePct,
          mention_limit: studyPlan.mentionLimit,
          estimated_cost_usd: studyPlan.estimatedCostUsd,
          cost_per_mention_usd: 0.00125,
          auto_full_threshold: 5000,
          is_auto_full: studyPlan.isAutoFull,
          corpus_revision: readinessRow.corpusRevision,
          approval_snapshot_id: snapshot.id,
          approval_override: readApprovalOverride(snapshot.scores)
        },
        data_os_preflight: dataOsAudit
      },
      executedByUserId: session.appUser.id
    })
    .returning({ id: tbAnalyses.id });

  if (!analysis) {
    return Response.json(
      { error: "db_error", message: "No se pudo crear el análisis." },
      { status: 500 }
    );
  }

  // 3. Lock the corpus
  await db
    .update(studyCorpora)
    .set({ lockedByAnalysisId: analysis.id })
    .where(eq(studyCorpora.id, corpus.id));

  // 4. Enqueue orchestrator
  const queue = getTbAnalysisQueue();
  const job = await queue.add(
    "tb_run_analysis",
    { tbAnalysisId: analysis.id },
    { attempts: 1, removeOnComplete: { age: 60 * 60 * 24 } }
  );

  return Response.json(
    {
      ok: true,
      tb_analysis_id: analysis.id,
      snapshot_id: snapshot.id,
      run_scope: {
        corpus_revision: readinessRow.corpusRevision,
        period_start: frozenScope.period_start,
        period_end: frozenScope.period_end,
        snapshot_digest: frozenScope.snapshot_digest,
        snapshot_mention_count: frozenScope.mention_count,
        methodology_slug: TB_METHODOLOGY_SLUG,
        methodology_version: TB_METHODOLOGY_VERSION,
        pipeline_version: TB_PIPELINE_VERSION,
        prompt_version: TB_PROMPT_VERSION,
        model_version: process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6"
      },
      study_plan: studyPlan,
      data_os: {
        listening: publicListeningDataOs(dataOs),
        audit: dataOsAudit
      },
      bullmq_job_id: job.id,
      status: "running"
    },
    { status: 202 }
  );
}

function readApprovalOverride(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).override === true;
}

function publicListeningDataOs(value: ListeningDataOsReconciliation) {
  return {
    quality: value.quality,
    counts: value.counts,
    coverage: value.coverage,
    capabilities: value.capabilities
  };
}

/**
 * DELETE — force-unlock the corpus. Used when a previous analysis hangs and
 * the IM needs to start fresh. Doesn't delete the tb_analyses row; just
 * marks it as failed and frees the corpus.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const [lock] = await db
    .select({ lockedBy: studyCorpora.lockedByAnalysisId })
    .from(studyCorpora)
    .where(eq(studyCorpora.id, corpus.id))
    .limit(1);

  if (!lock?.lockedBy) {
    return Response.json({ ok: true, was_locked: false });
  }

  await db
    .update(tbAnalyses)
    .set({
      status: "failed",
      failedAt: new Date(),
      failureReason: "Force-unlocked by Insights Manager"
    })
    .where(eq(tbAnalyses.id, lock.lockedBy));

  await db
    .update(studyCorpora)
    .set({ lockedByAnalysisId: null })
    .where(eq(studyCorpora.id, corpus.id));

  return Response.json({ ok: true, was_locked: true, freed_analysis_id: lock.lockedBy });
}
