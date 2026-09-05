import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROTECTED_RELEASE_EXECUTOR_APPROVAL_V1,
  PROTECTED_RELEASE_EXECUTOR_PATHS_V1,
  PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1,
  PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1,
  attestProtectedReleaseExecutorCapabilityV1,
  type ProtectedReleaseExecutorDependenciesV1
} from "./attest-signal-topic-evaluation-protected-release-executor";

const NOW=Date.parse("2026-09-04T18:00:00.000Z");
const DUMP="sha256:1111111111111111111111111111111111111111111111111111111111111111";
const RESTORE="sha256:2222222222222222222222222222222222222222222222222222222222222222";
const WORKER="sha256:3333333333333333333333333333333333333333333333333333333333333333";

function fixtures(){return{
  policy:{contract_version:"noisia-protected-preview-uat-release-executor-policy-v1",
    environment:"Preview/UAT",production_allowed:false,
    target_fingerprint:PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1,
    toolchain:{mode:"fixed-root-owned-native",pg_dump_path:PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_dump,
      pg_dump_sha256:DUMP,pg_restore_path:PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_restore,
      pg_restore_sha256:RESTORE,docker_fallback_allowed:false},
    restore_custody:{directory:PROTECTED_RELEASE_EXECUTOR_PATHS_V1.restore_custody,
      owner_uid:0,mode:"0700"},
    secret_boundary:{env_name:PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1,
      scope:"preview-uat-topic-evaluation-0114-0115",max_lifetime_seconds:3600,
      persistent_storage_allowed:false},
    migrations:[{ordinal:114,name:"0114_signal_topic_evaluation_v2_execution_outbox.sql",
      sha256:"sha256:f63774eae48b6fc3332feafdd8d033afeb8d4ae44d5479fd87ea44fa26e02582"},
    {ordinal:115,name:"0115_signal_topic_evaluation_v2_candidate_review.sql",
      sha256:"sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946"}]},
  secret:{contract_version:"noisia-protected-release-ephemeral-secret-v1",
    recorded_at:new Date(NOW-60_000).toISOString(),expires_at:new Date(NOW+30*60_000).toISOString(),
    environment:"Preview/UAT",target_fingerprint:PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1,
    scope:"preview-uat-topic-evaluation-0114-0115",env_name:PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1,
    single_process:true,child_environment_allowlisted:true,persistent_storage:false},
  workers:{contract_version:"noisia-protected-release-workers-posture-v1",
    recorded_at:new Date(NOW-60_000).toISOString(),environment:"Preview/UAT",posture:"unchanged",
    deployment_digest_before:WORKER,expected_deployment_digest_after:WORKER,
    deployment_strategy:"protected-executor-studio-only",autodeploy_setting_mutation_allowed:false,
    watched_paths_intersection_acknowledged:true,health_status:200,v2_job_registered:false}
};}

function environment(overrides:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv{return{
  NOISIA_PROTECTED_RELEASE_EXECUTOR_ATTESTATION_ENABLED:"true",
  NOISIA_PROTECTED_RELEASE_EXECUTOR_APPROVAL:PROTECTED_RELEASE_EXECUTOR_APPROVAL_V1,
  NOISIA_PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT:PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1,
  [PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1]:"fixture-secret-never-observed",
  ...overrides};}

function harness(mutator?:(value:ReturnType<typeof fixtures>)=>void){
  const value=fixtures();mutator?.(value);const writes:Array<{path:string;value:unknown}>=[];
  const probes=new Map<string,{kind:"file"|"directory"|"other";uid:number;mode:number}>([
    [PROTECTED_RELEASE_EXECUTOR_PATHS_V1.policy,{kind:"file",uid:0,mode:0o100400}],
    [PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_dump,{kind:"file",uid:0,mode:0o100755}],
    [PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_restore,{kind:"file",uid:0,mode:0o100755}],
    [PROTECTED_RELEASE_EXECUTOR_PATHS_V1.secret_attestation,{kind:"file",uid:0,mode:0o100400}],
    [PROTECTED_RELEASE_EXECUTOR_PATHS_V1.workers_attestation,{kind:"file",uid:0,mode:0o100400}],
    [PROTECTED_RELEASE_EXECUTOR_PATHS_V1.restore_custody,{kind:"directory",uid:0,mode:0o40700}]
  ]);
  const dependencies:ProtectedReleaseExecutorDependenciesV1={now:()=>NOW,
    readJson:async(path)=>path===PROTECTED_RELEASE_EXECUTOR_PATHS_V1.policy?value.policy:
      path===PROTECTED_RELEASE_EXECUTOR_PATHS_V1.secret_attestation?value.secret:value.workers,
    probe:async(path)=>{const result=probes.get(path);if(!result)throw new Error(`unexpected probe ${path}`);
      return result;},digestFile:async(path)=>path===PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_dump?DUMP:RESTORE,
    writePrivateReceipt:async(path,receipt)=>{writes.push({path,value:receipt});}};
  return{dependencies,probes,writes,value};
}

test("protected executor is disabled before any host evidence or secret value is touched",async()=>{
  let touched=false;const dependencies:ProtectedReleaseExecutorDependenciesV1={now:()=>NOW,
    readJson:async()=>{touched=true;return{};},probe:async()=>{touched=true;throw new Error("no");},
    digestFile:async()=>{touched=true;return"";},writePrivateReceipt:async()=>{touched=true;}};
  await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({env:{},dependencies}),
    /disabled by default/u);assert.equal(touched,false);
});

test("valid fixture attests fixed native tools, private custody and unchanged Workers without network",async()=>{
  const run=harness();const receipt=await attestProtectedReleaseExecutorCapabilityV1({env:environment(),
    dependencies:run.dependencies});
  assert.equal(receipt.capability,"attested");assert.equal(receipt.target_fingerprint,
    PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1);assert.equal(receipt.toolchain.docker_fallback_allowed,false);
  assert.equal(receipt.secret_boundary.value_observed,false);assert.equal(receipt.workers_posture.posture,"unchanged");
  assert.deepEqual({database_connections:receipt.database_connections,network_requests:receipt.network_requests,
    migrations_applied:receipt.migrations_applied,product_writes:receipt.product_writes},
  {database_connections:0,network_requests:0,migrations_applied:0,product_writes:0});
  assert.equal(run.writes.length,1);assert.equal(run.writes[0]!.path,PROTECTED_RELEASE_EXECUTOR_PATHS_V1.receipt);
  assert.doesNotMatch(JSON.stringify(receipt),/fixture-secret-never-observed/u);
});

test("caller selectors, wrong target, missing approval and absent or blank secret handles fail closed",async()=>{
  for(const [name,value,expected] of [["PGHOST","other","Caller-selected"],
    ["NOISIA_PROTECTED_RELEASE_EXECUTOR_PG_DUMP","/tmp/pg_dump","Caller-selected"],
    ["NOISIA_PROTECTED_RELEASE_EXECUTOR_CONTAINER","mutable","Caller-selected"],
    ["NOISIA_PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT","sha256:"+"f".repeat(64),"not the sealed"],
    ["NOISIA_PROTECTED_RELEASE_EXECUTOR_APPROVAL","wrong","exact action-time"]] as const){
    const run=harness();await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({
      env:environment({[name]:value}),dependencies:run.dependencies}),new RegExp(expected,"u"));
    assert.equal(run.writes.length,0);
  }
  const missing=environment();delete missing[PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1];const run=harness();
  await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({env:missing,
    dependencies:run.dependencies}),/secret handle is absent or blank/u);assert.equal(run.writes.length,0);
  for(const secretHandle of ["", " \t\r\n "]){
    const blankRun=harness();
    await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({
      env:environment({[PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1]:secretHandle}),
      dependencies:blankRun.dependencies}),/secret handle is absent or blank/u);
    assert.equal(blankRun.writes.length,0);
  }
});

test("root ownership, immutable tool fingerprints and mode-0700 custody are mandatory",async()=>{
  for(const mutate of [(run:ReturnType<typeof harness>)=>run.probes.set(
    PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_dump,{kind:"file",uid:501,mode:0o100755}),
  (run:ReturnType<typeof harness>)=>run.probes.set(PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_restore,
    {kind:"file",uid:0,mode:0o100777}),
  (run:ReturnType<typeof harness>)=>run.probes.set(PROTECTED_RELEASE_EXECUTOR_PATHS_V1.restore_custody,
    {kind:"directory",uid:0,mode:0o40750})]){
    const run=harness();mutate(run);await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({
      env:environment(),dependencies:run.dependencies}),/ownership or mode|restore custody/u);
  }
  const run=harness();run.dependencies.digestFile=async()=>"sha256:"+"f".repeat(64);
  await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({env:environment(),
    dependencies:run.dependencies}),/fingerprint mismatch/u);
});

test("symlinks and every other wrong object kind fail for fixed files, evidence and custody",async()=>{
  const fixedFiles=[PROTECTED_RELEASE_EXECUTOR_PATHS_V1.policy,
    PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_dump,PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_restore,
    PROTECTED_RELEASE_EXECUTOR_PATHS_V1.secret_attestation,
    PROTECTED_RELEASE_EXECUTOR_PATHS_V1.workers_attestation];
  for(const path of fixedFiles){
    for(const kind of ["directory","other"] as const){
      const run=harness();run.probes.set(path,{kind,uid:0,mode:0o100700});
      await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({env:environment(),
        dependencies:run.dependencies}),/fixed file ownership or mode/u);
      assert.equal(run.writes.length,0);
    }
  }
  for(const kind of ["file","other"] as const){
    const custody=harness();custody.probes.set(PROTECTED_RELEASE_EXECUTOR_PATHS_V1.restore_custody,
      {kind,uid:0,mode:0o40700});
    await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({env:environment(),
      dependencies:custody.dependencies}),/restore custody/u);
    assert.equal(custody.writes.length,0);
  }
});

test("receipt parent is re-probed and rejects a symlink-like replacement before write",async()=>{
  const run=harness();const originalProbe=run.dependencies.probe;let custodyProbes=0;
  run.dependencies.probe=async(path)=>{
    if(path===PROTECTED_RELEASE_EXECUTOR_PATHS_V1.restore_custody && ++custodyProbes===2){
      return {kind:"other",uid:0,mode:0o40700};
    }
    return originalProbe(path);
  };
  await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({env:environment(),
    dependencies:run.dependencies}),/restore custody/u);
  assert.equal(custodyProbes,2);assert.equal(run.writes.length,0);
});

test("stale secret metadata and any mutable or active Workers posture fail closed",async()=>{
  const cases=[(value:ReturnType<typeof fixtures>)=>{value.secret.expires_at=new Date(NOW-1).toISOString();},
    (value:ReturnType<typeof fixtures>)=>{value.workers.expected_deployment_digest_after="sha256:"+"f".repeat(64);},
    (value:ReturnType<typeof fixtures>)=>{value.workers.autodeploy_setting_mutation_allowed=true;},
    (value:ReturnType<typeof fixtures>)=>{value.workers.v2_job_registered=true;},
    (value:ReturnType<typeof fixtures>)=>{value.workers.health_status=503;}];
  for(const mutate of cases){const run=harness(mutate);await assert.rejects(
    attestProtectedReleaseExecutorCapabilityV1({env:environment(),dependencies:run.dependencies}),
    /secret attestation|Workers posture/u);assert.equal(run.writes.length,0);}
});

test("policy and runtime evidence are closed and the attestor has no network or Docker implementation",async()=>{
  const extra=harness((value)=>Object.assign(value.policy,{caller_binary:"/tmp/pg_dump"}));
  await assert.rejects(attestProtectedReleaseExecutorCapabilityV1({env:environment(),
    dependencies:extra.dependencies}),/object is not closed/u);
  const source=await readFile(new URL("./attest-signal-topic-evaluation-protected-release-executor.ts",
    import.meta.url),"utf8");
  assert.doesNotMatch(source,/from ["']pg["']|node:net|node:http|node:https|child_process|docker exec/iu);
});
