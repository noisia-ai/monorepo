import { notFound } from "next/navigation";
import {
  SignalBackendContractError,
  canonicalSignalFilterQueryV1,
  normalizeSignalClientGovernedViewKeyV1,
  parseSignalAnalyticsQueryParamsV1,
  resolveSignalComparisonV1
} from "@noisia/query-engine";

import { requirePortalUser } from "@/lib/auth/guards";
import { canManageCorpus } from "@/lib/auth/roles";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { loadSignalWorkspaceHomeV1 } from "@/lib/data-os/signal-workspace-home";
import {
  signalOperationalReadMode
} from "@/lib/data-os/signal-operational-read-scope";
import {
  finalizeSignalModuleServingScopeV1,
  resolveSignalClientEvidenceServingScopeV1,
  resolveSignalModuleServingScopeV1
} from "@/lib/data-os/signal-module-serving-scope";
import {
  loadSignalMentionByIdV1,
  loadSignalMentionsV1
} from "@/lib/data-os/signal-workspace-serving";
import {
  listSignalWorkspaceOptionsForUser,
  resolveLegacyOutputSignalWorkspaceForUser,
  resolveSignalWorkspaceForUser
} from "@/lib/data-os/signal-workspace";
import { loadSignalStrategicReleasesV1 } from "@/lib/data-os/signal-strategic-releases";
import { loadSignalTriggersBarriersOverviewV2 } from "@/lib/data-os/signal-triggers-barriers-serving";
import { loadSignalTopicsNarrativesOverviewV1 } from "@/lib/data-os/signal-topics-narratives-serving";
import { loadSignalClientSettingsV1 } from "@/lib/data-os/signal-client-settings";
import {
  buildEmptySignalBrandMonitoringV1,
  loadSignalBrandMonitoringV1
} from "@/lib/signal-v2/brand-monitoring";
import {
  buildSignalStrategicStudyNavigation,
  findSignalStrategicStudy
} from "@/lib/signal-v2/workspace-navigation";
import { SignalV2BrandMonitoring } from "@/components/signal-v2/SignalV2BrandMonitoring";

export async function SignalV2WorkspacePage({
  activeModule = "monitoring",
  activeReportKey,
  legacyOutputId,
  searchParams,
  workspaceSlug
}: {
  activeModule?: "monitoring" | "mentions" | "topics" | "settings";
  activeReportKey?: "triggers-barriers";
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
  const query = await searchParams;
  let viewKey;
  try {
    viewKey = normalizeSignalClientGovernedViewKeyV1(firstQueryValue(query.view) ?? "brand");
  } catch {
    notFound();
  }

  if (activeModule === "settings") {
    const isInternalUser = session.appUser.userType === "noisia_internal";
    const [initialSettings, workspaceOptions, releases] = await Promise.all([
      loadSignalClientSettingsV1(workspace),
      listSignalWorkspaceOptionsForUser(session.appUser),
      loadSignalStrategicReleasesV1(workspace, isInternalUser)
    ]);
    return (
      <SignalV2BrandMonitoring
        activeModule="settings"
        activeStudy={null}
        brandName={workspace.name}
        canRefreshInsights={false}
        initialData={buildEmptySignalBrandMonitoringV1(workspace)}
        initialMention={null}
        initialMentions={null}
        initialSettings={initialSettings}
        initialTopicsNarratives={null}
        initialTriggersBarriers={null}
        legacyOutputId={null}
        strategicStudies={buildSignalStrategicStudyNavigation({ workspace, releases: releases.history })}
        userName={session.appUser.fullName ?? session.appUser.email ?? "Noisia"}
        workspaceOptions={workspaceOptions}
        workspaceSubjectId={workspace.subject.id}
        viewKey={viewKey}
      />
    );
  }

  let brandMonitoringServingScope;
  let mentionsServingScope = null;
  let topicsNarrativesServingScope;
  try {
    [
      brandMonitoringServingScope,
      topicsNarrativesServingScope
    ] = await Promise.all([
      resolveSignalModuleServingScopeV1(workspace, "brand-monitoring", { viewKey }),
      resolveSignalModuleServingScopeV1(workspace, "topics-narratives", { viewKey })
    ]);
    if (activeModule === "mentions") {
      mentionsServingScope = await resolveSignalModuleServingScopeV1(
        workspace,
        "mentions",
        { viewKey }
      );
    }
  } catch (error) {
    const isUnconfiguredLegacyWorkspace = signalOperationalReadMode() === "legacy"
      && error instanceof SignalBackendContractError
      && error.details.reason === "legacy_serving_corpus_not_available";
    const isUnavailableGovernedView = signalOperationalReadMode() === "governed"
      && error instanceof SignalBackendContractError
      && error.code === "not_available";
    if (!isUnconfiguredLegacyWorkspace && !isUnavailableGovernedView) throw error;
    const workspaceOptions = await listSignalWorkspaceOptionsForUser(session.appUser);
    return (
      <SignalV2BrandMonitoring
        activeModule={activeModule}
        activeStudy={null}
        brandName={workspace.name}
        canRefreshInsights={canManageCorpus(session.appUser.primaryRole)}
        emptyWorkspace
        initialData={buildEmptySignalBrandMonitoringV1(workspace)}
        initialMention={null}
        initialMentions={null}
        initialSettings={null}
        initialTopicsNarratives={null}
        initialTriggersBarriers={null}
        legacyOutputId={null}
        strategicStudies={[]}
        userName={session.appUser.fullName ?? session.appUser.email ?? "Noisia"}
        workspaceOptions={workspaceOptions}
        workspaceSubjectId={workspace.subject.id}
        viewKey={viewKey}
      />
    );
  }
  const readScope = brandMonitoringServingScope.readScope;
  const mentionsReadScope = mentionsServingScope?.readScope ?? null;
  const topicsNarrativesReadScope = topicsNarrativesServingScope.readScope;

  const output = legacyOutputId
    ? await getSignalOutputForUser(session.appUser, legacyOutputId)
    : null;
  if (legacyOutputId && !output) notFound();

  const home = await loadSignalWorkspaceHomeV1(
    workspace,
    session.appUser.userType === "noisia_internal",
    readScope,
    { topicsNarrativesReadScope }
  );
  if (!home.default_filter) {
    const workspaceOptions = await listSignalWorkspaceOptionsForUser(session.appUser);
    return (
      <SignalV2BrandMonitoring
        activeModule={activeModule}
        activeStudy={null}
        brandName={workspace.name}
        canRefreshInsights={false}
        emptyWorkspace
        initialData={buildEmptySignalBrandMonitoringV1(workspace)}
        initialMention={null}
        initialMentions={null}
        initialSettings={null}
        initialTopicsNarratives={null}
        initialTriggersBarriers={null}
        legacyOutputId={null}
        strategicStudies={[]}
        userName={session.appUser.fullName ?? session.appUser.email ?? "Noisia"}
        workspaceOptions={workspaceOptions}
        workspaceSubjectId={workspace.subject.id}
        viewKey={viewKey}
      />
    );
  }

  let filter = home.default_filter;
  let comparison = resolveSignalComparisonV1({ filter, mode: "previous_period" });
  try {
    const queryParams = new URLSearchParams(canonicalSignalFilterQueryV1(home.default_filter));
    for (const [key, rawValue] of Object.entries(query)) {
      if (key === "study" || key === "mention" || key === "view") continue;
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
  const requestedMentionId = validUuid(firstQueryValue(query.mention));
  const requestedStudyId = activeReportKey ?? firstQueryValue(query.study);
  const requestedTbStart = firstQueryValue(query.start);
  const requestedTbEnd = firstQueryValue(query.end);
  const [brandMonitoringServingDescriptor, mentionsServingDescriptor,
    topicsNarrativesServingDescriptor, monitoringEvidence] = await Promise.all([
    activeModule === "monitoring" && brandMonitoringServingScope.rollout_mode === "governed"
      ? finalizeSignalModuleServingScopeV1({
          scope: brandMonitoringServingScope,
          filter
        })
      : Promise.resolve(null),
    activeModule === "mentions" && mentionsServingScope?.rollout_mode === "governed"
      ? finalizeSignalModuleServingScopeV1({
          scope: mentionsServingScope,
          filter
        })
      : Promise.resolve(null),
    activeModule === "topics" && topicsNarrativesServingScope.rollout_mode === "governed"
      ? finalizeSignalModuleServingScopeV1({
          scope: topicsNarrativesServingScope,
          filter
        })
      : Promise.resolve(null),
    activeModule === "monitoring" && brandMonitoringServingScope.rollout_mode === "governed"
      ? resolveSignalClientEvidenceServingScopeV1({
          workspace,
          filter,
          ...(mentionsServingScope ? { resolvedScope: mentionsServingScope } : {})
        })
      : Promise.resolve(null)
  ]);
  const [
    initialData,
    initialMentions,
    initialMention,
    initialTopicsNarratives,
    workspaceOptions,
    releases,
    requestedTriggersBarriers
  ] = await Promise.all([
    loadSignalBrandMonitoringV1({
      workspace,
      readScope,
      ...(brandMonitoringServingDescriptor
        ? { evidenceReadScope: monitoringEvidence?.readScope ?? null }
        : {}),
      filter,
      comparison,
      isInternalUser
    }),
    activeModule === "mentions"
      ? loadSignalMentionsV1({
          workspace,
          readScope: mentionsReadScope ?? undefined,
          ...(mentionsServingDescriptor
            ? { servingScope: mentionsServingDescriptor }
            : {}),
          filter,
          limit: 50,
          isInternalUser
        })
      : Promise.resolve(null),
    activeModule === "mentions" && requestedMentionId
      ? loadSignalMentionByIdV1({
          workspace,
          readScope: mentionsReadScope ?? undefined,
          filter,
          mentionId: requestedMentionId,
          isInternalUser
        })
      : Promise.resolve(null),
    activeModule === "topics"
      ? loadSignalTopicsNarrativesOverviewV1({
          workspace,
          readScope: topicsNarrativesReadScope,
          filter,
          comparisonRange: comparison.date_range ?? null,
          isInternalUser
        })
      : Promise.resolve(null),
    listSignalWorkspaceOptionsForUser(session.appUser),
    loadSignalStrategicReleasesV1(workspace, isInternalUser),
    requestedStudyId
      ? loadSignalTriggersBarriersOverviewV2({
          workspace,
          studyCorpusId: activeReportKey ? undefined : requestedStudyId,
          dateFrom: requestedTbStart && requestedTbEnd ? requestedTbStart : null,
          dateTo: requestedTbStart && requestedTbEnd ? requestedTbEnd : null
        })
      : Promise.resolve(null)
  ]);
  const scopedInitialData = brandMonitoringServingDescriptor
    ? {
        ...initialData,
        serving_scope: brandMonitoringServingDescriptor,
        evidence_serving_scope: monitoringEvidence?.servingScope ?? null
      }
    : initialData;
  const scopedInitialMentions = initialMentions && mentionsServingDescriptor
    ? { ...initialMentions, serving_scope: mentionsServingDescriptor }
    : initialMentions;
  const scopedInitialTopicsNarratives = initialTopicsNarratives
    && topicsNarrativesServingDescriptor
    ? {
        ...initialTopicsNarratives,
        serving_scope: topicsNarrativesServingDescriptor
      }
    : initialTopicsNarratives;
  const strategicStudies = buildSignalStrategicStudyNavigation({
    workspace,
    releases: releases.history
  });
  const activeStudy = findSignalStrategicStudy(strategicStudies, requestedStudyId);
  if (requestedStudyId && !activeStudy) notFound();
  const initialTriggersBarriers = activeStudy ? requestedTriggersBarriers : null;

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
      canRefreshInsights={readScope.visibleSource === "legacy_corpus"
        && Boolean(primaryOutputId)
        && canManageCorpus(session.appUser.primaryRole)}
      initialData={scopedInitialData}
      initialMentions={scopedInitialMentions
        ? { ...scopedInitialMentions, filter, comparison }
        : null}
      initialSettings={null}
      initialMention={initialMention}
      initialTopicsNarratives={scopedInitialTopicsNarratives}
      initialTriggersBarriers={initialTriggersBarriers}
      legacyOutputId={primaryOutputId}
      strategicStudies={strategicStudies}
      userName={session.appUser.fullName ?? session.appUser.email ?? "Noisia"}
        workspaceOptions={workspaceOptions}
        workspaceSubjectId={workspace.subject.id}
        viewKey={viewKey}
    />
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validUuid(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : null;
}

function preferredGranularity(start: string, end: string) {
  const startTime = new Date(`${start}T12:00:00Z`).getTime();
  const endTime = new Date(`${end}T12:00:00Z`).getTime();
  const days = Math.round((endTime - startTime) / 86_400_000) + 1;
  if (days <= 90) return "day";
  if (days <= 365) return "week";
  return "month";
}
