import crypto from "node:crypto";

export type PerformanceFieldMapping = {
  external_id?: string;
  entity_kind?: string;
  entity_name?: string;
  parent_external_id?: string;
  platform?: string;
  channel?: string;
  objective?: string;
  record_date?: string;
  granularity?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  video_views?: string;
  engagement?: string;
  conversions?: string;
  ctr?: string;
  cpm?: string;
  cpc?: string;
  creative_text?: string;
  creative_asset_ref?: string;
};

export type NormalizedPerformanceRecord = {
  externalId: string;
  entityKind: string;
  entityName: string | null;
  parentExternalId: string | null;
  platform: string;
  channel: string;
  objective: string | null;
  recordDate: string;
  granularity: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  videoViews: number | null;
  engagement: number | null;
  conversions: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  creativeText: string | null;
  creativeAssetRef: string | null;
  metrics: Record<string, number>;
  rawMetadata: Record<string, unknown>;
};

export type PerformanceImportResult = {
  mapping: Required<PerformanceFieldMapping>;
  records: NormalizedPerformanceRecord[];
  preview: NormalizedPerformanceRecord[];
  stats: {
    records_total: number;
    records_valid: number;
    records_failed: number;
    duplicate_keys: number;
    coverage_start: string | null;
    coverage_end: string | null;
  };
  diagnostics: PerformanceImportDiagnostics;
  warnings: string[];
};

export type PerformanceImportDiagnostics = {
  format: "tabular" | "single_metric_timeseries";
  source_title: string | null;
  detected_metrics: string[];
  present_metrics: string[];
  missing_recommended_metrics: string[];
  coverage_days: number;
  coverage_months: number;
  messages: string[];
};

type ParseOptions = {
  mapping?: PerformanceFieldMapping;
  defaultPlatform?: string;
  defaultChannel?: string;
  defaultEntityName?: string;
  sourceFileName?: string;
};

type CsvRow = Record<string, string>;

type PreparedCsv = {
  rows: CsvRow[];
  header: string[];
  format: PerformanceImportDiagnostics["format"];
  sourceTitle: string | null;
  singleMetric: {
    metricKey: string;
    metricColumn: string;
  } | null;
};

const FIELD_CANDIDATES: Record<keyof PerformanceFieldMapping, string[]> = {
  external_id: ["external id", "external_id", "id", "campaign id", "campaign_id", "ad id", "ad_id", "post id", "post_id", "creative id"],
  entity_kind: ["entity kind", "entity_kind", "level", "object type", "record type", "type"],
  entity_name: ["entity name", "entity_name", "campaign name", "campaign_name", "ad name", "ad_name", "post name", "post_name", "creative name", "name"],
  parent_external_id: ["parent id", "parent_external_id", "campaign id", "adset id", "ad set id"],
  platform: ["platform", "publisher platform", "source", "network", "channel"],
  channel: ["channel", "paid organic", "paid/organic", "media type", "buy type"],
  objective: ["objective", "campaign objective", "optimization goal"],
  record_date: ["date", "day", "record date", "record_date", "start date", "reporting starts", "fecha"],
  granularity: ["granularity", "time increment"],
  spend: ["spend", "amount spent", "cost", "inversion", "inversión", "importe gastado"],
  impressions: ["impressions", "impresiones"],
  reach: ["reach", "alcance"],
  clicks: ["clicks", "link clicks", "clics", "clicks all"],
  video_views: ["video views", "views", "reproducciones", "thruplays"],
  engagement: ["engagement", "interactions", "post engagement", "engagements", "interacciones"],
  conversions: ["conversions", "results", "purchases", "leads"],
  ctr: ["ctr", "link ctr", "click through rate"],
  cpm: ["cpm", "cost per 1000 impressions"],
  cpc: ["cpc", "cost per click"],
  creative_text: ["creative text", "caption", "ad text", "body", "copy", "post text"],
  creative_asset_ref: ["creative asset", "asset url", "image url", "video url", "permalink", "url", "link"]
};

const SINGLE_VALUE_COLUMNS = new Set(["primary", "value", "valor", "total", "metric"]);
const RECOMMENDED_METRICS = ["spend", "impressions", "reach", "clicks", "engagement", "video_views", "conversions"];
const KNOWN_METRIC_FIELDS = new Set<keyof PerformanceFieldMapping>([
  "spend",
  "impressions",
  "reach",
  "clicks",
  "video_views",
  "engagement",
  "conversions",
  "ctr",
  "cpm",
  "cpc"
]);

const SOCIAL_METRIC_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "clicks", pattern: /\b(link\s*)?(clicks?|clics?)\b|clics?\s+en\s+el\s+enlace/i },
  { key: "engagement", pattern: /\b(interacciones?|interactions?|engagements?)\b/i },
  { key: "followers", pattern: /\b(seguidores?|followers?)\b/i },
  { key: "visits", pattern: /\b(visitas?|visits?)\b/i },
  { key: "video_views", pattern: /\b(visualizaciones?|views?|video\s+views?|reproducciones?|thruplays?)\b/i }
];

const REQUIRED_FALLBACK_MAPPING: Required<PerformanceFieldMapping> = {
  external_id: "",
  entity_kind: "",
  entity_name: "",
  parent_external_id: "",
  platform: "",
  channel: "",
  objective: "",
  record_date: "",
  granularity: "",
  spend: "",
  impressions: "",
  reach: "",
  clicks: "",
  video_views: "",
  engagement: "",
  conversions: "",
  ctr: "",
  cpm: "",
  cpc: "",
  creative_text: "",
  creative_asset_ref: ""
};

export function decodePerformanceCsvInput(input: string | ArrayBuffer | Uint8Array): string {
  if (typeof input === "string") return input;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return Buffer.from(bytes.subarray(2)).toString("utf16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1] ?? 0;
      swapped[index - 1] = bytes[index] ?? 0;
    }
    return Buffer.from(swapped).toString("utf16le");
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 400));
  const nulCount = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (nulCount > sample.length * 0.2) {
    return Buffer.from(bytes).toString("utf16le");
  }
  return Buffer.from(bytes).toString("utf8");
}

export function parsePerformanceCsv(input: string | ArrayBuffer | Uint8Array, options: ParseOptions = {}): PerformanceImportResult {
  const prepared = parseCsv(decodePerformanceCsvInput(input), options);
  const header = prepared.header;
  const proposed = proposePerformanceMapping(header);
  if (prepared.singleMetric && KNOWN_METRIC_FIELDS.has(prepared.singleMetric.metricKey as keyof PerformanceFieldMapping)) {
    proposed[prepared.singleMetric.metricKey as keyof PerformanceFieldMapping] = prepared.singleMetric.metricColumn;
  }
  const mapping = {
    ...REQUIRED_FALLBACK_MAPPING,
    ...proposed,
    ...(options.mapping ?? {})
  };
  const seen = new Set<string>();
  const records: NormalizedPerformanceRecord[] = [];
  let failed = 0;
  let duplicates = 0;
  const warnings = new Set<string>();

  for (const row of prepared.rows) {
    const normalized = normalizePerformanceRow(row, mapping, options, prepared);
    if (!normalized) {
      failed += 1;
      continue;
    }
    const grainKey = `${normalized.platform}:${normalized.externalId}:${normalized.recordDate}:${normalized.granularity}`;
    if (seen.has(grainKey)) {
      duplicates += 1;
      continue;
    }
    seen.add(grainKey);
    records.push(normalized);
  }

  if (!mapping.record_date) warnings.add("No se detecto columna de fecha.");
  if (!mapping.external_id && !mapping.entity_name) warnings.add("No se detecto ID ni nombre de campaña/asset; se generara ID estable.");
  if (records.length === 0) warnings.add("No hay filas validas para performance_records.");
  if (!records.some((row) => Object.values(row.metrics).some((value) => value !== null && value !== 0))) {
    warnings.add("No se detectaron metricas utiles de performance.");
  }
  if (prepared.singleMetric) {
    warnings.add(`Detecte una serie de metrica unica: ${prepared.singleMetric.metricKey}.`);
  }

  const dates = records.map((row) => row.recordDate).sort();
  const presentMetrics = Array.from(new Set(records.flatMap((row) => Object.keys(row.metrics)))).sort();
  const coverageDays = new Set(records.map((row) => row.recordDate)).size;
  const coverageMonths = new Set(records.map((row) => row.recordDate.slice(0, 7))).size;
  const missingRecommended = RECOMMENDED_METRICS.filter((metric) => !presentMetrics.includes(metric));
  return {
    mapping,
    records,
    preview: records.slice(0, 20),
    stats: {
      records_total: prepared.rows.length,
      records_valid: records.length,
      records_failed: failed,
      duplicate_keys: duplicates,
      coverage_start: dates[0] ?? null,
      coverage_end: dates.at(-1) ?? null
    },
    diagnostics: {
      format: prepared.format,
      source_title: prepared.sourceTitle,
      detected_metrics: prepared.singleMetric ? [prepared.singleMetric.metricKey] : presentMetrics,
      present_metrics: presentMetrics,
      missing_recommended_metrics: missingRecommended,
      coverage_days: coverageDays,
      coverage_months: coverageMonths,
      messages: buildDiagnosticsMessages(prepared, presentMetrics, missingRecommended, coverageDays, coverageMonths)
    },
    warnings: Array.from(warnings)
  };
}

export function proposePerformanceMapping(headers: string[]): Partial<Required<PerformanceFieldMapping>> {
  const normalizedHeaders = headers.map((header) => normalizeKey(header));
  const mapping: Partial<Required<PerformanceFieldMapping>> = {};
  for (const [field, candidates] of Object.entries(FIELD_CANDIDATES) as Array<[keyof PerformanceFieldMapping, string[]]>) {
    const normalizedCandidates = candidates.map(normalizeKey);
    const match = normalizedHeaders.find((header) => normalizedCandidates.includes(header));
    if (match) mapping[field] = match;
  }
  return mapping;
}

function normalizePerformanceRow(
  row: CsvRow,
  mapping: Required<PerformanceFieldMapping>,
  options: ParseOptions,
  prepared: PreparedCsv
): NormalizedPerformanceRecord | null {
  const recordDate = parseIsoDate(read(row, mapping.record_date));
  const entityName = read(row, mapping.entity_name) || (prepared.singleMetric ? options.defaultEntityName || "account" : null);
  const creativeText = read(row, mapping.creative_text) || null;
  const rawPlatform = normalizeToken(read(row, mapping.platform) || options.defaultPlatform || "unknown");
  const platform = prepared.singleMetric && rawPlatform === "file" ? "social" : rawPlatform;
  const channel = normalizeChannel(read(row, mapping.channel) || (prepared.singleMetric ? "organic" : options.defaultChannel || "paid"));
  const metrics: Record<string, number | null> = {
    spend: numberOrNull(read(row, mapping.spend)),
    impressions: integerOrNull(read(row, mapping.impressions)),
    reach: integerOrNull(read(row, mapping.reach)),
    clicks: integerOrNull(read(row, mapping.clicks)),
    video_views: integerOrNull(read(row, mapping.video_views)),
    engagement: integerOrNull(read(row, mapping.engagement)),
    conversions: numberOrNull(read(row, mapping.conversions)),
    ctr: percentOrNumber(read(row, mapping.ctr)),
    cpm: numberOrNull(read(row, mapping.cpm)),
    cpc: numberOrNull(read(row, mapping.cpc))
  };
  if (prepared.singleMetric) {
    const singleValue = numberOrNull(read(row, prepared.singleMetric.metricColumn));
    if (singleValue !== null) {
      metrics[prepared.singleMetric.metricKey] = singleValue;
    }
  }
  const hasMetric = prepared.singleMetric
    ? Object.values(metrics).some((value) => value !== null)
    : Object.values(metrics).some((value) => value !== null && value !== 0);
  if (!recordDate || !hasMetric) return null;

  const rawExternalId = read(row, mapping.external_id);
  const externalId = rawExternalId || stablePerformanceId({
    entityName,
    creativeText,
    recordDate,
    platform
  });

  return {
    externalId,
    entityKind: normalizeEntityKind(read(row, mapping.entity_kind), entityName, prepared.singleMetric ? "account" : undefined),
    entityName,
    parentExternalId: read(row, mapping.parent_external_id) || null,
    platform,
    channel,
    objective: read(row, mapping.objective) || null,
    recordDate,
    granularity: normalizeToken(read(row, mapping.granularity) || "day"),
    spend: knownMetric(metrics, "spend"),
    impressions: knownMetric(metrics, "impressions"),
    reach: knownMetric(metrics, "reach"),
    clicks: knownMetric(metrics, "clicks"),
    videoViews: knownMetric(metrics, "video_views"),
    engagement: knownMetric(metrics, "engagement"),
    conversions: knownMetric(metrics, "conversions"),
    ctr: knownMetric(metrics, "ctr"),
    cpm: knownMetric(metrics, "cpm"),
    cpc: knownMetric(metrics, "cpc"),
    creativeText,
    creativeAssetRef: read(row, mapping.creative_asset_ref) || null,
    metrics: Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== null)) as Record<string, number>,
    rawMetadata: {
      source_file_name: options.sourceFileName ?? null,
      source_title: prepared.sourceTitle,
      detected_format: prepared.format,
      detected_metric: prepared.singleMetric?.metricKey ?? null,
      row
    }
  };
}

function knownMetric(metrics: Record<string, number | null>, key: string) {
  return metrics[key] ?? null;
}

function parseCsv(input: string, options: ParseOptions): PreparedCsv {
  const { text, delimiter } = prepareCsvText(input);
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char ?? "";
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  const headerIndex = findHeaderRowIndex(rows);
  const titleRows = rows.slice(0, headerIndex)
    .map((cells) => cells.map((value) => value.trim()).filter(Boolean).join(" "))
    .filter(Boolean);
  const sourceTitle = titleRows.at(-1) ?? null;
  const rawHeader = rows[headerIndex] ?? [];
  const header = rawHeader.map(normalizeKey);
  const singleMetric = detectSingleMetric(header, sourceTitle, options.sourceFileName);
  const dataRows = rows.slice(headerIndex + 1);
  return {
    header,
    format: singleMetric ? "single_metric_timeseries" : "tabular",
    sourceTitle,
    singleMetric,
    rows: dataRows.map((cells) => header.reduce<CsvRow>((acc, key, index) => {
    acc[key || `column_${index + 1}`] = cells[index]?.trim() ?? "";
    return acc;
    }, {}))
  };
}

function prepareCsvText(input: string) {
  let text = input.replace(/^\uFEFF/, "").replace(/\0/g, "");
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (/^sep=./i.test(firstLine)) {
    const delimiter = firstLine.slice(4, 5) || ",";
    text = text.slice((text.match(/^.*(?:\r?\n|$)/)?.[0] ?? "").length);
    return { text, delimiter };
  }
  return { text, delimiter: detectDelimiter(text) };
}

function detectDelimiter(input: string) {
  const candidates = input.split(/\r?\n/).slice(0, 5).join("\n");
  return (candidates.match(/;/g) ?? []).length > (candidates.match(/,/g) ?? []).length ? ";" : ",";
}

function findHeaderRowIndex(rows: string[][]) {
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const normalized = rows[index]?.map(normalizeKey) ?? [];
    let score = 0;
    if (normalized.some((cell) => ["date", "day", "record date", "fecha"].includes(cell))) score += 4;
    if (normalized.some((cell) => SINGLE_VALUE_COLUMNS.has(cell))) score += 2;
    for (const candidates of Object.values(FIELD_CANDIDATES)) {
      const normalizedCandidates = candidates.map(normalizeKey);
      if (normalized.some((cell) => normalizedCandidates.includes(cell))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestScore >= 2 ? bestIndex : 0;
}

function detectSingleMetric(
  header: string[],
  sourceTitle: string | null,
  sourceFileName: string | undefined
) {
  const valueColumn = header.find((cell) => SINGLE_VALUE_COLUMNS.has(cell));
  const hasDate = header.some((cell) => ["date", "day", "record date", "fecha"].includes(cell));
  if (!valueColumn || !hasDate) return null;
  const label = [sourceTitle, sourceFileName].filter(Boolean).join(" ");
  const metricKey = inferSocialMetricKey(label);
  if (!metricKey) return null;
  return { metricKey, metricColumn: valueColumn };
}

function inferSocialMetricKey(label: string) {
  for (const candidate of SOCIAL_METRIC_PATTERNS) {
    if (candidate.pattern.test(label)) return candidate.key;
  }
  return null;
}

function buildDiagnosticsMessages(
  prepared: PreparedCsv,
  presentMetrics: string[],
  missingRecommended: string[],
  coverageDays: number,
  coverageMonths: number
) {
  const messages = [
    prepared.singleMetric
      ? `Tengo serie social de ${prepared.singleMetric.metricKey}.`
      : `Tengo CSV tabular con ${presentMetrics.length} metricas detectadas.`,
    `Tengo ${coverageDays} dias y ${coverageMonths} meses con performance estructurada.`
  ];
  if (missingRecommended.length > 0) {
    messages.push(`Faltan metricas recomendadas: ${missingRecommended.join(", ")}.`);
  }
  return messages;
}

function read(row: CsvRow, key: string) {
  return key ? row[normalizeKey(key)]?.trim() ?? "" : "";
}

function normalizeKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function normalizeChannel(value: string) {
  const token = normalizeToken(value);
  if (token.includes("organic") || token.includes("organico")) return "organic";
  if (token.includes("paid") || token.includes("pauta") || token.includes("ad")) return "paid";
  return token || "paid";
}

function normalizeEntityKind(value: string, entityName: string | null, fallback?: string) {
  const token = normalizeToken(value);
  if (["account", "campaign", "adset", "ad", "post", "creative"].includes(token)) return token;
  const name = (entityName ?? "").toLowerCase();
  if (name.includes("campaign") || name.includes("campana") || name.includes("campaña")) return "campaign";
  if (name.includes("adset") || name.includes("ad set")) return "adset";
  if (name.includes("ad ")) return "ad";
  if (name.includes("post") || name.includes("organic")) return "post";
  return token === "unknown" ? fallback ?? "campaign" : token;
}

function parseIsoDate(value: string) {
  if (!value) return null;
  const excelSerial = Number(value);
  if (Number.isFinite(excelSerial) && excelSerial > 20_000 && excelSerial < 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + excelSerial * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function numberOrNull(value: string) {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, "").replace(/%$/, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value: string) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
}

function percentOrNumber(value: string) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return value.trim().endsWith("%") ? number / 100 : number;
}

function stablePerformanceId(input: {
  entityName: string | null;
  creativeText: string | null;
  recordDate: string;
  platform: string;
}) {
  return `perf_${crypto
    .createHash("sha1")
    .update([input.platform, input.entityName, input.creativeText, input.recordDate].join("|"))
    .digest("hex")
    .slice(0, 24)}`;
}
