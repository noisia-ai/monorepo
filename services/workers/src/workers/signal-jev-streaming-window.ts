import type{SignalListeningPreparationObservationV1,SignalListeningNativeSelectorObservationV1}from'./signal-listening-preparation-observation';
import {createJevListeningMetadataScopeV3,isJevListeningMetadataBindingV3} from './signal-jev-listening-metadata-v3';
import {selectJevPhaseInitialBindingV3} from './signal-jev-phase-profile-v3';
import type { FacetInput, LlmPriceV1 } from '@noisia/query-engine';
import {captureJevDeferredRawV1,packJevDeferredRawV3,materializeJevDeferredRawV1,type JevDeferredPacketV3,type JevPackedRawV3} from '../providers/jev-deferred-raw';
import {tryCreateJevPhaseBudgetOwnerV3,resolveJevPhaseClosedBindingV3,type JevPhaseClosedBindingV3,type JevPhaseCaptureLeaseV3,type JevPhaseCallQuoteV3,type JevPhaseSnapshotV3} from './signal-jev-response-budget-v3';
import {jevDeferredRetainedBytesV3,jevListeningPhaseFlushBytesV3,jevLegacyPhaseFlushBytesV3,jevLegacyPhaseMaximumFlushBytesV3,jevPhaseQuestionSlotsV3} from './signal-jev-phase-geometry-v3';
import { llmCostMicroUsdV1 } from '@noisia/query-engine';
import type { createSignalLabelingStoreV1, LabelingRunV1, LabelingCallV1, LabelingCallProposalV1, LabelingAdmissionSelectionV1, LabelingAdmissionResultV1 } from '@noisia/db';
import { validateJevResponseV1, jevProviderErrorV1, isJevPreFetchCancellationV1, type JevProviderV1, type JevRawResponseV1,
  type JevResponseV1, type JevRequestV1, type JevProviderErrorV1 } from '../providers/typesafe-jev';
const jevUsageV1 = (usage:JevResponseV1['usage']) => ({...usage,cache_read_input_tokens:0,
  cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
export type JevStreamingExecutionV2 = {
  max_in_flight: number; flush_size: number; max_flushes: number;
  max_buffered_bytes: number; flush_interval_ms: number; window_size: number;
};
export type JevStreamingMetricsV2 = { in_flight: number; reserved_working_bytes: number;
  buffered_responses: number; active_flushes: number; prefetch_canceled_requests?:number;admission_closed?:boolean;response_phase?:JevPhaseSnapshotV3;
  response_metadata_native_rows?:number;response_metadata_legacy_received_rows?:number;response_metadata_legacy_terminal_rows?:number };
/** Private scheduling metadata. It never supplies inputs or grants authority. */
export type JevFeedAdmissionHintV1 = {kind:'open'}|{kind:'closed'}|{
  kind:'bootstrap';bootstrap_id:number;covered_call_limit:number;wait_for_apply:boolean;acknowledged_covered_calls?:number;
};
/** Only trusted native Listening constructors return uncommitted drafts.
 * Proposal custody and the native transaction workspace coexist with returned
 * call custody; none substitutes for the paid-response allowance. */
export type JevNativeWorkspaceQuoteV1={readonly length:number;readonly retained_bytes:number;quote(prefixLength:number):number};
export type JevNativeAdmissionDraftV1<I extends FacetInput>={
  proposals:LabelingCallProposalV1<I>[];workspace_bytes:number;byte_limited:boolean;
  /** Pure immutable prefix snapshot; no request bodies or authority are cached. */
  workspace_quote?:JevNativeWorkspaceQuoteV1;
  /** One separately charged numeric prefix; avoids allocation at final fit. */
  call_working_prefix?:ReadonlyArray<number>;
  on_committed?(call_ids:ReadonlyArray<string>,proposals:ReadonlyArray<LabelingCallProposalV1<I>>):void;
};
export type JevFeedResultV1<I extends FacetInput>=LabelingCallV1<I>[]|{
  calls:LabelingCallV1<I>[];byte_limited:boolean;admission_deferred?:true;
}|{closed:true}|JevNativeAdmissionDraftV1<I>;
export function assertJevStreamingExecutionV2(e:JevStreamingExecutionV2,provider:JevProviderV1){
  for (const value of Object.values(e)) if (!Number.isSafeInteger(value) || value < 1) throw Error('jev_stream_configuration_invalid');
  if (e.max_in_flight > 4096 || e.max_flushes > 64 || e.flush_size > 4096 || e.window_size > 4096
    || e.flush_interval_ms > 60_000) throw Error('jev_stream_configuration_invalid');
  const responseBound = provider.max_response_bytes ?? 2 * 1024 * 1024;
  if(!Number.isSafeInteger(responseBound)||responseBound<1||responseBound>2*1024*1024)throw Error('jev_stream_response_bound_invalid');
  // JSON escaping, base64 page codec and temporary serialization copies are budgeted.
  const reservationBytes = responseBound * 24 + 64 * 1024;
  if (e.max_buffered_bytes < reservationBytes) throw Error('jev_stream_memory_budget_invalid');
  return reservationBytes;
}
/** Conservative retained request/input copies, distinct from response custody. */
export function jevCallWorkingBytesV2(call:Pick<LabelingCallV1<FacetInput>,'request'|'inputs'>){
  return Buffer.byteLength(JSON.stringify({request:call.request,inputs:call.inputs}))*4+8192;
}
/** One reserved window, continuous HTTP producers and independently bounded durable flushes.
 * The caller owns the lease and heartbeat. A response does not release its buffer until
 * its page is durable, billed and applied. No provider request is retried here. */
export async function processJevStreamingWindowV2<I extends FacetInput, R>(args: {
  run: LabelingRunV1; calls: LabelingCallV1<I>[]; send_calls?:LabelingCallV1<I>[];
  response_budget_binding?:JevPhaseClosedBindingV3;
  store: ReturnType<typeof createSignalLabelingStoreV1<I, R>> & {
    /** Native adapters select only after their fresh authority fences, and
     * return the exact cohort after its submitting transaction commits. */
    admitAndMarkSelected?(run:LabelingRunV1,proposals:LabelingCallProposalV1<I>[],
      callbacks:LabelingAdmissionSelectionV1<I>):Promise<LabelingAdmissionResultV1<I>>;
    markSubmittingSelected?(run:LabelingRunV1,
      selectCommitted:()=>ReadonlyArray<LabelingCallV1<I>>):Promise<ReadonlyArray<LabelingCallV1<I>>>;
  }; provider: JevProviderV1;
  execution: JevStreamingExecutionV2; price: LlmPriceV1; cancellation: AbortController;
  observe_stream?(metrics: JevStreamingMetricsV2): void;
  observe_preparation?(event:SignalListeningPreparationObservationV1):void;
  /** First-party adapters only: inputs exclude every already reserved identity.
   * Returns at most one window, already budgeted before money reservation. */
  feed_next?(available_bytes:number,max_calls:number,admission_signal:AbortSignal):Promise<JevFeedResultV1<I>>;
  next_admission_hint?():JevFeedAdmissionHintV1;
  /** Snapshot/profile revision check before DML only; no post-ACK gate. */
  preparation_valid?():boolean;
  /** Listening native pending eligibility can advance only after durable apply. */
  revisit_empty_after_apply?:boolean;
  /** Scheduling only: evaluate handoff is not proof of physical fetch/rate admission. */
  defer_initial_prefetch_until_handoff?:boolean;
  hooks: { map(run: LabelingRunV1, call: LabelingCallV1<I>, raw: JevResponseV1): R[];
    error(run: LabelingRunV1, call: LabelingCallV1<I>, code: string, unknown: boolean): R[];
    labeled(result: R): boolean; invalidUsage?(failure: JevProviderErrorV1): JevResponseV1['usage'] | undefined;
    fail_on_error?: boolean };
}) {
  const { run, calls, store, provider, execution: e, hooks, price, cancellation } = args;
  const reservationBytes=assertJevStreamingExecutionV2(e,provider);
  const workers = Math.min(args.feed_next?e.max_in_flight:calls.length, e.max_in_flight, provider.max_concurrency ?? e.max_in_flight,
    Math.floor(e.max_buffered_bytes / reservationBytes));
  type Row = { call: LabelingCallV1<I>; raw: string; bytes: number; memory_bytes: number; deferred?:JevDeferredPacketV3; phase_lease?:JevPhaseCaptureLeaseV3;metadata_reduced?:boolean };
  let buffered: Row[] = [], bufferedBytes = 0,
    memory = calls.reduce((n, call) => n + Buffer.byteLength(call.raw_body ?? '')+jevCallWorkingBytesV2(call), 0),
    inFlight = 0, fatal: unknown,fatalKnown=false;
  const phaseArgs={binding:selectJevPhaseInitialBindingV3(args.response_budget_binding,provider,e,hooks.map,calls,memory),provider_owner:provider,mapper_owner:hooks.map,
    recovery_only:calls.some(call=>Boolean(call.raw_body))};
  const resolvedPhase=resolveJevPhaseClosedBindingV3(phaseArgs);
  const phaseProfile=resolvedPhase?.capture_mode==='legacy_capture'?resolvedPhase:null;
  const phase=phaseProfile?tryCreateJevPhaseBudgetOwnerV3({...phaseArgs,shared:{limit:e.max_buffered_bytes,used:()=>memory,
    tryClaim:bytes=>{if(bytes>e.max_buffered_bytes-memory)return false;memory+=bytes;return true;},release:bytes=>{memory-=bytes;}}}):null;
  if(phaseProfile&&!phase)throw Error('jev_phase_initial_memory_bound');
  // The scope is allocated only AFTER the owner prepaid all fixed/row slots.
  // Identity is separate from the generic V3 representation/resource binding.
  // One <=1024-row APPLY batch means at most five SQL frames. Wider or
  // non-H1 execution profiles retain the original per-row metadata allowance.
  const metadata=phase&&e.flush_size<=1024&&e.max_flushes<=2&&e.max_in_flight<=1024
    &&e.window_size<=4096&&e.max_buffered_bytes<=512*1024*1024&&isJevListeningMetadataBindingV3(args.response_budget_binding,provider,hooks.map,store)
    ?createJevListeningMetadataScopeV3(run):undefined;
  let metadataNativeRows=0,metadataLegacyReceivedRows=0,metadataLegacyTerminalRows=0;
  const phaseQuotes=new WeakMap<object,JevPhaseCallQuoteV3>();
  const quoteCall=(call:Pick<LabelingCallV1<I>,'request'|'inputs'>)=>{
    let quote=phaseQuotes.get(call);if(quote)return quote;
    const questions=jevPhaseQuestionSlotsV3(call);
    quote=phase!.quoteCall({capture_bytes:reservationBytes,retained_bound_bytes:reservationBytes,
      max_raw_wrapper_bytes:reservationBytes,max_row_flush_bytes:jevLegacyPhaseMaximumFlushBytesV3(provider.max_response_bytes!,reservationBytes,questions)});
    phaseQuotes.set(call,quote);return quote;
  };
  const responseCost=(list:ReadonlyArray<Pick<LabelingCallV1<I>,'request'|'inputs'>>,count:number,external=0)=>{
    if(!phase)return count*reservationBytes;
    const quotes=list.slice(0,count).map(quoteCall),quote=phase.quotePrefix(quotes,count,external);
    return quote.count===count?quote.required_bytes:Infinity;
  };
  const reserveResponses=(list:ReadonlyArray<LabelingCallV1<I>>,count:number)=>phase?.reservePrefix(list.slice(0,count).map(quoteCall),count)??null;
  const quarantined:Array<{lease:JevPhaseCaptureLeaseV3;packet:JevPackedRawV3}>=[],errorCalls:LabelingCallV1<I>[]=[];
  const reconcilePhase=()=>{
    if(!phase||phase.snapshot().closed)return;
    const leases=quarantined.map(row=>row.lease);quarantined.length=0;phase.reconcileQuarantined(leases);
    // Opaque primary errors escape by identity. Their F/call aliases still
    // belong to the exceptional job egress; never report a false closed owner.
    if(!phase.snapshot().error_retained_bytes)phase.close();observe();wake();
  };
  const admission=new AbortController();
  let totalRoots=calls.length,feedClosed=!args.feed_next,feeding:Promise<void>|undefined;
  // A scheduling hint from the exact bounded prefix, never retained inputs or
  // permission to reserve. A later read still obtains a fresh native snapshot.
  let byteLimitedAvailable:number|undefined;
  let draft:JevNativeAdmissionDraftV1<I>|undefined,draftBytes=0,notificationFailure:unknown,notificationFailureKnown=false;
  let durableEpoch=0,emptyAtEpoch:number|undefined;
  const roster=new Map(calls.map(call=>[call.id,call])),initialIds=new Set(calls.map(call=>call.id));
  let recentIdentities=new Set(calls.map(call=>call.request_digest));
  let totalCost = 0, labeled = 0; const latencies: number[] = [];
  const errors = new Map<string, { call: LabelingCallV1<I>; unknown: boolean; code: string; write_result: boolean }>();
  const applied = new Set<string>(), observedRaw = new Set(calls.filter(c => Boolean(c.raw_body)).map(c => c.id));
  const active = new Set<Promise<void>>(); const waiters = new Set<() => void>();
  const preparation=(event:SignalListeningPreparationObservationV1)=>{try{args.observe_preparation?.(event);}catch{/* Diagnostics cannot replace a Native result or its original failure. */}};
  const observe = () => {
    // Instrumentation never changes physical attempts or their financial outcome.
    try { args.observe_stream?.({ in_flight: inFlight, reserved_working_bytes: memory,
      buffered_responses: buffered.length, active_flushes: active.size,prefetch_canceled_requests:prefetchCanceled.length,admission_closed:admission.signal.aborted,...(phase?{response_phase:phase.snapshot(),response_metadata_native_rows:metadataNativeRows,
        response_metadata_legacy_received_rows:metadataLegacyReceivedRows,response_metadata_legacy_terminal_rows:metadataLegacyTerminalRows}:{}) }); } catch { /* Observer only. */ }
  };
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const wait = () => new Promise<void>(resolve => { waiters.add(resolve); });
  const release = (bytes: number) => { memory -= bytes; observe(); wake(); };
  const fail = (error: unknown) => { if(!fatalKnown){fatalKnown=true;fatal=error;} cancellation.abort(); wake(); };
  const record = (call: LabelingCallV1<I>, unknown: boolean, code: string, write_result = true) => {
    errors.set(call.id, { call, unknown, code, write_result });
    if(hooks.fail_on_error&&write_result){
      // Semantic failure closes admission, not the in-flight HTTP transport.
      // Already handed-off siblings must still drain their physical receipts.
      feedClosed=true;admission.abort();observe();wake();
    }
  };
  async function consume(rows: Row[], alreadyDurable = false) {
    let failed=false,retainError=false;
    try {
      // Every row still owns its unchanged legacy codec/copy allowance through
      // this await. Build exact RAW only after flush selected its bounded prefix.
      for(const row of rows)if(row.deferred){row.raw=materializeJevDeferredRawV1(row.deferred);if(!row.phase_lease)row.deferred=undefined;}
      if (!alreadyDurable) await store.persistRawPage(run, rows.map(({ call, raw }) => ({ call, raw })));
      const results: Array<{ call: LabelingCallV1<I>; results: R[] }> = [];
      const settled: Parameters<typeof store.settlePage>[1] = [];
      const observations: Array<{ raw: JevRawResponseV1; tokens: number }> = [];
      for (const { call, raw } of rows) {
        let physical:JevRawResponseV1|undefined;
        try {
          physical = JSON.parse(raw) as JevRawResponseV1;
          const parsed = validateJevResponseV1(call.request as JevRequestV1, physical);
          const mapped = hooks.map(run, call, parsed), usage = jevUsageV1(parsed.usage);
          settled.push({ call, usage, settled_micro_usd: llmCostMicroUsdV1(usage, price), stop_reason: 'completed' });
          results.push({ call, results: mapped }); latencies.push(physical.latency_ms);if(latencies.length>e.window_size)latencies.shift();
          observations.push({ raw: physical, tokens: parsed.usage.input_tokens });
        } catch (error) {
          const failure = jevProviderErrorV1(error), observed = failure.outcome === 'outcome_unknown' ? undefined
            : hooks.invalidUsage?.(failure) ?? failure.evidence.usage;
          if (observed) {
            const usage = jevUsageV1(observed);
            settled.push({ call, usage, settled_micro_usd: llmCostMicroUsdV1(usage, price), stop_reason: failure.code });
            results.push({ call, results: hooks.error(run, call, failure.code, false) });
            if(physical)observations.push({raw:physical,tokens:observed.input_tokens});
            if (hooks.fail_on_error) record(call, false, failure.code);
          } else record(call, true, failure.code);
        }
      }
      if (settled.length) await store.settlePage(run, settled);
      for(let offset=0;offset<results.length;offset+=2000){
        const batch=results.slice(offset,offset+2000);
        for(const row of batch)row.call.raw_body=null;
        await store.apply(run,batch);for(const row of batch)applied.add(row.call.id);
        if(args.revisit_empty_after_apply){durableEpoch++;wake();}
      }
      totalCost += settled.reduce((n, s) => n + s.settled_micro_usd, 0);
      labeled += results.filter(row => row.results.some(hooks.labeled)).length;
      // Usage affects rate scheduling only after raw durability and billing settlement.
      if(provider.observeUsage) {
        let observationIndex=0;
        const feedback=await Promise.allSettled(Array.from({length:Math.min(256,e.max_in_flight,observations.length)},async()=>{
          for(;;){const item=observations[observationIndex++];if(!item)return;
            await provider.observeUsage!(item.raw,item.tokens);}
        }));
        const failure=feedback.find((result):result is PromiseRejectedResult=>result.status==='rejected');
        if(failure)throw failure.reason;
      }
    } catch (error) {
      // A database/storage failure does not invalidate provider evidence. In
      // particular, settlement may have committed even if its acknowledgement
      // was lost. Preserve the pending result for a durable, idempotent replay;
      // never replace it with a technical label in a second apply.
      failed=true;
      const pending = rows.filter(row => !applied.has(row.call.id));
      for (const row of pending) record(row.call, true, 'jev_stream_persistence_failed', false);
      try { if (pending.length) await store.markFailed(run, pending.map(row => row.call), true); }
      catch (markError) { retainError=!fatalKnown;fail(new AggregateError([error, markError], 'jev_stream_persistence_failed')); }
      if(!fatalKnown)retainError=true;fail(error);
    } finally {
      // Durable storage, not the retained window of call objects, owns these bytes.
      for (const row of rows) {
        row.call.raw_body = null;
        if(applied.has(row.call.id)){
          roster.delete(row.call.id);observedRaw.delete(row.call.id);if(!errors.has(row.call.id))applied.delete(row.call.id);
          // The caller still owns the initial bounded page. Later pages have no
          // retained corpus roster once their durable application completes.
          if(!initialIds.has(row.call.id)&&!errors.has(row.call.id)){
            if(phase&&retainError)errorCalls.push(row.call);else release(jevCallWorkingBytesV2(row.call));
          }
        }
      }
      if(!phase)release(rows.reduce((n, row) => n + row.memory_bytes, 0));
    }
    return {failed,retainError,terminal:rows.some(row=>errors.get(row.call.id)?.write_result&&!applied.has(row.call.id))};
  }
  function flush(force = false) {
    while (buffered.length && active.size < e.max_flushes && (force || buffered.length >= e.flush_size)) {
      // Account for exact base64 growth plus conservative JSONL member metadata.
      // Do not discover the 32MiB codec bound after receiving paid responses.
      let size = 0, count = 0;
      while(count < Math.min(e.flush_size,buffered.length)) {
        const encoded = Math.ceil(buffered[count]!.bytes / 3) * 4 + 2048;
        if(size + encoded > 32 * 1024 * 1024) break;
        size += encoded; count++;
      }
      if(!count) { fail(Error('jev_stream_page_memory_bound')); return; }
      // Own F before removing any prefix or allocating wrappers/codec/parse.
      // One flush borrows protected G; a concurrent second flush pays full F.
      const phaseFlush=phase?.takeFlushPrefix(buffered.map(row=>row.phase_lease!),count);
      if(phase&&!phaseFlush)return;
      if(phaseFlush){count=phaseFlush.count;observe();}
      const rows = buffered.splice(0, count); bufferedBytes -= rows.reduce((n, row) => n + row.bytes, 0);
      // Count ACTUAL received-row F claims, not merely a provider binding or
      // an unused quote. Every row contributes once; terminal applications are
      // independent and may later include this same call. No IDs/RAW escape.
      if(phaseFlush){for(const row of rows){if(row.metadata_reduced)metadataNativeRows++;else metadataLegacyReceivedRows++;}observe();}
      // A timer/pressure flush is a one-shot request, not a mode inherited by
      // subsequent pages. Keep batching later responses while HTTP is active;
      // the timer or final drain will flush the bounded tail when needed.
      const task = consume(rows).then(outcome=>{
        if(phaseFlush){
          // consume's async frame (results/settled/observations/SQL) has EXITED.
          // Erase materialized RAW aliases before releasing only its workspace.
          for(const row of rows){row.raw='';if(!outcome.failed&&!outcome.terminal)row.deferred=undefined;}
          if(outcome.failed||outcome.terminal){
            const leases=phase!.quarantineFlush(phaseFlush.lease,outcome.retainError);
            for(let i=0;i<rows.length;i++)quarantined.push({lease:leases[i]!,packet:rows[i]!.deferred! as JevPackedRawV3});
          }else phase!.finishFlush(phaseFlush.lease);
          observe();wake();
        }
      }).finally(() => {
        // consume releases its real custody before this completion. Even if
        // it failed, fatal/cancellation prevents another admission; do not
        // treat a lost RAW/settlement/APPLY acknowledgement as durable success.
        byteLimitedAvailable=undefined;
        active.delete(task); observe(); wake(); flush();
      });
      active.add(task); observe();
    }
  }
  // Track the exact live send frontier even when raw recovery fails before HTTP.
  const reserved=(args.send_calls??calls.filter(call=>call.status==='reserved')).filter(call=>!call.raw_body);
  let initialHandoffComplete=!args.defer_initial_prefetch_until_handoff||!reserved.length;
  function prefetch(){
    if(!initialHandoffComplete)return;
    // Refill while one full HTTP cohort is missing from the bounded queue,
    // rather than waiting until only one cohort remains. Small windows retain
    // their original tail/bootstrap behavior instead of requiring a full gap.
    const refillAt=Math.max(workers,e.window_size-workers);
    if(feedClosed||feeding||draft||fatalKnown||admission.signal.aborted||cancellation.signal.aborted||reserved.length>refillAt||reserved.length>=e.window_size)return;
    const priority=args.next_admission_hint?.();
    if(priority?.kind==='closed'){feedClosed=true;return;}
    if(priority?.kind==='bootstrap'&&priority.wait_for_apply){
      // A quiet reservation is not a wake-up promise. The main coordinator
      // still dispatches it below; without any owned work, use the existing
      // finite frontier/reconciliation path instead of waiting forever.
      if(!reserved.length&&!activeSends.size&&!inFlight&&!buffered.length&&!active.size&&!markingInProgress)feedClosed=true;
      return;
    }
    // One fresh read per acknowledged apply epoch; never poll an empty SQL frontier.
    if(emptyAtEpoch!==undefined&&durableEpoch===emptyAtEpoch)return;
    // Do not read another full input page while paid responses own all memory.
    const free=e.max_buffered_bytes-memory;
    const nextResponse=reserved.length?responseCost(reserved,1):phase?reservationBytes+Math.max(0,phaseProfile!.flush_fixed_bytes+phaseProfile!.max_row_flush_bytes-phase.snapshot().protected_bytes)+Math.max(0,phaseProfile!.flush_fixed_bytes+phaseProfile!.max_row_flush_bytes-phase.snapshot().error_protected_bytes):reservationBytes;
    if(free<8192+(Number.isFinite(nextResponse)?nextResponse:reservationBytes))return;
    // Protect currently free HTTP slots, plus at least one waiting committed
    // call when every slot is occupied. Even a maximum-size paid response can
    // then wake another Mark while both APPLY and this future read wait. Other
    // occupied slots already own response allowances in `memory`; protecting
    // all of them again needlessly prevents a useful input prefix from fitting.
    // Headroom is not another charge: Mark claims actual response memory later.
    const readySlots=Math.min(reserved.length,Math.max(1,workers-inFlight),Math.floor(free/reservationBytes));
    const headroom=readySlots?Math.max(readySlots*reservationBytes,responseCost(reserved,Math.min(readySlots,reserved.length))):phase?nextResponse:0;
    // The bounded reader and compiler use the actual remaining shared budget,
    // rather than a second heuristic page ceiling. Larger native reservations
    // can reject a different prefix at a financial boundary; caps are unchanged.
    const available=free-headroom;
    if(readySlots&&available<8192)return;
    // After a byte-limited prefix, coalesce until one already active flush
    // completes. Smaller HTTP responses can grow credit before that durable
    // release; they must not reopen repeated tiny reads. No active flush is
    // still an immediate escape, without held inputs or another timer.
    if(byteLimitedAvailable!==undefined&&active.size)return;
    // Hold the input/serialization budget while SQL is pending. HTTP/flushes
    // share the same counter and cannot consume bytes promised to this page.
    memory+=available;observe();let retained=0;
    feeding=(async()=>{
      const maxCalls=e.window_size-reserved.length;
      if(args.observe_preparation)preparation({kind:'feed_budget',free_bytes:free,headroom_bytes:headroom,available_bytes:available,
        slots:workers-inFlight,ready_slots:readySlots,reserved_calls:reserved.length,max_calls:maxCalls});
      const readEpoch=durableEpoch;
      const next=await args.feed_next!(available,maxCalls,admission.signal);
      if(!Array.isArray(next)&&'closed' in next){feedClosed=true;return;}
      if(!Array.isArray(next)&&'proposals' in next){
        if(!store.admitAndMarkSelected||!next.proposals.length||next.proposals.length>Math.min(maxCalls,1024)
          ||!Number.isSafeInteger(next.workspace_bytes)||next.workspace_bytes<0)throw Error('jev_native_draft_invalid');
        const quote=next.workspace_quote,prefix=next.call_working_prefix;
        if(quote&&(quote.length!==next.proposals.length||!Number.isSafeInteger(quote.retained_bytes)||quote.retained_bytes<0||typeof quote.quote!=='function'
          ||!prefix||!Object.isFrozen(prefix)||prefix.length!==next.proposals.length+1||prefix[0]!==0))throw Error('jev_native_quote_invalid');
        let returnedBytes=0;
        for(let index=0;index<next.proposals.length;index++){
          returnedBytes+=jevCallWorkingBytesV2(next.proposals[index]!);
          if(quote&&prefix![index+1]!==returnedBytes)throw Error('jev_native_quote_invalid');
        }
        const bytes=returnedBytes+8192*next.proposals.length+(quote?quote.retained_bytes+256+8*prefix!.length:0);
        if(bytes>available)throw Error('jev_native_draft_memory_bound');
        retained=bytes;draftBytes=bytes;draft=next;byteLimitedAvailable=next.byte_limited?available:undefined;return;
      }
      const rows=Array.isArray(next)?next:next.calls;
      byteLimitedAvailable=!Array.isArray(next)&&next.byte_limited?available:undefined;
      if(!rows.length){
        // A repeatable-read snapshot may finish after the apply that unlocks
        // consumers. Keep its starting epoch, not the epoch at query return.
        const deferred=!Array.isArray(next)&&next.admission_deferred===true;
        const future=deferred?reserved.length||activeSends.size||markingInProgress||inFlight||buffered.length||active.size
          :reserved.length||markingUnsent.length||inFlight||buffered.length||active.size;
        if(args.revisit_empty_after_apply&&(future||durableEpoch!==readEpoch))emptyAtEpoch=readEpoch;
        else feedClosed=true;
        return;
      }
      emptyAtEpoch=undefined;
      if(rows.length>maxCalls)throw Error('jev_stream_feed_window_invalid');
      const identities=new Set<string>(),ids=new Set<string>();
      for(const call of rows){
        if(call.status!=='reserved'||call.raw_body||roster.has(call.id)||ids.has(call.id)
          ||recentIdentities.has(call.request_digest)||identities.has(call.request_digest))throw Error('jev_stream_feed_identity_invalid');
        ids.add(call.id);identities.add(call.request_digest);
      }
      const bytes=rows.reduce((n,call)=>n+jevCallWorkingBytesV2(call),0);
      if(bytes>available)throw Error('jev_stream_feed_memory_bound');
      retained=bytes;totalRoots+=rows.length;recentIdentities=identities;
      for(const call of rows)roster.set(call.id,call);reserved.push(...rows);observe();
    })().catch(fail).finally(()=>{release(available-retained);feeding=undefined;wake();});
  }
  let requeueAttempted=false,requeueFailureKnown=false,requeueFailure:unknown,markingInProgress=false,markingUnsent:LabelingCallV1<I>[]=[];
  const activeSends=new Set<Promise<void>>(),prefetchCanceled:LabelingCallV1<I>[]=[];
  async function drainAndRequeue(){
    if(feeding)await feeding;
    await Promise.all(activeSends);
    while(buffered.length||active.size){flush(true);if(active.size)await Promise.all(active);}
    const pending=[...markingUnsent,...prefetchCanceled];
    if(pending.length&&!requeueAttempted){
      requeueAttempted=true;
      try{
        if(!store.requeueUnsent)throw Error('jev_unsent_recovery_unavailable');
        await store.requeueUnsent(run,pending);
      }catch(error){if(!requeueFailureKnown){requeueFailureKnown=true;requeueFailure=error;}throw error;}
    }
  }
  cancellation.signal.addEventListener('abort', wake, { once: true });
  const timer = setInterval(() => flush(true), e.flush_interval_ms); timer.unref?.();
  try {
    observe();
    if (memory > e.max_buffered_bytes) throw Error('jev_stream_recovery_memory_budget_exceeded');
    // Recover durable responses first; no HTTP or re-upload is necessary.
    for (const call of calls.filter(call => Boolean(call.raw_body))) {
      const raw = call.raw_body!, bytes = Buffer.byteLength(raw);
      await consume([{ call, raw, bytes, memory_bytes: bytes }], true);
      if (fatalKnown) throw fatal;
    }
    async function send(call:LabelingCallV1<I>,phaseLease?:JevPhaseCaptureLeaseV3){
      let ownedReservation=phaseLease?0:reservationBytes;
      let ownsPhase=Boolean(phaseLease),metadataReduced=false;
      inFlight++;observe();
      try{
        let physical:JevRawResponseV1|undefined=await provider.evaluate(call.request as JevRequestV1,{signal:cancellation.signal});
        let deferred:JevDeferredPacketV3|null=captureJevDeferredRawV1(provider,physical);

        // Untrusted adapters and historical recovery retain their full legacy
        // representation and timing; field shape never enables this protocol.
        const raw=deferred?'':JSON.stringify(physical),bytes=deferred?.bytes??Buffer.byteLength(raw);
        const throttled=phaseLease?[429,529].includes(physical.http_status):false,rateUpdateFailed=phaseLease?physical.rate_limit_update_failed:undefined;
        if(bytes>reservationBytes)throw Error('jev_stream_response_memory_bound');
        // The bounded reader has completed. Keep conservative codec/copy
        // custody for these exact bytes, rather than the largest possible body.
        // Only the excess peak reservation is now available to another HTTP.
        // All new packing copies coexist with P under the separately prepaid
        // synchronous scratch. Retire BOTH original physical and UTF16 snapshot
        // aliases before publishing any reduced response credit.
        let custodyBytes:number;
        if(phaseLease){
          if(!deferred)throw Error('jev_phase_physical_contract_invalid');
          const metadataQuestions=metadata?.takeQuestionSlots(call);
          const working=metadataQuestions===undefined?jevLegacyPhaseFlushBytesV3(deferred.body,bytes,jevPhaseQuestionSlotsV3(call))
            :jevListeningPhaseFlushBytesV3(deferred.body,bytes,metadataQuestions);
          deferred=packJevDeferredRawV3(deferred);physical=undefined;
          custodyBytes=jevDeferredRetainedBytesV3(deferred);
          phase!.transferToRetained(phaseLease,{retained_bytes:custodyBytes,raw_wrapper_bytes:bytes,row_flush_bytes:working});
          metadataReduced=metadataQuestions!==undefined;
        }else{custodyBytes=Math.min(reservationBytes,bytes*24+64*1024);release(ownedReservation-custodyBytes);ownedReservation=custodyBytes;}
        observedRaw.add(call.id);buffered.push({call,raw,bytes,memory_bytes:custodyBytes,...(deferred?{deferred}:{}),...(phaseLease?{phase_lease:phaseLease,metadata_reduced:metadataReduced}:{})});
        ownsPhase=false;
        ownedReservation=0; // consume owns this reservation through apply/feedback
        bufferedBytes+=bytes;observe();
        const wasThrottled=phaseLease?throttled:[429,529].includes(physical!.http_status);if(wasThrottled)cancellation.abort();
        flush(wasThrottled||bufferedBytes>=e.max_buffered_bytes/2);
        if(phaseLease?rateUpdateFailed:physical!.rate_limit_update_failed)fail(Error('jev_rate_cooldown_unavailable'));
      }catch(error){
        if(ownsPhase)phase!.releaseUnsent(phaseLease!);
        if(ownedReservation)release(ownedReservation);const failure=jevProviderErrorV1(error);
        if(cancellation.signal.aborted&&isJevPreFetchCancellationV1(error)){
          // First-party identity proves fetch never started. Keep the same money
          // reservation; no physical receipt, free response or result is invented.
          prefetchCanceled.push(call);
        }else record(call,failure.outcome!=='definitely_not_sent',failure.code);
        if(hooks.fail_on_error)cancellation.abort();
      }finally{metadata?.takeQuestionSlots(call);inFlight--;observe();wake();}
    }
    // Keep never-assigned calls reserved. Persist only a cohort whose HTTP slots
    // and response memory are already available, using one governed bulk write.
    while((reserved.length||draft||!feedClosed||feeding)&&!fatalKnown&&!admission.signal.aborted&&!cancellation.signal.aborted){
      prefetch();
      if(draft&&!reserved.length){
        const pending=draft;
        if(args.preparation_valid?.()===false){if(args.observe_preparation)preparation({kind:'draft_discard',point:'pre_native'});draft=undefined;release(draftBytes);draftBytes=0;continue;}
        if(workers<=inFlight){
          if(activeSends.size||active.size||buffered.length){flush(true);await wait();continue;}
          throw Error('jev_stream_configuration_invalid');
        }
        // The reader owns only preparation custody. Choose the paid prefix
        // here, AFTER feed released its temporary hold and HTTP/APPLY advanced.
        // Keep ALL prepared proposals and the numeric vector charged until ACK;
        // unadmitted bodies are then discarded, never reused by a later cohort.
        let nativeProposals=pending.proposals,workspaceBytes=pending.workspace_bytes;
        const prefixSlots=workers-inFlight,prefixMemory=memory;let prefixBest:number|undefined,prefixProbes=0,prefixResponseMax=0,prefixResponseUnfit=0;
        const prefixResponse=(value:number)=>{if(args.observe_preparation){prefixProbes++;if(Number.isFinite(value))prefixResponseMax=Math.max(prefixResponseMax,value);else prefixResponseUnfit++;}return value;};
        const prefixObservation=(outcome:'native'|'legacy_escape')=>{if(args.observe_preparation)preparation({kind:'native_prefix_clip',prepared_calls:pending.proposals.length,
          slot_limit:prefixSlots,fitted_calls:prefixBest??nativeProposals.length,workspace_bytes:Number.isFinite(workspaceBytes)?workspaceBytes:null,
          memory_bytes:prefixMemory,draft_bytes:draftBytes,probes:prefixProbes,response_max_bytes:prefixResponseMax,response_unfit_probes:prefixResponseUnfit,
          slot_clip:prefixBest!==undefined&&prefixSlots<pending.proposals.length,memory_clip:outcome==='legacy_escape'||prefixBest!==undefined&&prefixBest<Math.min(pending.proposals.length,prefixSlots),outcome});};
        if(pending.workspace_quote){
          const quote=pending.workspace_quote,costs=pending.call_working_prefix!;
          let low=1,high=Math.min(pending.proposals.length,workers-inFlight),best=0,bestWorkspace=0;
          while(low<=high){
            const mid=Math.floor((low+high)/2),workspace=quote.quote(mid);
            if(!Number.isSafeInteger(workspace)||workspace<0)throw Error('jev_native_workspace_invalid');
            if(memory+workspace+costs[mid]!+prefixResponse(responseCost(pending.proposals,mid,workspace+costs[mid]!))<=e.max_buffered_bytes){best=mid;bestWorkspace=workspace;low=mid+1;}
            else high=mid-1;
          }
          prefixBest=best;
          if(best){nativeProposals=pending.proposals.slice(0,best);workspaceBytes=bestWorkspace;}
          else workspaceBytes=Infinity; // Existing finite escape below; no DML occurred.
        }
        // Real progress can release custody; quiet metadata cannot.
        if(memory+workspaceBytes+jevCallWorkingBytesV2(nativeProposals[0]!)+prefixResponse(responseCost(nativeProposals,1,workspaceBytes+jevCallWorkingBytesV2(nativeProposals[0]!)))>e.max_buffered_bytes){
          if(activeSends.size||active.size||buffered.length){flush(true);await wait();continue;}
          // No native invocation/DML/selector occurred: retain the old complete
          // reservation protocol on this prepared prefix, without rereading it.
          prefixObservation('legacy_escape');
          const rows=await store.reserve(run,pending.workspace_quote?nativeProposals.slice(0,1):nativeProposals);
          const bytes=rows.reduce((n,c)=>n+jevCallWorkingBytesV2(c),0);
          if(memory+bytes>e.max_buffered_bytes)throw Error('jev_native_legacy_memory_bound');
          memory+=bytes;for(const row of rows)roster.set(row.id,row);reserved.push(...rows);totalRoots+=rows.length;
          draft=undefined;release(draftBytes);draftBytes=0;continue;
        }
        prefixObservation('native');
        let workspaceClaim=workspaceBytes,selectionCalled=false,validationCalled=false;
        let selectorObservation:SignalListeningNativeSelectorObservationV1='not_observed';
        let phaseLeases:readonly JevPhaseCaptureLeaseV3[]=[];
        let responseClaim=0,callClaim=0,selected:ReadonlyArray<LabelingCallProposalV1<I>>=[],
          validated:ReadonlyArray<LabelingCallV1<I>>=[],validatedIds:ReadonlyArray<string>=[];
        memory+=workspaceBytes;observe();markingInProgress=true;
        try{
          const admissionStarted=args.observe_preparation?performance.now():0;let result:LabelingAdmissionResultV1<I>;
          try{result=await store.admitAndMarkSelected!(run,nativeProposals,{
            selectFresh(candidates){
              if(selectionCalled)throw Error('jev_native_selection_repeated');selectionCalled=true;
              const priority=args.next_admission_hint?.();
              // Preserve the original short-circuit order and call count. Only
              // the branch actually reached labels this local rejection.
              if(fatalKnown){selectorObservation='fatal';return[];}
              if(admission.signal.aborted){selectorObservation='admission_aborted';return[];}
              if(cancellation.signal.aborted){selectorObservation='cancellation_aborted';return[];}
              if(args.preparation_valid?.()===false){selectorObservation='preparation_invalid';return[];}
              if(priority?.kind==='closed'){selectorObservation='closed';return[];}
              if(priority?.kind==='bootstrap'&&priority.wait_for_apply){selectorObservation='bootstrap_wait';return[];}
              const count=Math.min(workers-inFlight,candidates.length,priority?.kind==='bootstrap'?priority.covered_call_limit:Infinity),chosen:LabelingCallProposalV1<I>[]=[];
              const selectorMemory=memory,selectorSlots=workers-inFlight;let selectorProbes=0,selectorResponseMax=0,selectorResponseUnfit=0;
              const selectorResponse=(value:number)=>{if(args.observe_preparation){selectorProbes++;if(Number.isFinite(value))selectorResponseMax=Math.max(selectorResponseMax,value);else selectorResponseUnfit++;}return value;};
              if(phase){
                const prefix=[0];for(const proposal of candidates.slice(0,count))prefix.push(prefix.at(-1)!+jevCallWorkingBytesV2(proposal));
                let low=1,high=count,best=0;
                while(low<=high){const mid=Math.floor((low+high)/2),cost=prefix[mid]!;
                  if(memory+cost+selectorResponse(responseCost(candidates,mid,cost))<=e.max_buffered_bytes){best=mid;low=mid+1;}else high=mid-1;}
                chosen.push(...candidates.slice(0,best));callClaim=prefix[best]!;memory+=callClaim;
                const held=phase.reservePrefix(chosen.map(quoteCall));
                if(chosen.length&&held?.leases.length!==chosen.length)throw Error('jev_phase_selection_drift');phaseLeases=held?.leases??[];
              }else{
                let cost=0;
                for(const proposal of candidates.slice(0,count)){
                  const bytes=jevCallWorkingBytesV2(proposal);
                  if(memory+cost+bytes+reservationBytes>e.max_buffered_bytes)break;
                  chosen.push(proposal);cost+=bytes+reservationBytes;
                }
                callClaim=chosen.reduce((n,p)=>n+jevCallWorkingBytesV2(p),0);
                responseClaim=chosen.length*reservationBytes;memory+=callClaim+responseClaim;
              }
              selected=chosen;selectorObservation=chosen.length?'selected':'zero_selected';
              if(args.observe_preparation)preparation({kind:'native_selector_clip',candidate_calls:candidates.length,slot_limit:selectorSlots,
                bootstrap_limit:priority?.kind==='bootstrap'?priority.covered_call_limit:null,limit_calls:count,selected_calls:chosen.length,
                memory_before_bytes:selectorMemory,call_bytes:callClaim,response_bytes:phase?null:responseClaim,probes:selectorProbes,response_max_bytes:selectorResponseMax,
                response_unfit_probes:selectorResponseUnfit,slot_tie:count===selectorSlots,candidate_tie:count===candidates.length,
                bootstrap_tie:priority?.kind==='bootstrap'&&count===priority.covered_call_limit,memory_clip:chosen.length<count,phase:Boolean(phase)});
              observe();return chosen;
            },
            validateBeforeCommit(rows,proposals){
              if(!selectionCalled||validationCalled)throw Error('jev_native_validation_invalid');validationCalled=true;
              if(rows.length!==selected.length||proposals.length!==selected.length)throw Error('jev_native_handoff_invalid');
              const ids=new Set<string>(),digests=new Set<string>();let bytes=0;
              for(let i=0;i<rows.length;i++){
                const row=rows[i]!,proposal=selected[i]!;
                if(proposals[i]!==proposal||row.status!=='submitting'||row.raw_body||row.results_applied||roster.has(row.id)
                  ||ids.has(row.id)||digests.has(row.request_digest)||recentIdentities.has(row.request_digest)
                  ||row.custom_id!==proposal.custom_id||row.request_digest!==proposal.request_digest)throw Error('jev_native_handoff_invalid');
                ids.add(row.id);digests.add(row.request_digest);bytes+=jevCallWorkingBytesV2(row);
              }
              if(bytes>callClaim||memory>e.max_buffered_bytes)throw Error('jev_native_memory_bound');
              // Final Native request/input graphs are fresh constructor-owned clones;
              // their producer no longer mutates them. Seal before COMMIT under
              // prepaid P/ledger, without changing serialized fields or status.
              // Unsupported lineage remains on the complete Legacy F path.
              // Official bootstrap rows retain Legacy F: their continuation
              // may derive/load a calibration profile after APPLY. Measured
              // open-hint rows cannot belong to a bootstrap's pending IDs.
              if(metadata&&args.next_admission_hint?.().kind==='open'
                &&isJevListeningMetadataBindingV3(args.response_budget_binding,provider,hooks.map,store)
                &&rows.every(row=>metadata.canSealNativeBeforeCommit(row)))
                for(const row of rows)metadata.sealNativeBeforeCommit(row);
              // Prepare every recipient and notification identifier before ACK.
              validated=rows;validatedIds=rows.map(row=>row.id);
            }
          });}catch(error){
            if(args.observe_preparation)preparation({kind:'native_admission',outcome:'threw',duration_ms:performance.now()-admissionStarted,
              proposed_calls:nativeProposals.length,selected_calls:selected.length,validated_calls:validated.length,returned_calls:null,
              selector_called:selectionCalled,validation_called:validationCalled,selector_observation:selectorObservation});
            // In particular, a lost COMMIT ACK remains unknown, not a failed
            // transaction. The existing owner below keeps the original error.
            throw error;
          }
          if(args.observe_preparation)preparation({kind:'native_admission',outcome:result.kind,duration_ms:performance.now()-admissionStarted,
            proposed_calls:nativeProposals.length,selected_calls:selected.length,validated_calls:validated.length,returned_calls:result.kind==='committed'?result.calls.length:null,
            selector_called:selectionCalled,validation_called:validationCalled,selector_observation:selectorObservation});
          if(result.kind==='legacy'){
            release(workspaceClaim);workspaceClaim=0;
            if(args.preparation_valid?.()===false){if(args.observe_preparation)preparation({kind:'draft_discard',point:'post_legacy'});continue;}
            // Native guarantees this branch precedes selector and every DML.
            // Unsupported shapes retain the COMPLETE prepared legacy prefix;
            // a Native workspace fit must not trim bootstrap/finite coverage.
            const rows=await store.reserve(run,pending.proposals);
            const bytes=rows.reduce((n,c)=>n+jevCallWorkingBytesV2(c),0);
            if(memory+bytes>e.max_buffered_bytes)throw Error('jev_native_legacy_memory_bound');
            memory+=bytes;for(const row of rows)roster.set(row.id,row);reserved.push(...rows);totalRoots+=rows.length;
          }else{
            // DB returned the exact prevalidated array after COMMIT ACK. No
            // expansion, cancellation, authority or residency gate belongs here.
            for(const row of validated)roster.set(row.id,row);
            totalRoots+=validated.length;recentIdentities=new Set(selected.map(p=>p.request_digest));
            for(let i=0;i<validated.length;i++){const row=validated[i]!;const task=send(row,phaseLeases[i]).finally(()=>{activeSends.delete(task);wake();});activeSends.add(task);}
            phaseLeases=[];responseClaim=0;callClaim=0;if(validated.length)initialHandoffComplete=true;
            try{if(validated.length)pending.on_committed?.(validatedIds,selected);}catch(error){
              // Close future admission, but let ALL paid siblings drain without
              // aborting their transport because a scheduling notice failed.
              if(!notificationFailureKnown){notificationFailureKnown=true;notificationFailure=error;}feedClosed=true;admission.abort();
            }
          }
        }catch(error){
          if((error as {outcome?:string})?.outcome==='unknown')try{await store.fail(run,'labeling_outcome_unknown',{preserve_reserved:true});}
          catch(secondary){throw new AggregateError([error,secondary],'jev_native_unknown_record_failed',{cause:error});}
          throw error;
        }finally{
          markingInProgress=false;draft=undefined;
          for(const lease of phaseLeases)phase!.releaseUnsent(lease);
          release(workspaceClaim+draftBytes+responseClaim+callClaim);draftBytes=0;
        }
        continue;
      }
      if(!reserved.length){
        if(feeding){await feeding;continue;}
        if(feedClosed)break;
        // No budget for a next page: drain one bounded frontier, then retry.
        if(activeSends.size||active.size||buffered.length){
          // An empty Listening frontier is not buffer pressure: retain ordinary
          // size/deadline batching while siblings can still produce responses.
          if(!args.revisit_empty_after_apply||!inFlight)flush(true);
          await wait();continue;
        }
        feedClosed=true;break;
      }
      const maxSlots=Math.min(workers-inFlight,reserved.length);
      const slots=phase?phase.quotePrefix(reserved.slice(0,maxSlots).map(quoteCall),maxSlots).count:
        Math.min(maxSlots,Math.floor((e.max_buffered_bytes-memory)/reservationBytes));
      if(slots<1){
        // Already reserved calls can regain slots before the future page commits.
        // Feeding's finally also wakes this single coordinator after releasing bytes.
        if(feeding){await wait();continue;}
        if(!inFlight&&!active.size&&!buffered.length)throw Error('jev_stream_memory_budget_invalid');
        // Occupied HTTP slots are not buffer pressure. Preserve batching until
        // its size/timer boundary unless responses actually need memory to move.
        if(!inFlight||e.max_buffered_bytes-memory<reservationBytes)flush(true);
        await wait();continue;
      }
      let cohort:LabelingCallV1<I>[]=[],cohortLeases:readonly JevPhaseCaptureLeaseV3[]=[];
      try{
        markingInProgress=true;
        if(store.markSubmittingSelected){
          let selected=false;
          const committed=await store.markSubmittingSelected(run,()=>{
            if(selected)throw Error('jev_stream_selection_repeated');
            selected=true;
            if(fatalKnown||admission.signal.aborted||cancellation.signal.aborted)return[];
            // Responses, durable flushes and an already-committed input page
            // may advance while native authority is waiting. Claim their newly
            // available slots only now, before the native call-row locks.
            const maxAvailable=Math.min(workers-inFlight,reserved.length);
            if(phase){const held=reserveResponses(reserved,maxAvailable);cohortLeases=held?.leases??[];cohort=reserved.slice(0,cohortLeases.length);}
            else{const available=Math.min(maxAvailable,Math.floor((e.max_buffered_bytes-memory)/reservationBytes));cohort=reserved.slice(0,available);memory+=reservationBytes*cohort.length;}
            markingUnsent=cohort;observe();
            return cohort;
          });
          if(!selected||committed.length!==cohort.length||committed.some((call,index)=>call!==cohort[index]))
            throw Error('jev_stream_selection_handoff_invalid');
        }else{
          if(phase){const held=reserveResponses(reserved,slots);cohortLeases=held?.leases??[];cohort=reserved.slice(0,cohortLeases.length);}
          else{cohort=reserved.slice(0,slots);memory+=reservationBytes*cohort.length;}
          observe();markingUnsent=cohort;
          await store.markSubmitting(run,cohort);
        }
      }catch(error){if(phase){for(const lease of cohortLeases)phase.releaseUnsent(lease);}else release(reservationBytes*cohort.length);fail(error);break;}
      finally{markingInProgress=false;}
      // There is deliberately no await/cancellation check between the successful
      // durable handoff and delivering EVERY cohort member to evaluate. A sync
      // provider rejection is classified normally, without stranding siblings.
      reserved.splice(0,cohort.length);markingUnsent=[];
      for(let i=0;i<cohort.length;i++){const call=cohort[i]!;const task=send(call,cohortLeases[i]).finally(()=>{activeSends.delete(task);});activeSends.add(task);}
      // No physical-fetch promise: providers may still await account quotas.
      // Open only after EVERY committed cohort member has been handed off.
      if(cohort.length)initialHandoffComplete=true;
    }
    await Promise.all(activeSends);
    // No HTTP was attempted for reserved calls left behind by cancellation or write failure.
    if(feeding)await feeding;
    const notDelivered=reserved,notDeliveredIds=new Set([...notDelivered,...prefetchCanceled].map(call=>call.id));
    // Drain paid receipts before requeue failure can finish or release the lease.
    await drainAndRequeue();
    for (const call of roster.values()) {
      if (!observedRaw.has(call.id) && !errors.has(call.id)) {
        if(notDeliveredIds.has(call.id)||call.status==='reserved'&&!reserved.some(item=>item.id===call.id))continue;
        const unsent=call.status==='failed'||call.status==='reserved';
        record(call,!unsent,unsent?'jev_definitely_not_sent':'jev_outcome_unknown');
      }
    }
    for (const unknown of [false, true]) {
      const group = [...errors.values()].filter(error => error.unknown === unknown);
      if (group.length) await store.markFailed(run, group.map(error => error.call), unknown);
    }
    const terminalErrors = [...errors.values()].filter(error => error.write_result);
    // Persist the stop reason before applying technical errors: a lost apply
    // acknowledgement must not reopen admission for other roots on restart.
    if (hooks.fail_on_error && terminalErrors.length) await store.fail(run,
      terminalErrors.some(x => x.unknown) ? 'labeling_outcome_unknown' : terminalErrors[0]!.code,{preserve_reserved:true});
    for (const unknown of [false, true]) {
      if(phase){
        const pending=[...errors.values()].filter(error=>error.unknown===unknown&&error.write_result&&!applied.has(error.call.id));
        for(let offset=0;offset<pending.length;){
          const candidates=pending.slice(offset,offset+e.flush_size),costs=candidates.map(row=>
            jevLegacyPhaseFlushBytesV3('',1,jevPhaseQuestionSlotsV3(row.call)));
          const workspace=phase.takeTerminalWorkspace(costs,e.flush_size);
          if(!workspace)throw Error('jev_phase_terminal_progress_invalid');
          metadataLegacyTerminalRows+=workspace.count;
          observe();
          // Returning only scalar outcome ensures result/SQL frame aliases die
          // unless the ORIGINAL first fatal explicitly retains them in escrow.
          const outcome=await(async()=>{
            try{
              const batch=candidates.slice(0,workspace.count).map(row=>({call:row.call,
                results:hooks.error(run,row.call,row.code,unknown)})).filter(row=>row.results.length);
              if(batch.length){await store.apply(run,batch);for(const row of batch)applied.add(row.call.id);}
              return{failed:false,retainError:false};
            }catch(error){const retainError=!fatalKnown;fail(error);return{failed:true,retainError};}
          })();
          if(outcome.failed)phase.quarantineFlush(workspace.lease,outcome.retainError);else phase.finishFlush(workspace.lease);
          observe();wake();offset+=workspace.count;if(outcome.failed)throw fatal;
        }
        continue;
      }
      const technical = [...errors.values()].filter(error => error.unknown === unknown && error.write_result
        && !applied.has(error.call.id)).map(error => ({call:error.call,
        results:hooks.error(run,error.call,error.code,unknown)})).filter(row => row.results.length);
      for(let offset=0;offset<technical.length;offset+=2000){
        const batch=technical.slice(offset,offset+2000);await store.apply(run,batch);for(const row of batch)applied.add(row.call.id);
      }
    }
    if (fatalKnown) throw fatal;
    if(notificationFailureKnown)throw notificationFailure;
    const status=await store.finish(run);
    reconcilePhase();
    // Invocation ownership ends here, including retained terminal errors
    // and the reserved frontier that was never sent. A cancelled reader may
    // also have returned a draft: this full release owns its charge, so retire
    // the draft custodian before finally can release it a second time.
    draft=undefined;draftBytes=0;
    release(memory);
    latencies.sort((a, b) => a - b);
    return { status, roots: totalRoots, labeled, unresolved_billing_requests: [...errors.values()].filter(x => x.unknown).length,
      settled_micro_usd: totalCost, p50_ms: latencies[Math.ceil(latencies.length * .5) - 1] ?? null,
      p95_ms: latencies[Math.ceil(latencies.length * .95) - 1] ?? null };
  } catch (error) {
    // Only the ledger can tell whether a lost SQL acknowledgement committed.
    // Reconcile under the existing lease after any failed stage, including a
    // technical-error apply; never infer state from an in-memory acknowledgement.
    // A failed operational unsent requeue is the outer failure, as in the
    // original drain/lease contract. Preserve it even when falsy; without that
    // failure retain first fatal, then notification, before any later error.
    const primary=requeueFailureKnown?requeueFailure:fatalKnown?fatal:notificationFailureKnown?notificationFailure:error;
    try { await drainAndRequeue();await store.finish(run);reconcilePhase(); }
    catch (reconciliation) { throw new AggregateError([primary, reconciliation], 'jev_stream_reconciliation_failed',{cause:primary}); }
    throw primary;
  } finally { if(draft){draft=undefined;release(draftBytes);draftBytes=0;}clearInterval(timer); cancellation.signal.removeEventListener('abort', wake); }
}
