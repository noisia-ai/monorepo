import { buildSignalTopicEvaluationExecutionFlightCardV2,signalTopicEvaluationDigestV2,
  type SignalTopicEvaluationFlightCardV2 } from
  "@noisia/query-engine";

import type { SignalTopicEvaluationV2ClaimedExecution } from "./signal-topic-evaluation-v2";

export const SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION =
  "AUTHORIZE_LOCAL_DISPOSABLE_FULL_EVIDENCE_TOPIC_EVALUATION" as const;
export const SIGNAL_TOPIC_EVALUATION_LAB_AUTHORITY_CONTRACT =
  "signal-topic-evaluation-disposable-lab-authority-v1" as const;

type Queryable={query<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:T[]}>};

type LabClaimRow={claimed:unknown};

export async function createAndClaimSignalTopicEvaluationLabExecutionV2(args:{queryable:Queryable;
  idempotency_key:string;expected_snapshot_digest:string;host_receipt_digest:string;
  container_identity_digest:string;confirmation:string}):Promise<SignalTopicEvaluationV2ClaimedExecution>{
  if(args.confirmation!==SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION
      || !/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)
      || ![args.expected_snapshot_digest,args.host_receipt_digest,args.container_identity_digest]
        .every((value)=>/^sha256:[0-9a-f]{64}$/u.test(value))){
    throw new Error("topic_evaluation_lab_execution_input_invalid");
  }
  const input={contract_version:SIGNAL_TOPIC_EVALUATION_LAB_AUTHORITY_CONTRACT,
    idempotency_key:args.idempotency_key,confirmation:args.confirmation,
    expected_snapshot_digest:args.expected_snapshot_digest,host_receipt_digest:args.host_receipt_digest,
    container_identity_digest:args.container_identity_digest};
  const row=(await args.queryable.query<LabClaimRow>(
    "SELECT signal_topic_evaluation_v2_lab_create_and_claim_v1($1::jsonb) claimed",
    [JSON.stringify(input)])).rows[0];
  return parseLabClaim(row?.claimed);
}

function parseLabClaim(value:unknown):SignalTopicEvaluationV2ClaimedExecution{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(
    "topic_evaluation_lab_execution_claim_invalid");
  const row=value as Record<string,unknown>;const configuration=row.configuration as Record<string,unknown>;
  const rawCard=configuration?.flight_card as Record<string,unknown>;
  const flightCard=buildSignalTopicEvaluationExecutionFlightCardV2({
    provider_calls_allowed:requireInteger(rawCard?.provider_calls_allowed),
    max_model_turns:requireInteger(rawCard?.max_model_turns),max_tool_calls:requireInteger(rawCard?.max_tool_calls),
    max_tool_result_bytes:requireInteger(rawCard?.max_tool_result_bytes),
    max_total_tool_result_bytes:requireInteger(rawCard?.max_total_tool_result_bytes),
    max_total_input_tokens:requireInteger(rawCard?.max_total_input_tokens),
    max_total_output_tokens:requireInteger(rawCard?.max_total_output_tokens),
    hard_cap_micro_usd:requireInteger(rawCard?.hard_cap_micro_usd)}) as SignalTopicEvaluationFlightCardV2;
  if(signalTopicEvaluationDigestV2(rawCard)!==signalTopicEvaluationDigestV2(flightCard))throw new Error(
    "topic_evaluation_lab_execution_claim_invalid");
  for(const key of ["run_id","workspace_id","requested_by_user_id","snapshot_id","snapshot_digest",
    "execution_authorization_id"]){if(typeof row[key]!=="string")throw new Error(
      "topic_evaluation_lab_execution_claim_invalid");}
  if(typeof configuration?.model!=="string"||!Number.isSafeInteger(configuration.input_micro_usd_per_token)
      ||!Number.isSafeInteger(configuration.output_micro_usd_per_token))throw new Error(
    "topic_evaluation_lab_execution_claim_invalid");
  return{run_id:row.run_id as string,workspace_id:row.workspace_id as string,
    requested_by_user_id:row.requested_by_user_id as string,snapshot_id:row.snapshot_id as string,
    snapshot_digest:row.snapshot_digest as string,
    execution_authorization_id:row.execution_authorization_id as string,
    configuration:{model:configuration.model as string,
      input_micro_usd_per_token:configuration.input_micro_usd_per_token as number,
      output_micro_usd_per_token:configuration.output_micro_usd_per_token as number,flight_card:flightCard}};
}

function requireInteger(value:unknown){if(!Number.isSafeInteger(value))throw new Error(
  "topic_evaluation_lab_execution_claim_invalid");return value as number;}
