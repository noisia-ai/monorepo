import {
  nativeListeningAdmissionWorkspaceBoundV1,createNativeListeningAdmissionWorkspaceQuoteV1,signalListeningInputSurveyStorageBoundV1,createSignalListeningStoreV1,signalWorkspaceFeatureEnabledV1,loadSignalListeningCalibrationV1,deriveSignalListeningCalibrationV1,
  pendingSignalListeningPreparationsV1,continueSignalListeningPreparationV1,LABELING_INPUT_MAX_WORKING_BYTES_V1,type LabelingRunV1,
} from '@noisia/db';
import {
  buildSignalListeningCompiledRequestV1,mapSignalListeningCompiledResponseV1,signalListeningRequestDigestV1,
  compileSignalListeningSnapshotV1,readSignalListeningSnapshotV1,createSignalListeningShapeCompilerV1,type SignalListeningCompiledSnapshotV1,labelerDigestV1,llmPriceV1,llmCostMicroUsdV1,
  signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningInputV1,type SignalListeningResultV1,
} from '@noisia/query-engine';
import {assertMassJevConsumerV1} from '../providers/mass-labeling-consumer';
import {createCalibratedJevRuntimeProviderV2,jevStreamingExecutionFromEnvV2} from '../providers/jev-streaming-runtime';
import {JevProviderErrorV1,type JevProviderV1} from '../providers/typesafe-jev';
import {processJevLabelingPageV1,jevUsageV1,type JevPreparedExecutionV1,type JevNextInputBoundsV2,type JevNextInputReadV3} from './signal-jev-labeling-page';
import {createLabelingRawPagesStorageV1} from './signal-labeling-receipt-storage';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import {assertJevStreamingExecutionV2,jevCallWorkingBytesV2,type JevStreamingExecutionV2,type JevStreamingMetricsV2,type JevFeedAdmissionHintV1} from './signal-jev-streaming-window';

import {listeningHasRawV1,selectSignalListeningRecoveryV1,createSignalListeningRecoveryProviderV1} from './signal-listening-recovery';
import {planSignalListeningCalibrationV1,createSignalListeningCalibratedProviderV1,createSignalListeningContinuationV1,type SignalListeningCalibrationEventV1} from './signal-listening-calibration';

// Stream response custody and one native input read have independent budgets.
// Invalid numbers remain invalid for the existing native validator.
const readBounds=<T extends{max_working_bytes:number}>(bounds:T):T=>({...bounds,max_working_bytes:
 Number.isSafeInteger(bounds.max_working_bytes)?Math.min(bounds.max_working_bytes,LABELING_INPUT_MAX_WORKING_BYTES_V1):bounds.max_working_bytes});
type Store=ReturnType<typeof createSignalListeningStoreV1>;
/** A private immutable copy of the claimed run's configuration, never a memo
 * of permissions. Every reserve/submit/write still uses the native fresh guards. */
function compileRun(run:LabelingRunV1,supplied?:SignalListeningCompiledSnapshotV1){
  const snapshot=supplied??compileSignalListeningSnapshotV1(run.identity.params.configuration),state=readSignalListeningSnapshotV1(snapshot);
  if(run.kind!=='mass_labeling'||labelerDigestV1(run.identity)!==state.identity_digest)throw Error('listening_identity_invalid');
  const binding=[run.id,run.workspace_id,run.actor_user_id,run.labeler_digest,run.entity_context_digest,run.entity_context_version_no,run.lease_token,run.identity.params.configuration_digest,run.identity.model] as const;
  const price=llmPriceV1('typesafe',state.identity.model,'sync',Number(state.identity.params.input_usd_per_mtok));
  return Object.freeze({...state,snapshot,price,shapes:createSignalListeningShapeCompilerV1(snapshot),assert(run:LabelingRunV1){
    const actual=[run.id,run.workspace_id,run.actor_user_id,run.labeler_digest,run.entity_context_digest,run.entity_context_version_no,run.lease_token,run.identity.params.configuration_digest,run.identity.model];
    if(actual.some((value,i)=>value!==binding[i]))throw Error('listening_identity_invalid');
  }});
}
/** Page-local intersection only: this index never grants authority or supplies
 * cached inputs. It returns the last matching supplied input in selection order. */
export function createSignalListeningSelectionIndexV1(key:(input:SignalListeningInputV1)=>string){
  let page:SignalListeningInputV1[]|undefined,positions=new Map<string,number[]>();
  return{invalidate(){page=undefined;positions=new Map();},
    select(inputs:SignalListeningInputV1[],selection:SignalListeningInputV1[]|undefined,limit:number){
      if(!selection){page=undefined;positions=new Map();return inputs.slice(0,limit);}
      if(page!==selection){
        positions=new Map();selection.forEach((input,index)=>{const id=key(input),found=positions.get(id);if(found)found.push(index);else positions.set(id,[index]);});page=selection;
      }
      // feed_next calls propose with one input at a time. Do not walk or hash
      // the complete selected page again for each singleton.
      if(inputs.length===1){const input=inputs[0]!,found=positions.get(key(input));return found?Array.from({length:Math.min(found.length,limit)},()=>input):[];}
      const available=new Map(inputs.map(input=>[key(input),input]));
      const matches:Array<{index:number;input:SignalListeningInputV1}>=[];
      for(const [id,input]of available)for(const index of positions.get(id)??[])matches.push({index,input});
      return matches.sort((a,b)=>a.index-b.index).slice(0,limit).map(row=>row.input);
    }};
}
/** The DB adapter selects only eligible missing question digests. This transport
 * never invents questions, negative labels, eligibility or a second provider attempt. */
export function processSignalListeningJevV1(args:{run_id:string;store:Store;provider:JevProviderV1;
  execution:JevStreamingExecutionV2;lease_renewal_ms?:number;recovery_only?:boolean;
  observe_stream?:(metrics:JevStreamingMetricsV2)=>void;
  prepare?(run:Readonly<LabelingRunV1>):Promise<JevPreparedExecutionV1>;
  selection?:()=>SignalListeningInputV1[]|undefined;
  /** Transfer selection ownership after proposals/reservation, not authorization. */
  release_selection?:()=>void;
  read_next_inputs?(run:LabelingRunV1,bounds:JevNextInputBoundsV2,admission_signal:AbortSignal):Promise<JevNextInputReadV3<SignalListeningInputV1>>;
  prepare_next?(run:LabelingRunV1,inputs:SignalListeningInputV1[]):Promise<boolean|'wait_for_apply'>;
  preparation_valid?:()=>boolean;
  minimum_next_calls?:()=>number;
  next_admission_hint?:()=>JevFeedAdmissionHintV1;
  acknowledge_covered?(generation:number,ids:ReadonlyArray<string>):void;
  compiled_snapshot?:()=>SignalListeningCompiledSnapshotV1|undefined}){
  let preparedExecution=args.execution,preparedProvider=args.provider;
  let windowSize=args.execution.window_size,compiledRun:ReturnType<typeof compileRun>|undefined;
  const contextOf=(run:LabelingRunV1)=>{compiledRun??=compileRun(run,args.compiled_snapshot?.());compiledRun.assert(run);return compiledRun;};
  const key=(input:SignalListeningInputV1)=>digest({root_id:input.root_id,input_digest:input.input_digest,question_digests:input.question_digests});
  const selectionIndex=createSignalListeningSelectionIndexV1(key);
  const select=(inputs:SignalListeningInputV1[])=>selectionIndex.select(inputs,args.selection?.(),windowSize);
  const schedulerStore={...args.store,async inputs(run:LabelingRunV1,bounds?:Parameters<Store['inputs']>[1]){
    const selection=args.selection?.();
    if(!selection)return args.store.inputs(run,bounds?readBounds(bounds):bounds);
    // The lease-held planner already hydrated a bounded server selection. Its
    // extrema may lie outside a warmup-sized prefix; never reread that prefix
    // and silently discard the anchors. Reserve still validates native rights.
    const budget=Math.min(bounds?.max_working_bytes??Infinity,
      preparedExecution.max_buffered_bytes-assertJevStreamingExecutionV2(preparedExecution,preparedProvider));
    if(selection.length>Math.min(windowSize,bounds?.max_rows??Infinity))throw Error('listening_selection_memory_bound');
    let bytes=0;
    for(const input of selection){
      bytes+=jevCallWorkingBytesV2({request:buildSignalListeningCompiledRequestV1(input,contextOf(run).snapshot),inputs:[input]})+8192;
      if(bytes>budget)throw Error('listening_selection_memory_bound');
    }
    return selection;
  },async calls(run:LabelingRunV1){
    const rows=await args.store.calls(run),selection=args.selection?.();if(!selection)return rows;
    const order=new Map(selection.map((input,index)=>[key(input),index]));
    // Unknown physical attempts always remain visible to the shared money guard.
    return rows.filter(call=>listeningHasRawV1(call)||call.status==='unknown'||call.inputs.some(input=>order.has(key(input))))
      .sort((a,b)=>Number(Boolean(b.raw_body))-Number(Boolean(a.raw_body))||(a.inputs[0]?order.get(key(a.inputs[0]))??-1:-1)-(b.inputs[0]?order.get(key(b.inputs[0]))??-1:-1));
  }};
  return processJevLabelingPageV1<SignalListeningInputV1,SignalListeningResultV1>({...args,store:schedulerStore,
    initial_reservation:args.release_selection?{max_calls:1024,release_selection:()=>{selectionIndex.invalidate();args.release_selection!();}}:undefined,
    // Subsequent windows must read fresh native pending identities, never the
    // retained initial calibration selection.
    read_next_inputs:(run,bounds,signal)=>args.read_next_inputs?args.read_next_inputs(run,readBounds(bounds),signal):args.store.inputs(run,readBounds({...bounds,on_oversize:'empty' as const})),
    prepare:args.prepare?async run=>{compiledRun=undefined;try{const prepared=await args.prepare!(run);preparedExecution=prepared.execution;preparedProvider=prepared.provider;windowSize=prepared.execution.window_size;return prepared;}finally{selectionIndex.invalidate();}}:undefined,hooks:{
    native_admission:args.store.admitAndMarkSelected?{
      workspace_bound:(run,proposals)=>nativeListeningAdmissionWorkspaceBoundV1(run,proposals),
      workspace_quote:(run,proposals)=>createNativeListeningAdmissionWorkspaceQuoteV1(run,proposals),
      committed:(hint,ids)=>{if(hint?.kind==='bootstrap')args.acknowledge_covered?.(hint.bootstrap_id,ids);},
    }:undefined,
    preparation_valid:args.preparation_valid,
    revisit_empty_after_apply:true,price:run=>contextOf(run).price,next_admission_hint:args.next_admission_hint,
    prepare_next:args.prepare_next?async(run,inputs)=>{try{return await args.prepare_next!(run,inputs);}finally{selectionIndex.invalidate();}}:undefined,
    select_next_inputs:args.minimum_next_calls?inputs=>({inputs:args.selection?.()??inputs,minimum_calls:args.minimum_next_calls!()}):undefined,
    propose:(run,inputs)=>select(inputs).map(input=>{
      const request=buildSignalListeningCompiledRequestV1(input,contextOf(run).snapshot);
      const request_digest=signalListeningRequestDigestV1(run,input,request);
      return {custom_id:`listening_${request_digest.slice(7,67)}`,request_digest,request,inputs:[input],
        reserved_micro_usd:llmCostMicroUsdV1(jevUsageV1({input_tokens:Buffer.byteLength(JSON.stringify(request))*4+8192,output_tokens:0}),contextOf(run).price)};
    }),
    map:(run,call,raw)=>{
      if(call.inputs.length!==1)throw Error('listening_input_invalid');
      return [mapSignalListeningCompiledResponseV1(call.inputs[0]!,run.context,contextOf(run).snapshot,raw)];
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
  /** Instrumentation sees copied scalar metadata, never the mutable plan. */
  observe_stream?:(metrics:JevStreamingMetricsV2)=>void;
  observe_calibration?:(event:SignalListeningCalibrationEventV1)=>void;
  calibrated_provider_factory?:typeof createCalibratedJevRuntimeProviderV2;
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
  let jobContext:ReturnType<typeof compileRun>|undefined;
  let calibrated:ReturnType<typeof createSignalListeningCalibratedProviderV1>|undefined,recoveryProvider:JevProviderV1|undefined;
  let continuation:Awaited<ReturnType<typeof createSignalListeningContinuationV1>>|undefined;
  let metadata:Awaited<ReturnType<Store['calls']>>|undefined,recovery:ReturnType<typeof selectSignalListeningRecoveryV1>,hydrated:Awaited<ReturnType<Store['calls']>>|undefined;
  let calibrationRun:Readonly<LabelingRunV1>|undefined,shapes:string[]=[],selection:SignalListeningInputV1[]|undefined,preparedSelectionEpoch:number|undefined,metadataPrepared=false,preparationSignal:AbortSignal|undefined;
  // This placeholder cannot send; the lease-held planner always selects runtime.
  const unavailable:JevProviderV1={async evaluate(){throw new JevProviderErrorV1('listening_preparation_required','definitely_not_sent');}};
  // Prepare inspects metadata only. The shared worker then loads exactly one
  // bounded raw selection once; no second full-page read and no hidden unknown.
  const boundedStore={...store,
    async reserve(...params:Parameters<Store['reserve']>){const calls=await store.reserve(...params);continuation?.reserved(calls);return calls;},
    async apply(...params:Parameters<Store['apply']>){await store.apply(...params);await continuation?.applied(params[1]);},
    async calls(leased:LabelingRunV1){
    if(recovery){
      const loaded=await store.calls(leased,{call_ids:recovery.calls.map(call=>call.id)});
      // Routine measured recovery must not replace a wide ledger profile with
      // its latest32 narrow receipts. Only interrupted official warmup windows
      // need derivation; the DB still validates settled/applied evidence later.
      shapes=[...new Set(loaded.filter(call=>{
        if(!call.raw_body)return false;
        try{return JSON.parse(call.raw_body).rate_calibration?.kind==='official_context_bound';}catch{return false;}
      }).flatMap(call=>call.inputs).map(input=>jobContext!.shapes.shape(input).shape_digest))];
      return [...loaded,...(metadata??[]).filter(call=>call.status==='unknown'&&!listeningHasRawV1(call)&&!loaded.some(row=>row.id===call.id))];
    }
    return hydrated??metadata??await store.calls(leased,{metadata_only:true});
  }};
  try{
    const outcome=await processSignalListeningJevV1({run_id,execution,observe_stream:options.observe_stream,store:boundedStore,provider:unavailable,recovery_only:run.recovery_only,selection:()=>selection,compiled_snapshot:()=>jobContext?.snapshot,
      release_selection:()=>{selection=undefined;},
      minimum_next_calls:()=>continuation?.minimumNextCalls()??0,
      next_admission_hint:()=>continuation?.nextAdmissionHint()??{kind:'open'},
      acknowledge_covered:(generation,ids)=>continuation?.acknowledgeCoveredReservation(generation,ids),
      preparation_valid:()=>preparedSelectionEpoch===undefined||continuation?.preparationValid(preparedSelectionEpoch)===true,
      read_next_inputs:async(leased,bounds,admissionSignal)=>{
        preparationSignal=admissionSignal;
        if(!continuation||!jobContext||typeof store.withInputSurvey!=='function')return store.inputs(leased,readBounds({...bounds,on_oversize:'empty' as const}));
        jobContext.assert(leased);
        const prepared=await continuation.selectNextSurvey({available_bytes:bounds.max_working_bytes,max_calls:bounds.max_rows,
          storage_bound:signalListeningInputSurveyStorageBoundV1(leased,execution.window_size),signal:admissionSignal,
          read:(budget,body)=>store.withInputSurvey(leased,readBounds(budget),body)});
        if(prepared.fallback_legacy){
          // Metadata is an optional acceleration. Preserve the ORIGINAL bounded
          //4096-row reader/domain when its extra custody cannot fit; no reduced
          // survey, indefinite wait or fabricated global-empty result.
          metadataPrepared=false;preparedSelectionEpoch=undefined;
          return store.inputs(leased,readBounds({...bounds,on_oversize:'empty' as const}));
        }
        selection=prepared.selected;prepared.selected=[];preparedSelectionEpoch=prepared.preparation_epoch;metadataPrepared=prepared.decision===true;
        return{inputs:selection,byte_limited:prepared.byte_limited,...(prepared.admission_deferred||prepared.decision==='wait_for_apply'?{admission_deferred:true as const}:{})};
      },
      prepare_next:async(_leased,inputs)=>{
        if(!jobContext)throw Error('listening_identity_invalid');jobContext.assert(_leased);
        const {snapshot,configuration,configuration_digest}=jobContext,next=inputs.slice(0,execution.window_size);
        if(metadataPrepared){metadataPrepared=false;return preparedSelectionEpoch!==undefined&&continuation?.preparationValid(preparedSelectionEpoch)===true?true:'wait_for_apply';}
        if(continuation){const epoch=continuation.preparationEpoch(),prepared=await continuation.selectNext(next,preparationSignal);selection=prepared.selected;preparedSelectionEpoch=epoch;return prepared.decision;}
        function* requests(){for(const input of next)yield buildSignalListeningCompiledRequestV1(input,snapshot);}
        if(!calibrated||!await calibrated.prepareMeasuredRequestsWithProfiles(requests(),shape_digest=>(options.calibration?.load??loadSignalListeningCalibrationV1)({database,
          workspace_id:_leased.workspace_id,actor_user_id:_leased.actor_user_id,configuration_digest,model:configuration.model,shape_digest})))return false;
        selection=next;return true;
      },
      prepare:async leased=>{
        calibrationRun=leased;
        try{
          jobContext=compileRun(leased);const {configuration,snapshot,configuration_digest}=jobContext,pending=metadata=await store.calls(leased,{metadata_only:true});
          recovery=selectSignalListeningRecoveryV1(pending,execution);
          if(recovery){
            selection=[];shapes=[];
            recoveryProvider=createSignalListeningRecoveryProviderV1({execution:recovery.execution,external:options.provider,factory:options.calibrated_provider_factory});
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
          const inputs=pending.length?(hydrated??pending).filter(call=>!call.results_applied&&(!run.recovery_only||Boolean(call.raw_body))).flatMap(call=>call.inputs):await store.inputs(leased,readBounds({max_rows:execution.window_size,max_working_bytes:execution.max_buffered_bytes,on_oversize:'error' as const}));
          const plan=await planSignalListeningCalibrationV1({workspace_id:leased.workspace_id,configuration_digest,
            configuration,snapshot,inputs,execution,loadProfile:shape_digest=>(options.calibration?.load??loadSignalListeningCalibrationV1)({database,
              workspace_id:leased.workspace_id,actor_user_id:leased.actor_user_id,configuration_digest,model:configuration.model,shape_digest})});
          if(!pending.length){
            continuation=await createSignalListeningContinuationV1({run_id:leased.id,initial_plan:plan,initial_inputs:inputs,execution,
              loadProfile:shape_digest=>(options.calibration?.load??loadSignalListeningCalibrationV1)({database,workspace_id:leased.workspace_id,
                actor_user_id:leased.actor_user_id,configuration_digest,model:configuration.model,shape_digest}),
              deriveProfile:shape_digest=>(options.calibration?.derive??deriveSignalListeningCalibrationV1)({database,workspace_id:leased.workspace_id,
                actor_user_id:leased.actor_user_id,run_id:leased.id,shape_digest}),
              ...(options.calibrated_provider_factory?{factory:options.calibrated_provider_factory}:{}),
              ...(options.provider?{factory:()=>({...options.provider!,close:undefined})}:{}),observe:options.observe_calibration});
            selection=continuation.takeInitialSelection();calibrated=continuation.runtime;shapes=[];
            return{provider:calibrated.provider,execution:continuation.execution,continuous_windows:true,
              ...(continuation.bootstrap_initial_calls?{bootstrap_initial_calls:continuation.bootstrap_initial_calls}:{})};
          }
          // Existing reservations/recovery retain the bounded original pass.
          // A later ordinary job enters continuous admission only after drain.
          selection=plan.selected_inputs;shapes=plan.calibration_shapes;
          try{options.observe_calibration?.({warmup:plan.warmup,selected_roots:plan.selected_inputs.length,
            max_in_flight:plan.execution.max_in_flight,shape_digests:[...plan.calibration_shapes]});}catch{/* Observation cannot change execution. */}
          calibrated=createSignalListeningCalibratedProviderV1({plan,...(options.calibrated_provider_factory?{factory:options.calibrated_provider_factory}:{}),...(options.provider?{factory:()=>({...options.provider!,close:undefined})}:{})});
          calibrated.prepareRequests(selection.map(input=>buildSignalListeningCompiledRequestV1(input,snapshot)));
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
    const failure=continuation?.failure();if(failure?.failed)throw failure.error;
    return outcome;
  }finally{
    continuation?.closeObservation();
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
