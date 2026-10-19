import { loadSignalWorkspaceCapabilitiesStoreV1 } from "@noisia/db";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

/** Server-only call-site scope; it is never parsed from an HTTP request. */
export type ManualImportAccessV1 = { access?: "manual-import" };

export async function assertWorkspaceImportAuthorityV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: args.queryable,
    workspace_id: args.workspace.id, actor_user_id: args.actor.id });
  if (!capabilities.can_import_mentions || args.workspace.subject.type !== "brand") {
    throw new Error("Workspace import is unauthorized.");
  }
}

export async function assertWorkspaceImportActorV1(queryable: SignalBrandPolicyQueryable, workspaceId: string, actor: SignalWorkspaceUser) {
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable,
    workspace_id: workspaceId, actor_user_id: actor.id });
  if (!capabilities.can_import_mentions) throw new Error("Workspace import is unauthorized.");
}
