"use client";

import { useEffect, useState, useTransition } from "react";

import { WorkspaceSelect } from "@/components/admin/WorkspaceSelect";
import type { AppLocale } from "@/i18n/locales";

type LocaleSwitcherProps = {
  ariaLabel?: string;
  locale: AppLocale;
  labels: Record<AppLocale, string>;
  action: (formData: FormData) => Promise<void>;
};

export function LocaleSwitcher({ ariaLabel = "Language", locale, labels, action }: LocaleSwitcherProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedLocale, setSelectedLocale] = useState(locale);

  useEffect(() => {
    setSelectedLocale(locale);
  }, [locale]);

  function selectLocale(nextLocale: string) {
    const previousLocale = selectedLocale;
    const next = nextLocale as AppLocale;
    setSelectedLocale(next);
    const formData = new FormData();
    formData.set("locale", next);
    startTransition(() => {
      void action(formData)
        .then(() => window.location.reload())
        .catch(() => setSelectedLocale(previousLocale));
    });
  }

  return (
    <div className="locale-switcher" aria-label={ariaLabel}>
      <WorkspaceSelect
        ariaLabel={ariaLabel}
        disabled={isPending}
        name="locale"
        onChange={selectLocale}
        options={Object.entries(labels).map(([value, label]) => ({ value, label }))}
        value={selectedLocale}
      />
    </div>
  );
}
