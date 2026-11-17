import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {open,readFile,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateDefaultRuntimePairV1,validateDefaultRuntimeV1} from './statement-default-contract.mjs';

export const PROFILE_ONLY_TARGET_SHA_V1='b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1';
export const PROFILE_ONLY_MAX_NODE_PROFILE_BYTES_V1=32*1024*1024;
export const PROFILE_ONLY_MAX_PG_PROFILE_BYTES_V1=4*1024*1024;
export const PROFILE_ONLY_MAX_TOTAL_BYTES_V1=64*1024*1024;
export const PROFILE_ONLY_PG_CPU_INTERVAL_MS_V1=0;
const MAINLAB_PATHS=[
 'infrastructure/db/migrations/0330_signal_listening_statement_shared_wire.sql',
 'infrastructure/db/migrations/0331_signal_listening_statement_payload.sql',
 'infrastructure/db/migrations/signal-listening-statement-shared-wire.fixture.ts',
 'infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle.ts',
 'infrastructure/db/migrations/signal-listening-statement-shared-wire.postgres.test.ts',
 'infrastructure/db/migrations/signal-listening-statement-shared-wire.test.ts',
];
export const PROFILE_ONLY_ARTIFACT_INPUT_FILES_V1=Object.freeze(['mainlab-default-before.json','mainlab-default-after.json','mainlab-default-runtime.json',
 'node-profile.json','postgres-profile.json','profile-only.test.receipt.json','profile-only.test.tap',
 'profile-pg-cpu.test.receipt.json','profile-pg-cpu.test.tap',
 'run.json','run.test.receipt.json','run.test.tap','v8-main-thread-profile.json']);
export function assertProfileOnlyArtifactFileSetV1(names){
 assert.deepEqual([...names].sort(),[...PROFILE_ONLY_ARTIFACT_INPUT_FILES_V1].sort(),'profile_only_artifact_files_invalid');
 return true;
}
export function profileOnlyEnvelopeErrorCodeV1(error){
 const firstLine=error instanceof Error?error.message.split(/\r?\n/u,1)[0]:'';
 return typeof firstLine==='string'&&/^profile_only_[a-z0-9_]{1,100}$/u.test(firstLine)?firstLine:'profile_only_envelope_failed';
}
export function assertProfileOnlyPgIntervalV1(pgProfile){
 assert.equal(pgProfile?.limits?.configured_interval_ms,PROFILE_ONLY_PG_CPU_INTERVAL_MS_V1,'profile_only_pg_interval_invalid');
 return true;
}
export const PROFILE_ONLY_REQUIRED_PROBE_FILES_V1=['.github/workflows/r16-listening-profile-only.yml',
 '.github/workflows/r16-listening-small-diagnostic.yml','.github/workflows/mfp-postgres.yml',
 'scripts/r16-diagnostics/listening-small/run.mts','scripts/r16-diagnostics/listening-small/run.test.mts',
 'scripts/r16-diagnostics/listening-small/observer.mts','scripts/r16-diagnostics/listening-small/mainlab-default-runtime.mjs',
 'scripts/r16-diagnostics/listening-small/mainlab-default-runtime.d.mts','scripts/r16-diagnostics/listening-small/statement-default-contract.mjs',
 'scripts/r16-diagnostics/listening-small/statement-default-contract.d.mts','scripts/r16-diagnostics/listening-small/main-thread-profile.mjs',
 'scripts/r16-diagnostics/listening-small/main-thread-profile.d.mts','scripts/r16-diagnostics/listening-small/profile-only-envelope.mjs',
 'scripts/r16-diagnostics/listening-small/profile-only-envelope.d.mts','scripts/r16-diagnostics/listening-small/profile-only.test.mts',
 'scripts/r16-diagnostics/listening-small/profile-pg-cpu.mjs','scripts/r16-diagnostics/listening-small/profile-pg-cpu.d.mts',
 'scripts/r16-diagnostics/listening-small/profile-pg-cpu.test.mjs',
 'scripts/r16-diagnostics/listening-small/query-cpu-oracle.mjs','scripts/r16-diagnostics/listening-small/query-cpu-oracle.test.mjs'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const gitHead=root=>execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const assertClean=root=>assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],
 {cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}),'','profile_only_source_tree_dirty');
const shaFile=async path=>hash(await readFile(path));

export async function validateProfileOnlyProbeSealV1(sealedHashes,probeRoot){
 for(const relative of PROFILE_ONLY_REQUIRED_PROBE_FILES_V1){
  assert.ok(/^sha256:[0-9a-f]{64}$/u.test(sealedHashes?.[relative]??''),'profile_only_required_probe_file_not_sealed');
  assert.equal(sealedHashes[relative],`sha256:${await shaFile(join(probeRoot,relative))}`,'profile_only_required_probe_file_changed');
 }
 return true;
}

export function validatePgProfileArtifactBytesV1(receipt,bytes,parsed){
 assert.ok(Buffer.isBuffer(bytes),'profile_only_pg_artifact_bytes_invalid');
 assert.deepEqual(JSON.parse(bytes.toString('utf8')),parsed,'profile_only_pg_artifact_content_mismatch');
 assert.equal(receipt.artifact_bytes,bytes.byteLength,'profile_only_pg_receipt_size_mismatch');
 return true;
}

function validatePureReceiptV1(receipt,tapBytes,{targetSha,probeSha,testFile}){
 const tap=tapBytes.toString('utf8');
 assert.equal(receipt.contract,'r16-diagnostic-pure-suite-v1','profile_only_pure_contract_invalid');
 assert.equal(receipt.status,'verified','profile_only_pure_status_invalid');
 assert.equal(receipt.diagnostic_only,true,'profile_only_pure_diagnostic_flag_invalid');
 assert.equal(receipt.h1_accepted,false,'profile_only_pure_h1_flag_invalid');
 assert.equal(receipt.requested_target_sha,targetSha,'profile_only_pure_target_invalid');
 assert.equal(receipt.target_git_sha_before,targetSha,'profile_only_pure_target_before_mismatch');
 assert.equal(receipt.target_git_sha_after,targetSha,'profile_only_pure_target_after_mismatch');
 assert.equal(receipt.requested_probe_sha,probeSha,'profile_only_pure_probe_invalid');
 assert.equal(receipt.probe_git_sha_before,probeSha,'profile_only_pure_probe_before_mismatch');
 assert.equal(receipt.probe_git_sha_after,probeSha,'profile_only_pure_probe_after_mismatch');
 assert.equal(receipt.test_file,testFile,'profile_only_pure_test_file_invalid');
 assert.equal(receipt.exit_status,0,'profile_only_pure_exit_invalid');
 assert.ok(receipt.counts&&receipt.counts.tests>0&&receipt.counts.tests===receipt.counts.pass
  &&receipt.counts.fail===0&&receipt.counts.cancelled===0&&receipt.counts.skipped===0,'profile_only_pure_counts_invalid');
 assert.equal(receipt.tap_sha256,hash(tapBytes),'profile_only_pure_tap_hash_mismatch');
 assert.ok(new RegExp(`^# tests ${receipt.counts.tests}$`,'mu').test(tap),'profile_only_pure_tap_tests_mismatch');
 assert.ok(new RegExp(`^# pass ${receipt.counts.pass}$`,'mu').test(tap),'profile_only_pure_tap_pass_mismatch');
 assert.ok(/^# fail 0$/mu.test(tap)&&/^# skipped 0$/mu.test(tap)&&/^# cancelled 0$/mu.test(tap),
  'profile_only_pure_tap_nonzero_failure_count');
 return{test_file:testFile,exit_status:0,counts:receipt.counts,tap_file:receipt.tap_file,tap_sha256:receipt.tap_sha256};
}

export function validateProfileOnlyRunV1(run,{targetSha,probeSha}){
 assert.equal(run.contract_version,'r16-listening-profile-only-run-v1','profile_only_run_contract_invalid');
 assert.equal(run.status,'profiled','profile_only_run_status_invalid');
 assert.equal(run.diagnostic_only,true,'profile_only_run_diagnostic_invalid');
 assert.equal(run.profiling_only,true,'profile_only_run_flag_invalid');
 assert.equal(run.h1_accepted,false,'profile_only_run_h1_invalid');
 assert.equal(run.diagnostic_mode,'profile_only','profile_only_run_mode_invalid');
 assert.equal(run.target_ref_requested,targetSha,'profile_only_run_target_invalid');
 assert.equal(run.target_head_before,targetSha,'profile_only_run_target_before_mismatch');
 assert.equal(run.target_head_after,targetSha,'profile_only_run_target_after_mismatch');
 assert.equal(run.probe_ref_requested,probeSha,'profile_only_run_probe_invalid');
 assert.equal(run.probe_head_before,probeSha,'profile_only_run_probe_before_mismatch');
 assert.equal(run.probe_head_after,probeSha,'profile_only_run_probe_after_mismatch');
 assert.deepEqual(run.probe_file_sha256_after,run.probe_file_sha256_before,'profile_only_probe_files_changed');
 assert.equal(run.source_tree_sha256_after,run.source_tree_sha256_before,'profile_only_target_source_changed');
 assert.equal(run.source_status_sha256,'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','profile_only_target_not_clean');
 assert.equal(run.resource_profile.requested_profile,'bounded_2g','profile_only_profile_invalid');
 assert.deepEqual(run.resource_profile.execution,{max_in_flight:4096,max_buffered_bytes:2147483648,flush_size:4096,max_flushes:2,
  flush_interval_ms:1000,window_size:4096},'profile_only_effective_profile_invalid');
 assert.equal(run.native.status,'completed','profile_only_native_run_incomplete');
 assert.equal(run.native.resolved_roots,4096,'profile_only_root_count_invalid');
 assert.equal(run.native.job_count,3,'profile_only_job_count_invalid');
 assert.equal(run.observed_http_latency.count,8192,'profile_only_request_count_invalid');
 assert.equal(run.expected_http_requests,8192,'profile_only_expected_request_count_invalid');
 assert.equal(run.native.unknown_micro_usd,'0','profile_only_unknown_exposure');
 assert.equal(run.native.reserved_micro_usd,'0','profile_only_reserved_exposure');
 assert.equal(run.profile_window?.scope,'classification_and_serving','profile_only_workload_window_invalid');
 assert.equal(run.profile_window?.clock,'process.hrtime.bigint','profile_only_workload_clock_invalid');
 assert.ok(/^\d{1,30}$/u.test(run.profile_window?.start_hrtime_ns??'')
  &&/^\d{1,30}$/u.test(run.profile_window?.end_hrtime_ns??''),'profile_only_workload_window_invalid');
 assert.ok(BigInt(run.profile_window.end_hrtime_ns)>BigInt(run.profile_window.start_hrtime_ns),'profile_only_workload_window_invalid');
 assert.equal(run.profile_window.start_hrtime_ns,run.native.classification_start_hrtime_ns,'profile_only_workload_start_mismatch');
 assert.equal(run.profile_window.end_hrtime_ns,run.native.classification_end_hrtime_ns,'profile_only_workload_end_mismatch');
 assert.ok(Number.isFinite(run.profile_window.start_performance_ms)&&Number.isFinite(run.profile_window.end_performance_ms)
  &&run.profile_window.end_performance_ms>=run.profile_window.start_performance_ms,'profile_only_performance_window_invalid');
 assert.equal(run.node_profile?.contract,'r16-main-thread-profile-capture-v1','profile_only_node_profile_missing');
 assert.equal(run.node_profile?.status,'captured','profile_only_node_profile_status_invalid');
 assert.equal(run.node_profile?.coverage,'main_thread_only','profile_only_node_profile_coverage_invalid');
 assert.equal(run.node_profile?.worker_thread_cpu,'unknown','profile_only_worker_cpu_must_remain_unknown');
 assert.equal(run.node_profile?.window?.profile_sampling_overlap,'unknown_v8_clock_bridge','profile_only_v8_clock_bridge_claimed');
 assert.equal(run.postgres_profile?.contract,'r16-pg-cpu-profile-v1','profile_only_pg_profile_missing');
 assert.equal(run.postgres_profile?.target_sha,targetSha,'profile_only_pg_target_mismatch');
 assert.equal(run.postgres_profile?.sampling,'boundary_only','profile_only_pg_sampling_invalid');
 assert.ok(['observed','partial','unavailable'].includes(run.postgres_profile?.status),'profile_only_pg_status_invalid');
 assert.equal(run.postgres_profile?.interval_ms,PROFILE_ONLY_PG_CPU_INTERVAL_MS_V1,'profile_only_pg_interval_invalid');
 assert.equal(run.storage_output?.scope,'owned_temporary_sibling_outside_artifact_directory','profile_only_storage_path_scope_invalid');
 assert.ok(/^sha256:[0-9a-f]{64}$/u.test(run.storage_output?.directory_path_sha256??''),'profile_only_storage_path_seal_invalid');
 assert.equal(run.storage_output?.removed_before_run_receipt_write,true,'profile_only_storage_path_not_cleaned');
 return run;
}

export async function assembleProfileOnlyEnvelopeV1(args){
 const targetRoot=resolve(args.targetRoot),probeRoot=resolve(args.probeRoot),artifactRoot=resolve(args.artifactRoot);
 const targetSha=args.targetSha??PROFILE_ONLY_TARGET_SHA_V1,probeSha=args.probeSha;
 assert.equal(targetSha,PROFILE_ONLY_TARGET_SHA_V1,'profile_only_target_sha_invalid');
 assert.ok(/^[0-9a-f]{40}$/u.test(probeSha??''),'profile_only_probe_sha_invalid');
 assert.equal(gitHead(targetRoot),targetSha,'profile_only_target_head_invalid');
 assert.equal(gitHead(probeRoot),probeSha,'profile_only_probe_head_invalid');
 assertClean(targetRoot);assertClean(probeRoot);
 const names=await readdir(artifactRoot);assertProfileOnlyArtifactFileSetV1(names);
 const path=name=>join(artifactRoot,name);
 const [run,mainlab,nodeReceipt,pgProfile,profileRunPure,profilePureTap,pgPure,pgPureTap,runPure,runPureTap]=await Promise.all([
  readJson(path('run.json')),readJson(path('mainlab-default-runtime.json')),readJson(path('node-profile.json')),
  readJson(path('postgres-profile.json')),readJson(path('profile-only.test.receipt.json')),readFile(path('profile-only.test.tap'),null),
  readJson(path('profile-pg-cpu.test.receipt.json')),readFile(path('profile-pg-cpu.test.tap'),null),
  readJson(path('run.test.receipt.json')),readFile(path('run.test.tap'),null),
 ]);
 validateProfileOnlyRunV1(run,{targetSha,probeSha});
 assert.equal(mainlab.contract,'r16-statement-shared-wire-mainlab-default-v1','profile_only_mainlab_contract_invalid');
 assert.equal(mainlab.status,'verified_c_default','profile_only_mainlab_status_invalid');
 assert.equal(mainlab.requested_target_sha,targetSha,'profile_only_mainlab_target_invalid');
 assert.equal(mainlab.target_git_sha_before,targetSha,'profile_only_mainlab_head_before_invalid');
 assert.equal(mainlab.target_git_sha_after,targetSha,'profile_only_mainlab_head_after_invalid');
 assert.equal(mainlab.source_set,'six','profile_only_mainlab_source_set_invalid');
 assert.deepEqual(mainlab.source_files.map(file=>file.path),MAINLAB_PATHS,'profile_only_mainlab_source_paths_invalid');
 for(const entry of mainlab.source_files){
  assert.ok(/^[0-9a-f]{64}$/u.test(entry.sha256),'profile_only_mainlab_source_hash_invalid');
  assert.equal(entry.sha256,await shaFile(join(targetRoot,entry.path)),'profile_only_mainlab_source_changed');
 }
 validateDefaultRuntimeV1(mainlab.before,'C');validateDefaultRuntimeV1(mainlab.after,'C');
 validateDefaultRuntimePairV1(mainlab.before,mainlab.after,'C');
 assert.deepEqual(nodeReceipt,run.node_profile,'profile_only_node_receipt_mismatch');
 assert.equal(pgProfile.contract,'r16-pg-cpu-profile-v1','profile_only_pg_contract_invalid');
 assert.equal(pgProfile.target_sha,targetSha,'profile_only_pg_source_invalid');
 assert.ok(['observed','partial','unavailable'].includes(pgProfile.status),'profile_only_pg_status_invalid');
 assertProfileOnlyPgIntervalV1(pgProfile);
 assert.equal(pgProfile.limits.configured_duration_ms,300000,'profile_only_pg_duration_invalid');
 const pgBytes=await readFile(path('postgres-profile.json'));
 validatePgProfileArtifactBytesV1(run.postgres_profile,pgBytes,pgProfile);
 const nodeBytes=await readFile(path('v8-main-thread-profile.json'));
 assert.equal(nodeReceipt.path,path('v8-main-thread-profile.json'),'profile_only_node_path_invalid');
 assert.equal(nodeBytes.byteLength,nodeReceipt.bytes,'profile_only_node_size_mismatch');
 assert.ok(nodeBytes.byteLength>0&&nodeBytes.byteLength<=PROFILE_ONLY_MAX_NODE_PROFILE_BYTES_V1,'profile_only_node_size_exceeded');
 assert.equal(hash(nodeBytes),nodeReceipt.sha256,'profile_only_node_sha_mismatch');
 const nodeProfile=JSON.parse(nodeBytes.toString('utf8'));
 assert.equal(nodeProfile.contract,'r16-v8-main-thread-profile-v1','profile_only_v8_contract_invalid');
 assert.equal(nodeProfile.urls_embedded,false,'profile_only_v8_urls_present');
 assert.equal(nodeProfile.source_text_embedded,false,'profile_only_v8_source_text_present');
 assert.ok(pgBytes.byteLength>0&&pgBytes.byteLength<=PROFILE_ONLY_MAX_PG_PROFILE_BYTES_V1,'profile_only_pg_size_exceeded');
 const profilePure=validatePureReceiptV1(profileRunPure,profilePureTap,{targetSha,probeSha,testFile:'scripts/r16-diagnostics/listening-small/profile-only.test.mts'});
 const pgPureSummary=validatePureReceiptV1(pgPure,pgPureTap,{targetSha,probeSha,testFile:'scripts/r16-diagnostics/listening-small/profile-pg-cpu.test.mjs'});
 const basePure=validatePureReceiptV1(runPure,runPureTap,{targetSha,probeSha,testFile:'scripts/r16-diagnostics/listening-small/run.test.mts'});
 assert.equal(basePure.counts.tests,85,'profile_only_existing_pure_suite_count_changed');
 const targetFileHashes=run.probe_file_sha256_before;
 await validateProfileOnlyProbeSealV1(targetFileHashes,probeRoot);
 const fileRecords=[];for(const name of names){const bytes=await stat(path(name));fileRecords.push({name,bytes:bytes.size,sha256:await shaFile(path(name))});}
 const payloadBytes=fileRecords.reduce((sum,item)=>sum+item.bytes,0);
 assert.ok(payloadBytes<=PROFILE_ONLY_MAX_TOTAL_BYTES_V1,'profile_only_total_size_exceeded');
 const envelope={contract:'r16-listening-profile-only-v1',status:pgProfile.status==='observed'?'profiled':'profiled_with_partial_postgres_capture',
  diagnostic_only:true,profiling_only:true,h1_accepted:false,target_git_sha:targetSha,probe_git_sha:probeSha,
  target_source:{tree_sha256_before:run.source_tree_sha256_before,tree_sha256_after:run.source_tree_sha256_after,
   tree_status_sha256:run.source_status_sha256,statement_shared_wire_source_set:'six',statement_shared_wire_source_files:mainlab.source_files},
  probe_source:{file_sha256_before:run.probe_file_sha256_before,file_sha256_after:run.probe_file_sha256_after},
  statement_default_runtime:{contract:mainlab.contract,status:mainlab.status,target:mainlab.before.target,runtime_kind:'C',
   observed_via:'pg_proc',before:mainlab.before,after:mainlab.after,before_after_equal:mainlab.before_after_equal},
  workload:{root_count:4096,expected_http_requests:8192,observed_http_requests:run.observed_http_requests,
   native_status:run.native.status,job_count:run.native.job_count,call_count:run.native.call_count,
   reserved_micro_usd:run.native.reserved_micro_usd,unknown_micro_usd:run.native.unknown_micro_usd,
   resource_profile:run.resource_profile.requested_profile,effective_execution:run.resource_profile.execution},
  workload_window:{scope:'classification_and_serving',clock:'process.hrtime.bigint',
   start_ns:run.profile_window.start_hrtime_ns,end_ns:run.profile_window.end_hrtime_ns,
   elapsed_wall_ms:run.profile_window.end_performance_ms-run.profile_window.start_performance_ms,
   profile_start_stop_relation:nodeReceipt.window.sampling_window_relation},
  node_profile:{contract:nodeReceipt.contract,status:nodeReceipt.status,path:'v8-main-thread-profile.json',bytes:nodeReceipt.bytes,
   sha256:nodeReceipt.sha256,scope:nodeReceipt.scope,coverage:nodeReceipt.coverage,process_scope:nodeReceipt.process_scope,
   worker_thread_cpu:nodeReceipt.worker_thread_cpu,window:nodeReceipt.window,process_cpu:nodeReceipt.process_cpu,
   sampling:nodeReceipt.sampling,v8_profile:nodeReceipt.v8_profile},
  postgres_profile:{contract:pgProfile.contract,status:pgProfile.status,sampling:'boundary_only',interval_ms:PROFILE_ONLY_PG_CPU_INTERVAL_MS_V1,
   path:'postgres-profile.json',bytes:pgBytes.byteLength,
   sha256:hash(pgBytes),target_sha:pgProfile.target_sha,limits:pgProfile.limits,window:pgProfile.window,
   sample_count:pgProfile.snapshots.length,observed_sample_count:pgProfile.snapshots.filter(s=>s.status==='observed').length,
   consecutive_pairs_count:pgProfile.consecutive_pairs.length,delta:pgProfile.delta,waits:pgProfile.waits,
   sql_attribution:pgProfile.sql_attribution,overhead:pgProfile.overhead,cleanup:pgProfile.cleanup},
  pure_tests:{status:'verified',suites:[basePure,profilePure,pgPureSummary]},
  artifacts:{files:fileRecords,payload_bytes_excluding_envelope:payloadBytes,max_total_bytes:PROFILE_ONLY_MAX_TOTAL_BYTES_V1,
   max_node_profile_bytes:PROFILE_ONLY_MAX_NODE_PROFILE_BYTES_V1,max_postgres_profile_bytes:PROFILE_ONLY_MAX_PG_PROFILE_BYTES_V1},
  interpretation:{diagnostic_only:true,profiling_only:true,h1_accepted:false,capacity_claim:false,
   v8_sample_time_is_not_exact_cpu:true,process_cpu_includes_all_process_threads:true,main_thread_cpu_is_separate_ticks:true,
   postgres_wait_and_sql_attribution:'unavailable',profile_overhead_not_subtracted:true}};
 const out=path('profile-only.json'),bytes=Buffer.from(`${JSON.stringify(envelope,null,2)}\n`,'utf8');
 assert.ok(bytes.byteLength<=2*1024*1024,'profile_only_envelope_size_invalid');
 assert.ok(payloadBytes+bytes.byteLength<=PROFILE_ONLY_MAX_TOTAL_BYTES_V1,'profile_only_total_size_exceeded');
 const handle=await open(out,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 return envelope;
}

async function main(){
 const [command,...args]=process.argv.slice(2);
 if(command!=='assemble'||args.length!==5)throw Error('profile_only_command_invalid');
 const [targetRoot,probeRoot,targetSha,probeSha,artifactRoot]=args;
 const result=await assembleProfileOnlyEnvelopeV1({targetRoot,probeRoot,targetSha,probeSha,artifactRoot});
 process.stdout.write(JSON.stringify({status:result.status,contract:result.contract,profiling_only:true,h1_accepted:false})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(error=>{process.stderr.write(`${profileOnlyEnvelopeErrorCodeV1(error)}\n`);process.exitCode=1;});
}
