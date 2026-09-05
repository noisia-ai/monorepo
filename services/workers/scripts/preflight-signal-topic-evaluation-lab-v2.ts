/**
 * Local-only, provider-disabled preflight for a disposable Full Evidence Topic Evaluation Lab.
 *
 * This runner opens one explicitly named loopback PostgreSQL clone in REPEATABLE READ READ ONLY,
 * re-verifies the registered private artifact bundle, and writes one sanitized 0600 receipt. It
 * never imports the Worker process, BullMQ, a product credential loader, or a provider transport.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyRegisteredSignalTopicEvaluationArtifactsV2 } from "@noisia/db";
import { buildSignalTopicEvaluationExecutionFlightCardV2,
  signalTopicEvaluationDigestV2 } from "@noisia/query-engine";
import pg from "pg";

process.umask(0o077);

export const SIGNAL_TOPIC_EVALUATION_LAB_V2_SOURCE_RUN =
  "backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17";
export const SIGNAL_TOPIC_EVALUATION_LAB_V2_RUNTIME_PROFILE = "local_disposable_lab_v1";
export const SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME =
  "NOISIA_TOPIC_EVALUATION_LAB_ANTHROPIC_API_KEY";
export const SIGNAL_TOPIC_EVALUATION_LAB_V2_ENTRYPOINT =
  "services/workers/src/workers/signal-topic-evaluation-v2.ts#processSignalTopicEvaluationV2ProviderRun";
const EXPECTED_MIGRATIONS = Object.freeze([
  { ordinal:112,name:"0112_signal_topic_evaluation_full_evidence_control_plane.sql",
    sha256:"sha256:51f6fbff712ec1737b41da9997bda86b068abb81f4edafc9a338af590c462ab5" },
  { ordinal:113,name:"0113_signal_topic_evaluation_full_evidence_execution_authority.sql",
    sha256:"sha256:8bb7f5be275d33d4f284f72a9e882314f488466ccdd3adee3ade2acb195f0f71" },
  { ordinal:114,name:"0114_signal_topic_evaluation_v2_execution_outbox.sql",
    sha256:"sha256:f63774eae48b6fc3332feafdd8d033afeb8d4ae44d5479fd87ea44fa26e02582" }
]);
const MIGRATION_0115 = Object.freeze({
  name:"0115_signal_topic_evaluation_v2_candidate_review.sql",
  sha256:"sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946"
});
const MAX_REMAINING_BUDGET_MICRO_USD = 18_147_816;
const INPUT_MICRO_USD_PER_TOKEN = 3;
const OUTPUT_MICRO_USD_PER_TOKEN = 15;
const MAX_INPUT_TOKENS = 450_000;
const MAX_OUTPUT_TOKENS = 50_000;
const COST_MAXIMUM_MICRO_USD = MAX_INPUT_TOKENS*INPUT_MICRO_USD_PER_TOKEN
  +MAX_OUTPUT_TOKENS*OUTPUT_MICRO_USD_PER_TOKEN;
const LAB_NAME = /^noisia_topic_eval_lab_[a-z0-9_]{8,64}$/u;
const REMOTE_ENVIRONMENT_LABEL = /(?:^|_)(?:preview|uat|staging|prod|production)(?:_|$)/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

type QueryResult<T>={rows:T[]};
type LabClient={query<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<QueryResult<T>>;
  release():void};
type LabPool={connect():Promise<LabClient>};
type ArtifactProof={records:number;labels:number;topics:number;assigned:number;outliers:number;
  source_manifest_digest:string;packet_source_manifest_digest:string;source_export_digest:string;
  assignment_digest:string;result_digest:string;packet_file_digest:string;packet_digest:string;
  artifact_binding_digest:string};
type Dependencies={now():number;verifyArtifacts(sourceRunKey:string):Promise<ArtifactProof>;
  migration0115Digest():Promise<string>;writeReceipt(receipt:unknown):Promise<void>};

export class SignalTopicEvaluationLabPreflightError extends Error {
  constructor(public readonly code:string){super(code);this.name="SignalTopicEvaluationLabPreflightError";}
}

export function signalTopicEvaluationLabProviderConfiguredV2(env:NodeJS.ProcessEnv){
  return Object.hasOwn(env,SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME);
}

export function prepareSignalTopicEvaluationLabInvocationV2(env:NodeJS.ProcessEnv){
  if(env.NOISIA_RUNTIME_PROFILE!==SIGNAL_TOPIC_EVALUATION_LAB_V2_RUNTIME_PROFILE){
    throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_runtime_profile_invalid");
  }
  const clone=env.NOISIA_TOPIC_EVALUATION_LAB_CLONE_NAME??"";
  const connectionString=env.NOISIA_TOPIC_EVALUATION_LAB_DATABASE_URL??"";
  return{connectionString,target:parseSignalTopicEvaluationLabTargetV2(connectionString,clone),
    provider_configuration_present:signalTopicEvaluationLabProviderConfiguredV2(env)};
}

export function parseSignalTopicEvaluationLabTargetV2(raw:string,expectedCloneName:string){
  let target:URL;
  try{target=new URL(raw);}catch{throw new SignalTopicEvaluationLabPreflightError(
    "topic_evaluation_lab_target_invalid");}
  const database=decodeURIComponent(target.pathname.replace(/^\//u,""));
  const loopback=target.hostname==="127.0.0.1"||target.hostname==="localhost"||target.hostname==="[::1]";
  const port=Number(target.port||"5432");
  if((target.protocol!=="postgres:"&&target.protocol!=="postgresql:")||!loopback
      ||target.search!==""||target.hash!==""||!LAB_NAME.test(expectedCloneName)
      ||REMOTE_ENVIRONMENT_LABEL.test(expectedCloneName)
      ||database!==expectedCloneName||!Number.isSafeInteger(port)||port<1024||port>65535){
    throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_target_invalid");
  }
  const endpointClass="named-loopback-disposable-clone" as const;
  return{database,port,endpoint_class:endpointClass,target_fingerprint:signalTopicEvaluationDigestV2({
    contract_version:"signal-topic-evaluation-lab-target-v1",endpoint_class:endpointClass,
    database,port})};
}

export async function preflightSignalTopicEvaluationLabV2(args:{
  pool:LabPool;target:ReturnType<typeof parseSignalTopicEvaluationLabTargetV2>;
  provider_configuration_present:boolean;dependencies?:Dependencies
}){
  const dependencies=args.dependencies??realDependencies;
  if(await dependencies.migration0115Digest()!==MIGRATION_0115.sha256){
    throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_migration_checksum_mismatch");
  }
  const artifacts=await dependencies.verifyArtifacts(SIGNAL_TOPIC_EVALUATION_LAB_V2_SOURCE_RUN);
  assertArtifactProof(artifacts);
  const client=await args.pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity=(await client.query<{database_name:string;read_only:string}>(
      "SELECT current_database() database_name,current_setting('transaction_read_only') read_only"))
      .rows[0];
    if(identity?.database_name!==args.target.database||identity.read_only!=="on"){
      throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_database_identity_invalid");
    }
    const authority=(await client.query<AuthorityRow>(AUTHORITY_SQL)).rows[0];
    assertAuthority(authority,artifacts);
    const markerPresent=(await client.query<{marker_present:boolean}>(
      "SELECT to_regclass('noisia_topic_evaluation_lab.clone_provenance') IS NOT NULL marker_present"))
      .rows[0]?.marker_present;
    if(markerPresent!==true)throw new SignalTopicEvaluationLabPreflightError(
      "topic_evaluation_lab_clone_provenance_missing");
    const marker=(await client.query<CloneProvenanceRow>(CLONE_PROVENANCE_SQL)).rows;
    const cloneProvenanceDigest=assertCloneProvenance(marker,args.target,authority!);
    const ledger=(await client.query<LedgerRow>(`SELECT ordinal,migration_name,checksum_sha256,disposition
      FROM signal_workspace_data_plane_migration_ledger WHERE ordinal BETWEEN 112 AND 114 ORDER BY ordinal`)).rows;
    assertLedger(ledger);
    const sentinels=(await client.query<SentinelRow>(SENTINEL_SQL)).rows[0];
    if(!sentinels||Object.values(sentinels).some((value)=>value!==true)){
      throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_schema_incomplete");
    }
    const work=(await client.query<WorkRow>(WORK_SQL)).rows[0];
    if(!work||Object.values(work).some((value)=>Number(value)!==0)){
      throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_not_empty");
    }
    const txid=(await client.query<{value:string|null}>("SELECT txid_current_if_assigned()::text value"))
      .rows[0]?.value;
    if(txid!==null)throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_read_only_violated");
    await client.query("ROLLBACK");
    const futureCard=buildSignalTopicEvaluationExecutionFlightCardV2({provider_calls_allowed:12,
      max_model_turns:12,max_tool_calls:24,max_tool_result_bytes:32_768,
      max_total_tool_result_bytes:262_144,max_total_input_tokens:MAX_INPUT_TOKENS,
      max_total_output_tokens:MAX_OUTPUT_TOKENS,hard_cap_micro_usd:COST_MAXIMUM_MICRO_USD});
    const receipt={contract_version:"signal-topic-evaluation-disposable-lab-preflight-v1" as const,
      recorded_at:new Date(dependencies.now()).toISOString(),status:"ready_for_independent_audit" as const,
      target:{clone_name:args.target.database,endpoint_class:args.target.endpoint_class,
        port:args.target.port,target_fingerprint:args.target.target_fingerprint,uri_recorded:false,
        password_recorded:false,runtime_profile:SIGNAL_TOPIC_EVALUATION_LAB_V2_RUNTIME_PROFILE,
        clone_provenance_digest:cloneProvenanceDigest,preview_uat:false,production:false},
      source_authority:{import_contract_version:"signal-topic-evaluation-frozen-membership-import-v1",
        source_run_key:SIGNAL_TOPIC_EVALUATION_LAB_V2_SOURCE_RUN,algorithm:"bertopic-bge-detail",seed:17,
        canonical_roots:21_195,historical_proposals:115,catalog_entries:116,assigned:11_186,
        outliers:10_009,snapshot_digest:authority!.snapshot_digest,rights_digest:authority!.rights_digest,
        semantic_context_authority_digest:authority!.semantic_context_authority_digest,
        source_manifest_digest:authority!.source_manifest_digest,
        packet_source_manifest_digest:authority!.packet_source_manifest_digest,
        source_export_digest:authority!.source_export_digest,
        source_assignment_digest:authority!.source_assignment_digest,
        source_result_digest:authority!.source_result_digest,
        source_packet_file_digest:authority!.source_packet_file_digest,
        packet_digest:authority!.packet_digest,artifact_binding_digest:authority!.artifact_binding_digest,
        membership_binding_digest:authority!.membership_binding_digest,registered_importer_verified:true},
      flight_card:{purpose:"evaluate_full_frozen_corpus_for_editable_topic_candidates" as const,
        model:"claude-sonnet-5",pricing_version:"anthropic-2026-08-29",
        input_micro_usd_per_token:INPUT_MICRO_USD_PER_TOKEN,
        output_micro_usd_per_token:OUTPUT_MICRO_USD_PER_TOKEN,
        execution_enabled:false,provider_transport_allowed:false,provider_calls_current_gate:0,
        evaluations_allowed:1,
        future_limits:{...futureCard,execution_enabled:false},cost_maximum_micro_usd:COST_MAXIMUM_MICRO_USD,
        aggregate_budget_ceiling_micro_usd:MAX_REMAINING_BUDGET_MICRO_USD,
        success_minimum_candidates:10,output_status:"pending" as const,
        preserve_complete_candidate_pool:true,top_10_is_projection:true,no_automatic_retry:true,
        action_time_confirmation_required:true,adoption_allowed:false,publication_allowed:false,
        serving_allowed:false},
      isolated_execution_path:{entrypoint:SIGNAL_TOPIC_EVALUATION_LAB_V2_ENTRYPOINT,
        composition:"direct-local-in-process" as const,provider_adapter_injection_supported:true,
        provider_configuration_name:SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME,
        provider_configuration_present:args.provider_configuration_present,
        provider_credential_value_observed:false,product_credential_lane_used:false,
        uat_worker_process_used:false,queue_used:false,outbox_used:false},
      migrations:{ledger:ledger.map(({ordinal,migration_name,checksum_sha256})=>({ordinal,
        name:migration_name,sha256:checksum_sha256})),candidate_review:{...MIGRATION_0115,
        applied_to_disposable_clone:true}},
      effects:{database_writes:0,provider_calls:0,queue_jobs:0,runs:0,candidates:0,adoptions:0,
        publications:0,serving_effects:0,uat_connections:0,production_accessed:false}};
    await dependencies.writeReceipt(receipt);
    return receipt;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

type AuthorityRow={snapshots:number;catalog_entries:number;historical_proposals:number;
  canonical_roots:number;unique_assignment_indexes:number;unique_mentions:number;unique_source_records:number;
  assigned:number;outliers:number;state:string;import_contract_version:string;source_run_key:string;
  source_algorithm_key:string;source_seed:number;snapshot_digest:string;rights_digest:string;
  semantic_context_authority_digest:string;source_manifest_digest:string;packet_source_manifest_digest:string;
  source_export_digest:string;source_assignment_digest:string;source_result_digest:string;
  source_packet_file_digest:string;packet_digest:string;artifact_binding_digest:string;
  membership_binding_digest:string};
type LedgerRow={ordinal:number;migration_name:string;checksum_sha256:string;disposition:string};
type CloneProvenanceRow={marker_namespace:string;contract_version:string;clone_name:string;
  source_run_key:string;source_snapshot_digest:string;source_artifact_binding_digest:string;
  recorded_system_identifier:string;current_system_identifier:string};
type SentinelRow={review_operations:boolean;editorial_revisions:boolean;review_events:boolean;
  pending_only_candidates:boolean;no_adoption_publication_serving:boolean};
type WorkRow={authorities:number;runs:number;outboxes:number;retrievals:number;model_turns:number;
  candidates:number;candidate_evidence:number;rankings:number;review_operations:number;
  editorial_revisions:number;review_events:number;provider_calls:number};

const AUTHORITY_SQL=`SELECT
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_snapshots) snapshots,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_clusters) catalog_entries,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_clusters WHERE proposal_key IS NOT NULL) historical_proposals,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships) canonical_roots,
  (SELECT count(DISTINCT assignment_index)::int FROM signal_topic_evaluation_v2_cluster_memberships) unique_assignment_indexes,
  (SELECT count(DISTINCT mention_id)::int FROM signal_topic_evaluation_v2_cluster_memberships) unique_mentions,
  (SELECT count(DISTINCT source_record_key)::int FROM signal_topic_evaluation_v2_cluster_memberships) unique_source_records,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE assignment_label>=0) assigned,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE assignment_label=-1) outliers,
  snapshot.state,snapshot.import_contract_version,snapshot.source_run_key,snapshot.source_algorithm_key,
  snapshot.source_seed,snapshot.snapshot_digest,snapshot.rights_digest,
  snapshot.semantic_context_authority_digest,snapshot.source_manifest_digest,
  snapshot.packet_source_manifest_digest,snapshot.source_export_digest,snapshot.source_assignment_digest,
  snapshot.source_result_digest,snapshot.source_packet_file_digest,snapshot.packet_digest,
  snapshot.artifact_binding_digest,snapshot.membership_binding_digest
FROM signal_topic_evaluation_v2_snapshots snapshot LIMIT 1`;
const CLONE_PROVENANCE_SQL=`SELECT marker_namespace,contract_version,clone_name,source_run_key,
  source_snapshot_digest,source_artifact_binding_digest,system_identifier recorded_system_identifier,
  (pg_control_system()).system_identifier::text current_system_identifier
FROM noisia_topic_evaluation_lab.clone_provenance`;
const SENTINEL_SQL=`SELECT
  to_regclass('signal_topic_evaluation_v2_candidate_review_operations') IS NOT NULL review_operations,
  to_regclass('signal_topic_evaluation_v2_candidate_editorial_revisions') IS NOT NULL editorial_revisions,
  to_regclass('signal_topic_evaluation_v2_candidate_review_events') IS NOT NULL review_events,
  position('status = ''pending''' in COALESCE(pg_get_constraintdef(
    (SELECT oid FROM pg_constraint WHERE conname='signal_topic_evaluation_v2_candidate_shape')),''))>0 pending_only_candidates,
  position('NOT adopted' in COALESCE(pg_get_constraintdef(
    (SELECT oid FROM pg_constraint WHERE conname='signal_topic_evaluation_v2_candidate_shape')),''))>0
    AND position('NOT published' in COALESCE(pg_get_constraintdef(
    (SELECT oid FROM pg_constraint WHERE conname='signal_topic_evaluation_v2_candidate_shape')),''))>0
    AND position('NOT serving' in COALESCE(pg_get_constraintdef(
    (SELECT oid FROM pg_constraint WHERE conname='signal_topic_evaluation_v2_candidate_shape')),''))>0
    no_adoption_publication_serving`;
const WORK_SQL=`SELECT
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations) authorities,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_runs) runs,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_outbox) outboxes,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals) retrievals,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns) model_turns,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence) candidate_evidence,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings) rankings,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_review_operations) review_operations,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_editorial_revisions) editorial_revisions,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_review_events) review_events,
  (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs) provider_calls`;

function assertArtifactProof(value:ArtifactProof){
  if(value.records!==21_195||value.labels!==21_195||value.topics!==115||value.assigned!==11_186
      ||value.outliers!==10_009||[value.source_manifest_digest,value.packet_source_manifest_digest,
        value.source_export_digest,value.assignment_digest,value.result_digest,value.packet_file_digest,
        value.packet_digest,value.artifact_binding_digest].some((item)=>!DIGEST.test(item))){
    throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_artifact_authority_invalid");
  }
}
function assertAuthority(row:AuthorityRow|undefined,artifacts:ArtifactProof){
  if(!row||row.snapshots!==1||row.catalog_entries!==116||row.historical_proposals!==115
      ||row.canonical_roots!==21_195||row.unique_assignment_indexes!==21_195
      ||row.unique_mentions!==21_195||row.unique_source_records!==21_195||row.assigned!==11_186
      ||row.outliers!==10_009||row.state!=="frozen"
      ||row.import_contract_version!=="signal-topic-evaluation-frozen-membership-import-v1"
      ||row.source_run_key!==SIGNAL_TOPIC_EVALUATION_LAB_V2_SOURCE_RUN
      ||row.source_algorithm_key!=="bertopic-bge-detail"||row.source_seed!==17
      ||row.source_manifest_digest!==artifacts.source_manifest_digest
      ||row.packet_source_manifest_digest!==artifacts.packet_source_manifest_digest
      ||row.source_export_digest!==artifacts.source_export_digest
      ||row.source_assignment_digest!==artifacts.assignment_digest
      ||row.source_result_digest!==artifacts.result_digest
      ||row.source_packet_file_digest!==artifacts.packet_file_digest
      ||row.packet_digest!==artifacts.packet_digest
      ||row.artifact_binding_digest!==artifacts.artifact_binding_digest
      ||[row.snapshot_digest,row.rights_digest,row.semantic_context_authority_digest,
        row.membership_binding_digest].some((item)=>!DIGEST.test(item))){
    throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_frozen_authority_mismatch");
  }
}
function assertCloneProvenance(rows:CloneProvenanceRow[],target:ReturnType<
  typeof parseSignalTopicEvaluationLabTargetV2>,authority:AuthorityRow){
  const row=rows[0];
  if(rows.length!==1||!row||row.marker_namespace!=="noisia.topic-evaluation.disposable-lab-clone"
      ||row.contract_version!=="signal-topic-evaluation-lab-clone-provenance-v1"
      ||row.clone_name!==target.database||row.source_run_key!==SIGNAL_TOPIC_EVALUATION_LAB_V2_SOURCE_RUN
      ||row.source_snapshot_digest!==authority.snapshot_digest
      ||row.source_artifact_binding_digest!==authority.artifact_binding_digest
      ||!/^\d+$/u.test(row.recorded_system_identifier)
      ||row.recorded_system_identifier!==row.current_system_identifier){
    throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_clone_provenance_invalid");
  }
  return signalTopicEvaluationDigestV2({marker_namespace:row.marker_namespace,
    contract_version:row.contract_version,clone_name:row.clone_name,source_run_key:row.source_run_key,
    source_snapshot_digest:row.source_snapshot_digest,
    source_artifact_binding_digest:row.source_artifact_binding_digest,
    system_identifier:row.recorded_system_identifier});
}
function assertLedger(rows:LedgerRow[]){
  if(rows.length!==EXPECTED_MIGRATIONS.length||rows.some((row,index)=>{
    const expected=EXPECTED_MIGRATIONS[index]!;return Number(row.ordinal)!==expected.ordinal
      ||row.migration_name!==expected.name||row.checksum_sha256!==expected.sha256
      ||row.disposition!=="applied";})){
    throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_migration_ledger_invalid");
  }
}

const REPO_ROOT=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const realDependencies:Dependencies={now:()=>Date.now(),verifyArtifacts:async(sourceRunKey)=>{
  const value=await verifyRegisteredSignalTopicEvaluationArtifactsV2(sourceRunKey);return{
    records:value.records.length,labels:value.labels.length,topics:value.topics.length,
    assigned:value.assigned_count,outliers:value.outlier_count,
    source_manifest_digest:value.source_manifest_digest,
    packet_source_manifest_digest:value.packet_source_manifest_digest,
    source_export_digest:value.source_export_digest,assignment_digest:value.assignment_digest,
    result_digest:value.result_digest,packet_file_digest:value.packet_file_digest,
    packet_digest:value.packet_digest,artifact_binding_digest:value.artifact_binding_digest};},
  migration0115Digest:async()=>`sha256:${createHash("sha256").update(await readFile(resolve(REPO_ROOT,
    "infrastructure/db/migrations",MIGRATION_0115.name))).digest("hex")}`,
  writeReceipt:async(receipt)=>{const raw=process.env.NOISIA_TOPIC_EVALUATION_LAB_EVIDENCE_DIR;
    if(!raw)throw new SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_evidence_directory_required");
    const directory=resolve(raw);const allowed=resolve(REPO_ROOT,".data/signal-topic-evaluation/lab-1");
    if(directory!==allowed&&!directory.startsWith(`${allowed}/`))throw new SignalTopicEvaluationLabPreflightError(
      "topic_evaluation_lab_evidence_directory_invalid");
    await mkdir(directory,{recursive:true,mode:0o700});await writeFile(resolve(directory,"preflight.sanitized.json"),
      `${JSON.stringify(receipt,null,2)}\n`,{mode:0o600,flag:"wx"});}};

async function main(){
  if(process.env.NOISIA_TOPIC_EVALUATION_LAB_PREFLIGHT_ENABLED!=="true")throw new
    SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_preflight_disabled");
  if(process.env.NOISIA_TOPIC_EVALUATION_V2_EXECUTION_ENABLED==="true")throw new
    SignalTopicEvaluationLabPreflightError("topic_evaluation_lab_uat_runtime_forbidden");
  const invocation=prepareSignalTopicEvaluationLabInvocationV2(process.env);
  const pool=new pg.Pool({connectionString:invocation.connectionString,
    ssl:false,max:1,application_name:"noisia-topic-evaluation-disposable-lab-preflight"});
  try{const receipt=await preflightSignalTopicEvaluationLabV2({pool,target:invocation.target,
    provider_configuration_present:invocation.provider_configuration_present});
    console.log(JSON.stringify({status:receipt.status,target:receipt.target,
      source_authority:receipt.source_authority,flight_card:receipt.flight_card,
      isolated_execution_path:receipt.isolated_execution_path,effects:receipt.effects}));}
  finally{await pool.end();}
}

const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain)await main().catch((error:unknown)=>{console.error(error instanceof
  SignalTopicEvaluationLabPreflightError?error.code:"topic_evaluation_lab_preflight_failed");process.exitCode=1;});
