import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "@noisia/db";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const groupKey = /^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u;
const pageSize = 30;
type Scope = { database?: Pick<Pool, "connect">; workspaceId: string; actorUserId: string;
  numericExecutionId: string; groupKey: string; cursor?: string | null };
export type AtomicGroupMembersPageV1 = { contract_version: "workspace-topic-atomic-group-members-v1";
  workspace_id: string; numeric_execution_id: string; group_key: string; root_count: number;
  page_size: number; next_cursor: string | null; items: Array<{ root_id: string; chunk_count: number;
    platform: string; published_at: string; snippet: string }> };

export class AtomicGroupMembersError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

/** One original group, one keyset page. Never hydrates all member roots or a corpus text asset. */
export async function loadWorkspaceTopicAtomicGroupMembersV1(args: Scope): Promise<AtomicGroupMembersPageV1> {
  if (![args.workspaceId, args.actorUserId, args.numericExecutionId].every(value => uuid.test(value))
    || !groupKey.test(args.groupKey) || args.cursor != null && !uuid.test(args.cursor))
    throw new AtomicGroupMembersError("topic_atomic_members_request_invalid", 422);
  const database = args.database ?? (await import("@/lib/db")).pool;
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client,
      workspace_id: args.workspaceId, actor_user_id: args.actorUserId });
    if (!caps.can_view) throw new AtomicGroupMembersError("topic_atomic_members_forbidden", 403);
    const group = (await client.query<{ id: string; root_count: number }>(`
      SELECT g.id,g.root_count
      FROM signal_topic_consolidation_executions execution
      JOIN signal_topic_consolidation_runs run ON run.id=execution.consolidation_run_id AND run.workspace_id=execution.workspace_id
      JOIN signal_topic_atomic_groups g ON g.consolidation_run_id=run.id AND g.workspace_id=run.workspace_id
      WHERE execution.workspace_id=$1::uuid AND execution.id=$2::uuid AND execution.status='ready'
        AND run.status IN('ready_for_review','reviewing','validated','superseded') AND g.group_key=$3`,
    [args.workspaceId, args.numericExecutionId, args.groupKey])).rows[0];
    if (!group) throw new AtomicGroupMembersError("topic_atomic_members_unavailable", 404);
    const rows = (await client.query<{ root_id: string; chunk_count: number; platform: string;
      published_at: string; snippet: string }>(`
      SELECT member.canonical_root_id root_id,member.chunk_count,mention.platform,
        to_char(mention.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') published_at,
        left(COALESCE(NULLIF(btrim(mention.text_snippet),''),mention.text_clean),240) snippet
      FROM signal_topic_atomic_group_roots member
      JOIN mentions mention ON mention.id=member.canonical_root_id AND mention.workspace_id=member.workspace_id
      WHERE member.workspace_id=$1::uuid AND member.atomic_group_id=$2::uuid
        AND ($3::uuid IS NULL OR member.canonical_root_id>$3::uuid)
      ORDER BY member.canonical_root_id LIMIT ${pageSize + 1}`,
    [args.workspaceId, group.id, args.cursor ?? null])).rows;
    await client.query("COMMIT");
    const items = rows.slice(0, pageSize);
    return { contract_version: "workspace-topic-atomic-group-members-v1", workspace_id: args.workspaceId,
      numeric_execution_id: args.numericExecutionId, group_key: args.groupKey, root_count: group.root_count,
      page_size: pageSize, next_cursor: rows.length > pageSize ? items.at(-1)!.root_id : null, items };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
