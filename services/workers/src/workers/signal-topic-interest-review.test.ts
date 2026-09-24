import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildSignalTopicEditorialScreeningPlanV1, buildSignalTopicInterestReviewV1,
  createSignalTopicInterestReviewOutputValidatorV1, signalTopicDefinitionDigestV1,
  signalTopicEditorialDigestV1 as digest, type SignalTopicDefinitionV1 } from '@noisia/query-engine';
import type { SignalTopicEditorialLeaseV1 } from '@noisia/db';
import { createAnthropicSignalTopicEditorialRunnerProviderV1 } from '../providers/signal-topic-editorial';
import { createSignalTopicEditorialLedgerV1, type SignalTopicEditorialLedgerStoresV1,
  type SignalTopicEditorialRecoveredCallV1 } from './signal-topic-editorial-ledger';
import { runSignalTopicInterestReviewV1, type SignalTopicInterestReviewCheckpointV1 } from './signal-topic-interest-review';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
function fixture(count = 1) {
  const text = 'Rutinas de voz en el hogar', coords = { root_id: id(1), chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text) };
  const evidence = [{ ...coords, ref_id: digest(coords), text, locale: 'es-MX', platform: null, occurred_at: null }];
  const details = { scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 }, locale_counts: [], platform_counts: [],
    month_counts: [], brand_affinity: { positive: [], negative: [], abstention: [] }, neighbors: [], metrics: { cohesion: null, outlier_ratio: null } };
  const dossier = { contract_version: 'signal-topic-group-dossier-v1', ...details, evidence: evidence.map(({ text: _text, ...rest }) => rest) };
  const group = { group_key: 'open:group-1', lane: 'open' as const, group_digest: digest('group'), source_dossier_digest: digest(dossier),
    dossier_digest: digest(dossier), community_key: 'community-1', root_count: 1, chunk_count: 1, terms: ['voz'], ...details, evidence };
  const context = { brand_name: 'Synthetic', default_locale: 'es-MX', summary: 'Asistente de voz.', audiences: [], categories: [], competitors: [],
    positive_anchors: [], negative_anchors: [], abstention_anchors: [] };
  const plan = buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: 1, source_context_digest: digest('context'),
    editorial_context_digest: digest(context), context, groups: [group] });
  const definitions = Array.from({ length: count }, (_, n) => {
    const value: SignalTopicDefinitionV1 = { term_key: `interest_${n}`, label: `Interés ${n}`, definition: 'Rutinas de voz domésticas.',
      scope: 'primary_brand', inclusion: [], exclusion: ['Gimnasio'], positive_examples: [], negative_examples: [],
      lifecycle: 'draft', origin: 'manual', source: null, definition_revision: 1, definition_digest: digest('temporary'),
      created_at: '2026-09-24T00:00:00.000Z', updated_at: '2026-09-24T00:00:00.000Z' };
    return { ...value, definition_digest: signalTopicDefinitionDigestV1(value) };
  });
  return buildSignalTopicInterestReviewV1({ workspace_id: id(10), taxonomy_profile_id: id(11), definitions, screening_plan: plan });
}
function harness(count = 1) {
  const review = fixture(count), execution_key = 'interest-local-test', validator = createSignalTopicInterestReviewOutputValidatorV1(review);
  const admitted = new Map(review.batches.map((_, batch_index) => { const r = validator.buildRequest({ batch_index, execution_key }); return [r.request_digest, r]; }));
  const calls = new Map<string, SignalTopicEditorialRecoveredCallV1>();
  const historical: SignalTopicEditorialRecoveredCallV1 = { call_id: id(900), attempt_token: id(901), request_body: 'historical-screening',
    request_digest: digest('historical'), settled_micro_usd: '1700', reserved_micro_usd: '1800', status: 'settled', response: null };
  let cap = 5000;
  let state: SignalTopicInterestReviewCheckpointV1 | null = null, sends = 0, settled = 0, current = true, authority = true;
  let lostReceiptAck = false, lostCheckpointAck = false, lostResponse = false, expireAfterResponse = false;
  const lease: SignalTopicEditorialLeaseV1 = { workspace_id: id(10), execution_id: id(12), execution_token: id(13),
    actor_user_id: id(14), numeric_run_id: id(15), source_execution_id: id(16), worker_job_id: execution_key };
  const store = {
    load: async () => structuredClone(state),
    save: async (args: { expected_state_digest: string | null; state: SignalTopicInterestReviewCheckpointV1 }) => {
      assert.equal(args.expected_state_digest, state?.state_digest ?? null, 'checkpoint compare-and-swap');
      state = structuredClone(args.state);
      if (lostCheckpointAck && state.outputs.length) { lostCheckpointAck = false; throw Error('checkpoint_ack_lost'); }
    }
  };
  const stores: SignalTopicEditorialLedgerStoresV1 = {
    readRecovery: async ({ request_digest }) => structuredClone(calls.get(request_digest) ?? null),
    reserve: async ({ request_digest }) => {
      if (!authority || !current) throw Error('processing_permission_expired');
      const request = admitted.get(request_digest); assert.ok(request, 'only exact admitted request');
      const prior = calls.get(request_digest);
      if (prior) return { ...prior };
      const committed = [...calls.values()].filter(row => admitted.has(row.request_digest))
        .reduce((sum, row) => sum + Number(row.settled_micro_usd ?? row.reserved_micro_usd), 0);
      if (committed + 800 > cap) throw Error('processing_budget_exhausted');
      const call: SignalTopicEditorialRecoveredCallV1 = { call_id: id(100 + calls.size), attempt_token: id(200 + calls.size), request_digest,
        request_body: request.request_body, status: 'reserved', reserved_micro_usd: '800', settled_micro_usd: null, response: null };
      calls.set(request_digest, call); return { ...call };
    },
    markSent: async ({ call_id }) => {
      if (!authority || !current) return false;
      const call = [...calls.values()].find(row => row.call_id === call_id)!;
      if (call.status !== 'reserved') return false; call.status = 'in_flight'; return true;
    },
    persistReceipt: async ({ call_id, receipt, storage_key }) => {
      const call = [...calls.values()].find(row => row.call_id === call_id)!;
      call.response = { body: new TextDecoder().decode(receipt.bytes), sha256: receipt.sha256, storage_key,
        http_status: receipt.http_status, complete: receipt.complete, provider_request_id: receipt.provider_request_id };
      call.status = 'response_persisted';
      if (lostReceiptAck) { lostReceiptAck = false; throw Error('receipt_ack_lost'); }
    },
    settle: async ({ call_id }) => {
      const call = [...calls.values()].find(row => row.call_id === call_id)!;
      assert.ok(call.response); const replayed = call.status === 'settled';
      if (!replayed) settled += 600;
      call.status = 'settled'; call.settled_micro_usd = '600'; return { status: 'settled', settled_micro_usd: '600', replayed };
    },
    failCall: async () => 'outcome_unknown'
  };
  const restart = () => {
    const { ledger } = createSignalTopicEditorialLedgerV1({ database: { connect: async () => { throw Error('no database'); } } as never,
      lease, stores, provider_enabled: true, assertLease: () => {}, storeRawReceipt: async () => 'synthetic-receipt' });
    return createAnthropicSignalTopicEditorialRunnerProviderV1({ ledger, provider_enabled: true, api_key: 'synthetic_test_key_only', fetch_impl: async (_url, init) => {
      sends++; if (lostResponse) throw Error('network_lost');
      const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[0].content);
      const output = { contract_version: 'signal-topic-interest-review-output-v1', workspace_id: review.manifest.workspace_id,
        taxonomy_profile_id: review.manifest.taxonomy_profile_id, input_digest: review.input_digest, batch_index: payload.batch_index,
        decisions: review.batches[payload.batch_index]!.pairs.map(pair => ({ ...pair, disposition: 'supports',
          cited_ref_ids: [review.manifest.groups[0]!.evidence_ref_ids[0]], rationale: 'La cita describe rutinas de voz.', requires_additional_evidence: false })) };
      if (expireAfterResponse) current = false;
      return Response.json({ type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(output) }], usage: { input_tokens: 100, output_tokens: 20 } });
    } });
  };
  const run = (max_batches?: number) => runSignalTopicInterestReviewV1({ execution_key, review, store, provider: restart(), max_batches,
    assertCurrent: async args => { assert.equal(args.review_digest, review.review_digest); if (!current) throw Error('input_changed'); } });
  return { review, run, store, restart, calls, historical, stats: () => ({ sends, settled, state: structuredClone(state) }),
    seedHistorical: () => calls.set(historical.request_digest, structuredClone(historical)),
    configure: (options: { cap?: number; receiptAck?: boolean; checkpointAck?: boolean; responseLost?: boolean; expired?: boolean; change?: boolean; changeAfterResponse?: boolean }) => {
      cap = options.cap ?? cap;
      lostReceiptAck = options.receiptAck ?? false; lostCheckpointAck = options.checkpointAck ?? false; lostResponse = options.responseLost ?? false;
      authority = !options.expired; current = !options.change; expireAfterResponse = options.changeAfterResponse ?? false;
    } };
}

test('composes existing transport/ledger across bounded checkpoints without changing historical receipts', async () => {
  const f = harness(21); f.seedHistorical(); const historical = JSON.stringify(f.calls.get(f.historical.request_digest));
  const first = await f.run(1); assert.equal(first.status, 'pending'); assert.equal(f.stats().sends, 1);
  const completed = await f.run(1); assert.equal(completed.status, 'completed'); assert.equal(f.stats().sends, 2);
  assert.equal(f.stats().settled, 1200); assert.equal(JSON.stringify(f.calls.get(f.historical.request_digest)), historical);
  assert.equal((await f.run()).status, 'completed'); assert.equal(f.stats().sends, 2);
  if (completed.status === 'completed') assert.equal(completed.result.membership_effect, 'none');
});
test('persisted receipt with lost acknowledgement settles on restart without a second transport', async () => {
  const f = harness(); f.configure({ receiptAck: true }); await assert.rejects(f.run(), /receipt_persistence_unknown/);
  assert.equal(f.stats().settled, 0); assert.equal([...f.calls.values()][0]!.status, 'response_persisted');
  assert.equal((await f.run()).status, 'completed'); assert.equal(f.stats().sends, 1); assert.equal(f.stats().settled, 600);
});
test('lost checkpoint acknowledgement resumes its persisted state, not the paid request', async () => {
  const f = harness(); f.configure({ checkpointAck: true }); await assert.rejects(f.run(), /checkpoint_ack_lost/);
  assert.equal((await f.run()).status, 'completed'); assert.equal(f.stats().sends, 1); assert.equal(f.stats().settled, 600);
});
test('unknown transport outcome cannot be retried as another paid attempt', async () => {
  const f = harness(); f.configure({ responseLost: true }); await assert.rejects(f.run(), /transport_outcome_unknown/);
  await assert.rejects(f.run(), /ledger_read_unknown/); assert.equal(f.stats().sends, 1); assert.equal(f.stats().settled, 0);
});
test('expired permission or changed source prevents sending; paid receipt survives later source change', async () => {
  const denied = harness(); denied.configure({ expired: true }); await assert.rejects(denied.run(), /processing_permission_expired/);
  assert.equal(denied.stats().sends, 0);
  const changed = harness(); changed.configure({ change: true }); await assert.rejects(changed.run(), /input_changed/);
  assert.equal(changed.stats().state, null); assert.equal(changed.stats().sends, 0);
  const paid = harness(); paid.configure({ changeAfterResponse: true }); await assert.rejects(paid.run(), /input_changed/);
  assert.equal(paid.stats().settled, 600); assert.equal([...paid.calls.values()][0]!.status, 'settled');
  assert.deepEqual(paid.stats().state?.outputs, []); await assert.rejects(paid.run(), /input_changed/); assert.equal(paid.stats().sends, 1);
});
test('a checkpoint from another review is rejected before provider access', async () => {
  const f = harness(21); await f.run(1);
  const other = fixture(1); let attempts = 0;
  await assert.rejects(runSignalTopicInterestReviewV1({ execution_key: 'interest-local-test', review: other, store: f.store,
    provider: { complete: async () => { attempts++; throw Error('unreachable'); } }, assertCurrent: async () => {} }), /checkpoint_invalid/);
  assert.equal(attempts, 0); assert.equal(f.stats().sends, 1);
});

test('remaining budget is checked before each new batch and keeps completed progress', async () => {
  const f = harness(21); f.configure({ cap: 1000 });
  await assert.rejects(f.run(), /processing_budget_exhausted/);
  assert.equal(f.stats().sends, 1); assert.equal(f.stats().settled, 600); assert.equal(f.stats().state?.outputs.length, 1);
  await assert.rejects(f.run(), /processing_budget_exhausted/); assert.equal(f.stats().sends, 1);
});

test('mutation of caller options during an await cannot switch execution or transport', async () => {
  const review = fixture(), identity = 'original-execution'; let sends = 0;
  let state: SignalTopicInterestReviewCheckpointV1 | null = null;
  const args: Parameters<typeof runSignalTopicInterestReviewV1>[0] = { execution_key: identity, review,
    store: { load: async key => { assert.equal(key, identity); return null; }, save: async input => {
      assert.equal(input.execution_key, identity); assert.equal(input.state.execution_key, identity); state = input.state;
    } },
    provider: { complete: async request => {
      sends++; const expected = createSignalTopicInterestReviewOutputValidatorV1(review).buildRequest({ execution_key: identity, batch_index: 0 });
      assert.equal(request.idempotency_key, expected.idempotency_key);
      const payload = JSON.parse(JSON.parse(request.request_body).messages[0].content);
      return { contract_version: 'signal-topic-interest-review-output-v1', workspace_id: review.manifest.workspace_id,
        taxonomy_profile_id: review.manifest.taxonomy_profile_id, input_digest: review.input_digest, batch_index: 0,
        decisions: payload.pairs.map((pair: object) => ({ ...pair, disposition: 'insufficient', cited_ref_ids: [],
          rationale: 'Evidencia insuficiente.', requires_additional_evidence: true })) };
    } },
    assertCurrent: async actual => { assert.equal(actual.execution_key, identity); args.execution_key = 'changed-execution';
      args.store = { load: async () => { throw Error('wrong store'); }, save: async () => { throw Error('wrong store'); } };
      args.provider = { complete: async () => { throw Error('wrong provider'); } };
    }
  };
  assert.equal((await runSignalTopicInterestReviewV1(args)).status, 'completed'); assert.equal(sends, 1); assert.ok(state);
});
