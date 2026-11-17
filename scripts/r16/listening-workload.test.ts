import assert from 'node:assert/strict';
import test from 'node:test';
import {validateSignalListeningConfigurationV1,signalWorkspaceEmbeddingDigestV1 as digest} from '../../packages/query-engine/src/index';
import {R16_LISTENING_PREREGISTRATION_V1 as registration,r16ListeningWorkloadV1,
 R16_LISTENING_PREREGISTRATION_V2,r16ListeningWorkloadV2,summarizeR16ListeningCapacityV1,summarizeR16ListeningCapacityV2} from './listening-workload';
import {assertR16ListeningAdmissionClockV1,createR16ListeningResourceObservationV1,reconcileR16ListeningResolvedRootsV1} from './run-listening-benchmark';
test('preregistered R16 workloads bind generic Listening identity and consumer second pass, without legacy T&B',()=>{
 const a=r16ListeningWorkloadV1('defined_consumer_second_pass'),b=r16ListeningWorkloadV1('discovered_four');
 for(const w of[a,b]){assert.deepEqual(validateSignalListeningConfigurationV1(w.configuration),w.configuration);assert.equal(w.configuration_digest,digest(w.configuration));
 assert.equal(w.preregistration_digest,digest(registration));assert.equal(w.configuration.model,'jev-1.13.0');
 assert.ok(w.configuration.questions.filter(q=>q.origin==='brand_os').every(q=>q.scope==='consumer_category'&&q.type==='noul'&&q.topic_source==='defined'&&q.human_locked));
 assert.ok(!w.question_keys.includes('trigger_barrier'));}
 assert.equal(a.question_keys.length,4);assert.equal(b.question_keys.length,8);
 assert.equal(b.configuration.questions.filter(q=>'topic_source'in q&&q.topic_source==='discovered').length,4);
 assert.equal(registration.root_count,32768);assert.equal(registration.faults.length,10);
 assert.equal(registration.target_distinct_resolved_roots_per_second,1000);assert.equal(registration.minimum_sustained_ms,20000);
});
test('native resolved census is DISTINCT roots, never two-pass HTTP calls; no missing/foreign/duplicate/interpolated root',()=>{
 const expected=new Set(['root-a','root-b']),previous=new Set(['root-a']);
 assert.deepEqual(reconcileR16ListeningResolvedRootsV1(expected,previous,['root-a','root-b']),['root-b']);
 for(const rows of[['root-a','root-a'],['root-b'],['root-a','foreign']])
  assert.throws(()=>reconcileR16ListeningResolvedRootsV1(expected,previous,rows),/census_invalid/);
 assert.deepEqual(reconcileR16ListeningResolvedRootsV1(expected,previous,['root-a']),[]);
});

test('sparse resource witness preserves exact stream peaks and labels process RSS samples as non-peak without changing gates',()=>{
 let rss=12_000;
 const witness=createR16ListeningResourceObservationV1(()=>rss);
 witness.sampleRss(0);
 witness.observeStream({in_flight:8,reserved_working_bytes:4096,buffered_responses:3,active_flushes:1});
 rss=18_000;witness.sampleRss(3200);
 witness.observeStream({in_flight:2,reserved_working_bytes:1024,buffered_responses:1,active_flushes:0});
 const limits={max_in_flight:1024,window_size:4096,max_buffered_bytes:512*1024*1024,flush_size:1024,max_flushes:2,flush_interval_ms:250};
 assert.deepEqual(witness.snapshot(limits),{sampling:'sparse_start_after_each_job_and_final',rss_is_peak:false,limits,
  rss_samples:[{at_ms:0,rss_bytes:12_000},{at_ms:3200,rss_bytes:18_000}],
  stream_peaks:{in_flight:8,reserved_working_bytes:4096,buffered_responses:3,active_flushes:1}});
 const commits=Array.from({length:25},(_,i)=>({at_ms:i*1000+500,roots:i===0?2768:1250}));
 const measurement={wall_elapsed_ms:30000,processing_elapsed_ms:25000,native_processing_complete:true,
  resolved_roots:32768,commits,latency_ms:[100,300,500]};
 const gatesBefore=summarizeR16ListeningCapacityV2(measurement).gates;
 witness.observeStream({in_flight:1025,reserved_working_bytes:512*1024*1024+1,buffered_responses:4,active_flushes:3});
 assert.deepEqual(summarizeR16ListeningCapacityV2(measurement).gates,gatesBefore,
  'observational fields do not enter the acceptance calculation');
 assert.deepEqual(witness.snapshot(limits).stream_peaks,{in_flight:1025,reserved_working_bytes:512*1024*1024+1,buffered_responses:4,active_flushes:3},
  'observations retain a limit breach for audit instead of clamping it');
});

test('all fixed sustained windows and cold wall throughput remain mandatory despite plentiful two-pass HTTP',async()=>{
 const {summarizeR16ListeningCapacityV1:summary}=await import('./listening-workload');
 const commits=Array.from({length:25},(_,i)=>({at_ms:i*1000+500,roots:i===0?2768:1250}));
 const okay=summary({wall_elapsed_ms:25000,resolved_roots:32768,commits,latency_ms:[100,300,500]});
 assert.ok(Object.values(okay.gates).every(Boolean));assert.equal(okay.windows.length,20);
 const slow=summary({wall_elapsed_ms:40000,resolved_roots:32768,commits,latency_ms:[300]});assert.equal(slow.gates.wall_throughput,false);
 const gap=summary({wall_elapsed_ms:25000,resolved_roots:32768,commits:commits.filter(c=>c.at_ms!==8500),latency_ms:[300]});
 assert.equal(gap.gates.every_sustained_window,false);assert.equal(gap.minimum_window_roots_per_second,0);
 assert.equal(summary({wall_elapsed_ms:20000,resolved_roots:32768,commits,latency_ms:[501]}).gates.observed_http_latency,false);
});


test('admission clock includes preparation and initial census, rejects missing or postdated timestamps',async()=>{
 const start=assertR16ListeningAdmissionClockV1(100,200,6200);assert.equal(start,200);
 assert.equal(6200-start,6000,'preparation and initial census cannot disappear before the first job');
 for(const args of[[100,NaN,6200],[100,99,6200],[100,6201,6200],[-1,200,6200],[100,200,Infinity]])
  assert.throws(()=>assertR16ListeningAdmissionClockV1(args[0]!,args[1]!,args[2]!),/admission_clock_invalid/);
 const {summarizeR16ListeningCapacityV1:summary}=await import('./listening-workload');
 const measured=summary({wall_elapsed_ms:40200-start,resolved_roots:32768,commits:[{at_ms:30000,roots:32768}],latency_ms:[300]});
 assert.equal(measured.gates.wall_throughput,false);assert.equal(measured.gates.every_sustained_window,false);
});

test('V2 preregistration changes only the active window clock and retains the V1 identity for history',()=>{
 const old=r16ListeningWorkloadV1('defined_consumer_second_pass'),current=r16ListeningWorkloadV2('defined_consumer_second_pass');
 assert.deepEqual(current.configuration,old.configuration);assert.equal(current.configuration_digest,old.configuration_digest);
 assert.notEqual(current.preregistration_digest,old.preregistration_digest);
 assert.equal(current.preregistration_digest,digest(R16_LISTENING_PREREGISTRATION_V2));
 for(const key of ['root_count','simulator_quotas','expected_primary_http_calls_per_resolved_root',
  'target_distinct_resolved_roots_per_second','window_ms','sustained_start_ms','minimum_sustained_ms',
  'minimum_observed_http_ms','maximum_observed_http_ms','wall_clock','faults'] as const)
  assert.deepEqual(R16_LISTENING_PREREGISTRATION_V2[key],registration[key]);
 assert.equal(registration.contract_version,'r16-listening-capacity-preregistration-v1');
});

test('V2 retains the complete verification tail in wall rate and reports its zero windows without inventing demand',()=>{
 const commits=Array.from({length:25},(_,i)=>({at_ms:i*1000+500,roots:i===0?2768:1250}));
 const input={wall_elapsed_ms:30000,processing_elapsed_ms:25000,native_processing_complete:true,
  resolved_roots:32768,commits,latency_ms:[100,300,500]};
 const old=summarizeR16ListeningCapacityV1(input),current=summarizeR16ListeningCapacityV2(input);
 assert.equal(old.gates.every_sustained_window,false,'V1 historical verdict remains rejected');
 assert.ok(Object.values(current.gates).every(Boolean));assert.equal(current.windows.length,20);
 assert.equal(current.wall_roots_per_second,32768/30);assert.equal(current.verification_tail_ms,5000);
 assert.deepEqual(current.full_wall_windows,old.windows);
 assert.deepEqual(current.verification_only_full_windows,[0,0,0,0,0]);
 assert.equal(summarizeR16ListeningCapacityV2({...input,wall_elapsed_ms:40000}).gates.wall_throughput,false);
});

test('V2 rejects active pauses, a cutoff before commits, incomplete native drain and short active duration',()=>{
 const commits=Array.from({length:25},(_,i)=>({at_ms:i*1000+500,roots:i===0?2768:1250}));
 const input={wall_elapsed_ms:30000,processing_elapsed_ms:25000,native_processing_complete:true,
  resolved_roots:32768,commits,latency_ms:[300]};
 const gap=commits.map(c=>c.at_ms===8500?{...c,at_ms:9500}:c);
 const paused=summarizeR16ListeningCapacityV2({...input,commits:gap});
 assert.equal(paused.gates.commit_census,true);assert.equal(paused.gates.every_sustained_window,false);
 assert.equal(paused.minimum_window_roots_per_second,0);
 assert.equal(summarizeR16ListeningCapacityV2({...input,processing_elapsed_ms:24000}).gates.commit_census,false);
 assert.equal(summarizeR16ListeningCapacityV2({...input,native_processing_complete:false}).gates.native_processing_complete,false);
 assert.equal(summarizeR16ListeningCapacityV2({...input,processing_elapsed_ms:20000}).gates.sustained_duration,false);
 for(const end of [NaN,Infinity,0,-1,30001]){
  const invalid=summarizeR16ListeningCapacityV2({...input,processing_elapsed_ms:end});
  assert.equal(invalid.gates.native_processing_complete,false);assert.equal(invalid.gates.commit_census,false);
 }
 assert.equal(summarizeR16ListeningCapacityV2({...input,latency_ms:[501]}).gates.observed_http_latency,false);
});
