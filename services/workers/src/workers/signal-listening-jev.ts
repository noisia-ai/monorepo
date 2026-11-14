import {
  createSignalListeningStoreV1,signalWorkspaceFeatureEnabledV1,type LabelingRunV1,
} from '@noisia/db';
import {
  buildSignalListeningJevRequestV1,mapSignalListeningJevResponseV1,signalListeningJevIdentityV1,signalListeningRequestDigestV1,
  validateSignalListeningConfigurationV1,labelerDigestV1,llmPriceV1,llmCostMicroUsdV1,
  type SignalListeningInputV1,type SignalListeningResultV1,
} from '@noisia/query-engine';
import {assertMassJevConsumerV1} from '../providers/mass-labeling-consumer';
import {createCalibratedJevRuntimeProviderV2,jevStreamingExecutionFromEnvV2} from '../providers/jev-streaming-runtime';
import {JevProviderErrorV1,type JevProviderV1} from '../providers/typesafe-jev';
import {processJevLabelingPageV1,jevUsageV1} from './signal-jev-labeling-page';
import {createLabelingRawPagesStorageV1} from './signal-labeling-receipt-storage';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import type {JevStreamingExecutionV2} from './signal-jev-streaming-window';

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
  execution:JevStreamingExecutionV2;lease_renewal_ms?:number}){
  return processJevLabelingPageV1<SignalListeningInputV1,SignalListeningResultV1>({...args,hooks:{
    price:priceOf,
    propose:(run,inputs)=>inputs.map(input=>{
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
    labeled:result=>result.status==='labeled',fail_on_error:true,
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
const providers=new Map<string,JevProviderV1>();
// Runtime configuration errors are definitely-unsent transport failures under the
// claimed owner, so a queued run gets a durable error instead of polling forever.
export function createSignalListeningProviderV1(labeler_digest:string,execution:JevStreamingExecutionV2,
  factory=()=>createCalibratedJevRuntimeProviderV2({labeler_digest,execution})):JevProviderV1{
  let provider:JevProviderV1|undefined;
  const client=()=>{
    try{return provider??=factory();}
    catch{throw new JevProviderErrorV1('listening_provider_unavailable','definitely_not_sent');}
  };
  const configured=Number(process.env.NOISIA_JEV_MAX_RESPONSE_BYTES??16384);
  return {max_concurrency:execution.max_in_flight,
    max_response_bytes:Number.isSafeInteger(configured)&&configured>0&&configured<=2*1024*1024?configured:16384,
    evaluate:(request,options)=>client().evaluate(request,options),
    observeUsage:async(raw,tokens)=>{await client().observeUsage?.(raw,tokens);}};
}
export async function signalListeningJevJobV1(run_id:string,options:{
  database?:Parameters<typeof createSignalListeningStoreV1>[0]['database'];store?:Store;provider?:JevProviderV1;
  execution?:JevStreamingExecutionV2;preflight?:()=>Promise<void>;
}={}){
  if(process.env.NOISIA_SIGNAL_LISTENING_ENABLED!=='true'||process.env.NOISIA_JEV_PROVIDER_ENABLED==='false')
    throw Error('listening_provider_disabled');
  const execution=options.execution??jevStreamingExecutionFromEnvV2();
  if(!execution)throw Error('listening_streaming_required');
  await (options.preflight??(()=>assertMassJevConsumerV1({api_key:process.env.TYPESAFE_API_KEY??'',enabled:true})))();
  const database=options.database??(await import('../db/client')).pool;
  const run=(await database.query<{workspace_id:string;labeler_digest:string}>(`SELECT run.workspace_id,labeler.labeler_digest
    FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
    WHERE run.id=$1 AND run.kind='mass_labeling' AND labeler.provider='typesafe'
      AND labeler.identity#>>'{params,request_version}'='listening-jev-v1'`,[run_id])).rows[0];
  if(!run||!await signalWorkspaceFeatureEnabledV1({queryable:database,workspace_id:run.workspace_id,feature:'mass_labeling'}))
    throw Error('listening_not_enabled');
  if(!options.provider&&!providers.has(run.labeler_digest))providers.set(run.labeler_digest,
    createSignalListeningProviderV1(run.labeler_digest,execution));
  return processSignalListeningJevV1({run_id,execution,store:options.store??createSignalListeningRuntimeStoreV1(database,{execution}),
    provider:options.provider??providers.get(run.labeler_digest)!});
}
export function startSignalListeningDrainerV1(){
  let active:Promise<void>|undefined;
  const tick=async()=>{
    if(process.env.NOISIA_SIGNAL_LISTENING_ENABLED!=='true'||process.env.NOISIA_JEV_PROVIDER_ENABLED==='false')return;
    const {pool}=await import('../db/client');
    if(!(await pool.query(`SELECT to_regclass('signal_listening_runs') IS NOT NULL ready`)).rows[0]?.ready)return;
    const rows=(await pool.query<{id:string}>(`SELECT run.id FROM signal_labeling_runs run
      JOIN signal_listening_runs owner ON owner.run_id=run.id AND owner.workspace_id=run.workspace_id
      JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
      WHERE run.status IN('queued','running') AND run.next_poll_at<=now() AND NOT run.waiting_full_confirmation
        AND (run.lease_until IS NULL OR run.lease_until<now())
        AND labeler.identity#>>'{params,request_version}'='listening-jev-v1'
      ORDER BY run.updated_at,run.id LIMIT 1`)).rows;
    for(const row of rows)await signalListeningJevJobV1(row.id);
  };
  const start=()=>{if(!active)active=tick().catch(()=>console.warn('[listening] execution unavailable')).finally(()=>{active=undefined;});};
  const timer=setInterval(start,1000);timer.unref?.();start();
  return {async close(){clearInterval(timer);await active;}};
}
