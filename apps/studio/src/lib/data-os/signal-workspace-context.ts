import { SignalBackendContractError } from "@noisia/query-engine";

import { forbidden, unauthorized } from "@/lib/api/responses";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

export type SignalWorkspaceSession = {
  appUser: SignalWorkspaceUser & { primaryRole: string; status: string };
};

export type SignalWorkspaceContextDependencies = {
  getSession: () => Promise<SignalWorkspaceSession | null>;
  isEnabled: () => boolean;
  canView: (role: string) => boolean;
  resolveWorkspace: (user: SignalWorkspaceUser, lookup: { workspaceId: string }) => Promise<ResolvedSignalWorkspace | null>;
};

export async function loadSignalWorkspaceContextWithDependencies(
  workspaceId: string,
  dependencies: SignalWorkspaceContextDependencies
) {
  const session = await dependencies.getSession();
  if (!session) return { response: unauthorized() } as const;
  if (session.appUser.status === "suspended" || !dependencies.canView(session.appUser.primaryRole)) {
    return { response: forbidden() } as const;
  }
  if (!dependencies.isEnabled()) {
    return {
      response: Response.json(new SignalBackendContractError(
        "not_available",
        "Signal workspace serving is disabled.",
        { required_flags: ["NOISIA_DATA_OS_ENABLED", "NOISIA_DATA_OS_SERVING_ENABLED", "NOISIA_SIGNAL_WORKSPACE_API_ENABLED"] }
      ).toJSON(), { status: 503 })
    } as const;
  }
  let workspace: ResolvedSignalWorkspace | null;
  try {
    workspace = await dependencies.resolveWorkspace(session.appUser, { workspaceId });
  } catch (error) {
    return {
      response: Response.json(new SignalBackendContractError(
        "invalid_filter",
        error instanceof Error ? error.message : "Invalid Signal workspace locator.",
        { field: "workspace_id" }
      ).toJSON(), { status: 400 })
    } as const;
  }
  if (!workspace) {
    return {
      response: Response.json(new SignalBackendContractError(
        "not_available",
        "Signal workspace was not found or is inaccessible."
      ).toJSON(), { status: 404 })
    } as const;
  }
  if (workspace.status !== "active") {
    return {
      response: Response.json(new SignalBackendContractError(
        "not_available",
        "Signal workspace is not active."
      ).toJSON(), { status: 404 })
    } as const;
  }
  const operationalCorpora = workspace.corpora.filter((corpus) => corpus.role === "operational");
  const corpora = (operationalCorpora.length > 0
    ? operationalCorpora
    : workspace.corpora.filter((corpus) => corpus.role === "legacy"))
    .sort((left, right) => right.validFrom.localeCompare(left.validFrom))
    .slice(0, 1);
  if (corpora.length === 0) {
    return {
      response: Response.json(new SignalBackendContractError(
        "not_available",
        "Signal workspace has no active operational corpus."
      ).toJSON(), { status: 404 })
    } as const;
  }
  return {
    workspace: { ...workspace, corpora },
    session,
    isInternalUser: session.appUser.userType === "noisia_internal"
  } as const;
}
