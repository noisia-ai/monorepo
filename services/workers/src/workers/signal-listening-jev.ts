import {
  createSignalListeningStoreV1,signalWorkspaceFeatureEnabledV1,loadSignalListeningCalibrationV1,deriveSignalListeningCalibrationV1,
  pendingSignalListeningPreparationsV1,continueSignalListeningPreparationV1,type LabelingRunV1,
} from '@noisia/db';
import {
  buildSignalListeningJevRequestV1,mapSignalListeningJevResponseV1,signalListeningJevIdentityV1,signalListeningRequestDigestV1,
  validateSignalListeningConfigurationV1,labelerDigestV1,llmPriceV1,llmCostMicroUsdV1,
  signalListeningCalibrationShapeV1,signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningInputV1,type SignalListeningResultV1,
} from '@noisia/query-engine';
import {assertMassJevConsumerV1} from '../providers/mass-labeling-consumer';
import {jevStreamingExecutionFromEnvV2} from '../providers/jev-streaming-runtime';
import {JevProviderErrorV1,type JevProviderV1} from '../providers/typesafe-jev';
import {processJevLabelingPageV1,jevUsageV1,type JevPreparedExecutionV1} from './signal-jev-labeling-page';
import {createLabelingRawPagesStorageV1} from './signal-labeling-receipt-storage';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import type {JevStreamingExecutionV2} from './signal-jev-streaming-window';

import {listeningHasRawV1,selectSignalListeningRecoveryV1,createSignalListeningRecoveryProviderV1} from './signal-listening-recovery';
import {planSignalListeningCalibrationV1,createSignalListeningCalibratedProviderV1} from './signal-listening-calibration';

type Store=ReturnType<typeof createSignalListeningStoreV1>;
function configurationOf(run:LabelingRunV1){
  const configuration=validateSignalListeningConfigurationV1(run.identity.params.configuration);
  if(run.kind!=='mass_labeling'||labelerDigestV1(run.identity)!==labelerDigestV1(signalListeningJevIdentityV1(configuration)))
    throw Error('listening_identity_invalid');
  return configuration;
}
function priceOf(run:LabelingRunV1){
  configurationOf(run);
  return llmPriceV1('typesafe',run.identity.model,'sync',Number(run.identity.params.input_usd_per_mtok));
}
/** The DB adapter selects only eligible missing question digests. This transport
 * never invents questions, negative labels, eligibility or a second provider attempt. */
export function processSignalListeningJevV1(args:{run_id:string;store:Store;provider:JevProviderV1;
  execution:JevStreamingExecutionV2;lease_renewal_ms?:number;recovery_only?:boolean;
  prepare?(run:Readonly<LabelingRunV1>):Promise<JevPreparedExecutionV1>;
  selection?:()=>SignalListeningInputV1[]|undefined}){
  let windowSize=args.execution.window_size;
  const key=(input:SignalListeningInputV1)=>digest({root_id:input.root_id,input_digest:input.input_digest,question_digests:input.question_digests});
  const select=(inputs:SignalListeningInputV1[])=>{
    const selection=args.selection?.();if(!selection)return inputs.slice(0,windowSize);
    const available=new Map(inputs.map(input=>[key(input),input]));
    return selection.flatMap(input=>{const found=available.get(key(input));return found?[found]:[];}).slice(0,windowSize);
  };
  const schedulerStore={...args.store,async calls(run:LabelingRunV1){
    const rows=await args.store.calls(run),selection=args.selection?.();if(!selection)return rows;
    const order=new Map(selection.map((input,index)=>[key(input),index]));
    // Unknown physical attempts always remain visible to the shared money guard.
    return rows.filter(call=>listeningHasRawV1(call)||call.status==='unknown'||call.inputs.some(input=>order.has(key(input))))
      .sort((a,b)=>Number(Boolean(b.raw_body))-Number(Boolean(a.raw_body))||(a.inputs[0]?order.get(key(a.inputs[0]))??-1:-1)-(b.inputs[0]?order.get(key(b.inputs[0]))??-1:-1));
  }};
  return processJevLabelingPageV1<SignalListeningInputV1,SignalListeningResultV1>({...args,store:schedulerStore,
    prepare:args.prepare?async run=>{const prepared=await args.prepare!(run);windowSize=prepared.execution.window_size;return prepared;}:undefined,hooks:{
    price:priceOf,
    propose:(run,inputs)=>select(inputs).map(input=>{
      const request=buildSignalListeningJevRequestV1(input,configurationOf(run));
      const request_digest=signalListeningRequestDigestV1(run,input,request);
      return {custom_id:`listening_${request_digest.slice(7,67)}`,request_digest,request,inputs:[input],
        reserved_micro_usd:llmCostMicroUsdV1(jevUsageV1({input_tokens:Buffer.byteLength(JSON.stringify(request))*4+8192,output_tokens:0}),priceOf(run))};
    }),
    map:(run,call,raw)=>{
      if(call.inputs.length!==1)throw Error('listening_input_invalid');
      return [mapSignalListeningJevResponseV1(call.inputs[0]!,run.context,configurationOf(run),raw)];
    },
    error:(run,call,code)=>call.inputs.map(input=>({root_id:input.root_id,input_digest:input.input_digest,
      entity_context_digest:run.entity_context_digest,status:'error',answers:{},question_digests:{...input.question_digests},error_code:code})),
    labeled:result=>result.status==='labeled',fail_on_error:true,recovery_only:args.recovery_only,
  }});
}
export function createSignalListeningRuntimeStoreV1(database:Parameters<typeof createSignalListeningStoreV1>[0]['database'],
  options:{execution:JevStreamingExecutionV2;storage?:WorkspaceEngineStorageV1}){
  const storage=options.storage??createWorkspaceEngineStorageV1();
  return createSignalListeningStoreV1({database,page_size:options.execution.window_size,
    storeRaw:async()=>{throw Error('listening_page_writer_required');},
    storeRawVerified:true,assertRawReady:async()=>{await storage.assertReady?.();},
    rawPages:createLabelingRawPagesStorageV1(storage)});
}
export async function signalListeningJevJobV1(run_id:string,options:{
  database?:Parameters<typeof createSignalListeningStoreV1>[0]['database'];store?:Store;provider?:JevProviderV1;
  execution?:JevStreamingExecutionV2;preflight?:()=>Promise<void>;
  calibration?:{load:typeof loadSignalListeningCalibrationV1;derive:typeof deriveSignalListeningCalibrationV1};
}={}){
  if(process.env.NOISIA_SIGNAL_LISTENING_ENABLED!=='true'||process.env.NOISIA_JEV_PROVIDER_ENABLED==='false')
    throw Error('listening_provider_disabled');
  const execution=options.execution??jevStreamingExecutionFromEnvV2();
  if(!execution)throw Error('listening_streaming_required');
  await (options.preflight??(()=>assertMassJevConsumerV1({api_key:process.env.TYPESAFE_API_KEY??'',enabled:true})))();
  const database=options.database??(await import('../db/client')).pool;
  const run=(await database.query<{workspace_id:string;labeler_digest:string;recovery_only:boolean}>(`SELECT run.workspace_id,labeler.labeler_digest,
    (run.status='failed' OR owner.configuration_id IS DISTINCT FROM(SELECT id FROM signal_listening_configurations cfg
      WHERE cfg.workspace_id=run.workspace_id AND cfg.state='published' ORDER BY cfg.revision DESC LIMIT 1)) recovery_only
    FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
    JOIN signal_listening_runs owner ON owner.run_id=run.id AND owner.workspace_id=run.workspace_id
    WHERE run.id=$1 AND run.kind='mass_labeling' AND labeler.provider='typesafe'
      AND labeler.identity#>>'{params,request_version}'='listening-jev-v1'`,[run_id])).rows[0];
  if(!run||!await signalWorkspaceFeatureEnabledV1({queryable:database,workspace_id:run.workspace_id,feature:'mass_labeling'}))
    throw Error('listening_not_enabled');
  const store=options.store??createSignalListeningRuntimeStoreV1(database,{execution});
  let calibrated:ReturnType<typeof createSignalListeningCalibratedProviderV1>|undefined,recoveryProvider:JevProviderV1|undefined;
  let metadata:Awaited<ReturnType<Store['calls']>>|undefined,recovery:ReturnType<typeof selectSignalListeningRecoveryV1>,hydrated:Awaited<ReturnType<Store['calls']>>|undefined;
  let calibrationRun:Readonly<LabelingRunV1>|undefined,shapes:string[]=[],selection:SignalListeningInputV1[]|undefined;
  // This placeholder cannot send; the lease-held planner always selects runtime.
  const unavailable:JevProviderV1={async evaluate(){throw new JevProviderErrorV1('listening_preparation_required','definitely_not_sent');}};
  // Prepare inspects metadata only. The shared worker then loads exactly one
  // bounded raw selection once; no second full-page read and no hidden unknown.
  const boundedStore={...store,async calls(leased:LabelingRunV1){
    if(recovery){
      const loaded=await store.calls(leased,{call_ids:recovery.calls.map(call=>call.id)});
      // Routine measured recovery must not replace a wide ledger profile with
      // its latest32 narrow receipts. Only interrupted official warmup windows
      // need derivation; the DB still validates settled/applied evidence later.
      shapes=[...new Set(loaded.filter(call=>{
        if(!call.raw_body)return false;
        try{return JSON.parse(call.raw_body).rate_calibration?.kind==='official_context_bound';}catch{return false;}
      }).flatMap(call=>call.inputs).map(input=>signalListeningCalibrationShapeV1(configurationOf(leased),input).shape_digest))];
      return [...loaded,...(metadata??[]).filter(call=>call.status==='unknown'&&!listeningHasRawV1(call)&&!loaded.some(row=>row.id===call.id))];
    }
    return hydrated??metadata??await store.calls(leased,{metadata_only:true});
  }};
  try{
    return await processSignalListeningJevV1({run_id,execution,store:boundedStore,provider:unavailable,recovery_only:run.recovery_only,selection:()=>selection,
      prepare:async leased=>{
        calibrationRun=leased;
        try{
          const configuration=configurationOf(leased),pending=metadata=await store.calls(leased,{metadata_only:true});
          recovery=selectSignalListeningRecoveryV1(pending,execution);
          if(recovery){
            selection=[];shapes=[];
            recoveryProvider=createSignalListeningRecoveryProviderV1({execution:recovery.execution,external:options.provider});
            return{provider:recoveryProvider,execution:recovery.execution,max_windows:1,recovery_only:true};
          }
          if(leased.error_code==='labeling_outcome_unknown'||pending.some(call=>call.status==='unknown')){
            selection=[];shapes=[];recoveryProvider=createSignalListeningRecoveryProviderV1({execution,external:options.provider});
            return{provider:recoveryProvider,execution,max_windows:1,recovery_only:true};
          }
          if(pending.length){
            // Metadata contains no request/input bodies. Hydrate only a bounded
            // unsent cohort, including byte extrema rather than a blind prefix.
            const size=(call:typeof pending[number])=>Number(call.request_size_bytes??Buffer.byteLength(JSON.stringify(call.request)))+Number(call.input_size_bytes??Buffer.byteLength(JSON.stringify(call.inputs)));
            const sorted=[...pending].sort((a,b)=>size(a)-size(b));
            const priority=[sorted[0]!,sorted[sorted.length-1]!,...pending],seen=new Set<string>(),ids:string[]=[];let bytes=0;
            for(const call of priority){if(seen.has(call.id))continue;seen.add(call.id);const bound=size(call)*4+4096;
              if(!Number.isSafeInteger(bound)||bound<4096)throw Error('labeling_raw_receipt_invalid');
              if(bytes+bound>execution.max_buffered_bytes)continue;ids.push(call.id);bytes+=bound;if(ids.length>=execution.window_size)break;}
            if(!ids.length)throw Error('listening_recovery_memory_budget_exceeded');
            hydrated=await store.calls(leased,{call_ids:ids});
          }
          const inputs=pending.length?(hydrated??pending).filter(call=>!call.results_applied&&(!run.recovery_only||Boolean(call.raw_body))).flatMap(call=>call.inputs):await store.inputs(leased);
          const plan=await planSignalListeningCalibrationV1({workspace_id:leased.workspace_id,configuration_digest:digest(configuration),
            configuration,inputs,execution,loadProfile:shape_digest=>(options.calibration?.load??loadSignalListeningCalibrationV1)({database,
              workspace_id:leased.workspace_id,actor_user_id:leased.actor_user_id,configuration_digest:digest(configuration),model:configuration.model,shape_digest})});
          selection=plan.selected_inputs;shapes=plan.calibration_shapes;
          calibrated=createSignalListeningCalibratedProviderV1({plan,...(options.provider?{factory:()=>({...options.provider!,close:undefined})}:{})});
          calibrated.prepareRequests(selection.map(input=>buildSignalListeningJevRequestV1(input,configuration)));
          return{provider:calibrated.provider,execution:plan.execution,max_windows:1};
        }catch(error){
          const knownConfiguration=error instanceof Error&&[
            'listening_configuration_invalid','listening_identity_invalid','jev_stream_runtime_configuration_invalid',
            'jev_stream_account_configuration_missing','jev_stream_token_calibration_invalid','jev_stream_token_calibration_missing',
            'jev_stream_context_bound_invalid','jev_stream_warmup_account_limit',
          ].includes(error.message);
          if(error instanceof JevProviderErrorV1&&error.outcome==='definitely_not_sent'||knownConfiguration)
            await store.fail(leased,error instanceof JevProviderErrorV1?error.code:(error as Error).message,{preserve_reserved:true});
          throw error;
        }
      }});
  }finally{
    // Derivation reads only the same run's settled, verified, applied receipts.
    // A recovery-only pass also contributes its original shape, without a new fetch.
    try{if(calibrationRun)for(const shape_digest of shapes)await (options.calibration?.derive??deriveSignalListeningCalibrationV1)({database,
      workspace_id:calibrationRun.workspace_id,actor_user_id:calibrationRun.actor_user_id,run_id,shape_digest});}
    finally{await calibrated?.provider.close?.();await recoveryProvider?.close?.();}
  }
}
export async function drainSignalListeningOnceV1(options:{database?:Parameters<typeof createSignalListeningStoreV1>[0]['database'];
  run?:(id:string)=>Promise<unknown>}={}){
    if(process.env.NOISIA_SIGNAL_LISTENING_ENABLED!=='true'||process.env.NOISIA_JEV_PROVIDER_ENABLED==='false')return;
    const pool=options.database??(await import('../db/client')).pool;
    if(!(await pool.query(`SELECT to_regclass('signal_listening_runs') IS NOT NULL ready`)).rows[0]?.ready)return;
    const available=Boolean(process.env.TYPESAFE_API_KEY?.trim())&&process.env.NOISIA_JEV_STREAMING_V2_ENABLED==='true';
    for(const preparation of await pendingSignalListeningPreparationsV1({database:pool,limit:20})){
      try{await continueSignalListeningPreparationV1({database:pool,workspace_id:preparation.workspace_id,
        actor_user_id:preparation.actor_user_id,preparation_id:preparation.id,provider_available:available});}
      catch{console.warn('[listening] preparation unavailable');}
    }
    const rows=(await pool.query<{id:string}>(`SELECT run.id FROM signal_labeling_runs run
      JOIN signal_listening_runs owner ON owner.run_id=run.id AND owner.workspace_id=run.workspace_id
      JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
      WHERE (run.status IN('queued','running') OR run.status='failed' AND EXISTS(SELECT 1 FROM signal_labeling_calls call
          WHERE call.run_id=run.id AND call.workspace_id=run.workspace_id AND call.raw_storage_key IS NOT NULL AND NOT call.results_applied))
        AND run.next_poll_at<=now() AND NOT run.waiting_full_confirmation
        AND (run.lease_until IS NULL OR run.lease_until<now())
        AND labeler.identity#>>'{params,request_version}'='listening-jev-v1'
      ORDER BY run.updated_at,run.id LIMIT 1`)).rows;
    for(const row of rows)await (options.run??(id=>signalListeningJevJobV1(id,{database:pool})))(row.id);
}
export function startSignalListeningDrainerV1(){
  let active:Promise<void>|undefined;
  const start=()=>{if(!active)active=drainSignalListeningOnceV1().catch(()=>console.warn('[listening] execution unavailable')).finally(()=>{active=undefined;});};
  const timer=setInterval(start,1000);timer.unref?.();start();
  return {async close(){clearInterval(timer);await active;}};
}
