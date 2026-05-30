import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";
import * as XLSX from "xlsx";

import { pool } from "../db/client";
import { embedKnowledgeSources } from "./semantic-embeddings";

type ProcessKnowledgeSourcesJobData = {
  corpusId: string;
  sourceIds: string[];
  requestedByUserId: string;
};

type KnowledgeSourceRow = {
  id: string;
  brand_id: string | null;
  study_corpus_id: string | null;
  source_kind: string;
  title: string;
  original_file_name: string | null;
  mime_type: string | null;
  storage_path: string | null;
  file_size_bytes: number | null;
  raw_text: string | null;
  extracted_payload: unknown;
};

type WorkbookProfile = {
  file: {
    name: string;
    title: string;
    source_kind: string;
    byte_size: number | null;
  };
  workbook: {
    sheet_count: number;
    sheet_names: string[];
  };
  sheets: SheetProfile[];
  cross_sheet_observations: string[];
};

type SheetProfile = {
  name: string;
  range: string | null;
  row_count: number;
  column_count: number;
  header_row_index: number;
  headers: string[];
  sample_rows: Record<string, unknown>[];
  columns: ColumnProfile[];
};

type ColumnProfile = {
  name: string;
  index: number;
  inferred_type: "empty" | "number" | "date" | "boolean" | "text" | "mixed";
  non_empty_count: number;
  empty_count: number;
  unique_count_sampled: number;
  examples: unknown[];
  numeric_min?: number;
  numeric_max?: number;
  date_min?: string;
  date_max?: string;
};

export async function processKnowledgeSourcesJob(job: Job<ProcessKnowledgeSourcesJobData>) {
  const ids = job.data.sourceIds.slice(0, 24);
  if (ids.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  for (const [index, sourceId] of ids.entries()) {
    await job.updateProgress(Math.round((index / ids.length) * 100));
    try {
      await processOneSource(sourceId, job.data.corpusId);
      processed += 1;
    } catch (error) {
      failed += 1;
      await pool.query(
        `
          UPDATE brand_knowledge_sources
          SET status = 'failed',
              error_message = $2,
              updated_at = now()
          WHERE id = $1
        `,
        [sourceId, error instanceof Error ? error.message : "unknown_error"]
      );
      console.error(`[knowledge] failed source ${sourceId}:`, error);
    }
  }

  await job.updateProgress(100);
  return { processed, failed, source_ids: ids };
}

export async function processOneSource(sourceId: string, corpusId: string) {
  const result = await pool.query<KnowledgeSourceRow>(
    `
      SELECT id, brand_id, study_corpus_id, source_kind, title, original_file_name,
             mime_type, storage_path, file_size_bytes, raw_text, extracted_payload
      FROM brand_knowledge_sources
      WHERE id = $1
        AND study_corpus_id = $2
      LIMIT 1
    `,
    [sourceId, corpusId]
  );
  const source = result.rows[0];
  if (!source) throw new Error(`Knowledge source not found: ${sourceId}`);

  await pool.query(
    `UPDATE brand_knowledge_sources SET status = 'processing', updated_at = now() WHERE id = $1`,
    [sourceId]
  );

  const profile = await buildSourceProfile(source);
  const analysis = await analyzeWorkbookContext(profile);
  const rawText = renderKnowledgeText(profile, analysis);

  await pool.query(
    `
      UPDATE brand_knowledge_sources
      SET status = 'processed',
          raw_text = $2,
          extracted_payload = $3::jsonb,
          error_message = NULL,
          updated_at = now()
      WHERE id = $1
    `,
    [
      sourceId,
      rawText,
      JSON.stringify({
        source_type: "spreadsheet_context",
        profile,
        ...analysis
      })
    ]
  );

  try {
    await embedKnowledgeSources(corpusId, [sourceId]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[knowledge] semantic embedding skipped for ${sourceId}: ${msg}`);
  }
}

async function buildSourceProfile(source: KnowledgeSourceRow): Promise<WorkbookProfile> {
  let storageError: unknown = null;
  if (source.storage_path) {
    try {
      return isDelimitedSource(source)
        ? await profileDelimitedFile(source.storage_path, source)
        : profileWorkbook(await readFile(source.storage_path), source);
    } catch (error) {
      storageError = error;
      if (!source.raw_text) throw error;
      console.warn(
        `[knowledge] storage read failed for ${source.id}, falling back to DB raw_text: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (source.raw_text) {
    return isDelimitedSource(source)
      ? profileDelimitedText(source.raw_text, source)
      : profilePlainText(source.raw_text, source);
  }

  if (storageError instanceof Error) throw storageError;
  throw new Error(`Knowledge source has no readable file snapshot: ${source.id}`);
}

function profileWorkbook(buffer: Buffer, source: KnowledgeSourceRow): WorkbookProfile {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellNF: false,
    cellStyles: false
  });

  const sheetNames = workbook.SheetNames.slice(0, 16);
  const sheets = sheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return emptySheetProfile(sheetName);

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false
    });
    return profileSheet(sheetName, sheet["!ref"] ?? null, rows);
  });

  return {
    file: {
      name: source.original_file_name ?? source.title,
      title: source.title,
      source_kind: source.source_kind,
      byte_size: source.file_size_bytes
    },
    workbook: {
      sheet_count: workbook.SheetNames.length,
      sheet_names: workbook.SheetNames
    },
    sheets,
    cross_sheet_observations: buildCrossSheetObservations(sheets)
  };
}

async function profileDelimitedFile(path: string, source: KnowledgeSourceRow): Promise<WorkbookProfile> {
  const delimiter = source.original_file_name?.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  const rows: unknown[][] = [];
  let totalLines = 0;
  for await (const line of rl) {
    totalLines += 1;
    if (rows.length < 5000) {
      rows.push(parseDelimitedLine(line, delimiter));
    }
  }

  const sheetName = source.original_file_name?.toLowerCase().endsWith(".tsv") ? "TSV Export" : "CSV Export";
  const sheet = profileSheet(sheetName, null, rows);
  sheet.row_count = totalLines;

  return {
    file: {
      name: source.original_file_name ?? source.title,
      title: source.title,
      source_kind: source.source_kind,
      byte_size: source.file_size_bytes
    },
    workbook: {
      sheet_count: 1,
      sheet_names: [sheetName]
    },
    sheets: [sheet],
    cross_sheet_observations: [
      totalLines > rows.length
        ? `Archivo delimitado grande: perfil basado en ${rows.length} filas muestreadas de ${totalLines} lineas.`
        : `Archivo delimitado completo: ${totalLines} lineas.`
    ]
  };
}

function profileDelimitedText(text: string, source: KnowledgeSourceRow): WorkbookProfile {
  const delimiter = source.original_file_name?.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rows = lines.slice(0, 5000).map((line) => parseDelimitedLine(line, delimiter));
  const sheetName = source.original_file_name?.toLowerCase().endsWith(".tsv") ? "TSV Export" : "CSV Export";
  const sheet = profileSheet(sheetName, null, rows);
  sheet.row_count = lines.length;

  return {
    file: {
      name: source.original_file_name ?? source.title,
      title: source.title,
      source_kind: source.source_kind,
      byte_size: source.file_size_bytes
    },
    workbook: {
      sheet_count: 1,
      sheet_names: [sheetName]
    },
    sheets: [sheet],
    cross_sheet_observations: [
      lines.length > rows.length
        ? `Archivo delimitado desde snapshot DB: perfil basado en ${rows.length} filas muestreadas de ${lines.length} lineas.`
        : `Archivo delimitado desde snapshot DB: ${lines.length} lineas.`
    ]
  };
}

function profilePlainText(text: string, source: KnowledgeSourceRow): WorkbookProfile {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 1000);
  const rows = [["line_number", "text"], ...lines.map((line, index) => [index + 1, line.slice(0, 500)])];
  const sheet = profileSheet("Text Snapshot", null, rows);

  return {
    file: {
      name: source.original_file_name ?? source.title,
      title: source.title,
      source_kind: source.source_kind,
      byte_size: source.file_size_bytes
    },
    workbook: {
      sheet_count: 1,
      sheet_names: ["Text Snapshot"]
    },
    sheets: [sheet],
    cross_sheet_observations: [`Archivo de texto perfilado desde snapshot DB: ${lines.length} lineas muestreadas.`]
  };
}

function profileSheet(name: string, range: string | null, rows: unknown[][]): SheetProfile {
  const rowCount = rows.length;
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const headerRowIndex = guessHeaderRow(rows);
  const rawHeaders = rows[headerRowIndex] ?? [];
  const headers = Array.from({ length: Math.min(columnCount, 80) }, (_, index) =>
    normalizeHeader(rawHeaders[index], index)
  );
  const dataRows = rows.slice(headerRowIndex + 1).filter((row) => row.some((cell) => cell !== null && cell !== ""));
  const sampleRows = dataRows.slice(0, 20).map((row) => rowToObject(row, headers));
  const columns = headers.slice(0, 80).map((header, index) => profileColumn(header, index, dataRows));

  return {
    name,
    range,
    row_count: rowCount,
    column_count: columnCount,
    header_row_index: headerRowIndex,
    headers,
    sample_rows: sampleRows,
    columns
  };
}

function profileColumn(name: string, index: number, rows: unknown[][]): ColumnProfile {
  const values = rows.map((row) => normalizeCell(row[index])).filter((value) => value !== null && value !== "");
  const emptyCount = Math.max(0, rows.length - values.length);
  const typeCounts = values.reduce<Record<string, number>>((acc, value) => {
    acc[inferCellType(value)] = (acc[inferCellType(value)] ?? 0) + 1;
    return acc;
  }, {});
  const inferred = inferColumnType(typeCounts, values.length);
  const unique = Array.from(new Set(values.map((value) => JSON.stringify(value)))).slice(0, 25);
  const examples = unique.slice(0, 8).map((value) => JSON.parse(value) as unknown);
  const profile: ColumnProfile = {
    name,
    index,
    inferred_type: inferred,
    non_empty_count: values.length,
    empty_count: emptyCount,
    unique_count_sampled: unique.length,
    examples
  };

  const numericValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numericValues.length > 0) {
    profile.numeric_min = Math.min(...numericValues);
    profile.numeric_max = Math.max(...numericValues);
  }

  const dateValues = values.filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value));
  if (dateValues.length > 0) {
    profile.date_min = dateValues.slice().sort()[0];
    profile.date_max = dateValues.slice().sort().at(-1);
  }

  return profile;
}

async function analyzeWorkbookContext(profile: WorkbookProfile) {
  const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
  const prompt = [
    "Eres el Spreadsheet Knowledge Engine de Noisia.",
    "Estas analizando archivos PRE-CORPUS. No son menciones del corpus final.",
    "Primero entiende que es el archivo, su estructura y que datos trae. Luego produce contexto reusable para construir queries y analizar el estudio.",
    "Devuelve SOLO JSON valido. Primer caracter `{`.",
    "",
    "Tu output debe ayudar a:",
    "- disenar la primera query de SentiOne/search/scrapers",
    "- entender canales, audiencia, campanas, contenidos o performance historica",
    "- detectar lenguaje que usuarios y marca usan",
    "- detectar posibles triggers/barriers e hipotesis",
    "- detectar ruido/exclusiones probables",
    "",
    "Formato:",
    JSON.stringify(
      {
        summary: "...",
        file_understanding: "...",
        dataset_inventory: ["..."],
        key_fields: ["..."],
        time_coverage: "...",
        audience_clues: ["..."],
        cultural_codes: ["..."],
        brand_claims: ["..."],
        competitor_clues: ["..."],
        content_or_channel_insights: ["..."],
        potential_triggers: ["..."],
        potential_barriers: ["..."],
        query_language: ["..."],
        exclusions_or_noise: ["..."],
        recommended_use: ["query_composition", "analysis_context", "signal_editorial"],
        limitations: ["..."]
      },
      null,
      2
    ),
    "",
    "Workbook profile:",
    JSON.stringify(compactProfileForPrompt(profile), null, 2)
  ].join("\n");

  try {
    const result = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.1
    });

    return normalizeAnalysis(parseJson(result.text));
  } catch (error) {
    console.warn(
      `[knowledge] Claude analysis failed for ${profile.file.name}, using extractive fallback: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return buildExtractiveAnalysis(profile, error);
  }
}

function compactProfileForPrompt(profile: WorkbookProfile) {
  return {
    file: profile.file,
    workbook: profile.workbook,
    cross_sheet_observations: profile.cross_sheet_observations,
    sheets: profile.sheets.map((sheet) => ({
      name: sheet.name,
      row_count: sheet.row_count,
      column_count: sheet.column_count,
      headers: sheet.headers.slice(0, 60),
      columns: sheet.columns.slice(0, 60).map((column) => ({
        name: column.name,
        inferred_type: column.inferred_type,
        non_empty_count: column.non_empty_count,
        examples: column.examples.slice(0, 5),
        numeric_min: column.numeric_min,
        numeric_max: column.numeric_max,
        date_min: column.date_min,
        date_max: column.date_max
      })),
      sample_rows: sheet.sample_rows.slice(0, 8)
    }))
  };
}

function renderKnowledgeText(profile: WorkbookProfile, analysis: Record<string, unknown>) {
  return [
    `Archivo: ${profile.file.name}`,
    `Hojas: ${profile.workbook.sheet_names.join(", ")}`,
    `Resumen: ${typeof analysis.summary === "string" ? analysis.summary : ""}`,
    "",
    "Inventario:",
    ...profile.sheets.map((sheet) => `- ${sheet.name}: ${sheet.row_count} filas, ${sheet.column_count} columnas`),
    "",
    "Lenguaje para query:",
    ...stringArray(analysis.query_language).map((item) => `- ${item}`),
    "",
    "Triggers potenciales:",
    ...stringArray(analysis.potential_triggers).map((item) => `- ${item}`),
    "",
    "Barriers potenciales:",
    ...stringArray(analysis.potential_barriers).map((item) => `- ${item}`)
  ].join("\n");
}

function parseJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Claude did not return JSON.");
  }
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function isDelimitedSource(source: KnowledgeSourceRow) {
  const name = source.original_file_name?.toLowerCase() ?? "";
  const mime = source.mime_type?.toLowerCase() ?? "";
  return name.endsWith(".csv") || name.endsWith(".tsv") || mime.includes("csv") || mime.includes("tab-separated");
}

function normalizeAnalysis(value: Record<string, unknown>) {
  return {
    summary: asString(value.summary),
    file_understanding: asString(value.file_understanding),
    dataset_inventory: stringArray(value.dataset_inventory),
    key_fields: stringArray(value.key_fields),
    time_coverage: asString(value.time_coverage),
    audience_clues: stringArray(value.audience_clues),
    cultural_codes: stringArray(value.cultural_codes),
    brand_claims: stringArray(value.brand_claims),
    competitor_clues: stringArray(value.competitor_clues),
    content_or_channel_insights: stringArray(value.content_or_channel_insights),
    potential_triggers: stringArray(value.potential_triggers),
    potential_barriers: stringArray(value.potential_barriers),
    query_language: stringArray(value.query_language),
    exclusions_or_noise: stringArray(value.exclusions_or_noise),
    recommended_use: stringArray(value.recommended_use),
    limitations: stringArray(value.limitations)
  };
}

function buildExtractiveAnalysis(profile: WorkbookProfile, error: unknown) {
  const firstSheet = profile.sheets[0];
  const headers = profile.sheets.flatMap((sheet) => sheet.headers).slice(0, 30);
  const inventory = profile.sheets.map(
    (sheet) => `${sheet.name}: ${sheet.row_count} filas, ${sheet.column_count} columnas (${sheet.headers.slice(0, 12).join(", ")})`
  );
  const textExamples = profile.sheets
    .flatMap((sheet) => sheet.columns)
    .filter((column) => column.inferred_type === "text")
    .flatMap((column) => column.examples)
    .filter((value): value is string => typeof value === "string")
    .slice(0, 24);

  return normalizeAnalysis({
    summary: `${profile.file.name} contiene ${profile.workbook.sheet_count} hoja(s) y ${firstSheet?.row_count ?? 0} filas perfiladas para contexto del estudio.`,
    file_understanding: `Fuente ${profile.file.source_kind} perfilada por estructura tabular/textual. Campos detectados: ${headers.join(", ") || "sin headers claros"}.`,
    dataset_inventory: inventory,
    key_fields: headers,
    content_or_channel_insights: profile.cross_sheet_observations,
    query_language: Array.from(new Set(textExamples.flatMap(extractQueryTerms))).slice(0, 24),
    recommended_use: ["query_composition", "analysis_context"],
    limitations: [
      `Claude no pudo completar el análisis semántico; se usó fallback extractivo. Motivo: ${error instanceof Error ? error.message : String(error)}`
    ]
  });
}

function extractQueryTerms(value: string) {
  return value
    .split(/[^A-Za-z0-9#@áéíóúÁÉÍÓÚñÑ_-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && term.length <= 40)
    .slice(0, 6);
}

function guessHeaderRow(rows: unknown[][]) {
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const row = rows[index] ?? [];
    const nonEmpty = row.filter((cell) => cell !== null && cell !== "").length;
    const textCount = row.filter((cell) => typeof cell === "string" && cell.trim().length > 0).length;
    const score = nonEmpty + textCount * 1.5;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function normalizeHeader(value: unknown, index: number) {
  const raw = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value);
  return raw.length > 0 ? raw.slice(0, 120) : `column_${index + 1}`;
}

function rowToObject(row: unknown[], headers: string[]) {
  return Object.fromEntries(headers.map((header, index) => [header, normalizeCell(row[index])]));
}

function normalizeCell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().slice(0, 240);
  return value === undefined ? null : value;
}

function inferCellType(value: unknown) {
  if (value === null || value === "") return "empty";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  if (typeof value === "string") return "text";
  return "mixed";
}

function inferColumnType(typeCounts: Record<string, number>, total: number): ColumnProfile["inferred_type"] {
  if (total === 0) return "empty";
  const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const [topType, count] = entries[0] ?? ["mixed", 0];
  return count / total >= 0.72 ? topType as ColumnProfile["inferred_type"] : "mixed";
}

function buildCrossSheetObservations(sheets: SheetProfile[]) {
  const observations: string[] = [];
  const sharedHeaders = new Map<string, number>();
  for (const sheet of sheets) {
    for (const header of sheet.headers) {
      sharedHeaders.set(header.toLowerCase(), (sharedHeaders.get(header.toLowerCase()) ?? 0) + 1);
    }
  }
  const repeated = Array.from(sharedHeaders.entries()).filter(([, count]) => count > 1).slice(0, 20);
  if (repeated.length > 0) {
    observations.push(`Headers repetidos entre hojas: ${repeated.map(([header]) => header).join(", ")}`);
  }
  const bigSheets = sheets.filter((sheet) => sheet.row_count > 1000).map((sheet) => sheet.name);
  if (bigSheets.length > 0) observations.push(`Hojas de alto volumen: ${bigSheets.join(", ")}`);
  return observations;
}

function emptySheetProfile(name: string): SheetProfile {
  return {
    name,
    range: null,
    row_count: 0,
    column_count: 0,
    header_row_index: 0,
    headers: [],
    sample_rows: [],
    columns: []
  };
}

function asString(value: unknown) {
  return typeof value === "string" ? value.slice(0, 4000) : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 500)).slice(0, 40)
    : [];
}
