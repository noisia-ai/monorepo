import { z } from "zod";

const startSchema = z.object({
  generation_key: z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(160),
  preflight_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  confirmation: z.literal("GENERATE_PENDING_SEMANTIC_CONTEXT_PROPOSALS"),
  hard_cap_micro_usd: z.string().regex(/^[1-9][0-9]*$/u).max(18)
}).strict();

export function parseSignalSemanticContextProposalStartRequestV1(value: unknown) {
  const parsed = startSchema.parse(value);
  return { ...parsed, hard_cap_micro_usd: BigInt(parsed.hard_cap_micro_usd) };
}

export function parseSignalSemanticContextProposalRetryRequestV1(value: unknown) {
  return z.object({}).strict().parse(value);
}
