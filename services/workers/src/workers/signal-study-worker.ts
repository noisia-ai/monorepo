import {
 createSignalStudyRuntimeStoreV1,createSignalStudyJevNativeAdapterV1,createSignalStudyNumericNativeAdapterV1,
 pendingSignalStudyExecutionsV1,type SignalListeningAccessV1,
} from '@noisia/db';
import {createAnthropicStudyProviderV1} from '../providers/anthropic-study';
import type {createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {createLabelingRawPagesStorageV1} from './signal-labeling-receipt-storage';
import {createSignalStudyJevDriverV1} from './signal-study-jev';
import {createSignalStudyNumericDriverV1,createSignalStudyNumericStorageBindingsV1} from './signal-study-numeric';
import {signalStudyRuntimeJobV1} from './signal-study-runtime';
import {createSignalStudyRawStorageV1} from './signal-study-storage';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';

type Database=SignalListeningAccessV1['database'];
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const keyReady=(value:string|undefined)=>Boolean(value?.trim())&&!/[\r\n]/u.test(value??'');
export function signalStudyAnalysisReadyV1(env:NodeJS.ProcessEnv){
 return env.NOISIA_SIGNAL_STUDY_ENABLED==='true'&&env.NOISIA_SIGNAL_LISTENING_ENABLED==='true'
  &&env.NOISIA_JEV_PROVIDER_ENABLED==='true'&&env.NOISIA_JEV_STREAMING_V2_ENABLED==='true'
  &&keyReady(env.NOISIA_STUDY_ANTHROPIC_API_KEY)&&keyReady(env.TYPESAFE_API_KEY);
}
export type SignalStudyWorkerOptionsV1={database?:Database;storage?:WorkspaceEngineStorageV1;env?:NodeJS.ProcessEnv;
 should_stop?:()=>boolean;sonnet_fetch?:typeof fetch;jev_provider_factory?:typeof createCalibratedJevRuntimeProviderV2;
 python?:string;module_root?:string;storage_root?:string;renewal_ms?:number};

/** Native identity-only entrypoint. No configuration, actor, admission or
 * request body is supplied by a queue/browser. All owners reload their seals.
 * The native claim reconciles observed receipts even when analysis is disabled;
 * new JEV/Sonnet admissions and sends require the current scoped capabilities. */
export async function signalStudyWorkerJobV1(execution_id:string,options:SignalStudyWorkerOptionsV1={}){
 if(!uuid.test(execution_id))throw Error('study_worker_execution_invalid');
 const env=options.env??process.env,database=options.database??(await import('../db/client')).pool;
 const storage=options.storage??createWorkspaceEngineStorageV1();
 const sonnetKey=env.NOISIA_STUDY_ANTHROPIC_API_KEY?.trim()??'',jevKey=env.TYPESAFE_API_KEY?.trim()??'';
 // Rotation or a capability change closes this physical attempt. A later job
 // may load new credentials without reinterpreting any old sent/unknown call.
 const analysisEnabled=()=>signalStudyAnalysisReadyV1(env)&&!options.should_stop?.()
  &&env.NOISIA_STUDY_ANTHROPIC_API_KEY?.trim()===sonnetKey&&env.TYPESAFE_API_KEY?.trim()===jevKey;
 const sonnetAvailable=()=>keyReady(sonnetKey)&&env.NOISIA_STUDY_ANTHROPIC_API_KEY?.trim()===sonnetKey;
 const jevAvailable=()=>env.NOISIA_JEV_PROVIDER_ENABLED==='true'&&keyReady(jevKey)&&env.TYPESAFE_API_KEY?.trim()===jevKey;
 const store=createSignalStudyRuntimeStoreV1({database,raw_storage:createSignalStudyRawStorageV1(storage),
  raw_pages:createLabelingRawPagesStorageV1(storage),...createSignalStudyNumericStorageBindingsV1(storage),
  analysis_enabled:analysisEnabled,sonnet_provider_available:sonnetAvailable,jev_provider_available:jevAvailable});
 const jev=createSignalStudyJevDriverV1({adapter:createSignalStudyJevNativeAdapterV1({database,
  analysis_enabled:analysisEnabled,sonnet_provider_available:sonnetAvailable}),storage,env:{...env},provider_factory:options.jev_provider_factory});
 const fit=createSignalStudyNumericDriverV1({adapter:createSignalStudyNumericNativeAdapterV1({database}),
  python:options.python,module_root:options.module_root,storage_root:options.storage_root});
 const sonnet=createAnthropicStudyProviderV1({apiKey:sonnetKey,fetch:options.sonnet_fetch});
 return signalStudyRuntimeJobV1(execution_id,{store,should_stop:()=>!analysisEnabled(),renewal_ms:options.renewal_ms,
  drivers:{runJevBatch:jev,fit,preflight:async plan=>{
   sonnet.assertReady(plan.request_body);if(!storage.assertReady)throw Error('study_worker_storage_preflight_required');
   await storage.assertReady();
  },send:(plan,signal)=>sonnet.generate(plan.request_body,signal)}});
}

export type SignalStudyDrainerOptionsV1=SignalStudyWorkerOptionsV1&{
 pending?:typeof pendingSignalStudyExecutionsV1;job?:typeof signalStudyWorkerJobV1;
 interval_ms?:number;run_immediately?:boolean};
/** Polling confers no processing authority. It remains available for native
 * receipt bookkeeping with analysis off; missing tables are a harmless no-op.
 * Each scan/run is serial, so a single process never overlaps Study sources. */
export async function drainSignalStudiesOnceV1(options:SignalStudyDrainerOptionsV1={}){
 if(options.should_stop?.())return{candidates:0,completed:0,waiting:0,failed:0};
 const database=options.database??(await import('../db/client')).pool;
 const ready=(await database.query("SELECT to_regclass('signal_study_executions') IS NOT NULL ready")).rows[0]?.ready;
 if(!ready)return{candidates:0,completed:0,waiting:0,failed:0};
 const rows=await(options.pending??pendingSignalStudyExecutionsV1)({database,limit:20});
 let completed=0,waiting=0,failed=0;
 for(const row of rows){if(options.should_stop?.())break;
  try{const result=await(options.job??signalStudyWorkerJobV1)(row.execution_id,{...options,database});
   if(result.status==='completed')completed++;else waiting++;
  }catch{failed++;}}
 return{candidates:rows.length,completed,waiting,failed};
}
export function startSignalStudyDrainerV1(options:SignalStudyDrainerOptionsV1={}){
 const interval=options.interval_ms??2500;
 if(!Number.isSafeInteger(interval)||interval<10||interval>60000)throw Error('study_worker_interval_invalid');
 let closed=false,active:Promise<unknown>|undefined;
 const drainNow=()=>{
  if(closed)return Promise.resolve();if(active)return active;
  active=drainSignalStudiesOnceV1({...options,should_stop:()=>closed||Boolean(options.should_stop?.())})
   .catch(()=>console.warn('[study] native worker unavailable')).finally(()=>{active=undefined;});return active;
 };
 const timer=setInterval(()=>void drainNow(),interval);timer.unref?.();
 if(options.run_immediately!==false)void drainNow();
 return{drainNow,async close(){closed=true;clearInterval(timer);await active;}};
}
