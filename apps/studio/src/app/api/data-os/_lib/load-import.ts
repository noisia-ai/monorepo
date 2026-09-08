import { loadSignalWorkspaceCapabilitiesStoreV1 } from "@noisia/db";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { canViewClientOutputs } from "@/lib/auth/roles";
import { isSignalWorkspaceApiEnabled } from "@/lib/data-os/serving";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { loadSignalWorkspaceContextWithDependencies, type SignalWorkspaceSession } from "@/lib/data-os/signal-workspace-context";
import { pool } from "@/lib/db";

export async function loadSignalWorkspaceContextForImport(workspaceId: string) {
  const loaded = await loadSignalWorkspaceContextWithDependencies(workspaceId, {
    getSession: getAuthenticatedAppUser as () => Promise<SignalWorkspaceSession | null>,
    isEnabled: isSignalWorkspaceApiEnabled, canView: canViewClientOutputs,
    resolveWorkspace: resolveSignalWorkspaceForUser
  });
  if ("response" in loaded) return loaded;
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: pool,
    workspace_id: loaded.workspace.id, actor_user_id: loaded.session.appUser.id });
  if (!capabilities.can_import_mentions) return { response: Response.json({ error: "forbidden" }, { status: 403 }) } as const;
  return loaded;
}
