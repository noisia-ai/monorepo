"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

export type SignalMetricHelpContent = {
  title: string;
  body: string;
  formula?: string;
  reading?: string;
};

export function SignalMetricHelp({
  content,
  label
}: {
  content: SignalMetricHelpContent;
  label: string;
}) {
  const t = useTranslations("SignalV2");
  const tooltipId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const [popoverStyle, setPopoverStyle] = useState<
    React.CSSProperties & { "--signal-help-arrow"?: string }
  >({});

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(180, Math.min(292, window.innerWidth - 24));
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const naturalHeight = popoverRef.current?.scrollHeight ?? 260;
    const spaceAbove = rect.top - 12;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const useAbove = spaceAbove > 180
      && (spaceAbove >= naturalHeight + 9 || spaceAbove > spaceBelow);
    const top = useAbove
      ? Math.max(12, rect.top - naturalHeight - 9)
      : Math.min(rect.bottom + 9, window.innerHeight - naturalHeight - 12);
    const arrowLeft = Math.max(18, Math.min(width - 18, rect.left + rect.width / 2 - left));
    setPlacement(useAbove ? "above" : "below");
    setPopoverStyle({
      left,
      top: Math.max(12, top),
      width,
      "--signal-help-arrow": `${arrowLeft}px`
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onViewportChange = () => updatePosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) return;
      if (popoverRef.current?.contains(event.target as Node)) return;
      setPinned(false);
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinned(false);
      setOpen(false);
      anchorRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pinned]);

  const popover = open && typeof document !== "undefined"
    ? createPortal(
        <div
          className={`signal-v2-metric-help__popover signal-v2-metric-help__popover--${placement}`}
          id={tooltipId}
          ref={popoverRef}
          role="tooltip"
          style={popoverStyle}
        >
          <strong>{content.title}</strong>
          <p>{content.body}</p>
          {content.formula ? <code>{content.formula}</code> : null}
          {content.reading ? (
            <div>
              <small>{t("helpers.howToRead")}</small>
              <p>{content.reading}</p>
            </div>
          ) : null}
          <i aria-hidden />
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className="signal-v2-metric-help signal-v2-metric-help--title"
        onBlur={() => {
          if (!pinned) setOpen(false);
        }}
        onClick={() => {
          setPinned((current) => {
            const next = !current;
            setOpen(next);
            return next;
          });
        }}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!pinned) setOpen(false);
        }}
        ref={anchorRef}
        type="button"
      >
        {label}
      </button>
      {popover}
    </>
  );
}
