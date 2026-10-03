import Link from "next/link";
import { ArrowRight, FileText, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";

import { AdminStatus, AdminSummaryStrip, AdminWorkspaceHeader, formatAdminDate } from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import { listAdminBrandWorkspaces } from "@/lib/data/admin-workspace";
import { getSearchParam, resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const [t, locale, session, params] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getLocale(),
    requireStudioUser("/studio/reports"),
    resolveSearchParams(searchParams)
  ]);
  const brands = await listAdminBrandWorkspaces(session.appUser);
  const query = getSearchParam(params, "q")?.trim().toLocaleLowerCase() ?? "";
  const view = getSearchParam(params, "view") ?? "all";
  const published = brands.filter((brand) => brand.reportState === "published");
  const review = brands.filter((brand) => brand.reportsNeedingReview > 0 || brand.reportState === "needs_review");
  const unavailable = brands.filter((brand) => brand.reportState === "not_available");
  const visible = brands.filter((brand) => {
    const matchesQuery = !query || [brand.brandName, brand.organizationName, brand.brandSlug]
      .some((value) => value?.toLocaleLowerCase().includes(query));
    const matchesView = view === "published"
      ? brand.reportState === "published"
      : view === "review"
        ? brand.reportsNeedingReview > 0 || brand.reportState === "needs_review"
        : view === "unavailable"
          ? brand.reportState === "not_available"
          : true;
    return matchesQuery && matchesView;
  });
  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader eyebrow={t("globalReports.eyebrow")} icon={<FileText aria-hidden size={21} weight="fill" />} subtitle={t("globalReports.subtitle")} title={t("globalReports.title")} />
      <AdminSummaryStrip items={[
        { label: t("globalReports.summary.workspaces"), value: brands.length, hint: t("globalReports.summary.workspacesHint") },
        { label: t("globalReports.summary.published"), value: published.length, hint: t("globalReports.summary.publishedHint") },
        { label: t("globalReports.summary.review"), value: review.length, hint: t("globalReports.summary.reviewHint"), tone: review.length > 0 ? "warning" : "neutral" },
        { label: t("globalReports.summary.unavailable"), value: unavailable.length, hint: t("globalReports.summary.unavailableHint") }
      ]} />
      <section className="admin-section admin-resource-section">
        <header className="admin-section__head"><div><h2>{t("globalReports.table.title")}</h2><p>{t("globalReports.table.subtitle")}</p></div><span className="admin-table__muted">{t("globalReports.table.count", { count: visible.length })}</span></header>
        <div className="admin-index-toolbar">
          <nav aria-label={t("globalReports.filters.label")} className="admin-tabs">
            <Link className="admin-tabs__item" data-active={view === "all" ? "true" : undefined} href={reportsHref(params, "all")} prefetch={false}>{t("globalReports.filters.all")}<span>{brands.length}</span></Link>
            <Link className="admin-tabs__item" data-active={view === "published" ? "true" : undefined} href={reportsHref(params, "published")} prefetch={false}>{t("globalReports.filters.published")}<span>{published.length}</span></Link>
            <Link className="admin-tabs__item" data-active={view === "review" ? "true" : undefined} href={reportsHref(params, "review")} prefetch={false}>{t("globalReports.filters.review")}<span>{review.length}</span></Link>
            <Link className="admin-tabs__item" data-active={view === "unavailable" ? "true" : undefined} href={reportsHref(params, "unavailable")} prefetch={false}>{t("globalReports.filters.unavailable")}<span>{unavailable.length}</span></Link>
          </nav>
          <form action="/studio/reports" className="admin-index-search" method="get">
            <input name="view" type="hidden" value={view} />
            <MagnifyingGlass aria-hidden size={15} />
            <input aria-label={t("globalReports.filters.search")} defaultValue={getSearchParam(params, "q") ?? ""} name="q" placeholder={t("globalReports.filters.searchPlaceholder")} />
            <button aria-label={t("globalReports.filters.search")} type="submit"><ArrowRight aria-hidden size={14} /></button>
          </form>
        </div>
        {visible.length === 0 ? <div className="admin-empty"><strong>{t("globalReports.empty.title")}</strong><p>{t("globalReports.empty.body")}</p></div> : <div className="admin-table-wrap"><table className="admin-table admin-table--reports">
          <thead><tr><th>{t("brands.columns.brand")}</th><th>{t("globalReports.columns.report")}</th><th>{t("globalReports.columns.state")}</th><th>{t("reports.summary.current")}</th><th>{t("reports.summary.review")}</th><th>{t("brands.columns.activity")}</th><th /></tr></thead>
          <tbody>{visible.map((brand) => (
            <tr key={brand.brandId}>
              <td><div className="admin-table__primary"><Link href={`/studio/brands/${brand.brandId}/reports`} prefetch={false}>{brand.brandName}</Link><small>{brand.organizationName}</small></div></td>
              <td>{t("globalReports.reportType.tb")}</td>
              <td><AdminStatus state={reportTone(brand.reportState)}>{t(`reports.states.${brand.reportState}`)}</AdminStatus></td>
              <td>{brand.currentReportRevision ? `r${brand.currentReportRevision}` : "—"}</td>
              <td>{brand.reportsNeedingReview}</td>
              <td className="admin-table__muted">{formatAdminDate(brand.latestActivityAt, locale)}</td>
              <td><Link className="admin-button" href={`/studio/brands/${brand.brandId}/reports`} prefetch={false}>{t("globalReports.actions.open")}<ArrowRight aria-hidden size={14} /></Link></td>
            </tr>
          ))}</tbody>
        </table></div>}
      </section>
    </div>
  );
}

function reportsHref(params: Record<string, string | string[] | undefined>, view: string) {
  const next = new URLSearchParams();
  const q = getSearchParam(params, "q");
  if (q) next.set("q", q);
  if (view !== "all") next.set("view", view);
  const query = next.toString();
  return `/studio/reports${query ? `?${query}` : ""}`;
}

function reportTone(state: string) {
  if (state === "published") return "good" as const;
  if (state === "needs_review" || state === "running") return "warning" as const;
  return "not_available" as const;
}
