import type{SignalListeningPreparationObservationV1}from'../../services/workers/src/workers/signal-listening-preparation-observation';

const timed=()=>({count:0,total_ms:0,max_ms:0});
const validCount=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const validDuration=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
const has=(value:object,key:unknown):key is string=>typeof key==='string'&&Object.hasOwn(value,key);
function add(counter:ReturnType<typeof timed>,duration:number){counter.count++;counter.total_ms+=duration;counter.max_ms=Math.max(counter.max_ms,duration);}

const scalar=()=>({count:0,unknown:0,sum:0,min:null as number|null,max:null as number|null});
function recordScalars(target:Record<string,ReturnType<typeof scalar>>,fields:Record<string,number|null>){
 for(const [key,n]of Object.entries(fields))if(!Object.hasOwn(target,key)||n!==null&&!validCount(n))return false;
 for(const [key,n]of Object.entries(fields)){const t=target[key]!;if(n===null)t.unknown++;else{t.count++;t.sum+=n;t.min=t.min===null?n:Math.min(t.min,n);t.max=t.max===null?n:Math.max(t.max,n);}}
 return true;
}
const booleanFields=(fields:Record<string,boolean>)=>Object.values(fields).every(n=>typeof n==='boolean');

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
  clips:{
   feed:{events:0,metrics:{free_bytes:scalar(),headroom_bytes:scalar(),available_bytes:scalar(),slots:scalar(),ready_slots:scalar(),reserved_calls:scalar(),max_calls:scalar()}},
   compile:{events:0,outcomes:{native:0,legacy:0,deferred:0,closed:0,empty:0,threw:0},stops:{unreached:0,input_exhausted:0,call_limit:0,compile_memory:0,invalidated:0,aborted:0,preparation_deferred:0,closed:0},
    ties:{window:0,physical:0,provider:0,native:0,bootstrap:0},workspace_clip:0,metrics:{read_calls:scalar(),selected_calls:scalar(),compiled_calls:scalar(),returned_calls:scalar(),limit_calls:scalar(),max_calls:scalar(),minimum_calls:scalar(),covered_limit:scalar(),available_bytes:scalar(),compiled_bytes:scalar(),quote_metadata_bytes:scalar()}},
   prefix:{events:0,outcomes:{native:0,legacy_escape:0},slot_clip:0,memory_clip:0,metrics:{prepared_calls:scalar(),slot_limit:scalar(),fitted_calls:scalar(),workspace_bytes:scalar(),memory_bytes:scalar(),draft_bytes:scalar(),probes:scalar(),response_max_bytes:scalar(),response_unfit_probes:scalar()}},
   selector:{events:0,ties:{slot:0,candidate:0,bootstrap:0},memory_clip:0,phase:0,metrics:{candidate_calls:scalar(),slot_limit:scalar(),bootstrap_limit:scalar(),limit_calls:scalar(),selected_calls:scalar(),memory_before_bytes:scalar(),call_bytes:scalar(),response_bytes:scalar(),probes:scalar(),response_max_bytes:scalar(),response_unfit_probes:scalar()}}},
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
    case'feed_budget':{
     const c=value.clips.feed;if(!recordScalars(c.metrics,{free_bytes:event.free_bytes,headroom_bytes:event.headroom_bytes,available_bytes:event.available_bytes,slots:event.slots,ready_slots:event.ready_slots,reserved_calls:event.reserved_calls,max_calls:event.max_calls})){invalid();return;}c.events++;break;
    }
    case'compile_clip':{
     const c=value.clips.compile;
     if(!has(c.outcomes,event.outcome)||!has(c.stops,event.stop)||!(event.native_prefix===null||typeof event.native_prefix==='boolean')
      ||!booleanFields({window:event.window_tie,physical:event.physical_tie,provider:event.provider_tie,native:event.native_tie,bootstrap:event.bootstrap_tie,workspace:event.workspace_clip})
      ||!recordScalars(c.metrics,{read_calls:event.read_calls,selected_calls:event.selected_calls,compiled_calls:event.compiled_calls,returned_calls:event.returned_calls,limit_calls:event.limit_calls,max_calls:event.max_calls,minimum_calls:event.minimum_calls,covered_limit:event.covered_limit,available_bytes:event.available_bytes,compiled_bytes:event.compiled_bytes,quote_metadata_bytes:event.quote_metadata_bytes})){invalid();return;}
     c.events++;c.outcomes[event.outcome]++;c.stops[event.stop]++;if(event.workspace_clip)c.workspace_clip++;if(event.window_tie)c.ties.window++;if(event.physical_tie)c.ties.physical++;if(event.provider_tie)c.ties.provider++;if(event.native_tie)c.ties.native++;if(event.bootstrap_tie)c.ties.bootstrap++;break;
    }
    case'native_prefix_clip':{
     const c=value.clips.prefix;
     if(!has(c.outcomes,event.outcome)||!booleanFields({slot:event.slot_clip,memory:event.memory_clip})
      ||!recordScalars(c.metrics,{prepared_calls:event.prepared_calls,slot_limit:event.slot_limit,fitted_calls:event.fitted_calls,workspace_bytes:event.workspace_bytes,memory_bytes:event.memory_bytes,draft_bytes:event.draft_bytes,probes:event.probes,response_max_bytes:event.response_max_bytes,response_unfit_probes:event.response_unfit_probes})){invalid();return;}
     c.events++;c.outcomes[event.outcome]++;if(event.slot_clip)c.slot_clip++;if(event.memory_clip)c.memory_clip++;break;
    }
    case'native_selector_clip':{
     const c=value.clips.selector;
     if(!booleanFields({slot:event.slot_tie,candidate:event.candidate_tie,bootstrap:event.bootstrap_tie,memory:event.memory_clip,phase:event.phase})
      ||!recordScalars(c.metrics,{candidate_calls:event.candidate_calls,slot_limit:event.slot_limit,bootstrap_limit:event.bootstrap_limit,limit_calls:event.limit_calls,selected_calls:event.selected_calls,memory_before_bytes:event.memory_before_bytes,call_bytes:event.call_bytes,response_bytes:event.response_bytes,probes:event.probes,response_max_bytes:event.response_max_bytes,response_unfit_probes:event.response_unfit_probes})){invalid();return;}
     c.events++;if(event.slot_tie)c.ties.slot++;if(event.candidate_tie)c.ties.candidate++;if(event.bootstrap_tie)c.ties.bootstrap++;if(event.memory_clip)c.memory_clip++;if(event.phase)c.phase++;break;
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
