import { embedTexts, vectorLiteral } from "./semantic-rag";

export const ENGINE_TOPK_SQL = `
  SELECT se.mention_id,
         se.source_id,
         se.chunk_text,
         1 - (se.embedding <=> $1::vector) AS similarity
    FROM semantic_embeddings se
   WHERE se.study_corpus_id = ANY($2::uuid[])
     AND ($3::text IS NULL OR se.scope_type = $3)
   ORDER BY se.embedding <=> $1::vector
   LIMIT $4`;

export async function buildEngineQueryVector(query: string) {
  const [embedded] = await embedTexts({
    inputs: [{ id: "engine-query", text: query }],
    inputType: "query",
    batchSize: 1
  });
  if (!embedded) throw new Error("Could not embed engine retrieval query.");
  return vectorLiteral(embedded.embedding);
}
