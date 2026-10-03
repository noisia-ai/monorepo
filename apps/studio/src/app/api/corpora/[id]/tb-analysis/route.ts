import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { corpusSnapshots, studyCorpora, tbAnalyses } from "@noisia/db";
import {
  type DataOsCorpusAudit,
  type ListeningDataOsReconciliation
} from "@noisia/query-engine";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { auditCorpusDataOs } from "@/lib/data-os/corpus-audit";
import { reconcileCorpusListeningDataOs } from "@/lib/data-os/listening";
import { db, pool } from "@/lib/db";

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
 * POST — compatibility adapter for launching the workspace-native T&B report.
 * Flow:
 *  1. Preserve the legacy corpus approval and Data OS readiness gates.
 *  2. Derive only the requested period from the approval snapshot.
 *  3. Delegate population, relational snapshot, run lock and durable dispatch
 *     to the same workspace/report contract used by the canonical API.
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

  try {
    const body = await request.json();
    const parsed = startBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_body", message: "Tamaño de estudio inválido." }, { status: 400 });
    }
  } catch {
    // The compatibility endpoint remains fail-closed below for malformed legacy bodies.
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

  const scopeResult = await pool.query<{
    period_start: string | null;
    period_end: string | null;
    mention_count: number;
  }>(
    `SELECT
       MIN(mention.published_at)::date::text AS period_start,
       MAX(mention.published_at)::date::text AS period_end,
       COUNT(snapshot_mention.mention_id)::integer AS mention_count
     FROM corpus_snapshot_mentions snapshot_mention
     JOIN mentions mention ON mention.id = snapshot_mention.mention_id
     WHERE snapshot_mention.snapshot_id = $1::uuid`,
    [snapshot.id]
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
  const workspaceScope = await pool.query<{ workspace_id: string; timezone: string }>(
    `SELECT workspace.id::text AS workspace_id, workspace.timezone
     FROM signal_workspace_corpora membership
     JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
     WHERE membership.study_corpus_id = $1::uuid
       AND membership.valid_to IS NULL
       AND workspace.status = 'active'
     ORDER BY CASE membership.role WHEN 'strategic' THEN 0 WHEN 'operational' THEN 1 ELSE 2 END
     LIMIT 1`,
    [corpus.id]
  );
  const workspace = workspaceScope.rows[0];
  if (!workspace) {
    return Response.json(
      {
        error: "workspace_report_not_available",
        message: "El corpus no está vinculado a un workspace Signal activo."
      },
      { status: 409 }
    );
  }
  // Keep this compatibility endpoint available for rollback/read history, but
  // do not let it bypass the workspace-native governed preflight and hard cap.
  return Response.json({
    error: "strategic_gate_d_preflight_required",
    message: "Inicia T&B desde el workspace Signal después del preflight gobernado."
  }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
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
