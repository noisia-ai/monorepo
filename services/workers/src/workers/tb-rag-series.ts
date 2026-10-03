export type TbRagSeriesRow = {
  month: string;
  metric_family: string;
  metric_key: string;
  metric_unit: string | null;
  metric_value: number | string;
  observations: number | string;
};

export type TbRagSeriesPoint = {
  month: string;
  metric_family: string;
  metric_key: string;
  metric_unit: string | null;
  value: number;
  observations: number;
  source: "data_observations" | "listening_data_os" | "listening_mentions_fallback";
};

export function selectTbRagMonthlySeries(args: {
  commercial: TbRagSeriesRow[];
  canonicalListening: TbRagSeriesRow[];
  rawListeningFallback: TbRagSeriesRow[];
}) {
  const canonicalMentionRows = args.canonicalListening.filter(
    (row) => row.metric_key === "mentions_monthly"
  );
  const useCanonicalListening = canonicalMentionRows.length > 0;
  const selectedListening = useCanonicalListening
    ? args.canonicalListening.map((row) => point(row, "listening_data_os"))
    : args.rawListeningFallback.map((row) => point(row, "listening_mentions_fallback"));
  const commercial = args.commercial.map((row) => point(row, "data_observations"));
  const monthlySeries = [...commercial, ...selectedListening].sort(
    (left, right) =>
      left.month.localeCompare(right.month)
      || left.metric_family.localeCompare(right.metric_family)
      || left.metric_key.localeCompare(right.metric_key)
  );
  const observationMonths = new Set(commercial.map((row) => row.month));
  const listeningMonths = new Set(
    selectedListening
      .filter((row) => row.metric_key === "mentions_monthly")
      .map((row) => row.month)
  );
  const overlappingMonths = Array.from(observationMonths).filter((month) =>
    listeningMonths.has(month)
  ).length;

  return {
    monthlySeries,
    listeningSource: useCanonicalListening
      ? "listening_data_os" as const
      : "listening_mentions_fallback" as const,
    observationMonths: observationMonths.size,
    listeningMonths: listeningMonths.size,
    overlappingMonths
  };
}

function point(
  row: TbRagSeriesRow,
  source: TbRagSeriesPoint["source"]
): TbRagSeriesPoint {
  return {
    month: row.month,
    metric_family: row.metric_family,
    metric_key: row.metric_key,
    metric_unit: row.metric_unit,
    value: numeric(row.metric_value),
    observations: numeric(row.observations),
    source
  };
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
