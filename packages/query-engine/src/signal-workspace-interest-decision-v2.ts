import { createHash } from "node:crypto";
import { z } from "zod";
import { signalWorkspaceEmbeddingDigestV1 } from "./signal-workspace-embeddings-v1";
import {
  buildSignalWorkspaceInterestDecisionRequestV1,
  parseSignalWorkspaceInterestDecisionOutputV1,
  type SignalWorkspaceInterestDecisionParsedV1,
  type SignalWorkspaceInterestDecisionRequestV1,
} from "./signal-workspace-interest-decision-v1";

/** V2 changes the provider boundary only. Source admission remains the sealed V1 request. */
export const SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_INPUT_V2 = "signal-workspace-interest-decision-provider-input-v2" as const;
export const SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_OUTPUT_V2 = "signal-workspace-interest-decision-provider-output-v2" as const;
export const SIGNAL_WORKSPACE_INTEREST_DECISION_SPAN_MAX_UTF16_V2 = 320;
function fail(code: string): never { throw new Error(`interest_decision_v2_${code}`); }

export type SignalWorkspaceInterestDecisionProviderInputV2 = {
  contract_version: typeof SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_INPUT_V2;
  interest: { definition: string; inclusion: string[]; exclusion: string[] };
  roots: { root_ordinal: number; chunks: { chunk_index: number; spans: { span_id: string; text: string }[] }[] }[];
};
export type SignalWorkspaceInterestDecisionSpanV2 = {
  span_id: string; root_ordinal: number; chunk_index: number; quote_start: number; quote_end: number;
  quote: string; chunk_sha256: string;
};

function sealedRequest(request: SignalWorkspaceInterestDecisionRequestV1): SignalWorkspaceInterestDecisionRequestV1 {
  const { request_digest: _digest, ...body } = request;
  const rebuilt = buildSignalWorkspaceInterestDecisionRequestV1(body);
  if (rebuilt.request_digest !== request.request_digest) fail("request_digest_invalid");
  for (const root of rebuilt.roots) {
    let offset = 0;
    const asset = createHash("sha256");
    for (const [index, chunk] of root.chunks.entries()) {
      if (chunk.chunk_index !== index || chunk.start !== offset || chunk.end !== offset + chunk.text.length)
        fail("source_chunk_coverage_invalid");
      asset.update(chunk.text, "utf8");
      offset = chunk.end;
    }
    if (`sha256:${asset.digest("hex")}` !== root.asset_sha256) fail("source_asset_invalid");
  }
  return rebuilt;
}

/** Lossless UTF-16 partition. Whitespace and punctuation remain in exactly one span. */
function partition(text: string): { start: number; end: number; text: string }[] {
  const parts: { start: number; end: number; text: string }[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + SIGNAL_WORKSPACE_INTEREST_DECISION_SPAN_MAX_UTF16_V2, text.length);
    // Never cut a surrogate pair: citation offsets remain valid JS/PG UTF-16 offsets.
    if (end < text.length && end > start + 1 && /[\uD800-\uDBFF]/u.test(text[end - 1]!)
      && /[\uDC00-\uDFFF]/u.test(text[end]!)) end--;
    const minEnd = Math.min(start + 64, end);
    for (let cursor = minEnd; cursor < end; cursor++) {
      if (/[.!?;\n]/u.test(text[cursor - 1]!)) { end = cursor; break; }
    }
    if (end <= start) fail("span_partition_invalid");
    parts.push({ start, end, text: text.slice(start, end) });
    start = end;
  }
  return parts;
}

export function buildSignalWorkspaceInterestDecisionProviderInputV2(request: SignalWorkspaceInterestDecisionRequestV1): {
  input: SignalWorkspaceInterestDecisionProviderInputV2; spans: SignalWorkspaceInterestDecisionSpanV2[];
} {
  const source = sealedRequest(request);
  const spans: SignalWorkspaceInterestDecisionSpanV2[] = [];
  const input: SignalWorkspaceInterestDecisionProviderInputV2 = {
    contract_version: SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_INPUT_V2,
    interest: { definition: source.interest.definition, inclusion: source.interest.inclusion, exclusion: source.interest.exclusion },
    roots: source.roots.map((root, root_ordinal) => ({ root_ordinal,
      chunks: root.chunks.map(chunk => ({ chunk_index: chunk.chunk_index,
        spans: partition(chunk.text).map((part, index) => {
          const span_id = `r${root_ordinal}c${chunk.chunk_index}s${index}`;
          spans.push({ span_id, root_ordinal, chunk_index: chunk.chunk_index,
            quote_start: part.start, quote_end: part.end, quote: part.text, chunk_sha256: chunk.chunk_sha256 });
          return { span_id, text: part.text };
        }) })) })) };
  return { input, spans };
}

const citationSchema = z.object({ span_id: z.string().regex(/^r\d+c\d+s\d+$/u),
  role: z.enum(["supports", "contradicts", "context"]) }).strict();
const decisionSchema = z.object({ root_ordinal: z.number().int().nonnegative(),
  verdict: z.enum(["belongs", "not_belongs", "insufficient"]),
  rationale: z.string().trim().min(1), citations: z.array(citationSchema).max(128) }).strict();
const providerOutputSchema = z.object({ contract_version: z.literal(SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_OUTPUT_V2),
  decisions: z.array(decisionSchema).min(1).max(64) }).strict();
export type SignalWorkspaceInterestDecisionProviderOutputV2 = z.infer<typeof providerOutputSchema>;
export type SignalWorkspaceInterestDecisionParsedV2 = SignalWorkspaceInterestDecisionParsedV1 & {
  provider_output_digest: string;
};

/** Bind untrusted model choices to sealed source. Identities, quotes and offsets are server-derived. */
export function parseSignalWorkspaceInterestDecisionProviderOutputV2(args: {
  request: SignalWorkspaceInterestDecisionRequestV1; output: unknown;
}): SignalWorkspaceInterestDecisionParsedV2 {
  const source = sealedRequest(args.request);
  const output = providerOutputSchema.parse(args.output);
  if (output.decisions.length !== source.roots.length) fail("root_coverage_invalid");
  const spans = new Map(buildSignalWorkspaceInterestDecisionProviderInputV2(source).spans.map(span => [span.span_id, span]));
  const seenRoots = new Set<number>();
  const decisions = output.decisions.map(decision => {
    const root = source.roots[decision.root_ordinal];
    if (!root || seenRoots.has(decision.root_ordinal)) fail("root_ordinal_invalid");
    seenRoots.add(decision.root_ordinal);
    const seenSpans = new Set<string>();
    const citations = decision.citations.map(citation => {
      const span = spans.get(citation.span_id);
      if (!span || span.root_ordinal !== decision.root_ordinal || seenSpans.has(citation.span_id)
        || !span.quote.trim()) fail("span_id_invalid");
      seenSpans.add(citation.span_id);
      return { chunk_index: span.chunk_index, chunk_sha256: span.chunk_sha256,
        quote_start: span.quote_start, quote_end: span.quote_end, quote: span.quote, role: citation.role };
    });
    return { root_id: root.root_id, root_fingerprint: root.fingerprint, asset_sha256: root.asset_sha256,
      verdict: decision.verdict, rationale: decision.rationale, citations };
  });
  // Reuse the original literal-citation and evidence-role checks on the canonical shape.
  const parsed = parseSignalWorkspaceInterestDecisionOutputV1({ request: source,
    output: { contract_version: source.contract_version, request_digest: source.request_digest,
      interest_identity_digest: signalWorkspaceEmbeddingDigestV1(source.interest), decisions } });
  return { ...parsed, provider_output_digest: signalWorkspaceEmbeddingDigestV1(output) };
}
