"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AtomicGroupMembersPageV1 } from "@/lib/data-os/workspace-topic-atomic-members";

function validPage(value: unknown, workspaceId: string, numericExecutionId: string,
  groupKey: string): value is AtomicGroupMembersPageV1 {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<AtomicGroupMembersPageV1>;
  return page.contract_version === "workspace-topic-atomic-group-members-v1"
    && page.workspace_id === workspaceId && page.numeric_execution_id === numericExecutionId
    && page.group_key === groupKey && Number.isSafeInteger(page.root_count) && page.page_size === 30
    && (page.next_cursor === null || typeof page.next_cursor === "string")
    && Array.isArray(page.items) && page.items.length <= 30;
}

export function WorkspaceTopicAtomicMembers({ workspaceId, numericExecutionId, groupKey, mentionsHref }: {
  workspaceId: string; numericExecutionId: string; groupKey: string; mentionsHref: string;
}) {
  const t = useTranslations("AdminWorkspace.topics.consolidation.census");
  const panelId = useId();
  const [open, setOpen] = useState(false), [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [data, setData] = useState<AtomicGroupMembersPageV1 | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const cursor = cursors.at(-1) ?? null;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ numeric_execution_id: numericExecutionId, group_key: groupKey });
    if (cursor) params.set("cursor", cursor);
    setLoading(true); setError(false);
    void fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation/members?${params}`, {
      cache: "no-store", signal: controller.signal
    }).then(async response => {
      if (!response.ok) throw new Error("members_unavailable");
      const body: unknown = await response.json();
      if (!validPage(body, workspaceId, numericExecutionId, groupKey)) throw new Error("members_invalid");
      if (!controller.signal.aborted) setData(body);
    }).catch(() => { if (!controller.signal.aborted) { setData(null); setError(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, workspaceId, numericExecutionId, groupKey, cursor]);
  return <div className="topics-manager__atomic-members">
    <button type="button" className="admin-button" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(value => !value)}>{t(open ? "hideMembers" : "showMembers")}</button>
    {open ? <div id={panelId}>
      {loading ? <p role="status">{t("membersLoading")}</p> : error ? <p role="alert">{t("membersError")}</p>
        : data && data.items.length === 0 ? <p>{t("membersEmpty")}</p> : null}
      {data && !loading && !error ? <>
        <p>{t("membersPage", { page: cursors.length, total: data.root_count })}</p>
        <ul>{data.items.map(item => <li key={item.root_id}>
          <Link href={`${mentionsHref}?mention=${encodeURIComponent(item.root_id)}`} prefetch={false}>
            {item.snippet || item.root_id}</Link>
          <small>{item.platform} · {item.published_at.slice(0, 10)} · {t("memberChunks", { count: item.chunk_count })}</small>
        </li>)}</ul>
        <div className="admin-form-actions">
          <button type="button" className="admin-button" disabled={cursors.length <= 1}
            onClick={() => setCursors(value => value.slice(0, -1))}>{t("previous")}</button>
          <button type="button" className="admin-button" disabled={!data.next_cursor}
            onClick={() => { if (data.next_cursor) setCursors(value => [...value, data.next_cursor]); }}>{t("next")}</button>
        </div>
      </> : null}
    </div> : null}
  </div>;
}
