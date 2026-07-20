"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useSignalDateRange, useSignalUiLanguage, type SignalUiLanguage } from "@/components/signal/SignalReportShell";
import { Icon } from "@/components/ui/Icon";
import { SourceToken } from "@/components/ui/SourceIcon";

type Mention = Record<string, unknown>;

type GovernedTag = {
  taxonomyKey: string;
  termKey: string;
  label: string;
};

type GovernedFeature = {
  key: string;
  value: unknown;
};

type CorpusMention = {
  mentionId: string;
  findingId: string;
  findingName: string;
  text: string;
  platform: string;
  publishedAt: string;
  isProtagonist: boolean;
  lensSlug: string;
  signalIntent: string;
  queryScope: string;
  entityId: string;
  canonicalSignalId: string;
  canonicalSignalTitle: string;
  evidenceRole: string;
  tags: GovernedTag[];
  features: GovernedFeature[];
};

type CorpusFacets = {
  platforms: Array<{ platform: string; count: number }>;
  findings: Array<{ finding_id: string; finding_name: string; count: number }>;
  lenses: Array<{ lens_slug: string; signal_intent: string; count: number }>;
  entities: Array<{ entity_id: string; entity_label: string; count: number }>;
  signals: Array<{ id: string; title: string; count: number }>;
  tags: Array<{ id: string; taxonomy_key: string; term_key: string; label: string; count: number }>;
  features: Array<{ feature_key: string; count: number }>;
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
    lens: "Lens",
    allLenses: "All lenses",
    intent: "Intent",
    allIntents: "All intents",
    entity: "Entity",
    allEntities: "All entities",
    signal: "Signal",
    allSignals: "All signals",
    taxonomy: "Taxonomy term",
    allTaxonomy: "All taxonomy terms",
    feature: "Feature",
    allFeatures: "All features",
    governedDimensions: "Governed dimensions",
    evidence: "Evidence",
    allEvidence: "All evidence",
    protagonistOnly: "Protagonist only",
    supportOnly: "Support only",
    counterOnly: "Counter only",
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
    localDateOverride: "Local date override",
    clearDateOverride: "Use global range",
    usingGlobalDate: "Using global range",
    protagonist: "protagonist",
    support: "support",
    counter: "counter",
    emptyTitle: "No verbatims match those filters.",
    emptyBody: "Remove channel, date or finding filters to widen the published sample.",
    page: "Page",
    previous: "Previous",
    next: "Next",
    filterSort: "Filter & Sort",
    relationalUnavailable: "The governed corpus could not be loaded. Embedded report samples are disabled for this output.",
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
    lens: "Lente",
    allLenses: "Todos los lentes",
    intent: "Intención",
    allIntents: "Todas las intenciones",
    entity: "Entidad",
    allEntities: "Todas las entidades",
    signal: "Señal",
    allSignals: "Todas las señales",
    taxonomy: "Término de taxonomía",
    allTaxonomy: "Todos los términos",
    feature: "Feature",
    allFeatures: "Todos los features",
    governedDimensions: "Dimensiones gobernadas",
    evidence: "Evidencia",
    allEvidence: "Toda la evidencia",
    protagonistOnly: "Sólo protagonista",
    supportOnly: "Sólo soporte",
    counterOnly: "Sólo contrapunto",
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
    localDateOverride: "Filtro local de fecha",
    clearDateOverride: "Usar rango global",
    usingGlobalDate: "Usando rango global",
    protagonist: "protagonista",
    support: "soporte",
    counter: "contrapunto",
    emptyTitle: "No hay verbatims con esos filtros.",
    emptyBody: "Prueba quitar canal, fecha o finding para ampliar la muestra publicada.",
    page: "Página",
    previous: "Anterior",
    next: "Siguiente",
    filterSort: "Filter & Sort",
    relationalUnavailable: "No se pudo cargar el corpus gobernado. Las muestras embebidas del reporte están desactivadas para este output.",
  },
} satisfies Record<SignalUiLanguage, Record<string, string>>;

const PAGE_SIZE = 120;

const pulseCorpusCopy = {
  en: {
    title: "Signal evidence explorer",
    searchAndFilters: "search signals, channels and evidence",
    findings: "Signals",
    finding: "Signal read",
    allFindings: "All reads",
    lens: "Query pack",
    allLenses: "Signal Pulse",
    intent: "Scope",
    allIntents: "All scopes",
    placeholder: 'Ex. "crunch ritual", tiktok, signal:snack',
    filtersAria: "Signal Pulse corpus filters",
    emptyBody: "Remove channel, date, signal or evidence filters to widen the authorized corpus.",
    completeCorpus: "This view queries the authorized Signal Pulse corpus.",
    publishedEvidence: "This view shows published Signal Pulse evidence."
  },
  es: {
    title: "Explorador de evidencia",
    searchAndFilters: "búsqueda por señales, canales y evidencia",
    findings: "Señales",
    finding: "Lectura",
    allFindings: "Todas las lecturas",
    lens: "Query pack",
    allLenses: "Signal Pulse",
    intent: "Scope",
    allIntents: "Todos los scopes",
    placeholder: 'Ej. "ritual crujiente", tiktok, señal:antojo',
    filtersAria: "Filtros del corpus de Signal Pulse",
    emptyBody: "Quita canal, fecha, señal o rol de evidencia para abrir el corpus autorizado.",
    completeCorpus: "Esta vista consulta el corpus autorizado de Signal Pulse.",
    publishedEvidence: "Esta vista muestra evidencia publicada de Signal Pulse."
  }
} satisfies Record<SignalUiLanguage, Partial<Record<keyof typeof corpusCopy.es, string>>>;

export function SignalCorpusExplorer({
  apiBasePath = "/api/signal",
  mentions,
  outputId,
  strictRelational = false,
  variant = "signal"
}: {
  apiBasePath?: "/api/signal" | "/api/pulse";
  mentions: Mention[];
  outputId?: string;
  strictRelational?: boolean;
  variant?: "signal" | "signal_pulse";
}) {
  const { uiLanguage } = useSignalUiLanguage();
  const { dateFrom: globalDateFrom, dateTo: globalDateTo } = useSignalDateRange();
  const copy = { ...corpusCopy[uiLanguage], ...(variant === "signal_pulse" ? pulseCorpusCopy[uiLanguage] : {}) };
  const isSignalPulse = variant === "signal_pulse";
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("");
  const [finding, setFinding] = useState("");
  const [lens, setLens] = useState("");
  const [signalIntent, setSignalIntent] = useState("");
  const [entity, setEntity] = useState("");
  const [signal, setSignal] = useState("");
  const [tag, setTag] = useState("");
  const [feature, setFeature] = useState("");
  const [localDateFrom, setLocalDateFrom] = useState("");
  const [localDateTo, setLocalDateTo] = useState("");
  const [evidenceRole, setEvidenceRole] = useState("");
  const [sort, setSort] = useState<"relevance" | "newest" | "oldest">("relevance");
  const [page, setPage] = useState(1);
  const [serverRows, setServerRows] = useState<CorpusMention[] | null>(null);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [serverFacets, setServerFacets] = useState<CorpusFacets | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState(strictRelational && !outputId);

  const fallbackRows = useMemo(
    () => strictRelational ? [] : mentions.map(normalizeMention).filter((mention) => mention.text),
    [mentions, strictRelational]
  );
  const rows = serverRows ?? fallbackRows;
  const dateFrom = localDateFrom || globalDateFrom;
  const dateTo = localDateTo || globalDateTo;

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, entity, evidenceRole, feature, finding, lens, platform, query, signal, signalIntent, sort, tag]);

  useEffect(() => {
    if (!outputId) {
      setServerError(strictRelational);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: query,
      platform,
      finding,
      lens,
      signalIntent,
      entity,
      signal,
      tag,
      feature,
      evidenceRole,
      dateFrom,
      dateTo,
      sort,
      page: String(page),
      limit: String(PAGE_SIZE)
    });
    setIsLoading(true);
    setServerError(false);
    fetch(`${apiBasePath}/${outputId}/corpus?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`Corpus request failed: ${res.status}`)))
      .then((payload) => {
        setServerRows(Array.isArray(payload.rows) ? payload.rows.map(normalizeMention).filter((mention: CorpusMention) => mention.text) : []);
        setServerTotal(Number(payload.total ?? 0));
        setServerFacets(normalizeFacets(payload.facets));
        setServerError(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setServerRows(strictRelational ? [] : null);
        setServerTotal(strictRelational ? 0 : null);
        setServerFacets(null);
        setServerError(true);
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [apiBasePath, dateFrom, dateTo, entity, evidenceRole, feature, finding, lens, outputId, page, platform, query, signal, signalIntent, sort, strictRelational, tag]);

  const platforms = useMemo(
    () => serverFacets?.platforms.map((item) => item.platform).filter(Boolean) ?? Array.from(new Set(rows.map((mention) => mention.platform).filter(Boolean))).sort(),
    [rows, serverFacets]
  );
  const findings = useMemo(
    () => serverFacets?.findings.map((item) => [item.finding_id, item.finding_name || item.finding_id] as [string, string]) ??
      Array.from(new Map(rows.filter((mention) => mention.findingId).map((mention) => [mention.findingId, mention.findingName || mention.findingId])).entries()),
    [rows, serverFacets]
  );
  const lenses = useMemo(
    () => Array.from(new Set((serverFacets?.lenses ?? rows.map((mention) => ({ lens_slug: mention.lensSlug }))).map((item) => item.lens_slug).filter((item) => item && item !== "unmapped"))).sort(),
    [rows, serverFacets]
  );
  const intents = useMemo(
    () => Array.from(new Set((serverFacets?.lenses ?? rows.map((mention) => ({ lens_slug: mention.lensSlug, signal_intent: mention.signalIntent })))
      .filter((item) => !lens || item.lens_slug === lens)
      .map((item) => item.signal_intent)
      .filter((item) => item && item !== "unmapped"))).sort(),
    [lens, rows, serverFacets]
  );
  const entities = useMemo(
    () => serverFacets?.entities.filter((item) => item.entity_id && item.entity_id !== "unknown") ?? [],
    [serverFacets]
  );
  const signals = useMemo(
    () => serverFacets?.signals.filter((item) => item.id && item.title) ?? [],
    [serverFacets]
  );
  const tags = useMemo(
    () => serverFacets?.tags.filter((item) => item.id && item.label) ?? [],
    [serverFacets]
  );
  const features = useMemo(
    () => serverFacets?.features.filter((item) => item.feature_key) ?? [],
    [serverFacets]
  );
  const scored = useMemo(() => {
    if (serverRows) {
      return rows
        .map((mention) => ({ mention, score: scoreMention(mention, query) }))
        .filter(({ mention }) => {
          if (evidenceRole === "protagonist" && !mention.isProtagonist) return false;
          if (evidenceRole === "support" && mention.evidenceRole === "counter") return false;
          if (evidenceRole === "support" && mention.isProtagonist) return false;
          if (evidenceRole === "counter" && mention.evidenceRole !== "counter") return false;
          return true;
        });
    }
    return rows
      .map((mention) => ({ mention, score: scoreMention(mention, query) }))
      .filter(({ mention, score }) => {
        if (query.trim() && score <= 0) return false;
        if (platform && mention.platform !== platform) return false;
        if (finding && mention.findingId !== finding) return false;
        if (lens && mention.lensSlug !== lens) return false;
        if (signalIntent && mention.signalIntent !== signalIntent) return false;
        if (entity && mention.entityId !== entity) return false;
        if (signal && mention.canonicalSignalId !== signal) return false;
        if (tag && !mention.tags.some((item) => item.termKey === tag || `${item.taxonomyKey}:${item.termKey}` === tag)) return false;
        if (feature && !mention.features.some((item) => item.key === feature)) return false;
        if (evidenceRole === "protagonist" && !mention.isProtagonist) return false;
        if (evidenceRole === "support" && mention.evidenceRole === "counter") return false;
        if (evidenceRole === "support" && mention.isProtagonist) return false;
        if (evidenceRole === "counter" && mention.evidenceRole !== "counter") return false;
        if (dateFrom && mention.publishedAt && mention.publishedAt.slice(0, 10) < dateFrom) return false;
        if (dateTo && mention.publishedAt && mention.publishedAt.slice(0, 10) > dateTo) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "newest") return dateValue(b.mention.publishedAt) - dateValue(a.mention.publishedAt);
        if (sort === "oldest") return dateValue(a.mention.publishedAt) - dateValue(b.mention.publishedAt);
        return b.score - a.score || Number(b.mention.isProtagonist) - Number(a.mention.isProtagonist) || dateValue(b.mention.publishedAt) - dateValue(a.mention.publishedAt);
      });
  }, [dateFrom, dateTo, entity, evidenceRole, feature, finding, lens, platform, query, rows, serverRows, signal, signalIntent, sort, tag]);

  const filtered = scored.map((item) => item.mention);
  const activeFilters = [query, platform, finding, lens, signalIntent, entity, signal, tag, feature, localDateFrom, localDateTo, evidenceRole].filter(Boolean).length;
  const topChannels = serverFacets
    ? serverFacets.platforms.slice(0, 6).map((item) => ({ platform: item.platform, count: item.count }))
    : summarizePlatforms(filtered);
  const totalRows = serverTotal ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  function resetFilters() {
    setQuery("");
    setPlatform("");
    setFinding("");
    setLens("");
    setSignalIntent("");
    setEntity("");
    setSignal("");
    setTag("");
    setFeature("");
    setLocalDateFrom("");
    setLocalDateTo("");
    setEvidenceRole("");
    setSort("relevance");
  }

  function setLocalFrom(value: string) {
    setLocalDateFrom(value);
    if (value && localDateTo && localDateTo < value) setLocalDateTo(value);
  }

  function setLocalTo(value: string) {
    setLocalDateTo(value);
    if (value && localDateFrom && localDateFrom > value) setLocalDateFrom(value);
  }

  function clearLocalDates() {
    setLocalDateFrom("");
    setLocalDateTo("");
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

      {serverError ? (
        <div className="signal-serving-warning" role="alert">
          <Icon name="alert" size={15} />
          <span>{copy.relationalUnavailable}</span>
        </div>
      ) : null}

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
        {!isSignalPulse ? (
          <SelectBox label={copy.finding} value={finding} onChange={setFinding}>
            <option value="">{copy.allFindings}</option>
            {findings.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </SelectBox>
        ) : null}
        {!isSignalPulse ? (
          <SelectBox label={copy.lens} value={lens} onChange={setLens}>
            <option value="">{copy.allLenses}</option>
            {lenses.map((item) => <option key={item} value={item}>{prettifyKey(item)}</option>)}
          </SelectBox>
        ) : null}
        {!isSignalPulse ? (
          <SelectBox label={copy.intent} value={signalIntent} onChange={setSignalIntent}>
            <option value="">{copy.allIntents}</option>
            {intents.map((item) => <option key={item} value={item}>{prettifyKey(item)}</option>)}
          </SelectBox>
        ) : null}
        <SelectBox label={copy.entity} value={entity} onChange={setEntity}>
          <option value="">{copy.allEntities}</option>
          {entities.map((item) => <option key={item.entity_id} value={item.entity_id}>{item.entity_label || item.entity_id}</option>)}
        </SelectBox>
        <SelectBox label={copy.signal} value={signal} onChange={setSignal}>
          <option value="">{copy.allSignals}</option>
          {signals.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </SelectBox>
        {!isSignalPulse ? (
          <SelectBox label={copy.taxonomy} value={tag} onChange={setTag}>
            <option value="">{copy.allTaxonomy}</option>
            {tags.map((item) => (
              <option key={`${item.taxonomy_key}:${item.id}`} value={item.id}>
                {prettifyKey(item.taxonomy_key)} · {item.label} ({item.count})
              </option>
            ))}
          </SelectBox>
        ) : null}
        {!isSignalPulse ? (
          <SelectBox label={copy.feature} value={feature} onChange={setFeature}>
            <option value="">{copy.allFeatures}</option>
            {features.map((item) => (
              <option key={item.feature_key} value={item.feature_key}>
                {prettifyKey(item.feature_key)} ({item.count})
              </option>
            ))}
          </SelectBox>
        ) : null}
        <SelectBox label={copy.evidence} value={evidenceRole} onChange={setEvidenceRole}>
          <option value="">{copy.allEvidence}</option>
          <option value="protagonist">{copy.protagonistOnly}</option>
          <option value="support">{copy.supportOnly}</option>
          {isSignalPulse ? <option value="counter">{copy.counterOnly}</option> : null}
        </SelectBox>
        <SelectBox label={copy.order} value={sort} onChange={(value) => setSort(value as typeof sort)}>
          <option value="relevance">{copy.relevance}</option>
          <option value="newest">{copy.newest}</option>
          <option value="oldest">{copy.oldest}</option>
        </SelectBox>
        <label className="signal-corpus-date">
          <span>{copy.from}</span>
          <input
            onChange={(event) => setLocalFrom(event.target.value)}
            onInput={(event) => setLocalFrom(event.currentTarget.value)}
            placeholder={globalDateFrom}
            title={copy.localDateOverride}
            type="date"
            value={localDateFrom}
          />
        </label>
        <label className="signal-corpus-date">
          <span>{copy.to}</span>
          <input
            onChange={(event) => setLocalTo(event.target.value)}
            onInput={(event) => setLocalTo(event.currentTarget.value)}
            placeholder={globalDateTo}
            title={copy.localDateOverride}
            type="date"
            value={localDateTo}
          />
        </label>
        <div className="signal-corpus-date-status">
          <span>
            {localDateFrom || localDateTo
              ? `${localDateFrom || globalDateFrom || "all"} -> ${localDateTo || globalDateTo || "all"}`
              : `${copy.usingGlobalDate}: ${globalDateFrom || "all"} -> ${globalDateTo || "all"}`}
          </span>
          <button disabled={!localDateFrom && !localDateTo} onClick={clearLocalDates} type="button">
            {copy.clearDateOverride}
          </button>
        </div>
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
            <article className={mention.isProtagonist ? "signal-corpus-card signal-corpus-card--protagonist" : "signal-corpus-card"} key={corpusMentionKey(mention, index)}>
              <header>
                <SourceToken compact label={sourceDisplayLabel(mention.platform || "unknown", uiLanguage)} value={mention.platform || "unknown"} />
                {mention.isProtagonist ? <strong><Icon name="star" size={11} /> {copy.protagonist}</strong> : <span>{labelEvidenceRole(mention.evidenceRole, copy)}</span>}
                {mention.publishedAt ? <time>{formatDate(mention.publishedAt, uiLanguage)}</time> : null}
              </header>
              <p>{highlightText(mention.text, query)}</p>
              {mention.findingName || mention.canonicalSignalTitle ? (
                <footer>
                  {mention.findingName ? <a href={`#${findingAnchor(mention.findingId)}`}>{mention.findingId} · {mention.findingName}</a> : null}
                  {mention.canonicalSignalTitle ? <span>{mention.canonicalSignalTitle}</span> : null}
                </footer>
              ) : null}
              {!isSignalPulse && (mention.tags.length > 0 || mention.features.length > 0) ? (
                <div className="signal-corpus-governed-dimensions" title={copy.governedDimensions}>
                  <Icon name="layers" size={12} />
                  <span>{formatGovernedDimensions(mention)}</span>
                </div>
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

function corpusMentionKey(mention: CorpusMention, index: number) {
  return [
    mention.mentionId || "mention",
    mention.findingId || mention.canonicalSignalId || "signal",
    mention.evidenceRole || "role",
    index
  ].join(":");
}

function normalizeMention(mention: Mention): CorpusMention {
  return {
    mentionId: stringValue(firstValue(mention, "mentionId", "mention_id")),
    findingId: stringValue(firstValue(mention, "findingId", "finding_id")),
    findingName: stringValue(firstValue(mention, "findingName", "finding_name")),
    text: stringValue(firstValue(mention, "text", "text_clean", "text_raw")),
    platform: stringValue(firstValue(mention, "platform")),
    publishedAt: stringValue(firstValue(mention, "publishedAt", "published_at")),
    isProtagonist: Boolean(firstValue(mention, "isProtagonist", "is_protagonist")),
    lensSlug: stringValue(firstValue(mention, "lensSlug", "lens_slug")),
    signalIntent: stringValue(firstValue(mention, "signalIntent", "signal_intent")),
    queryScope: stringValue(firstValue(mention, "queryScope", "query_scope")),
    entityId: stringValue(firstValue(mention, "entityId", "source_entity_id")),
    canonicalSignalId: stringValue(firstValue(mention, "canonicalSignalId", "canonical_signal_id")),
    canonicalSignalTitle: stringValue(firstValue(mention, "canonicalSignalTitle", "canonical_signal_title")),
    evidenceRole: stringValue(firstValue(mention, "evidenceRole", "evidence_role")),
    tags: arrayValue(firstValue(mention, "tags")).map((item) => ({
      taxonomyKey: stringValue(firstValue(item, "taxonomyKey", "taxonomy_key")),
      termKey: stringValue(firstValue(item, "termKey", "term_key")),
      label: stringValue(firstValue(item, "label", "value"))
    })),
    features: arrayValue(firstValue(mention, "features")).map((item) => ({
      key: stringValue(firstValue(item, "key", "feature_key")),
      value: firstValue(item, "value", "feature_value")
    }))
  };
}

function labelEvidenceRole(value: string, copy: Record<string, string>) {
  if (value === "counter") return copy.counter;
  if (value === "protagonist") return copy.protagonist;
  return copy.support;
}

function normalizeFacets(input: unknown): CorpusFacets {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    platforms: arrayValue(value.platforms).map((item) => ({
      platform: stringValue(item.platform),
      count: numberValue(item.count)
    })),
    findings: arrayValue(value.findings).map((item) => ({
      finding_id: stringValue(item.finding_id),
      finding_name: stringValue(item.finding_name),
      count: numberValue(item.count)
    })),
    lenses: arrayValue(value.lenses).map((item) => ({
      lens_slug: stringValue(item.lens_slug),
      signal_intent: stringValue(item.signal_intent),
      count: numberValue(item.count)
    })),
    entities: arrayValue(value.entities).map((item) => ({
      entity_id: stringValue(item.entity_id),
      entity_label: stringValue(item.entity_label),
      count: numberValue(item.count)
    })),
    signals: arrayValue(value.signals).map((item) => ({
      id: stringValue(item.id),
      title: stringValue(item.title),
      count: numberValue(item.count)
    })),
    tags: arrayValue(value.tags).map((item) => ({
      id: stringValue(item.id),
      taxonomy_key: stringValue(item.taxonomy_key),
      term_key: stringValue(item.term_key),
      label: stringValue(item.label),
      count: numberValue(item.count)
    })),
    features: arrayValue(value.features).map((item) => ({
      feature_key: stringValue(item.feature_key),
      count: numberValue(item.count)
    }))
  };
}

function formatGovernedDimensions(mention: CorpusMention) {
  const tags = mention.tags
    .map((item) => item.label || item.termKey)
    .filter(Boolean)
    .slice(0, 3);
  const features = mention.features
    .map((item) => item.key)
    .filter(Boolean)
    .slice(0, 2);
  const values = [...tags, ...features.map((item) => prettifyKey(item))];
  const remaining = mention.tags.length + mention.features.length - values.length;
  return `${values.join(" · ")}${remaining > 0 ? ` · +${remaining}` : ""}`;
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

function prettifyKey(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function firstValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
