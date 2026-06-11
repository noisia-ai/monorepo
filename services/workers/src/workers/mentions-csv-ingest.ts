import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import type { Job } from "bullmq";

import { pool } from "../db/client";

type CsvRow = Record<string, string>;

type NormalizedMention = {
  externalId: string;
  textRaw: string;
  textClean: string;
  textSnippet: string;
  title: string | null;
  textLength: number;
  language: string | null;
  publishedAt: Date;
  platform: string;
  contentType: string | null;
  url: string | null;
  country: string | null;
  engagement: Record<string, number>;
  sentimentSource: string | null;
  sentimentScore: string | null;
  inclusionStatus: "included" | "excluded";
  exclusionReason: string | null;
  qualityFlags: Record<string, boolean>;
  rawMetadata: Record<string, unknown>;
  textHash: string;
};

type IngestMentionsCsvJobData = {
  corpusId: string;
  importBatchId: string;
  sourceFileName: string;
  storagePath: string;
  entityLabel?: string | null;
};

type InsertedMentionRow = {
  id: string;
  inclusion_status: string | null;
};

type ImportBatchProvenanceRow = {
  import_batch_id: string;
  study_corpus_id: string;
  query_iteration_id: string | null;
  query_pack_id: string | null;
  mention_type: string | null;
  competitor_id: string | null;
  corpus_entity_id: string | null;
  entity_kind: string | null;
  entity_label: string | null;
  source_system: string | null;
  source_file_name: string | null;
  imported_by_user_id: string | null;
  methodology_slug: string | null;
  query_pack_lens_slug: string | null;
  query_pack_signal_intent: string | null;
  query_pack_scope: string | null;
  query_pack_query_text: string | null;
  query_pack_query_components: Record<string, unknown> | null;
  query_pack_seeds: Record<string, unknown> | null;
  query_text: string | null;
  industry_query_text: string | null;
  competitor_query_text: string | null;
  query_components: Record<string, unknown> | null;
  mentions_returned: number | null;
  quality_score: string | number | null;
  density_score: string | number | null;
  noise_score: string | number | null;
  ai_evaluation_notes: string | null;
  insights_manager_decision: string | null;
  decision_at: Date | string | null;
};

export type CsvImportStats = {
  record_count: number;
  included_count: number;
  excluded_count: number;
  duplicate_count: number;
};

const textKeys = ["text", "content", "body", "mention", "snippet", "description", "post content", "content of posts"];
const titleKeys = ["title", "headline", "subject"];
const dateKeys = ["date", "published at", "published_at", "created at", "created_at", "created", "time"];
const urlKeys = ["url", "link", "source url", "source_url", "link to the source"];
const platformKeys = ["platform", "channel", "network", "social network", "service", "domain group", "source", "source type", "medium", "specific type"];
const contentTypeKeys = ["content type", "type", "source type", "specific type", "media type", "post type", "kind"];
const authorKeys = ["author", "author name", "author_name", "user", "username", "handle"];
const sentimentKeys = ["sentiment", "sentiment label", "sentiment_label"];
const sentimentScoreKeys = ["sentiment score", "sentiment_score", "score"];
const languageKeys = ["language", "lang"];
const countryKeys = ["country", "location country", "country_code"];
const idKeys = ["id", "mention id", "mention_id", "external id", "external_id", "url"];
const engagementKeys = [
  "likes",
  "comments",
  "shares",
  "reposts",
  "views",
  "engagement",
  "interactions",
  "reach"
];

// Larger batch for the streaming path: 500 rows × ~22 cols ≈ 11k params, well
// under Postgres' 65535 limit, and fewer round-trips to the remote pooler.
const STREAM_BATCH_SIZE = 500;

export async function ingestMentionsCsvJob(job: Job<IngestMentionsCsvJobData>) {
  await job.updateProgress(5);
  await pool.query(
    `UPDATE import_batches SET status = 'processing' WHERE id = $1::uuid`,
    [job.data.importBatchId]
  );

  try {
    const webStream = Readable.toWeb(createReadStream(job.data.storagePath)) as unknown as ReadableStream<Uint8Array>;
    const { stats, fileHash: hash } = await ingestSentioneCsvStream({
      corpusId: job.data.corpusId,
      importBatchId: job.data.importBatchId,
      sourceFileName: job.data.sourceFileName,
      entityLabel: job.data.entityLabel ?? null,
      stream: webStream,
      onProgress: async (progress) => {
        const pct = progress.record_count > 0 ? Math.min(90, 10 + Math.floor(progress.record_count / 5000)) : 10;
        await job.updateProgress(pct);
      }
    });

    await pool.query(
      `
        UPDATE import_batches
        SET record_count = $2,
            included_count = $3,
            excluded_count = $4,
            duplicate_count = $5,
            source_file_hash = $6,
            status = 'completed'
        WHERE id = $1::uuid
      `,
      [
        job.data.importBatchId,
        stats.record_count,
        stats.included_count,
        stats.excluded_count,
        stats.duplicate_count,
        hash
      ]
    );
    await job.updateProgress(100);
    return { import_batch_id: job.data.importBatchId, stats };
  } catch (error) {
    await pool.query(
      `UPDATE import_batches SET status = 'failed' WHERE id = $1::uuid`,
      [job.data.importBatchId]
    );
    throw error;
  }
}

// Streaming ingest for very large CSVs (hundreds of MB). The whole-string
// ingestSentioneCsv buffers the file + parsed array in memory and OOMs the
// server on ~0.5GB exports. This variant consumes the upload as a byte stream,
// parses row-by-row, and inserts in bounded batches — memory stays flat
// regardless of file size. It also computes the file hash incrementally.
export async function ingestSentioneCsvStream(params: {
  corpusId: string;
  importBatchId: string;
  sourceFileName: string;
  entityLabel?: string | null;
  stream: ReadableStream<Uint8Array>;
  onProgress?: (stats: CsvImportStats) => void | Promise<void>;
}): Promise<{ stats: CsvImportStats; fileHash: string }> {
  const hash = crypto.createHash("sha256");
  const decoder = new TextDecoder("utf-8");
  const seenHashes = new Set<string>();
  // mentions has TWO unique constraints: (study_corpus_id, text_hash) and
  // (source_system, external_id). ON CONFLICT can only target one, so we also
  // dedup external_id in-file — otherwise a CSV with repeated mention IDs makes
  // the whole batch INSERT fail on uq_mentions_source_external.
  const seenExternalIds = new Set<string>();
  const stats: CsvImportStats = {
    record_count: 0,
    included_count: 0,
    excluded_count: 0,
    duplicate_count: 0
  };

  let normalizedHeader: string[] | null = null;
  let delimiter = "";
  let headBuffer = "";
  let delimiterReady = false;

  // Cross-chunk CSV parser state.
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  let heldQuote = false; // saw a `"`, deferring escaped-vs-toggle decision
  let lastWasCR = false;
  let bomStripped = false;

  // Insert batches concurrently — a single connection to the remote pooler tops
  // out near ~600 rows/s (latency-bound); a handful in parallel reaches a few
  // thousand rows/s, which is what makes ~0.5GB files finish in minutes.
  const INSERT_CONCURRENCY = 6;
  let batch: NormalizedMention[] = [];
  const inFlight = new Set<Promise<void>>();

  function dispatch(rows: NormalizedMention[]) {
    const task = insertMentionChunk(rows, params, stats).finally(() => {
      inFlight.delete(task);
    });
    inFlight.add(task);
  }

  async function dispatchBatch() {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    dispatch(rows);
    if (inFlight.size >= INSERT_CONCURRENCY) await Promise.race(inFlight);
  }

  async function emitRow(cells: string[]) {
    if (normalizedHeader === null) {
      normalizedHeader = cells.map((cssll) => normalizeKey(cssll));
      return;
    }
    if (!cells.some((value) => value.trim().length > 0)) return;
    stats.record_count += 1;
    const header = normalizedHeader;
    const rowObj = header.reduce<CsvRow>((acc, key, index) => {
      acc[key || `column_${index + 1}`] = cells[index]?.trim() ?? "";
      return acc;
    }, {});
    const mention = normalizeMention(rowObj, params.sourceFileName);
    // Dedup on either unique key before it can blow up a batch insert.
    if (seenHashes.has(mention.textHash) || seenExternalIds.has(mention.externalId)) {
      stats.duplicate_count += 1;
      return;
    }
    seenHashes.add(mention.textHash);
    seenExternalIds.add(mention.externalId);
    batch.push(mention);
    if (stats.record_count % 5000 === 0) await params.onProgress?.(stats);
    if (batch.length >= STREAM_BATCH_SIZE) await dispatchBatch();
  }

  async function feed(text: string) {
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index] as string;

      if (!bomStripped) {
        bomStripped = true;
        if (char === "﻿") continue;
      }

      if (heldQuote) {
        heldQuote = false;
        if (char === '"') {
          cell += '"'; // escaped quote ("")
          continue;
        }
        inQuotes = !inQuotes; // the held quote was a real toggle
      }

      if (lastWasCR) {
        lastWasCR = false;
        if (char === "\n") continue; // swallow the \n of a \r\n pair
      }

      if (char === '"') {
        heldQuote = true;
        continue;
      }

      if (!inQuotes && char === delimiter) {
        row.push(cell);
        cell = "";
        continue;
      }

      if (!inQuotes && (char === "\n" || char === "\r")) {
        row.push(cell);
        await emitRow(row);
        row = [];
        cell = "";
        if (char === "\r") lastWasCR = true;
        continue;
      }

      cell += char;
    }
  }

  const reader = params.stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    hash.update(value);
    const text = decoder.decode(value, { stream: true });
    if (text.length === 0) continue;

    if (!delimiterReady) {
      headBuffer += text;
      const newlineIndex = headBuffer.search(/\r|\n/);
      if (newlineIndex >= 0 || headBuffer.length > 16_384) {
        delimiter = detectDelimiter(headBuffer);
        delimiterReady = true;
        const pending = headBuffer;
        headBuffer = "";
        await feed(pending);
      }
      continue;
    }

    await feed(text);
  }

  // Flush decoder + any buffered head that never hit a newline (single-line file).
  const tail = decoder.decode();
  if (!delimiterReady) {
    headBuffer += tail;
    delimiter = detectDelimiter(headBuffer || ",");
    delimiterReady = true;
    await feed(headBuffer);
    headBuffer = "";
  } else if (tail.length > 0) {
    await feed(tail);
  }

  // Resolve a deferred trailing quote and emit the final row if present.
  if (heldQuote) {
    heldQuote = false;
    inQuotes = !inQuotes;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    await emitRow(row);
  }

  if (batch.length > 0) {
    dispatch(batch);
    batch = [];
  }
  await Promise.all(inFlight);

  return { stats, fileHash: hash.digest("hex") };
}

// Shared chunk-insert used by both the buffered and streaming ingest paths.
function toInsertValue(
  m: NormalizedMention,
  params: { corpusId: string; importBatchId: string; entityLabel?: string | null }
) {
  return {
    studyCorpusId: params.corpusId,
    externalId: `${params.corpusId}:${m.externalId}`.slice(0, 500),
    sourceSystem: "sentione_csv",
    sourceFileId: params.importBatchId,
    textHash: m.textHash,
    textRaw: m.textRaw,
    textClean: m.textClean,
    textSnippet: m.textSnippet,
    title: m.title,
    textLength: m.textLength,
    language: m.language,
    publishedAt: m.publishedAt,
    platform: m.platform,
    // Materialized columns for fast Signal aggregates (see migration 0023).
    resolvedPlatform: m.platform,
    contentType: m.contentType,
    batchEntityLabel: params.entityLabel ?? null,
    url: m.url,
    country: m.country,
    engagement: m.engagement,
    sentimentSource: m.sentimentSource,
    sentimentScore: m.sentimentScore,
    qualityScore: m.inclusionStatus === "included" ? 7 : 2,
    inclusionStatus: m.inclusionStatus,
    exclusionReason: m.exclusionReason,
    qualityFlags: m.qualityFlags,
    rawMetadata: m.rawMetadata
  };
}

async function insertMentionChunk(
  chunk: NormalizedMention[],
  params: { corpusId: string; importBatchId: string; entityLabel?: string | null },
  stats: CsvImportStats
) {
  if (chunk.length === 0) return;
  const values = chunk.map((m) => toInsertValue(m, params));

  try {
    const inserted = await insertMentionValues(values);
    const provenanceRows = inserted.length === chunk.length
      ? inserted
      : await findMentionRowsByHashes(params.corpusId, values.map((value) => value.textHash));

    stats.duplicate_count += chunk.length - inserted.length;
    for (const inserted_row of inserted) {
      if (inserted_row.inclusion_status === "included") stats.included_count += 1;
      else stats.excluded_count += 1;
    }
    await attachMentionQueryProvenance({ ...params, insertedMentions: provenanceRows });
  } catch (err) {
    // A batch can fail on the OTHER unique constraint (source_system,
    // external_id) when an id already exists in the DB. Don't lose the whole
    // chunk — retry row by row so only the genuinely conflicting rows are skipped.
    const msg = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160);
    console.warn(`[csv-ingest] batch failed, retrying ${chunk.length} rows individually: ${msg}`);
    const insertedRows: InsertedMentionRow[] = [];
    for (const m of chunk) {
      const value = toInsertValue(m, params);
      try {
        const inserted = await insertMentionValues([value]);
        if (inserted.length === 0) {
          stats.duplicate_count += 1;
          const existing = await findMentionRowsByHashes(params.corpusId, [value.textHash]);
          insertedRows.push(...existing);
        } else if (inserted[0]?.inclusion_status === "included") {
          stats.included_count += 1;
          insertedRows.push(...inserted);
        } else {
          stats.excluded_count += 1;
          insertedRows.push(...inserted);
        }
      } catch {
        // Conflicts with the source/external unique key or a bad row — skip it.
        stats.duplicate_count += 1;
        const existing = await findMentionRowsByHashes(params.corpusId, [value.textHash]);
        insertedRows.push(...existing);
      }
    }
    await attachMentionQueryProvenance({ ...params, insertedMentions: insertedRows });
  }
}

async function findMentionRowsByHashes(corpusId: string, textHashes: string[]): Promise<InsertedMentionRow[]> {
  const hashes = Array.from(new Set(textHashes.filter(Boolean)));
  if (hashes.length === 0) return [];
  const result = await pool.query<InsertedMentionRow>(
    `
      SELECT id, inclusion_status
      FROM mentions
      WHERE study_corpus_id = $1::uuid
        AND text_hash = ANY($2::text[])
    `,
    [corpusId, hashes]
  );
  return result.rows;
}

async function attachMentionQueryProvenance(params: {
  corpusId: string;
  importBatchId: string;
  insertedMentions: InsertedMentionRow[];
}) {
  const mentionIds = params.insertedMentions.map((mention) => mention.id).filter(Boolean);
  if (mentionIds.length === 0) return;

  const batchResult = await pool.query<ImportBatchProvenanceRow>(
    `
      SELECT
        ib.id AS import_batch_id,
        ib.study_corpus_id,
        ib.query_iteration_id,
        ib.query_pack_id,
        ib.mention_type,
        ib.competitor_id,
        ib.corpus_entity_id,
        ib.entity_kind,
        ib.entity_label,
        ib.source_system,
        ib.source_file_name,
        ib.imported_by_user_id,
        m.slug AS methodology_slug,
        qp.lens_slug AS query_pack_lens_slug,
        qp.signal_intent AS query_pack_signal_intent,
        qp.scope AS query_pack_scope,
        qp.query_text AS query_pack_query_text,
        qp.query_components AS query_pack_query_components,
        qp.seeds AS query_pack_seeds,
        qi.query_text,
        qi.industry_query_text,
        qi.competitor_query_text,
        qi.query_components,
        qi.mentions_returned,
        qi.quality_score,
        qi.density_score,
        qi.noise_score,
        qi.ai_evaluation_notes,
        qi.insights_manager_decision,
        qi.decision_at
      FROM import_batches ib
      JOIN study_corpora sc ON sc.id = ib.study_corpus_id
      LEFT JOIN methodologies m ON m.id = sc.methodology_id
      LEFT JOIN query_iterations qi ON qi.id = ib.query_iteration_id
      LEFT JOIN query_packs qp ON qp.id = ib.query_pack_id
      WHERE ib.id = $1::uuid
        AND ib.study_corpus_id = $2::uuid
      LIMIT 1
    `,
    [params.importBatchId, params.corpusId]
  );
  const batch = batchResult.rows[0];
  if (!batch) return;

  const scope = batch.query_pack_scope || resolveQueryScope(batch);
  const signalIntent = batch.query_pack_signal_intent || resolveSignalIntent(scope);
  const lensSlug = batch.query_pack_lens_slug || batch.methodology_slug || "triggers-barriers";
  const queryPackId = batch.query_pack_id ?? (await getOrCreateQueryPack(batch, {
    lensSlug,
    scope,
    signalIntent,
    queryText: batch.query_pack_query_text || resolveQueryText(batch, scope)
  }));
  if (!queryPackId) {
    throw new Error(`Could not create query pack provenance for import batch ${batch.import_batch_id}.`);
  }

  const metadata = {
    source: "csv_ingest",
    source_system: batch.source_system,
    source_file_name: batch.source_file_name,
    mention_type: batch.mention_type,
    entity_kind: batch.entity_kind,
    entity_label: batch.entity_label,
    primary_query_pack_id: queryPackId,
    query_pack_lens_slug: batch.query_pack_lens_slug,
    query_pack_signal_intent: batch.query_pack_signal_intent,
    query_pack_scope: batch.query_pack_scope,
    fanout_strategy: "same_iteration_same_scope"
  };

  await pool.query(
    `
      WITH target_packs AS (
        SELECT id, query_iteration_id, lens_slug, signal_intent, scope
        FROM query_packs
        WHERE study_corpus_id = $2::uuid
          AND scope = $6
          AND (
            id = $3::uuid
            OR (
              (query_iteration_id IS NULL AND $4::uuid IS NULL)
              OR query_iteration_id = $4::uuid
            )
          )
      ),
      inserted_links AS (
        INSERT INTO mention_query_sources (
          mention_id,
          study_corpus_id,
          query_pack_id,
          query_iteration_id,
          import_batch_id,
          lens_slug,
          signal_intent,
          scope,
          corpus_entity_id,
          entity_id,
          match_quality,
          match_reason,
          metadata
        )
        SELECT
          inserted.mention_id,
          $2::uuid,
          tp.id,
          tp.query_iteration_id,
          $5::uuid,
          tp.lens_slug,
          tp.signal_intent,
          tp.scope,
          $7::uuid,
          $8,
          CASE WHEN tp.id = $3::uuid THEN 1.000 ELSE 0.700 END,
          CASE WHEN tp.id = $3::uuid THEN 'csv_import_batch' ELSE 'csv_import_scope_fanout' END,
          $9::jsonb
        FROM unnest($1::uuid[]) AS inserted(mention_id)
        CROSS JOIN target_packs tp
        ON CONFLICT DO NOTHING
        RETURNING mention_id, query_pack_id
      ),
      link_counts AS (
        SELECT query_pack_id, COUNT(*)::int AS linked_count
        FROM inserted_links
        JOIN mentions m ON m.id = inserted_links.mention_id
        WHERE query_pack_id IS NOT NULL
          AND m.inclusion_status = 'included'
        GROUP BY query_pack_id
      )
      UPDATE query_packs qp
      SET mentions_returned = COALESCE(qp.mentions_returned, 0) + lc.linked_count,
          status = 'imported',
          updated_at = now()
      FROM link_counts lc
      WHERE qp.id = lc.query_pack_id
    `,
    [
      mentionIds,
      batch.study_corpus_id,
      queryPackId,
      batch.query_iteration_id,
      batch.import_batch_id,
      scope,
      batch.corpus_entity_id,
      resolveEntityId(batch, scope),
      JSON.stringify(metadata)
    ]
  );
}

async function getOrCreateQueryPack(
  batch: ImportBatchProvenanceRow,
  input: { lensSlug: string; scope: string; signalIntent: string; queryText: string | null }
) {
  const existing = await findQueryPack(batch, input);
  if (existing) return existing;

  const seeds = {
    source: "csv_ingest",
    mention_type: batch.mention_type,
    entity_kind: batch.entity_kind,
    entity_label: batch.entity_label,
    query_iteration_id: batch.query_iteration_id
  };
  const evaluation = {
    source: "query_iteration",
    query_iteration_mentions_returned: batch.mentions_returned,
    ai_evaluation_notes: batch.ai_evaluation_notes,
    insights_manager_decision: batch.insights_manager_decision
  };

  const inserted = await pool.query<{ id: string }>(
    `
      INSERT INTO query_packs (
        study_corpus_id,
        query_iteration_id,
        lens_slug,
        signal_intent,
        scope,
        objective,
        query_text,
        query_components,
        seeds,
        evaluation,
        status,
        mentions_returned,
        quality_score,
        density_score,
        noise_score,
        created_by_user_id,
        evaluated_at,
        approved_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb,
        $9::jsonb,
        $10::jsonb,
        'imported',
        0,
        $11::numeric,
        $12::numeric,
        $13::numeric,
        $14::uuid,
        $15::timestamptz,
        $15::timestamptz
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [
      batch.study_corpus_id,
      batch.query_iteration_id,
      input.lensSlug,
      input.signalIntent,
      input.scope,
      `Imported CSV provenance for ${input.scope} / ${input.signalIntent}`,
      input.queryText,
      JSON.stringify(batch.query_components ?? {}),
      JSON.stringify(seeds),
      JSON.stringify(evaluation),
      batch.quality_score,
      batch.density_score,
      batch.noise_score,
      batch.imported_by_user_id,
      batch.decision_at
    ]
  );

  return inserted.rows[0]?.id ?? (await findQueryPack(batch, input));
}

async function findQueryPack(
  batch: ImportBatchProvenanceRow,
  input: { lensSlug: string; scope: string; signalIntent: string }
) {
  const existing = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM query_packs
      WHERE study_corpus_id = $1::uuid
        AND lens_slug = $3
        AND signal_intent = $4
        AND scope = $5
        AND (
          (query_iteration_id IS NULL AND $2::uuid IS NULL)
          OR query_iteration_id = $2::uuid
        )
      LIMIT 1
    `,
    [batch.study_corpus_id, batch.query_iteration_id, input.lensSlug, input.signalIntent, input.scope]
  );

  return existing.rows[0]?.id ?? null;
}

function resolveQueryScope(batch: ImportBatchProvenanceRow) {
  if (batch.mention_type === "brand") return "brand";
  if (batch.mention_type === "competitor") return "competitors";
  if (batch.mention_type === "industry") return "category";
  if (batch.entity_kind === "primary_brand") return "brand";
  if (batch.entity_kind === "competitor") return "competitors";
  if (batch.entity_kind === "category") return "category";
  return "source";
}

function resolveSignalIntent(scope: string) {
  if (scope === "brand") return "decision_signal";
  if (scope === "competitors") return "competitive_signal";
  if (scope === "category") return "category_signal";
  return "source_upload";
}

function resolveQueryText(batch: ImportBatchProvenanceRow, scope: string) {
  if (scope === "competitors") return batch.competitor_query_text || batch.query_text;
  if (scope === "category") return batch.industry_query_text || batch.query_text;
  return batch.query_text;
}

function resolveEntityId(batch: ImportBatchProvenanceRow, scope: string) {
  if (batch.corpus_entity_id) return `corpus_entity:${batch.corpus_entity_id}`;
  if (batch.competitor_id) return `competitor:${batch.competitor_id}`;
  if (batch.entity_label) return `${batch.entity_kind || scope}:${slugify(batch.entity_label)}`;
  return null;
}

type InsertMentionValue = ReturnType<typeof toInsertValue>;

const mentionInsertColumns = [
  ["study_corpus_id", "studyCorpusId"],
  ["external_id", "externalId"],
  ["source_system", "sourceSystem"],
  ["source_file_id", "sourceFileId"],
  ["text_hash", "textHash"],
  ["text_raw", "textRaw"],
  ["text_clean", "textClean"],
  ["text_snippet", "textSnippet"],
  ["title", "title"],
  ["text_length", "textLength"],
  ["language", "language"],
  ["published_at", "publishedAt"],
  ["platform", "platform"],
  ["resolved_platform", "resolvedPlatform"],
  ["content_type", "contentType"],
  ["batch_entity_label", "batchEntityLabel"],
  ["url", "url"],
  ["country", "country"],
  ["engagement", "engagement"],
  ["sentiment_source", "sentimentSource"],
  ["sentiment_score", "sentimentScore"],
  ["quality_score", "qualityScore"],
  ["inclusion_status", "inclusionStatus"],
  ["exclusion_reason", "exclusionReason"],
  ["quality_flags", "qualityFlags"],
  ["raw_metadata", "rawMetadata"]
] as const satisfies ReadonlyArray<readonly [string, keyof InsertMentionValue]>;

async function insertMentionValues(values: InsertMentionValue[]) {
  if (values.length === 0) return [];

  const params: unknown[] = [];
  const tuples = values.map((value) => {
    const placeholders = mentionInsertColumns.map(([, key]) => {
      const rawValue = value[key];
      params.push(
        key === "engagement" || key === "qualityFlags" || key === "rawMetadata"
          ? JSON.stringify(rawValue)
          : rawValue
      );
      return `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const result = await pool.query<{ id: string; inclusion_status: string }>(
    `
      INSERT INTO mentions (${mentionInsertColumns.map(([column]) => column).join(", ")})
      VALUES ${tuples.join(", ")}
      ON CONFLICT (study_corpus_id, text_hash) DO NOTHING
      RETURNING id, inclusion_status
    `,
    params
  );

  return result.rows;
}

function normalizeMention(row: CsvRow, sourceFileName: string): NormalizedMention {
  const textRaw = pick(row, textKeys) || pick(row, titleKeys) || "";
  const textClean = cleanText(textRaw);
  const textHash = hashText(textClean);
  const title = pick(row, titleKeys) || null;
  const publishedAt = parseDate(pick(row, dateKeys)) ?? new Date(0);
  const url = pick(row, urlKeys) || null;
  const platform = normalizePlatform(row, url);
  const contentType = normalizeContentType(pick(row, contentTypeKeys));
  const sentimentSource = normalizeSentiment(pick(row, sentimentKeys));
  const sentimentScore = parseSentimentScore(pick(row, sentimentScoreKeys) || sentimentSource);
  const country = normalizeCountry(pick(row, countryKeys));
  const language = normalizeLanguage(pick(row, languageKeys));
  const tooShort = textClean.length < 30;

  return {
    externalId: buildExternalId(row, textHash),
    textRaw,
    textClean,
    textSnippet: textClean.slice(0, 220),
    title,
    textLength: textClean.length,
    language,
    publishedAt,
    platform,
    contentType,
    url,
    country,
    engagement: extractEngagement(row),
    sentimentSource,
    sentimentScore,
    inclusionStatus: tooShort ? "excluded" : "included",
    exclusionReason: tooShort ? "text_under_30_chars" : null,
    qualityFlags: {
      text_under_30_chars: tooShort,
      missing_date: publishedAt.getTime() === 0,
      missing_platform: platform === "unknown"
    },
    rawMetadata: {
      source_file_name: sourceFileName,
      author: pick(row, authorKeys) || null,
      content_type: contentType,
      row
    },
    textHash
  };
}

function detectDelimiter(input: string) {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons >= commas ? ";" : ",";
}

function pick(row: CsvRow, keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeKey(key)];
    if (value) {
      return value;
    }
  }

  return "";
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

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function hashText(text: string) {
  return crypto.createHash("sha256").update(text.toLowerCase()).digest("hex");
}

function buildExternalId(row: CsvRow, textHash: string) {
  const sourceId = pick(row, idKeys);
  return sourceId ? sourceId.slice(0, 500) : `csv_${textHash.slice(0, 24)}`;
}

function parseDate(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePlatform(row: CsvRow, url: string | null) {
  const haystack = [
    url ?? "",
    ...platformKeys.map((key) => pick(row, [key])),
    ...Object.values(row)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const known = detectKnownPlatform(haystack);
  if (known) return known;

  const candidate = pick(row, platformKeys);
  const normalized = normalizeToken(candidate);
  if (!normalized || isContentTypeToken(normalized)) return "unknown";
  return normalized;
}

function detectKnownPlatform(value: string) {
  const rules: Array<[RegExp, string]> = [
    [/\btik\s*tok\b|tiktok\.com|douyin/i, "tiktok"],
    [/\btwitter\b|\bx\b|x\.com|twitter\.com/i, "x"],
    [/\binstagram\b|instagram\.com/i, "instagram"],
    [/\bfacebook\b|facebook\.com|fb\.com/i, "facebook"],
    [/\byoutube\b|youtu\.be|youtube\.com/i, "youtube"],
    [/\breddit\b|reddit\.com/i, "reddit"],
    [/\blinkedin\b|linkedin\.com/i, "linkedin"],
    [/\bthreads\b|threads\.net/i, "threads"],
    [/\btelegram\b|t\.me/i, "telegram"],
    [/\bwhatsapp\b|wa\.me/i, "whatsapp"],
    [/\btrustpilot\b|trustpilot\./i, "trustpilot"],
    [/\bgoogle\b|google\./i, "google"],
    [/\bnews\b|newspaper|article|press|media outlet/i, "news"],
    [/\bblog\b|blogspot|wordpress|medium\.com/i, "blog"],
    [/\bforum\b|community/i, "forum"]
  ];
  return rules.find(([regex]) => regex.test(value))?.[1] ?? null;
}

function normalizeContentType(value: string) {
  const token = normalizeToken(value);
  return token || null;
}

function normalizeToken(value: string) {
  return value
    ? value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    : "";
}

function isContentTypeToken(value: string) {
  return /^(comment|comments|comentario|comentarios|video|short|shorts|post|posts|tweet|tweets|article|articles|news|reel|reels|story|stories|image|photo|photos|forum_post)$/.test(value);
}

function normalizeSentiment(value: string) {
  return value ? value.toLowerCase() : null;
}

function parseSentimentScore(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  const numeric = Number(normalized.replace(",", "."));

  if (Number.isFinite(numeric)) {
    return String(Math.max(-1, Math.min(1, numeric)));
  }

  if (normalized.includes("positive") || normalized.includes("positivo")) {
    return "1";
  }

  if (normalized.includes("negative") || normalized.includes("negativo")) {
    return "-1";
  }

  if (normalized.includes("neutral")) {
    return "0";
  }

  return null;
}

function normalizeCountry(value: string) {
  return value ? value.trim().slice(0, 2).toUpperCase() : null;
}

function normalizeLanguage(value: string) {
  return value ? value.trim().slice(0, 2).toLowerCase() : null;
}

function extractEngagement(row: CsvRow) {
  return engagementKeys.reduce<Record<string, number>>((acc, key) => {
    const value = row[normalizeKey(key)];
    const parsed = Number(value?.replace(/,/g, ""));

    if (Number.isFinite(parsed)) {
      acc[normalizeKey(key).replace(/\s+/g, "_")] = parsed;
    }

    return acc;
  }, {});
}
