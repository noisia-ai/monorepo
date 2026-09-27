"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

const pageSize = 20;
const outcomeKeys = ["topic", "narrative", "noise", "insufficient", "pending"] as const;
type OutcomeKey = typeof outcomeKeys[number];
type Evidence = { id: string; text: string | null; source: string | null; kind: "cited" };
type Decision = { disposition: string; label: string | null; definition: string | null; locale: string | null;
  rationale: string | null; confidence: number | null; cited_evidence_refs: string[] };
type Item = { group_key: string; outcome: OutcomeKey; phase: "screening" | "pending";
  decision: Decision | null; evidence: Evidence[] };
type Page = { execution_id: string | null; execution_status: string | null; expected_batch_count: number;
  screening_batch_count: number; saved_decision_count: number; total: number; offset: number; limit: number; items: Item[] };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const textOrNull = (value: unknown, max: number): value is string | null => value === null || typeof value === "string" && value.length <= max;

function parsePage(value: unknown, scope: { workspaceId: string; numericExecutionId: string; offset: number }): Page | null {
  if (!object(value) || value.contract_version !== "workspace-topic-legacy-editorial-outcomes-page-v1"
    || value.workspace_id !== scope.workspaceId || value.numeric_execution_id !== scope.numericExecutionId
    || value.offset !== scope.offset || value.limit !== pageSize || !Number.isSafeInteger(value.total) || Number(value.total) < 0
    || !Number.isSafeInteger(value.expected_batch_count) || Number(value.expected_batch_count) < 0
    || !Number.isSafeInteger(value.screening_batch_count) || Number(value.screening_batch_count) < 0
    || Number(value.screening_batch_count) > Number(value.expected_batch_count)
    || !Number.isSafeInteger(value.saved_decision_count) || Number(value.saved_decision_count) < 0
    || value.execution_id !== null && typeof value.execution_id !== "string"
    || value.execution_status !== null && !["queued", "running", "failed", "review_ready", "completed"].includes(String(value.execution_status))
    || !Array.isArray(value.items) || value.items.length > pageSize) return null;
  const items: Item[] = [];
  for (const raw of value.items) {
    if (!object(raw) || typeof raw.group_key !== "string" || raw.group_key.length > 300
      || !outcomeKeys.includes(raw.outcome as OutcomeKey) || !["screening", "pending"].includes(String(raw.phase))
      || raw.phase === "screening" !== (raw.decision !== null) || !Array.isArray(raw.evidence) || raw.evidence.length > 2) return null;
    let decision: Decision | null = null;
    if (raw.decision !== null) {
      const candidate = raw.decision;
      if (!object(candidate) || typeof candidate.disposition !== "string" || candidate.disposition.length > 30
        || !textOrNull(candidate.label, 1000) || !textOrNull(candidate.definition, 12000) || !textOrNull(candidate.locale, 40)
        || !textOrNull(candidate.rationale, 5000) || candidate.confidence !== null && (typeof candidate.confidence !== "number"
          || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1)
        || !Array.isArray(candidate.cited_evidence_refs) || candidate.cited_evidence_refs.length > 2
        || candidate.cited_evidence_refs.some(ref => typeof ref !== "string" || ref.length > 100)) return null;
      decision = { disposition: candidate.disposition, label: candidate.label, definition: candidate.definition, locale: candidate.locale,
        rationale: candidate.rationale, confidence: candidate.confidence, cited_evidence_refs: candidate.cited_evidence_refs as string[] };
    }
    const evidence: Evidence[] = [];
    for (const ref of raw.evidence) {
      if (!object(ref) || typeof ref.id !== "string" || ref.id.length > 100 || !textOrNull(ref.text, 5000)
        || !textOrNull(ref.source, 500) || ref.kind !== "cited" || decision?.cited_evidence_refs.includes(ref.id) !== true) return null;
      evidence.push({ id: ref.id, text: ref.text, source: ref.source, kind: "cited" });
    }
    items.push({ group_key: raw.group_key, outcome: raw.outcome as OutcomeKey, phase: raw.phase as Item["phase"], decision, evidence });
  }
  if (Number(value.total) < scope.offset + items.length) return null;
  return { execution_id: value.execution_id as string | null, execution_status: value.execution_status as string | null,
    expected_batch_count: Number(value.expected_batch_count), screening_batch_count: Number(value.screening_batch_count),
    saved_decision_count: Number(value.saved_decision_count), total: Number(value.total), offset: scope.offset, limit: pageSize, items };
}

/** Read-only viewer for paid legacy screening decisions; never labels them as a final Topic catalog. */
export function WorkspaceTopicLegacyEditorialOutcomes({ workspaceId, numericExecutionId }: { workspaceId: string; numericExecutionId: string }) {
  const t = useTranslations("AdminWorkspace.topics.consolidation.editorial.legacyOutcomeBrowser"), locale = useLocale();
  const panelId = useId(), scope = `${workspaceId}:${numericExecutionId}`;
  const active = useRef(scope); active.current = scope;
  const controllerRef = useRef<AbortController | null>(null), inFlight = useRef(false);
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const [page, setPage] = useState<Page | null>(null), [offset, setOffset] = useState(0), [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false); setLoading(false); setFailed(false); setPage(null); setOffset(0); setSelected(null); inFlight.current = false;
    return () => { controllerRef.current?.abort(); controllerRef.current = null; };
  }, [scope]);

  const load = async (nextOffset: number) => {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true); setFailed(false);
    const controller = new AbortController(); controllerRef.current?.abort(); controllerRef.current = controller;
    try {
      const params = new URLSearchParams({ numeric_execution_id: numericExecutionId, offset: String(nextOffset), limit: String(pageSize) });
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation/editorial/outcomes/legacy?${params}`,
        { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      const parsed = response.ok ? parsePage(body, { workspaceId, numericExecutionId, offset: nextOffset }) : null;
      if (!parsed) throw new Error("legacy_outcomes_unavailable");
      if (controller.signal.aborted || active.current !== scope) return;
      setPage(parsed); setOffset(nextOffset); setSelected(null);
    } catch { if (!controller.signal.aborted && active.current === scope) setFailed(true); }
    finally {
      if (controllerRef.current === controller) { controllerRef.current = null; inFlight.current = false; }
      if (!controller.signal.aborted && active.current === scope) setLoading(false);
    }
  };

  const selectedItem = page?.items.find(item => item.group_key === selected) ?? null;
  const canNext = !!page && offset + page.items.length < page.total;
  const first = page?.items.length ? offset + 1 : 0, last = page ? offset + page.items.length : 0;
  return <section className="admin-section" aria-label={t("sectionLabel")}>
    <div className="admin-section__head"><div><h4>{t("title")}</h4><p>{t("intro")}</p></div></div>
    <div className="admin-section__body admin-drawer-form">
      <button type="button" className="admin-button" aria-expanded={open} aria-controls={panelId}
        onClick={() => { const next = !open; setOpen(next); if (next && !page && !loading) void load(0); }}>
        {open ? t("hide") : t("show")}
      </button>
      {open ? <div id={panelId}>
        {loading ? <p role="status">{t("loading")}</p> : null}
        {failed ? <p role="alert" className="team-msg team-msg--error">{t("error")}</p> : null}
        {page ? <>
          {page.execution_id ? <>
            <p role="status">{t("partial", { decisions: page.saved_decision_count, total: page.total,
              batches: page.screening_batch_count, expected: page.expected_batch_count })}</p>
            <p>{t("executionStatus", { status: page.execution_status ?? "unknown" })}</p>
            <p role="status" aria-live="polite">{t("range", { first, last, total: page.total })}</p>
            {page.items.length ? <>
              <ul aria-label={t("groupsLabel")} className="admin-drawer-form__list">
                {page.items.map(item => <li key={item.group_key}>
                  <button type="button" className="admin-button" aria-pressed={selected === item.group_key}
                    onClick={() => setSelected(item.group_key)}>
                    <span>{item.decision?.label || item.group_key}</span> <span>{t(`statuses.${item.outcome}`)}</span>
                  </button>
                </li>)}
              </ul>
              {selectedItem ? <article className="admin-section" aria-label={t("selectedGroup")}>
                <div className="admin-section__body admin-drawer-form">
                  <p><strong>{selectedItem.decision?.label || selectedItem.group_key}</strong></p>
                  <p>{t("groupKey", { key: selectedItem.group_key })}</p>
                  <p>{t("statusLabel")}: {t(`statuses.${selectedItem.outcome}`)} · {selectedItem.phase === "screening" ? t("screening") : t("pending")}</p>
                  {selectedItem.decision?.definition ? <p>{selectedItem.decision.definition}</p> : null}
                  {selectedItem.decision?.rationale ? <p>{selectedItem.decision.rationale}</p> : null}
                  {selectedItem.decision?.confidence !== null && selectedItem.decision?.confidence !== undefined
                    ? <p>{t("confidence", { value: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(selectedItem.decision.confidence) })}</p> : null}
                  {selectedItem.evidence.length ? <div><h5>{t("evidence")}</h5><ul>{selectedItem.evidence.map(ref => <li key={ref.id}>
                    <strong>{t("citedEvidence")}</strong>{ref.text ? <blockquote>{ref.text}</blockquote> : <span>{t("evidenceUnavailable")}</span>}
                    {ref.source ? <small>{ref.source}</small> : null}
                  </li>)}</ul></div> : <p>{t("noEvidence")}</p>}
                </div>
              </article> : null}
              <div className="admin-form-actions">
                <button type="button" className="admin-button" disabled={loading || offset === 0} onClick={() => void load(Math.max(0, offset - pageSize))}>{t("previous")}</button>
                <button type="button" className="admin-button" disabled={loading || !canNext} onClick={() => void load(offset + pageSize)}>{t("next")}</button>
                <button type="button" className="admin-button" disabled={loading} onClick={() => void load(offset)}>{t("refresh")}</button>
              </div>
            </> : <p>{t("empty")}</p>}
          </> : <p role="status">{t("noExecution")}</p>}
        </> : null}
      </div> : null}
    </div>
  </section>;
}
