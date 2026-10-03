import { createHash } from "node:crypto";
import { listSignalBrandWorkspaceEntriesStoreV1, type SignalBrandWorkspaceEntryV1 } from "@noisia/db";
import { clientBrandCreationDecisionV1 } from "@/lib/auth/client-brand-self-service";
import { resolveSignalWorkspaceForUser, type ResolvedSignalWorkspace, type SignalWorkspaceUser } from "./signal-workspace";
import { isSignalWorkspaceApiEnabled } from "./serving";

export type ClientBrandWorkspaceEntryV1 = {
  workspaceId: string;
  workspaceSlug: string;
  brandId: string;
  name: string;
  timezone: string;
  capabilities: SignalBrandWorkspaceEntryV1["capabilities"];
  canManageBrandContext: boolean;
  navigation: { brandOsHref: string; topicsHref: string; dataHref: string; signalHref: string };
  requestScope: string;
};
type EntryDependencies = {
  enabled: () => boolean;
  list: (actorUserId: string, workspaceSlug?: string) => Promise<SignalBrandWorkspaceEntryV1[]>;
  resolve: (actor: SignalWorkspaceUser, workspaceSlug: string) => Promise<ResolvedSignalWorkspace | null>;
};
const defaults: EntryDependencies = {
  enabled: isSignalWorkspaceApiEnabled,
  list: async (actorUserId, workspaceSlug) => {
    const { pool } = await import("@/lib/db");
    return listSignalBrandWorkspaceEntriesStoreV1({ queryable: pool, actor_user_id: actorUserId,
      ...(workspaceSlug === undefined ? {} : { workspace_slug: workspaceSlug }) });
  },
  resolve: (actor, workspaceSlug) => resolveSignalWorkspaceForUser(actor, { workspaceSlug })
};

type ClientWorkspaceActor = SignalWorkspaceUser & { primaryRole: string; status: string };

function publicEntry(actor: ClientWorkspaceActor, row: SignalBrandWorkspaceEntryV1): ClientBrandWorkspaceEntryV1 {
  const base = `/signal/${encodeURIComponent(row.workspace_slug)}`;
  return { workspaceId: row.workspace_id, workspaceSlug: row.workspace_slug, brandId: row.brand_id,
    name: row.name, timezone: row.timezone, capabilities: row.capabilities,
    canManageBrandContext: clientBrandCreationDecisionV1(actor).allowed && row.capabilities.can_edit_topics,
    navigation: { brandOsHref: `${base}/manage/brand-os`, topicsHref: `${base}/manage/topics`, dataHref: `${base}/manage/data`, signalHref: base },
    requestScope: createHash("sha256").update(`${actor.id}:${row.workspace_id}`).digest("hex") };
}

/** Assigned brands are an authenticated workspace inventory, independent of published reports. */
export async function listClientBrandWorkspaceEntriesV1(actor: ClientWorkspaceActor,
  dependencies: Pick<EntryDependencies, "list" | "enabled"> = defaults): Promise<ClientBrandWorkspaceEntryV1[]> {
  if (!dependencies.enabled()) return [];
  const rows = await dependencies.list(actor.id);
  return rows.filter(row => row.capabilities.can_view).map(row => publicEntry(actor, row));
}

/** Management always resolves an explicit authorized brand slug, never a legacy output fallback. */
export async function loadClientBrandWorkspaceEntryV1(actor: ClientWorkspaceActor, workspaceSlug: string,
  dependencies: EntryDependencies = defaults): Promise<(ClientBrandWorkspaceEntryV1 & { workspace: ResolvedSignalWorkspace }) | null> {
  if (!dependencies.enabled() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(workspaceSlug)) return null;
  const rows = await dependencies.list(actor.id, workspaceSlug);
  // Internal users can see the same slug in several organizations. Do not guess its owner.
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  if (!row.capabilities.can_view || row.workspace_slug !== workspaceSlug) return null;
  const workspace = await dependencies.resolve(actor, workspaceSlug);
  if (!workspace || workspace.status !== "active" || workspace.subject.type !== "brand"
    || workspace.id !== row.workspace_id || workspace.subject.id !== row.brand_id
    || workspace.slug !== row.workspace_slug || workspace.organizationId !== row.organization_id) return null;
  return { ...publicEntry(actor, row), workspace };
}
