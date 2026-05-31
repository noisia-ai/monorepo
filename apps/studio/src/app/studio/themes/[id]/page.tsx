import Link from "next/link";
import { notFound } from "next/navigation";

import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import { getThemeDetailForUser } from "@/lib/data/themes";

export const dynamic = "force-dynamic";

export default async function ThemeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/themes/${id}`);

  const theme = await getThemeDetailForUser(session.appUser, id);

  if (!theme) {
    notFound();
  }

  return (
    <>
      <StudioNav
        activeSection="themes"
        crumbs={[
          { label: "Themes", href: "/studio/themes" },
          { label: theme.name },
        ]}
        user={session.appUser}
      />
      <main className="app-content">
        <div className="studio-page">
          <header className="vitals">
            <div className="vitals-main">
              <p className="vitals-eyebrow">
                {theme.organizationName ?? theme.organizationSlug ?? "Noisia Internal"}
              </p>
              <h1 className="vitals-name">{theme.name}</h1>
              <div className="brand-hero-pills">
                {theme.status === "active" || theme.status === "published" ? (
                  <SuccessPill>{theme.status}</SuccessPill>
                ) : (
                  <StatusPill tone="idle">{theme.status}</StatusPill>
                )}
                {theme.isPublic && <StatusPill tone="info">Público</StatusPill>}
                {theme.industryFocus && theme.industryFocus.length > 0 && (
                  <StatusPill tone="idle">{theme.industryFocus.join(", ")}</StatusPill>
                )}
              </div>
              {theme.description && <p className="theme-description">{theme.description}</p>}
            </div>
            <div className="vitals-stats">
              <Stat label="Corpora" value={String(theme.corpora.length)} sub="estudios" highlight />
            </div>
          </header>

          <section className="meta-strip">
            <div className="meta-strip-item">
              <span className="meta-strip-label">Slug</span>
              <code className="meta-strip-value">{theme.slug}</code>
            </div>
            <div className="meta-strip-item">
              <span className="meta-strip-label">Foco geográfico</span>
              <span className="meta-strip-value">{theme.geoFocus?.join(", ") ?? "—"}</span>
            </div>
            <div className="meta-strip-item">
              <span className="meta-strip-label">Visibilidad</span>
              <span className="meta-strip-value">{theme.isPublic ? "Pública" : "Privada"}</span>
            </div>
          </section>

          <section className="dash-section">
            <header className="dash-section-head">
              <h2>Corpora ({theme.corpora.length})</h2>
            </header>
            {theme.corpora.length === 0 ? (
              <div className="empty-card">
                <Icon name="info" size={20} className="empty-card-icon" />
                <p>Todavía no hay corpora derivados de este theme.</p>
              </div>
            ) : (
              <ul className="corpus-grid">
                {theme.corpora.map((corpus) => (
                  <li key={corpus.id}>
                    <Link prefetch={false} href={`/studio/corpora/${corpus.id}/engine`} className="corpus-card">
                      <div className="corpus-card-head">
                        <div>
                          <p className="corpus-card-eyebrow">{corpus.methodologyName}</p>
                          {corpus.name && <h3 className="corpus-card-title">{corpus.name}</h3>}
                          <h3 className="corpus-card-question">
                            {corpus.businessQuestion ?? `Ventana objetivo: ${corpus.targetWindowMonths} meses`}
                          </h3>
                        </div>
                        {corpus.status === "corpus_approved" ? (
                          <SuccessPill>Aprobado</SuccessPill>
                        ) : (
                          <StatusPill tone="idle">{corpus.status}</StatusPill>
                        )}
                      </div>
                      <footer className="corpus-card-foot">
                        <span className="corpus-card-cta">
                          Abrir engine <Icon name="arrow-right" size={13} />
                        </span>
                      </footer>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
