import { notFound } from "next/navigation";

import { TbAnalysisRunPanel } from "@/components/analysis/TbAnalysisRunPanel";
import { EngineMethodologyBetaPanel } from "@/components/engine/EngineMethodologyBetaPanel";
import { EngineWizard } from "@/components/engine/EngineWizard";
import { requireStudioUser } from "@/lib/auth/guards";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { getCorpusEngineState, getCorpusForUser, getTbAnalysisForCorpus, listCorpusEntitiesForCorpus } from "@/lib/data/corpora";
import { getDataOsCorpusReadiness } from "@/lib/data-os/readiness";
import { isEngineBetaPanelEnabled } from "@/lib/engine/methodology-options";

export const dynamic = "force-dynamic";

export default async function CorpusEnginePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/corpora/${id}/engine`);

  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    notFound();
  }

  const state = await getCorpusEngineState(corpus.id);
  const latestAnalysis = await getTbAnalysisForCorpus(corpus.id);
  const entities = await listCorpusEntitiesForCorpus(corpus.id);
  const brand = corpus.brandId ? await getBrandDetailForUser(session.appUser, corpus.brandId) : null;
  const isSignalPulseCorpus = corpus.methodologySlug === "signal-pulse";
  const showEngineBeta = isEngineBetaPanelEnabled();
  const selectedLensCount = 1;
  const dataOsReadiness = await getDataOsCorpusReadiness(corpus.id);

  return (
    <div className="studio-page">
      <EngineWizard
        corpusId={corpus.id}
        corpusName={corpus.name ?? corpus.brandName ?? corpus.themeName ?? "Corpus"}
        subjectType={corpus.themeId ? "theme" : "brand"}
        methodologyName={corpus.methodologyName ?? null}
        corpus={state.corpus}
        iterations={state.iterations}
        batches={state.batches}
        queryPacks={state.queryPacks}
        selectedLensCount={selectedLensCount}
        dataOsReadiness={dataOsReadiness}
        current={state.current}
        activeStep={state.activeStep}
        isApproved={state.isApproved}
        queryReady={state.queryReady}
        queryValidation={state.queryValidation}
        assessment={state.assessment as never}
        assessedAt={state.assessedAt}
        corpusRevision={state.corpusRevision}
        latestAssessedRevision={state.latestAssessedRevision}
        assessmentCurrent={state.assessmentCurrent}
        snapshots={state.snapshots}
        cleanups={state.cleanups}
        competitors={brand?.competitors ?? []}
        entities={entities}
      />
      {!isSignalPulseCorpus && (
        <TbAnalysisRunPanel
          corpusId={corpus.id}
          corpusApproved={state.isApproved}
          includedCount={state.corpus.included}
          assessment={state.assessment as never}
          latestState={latestAnalysis}
        />
      )}
      {showEngineBeta && (
        <EngineMethodologyBetaPanel
          corpusId={corpus.id}
          corpusName={corpus.name ?? corpus.brandName ?? corpus.themeName ?? "Corpus"}
          primaryMethodologySlug={corpus.methodologySlug}
        />
      )}
    </div>
  );
}
