/** Direct, no-queue execution composition root for the externally anchored disposable Lab. */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAndClaimSignalTopicEvaluationLabExecutionV2,
  SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION } from "@noisia/db";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { generateAnthropicBoundedTextV1 } from "../src/providers/anthropic-bounded-text";
import { createAnthropicFullEvidenceTopicEvaluationModelV2 } from
  "../src/providers/anthropic-full-evidence-topic-evaluation";
import { processSignalTopicEvaluationV2ProviderRun } from
  "../src/workers/signal-topic-evaluation-v2";
import { createSignalTopicEvaluationLabDockerWritePoolV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { createSignalTopicEvaluationLabDockerPoolV1 } from
  "./signal-topic-evaluation-lab-docker-pool-v2";
import { preflightSignalTopicEvaluationLabV2,prepareSignalTopicEvaluationLabInvocationV2,
  SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME } from
  "./preflight-signal-topic-evaluation-lab-v2";

export const SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_ENABLED =
  "NOISIA_TOPIC_EVALUATION_LAB_EXECUTION_ENABLED";
export const SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION_NAME =
  "NOISIA_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION";
export const SIGNAL_TOPIC_EVALUATION_LAB_IDEMPOTENCY_NAME =
  "NOISIA_TOPIC_EVALUATION_LAB_IDEMPOTENCY_KEY";
export const SIGNAL_TOPIC_EVALUATION_LAB_MIGRATION_0116_SHA256 =
  "sha256:02a53637d73be36c4001536a05fc112fb0d7f0aceb32878cb45939e7533e9664";

type Dependencies={
  prepare:typeof prepareSignalTopicEvaluationLabInvocationV2;
  preflight:typeof preflightSignalTopicEvaluationLabV2;
  createReadPool:typeof createSignalTopicEvaluationLabDockerPoolV1;
  createWritePool:typeof createSignalTopicEvaluationLabDockerWritePoolV2;
  createAndClaim:typeof createAndClaimSignalTopicEvaluationLabExecutionV2;
  process:typeof processSignalTopicEvaluationV2ProviderRun;
  readCredential(env:NodeJS.ProcessEnv):string;
  createModel(credential:string,input:Parameters<Parameters<typeof processSignalTopicEvaluationV2ProviderRun>[0]["create_model"]>[0]):ReturnType<Parameters<typeof processSignalTopicEvaluationV2ProviderRun>[0]["create_model"]>;
};

const defaults:Dependencies={prepare:prepareSignalTopicEvaluationLabInvocationV2,
  preflight:preflightSignalTopicEvaluationLabV2,
  createReadPool:createSignalTopicEvaluationLabDockerPoolV1,
  createWritePool:createSignalTopicEvaluationLabDockerWritePoolV2,
  createAndClaim:createAndClaimSignalTopicEvaluationLabExecutionV2,
  process:processSignalTopicEvaluationV2ProviderRun,
  readCredential:readSignalTopicEvaluationLabCredentialOnceV2,
  createModel:(credential,input)=>{
    const provider=createAnthropic({apiKey:credential});
    return createAnthropicFullEvidenceTopicEvaluationModelV2({model:input.model,
      snapshot_digest:input.snapshot_digest,max_output_tokens:input.max_output_tokens,
      pricing:{input_micro_usd_per_token:input.input_micro_usd_per_token,
        output_micro_usd_per_token:input.output_micro_usd_per_token}},
    (request)=>generateAnthropicBoundedTextV1(request,provider));
  }};

export async function runSignalTopicEvaluationLabExecutionV2(env:NodeJS.ProcessEnv,
  dependencies:Dependencies=defaults){
  if(env[SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_ENABLED]!=="true")throw new Error(
    "topic_evaluation_lab_execution_disabled");
  if(env[SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION_NAME]!==
      SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION)throw new Error(
    "topic_evaluation_lab_execution_confirmation_required");
  const idempotency=env[SIGNAL_TOPIC_EVALUATION_LAB_IDEMPOTENCY_NAME];
  if(typeof idempotency!=="string"||!/^[A-Za-z0-9._:-]{8,200}$/u.test(idempotency))throw new Error(
    "topic_evaluation_lab_execution_idempotency_invalid");
  // Presence is checked without reading the value. The value is read once, after durable claim,
  // at the exact transport boundary.
  if(!Object.hasOwn(env,SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME))throw new Error(
    "topic_evaluation_lab_provider_credential_unavailable");
  const prepared=await dependencies.prepare(env);
  const receipt=await dependencies.preflight({pool:dependencies.createReadPool(prepared.anchor),
    target:prepared.target,host_receipt:prepared.anchor,
    provider_configuration_present:true,write_receipt:false});
  if(receipt.effects.database_writes!==0||receipt.effects.provider_calls!==0||
      receipt.effects.runs!==0||receipt.effects.candidates!==0)throw new Error(
    "topic_evaluation_lab_execution_preflight_not_pristine");
  const pool=dependencies.createWritePool(prepared.anchor);
  const immediate=(await pool.query<{ledger_count:number;authorities:number;runs:number;outboxes:number;
    candidates:number}>(`SELECT
    (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=116
      AND migration_name='0116_signal_topic_evaluation_disposable_lab_execution.sql'
      AND checksum_sha256=$1 AND disposition='applied') ledger_count,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations) authorities,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_runs) runs,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_outbox) outboxes,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates`,
  [SIGNAL_TOPIC_EVALUATION_LAB_MIGRATION_0116_SHA256])).rows[0];
  if(!immediate||immediate.ledger_count!==1||immediate.authorities!==0||immediate.runs!==0||
      immediate.outboxes!==0||immediate.candidates!==0)throw new Error(
    "topic_evaluation_lab_execution_immediate_authority_invalid");
  const credential=dependencies.readCredential(env);
  const claimed=await dependencies.createAndClaim({queryable:pool,idempotency_key:idempotency,
    expected_snapshot_digest:receipt.source_authority.snapshot_digest,
    host_receipt_digest:prepared.anchor.receipt_digest,
    container_identity_digest:signalTopicEvaluationDigestV2({container_id:prepared.anchor.container_id,
      image_id:prepared.anchor.image_id}),confirmation:SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION});
  const terminal=await dependencies.process({pool:pool as never,run_id:claimed.run_id,
    claimed_execution:claimed,create_model:(input)=>dependencies.createModel(credential,input)});
  return{contract_version:"signal-topic-evaluation-disposable-lab-execution-result-v1" as const,
    status:terminal.status,run_key_digest:signalTopicEvaluationDigestV2(claimed.run_id),
    provider_call_count:terminal.provider_call_count,
    candidate_count:"candidate_count" in terminal?terminal.candidate_count:0,
    settled_micro_usd:terminal.settled_micro_usd,no_retry:true as const,queue_used:false as const,
    outbox_used:false as const,topic_adoption:false as const,publication:false as const,
    serving:false as const,uat_connections:0 as const,production_accessed:false as const};
}

export function readSignalTopicEvaluationLabCredentialOnceV2(env:NodeJS.ProcessEnv){
  const value=env[SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME];
  if(typeof value!=="string"||value.trim()==="")throw new Error(
    "topic_evaluation_lab_provider_credential_unavailable");
  return value;
}

if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  runSignalTopicEvaluationLabExecutionV2(process.env).then((result)=>{
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error:unknown)=>{process.stderr.write(`${error instanceof Error?error.message:"lab_execution_failed"}\n`);
    process.exitCode=1;});
}
