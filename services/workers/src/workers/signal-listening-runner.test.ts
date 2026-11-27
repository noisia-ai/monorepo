import test from "node:test";
import assert from "node:assert/strict";
import { JevFatalErrorV1, type JevPacedClientV1, type JevPacedResultV1 } from "../providers/jev-paced-client";
import { runListeningStreamV1, type ListeningStreamPageV1 } from "./signal-listening-runner";

type Item = { root_id: string; request: { model: string; state: string; questions: Record<string, never> } };
const items = (count: number, from = 0): Item[] => Array.from({ length: count }, (_, index) => ({ root_id: `root-${from + index}`,
  request: { model: "jev-1.13.0", state: `text ${from + index}`, questions: {} } }));
const answer = (tokens = 100): JevPacedResultV1 => ({ ok: true, raw_body: "{}", latency_ms: 5, attempts: 1, throttled: 0,
  response: { model: "jev-1.13.0", answers: {}, usage: { input_tokens: tokens, output_tokens: 0 } } });
function source(total: number, slice: number) {
  let cursor = 0, calls = 0, concurrent = 0, maxConcurrent = 0;
  return { calls: () => calls, max_concurrent: () => maxConcurrent, async next() {
    calls++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(resolve => setImmediate(resolve));
    const page = items(Math.min(slice, total - cursor), cursor); cursor += page.length; concurrent--; return page;
  } };
}

test("every root is asked once, pages are written in order and the load is never concurrent", async () => {
  const pages: Array<ListeningStreamPageV1<Item>> = [], roots = source(1050, 100);
  let inFlight = 0, peak = 0;
  const client: JevPacedClientV1 = { async evaluate() {
    inFlight++; peak = Math.max(peak, inFlight); await new Promise(resolve => setImmediate(resolve)); inFlight--; return answer(); } };
  const receipt = await runListeningStreamV1({ client, max_in_flight: 16, page_size: 200, next: () => roots.next(), flush: async page => { pages.push(page); } });
  assert.equal(receipt.roots_done, 1050); assert.equal(receipt.roots_failed, 0); assert.equal(receipt.input_tokens, 105_000);
  assert.equal(receipt.stop_reason, "exhausted");
  assert.deepEqual(pages.map(page => page.page_no), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(pages.flatMap(page => page.done.map(entry => entry.item.root_id))).size, 1050);
  assert.ok(peak <= 16 && peak >= 8, `in flight peak ${peak}`);
  assert.equal(roots.max_concurrent(), 1);
});

test("a failed root is reported in its page and does not stop the others", async () => {
  const pages: Array<ListeningStreamPageV1<Item>> = [], roots = source(50, 50);
  const client: JevPacedClientV1 = { async evaluate(request) {
    return request.state === "text 7" ? { ok: false, code: "jev_http_500", attempts: 4, throttled: 0 } : answer(); } };
  const receipt = await runListeningStreamV1({ client, max_in_flight: 4, page_size: 20, next: () => roots.next(), flush: async page => { pages.push(page); } });
  assert.equal(receipt.roots_done, 49); assert.equal(receipt.roots_failed, 1); assert.equal(receipt.requests, 49 + 4);
  assert.deepEqual(pages.flatMap(page => page.failed.map(entry => [entry.item.root_id, entry.code])), [["root-7", "jev_http_500"]]);
});

test("a fatal provider error stops sending but still writes what was already answered", async () => {
  const pages: Array<ListeningStreamPageV1<Item>> = [], roots = source(1000, 100);
  let sent = 0;
  const client: JevPacedClientV1 = { async evaluate() { if (++sent > 30) throw new JevFatalErrorV1("jev_http_402", 402); return answer(); } };
  const receipt = await runListeningStreamV1({ client, max_in_flight: 2, page_size: 500, next: () => roots.next(), flush: async page => { pages.push(page); } });
  assert.equal(receipt.stop_reason, "fatal"); assert.equal(receipt.fatal_code, "jev_http_402");
  assert.equal(receipt.roots_done, 30);
  assert.equal(pages.reduce((sum, page) => sum + page.done.length, 0), 30);
  assert.ok(sent < 40);
});

test("the stop check ends the run between slices and a write failure is surfaced", async () => {
  const roots = source(1000, 100); let written = 0;
  const client: JevPacedClientV1 = { async evaluate() { return answer(); } };
  const stopped = await runListeningStreamV1({ client, max_in_flight: 8, page_size: 100, next: () => roots.next(),
    flush: async page => { written += page.done.length; }, should_stop: () => written >= 200 });
  assert.equal(stopped.stop_reason, "stopped");
  assert.ok(stopped.roots_done >= 200 && stopped.roots_done <= 500, `stopped after ${stopped.roots_done}`);
  assert.equal(written, stopped.roots_done);
  await assert.rejects(runListeningStreamV1({ client, max_in_flight: 8, page_size: 50, next: () => source(500, 100).next(),
    flush: async () => { throw new Error("listening_run_lease_lost"); } }), /listening_run_lease_lost/);
});

test("a failed load ends the run but everything already answered is written first", async () => {
  const pages: Array<ListeningStreamPageV1<Item>> = []; let slice = 0, sent = 0;
  const client: JevPacedClientV1 = { async evaluate() { sent++; await new Promise(resolve => setImmediate(resolve)); return answer(); } };
  await assert.rejects(runListeningStreamV1({ client, max_in_flight: 4, page_size: 1000,
    next: async () => { if (slice++ === 2) throw new Error("database unavailable"); return items(100, (slice - 1) * 100); },
    flush: async page => { pages.push(page); } }), /database unavailable/);
  assert.equal(sent, 200);
  assert.equal(pages.reduce((sum, page) => sum + page.done.length, 0), 200, "paid answers are not discarded");
});

test("unwritten pages hold back new requests", async () => {
  const roots = source(2000, 500); let release!: () => void, sentWhileBlocked = 0, blocked = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const client: JevPacedClientV1 = { async evaluate() { if (blocked) sentWhileBlocked++; return answer(); } };
  const running = runListeningStreamV1({ client, max_in_flight: 4, page_size: 100, next: () => roots.next(),
    flush: async page => { if (page.page_no === 1) { blocked = true; await gate; blocked = false; } } });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(sentWhileBlocked <= 210, `sent ${sentWhileBlocked} while the first page was blocked`);
  release();
  assert.equal((await running).roots_done, 2000);
});

test("invalid settings are rejected", async () => {
  const client: JevPacedClientV1 = { async evaluate() { return answer(); } };
  await assert.rejects(runListeningStreamV1({ client, max_in_flight: 0, page_size: 10, next: async () => [], flush: async () => undefined }), /listening_stream_configuration_invalid/);
});
