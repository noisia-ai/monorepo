import Link from "next/link";
import { ArrowRight, Database, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";

import { AdminStatus, AdminSummaryStrip, AdminWorkspaceHeader, formatAdminDate, formatAdminNumber } from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import { listAdminBrandWorkspaces } from "@/lib/data/admin-workspace";
import { getSearchParam, resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function AdminDataPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const [t, locale, session, params] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getLocale(),
    requireStudioUser("/studio/data"),
    resolveSearchParams(searchParams)
  ]);
  const brands = await listAdminBrandWorkspaces(session.appUser);
  const query = getSearchParam(params, "q")?.trim().toLocaleLowerCase() ?? "";
  const view = getSearchParam(params, "view") ?? "all";
  const attention = brands.filter(needsDataAttention);
  const healthy = brands.filter((brand) => !needsDataAttention(brand));
  const visible = brands.filter((brand) => {
    const matchesQuery = !query || [brand.brandName, brand.organizationName, brand.brandSlug]
      .some((value) => value?.toLocaleLowerCase().includes(query));
    const matchesView = view === "attention"
      ? needsDataAttention(brand)
      : view === "healthy"
        ? !needsDataAttention(brand)
        : true;
    return matchesQuery && matchesView;
  });
  const sources = brands.reduce((total, brand) => total + brand.activeSources, 0);
  const sourceIssues = brands.reduce((total, brand) => total + brand.staleSources + brand.failedSources, 0);

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        eyebrow={t("globalData.eyebrow")}
        icon={<Database aria-hidden size={21} weight="fill" />}
        subtitle={t("globalData.subtitle")}
        title={t("globalData.title")}
      />
      <AdminSummaryStrip items={[
        { label: t("globalData.summary.sources"), value: sources, hint: t("globalData.summary.sourcesHint") },
        { label: t("globalData.summary.issues"), value: sourceIssues, hint: t("globalData.summary.issuesHint"), tone: sourceIssues > 0 ? "warning" : "neutral" },
        { label: t("globalData.summary.pending"), value: brands.reduce((total, brand) => total + brand.pendingImports, 0), hint: t("globalData.summary.pendingHint") },
        { label: t("globalData.summary.workspaces"), value: brands.filter((brand) => brand.workspaceId).length, hint: t("globalData.summary.workspacesHint") }
      ]} />
      <section className="admin-section admin-resource-section">
        <header className="admin-section__head"><div><h2>{t("globalData.table.title")}</h2><p>{t("globalData.table.subtitle")}</p></div><span className="admin-table__muted">{t("globalData.table.count", { count: visible.length })}</span></header>
        <div className="admin-index-toolbar">
          <nav aria-label={t("globalData.filters.label")} className="admin-tabs">
            <Link className="admin-tabs__item" data-active={view === "all" ? "true" : undefined} href={dataHref(params, "all")} prefetch={false}>{t("globalData.filters.all")}<span>{brands.length}</span></Link>
            <Link className="admin-tabs__item" data-active={view === "attention" ? "true" : undefined} href={dataHref(params, "attention")} prefetch={false}>{t("globalData.filters.attention")}<span>{attention.length}</span></Link>
            <Link className="admin-tabs__item" data-active={view === "healthy" ? "true" : undefined} href={dataHref(params, "healthy")} prefetch={false}>{t("globalData.filters.healthy")}<span>{healthy.length}</span></Link>
          </nav>
          <form action="/studio/data" className="admin-index-search" method="get">
            <input name="view" type="hidden" value={view} />
            <MagnifyingGlass aria-hidden size={15} />
            <input aria-label={t("globalData.filters.search")} defaultValue={getSearchParam(params, "q") ?? ""} name="q" placeholder={t("globalData.filters.searchPlaceholder")} />
            <button aria-label={t("globalData.filters.search")} type="submit"><ArrowRight aria-hidden size={14} /></button>
          </form>
        </div>
        {visible.length === 0 ? <div className="admin-empty"><strong>{t("globalData.empty.title")}</strong><p>{t("globalData.empty.body")}</p></div> : <div className="admin-table-wrap"><table className="admin-table admin-table--data">
          <thead><tr><th>{t("brands.columns.brand")}</th><th>{t("globalData.columns.health")}</th><th>{t("globalData.columns.sources")}</th><th>{t("globalData.columns.mentions")}</th><th>{t("data.columns.freshness")}</th><th>{t("brands.columns.activity")}</th><th /></tr></thead>
          <tbody>{visible.map((brand) => (
            <tr key={brand.brandId}>
              <td><div className="admin-table__primary"><Link href={`/studio/brands/${brand.brandId}/data`} prefetch={false}>{brand.brandName}</Link><small>{brand.organizationName}</small></div></td>
              <td><AdminStatus state={workspaceDataState(brand)}>{t(`globalData.health.${workspaceDataState(brand)}`)}</AdminStatus></td>
              <td>{brand.activeSources}</td>
              <td>{formatAdminNumber(brand.governedMentions, locale)}</td>
              <td><AdminStatus state={brand.freshnessState}>{t(`states.${brand.freshnessLabel}`)}</AdminStatus></td>
              <td className="admin-table__muted">{formatAdminDate(brand.latestActivityAt, locale)}</td>
              <td><Link className="admin-button" href={`/studio/brands/${brand.brandId}/data`} prefetch={false}>{t("globalData.actions.open")}<ArrowRight aria-hidden size={14} /></Link></td>
            </tr>
          ))}</tbody>
        </table></div>}
      </section>
    </div>
  );
}

function workspaceDataState(brand: Awaited<ReturnType<typeof listAdminBrandWorkspaces>>[number]) {
  if (!brand.workspaceId || brand.activeSources === 0) return "not_available" as const;
  if (brand.failedSources > 0 || brand.qualityState === "danger" || brand.freshnessState === "danger") return "danger" as const;
  if (needsDataAttention(brand)) return "warning" as const;
  return "good" as const;
}

function needsDataAttention(brand: Awaited<ReturnType<typeof listAdminBrandWorkspaces>>[number]) {
  return brand.staleSources > 0
    || brand.failedSources > 0
    || brand.pendingImports > 0
    || brand.qualityState === "danger"
    || brand.qualityState === "warning"
    || brand.freshnessState === "danger"
    || brand.freshnessState === "warning";
}

function dataHref(params: Record<string, string | string[] | undefined>, view: string) {
  const next = new URLSearchParams();
  const q = getSearchParam(params, "q");
  if (q) next.set("q", q);
  if (view !== "all") next.set("view", view);
  const query = next.toString();
  return `/studio/data${query ? `?${query}` : ""}`;
}
