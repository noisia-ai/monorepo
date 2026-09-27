"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { WorkspaceTopicEvidenceMentionLink } from "./workspace-topic-evidence-link";

const pageSize = 20;
const outcomes = ["topic", "narrative", "noise", "insufficient", "technical", "pending"] as const;
const phases = ["consolidated", "screening", "pending"] as const;
type OutcomeStatus = typeof outcomes[number];
type OutcomePhase = typeof phases[number];
type Evidence = { id: string; root_id: string; text: string | null; source: string | null; kind: "cited" | "representative" };
type OutcomeDecision = { disposition: string; label: string | null; definition: string | null; locale: string | null; rationale: string | null;
  confidence: number | null; source: string | null; digest: string | null; cited_evidence_refs: string[] };
type Outcome = { group_key: string; outcome: OutcomeStatus; phase: OutcomePhase; decision: OutcomeDecision | null;
  technical_error_code: string | null; transport_state: string | null; evidence: Evidence[] };
export type WorkspaceTopicEditorialOutcomesPageV2 = { contract_version: "workspace-topic-editorial-outcomes-page-v2";
  workspace_id: string; numeric_execution_id: string; execution_id: string | null; offset: number; limit: number; total: number;
  revision_status: "validated" | "pending"; items: Outcome[] };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nullableText = (value: unknown, max: number): value is string | null => value === null || typeof value === "string" && value.length <= max;
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const exactKeys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join("|") === [...expected].sort().join("|");

/** Strictly accept the compact, paginated read DTO; never render arbitrary server JSON. */
export function parseWorkspaceTopicEditorialOutcomesPageV2(value: unknown, scope: {
  workspaceId: string; numericExecutionId: string; executionId: string | null; offset: number;
}): WorkspaceTopicEditorialOutcomesPageV2 | null {
  if (!object(value) || value.contract_version !== "workspace-topic-editorial-outcomes-page-v2"
    || !exactKeys(value, ["contract_version", "workspace_id", "numeric_execution_id", "execution_id", "revision_status", "offset", "limit", "total", "items"])
    || value.workspace_id !== scope.workspaceId || value.numeric_execution_id !== scope.numericExecutionId
    || value.execution_id !== scope.executionId || !["validated", "pending"].includes(String(value.revision_status))
    || value.offset !== scope.offset || value.limit !== pageSize
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || !Array.isArray(value.items) || value.items.length > pageSize) return null;
  const items: Outcome[] = [];
  for (const raw of value.items) {
    if (!object(raw) || !exactKeys(raw, ["group_key", "outcome", "phase", "decision", "technical_error_code", "transport_state", "evidence"])
      || typeof raw.group_key !== "string" || !raw.group_key || raw.group_key.length > 300
      || !outcomes.includes(raw.outcome as OutcomeStatus) || !phases.includes(raw.phase as OutcomePhase)
      || !nullableText(raw.technical_error_code, 160) || !nullableText(raw.transport_state, 160)
      || !Array.isArray(raw.evidence) || raw.evidence.length > 2) return null;
    let decision: OutcomeDecision | null = null;
    if (raw.decision !== null) {
      const d = raw.decision;
      if (!object(d) || !exactKeys(d, ["disposition", "label", "definition", "locale", "rationale", "confidence", "source", "digest", "cited_evidence_refs"])
        || typeof d.disposition !== "string" || d.disposition.length > 80 || !nullableText(d.label, 1000)
        || !nullableText(d.definition, 12000) || !nullableText(d.locale, 40) || !nullableText(d.rationale, 5000)
        || d.confidence !== null && (typeof d.confidence !== "number" || !Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1)
        || !nullableText(d.source, 120) || !nullableText(d.digest, 200) || !Array.isArray(d.cited_evidence_refs)
        || d.cited_evidence_refs.length > 2 || d.cited_evidence_refs.some(ref => typeof ref !== "string" || ref.length > 200)) return null;
      decision = { disposition: d.disposition, label: d.label, definition: d.definition, locale: d.locale, rationale: d.rationale,
        confidence: d.confidence, source: d.source, digest: d.digest, cited_evidence_refs: d.cited_evidence_refs as string[] };
    }
    if (["pending", "technical"].includes(String(raw.outcome)) && decision !== null
      || !["pending", "technical"].includes(String(raw.outcome)) && decision === null) return null;
    const evidence: Evidence[] = [];
    for (const ref of raw.evidence) {
      if (!object(ref) || !exactKeys(ref, ["id", "root_id", "text", "source", "kind"]) || typeof ref.id !== "string" || !ref.id || ref.id.length > 200
        || !uuid(ref.root_id)
        || !nullableText(ref.text, 5000) || !nullableText(ref.source, 500) || !["cited", "representative"].includes(String(ref.kind))) return null;
      if (ref.kind === "representative" && ref.id !== ref.root_id) return null;
      evidence.push({ id: ref.id, root_id: ref.root_id, text: ref.text, source: ref.source, kind: ref.kind as Evidence["kind"] });
    }
    if (decision && evidence.some(ref => ref.kind === "cited" && !decision?.cited_evidence_refs.includes(ref.id))) return null;
    items.push({ group_key: raw.group_key, outcome: raw.outcome as OutcomeStatus, phase: raw.phase as OutcomePhase,
      decision, technical_error_code: raw.technical_error_code, transport_state: raw.transport_state, evidence });
  }
  if (Number(value.total) < Number(value.offset) + items.length) return null;
  return { contract_version: "workspace-topic-editorial-outcomes-page-v2", workspace_id: scope.workspaceId,
    numeric_execution_id: scope.numericExecutionId, execution_id: scope.executionId, revision_status: value.revision_status as "validated" | "pending",
    offset: scope.offset, limit: pageSize, total: Number(value.total), items };
}

/** User-triggered, read-only browser for outcomes already saved by the editorial execution. */
export function WorkspaceTopicEditorialOutcomes({ workspaceId, numericExecutionId, executionId, mentionsHref }: {
  workspaceId: string; numericExecutionId: string; executionId: string; mentionsHref: string;
}) {
  const t = useTranslations("AdminWorkspace.topics.consolidation.editorial.outcomeBrowser");
  const locale = useLocale();
  const panelId = useId();
  const scope = `${workspaceId}:${numericExecutionId}:${executionId}`;
  const active = useRef(scope); active.current = scope;
  const request = useRef<AbortController | null>(null), inFlight = useRef(false);
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const [page, setPage] = useState<WorkspaceTopicEditorialOutcomesPageV2 | null>(null);
  const [offset, setOffset] = useState(0), [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false); setLoading(false); setFailed(false); setPage(null); setOffset(0); setSelected(null); inFlight.current = false;
    return () => { request.current?.abort(); request.current = null; };
  }, [scope]);

  const load = async (nextOffset: number) => {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true); setFailed(false);
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    try {
      const params = new URLSearchParams({ numeric_execution_id: numericExecutionId, execution_id: executionId,
        offset: String(nextOffset), limit: String(pageSize) });
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation/editorial/outcomes?${params}`, { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      const parsed = response.ok ? parseWorkspaceTopicEditorialOutcomesPageV2(body, { workspaceId, numericExecutionId, executionId, offset: nextOffset }) : null;
      if (!parsed) throw new Error("outcomes_unavailable");
      if (controller.signal.aborted || active.current !== scope) return;
      setPage(parsed); setOffset(nextOffset); setSelected(null);
    } catch { if (!controller.signal.aborted && active.current === scope) setFailed(true); }
    finally {
      const ownsRequest = request.current === controller;
      if (ownsRequest) { request.current = null; inFlight.current = false; }
      if (!controller.signal.aborted && active.current === scope) setLoading(false);
    }
  };

  const selectedItem = page?.items.find(item => item.group_key === selected) ?? null;
  const canNext = !!page && offset + page.items.length < page.total;
  const first = page && page.items.length ? offset + 1 : 0;
  const last = page ? offset + page.items.length : 0;

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
          <p role="status">{t(`revision.${page.revision_status}`)}</p>
          <p role="status" aria-live="polite">{t("range", { first, last, total: page.total })}</p>
          {page.total === 0 ? <p>{t("empty")}</p> : <>
            <ul aria-label={t("groupsLabel")} className="admin-drawer-form__list">
              {page.items.map(item => <li key={item.group_key}>
                <button type="button" className="admin-button" aria-pressed={selected === item.group_key}
                  onClick={() => setSelected(item.group_key)}>
                <span>{item.decision?.label || item.group_key}</span> <span>{t(`statuses.${item.outcome}`)} · {t(`phases.${item.phase}`)}</span>
                </button>
              </li>)}
            </ul>
            {selectedItem ? <article className="admin-section" aria-label={t("selectedGroup")}>
              <div className="admin-section__body admin-drawer-form">
                <p><strong>{selectedItem.decision?.label || selectedItem.group_key}</strong></p>
                <p>{t("groupKey", { key: selectedItem.group_key })}</p>
                <p>{t("statusLabel")}: {t(`statuses.${selectedItem.outcome}`)} · {t(`phases.${selectedItem.phase}`)}</p>
                {selectedItem.decision?.definition ? <p>{selectedItem.decision.definition}</p> : null}
                {selectedItem.decision?.rationale ? <p>{selectedItem.decision.rationale}</p> : null}
                {selectedItem.decision?.confidence !== null && selectedItem.decision?.confidence !== undefined
                  ? <p>{t("confidence", { value: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(selectedItem.decision.confidence) })}</p> : null}
                {selectedItem.technical_error_code ? <p>{t("errorCode", { code: selectedItem.technical_error_code })}</p> : null}
                {selectedItem.transport_state ? <p>{t("transport", { state: selectedItem.transport_state })}</p> : null}
                {selectedItem.evidence.length ? <div>
                  <h5>{t("evidence")}</h5>
                  <ul>{selectedItem.evidence.map(ref => <li key={ref.id}>
                  <strong>{t(`evidenceKinds.${ref.kind}`)}</strong>
                  {ref.text ? <blockquote>{ref.text}</blockquote> : <span>{t("evidenceUnavailable")}</span>}
                    {ref.source ? <small>{ref.source}</small> : null}
                    <WorkspaceTopicEvidenceMentionLink mentionsHref={mentionsHref} rootId={ref.root_id}>{t("openMention")}</WorkspaceTopicEvidenceMentionLink>
                  </li>)}</ul>
                </div> : <p>{t("noEvidence")}</p>}
              </div>
            </article> : null}
          </>}
          <div className="admin-form-actions">
            <button type="button" className="admin-button" disabled={loading || offset === 0} onClick={() => void load(Math.max(0, offset - pageSize))}>{t("previous")}</button>
            <button type="button" className="admin-button" disabled={loading || !canNext} onClick={() => void load(offset + pageSize)}>{t("next")}</button>
            <button type="button" className="admin-button" disabled={loading} onClick={() => void load(offset)}>{t("refresh")}</button>
          </div>
        </> : null}
      </div> : null}
    </div>
  </section>;
}
