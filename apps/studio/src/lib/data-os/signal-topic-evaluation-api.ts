import { z } from "zod";

const startSchema=z.object({
  expected_envelope_digest:z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  confirmation:z.literal("RUN_ONE_TOPIC_EVALUATION"),
  hard_cap_micro_usd:z.string().regex(/^[1-9][0-9]*$/u).max(18)
}).strict();

export function parseSignalTopicEvaluationStartRequestV1(value:unknown){
  const parsed=startSchema.parse(value);
  return{...parsed,hard_cap_micro_usd:BigInt(parsed.hard_cap_micro_usd)};
}
