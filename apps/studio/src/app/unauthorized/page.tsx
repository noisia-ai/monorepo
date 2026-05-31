import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Icon } from "@/components/ui/Icon";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { canAccessPortal, displayRole } from "@/lib/auth/roles";
import { getSearchParam, resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function UnauthorizedPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const t = await getTranslations("Unauthorized");
  const session = await getAuthenticatedAppUser();
  const params = await resolveSearchParams(searchParams);
  const next = getSearchParam(params, "next") ?? "/studio";
  const role = session?.appUser.primaryRole ? displayRole(session.appUser.primaryRole) : t("noSession");
  const canUsePortal = session?.appUser.primaryRole ? canAccessPortal(session.appUser.primaryRole) : false;

  return (
    <main className="auth-shell auth-shell--login">
      <section className="auth-card auth-card--login" aria-labelledby="unauthorized-title">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logos/logo_black.svg" alt="Noisia" width={112} height={39} />
          <span>{t("brand")}</span>
        </div>
        <div className="auth-copy">
          <p className="vitals-eyebrow">{t("eyebrow")}</p>
          <h1 id="unauthorized-title">{t("title")}</h1>
          <p>{t.rich("description", { role, strong: (chunks) => <strong>{chunks}</strong> })}</p>
        </div>
        <div className="auth-actions">
          <Link prefetch={false} className="wizard-cta" href={canUsePortal ? "/signal" : "/"}>
            <Icon name="arrow-right" size={15} /> {canUsePortal ? t("goSignal") : t("goHome")}
          </Link>
          <Link prefetch={false} className="wizard-cta wizard-cta--secondary" href="/api/auth/logout">
            {t("logout")}
          </Link>
        </div>
        <p className="auth-hint">{t("requested", { next: safeDisplay(next) })}</p>
      </section>
    </main>
  );
}

function safeDisplay(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/studio";
  return value;
}
