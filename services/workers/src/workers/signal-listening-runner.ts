import { setMaxListeners } from "node:events";
import type { JevRequestV1, JevResponseV1 } from "../providers/typesafe-jev";
import { JevFatalErrorV1, type JevPacedClientV1 } from "../providers/jev-paced-client";

export type ListeningStreamItemV1 = { root_id: string; request: JevRequestV1 };
export type ListeningStreamDoneV1<Item> = { item: Item; response: JevResponseV1; raw_body: string; latency_ms: number };
export type ListeningStreamPageV1<Item> = {
  page_no: number; done: Array<ListeningStreamDoneV1<Item>>; failed: Array<{ item: Item; code: string }>;
};
export type ListeningStreamReceiptV1 = {
  roots_done: number; roots_failed: number; input_tokens: number; pages: number; requests: number; throttled: number;
  wall_ms: number; load_ms: number; flush_ms: number; roots_per_second: number;
  provider_p50_ms: number | null; provider_p95_ms: number | null;
  stop_reason: "exhausted" | "stopped" | "fatal"; fatal_code?: string;
};

const percentile = (sorted: number[], q: number) => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * q) - 1]!) : null;

/**
 * Keeps JEV busy up to `max_in_flight` while pages are written behind it.
 *
 * - `next` returns the following slice of pending roots, or an empty list when
 *   there are none left. It is never called concurrently.
 * - `flush` makes one page durable: raw responses as one object, answers in one
 *   batch. At most two pages wait to be written; beyond that, sending pauses.
 * - `should_stop` is checked before each slice is loaded (spending cap, cancel).
 *
 * A crash loses at most the pages not yet flushed; their roots stay pending and
 * are simply asked again.
 */
export async function runListeningStreamV1<Item extends ListeningStreamItemV1>(args: {
  client: JevPacedClientV1; max_in_flight: number; page_size: number;
  next(): Promise<Item[]>;
  flush(page: ListeningStreamPageV1<Item>): Promise<void>;
  should_stop?(): boolean;
  signal?: AbortSignal;
}): Promise<ListeningStreamReceiptV1> {
  if (!Number.isSafeInteger(args.max_in_flight) || args.max_in_flight < 1 || args.max_in_flight > 1024
    || !Number.isSafeInteger(args.page_size) || args.page_size < 1 || args.page_size > 10_000) throw new Error("listening_stream_configuration_invalid");
  const started = performance.now(), abort = new AbortController();
  // Every request in flight listens for the same stop.
  setMaxListeners(args.max_in_flight * 2 + 16, abort.signal);
  const onAbort = () => abort.abort();
  args.signal?.addEventListener("abort", onAbort, { once: true });
  if (args.signal?.aborted) abort.abort();

  const queue: Item[] = [], latencies: number[] = [];
  let exhausted = false, stopped = false, loading: Promise<void> | undefined, loadMs = 0, flushMs = 0;
  let done: Array<ListeningStreamDoneV1<Item>> = [], failed: Array<{ item: Item; code: string }> = [];
  let pageNo = 0, pendingFlushes = 0, flushChain: Promise<void> = Promise.resolve(), flushError: unknown, fatal: JevFatalErrorV1 | undefined;
  const totals = { roots_done: 0, roots_failed: 0, input_tokens: 0, requests: 0, throttled: 0 };

  const load = () => loading ??= (async () => {
    if (args.should_stop?.()) { stopped = true; exhausted = true; return; }
    const t = performance.now();
    const items = await args.next();
    loadMs += performance.now() - t;
    if (items.length) queue.push(...items); else exhausted = true;
  })().finally(() => { loading = undefined; });

  const schedule = (force = false) => {
    if (!done.length && !failed.length) return;
    if (!force && done.length + failed.length < args.page_size) return;
    const page: ListeningStreamPageV1<Item> = { page_no: ++pageNo, done, failed };
    done = []; failed = []; pendingFlushes++;
    flushChain = flushChain.then(async () => {
      if (flushError) return;
      const t = performance.now();
      try { await args.flush(page); } catch (error) { flushError = error; abort.abort(); }
      finally { flushMs += performance.now() - t; pendingFlushes--; }
    });
  };

  async function worker() {
    for (;;) {
      if (abort.signal.aborted) return;
      // Backpressure: never hold more than two unwritten pages in memory.
      while (pendingFlushes >= 2 && !abort.signal.aborted) await flushChain;
      let item = queue.shift();
      if (!item) {
        if (exhausted) return;
        await load();
        item = queue.shift();
        if (!item) { if (exhausted) return; continue; }
      }
      if (queue.length < args.max_in_flight && !exhausted && !loading) void load().catch(error => { flushError ??= error; abort.abort(); });
      try {
        const result = await args.client.evaluate(item.request, { signal: abort.signal });
        totals.requests += result.attempts + result.throttled; totals.throttled += result.throttled;
        if (result.ok) {
          totals.roots_done++; totals.input_tokens += result.response.usage.input_tokens; latencies.push(result.latency_ms);
          done.push({ item, response: result.response, raw_body: result.raw_body, latency_ms: result.latency_ms });
        } else { totals.roots_failed++; failed.push({ item, code: result.code }); }
        schedule();
      } catch (error) {
        if (error instanceof JevFatalErrorV1) { fatal ??= error; abort.abort(); return; }
        if (abort.signal.aborted) return;
        flushError ??= error; abort.abort(); return;
      }
    }
  }

  try {
    await load();
    await Promise.all(Array.from({ length: args.max_in_flight }, worker));
  } catch (error) { flushError ??= error; }
  finally { args.signal?.removeEventListener("abort", onAbort); }
  // Whatever was answered and paid for is still written, even after a fatal stop.
  schedule(true);
  await flushChain;
  if (flushError && !fatal) throw flushError;
  latencies.sort((a, b) => a - b);
  const wall = performance.now() - started;
  return { ...totals, pages: pageNo, wall_ms: Math.round(wall), load_ms: Math.round(loadMs), flush_ms: Math.round(flushMs),
    roots_per_second: wall > 0 ? Math.round(totals.roots_done / (wall / 1000) * 10) / 10 : 0,
    provider_p50_ms: percentile(latencies, 0.5), provider_p95_ms: percentile(latencies, 0.95),
    stop_reason: fatal ? "fatal" : stopped || args.signal?.aborted ? "stopped" : "exhausted", ...(fatal ? { fatal_code: fatal.code } : {}) };
}
