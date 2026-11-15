import type {ListeningDiscoveryLeaseV1,ListeningDiscoveryRawStoreV1,SignalListeningAccessV1} from '@noisia/db';
import {signalWorkspaceEmbeddingDigestV1} from '@noisia/query-engine';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAnthropicListeningDiscoveryProviderV1,ListeningDiscoveryProviderErrorV1,
  encodeListeningDiscoveryTransportV1,decodeListeningDiscoveryTransportV1,type ListeningDiscoveryProviderV1} from '../providers/anthropic-listening-discovery';
import {buildWorkspaceEngineStorageKeyV1,createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';

type Db=typeof import('@noisia/db');
type Database=SignalListeningAccessV1['database'];
export type ListeningDiscoveryWorkerContextV1=NonNullable<Awaited<ReturnType<Db['getSignalListeningDiscoveryWorkerContextV1']>>>;
export type ListeningDiscoveryWorkerStoresV1={
  claim:Db['claimSignalListeningDiscoveryRoundV1'];reserve:Db['reserveSignalListeningDiscoveryCallV1'];
  markSent:Db['markSignalListeningDiscoveryCallSentV1'];persistRaw:Db['persistSignalListeningDiscoveryRawV1'];
  loadRaw:Db['loadSignalListeningDiscoveryRawIntentV1'];settle:Db['settleSignalListeningDiscoveryCallV1'];
  fail:Db['failSignalListeningDiscoveryCallV1'];applyReview:Db['applySignalListeningDiscoveryReviewV1'];
  prepareChild:Db['prepareSignalListeningDiscoveryChildV1'];complete:Db['completeSignalListeningDiscoveryRoundV1'];
  activate:Db['activateSignalListeningServingSnapshotV1'];
  context:Db['getSignalListeningDiscoveryWorkerContextV1'];renew:Db['renewSignalListeningDiscoveryRoundV1'];
  release:Db['releaseSignalListeningDiscoveryRoundV1'];publicationRecovery:Db['getSignalListeningDiscoveryPublicationRecoveryV1'];
};
export type ListeningDiscoveryWorkerOptionsV1={database?:Database;stores?:ListeningDiscoveryWorkerStoresV1;
  provider?:ListeningDiscoveryProviderV1;storage?:WorkspaceEngineStorageV1;raw_store?:ListeningDiscoveryRawStoreV1;
  assert_storage_ready?:()=>Promise<void>;env?:Record<string,string|undefined>;should_stop?:()=>boolean;renewal_ms?:number};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const sha=(text:string)=>'sha256:'+createHash('sha256').update(text).digest('hex');
const error=(code:string)=>Object.assign(Error(code),{code});
export function safeListeningDiscoveryErrorV1(value:unknown){
  const code=value&&typeof value==='object'&&'code'in value?value.code:value instanceof Error?value.message:null;
  return typeof code==='string'&&/^listening_discovery_[a-z0-9_]{1,100}$/u.test(code)?code:'listening_discovery_worker_failed';
}
async function defaultStores():Promise<ListeningDiscoveryWorkerStoresV1>{
  const db=await import('@noisia/db');
  // Lifecycle helpers are DB-owned, reviewed independently. Missing support
  // closes the worker before any claim, reservation or provider construction.
  if([db.getSignalListeningDiscoveryWorkerContextV1,db.renewSignalListeningDiscoveryRoundV1,
    db.releaseSignalListeningDiscoveryRoundV1,db.getSignalListeningDiscoveryPublicationRecoveryV1].some(fn=>typeof fn!=='function'))
    throw error('listening_discovery_lifecycle_unavailable');
  return{claim:db.claimSignalListeningDiscoveryRoundV1,reserve:db.reserveSignalListeningDiscoveryCallV1,
    markSent:db.markSignalListeningDiscoveryCallSentV1,persistRaw:db.persistSignalListeningDiscoveryRawV1,
    loadRaw:db.loadSignalListeningDiscoveryRawIntentV1,settle:db.settleSignalListeningDiscoveryCallV1,
    fail:db.failSignalListeningDiscoveryCallV1,applyReview:db.applySignalListeningDiscoveryReviewV1,
    prepareChild:db.prepareSignalListeningDiscoveryChildV1,complete:db.completeSignalListeningDiscoveryRoundV1,
    activate:db.activateSignalListeningServingSnapshotV1,context:db.getSignalListeningDiscoveryWorkerContextV1,
    renew:db.renewSignalListeningDiscoveryRoundV1,release:db.releaseSignalListeningDiscoveryRoundV1,
    publicationRecovery:db.getSignalListeningDiscoveryPublicationRecoveryV1};
}

/** Native private artifact adapter. Scope and content-addressed keys never come
 * from a browser or a provider response. DB verifies the readback a second time. */
export function createListeningDiscoveryRawStoreV1(storage:WorkspaceEngineStorageV1):ListeningDiscoveryRawStoreV1{
  const reference:ListeningDiscoveryRawStoreV1['reference']=args=>({storage_key:buildWorkspaceEngineStorageKeyV1(
    args.workspace_id,args.round_id,args.name,args.raw_sha256)});
  return{reference,async store(args){
    if(args.name!==`review-${args.raw_sha256.slice(7)}.json`||args.size_bytes>8*1024*1024||args.size_bytes<1
      ||Buffer.byteLength(args.raw_text)!==args.size_bytes||sha(args.raw_text)!==args.raw_sha256)throw error('listening_discovery_raw_invalid');
    const directory=await mkdtemp(join(tmpdir(),'noisia-discovery-receipt-'));
    try{const file=join(directory,args.name);await writeFile(file,args.raw_text,{mode:0o600,flag:'wx'});
      const stored=await storage.put({workspace_id:args.workspace_id,execution_id:args.round_id,file,sha256:args.raw_sha256,
        size_bytes:args.size_bytes,media_type:'application/json'});
      if(stored.storage_key!==reference(args).storage_key||stored.sha256!==args.raw_sha256||stored.size_bytes!==args.size_bytes)
        throw error('listening_discovery_storage_reference_invalid');
      return{...stored,verified:true};
    }finally{await rm(directory,{recursive:true,force:true});}
  },async load(args){
    const match=/^workspace-engine\/([a-f0-9-]{36})\/([a-f0-9-]{36})\//iu.exec(args.storage_key);
    if(!match||!uuid.test(match[1]!)||!uuid.test(match[2]!)||args.size_bytes<1||args.size_bytes>8*1024*1024
      ||args.storage_key!==buildWorkspaceEngineStorageKeyV1(match[1]!,match[2]!,`review-${args.sha256.slice(7)}.json`,args.sha256))
      throw error('listening_discovery_storage_reference_invalid');
    const directory=await mkdtemp(join(tmpdir(),'noisia-discovery-readback-'));
    try{const destination=join(directory,'receipt.json');await storage.get({workspace_id:match[1]!,execution_id:match[2]!,
      stored:{...args,media_type:'application/json'},destination});const raw=await readFile(destination,'utf8');
      if(Buffer.byteLength(raw)!==args.size_bytes||sha(raw)!==args.sha256)throw error('listening_discovery_storage_checksum_invalid');return raw;
    }finally{await rm(directory,{recursive:true,force:true});}
  }};
}

/** Identity-only job for one already admitted round. It never creates a new
 * execution/round and never retries a physical provider request. */
export async function signalListeningDiscoveryJobV1(round_id:string,options:ListeningDiscoveryWorkerOptionsV1={}){
  if(!uuid.test(round_id))throw error('listening_discovery_job_invalid');
  const database=options.database??(await import('../db/client')).pool,stores=options.stores??await defaultStores();
  const publication=await stores.publicationRecovery({database,round_id});
  if(publication){
    if(publication.round_id!==round_id||!uuid.test(publication.workspace_id)||!uuid.test(publication.actor_user_id))throw error('listening_discovery_scope_invalid');
    await stores.activate({database,...publication});return{round_id,status:'completed' as const,recovered_publication:true};
  }
  const lease=await stores.claim({database,round_id});if(!lease)return{round_id,status:'not_claimed' as const};
  if(lease.round_id!==round_id||!uuid.test(lease.workspace_id)||!uuid.test(lease.execution_token)||typeof lease.request_body!=='string')
    throw error('listening_discovery_lease_invalid');
  const env=options.env??process.env,enabled=()=>env.NOISIA_LISTENING_DISCOVERY_ENABLED==='true';
  const providerAvailable=()=>enabled()&&Boolean(env.NOISIA_LISTENING_DISCOVERY_ANTHROPIC_API_KEY?.trim())&&!options.should_stop?.();
  let call:Awaited<ReturnType<ListeningDiscoveryWorkerStoresV1['reserve']>>|undefined;
  let markAttempted=false,rawPersisted=false,releaseLease=true,leaseError:unknown,renewal:Promise<unknown>|undefined;
  const renewalMs=options.renewal_ms??30_000;
  if(!Number.isSafeInteger(renewalMs)||renewalMs<1||renewalMs>60_000){await stores.release({database,lease});throw error('listening_discovery_renewal_invalid');}
  const timer=setInterval(()=>{if(renewal||leaseError)return;renewal=stores.renew({database,lease})
    .then(renewed=>{if(!renewed)leaseError=error('listening_discovery_lease_lost');})
    .catch(reason=>{leaseError=reason;}).finally(()=>{renewal=undefined;});},renewalMs);timer.unref?.();
  const stopHeartbeat=async()=>{clearInterval(timer);if(renewal)await renewal;};
  try{
    const context=await stores.context({database,lease});
    if(!context)throw error('listening_discovery_lease_lost');
    if(context.round_id!==round_id||context.workspace_id!==lease.workspace_id||!uuid.test(context.actor_user_id))throw error('listening_discovery_scope_invalid');
    if(context.request_body!==lease.request_body)throw error('listening_discovery_request_binding_invalid');
    const access={database,workspace_id:context.workspace_id,actor_user_id:context.actor_user_id};
    call=await stores.reserve({database,lease,provider_available:providerAvailable()});
    if(!call||!uuid.test(call.id)||!uuid.test(call.attempt_token)||call.workspace_id!==lease.workspace_id||call.listening_round_id!==round_id)
      throw error('listening_discovery_call_invalid');
    let rawStore=options.raw_store,storage=options.storage;
    const artifacts=()=>{storage??=createWorkspaceEngineStorageV1();return storage;};
    const rawStorage=()=>rawStore??(rawStore=createListeningDiscoveryRawStoreV1(artifacts()));
    let intent=await stores.loadRaw({database,call_id:call.id,attempt_token:call.attempt_token});
    if(intent){
      // A planned receipt is a durable send outcome, even when upload or attach
      // lost its acknowledgement. Reuse every original byte without a key.
      await stores.persistRaw({database,call_id:call.id,attempt_token:call.attempt_token,raw_text:intent.raw_text,raw_store:rawStorage()});
      rawPersisted=true;
    }else if(call.call_state==='reserved'&&!lease.recovery_only){
      if(!providerAvailable())return{round_id,status:'disabled' as const};
      const provider=options.provider??createAnthropicListeningDiscoveryProviderV1({apiKey:env.NOISIA_LISTENING_DISCOVERY_ANTHROPIC_API_KEY!});
      provider.assertReady(lease.request_body);
      try{if(signalWorkspaceEmbeddingDigestV1(JSON.parse(lease.request_body))!==call.request_digest)throw Error();}
      catch{throw error('listening_discovery_request_binding_invalid');}
      if(options.assert_storage_ready)await options.assert_storage_ready();else{
        const nativeStorage=artifacts();if(!nativeStorage.assertReady)throw error('listening_discovery_storage_preflight_missing');
        await nativeStorage.assertReady();
      }
      if(renewal)await renewal;if(leaseError)throw error('listening_discovery_lease_lost');
      if(!providerAvailable())return{round_id,status:'stopped' as const};
      markAttempted=true;
      const sent=await stores.markSent({database,lease,call_id:call.id,attempt_token:call.attempt_token,provider_available:true});
      // The false CAS may belong to another sender. Do not fail or release it.
      if(!sent){releaseLease=false;return{round_id,status:'reconciliation_only' as const};}
      const receipt=await provider.generate(lease.request_body),raw_text=encodeListeningDiscoveryTransportV1(receipt);
      await stores.persistRaw({database,call_id:call.id,attempt_token:call.attempt_token,raw_text,raw_store:rawStorage()});rawPersisted=true;
      intent=await stores.loadRaw({database,call_id:call.id,attempt_token:call.attempt_token});
      if(!intent||intent.raw_text!==raw_text)throw error('listening_discovery_paid_receipt_missing');
    }else return{round_id,status:'reconciliation_only' as const};
    const wrapper=decodeListeningDiscoveryTransportV1(intent.raw_text);
    if(!wrapper.complete||!wrapper.utf8_valid||wrapper.http_status!==200){
      await stores.fail({database,lease,call_id:call.id,attempt_token:call.attempt_token,outcome:'outcome_unknown',
        error_code:'listening_discovery_transport_unknown'}).catch(()=>undefined);
      return{round_id,status:'outcome_unknown' as const};
    }
    const settlement=await stores.settle({database,call_id:call.id,attempt_token:call.attempt_token});
    if('unresolved'in settlement)return{round_id,status:'outcome_unknown' as const};
    await stopHeartbeat();if(leaseError)return{round_id,status:'reconciliation_only' as const};
    if(!enabled()||options.should_stop?.())return{round_id,status:'recovered' as const};
    // Once paid custody is reconciled, publication still goes through native
    // authority/CAS. A later human revision wins over the sealed agent output.
    if(context.status!=='classifying'&&!context.output_configuration_id){
      const reviewed=await stores.applyReview({...access,round_id});
      if(reviewed.status==='failed'||reviewed.status==='stale')return reviewed;
    }
    if(options.should_stop?.())return{round_id,status:'stopped' as const};
    const child=await stores.prepareChild({...access,round_id,
      provider_available:env.NOISIA_SIGNAL_LISTENING_ENABLED==='true'&&env.NOISIA_JEV_STREAMING_V2_ENABLED==='true'
        &&env.NOISIA_JEV_PROVIDER_ENABLED!=='false'&&Boolean(env.TYPESAFE_API_KEY?.trim()),
      prototype_provider_available:env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED==='true'&&Boolean(env.VOYAGE_API_KEY?.trim())});
    if(child.discovery_round_status==='outcome_unknown')return{round_id,status:'waiting_child_recovery' as const,recovery_pending:child.recovery_pending};
    if(child.discovery_round_status==='stale')return{round_id,status:'stale' as const};
    if(child.discovery_round_status==='failed'||child.status==='failed')return{round_id,status:'child_failed' as const};
    if(child.status!=='completed')return{round_id,status:'waiting_child' as const,preparation_id:child.id,run_id:child.listening_run_id};
    const completed=await stores.complete({...access,round_id});
    await stores.activate({...access,round_id});return{round_id,status:'completed' as const,stop_decision:completed.stop_decision};
  }catch(reason){
    if(call&&!rawPersisted&&(markAttempted||reason instanceof ListeningDiscoveryProviderErrorV1)){
      const outcome=!markAttempted&&reason instanceof ListeningDiscoveryProviderErrorV1&&reason.outcome==='definitely_not_sent'
        ?'definitely_not_sent' as const:'outcome_unknown' as const;
      await stores.fail({database,lease,call_id:call.id,attempt_token:call.attempt_token,outcome,
        error_code:safeListeningDiscoveryErrorV1(reason)}).catch(()=>undefined);
    }
    throw error(safeListeningDiscoveryErrorV1(reason));
  }finally{await stopHeartbeat();if(releaseLease)await stores.release({database,lease}).catch(()=>undefined);}
}

type DrainerOptions=ListeningDiscoveryWorkerOptionsV1&{interval_ms?:number;run_immediately?:boolean;
  list?:(args:{database:Database;limit:number;enabled:boolean})=>ReturnType<Db['pendingSignalListeningDiscoveryRoundsV1']>;
  run?:typeof signalListeningDiscoveryJobV1};
export async function drainSignalListeningDiscoveryOnceV1(options:DrainerOptions={}){
  const database=options.database??(await import('../db/client')).pool;
  const list=options.list??(await import('@noisia/db')).pendingSignalListeningDiscoveryRoundsV1;
  const enabled=(options.env??process.env).NOISIA_LISTENING_DISCOVERY_ENABLED==='true';
  const rows=await list({database,limit:20,enabled}),result={candidates:rows.length,completed:0,reconciled:0,failed:0};
  for(const row of rows){
    if(options.should_stop?.())break;
    if(!enabled&&row.status==='queued')continue;
    try{const outcome=await(options.run??signalListeningDiscoveryJobV1)(row.round_id,{...options,database});
      if(outcome.status==='completed')result.completed++;else result.reconciled++;
    }catch{result.failed++;}
  }
  return result;
}
export function startSignalListeningDiscoveryDrainerV1(options:DrainerOptions={}){
  const interval=options.interval_ms??2500;if(!Number.isSafeInteger(interval)||interval<10||interval>60000)throw error('listening_discovery_interval_invalid');
  let closed=false,inFlight:Promise<unknown>|undefined;
  const drainNow=()=>{
    if(closed)return Promise.resolve();if(inFlight)return inFlight;
    inFlight=drainSignalListeningDiscoveryOnceV1({...options,should_stop:()=>closed||Boolean(options.should_stop?.())})
      .catch(reason=>{console.warn('[listening-discovery] '+safeListeningDiscoveryErrorV1(reason));}).finally(()=>{inFlight=undefined;});return inFlight;
  };
  const timer=setInterval(()=>{void drainNow();},interval);timer.unref?.();
  if(options.run_immediately!==false)void drainNow();
  return{drainNow,async close(){closed=true;clearInterval(timer);await inFlight;}};
}
