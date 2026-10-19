import { and, eq, sql } from "drizzle-orm";

import { corpusSnapshots, studyCorpora } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { createCorpusSnapshot } from "@/lib/corpus/snapshots";
import { getCorpusForUser } from "@/lib/data/corpora";
import { reconcileCorpusListeningDataOs } from "@/lib/data-os/listening";
import { db } from "@/lib/db";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({})) as {
    override?: boolean;
    override_reason?: string;
  };
  const [approvalState] = await db
    .select({
      corpusRevision: studyCorpora.corpusRevision,
      latestAssessedRevision: studyCorpora.latestAssessedRevision,
      latestAssessment: studyCorpora.latestAssessment
    })
    .from(studyCorpora)
    .where(eq(studyCorpora.id, corpus.id))
    .limit(1);

  if (!approvalState?.latestAssessment || approvalState.latestAssessedRevision !== approvalState.corpusRevision) {
    return Response.json(
      {
        error: "stale_corpus_assessment",
        message: "Diagnostica la revisión actual del corpus antes de aprobarla."
      },
      { status: 409 }
    );
  }

  const assessment = approvalState.latestAssessment as { ready_for_study?: boolean };
  if (assessment.ready_for_study !== true && body.override !== true) {
    return Response.json(
      {
        error: "corpus_not_ready",
        message: "El diagnóstico vigente no recomienda aprobar. Confirma la excepción para continuar."
      },
      { status: 409 }
    );
  }
  const overrideReason = body.override_reason?.trim() ?? "";
  if (assessment.ready_for_study !== true && body.override === true && overrideReason.length < 20) {
    return Response.json(
      {
        error: "override_reason_required",
        message: "Documenta la razón de la excepción (mínimo 20 caracteres) antes de aprobar."
      },
      { status: 400 }
    );
  }

  let dataOs;
  try {
    dataOs = await reconcileCorpusListeningDataOs(corpus.id);
  } catch (error) {
    console.error("[data-os:listening] approval reconciliation failed", error);
    return Response.json(
      {
        error: "data_os_reconciliation_failed",
        message: "No se pudo validar y registrar el listening en Data OS. La aprobación se detuvo sin crear snapshot."
      },
      { status: 503 }
    );
  }
  if (!dataOs.quality.readyForAnalysis) {
    return Response.json(
      {
        error: "data_os_listening_not_ready",
        message: "El listening todavía no cumple el contrato mínimo de Data OS para aprobarse.",
        data_os: dataOs
      },
      { status: 409 }
    );
  }

  const approvedLabel = `Aprobación r${approvalState.corpusRevision} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const snapshot = await createCorpusSnapshot({
    corpusId: corpus.id,
    label: approvedLabel,
    kind: "approval",
    userId: session.appUser.id,
    scores: {
      corpus_revision: approvalState.corpusRevision,
      assessment: approvalState.latestAssessment,
      override: body.override === true,
      override_reason: body.override === true ? overrideReason.slice(0, 1_000) : null
    }
  });

  if (!snapshot) {
    return Response.json(
      { error: "snapshot_failed", message: "No se pudo congelar la revisión aprobada del corpus." },
      { status: 500 }
    );
  }

  const [approvedCorpus] = await db
    .update(studyCorpora)
    .set({
      status: "corpus_approved",
      corpusFirstApprovedAt: sql`coalesce(${studyCorpora.corpusFirstApprovedAt}, now())`,
      updatedAt: new Date()
    })
    .where(and(
      eq(studyCorpora.id, corpus.id),
      eq(studyCorpora.corpusRevision, approvalState.corpusRevision),
      eq(studyCorpora.latestAssessedRevision, approvalState.corpusRevision)
    ))
    .returning({ id: studyCorpora.id });

  if (!approvedCorpus) {
    await db.delete(corpusSnapshots).where(eq(corpusSnapshots.id, snapshot.id));
    return Response.json(
      {
        error: "corpus_changed",
        message: "El corpus cambió durante la aprobación. Vuelve a diagnosticar la revisión actual."
      },
      { status: 409 }
    );
  }

  try {
    const queue = getQueryEngineQueue();
    await queue.add(
      "embed_corpus_semantics",
      { corpusId: corpus.id, mode: "all" },
      {
        jobId: `semantic-${corpus.id}-${Date.now()}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 200 },
        removeOnFail: { age: 60 * 60 * 24 * 7, count: 500 }
      }
    );
  } catch (error) {
    console.warn("[semantic-embeddings] enqueue skipped", error);
  }

  return Response.json({
    ok: true,
    status: "corpus_approved",
    corpus_revision: approvalState.corpusRevision,
    snapshot_id: snapshot.id,
    override: body.override === true,
    data_os: dataOs
  });
}
