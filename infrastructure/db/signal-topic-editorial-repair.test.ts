import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { buildSignalTopicEditorialScreeningPlanV1, buildSignalTopicEditorialGlobalReviewV1,
  buildSignalTopicEditorialRepairRequestV1, validateSignalTopicEditorialScreeningCoverageV1, validateSignalTopicEditorialScreeningOutputV1,
  signalTopicEditorialDigestV1 as digest, type SignalTopicEditorialRunnerProviderRequestV1 } from '@noisia/query-engine';
import { bindSignalTopicEditorialRepairRequestV1, type SignalTopicEditorialLeaseV1 } from './signal-topic-consolidation-editorial';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const lease: SignalTopicEditorialLeaseV1 = { execution_id: id(1), execution_token: id(2), workspace_id: id(3), actor_user_id: id(4),
  numeric_run_id: id(5), source_execution_id: id(6), worker_job_id: 'topic-editorial-fixture' };
function fixture(phase: 'screening' | 'global' = 'screening') {
  const context = { brand_name: 'Synthetic', default_locale: 'es-MX', summary: 'Asistencia', audiences: [], categories: [], competitors: [],
    positive_anchors: [], negative_anchors: [], abstention_anchors: [] };
  const text = 'Rutinas', coords = { root_id: id(10), chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text) };
  const evidence = [{ ...coords, ref_id: digest(coords), text, locale: 'es-MX', platform: null, occurred_at: null }];
  const metadata = { scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 }, locale_counts: [{ key: 'es-MX', count: 1 }],
    platform_counts: [], month_counts: [], brand_affinity: { positive: [], negative: [], abstention: [] }, neighbors: [], metrics: { cohesion: .8125, outlier_ratio: .125 } };
  const dossier = { contract_version: 'signal-topic-group-dossier-v1', ...metadata, evidence: evidence.map(({ text: _text, ...rest }) => rest) };
  const groups = [{ group_key: 'open:cluster-0', lane: 'open' as const, group_digest: digest('group'), source_dossier_digest: digest(dossier), dossier_digest: digest(dossier),
    community_key: 'community-a', root_count: 1, chunk_count: 1, terms: ['rutinas'], ...metadata, evidence }];
  const plan = buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: 1, source_context_digest: digest('context'),
    editorial_context_digest: digest(context), context, groups }), batch = plan.batches[0]!;
  const valid = { contract_version: 'signal-topic-editorial-screening-output-v1', batch_index: 0,
    decisions: [{ group_key: groups[0]!.group_key, disposition: 'topic', candidate: { candidate_key: 'b0000-rutinas', label: 'Rutinas', definition: 'Rutinas por voz.', locale: 'es-MX' },
      confidence: .8, rationale: null, cited_ref_ids: [evidence[0]!.ref_id] }] };
  const screening = validateSignalTopicEditorialScreeningCoverageV1(plan, [validateSignalTopicEditorialScreeningOutputV1(batch, valid)]);
  const review = buildSignalTopicEditorialGlobalReviewV1({ plan, screening, groups });
  const requestBody = phase === 'screening' ? batch.request_body : review.request_body;
  const requestDigest = phase === 'screening' ? batch.request_digest : review.request_digest;
  const original: SignalTopicEditorialRunnerProviderRequestV1 = { contract_version: 'signal-topic-editorial-provider-request-v1', phase, model: plan.model,
    idempotency_key: phase === 'screening' ? batch.batch_key : `topic-consolidation-global-v1:${review.request_digest.slice(7, 23)}`,
    request_digest: requestDigest, request_body: requestBody };
  const invalid = phase === 'screening' ? { ...valid, decisions: valid.decisions.map(item => ({ ...item, cited_ref_ids: [digest('foreign')] })) }
    : { contract_version: 'signal-topic-editorial-global-result-v1', concepts: [], noise_group_keys: [], unresolved_group_keys: [] };
  const errorCode = phase === 'screening' ? 'topic_editorial_output_citation_invalid' : 'topic_editorial_global_coverage_invalid';
  const request = buildSignalTopicEditorialRepairRequestV1({ original, response: invalid, error_code: errorCode });
  const parent = { id: id(11), phase, batch_index: 0, request_digest: requestDigest, request_body: requestBody,
    configuration: phase === 'screening' ? batch.configuration : review.configuration,
    receipts: phase === 'screening' ? batch.group_receipts : review.eligible_group_receipts,
    parent_request_id: null as string | null, response_output: invalid as unknown, response_http_status: 200, response_complete: true };
  let count = 1, failLease = false;
  const children: Array<{ request_digest: string; request_body: string; repair_binding: unknown; repair_parent_output_body: string }> = [];
  const trace: string[] = [], inserts: unknown[][] = [];
  const db = { connect: async () => ({ query: async (sql: string, params: unknown[] = []) => {
    trace.push(sql);
    if (sql.startsWith('SELECT plan,state_body')) return { rows: [{ plan, state_body: JSON.stringify({ screening_outputs: [validateSignalTopicEditorialScreeningOutputV1(batch, valid)] }), state_digest: null }] };
    if (sql.startsWith('SELECT plan_digest,state_body')) { if(failLease)throw Error('topic_editorial_lease_conflict');return {rows:[{plan_digest:plan.plan_digest,state_body:JSON.stringify({screening_outputs:[validateSignalTopicEditorialScreeningOutputV1(batch, valid)]}),state_digest:null}]}; }
    if (sql.includes('assert_lease_v1') && failLease) throw Error('topic_editorial_lease_conflict');
    if (sql.includes('SELECT p.id,p.phase')) { assert.deepEqual(params, [lease.execution_id, lease.workspace_id, original.request_digest]); return { rows: Array.from({ length: count }, () => parent) }; }
    if (sql.startsWith('SELECT request_digest,request_body,repair_binding')) return { rows: children };
    if (sql.startsWith('INSERT INTO signal_topic_editorial_requests')) {
      inserts.push(params);
      children.push({ request_digest: String(params[4]), request_body: String(params[5]), repair_binding: JSON.parse(String(params[10])), repair_parent_output_body: String(params[11]) });
    }
    return { rows: [] };
  }, release: () => trace.push('release') } as unknown as PoolClient) };
  return { args: { database: db, lease, request }, parent, original, invalid, valid, children, inserts, trace,
    noPaid: () => { count = 0; }, ambiguous: () => { count = 2; }, expire: () => { failLease = true; } };
}
for (const phase of ['screening', 'global'] as const) test(`${phase}: binds one exact paid-parent repair, persists before returning and replays without another child`, async () => {
  const f = fixture(phase), result = await bindSignalTopicEditorialRepairRequestV1(f.args);
  assert.deepEqual(result, f.args.request); assert.equal(f.inserts.length, 1);
  assert.equal(f.inserts[0]![2], phase); assert.equal(f.inserts[0]![9], f.parent.id);
  assert.equal(sha(String(f.inserts[0]![11])), f.args.request.repair.parent_response_digest);
  assert.equal(f.inserts[0]![8], String(Buffer.byteLength(result.request_body) * 3 + f.parent.configuration.max_output_tokens * 15));
  assert.deepEqual(f.trace.slice(-2), ['COMMIT', 'release']);
  assert.deepEqual(await bindSignalTopicEditorialRepairRequestV1(f.args), result); assert.equal(f.inserts.length, 1);
  assert.doesNotMatch(f.trace.join('\n'), /reserve_|mark_sent_|source_v1/u);
});
test('repair rejects unpaid, ambiguous, incomplete, foreign and recursively repaired parents', async () => {
  for (const mode of ['unpaid', 'ambiguous', 'partial', 'http', 'recursive', 'body', 'output', 'expired']) {
    const f = fixture();
    if (mode === 'unpaid') f.noPaid(); if (mode === 'ambiguous') f.ambiguous(); if (mode === 'partial') f.parent.response_complete = false;
    if (mode === 'http') f.parent.response_http_status = 500; if (mode === 'recursive') f.parent.parent_request_id = id(12);
    if (mode === 'body') f.parent.request_body += ' '; if (mode === 'output') f.parent.response_output = f.valid; if (mode === 'expired') f.expire();
    await assert.rejects(bindSignalTopicEditorialRepairRequestV1(f.args), /repair_parent_invalid|repair_response_invalid|lease_conflict/u);
    assert.equal(f.inserts.length, 0); assert.deepEqual(f.trace.slice(-2), ['ROLLBACK', 'release']);
  }
});
test('caller cannot invent a semantic failure or repair a valid response', async () => {
  const f = fixture();
  const forged = buildSignalTopicEditorialRepairRequestV1({ original: f.original, response: f.invalid, error_code: 'topic_editorial_output_locale_invalid' });
  await assert.rejects(bindSignalTopicEditorialRepairRequestV1({ ...f.args, request: forged }), /repair_error_unproven/u);
  f.parent.response_output = f.valid;
  const validParent = buildSignalTopicEditorialRepairRequestV1({ original: f.original, response: f.valid, error_code: 'topic_editorial_output_citation_invalid' });
  await assert.rejects(bindSignalTopicEditorialRepairRequestV1({ ...f.args, request: validParent }), /repair_error_unproven/u);
  assert.equal(f.inserts.length, 0);
});
test('conflicting repair identity cannot replace an existing child', async () => {
  const f = fixture(); await bindSignalTopicEditorialRepairRequestV1(f.args);
  f.children[0]!.request_digest = digest('conflicting-child');
  await assert.rejects(bindSignalTopicEditorialRepairRequestV1(f.args), /repair_replay_conflict/u);
  assert.equal(f.inserts.length, 1);
});
test('SQL keeps one original slot and one paid child, with checkpoints accepting only linked settled evidence', () => {
  const sql = readFileSync(new URL('./migrations/0178_signal_topic_editorial_catalog_contract.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX topic_editorial_original_request_slot/u);
  assert.match(sql, /CREATE UNIQUE INDEX topic_editorial_one_repair_per_parent/u);
  assert.match(sql, /parent.parent_request_id IS NOT NULL/u);
  assert.match(sql, /c.response_http_status=200 AND c.response_complete=true AND c.response_output=NEW.repair_parent_output_body::jsonb/u);
  assert.match(sql, /parent_response_digest' IS DISTINCT FROM signal_semantic_context_digest_v1\(NEW.repair_parent_output_body\)/u);
  assert.match(sql, /paid_lineage AS MATERIALIZED/u);
  assert.match(sql, /child.parent_request_id=parent.id/u);
  assert.match(sql, /JOIN signal_topic_editorial_calls c ON c.request_id=lineage.request_id/u);
  assert.match(sql, /q.parent_request_id IS NULL/u);
  assert.match(sql, /q.request_digest=body->'global'->>'request_digest'/u);
  const guard = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION signal_topic_editorial_state_guard_v1'), sql.indexOf('CREATE OR REPLACE FUNCTION signal_topic_editorial_admission_complete_v1'));
  assert.doesNotMatch(guard, /\bLOOP\b/u);
  assert.match(guard, /LEFT JOIN previous p USING\(batch_index\) WHERE p.batch_index IS NULL/u);
  assert.match(sql, /IF expected_hash IS DISTINCT FROM NEW.request_digest/u);
});
