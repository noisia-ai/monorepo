import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { buildSignalTopicEditorialScreeningPlanV1, signalTopicEditorialDigestV1 as digest,
 type SignalTopicEditorialRunnerStateV1, type SignalTopicEditorialScreeningGroupV1 } from '@noisia/query-engine';
import {cacheSignalTopicEditorialPlanV1} from './signal-topic-editorial-plan-cache';
import { createSignalTopicEditorialRunnerStoreV1 } from './signal-topic-consolidation-editorial';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lease = { execution_id: id(1), execution_token: id(2), workspace_id: id(3), actor_user_id: id(4), numeric_run_id: id(5), source_execution_id: id(6), worker_job_id: 'synthetic' };
function fixture(count = 1652) {
 const context = { brand_name: 'Synthetic', default_locale: 'es-MX', summary: 'Asistente del hogar', audiences: [], categories: [], competitors: [], positive_anchors: [], negative_anchors: [], abstention_anchors: [] };
 const groups: SignalTopicEditorialScreeningGroupV1[] = Array.from({ length: count }, (_, i) => {
  const text = `Rutina sintética ${i}`, coords = { root_id: id(i + 100), chunk_index: 0, start: 0, end: text.length,
   chunk_sha256: `sha256:${createHash('sha256').update(text).digest('hex')}` };
  const evidence = [{ ...coords, ref_id: digest(coords), text, locale: 'es-MX', platform: null, occurred_at: null }];
  const metadata = { scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 }, locale_counts: [{ key: 'es-MX', count: 1 }], platform_counts: [], month_counts: [],
   brand_affinity: { positive: [], negative: [], abstention: [] }, neighbors: [], metrics: { cohesion: .75, outlier_ratio: 0 } };
  const dossier = { contract_version: 'signal-topic-group-dossier-v1', ...metadata, evidence: evidence.map(({ text: _text, ...rest }) => rest) };
  return { group_key: `open:cluster-${String(i).padStart(4, '0')}`, lane: 'open', group_digest: digest(`group-${i}`),
   source_dossier_digest: digest(dossier), dossier_digest: digest(dossier), community_key: 'synthetic-community', root_count: 1, chunk_count: 1, terms: ['rutina'], ...metadata, evidence };
 });
 const plan = buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: count, source_context_digest: digest('context'), editorial_context_digest: digest(context), context, groups });
 let fullReads = 0, dossierReads = 0, ownerReads = 0, stateBody: string | null = null, stateDigest: string | null = null, durablePlanDigest = plan.plan_digest, denied = false;
 for (const batch of plan.batches) {
  const source = batch.source_groups_body;
  Object.defineProperty(batch, 'source_groups_body', { enumerable: true, get: () => { dossierReads++; return source; } });
 }
 const trace: string[] = [];
 const client = { query: async (sql: string, parameters: unknown[] = []) => {
  trace.push(sql);
  if (sql.startsWith('SELECT plan,state_body')) { fullReads++; return { rows: [{ plan, state_body: stateBody, state_digest: stateDigest }] }; }
  if (sql.startsWith('SELECT plan_digest,state_body')) {
   ownerReads++; assert.deepEqual(parameters, [lease.execution_id, lease.workspace_id, lease.actor_user_id, lease.numeric_run_id, lease.source_execution_id, lease.execution_token]);
   assert.ok(sql.includes('signal_topic_editorial_assert_lease_v1(id,$6,false)'));
   return { rows: denied ? [] : [{ plan_digest: durablePlanDigest, state_body: stateBody, state_digest: stateDigest }] };
  }
  if (sql.startsWith('UPDATE signal_topic_editorial_executions')) { stateBody = parameters[1] as string; stateDigest = parameters[2] as string; }
  return { rows: [] };
 }, release: () => trace.push('release') } as unknown as PoolClient;
 const database = { connect: async () => client };
 const store = createSignalTopicEditorialRunnerStoreV1({ database, lease });
 const state = (index: number): SignalTopicEditorialRunnerStateV1 => {
  const body = { contract_version: 'signal-topic-editorial-runner-v1' as const, execution_key: lease.execution_id, plan_digest: plan.plan_digest,
   phase: index === plan.batches.length - 1 ? 'global' as const : 'screening' as const,
   screening_outputs: plan.batches.slice(0, index + 1).map(batch => ({ contract_version: 'signal-topic-editorial-screening-output-v1' as const, batch_index: batch.batch_index,
    decisions: batch.group_keys.map(group_key => ({ group_key, disposition: 'noise' as const, candidate: null, confidence: .99, rationale: 'Fuera de contexto.', cited_ref_ids: [] })) })), global: null };
  return { ...body, state_digest: digest(body) };
 };
 return { plan, groups, database, store, state, trace, readCounts: () => ({ fullReads, dossierReads, ownerReads }), currentDigest: () => stateDigest,
  alterSeal: () => { durablePlanDigest = digest('changed'); }, deny: () => { denied = true; } };
}
test('42 saves reuse the validated immutable plan and verify each owner/digest without rereading dossiers', async t => {
 const f = fixture(); await f.store.load(lease.execution_id); const initial = f.readCounts();
 const started = performance.now();
 for (let i = 0; i < 42; i++) await f.store.save({ execution_key: lease.execution_id, expected_state_digest: f.currentDigest(), state: f.state(i) });
 const elapsed = Math.round(performance.now() - started); t.diagnostic(`42 TS saves / 1652 groups: ${elapsed} ms`);
 assert.ok(elapsed < 30_000); assert.equal(f.readCounts().fullReads, 1);
 assert.equal(f.readCounts().dossierReads, initial.dossierReads); assert.equal(f.readCounts().ownerReads, 43);
 assert.deepEqual(f.trace.slice(-2), ['COMMIT', 'release']);
});
test('standalone save validates before use; stale plan seal, owner and state CAS are rejected', async () => {
 const standalone = fixture(1);
 await standalone.store.save({ execution_key: lease.execution_id, expected_state_digest: null, state: standalone.state(0) });
 assert.equal(standalone.readCounts().fullReads, 1);
 const invalid = fixture(1); invalid.plan.batches[0]!.group_keys[0] = 'open:changed';
 await assert.rejects(invalid.store.save({ execution_key: lease.execution_id, expected_state_digest: null, state: invalid.state(0) }), /plan_invalid/u);
 assert.equal(invalid.trace.some(sql => sql.startsWith('UPDATE signal_topic_editorial_executions')), false);
 const f = fixture(41); await f.store.load(lease.execution_id);
 await assert.rejects(f.store.save({ execution_key: lease.execution_id, expected_state_digest: digest('stale'), state: f.state(0) }), /state_conflict/u);
 f.alterSeal(); await assert.rejects(f.store.load(lease.execution_id), /owner_snapshot_invalid/u);
 f.deny(); await assert.rejects(f.store.load(lease.execution_id), /lease_conflict/u);
 assert.deepEqual(f.trace.slice(-2), ['ROLLBACK', 'release']);
});
test('new outputs retain semantic validation and complete coverage is required at global transition', async () => {
 const f = fixture(41); await f.store.load(lease.execution_id);
 const bad = f.state(0); bad.screening_outputs[0]!.decisions.pop();
 const { state_digest: _old, ...body } = bad; bad.state_digest = digest(body);
 await assert.rejects(f.store.save({ execution_key: lease.execution_id, expected_state_digest: null, state: bad }), /output_invalid/u);
 const premature = f.state(0); premature.phase = 'global'; const { state_digest: _old2, ...early } = premature; premature.state_digest = digest(early);
 await assert.rejects(f.store.save({ execution_key: lease.execution_id, expected_state_digest: null, state: premature }), /result_incomplete/u);
});

test('store reuses a previously sealed owner input without another full-plan transfer',async()=>{
 const f=fixture();
 cacheSignalTopicEditorialPlanV1(f.database,JSON.stringify([lease.execution_id,lease.execution_token,lease.workspace_id,
  lease.actor_user_id,lease.numeric_run_id,lease.source_execution_id]),f.plan.plan_digest,{plan:f.plan,groups:f.groups});
 await f.store.load(lease.execution_id);
 for(let i=0;i<42;i++)await f.store.save({execution_key:lease.execution_id,expected_state_digest:f.currentDigest(),state:f.state(i)});
 assert.equal(f.readCounts().fullReads,0);assert.equal(f.readCounts().ownerReads,43);
 f.deny();await assert.rejects(f.store.load(lease.execution_id),/lease_conflict/u);
});
