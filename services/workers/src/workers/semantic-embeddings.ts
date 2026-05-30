import type { Job } from "bullmq";

import {
  DEFAULT_EMBEDDING_MODEL,
  embedTexts,
  chunkForEmbedding,
  getEmbeddingModel,
  getEmbeddingProvider,
  hasEmbeddingProvider,
  hashEmbeddingChunk,
  vectorLiteral
} from "@noisia/query-engine";
import { pool } from "../db/client";

type SemanticEmbeddingJobData = {
  corpusId: string;
  sourceIds?: string[];
  mode?: "knowledge" | "mentions" | "all";
};

type KnowledgeSourceRow = {
  id: string;
  organization_id: string | null;
  brand_id: string | null;
  study_corpus_id: string;
  source_kind: string;
  title: string;
  raw_text: string | null;
  extracted_payload: unknown;
};

type MentionRow = {
  id: string;
  organization_id: string | null;
  brand_id: string | null;
  study_corpus_id: string;
  text_clean: string;
  text_snippet: string | null;
  platform: string;
  published_at: string;
};

type PendingChunk = {
  id: string;
  scopeType: "knowledge_source" | "mention";
  sourceKind: "brand_knowledge_source" | "corpus_mention";
  organizationId: string | null;
  brandId: string | null;
  corpusId: string;
  sourceId: string | null;
  mentionId: string | null;
  chunkIndex: number;
  chunkText: string;
  chunkHash: string;
  metadata: Record<string, unknown>;
};

const EMBEDDING_PROVIDER = getEmbeddingProvider();
const EMBEDDING_MODEL = getEmbeddingModel(EMBEDDING_PROVIDER) ?? DEFAULT_EMBEDDING_MODEL;
const KNOWLEDGE_CHUNK_MAX = 1400;
const MENTION_CHUNK_MAX = 900;
const MAX_MENTIONS_PER_JOB = Number.parseInt(process.env.SEMANTIC_MENTION_EMBED_LIMIT ?? "50000", 10);
const INSERT_BATCH_SIZE = 80;

export async function semanticEmbeddingsJob(job: Job<SemanticEmbeddingJobData>) {
  const mode = job.data.mode ?? "all";
  if (!hasEmbeddingProvider()) {
    return {
      skipped: true,
      reason: "Embedding provider missing; configure VOYAGE_API_KEY or OPENAI_API_KEY.",
      corpus_id: job.data.corpusId
    };
  }

  await job.updateProgress(5);

  let knowledge = { chunks: 0, inserted: 0 };
  let mentions = { chunks: 0, inserted: 0 };

  if (mode === "knowledge" || mode === "all") {
    knowledge = await embedKnowledgeSources(job.data.corpusId, job.data.sourceIds);
  }
  await job.updateProgress(mode === "knowledge" ? 100 : 45);

  if (mode === "mentions" || mode === "all") {
    mentions = await embedCorpusMentions(job.data.corpusId);
  }

  await job.updateProgress(100);
  return {
    corpus_id: job.data.corpusId,
    model: EMBEDDING_MODEL,
    knowledge,
    mentions
  };
}

export async function embedKnowledgeSources(corpusId: string, sourceIds?: string[]) {
  const params: unknown[] = [corpusId];
  const sourceFilter = sourceIds && sourceIds.length > 0
    ? `AND bks.id = ANY($${params.push(sourceIds)}::uuid[])`
    : "";
  const result = await pool.query<KnowledgeSourceRow>(
    `
      SELECT
        bks.id,
        bks.organization_id,
        bks.brand_id,
        bks.study_corpus_id,
        bks.source_kind,
        bks.title,
        bks.raw_text,
        bks.extracted_payload
      FROM brand_knowledge_sources bks
      WHERE bks.study_corpus_id = $1
        AND bks.status IN ('processed', 'processed_truncated')
        ${sourceFilter}
      ORDER BY bks.created_at DESC
      LIMIT 200
    `,
    params
  );

  const chunks: PendingChunk[] = [];
  for (const source of result.rows) {
    const text = renderKnowledgeSourceForEmbedding(source);
    const parts = chunkForEmbedding(text, { maxChars: KNOWLEDGE_CHUNK_MAX, overlapChars: 180 });
    parts.forEach((chunkText, index) => {
      chunks.push({
        id: `knowledge:${source.id}:${index}`,
        scopeType: "knowledge_source",
        sourceKind: "brand_knowledge_source",
        organizationId: source.organization_id,
        brandId: source.brand_id,
        corpusId: source.study_corpus_id,
        sourceId: source.id,
        mentionId: null,
        chunkIndex: index,
        chunkText,
        chunkHash: hashEmbeddingChunk(chunkText),
        metadata: {
          title: source.title,
          source_kind: source.source_kind,
          source_type: recordValue(source.extracted_payload).source_type ?? null
        }
      });
    });
  }

  return persistEmbeddingChunks(chunks);
}

export async function embedCorpusMentions(corpusId: string) {
  const limit = Number.isFinite(MAX_MENTIONS_PER_JOB) && MAX_MENTIONS_PER_JOB > 0
    ? Math.min(MAX_MENTIONS_PER_JOB, 50000)
    : 50000;
  const result = await pool.query<MentionRow>(
    `
      SELECT
        m.id,
        b.organization_id,
        sc.brand_id,
        m.study_corpus_id,
        m.text_clean,
        m.text_snippet,
        m.platform,
        m.published_at::text
      FROM mentions m
      JOIN study_corpora sc ON sc.id = m.study_corpus_id
      LEFT JOIN brands b ON b.id = sc.brand_id
      WHERE m.study_corpus_id = $1
        AND m.inclusion_status = 'included'
        AND NOT EXISTS (
          SELECT 1
          FROM semantic_embeddings se
          WHERE se.scope_type = 'mention'
            AND se.mention_id = m.id
            AND se.embedding_model = $2
        )
      ORDER BY m.published_at DESC
      LIMIT ${limit}
    `,
    [corpusId, EMBEDDING_MODEL]
  );

  const chunks = result.rows.flatMap((mention) => {
    const text = mention.text_clean || mention.text_snippet || "";
    return chunkForEmbedding(text, { maxChars: MENTION_CHUNK_MAX, overlapChars: 0 }).slice(0, 1).map((chunkText, index) => ({
      id: `mention:${mention.id}:${index}`,
      scopeType: "mention" as const,
      sourceKind: "corpus_mention" as const,
      organizationId: mention.organization_id,
      brandId: mention.brand_id,
      corpusId: mention.study_corpus_id,
      sourceId: null,
      mentionId: mention.id,
      chunkIndex: index,
      chunkText,
      chunkHash: hashEmbeddingChunk(chunkText),
      metadata: {
        platform: mention.platform,
        published_at: mention.published_at
      }
    }));
  });

  return persistEmbeddingChunks(chunks);
}

async function persistEmbeddingChunks(chunks: PendingChunk[]) {
  if (chunks.length === 0) return { chunks: 0, inserted: 0 };

  let inserted = 0;
  for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
    const slice = chunks.slice(i, i + INSERT_BATCH_SIZE);
    const embedded = await embedTexts({
      inputs: slice.map((chunk) => ({ id: chunk.id, text: chunk.chunkText })),
      model: EMBEDDING_MODEL,
      batchSize: 64,
      inputType: "document"
    });
    const embeddedById = new Map(embedded.map((item) => [item.id, item.embedding]));
    const values: unknown[] = [];
    const tuples: string[] = [];

    slice.forEach((chunk) => {
      const embedding = embeddedById.get(chunk.id);
      if (!embedding) return;
      const base = values.length;
      values.push(
        chunk.organizationId,
        chunk.brandId,
        chunk.corpusId,
        chunk.scopeType,
        chunk.sourceKind,
        chunk.sourceId,
        chunk.mentionId,
        chunk.chunkIndex,
        chunk.chunkText,
        chunk.chunkHash,
        JSON.stringify(chunk.metadata),
        EMBEDDING_MODEL,
        vectorLiteral(embedding)
      );
      tuples.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, NULL, $${base + 4}, $${base + 5}, $${base + 6}::uuid, $${base + 7}::uuid, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}::jsonb, $${base + 12}, $${base + 13}::vector)`
      );
    });

    if (tuples.length === 0) continue;
    const result = await pool.query(
      `
        INSERT INTO semantic_embeddings (
          organization_id,
          brand_id,
          study_corpus_id,
          snapshot_id,
          scope_type,
          source_kind,
          source_id,
          mention_id,
          chunk_index,
          chunk_text,
          chunk_hash,
          metadata,
          embedding_model,
          embedding
        )
        VALUES ${tuples.join(",")}
        ON CONFLICT DO NOTHING
      `,
      values
    );
    inserted += result.rowCount ?? 0;
  }

  return { chunks: chunks.length, inserted };
}

function renderKnowledgeSourceForEmbedding(source: KnowledgeSourceRow) {
  const payload = recordValue(source.extracted_payload);
  const parts = [
    `Title: ${source.title}`,
    `Kind: ${source.source_kind}`,
    stringValue(payload.summary) ? `Summary: ${stringValue(payload.summary)}` : "",
    Array.isArray(payload.dataset_inventory) ? `Dataset inventory: ${payload.dataset_inventory.join("; ")}` : "",
    Array.isArray(payload.recommended_use) ? `Recommended use: ${payload.recommended_use.join("; ")}` : "",
    source.raw_text ?? ""
  ];
  return parts.filter(Boolean).join("\n\n");
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
