import { forbidden, unauthorized } from "@/lib/api/responses";
import { canApproveAnalysis, canManageCorpus, canViewClientOutputs } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { getSignalOutputForUser } from "@/lib/data/signal";
import {
  disabledDataOsResponse,
  disabledSignalPulseLiveResponse,
  isSignalPulseLiveApiEnabled,
  isDataOsServingEnabled,
  isSignalWorkspaceApiEnabled
} from "@/lib/data-os/serving";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import {
  loadSignalWorkspaceContextWithDependencies,
  type SignalWorkspaceSession
} from "@/lib/data-os/signal-workspace-context";
import {
  finalizeSignalModuleServingScopeV1,
  resolveSignalModuleServingScopeV1,
  signalClientServingViewFromRequestV1,
  type SignalBrandServingModuleKeyV1
} from "@/lib/data-os/signal-module-serving-scope";
import type { SignalFilterV1 } from "@noisia/query-engine";
import { signalBackendErrorResponse } from "@/lib/data-os/signal-workspace-serving";
import { isSignalPulseOutput } from "@/lib/signal-pulse/pulse-api";
import {
  resolveSignalPulseVisibility,
  type SignalPulseResolvedVisibility
} from "@/lib/signal-pulse/runtime-contracts";

type PulseVisibilityKey = keyof SignalPulseResolvedVisibility;

export async function loadDataOsCorpusContext(corpusId: string) {
  const session = await getAuthenticatedAppUser();
  if (!session) return { response: unauthorized() } as const;
  if (!canManageCorpus(session.appUser.primaryRole)) return { response: forbidden() } as const;
  if (!isDataOsServingEnabled()) return { response: disabledDataOsResponse() } as const;

  const corpus = await getCorpusForUser(session.appUser, corpusId);
  if (!corpus) {
    return {
      response: Response.json({ error: "not_found", message: "Corpus not found or inaccessible." }, { status: 404 })
    } as const;
  }

  return { corpus, session } as const;
}

function forbiddenPulseLiveScopeResponse(scope: string) {
  return Response.json(
    {
      error: "data_os_live_scope_forbidden",
      message: `Signal Pulse live ${scope} is not enabled for this output visibility.`,
      fallback: "published_outputs.payload"
    },
    { status: 403 }
  );
}

export async function loadDataOsPulseContext(outputId: string, options: {
  requiredVisibility?: PulseVisibilityKey;
  scope?: string;
} = {}) {
  const session = await getAuthenticatedAppUser();
  if (!session) return { response: unauthorized() } as const;
  if (!canViewClientOutputs(session.appUser.primaryRole)) return { response: forbidden() } as const;
  if (!isDataOsServingEnabled()) return { response: disabledDataOsResponse() } as const;
  if (!isSignalPulseLiveApiEnabled()) return { response: disabledSignalPulseLiveResponse() } as const;

  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!isSignalPulseOutput(output)) {
    return {
      response: Response.json({ error: "not_found", message: "Signal Pulse output not found." }, { status: 404 })
    } as const;
  }

  const visibility = resolveSignalPulseVisibility({
    config: output.visibilityConfig,
    isInternalUser: session.appUser.userType === "noisia_internal"
  });
  if (options.requiredVisibility && !visibility[options.requiredVisibility]) {
    return { response: forbiddenPulseLiveScopeResponse(options.scope ?? options.requiredVisibility) } as const;
  }

  return { output, session, visibility } as const;
}

export async function loadSignalWorkspaceModuleContext(
  workspaceId: string,
  moduleKey: SignalBrandServingModuleKeyV1,
  request?: Request
) {
  const loaded = await loadSignalWorkspaceContextWithDependencies(workspaceId, {
    getSession: getAuthenticatedAppUser as () => Promise<SignalWorkspaceSession | null>,
    isEnabled: isSignalWorkspaceApiEnabled,
    canView: canViewClientOutputs,
    resolveWorkspace: resolveSignalWorkspaceForUser
  });
  if (!("workspace" in loaded)) return { response: loaded.response } as const;
  const workspace = loaded.workspace;
  if (!workspace) {
    return { response: signalBackendErrorResponse(new Error("Workspace context is unavailable.")) } as const;
  }
  try {
    const viewKey = request
      ? signalClientServingViewFromRequestV1(request)
      : "brand";
    const servingScope = await resolveSignalModuleServingScopeV1(workspace, moduleKey, {
      viewKey
    });
    return {
      ...loaded,
      workspace,
      servingScope,
      readScope: servingScope.readScope,
      finalizeServingScope: (filter: SignalFilterV1 | null) => (
        finalizeSignalModuleServingScopeV1({ scope: servingScope, filter })
      )
    } as const;
  } catch (error) {
    return { response: signalBackendErrorResponse(error) } as const;
  }
}

/** @deprecated Serving routes must resolve their closed module identity explicitly. */
export function loadSignalWorkspaceContext(workspaceId: string) {
  return loadSignalWorkspaceModuleContext(workspaceId, "brand-monitoring");
}

export function loadSignalWorkspaceContextForManagement(workspaceId: string) {
  return loadSignalWorkspaceContextWithDependencies(workspaceId, {
    getSession: getAuthenticatedAppUser as () => Promise<SignalWorkspaceSession | null>,
    isEnabled: isSignalWorkspaceApiEnabled,
    canView: canManageCorpus,
    resolveWorkspace: resolveSignalWorkspaceForUser
  });
}

export function loadSignalWorkspaceContextForStrategicReview(workspaceId: string) {
  return loadSignalWorkspaceContextWithDependencies(workspaceId, {
    getSession: getAuthenticatedAppUser as () => Promise<SignalWorkspaceSession | null>,
    isEnabled: isSignalWorkspaceApiEnabled,
    canView: canApproveAnalysis,
    resolveWorkspace: resolveSignalWorkspaceForUser
  });
}
