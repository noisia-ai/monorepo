import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceCorpus
} from "@/lib/data-os/signal-workspace";
import type { SignalStrategicReleaseSummary } from "@/lib/data-os/signal-strategic-releases";

export type SignalStrategicStudyNavigationItem = {
  id: string;
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
  return args.workspace.corpora
    .filter(isStrategicStudy)
    .map((corpus) => {
      const releases = args.releases
        .filter((release) => release.study_corpus_id === corpus.id)
        .sort(compareReleases);
      return {
        id: corpus.id,
        title: corpus.name?.trim() || "Triggers & Barriers",
        href: `/signal/${args.workspace.slug}?study=${corpus.id}`,
        status: corpus.status,
        legacyOutputId: corpus.outputId,
        currentRelease: releases.find((release) => release.is_current)
          ?? releases.find((release) => release.status === "published")
          ?? releases[0]
          ?? null,
        releases
      };
    })
    .sort((left, right) => {
      const leftDate = left.currentRelease?.period_end ?? "";
      const rightDate = right.currentRelease?.period_end ?? "";
      return rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title);
    });
}

export function findSignalStrategicStudy(
  studies: SignalStrategicStudyNavigationItem[],
  requestedId: string | null | undefined
) {
  if (!requestedId) return null;
  return studies.find((study) => study.id === requestedId) ?? null;
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
