import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { buildSignalTopicEditorialScreeningPlanV1, signalTopicEditorialDigestV1 as digest } from '@noisia/query-engine';
import { loadSignalTopicEditorialOwnerInputV1, type SignalTopicEditorialLeaseV1 } from './signal-topic-consolidation-editorial';
import { persistSignalTopicEditorialReceiptV1, readSignalTopicEditorialRecoveryV1 } from './signal-topic-editorial-runtime';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (text: Uint8Array | string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const lease: SignalTopicEditorialLeaseV1 = { execution_id: id(1), execution_token: id(2), workspace_id: id(3), actor_user_id: id(4),
  numeric_run_id: id(5), source_execution_id: id(6), worker_job_id: 'topic-editorial-fixture' };
const body = '{"model":"claude-sonnet-4-6","content":[],"usage":{"input_tokens":10,"output_tokens":2}}';
const requestDigest = digest('request');
const call = () => ({ call_id: id(7), attempt_token: id(8), retry_of_call_id: null as string | null,
  request_digest: requestDigest, request_body: 'sealed request', status: 'settled', reserved_micro_usd: '100', settled_micro_usd: '60' as string | null,
  response_body_private: body as string | null, response_sha256: sha(body) as string | null, response_storage_key: 'private/receipt' as string | null,
  response_http_status: 200 as number | null, response_complete: true as boolean | null, response_provider_request_id: 'req_valid' as string | null });
function database(rows = [call()]) {
  const trace: string[] = []; let denied = false, failPersist = false;
  const client = { query: async (sql: string, params: unknown[] = []) => {
    trace.push(sql);
    if (sql.startsWith('SELECT id FROM signal_topic_editorial_executions')) {
      assert.deepEqual(params, [lease.execution_id, lease.workspace_id, lease.actor_user_id, lease.numeric_run_id, lease.source_execution_id]);
      return { rows: denied ? [] : [{ id: lease.execution_id }] };
    }
    if (sql.includes('ORDER BY c.reserved_at,c.id')) { assert.deepEqual(params, [lease.execution_id, lease.workspace_id, requestDigest]); return { rows }; }
    if (sql.startsWith('SELECT r.phase')) return { rows: [{ phase: 'screening', batch_index: 0, request_digest: requestDigest }] };
    if (sql.includes('persist_signal_topic_editorial_receipt_v1')) {
      if (failPersist) throw Error('topic_editorial_response_immutable');
      assert.deepEqual(params, [id(7), id(8), requestDigest, body, 'private/receipt', 200, true, 'req_valid']);
    }
    return { rows: [] };
  }, release: () => trace.push('release') } as unknown as PoolClient;
  return { database: { connect: async () => client }, trace, deny: () => { denied = true; }, conflict: () => { failPersist = true; } };
}
test('recovery returns durable HTTP facts and settled bytes without consulting live context or reserving', async () => {
  const f = database(), result = await readSignalTopicEditorialRecoveryV1({ database: f.database, lease, request_digest: requestDigest });
  assert.deepEqual(result?.response, { body, sha256: sha(body), storage_key: 'private/receipt', http_status: 200, complete: true, provider_request_id: 'req_valid' });
  assert.equal(result?.settled_micro_usd, '60'); assert.deepEqual(f.trace.slice(-2), ['COMMIT', 'release']);
  assert.ok(f.trace.some(sql => sql.includes('assert_lease_v1')));
  assert.doesNotMatch(f.trace.join('\n'), /reserve_|mark_sent_|semantic_context|source_v1/u);
});
test('recovery permits a single exact retry chain and rejects ambiguous or damaged history', async () => {
  const first = { ...call(), status: 'definitely_not_sent', settled_micro_usd: null, response_body_private: null,
    response_sha256: null, response_storage_key: null, response_http_status: null, response_complete: null, response_provider_request_id: null };
  const second = { ...call(), call_id: id(9), retry_of_call_id: first.call_id };
  const valid = database([first, second]);
  assert.equal((await readSignalTopicEditorialRecoveryV1({ database: valid.database, lease, request_digest: requestDigest }))?.call_id, id(9));
  for (const rows of [[call(), second], [first, { ...second, retry_of_call_id: null }], [{ ...call(), response_complete: null }],
    [{ ...call(), response_sha256: digest('wrong') }], [{ ...call(), response_body_private: null }], [{ ...call(), settled_micro_usd: '101' }]]) {
    const f = database(rows);
    await assert.rejects(readSignalTopicEditorialRecoveryV1({ database: f.database, lease, request_digest: requestDigest }), /recovery_/u);
    assert.deepEqual(f.trace.slice(-2), ['ROLLBACK', 'release']);
  }
});
test('unknown calls remain visible without inventing HTTP success; missing requests return null', async () => {
  const uncertain = { ...call(), status: 'outcome_unknown', settled_micro_usd: null, response_body_private: null,
    response_sha256: null, response_storage_key: null, response_http_status: null, response_complete: null, response_provider_request_id: null };
  const f = database([uncertain]), result = await readSignalTopicEditorialRecoveryV1({ database: f.database, lease, request_digest: requestDigest });
  assert.equal(result?.status, 'outcome_unknown'); assert.equal(result.response, null);
  assert.equal(await readSignalTopicEditorialRecoveryV1({ database: database([]).database, lease, request_digest: requestDigest }), null);
});
test('receipt persistence releases the connection and survives lease loss; invalid bytes never enter DB', async () => {
  const f = database(), args = { database: f.database, lease, call_id: id(7), attempt_token: id(8), storage_key: 'private/receipt',
    receipt: { request_digest: requestDigest, idempotency_key: 'sealed-key', bytes: new TextEncoder().encode(body), sha256: sha(body),
      http_status: 200, complete: true, provider_request_id: 'req_valid' } };
  await persistSignalTopicEditorialReceiptV1(args); assert.deepEqual(f.trace.slice(-2), ['COMMIT', 'release']);
  assert.doesNotMatch(f.trace.join('\n'), /assert_lease|reserve_|source_v1/u);
  f.conflict(); await assert.rejects(persistSignalTopicEditorialReceiptV1(args), /response_immutable/u);
  assert.deepEqual(f.trace.slice(-2), ['ROLLBACK', 'release']);
  const before = f.trace.length;
  await assert.rejects(persistSignalTopicEditorialReceiptV1({ ...args, receipt: { ...args.receipt, sha256: digest('wrong') } }), /receipt_invalid/u);
  const invalid = new Uint8Array([0xff]);
  await assert.rejects(persistSignalTopicEditorialReceiptV1({ ...args, receipt: { ...args.receipt, bytes: invalid, sha256: sha(invalid) } }), /encoding_invalid/u);
  assert.equal(f.trace.length, before);
});
test('foreign owner is rejected before recovery or received-receipt mutation', async () => {
  const f = database(); f.deny();
  await assert.rejects(readSignalTopicEditorialRecoveryV1({ database: f.database, lease, request_digest: requestDigest }), /lease_conflict/u);
  assert.doesNotMatch(f.trace.join('\n'), /ORDER BY c.reserved_at/u);
});
test('owner input recovers the sealed plan without current Brand OS and rejects changed source/plan seals', async () => {
  const context = { brand_name: 'Synthetic', default_locale: 'es-MX', summary: 'Contexto', audiences: [], categories: [], competitors: [],
    positive_anchors: [], negative_anchors: [], abstention_anchors: [] };
  const text = 'Rutinas', coords = { root_id: id(10), chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text) };
  const evidence = [{ ...coords, ref_id: digest(coords), text, locale: 'es-MX', platform: null, occurred_at: null }];
  const metadata = { scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 }, locale_counts: [{ key: 'es-MX', count: 1 }],
    platform_counts: [], month_counts: [], brand_affinity: { positive: [], negative: [], abstention: [] }, neighbors: [], metrics: { cohesion: .8125, outlier_ratio: .125 } };
  const dossier = { contract_version: 'signal-topic-group-dossier-v1', ...metadata, evidence: evidence.map(({ text: _text, ...rest }) => rest) };
  const plan = buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: 1, source_context_digest: digest('context'), editorial_context_digest: digest(context),
    context, groups: [{ group_key: 'open:cluster-0', lane: 'open', group_digest: digest('group'), source_dossier_digest: digest(dossier), dossier_digest: digest(dossier),
      community_key: 'community-a', root_count: 1, chunk_count: 1, terms: ['rutinas'], ...metadata, evidence }] });
  assert.equal(typeof plan.batches[0]!.source_groups_body, 'string');
  assert.equal(JSON.parse(plan.batches[0]!.source_groups_body)[0].metrics.cohesion, .8125);
  const binding = { workspace_id: lease.workspace_id, numeric_run_id: lease.numeric_run_id,
    source_engine_execution_id: lease.source_execution_id, context_digest: plan.source_context_digest };
  const seal = { plan_digest: plan.plan_digest, source_binding: binding, source_digest: digest(binding) }, trace: string[] = [];
  const db = { connect: async () => ({ query: async (sql: string, params: unknown[]) => {
    trace.push(sql);
    if (sql.startsWith('SELECT plan,state_body')) { assert.equal(params[4], lease.source_execution_id); return { rows: [{ plan, state_body: null, state_digest: null }] }; }
    if (sql.startsWith('SELECT plan_digest')) return { rows: [seal] };
    return { rows: [] };
  }, release: () => trace.push('release') } as unknown as PoolClient) };
  assert.deepEqual((await loadSignalTopicEditorialOwnerInputV1({ database: db, lease })).plan, plan);
  assert.doesNotMatch(trace.join('\n'), /semantic_context|source_v1/u);
  seal.source_digest = digest('other');
  await assert.rejects(loadSignalTopicEditorialOwnerInputV1({ database: db, lease }), /owner_snapshot_invalid/u);
  assert.deepEqual(trace.slice(-2), ['ROLLBACK', 'release']);
});
test('0178 preserves source dossiers, exact evidence subsets, dynamic caps, immutable HTTP metadata and private ACLs', () => {
  const sql = readFileSync(new URL('./migrations/0178_signal_topic_editorial_catalog_contract.sql', import.meta.url), 'utf8');
  const validator = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION signal_topic_editorial_plan_valid_v1'), sql.indexOf('CREATE OR REPLACE FUNCTION request_signal_topic_editorial_v1'));
  assert.doesNotMatch(validator, /\b(?:LOOP|CREATE|ALTER|INSERT|UPDATE|DELETE)\b(?!(?: OR REPLACE FUNCTION))/u);
  assert.match(validator, /receipts AS MATERIALIZED/u);
  assert.match(validator, /original_evidence AS MATERIALIZED/u);
  assert.match(sql, /p\.dossier_digest IS DISTINCT FROM p\.receipt->>'source_dossier_digest'/u);
  assert.match(sql, /\(b\.value->>'source_groups_body'\)::jsonb AS source_groups/u);
  assert.doesNotMatch(sql, /dossier_digest' IS DISTINCT FROM (?:signal_semantic_context_digest_json_v2|signal_topic_editorial_digest_json_v1)/u);
  assert.match(sql, /jsonb_array_length\(p\.receipt->'evidence_ref_ids'\) NOT BETWEEN 1 AND 10/u);
  assert.match(sql, /e\.dossier->'evidence' @> jsonb_build_array\(e\.item-'text'\)/u);
  assert.match(sql, /signal_semantic_context_digest_v1\(e\.item->>'text'\)/u);
  assert.match(sql, /\(b->'configuration'->>'max_output_tokens'\)::bigint\*15/u);
  assert.doesNotMatch(sql, /\+16384\*15/u);
  assert.match(sql, /NEW.response_http_status,NEW.response_complete,NEW.response_provider_request_id/u);
  assert.match(sql, /topic_editorial_http_metadata_required/u);
  assert.match(sql, /http_status=200 AND complete AND/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION persist_signal_topic_editorial_receipt_v1.*FROM PUBLIC/u);
  assert.match(sql, /ARRAY\['anon','authenticated'\]/u);
});
