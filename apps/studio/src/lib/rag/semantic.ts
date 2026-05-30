import { embedTexts, getEmbeddingModel, hasEmbeddingProvider, vectorLiteral } from "@noisia/query-engine";
import { pool } from "@/lib/db";

export type SemanticMatch = {
  source_type: "knowledge_source" | "mention";
  source_id: string | null;
  mention_id: string | null;
  title: string | null;
  text: string;
  similarity: number;
  platform: string | null;
  published_at: string | null;
  metadata: Record<string, unknown>;
};

type SemanticMatchRow = {
  source_type: "knowledge_source" | "mention";
  source_id: string | null;
  mention_id: string | null;
  title: string | null;
  text: string;
  similarity: number;
  platform: string | null;
  published_at: string | null;
  metadata: unknown;
};

export async function retrieveSignalSemanticContext(args: {
  outputId: string;
  query: string;
  limit?: number;
}): Promise<{ matches: SemanticMatch[]; embeddingAvailable: boolean }> {
  const query = args.query.trim();
  if (!query) return { matches: [], embeddingAvailable: hasEmbeddingProvider() };
  if (!hasEmbeddingProvider()) return { matches: [], embeddingAvailable: false };

  const embeddingModel = getEmbeddingModel();
  const [embedded] = await embedTexts({
    inputs: [{ id: "query", text: query.slice(0, 4000) }],
    batchSize: 1,
    inputType: "query",
    model: embeddingModel
  });
  if (!embedded) return { matches: [], embeddingAvailable: false };

  const limit = Math.min(Math.max(args.limit ?? 12, 1), 30);
  const result = await pool.query<SemanticMatchRow>(
    `
      WITH output_scope AS (
        SELECT
          po.id AS output_id,
          po.study_corpus_id,
          po.brand_id,
          ta.snapshot_id
        FROM published_outputs po
        JOIN tb_analyses ta ON ta.id = po.tb_analysis_id
        WHERE po.id = $1::uuid
          AND po.status = 'published'
          AND po.archived_at IS NULL
        LIMIT 1
      ),
      ranked AS (
        SELECT
          se.scope_type AS source_type,
          se.source_id,
          se.mention_id,
          se.chunk_text AS text,
          se.metadata,
          1 - (se.embedding <=> $2::vector) AS similarity
        FROM semantic_embeddings se
        JOIN output_scope os ON os.study_corpus_id = se.study_corpus_id
        WHERE se.embedding_model = $4
          AND (
          se.scope_type = 'knowledge_source'
          OR (
            se.scope_type = 'mention'
            AND EXISTS (
              SELECT 1
              FROM corpus_snapshot_mentions csm
              WHERE csm.snapshot_id = os.snapshot_id
                AND csm.mention_id = se.mention_id
            )
          )
        )
        ORDER BY se.embedding <=> $2::vector
        LIMIT $3
      )
      SELECT
        r.source_type,
        r.source_id,
        r.mention_id,
        COALESCE(bks.title, m.title, r.metadata->>'title') AS title,
        r.text,
        r.similarity::float AS similarity,
        m.platform,
        m.published_at::text,
        r.metadata
      FROM ranked r
      LEFT JOIN brand_knowledge_sources bks ON bks.id = r.source_id
      LEFT JOIN mentions m ON m.id = r.mention_id
      ORDER BY r.similarity DESC
    `,
    [args.outputId, vectorLiteral(embedded.embedding), limit, embeddingModel]
  );

  return {
    embeddingAvailable: true,
    matches: result.rows.map((row) => ({
      source_type: row.source_type,
      source_id: row.source_id,
      mention_id: row.mention_id,
      title: row.title,
      text: row.text,
      similarity: Number(row.similarity ?? 0),
      platform: row.platform,
      published_at: row.published_at,
      metadata: recordValue(row.metadata)
    }))
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
