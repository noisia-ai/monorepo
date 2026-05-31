import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { authContinuePath, postLoginPath, safeRelativePath } from "@/lib/auth/redirects";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const t = await getTranslations("Login");
  const session = await getAuthenticatedAppUser();
  const params = await resolveSearchParams(searchParams);
  const next = safeRelativePath(params.next, "");
  const continueTo = authContinuePath(next);

  if (session) {
    redirect(postLoginPath(session.appUser.primaryRole, next));
  }

  return (
    <main className="auth-shell auth-shell--login">
      <section className="auth-card auth-card--login" aria-labelledby="login-title">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logos/logo_black.svg" alt="Noisia" width={112} height={39} />
          <span>{t("brand")}</span>
        </div>

        <div className="auth-copy">
          <p className="vitals-eyebrow">{t("eyebrow")}</p>
          <h1 id="login-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>

        <div className="auth-actions">
          <Link prefetch={false} className="wizard-cta" href={authHref("/api/auth/login", continueTo)}>
            <Icon name="arrow-right" size={15} /> {t("enter")}
          </Link>
          <Link prefetch={false} className="wizard-cta wizard-cta--secondary" href={authHref("/api/auth/register", continueTo)}>
            {t("createAccount")}
          </Link>
        </div>

        <p className="auth-hint">{t("hint")}</p>
      </section>
    </main>
  );
}

function authHref(base: string, next: string) {
  return `${base}?post_login_redirect_url=${encodeURIComponent(next)}`;
}
