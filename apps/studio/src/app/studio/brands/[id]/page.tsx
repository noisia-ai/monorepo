import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  ArchiveCorpusButton,
  DeleteBrandButton,
  PermanentDeleteBrandButton
} from "@/components/brands/AdminEntityActions";
import { StudioNav } from "@/components/layout/StudioNav";
import { CompetitorManager } from "@/components/brands/CompetitorManager";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import { getBrandDetailForUser } from "@/lib/data/brands";

export const dynamic = "force-dynamic";

export default async function BrandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("BrandDetail");
  const tBrands = await getTranslations("Brands");
  const { id } = await params;
  const session = await requireStudioUser(`/studio/brands/${id}`);

  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    notFound();
  }

  const brandLabel = brand.displayName ?? brand.name;

  return (
    <>
      <StudioNav
        activeSection="brands"
        crumbs={[
          { label: tBrands("crumb"), href: "/studio/brands" },
          { label: brandLabel },
        ]}
        user={session.appUser}
      />
      <main className="app-content">
        <div className="studio-page">
          {/* Hero */}
          <header className="vitals">
            <div className="vitals-main">
              <p className="vitals-eyebrow">{brand.organizationName ?? brand.organizationSlug ?? t("brandFallback")}</p>
              <h1 className="vitals-name">{brandLabel}</h1>
              <div className="brand-hero-pills">
                {brand.status === "active" ? (
                  <SuccessPill>{t("active")}</SuccessPill>
                ) : (
                  <StatusPill tone="idle">{brand.status}</StatusPill>
                )}
                {brand.industry && (
                  <StatusPill tone="info">
                    {[brand.industry, brand.industrySub].filter(Boolean).join(" / ")}
                  </StatusPill>
                )}
                {brand.countries && brand.countries.length > 0 && (
                  <StatusPill tone="idle">{brand.countries.join(" · ")}</StatusPill>
                )}
              </div>
            </div>
            <div className="vitals-stats">
              <Stat label={t("corpora")} value={String(brand.corpora.length)} sub={t("methodologies")} highlight />
              <Stat label={t("competitors")} value={String(brand.competitors.length)} sub={t("seeds")} />
            </div>
            <div className="brand-hero-actions">
              <Link prefetch={false} className="wizard-cta" href={`/studio/corpora/new?brand=${brand.id}`}>
                <Icon name="sparkle" size={14} /> {t("newStudy")}
              </Link>
              <Link prefetch={false} className="wizard-cta wizard-cta--secondary" href={`/studio/brands/${brand.id}/edit`}>
                <Icon name="pencil" size={14} /> {t("editBrand")}
              </Link>
              {brand.status === "archived" ? (
                <PermanentDeleteBrandButton brandId={brand.id} brandName={brandLabel} />
              ) : (
                <DeleteBrandButton brandId={brand.id} brandName={brandLabel} />
              )}
            </div>
          </header>

          {/* Metadata strip */}
          <section className="meta-strip">
            <div className="meta-strip-item">
              <span className="meta-strip-label">Slug</span>
              <code className="meta-strip-value">{brand.slug}</code>
            </div>
            <div className="meta-strip-item">
              <span className="meta-strip-label">{t("organization")}</span>
              <span className="meta-strip-value">{brand.organizationName ?? brand.organizationSlug ?? "—"}</span>
            </div>
            <div className="meta-strip-item">
              <span className="meta-strip-label">{t("industry")}</span>
              <span className="meta-strip-value">
                {[brand.industry, brand.industrySub].filter(Boolean).join(" / ") || "—"}
              </span>
            </div>
            <div className="meta-strip-item">
              <span className="meta-strip-label">{t("countries")}</span>
              <span className="meta-strip-value">{brand.countries?.join(", ") ?? "—"}</span>
            </div>
          </section>

          <CompetitorManager
            brandId={brand.id}
            competitors={brand.competitors.slice().sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))}
          />

          {/* Corpora cards */}
          <section className="dash-section">
            <header className="dash-section-head">
              <h2>{t("corpora")} ({brand.corpora.length})</h2>
            </header>
            {brand.corpora.length === 0 ? (
              <div className="empty-card">
                <Icon name="info" size={20} className="empty-card-icon" />
                <p>{t("emptyCorpora")}</p>
              </div>
            ) : (
              <ul className="corpus-grid">
                {brand.corpora.map((corpus) => (
                  <li key={corpus.id}>
                    <article className="corpus-card">
                      <div className="corpus-card-head">
                        <div>
                          <p className="corpus-card-eyebrow">{corpus.methodologyName}</p>
                          {corpus.name && <h3 className="corpus-card-title">{corpus.name}</h3>}
                          <h3 className="corpus-card-question">
                            {corpus.businessQuestion ?? t("targetWindow", { months: corpus.targetWindowMonths ?? "—" })}
                          </h3>
                        </div>
                        {corpus.status === "corpus_approved" ? (
                          <SuccessPill>{t("approved")}</SuccessPill>
                        ) : (
                          <StatusPill tone="idle">
                            <Icon name="refresh" size={11} /> {corpus.status}
                          </StatusPill>
                        )}
                      </div>
                      <footer className="corpus-card-foot">
                        <Link prefetch={false} href={`/studio/corpora/${corpus.id}/engine`} className="corpus-card-cta">
                          {t("openEngine")} <Icon name="arrow-right" size={13} />
                        </Link>
                        <ArchiveCorpusButton
                          corpusId={corpus.id}
                          corpusName={corpus.name ?? corpus.businessQuestion ?? corpus.id}
                        />
                      </footer>
                    </article>
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
