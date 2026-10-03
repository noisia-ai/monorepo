import {
  SIGNAL_MATERIALIZATION_MAX_CACHED_FILTERS_PER_RUN,
  signalFiltersHashV1,
  type SignalFilterV1
} from "@noisia/query-engine";

export function prioritizeSignalMaterializationFiltersV1(args: {
  home_filter: SignalFilterV1 | null;
  cached_filters: SignalFilterV1[];
  generated_filters: SignalFilterV1[];
  limit?: number;
}) {
  const fallback = args.cached_filters.length > 0
    ? args.cached_filters
    : args.generated_filters;
  const ordered = [
    ...(args.home_filter ? [args.home_filter] : []),
    ...fallback
  ];
  const unique = new Map(
    ordered.map((filter) => [signalFiltersHashV1(filter), filter])
  );
  return Array.from(unique.values()).slice(
    0,
    args.limit ?? SIGNAL_MATERIALIZATION_MAX_CACHED_FILTERS_PER_RUN
  );
}
