import type { FacetInput, LlmPriceV1 } from '@noisia/query-engine';
import { llmCostMicroUsdV1 } from '@noisia/query-engine';
import type { createSignalLabelingStoreV1, LabelingRunV1, LabelingCallV1 } from '@noisia/db';
import { validateJevResponseV1, jevProviderErrorV1, type JevProviderV1, type JevRawResponseV1,
  type JevResponseV1, type JevRequestV1, type JevProviderErrorV1 } from '../providers/typesafe-jev';
const jevUsageV1 = (usage:JevResponseV1['usage']) => ({...usage,cache_read_input_tokens:0,
  cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
export type JevStreamingExecutionV2 = {
  max_in_flight: number; flush_size: number; max_flushes: number;
  max_buffered_bytes: number; flush_interval_ms: number; window_size: number;
};
export type JevStreamingMetricsV2 = { in_flight: number; reserved_working_bytes: number;
  buffered_responses: number; active_flushes: number };
/** One reserved window, continuous HTTP producers and independently bounded durable flushes.
 * The caller owns the lease and heartbeat. A response does not release its buffer until
 * its page is durable, billed and applied. No provider request is retried here. */
export async function processJevStreamingWindowV2<I extends FacetInput, R>(args: {
  run: LabelingRunV1; calls: LabelingCallV1<I>[]; send_calls?:LabelingCallV1<I>[];
  store: ReturnType<typeof createSignalLabelingStoreV1<I, R>>; provider: JevProviderV1;
  execution: JevStreamingExecutionV2; price: LlmPriceV1; cancellation: AbortController;
  observe_stream?(metrics: JevStreamingMetricsV2): void;
  hooks: { map(run: LabelingRunV1, call: LabelingCallV1<I>, raw: JevResponseV1): R[];
    error(run: LabelingRunV1, call: LabelingCallV1<I>, code: string, unknown: boolean): R[];
    labeled(result: R): boolean; invalidUsage?(failure: JevProviderErrorV1): JevResponseV1['usage'] | undefined;
    fail_on_error?: boolean };
}) {
  const { run, calls, store, provider, execution: e, hooks, price, cancellation } = args;
  for (const value of Object.values(e)) if (!Number.isSafeInteger(value) || value < 1) throw Error('jev_stream_configuration_invalid');
  if (e.max_in_flight > 4096 || e.max_flushes > 64 || e.flush_size > 4096 || e.window_size > 4096
    || e.flush_interval_ms > 60_000) throw Error('jev_stream_configuration_invalid');
  const responseBound = provider.max_response_bytes ?? 2 * 1024 * 1024;
  if(!Number.isSafeInteger(responseBound)||responseBound<1||responseBound>2*1024*1024)throw Error('jev_stream_response_bound_invalid');
  // JSON escaping, base64 page codec and temporary serialization copies are budgeted.
  const reservationBytes = responseBound * 24 + 64 * 1024;
  if (e.max_buffered_bytes < reservationBytes) throw Error('jev_stream_memory_budget_invalid');
  const workers = Math.min(calls.length, e.max_in_flight, provider.max_concurrency ?? e.max_in_flight,
    Math.floor(e.max_buffered_bytes / reservationBytes));
  type Row = { call: LabelingCallV1<I>; raw: string; bytes: number; memory_bytes: number };
  let buffered: Row[] = [], bufferedBytes = 0,
    memory = calls.reduce((n, call) => n + Buffer.byteLength(call.raw_body ?? ''), 0),
    inFlight = 0, next = 0, fatal: unknown;
  let totalCost = 0, labeled = 0; const latencies: number[] = [];
  const errors = new Map<string, { call: LabelingCallV1<I>; unknown: boolean; code: string; write_result: boolean }>();
  const applied = new Set<string>(), observedRaw = new Set(calls.filter(c => Boolean(c.raw_body)).map(c => c.id));
  const active = new Set<Promise<void>>(); const waiters = new Set<() => void>();
  const observe = () => {
    // Instrumentation never changes physical attempts or their financial outcome.
    try { args.observe_stream?.({ in_flight: inFlight, reserved_working_bytes: memory,
      buffered_responses: buffered.length, active_flushes: active.size }); } catch { /* Observer only. */ }
  };
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const wait = () => new Promise<void>(resolve => { waiters.add(resolve); });
  const release = (bytes: number) => { memory -= bytes; observe(); wake(); };
  const fail = (error: unknown) => { fatal ??= error; cancellation.abort(); wake(); };
  const record = (call: LabelingCallV1<I>, unknown: boolean, code: string, write_result = true) =>
    errors.set(call.id, { call, unknown, code, write_result });
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
          results.push({ call, results: mapped }); latencies.push(physical.latency_ms);
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
      if (results.length) { await store.apply(run, results); for (const row of results) applied.add(row.call.id); }
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
      for (const row of rows) row.call.raw_body = null;
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
      const task = consume(rows).finally(() => { active.delete(task); observe(); wake(); flush(force); });
      active.add(task); observe();
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
    // Only the caller's just-marked reservations may be sent. A submitting call
    // recovered after a crash is ambiguous even if it has no stored bytes.
    const reserved = (args.send_calls ?? calls.filter(call => call.status === 'reserved')).filter(call => !call.raw_body);
    await Promise.all(Array.from({ length: workers }, async () => {
      while (next < reserved.length && !fatal && !cancellation.signal.aborted) {
        while (memory + reservationBytes > e.max_buffered_bytes && !fatal && !cancellation.signal.aborted) { flush(true); await wait(); }
        if (fatal || cancellation.signal.aborted) return;
        const call = reserved[next++]; if (!call) return;
        memory += reservationBytes; inFlight++; observe();
        try {
          const physical = await provider.evaluate(call.request as JevRequestV1, { signal: cancellation.signal });
          const raw = JSON.stringify(physical), bytes = Buffer.byteLength(raw);
          if (bytes > reservationBytes) throw Error('jev_stream_response_memory_bound');
          observedRaw.add(call.id); buffered.push({ call, raw, bytes, memory_bytes: reservationBytes }); bufferedBytes += bytes;
          observe();
          const throttled = [429, 529].includes(physical.http_status);
          if (throttled) cancellation.abort();
          flush(throttled || bufferedBytes >= e.max_buffered_bytes / 2);
          if(physical.rate_limit_update_failed)fail(Error('jev_rate_cooldown_unavailable'));
        } catch (error) {
          release(reservationBytes);
          const failure = jevProviderErrorV1(error); record(call, failure.outcome !== 'definitely_not_sent', failure.code);
          if (hooks.fail_on_error) cancellation.abort();
        } finally { inFlight--; observe(); }
      }
    }));
    // No HTTP was attempted for reserved calls left behind by cancellation or write failure.
    const notDelivered=reserved.slice(next),notDeliveredIds=new Set(notDelivered.map(call=>call.id));
    // These exact IDs never crossed evaluate in this live process. A lease-held
    // compare-and-set restores their reservation without inventing a final result.
    if(notDelivered.length){
      if(!store.requeueUnsent)throw Error('jev_unsent_recovery_unavailable');
      await store.requeueUnsent(run,notDelivered);
    }
    while (buffered.length || active.size) { flush(true); if (active.size) await Promise.all(active); }
    for (const call of calls) {
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
      if (technical.length) { await store.apply(run, technical); for (const row of technical) applied.add(row.call.id); }
    }
    if (fatal) throw fatal;
    latencies.sort((a, b) => a - b);
    return { status: await store.finish(run), roots: calls.length, labeled, unresolved_billing_requests: [...errors.values()].filter(x => x.unknown).length,
      settled_micro_usd: totalCost, p50_ms: latencies[Math.ceil(latencies.length * .5) - 1] ?? null,
      p95_ms: latencies[Math.ceil(latencies.length * .95) - 1] ?? null };
  } catch (error) {
    // Only the ledger can tell whether a lost SQL acknowledgement committed.
    // Reconcile under the existing lease after any failed stage, including a
    // technical-error apply; never infer state from an in-memory acknowledgement.
    try { await store.finish(run); }
    catch (reconciliation) { throw new AggregateError([error, reconciliation], 'jev_stream_reconciliation_failed'); }
    throw error;
  } finally { clearInterval(timer); cancellation.signal.removeEventListener('abort', wake); }
}
