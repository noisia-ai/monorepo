import { and, eq, isNotNull } from "drizzle-orm";

import { studyCorpora, tbAnalyses } from "@noisia/db";
import { TB_METHODOLOGY_VERSION, TB_PIPELINE_VERSION } from "@noisia/query-engine";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { createCorpusSnapshot } from "@/lib/corpus/snapshots";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { db } from "@/lib/db";
import { getTbAnalysisQueue } from "@/lib/queue/tb-analysis";

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
 *  2. Create an auto-snapshot ("Pre-análisis T&B [fecha]") so the pipeline
 *     reads from a frozen mention set.
 *  3. Insert tb_analyses row in 'running' status.
 *  4. Lock the corpus pointing at this analysis.
 *  5. Enqueue tb_run_analysis on the tb-analysis BullMQ queue.
 *  6. Return analysis id + bullmq job id so the UI can poll progress.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
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

  // 1. Snapshot for reproducibility
  const snapshotLabel = `Pre-análisis T&B · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const snapshot = await createCorpusSnapshot({
    corpusId: corpus.id,
    label: snapshotLabel,
    kind: "manual",
    userId: session.appUser.id
  });
  if (!snapshot) {
    return Response.json(
      { error: "snapshot_failed", message: "No se pudo crear el snapshot pre-análisis." },
      { status: 500 }
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
      status: "running",
      currentStep: "preflight",
      businessQuestion: corpus.businessQuestion,
      decisionToInform: corpus.decisionToInform,
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
      bullmq_job_id: job.id,
      status: "running"
    },
    { status: 202 }
  );
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
