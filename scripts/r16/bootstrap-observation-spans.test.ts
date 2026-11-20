import assert from 'node:assert/strict';
import test from 'node:test';
import {
 createR16BootstrapObservationRecorderV1,
 summarizeR16BootstrapObservationV1,
 type R16CalibrationObservationV1,
 type R16ListeningJobSpanInputV1,
} from './bootstrap-observation-spans';

function event(job_ordinal:number,at_ms:number,extra:Partial<R16CalibrationObservationV1>={}):R16CalibrationObservationV1{
 return{job_ordinal,at_ms,warmup:false,selected_roots:0,max_in_flight:4,shape_digests:[],...extra};
}
function job(job_ordinal:number,start_ms:number,end_ms:number,warmup:boolean):R16ListeningJobSpanInputV1{
 return{job_ordinal,start_ms,end_ms,warmup};
}

test('mixed bootstrap and measured work uses only the observed interval, not whole job duration',()=>{
 const result=summarizeR16BootstrapObservationV1([
  event(1,10,{warmup:true,transition:'bootstrap_start',bootstrap_id:1}),
  event(1,34,{warmup:true,transition:'bootstrap_end',bootstrap_id:1,outcome:'measured'}),
  event(1,35,{transition:'measured',outcome:'measured'}),
 ],[job(1,0,100,true)]);
 assert.equal(result.bootstrap_observation_status,'complete');
 assert.equal(result.warmup_wall_ms,24);
 assert.equal(result.warmup_wall_ms_known_completed,24);
 assert.deepEqual(result.bootstrap_spans,[{job_ordinal:1,bootstrap_id:1,start_ms:10,end_ms:34,duration_ms:24,outcome:'measured',status:'complete'}]);
 assert.deepEqual(result.job_spans,[{job_ordinal:1,start_ms:0,end_ms:100,warmup:true,contains_bootstrap:true,legacy_warmup_fallback:false}]);
 assert.equal(result.warmup_intervals_may_overlap_processing,true);
});

test('bootstrap ids restart for each job and are matched with job ordinal',()=>{
 const result=summarizeR16BootstrapObservationV1([
  event(1,2,{transition:'bootstrap_start',bootstrap_id:1}),
  event(1,7,{transition:'bootstrap_end',bootstrap_id:1,outcome:'measured'}),
  event(2,12,{transition:'bootstrap_start',bootstrap_id:1}),
  event(2,20,{transition:'bootstrap_end',bootstrap_id:1,outcome:'partial'}),
 ],[job(1,0,10,false),job(2,10,25,false)]);
 assert.equal(result.bootstrap_observation_status,'complete');
 assert.equal(result.warmup_wall_ms,13);
 assert.deepEqual(result.bootstrap_spans.map(({job_ordinal,bootstrap_id,duration_ms})=>({job_ordinal,bootstrap_id,duration_ms})),[
  {job_ordinal:1,bootstrap_id:1,duration_ms:5},{job_ordinal:2,bootstrap_id:1,duration_ms:8},
 ]);
});

test('failed closed bootstrap time is retained; a later open interval makes total unknown without a fabricated end',()=>{
 const result=summarizeR16BootstrapObservationV1([
  event(1,5,{transition:'bootstrap_start',bootstrap_id:9}),
  event(1,12,{transition:'bootstrap_end',bootstrap_id:9,outcome:'failed'}),
  event(2,30,{transition:'bootstrap_start',bootstrap_id:1}),
 ],[job(1,0,20,true),job(2,20,50,true)]);
 assert.equal(result.bootstrap_observation_status,'incomplete');
 assert.equal(result.warmup_wall_ms,null);
 assert.equal(result.warmup_wall_ms_known_completed,7);
 assert.equal(result.bootstrap_spans[0]?.outcome,'failed');
 const open=result.bootstrap_spans[1]!;
 assert.equal(open.status,'incomplete');
 assert.equal(open.reason,'missing_end');
 assert.equal('end_ms' in open,false);
 assert.ok(result.bootstrap_observation_issues.some(issue=>issue.code==='missing_end'&&issue.job_ordinal===2));
});

test('legacy event stream retains its prior whole-job fallback only when no transition events exist',()=>{
 const result=summarizeR16BootstrapObservationV1([
  event(1,4,{warmup:true}),event(2,45,{warmup:false}),
 ],[job(1,0,40,true),job(2,40,80,false)]);
 assert.equal(result.bootstrap_observation_status,'legacy_fallback');
 assert.equal(result.warmup_wall_ms,40);
 assert.deepEqual(result.job_spans.map(({contains_bootstrap,legacy_warmup_fallback})=>({contains_bootstrap,legacy_warmup_fallback})),[
  {contains_bootstrap:false,legacy_warmup_fallback:true},
  {contains_bootstrap:false,legacy_warmup_fallback:false},
 ]);
});

test('recorder uses one elapsed clock for job boundaries and bootstrap event timestamps',()=>{
 let now=5000;
 const recorder=createR16BootstrapObservationRecorderV1({start_time_ms:5000,now:()=>now});
 const jobStart=recorder.elapsed();
 now=5011;recorder.observe(1,event(1,0,{transition:'bootstrap_start',bootstrap_id:1}));
 now=5031;recorder.observe(1,event(1,0,{transition:'bootstrap_end',bootstrap_id:1,outcome:'unavailable'}));
 now=5060;recorder.finishJob(1,jobStart,true);
 const result=recorder.snapshot();
 assert.deepEqual(result.calibration.map(({at_ms})=>at_ms),[11,31]);
 assert.deepEqual(result.job_spans.map(({start_ms,end_ms})=>({start_ms,end_ms})),[{start_ms:0,end_ms:60}]);
 assert.equal(result.bootstrap_spans[0]?.duration_ms,20);
 assert.equal(result.warmup_wall_ms,20);
});

test('malformed or incomplete transitions are diagnostic and never throw or invent timestamps',()=>{
 const result=summarizeR16BootstrapObservationV1([
  event(1,2,{transition:'bootstrap_end',bootstrap_id:2,outcome:'measured'}),
  event(1,3,{transition:'bootstrap_start',bootstrap_id:2}),
  event(1,4,{transition:'bootstrap_start',bootstrap_id:2}),
  event(1,5,{transition:'unexpected'}),
 ],[job(1,0,9,true)]);
 assert.equal(result.bootstrap_observation_status,'incomplete');
 assert.equal(result.warmup_wall_ms,null);
 assert.ok(result.bootstrap_observation_issues.some(issue=>issue.code==='orphan_bootstrap_end'));
 assert.ok(result.bootstrap_observation_issues.some(issue=>issue.code==='bootstrap_id_not_increasing'));
 assert.ok(result.bootstrap_observation_issues.some(issue=>issue.code==='unknown_transition'));
 const last=result.bootstrap_spans[result.bootstrap_spans.length-1]!;
 assert.equal(last.reason,'missing_end');
 assert.equal('end_ms' in last,false);
});
