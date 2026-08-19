import Link from "next/link";
import { ArrowRight, Database, Gear, Translate, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";

import { setUserLocaleAction } from "@/app/actions/locale";
import { AdminResourceSection, AdminSettingsRow, AdminStatus, AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { LocaleSwitcher } from "@/components/i18n/LocaleSwitcher";
import { requireStudioUser } from "@/lib/auth/guards";
import { canManageTeam } from "@/lib/auth/roles";
import { signalOperationalReadMode } from "@/lib/data-os/signal-operational-read-scope";
import { isAppLocale } from "@/i18n/locales";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const [t, sessionT, localeValue, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getTranslations("Session"),
    getLocale(),
    requireStudioUser("/studio/settings")
  ]);
  const readMode = signalOperationalReadMode();
  const locale = isAppLocale(localeValue) ? localeValue : "es-MX";
  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader eyebrow={t("globalSettings.eyebrow")} icon={<Gear aria-hidden size={21} weight="fill" />} subtitle={t("globalSettings.subtitle")} title={t("globalSettings.title")} />
      <div className="admin-settings-stack">
        <AdminResourceSection className="admin-settings-group" subtitle={t("globalSettings.general.subtitle")} title={t("globalSettings.general.title")}>
          <div className="admin-settings-list">
            <AdminSettingsRow
              action={<LocaleSwitcher
                action={setUserLocaleAction}
                ariaLabel={t("globalSettings.general.language")}
                labels={{ "es-MX": sessionT("languages.es-MX"), "en-US": sessionT("languages.en-US") }}
                locale={locale}
              />}
              description={t("globalSettings.general.languageHint")}
              icon={<Translate aria-hidden size={18} />}
              title={t("globalSettings.general.language")}
            />
            <AdminSettingsRow
              action={canManageTeam(session.appUser.primaryRole) ? <Link className="admin-button" href="/studio/team" prefetch={false}>{t("globalSettings.permissions.manage")}<ArrowRight aria-hidden size={14} /></Link> : null}
              description={t("globalSettings.permissions.subtitle")}
              icon={<UsersThree aria-hidden size={18} />}
              title={t("globalSettings.permissions.title")}
              value={session.appUser.primaryRole}
            />
          </div>
        </AdminResourceSection>

        <AdminResourceSection className="admin-settings-group" subtitle={t("globalSettings.serving.subtitle")} title={t("globalSettings.serving.title")}>
          <div className="admin-settings-list">
            <AdminSettingsRow description={t("globalSettings.serving.readModeHint")} icon={<Database aria-hidden size={18} />} title={t("globalSettings.serving.readMode")} value={<AdminStatus state={readMode === "governed" ? "good" : "warning"}>{t(`topbar.readMode.${readMode}`)}</AdminStatus>} />
            <AdminSettingsRow description={t("globalSettings.serving.scopeHint")} title={t("globalSettings.serving.scope")} value="primary_brand" />
            <AdminSettingsRow description={t("globalSettings.serving.rollbackValue")} title={t("globalSettings.serving.rollback")} />
            <AdminSettingsRow description={t("globalSettings.serving.deferred")} title={t("globalSettings.serving.exploration")} />
          </div>
        </AdminResourceSection>
      </div>
    </div>
  );
}
