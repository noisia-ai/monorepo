import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { authContinuePath } from "@/lib/auth/redirects";
import { defaultAuthenticatedPath } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
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
          <span>Noisia Studio</span>
        </div>
        <div className="auth-copy">
          <p className="vitals-eyebrow">Internal research workspace</p>
          <h1 id="auth-title">Entra al motor de análisis.</h1>
          <p>
            Configura corpora, valida menciones y versiona estudios antes de
            convertirlos en entregables para clientes.
          </p>
        </div>
        <div className="auth-actions">
          <Link className="wizard-cta" href={`/api/auth/login?post_login_redirect_url=${encodeURIComponent(authContinuePath())}`}>
            <Icon name="arrow-right" size={15} /> Entrar
          </Link>
          <Link className="wizard-cta wizard-cta--secondary" href={`/api/auth/register?post_login_redirect_url=${encodeURIComponent(authContinuePath())}`}>
            Crear cuenta
          </Link>
        </div>
        <div className="auth-vitals" aria-label="Capacidades del Studio">
          <span><strong>Query engine</strong> SentiOne + IA</span>
          <span><strong>Corpus QA</strong> limpieza y snapshots</span>
          <span><strong>Outputs</strong> T&B primero</span>
        </div>
      </section>
    </main>
  );
}
