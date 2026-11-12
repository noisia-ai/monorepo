"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";
import { SignalEvidenceDrawer } from "./SignalEvidenceDrawer";

type Choice = "trigger" | "barrier";
export type ConsumerEvidencePageV1 = {
  contract_version: "mass-labeling-consumer-evidence-v1";
  workspace_id: string; scope_digest: string; choice: Choice;
  items: Array<{ mention_id: string; text: string; platform: string | null; occurred_at: string | null; url: string | null }>;
  next_cursor: string | null;
};

export function SignalConsumerEvidence({ data, loading, workspaceTimezone, onOpenMention }: {
  data: Pick<SignalWorkspaceTopicsOverviewV1, "workspace_id" | "scope_digest" | "is_current" | "filters" | "consumer_indicators">;
  loading: boolean; workspaceTimezone: string; onOpenMention?: (id: string) => void;
}) {
  const t = useTranslations("SignalV2.workspaceTopics");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [page, setPage] = useState<ConsumerEvidencePageV1 | null>(null);
  const [reading, setReading] = useState(false), [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const readBlocked = useRef(loading || !data.is_current); readBlocked.current = loading || !data.is_current;
  const scopeKey = `${data.workspace_id}:${data.scope_digest}`;
  useEffect(() => {
    const fence = sequence;
    setChoice(null); setPage(null); setError(false); setReading(false);
    request.current?.abort(); sequence.current++;
    return () => { request.current?.abort(); fence.current++; };
  }, [scopeKey]);
  useEffect(() => {
    if (!loading) return;
    request.current?.abort(); sequence.current++; setReading(false);
  }, [loading]);
  const read = useCallback(async (selected: Choice, cursor?: string) => {
    if (readBlocked.current || !data.is_current) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const ticket = ++sequence.current; setReading(true); setError(false);
    const params = new URLSearchParams({ choice: selected, scope_digest: data.scope_digest, timezone: workspaceTimezone, limit: "30" });
    if (data.filters.date_from) params.set("date_from", data.filters.date_from);
    if (data.filters.date_to) params.set("date_to", data.filters.date_to);
    if (data.filters.conversation_segment) params.set("conversation_segment", data.filters.conversation_segment);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(data.workspace_id)}/topics-narratives/consumers/evidence?${params}`,
        { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || ticket !== sequence.current) return;
      if (!response.ok) {
        if ([401, 403, 404, 409].includes(response.status)) setPage(null);
        throw new Error("consumer_evidence_unavailable");
      }
      const next = await response.json() as ConsumerEvidencePageV1;
      if (controller.signal.aborted || ticket !== sequence.current) return;
      if (next.contract_version !== "mass-labeling-consumer-evidence-v1" || next.workspace_id !== data.workspace_id
        || next.scope_digest !== data.scope_digest || next.choice !== selected || !Array.isArray(next.items)) throw new Error("consumer_evidence_scope_changed");
      setPage(current => cursor && current?.choice === selected ? { ...next, items: [...current.items, ...next.items] } : next);
    } catch {
      if (!controller.signal.aborted && ticket === sequence.current) setError(true);
    } finally { if (!controller.signal.aborted && ticket === sequence.current) setReading(false); }
  }, [data.filters.conversation_segment, data.filters.date_from, data.filters.date_to, data.is_current, data.scope_digest, data.workspace_id, workspaceTimezone]);
  if (!data.consumer_indicators) return null;
  const close = () => { request.current?.abort(); sequence.current++; setChoice(null); setReading(false); };
  return <>
    <div className="signal-v2-tn__detail-actions">{(["trigger", "barrier"] as const).map(selected => <button
      className="signal-v2-tn__button" type="button" key={selected}
      disabled={loading || !data.is_current || data.consumer_indicators![selected] === 0}
      onClick={() => { setChoice(selected); setPage(null); void read(selected); }}>{t(`consumers.${selected}Examples`)}</button>)}</div>
    {choice ? <SignalEvidenceDrawer ariaLabel={t(`consumers.${choice}Examples`)} closeLabel={t("close")}
      eyebrow={t("consumers.title")} title={t(`consumers.${choice}`)} intro={t("consumers.lexiconScope")}
      records={(page?.items ?? []).map(item => ({ id: item.mention_id, body: item.text,
        occurredAt: item.occurred_at, platform: item.platform, originalUrl: item.url }))}
      loading={reading} loadingLabel={t("loading")} emptyLabel={t("noEvidence")}
      errorMessage={error ? t("evidenceError") : null} onClose={close} timeZone={workspaceTimezone}
      onLoadMore={page?.next_cursor || error ? () => void read(choice, error ? undefined : page!.next_cursor!) : undefined}
      loadMoreLabel={t(error ? "refresh" : "more")} openOriginalLabel={t("original")}
      openingEnrichedLabel={t("loading")} viewEnrichedLabel={t("openMention")}
      onOpenEnriched={onOpenMention ? record => { close(); onOpenMention(record.id); } : undefined} /> : null}
  </>;
}
