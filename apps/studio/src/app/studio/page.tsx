import Link from "next/link";

import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import { getStudioDashboard } from "@/lib/data/brands";

export const dynamic = "force-dynamic";

export default async function StudioHomePage() {
  const session = await requireStudioUser("/studio");

  const dash = await getStudioDashboard(session.appUser);

  return (
    <>
      <StudioNav activeSection="home" user={session.appUser} />
      <main className="app-content">
        <div className="studio-page">
          <header className="vitals">
            <div className="vitals-main">
              <p className="vitals-eyebrow">Workspace</p>
              <h1 className="vitals-name">Noisia Studio</h1>
            </div>
            <div className="vitals-stats">
              <Stat label="Marcas" value={fmt(dash.brands_count)} sub={dash.brands_count === 1 ? "activa" : "activas"} />
              <Stat label="Corpora" value={fmt(dash.corpora_total)} sub={`${fmt(dash.corpora_approved)} aprobados`} highlight />
              <Stat label="Menciones" value={fmt(dash.mentions_total)} sub="acumuladas" />
              <Stat label="Aprobados" value={fmt(dash.corpora_approved)} sub="listos análisis" />
            </div>
          </header>

          {/* Quick links */}
          <section className="quick-actions">
            <Link href="/studio/brands" className="quick-action-card">
              <div className="quick-action-icon"><Icon name="sparkle" size={20} /></div>
              <div className="quick-action-body">
                <h3>Marcas</h3>
                <p>Brand seeds, competidores, corpora con metodologías aplicadas.</p>
              </div>
              <Icon name="arrow-right" size={18} className="quick-action-arrow" />
            </Link>
            <Link href="/studio/brands/new" className="quick-action-card">
              <div className="quick-action-icon"><Icon name="tag" size={20} /></div>
              <div className="quick-action-body">
                <h3>Nueva marca</h3>
                <p>Configura Brand OS: aliases, competidores y conocimiento base.</p>
              </div>
              <Icon name="arrow-right" size={18} className="quick-action-arrow" />
            </Link>
            <Link href="/studio/corpora/new" className="quick-action-card">
              <div className="quick-action-icon"><Icon name="star" size={20} /></div>
              <div className="quick-action-body">
                <h3>Nuevo estudio</h3>
                <p>Crea el contenedor, elige marca y arranca el Engine para construir el corpus.</p>
              </div>
              <Icon name="arrow-right" size={18} className="quick-action-arrow" />
            </Link>
            <Link href="/studio/themes" className="quick-action-card">
              <div className="quick-action-icon"><Icon name="layers" size={20} /></div>
              <div className="quick-action-body">
                <h3>Themes</h3>
                <p>Estudios temáticos no atados a marca — visión de categoría.</p>
              </div>
              <Icon name="arrow-right" size={18} className="quick-action-arrow" />
            </Link>
          </section>

          {/* Recent corpora */}
          {dash.recent_corpora.length > 0 && (
            <section className="dash-section">
              <header className="dash-section-head">
                <h2>Corpora recientes</h2>
                <Link href="/studio/brands" className="dash-section-link">
                  Ver todas <Icon name="arrow-right" size={12} />
                </Link>
              </header>
              <ul className="recent-list">
                {dash.recent_corpora.map((c) => (
                  <li key={c.id}>
                    <Link href={`/studio/corpora/${c.id}/engine`} className="recent-card">
                      <div className="recent-card-main">
                        <p className="recent-card-eyebrow">{c.methodologyName}</p>
                        <h4 className="recent-card-brand">{c.name || c.brandName}</h4>
                        <p className="recent-card-meta">{fmt(c.included)} menciones válidas</p>
                      </div>
                      <div className="recent-card-right">
                        {c.status === "corpus_approved" ? (
                          <SuccessPill>Aprobado</SuccessPill>
                        ) : (
                          <StatusPill tone="idle">
                            <Icon name="refresh" size={11} /> En proceso
                          </StatusPill>
                        )}
                        <Icon name="arrow-right" size={16} className="recent-card-arrow" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`vital-stat${highlight ? " vital-stat--hi" : ""}`}>
      <span className="vital-stat-label">{label}</span>
      <span className="vital-stat-value">{value}</span>
      {sub && <span className="vital-stat-sub">{sub}</span>}
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}
