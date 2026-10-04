import { signalWorkspaceEmbeddingDigestV1 } from "./signal-workspace-embeddings-v1";
import type { MentionFacetsV1 } from "./signal-mention-facets-v1";
export type LabelerIdentity = {
  kind: "facets" | "membership";
  provider: "anthropic" | "typesafe" | "rules" | "human";
  model: string;
  prompt_digest: string;
  schema_digest: string;
  params: Record<string, unknown>;
};
export type FacetInput = {
  root_id: string;
  input_digest: string;
  text: string;
  title: string | null;
  platform: string | null;
  content_type: string | null;
  author: string | null;
  published_at: string;
  language: string | null;
};
export type FacetResult = {
  root_id: string;
  input_digest: string;
  entity_context_digest: string;
  status: "labeled" | "abstained" | "refused" | "error";
  facets?: MentionFacetsV1;
  refusal_category?: string;
  error_code?: string;
};
export const labelerDigestV1 = (identity: LabelerIdentity) =>
  signalWorkspaceEmbeddingDigestV1(identity);
