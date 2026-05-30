CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "semantic_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "snapshot_id" uuid REFERENCES "corpus_snapshots"("id") ON DELETE CASCADE,
  "scope_type" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" uuid,
  "mention_id" uuid REFERENCES "mentions"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL DEFAULT 0,
  "chunk_text" text NOT NULL,
  "chunk_hash" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "embedding_model" text NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "semantic_embeddings_scope_type"
    CHECK ("scope_type" IN ('knowledge_source', 'mention')),
  CONSTRAINT "semantic_embeddings_source_kind"
    CHECK ("source_kind" IN ('brand_knowledge_source', 'corpus_mention'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_semantic_embedding_knowledge_chunk"
  ON "semantic_embeddings"("source_id", "chunk_hash", "embedding_model")
  WHERE "scope_type" = 'knowledge_source';

CREATE UNIQUE INDEX IF NOT EXISTS "uq_semantic_embedding_mention_chunk"
  ON "semantic_embeddings"("mention_id", "chunk_hash", "embedding_model")
  WHERE "scope_type" = 'mention';

CREATE INDEX IF NOT EXISTS "idx_semantic_embeddings_corpus_scope"
  ON "semantic_embeddings"("study_corpus_id", "scope_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_semantic_embeddings_brand_scope"
  ON "semantic_embeddings"("brand_id", "scope_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_semantic_embeddings_snapshot"
  ON "semantic_embeddings"("snapshot_id", "scope_type");

CREATE INDEX IF NOT EXISTS "idx_semantic_embeddings_vector_cosine"
  ON "semantic_embeddings"
  USING hnsw ("embedding" vector_cosine_ops);
