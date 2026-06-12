import { notFound } from "next/navigation";

import { TbAnalysisRunPanel } from "@/components/analysis/TbAnalysisRunPanel";
import { EngineMethodologyBetaPanel } from "@/components/engine/EngineMethodologyBetaPanel";
import { EngineWizard } from "@/components/engine/EngineWizard";
import { Icon } from "@/components/ui/Icon";
import { requireStudioUser } from "@/lib/auth/guards";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { getCorpusEngineState, getCorpusForUser, getTbAnalysisForCorpus, listCorpusEntitiesForCorpus } from "@/lib/data/corpora";
import { normalizeStudyAnalysisPlan } from "@/lib/multimethod/analysis-plan";

export const dynamic = "force-dynamic";

export default async function CorpusEnginePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/corpora/${id}/engine`);
  const query = searchParams ? await searchParams : {};

  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    notFound();
  }

  const state = await getCorpusEngineState(corpus.id);
  const latestAnalysis = await getTbAnalysisForCorpus(corpus.id);
  const entities = await listCorpusEntitiesForCorpus(corpus.id);
  const brand = corpus.brandId ? await getBrandDetailForUser(session.appUser, corpus.brandId) : null;
  const isSignalPulseCorpus = corpus.methodologySlug === "signal-pulse";
  const showEngineBeta = isSignalPulseCorpus || process.env.NOISIA_SHOW_ENGINE_BETA_PANEL === "true" || query.engineBeta === "1";
  const selectedLensCount = normalizeStudyAnalysisPlan(corpus.analysisPlan, corpus.methodologySlug ?? undefined).selected_lenses.length;

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
        current={state.current}
        activeStep={state.activeStep}
        isApproved={state.isApproved}
        readyToApprove={state.readyToApprove}
        assessment={state.assessment as never}
        assessedAt={state.assessedAt}
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
      {showEngineBeta ? (
        <EngineMethodologyBetaPanel
          corpusId={corpus.id}
          corpusName={corpus.name ?? corpus.brandName ?? corpus.themeName ?? "Corpus"}
          primaryMethodologySlug={corpus.methodologySlug}
        />
      ) : (
        <section className="engine-technical-entry">
          <div>
            <p className="eyebrow">Panel técnico</p>
            <h2>Los lentes metodológicos viven en el panel técnico</h2>
            <p>
              El wizard genera query packs por lente y T&B corre primero. Abre este panel para monitorear
              los lentes seleccionados, revisar bloqueos o reintentar análisis sin repetir el corpus.
            </p>
          </div>
          <a className="wizard-cta wizard-cta--ghost" href={`/studio/corpora/${corpus.id}/engine?engineBeta=1`}>
            <Icon name="sparkle" size={15} />
            Abrir beta técnico
          </a>
        </section>
      )}
    </div>
  );
}
