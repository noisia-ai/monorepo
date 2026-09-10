import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listClientBrandWorkspaceEntriesV1 } from "@/lib/data-os/workspace-management-entry";
import { ClientBrandWorkspaceList } from "@/components/brands/ClientBrandWorkspaceList";

import { SessionBadge } from "@/components/layout/SessionBadge";
import { Icon } from "@/components/ui/Icon";
import { requirePortalUser } from "@/lib/auth/guards";
import { canAccessStudio, displayRole } from "@/lib/auth/roles";
import { listSignalOutputsForUser } from "@/lib/data/signal";

export const dynamic = "force-dynamic";

export default async function SignalPage() {
  const session = await requirePortalUser("/signal");
  const isInternalUser = session.appUser.userType === "noisia_internal";
  const [outputs, entries, t] = await Promise.all([listSignalOutputsForUser(session.appUser),
    isInternalUser ? Promise.resolve([]) : listClientBrandWorkspaceEntriesV1(session.appUser), getTranslations("ClientWorkspaceEntry")]);
  const isInternal = canAccessStudio(session.appUser.primaryRole);

  return (
    <main className="signal-page">
      <nav className="signal-nav" aria-label="Noisia Signal">
        <Link prefetch={false} href="/signal" className="signal-nav-logo" aria-label={t("goSignal")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logos/logo_black.svg" alt="Noisia" width={84} height={29} />
          <span>Signal</span>
        </Link>
        <div className="signal-nav-copy">
          <span>{t("access")} </span>
          <strong>{displayRole(session.appUser.primaryRole)}</strong>
        </div>
        <SessionBadge user={session.appUser} compact />
      </nav>

      <section className="signal-home-hero">
        <div>
          <p className="vitals-eyebrow">Noisia Signal</p>
          <h1>{t("homeTitle")}</h1>
          <p>
            {t("homeBody")}
          </p>
        </div>
        <div className="signal-home-actions">
          {isInternal ? (
            <Link prefetch={false} className="wizard-cta" href="/studio">
              <Icon name="arrow-right" size={15} /> {t("openStudio")}
            </Link>
          ) : null}
          <span>{t("reportCount", { count: outputs.length })}</span>
        </div>
      </section>

      {!isInternalUser ? <ClientBrandWorkspaceList entries={entries} /> : null}
      <h2>{t("reports")}</h2>
      {outputs.length > 0 ? (
        <section className="signal-output-grid">
          {outputs.map((output) => (
            <Link prefetch={false} className="signal-output-card" href={`/signal/${output.id}`} key={output.id}>
              <span>{output.methodologyName}</span>
              <h2>{output.headline ?? output.title}</h2>
              <p>{output.summary ?? t("reportFallback")}</p>
              <footer>
                <strong>{output.brandName ?? output.brandFallbackName ?? output.themeName ?? "Industria / Theme"}</strong>
                <Icon name="arrow-right" size={16} />
              </footer>
            </Link>
          ))}
        </section>
      ) : (
        <section className="signal-empty">
          <Icon name="info" size={18} />
          <div>
            <h3>{t("reportEmpty")}</h3>
            <p>
              {t("reportEmptyBody")}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
