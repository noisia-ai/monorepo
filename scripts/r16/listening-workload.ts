import {validateSignalListeningConfigurationV1,signalListeningBaseTemplateV1,signalWorkspaceEmbeddingDigestV1 as digest,
  type SignalListeningConfigurationV1} from '../../packages/query-engine/src/index';

/** Frozen BEFORE measurements. These are synthetic Brand OS data, not worker methodology. */
export const R16_LISTENING_PREREGISTRATION_V1=Object.freeze({
  contract_version:'r16-listening-capacity-preregistration-v1',root_count:32768,
  request_version:'listening-jev-v1',model:'jev-1.13.0',
  simulator_quotas:{requests_per_second:10000,input_tokens_per_second:10000000,shared_organization_account:true,real_provider_quotas_modified:false},
  expected_primary_http_calls_per_resolved_root:2,
  target_distinct_resolved_roots_per_second:1000,window_ms:1000,
  sustained_start_ms:5000,minimum_sustained_ms:20000,
  minimum_observed_http_ms:100,maximum_observed_http_ms:500,
  cold_clock:'before_fixture_setup',wall_clock:'before_prepareSignalListeningV1_including_admission_initial_census_all_warmups_and_serving',
  warmup:'ordinary_pending_roots_only;derive_from_settled_verified_applied_receipts',
  faults:['429','529','raw_page_write','postgres_commit','settlement_ack_lost',
    'worker_restart_after_page','lease_expiry','lease_expiry_after_durable','raw_page_ack_lost','postgres_commit_ack_lost'],
  legacy_failed_reference:'C676:440.69 roots/s;MassV2;not R16 acceptance',
} as const);
export type R16ListeningArmV1='defined_consumer_second_pass'|'discovered_four';
export function r16ListeningWorkloadV1(arm:R16ListeningArmV1){
  const configuration=signalListeningBaseTemplateV1({category:'synthetic fixture category',lexicon_terms:['synthetic']});
  const defined:SignalListeningConfigurationV1['questions']=[
    {key:'bicycle_repairs_v1',type:'noul',text:'Does the text discuss synthetic bicycle repairs?',scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined',
      positive:'Synthetic bicycle repairs are discussed',negative:'Synthetic bicycle repairs are not discussed'},
    {key:'bicycle_maintenance_v1',type:'noul',text:'Does the text discuss synthetic bicycle maintenance?',scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined',
      positive:'Synthetic bicycle maintenance is discussed',negative:'Synthetic bicycle maintenance is not discussed'},
  ];
  configuration.questions.push(...defined);
  if(arm==='discovered_four')for(let i=1;i<=4;i++)configuration.questions.push({key:`discovered_${i}_v1`,type:'noul',
    text:`Synthetic discovered fixture topic ${i}`,scope:'consumer_category',origin:'agent',human_locked:false,topic_source:'discovered',
    positive:`Synthetic topic marker ${i} present`,negative:`Synthetic topic marker ${i} absent`});
  const frozen=validateSignalListeningConfigurationV1(configuration);
  return{arm,configuration:frozen,configuration_digest:digest(frozen),preregistration_digest:digest(R16_LISTENING_PREREGISTRATION_V1),
    question_keys:frozen.questions.map(q=>q.key).sort()};
}

/** Rates concern only resolved DISTINCT roots; calls can exceed roots in two phases. */
export function summarizeR16ListeningCapacityV1(args:{wall_elapsed_ms:number;resolved_roots:number;
 commits:Array<{at_ms:number;roots:number}>;latency_ms:number[]}){
 if(!Number.isFinite(args.wall_elapsed_ms)||args.wall_elapsed_ms<=0||!Number.isSafeInteger(args.resolved_roots)||args.resolved_roots<0)throw Error('r16_listening_clock_or_census_invalid');
 const windows=Array.from({length:Math.floor(Math.max(0,args.wall_elapsed_ms-R16_LISTENING_PREREGISTRATION_V1.sustained_start_ms)/1000)},(_,i)=>{
  const from=5000+i*1000;return args.commits.filter(item=>item.at_ms>=from&&item.at_ms<from+1000).reduce((sum,item)=>sum+item.roots,0);
 });
 const rate=args.resolved_roots*1000/args.wall_elapsed_ms;
 return{windows,wall_roots_per_second:rate,minimum_window_roots_per_second:windows.length?Math.min(...windows):0,
  gates:{commit_census:args.commits.every(item=>Number.isSafeInteger(item.roots)&&item.roots>0&&Number.isFinite(item.at_ms)&&item.at_ms>=0&&item.at_ms<=args.wall_elapsed_ms)
    &&args.commits.reduce((sum,item)=>sum+item.roots,0)===args.resolved_roots,complete_census:args.resolved_roots===32768,
   sustained_duration:args.wall_elapsed_ms-5000>=20000,
   every_sustained_window:windows.length>0&&windows.every(n=>n>=1000),
   wall_throughput:Number.isFinite(rate)&&rate>=1000,
   observed_http_latency:args.latency_ms.length>0&&args.latency_ms.every(ms=>ms>=100&&ms<=500)}};
}
