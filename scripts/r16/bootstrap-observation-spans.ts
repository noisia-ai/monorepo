import type{SignalListeningPreparationObservationV1}from'../../services/workers/src/workers/signal-listening-preparation-observation';
import{createR16PreparationObservationScalarsV1}from'./preparation-observation-scalars';
export type R16BootstrapTransitionV1='bootstrap_start'|'bootstrap_end'|'measured';
export type R16BootstrapOutcomeV1='measured'|'partial'|'unavailable'|'failed';

/** The legacy fields remain byte-for-byte compatible with the worker callback.
 * New transition fields are optional until the worker event contract lands. */
export type R16CalibrationLifecycleInputV1={
 warmup:boolean;
 selected_roots:number;
 max_in_flight:number;
 shape_digests:string[];
 transition?:string;
 bootstrap_id?:number;
 outcome?:string;
};
export type R16CalibrationObservationInputV1=R16CalibrationLifecycleInputV1|{preparation:SignalListeningPreparationObservationV1};
export type R16CalibrationObservationV1=R16CalibrationLifecycleInputV1&{
 job_ordinal:number;
 at_ms:number;
};
export type R16ListeningJobSpanInputV1={
 job_ordinal:number;
 start_ms:number;
 end_ms:number;
 warmup:boolean;
};
export type R16ListeningJobSpanV1=R16ListeningJobSpanInputV1&{
 contains_bootstrap:boolean;
 legacy_warmup_fallback:boolean;
};
export type R16BootstrapIntervalV1={
 job_ordinal:number;
 bootstrap_id:number;
 start_ms:number;
 end_ms?:number;
 duration_ms?:number;
 outcome?:R16BootstrapOutcomeV1|'unknown';
 status:'complete'|'incomplete';
 reason?:string;
};
export type R16BootstrapObservationIssueV1={
 job_ordinal:number|null;
 event_index:number|null;
 code:'invalid_job_ordinal'|'invalid_timestamp'|'non_monotonic_timestamp'|'unknown_transition'|
  'invalid_bootstrap_id'|'bootstrap_id_not_increasing'|'start_before_previous_end'|
  'orphan_bootstrap_end'|'bootstrap_id_mismatch'|'invalid_interval'|'unknown_outcome'|
  'lifecycle_field_without_transition'|'missing_end';
};
export type R16BootstrapObservationSnapshotV1={
 calibration:R16CalibrationObservationV1[];
 job_spans:R16ListeningJobSpanV1[];
 bootstrap_spans:R16BootstrapIntervalV1[];
 bootstrap_observation_status:'complete'|'incomplete'|'legacy_fallback';
 bootstrap_observation_issues:R16BootstrapObservationIssueV1[];
 warmup_wall_ms:number|null;
 warmup_wall_ms_known_completed:number;
 warmup_wall_ms_basis:'observed_bootstrap_intervals_and_explicit_legacy_fallbacks';
 warmup_intervals_may_overlap_processing:true;
};

const transitions=new Set<string>(['bootstrap_start','bootstrap_end','measured']);
const outcomes=new Set<string>(['measured','partial','unavailable','failed']);
function validOrdinal(value:number){return Number.isSafeInteger(value)&&value>0;}
function validMs(value:number){return Number.isFinite(value)&&value>=0;}
function validBootstrapId(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;}

/** Interpret worker-emitted intervals without changing admission or worker execution.
 * Broken/incomplete sequences are retained as diagnostics and never throw. */
export function summarizeR16BootstrapObservationV1(
 calibration:readonly R16CalibrationObservationV1[],
 jobSpans:readonly R16ListeningJobSpanInputV1[],
):R16BootstrapObservationSnapshotV1{
 const issues:R16BootstrapObservationIssueV1[]=[],bootstrap_spans:R16BootstrapIntervalV1[]=[],
  completedDurations:number[]=[];
 let sequenceIncomplete=false,anyTransition=false;
 const byJob=new Map<number,R16CalibrationObservationV1[]>();
 for(const[index,event]of calibration.entries()){
  if(!validOrdinal(event.job_ordinal)){
   issues.push({job_ordinal:null,event_index:index+1,code:'invalid_job_ordinal'});sequenceIncomplete=true;continue;
  }
  const rows=byJob.get(event.job_ordinal)??[];rows.push(event);byJob.set(event.job_ordinal,rows);
 }
 const enrichedJobs:R16ListeningJobSpanV1[]=jobSpans.map(span=>{
  const events=byJob.get(span.job_ordinal)??[];
  const hasTransition=events.some(event=>event.transition!==undefined||event.bootstrap_id!==undefined||event.outcome!==undefined);
  const containsBootstrap=events.some(event=>event.transition==='bootstrap_start'||event.transition==='bootstrap_end');
  const validTimes=validMs(span.start_ms)&&validMs(span.end_ms)&&span.end_ms>=span.start_ms;
  if(!validOrdinal(span.job_ordinal)||!validTimes){
   issues.push({job_ordinal:validOrdinal(span.job_ordinal)?span.job_ordinal:null,event_index:null,code:'invalid_interval'});
   sequenceIncomplete=true;
  }
  return{...span,contains_bootstrap:containsBootstrap,legacy_warmup_fallback:!hasTransition&&span.warmup};
 });
 const jobIds=new Set(enrichedJobs.map(span=>span.job_ordinal));
 for(const id of byJob.keys())if(!jobIds.has(id)){
  issues.push({job_ordinal:id,event_index:null,code:'invalid_job_ordinal'});sequenceIncomplete=true;
 }

 for(const span of enrichedJobs){
  const events=byJob.get(span.job_ordinal)??[];
  let open:{id:number;startMs:number;startEventIndex:number}|null=null;
  let lastStartedId:number|null=null,lastAt=-Infinity;
  for(const[index,event]of events.entries()){
   const eventIndex=index+1;
   if(!validMs(event.at_ms)){
    issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'invalid_timestamp'});sequenceIncomplete=true;
   }else if(event.at_ms<lastAt){
    issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'non_monotonic_timestamp'});sequenceIncomplete=true;
   }
   if(validMs(event.at_ms))lastAt=event.at_ms;
   const transition=event.transition as string|undefined;
   if(transition===undefined){
    if(event.bootstrap_id!==undefined||event.outcome!==undefined){
     issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'lifecycle_field_without_transition'});sequenceIncomplete=true;
    }
    continue;
   }
   anyTransition=true;
   if(!transitions.has(transition)){
    issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'unknown_transition'});sequenceIncomplete=true;continue;
   }
   if(transition==='measured')continue;
   if(transition==='bootstrap_start'){
    if(!validBootstrapId(event.bootstrap_id)){
     issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'invalid_bootstrap_id'});sequenceIncomplete=true;continue;
    }
    if(lastStartedId!==null&&event.bootstrap_id<=lastStartedId){
     issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'bootstrap_id_not_increasing'});sequenceIncomplete=true;continue;
    }
    if(open!==null){
     bootstrap_spans.push({job_ordinal:span.job_ordinal,bootstrap_id:open.id,start_ms:open.startMs,
      status:'incomplete',reason:'start_before_previous_end'});
     issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'start_before_previous_end'});sequenceIncomplete=true;
    }
    lastStartedId=event.bootstrap_id;
    open={id:event.bootstrap_id,startMs:event.at_ms,startEventIndex:eventIndex};
    continue;
   }
   if(!validBootstrapId(event.bootstrap_id)){
    issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'invalid_bootstrap_id'});sequenceIncomplete=true;continue;
   }
   if(open===null){
    issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'orphan_bootstrap_end'});sequenceIncomplete=true;continue;
   }
   if(event.bootstrap_id!==open.id){
    issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'bootstrap_id_mismatch'});sequenceIncomplete=true;continue;
   }
   const validEnd=validMs(event.at_ms)&&event.at_ms>=open.startMs;
   if(!validEnd){
    issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'invalid_interval'});sequenceIncomplete=true;
   }
   const outcome=event.outcome as string|undefined;
   const validOutcome=typeof outcome==='string'&&outcomes.has(outcome);
   if(!validOutcome){
    issues.push({job_ordinal:span.job_ordinal,event_index:eventIndex,code:'unknown_outcome'});sequenceIncomplete=true;
   }
   const duration=validEnd?event.at_ms-open.startMs:undefined;
   bootstrap_spans.push({job_ordinal:span.job_ordinal,bootstrap_id:open.id,start_ms:open.startMs,
    end_ms:event.at_ms,...(duration===undefined?{}:{duration_ms:duration}),
    outcome:validOutcome?outcome as R16BootstrapOutcomeV1:'unknown',status:validEnd?'complete':'incomplete',
    ...(validEnd?{}:{reason:'invalid_interval'})});
   if(duration!==undefined)completedDurations.push(duration);
   open=null;
  }
  if(open!==null){
   bootstrap_spans.push({job_ordinal:span.job_ordinal,bootstrap_id:open.id,start_ms:open.startMs,
    status:'incomplete',reason:'missing_end'});
   issues.push({job_ordinal:span.job_ordinal,event_index:open.startEventIndex,code:'missing_end'});sequenceIncomplete=true;
  }
  if(span.legacy_warmup_fallback){
   if(validMs(span.start_ms)&&validMs(span.end_ms)&&span.end_ms>=span.start_ms)
    completedDurations.push(span.end_ms-span.start_ms);
  }
 }
 const warmup_wall_ms_known_completed=completedDurations.reduce((sum,value)=>sum+value,0);
 const legacyOnly=!anyTransition&&enrichedJobs.every(span=>span.legacy_warmup_fallback||!span.warmup);
 return{
  calibration:calibration.map(event=>({...event,shape_digests:[...event.shape_digests]})),
  job_spans:enrichedJobs,
  bootstrap_spans,
  bootstrap_observation_status:sequenceIncomplete?'incomplete':legacyOnly?'legacy_fallback':'complete',
  bootstrap_observation_issues:issues,
  warmup_wall_ms:sequenceIncomplete?null:warmup_wall_ms_known_completed,
  warmup_wall_ms_known_completed,
  warmup_wall_ms_basis:'observed_bootstrap_intervals_and_explicit_legacy_fallbacks',
  warmup_intervals_may_overlap_processing:true,
 };
}

/** Timestamps every observation and job boundary from the benchmark's single
 * performance.now()-start clock. It is descriptive only and has no worker gates. */
export function createR16BootstrapObservationRecorderV1(args:{start_time_ms:number;now:()=>number}){
 const calibration:R16CalibrationObservationV1[]=[],jobSpans:R16ListeningJobSpanInputV1[]=[];
 const preparation=createR16PreparationObservationScalarsV1();
 const elapsed=()=>args.now()-args.start_time_ms;
 return{
  elapsed,
  observe(job_ordinal:number,event:R16CalibrationObservationInputV1){
   if('preparation'in event){preparation.observe(event.preparation);return;}
   const recorded={...event,job_ordinal,at_ms:elapsed(),shape_digests:[...event.shape_digests]};
   calibration.push(recorded);return recorded;
  },
  finishJob(job_ordinal:number,start_ms:number,warmup:boolean){
   jobSpans.push({job_ordinal,start_ms,end_ms:elapsed(),warmup});
  },
  snapshot(){return{...summarizeR16BootstrapObservationV1(calibration,jobSpans),preparation_observation:preparation.snapshot()};},
 };
}
