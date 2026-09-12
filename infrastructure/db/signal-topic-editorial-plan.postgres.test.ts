import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { signalTopicEditorialDigestV1 as digest } from '@noisia/query-engine';

// Explicit opt-in: a pre-0178 database and a private plan fixture. Every DDL
// statement and test runs in ONE transaction which is always rolled back.
const urlFile = process.env.NOISIA_EDITORIAL_PG_URL_FILE;
const planFile = process.env.NOISIA_EDITORIAL_PG_PLAN_FILE;
const runId = process.env.NOISIA_EDITORIAL_PG_RUN_ID;
const migration = readFileSync(new URL('./migrations/0178_signal_topic_editorial_catalog_contract.sql', import.meta.url), 'utf8');
test('0178 parses as a complete migration; canonical parity, real plan and negative lineage cases in PostgreSQL',
 { skip: !urlFile || !planFile || !runId, timeout: 240_000 }, async t => {
 const pool = new pg.Pool({ connectionString: readFileSync(urlFile!, 'utf8').trim(), max: 1,
  ssl: process.env.NOISIA_EDITORIAL_PG_TLS === '1' ? { rejectUnauthorized: false } : undefined });
 const client = await pool.connect();
 const plan = JSON.parse(readFileSync(planFile!, 'utf8'));
 try {
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SET LOCAL lock_timeout='2s'");
  // pg compiles every function body here, including the repair CASE comparison.
  await client.query(migration);
  await t.test('canonical envelopes match QE JSON.stringify exactly without changing Unicode or controls', async () => {
   const controls = Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join('');
   const values = ['', 'plain', 'México e\u0301 😀 日本語', '\\n literal \\u000a " /', controls, '\u2028\u2029',
    { z: false, b: [null, 17, -5, 'e\u0301'], a: '\t\\\n' }, { '😀': 1, '\uE000': 2, 'é': 3, 'e\u0301': 4 }, 'é', 'e\u0301'];
   for (const value of values) {
    const { rows } = await client.query('SELECT signal_topic_editorial_digest_json_v1($1::jsonb) fast', [JSON.stringify(value)]);
    assert.equal(rows[0].fast, digest(value));
   }
   for (const value of [{ float: 0.125 }, '\u0000', '\uD800']) {
    await client.query('SAVEPOINT negative_canonical');
    try {
     await assert.rejects(client.query('SELECT signal_topic_editorial_digest_json_v1($1::jsonb)', [JSON.stringify(value)]),
      (error: unknown) => error instanceof Error && ['22023', '22021', '22P02', '22P05'].includes((error as Error & { code: string }).code));
    } finally { await client.query('ROLLBACK TO SAVEPOINT negative_canonical'); }
   }
  });
  const valid = async (candidate: unknown) => (await client.query('SELECT signal_topic_editorial_plan_valid_v1($1,$2::jsonb) valid', [runId, JSON.stringify(candidate)])).rows[0].valid;
  await t.test('full sealed plan passes, including float metadata held in its source string', async () => {
   const started = performance.now(); assert.equal(await valid(plan), true);
   t.diagnostic(`real plan ${plan.expected_group_count} groups: ${Math.round(performance.now() - started)} ms`);
  });
  const cases: Array<[string, (candidate: any) => void]> = [
   ['omitted batch', p => p.batches.pop()],
   ['duplicate receipt', p => p.batches[0].group_receipts[1] = p.batches[0].group_receipts[0]],
   ['duplicate key', p => p.batches[0].group_keys[1] = p.batches[0].group_keys[0]],
   ['unknown group', p => p.batches[0].group_receipts[0].group_key = 'open:absent'],
   ['source dossier digest changed', p => p.batches[0].group_receipts[0].source_dossier_digest = digest('other')],
   ['empty selected evidence', p => p.batches[0].group_receipts[0].evidence_ref_ids = []],
   ['foreign evidence ref', p => p.batches[0].group_receipts[0].evidence_ref_ids = [digest('foreign')]],
   ['duplicate evidence ref', p => p.batches[0].group_receipts[0].evidence_ref_ids.push(p.batches[0].group_receipts[0].evidence_ref_ids[0])],
   ['evidence text hash mismatch', p => project(p, g => g[0].evidence[0].text += ' changed')],
   ['evidence range mismatch', p => project(p, g => g[0].evidence[0].end += 1)],
   ['float source metadata changed', p => project(p, g => g[0].metrics.cohesion = 0.1234567)],
   ['foreign community', p => project(p, g => g[0].community_key = 'community-absent')],
   ['duplicate projected group', p => project(p, g => g[1] = g[0])],
  ];
  function project(p: any, mutate: (groups: any[]) => void) {
   const groups = JSON.parse(p.batches[0].source_groups_body); mutate(groups); p.batches[0].source_groups_body = JSON.stringify(groups);
  }
  for (const [label, mutate] of cases) await t.test(label, async () => {
   const changed = structuredClone(plan); mutate(changed);
   for (const b of changed.batches) {
    b.request_digest = digest({ request_body: b.request_body, configuration: b.configuration, group_receipts: b.group_receipts });
    b.batch_key = `topic-consolidation-screen-v1:${b.batch_index}:${b.request_digest.slice(7, 23)}`;
   }
   const { plan_digest: _old, ...unsigned } = changed; changed.plan_digest = digest(unsigned);
   assert.equal(await valid(changed), false);
  });
 } finally {
  await client.query('ROLLBACK'); client.release(); await pool.end();
 }
});
