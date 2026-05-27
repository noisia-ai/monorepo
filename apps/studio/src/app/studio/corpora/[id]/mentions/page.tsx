import { notFound } from "next/navigation";

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
      label: "Buscar texto",
      placeholder: "Ej. deducible, fraude, ajustador",
      value: filters.search,
      icon: "search",
    },
    {
      type: "single",
      name: "sort",
      label: "Ordenar",
      allLabel: "Más recientes",
      value: filters.sort === "newest" ? "" : filters.sort,
      icon: "sort",
      options: [
        { label: "Más antiguas", value: "oldest" },
        { label: "Texto más largo", value: "longest" },
        { label: "Texto más corto", value: "shortest" },
        { label: "Pendientes primero", value: "pending_first" },
      ],
    },
    {
      type: "single",
      name: "status",
      label: "Inclusión",
      allLabel: "Todas",
      value: filters.status,
      icon: "check",
      options: [
        { label: "Incluidas", value: "included" },
        { label: "Excluidas", value: "excluded" },
        { label: "Pendientes", value: "pending" },
      ],
    },
    {
      type: "single",
      name: "platform",
      label: "Fuentes",
      allLabel: "Todas",
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
      label: "Sentimiento",
      allLabel: "Todos",
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
      label: "Fecha",
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
      label: "Tipo limpieza",
      allLabel: "Todos",
      value: filters.cleanupKind,
      icon: "layers",
      options: facets.cleanupKinds.flatMap((facet) =>
        facet.value
          ? [
              {
                label: cleanupKindLabel(facet.value),
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
      label: "Motivo exclusión",
      allLabel: "Todos",
      value: filters.exclusionReason,
      icon: "tag",
      options: [
        { label: "Con motivo", value: "any" },
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
    <div className="studio-page">
      <header className="vitals mentions-vitals">
        <div className="vitals-main">
          <p className="vitals-eyebrow">{corpus.methodologyName}</p>
          <h1 className="vitals-name">{corpus.name ?? corpus.brandName ?? corpus.themeName ?? "Corpus"}</h1>
          <div className="mentions-vitals-pills">
            <StatusPill tone="info">{corpus.status}</StatusPill>
            {filters.status ? <StatusPill tone="idle">{filters.status}</StatusPill> : null}
            {filters.platform ? (
              <StatusPill tone="idle">
                <SourceToken compact value={filters.platform} />
              </StatusPill>
            ) : null}
            {filters.sentiment ? <StatusPill tone="idle">{filters.sentiment}</StatusPill> : null}
          </div>
        </div>
        <div className="vitals-stats">
          <Stat label="Menciones" value={fmt(mentions.pagination.total)} sub="filtradas" highlight />
          <Stat label="Página" value={fmt(mentions.pagination.page)} sub={`de ${fmt(pageCount)}`} />
          <Stat label="Tamaño" value={fmt(mentions.pagination.pageSize)} sub="por página" />
        </div>
      </header>

      <MentionsBrowser
        corpusId={corpus.id}
        filterControls={filterControls}
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

function Stat({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className={`vital-stat${highlight ? " vital-stat--hi" : ""}`}>
      <span className="vital-stat-label">{label}</span>
      <span className="vital-stat-value">{value}</span>
      <span className="vital-stat-sub">{sub}</span>
    </div>
  );
}

function fmt(value: number) {
  return new Intl.NumberFormat("es-MX").format(value);
}

function toYmd(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanupKindLabel(value: string | null) {
  if (value === "manual_bulk") return "Manual";
  if (value === "claude_instruction") return "AI";
  return value ?? "Sin tipo";
}

function shortReason(value: string | null) {
  if (!value) return "Sin motivo";
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}
