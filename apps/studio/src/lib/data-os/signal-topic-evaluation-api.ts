import { z } from "zod";
import { SIGNAL_TOPIC_EVALUATION_SUCCESSOR_CONFIRMATION } from "@noisia/query-engine";

const startSchema=z.object({
  expected_envelope_digest:z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  confirmation:z.literal("RUN_ONE_TOPIC_EVALUATION"),
  hard_cap_micro_usd:z.string().regex(/^[1-9][0-9]*$/u).max(18)
}).strict();

export function parseSignalTopicEvaluationStartRequestV1(value:unknown){
  const parsed=startSchema.parse(value);
  return{...parsed,hard_cap_micro_usd:BigInt(parsed.hard_cap_micro_usd)};
}

const successorStartSchema=z.object({
  predecessor_run_key:z.string().trim().min(1).max(200),
  expected_envelope_digest:z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  confirmation:z.literal(SIGNAL_TOPIC_EVALUATION_SUCCESSOR_CONFIRMATION),
  hard_cap_micro_usd:z.string().regex(/^[1-9][0-9]*$/u).max(18)
}).strict();

export function parseSignalTopicEvaluationSuccessorStartRequestV1(value:unknown){
  const parsed=successorStartSchema.parse(value);
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

const v2RunKey=z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,199}$/u);
const v2CandidateKey=z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,179}$/u);
const v2Lines=z.array(z.string().trim().min(1).max(240)).min(1).max(16);
const v2CandidateCommandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("save"),run_key:v2RunKey,candidate_key:v2CandidateKey,
    expected_revision:expectedRevision,state_token:stateToken,values:z.object({
      title:z.string().trim().min(1).max(160),description:z.string().trim().min(1).max(1500),
      inclusion:v2Lines,exclusion:z.array(z.string().trim().min(1).max(240)).max(16)
    }).strict()}).strict(),
  z.object({action:z.literal("reject"),run_key:v2RunKey,candidate_key:v2CandidateKey,
    expected_revision:expectedRevision,state_token:stateToken}).strict(),
  z.object({action:z.literal("restore"),run_key:v2RunKey,candidate_key:v2CandidateKey,
    expected_revision:expectedRevision,state_token:stateToken}).strict(),
  z.object({action:z.literal("undo"),run_key:v2RunKey,candidate_key:v2CandidateKey,
    expected_revision:expectedRevision,state_token:stateToken,
    target_revision:z.number().int().positive()}).strict()
]);

export function parseSignalTopicEvaluationV2CandidateCommand(value:unknown){
  return v2CandidateCommandSchema.parse(value);
}

export function parseSignalTopicEvaluationV2CandidatePageQuery(url:string){
  const search=new URL(url).searchParams;
  const keys=[...search.keys()];
  if(keys.some((key)=>key!=="cursor"&&key!=="limit"))throw new Error("invalid_query");
  const cursor=search.get("cursor");const rawLimit=search.get("limit");
  if(cursor!==null&&(cursor.length<16||cursor.length>512))throw new Error("invalid_query");
  if(rawLimit!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/u.test(rawLimit))throw new Error("invalid_query");
  return{cursor,limit:rawLimit===null?20:Number(rawLimit)};
}

export function parseSignalTopicEvaluationV2CandidateDetailQuery(url:string){
  const search=new URL(url).searchParams;const keys=[...search.keys()];
  if(keys.length!==1||keys[0]!=="run_key")throw new Error("invalid_query");
  return{run_key:v2RunKey.parse(search.get("run_key"))};
}

export function parseSignalTopicEvaluationV2CandidateEvidenceQuery(url:string){
  const search=new URL(url).searchParams,keys=[...search.keys()];
  if(new Set(keys).size!==keys.length||keys.some((key)=>!["run_key","collection","limit","cursor"].includes(key)))
    throw new Error("invalid_query");
  const collection=z.enum(["candidate","refinement"]).parse(search.get("collection"));
  const rawLimit=search.get("limit"),cursor=search.get("cursor");
  if(rawLimit!==null&&!/^(?:[1-9]|1[0-9]|20)$/u.test(rawLimit))throw new Error("invalid_query");
  if(cursor!==null&&(cursor.length<16||cursor.length>512))throw new Error("invalid_query");
  return{run_key:v2RunKey.parse(search.get("run_key")),collection,limit:rawLimit===null?20:Number(rawLimit),cursor};
}
