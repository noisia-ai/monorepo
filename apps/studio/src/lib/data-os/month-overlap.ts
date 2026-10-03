export type DataOsMonthlySeriesPoint = {
  source: string;
  month: string;
};

export function getDataOsOverlappingMonths(
  series: readonly DataOsMonthlySeriesPoint[]
): string[] {
  const listeningMonths = new Set(
    series
      .filter((point) => point.source === "listening_mentions")
      .map((point) => point.month)
  );

  return Array.from(new Set(
    series
      .filter(
        (point) =>
          point.source === "data_observations" &&
          listeningMonths.has(point.month)
      )
      .map((point) => point.month)
  )).sort();
}
