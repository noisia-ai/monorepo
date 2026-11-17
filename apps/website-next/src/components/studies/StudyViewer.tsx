"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Download, Minus, NavArrowLeft, NavArrowRight, Plus, Presentation, ShareIos, SidebarCollapse, SidebarExpand, Xmark } from "iconoir-react";
import styles from "./viewer.module.css";

/**
 * The study viewer. On tablet and desktop: the deck the builder made, read-only, on a stage with
 * thumbnails that hide, zoom, slide navigation (keys, thumbnails, arrows), present, share and the
 * PDF; the slide in view stays in the URL (?slide=). The deck is served from this same origin, so
 * the page drives it directly (goTo, slidechange). On a phone a 16:9 slide is a fifth of its size
 * and its text unreadable, so the slides come as images one under the other: tapping one opens it
 * full size, where the phone can turn or zoom.
 */

const DESKTOP = "(min-width: 768px)";
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const FIT = ZOOMS.indexOf(1);
const THUMBS_KEY = "noisia-viewer-thumbs";
const PAD = 24;
/** Room under the slide for the floating slide control. */
const DOCK = 76;

type Deck = HTMLElement & { goTo(i: number): void };

export type ViewerLabels = {
  close: string;
  slides: string;
  slideOf: string[];
  slideAlt: string[];
  prev: string;
  next: string;
  showThumbs: string;
  hideThumbs: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  share: string;
  copied: string;
  downloadPdf: string;
  present: string;
  tapHint: string;
};

type Props = {
  title: string;
  studyHref: string;
  shareUrl: string;
  deckSrc: string;
  slides: string[];
  initialSlide: number;
  pdfHref: string | null;
  labels: ViewerLabels;
};

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useLayout(): "deck" | "stack" | null {
  return useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(DESKTOP).matches ? "deck" : "stack"),
    () => null
  );
}

function useShare(title: string, url: string, copied: string) {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  const share = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast(copied);
    } catch {
      setToast(url);
    }
  }, [title, url, copied]);
  return { share, toast };
}

export function StudyViewer(props: Props) {
  const layout = useLayout();
  if (layout === "stack") return <StackViewer {...props} />;
  return <DeckViewer {...props} ready={layout === "deck"} />;
}

function Logo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/noisia.svg" alt="Noisia" className={styles.logo} />;
}

function DeckViewer({ title, studyHref, shareUrl, deckSrc, slides, initialSlide, pdfHref, labels, ready }: Props & { ready: boolean }) {
  const [current, setCurrent] = useState(initialSlide);
  const [total, setTotal] = useState(slides.length);
  const [thumbs, setThumbs] = useState(true);
  const [zoom, setZoom] = useState(FIT);
  const [fit, setFit] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState(16 / 9);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const deck = useRef<Deck | null>(null);
  const rail = useRef<HTMLOListElement>(null);
  const { share, toast } = useShare(title, shareUrl, labels.copied);

  // Thumbnails: the reader's last choice, open by default on wide screens.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THUMBS_KEY);
    } catch {}
    setThumbs(stored ? stored === "1" : window.innerWidth >= 1100);
  }, []);
  const toggleThumbs = useCallback(() => {
    setThumbs((open) => {
      try {
        localStorage.setItem(THUMBS_KEY, open ? "0" : "1");
      } catch {}
      return !open;
    });
  }, []);

  // The size at which the slide fits the stage; zoom multiplies it and the stage scrolls.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(0, el.clientWidth - PAD * 2);
      const h = Math.max(0, el.clientHeight - PAD - DOCK);
      const width = Math.min(w, h * ratio);
      setFit({ width: Math.floor(width), height: Math.floor(width / ratio) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ratio, ready]);

  const goTo = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(total - 1, index));
      setCurrent(next);
      deck.current?.goTo(next);
    },
    [total]
  );

  const present = useCallback(() => {
    canvas.current?.requestFullscreen?.().then(() => frame.current?.contentWindow?.focus()).catch(() => {});
  }, []);

  const zoomBy = useCallback((step: number) => setZoom((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + step))), []);

  // Keys the page handles, also when the deck has the focus (it handles the arrows itself).
  const onShortcut = useCallback(
    (event: KeyboardEvent, fromDeck: boolean) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const nav: Record<string, () => void> = fromDeck
        ? {}
        : {
            ArrowRight: () => goTo(current + 1),
            ArrowDown: () => goTo(current + 1),
            PageDown: () => goTo(current + 1),
            " ": () => goTo(current + 1),
            ArrowLeft: () => goTo(current - 1),
            ArrowUp: () => goTo(current - 1),
            PageUp: () => goTo(current - 1),
            Home: () => goTo(0),
            End: () => goTo(total - 1)
          };
      const actions: Record<string, () => void> = {
        ...nav,
        "+": () => zoomBy(1),
        "=": () => zoomBy(1),
        "-": () => zoomBy(-1),
        "0": () => setZoom(FIT),
        t: toggleThumbs,
        f: present
      };
      const action = actions[event.key];
      if (!action) return;
      if (!fromDeck && target?.closest("button, a") && (event.key === " " || event.key === "Enter")) return;
      event.preventDefault();
      action();
    },
    [current, goTo, present, toggleThumbs, total, zoomBy]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => onShortcut(event, false);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onShortcut]);

  const shortcut = useRef(onShortcut);
  useEffect(() => {
    shortcut.current = onShortcut;
  }, [onShortcut]);

  // Wire the deck once it has loaded: hide its own counter and rail, follow its slide.
  const onFrameLoad = useCallback(() => {
    const win = frame.current?.contentWindow as (Window & typeof globalThis) | null;
    const doc = frame.current?.contentDocument;
    if (!win || !doc) return;
    win.customElements.whenDefined("deck-stage").then(() => {
      const el = doc.querySelector("deck-stage") as Deck | null;
      if (!el) return;
      deck.current = el;
      const w = Number(el.getAttribute("width")) || 1920;
      const h = Number(el.getAttribute("height")) || 1080;
      setRatio(w / h);
      const style = doc.createElement("style");
      style.textContent = ".overlay, .rail, .rail-resize { display: none !important; }";
      el.shadowRoot?.append(style);
      el.addEventListener("slidechange", (event) => {
        const detail = (event as CustomEvent<{ index: number; total: number }>).detail;
        setCurrent(detail.index);
        setTotal(detail.total);
      });
      win.addEventListener("keydown", (event) => shortcut.current(event, true));
    });
  }, []);

  // The slide in view lives in the URL, so a reload or a copied address lands on it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (current === 0) url.searchParams.delete("slide");
    else url.searchParams.set("slide", String(current + 1));
    window.history.replaceState(window.history.state, "", url);
  }, [current]);

  useEffect(() => {
    if (!thumbs) return;
    rail.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, thumbs]);

  const scale = ZOOMS[zoom];
  const size = { width: Math.round(fit.width * scale), height: Math.round(fit.height * scale) };
  const counter = labels.slideOf[current] ?? `${current + 1} / ${total}`;

  return (
    <div className={styles.shell} data-thumbs={thumbs ? "open" : "closed"}>
      <header className={styles.bar}>
        <div className={styles.barStart}>
          <a href={studyHref} className={styles.iconButton} aria-label={labels.close} title={labels.close}>
            <Xmark aria-hidden />
          </a>
          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleThumbs}
            aria-pressed={thumbs}
            aria-label={thumbs ? labels.hideThumbs : labels.showThumbs}
            title={`${thumbs ? labels.hideThumbs : labels.showThumbs} (T)`}
          >
            {thumbs ? <SidebarCollapse aria-hidden /> : <SidebarExpand aria-hidden />}
          </button>
          <span className={styles.divider} aria-hidden />
          <Logo />
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{title}</h1>
            <span className={styles.subtitle}>{labels.slides}</span>
          </div>
        </div>

        <div className={styles.barEnd}>
          <div className={styles.zoom} role="group" aria-label={`${labels.zoomOut} / ${labels.zoomIn}`}>
            <button type="button" className={styles.iconButton} onClick={() => zoomBy(-1)} disabled={zoom === 0} aria-label={labels.zoomOut} title={`${labels.zoomOut} (−)`}>
              <Minus aria-hidden />
            </button>
            <button type="button" className={styles.zoomValue} onClick={() => setZoom(FIT)} title={`${labels.fit} (0)`}>
              {zoom === FIT ? labels.fit : `${Math.round(scale * 100)}%`}
            </button>
            <button type="button" className={styles.iconButton} onClick={() => zoomBy(1)} disabled={zoom === ZOOMS.length - 1} aria-label={labels.zoomIn} title={`${labels.zoomIn} (+)`}>
              <Plus aria-hidden />
            </button>
          </div>
          <button type="button" className={styles.iconButton} onClick={share} aria-label={labels.share} title={labels.share}>
            <ShareIos aria-hidden />
          </button>
          <button type="button" className={styles.textButton} onClick={present} title={`${labels.present} (F)`}>
            <Presentation aria-hidden /> <span>{labels.present}</span>
          </button>
          {pdfHref ? (
            <a className={styles.primaryButton} href={pdfHref} download>
              <Download aria-hidden /> <span>{labels.downloadPdf}</span>
            </a>
          ) : null}
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.rail} aria-label={labels.slides} aria-hidden={!thumbs} inert={!thumbs}>
          <ol ref={rail}>
            {slides.map((src, i) => (
              <li key={src}>
                <button type="button" className={styles.thumb} data-index={i} aria-current={i === current ? "true" : undefined} onClick={() => goTo(i)} aria-label={labels.slideAlt[i]}>
                  <span className={styles.thumbNumber}>{i + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading={i < 8 ? "eager" : "lazy"} decoding="async" />
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className={styles.stageWrap}>
          <div className={styles.stage} ref={stage}>
            <div className={styles.canvas} ref={canvas} style={fit.width ? size : undefined}>
              {ready ? (
                <iframe ref={frame} src={`${deckSrc}#${initialSlide + 1}`} title={title} allow="fullscreen" referrerPolicy="same-origin" onLoad={onFrameLoad} />
              ) : null}
            </div>
          </div>
          <div className={styles.dock}>
            <button type="button" className={styles.dockButton} onClick={() => goTo(current - 1)} disabled={current === 0} aria-label={labels.prev} title={`${labels.prev} (←)`}>
              <NavArrowLeft aria-hidden />
            </button>
            <span className={styles.counter} aria-live="polite">
              {counter}
            </span>
            <button type="button" className={styles.dockButton} onClick={() => goTo(current + 1)} disabled={current >= total - 1} aria-label={labels.next} title={`${labels.next} (→)`}>
              <NavArrowRight aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <p className={styles.toast} role="status" data-visible={toast ? "true" : undefined}>
        {toast}
      </p>
    </div>
  );
}

function StackViewer({ title, studyHref, shareUrl, slides, pdfHref, labels }: Props) {
  const { share, toast } = useShare(title, shareUrl, labels.copied);
  return (
    <div className={styles.mobile}>
      <header className={styles.mobileBar}>
        <a href={studyHref} className={styles.iconButton} aria-label={labels.close}>
          <Xmark aria-hidden />
        </a>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{title}</h1>
          <span className={styles.subtitle}>{labels.slides}</span>
        </div>
        <button type="button" className={styles.iconButton} onClick={share} aria-label={labels.share}>
          <ShareIos aria-hidden />
        </button>
      </header>
      <p className={styles.hint}>{labels.tapHint}</p>
      <ol className={styles.stack}>
        {slides.map((src, i) => (
          <li key={src} id={`slide-${i + 1}`}>
            <a href={src} target="_blank" rel="noopener">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={labels.slideAlt[i]} loading={i < 2 ? "eager" : "lazy"} decoding="async" />
            </a>
          </li>
        ))}
      </ol>
      {pdfHref ? (
        <div className={styles.pdfDock}>
          <a className={styles.primaryButton} href={pdfHref} download>
            <Download aria-hidden /> <span>{labels.downloadPdf}</span>
          </a>
        </div>
      ) : null}
      <p className={styles.toast} role="status" data-visible={toast ? "true" : undefined}>
        {toast}
      </p>
    </div>
  );
}
