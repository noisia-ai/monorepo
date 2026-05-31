import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import { listBrandsForUser } from "@/lib/data/brands";
import {
  getPositiveNumber,
  getSearchParam,
  resolveSearchParams,
  type StudioSearchParams,
} from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function BrandsPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const t = await getTranslations("Brands");
  const session = await requireStudioUser("/studio/brands");

  const params = await resolveSearchParams(searchParams);
  const filters = {
    organization: getSearchParam(params, "organization"),
    industry: getSearchParam(params, "industry"),
    status: getSearchParam(params, "status"),
    page: getPositiveNumber(getSearchParam(params, "page"), 1),
    pageSize: 25,
  };
  const result = await listBrandsForUser(session.appUser, filters);
  const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.pageSize));

  return (
    <>
      <StudioNav activeSection="brands" crumbs={[{ label: t("crumb") }]} user={session.appUser} />
      <main className="app-content">
        <div className="studio-page">
          {/* Header */}
          <header className="page-head">
            <div>
              <p className="vitals-eyebrow">{t("eyebrow")}</p>
              <h1 className="page-head-title">{t("title")}</h1>
              <p className="page-head-sub">
                {result.pagination.total} {result.pagination.total === 1 ? t("countSingular") : t("countPlural")} ·
                {t("page", { page: result.pagination.page, totalPages })}
              </p>
            </div>
            <div className="page-head-actions">
              <Link prefetch={false} className="wizard-cta wizard-cta--secondary" href="/studio/brands/new">
                <Icon name="sparkle" size={14} /> {t("newBrand")}
              </Link>
              <Link prefetch={false} className="wizard-cta" href="/studio/corpora/new">
                <Icon name="play" size={14} /> {t("newStudy")}
              </Link>
            </div>
          </header>

          {/* Filter bar */}
          <form className="filter-bar-v2">
            <label className="filter-field">
              <span className="filter-label">{t("filters.organization")}</span>
              <input
                className="filter-input"
                defaultValue={filters.organization ?? ""}
                name="organization"
                placeholder={t("filters.organizationPlaceholder")}
              />
            </label>
            <label className="filter-field">
              <span className="filter-label">{t("filters.industry")}</span>
              <input
                className="filter-input"
                defaultValue={filters.industry ?? ""}
                name="industry"
                placeholder={t("filters.industryPlaceholder")}
              />
            </label>
            <label className="filter-field">
              <span className="filter-label">{t("filters.status")}</span>
              <select className="filter-input" defaultValue={filters.status ?? ""} name="status">
                <option value="">{t("filters.all")}</option>
                <option value="active">{t("filters.active")}</option>
                <option value="paused">{t("filters.paused")}</option>
                <option value="archived">{t("filters.archived")}</option>
              </select>
            </label>
            <button className="wizard-cta wizard-cta--secondary" type="submit">
              <Icon name="play" size={13} /> {t("filters.submit")}
            </button>
          </form>

          {/* Brand cards grid */}
          {result.data.length === 0 ? (
            <div className="empty-card">
              <Icon name="info" size={20} className="empty-card-icon" />
              <p>{t("empty")}</p>
            </div>
          ) : (
            <ul className="brand-grid">
              {result.data.map((brand) => (
                <li key={brand.id}>
                  <Link prefetch={false} href={`/studio/brands/${brand.id}`} className="brand-card">
                    <div className="brand-card-head">
                      <div>
                        <p className="brand-card-eyebrow">
                          {brand.organizationName ?? brand.organizationSlug ?? "—"}
                        </p>
                        <h3 className="brand-card-name">{brand.displayName ?? brand.name}</h3>
                      </div>
                      {brand.status === "active" ? (
                        <SuccessPill>Activa</SuccessPill>
                      ) : (
                        <StatusPill tone="idle">{brand.status}</StatusPill>
                      )}
                    </div>

                    <p className="brand-card-meta">
                          {[brand.industry, brand.industrySub].filter(Boolean).join(" / ") || t("noIndustry")}
                      {brand.countries && brand.countries.length > 0 && (
                        <> · {brand.countries.join(", ")}</>
                      )}
                    </p>

                    <footer className="brand-card-foot">
                      <div className="brand-card-stat">
                        <span className="brand-card-stat-value">{brand.corporaCount}</span>
                        <span className="brand-card-stat-label">
                          {brand.corporaCount === 1 ? t("corpusSingular") : t("corpusPlural")}
                        </span>
                      </div>
                      {brand.corporaApproved > 0 && (
                        <div className="brand-card-stat brand-card-stat--good">
                          <span className="brand-card-stat-value">{brand.corporaApproved}</span>
                          <span className="brand-card-stat-label">{t("approved")}</span>
                        </div>
                      )}
                      <Icon name="arrow-right" size={16} className="brand-card-arrow" />
                    </footer>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="pagination-v2" aria-label={t("pagination.label")}>
              <Link prefetch={false}
                aria-disabled={filters.page <= 1}
                className="wizard-cta wizard-cta--ghost"
                href={`/studio/brands?page=${Math.max(1, filters.page - 1)}`}
              >
                <Icon name="chevron-down" size={13} className="icon--flip" /> {t("pagination.previous")}
              </Link>
              <span className="pagination-position">
                {filters.page} / {totalPages}
              </span>
              <Link prefetch={false}
                aria-disabled={filters.page >= totalPages}
                className="wizard-cta wizard-cta--ghost"
                href={`/studio/brands?page=${Math.min(totalPages, filters.page + 1)}`}
              >
                {t("pagination.next")} <Icon name="arrow-right" size={13} />
              </Link>
            </nav>
          )}
        </div>
      </main>
    </>
  );
}
