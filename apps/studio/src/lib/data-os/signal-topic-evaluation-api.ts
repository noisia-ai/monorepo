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

const candidateKey=z.string().trim().min(1).max(160);
const stateToken=z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const expectedRevision=z.number().int().positive();
const boundedLines=z.array(z.string().trim().min(1).max(240)).min(1).max(12);
const candidateCommandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("save"),candidate_key:candidateKey,expected_revision:expectedRevision,
    state_token:stateToken,values:z.object({title:z.string().trim().min(1).max(160),
      description:z.string().trim().min(1).max(2000),inclusion:boundedLines,
      exclusion:z.array(z.string().trim().min(1).max(240)).max(12)}).strict()}).strict(),
  z.object({action:z.literal("reject"),candidate_key:candidateKey,expected_revision:expectedRevision,
    state_token:stateToken}).strict(),
  z.object({action:z.literal("restore"),candidate_key:candidateKey,expected_revision:expectedRevision,
    state_token:stateToken}).strict(),
  z.object({action:z.literal("undo"),candidate_key:candidateKey,expected_revision:expectedRevision,
    state_token:stateToken,target_revision:z.number().int().positive()}).strict()
]);

export function parseSignalTopicEvaluationCandidateCommandV1(value:unknown){
  return candidateCommandSchema.parse(value);
}
