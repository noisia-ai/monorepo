import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { authContinuePath } from "@/lib/auth/redirects";
import { defaultAuthenticatedPath } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("Auth");
  const session = await getAuthenticatedAppUser();

  if (session) {
    redirect(defaultAuthenticatedPath(session.appUser.primaryRole));
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logos/logo_black.svg" alt="Noisia" width={112} height={39} />
          <span>{t("brand")}</span>
        </div>
        <div className="auth-copy">
          <p className="vitals-eyebrow">{t("eyebrow")}</p>
          <h1 id="auth-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        <div className="auth-actions">
          <Link prefetch={false} className="wizard-cta" href={`/api/auth/login?post_login_redirect_url=${encodeURIComponent(authContinuePath())}`}>
            <Icon name="arrow-right" size={15} /> {t("enter")}
          </Link>
          <Link prefetch={false} className="wizard-cta wizard-cta--secondary" href={`/api/auth/register?post_login_redirect_url=${encodeURIComponent(authContinuePath())}`}>
            {t("createAccount")}
          </Link>
        </div>
        <div className="auth-vitals" aria-label="Capacidades del Studio">
          <span><strong>{t("vitals.queryEngine")}</strong> {t("vitals.queryEngineDetail")}</span>
          <span><strong>{t("vitals.corpusQa")}</strong> {t("vitals.corpusQaDetail")}</span>
          <span><strong>{t("vitals.outputs")}</strong> {t("vitals.outputsDetail")}</span>
        </div>
      </section>
    </main>
  );
}
