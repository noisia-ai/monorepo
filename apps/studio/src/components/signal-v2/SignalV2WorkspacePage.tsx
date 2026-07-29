import { notFound } from "next/navigation";
import {
  canonicalSignalFilterQueryV1,
  parseSignalAnalyticsQueryParamsV1,
  resolveSignalComparisonV1
} from "@noisia/query-engine";

import { requirePortalUser } from "@/lib/auth/guards";
import { canManageCorpus } from "@/lib/auth/roles";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { loadSignalWorkspaceHomeV1 } from "@/lib/data-os/signal-workspace-home";
import { loadSignalMentionsV1 } from "@/lib/data-os/signal-workspace-serving";
import {
  listSignalWorkspaceOptionsForUser,
  resolveLegacyOutputSignalWorkspaceForUser,
  resolveSignalWorkspaceForUser
} from "@/lib/data-os/signal-workspace";
import { loadSignalStrategicReleasesV1 } from "@/lib/data-os/signal-strategic-releases";
import { loadSignalBrandMonitoringV1 } from "@/lib/signal-v2/brand-monitoring";
import {
  buildSignalStrategicStudyNavigation,
  findSignalStrategicStudy
} from "@/lib/signal-v2/workspace-navigation";
import { SignalV2BrandMonitoring } from "@/components/signal-v2/SignalV2BrandMonitoring";

export async function SignalV2WorkspacePage({
  activeModule = "monitoring",
  legacyOutputId,
  searchParams,
  workspaceSlug
}: {
  activeModule?: "monitoring" | "mentions";
  legacyOutputId?: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  workspaceSlug?: string;
}) {
  const returnPath = workspaceSlug
    ? `/signal/${workspaceSlug}`
    : `/signal-v2/${legacyOutputId ?? ""}`;
  const session = await requirePortalUser(returnPath);
  const workspace = workspaceSlug
    ? await resolveSignalWorkspaceForUser(session.appUser, { workspaceSlug })
    : legacyOutputId
      ? await resolveLegacyOutputSignalWorkspaceForUser(session.appUser, legacyOutputId)
      : null;
  if (!workspace || workspace.status !== "active") notFound();

  const output = legacyOutputId
    ? await getSignalOutputForUser(session.appUser, legacyOutputId)
    : null;
  if (legacyOutputId && !output) notFound();

  const home = await loadSignalWorkspaceHomeV1(
    workspace,
    session.appUser.userType === "noisia_internal"
  );
  if (!home.default_filter) notFound();

  const query = await searchParams;
  let filter = home.default_filter;
  let comparison = resolveSignalComparisonV1({ filter, mode: "previous_period" });
  try {
    const queryParams = new URLSearchParams(canonicalSignalFilterQueryV1(home.default_filter));
    for (const [key, rawValue] of Object.entries(query)) {
      if (key === "study") continue;
      queryParams.delete(key);
      for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
        if (value != null) queryParams.append(key, value);
      }
    }
    queryParams.set("timezone", workspace.timezone);
    const requestedStart = queryParams.get("start");
    const requestedEnd = queryParams.get("end");
    if (requestedStart && requestedEnd && query.granularity == null) {
      queryParams.set("granularity", preferredGranularity(requestedStart, requestedEnd));
    }
    ({ filter, comparison } = parseSignalAnalyticsQueryParamsV1(queryParams));
  } catch {
    filter = home.default_filter;
    comparison = resolveSignalComparisonV1({ filter, mode: "previous_period" });
  }

  const isInternalUser = session.appUser.userType === "noisia_internal";
  const [initialData, initialMentions, workspaceOptions, releases] = await Promise.all([
    loadSignalBrandMonitoringV1({
      workspace,
      filter,
      comparison,
      isInternalUser
    }),
    activeModule === "mentions"
      ? loadSignalMentionsV1({
          workspace,
          filter,
          limit: 50,
          isInternalUser
        })
      : Promise.resolve(null),
    listSignalWorkspaceOptionsForUser(session.appUser),
    loadSignalStrategicReleasesV1(workspace, isInternalUser)
  ]);
  const strategicStudies = buildSignalStrategicStudyNavigation({
    workspace,
    releases: releases.history
  });
  const requestedStudyId = firstQueryValue(query.study);
  const activeStudy = findSignalStrategicStudy(strategicStudies, requestedStudyId);
  if (requestedStudyId && !activeStudy) notFound();

  const primaryOutputId = workspace.corpora.find((corpus) => (
    corpus.role === "operational" && corpus.outputId
  ))?.outputId
    ?? workspace.corpora.find((corpus) => corpus.outputId)?.outputId
    ?? legacyOutputId
    ?? null;

  return (
    <SignalV2BrandMonitoring
      activeModule={activeModule}
      activeStudy={activeStudy}
      brandName={workspace.name}
      canRefreshInsights={canManageCorpus(session.appUser.primaryRole)}
      initialData={initialData}
      initialMentions={initialMentions
        ? { ...initialMentions, filter, comparison }
        : null}
      legacyOutputId={primaryOutputId}
      strategicStudies={strategicStudies}
      userName={session.appUser.fullName ?? session.appUser.email ?? "Noisia"}
      workspaceOptions={workspaceOptions}
    />
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function preferredGranularity(start: string, end: string) {
  const startTime = new Date(`${start}T12:00:00Z`).getTime();
  const endTime = new Date(`${end}T12:00:00Z`).getTime();
  const days = Math.round((endTime - startTime) / 86_400_000) + 1;
  if (days <= 90) return "day";
  if (days <= 365) return "week";
  return "month";
}
