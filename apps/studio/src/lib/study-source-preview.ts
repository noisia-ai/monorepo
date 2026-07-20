import * as XLSX from "xlsx";

import { STUDY_SOURCE_SNAPSHOT_MAX_CHARS, compactPreserveLines } from "@/lib/study-intake-context";

export type StudySourcePreview = {
  name: string;
  kind: string;
  mime_type: string;
  size_bytes: number;
  status: "ready" | "error";
  summary: string;
  text: string;
  dataset_inventory: string[];
  sheet_count: number;
  row_count: number;
  field_names: string[];
  source_profile?: StudySourceProfile;
  error?: string;
};

export type StudySourceProfile = {
  version: 1;
  source_kind: string;
  provider_hint: string;
  canonical_status: "profiled" | "needs_mapping_review" | "unstructured";
  datasets: StudyDatasetProfile[];
  source_metrics: StudyMetricProfile[];
  source_dimensions: StudyDimensionProfile[];
  source_time_axes: StudyTimeAxisProfile[];
  source_join_keys: StudyJoinKeyProfile[];
  chart_readiness: {
    time_series: boolean;
    metric_count: number;
    time_axis_count: number;
    compatible_grains: string[];
  };
  materialization_policy: "profile_now_materialize_later";
};

export type StudyDatasetProfile = {
  key: string;
  name: string;
  semantic_role: string;
  row_count: number;
  column_count: number;
  inferred_grain: string | null;
  fields: StudyFieldProfile[];
  metric_fields: string[];
  dimension_fields: string[];
  time_fields: string[];
  join_keys: string[];
  sample_records: Record<string, string>[];
};

export type StudyFieldProfile = {
  name: string;
  normalized_name: string;
  field_type: "date" | "period" | "number" | "identifier" | "text";
  semantic_type: "time" | "metric" | "dimension" | "entity_key" | "attribute";
  metric_role?: string;
  dimension_role?: string;
  examples: string[];
  confidence: "low" | "medium" | "high";
};

export type StudyMetricProfile = {
  dataset_key: string;
  field: string;
  metric_key: string;
  metric_family: string;
  aggregation: "sum" | "avg" | "count" | "latest";
  unit: "currency" | "ratio" | "count" | "unknown";
};

export type StudyDimensionProfile = {
  dataset_key: string;
  field: string;
  dimension_key: string;
  dimension_family: string;
};

export type StudyTimeAxisProfile = {
  dataset_key: string;
  fields: string[];
  grain: "day" | "week" | "month" | "year" | "unknown";
  canonical_period_key: string | null;
};

export type StudyJoinKeyProfile = {
  dataset_key: string;
  field: string;
  entity: "product" | "campaign" | "customer" | "brand" | "market" | "unknown";
};

type BuildPreviewArgs = {
  name: string;
  kind: string;
  mimeType?: string;
  sizeBytes: number;
  buffer: Uint8Array;
};

export function buildStudySourcePreviewFromBuffer(args: BuildPreviewArgs): StudySourcePreview {
  try {
    if (isSpreadsheet(args.name, args.mimeType)) {
      return buildSpreadsheetPreview(args);
    }
    return buildTextPreview(args);
  } catch (error) {
    return {
      name: args.name,
      kind: args.kind,
      mime_type: args.mimeType ?? "",
      size_bytes: args.sizeBytes,
      status: "error",
      summary: "",
      text: "",
      dataset_inventory: [],
      sheet_count: 0,
      row_count: 0,
      field_names: [],
      error: error instanceof Error ? error.message : "No se pudo perfilar la fuente."
    };
  }
}

function buildSpreadsheetPreview(args: BuildPreviewArgs): StudySourcePreview {
  const workbook = XLSX.read(args.buffer, {
    type: "array",
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false
  });
  const sheets = workbook.SheetNames.slice(0, 12).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return profileSheet(sheetName, []);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    });
    return profileSheet(sheetName, rows);
  });
  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.dataRows, 0);
  const fieldNames = uniqueInOrder(sheets.flatMap((sheet) => sheet.headers)).slice(0, 80);
  const sourceProfile = buildSourceProfile(args, sheets);
  const datasetInventory = sheets.map((sheet) => {
    const fields = sheet.headers.slice(0, 10).join(", ") || "sin headers detectados";
    const role = sourceProfile.datasets.find((dataset) => dataset.name === sheet.name)?.semantic_role ?? "unknown";
    return `${sheet.name}: ${sheet.dataRows} filas, ${sheet.columnCount} columnas, rol ${role} (${fields})`;
  });
  const summary = `${args.name} contiene ${sheets.length} hojas y ${totalRows} filas perfiladas. Campos clave: ${fieldNames.slice(0, 14).join(", ") || "sin campos detectados"}.`;
  const samples = sheets
    .map((sheet) => {
      const sampleRows = sheet.samples
        .map((sample, index) => `  ${index + 1}. ${sample}`)
        .join("\n");
      return [
        `Hoja: ${sheet.name}`,
        `Filas: ${sheet.dataRows}. Columnas: ${sheet.columnCount}.`,
        `Headers: ${sheet.headers.slice(0, 18).join(", ") || "sin headers detectados"}.`,
        sampleRows ? `Muestras:\n${sampleRows}` : ""
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const text = compactPreserveLines([
    `Fuente estructurada: ${args.name}`,
    `Tipo declarado: ${args.kind}`,
    "Inventario de datasets:",
    ...datasetInventory.map((item) => `- ${item}`),
    "",
    samples
  ].join("\n"), STUDY_SOURCE_SNAPSHOT_MAX_CHARS);

  return {
    name: args.name,
    kind: args.kind,
    mime_type: args.mimeType ?? "",
    size_bytes: args.sizeBytes,
    status: "ready",
    summary,
    text,
    dataset_inventory: datasetInventory,
    sheet_count: sheets.length,
    row_count: totalRows,
    field_names: fieldNames,
    source_profile: sourceProfile
  };
}

function buildTextPreview(args: BuildPreviewArgs): StudySourcePreview {
  const text = compactPreserveLines(decodeText(args.buffer), STUDY_SOURCE_SNAPSHOT_MAX_CHARS);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const delimiter = inferDelimiter(args.name, lines);
  const firstDelimitedLine = lines.find((line) => line.includes(delimiter));
  const fields = firstDelimitedLine
    ? firstDelimitedLine.split(delimiter).map((item) => item.trim()).filter(Boolean).slice(0, 60)
    : [];
  const sourceProfile = fields.length > 0
    ? buildSourceProfile(args, [
        profileDelimitedDataset(args.name, fields, lines.slice(lines.indexOf(firstDelimitedLine ?? "") + 1), delimiter)
      ])
    : buildUnstructuredSourceProfile(args);
  const summary = text
    ? `${args.name} contiene ${lines.length} líneas de contexto${fields.length > 0 ? ` y campos: ${fields.slice(0, 12).join(", ")}` : ""}.`
    : `${args.name} quedó registrado, pero no se pudo leer texto útil para el draft.`;

  return {
    name: args.name,
    kind: args.kind,
    mime_type: args.mimeType ?? "",
    size_bytes: args.sizeBytes,
    status: "ready",
    summary,
    text,
    dataset_inventory: fields.length > 0 ? [`${args.name}: campos ${fields.join(", ")}`] : [],
    sheet_count: 0,
    row_count: lines.length,
    field_names: fields,
    source_profile: sourceProfile
  };
}

function profileSheet(name: string, rows: unknown[][]) {
  const nonEmptyRows = rows
    .map((row) => row.map((cell) => stringifyCell(cell)).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  const headerIndex = inferHeaderIndex(nonEmptyRows);
  const headerRow = nonEmptyRows[headerIndex] ?? [];
  const headers = headerRow.map(normalizeHeader).filter(Boolean);
  const dataRows = Math.max(0, nonEmptyRows.length - headerIndex - 1);
  const columnCount = Math.max(...nonEmptyRows.map((row) => row.length), 0);
  const samples = nonEmptyRows
    .slice(headerIndex + 1, headerIndex + 5)
    .map((row) => rowToSample(headers, row))
    .filter(Boolean);
  const sampleRows = nonEmptyRows.slice(headerIndex + 1, headerIndex + 6);
  const sampleRecords = sampleRows
    .map((row) => rowToRecord(headers, row))
    .filter((record) => Object.keys(record).length > 0);
  return { name, headers, dataRows, columnCount, samples, sampleRecords };
}

function inferHeaderIndex(rows: string[][]) {
  const scored = rows.slice(0, 12).map((row, index) => {
    const nonEmpty = row.filter(Boolean);
    const textCount = nonEmpty.filter((cell) => /[a-záéíóúñ]/i.test(cell)).length;
    return { index, score: nonEmpty.length + textCount * 2 };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.index ?? 0;
}

function rowToSample(headers: string[], row: string[]) {
  const parts = row
    .slice(0, Math.min(Math.max(headers.length, 4), 8))
    .map((value, index) => {
      if (!value) return "";
      const header = headers[index] ?? `col_${index + 1}`;
      return `${header}: ${value}`;
    })
    .filter(Boolean);
  return parts.join(" | ");
}

function rowToRecord(headers: string[], row: string[]) {
  const record: Record<string, string> = {};
  row.slice(0, Math.min(headers.length || row.length, 18)).forEach((value, index) => {
    const clean = value.trim();
    if (!clean) return;
    record[headers[index] || `col_${index + 1}`] = clean.slice(0, 160);
  });
  return record;
}

function profileDelimitedDataset(name: string, headers: string[], lines: string[], delimiter: string) {
  const sampleRecords = lines
    .slice(0, 5)
    .map((line) => rowToRecord(headers, line.split(delimiter).map((item) => item.trim())))
    .filter((record) => Object.keys(record).length > 0);
  return {
    name,
    headers,
    dataRows: Math.max(0, lines.length),
    columnCount: headers.length,
    samples: sampleRecords.map((record) =>
      Object.entries(record)
        .slice(0, 8)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" | ")
    ),
    sampleRecords
  };
}

function buildSourceProfile(
  args: BuildPreviewArgs,
  datasets: Array<{
    name: string;
    headers: string[];
    dataRows: number;
    columnCount: number;
    sampleRecords: Record<string, string>[];
  }>
): StudySourceProfile {
  const profiledDatasets = datasets.map((dataset) => buildDatasetProfile(dataset));
  const sourceMetrics = profiledDatasets.flatMap((dataset) =>
    dataset.metric_fields.map((field) => {
      const fieldProfile = dataset.fields.find((item) => item.name === field);
      return {
        dataset_key: dataset.key,
        field,
        metric_key: `${dataset.key}.${fieldProfile?.metric_role ?? normalizeKey(field)}`,
        metric_family: fieldProfile?.metric_role ?? "metric",
        aggregation: metricAggregation(fieldProfile?.metric_role ?? field),
        unit: metricUnit(fieldProfile?.metric_role ?? field)
      } satisfies StudyMetricProfile;
    })
  );
  const sourceDimensions = profiledDatasets.flatMap((dataset) =>
    dataset.dimension_fields.map((field) => {
      const fieldProfile = dataset.fields.find((item) => item.name === field);
      return {
        dataset_key: dataset.key,
        field,
        dimension_key: `${dataset.key}.${fieldProfile?.dimension_role ?? normalizeKey(field)}`,
        dimension_family: fieldProfile?.dimension_role ?? "attribute"
      } satisfies StudyDimensionProfile;
    })
  );
  const sourceTimeAxes = profiledDatasets.flatMap((dataset) => buildTimeAxes(dataset));
  const sourceJoinKeys = profiledDatasets.flatMap((dataset) =>
    dataset.join_keys.map((field) => ({
      dataset_key: dataset.key,
      field,
      entity: inferJoinEntity(field)
    }) satisfies StudyJoinKeyProfile)
  );
  const compatibleGrains = uniqueInOrder(sourceTimeAxes.map((axis) => axis.grain).filter((grain) => grain !== "unknown"));

  return {
    version: 1,
    source_kind: args.kind,
    provider_hint: inferProviderHint(args),
    canonical_status: sourceTimeAxes.length > 0 || sourceMetrics.length > 0 ? "profiled" : "needs_mapping_review",
    datasets: profiledDatasets,
    source_metrics: sourceMetrics,
    source_dimensions: sourceDimensions,
    source_time_axes: sourceTimeAxes,
    source_join_keys: sourceJoinKeys,
    chart_readiness: {
      time_series: sourceTimeAxes.length > 0 && sourceMetrics.length > 0,
      metric_count: sourceMetrics.length,
      time_axis_count: sourceTimeAxes.length,
      compatible_grains: compatibleGrains
    },
    materialization_policy: "profile_now_materialize_later"
  };
}

function buildUnstructuredSourceProfile(args: BuildPreviewArgs): StudySourceProfile {
  return {
    version: 1,
    source_kind: args.kind,
    provider_hint: inferProviderHint(args),
    canonical_status: "unstructured",
    datasets: [],
    source_metrics: [],
    source_dimensions: [],
    source_time_axes: [],
    source_join_keys: [],
    chart_readiness: { time_series: false, metric_count: 0, time_axis_count: 0, compatible_grains: [] },
    materialization_policy: "profile_now_materialize_later"
  };
}

function buildDatasetProfile(dataset: {
  name: string;
  headers: string[];
  dataRows: number;
  columnCount: number;
  sampleRecords: Record<string, string>[];
}): StudyDatasetProfile {
  const fields = dataset.headers.map((header) => buildFieldProfile(header, dataset.sampleRecords));
  const metricFields = fields.filter((field) => field.semantic_type === "metric").map((field) => field.name);
  const dimensionFields = fields.filter((field) => field.semantic_type === "dimension" || field.semantic_type === "attribute").map((field) => field.name);
  const timeFields = fields.filter((field) => field.semantic_type === "time").map((field) => field.name);
  const joinKeys = fields.filter((field) => field.semantic_type === "entity_key").map((field) => field.name);
  const key = normalizeKey(dataset.name || "dataset");
  const semanticRole = inferDatasetRole(dataset.name, fields);
  const timeAxes = inferDatasetTimeAxes(key, timeFields);

  return {
    key,
    name: dataset.name,
    semantic_role: semanticRole,
    row_count: dataset.dataRows,
    column_count: dataset.columnCount,
    inferred_grain: timeAxes[0]?.grain ?? null,
    fields,
    metric_fields: metricFields,
    dimension_fields: dimensionFields,
    time_fields: timeFields,
    join_keys: joinKeys,
    sample_records: dataset.sampleRecords.slice(0, 5)
  };
}

function buildFieldProfile(name: string, sampleRecords: Record<string, string>[]): StudyFieldProfile {
  const normalized = normalizeKey(name);
  const examples = uniqueInOrder(sampleRecords.map((record) => record[name] ?? "").filter(Boolean)).slice(0, 3);
  const fieldType = inferCanonicalFieldType(name, examples);
  const metricRole = inferMetricRole(name);
  const dimensionRole = inferDimensionRole(name);
  const semanticType = metricRole
    ? "metric"
    : isTimeField(name)
      ? "time"
      : inferJoinEntity(name) !== "unknown"
        ? "entity_key"
        : dimensionRole
          ? "dimension"
          : "attribute";

  return {
    name,
    normalized_name: normalized,
    field_type: fieldType,
    semantic_type: semanticType,
    ...(metricRole ? { metric_role: metricRole } : {}),
    ...(dimensionRole ? { dimension_role: dimensionRole } : {}),
    examples,
    confidence: examples.length > 0 || metricRole || dimensionRole ? "medium" : "low"
  };
}

function buildTimeAxes(dataset: StudyDatasetProfile): StudyTimeAxisProfile[] {
  return inferDatasetTimeAxes(dataset.key, dataset.time_fields);
}

function inferDatasetTimeAxes(datasetKey: string, timeFields: string[]): StudyTimeAxisProfile[] {
  const normalized = new Map(timeFields.map((field) => [normalizeKey(field), field]));
  const yearField = normalized.get("ano") ?? normalized.get("anio") ?? normalized.get("year");
  const monthField = normalized.get("mes") ?? normalized.get("month");
  if (yearField && monthField) {
    return [{ dataset_key: datasetKey, fields: [yearField, monthField], grain: "month", canonical_period_key: `${datasetKey}.period_month` }];
  }
  return timeFields.map((field) => ({
    dataset_key: datasetKey,
    fields: [field],
    grain: inferTimeGrain(field),
    canonical_period_key: `${datasetKey}.${normalizeKey(field)}`
  }));
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function isSpreadsheet(name: string, mimeType = "") {
  const lowerName = name.toLowerCase();
  const lowerType = mimeType.toLowerCase();
  return (
    /\.(xlsx|xls|xlsm)$/.test(lowerName) ||
    lowerType.includes("spreadsheet") ||
    lowerType.includes("excel")
  );
}

function inferDelimiter(name: string, lines: string[]) {
  if (name.toLowerCase().endsWith(".tsv")) return "\t";
  const firstRows = lines.slice(0, 5).join("\n");
  const candidates = [",", "\t", ";", "|"];
  return candidates
    .map((delimiter) => ({ delimiter, count: (firstRows.match(new RegExp(escapeRegExp(delimiter), "g")) ?? []).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}

function decodeText(buffer: Uint8Array) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 400));
  const nulCount = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (nulCount > sample.length * 0.2) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  return new TextDecoder("utf-8").decode(buffer);
}

function inferProviderHint(args: BuildPreviewArgs) {
  const normalized = `${args.kind} ${args.name}`.toLowerCase();
  if (/meta|facebook|instagram/.test(normalized)) return "meta";
  if (/tiktok/.test(normalized)) return "tiktok";
  if (/google|search/.test(normalized)) return "google";
  if (/sentione|social.?listening|mention/.test(normalized)) return "social_listening";
  if (/ticket|zendesk|intercom|customer|support/.test(normalized)) return "customer_service";
  if (/venta|sales|reporte maestro|revenue|margin|margen/.test(normalized)) return "commercial_performance";
  return "manual_upload";
}

function inferDatasetRole(datasetName: string, fields: StudyFieldProfile[]) {
  const haystack = `${datasetName} ${fields.map((field) => `${field.name} ${field.metric_role ?? ""} ${field.dimension_role ?? ""}`).join(" ")}`.toLowerCase();
  if (/catalog|sku|producto|descripcion|description/.test(haystack)) return "product_catalog";
  if (/venta|sales|revenue|margen|margin|sku|precio|price/.test(haystack)) return "commercial_performance";
  if (/spend|impression|click|ctr|cpm|campaign|adset|meta|tiktok/.test(haystack)) return "social_performance";
  if (/mention|sentiment|sentimiento|author|post|query/.test(haystack)) return "social_listening";
  if (/ticket|case|csat|nps|support|queja|reclamo/.test(haystack)) return "customer_service";
  if (/search|keyword|query|impression|click/.test(haystack)) return "search_demand";
  return "reference_table";
}

function inferCanonicalFieldType(name: string, examples: string[]): StudyFieldProfile["field_type"] {
  if (isTimeField(name)) return /month|mes|year|ano|año|period|periodo/i.test(name) ? "period" : "date";
  if (inferJoinEntity(name) !== "unknown") return "identifier";
  if (inferMetricRole(name)) return "number";
  const numericExamples = examples.filter((value) => isNumericValue(value)).length;
  if (examples.length > 0 && numericExamples >= Math.ceil(examples.length * 0.7)) return "number";
  return "text";
}

function inferMetricRole(name: string) {
  const normalized = normalizeKey(name);
  if (/(^|_)(venta|ventas|sales|revenue|gmv|ingreso|ingresos)($|_)/.test(normalized)) return "sales";
  if (/(^|_)(margen|margin|gross_margin)($|_)/.test(normalized)) return "margin";
  if (/(^|_)(unidades|quantity|qty|cantidad|orders|ordenes|pedidos)($|_)/.test(normalized)) return "volume";
  if (/(^|_)(spend|inversion|cost|costo|gasto)($|_)/.test(normalized)) return "spend";
  if (/(^|_)(impressions|impresiones|reach|alcance)($|_)/.test(normalized)) return "reach";
  if (/(^|_)(clicks|clics|ctr|cpc|cpm)($|_)/.test(normalized)) return "traffic";
  if (/(^|_)(mentions|menciones|sentiment|sentimiento|share_of_voice|sov)($|_)/.test(normalized)) return "listening";
  if (/(^|_)(csat|nps|rating|calificacion|score)($|_)/.test(normalized)) return "satisfaction";
  return null;
}

function inferDimensionRole(name: string) {
  const normalized = normalizeKey(name);
  if (/(^|_)(supercategoria|categoria|category|subcategoria|taxonomy)($|_)/.test(normalized)) return "category";
  if (/(^|_)(brand|marca|competitor|competidor)($|_)/.test(normalized)) return "brand";
  if (/(^|_)(country|pais|market|mercado|region|ciudad|city)($|_)/.test(normalized)) return "market";
  if (/(^|_)(channel|canal|source|fuente|platform|plataforma)($|_)/.test(normalized)) return "channel";
  if (/(^|_)(campaign|campana|campaña|adset|ad_set)($|_)/.test(normalized)) return "campaign";
  if (/(^|_)(species|especie|pet|mascota|perro|gato)($|_)/.test(normalized)) return "pet_segment";
  return null;
}

function inferJoinEntity(name: string): StudyJoinKeyProfile["entity"] {
  const normalized = normalizeKey(name);
  if (/\b(sku|ean|product_id|producto_id|codigo_producto|id_producto)\b/.test(normalized)) return "product";
  if (/\b(campaign_id|campana_id|campana|campaign)\b/.test(normalized)) return "campaign";
  if (/\b(customer_id|cliente_id|user_id|usuario_id|email)\b/.test(normalized)) return "customer";
  if (/\b(brand_id|marca_id)\b/.test(normalized)) return "brand";
  if (/\b(country|pais|market|mercado|region)\b/.test(normalized)) return "market";
  return "unknown";
}

function isTimeField(name: string) {
  return /\b(fecha|date|day|dia|week|semana|month|mes|year|ano|año|period|periodo)\b/.test(normalizeKey(name));
}

function inferTimeGrain(field: string): StudyTimeAxisProfile["grain"] {
  const normalized = normalizeKey(field);
  if (/\b(day|dia|fecha|date)\b/.test(normalized)) return "day";
  if (/\b(week|semana)\b/.test(normalized)) return "week";
  if (/\b(month|mes|period|periodo)\b/.test(normalized)) return "month";
  if (/\b(year|ano|anio)\b/.test(normalized)) return "year";
  return "unknown";
}

function metricAggregation(metricRoleOrField: string): StudyMetricProfile["aggregation"] {
  const normalized = normalizeKey(metricRoleOrField);
  if (/\b(margin|margen|ctr|cpc|cpm|csat|nps|rating|score)\b/.test(normalized)) return "avg";
  return "sum";
}

function metricUnit(metricRoleOrField: string): StudyMetricProfile["unit"] {
  const normalized = normalizeKey(metricRoleOrField);
  if (/\b(sales|venta|revenue|spend|cost|costo|price|precio)\b/.test(normalized)) return "currency";
  if (/\b(margin|margen|ctr|cpc|cpm|rate|ratio)\b/.test(normalized)) return "ratio";
  if (/\b(volume|reach|traffic|listening|mentions|menciones|orders|pedidos)\b/.test(normalized)) return "count";
  return "unknown";
}

function isNumericValue(value: string) {
  const normalized = value.replace(/[$,%\s]/g, "").replace(",", ".");
  return normalized !== "" && Number.isFinite(Number(normalized));
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}
