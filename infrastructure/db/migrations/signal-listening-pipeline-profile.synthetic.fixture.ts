import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {open,mkdir,realpath} from 'node:fs/promises';
import {relative,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {readSignalListeningQuestionsMetricsV1,getSignalListeningStatusV1} from '../signal-listening-serving';
import {createSignalListeningStoreV1} from '../signal-listening-runs';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {createSyntheticJevFetchV1,deterministicR16LatencyV1} from '../../../scripts/r16/synthetic-jev';
import {createCalibratedJevRuntimeProviderV2} from '../../../services/workers/src/providers/jev-streaming-runtime';
import {signalListeningJevJobV1} from '../../../services/workers/src/workers/signal-listening-jev';
import {type JevStreamingExecutionV2} from '../../../services/workers/src/workers/signal-jev-streaming-window';
import {withFlatPrefixFullFixtureV1,readFlatPrefixSetupStateV1,flatPrefixLedgerSqlV1,type FlatPrefixReadyFixtureV1} from './signal-listening-flat-prefix.synthetic.fixture';

const PROFILE_LIMITS:JevStreamingExecutionV2={max_in_flight:1024,window_size:4096,flush_size:1024,max_flushes:2,
 max_buffered_bytes:512*1024*1024,flush_interval_ms:250};
const PROFILE_TEST_MS=780_000,PROFILE_BRACKET_MS=120_000,MAX_JOB_INVOCATIONS=16,MAX_ARTIFACT_BYTES=2*1024*1024;
type TraceContext={operation:number;batch:number};
type Queryable={query:(...args:any[])=>Promise<any>;connect?:()=>Promise<any>};
const OP={unattributed:0,inputs:1,calls:2,reserve:3,markSubmitting:4,persistRawPage:5,settlePage:6,apply:7,
 finish:8,refresh:9,requeueUnsent:10,verify:11,claim:12,renew:13,release:14} as const;
const STORE_METHODS=new Map<string,number>([['inputs',OP.inputs],['calls',OP.calls],['reserve',OP.reserve],
 ['markSubmitting',OP.markSubmitting],['markSubmittingSelected',OP.markSubmitting],['persistRawPage',OP.persistRawPage],
 ['settlePage',OP.settlePage],['apply',OP.apply],['finish',OP.finish],['refresh',OP.refresh],['requeueUnsent',OP.requeueUnsent],
 ['claim',OP.claim],['renew',OP.renew],['release',OP.release]]);
const sha=(text:string)=>`sha256:${createHash('sha256').update(text.replace(/\s+/gu,' ').trim(),'utf8').digest('hex')}`;
const roundMs=(value:number)=>Math.round(value*10)/10;

/** Bounded append-only counters preserve loss explicitly; no event is silently truncated. */
function createProfileRecorder(){
 const caps={stream:30_000,http:8_192,provider:8_192,store:8_192,query:16_000,calibration:64};
 const events={stream:[] as number[][],http:[] as number[][],provider:[] as number[][],store:[] as number[][],query:[] as number[][],calibration:[] as number[][]};
 const counts=Object.fromEntries(Object.keys(caps).map(key=>[key,{seen:0,recorded:0,dropped:0}])) as Record<keyof typeof caps,{seen:number;recorded:number;dropped:number}>;
 const QUERY_TEMPLATE_CAP=1_024,queryTemplates:string[]=[],queryTemplateIndex=new Map<string,number>();
 const queryTemplateCounts={seen:0,recorded:0,dropped:0,limit:QUERY_TEMPLATE_CAP};
 const requestToSequence=new WeakMap<object,number>(),callToFlush=new WeakMap<object,number>();
 const providerEventByRequest=new WeakMap<object,number[]>();
 let nextRequest=0,appliedCalls=0;
 const append=<K extends keyof typeof caps>(kind:K,row:number[])=>{const counter=counts[kind];counter.seen++;
  if(events[kind].length>=caps[kind]){counter.dropped++;return;}events[kind].push(row);counter.recorded++;};
 const sequenceFor=(call:unknown)=>{
  if(!call||typeof call!=='object')return 0;
  const request=(call as {request?:unknown}).request;
  if(!request||typeof request!=='object')return 0;
  let sequence=requestToSequence.get(request);if(sequence===undefined){sequence=++nextRequest;requestToSequence.set(request,sequence);}
  return sequence;
 };
 const nextQueryTemplate=(hash:string)=>{let index=queryTemplateIndex.get(hash);if(index!==undefined)return index;
  queryTemplateCounts.seen++;if(queryTemplates.length>=QUERY_TEMPLATE_CAP){queryTemplateCounts.dropped++;return -1;}
  index=queryTemplates.length;queryTemplateIndex.set(hash,index);queryTemplates.push(hash);queryTemplateCounts.recorded++;return index;};
 return{events,counts,queryTemplates,context:new AsyncLocalStorage<TraceContext>(),
  requestToSequence,callToFlush,providerEventByRequest,sequenceFor,nextQueryTemplate,append,
  assignRequests(calls:unknown[]){for(const call of calls){if(!call||typeof call!=='object')continue;
    sequenceFor(call);}},
  recordStream(at:number,metrics:{in_flight:number;reserved_working_bytes:number;buffered_responses:number;active_flushes:number}){
   append('stream',[roundMs(at),metrics.in_flight,metrics.reserved_working_bytes,metrics.buffered_responses,metrics.active_flushes]);},
  recordHttp(index:number,start:number,end:number,requestedDelay:number){append('http',[index,roundMs(start),roundMs(end),requestedDelay]);},
  snapshot(){return{event_counts:counts,limits:caps,query_template_hashes:queryTemplates,query_template_counts:queryTemplateCounts,events};},
  addAppliedCalls(count:number){appliedCalls+=count;},getAppliedCalls(){return appliedCalls;},
  markInconclusive(){return Object.values(counts).some(row=>row.dropped>0)||queryTemplateCounts.dropped>0;},
 };
}

function callsIn(value:unknown):object[]{
 if(!Array.isArray(value))return[];
 return value.map(row=>row&&typeof row==='object'&&'call'in row?(row as {call:object}).call:row as object);
}
function operationBatchSize(name:string,args:unknown[],result:unknown){
 if(name==='inputs'||name==='calls')return Array.isArray(result)?result.length:0;
 if(name==='markSubmittingSelected')return Array.isArray(result)?result.length:0;
 if(name==='reserve'||name==='markSubmitting')return Array.isArray(result)?result.length:0;
 return Array.isArray(args[1])?args[1].length:0;
}
function operationBatchToken(name:string,args:unknown[],recorder:ReturnType<typeof createProfileRecorder>){
 if(name==='persistRawPage'){
  const token=++nextGlobalFlush;for(const call of callsIn(args[1])){recorder.callToFlush.set(call,token);
   const request=(call as {request?:unknown}).request;
   if(request&&typeof request==='object'){const providerEvent=recorder.providerEventByRequest.get(request);if(providerEvent)providerEvent[3]=token;}}
  return token;
 }
 if(name==='settlePage'||name==='apply'){
  const tokens=new Set(callsIn(args[1]).map(call=>{
   return recorder.callToFlush.get(call)??0;
  }));return tokens.size===1?[...tokens][0]!:0;
 }
 if(name==='markSubmitting'||name==='markSubmittingSelected')return ++nextGlobalBatch;
 if(name==='reserve')return ++nextGlobalBatch;
 return 0;
}
let nextGlobalFlush=0,nextGlobalBatch=0;

function instrumentDatabase<T extends Queryable>(database:T,recorder:ReturnType<typeof createProfileRecorder>,clock:()=>number):T{
 const wrapQuery=(query:(...args:any[])=>Promise<any>)=>async(...args:any[])=>{
  const started=clock(),context=recorder.context.getStore()??{operation:OP.unattributed,batch:0};
  const text=typeof args[0]==='string'?args[0]:args[0]&&typeof args[0]==='object'&&typeof args[0].text==='string'?args[0].text:'unknown-query-template';
  const hash=sha(text);
  try{return await query(...args);}finally{recorder.append('query',[roundMs(started),roundMs(clock()),context.operation,
    recorder.nextQueryTemplate(hash),context.batch]);}
 };
 const wrapClient=<C extends {query:(...args:any[])=>Promise<any>}>(client:C):C=>new Proxy(client,{get(target,key,receiver){
  if(key==='query')return wrapQuery(target.query.bind(target));const value=Reflect.get(target,key,receiver);
  return typeof value==='function'?value.bind(target):value;
 }}) as C;
 return new Proxy(database,{get(target,key,receiver){
  if(key==='query')return wrapQuery(target.query.bind(target));
  if(key==='connect'&&target.connect)return async()=>wrapClient(await target.connect!());
  const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;
 }}) as T;
}

function instrumentStore<T extends Record<string,unknown>>(store:T,recorder:ReturnType<typeof createProfileRecorder>,clock:()=>number):T{
 return new Proxy(store,{get(target,key,receiver){const value=Reflect.get(target,key,receiver),name=String(key),operation=STORE_METHODS.get(name);
  if(operation===undefined||typeof value!=='function')return typeof value==='function'?value.bind(target):value;
  return async(...args:unknown[])=>{
   const start=clock(),batch=operationBatchToken(name,args,recorder);let result:unknown;
   try{result=await recorder.context.run({operation,batch},()=>value.apply(target,args));
    if(name==='apply')recorder.addAppliedCalls(operationBatchSize(name,args,result));
    if(name==='reserve'||name==='calls'||name==='markSubmitting'||name==='markSubmittingSelected'){
     const rows=Array.isArray(result)?result as object[]:[];recorder.assignRequests(rows);
    }
    return result;
   }finally{recorder.append('store',[roundMs(start),roundMs(clock()),operation,operationBatchSize(name,args,result),batch]);}
  };
 }}) as T;
}

function instrumentProviderFactory(args:{redisUrl:string;organizationId:string;recorder:ReturnType<typeof createProfileRecorder>;clock:()=>number;fetch:typeof fetch}){
 return (options:Parameters<typeof createCalibratedJevRuntimeProviderV2>[0])=>{
  const base=createCalibratedJevRuntimeProviderV2({...options,env:{...options.env,TYPESAFE_API_KEY:'synthetic-local-only',
   NOISIA_TYPESAFE_ACCOUNT_ID:`r16-profile:${args.organizationId}`,NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:args.redisUrl,
   NOISIA_TYPESAFE_ACCOUNT_RPS:'10000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000'},fetch:args.fetch});
  return{max_concurrency:base.max_concurrency,max_response_bytes:base.max_response_bytes,
   ...(base.observeUsage?{observeUsage:(raw:Parameters<NonNullable<typeof base.observeUsage>>[0],tokens:Parameters<NonNullable<typeof base.observeUsage>>[1])=>base.observeUsage!(raw,tokens)}:{}),
   async evaluate(request:Parameters<typeof base.evaluate>[0],settings?:Parameters<typeof base.evaluate>[1]){
    const sequence=args.recorder.sequenceFor({request});
    const start=args.clock();
    try{return await base.evaluate(request,settings);}finally{
     const event=[sequence,roundMs(start),roundMs(args.clock()),0];args.recorder.append('provider',event);
     if(request&&typeof request==='object')args.recorder.providerEventByRequest.set(request as object,event);
    }
   },...(base.close?{close:()=>base.close!()}:{}),
  };
 };
}

async function countResolved(access:{database:FlatPrefixReadyFixtureV1['database'];workspace_id:string;actor_user_id:string;
 configuration_id:string;map_id:string;run_id:string},expectedRootIds:string[],recorder:ReturnType<typeof createProfileRecorder>,clock:()=>number){
 const expected=new Set(expectedRootIds);assert.equal(expected.size,expectedRootIds.length,'profile expected roster distinct');
 const census=await recorder.context.run({operation:OP.verify,batch:0},()=>loadR16ListeningNativeCensusV1(
  access as unknown as Parameters<typeof loadR16ListeningNativeCensusV1>[0],expectedRootIds.length));
 const roster=new Set(census.root_ids);assert.equal(roster.size,expected.size,'profile native root census exact');
 assert.ok([...roster].every(root=>expected.has(root)),'profile final census preserves exact native root roster');
 const resolved=new Set<string>();
 for(let offset=0;offset<census.root_ids.length;offset+=1024){const ids=census.root_ids.slice(offset,offset+1024);
  for(const root of await recorder.context.run({operation:OP.verify,batch:0},()=>census.readResolvedRootIds(ids)))resolved.add(root);}
 void clock;assert.equal(resolved.size,expected.size,'profile resolved root count');
 assert.ok([...resolved].every(root=>expected.has(root)),'profile resolved roots stay within initial roster');return resolved.size;
}

export async function runListeningPipelineProfileV1(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','owned CI only');
 assert.equal(process.env.NOISIA_R16_LISTENING_PIPELINE_PROFILE_PG,'true','explicit diagnostic profile flag required');
 const redisUrl=process.env.R16BENCH_REDIS_URL;assert.ok(redisUrl,'owned loopback Redis is required');
 const redis=new URL(redisUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(redis.hostname));
 const recorder=createProfileRecorder(),jobs:Array<{start_ms:number;end_ms:number;status:string;request_count:number;applied_calls:number}> = [];
 const partialSetup:Record<string,unknown>={native_fixture_started:false};
 let receipt:Record<string,unknown>={contract:'r16-listening-pipeline-profile-v1',status:'inconclusive',diagnostic_only:true,
  h1_accepted:false,cpu:'UNKNOWN',source_sha:process.env.GITHUB_SHA??'UNKNOWN',scope:'consumer_only_after_native_4096_root_base_applied',
  root_count:4096,setup:partialSetup,result:{native_run_completed:false},jobs,events:recorder.snapshot(),
  clock:'monotonic_ms_since_first_worker_invocation_after_fixture_setup',observer_overhead:'included_unsubtracted',
  unknowns:['serialized_response_envelope_bytes','initial_metadata_vs_feed_metadata_vs_http_potential_vs_response_custody_bytes',
   'CPU','causal_wait_or_dominant_stage','base_admission_and_fixture_setup']};
 let primaryError:unknown;
 try{await withFlatPrefixFullFixtureV1({afterSetup:async f=>{
  partialSetup.native_fixture_started=true;
  const roots=f.params[4] as string[];assert.equal(roots.length,4096);assert.equal(new Set(roots).size,4096);
  const initial=await readFlatPrefixSetupStateV1(f.database as unknown as Parameters<typeof readFlatPrefixSetupStateV1>[0],f.params,f.run.id);
  const baseAccess={database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,
   configuration_id:f.configuration_id,map_id:f.map_id,run_id:f.run.id};
  const initialCensus=await loadR16ListeningNativeCensusV1(
   baseAccess as unknown as Parameters<typeof loadR16ListeningNativeCensusV1>[0],4096);
  const censusRoots=new Set(initialCensus.root_ids);
  assert.equal(censusRoots.size,4096);assert.ok(roots.every(root=>censusRoots.has(root)),'profile census matches fixture roster');
  Object.assign(partialSetup,{base_calls:Number(initial.calls),base_answers:Number(initial.base_answers),consumer_pending:Number(initial.consumer_pending),
   initial_distinct_roots:Number(initial.roots),census_roots:initialCensus.root_ids.length,execution:PROFILE_LIMITS});
  assert.equal(initial.calls,4096);assert.equal(initial.applied,4096);assert.equal(initial.roots,4096);
  assert.equal(initial.base_answers,8192);assert.equal(initial.consumer_pending,8192);assert.equal(initial.reserved_micro_usd,'0');
  const origin=performance.now(),clock=()=>performance.now()-origin,deadline=()=>assert.ok(clock()<=PROFILE_BRACKET_MS,'diagnostic consumer bracket exceeded 120 seconds');
  Object.assign(partialSetup,{measurement_started:true,clock_origin:'first_worker_invocation_after_fixture_setup'});
  const database=instrumentDatabase(f.database as unknown as Queryable,recorder,clock);
  const baseStore=createSignalListeningStoreV1({database:database as unknown as FlatPrefixReadyFixtureV1['database'],page_size:PROFILE_LIMITS.window_size,
   rawPages:f.rawPages,assertRawReady:f.assertRawReady,storeRawVerified:true,storeRaw:async()=>{throw Error('native RAW pages required');}});
  const store=instrumentStore(baseStore as unknown as Record<string,unknown>,recorder,clock);
  const execution={...PROFILE_LIMITS};
  const syntheticFetch=createSyntheticJevFetchV1({latencyForRequest:deterministicR16LatencyV1});let physicalRequests=0;
  const measuredFetch:typeof fetch=async(...params)=>{
   const index=physicalRequests++,start=clock(),requestedDelay=deterministicR16LatencyV1(index);
   try{return await syntheticFetch(...params);}finally{recorder.recordHttp(index,start,clock(),requestedDelay);}
  };
  const providerFactory=instrumentProviderFactory({redisUrl,organizationId:initialCensus.organization_id,recorder,clock,fetch:measuredFetch});
  const access={...baseAccess,database:database as unknown as FlatPrefixReadyFixtureV1['database']};
  let completed=false,priorRequests=0,priorApplied=0,invocations=0,lastOutcome='unknown';
  while(!completed){
   deadline();assert.ok(invocations<MAX_JOB_INVOCATIONS,'diagnostic job invocation cap reached');invocations++;
   const start=clock();
   const outcome=await signalListeningJevJobV1(f.run.id,{database:access.database,store:store as never,execution,
    preflight:f.assertRawReady,observe_stream:metrics=>recorder.recordStream(clock(),metrics),
    observe_calibration:event=>recorder.append('calibration',[roundMs(clock()),Number(event.warmup),event.selected_roots,event.max_in_flight]),
    calibrated_provider_factory:providerFactory});
   lastOutcome=typeof outcome.status==='string'?outcome.status:'unknown';
   const requestCount=physicalRequests,applied=recorder.getAppliedCalls();
   jobs.push({start_ms:roundMs(start),end_ms:roundMs(clock()),status:lastOutcome,request_count:requestCount,applied_calls:applied});
   Object.assign(partialSetup,{worker_invocations:invocations,synthetic_http_requests:requestCount,native_apply_calls:applied,last_worker_status:lastOutcome});
   if(lastOutcome==='completed'){
    completed=true;break;
   }
   assert.equal(lastOutcome,'running','native run must remain running between calibration windows');
   if(requestCount===priorRequests&&applied===priorApplied)
    throw Error('r16_pipeline_profile_no_native_progress');
   priorRequests=requestCount;priorApplied=applied;
  }
  deadline();
  const finalStatus=await recorder.context.run({operation:OP.verify,batch:0},()=>getSignalListeningStatusV1(access));
  assert.equal(finalStatus.run?.id,f.run.id);assert.equal(finalStatus.run?.status,'completed');
  assert.equal(finalStatus.run?.reserved_micro_usd,'0');assert.equal(finalStatus.run?.unknown_micro_usd,'0');
  const finalResolved=await countResolved(access,roots,recorder,clock);
  assert.equal(finalResolved,4096,'native consumer census must be complete');
  const ledger=(await recorder.context.run({operation:OP.verify,batch:0},()=>database.query(flatPrefixLedgerSqlV1,[f.run.workspace_id,f.run.id]))).rows[0];
  assert.ok(ledger);assert.equal(Number(ledger.roots),4096);assert.equal(Number(ledger.applied),Number(ledger.calls));
  assert.equal(String(ledger.reserved_micro_usd),'0');assert.equal(String(ledger.unknown_micro_usd),'0');
  assert.equal(Number(ledger.calls)-Number(initial.calls),physicalRequests,'each native call must have one synthetic HTTP attempt');
  const questionKeys=f.configuration.questions.map(question=>question.key);
  const metrics=await recorder.context.run({operation:OP.verify,batch:0},()=>readSignalListeningQuestionsMetricsV1({...access,
   question_keys:questionKeys,configuration_id:f.configuration_id,map_id:f.map_id,granularity:'day'}));
  assert.equal(metrics.length,questionKeys.length);assert.ok(metrics.every(metric=>metric.counts.pending===0&&metric.counts.awaiting_base===0
   &&metric.distribution.length>0&&metric.trend.length>0&&metric.topic_cross.length>0),'native serving metrics must be populated');
  const dropped=recorder.markInconclusive();
  const providerEvents=recorder.events.provider,storeEvents=recorder.events.store;
  const httpEvents=recorder.events.http,httpElapsed=httpEvents.map(row=>row[2]!-row[1]!);
  const unmatchedProvider=providerEvents.filter(row=>row[3]===0).length;
  const unmatchedDurability=storeEvents.filter(row=>(row[2]===OP.persistRawPage||row[2]===OP.settlePage||row[2]===OP.apply)&&row[4]===0).length;
  receipt={...receipt,status:'observed',
   interpretation:dropped||unmatchedProvider||unmatchedDurability?'inconclusive_event_cap_or_incomplete_correlations':'provider_store_query_correlated_http_spans_independent_no_causal_claim',
   source_sha:process.env.GITHUB_SHA??'UNKNOWN',scope:'consumer_only_after_native_4096_root_base_applied',root_count:4096,
   setup:{base_calls:4096,base_answers:8192,consumer_pending:8192,actual_consumer_call_count:Number(ledger.calls)-Number(initial.calls),actual_native_apply_calls:recorder.getAppliedCalls(),actual_synthetic_http_requests:physicalRequests,
    initial_distinct_roots:4096,final_distinct_resolved_roots:finalResolved,execution:PROFILE_LIMITS},
   result:{native_run_completed:true,raw_page_applied_calls:Number(ledger.applied),native_reserved_exposure:String(ledger.reserved_micro_usd),
    native_unknown_exposure:String(ledger.unknown_micro_usd),serving_question_count:metrics.length,serving_populated:true,
    synthetic_http:{observed_count:httpEvents.length,requested_delay_min_ms:Math.min(...httpEvents.map(row=>row[3]!)),
     requested_delay_max_ms:Math.max(...httpEvents.map(row=>row[3]!)),physical_elapsed_min_ms:Math.min(...httpElapsed),
     physical_elapsed_max_ms:Math.max(...httpElapsed),requested_delay_is_not_http_duration:true}},
   correlation:{provider_events_recorded:providerEvents.length,provider_events_unmatched:unmatchedProvider,
    durability_events_recorded:storeEvents.filter(row=>row[2]===OP.persistRawPage||row[2]===OP.settlePage||row[2]===OP.apply).length,
    durability_events_unmatched:unmatchedDurability,provider_store_link:'request_object_identity',http_link:'none_http_index_is_not_a_provider_join'},
   clock:'monotonic_ms_since_first_worker_invocation_after_fixture_setup',observer_overhead:'included_unsubtracted',
   unknowns:['serialized_response_envelope_bytes','initial_metadata_vs_feed_metadata_vs_http_potential_vs_response_custody_bytes',
    'CPU','causal_wait_or_dominant_stage','base_admission_and_fixture_setup'],
   jobs,events:recorder.snapshot()};
 }});}catch(error){primaryError=error;receipt.status='inconclusive';receipt.failure='native_profile_or_cleanup_incomplete';}
 try{
 const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)),process.cwd());
 const configured=process.env.R16_LISTENING_PIPELINE_PROFILE_EVIDENCE_DIR;assert.ok(configured);
 const dir=resolve(root,configured),relativeDir=relative(join(root,'.data'),dir);
 assert.ok(relativeDir&&!relativeDir.startsWith('..')&&!relativeDir.startsWith('/'),'private .data path required');
 await mkdir(dir,{recursive:true,mode:0o700});assert.equal(await realpath(dir),dir);
 const file=join(dir,'listening-pipeline-profile.json');
 let bytes=Buffer.from(JSON.stringify(receipt)+'\n');
 while(bytes.length>MAX_ARTIFACT_BYTES){
  const eventSets=receipt.events as ReturnType<typeof recorder.snapshot>;
  const candidates=(Object.keys(eventSets.events) as Array<keyof typeof eventSets.events>).sort((a,b)=>eventSets.events[b].length-eventSets.events[a].length);
  const target=candidates.find(key=>eventSets.events[key].length>0);if(!target)throw Error('r16_pipeline_profile_artifact_over_2mib');
  eventSets.events[target].pop();eventSets.event_counts[target].recorded--;eventSets.event_counts[target].dropped++;
  bytes=Buffer.from(JSON.stringify(receipt)+'\n');
 }
 const finalEvents=receipt.events as ReturnType<typeof recorder.snapshot>;
 const finalProvider=finalEvents.events.provider,finalStore=finalEvents.events.store;
 const finalUnmatchedProvider=finalProvider.filter(row=>row[3]===0).length;
 const finalDurability=finalStore.filter(row=>row[2]===OP.persistRawPage||row[2]===OP.settlePage||row[2]===OP.apply);
 const finalUnmatchedDurability=finalDurability.filter(row=>row[4]===0).length;
 receipt.correlation={provider_events_recorded:finalProvider.length,provider_events_unmatched:finalUnmatchedProvider,
  durability_events_recorded:finalDurability.length,durability_events_unmatched:finalUnmatchedDurability};
 if(Object.values(finalEvents.event_counts).some(row=>row.dropped>0)||finalUnmatchedProvider||finalUnmatchedDurability)
  receipt.interpretation='inconclusive_event_cap_artifact_size_or_incomplete_correlations';
 bytes=Buffer.from(JSON.stringify(receipt)+'\n');
 assert.ok(bytes.length<=MAX_ARTIFACT_BYTES,'r16_pipeline_profile_artifact_over_2mib');
 const handle=await open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 }catch(publicationError){if(primaryError)throw new AggregateError([primaryError,publicationError],
   'r16_pipeline_profile_execution_and_receipt_publication_failed',{cause:primaryError});throw publicationError;}
 if(primaryError)throw primaryError;
 assert.equal(receipt.status,'observed','native profile must complete all required semantic checks');
 return receipt;
}

export const R16_LISTENING_PIPELINE_PROFILE_TIMEOUT_MS=PROFILE_TEST_MS;
