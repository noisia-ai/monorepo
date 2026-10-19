import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { AdminStatus, AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import type { FilterControl } from "@/components/filters/ReportFilterPanel";
import { MentionsBrowser } from "@/components/mentions/MentionsBrowser";
import { SourceToken, sourceLabel } from "@/components/ui/SourceIcon";
import { StatusPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import {
  getCorpusForUser,
  getMentionFacetsForCorpus,
  listMentionsForCorpus
} from "@/lib/data/corpora";
import {
  getPositiveNumber,
  getSearchParam,
  resolveSearchParams,
  type StudioSearchParams,
} from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function CorpusMentionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: StudioSearchParams;
}) {
  const { id } = await params;
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("AdminWorkspace.studySurfaces.mentions")
  ]);
  const session = await requireStudioUser(`/studio/corpora/${id}/mentions`);

  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    notFound();
  }

  const query = await resolveSearchParams(searchParams);
  const filters = {
    search: getSearchParam(query, "search"),
    platform: getSearchParam(query, "platform"),
    sentiment: getSearchParam(query, "sentiment"),
    dateFrom: getSearchParam(query, "date_from"),
    dateTo: getSearchParam(query, "date_to"),
    status: getSearchParam(query, "status"),
    cleanupKind: getSearchParam(query, "cleanup_kind"),
    exclusionReason: getSearchParam(query, "exclusion_reason"),
    sort: getSearchParam(query, "sort") || "newest",
    page: getPositiveNumber(getSearchParam(query, "page"), 1),
    pageSize: 25,
  };

  const [mentions, facets] = await Promise.all([
    listMentionsForCorpus(corpus.id, {
      inclusionStatus: filters.status,
      platform: filters.platform,
      sentiment: filters.sentiment,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      cleanupKind: filters.cleanupKind,
      exclusionReason: filters.exclusionReason,
      search: filters.search,
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    }),
    getMentionFacetsForCorpus(corpus.id)
  ]);
  const pageCount = Math.max(1, Math.ceil(mentions.pagination.total / mentions.pagination.pageSize));
  const hasNext = mentions.pagination.page * mentions.pagination.pageSize < mentions.pagination.total;
  // TODO mejora-futura: convertir estos filtros MVP en saved views por analista
  // para compartir sets como "ruido político" o "barreras operativas".
  const serializedMentions = mentions.data.map((mention) => ({
    ...mention,
    publishedAt: new Date(mention.publishedAt).toISOString()
  }));
  const filterControls: FilterControl[] = [
    {
      type: "search",
      name: "search",
      label: t("browser.controls.search"),
      placeholder: t("browser.controls.searchPlaceholder"),
      value: filters.search,
      icon: "search",
    },
    {
      type: "single",
      name: "sort",
      label: t("browser.controls.sort"),
      allLabel: t("browser.controls.newest"),
      value: filters.sort === "newest" ? "" : filters.sort,
      icon: "sort",
      options: [
        { label: t("browser.controls.oldest"), value: "oldest" },
        { label: t("browser.controls.longest"), value: "longest" },
        { label: t("browser.controls.shortest"), value: "shortest" },
        { label: t("browser.controls.pendingFirst"), value: "pending_first" },
      ],
    },
    {
      type: "single",
      name: "status",
      label: t("browser.controls.inclusion"),
      allLabel: t("browser.controls.allFeminine"),
      value: filters.status,
      icon: "check",
      options: [
        { label: t("browser.status.includedPlural"), value: "included" },
        { label: t("browser.status.excludedPlural"), value: "excluded" },
        { label: t("browser.status.pendingPlural"), value: "pending" },
      ],
    },
    {
      type: "single",
      name: "platform",
      label: t("browser.controls.sources"),
      allLabel: t("browser.controls.allFeminine"),
      value: filters.platform,
      icon: "layers",
      options: facets.platforms.map((facet) => ({
        label: sourceLabel(facet.value),
        value: facet.value,
        count: facet.count,
        source: facet.value,
      })),
    },
    {
      type: "single",
      name: "sentiment",
      label: t("browser.controls.sentiment"),
      allLabel: t("browser.controls.all"),
      value: filters.sentiment,
      icon: "sentiment",
      options: facets.sentiments.flatMap((facet) =>
        facet.value
          ? [
              {
                label: facet.value,
                value: facet.value,
                count: facet.count,
              },
            ]
          : []
      ),
    },
    {
      type: "date-range",
      label: t("browser.controls.date"),
      fromName: "date_from",
      toName: "date_to",
      fromValue: filters.dateFrom,
      toValue: filters.dateTo,
      minDate: facets.dateRange.min ? toYmd(facets.dateRange.min) : undefined,
      maxDate: facets.dateRange.max ? toYmd(facets.dateRange.max) : undefined,
      icon: "calendar",
    },
    {
      type: "single",
      name: "cleanup_kind",
      label: t("browser.controls.cleanupType"),
      allLabel: t("browser.controls.all"),
      value: filters.cleanupKind,
      icon: "layers",
      options: facets.cleanupKinds.flatMap((facet) =>
        facet.value
          ? [
              {
                label: cleanupKindLabel(facet.value, t("browser.cleanup.manual"), t("browser.cleanup.ai")),
                value: facet.value,
                count: facet.count,
              },
            ]
          : []
      ),
    },
    {
      type: "single",
      name: "exclusion_reason",
      label: t("browser.controls.exclusionReason"),
      allLabel: t("browser.controls.all"),
      value: filters.exclusionReason,
      icon: "tag",
      options: [
        { label: t("browser.controls.withReason"), value: "any" },
        ...facets.exclusionReasons.flatMap((facet) =>
          facet.value
            ? [
                {
                  label: shortReason(facet.value),
                  value: facet.value,
                  count: facet.count,
                },
              ]
            : []
        ),
      ],
    },
  ];

  return (
    <div className="admin-workspace-page admin-study-surface admin-study-mentions">
      <AdminWorkspaceHeader
        eyebrow={corpus.methodologyName ?? t("eyebrow")}
        icon={<ChatCircleText aria-hidden />}
        status={<AdminStatus state={corpus.status === "corpus_approved" ? "good" : "warning"}>{corpus.status === "corpus_approved" ? t("status.approved") : t("status.pending")}</AdminStatus>}
        subtitle={t("subtitle")}
        title={corpus.name ?? corpus.brandName ?? corpus.themeName ?? t("fallbackTitle")}
      />

      <dl className="admin-summary-strip">
        <div><dt>{t("summary.mentions")}</dt><dd>{fmt(mentions.pagination.total, locale)}</dd><small>{t("summary.filtered")}</small></div>
        <div><dt>{t("summary.page")}</dt><dd>{fmt(mentions.pagination.page, locale)}</dd><small>{t("summary.of", { count: pageCount })}</small></div>
        <div><dt>{t("summary.pageSize")}</dt><dd>{fmt(mentions.pagination.pageSize, locale)}</dd><small>{t("summary.perPage")}</small></div>
        <div>
          <dt>{t("summary.filters")}</dt>
          <dd>{[filters.status, filters.platform, filters.sentiment].filter(Boolean).length}</dd>
          <small>{t("summary.active")}</small>
        </div>
      </dl>

      <div className="admin-study-filter-status">
        {filters.status ? <StatusPill tone="idle">{filters.status}</StatusPill> : null}
        {filters.platform ? <StatusPill tone="idle"><SourceToken compact value={filters.platform} /></StatusPill> : null}
        {filters.sentiment ? <StatusPill tone="idle">{filters.sentiment}</StatusPill> : null}
      </div>

      <MentionsBrowser
        corpusId={corpus.id}
        filterControls={filterControls}
        hasActiveFilters={Boolean(filters.search || filters.platform || filters.sentiment || filters.dateFrom || filters.dateTo || filters.status || filters.cleanupKind || filters.exclusionReason || (filters.sort && filters.sort !== "newest"))}
        mentions={serializedMentions}
        searchTerm={filters.search}
        pageHref={{
          previous:
            mentions.pagination.page > 1 ? pageHref(mentions.pagination.page - 1, filters) : null,
          next: hasNext ? pageHref(mentions.pagination.page + 1, filters) : null
        }}
        pagination={mentions.pagination}
      />
    </div>
  );
}

function pageHref(
  page: number,
  filters: {
    search?: string;
    platform?: string;
    sentiment?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    cleanupKind?: string;
    exclusionReason?: string;
    sort?: string;
  }
) {
  const p = new URLSearchParams();
  p.set("page", String(page));
  if (filters.search) p.set("search", filters.search);
  if (filters.platform) p.set("platform", filters.platform);
  if (filters.sentiment) p.set("sentiment", filters.sentiment);
  if (filters.dateFrom) p.set("date_from", filters.dateFrom);
  if (filters.dateTo) p.set("date_to", filters.dateTo);
  if (filters.status) p.set("status", filters.status);
  if (filters.cleanupKind) p.set("cleanup_kind", filters.cleanupKind);
  if (filters.exclusionReason) p.set("exclusion_reason", filters.exclusionReason);
  if (filters.sort && filters.sort !== "newest") p.set("sort", filters.sort);
  return `?${p.toString()}`;
}

function fmt(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

function toYmd(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanupKindLabel(value: string | null, manualLabel: string, aiLabel: string) {
  if (value === "manual_bulk") return manualLabel;
  if (value === "claude_instruction") return aiLabel;
  return value ?? "—";
}

function shortReason(value: string | null) {
  if (!value) return "Sin motivo";
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}
