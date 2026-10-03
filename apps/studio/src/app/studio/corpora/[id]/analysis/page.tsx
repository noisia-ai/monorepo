import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { Icon } from "@/components/ui/Icon";
import { requireStudioUser } from "@/lib/auth/guards";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TbAnalysisIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/corpora/${id}/analysis`);
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) notFound();

  if (corpus.methodologySlug === "signal-pulse") {
    const latest = await getLatestSignalPulseAnalysisId(corpus.id);
    if (latest) {
      redirect(`/studio/corpora/${corpus.id}/analysis/${latest}`);
    }
  }

  const state = await getTbAnalysisForCorpus(corpus.id);
  if (state) {
    redirect(`/studio/corpora/${corpus.id}/analysis/${state.analysis.id}`);
  }

  return (
    <div className="admin-workspace-page admin-study-surface analysis-review-page">
      <AdminWorkspaceHeader
        actions={(
          <>
            <Link prefetch={false} className="admin-button" href={`/studio/corpora/${corpus.id}/engine`}>
              Volver al engine
            </Link>
            <Link prefetch={false} className="admin-button admin-button--primary" href={`/studio/corpora/${corpus.id}/engine`}>
              <Icon name="play" size={16} />
              Ir al flujo
            </Link>
          </>
        )}
        eyebrow={corpus.methodologySlug === "signal-pulse" ? "Review Signal Pulse" : "Review T&B"}
        subtitle="Primero aprueba el corpus y lanza el análisis desde Engine. Cuando termine, esta ruta abre la revisión del output antes de publicar."
        title={corpus.methodologySlug === "signal-pulse" ? "Todavía no hay corte" : "Todavía no hay síntesis"}
      />
    </div>
  );
}

async function getLatestSignalPulseAnalysisId(corpusId: string) {
  const row = (await pool.query<{ id: string }>(
    `SELECT id::text
     FROM engine_analyses
     WHERE study_corpus_id = $1
       AND methodology_slug = 'signal-pulse'
     ORDER BY created_at DESC
     LIMIT 1`,
    [corpusId]
  )).rows[0];
  return row?.id ?? null;
}
