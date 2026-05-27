import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { authContinuePath, postLoginPath, safeRelativePath } from "@/lib/auth/redirects";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams?: StudioSearchParams }) {
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
          <span>Studio access</span>
        </div>

        <div className="auth-copy">
          <p className="vitals-eyebrow">Acceso seguro</p>
          <h1 id="login-title">Noisia Studio</h1>
          <p>
            Entra con tu cuenta de Noisia. Si eres analista irás al engine; si eres cliente,
            entrarás a Signal, la experiencia de reportes publicados.
          </p>
        </div>

        <div className="auth-actions">
          <Link className="wizard-cta" href={authHref("/api/auth/login", continueTo)}>
            <Icon name="arrow-right" size={15} /> Entrar
          </Link>
          <Link className="wizard-cta wizard-cta--secondary" href={authHref("/api/auth/register", continueTo)}>
            Crear cuenta
          </Link>
        </div>

        <p className="auth-hint">
          Si vienes de un link interno, regresamos a esa pantalla después de iniciar sesión.
        </p>
      </section>
    </main>
  );
}

function authHref(base: string, next: string) {
  return `${base}?post_login_redirect_url=${encodeURIComponent(next)}`;
}
