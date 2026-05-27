import Link from "next/link";

import { SessionBadge } from "@/components/layout/SessionBadge";
import { Icon } from "@/components/ui/Icon";
import { requirePortalUser } from "@/lib/auth/guards";
import { canAccessStudio, displayRole } from "@/lib/auth/roles";
import { listSignalOutputsForUser } from "@/lib/data/signal";

export const dynamic = "force-dynamic";

export default async function SignalPage() {
  const session = await requirePortalUser("/signal");
  const outputs = await listSignalOutputsForUser(session.appUser);
  const isInternal = canAccessStudio(session.appUser.primaryRole);

  return (
    <main className="signal-page">
      <nav className="signal-nav" aria-label="Noisia Signal">
        <Link href="/signal" className="signal-nav-logo" aria-label="Ir a Signal">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logos/logo_black.svg" alt="Noisia" width={84} height={29} />
          <span>Signal</span>
        </Link>
        <div className="signal-nav-copy">
          <span>Acceso</span>
          <strong>{displayRole(session.appUser.primaryRole)}</strong>
        </div>
        <SessionBadge user={session.appUser} compact />
      </nav>

      <section className="signal-home-hero">
        <div>
          <p className="vitals-eyebrow">Noisia Signal</p>
          <h1>Lecturas vivas, publicadas con criterio.</h1>
          <p>
            Signal contiene sólo reportes aprobados. El engine, la limpieza de corpus
            y los borradores estratégicos se quedan en Studio.
          </p>
        </div>
        <div className="signal-home-actions">
          {isInternal ? (
            <Link className="wizard-cta" href="/studio">
              <Icon name="arrow-right" size={15} /> Ir a Studio
            </Link>
          ) : null}
          <span>{outputs.length} reportes publicados</span>
        </div>
      </section>

      {outputs.length > 0 ? (
        <section className="signal-output-grid">
          {outputs.map((output) => (
            <Link className="signal-output-card" href={`/signal/${output.id}`} key={output.id}>
              <span>{output.methodologyName}</span>
              <h2>{output.headline ?? output.title}</h2>
              <p>{output.summary ?? "Reporte publicado para revisión del equipo cliente."}</p>
              <footer>
                <strong>{output.brandName ?? output.brandFallbackName ?? "Marca"}</strong>
                <Icon name="arrow-right" size={16} />
              </footer>
            </Link>
          ))}
        </section>
      ) : (
        <section className="signal-empty">
          <Icon name="info" size={18} />
          <div>
            <h2>Todavía no hay Signals publicados.</h2>
            <p>
              Cuando el equipo Noisia publique un estudio, aparecerá aquí como reporte
              navegable. Si eres analista, prepáralo desde la pantalla de Review.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
