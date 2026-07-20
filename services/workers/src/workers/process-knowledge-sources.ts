import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";
import {
  buildSourceMaterializationContract,
  buildSourceObservations,
  buildSourceRecords,
  dataOsMetricDefinition,
  dataOsMetricVariantDefinitionByKey,
  evaluateSourceMaterialization,
  inferSourceDatasetRole,
  inferSourceMetricFamily,
  type SourceMaterializationContract,
  type SourceMaterializationEvidence,
  type SourceMaterializationQuality,
  type SourceObservation,
  type SourceObservationDatasetInput,
  type SourceRecord
} from "@noisia/query-engine";
import * as XLSX from "xlsx";

import { pool } from "../db/client";
import { embedKnowledgeSources } from "./semantic-embeddings";
import { prepareSourceObservationsForUpsert } from "./source-observation-upsert";
import {
  applySourcePeriodInference,
  applySourceRecordPeriodInference,
  inferSourceSnapshotPeriod
} from "./source-period";
import { resolveMarketCurrency, type MarketCurrencyResolution } from "./source-market-currency";

type ProcessKnowledgeSourcesJobData = {
  corpusId: string;
  sourceIds: string[];
  requestedByUserId: string;
};

type KnowledgeSourceRow = {
  id: string;
  organization_id: string | null;
  brand_id: string | null;
  study_corpus_id: string | null;
  source_kind: string;
  title: string;
  original_file_name: string | null;
  mime_type: string | null;
  storage_path: string | null;
  file_size_bytes: number | null;
  source_period_start: string | null;
  source_period_end: string | null;
  created_at: string;
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
  materialization_rows: Record<string, unknown>[];
  materialization_truncated: boolean;
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

type MaterializedSourceProfile = {
  datasets: Array<{
    key: string;
    name: string;
    row_count: number;
    materialized_rows: number;
    materialization_truncated: boolean;
    semantic_role: string;
    fields: Array<{
      name: string;
      field_type: string;
      semantic_type: string;
      metric_role?: string;
      dimension_role?: string;
      examples: unknown[];
    }>;
  }>;
  source_metrics: string[];
  source_dimensions: string[];
  source_time_axes: string[];
  source_join_keys: string[];
  chart_readiness: {
    time_series: boolean;
    joinable_with_mentions: boolean;
    joinable_with_sales: boolean;
  };
  materialization_policy: "worker_materialized_records_and_observations";
};

const MAX_MATERIALIZATION_ROWS_PER_SHEET = 50_000;
const KNOWLEDGE_ANALYSIS_TIMEOUT_MS = Number(process.env.NOISIA_KNOWLEDGE_ANALYSIS_TIMEOUT_MS ?? 25_000);

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

  if (processed > 0) {
    await analyzeDataOsMaterializationTables();
  }

  await job.updateProgress(100);
  return { processed, failed, source_ids: ids };
}

export async function processOneSource(sourceId: string, corpusId: string) {
  const source = await loadKnowledgeSource(sourceId, corpusId);

  await pool.query(
    `UPDATE brand_knowledge_sources SET status = 'processing', updated_at = now() WHERE id = $1`,
    [sourceId]
  );

  const profile = await buildSourceProfile(source);
  const materialization = await materializeKnowledgeSourceData(source, corpusId, profile);
  await markSourceProfiled(sourceId, profile, materialization);
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
        source_profile: materialization.sourceProfile,
        data_os_materialization: materialization.summary,
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

export async function rematerializeOneSource(sourceId: string, corpusId: string) {
  const source = await loadKnowledgeSource(sourceId, corpusId);
  const profile = await buildSourceProfile(source);
  const materialization = await materializeKnowledgeSourceData(source, corpusId, profile);
  await analyzeDataOsMaterializationTables();

  await pool.query(
    `
      UPDATE brand_knowledge_sources
      SET extracted_payload = COALESCE(extracted_payload, '{}'::jsonb) || $2::jsonb,
          error_message = NULL,
          updated_at = now()
      WHERE id = $1
    `,
    [
      sourceId,
      JSON.stringify({
        source_profile: materialization.sourceProfile,
        data_os_materialization: materialization.summary,
        data_os_reconciled_at: new Date().toISOString()
      })
    ]
  );

  return materialization.summary;
}

async function loadKnowledgeSource(sourceId: string, corpusId: string) {
  const result = await pool.query<KnowledgeSourceRow>(
    `
      SELECT id, brand_id, study_corpus_id, source_kind, title, original_file_name,
             organization_id, mime_type, storage_path, file_size_bytes, source_period_start::text,
             source_period_end::text, created_at::text, raw_text, extracted_payload
      FROM brand_knowledge_sources
      WHERE id = $1
        AND study_corpus_id = $2
      LIMIT 1
    `,
    [sourceId, corpusId]
  );
  const source = result.rows[0];
  if (!source) throw new Error(`Knowledge source not found: ${sourceId}`);
  return source;
}

async function markSourceProfiled(
  sourceId: string,
  profile: WorkbookProfile,
  materialization: Awaited<ReturnType<typeof materializeKnowledgeSourceData>>
) {
  const profiledPayload = {
    source_type: "spreadsheet_context",
    profile,
    source_profile: materialization.sourceProfile,
    data_os_materialization: materialization.summary,
    summary: buildDataOsSummary(profile, materialization),
    file_understanding: buildDataOsUnderstanding(profile, materialization),
    dataset_inventory: buildDatasetInventory(profile),
    query_language: buildProfileQueryLanguage(profile)
  };

  await pool.query(
    `
      UPDATE brand_knowledge_sources
      SET status = 'profiled',
          extracted_payload = COALESCE(extracted_payload, '{}'::jsonb) || $2::jsonb,
          error_message = NULL,
          updated_at = now()
      WHERE id = $1
    `,
    [sourceId, JSON.stringify(profiledPayload)]
  );
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
    if (rows.length < MAX_MATERIALIZATION_ROWS_PER_SHEET + 1) {
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
  const rows = lines.slice(0, MAX_MATERIALIZATION_ROWS_PER_SHEET + 1).map((line) => parseDelimitedLine(line, delimiter));
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
  const materializationRows = dataRows
    .slice(0, MAX_MATERIALIZATION_ROWS_PER_SHEET)
    .map((row) => rowToObject(row, headers));
  const columns = headers.slice(0, 80).map((header, index) => profileColumn(header, index, dataRows));

  return {
    name,
    range,
    row_count: rowCount,
    column_count: columnCount,
    header_row_index: headerRowIndex,
    headers,
    sample_rows: sampleRows,
    materialization_rows: materializationRows,
    materialization_truncated: dataRows.length > materializationRows.length,
    columns
  };
}

function sourceRowCount(sheet: SheetProfile) {
  return Math.max(0, sheet.row_count - sheet.header_row_index - 1);
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

async function materializeKnowledgeSourceData(source: KnowledgeSourceRow, corpusId: string, profile: WorkbookProfile) {
  const sourceProfile = buildCanonicalSourceProfile(profile);
  const marketCurrency = await resolveDefaultSourceCurrency(source, corpusId);
  const dataSourceId = await upsertDataSource(source, corpusId, sourceProfile);
  const syncRunId = await createSourceSyncRun(dataSourceId, profile, "running", null);
  const dataAssetId = await upsertDataAsset(source, corpusId, dataSourceId, sourceProfile, profile);
  await upsertDataAssetFields(dataAssetId, sourceProfile);
  await upsertSourceMaterializationLineage({
    knowledgeSourceId: source.id,
    dataSourceId,
    dataAssetId,
    syncRunId,
    corpusId
  });

  const datasets: SourceObservationDatasetInput[] = profile.sheets
    .filter((sheet) => sheet.materialization_rows.length > 0)
    .map((sheet) => {
      const datasetRole = inferDatasetRole(sheet);
      return {
        datasetKey: normalizeKey(sheet.name),
        datasetName: sheet.name,
        datasetRole,
        fields: sheet.columns.map((column) => ({
          name: column.name,
          semantic_type: inferColumnSemanticType(column, datasetRole),
          metric_role: inferMetricRole(column.name, datasetRole) ?? undefined,
          dimension_role: inferDimensionRole(column.name) ?? undefined,
          field_type: column.inferred_type
        })),
        records: sheet.materialization_rows
      };
    });

  const contract = buildSourceMaterializationContract(
    sourceProfile.datasets.map((dataset) => ({
      datasetKey: dataset.key,
      datasetRole: dataset.semantic_role,
      sourceRows: dataset.row_count,
      materializedRows: dataset.materialized_rows,
      hasEntityKey: dataset.fields.some((field) => field.semantic_type === "entity_key"),
      hasTimeAxis: dataset.fields.some((field) => field.semantic_type === "time"),
      metricFamilies: dataset.fields
        .map((field) => field.metric_role ?? null)
        .filter((family): family is string => Boolean(family))
    }))
  );
  await upsertMaterializedDataContract(dataAssetId, sourceProfile, profile, contract);

  const sourceSnapshot = inferSourceSnapshotPeriod(source);
  const records = buildSourceRecords({
    sourceName: profile.file.name,
    datasets,
    maxRowsPerDataset: MAX_MATERIALIZATION_ROWS_PER_SHEET
  }).map((record) => applySourceRecordPeriodInference(record, sourceSnapshot));
  const observations = buildSourceObservations({
    sourceName: profile.file.name,
    datasets,
    defaultCurrencyCode: marketCurrency.currencyCode,
    maxRowsPerDataset: MAX_MATERIALIZATION_ROWS_PER_SHEET
  }).map((observation) => applySourcePeriodInference(observation, sourceSnapshot));

  await ensureSourceMetricDefinitions(observations);
  const insertedRecords = await insertDataAssetRecords({
    source,
    corpusId,
    dataSourceId,
    dataAssetId,
    syncRunId,
    records
  });
  const insertedObservations = await insertDataObservations({
    source,
    corpusId,
    dataSourceId,
    dataAssetId,
    syncRunId,
    observations
  });
  await pruneStaleMaterialization(dataAssetId, syncRunId);

  const evidence = buildMaterializationEvidence(records, observations, insertedRecords, insertedObservations);
  const quality = evaluateSourceMaterialization(contract, evidence);
  const issueHistogram = [...records, ...observations].flatMap((item) => item.qualityIssues).reduce<Record<string, number>>(
    (counts, issue) => ({ ...counts, [issue]: (counts[issue] ?? 0) + 1 }),
    {}
  );

  await pool.query(
    `
      UPDATE source_sync_runs
      SET status = 'completed',
          finished_at = now(),
          records_total = $2,
          records_valid = $3,
          records_failed = $4,
          error_summary = $5::jsonb
      WHERE id = $1
    `,
    [
      syncRunId,
      records.length,
      evidence.acceptedRecords + evidence.reviewRecords,
      evidence.rejectedRecords,
      JSON.stringify({
        materialization_status: quality.status,
        blockers: quality.blockers,
        warnings: quality.warnings,
        needs_mapping_review: evidence.reviewRecords + evidence.reviewObservations,
        issues: issueHistogram
      })
    ]
  );

  await upsertMaterializationQualityResult({
    dataAssetId,
    syncRunId,
    contract,
    quality
  });

  await pool.query(
    `
      UPDATE data_sources
      SET mapping = mapping || $2::jsonb,
          status = 'active',
          updated_at = now()
      WHERE id = $1
    `,
    [
      dataSourceId,
      JSON.stringify({
        data_os_materialization: {
          tables: contract.canonicalTargets,
          contract,
          quality,
          source_record_count: records.length,
          upserted_record_count: insertedRecords,
          observation_count: observations.length,
          upserted_observation_count: insertedObservations,
          market_currency: marketCurrency,
          metric_keys: Array.from(new Set(observations.map((observation) => observation.metricKey))).sort(),
          period_start: minString(observations.map((observation) => observation.periodStart)),
          period_end: maxString(observations.map((observation) => observation.periodEnd))
        }
      })
    ]
  );

  return {
    sourceProfile,
    summary: {
      tables: contract.canonicalTargets,
      data_source_id: dataSourceId,
      data_asset_id: dataAssetId,
      source_sync_run_id: syncRunId,
      source_record_count: records.length,
      upserted_record_count: insertedRecords,
      observation_count: observations.length,
      upserted_observation_count: insertedObservations,
      market_currency: marketCurrency,
      materialization_status: quality.status,
      blockers: quality.blockers,
      warnings: quality.warnings,
      metric_keys: Array.from(new Set(observations.map((observation) => observation.metricKey))).sort(),
      period_start: minString(observations.map((observation) => observation.periodStart)),
      period_end: maxString(observations.map((observation) => observation.periodEnd)),
      truncated_datasets: profile.sheets
        .filter((sheet) => sheet.materialization_truncated)
        .map((sheet) => ({
          dataset_key: normalizeKey(sheet.name),
          dataset_name: sheet.name,
          materialized_rows: sheet.materialization_rows.length,
          row_count: sourceRowCount(sheet)
        }))
    }
  };
}

function buildCanonicalSourceProfile(profile: WorkbookProfile): MaterializedSourceProfile {
  const datasets = profile.sheets.map((sheet) => {
    const datasetRole = inferDatasetRole(sheet);
    const fields = sheet.columns.map((column) => ({
      name: column.name,
      field_type: column.inferred_type,
      semantic_type: inferColumnSemanticType(column, datasetRole),
      metric_role: inferMetricRole(column.name, datasetRole) ?? undefined,
      dimension_role: inferDimensionRole(column.name) ?? undefined,
      examples: column.examples.slice(0, 5)
    }));

    return {
      key: normalizeKey(sheet.name),
      name: sheet.name,
      row_count: sourceRowCount(sheet),
      materialized_rows: sheet.materialization_rows.length,
      materialization_truncated: sheet.materialization_truncated,
      semantic_role: datasetRole,
      fields
    };
  });

  const allFields = datasets.flatMap((dataset) => dataset.fields);
  return {
    datasets,
    source_metrics: Array.from(
      new Set(allFields.filter((field) => field.semantic_type === "metric").map((field) => field.metric_role ?? normalizeKey(field.name)))
    ).sort(),
    source_dimensions: Array.from(
      new Set(
        allFields
          .filter((field) => field.semantic_type === "dimension" || field.dimension_role)
          .map((field) => field.dimension_role ?? normalizeKey(field.name))
      )
    ).sort(),
    source_time_axes: Array.from(
      new Set(allFields.filter((field) => field.semantic_type === "time").map((field) => normalizeKey(field.name)))
    ).sort(),
    source_join_keys: Array.from(
      new Set(allFields.filter((field) => field.semantic_type === "entity_key").map((field) => normalizeKey(field.name)))
    ).sort(),
    chart_readiness: {
      time_series: datasets.some((dataset) => dataset.fields.some((field) => field.semantic_type === "time")),
      joinable_with_mentions: datasets.some((dataset) => dataset.fields.some((field) => field.metric_role === "mentions")),
      joinable_with_sales: datasets.some((dataset) => dataset.fields.some((field) => field.metric_role === "sales"))
    },
    materialization_policy: "worker_materialized_records_and_observations"
  };
}

async function upsertDataSource(source: KnowledgeSourceRow, corpusId: string, sourceProfile: MaterializedSourceProfile) {
  const existing = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM data_sources
      WHERE mapping->>'knowledge_source_id' = $1
      LIMIT 1
    `,
    [source.id]
  );
  if (existing.rows[0]) {
    await pool.query(
      `
        UPDATE data_sources
        SET mapping = mapping || $2::jsonb,
            status = 'profiling',
            updated_at = now()
        WHERE id = $1
      `,
      [
        existing.rows[0].id,
        JSON.stringify({
          source_profile: sourceProfile,
          datasets: sourceProfile.datasets,
          materialization_policy: sourceProfile.materialization_policy
        })
      ]
    );
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO data_sources (
        organization_id, brand_id, study_corpus_id, source_type, provider,
        connection_method, name, mapping, mapping_version, role, status, visibility
      )
      VALUES ($1, $2, $3, $4, $5, 'manual_upload', $6, $7::jsonb, 1, $8::jsonb, 'profiling', 'internal')
      RETURNING id
    `,
    [
      source.organization_id,
      source.brand_id,
      corpusId,
      source.source_kind,
      inferProvider(source.original_file_name ?? source.title, source.source_kind),
      source.original_file_name ?? source.title,
      JSON.stringify({
        knowledge_source_id: source.id,
        mime_type: source.mime_type,
        file_size_bytes: source.file_size_bytes,
        source_profile: sourceProfile,
        datasets: sourceProfile.datasets,
        materialization_policy: sourceProfile.materialization_policy
      }),
      JSON.stringify({
        input_stage: "study_sources",
        data_os_role: sourceProfile.chart_readiness.time_series ? "analytical_source" : "context_source",
        objective_context: true,
        query_context: true,
        analysis_context: true,
        chart_context: sourceProfile.chart_readiness.time_series,
        storage_policy: "canonical_records_and_numeric_observations"
      })
    ]
  );
  const created = result.rows[0]?.id;
  if (!created) throw new Error(`Data OS data source was not created for knowledge source ${source.id}.`);
  return created;
}

async function createSourceSyncRun(
  dataSourceId: string,
  profile: WorkbookProfile,
  status: "running" | "completed" | "failed",
  errorSummary: Record<string, unknown> | null
) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO source_sync_runs (
        data_source_id, started_at, finished_at, status, records_total,
        records_valid, records_failed, error_summary
      )
      VALUES ($1, now(), $2, $3, $4, NULL, 0, $5::jsonb)
      RETURNING id
    `,
    [
      dataSourceId,
      status === "running" ? null : new Date(),
      status,
      profile.sheets.reduce((sum, sheet) => sum + sourceRowCount(sheet), 0),
      JSON.stringify(errorSummary ?? {})
    ]
  );
  const created = result.rows[0]?.id;
  if (!created) throw new Error(`Data OS sync run was not created for data source ${dataSourceId}.`);
  return created;
}

async function upsertDataAsset(
  source: KnowledgeSourceRow,
  corpusId: string,
  dataSourceId: string,
  sourceProfile: MaterializedSourceProfile,
  profile: WorkbookProfile
) {
  const assetName = `${source.original_file_name ?? source.title} · canonical ${source.id.slice(0, 8)}`;
  const existing = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM data_assets
      WHERE data_source_id = $1
        AND metadata->>'knowledge_source_id' = $2
      LIMIT 1
    `,
    [dataSourceId, source.id]
  );
  if (existing.rows[0]) {
    await pool.query(
      `
        UPDATE data_assets
        SET name = $2,
            description = $3,
            asset_kind = $4,
            row_count = $5,
            metadata = metadata || $6::jsonb,
            status = 'active',
            updated_at = now()
        WHERE id = $1
      `,
      [
        existing.rows[0].id,
        assetName,
        `Canonical source records and governed numeric observations from ${profile.file.name}`,
        inferAssetKindFromSource(source),
        sourceProfile.datasets.reduce((sum, dataset) => sum + dataset.materialized_rows, 0),
        JSON.stringify({
          knowledge_source_id: source.id,
          source_profile: sourceProfile,
          workbook: profile.workbook,
          materializes_to: ["data_asset_records", "data_observations"]
        })
      ]
    );
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO data_assets (
        organization_id, brand_id, study_corpus_id, data_source_id,
        asset_kind, layer, name, description, sensitivity, status,
        row_count, metadata
      )
      VALUES ($1, $2, $3, $4, $5, 'curated', $6, $7, 'internal', 'active', $8, $9::jsonb)
      RETURNING id
    `,
    [
      source.organization_id,
      source.brand_id,
      corpusId,
      dataSourceId,
      inferAssetKindFromSource(source),
      assetName,
      `Canonical source records and governed numeric observations from ${profile.file.name}`,
      sourceProfile.datasets.reduce((sum, dataset) => sum + dataset.materialized_rows, 0),
      JSON.stringify({
        knowledge_source_id: source.id,
        source_profile: sourceProfile,
        workbook: profile.workbook,
        materializes_to: ["data_asset_records", "data_observations"]
      })
    ]
  );
  const created = result.rows[0]?.id;
  if (!created) throw new Error(`Data OS data asset was not created for knowledge source ${source.id}.`);
  return created;
}

async function upsertDataAssetFields(dataAssetId: string, sourceProfile: MaterializedSourceProfile) {
  const fields = sourceProfile.datasets.flatMap((dataset) =>
    dataset.fields.map((field, index) => ({
      ...field,
      dataset_key: dataset.key,
      dataset_name: dataset.name,
      ordinal: index
    }))
  );

  for (const field of fields.slice(0, 240)) {
    await pool.query(
      `
        INSERT INTO data_asset_fields (
          data_asset_id, field_name, field_type, semantic_type, nullable,
          description, examples, metadata
        )
        VALUES ($1, $2, $3, $4, NULL, NULL, $5::jsonb, $6::jsonb)
        ON CONFLICT (data_asset_id, field_name) DO UPDATE SET
          field_type = EXCLUDED.field_type,
          semantic_type = EXCLUDED.semantic_type,
          examples = EXCLUDED.examples,
          metadata = data_asset_fields.metadata || EXCLUDED.metadata
      `,
      [
        dataAssetId,
        field.name,
        field.field_type,
        field.semantic_type,
        JSON.stringify(field.examples ?? []),
        JSON.stringify({
          dataset_key: field.dataset_key,
          dataset_name: field.dataset_name,
          ordinal: field.ordinal,
          metric_role: field.metric_role ?? null,
          dimension_role: field.dimension_role ?? null,
          inferred_from: "knowledge_source_worker"
        })
      ]
    );
  }
}

async function upsertMaterializedDataContract(
  dataAssetId: string,
  sourceProfile: MaterializedSourceProfile,
  profile: WorkbookProfile,
  contract: SourceMaterializationContract
) {
  await pool.query(
    `
      WITH superseded AS (
        UPDATE data_contracts
        SET status = 'superseded', updated_at = now()
        WHERE data_asset_id = $1
          AND contract_name = 'study_source_contract'
          AND version <> $2
          AND status = 'active'
      )
      INSERT INTO data_contracts (
        data_asset_id, contract_name, version, status,
        schema_contract, quality_contract, freshness_contract, semantic_contract
      )
      VALUES ($1, 'study_source_contract', $2, 'active', $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
      ON CONFLICT (data_asset_id, contract_name, version) DO UPDATE SET
        status = 'active',
        schema_contract = EXCLUDED.schema_contract,
        quality_contract = EXCLUDED.quality_contract,
        freshness_contract = EXCLUDED.freshness_contract,
        semantic_contract = EXCLUDED.semantic_contract,
        updated_at = now()
    `,
    [
      dataAssetId,
      contract.version,
      JSON.stringify({
        contract_version: contract.version,
        workbook: profile.workbook,
        datasets: sourceProfile.datasets,
        expected_source_rows: contract.expectedSourceRows,
        expected_materialized_rows: contract.expectedMaterializedRows,
        canonical_targets: contract.canonicalTargets
      }),
      JSON.stringify({
        required: ["canonical_record", "record_identity"],
        conditional: [
          ...(contract.expectsNumericObservations ? ["numeric_metric_value"] : []),
          ...(contract.expectsTemporalRecords ? ["period_start_for_temporal_source"] : []),
          ...(contract.expectsSnapshotRecords ? ["capture_date_for_snapshot_record"] : []),
          ...(contract.expectsSnapshotObservations ? ["capture_date_for_snapshot_observation"] : []),
          ...(contract.requiresCatalogIdentity ? ["entity_key_for_product_catalog"] : [])
        ],
        review_policy: "block_incomplete_materialization_review_ambiguous_semantics",
        materialization_limit_per_dataset: MAX_MATERIALIZATION_ROWS_PER_SHEET
      }),
      JSON.stringify({ mode: "manual_upload", refresh: "on_new_file" }),
      JSON.stringify({
        metrics: sourceProfile.source_metrics,
        dimensions: sourceProfile.source_dimensions,
        time_axes: sourceProfile.source_time_axes,
        join_keys: sourceProfile.source_join_keys,
        chart_readiness: sourceProfile.chart_readiness,
        canonical_targets: contract.canonicalTargets,
        source_materialization_contract: contract
      })
    ]
  );
}

async function upsertMaterializationQualityResult(args: {
  dataAssetId: string;
  syncRunId: string;
  contract: SourceMaterializationContract;
  quality: SourceMaterializationQuality;
}) {
  const status = args.quality.status === "passed"
    ? "pass"
    : args.quality.status === "warning"
      ? "warn"
      : "fail";

  await pool.query(
    `
      INSERT INTO data_quality_results (
        data_asset_id, source_sync_run_id, result_key, status,
        observed_value, expected_value, sample_refs, checked_at
      )
      VALUES ($1, $2, 'materialization_contract', $3, $4::jsonb, $5::jsonb, $6::jsonb, now())
      ON CONFLICT (data_asset_id, result_key) DO UPDATE SET
        source_sync_run_id = EXCLUDED.source_sync_run_id,
        status = EXCLUDED.status,
        observed_value = EXCLUDED.observed_value,
        expected_value = EXCLUDED.expected_value,
        sample_refs = EXCLUDED.sample_refs,
        checked_at = now()
    `,
    [
      args.dataAssetId,
      args.syncRunId,
      status,
      JSON.stringify({
        ...args.quality.observed,
        blockers: args.quality.blockers,
        warnings: args.quality.warnings
      }),
      JSON.stringify({
        ...args.quality.expected,
        source_materialization_contract: args.contract
      }),
      JSON.stringify(args.contract.datasets.slice(0, 12).map((dataset) => ({
        dataset_key: dataset.datasetKey,
        source_rows: dataset.sourceRows,
        materialized_rows: dataset.materializedRows,
        fully_profiled: dataset.fullyProfiled,
        dataset_role: dataset.datasetRole
      })))
    ]
  );
}

async function upsertSourceMaterializationLineage(args: {
  knowledgeSourceId: string;
  dataSourceId: string;
  dataAssetId: string;
  syncRunId: string;
  corpusId: string;
}) {
  await pool.query(
    `
      INSERT INTO lineage_edges (
        source_type, source_id, target_type, target_id, relation_type, metadata
      )
      VALUES
        ('brand_knowledge_source', $1::uuid, 'data_source', $2::uuid, 'ingested_into', $5::jsonb),
        ('data_source', $2::uuid, 'data_asset', $3::uuid, 'materializes', $5::jsonb),
        ('source_sync_run', $4::uuid, 'data_asset', $3::uuid, 'materializes', $5::jsonb)
      ON CONFLICT (source_type, source_id, target_type, target_id, relation_type) DO UPDATE SET
        metadata = lineage_edges.metadata || EXCLUDED.metadata
    `,
    [
      args.knowledgeSourceId,
      args.dataSourceId,
      args.dataAssetId,
      args.syncRunId,
      JSON.stringify({
        study_corpus_id: args.corpusId,
        knowledge_source_id: args.knowledgeSourceId,
        canonical_targets: ["data_asset_records", "data_observations"]
      })
    ]
  );
}

async function ensureSourceMetricDefinitions(observations: SourceObservation[]) {
  const definitions = new Map<string, Record<string, unknown>>();
  for (const observation of observations) {
    if (definitions.has(observation.metricKey)) continue;
    const canonical = dataOsMetricDefinition(observation.metricFamily);
    if (!canonical) continue;
    const variant = dataOsMetricVariantDefinitionByKey(observation.metricVariant);
    const grain = observation.periodSemantics === "snapshot"
      ? "snapshot"
      : observation.periodSemantics === "static"
        ? "static"
        : observation.periodGrain === "unknown" ? "observed" : observation.periodGrain;
    definitions.set(observation.metricKey, {
      metric_key: observation.metricKey,
      name: `${variant?.name ?? canonical.name} (${grain})`,
      description: variant
        ? `${variant.name}. ${canonical.description}`
        : canonical.description,
      grain,
      unit: canonical.unit,
      definition: {
        source: "data_observations",
        metric_family: canonical.family,
        metric_variant: observation.metricVariant,
        metric_variant_catalog_status: variant ? "governed" : "canonical_or_source_review",
        source_declared_value: true,
        normalized_unit: canonical.unit,
        valid_range: canonical.validRange ?? null,
        aggregation: "source_grain"
      },
      dimensions: canonical.dimensions
    });
  }
  if (definitions.size === 0) return;

  await pool.query(
    `
      INSERT INTO metric_definitions (
        metric_key, name, description, grain, unit, definition, dimensions, owner_team, status
      )
      SELECT metric_key, name, description, grain, unit, definition, dimensions, 'data', 'active'
      FROM jsonb_to_recordset($1::jsonb) AS metric(
        metric_key text,
        name text,
        description text,
        grain text,
        unit text,
        definition jsonb,
        dimensions jsonb
      )
      ON CONFLICT (metric_key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        grain = EXCLUDED.grain,
        unit = EXCLUDED.unit,
        definition = EXCLUDED.definition,
        dimensions = EXCLUDED.dimensions,
        owner_team = EXCLUDED.owner_team,
        status = 'active',
        updated_at = now()
    `,
    [JSON.stringify(Array.from(definitions.values()))]
  );
}

async function insertDataAssetRecords(args: {
  source: KnowledgeSourceRow;
  corpusId: string;
  dataSourceId: string;
  dataAssetId: string;
  syncRunId: string;
  records: SourceRecord[];
}) {
  let inserted = 0;
  const records = dedupeSourceRecords(args.records);
  for (const batch of chunkArray(records, 1000)) {
    const payload = batch.map((record) => ({
      organization_id: args.source.organization_id,
      brand_id: args.source.brand_id,
      study_corpus_id: args.corpusId,
      data_source_id: args.dataSourceId,
      data_asset_id: args.dataAssetId,
      knowledge_source_id: args.source.id,
      source_sync_run_id: args.syncRunId,
      dataset_key: record.datasetKey,
      dataset_name: record.datasetName,
      dataset_role: record.datasetRole,
      row_index: record.rowIndex,
      record_hash: record.recordHash,
      period_start: record.periodStart,
      period_end: record.periodEnd,
      period_grain: record.periodGrain,
      period_semantics: record.periodSemantics,
      entity_type: record.entityType,
      entity_key: record.entityKey,
      entity_label: record.entityLabel,
      dimensions: record.dimensions,
      record_data: record.rawRecord,
      lineage: {
        ...record.lineage,
        materialized_from: "knowledge_source_worker",
        knowledge_source_id: args.source.id,
        source_sync_run_id: args.syncRunId
      },
      quality_status: record.qualityStatus,
      quality_issues: record.qualityIssues
    }));

    const result = await pool.query(
      `
        INSERT INTO data_asset_records (
          organization_id, brand_id, study_corpus_id, data_source_id, data_asset_id,
          knowledge_source_id, source_sync_run_id, dataset_key, dataset_name, dataset_role,
          row_index, record_hash, period_start, period_end, period_grain, period_semantics,
          entity_type, entity_key, entity_label, dimensions, record_data, lineage,
          quality_status, quality_issues, materialized_at
        )
        SELECT
          organization_id, brand_id, study_corpus_id, data_source_id, data_asset_id,
          knowledge_source_id, source_sync_run_id, dataset_key, dataset_name, dataset_role,
          row_index, record_hash, period_start::date, period_end::date, period_grain, period_semantics,
          entity_type, entity_key, entity_label, dimensions, record_data, lineage,
          quality_status, quality_issues, now()
        FROM jsonb_to_recordset($1::jsonb) AS item(
          organization_id uuid,
          brand_id uuid,
          study_corpus_id uuid,
          data_source_id uuid,
          data_asset_id uuid,
          knowledge_source_id uuid,
          source_sync_run_id uuid,
          dataset_key text,
          dataset_name text,
          dataset_role text,
          row_index integer,
          record_hash text,
          period_start text,
          period_end text,
          period_grain text,
          period_semantics text,
          entity_type text,
          entity_key text,
          entity_label text,
          dimensions jsonb,
          record_data jsonb,
          lineage jsonb,
          quality_status text,
          quality_issues jsonb
        )
        ON CONFLICT ON CONSTRAINT uq_data_asset_records_asset_dataset_row DO UPDATE SET
          source_sync_run_id = EXCLUDED.source_sync_run_id,
          record_hash = EXCLUDED.record_hash,
          dataset_name = EXCLUDED.dataset_name,
          dataset_role = EXCLUDED.dataset_role,
          period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end,
          period_grain = EXCLUDED.period_grain,
          period_semantics = EXCLUDED.period_semantics,
          entity_type = EXCLUDED.entity_type,
          entity_key = EXCLUDED.entity_key,
          entity_label = EXCLUDED.entity_label,
          dimensions = EXCLUDED.dimensions,
          record_data = EXCLUDED.record_data,
          lineage = data_asset_records.lineage || EXCLUDED.lineage,
          quality_status = EXCLUDED.quality_status,
          quality_issues = EXCLUDED.quality_issues,
          materialized_at = now()
      `,
      [JSON.stringify(payload)]
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

function dedupeSourceRecords(records: SourceRecord[]) {
  const byConstraintKey = new Map<string, SourceRecord>();
  for (const record of records) {
    byConstraintKey.set(`${record.datasetKey}::${record.rowIndex}`, record);
  }
  return Array.from(byConstraintKey.values());
}

async function pruneStaleMaterialization(dataAssetId: string, syncRunId: string) {
  await pool.query(
    `
      DELETE FROM data_asset_records
      WHERE data_asset_id = $1
        AND source_sync_run_id IS DISTINCT FROM $2::uuid
    `,
    [dataAssetId, syncRunId]
  );
  await pool.query(
    `
      DELETE FROM data_observations
      WHERE data_asset_id = $1
        AND source_sync_run_id IS DISTINCT FROM $2::uuid
    `,
    [dataAssetId, syncRunId]
  );
}

function buildMaterializationEvidence(
  records: SourceRecord[],
  observations: SourceObservation[],
  insertedRecords: number,
  insertedObservations: number
): SourceMaterializationEvidence {
  const catalogRecords = records.filter((record) => record.datasetRole === "product_catalog");
  return {
    insertedRecords,
    acceptedRecords: records.filter((record) => record.qualityStatus === "accepted").length,
    reviewRecords: records.filter((record) => record.qualityStatus === "needs_mapping_review").length,
    rejectedRecords: records.filter((record) => record.qualityStatus === "rejected").length,
    temporalRecords: records.filter(
      (record) => record.qualityStatus === "accepted"
        && (record.periodSemantics === "measurement" || record.periodSemantics === "event")
    ).length,
    snapshotRecords: records.filter(
      (record) => record.qualityStatus === "accepted" && record.periodSemantics === "snapshot"
    ).length,
    catalogRecords: catalogRecords.length,
    acceptedCatalogIdentityRecords: catalogRecords.filter(
      (record) => record.qualityStatus === "accepted" && Boolean(record.entityKey)
    ).length,
    insertedObservations,
    acceptedObservations: observations.filter((observation) => observation.qualityStatus === "accepted").length,
    reviewObservations: observations.filter((observation) => observation.qualityStatus === "needs_mapping_review").length,
    rejectedObservations: observations.filter((observation) => observation.qualityStatus === "rejected").length,
    temporalObservations: observations.filter(
      (observation) => observation.qualityStatus === "accepted"
        && (observation.periodSemantics === "measurement" || observation.periodSemantics === "event")
    ).length,
    snapshotObservations: observations.filter(
      (observation) => observation.qualityStatus === "accepted"
        && observation.periodSemantics === "snapshot"
    ).length
  };
}

async function insertDataObservations(args: {
  source: KnowledgeSourceRow;
  corpusId: string;
  dataSourceId: string;
  dataAssetId: string;
  syncRunId: string;
  observations: ReturnType<typeof buildSourceObservations>;
}) {
  let inserted = 0;
  const observations = prepareSourceObservationsForUpsert(
    args.observations,
    args.dataSourceId,
    args.dataAssetId
  );
  for (const batch of chunkArray(observations, 1000)) {
    const payload = batch.map((observation) => ({
      organization_id: args.source.organization_id,
      brand_id: args.source.brand_id,
      study_corpus_id: args.corpusId,
      data_source_id: args.dataSourceId,
      data_asset_id: args.dataAssetId,
      knowledge_source_id: args.source.id,
      source_sync_run_id: args.syncRunId,
      dataset_key: observation.datasetKey,
      dataset_name: observation.datasetName,
      dataset_role: observation.datasetRole,
      row_index: observation.rowIndex,
      record_hash: observation.recordHash,
      period_start: observation.periodStart,
      period_end: observation.periodEnd,
      period_grain: observation.periodGrain,
      entity_type: observation.entityType,
      entity_key: observation.entityKey,
      entity_label: observation.entityLabel,
      metric_key: observation.metricKey,
      metric_family: observation.metricFamily,
      metric_value: observation.metricValue,
      metric_unit: observation.metricUnit,
      metric_currency_code: observation.metricCurrencyCode,
      period_semantics: observation.periodSemantics,
      dimensions: observation.dimensions,
      raw_record: observation.rawRecord,
      lineage: {
        ...observation.lineage,
        materialized_from: "knowledge_source_worker",
        knowledge_source_id: args.source.id,
        source_sync_run_id: args.syncRunId
      },
      quality_status: observation.qualityStatus,
      quality_issues: observation.qualityIssues
    }));

    const result = await pool.query(
      `
        INSERT INTO data_observations (
          organization_id, brand_id, study_corpus_id, data_source_id, data_asset_id,
          knowledge_source_id, source_sync_run_id, dataset_key, dataset_name, dataset_role,
          row_index, record_hash, period_start, period_end, period_grain,
          entity_type, entity_key, entity_label, metric_key, metric_family, metric_value,
          metric_unit, metric_currency_code, period_semantics, dimensions, raw_record,
          lineage, quality_status, quality_issues, materialized_at
        )
        SELECT
          organization_id, brand_id, study_corpus_id, data_source_id, data_asset_id,
          knowledge_source_id, source_sync_run_id, dataset_key, dataset_name, dataset_role,
          row_index, record_hash, period_start::date, period_end::date, period_grain,
          entity_type, entity_key, entity_label, metric_key, metric_family, metric_value::numeric,
          metric_unit, metric_currency_code, period_semantics, dimensions, raw_record,
          lineage, quality_status, quality_issues, now()
        FROM jsonb_to_recordset($1::jsonb) AS item(
          organization_id uuid,
          brand_id uuid,
          study_corpus_id uuid,
          data_source_id uuid,
          data_asset_id uuid,
          knowledge_source_id uuid,
          source_sync_run_id uuid,
          dataset_key text,
          dataset_name text,
          dataset_role text,
          row_index integer,
          record_hash text,
          period_start text,
          period_end text,
          period_grain text,
          entity_type text,
          entity_key text,
          entity_label text,
          metric_key text,
          metric_family text,
          metric_value text,
          metric_unit text,
          metric_currency_code text,
          period_semantics text,
          dimensions jsonb,
          raw_record jsonb,
          lineage jsonb,
          quality_status text,
          quality_issues jsonb
        )
        ON CONFLICT ON CONSTRAINT uq_data_observations_source_metric_row DO UPDATE SET
          source_sync_run_id = EXCLUDED.source_sync_run_id,
          record_hash = EXCLUDED.record_hash,
          period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end,
          period_grain = EXCLUDED.period_grain,
          entity_type = EXCLUDED.entity_type,
          entity_key = EXCLUDED.entity_key,
          entity_label = EXCLUDED.entity_label,
          metric_family = EXCLUDED.metric_family,
          metric_value = EXCLUDED.metric_value,
          metric_unit = EXCLUDED.metric_unit,
          metric_currency_code = EXCLUDED.metric_currency_code,
          period_semantics = EXCLUDED.period_semantics,
          dimensions = EXCLUDED.dimensions,
          raw_record = EXCLUDED.raw_record,
          lineage = data_observations.lineage || EXCLUDED.lineage,
          quality_status = EXCLUDED.quality_status,
          quality_issues = EXCLUDED.quality_issues,
          materialized_at = now()
      `,
      [JSON.stringify(payload)]
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function analyzeDataOsMaterializationTables() {
  await pool.query("ANALYZE data_asset_records");
  await pool.query("ANALYZE data_observations");
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
    "- diseñar la primera hipótesis de listening/search/scrapers",
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KNOWLEDGE_ANALYSIS_TIMEOUT_MS);
  try {
    const result = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.1,
      abortSignal: controller.signal
    });

    return normalizeAnalysis(parseJson(result.text));
  } catch (error) {
    console.warn(
      `[knowledge] Claude analysis failed for ${profile.file.name}, using extractive fallback: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return buildExtractiveAnalysis(profile, error);
  } finally {
    clearTimeout(timeout);
  }
}

function buildDataOsSummary(
  profile: WorkbookProfile,
  materialization: Awaited<ReturnType<typeof materializeKnowledgeSourceData>>
) {
  const summary = materialization.summary;
  const datasetRoles = Array.from(new Set(materialization.sourceProfile.datasets.map((dataset) => dataset.semantic_role))).join(", ");
  const period = summary.period_start || summary.period_end
    ? ` Periodo detectado: ${summary.period_start ?? "sin inicio"} a ${summary.period_end ?? "sin fin"}.`
    : "";
  return `${profile.file.name} ya fue perfilado y materializado en Data OS como ${summary.source_record_count} registros canonicos y ${summary.observation_count} observaciones numericas en ${summary.tables.join(", ")}. Estado: ${summary.materialization_status}. Roles detectados: ${datasetRoles || "uploaded_context"}.${period}`;
}

function buildDataOsUnderstanding(
  profile: WorkbookProfile,
  materialization: Awaited<ReturnType<typeof materializeKnowledgeSourceData>>
) {
  const sourceProfile = materialization.sourceProfile;
  const metrics = sourceProfile.source_metrics.slice(0, 10).join(", ") || "sin metricas claras";
  const dimensions = sourceProfile.source_dimensions.slice(0, 10).join(", ") || "sin dimensiones claras";
  const timeAxes = sourceProfile.source_time_axes.slice(0, 6).join(", ") || "sin eje temporal";
  return `Contrato tabular canónico listo: ${profile.workbook.sheet_count} hoja(s), ${sourceProfile.datasets.length} dataset(s), metricas: ${metrics}; dimensiones: ${dimensions}; tiempo: ${timeAxes}.`;
}

function buildDatasetInventory(profile: WorkbookProfile) {
  return profile.sheets.map((sheet) => {
    const role = inferDatasetRole(sheet);
    const materialized = sheet.materialization_rows.length;
    const truncated = sheet.materialization_truncated ? `, truncado desde ${sourceRowCount(sheet)} filas` : "";
    return `${sheet.name}: ${role}, ${sheet.column_count} campos, ${materialized} filas materializadas${truncated}`;
  });
}

function buildProfileQueryLanguage(profile: WorkbookProfile) {
  const textExamples = profile.sheets
    .flatMap((sheet) => sheet.columns)
    .filter((column) => column.inferred_type === "text")
    .flatMap((column) => column.examples)
    .filter((value): value is string => typeof value === "string")
    .slice(0, 36);
  return Array.from(new Set(textExamples.flatMap(extractQueryTerms))).slice(0, 24);
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

function inferProvider(name: string, sourceKind: string) {
  const normalized = normalizeKey(`${name} ${sourceKind}`);
  if (normalized.includes("shopify")) return "shopify";
  if (normalized.includes("vtex")) return "vtex";
  if (normalized.includes("woocommerce")) return "woocommerce";
  if (normalized.includes("magento") || normalized.includes("adobe_commerce")) return "adobe_commerce";
  if (normalized.includes("bigquery")) return "bigquery";
  if (normalized.includes("snowflake")) return "snowflake";
  if (normalized.includes("ga4") || normalized.includes("analytics")) return "google_analytics";
  if (normalized.includes("search_console") || normalized.includes("gsc")) return "google_search_console";
  if (normalized.includes("zendesk")) return "zendesk";
  if (normalized.includes("gorgias")) return "gorgias";
  if (normalized.includes("freshdesk")) return "freshdesk";
  if (normalized.includes("intercom")) return "intercom";
  if (normalized.includes("klaviyo")) return "klaviyo";
  if (normalized.includes("hubspot")) return "hubspot";
  if (normalized.includes("salesforce")) return "salesforce";
  if (normalized.includes("meta") || normalized.includes("facebook") || normalized.includes("instagram")) return "meta";
  if (normalized.includes("tiktok")) return "tiktok";
  if (normalized.includes("google") || normalized.includes("search")) return "google";
  if (normalized.includes("sentione") || normalized.includes("social_listening")) return "social_listening";
  if (normalized.includes("clevertap")) return "clevertap";
  if (normalized.includes("excel") || normalized.includes("xlsx") || normalized.includes("spreadsheet")) return "spreadsheet_upload";
  return "manual_upload";
}

function inferAssetKindFromSource(source: KnowledgeSourceRow) {
  const normalized = normalizeKey(`${source.original_file_name ?? ""} ${source.mime_type ?? ""} ${source.source_kind}`);
  if (normalized.includes("csv")) return "csv";
  if (normalized.includes("xlsx") || normalized.includes("excel") || normalized.includes("spreadsheet")) return "spreadsheet";
  if (normalized.includes("pdf")) return "document";
  return source.source_kind || "uploaded_source";
}

function inferDatasetRole(sheet: SheetProfile) {
  return inferSourceDatasetRole({
    datasetName: sheet.name,
    fieldNames: sheet.headers,
    metricFamilies: sheet.columns.map((column) => inferMetricRole(column.name))
  });
}

function inferColumnSemanticType(column: ColumnProfile, datasetRole?: string | null) {
  const key = normalizeKey(column.name);
  if (isTimeKey(key)) return "time";
  if (isEntityKey(key)) return "entity_key";
  if (inferMetricRole(column.name, datasetRole)) return "metric";
  if (inferDimensionRole(column.name)) return "dimension";
  if (column.inferred_type === "number") return "measure_candidate";
  return "attribute";
}

function inferMetricRole(fieldName: string, datasetRole?: string | null) {
  return inferSourceMetricFamily(fieldName, datasetRole);
}

function inferDimensionRole(fieldName: string) {
  const key = normalizeKey(fieldName);
  if (/\b(categoria|categoría|category|supercategoria|supercategoría|subcategoria|subcategoría)\b/.test(key)) return "category";
  if (/\b(marca|brand)\b/.test(key)) return "brand";
  if (/\b(pais|país|country|mercado|market|region|ciudad|city|estado|state)\b/.test(key)) return "market";
  if (/\b(channel|canal|source|platform|plataforma|medio)\b/.test(key)) return "channel";
  if (/\b(campana|campaña|campaign|adset|ad_group|anuncio)\b/.test(key)) return "campaign";
  if (/\b(product|producto|sku|ean|upc|item)\b/.test(key)) return "product";
  if (/\b(audience|audiencia|segment|segmento|cohort|cohorte)\b/.test(key)) return "audience";
  if (/\b(query|keyword|termino|término|search_term|consulta)\b/.test(key)) return "search_query";
  if (/\b(page|pagina|página|url|landing|screen)\b/.test(key)) return "page";
  if (/\b(order_id|orden_id|pedido_id)\b/.test(key)) return "order";
  if (/\b(ticket_id|case_id|conversation_id|chat_id)\b/.test(key)) return "support_case";
  return null;
}

function isTimeKey(key: string) {
  return /\b(ano|anio|año|year|mes|month|fecha|date|day|dia|día|period|periodo|week|semana)\b/.test(key);
}

function isEntityKey(key: string) {
  return /^(sku($|_)|.*_sku$|ean($|_)|.*_ean$|upc($|_)|.*_upc$|codigo_?bind$|product_id$|producto_id$|campaign_id$|campana_id$|customer_id$|cliente_id$|user_id$|usuario_id$|order_id$|orden_id$|pedido_id$|ticket_id$|case_id$|conversation_id$|query$|keyword$|page_path$|landing_page$)/.test(key);
}

async function resolveDefaultSourceCurrency(
  source: KnowledgeSourceRow,
  corpusId: string
): Promise<MarketCurrencyResolution> {
  const result = await pool.query<{
    corpus_markets: string[] | null;
    brand_markets: string[] | null;
  }>(
    `
      SELECT sc.geo_focus::text[] AS corpus_markets,
             b.countries::text[] AS brand_markets
      FROM study_corpora sc
      LEFT JOIN brands b ON b.id = COALESCE($2::uuid, sc.brand_id)
      WHERE sc.id = $1::uuid
      LIMIT 1
    `,
    [corpusId, source.brand_id]
  );
  const context = result.rows[0];
  const markets = context?.corpus_markets?.length
    ? context.corpus_markets
    : context?.brand_markets ?? [];
  return resolveMarketCurrency(markets);
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "field";
}

function minString(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
}

function maxString(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
    materialization_rows: [],
    materialization_truncated: false,
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
