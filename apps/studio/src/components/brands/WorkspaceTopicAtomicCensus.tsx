"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { AtomicCensusPageV1 } from "@/lib/data-os/workspace-topic-atomic-census";
import { WorkspaceTopicAtomicMembers } from "./WorkspaceTopicAtomicMembers";

function validPage(value: unknown, workspaceId: string, numericExecutionId: string): value is AtomicCensusPageV1 {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<AtomicCensusPageV1>;
  return page.contract_version === "workspace-topic-atomic-census-page-v1" && page.workspace_id === workspaceId
    && page.numeric_execution_id === numericExecutionId && Number.isSafeInteger(page.total)
    && Number.isSafeInteger(page.matching) && Number.isSafeInteger(page.page)
    && page.page_size === 20 && (page.revision_status === "pending" || page.revision_status === "validated")
    && Array.isArray(page.items) && page.items.length <= 20;
}

/** Original BERTopic groups remain visible independently of the selected Signal catalog. */
export function WorkspaceTopicAtomicCensus({ workspaceId, numericExecutionId, mentionsHref }: {
  workspaceId: string; numericExecutionId: string; mentionsHref: string;
}) {
  const t = useTranslations("AdminWorkspace.topics.consolidation.census"), locale = useLocale();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [data, setData] = useState<AtomicCensusPageV1 | null>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(false);
    const params = new URLSearchParams({ numeric_execution_id: numericExecutionId, page: String(page) });
    if (search) params.set("q", search);
    void fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation/census?${params}`, {
      cache: "no-store", signal: controller.signal
    }).then(async response => {
      if (!response.ok) throw new Error("read_failed");
      const body: unknown = await response.json();
      if (!validPage(body, workspaceId, numericExecutionId)) throw new Error("invalid_page");
      if (!controller.signal.aborted) setData(body);
    }).catch(() => { if (!controller.signal.aborted) { setData(null); setError(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, numericExecutionId, page, search, open]);
  const searchNow = () => { setPage(1); setSearch(query.trim()); };
  return <section className="admin-section" data-topic-atomic-census="true">
    <div className="admin-section__head"><div><h3>{t("title")}</h3><p>{t("body")}</p></div>
      <button type="button" className="admin-button" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}>{t(open ? "hide" : "show")}</button></div>
    {open ? <div id={panelId} className="admin-section__body admin-drawer-form">
      {data ? <p role="status">{t("count", { matching: data.matching.toLocaleString(locale), total: data.total.toLocaleString(locale) })}
        {" · "}{t(data.revision_status === "validated" ? "validated" : "pending")}</p> : null}
      <form onSubmit={event => { event.preventDefault(); searchNow(); }} className="admin-form-actions">
        <label>{t("searchLabel")} <input className="admin-input" value={query} maxLength={100}
          onChange={event => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} /></label>
        <button className="admin-button" type="submit">{t("search")}</button>
      </form>
      {loading ? <p role="status">{t("loading")}</p> : error ? <p role="alert">{t("error")}</p>
        : data && data.items.length === 0 ? <p>{t("empty")}</p> : null}
      {data && !loading && !error ? <div className="topics-manager__atomic-groups">
        {data.items.map(group => <article key={group.group_key} className="admin-section topics-manager__atomic-group">
          <div className="admin-section__body"><strong>{group.group_key}</strong>
            <p>{t("groupSize", { roots: group.root_count.toLocaleString(locale), chunks: group.chunk_count.toLocaleString(locale) })}</p>
            {group.terms.length ? <p>{t("terms", { terms: group.terms.slice(0, 12).join(" · ") })}</p> : null}
            <p>{group.disposition === "topic" || group.disposition === "narrative"
              ? t("assigned", { concept: group.concept_label ?? group.disposition })
              : t(group.disposition ?? "undecided")}</p>
            {group.evidence.map(item => <blockquote key={item.root_id}>
              {item.text ? <p>{item.text}</p> : <p>{t("fragmentUnavailable")}</p>}
              <footer>{[item.platform, item.locale].filter(Boolean).join(" · ")}{" · "}
                <Link href={`${mentionsHref}?mention=${encodeURIComponent(item.root_id)}`} prefetch={false}>{t("openMention")}</Link>
              </footer>
            </blockquote>)}
            <WorkspaceTopicAtomicMembers workspaceId={workspaceId} numericExecutionId={numericExecutionId}
              groupKey={group.group_key} mentionsHref={mentionsHref} />
          </div>
        </article>)}
      </div> : null}
      {data && data.matching > data.page_size ? <div className="admin-form-actions">
        <button className="admin-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>{t("previous")}</button>
        <span>{t("page", { page, pages: Math.ceil(data.matching / data.page_size) })}</span>
        <button className="admin-button" type="button" disabled={page >= Math.ceil(data.matching / data.page_size) || loading}
          onClick={() => setPage(page + 1)}>{t("next")}</button>
      </div> : null}
    </div> : null}
  </section>;
}
