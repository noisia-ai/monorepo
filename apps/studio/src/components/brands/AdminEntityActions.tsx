"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/Icon";

export function ArchiveCorpusButton({
  corpusId,
  corpusName
}: {
  corpusId: string;
  corpusName: string;
}) {
  const t = useTranslations("AdminActions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/corpora/${corpusId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("archiveCorpusError"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("archiveCorpusError"));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="admin-action-stack">
      <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy} onClick={() => setConfirmOpen(true)}>
        <Icon name={busy ? "spinner" : "x"} size={13} /> {busy ? t("archiving") : t("archiveCorpus")}
      </button>
      <ConfirmActionDialog
        busy={busy}
        cancelLabel={t("confirmCancel")}
        confirmLabel={t("confirmArchive")}
        message={t("archiveCorpusConfirm", { name: corpusName })}
        open={confirmOpen}
        title={t("archiveCorpusTitle")}
        tone="danger"
        onClose={() => setConfirmOpen(false)}
        onConfirm={archive}
      />
      {error ? <span className="team-msg team-msg--error">{error}</span> : null}
    </div>
  );
}

export function DeleteBrandButton({
  brandId,
  brandName,
  compact = false
}: {
  brandId: string;
  brandName: string;
  compact?: boolean;
}) {
  const t = useTranslations("AdminActions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/brands/${brandId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("deleteBrandError"));
      if (json?.mode === "deleted") {
        router.push("/studio/brands");
        router.refresh();
        return;
      }
      setMessage({ tone: "warn", text: json?.message ?? t("brandArchived") });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("deleteBrandError") });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className={`admin-action-stack${compact ? " admin-action-stack--compact" : ""}`}>
      <button
        aria-label={t("deleteBrand")}
        className={compact ? "brand-os-action brand-os-action--icon brand-os-action--danger admin-action-button--compact" : "wizard-cta wizard-cta--danger"}
        type="button"
        disabled={busy}
        title={t("deleteBrand")}
        onClick={() => setConfirmOpen(true)}
      >
        <Icon name={busy ? "spinner" : compact ? "trash" : "x"} size={13} />
        {!compact ? (busy ? t("deleting") : t("deleteBrand")) : null}
      </button>
      <ConfirmActionDialog
        busy={busy}
        cancelLabel={t("confirmCancel")}
        confirmLabel={t("confirmDelete")}
        message={t("deleteBrandConfirm", { name: brandName })}
        open={confirmOpen}
        title={t("deleteBrandTitle")}
        tone="danger"
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
      />
      {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
    </div>
  );
}

export function PermanentDeleteBrandButton({
  brandId,
  brandName,
  compact = false
}: {
  brandId: string;
  brandName: string;
  compact?: boolean;
}) {
  const t = useTranslations("AdminActions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removePermanently() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/brands/${brandId}?permanent=true`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("permanentDeleteBrandError"));
      router.push("/studio/brands?status=archived");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("permanentDeleteBrandError"));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className={`admin-action-stack${compact ? " admin-action-stack--compact" : ""}`}>
      <button
        aria-label={t("permanentDelete")}
        className={compact ? "brand-os-action brand-os-action--icon brand-os-action--danger admin-action-button--compact" : "wizard-cta wizard-cta--danger"}
        type="button"
        disabled={busy}
        title={t("permanentDelete")}
        onClick={() => setConfirmOpen(true)}
      >
        <Icon name={busy ? "spinner" : compact ? "trash" : "x"} size={13} />
        {!compact ? (busy ? t("deleting") : t("permanentDelete")) : null}
      </button>
      <ConfirmActionDialog
        busy={busy}
        cancelLabel={t("confirmCancel")}
        confirmLabel={t("confirmPermanentDelete")}
        message={t("permanentDeleteBrandConfirm", { name: brandName })}
        open={confirmOpen}
        title={t("permanentDeleteBrandTitle")}
        tone="danger"
        onClose={() => setConfirmOpen(false)}
        onConfirm={removePermanently}
      />
      {error ? <span className="team-msg team-msg--error">{error}</span> : null}
    </div>
  );
}

export function DeleteThemeButton({
  themeId,
  themeName,
  isArchived
}: {
  themeId: string;
  themeName: string;
  isArchived: boolean;
}) {
  const t = useTranslations("AdminActions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const suffix = isArchived ? "?permanent=true" : "";
      const res = await fetch(`/api/themes/${themeId}${suffix}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("deleteThemeError"));
      if (json?.mode === "deleted" || json?.mode === "permanent") {
        router.push("/studio/themes");
        router.refresh();
        return;
      }
      setMessage({ tone: "warn", text: json?.message ?? t("themeArchived") });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("deleteThemeError") });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="admin-action-stack">
      <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy} onClick={() => setConfirmOpen(true)}>
        <Icon name={busy ? "spinner" : "x"} size={13} />{" "}
        {busy ? t("deleting") : isArchived ? t("permanentDelete") : t("deleteTheme")}
      </button>
      <ConfirmActionDialog
        busy={busy}
        cancelLabel={t("confirmCancel")}
        confirmLabel={isArchived ? t("confirmPermanentDelete") : t("confirmDelete")}
        message={t(isArchived ? "permanentDeleteThemeConfirm" : "deleteThemeConfirm", { name: themeName })}
        open={confirmOpen}
        title={t(isArchived ? "permanentDeleteThemeTitle" : "deleteThemeTitle")}
        tone="danger"
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
      />
      {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
    </div>
  );
}

function ConfirmActionDialog({
  busy,
  cancelLabel,
  confirmLabel,
  message,
  open,
  title,
  tone,
  onClose,
  onConfirm
}: {
  busy: boolean;
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  open: boolean;
  title: string;
  tone: "danger" | "default";
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
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <section
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label={cancelLabel}
          className="confirm-dialog-close"
          disabled={busy}
          type="button"
          onClick={onClose}
        >
          <Icon name="x" size={18} />
        </button>
        <div className={`confirm-dialog-mark confirm-dialog-mark--${tone}`}>
          <Icon name={busy ? "spinner" : "alert"} size={18} />
        </div>
        <div className="confirm-dialog-copy">
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button className="confirm-dialog-button confirm-dialog-button--ghost" disabled={busy} type="button" onClick={onClose}>
            {cancelLabel}
          </button>
          <button className="confirm-dialog-button confirm-dialog-button--primary" disabled={busy} type="button" onClick={onConfirm}>
            {busy ? <Icon name="spinner" size={14} /> : null}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
