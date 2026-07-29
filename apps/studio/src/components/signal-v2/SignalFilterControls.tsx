"use client";

import {
  ArrowRight,
  CaretRight,
  Check,
  Funnel,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  X
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

import type {
  SignalComparisonV1,
  SignalDimensionV1,
  SignalDimensionValuesV1,
  SignalFilterV1
} from "@noisia/query-engine";

import type { SignalAnalyticsFilterSelection } from "./SignalAnalyticsFilter";

type FacetValue = { key: string; count: number };
type FacetPayload = {
  facets?: Partial<Record<SignalDimensionV1, FacetValue[]>>;
  message?: string;
};

const CLIENT_FILTERS: Array<{
  dimension: SignalDimensionV1;
  translationKey: string;
}> = [
  { dimension: "platform", translationKey: "platform" },
  { dimension: "sentiment_polarity", translationKey: "sentiment" },
  { dimension: "content_format", translationKey: "contentFormat" },
  { dimension: "language", translationKey: "language" },
  { dimension: "country", translationKey: "country" },
  { dimension: "topic", translationKey: "topic" },
  { dimension: "entity", translationKey: "entity" },
  { dimension: "campaign", translationKey: "campaign" },
  { dimension: "corpus_scope", translationKey: "corpusScope" },
  { dimension: "conversation_role", translationKey: "conversationRole" },
  { dimension: "tb_polarity", translationKey: "tbPolarity" },
  { dimension: "tb_layer", translationKey: "tbLayer" },
  { dimension: "observed_signal", translationKey: "observedSignal" }
];

const FACET_CACHE_TTL_MS = 60_000;
const facetCache = new Map<string, { expiresAt: number; facets: FacetPayload["facets"] }>();

export function SignalFilterControls({
  comparison,
  filter,
  loading,
  onApply,
  onClose,
  open,
  outputId
}: {
  comparison: SignalComparisonV1;
  filter: SignalFilterV1;
  loading: boolean;
  onApply: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
  onClose: () => void;
  open: boolean;
  outputId: string | null;
}) {
  const t = useTranslations("SignalV2");
  const pickerRef = useRef<HTMLDivElement>(null);
  const anchorRefs = useRef(new Map<SignalDimensionV1, HTMLButtonElement>());
  const [searchQuery, setSearchQuery] = useState(filter.search_query ?? "");
  const [dimensions, setDimensions] = useState<SignalDimensionValuesV1>(filter.dimensions);
  const [facets, setFacets] = useState<FacetPayload["facets"]>({});
  const [facetsLoading, setFacetsLoading] = useState(false);
  const [facetError, setFacetError] = useState<string | null>(null);
  const [activeDimension, setActiveDimension] = useState<SignalDimensionV1 | null>(null);
  const [facetSearch, setFacetSearch] = useState("");
  const [pickerStyle, setPickerStyle] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open) return;
    setSearchQuery(filter.search_query ?? "");
    setDimensions(filter.dimensions);
    setActiveDimension(null);
    setFacetSearch("");
  }, [filter, open]);

  useEffect(() => {
    if (!activeDimension) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        pickerRef.current?.contains(target)
        || anchorRefs.current.get(activeDimension)?.contains(target)
      ) return;
      setActiveDimension(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [activeDimension]);

  useLayoutEffect(() => {
    if (!activeDimension) return;
    const updatePosition = () => {
      const anchor = anchorRefs.current.get(activeDimension);
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPickerStyle({
        left: rect.left,
        top: rect.bottom + 4,
        width: rect.width,
        maxHeight: Math.max(176, window.innerHeight - rect.bottom - 16)
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [activeDimension]);

  useEffect(() => {
    if (!open) return;
    if (!outputId) {
      setFacetError(t("filterControls.facetsError"));
      setFacets({});
      return;
    }
    const controller = new AbortController();
    const loadFacets = async () => {
      setFacetsLoading(true);
      setFacetError(null);
      let timeout: number | null = null;
      try {
        const params = new URLSearchParams({
          start: filter.date_range.start,
          end: filter.date_range.end,
          timezone: filter.timezone,
          granularity: filter.granularity
        });
        if (filter.search_query) params.set("q", filter.search_query);
        const cacheKey = `${outputId}:${params.toString()}`;
        const cached = facetCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          setFacets(cached.facets ?? {});
          setFacetsLoading(false);
          return;
        }
        timeout = window.setTimeout(() => controller.abort("timeout"), 12_000);
        const response = await fetch(
          `/api/signal-v2/${outputId}/facets?${params.toString()}`,
          { cache: "no-store", signal: controller.signal }
        );
        const payload = await response.json() as FacetPayload;
        if (!response.ok) throw new Error(payload.message ?? t("filterControls.facetsError"));
        facetCache.set(cacheKey, {
          expiresAt: Date.now() + FACET_CACHE_TTL_MS,
          facets: payload.facets ?? {}
        });
        if (facetCache.size > 30) {
          const oldestKey = facetCache.keys().next().value as string | undefined;
          if (oldestKey) facetCache.delete(oldestKey);
        }
        setFacets(payload.facets ?? {});
      } catch (error) {
        if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
        setFacetError(error instanceof Error ? error.message : t("filterControls.facetsError"));
      } finally {
        if (timeout != null) window.clearTimeout(timeout);
        if (!controller.signal.aborted) setFacetsLoading(false);
        else if (controller.signal.reason === "timeout") setFacetsLoading(false);
      }
    };
    void loadFacets();
    return () => controller.abort();
  }, [
    filter.date_range.end,
    filter.date_range.start,
    filter.granularity,
    filter.search_query,
    filter.timezone,
    open,
    outputId,
    t,
  ]);

  const availableGroups = useMemo(
    () => CLIENT_FILTERS.filter(({ dimension }) => (
      (facets?.[dimension]?.length ?? 0) > 0 || (dimensions[dimension]?.length ?? 0) > 0
    )),
    [dimensions, facets]
  );
  const activeFilterCount = useMemo(
    () => Object.values(dimensions).reduce((total, values) => total + (values?.length ?? 0), 0)
      + Number(Boolean(searchQuery.trim())),
    [dimensions, searchQuery]
  );
  const activeFacet = activeDimension
    ? CLIENT_FILTERS.find((item) => item.dimension === activeDimension) ?? null
    : null;
  const activeValues = activeDimension ? dimensions[activeDimension] ?? [] : [];
  const activeOptions = activeDimension
    ? mergeFacetValues(facets?.[activeDimension] ?? [], activeValues)
      .filter((item) => item.key.includes(facetSearch.trim().toLocaleLowerCase("en-US")))
    : [];

  const toggleValue = (dimension: SignalDimensionV1, value: string) => {
    setDimensions((current) => {
      const values = current[dimension] ?? [];
      const nextValues = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value].sort();
      const next = { ...current };
      if (nextValues.length > 0) next[dimension] = nextValues;
      else delete next[dimension];
      return next;
    });
  };

  const reset = () => {
    setSearchQuery("");
    setDimensions({});
    setActiveDimension(null);
    setFacetSearch("");
  };

  const apply = async () => {
    const applied = await onApply({
      start: filter.date_range.start,
      end: filter.date_range.end,
      comparisonMode: comparison.mode,
      ...(comparison.mode === "custom" && comparison.date_range
        ? {
            comparisonStart: comparison.date_range.start,
            comparisonEnd: comparison.date_range.end
          }
        : {}),
      dimensions,
      searchQuery
    });
    if (applied) setActiveDimension(null);
  };

  if (!open) return null;

  return (
    <>
      <button
        aria-label={t("filterControls.close")}
        className="signal-v2-controls-scrim"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={t("filterControls.title")}
        className="signal-v2-controls"
      >
        <header className="signal-v2-controls__header">
          <div>
            <SlidersHorizontal size={16} weight="bold" />
            <strong>{t("filterControls.title")}</strong>
          </div>
          <button aria-label={t("filterControls.close")} onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        <div className="signal-v2-controls__editor">
          <div className="signal-v2-controls__tabs" role="tablist">
            <button aria-selected="true" role="tab" type="button">
              <Funnel size={14} weight="fill" />
              {t("filterControls.filters")}
            </button>
            <span>{activeFilterCount || null}</span>
          </div>

          <div className="signal-v2-controls__body">
            <section className="signal-v2-control-group">
              <header>
                <span>{t("filterControls.search")}</span>
              </header>
              <label className="signal-v2-control-search">
                <MagnifyingGlass size={15} />
                <input
                  maxLength={160}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("filterControls.searchPlaceholder")}
                  value={searchQuery}
                />
                {searchQuery ? (
                  <button
                    aria-label={t("filterControls.clearSearch")}
                    onClick={() => setSearchQuery("")}
                    type="button"
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </label>
            </section>

            <section className="signal-v2-control-group">
              <header>
                <span>{t("filterControls.filters")}</span>
                <button
                  aria-label={t("filterControls.addFilter")}
                  disabled={availableGroups.length === 0}
                  onClick={() => {
                    setActiveDimension(availableGroups[0]?.dimension ?? null);
                    setFacetSearch("");
                  }}
                  type="button"
                >
                  <Plus size={15} />
                </button>
              </header>
              {facetsLoading ? (
                <div aria-label={t("filterControls.loading")} className="signal-v2-control-loading">
                  <span /><span /><span />
                </div>
              ) : null}
              {facetError ? <p className="signal-v2-control-error">{facetError}</p> : null}
              {!facetsLoading && !facetError && availableGroups.length === 0 ? (
                <p>{t("filterControls.noFacets")}</p>
              ) : null}
              {availableGroups.map((group) => {
                const selected = dimensions[group.dimension] ?? [];
                const pickerOpen = activeDimension === group.dimension;
                return (
                  <div
                    className={`signal-v2-control-filter${pickerOpen ? " is-open" : ""}`}
                    data-filter-dimension={group.dimension}
                    key={group.dimension}
                  >
                    <button
                      aria-expanded={pickerOpen}
                      aria-haspopup="dialog"
                      className="signal-v2-control-filter-row"
                      onClick={() => {
                        setActiveDimension((current) => (
                          current === group.dimension ? null : group.dimension
                        ));
                        setFacetSearch("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape" || !pickerOpen) return;
                        event.stopPropagation();
                        setActiveDimension(null);
                      }}
                      ref={(node) => {
                        if (node) anchorRefs.current.set(group.dimension, node);
                        else anchorRefs.current.delete(group.dimension);
                      }}
                      type="button"
                    >
                      <span className="signal-v2-control-filter-row__header">
                        <span>{t(`filterControls.dimensions.${group.translationKey}`)}</span>
                        <CaretRight size={14} />
                      </span>
                      <span className="signal-v2-control-filter-row__values">
                        {selected.length > 0
                          ? selected.map((value) => (
                              <small key={value}>{prettyValue(value)}</small>
                            ))
                          : <small className="is-any">{t("filterControls.any")}</small>}
                      </span>
                    </button>
                  </div>
                );
              })}
            </section>
          </div>

          <footer className="signal-v2-controls__footer">
            <div>
              <strong>{t("filterControls.summary", { count: activeFilterCount })}</strong>
              <button disabled={activeFilterCount === 0 || loading} onClick={reset} type="button">
                {t("filterControls.clearAll")}
              </button>
            </div>
            <button disabled={loading} onClick={apply} type="button">
              {loading ? t("actions.loading") : t("filterControls.apply")}
              <ArrowRight size={13} />
            </button>
          </footer>
        </div>

      </aside>
      {activeDimension && activeFacet && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label={t(`filterControls.dimensions.${activeFacet.translationKey}`)}
              className="signal-v2-filter-picker"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setActiveDimension(null);
                anchorRefs.current.get(activeDimension)?.focus();
              }}
              ref={pickerRef}
              role="dialog"
              style={pickerStyle}
            >
              <label className="signal-v2-filter-picker__search">
                <MagnifyingGlass size={15} />
                <input
                  onChange={(event) => setFacetSearch(event.target.value)}
                  placeholder={t("filterControls.findValue")}
                  value={facetSearch}
                />
              </label>
              <div className="signal-v2-filter-picker__options">
                {activeOptions.map((option) => {
                  const selected = activeValues.includes(option.key);
                  return (
                    <button
                      aria-pressed={selected}
                      key={option.key}
                      onClick={() => toggleValue(activeDimension, option.key)}
                      type="button"
                    >
                      <strong>{prettyValue(option.key)}</strong>
                      <small>{formatCount(option.count)}</small>
                      <span>{selected ? <Check size={14} weight="bold" /> : null}</span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function mergeFacetValues(options: FacetValue[], selected: string[]) {
  const byKey = new Map(options.map((item) => [item.key, item]));
  for (const value of selected) {
    if (!byKey.has(value)) byKey.set(value, { key: value, count: 0 });
  }
  return [...byKey.values()].sort((left, right) => (
    right.count - left.count || left.key.localeCompare(right.key)
  ));
}

function prettyValue(value: string) {
  const normalized = value
    .replaceAll("_", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("es-MX");
  const knownNames: Record<string, string> = {
    facebook: "Facebook",
    google: "Google",
    instagram: "Instagram",
    tiktok: "TikTok",
    x: "X",
    youtube: "YouTube"
  };
  if (knownNames[normalized]) return knownNames[normalized];
  return normalized
    ? `${normalized.charAt(0).toLocaleUpperCase("es-MX")}${normalized.slice(1)}`
    : normalized;
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
    .format(value);
}
