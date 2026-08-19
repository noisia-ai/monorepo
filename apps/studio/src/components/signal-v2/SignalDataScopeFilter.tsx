"use client";

import { ArrowRight, CaretDown, Database } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

type SignalDataScopeCopy = {
  body: string;
  coverage: string;
  eyebrow: string;
  mentions: string;
  open: string;
};

export function SignalDataScopeFilter({
  brandName,
  copy,
  coverageFrom,
  coverageThrough,
  disabled = false,
  mentionCount,
  onOpenMentions
}: {
  brandName: string;
  copy?: SignalDataScopeCopy;
  coverageFrom: string;
  coverageThrough: string;
  disabled?: boolean;
  mentionCount: number;
  onOpenMentions: () => void;
}) {
  const t = useTranslations("SignalV2");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const labels = copy ?? {
    body: t("dataScope.body"),
    coverage: t("dataScope.coverage"),
    eyebrow: t("dataScope.eyebrow"),
    mentions: t("dataScope.mentions"),
    open: t("dataScope.open")
  };

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchorRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="signal-v2-filter-anchor" ref={anchorRef}>
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        className={`signal-v2-filter${open ? " signal-v2-filter--active" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Database size={15} />
        {t("filters.dataScope", { brand: brandName })}
        <CaretDown size={13} />
      </button>
      {open ? (
        <div aria-label={labels.eyebrow} className="signal-v2-scope-popover" id={popoverId} role="dialog">
          <small>{labels.eyebrow}</small>
          <strong>{brandName}</strong>
          <p>{labels.body}</p>
          <dl>
            <div>
              <dt>{labels.mentions}</dt>
              <dd>{new Intl.NumberFormat(locale).format(mentionCount)}</dd>
            </div>
            <div>
              <dt>{labels.coverage}</dt>
              <dd>{formatDateRange(coverageFrom, coverageThrough, locale)}</dd>
            </div>
          </dl>
          <button
            onClick={() => {
              setOpen(false);
              onOpenMentions();
            }}
            type="button"
          >
            {labels.open}
            <ArrowRight size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatDateRange(from: string, through: string, locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  });
  return `${formatter.format(dateOnly(from))} – ${formatter.format(dateOnly(through))}`;
}

function dateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return new Date(value);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
