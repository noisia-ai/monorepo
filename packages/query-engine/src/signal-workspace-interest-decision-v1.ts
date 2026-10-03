import { createHash } from "node:crypto";
import { z } from "zod";
import { signalWorkspaceEmbeddingDigestV1 } from "./signal-workspace-embeddings-v1";
import type { SignalWorkspaceClassificationDecisionV1 } from "./signal-workspace-classification-v1";

export const SIGNAL_WORKSPACE_INTEREST_DECISION_CONTRACT_V1 = "signal-workspace-interest-decision-v1" as const;
// This bounds one provider transport, never the number of roots in a generation.
export const SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_LIMIT_V1 = 64;
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const termKey = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u);
const nonblank = z.string().trim().min(1);
const verbatim = z.string().min(1).max(1400).refine(value => value.trim().length > 0);
const chunkSchema = z.object({
  chunk_index: z.number().int().nonnegative(), start: z.number().int().nonnegative(),
  end: z.number().int().positive(), chunk_sha256: digest, text: verbatim
}).strict();
const rootSchema = z.object({
  root_id: z.string().uuid(), fingerprint: digest, correction_digest: digest, asset_sha256: digest,
  chunks: z.array(chunkSchema).min(1).max(128)
}).strict();
const interestSchema = z.object({
  taxonomy_term_id: z.string().uuid(), term_key: termKey, definition_revision: z.number().int().positive(),
  definition_digest: digest, definition: nonblank.max(10000),
  inclusion: z.array(nonblank.max(2000)).max(100), exclusion: z.array(nonblank.max(2000)).max(100)
}).strict();

const requestBodySchema = z.object({
  contract_version: z.literal(SIGNAL_WORKSPACE_INTEREST_DECISION_CONTRACT_V1),
  workspace_id: z.string().uuid(), context_digest: digest, decision_policy_digest: digest,
  interest: interestSchema, roots: z.array(rootSchema).min(1).max(SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_LIMIT_V1)
}).strict().superRefine((value, ctx) => {
  const seenRoots = new Set<string>();
  for (const root of value.roots) {
    if (seenRoots.has(root.root_id)) issue(ctx, "interest_decision_duplicate_root");
    seenRoots.add(root.root_id);
    const seenChunks = new Set<number>();
    for (const chunk of root.chunks) {
      if (seenChunks.has(chunk.chunk_index)) issue(ctx, "interest_decision_duplicate_chunk");
      seenChunks.add(chunk.chunk_index);
      if (chunk.end <= chunk.start || chunk.end - chunk.start !== chunk.text.length
        || chunk.chunk_sha256 !== sha(chunk.text)) issue(ctx, "interest_decision_source_chunk_invalid");
    }
  }
});
export type SignalWorkspaceInterestDecisionRequestBodyV1 = z.infer<typeof requestBodySchema>;
export type SignalWorkspaceInterestDecisionRequestV1 = SignalWorkspaceInterestDecisionRequestBodyV1 & { request_digest: string };

export function buildSignalWorkspaceInterestDecisionRequestV1(body: SignalWorkspaceInterestDecisionRequestBodyV1): SignalWorkspaceInterestDecisionRequestV1 {
  const parsed = requestBodySchema.parse(body);
  return { ...parsed, request_digest: signalWorkspaceEmbeddingDigestV1(parsed) };
}

const citationSchema = z.object({
  chunk_index: z.number().int().nonnegative(), chunk_sha256: digest,
  quote_start: z.number().int().nonnegative(), quote_end: z.number().int().positive(),
  quote: verbatim, role: z.enum(["supports", "contradicts", "context"])
}).strict();
const decisionSchema = z.object({
  root_id: z.string().uuid(), root_fingerprint: digest, asset_sha256: digest,
  verdict: z.enum(["belongs", "not_belongs", "insufficient"]),
  rationale: nonblank.max(4000), citations: z.array(citationSchema).max(16)
}).strict().superRefine((value, ctx) => {
  if (value.verdict === "belongs" && !value.citations.some(citation => citation.role === "supports")) {
    issue(ctx, "interest_decision_support_required");
  }
  // An unrelated conversation can be excluded by cited context without
  // containing a literal negation of the interest definition.
  if (value.verdict === "not_belongs" && !value.citations.some(citation => citation.role === "contradicts" || citation.role === "context")) {
    issue(ctx, "interest_decision_exclusion_evidence_required");
  }
});
const outputSchema = z.object({
  contract_version: z.literal(SIGNAL_WORKSPACE_INTEREST_DECISION_CONTRACT_V1),
  request_digest: digest, interest: interestSchema,
  decisions: z.array(decisionSchema).min(1).max(SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_LIMIT_V1)
}).strict();
export type SignalWorkspaceInterestDecisionOutputV1 = z.infer<typeof outputSchema>;
export type SignalWorkspaceInterestDecisionParsedV1 = {
  output: SignalWorkspaceInterestDecisionOutputV1;
  output_digest: string;
};

/** Checks only source identity and verbatim citations. Semantic truth and provider
 * provenance require a separate model receipt and policy decision in the store. */
export function parseSignalWorkspaceInterestDecisionOutputV1(args: {
  request: SignalWorkspaceInterestDecisionRequestV1; output: unknown;
}): SignalWorkspaceInterestDecisionParsedV1 {
  const request = buildSignalWorkspaceInterestDecisionRequestV1(stripRequestDigest(args.request));
  if (args.request.request_digest !== request.request_digest) fail("interest_decision_request_digest_mismatch");
  const output = outputSchema.parse(args.output);
  if (output.request_digest !== request.request_digest
    || signalWorkspaceEmbeddingDigestV1(output.interest) !== signalWorkspaceEmbeddingDigestV1(request.interest)) {
    fail("interest_decision_interest_identity_mismatch");
  }
  if (output.decisions.length !== request.roots.length) fail("interest_decision_root_coverage_mismatch");
  const roots = new Map(request.roots.map(root => [root.root_id, root]));
  const seen = new Set<string>();
  for (const decision of output.decisions) {
    const root = roots.get(decision.root_id);
    if (!root || seen.has(decision.root_id) || root.fingerprint !== decision.root_fingerprint
      || root.asset_sha256 !== decision.asset_sha256) fail("interest_decision_root_identity_mismatch");
    seen.add(decision.root_id);
    const chunks = new Map(root.chunks.map(chunk => [chunk.chunk_index, chunk]));
    const citations = new Set<string>();
    for (const citation of decision.citations) {
      const chunk = chunks.get(citation.chunk_index);
      const citationKey = `${citation.chunk_index}:${citation.quote_start}:${citation.quote_end}`;
      if (!chunk || chunk.chunk_sha256 !== citation.chunk_sha256
        || citation.quote_end <= citation.quote_start || citation.quote_end > chunk.text.length
        || chunk.text.slice(citation.quote_start, citation.quote_end) !== citation.quote
        || citations.has(citationKey)) fail("interest_decision_citation_invalid");
      citations.add(citationKey);
    }
  }
  const decisions = new Map(output.decisions.map(decision => [decision.root_id, decision]));
  const canonical: SignalWorkspaceInterestDecisionOutputV1 = { ...output,
    decisions: request.roots.map(root => ({ ...decisions.get(root.root_id)!,
      citations: [...decisions.get(root.root_id)!.citations].sort((a, b) =>
        a.chunk_index - b.chunk_index || a.quote_start - b.quote_start || a.quote_end - b.quote_end
        || a.role.localeCompare(b.role)) })) };
  return { output: canonical, output_digest: signalWorkspaceEmbeddingDigestV1(canonical) };
}

/** An intent for the later DB authority adapter, never a classification decision.
 * The adapter must bind a settled model receipt and validate current policy
 * before constructing SignalWorkspaceClassificationDecisionV1. */
export function signalWorkspaceInterestDecisionClassificationIntentV1(verdict: SignalWorkspaceInterestDecisionOutputV1["decisions"][number]["verdict"]): {
  disposition: Extract<SignalWorkspaceClassificationDecisionV1["disposition"], "pending" | "rejected"> | null;
  resolution_method: "model";
  requires_model_receipt: true;
  approval_policy_id: null;
} {
  return { disposition: verdict === "belongs" ? "pending" : verdict === "not_belongs" ? "rejected" : null,
    resolution_method: "model", requires_model_receipt: true, approval_policy_id: null };
}

function stripRequestDigest(request: SignalWorkspaceInterestDecisionRequestV1): SignalWorkspaceInterestDecisionRequestBodyV1 {
  const { request_digest: _digest, ...body } = request;
  return body;
}
function sha(text: string) { return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`; }
function issue(ctx: z.RefinementCtx, message: string) { ctx.addIssue({ code: z.ZodIssueCode.custom, message }); }
function fail(code: string): never { throw new Error(code); }
