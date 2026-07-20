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
import { KnowledgeBaseManager } from "@/components/brands/KnowledgeBaseManager";
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
  const subindustries = splitCatalogValue(brand.industrySub);
  const countries = brand.countries ?? [];
  const aliases = uniqueValues(brand.brandSeedHandles ?? []);
  const categoryLabel = [brand.industry, subindustries[0]].filter(Boolean).join(" / ");
  const description = brand.description?.trim();
  const competitors = brand.competitors.slice().sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

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
          <header className="brand-os-hero">
            <div className="brand-os-hero-main">
              <p className="vitals-eyebrow">{t("eyebrow")}</p>
              <div className="brand-os-title-row">
                <h1 className="vitals-name">{brandLabel}</h1>
                {brand.status === "active" ? (
                  <SuccessPill>{t("active")}</SuccessPill>
                ) : (
                  <StatusPill tone="idle">{brand.status}</StatusPill>
                )}
              </div>
              <p className="brand-os-org-line">
                {brand.organizationName ?? brand.organizationSlug ?? t("brandFallback")}
                {categoryLabel ? <span>{categoryLabel}</span> : null}
              </p>
              {description ? <p className="brand-os-description">{description}</p> : null}
            </div>

            <aside className="brand-os-command-panel" aria-label={t("actions")}>
              <div className="brand-os-hero-actions">
                <Link prefetch={false} className="brand-os-action brand-os-action--primary" href={`/studio/corpora/new?brand=${brand.id}`}>
                  <Icon name="play" size={14} /> {t("newStudy")}
                </Link>
                <Link
                  prefetch={false}
                  className="brand-os-action brand-os-action--icon"
                  href={`/studio/brands/${brand.id}/edit`}
                  title={t("editBrand")}
                  aria-label={t("editBrand")}
                >
                  <Icon name="pencil" size={15} />
                </Link>
                {brand.status === "archived" ? (
                  <PermanentDeleteBrandButton compact brandId={brand.id} brandName={brandLabel} />
                ) : (
                  <DeleteBrandButton compact brandId={brand.id} brandName={brandLabel} />
                )}
              </div>
              <div className="brand-os-metric-row">
                <Stat label={t("corpora")} value={String(brand.corpora.length)} sub={t("methodologies")} highlight />
                <Stat label={t("competitors")} value={String(competitors.length)} sub={t("seeds")} />
                <Stat label={t("aliases")} value={String(aliases.length)} sub={t("brandSeeds")} />
              </div>
            </aside>
          </header>

          <section className="brand-os-overview-grid" aria-label={t("overview")}>
            <article className="brand-os-card brand-os-card--identity">
              <div className="brand-os-card-head">
                <div>
                  <p className="vitals-eyebrow">{t("identity")}</p>
                  <h2>{t("identityTitle")}</h2>
                </div>
                <code className="brand-os-slug">{brand.slug}</code>
              </div>
              <dl className="brand-os-facts">
                <div>
                  <dt>{t("organization")}</dt>
                  <dd>{brand.organizationName ?? brand.organizationSlug ?? t("notSet")}</dd>
                </div>
                <div>
                  <dt>{t("countries")}</dt>
                  <dd>
                    <ChipList items={countries} empty={t("notSet")} tone="neutral" />
                  </dd>
                </div>
                <div>
                  <dt>{t("industry")}</dt>
                  <dd>
                    <ChipList items={brand.industry ? [brand.industry] : []} empty={t("notSet")} tone="dark" />
                  </dd>
                </div>
                <div>
                  <dt>{t("subindustries")}</dt>
                  <dd>
                    <ChipList items={subindustries} empty={t("notSet")} tone="signal" />
                  </dd>
                </div>
              </dl>
            </article>

            <article className="brand-os-card brand-os-card--seeds">
              <div className="brand-os-card-head">
                <div>
                  <p className="vitals-eyebrow">{t("brandSeeds")}</p>
                  <h2>{t("aliases")}</h2>
                </div>
                <Link
                  prefetch={false}
                  className="brand-os-card-link brand-os-card-link--icon"
                  href={`/studio/brands/${brand.id}/edit`}
                  title={t("editBrand")}
                  aria-label={t("editBrand")}
                >
                  <Icon name="pencil" size={14} />
                </Link>
              </div>
              <p className="brand-os-card-copy">{t("aliasesSubtitle")}</p>
              <ChipList items={aliases} empty={t("noAliases")} tone="signal" />
            </article>

            <article className="brand-os-card brand-os-card--trace">
              <div className="brand-os-card-head">
                <div>
                  <p className="vitals-eyebrow">{t("dataOs")}</p>
                  <h2>{t("dataOsTitle")}</h2>
                </div>
                <Icon name="layers" size={18} />
              </div>
              <div className="brand-os-trace-grid">
                <span>{t("description")}</span>
                <strong>{description ? t("ready") : t("missing")}</strong>
                <span>{t("knowledge")}</span>
                <strong>{brand.knowledgeSources.length} {t("kbBlocks")}</strong>
                <span>{t("competitors")}</span>
                <strong>{competitors.length} {t("seeds")}</strong>
              </div>
            </article>
          </section>

          <CompetitorManager
            brandId={brand.id}
            competitors={competitors}
          />

          <section className="brand-os-module">
            <header className="brand-os-module-head">
              <div>
                <p className="vitals-eyebrow">{t("corpora")}</p>
                <h2>{t("studySystem", { count: brand.corpora.length })}</h2>
              </div>
              <Link prefetch={false} className="brand-os-action brand-os-action--secondary" href={`/studio/corpora/new?brand=${brand.id}`}>
                <Icon name="play" size={14} /> {t("newStudy")}
              </Link>
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

          <KnowledgeBaseManager brandId={brand.id} sources={brand.knowledgeSources} />
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

function ChipList({ items, empty, tone }: { items: string[]; empty: string; tone: "dark" | "neutral" | "signal" }) {
  const visibleItems = uniqueValues(items);

  if (visibleItems.length === 0) {
    return <span className="brand-os-empty-inline">{empty}</span>;
  }

  return (
    <span className="brand-os-chip-list">
      {visibleItems.map((item) => (
        <span className={`brand-os-chip brand-os-chip--${tone}`} key={item}>
          {item}
        </span>
      ))}
    </span>
  );
}

function splitCatalogValue(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(/[,/]/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const clean = value.trim().replace(/\s+/g, " ");
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
