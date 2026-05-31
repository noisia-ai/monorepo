import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import { getStudioDashboard } from "@/lib/data/brands";

export const dynamic = "force-dynamic";

export default async function StudioHomePage() {
  const [t, locale] = await Promise.all([getTranslations("StudioHome"), getLocale()]);
  const session = await requireStudioUser("/studio");

  const dash = await getStudioDashboard(session.appUser);

  return (
    <>
      <StudioNav activeSection="home" user={session.appUser} />
      <main className="app-content">
        <div className="studio-page">
          <header className="vitals">
            <div className="vitals-main">
              <p className="vitals-eyebrow">{t("eyebrow")}</p>
              <h1 className="vitals-name">{t("title")}</h1>
            </div>
            <div className="vitals-stats">
              <Stat label={t("stats.brands")} value={fmt(dash.brands_count, locale)} sub={dash.brands_count === 1 ? t("stats.activeSingular") : t("stats.activePlural")} />
              <Stat label={t("stats.corpora")} value={fmt(dash.corpora_total, locale)} sub={`${fmt(dash.corpora_approved, locale)} ${t("stats.approved")}`} highlight />
              <Stat label={t("stats.mentions")} value={fmt(dash.mentions_total, locale)} sub={t("stats.accumulated")} />
              <Stat label={t("stats.approvedReady")} value={fmt(dash.corpora_approved, locale)} sub={t("stats.analysisReady")} />
            </div>
          </header>

          {/* Quick links */}
          <section className="quick-actions">
            <Link prefetch={false} href="/studio/brands" className="quick-action-card">
              <div className="quick-action-icon"><Icon name="sparkle" size={20} /></div>
              <div className="quick-action-body">
                <h3>{t("actions.brands")}</h3>
                <p>{t("actions.brandsCopy")}</p>
              </div>
              <Icon name="arrow-right" size={18} className="quick-action-arrow" />
            </Link>
            <Link prefetch={false} href="/studio/brands/new" className="quick-action-card">
              <div className="quick-action-icon"><Icon name="tag" size={20} /></div>
              <div className="quick-action-body">
                <h3>{t("actions.newBrand")}</h3>
                <p>{t("actions.newBrandCopy")}</p>
              </div>
              <Icon name="arrow-right" size={18} className="quick-action-arrow" />
            </Link>
            <Link prefetch={false} href="/studio/corpora/new" className="quick-action-card">
              <div className="quick-action-icon"><Icon name="star" size={20} /></div>
              <div className="quick-action-body">
                <h3>{t("actions.newStudy")}</h3>
                <p>{t("actions.newStudyCopy")}</p>
              </div>
              <Icon name="arrow-right" size={18} className="quick-action-arrow" />
            </Link>
            <Link prefetch={false} href="/studio/themes" className="quick-action-card">
              <div className="quick-action-icon"><Icon name="layers" size={20} /></div>
              <div className="quick-action-body">
                <h3>{t("actions.themes")}</h3>
                <p>{t("actions.themesCopy")}</p>
              </div>
              <Icon name="arrow-right" size={18} className="quick-action-arrow" />
            </Link>
          </section>

          {/* Recent corpora */}
          {dash.recent_corpora.length > 0 && (
            <section className="dash-section">
              <header className="dash-section-head">
                <h2>{t("recent.title")}</h2>
                <Link prefetch={false} href="/studio/brands" className="dash-section-link">
                  {t("recent.viewAll")} <Icon name="arrow-right" size={12} />
                </Link>
              </header>
              <ul className="recent-list">
                {dash.recent_corpora.map((c) => (
                  <li key={c.id}>
                    <Link prefetch={false} href={`/studio/corpora/${c.id}/engine`} className="recent-card">
                      <div className="recent-card-main">
                        <p className="recent-card-eyebrow">{c.methodologyName}</p>
                        <h4 className="recent-card-brand">{c.name || c.brandName}</h4>
                        <p className="recent-card-meta">{fmt(c.included, locale)} {t("recent.validMentions")}</p>
                      </div>
                      <div className="recent-card-right">
                        {c.status === "corpus_approved" ? (
                          <SuccessPill>{t("recent.approved")}</SuccessPill>
                        ) : (
                          <StatusPill tone="idle">
                            <Icon name="refresh" size={11} /> {t("recent.inProgress")}
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

function fmt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}
