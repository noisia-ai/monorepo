"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    if (!window.confirm(t("archiveCorpusConfirm", { name: corpusName }))) return;

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
    }
  }

  return (
    <div className="admin-action-stack">
      <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy} onClick={archive}>
        <Icon name={busy ? "spinner" : "x"} size={13} /> {busy ? t("archiving") : t("archiveCorpus")}
      </button>
      {error ? <span className="team-msg team-msg--error">{error}</span> : null}
    </div>
  );
}

export function DeleteBrandButton({
  brandId,
  brandName
}: {
  brandId: string;
  brandName: string;
}) {
  const t = useTranslations("AdminActions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  async function remove() {
    if (!window.confirm(t("deleteBrandConfirm", { name: brandName }))) return;

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
    }
  }

  return (
    <div className="admin-action-stack">
      <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy} onClick={remove}>
        <Icon name={busy ? "spinner" : "x"} size={13} /> {busy ? t("deleting") : t("deleteBrand")}
      </button>
      {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
    </div>
  );
}

export function PermanentDeleteBrandButton({
  brandId,
  brandName
}: {
  brandId: string;
  brandName: string;
}) {
  const t = useTranslations("AdminActions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removePermanently() {
    if (!window.confirm(t("permanentDeleteBrandConfirm", { name: brandName }))) return;

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
    }
  }

  return (
    <div className="admin-action-stack">
      <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy} onClick={removePermanently}>
        <Icon name={busy ? "spinner" : "x"} size={13} /> {busy ? t("deleting") : t("permanentDelete")}
      </button>
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
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  async function remove() {
    const confirmKey = isArchived ? "permanentDeleteThemeConfirm" : "deleteThemeConfirm";
    if (!window.confirm(t(confirmKey, { name: themeName }))) return;

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
    }
  }

  return (
    <div className="admin-action-stack">
      <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy} onClick={remove}>
        <Icon name={busy ? "spinner" : "x"} size={13} />{" "}
        {busy ? t("deleting") : isArchived ? t("permanentDelete") : t("deleteTheme")}
      </button>
      {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
    </div>
  );
}
