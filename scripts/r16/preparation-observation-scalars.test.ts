import assert from'node:assert/strict';
import test from'node:test';
import{createR16PreparationObservationScalarsV1}from'./preparation-observation-scalars';
import{createR16BootstrapObservationRecorderV1}from'./bootstrap-observation-spans';
import type{SignalListeningPreparationObservationV1}from'../../services/workers/src/workers/signal-listening-preparation-observation';
const survey=(duration_ms:number,extra:Partial<Extract<SignalListeningPreparationObservationV1,{kind:'survey_result'}>>={}):SignalListeningPreparationObservationV1=>({
 kind:'survey_result',outcome:'ready',duration_ms,plan_rows:8,post_rr_invalid:false,epoch_changed:false,bootstrap_changed:false,stopped:false,aborted:false,...extra});

test('preparation scalar summaries distinguish observed RR outcomes, epoch invalidation and unknown Native returns',()=>{
 const recorder=createR16PreparationObservationScalarsV1();assert.equal(recorder.snapshot().observation_status,'unobserved');
 recorder.observe(survey(5,{outcome:'profile',plan_rows:0}));recorder.observe({kind:'survey_profile_load',outcome:'loaded',duration_ms:2});
 recorder.observe({kind:'epoch_advanced',cause:'profile_load',count:1});recorder.observe(survey(7));recorder.observe(survey(3,{post_rr_invalid:true,epoch_changed:true}));
 recorder.observe({kind:'epoch_advanced',cause:'base_apply',count:1});recorder.observe({kind:'survey_selection',outcome:'wait_for_apply',duration_ms:1,selected_rows:0});
 recorder.observe({kind:'native_admission',outcome:'committed',duration_ms:9,proposed_calls:8,selected_calls:0,validated_calls:0,returned_calls:0,selector_called:true,validation_called:true,selector_observation:'preparation_invalid'});
 recorder.observe({kind:'native_admission',outcome:'threw',duration_ms:4,proposed_calls:8,selected_calls:8,validated_calls:8,returned_calls:null,selector_called:true,validation_called:true,selector_observation:'selected'});
 const value=recorder.snapshot();assert.equal(value.observation_status,'observed');assert.equal(value.invalid_events,0);assert.equal(value.observed_events,9);
 assert.deepEqual(value.survey.outcomes.ready,{count:2,total_ms:10,max_ms:7});assert.equal(value.survey.plan_rows,16);assert.equal(value.survey.post_rr_invalid,1);
 assert.equal(value.epoch_advanced.base_apply,1);assert.equal(value.epoch_advanced.profile_load,1);assert.equal(value.native_admission.committed_empty,1);
 assert.equal(value.native_admission.returned_calls_known,0);assert.equal(value.native_admission.returned_calls_unknown_events,1);
 assert.equal(value.native_admission.outcomes.threw.count,1);assert.equal(value.native_admission.selected_calls,8);
 assert.equal(value.CPU_or_RSS_measurement,false);assert.equal(value.elapsed_durations_may_overlap,true);
 value.survey.outcomes.ready.count=999;assert.equal(recorder.snapshot().survey.outcomes.ready.count,2,'returned snapshots are detached scalar copies');
});

test('malformed preparation diagnostics are counted without inventing outcomes or retaining arbitrary enum keys',()=>{
 const recorder=createR16PreparationObservationScalarsV1();
 const invalid=[survey(-1),survey(Infinity),survey(1,{outcome:'__proto__' as never}),survey(1,{post_rr_invalid:null}),
  {kind:'future',root_id:'private-root'},
  {kind:'native_admission',outcome:'threw',duration_ms:1,proposed_calls:2,selected_calls:2,validated_calls:2,returned_calls:0,selector_called:true,validation_called:true,selector_observation:'selected'}];
 for(const event of invalid)assert.doesNotThrow(()=>recorder.observe(event as SignalListeningPreparationObservationV1));
 const result=recorder.snapshot();assert.equal(result.invalid_events,invalid.length);assert.equal(result.observed_events,0);assert.equal(result.observation_status,'invalid');
 assert.equal(result.native_admission.committed_empty,0);assert.equal(JSON.stringify(result).includes('private-root'),false);
});

test('preparation observations remain fixed-size and never enter legacy calibration arrays or its elapsed-clock reads',()=>{
 let now=5000,clockReads=0;const recorder=createR16BootstrapObservationRecorderV1({start_time_ms:5000,now:()=>{clockReads++;return now;}});
 const lifecycle={warmup:true,selected_roots:32,max_in_flight:32,shape_digests:['sha256:old-shape']};
 now=5010;recorder.observe(1,{...lifecycle,transition:'bootstrap_start',bootstrap_id:1});
 for(let i=0;i<10000;i++){
  const decorated={...survey(1),root_id:'private-root-sentinel',request_body:'private-body-sentinel'};
  recorder.observe(1,{preparation:decorated});
 }
 now=5030;recorder.observe(1,{...lifecycle,transition:'bootstrap_end',bootstrap_id:1,outcome:'measured'});
 now=5060;recorder.finishJob(1,0,true);const result=recorder.snapshot();
 assert.equal(clockReads,3);assert.equal(result.calibration.length,2);assert.equal(result.bootstrap_spans.length,1);assert.equal(result.warmup_wall_ms,20);
 assert.equal(result.preparation_observation.observed_events,10000);assert.equal(result.preparation_observation.survey.outcomes.ready.total_ms,10000);
 const assertScalars=(value:unknown):void=>{assert.equal(Array.isArray(value),false);if(value&&typeof value==='object')for(const child of Object.values(value))assertScalars(child);};
 assertScalars(result.preparation_observation);
 const body=JSON.stringify(result);assert.ok(body.length<8192);assert.ok(!body.includes('private-root-sentinel')&&!body.includes('private-body-sentinel'));
});

test('capacity clip summaries preserve tied limits and unknown phase bytes without retaining cohort observations',()=>{
 const recorder=createR16PreparationObservationScalarsV1();
 const feed:SignalListeningPreparationObservationV1={kind:'feed_budget',free_bytes:1000000,headroom_bytes:100,available_bytes:999900,slots:8,ready_slots:1,reserved_calls:1,max_calls:4095};
 const compile:SignalListeningPreparationObservationV1={kind:'compile_clip',outcome:'native',read_calls:4096,selected_calls:4096,compiled_calls:1024,returned_calls:1024,workspace_clip:false,
  limit_calls:1024,max_calls:4096,minimum_calls:0,covered_limit:null,native_prefix:true,available_bytes:999900,compiled_bytes:900000,quote_metadata_bytes:100,
  window_tie:false,physical_tie:true,provider_tie:true,native_tie:true,bootstrap_tie:false,stop:'call_limit'};
 const prefix:SignalListeningPreparationObservationV1={kind:'native_prefix_clip',prepared_calls:1024,slot_limit:1024,fitted_calls:546,workspace_bytes:5000,memory_bytes:10000,draft_bytes:900000,
  probes:11,response_max_bytes:100000,response_unfit_probes:2,slot_clip:false,memory_clip:true,outcome:'native'};
 const selector:SignalListeningPreparationObservationV1={kind:'native_selector_clip',candidate_calls:546,slot_limit:1024,bootstrap_limit:null,limit_calls:546,selected_calls:546,memory_before_bytes:10000,
  call_bytes:4000,response_bytes:null,probes:10,response_max_bytes:100000,response_unfit_probes:0,slot_tie:false,candidate_tie:true,bootstrap_tie:false,memory_clip:false,phase:true};
 for(let i=0;i<1000;i++){recorder.observe(feed);recorder.observe(compile);recorder.observe(prefix);recorder.observe(selector);}
 const value=recorder.snapshot();assert.equal(value.observed_events,4000);assert.equal(value.invalid_events,0);
 assert.equal(value.clips.compile.ties.physical,1000);assert.equal(value.clips.compile.ties.provider,1000);assert.equal(value.clips.compile.ties.native,1000);
 assert.equal(value.clips.prefix.memory_clip,1000);assert.deepEqual(value.clips.prefix.metrics.fitted_calls,{count:1000,unknown:0,sum:546000,min:546,max:546});
 assert.equal(value.clips.selector.metrics.response_bytes.unknown,1000);assert.equal(value.clips.selector.metrics.response_bytes.count,0);
 assert.equal(value.clips.selector.ties.candidate,1000);assert.ok(JSON.stringify(value).length<12000);
 const before=value.clips.prefix.events;recorder.observe({...prefix,fitted_calls:-1});recorder.observe({...compile,stop:'__proto__'as never});
 const after=recorder.snapshot();assert.equal(after.invalid_events,2);assert.equal(after.clips.prefix.events,before);
});
