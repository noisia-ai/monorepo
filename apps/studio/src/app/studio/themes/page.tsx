import { ArrowRight, Plus, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { AdminThemeFilters } from "@/components/admin/AdminThemeFilters";
import {
  AdminResourceSection,
  AdminStatus,
  AdminWorkspaceHeader,
  formatAdminDate
} from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import { listThemesForUser } from "@/lib/data/themes";
import type { AdminOperationalState } from "@/lib/data/admin-workspace";
import {
  getPositiveNumber,
  getSearchParam,
  resolveSearchParams,
  type StudioSearchParams
} from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function ThemesPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("AdminWorkspace.themes")]);
  const session = await requireStudioUser("/studio/themes");
  const params = await resolveSearchParams(searchParams);
  const filters = {
    organization: getSearchParam(params, "organization"),
    industry: getSearchParam(params, "industry"),
    status: getSearchParam(params, "status"),
    page: getPositiveNumber(getSearchParam(params, "page"), 1),
    pageSize: 25
  };
  const result = await listThemesForUser(session.appUser, filters);
  const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.pageSize));
  const hasActiveFilters = Boolean(filters.organization || filters.industry || filters.status);

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={(
          <Link className="admin-button admin-button--primary" href="/studio/corpora/new?subject=theme" prefetch={false}>
            <Plus aria-hidden size={15} /> {t("create")}
          </Link>
        )}
        eyebrow={t("eyebrow")}
        icon={<SquaresFour aria-hidden />}
        subtitle={t("subtitle")}
        title={t("title")}
      />

      <AdminResourceSection
        className="admin-theme-index"
        subtitle={t("table.subtitle")}
        title={t("table.title")}
      >
        <AdminThemeFilters
          industry={filters.industry}
          labels={{
            apply: t("filters.apply"),
            industry: t("filters.industry"),
            industryPlaceholder: t("filters.industryPlaceholder"),
            organization: t("filters.organization"),
            organizationPlaceholder: t("filters.organizationPlaceholder"),
            search: t("filters.search"),
            status: t("filters.status"),
            statuses: {
              active: t("statuses.active"),
              all: t("statuses.all"),
              archived: t("statuses.archived"),
              draft: t("statuses.draft"),
              published: t("statuses.published")
            }
          }}
          organization={filters.organization}
          status={filters.status}
        />

        {result.data.length === 0 ? (
          <div className="admin-empty">
            <strong>{t(hasActiveFilters ? "empty.filteredTitle" : "empty.defaultTitle")}</strong>
            <p>{t(hasActiveFilters ? "empty.filteredBody" : "empty.defaultBody")}</p>
            {!hasActiveFilters ? (
              <Link className="admin-button" href="/studio/corpora/new?subject=theme" prefetch={false}>
                <Plus aria-hidden size={15} /> {t("create")}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("columns.theme")}</th>
                  <th>{t("columns.organization")}</th>
                  <th>{t("columns.focus")}</th>
                  <th>{t("columns.status")}</th>
                  <th>{t("columns.created")}</th>
                  <th><span className="sr-only">{t("columns.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((theme) => (
                  <tr key={theme.id}>
                    <td>
                      <div className="admin-table__primary">
                        <Link href={`/studio/themes/${theme.id}`} prefetch={false}>{theme.name}</Link>
                        <small>{theme.slug}</small>
                      </div>
                    </td>
                    <td>{theme.organizationName ?? theme.organizationSlug ?? t("internal")}</td>
                    <td className="admin-table__muted">
                      {theme.industryFocus?.length ? theme.industryFocus.join(", ") : t("noFocus")}
                    </td>
                    <td><AdminStatus state={themeState(theme.status)}>{t(`statuses.${theme.status}`)}</AdminStatus></td>
                    <td className="admin-table__muted">{formatAdminDate(theme.createdAt?.toISOString(), locale)}</td>
                    <td>
                      <Link className="admin-button admin-button--icon" href={`/studio/themes/${theme.id}`} prefetch={false} title={t("open")}>
                        <ArrowRight aria-hidden size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminResourceSection>

      {totalPages > 1 ? (
        <nav aria-label={t("pagination.label")} className="admin-pagination">
          <Link className="admin-button" href={pageHref(filters.page - 1, filters)} aria-disabled={filters.page <= 1} prefetch={false}>
            {t("pagination.previous")}
          </Link>
          <span>{t("pagination.position", { page: filters.page, total: totalPages })}</span>
          <Link className="admin-button" href={pageHref(filters.page + 1, filters)} aria-disabled={filters.page >= totalPages} prefetch={false}>
            {t("pagination.next")}
          </Link>
        </nav>
      ) : null}
    </div>
  );
}

function themeState(status: string): AdminOperationalState {
  if (status === "active" || status === "published") return "good";
  if (status === "archived") return "not_available";
  return "warning";
}

function pageHref(page: number, filters: { organization?: string; industry?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters.organization) params.set("organization", filters.organization);
  if (filters.industry) params.set("industry", filters.industry);
  if (filters.status) params.set("status", filters.status);
  params.set("page", String(Math.max(1, page)));
  return `/studio/themes?${params.toString()}`;
}
