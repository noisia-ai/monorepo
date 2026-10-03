import { createHash } from "node:crypto";

/** Pinned provider contract. Pricing is sealed per run, separately from reusable vector identity. */
export const SIGNAL_WORKSPACE_EMBEDDING_PRICING_VERSION_V1 = "voyage-4-large-usd-0.12-per-million-2026-09-08";
const PROFILE_BASE = {
  contract_version: "signal-workspace-embedding-profile-v1",
  request_contract_version: "signal-workspace-embedding-request-v1",
  provider: "voyage",
  model: "voyage-4-large",
  dimensions: 1024,
  input_type: "document",
  output_dtype: "float",
  truncation: false,
  chunk_policy_version: "corpus-text-chunks-v1",
  tokenizer_revision: "bb931c2635a93efe400c24741363d8ff61d7bb32",
  token_bound_version: "voyage-nfc-byte-bpe-plus-64-v1",
  pricing_version: SIGNAL_WORKSPACE_EMBEDDING_PRICING_VERSION_V1,
  rate_micro_usd_per_million_tokens: 120000
} as const;
const { pricing_version: _pricing, rate_micro_usd_per_million_tokens: _rate, ...VECTOR_CONFIG } = PROFILE_BASE;
export const SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1 = signalWorkspaceEmbeddingDigestV1(VECTOR_CONFIG);
export const SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 = Object.freeze({
  ...PROFILE_BASE, config_digest: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1
});
export type SignalWorkspaceEmbeddingProfileV1 = typeof SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1;
export const SIGNAL_WORKSPACE_EMBEDDING_MAX_BATCH_TOKENS_V1 = 120_000;
export const SIGNAL_WORKSPACE_EMBEDDING_MAX_INPUT_TOKENS_V1 = 32_000;
// Transport/memory limit only. It never limits the number of inputs in a run.
export const SIGNAL_WORKSPACE_EMBEDDING_MAX_BATCH_INPUTS_V1 = 128;
export const SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1 = 5_000_000;

export class SignalWorkspaceEmbeddingContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SignalWorkspaceEmbeddingContractError"; }
}
const fail = (code: string): never => { throw new SignalWorkspaceEmbeddingContractError(code); };
const safeInteger = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) return fail("workspace_embedding_invalid_integer");
  return value;
};

export function signalWorkspaceEmbeddingDigestV1(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]));
    return item;
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex")}`;
}
export function assertSignalWorkspaceEmbeddingProfileV1(profile: unknown): asserts profile is SignalWorkspaceEmbeddingProfileV1 {
  if (signalWorkspaceEmbeddingDigestV1(profile) !== signalWorkspaceEmbeddingDigestV1(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1)) {
    fail("workspace_embedding_profile_unsupported");
  }
}

export function signalWorkspaceEmbeddingCostMicroUsdV1(tokens: number): number {
  const result = (BigInt(safeInteger(tokens)) * 12n + 99n) / 100n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) return fail("workspace_embedding_cost_overflow");
  return Number(result);
}

/**
 * The published tokenizer uses NFC then ByteLevel BPE without added prefix spaces.
 * Bytes bound the pre-merge tokens; 64 additionally covers the document prefix and
 * framing. This is a conservative bound, not an exact tokenizer or billed usage.
 * https://docs.voyageai.com/docs/tokenization
 * https://docs.voyageai.com/reference/embeddings-api
 */
export function boundSignalWorkspaceEmbeddingInputTokensV1(text: string): number {
  if (!text || text.length > 1400) return fail("workspace_embedding_invalid_chunk");
  // PostgreSQL text cannot contain unpaired UTF-16 surrogates. Reject them at the adapter too.
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return fail("workspace_embedding_invalid_unicode");
    } else if (code >= 0xdc00 && code <= 0xdfff) return fail("workspace_embedding_invalid_unicode");
  }
  const bound = Buffer.byteLength(text.normalize("NFC"), "utf8") + 64;
  if (bound > SIGNAL_WORKSPACE_EMBEDDING_MAX_INPUT_TOKENS_V1) return fail("workspace_embedding_input_too_large");
  return bound;
}

/** No text leaves the DB for this conservative quote. NFC expansion is bounded by NFD (3x UTF-8). */
export function quoteSignalWorkspaceEmbeddingCostV1(args: { input_bytes: number; chunk_count: number }) {
  const bytes = safeInteger(args.input_bytes), chunks = safeInteger(args.chunk_count);
  if ((bytes === 0) !== (chunks === 0)) return fail("workspace_embedding_invalid_quote_population");
  const tokens = safeInteger(bytes * 3 + chunks * 64);
  // Sum of per-call ceilings is at most the total ceiling plus number of nonempty calls minus one.
  const maximum = safeInteger(signalWorkspaceEmbeddingCostMicroUsdV1(tokens) + Math.max(0, chunks - 1));
  return { pricing_version: SIGNAL_WORKSPACE_EMBEDDING_PRICING_VERSION_V1,
    token_upper_bound: tokens, estimated_max_cost_micro_usd: maximum };
}

export type SignalWorkspaceEmbeddingInputV1 = { chunk_sha256: string; text: string };
export type SignalWorkspaceEmbeddingResponseV1 = {
  model: string;
  embeddings: Array<{ index: number; vector: number[] }>;
  total_tokens: number;
  provider_request_id: string | null;
  response_digest: string;
};

export function validateSignalWorkspaceEmbeddingInputsV1(inputs: SignalWorkspaceEmbeddingInputV1[]): number {
  if (!inputs.length || inputs.length > SIGNAL_WORKSPACE_EMBEDDING_MAX_BATCH_INPUTS_V1) return fail("workspace_embedding_invalid_batch");
  const seen = new Set<string>();
  let bound = 0;
  for (const input of inputs) {
    const expected = `sha256:${createHash("sha256").update(input.text).digest("hex")}`;
    if (input.chunk_sha256 !== expected || seen.has(expected)) return fail("workspace_embedding_input_identity_mismatch");
    seen.add(expected); bound += boundSignalWorkspaceEmbeddingInputTokensV1(input.text);
  }
  if (bound > SIGNAL_WORKSPACE_EMBEDDING_MAX_BATCH_TOKENS_V1) return fail("workspace_embedding_batch_too_large");
  return bound;
}

export function validateSignalWorkspaceEmbeddingResponseV1(
  inputs: SignalWorkspaceEmbeddingInputV1[], response: SignalWorkspaceEmbeddingResponseV1
): void {
  validateSignalWorkspaceEmbeddingInputsV1(inputs);
  if (response.model !== SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.model
    || !Number.isSafeInteger(response.total_tokens) || response.total_tokens <= 0
    || !Array.isArray(response.embeddings) || response.embeddings.length !== inputs.length
    || !/^sha256:[a-f0-9]{64}$/.test(response.response_digest)
    || !(response.provider_request_id === null || typeof response.provider_request_id === "string" && response.provider_request_id.length <= 512)) {
    return fail("workspace_embedding_invalid_response");
  }
  const seen = new Set<number>();
  for (const entry of response.embeddings) {
    if (!Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index >= inputs.length || seen.has(entry.index)
      || !Array.isArray(entry.vector) || entry.vector.length !== SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.dimensions
      || entry.vector.some(value => !Number.isFinite(value) || Math.abs(value) > 3.402823466e38)
      || !entry.vector.some(value => Math.fround(value) !== 0)) return fail("workspace_embedding_invalid_response");
    seen.add(entry.index);
  }
  // Usage exceeding a reservation must still be recorded by the ledger, then block further sends.
}
