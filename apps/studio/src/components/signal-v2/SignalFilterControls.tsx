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

import { WorkspaceControlsPanel } from "@/components/workspace/WorkspaceShell";

import type { SignalAnalyticsFilterSelection } from "./SignalAnalyticsFilter";

export type SignalFilterFacetValue = { key: string; count: number | null };
type FacetPayload = {
  facets?: Partial<Record<string, SignalFilterFacetValue[]>>;
  message?: string;
};

export type SignalFilterDefinition = {
  dimension: string;
  filterKind?: "custom" | "signal";
  multiple?: boolean;
  translationKey?: string;
};

const CLIENT_FILTERS: SignalFilterDefinition[] = [
  { dimension: "platform", translationKey: "platform" },
  { dimension: "sentiment_polarity", translationKey: "sentiment" },
  { dimension: "content_format", translationKey: "contentFormat" },
  { dimension: "language", translationKey: "language" },
  { dimension: "country", translationKey: "country" },
  { dimension: "topic", translationKey: "topic" },
  { dimension: "entity", translationKey: "entity" },
  { dimension: "campaign", translationKey: "campaign" },
  { dimension: "conversation_role", translationKey: "conversationRole" },
  { dimension: "tb_polarity", translationKey: "tbPolarity" },
  { dimension: "tb_layer", translationKey: "tbLayer" },
  { dimension: "observed_signal", translationKey: "observedSignal" }
];

const FACET_CACHE_TTL_MS = 60_000;
const facetCache = new Map<string, { expiresAt: number; facets: FacetPayload["facets"] }>();
const EMPTY_CUSTOM_VALUES: Record<string, string[]> = {};

export function SignalFilterControls({
  bodyOpenClassName,
  comparison,
  definitions = CLIENT_FILTERS,
  dimensionLabels,
  facetsOverride,
  filter,
  customValues = EMPTY_CUSTOM_VALUES,
  formatValue = (_dimension, value) => prettyValue(value),
  loading,
  onApply,
  onClose,
  open,
  panelClassName = "signal-v2-controls",
  pickerClassName,
  portal = false,
  scrimClassName = "signal-v2-controls-scrim",
  showSearch = true,
  workspaceId
}: {
  bodyOpenClassName?: string;
  comparison: SignalComparisonV1;
  definitions?: readonly SignalFilterDefinition[];
  dimensionLabels?: Partial<Record<string, string>>;
  facetsOverride?: FacetPayload["facets"];
  filter: SignalFilterV1;
  customValues?: Record<string, string[]>;
  formatValue?: (dimension: string, value: string) => string;
  loading: boolean;
  onApply: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
  onClose: () => void;
  open: boolean;
  panelClassName?: string;
  pickerClassName?: string;
  portal?: boolean;
  scrimClassName?: string;
  showSearch?: boolean;
  workspaceId: string;
}) {
  const t = useTranslations("SignalV2");
  const pickerRef = useRef<HTMLDivElement>(null);
  const anchorRefs = useRef(new Map<string, HTMLButtonElement>());
  const [searchQuery, setSearchQuery] = useState(filter.search_query ?? "");
  const [dimensions, setDimensions] = useState<Record<string, string[]>>({
    ...filter.dimensions,
    ...customValues
  });
  const [facets, setFacets] = useState<FacetPayload["facets"]>({});
  const [facetsLoading, setFacetsLoading] = useState(false);
  const [facetError, setFacetError] = useState<string | null>(null);
  const [activeDimension, setActiveDimension] = useState<string | null>(null);
  const [facetSearch, setFacetSearch] = useState("");
  const [pickerStyle, setPickerStyle] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open) return;
    setSearchQuery(filter.search_query ?? "");
    setDimensions({ ...filter.dimensions, ...customValues });
    setActiveDimension(null);
    setFacetSearch("");
  }, [customValues, filter, open]);

  useEffect(() => {
    if (facetsOverride) setFacets(facetsOverride);
  }, [facetsOverride]);

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
    if (!open || facetsOverride) return;
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
        const cacheKey = `${workspaceId}:${params.toString()}`;
        const cached = facetCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          setFacets(cached.facets ?? {});
          setFacetsLoading(false);
          return;
        }
        timeout = window.setTimeout(() => controller.abort("timeout"), 12_000);
        const response = await fetch(
          `/api/data-os/signal/${workspaceId}/facets?${params.toString()}`,
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
    workspaceId,
    t,
    facetsOverride,
  ]);

  const availableGroups = useMemo(
    () => definitions.filter(({ dimension }) => (
      (facets?.[dimension]?.length ?? 0) > 0 || (dimensions[dimension]?.length ?? 0) > 0
    )),
    [definitions, dimensions, facets]
  );
  const activeFilterCount = useMemo(
    () => Object.values(dimensions).reduce((total, values) => total + (values?.length ?? 0), 0)
      + Number(showSearch && Boolean(searchQuery.trim())),
    [dimensions, searchQuery, showSearch]
  );
  const activeFacet = activeDimension
    ? definitions.find((item) => item.dimension === activeDimension) ?? null
    : null;
  const activeValues = activeDimension ? dimensions[activeDimension] ?? [] : [];
  const activeOptions = activeDimension
    ? mergeFacetValues(facets?.[activeDimension] ?? [], activeValues)
      .filter((item) => item.key.includes(facetSearch.trim().toLocaleLowerCase("en-US")))
    : [];

  const toggleValue = (dimension: string, value: string) => {
    setDimensions((current) => {
      const values = current[dimension] ?? [];
      const multiple = definitions.find((definition) => definition.dimension === dimension)?.multiple !== false;
      const nextValues = values.includes(value)
        ? values.filter((item) => item !== value)
        : multiple ? [...values, value].sort() : [value];
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
    const signalDimensions: SignalDimensionValuesV1 = {};
    const customFilters: Record<string, string[]> = {};
    for (const definition of definitions) {
      const values = dimensions[definition.dimension];
      if (!values?.length) continue;
      if (definition.filterKind === "custom") customFilters[definition.dimension] = values;
      else signalDimensions[definition.dimension as SignalDimensionV1] = values;
    }
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
      dimensions: signalDimensions,
      customFilters,
      searchQuery
    });
    if (applied) setActiveDimension(null);
  };

  if (!open) return null;

  return (
    <>
      <WorkspaceControlsPanel
        ariaLabel={t("filterControls.title")}
        closeLabel={t("filterControls.close")}
        count={activeFilterCount}
        footer={(
          <>
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
          </>
        )}
        icon={<SlidersHorizontal size={16} weight="bold" />}
        label={t("filterControls.filters")}
        onClose={onClose}
        bodyOpenClassName={bodyOpenClassName}
        panelClassName={panelClassName}
        portal={portal}
        scrimClassName={scrimClassName}
        tabIcon={<Funnel size={14} weight="fill" />}
        title={t("filterControls.title")}
      >
        {showSearch ? <section className="signal-v2-control-group">
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
        </section> : null}

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
                        <span>{dimensionLabel(group, dimensionLabels, t)}</span>
                        <CaretRight size={14} />
                      </span>
                      <span className="signal-v2-control-filter-row__values">
                        {selected.length > 0
                          ? selected.map((value) => (
                              <small key={value}>{formatValue(group.dimension, value)}</small>
                            ))
                          : <small className="is-any">{t("filterControls.any")}</small>}
                      </span>
                    </button>
                  </div>
                );
              })}
        </section>
      </WorkspaceControlsPanel>
      {activeDimension && activeFacet && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label={dimensionLabel(activeFacet, dimensionLabels, t)}
              className={`signal-v2-filter-picker${pickerClassName ? ` ${pickerClassName}` : ""}`}
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
                      <strong>{formatValue(activeDimension, option.key)}</strong>
                      {option.count == null ? <small /> : <small>{formatCount(option.count)}</small>}
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

function mergeFacetValues(options: SignalFilterFacetValue[], selected: string[]) {
  const byKey = new Map(options.map((item) => [item.key, item]));
  for (const value of selected) {
    if (!byKey.has(value)) byKey.set(value, { key: value, count: null });
  }
  return [...byKey.values()].sort((left, right) => (
    (right.count ?? -1) - (left.count ?? -1) || left.key.localeCompare(right.key)
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

function dimensionLabel(
  definition: SignalFilterDefinition,
  labels: Partial<Record<string, string>> | undefined,
  t: ReturnType<typeof useTranslations>
) {
  if (labels?.[definition.dimension]) return labels[definition.dimension];
  if (definition.translationKey) return t(`filterControls.dimensions.${definition.translationKey}`);
  return prettyValue(definition.dimension);
}
