import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const ANSWER_JOIN_NATIVE_CONTRACT_V1='r16-answer-guard-join-native-oracle-v1';
export const ANSWER_JOIN_NATIVE_RECEIPT_V1='r16-diagnostic-answer-join-native-v1';
export const ANSWER_JOIN_RESULT_LIMIT_V1=256*1024;
export const ANSWER_JOIN_TAP_LIMIT_V1=2_000_000;
export const ANSWER_JOIN_NATIVE_TITLES_V1=Object.freeze([
 'E answer join native projection preserves every composite and FOUND across missing and mismatched identities',
 'E answer join native BEFORE guards every conflict and malformed receipt attempt',
 'E answer join native revocations after lock waits and lease expiry remain fenced',
 'E answer join native replay historical paid configuration and technical failures retain precedence',
 'E answer join native CEEC pairs 1000 genuine paid calls for one and two questions',
]);
export const ANSWER_JOIN_PURE_TITLES_V1=Object.freeze([
 'E derives only the frozen answer BEFORE function from0296 and inverts all executable C bytes',
 'the joined read is anchored independently of call presence and uses all four original lookup predicates',
 'native composite assignments preserve the final question FOUND without treating nullable row fields as absence',
 'missing joined rows become typed all-NULL composites while present rows keep their original datum',
 'receipt error order, root rights, actor locks and answer shape checks remain byte-identical',
 'E preserves function metadata and rejects wrong runtime bodies or authorization metadata',
 'projection oracle compares native rowtypes plus FOUND with independent C/E reads, not an answer cache',
 'native INSERT and result staging are extracted from the exact production files with their existing fences',
 'wait cleanup releases the holder then drains its contender before returning',
 'wait cleanup retains rollback and pending failures while always closing the contender',
]);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const HEX64=/^[0-9a-f]{64}$/u;
const GIT40=/^[0-9a-f]{40}$/u;
const ANSWER_JOIN_SOURCE_V1=Object.freeze([
 ['0330_signal_listening_statement_shared_wire.sql','94fb81156f9ba8aa8faf3dc3502195998e701dc76e12a636418d8ef0df502305'],
 ['0331_signal_listening_statement_payload.sql','cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5'],
 ['signal-listening-statement-shared-wire.oracle.ts','0aab9ee2a1b8f909081ede8b2be78022e0bb103cff57a63f6bf9c31accc97991'],
 ['signal-listening-statement-shared-wire.fixture.ts','33008e28c6423492dd905d4ed736403c0ee7899c3622967ec55e1ec81962924b'],
 ['signal-listening-statement-shared-wire.postgres.test.ts','3962bd0ac8986829330faae8e40292eb7f5d5994ecc85f92e5fb2dbd861b13f5'],
 ['signal-listening-statement-shared-wire.test.ts','35706f345f3a7f50593bd089f4d9026f7b5ffc07e0639662c4ab827d33ae4b21'],
 ['signal-listening-answer-join.oracle.ts','46dfbed0c1b3e9f6d28412b7ca93e01ac005de39e565d4734109618893948bc5'],
 ['signal-listening-answer-join.test.ts','b82e40533cfcb90bfd1e4027cb76b6db5fd5475d8d442b850fe20bef0a6eb964'],
 ['signal-listening-answer-join.postgres.test.ts','5c9a76292de4d67aee3df8e294a607f106a595630175c9bf2410ddc8b85a919d'],
 ['0296_signal_listening_configuration.sql','03a4cafd5e923bc6b94ca080b70e433213deb3f79bf5fc3e5f395b857047f954'],
 ['signal-listening-runs.ts','86b080e064dbb97a80e11bec610f52a99b4101aacc6b51c8a88928a9ad69add2'],
 ['signal-labeling-runs.ts','b46e0b8d7a6d7b4957dd447d52c6b91ad9d9f1472bbe1d66d8a2842f8bd15646'],
].map(([file,sha256])=>Object.freeze({file,sha256})));

function readCount(tap,name){
 const matches=[...tap.matchAll(new RegExp(`^# ${name} (\\d+)$`,'gmu'))];
 assert.equal(matches.length,1,'answer_join_tap_summary_invalid');
 const n=Number(matches[0][1]);assert.ok(Number.isSafeInteger(n),'answer_join_tap_summary_invalid');return n;
}
function resultFromTAP(bytes,prefixes){
 const lines=bytes.toString('utf8').split(/\r?\n/u);
 const found=[];
 for(let i=0;i<lines.length;i++)if(prefixes.some(prefix=>lines[i].startsWith(prefix)))found.push(i);
 assert.equal(found.length,1,'answer_join_result_line_count_invalid');
 const prefix=prefixes.find(item=>lines[found[0]].startsWith(item));let text=lines[found[0]].slice(prefix.length),result;
 for(let i=found[0];i<lines.length;i++){
  const size=Buffer.byteLength(text);assert.ok(size>0&&size<=ANSWER_JOIN_RESULT_LIMIT_V1,'answer_join_result_size_invalid');
  try{result=JSON.parse(text);break;}catch{
   const next=lines[i+1];
   if(typeof next!=='string'||!next.startsWith('# ')||next.startsWith('# Subtest:')||/^# (?:duration_ms|tests|pass|fail|cancelled|skipped|todo)\b/u.test(next))
    throw new Error('answer_join_result_json_invalid');
   text+=next.slice(2);
  }
 }
 assert.ok(result&&typeof result==='object'&&!Array.isArray(result),'answer_join_result_invalid');
 return{result,resultBytes:Buffer.from(text)};
}
function validateTests(tap,titles,label){
 const rows=[...tap.matchAll(/^ok (\d+) - (.+)$/gmu)].map(m=>({number:Number(m[1]),raw:m[2],title:m[2].replace(/ # (?:SKIP|TODO)(?: .*)?$/u,'')}));
 assert.equal(rows.length,titles.length,`${label}_test_count_invalid`);
 assert.deepEqual(rows.map(x=>x.number),titles.map((_,i)=>i+1),`${label}_test_numbers_invalid`);
 assert.deepEqual(rows.map(x=>x.title),[...titles],`${label}_titles_invalid`);
 assert.ok(rows.every(x=>!/# (?:SKIP|TODO)(?: |$)/u.test(x.raw)),`${label}_test_not_run`);
 const plan=[...tap.matchAll(/^1\.\.(\d+)$/gmu)].map(m=>Number(m[1]));
 assert.deepEqual(plan,[titles.length],`${label}_plan_invalid`);
 const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(n=>[n,readCount(tap,n)]));
 assert.deepEqual(counts,{tests:titles.length,pass:titles.length,fail:0,cancelled:0,skipped:0},`${label}_counts_invalid`);
 return{counts,titles:rows.map(x=>x.title)};
}
function validateCpu(sample,label){
 const hex=v=>typeof v==='string'&&HEX64.test(v);
 assert.ok(sample&&/^[1-9][0-9]{0,9}$/u.test(sample.clk_tck??''),`${label}_hz_invalid`);
 assert.equal(sample.interval_ms,0,`${label}_interval_invalid`);assert.equal(sample.stopped_before_queries,true,`${label}_overlap`);
 assert.ok(sample.collector&&sample.collector.docker_endpoint==='unix:///var/run/docker.sock'&&hex(sample.collector.os_script_sha256)&&hex(sample.collector.inspect_format_sha256),`${label}_collector_invalid`);
 assert.ok(sample.ownership&&hex(sample.ownership.marker_sha256)&&hex(sample.ownership.container_id_sha256)&&hex(sample.ownership.postgres_system_identifier_sha256)
  &&/^sha256:[0-9a-f]{64}$/u.test(sample.ownership.image_id??'')&&typeof sample.ownership.started_at==='string'&&!Number.isNaN(Date.parse(sample.ownership.started_at)),`${label}_ownership_invalid`);
 assert.ok(sample.postmaster&&Number.isSafeInteger(sample.postmaster.pid)&&sample.postmaster.pid>0&&/^[0-9]+$/u.test(sample.postmaster.starttime_ticks??''),`${label}_postmaster_invalid`);
 assert.ok(Array.isArray(sample.brackets)&&sample.brackets.length===2&&sample.brackets.every(b=>/^[0-9]{1,30}$/u.test(b.bracket?.start_ns??'')&&/^[0-9]{1,30}$/u.test(b.bracket?.end_ns??'')&&BigInt(b.bracket.end_ns)>=BigInt(b.bracket.start_ns)),`${label}_brackets_invalid`);
}
function validateCpuDelta(cpu,label){
 assert.ok(cpu&&['user_ticks','system_ticks','total_ticks','user_ns','system_ns','total_ns','clk_tck','tick_resolution_ns'].every(k=>/^(0|[1-9][0-9]*)$/u.test(cpu[k]??'')),`${label}_delta_invalid`);
 assert.equal(cpu.control_subtracted,false,`${label}_control_subtracted`);assert.equal(cpu.worker_cpu,'unknown',`${label}_worker_cpu_claim`);
 assert.equal(cpu.scope,'leader_backend_cpu_between_proc_read_points',`${label}_scope_invalid`);
 assert.ok(cpu.elapsed_ns&&/^(0|[1-9][0-9]*)$/u.test(cpu.elapsed_ns.minimum??'')&&/^(0|[1-9][0-9]*)$/u.test(cpu.elapsed_ns.maximum??''),`${label}_elapsed_invalid`);
}
function validateQuerySample(sample,label){
 assert.ok(sample&&Number.isSafeInteger(sample.sequence)&&sample.sequence>=0&&Number.isSafeInteger(sample.pid)&&sample.pid>0,`${label}_identity_invalid`);
 for(const field of ['starttime_ticks','utime_ticks','stime_ticks'])assert.ok(/^(0|[1-9][0-9]*)$/u.test(sample[field]??''),`${label}_${field}_invalid`);
 assert.ok(sample.bracket&&/^[0-9]{1,30}$/u.test(sample.bracket.start_ns??'')&&/^[0-9]{1,30}$/u.test(sample.bracket.end_ns??'')
  &&BigInt(sample.bracket.end_ns)>=BigInt(sample.bracket.start_ns),`${label}_bracket_invalid`);
}
function validateControl(control,label){
 assert.ok(Array.isArray(control?.snapshots)&&control.snapshots.length===2,`${label}_snapshots_invalid`);
 validateQuerySample(control.snapshots[0],`${label}_before`);validateQuerySample(control.snapshots[1],`${label}_after`);validateCpuDelta(control.cpu,`${label}_cpu`);
 assert.equal(control.snapshots[0].pid,control.snapshots[1].pid,`${label}_backend_changed`);
 assert.equal(control.snapshots[0].starttime_ticks,control.snapshots[1].starttime_ticks,`${label}_backend_identity_changed`);
}
function validateNativeResult(r,{targetSha,probeSha,sourceFiles}){
 assert.equal(r.contract,ANSWER_JOIN_NATIVE_CONTRACT_V1,'answer_join_result_contract_invalid');
 assert.equal(r.status,'observed','answer_join_result_status_invalid');assert.equal(r.diagnostic_only,true,'answer_join_result_diagnostic_invalid');
 assert.equal(r.test_only,true,'answer_join_result_test_only_invalid');assert.equal(r.h1_accepted,false,'answer_join_result_h1_invalid');
 assert.equal(r.gain_claim,false,'answer_join_result_gain_invalid');assert.equal(r.migration_created,false,'answer_join_result_migration_invalid');
 assert.equal(r.source,targetSha,'answer_join_result_target_mismatch');assert.equal(r.probe,probeSha,'answer_join_result_probe_mismatch');
 assert.equal(r.base_source,'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1','answer_join_result_base_invalid');
 assert.ok(Array.isArray(r.failures)&&r.failures.length===0,'answer_join_result_failures_present');
 assert.ok(Array.isArray(r.source6)&&r.source6.length===6,'answer_join_source6_invalid');
 const expected6=ANSWER_JOIN_SOURCE_V1.slice(0,6);assert.deepEqual(r.source6,expected6,'answer_join_source6_mismatch');
 assert.ok(Array.isArray(r.new_files)&&r.new_files.length===3,'answer_join_new_sources_invalid');
 const expectedNew=ANSWER_JOIN_SOURCE_V1.slice(6,9);assert.deepEqual(r.new_files,expectedNew,'answer_join_new_source_seal_invalid');
 assert.ok(sourceFiles&&Object.keys(sourceFiles).length===12,'answer_join_actual_source_files_invalid');
 const all=ANSWER_JOIN_SOURCE_V1;
 assert.deepEqual(Object.keys(sourceFiles).sort(),all.map(x=>x.file).sort(),'answer_join_actual_source_paths_invalid');
 for(const item of all)assert.equal(sha256(sourceFiles[item.file]),item.sha256,`answer_join_source_hash_mismatch_${item.file.replace(/[^a-z0-9]+/giu,'_')}`);
 assert.deepEqual(r.product_files,[{file:'signal-listening-runs.ts',sha256:ANSWER_JOIN_SOURCE_V1[10].sha256},{file:'signal-labeling-runs.ts',sha256:ANSWER_JOIN_SOURCE_V1[11].sha256}], 'answer_join_product_source_seal_invalid');
 assert.ok(r.guard_file&&r.guard_file.file==='0296_signal_listening_configuration.sql'&&r.guard_file.sha256===ANSWER_JOIN_SOURCE_V1[9].sha256,'answer_join_guard_source_seal_invalid');
 assert.ok(HEX64.test(r.guard_c_sha256??'')&&HEX64.test(r.guard_e_sha256??''),'answer_join_guard_body_seal_invalid');
 assert.deepEqual(Object.keys(r.product_sql_sha256??{}).sort(),['answers','callLock','mutationFence','replay','results','runFence'].sort(),'answer_join_product_sql_keys_invalid');
 assert.ok(Object.values(r.product_sql_sha256).every(HEX64.test.bind(HEX64)),'answer_join_product_sql_hash_invalid');
 assert.deepEqual(r.completed,['setup','projection','attempts','waits','runtime','paired'],'answer_join_completed_phases_invalid');
 for(const field of ['defaults','installed','projection','attempts','waits','runtime','paired','unavailable_reasons'])assert.ok(Array.isArray(r[field]),`answer_join_${field}_invalid`);
 assert.equal(r.defaults.length,24,'answer_join_default_count_invalid');assert.equal(r.installed.length,22,'answer_join_installed_count_invalid');
 assert.equal(r.unavailable_reasons.length,0,'answer_join_unavailable_reason_present');
 assert.equal(r.projection.length,16,'answer_join_projection_count_invalid');
 assert.equal(r.attempts.length,40,'answer_join_attempt_count_invalid');
 assert.equal(r.waits.length,14,'answer_join_wait_count_invalid');
 assert.equal(r.runtime.length,4,'answer_join_runtime_count_invalid');
 assert.equal(r.paired.length,2,'answer_join_paired_scenarios_invalid');
 assert.equal(r.h1_accepted,false);assert.equal(r.physical_http_attempts,0);assert.equal(r.worker_cpu,'unknown');assert.equal(r.sql_function_cpu,'unknown');
 assert.equal(r.control_subtracted,false);assert.equal(r.memory_claim,false);assert.equal(r.capacity_claim,false);
 assert.equal(r.cpu_scope,'leader_backend_brackets_include_probes','answer_join_cpu_scope_invalid');
 assert.equal(r.proc_reads_observed,50,'answer_join_cpu_read_count_invalid');
 const scenarios=['one_selected_promotion','two_selected_voice_promotion'];
 const cpuSamples=[];
 for(let i=0;i<2;i++){
  const p=r.paired[i],single=i===0;
  assert.equal(p.case,scenarios[i],'answer_join_pair_scenario_invalid');assert.equal(p.calls,1000,'answer_join_pair_calls_invalid');
  assert.equal(p.configured_questions,2,'answer_join_pair_configured_questions_invalid');
  assert.equal(p.selected_questions_per_call,single?1:2,'answer_join_pair_question_count_invalid');
  assert.equal(p.expected_answer_rows,single?1000:2000,'answer_join_pair_answer_count_invalid');
  assert.equal(p.order.join(','),'C,E,E,C','answer_join_pair_order_invalid');assert.equal(p.committed,false,'answer_join_pair_commit_invalid');
  assert.equal(p.fresh_read_committed_transactions,true,'answer_join_pair_transaction_invalid');assert.equal(p.same_dml_snapshot,false,'answer_join_pair_snapshot_claim_invalid');
  assert.equal(p.measured_scope,'production answer INSERT only; real RAW/settle committed before all arms','answer_join_pair_scope_invalid');
  assert.equal(p.arms?.length,4,'answer_join_pair_arms_invalid');assert.equal(p.controls?.length,8,'answer_join_pair_controls_invalid');
  assert.ok(HEX64.test(p.baseline_sha256??'')&&HEX64.test(p.source_insert_sha256??'')&&HEX64.test(p.source_results_sha256??''),'answer_join_pair_seals_invalid');
  assert.equal(new Set(p.arms.map(a=>a.result_sha256)).size,1,'answer_join_pair_outputs_differ');
  for(let j=0;j<4;j++){
   const arm=p.arms[j];assert.equal(arm.arm,p.order[j],'answer_join_pair_arm_order_invalid');
   assert.equal(arm.inserted_rows,single?1000:2000,'answer_join_pair_insert_rows_invalid');assert.equal(arm.answer_rows,single?1000:2000,'answer_join_pair_answer_rows_invalid');
   assert.equal(arm.results_applied_calls,1000,'answer_join_pair_applied_calls_invalid');assert.equal(arm.exposure_micro_usd,'6000','answer_join_pair_exposure_invalid');
   assert.equal(arm.constraints_checked_before_rollback,true,'answer_join_pair_constraints_invalid');assert.ok(HEX64.test(arm.result_sha256??''),'answer_join_pair_result_seal_invalid');
   assert.ok(arm.query_bracket&&/^[0-9]{1,30}$/u.test(arm.query_bracket.start_ns??'')&&/^[0-9]{1,30}$/u.test(arm.query_bracket.end_ns??'')
    &&BigInt(arm.query_bracket.end_ns)>=BigInt(arm.query_bracket.start_ns),'answer_join_pair_query_bracket_invalid');
   assert.ok(/^(0|[1-9][0-9]*)$/u.test(arm.query_wall_ns??''),'answer_join_pair_query_wall_invalid');
   assert.ok(Array.isArray(arm.snapshots)&&arm.snapshots.length===2,'answer_join_pair_cpu_samples_invalid');
   validateQuerySample(arm.snapshots[0],`answer_join_${i}_${j}_cpu_before`);validateQuerySample(arm.snapshots[1],`answer_join_${i}_${j}_cpu_after`);
   cpuSamples.push(...arm.snapshots);
   validateCpuDelta(arm.cpu,`answer_join_${i}_${j}_cpu`);
   assert.ok(BigInt(arm.snapshots[0].bracket.end_ns)<=BigInt(arm.query_bracket.start_ns)
    &&BigInt(arm.query_bracket.end_ns)<=BigInt(arm.snapshots[1].bracket.start_ns),'answer_join_pair_cpu_bracket_overlap');
  }
  assert.ok(p.controls.every(c=>['C','E'].includes(c.arm)&&['before','after'].includes(c.phase)),'answer_join_pair_control_invalid');
  for(let j=0;j<p.controls.length;j++){validateControl(p.controls[j],`answer_join_${i}_control_${j}`);cpuSamples.push(...p.controls[j].snapshots);}
 }
 validateCpu(r.hz_before,'answer_join_cpu_before');validateCpu(r.hz_after,'answer_join_cpu_after');
 assert.equal(r.hz_before.clk_tck,r.hz_after.clk_tck,'answer_join_cpu_hz_changed');
 assert.deepEqual(r.hz_after.ownership,r.hz_before.ownership,'answer_join_lab_ownership_changed');
 assert.deepEqual(r.hz_after.postmaster,r.hz_before.postmaster,'answer_join_postmaster_changed');
 validateControl(r.cpu_viability,'answer_join_cpu_viability');cpuSamples.push(...r.cpu_viability.snapshots);
 assert.equal(cpuSamples.length,50,'answer_join_cpu_samples_total_invalid');
 assert.deepEqual(cpuSamples.map(sample=>sample.sequence).sort((a,b)=>a-b),Array.from({length:50},(_,i)=>i),'answer_join_cpu_sample_sequences_invalid');
 return r;
}

export function parseAnswerJoinNativeTAPV1(input,{exitStatus,targetSha,probeSha,targetBefore=targetSha,targetAfter=targetSha,probeBefore=probeSha,probeAfter=probeSha,sourceFiles}){
 const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);assert.ok(bytes.byteLength<=ANSWER_JOIN_TAP_LIMIT_V1,'answer_join_tap_too_large');
 assert.equal(exitStatus,0,'answer_join_native_exit_invalid');assert.match(targetSha??'',GIT40,'answer_join_target_sha_invalid');assert.match(probeSha??'',GIT40,'answer_join_probe_sha_invalid');
 assert.equal(targetBefore,targetSha,'answer_join_target_before_mismatch');assert.equal(targetAfter,targetSha,'answer_join_target_after_mismatch');
 assert.equal(probeBefore,probeSha,'answer_join_probe_before_mismatch');assert.equal(probeAfter,probeSha,'answer_join_probe_after_mismatch');
 const tap=bytes.toString('utf8'),tests=validateTests(tap,ANSWER_JOIN_NATIVE_TITLES_V1,'answer_join_native');
 const{result,resultBytes}=resultFromTAP(bytes,['# answer join RESULT ','# # answer join RESULT ','# \\# answer join RESULT ']);validateNativeResult(result,{targetSha,probeSha,sourceFiles});
 return{contract:ANSWER_JOIN_NATIVE_RECEIPT_V1,status:'verified',diagnostic_only:true,h1_accepted:false,
  requested_target_sha:targetSha,target_git_sha_before:targetBefore,target_git_sha_after:targetAfter,
  requested_probe_sha:probeSha,probe_git_sha_before:probeBefore,probe_git_sha_after:probeAfter,
  test_file:'infrastructure/db/migrations/signal-listening-answer-join.postgres.test.ts',exit_status:exitStatus,
  counts:tests.counts,titles:tests.titles,tap_file:'answer-join.native.tap',tap_sha256:sha256(bytes),result_sha256:sha256(resultBytes),native_result:result};
}

export function parseAnswerJoinPureTAPV1(input,{exitStatus,targetSha,probeSha}){
 const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);assert.ok(bytes.byteLength<=ANSWER_JOIN_TAP_LIMIT_V1,'answer_join_pure_tap_too_large');
 assert.equal(exitStatus,0,'answer_join_pure_exit_invalid');assert.match(targetSha??'',GIT40,'answer_join_target_sha_invalid');assert.match(probeSha??'',GIT40,'answer_join_probe_sha_invalid');
 const tests=validateTests(bytes.toString('utf8'),ANSWER_JOIN_PURE_TITLES_V1,'answer_join_pure');
 return{contract:'r16-diagnostic-pure-suite-v1',status:'verified',diagnostic_only:true,h1_accepted:false,
  requested_target_sha:targetSha,target_git_sha_before:targetSha,target_git_sha_after:targetSha,
  requested_probe_sha:probeSha,probe_git_sha_before:probeSha,probe_git_sha_after:probeSha,
  test_file:'infrastructure/db/migrations/signal-listening-answer-join.test.ts',exit_status:exitStatus,
  counts:tests.counts,titles:tests.titles,tap_file:'answer-join.pure.tap',tap_sha256:sha256(bytes)};
}

export const ANSWER_JOIN_SOURCE_DECLARATIONS_V1=ANSWER_JOIN_SOURCE_V1;
