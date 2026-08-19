import Link from "next/link";
import { ArrowLeft, ArrowRight, Buildings, Plus } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";

import {
  AdminResourceSection,
  AdminStatus,
  AdminWorkspaceHeader,
  formatAdminDate,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { AdminBrandFilters } from "@/components/admin/AdminBrandFilters";
import { PermanentDeleteBrandButton } from "@/components/brands/AdminEntityActions";
import { requireStudioUser } from "@/lib/auth/guards";
import { listAdminBrandWorkspaces } from "@/lib/data/admin-workspace";
import {
  getPositiveNumber,
  getSearchParam,
  resolveSearchParams,
  type StudioSearchParams
} from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function BrandsPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const [t, locale, session, params] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getLocale(),
    requireStudioUser("/studio/brands"),
    resolveSearchParams(searchParams)
  ]);
  const query = getSearchParam(params, "q")?.trim().toLocaleLowerCase() ?? "";
  const organization = getSearchParam(params, "organization")?.trim().toLocaleLowerCase() ?? "";
  const status = getSearchParam(params, "status") ?? "";
  const page = getPositiveNumber(getSearchParam(params, "page"), 1);
  const pageSize = 30;
  const rows = (await listAdminBrandWorkspaces(session.appUser)).filter((brand) => {
    const queryMatches = !query || [brand.brandName, brand.brandSlug, brand.industry]
      .some((value) => value?.toLocaleLowerCase().includes(query));
    const organizationMatches = !organization
      || brand.organizationName.toLocaleLowerCase().includes(organization)
      || brand.organizationId.toLocaleLowerCase() === organization;
    return queryMatches && organizationMatches && (!status || brand.brandStatus === status);
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={(
          <Link className="admin-button admin-button--primary" href="/studio/brands/new" prefetch={false}>
            <Plus aria-hidden size={15} weight="bold" />{t("brands.actions.create")}
          </Link>
        )}
        eyebrow={t("brands.eyebrow")}
        icon={<Buildings aria-hidden size={21} weight="fill" />}
        subtitle={t("brands.subtitle", { count: rows.length })}
        title={t("brands.title")}
      />

      <AdminResourceSection
        actions={<span className="admin-table__muted">{t("brands.table.count", { count: rows.length })}</span>}
        className="admin-brands-index"
        subtitle={t("brands.table.subtitle")}
        title={t("brands.table.title")}
      >
        <AdminBrandFilters
          labels={{
            apply: t("brands.filters.apply"),
            organization: t("brands.filters.organization"),
            organizationPlaceholder: t("brands.filters.organizationPlaceholder"),
            search: t("brands.filters.search"),
            searchPlaceholder: t("brands.filters.searchPlaceholder"),
            status: t("brands.filters.status"),
            statuses: {
              active: t("states.active"),
              all: t("brands.filters.allStatuses"),
              archived: t("states.archived"),
              paused: t("states.paused")
            }
          }}
          organization={getSearchParam(params, "organization") ?? ""}
          query={getSearchParam(params, "q") ?? ""}
          status={status}
        />
        {visible.length === 0 ? (
          <div className="admin-empty">
            <strong>{t("brands.empty.title")}</strong>
            <p>{t("brands.empty.body")}</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--brands">
              <thead><tr>
                <th>{t("brands.columns.brand")}</th>
                <th>{t("brands.columns.mentions")}</th>
                <th>{t("brands.columns.coverage")}</th>
                <th>{t("brands.columns.health")}</th>
                <th>{t("brands.columns.report")}</th>
                <th>{t("brands.columns.activity")}</th>
                <th aria-label={t("brands.columns.actions")} />
              </tr></thead>
              <tbody>
                {visible.map((brand) => (
                  <tr key={brand.brandId}>
                    <td>
                      <div className="admin-table__primary">
                        <Link href={`/studio/brands/${brand.brandId}`} prefetch={false}>{brand.brandName}</Link>
                        <small>{brand.organizationName}{brand.industry ? ` · ${brand.industry}` : ""}</small>
                      </div>
                    </td>
                    <td>{formatAdminNumber(brand.governedMentions, locale)}</td>
                    <td>
                      <AdminStatus state={brand.coverageState}>
                        {brand.coverageFrom && brand.coverageThrough
                          ? `${formatAdminDate(brand.coverageFrom, locale)} – ${formatAdminDate(brand.coverageThrough, locale)}`
                          : t("coverage.notAvailable")}
                      </AdminStatus>
                    </td>
                    <td>
                      <div className="admin-status-stack">
                        <AdminStatus state={brand.freshnessState}>{t(`states.${brand.freshnessLabel}`)}</AdminStatus>
                        <AdminStatus state={brand.qualityState}>{t(`quality.${brand.qualityState}`)}</AdminStatus>
                      </div>
                    </td>
                    <td><AdminStatus state={reportTone(brand.reportState)}>{t(`reports.states.${brand.reportState}`)}</AdminStatus></td>
                    <td className="admin-table__muted">{formatAdminDate(brand.latestActivityAt, locale)}</td>
                    <td>
                      {brand.brandStatus === "archived" && !brand.workspaceId ? (
                        <PermanentDeleteBrandButton brandId={brand.brandId} brandName={brand.brandName} />
                      ) : (
                        <Link aria-label={t("brands.actions.open", { brand: brand.brandName })} className="admin-button" href={`/studio/brands/${brand.brandId}`} prefetch={false}>
                          <ArrowRight aria-hidden size={14} />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminResourceSection>

      {totalPages > 1 ? (
        <nav aria-label={t("brands.pagination.label")} className="admin-workspace-actions" style={{ marginTop: 14 }}>
          <Link className="admin-button" href={pageHref(params, Math.max(1, safePage - 1))} prefetch={false}>
            <ArrowLeft aria-hidden size={14} />{t("brands.pagination.previous")}
          </Link>
          <span className="admin-table__muted">{t("brands.pagination.position", { page: safePage, total: totalPages })}</span>
          <Link className="admin-button" href={pageHref(params, Math.min(totalPages, safePage + 1))} prefetch={false}>
            {t("brands.pagination.next")}<ArrowRight aria-hidden size={14} />
          </Link>
        </nav>
      ) : null}
    </div>
  );
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const next = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params)) {
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (value != null) next.append(key, value);
    }
  }
  next.set("page", String(page));
  return `/studio/brands?${next}`;
}

function reportTone(state: string) {
  if (state === "published") return "good" as const;
  if (state === "needs_review" || state === "running") return "warning" as const;
  return "not_available" as const;
}
