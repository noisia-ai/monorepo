"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ReportFilterPanel, type FilterControl } from "@/components/filters/ReportFilterPanel";
import { Icon } from "@/components/ui/Icon";
import { SourceToken } from "@/components/ui/SourceIcon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";

export type BrowserMention = {
  id: string;
  textSnippet: string | null;
  textClean: string;
  publishedAt: string;
  platform: string;
  url: string | null;
  sentimentSource: string | null;
  sentimentScore: string | number | null;
  inclusionStatus: string;
  exclusionReason: string | null;
  cleanupActionKind: string | null;
};

type Props = {
  corpusId: string;
  mentions: BrowserMention[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  pageHref: {
    previous: string | null;
    next: string | null;
  };
  searchTerm?: string;
  filterControls: FilterControl[];
};

export function MentionsBrowser({
  corpusId,
  mentions,
  pagination,
  pageHref,
  searchTerm,
  filterControls,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchSignature = searchParams.toString();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // TODO mejora-futura: soportar seleccion cross-page y operaciones bulk por
  // filtro guardado; el MVP opera solo sobre los IDs visibles de la pagina.
  const selectableIds = useMemo(
    () => mentions.filter((mention) => mention.inclusionStatus !== "excluded").map((m) => m.id),
    [mentions]
  );
  const allPageSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedSet.has(id));

  useEffect(() => {
    if (!isFiltering) return;
    const timer = window.setTimeout(() => setIsFiltering(false), 650);
    return () => window.clearTimeout(timer);
  }, [isFiltering, searchSignature]);

  function toggleMention(id: string) {
    setLastResult(null);
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function togglePage() {
    setLastResult(null);
    setSelected((current) => {
      const currentSet = new Set(current);
      if (allPageSelected) {
        return current.filter((id) => !selectableIds.includes(id));
      }

      for (const id of selectableIds) {
        currentSet.add(id);
      }
      return Array.from(currentSet);
    });
  }

  async function excludeSelected() {
    if (selected.length === 0) return;

    setIsSubmitting(true);
    setError(null);
    setLastResult(null);

    const res = await fetch(`/api/corpora/${corpusId}/mentions/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mention_ids: selected,
        reason: reason.trim() || undefined
      })
    });
    const payload = await res.json();

    if (!res.ok) {
      setError(payload.message ?? "No se pudo aplicar la exclusion manual.");
      setIsSubmitting(false);
      return;
    }

    setLastResult(payload.excluded_count ?? 0);
    setSelected([]);
    setReason("");
    setIsSubmitting(false);
    router.refresh();
  }

  return (
    <section className={filterOpen ? "mentions-browser mentions-browser--filter-open" : "mentions-browser"}>
      <ReportFilterPanel
        controls={filterControls}
        eyebrow="Corpus browser"
        onApplyStart={() => setIsFiltering(true)}
        onClose={() => setFilterOpen(false)}
        open={filterOpen}
        resultCount={pagination.total}
        resultLabel="menciones filtradas"
        title="Filter & Sort"
      />
      <header className="mentions-browser-head">
        <div>
          <p className="vitals-eyebrow">
            <Icon name="message" size={13} />
            Corpus browser
          </p>
          <h2>Revisión manual de menciones</h2>
        </div>
        <div className="mentions-browser-actions">
          {lastResult !== null ? (
            <SuccessPill>{fmt(lastResult)} excluidas</SuccessPill>
          ) : (
            <StatusPill tone="info">{fmt(pagination.total)} total</StatusPill>
          )}
          <label className="mention-select-page">
            <input
              checked={allPageSelected}
              disabled={selectableIds.length === 0}
              onChange={togglePage}
              type="checkbox"
            />
            <span>Seleccionar página</span>
          </label>
          <button className="mention-filter-toggle" onClick={() => setFilterOpen(true)} type="button">
            <Icon name="filter" size={15} />
            Filter & Sort
          </button>
        </div>
      </header>

      <div className="mentions-browser-content">
        {isFiltering ? (
          <div className="mentions-filter-progress" role="status">
            <Icon name="spinner" size={16} />
            <strong>Filtrando menciones</strong>
            <span>Actualizando búsqueda, fuentes y orden.</span>
          </div>
        ) : null}
        {mentions.length === 0 ? (
          <div className="empty-card">
            <Icon className="empty-card-icon" name="info" size={22} />
            <strong>No hay menciones con esos filtros</strong>
            <span>Ajusta búsqueda, fuentes o status para volver a revisar el corpus.</span>
          </div>
        ) : (
          <div className="mention-card-list">
            {mentions.map((mention, index) => {
              const isExcluded = mention.inclusionStatus === "excluded";
              const isSelected = selectedSet.has(mention.id);
              const content = trimMentionText(mention.textSnippet ?? mention.textClean);

              return (
                <article
                  className={[
                    "mention-card",
                    isSelected ? "mention-card--selected" : "",
                    isExcluded ? "mention-card--excluded" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={mention.id}
                  style={{ "--mention-delay": `${Math.min(index, 12) * 28}ms` } as CSSProperties}
                >
                  <div className="mention-card-topline">
                    <label className="mention-card-check" title="Seleccionar mención">
                      <input
                        checked={isSelected}
                        disabled={isExcluded}
                        onChange={() => toggleMention(mention.id)}
                        type="checkbox"
                      />
                    </label>
                    <StatusPill tone={statusTone(mention.inclusionStatus)}>
                      {statusLabel(mention.inclusionStatus)}
                    </StatusPill>
                  </div>

                  <div className="mention-card-body">
                    <div className="mention-card-meta">
                      <span>
                        <SourceToken compact value={mention.platform} />
                      </span>
                      <span>
                        <Icon name="clock" size={12} />
                        {formatDate(mention.publishedAt)}
                      </span>
                      <span>
                        <Icon name="sentiment" size={12} />
                        {formatSentiment(mention)}
                      </span>
                    </div>

                    {mention.url ? (
                      <a className="mention-card-text" href={mention.url} rel="noreferrer" target="_blank">
                        <HighlightedText text={content} term={searchTerm} />
                        <Icon name="external" size={13} />
                      </a>
                    ) : (
                      <p className="mention-card-text">
                        <HighlightedText text={content} term={searchTerm} />
                      </p>
                    )}

                    {mention.exclusionReason ? (
                      <p className="mention-card-reason">
                        {mention.cleanupActionKind ? (
                          <span className="mention-card-reason-kind">
                            {cleanupKindLabel(mention.cleanupActionKind)}
                          </span>
                        ) : null}
                        <HighlightedText text={trimMentionText(mention.exclusionReason, 140)} term={searchTerm} />
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <footer className="pagination-v2">
          {pageHref.previous ? (
            <Link className="wizard-cta wizard-cta--ghost" href={pageHref.previous}>
              <Icon className="icon--flip" name="arrow-right" size={14} />
              Anterior
            </Link>
          ) : null}
          <span className="pagination-position">
            Página {pagination.page} de {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}
          </span>
          {pageHref.next ? (
            <Link className="wizard-cta wizard-cta--ghost" href={pageHref.next}>
              Siguiente <Icon name="arrow-right" size={14} />
            </Link>
          ) : null}
        </footer>
      </div>

      {selected.length > 0 ? (
        <div className="mention-bulk-bar" role="region" aria-label="Acciones bulk">
          <div className="mention-bulk-summary">
            <StatusPill tone="warn">Selección manual</StatusPill>
            <strong>{fmt(selected.length)} menciones</strong>
            <span>Se puede revertir desde Historial.</span>
          </div>
          <input
            aria-label="Motivo de exclusión"
            className="mention-bulk-reason"
            disabled={isSubmitting}
            maxLength={240}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo breve, opcional"
            value={reason}
          />
          <div className="mention-bulk-actions">
            <button
              className="wizard-cta wizard-cta--ghost"
              disabled={isSubmitting}
              onClick={() => setSelected([])}
              type="button"
            >
              Limpiar
            </button>
            <button className="wizard-cta" disabled={isSubmitting} onClick={excludeSelected} type="button">
              {isSubmitting ? <Icon name="spinner" size={14} /> : <Icon name="x" size={14} />}
              Excluir {fmt(selected.length)}
            </button>
          </div>
          {error ? <p className="mention-bulk-error">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function statusTone(status: string) {
  if (status === "included") return "success";
  if (status === "excluded") return "warn";
  return "idle";
}

function statusLabel(status: string) {
  if (status === "included") return "Incluida";
  if (status === "excluded") return "Excluida";
  return "Pendiente";
}

function HighlightedText({ text, term }: { text: string; term?: string }) {
  const normalized = term?.trim();
  if (!normalized) return <>{text}</>;

  const lower = text.toLowerCase();
  const needle = normalized.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle);

  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <mark className="mention-highlight" key={`${index}-${needle}`}>
        {text.slice(index, index + needle.length)}
      </mark>
    );
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(date));
}

function formatSentiment(mention: BrowserMention) {
  if (mention.sentimentSource) return mention.sentimentSource;
  if (mention.sentimentScore === null) return "Sin sentimiento";
  return `Score ${Number(mention.sentimentScore).toFixed(2)}`;
}

function fmt(value: number) {
  return new Intl.NumberFormat("es-MX").format(value);
}

function trimMentionText(value: string, maxLength = 260) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trim()}...` : clean;
}

function cleanupKindLabel(value: string) {
  if (value === "manual_bulk") return "Manual";
  if (value === "claude_instruction") return "AI";
  return value;
}
