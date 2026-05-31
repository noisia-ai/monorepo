import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { requireStudioUser } from "@/lib/auth/guards";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";

export const dynamic = "force-dynamic";

export default async function TbAnalysisIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/corpora/${id}/analysis`);
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) notFound();

  const state = await getTbAnalysisForCorpus(corpus.id);
  if (state) {
    redirect(`/studio/corpora/${corpus.id}/analysis/${state.analysis.id}`);
  }

  return (
    <div className="studio-page analysis-review-page">
      <section className="analysis-review-hero">
        <div>
          <Link prefetch={false} className="analysis-back-link" href={`/studio/corpora/${corpus.id}/engine`}>
            <Icon name="arrow-right" size={14} />
            Volver al engine
          </Link>
          <p className="vitals-eyebrow">Review T&B</p>
          <h1>Todavía no hay síntesis</h1>
          <p>
            Primero aprueba el corpus y lanza el análisis desde Engine. Cuando termine,
            esta ruta abre la revisión del output.
          </p>
        </div>
        <Link prefetch={false} className="wizard-cta" href={`/studio/corpora/${corpus.id}/engine`}>
          <Icon name="play" size={16} />
          Ir al flujo
        </Link>
      </section>
    </div>
  );
}
