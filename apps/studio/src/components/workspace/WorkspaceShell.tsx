"use client";

import Image from "next/image";
import Link from "next/link";
import { MagnifyingGlass, SpinnerGap, X } from "@phosphor-icons/react";
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  useEffect,
  useRef
} from "react";
import { createPortal } from "react-dom";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function WorkspaceShell({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={classes("workspace-shell", className)} {...props}>
      {children}
    </div>
  );
}

export function WorkspaceSkipLink({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  return (
    <a className={classes("workspace-shell__skip", className)} {...props}>
      {children}
    </a>
  );
}

export function WorkspaceTopbar({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"header">) {
  return (
    <header className={classes("workspace-shell__topbar", className)} {...props}>
      {children}
    </header>
  );
}

export function WorkspaceProductBrand({
  href,
  product
}: {
  href: string;
  product: string;
}) {
  return (
    <Link className="workspace-shell__product-brand" href={href} prefetch={false}>
      <Image
        alt="Noisia"
        height={20}
        priority
        src="/assets/logos/logo_black.svg"
        width={70}
      />
      <span>{product}</span>
    </Link>
  );
}

export function WorkspaceSearchTrigger({
  children,
  onClick
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className="workspace-shell__search-trigger" onClick={onClick} type="button">
      <MagnifyingGlass aria-hidden size={16} />
      <span>{children}</span>
      <kbd>⌘ K</kbd>
    </button>
  );
}

export function WorkspaceTopbarActions({ children }: { children: ReactNode }) {
  return <div className="workspace-shell__topbar-actions">{children}</div>;
}

export function WorkspaceAccount({
  label,
  name,
  tone = "neutral"
}: {
  label: string;
  name: string;
  tone?: "brand" | "neutral";
}) {
  return (
    <div className={`workspace-shell__account workspace-shell__account--${tone}`}>
      <span>{label}</span>
      <strong>{name}</strong>
    </div>
  );
}

export function WorkspaceStatus({
  children,
  marker = true,
  tone = "neutral"
}: {
  children: ReactNode;
  marker?: boolean;
  tone?: "danger" | "neutral" | "success" | "warning";
}) {
  return (
    <span className={`workspace-status workspace-status--${tone}`}>
      {marker ? <i aria-hidden /> : null}
      {children}
    </span>
  );
}

export function WorkspaceConfirmDialog({
  busy,
  cancelLabel,
  children,
  confirmDisabled = false,
  confirmLabel,
  message,
  open,
  title,
  tone = "default",
  onClose,
  onConfirm
}: {
  busy: boolean;
  cancelLabel: string;
  children?: ReactNode;
  confirmDisabled?: boolean;
  confirmLabel: string;
  message: string;
  open: boolean;
  title: string;
  tone?: "danger" | "default";
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="workspace-dialog-layer"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <section
        aria-modal="true"
        className="workspace-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="workspace-dialog__head">
          <div>
            <h2>{title}</h2>
            <p>{message}</p>
          </div>
          <button
            aria-label={cancelLabel}
            className="workspace-dialog__close"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden size={17} />
          </button>
        </header>
        {children ? <div className="workspace-dialog__body">{children}</div> : null}
        <footer className="workspace-dialog__actions">
          <button className="admin-button" disabled={busy} onClick={onClose} type="button">
            {cancelLabel}
          </button>
          <button
            className={classes("admin-button", tone === "danger" ? "admin-button--danger" : "admin-button--primary")}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
            type="button"
          >
            {busy ? <SpinnerGap aria-hidden className="workspace-shell__nav-pending" size={14} /> : null}
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

export function WorkspaceNavigation({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"nav">) {
  return (
    <nav className={classes("workspace-shell__navigation", className)} {...props}>
      {children}
    </nav>
  );
}

export function WorkspaceGlobalSidebar({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"aside">) {
  return (
    <aside className={classes("workspace-shell__global-sidebar", className)} {...props}>
      {children}
    </aside>
  );
}

export function WorkspaceContextSidebar({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"aside">) {
  return (
    <aside className={classes("workspace-shell__context-sidebar", className)} {...props}>
      {children}
    </aside>
  );
}

export function WorkspaceMain({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"main">) {
  return (
    <main className={classes("workspace-shell__main", className)} {...props}>
      {children}
    </main>
  );
}

export function WorkspaceOverlay({
  className,
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={classes("workspace-shell__overlay", className)}
      type="button"
      {...props}
    />
  );
}

export function WorkspaceNavLink({
  active = false,
  activeClassName,
  children,
  className,
  href,
  icon,
  label,
  onClick,
  onNavigate,
  pending = false,
  pendingClassName,
  pendingIconClassName,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Link>, "children" | "href"> & {
  active?: boolean;
  activeClassName?: string;
  children?: ReactNode;
  href: string;
  icon?: ReactNode;
  label?: ReactNode;
  onNavigate?: () => void;
  pending?: boolean;
  pendingClassName?: string;
  pendingIconClassName?: string;
}) {
  return (
    <Link
      aria-busy={pending}
      aria-current={active ? "page" : undefined}
      className={classes(
        "workspace-shell__nav-link",
        className,
        active && (activeClassName ?? "workspace-shell__nav-link--active"),
        pending && (pendingClassName ?? "workspace-shell__nav-link--pending")
      )}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (
          event.button !== 0
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || event.altKey
        ) return;
        if (active && !onNavigate) {
          event.preventDefault();
          return;
        }
        if (!onNavigate) return;
        event.preventDefault();
        onNavigate();
      }}
      prefetch={false}
      {...props}
    >
      {icon ? <span className="workspace-shell__nav-icon">{icon}</span> : null}
      {label ?? children}
      {pending ? (
        <SpinnerGap
          aria-hidden
          className={classes("workspace-shell__nav-pending", pendingIconClassName)}
          size={13}
        />
      ) : null}
    </Link>
  );
}

export function WorkspaceHeader({
  "data-signal-module-header": signalModuleHeader,
  aside,
  className,
  controls,
  controlsClassName,
  eyebrow,
  headClassName,
  icon,
  status,
  subtitle,
  title,
  titleId,
  titleLineClassName
}: {
  aside?: ReactNode;
  className?: string;
  controls?: ReactNode;
  controlsClassName?: string;
  eyebrow?: ReactNode;
  headClassName?: string;
  icon?: ReactNode;
  status?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  titleId?: string;
  titleLineClassName?: string;
  "data-signal-module-header"?: string;
}) {
  return (
    <header
      aria-labelledby={titleId}
      className={classes(
        "workspace-header",
        controls != null && "workspace-header--with-controls",
        className
      )}
      data-signal-module-header={signalModuleHeader}
      data-workspace-header
    >
      <div className={classes("workspace-header__head", headClassName)}>
        <div>
          {eyebrow ? <p className="workspace-header__eyebrow">{eyebrow}</p> : null}
          <div className={classes("workspace-header__title-line", titleLineClassName)}>
            {icon}
            <h1 id={titleId}>{title}</h1>
            {status ? <span>{status}</span> : null}
          </div>
          {subtitle ? <p className="workspace-header__subtitle">{subtitle}</p> : null}
        </div>
        {aside}
      </div>
      {controls ? (
        <div className={classes("workspace-header__controls", controlsClassName)}>
          {controls}
        </div>
      ) : null}
    </header>
  );
}

export function WorkspaceDrawer({
  ariaLabel,
  bodyClassName,
  children,
  closeLabel,
  eyebrow,
  footer,
  headerClassName,
  layerClassName,
  onClose,
  panelClassName,
  scrimClassName,
  title
}: {
  ariaLabel: string;
  bodyClassName?: string;
  children: ReactNode;
  closeLabel: string;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  headerClassName?: string;
  layerClassName?: string;
  onClose: () => void;
  panelClassName?: string;
  scrimClassName?: string;
  title: ReactNode;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const containKeyboardFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.classList.add("workspace-drawer-open");
    document.addEventListener("keydown", containKeyboardFocus);
    closeButtonRef.current?.focus();
    return () => {
      document.body.classList.remove("workspace-drawer-open");
      document.removeEventListener("keydown", containKeyboardFocus);
      returnFocusTo?.focus();
    };
  }, []);

  return (
    <div className={classes("workspace-drawer-layer", layerClassName)}>
      <button
        aria-hidden="true"
        className={classes("workspace-drawer__scrim", scrimClassName)}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <aside
        aria-label={ariaLabel}
        aria-modal="true"
        className={classes("workspace-drawer", panelClassName)}
        ref={panelRef}
        role="dialog"
      >
        <header className={classes("workspace-drawer__header", headerClassName)}>
          <div>
            {eyebrow ? <small>{eyebrow}</small> : null}
            <h2>{title}</h2>
          </div>
          <button aria-label={closeLabel} onClick={onClose} ref={closeButtonRef} type="button">
            <X aria-hidden size={17} />
          </button>
        </header>
        <div className={classes("workspace-drawer__body", bodyClassName)}>{children}</div>
        {footer ? <footer className="workspace-drawer__footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}

export function WorkspaceControlsPanel({
  ariaLabel,
  bodyClassName,
  bodyOpenClassName,
  children,
  closeLabel,
  count,
  footer,
  icon,
  label,
  onClose,
  panelClassName,
  portal = false,
  scrimClassName,
  tabIcon,
  title
}: {
  ariaLabel: string;
  bodyClassName?: string;
  bodyOpenClassName?: string;
  children: ReactNode;
  closeLabel: string;
  count?: number;
  footer?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  onClose: () => void;
  panelClassName?: string;
  portal?: boolean;
  scrimClassName?: string;
  tabIcon?: ReactNode;
  title: ReactNode;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    if (bodyOpenClassName) document.body.classList.add(bodyOpenClassName);
    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();
    return () => {
      if (bodyOpenClassName) document.body.classList.remove(bodyOpenClassName);
      document.removeEventListener("keydown", closeOnEscape);
      returnFocusTo?.focus();
    };
  }, [bodyOpenClassName]);

  const content = (
    <>
      <button
        aria-label={closeLabel}
        className={classes("workspace-controls-scrim", scrimClassName)}
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={ariaLabel}
        className={classes("workspace-controls", panelClassName)}
      >
        <header className="workspace-controls__header">
          <div>
            {icon}
            <strong>{title}</strong>
          </div>
          <button aria-label={closeLabel} onClick={onClose} ref={closeButtonRef} type="button">
            <X aria-hidden size={16} />
          </button>
        </header>
        <div className="workspace-controls__editor">
          <div className="workspace-controls__tabs" role="tablist">
            <button aria-selected="true" role="tab" type="button">
              {tabIcon}
              {label}
            </button>
            <span>{count || null}</span>
          </div>
          <div className={classes("workspace-controls__body", bodyClassName)}>{children}</div>
          {footer ? <footer className="workspace-controls__footer">{footer}</footer> : null}
        </div>
      </aside>
    </>
  );

  return portal && typeof document !== "undefined"
    ? createPortal(content, document.body)
    : content;
}
