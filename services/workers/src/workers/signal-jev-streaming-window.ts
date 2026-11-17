import type { FacetInput, LlmPriceV1 } from '@noisia/query-engine';
import { llmCostMicroUsdV1 } from '@noisia/query-engine';
import type { createSignalLabelingStoreV1, LabelingRunV1, LabelingCallV1 } from '@noisia/db';
import { validateJevResponseV1, jevProviderErrorV1, isJevPreFetchCancellationV1, type JevProviderV1, type JevRawResponseV1,
  type JevResponseV1, type JevRequestV1, type JevProviderErrorV1 } from '../providers/typesafe-jev';
const jevUsageV1 = (usage:JevResponseV1['usage']) => ({...usage,cache_read_input_tokens:0,
  cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
export type JevStreamingExecutionV2 = {
  max_in_flight: number; flush_size: number; max_flushes: number;
  max_buffered_bytes: number; flush_interval_ms: number; window_size: number;
};
export type JevStreamingMetricsV2 = { in_flight: number; reserved_working_bytes: number;
  buffered_responses: number; active_flushes: number; prefetch_canceled_requests?:number;admission_closed?:boolean };
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
  store: ReturnType<typeof createSignalLabelingStoreV1<I, R>> & {
    /** Native adapters select only after their fresh authority fences, and
     * return the exact cohort after its submitting transaction commits. */
    markSubmittingSelected?(run:LabelingRunV1,
      selectCommitted:()=>ReadonlyArray<LabelingCallV1<I>>):Promise<ReadonlyArray<LabelingCallV1<I>>>;
  }; provider: JevProviderV1;
  execution: JevStreamingExecutionV2; price: LlmPriceV1; cancellation: AbortController;
  observe_stream?(metrics: JevStreamingMetricsV2): void;
  /** First-party adapters only: inputs exclude every already reserved identity.
   * Returns at most one window, already budgeted before money reservation. */
  feed_next?(available_bytes:number,max_calls:number,admission_signal:AbortSignal):Promise<LabelingCallV1<I>[] | { closed:true }>;
  /** Listening native pending eligibility can advance only after durable apply. */
  revisit_empty_after_apply?:boolean;
  hooks: { map(run: LabelingRunV1, call: LabelingCallV1<I>, raw: JevResponseV1): R[];
    error(run: LabelingRunV1, call: LabelingCallV1<I>, code: string, unknown: boolean): R[];
    labeled(result: R): boolean; invalidUsage?(failure: JevProviderErrorV1): JevResponseV1['usage'] | undefined;
    fail_on_error?: boolean };
}) {
  const { run, calls, store, provider, execution: e, hooks, price, cancellation } = args;
  const reservationBytes=assertJevStreamingExecutionV2(e,provider);
  const workers = Math.min(args.feed_next?e.max_in_flight:calls.length, e.max_in_flight, provider.max_concurrency ?? e.max_in_flight,
    Math.floor(e.max_buffered_bytes / reservationBytes));
  type Row = { call: LabelingCallV1<I>; raw: string; bytes: number; memory_bytes: number };
  let buffered: Row[] = [], bufferedBytes = 0,
    memory = calls.reduce((n, call) => n + Buffer.byteLength(call.raw_body ?? '')+jevCallWorkingBytesV2(call), 0),
    inFlight = 0, fatal: unknown;
  const admission=new AbortController();
  let totalRoots=calls.length,feedClosed=!args.feed_next,feeding:Promise<void>|undefined;
  let durableEpoch=0,emptyAtEpoch:number|undefined;
  const roster=new Map(calls.map(call=>[call.id,call])),initialIds=new Set(calls.map(call=>call.id));
  const initialMetadata=calls.reduce((n,call)=>n+jevCallWorkingBytesV2(call),0);
  let recentIdentities=new Set(calls.map(call=>call.request_digest));
  let totalCost = 0, labeled = 0; const latencies: number[] = [];
  const errors = new Map<string, { call: LabelingCallV1<I>; unknown: boolean; code: string; write_result: boolean }>();
  const applied = new Set<string>(), observedRaw = new Set(calls.filter(c => Boolean(c.raw_body)).map(c => c.id));
  const active = new Set<Promise<void>>(); const waiters = new Set<() => void>();
  const observe = () => {
    // Instrumentation never changes physical attempts or their financial outcome.
    try { args.observe_stream?.({ in_flight: inFlight, reserved_working_bytes: memory,
      buffered_responses: buffered.length, active_flushes: active.size,prefetch_canceled_requests:prefetchCanceled.length,admission_closed:admission.signal.aborted }); } catch { /* Observer only. */ }
  };
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const wait = () => new Promise<void>(resolve => { waiters.add(resolve); });
  const release = (bytes: number) => { memory -= bytes; observe(); wake(); };
  const fail = (error: unknown) => { fatal ??= error; cancellation.abort(); wake(); };
  const record = (call: LabelingCallV1<I>, unknown: boolean, code: string, write_result = true) => {
    errors.set(call.id, { call, unknown, code, write_result });
    if(hooks.fail_on_error&&write_result){
      // Semantic failure closes admission, not the in-flight HTTP transport.
      // Already handed-off siblings must still drain their physical receipts.
      feedClosed=true;admission.abort();observe();wake();
    }
  };
  async function consume(rows: Row[], alreadyDurable = false) {
    try {
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
      const pending = rows.filter(row => !applied.has(row.call.id));
      for (const row of pending) record(row.call, true, 'jev_stream_persistence_failed', false);
      try { if (pending.length) await store.markFailed(run, pending.map(row => row.call), true); }
      catch (markError) { fail(new AggregateError([error, markError], 'jev_stream_persistence_failed')); }
      fail(error);
    } finally {
      // Durable storage, not the retained window of call objects, owns these bytes.
      for (const row of rows) {
        row.call.raw_body = null;
        if(applied.has(row.call.id)){
          roster.delete(row.call.id);observedRaw.delete(row.call.id);if(!errors.has(row.call.id))applied.delete(row.call.id);
          // The caller still owns the initial bounded page. Later pages have no
          // retained corpus roster once their durable application completes.
          if(!initialIds.has(row.call.id)&&!errors.has(row.call.id))release(jevCallWorkingBytesV2(row.call));
        }
      }
      release(rows.reduce((n, row) => n + row.memory_bytes, 0));
    }
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
      const rows = buffered.splice(0, count); bufferedBytes -= rows.reduce((n, row) => n + row.bytes, 0);
      // A timer/pressure flush is a one-shot request, not a mode inherited by
      // subsequent pages. Keep batching later responses while HTTP is active;
      // the timer or final drain will flush the bounded tail when needed.
      const task = consume(rows).finally(() => { active.delete(task); observe(); wake(); flush(); });
      active.add(task); observe();
    }
  }
  // Track the exact live send frontier even when raw recovery fails before HTTP.
  const reserved=(args.send_calls??calls.filter(call=>call.status==='reserved')).filter(call=>!call.raw_body);
  function prefetch(){
    if(feedClosed||feeding||fatal||admission.signal.aborted||cancellation.signal.aborted||reserved.length>workers||reserved.length>=e.window_size)return;
    // One fresh read per acknowledged apply epoch; never poll an empty SQL frontier.
    if(emptyAtEpoch!==undefined&&durableEpoch===emptyAtEpoch)return;
    // Do not read another full input page while paid responses own all memory.
    const free=e.max_buffered_bytes-memory;if(free<8192+reservationBytes)return;
    const available=Math.min(free,Math.max(e.window_size*16384,initialMetadata*2));
    // Hold the input/serialization budget while SQL is pending. HTTP/flushes
    // share the same counter and cannot consume bytes promised to this page.
    memory+=available;observe();let retained=0;
    feeding=(async()=>{
      const maxCalls=e.window_size-reserved.length;
      const readEpoch=durableEpoch;
      const next=await args.feed_next!(available,maxCalls,admission.signal);
      if(!Array.isArray(next)){feedClosed=true;return;}
      const rows=next;
      if(!rows.length){
        // A repeatable-read snapshot may finish after the apply that unlocks
        // consumers. Keep its starting epoch, not the epoch at query return.
        const future=reserved.length||markingUnsent.length||inFlight||buffered.length||active.size;
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
  let requeueAttempted=false,markingUnsent:LabelingCallV1<I>[]=[];
  const activeSends=new Set<Promise<void>>(),prefetchCanceled:LabelingCallV1<I>[]=[];
  async function drainAndRequeue(){
    if(feeding)await feeding;
    await Promise.all(activeSends);
    while(buffered.length||active.size){flush(true);if(active.size)await Promise.all(active);}
    const pending=[...markingUnsent,...prefetchCanceled];
    if(pending.length&&!requeueAttempted){
      requeueAttempted=true;
      if(!store.requeueUnsent)throw Error('jev_unsent_recovery_unavailable');
      await store.requeueUnsent(run,pending);
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
      if (fatal) throw fatal;
    }
    async function send(call:LabelingCallV1<I>){
      let ownedReservation=reservationBytes;
      inFlight++;observe();
      try{
        const physical=await provider.evaluate(call.request as JevRequestV1,{signal:cancellation.signal});
        const raw=JSON.stringify(physical),bytes=Buffer.byteLength(raw);
        if(bytes>reservationBytes)throw Error('jev_stream_response_memory_bound');
        // The bounded reader has completed. Keep conservative codec/copy
        // custody for these exact bytes, rather than the largest possible body.
        // Only the excess peak reservation is now available to another HTTP.
        const custodyBytes=Math.min(reservationBytes,bytes*24+64*1024);
        release(ownedReservation-custodyBytes);ownedReservation=custodyBytes;
        observedRaw.add(call.id);buffered.push({call,raw,bytes,memory_bytes:custodyBytes});
        ownedReservation=0; // consume owns this reservation through apply/feedback
        bufferedBytes+=bytes;observe();
        const throttled=[429,529].includes(physical.http_status);if(throttled)cancellation.abort();
        flush(throttled||bufferedBytes>=e.max_buffered_bytes/2);
        if(physical.rate_limit_update_failed)fail(Error('jev_rate_cooldown_unavailable'));
      }catch(error){
        if(ownedReservation)release(ownedReservation);const failure=jevProviderErrorV1(error);
        if(cancellation.signal.aborted&&isJevPreFetchCancellationV1(error)){
          // First-party identity proves fetch never started. Keep the same money
          // reservation; no physical receipt, free response or result is invented.
          prefetchCanceled.push(call);
        }else record(call,failure.outcome!=='definitely_not_sent',failure.code);
        if(hooks.fail_on_error)cancellation.abort();
      }finally{inFlight--;observe();wake();}
    }
    // Keep never-assigned calls reserved. Persist only a cohort whose HTTP slots
    // and response memory are already available, using one governed bulk write.
    while((reserved.length||!feedClosed||feeding)&&!fatal&&!admission.signal.aborted&&!cancellation.signal.aborted){
      prefetch();
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
      const slots=Math.min(workers-inFlight,Math.floor((e.max_buffered_bytes-memory)/reservationBytes),reserved.length);
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
      let cohort:LabelingCallV1<I>[]=[];
      try{
        if(store.markSubmittingSelected){
          let selected=false;
          const committed=await store.markSubmittingSelected(run,()=>{
            if(selected)throw Error('jev_stream_selection_repeated');
            selected=true;
            if(fatal||admission.signal.aborted||cancellation.signal.aborted)return[];
            // Responses, durable flushes and an already-committed input page
            // may advance while native authority is waiting. Claim their newly
            // available slots only now, before the native call-row locks.
            const available=Math.min(workers-inFlight,Math.floor((e.max_buffered_bytes-memory)/reservationBytes),reserved.length);
            cohort=reserved.slice(0,available);
            memory+=reservationBytes*cohort.length;markingUnsent=cohort;observe();
            return cohort;
          });
          if(!selected||committed.length!==cohort.length||committed.some((call,index)=>call!==cohort[index]))
            throw Error('jev_stream_selection_handoff_invalid');
        }else{
          cohort=reserved.slice(0,slots);memory+=reservationBytes*cohort.length;observe();markingUnsent=cohort;
          await store.markSubmitting(run,cohort);
        }
      }catch(error){release(reservationBytes*cohort.length);fail(error);break;}
      // There is deliberately no await/cancellation check between the successful
      // durable handoff and delivering EVERY cohort member to evaluate. A sync
      // provider rejection is classified normally, without stranding siblings.
      reserved.splice(0,cohort.length);markingUnsent=[];
      for(const call of cohort){const task=send(call).finally(()=>{activeSends.delete(task);});activeSends.add(task);}
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
      const technical = [...errors.values()].filter(error => error.unknown === unknown && error.write_result
        && !applied.has(error.call.id)).map(error => ({call:error.call,
        results:hooks.error(run,error.call,error.code,unknown)})).filter(row => row.results.length);
      for(let offset=0;offset<technical.length;offset+=2000){
        const batch=technical.slice(offset,offset+2000);await store.apply(run,batch);for(const row of batch)applied.add(row.call.id);
      }
    }
    if (fatal) throw fatal;
    const status=await store.finish(run);
    // Invocation ownership ends here, including retained terminal errors
    // and the reserved frontier that was never sent.
    release(memory);
    latencies.sort((a, b) => a - b);
    return { status, roots: totalRoots, labeled, unresolved_billing_requests: [...errors.values()].filter(x => x.unknown).length,
      settled_micro_usd: totalCost, p50_ms: latencies[Math.ceil(latencies.length * .5) - 1] ?? null,
      p95_ms: latencies[Math.ceil(latencies.length * .95) - 1] ?? null };
  } catch (error) {
    // Only the ledger can tell whether a lost SQL acknowledgement committed.
    // Reconcile under the existing lease after any failed stage, including a
    // technical-error apply; never infer state from an in-memory acknowledgement.
    try { await drainAndRequeue();await store.finish(run); }
    catch (reconciliation) { throw new AggregateError([error, reconciliation], 'jev_stream_reconciliation_failed'); }
    throw error;
  } finally { clearInterval(timer); cancellation.signal.removeEventListener('abort', wake); }
}
