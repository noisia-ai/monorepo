import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceCorpus
} from "@/lib/data-os/signal-workspace";
import type { SignalStrategicReleaseSummary } from "@/lib/data-os/signal-strategic-releases";

export type SignalStrategicStudyNavigationItem = {
  id: string;
  reportKey: string;
  title: string;
  href: string;
  status: string;
  legacyOutputId: string | null;
  currentRelease: SignalStrategicReleaseSummary | null;
  releases: SignalStrategicReleaseSummary[];
};

export function buildSignalStrategicStudyNavigation(args: {
  workspace: ResolvedSignalWorkspace;
  releases: SignalStrategicReleaseSummary[];
}): SignalStrategicStudyNavigationItem[] {
  const strategicCorpora = args.workspace.corpora.filter(isStrategicStudy);
  const releases = [...args.releases]
    .filter((release) => (release.report_key ?? "triggers-barriers") === "triggers-barriers")
    .sort(compareReleases);
  const currentRelease = releases.find((release) => release.is_current)
    ?? releases.find((release) => release.status === "published")
    ?? releases[0]
    ?? null;
  const executionCorpus = strategicCorpora.find((corpus) => (
    corpus.id === currentRelease?.study_corpus_id
  )) ?? strategicCorpora.sort((left, right) => (
    right.validFrom.localeCompare(left.validFrom)
  ))[0];
  return [{
    // The client identity is the workspace report. An execution corpus is
    // compatibility/provenance only and never creates another navigation item.
    id: "triggers-barriers",
    reportKey: "triggers-barriers",
    title: "Triggers & Barriers",
    href: `/signal/${args.workspace.slug}/reports/triggers-barriers`,
    status: currentRelease?.status ?? executionCorpus?.status ?? "not_available",
    legacyOutputId: executionCorpus?.outputId ?? null,
    currentRelease,
    releases
  }];
}

export function findSignalStrategicStudy(
  studies: SignalStrategicStudyNavigationItem[],
  requestedId: string | null | undefined
) {
  if (!requestedId) return null;
  return studies.find((study) => (
    study.id === requestedId
    || study.reportKey === requestedId
    || study.currentRelease?.study_corpus_id === requestedId
    || study.releases.some((release) => release.study_corpus_id === requestedId)
  )) ?? null;
}

function isStrategicStudy(corpus: SignalWorkspaceCorpus) {
  return corpus.methodologySlug === "triggers-barriers";
}

function compareReleases(
  left: SignalStrategicReleaseSummary,
  right: SignalStrategicReleaseSummary
) {
  return right.period_end.localeCompare(left.period_end)
    || (right.published_at ?? "").localeCompare(left.published_at ?? "")
    || right.release_id.localeCompare(left.release_id);
}
