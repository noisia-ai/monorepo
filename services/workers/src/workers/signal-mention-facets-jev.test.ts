import test from 'node:test';
import assert from 'node:assert/strict';
import { processMentionFacetsJevV1 } from './signal-mention-facets-jev';
import { JevProviderErrorV1, type JevProviderV1 } from '../providers/typesafe-jev';
import { jevFacetLabelerIdentityV1, JEV_FACET_EXPERIMENTAL_THRESHOLDS_V1 } from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
import type { SignalLabelingStoreV1, LabelingRunV1, LabelingCallV1 } from '@noisia/db';
import type { FacetResult } from '@noisia/query-engine/src/signal-mention-labeler-v1';
function fixture(count: number) {
  const run: LabelingRunV1 = { id: 'run', workspace_id: 'workspace', actor_user_id: 'actor', kind: 'facets', labeler_digest: 'labeler', identity: jevFacetLabelerIdentityV1(JEV_FACET_EXPERIMENTAL_THRESHOLDS_V1, 0.042), entity_context_digest: 'context', entity_context_version_no: 1, context: { entities: [{ entity_id: 'a', kind: 'primary_brand', name: 'Fictional device', aliases: [], disambiguation: null }] }, lease_token: 'lease', cursor_root_id: null, cap_micro_usd: null, processing_admission_id: 'admission', status: 'running', error_code: null };
  const calls: LabelingCallV1[] = []; const results: FacetResult[] = []; const events: string[] = [];
  let selected = false;
  const store: SignalLabelingStoreV1 = {
    async renew() {}, async fail() {},
    async claim() { events.push('claim'); return run; }, async release() { events.push('release'); },
    async calls() { return calls; },
    async inputs() { if (selected) return []; selected = true; return Array.from({ length: count }, (_, i) => ({ root_id: `root-${i}`, input_digest: `input-${i}`, text: 'Synthetic content', title: null, platform: null, content_type: null, author: null, published_at: '2026-10-04T00:00:00Z', language: 'es' })); },
    async reserve(_run, proposals) { events.push(`reserve:${proposals.length}`); const added = proposals.map((p, i) => ({ ...p, id: `call-${i}`, status: 'reserved' as const, raw_body: null, results_applied: false, provider_batch_id: null, retry_depth: 0 })); calls.push(...added); return added; },
    async markSubmitting(_run, page) { events.push(`submitting:${page.length}`); page.forEach(call => { call.status = 'submitting'; }); },
    async markSubmitted() {},
    async recoverUnknownBatch() {}, async releaseUnknown() {}, async clearUnknownFailure() {},
    async markFailed(_run, page, unknown) { page.forEach(call => { call.status = unknown ? 'unknown' : 'failed'; }); },
    async persistRaw(_run, call, raw) { call.raw_body = raw; },
    async persistRawPage(_run, page) { events.push(`raw:${page.length}`); page.forEach(row => { row.call.raw_body = row.raw; }); },
    async settle(_run, call) { call.status = 'settled'; },
    async settlePage(_run, page) { events.push(`settle:${page.length}`); page.forEach(row => { assert.ok(row.call.raw_body); row.call.status = 'settled'; }); },
    async apply(_run, page) { events.push(`apply:${page.length}`); page.forEach(row => { results.push(...row.results); row.call.results_applied = true; }); },
    async finish() { return calls.some(call => call.status === 'unknown') ? 'failed' : 'completed'; }
  };
  let transports = 0;
  const provider: JevProviderV1 = { async evaluate(request) {
    transports++; const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => [key, question.type === 'noul'
      ? { type: 'noul', noul: key === 'spam_or_bot' ? 0.1 : 0.9 }
      : { type: 'choice', choice: Object.keys(question.criteria)[0], confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map((option, i) => [option, i === 0 ? 1 : 0])) }]));
    return { body: JSON.stringify({ model: request.model, answers, usage: { input_tokens: 100, output_tokens: 10 } }), http_status: 200, latency_ms: 5 };
  } };
  return { run, calls, results, events, store, provider, transports: () => transports };
}
test('200 roots reserve, persist, settle and write by page, then replay sends nothing', async () => {
  const f = fixture(200);
  const result = await processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider: f.provider });
  assert.equal(result.status, 'completed'); assert.equal(f.results.length, 200); assert.equal(f.transports(), 200);
  assert.deepEqual(f.events, ['claim', 'reserve:200', 'submitting:200', 'raw:200', 'settle:200', 'apply:200', 'release']);
  assert.equal(result.p50_ms, 5); assert.equal(result.p95_ms, 5); assert.equal(result.unresolved_billing_requests, 0);
  await processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider: f.provider }); assert.equal(f.transports(), 200);
});
test('uncertain transport keeps billing reservation and root error, never unrelated or resubmitted', async () => {
  const f = fixture(1); let sent = 0;
  const provider: JevProviderV1 = { async evaluate() { sent++; throw new JevProviderErrorV1('jev_transport_unknown', 'outcome_unknown'); } };
  const result = await processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider });
  assert.equal(result.status, 'failed'); assert.equal(result.unresolved_billing_requests, 1);
  assert.equal(f.calls[0]?.status, 'unknown'); assert.equal(f.results[0]?.status, 'error'); assert.equal(f.results[0]?.facets, undefined);
  await processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider }); assert.equal(sent, 1);
});
test('raw persistence failure prevents parsing/settling; recovery reads raw without transport', async () => {
  const f = fixture(1); const persist = f.store.persistRawPage;
  f.store.persistRawPage = async (_run, page) => { await persist(_run, page); throw new Error('storage interruption'); };
  await assert.rejects(processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider: f.provider }));
  assert.equal(f.results.length, 0); assert.equal(f.calls[0]?.status, 'submitting');
  f.store.persistRawPage = persist; f.calls[0]!.status = 'unknown';
  await processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider: f.provider });
  assert.equal(f.transports(), 1); assert.equal(f.calls[0]?.status, 'settled'); assert.equal(f.results[0]?.status, 'labeled');
});
test('known invalid response settles observed usage before recording root error', async () => {
  const f = fixture(1);
  const provider: JevProviderV1 = { async evaluate() { return { body: JSON.stringify({ model: 'jev-1.13.0', usage: { input_tokens: 150, output_tokens: 0 }, answers: {} }), http_status: 200, latency_ms: 1 }; } };
  const result = await processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider });
  assert.equal(f.calls[0]?.status, 'settled'); assert.equal(f.results[0]?.status, 'error'); assert.ok(result.settled_micro_usd! > 0);
});
test('lease loss stops queued sends, persists in-flight raw, and never applies under the lost lease', async () => {
  const f = fixture(2); let attempted = 0;
  f.store.renew = async () => { throw new Error('labeling_lease_lost'); };
  const provider: JevProviderV1 = { async evaluate(request, cancellation) {
    attempted++;
    if (attempted === 1) { await new Promise(resolve => setTimeout(resolve, 20)); return f.provider.evaluate(request); }
    return await new Promise((_resolve, reject) => cancellation!.signal!.addEventListener('abort', () => reject(new JevProviderErrorV1('jev_send_canceled', 'definitely_not_sent')), { once: true }));
  } };
  await assert.rejects(processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider, lease_renewal_ms: 5 }), /labeling_lease_lost/u);
  assert.equal(f.results.length, 0); assert.ok(f.calls[0]?.raw_body); assert.equal(f.calls[1]?.status, 'failed');
  assert.ok(!f.events.some(event => event.startsWith('settle:') || event.startsWith('apply:')));
});
test('a failed authority run reconciles stored raw without selecting or sending new work', async () => {
  const f = fixture(1);
  await processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider: f.provider });
  f.calls[0]!.results_applied = false; f.calls[0]!.status = 'unknown'; f.results.length = 0;
  f.run.error_code = 'labeling_policy_changed';
  f.store.inputs = async () => { throw new Error('new input selection forbidden'); };
  f.store.markSubmitting = async () => { throw new Error('new send forbidden'); };
  await processMentionFacetsJevV1({ run_id: f.run.id, store: f.store, provider: f.provider });
  assert.equal(f.transports(), 1); assert.equal(f.calls[0]?.status, 'settled'); assert.equal(f.results.length, 1);
});
