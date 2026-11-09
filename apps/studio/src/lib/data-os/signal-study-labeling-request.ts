import { z } from "zod";

export const studyLabelingRequestSchemaV2 = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), map_id: z.string().uuid(), idempotency_key: z.string().uuid(),
    cap_micro_usd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ action: z.literal("continue"), run_id: z.string().uuid(), idempotency_key: z.string().uuid() }).strict(),
  z.object({ action: z.literal("retry"), run_id: z.string().uuid(), idempotency_key: z.string().uuid() }).strict()
]);

/** Studio advertises worker availability. The sending worker owns its credentials. */
export function studyLabelingProviderAvailableV2(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.NOISIA_JEV_PROVIDER_ENABLED === "false") return false;
  if (env.NOISIA_JEV_PROVIDER_ENABLED === "true") return true;
  return env.NOISIA_JEV_PROVIDER_ENABLED === undefined && Boolean(env.TYPESAFE_API_KEY?.trim());
}
