import { SIGNAL_TOPIC_EVALUATION_SUCCESSOR_CONFIRMATION } from "@noisia/query-engine";

export const SIGNAL_TOPIC_EVALUATION_LAUNCH_CONFIRMATION =
  "RUN_ONE_TOPIC_EVALUATION" as const;

export type SignalTopicEvaluationFlightCardV1 = {
  contractVersion: "signal-topic-evaluation-preflight-v1";
  preflightStatus:"ready"|"blocked";
  preflightErrorCode:"topic_evaluation_launch_authority_unavailable"|null;
  executionEnabled: boolean;
  executionConfigurationComplete: boolean;
  credentialConfigured: boolean;
  provider: "anthropic";
  model: string | null;
  pricingVersion: string | null;
  envelopeDigest: string|null;
  proposalCount: 115|null;
  oneCallMax: 1;
  retryAllowed: false;
  hardCapMicroUsd: string | null;
  estimatedMaxCostMicroUsd: string | null;
  successMinimumCandidates: 10;
  topicAdoption: false;
  publication: false;
  serving: false;
};

export type SignalTopicEvaluationCandidateV1={candidateKey:string;title:string;description:string;
  inclusion:string[];exclusion:string[];sourceProposalKeys:string[];sourceProposalCount:number;
  evidence:{count:number;supports:number;limits:number;contradicts:number};
  reviewState:"pending"|"rejected";revision:number;stateToken:string;
  undoTargetRevision:number|null;updatedAt:string};
export type SignalTopicEvaluationSuccessorAuthorityV1={eligible:boolean;predecessorRunKey:string|null};
export type SignalTopicEvaluationManagementV1={card:SignalTopicEvaluationFlightCardV1;run:null|{
  runKey:string;status:"queued"|"in_flight"|"response_persisted"|"completed"|"failed"|"outcome_unknown";
  providerCallCount:number;providerOutcomeClass:"definitely_not_sent"|"known_response_invalid"|
    "ambiguous_after_send"|null;candidateCount:number|null;rubricMet:boolean|null;errorCode:string|null;
  settledMicroUsd:string|null;queuedAt:string;completedAt:string|null;failedAt:string|null;updatedAt:string};
  successor:SignalTopicEvaluationSuccessorAuthorityV1;
  results:{runKey:string|null;items:SignalTopicEvaluationCandidateV1[];total:number;pending:number;rejected:number;
    limit:number;nextCursor:string|null}};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string" ? value : undefined;
}

export function projectSignalTopicEvaluationFlightCardV1(
  value: unknown
): SignalTopicEvaluationFlightCardV1 {
  if (!isObject(value)) throw new Error("topic_evaluation_preflight_invalid");
  const model = nullableString(value.model);
  const pricingVersion = nullableString(value.pricing_version);
  const hardCapMicroUsd = nullableString(value.hard_cap_micro_usd);
  const estimatedMaxCostMicroUsd = nullableString(value.estimated_max_cost_micro_usd);
  const envelopeDigest = nullableString(value.envelope_digest);
  const ready=value.preflight_status==="ready";
  if (
    value.contract_version !== "signal-topic-evaluation-preflight-v1"
    || (value.preflight_status!=="ready"&&value.preflight_status!=="blocked")
    || !(value.preflight_error_code===null
      ||value.preflight_error_code==="topic_evaluation_launch_authority_unavailable")
    || typeof value.execution_enabled !== "boolean"
    || typeof value.execution_configuration_complete !== "boolean"
    || typeof value.credential_configured !== "boolean"
    || value.provider !== "anthropic"
    || model === undefined
    || pricingVersion === undefined
    || envelopeDigest === undefined
    || !(value.proposal_count===115||value.proposal_count===null)
    || value.one_call_max !== 1
    || value.retry_allowed !== false
    || hardCapMicroUsd === undefined
    || estimatedMaxCostMicroUsd === undefined
    || value.success_minimum_candidates !== 10
    || value.topic_adoption !== false
    || value.publication !== false
    || value.serving !== false
    || (ready&&(value.preflight_error_code!==null||envelopeDigest===null
      ||!/^sha256:[0-9a-f]{64}$/u.test(envelopeDigest)||value.proposal_count!==115))
    || (!ready&&(value.preflight_error_code!=="topic_evaluation_launch_authority_unavailable"
      ||value.execution_enabled!==false||envelopeDigest!==null||value.proposal_count!==null))
  ) {
    throw new Error("topic_evaluation_preflight_invalid");
  }
  return {
    contractVersion: value.contract_version,
    preflightStatus:value.preflight_status,
    preflightErrorCode:value.preflight_error_code,
    executionEnabled: value.execution_enabled,
    executionConfigurationComplete: value.execution_configuration_complete,
    credentialConfigured: value.credential_configured,
    provider: value.provider,
    model,
    pricingVersion,
    envelopeDigest,
    proposalCount: value.proposal_count,
    oneCallMax: value.one_call_max,
    retryAllowed: value.retry_allowed,
    hardCapMicroUsd,
    estimatedMaxCostMicroUsd,
    successMinimumCandidates: value.success_minimum_candidates,
    topicAdoption: value.topic_adoption,
    publication: value.publication,
    serving: value.serving
  };
}

export function projectSignalTopicEvaluationManagementV1(value:unknown):SignalTopicEvaluationManagementV1{
  if(!isObject(value))throw new Error("topic_evaluation_management_invalid");
  const card=projectSignalTopicEvaluationFlightCardV1(value);
  let run:SignalTopicEvaluationManagementV1["run"]=null;
  if(value.run!==null){
    if(!isObject(value.run)||typeof value.run.run_key!=="string"||!isRunStatus(value.run.status)
      ||!Number.isInteger(value.run.provider_call_count)||(value.run.provider_call_count as number)<0
      ||(value.run.provider_call_count as number)>1||!nullableInteger(value.run.candidate_count)
      ||!providerOutcomeClass(value.run.provider_outcome_class)
      ||!nullableBoolean(value.run.rubric_met)||!nullableStringValue(value.run.error_code)
      ||!nullableDigitString(value.run.settled_micro_usd)||typeof value.run.queued_at!=="string"
      ||!nullableStringValue(value.run.completed_at)||!nullableStringValue(value.run.failed_at)
      ||typeof value.run.updated_at!=="string")throw new Error("topic_evaluation_management_invalid");
    run={runKey:value.run.run_key,status:value.run.status,providerCallCount:value.run.provider_call_count as number,
      providerOutcomeClass:value.run.provider_outcome_class,
      candidateCount:value.run.candidate_count as number|null,rubricMet:value.run.rubric_met as boolean|null,
      errorCode:value.run.error_code as string|null,settledMicroUsd:value.run.settled_micro_usd as string|null,
      queuedAt:value.run.queued_at,completedAt:value.run.completed_at as string|null,
      failedAt:value.run.failed_at as string|null,updatedAt:value.run.updated_at};
  }
  if(!isObject(value.successor)||typeof value.successor.eligible!=="boolean"
    ||!nullableStringValue(value.successor.predecessor_run_key)
    ||(value.successor.eligible!==Boolean(value.successor.predecessor_run_key))) {
    throw new Error("topic_evaluation_management_invalid");
  }
  if(!isObject(value.results)||value.results.contract_version!=="signal-topic-evaluation-candidate-page-v1"
    ||!nullableStringValue(value.results.run_key)
    ||!Array.isArray(value.results.items)||!nonnegativeInteger(value.results.total)
    ||!nonnegativeInteger(value.results.pending)||!nonnegativeInteger(value.results.rejected)
    ||!Number.isInteger(value.results.limit)||(value.results.limit as number)<1||(value.results.limit as number)>50
    ||!nullableStringValue(value.results.next_cursor))throw new Error("topic_evaluation_management_invalid");
  const items=value.results.items.map(projectCandidate);
  return{card,run,successor:{eligible:value.successor.eligible,
    predecessorRunKey:value.successor.predecessor_run_key as string|null},results:{runKey:value.results.run_key as string|null,items,
    total:value.results.total as number,pending:value.results.pending as number,
    rejected:value.results.rejected as number,limit:value.results.limit as number,
    nextCursor:value.results.next_cursor as string|null}};
}

export function createSignalTopicEvaluationReviewIdempotencyKeyV1(
  randomUuid:()=>string=()=>crypto.randomUUID()){
  return`topic-evaluation:review:${randomUuid()}`;
}

function projectCandidate(value:unknown):SignalTopicEvaluationCandidateV1{
  if(!isObject(value)||typeof value.candidate_key!=="string"||typeof value.title!=="string"
    ||typeof value.description!=="string"||!stringArray(value.inclusion,1,12)
    ||!stringArray(value.exclusion,0,12)||!stringArray(value.source_proposal_keys,1,12)
    ||!nonnegativeInteger(value.source_proposal_count)||!isObject(value.evidence)
    ||!nonnegativeInteger(value.evidence.count)||!nonnegativeInteger(value.evidence.supports)
    ||!nonnegativeInteger(value.evidence.limits)||!nonnegativeInteger(value.evidence.contradicts)
    ||(value.review_state!=="pending"&&value.review_state!=="rejected")
    ||!Number.isInteger(value.revision)||(value.revision as number)<1
    ||typeof value.state_token!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(value.state_token)
    ||!(value.undo_target_revision===null||(Number.isInteger(value.undo_target_revision)
      &&(value.undo_target_revision as number)>0))
    ||typeof value.updated_at!=="string")throw new Error("topic_evaluation_candidate_invalid");
  return{candidateKey:value.candidate_key,title:value.title,description:value.description,
    inclusion:value.inclusion,exclusion:value.exclusion,sourceProposalKeys:value.source_proposal_keys,
    sourceProposalCount:value.source_proposal_count as number,evidence:{count:value.evidence.count as number,
      supports:value.evidence.supports as number,limits:value.evidence.limits as number,
      contradicts:value.evidence.contradicts as number},
    reviewState:value.review_state,revision:value.revision as number,stateToken:value.state_token,
    undoTargetRevision:value.undo_target_revision as number|null,updatedAt:value.updated_at};
}

function isRunStatus(value:unknown):value is NonNullable<SignalTopicEvaluationManagementV1["run"]>["status"]{
  return["queued","in_flight","response_persisted","completed","failed","outcome_unknown"].includes(String(value));}
function nullableInteger(value:unknown):value is number|null{return value===null||Number.isInteger(value);}
function nullableBoolean(value:unknown):value is boolean|null{return value===null||typeof value==="boolean";}
function nullableStringValue(value:unknown):value is string|null{return value===null||typeof value==="string";}
function nullableDigitString(value:unknown):value is string|null{return value===null||(typeof value==="string"&&/^\d+$/u.test(value));}
function providerOutcomeClass(value:unknown):value is NonNullable<SignalTopicEvaluationManagementV1["run"]>["providerOutcomeClass"]{
  return value===null||value==="definitely_not_sent"||value==="known_response_invalid"||value==="ambiguous_after_send";}
function nonnegativeInteger(value:unknown):value is number{return Number.isInteger(value)&&(value as number)>=0;}
function stringArray(value:unknown,min:number,max:number):value is string[]{return Array.isArray(value)
  &&value.length>=min&&value.length<=max&&value.every((item)=>typeof item==="string");}

export function canLaunchSignalTopicEvaluationV1(card: SignalTopicEvaluationFlightCardV1) {
  return card.preflightStatus==="ready"
    && card.preflightErrorCode===null
    && card.envelopeDigest!==null
    && /^sha256:[0-9a-f]{64}$/u.test(card.envelopeDigest)
    && card.proposalCount===115
    && card.executionEnabled
    && card.executionConfigurationComplete
    && card.credentialConfigured
    && Boolean(card.model)
    && Boolean(card.pricingVersion)
    && card.oneCallMax === 1
    && card.retryAllowed === false
    && card.hardCapMicroUsd !== null
    && /^[1-9][0-9]*$/u.test(card.hardCapMicroUsd)
    && card.estimatedMaxCostMicroUsd !== null
    && /^[0-9]+$/u.test(card.estimatedMaxCostMicroUsd)
    && BigInt(card.estimatedMaxCostMicroUsd) <= BigInt(card.hardCapMicroUsd)
    && card.topicAdoption === false
    && card.publication === false
    && card.serving === false;
}

export function selectSignalTopicEvaluationLaunchModeV1(
  management:SignalTopicEvaluationManagementV1|null
):"root"|"successor"|null {
  if(!management)return null;
  if(management.successor.eligible)return "successor";
  return management.run===null&&canLaunchSignalTopicEvaluationV1(management.card)?"root":null;
}

export function createSignalTopicEvaluationIdempotencyKeyV1(
  randomUuid: () => string = () => crypto.randomUUID()
) {
  return `topic-evaluation:start:${randomUuid()}`;
}

export function createSignalTopicEvaluationSuccessorIdempotencyKeyV1(
  randomUuid: () => string = () => crypto.randomUUID()
) {
  return `topic-evaluation:successor:${randomUuid()}`;
}

export function buildSignalTopicEvaluationLaunchRequestV1(args: {
  acknowledged: boolean;
  card: SignalTopicEvaluationFlightCardV1;
  idempotencyKey: string;
}) {
  if (!args.acknowledged) throw new Error("topic_evaluation_cost_acknowledgement_required");
  if (!canLaunchSignalTopicEvaluationV1(args.card)) {
    throw new Error("topic_evaluation_preflight_not_ready");
  }
  if (!args.idempotencyKey.startsWith("topic-evaluation:start:")) {
    throw new Error("topic_evaluation_idempotency_key_invalid");
  }
  return {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey
    },
    body: {
      expected_envelope_digest: args.card.envelopeDigest!,
      confirmation: SIGNAL_TOPIC_EVALUATION_LAUNCH_CONFIRMATION,
      hard_cap_micro_usd: args.card.hardCapMicroUsd!
    }
  } as const;
}

export function buildSignalTopicEvaluationSuccessorRequestV1(args: {
  acknowledged:boolean;
  card:SignalTopicEvaluationFlightCardV1;
  successor:SignalTopicEvaluationSuccessorAuthorityV1;
  idempotencyKey:string;
}) {
  if (!args.acknowledged) throw new Error("topic_evaluation_cost_acknowledgement_required");
  if (!canLaunchSignalTopicEvaluationV1(args.card)) {
    throw new Error("topic_evaluation_preflight_not_ready");
  }
  if (!args.successor.eligible || !args.successor.predecessorRunKey) {
    throw new Error("topic_evaluation_successor_not_available");
  }
  if (!args.idempotencyKey.startsWith("topic-evaluation:successor:")) {
    throw new Error("topic_evaluation_idempotency_key_invalid");
  }
  return {
    headers:{"Content-Type":"application/json","Idempotency-Key":args.idempotencyKey},
    body:{predecessor_run_key:args.successor.predecessorRunKey,
      expected_envelope_digest:args.card.envelopeDigest!,
      confirmation:SIGNAL_TOPIC_EVALUATION_SUCCESSOR_CONFIRMATION,
      hard_cap_micro_usd:args.card.hardCapMicroUsd!}
  } as const;
}

export function acquireSignalTopicEvaluationSubmissionLockV1(lock: { current: boolean }) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function readSignalTopicEvaluationRunStatusV1(value: unknown): "queued" {
  if (!isObject(value) || value.status !== "queued") {
    throw new Error("topic_evaluation_run_status_invalid");
  }
  return value.status;
}
