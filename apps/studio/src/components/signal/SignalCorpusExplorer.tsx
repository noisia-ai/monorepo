"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useSignalUiLanguage, type SignalUiLanguage } from "@/components/signal/SignalReportShell";
import { Icon } from "@/components/ui/Icon";
import { SourceToken } from "@/components/ui/SourceIcon";

type Mention = Record<string, unknown>;

type CorpusMention = {
  mentionId: string;
  findingId: string;
  findingName: string;
  text: string;
  platform: string;
  publishedAt: string;
  isProtagonist: boolean;
};

const corpusCopy = {
  en: {
    title: "Corpus explorer",
    rowsLabel: "corpus mentions",
    searchAndFilters: "search and filters",
    loading: "loading",
    protagonists: "Protagonists",
    findings: "Findings",
    channels: "Channels",
    smartSearch: "Smart search",
    placeholder: 'Ex. "trust", finding:B-PER-01, tiktok, complaint',
    filtersAria: "Published corpus filters",
    channel: "Channel",
    allChannels: "All channels",
    finding: "Finding",
    allFindings: "All findings",
    evidence: "Evidence",
    allEvidence: "All evidence",
    protagonistOnly: "Protagonist only",
    supportOnly: "Support only",
    filteredTotal: "filtered mentions",
    activeFilters: "active filters",
    order: "Order",
    relevance: "Relevance",
    newest: "Newest",
    oldest: "Oldest",
    from: "From",
    to: "To",
    evidenceMix: "Evidence mix",
    noChannels: "No channels in the current filter.",
    completeCorpus: "This view queries the full authorized corpus.",
    publishedEvidence: "This view shows published evidence.",
    protagonist: "protagonist",
    support: "support",
    emptyTitle: "No verbatims match those filters.",
    emptyBody: "Remove channel, date or finding filters to widen the published sample.",
    page: "Page",
    previous: "Previous",
    next: "Next",
    filterSort: "Filter & Sort",
  },
  es: {
    title: "Explorador del corpus",
    rowsLabel: "menciones del corpus",
    searchAndFilters: "búsqueda y filtros",
    loading: "cargando",
    protagonists: "Protagonistas",
    findings: "Findings",
    channels: "Canales",
    smartSearch: "Búsqueda inteligente",
    placeholder: 'Ej. "trust", finding:B-PER-01, tiktok, complaint',
    filtersAria: "Filtros del corpus publicado",
    channel: "Canal",
    allChannels: "Todos los canales",
    finding: "Finding",
    allFindings: "Todos los findings",
    evidence: "Evidencia",
    allEvidence: "Toda la evidencia",
    protagonistOnly: "Sólo protagonista",
    supportOnly: "Sólo soporte",
    filteredTotal: "menciones filtradas",
    activeFilters: "filtros activos",
    order: "Orden",
    relevance: "Relevancia",
    newest: "Más reciente",
    oldest: "Más antiguo",
    from: "Desde",
    to: "Hasta",
    evidenceMix: "Evidence mix",
    noChannels: "Sin canales en el filtro actual.",
    completeCorpus: "Esta vista consulta el corpus completo autorizado.",
    publishedEvidence: "Esta vista muestra evidencia publicada.",
    protagonist: "protagonista",
    support: "soporte",
    emptyTitle: "No hay verbatims con esos filtros.",
    emptyBody: "Prueba quitar canal, fecha o finding para ampliar la muestra publicada.",
    page: "Página",
    previous: "Anterior",
    next: "Siguiente",
    filterSort: "Filter & Sort",
  },
} satisfies Record<SignalUiLanguage, Record<string, string>>;

const PAGE_SIZE = 240;

export function SignalCorpusExplorer({ mentions, outputId }: { mentions: Mention[]; outputId?: string }) {
  const { uiLanguage } = useSignalUiLanguage();
  const copy = corpusCopy[uiLanguage];
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("");
  const [finding, setFinding] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [evidenceRole, setEvidenceRole] = useState("");
  const [sort, setSort] = useState<"relevance" | "newest" | "oldest">("relevance");
  const [page, setPage] = useState(1);
  const [serverRows, setServerRows] = useState<CorpusMention[] | null>(null);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fallbackRows = useMemo(() => mentions.map(normalizeMention).filter((mention) => mention.text), [mentions]);
  const rows = serverRows ?? fallbackRows;

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, evidenceRole, finding, platform, query, sort]);

  useEffect(() => {
    if (!outputId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: query,
      platform,
      finding,
      dateFrom,
      dateTo,
      sort,
      page: String(page),
      limit: String(PAGE_SIZE)
    });
    setIsLoading(true);
    fetch(`/api/signal/${outputId}/corpus?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`Corpus request failed: ${res.status}`)))
      .then((payload) => {
        setServerRows(Array.isArray(payload.rows) ? payload.rows.map(normalizeMention).filter((mention: CorpusMention) => mention.text) : []);
        setServerTotal(Number(payload.total ?? 0));
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setServerRows(null);
        setServerTotal(null);
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [dateFrom, dateTo, finding, outputId, page, platform, query, sort]);

  const platforms = useMemo(
    () => Array.from(new Set(rows.map((mention) => mention.platform).filter(Boolean))).sort(),
    [rows]
  );
  const findings = useMemo(
    () => Array.from(new Map(rows.filter((mention) => mention.findingId).map((mention) => [mention.findingId, mention.findingName || mention.findingId])).entries()),
    [rows]
  );
  const dateBounds = useMemo(() => getDateBounds(rows), [rows]);

  const scored = useMemo(() => {
    if (serverRows) {
      return rows
        .map((mention) => ({ mention, score: scoreMention(mention, query) }))
        .filter(({ mention }) => {
          if (evidenceRole === "protagonist" && !mention.isProtagonist) return false;
          if (evidenceRole === "support" && mention.isProtagonist) return false;
          return true;
        });
    }
    return rows
      .map((mention) => ({ mention, score: scoreMention(mention, query) }))
      .filter(({ mention, score }) => {
        if (query.trim() && score <= 0) return false;
        if (platform && mention.platform !== platform) return false;
        if (finding && mention.findingId !== finding) return false;
        if (evidenceRole === "protagonist" && !mention.isProtagonist) return false;
        if (evidenceRole === "support" && mention.isProtagonist) return false;
        if (dateFrom && mention.publishedAt && mention.publishedAt.slice(0, 10) < dateFrom) return false;
        if (dateTo && mention.publishedAt && mention.publishedAt.slice(0, 10) > dateTo) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "newest") return dateValue(b.mention.publishedAt) - dateValue(a.mention.publishedAt);
        if (sort === "oldest") return dateValue(a.mention.publishedAt) - dateValue(b.mention.publishedAt);
        return b.score - a.score || Number(b.mention.isProtagonist) - Number(a.mention.isProtagonist) || dateValue(b.mention.publishedAt) - dateValue(a.mention.publishedAt);
      });
  }, [dateFrom, dateTo, evidenceRole, finding, platform, query, rows, serverRows, sort]);

  const filtered = scored.map((item) => item.mention);
  const activeFilters = [query, platform, finding, dateFrom, dateTo, evidenceRole].filter(Boolean).length;
  const topChannels = summarizePlatforms(filtered);
  const totalRows = serverTotal ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  function resetFilters() {
    setQuery("");
    setPlatform("");
    setFinding("");
    setDateFrom("");
    setDateTo("");
    setEvidenceRole("");
    setSort("relevance");
  }

  return (
    <section className="signal-corpus-browser signal-corpus-browser--pro">
      <header className="signal-corpus-browser-head">
        <div>
          <p className="signal-eyebrow">Corpus View</p>
          <h3>{copy.title}</h3>
          <span>
            {filtered.length} de {serverTotal ?? rows.length} {copy.rowsLabel} · {copy.searchAndFilters}
            {isLoading ? ` · ${copy.loading}` : ""}
          </span>
        </div>
        <div className="signal-corpus-summary">
          <Metric label={copy.protagonists} value={String(filtered.filter((mention) => mention.isProtagonist).length)} />
          <Metric label={copy.findings} value={String(new Set(filtered.map((mention) => mention.findingId).filter(Boolean)).size)} />
          <Metric label={copy.channels} value={String(new Set(filtered.map((mention) => mention.platform).filter(Boolean)).size)} />
        </div>
      </header>

      <div className="signal-corpus-toolbar">
        <span>{serverTotal ?? rows.length} {copy.filteredTotal}</span>
        <span>{activeFilters} {copy.activeFilters}</span>
        <span>{filtered.length} {copy.rowsLabel}</span>
        <span>{copy.page} {page} / {pageCount}</span>
      </div>

      <div className="signal-corpus-smartbar">
        <label className="signal-corpus-smart-search">
          <Icon name="search" size={16} />
          <span>{copy.smartSearch}</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.placeholder}
            type="search"
            value={query}
          />
        </label>
        <button className="signal-corpus-reset" disabled={activeFilters === 0 && sort === "relevance"} onClick={resetFilters} type="button">
          <Icon name="refresh" size={14} />
          Reset
          {activeFilters > 0 ? <span>{activeFilters}</span> : null}
        </button>
      </div>

      <div className="signal-corpus-filter-grid signal-corpus-filter-grid--browser" aria-label={copy.filtersAria}>
        <div className="signal-corpus-filter-title">
          <Icon name="filter" size={14} />
          <strong>{copy.filterSort}</strong>
        </div>
        <SelectBox label={copy.channel} value={platform} onChange={setPlatform}>
          <option value="">{copy.allChannels}</option>
          {platforms.map((item) => <option key={item} value={item}>{item}</option>)}
        </SelectBox>
        <SelectBox label={copy.finding} value={finding} onChange={setFinding}>
          <option value="">{copy.allFindings}</option>
          {findings.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </SelectBox>
        <SelectBox label={copy.evidence} value={evidenceRole} onChange={setEvidenceRole}>
          <option value="">{copy.allEvidence}</option>
          <option value="protagonist">{copy.protagonistOnly}</option>
          <option value="support">{copy.supportOnly}</option>
        </SelectBox>
        <SelectBox label={copy.order} value={sort} onChange={(value) => setSort(value as typeof sort)}>
          <option value="relevance">{copy.relevance}</option>
          <option value="newest">{copy.newest}</option>
          <option value="oldest">{copy.oldest}</option>
        </SelectBox>
        <label className="signal-corpus-date">
          <span>{copy.from}</span>
          <input min={dateBounds.min} max={dateBounds.max} onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} />
        </label>
        <label className="signal-corpus-date">
          <span>{copy.to}</span>
          <input min={dateBounds.min} max={dateBounds.max} onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
        </label>
      </div>

      <div className="signal-corpus-inspector">
        <aside className="signal-corpus-facets">
          <strong>{copy.evidenceMix}</strong>
          {topChannels.length > 0 ? topChannels.map((channel) => (
            <div key={channel.platform}>
              <SourceToken compact label={sourceDisplayLabel(channel.platform, uiLanguage)} value={channel.platform} />
              <span>{channel.count}</span>
            </div>
          )) : <p>{copy.noChannels}</p>}
          <small>{outputId ? copy.completeCorpus : copy.publishedEvidence}</small>
        </aside>

        <div className="signal-corpus-list">
          {filtered.length > 0 ? filtered.map((mention, index) => (
            <article className={mention.isProtagonist ? "signal-corpus-card signal-corpus-card--protagonist" : "signal-corpus-card"} key={mention.mentionId || index}>
              <header>
                <SourceToken compact label={sourceDisplayLabel(mention.platform || "unknown", uiLanguage)} value={mention.platform || "unknown"} />
                {mention.isProtagonist ? <strong><Icon name="star" size={11} /> {copy.protagonist}</strong> : <span>{copy.support}</span>}
                {mention.publishedAt ? <time>{formatDate(mention.publishedAt, uiLanguage)}</time> : null}
              </header>
              <p>{highlightText(mention.text, query)}</p>
              {mention.findingName ? (
                <footer>
                  <a href={`#${findingAnchor(mention.findingId)}`}>{mention.findingId} · {mention.findingName}</a>
                </footer>
              ) : null}
            </article>
          )) : (
            <div className="signal-corpus-empty">
              <Icon name="info" size={18} />
              <strong>{copy.emptyTitle}</strong>
              <span>{copy.emptyBody}</span>
            </div>
          )}
        </div>
      </div>
      <nav className="signal-corpus-pagination" aria-label="Corpus pagination">
        <button disabled={page <= 1 || isLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">
          {copy.previous}
        </button>
        <span>{copy.page} {page} / {pageCount}</span>
        <button disabled={page >= pageCount || isLoading} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">
          {copy.next}
        </button>
      </nav>
    </section>
  );
}

function SelectBox({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="signal-corpus-select">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {children}
      </select>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeMention(mention: Mention): CorpusMention {
  return {
    mentionId: stringValue(mention.mention_id),
    findingId: stringValue(mention.finding_id),
    findingName: stringValue(mention.finding_name),
    text: stringValue(mention.text),
    platform: stringValue(mention.platform),
    publishedAt: stringValue(mention.published_at),
    isProtagonist: Boolean(mention.is_protagonist)
  };
}

function sourceDisplayLabel(value: string, uiLanguage: SignalUiLanguage) {
  const normalized = value.trim().toLowerCase();
  if (uiLanguage === "en") {
    if (normalized === "unknown") return "Unknown source";
    if (normalized === "comment" || normalized === "comentario") return "Comment";
  }
  return undefined;
}

function scoreMention(mention: CorpusMention, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return mention.isProtagonist ? 2 : 1;
  const haystack = `${mention.text} ${mention.findingId} ${mention.findingName} ${mention.platform}`.toLowerCase();
  const exactPhrases = Array.from(query.matchAll(/"([^"]+)"/g))
    .map((match) => match[1] ?? "")
    .filter(Boolean);
  const fieldBoosts = [
    { prefix: "finding:", value: mention.findingId },
    { prefix: "channel:", value: mention.platform },
    { prefix: "canal:", value: mention.platform },
    { prefix: "source:", value: mention.platform }
  ];
  let score = 0;

  for (const phrase of exactPhrases) {
    if (haystack.includes(phrase)) score += 8;
    else return 0;
  }

  const tokens = query
    .replace(/"[^"]+"/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const field = fieldBoosts.find((item) => token.startsWith(item.prefix));
    if (field) {
      const expected = token.slice(field.prefix.length);
      if (!field.value.toLowerCase().includes(expected)) return 0;
      score += 6;
      continue;
    }

    if (mention.findingId.toLowerCase().includes(token)) score += 5;
    if (mention.findingName.toLowerCase().includes(token)) score += 4;
    if (mention.platform.toLowerCase().includes(token)) score += 3;
    if (mention.text.toLowerCase().includes(token)) score += 2;
    if (!haystack.includes(token)) score -= 1;
  }

  if (mention.isProtagonist) score += 2;
  return score;
}

function summarizePlatforms(rows: CorpusMention[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.platform) continue;
    counts.set(row.platform, (counts.get(row.platform) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function getDateBounds(rows: CorpusMention[]) {
  const dates = rows.map((row) => row.publishedAt.slice(0, 10)).filter(Boolean).sort();
  return { min: dates[0] ?? "", max: dates[dates.length - 1] ?? "" };
}

function dateValue(value: string) {
  return value ? new Date(value).getTime() || 0 : 0;
}

function formatDate(value: string, uiLanguage: SignalUiLanguage) {
  return new Date(value).toLocaleDateString(uiLanguage === "en" ? "en-US" : "es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function findingAnchor(findingId: string) {
  return `finding-${findingId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function highlightText(text: string, query: string) {
  const tokens = query
    .replace(/"([^"]+)"/g, "$1")
    .split(/\s+/)
    .map((token) => token.replace(/^(finding|channel|canal|source):/i, "").trim())
    .filter((token) => token.length >= 3)
    .slice(0, 5);
  if (tokens.length === 0) return text;
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig");
  const parts = text.split(pattern);
  return parts.map((part, index) =>
    tokens.some((token) => part.toLowerCase() === token.toLowerCase())
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : part
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}
