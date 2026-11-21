import type{SignalListeningPreparationObservationV1}from'../../services/workers/src/workers/signal-listening-preparation-observation';

const timed=()=>({count:0,total_ms:0,max_ms:0});
const validCount=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const validDuration=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
const has=(value:object,key:unknown):key is string=>typeof key==='string'&&Object.hasOwn(value,key);
function add(counter:ReturnType<typeof timed>,duration:number){counter.count++;counter.total_ms+=duration;counter.max_ms=Math.max(counter.max_ms,duration);}

/** Fixed-size descriptive counters. No event, identifier, body or per-root/job
 * array is retained. These elapsed durations may overlap other pipeline work;
 * they are neither CPU time nor an amount to subtract from the original wall. */
export function createR16PreparationObservationScalarsV1(){
 const value={contract_version:'r16-listening-preparation-scalars-v1' as const,observed_events:0,invalid_events:0,
  survey:{outcomes:{profile:timed(),stale:timed(),deferred:timed(),ready:timed(),legacy:timed(),closed:timed(),threw:timed()},
   plan_rows:0,ready_empty:0,post_rr_invalid:0,epoch_changed:0,bootstrap_changed:0,stopped:0,aborted:0},
  survey_selection:{outcomes:{ready:timed(),wait_for_apply:timed(),closed:timed(),threw:timed()},selected_rows:0},
  survey_short_circuit:{legacy:0,closed:0},survey_profile_load:{loaded:timed(),missing:timed(),threw:timed()},
  epoch_advanced:{base_apply:0,profile_load:0,derived_profile:0,bootstrap_pending_apply:0,reserved:0,covered_reservation:0,bootstrap_end:0},
  native_admission:{outcomes:{committed:timed(),legacy:timed(),threw:timed()},proposed_calls:0,selected_calls:0,validated_calls:0,
   returned_calls_known:0,returned_calls_unknown_events:0,committed_empty:0,selector_called:0,validation_called:0,
   selector_observation:{not_observed:0,fatal:0,admission_aborted:0,cancellation_aborted:0,preparation_invalid:0,closed:0,bootstrap_wait:0,zero_selected:0,selected:0}},
  draft_discard:{pre_native:0,post_legacy:0},elapsed_durations_may_overlap:true as const,CPU_or_RSS_measurement:false as const};
 const invalid=()=>{value.invalid_events++;};
 return{
  observe(event:SignalListeningPreparationObservationV1){
   if(!event||typeof event!=='object'){invalid();return;}
   switch(event.kind){
    case'survey_result':{
     if(!has(value.survey.outcomes,event.outcome)||!validDuration(event.duration_ms)||!validCount(event.plan_rows)
      ||(event.post_rr_invalid===null?event.outcome!=='threw':typeof event.post_rr_invalid!=='boolean')
      ||[event.epoch_changed,event.bootstrap_changed,event.stopped,event.aborted].some(flag=>typeof flag!=='boolean')){invalid();return;}
     add(value.survey.outcomes[event.outcome],event.duration_ms);value.survey.plan_rows+=event.plan_rows;
     if(event.outcome==='ready'&&event.plan_rows===0)value.survey.ready_empty++;
     if(event.post_rr_invalid)value.survey.post_rr_invalid++;if(event.epoch_changed)value.survey.epoch_changed++;
     if(event.bootstrap_changed)value.survey.bootstrap_changed++;if(event.stopped)value.survey.stopped++;if(event.aborted)value.survey.aborted++;
     break;
    }
    case'survey_selection':
     if(!has(value.survey_selection.outcomes,event.outcome)||!validDuration(event.duration_ms)||!validCount(event.selected_rows)){invalid();return;}
     add(value.survey_selection.outcomes[event.outcome],event.duration_ms);value.survey_selection.selected_rows+=event.selected_rows;break;
    case'survey_short_circuit':
     if(!has(value.survey_short_circuit,event.outcome)){invalid();return;}value.survey_short_circuit[event.outcome]++;break;
    case'survey_profile_load':
     if(!has(value.survey_profile_load,event.outcome)||!validDuration(event.duration_ms)){invalid();return;}add(value.survey_profile_load[event.outcome],event.duration_ms);break;
    case'epoch_advanced':
     if(!has(value.epoch_advanced,event.cause)||!validCount(event.count)||event.count<1){invalid();return;}value.epoch_advanced[event.cause]+=event.count;break;
    case'native_admission':{
     const native=value.native_admission;
     if(!has(native.outcomes,event.outcome)||!has(native.selector_observation,event.selector_observation)||!validDuration(event.duration_ms)
      ||!validCount(event.proposed_calls)||!validCount(event.selected_calls)||!validCount(event.validated_calls)
      ||event.returned_calls!==null&&!validCount(event.returned_calls)||event.outcome!=='committed'&&event.returned_calls!==null
      ||typeof event.selector_called!=='boolean'||typeof event.validation_called!=='boolean'){invalid();return;}
     add(native.outcomes[event.outcome],event.duration_ms);native.proposed_calls+=event.proposed_calls;
     native.selected_calls+=event.selected_calls;native.validated_calls+=event.validated_calls;
     if(event.returned_calls===null)native.returned_calls_unknown_events++;else native.returned_calls_known+=event.returned_calls;
     if(event.outcome==='committed'&&event.returned_calls===0)native.committed_empty++;
     if(event.selector_called)native.selector_called++;if(event.validation_called)native.validation_called++;
     native.selector_observation[event.selector_observation]++;break;
    }
    case'draft_discard':
     if(!has(value.draft_discard,event.point)){invalid();return;}value.draft_discard[event.point]++;break;
    default:{const unreachable:never=event;void unreachable;invalid();return;}
   }
   value.observed_events++;
  },
  snapshot(){return{...structuredClone(value),observation_status:value.invalid_events?'invalid' as const:value.observed_events?'observed' as const:'unobserved' as const};},
 };
}
export type R16PreparationObservationScalarsV1=ReturnType<ReturnType<typeof createR16PreparationObservationScalarsV1>['snapshot']>;
