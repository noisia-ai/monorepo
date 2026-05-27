import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { canAccessPortal, displayRole } from "@/lib/auth/roles";
import { getSearchParam, resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function UnauthorizedPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const session = await getAuthenticatedAppUser();
  const params = await resolveSearchParams(searchParams);
  const next = getSearchParam(params, "next") ?? "/studio";
  const role = session?.appUser.primaryRole ? displayRole(session.appUser.primaryRole) : "Sin sesión";
  const canUsePortal = session?.appUser.primaryRole ? canAccessPortal(session.appUser.primaryRole) : false;

  return (
    <main className="auth-shell auth-shell--login">
      <section className="auth-card auth-card--login" aria-labelledby="unauthorized-title">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logos/logo_black.svg" alt="Noisia" width={112} height={39} />
          <span>Acceso restringido</span>
        </div>
        <div className="auth-copy">
          <p className="vitals-eyebrow">Permisos</p>
          <h1 id="unauthorized-title">Esta vista es interna.</h1>
          <p>
            Tu rol actual es <strong>{role}</strong>. El engine y el browser de corpus
            son herramientas para el equipo Noisia; los clientes entran por Signal.
          </p>
        </div>
        <div className="auth-actions">
          <Link className="wizard-cta" href={canUsePortal ? "/signal" : "/"}>
            <Icon name="arrow-right" size={15} /> {canUsePortal ? "Ir a Signal" : "Ir al inicio"}
          </Link>
          <Link className="wizard-cta wizard-cta--secondary" href="/api/auth/logout">
            Cerrar sesión
          </Link>
        </div>
        <p className="auth-hint">Destino solicitado: {safeDisplay(next)}</p>
      </section>
    </main>
  );
}

function safeDisplay(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/studio";
  return value;
}
