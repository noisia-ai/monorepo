"use client";

import { type ReactNode, useMemo } from "react";
import { useTranslations } from "next-intl";
import { WorkspaceSelectField } from "./WorkspaceSelect";
import { workspaceTimezoneOptions } from "@/lib/timezone-catalog";

export function WorkspaceTimezoneField({ value, onChange, ariaLabel, disabled = false, hint, label,
  name = "timezone", surface = "workspace" }: {
  value: string; onChange: (value: string) => void; ariaLabel?: string; disabled?: boolean;
  hint?: ReactNode; label?: ReactNode; name?: string; surface?: "study" | "workspace";
}) {
  const t = useTranslations("BrandOs.form");
  const options = useMemo(() => workspaceTimezoneOptions(value), [value]);
  const search = useMemo(() => ({ placeholder: t("timezoneSearch"), empty: t("timezoneEmpty") }), [t]);
  const resolvedLabel = label ?? t("timezone");
  return <WorkspaceSelectField ariaLabel={ariaLabel ?? String(resolvedLabel)} className={surface === "study" ? "new-study-field" : undefined}
    disabled={disabled} hint={hint ?? t("timezoneHelp")} label={resolvedLabel} name={name} onChange={onChange}
    options={options} search={search} value={value} />;
}
