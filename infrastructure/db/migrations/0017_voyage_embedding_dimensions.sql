DROP INDEX IF EXISTS "idx_semantic_embeddings_vector_cosine";

TRUNCATE TABLE "semantic_embeddings";

ALTER TABLE "semantic_embeddings"
  ALTER COLUMN "embedding" TYPE vector(1024);

CREATE INDEX IF NOT EXISTS "idx_semantic_embeddings_vector_cosine"
  ON "semantic_embeddings"
  USING hnsw ("embedding" vector_cosine_ops);
