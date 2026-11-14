import {
  createSignalListeningStoreV1,signalWorkspaceFeatureEnabledV1,loadSignalListeningCalibrationV1,deriveSignalListeningCalibrationV1,
  pendingSignalListeningPreparationsV1,continueSignalListeningPreparationV1,type LabelingRunV1,
} from '@noisia/db';
import {
  buildSignalListeningJevRequestV1,mapSignalListeningJevResponseV1,signalListeningJevIdentityV1,signalListeningRequestDigestV1,
  validateSignalListeningConfigurationV1,labelerDigestV1,llmPriceV1,llmCostMicroUsdV1,
  signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningInputV1,type SignalListeningResultV1,
} from '@noisia/query-engine';
import {assertMassJevConsumerV1} from '../providers/mass-labeling-consumer';
import {jevStreamingExecutionFromEnvV2} from '../providers/jev-streaming-runtime';
import {JevProviderErrorV1,type JevProviderV1} from '../providers/typesafe-jev';
import {processJevLabelingPageV1,jevUsageV1,type JevPreparedExecutionV1} from './signal-jev-labeling-page';
import {createLabelingRawPagesStorageV1} from './signal-labeling-receipt-storage';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import type {JevStreamingExecutionV2} from './signal-jev-streaming-window';

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
  prepare?(run:Readonly<LabelingRunV1>):Promise<JevPreparedExecutionV1>}){
  let windowSize=args.execution.window_size;
  return processJevLabelingPageV1<SignalListeningInputV1,SignalListeningResultV1>({...args,
    prepare:args.prepare?async run=>{const prepared=await args.prepare!(run);windowSize=prepared.execution.window_size;return prepared;}:undefined,hooks:{
    price:priceOf,
    propose:(run,inputs)=>inputs.slice(0,windowSize).map(input=>{
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
  let calibrated:ReturnType<typeof createSignalListeningCalibratedProviderV1>|undefined;
  let calibrationRun:Readonly<LabelingRunV1>|undefined,shapes:string[]=[];
  // This placeholder cannot send; the lease-held planner always selects runtime.
  const unavailable:JevProviderV1={async evaluate(){throw new JevProviderErrorV1('listening_preparation_required','definitely_not_sent');}};
  try{
    return await processSignalListeningJevV1({run_id,execution,store,provider:unavailable,recovery_only:run.recovery_only,
      prepare:async leased=>{
        calibrationRun=leased;
        try{
          const configuration=configurationOf(leased),pending=await store.calls(leased);
          const inputs=pending.length?pending.filter(call=>!call.results_applied).flatMap(call=>call.inputs):await store.inputs(leased);
          const plan=await planSignalListeningCalibrationV1({workspace_id:leased.workspace_id,configuration_digest:digest(configuration),
            configuration,inputs,execution,loadProfile:shape_digest=>(options.calibration?.load??loadSignalListeningCalibrationV1)({database,
              workspace_id:leased.workspace_id,actor_user_id:leased.actor_user_id,configuration_digest:digest(configuration),model:configuration.model,shape_digest})});
          shapes=[...plan.profiles.keys()];
          calibrated=createSignalListeningCalibratedProviderV1({plan,...(options.provider?{factory:()=>({...options.provider!,close:undefined})}:{})});
          calibrated.prepareRequests(inputs.slice(0,plan.execution.window_size).map(input=>buildSignalListeningJevRequestV1(input,configuration)));
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
    finally{await calibrated?.provider.close?.();}
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
