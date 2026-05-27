import { notFound } from "next/navigation";

import { TbAnalysisRunPanel } from "@/components/analysis/TbAnalysisRunPanel";
import { EngineWizard } from "@/components/engine/EngineWizard";
import { requireStudioUser } from "@/lib/auth/guards";
import { getCorpusEngineState, getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";

export const dynamic = "force-dynamic";

export default async function CorpusEnginePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/corpora/${id}/engine`);

  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    notFound();
  }

  const state = await getCorpusEngineState(corpus.id);
  const latestAnalysis = await getTbAnalysisForCorpus(corpus.id);

  return (
    <div className="studio-page">
      <EngineWizard
        corpusId={corpus.id}
        corpusName={corpus.name ?? corpus.brandName ?? corpus.themeName ?? "Corpus"}
        methodologyName={corpus.methodologyName ?? null}
        corpus={state.corpus}
        iterations={state.iterations}
        batches={state.batches}
        current={state.current}
        activeStep={state.activeStep}
        isApproved={state.isApproved}
        readyToApprove={state.readyToApprove}
        assessment={state.assessment as never}
        assessedAt={state.assessedAt}
        snapshots={state.snapshots}
        cleanups={state.cleanups}
      />
      <TbAnalysisRunPanel
        corpusId={corpus.id}
        corpusApproved={state.isApproved}
        includedCount={state.corpus.included}
        latestState={latestAnalysis}
      />
    </div>
  );
}
