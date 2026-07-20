import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus, canViewClientOutputs } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { getSignalOutputForUser } from "@/lib/data/signal";
import {
  disabledDataOsResponse,
  disabledSignalPulseLiveResponse,
  isSignalPulseLiveApiEnabled,
  isDataOsServingEnabled
} from "@/lib/data-os/serving";
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
