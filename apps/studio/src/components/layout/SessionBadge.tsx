import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/components/i18n/LocaleSwitcher";
import { Icon } from "@/components/ui/Icon";
import { setUserLocaleAction } from "@/app/actions/locale";
import { isAppLocale, type AppLocale } from "@/i18n/locales";
import { displayRole } from "@/lib/auth/roles";

type SessionBadgeUser = {
  email: string;
  fullName: string | null;
  primaryRole: string;
};

type SessionBadgeProps = {
  user: SessionBadgeUser;
  compact?: boolean;
};

export async function SessionBadge({ user, compact = false }: SessionBadgeProps) {
  const [localeValue, t] = await Promise.all([getLocale(), getTranslations("Session")]);
  const locale = isAppLocale(localeValue) ? localeValue : "es-MX";
  const label = user.fullName || user.email;
  const labels: Record<AppLocale, string> = {
    "es-MX": t("languages.es-MX"),
    "en-US": t("languages.en-US")
  };

  return (
    <div className={`session-badge${compact ? " session-badge--compact" : ""}`}>
      <div className="session-badge-avatar" aria-hidden="true">
        {initials(label)}
      </div>
      <div className="session-badge-main">
        <span className="session-badge-name">{label}</span>
        <span className="session-badge-role">
          <Icon name="tag" size={11} />
          {displayRole(user.primaryRole)}
        </span>
      </div>
      <LocaleSwitcher locale={locale} labels={labels} action={setUserLocaleAction} />
      <Link prefetch={false} className="session-badge-logout" href="/api/auth/logout">
        {t("logout")}
      </Link>
    </div>
  );
}

function initials(value: string) {
  const parts = value
    .replace(/@.*/, "")
    .split(/[.\s_-]+/)
    .filter(Boolean);

  return (parts[0]?.[0] ?? "N").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}
