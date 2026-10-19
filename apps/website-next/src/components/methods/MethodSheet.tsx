"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { Xmark } from "iconoir-react";
import { usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { methodSheet, methodSheetLabels, type MethodKey } from "@/content/pages/method-sheet";
import styles from "./MethodSheet.module.css";

const DURATION = 380;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Scroll lock shared by every sheet, so two quick opens never leave the page locked.
let locks = 0;
function lockScroll() {
  if (locks++ > 0) return;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.style.overflow = "hidden";
  if (gap > 0) document.body.style.paddingRight = `${gap}px`;
}
function unlockScroll() {
  if (--locks > 0) return;
  locks = 0;
  document.documentElement.style.overflow = "";
  document.body.style.paddingRight = "";
}

type Props = {
  method: MethodKey;
  locale: string;
  open: boolean;
  onClose: () => void;
  /** The control that opened the sheet; focus goes back to it on close. */
  returnFocus: RefObject<HTMLElement | null>;
};

/**
 * A method in short, as a bottom sheet on phones and a centered sheet on larger screens.
 * Native modal dialog (the page behind becomes inert), plus a focus loop, Escape, tap outside
 * or swipe down to close, scroll lock and focus returned to the trigger.
 */
export function MethodSheet({ method, locale, open, onClose, returnFocus }: Props) {
  const lang = locale === "en" ? "en" : "es";
  const data = methodSheet[method];
  const copy = data[lang];
  const labels = methodSheetLabels[lang];
  const Icon = data.icon;
  // Ids from the method key: identical on the server and in the browser.
  const titleId = `method-sheet-${method}-title`;
  const textId = `method-sheet-${method}-text`;
  const pathname = usePathname();
  const onMethodsPage = pathname === "/metodos";

  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y: number; dy: number; id: number } | null>(null);
  const closing = useRef(false);
  const [shown, setShown] = useState(false);

  const finish = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    if (panelRef.current) panelRef.current.style.transform = "";
    unlockScroll();
    closing.current = false;
    onClose();
    returnFocus.current?.focus({ preventScroll: true });
  }, [onClose, returnFocus]);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(finish, reduced ? 0 : DURATION);
  }, [finish]);

  // Open: show the modal, lock the page, then let the panel slide in on the next frame.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog || dialog.open) return;
    dialog.showModal();
    lockScroll();
    closeRef.current?.focus({ preventScroll: true });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Leaving the page with the sheet open (for example through its link) releases the lock.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) unlockScroll();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Swipe down from the top of the sheet to dismiss it (phones).
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || window.innerWidth >= 768) return;
    drag.current = { y: event.clientY, dy: 0, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (panelRef.current) panelRef.current.style.transition = "none";
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId || !panelRef.current) return;
    d.dy = Math.max(0, event.clientY - d.y);
    panelRef.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    const panel = panelRef.current;
    if (!d || !panel) return;
    panel.style.transition = "";
    if (d.dy > 90) {
      panel.style.transform = "";
      requestClose();
    } else {
      panel.style.transform = "";
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-shown={shown}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div className={styles.backdrop} onClick={requestClose} aria-hidden />
      <div ref={panelRef} className={styles.panel}>
        <div className={styles.art} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className={styles.grabber} aria-hidden />
          <span className={styles.iconTile} aria-hidden>
            <Icon />
          </span>
        </div>
        <button ref={closeRef} type="button" className={styles.close} onClick={requestClose} aria-label={labels.close}>
          <Xmark aria-hidden />
        </button>
        <div className={styles.body}>
          <h2 id={titleId} className={styles.title}>
            {data.name}
          </h2>
          <p className={styles.question}>{copy.question}</p>
          <p id={textId} className={styles.text}>
            {copy.description}
          </p>
          <p className={styles.roots}>
            <span>{labels.roots}</span> {copy.roots}
          </p>
          {onMethodsPage ? null : (
            <Button href="/metodos" variant="secondary" arrow className={styles.link}>
              {labels.link}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
