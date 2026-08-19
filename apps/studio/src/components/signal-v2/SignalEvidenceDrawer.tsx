"use client";

import Link from "next/link";
import { ArrowRight, SpinnerGap } from "@phosphor-icons/react";
import { useLocale } from "next-intl";

import { SignalSourceIcon } from "@/components/signal-v2/SignalSourceIcon";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";

export type SignalEvidenceDrawerRecord = {
  body: string;
  id: string;
  occurredAt: string;
  originalUrl?: string | null;
  platform?: string | null;
  quote?: string | null;
};

export function SignalEvidenceDrawer({
  ariaLabel,
  closeLabel,
  emptyLabel,
  errorMessage,
  eyebrow,
  getEnrichedHref,
  loadMoreLabel,
  loading,
  loadingLabel,
  onClose,
  onLoadMore,
  onOpenEnriched,
  openOriginalLabel,
  openingEnrichedLabel,
  openingRecordId,
  records,
  title,
  intro,
  viewEnrichedLabel
}: {
  ariaLabel: string;
  closeLabel: string;
  emptyLabel?: string;
  errorMessage?: string | null;
  eyebrow: string;
  getEnrichedHref?: (record: SignalEvidenceDrawerRecord) => string;
  intro: string;
  loadMoreLabel?: string;
  loading: boolean;
  loadingLabel: string;
  onClose: () => void;
  onLoadMore?: () => void;
  onOpenEnriched?: (record: SignalEvidenceDrawerRecord) => void;
  openOriginalLabel: string;
  openingEnrichedLabel: string;
  openingRecordId?: string | null;
  records: SignalEvidenceDrawerRecord[];
  title: string;
  viewEnrichedLabel: string;
}) {
  const locale = useLocale();

  return (
    <WorkspaceDrawer
      ariaLabel={ariaLabel}
      bodyClassName="signal-v2-tn__evidence-body"
      closeLabel={closeLabel}
      eyebrow={eyebrow}
      layerClassName="signal-v2-tn__evidence-layer"
      onClose={onClose}
      panelClassName="signal-v2-tn__evidence"
      scrimClassName="signal-v2-tn__scrim"
      title={title}
    >
        <p className="signal-v2-tn__evidence-intro">{intro}</p>
        <div className="signal-v2-tn__evidence-list">
          {loading && records.length === 0 ? (
            Array.from({ length: 5 }, (_, index) => <i key={index} />)
          ) : errorMessage ? (
            <p className="signal-v2-tn__inline-error" role="alert">{errorMessage}</p>
          ) : records.length === 0 ? (
            <p className="signal-v2-tn__inline-error">{emptyLabel}</p>
          ) : records.map((record) => {
            const quote = uniqueQuote(record.body, record.quote);
            const href = getEnrichedHref?.(record);
            const opening = openingRecordId === record.id;
            return (
              <article key={record.id}>
                <div>
                  <strong>
                    <SignalSourceIcon
                      label={record.platform ?? undefined}
                      platform={record.platform ?? null}
                      size={16}
                    />
                    {record.platform ?? "—"}
                  </strong>
                  <time>{formatDrawerDate(record.occurredAt, locale)}</time>
                </div>
                <p>{record.body}</p>
                {quote ? <blockquote>{quote}</blockquote> : null}
                <div className="signal-v2-tn__evidence-actions">
                  {onOpenEnriched ? (
                    <button
                      aria-busy={opening}
                      disabled={Boolean(openingRecordId)}
                      onClick={() => onOpenEnriched(record)}
                      type="button"
                    >
                      {opening ? <>{openingEnrichedLabel}<SpinnerGap className="signal-v2-tn__navigation-spinner" size={13} /></> : <>{viewEnrichedLabel}<ArrowRight size={13} /></>}
                    </button>
                  ) : href ? (
                    <Link href={href} prefetch={false}>{viewEnrichedLabel}<ArrowRight size={13} /></Link>
                  ) : null}
                  {record.originalUrl ? (
                    <a href={record.originalUrl} rel="noreferrer" target="_blank">
                      {openOriginalLabel}<ArrowRight size={13} />
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        {onLoadMore && loadMoreLabel ? (
          <button
            className="signal-v2-tn__button signal-v2-tn__load-more"
            disabled={loading}
            onClick={onLoadMore}
            type="button"
          >
            {loading ? loadingLabel : loadMoreLabel}
          </button>
        ) : null}
    </WorkspaceDrawer>
  );
}

function formatDrawerDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function uniqueQuote(body: string, quote: string | null | undefined) {
  const trimmed = quote?.trim();
  if (!trimmed) return null;
  const normalize = (value: string) => value
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[\p{P}\p{S}]+/gu, "")
    .trim();
  const normalizedBody = normalize(body);
  const normalizedQuote = normalize(trimmed);
  if (
    normalizedBody === normalizedQuote
    || normalizedBody.includes(normalizedQuote)
    || normalizedQuote.includes(normalizedBody)
  ) return null;
  return trimmed;
}
