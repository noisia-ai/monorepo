import crypto from "node:crypto";

import type { Pool } from "pg";

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
  providerObservation: TypedProviderObservation | null;
};

type TypedProviderObservation = {
  providerSchemaVersion: "sentione-csv-47-v1";
  providerHeaderHash: string;
  providerRecordKeyHash: string;
  observationHash: string;
  providerProjectRefHash: string | null;
  platform: string;
  publicDomain: string | null;
  providerDomainCategory: string | null;
  providerSourceType: string | null;
  providerContentType: string | null;
  providerThreadKeyHash: string | null;
  threadRole: "root" | "reply" | "unknown";
  languageCode: string | null;
  countryCode: string | null;
  publishedAt: string;
  providerCollectedAt: string | null;
  providerSentimentLabel: string | null;
  providerSentimentScore: number | null;
  ratingValue: number | null;
  influenceScore: number | null;
  engagement: Record<string,number | null>;
  authorRefHash: string | null;
  terms: Array<{ kind: "provider-tag" | "provider-keyword";ordinal: number;value: string;hash: string;normalized: string }>;
};

type InsertedMentionRow = {
  id: string;
  text_hash: string;
  provider_record_id: string | null;
  inclusion_status: string | null;
  already_in_batch: boolean;
  ingestion_disposition: "included" | "excluded" | "duplicate" | null;
  predecessor_disposition: "included" | "excluded" | "duplicate" | null;
};

type ImportBatchProvenanceRow = {
  import_batch_id: string;
  study_corpus_id: string | null;
  query_iteration_id: string | null;
  query_pack_id: string | null;
  query_validation_run_id: string | null;
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
  query_pack_entity_key: string | null;
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

export type CsvImportPerformanceMetrics = {
  chunk_count: number;
  query_count: number;
  total_ms: number;
  persistence_ms: number;
  classification: {
    inserted_this_attempt: number;
    resumed_before_attempt: number;
    existing_from_other_import: number;
    duplicate_inside_file: number;
  };
};

type WorkspaceCsvIngestionScope = {
  workspaceId: string;
  dataSourceId: string;
  corpusId?: string | null;
  importBatchId: string;
  entityLabel?: string | null;
  supersedesImportBatchId?: string | null;
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

export const SENTIONE_CSV_47_HEADERS_V1 = [
  "id","Specific type","Title","Author","Author id","Content of posts","Created",
  "Added to system","Context","Link to the source","Domain","Sentiment","Sentiment points",
  "Domain group","Tag","Keywords","Gender","Project name","Domain category","influenceScore",
  "Total interactions","comments","views","shares","wow","love","like","haha","sad","angry",
  "thankful","uniqueVievs","fans","Facebook page category","retweet","favs","hearts","likes",
  "dislikes","followers","Geolocation","Language","Country","Rating","Thread ID","Replied","Liked"
] as const;

export function resolveSignalSentioneProviderHeaderContractV1(header:string[]) {
  const normalized=header.map(normalizeProviderHeaderV1);
  const expected=SENTIONE_CSV_47_HEADERS_V1.map(normalizeProviderHeaderV1);
  if(normalized.length!==expected.length||normalized.some((value,index)=>value!==expected[index]))return null;
  return {
    version:"sentione-csv-47-v1" as const,
    hash:signalSentioneProviderHeaderHashV1(header)
  };
}
export function signalSentioneProviderHeaderHashV1(header:string[]){
  return`sha256:${crypto.createHash("sha256").update(header.map(normalizeProviderHeaderV1).join("\u001f")).digest("hex")}`;
}
function normalizeProviderHeaderV1(value:string){return value.trim().toLowerCase().replace(/^\ufeff/u,"")
  .replace(/[_-]+/g," ").replace(/\s+/g," ");}

// Larger batch for the streaming path: 500 rows × ~22 cols ≈ 11k params, well
// under Postgres' 65535 limit, and fewer round-trips to the remote pooler.
const STREAM_BATCH_SIZE = 500;

/**
 * Canonical SentiOne CSV parser, normalizer and mention persistence adapter.
 * Studio and Workers inject their own pool but execute this single implementation.
 */
export function createSignalSentioneCsvIngester(pool: Pick<Pool, "query">) {
  // Streaming ingest for very large CSVs (hundreds of MB). The whole-string
  // ingestSentioneCsv buffers the file + parsed array in memory and OOMs the
  // server on ~0.5GB exports. This variant consumes the upload as a byte stream,
  // parses row-by-row, and inserts in bounded batches — memory stays flat
  // regardless of file size. It also computes the file hash incrementally.
  async function ingestSentioneCsvStream(params: {
    workspaceId: string;
    dataSourceId: string;
    corpusId?: string | null;
    importBatchId: string;
    sourceFileName: string;
    entityLabel?: string | null;
    supersedesImportBatchId?: string | null;
    tuning?: { chunkSize?: number;insertConcurrency?: number };
    stream: ReadableStream<Uint8Array>;
    onProgress?: (stats: CsvImportStats,processedBytes: number) => void | Promise<void>;
  }): Promise<{ stats: CsvImportStats; fileHash: string;metrics: CsvImportPerformanceMetrics }> {
    const startedAt = performance.now();
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
    const metrics: CsvImportPerformanceMetrics = {
      chunk_count: 0,query_count: 0,total_ms: 0,persistence_ms: 0,
      classification: {
        inserted_this_attempt: 0,resumed_before_attempt: 0,
        existing_from_other_import: 0,duplicate_inside_file: 0
      }
    };

    let normalizedHeader: string[] | null = null;
    let providerHeaderContract: { version: "sentione-csv-47-v1";hash: string } | null = null;
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
    let processedBytes = 0;

    // Insert batches concurrently — a single connection to the remote pooler tops
    // out near ~600 rows/s (latency-bound); a handful in parallel reaches a few
    // thousand rows/s, which is what makes ~0.5GB files finish in minutes.
    const insertConcurrency = boundedInteger(params.tuning?.insertConcurrency,6,1,12);
    const chunkSize = boundedInteger(params.tuning?.chunkSize,STREAM_BATCH_SIZE,1,1000);
    let batch: NormalizedMention[] = [];
    const inFlight = new Set<Promise<void>>();

    function dispatch(rows: NormalizedMention[]) {
      const task = insertMentionChunk(rows,params,stats,metrics).finally(() => {
        inFlight.delete(task);
      });
      inFlight.add(task);
    }

    async function dispatchBatch() {
      if (batch.length === 0) return;
      const rows = batch;
      batch = [];
      dispatch(rows);
      if (inFlight.size>=insertConcurrency) await Promise.race(inFlight);
    }

    async function emitRow(cells: string[]) {
      if (normalizedHeader === null) {
        normalizedHeader = cells.map((cssll) => normalizeKey(cssll));
        providerHeaderContract = resolveSentioneHeaderContractV1(normalizedHeader);
        await pool.query(`UPDATE import_batches SET provider_observation_projection_state=$4,
          provider_observation_header_hash=$5,provider_observation_count=0
          WHERE id=$1::uuid AND workspace_id=$2::uuid AND data_source_id=$3::uuid
            AND acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2')
            AND status IN ('queued','processing')`,[params.importBatchId,params.workspaceId,
          params.dataSourceId,providerHeaderContract?"ready":"not_available",
          signalSentioneProviderHeaderHashV1(normalizedHeader)]);
        metrics.query_count+=1;
        return;
      }
      if (!cells.some((value) => value.trim().length > 0)) return;
      stats.record_count += 1;
      const header = normalizedHeader;
      const rowObj = header.reduce<CsvRow>((acc, key, index) => {
        acc[key || `column_${index + 1}`] = cells[index]?.trim() ?? "";
        return acc;
      }, {});
      const mention = normalizeMention(rowObj, params.sourceFileName,providerHeaderContract);
      // Dedup on either unique key before it can blow up a batch insert.
      if (seenHashes.has(mention.textHash) || seenExternalIds.has(mention.externalId)) {
        stats.duplicate_count += 1;
        metrics.classification.duplicate_inside_file+=1;
        return;
      }
      seenHashes.add(mention.textHash);
      seenExternalIds.add(mention.externalId);
      batch.push(mention);
      if (batch.length>=chunkSize) await dispatchBatch();
      if (stats.record_count % 500 === 0) {
        try { await params.onProgress?.(stats,processedBytes); }
        catch (error) {
          await Promise.allSettled(inFlight);
          throw error;
        }
      }
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
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        processedBytes += value.byteLength;
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
      await pool.query(`UPDATE import_batches batch SET provider_observation_count=(
          SELECT count(*)::int FROM signal_provider_mention_observations observation
          WHERE observation.import_batch_id=batch.id AND observation.workspace_id=batch.workspace_id
        ) WHERE batch.id=$1::uuid AND batch.workspace_id=$2::uuid
          AND batch.data_source_id=$3::uuid
          AND batch.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2')
          AND batch.status IN ('queued','processing')`,[
        params.importBatchId,params.workspaceId,params.dataSourceId]);
      metrics.query_count+=1;
      await params.onProgress?.(stats,processedBytes);

      metrics.total_ms=Math.round((performance.now()-startedAt)*1000)/1000;
      return { stats,fileHash: hash.digest("hex"),metrics };
    } catch (error) {
      // Abort the upstream object download when parsing or persistence fails. Without
      // this, a large TUS object can keep occupying the HTTP connection after the
      // batch is already marked failed and can starve an immediate recovery retry.
      await reader.cancel(error).catch(() => undefined);
      await Promise.allSettled(inFlight);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  // Shared chunk-insert used by both the buffered and streaming ingest paths.
  function toInsertValue(
    m: NormalizedMention,
    params: WorkspaceCsvIngestionScope
  ) {
    const mentionId = crypto.randomUUID();
    return {
      id: mentionId,
      workspaceId: params.workspaceId,
      studyCorpusId: params.corpusId ?? null,
      dataSourceId: params.dataSourceId,
      canonicalMentionId: mentionId,
      providerRecordId: m.externalId,
      externalId: `${params.workspaceId}:${m.externalId}`.slice(0, 500),
      sourceSystem: "listening_csv",
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
      ,providerObservation: m.providerObservation
    };
  }

  async function insertMentionChunk(
    chunk: NormalizedMention[],
    params: WorkspaceCsvIngestionScope,
    stats: CsvImportStats,
    metrics: CsvImportPerformanceMetrics
  ) {
    if (chunk.length === 0) return;
    const startedAt=performance.now();
    metrics.chunk_count+=1;
    const values = chunk.map((m) => toInsertValue(m, params));

    // Resolve the pre-attempt state before inserting. This is the boundary that
    // prevents rows inserted below from being mistaken for resumed rows.
    const before=await findCanonicalMentionRows(
      params.workspaceId,params.importBatchId,params.supersedesImportBatchId ?? null,values
    );
    metrics.query_count+=1;
    const beforeByValue=mapCanonicalRows(values,before);
    const candidates=values.filter((value)=>!beforeByValue.has(value.id));
    const inserted=await insertMentionValues(candidates);
    metrics.query_count+=candidates.length>0 ? 1 : 0;
    const insertedIds=new Set(inserted.map((row)=>row.id));
    const after=await findCanonicalMentionRows(
      params.workspaceId,params.importBatchId,params.supersedesImportBatchId ?? null,values
    );
    metrics.query_count+=1;
    const afterByValue=mapCanonicalRows(values,after);
    const classified: InsertedMentionRow[]=[];
    for (const value of values) {
      const canonical=afterByValue.get(value.id);
      if (!canonical) throw new Error("Workspace import canonical root was not resolved set-wise.");
      const prior=beforeByValue.get(value.id);
      let disposition: "included" | "excluded" | "duplicate";
      if (insertedIds.has(canonical.id)) {
        disposition=value.inclusionStatus==="included" ? "included" : "excluded";
        metrics.classification.inserted_this_attempt+=1;
      } else if (prior?.already_in_batch) {
        if (!prior.ingestion_disposition) {
          throw new Error("Workspace import disposition is unavailable during resume.");
        }
        disposition=prior.ingestion_disposition;
        metrics.classification.resumed_before_attempt+=1;
      } else if (prior?.predecessor_disposition) {
        disposition=prior.predecessor_disposition;
        metrics.classification.resumed_before_attempt+=1;
      } else {
        disposition="duplicate";
        metrics.classification.existing_from_other_import+=1;
      }
      if (disposition==="included") stats.included_count+=1;
      else if (disposition==="excluded") stats.excluded_count+=1;
      else stats.duplicate_count+=1;
      classified.push({ ...canonical,ingestion_disposition: disposition });
    }
    const provenanceQueryCount=await attachMentionQueryProvenance({
      ...params,insertedMentions: classified
    });
    metrics.query_count+=provenanceQueryCount;
    const typedCount=await insertTypedProviderObservationsV1({
      workspaceId:params.workspaceId,dataSourceId:params.dataSourceId,
      importBatchId:params.importBatchId,values,canonicalByValue:afterByValue
    });
    metrics.query_count+=typedCount>0?1:0;
    metrics.persistence_ms+=Math.round((performance.now()-startedAt)*1000)/1000;
  }

  async function findCanonicalMentionRows(
    workspaceId: string,
    importBatchId: string,
    supersedesImportBatchId: string | null,
    values: Array<{ textHash: string; providerRecordId: string }>
  ): Promise<InsertedMentionRow[]> {
    const hashes = Array.from(new Set(values.map((value) => value.textHash).filter(Boolean)));
    const providerRecordIds = Array.from(new Set(
      values.map((value) => value.providerRecordId).filter(Boolean)
    ));
    if (hashes.length === 0 && providerRecordIds.length === 0) return [];
    const result = await pool.query<InsertedMentionRow>(
      `
        SELECT mention.id,mention.text_hash,mention.provider_record_id,
          mention.inclusion_status,
          EXISTS (
            SELECT 1
            FROM signal_mention_import_memberships membership
            WHERE membership.workspace_id=$1::uuid
              AND membership.mention_id=mention.id
              AND membership.import_batch_id=$2::uuid
          ) AS already_in_batch,
          (
            SELECT membership.ingestion_disposition
            FROM signal_mention_import_memberships membership
            WHERE membership.workspace_id=$1::uuid
              AND membership.mention_id=mention.id
              AND membership.import_batch_id=$2::uuid
          ) AS ingestion_disposition
          ,(
            SELECT predecessor.ingestion_disposition
            FROM signal_mention_import_memberships predecessor
            WHERE predecessor.workspace_id=$1::uuid
              AND predecessor.mention_id=mention.id
              AND predecessor.import_batch_id=$5::uuid
          ) AS predecessor_disposition
        FROM mentions mention
        WHERE mention.workspace_id = $1::uuid
          AND mention.canonical_mention_id = mention.id
          AND (
            mention.text_hash = ANY($3::text[])
            OR mention.provider_record_id = ANY($4::text[])
          )
      `,
      [workspaceId,importBatchId,hashes,providerRecordIds,supersedesImportBatchId]
    );
    return result.rows;
  }

  function mapCanonicalRows(
    values: Array<{ id: string;textHash: string;providerRecordId: string }>,
    rows: InsertedMentionRow[]
  ) {
    const mapped=new Map<string,InsertedMentionRow>();
    for (const value of values) {
      const matches=rows.filter((row)=>row.text_hash===value.textHash
        || row.provider_record_id===value.providerRecordId);
      const identities=new Map(matches.map((row)=>[row.id,row]));
      if (identities.size>1) {
        throw new Error("Workspace import canonical keys resolve to different roots.");
      }
      const canonical=matches[0];
      if (canonical) mapped.set(value.id,canonical);
    }
    return mapped;
  }

  async function attachMentionQueryProvenance(params: {
    workspaceId: string;
    corpusId?: string | null;
    importBatchId: string;
    insertedMentions: InsertedMentionRow[];
  }): Promise<number> {
    const mentionIds = Array.from(new Set(
      params.insertedMentions.map((mention) => mention.id).filter(Boolean)
    ));
    if (mentionIds.length === 0) return 0;
    let queryCount=0;

    const byMention = new Map<string,"included" | "excluded" | "duplicate">();
    for (const mention of params.insertedMentions) {
      const disposition = mention.already_in_batch
        ? mention.ingestion_disposition
        : mention.ingestion_disposition ?? "duplicate";
      if (!disposition) throw new Error("Workspace import disposition is unavailable.");
      const prior=byMention.get(mention.id);
      if (prior && prior!==disposition) {
        throw new Error("Workspace import disposition conflicts inside one chunk.");
      }
      byMention.set(mention.id,disposition);
    }
    const dispositions=mentionIds.map((mentionId)=>byMention.get(mentionId)!);

    await pool.query(
      `
        SELECT record_signal_workspace_import_provenance_set_v1(
          $2::uuid,$1::uuid[],$3::text[]
        )
      `,
      [mentionIds,params.importBatchId,dispositions]
    );
    queryCount+=1;
    if (!params.corpusId) return queryCount;

    const batchResult = await pool.query<ImportBatchProvenanceRow>(
      `
        SELECT
          ib.id AS import_batch_id,
          ib.study_corpus_id,
          ib.query_iteration_id,
          ib.query_pack_id,
          ib.query_validation_run_id,
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
          qp.entity_key AS query_pack_entity_key,
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
    queryCount+=1;
    const batch = batchResult.rows[0];
    if (!batch) return queryCount;

    const scope = batch.query_pack_scope || resolveQueryScope(batch);
    const signalIntent = batch.query_pack_signal_intent || resolveSignalIntent(scope);
    const lensSlug = batch.query_pack_lens_slug || batch.methodology_slug || "triggers-barriers";
    const entityKey = batch.query_pack_id
      ? batch.query_pack_entity_key
      : batch.query_pack_entity_key || resolveQueryPackEntityKey(batch, scope);
    const queryPackId = batch.query_pack_id ?? (await getOrCreateQueryPack(batch, {
      lensSlug,
      scope,
      signalIntent,
      entityKey,
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
      query_validation_run_id: batch.query_validation_run_id,
      query_pack_lens_slug: batch.query_pack_lens_slug,
      query_pack_signal_intent: batch.query_pack_signal_intent,
      query_pack_scope: batch.query_pack_scope,
      query_pack_entity_key: entityKey,
      fanout_strategy: entityKey ? "same_iteration_same_entity" : "primary_pack_only"
    };

    await pool.query(
      `
        WITH target_packs AS (
          SELECT id, query_iteration_id, lens_slug, signal_intent, scope, entity_key
          FROM query_packs
          WHERE study_corpus_id = $2::uuid
            AND scope = $6
            AND (
              id = $3::uuid
              OR (
                $10::text IS NOT NULL
                AND entity_key = $10
                AND (
                  (query_iteration_id IS NULL AND $4::uuid IS NULL)
                  OR query_iteration_id = $4::uuid
                )
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
        JSON.stringify(metadata),
        entityKey
      ]
    );
    queryCount+=1;
    return queryCount;
  }

  async function getOrCreateQueryPack(
    batch: ImportBatchProvenanceRow,
    input: { lensSlug: string; scope: string; signalIntent: string; entityKey: string | null; queryText: string | null }
  ) {
    const existing = await findQueryPack(batch, input);
    if (existing) return existing;

    const seeds = {
      ...(batch.query_pack_seeds ?? {}),
      source: "csv_ingest",
      mention_type: batch.mention_type,
      entity_kind: batch.entity_kind,
      entity_label: batch.entity_label,
      query_iteration_id: batch.query_iteration_id,
      query_validation_run_id: batch.query_validation_run_id
    };
    const evaluation = {
      source: "query_iteration",
      query_iteration_mentions_returned: batch.mentions_returned,
      query_validation_run_id: batch.query_validation_run_id,
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
          entity_key,
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
          $8,
          $9::jsonb,
          $10::jsonb,
          $11::jsonb,
          'imported',
          0,
          $12::numeric,
          $13::numeric,
          $14::numeric,
          $15::uuid,
          $16::timestamptz,
          $16::timestamptz
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
        input.entityKey,
        `Imported CSV provenance for ${input.scope} / ${input.signalIntent}`,
        input.queryText,
        JSON.stringify(batch.query_pack_query_components ?? batch.query_components ?? {}),
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
    input: { lensSlug: string; scope: string; signalIntent: string; entityKey: string | null }
  ) {
    const existing = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM query_packs
        WHERE study_corpus_id = $1::uuid
          AND lens_slug = $3
          AND signal_intent = $4
          AND scope = $5
          AND COALESCE(entity_key, '') = COALESCE($6, '')
          AND (
            (query_iteration_id IS NULL AND $2::uuid IS NULL)
            OR query_iteration_id = $2::uuid
          )
        LIMIT 1
      `,
      [batch.study_corpus_id, batch.query_iteration_id, input.lensSlug, input.signalIntent, input.scope, input.entityKey]
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
    if (batch.query_pack_query_text?.trim()) return batch.query_pack_query_text.trim();
    if (scope === "competitors") return batch.competitor_query_text || batch.query_text;
    if (scope === "category") return batch.industry_query_text || batch.query_text;
    return batch.query_text;
  }

  function resolveQueryPackEntityKey(batch: ImportBatchProvenanceRow, scope: string) {
    const componentKey = batch.query_pack_query_components?.entity_key
      ?? batch.query_components?.entity_key;
    if (typeof componentKey === "string" && componentKey.trim()) return componentKey.trim();
    if (scope === "brand") return "brand";
    if (scope === "category" || scope === "baseline") return scope;
    if (scope === "competitors" && batch.entity_label) return `competitor:${slugify(batch.entity_label)}`;
    return null;
  }

  function resolveEntityId(batch: ImportBatchProvenanceRow, scope: string) {
    if (batch.corpus_entity_id) return `corpus_entity:${batch.corpus_entity_id}`;
    if (batch.competitor_id) return `competitor:${batch.competitor_id}`;
    if (batch.entity_label) return `${batch.entity_kind || scope}:${slugify(batch.entity_label)}`;
    return null;
  }

  function boundedInteger(
    value: number | undefined,fallback: number,minimum: number,maximum: number
  ) {
    return Number.isSafeInteger(value) && value!>=minimum && value!<=maximum
      ? value! : fallback;
  }

  type InsertMentionValue = ReturnType<typeof toInsertValue>;

  const mentionInsertColumns = [
    ["id", "id"],
    ["workspace_id", "workspaceId"],
    ["study_corpus_id", "studyCorpusId"],
    ["data_source_id", "dataSourceId"],
    ["canonical_mention_id", "canonicalMentionId"],
    ["provider_record_id", "providerRecordId"],
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
        ON CONFLICT DO NOTHING
        RETURNING id, inclusion_status
      `,
      params
    );

    return result.rows;
  }

  function normalizeMention(row: CsvRow, sourceFileName: string,
    headerContract: { version: "sentione-csv-47-v1";hash: string } | null): NormalizedMention {
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

    const externalId=buildExternalId(row,textHash);
    const providerObservation=headerContract
      ? mapSentioneTypedObservationV1(row,{ externalId,platform,publishedAt,
          sentimentSource,headerHash:headerContract.hash }) : null;
    return {
      externalId,
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
      textHash,
      providerObservation
    };
  }

  async function insertTypedProviderObservationsV1(args: {
    workspaceId:string;dataSourceId:string;importBatchId:string;
    values:Array<InsertMentionValue>;canonicalByValue:Map<string,InsertedMentionRow>;
  }) {
    const rows=args.values.flatMap((value)=>{
      const observation=value.providerObservation;
      const canonical=args.canonicalByValue.get(value.id);
      return observation&&canonical?[{...observation,id:crypto.randomUUID(),mentionId:canonical.id}]:[];
    });
    if(rows.length===0)return 0;
    await pool.query(`
      WITH input AS (
        SELECT * FROM jsonb_to_recordset($4::jsonb) AS row(
          id uuid,mention_id uuid,provider_record_key_hash text,provider_header_hash text,
          observation_hash text,provider_project_ref_hash text,platform text,public_domain text,
          provider_domain_category text,provider_source_type text,provider_content_type text,
          provider_thread_key_hash text,thread_role text,language_code text,country_code text,
          published_at timestamptz,provider_collected_at timestamptz,
          provider_sentiment_label text,provider_sentiment_score numeric,rating_value numeric,
          influence_score numeric,engagement jsonb,author_ref_hash text,terms jsonb
        )
      ), authority AS (
        SELECT batch.*,binding.id provenance_binding_id,binding.definition_hash rights_definition_hash,
          retention.retain_until retention_until
        FROM import_batches batch
        LEFT JOIN LATERAL(
          SELECT candidate.* FROM signal_provenance_policy_bindings candidate
          WHERE candidate.workspace_id=batch.workspace_id AND candidate.data_source_id=batch.data_source_id
            AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
            AND candidate.status='active' AND candidate.effective_from<=clock_timestamp()
            AND (candidate.effective_to IS NULL OR candidate.effective_to>clock_timestamp())
          ORDER BY candidate.import_batch_id IS NOT NULL DESC,candidate.binding_version DESC LIMIT 1
        ) binding ON true
        LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        WHERE batch.id=$3::uuid AND batch.workspace_id=$1::uuid AND batch.data_source_id=$2::uuid
      ), inserted AS (
        INSERT INTO signal_provider_mention_observations(
          id,workspace_id,data_source_id,import_batch_id,mention_id,provider_key,
          provider_record_key_hash,acquisition_plan_id,acquisition_slot_id,
          acquisition_query_version_id,acquisition_plan_digest,acquisition_slot_digest,
          acquisition_query_digest,provider_schema_version,provider_header_hash,
          observation_version,observation_hash,provider_project_ref_hash,platform,public_domain,
          provider_domain_category,provider_source_type,provider_content_type,
          provider_thread_key_hash,thread_role,language_code,country_code,published_at,
          provider_collected_at,provider_sentiment_label,provider_sentiment_score,rating_value,
          influence_score,engagement_total,comments_count,views_count,shares_count,
          reaction_wow_count,reaction_love_count,reaction_like_count,reaction_haha_count,
          reaction_sad_count,reaction_angry_count,reaction_thankful_count,unique_views_count,
          fans_count,repost_count,favorites_count,hearts_count,likes_count,dislikes_count,
          followers_count,author_ref_hash,provenance_binding_id,rights_definition_hash,retention_until
        ) SELECT input.id,authority.workspace_id,authority.data_source_id,authority.id,input.mention_id,
          'sentione',input.provider_record_key_hash,authority.acquisition_plan_id,
          authority.acquisition_slot_id,authority.acquisition_query_version_id,
          authority.acquisition_plan_digest,authority.acquisition_slot_digest,
          authority.acquisition_query_digest,'sentione-csv-47-v1',input.provider_header_hash,
          1,input.observation_hash,input.provider_project_ref_hash,input.platform,input.public_domain,
          input.provider_domain_category,input.provider_source_type,input.provider_content_type,
          input.provider_thread_key_hash,input.thread_role,input.language_code,input.country_code,
          input.published_at,input.provider_collected_at,input.provider_sentiment_label,
          input.provider_sentiment_score,input.rating_value,input.influence_score,
          (input.engagement->>'engagement_total')::bigint,(input.engagement->>'comments_count')::bigint,
          (input.engagement->>'views_count')::bigint,(input.engagement->>'shares_count')::bigint,
          (input.engagement->>'reaction_wow_count')::bigint,(input.engagement->>'reaction_love_count')::bigint,
          (input.engagement->>'reaction_like_count')::bigint,(input.engagement->>'reaction_haha_count')::bigint,
          (input.engagement->>'reaction_sad_count')::bigint,(input.engagement->>'reaction_angry_count')::bigint,
          (input.engagement->>'reaction_thankful_count')::bigint,(input.engagement->>'unique_views_count')::bigint,
          (input.engagement->>'fans_count')::bigint,(input.engagement->>'repost_count')::bigint,
          (input.engagement->>'favorites_count')::bigint,(input.engagement->>'hearts_count')::bigint,
          (input.engagement->>'likes_count')::bigint,(input.engagement->>'dislikes_count')::bigint,
          (input.engagement->>'followers_count')::bigint,input.author_ref_hash,
          authority.provenance_binding_id,authority.rights_definition_hash,authority.retention_until
        FROM input CROSS JOIN authority ON CONFLICT DO NOTHING RETURNING id
      ), resolved AS (
        SELECT observation.id,input.terms FROM input JOIN signal_provider_mention_observations observation
          ON observation.import_batch_id=$3::uuid
         AND observation.provider_record_key_hash=input.provider_record_key_hash
         AND observation.observation_version=1
      )
      INSERT INTO signal_provider_mention_observation_terms(
        observation_id,workspace_id,term_kind,ordinal,term_private,term_hash,normalized_term
      ) SELECT resolved.id,$1::uuid,term->>'kind',(term->>'ordinal')::int,term->>'value',
        term->>'hash',term->>'normalized' FROM resolved
      CROSS JOIN LATERAL jsonb_array_elements(resolved.terms) term ON CONFLICT DO NOTHING
    `,[args.workspaceId,args.dataSourceId,args.importBatchId,JSON.stringify(rows.map((row)=>({
      id:row.id,mention_id:row.mentionId,provider_record_key_hash:row.providerRecordKeyHash,
      provider_header_hash:row.providerHeaderHash,observation_hash:row.observationHash,
      provider_project_ref_hash:row.providerProjectRefHash,platform:row.platform,
      public_domain:row.publicDomain,provider_domain_category:row.providerDomainCategory,
      provider_source_type:row.providerSourceType,provider_content_type:row.providerContentType,
      provider_thread_key_hash:row.providerThreadKeyHash,thread_role:row.threadRole,
      language_code:row.languageCode,country_code:row.countryCode,published_at:row.publishedAt,
      provider_collected_at:row.providerCollectedAt,provider_sentiment_label:row.providerSentimentLabel,
      provider_sentiment_score:row.providerSentimentScore,rating_value:row.ratingValue,
      influence_score:row.influenceScore,engagement:row.engagement,author_ref_hash:row.authorRefHash,
      terms:row.terms
    })))]);
    return rows.length;
  }

  function resolveSentioneHeaderContractV1(header:string[]) {
    return resolveSignalSentioneProviderHeaderContractV1(header);
  }

  function mapSentioneTypedObservationV1(row:CsvRow,input:{
    externalId:string;platform:string;publishedAt:Date;sentimentSource:string|null;headerHash:string;
  }):TypedProviderObservation {
    const number=(key:string)=>parseProviderNumber(pick(row,[key]));
    const hashPrivate=(value:string)=>value?`sha256:${crypto.createHash("sha256").update(value).digest("hex")}`:null;
    const terms:Array<{kind:"provider-tag"|"provider-keyword";ordinal:number;value:string;hash:string;normalized:string}>=[];
    for(const [kind,key] of [["provider-tag","Tag"],["provider-keyword","Keywords"]] as const){
      const values=splitProviderTerms(pick(row,[key]));
      values.forEach((value,ordinal)=>{const normalized=normalizeProviderTerm(value);terms.push({kind,ordinal,value,
        hash:`sha256:${crypto.createHash("sha256").update(normalized).digest("hex")}`,normalized});});
    }
    const engagement:Record<string,number|null>={
      engagement_total:number("Total interactions"),comments_count:number("comments"),
      views_count:number("views"),shares_count:number("shares"),reaction_wow_count:number("wow"),
      reaction_love_count:number("love"),reaction_like_count:number("like"),reaction_haha_count:number("haha"),
      reaction_sad_count:number("sad"),reaction_angry_count:number("angry"),
      reaction_thankful_count:number("thankful"),unique_views_count:number("uniqueVievs"),
      fans_count:number("fans"),repost_count:number("retweet"),favorites_count:number("favs"),
      hearts_count:number("hearts"),likes_count:number("likes"),dislikes_count:number("dislikes"),
      followers_count:number("followers")
    };
    const publicDomain=normalizePublicDomain(pick(row,["Domain"]));
    const collected=parseDate(pick(row,["Added to system"]));
    const safePayload={provider_schema_version:"sentione-csv-47-v1",provider_header_hash:input.headerHash,
      provider_record_key_hash:hashPrivate(input.externalId),provider_project_ref_hash:hashPrivate(pick(row,["Project name"])),
      platform:input.platform,public_domain:publicDomain,provider_domain_category:cleanOptional(pick(row,["Domain category"]),200),
      provider_source_type:cleanOptional(pick(row,["Domain group"]),120),
      provider_content_type:cleanOptional(pick(row,["Specific type"]),120),
      provider_thread_key_hash:hashPrivate(pick(row,["Thread ID"])),thread_role:"unknown" as const,
      language_code:normalizeLanguage(pick(row,["Language"])),country_code:normalizeCountry(pick(row,["Country"])),
      published_at:input.publishedAt.toISOString(),provider_collected_at:collected?.toISOString()??null,
      provider_sentiment_label:input.sentimentSource,provider_sentiment_score:number("Sentiment points"),
      rating_value:number("Rating"),influence_score:number("influenceScore"),engagement,
      author_ref_hash:hashPrivate(pick(row,["Author id"])||pick(row,["Author"])),
      terms:terms.map(({kind,ordinal,hash,normalized})=>({kind,ordinal,hash,normalized}))};
    return {
      providerSchemaVersion:"sentione-csv-47-v1",providerHeaderHash:input.headerHash,
      providerRecordKeyHash:safePayload.provider_record_key_hash!,
      observationHash:`sha256:${crypto.createHash("sha256").update(typedStable(safePayload)).digest("hex")}`,
      providerProjectRefHash:safePayload.provider_project_ref_hash,platform:input.platform,
      publicDomain,providerDomainCategory:safePayload.provider_domain_category,
      providerSourceType:safePayload.provider_source_type,providerContentType:safePayload.provider_content_type,
      providerThreadKeyHash:safePayload.provider_thread_key_hash,threadRole:"unknown",
      languageCode:safePayload.language_code,countryCode:safePayload.country_code,
      publishedAt:safePayload.published_at,providerCollectedAt:safePayload.provider_collected_at,
      providerSentimentLabel:input.sentimentSource,providerSentimentScore:safePayload.provider_sentiment_score,
      ratingValue:safePayload.rating_value,influenceScore:safePayload.influence_score,engagement,
      authorRefHash:safePayload.author_ref_hash,terms
    };
  }

  function mapSignalSentioneProviderObservationV1(header:string[],cells:string[]){
    const contract=resolveSentioneHeaderContractV1(header);
    if(!contract||cells.length!==header.length)return null;
    const row=header.reduce<CsvRow>((output,key,index)=>{
      output[normalizeKey(key)]=cells[index]?.trim()??"";return output;
    },{});
    const url=pick(row,urlKeys)||null;
    const publishedAt=parseDate(pick(row,dateKeys))??new Date(0);
    const externalId=pick(row,idKeys)||`fixture-${contract.hash}`;
    return mapSentioneTypedObservationV1(row,{externalId,
      platform:normalizePlatform(row,url),publishedAt,
      sentimentSource:normalizeSentiment(pick(row,sentimentKeys)),headerHash:contract.hash});
  }

  function parseProviderNumber(value:string){
    if(!value.trim())return null;
    const normalized=value.trim().replace(/\s/gu,"").replace(/,(?=\d{1,2}$)/u,".").replace(/,/gu,"");
    const parsed=Number(normalized);return Number.isFinite(parsed)&&Math.abs(parsed)<=Number.MAX_SAFE_INTEGER?parsed:null;
  }
  function splitProviderTerms(value:string){return [...new Set(value.split(/[,|\n]+/gu).map((term)=>term.trim()).filter(Boolean))].slice(0,500);}
  function normalizeProviderTerm(value:string){return value.normalize("NFKC").trim().replace(/\s+/gu," ").toLowerCase().slice(0,1000);}
  function normalizePublicDomain(value:string){
    const clean=value.trim().toLowerCase().replace(/^https?:\/\//u,"").split("/")[0]?.replace(/^www\./u,"")??"";
    return /^[a-z0-9.-]+\.[a-z]{2,}$/u.test(clean)?clean.slice(0,255):null;
  }
  function cleanOptional(value:string,max:number){const clean=value.trim().replace(/[\r\n\t]+/gu," ");return clean?clean.slice(0,max):null;}
  function typedStable(value:unknown):string{
    if(Array.isArray(value))return`[${value.map(typedStable).join(",")}]`;
    if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,entry])=>`${JSON.stringify(key)}:${typedStable(entry)}`).join(",")}}`;
    return JSON.stringify(value);
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


  return { ingestSentioneCsvStream,mapSignalSentioneProviderObservationV1 };
}
